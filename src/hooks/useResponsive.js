import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
} from 'react';
import { useWindowDimensions } from 'react-native';
import {
  createResponsiveMetrics,
  setResponsiveMetrics,
} from '../utils/responsive';

const ResponsiveContext = createContext(null);

/**
 * Sincroniza métricas con el tamaño real de ventana (incluye rotación).
 * Envolver la app una sola vez bajo SafeAreaProvider.
 */
export function ResponsiveProvider({ children }) {
  const { width, height } = useWindowDimensions();

  const metrics = useMemo(
    () => createResponsiveMetrics(width, height),
    [width, height],
  );

  useEffect(() => {
    setResponsiveMetrics(width, height);
  }, [width, height]);

  return (
    <ResponsiveContext.Provider value={metrics}>
      {children}
    </ResponsiveContext.Provider>
  );
}

/**
 * Hook principal de layout responsive.
 * @returns {ReturnType<typeof createResponsiveMetrics>}
 */
export function useResponsive() {
  const ctx = useContext(ResponsiveContext);
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    if (ctx) return ctx;
    return createResponsiveMetrics(width, height);
  }, [ctx, width, height]);
}
