$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:TEST_CENTER_SERVER_PORT = if ($env:TEST_CENTER_SERVER_PORT) { $env:TEST_CENTER_SERVER_PORT } else { "4780" }
$env:TEST_CENTER_CONSOLE_DIST = Join-Path $projectRoot "apps\console\dist"
$node = if ($env:TEST_CENTER_NODE_PATH) {
  $env:TEST_CENTER_NODE_PATH
} else {
  Join-Path $projectRoot "tools\node\22.23.1\node.exe"
}
$entry = Join-Path $projectRoot "apps\server\dist\dev.js"
if (!(Test-Path $node)) {
  $fallbackNode = Get-Command node -ErrorAction SilentlyContinue
  if ($fallbackNode -eq $null) { throw "Node runtime is missing: $node" }
  $node = $fallbackNode.Source
}
if (!(Test-Path $entry)) { throw "Server dist is missing. Run npm run typecheck first: $entry" }
if (!(Test-Path (Join-Path $env:TEST_CENTER_CONSOLE_DIST "index.html"))) { throw "Console dist is missing. Run npm run build --workspace @test-center/console first." }
& $node $entry
