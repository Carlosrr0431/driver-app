-- =====================================================
-- MIGRACIÓN: ACUMULACIÓN AUTOMÁTICA DE COMISIONES
-- Ejecutar en Supabase Dashboard → SQL Editor
-- =====================================================

-- Agregar columna para acumular comisiones pendientes en drivers
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pending_commission DECIMAL(10, 2) DEFAULT 0;

-- Agregar columna para registrar la última vez que se pagó
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_commission_payment_at TIMESTAMPTZ DEFAULT NULL;

-- Crear tabla de auditoría para rastrear comisiones acumuladas
CREATE TABLE IF NOT EXISTS commission_accumulation_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  commission_amount DECIMAL(10, 2) NOT NULL,
  accumulated_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded'))
);

CREATE INDEX IF NOT EXISTS idx_commission_accumulation_driver ON commission_accumulation_log(driver_id);
CREATE INDEX IF NOT EXISTS idx_commission_accumulation_trip ON commission_accumulation_log(trip_id);
CREATE INDEX IF NOT EXISTS idx_commission_accumulation_status ON commission_accumulation_log(status);

-- Trigger: Acumular comisión cuando un viaje se completa
CREATE OR REPLACE FUNCTION accumulate_trip_commission()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo procesar cuando el viaje pasa a estado 'completed'
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Validar que haya un commission_amount válido
    IF NEW.commission_amount > 0 AND NEW.driver_id IS NOT NULL THEN
      -- Actualizar y auditar comisión sin bloquear el cierre del viaje.
      BEGIN
        UPDATE drivers
        SET 
          pending_commission = pending_commission + NEW.commission_amount,
          updated_at = NOW()
        WHERE id = NEW.driver_id;

        INSERT INTO commission_accumulation_log (driver_id, trip_id, commission_amount, status)
        VALUES (NEW.driver_id, NEW.id, NEW.commission_amount, 'pending');
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'accumulate_trip_commission failed for trip %: %', NEW.id, SQLERRM;
      END;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear el trigger si no existe
DROP TRIGGER IF EXISTS trip_commission_accumulation_trigger ON trips;
CREATE TRIGGER trip_commission_accumulation_trigger
AFTER UPDATE ON trips
FOR EACH ROW
EXECUTE FUNCTION accumulate_trip_commission();

-- RLS para commission_accumulation_log
ALTER TABLE commission_accumulation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Driver inserts own commission accumulation" ON commission_accumulation_log;
CREATE POLICY "Driver inserts own commission accumulation"
  ON commission_accumulation_log FOR INSERT
  WITH CHECK (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

-- El chofer puede ver sus propias acumulaciones
DROP POLICY IF EXISTS "Driver views own commission accumulation" ON commission_accumulation_log;
CREATE POLICY "Driver views own commission accumulation"
  ON commission_accumulation_log FOR SELECT
  USING (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

-- Dashboard (anon) puede ver todas
DROP POLICY IF EXISTS "Dashboard views all commission accumulations" ON commission_accumulation_log;
CREATE POLICY "Dashboard views all commission accumulations"
  ON commission_accumulation_log FOR SELECT TO anon USING (true);

-- Habilitar Realtime (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.pubname = 'supabase_realtime'
      AND n.nspname = 'public'
      AND c.relname = 'commission_accumulation_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.commission_accumulation_log;
  END IF;
END
$$;

-- Comentarios de documentación
COMMENT ON TABLE commission_accumulation_log IS 'Registro de auditoría de comisiones acumuladas por cada viaje completado';
COMMENT ON COLUMN commission_accumulation_log.status IS 'Estado: pending (acumulado pero no pagado), paid (pagado), refunded (reembolsado)';
COMMENT ON COLUMN drivers.pending_commission IS 'Comisión total acumulada pendiente de pagar';
