param(
    [Parameter(Mandatory = $true)]
    [string]$LiteralPath
)

$ErrorActionPreference = 'Stop'

$item = Get-Item -LiteralPath $LiteralPath
$productVersion = $item.VersionInfo.ProductVersion
if ([string]::IsNullOrWhiteSpace($productVersion)) {
    throw "No product version is available for '$LiteralPath'."
}

Write-Output $productVersion
