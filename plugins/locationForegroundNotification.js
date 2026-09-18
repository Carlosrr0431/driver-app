/**
 * Helpers nativos para la notificación persistente de GPS (expo-location FGS).
 * expo-location usa applicationInfo.icon (launcher opaco) → cuadrado negro.
 * Copiamos el isotipo monocromo/color y parcheamos LocationTaskService.kt.
 */
const fs = require('fs');
const path = require('path');

const PATCH_MARKER = 'profesional-fgs-notification-icon';
const SMALL_ICON_FILE = 'notification_icon.png';
const LARGE_ICON_FILE = 'notification_large_icon.png';
const MONO_ASSET = 'notification-icon-monochrome.png';
const COLOR_ASSET = 'notification-icon.png';

const KOTLIN_RELATIVE = path.join(
  'node_modules',
  'expo-location',
  'android',
  'src',
  'main',
  'java',
  'expo',
  'modules',
  'location',
  'services',
  'LocationTaskService.kt'
);

function detectNewline(source) {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function patchLocationTaskServiceSource(source) {
  if (typeof source !== 'string' || !source.includes('class LocationTaskService')) {
    throw new Error('LocationTaskService.kt inválido: no contiene LocationTaskService');
  }

  if (source.includes(PATCH_MARKER)) {
    return { source, changed: false };
  }

  if (!source.includes('setSmallIcon(applicationInfo.icon)')) {
    throw new Error('LocationTaskService.kt no usa applicationInfo.icon como small icon');
  }

  const nl = detectNewline(source);
  let next = source.replace(
    /\s*val color = colorStringToInteger\(serviceOptions\.getString\("notificationColor"\)\)\r?\n/,
    nl
  );

  next = next.replace(
    /title\?\.let \{ builder\.setContentTitle\(title\) \}\r?\n\s*body\?\.let \{ builder\.setContentText\(body\) \}\r?\n\s*color\?\.let \{\r?\n\s*builder\.setColorized\(true\)\.setColor\(color\)\r?\n\s*\} \?: run \{\r?\n\s*builder\.setColorized\(false\)\r?\n\s*\}/,
    [
      'title?.let { builder.setContentTitle(title) }',
      '    if (!body.isNullOrBlank()) {',
      '      builder.setContentText(body)',
      '    }',
      `    applyProfesionalNotificationIcons(builder) // ${PATCH_MARKER}`,
    ].join(nl)
  );

  next = next.replace(
    /return builder\.setCategory\(Notification\.CATEGORY_SERVICE\)\r?\n\s*\.setSmallIcon\(applicationInfo\.icon\)\r?\n\s*\.build\(\)/,
    'return builder.setCategory(Notification.CATEGORY_SERVICE).build()'
  );

  if (!next.includes(`applyProfesionalNotificationIcons(builder) // ${PATCH_MARKER}`)) {
    throw new Error('No se pudo insertar applyProfesionalNotificationIcons en LocationTaskService.kt');
  }

  const helper = [
    `  // ${PATCH_MARKER}`,
    '  private fun applyProfesionalNotificationIcons(builder: Notification.Builder) {',
    '    val smallIconRes = resources.getIdentifier("notification_icon", "drawable", packageName)',
    '    builder.setSmallIcon(if (smallIconRes != 0) smallIconRes else applicationInfo.icon)',
    '    val largeIconRes = resources.getIdentifier("notification_large_icon", "drawable", packageName)',
    '    if (largeIconRes != 0) {',
    '      val bitmap = android.graphics.BitmapFactory.decodeResource(resources, largeIconRes)',
    '      if (bitmap != null) builder.setLargeIcon(bitmap)',
    '    }',
    '  }',
    '',
    '  companion object {',
  ].join(nl);

  next = next.replace(/ {2}companion object \{/, helper);

  if (!next.includes('getIdentifier("notification_icon"')) {
    throw new Error('El parche de LocationTaskService.kt no dejó notification_icon');
  }
  if (next.includes('setColorized(true)')) {
    throw new Error('El parche no quitó setColorized(true)');
  }

  return { source: next, changed: true };
}

function listDrawableDirs(resDir) {
  if (!fs.existsSync(resDir)) return [];
  return fs.readdirSync(resDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('drawable'))
    .map((entry) => path.join(resDir, entry.name));
}

function copyNotificationDrawables(projectRoot) {
  const assetsDir = path.join(projectRoot, 'assets');
  const resDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res');
  const drawableDir = path.join(resDir, 'drawable');
  const monoSrc = path.join(assetsDir, MONO_ASSET);
  const colorSrc = path.join(assetsDir, COLOR_ASSET);

  if (!fs.existsSync(monoSrc)) {
    throw new Error(`Falta el isotipo monocromo de notificación: ${monoSrc}`);
  }
  if (!fs.existsSync(colorSrc)) {
    throw new Error(`Falta el isotipo a color de notificación: ${colorSrc}`);
  }
  if (!fs.existsSync(path.join(projectRoot, 'android'))) {
    return { copied: [], skipped: true };
  }

  fs.mkdirSync(drawableDir, { recursive: true });
  const copied = [];
  const dirs = listDrawableDirs(resDir);
  const targets = dirs.length > 0 ? dirs : [drawableDir];

  for (const dir of targets) {
    const dest = path.join(dir, SMALL_ICON_FILE);
    if (path.basename(dir) === 'drawable' || fs.existsSync(dest)) {
      fs.copyFileSync(monoSrc, dest);
      copied.push(dest);
    }
  }

  const largeDest = path.join(drawableDir, LARGE_ICON_FILE);
  fs.copyFileSync(colorSrc, largeDest);
  copied.push(largeDest);

  return { copied, skipped: false };
}

function applyLocationForegroundNotificationNative(projectRoot) {
  const result = { kotlinPatched: false, kotlinChanged: false, drawablesCopied: [] };
  const kotlinPath = path.join(projectRoot, KOTLIN_RELATIVE);

  if (fs.existsSync(kotlinPath)) {
    const original = fs.readFileSync(kotlinPath, 'utf8');
    const { source, changed } = patchLocationTaskServiceSource(original);
    if (changed) {
      fs.writeFileSync(kotlinPath, source);
    }
    result.kotlinChanged = changed;
    result.kotlinPatched = source.includes(PATCH_MARKER);
  }

  const copyResult = copyNotificationDrawables(projectRoot);
  result.drawablesCopied = copyResult.copied;
  result.drawablesSkipped = copyResult.skipped === true;
  return result;
}

module.exports = {
  PATCH_MARKER,
  SMALL_ICON_FILE,
  LARGE_ICON_FILE,
  MONO_ASSET,
  COLOR_ASSET,
  KOTLIN_RELATIVE,
  patchLocationTaskServiceSource,
  copyNotificationDrawables,
  applyLocationForegroundNotificationNative,
};
