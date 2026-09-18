-- =====================================================
-- Chat viaje: conductor ↔ pasajero (texto + audio)
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================

-- 1) Tabla
CREATE TABLE IF NOT EXISTS public.trip_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('driver', 'passenger')),
  message_type text NOT NULL CHECK (message_type IN ('text', 'audio')),
  body text,
  audio_url text,
  audio_duration_seconds integer,
  client_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz,
  CONSTRAINT trip_chat_messages_payload_check CHECK (
    (message_type = 'text' AND body IS NOT NULL AND length(trim(body)) > 0)
    OR (message_type = 'audio' AND audio_url IS NOT NULL AND length(trim(audio_url)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS trip_chat_messages_trip_created_idx
  ON public.trip_chat_messages (trip_id, created_at ASC);

CREATE INDEX IF NOT EXISTS trip_chat_messages_trip_created_desc_idx
  ON public.trip_chat_messages (trip_id, created_at DESC);

COMMENT ON TABLE public.trip_chat_messages IS
  'Mensajes de chat (texto/audio) entre chofer y pasajero durante un viaje activo.';

-- 2) Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'trip_chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_chat_messages;
  END IF;
END $$;

-- 3) RLS
ALTER TABLE public.trip_chat_messages ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trip_chat_messages'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.trip_chat_messages', pol.policyname);
  END LOOP;
END $$;

-- Chofer autenticado: lee mensajes de sus viajes
CREATE POLICY "Chofer lee chat de sus viajes"
  ON public.trip_chat_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = trip_chat_messages.trip_id
        AND t.driver_id = public.get_my_driver_id()
    )
  );

-- Chofer autenticado: envía como driver en viajes activos asignados
CREATE POLICY "Chofer envia chat en viajes activos"
  ON public.trip_chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_role = 'driver'
    AND EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = trip_chat_messages.trip_id
        AND t.driver_id = public.get_my_driver_id()
        AND t.status IN ('accepted', 'going_to_pickup', 'in_progress')
    )
  );

-- Anon: lectura para Realtime de la app pasajero (UUID de viaje poco adivinable).
-- Los INSERT del pasajero van por API (service role).
CREATE POLICY "Anon lee chat de viajes en curso"
  ON public.trip_chat_messages
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = trip_chat_messages.trip_id
        AND t.status IN ('accepted', 'going_to_pickup', 'in_progress', 'completed')
    )
  );

-- Dashboard / service role opera con bypass RLS; anon no inserta.

-- 4) Storage bucket para audios del chat
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'trip-chat-audio',
  'trip-chat-audio',
  true,
  5242880,
  ARRAY['audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a', 'audio/3gpp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Limpiar políticas previas del bucket
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (
        policyname ILIKE '%trip-chat%'
        OR policyname ILIKE '%trip_chat%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Lectura publica trip-chat-audio"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'trip-chat-audio');

CREATE POLICY "Chofer sube audio trip-chat"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'trip-chat-audio'
    AND (storage.foldername(name))[1] = public.get_my_driver_id()::text
  );

CREATE POLICY "Chofer actualiza audio trip-chat"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'trip-chat-audio'
    AND (storage.foldername(name))[1] = public.get_my_driver_id()::text
  );

CREATE POLICY "Anon no sube trip-chat-audio"
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (false);
