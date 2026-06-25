import {
  buildAssignedDriverAuthEmail,
  isAssignedDriver,
  isFleetOwner,
  MAX_ASSIGNED_DRIVERS,
  normalizeDriverPhone,
} from '../../src/utils/driverRoles';

describe('choferes asignados — reglas de negocio', () => {
  it('arma payload de invitación con teléfono normalizado y email sintético', () => {
    const phone = '3878630173';
    const normalized = normalizeDriverPhone(phone);

    expect(normalized).toBe('543878630173');
    expect(buildAssignedDriverAuthEmail(normalized)).toBe(
      'assigned.543878630173@profesional.test',
    );
  });

  it('identifica chofer asignado vs propietario de flota', () => {
    expect(isAssignedDriver({ owner_id: 'owner-1' })).toBe(true);
    expect(isFleetOwner({ role: 'owner' })).toBe(true);
    expect(isFleetOwner({ role: 'owner', owner_id: 'owner-1' })).toBe(false);
    expect(isAssignedDriver({ role: 'owner' })).toBe(false);
  });

  it('limita la flota a 3 choferes asignados', () => {
    expect(MAX_ASSIGNED_DRIVERS).toBe(3);
  });

  it('bloquea activar modo propietario para chofer asignado', () => {
    const assigned = { id: 'd1', owner_id: 'owner-1', is_assigned_driver: true };
    const canBecomeOwner = !assigned.owner_id && !assigned.is_assigned_driver;

    expect(canBecomeOwner).toBe(false);
    expect(isAssignedDriver(assigned)).toBe(true);
  });
});
