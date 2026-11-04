export default {
  expo: {
    name: '吃饭灵感',
    slug: 'today-eat',
    version: '0.1.0',
    scheme: 'today-eat',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    platforms: ['android'],
    android: {
      package: 'com.family.todayeat',
      versionCode: 1,
      permissions: [],
      blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.VIBRATE'],
    },
    plugins: ['expo-router', 'expo-secure-store', 'expo-status-bar', './plugins/withLocalApi', './plugins/withShortCmakePaths'],
    experiments: { typedRoutes: true },
  },
};
