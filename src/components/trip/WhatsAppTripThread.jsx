import React, { memo, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { formatChatTime } from '../../constants/tripChat';
import {
  WHATSAPP_THREAD_PREVIEW_COUNT,
  displayWhatsAppThreadBody,
} from '../../../shared/whatsapp-trip-thread';

const WA_GREEN = '#25D366';

const WhatsAppThreadBubble = memo(function WhatsAppThreadBubble({
  direction,
  body,
  createdAt,
  compact,
}) {
  const incoming = direction === 'incoming';
  const label = incoming ? 'Pasajero' : 'Agencia';

  return (
    <View style={[styles.row, incoming ? styles.rowIncoming : styles.rowOutgoing]}>
      <View
        style={[
          styles.bubble,
          incoming ? styles.bubbleIncoming : styles.bubbleOutgoing,
          compact ? styles.bubbleCompact : null,
        ]}
      >
        <Text style={[styles.sender, incoming ? styles.senderIncoming : styles.senderOutgoing]}>
          {label}
        </Text>
        <Text style={[styles.body, incoming ? styles.bodyIncoming : styles.bodyOutgoing]}>
          {body}
        </Text>
        {createdAt ? (
          <Text style={[styles.time, incoming ? styles.timeIncoming : styles.timeOutgoing]}>
            {formatChatTime(createdAt)}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

export function WhatsAppSourceBadge({ compact = false }) {
  return (
    <View style={[styles.badge, compact ? styles.badgeCompact : null]}>
      <MaterialCommunityIcons name="whatsapp" size={compact ? 12 : 14} color={WA_GREEN} />
      <Text style={[styles.badgeText, compact ? styles.badgeTextCompact : null]}>WhatsApp</Text>
    </View>
  );
}

export function WhatsAppTripThread({ visible, loading, messages }) {
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const [expanded, setExpanded] = useState(false);

  const list = Array.isArray(messages) ? messages : [];
  const hiddenCount = Math.max(0, list.length - WHATSAPP_THREAD_PREVIEW_COUNT);
  const shown = useMemo(() => {
    if (expanded || list.length <= WHATSAPP_THREAD_PREVIEW_COUNT) return list;
    return list.slice(list.length - WHATSAPP_THREAD_PREVIEW_COUNT);
  }, [expanded, list]);

  if (!visible) return null;

  return (
    <View style={[styles.card, compact ? styles.cardCompact : null]}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <MaterialCommunityIcons name="whatsapp" size={18} color={WA_GREEN} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>WhatsApp de este viaje</Text>
          <Text style={styles.subtitle}>Mensajes entre la agencia y el pasajero</Text>
        </View>
      </View>

      {loading && list.length === 0 ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={WA_GREEN} />
          <Text style={styles.loadingText}>Cargando conversación…</Text>
        </View>
      ) : null}

      {!loading && list.length === 0 ? (
        <Text style={styles.empty}>
          Todavía no hay mensajes de este viaje. Cuando el pasajero escriba al WhatsApp de Profesional, van a aparecer acá.
        </Text>
      ) : null}

      {hiddenCount > 0 && !expanded ? (
        <Pressable
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          accessibilityLabel="Ver mensajes anteriores"
          style={styles.moreBtn}
        >
          <Text style={styles.moreText}>Ver {hiddenCount} mensajes anteriores</Text>
        </Pressable>
      ) : null}

      {shown.map((item) => (
        <WhatsAppThreadBubble
          key={String(item.id || item.whatsapp_message_id)}
          direction={item.direction}
          body={displayWhatsAppThreadBody(item)}
          createdAt={item.created_at}
          compact={compact}
        />
      ))}

      {expanded && hiddenCount > 0 ? (
        <Pressable
          onPress={() => setExpanded(false)}
          accessibilityRole="button"
          accessibilityLabel="Mostrar menos mensajes"
          style={styles.moreBtn}
        >
          <Text style={styles.moreText}>Mostrar menos</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F7FBF8',
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(37, 211, 102, 0.22)',
    padding: 14,
    marginBottom: 14,
    gap: 8,
  },
  cardCompact: {
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(37, 211, 102, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  empty: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  moreBtn: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  moreText: {
    color: WA_GREEN,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  row: {
    maxWidth: '88%',
  },
  rowIncoming: {
    alignSelf: 'flex-start',
  },
  rowOutgoing: {
    alignSelf: 'flex-end',
  },
  bubble: {
    borderRadius: 14,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 3,
  },
  bubbleCompact: {
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  bubbleIncoming: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleOutgoing: {
    backgroundColor: '#DCF8C6',
  },
  sender: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  senderIncoming: {
    color: WA_GREEN,
  },
  senderOutgoing: {
    color: colors.primary,
  },
  body: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    lineHeight: 18,
  },
  bodyIncoming: {
    color: colors.text,
  },
  bodyOutgoing: {
    color: colors.textDark,
  },
  time: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    alignSelf: 'flex-end',
  },
  timeIncoming: {
    color: colors.textLight,
  },
  timeOutgoing: {
    color: '#5B7A4E',
  },
  badge: {
    backgroundColor: 'rgba(37, 211, 102, 0.14)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badgeCompact: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: WA_GREEN,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  badgeTextCompact: {
    fontSize: 10,
  },
});
