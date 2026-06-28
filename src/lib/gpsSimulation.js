/** Estado global: simulación remota activa (solo dev / panel Sim. GPS). */
let gpsSimulationActive = false;

export function isGpsSimulationActive() {
  return gpsSimulationActive;
}

export function setGpsSimulationActive(active) {
  gpsSimulationActive = Boolean(active);
}
