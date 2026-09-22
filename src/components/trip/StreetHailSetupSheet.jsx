import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import {
  autocompleteAddressSalta,
  resolvePlaceFromSuggestion,
} from '../../services/nominatim';
import Toast from 'react-native-toast-message';
import { ChooseDestinationMode } from './ChooseDestinationMode';
import { StreetHailCancelButton } from './StreetHailCancelButton';
import { useResponsive } from '../../hooks/useResponsive';
import {
  SHEET_PAN_ACTIVE_OFFSET_Y,
  SHEET_PAN_FAIL_OFFSET_X,
} from '../../utils/activeTripNavigation';
import {
  resolveStreetHailSearchTopInset,
  resolveStreetHailSetupBottomInset,
  resolveStreetHailSetupKeyboardBehavior,
  resolveStreetHailSetupMaxContentSize,
  resolveStreetHailSetupSheetIndex,
  resolveStreetHailSetupSnaps,
  resolveStreetHailSetupUsesDynamicSizing,
  STREET_HAIL_SETUP_STEP as STEP,
} from '../../utils/activeTripNavigation';

/**
 * Setup local de viaje en calle: el mapa del Home queda visible
 * y el viaje en BD se crea recién al confirmar.
 */
export function StreetHailSetupSheet({
  confirming = false,
  onCancel,
  onChooseFreeRide,
  onConfirmDestination,
}) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { height: viewportHeight } = useWindowDimensions();
  const { isLandscape, isCompactHeight } = useResponsive();
  const sheetRef = useRef(null);
  const [step, setStep] = useState(STEP.CHOOSE);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [inputReady, setInputReady] = useState(false);
  const timerRef = useRef(null);
  const isSearchStep = step === STEP.SEARCH;

  const snapPoints = useMemo(
    () => resolveStreetHailSetupSnaps({
      searching: isSearchStep,
      compact: isLandscape || isCompactHeight,
    }),
    [isSearchStep, isLandscape, isCompactHeight],
  );
  const useDynamicSizing = resolveStreetHailSetupUsesDynamicSizing(isSearchStep);
  const bottomInset = resolveStreetHailSetupBottomInset(tabBarHeight, insets.bottom, {
    searching: isSearchStep,
  });
  const topInset = isSearchStep
    ? resolveStreetHailSearchTopInset({
      safeTop: insets.top,
      viewportHeight,
    })
    : insets.top;
  const maxDynamicContentSize = resolveStreetHailSetupMaxContentSize({
    viewportHeight,
    bottomInset,
    compact: isLandscape || isCompactHeight,
  });
  const keyboardBehavior = resolveStreetHailSetupKeyboardBehavior(isSearchStep);
  const busy = Boolean(confirming || resolving);

  useEffect(() => {
    if (step !== STEP.SEARCH) return undefined;
    const text = query.trim();
    if (timerRef.current) clearTimeout(timerRef.current);
    if (text.length < 2) {
      setOptions([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      try {
        const results = await autocompleteAddressSalta(text, 8);
        setOptions(Array.isArray(results) ? results : []);
      } catch {
        setOptions([]);
      } finally {
        setSearching(false);
      }
    }, 500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, step]);

  useEffect(() => {
    const nextIndex = resolveStreetHailSetupSheetIndex(step);
    const id = requestAnimationFrame(() => {
      sheetRef.current?.snapToIndex?.(nextIndex);
    });
    return () => cancelAnimationFrame(id);
  }, [step]);

  useEffect(() => {
    if (step !== STEP.SEARCH) {
      setInputReady(false);
      return undefined;
    }
    const timer = setTimeout(() => setInputReady(true), 220);
    return () => clearTimeout(timer);
  }, [step]);

  const handleSelectOption = async (option) => {
    if (resolving || confirming) return;
    setResolving(true);
    try {
      const resolved = await resolvePlaceFromSuggestion(option);
      const lat = Number(resolved?.lat);
      const lng = Number(resolved?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('No se pudo obtener la ubicación');
      }
      setSelected({
        address: resolved.address || option.address || option.title,
        lat,
        lng,
      });
      setStep(STEP.CONFIRM);
    } catch {
      setSelected(null);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'No se pudo ubicar esa dirección.',
      });
    } finally {
      setResolving(false);
    }
  };

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={snapPoints}
      topInset={topInset}
      bottomInset={bottomInset}
      enableDynamicSizing={useDynamicSizing}
      maxDynamicContentSize={maxDynamicContentSize}
      enablePanDownToClose={false}
      enableOverDrag
      enableContentPanningGesture
      enableHandlePanningGesture
      activeOffsetY={SHEET_PAN_ACTIVE_OFFSET_Y}
      failOffsetX={SHEET_PAN_FAIL_OFFSET_X}
      handleStyle={{ paddingVertical: 14 }}
      keyboardBehavior={keyboardBehavior}
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      enableBlurKeyboardOnGesture={isSearchStep}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
    >
      <BottomSheetScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={isSearchStep ? 'none' : 'on-drag'}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={isSearchStep ? styles.scrollSearching : styles.scroll}
      >
        {step === STEP.CHOOSE ? (
          <ChooseDestinationMode
            isStreetHail
            cancelling={confirming}
            onChooseText={() => setStep(STEP.SEARCH)}
            onChooseFreeRide={onChooseFreeRide}
            onCancel={onCancel}
          />
        ) : null}

        {step === STEP.SEARCH ? (
          <View>
            {/* Acciones arriba del input — siempre visibles aunque aparezca el teclado */}
            <View style={styles.searchActions}>
              <Pressable
                onPress={() => {
                  setQuery('');
                  setOptions([]);
                  setStep(STEP.CHOOSE);
                }}
                disabled={busy}
                style={({ pressed }) => [styles.backBtn, styles.searchActionBtn, pressed ? { opacity: 0.75 } : null]}
              >
                <MaterialCommunityIcons name="arrow-left" size={16} color={colors.textMuted} />
                <Text style={styles.backText}>Volver</Text>
              </Pressable>
              <Pressable
                onPress={onCancel}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Cancelar viaje en calle"
                style={({ pressed }) => [styles.backBtn, styles.searchActionBtn, pressed ? { opacity: 0.75 } : null]}
              >
                <MaterialCommunityIcons name="close" size={16} color={colors.textMuted} />
                <Text style={styles.backText}>Cancelar viaje</Text>
              </Pressable>
            </View>
            <View style={styles.inputRow}>
              <MaterialCommunityIcons
                name={searching ? 'loading' : 'magnify'}
                size={20}
                color={colors.textMuted}
              />
              <BottomSheetTextInput
                style={styles.input}
                value={query}
                onChangeText={setQuery}
                placeholder="Buscar dirección..."
                placeholderTextColor={colors.textMuted}
                autoFocus={inputReady}
                autoCorrect={false}
                autoCapitalize="words"
                returnKeyType="search"
                editable={!busy}
              />
              {searching ? <ActivityIndicator size="small" color={colors.primary} /> : null}
            </View>

            {options.length > 0 ? (
              <View style={styles.list}>
                {options.map((opt, idx) => (
                  <Pressable
                    key={opt.placeId || `opt-${idx}`}
                    onPress={() => handleSelectOption(opt)}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.option,
                      idx < options.length - 1 ? styles.optionBorder : null,
                      pressed ? { opacity: 0.75 } : null,
                    ]}
                  >
                    <View style={styles.optionIcon}>
                      <MaterialCommunityIcons name="map-marker-outline" size={18} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionTitle} numberOfLines={2}>
                        {opt.title || opt.address}
                      </Text>
                      {opt.subtitle ? (
                        <Text style={styles.optionSub} numberOfLines={1}>{opt.subtitle}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {query.trim().length >= 2 && !searching && options.length === 0 ? (
              <Text style={styles.empty}>Sin resultados para “{query.trim()}”</Text>
            ) : null}

          </View>
        ) : null}

        {step === STEP.CONFIRM && selected ? (
          <View>
            <Text style={styles.title}>Destino listo</Text>
            <Text style={styles.lead}>Confirmá para crear el viaje y empezar a circular.</Text>
            <View style={styles.destCard}>
              <View style={styles.destDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.destLabel}>Destino</Text>
                <Text style={styles.destAddress} numberOfLines={3}>{selected.address}</Text>
              </View>
            </View>
            <Pressable
              onPress={() => onConfirmDestination(selected)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Empezar viaje"
              style={({ pressed }) => [
                styles.startBtn,
                pressed && !busy ? { opacity: 0.92 } : null,
                busy ? { opacity: 0.7 } : null,
              ]}
            >
              {confirming ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialCommunityIcons name="car" size={22} color="#fff" />
              )}
              <Text style={styles.startText}>{confirming ? 'Creando viaje…' : 'Empezar viaje'}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setSelected(null);
                setStep(STEP.SEARCH);
              }}
              disabled={busy}
              style={({ pressed }) => [styles.backBtn, pressed ? { opacity: 0.75 } : null]}
            >
              <MaterialCommunityIcons name="pencil" size={16} color={colors.textMuted} />
              <Text style={styles.backText}>Cambiar destino</Text>
            </Pressable>
            <StreetHailCancelButton
              cancelling={confirming}
              disabled={resolving}
              onPress={onCancel}
            />
          </View>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBg: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    boxShadow: '0 -6px 16px rgba(0,0,0,0.08)',
  },
  handle: {
    backgroundColor: '#D1D5DB',
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  scrollSearching: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  searchActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  searchActionBtn: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  lead: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
    paddingHorizontal: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceLight,
    borderRadius: 16,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    paddingVertical: 12,
  },
  list: {
    marginTop: 10,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  optionBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  optionIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: `${colors.primary}12`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitle: {
    color: colors.text,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  optionSub: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: 12,
  },
  destCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.successBg,
    borderRadius: 16,
    borderCurve: 'continuous',
    padding: 14,
    marginBottom: 12,
  },
  destDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
    marginTop: 5,
  },
  destLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  destAddress: {
    color: colors.text,
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 2,
  },
  startBtn: {
    minHeight: 54,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: colors.success,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    boxShadow: '0 8px 18px rgba(22,199,132,0.28)',
  },
  startText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  backBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  backText: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
});
