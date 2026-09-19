import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => {
  const ReactLib = require('react');
  const { Text } = require('react-native');
  return {
    MaterialCommunityIcons: (props) => ReactLib.createElement(Text, props, props.name || 'icon'),
    Ionicons: (props) => ReactLib.createElement(Text, props, props.name || 'icon'),
  };
});

import { WhatsAppSourceBadge, WhatsAppTripThread } from '../../src/components/trip/WhatsAppTripThread';

function findByText(node, text) {
  const wanted = String(text);
  const matches = [];
  const visit = (current) => {
    if (!current) return;
    if (typeof current === 'string' && current.includes(wanted)) {
      matches.push(current);
    }
    const children = current?.props?.children;
    if (typeof children === 'string' && children.includes(wanted)) {
      matches.push(current);
    }
    if (Array.isArray(children)) {
      children.forEach(visit);
    } else if (children && typeof children === 'object') {
      visit(children);
    }
    const nested = current?.children;
    if (Array.isArray(nested)) nested.forEach(visit);
  };
  visit(node);
  return matches;
}

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

describe('WhatsAppTripThread', () => {
  it('no renderiza nada en viajes que no son de WhatsApp', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <WhatsAppTripThread visible={false} loading={false} messages={[{ id: '1', body: 'hola', direction: 'incoming' }]} />
      );
    });
    expect(renderer.toJSON()).toBeNull();
  });

  it('muestra el historial agencia/pasajero y no mezcla roles del chat del viaje', () => {
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <WhatsAppTripThread
          visible
          loading={false}
          messages={[
            {
              id: '1',
              direction: 'incoming',
              body: 'Un móvil a Mitre 300',
              created_at: '2026-08-23T22:00:00.000Z',
            },
            {
              id: '2',
              direction: 'outgoing',
              body: 'Ya te mando el móvil',
              created_at: '2026-08-23T22:00:20.000Z',
            },
          ]}
        />
      );
    });
    const json = renderer.toJSON();
    expect(findByText(json, 'WhatsApp de este viaje').length).toBeGreaterThan(0);
    expect(findByText(json, 'Mensajes entre la agencia y el pasajero').length).toBeGreaterThan(0);
    expect(findByText(json, 'Un móvil a Mitre 300').length).toBeGreaterThan(0);
    expect(findByText(json, 'Ya te mando el móvil').length).toBeGreaterThan(0);
    expect(findByText(json, 'Pasajero').length).toBeGreaterThan(0);
    expect(findByText(json, 'Agencia').length).toBeGreaterThan(0);
    expect(findByText(json, 'Remisera').length).toBe(0);
    expect(findByText(json, 'Chofer').length).toBe(0);
  });

  it('oculta el cartel si el viaje no tiene mensajes y muestra el badge de origen', () => {
    let thread;
    let badge;
    act(() => {
      thread = TestRenderer.create(<WhatsAppTripThread visible loading={false} messages={[]} />);
      badge = TestRenderer.create(<WhatsAppSourceBadge />);
    });
    expect(thread.toJSON()).toBeNull();
    expect(findByText(badge.toJSON(), 'WhatsApp').length).toBeGreaterThan(0);
  });

  it('puede expandir mensajes anteriores', () => {
    const messages = Array.from({ length: 8 }, (_, index) => ({
      id: String(index + 1),
      direction: index % 2 === 0 ? 'incoming' : 'outgoing',
      body: `mensaje ${index + 1}`,
      created_at: `2026-08-23T22:0${index}:00.000Z`,
    }));
    let renderer;
    act(() => {
      renderer = TestRenderer.create(
        <WhatsAppTripThread visible loading={false} messages={messages} />
      );
    });
    expect(findByText(renderer.toJSON(), 'mensaje 1').length).toBe(0);
    expect(findByText(renderer.toJSON(), 'mensaje 8').length).toBeGreaterThan(0);
    act(() => {
      const pressed = pressByLabel(renderer.root, 'Ver mensajes anteriores');
      expect(pressed).toBe(true);
    });
    expect(findByText(renderer.toJSON(), 'mensaje 1').length).toBeGreaterThan(0);
  });
});
