-- =====================================================
-- CHOFERES ASIGNADOS (hasta 3 por propietario)
-- Ejecutar manualmente en Supabase SQL Editor
-- =====================================================

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT,
  ADD COLUMN IF NOT EXISTS auth_email TEXT,
  ADD COLUMN IF NOT EXISTS password_initialized BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_assigned_driver BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS vehicle_operator_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL;

-- Invitaciones pendientes pueden existir sin user_id
ALTER TABLE public.drivers ALTER COLUMN user_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_owner_phone_norm
  ON public.drivers(owner_id, phone_normalized)
  WHERE owner_id IS NOT NULL AND phone_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_drivers_assigned_phone_lookup
  ON public.drivers(phone_normalized)
  WHERE is_assigned_driver = true;

-- ── Normalizar teléfono (Argentina) ───────────────────────────────────────────
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

-- ── Máximo 3 choferes asignados por propietario ───────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_max_assigned_drivers()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NEW.owner_id IS NOT NULL AND COALESCE(NEW.is_assigned_driver, false) THEN
    SELECT COUNT(*) INTO v_count
    FROM public.drivers
    WHERE owner_id = NEW.owner_id
      AND is_assigned_driver = true
      AND id IS DISTINCT FROM NEW.id;

    IF v_count >= 3 THEN
      RAISE EXCEPTION 'Máximo 3 choferes asignados por vehículo';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_max_assigned_drivers ON public.drivers;
CREATE TRIGGER trg_enforce_max_assigned_drivers
  BEFORE INSERT OR UPDATE ON public.drivers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_max_assigned_drivers();

-- ── Lookup pre-login (teléfono → datos mínimos) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.lookup_assigned_driver_login(p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm TEXT;
  v_driver public.drivers%ROWTYPE;
  v_owner public.drivers%ROWTYPE;
BEGIN
  v_norm := public.normalize_driver_phone(p_phone);
  IF v_norm IS NULL OR length(v_norm) < 8 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE is_assigned_driver = true
    AND phone_normalized = v_norm
    AND owner_id IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_owner FROM public.drivers WHERE id = v_driver.owner_id;

  RETURN jsonb_build_object(
    'found', true,
    'driver_id', v_driver.id,
    'full_name', v_driver.full_name,
    'auth_email', v_driver.auth_email,
    'password_initialized', COALESCE(v_driver.password_initialized, false),
    'has_user', v_driver.user_id IS NOT NULL,
    'owner_name', COALESCE(v_owner.full_name, 'Propietario'),
    'vehicle_plate', COALESCE(v_owner.vehicle_plate, v_driver.vehicle_plate)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_assigned_driver_login(TEXT) TO anon, authenticated;

-- ── Vincular user_id tras primer registro ───────────────────────────────────
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

  IF v_driver.user_id IS NOT NULL AND v_driver.user_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Este chofer ya está vinculado a otra cuenta');
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

GRANT EXECUTE ON FUNCTION public.link_assigned_driver_user(UUID) TO authenticated;

-- ── Marcar contraseña inicializada ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_assigned_driver_password_initialized(p_driver_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.drivers
  SET password_initialized = true, updated_at = NOW()
  WHERE id = p_driver_id
    AND user_id = auth.uid()
    AND is_assigned_driver = true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_assigned_driver_password_initialized(UUID) TO authenticated;

-- ── Exclusividad: un solo operador del vehículo a la vez ─────────────────────
CREATE OR REPLACE FUNCTION public.get_fleet_root_id(p_driver_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(d.owner_id, d.id)
  FROM public.drivers d
  WHERE d.id = p_driver_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.set_driver_online_status(p_driver_id UUID, p_online BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver public.drivers%ROWTYPE;
  v_fleet_root_id UUID;
  v_operator_id UUID;
  v_busy UUID;
  v_active_trip UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autenticado');
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id = p_driver_id
    AND user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfil de chofer no encontrado');
  END IF;

  v_fleet_root_id := public.get_fleet_root_id(p_driver_id);

  IF p_online THEN
    SELECT vehicle_operator_id INTO v_operator_id
    FROM public.drivers
    WHERE id = v_fleet_root_id;

    IF v_operator_id IS NOT NULL AND v_operator_id <> p_driver_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'El vehículo ya está en uso por otro chofer. Solo uno puede operarlo a la vez.'
      );
    END IF;

    SELECT d.id INTO v_busy
    FROM public.drivers d
    WHERE (d.id = v_fleet_root_id OR d.owner_id = v_fleet_root_id)
      AND d.is_available = true
      AND d.id <> p_driver_id
    LIMIT 1;

    IF v_busy IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Otro chofer del mismo vehículo ya está en línea.'
      );
    END IF;

    SELECT t.id INTO v_active_trip
    FROM public.trips t
    INNER JOIN public.drivers d ON d.id = t.driver_id
    WHERE (d.id = v_fleet_root_id OR d.owner_id = v_fleet_root_id)
      AND d.id <> p_driver_id
      AND t.status IN ('accepted', 'going_to_pickup', 'in_progress')
    LIMIT 1;

    IF v_active_trip IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Hay un viaje activo con otro chofer de este vehículo.'
      );
    END IF;

    UPDATE public.drivers
    SET is_available = true, updated_at = NOW()
    WHERE id = p_driver_id;

    UPDATE public.drivers
    SET vehicle_operator_id = p_driver_id, updated_at = NOW()
    WHERE id = v_fleet_root_id;

    RETURN jsonb_build_object('success', true, 'is_available', true);
  END IF;

  UPDATE public.drivers
  SET is_available = false, updated_at = NOW()
  WHERE id = p_driver_id;

  UPDATE public.drivers
  SET vehicle_operator_id = NULL, updated_at = NOW()
  WHERE id = v_fleet_root_id
    AND vehicle_operator_id = p_driver_id;

  RETURN jsonb_build_object('success', true, 'is_available', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_driver_online_status(UUID, BOOLEAN) TO authenticated;

-- ── RLS: eliminar choferes asignados (solo el propietario) ───────────────────
DROP POLICY IF EXISTS "driver_or_owner_delete" ON public.drivers;
CREATE POLICY "driver_or_owner_delete"
  ON public.drivers FOR DELETE
  USING (
    is_assigned_driver = true
    AND owner_id = public.get_my_driver_id()
  );

-- ── Migración: corregir auth_email (Supabase rechaza el "+" en el local-part) ─
UPDATE public.drivers
SET auth_email = 'assigned.' || phone_normalized || '@profesional.test'
WHERE is_assigned_driver = true
  AND phone_normalized IS NOT NULL
  AND (
    auth_email IS NULL
    OR auth_email LIKE 'assigned+%@%'
    OR auth_email LIKE '%@drivers.profesional.app'
  );
