/**
 * Calificación de choferes (promedio + reseñas, estilo Google).
 * CommonJS para Jest (dashboard y apps) sin transformación extra.
 */

const STAR_HINTS = {
  1: 'Muy malo',
  2: 'Malo',
  3: 'Regular',
  4: 'Bueno',
  5: 'Excelente',
};

const RATING_COMMENT_MAX = 280;

function parseStars(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const stars = Math.round(n);
  if (stars < 1 || stars > 5) return null;
  return stars;
}

function sanitizeRatingComment(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.slice(0, RATING_COMMENT_MAX);
}

function formatReviewsCount(count) {
  const n = Math.max(0, Math.round(Number(count) || 0));
  if (n === 1) return '1 reseña';
  return `${n} reseñas`;
}

function formatAverageLabel(average) {
  const n = Number(average);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(1);
}

function emptyHistogram() {
  return [0, 0, 0, 0, 0];
}

function histogramFromDriver(driver) {
  return [1, 2, 3, 4, 5].map((star) => (
    Math.max(0, Math.round(Number(driver?.[`rating_star_${star}`]) || 0))
  ));
}

function computeRatingAggregate(starList) {
  const histogram = emptyHistogram();
  let total = 0;
  let sum = 0;

  (starList || []).forEach((raw) => {
    const stars = parseStars(raw);
    if (!stars) return;
    histogram[stars - 1] += 1;
    sum += stars;
    total += 1;
  });

  if (total === 0) {
    return { count: 0, average: null, histogram };
  }

  return {
    count: total,
    average: Math.round((sum / total) * 10) / 10,
    histogram,
  };
}

function summarizeDriverRating(driver) {
  const count = Math.max(0, Math.round(Number(driver?.rating_count) || 0));
  const histogram = histogramFromDriver(driver);

  if (count <= 0) {
    return {
      hasRatings: false,
      average: null,
      averageLabel: 'Nuevo',
      count: 0,
      countLabel: 'Sin reseñas',
      summaryLabel: 'Nuevo',
      compactLabel: 'Nuevo',
      histogram,
    };
  }

  const average = Number(driver?.rating);
  const safeAvg = Number.isFinite(average) ? average : null;
  const averageLabel = formatAverageLabel(safeAvg) || '—';
  const countLabel = formatReviewsCount(count);

  return {
    hasRatings: true,
    average: safeAvg,
    averageLabel,
    count,
    countLabel,
    summaryLabel: `${averageLabel} (${countLabel})`,
    compactLabel: `${averageLabel} · ${countLabel}`,
    histogram,
  };
}

function canRateCompletedTrip(trip) {
  const status = String(trip?.status || '').toLowerCase();
  return status === 'completed' && Boolean(trip?.driver_id);
}

function starHint(stars) {
  return STAR_HINTS[parseStars(stars)] || '';
}

module.exports = {
  STAR_HINTS,
  RATING_COMMENT_MAX,
  parseStars,
  sanitizeRatingComment,
  formatReviewsCount,
  formatAverageLabel,
  computeRatingAggregate,
  summarizeDriverRating,
  canRateCompletedTrip,
  starHint,
};
