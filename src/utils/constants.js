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
  going_to_pickup: '#6C63FF',
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
  DISTANCE_FILTER: 10,
};

export const TRIP_ACCEPT_TIMEOUT = 30;

export const DEFAULT_REGION = {
  latitude: -34.6037,
  longitude: -58.3816,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export const PAGINATION_LIMIT = 20;

export const EMERGENCY_PHONE = '911';
export const DISPATCHER_PHONE = '+5491100000000';
