import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useResponsive } from '../hooks/useResponsive';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TAB_ACTIVE_COLOR = '#161616';
const TAB_INACTIVE_COLOR = '#767676';
const TAB_BAR_BORDER = '#EBEBEB';

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
  const { s, fs, isLandscape } = useResponsive();
  const extraBottomInset = Platform.OS === 'android' ? 7 : 1;
  const paddingBottom = insets.bottom + extraBottomInset;
  const baseTab = isLandscape ? 40 : 46;
  const tabBarHeight = s(baseTab) + paddingBottom;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: TAB_ACTIVE_COLOR,
        tabBarInactiveTintColor: TAB_INACTIVE_COLOR,
        tabBarIconStyle: {
          marginBottom: 2,
        },
        tabBarLabel: ({ focused, color, children }) => (
          <Text
            style={[
              { fontSize: fs(10), fontWeight: '400', marginTop: 0, letterSpacing: 0 },
              focused && { fontWeight: '700' },
              { color },
            ]}
            numberOfLines={1}
          >
            {children}
          </Text>
        ),
        tabBarItemStyle: {
          paddingTop: 2,
          paddingBottom: 0,
        },
        tabBarStyle: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: tabBarHeight,
          backgroundColor: '#FFFFFF',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: TAB_BAR_BORDER,
          elevation: 0,
          shadowOpacity: 0,
          paddingBottom,
          paddingTop: 4,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStack}
        options={{
          title: 'Inicio',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon icon="home" focused={focused} color={color} size={s(22)} />
          ),
        }}
      />
      <Tab.Screen
        name="History"
        component={HistoryStack}
        options={{
          title: 'Historial',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon icon="time" focused={focused} color={color} size={s(22)} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{
          title: 'Mi perfil',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon icon="person" focused={focused} color={color} size={s(22)} />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

const TabIcon = ({ icon, focused, color, size = 22 }) => (
  <View style={{ width: size + 6, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <Ionicons
      name={focused ? icon : `${icon}-outline`}
      size={size}
      color={color}
    />
  </View>
);

export default MainNavigator;
