$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")
$venv = Join-Path $repoRoot ".venv"
if (-not (Test-Path -LiteralPath (Join-Path $venv "Scripts\python.exe"))) {
    py -3 -m venv $venv
}
$python = Join-Path $venv "Scripts\python.exe"
& $python -m pip install --disable-pip-version-check -e "$repoRoot[kernel,agents,render]"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& npm.cmd install --prefix (Join-Path $repoRoot "packages\agent-harness") --ignore-scripts --no-audit --no-fund
exit $LASTEXITCODE
