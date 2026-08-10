[CmdletBinding()]
param(
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..'),
    [string]$NodePath = (Join-Path $PSScriptRoot '..\tools\node\22.23.1\node.exe'),
    [string]$AppiumHome = (Join-Path $PSScriptRoot '..\data\appium-home'),
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$resolvedRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$resolvedNode = [System.IO.Path]::GetFullPath($NodePath)
$resolvedHome = [System.IO.Path]::GetFullPath($AppiumHome)
$appiumCli = Join-Path $resolvedRoot 'node_modules\appium\build\lib\main.js'
$expectedAppium = '3.6.0'
$expectedDriver = '8.2.2'

if (-not (Test-Path -LiteralPath $resolvedNode -PathType Leaf)) {
    throw "Portable Node was not found: $resolvedNode"
}
if (-not (Test-Path -LiteralPath $appiumCli -PathType Leaf)) {
    throw "Project-local Appium CLI was not found: $appiumCli"
}

New-Item -ItemType Directory -Force -Path $resolvedHome | Out-Null
$env:APPIUM_HOME = $resolvedHome

function Get-UiAutomator2Record([object]$Payload) {
    if ($null -eq $Payload -or $null -eq $Payload.PSObject.Properties['uiautomator2']) {
        throw "Appium driver list did not contain the 'uiautomator2' record."
    }
    return $Payload.PSObject.Properties['uiautomator2'].Value
}

$versionOutput = (& $resolvedNode $appiumCli '--version' 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $versionOutput -ne $expectedAppium) {
    throw "Appium version mismatch. Expected '$expectedAppium', received '$versionOutput'."
}

if (-not $SkipInstall) {
    $installedJson = (& $resolvedNode $appiumCli 'driver' 'list' '--installed' '--json' 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect installed Appium drivers.' }
    $installed = $installedJson | ConvertFrom-Json
    $driver = Get-UiAutomator2Record $installed
    if ($null -eq $driver -or $driver.installed -ne $true -or [string]$driver.version -ne $expectedDriver) {
        & $resolvedNode $appiumCli 'driver' 'install' "uiautomator2@$expectedDriver" 2>&1 | Out-String | Write-Verbose
        if ($LASTEXITCODE -ne 0) { throw "UiAutomator2 $expectedDriver installation failed." }
    }
}

$finalJson = (& $resolvedNode $appiumCli 'driver' 'list' '--installed' '--json' 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Unable to verify installed Appium drivers.' }
$final = $finalJson | ConvertFrom-Json
$finalDriver = Get-UiAutomator2Record $final
if ($null -eq $finalDriver -or $finalDriver.installed -ne $true -or [string]$finalDriver.version -ne $expectedDriver) {
    throw "UiAutomator2 version mismatch. Expected '$expectedDriver'."
}

[pscustomobject]@{
    appiumVersion = $versionOutput
    uiautomator2Version = [string]$finalDriver.version
    appiumHome = $resolvedHome
    projectRoot = $resolvedRoot
}
