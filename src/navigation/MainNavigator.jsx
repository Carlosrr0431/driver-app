import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import HomeScreen from '../screens/HomeScreen';
import HistoryScreen from '../screens/HistoryScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ActiveTripScreen from '../screens/ActiveTripScreen';
import TripDetailScreen from '../screens/TripDetailScreen';
import OwnerDashboardScreen from '../screens/OwnerDashboardScreen';
import OwnerDriverDetailScreen from '../screens/OwnerDriverDetailScreen';
import CreateLinkedDriverScreen from '../screens/CreateLinkedDriverScreen';
import CommissionPaymentScreen from '../screens/CommissionPaymentScreen';
import { useVoiceAutoPlay } from '../hooks/useVoiceAutoPlay';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const HomeStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="HomeMain" component={HomeScreen} />
    <Stack.Screen
      name="ActiveTrip"
      component={ActiveTripScreen}
      options={{ gestureEnabled: false }}
    />
    <Stack.Screen name="TripDetail" component={TripDetailScreen} />
    <Stack.Screen name="CommissionPayment" component={CommissionPaymentScreen} />
  </Stack.Navigator>
);

const HistoryStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="HistoryMain" component={HistoryScreen} />
    <Stack.Screen name="TripDetail" component={TripDetailScreen} />
  </Stack.Navigator>
);

const ProfileStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="ProfileMain" component={ProfileScreen} />
    <Stack.Screen name="OwnerDashboard" component={OwnerDashboardScreen} />
    <Stack.Screen name="OwnerDriverDetail" component={OwnerDriverDetailScreen} />
    <Stack.Screen name="CreateLinkedDriver" component={CreateLinkedDriverScreen} />
  </Stack.Navigator>
);

const MainNavigator = () => {
  useVoiceAutoPlay();
  const insets = useSafeAreaInsets();
  const paddingBottom = Platform.OS === 'ios' ? Math.max(insets.bottom, 12) : 20;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 64 + paddingBottom,
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: '#F3F4F6',
          elevation: 0,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.04,
          shadowRadius: 8,
          paddingBottom,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: '#9CA3AF',
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStack}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabItem icon="home" label="Inicio" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="History"
        component={HistoryStack}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabItem icon="time" label="Historial" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{
          tabBarIcon: ({ focused }) => (
            <TabItem icon="person" label="Perfil" focused={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

const TabItem = ({ icon, label, focused }) => (
  <View style={styles.tabItem}>
    <Ionicons
      name={focused ? icon : `${icon}-outline`}
      size={24}
      color={focused ? colors.primary : '#9CA3AF'}
    />
    <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    color: '#9CA3AF',
    marginTop: 4,
    letterSpacing: 0.1,
  },
  labelActive: {
    color: colors.primary,
    fontWeight: '700',
  },
});

export default MainNavigator;
