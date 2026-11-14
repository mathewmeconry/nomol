import type { HybridObject } from 'react-native-nitro-modules';

/**
 * The clock camera frames are stamped with (ms since boot, counting deep sleep), which JS has no
 * access to. Ties the start of a video recording to the frames detected around it.
 */
export interface CameraClock extends HybridObject<{ android: 'kotlin' }> {
  now(): number;
}
