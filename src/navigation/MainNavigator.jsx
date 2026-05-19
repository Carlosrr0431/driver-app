import React from 'react';
import { View, Text, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
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

const TAB_ICON_SIZE = 22;

/**
 * Ícono de tab con indicador activo tipo pill (pastilla redondeada).
 * Cuando está activo: fondo azul con el ícono blanco.
 * Cuando está inactivo: ícono muted sin fondo.
 */
const TabIcon = ({ name, label, color, focused, type = 'material' }) => {
  const Icon = type === 'ion' ? Ionicons : MaterialCommunityIcons;
  return (
    <View style={{ alignItems: 'center', paddingTop: 2 }}>
      <View style={{
        paddingHorizontal: focused ? 16 : 0,
        paddingVertical: 7,
        borderRadius: 20,
        backgroundColor: focused ? colors.primary : 'transparent',
        minWidth: focused ? 54 : 0,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Icon
          name={focused ? name : `${name}-outline`.replace('-outline-outline', '-outline')}
          size={TAB_ICON_SIZE}
          color={focused ? '#FFFFFF' : color}
        />
      </View>
      {!focused && (
        <Text style={{
          color,
          fontSize: 10,
          fontFamily: 'Inter_600SemiBold',
          marginTop: 2,
        }}>
          {label}
        </Text>
      )}
    </View>
  );
};

const MainNavigator = () => {
  useVoiceAutoPlay();
  const insets = useSafeAreaInsets();
  const floatingBottom = Math.max(insets.bottom + 6, 14);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: floatingBottom,
          left: 20,
          right: 20,
          height: 64,
          borderRadius: 32,
          backgroundColor: '#FFFFFF',
          borderTopWidth: 0,
          elevation: 0,
          boxShadow: '0 8px 32px rgba(15,23,42,0.18)',
          paddingHorizontal: 10,
          paddingTop: 0,
          paddingBottom: 0,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStack}
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name="home"
              label="Inicio"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tab.Screen
        name="History"
        component={HistoryStack}
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name="clock"
              label="Historial"
              color={color}
              focused={focused}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              name="person-circle"
              label="Perfil"
              color={color}
              focused={focused}
              type="ion"
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

export default MainNavigator;
