const fs = require('fs');
const path = require('path');
import { resolveAndroidMapView } from '../../src/lib/mapAndroidView';

describe('resolveAndroidMapView', () => {
  it('usa TextureView para no tapar la UI con un hueco negro', () => {
    expect(resolveAndroidMapView()).toBe('texture');
    expect(resolveAndroidMapView(undefined)).toBe('texture');
    expect(resolveAndroidMapView('texture')).toBe('texture');
  });

  it('permite SurfaceView solo si se pide explícito', () => {
    expect(resolveAndroidMapView('surface')).toBe('surface');
  });

  it('el MapView de la app fuerza TextureView', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/lib/maplibre.js'),
      'utf8',
    );
    expect(src).toContain('resolveAndroidMapView(androidView)');
  });
});
