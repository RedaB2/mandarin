# PowerShell version for Windows
Set-Location -Path $PSScriptRoot

Set-Location frontend
npm install
npm run build
Set-Location ..

if (-not (Test-Path "venv")) {
    python -m venv venv
}

& .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
