import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../services/supabase';

const PLAY_STORE_PACKAGE = 'com.remises.driverapp';
/** versionCode publicado más reciente (android). Actualizar en Supabase al subir a Play. */
const LATEST_VERSION_CODE_KEY = 'driver_app_latest_version_code';
const DASHBOARD_URL =
  process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://profesional-dashboard.vercel.app';

function getLocalVersionCode() {
  const raw =
    Constants.nativeBuildVersion
    ?? Constants.expoConfig?.android?.versionCode
    ?? Constants.easConfig?.android?.versionCode;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseVersionCode(raw) {
  const latestCode = Number(String(raw ?? '').trim());
  return Number.isFinite(latestCode) && latestCode > 0 ? latestCode : 0;
}

async function openPlayStore() {
  // No usar market:// suelto: en Xiaomi/Huawei lo captura GetApps u otra tienda.
  const playIntentUrl =
    `intent://details?id=${PLAY_STORE_PACKAGE}`
    + '#Intent;scheme=market;package=com.android.vending;end';
  const webUrl = `https://play.google.com/store/apps/details?id=${PLAY_STORE_PACKAGE}`;
  try {
    await Linking.openURL(playIntentUrl);
  } catch {
    await Linking.openURL(webUrl);
  }
}

async function checkPlayStoreUpdate() {
  try {
    // Lazy require: el import top-level crashea el APK/dev-client si el módulo
    // nativo no está linkeado (p. ej. build vieja o Expo Go).
    // eslint-disable-next-line global-require
    const ExpoInAppUpdates = require('expo-in-app-updates');
    const result = await ExpoInAppUpdates.checkForUpdate();
    return Boolean(result?.updateAvailable);
  } catch (error) {
    console.warn('[StoreUpdate] Play check falló:', error?.message || error);
    return false;
  }
}

async function fetchLatestFromSupabase() {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', LATEST_VERSION_CODE_KEY)
    .maybeSingle();

  if (error) throw error;
  return parseVersionCode(data?.value);
}

async function fetchLatestFromDashboard() {
  const response = await fetch(`${DASHBOARD_URL}/api/settings`, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || 'No se pudo leer versionCode remoto');
  }

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const row = rows.find((item) => String(item?.key || '').trim() === LATEST_VERSION_CODE_KEY);
  return parseVersionCode(row?.value);
}

async function checkRemoteVersionCode() {
  try {
    const localCode = getLocalVersionCode();
    if (!localCode) return false;

    let latestCode = 0;
    try {
      latestCode = await fetchLatestFromSupabase();
    } catch (error) {
      console.warn('[StoreUpdate] Check remoto Supabase falló:', error?.message || error);
    }

    if (!latestCode) {
      try {
        latestCode = await fetchLatestFromDashboard();
      } catch (error) {
        console.warn('[StoreUpdate] Check remoto dashboard falló:', error?.message || error);
        return false;
      }
    }

    return latestCode > localCode;
  } catch (error) {
    console.warn('[StoreUpdate] Check remoto falló:', error?.message || error);
    return false;
  }
}

/**
 * Muestra el modal propio cuando hay update.
 * "Actualizar" abre la ficha en Google Play (sin In-App Update nativo).
 *
 * @param {{ isAuthenticated?: boolean }} [options]
 */
export function useStoreUpdateCheck({ isAuthenticated } = {}) {
  const [visible, setVisible] = useState(false);
  const dismissedRef = useRef(false);
  const checkingRef = useRef(false);

  const runCheck = useCallback(async () => {
    if (__DEV__ || Platform.OS === 'web' || Platform.OS !== 'android') return;
    if (dismissedRef.current || checkingRef.current || visible) return;

    checkingRef.current = true;
    try {
      const [fromPlay, fromRemote] = await Promise.all([
        checkPlayStoreUpdate(),
        checkRemoteVersionCode(),
      ]);

      if (fromPlay || fromRemote) {
        setVisible(true);
      }
    } finally {
      checkingRef.current = false;
    }
  }, [visible]);

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

  useEffect(() => {
    if (__DEV__ || Platform.OS === 'web' || Platform.OS !== 'android') return;
    if (!isAuthenticated) return;
    runCheck();
  }, [isAuthenticated, runCheck]);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setVisible(false);
  }, []);

  const openUpdate = useCallback(async () => {
    try {
      await openPlayStore();
    } catch (error) {
      console.warn('[StoreUpdate] openPlayStore falló:', error?.message || error);
    } finally {
      setVisible(false);
    }
  }, []);

  return { visible, dismiss, openUpdate };
}
