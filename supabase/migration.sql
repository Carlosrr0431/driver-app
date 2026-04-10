-- =====================================================
-- DRIVER APP - SUPABASE DATABASE MIGRATION
-- =====================================================

-- Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- TABLA: drivers (Choferes)
-- =====================================================
CREATE TABLE drivers (
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
CREATE TABLE trips (
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
CREATE TABLE trip_tracking (
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
CREATE TABLE dispatcher_messages (
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
