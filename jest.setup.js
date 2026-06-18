/**
 * jest.setup.js — Corre ANTES de que cualquier módulo sea importado.
 * Mockea todos los módulos nativos de Expo y React Native que no
 * pueden ejecutarse en el entorno Node.js de Jest.
 */

// ── Variables de entorno ──────────────────────────────────────────────────────
process.env.EXPO_PUBLIC_SUPABASE_URL         = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY    = 'test-anon-key';
process.env.EXPO_PUBLIC_OSRM_URL = 'https://test-osrm.example';
process.env.EXPO_PUBLIC_NOMINATIM_URL = 'https://test-nominatim.example';
process.env.EXPO_PUBLIC_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

// ── Mocks de módulos nativos de Expo ─────────────────────────────────────────
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: -24.79, longitude: -65.41, accuracy: 5, speed: 0 },
  }),
  watchPositionAsync: jest.fn().mockReturnValue({ remove: jest.fn() }),
  Accuracy: { BestForNavigation: 6, High: 4, Balanced: 3 },
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[test]' }),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  setBadgeCountAsync: jest.fn().mockResolvedValue(true),
  dismissAllNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-id'),
  AndroidImportance: { HIGH: 4, MAX: 5 },
  AndroidNotificationPriority: { HIGH: 'high', MAX: 'max' },
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium', Light: 'light', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-av', () => ({
  Audio: {
    Sound: {
      createAsync: jest.fn().mockResolvedValue({
        sound: { playAsync: jest.fn(), unloadAsync: jest.fn() },
      }),
    },
    setAudioModeAsync: jest.fn(),
    Recording: jest.fn().mockImplementation(() => ({
      prepareToRecordAsync: jest.fn(),
      startAsync: jest.fn(),
      stopAndUnloadAsync: jest.fn(),
      getURI: jest.fn().mockReturnValue('file://test.m4a'),
    })),
    RecordingOptionsPresets: { HIGH_QUALITY: {} },
  },
}), { virtual: true });

jest.mock('expo-file-system', () => ({
  readAsStringAsync: jest.fn().mockResolvedValue('base64content'),
  EncodingType: { Base64: 'base64' },
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true }),
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn(),
}));

jest.mock('expo-font', () => ({
  useFonts: jest.fn().mockReturnValue([true, null]),
  loadAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('@react-native-firebase/messaging', () => {
  const unsubscribe = jest.fn();
  const messaging = () => ({
    getToken: jest.fn().mockResolvedValue('fcm_test_token_123'),
    onTokenRefresh: jest.fn(() => unsubscribe),
    requestPermission: jest.fn().mockResolvedValue(1),
    registerDeviceForRemoteMessages: jest.fn().mockResolvedValue(undefined),
  });

  messaging.AuthorizationStatus = {
    NOT_DETERMINED: -1,
    DENIED: 0,
    AUTHORIZED: 1,
    PROVISIONAL: 2,
    EPHEMERAL: 3,
  };

  return messaging;
});

// ── Mocks de React Native ─────────────────────────────────────────────────────
// RN 0.81 moved this internal module; keep a virtual mock for compatibility in tests.
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper', () => ({}), { virtual: true });

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('react-native-gesture-handler', () => {
  const View = require('react-native').View;
  return {
    GestureHandlerRootView: View,
    Swipeable: View,
    DrawerLayout: View,
    State: {},
    ScrollView: View,
    Slider: View,
    Switch: View,
    TextInput: View,
    ToolbarAndroid: View,
    ViewPagerAndroid: View,
    PanGestureHandler: View,
    TapGestureHandler: View,
    FlingGestureHandler: View,
    ForceTouchGestureHandler: View,
    LongPressGestureHandler: View,
    NativeViewGestureHandler: View,
    PinchGestureHandler: View,
    RotationGestureHandler: View,
    RawButton: View,
    BaseButton: View,
    RectButton: View,
    BorderlessButton: View,
    createNativeWrapper: jest.fn(),
    Directions: {},
    Gesture: {
      Tap: jest.fn(() => ({ onEnd: jest.fn().mockReturnThis(), runOnJS: jest.fn().mockReturnThis() })),
      Pan: jest.fn(() => ({ onUpdate: jest.fn().mockReturnThis(), onEnd: jest.fn().mockReturnThis() })),
    },
    GestureDetector: View,
  };
});

jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return Reanimated;
});

jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');

  const MockMap = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      setStop: jest.fn(),
      jumpTo: jest.fn(),
      easeTo: jest.fn(),
      flyTo: jest.fn(),
      fitBounds: jest.fn(),
      zoomTo: jest.fn(),
    }));
    return React.createElement(View, props, props.children);
  });

  const MockCamera = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      setStop: jest.fn(),
      jumpTo: jest.fn(),
      easeTo: jest.fn(),
      flyTo: jest.fn(),
      fitBounds: jest.fn(),
      zoomTo: jest.fn(),
    }));
    return React.createElement(View, props, props.children);
  });

  const PassThrough = (props) => React.createElement(View, props, props.children);

  return {
    Map: MockMap,
    Camera: MockCamera,
    Marker: PassThrough,
    GeoJSONSource: PassThrough,
    Layer: PassThrough,
    ViewAnnotation: PassThrough,
    UserLocation: PassThrough,
    Images: PassThrough,
  };
});

jest.mock('react-native-maps', () => {
  const { View } = require('react-native');
  const MockMapView = (props) => View(props);
  const MockMarker = (props) => View(props);
  const MockPolyline = (props) => View(props);
  MockMapView.Animated = MockMapView;
  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockMarker,
    Polyline: MockPolyline,
    PROVIDER_GOOGLE: 'google',
    MapView: MockMapView,
  };
}, { virtual: true });

jest.mock('@gorhom/bottom-sheet', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: View,
    BottomSheetModal: View,
    BottomSheetView: View,
    BottomSheetBackdrop: View,
    useBottomSheetModal: jest.fn(() => ({ present: jest.fn(), dismiss: jest.fn() })),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: ({ children }) => children,
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn(), hide: jest.fn() },
}));

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(),
  isSpeakingAsync: jest.fn().mockResolvedValue(false),
  getAvailableVoicesAsync: jest.fn().mockResolvedValue([]),
}));

// ── Mock de Supabase ──────────────────────────────────────────────────────────
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select:      jest.fn().mockReturnThis(),
      insert:      jest.fn().mockReturnThis(),
      update:      jest.fn().mockReturnThis(),
      upsert:      jest.fn().mockReturnThis(),
      delete:      jest.fn().mockReturnThis(),
      eq:          jest.fn().mockReturnThis(),
      neq:         jest.fn().mockReturnThis(),
      in:          jest.fn().mockReturnThis(),
      order:       jest.fn().mockReturnThis(),
      limit:       jest.fn().mockReturnThis(),
      single:      jest.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      then:        (onfulfilled) => Promise.resolve({ data: null, error: null }).then(onfulfilled),
    })),
    channel: jest.fn(() => ({
      on:          jest.fn().mockReturnThis(),
      subscribe:   jest.fn().mockReturnThis(),
    })),
    removeChannel: jest.fn(),
    auth: {
      signInWithPassword: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signOut:            jest.fn().mockResolvedValue({ error: null }),
      getSession:         jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange:  jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
  })),
}));
