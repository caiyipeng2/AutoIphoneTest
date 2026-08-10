[CmdletBinding()]
param(
    [string]$ManifestPath = (Join-Path $PSScriptRoot '..\tools\tool-manifest.json'),
    [string]$ToolsRoot = (Join-Path $PSScriptRoot '..\tools'),
    [string]$ArchivePath,
    [switch]$SkipRuntimeVerification
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-FullPath {
    param([Parameter(Mandatory)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path)
}

function Get-ScrcpyEntry {
    param([Parameter(Mandatory)][object]$Manifest)
    $entry = $Manifest.tools.scrcpy
    if ($null -eq $entry) { throw "Tool 'scrcpy' is missing from the manifest." }
    foreach ($required in @('version', 'fileName', 'url', 'sha256', 'archiveRoot', 'executable', 'serverExecutable', 'versionArguments', 'expectedVersion')) {
        if ($null -eq $entry.PSObject.Properties[$required]) {
            throw "scrcpy manifest is missing '$required'."
        }
    }
    $hash = ([string]$entry.sha256).ToUpperInvariant()
    if ($hash -notmatch '^[A-F0-9]{64}$') { throw 'scrcpy SHA-256 must contain exactly 64 hexadecimal characters.' }
    return $entry
}

function Assert-ArchiveHash {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$ExpectedHash
    )
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actual -ne $ExpectedHash.ToUpperInvariant()) {
        throw "SHA-256 mismatch for '$Path'. Expected $ExpectedHash, received $actual."
    }
}

$extractRoot = $null
$downloadPartialPath = $null

try {
    $resolvedManifestPath = Get-FullPath $ManifestPath
    $resolvedToolsRoot = Get-FullPath $ToolsRoot
    if (-not (Test-Path -LiteralPath $resolvedManifestPath -PathType Leaf)) {
        throw "Tool manifest does not exist: $resolvedManifestPath"
    }
    $manifest = Get-Content -LiteralPath $resolvedManifestPath -Raw | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1) { throw "Unsupported tool manifest schema version: $($manifest.schemaVersion)" }
    $entry = Get-ScrcpyEntry $manifest

    $destination = Join-Path $resolvedToolsRoot (Join-Path 'scrcpy' ([string]$entry.version))
    $publishedExecutable = Join-Path $destination ([string]$entry.executable)
    $publishedServer = Join-Path $destination ([string]$entry.serverExecutable)
    if (Test-Path -LiteralPath $destination) {
        if (-not (Test-Path -LiteralPath $publishedExecutable -PathType Leaf) -or -not (Test-Path -LiteralPath $publishedServer -PathType Leaf)) {
            throw "Published scrcpy directory is incomplete: $destination"
        }
        if (-not $SkipRuntimeVerification) {
            $versionOutput = ((& $publishedExecutable @([string[]]$entry.versionArguments) 2>&1) -join [Environment]::NewLine).Trim()
            $versionLine = ($versionOutput -split '[\r\n]+', 2)[0].Trim()
            if ($LASTEXITCODE -ne 0 -or -not $versionLine.StartsWith([string]$entry.expectedVersion, [System.StringComparison]::Ordinal)) {
                throw "scrcpy version mismatch. Expected '$($entry.expectedVersion)', received '$versionLine'."
            }
        }
        Write-Output "scrcpy $($entry.version) is already available at $destination"
        exit 0
    }

    if ($PSBoundParameters.ContainsKey('ArchivePath')) {
        $archiveToVerify = Get-FullPath $ArchivePath
        if (-not (Test-Path -LiteralPath $archiveToVerify -PathType Leaf)) { throw "scrcpy archive does not exist: $archiveToVerify" }
    }
    else {
        $downloadsRoot = Join-Path $resolvedToolsRoot '.downloads'
        New-Item -ItemType Directory -Force -Path $downloadsRoot | Out-Null
        $archiveToVerify = Join-Path $downloadsRoot ([string]$entry.fileName)
        $downloadPartialPath = "$archiveToVerify.partial"
        if (-not (Test-Path -LiteralPath $archiveToVerify -PathType Leaf)) {
            Remove-Item -LiteralPath $downloadPartialPath -Force -ErrorAction SilentlyContinue
            Invoke-WebRequest -Uri ([string]$entry.url) -OutFile $downloadPartialPath -UseBasicParsing
            Assert-ArchiveHash $downloadPartialPath ([string]$entry.sha256)
            Move-Item -LiteralPath $downloadPartialPath -Destination $archiveToVerify
            $downloadPartialPath = $null
        }
    }
    Assert-ArchiveHash $archiveToVerify ([string]$entry.sha256)

    $scrcpyParent = Join-Path $resolvedToolsRoot 'scrcpy'
    New-Item -ItemType Directory -Force -Path $scrcpyParent | Out-Null
    $extractRoot = Join-Path $scrcpyParent ('.extract-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $extractRoot | Out-Null
    Expand-Archive -LiteralPath $archiveToVerify -DestinationPath $extractRoot -Force
    $extractedRoot = Join-Path $extractRoot ([string]$entry.archiveRoot)
    $extractedExecutable = Join-Path $extractedRoot ([string]$entry.executable)
    $extractedServer = Join-Path $extractedRoot ([string]$entry.serverExecutable)
    if (-not (Test-Path -LiteralPath $extractedExecutable -PathType Leaf)) { throw 'scrcpy archive is missing scrcpy.exe.' }
    if (-not (Test-Path -LiteralPath $extractedServer -PathType Leaf)) { throw 'scrcpy archive is missing scrcpy-server.' }

    if (-not $SkipRuntimeVerification) {
        $versionOutput = ((& $extractedExecutable @([string[]]$entry.versionArguments) 2>&1) -join [Environment]::NewLine).Trim()
        $versionLine = ($versionOutput -split '[\r\n]+', 2)[0].Trim()
        if ($LASTEXITCODE -ne 0 -or -not $versionLine.StartsWith([string]$entry.expectedVersion, [System.StringComparison]::Ordinal)) {
            throw "scrcpy version mismatch. Expected '$($entry.expectedVersion)', received '$versionLine'."
        }
    }

    if (Test-Path -LiteralPath $destination) { throw "scrcpy destination appeared during provisioning: $destination" }
    Move-Item -LiteralPath $extractedRoot -Destination $destination
    $extractRoot = $null
    Write-Output "Installed scrcpy $($entry.version) at $destination"
    Write-Output "Verified archive SHA-256: $([string]$entry.sha256)"
    exit 0
}
catch {
    if ($null -ne $extractRoot -and (Test-Path -LiteralPath $extractRoot)) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }
    if ($null -ne $downloadPartialPath -and (Test-Path -LiteralPath $downloadPartialPath)) { Remove-Item -LiteralPath $downloadPartialPath -Force }
    Write-Error "scrcpy provisioning failed: $($_.Exception.Message)"
    exit 1
}
