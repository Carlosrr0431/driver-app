import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { StreetHailCancelButton } from './StreetHailCancelButton';

function ModeCard({
  icon,
  title,
  subtitle,
  accent,
  onPress,
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      delayPressIn={0}
      style={({ pressed }) => [
        styles.card,
        { borderColor: `${accent}55` },
        pressed ? { opacity: 0.9, transform: [{ scale: 0.985 }] } : null,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: `${accent}18` }]}>
        <MaterialCommunityIcons name={icon} size={26} color={accent} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.cardTitle, { color: accent }]}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={accent} />
    </Pressable>
  );
}

/**
 * Mismas dos opciones que tras "Pasajero a bordo" sin destino:
 * ingresar dirección o ir libre (tarifa por km GPS).
 */
export function ChooseDestinationMode({
  isStreetHail = false,
  cancelling = false,
  onChooseText,
  onChooseFreeRide,
  onCancel,
}) {
  return (
    <View style={styles.wrap}>
      {isStreetHail ? (
        <View style={styles.badge}>
          <MaterialCommunityIcons name="car-arrow-right" size={16} color={colors.primary} />
          <Text style={styles.badgeText}>Viaje en calle</Text>
        </View>
      ) : null}
      <Text style={styles.title}>¿Cómo ingresás el destino?</Text>
      <Text style={styles.lead}>
        {isStreetHail
          ? 'El pasajero ya está a bordo. Elegí destino o andá sin uno fijo.'
          : 'Escribí la dirección o andá sin destino y cobrá por los km recorridos.'}
      </Text>

      <ModeCard
        icon="map-search-outline"
        title="Ingresar destino por texto"
        subtitle="Escribí la dirección y seleccioná"
        accent={colors.primary}
        onPress={onChooseText}
      />
      <ModeCard
        icon="car-cruise-control"
        title="Ir sin destino"
        subtitle="La tarifa se calcula por los kilómetros recorridos"
        accent={colors.warningDark}
        onPress={onChooseFreeRide}
      />

      {isStreetHail && onCancel ? (
        <View style={styles.cancelWrap}>
          <StreetHailCancelButton cancelling={cancelling} onPress={onCancel} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'stretch',
    paddingBottom: 4,
  },
  badge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: `${colors.primary}12`,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 10,
  },
  badgeText: {
    color: colors.primary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  lead: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 10,
    backgroundColor: colors.surface,
    boxShadow: '0 4px 14px rgba(15,23,42,0.06)',
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  cardSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 3,
    lineHeight: 16,
  },
  cancelWrap: {
    marginTop: 6,
  },
});
