/**
 * Atrás nativo durante un viaje activo: no se sale hasta completar o cancelar.
 * En búsqueda de destino, el atrás vuelve al selector de modo.
 */

import { isStreetHailTrip } from '../../shared/trip-contract';
import { shouldTreatAsLiveDriverTrip } from '../../shared/next-trip';
import { DRIVER_RELEASE_REASON } from './constants';

export const ACTIVE_TRIP_BACK = {
  LEAVE: 'leave',
  STAY: 'stay',
  CHOOSE_DEST_MODE: 'choose_dest_mode',
};

const TERMINAL_STATUSES = new Set(['completed', 'cancelled']);

/** Viaje que todavía hay que manejar en ActiveTrip (no resumen ni historial). */
export function isLiveDriverTrip(trip) {
  return shouldTreatAsLiveDriverTrip(trip);
}

/** Preferí el store; el cache de React Query puede quedar stale al finalizar. */
export function resolveLiveTripForNavigation(storeTrip, queryTrip, ignoredTripId = null) {
  if (isLiveDriverTrip(storeTrip) && storeTrip.id !== ignoredTripId) return storeTrip;
  if (isLiveDriverTrip(queryTrip) && queryTrip.id !== ignoredTripId) return queryTrip;
  return null;
}

export function resolveActiveTripBackAction({
  hasActiveTrip,
  tripStatus,
  flowStep,
  destinationSet,
  allowLeave = false,
  showingSummary = false,
} = {}) {
  if (allowLeave || showingSummary) return ACTIVE_TRIP_BACK.LEAVE;
  if (!hasActiveTrip) return ACTIVE_TRIP_BACK.LEAVE;
  if (TERMINAL_STATUSES.has(String(tripStatus || ''))) return ACTIVE_TRIP_BACK.LEAVE;
  if (flowStep === 'set_destination' && !destinationSet) {
    return ACTIVE_TRIP_BACK.CHOOSE_DEST_MODE;
  }
  return ACTIVE_TRIP_BACK.STAY;
}

/**
 * Snap del bottom sheet en ActiveTrip.
 * 0 = mapa a la vista (navegación).
 * 1 = acciones visibles sin tapar el mapa (llegada, modo destino, buscar dirección).
 * 2 = el chofer lo abre a mano; nunca se usa en un snap automático.
 */
export function resolveActiveTripSheetIndex({
  flowStep,
  destinationSet = false,
  needsArrivalAction = false,
  canCancelEnRouteToPickup = false,
  canCancelActiveStreetHail = false,
} = {}) {
  void destinationSet;
  if (flowStep === 'set_destination') return 1;
  if (flowStep === 'choose_dest_mode') return 1;
  if (flowStep === 'at_pickup') return 1;
  if (needsArrivalAction) return 1;
  if (canCancelEnRouteToPickup) return 1;
  if (canCancelActiveStreetHail) return 1;
  return 0;
}

const PICKUP_CANCEL_STATUSES = new Set(['accepted', 'going_to_pickup']);
const PICKUP_CANCEL_BLOCKED_STATUSES = new Set(['in_progress', 'completed', 'cancelled']);

export function shouldRequeueTripForPassenger(trip) {
  if (!trip?.id) return false;
  if (isStreetHailTrip(trip)) return false;
  const status = String(trip.status || '');
  return PICKUP_CANCEL_STATUSES.has(status);
}

/** Cierra viajes en calle. No usar en pickup de pasajero (va a cola). */
export function buildDriverCancelTripUpdates(now = new Date()) {
  return {
    cancel_reason: DRIVER_RELEASE_REASON,
    wa_notified_at: now.toISOString(),
    dispatch_status: 'cancelled',
    next_dispatch_at: null,
  };
}

/**
 * El chofer puede cancelar solo mientras va al origen.
 * No aplica en viaje en calle ni cuando ya circula al destino.
 */
export function canDriverCancelEnRouteToPickup({
  flowStep,
  tripStatus,
  isStreetHail = false,
} = {}) {
  if (isStreetHail) return false;
  if (flowStep !== 'going_to_pickup') return false;
  const status = String(tripStatus || '');
  if (PICKUP_CANCEL_BLOCKED_STATUSES.has(status)) return false;
  return PICKUP_CANCEL_STATUSES.has(status);
}

/**
 * Viaje en calle ya activo (con destino o sin destino): el chofer puede cancelar
 * desde el bottom sheet, igual que de camino al origen en un pickup.
 */
export function canDriverCancelActiveStreetHail({
  isStreetHail = false,
  flowStep,
  tripStatus,
} = {}) {
  if (!isStreetHail) return false;
  if (flowStep !== 'in_progress') return false;
  const status = String(tripStatus || '');
  if (status === 'completed' || status === 'cancelled') return false;
  return status === 'in_progress';
}

export const DRIVER_CANCEL_CONFIRM = {
  DISMISS: 'dismiss',
  REQUEUE: 'requeue',
  CANCEL: 'cancel',
};

/** Qué hace el modal de confirmar cancelar, según pickup vs viaje en calle. */
export function resolveDriverCancelConfirmAction({
  isStreetHail = false,
  flowStep,
  tripStatus,
  trip = null,
} = {}) {
  const canPickup = canDriverCancelEnRouteToPickup({
    flowStep,
    tripStatus,
    isStreetHail,
  });
  const canStreet = canDriverCancelActiveStreetHail({
    isStreetHail,
    flowStep,
    tripStatus,
  });
  if (!canPickup && !canStreet) return DRIVER_CANCEL_CONFIRM.DISMISS;
  if (canPickup && shouldRequeueTripForPassenger(trip)) {
    return DRIVER_CANCEL_CONFIRM.REQUEUE;
  }
  return DRIVER_CANCEL_CONFIRM.CANCEL;
}

/**
 * Tope del sheet al buscar destino: deja el HUD y un tramo de mapa visibles.
 * `interactive` + `adjustResize` traducía el input hasta el status bar.
 */
export function resolveDestinationSearchTopInset({
  safeTop = 0,
  viewportHeight = 800,
  searching = false,
} = {}) {
  if (!searching) return 0;

  const height = Number(viewportHeight);
  const safeH = Number.isFinite(height) && height > 0 ? height : 800;
  const top = Number(safeTop);
  const safeTopPx = Number.isFinite(top) && top > 0 ? top : 0;

  const compact = safeH < 640;
  const navCard = compact ? 84 : safeH < 720 ? 96 : 104;
  const gap = compact ? 8 : 12;
  const desired = safeTopPx + 8 + navCard + gap;

  const minSheet = compact ? 200 : 248;
  const maxInset = Math.max(0, Math.round(safeH - minSheet));
  return Math.max(0, Math.min(Math.round(desired), maxInset));
}

/** `extend` crece hasta el snap máximo; no traduce el sheet encima del HUD. */
export function resolveDestinationSearchKeyboardBehavior(searching) {
  return searching ? 'extend' : 'interactive';
}

/** Gorhom puede emitir -1 aunque pan-down-to-close esté desactivado. */
export function clampBottomSheetIndex(index, fallback = 0) {
  const next = Number(index);
  if (!Number.isFinite(next) || next < 0) return fallback;
  return next;
}

/**
 * Un -1 con restore trabado, un overlay o el modal de cobro no deben
 * pelearse con el snap. Si no, el sheet queda cerrado y no se puede subir.
 */
export function shouldRestoreClosedBottomSheet({
  restoring = false,
  showingFinishModal = false,
  overlayOpen = false,
  showingCancelConfirm = false,
  sliderDragging = false,
} = {}) {
  if (
    showingFinishModal
    || overlayOpen
    || restoring
    || showingCancelConfirm
    || sliderDragging
  ) return false;
  return true;
}

export function recoverClosedBottomSheetIndex(restoreIndex, lastIndex) {
  return clampBottomSheetIndex(
    restoreIndex,
    clampBottomSheetIndex(lastIndex, 0),
  );
}

/** Un toque corto no activa el arrastre; un desliz vertical sí sube el sheet. */
export const SHEET_PAN_ACTIVE_OFFSET_Y = [-16, 16];
export const SHEET_PAN_FAIL_OFFSET_X = [-24, 24];

/**
 * El contenido se puede deslizar para abrir o cerrar el sheet.
 * Se apaga solo si un overlay o el slider pelean el gesto.
 */
export function shouldAllowSheetContentPan({
  showingFinishSlider = false,
  showingFinishModal = false,
  showingCancelConfirm = false,
  sliderDragging = false,
} = {}) {
  return !showingFinishSlider
    && !showingFinishModal
    && !showingCancelConfirm
    && !sliderDragging;
}

/** Snaps que dejan mapa + acciones visibles en pantallas chicas y landscape. */
export function resolveActiveTripSnapPoints({
  compactHeight = false,
  landscape = false,
} = {}) {
  if (landscape) return ['30%', '64%', '92%'];
  if (compactHeight) return ['26%', '58%', '88%'];
  return ['20%', '48%', '78%'];
}

/** No reanimar el sheet si ya está en el snap destino: en Android barato eso tilda el tap. */
export function shouldSnapActiveTripSheet(currentIndex, nextIndex, flowChanged = false) {
  const current = clampBottomSheetIndex(currentIndex, 0);
  const next = clampBottomSheetIndex(nextIndex, 0);
  if (next === current) return false;
  return Boolean(flowChanged) || next > current;
}

function toPositiveMeters(value) {
  const meters = Number(value);
  return Number.isFinite(meters) && meters > 0 ? meters : 0;
}

/**
 * La ruta de navegación se pide desde la GPS actual, así que distanceValue
 * es la distancia restante, no el total del tramo. Al rerutear hay que
 * conservar lo ya recorrido: nuevoBaseline = yaRecorrido + nuevaRuta.
 */
export function nextRouteBaselineMeters({
  previousBaselineMeters,
  previousRemainingMeters,
  newRouteMeters,
} = {}) {
  const nextRoute = toPositiveMeters(newRouteMeters);
  if (nextRoute <= 0) return toPositiveMeters(previousBaselineMeters);

  const previousBaseline = toPositiveMeters(previousBaselineMeters);
  const previousRemaining = Number(previousRemainingMeters);
  const alreadyTraveled = previousBaseline > 0 && Number.isFinite(previousRemaining)
    ? Math.max(0, previousBaseline - previousRemaining)
    : 0;

  return alreadyTraveled + nextRoute;
}

/** Progreso visible del tramo actual (Recorridos / Total / barra). */
export function resolveLegProgress({
  baselineMeters,
  remainingMeters,
  routeMeters,
  fallbackTotalKm = 0,
} = {}) {
  const baseline = toPositiveMeters(baselineMeters) || toPositiveMeters(routeMeters);
  const remaining = Number(remainingMeters);
  const fallbackKm = Number(fallbackTotalKm);
  const currentLegKm = baseline > 0
    ? baseline / 1000
    : (Number.isFinite(fallbackKm) && fallbackKm > 0 ? fallbackKm : 0);
  const currentLegTraveledKm = baseline > 0 && Number.isFinite(remaining)
    ? Math.max(0, (baseline - remaining) / 1000)
    : 0;

  return { currentLegKm, currentLegTraveledKm, baselineMeters: baseline };
}

function toNonNegativeKm(value) {
  const km = Number(value);
  return Number.isFinite(km) && km > 0 ? km : 0;
}

function toNonNegativeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/**
 * Bottom sheet de viajes sin destino / en calle (tarifa por km GPS).
 * Recorridos = km GPS (lo que el HUD muestra como Total).
 * Precio actual = misma fórmula que al completar: round(base + perKm * km).
 */
export function resolveMeteredRideProgress({
  tripDistanceKm = 0,
  accumulatedDistanceKm = 0,
  accumulatedPrice = 0,
  tariffBase = 0,
  tariffPerKm = 0,
} = {}) {
  const currentKm = toNonNegativeKm(tripDistanceKm);
  const priorKm = toNonNegativeKm(accumulatedDistanceKm);
  const traveledKm = priorKm > 0 && currentKm < priorKm
    ? priorKm + currentKm
    : Math.max(priorKm + currentKm, currentKm);
  const base = Number(tariffBase);
  const perKm = Number(tariffPerKm);
  const safeBase = Number.isFinite(base) ? base : 0;
  const safePerKm = Number.isFinite(perKm) && perKm > 0 ? perKm : 0;
  // La tarifa base se cobra una única vez para todo el viaje
  const currentPrice = Math.round(safeBase + safePerKm * traveledKm);

  return {
    traveledKm,
    totalKm: traveledKm > 0 ? traveledKm : null,
    currentPrice,
    etaSeconds: null,
    progressRatio: null,
    metered: true,
  };
}

/** Setup de viaje en calle (aún no empezó a circular). */
export function isStreetHailSetupFlow(flowStep) {
  return flowStep === 'choose_dest_mode' || flowStep === 'set_destination';
}

export const STREET_HAIL_SETUP_STEP = {
  CHOOSE: 'choose',
  SEARCH: 'search',
  CONFIRM: 'confirm',
};

/**
 * Snaps fijos: Gorhom 5 + React 19 se cae con enableDynamicSizing y
 * snapPoints null (renderiza un ref `{ current }` como hijo).
 * El cancelar sigue adentro del contenido; si no entra, el sheet scrollea.
 */
export function resolveStreetHailSetupSnaps({
  searching = false,
  compact = false,
} = {}) {
  if (searching) return ['100%'];
  return compact ? ['88%'] : ['70%'];
}

export function resolveStreetHailSetupUsesDynamicSizing(_searching) {
  return false;
}

export function resolveStreetHailSetupSheetIndex(_step) {
  return 0;
}

/** Tope del sheet para que quede mapa visible y las pestañas libres. */
export function resolveStreetHailSetupMaxContentSize({
  viewportHeight = 800,
  bottomInset = 0,
  compact = false,
} = {}) {
  const height = Number(viewportHeight);
  const safeH = Number.isFinite(height) && height > 0 ? height : 800;
  const bottom = Math.max(0, Number(bottomInset) || 0);
  const peek = compact
    ? Math.min(56, Math.round(safeH * 0.08))
    : Math.min(120, Math.round(safeH * 0.16));
  return Math.max(240, Math.round(safeH - bottom - peek));
}

/**
 * La tab bar de Home es `position: absolute`, así que el sheet tiene que
 * sentarse arriba. Con el teclado abierto NO sumar tab bar: Android ya
 * achica la ventana y Gorhom + inset dejaban solo el handle.
 */
export function resolveStreetHailSetupBottomInset(
  tabBarHeight = 0,
  safeBottom = 0,
  { searching = false } = {},
) {
  if (searching) return 0;
  const tab = Number(tabBarHeight);
  const safe = Number(safeBottom);
  if (Number.isFinite(tab) && tab > 0) return Math.round(tab);
  return Math.max(12, Number.isFinite(safe) && safe > 0 ? Math.round(safe) : 12);
}

/**
 * Tope al buscar destino en Home: deja el chip del chofer si hay lugar,
 * pero nunca achica el sheet por debajo del input + POIs.
 */
export function resolveStreetHailSearchTopInset({
  safeTop = 0,
  viewportHeight = 800,
} = {}) {
  const height = Number(viewportHeight);
  const safeH = Number.isFinite(height) && height > 0 ? height : 800;
  const top = Number(safeTop);
  const safeTopPx = Number.isFinite(top) && top > 0 ? top : 0;
  const compact = safeH < 480;
  const headerPeek = safeTopPx + (compact ? 8 : 52);
  const minSheet = compact ? 220 : 280;
  const maxInset = Math.max(0, Math.round(safeH - minSheet));
  return Math.max(0, Math.min(Math.round(headerPeek), maxInset));
}

export function resolveStreetHailSetupKeyboardBehavior(searching) {
  return searching ? 'fillParent' : 'extend';
}

export const FREE_RIDE_NOTES_MARKER = '[FREE_RIDE]';
const PLACEHOLDER_DESTINATION = 'a confirmar';

export function isPlaceholderDestinationAddress(address) {
  return String(address || '').trim().toLowerCase() === PLACEHOLDER_DESTINATION;
}

export function notesContainFreeRide(notes) {
  return String(notes || '').includes(FREE_RIDE_NOTES_MARKER);
}

export function appendFreeRideNotesMarker(notes) {
  const base = String(notes || '').trim();
  if (notesContainFreeRide(base)) return base || FREE_RIDE_NOTES_MARKER;
  return base ? `${base}\n${FREE_RIDE_NOTES_MARKER}` : FREE_RIDE_NOTES_MARKER;
}

function hasFiniteCoords(lat, lng) {
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  return Number.isFinite(parsedLat) && Number.isFinite(parsedLng);
}

/**
 * Destino real para navegación guiada. "A confirmar" no cuenta, aunque
 * hayan quedado coordenadas de origen copiadas en destination_*.
 */
export function hasGuidableDestination({
  trip = null,
  tripFinalDestination = null,
  hasPlannedMultiStopRoute = false,
} = {}) {
  if (hasPlannedMultiStopRoute) return true;

  const resolvedAddress = String(
    tripFinalDestination?.address || trip?.destination_address || '',
  ).trim();
  if (isPlaceholderDestinationAddress(resolvedAddress)) return false;

  if (hasFiniteCoords(tripFinalDestination?.lat, tripFinalDestination?.lng)) {
    return true;
  }

  if (!resolvedAddress) return false;
  return hasFiniteCoords(trip?.destination_lat, trip?.destination_lng);
}

/**
 * OSRM / HUD guiado solo con destino real.
 * Cubre el frame sucio: destinationSet ya true, flag de free ride todavía no.
 */
export function shouldFetchGuidedNavigationRoute({
  isFreeRide = false,
  flaggedFreeRide = false,
  flowStep,
  destinationSet = false,
  trip = null,
  tripFinalDestination = null,
  hasPlannedMultiStopRoute = false,
} = {}) {
  if (isFreeRide || flaggedFreeRide) return false;
  if (flowStep === 'in_progress' || destinationSet) {
    return hasGuidableDestination({
      trip,
      tripFinalDestination,
      hasPlannedMultiStopRoute,
    });
  }
  return true;
}

const EARTH_RADIUS_M = 6371000;
export const FREE_RIDE_TRACK_MIN_METERS = 10;
export const FREE_RIDE_TRACK_MAX_SEGMENT_METERS = 2000;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180)
    * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function toGpsTrackPoint(location) {
  const lat = Number(location?.lat ?? location?.latitude);
  const lng = Number(location?.lng ?? location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

/** Misma lógica de muestreo que addTripDistance: evita ruido GPS y saltos irreales. */
export function appendGpsTrackPoint(track, location, lastSample) {
  const nextPoint = toGpsTrackPoint(location);
  if (!nextPoint) return { track, lastSample };

  if (!lastSample) {
    return { track: [nextPoint], lastSample: nextPoint };
  }

  const distM = haversineMeters(
    lastSample.latitude,
    lastSample.longitude,
    nextPoint.latitude,
    nextPoint.longitude,
  );

  if (distM < FREE_RIDE_TRACK_MIN_METERS) {
    return { track, lastSample };
  }

  if (distM > FREE_RIDE_TRACK_MAX_SEGMENT_METERS) {
    return { track, lastSample: nextPoint };
  }

  return { track: [...track, nextPoint], lastSample: nextPoint };
}

/**
 * Viaje en curso sin destino: tarifa por km GPS, mapa 2D, sin OSRM.
 * `flaggedFreeRide` viene del store para no perder el modo entre renders.
 */
export function resolveFreeRideActive({
  flaggedFreeRide = false,
  flowStep,
  tripStatus,
  trip = null,
  tripFinalDestination = null,
  hasPlannedMultiStopRoute = false,
} = {}) {
  if (flaggedFreeRide) return true;

  const inProgress = flowStep === 'in_progress'
    || String(tripStatus || '') === 'in_progress';
  if (!inProgress) return false;
  if (notesContainFreeRide(trip?.notes)) return true;
  if (hasPlannedMultiStopRoute) return false;
  return !hasGuidableDestination({
    trip,
    tripFinalDestination,
    hasPlannedMultiStopRoute,
  });
}

/**
 * El HUD de "Llegaste" / maniobras solo va cuando hay navegación real.
 * En calle, antes de "Empezar viaje", el mapa debe verse normal.
 * Ir sin destino tampoco muestra el HUD: no hay ruta ni maniobras.
 */
export function shouldShowActiveTripNavHud({
  flowStep,
  isStreetHail = false,
  isFreeRide = false,
} = {}) {
  if (isFreeRide) return false;
  if (isStreetHail && flowStep !== 'in_progress') return false;
  return flowStep === 'going_to_pickup'
    || flowStep === 'at_pickup'
    || flowStep === 'in_progress';
}

/**
 * Si el viaje activo se borró, volver al Home salvo el resumen de cobro.
 * El modal de cancelación no debe retener al chofer: se renderiza detrás del
 * early-return en blanco y dejaba la app trabada sin mapa ni botón.
 */
export function shouldLeaveHomeWhenTripCleared({
  showingSummary = false,
  showingCancelledModal = false,
} = {}) {
  void showingCancelledModal;
  return !showingSummary;
}

/** Evita setState en cada GPS tick si el HUD de navegación no cambió. */
export function didNavigationHudChange(prev, next) {
  if (prev == null && next == null) return false;
  if (prev == null || next == null) return true;
  return prev.remainingDistanceMeters !== next.remainingDistanceMeters
    || prev.remainingDurationSeconds !== next.remainingDurationSeconds
    || prev.instruction !== next.instruction
    || prev.maneuver !== next.maneuver
    || prev.distanceToStepMeters !== next.distanceToStepMeters;
}

export const REROUTE_STALE_LOCK_MS = 6500;
export const REROUTE_OFF_ROUTE_METERS = 40;

/**
 * No frenar el recálculo si el chofer ya se desvió: remaining a lo largo
 * de la polilínea vieja puede quedar chico por el progreso monótono.
 */
export function shouldSkipAdaptiveReroute({
  flowStep,
  remainingDistanceMeters,
  deviationMeters,
  distanceToPickup,
  distanceToNavTarget,
  finishProximityMeters = 100,
} = {}) {
  if (flowStep === 'at_pickup') return true;

  const deviation = Number(deviationMeters);
  if (Number.isFinite(deviation) && deviation >= REROUTE_OFF_ROUTE_METERS) {
    return false;
  }

  if (flowStep === 'going_to_pickup') {
    const nearPickupByGps = Number.isFinite(distanceToPickup)
      && distanceToPickup <= finishProximityMeters;
    const nearPickupByRoute = Number.isFinite(remainingDistanceMeters)
      && remainingDistanceMeters <= 60
      && (
        !Number.isFinite(distanceToPickup)
        || distanceToPickup <= finishProximityMeters * 2.5
      );
    if (nearPickupByGps || nearPickupByRoute) return true;
  }

  const nearTargetByGps = Number.isFinite(distanceToNavTarget)
    && distanceToNavTarget <= finishProximityMeters;
  const nearTargetByRoute = Number.isFinite(remainingDistanceMeters)
    && remainingDistanceMeters <= finishProximityMeters
    && (
      !Number.isFinite(distanceToNavTarget)
      || distanceToNavTarget <= finishProximityMeters * 2.5
    );
  return nearTargetByGps || nearTargetByRoute;
}

/** Libera un lock colgado y evita superponer requests OSRM. */
export function canStartAdaptiveReroute({
  inFlight = false,
  lastRerouteAt = 0,
  now = Date.now(),
  cooldownMs = 3800,
  staleLockMs = REROUTE_STALE_LOCK_MS,
} = {}) {
  const elapsed = now - (Number(lastRerouteAt) || 0);
  const cooldown = Math.max(1500, Number(cooldownMs) || 3800);

  if (inFlight && elapsed < staleLockMs) {
    return { allow: false, releaseStaleLock: false };
  }
  if (inFlight && elapsed >= staleLockMs) {
    return {
      allow: elapsed >= cooldown,
      releaseStaleLock: true,
    };
  }
  if (elapsed < cooldown) {
    return { allow: false, releaseStaleLock: false };
  }
  return { allow: true, releaseStaleLock: false };
}

/**
 * Llegada real: remaining de la ruta solo cuenta si el GPS también está cerca.
 * Evita mostrar "finalizar" o abortar el reroute con una polilínea vieja.
 */
export function isGuidedArrivalNearby({
  remainingDistanceMeters,
  distanceToTarget,
  deviationMeters,
  finishProximityMeters = 100,
  onRouteMaxDeviationMeters = 45,
} = {}) {
  const deviation = Number(deviationMeters);
  const onRoute = !Number.isFinite(deviation) || deviation <= onRouteMaxDeviationMeters;
  const nearByGps = Number.isFinite(distanceToTarget)
    && distanceToTarget <= finishProximityMeters;
  const nearByRoute = onRoute
    && Number.isFinite(remainingDistanceMeters)
    && remainingDistanceMeters <= finishProximityMeters
    && (
      !Number.isFinite(distanceToTarget)
      || distanceToTarget <= finishProximityMeters * 2.5
    );
  return Boolean(nearByGps || nearByRoute);
}
