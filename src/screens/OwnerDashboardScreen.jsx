import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { colors } from '../theme/colors';
import { useOwner } from '../hooks/useOwner';
import { useAuthStore } from '../stores/authStore';
import { Avatar } from '../components/ui/Avatar';
import { formatPrice } from '../utils/formatters';

const OwnerDashboardScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { driver } = useAuthStore();
  const { useLinkedDrivers, useOwnerTodayStats, toggleDriverStatus } = useOwner();

  const { data: linkedDrivers = [], isLoading, refetch, isRefetching } = useLinkedDrivers();
  const { data: todayStats } = useOwnerTodayStats();

  const handleToggleStatus = useCallback((linkedDriver) => {
    const newStatus = !linkedDriver.is_available;
    const actionLabel = newStatus ? 'activar' : 'desactivar';
    Alert.alert(
      `${newStatus ? 'Activar' : 'Desactivar'} conductor`,
      `¿Querés ${actionLabel} a ${linkedDriver.full_name}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: newStatus ? 'Activar' : 'Desactivar',
          style: newStatus ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await toggleDriverStatus.mutateAsync({ driverId: linkedDriver.id, isAvailable: newStatus });
              Toast.show({
                type: 'success',
                text1: `Conductor ${newStatus ? 'activado' : 'desactivado'}`,
                text2: linkedDriver.full_name,
              });
            } catch (err) {
              Toast.show({ type: 'error', text1: 'Error', text2: err.message });
            }
          },
        },
      ],
    );
  }, [toggleDriverStatus]);

  const renderDriver = useCallback(({ item, index }) => (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => navigation.navigate('OwnerDriverDetail', { driverId: item.id, driverName: item.full_name })}
        style={{
          backgroundColor: colors.surface,
          borderRadius: 16,
          padding: 14,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: colors.border,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        {/* Avatar */}
        <View style={{
          borderRadius: 26,
          borderWidth: 2,
          borderColor: item.is_available ? colors.success : colors.border,
          padding: 2,
        }}>
          <Avatar uri={item.photo_url} name={item.full_name} size={48} />
        </View>

        {/* Info */}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
            {item.full_name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
            {item.driver_number && (
              <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginRight: 8 }}>
                Móvil #{item.driver_number}
              </Text>
            )}
            {item.vehicle_plate && (
              <View style={{
                backgroundColor: colors.surfaceLight, borderRadius: 6,
                paddingHorizontal: 6, paddingVertical: 1,
              }}>
                <Text style={{ color: colors.textDark, fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 }}>
                  {item.vehicle_plate}
                </Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            <MaterialCommunityIcons name="star" size={12} color={colors.warning} />
            <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular', marginLeft: 3 }}>
              {Number(item.rating || 5).toFixed(1)} · {item.total_trips || 0} viajes
            </Text>
          </View>
        </View>

        {/* Status + chevron */}
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          <TouchableOpacity
            onPress={() => handleToggleStatus(item)}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: item.is_available ? `${colors.success}18` : `${colors.textMuted}18`,
              borderRadius: 20,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <View style={{
              width: 7, height: 7, borderRadius: 4,
              backgroundColor: item.is_available ? colors.success : colors.textMuted,
              marginRight: 5,
            }} />
            <Text style={{
              fontSize: 11, fontFamily: 'Inter_600SemiBold',
              color: item.is_available ? colors.success : colors.textMuted,
            }}>
              {item.is_available ? 'Activo' : 'Inactivo'}
            </Text>
          </TouchableOpacity>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  ), [navigation, handleToggleStatus]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* Header gradient */}
      <LinearGradient
        colors={[`${colors.primary}18`, colors.background]}
        style={{ paddingTop: insets.top + 12, paddingBottom: 20, paddingHorizontal: 20 }}
      >
        <Animated.View entering={FadeIn.duration(400)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 12 }}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontFamily: 'Inter_700Bold' }}>
              Mis conductores
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 }}>
              {linkedDrivers.length} conductor{linkedDrivers.length !== 1 ? 'es' : ''} vinculado{linkedDrivers.length !== 1 ? 's' : ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('CreateLinkedDriver')}
            activeOpacity={0.8}
            style={{
              width: 38, height: 38, borderRadius: 12,
              backgroundColor: colors.primary,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        </Animated.View>

        {/* Today Stats */}
        <Animated.View entering={FadeInDown.delay(100).duration(400)}>
          <View style={{
            backgroundColor: colors.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            flexDirection: 'row',
            overflow: 'hidden',
          }}>
            <StatBlock
              icon="cash-multiple"
              label="Ganancias hoy"
              value={formatPrice(todayStats?.totalEarnings || 0)}
              color={colors.success}
            />
            <View style={{ width: 1, backgroundColor: colors.border }} />
            <StatBlock
              icon="car-multiple"
              label="Viajes hoy"
              value={String(todayStats?.totalTrips || 0)}
              color={colors.info}
            />
            <View style={{ width: 1, backgroundColor: colors.border }} />
            <StatBlock
              icon="account-check"
              label="Activos ahora"
              value={`${todayStats?.activeDrivers || 0}/${todayStats?.totalDrivers || 0}`}
              color={colors.success}
            />
          </View>
        </Animated.View>
      </LinearGradient>

      {/* Drivers list */}
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.textMuted, marginTop: 12, fontFamily: 'Inter_400Regular' }}>
            Cargando conductores...
          </Text>
        </View>
      ) : (
        <FlatList
          data={linkedDrivers}
          keyExtractor={(item) => item.id}
          renderItem={renderDriver}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 30 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            <Animated.View entering={FadeIn.delay(200)} style={{ alignItems: 'center', marginTop: 60 }}>
              <View style={{
                width: 72, height: 72, borderRadius: 36,
                backgroundColor: `${colors.primary}12`,
                alignItems: 'center', justifyContent: 'center',
                marginBottom: 16,
              }}>
                <MaterialCommunityIcons name="account-group-outline" size={34} color={colors.primary} />
              </View>
              <Text style={{ color: colors.text, fontSize: 16, fontFamily: 'Inter_600SemiBold', marginBottom: 6 }}>
                Sin conductores vinculados
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 40, lineHeight: 20 }}>
                Agregá conductores para gestionar sus viajes y comisiones desde acá.
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('CreateLinkedDriver')}
                activeOpacity={0.85}
                style={{ marginTop: 20 }}
              >
                <LinearGradient
                  colors={colors.gradient.primary}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12,
                  }}
                >
                  <Ionicons name="add" size={18} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>
                    Agregar conductor
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
          }
        />
      )}
    </View>
  );
};

const StatBlock = ({ icon, label, value, color }) => (
  <View style={{ flex: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 8 }}>
    <MaterialCommunityIcons name={icon} size={20} color={color} style={{ marginBottom: 4 }} />
    <Text style={{ color: colors.text, fontSize: 15, fontFamily: 'Inter_700Bold' }}>{value}</Text>
    <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2, textAlign: 'center' }}>
      {label}
    </Text>
  </View>
);

export default OwnerDashboardScreen;
