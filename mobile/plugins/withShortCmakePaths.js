const { withAppBuildGradle } = require('expo/config-plugins');

const marker = '// today-eat: limit native object paths for Windows Ninja';

function patchBuildGradle(contents) {
  if (contents.includes(marker)) return contents;
  const anchor = /(^[ \t]*)defaultConfig\s*\{/m;
  if (!anchor.test(contents)) throw new Error('Cannot locate Android defaultConfig; native path fix was not applied.');
  return contents.replace(anchor, (match, indent) => `${match}
${indent}    ${marker}
${indent}    externalNativeBuild {
${indent}        cmake {
${indent}            arguments "-DCMAKE_OBJECT_PATH_MAX=240"
${indent}        }
${indent}    }
`);
}

module.exports = function withShortCmakePaths(config) {
  return withAppBuildGradle(config, result => {
    if (result.modResults.language !== 'groovy') throw new Error('Expected Groovy Android app build file.');
    result.modResults.contents = patchBuildGradle(result.modResults.contents);
    return result;
  });
};
module.exports.patchBuildGradle = patchBuildGradle;
