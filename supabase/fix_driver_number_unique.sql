-- =====================================================
-- FIX: driver_number UNIQUE global (chofer asignado + dueño mismo móvil)
-- Ejecutar SOLO si assigned_drivers.sql falló con:
--   duplicate key value violates unique constraint "drivers_driver_number_key"
-- =====================================================

ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_driver_number_key;

DROP INDEX IF EXISTS idx_drivers_fleet_root_driver_number;
CREATE UNIQUE INDEX idx_drivers_fleet_root_driver_number
  ON public.drivers(driver_number)
  WHERE owner_id IS NULL
    AND COALESCE(is_assigned_driver, false) = false
    AND driver_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_drivers_driver_number
  ON public.drivers(driver_number)
  WHERE driver_number IS NOT NULL;

-- Backfill vehículo/móvil en asignados (reintentar tras quitar UNIQUE global)
UPDATE public.drivers AS ad
SET
  driver_number = o.driver_number,
  vehicle_brand = o.vehicle_brand,
  vehicle_model = o.vehicle_model,
  vehicle_year = o.vehicle_year,
  vehicle_plate = o.vehicle_plate,
  vehicle_color = o.vehicle_color,
  vehicle_photo_url = o.vehicle_photo_url,
  vehicle_type = COALESCE(o.vehicle_type, ad.vehicle_type, 'auto'),
  updated_at = NOW()
FROM public.drivers AS o
WHERE ad.is_assigned_driver = true
  AND ad.owner_id = o.id
  AND (
    ad.driver_number IS DISTINCT FROM o.driver_number
    OR ad.vehicle_plate IS DISTINCT FROM o.vehicle_plate
    OR ad.vehicle_brand IS DISTINCT FROM o.vehicle_brand
    OR ad.vehicle_model IS DISTINCT FROM o.vehicle_model
  );
