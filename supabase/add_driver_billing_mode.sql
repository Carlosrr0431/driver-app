-- Migration: add billing_mode to drivers (dual cobro)
-- Run this in the Supabase SQL Editor
--
-- commission_current  → cobro por comisiones con gracia de 3 días (default, comportamiento actual)
-- weekly_traditional  → cobro semanal; siempre recibe viajes salvo commission_blocked manual

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS billing_mode text NOT NULL DEFAULT 'commission_current';

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_billing_mode_check;

ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_billing_mode_check
  CHECK (billing_mode IN ('commission_current', 'weekly_traditional'));

CREATE INDEX IF NOT EXISTS idx_drivers_billing_mode
  ON public.drivers (billing_mode);

-- Verify
SELECT id, full_name, billing_mode, commission_blocked, pending_commission, commission_debt_since_at
FROM public.drivers
ORDER BY created_at DESC
LIMIT 10;
