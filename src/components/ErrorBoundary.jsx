import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: '#0F0F1A',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }}
        >
          <Text style={{ color: '#FF4757', fontSize: 24, fontWeight: 'bold', marginBottom: 16 }}>
            Error en la app
          </Text>
          <ScrollView style={{ maxHeight: 200, marginBottom: 24 }}>
            <Text style={{ color: '#A0AEC0', fontSize: 13, textAlign: 'center' }}>
              {this.state.error?.message || 'Error desconocido'}
            </Text>
          </ScrollView>
          <TouchableOpacity
            onPress={() => this.setState({ hasError: false, error: null })}
            style={{
              backgroundColor: '#282e69',
              paddingHorizontal: 32,
              paddingVertical: 14,
              borderRadius: 12,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
              Reintentar
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}
