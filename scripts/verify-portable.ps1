[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PortableRoot,
    [string]$NodePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [System.IO.Path]::GetFullPath($PortableRoot)
if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Portable root does not exist: $root" }
$manifestPath = Join-Path $root 'manifest.sha256.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'manifest.sha256.json is missing.' }
# The manifest is UTF-8 and can contain legitimate Unicode fixture paths. An
# explicit encoding keeps Windows PowerShell from decoding those names using
# the active system code page before LiteralPath receives them.
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($entry in @($manifest.files)) {
    $path = Join-Path $root ($entry.path.Replace('/', '\'))
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Manifest file is missing: $($entry.path)" }
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne ([string]$entry.sha256).ToLowerInvariant()) { throw "Manifest hash mismatch: $($entry.path)" }
    if ((Get-Item -LiteralPath $path).Length -ne [int64]$entry.size) { throw "Manifest size mismatch: $($entry.path)" }
}
$runtimeNode = if ($NodePath) { [System.IO.Path]::GetFullPath($NodePath) } else { Join-Path $root 'tools\node\22.23.1\node.exe' }
if (-not (Test-Path -LiteralPath $runtimeNode -PathType Leaf)) { throw "Portable Node is missing: $runtimeNode" }
$version = (& $runtimeNode '--version' 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $version -ne 'v22.23.1') { throw "Portable Node version mismatch: $version" }
Write-Output ([pscustomobject]@{ root = $root; files = @($manifest.files).Count; node = $version; verifiedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress)
