import {
  bufferCrop,
  cropArea,
  posesInArea,
  type PixelRect,
} from '@nomol/core/detection/camera-frame';
import { measureSpeed } from '@nomol/core/detection/model-speed';
import type { Pose } from '@nomol/core/detection/pose';
import type { Zone } from '@nomol/core/detection/zone';
import { createPoseLandmarker } from '@nomol/native-modules';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrameOutput, type Frame } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';

/**
 * 4:3 like the preview, so both show the same part of the sensor. 1.2 MP keeps enough pixels in
 * the crop around a start zone at the back of the hall.
 */
const FRAME_SIZE = { width: 960, height: 1280 };

/** Clockwise degrees from VisionCamera's frame orientation to the upright picture. */
const ROTATION = { up: 0, left: 90, down: 180, right: 270 } as const;

const WHOLE: Zone = { left: 0, top: 0, right: 1, bottom: 1 };

/**
 * How often a frame is saved while recording, for the replay skeleton, as in the web app: 10 per
 * second look smooth with interpolation and keep the computation after a recording short.
 */
const STILL_EVERY_MS = 100;

/** What the frame worklet needs from the screen, written on the JS thread. */
type Look = {
  /** Where to detect (`detectionArea`), in the picture. */
  area: Zone;
  /** The preview mirrors front cameras. */
  mirrored: boolean;
  paused: boolean;
};

/** One detection as it leaves the worklet. */
type Raw = {
  landmarks: number[];
  ms: number;
  time: number;
  crop: PixelRect;
  width: number;
  height: number;
  rotation: number;
  mirrored: boolean;
  still: string | null;
};

export type Detected = {
  /** In picture coordinates, as on screen. */
  poses: Pose[];
  /** When the camera captured the frame, in ms. */
  time: number;
  /** Width / height of the picture. */
  aspectRatio: number;
  /** Path of the still saved from this frame (see `saveStills`), if one was. */
  still: string | null;
};

/**
 * MediaPipe on every camera frame it can keep up with, in VisionCamera's frame worklet (the
 * camera thread); a frame arriving meanwhile is dropped, so the newest one is detected next.
 * Results go to `onDetected` on the JS thread. Starts on the heavy model and switches to lite
 * when that is too slow (`measureSpeed`).
 */
export function usePoseDetection(onDetected: (detected: Detected) => void) {
  const [landmarker] = useState(createPoseLandmarker);
  const [look] = useState(() =>
    createSynchronizable<Look>({ area: WHOLE, mirrored: false, paused: true }),
  );
  // Each written by one side only, so neither overwrites the other's change: where stills go
  // (null when not saving) by the JS thread, when the last was saved by the camera thread.
  const [stillsDir] = useState(() => createSynchronizable<string | null>(null));
  const [lastStill] = useState(() => createSynchronizable(-Infinity));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timingsRef = useRef<number[] | null>([]);
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  });

  useEffect(() => {
    landmarker.load('heavy').then(
      () => setReady(true),
      (e: unknown) => setError(String(e)),
    );
  }, [landmarker]);

  const deliver = useCallback(
    (raw: Raw) => {
      const orientation = { rotation: raw.rotation, mirrored: raw.mirrored };
      const area = cropArea(raw.crop, raw.width, raw.height, orientation);
      const turned = raw.rotation === 90 || raw.rotation === 270;
      onDetectedRef.current({
        poses: posesInArea(raw.landmarks, area),
        time: raw.time,
        aspectRatio: turned ? raw.height / raw.width : raw.width / raw.height,
        still: raw.still,
      });
      const timings = timingsRef.current;
      if (!timings) return;
      const speed = measureSpeed(timings, raw.ms);
      timingsRef.current = speed.slow ? null : speed.timings;
      // Stays on heavy if lite fails to load.
      if (speed.slow) landmarker.load('lite').catch(() => {});
    },
    [landmarker],
  );

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';
      try {
        const { area, mirrored, paused } = look.getDirty();
        if (paused) return;
        const rotation = ROTATION[frame.orientation];
        const crop = bufferCrop(area, frame.width, frame.height, { rotation, mirrored });
        // Nanoseconds since boot; MediaPipe and the session work in ms.
        const time = frame.timestamp / 1e6;
        const dir = stillsDir.getDirty();
        let still: string | null = null;
        if (dir !== null && time - lastStill.getDirty() >= STILL_EVERY_MS) {
          still = `${dir}/${Math.round(time)}.jpg`;
          lastStill.setBlocking(time);
        }
        const { landmarks, ms } = landmarker.detect(
          frame,
          crop,
          rotation,
          mirrored,
          time,
          still ?? undefined,
        );
        scheduleOnRN(deliver, {
          landmarks,
          ms,
          time,
          crop,
          width: frame.width,
          height: frame.height,
          rotation,
          mirrored,
          still,
        });
      } finally {
        frame.dispose();
      }
    },
    [look, stillsDir, lastStill, landmarker, deliver],
  );

  const frameOutput = useFrameOutput({
    targetResolution: FRAME_SIZE,
    pixelFormat: 'yuv',
    dropFramesWhileBusy: true,
    onFrame,
  });

  /** Where to look next; nothing is detected while `paused` or before the model is loaded. */
  const setLook = useCallback(
    (area: Zone, mirrored: boolean, paused: boolean) => {
      look.setBlocking({ area, mirrored, paused: paused || !ready });
    },
    [look, ready],
  );

  /**
   * While recording, saves a still of a detected frame every `STILL_EVERY_MS` into `dir`; the
   * spacing carries on across a change of `dir`.
   */
  const saveStills = useCallback((dir: string | null) => stillsDir.setBlocking(dir), [stillsDir]);

  return { frameOutput, ready, error, setLook, saveStills };
}
