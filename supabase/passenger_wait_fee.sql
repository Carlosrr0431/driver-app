-- =====================================================
-- Recargo por minuto de espera (pasajero)
-- Ejecutar TODO este archivo en el SQL Editor de Supabase.
--
-- Semántica:
--  1) El chofer marca "llegué al origen" → se guarda driver_arrived_at
--     y se congela el $ / min vigente (settings.passenger_wait_fee_per_minute).
--  2) Los primeros 59 s no cobran. Cada minuto entero suma 1 × tarifa.
--  3) Al subir el pasajero (pickup_at / in_progress) se congela la espera.
--  4) Al completar se suma espera + deudas abiertas al price del viaje.
--     La comisión del chofer NO se recalcula sobre la espera.
--  5) Si el viaje se cancela con espera cobrada y no liquidada, queda
--     deuda para el próximo viaje del mismo teléfono.
--  6) Viaje tomado en calle ([STREET_HAIL]) no genera espera.
--
-- Idempotente: se puede volver a pegar sin romper datos.
-- =====================================================

INSERT INTO public.settings (key, value, updated_at)
VALUES ('passenger_wait_fee_per_minute', '0', NOW())
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS driver_arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS wait_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS wait_fee_per_minute numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wait_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wait_fee_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wait_prior_debt numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wait_debt_applied numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wait_fee_settled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.passenger_wait_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_phone text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  source_trip_id uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  settled_trip_id uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS passenger_wait_debts_source_trip_uidx
  ON public.passenger_wait_debts (source_trip_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'passenger_wait_debts_source_trip_key'
  ) THEN
    ALTER TABLE public.passenger_wait_debts
      ADD CONSTRAINT passenger_wait_debts_source_trip_key
      UNIQUE USING INDEX passenger_wait_debts_source_trip_uidx;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS passenger_wait_debts_open_phone_idx
  ON public.passenger_wait_debts (passenger_phone)
  WHERE settled_at IS NULL;

ALTER TABLE public.passenger_wait_debts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS passenger_wait_debts_no_direct_access ON public.passenger_wait_debts;
CREATE POLICY passenger_wait_debts_no_direct_access
  ON public.passenger_wait_debts
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Teléfono canónico 54 + 10 dígitos, igual que passenger-app/src/utils/phone.js
CREATE OR REPLACE FUNCTION public.normalize_wait_phone(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits text;
  local text;
BEGIN
  digits := regexp_replace(COALESCE(raw, ''), '\D', '', 'g');
  IF digits = '' THEN
    RETURN NULL;
  END IF;
  IF left(digits, 2) = '00' THEN
    digits := substring(digits FROM 3);
  END IF;
  WHILE left(digits, 1) = '0' LOOP
    digits := substring(digits FROM 2);
  END LOOP;

  IF left(digits, 3) = '549' THEN
    IF length(digits) < 13 THEN
      RETURN NULL;
    END IF;
    local := substring(digits FROM 4);
  ELSIF left(digits, 2) = '54' THEN
    IF length(digits) < 12 THEN
      RETURN NULL;
    END IF;
    local := substring(digits FROM 3);
    IF left(local, 1) = '9' AND length(local) >= 11 THEN
      local := substring(local FROM 2);
    END IF;
  ELSIF left(digits, 1) = '9' AND length(digits) = 11 THEN
    local := substring(digits FROM 2);
  ELSIF length(digits) = 10 THEN
    local := digits;
  ELSE
    RETURN NULL;
  END IF;

  IF local ~ '^\d{3}15\d{6,}$' THEN
    local := substring(local FROM 1 FOR 3) || substring(local FROM 6);
  END IF;

  local := left(local, 10);
  IF local !~ '^\d{10}$' THEN
    RETURN NULL;
  END IF;
  IF left(local, 2) = '54' THEN
    RETURN NULL;
  END IF;
  IF left(local, 1) = '9' OR left(local, 2) = '59' THEN
    RETURN NULL;
  END IF;
  RETURN '54' || local;
END;
$$;

CREATE OR REPLACE FUNCTION public.trips_apply_wait_freeze(r public.trips)
RETURNS public.trips
LANGUAGE plpgsql
AS $$
DECLARE
  ended_at timestamptz;
  elapsed numeric;
BEGIN
  IF r.driver_arrived_at IS NULL OR r.wait_ended_at IS NOT NULL THEN
    RETURN r;
  END IF;

  ended_at := COALESCE(r.pickup_at, r.started_at, r.completed_at, timezone('utc', now()));
  IF ended_at < r.driver_arrived_at THEN
    ended_at := r.driver_arrived_at;
  END IF;

  r.wait_ended_at := ended_at;
  elapsed := EXTRACT(EPOCH FROM (ended_at - r.driver_arrived_at));
  r.wait_minutes := GREATEST(0, FLOOR(elapsed / 60.0))::integer;
  r.wait_fee_amount := ROUND((r.wait_minutes::numeric) * COALESCE(r.wait_fee_per_minute, 0));
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.open_wait_debt_total(phone_raw text)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(d.amount), 0)
  FROM public.passenger_wait_debts d
  WHERE d.settled_at IS NULL
    AND public.normalize_wait_phone(d.passenger_phone) = public.normalize_wait_phone(phone_raw);
$$;

CREATE OR REPLACE FUNCTION public.trips_wait_fee_before()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rate_raw text;
  rate_num numeric;
  phone_canon text;
  debt_sum numeric := 0;
  should_freeze boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.wait_prior_debt := COALESCE(public.open_wait_debt_total(NEW.passenger_phone), 0);
    NEW.wait_debt_applied := COALESCE(NEW.wait_debt_applied, 0);
    NEW.wait_fee_amount := COALESCE(NEW.wait_fee_amount, 0);
    NEW.wait_minutes := COALESCE(NEW.wait_minutes, 0);
    NEW.wait_fee_per_minute := COALESCE(NEW.wait_fee_per_minute, 0);
    NEW.wait_fee_settled := COALESCE(NEW.wait_fee_settled, false);
    RETURN NEW;
  END IF;

  -- No pisar una llegada ya guardada (evita que un cliente resetee el reloj).
  IF OLD.driver_arrived_at IS NOT NULL THEN
    NEW.driver_arrived_at := OLD.driver_arrived_at;
    NEW.wait_fee_per_minute := OLD.wait_fee_per_minute;
  ELSIF NEW.driver_arrived_at IS NOT NULL THEN
    IF COALESCE(NEW.notes, '') ILIKE '%[STREET_HAIL]%' THEN
      NEW.wait_fee_per_minute := 0;
    ELSE
      SELECT s.value INTO rate_raw
      FROM public.settings s
      WHERE s.key = 'passenger_wait_fee_per_minute'
      LIMIT 1;
      rate_num := NULLIF(regexp_replace(COALESCE(rate_raw, '0'), '[^0-9.]', '', 'g'), '')::numeric;
      NEW.wait_fee_per_minute := GREATEST(0, ROUND(COALESCE(rate_num, 0)));
    END IF;
  END IF;

  IF COALESCE(OLD.wait_fee_settled, false) THEN
    NEW.wait_fee_settled := true;
    NEW.wait_ended_at := COALESCE(NEW.wait_ended_at, OLD.wait_ended_at);
    NEW.wait_minutes := OLD.wait_minutes;
    NEW.wait_fee_amount := OLD.wait_fee_amount;
    NEW.wait_debt_applied := OLD.wait_debt_applied;
    NEW.wait_prior_debt := OLD.wait_prior_debt;
    RETURN NEW;
  END IF;

  IF OLD.wait_ended_at IS NOT NULL THEN
    NEW.wait_ended_at := OLD.wait_ended_at;
    NEW.wait_minutes := OLD.wait_minutes;
    NEW.wait_fee_amount := OLD.wait_fee_amount;
  END IF;

  should_freeze :=
    NEW.driver_arrived_at IS NOT NULL
    AND NEW.wait_ended_at IS NULL
    AND (
      NEW.status IN ('in_progress', 'completed', 'cancelled')
      OR NEW.pickup_at IS NOT NULL
    );

  IF should_freeze THEN
    NEW := public.trips_apply_wait_freeze(NEW);
  END IF;

  IF NEW.status = 'cancelled'
     AND OLD.status IS DISTINCT FROM 'cancelled'
     AND COALESCE(NEW.wait_fee_amount, 0) > 0
     AND NOT COALESCE(NEW.wait_fee_settled, false) THEN
    phone_canon := public.normalize_wait_phone(NEW.passenger_phone);
    IF phone_canon IS NOT NULL THEN
      INSERT INTO public.passenger_wait_debts (passenger_phone, amount, source_trip_id)
      VALUES (phone_canon, NEW.wait_fee_amount, NEW.id)
      ON CONFLICT (source_trip_id) DO NOTHING;
    END IF;
  END IF;

  IF NEW.status = 'completed'
     AND OLD.status IS DISTINCT FROM 'completed'
     AND NOT COALESCE(NEW.wait_fee_settled, false) THEN
    phone_canon := public.normalize_wait_phone(NEW.passenger_phone);
    IF phone_canon IS NOT NULL THEN
      UPDATE public.passenger_wait_debts d
      SET
        settled_at = timezone('utc', now()),
        settled_trip_id = NEW.id
      WHERE d.settled_at IS NULL
        AND public.normalize_wait_phone(d.passenger_phone) = phone_canon;

      SELECT COALESCE(SUM(d.amount), 0)
      INTO debt_sum
      FROM public.passenger_wait_debts d
      WHERE d.settled_trip_id = NEW.id;
    END IF;

    NEW.wait_debt_applied := COALESCE(debt_sum, 0);
    NEW.price := ROUND(
      COALESCE(NEW.price, 0)::numeric
      + COALESCE(NEW.wait_fee_amount, 0)
      + COALESCE(NEW.wait_debt_applied, 0)
    );
    NEW.wait_fee_settled := true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_wait_fee_biu ON public.trips;
CREATE TRIGGER trips_wait_fee_biu
  BEFORE INSERT OR UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.trips_wait_fee_before();

-- Verificación
SELECT key, value
FROM public.settings
WHERE key = 'passenger_wait_fee_per_minute';

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'trips'
  AND column_name IN (
    'driver_arrived_at',
    'wait_ended_at',
    'wait_fee_per_minute',
    'wait_minutes',
    'wait_fee_amount',
    'wait_prior_debt',
    'wait_debt_applied',
    'wait_fee_settled'
  )
ORDER BY column_name;
