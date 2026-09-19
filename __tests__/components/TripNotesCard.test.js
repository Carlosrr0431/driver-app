import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => {
  const ReactLib = require('react');
  const { Text } = require('react-native');
  return {
    MaterialCommunityIcons: (props) => ReactLib.createElement(Text, props, props.name || 'icon'),
  };
});

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Warning: 'warning' },
  ImpactFeedbackStyle: { Heavy: 'heavy' },
}));

jest.mock('../../src/services/notifications', () => ({
  sendLocalNotification: jest.fn(() => Promise.resolve()),
}));

import {
  TripNotesMapButton,
  TripNotesOverlay,
} from '../../src/components/trip/TripNotesCard';

function findByLabel(node, label) {
  if (!node) return false;
  if (node.props?.accessibilityLabel === label) return true;
  const children = node.children || [];
  return children.some((child) => findByLabel(child, label));
}

describe('TripNotesMapButton', () => {
  it('muestra el botón circular de notas a la izquierda', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <TripNotesMapButton onPress={() => {}} bottom={160} left={12} />
      );
    });
    const json = renderer.toJSON();
    expect(findByLabel(renderer.root, 'Ver notas del viaje')).toBe(true);
    expect(json.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bottom: 160, left: 12 }),
      ]),
    );
  });

  it('se pinta cuando hay una nota actualizada', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <TripNotesMapButton highlighted onPress={() => {}} bottom={160} left={12} />
      );
    });
    expect(findByLabel(renderer.root, 'Notas actualizadas. Tocá para ver')).toBe(true);
  });
});

describe('TripNotesOverlay', () => {
  it('no renderiza si no hay texto', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <TripNotesOverlay visible text="" onClose={() => {}} />
      );
    });
    expect(renderer.toJSON()).toBeNull();
  });
});
