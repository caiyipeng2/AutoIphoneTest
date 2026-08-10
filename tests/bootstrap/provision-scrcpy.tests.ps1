$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$provisionScript = Join-Path $repositoryRoot 'scripts\provision-scrcpy.ps1'
$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ('test-center-scrcpy-' + [guid]::NewGuid().ToString('N'))
$toolsRoot = Join-Path $sandbox 'tools'
$fixtureRoot = Join-Path $sandbox 'fixture\scrcpy-win64-v3.1'
$archivePath = Join-Path $sandbox 'scrcpy-win64-v3.1.zip'
$manifestPath = Join-Path $sandbox 'tool-manifest.json'
$destination = Join-Path $toolsRoot 'scrcpy\3.1'

New-Item -ItemType Directory -Path $fixtureRoot | Out-Null

try {
    [System.IO.File]::WriteAllText(
        (Join-Path $fixtureRoot 'scrcpy.exe'),
        'fixture cli',
        [System.Text.UTF8Encoding]::new($false)
    )
    [System.IO.File]::WriteAllText(
        (Join-Path $fixtureRoot 'scrcpy-server'),
        'fixture server',
        [System.Text.UTF8Encoding]::new($false)
    )
    Compress-Archive -LiteralPath $fixtureRoot -DestinationPath $archivePath -CompressionLevel NoCompression
    $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest = @{
        schemaVersion = 1
        tools = @{
            scrcpy = @{
                sourceType = 'archive'
                version = '3.1'
                platform = 'win-x64'
                fileName = 'scrcpy-win64-v3.1.zip'
                url = 'https://example.invalid/scrcpy-win64-v3.1.zip'
                sha256 = $hash
                archiveRoot = 'scrcpy-win64-v3.1'
                executable = 'scrcpy.exe'
                serverExecutable = 'scrcpy-server'
                versionArguments = @('--version')
                expectedVersion = 'scrcpy 3.1'
            }
        }
    }
    [System.IO.File]::WriteAllText(
        $manifestPath,
        ($manifest | ConvertTo-Json -Depth 8),
        [System.Text.UTF8Encoding]::new($false)
    )

    $pwshPath = (Get-Process -Id $PID).Path
    $firstOutput = @(
        & $pwshPath -NoProfile -File $provisionScript `
            -ManifestPath $manifestPath `
            -ToolsRoot $toolsRoot `
            -ArchivePath $archivePath `
            -SkipRuntimeVerification 2>&1
    )
    if ($LASTEXITCODE -ne 0) { throw "Expected fixture provisioning to pass: $($firstOutput -join [Environment]::NewLine)" }
    if (-not (Test-Path -LiteralPath (Join-Path $destination 'scrcpy.exe') -PathType Leaf)) {
        throw 'scrcpy.exe was not atomically published.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $destination 'scrcpy-server') -PathType Leaf)) {
        throw 'scrcpy-server was not published.'
    }

    $secondOutput = @(
        & $pwshPath -NoProfile -File $provisionScript `
            -ManifestPath $manifestPath `
            -ToolsRoot $toolsRoot `
            -ArchivePath $archivePath `
            -SkipRuntimeVerification 2>&1
    )
    if ($LASTEXITCODE -ne 0) { throw 'Repeated provisioning was not idempotent.' }

    $badManifest = Join-Path $sandbox 'bad-manifest.json'
    $manifest.tools.scrcpy.sha256 = ('0' * 64)
    [System.IO.File]::WriteAllText(
        $badManifest,
        ($manifest | ConvertTo-Json -Depth 8),
        [System.Text.UTF8Encoding]::new($false)
    )
    $badOutput = @(
        & $pwshPath -NoProfile -File $provisionScript `
            -ManifestPath $badManifest `
            -ToolsRoot (Join-Path $sandbox 'bad-tools') `
            -ArchivePath $archivePath `
            -SkipRuntimeVerification 2>&1
    )
    if ($LASTEXITCODE -eq 0) { throw 'Expected wrong SHA-256 to fail.' }
    if (($badOutput -join [Environment]::NewLine) -notmatch 'SHA-256 mismatch') {
        throw 'Wrong SHA-256 failed for an unexpected reason.'
    }

    Write-Output 'PASS: scrcpy provisioning verifies, publishes atomically, reruns idempotently, and rejects wrong hashes.'
}
finally {
    if (Test-Path -LiteralPath $sandbox) {
        Remove-Item -LiteralPath $sandbox -Recurse -Force
    }
}
