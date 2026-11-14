import type { Point, Pose } from '@nomol/core/detection/pose';
import { skeletonLines } from '@nomol/core/skeleton/lines';
import { StyleSheet, View } from 'react-native';

const LINE = 3.5;
/** A dark outline keeps the colours readable on bright mats and walls. */
const OUTLINE = 6;
const DOT = 8;

/** A line from `a` to `b` (in points) as a turned view; no drawing library needed. */
function Line({ a, b, width, color }: { a: Point; b: Point; width: number; color: string }) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
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
 * The replay skeleton over the video, as in the web app: left warm, right cool, arms lighter
 * than legs, with the head. `width` and `height` are the picture's size on screen (zoomed).
 */
export default function SkeletonOverlay({
  pose,
  width,
  height,
}: {
  pose: Pose;
  width: number;
  height: number;
}) {
  const lines = skeletonLines(pose).map(
    ([a, b, color]) =>
      [{ x: a.x * width, y: a.y * height }, { x: b.x * width, y: b.y * height }, color] as const,
  );
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {lines.map(([a, b], i) => (
        <Line key={`o${i}`} a={a} b={b} width={OUTLINE} color="rgba(0, 0, 0, 0.55)" />
      ))}
      {lines.map(([a, b, color], i) => (
        <Line key={`l${i}`} a={a} b={b} width={LINE} color={color} />
      ))}
      {lines.flatMap(([a, b, color], i) =>
        [a, b].map((p, j) => (
          <View
            key={`d${i}-${j}`}
            style={[
              styles.dot,
              { left: p.x - DOT / 2, top: p.y - DOT / 2, backgroundColor: color },
            ]}
          />
        )),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2 },
});
