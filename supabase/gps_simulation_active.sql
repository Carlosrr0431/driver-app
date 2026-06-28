-- Simulación GPS remota desde el panel (Sim. GPS).
-- Cuando gps_simulation_active = true, la driver-app sigue current_lat/lng de Supabase
-- y no sobrescribe con el GPS del teléfono.

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS gps_simulation_active BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN drivers.gps_simulation_active IS
  'Dev: ubicación controlada desde el dashboard (Sim. GPS). La app del chofer ignora GPS real mientras esté activo.';
