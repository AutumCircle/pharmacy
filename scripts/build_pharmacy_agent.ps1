param(
    [string]$Python38 = "$env:LOCALAPPDATA\Programs\Python\Python38\python.exe"
)

# Builds pharmacy_agent.exe (Oracle mirror agent) for the Windows 7 pharmacy computer.
# Oracle XE on the pharmacy computer is 64-bit, so a 64-bit Python 3.8 is required.

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$agentRoot = Join-Path $projectRoot "backend\pharmacy_agent"
$venvPath = Join-Path $projectRoot "build\pharmacy-agent-py38-venv"
$workPath = Join-Path $projectRoot "build\pyinstaller-pharmacy-agent"
$distPath = Join-Path $projectRoot "output\pharmacy-agent"
$zipPath = Join-Path $projectRoot "output\pharmacy-agent-win7-py38.zip"

if (-not (Test-Path -LiteralPath $Python38)) {
    throw "Python 3.8 was not found at: $Python38"
}
$pythonVersion = & $Python38 -c "import sys; print('.'.join(map(str, sys.version_info[:3])))"
if (-not $pythonVersion.StartsWith("3.8.")) {
    throw "The pharmacy agent must be built with Python 3.8, found: $pythonVersion"
}
$pointerBits = & $Python38 -c "import struct; print(struct.calcsize('P') * 8)"
if ($pointerBits -ne "64") {
    throw "64-bit Python 3.8 is required to match 64-bit Oracle XE, found $pointerBits-bit"
}

if (-not (Test-Path -LiteralPath $venvPath)) {
    & $Python38 -m venv $venvPath
}
$venvPython = Join-Path $venvPath "Scripts\python.exe"
& $venvPython -m pip install --disable-pip-version-check -r (Join-Path $agentRoot "requirements-win7.txt")
& $venvPython -m PyInstaller --noconfirm --clean --onefile --noconsole `
    --name pharmacy_agent `
    --distpath $distPath `
    --workpath $workPath `
    --specpath $workPath `
    (Join-Path $agentRoot "pharmacy_agent.py")

$builtExe = Join-Path $distPath "pharmacy_agent.exe"
if (-not (Test-Path -LiteralPath $builtExe)) {
    throw "PyInstaller did not create pharmacy_agent.exe"
}
foreach ($file in @("config.example.json", "create_site_reader.sql", "install_task.bat", "INSTALL_RU.md")) {
    Copy-Item -LiteralPath (Join-Path $agentRoot $file) -Destination $distPath -Force
}
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $distPath "*") -DestinationPath $zipPath -CompressionLevel Optimal

$hash = (Get-FileHash -LiteralPath $builtExe -Algorithm SHA256).Hash
Write-Output "Python: $pythonVersion ($pointerBits-bit)"
Write-Output "Executable: $builtExe"
Write-Output "ZIP: $zipPath"
Write-Output "SHA256: $hash"
