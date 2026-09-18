-- =====================================================
-- Chat viaje: estado enviado / leído / escuchado
-- Ejecutar en SQL Editor de Supabase (después de trip_chat_messages.sql).
-- =====================================================

ALTER TABLE public.trip_chat_messages
  ADD COLUMN IF NOT EXISTS seen_at timestamptz;

COMMENT ON COLUMN public.trip_chat_messages.seen_at IS
  'Cuando el destinatario leyó el texto o escuchó el audio (ticks azules).';

CREATE INDEX IF NOT EXISTS trip_chat_messages_unseen_idx
  ON public.trip_chat_messages (trip_id, sender_role, message_type)
  WHERE seen_at IS NULL;

-- Solo permitir mutar seen_at (no el contenido del mensaje).
CREATE OR REPLACE FUNCTION public.trip_chat_guard_seen_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.trip_id IS DISTINCT FROM OLD.trip_id
     OR NEW.sender_role IS DISTINCT FROM OLD.sender_role
     OR NEW.message_type IS DISTINCT FROM OLD.message_type
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.audio_url IS DISTINCT FROM OLD.audio_url
     OR NEW.audio_duration_seconds IS DISTINCT FROM OLD.audio_duration_seconds
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'trip_chat_only_seen_at'
      USING ERRCODE = '22023';
  END IF;

  -- No borrar un visto ya confirmado.
  IF OLD.seen_at IS NOT NULL THEN
    NEW.seen_at := OLD.seen_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_chat_guard_seen_update_trg ON public.trip_chat_messages;
CREATE TRIGGER trip_chat_guard_seen_update_trg
  BEFORE UPDATE ON public.trip_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trip_chat_guard_seen_update();

-- Chofer puede marcar como visto mensajes del pasajero en sus viajes.
DROP POLICY IF EXISTS "Chofer marca visto mensajes del pasajero" ON public.trip_chat_messages;
CREATE POLICY "Chofer marca visto mensajes del pasajero"
  ON public.trip_chat_messages
  FOR UPDATE
  TO authenticated
  USING (
    sender_role = 'passenger'
    AND EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = trip_chat_messages.trip_id
        AND t.driver_id = public.get_my_driver_id()
    )
  )
  WITH CHECK (
    sender_role = 'passenger'
    AND EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = trip_chat_messages.trip_id
        AND t.driver_id = public.get_my_driver_id()
    )
  );

-- RPC pasajero: marcar textos abiertos y/o audios escuchados.
CREATE OR REPLACE FUNCTION public.passenger_mark_trip_chat_seen(
  p_trip_id uuid,
  p_phone text,
  p_session_token text,
  p_message_ids uuid[] DEFAULT NULL,
  p_mark_open_texts boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_session_phone text;
  v_trip_phone text;
  v_session_local text;
  v_trip_local text;
  v_status text;
  v_updated integer := 0;
  v_n integer;
BEGIN
  IF p_trip_id IS NULL OR coalesce(trim(p_phone), '') = '' OR coalesce(trim(p_session_token), '') = '' THEN
    RAISE EXCEPTION 'missing_params' USING ERRCODE = '22023';
  END IF;

  SELECT s.phone INTO v_session_phone
  FROM public.passenger_auth_sessions s
  WHERE s.token = trim(p_session_token)
    AND s.expires_at > now()
  LIMIT 1;

  IF v_session_phone IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  v_session_local := public._trip_chat_local_digits(v_session_phone);
  IF v_session_local IS DISTINCT FROM public._trip_chat_local_digits(p_phone) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT t.passenger_phone, lower(t.status)
  INTO v_trip_phone, v_status
  FROM public.trips t
  WHERE t.id = p_trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status NOT IN ('accepted', 'going_to_pickup', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'chat_unavailable' USING ERRCODE = 'P0001';
  END IF;

  v_trip_local := public._trip_chat_local_digits(v_trip_phone);
  IF v_session_local IS NULL OR v_trip_local IS NULL OR v_session_local <> v_trip_local THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_mark_open_texts THEN
    UPDATE public.trip_chat_messages m
    SET seen_at = now()
    WHERE m.trip_id = p_trip_id
      AND m.sender_role = 'driver'
      AND m.message_type = 'text'
      AND m.seen_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_updated := v_updated + coalesce(v_n, 0);
  END IF;

  IF p_message_ids IS NOT NULL AND array_length(p_message_ids, 1) IS NOT NULL THEN
    UPDATE public.trip_chat_messages m
    SET seen_at = now()
    WHERE m.trip_id = p_trip_id
      AND m.sender_role = 'driver'
      AND m.id = ANY (p_message_ids)
      AND m.seen_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_updated := v_updated + coalesce(v_n, 0);
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.passenger_mark_trip_chat_seen(uuid, text, text, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.passenger_mark_trip_chat_seen(uuid, text, text, uuid[], boolean) TO anon, authenticated, service_role;
