import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import Toast from 'react-native-toast-message';

const mockLookup = jest.fn();
const mockProvision = jest.fn();
const mockSignIn = jest.fn();
const mockGetUser = jest.fn();
const mockGetSession = jest.fn();

jest.mock('../../src/services/assignedDriverService', () => ({
  lookupAssignedDriverLogin: (...args) => mockLookup(...args),
  provisionAssignedDriverAuth: (...args) => mockProvision(...args),
}));

jest.mock('../../src/services/supabase', () => ({
  supabase: {
    auth: {
      signUp: (...args) => mockSignUp(...args),
      signInWithPassword: (...args) => mockSignIn(...args),
      getUser: (...args) => mockGetUser(...args),
      getSession: (...args) => mockGetSession(...args),
      updateUser: jest.fn().mockResolvedValue({ error: null }),
    },
  },
}));

import { useAssignedDriverAuth } from '../../src/hooks/useAssignedDriverAuth';

function renderAssignedAuthHook() {
  const ref = { current: null };

  function Harness() {
    ref.current = useAssignedDriverAuth({
      fetchDriverProfile: jest.fn().mockResolvedValue({ id: 'd1', full_name: 'Juan' }),
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

describe('useAssignedDriverAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  });

  it('lookupPhone avanza a setup_password en primera vez', async () => {
    mockLookup.mockResolvedValue({
      found: true,
      driver_id: 'd1',
      auth_email: 'assigned.543878630173@profesional.test',
      password_initialized: false,
      has_user: false,
      full_name: 'Juan',
      vehicle_plate: 'AB123CD',
    });

    const ref = renderAssignedAuthHook();

    await act(async () => {
      await ref.current.lookupPhone('3878630173');
    });

    expect(ref.current.step).toBe('setup_password');
    expect(ref.current.lookupResult?.vehicle_plate).toBe('AB123CD');
  });

  it('lookupPhone avanza a password si ya tiene cuenta', async () => {
    mockLookup.mockResolvedValue({
      found: true,
      driver_id: 'd1',
      auth_email: 'assigned.543878630173@profesional.test',
      password_initialized: true,
      has_user: true,
      full_name: 'Juan',
    });

    const ref = renderAssignedAuthHook();

    await act(async () => {
      await ref.current.lookupPhone('3878630173');
    });

    expect(ref.current.step).toBe('password');
  });

  it('muestra error si el teléfono no está registrado', async () => {
    mockLookup.mockResolvedValue({ found: false });
    const ref = renderAssignedAuthHook();

    await act(async () => {
      await ref.current.lookupPhone('3878630173');
    });

    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ text1: 'No autorizado' }),
    );
    expect(ref.current.step).toBe('phone');
  });

  it('submitPasswordSetup provisiona cuenta, inicia sesión y completa login', async () => {
    const loginStore = jest.fn();
    const fetchDriverProfile = jest.fn().mockResolvedValue({ id: 'd1', full_name: 'Juan' });
    const ref = { current: null };

    function Harness() {
      ref.current = useAssignedDriverAuth({
        fetchDriverProfile,
        loginStore,
        setLoading: jest.fn(),
      });
      return null;
    }

    act(() => {
      TestRenderer.create(<Harness />);
    });

    mockLookup.mockResolvedValue({
      found: true,
      driver_id: 'd1',
      auth_email: 'assigned.543878630173@profesional.test',
      password_initialized: false,
      has_user: false,
      full_name: 'Juan',
    });
    mockProvision.mockResolvedValue({
      ok: true,
      auth_email: 'assigned.543878630173@profesional.test',
    });
    mockSignIn.mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    });

    await act(async () => {
      await ref.current.lookupPhone('3878630173');
    });

    act(() => {
      ref.current.setPassword('password123');
      ref.current.setConfirmPassword('password123');
    });

    await act(async () => {
      await ref.current.submitPasswordSetup();
    });

    expect(mockProvision).toHaveBeenCalledWith({
      driverId: 'd1',
      phone: '3878630173',
      password: 'password123',
    });
    expect(mockSignIn).toHaveBeenCalled();
    expect(fetchDriverProfile).toHaveBeenCalledWith('u1');
    expect(loginStore).toHaveBeenCalled();
  });
});
