-- =====================================================
-- Notas operativas en tiempo real (dashboard → chofer)
-- Ejecutar TODO este archivo en el SQL Editor de Supabase.
-- Idempotente: se puede correr más de una vez.
--
-- Qué hace:
--   1. Asegura trips.notes (texto humano + marcadores internos).
--   2. Agrega notes_updated_at: se pisa solo cuando cambia notes.
--      El payload Realtime trae este timestamp → el chofer puede
--      detectar el cambio aunque el resto del viaje no se mueva.
--   3. Publica trips en supabase_realtime.
--   4. REPLICA IDENTITY FULL: el UPDATE incluye old + new (notas
--      anteriores vs nuevas). Sin esto, old suele traer solo el id.
--
-- No toca políticas de choferes ni despacho.
-- Los operadores escriben notas vía API (service role).
-- El chofer las lee por SELECT RLS + postgres_changes.
-- =====================================================

DO $$
BEGIN
  IF to_regclass('public.trips') IS NULL THEN
    RAISE EXCEPTION 'No existe public.trips';
  END IF;
END $$;

-- ══════════════════════════════════════════════════
-- 1. Columnas
-- ══════════════════════════════════════════════════
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS notes_updated_at timestamptz;

COMMENT ON COLUMN public.trips.notes IS
  'Notas operativas y datos adicionales del viaje. El chofer ve el texto limpio (sin marcadores internos) al aceptar y durante el viaje activo.';

COMMENT ON COLUMN public.trips.notes_updated_at IS
  'Última vez que cambió trips.notes. Se usa para que el chofer note el cambio en Realtime.';

-- ══════════════════════════════════════════════════
-- 2. Timestamp automático al cambiar notes
-- ══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trips_touch_notes_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.notes IS NOT NULL
       AND btrim(NEW.notes) <> ''
       AND NEW.notes_updated_at IS NULL THEN
      NEW.notes_updated_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.notes IS DISTINCT FROM OLD.notes THEN
    NEW.notes_updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trips_touch_notes_updated_at ON public.trips;
CREATE TRIGGER trg_trips_touch_notes_updated_at
  BEFORE INSERT OR UPDATE OF notes ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.trips_touch_notes_updated_at();

-- ══════════════════════════════════════════════════
-- 3. Realtime: publicación + fila completa en UPDATE
-- ══════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'trips'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
  END IF;
END $$;

-- Necesario para que postgres_changes mande old.notes + new.notes.
ALTER TABLE public.trips REPLICA IDENTITY FULL;

-- ══════════════════════════════════════════════════
-- Verificación (opcional, descomentar y correr)
-- ══════════════════════════════════════════════════
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'trips'
--   AND column_name IN ('notes', 'notes_updated_at');
--
-- SELECT tablename
-- FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime'
--   AND tablename = 'trips';
--
-- SELECT relreplident
-- FROM pg_class
-- WHERE oid = 'public.trips'::regclass;
-- -- 'f' = FULL
