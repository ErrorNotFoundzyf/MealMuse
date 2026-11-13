const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

function writeSplash(platformProjectRoot) {
    const dir = path.join(platformProjectRoot, 'app/src/main/res/drawable');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'splash_loading.xml'), `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:drawable="@color/splash_background" />
  <item android:width="48dp" android:height="48dp" android:gravity="center">
    <animated-rotate android:drawable="@drawable/splash_spinner" android:pivotX="50%" android:pivotY="50%" />
  </item>
</layer-list>`);
    fs.writeFileSync(path.join(dir, 'splash_spinner.xml'), `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="ring" android:innerRadiusRatio="3" android:thicknessRatio="12" android:useLevel="false">
  <gradient android:type="sweep" android:useLevel="false" android:startColor="#00A8B89B" android:endColor="#386649" />
</shape>`);
    const values = path.join(platformProjectRoot, 'app/src/main/res/values');
    fs.writeFileSync(path.join(values, 'splash_background.xml'), '<resources><color name="splash_background">#F7F1E8</color></resources>');
    const styles = path.join(values, 'styles.xml');
    fs.writeFileSync(styles, fs.readFileSync(styles, 'utf8').replace('@drawable/splashscreen_logo', '@drawable/splash_loading'));
}
module.exports = function withLoadingSplash(config) {
  return withDangerousMod(config, ['android', async (mod) => {
    writeSplash(mod.modRequest.platformProjectRoot);
    return mod;
  }]);
};
module.exports.writeSplash = writeSplash;
