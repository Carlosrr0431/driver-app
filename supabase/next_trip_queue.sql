-- =====================================================
-- Siguiente viaje en paralelo (estilo Uber)
--
-- Cuando no hay chofer libre en el radio, o el operador elige
-- un móvil ocupado, el viaje se ofrece como siguiente
-- (pending + next_after_trip_id). Si el chofer acepta, queda
-- reservado (accepted + next_after_trip_id) y al completar o
-- cancelar el viaje actual se activa solo.
--
-- Un chofer = un siguiente a la vez (índices únicos).
-- El viaje en curso no se cancela.
--
-- EJECUTAR en el editor SQL de Supabase.
-- No cambia el ciclo pending → accepted → going_to_pickup →
-- in_progress → completed / cancelled.
-- =====================================================

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS next_after_trip_id uuid REFERENCES public.trips(id) ON DELETE SET NULL;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS next_trip_offered_at timestamptz;

COMMENT ON COLUMN public.trips.next_after_trip_id IS
  'Si está seteado, este viaje es el siguiente del chofer (detrás del viaje actual).';
COMMENT ON COLUMN public.trips.next_trip_offered_at IS
  'Momento en que se ofreció el viaje como siguiente a un chofer ocupado.';

CREATE INDEX IF NOT EXISTS trips_next_after_trip_id_idx
  ON public.trips (next_after_trip_id)
  WHERE next_after_trip_id IS NOT NULL;

-- Un chofer, un siguiente viaje a la vez (oferta pending o ya aceptado).
CREATE UNIQUE INDEX IF NOT EXISTS trips_one_reserved_next_per_driver
  ON public.trips (driver_id)
  WHERE driver_id IS NOT NULL
    AND next_after_trip_id IS NOT NULL
    AND status IN ('pending', 'accepted');

-- Un viaje actual solo puede tener un siguiente detrás.
CREATE UNIQUE INDEX IF NOT EXISTS trips_one_next_behind_current
  ON public.trips (next_after_trip_id)
  WHERE next_after_trip_id IS NOT NULL
    AND status IN ('pending', 'accepted');

ALTER TABLE public.trips REPLICA IDENTITY FULL;

-- Activa el siguiente viaje cuando el actual termina o se cancela.
-- - accepted + next_after → going_to_pickup (ya lo había confirmado)
-- - pending + next_after  → queda pending vivo (el chofer todavía no aceptó)
CREATE OR REPLACE FUNCTION public.activate_reserved_next_trip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NULL OR NEW.status NOT IN ('completed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('completed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.trips
  SET
    next_after_trip_id = NULL,
    next_trip_offered_at = NULL,
    dispatch_status = COALESCE(dispatch_status, 'waiting_acceptance'),
    status_updated_at = NOW()
  WHERE driver_id = NEW.driver_id
    AND next_after_trip_id = NEW.id
    AND status = 'pending';

  UPDATE public.trips
  SET
    status = 'going_to_pickup',
    next_after_trip_id = NULL,
    next_trip_offered_at = NULL,
    dispatch_status = 'accepted',
    accepted_at = COALESCE(accepted_at, NOW()),
    status_updated_at = NOW()
  WHERE driver_id = NEW.driver_id
    AND next_after_trip_id = NEW.id
    AND status = 'accepted';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activate_reserved_next_trip ON public.trips;
CREATE TRIGGER trg_activate_reserved_next_trip
  AFTER UPDATE OF status ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.activate_reserved_next_trip();

-- Al rechazar, limpiar el vínculo de siguiente viaje.
CREATE OR REPLACE FUNCTION public.driver_reject_pending_trip(
  p_trip_id UUID,
  p_reason TEXT DEFAULT 'Rechazado por chofer'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id UUID;
  v_trip public.trips%ROWTYPE;
  v_context JSONB;
  v_excluded JSONB;
  v_permanent JSONB;
  v_is_timeout BOOLEAN;
  v_reason TEXT;
BEGIN
  v_driver_id := public.get_my_driver_id();
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'driver_not_found');
  END IF;

  v_reason := COALESCE(NULLIF(trim(p_reason), ''), 'Rechazado por chofer');
  v_is_timeout := v_reason = 'Tiempo agotado';

  SELECT * INTO v_trip
  FROM public.trips
  WHERE id = p_trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'trip_not_found');
  END IF;

  v_context := COALESCE(v_trip.wa_context, '{}'::jsonb);
  v_excluded := COALESCE(v_context->'dispatch_excluded_driver_ids', '[]'::jsonb);

  IF v_trip.status = 'queued' AND v_trip.driver_id IS NULL THEN
    IF v_excluded @> to_jsonb(v_driver_id::text) THEN
      RETURN jsonb_build_object('success', true, 'trip_id', p_trip_id, 'idempotent', true);
    END IF;
  END IF;

  IF v_trip.driver_id IS DISTINCT FROM v_driver_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'trip_not_owned');
  END IF;

  IF v_trip.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'trip_not_pending', 'unavailable', true);
  END IF;

  IF jsonb_typeof(v_excluded) IS DISTINCT FROM 'array' THEN
    v_excluded := '[]'::jsonb;
  END IF;
  IF NOT v_excluded @> to_jsonb(v_driver_id::text) THEN
    v_excluded := v_excluded || to_jsonb(v_driver_id::text);
  END IF;

  v_context := v_context || jsonb_build_object(
    'dispatch_excluded_driver_ids', v_excluded,
    'dispatch_last_excluded_at', to_jsonb(to_char(NOW() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'dispatch_last_excluded_reason', CASE WHEN v_is_timeout THEN 'driver_timeout' ELSE 'driver_rejected' END
  );

  -- Rechazo explícito: exclusión permanente para que el worker no vuelva a ofrecerle este viaje.
  IF NOT v_is_timeout THEN
    v_permanent := COALESCE(v_context->'dispatch_permanent_excluded_driver_ids', '[]'::jsonb);
    IF jsonb_typeof(v_permanent) IS DISTINCT FROM 'array' THEN
      v_permanent := '[]'::jsonb;
    END IF;
    IF NOT v_permanent @> to_jsonb(v_driver_id::text) THEN
      v_permanent := v_permanent || to_jsonb(v_driver_id::text);
    END IF;
    v_context := v_context || jsonb_build_object(
      'dispatch_permanent_excluded_driver_ids', v_permanent
    );
  END IF;

  UPDATE public.trips
  SET
    status = 'queued',
    driver_id = NULL,
    assigned_at = NULL,
    accepted_at = NULL,
    next_after_trip_id = NULL,
    next_trip_offered_at = NULL,
    origin_address = CASE
      WHEN COALESCE(v_trip.notes, '') LIKE '%[APPROACH_ONLY]%'
        OR COALESCE(v_trip.notes, '') LIKE '%[PASSENGER_APP]%'
      THEN v_trip.origin_address
      ELSE NULL
    END,
    origin_lat = CASE
      WHEN COALESCE(v_trip.notes, '') LIKE '%[APPROACH_ONLY]%'
        OR COALESCE(v_trip.notes, '') LIKE '%[PASSENGER_APP]%'
      THEN v_trip.origin_lat
      ELSE NULL
    END,
    origin_lng = CASE
      WHEN COALESCE(v_trip.notes, '') LIKE '%[APPROACH_ONLY]%'
        OR COALESCE(v_trip.notes, '') LIKE '%[PASSENGER_APP]%'
      THEN v_trip.origin_lng
      ELSE NULL
    END,
    dispatch_status = 'queued',
    next_dispatch_at = NOW(),
    status_updated_at = NOW(),
    wa_context = v_context,
    cancel_reason = CASE WHEN v_is_timeout THEN 'Tiempo agotado' ELSE v_reason END
  WHERE id = p_trip_id
    AND driver_id = v_driver_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'trip_not_pending', 'unavailable', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'trip_id', p_trip_id);
END;
$$;

REVOKE ALL ON FUNCTION public.driver_reject_pending_trip(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_reject_pending_trip(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_reserved_next_trip() TO authenticated;
