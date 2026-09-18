import { isAlwaysLocationGranted } from '../utils/locationWatch';

let inFlight = null;
let inFlightBackground = false;

export function resetLocationPermissionRequest() {
  inFlight = null;
  inFlightBackground = false;
}

export function shouldPromptBackgroundLocation(permission) {
  if (isAlwaysLocationGranted(permission)) return false;
  if (permission?.canAskAgain === false) return false;
  return true;
}

/** iOS necesita Always. Android arranca el FGS con ubicación en uso. */
export function canStartFleetBackgroundUpdates({
  platform,
  foreground = false,
  always = false,
} = {}) {
  if (!foreground) return false;
  if (platform === 'ios') return Boolean(always);
  return true;
}

export function resolveLocationPermissionStatus({ foreground = false, always = false } = {}) {
  if (always) return 'granted';
  if (foreground) return 'foreground-only';
  return 'denied';
}

async function readForegroundPermission(LocationApi) {
  const current = await LocationApi.getForegroundPermissionsAsync();
  if (current?.status === 'granted') return current;
  if (current?.canAskAgain === false) return current;
  return LocationApi.requestForegroundPermissionsAsync();
}

async function readBackgroundPermission(LocationApi, { request = false } = {}) {
  const current = await LocationApi.getBackgroundPermissionsAsync();
  if (!request || !shouldPromptBackgroundLocation(current)) return current;
  return LocationApi.requestBackgroundPermissionsAsync();
}

async function requestFleetLocationPermissionsOnce(LocationApi, { background = false } = {}) {
  const foregroundPermission = await readForegroundPermission(LocationApi);
  const foreground = foregroundPermission?.status === 'granted';
  if (!foreground) {
    return {
      foreground: false,
      always: false,
      foregroundPermission,
      backgroundPermission: null,
    };
  }

  const backgroundPermission = await readBackgroundPermission(LocationApi, { request: background });
  return {
    foreground: true,
    always: isAlwaysLocationGranted(backgroundPermission),
    foregroundPermission,
    backgroundPermission,
  };
}

export async function requestFleetLocationPermissions(LocationApi, options = {}) {
  const { background = false } = options;
  if (inFlight) {
    const alreadyAskedBackground = inFlightBackground;
    const result = await inFlight;
    if (!background || alreadyAskedBackground || result.always || !result.foreground) {
      return result;
    }
  }

  inFlightBackground = background;
  const request = requestFleetLocationPermissionsOnce(LocationApi, { background });
  inFlight = request;
  try {
    return await request;
  } finally {
    if (inFlight === request) {
      inFlight = null;
      inFlightBackground = false;
    }
  }
}
