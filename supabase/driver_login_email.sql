-- =====================================================
-- Login de chofer por correo (clave distinta a la del teléfono)
-- Ejecutar manualmente en el SQL Editor de Supabase.
--
-- Cada chofer puede tener DOS cuentas Auth:
--   user_id            → ingreso con teléfono  (email sintético @profesional.test)
--   email_user_id      → ingreso con correo personal
-- Las contraseñas NO se comparten.
-- =====================================================

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS login_email TEXT,
  ADD COLUMN IF NOT EXISTS email_user_id UUID,
  ADD COLUMN IF NOT EXISTS email_password_initialized BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  ALTER TABLE public.drivers
    ADD CONSTRAINT drivers_email_user_id_fkey
    FOREIGN KEY (email_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.drivers
    ADD CONSTRAINT drivers_login_email_not_synthetic
    CHECK (
      login_email IS NULL
      OR btrim(login_email) = ''
      OR login_email NOT ILIKE '%@profesional.test'
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.drivers
    ADD CONSTRAINT drivers_email_user_distinct_from_phone
    CHECK (email_user_id IS NULL OR user_id IS NULL OR email_user_id <> user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS drivers_login_email_lower_uidx
  ON public.drivers (lower(login_email))
  WHERE login_email IS NOT NULL AND btrim(login_email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS drivers_email_user_id_uidx
  ON public.drivers (email_user_id)
  WHERE email_user_id IS NOT NULL;

COMMENT ON COLUMN public.drivers.login_email IS
  'Correo personal para ingresar a la app. Distinto del auth_email sintético del teléfono.';
COMMENT ON COLUMN public.drivers.email_user_id IS
  'auth.users.id de la cuenta de correo. Distinto de user_id (teléfono).';
COMMENT ON COLUMN public.drivers.email_password_initialized IS
  'true cuando el chofer ya tiene contraseña de correo.';

-- El chofer logueado por teléfono O por correo resuelve su fila
CREATE OR REPLACE FUNCTION public.get_my_driver_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.drivers
  WHERE user_id = auth.uid()
     OR email_user_id = auth.uid()
  ORDER BY CASE WHEN user_id = auth.uid() THEN 0 ELSE 1 END
  LIMIT 1;
$$;

DROP POLICY IF EXISTS "driver_or_owner_select" ON public.drivers;
CREATE POLICY "driver_or_owner_select"
  ON public.drivers FOR SELECT
  USING (
    auth.uid() = user_id
    OR auth.uid() = email_user_id
    OR owner_id = public.get_my_driver_id()
  );

DROP POLICY IF EXISTS "driver_or_owner_update" ON public.drivers;
CREATE POLICY "driver_or_owner_update"
  ON public.drivers FOR UPDATE
  USING (
    auth.uid() = user_id
    OR auth.uid() = email_user_id
    OR owner_id = public.get_my_driver_id()
  );

DROP POLICY IF EXISTS "driver_or_owner_insert" ON public.drivers;
CREATE POLICY "driver_or_owner_insert"
  ON public.drivers FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR auth.uid() = email_user_id
    OR owner_id = public.get_my_driver_id()
  );

CREATE OR REPLACE FUNCTION public.lookup_driver_email_login(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_driver public.drivers%ROWTYPE;
  v_owner public.drivers%ROWTYPE;
  v_kind TEXT;
BEGIN
  v_email := lower(btrim(COALESCE(p_email, '')));
  IF v_email = '' OR v_email NOT LIKE '%_@_%.__%' OR v_email LIKE '%@profesional.test' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE login_email IS NOT NULL
    AND lower(btrim(login_email)) = v_email
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  IF COALESCE(v_driver.is_assigned_driver, false) = true AND v_driver.owner_id IS NOT NULL THEN
    v_kind := 'assigned';
    SELECT * INTO v_owner FROM public.drivers WHERE id = v_driver.owner_id;
  ELSE
    v_kind := 'owner';
    v_owner := v_driver;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'login_channel', 'email',
    'login_kind', v_kind,
    'driver_id', v_driver.id,
    'full_name', v_driver.full_name,
    'login_email', v_email,
    'auth_email', v_email,
    'password_initialized', COALESCE(v_driver.email_password_initialized, false),
    'has_user', v_driver.email_user_id IS NOT NULL,
    'owner_name', COALESCE(v_owner.full_name, v_driver.full_name),
    'vehicle_plate', COALESCE(v_owner.vehicle_plate, v_driver.vehicle_plate),
    'driver_number', COALESCE(v_driver.driver_number, v_owner.driver_number)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_driver_email_login(TEXT) TO anon, authenticated;
