import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  FlatList,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Keyboard,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '../../theme/colors';
import {
  formatAudioDuration,
  formatChatTime,
  getMessageReceiptStatus,
  TRIP_CHAT_MAX_TEXT_LENGTH,
} from '../../constants/tripChat';

const spacing = { sm: 8, md: 12, lg: 16, xl: 20 };
const radius = { md: 14, lg: 18 };
const RECEIPT_SEEN = '#34B7F1';
const RECEIPT_SENT = 'rgba(255,255,255,0.72)';
const RECEIPT_SENT_OTHER = '#8A94A6';
/** Separación extra entre el composer y el teclado nativo. */
const KEYBOARD_EXTRA_GAP = 14;

function MessageReceipt({ status, mine }) {
  if (!mine) return null;
  const muted = mine ? RECEIPT_SENT : RECEIPT_SENT_OTHER;
  if (status === 'pending') {
    return <Ionicons name="time-outline" size={14} color={muted} style={styles.receiptIcon} />;
  }
  const color = status === 'seen' ? RECEIPT_SEEN : muted;
  return (
    <View style={styles.receiptDouble}>
      <Ionicons name="checkmark" size={13} color={color} style={styles.receiptCheckBack} />
      <Ionicons name="checkmark" size={13} color={color} />
    </View>
  );
}

function AudioBubble({ mine, duration, onPlay, ready = true, playing = false }) {
  return (
    <Pressable
      onPress={onPlay}
      disabled={!ready}
      style={({ pressed }) => [
        styles.audioRow,
        mine ? styles.audioRowMine : styles.audioRowOther,
        pressed && ready && { opacity: 0.9 },
        !ready && { opacity: 0.7 },
      ]}
    >
      <View style={[styles.playCircle, mine ? styles.playCircleMine : styles.playCircleOther]}>
        {!ready ? (
          <ActivityIndicator size="small" color={mine ? colors.primary : '#FFFFFF'} />
        ) : (
          <Ionicons
            name={playing ? 'pause' : 'play'}
            size={16}
            color={mine ? colors.primary : '#FFFFFF'}
          />
        )}
      </View>
      <View style={styles.audioWave}>
        {[4, 10, 7, 14, 9, 12, 6, 11].map((h, i) => (
          <View
            key={`w-${i}`}
            style={[
              styles.waveBar,
              { height: h },
              mine ? styles.waveBarMine : styles.waveBarOther,
            ]}
          />
        ))}
      </View>
      <Text style={[styles.audioDuration, mine ? styles.metaMine : styles.metaOther]}>
        {formatAudioDuration(duration)}
      </Text>
    </Pressable>
  );
}

function senderLabel(role) {
  if (role === 'driver') return 'Chofer';
  if (role === 'passenger') return 'Pasajero';
  return 'Mensaje';
}

function MessageBubble({ item, myRole, onPlayAudio, playingAudioUrl }) {
  const mine = item.sender_role === myRole;
  const isAudio = item.message_type === 'audio';
  const label = senderLabel(item.sender_role);
  const playing = Boolean(item.audio_url && playingAudioUrl === item.audio_url);
  const receipt = getMessageReceiptStatus(item);

  return (
    <View style={[styles.bubbleWrap, mine ? styles.bubbleWrapMine : styles.bubbleWrapOther]}>
      <Text style={[styles.senderLabel, mine ? styles.senderLabelMine : styles.senderLabelOther]}>
        {label}
      </Text>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
        {isAudio ? (
          <AudioBubble
            mine={mine}
            duration={item.audio_duration_seconds}
            ready={!!item.audio_url}
            playing={playing}
            onPlay={() => {
              onPlayAudio?.(item);
            }}
          />
        ) : (
          <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : styles.bubbleTextOther]}>
            {item.body}
          </Text>
        )}
        <View style={[styles.metaRow, mine ? styles.metaRowMine : styles.metaRowOther]}>
          <Text style={[styles.timeText, mine ? styles.metaMine : styles.metaOther]}>
            {formatChatTime(item.created_at)}
          </Text>
          <MessageReceipt status={receipt} mine={mine} />
        </View>
      </View>
    </View>
  );
}

/**
 * Chat en tiempo real conductor ↔ pasajero (texto + audio).
 * Android: overlay absoluto (sin Modal) para que adjustResize eleve el composer.
 * iOS: Modal + KeyboardAvoidingView.
 */
export default function TripChatModal({
  visible,
  onClose,
  title = 'Chat del viaje',
  subtitle = 'Mensajes en tiempo real',
  myRole = 'driver',
  messages = [],
  loading = false,
  sending = false,
  recording = false,
  recordingTime = 0,
  writable = true,
  onSendText,
  onStartRecording,
  onCancelRecording,
  onSendRecording,
  onPlayAudio,
  playingAudioUrl = null,
}) {
  const insets = useSafeAreaInsets();
  const listRef = useRef(null);
  const [text, setText] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
      setText('');
      return undefined;
    }
    // absoluteFill + Modal no siempre se achican con adjustResize; padding manual en ambas plataformas.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e) => setKeyboardHeight(e?.endCoordinates?.height || 0);
    const onHide = () => setKeyboardHeight(0);
    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  const keyboardOffset = keyboardHeight > 0 ? keyboardHeight + KEYBOARD_EXTRA_GAP : 0;
  // Invertida + datos al revés: el mensaje nuevo queda abajo sin saltos (estilo WhatsApp).
  const listData = useMemo(() => [...messages].reverse(), [messages]);

  useEffect(() => {
    if (!visible || keyboardOffset <= 0) return undefined;
    const t = setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 60);
    return () => clearTimeout(t);
  }, [visible, keyboardOffset]);

  const handleClose = () => {
    Keyboard.dismiss();
    onClose?.();
  };

  // Android: el chat es overlay (no Modal); el atrás nativo debe cerrarlo, no salir de la app.
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return undefined;
    const onBack = () => {
      Keyboard.dismiss();
      onClose?.();
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [visible, onClose]);

  const handleSend = async () => {
    const value = text.trim();
    if (!value || sending || !writable) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setText('');
    await onSendText?.(value);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
  };

  const handleMicPress = async () => {
    if (!writable || sending) return;
    if (recording) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await onSendRecording?.();
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      });
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await onStartRecording?.();
  };

  const composerPadBottom = Math.max(insets.bottom, spacing.md);

  const chatBody = (
    <View style={[
      styles.root,
      Platform.OS === 'ios' && keyboardOffset > 0 ? { paddingBottom: keyboardOffset } : null,
    ]}
    >
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.md) }]}>
        <View style={styles.headerIcon}>
          <Ionicons name="chatbubbles" size={20} color={colors.primary} />
        </View>
        <View style={styles.headerTextCol}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
        </View>
        <Pressable
          onPress={handleClose}
          style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.85 }]}
          hitSlop={8}
        >
          <Ionicons name="close" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.stateText}>Cargando mensajes...</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.list}
          inverted
          data={listData}
          keyExtractor={(item) => String(item.id || item.client_id)}
          contentContainerStyle={[
            styles.listContent,
            messages.length === 0 && styles.listEmpty,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          maintainVisibleContentPosition={{
            minIndexForVisible: 0,
            autoscrollToTopThreshold: 40,
          }}
          renderItem={({ item }) => (
            <MessageBubble
              item={item}
              myRole={myRole}
              onPlayAudio={onPlayAudio}
              playingAudioUrl={playingAudioUrl}
            />
          )}
          ListEmptyComponent={(
            <View style={[styles.emptyWrap, styles.emptyWrapInverted]}>
              <View style={styles.emptyIcon}>
                <Ionicons name="chatbubble-ellipses-outline" size={28} color={colors.accent} />
              </View>
              <Text style={styles.emptyTitle}>Coordiná el viaje</Text>
              <Text style={styles.emptySubtitle}>
                Enviá un mensaje de texto o un audio. La otra persona lo ve al instante.
              </Text>
            </View>
          )}
        />
      )}

      {recording ? (
        <View style={styles.recordingBar}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>
            Grabando {formatAudioDuration(recordingTime)}
          </Text>
          <Pressable onPress={onCancelRecording} style={styles.recordingCancel}>
            <Text style={styles.recordingCancelText}>Cancelar</Text>
          </Pressable>
        </View>
      ) : null}

      {!writable ? (
        <View style={[styles.closedBar, { paddingBottom: composerPadBottom }]}>
          <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} />
          <Text style={styles.closedText}>El chat se cerró al finalizar el viaje</Text>
        </View>
      ) : (
        <View style={[styles.composer, { paddingBottom: composerPadBottom }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Escribí un mensaje..."
            placeholderTextColor={colors.textLight}
            style={styles.input}
            multiline
            maxLength={TRIP_CHAT_MAX_TEXT_LENGTH}
            editable={!sending && !recording}
            textAlignVertical="center"
          />
          {text.trim() ? (
            <Pressable
              onPress={handleSend}
              disabled={sending}
              style={({ pressed }) => [
                styles.sendBtn,
                pressed && { opacity: 0.9 },
                sending && { opacity: 0.6 },
              ]}
            >
              {sending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Ionicons name="send" size={18} color="#FFFFFF" />
              )}
            </Pressable>
          ) : (
            <Pressable
              onPress={handleMicPress}
              disabled={sending}
              style={({ pressed }) => [
                styles.micBtn,
                recording && styles.micBtnActive,
                pressed && { opacity: 0.9 },
              ]}
            >
              <Ionicons
                name={recording ? 'send' : 'mic'}
                size={20}
                color={recording ? '#FFFFFF' : colors.primary}
              />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );

  if (Platform.OS === 'android') {
    if (!visible) return null;
    return (
      <View
        style={[styles.androidOverlay, { bottom: keyboardOffset }]}
        accessibilityViewIsModal
      >
        {chatBody}
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      {chatBody}
    </Modal>
  );
}

const styles = StyleSheet.create({
  androidOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: colors.background,
  },
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight || colors.border,
    backgroundColor: colors.surface,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.accentMuted || colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextCol: { flex: 1, minWidth: 0 },
  title: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: colors.primary,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: colors.textMuted,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceLight || colors.background,
  },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  listEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  stateText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: colors.textMuted,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  // FlatList inverted da vuelta el empty; lo corregimos.
  emptyWrapInverted: {
    transform: [{ scaleY: -1 }],
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.accentMuted || colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: colors.primary,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  bubbleWrap: {
    marginBottom: spacing.sm,
    maxWidth: '82%',
  },
  bubbleWrapMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleWrapOther: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  senderLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.3,
    marginBottom: 4,
    marginHorizontal: 4,
  },
  senderLabelMine: { color: colors.accent },
  senderLabelOther: { color: colors.textMuted },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.sm,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 6,
  },
  bubbleOther: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight || colors.border,
    borderBottomLeftRadius: 6,
  },
  bubbleText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    lineHeight: 21,
  },
  bubbleTextMine: { color: '#FFFFFF' },
  bubbleTextOther: { color: colors.text },
  timeText: {
    marginTop: 0,
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  metaRowMine: {
    justifyContent: 'flex-end',
    alignSelf: 'stretch',
  },
  metaRowOther: {
    justifyContent: 'flex-start',
    alignSelf: 'stretch',
  },
  receiptIcon: {
    marginTop: 0,
  },
  receiptDouble: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 18,
  },
  receiptCheckBack: {
    marginRight: -7,
  },
  metaMine: { color: 'rgba(255,255,255,0.72)' },
  metaOther: { color: colors.textMuted },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 160,
  },
  audioRowMine: {},
  audioRowOther: {},
  playCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircleMine: { backgroundColor: '#FFFFFF' },
  playCircleOther: { backgroundColor: colors.primary },
  audioWave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 18,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
  },
  waveBarMine: { backgroundColor: 'rgba(255,255,255,0.85)' },
  waveBarOther: { backgroundColor: colors.accent },
  audioDuration: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.dangerBg || '#FEF2F2',
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
  recordingText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: colors.dangerDark || colors.danger,
  },
  recordingCancel: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  recordingCancelText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: colors.danger,
  },
  closedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight || colors.border,
    backgroundColor: colors.surface,
  },
  closedText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: colors.textMuted,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight || colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.borderLight || colors.border,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: colors.text,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentMuted || colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnActive: {
    backgroundColor: colors.primary,
  },
});
