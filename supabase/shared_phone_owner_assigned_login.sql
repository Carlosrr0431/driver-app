-- =====================================================
-- Mismo teléfono: login como propietario O chofer asignado
-- Ejecutar manualmente en Supabase SQL Editor
--
-- lookup_driver_phone_login(..., p_login_kind):
--   'owner'    → solo titular
--   'assigned' → solo chofer asignado
--   NULL       → compat: asignado primero, luego titular
--
-- Match de teléfono: acepta phone / phone_normalized en cualquier
-- formato AR (387..., 9..., 54..., 549..., con espacios/guiones).
-- =====================================================

DROP FUNCTION IF EXISTS public.lookup_assigned_driver_login(TEXT);
DROP FUNCTION IF EXISTS public.lookup_assigned_driver_login(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.lookup_driver_phone_login(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.lookup_driver_phone_login(TEXT, INTEGER, TEXT);

-- Normalización canónica (siempre 549XXXXXXXXXX para móviles AR)
CREATE OR REPLACE FUNCTION public.normalize_driver_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits TEXT;
  v_rest TEXT;
BEGIN
  v_digits := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF v_digits = '' THEN
    RETURN NULL;
  END IF;

  -- Quitar ceros a la izquierda (0387... → 387...)
  v_digits := regexp_replace(v_digits, '^0+', '');
  IF v_digits = '' THEN
    RETURN NULL;
  END IF;

  IF v_digits LIKE '54%' THEN
    v_rest := substring(v_digits FROM 3);
    -- 549XXXXXXXXXX ya canónico
    IF length(v_rest) = 11 AND v_rest LIKE '9%' THEN
      RETURN v_digits;
    END IF;
    -- 54 + 10 dígitos locales → insertar 9 de móvil
    IF length(v_rest) = 10 THEN
      RETURN '549' || v_rest;
    END IF;
    -- 54 + 9XXXXXXXXX (11 con 9 pero mal armado) ya cubierto arriba
    RETURN v_digits;
  END IF;

  -- 9XXXXXXXXXX (11 dígitos con 9 de móvil)
  IF length(v_digits) = 11 AND v_digits LIKE '9%' THEN
    RETURN '54' || v_digits;
  END IF;

  -- 10 dígitos locales (3878630173)
  IF length(v_digits) = 10 THEN
    RETURN '549' || v_digits;
  END IF;

  -- Menos de 10: intentar como local incompleto con prefijo 54
  IF length(v_digits) < 10 THEN
    v_digits := '54' || v_digits;
    v_rest := substring(v_digits FROM 3);
    IF length(v_rest) = 10 THEN
      RETURN '549' || v_rest;
    END IF;
  END IF;

  RETURN v_digits;
END;
$$;

-- Compara input normalizado contra phone / phone_normalized en cualquier formato
CREATE OR REPLACE FUNCTION public.driver_phone_matches(p_norm TEXT, p_phone TEXT, p_phone_normalized TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_stored TEXT;
  v_input_local TEXT;
BEGIN
  IF p_norm IS NULL OR length(p_norm) < 8 THEN
    RETURN false;
  END IF;

  IF p_phone_normalized IS NOT NULL AND p_phone_normalized = p_norm THEN
    RETURN true;
  END IF;

  v_stored := public.normalize_driver_phone(p_phone_normalized);
  IF v_stored IS NOT NULL AND v_stored = p_norm THEN
    RETURN true;
  END IF;

  v_stored := public.normalize_driver_phone(p_phone);
  IF v_stored IS NOT NULL AND v_stored = p_norm THEN
    RETURN true;
  END IF;

  -- Fallback: últimos 10 dígitos (número local sin país/9)
  v_input_local := right(regexp_replace(p_norm, '\D', '', 'g'), 10);
  IF length(v_input_local) = 10 THEN
    IF p_phone_normalized IS NOT NULL
       AND right(regexp_replace(p_phone_normalized, '\D', '', 'g'), 10) = v_input_local THEN
      RETURN true;
    END IF;
    IF p_phone IS NOT NULL
       AND right(regexp_replace(p_phone, '\D', '', 'g'), 10) = v_input_local THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.lookup_driver_phone_login(
  p_phone TEXT,
  p_driver_number INTEGER DEFAULT NULL,
  p_login_kind TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm TEXT;
  v_kind TEXT;
  v_driver public.drivers%ROWTYPE;
  v_owner public.drivers%ROWTYPE;
  v_owner_count INTEGER;
  v_choices JSONB;
BEGIN
  v_norm := public.normalize_driver_phone(p_phone);
  IF v_norm IS NULL OR length(v_norm) < 8 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_kind := lower(trim(COALESCE(p_login_kind, '')));
  IF v_kind NOT IN ('owner', 'assigned') THEN
    v_kind := NULL;
  END IF;

  -- ── Chofer asignado ────────────────────────────────────────────────────────
  IF v_kind IS NULL OR v_kind = 'assigned' THEN
    SELECT * INTO v_driver
    FROM public.drivers
    WHERE is_assigned_driver = true
      AND owner_id IS NOT NULL
      AND public.driver_phone_matches(v_norm, phone, phone_normalized)
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

    IF v_kind = 'assigned' THEN
      RETURN jsonb_build_object('found', false);
    END IF;
  END IF;

  -- ── Propietario / titular del móvil ───────────────────────────────────────
  IF v_kind IS NULL OR v_kind = 'owner' THEN
    SELECT COUNT(*) INTO v_owner_count
    FROM public.drivers
    WHERE COALESCE(is_assigned_driver, false) = false
      AND owner_id IS NULL
      AND public.driver_phone_matches(v_norm, phone, phone_normalized);

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
        AND public.driver_phone_matches(v_norm, d.phone, d.phone_normalized);

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
      AND public.driver_phone_matches(v_norm, phone, phone_normalized)
      AND (p_driver_number IS NULL OR driver_number = p_driver_number)
    ORDER BY driver_number NULLS LAST, created_at DESC
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
  END IF;

  RETURN jsonb_build_object('found', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_driver_phone_login(TEXT, INTEGER, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.lookup_assigned_driver_login(
  p_phone TEXT,
  p_driver_number INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  v_result := public.lookup_driver_phone_login(p_phone, p_driver_number, 'assigned');
  IF COALESCE(v_result->>'found', 'false') = 'true'
     AND v_result->>'login_kind' = 'assigned' THEN
    RETURN v_result;
  END IF;
  RETURN jsonb_build_object('found', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_assigned_driver_login(TEXT, INTEGER) TO anon, authenticated;
