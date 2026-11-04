param(
    [string]$DeviceId = '',
    [int]$MetroPort = 8081,
    [int]$ApiPort = 8000
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'android-env.ps1')
$taskAdb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
$taskDeviceArgs = @()
if ($DeviceId) { $taskDeviceArgs = @('-s', $DeviceId) }
$taskDeviceState = (& $taskAdb @taskDeviceArgs get-state 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $taskDeviceState -ne 'device') {
    throw '未找到唯一已授权手机。请连接USB并允许调试；多设备时通过-DeviceId指定adb devices显示的序列号。'
}
foreach ($taskPort in @($MetroPort, $ApiPort)) {
    & $taskAdb @taskDeviceArgs reverse "tcp:$taskPort" "tcp:$taskPort"
    if ($LASTEXITCODE -ne 0) { throw "USB端口映射失败：$taskPort" }
}
$env:EXPO_PUBLIC_API_URL = "http://127.0.0.1:$ApiPort"
$env:EXPO_PUBLIC_ALLOW_HTTP = '1'
$env:EXPO_NO_TELEMETRY = '1'
Write-Output "USB已映射开发端口与API端口。请另开终端运行 scripts/start-backend.ps1 -Port $ApiPort。"
Write-Output "App服务地址使用 http://127.0.0.1:$ApiPort；此前保存过其他地址时请在App家庭设置中更改。"
Write-Output '请保持USB连接和本终端运行，随后打开已安装的调试App。'
Push-Location (Join-Path $taskRoot 'mobile')
try {
    npx.cmd expo start --localhost --port $MetroPort
    if ($LASTEXITCODE -ne 0) { throw 'Metro开发服务启动失败。' }
} finally { Pop-Location }
