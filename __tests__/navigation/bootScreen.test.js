const fs = require('fs');
const path = require('path');
import { shouldShowNavigationLoadingOverlay } from '../../src/hooks/useNavigationPersistence';

describe('pantalla de arranque', () => {
  it('no deja la raíz vacía mientras cargan las fuentes', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../App.js'), 'utf8');
    expect(src).not.toMatch(/if\s*\(!appReady\)\s*\{\s*return null;/);
    expect(src).toContain("backgroundColor: '#FFFFFF'");
  });

  it('usa tema claro para que Android no pinte la ventana en negro', () => {
    const appJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8'),
    );
    expect(appJson.expo.userInterfaceStyle).toBe('light');

    const styles = fs.readFileSync(
      path.join(__dirname, '../../android/app/src/main/res/values/styles.xml'),
      'utf8',
    );
    expect(styles).toContain('android:windowBackground');
    expect(styles).toContain('#FFFFFF');
  });

  it('el splash solo tapa mientras no hay navegación y sigue cargando', () => {
    expect(shouldShowNavigationLoadingOverlay({
      isLoading: true,
      showNavigation: false,
    })).toBe(true);
    expect(shouldShowNavigationLoadingOverlay({
      isLoading: true,
      showNavigation: true,
    })).toBe(false);
    expect(shouldShowNavigationLoadingOverlay({
      isLoading: false,
      showNavigation: false,
    })).toBe(false);
    expect(shouldShowNavigationLoadingOverlay({
      isLoading: false,
      showNavigation: true,
    })).toBe(false);
  });
});
