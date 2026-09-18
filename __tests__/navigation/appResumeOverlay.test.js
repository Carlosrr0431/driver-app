const fs = require('fs');
const path = require('path');

describe('overlay de rehidratación al volver a la app', () => {
  it('driver AppNavigator monta el skeleton de resume', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/navigation/AppNavigator.jsx'),
      'utf8',
    );
    expect(src).toContain('AppResumeBridge');
    expect(src).toContain('AppResumeSkeleton');
    expect(src).toContain('invalidateQueries');
  });

  it('passenger AppNavigator monta el skeleton de resume', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../passenger-app/src/navigation/AppNavigator.jsx'),
      'utf8',
    );
    expect(src).toContain('AppResumeBridge');
    expect(src).toContain('AppResumeSkeleton');
    expect(src).toContain('useAppResumeHydration');
  });
});
