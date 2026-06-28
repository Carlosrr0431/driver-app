# Compila e instala el APK de desarrollo (MapLibre + OSRM + Nominatim).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"

if (-not (Test-Path $env:JAVA_HOME)) {
  Write-Host 'No se encontró Java de Android Studio. Instalá Android Studio o definí JAVA_HOME.' -ForegroundColor Red
  exit 1
}

Write-Host 'Regenerando proyecto Android (Google Maps + expo-dev-client)...' -ForegroundColor Cyan
npx expo prebuild --clean --platform android

Write-Host 'Compilando e instalando en dispositivo/emulador...' -ForegroundColor Cyan
npx expo run:android

Write-Host 'Listo. Abrí "Profesional Conductor" (no Expo Go) y ejecutá .\scripts\start.ps1' -ForegroundColor Green
