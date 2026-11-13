import { pickMimeType } from './recorder.client';

describe('pickMimeType', () => {
  it('prefers MP4 when supported', () => {
    expect(pickMimeType(() => true)).toBe('video/mp4;codecs=avc1');
  });

  it('falls back to WebM', () => {
    expect(pickMimeType((type) => type.startsWith('video/webm'))).toBe('video/webm;codecs=vp9');
  });

  it('returns undefined when nothing is supported', () => {
    expect(pickMimeType(() => false)).toBeUndefined();
  });
});
