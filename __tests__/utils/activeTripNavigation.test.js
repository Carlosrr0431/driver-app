import {
  ACTIVE_TRIP_BACK,
  appendFreeRideNotesMarker,
  buildDriverCancelTripUpdates,
  canDriverCancelEnRouteToPickup,
  canDriverCancelActiveStreetHail,
  DRIVER_CANCEL_CONFIRM,
  resolveDriverCancelConfirmAction,
  shouldRequeueTripForPassenger,
  clampBottomSheetIndex,
  recoverClosedBottomSheetIndex,
  shouldRestoreClosedBottomSheet,
  didNavigationHudChange,
  hasGuidableDestination,
  isLiveDriverTrip,
  isPlaceholderDestinationAddress,
  isStreetHailSetupFlow,
  nextRouteBaselineMeters,
  notesContainFreeRide,
  resolveActiveTripBackAction,
  resolveActiveTripSheetIndex,
  resolveActiveTripSnapPoints,
  shouldAllowSheetContentPan,
  shouldSnapActiveTripSheet,
  resolveDestinationSearchKeyboardBehavior,
  resolveDestinationSearchTopInset,
  resolveFreeRideActive,
  resolveLegProgress,
  resolveLiveTripForNavigation,
  resolveMeteredRideProgress,
  resolveStreetHailSearchTopInset,
  resolveStreetHailSetupBottomInset,
  resolveStreetHailSetupKeyboardBehavior,
  resolveStreetHailSetupMaxContentSize,
  resolveStreetHailSetupSheetIndex,
  resolveStreetHailSetupSnaps,
  resolveStreetHailSetupUsesDynamicSizing,
  shouldFetchGuidedNavigationRoute,
  shouldLeaveHomeWhenTripCleared,
  shouldShowActiveTripNavHud,
  shouldSkipAdaptiveReroute,
  canStartAdaptiveReroute,
  isGuidedArrivalNearby,
  appendGpsTrackPoint,
  toGpsTrackPoint,
  STREET_HAIL_SETUP_STEP,
} from '../../src/utils/activeTripNavigation';
import { calculateTripPrice } from '../../src/utils/tripTariff';

describe('isLiveDriverTrip', () => {
  it('solo considera viajes aceptados o en curso', () => {
    expect(isLiveDriverTrip({ id: '1', status: 'accepted' })).toBe(true);
    expect(isLiveDriverTrip({ id: '1', status: 'going_to_pickup' })).toBe(true);
    expect(isLiveDriverTrip({ id: '1', status: 'in_progress' })).toBe(true);
    expect(isLiveDriverTrip({ id: '1', status: 'completed' })).toBe(false);
    expect(isLiveDriverTrip({ id: '1', status: 'cancelled' })).toBe(false);
    expect(isLiveDriverTrip({ id: '1', status: 'accepted', next_after_trip_id: 'live-1' })).toBe(false);
    expect(isLiveDriverTrip(null)).toBe(false);
  });
});

describe('resolveLiveTripForNavigation', () => {
  const live = { id: 'trip-1', status: 'in_progress' };
  const done = { id: 'trip-1', status: 'completed' };

  it('usa el store si el viaje sigue vivo', () => {
    expect(resolveLiveTripForNavigation(live, done)).toEqual(live);
  });

  it('no reabre un viaje que acabamos de cerrar', () => {
    expect(resolveLiveTripForNavigation(null, live, 'trip-1')).toBeNull();
  });

  it('cae al cache de query si el store está vacío y el viaje es vivo', () => {
    expect(resolveLiveTripForNavigation(null, live)).toEqual(live);
  });
});

describe('resolveActiveTripBackAction', () => {
  it('en búsqueda de destino vuelve al selector de modo', () => {
    expect(resolveActiveTripBackAction({
      hasActiveTrip: true,
      tripStatus: 'going_to_pickup',
      flowStep: 'set_destination',
      destinationSet: false,
    })).toBe(ACTIVE_TRIP_BACK.CHOOSE_DEST_MODE);
  });

  it('no abandona el viaje activo en el resto del flujo', () => {
    expect(resolveActiveTripBackAction({
      hasActiveTrip: true,
      tripStatus: 'going_to_pickup',
      flowStep: 'choose_dest_mode',
      destinationSet: false,
    })).toBe(ACTIVE_TRIP_BACK.STAY);

    expect(resolveActiveTripBackAction({
      hasActiveTrip: true,
      tripStatus: 'in_progress',
      flowStep: 'in_progress',
      destinationSet: true,
    })).toBe(ACTIVE_TRIP_BACK.STAY);
  });

  it('permite salir al completar, cancelar o ver el resumen', () => {
    expect(resolveActiveTripBackAction({
      hasActiveTrip: true,
      tripStatus: 'completed',
      flowStep: 'in_progress',
    })).toBe(ACTIVE_TRIP_BACK.LEAVE);

    expect(resolveActiveTripBackAction({
      hasActiveTrip: true,
      tripStatus: 'cancelled',
      flowStep: 'going_to_pickup',
    })).toBe(ACTIVE_TRIP_BACK.LEAVE);

    expect(resolveActiveTripBackAction({
      hasActiveTrip: false,
      showingSummary: true,
    })).toBe(ACTIVE_TRIP_BACK.LEAVE);
  });
});

describe('shouldShowActiveTripNavHud', () => {
  it('oculta Llegaste en el setup de viaje en calle', () => {
    expect(isStreetHailSetupFlow('choose_dest_mode')).toBe(true);
    expect(isStreetHailSetupFlow('set_destination')).toBe(true);
    expect(isStreetHailSetupFlow('in_progress')).toBe(false);
    expect(shouldShowActiveTripNavHud({
      flowStep: 'choose_dest_mode',
      isStreetHail: true,
    })).toBe(false);
    expect(shouldShowActiveTripNavHud({
      flowStep: 'set_destination',
      isStreetHail: true,
    })).toBe(false);
    expect(shouldShowActiveTripNavHud({
      flowStep: 'in_progress',
      isStreetHail: true,
    })).toBe(true);
    expect(shouldShowActiveTripNavHud({
      flowStep: 'in_progress',
      isStreetHail: true,
      isFreeRide: true,
    })).toBe(false);
  });

  it('sigue mostrando el HUD en un viaje normal hacia el pasajero', () => {
    expect(shouldShowActiveTripNavHud({
      flowStep: 'going_to_pickup',
      isStreetHail: false,
    })).toBe(true);
    expect(shouldShowActiveTripNavHud({
      flowStep: 'at_pickup',
      isStreetHail: false,
    })).toBe(true);
  });
});

describe('street hail setup sheet', () => {
  it('usa snaps fijos: choose/confirm no dependen de dynamic sizing', () => {
    expect(resolveStreetHailSetupSnaps({})).toEqual(['56%']);
    expect(resolveStreetHailSetupSnaps({ compact: true })).toEqual(['92%']);
    expect(resolveStreetHailSetupUsesDynamicSizing(false)).toBe(false);
    expect(resolveStreetHailSetupUsesDynamicSizing(true)).toBe(false);
  });

  it('todas las etapas usan el primer snap (contenido o 100% al buscar)', () => {
    expect(resolveStreetHailSetupSheetIndex(STREET_HAIL_SETUP_STEP.CHOOSE)).toBe(0);
    expect(resolveStreetHailSetupSheetIndex(STREET_HAIL_SETUP_STEP.SEARCH)).toBe(0);
    expect(resolveStreetHailSetupSheetIndex(STREET_HAIL_SETUP_STEP.CONFIRM)).toBe(0);
  });

  it('al buscar llena el espacio sobre el teclado', () => {
    expect(resolveStreetHailSetupSnaps({ searching: true })).toEqual(['100%']);
    expect(resolveStreetHailSetupSnaps({ searching: true, compact: true })).toEqual(['100%']);
    expect(resolveStreetHailSetupKeyboardBehavior(true)).toBe('interactive');
    expect(resolveStreetHailSetupKeyboardBehavior(false)).toBe('extend');
  });

  it('deja margen de mapa y no se come las pestañas', () => {
    const maxSize = resolveStreetHailSetupMaxContentSize({
      viewportHeight: 800,
      bottomInset: 78,
    });
    expect(maxSize).toBeLessThanOrEqual(800 - 78 - 80);
    expect(maxSize).toBeGreaterThanOrEqual(400);
  });

  it('en pantalla baja usa casi todo el alto sobre las pestañas', () => {
    const maxSize = resolveStreetHailSetupMaxContentSize({
      viewportHeight: 360,
      bottomInset: 56,
      compact: true,
    });
    expect(maxSize).toBeGreaterThanOrEqual(240);
    expect(maxSize).toBeLessThanOrEqual(360 - 56);
  });

  it('sienta el sheet encima de la tab bar absoluta', () => {
    expect(resolveStreetHailSetupBottomInset(78, 24)).toBe(78);
    expect(resolveStreetHailSetupBottomInset(0, 24)).toBe(24);
    expect(resolveStreetHailSetupBottomInset(0, 0)).toBe(12);
  });

  it('con el teclado no suma la tab bar ni aplasta el input', () => {
    expect(resolveStreetHailSetupBottomInset(78, 24, { searching: true })).toBe(0);
  });

  it('solo reserva el safe-area para maximizar espacio de POIs', () => {
    const inset = resolveStreetHailSearchTopInset({
      safeTop: 24,
      viewportHeight: 360,
    });
    // Solo el safe-area, sin espacio extra para chips
    expect(inset).toBe(24);
    expect(360 - inset).toBeGreaterThanOrEqual(220);
  });

  it('sin notch el topInset es 0', () => {
    const inset = resolveStreetHailSearchTopInset({
      safeTop: 0,
      viewportHeight: 800,
    });
    expect(inset).toBe(0);
  });
});

describe('shouldLeaveHomeWhenTripCleared', () => {
  it('vuelve al home si no hay resumen de cobro, también si el viaje se canceló', () => {
    expect(shouldLeaveHomeWhenTripCleared({})).toBe(true);
    expect(shouldLeaveHomeWhenTripCleared({
      showingSummary: true,
    })).toBe(false);
    expect(shouldLeaveHomeWhenTripCleared({
      showingCancelledModal: true,
    })).toBe(true);
  });
});

describe('resolveActiveTripSheetIndex', () => {
  it('no abre el sheet a pantalla completa al elegir o buscar destino', () => {
    expect(resolveActiveTripSheetIndex({
      flowStep: 'set_destination',
      destinationSet: false,
    })).toBe(1);
    expect(resolveActiveTripSheetIndex({
      flowStep: 'set_destination',
      destinationSet: true,
    })).toBe(1);
    expect(resolveActiveTripSheetIndex({
      flowStep: 'choose_dest_mode',
    })).toBe(1);
    expect(resolveActiveTripSheetIndex({
      flowStep: 'at_pickup',
    })).toBe(1);
  });

  it('expande el sheet cuando hay que confirmar llegada o finalizar', () => {
    expect(resolveActiveTripSheetIndex({
      flowStep: 'in_progress',
      destinationSet: true,
      needsArrivalAction: true,
    })).toBe(1);
  });

  it('expande el sheet para mostrar Cancelar de camino al origen', () => {
    expect(resolveActiveTripSheetIndex({
      flowStep: 'going_to_pickup',
      canCancelEnRouteToPickup: true,
    })).toBe(1);
  });

  it('expande el sheet para mostrar Cancelar en viaje en calle activo', () => {
    expect(resolveActiveTripSheetIndex({
      flowStep: 'in_progress',
      destinationSet: true,
      canCancelActiveStreetHail: true,
    })).toBe(1);
    expect(resolveActiveTripSheetIndex({
      flowStep: 'in_progress',
      destinationSet: false,
      canCancelActiveStreetHail: true,
    })).toBe(1);
  });

  it('deja el snap mínimo durante la navegación sin acción de cierre', () => {
    expect(resolveActiveTripSheetIndex({
      flowStep: 'in_progress',
      destinationSet: true,
      needsArrivalAction: false,
    })).toBe(0);
    expect(resolveActiveTripSheetIndex({
      flowStep: 'going_to_pickup',
      canCancelEnRouteToPickup: false,
    })).toBe(0);
  });
});

describe('shouldAllowSheetContentPan', () => {
  it('deja deslizar el contenido y solo bloquea overlay o slider en curso', () => {
    expect(shouldAllowSheetContentPan({})).toBe(true);
    expect(shouldAllowSheetContentPan({ showingFinishSlider: true })).toBe(false);
    expect(shouldAllowSheetContentPan({ showingFinishModal: true })).toBe(false);
    expect(shouldAllowSheetContentPan({ showingCancelConfirm: true })).toBe(false);
    expect(shouldAllowSheetContentPan({ sliderDragging: true })).toBe(false);
  });
});

describe('resolveActiveTripSnapPoints', () => {
  it('agranda el sheet en pantallas chicas y landscape', () => {
    expect(resolveActiveTripSnapPoints({})).toEqual(['20%', '48%', '78%']);
    expect(resolveActiveTripSnapPoints({ compactHeight: true })[0]).toBe('26%');
    expect(resolveActiveTripSnapPoints({ landscape: true })[0]).toBe('30%');
  });
});

describe('shouldSnapActiveTripSheet', () => {
  it('no reanima si el sheet ya está en el snap destino', () => {
    expect(shouldSnapActiveTripSheet(1, 1, true)).toBe(false);
    expect(shouldSnapActiveTripSheet(0, 1, true)).toBe(true);
    expect(shouldSnapActiveTripSheet(1, 0, false)).toBe(false);
    expect(shouldSnapActiveTripSheet(0, 1, false)).toBe(true);
  });
});

describe('canDriverCancelEnRouteToPickup', () => {
  it('permite cancelar solo de camino al origen', () => {
    expect(canDriverCancelEnRouteToPickup({
      flowStep: 'going_to_pickup',
      tripStatus: 'going_to_pickup',
    })).toBe(true);
    expect(canDriverCancelEnRouteToPickup({
      flowStep: 'going_to_pickup',
      tripStatus: 'accepted',
    })).toBe(true);
  });

  it('no permite cancelar cuando ya va al destino o el pasajero subió', () => {
    expect(canDriverCancelEnRouteToPickup({
      flowStep: 'in_progress',
      tripStatus: 'in_progress',
    })).toBe(false);
    expect(canDriverCancelEnRouteToPickup({
      flowStep: 'at_pickup',
      tripStatus: 'going_to_pickup',
    })).toBe(false);
    expect(canDriverCancelEnRouteToPickup({
      flowStep: 'going_to_pickup',
      tripStatus: 'in_progress',
    })).toBe(false);
    expect(canDriverCancelEnRouteToPickup({
      flowStep: 'set_destination',
      tripStatus: 'going_to_pickup',
    })).toBe(false);
  });

  it('no aplica a viaje en calle', () => {
    expect(canDriverCancelEnRouteToPickup({
      flowStep: 'going_to_pickup',
      tripStatus: 'going_to_pickup',
      isStreetHail: true,
    })).toBe(false);
  });
});

describe('canDriverCancelActiveStreetHail', () => {
  it('permite cancelar el viaje en calle ya activo con destino o sin destino', () => {
    expect(canDriverCancelActiveStreetHail({
      isStreetHail: true,
      flowStep: 'in_progress',
      tripStatus: 'in_progress',
    })).toBe(true);
  });

  it('no aplica antes de circular ni a pickup', () => {
    expect(canDriverCancelActiveStreetHail({
      isStreetHail: true,
      flowStep: 'choose_dest_mode',
      tripStatus: 'accepted',
    })).toBe(false);
    expect(canDriverCancelActiveStreetHail({
      isStreetHail: true,
      flowStep: 'set_destination',
      tripStatus: 'in_progress',
    })).toBe(false);
    expect(canDriverCancelActiveStreetHail({
      isStreetHail: false,
      flowStep: 'in_progress',
      tripStatus: 'in_progress',
    })).toBe(false);
    expect(canDriverCancelActiveStreetHail({
      isStreetHail: true,
      flowStep: 'in_progress',
      tripStatus: 'completed',
    })).toBe(false);
  });
});

describe('resolveDriverCancelConfirmAction', () => {
  it('en viaje en calle activo cierra el viaje, con destino o sin destino', () => {
    const destTrip = {
      id: 'street-1',
      status: 'in_progress',
      notes: '[STREET_HAIL]\nViaje en calle',
      destination_lat: -24.79,
      destination_lng: -65.41,
    };
    const freeTrip = {
      id: 'street-2',
      status: 'in_progress',
      notes: '[STREET_HAIL]\n[FREE_RIDE]',
    };
    expect(resolveDriverCancelConfirmAction({
      isStreetHail: true,
      flowStep: 'in_progress',
      tripStatus: 'in_progress',
      trip: destTrip,
    })).toBe(DRIVER_CANCEL_CONFIRM.CANCEL);
    expect(resolveDriverCancelConfirmAction({
      isStreetHail: true,
      flowStep: 'in_progress',
      tripStatus: 'in_progress',
      trip: freeTrip,
    })).toBe(DRIVER_CANCEL_CONFIRM.CANCEL);
  });

  it('en pickup despachado reencola y no cierra el viaje del pasajero', () => {
    expect(resolveDriverCancelConfirmAction({
      isStreetHail: false,
      flowStep: 'going_to_pickup',
      tripStatus: 'going_to_pickup',
      trip: { id: 'trip-1', status: 'going_to_pickup', notes: '[PASSENGER_APP]' },
    })).toBe(DRIVER_CANCEL_CONFIRM.REQUEUE);
  });
});

describe('shouldRequeueTripForPassenger', () => {
  it('reencola el mismo viaje despachado de camino al origen', () => {
    expect(shouldRequeueTripForPassenger({
      id: 'trip-1',
      status: 'going_to_pickup',
      notes: '[PASSENGER_APP]',
    })).toBe(true);
    expect(shouldRequeueTripForPassenger({
      id: 'trip-1',
      status: 'accepted',
      notes: '[APPROACH_ONLY]',
    })).toBe(true);
  });

  it('no reencola calle, ni viaje en curso, ni sin id', () => {
    expect(shouldRequeueTripForPassenger({
      id: 'trip-1',
      status: 'going_to_pickup',
      notes: '[STREET_HAIL]\nViaje en calle',
    })).toBe(false);
    expect(shouldRequeueTripForPassenger({
      id: 'trip-1',
      status: 'in_progress',
    })).toBe(false);
    expect(shouldRequeueTripForPassenger(null)).toBe(false);
  });
});

describe('buildDriverCancelTripUpdates', () => {
  it('cierra el viaje del panel en cancelled, no lo deja going_to_pickup', () => {
    const now = new Date('2026-09-10T01:20:00.000Z');
    expect(buildDriverCancelTripUpdates(now)).toEqual({
      cancel_reason: 'Cancelado por el chofer',
      wa_notified_at: '2026-09-10T01:20:00.000Z',
      dispatch_status: 'cancelled',
      next_dispatch_at: null,
    });
  });
});

describe('resolveDestinationSearchTopInset', () => {
  it('no altera el sheet fuera de la búsqueda de destino', () => {
    expect(resolveDestinationSearchTopInset({
      safeTop: 24,
      viewportHeight: 800,
      searching: false,
    })).toBe(0);
  });

  it('deja el HUD visible en 360x800 y no pega el input al tope', () => {
    const inset = resolveDestinationSearchTopInset({
      safeTop: 24,
      viewportHeight: 800,
      searching: true,
    });
    expect(inset).toBe(148);
    expect(inset).toBeGreaterThan(100);
    expect(inset).toBeLessThan(220);
  });

  it('en un celular chico baja el tope pero reserva lugar para input y POIs', () => {
    const phone = resolveDestinationSearchTopInset({
      safeTop: 24,
      viewportHeight: 569,
      searching: true,
    });
    const standard = resolveDestinationSearchTopInset({
      safeTop: 24,
      viewportHeight: 800,
      searching: true,
    });
    expect(phone).toBe(124);
    expect(phone).toBeLessThan(standard);
    expect(569 - phone).toBeGreaterThanOrEqual(200);
  });

  it('con ventana achicada por el teclado no se come el sheet', () => {
    const inset = resolveDestinationSearchTopInset({
      safeTop: 24,
      viewportHeight: 320,
      searching: true,
    });
    expect(inset).toBeGreaterThan(0);
    expect(inset).toBeLessThanOrEqual(120);
    expect(320 - inset).toBeGreaterThanOrEqual(200);
  });
});

describe('resolveDestinationSearchKeyboardBehavior', () => {
  it('usa extend al buscar para no traducir el sheet encima del HUD', () => {
    expect(resolveDestinationSearchKeyboardBehavior(true)).toBe('extend');
    expect(resolveDestinationSearchKeyboardBehavior(false)).toBe('interactive');
  });
});

describe('clampBottomSheetIndex', () => {
  it('nunca deja el sheet en índice cerrado', () => {
    expect(clampBottomSheetIndex(-1, 1)).toBe(1);
    expect(clampBottomSheetIndex(undefined, 0)).toBe(0);
    expect(clampBottomSheetIndex(2, 0)).toBe(2);
  });
});

describe('shouldRestoreClosedBottomSheet', () => {
  it('restaura si Gorhom emite -1 sin overlay ni modal', () => {
    expect(shouldRestoreClosedBottomSheet({})).toBe(true);
  });

  it('no restaura si ya está restaurando, hay cobro o el overlay de notas', () => {
    expect(shouldRestoreClosedBottomSheet({ restoring: true })).toBe(false);
    expect(shouldRestoreClosedBottomSheet({ showingFinishModal: true })).toBe(false);
    expect(shouldRestoreClosedBottomSheet({ overlayOpen: true })).toBe(false);
    expect(shouldRestoreClosedBottomSheet({ showingCancelConfirm: true })).toBe(false);
    expect(shouldRestoreClosedBottomSheet({ sliderDragging: true })).toBe(false);
  });
});

describe('recoverClosedBottomSheetIndex', () => {
  it('vuelve al snap anterior y nunca a -1', () => {
    expect(recoverClosedBottomSheetIndex(1, 0)).toBe(1);
    expect(recoverClosedBottomSheetIndex(-1, 2)).toBe(2);
    expect(recoverClosedBottomSheetIndex(-1, -1)).toBe(0);
  });
});

describe('nextRouteBaselineMeters', () => {
  it('usa la primera ruta como total del tramo', () => {
    expect(nextRouteBaselineMeters({
      previousBaselineMeters: null,
      previousRemainingMeters: null,
      newRouteMeters: 1300,
    })).toBe(1300);
  });

  it('conserva lo ya recorrido al rerutear desde la GPS actual', () => {
    expect(nextRouteBaselineMeters({
      previousBaselineMeters: 1300,
      previousRemainingMeters: 1100,
      newRouteMeters: 1100,
    })).toBe(1300);
  });

  it('agranda el total si el desvío alarga la ruta', () => {
    expect(nextRouteBaselineMeters({
      previousBaselineMeters: 1300,
      previousRemainingMeters: 800,
      newRouteMeters: 2000,
    })).toBe(2500);
  });
});

describe('resolveLegProgress', () => {
  it('no deja Recorridos en 0 cuando remaining coincide con la ruta actual', () => {
    expect(resolveLegProgress({
      baselineMeters: 1300,
      remainingMeters: 1100,
      routeMeters: 1100,
    })).toEqual({
      currentLegKm: 1.3,
      currentLegTraveledKm: 0.2,
      baselineMeters: 1300,
    });
  });

  it('cae a la ruta actual si todavía no hay baseline', () => {
    expect(resolveLegProgress({
      remainingMeters: 1300,
      routeMeters: 1300,
    }).currentLegTraveledKm).toBe(0);
  });

  it('en viaje sin destino no infiere km recorridos desde el total GPS', () => {
    expect(resolveLegProgress({
      fallbackTotalKm: 1.7,
    })).toEqual({
      currentLegKm: 1.7,
      currentLegTraveledKm: 0,
      baselineMeters: 0,
    });
  });
});

describe('resolveMeteredRideProgress', () => {
  it('muestra los km GPS en Recorridos y el precio con la tarifa de cierre', () => {
    const sheet = resolveMeteredRideProgress({
      tripDistanceKm: 1.7,
      tariffBase: 0,
      tariffPerKm: 600,
    });

    expect(sheet.metered).toBe(true);
    expect(sheet.traveledKm).toBe(1.7);
    expect(sheet.totalKm).toBe(1.7);
    expect(sheet.etaSeconds).toBeNull();
    expect(sheet.currentPrice).toBe(calculateTripPrice({
      base: 0,
      perKm: 600,
      distanceKm: 1.7,
    }));
    expect(sheet.currentPrice).toBe(1020);
  });

  it('incluye base + km al igual que al completar el viaje', () => {
    const sheet = resolveMeteredRideProgress({
      tripDistanceKm: 2,
      tariffBase: 500,
      tariffPerKm: 600,
    });

    expect(sheet.currentPrice).toBe(Math.round(500 + 600 * 2));
    expect(sheet.currentPrice).toBe(1700);
  });

  it('arranca mostrando la base hasta que hay recorrido', () => {
    expect(resolveMeteredRideProgress({
      tripDistanceKm: 0,
      tariffBase: 500,
      tariffPerKm: 600,
    })).toMatchObject({
      traveledKm: 0,
      totalKm: null,
      currentPrice: 500,
      metered: true,
    });
  });

  it('suma tramos anteriores sin cambiar la tarifa del tramo actual', () => {
    const sheet = resolveMeteredRideProgress({
      tripDistanceKm: 0.5,
      accumulatedDistanceKm: 1,
      accumulatedPrice: 600,
      tariffBase: 0,
      tariffPerKm: 600,
    });

    expect(sheet.traveledKm).toBe(1.5);
    expect(sheet.currentPrice).toBe(600 + calculateTripPrice({
      base: 0,
      perKm: 600,
      distanceKm: 0.5,
    }));
  });

  it('aplica la tarifa base una única vez aunque existan tramos acumulados', () => {
    const sheet = resolveMeteredRideProgress({
      tripDistanceKm: 2.9,
      accumulatedDistanceKm: 0,
      accumulatedPrice: 983,
      tariffBase: 983,
      tariffPerKm: 990,
    });

    expect(sheet.traveledKm).toBe(2.9);
    // (2.9 * 990) + 983 = 2871 + 983 = 3854, nunca suma 983 dos veces
    expect(sheet.currentPrice).toBe(3854);
  });
});

describe('didNavigationHudChange', () => {
  it('no dispara update si el HUD es idéntico', () => {
    const hud = {
      remainingDistanceMeters: 319,
      remainingDurationSeconds: 80,
      instruction: 'Doblá a la derecha',
      maneuver: 'turn-right',
      distanceToStepMeters: 40,
    };
    expect(didNavigationHudChange(hud, { ...hud })).toBe(false);
  });

  it('detecta un cambio de distancia restante', () => {
    expect(didNavigationHudChange(
      { remainingDistanceMeters: 319, remainingDurationSeconds: 80, instruction: 'Seguí', maneuver: 'straight', distanceToStepMeters: 40 },
      { remainingDistanceMeters: 300, remainingDurationSeconds: 80, instruction: 'Seguí', maneuver: 'straight', distanceToStepMeters: 40 },
    )).toBe(true);
  });
});

describe('viaje sin destino (Ir sin destino)', () => {
  const streetHailTrip = {
    status: 'in_progress',
    notes: '[STREET_HAIL]\nViaje tomado en calle. Destino a definir.',
    destination_address: 'A confirmar',
    destination_lat: null,
    destination_lng: null,
  };

  it('trata "A confirmar" como destino pendiente', () => {
    expect(isPlaceholderDestinationAddress('A confirmar')).toBe(true);
    expect(isPlaceholderDestinationAddress('Mitre 300')).toBe(false);
    expect(hasGuidableDestination({ trip: streetHailTrip })).toBe(false);
  });

  it('no navega aunque destination_* copie el origen', () => {
    expect(hasGuidableDestination({
      trip: {
        ...streetHailTrip,
        destination_lat: -24.79,
        destination_lng: -65.41,
      },
    })).toBe(false);
  });

  it('activa modo libre al marcar Ir sin destino, aunque el paso UI todavía no cambió', () => {
    expect(resolveFreeRideActive({
      flaggedFreeRide: true,
      flowStep: 'choose_dest_mode',
      tripStatus: 'accepted',
      trip: { ...streetHailTrip, status: 'accepted' },
    })).toBe(true);
  });

  it('en calle in_progress sin destino es viaje por km', () => {
    expect(resolveFreeRideActive({
      flowStep: 'in_progress',
      tripStatus: 'in_progress',
      trip: streetHailTrip,
    })).toBe(true);
  });

  it('un viaje con destino real sigue en navegación guiada', () => {
    expect(resolveFreeRideActive({
      flowStep: 'in_progress',
      tripStatus: 'in_progress',
      trip: {
        status: 'in_progress',
        destination_address: 'Mitre 300, Salta',
        destination_lat: -24.79,
        destination_lng: -65.41,
      },
      tripFinalDestination: { address: 'Mitre 300, Salta', lat: -24.79, lng: -65.41 },
    })).toBe(false);
  });

  it('persiste [FREE_RIDE] en notes sin duplicarlo', () => {
    const once = appendFreeRideNotesMarker(streetHailTrip.notes);
    expect(notesContainFreeRide(once)).toBe(true);
    expect(appendFreeRideNotesMarker(once)).toBe(once);
  });

  it('oculta el HUD de maniobras en viaje libre', () => {
    expect(shouldShowActiveTripNavHud({
      flowStep: 'in_progress',
      isStreetHail: false,
      isFreeRide: true,
    })).toBe(false);
  });

  it('no pide ruta guiada al ir sin destino, ni en el frame sucio', () => {
    expect(shouldFetchGuidedNavigationRoute({
      isFreeRide: true,
      flowStep: 'in_progress',
      destinationSet: true,
      trip: streetHailTrip,
    })).toBe(false);

    expect(shouldFetchGuidedNavigationRoute({
      flaggedFreeRide: true,
      flowStep: 'choose_dest_mode',
      destinationSet: false,
      trip: { ...streetHailTrip, status: 'accepted' },
    })).toBe(false);

    expect(shouldFetchGuidedNavigationRoute({
      flowStep: 'in_progress',
      destinationSet: true,
      trip: {
        ...streetHailTrip,
        destination_lat: -24.79,
        destination_lng: -65.41,
      },
    })).toBe(false);
  });

  it('sigue pidiendo OSRM hacia el pickup o con destino real', () => {
    expect(shouldFetchGuidedNavigationRoute({
      flowStep: 'going_to_pickup',
      destinationSet: false,
      trip: { status: 'accepted', origin_lat: -24.79, origin_lng: -65.41 },
    })).toBe(true);

    expect(shouldFetchGuidedNavigationRoute({
      flowStep: 'in_progress',
      destinationSet: true,
      trip: {
        status: 'in_progress',
        destination_address: 'Mitre 300, Salta',
        destination_lat: -24.79,
        destination_lng: -65.41,
      },
      tripFinalDestination: { address: 'Mitre 300, Salta', lat: -24.79, lng: -65.41 },
    })).toBe(true);
  });

  it('dibuja la polilínea GPS a medida que el auto avanza', () => {
    const start = toGpsTrackPoint({ lat: -24.79000, lng: -65.41000 });
    const tooClose = appendGpsTrackPoint([start], { lat: -24.79001, lng: -65.41001 }, start);
    expect(tooClose.track).toHaveLength(1);

    const moved = appendGpsTrackPoint(
      [start],
      { lat: -24.79100, lng: -65.41000 },
      start,
    );
    expect(moved.track).toHaveLength(2);
    expect(moved.track[1]).toEqual({ latitude: -24.79100, longitude: -65.41000 });
  });
});

describe('shouldSkipAdaptiveReroute', () => {
  it('no bloquea el recálculo si el chofer ya se desvió aunque remaining esté chico', () => {
    expect(shouldSkipAdaptiveReroute({
      flowStep: 'in_progress',
      remainingDistanceMeters: 80,
      deviationMeters: 90,
      distanceToNavTarget: 240,
      finishProximityMeters: 100,
    })).toBe(false);
  });

  it('bloquea el recálculo al llegar de verdad al destino', () => {
    expect(shouldSkipAdaptiveReroute({
      flowStep: 'in_progress',
      remainingDistanceMeters: 70,
      deviationMeters: 8,
      distanceToNavTarget: 55,
      finishProximityMeters: 100,
    })).toBe(true);
  });

  it('bloquea en at_pickup y no en un desvío camino al pasajero', () => {
    expect(shouldSkipAdaptiveReroute({
      flowStep: 'at_pickup',
      remainingDistanceMeters: 40,
      deviationMeters: 12,
    })).toBe(true);

    expect(shouldSkipAdaptiveReroute({
      flowStep: 'going_to_pickup',
      remainingDistanceMeters: 50,
      deviationMeters: 95,
      distanceToPickup: 320,
      finishProximityMeters: 100,
    })).toBe(false);
  });
});

describe('canStartAdaptiveReroute', () => {
  it('espera el cooldown y no superpone un request en vuelo', () => {
    expect(canStartAdaptiveReroute({
      inFlight: true,
      lastRerouteAt: 1000,
      now: 2500,
      cooldownMs: 3800,
      staleLockMs: 6500,
    })).toEqual({ allow: false, releaseStaleLock: false });

    expect(canStartAdaptiveReroute({
      inFlight: false,
      lastRerouteAt: 1000,
      now: 2500,
      cooldownMs: 3800,
    })).toEqual({ allow: false, releaseStaleLock: false });
  });

  it('libera un lock colgado y reintenta cuando ya pasó el cooldown', () => {
    expect(canStartAdaptiveReroute({
      inFlight: true,
      lastRerouteAt: 1000,
      now: 8000,
      cooldownMs: 3800,
      staleLockMs: 6500,
    })).toEqual({ allow: true, releaseStaleLock: true });
  });

  it('permite el primer recálculo', () => {
    expect(canStartAdaptiveReroute({
      inFlight: false,
      lastRerouteAt: 0,
      now: 10_000,
      cooldownMs: 3800,
    })).toEqual({ allow: true, releaseStaleLock: false });
  });
});

describe('isGuidedArrivalNearby', () => {
  it('no toma remaining chico de la ruta vieja si el GPS está lejos', () => {
    expect(isGuidedArrivalNearby({
      remainingDistanceMeters: 70,
      distanceToTarget: 260,
      deviationMeters: 88,
      finishProximityMeters: 100,
    })).toBe(false);
  });

  it('confirma llegada por GPS cerca del destino', () => {
    expect(isGuidedArrivalNearby({
      remainingDistanceMeters: 400,
      distanceToTarget: 45,
      deviationMeters: 70,
      finishProximityMeters: 100,
    })).toBe(true);
  });
});

