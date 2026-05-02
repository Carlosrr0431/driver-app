/**
 * trip-lifecycle.test.js
 *
 * Test de integración end-to-end del lado del DRIVER-APP.
 * Simula el flujo completo que recibe el chofer:
 *
 *   Supabase Realtime INSERT (payload.new = trip)
 *     → callback de useRealtime
 *     → setPendingTrip(trip) → Zustand store
 *     → showNewTripModal = true
 *     → notificación local
 *     → haptics
 *
 *   Chofer acepta el viaje:
 *     pending → accepted → going_to_pickup → in_progress → completed
 *
 * Verifica que:
 *   1. El trip recibido del contrato compartido es procesado sin errores.
 *   2. El store pasa por todos los estados correctamente.
 *   3. Los estados de cancelación son manejados.
 *   4. El filtro de ruido GPS funciona durante in_progress.
 *   5. El trip con [APPROACH_ONLY] muestra destination_address como pickup.
 */

// ── Imports del contrato compartido ──────────────────────────────────────────
const contract = require('../../../shared/trip-contract');

// ── Imports del store ─────────────────────────────────────────────────────────
import { useTripStore } from '../../src/stores/tripStore';
import { TRIP_STATUS } from '../../src/utils/constants';

// ── Helpers de estado ─────────────────────────────────────────────────────────
function getState() {
  return useTripStore.getState();
}

function resetStore() {
  useTripStore.setState({
    activeTrip: null,
    pendingTrip: null,
    showNewTripModal: false,
    tripTimer: 0,
    tripStartTime: null,
    tripDistanceKm: 0,
    lastTrackingLocation: null,
  });
}

beforeEach(resetStore);
afterEach(resetStore);

// ─────────────────────────────────────────────────────────────────────────────
// Grupo 1 — El trip del contrato es compatible con el store
// ─────────────────────────────────────────────────────────────────────────────
describe('Contrato de datos — trip recibido vía Realtime', () => {
  it('el trip del contrato tiene todos los campos que driver-app necesita', () => {
    const trip = contract.makeTripPayload();
    const missing = contract.DRIVER_APP_READS_FIELDS.filter((f) => !(f in trip));
    expect(missing).toEqual([]);
  });

  it('setPendingTrip con el trip del contrato actualiza el store', () => {
    const trip = contract.makeTripPayload();
    getState().setPendingTrip(trip);

    expect(getState().pendingTrip).toEqual(trip);
    expect(getState().showNewTripModal).toBe(true);
  });

  it('el status inicial del trip recibido es pending', () => {
    const trip = contract.makeTripPayload();
    expect(trip.status).toBe(TRIP_STATUS.PENDING);
  });

  it('el payload Realtime tiene la estructura correcta', () => {
    const payload = contract.makeRealtimeInsertPayload();
    expect(payload.eventType).toBe('INSERT');
    expect(payload.new).toBeDefined();
    expect(payload.new.status).toBe('pending');
    expect(payload.new.notes).toContain('[APPROACH_ONLY]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Grupo 2 — Ciclo de vida completo del viaje
// ─────────────────────────────────────────────────────────────────────────────
describe('Ciclo de vida del viaje — pending → completed', () => {
  const BASE_TRIP = contract.makeTripPayload();

  it('pending → aceptar el viaje', () => {
    getState().setPendingTrip(BASE_TRIP);

    // El chofer acepta: se mueve el viaje de pending a active
    getState().setActiveTrip({ ...BASE_TRIP, status: TRIP_STATUS.ACCEPTED });
    getState().clearPendingTrip();

    expect(getState().activeTrip.status).toBe(TRIP_STATUS.ACCEPTED);
    expect(getState().pendingTrip).toBeNull();
    expect(getState().showNewTripModal).toBe(false);
  });

  it('accepted → going_to_pickup', () => {
    getState().setActiveTrip({ ...BASE_TRIP, status: TRIP_STATUS.ACCEPTED });
    getState().updateActiveTrip({ status: TRIP_STATUS.GOING_TO_PICKUP });

    expect(getState().activeTrip.status).toBe(TRIP_STATUS.GOING_TO_PICKUP);
  });

  it('going_to_pickup → in_progress', () => {
    getState().setActiveTrip({ ...BASE_TRIP, status: TRIP_STATUS.GOING_TO_PICKUP });
    getState().updateActiveTrip({ status: TRIP_STATUS.IN_PROGRESS });

    expect(getState().activeTrip.status).toBe(TRIP_STATUS.IN_PROGRESS);
  });

  it('in_progress → completed: limpia el store', () => {
    getState().setActiveTrip({ ...BASE_TRIP, status: TRIP_STATUS.IN_PROGRESS });
    getState().updateActiveTrip({ status: TRIP_STATUS.COMPLETED });
    getState().clearActiveTrip();

    expect(getState().activeTrip).toBeNull();
    expect(getState().tripDistanceKm).toBe(0);
  });

  it('el ciclo completo no deja estado residual', () => {
    // Simular ciclo completo
    getState().setPendingTrip(BASE_TRIP);
    getState().setActiveTrip({ ...BASE_TRIP, status: TRIP_STATUS.ACCEPTED });
    getState().clearPendingTrip();
    getState().updateActiveTrip({ status: TRIP_STATUS.GOING_TO_PICKUP });
    getState().updateActiveTrip({ status: TRIP_STATUS.IN_PROGRESS });
    getState().clearActiveTrip();

    const finalState = getState();
    expect(finalState.activeTrip).toBeNull();
    expect(finalState.pendingTrip).toBeNull();
    expect(finalState.showNewTripModal).toBe(false);
    expect(finalState.tripTimer).toBe(0);
    expect(finalState.tripDistanceKm).toBe(0);
    expect(finalState.tripStartTime).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Grupo 3 — Cancelación
// ─────────────────────────────────────────────────────────────────────────────
describe('Cancelación del viaje', () => {
  it('UPDATE cancelled actualiza el status en el store', () => {
    const trip = contract.makeTripPayload();
    getState().setActiveTrip({ ...trip, status: TRIP_STATUS.ACCEPTED });

    // Simular el UPDATE de Supabase Realtime (payload.new)
    const updatedTrip = { ...trip, status: TRIP_STATUS.CANCELLED, cancel_reason: 'Pasajero no encontrado' };
    getState().updateActiveTrip({ status: updatedTrip.status, cancel_reason: updatedTrip.cancel_reason });

    expect(getState().activeTrip.status).toBe(TRIP_STATUS.CANCELLED);
    expect(getState().activeTrip.cancel_reason).toBe('Pasajero no encontrado');
  });

  it('cancelled mientras pending: limpiar el modal', () => {
    const trip = contract.makeTripPayload();
    getState().setPendingTrip(trip);

    // El viaje se canceló antes de que el chofer acepte
    getState().clearPendingTrip();

    expect(getState().pendingTrip).toBeNull();
    expect(getState().showNewTripModal).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Grupo 4 — Acumulación de distancia GPS durante in_progress
// ─────────────────────────────────────────────────────────────────────────────
describe('Acumulación de distancia GPS', () => {
  const TRIP_IN_PROGRESS = contract.makeTripPayload({ status: TRIP_STATUS.IN_PROGRESS });

  const LOC_A = { lat: -24.7900, lng: -65.4100 };
  const LOC_B = { lat: -24.7950, lng: -65.4150 }; // ~700 m
  const LOC_C = { lat: -24.8000, lng: -65.4200 }; // ~700 m más

  it('acumula correctamente dos segmentos de movimiento', () => {
    useTripStore.setState({
      activeTrip: TRIP_IN_PROGRESS,
      lastTrackingLocation: LOC_A,
    });

    getState().addTripDistance(LOC_B);
    const distAB = getState().tripDistanceKm;
    expect(distAB).toBeGreaterThan(0);

    getState().addTripDistance(LOC_C);
    const distTotal = getState().tripDistanceKm;
    expect(distTotal).toBeGreaterThan(distAB);
  });

  it('no acumula distancia si el viaje no está in_progress', () => {
    const statuses = [TRIP_STATUS.PENDING, TRIP_STATUS.ACCEPTED, TRIP_STATUS.GOING_TO_PICKUP];
    for (const status of statuses) {
      resetStore();
      useTripStore.setState({
        activeTrip: { ...TRIP_IN_PROGRESS, status },
        lastTrackingLocation: LOC_A,
      });
      getState().addTripDistance(LOC_B);
      expect(getState().tripDistanceKm).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Grupo 5 — Semántica APPROACH_ONLY (interpretación del trip en driver-app)
// ─────────────────────────────────────────────────────────────────────────────
describe('Semántica APPROACH_ONLY', () => {
  it('un trip de contrato siempre es APPROACH_ONLY', () => {
    const trip = contract.makeTripPayload();
    expect(contract.isApproachOnlyTrip(trip)).toBe(true);
  });

  it('driver-app debe mostrar destination_address como punto de retiro', () => {
    const trip = contract.makeTripPayload();
    // La lógica del driver-app: si notas incluye [APPROACH_ONLY], el
    // pickup real del pasajero es destination_address (no origin_address)
    const isApproach = String(trip.notes || '').includes('[APPROACH_ONLY]');
    const pickupAddress = isApproach ? trip.destination_address : trip.origin_address;

    expect(pickupAddress).toBe(trip.destination_address);
    expect(pickupAddress).toBe('Belgrano 200, Salta');
  });

  it('un trip con destino final embebido es parseado correctamente', () => {
    const destJson = {
      address: 'España 500, Salta, Argentina',
      lat: -24.7860,
      lng: -65.4080,
    };
    const trip = contract.makeTripPayload({
      notes: `[APPROACH_ONLY] Texto. [FINAL_DEST_JSON:${JSON.stringify(destJson)}]`,
    });

    const extracted = contract.extractFinalDestFromNotes(trip.notes);
    expect(extracted).not.toBeNull();
    expect(extracted.address).toBe(destJson.address);
    expect(extracted.lat).toBe(destJson.lat);
    expect(extracted.lng).toBe(destJson.lng);
  });

  it('un trip sin destino embebido devuelve null al extraer', () => {
    const trip = contract.makeTripPayload();
    const extracted = contract.extractFinalDestFromNotes(trip.notes);
    expect(extracted).toBeNull();
  });
});
