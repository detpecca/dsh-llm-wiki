<#
.SYNOPSIS
    One-command installer for @detpecca/dsh-llm-wiki (Windows / PowerShell).

    Creates a uv venv, installs the LLM-Wiki Python engine into it, adds this
    plugin to a dsh profile, and writes a configured `llm-wiki` row into the
    profile's cordis.patch.yml (API key included when -ApiKey is given).

.EXAMPLE
    # Local checkout of the engine as a sibling directory, wiki at D:\kb:
    .\scripts\install.ps1 -WikiPath D:\kb

.EXAMPLE
    # Everything explicit, engine from GitHub, key stored in the patch file:
    .\scripts\install.ps1 -WikiPath D:\kb -ApiKey sk-xxx -Profile web

.PARAMETER EngineRepo
    Local LLM-Wiki checkout to install with `uv pip install -e`. Defaults to
    the sibling directory ..\LLM-Wiki of this repo; when it does not exist the
    engine is installed from github.com/detpecca/LLM-Wiki.git instead.

.PARAMETER WikiPath
    Your knowledge base root directory (stored as an absolute path).

.PARAMETER ApiKey
    LLM API key used by wiki_ingest (the compile pipeline). Optional now;
    without it ingest will fail with a clear error. Stored in your private
    profile patch file — do not commit it to git.

.PARAMETER BaseUrl
    OpenAI-compatible endpoint. Default: https://api.moonshot.cn/v1

.PARAMETER Model
    Default: kimi-k2-0711-preview

.PARAMETER Profile
    dsh profile to install into. Default: web

.PARAMETER DshRoot
    DeepSeek Harness checkout root, used to run `pnpm dsh` when the `dsh`
    command is not on PATH. Default: D:\ByteDance\deepseek-harness
#>
param(
    [string]$EngineRepo = '',
    [string]$WikiPath = './wiki',
    [string]$ApiKey = '',
    [string]$BaseUrl = 'https://api.moonshot.cn/v1',
    [string]$Model = 'kimi-k2-0711-preview',
    [string]$Profile = 'web',
    [string]$DshRoot = ''
)
$ErrorActionPreference = 'Stop'

$pluginDir = Split-Path -Parent $PSScriptRoot
Write-Host "== dsh-llm-wiki installer ==" -ForegroundColor Cyan

# ---- 1. uv ----
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw 'uv was not found on PATH. Install it first: https://docs.astral.sh/uv/#installation (e.g. winget install astral-sh.uv)'
}
Write-Host "uv: $(uv --version)"

# ---- 2. engine source ----
if (-not $EngineRepo) { $EngineRepo = Join-Path (Split-Path -Parent $pluginDir) 'LLM-Wiki' }
$engineFromGit = -not (Test-Path (Join-Path $EngineRepo 'pyproject.toml'))
if ($engineFromGit) {
    Write-Host "engine: no local checkout at $EngineRepo — installing from GitHub" -ForegroundColor Yellow
}

# ---- 3. venv ----
if ($engineFromGit) {
    $venv = Join-Path $HOME '.dsh-llm-wiki\.venv'
} else {
    $venv = Join-Path $EngineRepo '.venv'
}
$venvPython = Join-Path $venv 'Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    Write-Host "creating venv: $venv"
    uv venv $venv
} else {
    Write-Host "venv already exists: $venv"
}

# ---- 4. install engine into the venv ----
if ($engineFromGit) {
    uv pip install --python $venvPython 'git+https://github.com/detpecca/LLM-Wiki.git'
} else {
    uv pip install --python $venvPython -e $EngineRepo
}
Write-Host "engine installed into: $venvPython"

# ---- 5. add the plugin to the dsh profile ----
$dshCmd = Get-Command dsh -ErrorAction SilentlyContinue
if ($dshCmd) {
    & $dshCmd.Source plugin --profile $Profile add $pluginDir
    if ($LASTEXITCODE -ne 0) { throw 'dsh plugin add failed' }
} else {
    if (-not $DshRoot) { $DshRoot = 'D:\ByteDance\deepseek-harness' }
    if (-not (Test-Path (Join-Path $DshRoot 'package.json'))) {
        throw "dsh is not on PATH and DshRoot '$DshRoot' has no package.json — pass -DshRoot"
    }
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw 'pnpm was not found on PATH and dsh is not on PATH either'
    }
    Push-Location $DshRoot
    try {
        pnpm dsh plugin --profile $Profile add $pluginDir
        if ($LASTEXITCODE -ne 0) { throw 'dsh plugin add failed' }
    } finally { Pop-Location }
}

# ---- 6. write/merge the llm-wiki row into the profile patch ----
$profileDir = Join-Path $HOME ".dsh\profiles\$Profile"
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
if (-not (Test-Path $profileDir)) { New-Item -ItemType Directory -Path $profileDir | Out-Null }

$wikiAbs = if ([System.IO.Path]::IsPathRooted($WikiPath)) { $WikiPath }
           else { (Join-Path (Get-Location) $WikiPath) }
$cwdVal = if ($engineFromGit) { '' } else { $EngineRepo }

$row = "- id: llm-wiki`n  config:`n    wikiPath: $wikiAbs`n    pythonPath: $venvPython`n    cwd: $cwdVal`n"
if ($ApiKey)  { $row += "    llmWikiApiKey: $ApiKey`n" }
if ($BaseUrl) { $row += "    llmWikiBaseUrl: $BaseUrl`n" }
if ($Model)   { $row += "    llmWikiModel: $Model`n" }

$content = ''
if (Test-Path $patchPath) { $content = Get-Content $patchPath -Raw }
$content = [regex]::Replace($content, '(?ms)^- id: llm-wiki\b.*?(?=^- |\z)', '')
$trimmed = $content.Trim()
if ($trimmed -eq '' -or $trimmed -eq '[]') {
    $newContent = $row
} else {
    $newContent = $trimmed + "`n" + $row
}
Set-Content -Path $patchPath -Value $newContent -Encoding utf8
Write-Host "profile patch written: $patchPath" -ForegroundColor Green

# ---- 7. summary ----
Write-Host ''
Write-Host '== done ==' -ForegroundColor Green
Write-Host "  plugin : $pluginDir (added to profile '$Profile')"
Write-Host "  engine : $($(if ($engineFromGit) { 'github.com/detpecca/LLM-Wiki.git' } else { $EngineRepo }))"
Write-Host "  python : $venvPython"
Write-Host "  wiki   : $wikiAbs"
if ($ApiKey) {
    Write-Host '  note   : the API key is stored in the patch file above (plaintext in your private $HOME).'
}
Write-Host ''
Write-Host 'Next: restart DSH (stop and start `dsh web`), then wiki_search / wiki_read /'
Write-Host 'wiki_stats / wiki_validate / wiki_errorbook / wiki_ingest become available.'
