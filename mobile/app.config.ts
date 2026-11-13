export default {
  expo: {
    name: process.env.EATING_LOCAL_TEST === '1' ? '吃饭灵感本地测试' : '吃饭灵感',
    slug: 'today-eat',
    icon: './assets/app-icon.png',
    version: '0.2.0',
    scheme: 'today-eat',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    platforms: ['android'],
    android: {
      package: process.env.EATING_LOCAL_TEST === '1' ? 'com.family.todayeat.localtest' : 'com.family.todayeat',
      versionCode: 3,
      permissions: [],
      blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.VIBRATE'],
    },
    plugins: ['expo-router', 'expo-secure-store', 'expo-status-bar', 'expo-sqlite', 'expo-document-picker', 'expo-sharing', './plugins/withLocalApi', './plugins/withShortCmakePaths', './plugins/withLoadingSplash'],
    experiments: { typedRoutes: true },
  },
};
