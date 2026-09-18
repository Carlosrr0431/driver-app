import { useEffect } from 'react';
import Toast from 'react-native-toast-message';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useLocationStore } from '../stores/locationStore';
import { isGpsSimulationActive, setGpsSimulationActive } from '../lib/gpsSimulation';

function parseCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(fromLat, fromLng, toLat, toLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const lat1 = toRad(fromLat);
  const lat2 = toRad(toLat);
  const dLng = toRad(toLng - fromLng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function applySimulatedPosition(lat, lng) {
  const latitude = parseCoord(lat);
  const longitude = parseCoord(lng);
  if (latitude == null || longitude == null) return;

  const prev = useLocationStore.getState().currentLocation;
  let speed = 0;
  let heading = Number.isFinite(prev?.heading) ? prev.heading : 0;

  if (prev && Number.isFinite(prev.lat) && Number.isFinite(prev.lng)) {
    const dist = distanceMeters(prev.lat, prev.lng, latitude, longitude);
    if (dist < 1) return;
    // Si el panel movió el punto, estimamos rumbo/velocidad para que la cámara y el puck giren.
    if (dist >= 2) {
      heading = bearingDegrees(prev.lat, prev.lng, latitude, longitude);
      // Mínimo > 1.5 m/s para que locationStore acepte el heading.
      speed = Math.max(2, Math.min(dist, 25));
    }
  }

  useLocationStore.getState().setCurrentLocation({
    lat: latitude,
    lng: longitude,
    speed,
    heading,
    accuracy: 5,
  });
}

/**
 * Escucha gps_simulation_active y current_lat/lng del chofer logueado.
 * Cuando está activo, la app muestra la posición de Supabase y no pisa con GPS real.
 */
export function useGpsSimulation() {
  const driver = useAuthStore((s) => s.driver);
  const updateDriver = useAuthStore((s) => s.updateDriver);

  useEffect(() => {
    if (!driver?.id) {
      setGpsSimulationActive(false);
      return undefined;
    }

    let cancelled = false;

    const syncFromRow = (row, { notify = false } = {}) => {
      if (!row || cancelled) return;
      const wasActive = isGpsSimulationActive();
      const nextActive = Boolean(row.gps_simulation_active);
      setGpsSimulationActive(nextActive);
      const currentFlag = Boolean(useAuthStore.getState().driver?.gps_simulation_active);
      if (currentFlag !== nextActive) {
        updateDriver({ gps_simulation_active: nextActive });
      }

      if (nextActive) {
        applySimulatedPosition(row.current_lat, row.current_lng);
      }

      if (notify && wasActive !== nextActive) {
        Toast.show({
          type: nextActive ? 'info' : 'success',
          text1: nextActive ? 'Simulación GPS activa' : 'Simulación GPS desactivada',
          text2: nextActive
            ? 'La ubicación la controla el panel de operadores'
            : 'Volvés a usar el GPS del teléfono',
        });
      }
    };

    const bootstrap = async () => {
      try {
        const { data, error } = await supabase
          .from('drivers')
          .select('gps_simulation_active, current_lat, current_lng')
          .eq('id', driver.id)
          .single();
        if (error) throw error;
        syncFromRow(data);
      } catch (error) {
        console.warn('useGpsSimulation bootstrap:', error.message);
        setGpsSimulationActive(Boolean(driver.gps_simulation_active));
      }
    };

    bootstrap();

    const channel = supabase
      .channel(`gps-simulation:${driver.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'drivers',
          filter: `id=eq.${driver.id}`,
        },
        (payload) => {
          syncFromRow(payload.new, { notify: true });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      setGpsSimulationActive(false);
      supabase.removeChannel(channel);
    };
  }, [driver?.id, updateDriver]);
}
