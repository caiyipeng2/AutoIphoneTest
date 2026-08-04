[CmdletBinding()]
param(
  [string]$ToolRoot = (Join-Path $PSScriptRoot "..\tools"),
  [string]$ManifestPath = (Join-Path $PSScriptRoot "..\tools\tool-manifest.json"),
  [string]$CacheRoot = (Join-Path $PSScriptRoot "..\tools\cache"),
  [switch]$SkipDownload,
  [switch]$SkipRuntimeVerification
)

$ErrorActionPreference = "Stop"

function Get-ToolEntry([object]$Manifest, [string]$Name) {
  $entry = $Manifest.tools.$Name
  if ($null -eq $entry) { throw "Tool '$Name' is missing from the manifest." }
  return $entry
}

function Get-VerifiedCacheFile([object]$Entry) {
  New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
  $archivePath = Join-Path $CacheRoot $Entry.fileName
  if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    if ($SkipDownload) { throw "Cached file '$archivePath' is missing." }
    Invoke-WebRequest -Uri $Entry.url -OutFile $archivePath
  }
  $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Entry.sha256.ToLowerInvariant()) {
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    throw "SHA-256 mismatch for '$($Entry.fileName)'."
  }
  return $archivePath
}

function Publish-Java([object]$Entry, [string]$ArchivePath) {
  $destination = Join-Path $ToolRoot (Join-Path "java" $Entry.version)
  $executable = Join-Path $destination $Entry.executable.Replace('/', '\')
  if (Test-Path -LiteralPath $executable -PathType Leaf) { return $executable }
  $partial = "$destination.partial"
  Remove-Item -LiteralPath $partial -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $partial | Out-Null
  try {
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $partial -Force
    $root = Join-Path $partial $Entry.archiveRoot
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Java archive root is missing." }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Move-Item -LiteralPath $root -Destination $destination
  } finally {
    Remove-Item -LiteralPath $partial -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Java executable was not published." }
  return $executable
}

function Publish-Bundletool([object]$Entry, [string]$ArchivePath) {
  $destination = Join-Path $ToolRoot (Join-Path "bundletool" $Entry.version)
  $executable = Join-Path $destination $Entry.executable
  if (Test-Path -LiteralPath $executable -PathType Leaf) { return $executable }
  $partial = "$destination.partial"
  Remove-Item -LiteralPath $partial -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $partial | Out-Null
  try {
    Copy-Item -LiteralPath $ArchivePath -Destination (Join-Path $partial $Entry.executable)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Move-Item -LiteralPath $partial -Destination $destination
  } finally {
    Remove-Item -LiteralPath $partial -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "bundletool was not published." }
  return $executable
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$javaEntry = Get-ToolEntry $manifest "java"
$bundletoolEntry = Get-ToolEntry $manifest "bundletool"
$javaArchive = Get-VerifiedCacheFile $javaEntry
$bundletoolArchive = Get-VerifiedCacheFile $bundletoolEntry
$javaPath = Publish-Java $javaEntry $javaArchive
$bundletoolPath = Publish-Bundletool $bundletoolEntry $bundletoolArchive

if (-not $SkipRuntimeVerification) {
  & $javaPath @($javaEntry.versionArguments) 2>&1 | Out-String | Write-Verbose
  if ($LASTEXITCODE -ne 0) { throw "java.exe version check failed." }
  $jarsignerPath = Join-Path (Split-Path -Parent $javaPath) "jarsigner.exe"
  & $jarsignerPath @("-help") 2>&1 | Out-String | Write-Verbose
  if ($LASTEXITCODE -ne 0) { throw "jarsigner.exe check failed." }
  & $javaPath @("-jar", $bundletoolPath) @($bundletoolEntry.versionArguments) 2>&1 | Out-String | Write-Verbose
  if ($LASTEXITCODE -ne 0) { throw "bundletool version check failed." }
}

[pscustomobject]@{
  javaPath = $javaPath
  bundletoolPath = $bundletoolPath
  toolRoot = (Resolve-Path -LiteralPath $ToolRoot).Path
}
