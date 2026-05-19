export const TRIP_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  GOING_TO_PICKUP: 'going_to_pickup',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export const TRIP_STATUS_LABELS = {
  pending: 'Pendiente',
  accepted: 'Aceptado',
  going_to_pickup: 'En camino',
  in_progress: 'En curso',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

export const TRIP_STATUS_COLORS = {
  pending: '#FFA502',
  accepted: '#1E90FF',
  going_to_pickup: '#282e69',
  in_progress: '#2ECC71',
  completed: '#27AE60',
  cancelled: '#FF4757',
};

export const CANCEL_REASONS = [
  'Pasajero no encontrado',
  'Dirección incorrecta',
  'Problema con el vehículo',
  'Emergencia personal',
  'Pasajero canceló',
  'Otro motivo',
];

export const GPS_CONFIG = {
  TRACKING_INTERVAL: 5000,
  ACCURACY: 6,
  // Mínimo desplazamiento real (metros) para disparar una actualización
  // de background. Aumentado a 15 m para ignorar jitter de GPS parado
  // y evitar que el origen de la ruta "salte" a la vereda.
  DISTANCE_FILTER: 15,
};

const DEFAULT_TRIP_ACCEPT_TIMEOUT_SECONDS = 60;
const MIN_TRIP_ACCEPT_TIMEOUT_SECONDS = 20;
const MAX_TRIP_ACCEPT_TIMEOUT_SECONDS = 300;
const configuredTripAcceptTimeout = Number(
  process.env.EXPO_PUBLIC_TRIP_ACCEPT_TIMEOUT_SECONDS || DEFAULT_TRIP_ACCEPT_TIMEOUT_SECONDS
);
export const TRIP_ACCEPT_TIMEOUT = Number.isFinite(configuredTripAcceptTimeout)
  ? Math.max(
    MIN_TRIP_ACCEPT_TIMEOUT_SECONDS,
    Math.min(MAX_TRIP_ACCEPT_TIMEOUT_SECONDS, Math.round(configuredTripAcceptTimeout))
  )
  : DEFAULT_TRIP_ACCEPT_TIMEOUT_SECONDS;

export const DEFAULT_REGION = {
  latitude: -24.7821,
  longitude: -65.4232,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export const PAGINATION_LIMIT = 20;

export const EMERGENCY_PHONE = '911';
export const DISPATCHER_PHONE = '+5491100000000';

// Base URL for the passenger-facing real-time tracking page
export const TRACKING_BASE_URL = 'https://profesional-dashboard.vercel.app';
