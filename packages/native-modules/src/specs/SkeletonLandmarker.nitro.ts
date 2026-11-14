import type { HybridObject } from 'react-native-nitro-modules';

export interface StillSize {
  width: number;
  height: number;
}

/**
 * MediaPipe Pose Landmarker (heavy, IMAGE mode) on the stills saved while recording, for the
 * replay skeleton. Which views to look at and what the poses mean is decided in core
 * (`createTracker` in `skeleton/rotation.ts`); this only cuts out a view and detects in it, off
 * the JS thread.
 */
export interface SkeletonLandmarker extends HybridObject<{ android: 'kotlin' }> {
  /** Loads the heavy model; call once before `detect`. */
  load(): Promise<void>;
  /** Decodes a still (JPEG) for the following `detect` calls. */
  open(path: string): Promise<StillSize>;
  /**
   * Poses in a square of the open still around (`centerX`, `centerY`), `size` pixels wide, turned
   * by `angle` radians (clockwise): x, y and visibility of each landmark, 33 per pose, all poses
   * in one list, x and y normalized to the view (core's `View`, `posesFromView`).
   */
  detect(centerX: number, centerY: number, size: number, angle: number): Promise<number[]>;
}
