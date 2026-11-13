import { useEffect } from 'react';

/** Keeps the wall-mounted tablet from dimming and locking while the app is open. */
export default function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;

    async function acquire() {
      if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch (_error) {
        // Refused (e.g. battery saver). The app still works; the screen may just turn off.
      }
    }

    void acquire();
    // The browser releases the lock whenever the page is hidden; take it again on return.
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, []);
}
