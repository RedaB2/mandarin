# Legacy compatibility wrapper
$rootDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location -Path $rootDir

Write-Host "update-app.ps1 is deprecated; forwarding to python run.py"
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCmd) {
    & python .\run.py @args
    exit $LASTEXITCODE
}

$python3Cmd = Get-Command python3 -ErrorAction SilentlyContinue
if ($python3Cmd) {
    & python3 .\run.py @args
    exit $LASTEXITCODE
}

Write-Error "Neither python nor python3 is available in PATH."
exit 1
