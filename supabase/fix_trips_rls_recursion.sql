-- =====================================================
-- FIX: Recursión infinita en RLS de trips y tablas relacionadas
--
-- Las políticas de trips, trip_tracking, dispatcher_messages,
-- commission_payments, commission_accumulation_log y driver_locations
-- hacen subqueries a `drivers` que disparan las políticas RLS de
-- `drivers` → recursión infinita → error 500.
--
-- Solución: usar get_my_driver_id() (SECURITY DEFINER, ya existe).
-- Si no existe, ejecutar primero fix_drivers_rls_recursion.sql paso 1.
--
-- INSTRUCCIONES:
-- 1. Primero ejecutar el PASO 0 para ver qué políticas existen
-- 2. Luego ejecutar el resto todo junto
-- =====================================================

-- ══════════════════════════════════════════════════
-- PASO 0: Diagnóstico — ejecutar esto primero para ver políticas actuales
-- (solo lectura, no modifica nada)
-- ══════════════════════════════════════════════════
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'trips'
-- ORDER BY policyname;

-- ══════════════════════════════════════════════════
-- TRIPS — borrar TODAS las políticas y recrear limpio
-- ══════════════════════════════════════════════════
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trips'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.trips', pol.policyname);
  END LOOP;
END
$$;

-- Dashboard (anon) — acceso total
CREATE POLICY "Dashboard lee viajes"
  ON public.trips FOR SELECT TO anon USING (true);

CREATE POLICY "Dashboard inserta viajes"
  ON public.trips FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Dashboard actualiza viajes"
  ON public.trips FOR UPDATE TO anon USING (true);

-- Chofer autenticado — ve y actualiza sus viajes y los de sus vinculados
CREATE POLICY "driver_or_owner_view_trips"
  ON public.trips FOR SELECT TO authenticated
  USING (
    driver_id = public.get_my_driver_id()
    OR driver_id IN (
      SELECT id FROM public.drivers WHERE owner_id = public.get_my_driver_id()
    )
  );

CREATE POLICY "Chofer actualiza sus viajes"
  ON public.trips FOR UPDATE TO authenticated
  USING (
    driver_id = public.get_my_driver_id()
    OR driver_id IN (
      SELECT id FROM public.drivers WHERE owner_id = public.get_my_driver_id()
    )
  )
  WITH CHECK (
    driver_id = public.get_my_driver_id()
    OR driver_id IN (
      SELECT id FROM public.drivers WHERE owner_id = public.get_my_driver_id()
    )
    OR (
      driver_id IS NULL
      AND status IN ('queued', 'cancelled')
    )
  );

-- ══════════════════════════════════════════════════
-- TRIP_TRACKING — borrar todo y recrear
-- ══════════════════════════════════════════════════
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trip_tracking'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.trip_tracking', pol.policyname);
  END LOOP;
END
$$;

CREATE POLICY "Dashboard lee tracking" ON public.trip_tracking FOR SELECT TO anon USING (true);

CREATE POLICY "Chofer inserta su tracking"
  ON public.trip_tracking FOR INSERT TO authenticated
  WITH CHECK (driver_id = public.get_my_driver_id());

CREATE POLICY "Chofer ve su tracking"
  ON public.trip_tracking FOR SELECT TO authenticated
  USING (driver_id = public.get_my_driver_id());

-- ══════════════════════════════════════════════════
-- DISPATCHER_MESSAGES — borrar todo y recrear
-- ══════════════════════════════════════════════════
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dispatcher_messages'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.dispatcher_messages', pol.policyname);
  END LOOP;
END
$$;

CREATE POLICY "Dashboard lee mensajes dispatcher" ON public.dispatcher_messages FOR SELECT TO anon USING (true);
CREATE POLICY "Dashboard inserta mensajes dispatcher" ON public.dispatcher_messages FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Chofer ve sus mensajes"
  ON public.dispatcher_messages FOR SELECT TO authenticated
  USING (driver_id = public.get_my_driver_id());

CREATE POLICY "Chofer marca mensajes como leídos"
  ON public.dispatcher_messages FOR UPDATE TO authenticated
  USING (driver_id = public.get_my_driver_id());

-- ══════════════════════════════════════════════════
-- COMMISSION_PAYMENTS — borrar todo y recrear
-- ══════════════════════════════════════════════════
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'commission_payments'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.commission_payments', pol.policyname);
  END LOOP;
END
$$;

CREATE POLICY "Dashboard inserta pagos" ON public.commission_payments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Dashboard lee pagos" ON public.commission_payments FOR SELECT TO anon USING (true);

CREATE POLICY "Chofer ve sus pagos de comisión"
  ON public.commission_payments FOR SELECT TO authenticated
  USING (
    driver_id = public.get_my_driver_id()
    OR driver_id IN (
      SELECT id FROM public.drivers WHERE owner_id = public.get_my_driver_id()
    )
  );

-- ══════════════════════════════════════════════════
-- COMMISSION_ACCUMULATION_LOG — borrar todo y recrear
-- ══════════════════════════════════════════════════
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'commission_accumulation_log'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.commission_accumulation_log', pol.policyname);
  END LOOP;
END
$$;

CREATE POLICY "Dashboard views all commission accumulations"
  ON public.commission_accumulation_log FOR SELECT TO anon USING (true);

CREATE POLICY "driver_or_owner_view_commissions"
  ON public.commission_accumulation_log FOR SELECT TO authenticated
  USING (
    driver_id = public.get_my_driver_id()
    OR driver_id IN (
      SELECT id FROM public.drivers WHERE owner_id = public.get_my_driver_id()
    )
  );

CREATE POLICY "Driver inserts own commission accumulation"
  ON public.commission_accumulation_log FOR INSERT TO authenticated
  WITH CHECK (driver_id = public.get_my_driver_id());

-- ══════════════════════════════════════════════════
-- DRIVER_LOCATIONS — borrar todo y recrear
-- ══════════════════════════════════════════════════
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'driver_locations'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.driver_locations', pol.policyname);
  END LOOP;
END
$$;

CREATE POLICY "Dashboard lee ubicaciones"
  ON public.driver_locations FOR SELECT TO anon USING (true);

CREATE POLICY "Chofer upsert su ubicación"
  ON public.driver_locations FOR INSERT TO authenticated
  WITH CHECK (driver_id = public.get_my_driver_id());

CREATE POLICY "Chofer actualiza su ubicación"
  ON public.driver_locations FOR UPDATE TO authenticated
  USING (driver_id = public.get_my_driver_id());

CREATE POLICY "Chofer ve su ubicación"
  ON public.driver_locations FOR SELECT TO authenticated
  USING (driver_id = public.get_my_driver_id());
