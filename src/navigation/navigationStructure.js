/**
 * Mapa de rutas del main navigator (driver-app).
 * Actualizá solo este archivo al agregar, renombrar o quitar pantallas/tabs.
 * El fingerprint se recalcula solo y descarta snapshots viejos incompatible.
 */
export const NAVIGATION_STRUCTURE = {
  tabs: {
    Home: ['HomeMain', 'ActiveTrip', 'TripDetail', 'CommissionPayment'],
    History: ['HistoryMain', 'TripDetail'],
    Profile: [
      'ProfileMain',
      'OwnerDashboard',
      'OwnerDriverDetail',
      'CreateLinkedDriver',
    ],
  },
};

function buildNavigationFingerprint(structure) {
  if (Array.isArray(structure.stack)) {
    return structure.stack.join('|');
  }

  if (structure.tabs) {
    return Object.entries(structure.tabs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([tabName, screens]) => `${tabName}:${screens.join('|')}`)
      .join(';');
  }

  return '';
}

function collectKnownRouteNames(structure) {
  if (Array.isArray(structure.stack)) {
    return new Set(structure.stack);
  }

  if (structure.tabs) {
    const names = new Set(Object.keys(structure.tabs));
    Object.values(structure.tabs).forEach((screens) => {
      screens.forEach((screen) => names.add(screen));
    });
    return names;
  }

  return new Set();
}

function collectRouteNamesFromState(state, names = []) {
  if (!state?.routes) return names;

  state.routes.forEach((route) => {
    if (route?.name) names.push(route.name);
    if (route?.state) collectRouteNamesFromState(route.state, names);
  });

  return names;
}

export const NAVIGATION_STRUCTURE_FINGERPRINT =
  buildNavigationFingerprint(NAVIGATION_STRUCTURE);

export const MAIN_ROOT_ROUTE_NAMES = Object.keys(NAVIGATION_STRUCTURE.tabs);

export const KNOWN_MAIN_ROUTE_NAMES = collectKnownRouteNames(NAVIGATION_STRUCTURE);

export function isNavigationStateCompatibleWithStructure(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.routes)) {
    return false;
  }

  const activeRoute = state.routes[state.index ?? 0];
  if (!activeRoute?.name || !MAIN_ROOT_ROUTE_NAMES.includes(activeRoute.name)) {
    return false;
  }

  return collectRouteNamesFromState(state).every((name) =>
    KNOWN_MAIN_ROUTE_NAMES.has(name),
  );
}
