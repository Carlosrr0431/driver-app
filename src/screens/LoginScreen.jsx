import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Dimensions,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, SlideInUp, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme/colors';
import { useAuth } from '../hooks/useAuth';

const { width } = Dimensions.get('window');

const LoginScreen = () => {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Background gradient decoration */}
      <LinearGradient
        colors={[`${colors.primary}15`, 'transparent']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 300 }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: 28,
            paddingTop: insets.top + 20,
            paddingBottom: insets.bottom + 20,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Branding */}
          <Animated.View entering={FadeIn.delay(200).duration(800)} style={{ alignItems: 'center', marginBottom: 48 }}>
            <Animated.View entering={SlideInUp.delay(300).springify()}>
              <View style={{
                width: 88, height: 88, borderRadius: 28,
                backgroundColor: `${colors.primary}12`,
                borderWidth: 1, borderColor: `${colors.primary}25`,
                alignItems: 'center', justifyContent: 'center', marginBottom: 20,
              }}>
                <LinearGradient
                  colors={colors.gradient.primary}
                  style={{
                    width: 56, height: 56, borderRadius: 18,
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons name="steering" size={30} color="#fff" />
                </LinearGradient>
              </View>
            </Animated.View>

            <Animated.Text entering={FadeInDown.delay(500).springify()} style={{
              color: colors.text, fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5,
            }}>
              Driver App
            </Animated.Text>
            <Animated.Text entering={FadeInDown.delay(600).springify()} style={{
              color: colors.textMuted, fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 6,
            }}>
              Iniciá sesión para empezar a trabajar
            </Animated.Text>
          </Animated.View>

          {/* Form */}
          <Animated.View entering={FadeInDown.delay(700).springify()}>
            {/* Email */}
            <Text style={{
              color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium',
              marginBottom: 8, marginLeft: 4,
            }}>
              Email
            </Text>
            <View style={{
              backgroundColor: colors.surface,
              borderRadius: 14, borderWidth: 1.5,
              borderColor: emailFocused ? colors.primary : colors.border,
              flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 16, marginBottom: 18,
            }}>
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: emailFocused ? `${colors.primary}15` : colors.surfaceLight,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name="mail-outline" size={18} color={emailFocused ? colors.primary : colors.textMuted} />
              </View>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="tu@email.com"
                placeholderTextColor={colors.textDark}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                style={{
                  flex: 1, color: colors.text, fontSize: 15,
                  fontFamily: 'Inter_400Regular', paddingVertical: 16, marginLeft: 12,
                }}
              />
            </View>

            {/* Password */}
            <Text style={{
              color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium',
              marginBottom: 8, marginLeft: 4,
            }}>
              Contraseña
            </Text>
            <View style={{
              backgroundColor: colors.surface,
              borderRadius: 14, borderWidth: 1.5,
              borderColor: passFocused ? colors.primary : colors.border,
              flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 16, marginBottom: 28,
            }}>
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: passFocused ? `${colors.primary}15` : colors.surfaceLight,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name="lock-closed-outline" size={18} color={passFocused ? colors.primary : colors.textMuted} />
              </View>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Tu contraseña"
                placeholderTextColor={colors.textDark}
                secureTextEntry={!showPassword}
                onFocus={() => setPassFocused(true)}
                onBlur={() => setPassFocused(false)}
                style={{
                  flex: 1, color: colors.text, fontSize: 15,
                  fontFamily: 'Inter_400Regular', paddingVertical: 16, marginLeft: 12,
                }}
              />
              <TouchableOpacity onPress={togglePassword} style={{ padding: 4 }}>
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20} color={colors.textMuted}
                />
              </TouchableOpacity>
            </View>

            {/* Login Button */}
            <TouchableOpacity
              onPress={handleLogin}
              disabled={!canLogin}
              activeOpacity={0.85}
              style={{ borderRadius: 14, overflow: 'hidden', opacity: canLogin ? 1 : 0.5 }}
            >
              <LinearGradient
                colors={canLogin ? colors.gradient.primary : [colors.surfaceLight, colors.surfaceLight]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{
                  height: 54, borderRadius: 14,
                  alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'row',
                }}
              >
                {isLoading ? (
                  <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
                    Ingresando...
                  </Text>
                ) : (
                  <>
                    <Ionicons name="log-in-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
                      Iniciar Sesión
                    </Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

          {/* Footer */}
          <Animated.View entering={FadeIn.delay(1000)} style={{ alignItems: 'center', marginTop: 40 }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: `${colors.surface}80`, borderRadius: 20,
              paddingHorizontal: 14, paddingVertical: 8,
            }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success, marginRight: 6 }} />
              <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular' }}>
                Conexión segura
              </Text>
            </View>
            <Text style={{ color: colors.textDark, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 12 }}>
              © 2025 Remises App
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default LoginScreen;
