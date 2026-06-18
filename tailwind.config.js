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
        primary: '#DC2626',
        secondary: '#F87171',
        background: '#0B1120',
        surface: '#111B2E',
        surfaceLight: '#1A2540',
        border: '#253352',
        textPrimary: '#FFFFFF',
        textMuted: '#94A3B8',
        success: '#2ECC71',
        danger: '#FF4757',
        warning: '#FFA502',
        info: '#1E90FF',
        online: '#2ECC71',
        offline: '#64748B',
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
