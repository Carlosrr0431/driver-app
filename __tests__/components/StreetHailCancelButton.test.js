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

import { StreetHailCancelButton } from '../../src/components/trip/StreetHailCancelButton';

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

describe('StreetHailCancelButton', () => {
  it('muestra el label de cancelar viaje a ancho completo', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <StreetHailCancelButton label="Cancelar viaje" onPress={jest.fn()} />
      );
    });

    const json = renderer.toJSON();
    expect(collectText(json)).toContain('Cancelar viaje');
    expect(json.props.accessibilityLabel).toBe('Cancelar viaje');
    expect(json.props.accessibilityRole).toBe('button');
    const flatStyle = Array.isArray(json.props.style)
      ? Object.assign({}, ...json.props.style.filter(Boolean))
      : json.props.style;
    expect(flatStyle.width).toBe('100%');
    expect(flatStyle.minHeight).toBe(54);
  });

  it('usa el mismo label que el cancelar de pickup cuando el viaje está activo', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <StreetHailCancelButton label="Cancelar viaje" cancelling={false} onPress={jest.fn()} />
      );
    });

    const json = renderer.toJSON();
    expect(collectText(json)).toContain('Cancelar viaje');
    expect(json.props.accessibilityRole).toBe('button');
    expect(json.props.accessibilityLabel).toBe('Cancelar viaje');
    act(() => {
      renderer.unmount();
    });
  });

  it('muestra Cancelando mientras el viaje activo se cancela', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <StreetHailCancelButton label="Cancelar viaje" cancelling onPress={jest.fn()} />
      );
    });

    const json = renderer.toJSON();
    expect(collectText(json)).toContain('Cancelando…');
    expect(collectText(json)).not.toContain('Cancelar viaje');
    act(() => {
      renderer.unmount();
    });
  });
});
