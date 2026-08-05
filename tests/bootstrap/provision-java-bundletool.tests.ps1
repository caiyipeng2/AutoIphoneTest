$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "..\..\scripts\provision-java-bundletool.ps1"
$root = Join-Path ([System.IO.Path]::GetTempPath()) ("test-center-provision-" + [guid]::NewGuid().ToString("N"))
$cache = Join-Path $root "cache"
$tools = Join-Path $root "tools"
New-Item -ItemType Directory -Force -Path $cache | Out-Null

try {
  $javaPayload = Join-Path $root "jdk-17.0.19+10"
  New-Item -ItemType Directory -Force -Path (Join-Path $javaPayload "bin") | Out-Null
  Set-Content -LiteralPath (Join-Path $javaPayload "bin\java.exe") -Value "java" -NoNewline
  Set-Content -LiteralPath (Join-Path $javaPayload "bin\jarsigner.exe") -Value "jarsigner" -NoNewline
  $javaArchive = Join-Path $cache "java.zip"
  Compress-Archive -Path $javaPayload -DestinationPath $javaArchive
  $bundleArchive = Join-Path $cache "bundletool.jar"
  Set-Content -LiteralPath $bundleArchive -Value "bundletool" -NoNewline
  $manifestPath = Join-Path $root "manifest.json"
  $javaHash = (Get-FileHash -LiteralPath $javaArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  $bundleHash = (Get-FileHash -LiteralPath $bundleArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  $manifest = @{ schemaVersion = 1; tools = @{
      java = @{ version = "17.0.19+10"; fileName = "java.zip"; url = "https://invalid.local/java.zip"; sha256 = $javaHash; archiveRoot = "jdk-17.0.19+10"; executable = "bin/java.exe"; versionArguments = @("-version") }
      bundletool = @{ version = "1.18.3"; fileName = "bundletool.jar"; url = "https://invalid.local/bundletool.jar"; sha256 = $bundleHash; archiveRoot = "."; executable = "bundletool.jar"; versionArguments = @("version") }
    } } | ConvertTo-Json -Depth 10
  Set-Content -LiteralPath $manifestPath -Value $manifest

  & $scriptPath -ToolRoot $tools -ManifestPath $manifestPath -CacheRoot $cache -SkipDownload -SkipRuntimeVerification | Out-Null
  if (-not (Test-Path -LiteralPath (Join-Path $tools "java\17.0.19+10\bin\java.exe"))) { throw "Java was not published." }
  if (-not (Test-Path -LiteralPath (Join-Path $tools "bundletool\1.18.3\bundletool.jar"))) { throw "bundletool was not published." }

  $badManifest = $manifest -replace $javaHash, ("0" * 64)
  $badManifestPath = Join-Path $root "bad-manifest.json"
  Set-Content -LiteralPath $badManifestPath -Value $badManifest
  $failed = $false
  try { & $scriptPath -ToolRoot (Join-Path $root "bad-tools") -ManifestPath $badManifestPath -CacheRoot $cache -SkipDownload -SkipRuntimeVerification | Out-Null } catch { $failed = $true }
  if (-not $failed) { throw "Wrong SHA-256 was accepted." }
  if (Test-Path -LiteralPath (Join-Path $root "bad-tools")) { throw "Wrong hash published a tool directory." }
  Write-Output "PASS provision-java-bundletool"
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
