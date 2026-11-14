import { execSync } from 'node:child_process';
import type { ExpoConfig } from 'expo/config';

/** The commit the app was built from, shown in the settings to tell whether an update arrived. */
function appVersion() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const ICON = '../web/public/icon-512.png';

const config: ExpoConfig = {
  name: 'Nomol',
  slug: 'nomol',
  version: '0.1.0',
  orientation: 'default',
  icon: ICON,
  userInterfaceStyle: 'dark',
  platforms: ['android'],
  // Installed by hand from a local build; no over-the-air updates.
  updates: { enabled: false },
  backgroundColor: '#000000',
  android: {
    package: 'ch.nomol.app',
    permissions: ['android.permission.CAMERA'],
    adaptiveIcon: { foregroundImage: ICON, backgroundColor: '#020618' },
    predictiveBackGestureEnabled: false,
  },
  extra: {
    appVersion: appVersion(),
    builtAt: new Date().toISOString(),
  },
  plugins: [
    'expo-sqlite',
    [
      'expo-build-properties',
      {
        android: {
          compileSdkVersion: 37,
          targetSdkVersion: 37,
          buildToolsVersion: '37.0.0',
        },
      },
    ],
    [
      './plugins/with-android-toolchain',
      {
        sdkDir: process.env.ANDROID_HOME ?? '/opt/android-sdk',
        cmakeDir: '/usr',
        ndkVersion: '30.0.16248370',
        buildToolsVersion: '37.0.0',
      },
    ],
  ],
};

export default config;
