-- =====================================================
-- FIX: Infinite recursion in drivers RLS + dashboard anon access
-- Errors: 42P17 recursion, empty data in dashboard
--
-- INSTRUCCIONES: Ejecutar cada bloque por separado en el SQL Editor
-- =====================================================

-- ══════════════════════════════════════════════════
-- PASO 1: Crear función auxiliar SECURITY DEFINER
--         (ejecutar este bloque primero, solo)
-- ══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_my_driver_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT id FROM public.drivers WHERE user_id = auth.uid() LIMIT 1;
$$;

-- ══════════════════════════════════════════════════
-- PASO 2: Borrar políticas recursivas en drivers
--         (ejecutar este bloque por separado)
-- ══════════════════════════════════════════════════
DROP POLICY IF EXISTS "driver_or_owner_select" ON public.drivers;
DROP POLICY IF EXISTS "driver_or_owner_update" ON public.drivers;
DROP POLICY IF EXISTS "driver_or_owner_insert" ON public.drivers;
DROP POLICY IF EXISTS "Chofer ve solo su perfil" ON public.drivers;
DROP POLICY IF EXISTS "Chofer actualiza solo su perfil" ON public.drivers;
DROP POLICY IF EXISTS "Dashboard lee drivers" ON public.drivers;

-- ══════════════════════════════════════════════════
-- PASO 3: Crear políticas en drivers sin recursión
--         (ejecutar este bloque por separado)
-- ══════════════════════════════════════════════════

-- El chofer/owner accede a su perfil y vinculados (sin recursión)
CREATE POLICY "driver_or_owner_select"
  ON public.drivers FOR SELECT
  USING (
    auth.uid() = user_id
    OR owner_id = public.get_my_driver_id()
  );

CREATE POLICY "driver_or_owner_update"
  ON public.drivers FOR UPDATE
  USING (
    auth.uid() = user_id
    OR owner_id = public.get_my_driver_id()
  );

CREATE POLICY "driver_or_owner_insert"
  ON public.drivers FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR owner_id = public.get_my_driver_id()
  );

-- El dashboard (anon) puede leer todos los choferes
CREATE POLICY "Dashboard lee drivers"
  ON public.drivers FOR SELECT
  TO anon
  USING (true);

-- ══════════════════════════════════════════════════
-- PASO 4: Políticas anon para trips (dashboard)
--         (ejecutar este bloque por separado)
-- ══════════════════════════════════════════════════
DROP POLICY IF EXISTS "Dashboard lee viajes" ON public.trips;

CREATE POLICY "Dashboard lee viajes"
  ON public.trips FOR SELECT
  TO anon
  USING (true);
