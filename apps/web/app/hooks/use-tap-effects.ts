import { useEffect } from 'react';
import { unlockSound } from '~/lib/sound.client';

/**
 * Browsers allow sound and fullscreen only after a tap.
 *
 * The browser's address bar takes much of a phone's height, so every tap restores fullscreen,
 * e.g. after the share sheet or the back gesture. iPhones don't support it.
 */
export default function useTapEffects() {
  useEffect(() => {
    function unlock() {
      void unlockSound();
    }
    function enterFullscreen() {
      if (document.fullscreenElement || !document.fullscreenEnabled) return;
      void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
    // Every tap: there's no button to retry with if the first one didn't unlock it.
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('pointerdown', enterFullscreen);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('pointerdown', enterFullscreen);
    };
  }, []);
}
