param(
    [string]$OutputRoot = "output/playwright/report-fixtures"
)

$ErrorActionPreference = "Stop"
$resolvedOutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)

npx tsx scripts/generate-report-fixtures.ts --output-root $resolvedOutputRoot
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$reports = @(Get-ChildItem -LiteralPath $resolvedOutputRoot -Filter "report.html" -File -Recurse)
if ($reports.Count -ne 3) {
    throw "Expected three deterministic report fixtures, found $($reports.Count)."
}

foreach ($report in $reports) {
    $html = Get-Content -LiteralPath $report.FullName -Raw
    if ($html -notmatch "default-src 'none'") {
        throw "Missing restrictive CSP in $($report.FullName)."
    }
    if ($html -match "<script|<link|(?:https?:|data:|javascript:)") {
        throw "External or executable markup detected in $($report.FullName)."
    }
}

$archives = @(Get-ChildItem -LiteralPath $resolvedOutputRoot -Filter "evidence.zip" -File -Recurse)
if ($archives.Count -ne 3) {
    throw "Expected three evidence ZIP fixtures, found $($archives.Count)."
}

Write-Output "Report fixtures generated and static offline checks passed: $resolvedOutputRoot"
