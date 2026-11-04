# Dot-source this script in the terminal used to build. No persistent environment changes.
param(
    [string]$SdkPath = 'E:\AndroidSdk',
    [string]$JdkPath = 'E:\Java\jdk-17',
    [string]$GradleCachePath = 'E:\AndroidGradleCache'
)
$ErrorActionPreference = 'Stop'
$taskAdb = Join-Path $SdkPath 'platform-tools\adb.exe'
$taskJava = Join-Path $JdkPath 'bin\java.exe'
if (-not (Test-Path -LiteralPath $taskAdb)) { throw "未找到 adb：$taskAdb。请接入移动硬盘并检查 SDK 路径。" }
if (-not (Test-Path -LiteralPath $taskJava) -and (Test-Path -LiteralPath $JdkPath)) {
    $taskJdkCandidates = @(Get-ChildItem -LiteralPath $JdkPath -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') })
    if ($taskJdkCandidates.Count -eq 1) {
        $JdkPath = $taskJdkCandidates[0].FullName
        $taskJava = Join-Path $JdkPath 'bin\java.exe'
    }
}
if (-not (Test-Path -LiteralPath $taskJava)) { throw "未找到 JDK：$taskJava。请先安装 JDK 17，然后通过 -JdkPath 传入实际安装目录。" }
# Java writes version info to stderr even on success. Capture it without making
# Windows PowerShell 5.1 treat normal version output as a terminating error.
$taskJavaInfo = New-Object System.Diagnostics.ProcessStartInfo
$taskJavaInfo.FileName = $taskJava
$taskJavaInfo.Arguments = '-version'
$taskJavaInfo.UseShellExecute = $false
$taskJavaInfo.CreateNoWindow = $true
$taskJavaInfo.RedirectStandardOutput = $true
$taskJavaInfo.RedirectStandardError = $true
$taskJavaProcess = New-Object System.Diagnostics.Process
$taskJavaProcess.StartInfo = $taskJavaInfo
try {
    [void]$taskJavaProcess.Start()
    $taskVersionOutput = $taskJavaProcess.StandardOutput.ReadToEndAsync()
    $taskVersionError = $taskJavaProcess.StandardError.ReadToEndAsync()
    if (-not $taskJavaProcess.WaitForExit(15000)) {
        $taskJavaProcess.Kill()
        throw 'Java版本检查超时。'
    }
    $taskVersion = $taskVersionOutput.Result + $taskVersionError.Result
    $taskJavaExitCode = $taskJavaProcess.ExitCode
} finally { $taskJavaProcess.Dispose() }
if ($taskJavaExitCode -ne 0 -or $taskVersion -notmatch 'version "17[\.\"]') {
    throw "该项目使用 JDK 17，请检查 -JdkPath。检测结果：$taskVersion"
}
$env:ANDROID_HOME = $SdkPath
# Keep the deprecated variable consistent if the parent terminal already defined it.
if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = $SdkPath }
$env:JAVA_HOME = $JdkPath
$env:GRADLE_USER_HOME = $GradleCachePath
$taskAndroidPaths = @((Join-Path $JdkPath 'bin'), (Join-Path $SdkPath 'platform-tools'), (Join-Path $SdkPath 'cmdline-tools\latest\bin'))
$env:PATH = ($taskAndroidPaths -join ';') + ';' + $env:PATH
$taskMissing = @()
foreach ($taskTool in @('build-tools\37.0.0', 'ndk\27.1.12297006', 'cmdline-tools\latest\bin\sdkmanager.bat', 'cmake\3.22.1\bin\cmake.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $SdkPath $taskTool))) { $taskMissing += $taskTool }
}
Write-Output "当前终端已配置 Android SDK：$env:ANDROID_HOME"
Write-Output "当前终端已配置 JDK：$env:JAVA_HOME"
Write-Output "Gradle 用户缓存将保存至：$env:GRADLE_USER_HOME"
Write-Output '没有修改系统或用户的永久环境变量。'
if ($taskMissing.Count) { Write-Warning ('SDK 仍需补装：' + ($taskMissing -join '、')) }
