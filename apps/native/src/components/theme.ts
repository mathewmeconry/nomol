import { StyleSheet } from 'react-native';

/** Same palette as the web app (Tailwind colours). */
export const colors = {
  text: '#f1f5f9',
  muted: '#94a3b8',
  emerald: '#6ee7b7',
  amber: '#fcd34d',
  red: '#fca5a5',
  sky: '#7dd3fc',
  zone: 'rgba(60, 211, 176, 0.7)',
  zoneLabel: 'rgba(60, 211, 176, 0.95)',
  destructive: '#dc2626',
  panel: 'rgba(15, 23, 42, 0.92)',
};

/** One rectangle in screen points: where the camera picture sits on the screen. */
export type Frame = { left: number; top: number; width: number; height: number };

export const styles = StyleSheet.create({
  /** Controls float over the camera image, so they get a dark backing. */
  floating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  floatingText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  primaryButton: { backgroundColor: colors.text, borderColor: colors.text },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  primaryButtonText: { color: '#020618' },
  disabled: { opacity: 0.4 },
});
