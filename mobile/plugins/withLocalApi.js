const { withAndroidManifest } = require('expo/config-plugins');

// Explicit opt-in only for an internal development APK talking to a LAN API.
module.exports = function withLocalApi(config) {
  return withAndroidManifest(config, (result) => {
    const application = result.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:usesCleartextTraffic'] = process.env.EATING_ALLOW_HTTP === '1' ? 'true' : 'false';
    }
    return result;
  });
};
