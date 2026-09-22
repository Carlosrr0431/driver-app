import { useEffect, useRef, useState } from 'react';
import {
  extrapolateGps,
  getDistanceMeters,
  MAX_GPS_EXTRAPOLATE_MS,
  MOVING_SPEED_MPS,
  SMOOTH_MAP_FRAME_MS,
  shouldAcceptForwardGpsStep,
  shouldCommitMapPaint,
} from '../utils/locationWatch';

const DEFAULT_DURATION_MS = 1000;
const MIN_DURATION_MS = 400;
const MAX_DURATION_MS = 2200;

/**
 * Desliza el pin entre puntos GPS como el simulador del dashboard:
 * uniforme, sin retrocesos y sin quedarse congelado entre lecturas.
 */
export function useSmoothMapCoords(lat, lng, speedMps = 0, headingDeg = 0) {
  const [display, setDisplay] = useState({ lat, lng });
  const displayRef = useRef({ lat, lng });
  const bootRef = useRef(true);
  const animRef = useRef(0);
  const lastPaintRef = useRef(0);
  const lastTargetTimeRef = useRef(0);

  useEffect(() => {
    const target = { lat: Number(lat), lng: Number(lng) };
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return undefined;
    if (target.lat === 0 && target.lng === 0) return undefined;

    if (bootRef.current) {
      bootRef.current = false;
      displayRef.current = target;
      setDisplay(target);
      lastTargetTimeRef.current = performance.now();
      return undefined;
    }

    const start = displayRef.current;
    const distM = getDistanceMeters(start.lat, start.lng, target.lat, target.lng);
    if (distM < 0.8) return undefined;

    if (!shouldAcceptForwardGpsStep(
      { lat: start.lat, lng: start.lng, speed: speedMps, heading: headingDeg },
      target,
    )) {
      return undefined;
    }

    if (distM > 500) {
      clearTimeout(animRef.current);
      displayRef.current = target;
      setDisplay(target);
      lastTargetTimeRef.current = performance.now();
      return undefined;
    }

    clearTimeout(animRef.current);
    lastPaintRef.current = 0;

    const now = performance.now();
    const lastTargetTime = lastTargetTimeRef.current;
    lastTargetTimeRef.current = now;
    const timeDelta = lastTargetTime ? (now - lastTargetTime) : DEFAULT_DURATION_MS;
    const speed = Number(speedMps) || 0;

    let duration = DEFAULT_DURATION_MS;
    if (timeDelta > 200 && timeDelta < 3000) {
      duration = timeDelta * 1.05;
    } else if (speed > 1.0) {
      duration = (distM / speed) * 1000;
    }
    duration = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, duration));

    const startTime = now;
    const startLat = start.lat;
    const startLng = start.lng;

    const tick = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      let curLat = startLat + (target.lat - startLat) * progress;
      let curLng = startLng + (target.lng - startLng) * progress;
      let keepGoing = progress < 1;

      if (progress >= 1 && speed > MOVING_SPEED_MPS) {
        const extraMs = elapsed - duration;
        if (extraMs < MAX_GPS_EXTRAPOLATE_MS) {
          const coast = extrapolateGps(target.lat, target.lng, speed, headingDeg, extraMs);
          curLat = coast.lat;
          curLng = coast.lng;
          keepGoing = true;
        }
      }

      if (currentTime - lastPaintRef.current >= SMOOTH_MAP_FRAME_MS || !keepGoing) {
        const lastPaint = displayRef.current;
        if (
          !keepGoing
          || shouldCommitMapPaint({
            lastLat: lastPaint?.lat,
            lastLng: lastPaint?.lng,
            nextLat: curLat,
            nextLng: curLng,
          })
        ) {
          lastPaintRef.current = currentTime;
          displayRef.current = { lat: curLat, lng: curLng };
          setDisplay({ lat: curLat, lng: curLng });
        }
      }

      if (keepGoing) {
        animRef.current = setTimeout(() => tick(performance.now()), SMOOTH_MAP_FRAME_MS);
      }
    };

    animRef.current = setTimeout(() => tick(performance.now()), SMOOTH_MAP_FRAME_MS);
    return () => clearTimeout(animRef.current);
  }, [lat, lng, speedMps, headingDeg]);

  return display;
}
