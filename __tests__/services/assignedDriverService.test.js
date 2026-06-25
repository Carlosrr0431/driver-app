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
  linkAssignedDriverUser,
  setDriverOnlineStatus,
} from '../../src/services/assignedDriverService';

describe('assignedDriverService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('lookupAssignedDriverLogin', () => {
    it('normaliza el teléfono y devuelve el resultado del RPC', async () => {
      mockRpc.mockResolvedValue({
        data: { found: true, full_name: 'Juan Pérez' },
        error: null,
      });

      const result = await lookupAssignedDriverLogin('387 8630173');

      expect(mockRpc).toHaveBeenCalledWith('lookup_assigned_driver_login', {
        p_phone: '543878630173',
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
});
