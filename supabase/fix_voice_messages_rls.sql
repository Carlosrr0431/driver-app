-- =====================================================
-- FIX: voice_messages RLS — recursión infinita (500)
--
-- Las políticas actuales hacen:
--   driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid())
-- Esto dispara las políticas RLS de `drivers`, que a su vez
-- consultan `drivers` → recursión infinita → error 500.
--
-- Solución: usar get_my_driver_id() (SECURITY DEFINER, ya existe).
-- Si no existe, ejecutar primero fix_drivers_rls_recursion.sql paso 1.
--
-- INSTRUCCIONES: Ejecutar TODO junto en el SQL Editor de Supabase
-- =====================================================

-- 1. Borrar TODAS las políticas de voice_messages
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'voice_messages'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.voice_messages', pol.policyname);
  END LOOP;
END
$$;

-- 2. Recrear políticas limpias

-- Dashboard (anon)
CREATE POLICY "Dashboard lee mensajes de voz" ON public.voice_messages FOR SELECT TO anon USING (true);
CREATE POLICY "Dashboard envia mensajes de voz" ON public.voice_messages FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Dashboard actualiza mensajes de voz" ON public.voice_messages FOR UPDATE TO anon USING (true);

-- Chofer (authenticated)
CREATE POLICY "Chofer ve sus mensajes de voz"
  ON public.voice_messages FOR SELECT TO authenticated
  USING (driver_id = public.get_my_driver_id());

CREATE POLICY "Chofer envia mensajes de voz"
  ON public.voice_messages FOR INSERT TO authenticated
  WITH CHECK (driver_id = public.get_my_driver_id());

CREATE POLICY "Chofer actualiza mensajes de voz"
  ON public.voice_messages FOR UPDATE TO authenticated
  USING (driver_id = public.get_my_driver_id());
