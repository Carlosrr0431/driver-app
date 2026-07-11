/**
 * Genera íconos y simulaciones de notificaciones push FCM para Android.
 * Usado por driver-app y passenger-app en scripts/convert-assets.js.
 */
const path = require('path');
const {
  LAUNCHER_CANVAS,
  ADAPTIVE_ISOTIPO_WIDTH,
} = require('./launcher-icon-config');

const WHITE_BG = { r: 255, g: 255, b: 255, alpha: 1 };
const BLACK_BG = { r: 0, g: 0, b: 0, alpha: 1 };
const NOTIFICATION_CANVAS = 256;
/** Solo para la columna "Antes" en la vista previa. */
const OLD_ISOTIPO_WIDTH = 600;

async function compositeAdaptiveOnWhite(sharp, adaptiveIconPath, canvasSize) {
  // Misma lógica que el launcher: capa foreground completa sobre fondo blanco.
  const adaptiveResized = await sharp(adaptiveIconPath)
    .resize(canvasSize, canvasSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: WHITE_BG },
  })
    .composite([{ input: adaptiveResized, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function buildLegacyNotificationIcon(sharp, renderSvg, isotipoSvgPath, canvasSize) {
  const isotipo = renderSvg(isotipoSvgPath, Math.round(canvasSize * (OLD_ISOTIPO_WIDTH / LAUNCHER_CANVAS)), true);
  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: BLACK_BG },
  })
    .composite([{
      input: isotipo.buffer,
      left: Math.round((canvasSize - isotipo.width) / 2),
      top: Math.round((canvasSize - isotipo.height) / 2),
    }])
    .png()
    .toBuffer();
}

async function buildMonochromeSmallIcon(sharp, renderSvg, isotipoSvgPath, canvasSize) {
  const isotipoWidth = Math.round(canvasSize * (ADAPTIVE_ISOTIPO_WIDTH / LAUNCHER_CANVAS));
  const isotipo = renderSvg(isotipoSvgPath, isotipoWidth, true);
  return sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{
      input: isotipo.buffer,
      left: Math.round((canvasSize - isotipo.width) / 2),
      top: Math.round((canvasSize - isotipo.height) / 2),
    }])
    .png()
    .toBuffer();
}

function notificationRowSvg({ width, label, title, body, iconDataUri, accentColor }) {
  const rowH = 96;
  const iconSize = 52;
  const iconX = 16;
  const iconY = Math.round((rowH - iconSize) / 2);
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${rowH}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <rect width="${width}" height="${rowH}" rx="12" fill="#FFFFFF"/>
  <clipPath id="iconClip"><circle cx="${iconX + iconSize / 2}" cy="${iconY + iconSize / 2}" r="${iconSize / 2}"/></clipPath>
  <image href="${iconDataUri}" x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" clip-path="url(#iconClip)"/>
  <circle cx="${iconX + iconSize / 2}" cy="${iconY + iconSize / 2}" r="${iconSize / 2}" fill="none" stroke="${accentColor}" stroke-width="1" opacity="0.15"/>
  <text x="${iconX + iconSize + 14}" y="34" font-family="Arial,sans-serif" font-size="11" fill="#9CA3AF">${label}</text>
  <text x="${iconX + iconSize + 14}" y="54" font-family="Arial,sans-serif" font-size="14" font-weight="600" fill="#111827">${title}</text>
  <text x="${iconX + iconSize + 14}" y="74" font-family="Arial,sans-serif" font-size="13" fill="#4B5563">${body}</text>
</svg>`);
}

async function bufferToDataUri(sharp, buffer) {
  const b64 = buffer.toString('base64');
  return `data:image/png;base64,${b64}`;
}

async function generateNotificationAssets({
  sharp,
  renderSvg,
  assetsDir,
  isotipoSvgPath,
  adaptiveIconPath,
  appLabel,
  accentColor,
  sampleTitle,
  sampleBody,
}) {
  const adaptivePath = adaptiveIconPath || path.join(assetsDir, 'adaptive-icon.png');
  const isotipoPath = isotipoSvgPath || path.join(assetsDir, 'isotipo profesional-04.svg');

  const displayIcon = await compositeAdaptiveOnWhite(sharp, adaptivePath, NOTIFICATION_CANVAS);
  await sharp(displayIcon).toFile(path.join(assetsDir, 'notification-icon.png'));
  console.log('notification-icon.png OK (fondo blanco + isotipo adaptive)');

  const smallIcon = await buildMonochromeSmallIcon(sharp, renderSvg, isotipoPath, 96);
  await sharp(smallIcon).toFile(path.join(assetsDir, 'notification-icon-monochrome.png'));
  console.log('notification-icon-monochrome.png OK');

  const legacyIcon = await buildLegacyNotificationIcon(sharp, renderSvg, isotipoPath, NOTIFICATION_CANVAS);

  const previewW = 720;
  const rowW = 340;
  const gap = 24;
  const headerH = 56;
  const rowH = 96;
  const footerH = 40;
  const previewH = headerH + rowH + gap + rowH + footerH;

  const beforeUri = await bufferToDataUri(sharp, legacyIcon);
  const afterUri = await bufferToDataUri(sharp, displayIcon);

  const beforeRow = notificationRowSvg({
    width: rowW,
    label: 'Antes',
    title: sampleTitle,
    body: sampleBody,
    iconDataUri: beforeUri,
    accentColor,
  });
  const afterRow = notificationRowSvg({
    width: rowW,
    label: 'Ahora',
    title: sampleTitle,
    body: sampleBody,
    iconDataUri: afterUri,
    accentColor,
  });

  const headerSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${previewW}" height="${headerH}" xmlns="http://www.w3.org/2000/svg">
  <text x="${previewW / 2}" y="34" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="600" fill="#FFFFFF">${appLabel}</text>
  <text x="${previewW / 2}" y="52" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" fill="#9CA3AF">Simulación ícono en notificación push FCM</text>
</svg>`);

  const footerSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${previewW}" height="${footerH}" xmlns="http://www.w3.org/2000/svg">
  <text x="${previewW / 2}" y="26" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#6B7280">FCM usa el ícono adaptive del launcher (fondo blanco + isotipo)</text>
</svg>`);

  const leftCol = Math.round((previewW - rowW * 2 - gap) / 2);
  await sharp({
    create: {
      width: previewW,
      height: previewH,
      channels: 4,
      background: { r: 30, g: 32, b: 38, alpha: 1 },
    },
  })
    .composite([
      { input: headerSvg, left: 0, top: 0 },
      { input: beforeRow, left: leftCol, top: headerH },
      { input: afterRow, left: leftCol + rowW + gap, top: headerH },
      { input: footerSvg, left: 0, top: headerH + rowH + gap },
    ])
    .png()
    .toFile(path.join(assetsDir, 'notification-preview-before-after.png'));
  console.log('notification-preview-before-after.png OK');
}

module.exports = { generateNotificationAssets };
