-- =====================================================
-- FIX COMPLETO: Realtime online/offline en dashboard
-- Ejecutar TODO junto en el SQL Editor de Supabase
-- =====================================================

-- 1. Política SELECT para anon en driver_locations
--    (sin esto, Supabase filtra los eventos Realtime para el dashboard)
DROP POLICY IF EXISTS "Dashboard lee ubicaciones" ON public.driver_locations;

CREATE POLICY "Dashboard lee ubicaciones"
  ON public.driver_locations FOR SELECT
  TO anon
  USING (true);

-- 2. Hacer lat/lng nullable para que el upsert de toggle online/offline
--    no falle cuando la app no manda coordenadas
ALTER TABLE public.driver_locations
  ALTER COLUMN lat DROP NOT NULL,
  ALTER COLUMN lng DROP NOT NULL;
