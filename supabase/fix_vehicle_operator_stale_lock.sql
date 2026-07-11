-- =====================================================
-- FIX: chofer asignado bloqueado por vehicle_operator_id obsoleto
-- Ejecutar manualmente en Supabase SQL Editor
--
-- Problema: el titular queda con vehicle_operator_id apuntando a su propio id
-- aunque is_available = false. El chofer asignado no puede conectarse porque
-- set_driver_online_status bloquea sin verificar si el operador sigue en línea.
-- =====================================================

-- 1) Liberar locks obsoletos (operador registrado pero fuera de línea)
UPDATE public.drivers AS root
SET vehicle_operator_id = NULL, updated_at = NOW()
WHERE root.owner_id IS NULL
  AND COALESCE(root.is_assigned_driver, false) = false
  AND root.vehicle_operator_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.drivers op
    WHERE op.id = root.vehicle_operator_id
      AND op.is_available = false
  );

CREATE OR REPLACE FUNCTION public.set_driver_online_status(p_driver_id UUID, p_online BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver public.drivers%ROWTYPE;
  v_fleet_root_id UUID;
  v_operator_id UUID;
  v_busy UUID;
  v_active_trip UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autenticado');
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id = p_driver_id
    AND user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfil de chofer no encontrado');
  END IF;

  v_fleet_root_id := public.get_fleet_root_id(p_driver_id);

  IF p_online THEN
    SELECT vehicle_operator_id INTO v_operator_id
    FROM public.drivers
    WHERE id = v_fleet_root_id;

    IF v_operator_id IS NOT NULL AND v_operator_id <> p_driver_id THEN
      IF EXISTS (
        SELECT 1
        FROM public.drivers
        WHERE id = v_operator_id
          AND is_available = true
      ) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'El vehículo ya está en uso por otro chofer. Solo uno puede operarlo a la vez.'
        );
      END IF;

      -- Lock obsoleto: el operador anterior ya está fuera de línea.
      UPDATE public.drivers
      SET vehicle_operator_id = NULL, updated_at = NOW()
      WHERE id = v_fleet_root_id
        AND vehicle_operator_id = v_operator_id;
    END IF;

    SELECT d.id INTO v_busy
    FROM public.drivers d
    WHERE (d.id = v_fleet_root_id OR d.owner_id = v_fleet_root_id)
      AND d.is_available = true
      AND d.id <> p_driver_id
    LIMIT 1;

    IF v_busy IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Otro chofer del mismo vehículo ya está en línea.'
      );
    END IF;

    SELECT t.id INTO v_active_trip
    FROM public.trips t
    INNER JOIN public.drivers d ON d.id = t.driver_id
    WHERE (d.id = v_fleet_root_id OR d.owner_id = v_fleet_root_id)
      AND d.id <> p_driver_id
      AND t.status IN ('accepted', 'going_to_pickup', 'in_progress')
    LIMIT 1;

    IF v_active_trip IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Hay un viaje activo con otro chofer de este vehículo.'
      );
    END IF;

    UPDATE public.drivers
    SET is_available = true, updated_at = NOW()
    WHERE id = p_driver_id;

    UPDATE public.drivers
    SET vehicle_operator_id = p_driver_id, updated_at = NOW()
    WHERE id = v_fleet_root_id;

    RETURN jsonb_build_object('success', true, 'is_available', true);
  END IF;

  UPDATE public.drivers
  SET is_available = false, updated_at = NOW()
  WHERE id = p_driver_id;

  UPDATE public.drivers
  SET vehicle_operator_id = NULL, updated_at = NOW()
  WHERE id = v_fleet_root_id
    AND vehicle_operator_id = p_driver_id;

  RETURN jsonb_build_object('success', true, 'is_available', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_driver_online_status(UUID, BOOLEAN) TO authenticated;
