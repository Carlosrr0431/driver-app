const fs = require('fs');
const path = require('path');

const SRC_ROOT = path.join(__dirname, '../../src');

function listJsxFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsxFiles(full);
    if (entry.isFile() && /\.(js|jsx)$/.test(entry.name)) return [full];
    return [];
  });
}

/**
 * `<Foo>` + `ref={x}` como hijo renderiza el objeto `{ current }` y React
 * tira: Objects are not valid as a React child (found: object with keys {current}).
 */
const CLOSED_TAG_THEN_REF = /<[A-Z][A-Za-z0-9.]*\s*>\s*\n\s*ref=\{/;

describe('JSX: refs no se renderizan como hijos', () => {
  it('ninguna pantalla cierra el tag y deja ref={...} como child', () => {
    const files = listJsxFiles(SRC_ROOT);
    const offenders = [];

    files.forEach((file) => {
      const src = fs.readFileSync(file, 'utf8');
      if (CLOSED_TAG_THEN_REF.test(src)) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    });

    expect(offenders).toEqual([]);
  });

  it('ActiveTrip usa BottomSheet con ref como prop, no como hijo', () => {
    const src = fs.readFileSync(
      path.join(SRC_ROOT, 'screens/ActiveTripScreen.jsx'),
      'utf8',
    );
    expect(src).toMatch(/<BottomSheet\s*\n\s*ref=\{bottomSheetRef\}/);
    expect(src).not.toMatch(/<BottomSheet>\s*\n\s*ref=\{bottomSheetRef\}/);
  });
});
