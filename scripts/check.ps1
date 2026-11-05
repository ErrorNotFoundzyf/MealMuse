$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskBackend = Join-Path $taskRoot 'backend'
. (Join-Path $PSScriptRoot 'PythonEnvironment.ps1')
Enable-ProjectVenv -BackendPath $taskBackend
Push-Location $taskBackend
try {
    $taskRunsRoot = Join-Path $taskRoot '.cache\test-runs'
    [System.IO.Directory]::CreateDirectory($taskRunsRoot) | Out-Null
    $taskTestTemp = Join-Path $taskRoot ('.cache\test-runs\' + [guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $taskTestTemp) { throw '测试临时目录已存在，请重试。' }
    & '.\.venv\Scripts\python.exe' -m pytest -q -p no:cacheprovider --basetemp $taskTestTemp
    if ($LASTEXITCODE -ne 0) { throw '后端测试未通过。' }
} finally { Pop-Location }
Push-Location (Join-Path $taskRoot 'mobile')
try {
    npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Android 客户端类型检查未通过。' }
} finally { Pop-Location }
