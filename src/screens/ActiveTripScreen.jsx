import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, Linking, Dimensions, TouchableOpacity, StatusBar } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetView, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme/colors';
import { useTripStore } from '../stores/tripStore';
import { useTrips } from '../hooks/useTrips';
import { useLocation } from '../hooks/useLocation';
import { TripMap } from '../components/map/TripMap';
import { TripStepper } from '../components/trip/TripStepper';
import { TripSummary } from '../components/trip/TripSummary';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';
import { TRIP_STATUS, EMERGENCY_PHONE, DISPATCHER_PHONE } from '../utils/constants';
import { formatTimerMMSS, formatSpeed, formatPrice } from '../utils/formatters';
import { getDirections } from '../services/googleMaps';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const ActiveTripScreen = () => {
  const navigation = useNavigation();
  const bottomSheetRef = useRef(null);
  const timerRef = useRef(null);

  const { activeTrip, tripTimer, setTripTimer, clearActiveTrip } = useTripStore();
  const { updateTripStatus } = useTrips();
  const { currentLocation, heading, speed, startTracking, stopTracking } = useLocation();

  const [routePolyline, setRoutePolyline] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [completedTrip, setCompletedTrip] = useState(null);

  const snapPoints = React.useMemo(() => ['25%', '55%'], []);

  useEffect(() => {
    if (!activeTrip) {
      navigation.goBack();
      return;
    }

    startTracking(activeTrip.id);
    fetchRoute();

    return () => {
      stopTracking();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeTrip?.id]);

  useEffect(() => {
    if (
      activeTrip?.status === TRIP_STATUS.IN_PROGRESS ||
      activeTrip?.status === TRIP_STATUS.GOING_TO_PICKUP
    ) {
      timerRef.current = setInterval(() => {
        const current = useTripStore.getState().tripTimer;
        setTripTimer(current + 1);
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeTrip?.status]);

  const fetchRoute = async () => {
    if (!activeTrip) return;
    try {
      let origin, destination;

      if (
        activeTrip.status === TRIP_STATUS.ACCEPTED ||
        activeTrip.status === TRIP_STATUS.GOING_TO_PICKUP
      ) {
        origin = currentLocation || {
          lat: activeTrip.origin_lat,
          lng: activeTrip.origin_lng,
        };
        destination = {
          lat: activeTrip.origin_lat,
          lng: activeTrip.origin_lng,
        };
      } else {
        origin = {
          lat: activeTrip.origin_lat,
          lng: activeTrip.origin_lng,
        };
        destination = {
          lat: activeTrip.destination_lat,
          lng: activeTrip.destination_lng,
        };
      }

      const result = await getDirections(origin, destination);
      setRoutePolyline(result.polyline);
    } catch (error) {
      console.log('Error fetching route:', error);
    }
  };

  const handleStatusAction = useCallback(async () => {
    if (!activeTrip) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    switch (activeTrip.status) {
      case TRIP_STATUS.ACCEPTED:
        await updateTripStatus(activeTrip.id, TRIP_STATUS.GOING_TO_PICKUP);
        break;
      case TRIP_STATUS.GOING_TO_PICKUP:
        await updateTripStatus(activeTrip.id, TRIP_STATUS.IN_PROGRESS);
        fetchRoute();
        break;
      case TRIP_STATUS.IN_PROGRESS:
        const result = await updateTripStatus(activeTrip.id, TRIP_STATUS.COMPLETED);
        if (result.success) {
          stopTracking();
          if (timerRef.current) clearInterval(timerRef.current);
          setCompletedTrip(result.data);
          setShowSummary(true);
        }
        break;
    }
  }, [activeTrip]);

  const getActionButton = () => {
    if (!activeTrip) return null;

    switch (activeTrip.status) {
      case TRIP_STATUS.ACCEPTED:
        return {
          title: '🚗 En camino al pasajero',
          variant: 'primary',
        };
      case TRIP_STATUS.GOING_TO_PICKUP:
        return {
          title: '👤 Pasajero a bordo - Iniciar',
          variant: 'success',
        };
      case TRIP_STATUS.IN_PROGRESS:
        return {
          title: '🏁 Finalizar Viaje',
          variant: 'success',
        };
      default:
        return null;
    }
  };

  const callPassenger = () => {
    if (activeTrip?.passenger_phone) {
      Linking.openURL(`tel:${activeTrip.passenger_phone}`);
    }
  };

  const callEmergency = () => {
    Linking.openURL(`tel:${EMERGENCY_PHONE}`);
  };

  const callDispatcher = () => {
    Linking.openURL(`tel:${DISPATCHER_PHONE}`);
  };

  const handleCloseSummary = () => {
    setShowSummary(false);
    navigation.goBack();
  };

  if (showSummary && completedTrip) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flex: 1, padding: 20, justifyContent: 'center' }}>
          <TripSummary trip={completedTrip} />
          <View style={{ marginTop: 24 }}>
            <Button
              title="Volver al inicio"
              variant="primary"
              size="lg"
              onPress={handleCloseSummary}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!activeTrip) return null;

  const actionButton = getActionButton();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Map - 75% */}
      <TripMap
        driverLocation={currentLocation}
        origin={{
          lat: activeTrip.origin_lat,
          lng: activeTrip.origin_lng,
          address: activeTrip.origin_address,
        }}
        destination={{
          lat: activeTrip.destination_lat,
          lng: activeTrip.destination_lng,
          address: activeTrip.destination_address,
        }}
        polyline={routePolyline}
        heading={heading}
        style={{ height: SCREEN_HEIGHT * 0.75 }}
      />

      {/* Speed Overlay */}
      <View
        style={{
          position: 'absolute',
          top: 60,
          left: 16,
          backgroundColor: 'rgba(26,26,46,0.92)',
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.08)',
          alignItems: 'center',
          minWidth: 60,
        }}
      >
        <Text style={{ color: colors.text, fontSize: 22, fontFamily: 'Inter_700Bold' }}>
          {formatSpeed(speed)}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 9, fontFamily: 'Inter_500Medium', marginTop: 1 }}>km/h</Text>
      </View>

      {/* Timer Overlay */}
      <View
        style={{
          position: 'absolute',
          top: 60,
          right: 16,
          backgroundColor: 'rgba(26,26,46,0.92)',
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.08)',
          alignItems: 'center',
          minWidth: 60,
        }}
      >
        <MaterialCommunityIcons name="timer-outline" size={14} color={colors.textMuted} />
        <Text style={{ color: colors.text, fontSize: 18, fontFamily: 'Inter_700Bold', marginTop: 2 }}>
          {formatTimerMMSS(tripTimer)}
        </Text>
      </View>

      {/* Bottom Sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        backgroundStyle={{
          backgroundColor: colors.surface,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          borderWidth: 1,
          borderColor: colors.border,
        }}
        handleIndicatorStyle={{ backgroundColor: colors.textMuted, width: 36, height: 4, borderRadius: 2 }}
      >
        <BottomSheetScrollView
          contentContainerStyle={{ padding: 20 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Passenger Info */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Avatar name={activeTrip.passenger_name} size={44} />
              <View style={{ marginLeft: 12 }}>
                <Text style={{ color: colors.text, fontSize: 16, fontFamily: 'Inter_600SemiBold' }}>
                  {activeTrip.passenger_name}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                  {activeTrip.passenger_phone}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button
                title="📞"
                variant="outline"
                size="sm"
                fullWidth={false}
                onPress={callPassenger}
              />
            </View>
          </View>

          {/* Price */}
          <View
            style={{
              alignItems: 'center',
              marginBottom: 16,
              paddingVertical: 12,
              backgroundColor: `${colors.secondary}08`,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: `${colors.secondary}20`,
            }}
          >
            <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_500Medium' }}>Precio del viaje</Text>
            <Text style={{ color: colors.secondary, fontSize: 28, fontFamily: 'Inter_700Bold', marginTop: 2 }}>
              {formatPrice(activeTrip.price)}
            </Text>
          </View>

          {/* Stepper */}
          <TripStepper currentStatus={activeTrip.status} />

          {/* Action Button */}
          {actionButton && (
            <View style={{ marginTop: 16 }}>
              <Button
                title={actionButton.title}
                variant={actionButton.variant}
                size="xl"
                onPress={handleStatusAction}
              />
            </View>
          )}

          {/* Emergency Actions */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginTop: 16,
              gap: 10,
            }}
          >
            <Button
              title="🆘 SOS"
              variant="outlineDanger"
              size="sm"
              fullWidth={false}
              onPress={callEmergency}
              style={{ flex: 1 }}
            />
            <Button
              title="📞 Despachador"
              variant="outline"
              size="sm"
              fullWidth={false}
              onPress={callDispatcher}
              style={{ flex: 1 }}
            />
          </View>
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
};

export default ActiveTripScreen;
