import { fireEvent, render, screen } from '@testing-library/react';
import FloorLineNote from './FloorLineNote';

describe('FloorLineNote', () => {
  afterEach(() => vi.useRealTimers());

  it('undoes on a tap', () => {
    const onUndo = vi.fn();
    render(<FloorLineNote onUndo={onUndo} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
    expect(onUndo).toHaveBeenCalled();
  });

  it('closes after a while, also when the screen re-renders meanwhile', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { rerender } = render(<FloorLineNote onUndo={vi.fn()} onClose={onClose} />);
    vi.advanceTimersByTime(6000);
    rerender(<FloorLineNote onUndo={vi.fn()} onClose={onClose} />);
    vi.advanceTimersByTime(3999);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalled();
  });
});
