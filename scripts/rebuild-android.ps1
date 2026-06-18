# Compila e instala el APK de desarrollo con módulos nativos (MapLibre, etc.)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"

if (-not (Test-Path $env:JAVA_HOME)) {
  Write-Host 'No se encontró Java de Android Studio. Instalá Android Studio o definí JAVA_HOME.' -ForegroundColor Red
  exit 1
}

Write-Host 'Regenerando proyecto Android...' -ForegroundColor Cyan
npx expo prebuild --platform android --clean

Write-Host 'Compilando e instalando en dispositivo/emulador conectado...' -ForegroundColor Cyan
npx expo run:android

Write-Host 'Listo. Ahora ejecutá .\scripts\start.ps1 y abrí la app recién instalada.' -ForegroundColor Green
