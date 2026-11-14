import type { Point } from '@nomol/core/detection/pose';
import type { Zone } from '@nomol/core/detection/zone';
import { startFigure, type StartFigure } from '@nomol/core/start-figure';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/** A stroke from `a` to `b` with round caps reaching past the ends, as on a canvas. */
function Segment({ a, b, width, color }: { a: Point; b: Point; width: number; color: string }) {
  const length = Math.hypot(b.x - a.x, b.y - a.y) + width;
  return (
    <View
      style={{
        position: 'absolute',
        left: (a.x + b.x) / 2 - length / 2,
        top: (a.y + b.y) / 2 - width / 2,
        width: length,
        height: width,
        borderRadius: width / 2,
        backgroundColor: color,
        transform: [{ rotate: `${Math.atan2(b.y - a.y, b.x - a.x)}rad` }],
      }}
    />
  );
}

/**
 * The figure drawn opaque and faded as a whole, like one stroked path on the web: separate
 * translucent strokes would stack up where they overlap and show the joints as darker blobs.
 */
function Layer({
  shape,
  width,
  color,
  opacity,
}: {
  shape: StartFigure;
  width: number;
  color: string;
  opacity: number;
}) {
  const { head } = shape;
  const outer = head.radius + width / 2;
  return (
    <View style={[StyleSheet.absoluteFill, { opacity }]} needsOffscreenAlphaCompositing>
      {shape.strokes.flatMap((points, i) =>
        points
          .slice(1)
          .map((b, j) => (
            <Segment key={`${i}-${j}`} a={points[j]!} b={b} width={width} color={color} />
          )),
      )}
      <View
        style={{
          position: 'absolute',
          left: head.x - outer,
          top: head.y - outer,
          width: 2 * outer,
          height: 2 * outer,
          borderRadius: outer,
          borderWidth: width,
          borderColor: color,
        }}
      />
    </View>
  );
}

/**
 * Faint animated figure in the start zone showing the start sign, as in the web app; faint so
 * the gymnast standing in the zone stays visible through it, with a light dark outline for
 * bright backgrounds. `width` and `height` are the picture's size on screen.
 */
export default function StartSign({
  zone,
  width,
  height,
}: {
  zone: Zone;
  width: number;
  height: number;
}) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    let frame = requestAnimationFrame(function tick(now) {
      setTime(now);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const shape = startFigure(zone, width, height, time);
  if (!shape) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Layer shape={shape} width={shape.lineWidth + 3} color="#000" opacity={0.12} />
      <Layer shape={shape} width={shape.lineWidth} color="rgb(60, 211, 176)" opacity={0.35} />
    </View>
  );
}
