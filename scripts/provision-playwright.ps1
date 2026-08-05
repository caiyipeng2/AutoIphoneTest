$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$browserRoot = Join-Path $projectRoot "data\tools\ms-playwright"
New-Item -ItemType Directory -Force $browserRoot | Out-Null
$env:PLAYWRIGHT_BROWSERS_PATH = $browserRoot
& (Join-Path $projectRoot "tools\node\22.23.1\npx.cmd") playwright install chromium
