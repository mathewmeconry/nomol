import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { Point } from '@nomol/core/detection/pose';
import { frameDuration, poseAt, routineRange, type Clip } from '@nomol/core/recording/clip';
import { FULL_VIEW, zoomView, type View as Zoom } from '@nomol/core/zoom';
import { useEvent, useEventListener } from 'expo';
import { VideoView, useVideoPlayer, type VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { exportClip } from '../lib/clip-store';
import type { SkeletonProgress } from '../lib/skeleton';
import SkeletonOverlay from './SkeletonOverlay';
import { colors, type Frame } from './theme';
import Timeline from './Timeline';

/** One button cycles through these, to save space on phones. */
const SPEEDS = [
  { value: 1, label: '1×' },
  { value: 0.5, label: '½×' },
  { value: 0.25, label: '¼×' },
];

const STEPS = [
  { frames: -5, icon: 'chevron-double-left', name: '5 Bilder zurück' },
  { frames: -1, icon: 'chevron-left', name: '1 Bild zurück' },
  { frames: 1, icon: 'chevron-right', name: '1 Bild vor' },
  { frames: 5, icon: 'chevron-double-right', name: '5 Bilder vor' },
] as const;

const SKELETON_TEXT: Record<SkeletonProgress['stage'], string> = {
  compute: 'Skelett wird berechnet …',
  failed: 'Skelett konnte nicht berechnet werden.',
};

const CONTROLS_HIDE_MS = 3000;
/** Often enough for a smooth timeline and skeleton. */
const TIME_UPDATE_S = 1 / 30;
const DOUBLE_TAP_MS = 300;
/** Finger movement that still counts as a tap. */
const TAP_SLOP = 8;

function formatTime(ms: number) {
  const seconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`;
}

/** Fingers on the picture by touch id, where the first one went down, and if it's still a tap. */
type Gesture = { touches: Map<string, Point>; start: Point; startedAt: number; moved: boolean };

/**
 * expo-video's player is set up by assigning properties. Done out here: React treats what a hook
 * returns as read-only inside the component.
 */
function setPlayer(
  player: VideoPlayer,
  settings: Partial<Pick<VideoPlayer, 'currentTime' | 'playbackRate' | 'scrubbingModeOptions'>>,
) {
  Object.assign(player, settings);
}

/** Midpoint and spread of the first two fingers (spread 0 for one finger). */
function fingers(points: Point[]) {
  const [a, b = a] = points;
  return {
    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    spread: Math.hypot(a.x - b.x, a.y - b.y),
  };
}

type Props = {
  clip: Clip;
  /** While the skeleton is being computed; frames without one show no skeleton yet. */
  skeletonProgress: SkeletonProgress | null;
  /** Where the clip's picture fits on the screen. */
  picture: Frame;
  /** The list of recent clips, shown above the controls. */
  clipStrip: ReactNode;
  onLive: () => void;
  onDelete: () => void;
};

/**
 * Plays a clip's routine in a loop, with slow motion, frame stepping, pinch zoom and the replay
 * skeleton on top. Render it with `key={clip.id}` so switching clips starts fresh.
 */
export default function ClipPlayer({
  clip,
  skeletonProgress,
  picture,
  clipStrip,
  onLive,
  onDelete,
}: Props) {
  const [routine] = useState(() => routineRange(clip));
  // Half speed by default: elements are fast, and it still plays smoothly.
  const [speed, setSpeed] = useState(0.5);
  const player = useVideoPlayer(clip.url, (created) => {
    created.muted = true;
    created.playbackRate = 0.5;
    created.timeUpdateEventInterval = TIME_UPDATE_S;
    created.currentTime = routine.startMs / 1000;
    created.play();
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const [timeMs, setTimeMs] = useState(routine.startMs);
  const [skeleton, setSkeleton] = useState(true);
  const [exportFailed, setExportFailed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [lastTouch, setLastTouch] = useState(0);
  const [zoom, setZoom] = useState<Zoom>(FULL_VIEW);
  const scrubbingRef = useRef(false);

  useEffect(() => {
    setPlayer(player, { playbackRate: speed });
  }, [player, speed]);

  // On phones the controls cover much of the picture, so they fade out during playback.
  useEffect(() => {
    if (!isPlaying || !controlsVisible) return;
    const timer = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
    return () => clearTimeout(timer);
  }, [isPlaying, controlsVisible, lastTouch]);

  /** Where the last time update was, to notice playback crossing the routine's end. */
  const previousMsRef = useRef(routine.startMs);
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const ms = currentTime * 1000;
    const previous = previousMsRef.current;
    previousMsRef.current = ms;
    // Loops the routine only. Seeking outside it stays possible, e.g. if the trim was wrong.
    if (player.playing && previous < routine.endMs && ms >= routine.endMs) {
      setPlayer(player, { currentTime: routine.startMs / 1000 });
      previousMsRef.current = routine.startMs;
      setTimeMs(routine.startMs);
      return;
    }
    if (!scrubbingRef.current) setTimeMs(ms);
  });

  // Instead of `loop`, which would restart at 0 rather than the routine.
  useEventListener(player, 'playToEnd', () => {
    setPlayer(player, { currentTime: routine.startMs / 1000 });
    player.play();
  });

  /** Exact seeks (expo-video's default tolerance), paused so the frame stays. */
  function seek(ms: number) {
    const target = Math.min(Math.max(ms, 0), clip.durationMs);
    player.pause();
    setPlayer(player, { currentTime: target / 1000 });
    previousMsRef.current = target;
    setTimeMs(target);
  }

  function togglePlay() {
    if (player.playing) player.pause();
    else player.play();
  }

  /** Fingers on the picture, by touch id, and whether this touch is still a tap. */
  const gestureRef = useRef<Gesture>({
    touches: new Map(),
    start: { x: 0, y: 0 },
    startedAt: 0,
    moved: false,
  });
  const lastTapRef = useRef(0);

  function touchesOf(event: GestureResponderEvent) {
    return new Map(
      event.nativeEvent.touches.map(
        (touch) =>
          [
            String(touch.identifier),
            { x: touch.pageX - picture.left, y: touch.pageY - picture.top },
          ] as const,
      ),
    );
  }

  /** Two fingers zoom, one finger moves the zoomed picture. */
  function onPinchMove(event: GestureResponderEvent) {
    const gesture = gestureRef.current;
    const now = touchesOf(event);
    const ids = [...now.keys()].filter((id) => gesture.touches.has(id));
    if (ids.length > 0) {
      const before = fingers(ids.map((id) => gesture.touches.get(id)!));
      const after = fingers(ids.map((id) => now.get(id)!));
      const factor = before.spread > 0 ? after.spread / before.spread : 1;
      const moved = Math.hypot(after.center.x - before.center.x, after.center.y - before.center.y);
      if (moved > 0 || factor !== 1) {
        setZoom((view) =>
          zoomView(view, factor, before.center, after.center, picture.width, picture.height),
        );
      }
    }
    const point = [...now.values()][0];
    const { start } = gesture;
    if (now.size > 1 || (point && Math.hypot(point.x - start.x, point.y - start.y) > TAP_SLOP)) {
      gesture.moved = true;
    }
    gesture.touches = now;
  }

  /** A double tap resets the zoom. */
  function onPinchEnd() {
    const gesture = gestureRef.current;
    if (gesture.moved || Date.now() - gesture.startedAt > DOUBLE_TAP_MS) return;
    if (Date.now() - lastTapRef.current < DOUBLE_TAP_MS) {
      setZoom(FULL_VIEW);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = Date.now();
    }
  }

  const pose = skeleton ? poseAt(clip.skeleton, timeMs) : null;
  const zoomed = {
    left: zoom.x,
    top: zoom.y,
    width: picture.width * zoom.scale,
    height: picture.height * zoom.scale,
  };
  const speedLabel = SPEEDS.find((s) => s.value === speed)?.label;

  return (
    <View
      style={styles.root}
      onTouchStart={() => {
        setControlsVisible(true);
        setLastTouch(Date.now());
      }}
    >
      {/* The clip's own shape: the phone may have been turned since it was recorded. */}
      <View
        style={[styles.picture, picture]}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(event) => {
          const touches = touchesOf(event);
          const start = [...touches.values()][0] ?? { x: 0, y: 0 };
          gestureRef.current = { touches, start, startedAt: Date.now(), moved: false };
        }}
        onResponderMove={onPinchMove}
        onResponderRelease={onPinchEnd}
      >
        {/* Zoomed by size rather than a transform, so the skeleton's lines stay thin. */}
        <View pointerEvents="none" style={[styles.zoomed, zoomed]}>
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            nativeControls={false}
            contentFit="fill"
            surfaceType="textureView"
          />
          {pose && <SkeletonOverlay pose={pose} width={zoomed.width} height={zoomed.height} />}
        </View>
      </View>

      <View
        style={[styles.controls, !controlsVisible && styles.hidden]}
        pointerEvents={controlsVisible ? 'box-none' : 'none'}
      >
        {clipStrip}
        {skeletonProgress && (
          <View style={styles.progressRow} accessibilityRole="progressbar">
            <Text style={styles.progressText}>{SKELETON_TEXT[skeletonProgress.stage]}</Text>
            {skeletonProgress.stage !== 'failed' && (
              <>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressBar, { width: `${skeletonProgress.percent}%` }]} />
                </View>
                <Text style={[styles.progressText, styles.mono, styles.percent]}>
                  {skeletonProgress.percent} %
                </Text>
              </>
            )}
          </View>
        )}
        <Timeline
          valueMs={timeMs}
          durationMs={clip.durationMs}
          onScrubStart={() => {
            scrubbingRef.current = true;
            setPlayer(player, { scrubbingModeOptions: { scrubbingModeEnabled: true } });
          }}
          onScrub={seek}
          onScrubEnd={() => {
            scrubbingRef.current = false;
            setPlayer(player, { scrubbingModeOptions: { scrubbingModeEnabled: false } });
          }}
        />
        <View style={styles.row}>
          <Pressable
            style={[styles.button, styles.primary]}
            accessibilityLabel={isPlaying ? 'Pause' : 'Abspielen'}
            onPress={togglePlay}
          >
            <MaterialCommunityIcons name={isPlaying ? 'pause' : 'play'} size={22} color="#020618" />
          </Pressable>
          <View style={styles.group} accessibilityLabel="Bild für Bild">
            {STEPS.map(({ frames, icon, name }) => (
              <Pressable
                key={frames}
                style={styles.button}
                accessibilityLabel={name}
                onPress={() => seek(timeMs + frames * frameDuration(clip))}
              >
                <MaterialCommunityIcons name={icon} size={22} color={colors.text} />
              </Pressable>
            ))}
          </View>
          <Pressable
            style={styles.button}
            accessibilityLabel="Geschwindigkeit"
            onPress={() =>
              setSpeed(
                SPEEDS[(SPEEDS.findIndex((s) => s.value === speed) + 1) % SPEEDS.length].value,
              )
            }
          >
            <Text style={[styles.text, styles.mono]}>{speedLabel}</Text>
          </Pressable>
          {clip.skeleton.length > 0 && (
            <Pressable
              style={[styles.button, skeleton && styles.on]}
              accessibilityRole="switch"
              accessibilityState={{ checked: skeleton }}
              onPress={() => setSkeleton(!skeleton)}
            >
              <Text style={[styles.text, skeleton && { color: colors.sky }]}>Skelett</Text>
            </Pressable>
          )}
          <Text style={[styles.time, styles.mono]}>
            {formatTime(timeMs)} / {formatTime(clip.durationMs)}
          </Text>

          <View style={styles.spacer} />
          <Pressable
            style={styles.button}
            accessibilityLabel="Export"
            onPress={() => {
              try {
                exportClip(clip);
                setExportFailed(false);
              } catch (_error) {
                setExportFailed(true);
              }
            }}
          >
            <MaterialCommunityIcons name="share-variant" size={18} color={colors.text} />
            {exportFailed && <Text style={styles.text}>Export fehlgeschlagen</Text>}
          </Pressable>
          {/* Two taps, because the clip is gone for good. */}
          <Pressable
            style={[styles.button, confirmingDelete && styles.destructive]}
            accessibilityLabel="Löschen"
            onPress={() => (confirmingDelete ? onDelete() : setConfirmingDelete(true))}
          >
            <MaterialCommunityIcons
              name="trash-can-outline"
              size={18}
              color={confirmingDelete ? colors.text : colors.red}
            />
            {confirmingDelete && <Text style={styles.text}>Wirklich löschen?</Text>}
          </Pressable>
          <Pressable style={styles.button} onPress={onLive}>
            <Text style={[styles.text, { color: colors.emerald }]}>Live</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: '#000' },
  picture: { position: 'absolute', overflow: 'hidden' },
  zoomed: { position: 'absolute' },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  hidden: { opacity: 0 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  group: { flexDirection: 'row', gap: 4 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 40,
    height: 36,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  primary: { width: 48, backgroundColor: colors.text },
  on: { borderWidth: 1, borderColor: colors.sky },
  destructive: { backgroundColor: colors.destructive },
  text: { color: colors.text, fontSize: 14, fontWeight: '600' },
  mono: { fontFamily: 'monospace' },
  time: { color: '#cbd5e1', fontSize: 12 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progressText: { color: '#cbd5e1', fontSize: 12 },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  progressBar: { height: '100%', backgroundColor: colors.text },
  percent: { width: 40, textAlign: 'right' },
  spacer: { flex: 1 },
});
