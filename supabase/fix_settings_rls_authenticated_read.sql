-- Los conductores autenticados en driver-app no podían leer settings (solo existía policy para anon).
-- Sin tarifas/comisiones cargadas, la app usaba defaults: $600/km y 10% comisión.
-- Ejecutar manualmente en el editor SQL de Supabase.

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Conductores leen settings" ON public.settings;
CREATE POLICY "Conductores leen settings"
  ON public.settings
  FOR SELECT
  TO authenticated
  USING (true);
