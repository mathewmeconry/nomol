import { useCallback, useState } from 'react';

type Size = { width: number; height: number };

/**
 * The size of the element the returned callback is given as its `ref`, padding and border
 * included; `initial` (by default the window's) until that's measured.
 */
export default function useElementSize(initial?: Size) {
  const [size, setSize] = useState<Size>(
    () =>
      initial ??
      (typeof window === 'undefined'
        ? { width: 0, height: 0 }
        : { width: window.innerWidth, height: window.innerHeight }),
  );
  const observe = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [size, observe] as const;
}
