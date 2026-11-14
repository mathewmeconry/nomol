import { NitroModules } from 'react-native-nitro-modules';
import type { CameraClock } from './specs/CameraClock.nitro';
import type { FileShare } from './specs/FileShare.nitro';
import type { PoseLandmarker } from './specs/PoseLandmarker.nitro';
import type { StartSound } from './specs/StartSound.nitro';

export type { Detection, Model } from './specs/PoseLandmarker.nitro';

export function createPoseLandmarker(): PoseLandmarker {
  return NitroModules.createHybridObject<PoseLandmarker>('PoseLandmarker');
}

export function createStartSound(): StartSound {
  return NitroModules.createHybridObject<StartSound>('StartSound');
}

export function createCameraClock(): CameraClock {
  return NitroModules.createHybridObject<CameraClock>('CameraClock');
}

export function createFileShare(): FileShare {
  return NitroModules.createHybridObject<FileShare>('FileShare');
}
