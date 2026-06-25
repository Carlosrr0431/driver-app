import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';
import AssignedDriverLoginScreen from '../screens/AssignedDriverLoginScreen';

const Stack = createNativeStackNavigator();

const AuthNavigator = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'fade',
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="AssignedDriverLogin" component={AssignedDriverLoginScreen} />
    </Stack.Navigator>
  );
};

export default AuthNavigator;
