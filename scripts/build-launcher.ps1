$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
dotnet build (Join-Path $projectRoot "apps\launcher\src\TestCenter.Launcher\TestCenter.Launcher.csproj") -c Release
