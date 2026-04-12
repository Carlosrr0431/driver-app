-- =====================================================
-- MIGRACIÓN: SISTEMA DE COMISIONES
-- Ejecutar en Supabase Dashboard → SQL Editor
-- =====================================================

-- Agregar columna commission_amount en trips para guardar la comisión por viaje
ALTER TABLE trips ADD COLUMN IF NOT EXISTS commission_amount DECIMAL(10, 2) DEFAULT 0;

-- Tabla: commission_payments (Pagos/regularización de comisiones)
CREATE TABLE IF NOT EXISTS commission_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_payments_driver ON commission_payments(driver_id);
CREATE INDEX IF NOT EXISTS idx_commission_payments_created ON commission_payments(created_at);

ALTER TABLE commission_payments ENABLE ROW LEVEL SECURITY;

-- El chofer puede ver sus propios pagos
CREATE POLICY "Chofer ve sus pagos de comisión"
  ON commission_payments FOR SELECT
  USING (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

-- Dashboard (anon) puede insertar pagos y leer todos
CREATE POLICY "Dashboard inserta pagos" ON commission_payments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Dashboard lee pagos" ON commission_payments FOR SELECT TO anon USING (true);

-- Habilitar Realtime para commission_payments
ALTER PUBLICATION supabase_realtime ADD TABLE commission_payments;

-- Setting: porcentaje de comisión (10%)
INSERT INTO settings (key, value) VALUES ('commission_percent', '10')
  ON CONFLICT (key) DO NOTHING;
