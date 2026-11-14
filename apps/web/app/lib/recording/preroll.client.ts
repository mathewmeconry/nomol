import { PREROLL_MAX_MS } from '@nomol/core/recording/preroll';
import { startRecording, type Recording } from './recorder.client';

/** Two recorders take turns, each restarted after twice this long. */
const TURN_MS = PREROLL_MAX_MS / 2;

type Running = { recording: Recording; startedAt: number };

export type Preroll = {
  /** The recorder running longest (1.5–3 s); it carries on as the recording. */
  take(): Running | null;
  close(): void;
};

/**
 * Lets automatic recordings begin before the moment they were triggered: the gymnast is only
 * recognised once they are in the picture and moving, by then the take-off may be over.
 * Recorders can't be cut at the front, so two of them run staggered and the younger one is
 * dropped. Nothing is kept unless a recording starts.
 */
export function startPreroll(stream: MediaStream): Preroll {
  function start(): Running {
    return { recording: startRecording(stream), startedAt: performance.now() };
  }
  let running = [start()];
  const timer = setInterval(() => {
    if (running.length === 2) void running.shift()?.recording.stop();
    running.push(start());
  }, TURN_MS);

  function close() {
    clearInterval(timer);
    for (const { recording } of running) void recording.stop();
    running = [];
  }

  return {
    take() {
      const [oldest = null, ...younger] = running;
      running = younger;
      close();
      return oldest;
    },
    close,
  };
}
