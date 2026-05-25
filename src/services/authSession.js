import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUTH_STORAGE_KEY, isInvalidRefreshTokenError } from './authConstants';
import { supabase } from './supabase';

export { AUTH_STORAGE_KEY, isInvalidRefreshTokenError } from './authConstants';

export const clearInvalidAuthSession = async () => {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (_) {
    try {
      await AsyncStorage.multiRemove([
        AUTH_STORAGE_KEY,
        `${AUTH_STORAGE_KEY}-code-verifier`,
        `${AUTH_STORAGE_KEY}-user`,
      ]);
    } catch (_) {}
  }
};

export const getSafeSession = async () => {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error && isInvalidRefreshTokenError(error)) {
      await clearInvalidAuthSession();
      return { session: null, error: null };
    }
    return { session: data?.session ?? null, error: error ?? null };
  } catch (error) {
    if (isInvalidRefreshTokenError(error)) {
      await clearInvalidAuthSession();
      return { session: null, error: null };
    }
    throw error;
  }
};
