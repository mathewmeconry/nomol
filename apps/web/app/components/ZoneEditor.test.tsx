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

function drag(from: [number, number], to: [number, number]) {
  const surface = drawingSurface();
  fireEvent.pointerDown(surface, { clientX: from[0], clientY: from[1], pointerId: 1 });
  fireEvent.pointerMove(surface, { clientX: to[0], clientY: to[1], pointerId: 1 });
  fireEvent.pointerUp(surface, { pointerId: 1 });
}

describe('ZoneEditor', () => {
  it('saves the rectangle the coach drags, in image coordinates', () => {
    const onSave = vi.fn();
    render(<ZoneEditor zones={[zone]} onSave={onSave} onCancel={vi.fn()} />);

    drag([600, 450], [200, 100]);
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(onSave).toHaveBeenCalledWith([{ left: 0.2, top: 0.2, right: 0.6, bottom: 0.9 }]);
  });

  it('adds a second zone, drawn without changing the first', () => {
    const onSave = vi.fn();
    render(<ZoneEditor zones={[zone]} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Zweite Zone' }));
    drag([800, 100], [950, 400]);
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(onSave).toHaveBeenCalledWith([zone, { left: 0.8, top: 0.2, right: 0.95, bottom: 0.8 }]);
  });

  it('draws the zone chosen and removes one', () => {
    const onSave = vi.fn();
    const other = { left: 0.75, top: 0.2, right: 0.95, bottom: 0.8 };
    render(<ZoneEditor zones={[zone, other]} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Zone 1 entfernen' }));
    expect(screen.queryByRole('button', { name: 'Zone 2' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(onSave).toHaveBeenCalledWith([other]);
  });

  it('does not save a zone that is too small', () => {
    render(<ZoneEditor zones={[zone]} onSave={vi.fn()} onCancel={vi.fn()} />);
    const surface = drawingSurface();

    fireEvent.pointerDown(surface, { clientX: 500, clientY: 250, pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1 });

    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByText(/Zu klein/)).toBeInTheDocument();
  });

  it('cancels without saving', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<ZoneEditor zones={[zone]} onSave={onSave} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
