const { Resvg } = require('@resvg/resvg-js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');
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
  const isotipo = renderSvg(path.join(assetsDir, 'isotipo profesional-04.svg'), 600);
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
  const isotipoAdaptive = renderSvg(path.join(assetsDir, 'isotipo profesional-04.svg'), 500);
  const adaptiveLeft = Math.round((adaptiveSize - isotipoAdaptive.width) / 2);
  const adaptiveTop = Math.round((adaptiveSize - isotipoAdaptive.height) / 2);

  await sharp({
    create: { width: adaptiveSize, height: adaptiveSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: isotipoAdaptive.buffer, left: adaptiveLeft, top: adaptiveTop }])
    .png()
    .toFile(path.join(assetsDir, 'adaptive-icon.png'));
  console.log('adaptive-icon.png generado (' + adaptiveSize + 'x' + adaptiveSize + ')');

  // 4. logo.png: logo BLANCO transparente para la pantalla de carga JS
  const logoForLoading = renderSvg(path.join(assetsDir, 'Profesional app-02.svg'), 550, true);
  fs.writeFileSync(path.join(assetsDir, 'logo.png'), logoForLoading.buffer);
  console.log('logo.png generado (' + logoForLoading.width + 'x' + logoForLoading.height + ')');

  // 5. Android native splashscreen_logo (isotipo only — Android 12 uses circular mask)
  const resDir = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
  const splashSizes = { mdpi: 288, hdpi: 432, xhdpi: 576, xxhdpi: 864, xxxhdpi: 1152 };
  const whiteBg = { r: 255, g: 255, b: 255, alpha: 1 };
  for (const [density, size] of Object.entries(splashSizes)) {
    // Render isotipo at ~55% of canvas to fit within Android 12's circular safe zone
    const isotipoSplash = renderSvg(path.join(assetsDir, 'isotipo profesional-04.svg'), Math.round(size * 0.55));
    const dir = path.join(resDir, 'drawable-' + density);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await sharp({
      create: { width: size, height: size, channels: 4, background: whiteBg },
    })
      .composite([{
        input: isotipoSplash.buffer,
        left: Math.round((size - isotipoSplash.width) / 2),
        top: Math.round((size - isotipoSplash.height) / 2),
      }])
      .png()
      .toFile(path.join(dir, 'splashscreen_logo.png'));
    console.log('splashscreen_logo ' + density + ' OK (' + size + 'x' + size + ')');
  }
}

convertAssets().catch(console.error);
