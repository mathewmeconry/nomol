import { useEffect, useEffectEvent } from 'react';
import { Button } from '~/components/ui/button';

/** Long enough to read and undo, short enough not to linger over the replay. */
const SHOWN_MS = 10_000;

/** Tells the coach the floor line moved by itself (`learnFloorLine`), with a way back. */
export default function FloorLineNote({
  onUndo,
  onClose,
}: {
  onUndo: () => void;
  onClose: () => void;
}) {
  // The screen re-renders with every detected frame; that mustn't restart the timer.
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const timer = setTimeout(close, SHOWN_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      role="status"
      className="absolute top-16 left-1/2 z-30 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl bg-black/70 py-1.5 pr-1.5 pl-4 text-sm backdrop-blur"
    >
      Bodenlinie an die Landung angepasst
      <Button size="sm" variant="secondary" onClick={onUndo}>
        Rückgängig
      </Button>
    </div>
  );
}
