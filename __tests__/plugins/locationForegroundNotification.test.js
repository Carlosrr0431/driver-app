const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const {
  LARGE_ICON_FILE,
  PATCH_MARKER,
  SMALL_ICON_FILE,
  copyNotificationDrawables,
  patchLocationTaskServiceSource,
} = require('../../plugins/locationForegroundNotification');

const ORIGINAL_KOTLIN = `package expo.modules.location.services

class LocationTaskService : Service() {
  fun startForeground(serviceOptions: Bundle) {
    val notification = buildServiceNotification(serviceOptions)
    startForeground(mServiceId, notification)
  }

  private fun buildServiceNotification(serviceOptions: Bundle): Notification {
    prepareChannel(mChannelId)
    val builder = Notification.Builder(this, mChannelId)
    val title = serviceOptions.getString("notificationTitle")
    val body = serviceOptions.getString("notificationBody")
    val color = colorStringToInteger(serviceOptions.getString("notificationColor"))

    title?.let { builder.setContentTitle(title) }
    body?.let { builder.setContentText(body) }
    color?.let {
      builder.setColorized(true).setColor(color)
    } ?: run {
      builder.setColorized(false)
    }

    return builder.setCategory(Notification.CATEGORY_SERVICE)
      .setSmallIcon(applicationInfo.icon)
      .build()
  }

  companion object {
    private var sServiceId = 481756
  }
}
`;

describe('patchLocationTaskServiceSource', () => {
  it('usa el drawable del isotipo y no colorea toda la notificación', () => {
    const { source, changed } = patchLocationTaskServiceSource(ORIGINAL_KOTLIN);
    expect(changed).toBe(true);
    expect(source).toContain(PATCH_MARKER);
    expect(source).toContain('getIdentifier("notification_icon"');
    expect(source).toContain('getIdentifier("notification_large_icon"');
    expect(source).toContain('setLargeIcon');
    expect(source).toContain('if (!body.isNullOrBlank())');
    expect(source).not.toContain('setColorized(true)');
    expect(source).not.toContain('notificationColor');
    expect(source).not.toMatch(/return builder\.setCategory\(Notification\.CATEGORY_SERVICE\)\s*\n\s*\.setSmallIcon\(applicationInfo\.icon\)/);
  });

  it('es idempotente', () => {
    const first = patchLocationTaskServiceSource(ORIGINAL_KOTLIN);
    const second = patchLocationTaskServiceSource(first.source);
    expect(second.changed).toBe(false);
    expect(second.source).toBe(first.source);
  });

  it('falla si el archivo nativo ya no tiene el small icon del launcher', () => {
    expect(() => patchLocationTaskServiceSource('class LocationTaskService')).toThrow(
      /applicationInfo\.icon/
    );
  });
});

describe('copyNotificationDrawables', () => {
  it('copia el isotipo monocromo y el logo a color', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fgs-notif-'));
    const assetsDir = path.join(tmp, 'assets');
    const drawableDir = path.join(tmp, 'android', 'app', 'src', 'main', 'res', 'drawable');
    const xxhdpiDir = path.join(tmp, 'android', 'app', 'src', 'main', 'res', 'drawable-xxhdpi');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.mkdirSync(drawableDir, { recursive: true });
    fs.mkdirSync(xxhdpiDir, { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, '../../assets/notification-icon-monochrome.png'),
      path.join(assetsDir, 'notification-icon-monochrome.png')
    );
    fs.copyFileSync(
      path.join(__dirname, '../../assets/notification-icon.png'),
      path.join(assetsDir, 'notification-icon.png')
    );
    fs.writeFileSync(path.join(xxhdpiDir, SMALL_ICON_FILE), 'old');

    const { copied, skipped } = copyNotificationDrawables(tmp);
    expect(skipped).toBe(false);
    expect(copied.some((file) => file.endsWith(SMALL_ICON_FILE))).toBe(true);
    expect(fs.existsSync(path.join(drawableDir, SMALL_ICON_FILE))).toBe(true);
    expect(fs.existsSync(path.join(drawableDir, LARGE_ICON_FILE))).toBe(true);
    expect(fs.readFileSync(path.join(xxhdpiDir, SMALL_ICON_FILE)).equals(
      fs.readFileSync(path.join(assetsDir, 'notification-icon-monochrome.png'))
    )).toBe(true);
  });
});

describe('notification-icon-monochrome.png', () => {
  it('es una silueta blanca sobre transparente, no un cuadrado opaco', async () => {
    const file = path.join(__dirname, '../../assets/notification-icon-monochrome.png');
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    });
    let transparent = 0;
    let opaque = 0;
    let whiteish = 0;
    let blackish = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 16) {
        transparent += 1;
        continue;
      }
      opaque += 1;
      const luma = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (luma > 200) whiteish += 1;
      else if (luma < 40) blackish += 1;
    }
    const total = info.width * info.height;
    expect(info.width).toBeGreaterThanOrEqual(96);
    expect(transparent / total).toBeGreaterThan(0.8);
    expect(blackish).toBe(0);
    expect(whiteish).toBeGreaterThan(200);
    expect(opaque).toBe(whiteish);
  });
});
