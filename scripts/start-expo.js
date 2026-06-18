/**
 * Arranca Metro para driver-app en el puerto 8081.
 * passenger-app usa 8082 — así ambas apps pueden correr a la vez.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const PORT = process.env.RCT_METRO_PORT || '8081';
const isWin = process.platform === 'win32';
const androidHome =
  process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const adb = path.join(androidHome, 'platform-tools', isWin ? 'adb.exe' : 'adb');

const env = { ...process.env };
delete env.NO_COLOR;
delete env.CI;

function tryAdbReverse() {
  try {
    const result = spawnSync(adb, ['reverse', `tcp:${PORT}`, `tcp:${PORT}`], {
      encoding: 'utf8',
    });
    if (result.status === 0) {
      console.log(`[driver-app] adb reverse tcp:${PORT} tcp:${PORT}`);
    }
  } catch {
    // adb no disponible (celular por Wi‑Fi)
  }
}

tryAdbReverse();

const expoArgs = [
  'expo',
  'start',
  '--dev-client',
  '--port',
  PORT,
  ...process.argv.slice(2),
];

console.log(`[driver-app] Metro en puerto ${PORT}`);

const result = spawnSync('npx', expoArgs, {
  stdio: 'inherit',
  env,
  shell: true,
});

process.exit(result.status ?? 1);
