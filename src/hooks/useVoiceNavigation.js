import { useState, useRef, useCallback } from 'react';
import * as Speech from 'expo-speech';

// Umbrales de pre-aviso: 500m → 200m → 80m (igual al Navigation SDK)
const ANNOUNCE_THRESHOLDS = [500, 200, 80];

/**
 * Construye el texto de síntesis de voz dado un step de ruta y la distancia actual al mismo.
 * Produce frases naturales en rioplatense, equivalentes a las del Navigation SDK de Google Maps.
 */
function buildSpeechText(step, distanceMeters) {
  const maneuver = String(step?.maneuver || '').toLowerCase();
  const instruction = String(step?.instruction || '');

  // Extraer nombre de calle de la instrucción limpiada
  const roadMatch = instruction.match(/(?:por|en|hacia|a)\s+([A-ZÁÉÍÓÚÑÜ][^\n,]{2,30})/i);
  const roadName = roadMatch ? roadMatch[1].trim() : null;

  let action = 'seguí derecho';
  if (maneuver.includes('turn-right'))                action = 'doblá a la derecha';
  else if (maneuver.includes('turn-left'))             action = 'doblá a la izquierda';
  else if (maneuver.includes('turn-sharp-right'))      action = 'doblá fuerte a la derecha';
  else if (maneuver.includes('turn-sharp-left'))       action = 'doblá fuerte a la izquierda';
  else if (maneuver.includes('turn-slight-right'))     action = 'mantenete a la derecha';
  else if (maneuver.includes('turn-slight-left'))      action = 'mantenete a la izquierda';
  else if (maneuver.includes('uturn') || maneuver.includes('u-turn')) action = 'hacé una vuelta en U';
  else if (maneuver.includes('roundabout'))            action = 'tomá la rotonda';
  else if (maneuver.includes('fork-left') || maneuver.includes('keep-left'))   action = 'tomá por la izquierda';
  else if (maneuver.includes('fork-right') || maneuver.includes('keep-right')) action = 'tomá por la derecha';
  else if (maneuver.includes('ramp-left'))             action = 'tomá la rampa a la izquierda';
  else if (maneuver.includes('ramp-right'))            action = 'tomá la rampa a la derecha';
  else if (maneuver.includes('merge'))                 action = 'incorporáte al tráfico';
  else if (maneuver.includes('ferry'))                 action = 'tomá el ferry';
  else {
    // Fallback: buscar señales en el texto de la instrucción
    const instr = instruction.toLowerCase();
    if (instr.includes('derecha'))        action = 'doblá a la derecha';
    else if (instr.includes('izquierda')) action = 'doblá a la izquierda';
    else if (instr.includes('rotonda'))   action = 'tomá la rotonda';
  }

  const isTurnLike = action.includes('doblá') || action.includes('tomá') || action.includes('hacé') || action.includes('mantenete');
  const roadSuffix = roadName ? (isTurnLike ? ` en ${roadName}` : ` por ${roadName}`) : '';

  if (distanceMeters <= 80) {
    return `Ahora, ${action}${roadSuffix}`;
  }

  // Redondear a múltiplos de 50m para que suene natural en voz
  const roundedM = Math.round(distanceMeters / 50) * 50;
  const distStr = roundedM >= 1000
    ? `${(roundedM / 1000).toFixed(1)} kilómetros`
    : `${roundedM} metros`;

  return `En ${distStr}, ${action}${roadSuffix}`;
}

/**
 * Hook de guía de voz turn-by-turn, equivalente al Navigation SDK de Google Maps.
 *
 * Funcionalidades:
 * - Pre-anuncio a 500m, 200m y 80m de cada maniobra (no repite)
 * - "Recalculando la ruta" en cada desvío
 * - "Llegaste al punto de encuentro" al acercarse al pasajero
 * - "Llegaste a destino" al finalizar la navegación
 * - Botón de silenciar/activar con estado
 * - Cancela automáticamente la voz en curso al silenciar
 *
 * Uso:
 *   const { isMuted, toggleMute, announceManeuver, announceReroute,
 *           announcePickupArrival, announceDestinationArrival, resetAnnouncements } = useVoiceNavigation();
 */
export function useVoiceNavigation() {
  const [isMuted, setIsMuted] = useState(false);
  // Ref espejo para acceder al estado de mute desde callbacks sin crear dependencias circulares
  const isMutedRef = useRef(false);
  // Conjunto de claves ya anunciadas: evita repetir el mismo aviso
  const announcedRef = useRef(new Set());

  const speak = useCallback((text, priority = false) => {
    if (isMutedRef.current) return;

    Speech.isSpeakingAsync()
      .then((speaking) => {
        if (!speaking || priority) {
          if (speaking) Speech.stop();
          Speech.speak(text, {
            language: 'es-419', // Español latinoamericano — mayor compatibilidad Android/iOS
            rate: 1.05,
            pitch: 1.0,
          });
        }
      })
      .catch(() => {
        // Fallback: hablar directamente si isSpeakingAsync no está disponible
        Speech.speak(text, { language: 'es-419', rate: 1.05, pitch: 1.0 });
      });
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      if (next) {
        Speech.stop();
      }
      return next;
    });
  }, []);

  /**
   * Anuncia la maniobra entrante según la distancia al próximo paso.
   * Sistema de tres umbrales: 500m / 200m / 80m — mismo comportamiento que el Navigation SDK.
   * No repite un anuncio ya emitido para el mismo step y umbral.
   */
  const announceManeuver = useCallback((step, distanceMeters) => {
    if (!step || !Number.isFinite(distanceMeters) || distanceMeters <= 0) return;

    const stepIndex = Number.isFinite(step.index) ? step.index : -1;

    for (const threshold of ANNOUNCE_THRESHOLDS) {
      if (distanceMeters <= threshold) {
        const key = `step_${stepIndex}_${threshold}`;
        if (!announcedRef.current.has(key)) {
          announcedRef.current.add(key);
          speak(buildSpeechText(step, distanceMeters));
        }
        // No seguir revisando umbrales inferiores hasta el próximo tick
        return;
      }
    }
  }, [speak]);

  /** Anuncia "Recalculando la ruta" con prioridad (interrumpe voz en curso). */
  const announceReroute = useCallback(() => {
    speak('Recalculando la ruta', true);
  }, [speak]);

  /** Anuncia llegada al punto de encuentro del pasajero (solo una vez por viaje). */
  const announcePickupArrival = useCallback(() => {
    const key = 'pickup_arrived';
    if (announcedRef.current.has(key)) return;
    announcedRef.current.add(key);
    speak('Llegaste al punto de encuentro. El pasajero está esperando.', true);
  }, [speak]);

  /** Anuncia llegada al destino final (solo una vez por viaje). */
  const announceDestinationArrival = useCallback(() => {
    const key = 'destination_arrived';
    if (announcedRef.current.has(key)) return;
    announcedRef.current.add(key);
    speak('Llegaste a destino', true);
  }, [speak]);

  /** Limpia todos los anuncios registrados. Llamar al calcular una nueva ruta. */
  const resetAnnouncements = useCallback(() => {
    announcedRef.current = new Set();
  }, []);

  return {
    isMuted,
    toggleMute,
    announceManeuver,
    announceReroute,
    announcePickupArrival,
    announceDestinationArrival,
    resetAnnouncements,
  };
}
