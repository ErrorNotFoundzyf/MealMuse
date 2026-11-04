param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'PythonEnvironment.ps1')
$taskPythonCommand = (Get-Command $Python -ErrorAction Stop).Source
Enable-ProjectPython -PythonHome (Split-Path $taskPythonCommand -Parent)
$env:UV_CACHE_DIR = Join-Path $taskRoot '.cache\uv'
Push-Location (Join-Path $taskRoot 'backend')
try {
    uv sync --frozen --group dev --python $taskPythonCommand --no-managed-python
    if ($LASTEXITCODE -ne 0) { throw '后端依赖安装失败。' }
} finally { Pop-Location }
