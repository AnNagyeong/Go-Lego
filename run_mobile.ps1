param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed (exit $LASTEXITCODE)." }
}

try {
    $flutterCommand = (Get-Command flutter -ErrorAction Stop).Source
    $nodeCommand = (Get-Command node -ErrorAction Stop).Source
    $backendDirectory = Join-Path $PSScriptRoot 'web_backend'
    if (!(Test-Path -LiteralPath (Join-Path $backendDirectory '.env'))) {
        throw 'web_backend\.env is missing. Copy .env.example and configure it first.'
    }
    $adbCommand = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    if (!(Test-Path -LiteralPath $adbCommand)) {
        $adbCommand = (Get-Command adb -ErrorAction Stop).Source
    }
    $deviceLines = & $adbCommand devices
    if ($LASTEXITCODE -ne 0) { throw 'Unable to list Android devices.' }
    $deviceIds = @($deviceLines | ForEach-Object {
        if ($_ -match '^(\S+)\s+device\s*$') { $Matches[1] }
    })
    $deviceId = $env:ACCESSNAV_DEVICE_ID
    if (!$deviceId) {
        if ($deviceIds.Count -eq 0) { throw 'Connect an Android device and allow USB debugging.' }
        if ($deviceIds.Count -gt 1) { throw 'Multiple devices connected. Set ACCESSNAV_DEVICE_ID to choose one.' }
        $deviceId = $deviceIds[0]
    }
    if ($deviceId -notin $deviceIds) { throw "Android device $deviceId is not connected or authorized." }
    Write-Host "[AccessNav] Android device: $deviceId"
    if ($CheckOnly) { Write-Host '[AccessNav] Prerequisites OK.'; exit 0 }

    if (!(Test-Path -LiteralPath (Join-Path $backendDirectory 'node_modules'))) {
        Push-Location -LiteralPath $backendDirectory
        try { Invoke-Checked 'npm.cmd' @('ci') } finally { Pop-Location }
    }
    Invoke-Checked $flutterCommand @('pub', 'get')

    $listeners = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) {
        Start-Process -FilePath $nodeCommand -ArgumentList @('server.js') -WorkingDirectory $backendDirectory -WindowStyle Hidden | Out-Null
    }
    $backendReady = $false
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing 'http://localhost:3000/index.html' -TimeoutSec 2
            if ($response.StatusCode -eq 200 -and $response.Content -match '20260908-gps-simulator') {
                $backendReady = $true
                break
            }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (!$backendReady) { throw 'AccessNav backend is unavailable on port 3000. Check the server or another app using that port.' }
    Invoke-Checked $adbCommand @('-s', $deviceId, 'reverse', 'tcp:3000', 'tcp:3000')
    Invoke-Checked $flutterCommand @('run', '-d', $deviceId)
} catch {
    Write-Host "[AccessNav] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
