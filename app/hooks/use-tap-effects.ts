import { useEffect, useState } from 'react';
import { unlockSound } from '~/lib/sound.client';

/**
 * Browsers allow sound and fullscreen only after a tap. Returns whether sound is unlocked.
 *
 * The browser's address bar takes much of a phone's height, so every tap restores fullscreen,
 * e.g. after the share sheet or the back gesture. iPhones don't support it.
 */
export default function useTapEffects(): boolean {
  const [soundReady, setSoundReady] = useState(false);

  useEffect(() => {
    function unlock() {
      void unlockSound().then(setSoundReady);
    }
    function enterFullscreen() {
      if (document.fullscreenElement || !document.fullscreenEnabled) return;
      void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('pointerdown', enterFullscreen);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('pointerdown', enterFullscreen);
    };
  }, []);

  return soundReady;
}
