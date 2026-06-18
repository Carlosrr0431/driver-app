# Arranque de Expo para PowerShell (sin warnings de NO_COLOR / FORCE_COLOR)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
Remove-Item Env:CI -ErrorAction SilentlyContinue

Write-Host 'Iniciando Expo chofer (dev client). Si ves MLRNCameraModule, reinstalá el APK nuevo: npm run android:rebuild o eas build --profile development' -ForegroundColor Cyan
node .\scripts\start-expo.js @args
