import type { PointerEvent } from 'react';
import { LIMB_COLORS } from '@nomol/core/skeleton/lines';
import { BONES, KEYPOINT_NAMES, LABELLED, keypointColor } from './lib/keypoints';
import type { Keypoint } from './lib/tasks';

/** Tailwind's red-500, apart from every limb colour. */
const UNSURE_COLOR = '#ef4444';

type Props = {
  keypoints: Keypoint[];
  /** Image pixels per screen pixel, so lines and points keep their size when zooming. */
  unit: number;
  selected?: number | null;
  /** Points the model was unsure of, ringed. */
  unsure?: Set<number>;
  onGrab?: (index: number, event: PointerEvent) => void;
};

/**
 * The skeleton in image coordinates, the head as a line from between the shoulders to the nose
 * (as in the app); hidden points dashed, points not in the picture left out.
 */
export function Skeleton({ keypoints, unit, selected = null, unsure, onGrab }: Props) {
  const [nose, left, right] = [keypoints[0], keypoints[5], keypoints[6]];
  const neck =
    nose[2] && left[2] && right[2] ? [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2] : null;
  return (
    <g>
      {neck && (
        <line
          x1={neck[0]}
          y1={neck[1]}
          x2={nose[0]}
          y2={nose[1]}
          stroke={LIMB_COLORS.body}
          strokeWidth={3 * unit}
          strokeOpacity={0.8}
          strokeDasharray={nose[2] === 1 ? `${6 * unit} ${4 * unit}` : undefined}
        />
      )}
      {BONES.map(([a, b, color]) => {
        const [ax, ay, av] = keypoints[a];
        const [bx, by, bv] = keypoints[b];
        if (av === 0 || bv === 0) return null;
        return (
          <line
            key={`${a}-${b}`}
            x1={ax}
            y1={ay}
            x2={bx}
            y2={by}
            stroke={color}
            strokeWidth={3 * unit}
            strokeOpacity={0.8}
            strokeDasharray={av === 1 || bv === 1 ? `${6 * unit} ${4 * unit}` : undefined}
          />
        );
      })}
      {[...(unsure ?? [])].map((i) => (
        <circle
          key={`unsure-${i}`}
          cx={keypoints[i][0]}
          cy={keypoints[i][1]}
          r={13 * unit}
          fill="none"
          stroke={UNSURE_COLOR}
          strokeWidth={2.5 * unit}
          pointerEvents="none"
        />
      ))}
      {keypoints.map(([x, y, v], i) =>
        v === 0 || !LABELLED.includes(i) ? null : (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={(i === selected ? 8 : 5) * unit}
            fill={v === 2 ? keypointColor(i) : 'transparent'}
            stroke={i === selected ? '#ffffff' : keypointColor(i)}
            strokeWidth={2 * unit}
            className={onGrab ? 'cursor-grab' : undefined}
            onPointerDown={onGrab && ((event) => onGrab(i, event))}
          />
        ),
      )}
      {selected !== null && keypoints[selected][2] !== 0 && (
        <text
          x={keypoints[selected][0] + 12 * unit}
          y={keypoints[selected][1] - 12 * unit}
          fontSize={14 * unit}
          fill="#ffffff"
          stroke="#000000"
          strokeWidth={3 * unit}
          paintOrder="stroke"
          pointerEvents="none"
        >
          {KEYPOINT_NAMES[selected]}
        </text>
      )}
    </g>
  );
}
