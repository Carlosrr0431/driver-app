/**
 * Tarjeta de notas del viaje para el chofer.
 * Compacta en oferta / sheet activo; el overlay centrado solo se abre al tocarla.
 * Con alertOnChange, un cambio en tiempo real vibra, notifica y resalta el recuadro
 * (no abre el overlay, para no tapar el mapa ni los botones del sheet).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '../../theme/colors';
import { sendLocalNotification } from '../../services/notifications';

const HIGHLIGHT_MS = 10000;
const MAP_BTN_SIZE = 48;

export function useTripNotesHighlight({
  notes,
  tripId = null,
  alertOnChange = false,
} = {}) {
  const text = String(notes || '').trim();
  const [highlighted, setHighlighted] = useState(false);
  const prevRef = useRef({ tripId: undefined, text: undefined });

  useEffect(() => {
    if (!alertOnChange) return undefined;
    const prev = prevRef.current;
    if (prev.tripId !== tripId) {
      prevRef.current = { tripId, text };
      setHighlighted(false);
      return undefined;
    }
    if (prev.text === text) return undefined;
    prevRef.current = { tripId, text };

    if (!text) {
      setHighlighted(false);
      return undefined;
    }

    setHighlighted(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    sendLocalNotification(
      '📝 Notas actualizadas',
      text,
      { type: 'trip_notes', tripId },
    );

    const timer = setTimeout(() => setHighlighted(false), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [alertOnChange, tripId, text]);

  return { text, highlighted };
}

export function TripNotesOverlay({
  visible,
  text,
  highlighted = false,
  onClose,
  mapReturn = false,
}) {
  const body = String(text || '').trim();
  if (!visible || !body) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={cardStyles.overlayRoot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cerrar notas"
        onPress={onClose}
        style={cardStyles.overlay}
      >
        <Pressable onPress={onClose} style={cardStyles.dialog}>
          <View style={cardStyles.dialogHead}>
            <Text style={cardStyles.dialogKicker}>
              {highlighted ? 'Notas actualizadas' : 'Notas del viaje'}
            </Text>
            <Text style={cardStyles.dialogHint}>
              {mapReturn
                ? 'Tocá en cualquier parte para volver al mapa'
                : 'Tocá afuera para salir'}
            </Text>
          </View>
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            style={cardStyles.dialogScroll}
          >
            <Text style={cardStyles.dialogBody}>{body}</Text>
          </ScrollView>
        </Pressable>
      </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

export function TripNotesMapButton({
  highlighted = false,
  onPress,
  bottom = 160,
  left = 12,
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={highlighted ? 'Notas actualizadas. Tocá para ver' : 'Ver notas del viaje'}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        fabStyles.btn,
        highlighted ? fabStyles.btnAlert : null,
        { bottom, left, opacity: pressed ? 0.88 : 1 },
      ]}
    >
      <MaterialCommunityIcons
        name={highlighted ? 'note-alert-outline' : 'note-text-outline'}
        size={22}
        color={highlighted ? '#B45309' : colors.primary}
      />
      {highlighted ? <View style={fabStyles.dot} /> : null}
    </Pressable>
  );
}

export function TripNotesCard({
  notes,
  style,
  alertOnChange = false,
  tripId = null,
  onExpand,
  onDismiss,
  highlighted: highlightedProp,
  onPress,
  showOverlay = true,
}) {
  const own = useTripNotesHighlight({
    notes,
    tripId,
    alertOnChange: alertOnChange && highlightedProp === undefined,
  });
  const text = own.text;
  const highlighted = highlightedProp ?? own.highlighted;
  const [expanded, setExpanded] = useState(false);

  const openExpanded = () => {
    if (typeof onPress === 'function') {
      onPress();
      return;
    }
    setExpanded(true);
    if (typeof onExpand === 'function') onExpand();
  };

  const closeExpanded = () => {
    setExpanded(false);
    if (typeof onDismiss === 'function') onDismiss();
  };

  useEffect(() => {
    if (!text) setExpanded(false);
  }, [text]);

  if (!text) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={highlighted ? 'Notas del viaje actualizadas' : 'Ver notas del viaje'}
        onPress={openExpanded}
        style={({ pressed }) => [
          cardStyles.compact,
          highlighted ? cardStyles.compactAlert : null,
          { opacity: pressed ? 0.88 : 1 },
          style,
        ]}
      >
        <View style={cardStyles.compactHead}>
          <MaterialCommunityIcons
            name={highlighted ? 'alert-circle-outline' : 'note-text-outline'}
            size={18}
            color={highlighted ? '#B45309' : colors.text}
          />
          <Text style={[cardStyles.kicker, highlighted ? cardStyles.kickerAlert : null]}>
            {highlighted ? 'NOTAS ACTUALIZADAS' : 'NOTAS'}
          </Text>
          <Text style={cardStyles.hint}>Tocá para agrandar</Text>
        </View>
        <Text style={cardStyles.compactBody} numberOfLines={4}>
          {text}
        </Text>
      </Pressable>

      {showOverlay ? (
        <TripNotesOverlay
          visible={expanded}
          text={text}
          highlighted={highlighted}
          onClose={closeExpanded}
          mapReturn={typeof onDismiss === 'function' || typeof onExpand === 'function'}
        />
      ) : null}
    </>
  );
}

const cardStyles = {
  compact: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  compactAlert: {
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
  },
  compactHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  kicker: {
    color: '#0F172A',
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.7,
    flexGrow: 0,
  },
  kickerAlert: {
    color: '#B45309',
  },
  hint: {
    color: '#94A3B8',
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    marginLeft: 'auto',
  },
  compactBody: {
    color: '#0F172A',
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 22,
  },
  overlayRoot: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.58)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '72%',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 22,
  },
  dialogHead: {
    marginBottom: 14,
    gap: 4,
  },
  dialogKicker: {
    color: '#0F172A',
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  dialogHint: {
    color: '#94A3B8',
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  dialogScroll: {
    flexGrow: 0,
  },
  dialogBody: {
    color: '#0F172A',
    fontSize: 22,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 32,
  },
};

const fabStyles = {
  btn: {
    position: 'absolute',
    width: MAP_BTN_SIZE,
    height: MAP_BTN_SIZE,
    borderRadius: MAP_BTN_SIZE / 2,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 4,
    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.16)',
    zIndex: 20,
  },
  btnAlert: {
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
  },
  dot: {
    position: 'absolute',
    top: 9,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F59E0B',
  },
};
