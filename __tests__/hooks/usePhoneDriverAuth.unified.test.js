import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import Toast from 'react-native-toast-message';

const mockLookup = jest.fn();
const mockEmailLookup = jest.fn();

jest.mock('../../src/services/assignedDriverService', () => ({
  lookupAssignedDriverLogin: (...args) => mockLookup(...args),
  lookupDriverPhoneLogin: (...args) => mockLookup(...args),
  lookupDriverEmailLogin: (...args) => mockEmailLookup(...args),
  resolveUnifiedDriverPhoneLogin: (...args) => mockLookup(...args),
  provisionDriverPhoneAuth: jest.fn(),
  provisionDriverEmailAuth: jest.fn(),
  provisionAssignedDriverAuth: jest.fn(),
}));

jest.mock('../../src/services/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      getUser: jest.fn(),
      getSession: jest.fn(),
    },
  },
}));

import { usePhoneDriverAuth } from '../../src/hooks/usePhoneDriverAuth';

function renderUnifiedAuthHook() {
  const ref = { current: null };

  function Harness() {
    ref.current = usePhoneDriverAuth({
      fetchDriverProfile: jest.fn(),
      loginStore: jest.fn(),
      setLoading: jest.fn(),
    });
    return null;
  }

  act(() => {
    TestRenderer.create(<Harness />);
  });

  return ref;
}

describe('usePhoneDriverAuth — login unificado', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rechaza un teléfono incompleto antes de consultar', async () => {
    const ref = renderUnifiedAuthHook();

    await act(async () => {
      await ref.current.lookupPhone('3875');
    });

    expect(mockLookup).not.toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ text1: 'Teléfono inválido' }),
    );
  });

  it('normaliza 3875 345465 y detecta chofer asignado', async () => {
    mockLookup.mockResolvedValue({
      found: true,
      login_kind: 'assigned',
      driver_id: 'a1',
      auth_email: 'assigned.5493875345465@profesional.test',
      password_initialized: true,
      has_user: true,
      full_name: 'Juan',
    });

    const ref = renderUnifiedAuthHook();

    await act(async () => {
      await ref.current.lookupPhone('3875 345465');
    });

    expect(mockLookup).toHaveBeenCalledWith('5493875345465', null);
    expect(ref.current.step).toBe('password');
    expect(ref.current.lookupResult.login_kind).toBe('assigned');
    expect(ref.current.phone).toBe('3875345465');
  });

  it('detecta propietario cuando el lookup unificado lo devuelve', async () => {
    mockLookup.mockResolvedValue({
      found: true,
      login_kind: 'owner',
      driver_id: 'o1',
      auth_email: 'owner.2@profesional.test',
      password_initialized: false,
      has_user: false,
      full_name: 'Ana',
    });

    const ref = renderUnifiedAuthHook();

    await act(async () => {
      await ref.current.lookupPhone('3878630173');
    });

    expect(ref.current.step).toBe('setup_password');
    expect(ref.current.lookupResult.login_kind).toBe('owner');
  });

  it('pide elegir cuenta si el mismo teléfono es dueño y asignado', async () => {
    mockLookup.mockResolvedValue({
      found: false,
      needs_account_choice: true,
      assigned: {
        found: true,
        login_kind: 'assigned',
        full_name: 'Juan',
        auth_email: 'assigned.5493875345465@profesional.test',
        password_initialized: true,
        has_user: true,
      },
      owner: {
        found: true,
        login_kind: 'owner',
        full_name: 'Ana',
        auth_email: 'owner.2@profesional.test',
        password_initialized: true,
        has_user: true,
      },
    });

    const ref = renderUnifiedAuthHook();

    await act(async () => {
      await ref.current.lookupPhone('3875345465');
    });

    expect(ref.current.step).toBe('account_choice');

    act(() => {
      ref.current.chooseAccount('assigned');
    });

    expect(ref.current.step).toBe('password');
    expect(ref.current.lookupResult.login_kind).toBe('assigned');
  });

  it('si eligen propietario con varios móviles, pide el número de móvil', async () => {
    mockLookup.mockResolvedValue({
      found: false,
      needs_account_choice: true,
      assigned: {
        found: true,
        login_kind: 'assigned',
        full_name: 'Juan',
        password_initialized: true,
        has_user: true,
      },
      owner: {
        found: false,
        needs_driver_number: true,
        choices: [{ driver_number: 2, full_name: 'Ana', vehicle_plate: 'AB123CD' }],
      },
    });

    const ref = renderUnifiedAuthHook();

    await act(async () => {
      await ref.current.lookupPhone('3875345465');
    });

    act(() => {
      ref.current.chooseAccount('owner');
    });

    expect(ref.current.step).toBe('driver_number');
    expect(ref.current.driverChoices).toHaveLength(1);
  });

  it('busca por correo y pide la clave de correo', async () => {
    mockEmailLookup.mockResolvedValue({
      found: true,
      login_channel: 'email',
      login_kind: 'owner',
      driver_id: 'e1',
      login_email: 'juan@gmail.com',
      auth_email: 'juan@gmail.com',
      password_initialized: true,
      has_user: true,
      full_name: 'Juan',
    });

    const ref = renderUnifiedAuthHook();

    await act(async () => {
      await ref.current.lookupPhone('juan@gmail.com');
    });

    expect(mockLookup).not.toHaveBeenCalled();
    expect(mockEmailLookup).toHaveBeenCalledWith('juan@gmail.com');
    expect(ref.current.step).toBe('password');
    expect(ref.current.phone).toBe('juan@gmail.com');
    expect(ref.current.lookupResult.login_channel).toBe('email');
  });

  it('si el correo aún no tiene clave, pide crear la del correo', async () => {
    mockEmailLookup.mockResolvedValue({
      found: true,
      login_channel: 'email',
      login_kind: 'assigned',
      driver_id: 'e2',
      login_email: 'ana@gmail.com',
      auth_email: 'ana@gmail.com',
      password_initialized: false,
      has_user: false,
      full_name: 'Ana',
    });

    const ref = renderUnifiedAuthHook();

    await act(async () => {
      await ref.current.lookupPhone('Ana@Gmail.com');
    });

    expect(mockEmailLookup).toHaveBeenCalledWith('ana@gmail.com');
    expect(ref.current.step).toBe('setup_password');
  });
});
