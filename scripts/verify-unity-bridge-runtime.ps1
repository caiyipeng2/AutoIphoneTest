[CmdletBinding()]
param(
    [string]$AdbPath = "D:\ADB\platform-tools\adb.exe",
    [string]$Serial,
    [string]$ArtifactRoot = "E:\Projects\UnityMultiDeviceTestCenter\TestResults\m5-fixture",
    [string]$EvidencePath = "E:\Projects\UnityMultiDeviceTestCenter\TestResults\m5-fixture\runtime-evidence.json",
    [int]$DevicePort = 17501,
    [int]$HostPort = 17501
)

$ErrorActionPreference = "Stop"
$packageName = "com.caiyipeng.testcenter.fixture"
$qaApk = Join-Path $ArtifactRoot "qa-bridge-fixture.apk"
$releaseApk = Join-Path $ArtifactRoot "release-no-bridge.apk"

if (-not (Test-Path -LiteralPath $AdbPath)) { throw "ADB executable was not found: $AdbPath" }
if (-not (Test-Path -LiteralPath $qaApk)) { throw "QA fixture APK was not found: $qaApk" }
if (-not (Test-Path -LiteralPath $releaseApk)) { throw "Release fixture APK was not found: $releaseApk" }

function Invoke-Adb {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { $output = @(& $AdbPath @Arguments 2>&1); $exitCode = $LASTEXITCODE }
    finally { $ErrorActionPreference = $previousErrorAction }
    if ($exitCode -ne 0) { throw "ADB failed ($exitCode): adb $($Arguments -join ' ')`n$($output -join [Environment]::NewLine)" }
    return @($output)
}

function Select-DeviceSerial {
    if (-not [string]::IsNullOrWhiteSpace($Serial)) { return $Serial }
    $devices = @(Invoke-Adb @("devices") | Where-Object { $_ -match "^\S+\s+device\s*$" })
    if ($devices.Count -ne 1) { throw "Expected exactly one online Android device; found $($devices.Count)." }
    return ($devices[0] -split "\s+")[0]
}

function Install-AndLaunch {
    param([Parameter(Mandatory = $true)][string]$ApkPath, [Parameter(Mandatory = $true)][string]$TargetSerial)
    Invoke-Adb @("-s", $TargetSerial, "install", "-r", "-t", $ApkPath) | Out-Null
    Invoke-Adb @("-s", $TargetSerial, "shell", "am", "force-stop", $packageName) | Out-Null
    Invoke-Adb @("-s", $TargetSerial, "shell", "monkey", "-p", $packageName, "1") | Out-Null
    Start-Sleep -Seconds 2
}

function Read-BridgeLine {
    param([Parameter(Mandatory = $true)][System.Net.Sockets.TcpClient]$Client)
    $stream = $Client.GetStream()
    $stream.ReadTimeout = 5000
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.UTF8Encoding]::new($false))
    try { return $reader.ReadLine() } finally { $reader.Dispose() }
}

function Try-ReadForwardedLine {
    param([Parameter(Mandatory = $true)][string]$ExpectedType, [Parameter(Mandatory = $true)][bool]$ShouldConnect)
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $client.Connect("127.0.0.1", $HostPort)
        $line = Read-BridgeLine $client
        if ([string]::IsNullOrWhiteSpace($line)) {
            return @{ connected = $false; firstLine = $null }
        }
        if (-not $ShouldConnect) {
            if ($line.IndexOf($ExpectedType, [StringComparison]::Ordinal) -ge 0) {
                throw "Release fixture unexpectedly emitted $ExpectedType."
            }
            return @{ connected = $false; firstLine = $line }
        }
        if ($line.IndexOf($ExpectedType, [StringComparison]::Ordinal) -lt 0) {
            throw "Expected $ExpectedType from QA fixture, received: $line"
        }
        return @{ connected = $true; firstLine = $line }
    }
    catch [System.Net.Sockets.SocketException] {
        if ($ShouldConnect) { return @{ connected = $false; firstLine = $null } }
        return @{ connected = $false; firstLine = $null }
    }
    catch [System.IO.IOException] {
        if ($ShouldConnect) { return @{ connected = $false; firstLine = $null } }
        return @{ connected = $false; firstLine = $null }
    }
    finally {
        $client.Dispose()
    }
}

function Wait-ForForwardedLine {
    param(
        [Parameter(Mandatory = $true)][string]$ExpectedType,
        [int]$TimeoutSeconds = 20
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $result = Try-ReadForwardedLine $ExpectedType $true
        if ($result.connected) { return $result }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out waiting ${ExpectedType} from QA fixture after ${TimeoutSeconds}s."
}

$targetSerial = Select-DeviceSerial
$evidence = [ordered]@{
    serial = $targetSerial
    package = $packageName
    devicePort = $DevicePort
    hostPort = $HostPort
    qa = $null
    release = $null
    capturedAtUtc = [DateTime]::UtcNow.ToString("o")
}

try {
    Install-AndLaunch $qaApk $targetSerial
    Invoke-Adb @("-s", $targetSerial, "forward", "tcp:$HostPort", "tcp:$DevicePort") | Out-Null
    $evidence.qa = Wait-ForForwardedLine "QA_HELLO"
    Invoke-Adb @("-s", $targetSerial, "forward", "--remove", "tcp:$HostPort") | Out-Null

    Invoke-Adb @("-s", $targetSerial, "logcat", "-c") | Out-Null
    Install-AndLaunch $releaseApk $targetSerial
    Invoke-Adb @("-s", $targetSerial, "forward", "tcp:$HostPort", "tcp:$DevicePort") | Out-Null
    $evidence.release = Try-ReadForwardedLine "QA_HELLO" $false
    Invoke-Adb @("-s", $targetSerial, "forward", "--remove", "tcp:$HostPort") | Out-Null

    $logcat = Invoke-Adb @("-s", $targetSerial, "logcat", "-d")
    $qaLogs = @($logcat | Where-Object { $_ -match "QA_(STATE|HELLO|ARMED|ACK)" })
    if ($qaLogs.Count -gt 0) { throw "Release fixture emitted QA log lines: $($qaLogs -join ' | ')" }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $EvidencePath) | Out-Null
    [System.IO.File]::WriteAllText($EvidencePath, ($evidence | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
    Write-Output "Unity bridge runtime verification passed: $EvidencePath"
}
finally {
    try { Invoke-Adb @("-s", $targetSerial, "forward", "--remove", "tcp:$HostPort") | Out-Null } catch { }
}
