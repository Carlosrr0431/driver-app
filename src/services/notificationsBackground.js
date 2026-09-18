import { NativeModules } from 'react-native';

try {
  if (!NativeModules.RNFBAppModule) {
    // Prebuild/EAS sin Firebase nativo: no registrar el handler.
  } else {
    const messaging = require('@react-native-firebase/messaging').default;
    messaging().setBackgroundMessageHandler(async () => {
      // Con payload `notification`, iOS/Android muestran la alerta en segundo plano.
    });
  }
} catch (error) {
  console.warn('FCM background handler no disponible:', error?.message || error);
}
