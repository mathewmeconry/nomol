import type { HybridObject } from 'react-native-nitro-modules';
import type { CameraOutput } from 'react-native-vision-camera';

/**
 * Records clips from its own camera output with its own H.264 encoder (4:3, 1440×1080, a
 * keyframe every 0.5 s so scrubbing the replay stays smooth). While buffering, it keeps the last
 * ~3 s encoded, so a clip can begin before the moment it was started: the automatic start's
 * trigger comes late. Nothing is written to disk unless a clip is started.
 */
export interface ClipRecorder extends HybridObject<{ android: 'kotlin' }> {
  /**
   * The output to add to the camera session. Nitro can't yet extend VisionCamera's
   * `CameraOutput` in another module, hence a separate object (like VisionCamera's own barcode
   * scanner).
   */
  readonly output: CameraOutput;
  /** Keep encoding into the buffer while waiting; off, the encoder only runs while recording. */
  setBuffering(on: boolean): void;
  /**
   * Starts writing a video to `path`, from the last buffered keyframe captured at or before
   * `fromMs` (camera time, as frame timestamps in ms), or the first one after if there is none.
   * Resolves with the camera time of the video's first frame: its time 0.
   */
  start(path: string, fromMs: number): Promise<number>;
  /** Finishes the video; resolves with the camera time of its last frame once it is written. */
  stop(): Promise<number>;
}
