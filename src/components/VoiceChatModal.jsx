/**
 * Componente: VoiceChatModal
 * Que hace: Muestra el modal de radio base para listar, grabar, enviar y reproducir mensajes de voz del conductor.
 * Usado por:
 * - driver-app/src/screens/HomeScreen.jsx -> import { VoiceChatModal } from '../components/VoiceChatModal';
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  Animated as RNAnimated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useVoiceChat } from '../hooks/useVoiceChat';
import { useResponsive } from '../hooks/useResponsive';

const WAVE_HEIGHTS = [3, 5, 8, 5, 7, 4, 6, 8, 5, 3];

function formatSecs(total) {
  const s = Math.max(0, Number(total) || 0);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

export function VoiceChatModal({ visible, onClose }) {
  const insets = useSafeAreaInsets();
  const { s, fs, screenPadding, isLandscape, contentMaxWidth } = useResponsive();
  const {
    messages,
    recording,
    recordingTime,
    sending,
    loading,
    startRecording,
    cancelRecording,
    sendRecording,
    playAudio,
  } = useVoiceChat({ enabled: visible });

  const listRef = useRef(null);
  const hasMessages = messages.length > 0;
  // Evita reemplazar toda la lista por un spinner (flash blanco) si ya hay historial.
  const showInitialLoader = loading && !hasMessages;

  useEffect(() => {
    if (!visible || !hasMessages) return undefined;
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 80);
    return () => clearTimeout(t);
  }, [visible, messages.length, hasMessages]);

  const keyExtractor = useCallback((item) => String(item.id), []);

  const renderMessage = useCallback(({ item }) => {
    const isBase = item.sender_type === 'base';
    const time = new Date(item.created_at).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <View style={[styles.bubbleWrap, isBase ? styles.bubbleWrapBase : styles.bubbleWrapMine]}>
        <VoiceMessageBubble
          isBase={isBase}
          time={time}
          duration={item.duration_seconds}
          audioUrl={item.audio_url}
          onPlay={playAudio}
        />
      </View>
    );
  }, [playAudio]);

  const listEmpty = useMemo(() => (
    <View style={styles.emptyWrap}>
      <MaterialCommunityIcons name="microphone-off" size={48} color={colors.textMuted} />
      <Text style={styles.emptyTitle}>Sin mensajes de voz</Text>
      <Text style={styles.emptySubtitle}>
        Presioná el micrófono para enviar un mensaje a la base
      </Text>
    </View>
  ), []);

  const content = (
    <View
      style={[
        styles.root,
        isLandscape && styles.rootLandscape,
      ]}
    >
      <StatusBar barStyle="dark-content" backgroundColor={colors.surface} />
      <View
        style={[
          styles.inner,
          isLandscape && { maxWidth: contentMaxWidth },
        ]}
      >
        <View
          style={[
            styles.header,
            {
              paddingTop: Math.max(insets.top, s(16)) + s(8),
              paddingBottom: s(12),
              paddingHorizontal: screenPadding,
            },
          ]}
        >
          <View style={styles.headerLeft}>
            <View style={[styles.headerIcon, { width: s(36), height: s(36), borderRadius: s(12) }]}>
              <MaterialCommunityIcons name="radio-tower" size={s(20)} color={colors.primary} />
            </View>
            <View style={{ marginLeft: s(10) }}>
              <Text style={[styles.headerTitle, { fontSize: fs(16) }]}>Radio Base</Text>
              <Text style={[styles.headerSubtitle, { fontSize: fs(11) }]}>
                Mensajes de voz con la base
              </Text>
            </View>
          </View>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeBtn,
              { width: s(36), height: s(36), borderRadius: s(18) },
              pressed && styles.pressed,
            ]}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="close" size={s(20)} color={colors.textMuted} />
          </Pressable>
        </View>

        {showInitialLoader ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            style={styles.list}
            data={messages}
            keyExtractor={keyExtractor}
            renderItem={renderMessage}
            contentContainerStyle={[
              styles.listContent,
              !hasMessages && styles.listContentEmpty,
            ]}
            ListEmptyComponent={listEmpty}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={Platform.OS === 'android'}
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            windowSize={7}
            keyboardShouldPersistTaps="handled"
          />
        )}

        <View
          style={[
            styles.footer,
            {
              paddingBottom: Math.max(insets.bottom, 12) + 12,
              paddingHorizontal: screenPadding,
            },
          ]}
        >
          {recording ? (
            <View style={styles.recordingRow}>
              <View style={styles.recordingCard}>
                <PulsingDot />
                <Text style={styles.recordingTime}>{formatSecs(recordingTime)}</Text>
                <Text style={styles.recordingLabel}>Grabando...</Text>
              </View>
              <Pressable
                onPress={cancelRecording}
                style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="close" size={20} color={colors.danger} />
              </Pressable>
              <Pressable
                onPress={sendRecording}
                disabled={sending}
                style={({ pressed }) => [
                  styles.sendBtn,
                  sending && styles.sendBtnDisabled,
                  pressed && !sending && styles.pressed,
                ]}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <MaterialCommunityIcons name="send" size={20} color="#fff" />
                )}
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={startRecording}
              style={({ pressed }) => [styles.recordBtn, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons name="microphone" size={22} color="#fff" />
              <Text style={styles.recordBtnText}>Presioná para grabar mensaje</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={onClose}
    >
      {content}
    </Modal>
  );
}

const VoiceMessageBubble = memo(function VoiceMessageBubble({
  isBase,
  time,
  duration,
  audioUrl,
  onPlay,
}) {
  const [playing, setPlaying] = useState(false);
  const resetTimerRef = useRef(null);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  const handlePress = useCallback(() => {
    if (!audioUrl) return;
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setPlaying(true);
    onPlay?.(audioUrl);
    const ms = Math.max(800, (Number(duration) || 0) * 1000 + 400);
    resetTimerRef.current = setTimeout(() => setPlaying(false), ms);
  }, [audioUrl, duration, onPlay]);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.bubble,
        isBase ? styles.bubbleBase : styles.bubbleMine,
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.playCircle,
          playing && styles.playCircleActive,
          !playing && (isBase ? styles.playCircleBase : styles.playCircleMine),
        ]}
      >
        <MaterialCommunityIcons
          name={playing ? 'pause' : 'play'}
          size={18}
          color={playing ? '#fff' : isBase ? colors.secondary : colors.primary}
        />
      </View>
      <View style={styles.bubbleMeta}>
        <View style={styles.bubbleMetaRow}>
          <Text style={[styles.senderLabel, isBase ? styles.senderBase : styles.senderMine]}>
            {isBase ? 'Base' : 'Yo'}
          </Text>
          {duration > 0 ? (
            <Text style={styles.durationText}>{formatSecs(duration)}</Text>
          ) : null}
        </View>
        <Text style={styles.timeText}>{time}</Text>
      </View>
      <View style={styles.waveRow}>
        {WAVE_HEIGHTS.map((h, i) => (
          <View
            key={`w-${i}`}
            style={[
              styles.waveBar,
              { height: h },
              playing
                ? styles.waveBarActive
                : isBase
                  ? styles.waveBarBase
                  : styles.waveBarMine,
            ]}
          />
        ))}
      </View>
    </Pressable>
  );
});

function PulsingDot() {
  const anim = useRef(new RNAnimated.Value(0.3)).current;

  useEffect(() => {
    const pulse = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 600, useNativeDriver: true }),
        RNAnimated.timing(anim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [anim]);

  return <RNAnimated.View style={[styles.pulseDot, { opacity: anim }]} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  rootLandscape: {
    alignItems: 'center',
  },
  inner: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  headerIcon: {
    backgroundColor: `${colors.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    color: colors.text,
  },
  headerSubtitle: {
    fontFamily: 'Inter_400Regular',
    color: colors.textMuted,
  },
  closeBtn: {
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    padding: 16,
    paddingBottom: 8,
    flexGrow: 1,
  },
  listContentEmpty: {
    justifyContent: 'center',
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingVertical: 40,
  },
  emptyTitle: {
    color: colors.textMuted,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    marginTop: 12,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: colors.textDark,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 4,
    textAlign: 'center',
  },
  bubbleWrap: {
    marginBottom: 8,
    maxWidth: '80%',
  },
  bubbleWrapBase: {
    alignSelf: 'flex-start',
  },
  bubbleWrapMine: {
    alignSelf: 'flex-end',
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderWidth: 1,
    minWidth: 160,
  },
  bubbleBase: {
    backgroundColor: `${colors.secondary}10`,
    borderColor: `${colors.secondary}20`,
    borderBottomLeftRadius: 4,
  },
  bubbleMine: {
    backgroundColor: `${colors.primary}10`,
    borderColor: `${colors.primary}20`,
    borderBottomRightRadius: 4,
  },
  playCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircleActive: {
    backgroundColor: colors.primary,
  },
  playCircleBase: {
    backgroundColor: `${colors.secondary}20`,
  },
  playCircleMine: {
    backgroundColor: `${colors.primary}20`,
  },
  bubbleMeta: {
    flexShrink: 1,
  },
  bubbleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  senderLabel: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  senderBase: {
    color: colors.secondary,
  },
  senderMine: {
    color: colors.primary,
  },
  durationText: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: colors.textMuted,
  },
  timeText: {
    fontSize: 9,
    fontFamily: 'Inter_400Regular',
    color: colors.textMuted,
    marginTop: 1,
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1.5,
    marginLeft: 4,
  },
  waveBar: {
    width: 2,
    borderRadius: 1,
  },
  waveBarActive: {
    backgroundColor: colors.primary,
  },
  waveBarBase: {
    backgroundColor: `${colors.secondary}40`,
  },
  waveBarMine: {
    backgroundColor: `${colors.primary}40`,
  },
  footer: {
    paddingTop: 16,
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    flexShrink: 0,
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  recordingCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${colors.primary}08`,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: `${colors.primary}25`,
    gap: 10,
  },
  recordingTime: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  recordingLabel: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: colors.textMuted,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.6,
  },
  recordBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 16,
    minHeight: 52,
    gap: 8,
  },
  recordBtnText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  pressed: {
    opacity: 0.85,
  },
});
