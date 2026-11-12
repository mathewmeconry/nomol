import { useEffect, useState } from 'react';
import type { PoseDetector } from '~/lib/detection/pose-detector.client';

/** Loads MediaPipe once; `progress` is the model download in percent, null until known. */
export default function usePoseDetector() {
  const [detector, setDetector] = useState<PoseDetector | null>(null);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    let created: PoseDetector | null = null;
    let cancelled = false;
    import('~/lib/detection/pose-detector.client')
      // A cancelled load (e.g. React's double effect in development) keeps downloading; its
      // progress must not mix with the current one.
      .then((module) =>
        module.createPoseDetector((percent) => {
          if (!cancelled) setProgress(percent);
        }),
      )
      .then((result) => {
        if (cancelled) return result.close();
        created = result;
        setDetector(result);
      })
      .catch((_error: unknown) => setFailed(true));
    return () => {
      cancelled = true;
      created?.close();
    };
  }, []);

  /** Detection also fails later, e.g. without WebGL every frame throws. */
  function fail() {
    setFailed(true);
  }

  return { detector, failed, progress, fail };
}
