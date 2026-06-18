-- =====================================================
-- DRIVER APP - SUPABASE DATABASE MIGRATION
-- =====================================================

-- Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- TABLA: drivers (Choferes)
-- =====================================================
CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  photo_url TEXT,
  vehicle_brand TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_plate TEXT,
  vehicle_color TEXT,
  vehicle_photo_url TEXT,
  license_expiry DATE,
  is_available BOOLEAN DEFAULT FALSE,
  current_lat DECIMAL(10, 8),
  current_lng DECIMAL(11, 8),
  rating DECIMAL(3,2) DEFAULT 5.00,
  total_trips INTEGER DEFAULT 0,
  total_km DECIMAL(10,2) DEFAULT 0,
  push_token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TABLA: trips (Viajes)
-- =====================================================
CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id UUID REFERENCES drivers(id),
  passenger_name TEXT NOT NULL,
  passenger_phone TEXT,
  origin_address TEXT NOT NULL,
  origin_lat DECIMAL(10, 8),
  origin_lng DECIMAL(11, 8),
  destination_address TEXT NOT NULL,
  destination_lat DECIMAL(10, 8),
  destination_lng DECIMAL(11, 8),
  status TEXT DEFAULT 'pending'
    CHECK (status IN (
      'pending','accepted','going_to_pickup',
      'in_progress','completed','cancelled'
    )),
  price DECIMAL(10, 2),
  distance_km DECIMAL(10, 2),
  duration_minutes INTEGER,
  notes TEXT,
  cancel_reason TEXT,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  pickup_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TABLA: trip_tracking (Tracking GPS)
-- =====================================================
CREATE TABLE IF NOT EXISTS trip_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES drivers(id),
  lat DECIMAL(10, 8) NOT NULL,
  lng DECIMAL(11, 8) NOT NULL,
  speed DECIMAL(5, 2) DEFAULT 0,
  heading DECIMAL(5, 2) DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TABLA: dispatcher_messages (Mensajes del despachador)
-- =====================================================
CREATE TABLE IF NOT EXISTS dispatcher_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id UUID REFERENCES drivers(id),
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info'
    CHECK (type IN ('info','warning','trip','emergency')),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- ÍNDICES
-- =====================================================
CREATE INDEX idx_drivers_user_id ON drivers(user_id);
CREATE INDEX idx_drivers_available ON drivers(is_available);
CREATE INDEX idx_trips_driver_id ON trips(driver_id);
CREATE INDEX idx_trips_status ON trips(status);

-- =====================================================
-- TABLA: settings (Configuración del sistema)
-- =====================================================
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tarifa por kilómetro por defecto
INSERT INTO settings (key, value) VALUES ('tariff_per_km', '500');

-- Tarifa base (bajada de bandera, opcional)
INSERT INTO settings (key, value) VALUES ('tariff_base', '0');

-- RLS para settings
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir leer settings" ON settings FOR SELECT TO anon USING (true);
CREATE POLICY "Permitir actualizar settings" ON settings FOR UPDATE TO anon USING (true);
CREATE POLICY "Permitir insertar settings" ON settings FOR INSERT TO anon WITH CHECK (true);
CREATE INDEX idx_trips_created_at ON trips(created_at);
CREATE INDEX idx_trip_tracking_trip_id ON trip_tracking(trip_id);
CREATE INDEX idx_trip_tracking_recorded_at ON trip_tracking(recorded_at);
CREATE INDEX idx_dispatcher_messages_driver_id ON dispatcher_messages(driver_id);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatcher_messages ENABLE ROW LEVEL SECURITY;

-- Políticas para drivers
CREATE POLICY "Chofer ve solo su perfil"
  ON drivers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Chofer actualiza solo su perfil"
  ON drivers FOR UPDATE
  USING (auth.uid() = user_id);

-- Políticas para trips
CREATE POLICY "Chofer ve sus viajes"
  ON trips FOR SELECT
  USING (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

CREATE POLICY "Chofer actualiza sus viajes"
  ON trips FOR UPDATE
  USING (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

-- Políticas para trip_tracking
CREATE POLICY "Chofer inserta su tracking"
  ON trip_tracking FOR INSERT
  WITH CHECK (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

CREATE POLICY "Chofer ve su tracking"
  ON trip_tracking FOR SELECT
  USING (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

-- Políticas para dispatcher_messages
CREATE POLICY "Chofer ve sus mensajes"
  ON dispatcher_messages FOR SELECT
  USING (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

CREATE POLICY "Chofer marca mensajes como leídos"
  ON dispatcher_messages FOR UPDATE
  USING (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ))
  WITH CHECK (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

-- =====================================================
-- FUNCIONES Y TRIGGERS
-- =====================================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER drivers_updated_at
  BEFORE UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Función para actualizar estadísticas del chofer al completar un viaje
CREATE OR REPLACE FUNCTION update_driver_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    UPDATE drivers
    SET
      total_trips = total_trips + 1,
      total_km = total_km + COALESCE(NEW.distance_km, 0)
    WHERE id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trips_completed_stats
  AFTER UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION update_driver_stats();

-- =====================================================
-- TABLA: driver_locations (Ubicación en tiempo real)
-- =====================================================
-- Esta tabla guarda la ÚLTIMA ubicación de cada chofer.
-- Se usa UPSERT (ON CONFLICT) para mantener solo 1 fila por chofer.
-- Supabase Realtime escucha cambios para el dashboard.
-- =====================================================
CREATE TABLE IF NOT EXISTS driver_locations (
  driver_id UUID PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
  lat DECIMAL(10, 8) NOT NULL,
  lng DECIMAL(11, 8) NOT NULL,
  speed DECIMAL(5, 2) DEFAULT 0,
  heading DECIMAL(5, 2) DEFAULT 0,
  is_online BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_driver_locations_online ON driver_locations(is_online);
CREATE INDEX idx_driver_locations_updated ON driver_locations(updated_at);

ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;

-- El chofer puede insertar/actualizar su propia ubicación
CREATE POLICY "Chofer upsert su ubicación"
  ON driver_locations FOR INSERT
  WITH CHECK (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

CREATE POLICY "Chofer actualiza su ubicación"
  ON driver_locations FOR UPDATE
  USING (driver_id IN (
    SELECT id FROM drivers WHERE user_id = auth.uid()
  ));

-- Cualquier usuario autenticado puede leer ubicaciones (para el dashboard)
CREATE POLICY "Dashboard lee ubicaciones"
  ON driver_locations FOR SELECT
  USING (auth.role() = 'authenticated');

-- Habilitar Realtime en driver_locations
ALTER PUBLICATION supabase_realtime ADD TABLE driver_locations;

-- =====================================================
-- REALTIME
-- =====================================================
ALTER PUBLICATION supabase_realtime ADD TABLE trips;
ALTER PUBLICATION supabase_realtime ADD TABLE dispatcher_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE drivers;

-- =====================================================
-- STORAGE BUCKETS (ejecutar en Supabase Dashboard)
-- =====================================================
-- INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('vehicles', 'vehicles', true);
--
-- CREATE POLICY "Avatar upload" ON storage.objects FOR INSERT
--   WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');
--
-- CREATE POLICY "Avatar read" ON storage.objects FOR SELECT
--   USING (bucket_id = 'avatars');
--
-- CREATE POLICY "Vehicle upload" ON storage.objects FOR INSERT
--   WITH CHECK (bucket_id = 'vehicles' AND auth.role() = 'authenticated');
--
-- CREATE POLICY "Vehicle read" ON storage.objects FOR SELECT
--   USING (bucket_id = 'vehicles');

-- =====================================================
-- MIGRACIÓN: Agregar tipo de vehículo (moto/auto)
-- =====================================================
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_type TEXT DEFAULT 'auto'
  CHECK (vehicle_type IN ('auto', 'moto'));

-- Número identificador del móvil/chofer
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS driver_number INTEGER UNIQUE;

-- =====================================================
-- SISTEMA DE COMISIONES
-- =====================================================

-- Agregar columna commission_amount en trips para guardar la comisión por viaje
ALTER TABLE trips ADD COLUMN IF NOT EXISTS commission_amount DECIMAL(10, 2) DEFAULT 0;

-- Tabla: commission_payments (Pagos/regularización de comisiones)
-- Registra cuando un chofer paga sus comisiones acumuladas
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

-- Agregar publicación realtime para commission_payments
ALTER PUBLICATION supabase_realtime ADD TABLE commission_payments;

-- Setting por defecto: porcentaje de comisión (10%)
INSERT INTO settings (key, value) VALUES ('commission_percent', '10')
  ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- SISTEMA DE MENSAJES DE VOZ (Walkie-Talkie)
-- =====================================================

CREATE TABLE IF NOT EXISTS voice_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('base', 'driver')),
  audio_url TEXT NOT NULL,
  duration_seconds INTEGER DEFAULT 0,
  is_played BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_messages_driver ON voice_messages(driver_id);
CREATE INDEX IF NOT EXISTS idx_voice_messages_created ON voice_messages(created_at);

ALTER TABLE voice_messages ENABLE ROW LEVEL SECURITY;

-- El chofer puede ver sus propios mensajes de voz
CREATE POLICY "Chofer ve sus mensajes de voz"
  ON voice_messages FOR SELECT
  USING (driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid()));

-- El chofer puede insertar mensajes de voz (sender_type = 'driver')
CREATE POLICY "Chofer envia mensajes de voz"
  ON voice_messages FOR INSERT
  WITH CHECK (driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid()));

-- El chofer puede marcar como leído
CREATE POLICY "Chofer actualiza mensajes de voz"
  ON voice_messages FOR UPDATE
  USING (driver_id IN (SELECT id FROM drivers WHERE user_id = auth.uid()));

-- Dashboard (anon) puede leer, insertar y actualizar
CREATE POLICY "Dashboard lee mensajes de voz" ON voice_messages FOR SELECT TO anon USING (true);
CREATE POLICY "Dashboard envia mensajes de voz" ON voice_messages FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Dashboard actualiza mensajes de voz" ON voice_messages FOR UPDATE TO anon USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE voice_messages;

-- Storage bucket para audios de voz
INSERT INTO storage.buckets (id, name, public) VALUES ('voice-messages', 'voice-messages', true) ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Voice upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'voice-messages');
CREATE POLICY "Voice read" ON storage.objects FOR SELECT USING (bucket_id = 'voice-messages');
CREATE POLICY "Voice update" ON storage.objects FOR UPDATE USING (bucket_id = 'voice-messages');
