import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import useCamera from './use-camera';

const stream = { getTracks: () => [] } as unknown as MediaStream;

function mockGetUserMedia(impl: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  const getUserMedia = vi.fn(impl);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  return getUserMedia;
}

function frameRate(constraints: MediaStreamConstraints) {
  return (constraints.video as MediaTrackConstraints).frameRate;
}

describe('useCamera', () => {
  it('asks for 60 fps first', async () => {
    const getUserMedia = mockGetUserMedia(() => Promise.resolve(stream));
    const { result } = renderHook(() => useCamera(null));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(frameRate(getUserMedia.mock.calls[0][0])).toEqual({ min: 50, ideal: 60 });
  });

  it('falls back to any frame rate when the camera can not do 60 fps', async () => {
    const getUserMedia = mockGetUserMedia((constraints) =>
      (frameRate(constraints) as ConstrainDoubleRange).min
        ? Promise.reject(new Error('OverconstrainedError'))
        : Promise.resolve(stream),
    );
    const { result } = renderHook(() => useCamera(null));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('reports a camera that can not be opened', async () => {
    mockGetUserMedia(() => Promise.reject(new Error('NotAllowedError')));
    const { result } = renderHook(() => useCamera(null));
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});
