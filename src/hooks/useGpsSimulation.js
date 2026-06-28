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

function applySimulatedPosition(lat, lng) {
  const latitude = parseCoord(lat);
  const longitude = parseCoord(lng);
  if (latitude == null || longitude == null) return;

  useLocationStore.getState().setCurrentLocation({
    lat: latitude,
    lng: longitude,
    speed: 0,
    heading: 0,
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
      updateDriver({ gps_simulation_active: nextActive });

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
