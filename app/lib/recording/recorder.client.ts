/** Safari only records MP4; Chrome records MP4 in recent versions and WebM everywhere. */
const MIME_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

export function pickMimeType(isSupported: (type: string) => boolean): string | undefined {
  return MIME_TYPES.find(isSupported);
}

export type Recording = { stop: () => Promise<Blob> };

export function startRecording(stream: MediaStream): Recording {
  const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
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
