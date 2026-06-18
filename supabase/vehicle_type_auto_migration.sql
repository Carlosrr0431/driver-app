-- =====================================================
-- MIGRACION RAPIDA: FORZAR VEHICULO A AUTO
-- Objetivo:
-- 1) Actualizar historicos en drivers con vehicle_type = 'moto' a 'auto'
-- 2) Actualizar fallback legacy en settings: vehicle_type_<driver_id>
-- 3) Dejar trazabilidad de cuantos registros se actualizaron
-- =====================================================

BEGIN;

-- 1) Drivers: si existe la columna vehicle_type, pasar motos a auto
DO $$
DECLARE
  updated_drivers_count INTEGER := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'drivers'
      AND column_name = 'vehicle_type'
  ) THEN
    UPDATE public.drivers
    SET vehicle_type = 'auto'
    WHERE lower(trim(coalesce(vehicle_type, ''))) IN ('moto', 'motorbike', 'motocicleta');

    GET DIAGNOSTICS updated_drivers_count = ROW_COUNT;
    RAISE NOTICE 'Drivers actualizados a auto: %', updated_drivers_count;
  ELSE
    RAISE NOTICE 'Columna public.drivers.vehicle_type no existe. Se omite update de drivers.';
  END IF;
END $$;

-- 2) Settings fallback legacy: vehicle_type_<driver_id>
UPDATE public.settings
SET value = 'auto', updated_at = NOW()
WHERE key LIKE 'vehicle_type_%'
  AND lower(trim(coalesce(value, ''))) IN ('moto', 'motorbike', 'motocicleta');

-- 3) Garantizar key global (opcional de referencia)
INSERT INTO public.settings (key, value)
VALUES ('vehicle_type_default', 'auto')
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

COMMIT;

-- Verificacion rapida (ejecutar despues de la migracion)
-- SELECT id, full_name, vehicle_type FROM public.drivers WHERE lower(trim(coalesce(vehicle_type, ''))) <> 'auto';
-- SELECT key, value FROM public.settings WHERE key LIKE 'vehicle_type_%' ORDER BY key;
