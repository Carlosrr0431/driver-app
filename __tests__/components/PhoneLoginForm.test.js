import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => {
  const ReactLib = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: (props) => ReactLib.createElement(Text, props, props.name || 'icon'),
  };
});

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});

import { PhoneLoginForm } from '../../src/components/auth/PhoneLoginForm';

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

function pressContinue(tree) {
  const nodes = tree.root.findAll((node) => typeof node.props?.onPress === 'function');
  const button = nodes.find((node) => collectText(node).includes('Continuar'));
  act(() => {
    button.props.onPress();
  });
}

const baseProps = {
  step: 'phone',
  driverNumber: '',
  password: '',
  confirmPassword: '',
  setPhone: jest.fn(),
  setDriverNumber: jest.fn(),
  setPassword: jest.fn(),
  setConfirmPassword: jest.fn(),
  onPrimaryAction: jest.fn(),
};

describe('PhoneLoginForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('muestra un input simple de teléfono o correo, sin la receta', () => {
    let tree;
    act(() => {
      tree = TestRenderer.create(
        <PhoneLoginForm {...baseProps} phone="" />,
      );
    });

    const copy = collectText(tree.toJSON());
    expect(copy).toContain('Ingresá');
    expect(copy).toContain('Teléfono o correo');
    expect(copy).toContain('+54');
    expect(copy).not.toContain('CÓMO CARGARLO');
    expect(copy).not.toContain('El +54 ya está');
    expect(copy).not.toContain('Ingresar como propietario');
    expect(copy).not.toContain('Ingresar como chofer asignado');
  });

  it('marca en rojo si el chofer pone 0 adelante', () => {
    let tree;
    act(() => {
      tree = TestRenderer.create(
        <PhoneLoginForm {...baseProps} phone="03875" />,
      );
    });

    const copy = collectText(tree.toJSON());
    expect(copy).toContain('Sacá el 0 del principio');
  });

  it('al continuar vacío pide teléfono o correo', () => {
    const onPrimaryAction = jest.fn();
    let tree;
    act(() => {
      tree = TestRenderer.create(
        <PhoneLoginForm {...baseProps} phone="" onPrimaryAction={onPrimaryAction} />,
      );
    });

    pressContinue(tree);

    const copy = collectText(tree.toJSON());
    expect(copy).toContain('Ingresá tu teléfono o correo');
    expect(onPrimaryAction).not.toHaveBeenCalled();
  });

  it('marca en verde un teléfono completo', () => {
    let tree;
    act(() => {
      tree = TestRenderer.create(
        <PhoneLoginForm {...baseProps} phone="3875345465" />,
      );
    });

    expect(collectText(tree.toJSON())).toContain('Número listo');
  });

  it('marca en verde un correo completo', () => {
    let tree;
    act(() => {
      tree = TestRenderer.create(
        <PhoneLoginForm {...baseProps} phone="juan@gmail.com" />,
      );
    });

    const copy = collectText(tree.toJSON());
    expect(copy).toContain('Correo listo');
    expect(copy).not.toContain('+54');
  });

  it('muestra el tipo detectado al pedir la contraseña', () => {
    let tree;
    act(() => {
      tree = TestRenderer.create(
        <PhoneLoginForm
          {...baseProps}
          step="password"
          phone="3875345465"
          lookupResult={{ login_kind: 'assigned', vehicle_plate: 'AB123CD' }}
        />,
      );
    });

    const copy = collectText(tree.toJSON());
    expect(copy).toContain('Chofer asignado');
    expect(copy).toContain('+54 3875 345465');
    expect(copy).toContain('AB123CD');
  });
});
