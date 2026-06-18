import { format, formatDistanceToNow, parseISO, isToday, isThisWeek, isThisMonth } from 'date-fns';
import { es } from 'date-fns/locale';

export const formatDate = (dateString) => {
  if (!dateString) return '';
  const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
  return format(date, "d 'de' MMMM, yyyy", { locale: es });
};

export const formatDateTime = (dateString) => {
  if (!dateString) return '';
  const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
  return format(date, "d MMM yyyy, HH:mm", { locale: es });
};

export const formatTime = (dateString) => {
  if (!dateString) return '';
  const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
  return format(date, 'HH:mm', { locale: es });
};

export const formatRelativeTime = (dateString) => {
  if (!dateString) return '';
  const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
  return formatDistanceToNow(date, { addSuffix: true, locale: es });
};

export const formatPrice = (price) => {
  if (price == null) return '$0.00';
  return `$${Number(price).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export const formatDistance = (km) => {
  if (km == null) return '0 km';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${Number(km).toFixed(1)} km`;
};

export const formatDuration = (minutes) => {
  if (minutes == null) return '0 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hrs}h ${mins}min`;
};

export const formatTimerMMSS = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export const formatSpeed = (speed) => {
  if (speed == null || speed < 0) return '0 km/h';
  return `${Math.round(speed * 3.6)} km/h`;
};

export const isDateToday = (dateString) => {
  if (!dateString) return false;
  return isToday(parseISO(dateString));
};

export const isDateThisWeek = (dateString) => {
  if (!dateString) return false;
  return isThisWeek(parseISO(dateString), { locale: es });
};

export const isDateThisMonth = (dateString) => {
  if (!dateString) return false;
  return isThisMonth(parseISO(dateString));
};
