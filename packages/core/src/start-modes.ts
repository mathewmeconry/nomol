import type { RunUp } from './detection/session';

/** The ways a recording starts, as both apps explain them when the coach chooses one. */
export type StartMode = {
  runUp: RunUp | null;
  title: string;
  /** On the button that opens the choice. */
  short: string;
  description: string;
  /** The apparatus it suits. */
  goodFor: string;
};

export const START_MODES: StartMode[] = [
  {
    runUp: null,
    title: 'Mit Zeichen',
    short: 'Mit Zeichen',
    description: 'Du kreuzt in der Startzone die Arme über dem Kopf und hältst 1 Sekunde.',
    goodFor: 'Reck, Ringe, Boden, Barren',
  },
  {
    runUp: 'left',
    title: 'Automatisch, Anlauf von links',
    short: 'Anlauf von links',
    description:
      'Startet, wenn jemand von links in die Startzone rennt. Wer zurückgeht, startet nichts.',
    goodFor: 'Sprung',
  },
  {
    runUp: 'right',
    title: 'Automatisch, Anlauf von rechts',
    short: 'Anlauf von rechts',
    description:
      'Startet, wenn jemand von rechts in die Startzone rennt. Wer zurückgeht, startet nichts.',
    goodFor: 'Sprung',
  },
  {
    runUp: 'any',
    title: 'Automatisch bei Tempo',
    short: 'Bei Tempo',
    description:
      'Startet, wenn sich jemand in der Startzone schneller als Gehen bewegt, egal wohin.',
    goodFor: 'Ringe (Schwingen), Boden (Anlauf)',
  },
];

export function startMode(runUp: RunUp | null): StartMode {
  return START_MODES.find((mode) => mode.runUp === runUp) ?? START_MODES[0];
}

/** Shown on the sheet under its title. */
export const START_MODES_NOTE =
  'Gilt für dieses Gerät. Der rote Knopf startet immer. Automatisch beginnt das Video 1,5–3 s vor dem Auslösen.';
