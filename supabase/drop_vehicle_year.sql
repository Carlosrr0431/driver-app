-- Elimina vehicle_year de public.drivers y actualiza triggers de sincronización.
-- Ejecutar manualmente en el editor SQL de Supabase.

-- ── 1. Trigger: dueño → choferes asignados (sin vehicle_year) ────────────────
CREATE OR REPLACE FUNCTION public.sync_assigned_drivers_from_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.is_assigned_driver, false) = false AND NEW.owner_id IS NULL THEN
    UPDATE public.drivers
    SET
      driver_number = NEW.driver_number,
      vehicle_brand = NEW.vehicle_brand,
      vehicle_model = NEW.vehicle_model,
      vehicle_plate = NEW.vehicle_plate,
      vehicle_color = NEW.vehicle_color,
      vehicle_photo_url = NEW.vehicle_photo_url,
      vehicle_type = COALESCE(NEW.vehicle_type, vehicle_type, 'auto'),
      updated_at = NOW()
    WHERE owner_id = NEW.id
      AND is_assigned_driver = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_assigned_drivers_from_owner ON public.drivers;
CREATE TRIGGER trg_sync_assigned_drivers_from_owner
  AFTER UPDATE OF driver_number, vehicle_brand, vehicle_model,
    vehicle_plate, vehicle_color, vehicle_photo_url, vehicle_type
  ON public.drivers
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_assigned_drivers_from_owner();

-- ── 2. Trigger: heredar vehículo al INSERT de asignado ───────────────────────
CREATE OR REPLACE FUNCTION public.inherit_assigned_driver_fleet_from_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_owner public.drivers%ROWTYPE;
BEGIN
  IF COALESCE(NEW.is_assigned_driver, false) AND NEW.owner_id IS NOT NULL THEN
    SELECT * INTO v_owner FROM public.drivers WHERE id = NEW.owner_id;
    IF FOUND THEN
      NEW.driver_number := COALESCE(NEW.driver_number, v_owner.driver_number);
      NEW.vehicle_brand := COALESCE(NEW.vehicle_brand, v_owner.vehicle_brand);
      NEW.vehicle_model := COALESCE(NEW.vehicle_model, v_owner.vehicle_model);
      NEW.vehicle_plate := COALESCE(NEW.vehicle_plate, v_owner.vehicle_plate);
      NEW.vehicle_color := COALESCE(NEW.vehicle_color, v_owner.vehicle_color);
      NEW.vehicle_photo_url := COALESCE(NEW.vehicle_photo_url, v_owner.vehicle_photo_url);
      NEW.vehicle_type := COALESCE(NEW.vehicle_type, v_owner.vehicle_type, 'auto');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. Eliminar columna ──────────────────────────────────────────────────────
ALTER TABLE public.drivers DROP COLUMN IF EXISTS vehicle_year;
