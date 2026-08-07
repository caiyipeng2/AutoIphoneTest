[CmdletBinding()]
param(
    [string]$UnityPath,
    [string]$ProjectPath,
    [string]$ResultsPath
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($UnityPath)) { $UnityPath = "D:\Unity\Editor\Unity.exe" }
if ([string]::IsNullOrWhiteSpace($ProjectPath)) { $ProjectPath = Join-Path $PSScriptRoot "..\packages\unity-qa-bridge\verification-project" }
if ([string]::IsNullOrWhiteSpace($ResultsPath)) { $ResultsPath = Join-Path $PSScriptRoot "..\TestResults\m5-qa-bridge-editmode.xml" }

if (-not (Test-Path -LiteralPath $UnityPath)) {
    throw "Unity executable was not found: $UnityPath"
}
if (-not (Test-Path -LiteralPath $ProjectPath)) {
    throw "Unity verification project was not found: $ProjectPath"
}

$resultsDirectory = Split-Path -Parent $ResultsPath
New-Item -ItemType Directory -Force -Path $resultsDirectory | Out-Null

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$projectFullPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$resultsDirectoryFullPath = (Resolve-Path -LiteralPath $resultsDirectory).Path
$projectSettingsPath = Join-Path $projectFullPath "ProjectSettings\ProjectSettings.asset"
$originalSettings = [System.IO.File]::ReadAllText($projectSettingsPath)
$qaSettings = [regex]::Replace($originalSettings, "(?m)^  scriptingDefineSymbols:.*$", "  scriptingDefineSymbols: { Android: UNITY_MULTI_DEVICE_QA }")
$repoUri = [System.Uri]::new(($repoRoot.TrimEnd("\") + "\"))
$projectArgument = $repoUri.MakeRelativeUri([System.Uri]::new($projectFullPath)).ToString().Replace("/", "\")
$testResultsArgument = Join-Path $resultsDirectoryFullPath (Split-Path -Leaf $ResultsPath)
$logPath = Join-Path $resultsDirectoryFullPath "m5-qa-bridge-unity.log"

$arguments = @(
    "-batchmode",
    "-nographics",
    "-projectPath", $projectArgument,
    "-runTests",
    "-testPlatform", "editmode",
    "-testResults", $testResultsArgument,
    "-logFile", $logPath
)

try {
    [System.IO.File]::WriteAllText($projectSettingsPath, $qaSettings, [System.Text.UTF8Encoding]::new($false))
    $process = Start-Process -FilePath $UnityPath -ArgumentList $arguments -WorkingDirectory $repoRoot -Wait -PassThru -NoNewWindow
    $exitCode = $process.ExitCode
    if ($exitCode -ne 0) {
        throw "Unity bridge tests failed with exit code $exitCode."
    }

    for ($attempt = 0; $attempt -lt 20 -and -not (Test-Path -LiteralPath $testResultsArgument); $attempt++) {
        Start-Sleep -Milliseconds 250
    }
    if (-not (Test-Path -LiteralPath $testResultsArgument)) {
        throw "Unity did not publish test results: $testResultsArgument. See $logPath"
    }

    [xml]$testResults = Get-Content -LiteralPath $testResultsArgument
    $testRun = $testResults.'test-run'
    if ($testRun.result -ne "Passed" -or [int]$testRun.failed -ne 0) {
        throw "Unity bridge tests reported result=$($testRun.result), failed=$($testRun.failed). See $testResultsArgument"
    }

    Write-Output "Unity bridge tests passed: $testResultsArgument"
}
finally {
    [System.IO.File]::WriteAllText($projectSettingsPath, $originalSettings, [System.Text.UTF8Encoding]::new($false))
}
