-- =====================================================
-- Historial WhatsApp acotado al viaje (agencia ↔ pasajero)
-- Ejecutar en el SQL Editor de Supabase.
-- El chofer asignado solo puede LEER tras aceptar el viaje.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.trip_whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  whatsapp_message_id uuid NOT NULL REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_type text NOT NULL DEFAULT 'text',
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  copied_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, whatsapp_message_id)
);

CREATE INDEX IF NOT EXISTS trip_whatsapp_messages_trip_created_idx
  ON public.trip_whatsapp_messages (trip_id, created_at ASC);

CREATE INDEX IF NOT EXISTS trip_whatsapp_messages_trip_created_desc_idx
  ON public.trip_whatsapp_messages (trip_id, created_at DESC);

COMMENT ON TABLE public.trip_whatsapp_messages IS
  'Copia del hilo WhatsApp de ESTE viaje (no el historial completo del número). Visible al chofer asignado tras aceptar.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'trip_whatsapp_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_whatsapp_messages;
  END IF;
END $$;

ALTER TABLE public.trip_whatsapp_messages ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trip_whatsapp_messages'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.trip_whatsapp_messages', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Chofer lee WhatsApp de su viaje aceptado"
  ON public.trip_whatsapp_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = trip_whatsapp_messages.trip_id
        AND t.driver_id = public.get_my_driver_id()
        AND t.status IN ('accepted', 'going_to_pickup', 'in_progress')
    )
  );

GRANT SELECT ON public.trip_whatsapp_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.trip_whatsapp_display_body(
  p_content text,
  p_transcription text,
  p_message_type text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_body text;
  v_type text;
BEGIN
  v_body := COALESCE(NULLIF(btrim(COALESCE(p_transcription, '')), ''), NULLIF(btrim(COALESCE(p_content, '')), ''));
  IF v_body IS NOT NULL AND v_body <> '' THEN
    RETURN v_body;
  END IF;
  v_type := lower(COALESCE(p_message_type, 'text'));
  CASE v_type
    WHEN 'audio' THEN RETURN 'Audio';
    WHEN 'ptt' THEN RETURN 'Audio';
    WHEN 'image' THEN RETURN 'Foto';
    WHEN 'video' THEN RETURN 'Video';
    WHEN 'location' THEN RETURN 'Ubicación';
    WHEN 'sticker' THEN RETURN 'Sticker';
    WHEN 'document' THEN RETURN 'Documento';
    WHEN 'contact' THEN RETURN 'Contacto';
    ELSE RETURN 'Mensaje';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.trip_is_whatsapp_thread_eligible(
  p_notes text,
  p_status text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    lower(COALESCE(p_status, '')) NOT IN ('completed', 'cancelled')
    AND COALESCE(p_notes, '') NOT ILIKE '%[PASSENGER_APP]%'
    AND COALESCE(p_notes, '') NOT ILIKE '%[DASHBOARD]%'
    AND (
      COALESCE(p_notes, '') ILIKE '%[WHATSAPP]%'
      OR COALESCE(p_notes, '') ILIKE '%[APPROACH_ONLY]%'
      OR COALESCE(p_notes, '') ILIKE '%[SCHEDULED_SOURCE]%whatsapp%'
    );
$$;

CREATE OR REPLACE FUNCTION public.copy_whatsapp_message_onto_trip(
  p_trip_id uuid,
  p_conversation_id uuid,
  p_message_id uuid,
  p_direction text,
  p_message_type text,
  p_content text,
  p_transcription text,
  p_created_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_trip_id IS NULL OR p_message_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.trip_whatsapp_messages (
    trip_id,
    conversation_id,
    whatsapp_message_id,
    direction,
    message_type,
    body,
    created_at
  )
  VALUES (
    p_trip_id,
    p_conversation_id,
    p_message_id,
    p_direction,
    COALESCE(p_message_type, 'text'),
    public.trip_whatsapp_display_body(p_content, p_transcription, p_message_type),
    COALESCE(p_created_at, now())
  )
  ON CONFLICT (trip_id, whatsapp_message_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_whatsapp_thread_to_trip(
  p_trip_id uuid,
  p_conversation_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id uuid;
  v_notes text;
  v_status text;
  v_created_at timestamptz;
  v_phone text;
  v_prev_ended timestamptz;
  v_since timestamptz;
  v_count integer := 0;
BEGIN
  IF p_trip_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT notes, status, created_at, passenger_phone
    INTO v_notes, v_status, v_created_at, v_phone
  FROM public.trips
  WHERE id = p_trip_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF NOT public.trip_is_whatsapp_thread_eligible(v_notes, v_status) THEN
    RETURN 0;
  END IF;

  v_conversation_id := p_conversation_id;
  IF v_conversation_id IS NULL THEN
    SELECT id
      INTO v_conversation_id
    FROM public.whatsapp_conversations
    WHERE last_trip_id = p_trip_id
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_conversation_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Solo el hilo de ESTE viaje: ventana corta, y nunca mensajes de un viaje anterior.
  v_since := COALESCE(v_created_at, now()) - interval '20 minutes';

  SELECT MAX(COALESCE(t.completed_at, t.updated_at, t.created_at))
    INTO v_prev_ended
  FROM public.trips t
  WHERE t.id <> p_trip_id
    AND t.status IN ('completed', 'cancelled')
    AND (
      EXISTS (
        SELECT 1
        FROM public.trip_whatsapp_messages tw
        WHERE tw.trip_id = t.id
          AND tw.conversation_id = v_conversation_id
      )
      OR (
        v_phone IS NOT NULL
        AND btrim(v_phone) <> ''
        AND t.passenger_phone IS NOT NULL
        AND t.passenger_phone = v_phone
      )
    );

  IF v_prev_ended IS NOT NULL AND v_prev_ended >= v_since THEN
    v_since := v_prev_ended + interval '1 second';
  END IF;

  DELETE FROM public.trip_whatsapp_messages tw
  WHERE tw.trip_id = p_trip_id
    AND (
      tw.created_at < v_since
      OR EXISTS (
        SELECT 1
        FROM public.trip_whatsapp_messages other
        WHERE other.whatsapp_message_id = tw.whatsapp_message_id
          AND other.trip_id <> p_trip_id
      )
    );

  INSERT INTO public.trip_whatsapp_messages (
    trip_id,
    conversation_id,
    whatsapp_message_id,
    direction,
    message_type,
    body,
    created_at
  )
  SELECT
    src.trip_id,
    src.conversation_id,
    src.whatsapp_message_id,
    src.direction,
    src.message_type,
    src.body,
    src.created_at
  FROM (
    SELECT
      p_trip_id AS trip_id,
      v_conversation_id AS conversation_id,
      m.id AS whatsapp_message_id,
      m.direction,
      COALESCE(m.message_type, 'text') AS message_type,
      public.trip_whatsapp_display_body(m.content, m.transcription, m.message_type) AS body,
      m.created_at
    FROM public.whatsapp_messages m
    WHERE m.conversation_id = v_conversation_id
      AND m.created_at >= v_since
      AND NOT EXISTS (
        SELECT 1
        FROM public.trip_whatsapp_messages other
        WHERE other.whatsapp_message_id = m.id
          AND other.trip_id <> p_trip_id
      )
    ORDER BY m.created_at DESC
    LIMIT 60
  ) src
  ON CONFLICT (trip_id, whatsapp_message_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_whatsapp_thread_to_trip(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.copy_whatsapp_message_onto_trip(uuid, uuid, uuid, text, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attach_whatsapp_thread_to_trip(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.copy_whatsapp_message_onto_trip(uuid, uuid, uuid, text, text, text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_whatsapp_message_copy_to_trip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip_id uuid;
  v_status text;
  v_notes text;
BEGIN
  SELECT c.last_trip_id, t.status, t.notes
    INTO v_trip_id, v_status, v_notes
  FROM public.whatsapp_conversations c
  LEFT JOIN public.trips t ON t.id = c.last_trip_id
  WHERE c.id = NEW.conversation_id;

  IF v_trip_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.trip_is_whatsapp_thread_eligible(v_notes, v_status) THEN
    RETURN NEW;
  END IF;

  PERFORM public.copy_whatsapp_message_onto_trip(
    v_trip_id,
    NEW.conversation_id,
    NEW.id,
    NEW.direction,
    NEW.message_type,
    NEW.content,
    NEW.transcription,
    NEW.created_at
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_message_copy_to_trip ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_message_copy_to_trip
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW
EXECUTE FUNCTION public.trg_whatsapp_message_copy_to_trip();

CREATE OR REPLACE FUNCTION public.trg_whatsapp_conversation_attach_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.last_trip_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.last_trip_id IS NOT DISTINCT FROM NEW.last_trip_id THEN
    RETURN NEW;
  END IF;
  PERFORM public.attach_whatsapp_thread_to_trip(NEW.last_trip_id, NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_conversation_attach_thread ON public.whatsapp_conversations;
CREATE TRIGGER trg_whatsapp_conversation_attach_thread
AFTER INSERT OR UPDATE OF last_trip_id ON public.whatsapp_conversations
FOR EACH ROW
EXECUTE FUNCTION public.trg_whatsapp_conversation_attach_thread();

CREATE OR REPLACE FUNCTION public.trg_trip_accepted_attach_whatsapp_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('accepted', 'going_to_pickup', 'in_progress') THEN
    RETURN NEW;
  END IF;
  IF NOT public.trip_is_whatsapp_thread_eligible(NEW.notes, NEW.status) THEN
    RETURN NEW;
  END IF;
  PERFORM public.attach_whatsapp_thread_to_trip(NEW.id, NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trip_accepted_attach_whatsapp_thread ON public.trips;
CREATE TRIGGER trg_trip_accepted_attach_whatsapp_thread
AFTER UPDATE OF status ON public.trips
FOR EACH ROW
EXECUTE FUNCTION public.trg_trip_accepted_attach_whatsapp_thread();
