import {
  NAVIGATION_STRUCTURE,
  NAVIGATION_STRUCTURE_FINGERPRINT,
  isNavigationStateCompatibleWithStructure,
} from '../../src/navigation/navigationStructure';

describe('navigationStructure', () => {
  it('genera un fingerprint estable para la estructura actual', () => {
    expect(NAVIGATION_STRUCTURE_FINGERPRINT).toBe(
      'History:HistoryMain|TripDetail;Home:HomeMain|ActiveTrip|TripDetail|CommissionPayment;Profile:ProfileMain|OwnerDashboard|OwnerDriverDetail|CreateLinkedDriver',
    );
  });

  it('rechaza rutas internas que no están en el mapa', () => {
    expect(
      isNavigationStateCompatibleWithStructure({
        index: 0,
        routes: [
          {
            name: 'Home',
            state: {
              index: 0,
              routes: [{ name: 'PantallaInexistente' }],
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('acepta stacks anidados conocidos', () => {
    expect(
      isNavigationStateCompatibleWithStructure({
        index: 0,
        routes: [
          {
            name: 'Home',
            state: {
              index: 1,
              routes: [{ name: 'HomeMain' }, { name: 'CommissionPayment' }],
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it('documenta las pantallas actuales del main navigator', () => {
    expect(NAVIGATION_STRUCTURE.tabs.Home).toContain('CommissionPayment');
    expect(NAVIGATION_STRUCTURE.tabs.Profile).toContain('OwnerDashboard');
  });
});
