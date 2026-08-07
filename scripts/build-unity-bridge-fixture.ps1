[CmdletBinding()]
param(
    [ValidateSet("qa", "release")]
    [string]$BuildMode = "qa",
    [string]$UnityPath,
    [string]$ProjectPath,
    [string]$OutputRoot,
    [string]$AndroidSdkPath,
    [string]$JdkPath
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($UnityPath)) { $UnityPath = "D:\Unity\Editor\Unity.exe" }
if ([string]::IsNullOrWhiteSpace($ProjectPath)) { $ProjectPath = Join-Path $PSScriptRoot "..\packages\unity-qa-bridge\verification-project" }
if ([string]::IsNullOrWhiteSpace($OutputRoot)) { $OutputRoot = Join-Path $PSScriptRoot "..\TestResults\m5-fixture" }

$unityFullPath = (Resolve-Path -LiteralPath $UnityPath).Path
$projectFullPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$projectSettingsPath = Join-Path $projectFullPath "ProjectSettings\ProjectSettings.asset"
$outputFullPath = (Resolve-Path -LiteralPath (New-Item -ItemType Directory -Force -Path $OutputRoot)).Path
$apkName = if ($BuildMode -eq "qa") { "qa-bridge-fixture.apk" } else { "release-no-bridge.apk" }
$apkPath = Join-Path $outputFullPath $apkName
$logPath = Join-Path $outputFullPath "$BuildMode-build.log"

if (-not (Test-Path -LiteralPath $unityFullPath)) { throw "Unity executable was not found: $unityFullPath" }
if (-not (Test-Path -LiteralPath (Join-Path $projectFullPath "ProjectSettings\ProjectSettings.asset"))) { throw "Unity project settings are missing: $projectSettingsPath" }

$unityAndroidRoot = Join-Path (Split-Path -Parent $unityFullPath) "Data\PlaybackEngines\AndroidPlayer"
if ([string]::IsNullOrWhiteSpace($AndroidSdkPath)) { $AndroidSdkPath = Join-Path $unityAndroidRoot "SDK" }
if ([string]::IsNullOrWhiteSpace($JdkPath)) { $JdkPath = Join-Path $unityAndroidRoot "OpenJDK" }
if (-not (Test-Path -LiteralPath $AndroidSdkPath)) { throw "Android SDK was not found: $AndroidSdkPath" }
if (-not (Test-Path -LiteralPath $JdkPath)) { throw "JDK was not found: $JdkPath" }

$existingUnity = Get-CimInstance Win32_Process -Filter "Name='Unity.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($projectFullPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
}
if ($existingUnity) { throw "Another Unity process is already using the fixture project: $($existingUnity.ProcessId -join ', ')" }

$originalSettings = [System.IO.File]::ReadAllText($projectSettingsPath)
$symbolValue = if ($BuildMode -eq "qa") { "UNITY_MULTI_DEVICE_QA" } else { "" }
$updatedSettings = [regex]::Replace($originalSettings, "(?m)^  scriptingDefineSymbols:.*$", "  scriptingDefineSymbols: { Android: $symbolValue }")
$relativeProjectPath = ([System.Uri]::new(($repoRoot.TrimEnd("\") + "\"))).MakeRelativeUri([System.Uri]::new($projectFullPath)).ToString().Replace("/", "\")
$arguments = @(
    "-batchmode",
    "-nographics",
    "-accept-apiupdate",
    "-quit",
    "-projectPath", $relativeProjectPath,
    "-buildTarget", "Android",
    "-executeMethod", "Caiyipeng.TestCenter.QaFixture.Editor.QaFixtureBuilder.BuildFromCommandLine",
    "-fixtureBuild", $BuildMode,
    "-buildPath", $apkPath,
    "-logFile", $logPath
)

try {
    [System.IO.File]::WriteAllText($projectSettingsPath, $updatedSettings, [System.Text.UTF8Encoding]::new($false))
    $env:ANDROID_HOME = $AndroidSdkPath
    $env:ANDROID_SDK_ROOT = $AndroidSdkPath
    $env:JAVA_HOME = $JdkPath
    $process = Start-Process -FilePath $unityFullPath -ArgumentList $arguments -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) { throw "Unity $BuildMode fixture build failed with exit code $($process.ExitCode). See $logPath" }
    if (-not (Test-Path -LiteralPath $apkPath)) { throw "Unity reported success but did not create APK: $apkPath" }
    Write-Output "Unity $BuildMode fixture APK: $apkPath"
}
finally {
    [System.IO.File]::WriteAllText($projectSettingsPath, $originalSettings, [System.Text.UTF8Encoding]::new($false))
}
