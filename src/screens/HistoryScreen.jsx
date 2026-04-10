import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useTrips } from '../hooks/useTrips';
import { formatPrice, formatDistance } from '../utils/formatters';

const FILTERS = [
  { key: 'today', label: 'Hoy' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'all', label: 'Todo' },
];

const HistoryScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [activeFilter, setActiveFilter] = useState('today');
  const [searchTerm, setSearchTerm] = useState('');
  const { useTripHistory } = useTrips();

  const {
    data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useTripHistory(activeFilter);

  const allTrips = data?.pages?.flatMap((page) => page.data) || [];
  const filteredTrips = allTrips.filter((trip) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      trip.passenger_name?.toLowerCase().includes(term) ||
      trip.origin_address?.toLowerCase().includes(term) ||
      trip.destination_address?.toLowerCase().includes(term)
    );
  });

  const totalEarnings = filteredTrips.reduce((sum, t) => sum + (Number(t.price) || 0), 0);
  const totalTrips = filteredTrips.length;

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  };

  const renderTrip = useCallback(({ item }) => (
    <HistoryTripRow
      trip={item}
      onPress={() => navigation.navigate('TripDetail', { tripId: item.id })}
    />
  ), []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Header */}
      <Animated.View entering={FadeIn.duration(400)} style={{
        paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 0,
      }}>
        <Text style={{ color: colors.text, fontSize: 20, fontFamily: 'Inter_700Bold', marginBottom: 14 }}>
          Historial
        </Text>

        {/* Search */}
        <View style={{
          backgroundColor: colors.surface, borderRadius: 14,
          borderWidth: 1, borderColor: colors.border,
          flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, marginBottom: 14,
        }}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={searchTerm} onChangeText={setSearchTerm}
            placeholder="Buscar viaje..." placeholderTextColor={colors.textDark}
            style={{
              flex: 1, color: colors.text, fontSize: 14,
              fontFamily: 'Inter_400Regular', paddingVertical: 11, marginLeft: 10,
            }}
          />
          {searchTerm.length > 0 && (
            <TouchableOpacity onPress={() => setSearchTerm('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filters */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          {FILTERS.map((f) => {
            const active = activeFilter === f.key;
            return (
              <TouchableOpacity key={f.key} onPress={() => setActiveFilter(f.key)}
                activeOpacity={0.7}
                style={{
                  paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
                  backgroundColor: active ? `${colors.primary}15` : colors.surface,
                  borderWidth: 1.5,
                  borderColor: active ? colors.primary : colors.border,
                }}>
                <Text style={{
                  color: active ? colors.primary : colors.textMuted,
                  fontSize: 13, fontFamily: active ? 'Inter_600SemiBold' : 'Inter_500Medium',
                }}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Summary */}
        <View style={{
          backgroundColor: colors.surface, borderRadius: 16, padding: 16,
          flexDirection: 'row', borderWidth: 1, borderColor: colors.border, marginBottom: 4,
        }}>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <View style={{
              width: 36, height: 36, borderRadius: 12,
              backgroundColor: `${colors.primary}12`, alignItems: 'center', justifyContent: 'center', marginBottom: 6,
            }}>
              <MaterialCommunityIcons name="car-side" size={18} color={colors.primary} />
            </View>
            <Text style={{ color: colors.text, fontSize: 20, fontFamily: 'Inter_700Bold' }}>{totalTrips}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular' }}>Viajes</Text>
          </View>
          <View style={{ width: 1, backgroundColor: colors.border, marginHorizontal: 8 }} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <View style={{
              width: 36, height: 36, borderRadius: 12,
              backgroundColor: `${colors.secondary}12`, alignItems: 'center', justifyContent: 'center', marginBottom: 6,
            }}>
              <MaterialCommunityIcons name="cash" size={18} color={colors.secondary} />
            </View>
            <Text style={{ color: colors.secondary, fontSize: 20, fontFamily: 'Inter_700Bold' }}>
              {formatPrice(totalEarnings)}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular' }}>Ganancia</Text>
          </View>
        </View>
      </Animated.View>

      {/* Trip list */}
      {isLoading ? (
        <View style={{ padding: 16, gap: 8 }}>
          {[1, 2, 3, 4].map(i => (
            <View key={i} style={{
              backgroundColor: colors.surface, borderRadius: 14, height: 68,
              borderWidth: 1, borderColor: colors.border, opacity: 0.5,
            }} />
          ))}
        </View>
      ) : (
        <FlatList
          data={filteredTrips}
          renderItem={renderTrip}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            <View style={{
              backgroundColor: colors.surface, borderRadius: 16, padding: 36,
              alignItems: 'center', borderWidth: 1, borderColor: colors.border, marginTop: 20,
            }}>
              <MaterialCommunityIcons name="car-off" size={40} color={colors.textMuted} style={{ marginBottom: 10 }} />
              <Text style={{ color: colors.textMuted, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
                Sin viajes
              </Text>
              <Text style={{ color: colors.textDark, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4, textAlign: 'center' }}>
                No hay viajes en el período seleccionado
              </Text>
            </View>
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={{ padding: 16, alignItems: 'center' }}>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>Cargando más...</Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
};

/* Trip row for history */
const HistoryTripRow = ({ trip, onPress }) => {
  const sc = {
    completed: colors.success, cancelled: colors.danger, in_progress: colors.primary,
    pending: colors.warning, accepted: colors.info, going_to_pickup: colors.primary,
  };
  const statusLabels = {
    completed: 'Completado', cancelled: 'Cancelado', in_progress: 'En curso',
    pending: 'Pendiente', accepted: 'Aceptado', going_to_pickup: 'En camino',
  };
  const c = sc[trip.status] || colors.textMuted;
  const time = trip.created_at
    ? new Date(trip.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : '';
  const date = trip.created_at
    ? new Date(trip.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
    : '';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={{
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 8,
      borderWidth: 1, borderColor: colors.border,
    }}>
      <View style={{
        width: 42, height: 42, borderRadius: 13,
        backgroundColor: `${c}12`, alignItems: 'center', justifyContent: 'center',
      }}>
        <MaterialCommunityIcons
          name={trip.status === 'completed' ? 'check-circle' : trip.status === 'cancelled' ? 'close-circle' : 'navigation'}
          size={20} color={c}
        />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontFamily: 'Inter_600SemiBold' }} numberOfLines={1}>
          {trip.destination_address || 'Viaje'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
          <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular' }}>
            {date} · {time}
          </Text>
          <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.textDark, marginHorizontal: 6 }} />
          <Text style={{ color: c, fontSize: 10, fontFamily: 'Inter_600SemiBold' }}>
            {statusLabels[trip.status] || trip.status}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: c, fontSize: 15, fontFamily: 'Inter_700Bold' }}>
          {formatPrice(trip.price)}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
          {formatDistance(trip.distance_km)}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

export default HistoryScreen;
