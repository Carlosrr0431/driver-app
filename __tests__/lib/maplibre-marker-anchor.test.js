import { mapLegacyMarkerAnchor } from '../../src/lib/mapLegacyMarkerAnchor';

describe('mapLegacyMarkerAnchor', () => {
  it('convierte centro v10 a center v11', () => {
    expect(mapLegacyMarkerAnchor({ x: 0.5, y: 0.5 })).toBe('center');
  });

  it('convierte anclas de borde v10', () => {
    expect(mapLegacyMarkerAnchor({ x: 0.5, y: 0 })).toBe('top');
    expect(mapLegacyMarkerAnchor({ x: 0.5, y: 1 })).toBe('bottom');
    expect(mapLegacyMarkerAnchor({ x: 0, y: 0.5 })).toBe('left');
    expect(mapLegacyMarkerAnchor({ x: 1, y: 0.5 })).toBe('right');
    expect(mapLegacyMarkerAnchor({ x: 0, y: 0 })).toBe('top-left');
    expect(mapLegacyMarkerAnchor({ x: 1, y: 1 })).toBe('bottom-right');
  });

  it('respeta strings v11', () => {
    expect(mapLegacyMarkerAnchor('center')).toBe('center');
    expect(mapLegacyMarkerAnchor('bottom')).toBe('bottom');
  });

  it('usa center por defecto', () => {
    expect(mapLegacyMarkerAnchor(null)).toBe('center');
    expect(mapLegacyMarkerAnchor(undefined)).toBe('center');
    expect(mapLegacyMarkerAnchor({ x: 'bad', y: null })).toBe('center');
  });
});
