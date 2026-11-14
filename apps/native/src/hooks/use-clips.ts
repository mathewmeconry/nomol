import type { Clip } from '@nomol/core/recording/clip';
import { useEffect, useState } from 'react';
import { deleteClip, loadClips } from '../lib/clip-store';

/** All clips, newest first, kept on the device until deleted by hand (they're test footage too). */
export function useClips() {
  const [clips, setClips] = useState<Clip[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadClips()
      .then((stored) => {
        // Clips recorded while loading come first; the list stays newest-first.
        if (!cancelled) setClips((recorded) => [...recorded, ...stored]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** A clip just recorded (already stored by `finishRecording`). */
  function add(clip: Clip) {
    setClips((previous) => [clip, ...previous]);
  }

  /** Returns the clips left. */
  function remove(clip: Clip): Clip[] {
    const remaining = clips.filter((other) => other.id !== clip.id);
    deleteClip(clip.id);
    setClips(remaining);
    return remaining;
  }

  /** One by one, not the whole folder: a recording may be running into it. */
  function removeAll() {
    for (const clip of clips) deleteClip(clip.id);
    setClips([]);
  }

  return { clips, add, remove, removeAll };
}
