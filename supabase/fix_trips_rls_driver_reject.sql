-- =====================================================
-- FIX: Chofer no puede rechazar viaje pending (error 42501 RLS)
--
-- Síntoma en driver-app: toast "No se pudo procesar el viaje" al
-- rechazar/cancelar un viaje nuevo desde NewTripModal.
--
-- Causa: la política "Chofer actualiza sus viajes" solo define USING
-- (driver_id = get_my_driver_id()). Sin WITH CHECK explícito, Postgres
-- reutiliza USING también para la fila nueva. Al poner driver_id = NULL
-- y status = 'queued', falla el chequeo RLS.
--
-- EJECUTAR en el editor SQL de Supabase.
-- Requiere get_my_driver_id() (fix_drivers_rls_recursion.sql paso 1).
-- =====================================================

-- 1) Helper RLS (idempotente)
CREATE OR REPLACE FUNCTION public.get_my_driver_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.drivers WHERE user_id = auth.uid() LIMIT 1;
$$;

-- 2) Política UPDATE con WITH CHECK que permite reencolar
DROP POLICY IF EXISTS "Chofer actualiza sus viajes" ON public.trips;

CREATE POLICY "Chofer actualiza sus viajes"
  ON public.trips FOR UPDATE TO authenticated
  USING (
    driver_id = public.get_my_driver_id()
    OR driver_id IN (
      SELECT id FROM public.drivers WHERE owner_id = public.get_my_driver_id()
    )
  )
  WITH CHECK (
    driver_id = public.get_my_driver_id()
    OR driver_id IN (
      SELECT id FROM public.drivers WHERE owner_id = public.get_my_driver_id()
    )
    OR (
      driver_id IS NULL
      AND status IN ('queued', 'cancelled')
    )
  );

-- 3) RPC SECURITY DEFINER — la app llama esto directamente
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

  IF NOT v_excluded @> to_jsonb(v_driver_id::text) THEN
    v_context := v_context || jsonb_build_object(
      'dispatch_excluded_driver_ids', v_excluded || to_jsonb(v_driver_id::text),
      'dispatch_last_excluded_at', to_jsonb(to_char(NOW() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      'dispatch_last_excluded_reason', CASE WHEN v_is_timeout THEN 'driver_timeout' ELSE 'driver_rejected' END
    );
  END IF;

  UPDATE public.trips
  SET
    status = 'queued',
    driver_id = NULL,
    assigned_at = NULL,
    accepted_at = NULL,
    origin_address = NULL,
    origin_lat = NULL,
    origin_lng = NULL,
    dispatch_status = 'queued',
    next_dispatch_at = NOW() + INTERVAL '5 seconds',
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
