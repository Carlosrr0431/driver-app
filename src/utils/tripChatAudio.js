import * as FileSystem from 'expo-file-system/legacy';
import {
  setAudioModeAsync,
  setIsAudioActiveAsync,
} from 'expo-audio';

/**
 * Descarga el audio remoto a caché local con extensión correcta (.m4a).
 * Evita fallos de ExoPlayer/AVPlayer al streamear URLs de Supabase Storage.
 */
export async function resolveTripChatAudioUri(remoteUrl) {
  const url = String(remoteUrl || '').trim();
  if (!url) throw new Error('URL de audio vacía');
  if (url.startsWith('file://') || url.startsWith('content://')) return url;

  const extMatch = url.match(/\.(m4a|mp4|aac|mp3|caf|wav)(?:\?|$)/i);
  const ext = (extMatch?.[1] || 'm4a').toLowerCase();
  const leaf = url.split('/').pop()?.split('?')[0] || `audio-${Date.now()}`;
  const safeLeaf = leaf.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  const fileName = /\.(m4a|mp4|aac|mp3|caf|wav)$/i.test(safeLeaf)
    ? safeLeaf
    : `${safeLeaf}.${ext}`;
  const dest = `${FileSystem.cacheDirectory}trip-chat-${fileName}`;

  const existing = await FileSystem.getInfoAsync(dest);
  if (existing.exists && existing.size > 32) return dest;

  const result = await FileSystem.downloadAsync(url, dest);
  if (result.status && result.status !== 200) {
    throw new Error(`No se pudo descargar el audio (HTTP ${result.status})`);
  }
  const info = await FileSystem.getInfoAsync(result.uri || dest);
  if (!info.exists || !(info.size > 32)) {
    throw new Error('El archivo de audio quedó vacío');
  }
  return result.uri || dest;
}

export async function prepareTripChatPlaybackMode({ stopSpeech } = {}) {
  if (typeof stopSpeech === 'function') {
    try { stopSpeech(); } catch { /* ignore */ }
  }
  await setIsAudioActiveAsync(true);
  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
    interruptionModeAndroid: 'duckOthers',
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
    allowsRecording: false,
  });
  // Android: dar tiempo a liberar la sesión de grabación del micrófono.
  await new Promise((r) => setTimeout(r, 120));
}

/**
 * Carga y reproduce un audio remoto con un player de expo-audio (useAudioPlayer).
 */
export function playWithAudioPlayer(player, playUri) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      try { player.removeListener('playbackStatusUpdate', onStatus); } catch { /* ignore */ }
      fn(arg);
    };

    const onStatus = (status) => {
      if (status?.isLoaded) finish(resolve);
    };

    try {
      player.addListener('playbackStatusUpdate', onStatus);
      try { player.pause(); } catch { /* ignore */ }
      player.replace({ uri: playUri });
      if (player.isLoaded) {
        finish(resolve);
        return;
      }
      timeoutId = setTimeout(() => {
        if (player.isLoaded) finish(resolve);
        else finish(reject, new Error('Timeout cargando audio'));
      }, 15000);
    } catch (err) {
      finish(reject, err);
    }
  }).then(async () => {
    try { await player.seekTo(0); } catch { /* ignore */ }
    player.volume = 1;
    player.play();
  });
}
