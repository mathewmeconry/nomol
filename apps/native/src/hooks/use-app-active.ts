import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

function subscribe(listener: () => void) {
  const subscription = AppState.addEventListener('change', listener);
  return () => subscription.remove();
}

/** Whether the app is in front (not behind another app or the lock screen). */
export function useAppActive() {
  return useSyncExternalStore(subscribe, () => AppState.currentState === 'active');
}
