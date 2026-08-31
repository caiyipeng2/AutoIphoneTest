[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$UnityProjectRoot,
    [string]$BridgePackageRoot,
    [string]$BackupRoot,
    [switch]$AllowDirty,
    [switch]$ReplaceExisting
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-FullPath([string]$Path) {
    return [System.IO.Path]::GetFullPath($Path)
}

function Require-Directory([string]$Path, [string]$Description) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Description is missing: $Path"
    }
}

$project = Resolve-FullPath $UnityProjectRoot
if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    # Keep backup packages outside Unity's Packages/Assets scan roots. Unity
    # treats any nested package.json as an embedded package, so an in-place
    # .bak directory can make the project fail package resolution.
    $BackupRoot = "$project.testcenter-backups"
}
$backupRootResolved = Resolve-FullPath $BackupRoot
if ([string]::IsNullOrWhiteSpace($BridgePackageRoot)) {
    # Resolve script-relative defaults after parameter binding; Windows
    # PowerShell does not populate PSScriptRoot while evaluating defaults.
    $BridgePackageRoot = Join-Path $PSScriptRoot '..\packages\unity-qa-bridge\com.caiyipeng.testcenter.qa'
}
$packageSource = Resolve-FullPath $BridgePackageRoot
Require-Directory $project 'Unity project root'
Require-Directory (Join-Path $project 'Assets') 'Unity Assets directory'
Require-Directory (Join-Path $project 'Packages') 'Unity Packages directory'
Require-Directory (Join-Path $project 'ProjectSettings') 'Unity ProjectSettings directory'
Require-Directory $packageSource 'QA bridge package source'

$projectVersion = Join-Path $project 'ProjectSettings\ProjectVersion.txt'
if (-not (Test-Path -LiteralPath $projectVersion -PathType Leaf)) {
    throw "Unity project version file is missing: $projectVersion"
}

$git = Get-Command git -ErrorAction SilentlyContinue
if ($null -ne $git -and (Test-Path -LiteralPath (Join-Path $project '.git'))) {
    $status = @(& $git.Source -C $project status --porcelain)
    if ($status.Count -gt 0 -and -not $AllowDirty) {
        throw "Unity project has uncommitted changes. Re-run with -AllowDirty only after reviewing them."
    }
}

$packageDestination = Join-Path $project 'Packages\com.caiyipeng.testcenter.qa'
$adapterDestination = Join-Path $project 'Assets\TestCenter\QaBridge\IdleWeaponShopQaBridge.cs'
$integrationSource = Join-Path (Split-Path -Parent $packageSource) 'integrations\idle-weapon-shop-tycoon'
$adapterSource = Join-Path $integrationSource 'IdleWeaponShopQaBridge.cs'
$editorSource = Join-Path $integrationSource 'Editor\TestCenterQaBridgeEditorSmoke.cs'
$editorDestination = Join-Path $project 'Assets\Editor\TestCenterQaBridgeEditorSmoke.cs'
if (-not (Test-Path -LiteralPath $adapterSource -PathType Leaf)) {
    throw "Idle Weapon Shop adapter is missing: $adapterSource"
}
if (-not (Test-Path -LiteralPath $editorSource -PathType Leaf)) {
    throw "Unity compile smoke entrypoint is missing: $editorSource"
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDirectory = Join-Path $backupRootResolved $timestamp
$backups = @()
if (Test-Path -LiteralPath $packageDestination) {
    if (-not $ReplaceExisting) { throw "QA bridge package already exists: $packageDestination" }
    $backups += [pscustomobject]@{ Source = $packageDestination; Backup = Join-Path $backupDirectory 'Packages-com.caiyipeng.testcenter.qa' }
}
if (Test-Path -LiteralPath $adapterDestination) {
    if (-not $ReplaceExisting) { throw "Idle Weapon Shop adapter already exists: $adapterDestination" }
    $backups += [pscustomobject]@{ Source = $adapterDestination; Backup = Join-Path $backupDirectory 'Assets-TestCenter-QaBridge-IdleWeaponShopQaBridge.cs' }
}
if (Test-Path -LiteralPath $editorDestination) {
    if (-not $ReplaceExisting) { throw "Unity compile smoke entrypoint already exists: $editorDestination" }
    $backups += [pscustomobject]@{ Source = $editorDestination; Backup = Join-Path $backupDirectory 'Assets-Editor-TestCenterQaBridgeEditorSmoke.cs' }
}

if ($PSCmdlet.ShouldProcess($project, 'Stage QA bridge package and Idle Weapon Shop adapter')) {
    foreach ($backup in $backups) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup.Backup) | Out-Null
        Move-Item -LiteralPath $backup.Source -Destination $backup.Backup
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $packageDestination) | Out-Null
    Copy-Item -LiteralPath $packageSource -Destination $packageDestination -Recurse -Force
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $adapterDestination) | Out-Null
    Copy-Item -LiteralPath $adapterSource -Destination $adapterDestination -Force
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $editorDestination) | Out-Null
    Copy-Item -LiteralPath $editorSource -Destination $editorDestination -Force
    $state = 'STAGED'
} else {
    $state = 'WHATIF'
}

[pscustomobject]@{
    state = $state
    project = $project
    package = $packageDestination
    adapter = $adapterDestination
    editor = $editorDestination
    backupRoot = $backupRootResolved
    backups = $backups
    allowDirty = [bool]$AllowDirty
}
