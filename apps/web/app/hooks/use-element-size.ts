import { useCallback, useState } from 'react';

/**
 * The size of the element the returned callback is given as its `ref`; the window's until
 * that's measured.
 */
export default function useElementSize() {
  const [size, setSize] = useState(() =>
    typeof window === 'undefined'
      ? { width: 0, height: 0 }
      : { width: window.innerWidth, height: window.innerHeight },
  );
  const observe = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [size, observe] as const;
}
