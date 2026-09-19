import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { formatPrice } from '../utils/formatters';
import { shouldShowCommissionDebtUi } from '../../shared/driver-billing';

/**
 * Cartel de comisiones pendientes. Solo plan commission_current.
 * El cobro semanal acumula igual en BD, pero no se muestra al chofer.
 */
export default function CommissionDebtBanner({ commissionData, onPayPress }) {
  if (!shouldShowCommissionDebtUi(commissionData)) return null;
  if (!commissionData?.isBlocked && !(commissionData.balance > 0)) return null;

  const blocked = Boolean(commissionData.isBlocked);

  return (
    <View style={{
      backgroundColor: blocked ? '#EEEEF8' : '#FFFBEB',
      borderRadius: 14,
      padding: 14,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: blocked ? '#C5C8E8' : '#FDE68A',
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
        <MaterialCommunityIcons
          name={blocked ? 'alert-circle' : 'cash-clock'}
          size={17}
          color={blocked ? '#282e69' : '#D97706'}
        />
        <Text style={{
          color: blocked ? '#DC2626' : '#D97706',
          fontSize: 13,
          fontFamily: 'Inter_700Bold',
          marginLeft: 7,
        }}>
          {blocked ? 'Cuenta suspendida' : 'Comisión pendiente'}
        </Text>
      </View>
      <Text style={{ color: '#6B7280', fontSize: 11, fontFamily: 'Inter_400Regular', lineHeight: 16 }}>
        {blocked
          ? 'Tu cuenta está bloqueada por comisiones vencidas. Regularizá tu deuda para recibir viajes.'
          : 'Tenés comisiones pendientes. Tenés 1 semana de trabajo + 3 días de gracia para regularizar.'}
      </Text>
      <View style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: blocked ? '#D5D8F0' : '#FEF3C7',
      }}>
        <Text style={{ color: '#9CA3AF', fontSize: 10, fontFamily: 'Inter_500Medium' }}>Deuda actual</Text>
        <Text style={{
          color: blocked ? '#282e69' : '#D97706',
          fontSize: 16,
          fontFamily: 'Inter_700Bold',
        }}>
          {formatPrice(commissionData.balance)}
        </Text>
      </View>
      <Pressable
        onPress={onPayPress}
        style={({ pressed }) => ({
          marginTop: 10,
          backgroundColor: blocked ? '#282e69' : '#D97706',
          borderRadius: 10,
          paddingVertical: 9,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <MaterialCommunityIcons name="credit-card-outline" size={15} color="#FFFFFF" />
        <Text style={{ color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_700Bold' }}>
          Pagar comisión
        </Text>
      </Pressable>
    </View>
  );
}
