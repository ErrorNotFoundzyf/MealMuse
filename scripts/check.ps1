$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskBackend = Join-Path $taskRoot 'backend'
. (Join-Path $PSScriptRoot 'PythonEnvironment.ps1')
Enable-ProjectVenv -BackendPath $taskBackend
Push-Location $taskBackend
try {
    & '.\.venv\Scripts\python.exe' -m pytest -q
    if ($LASTEXITCODE -ne 0) { throw '后端测试未通过。' }
} finally { Pop-Location }
Push-Location (Join-Path $taskRoot 'mobile')
try {
    npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Android 客户端类型检查未通过。' }
} finally { Pop-Location }
