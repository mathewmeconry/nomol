import type { HybridObject } from 'react-native-nitro-modules';
import type { Frame } from 'react-native-vision-camera';

/** MediaPipe's pose landmarker models, bundled with the app. */
export type Model = 'heavy' | 'lite';

/** Pixels of the camera buffer (`bufferCrop` in core). */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Detection {
  /**
   * x, y and visibility of each landmark, 33 per pose, all poses in one list; x and y are
   * normalized to the crop turned upright (`posesInArea` in core).
   */
  landmarks: number[];
  /** How long detection took, to switch to the lite model on slow phones. */
  ms: number;
}

/** MediaPipe Pose Landmarker on camera frames, up to 4 people. */
export interface PoseLandmarker extends HybridObject<{ android: 'kotlin' }> {
  /** Loads a model; detection keeps using the previous one until it's ready. */
  load(model: Model): Promise<void>;
  /**
   * Poses in `crop` of the frame, turned clockwise by `rotation` degrees and flipped if
   * `mirrored` (so it looks as on screen). `timeMs` must grow from frame to frame. No poses
   * until a model is loaded.
   *
   * With `stillPath`, the whole frame is also saved there as a JPEG (turned the same way but
   * never mirrored, like the video; long side 640 px), in the background: for the clip's
   * thumbnail and the replay skeleton. Done here because the frame is already converted for
   * detection.
   */
  detect(
    frame: Frame,
    crop: Crop,
    rotation: number,
    mirrored: boolean,
    timeMs: number,
    stillPath?: string,
  ): Detection;
}
