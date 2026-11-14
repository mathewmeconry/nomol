import type { HybridObject } from 'react-native-nitro-modules';

/** The Android share sheet for several files at once (React Native's and Expo's take one). */
export interface FileShare extends HybridObject<{ android: 'kotlin' }> {
  /** `uris` are `content://` URIs of the app's own files (expo-file-system's `contentUri`). */
  share(uris: string[], title: string): void;
}
