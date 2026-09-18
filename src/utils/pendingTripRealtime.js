const PENDING = 'pending';
const CANCELLED = 'cancelled';

/**
 * Decide qué hacer con un UPDATE de trips en Realtime.
 * No depende de payload.old completo: sin REPLICA IDENTITY FULL, Supabase
 * suele mandar old vacío (solo id) y el modal de oferta no se cerraba.
 */
export function resolveDriverTripRealtimeActions({
  trip = {},
  previousTrip = {},
  driverId,
  pendingTripId = null,
  activeTripId = null,
} = {}) {
  const currentDriverId = String(driverId || '');
  const tripId = String(trip?.id || previousTrip?.id || '').trim();
  const statusNow = String(trip?.status || '').toLowerCase();
  const previousStatus = String(previousTrip?.status || '').toLowerCase();
  const ownsNow = Boolean(currentDriverId) && String(trip?.driver_id || '') === currentDriverId;
  const ownedBefore = Boolean(currentDriverId) && String(previousTrip?.driver_id || '') === currentDriverId;
  const isCurrentActive = Boolean(activeTripId) && tripId === String(activeTripId);
  const isCurrentPending = Boolean(pendingTripId) && tripId === String(pendingTripId);

  const relevant = Boolean(tripId) && (ownsNow || ownedBefore || isCurrentActive || isCurrentPending);

  const assignPending = relevant
    && ownsNow
    && statusNow === PENDING
    && (previousStatus !== PENDING || !ownedBefore);

  const clearPending = isCurrentPending && (
    statusNow !== PENDING
    || (Boolean(trip?.id) && !ownsNow)
  );

  const notifyCancelled = relevant && statusNow === CANCELLED && previousStatus !== CANCELLED;

  return {
    tripId,
    statusNow,
    relevant,
    assignPending,
    clearPending,
    notifyCancelled,
  };
}

export function isAcceptedOfferStatus(status) {
  return String(status || '').toLowerCase() === 'going_to_pickup';
}

export function isCancelledTripStatus(status) {
  return String(status || '').toLowerCase() === CANCELLED;
}
