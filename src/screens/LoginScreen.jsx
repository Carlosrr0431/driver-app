import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Dimensions,
  StatusBar,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, SlideInUp, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme/colors';
import { useAuth } from '../hooks/useAuth';
import { DEV_DRIVER_EMAIL, DEV_DRIVER_PASSWORD } from '../config/devDefaults';

const { width } = Dimensions.get('window');
const BRAND_BLUE = '#282e69';
const BRAND_BLUE_LIGHT = '#245f8d';

const LoginScreen = () => {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState(__DEV__ ? DEV_DRIVER_EMAIL : '');
  const [password, setPassword] = useState(__DEV__ ? DEV_DRIVER_PASSWORD : '');
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);
  const { login, isLoading } = useAuth();

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await login(email, password);
  };

  const togglePassword = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowPassword(!showPassword);
  };

  const canLogin = email.trim() && password.trim() && !isLoading;

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* Background decoration */}
      <LinearGradient
        colors={[`${BRAND_BLUE}18`, `${BRAND_BLUE_LIGHT}0C`, 'transparent']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 400 }}
      />
      <View style={{
        position: 'absolute', top: -120, right: -80,
        width: 260, height: 260, borderRadius: 130,
        backgroundColor: `${BRAND_BLUE_LIGHT}14`,
      }} />
      <View style={{
        position: 'absolute', bottom: -60, left: -40,
        width: 180, height: 180, borderRadius: 90,
        backgroundColor: `${BRAND_BLUE}12`,
      }} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: 24,
            paddingTop: insets.top + 20,
            paddingBottom: insets.bottom + 20,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Branding */}
          <Animated.View entering={FadeIn.delay(200).duration(800)} style={{ alignItems: 'center', marginBottom: 40 }}>
            <Animated.View entering={SlideInUp.delay(300).springify()}>
              <Image
                source={require('../../assets/logo.png')}
                style={{ width: width * 0.52, height: undefined, aspectRatio: 550 / 295 }}
                resizeMode="contain"
              />
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(600).springify()} style={{ alignItems: 'center', marginTop: 20 }}>
              <Text style={{
                color: BRAND_BLUE, fontSize: 18, fontFamily: 'Inter_600SemiBold',
              }}>
                Bienvenido, conductor
              </Text>
              <Text style={{
                color: colors.textMuted, fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 6,
              }}>
                Iniciá sesión para empezar a trabajar
              </Text>
            </Animated.View>
          </Animated.View>

          {/* Form Card */}
          <Animated.View entering={FadeInDown.delay(700).springify()} style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 20, padding: 22,
            shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.06, shadowRadius: 16, elevation: 4,
            borderWidth: 1, borderColor: '#F0F2F8',
          }}>
            {/* Email */}
            <Text style={{
              color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium',
              marginBottom: 8, marginLeft: 2, letterSpacing: 0.3,
            }}>
              EMAIL
            </Text>
            <View style={{
              backgroundColor: emailFocused ? '#FAFBFF' : '#F8F9FC',
              borderRadius: 12, borderWidth: 1.5,
              borderColor: emailFocused ? BRAND_BLUE_LIGHT : '#E8ECF4',
              flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 14, marginBottom: 18,
            }}>
              <View style={{
                width: 34, height: 34, borderRadius: 9,
                backgroundColor: emailFocused ? `${BRAND_BLUE_LIGHT}15` : '#EEF0F6',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name="mail-outline" size={17} color={emailFocused ? BRAND_BLUE_LIGHT : colors.textMuted} />
              </View>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="tu@email.com"
                placeholderTextColor="#A0A8BE"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                style={{
                  flex: 1, color: colors.text, fontSize: 15,
                  fontFamily: 'Inter_400Regular', paddingVertical: 15, marginLeft: 12,
                }}
              />
            </View>

            {/* Password */}
            <Text style={{
              color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium',
              marginBottom: 8, marginLeft: 2, letterSpacing: 0.3,
            }}>
              CONTRASEÑA
            </Text>
            <View style={{
              backgroundColor: passFocused ? '#FAFBFF' : '#F8F9FC',
              borderRadius: 12, borderWidth: 1.5,
              borderColor: passFocused ? BRAND_BLUE_LIGHT : '#E8ECF4',
              flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 14, marginBottom: 24,
            }}>
              <View style={{
                width: 34, height: 34, borderRadius: 9,
                backgroundColor: passFocused ? `${BRAND_BLUE_LIGHT}15` : '#EEF0F6',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name="lock-closed-outline" size={17} color={passFocused ? BRAND_BLUE_LIGHT : colors.textMuted} />
              </View>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Tu contraseña"
                placeholderTextColor="#A0A8BE"
                secureTextEntry={!showPassword}
                onFocus={() => setPassFocused(true)}
                onBlur={() => setPassFocused(false)}
                style={{
                  flex: 1, color: colors.text, fontSize: 15,
                  fontFamily: 'Inter_400Regular', paddingVertical: 15, marginLeft: 12,
                }}
              />
              <Pressable onPress={togglePassword} style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}>
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={19} color={colors.textMuted}
                />
              </Pressable>
            </View>

            {/* Login Button */}
            <Pressable
              onPress={handleLogin}
              disabled={!canLogin}
              style={({ pressed }) => ({
                borderRadius: 14, overflow: 'hidden',
                opacity: !canLogin ? 0.45 : pressed ? 0.88 : 1,
                boxShadow: canLogin ? '0 6px 20px rgba(40,46,105,0.32)' : 'none',
              })}
            >
              <LinearGradient
                colors={canLogin ? ['#3d4494', BRAND_BLUE] : ['#D0D5E0', '#C8CCD8']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{
                  height: 54, borderRadius: 14,
                  alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'row', gap: 10,
                }}
              >
                {isLoading ? (
                  <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' }}>
                    Ingresando...
                  </Text>
                ) : (
                  <>
                    <Ionicons name="log-in-outline" size={22} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 }}>
                      Iniciar Sesión
                    </Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>
          </Animated.View>

          {/* Footer */}
          <Animated.View entering={FadeIn.delay(1000)} style={{ alignItems: 'center', marginTop: 32 }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: '#F0F4F8', borderRadius: 20,
              paddingHorizontal: 14, paddingVertical: 7,
            }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.success, marginRight: 6 }} />
              <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular' }}>
                Conexión segura
              </Text>
            </View>
            <Text style={{ color: '#A0A8BE', fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 12 }}>
              © 2026 Profesional
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default LoginScreen;
