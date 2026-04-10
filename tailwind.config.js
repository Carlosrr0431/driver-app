/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './App.{js,jsx}',
    './src/**/*.{js,jsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#6C63FF',
        secondary: '#00D4AA',
        background: '#0F0F1A',
        surface: '#1A1A2E',
        surfaceLight: '#252540',
        border: '#2D2D50',
        textPrimary: '#FFFFFF',
        textMuted: '#A0AEC0',
        success: '#2ECC71',
        danger: '#FF4757',
        warning: '#FFA502',
        info: '#1E90FF',
        online: '#2ECC71',
        offline: '#636E72',
      },
      fontFamily: {
        inter: ['Inter_400Regular'],
        'inter-medium': ['Inter_500Medium'],
        'inter-semibold': ['Inter_600SemiBold'],
        'inter-bold': ['Inter_700Bold'],
      },
    },
  },
  plugins: [],
};
