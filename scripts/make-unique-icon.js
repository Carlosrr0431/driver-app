const fs = require('fs');
const path = require('path');

const driverAssets = path.join(__dirname, '..', 'assets');
const srcIcon = path.join(driverAssets, 'icon.png');
const bak = path.join(driverAssets, 'icon-passenger-style-backup.png');

/**
 * No volver a hornear fondo navy ni el badge del auto:
 * esos elementos se veían como un cuadrado y un auto en el splash.
 * Este script solo restaura el isotipo limpio.
 */
function main() {
  if (!fs.existsSync(bak)) {
    console.error('No está icon-passenger-style-backup.png; no se restaura.');
    process.exit(1);
  }
  fs.copyFileSync(bak, srcIcon);
  console.log('OK: icon.png restaurado desde icon-passenger-style-backup.png (sin fondo navy ni auto).');
  console.log('Para adaptive-icon transparente: npm run assets');
}

main();
