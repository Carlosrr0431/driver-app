/**
 * Simulación antes/después del ícono del launcher Android (adaptive icon).
 */
const path = require('path');

const WHITE_BG = { r: 255, g: 255, b: 255, alpha: 1 };
const LAUNCHER_CANVAS = 1024;
const LAUNCHER_OLD_ISOTIPO_WIDTH = 600;
const PREVIEW_ICON_SIZE = 200;

async function buildLauncherIcon(sharp, renderSvg, isotipoSvgPath, isotipoWidth) {
  const isotipo = renderSvg(isotipoSvgPath, isotipoWidth);
  const canvasSize = LAUNCHER_CANVAS;
  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: WHITE_BG },
  })
    .composite([{
      input: isotipo.buffer,
      left: Math.round((canvasSize - isotipo.width) / 2),
      top: Math.round((canvasSize - isotipo.height) / 2),
    }])
    .png()
    .toBuffer();
}

function launcherTileSvg({ width, label, iconDataUri, appShortName, accentColor, isotipoLabel }) {
  const tileH = 260;
  const iconSize = PREVIEW_ICON_SIZE;
  const iconX = Math.round((width - iconSize) / 2);
  const iconY = 36;
  const radius = Math.round(iconSize * 0.22);
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${tileH}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <text x="${width / 2}" y="22" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#9CA3AF">${label}</text>
  <rect x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="${radius}" fill="#FFFFFF" stroke="${accentColor}" stroke-width="1" opacity="0.2"/>
  <clipPath id="launcherClip"><rect x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" rx="${radius}"/></clipPath>
  <image href="${iconDataUri}" x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" clip-path="url(#launcherClip)"/>
  <text x="${width / 2}" y="${iconY + iconSize + 28}" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" fill="#E5E7EB">${appShortName}</text>
  <text x="${width / 2}" y="${iconY + iconSize + 48}" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#6B7280">${isotipoLabel}</text>
</svg>`);
}

async function bufferToDataUri(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function generateLauncherPreview({
  sharp,
  renderSvg,
  assetsDir,
  isotipoSvgPath,
  currentIsotipoWidth,
  appLabel,
  appShortName,
  accentColor,
}) {
  const isotipoPath = isotipoSvgPath || path.join(assetsDir, 'isotipo profesional-04.svg');

  const beforeIcon = await buildLauncherIcon(
    sharp,
    renderSvg,
    isotipoPath,
    LAUNCHER_OLD_ISOTIPO_WIDTH
  );
  const afterIcon = await buildLauncherIcon(
    sharp,
    renderSvg,
    isotipoPath,
    currentIsotipoWidth
  );

  const beforeUri = await bufferToDataUri(beforeIcon);
  const afterUri = await bufferToDataUri(afterIcon);

  const previewW = 720;
  const colW = 300;
  const gap = 24;
  const headerH = 56;
  const tileH = 260;
  const footerH = 44;
  const previewH = headerH + tileH + footerH;

  const beforeTile = launcherTileSvg({
    width: colW,
    label: 'Antes',
    iconDataUri: beforeUri,
    appShortName,
    accentColor,
    isotipoLabel: `isotipo ${LAUNCHER_OLD_ISOTIPO_WIDTH} px`,
  });
  const afterTile = launcherTileSvg({
    width: colW,
    label: 'Ahora',
    iconDataUri: afterUri,
    appShortName,
    accentColor,
    isotipoLabel: `isotipo ${currentIsotipoWidth} px`,
  });

  const headerSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${previewW}" height="${headerH}" xmlns="http://www.w3.org/2000/svg">
  <text x="${previewW / 2}" y="34" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="600" fill="#FFFFFF">${appLabel}</text>
  <text x="${previewW / 2}" y="52" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" fill="#9CA3AF">Simulación ícono del launcher (pantalla de inicio)</text>
</svg>`);

  const footerSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${previewW}" height="${footerH}" xmlns="http://www.w3.org/2000/svg">
  <text x="${previewW / 2}" y="26" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#6B7280">Adaptive icon: fondo blanco + isotipo (Android recorta en círculo/squircle)</text>
</svg>`);

  const leftCol = Math.round((previewW - colW * 2 - gap) / 2);

  await sharp({
    create: {
      width: previewW,
      height: previewH,
      channels: 4,
      background: { r: 26, g: 26, b: 30, alpha: 1 },
    },
  })
    .composite([
      { input: headerSvg, left: 0, top: 0 },
      { input: beforeTile, left: leftCol, top: headerH },
      { input: afterTile, left: leftCol + colW + gap, top: headerH },
      { input: footerSvg, left: 0, top: headerH + tileH },
    ])
    .png()
    .toFile(path.join(assetsDir, 'icon-launcher-preview-before-after.png'));
  console.log('icon-launcher-preview-before-after.png OK');
}

module.exports = { generateLauncherPreview, LAUNCHER_OLD_ISOTIPO_WIDTH };
