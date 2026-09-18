-- =====================================================
-- RPC chat pasajero → trip_chat_messages
-- Permite enviar/listar mensajes con sesión OTP sin
-- depender del deploy de /api/trips/chat.
-- Ejecutar en SQL Editor de Supabase (después de trip_chat_messages.sql).
-- =====================================================

CREATE OR REPLACE FUNCTION public._trip_chat_local_digits(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN length(d) >= 10 THEN right(d, 10)
    ELSE NULL
  END
  FROM (
    SELECT regexp_replace(coalesce(raw, ''), '\D', '', 'g') AS d
  ) s;
$$;

CREATE OR REPLACE FUNCTION public.passenger_list_trip_chat_messages(
  p_trip_id uuid,
  p_phone text,
  p_session_token text
)
RETURNS SETOF public.trip_chat_messages
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

  RETURN QUERY
  SELECT m.*
  FROM public.trip_chat_messages m
  WHERE m.trip_id = p_trip_id
  ORDER BY m.created_at ASC
  LIMIT 120;
END;
$$;

CREATE OR REPLACE FUNCTION public.passenger_send_trip_chat_message(
  p_trip_id uuid,
  p_phone text,
  p_session_token text,
  p_message_type text,
  p_body text DEFAULT NULL,
  p_audio_url text DEFAULT NULL,
  p_audio_duration_seconds integer DEFAULT NULL,
  p_client_id text DEFAULT NULL
)
RETURNS public.trip_chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_session_phone text;
  v_trip_phone text;
  v_driver_id uuid;
  v_status text;
  v_session_local text;
  v_trip_local text;
  v_type text;
  v_body text;
  v_audio text;
  v_msg public.trip_chat_messages;
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

  SELECT t.passenger_phone, t.driver_id, lower(t.status)
  INTO v_trip_phone, v_driver_id, v_status
  FROM public.trips t
  WHERE t.id = p_trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status NOT IN ('accepted', 'going_to_pickup', 'in_progress') THEN
    RAISE EXCEPTION 'chat_closed' USING ERRCODE = 'P0001';
  END IF;

  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'no_driver' USING ERRCODE = 'P0001';
  END IF;

  v_trip_local := public._trip_chat_local_digits(v_trip_phone);

  IF v_session_local IS NULL OR v_trip_local IS NULL OR v_session_local <> v_trip_local THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_type := lower(trim(coalesce(p_message_type, '')));
  IF v_type = 'text' THEN
    v_body := left(trim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g')), 500);
    IF v_body IS NULL OR v_body = '' THEN
      RAISE EXCEPTION 'empty_text' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.trip_chat_messages (
      trip_id, sender_role, message_type, body, client_id
    ) VALUES (
      p_trip_id, 'passenger', 'text', v_body, nullif(trim(p_client_id), '')
    )
    RETURNING * INTO v_msg;
  ELSIF v_type = 'audio' THEN
    v_audio := nullif(trim(p_audio_url), '');
    IF v_audio IS NULL THEN
      RAISE EXCEPTION 'missing_audio' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.trip_chat_messages (
      trip_id, sender_role, message_type, audio_url, audio_duration_seconds, client_id
    ) VALUES (
      p_trip_id,
      'passenger',
      'audio',
      v_audio,
      GREATEST(1, LEAST(60, coalesce(p_audio_duration_seconds, 1))),
      nullif(trim(p_client_id), '')
    )
    RETURNING * INTO v_msg;
  ELSE
    RAISE EXCEPTION 'invalid_type' USING ERRCODE = '22023';
  END IF;

  RETURN v_msg;
END;
$$;

REVOKE ALL ON FUNCTION public._trip_chat_local_digits(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.passenger_list_trip_chat_messages(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.passenger_send_trip_chat_message(uuid, text, text, text, text, text, integer, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public._trip_chat_local_digits(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_list_trip_chat_messages(uuid, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.passenger_send_trip_chat_message(uuid, text, text, text, text, text, integer, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
