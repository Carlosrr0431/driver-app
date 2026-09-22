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

import { ChooseDestinationMode } from '../../src/components/trip/ChooseDestinationMode';

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

describe('ChooseDestinationMode', () => {
  it('en viaje en calle muestra Ir sin destino y Cancelar adentro del sheet', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChooseDestinationMode
          isStreetHail
          onChooseText={jest.fn()}
          onChooseFreeRide={jest.fn()}
          onCancel={jest.fn()}
        />
      );
    });

    const text = collectText(renderer.toJSON());
    expect(text).toContain('Ir sin destino');
    expect(text).toContain('Cancelar viaje en calle');
    expect(text).toContain('Viaje en calle');
  });

  it('Ir sin destino llama onChooseFreeRide sin romper el render', () => {
    const onChooseFreeRide = jest.fn();
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <ChooseDestinationMode
          isStreetHail
          onChooseText={jest.fn()}
          onChooseFreeRide={onChooseFreeRide}
          onCancel={jest.fn()}
        />
      );
    });

    act(() => {
      const pressed = pressByLabel(renderer.root, 'Ir sin destino');
      expect(pressed).toBe(true);
    });

    expect(onChooseFreeRide).toHaveBeenCalledTimes(1);
  });
});
