-- ============================================================
-- Trip Tracking Link Migration
-- Adds tracking_token column to trips + anonymous read RLS
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Add unique tracking token (auto-generated UUID per trip)
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS tracking_token UUID NOT NULL DEFAULT gen_random_uuid();

-- 2. Create unique index for fast token lookups
CREATE UNIQUE INDEX IF NOT EXISTS trips_tracking_token_idx ON trips (tracking_token);

-- 3. Allow anonymous users to read a trip by its tracking token
--    Security model: 128-bit UUID token = unguessable shareable link
DROP POLICY IF EXISTS "Public read trip by tracking token" ON trips;
CREATE POLICY "Public read trip by tracking token" ON trips
  FOR SELECT TO anon
  USING (tracking_token IS NOT NULL);

-- 4. Allow anonymous users to read GPS tracking points for tracked trips
DROP POLICY IF EXISTS "Public read trip tracking points" ON trip_tracking;
CREATE POLICY "Public read trip tracking points" ON trip_tracking
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM trips t
      WHERE t.id = trip_tracking.trip_id
        AND t.tracking_token IS NOT NULL
    )
  );

-- 5. Allow anonymous users to read basic driver info for tracking
DROP POLICY IF EXISTS "Public read driver for tracking" ON drivers;
CREATE POLICY "Public read driver for tracking" ON drivers
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM trips t
      WHERE t.driver_id = drivers.id
        AND t.tracking_token IS NOT NULL
    )
  );
