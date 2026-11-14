import { SETTINGS_KEYS, formatSoundOn, parseSoundOn } from '@nomol/core/settings';

let context: AudioContext | null = null;

/** The start beep can be switched off per device, e.g. where several devices stand close. */
export function loadSoundOn(): boolean {
  return parseSoundOn(localStorage.getItem(SETTINGS_KEYS.sound));
}

export function saveSoundOn(on: boolean) {
  localStorage.setItem(SETTINGS_KEYS.sound, formatSoundOn(on));
}

/**
 * Browsers only allow sound after the page has been touched once, so call this from a tap or
 * click handler. Resolves to whether sound can play now.
 */
export async function unlockSound(): Promise<boolean> {
  context ??= new AudioContext();
  await context.resume();
  return context.state === 'running';
}

/** Two rising beeps, loud enough to hear across the hall. */
export function playStartSound() {
  const audio = context;
  if (!audio || audio.state !== 'running') return;
  const now = audio.currentTime;
  [880, 1320].forEach((frequency, i) => {
    const start = now + i * 0.14;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.22);
  });
}
