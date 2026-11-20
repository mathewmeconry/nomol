import type { PointerEvent } from 'react';
import { BONES, KEYPOINT_NAMES, keypointColor } from './lib/keypoints';
import type { Keypoint } from './lib/tasks';

type Props = {
  keypoints: Keypoint[];
  /** Image pixels per screen pixel, so lines and points keep their size when zooming. */
  unit: number;
  selected?: number | null;
  onGrab?: (index: number, event: PointerEvent) => void;
};

/** The skeleton in image coordinates; hidden points dashed, points not in the picture left out. */
export function Skeleton({ keypoints, unit, selected = null, onGrab }: Props) {
  return (
    <g>
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
      {keypoints.map(([x, y, v], i) =>
        v === 0 ? null : (
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
