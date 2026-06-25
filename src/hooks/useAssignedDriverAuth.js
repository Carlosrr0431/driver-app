import { usePhoneDriverAuth } from './usePhoneDriverAuth';
import { lookupAssignedDriverLogin } from '../services/assignedDriverService';

export function useAssignedDriverAuth(options) {
  return usePhoneDriverAuth({
    ...options,
    lookupFn: lookupAssignedDriverLogin,
    notFoundMessage: 'Este teléfono no está registrado como chofer asignado',
  });
}
