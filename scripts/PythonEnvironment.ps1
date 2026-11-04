function Enable-ProjectPython {
    param([string]$PythonHome)
    $taskPythonPaths = @($PythonHome, (Join-Path $PythonHome 'Library\bin'), (Join-Path $PythonHome 'DLLs')) | Where-Object { Test-Path -LiteralPath $_ }
    $env:PATH = ($taskPythonPaths -join ';') + ';' + $env:PATH
}

function Enable-ProjectVenv {
    param([string]$BackendPath)
    $taskConfig = Join-Path $BackendPath '.venv\pyvenv.cfg'
    if (-not (Test-Path -LiteralPath $taskConfig)) { throw '请先运行 scripts/setup-backend.ps1 创建项目环境。' }
    $taskHome = Get-Content -LiteralPath $taskConfig | Where-Object { $_ -match '^home\s*=' } | Select-Object -First 1
    if ($taskHome) { Enable-ProjectPython -PythonHome (($taskHome -split '=', 2)[1].Trim()) }
}
