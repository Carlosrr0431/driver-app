import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as ExpoInAppUpdates from 'expo-in-app-updates';
import { supabase } from '../services/supabase';

const PLAY_STORE_PACKAGE = 'com.remises.driverapp';
/** versionCode publicado más reciente (android). Actualizar en Supabase al subir a Play. */
const LATEST_VERSION_CODE_KEY = 'driver_app_latest_version_code';

function getLocalVersionCode() {
  const raw =
    Constants.nativeBuildVersion
    ?? Constants.expoConfig?.android?.versionCode
    ?? Constants.easConfig?.android?.versionCode;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function openPlayStore() {
  const marketUrl = `market://details?id=${PLAY_STORE_PACKAGE}`;
  const webUrl = `https://play.google.com/store/apps/details?id=${PLAY_STORE_PACKAGE}`;
  try {
    const canOpen = await Linking.canOpenURL(marketUrl);
    await Linking.openURL(canOpen ? marketUrl : webUrl);
  } catch {
    await Linking.openURL(webUrl);
  }
}

async function checkPlayStoreUpdate() {
  try {
    const result = await ExpoInAppUpdates.checkForUpdate();
    return Boolean(result?.updateAvailable);
  } catch (error) {
    console.warn('[StoreUpdate] Play check falló:', error?.message || error);
    return false;
  }
}

async function checkRemoteVersionCode() {
  try {
    const localCode = getLocalVersionCode();
    if (!localCode) return false;

    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', LATEST_VERSION_CODE_KEY)
      .maybeSingle();

    if (error) throw error;

    const latestCode = Number(String(data?.value || '').trim());
    if (!Number.isFinite(latestCode) || latestCode <= 0) return false;

    return latestCode > localCode;
  } catch (error) {
    console.warn('[StoreUpdate] Check remoto falló:', error?.message || error);
    return false;
  }
}

/**
 * Detecta actualizaciones vía Google Play In-App Updates y, si eso falla,
 * compara el versionCode local con settings en Supabase.
 */
export function useStoreUpdateCheck() {
  const [visible, setVisible] = useState(false);
  const dismissedRef = useRef(false);
  const checkingRef = useRef(false);

  const runCheck = useCallback(async () => {
    if (__DEV__ || Platform.OS === 'web' || Platform.OS !== 'android') return;
    if (dismissedRef.current || checkingRef.current) return;

    checkingRef.current = true;
    try {
      const fromPlay = await checkPlayStoreUpdate();
      if (fromPlay) {
        setVisible(true);
        return;
      }

      const fromRemote = await checkRemoteVersionCode();
      if (fromRemote) {
        setVisible(true);
      }
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (__DEV__ || Platform.OS === 'web') return undefined;

    const timer = setTimeout(runCheck, 1200);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        runCheck();
      }
    });

    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [runCheck]);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setVisible(false);
  }, []);

  const openUpdate = useCallback(async () => {
    try {
      if (Platform.OS === 'android') {
        try {
          const started = await ExpoInAppUpdates.startUpdate(false);
          if (started) {
            setVisible(false);
            return;
          }
        } catch (error) {
          console.warn('[StoreUpdate] startUpdate falló:', error?.message || error);
        }
      }
      await openPlayStore();
    } catch {
      try {
        await openPlayStore();
      } catch {
        // ignore
      }
    } finally {
      setVisible(false);
    }
  }, []);

  return { visible, dismiss, openUpdate };
}
