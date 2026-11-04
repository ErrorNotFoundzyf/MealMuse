param(
    [string]$SdkPath = 'E:\AndroidSdk',
    [string]$JdkPath = 'E:\Java\jdk-17',
    [string]$GradleCachePath = 'E:\AndroidGradleCache',
    [ValidatePattern('^(arm64-v8a|armeabi-v7a|x86_64|x86)(,(arm64-v8a|armeabi-v7a|x86_64|x86))*$')]
    [string]$Architectures = 'arm64-v8a',
    [switch]$UseSystemProxy,
    [switch]$SkipPrebuild,
    [switch]$UseAliyunMirror
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'android-env.ps1') -SdkPath $SdkPath -JdkPath $JdkPath -GradleCachePath $GradleCachePath
foreach ($taskRequired in @('build-tools\37.0.0', 'ndk\27.1.12297006', 'cmake\3.22.1\bin\cmake.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $SdkPath $taskRequired))) { throw "构建前请补装SDK工具：$taskRequired" }
}
$taskGradleArgs = @(':app:assembleDebug', "-PreactNativeArchitectures=$Architectures", '--console=plain', '--no-daemon', '--max-workers=2', '--no-parallel', '-Dorg.gradle.internal.http.connectionTimeout=15000', '-Dorg.gradle.internal.http.socketTimeout=30000')
if ($UseAliyunMirror) {
    $taskGradleArgs += @('--init-script', (Join-Path $PSScriptRoot 'maven-mirror.init.gradle'))
    Write-Output '本次构建使用阿里云公开Maven镜像；保持HTTPS，不修改全局仓库设置，不上传源码。'
}
if ($UseSystemProxy) {
    $taskEndpoint = [uri]'https://services.gradle.org/'
    $taskProxy = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy($taskEndpoint)
    if ($taskProxy -and $taskProxy.Authority -ne $taskEndpoint.Authority) {
        if ($taskProxy.UserInfo) { throw '当前代理需要身份信息，请在私有Gradle配置中设置，不要将代理密码写入项目脚本。' }
        $env:HTTPS_PROXY = $taskProxy.AbsoluteUri
        $env:HTTP_PROXY = $taskProxy.AbsoluteUri
        $taskProxyOptions = "-Dhttps.proxyHost=$($taskProxy.Host) -Dhttps.proxyPort=$($taskProxy.Port) -Dhttp.proxyHost=$($taskProxy.Host) -Dhttp.proxyPort=$($taskProxy.Port)"
        $env:GRADLE_OPTS = "$env:GRADLE_OPTS $taskProxyOptions"
        $taskGradleArgs += @("-Dhttps.proxyHost=$($taskProxy.Host)", "-Dhttps.proxyPort=$($taskProxy.Port)", "-Dhttp.proxyHost=$($taskProxy.Host)", "-Dhttp.proxyPort=$($taskProxy.Port)")
        # Set proxy properties at daemon startup as well: HTTP services may be created
        # before per-build system properties are applied to the daemon process.
        $taskJvmArgs = '-Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8'
        $taskGradleArgs += "-Dorg.gradle.jvmargs=$taskJvmArgs $taskProxyOptions"
    }
}
# Explicit internal development build; does not enable HTTP for public production builds.
$env:EATING_ALLOW_HTTP = '1'
$env:EXPO_PUBLIC_ALLOW_HTTP = '1'
$env:EXPO_NO_TELEMETRY = '1'
Push-Location (Join-Path $taskRoot 'mobile')
try {
    if (-not $SkipPrebuild) {
        npx.cmd expo prebuild --platform android --no-install
        if ($LASTEXITCODE -ne 0) { throw 'Android原生工程生成失败。' }
    } elseif (-not (Test-Path -LiteralPath 'android\gradlew.bat')) {
        throw '原生工程尚未生成，不能跳过prebuild。'
    }
    # Apply the same config-plugin transformation without regenerating Android.
    # This also protects -SkipPrebuild retries while preserving native caches.
    node scripts/apply-native-path-fix.js
    if ($LASTEXITCODE -ne 0) { throw 'Windows原生编译路径修正失败。' }
    Push-Location android
    try {
        $taskLogDirectory = Join-Path $taskRoot '.cache\build-logs'
        New-Item -ItemType Directory -Force -Path $taskLogDirectory | Out-Null
        $taskLogPath = Join-Path $taskLogDirectory ("android-debug-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
        Write-Output "本次构建日志：$taskLogPath"
        # PS5.1 promotes native stderr to error records. Keep warnings printable,
        # but decide build success using Gradle's exit code, never stderr alone.
        $taskSavedPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & '.\gradlew.bat' @taskGradleArgs 2>&1 | ForEach-Object { $_.ToString() } | Tee-Object -FilePath $taskLogPath
            $taskBuildExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $taskSavedPreference }
        if ($taskBuildExitCode -ne 0) { throw 'Android调试包构建失败，请查看上方实际错误。' }
        Write-Output "调试APK：$(Join-Path $taskRoot 'mobile\android\app\build\outputs\apk\debug\app-debug.apk')"
        Write-Output '这是需要Metro开发服务器的调试包，尚非正式独立发布包。'
    } finally { Pop-Location }
} finally { Pop-Location }
