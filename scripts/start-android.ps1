<#
.SYNOPSIS
  Levanta driver-app en emulador Android o dispositivo USB.

.DESCRIPTION
  Flujo: emulador (si hace falta) → adb reverse :8081 → APK (solo si falta) → Metro → dev client.

  Uso (desde driver-app/):
    npm run start:android
    npm run start:android:install
#>
[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$SkipEmulator,
  [string]$AvdName = 'Pixel_4',
  [switch]$Clear,
  [switch]$SameWindow
)

$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$MetroPort = if ($env:RCT_METRO_PORT) { $env:RCT_METRO_PORT } else { '8081' }
$PackageName = 'com.remises.driverapp'
$DevClientUrl = "exp+driver-app://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$MetroPort"

function Write-Step([string]$Message) {
  Write-Host "[driver-app] $Message" -ForegroundColor Cyan
}

function Initialize-AndroidEnv {
  $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
  $env:ANDROID_HOME = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
  $env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:PATH"

  if (-not (Test-Path $env:JAVA_HOME)) {
    throw 'No se encontró Java de Android Studio. Instalá Android Studio o definí JAVA_HOME.'
  }
  if (-not (Test-Path $env:ANDROID_HOME)) {
    throw "No se encontró ANDROID_HOME en $($env:ANDROID_HOME)."
  }
}

function Get-Adb { Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe' }
function Get-Emulator { Join-Path $env:ANDROID_HOME 'emulator\emulator.exe' }

function Test-AndroidDevice {
  $adb = Get-Adb
  $lines = & $adb devices 2>$null | Where-Object { $_ -match '\tdevice$' }
  return @($lines).Count -gt 0
}

function Resolve-AvdName([string]$Preferred) {
  $emulator = Get-Emulator
  if (-not (Test-Path $emulator)) {
    throw 'No se encontró emulator.exe. Instalá un AVD desde Android Studio.'
  }

  $avds = @(& $emulator -list-avds 2>$null | Where-Object { $_.Trim() })
  if ($avds.Count -eq 0) {
    throw 'No hay AVDs. Creá uno en Android Studio (Device Manager).'
  }

  if ($Preferred -and ($avds -contains $Preferred)) {
    return $Preferred
  }

  if ($Preferred) {
    Write-Host "[driver-app] AVD '$Preferred' no existe. Usando '$($avds[0])'." -ForegroundColor Yellow
  }
  return $avds[0]
}

function Start-AndroidEmulator([string]$Name) {
  $emulator = Get-Emulator
  Write-Step "Arrancando emulador '$Name' (-gpu host, sin animación de boot)..."
  Start-Process -FilePath $emulator -ArgumentList @(
    '-avd', $Name,
    '-no-boot-anim',
    '-gpu', 'host',
    '-no-audio'
  ) | Out-Null
}

function Invoke-AdbWithTimeout {
  param(
    [string[]]$Arguments,
    [int]$TimeoutSec = 15
  )
  $adb = Get-Adb
  $outFile = Join-Path $env:TEMP "driver-adb-$([guid]::NewGuid().ToString('N')).txt"
  $errFile = Join-Path $env:TEMP "driver-adb-err-$([guid]::NewGuid().ToString('N')).txt"
    $proc = Start-Process -FilePath $adb -ArgumentList $Arguments -NoNewWindow -PassThru `
    -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
    $proc.Kill()
    Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
    throw "adb timeout: $($Arguments -join ' ')"
  }
  $output = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
  Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
  if (-not $output) { return '' }
  return $output.Trim()
}

function Get-AndroidSerial {
  $adb = Get-Adb
  $lines = @(& $adb devices 2>$null | Where-Object { $_ -match '^emulator-\d+\s+device$' })
  if ($lines.Count -eq 0) { return $null }
  return ($lines[0] -split '\s+', 2)[0]
}

function Wait-AndroidBoot {
  $adb = Get-Adb
  Write-Step 'Esperando dispositivo...'
  & $adb wait-for-device | Out-Null

  $deadline = (Get-Date).AddMinutes(4)
  do {
    Start-Sleep -Seconds 2
    try {
      $serial = Get-AndroidSerial
      if (-not $serial) { continue }
      $boot = Invoke-AdbWithTimeout -Arguments @('-s', $serial, 'shell', 'getprop', 'sys.boot_completed') -TimeoutSec 10
      if ($boot -eq '1') { return }
    } catch {
      # adb puede colgarse mientras el emulador arranca; reintentar
    }
  } while ((Get-Date) -lt $deadline)

  throw 'El emulador no terminó de arrancar a tiempo (sys.boot_completed != 1).'
}

function Set-AdbReverse {
  $adb = Get-Adb
  & $adb reverse "tcp:$MetroPort" "tcp:$MetroPort" | Out-Null
  Write-Step "adb reverse tcp:$MetroPort tcp:$MetroPort"
}

function Test-DriverAppInstalled {
  $adb = Get-Adb
  $packages = & $adb shell pm list packages $PackageName 2>$null
  return ($packages -match $PackageName)
}

function Install-DriverApk {
  Write-Step 'Compilando e instalando APK de desarrollo...'
  Push-Location $Root
  try {
    Remove-Item Env:RCT_METRO_PORT -ErrorAction SilentlyContinue
    Push-Location (Join-Path $Root 'android')
    try {
      & .\gradlew.bat app:installDebug -x lint -x test
      if ($LASTEXITCODE -ne 0) { throw "gradlew installDebug falló (código $LASTEXITCODE)." }
    } finally {
      Pop-Location
    }
  } finally {
    Pop-Location
  }
}

function Wait-MetroReady {
  $deadline = (Get-Date).AddMinutes(3)
  $uri = "http://127.0.0.1:$MetroPort/status"

  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch {
      Start-Sleep -Milliseconds 800
    }
  }

  throw "Metro no respondió en http://localhost:$MetroPort a tiempo."
}

function Wait-MetroBundleReady {
  $bundleUrl = "http://127.0.0.1:$MetroPort/node_modules/expo/AppEntry.bundle?platform=android&dev=true&minify=false&app=$PackageName"
  Write-Step 'Precalentando bundle Android (primera carga puede tardar)...'
  $deadline = (Get-Date).AddMinutes(5)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $bundleUrl -UseBasicParsing -TimeoutSec 120
      if ($response.StatusCode -eq 200) {
        Write-Step 'Bundle Android listo.'
        return
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  throw 'Metro no generó el bundle Android a tiempo.'
}

function Start-MetroBundler {
  Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
  Remove-Item Env:CI -ErrorAction SilentlyContinue
  $env:RCT_METRO_PORT = $MetroPort

  $metroArgs = @('./scripts/start-expo.js')
  if ($Clear) { $metroArgs += '--clear' }

  if ($SameWindow) {
    Write-Step "Metro en puerto $MetroPort (esta ventana). Ctrl+C para detener."
    Push-Location $Root
    try {
      node @metroArgs
    } finally {
      Pop-Location
    }
    return
  }

  Write-Step "Metro en puerto $MetroPort (ventana aparte)."
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoExit',
    '-Command',
    "Set-Location '$Root'; `$env:RCT_METRO_PORT='$MetroPort'; Remove-Item Env:NO_COLOR -EA SilentlyContinue; Remove-Item Env:CI -EA SilentlyContinue; Write-Host 'Metro driver-app :$MetroPort' -ForegroundColor Cyan; node ./scripts/start-expo.js$(if ($Clear) { ' --clear' })"
  ) -WindowStyle Normal | Out-Null
}

function Open-DriverDevClient {
  $adb = Get-Adb
  & $adb shell am force-stop $PackageName 2>$null | Out-Null
  Start-Sleep -Milliseconds 500
  & $adb shell am start -a android.intent.action.VIEW -d $DevClientUrl | Out-Null
  Write-Step "Dev client abierto (localhost:$MetroPort)."
}

Set-Location $Root
Initialize-AndroidEnv

if (-not (Test-Path (Join-Path $Root 'android'))) {
  throw 'No existe carpeta android/. Ejecutá: npm run prebuild:android'
}

if (-not $SkipEmulator -and -not (Test-AndroidDevice)) {
  $resolvedAvd = Resolve-AvdName -Preferred $AvdName
  Start-AndroidEmulator -Name $resolvedAvd
}

if (-not (Test-AndroidDevice)) {
  Write-Step 'Esperando que el emulador aparezca en adb...'
  $adb = Get-Adb
  & $adb wait-for-device | Out-Null
}

if (-not (Test-AndroidDevice)) {
  throw 'No hay dispositivo Android. Conectá un emulador o un teléfono por USB.'
}

Wait-AndroidBoot
Set-AdbReverse
Start-MetroBundler

$needsInstall = $Install -or -not (Test-DriverAppInstalled)
if ($needsInstall) {
  Install-DriverApk
} else {
  Write-Host "[driver-app] APK ya instalado (usa -Install para recompilar)." -ForegroundColor Cyan
}

Wait-MetroReady
Wait-MetroBundleReady
Open-DriverDevClient

Write-Host ''
Write-Host 'Listo — Profesional Conductor en el emulador.' -ForegroundColor Green
Write-Host "  Metro:  http://localhost:$MetroPort" -ForegroundColor DarkGray
Write-Host '  Reinstalar APK: npm run start:android:install' -ForegroundColor DarkGray
if (-not $SameWindow) {
  Write-Host '  Metro corre en otra ventana de PowerShell.' -ForegroundColor DarkGray
}
