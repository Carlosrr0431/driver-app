-- Impide que un viaje cancelled/completed vuelva a un estado vivo
-- (pending, going_to_pickup, etc.) si el chofer acepta una oferta ya cerrada.
--
-- Ejecutar en el editor SQL de Supabase.

CREATE OR REPLACE FUNCTION public.prevent_cancelled_trip_resurrection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('cancelled', 'completed')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('queued', 'pending', 'accepted', 'going_to_pickup', 'in_progress')
  THEN
    NEW.status := OLD.status;
    NEW.dispatch_status := COALESCE(OLD.dispatch_status, NEW.dispatch_status);
    NEW.accepted_at := OLD.accepted_at;
    NEW.assigned_at := OLD.assigned_at;
    NEW.driver_id := OLD.driver_id;
    IF OLD.cancel_reason IS NOT NULL THEN
      NEW.cancel_reason := OLD.cancel_reason;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_cancelled_trip_resurrection ON public.trips;
CREATE TRIGGER trg_prevent_cancelled_trip_resurrection
BEFORE UPDATE ON public.trips
FOR EACH ROW
EXECUTE FUNCTION public.prevent_cancelled_trip_resurrection();
