-- =====================================================
-- Calificación de choferes (estrellas, 1 por viaje)
-- Ejecutar TODO este archivo en el SQL Editor de Supabase.
--
-- Semántica:
--  1) El pasajero califica SOLO un viaje completed, una vez.
--  2) drivers.rating / rating_count / rating_star_1..5 se recalculan
--     con un trigger (promedio + histograma estilo Google).
--  3) trips.passenger_rating guarda la nota del pasajero en ese viaje.
--  4) La app escribe vía API (service role). RLS bloquea acceso directo.
--
-- Idempotente: se puede volver a pegar sin romper datos.
-- =====================================================

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS rating numeric(3,2),
  ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_star_1 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_star_2 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_star_3 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_star_4 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_star_5 integer NOT NULL DEFAULT 0;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS passenger_rating smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trips_passenger_rating_range'
  ) THEN
    ALTER TABLE public.trips
      ADD CONSTRAINT trips_passenger_rating_range
      CHECK (passenger_rating IS NULL OR (passenger_rating >= 1 AND passenger_rating <= 5));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.driver_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  passenger_phone text NOT NULL,
  stars smallint NOT NULL CHECK (stars >= 1 AND stars <= 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_ratings_trip_uidx
  ON public.driver_ratings (trip_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'driver_ratings_trip_id_key'
  ) THEN
    ALTER TABLE public.driver_ratings
      ADD CONSTRAINT driver_ratings_trip_id_key
      UNIQUE USING INDEX driver_ratings_trip_uidx;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS driver_ratings_driver_created_idx
  ON public.driver_ratings (driver_id, created_at DESC);

ALTER TABLE public.driver_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_ratings_no_direct_access ON public.driver_ratings;
CREATE POLICY driver_ratings_no_direct_access
  ON public.driver_ratings
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.refresh_driver_rating_stats(p_driver_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_avg numeric := NULL;
  v_s1 integer := 0;
  v_s2 integer := 0;
  v_s3 integer := 0;
  v_s4 integer := 0;
  v_s5 integer := 0;
BEGIN
  IF p_driver_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*)::integer,
    ROUND(AVG(stars)::numeric, 2),
    COUNT(*) FILTER (WHERE stars = 1)::integer,
    COUNT(*) FILTER (WHERE stars = 2)::integer,
    COUNT(*) FILTER (WHERE stars = 3)::integer,
    COUNT(*) FILTER (WHERE stars = 4)::integer,
    COUNT(*) FILTER (WHERE stars = 5)::integer
  INTO v_count, v_avg, v_s1, v_s2, v_s3, v_s4, v_s5
  FROM public.driver_ratings
  WHERE driver_id = p_driver_id;

  UPDATE public.drivers
  SET
    rating = CASE WHEN COALESCE(v_count, 0) > 0 THEN v_avg ELSE NULL END,
    rating_count = COALESCE(v_count, 0),
    rating_star_1 = COALESCE(v_s1, 0),
    rating_star_2 = COALESCE(v_s2, 0),
    rating_star_3 = COALESCE(v_s3, 0),
    rating_star_4 = COALESCE(v_s4, 0),
    rating_star_5 = COALESCE(v_s5, 0)
  WHERE id = p_driver_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_ratings_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip public.trips%ROWTYPE;
  v_driver_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_driver_rating_stats(OLD.driver_id);
    RETURN OLD;
  END IF;

  SELECT * INTO v_trip
  FROM public.trips
  WHERE id = NEW.trip_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El viaje de la calificación no existe';
  END IF;

  IF lower(COALESCE(v_trip.status, '')) <> 'completed' THEN
    RAISE EXCEPTION 'Solo se puede calificar un viaje completado';
  END IF;

  IF v_trip.driver_id IS NULL OR v_trip.driver_id <> NEW.driver_id THEN
    RAISE EXCEPTION 'El chofer no coincide con el viaje';
  END IF;

  UPDATE public.trips
  SET passenger_rating = NEW.stars
  WHERE id = NEW.trip_id;

  v_driver_id := NEW.driver_id;
  IF TG_OP = 'UPDATE' AND OLD.driver_id IS DISTINCT FROM NEW.driver_id THEN
    PERFORM public.refresh_driver_rating_stats(OLD.driver_id);
  END IF;

  PERFORM public.refresh_driver_rating_stats(v_driver_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_ratings_after_change ON public.driver_ratings;
CREATE TRIGGER driver_ratings_after_change
  AFTER INSERT OR UPDATE OR DELETE ON public.driver_ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.driver_ratings_after_change();

-- Choferes sin reseñas reales no deben lucir 5.0 inventado.
UPDATE public.drivers
SET rating = NULL
WHERE COALESCE(rating_count, 0) = 0;
