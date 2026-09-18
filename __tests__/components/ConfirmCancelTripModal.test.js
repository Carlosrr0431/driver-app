import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => {
  const ReactLib = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: (props) => ReactLib.createElement(Text, props, props.name || 'icon'),
  };
});

import { ConfirmCancelTripModal } from '../../src/components/trip/ConfirmCancelTripModal';

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

describe('ConfirmCancelTripModal', () => {
  it('muestra el diálogo centrado y confirma o vuelve', () => {
    const onConfirm = jest.fn();
    const onDismiss = jest.fn();
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <ConfirmCancelTripModal
          visible
          onConfirm={onConfirm}
          onDismiss={onDismiss}
        />
      );
    });

    const text = collectText(renderer.toJSON());
    expect(text).toContain('¿Cancelar viaje?');
    expect(text).toContain('El pasajero sigue con el mismo viaje y se buscará otro chofer. Vos volvés al inicio.');
    expect(text).toContain('Cancelar viaje');
    expect(text).toContain('Volver');

    act(() => {
      pressByLabel(renderer.root, 'Volver');
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    act(() => {
      pressByLabel(renderer.root, 'Cancelar viaje');
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('en viaje en calle explica que se cancela y se vuelve al inicio', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <ConfirmCancelTripModal
          visible
          variant="streetHail"
          onConfirm={jest.fn()}
          onDismiss={jest.fn()}
        />
      );
    });

    const text = collectText(renderer.toJSON());
    expect(text).toContain('¿Cancelar viaje?');
    expect(text).toContain('Este viaje en calle se cancela y volvés al inicio.');
    expect(text).not.toContain('se buscará otro chofer');
    act(() => {
      renderer.unmount();
    });
  });
});
