import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../../src/lib/maplibre', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  const MapView = ({ children }) => ReactLib.createElement(View, { accessibilityLabel: 'Mapa de carga' }, children);
  return {
    __esModule: true,
    default: {
      MapView,
      Camera: ({ children }) => children ?? null,
    },
  };
});

jest.mock('../../src/stores/locationStore', () => ({
  useLocationStore: (selector) => selector({ currentLocation: { lat: -24.7821, lng: -65.4232 } }),
}));

import { AppResumeSkeleton } from '../../src/components/ui/AppResumeSkeleton';

function collectLabels(node) {
  const labels = [];
  const visit = (current) => {
    if (!current) return;
    if (current.props?.accessibilityLabel) {
      labels.push(current.props.accessibilityLabel);
    }
    const children = current.children || [];
    children.forEach(visit);
  };
  visit(node);
  return labels;
}

describe('AppResumeSkeleton', () => {
  it('no renderiza nada si no está visible', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(<AppResumeSkeleton visible={false} />);
    });
    expect(renderer.toJSON()).toBeNull();
  });

  it('muestra el overlay de actualización sin bloquear con spinner', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(<AppResumeSkeleton visible />);
    });
    const json = renderer.toJSON();
    expect(json).toBeTruthy();
    const labels = collectLabels(json);
    expect(labels).toContain('Actualizando estado');
    expect(labels).toContain('Mapa de carga');
    expect(labels).toContain('Actualizando mapa…');
    expect(json.props?.accessibilityRole).toBe('progressbar');
  });
});
