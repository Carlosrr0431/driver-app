-- =====================================================
-- Viaje en calle: el chofer crea un viaje con origen = GPS
-- y destino a definir (misma lógica que APPROACH_ONLY sin destino).
--
-- EJECUTAR en el editor SQL de Supabase.
-- Requiere get_my_driver_id() (fix_drivers_rls_recursion.sql).
-- =====================================================

CREATE OR REPLACE FUNCTION public.driver_create_street_hail_trip(
  p_origin_address TEXT,
  p_origin_lat DOUBLE PRECISION,
  p_origin_lng DOUBLE PRECISION
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id UUID;
  v_live_id UUID;
  v_trip public.trips%ROWTYPE;
  v_address TEXT;
  v_notes TEXT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  v_driver_id := public.get_my_driver_id();
  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'driver_not_found');
  END IF;

  IF p_origin_lat IS NULL OR p_origin_lng IS NULL
     OR (p_origin_lat = 0 AND p_origin_lng = 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'origin_required');
  END IF;

  SELECT id INTO v_live_id
  FROM public.trips
  WHERE driver_id = v_driver_id
    AND status IN ('pending', 'accepted', 'going_to_pickup', 'in_progress')
  LIMIT 1;

  IF v_live_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'driver_busy', 'trip_id', v_live_id);
  END IF;

  v_address := NULLIF(trim(COALESCE(p_origin_address, '')), '');
  IF v_address IS NULL THEN
    v_address := round(p_origin_lat::numeric, 5)::text || ', ' || round(p_origin_lng::numeric, 5)::text;
  END IF;

  v_notes := '[STREET_HAIL]' || E'\n'
    || 'Viaje tomado en calle. Destino a definir.' || E'\n'
    || '[PICKUP_JSON:' || jsonb_build_object(
      'address', v_address,
      'lat', p_origin_lat,
      'lng', p_origin_lng
    )::text || ']';

  INSERT INTO public.trips (
    driver_id,
    passenger_name,
    passenger_phone,
    origin_address,
    origin_lat,
    origin_lng,
    destination_address,
    destination_lat,
    destination_lng,
    status,
    dispatch_status,
    notes,
    assigned_at,
    accepted_at,
    pickup_at,
    wa_context
  ) VALUES (
    v_driver_id,
    'Pasajero en calle',
    NULL,
    v_address,
    p_origin_lat,
    p_origin_lng,
    'A confirmar',
    NULL,
    NULL,
    'accepted',
    'accepted',
    v_notes,
    v_now,
    v_now,
    v_now,
    jsonb_build_object(
      'source', 'street_hail',
      'dispatch_excluded_driver_ids', '[]'::jsonb
    )
  )
  RETURNING * INTO v_trip;

  RETURN jsonb_build_object(
    'success', true,
    'trip', to_jsonb(v_trip)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_create_street_hail_trip(TEXT, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_create_street_hail_trip(TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
