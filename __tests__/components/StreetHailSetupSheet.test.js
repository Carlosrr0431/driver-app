import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => {
  const ReactLib = require('react');
  const { Text } = require('react-native');
  return {
    MaterialCommunityIcons: (props) => ReactLib.createElement(Text, props, props.name || 'icon'),
  };
});

jest.mock('react-native-gesture-handler', () => {
  const { Pressable } = require('react-native');
  return { Pressable };
});

jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 78,
}));

import { StreetHailSetupSheet } from '../../src/components/trip/StreetHailSetupSheet';

function pressByLabel(root, label) {
  const visit = (current) => {
    if (!current) return false;
    if (current.props?.accessibilityLabel === label && typeof current.props.onPress === 'function') {
      current.props.onPress();
      return true;
    }
    const children = current.children || [];
    return children.some(visit);
  };
  return visit(root);
}

function collectText(node) {
  const texts = [];
  const visit = (current) => {
    if (!current) return;
    if (typeof current === 'string') {
      texts.push(current);
      return;
    }
    const children = current?.props?.children;
    if (typeof children === 'string') texts.push(children);
    if (Array.isArray(children)) children.forEach(visit);
    else if (children && typeof children === 'object') visit(children);
    const nested = current?.children;
    if (Array.isArray(nested)) nested.forEach(visit);
  };
  visit(node);
  return texts.join(' ');
}

describe('StreetHailSetupSheet', () => {
  it('renderiza las opciones de destino con Cancelar adentro y snaps fijos', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <StreetHailSetupSheet
          onCancel={jest.fn()}
          onChooseFreeRide={jest.fn()}
          onConfirmDestination={jest.fn()}
        />
      );
    });

    const json = renderer.toJSON();
    const text = collectText(json);
    expect(text).toContain('Ir sin destino');
    expect(text).toContain('Cancelar viaje en calle');
    expect(Array.isArray(json.props.snapPoints)).toBe(true);
    expect(json.props.snapPoints.length).toBeGreaterThan(0);
    expect(json.props.snapPoints).not.toBeNull();
    expect(json.props.enableDynamicSizing).toBe(false);
    act(() => {
      renderer.unmount();
    });
  });

  it('Ir sin destino dispara el callback sin renderizar un ref como hijo', () => {
    const onChooseFreeRide = jest.fn();
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <StreetHailSetupSheet
          onCancel={jest.fn()}
          onChooseFreeRide={onChooseFreeRide}
          onConfirmDestination={jest.fn()}
        />
      );
    });

    act(() => {
      const pressed = pressByLabel(renderer.root, 'Ir sin destino');
      expect(pressed).toBe(true);
    });

    expect(onChooseFreeRide).toHaveBeenCalledTimes(1);
    expect(() => renderer.toJSON()).not.toThrow();
    act(() => {
      renderer.unmount();
    });
  });
});
