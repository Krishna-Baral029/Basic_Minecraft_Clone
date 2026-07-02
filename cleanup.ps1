# ================================================================
# Claude Code — Full Find & Delete
# Save as cleanup-claude.ps1 and run with: .\cleanup-claude.ps1
# ================================================================

$WhatIfMode = $false   # <-- leave as $true, review the list, then set to $false and re-run

Write-Host "=== Step 1: Stopping Claude processes ===" -ForegroundColor Cyan
Get-Process | Where-Object { $_.ProcessName -match "^claude$|Claude Nest|AnthropicClaude" } | ForEach-Object {
    Write-Host "Killing: $($_.ProcessName) (PID $($_.Id))"
    if (-not $WhatIfMode) { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
}

Write-Host "`n=== Step 2: Uninstalling via package managers ===" -ForegroundColor Cyan
if (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host "Running npm uninstall..."
    if (-not $WhatIfMode) { npm uninstall -g @anthropic-ai/claude-code 2>$null }
}
if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "Running winget uninstall..."
    if (-not $WhatIfMode) { winget uninstall Anthropic.ClaudeCode --silent 2>$null }
}

Write-Host "`n=== Step 3: Deleting known fixed paths ===" -ForegroundColor Cyan
$knownPaths = @(
    "$env:USERPROFILE\.claude",
    "$env:USERPROFILE\.claude.json",
    "$env:USERPROFILE\.claude.json.backup",
    "$env:LOCALAPPDATA\Claude Nest-3p",
    "$env:LOCALAPPDATA\Claude-3p",
    "$env:LOCALAPPDATA\claude-cli-nodejs",
    "$env:LOCALAPPDATA\Packages\Claude_pzs8sxrjxfjjc",
    "$env:LOCALAPPDATA\Temp\claude",
    "$env:APPDATA\Microsoft\Windows\Recent\.claude.lnk",
    "$env:APPDATA\npm\claude.ps1",
    "$env:APPDATA\npm\claude.cmd",
    "$env:APPDATA\npm\claude",
    "$env:APPDATA\npm\node_modules\@anthropic-ai\claude-code"
)

foreach ($p in $knownPaths) {
    if (Test-Path $p) {
        if ($WhatIfMode) {
            Write-Host "[WOULD DELETE] $p" -ForegroundColor Yellow
        } else {
            Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "Deleted: $p" -ForegroundColor Green
        }
    }
}

Write-Host "`n=== Step 4: Searching for VS Code extensions ===" -ForegroundColor Cyan
$vscodeExtRoots = @(
    "$env:USERPROFILE\.vscode\extensions",
    "$env:APPDATA\Code\CachedExtensionVSIXs"
) | Where-Object { Test-Path $_ }

$extItems = foreach ($root in $vscodeExtRoots) {
    Get-ChildItem -Path $root -Directory -Filter "anthropic.claude-code-*" -ErrorAction SilentlyContinue
}

foreach ($item in $extItems) {
    if ($WhatIfMode) {
        Write-Host "[WOULD DELETE] $($item.FullName)" -ForegroundColor Yellow
    } else {
        Remove-Item -Path $item.FullName -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Deleted: $($item.FullName)" -ForegroundColor Green
    }
}

Write-Host "`n=== Step 5: Cleaning SquirrelTemp installer leftovers ===" -ForegroundColor Cyan
if (Test-Path "$env:LOCALAPPDATA\SquirrelTemp") {
    $nuspecFiles = Get-ChildItem "$env:LOCALAPPDATA\SquirrelTemp" -Recurse -Filter "AnthropicClaude.nuspec" -ErrorAction SilentlyContinue
    foreach ($f in $nuspecFiles) {
        if ($WhatIfMode) {
            Write-Host "[WOULD DELETE] $($f.FullName)" -ForegroundColor Yellow
        } else {
            Remove-Item -Path $f.FullName -Force -ErrorAction SilentlyContinue
            Write-Host "Deleted: $($f.FullName)" -ForegroundColor Green
        }
    }
}

Write-Host "`n=== Step 6: Broader safety-net scan (excludes Cline/other tools) ===" -ForegroundColor Cyan
$searchRoots = @(
    "$env:USERPROFILE",
    "$env:LOCALAPPDATA",
    "$env:APPDATA"
) | Where-Object { Test-Path $_ }

$excludePatterns = @(
    "saoudrizwan\.claude-dev",   # Cline extension, different tool
    "\\Chrome\\", "\\Edge\\", "\\Firefox\\",
    "\.cursor\\extensions", "\.trae\\extensions", "\.windsurf\\extensions"  # third-party IDE extension caches
)

$extraFound = foreach ($root in $searchRoots) {
    Get-ChildItem -Path $root -Recurse -Force -Depth 3 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -match "claude" -and
            $_.Name -notmatch "claude-dev" -and
            -not ($excludePatterns | Where-Object { $_ -and $_ -match [regex]::Escape($_) -or $_ } | ForEach-Object { $_ } | Where-Object { $item = $_; $false }) 
        }
}

# Simpler, reliable exclusion filter (regex above is overcomplicated — replaced below)
$extraFound = foreach ($root in $searchRoots) {
    Get-ChildItem -Path $root -Recurse -Force -Depth 3 -ErrorAction SilentlyContinue |
        Where-Object {
            $full = $_.FullName
            $_.Name -match "claude" -and
            $full -notmatch "saoudrizwan\.claude-dev" -and
            $full -notmatch "\\(Chrome|Edge|Firefox)\\" -and
            $full -notmatch "\\(\.cursor|\.trae|\.windsurf)\\extensions"
        }
}

$extraFound = $extraFound | Sort-Object FullName -Unique
Write-Host "Found $($extraFound.Count) additional item(s) not covered above:"
$extraFound | ForEach-Object { Write-Host $_.FullName }

if (-not $WhatIfMode -and $extraFound.Count -gt 0) {
    foreach ($item in $extraFound) {
        try {
            Remove-Item -Path $item.FullName -Recurse -Force -ErrorAction Stop
            Write-Host "Deleted: $($item.FullName)" -ForegroundColor Green
        } catch {
            Write-Host "Could not delete: $($item.FullName)" -ForegroundColor DarkYellow
        }
    }
}

Write-Host "`n=== Step 7: Verification ===" -ForegroundColor Cyan
if ($WhatIfMode) {
    Write-Host "[DRY RUN] Nothing deleted. Review the list, set `$WhatIfMode = `$false`, and re-run." -ForegroundColor Cyan
} else {
    $c = Get-Command claude -ErrorAction SilentlyContinue
    if ($c) {
        Write-Host "claude still resolvable at: $($c.Source)" -ForegroundColor Red
        Write-Host "Delete that file manually or tell me the path and I'll add it." -ForegroundColor Red
    } else {
        Write-Host "claude fully removed. Clean slate." -ForegroundColor Green
    }
}