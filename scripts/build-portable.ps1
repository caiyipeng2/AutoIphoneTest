[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [string]$OutputRoot,
    [string]$ReleaseRoot,
    [switch]$SkipBuild,
    [switch]$SkipProvisioning,
    [switch]$SkipZip
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# PowerShell evaluates parameter defaults before $PSScriptRoot is populated.
# Resolve script-relative defaults after binding so direct invocation works in
# both Windows PowerShell 5.1 and PowerShell 7.
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = Join-Path $PSScriptRoot '..' }
if ([string]::IsNullOrWhiteSpace($OutputRoot)) { $OutputRoot = Join-Path $PSScriptRoot '..\dist\portable' }
if ([string]::IsNullOrWhiteSpace($ReleaseRoot)) { $ReleaseRoot = Join-Path $PSScriptRoot '..\dist\releases' }

function Resolve-FullPath([string]$Path) { return [System.IO.Path]::GetFullPath($Path) }
function Require-File([string]$Path, [string]$Description) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Description is missing: $Path" }
}
function Copy-Tree([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "Source directory is missing: $Source" }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    foreach ($entry in Get-ChildItem -LiteralPath $Source -Force) {
        $target = Join-Path $Destination $entry.Name
        $linkTypeProperty = $entry.PSObject.Properties['LinkType']
        if ($null -ne $linkTypeProperty -and -not [string]::IsNullOrWhiteSpace([string]$linkTypeProperty.Value)) {
            # npm/Appium may use workspace junctions. Resolve them into ordinary
            # copied files so the extracted release never depends on the build host.
            $resolved = Resolve-LinkTarget $entry
            if ($entry.PSIsContainer) {
                Copy-Tree $resolved $target
            } else {
                Copy-Item -LiteralPath $resolved -Destination $target -Force
            }
            continue
        }
        if ($entry.PSIsContainer) {
            Copy-Tree $entry.FullName $target
        } else {
            Copy-Item -LiteralPath $entry.FullName -Destination $target -Force
        }
    }
}
function Resolve-LinkTarget($Entry) {
    # Windows PowerShell 5.1 does not expose ResolvedTarget consistently on
    # FileInfo/DirectoryInfo objects. Read link metadata defensively and fall
    # back to LinkTarget/Target, resolving relative targets beside the link.
    $resolvedProperty = $Entry.PSObject.Properties['ResolvedTarget']
    $resolved = if ($null -ne $resolvedProperty) { $resolvedProperty.Value } else { $null }
    if ([string]::IsNullOrWhiteSpace([string]$resolved)) {
        $linkTargetProperty = $Entry.PSObject.Properties['LinkTarget']
        $resolved = if ($null -ne $linkTargetProperty) { $linkTargetProperty.Value } else { $null }
    }
    if ([string]::IsNullOrWhiteSpace([string]$resolved)) {
        $targetProperty = $Entry.PSObject.Properties['Target']
        $resolved = if ($null -ne $targetProperty) { $targetProperty.Value } else { $null }
    }
    if ([string]::IsNullOrWhiteSpace([string]$resolved)) {
        throw "Unable to resolve source link: $($Entry.FullName)"
    }
    if (-not [System.IO.Path]::IsPathRooted([string]$resolved)) {
        $resolved = Join-Path (Split-Path -Parent $Entry.FullName) ([string]$resolved)
    }
    return Resolve-FullPath ([string]$resolved)
}
function Copy-File([string]$Source, [string]$Destination) {
    Require-File $Source 'Required source file'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}
function Copy-WorkspacePackage([string]$Name, [string]$SourceRoot, [string]$DestinationRoot) {
    $destination = Join-Path $DestinationRoot $Name
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Copy-File (Join-Path $SourceRoot 'package.json') (Join-Path $destination 'package.json')
    Copy-Tree (Join-Path $SourceRoot 'dist') (Join-Path $destination 'dist')
    if ($Name -eq 'database' -and (Test-Path -LiteralPath (Join-Path $SourceRoot 'src\migrations') -PathType Container)) {
        Copy-Tree (Join-Path $SourceRoot 'src\migrations') (Join-Path $destination 'src\migrations')
    }
}

$root = Resolve-FullPath $ProjectRoot
$output = Resolve-FullPath $OutputRoot
$release = Resolve-FullPath $ReleaseRoot
$node = Join-Path $root 'tools\node\22.23.1\node.exe'
$npm = Join-Path $root 'tools\node\22.23.1\npm.cmd'
$launcherProject = Join-Path $root 'apps\launcher\src\TestCenter.Launcher\TestCenter.Launcher.csproj'
$staging = "$output.partial"
# Compress-Archive validates the destination extension under Windows
# PowerShell 5.1, so keep the temporary marker before the required .zip
# suffix and atomically rename it to the final archive after compression.
$zipPartial = Join-Path $release 'TestCenterLauncher.partial.zip'
$zipFinal = Join-Path $release 'TestCenterLauncher.zip'

Require-File $node 'Portable Node'
Require-File $npm 'Portable npm'
if (-not $SkipBuild) {
    & $node (Join-Path $root 'node_modules\typescript\bin\tsc') '--build' '--pretty' 'false'
    if ($LASTEXITCODE -ne 0) { throw 'Server/package typecheck failed.' }
    & $npm '--workspace' 'apps/console' 'run' 'build'
    if ($LASTEXITCODE -ne 0) { throw 'Console build failed.' }
}

if (-not $SkipProvisioning) {
    & (Join-Path $root 'scripts\provision-java-bundletool.ps1') -ToolRoot (Join-Path $root 'tools')
    & (Join-Path $root 'scripts\provision-scrcpy.ps1') -ToolsRoot (Join-Path $root 'tools')
    & (Join-Path $root 'scripts\provision-appium.ps1') -ProjectRoot $root -NodePath $node -AppiumHome (Join-Path $root 'data\appium-home')
    $playwrightChrome = Join-Path $root 'data\tools\ms-playwright\chromium-1187\chrome-win\chrome.exe'
    if (-not (Test-Path -LiteralPath $playwrightChrome -PathType Leaf)) {
        & (Join-Path $root 'scripts\provision-playwright.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'Playwright Chromium provisioning failed.' }
    }
}

Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $staging | Out-Null
try {
    Copy-Tree (Join-Path $root 'apps\server\dist') (Join-Path $staging 'apps\server\dist')
    Copy-Tree (Join-Path $root 'apps\console\dist') (Join-Path $staging 'apps\console\dist')
    Copy-File (Join-Path $root 'apps\server\package.json') (Join-Path $staging 'apps\server\package.json')
    Copy-File (Join-Path $root 'apps\console\package.json') (Join-Path $staging 'apps\console\package.json')

    $publish = Join-Path $staging 'launcher'
    dotnet publish $launcherProject -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $publish
    if ($LASTEXITCODE -ne 0) { throw 'Launcher publish failed.' }
    $publishedExe = Join-Path $publish 'TestCenter.Launcher.exe'
    Require-File $publishedExe 'Published launcher'
    # Windows Defender can briefly hold a freshly emitted single-file apphost. Copying
    # first keeps the staging transaction moving; the locked source is removed with the
    # rest of the partial directory once the process releases it.
    Copy-Item -LiteralPath $publishedExe -Destination (Join-Path $staging 'TestCenterLauncher.exe') -Force
    Remove-Item -LiteralPath $publish -Recurse -Force -ErrorAction SilentlyContinue

    Copy-Tree (Join-Path $root 'tools\node\22.23.1') (Join-Path $staging 'tools\node\22.23.1')
    Copy-Tree (Join-Path $root 'tools\java\17.0.19+10') (Join-Path $staging 'tools\java\17.0.19+10')
    Copy-Tree (Join-Path $root 'tools\bundletool\1.18.3') (Join-Path $staging 'tools\bundletool\1.18.3')
    Copy-Tree (Join-Path $root 'tools\scrcpy\3.1') (Join-Path $staging 'tools\scrcpy\3.1')
    Copy-Tree (Join-Path $root 'data\appium-home') (Join-Path $staging 'data\appium-home')
    Copy-Tree (Join-Path $root 'data\tools\ms-playwright') (Join-Path $staging 'data\tools\ms-playwright')

    $externalModules = Join-Path $staging 'node_modules'
    New-Item -ItemType Directory -Force -Path $externalModules | Out-Null
    foreach ($entry in Get-ChildItem -LiteralPath (Join-Path $root 'node_modules') -Force) {
        if ($entry.Name -in @('.bin', '.cache', '.vite', '.vite-temp', '@test-center')) { continue }
        if ($entry.LinkType) { throw "External node_modules entry is a link: $($entry.FullName)" }
        Copy-Item -LiteralPath $entry.FullName -Destination $externalModules -Recurse -Force
    }
    foreach ($package in Get-ChildItem -LiteralPath (Join-Path $root 'packages') -Directory) {
        if ($package.Name -eq 'unity-qa-bridge') { continue }
        Copy-WorkspacePackage $package.Name $package.FullName (Join-Path $externalModules '@test-center')
    }
    Copy-WorkspacePackage 'server' (Join-Path $root 'apps\server') (Join-Path $externalModules '@test-center')
    Copy-WorkspacePackage 'console' (Join-Path $root 'apps\console') (Join-Path $externalModules '@test-center')

    New-Item -ItemType Directory -Force -Path (Join-Path $staging 'data') | Out-Null
    Set-Content -LiteralPath (Join-Path $staging 'data\.gitkeep') -Value '' -NoNewline
    Copy-File (Join-Path $root 'config\settings.example.json') (Join-Path $staging 'config\settings.example.json')
    Copy-File (Join-Path $root 'THIRD_PARTY_NOTICES.md') (Join-Path $staging 'THIRD_PARTY_NOTICES.md')
    foreach ($doc in @('user-guide.md','device-onboarding.md','deployment-and-signing.md','session-recovery.md','storage-and-cleanup.md','maintenance.md','build-provider-extension.md')) {
        Copy-File (Join-Path $root "docs\$doc") (Join-Path $staging "docs\$doc")
    }

    & $node (Join-Path $root 'scripts\write-release-manifest.mjs') '--root' $staging '--output' (Join-Path $staging 'manifest.sha256.json')
    if ($LASTEXITCODE -ne 0) { throw 'Release manifest generation failed.' }
    Remove-Item -LiteralPath $output -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $staging -Destination $output

    if (-not $SkipZip) {
        New-Item -ItemType Directory -Force -Path $release | Out-Null
        Remove-Item -LiteralPath $zipPartial -Force -ErrorAction SilentlyContinue
        # Compress-Archive's LiteralPath does not expand the root wildcard and
        # its Path mode skips hidden files. ZipFile walks the directory itself,
        # preserving manifest coverage for entries such as data\.gitkeep.
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::CreateFromDirectory(
            $output,
            $zipPartial,
            [System.IO.Compression.CompressionLevel]::Optimal,
            $false
        )
        Move-Item -LiteralPath $zipPartial -Destination $zipFinal -Force
        Write-Output "Portable ZIP: $zipFinal"
    }
    Write-Output "Portable directory: $output"
}
finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
