/** Safari only records MP4; Chrome records MP4 in recent versions and WebM everywhere. */
const MIME_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

export function pickMimeType(isSupported: (type: string) => boolean): string | undefined {
  return MIME_TYPES.find(isSupported);
}

export type Recording = { stop: () => Promise<Blob> };

/**
 * A keyframe every half second. Phones otherwise record one only every few seconds, and seeking
 * has to decode from the last keyframe, so scrubbing the replay looked frozen. Not in
 * TypeScript's DOM types yet; browsers without it ignore the option.
 */
const KEYFRAME_EVERY_MS = 500;

export function startRecording(stream: MediaStream): Recording {
  const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
  const options: MediaRecorderOptions & { videoKeyFrameIntervalDuration: number } = {
    ...(mimeType ? { mimeType } : {}),
    videoKeyFrameIntervalDuration: KEYFRAME_EVERY_MS,
  };
  const recorder = new MediaRecorder(stream, options);
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.start();

  return {
    stop() {
      return new Promise((resolve) => {
        recorder.addEventListener(
          'stop',
          () => resolve(new Blob(chunks, { type: recorder.mimeType })),
          { once: true },
        );
        recorder.stop();
      });
    },
  };
}
