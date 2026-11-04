# Android 移动硬盘开发环境

检查日期：2026-11-02。用户提供路径：Android Studio 位于 E:\Android Studio，SDK 位于 E:\AndroidSdk。

## 实际检测

| 项目 | 结果 |
|---|---|
| Android Studio | 路径可读，内置 JBR 为 Java 25 |
| SDK Platform | 已有 android-37.0，元数据显示 API 37.0；待实际构建验证项目识别，不手工改目录名 |
| adb / Platform-Tools | 可运行，adb37.0.1；设备列表为空 |
| Build-Tools | 已补装37.0.0，原36.0.0保留 |
| NDK | 已补装27.1.12297006，原30.0.16248370保留 |
| CMake | 4.1.2已安装；实际构建另要求3.22.1，自动下载失败后仅有空/不完整目录，缺bin/cmake.exe，须补装 |
| Command-line Tools | latest已安装 |
| JDK17 | 已验证17.0.21.0.2；实际根目录E:\Java\jdk-17\jdk-17.0.21.21-hotspot |

## 安装参考（上述必需组件现已补齐）

1. Android Studio欢迎页 → More Actions → SDK Manager，确认Android SDK Location仍是E:\AndroidSdk。
2. SDK Tools勾选Show Package Details，补装Android SDK Build-Tools 37.0.0、NDK (Side by side) 27.1.12297006、Android SDK Command-line Tools (latest)、CMake **3.22.1**。CMake4.1.2可以并存，但不能替代构建指定版本。已有Platform-Tools不必重复安装，已有平台暂时保留。
3. 安装Windows x64 JDK17到移动硬盘，例如E:\Java\jdk-17。实际路径可能带版本后缀，以包含bin\java.exe的目录为准；可以与现有Java25共存。
4. 不必再下载模拟器系统镜像。优先数据线连接Android真机，开启USB调试并授权，再运行adb devices，状态应为device。当前已经有的system-images/emulator未自动删除。

JDK来源可用[Microsoft OpenJDK17](https://learn.microsoft.com/en-us/java/openjdk/download#openjdk-17)。SDK工具使用Android Studio的[SDK Manager](https://developer.android.com/studio/intro/update#sdk-manager)安装；工具版本以当前项目react-native/gradle/libs.versions.toml为依据，CMake具体版本若构建另有要求再按日志补装。

## 当前终端配置

在项目根目录的PowerShell中，使用开头的“点+空格”运行脚本：

```powershell
. .\scripts\android-env.ps1 -JdkPath 'E:\Java\jdk-17'
java -version
adb devices
```

脚本可识别JDK目录下唯一的一层版本目录，无需重命名安装文件夹；多个版本时请传精确路径。脚本只设置当前终端的ANDROID_HOME、JAVA_HOME、GRADLE_USER_HOME及PATH，不更改永久变量。Gradle用户缓存放E:\AndroidGradleCache。

项目本身位于D盘，mobile/android/build及.cxx等构建产物仍可能占D盘；系统TEMP和Studio的少量配置也不会因此自动全部移走。后续按空间情况再决定移动项目或进一步调整，不承诺零内置盘占用。

## 工具齐全后

现在可在项目根目录直接构建ARM64调试APK，不要求此时已经连接手机：

```powershell
.\scripts\build-android.ps1 -UseSystemProxy
```

脚本会读取系统代理供本次构建使用（不打印地址，不永久改设置），重建内部HTTP调试配置，并调用assembleDebug。默认只构建arm64-v8a以控制空间和耗时；其他架构通过-Architectures指定。产物是开发调试包，需要Metro服务，不等于正式独立发布包。

### 下载失败时的可复用命令

2026-11-03实际构建仍在官方Maven依赖TLS连接处失败，已保存日志并限制单次连接/读取超时。不要为此重装SDK/JDK，也不要关闭证书校验。

已生成原生工程且原生配置未改时，可用-SkipPrebuild保留中间产物重试。可选的公开镜像参数如下：

```powershell
.\scripts\build-android.ps1 -UseSystemProxy -SkipPrebuild -UseAliyunMirror
```

该参数使用scripts/maven-mirror.init.gradle，将本次构建的Maven Central/Google/Gradle插件依赖请求映射到阿里云对应公开HTTPS镜像；不上传项目源码、不写全局仓库设置。镜像实际构建尚未验证：工具自动权限审核连续两次超时，等待用户授权/指导继续。镜像缺失包时可能仍需调整线路，不能承诺这一选项已解决下载问题。

当前日志自动保存到项目.cache/build-logs。移动硬盘上项目专用Gradle配置保留代理/TLS1.2，网络改变时需要同步更新；源码和文档不保存具体代理地址或密码。

### CMake自动安装失败后的恢复

2026-11-03用户构建已推进288个任务，失败点为react-native-worklets:configureCMakeDebug[arm64-v8a]自动安装CMake3.22.1失败。实际E:\AndroidSdk\cmake\3.22.1目录存在但bin/cmake.exe不存在，不能把目录存在当作安装成功。

在Android Studio → SDK Manager → SDK Tools勾选Show Package Details，展开CMake并选择3.22.1，Apply完成安装。4.1.2保留，不自动删除任何SDK目录。确认E:\AndroidSdk\cmake\3.22.1\bin\cmake.exe存在后，使用原命令并保留-SkipPrebuild重试；不要clean、删除.gradle或重生成原生目录。Gradle可复用已下载与已完成的有效中间产物，但不能承诺所有任务都跳过或固定重试时间。

环境与构建脚本已改为检查指定版本的可执行文件，以便在耗时编译开始前发现未完成安装。

### Ninja报Filename longer than 260 characters

日志android-debug-20261103-105847.log的真实失败点是app原生对象路径过长，316任务中281个已复用；末尾Gradle10兼容性提示不是失败原因。修复使用CMAKE_OBJECT_PATH_MAX=240，让CMake对长对象路径做哈希缩短，而非移动项目或启用系统级选项。

mobile/plugins/withShortCmakePaths.js保证下次prebuild保留配置；构建脚本会在SkipPrebuild时通过mobile/scripts/apply-native-path-fix.js同步修正当前原生工程。只更新参数，不删除.cxx、Gradle缓存或整个android目录。

已局部验证CMake配置生成成功，报错的RNGestureHandlerDetectorShadowNode对象完整路径缩短至238字符。现在可继续运行原来的带SkipPrebuild镜像构建命令；完整编译是否通过仍以实际BUILD SUCCESSFUL为准。

在同一终端继续：

```powershell
Set-Location mobile
$env:EATING_ALLOW_HTTP = '1'
$env:EXPO_PUBLIC_ALLOW_HTTP = '1'
npm.cmd run android -- --device
```

这是连接本地API的内部开发构建；首次会下载Gradle及Maven构建依赖，仍需网络、磁盘空间，并可能需要补充SDK包。不要在构建期间拔盘。项目对API37.0平台的兼容及完整原生构建尚未验证，不把此次目录检测当成APK构建通过。

App内还需配置手机可访问的后端服务地址；原生安装通过后再继续后端连接和M1真机流程验证。

## 调试包生成后：USB真机启动

连接手机、开启USB调试并在手机上授权，adb devices应显示device。首次调试包默认ARM64，安装前需确认手机支持arm64-v8a；没有连接手机时无法完成安装或真机验收。

```powershell
# 项目根目录，安装调试包；多设备时给adb加-s设备序列号
. .\scripts\android-env.ps1
adb install -r .\mobile\android\app\build\outputs\apk\debug\app-debug.apk

# 终端一：本机后端，保持运行
.\scripts\start-backend.ps1

# 终端二：USB端口映射+Metro，保持运行
.\scripts\start-android-dev.ps1
```

USB映射后App家庭设置中的服务地址为http://127.0.0.1:8000；该地址仅因adb reverse映射才指向电脑，拔掉USB后不可依此访问。默认后端不对局域网开放，因此此测试方式不要求修改防火墙。配置了EATING_API_TOKEN时，App仍需填写相同凭证。

这里是Metro调试工作流，不是可脱离电脑运行的正式APK；独立内部预览包与生产签名后续分开交付。

## 拔盘前

结束Metro/构建，关闭Android Studio与模拟器。在已配置的终端中停止后台工具，再安全弹出：

```powershell
adb kill-server
Set-Location D:\MyProject\Eating\mobile\android
.\gradlew.bat --stop
```

Gradle尚未下载时不用运行第二条停止命令，以免仅为停止而触发下载。关闭该项目终端即丢弃临时环境设置。
