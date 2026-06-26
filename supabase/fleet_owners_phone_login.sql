-- =====================================================
-- DUEÑOS DE FLOTA: login por teléfono + alta masiva 2026
-- Ejecutar manualmente en Supabase SQL Editor (después de assigned_drivers.sql)
-- =====================================================

-- Dependencia de assigned_drivers.sql
CREATE OR REPLACE FUNCTION public.normalize_driver_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits TEXT;
BEGIN
  v_digits := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF v_digits = '' THEN
    RETURN NULL;
  END IF;
  IF v_digits LIKE '0%' THEN
    v_digits := substring(v_digits FROM 2);
  END IF;
  IF length(v_digits) <= 10 AND v_digits NOT LIKE '54%' THEN
    v_digits := '54' || v_digits;
  END IF;
  RETURN v_digits;
END;
$$;

-- Columnas ya agregadas en assigned_drivers.sql; asegurar defaults para dueños nuevos
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT,
  ADD COLUMN IF NOT EXISTS auth_email TEXT,
  ADD COLUMN IF NOT EXISTS password_initialized BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_assigned_driver BOOLEAN DEFAULT false;

-- Índice de búsqueda (sin UNIQUE: el PDF tiene teléfonos repetidos entre titulares)
CREATE INDEX IF NOT EXISTS idx_drivers_fleet_owner_phone_lookup
  ON public.drivers(phone_normalized)
  WHERE owner_id IS NULL
    AND COALESCE(is_assigned_driver, false) = false
    AND phone_normalized IS NOT NULL;

-- UNIQUE solo entre titulares (asignados pueden compartir móvil con el dueño)
ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_driver_number_key;

DROP INDEX IF EXISTS idx_drivers_fleet_root_driver_number;
CREATE UNIQUE INDEX idx_drivers_fleet_root_driver_number
  ON public.drivers(driver_number)
  WHERE owner_id IS NULL
    AND COALESCE(is_assigned_driver, false) = false
    AND driver_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.build_owner_auth_email(p_phone_normalized TEXT, p_driver_number INTEGER DEFAULT NULL)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_driver_number IS NOT NULL THEN
      'owner.' || p_driver_number::TEXT || '@profesional.test'
    ELSE
      'owner.' || p_phone_normalized || '@profesional.test'
  END;
$$;

-- ── Lookup unificado: dueño de flota o chofer asignado ───────────────────────
CREATE OR REPLACE FUNCTION public.lookup_driver_phone_login(
  p_phone TEXT,
  p_driver_number INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm TEXT;
  v_driver public.drivers%ROWTYPE;
  v_owner public.drivers%ROWTYPE;
  v_owner_count INTEGER;
  v_choices JSONB;
BEGIN
  v_norm := public.normalize_driver_phone(p_phone);
  IF v_norm IS NULL OR length(v_norm) < 8 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  -- 1) Chofer asignado (mismo flujo que antes)
  SELECT * INTO v_driver
  FROM public.drivers
  WHERE is_assigned_driver = true
    AND phone_normalized = v_norm
    AND owner_id IS NOT NULL
    AND (p_driver_number IS NULL OR driver_number = p_driver_number)
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    SELECT * INTO v_owner FROM public.drivers WHERE id = v_driver.owner_id;
    RETURN jsonb_build_object(
      'found', true,
      'login_kind', 'assigned',
      'driver_id', v_driver.id,
      'full_name', v_driver.full_name,
      'auth_email', v_driver.auth_email,
      'password_initialized', COALESCE(v_driver.password_initialized, false),
      'has_user', v_driver.user_id IS NOT NULL,
      'owner_name', COALESCE(v_owner.full_name, 'Propietario'),
      'vehicle_plate', COALESCE(v_owner.vehicle_plate, v_driver.vehicle_plate),
      'driver_number', COALESCE(v_driver.driver_number, v_owner.driver_number)
    );
  END IF;

  -- 2) Dueño / titular del móvil (raíz de flota)
  SELECT COUNT(*) INTO v_owner_count
  FROM public.drivers
  WHERE COALESCE(is_assigned_driver, false) = false
    AND owner_id IS NULL
    AND phone_normalized = v_norm;

  IF v_owner_count = 0 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF v_owner_count > 1 AND p_driver_number IS NULL THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'driver_number', d.driver_number,
        'full_name', d.full_name,
        'vehicle_plate', d.vehicle_plate
      )
      ORDER BY d.driver_number
    ), '[]'::jsonb)
    INTO v_choices
    FROM public.drivers d
    WHERE COALESCE(d.is_assigned_driver, false) = false
      AND d.owner_id IS NULL
      AND d.phone_normalized = v_norm;

    RETURN jsonb_build_object(
      'found', false,
      'needs_driver_number', true,
      'choices', v_choices
    );
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE COALESCE(is_assigned_driver, false) = false
    AND owner_id IS NULL
    AND phone_normalized = v_norm
    AND (p_driver_number IS NULL OR driver_number = p_driver_number)
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'login_kind', 'owner',
    'driver_id', v_driver.id,
    'full_name', v_driver.full_name,
    'auth_email', COALESCE(
      v_driver.auth_email,
      public.build_owner_auth_email(v_norm, v_driver.driver_number)
    ),
    'password_initialized', COALESCE(v_driver.password_initialized, false),
    'has_user', v_driver.user_id IS NOT NULL,
    'owner_name', v_driver.full_name,
    'vehicle_plate', v_driver.vehicle_plate,
    'driver_number', v_driver.driver_number
  );
END;
$$;

-- Firma completa (text, integer): el GRANT con solo (text) falla y revierte todo el script
GRANT EXECUTE ON FUNCTION public.lookup_driver_phone_login(TEXT, INTEGER) TO anon, authenticated;

-- Compatibilidad: RPC anterior delega al unificado
DROP FUNCTION IF EXISTS public.lookup_assigned_driver_login(TEXT);
CREATE OR REPLACE FUNCTION public.lookup_assigned_driver_login(p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  v_result := public.lookup_driver_phone_login(p_phone, NULL);
  IF COALESCE(v_result->>'found', 'false') = 'true'
     AND v_result->>'login_kind' = 'assigned' THEN
    RETURN v_result;
  END IF;
  RETURN jsonb_build_object('found', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_assigned_driver_login(TEXT) TO anon, authenticated;

-- ── Vincular user_id tras primer registro (dueño o asignado) ─────────────────
CREATE OR REPLACE FUNCTION public.link_driver_phone_user(p_driver_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver public.drivers%ROWTYPE;
BEGIN
  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id = p_driver_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Chofer no encontrado');
  END IF;

  IF v_driver.is_assigned_driver AND v_driver.owner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Chofer asignado inválido');
  END IF;

  IF v_driver.user_id IS NOT NULL AND v_driver.user_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Este perfil ya está vinculado a otra cuenta');
  END IF;

  UPDATE public.drivers
  SET
    user_id = auth.uid(),
    password_initialized = true,
    updated_at = NOW()
  WHERE id = p_driver_id;

  RETURN jsonb_build_object('success', true, 'driver_id', p_driver_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_driver_phone_user(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.link_assigned_driver_user(p_driver_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver public.drivers%ROWTYPE;
BEGIN
  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id = p_driver_id
    AND is_assigned_driver = true
    AND owner_id IS NOT NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Chofer asignado no encontrado');
  END IF;

  RETURN public.link_driver_phone_user(p_driver_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_assigned_driver_user(UUID) TO authenticated;

-- ── Alta masiva: LISTADO DE AUTOS 2026 (hojas 1-2 + 3-4 unificadas por orden) ─
-- Upsert sin ON CONFLICT (compatible con índice UNIQUE parcial en Supabase/PG)

WITH fleet_seed (
  full_name,
  phone,
  phone_normalized,
  auth_email,
  driver_number,
  vehicle_brand,
  vehicle_model,
  vehicle_plate,
  vehicle_color
) AS (
  VALUES
    ('SOTO JUAN RICARDO', '+5493874128357', '543874128357', public.build_owner_auth_email('543874128357', 2), 2, 'Fiat', 'Cronos', 'AF793GJ', 'Blanco'),
    ('ORTEGA OLIVIA GABRIELA', '+5493872204587', '543872204587', public.build_owner_auth_email('543872204587', 3), 3, 'Fiat', 'Cronos', 'AG334QS', 'Gris plata'),
    ('JUAN YAÑEZ', '+549387519169', '54387519169', public.build_owner_auth_email('54387519169', 5), 5, 'Fiat', 'Cronos', 'AH112KH', 'Blanco'),
    ('FRIAS NORMA GRACIELA', '+5493873639899', '543873639899', public.build_owner_auth_email('543873639899', 10), 10, 'Fiat', 'Cronos', 'AH068JO', 'Gris plata'),
    ('ALVAREZ MARCELA FERNANDA', '+5493875391985', '543875391985', public.build_owner_auth_email('543875391985', 11), 11, 'Fiat', 'Cronos', 'AG829WT', 'Negro'),
    ('SERGIO JAIRO YURQUINA', '+5493875388397', '543875388397', public.build_owner_auth_email('543875388397', 13), 13, 'Fiat', 'Cronos', 'AG458LF', 'Gris plata'),
    ('LOTO PABLO NICOLAS', '+5493875780025', '543875780025', public.build_owner_auth_email('543875780025', 14), 14, 'Fiat', 'Cronos', 'AG752CR', 'Gris plata'),
    ('CRUZ CRISTIAN ALFREDO', '+5493875638266', '543875638266', public.build_owner_auth_email('543875638266', 17), 17, 'Fiat', 'Cronos', 'AD842XE', 'Blanco'),
    ('VELA ALEXIS NAHUEL', '+5493874883302', '543874883302', public.build_owner_auth_email('543874883302', 18), 18, 'Renault', 'Logan', 'AF943MH', 'Blanco'),
    ('CRESPO MARTINEZ', '+5493874680952', '543874680952', public.build_owner_auth_email('543874680952', 19), 19, 'Volkswagen', 'Polo Track', 'AH455NH', 'Gris oscuro'),
    ('CARDOZO YANES JUAN GABRIEL', '+5493874658565', '543874658565', public.build_owner_auth_email('543874658565', 22), 22, 'Fiat', 'Cronos', 'AG496OT', 'Negro'),
    ('PEDRO HERRERA', '+5493874561711', '543874561711', public.build_owner_auth_email('543874561711', 28), 28, 'Fiat', 'Cronos', 'AI108GU', 'Gris plata'),
    ('RIOS MARTIN FEDERICO', '+5493874131924', '543874131924', public.build_owner_auth_email('543874131924', 31), 31, 'Volkswagen', 'Voyage', 'AB197BY', 'Gris oscuro'),
    ('LESCANO ADRIANA SOLEDAD', '+5493874046740', '543874046740', public.build_owner_auth_email('543874046740', 32), 32, 'Volkswagen', 'Polo Track', 'AC628PE', 'Gris oscuro'),
    ('GALARZA NELSON EMANUEL', '+5493874876330', '543874876330', public.build_owner_auth_email('543874876330', 33), 33, 'Fiat', 'Cronos', 'AH030IG', 'Gris plata'),
    ('ARAMAYO NICOLAS JOSE', '+5493875893712', '543875893712', public.build_owner_auth_email('543875893712', 47), 47, 'Fiat', 'Cronos', 'AC739QQ', 'Blanco'),
    ('HOYOS SILVIA GABRIELA', '+5493875638266', '543875638266', public.build_owner_auth_email('543875638266', 48), 48, 'Fiat', 'Cronos', 'AD566OM', 'Gris oscuro'),
    ('DIAZ MARCIO ALEJANDRO', '+5493876035255', '543876035255', public.build_owner_auth_email('543876035255', 49), 49, 'Renault', 'Logan', 'AF566IQ', 'Gris plata'),
    ('DIAZ ARMANDO DANIEL', '+549387519169', '54387519169', public.build_owner_auth_email('54387519169', 50), 50, 'Fiat', 'Cronos', 'AH161DK', 'Gris oscuro'),
    ('CARDOZO YANES JUAN GABRIEL', '+549387519169', '54387519169', public.build_owner_auth_email('54387519169', 55), 55, 'Fiat', 'Cronos', 'AF834SC', 'Gris oscuro'),
    ('LESCANO ANTONIO FEDERICO', '+5493874131924', '543874131924', public.build_owner_auth_email('543874131924', 56), 56, 'Fiat', 'Cronos', 'AG438IR', 'Blanco'),
    ('REYES AIXA BARBARA', '+5491152207592', '541152207592', public.build_owner_auth_email('541152207592', 61), 61, 'Renault', 'Logan', 'AG213CX', 'Gris oscuro'),
    ('ANDRES VICTOR', '+5493874475059', '543874475059', public.build_owner_auth_email('543874475059', 6), 6, 'Volkswagen', 'Polo', 'AH643RB', 'Gris oscuro')
),
updated AS (
  UPDATE public.drivers AS d
  SET
    full_name = s.full_name,
    phone = s.phone,
    phone_normalized = s.phone_normalized,
    auth_email = s.auth_email,
    role = 'owner',
    vehicle_brand = s.vehicle_brand,
    vehicle_model = s.vehicle_model,
    vehicle_plate = s.vehicle_plate,
    vehicle_color = s.vehicle_color,
    updated_at = NOW()
  FROM fleet_seed AS s
  WHERE d.driver_number = s.driver_number
    AND d.owner_id IS NULL
    AND COALESCE(d.is_assigned_driver, false) = false
  RETURNING d.driver_number
)
INSERT INTO public.drivers (
  full_name,
  phone,
  phone_normalized,
  auth_email,
  role,
  owner_id,
  is_assigned_driver,
  password_initialized,
  user_id,
  driver_number,
  vehicle_brand,
  vehicle_model,
  vehicle_plate,
  vehicle_color,
  vehicle_type,
  is_available,
  rating,
  total_trips,
  total_km
)
SELECT
  s.full_name,
  s.phone,
  s.phone_normalized,
  s.auth_email,
  'owner',
  NULL,
  false,
  false,
  NULL,
  s.driver_number,
  s.vehicle_brand,
  s.vehicle_model,
  s.vehicle_plate,
  s.vehicle_color,
  'auto',
  false,
  5.0,
  0,
  0
FROM fleet_seed AS s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.drivers AS d
  WHERE d.driver_number = s.driver_number
    AND d.owner_id IS NULL
    AND COALESCE(d.is_assigned_driver, false) = false
);

-- Backfill auth_email / phone_normalized en dueños existentes sin cuenta Auth
UPDATE public.drivers d
SET
  phone_normalized = COALESCE(d.phone_normalized, public.normalize_driver_phone(d.phone)),
  auth_email = COALESCE(
    d.auth_email,
    CASE
      WHEN COALESCE(d.is_assigned_driver, false) THEN
        'assigned.' || public.normalize_driver_phone(d.phone) || '@profesional.test'
      ELSE
        public.build_owner_auth_email(public.normalize_driver_phone(d.phone), d.driver_number)
    END
  ),
  password_initialized = COALESCE(d.password_initialized, d.user_id IS NOT NULL)
WHERE d.phone IS NOT NULL
  AND public.normalize_driver_phone(d.phone) IS NOT NULL;
