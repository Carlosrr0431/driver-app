-- =====================================================
-- Despertar dispatch-worker al encolar viajes (status -> queued)
--
-- Evita esperar hasta 60s al cron de Vercel. Usa pg_net (mismo patrón que
-- notify_whatsapp_trip_transition).
--
-- PASOS:
-- 1) Ejecutar este SQL en Supabase (pg_net habilitado en Database → Extensions)
-- 2) Ejecutar restore_dispatch_worker_wake_settings.sql con URL y CRON_SECRET reales
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_dispatch_worker_on_queued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
  v_headers JSONB := '{}'::jsonb;
BEGIN
  IF TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'queued' THEN
    RETURN NEW;
  END IF;

  -- Solo al entrar en cola, no en updates irrelevantes mientras ya está queued.
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'queued' THEN
    RETURN NEW;
  END IF;

  SELECT value
  INTO v_url
  FROM public.settings
  WHERE key = 'dispatch_worker_url'
  LIMIT 1;

  SELECT value
  INTO v_secret
  FROM public.settings
  WHERE key = 'dispatch_worker_secret'
  LIMIT 1;

  IF v_url IS NULL OR btrim(v_url) = '' THEN
    RETURN NEW;
  END IF;

  v_headers := jsonb_build_object('Content-Type', 'application/json');
  IF v_secret IS NOT NULL AND btrim(v_secret) <> '' THEN
    v_headers := v_headers || jsonb_build_object(
      'Authorization',
      'Bearer ' || btrim(v_secret)
    );
  END IF;

  PERFORM net.http_get(
    btrim(v_url),
    '{}'::jsonb,
    v_headers,
    8000
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_dispatch_worker_on_queued ON public.trips;

CREATE TRIGGER trg_notify_dispatch_worker_on_queued
AFTER INSERT OR UPDATE OF status
ON public.trips
FOR EACH ROW
EXECUTE FUNCTION public.notify_dispatch_worker_on_queued();

COMMENT ON FUNCTION public.notify_dispatch_worker_on_queued()
IS 'Invoca GET /api/dispatch-worker cuando un viaje entra en status queued (pg_net).';
