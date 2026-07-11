-- versionCode más reciente publicado en Google Play.
-- Actualizar estos valores cada vez que subas un AAB nuevo.
-- driver-app 1.0.7 → versionCode 9
-- passenger-app 1.0.7 → versionCode 8

INSERT INTO public.settings (key, value, updated_at)
VALUES
  ('driver_app_latest_version_code', '9', NOW()),
  ('passenger_app_latest_version_code', '8', NOW())
ON CONFLICT (key) DO UPDATE
SET
  value = EXCLUDED.value,
  updated_at = EXCLUDED.updated_at;

SELECT key, value, updated_at
FROM public.settings
WHERE key IN (
  'driver_app_latest_version_code',
  'passenger_app_latest_version_code'
);
