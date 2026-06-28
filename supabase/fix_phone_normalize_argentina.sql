-- =====================================================
-- FIX: normalización de teléfonos móviles argentinos (54 + 9 + área + número)
-- Ejecutar en Supabase SQL Editor
-- =====================================================

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

  IF v_digits LIKE '0%' THEN
    v_digits := substring(v_digits FROM 2);
  END IF;

  IF v_digits LIKE '54%' THEN
    v_rest := substring(v_digits FROM 3);
    IF length(v_rest) = 11 AND v_rest LIKE '9%' THEN
      RETURN '54' || v_rest;
    END IF;
    IF length(v_rest) = 10 THEN
      RETURN '549' || v_rest;
    END IF;
    RETURN v_digits;
  END IF;

  IF length(v_digits) = 11 AND v_digits LIKE '9%' THEN
    RETURN '54' || v_digits;
  END IF;

  IF length(v_digits) = 10 THEN
    RETURN '549' || v_digits;
  END IF;

  IF length(v_digits) < 10 THEN
    v_digits := '54' || v_digits;
    IF length(v_digits) = 12 THEN
      RETURN '549' || substring(v_digits FROM 3);
    END IF;
  END IF;

  RETURN v_digits;
END;
$$;

-- Re-normalizar filas existentes (ej. 543875105250 → 5493875105250)
UPDATE public.drivers d
SET
  phone_normalized = public.normalize_driver_phone(d.phone),
  updated_at = NOW()
WHERE d.phone IS NOT NULL
  AND public.normalize_driver_phone(d.phone) IS NOT NULL
  AND (
    d.phone_normalized IS DISTINCT FROM public.normalize_driver_phone(d.phone)
  );

-- Lookup: aceptar phone_normalized desactualizado comparando también phone crudo
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

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE is_assigned_driver = true
    AND owner_id IS NOT NULL
    AND (
      phone_normalized = v_norm
      OR public.normalize_driver_phone(phone) = v_norm
    )
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

  SELECT COUNT(*) INTO v_owner_count
  FROM public.drivers
  WHERE COALESCE(is_assigned_driver, false) = false
    AND owner_id IS NULL
    AND (
      phone_normalized = v_norm
      OR public.normalize_driver_phone(phone) = v_norm
    );

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
      AND (
        d.phone_normalized = v_norm
        OR public.normalize_driver_phone(d.phone) = v_norm
      );

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
    AND (
      phone_normalized = v_norm
      OR public.normalize_driver_phone(phone) = v_norm
    )
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
    'auth_email', v_driver.auth_email,
    'password_initialized', COALESCE(v_driver.password_initialized, false),
    'has_user', v_driver.user_id IS NOT NULL,
    'vehicle_plate', v_driver.vehicle_plate,
    'driver_number', v_driver.driver_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_driver_phone_login(TEXT, INTEGER) TO anon, authenticated;
