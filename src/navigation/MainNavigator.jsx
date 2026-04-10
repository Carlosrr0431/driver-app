import React from 'react';
import { View, Platform } from 'react-native';
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
  </Stack.Navigator>
);

const HistoryStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="HistoryMain" component={HistoryScreen} />
    <Stack.Screen name="TripDetail" component={TripDetailScreen} />
  </Stack.Navigator>
);

const TAB_ICON_SIZE = 24;

const TabIcon = ({ name, color, focused, type = 'material' }) => {
  const Icon = type === 'ion' ? Ionicons : MaterialCommunityIcons;
  return (
    <View style={{ alignItems: 'center', paddingTop: 2 }}>
      {focused && (
        <View
          style={{
            position: 'absolute',
            top: -4,
            width: 24,
            height: 3,
            borderRadius: 2,
            backgroundColor: colors.primary,
          }}
        />
      )}
      <Icon name={name} size={TAB_ICON_SIZE} color={color} />
    </View>
  );
};

const MainNavigator = () => {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, Platform.OS === 'android' ? 8 : 0);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
          height: 56 + bottomPadding,
          paddingBottom: bottomPadding,
          paddingTop: 6,
          elevation: 20,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: {
          fontFamily: 'Inter_600SemiBold',
          fontSize: 10,
          marginTop: 2,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStack}
        options={{
          tabBarLabel: 'Inicio',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="home" color={color} focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="History"
        component={HistoryStack}
        options={{
          tabBarLabel: 'Historial',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="clock-outline" color={color} focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'Perfil',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="person-outline" color={color} focused={focused} type="ion" />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

export default MainNavigator;
