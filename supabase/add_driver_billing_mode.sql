-- Migration: add billing_mode + commission_blocked to drivers (dual cobro)
-- Run this in the Supabase SQL Editor
--
-- commission_current  → cobro por comisiones con gracia de 3 días (default, comportamiento actual)
-- weekly_traditional  → cobro semanal; siempre recibe viajes salvo commission_blocked manual
--
-- Sin estas columnas el dispatch-worker revienta:
--   "column drivers.billing_mode does not exist"
-- y deja el viaje en dispatch_queue.queue_status = dead_letter.

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS commission_blocked boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_drivers_commission_blocked
  ON public.drivers (commission_blocked)
  WHERE commission_blocked = true;

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
