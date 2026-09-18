const path = require('path');
const { applyLocationForegroundNotificationNative } = require('./locationForegroundNotification');

const projectRoot = path.join(__dirname, '..');
const result = applyLocationForegroundNotificationNative(projectRoot);

if (!result.kotlinPatched) {
  console.warn('No se encontró LocationTaskService.kt para parchar el ícono FGS.');
} else if (result.kotlinChanged) {
  console.log('LocationTaskService.kt: ícono Profesional aplicado.');
} else {
  console.log('LocationTaskService.kt: parche FGS ya aplicado.');
}

if (result.drawablesSkipped) {
  console.log('android/ ausente: se omitió copiar drawables.');
} else {
  console.log(`Drawables de notificación: ${result.drawablesCopied.length} archivo(s).`);
}
