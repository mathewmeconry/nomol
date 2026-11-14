import type { HybridObject } from 'react-native-nitro-modules';

/** The beep when a recording starts, so the gymnast knows it's running. */
export interface StartSound extends HybridObject<{ android: 'kotlin' }> {
  play(): void;
}
