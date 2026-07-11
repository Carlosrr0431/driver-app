const { Resvg } = require('@resvg/resvg-js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { generateNotificationAssets } = require('../../shared/generate-notification-assets');
const { generateLauncherPreview } = require('../../shared/generate-launcher-preview');
const { ADAPTIVE_ISOTIPO_WIDTH, ICON_ISOTIPO_WIDTH } = require('../../shared/launcher-icon-config');

const assetsDir = path.join(__dirname, '..', 'assets');
const resDir = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const MONTSERRAT_BOLD = path.join(assetsDir, 'Montserrat-Bold.ttf');

function renderSvg(svgPath, width, makeWhite) {
  let svgData = fs.readFileSync(svgPath, 'utf8');
  if (makeWhite) {
    // Replace all fill colors with white for visibility on dark backgrounds
    svgData = svgData.replace(/fill:\s*#[0-9a-fA-F]{3,6}/g, 'fill: #FFFFFF');
  }
  const fontFiles = fs.existsSync(MONTSERRAT_BOLD) ? [MONTSERRAT_BOLD] : [];
  const resvg = new Resvg(svgData, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles, loadSystemFonts: true },
  });
  const rendered = resvg.render();
  return { buffer: rendered.asPng(), width: rendered.width, height: rendered.height };
}

async function convertAssets() {
  const bgColor = { r: 15, g: 15, b: 26, alpha: 1 }; // #0F0F1A

  // 1. Splash screen: logo BLANCO centrado sobre fondo oscuro 1284x2778
  const splashW = 1284;
  const splashH = 2778;
  const logo = renderSvg(path.join(assetsDir, 'Profesional app-02.svg'), 700, true);
  const logoLeft = Math.round((splashW - logo.width) / 2);
  const logoTop = Math.round((splashH - logo.height) / 2);

  await sharp({
    create: { width: splashW, height: splashH, channels: 4, background: bgColor },
  })
    .composite([{ input: logo.buffer, left: logoLeft, top: logoTop }])
    .png()
    .toFile(path.join(assetsDir, 'splash.png'));
  console.log('splash.png generado (' + splashW + 'x' + splashH + ')');

  // 2. icon.png: isotipo 1024x1024 sobre fondo #0F0F1A
  const iconSize = 1024;
  const isotipo = renderSvg(path.join(assetsDir, 'isotipo profesional-04.svg'), ICON_ISOTIPO_WIDTH);
  const iconLeft = Math.round((iconSize - isotipo.width) / 2);
  const iconTop = Math.round((iconSize - isotipo.height) / 2);

  await sharp({
    create: { width: iconSize, height: iconSize, channels: 4, background: bgColor },
  })
    .composite([{ input: isotipo.buffer, left: iconLeft, top: iconTop }])
    .png()
    .toFile(path.join(assetsDir, 'icon.png'));
  console.log('icon.png generado (' + iconSize + 'x' + iconSize + ')');

  // 3. adaptive-icon.png: isotipo sobre fondo transparente (foreground layer)
  const adaptiveSize = 1024;
  const isotipoAdaptive = renderSvg(path.join(assetsDir, 'isotipo profesional-04.svg'), ADAPTIVE_ISOTIPO_WIDTH);
  const adaptiveLeft = Math.round((adaptiveSize - isotipoAdaptive.width) / 2);
  const adaptiveTop = Math.round((adaptiveSize - isotipoAdaptive.height) / 2);

  await sharp({
    create: { width: adaptiveSize, height: adaptiveSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: isotipoAdaptive.buffer, left: adaptiveLeft, top: adaptiveTop }])
    .png()
    .toFile(path.join(assetsDir, 'adaptive-icon.png'));
  console.log('adaptive-icon.png generado (' + adaptiveSize + 'x' + adaptiveSize + ')');

  // 4. logo.png — wordmark a color (login fondo blanco)
  const logoForLogin = renderSvg(path.join(assetsDir, 'Profesional app-02.svg'), 480);
  fs.writeFileSync(path.join(assetsDir, 'logo.png'), logoForLogin.buffer);
  console.log('logo.png generado (' + logoForLogin.width + 'x' + logoForLogin.height + ')');

  // 4b. logo-light.png — wordmark blanco (fondos oscuros)
  const logoForLoading = renderSvg(path.join(assetsDir, 'Profesional app-02.svg'), 550, true);
  fs.writeFileSync(path.join(assetsDir, 'logo-light.png'), logoForLoading.buffer);
  console.log('logo-light.png generado (' + logoForLoading.width + 'x' + logoForLoading.height + ')');

  // 5. Android native splashscreen_logo (isotipo only — Android 12 uses circular mask)
  const splashSizes = { mdpi: 288, hdpi: 432, xhdpi: 576, xxhdpi: 864, xxxhdpi: 1152 };
  const whiteBg = { r: 255, g: 255, b: 255, alpha: 1 };
  for (const [density, size] of Object.entries(splashSizes)) {
    // Keep extra padding for Android 12 splash safe zone to prevent top clipping.
    const isotipoSplash = renderSvg(path.join(assetsDir, 'isotipo profesional-04.svg'), Math.round(size * 0.46));
    const dir = path.join(resDir, 'drawable-' + density);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const splashTop = Math.round((size - isotipoSplash.height) / 2) + Math.round(size * 0.02);
    await sharp({
      create: { width: size, height: size, channels: 4, background: whiteBg },
    })
      .composite([{
        input: isotipoSplash.buffer,
        left: Math.round((size - isotipoSplash.width) / 2),
        top: splashTop,
      }])
      .png()
      .toFile(path.join(dir, 'splashscreen_logo.png'));
    console.log('splashscreen_logo ' + density + ' OK (' + size + 'x' + size + ')');
  }

  // 6. Iconos del launcher Android (mipmap)
  const { setIconAsync } = require('@expo/prebuild-config/build/plugins/icons/withAndroidIcons');
  const projectRoot = path.join(__dirname, '..');
  await setIconAsync(projectRoot, {
    icon: path.join(assetsDir, 'adaptive-icon.png'),
    backgroundColor: '#FFFFFF',
    backgroundImage: undefined,
    monochromeImage: undefined,
    isAdaptive: true,
  });
  console.log('ic_launcher mipmap OK');

  // 7. Vista previa launcher — fondo oscuro + ícono (blanco) + cuadrado guía (safe zone 66%)
  const previewCanvas = 560;
  const iconTile = 220;
  const adaptiveResized = await sharp(path.join(assetsDir, 'adaptive-icon.png'))
    .resize(iconTile, iconTile)
    .png()
    .toBuffer();
  const iconBuffer = await sharp({
    create: { width: iconTile, height: iconTile, channels: 4, background: whiteBg },
  })
    .composite([{ input: adaptiveResized, left: 0, top: 0 }])
    .png()
    .toBuffer();
  const safeSize = Math.round(iconTile * 0.66);
  const safeOffset = Math.round((iconTile - safeSize) / 2);
  const previewIconLeft = Math.round((previewCanvas - iconTile) / 2);
  const previewIconTop = Math.round((previewCanvas - iconTile) / 2) - 20;
  const guideSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${iconTile}" height="${iconTile}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${safeOffset}" y="${safeOffset}" width="${safeSize}" height="${safeSize}"
    fill="none" stroke="#E53935" stroke-width="3" stroke-dasharray="10 6" rx="8"/>
</svg>`);
  await sharp({
    create: {
      width: previewCanvas,
      height: previewCanvas + 80,
      channels: 4,
      background: { r: 26, g: 26, b: 30, alpha: 1 },
    },
  })
    .composite([
      { input: iconBuffer, left: previewIconLeft, top: previewIconTop },
      { input: guideSvg, left: previewIconLeft, top: previewIconTop },
      {
        input: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${previewCanvas}" height="80" xmlns="http://www.w3.org/2000/svg">
  <text x="${previewCanvas / 2}" y="34" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" fill="#FFFFFF">Profesional Conductor</text>
  <text x="${previewCanvas / 2}" y="58" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" fill="#9CA3AF">Cuadrado rojo = zona segura del launcher</text>
</svg>`),
        left: 0,
        top: previewCanvas,
      },
    ])
    .png()
    .toFile(path.join(assetsDir, 'icon-launcher-preview.png'));
  console.log('icon-launcher-preview.png OK');

  await generateLauncherPreview({
    sharp,
    renderSvg,
    assetsDir,
    currentIsotipoWidth: ADAPTIVE_ISOTIPO_WIDTH,
    appLabel: 'Profesional Conductor',
    appShortName: 'Conductor',
    accentColor: '#DC2626',
  });

  // 8. Ícono FCM + simulación antes/después
  await generateNotificationAssets({
    sharp,
    renderSvg,
    assetsDir,
    appLabel: 'Profesional Conductor',
    accentColor: '#DC2626',
    sampleTitle: 'Nuevo viaje disponible',
    sampleBody: 'Hay un pasajero cerca esperando conductor.',
  });
}

convertAssets().catch((err) => {
  console.error(err);
  process.exit(1);
});
