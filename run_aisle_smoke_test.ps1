param(
    [string]$ServerBat = "start_server.bat",
    [int]$Port = 8001,
    [string]$OutDir = "autotest-output"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptDir

$serverProc = $null
$tempProfileDir = $null

function Invoke-HeadlessCapture {
    param(
        [Parameter(Mandatory = $true)][string]$BrowserExe,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$OutputFile
    )

    $minBytes = 50000
    if (Test-Path $OutputFile) {
        Remove-Item $OutputFile -Force -ErrorAction SilentlyContinue
    }

    # Some Chromium builds daemonize the renderer; call then wait for a valid output file.
    & $BrowserExe @Arguments | Out-Null
    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $OutputFile) {
            $len = (Get-Item $OutputFile).Length
            if ($len -ge $minBytes) {
                return
            }
        }
        Start-Sleep -Milliseconds 400
    }

    $size = if (Test-Path $OutputFile) { (Get-Item $OutputFile).Length } else { 0 }
    throw "Screenshot appears invalid ($size bytes): $OutputFile"
}

try {
    if (-not (Test-Path $ServerBat)) {
        throw "Server launcher '$ServerBat' was not found in $scriptDir."
    }

    $outDirAbs = Join-Path $scriptDir $OutDir
    New-Item -ItemType Directory -Path $outDirAbs -Force | Out-Null

    # Start the existing project server launcher in the background.
    $serverCmd = "set NO_AUTO_OPEN=1 && call `"$ServerBat`""
    $serverProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $serverCmd -WorkingDirectory $scriptDir -PassThru

    $ready = $false
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 2
            if ($resp.StatusCode -ge 200) {
                $ready = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }

    if (-not $ready) {
        throw "Local server did not respond on port $Port within 30 seconds."
    }

    $browserCandidates = @(
        "C:\Program Files\Google\Chrome\Application\chrome.exe",
        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    )
    $browserExe = $browserCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $browserExe) {
        throw "No supported browser executable found (Chrome or Edge)."
    }

    $tempProfileDir = Join-Path $env:TEMP ("aisle-headless-profile-" + $PID)
    New-Item -ItemType Directory -Path $tempProfileDir -Force | Out-Null

    $commonArgs = @(
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1920,1080",
        "--virtual-time-budget=12000",
        "--run-all-compositor-stages-before-draw",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--remote-debugging-port=0",
        "--user-data-dir=$tempProfileDir"
    )

    $fieldShot = Join-Path $outDirAbs "field-aisles.png"
    $sceneShot = Join-Path $outDirAbs "scene3d-aisles.png"

    $fieldUrl = "http://localhost:$Port/?autotest=1&view=field"
    $sceneUrl = "http://localhost:$Port/?autotest=1&view=scene3d"

    Invoke-HeadlessCapture -BrowserExe $browserExe -Arguments ($commonArgs + @("--screenshot=$fieldShot", $fieldUrl)) -OutputFile $fieldShot
    Invoke-HeadlessCapture -BrowserExe $browserExe -Arguments ($commonArgs + @("--screenshot=$sceneShot", $sceneUrl)) -OutputFile $sceneShot

    Write-Output "Aisle smoke test complete."
    Write-Output "Field screenshot: $fieldShot"
    Write-Output "3D screenshot:    $sceneShot"
}
finally {
    if ($serverProc -and -not $serverProc.HasExited) {
        Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
    }

    try {
        $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
        foreach ($listener in $listeners) {
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    } catch {
        # Ignore cleanup lookup failures.
    }

    if ($tempProfileDir -and (Test-Path $tempProfileDir)) {
        Remove-Item -Path $tempProfileDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Pop-Location
}
