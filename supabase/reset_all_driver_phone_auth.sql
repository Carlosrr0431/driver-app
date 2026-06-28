-- =====================================================
-- RESET: todas las cuentas driver-app + limpiar titulares reasignados
-- Ejecutar en Supabase SQL Editor (una sola vez)
--
-- Qué hace:
-- 1) Móviles 2 y 3 (Soto, Ortega): borra viajes/comisiones/ubicación heredados
--    del chofer anterior que ocupaba ese número de móvil.
-- 2) Todos los choferes: user_id = NULL, password_initialized = false
--    → cada uno debe crear contraseña nueva en el primer login por teléfono.
-- 3) Elimina cuentas Auth sintéticas (@profesional.test) y las vinculadas.
--
-- NO borra viajes de Juan Pérez (móvil 1) ni de otros titulares insertados nuevos.
-- Requiere: normalize_driver_phone, build_owner_auth_email (fleet_owners_phone_login.sql)
-- =====================================================

BEGIN;

-- ── 1) Titulares reasignados por número de móvil (heredaron fila antigua) ───
CREATE TEMP TABLE _fleet_reassigned_roots ON COMMIT DROP AS
SELECT d.id, d.driver_number, d.full_name
FROM public.drivers d
WHERE d.driver_number IN (2, 3)
  AND d.owner_id IS NULL
  AND COALESCE(d.is_assigned_driver, false) = false;

-- Viajes y comisiones del perfil antiguo (mismo UUID, otro titular)
DELETE FROM public.commission_accumulation_log
WHERE driver_id IN (SELECT id FROM _fleet_reassigned_roots);

DELETE FROM public.commission_payments
WHERE driver_id IN (SELECT id FROM _fleet_reassigned_roots);

DELETE FROM public.trips
WHERE driver_id IN (SELECT id FROM _fleet_reassigned_roots);

DELETE FROM public.driver_locations
WHERE driver_id IN (SELECT id FROM _fleet_reassigned_roots);

DELETE FROM public.dispatcher_messages
WHERE driver_id IN (SELECT id FROM _fleet_reassigned_roots);

UPDATE public.drivers d
SET
  current_lat = NULL,
  current_lng = NULL,
  total_trips = 0,
  total_km = 0,
  pending_commission = 0,
  last_commission_payment_at = NULL,
  push_token = NULL,
  is_available = false,
  gps_simulation_active = false,
  vehicle_operator_id = NULL,
  user_id = NULL,
  password_initialized = false,
  created_at = NOW(),
  updated_at = NOW()
WHERE d.id IN (SELECT id FROM _fleet_reassigned_roots);

-- Choferes asignados colgados de esos móviles (si existieran)
UPDATE public.drivers d
SET
  is_available = false,
  vehicle_operator_id = NULL,
  user_id = NULL,
  password_initialized = false,
  current_lat = NULL,
  current_lng = NULL,
  push_token = NULL,
  updated_at = NOW()
WHERE d.owner_id IN (SELECT id FROM _fleet_reassigned_roots)
  AND d.is_assigned_driver = true;

-- ── 2) Guardar Auth a eliminar (antes de desvincular drivers) ───────────────
CREATE TEMP TABLE _auth_users_to_delete ON COMMIT DROP AS
SELECT DISTINCT u.id
FROM auth.users u
WHERE u.id IN (SELECT user_id FROM public.drivers WHERE user_id IS NOT NULL)
   OR u.email ILIKE 'owner.%@profesional.test'
   OR u.email ILIKE 'assigned.%@profesional.test';

-- ── 3) Desvincular TODOS los choferes (forzar primer login con clave nueva) ─
UPDATE public.drivers
SET
  user_id = NULL,
  password_initialized = false,
  is_available = false,
  vehicle_operator_id = NULL,
  updated_at = NOW()
WHERE user_id IS NOT NULL
   OR password_initialized IS DISTINCT FROM false;

-- ── 4) Re-normalizar teléfonos y emails sintéticos ───────────────────────────
UPDATE public.drivers d
SET
  phone_normalized = public.normalize_driver_phone(d.phone),
  auth_email = CASE
    WHEN COALESCE(d.is_assigned_driver, false) AND d.owner_id IS NOT NULL THEN
      'assigned.' || public.normalize_driver_phone(d.phone) || '@profesional.test'
    WHEN d.owner_id IS NULL AND COALESCE(d.is_assigned_driver, false) = false AND d.role = 'owner' THEN
      public.build_owner_auth_email(public.normalize_driver_phone(d.phone), d.driver_number)
    ELSE
      d.auth_email
  END,
  updated_at = NOW()
WHERE d.phone IS NOT NULL
  AND public.normalize_driver_phone(d.phone) IS NOT NULL;

-- ── 5) Borrar sesiones Auth (obligatorio: drivers.user_id tiene ON DELETE CASCADE) ─
-- Primero desvinculamos (paso 3); ahora eliminamos usuarios Auth.
DELETE FROM auth.users u
WHERE u.id IN (SELECT id FROM _auth_users_to_delete);

COMMIT;

-- Verificación rápida (opcional):
-- SELECT driver_number, full_name, user_id, password_initialized, total_trips, current_lat
-- FROM public.drivers WHERE driver_number IN (1, 2, 3) ORDER BY driver_number;
