/**
 * Credenciales de desarrollo (solo rellenan el formulario de login).
 * Override con EXPO_PUBLIC_DEV_DRIVER_EMAIL / EXPO_PUBLIC_DEV_DRIVER_PASSWORD en .env
 */
export const DEV_DRIVER_EMAIL =
  process.env.EXPO_PUBLIC_DEV_DRIVER_EMAIL || 'carlos.driver@profesional.test';

export const DEV_DRIVER_PASSWORD =
  process.env.EXPO_PUBLIC_DEV_DRIVER_PASSWORD || '123456';

/** En __DEV__, login automático solo si EXPO_PUBLIC_DEV_AUTO_LOGIN=true (desactivado por defecto). */
export const DEV_AUTO_LOGIN =
  typeof __DEV__ !== 'undefined' &&
  __DEV__ &&
  process.env.EXPO_PUBLIC_DEV_AUTO_LOGIN === 'true';
