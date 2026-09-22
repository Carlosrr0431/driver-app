/**
 * shared/next-trip.js
 *
 * Viaje en paralelo (estilo Uber): si no hay chofer libre en el radio,
 * o el libre no acepta, se ofrece el viaje a un chofer ocupado.
 * Si acepta, el viaje queda reservado detrás del actual y se activa
 * al completar/cancelar el que está en curso.
 *
 * Compatible con CommonJS (jest-expo y next/jest).
 */

const LIVE_NEXT_STATUSES = ['accepted', 'going_to_pickup', 'in_progress'];
const RESERVED_NEXT_STATUSES = ['pending', 'accepted'];

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function getNextAfterTripId(trip) {
  const value = trip?.next_after_trip_id;
  if (value == null || value === '') return null;
  return String(value);
}

function isNextTripOffer(trip) {
  if (!trip) return false;
  if (String(trip.status || '').toLowerCase() !== 'pending') return false;
  return Boolean(getNextAfterTripId(trip));
}

function isReservedNextTrip(trip) {
  if (!trip?.id) return false;
  if (String(trip.status || '').toLowerCase() !== 'accepted') return false;
  return Boolean(getNextAfterTripId(trip));
}

function shouldTreatAsLiveDriverTrip(trip) {
  if (!trip?.id) return false;
  if (!LIVE_NEXT_STATUSES.includes(String(trip.status || '').toLowerCase())) return false;
  return !getNextAfterTripId(trip);
}

function shouldFallbackToBusyDrivers({ idleInRadiusCount } = {}) {
  return Math.max(0, Number(idleInRadiusCount) || 0) <= 0;
}

function canOfferNextTripToBusyDriver({
  driverId,
  currentTrip,
  excludedDriverIds,
  reservedNextDriverIds,
} = {}) {
  if (!driverId || !currentTrip?.id) return false;
  if (String(currentTrip.driver_id || '') !== String(driverId)) return false;
  if (!LIVE_NEXT_STATUSES.includes(String(currentTrip.status || '').toLowerCase())) return false;
  if (getNextAfterTripId(currentTrip)) return false;
  if (excludedDriverIds instanceof Set && excludedDriverIds.has(driverId)) return false;
  if (Array.isArray(excludedDriverIds) && excludedDriverIds.includes(driverId)) return false;
  if (reservedNextDriverIds instanceof Set && reservedNextDriverIds.has(driverId)) return false;
  if (Array.isArray(reservedNextDriverIds) && reservedNextDriverIds.includes(driverId)) return false;
  return true;
}

function resolveBusyAnchorCoords(currentTrip, driver) {
  const destLat = toFiniteNumber(currentTrip?.destination_lat);
  const destLng = toFiniteNumber(currentTrip?.destination_lng);
  if (destLat != null && destLng != null) {
    return { lat: destLat, lng: destLng, source: 'dropoff' };
  }
  const gpsLat = toFiniteNumber(driver?.current_lat);
  const gpsLng = toFiniteNumber(driver?.current_lng);
  if (gpsLat != null && gpsLng != null) {
    return { lat: gpsLat, lng: gpsLng, source: 'gps' };
  }
  return null;
}

function pickBusyNextTripCandidate({
  pickupLat,
  pickupLng,
  allowedRadiiKm = [],
  busyDrivers = [],
  currentTripByDriverId = {},
  excludedDriverIds = [],
  reservedNextDriverIds = [],
  preferredDriverId = null,
  preferredOnly = false,
} = {}) {
  const pickupLatN = toFiniteNumber(pickupLat);
  const pickupLngN = toFiniteNumber(pickupLng);
  if (pickupLatN == null || pickupLngN == null) return null;

  const radii = Array.isArray(allowedRadiiKm) && allowedRadiiKm.length
    ? allowedRadiiKm.map((km) => Number(km)).filter((km) => Number.isFinite(km) && km > 0)
    : [];
  if (!radii.length) return null;

  const excluded = excludedDriverIds instanceof Set ? excludedDriverIds : new Set(excludedDriverIds || []);
  const reserved = reservedNextDriverIds instanceof Set
    ? reservedNextDriverIds
    : new Set(reservedNextDriverIds || []);

  let pool = Array.isArray(busyDrivers) ? busyDrivers.filter((driver) => driver?.id) : [];
  if (preferredDriverId) {
    const preferred = pool.filter((driver) => driver.id === preferredDriverId);
    if (preferredOnly) pool = preferred;
    else if (preferred.length) pool = preferred.concat(pool.filter((driver) => driver.id !== preferredDriverId));
  } else if (preferredOnly) {
    return null;
  }

  const scored = [];
  for (const driver of pool) {
    const currentTrip = currentTripByDriverId?.[driver.id] || currentTripByDriverId[String(driver.id)];
    if (!canOfferNextTripToBusyDriver({
      driverId: driver.id,
      currentTrip,
      excludedDriverIds: excluded,
      reservedNextDriverIds: reserved,
    })) continue;

    const anchor = resolveBusyAnchorCoords(currentTrip, driver);
    if (!anchor) continue;

    const distanceKm = haversineKm(anchor.lat, anchor.lng, pickupLatN, pickupLngN);
    scored.push({
      driver,
      currentTrip,
      currentTripId: currentTrip.id,
      distanceKm,
      scoreKm: distanceKm,
      nextTrip: true,
      anchorSource: anchor.source,
    });
  }

  scored.sort((a, b) => {
    if (a.scoreKm !== b.scoreKm) return a.scoreKm - b.scoreKm;
    return a.distanceKm - b.distanceKm;
  });

  for (const radiusKm of radii) {
    const inRadius = scored.filter((item) => item.distanceKm <= radiusKm);
    if (inRadius.length > 0) {
      return {
        ...inRadius[0],
        radiusKm,
        allowedRadiiKm: radii,
      };
    }
  }

  return null;
}

function buildNextTripOfferAssignUpdate({
  driverId,
  currentTripId,
  assignedAt,
} = {}) {
  const at = assignedAt || new Date().toISOString();
  return {
    driver_id: driverId,
    status: 'pending',
    assigned_at: at,
    dispatch_status: 'waiting_acceptance',
    next_after_trip_id: currentTripId,
    next_trip_offered_at: at,
  };
}

function buildAcceptAsNextTripUpdate({ acceptedAt } = {}) {
  return {
    status: 'accepted',
    accepted_at: acceptedAt || new Date().toISOString(),
    dispatch_status: 'accepted',
  };
}

function buildActivateNextTripUpdate({ acceptedAt } = {}) {
  return {
    status: 'going_to_pickup',
    next_after_trip_id: null,
    next_trip_offered_at: null,
    dispatch_status: 'accepted',
    accepted_at: acceptedAt || new Date().toISOString(),
  };
}

function shouldAcceptAsNextTrip({ liveTrip, offerTripId } = {}) {
  if (!shouldTreatAsLiveDriverTrip(liveTrip)) return false;
  if (!offerTripId) return false;
  return String(liveTrip.id) !== String(offerTripId);
}

function partitionDriverBusyTrips(trips, { ignoreTripId } = {}) {
  const liveBusyTrips = [];
  const reservedNextDriverIds = new Set();
  const pendingOfferDriverIds = new Set();
  const liveTripByDriverId = {};
  const reservedNextByDriverId = {};
  const ignore = ignoreTripId ? String(ignoreTripId) : null;

  for (const item of trips || []) {
    if (!item?.driver_id) continue;
    if (ignore && String(item.id) === ignore) continue;
    const status = String(item.status || '').toLowerCase();
    const nextAfter = getNextAfterTripId(item);
    if (nextAfter && RESERVED_NEXT_STATUSES.includes(status)) {
      reservedNextDriverIds.add(item.driver_id);
      reservedNextByDriverId[item.driver_id] = item;
      continue;
    }
    if (status === 'pending' && !nextAfter) {
      pendingOfferDriverIds.add(item.driver_id);
      continue;
    }
    if (LIVE_NEXT_STATUSES.includes(status) && !nextAfter) {
      liveBusyTrips.push(item);
      liveTripByDriverId[item.driver_id] = item;
    }
  }

  return {
    liveBusyTrips,
    reservedNextDriverIds,
    pendingOfferDriverIds,
    liveTripByDriverId,
    reservedNextByDriverId,
  };
}

function isNextTripUniqueViolation(error) {
  const code = String(error?.code || '');
  if (code !== '23505') return false;
  const haystack = `${error?.message || ''} ${error?.details || ''} ${error?.constraint || ''}`.toLowerCase();
  return haystack.includes('trips_one_reserved_next')
    || haystack.includes('trips_one_next_behind')
    || haystack.includes('next_after_trip_id');
}

function mergeDriversById(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const driver of list || []) {
      if (driver?.id && !map.has(driver.id)) map.set(driver.id, driver);
    }
  }
  return [...map.values()];
}

module.exports = {
  LIVE_NEXT_STATUSES,
  RESERVED_NEXT_STATUSES,
  haversineKm,
  getNextAfterTripId,
  isNextTripOffer,
  isReservedNextTrip,
  shouldTreatAsLiveDriverTrip,
  shouldFallbackToBusyDrivers,
  canOfferNextTripToBusyDriver,
  resolveBusyAnchorCoords,
  pickBusyNextTripCandidate,
  buildNextTripOfferAssignUpdate,
  buildAcceptAsNextTripUpdate,
  buildActivateNextTripUpdate,
  shouldAcceptAsNextTrip,
  partitionDriverBusyTrips,
  isNextTripUniqueViolation,
  mergeDriversById,
};
