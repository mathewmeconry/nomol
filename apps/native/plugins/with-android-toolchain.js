// Points every Gradle module at the locally installed SDK, NDK and build-tools, so Gradle never
// tries to download others (it can't: licences aren't accepted on the build machine, and nothing
// may be installed system-wide).
// - expo-build-properties (SDK 58) has no ndkVersion option; Expo/RN default to NDK 27.1.
//   ExpoRootProject applies rootProject.ext.ndkVersion to every library module.
// - Library modules that don't set buildToolsVersion get AGP's default (36.0.0), so set it too.
// - local.properties is written here, not by hand, so `expo prebuild --clean` keeps it. CMake
//   comes from the system (/usr/bin), not the SDK.
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withProjectBuildGradle } = require('expo/config-plugins');

module.exports = function withAndroidToolchain(
  config,
  { sdkDir, cmakeDir, ndkVersion, buildToolsVersion },
) {
  config = withProjectBuildGradle(config, (mod) => {
    let contents = mod.modResults.contents;
    if (!contents.includes('ext.ndkVersion')) {
      contents = contents.replace(
        /buildscript \{/,
        `buildscript {\n  ext.ndkVersion = "${ndkVersion}"`,
      );
      contents += `
subprojects {
  plugins.withId("com.android.library") {
    android { buildToolsVersion = "${buildToolsVersion}" }
  }
}
`;
    }
    mod.modResults.contents = contents;
    return mod;
  });

  return withDangerousMod(config, [
    'android',
    (mod) => {
      const file = path.join(mod.modRequest.platformProjectRoot, 'local.properties');
      fs.writeFileSync(file, `sdk.dir=${sdkDir}\ncmake.dir=${cmakeDir}\n`);
      return mod;
    },
  ]);
};
