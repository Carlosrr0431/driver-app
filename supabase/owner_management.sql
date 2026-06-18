-- =====================================================
-- MIGRACIÓN: GESTIÓN DE PROPIETARIOS Y CONDUCTORES
-- Permite a un propietario vincular y gestionar varios
-- conductores que manejan sus vehículos.
-- Ejecutar en Supabase Dashboard → SQL Editor
-- =====================================================

-- 1. Agregar columna de rol a drivers
--    'driver'  → conductor estándar (default)
--    'owner'   → propietario que gestiona conductores
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'driver'
  CHECK (role IN ('driver', 'owner'));

-- 2. Agregar columna owner_id para vincular conductor ↔ propietario
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS owner_id UUID
  REFERENCES drivers(id) ON DELETE SET NULL;

-- 3. Índice para búsquedas rápidas por propietario
CREATE INDEX IF NOT EXISTS idx_drivers_owner_id ON drivers(owner_id);
CREATE INDEX IF NOT EXISTS idx_drivers_role ON drivers(role);

-- =====================================================
-- RLS: Actualizar políticas para soportar propietarios
-- =====================================================

-- Drivers: SELECT
-- El conductor ve su propio perfil, y el propietario ve los conductores vinculados.
DROP POLICY IF EXISTS "Chofer ve solo su perfil" ON drivers;
CREATE POLICY "driver_or_owner_select"
  ON drivers FOR SELECT
  USING (
    auth.uid() = user_id
    OR owner_id IN (
      SELECT id FROM drivers WHERE user_id = auth.uid()
    )
  );

-- Drivers: UPDATE
-- El conductor actualiza su propio perfil, el propietario actualiza sus conductores vinculados.
DROP POLICY IF EXISTS "Chofer actualiza solo su perfil" ON drivers;
CREATE POLICY "driver_or_owner_update"
  ON drivers FOR UPDATE
  USING (
    auth.uid() = user_id
    OR owner_id IN (
      SELECT id FROM drivers WHERE user_id = auth.uid()
    )
  );

-- Drivers: INSERT
-- El propietario puede insertar perfiles de conductores vinculados.
-- El propio conductor puede insertar su perfil (alta inicial).
DROP POLICY IF EXISTS "Owner inserts linked drivers" ON drivers;
CREATE POLICY "driver_or_owner_insert"
  ON drivers FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR owner_id IN (
      SELECT id FROM drivers WHERE user_id = auth.uid()
    )
  );

-- Trips: SELECT
-- Extiende la política para que el propietario vea los viajes de sus conductores vinculados.
DROP POLICY IF EXISTS "Chofer ve sus viajes" ON trips;
CREATE POLICY "driver_or_owner_view_trips"
  ON trips FOR SELECT
  USING (
    driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid())
    OR driver_id IN (
      SELECT id FROM drivers
      WHERE owner_id IN (SELECT id FROM drivers WHERE user_id = auth.uid())
    )
  );

-- Commission accumulation log: el propietario puede ver las comisiones de sus conductores
DROP POLICY IF EXISTS "Driver views own commission accumulation" ON commission_accumulation_log;
CREATE POLICY "driver_or_owner_view_commissions"
  ON commission_accumulation_log FOR SELECT
  USING (
    driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid())
    OR driver_id IN (
      SELECT id FROM drivers
      WHERE owner_id IN (SELECT id FROM drivers WHERE user_id = auth.uid())
    )
  );

-- =====================================================
-- FUNCIÓN: Estadísticas de conductor para propietario
-- Retorna totales de viajes y ganancias por período
-- =====================================================
CREATE OR REPLACE FUNCTION get_driver_stats_for_owner(
  p_driver_id UUID,
  p_owner_user_id UUID,
  p_from TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
  p_to   TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  total_trips      BIGINT,
  total_earnings   NUMERIC,
  total_commission NUMERIC,
  completed_trips  BIGINT,
  cancelled_trips  BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verificar que el solicitante es el propietario de este conductor
  IF NOT EXISTS (
    SELECT 1 FROM drivers d
    WHERE d.id = p_driver_id
      AND d.owner_id IN (SELECT id FROM drivers WHERE user_id = p_owner_user_id)
  ) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)                                                    AS total_trips,
    COALESCE(SUM(t.price), 0)                                  AS total_earnings,
    COALESCE(SUM(t.commission_amount), 0)                      AS total_commission,
    COUNT(*) FILTER (WHERE t.status = 'completed')             AS completed_trips,
    COUNT(*) FILTER (WHERE t.status = 'cancelled')             AS cancelled_trips
  FROM trips t
  WHERE t.driver_id = p_driver_id
    AND t.created_at BETWEEN p_from AND p_to;
END;
$$;
