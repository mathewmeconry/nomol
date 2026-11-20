import type { Pose } from '@nomol/core/detection/pose';
import {
  gymnastArea,
  initialSession,
  step,
  type RunUp,
  type SessionEvent,
  type SessionState,
} from '@nomol/core/detection/session';
import { detectionAreas, isInZone, type Zone } from '@nomol/core/detection/zone';
import { screenLayout, type Layout } from '@nomol/core/layout';
import type { Clip } from '@nomol/core/recording/clip';
import { learnFloor, type FloorHint } from '@nomol/core/recording/floor-line';
import type { Seen } from '@nomol/core/recording/preroll';
import { createClipRecorder, createStartSound } from '@nomol/native-modules';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callback } from 'react-native-nitro-modules';
import {
  NativePreviewView,
  useCamera,
  useCameraDevices,
  usePreviewOutput,
} from 'react-native-vision-camera';
import { useAppActive } from '../hooks/use-app-active';
import { useClips } from '../hooks/use-clips';
import { useDragSpot } from '../hooks/use-drag-spot';
import { usePoseDetection, type Detected } from '../hooks/use-pose-detection';
import {
  addPreroll,
  finishRecording,
  prerollStillsPath,
  recordFrame,
  rememberFrame,
  startRecording,
  stillsPath,
  type ActiveRecording,
} from '../lib/recording';
import {
  loadCameraId,
  loadRunUp,
  loadSoundOn,
  loadWide,
  loadZones,
  saveCameraId,
  saveRunUp,
  saveSoundOn,
  saveWide,
  saveZones,
} from '../lib/settings';
import ClipPlayer from './ClipPlayer';
import ClipStrip from './ClipStrip';
import FloorLineNote from './FloorLineNote';
import LiveControls, { type Status } from './LiveControls';
import PersonBox from './PersonBox';
import Settings from './Settings';
import StartSign from './StartSign';
import { colors, type Frame } from './theme';
import ZoneEditor from './ZoneEditor';

/** Until the preview reports its size; phone sensors are 4:3. */
const DEFAULT_ASPECT = 4 / 3;

/** After "Aufnahme starten", wait this long for someone to step into the start zone. */
const ARMED_TIMEOUT_MS = 20_000;

/** How long the camera's light shines when a recording starts. */
const TORCH_BLINK_MS = 500;

/** Android's `ActivityInfo.SCREEN_ORIENTATION_LOCKED`: stays as it is now. */
const SCREEN_ORIENTATION_LOCKED = 14;

/** Phones narrower than this get smaller thumbnails and live picture. */
const WIDE_SCREEN = 640;

/** Narrowest strip beside the picture that holds the zone editor's bar. */
const ZONE_STRIP_MIN = 176;

/** Who gets a box: people in the start zone while waiting, the gymnast while recording. */
type Boxes = { poses: Pose[]; recording: boolean };

/** `layout` moved by `dx`, `dy`: laid out in the safe area, which starts there. */
function moveLayout(layout: Layout, dx: number, dy: number): Layout {
  function move(rect: Frame): Frame {
    return { ...rect, left: rect.left + dx, top: rect.top + dy };
  }
  return {
    dock: layout.dock,
    picture: move(layout.picture),
    strip: layout.strip && move(layout.strip),
    recordStrip: layout.recordStrip && move(layout.recordStrip),
  };
}

/** Where a picture of the given aspect ratio (width / height) fits, centred, on the screen. */
function fit(screen: { width: number; height: number }, aspectRatio: number): Frame {
  const width = Math.min(screen.width, screen.height * aspectRatio);
  const height = width / aspectRatio;
  return { left: (screen.width - width) / 2, top: (screen.height - height) / 2, width, height };
}

/**
 * The screen: camera picture, start zone and the controls over it; records, and switches
 * between the live picture and the replay. Detection keeps running during the replay.
 */
export default function Tablet() {
  const devices = useCameraDevices();
  const [cameraId, setCameraId] = useState(loadCameraId);
  const [wide, setWide] = useState(loadWide);
  const [soundOn, setSoundOn] = useState(loadSoundOn);
  const [zones, setZones] = useState<Zone[]>(loadZones);
  const [runUp, setRunUp] = useState<RunUp | null>(loadRunUp);
  const [editingZone, setEditingZone] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [screen, setScreen] = useState({ width: 0, height: 0 });
  /** Width / height of the camera picture in sensor orientation (landscape). */
  const [sensorAspect, setSensorAspect] = useState(DEFAULT_ASPECT);
  const [error, setError] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<Exclude<Status, 'loading'>>('idle');
  const [boxes, setBoxes] = useState<Boxes>({ poses: [], recording: false });
  const [startSound] = useState(createStartSound);
  const [torchOn, setTorchOn] = useState(false);
  const {
    clips,
    skeletonProgress,
    add: addClip,
    remove: removeClip,
    removeAll: removeAllClips,
    pauseSkeleton,
  } = useClips();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [view, setView] = useState<'live' | 'replay'>('live');
  /** A finished clip, shown once the replay on screen has been watched (`ClipPlayer`). */
  const [nextId, setNextId] = useState<string | null>(null);
  const sessionRef = useRef<SessionState>(initialSession);
  const activeRef = useRef<ActiveRecording | null>(null);
  /** While waiting for an automatic start: recent detections, and where their stills go. */
  const seenRef = useRef<Seen<string>[]>([]);
  const prerollStillsRef = useRef<string | null>(null);
  /** Where the frame worklet currently saves stills (`saveStills`). */
  const stillsDirRef = useRef<string | null>(null);
  const clipStripScrollRef = useRef(0);
  /** The start zone (one of `zones`) the running recording began in. */
  const startZoneRef = useRef<Zone | null>(null);
  /** Recent `floorHint`s per zone; forgotten when the zones are drawn anew. */
  const floorHintsRef = useRef<FloorHint[][]>([]);
  /** The zones before the floor line last moved by itself, while that can be undone. */
  const [floorUndo, setFloorUndo] = useState<Zone[] | null>(null);
  /**
   * Below the picture the strip is as high as what's in it: the controls, or the zone editor's
   * bar while drawing. Measured (0 until then); kept while the controls float, so they don't
   * dock where they wouldn't fit.
   */
  const [controlsHeight, setControlsHeight] = useState(0);
  const [zoneBarHeight, setZoneBarHeight] = useState(0);
  const insets = useSafeAreaInsets();

  const found =
    devices.find((d) => d.id === cameraId) ??
    devices.find((d) => d.position === 'back') ??
    devices[0];
  // The list is reported again with new objects once CameraX has checked which cameras are
  // there; a new object for the same camera would set the camera up anew.
  const [device, setDevice] = useState(found);
  if (found?.id !== device?.id) setDevice(found);
  // Phones often show their lenses as one back camera; zooming below 1× switches to the
  // ultra-wide lens.
  const wideZoom = device && device.minZoom < 1 ? device.minZoom : undefined;
  const mirrored = device?.position === 'front';

  const detection = usePoseDetection(onDetected);
  const { setLook } = detection;
  const previewOutput = usePreviewOutput();
  const [clipRecorder] = useState(createClipRecorder);
  // Read once: each read of the property gives a new JS object.
  const [clipOutput] = useState(() => clipRecorder.output);
  const appActive = useAppActive();
  useCamera({
    // Stopped in the background: VisionCamera only pauses its lifecycle there, Android then takes
    // the camera away, and after a while CameraX was left with an error it doesn't recover from.
    // Started again on return, the camera is opened anew.
    isActive: device !== undefined && appActive,
    device: device ?? 'back',
    // Two full-size Previews and the analysis stream can't run together (the Pixel 8 allows
    // Preview + VGA Preview + YUV): CameraX gives the first output the larger size, and the
    // clip matters more than the picture on screen.
    outputs: [clipOutput, previewOutput, detection.frameOutput],
    // Stabilization crops the video, which then no longer matches the detected frames.
    constraints: [{ videoStabilizationMode: 'off' }],
    // The picture turns with the screen, so the zone stays where the coach drew it.
    orientationSource: 'interface',
    zoom: wide && wideZoom !== undefined ? wideZoom : 1,
    // Front cameras have no light; asking them would only report an error.
    torchMode: device?.hasTorch ? (torchOn ? 'on' : 'off') : undefined,
    onStarted: () => setError(null),
    onError: (e) => {
      // A zoom sent while the camera is being set up anew is cancelled; the new setup applies
      // the zoom itself.
      if (e.message.includes('Camera is not active')) return;
      setError(e.message);
    },
  });

  const portrait = screen.height > screen.width;
  const aspectRatio = portrait ? 1 / sensorAspect : sensorAspect;
  const current = clips.find((clip) => clip.id === currentId) ?? null;
  const showReplay = view === 'replay' && current !== null && !editingZone;
  // Without a replay on screen, a finished clip opens right away.
  if (nextId !== null && !showReplay) {
    setCurrentId(nextId);
    setView('replay');
    setNextId(null);
  }
  const buffering = runUp !== null && detection.ready && !editingZone && status !== 'recording';
  const compact = screen.width < WIDE_SCREEN;
  const liveWidth = screen.width * (compact ? 1 / 3 : 1 / 4);
  const livePicture = useDragSpot(
    screen,
    { width: liveWidth, height: liveWidth / aspectRatio },
    showLive,
  );
  // The app draws under the camera hole; picture and strips are laid out beside it.
  const layout = moveLayout(
    screenLayout(
      screen.width - insets.left - insets.right,
      screen.height - insets.top - insets.bottom,
      aspectRatio,
      (editingZone ? zoneBarHeight : controlsHeight) || undefined,
    ),
    insets.left,
    insets.top,
  );
  // The replay fills the screen with its controls over it, so nothing is docked meanwhile.
  const dock = showReplay ? null : layout.dock;
  // Its text and buttons need some width: left of a 16:9 picture the strip is too narrow, and
  // the zone editor's bar goes over the picture as without a strip.
  const zoneDock: Frame | null =
    dock === 'bottom' && layout.strip
      ? { ...layout.strip, height: screen.height - insets.bottom - layout.strip.top }
      : dock === 'side' && layout.strip && layout.strip.width >= ZONE_STRIP_MIN
        ? layout.strip
        : null;
  const picture: Frame = showReplay
    ? { ...livePicture.position, width: liveWidth, height: liveWidth / aspectRatio }
    : layout.picture;

  // The picture turns with the screen; turned mid-recording, the detected poses would no longer
  // match the video, whose orientation is fixed when it begins.
  const isRecording = status === 'recording';
  useEffect(() => {
    if (!isRecording) return;
    ScreenOrientation.lockPlatformAsync({
      screenOrientationConstantAndroid: SCREEN_ORIENTATION_LOCKED,
    }).catch(() => {});
    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, [isRecording]);

  useEffect(() => {
    if (armedAt === null) return;
    const timer = setTimeout(() => setArmedAt(null), ARMED_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [armedAt]);

  useEffect(() => {
    if (!torchOn) return;
    const timer = setTimeout(() => setTorchOn(false), TORCH_BLINK_MS);
    return () => clearTimeout(timer);
  }, [torchOn]);

  // Paused while the coach draws the zone, so nobody starts a recording in the meantime.
  useEffect(() => {
    setLook(
      detectionAreas(
        zones,
        aspectRatio,
        gymnastArea(sessionRef.current, aspectRatio),
        runUp !== null,
      ),
      mirrored,
      editingZone,
    );
  }, [setLook, zones, aspectRatio, mirrored, editingZone, runUp]);

  // Automatic starts come late, so the recorder keeps the last seconds encoded while waiting,
  // and the detections with stills of whoever is there.
  useEffect(() => {
    clipRecorder.setBuffering(buffering);
    if (!buffering) return;
    prerollStillsRef.current = prerollStillsPath();
    return () => {
      prerollStillsRef.current = null;
      seenRef.current = [];
    };
  }, [clipRecorder, buffering]);

  // Back returns to the live picture and never leaves the app, which hangs at the apparatus and
  // would otherwise close by a stray swipe. Settings and the start sheet close on it themselves.
  const onBack = useEffectEvent(() => {
    if (editingZone) setEditingZone(false);
    else showLive();
    return true;
  });
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => subscription.remove();
  }, []);

  /** The live picture, chosen by hand: a clip waiting to be shown stays in the list only. */
  function showLive() {
    setView('live');
    setNextId(null);
  }

  function saveStills(dir: string | null) {
    if (dir === stillsDirRef.current) return;
    stillsDirRef.current = dir;
    detection.saveStills(dir);
  }

  /**
   * The video starts at the next keyframe after the trigger; an automatic start's at a buffered
   * keyframe 1.5–2 s before it, with the runner traced back over the frames since.
   */
  function recordingStarted(
    event: Extract<SessionEvent, { type: 'start' }>,
    poses: Pose[],
    time: number,
    frameAspect: number,
  ) {
    const active = startRecording(clipRecorder, time, event.zone, frameAspect, mirrored, {
      startReason: event.reason,
      runUp,
    });
    if (event.reason === 'runUp') addPreroll(active, seenRef.current, event.pose, poses, time);
    activeRef.current = active;
    startZoneRef.current = event.zone;
    pauseSkeleton(true);
    saveStills(stillsPath(active));
    setRecordError(null);
    if (soundOn) startSound.play();
    setTorchOn(true);
    setArmedAt(null);
  }

  function recordingStopped() {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    const startZone = startZoneRef.current;
    saveStills(null);
    finishRecording(active)
      .then(
        (clip) => {
          if (startZone) adjustFloor(startZone, clip);
          addClip(clip);
          setNextId(clip.id);
        },
        (e: unknown) => setRecordError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => {
        if (!activeRef.current) pauseSkeleton(false);
      });
  }

  /**
   * Moves the floor line of the zone the clip started in up to where gymnasts stand. The clip's
   * own zone is mirrored for a front camera; its bottom edge is the same.
   */
  function adjustFloor(startZone: Zone, clip: Clip) {
    const learned = learnFloor(zones, startZone, clip, floorHintsRef.current);
    floorHintsRef.current = learned.hints;
    if (!learned.zones) return;
    saveZones(learned.zones);
    setZones(learned.zones);
    setFloorUndo(zones);
  }

  function onDetected({ poses, time, aspectRatio: frameAspect, still }: Detected) {
    if (editingZone) return;
    const result = step(sessionRef.current, {
      time,
      poses,
      zones,
      armed: armedAt !== null,
      runUp,
      aspectRatio: frameAspect,
    });
    sessionRef.current = result.state;
    if (result.event?.type === 'start') {
      recordingStarted(result.event, poses, time, frameAspect);
    } else if (!activeRef.current) {
      const preroll = prerollStillsRef.current;
      if (preroll) seenRef.current = rememberFrame(seenRef.current, time, poses, still);
      // Stills only while someone is there, as only they can be the runner.
      saveStills(preroll && poses.length > 0 ? preroll : null);
    }
    const active = activeRef.current;
    if (active) recordFrame(active, time, result.target, still);
    if (result.event?.type === 'stop') recordingStopped();

    const recording = result.state.kind === 'recording';
    setLook(
      detectionAreas(zones, frameAspect, gymnastArea(result.state, frameAspect), runUp !== null),
      mirrored,
      false,
    );

    setStatus(
      recording
        ? 'recording'
        : armedAt !== null
          ? 'armed'
          : result.state.signSince !== null && !result.state.waitForRelease
            ? 'sign'
            : 'idle',
    );
    setBoxes(
      recording
        ? { poses: result.target ? [result.target] : [], recording }
        : { poses: poses.filter((pose) => zones.some((zone) => isInZone(pose, zone))), recording },
    );
  }

  function stopByHand() {
    // Back to waiting for a start, as after a stop by sign, idling or leaving.
    sessionRef.current = initialSession;
    setStatus('idle');
    setBoxes({ poses: [], recording: false });
    recordingStopped();
  }

  const clipStrip = (
    <ClipStrip
      clips={clips}
      currentId={showReplay ? currentId : null}
      scrollRef={clipStripScrollRef}
      compact={compact}
      onSelect={(clip) => {
        setCurrentId(clip.id);
        setView('replay');
        setNextId(null);
      }}
    />
  );

  return (
    <View
      style={styles.root}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setScreen({ width, height });
      }}
    >
      {showReplay && (
        <ClipPlayer
          key={current.id}
          clip={current}
          skeletonProgress={skeletonProgress[current.id] ?? null}
          picture={fit(screen, current.aspectRatio)}
          clipStrip={clipStrip}
          newerClip={nextId !== null}
          onWatched={() => {
            setCurrentId(nextId);
            setNextId(null);
          }}
          onLive={showLive}
          onDelete={() => {
            const remaining = removeClip(current);
            setNextId(null);
            setCurrentId(remaining[0]?.id ?? null);
            if (remaining.length === 0) setView('live');
          }}
        />
      )}

      <View
        style={[styles.picture, picture, showReplay && styles.small]}
        {...(showReplay ? livePicture.handlers : {})}
        accessibilityLabel={
          showReplay ? 'Live-Bild gross anzeigen, zum Verschieben ziehen' : undefined
        }
      >
        <NativePreviewView
          style={StyleSheet.absoluteFill}
          previewOutput={previewOutput}
          resizeMode="contain"
          onPreviewStarted={callback(() => {
            const size = previewOutput.currentResolution;
            if (size?.width && size.height) {
              setSensorAspect(
                Math.max(size.width, size.height) / Math.min(size.width, size.height),
              );
            }
          })}
        />
        {!editingZone &&
          zones.map((zone, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={[
                styles.zone,
                {
                  left: zone.left * picture.width,
                  top: zone.top * picture.height,
                  width: (zone.right - zone.left) * picture.width,
                  height: (zone.bottom - zone.top) * picture.height,
                },
              ]}
            >
              <Text style={styles.zoneLabel}>STARTZONE</Text>
            </View>
          ))}
        {!editingZone &&
          status !== 'recording' &&
          runUp === null &&
          zones.map((zone, i) => (
            <StartSign key={i} zone={zone} width={picture.width} height={picture.height} />
          ))}
        {!editingZone &&
          boxes.poses.map((pose, i) => (
            <PersonBox
              key={i}
              pose={pose}
              picture={picture}
              color={boxes.recording ? '#ff6b70' : '#5ee6c8'}
              label={boxes.recording ? 'Aufnahme' : 'In Startzone'}
            />
          ))}
        {showReplay && (
          <Text
            pointerEvents="none"
            style={[
              styles.liveLabel,
              { color: status === 'recording' ? colors.red : colors.emerald },
            ]}
          >
            {status === 'recording' ? '● Live · Aufnahme' : 'Live'}
          </Text>
        )}
      </View>

      {editingZone ? (
        <ZoneEditor
          picture={picture}
          zones={zones}
          dock={zoneDock}
          side={dock === 'side'}
          onBarHeight={setZoneBarHeight}
          onCancel={() => setEditingZone(false)}
          onSave={(next) => {
            saveZones(next);
            setZones(next);
            setEditingZone(false);
            floorHintsRef.current = [];
            setFloorUndo(null);
          }}
        />
      ) : (
        <LiveControls
          dock={dock}
          strip={layout.strip}
          recordStrip={layout.recordStrip}
          onStripHeight={setControlsHeight}
          screenWidth={screen.width}
          editingZone={editingZone}
          replay={showReplay}
          clips={clips}
          onClips={() => {
            setCurrentId(clips[0].id);
            setView('replay');
            setNextId(null);
          }}
          status={detection.ready ? status : 'loading'}
          runUp={runUp}
          onRunUp={(next) => {
            saveRunUp(next);
            setRunUp(next);
          }}
          onEditZone={() => {
            // Detection pauses (see above); a half-held sign shouldn't count afterwards.
            sessionRef.current = initialSession;
            setArmedAt(null);
            setStatus('idle');
            setBoxes({ poses: [], recording: false });
            showLive();
            setEditingZone(true);
          }}
          onSettings={() => setSettingsOpen(true)}
          armed={armedAt !== null}
          onArm={(armed) => setArmedAt(armed ? Date.now() : null)}
          onStop={stopByHand}
        />
      )}

      {floorUndo && !editingZone && (
        <FloorLineNote
          onUndo={() => {
            saveZones(floorUndo);
            setZones(floorUndo);
            // Otherwise the next landing would move it straight back.
            floorHintsRef.current = [];
            setFloorUndo(null);
          }}
          onClose={() => setFloorUndo(null)}
        />
      )}

      {(error ?? recordError ?? detection.error) !== null && (
        <View style={styles.error} pointerEvents="none">
          <Text style={styles.errorText}>
            {error !== null
              ? `Kamerafehler: ${error}`
              : recordError !== null
                ? `Aufnahme fehlgeschlagen: ${recordError}`
                : `Die Erkennung läuft nicht: ${detection.error}`}
          </Text>
        </View>
      )}

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        devices={devices}
        deviceId={device?.id}
        onDevice={(id) => {
          saveCameraId(id);
          setCameraId(id);
          setError(null);
        }}
        wideZoom={wideZoom}
        wide={wide}
        onWide={(next) => {
          saveWide(next);
          setWide(next);
        }}
        soundOn={soundOn}
        onSound={(on) => {
          saveSoundOn(on);
          setSoundOn(on);
        }}
        recording={status === 'recording'}
        clipCount={clips.length}
        onDeleteAll={() => {
          removeAllClips(activeRef.current?.folder.id ?? null);
          setCurrentId(null);
          setView('live');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  picture: { position: 'absolute', overflow: 'hidden' },
  small: { borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255, 255, 255, 0.25)' },
  zone: {
    position: 'absolute',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.zone,
    backgroundColor: 'rgba(60, 211, 176, 0.08)',
  },
  zoneLabel: {
    position: 'absolute',
    top: -18,
    left: 4,
    color: colors.zoneLabel,
    fontSize: 12,
    fontWeight: '600',
  },
  liveLabel: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    fontSize: 12,
    fontWeight: '600',
  },
  error: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 120,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(127, 29, 29, 0.85)',
  },
  errorText: { color: colors.text, fontSize: 14, textAlign: 'center' },
});
