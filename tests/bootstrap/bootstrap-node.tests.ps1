$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$bootstrapScript = Join-Path $repositoryRoot 'scripts\bootstrap-node.ps1'
$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ('test-center-bootstrap-' + [guid]::NewGuid().ToString('N'))
$toolsRoot = Join-Path $sandbox 'tools'
$runtimePath = Join-Path $toolsRoot 'node\22.23.1'

New-Item -ItemType Directory -Path $sandbox | Out-Null

try {
    $fixtureRoot = Join-Path $sandbox 'fixture\node-v22.23.1-win-x64'
    New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
    [System.IO.File]::WriteAllText(
        (Join-Path $fixtureRoot 'node.exe'),
        'This is intentionally not a Node runtime.',
        [System.Text.UTF8Encoding]::new($false)
    )

    $archivePath = Join-Path $sandbox 'node-v22.23.1-win-x64.zip'
    Compress-Archive -LiteralPath $fixtureRoot -DestinationPath $archivePath -CompressionLevel NoCompression

    $manifestPath = Join-Path $sandbox 'tool-manifest.json'
    $manifest = @{
        schemaVersion = 1
        tools = @{
            node = @{
                version = '22.23.1'
                platform = 'win-x64'
                fileName = 'node-v22.23.1-win-x64.zip'
                url = 'https://example.invalid/node-v22.23.1-win-x64.zip'
                sha256 = ('0' * 64)
                archiveRoot = 'node-v22.23.1-win-x64'
                executable = 'node.exe'
                versionArguments = @('--version')
                expectedVersion = 'v22.23.1'
                licenseUrl = 'https://github.com/nodejs/node/blob/v22.23.1/LICENSE'
            }
        }
    }
    [System.IO.File]::WriteAllText(
        $manifestPath,
        ($manifest | ConvertTo-Json -Depth 8),
        [System.Text.UTF8Encoding]::new($false)
    )

    $scriptWasMissing = -not (Test-Path -LiteralPath $bootstrapScript -PathType Leaf)
    $pwshPath = (Get-Process -Id $PID).Path
    $bootstrapOutput = @(
        & $pwshPath -NoProfile -File $bootstrapScript `
            -ManifestPath $manifestPath `
            -ToolsRoot $toolsRoot `
            -ArchivePath $archivePath 2>&1
    )
    $bootstrapExitCode = $LASTEXITCODE

    if ($bootstrapExitCode -eq 0) {
        throw 'Expected the deliberately invalid archive hash to fail.'
    }
    if (Test-Path -LiteralPath $runtimePath) {
        throw "Failed bootstrap published a runtime directory: $runtimePath"
    }
    if ($scriptWasMissing) {
        throw "Bootstrap script is missing after the expected nonzero invocation; no runtime was published: $bootstrapScript"
    }

    $combinedOutput = $bootstrapOutput -join [Environment]::NewLine
    if ($combinedOutput -notmatch 'SHA-256 mismatch') {
        throw "Bootstrap failed for an unexpected reason. Output: $combinedOutput"
    }

    Write-Output 'PASS: invalid SHA-256 rejected without publishing the Node runtime.'
}
finally {
    if (Test-Path -LiteralPath $sandbox) {
        Remove-Item -LiteralPath $sandbox -Recurse -Force
    }
}
