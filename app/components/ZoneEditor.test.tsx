import { fireEvent, render, screen } from '@testing-library/react';
import ZoneEditor from './ZoneEditor';

const zone = { left: 0.3, top: 0.35, right: 0.7, bottom: 0.95 };

/** jsdom has no layout, so give the drawing surface a size of 1000×500 px. */
function drawingSurface() {
  const surface = screen.getByRole('application', { name: 'Startzone zeichnen' });
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500 }) as DOMRect;
  surface.setPointerCapture = vi.fn();
  return surface;
}

describe('ZoneEditor', () => {
  it('saves the rectangle the coach drags, in image coordinates', () => {
    const onSave = vi.fn();
    render(<ZoneEditor zone={zone} onSave={onSave} onCancel={vi.fn()} />);
    const surface = drawingSurface();

    fireEvent.pointerDown(surface, { clientX: 600, clientY: 450, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(onSave).toHaveBeenCalledWith({ left: 0.2, top: 0.2, right: 0.6, bottom: 0.9 });
  });

  it('does not save a zone that is too small', () => {
    render(<ZoneEditor zone={zone} onSave={vi.fn()} onCancel={vi.fn()} />);
    const surface = drawingSurface();

    fireEvent.pointerDown(surface, { clientX: 500, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1 });

    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByText(/Zu klein/)).toBeInTheDocument();
  });

  it('cancels without saving', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<ZoneEditor zone={zone} onSave={onSave} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
