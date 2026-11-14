import { NitroModules } from 'react-native-nitro-modules';
import type { PoseLandmarker } from './specs/PoseLandmarker.nitro';
import type { StartSound } from './specs/StartSound.nitro';

export type { Detection, Model } from './specs/PoseLandmarker.nitro';

export function createPoseLandmarker(): PoseLandmarker {
  return NitroModules.createHybridObject<PoseLandmarker>('PoseLandmarker');
}

export function createStartSound(): StartSound {
  return NitroModules.createHybridObject<StartSound>('StartSound');
}
