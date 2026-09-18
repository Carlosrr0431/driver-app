const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('../../src/services/supabase', () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
    from: (...args) => mockFrom(...args),
  },
}));

import {
  lookupAssignedDriverLogin,
  lookupDriverEmailLogin,
  lookupDriverPhoneLogin,
  resolveUnifiedDriverPhoneLogin,
  detectDriverLoginKind,
  linkAssignedDriverUser,
  setDriverOnlineStatus,
  fetchFleetOwnerProfile,
} from '../../src/services/assignedDriverService';

describe('assignedDriverService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('lookupDriverPhoneLogin', () => {
    it('normaliza el teléfono y devuelve el resultado del RPC unificado', async () => {
      mockRpc.mockResolvedValue({ data: { found: true, login_kind: 'owner' }, error: null });

      const result = await lookupDriverPhoneLogin('387 8630173');

      expect(mockRpc).toHaveBeenCalledWith('lookup_driver_phone_login', {
        p_phone: '5493878630173',
      });
      expect(result.found).toBe(true);
    });

    it('envía login_kind cuando se fuerza propietario o asignado', async () => {
      mockRpc.mockResolvedValue({ data: { found: true, login_kind: 'assigned' }, error: null });

      await lookupDriverPhoneLogin('3875345465', null, 'assigned');

      expect(mockRpc).toHaveBeenCalledWith('lookup_driver_phone_login', {
        p_phone: '5493875345465',
        p_login_kind: 'assigned',
      });
    });
  });

  describe('lookupDriverEmailLogin', () => {
    it('normaliza el correo y llama al RPC', async () => {
      mockRpc.mockResolvedValue({
        data: { found: true, login_channel: 'email', login_email: 'juan@gmail.com' },
        error: null,
      });

      const result = await lookupDriverEmailLogin('  Juan@Gmail.com ');

      expect(mockRpc).toHaveBeenCalledWith('lookup_driver_email_login', {
        p_email: 'juan@gmail.com',
      });
      expect(result.login_channel).toBe('email');
    });
  });

  describe('detectDriverLoginKind', () => {
    it('detecta solo asignado', () => {
      const detected = detectDriverLoginKind(
        { found: true, login_kind: 'assigned', full_name: 'Juan' },
        { found: false },
      );
      expect(detected.kind).toBe('assigned');
      expect(detected.result.full_name).toBe('Juan');
    });

    it('detecta solo propietario', () => {
      const detected = detectDriverLoginKind(
        { found: false },
        { found: true, login_kind: 'owner', full_name: 'Ana' },
      );
      expect(detected.kind).toBe('owner');
      expect(detected.result.full_name).toBe('Ana');
    });

    it('marca ambiguo si el mismo teléfono es dueño y asignado', () => {
      const detected = detectDriverLoginKind(
        { found: true, login_kind: 'assigned' },
        { found: true, login_kind: 'owner' },
      );
      expect(detected.kind).toBe('ambiguous');
    });

    it('marca ambiguo si hay asignado y varios móviles de titular', () => {
      const detected = detectDriverLoginKind(
        { found: true, login_kind: 'assigned' },
        { found: false, needs_driver_number: true, choices: [{ driver_number: 2 }] },
      );
      expect(detected.kind).toBe('ambiguous');
    });
  });

  describe('resolveUnifiedDriverPhoneLogin', () => {
    it('devuelve el asignado cuando solo existe esa cuenta', async () => {
      mockRpc.mockImplementation((_name, params) => {
        if (params.p_login_kind === 'assigned') {
          return Promise.resolve({
            data: { found: true, login_kind: 'assigned', full_name: 'Juan' },
            error: null,
          });
        }
        return Promise.resolve({ data: { found: false }, error: null });
      });

      const result = await resolveUnifiedDriverPhoneLogin('3875 345465');
      expect(result.login_kind).toBe('assigned');
      expect(result.full_name).toBe('Juan');
    });

    it('pide elegir cuenta cuando coinciden dueño y asignado', async () => {
      mockRpc.mockImplementation((_name, params) => {
        if (params.p_login_kind === 'assigned') {
          return Promise.resolve({
            data: { found: true, login_kind: 'assigned' },
            error: null,
          });
        }
        return Promise.resolve({
          data: { found: true, login_kind: 'owner' },
          error: null,
        });
      });

      const result = await resolveUnifiedDriverPhoneLogin('3875345465');
      expect(result.needs_account_choice).toBe(true);
      expect(result.found).toBe(false);
      expect(result.assigned.login_kind).toBe('assigned');
      expect(result.owner.login_kind).toBe('owner');
    });
  });

  describe('lookupAssignedDriverLogin', () => {
    it('normaliza el teléfono y devuelve el resultado del RPC', async () => {
      mockRpc.mockResolvedValue({
        data: { found: true, full_name: 'Juan Pérez' },
        error: null,
      });

      const result = await lookupAssignedDriverLogin('387 8630173');

      expect(mockRpc).toHaveBeenCalledWith('lookup_assigned_driver_login', {
        p_phone: '5493878630173',
      });
      expect(result.found).toBe(true);
      expect(result.full_name).toBe('Juan Pérez');
    });

    it('devuelve found false cuando no hay coincidencia', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      const result = await lookupAssignedDriverLogin('9999999999');
      expect(result).toEqual({ found: false });
    });

    it('propaga errores del RPC', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC falló' } });

      await expect(lookupAssignedDriverLogin('3878630173')).rejects.toEqual({
        message: 'RPC falló',
      });
    });
  });

  describe('linkAssignedDriverUser', () => {
    it('vincula el usuario cuando el RPC responde success', async () => {
      mockRpc.mockResolvedValue({
        data: { success: true, driver_id: 'driver-1' },
        error: null,
      });

      const result = await linkAssignedDriverUser('driver-1');

      expect(mockRpc).toHaveBeenCalledWith('link_assigned_driver_user', {
        p_driver_id: 'driver-1',
      });
      expect(result.success).toBe(true);
    });

    it('lanza error legible si el RPC devuelve success false', async () => {
      mockRpc.mockResolvedValue({
        data: { success: false, error: 'Chofer ya vinculado' },
        error: null,
      });

      await expect(linkAssignedDriverUser('driver-1')).rejects.toThrow('Chofer ya vinculado');
    });
  });

  describe('setDriverOnlineStatus', () => {
    it('cambia estado online cuando el RPC responde success', async () => {
      mockRpc.mockResolvedValue({
        data: { success: true, is_available: true },
        error: null,
      });

      const result = await setDriverOnlineStatus('driver-1', true);

      expect(mockRpc).toHaveBeenCalledWith('set_driver_online_status', {
        p_driver_id: 'driver-1',
        p_online: true,
      });
      expect(result.is_available).toBe(true);
    });

    it('propaga mensaje de exclusividad del vehículo', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: false,
          error: 'Otro chofer del mismo vehículo ya está en línea.',
        },
        error: null,
      });

      await expect(setDriverOnlineStatus('driver-1', true)).rejects.toThrow(
        'Otro chofer del mismo vehículo ya está en línea.',
      );
    });
  });

  describe('fetchFleetOwnerProfile', () => {
    it('devuelve el dueño raíz con todos los campos', async () => {
      const ownerRow = {
        id: 'owner-1',
        role: 'owner',
        driver_number: 2,
        vehicle_plate: 'AB123CD',
        is_assigned_driver: false,
        owner_id: null,
      };

      const maybeSingle = jest.fn().mockResolvedValue({ data: ownerRow, error: null });
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ maybeSingle }),
        }),
      });

      const result = await fetchFleetOwnerProfile('owner-1');

      expect(mockFrom).toHaveBeenCalledWith('drivers');
      expect(result).toEqual(ownerRow);
    });

    it('rechaza filas que no son dueño raíz', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({
        data: { id: 'a1', owner_id: 'owner-1', is_assigned_driver: true },
        error: null,
      });
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ maybeSingle }),
        }),
      });

      const result = await fetchFleetOwnerProfile('a1');
      expect(result).toBeNull();
    });
  });
});
