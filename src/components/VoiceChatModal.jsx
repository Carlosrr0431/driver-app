import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Modal,
  Animated as RNAnimated,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { useVoiceChat } from '../../hooks/useVoiceChat';

export function VoiceChatModal({ visible, onClose }) {
  const {
    messages,
    recording,
    recordingTime,
    sending,
    loading,
    startRecording,
    cancelRecording,
    sendRecording,
    playAudio,
  } = useVoiceChat();

  const listRef = useRef(null);

  useEffect(() => {
    if (messages.length > 0 && listRef.current) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 200);
    }
  }, [messages.length]);

  const formatSecs = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const renderMessage = ({ item }) => {
    const isBase = item.sender_type === 'base';
    const time = new Date(item.created_at).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <View style={{
        alignSelf: isBase ? 'flex-start' : 'flex-end',
        marginBottom: 8,
        maxWidth: '80%',
      }}>
        <VoiceMessageBubble
          isBase={isBase}
          time={time}
          duration={item.duration_seconds}
          onPlay={() => playAudio(item.audio_url)}
        />
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={{
        flex: 1,
        backgroundColor: colors.background,
      }}>
        {/* Header */}
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 50,
          paddingBottom: 12,
          paddingHorizontal: 16,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              backgroundColor: `${colors.primary}15`,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <MaterialCommunityIcons name="radio-tower" size={20} color={colors.primary} />
            </View>
            <View style={{ marginLeft: 10 }}>
              <Text style={{
                fontSize: 16,
                fontFamily: 'Inter_700Bold',
                color: colors.text,
              }}>
                Radio Base
              </Text>
              <Text style={{
                fontSize: 11,
                fontFamily: 'Inter_400Regular',
                color: colors.textMuted,
              }}>
                Mensajes de voz con la base
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: colors.surfaceLight,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <MaterialCommunityIcons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Messages */}
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : messages.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
            <MaterialCommunityIcons name="microphone-off" size={48} color={colors.textMuted} />
            <Text style={{
              color: colors.textMuted,
              fontSize: 14,
              fontFamily: 'Inter_500Medium',
              marginTop: 12,
              textAlign: 'center',
            }}>
              Sin mensajes de voz
            </Text>
            <Text style={{
              color: colors.textDark,
              fontSize: 12,
              fontFamily: 'Inter_400Regular',
              marginTop: 4,
              textAlign: 'center',
            }}>
              Presioná el micrófono para enviar un mensaje a la base
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Record controls */}
        <View style={{
          padding: 16,
          paddingBottom: 30,
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}>
          {recording ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: `${colors.primary}08`,
                borderRadius: 16,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderWidth: 1,
                borderColor: `${colors.primary}25`,
                gap: 10,
              }}>
                <PulsingDot />
                <Text style={{
                  fontSize: 16,
                  fontFamily: 'Inter_700Bold',
                  color: colors.primary,
                  fontVariant: ['tabular-nums'],
                }}>
                  {formatSecs(recordingTime)}
                </Text>
                <Text style={{
                  fontSize: 12,
                  fontFamily: 'Inter_400Regular',
                  color: colors.textMuted,
                }}>
                  Grabando...
                </Text>
              </View>
              <TouchableOpacity
                onPress={cancelRecording}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: colors.surfaceLight,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <MaterialCommunityIcons name="close" size={20} color={colors.danger} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={sendRecording}
                disabled={sending}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  elevation: 4,
                  shadowColor: colors.primary,
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.3,
                  shadowRadius: 4,
                  opacity: sending ? 0.6 : 1,
                }}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <MaterialCommunityIcons name="send" size={20} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={startRecording}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.primary,
                borderRadius: 16,
                paddingVertical: 14,
                gap: 8,
                elevation: 4,
                shadowColor: colors.primary,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.3,
                shadowRadius: 6,
              }}
            >
              <MaterialCommunityIcons name="microphone" size={22} color="#fff" />
              <Text style={{
                color: '#fff',
                fontSize: 14,
                fontFamily: 'Inter_600SemiBold',
              }}>
                Presioná para grabar mensaje
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

function VoiceMessageBubble({ isBase, time, duration, onPlay }) {
  const [playing, setPlaying] = useState(false);

  const handlePress = () => {
    setPlaying(!playing);
    onPlay();
    // Reset after estimated duration
    if (!playing && duration > 0) {
      setTimeout(() => setPlaying(false), duration * 1000 + 500);
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: isBase ? `${colors.secondary}10` : `${colors.primary}10`,
        borderRadius: 16,
        borderBottomLeftRadius: isBase ? 4 : 16,
        borderBottomRightRadius: isBase ? 16 : 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 10,
        borderWidth: 1,
        borderColor: isBase ? `${colors.secondary}20` : `${colors.primary}20`,
        minWidth: 160,
      }}
    >
      <View style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: playing
          ? colors.primary
          : isBase ? `${colors.secondary}20` : `${colors.primary}20`,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <MaterialCommunityIcons
          name={playing ? 'pause' : 'play'}
          size={18}
          color={playing ? '#fff' : isBase ? colors.secondary : colors.primary}
        />
      </View>
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{
            fontSize: 11,
            fontFamily: 'Inter_700Bold',
            color: isBase ? colors.secondary : colors.primary,
          }}>
            {isBase ? 'Base' : 'Yo'}
          </Text>
          {duration > 0 && (
            <Text style={{
              fontSize: 10,
              fontFamily: 'Inter_400Regular',
              color: colors.textMuted,
            }}>
              {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, '0')}
            </Text>
          )}
        </View>
        <Text style={{
          fontSize: 9,
          fontFamily: 'Inter_400Regular',
          color: colors.textMuted,
          marginTop: 1,
        }}>
          {time}
        </Text>
      </View>
      {/* Waveform decoration */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1.5, marginLeft: 4 }}>
        {[3, 5, 8, 5, 7, 4, 6, 8, 5, 3].map((h, i) => (
          <View
            key={i}
            style={{
              width: 2,
              height: h,
              borderRadius: 1,
              backgroundColor: playing
                ? colors.primary
                : isBase ? `${colors.secondary}40` : `${colors.primary}40`,
            }}
          />
        ))}
      </View>
    </TouchableOpacity>
  );
}

function PulsingDot() {
  const anim = useRef(new RNAnimated.Value(0.3)).current;

  useEffect(() => {
    const pulse = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 600, useNativeDriver: true }),
        RNAnimated.timing(anim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  return (
    <RNAnimated.View style={{
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.primary,
      opacity: anim,
    }} />
  );
}
