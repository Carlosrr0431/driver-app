/**
 * Selección de ruta para tarifa de pasajero.
 * Entre alternativas con tiempo similar, preferir la más corta en distancia
 * (evita desvíos largos por RN cuando el centro urbano es casi igual de rápido).
 */

function sumRouteLegMetrics(legs = []) {
  let distanceValue = 0;
  let durationValue = 0;
  for (const leg of legs) {
    distanceValue += leg?.distance?.value || 0;
    durationValue += leg?.duration_in_traffic?.value || leg?.duration?.value || 0;
  }
  return { distanceValue, durationValue };
}

/** Métricas directas de OSRM (metros / segundos). */
function sumOsrmRouteMetrics(route) {
  return {
    distanceValue: Math.round(Number(route?.distance) || 0),
    durationValue: Math.round(Number(route?.duration) || 0),
  };
}

/**
 * @param {object[]} routes - Rutas Google Directions u OSRM
 * @returns {object|null}
 */
function pickPassengerFareRoute(routes) {
  if (!Array.isArray(routes) || routes.length === 0) return null;
  if (routes.length === 1) return routes[0];

  const routesWithMetrics = routes
    .map((route) => {
      if (route?.legs) {
        const legs = route.legs || [];
        const { distanceValue, durationValue } = sumRouteLegMetrics(legs);
        return { route, distanceValue, durationValue };
      }
      const { distanceValue, durationValue } = sumOsrmRouteMetrics(route);
      return { route, distanceValue, durationValue };
    })
    .filter((item) => item.distanceValue > 0 && item.durationValue > 0);

  if (routesWithMetrics.length === 0) return routes[0];

  const minDuration = Math.min(...routesWithMetrics.map((item) => item.durationValue));
  const durationSlack = Math.max(180, Math.round(minDuration * 0.12));
  const maxReasonableDuration = minDuration + durationSlack;

  const reasonable = routesWithMetrics.filter(
    (item) => item.durationValue <= maxReasonableDuration
  );
  const pool = reasonable.length > 0 ? reasonable : routesWithMetrics;

  pool.sort((a, b) => {
    if (a.distanceValue !== b.distanceValue) return a.distanceValue - b.distanceValue;
    return a.durationValue - b.durationValue;
  });

  return pool[0].route;
}

module.exports = {
  sumRouteLegMetrics,
  sumOsrmRouteMetrics,
  pickPassengerFareRoute,
};
