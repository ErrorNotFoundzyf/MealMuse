const fs = require('node:fs');
const path = require('node:path');
const { patchBuildGradle } = require('../plugins/withShortCmakePaths');

const target = path.resolve(__dirname, '../android/app/build.gradle');
if (!fs.existsSync(target)) throw new Error('Generate the Android project before applying the native path fix.');
const before = fs.readFileSync(target, 'utf8');
const after = patchBuildGradle(before);
if (after !== before) fs.writeFileSync(target, after, 'utf8');
console.log('Native object path limit configured: 240. Existing build caches preserved.');
