param(
    [string]$Python38 = "$env:LOCALAPPDATA\Programs\Python\Python38\python.exe"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPath = Join-Path $projectRoot "build\agent-sync-win7-py38-venv"
$sourcePath = Join-Path $projectRoot "backend\local-agent\agent.py"
$requirementsPath = Join-Path $projectRoot "backend\local-agent\requirements-win7.txt"
$workPath = Join-Path $projectRoot "build\pyinstaller-agent-win7-py38"
$distPath = Join-Path $projectRoot "output\agent-sync-win7-py38-20260902"
$zipPath = Join-Path $projectRoot "output\agent_sync-win7-py38-20260902.zip"

if (-not (Test-Path -LiteralPath $Python38)) {
    throw "Python 3.8 was not found at: $Python38"
}

$pythonVersion = & $Python38 -c "import sys; print('.'.join(map(str, sys.version_info[:3])))"
if (-not $pythonVersion.StartsWith("3.8.")) {
    throw "The Win7 agent must be built with Python 3.8, found: $pythonVersion"
}

if (-not (Test-Path -LiteralPath $venvPath)) {
    & $Python38 -m venv $venvPath
}

$venvPython = Join-Path $venvPath "Scripts\python.exe"
& $venvPython -m pip install --disable-pip-version-check -r $requirementsPath
& $venvPython -m PyInstaller --noconfirm --clean --onefile --noconsole `
    --name agent_sync `
    --distpath $distPath `
    --workpath $workPath `
    --specpath $workPath `
    $sourcePath

$builtExe = Join-Path $distPath "agent_sync.exe"
if (-not (Test-Path -LiteralPath $builtExe)) {
    throw "PyInstaller did not create agent_sync.exe"
}

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -LiteralPath $builtExe -DestinationPath $zipPath -CompressionLevel Optimal

$hash = (Get-FileHash -LiteralPath $builtExe -Algorithm SHA256).Hash
Write-Output "Python: $pythonVersion"
Write-Output "Executable: $builtExe"
Write-Output "ZIP: $zipPath"
Write-Output "SHA256: $hash"
