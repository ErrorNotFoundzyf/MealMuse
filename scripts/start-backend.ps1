param([int]$Port = 8000, [string]$BindAddress = '127.0.0.1')
$ErrorActionPreference = 'Stop'
$taskBackend = Join-Path (Split-Path $PSScriptRoot -Parent) 'backend'
. (Join-Path $PSScriptRoot 'PythonEnvironment.ps1')
Enable-ProjectVenv -BackendPath $taskBackend
if ($BindAddress -ne '127.0.0.1' -and $BindAddress -ne 'localhost' -and -not $env:EATING_API_TOKEN -and -not (Test-Path -LiteralPath (Join-Path $taskBackend 'auth.local.json'))) {
    throw '局域网访问请先设置 EATING_API_TOKEN，并在 App 家庭设置中填写相同凭证。'
}
Push-Location $taskBackend
try {
    & '.\.venv\Scripts\python.exe' -m uvicorn app.main:app --host $BindAddress --port $Port
    if ($LASTEXITCODE -ne 0) { throw '后端启动失败。' }
} finally { Pop-Location }
