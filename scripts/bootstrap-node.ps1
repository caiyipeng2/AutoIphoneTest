[CmdletBinding()]
param(
    [string]$ManifestPath = (Join-Path $PSScriptRoot '..\tools\tool-manifest.json'),
    [string]$ToolsRoot = (Join-Path $PSScriptRoot '..\tools'),
    [string]$ArchivePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-FullPath {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    return [System.IO.Path]::GetFullPath($Path)
}

function Assert-NodeVersion {
    param(
        [Parameter(Mandatory)]
        [string]$NodePath,

        [Parameter(Mandatory)]
        [string[]]$VersionArguments,

        [Parameter(Mandatory)]
        [string]$ExpectedVersion
    )

    $versionOutput = @(& $NodePath @VersionArguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "Node version check exited with code $LASTEXITCODE."
    }

    $actualVersion = ($versionOutput -join [Environment]::NewLine).Trim()
    if ($actualVersion -ne $ExpectedVersion) {
        throw "Node version mismatch. Expected '$ExpectedVersion', received '$actualVersion'."
    }

    return $actualVersion
}

$extractRoot = $null
$downloadPartialPath = $null

try {
    $resolvedManifestPath = Get-FullPath -Path $ManifestPath
    $resolvedToolsRoot = Get-FullPath -Path $ToolsRoot

    if (-not (Test-Path -LiteralPath $resolvedManifestPath -PathType Leaf)) {
        throw "Tool manifest does not exist: $resolvedManifestPath"
    }

    $manifest = Get-Content -LiteralPath $resolvedManifestPath -Raw | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1) {
        throw "Unsupported tool manifest schema version: $($manifest.schemaVersion)"
    }

    $node = $manifest.tools.node
    if ($null -eq $node) {
        throw 'Tool manifest does not define tools.node.'
    }

    foreach ($requiredProperty in @(
            'version',
            'fileName',
            'url',
            'sha256',
            'archiveRoot',
            'executable',
            'versionArguments',
            'expectedVersion'
        )) {
        if ($null -eq $node.PSObject.Properties[$requiredProperty]) {
            throw "Node manifest is missing '$requiredProperty'."
        }
    }

    $expectedHash = ([string]$node.sha256).ToUpperInvariant()
    if ($expectedHash -notmatch '^[A-F0-9]{64}$') {
        throw 'Node manifest SHA-256 must contain exactly 64 hexadecimal characters.'
    }

    $versionArguments = @($node.versionArguments | ForEach-Object { [string]$_ })
    $nodeParent = Join-Path $resolvedToolsRoot 'node'
    $destination = Join-Path $nodeParent ([string]$node.version)
    $publishedNodePath = Join-Path $destination ([string]$node.executable)

    if (Test-Path -LiteralPath $destination) {
        if (-not (Test-Path -LiteralPath $publishedNodePath -PathType Leaf)) {
            throw "Published Node directory is incomplete: $destination"
        }

        $publishedVersion = Assert-NodeVersion `
            -NodePath $publishedNodePath `
            -VersionArguments $versionArguments `
            -ExpectedVersion ([string]$node.expectedVersion)
        Write-Output "Node $publishedVersion is already available at $destination"
        exit 0
    }

    New-Item -ItemType Directory -Path $resolvedToolsRoot -Force | Out-Null

    if ($PSBoundParameters.ContainsKey('ArchivePath')) {
        $archiveToVerify = Get-FullPath -Path $ArchivePath
        if (-not (Test-Path -LiteralPath $archiveToVerify -PathType Leaf)) {
            throw "Node archive does not exist: $archiveToVerify"
        }
    }
    else {
        $downloadsRoot = Join-Path $resolvedToolsRoot '.downloads'
        New-Item -ItemType Directory -Path $downloadsRoot -Force | Out-Null

        $archiveToVerify = Join-Path $downloadsRoot ([string]$node.fileName)
        $downloadPartialPath = "$archiveToVerify.partial"

        if (-not (Test-Path -LiteralPath $archiveToVerify -PathType Leaf)) {
            if (Test-Path -LiteralPath $downloadPartialPath) {
                Remove-Item -LiteralPath $downloadPartialPath -Force
            }

            Write-Output "Downloading Node $($node.version) to $downloadPartialPath"
            Invoke-WebRequest -Uri ([string]$node.url) -OutFile $downloadPartialPath -UseBasicParsing

            $partialHash = (Get-FileHash -LiteralPath $downloadPartialPath -Algorithm SHA256).Hash.ToUpperInvariant()
            if ($partialHash -ne $expectedHash) {
                throw "SHA-256 mismatch for '$downloadPartialPath'. Expected $expectedHash, received $partialHash."
            }

            Move-Item -LiteralPath $downloadPartialPath -Destination $archiveToVerify
            $downloadPartialPath = $null
        }
    }

    $actualHash = (Get-FileHash -LiteralPath $archiveToVerify -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "SHA-256 mismatch for '$archiveToVerify'. Expected $expectedHash, received $actualHash."
    }

    New-Item -ItemType Directory -Path $nodeParent -Force | Out-Null
    $extractRoot = Join-Path $nodeParent ('.extract-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $extractRoot | Out-Null
    Expand-Archive -LiteralPath $archiveToVerify -DestinationPath $extractRoot

    $extractedNodeRoot = Join-Path $extractRoot ([string]$node.archiveRoot)
    $extractedNodePath = Join-Path $extractedNodeRoot ([string]$node.executable)
    if (-not (Test-Path -LiteralPath $extractedNodePath -PathType Leaf)) {
        throw "Node archive is missing the expected executable: $extractedNodePath"
    }

    $verifiedVersion = Assert-NodeVersion `
        -NodePath $extractedNodePath `
        -VersionArguments $versionArguments `
        -ExpectedVersion ([string]$node.expectedVersion)

    if (Test-Path -LiteralPath $destination) {
        throw "Node destination appeared during provisioning: $destination"
    }

    Move-Item -LiteralPath $extractedNodeRoot -Destination $destination
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
    $extractRoot = $null

    Write-Output "Installed Node $verifiedVersion at $destination"
    Write-Output "Verified archive SHA-256: $actualHash"
    exit 0
}
catch {
    if ($null -ne $extractRoot -and (Test-Path -LiteralPath $extractRoot)) {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force
    }
    if ($null -ne $downloadPartialPath -and (Test-Path -LiteralPath $downloadPartialPath)) {
        Remove-Item -LiteralPath $downloadPartialPath -Force
    }

    Write-Error "Node bootstrap failed: $($_.Exception.Message)"
    exit 1
}
