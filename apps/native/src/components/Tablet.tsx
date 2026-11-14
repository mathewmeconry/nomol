import type { Pose } from '@nomol/core/detection/pose';
import {
  initialSession,
  step,
  type RunUp,
  type SessionEvent,
  type SessionState,
} from '@nomol/core/detection/session';
import { coverPose, detectionArea, isInZone, type Zone } from '@nomol/core/detection/zone';
import { createStartSound } from '@nomol/native-modules';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { callback } from 'react-native-nitro-modules';
import {
  NativePreviewView,
  useCamera,
  useCameraDevices,
  usePreviewOutput,
  useVideoOutput,
} from 'react-native-vision-camera';
import { useClips } from '../hooks/use-clips';
import { useDragSpot } from '../hooks/use-drag-spot';
import { usePoseDetection, type Detected } from '../hooks/use-pose-detection';
import {
  finishRecording,
  recordFrame,
  startRecording,
  stillsPath,
  type ActiveRecording,
} from '../lib/recording';
import {
  loadCameraId,
  loadRunUp,
  loadSoundOn,
  loadWide,
  loadZone,
  saveCameraId,
  saveRunUp,
  saveSoundOn,
  saveWide,
  saveZone,
} from '../lib/settings';
import ClipPlayer from './ClipPlayer';
import ClipStrip from './ClipStrip';
import LiveControls, { type Status } from './LiveControls';
import PersonBox from './PersonBox';
import Settings from './Settings';
import StartHint from './StartHint';
import { colors, type Frame } from './theme';
import ZoneEditor from './ZoneEditor';

/** Until the preview reports its size; phone sensors are 4:3. */
const DEFAULT_ASPECT = 4 / 3;

/**
 * 4:3 like the preview and the detected frames, so the video shows exactly what was detected
 * (VisionCamera is patched to honour the aspect ratio). Full HD class: 1440×1080.
 */
const VIDEO_SIZE = { width: 1080, height: 1440 };

/** After "Aufnahme starten", wait this long for someone to step into the start zone. */
const ARMED_TIMEOUT_MS = 20_000;

/** Phones narrower than this get smaller thumbnails and live picture. */
const WIDE_SCREEN = 640;

/** Who gets a box: people in the start zone while waiting, the gymnast while recording. */
type Boxes = { poses: Pose[]; recording: boolean };

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
  const [zone, setZone] = useState<Zone>(loadZone);
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
  const sessionRef = useRef<SessionState>(initialSession);
  const activeRef = useRef<ActiveRecording | null>(null);
  /** Capture time of the last detected frame: where a recording stopped by hand ends. */
  const lastFrameTimeRef = useRef(0);
  /** Where the gymnast being recorded has been, so detection keeps looking there too. */
  const coveredRef = useRef<Zone | null>(null);
  const clipStripScrollRef = useRef(0);

  const device =
    devices.find((d) => d.id === cameraId) ??
    devices.find((d) => d.position === 'back') ??
    devices[0];
  // Phones often show their lenses as one back camera; zooming below 1× switches to the
  // ultra-wide lens.
  const wideZoom = device && device.minZoom < 1 ? device.minZoom : undefined;
  const mirrored = device?.position === 'front';

  const detection = usePoseDetection(onDetected);
  const { setLook } = detection;
  const previewOutput = usePreviewOutput();
  const videoOutput = useVideoOutput({ targetResolution: VIDEO_SIZE });
  useCamera({
    isActive: device !== undefined,
    device: device ?? 'back',
    outputs: [previewOutput, detection.frameOutput, videoOutput],
    // Stabilization crops the video, which then no longer matches the detected frames.
    constraints: [{ videoStabilizationMode: 'off' }],
    // The picture turns with the screen, so the zone stays where the coach drew it.
    orientationSource: 'interface',
    zoom: wide && wideZoom !== undefined ? wideZoom : 1,
    onError: (e) => setError(e.message),
  });

  const portrait = screen.height > screen.width;
  const aspectRatio = portrait ? 1 / sensorAspect : sensorAspect;
  const current = clips.find((clip) => clip.id === currentId) ?? null;
  const showReplay = view === 'replay' && current !== null && !editingZone;
  const compact = screen.width < WIDE_SCREEN;
  const liveWidth = screen.width * (compact ? 1 / 3 : 1 / 4);
  const livePicture = useDragSpot(
    screen,
    { width: liveWidth, height: liveWidth / aspectRatio },
    () => setView('live'),
  );
  const picture: Frame = showReplay
    ? { ...livePicture.position, width: liveWidth, height: liveWidth / aspectRatio }
    : fit(screen, aspectRatio);

  useEffect(() => {
    if (armedAt === null) return;
    const timer = setTimeout(() => setArmedAt(null), ARMED_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [armedAt]);

  // Paused while the coach draws the zone, so nobody starts a recording in the meantime.
  useEffect(() => {
    setLook(detectionArea(zone, aspectRatio, coveredRef.current), mirrored, editingZone);
  }, [setLook, zone, aspectRatio, mirrored, editingZone]);

  /**
   * The video starts once CameraX has started its recorder, a moment after the trigger. An
   * automatic start has no pre-roll yet: its video begins at the trigger, not before it.
   */
  function recordingStarted(event: Extract<SessionEvent, { type: 'start' }>, frameAspect: number) {
    const active = startRecording(videoOutput, () => lastFrameTimeRef.current, zone, frameAspect, {
      startReason: event.reason,
      runUp,
    });
    activeRef.current = active;
    pauseSkeleton(true);
    detection.saveStills(stillsPath(active));
    setRecordError(null);
    if (soundOn) startSound.play();
    setArmedAt(null);
  }

  function recordingStopped(time: number) {
    coveredRef.current = null;
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    detection.saveStills(null);
    finishRecording(active, time)
      .then(
        (clip) => {
          addClip(clip);
          setCurrentId(clip.id);
          setView('replay');
        },
        (e: unknown) => setRecordError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => {
        if (!activeRef.current) pauseSkeleton(false);
      });
  }

  function onDetected({ poses, time, aspectRatio: frameAspect, still }: Detected) {
    if (editingZone) return;
    lastFrameTimeRef.current = time;
    const result = step(sessionRef.current, {
      time,
      poses,
      zone,
      armed: armedAt !== null,
      runUp,
      aspectRatio: frameAspect,
    });
    sessionRef.current = result.state;
    if (result.event?.type === 'start') recordingStarted(result.event, frameAspect);
    const active = activeRef.current;
    if (active) recordFrame(active, time, result.target, still);
    if (result.event?.type === 'stop') recordingStopped(time);

    const recording = result.state.kind === 'recording';
    if (recording && result.target) {
      coveredRef.current = coverPose(coveredRef.current, result.target);
    }
    setLook(detectionArea(zone, frameAspect, coveredRef.current), mirrored, false);

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
        : { poses: poses.filter((pose) => isInZone(pose, zone)), recording },
    );
  }

  function stopByHand() {
    // Back to waiting for a start, as after a stop by sign, idling or leaving.
    sessionRef.current = initialSession;
    setStatus('idle');
    setBoxes({ poses: [], recording: false });
    recordingStopped(lastFrameTimeRef.current);
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
          onLive={() => setView('live')}
          onDelete={() => {
            const remaining = removeClip(current);
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
        {!editingZone && (
          <View
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
        )}
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
          zone={zone}
          onCancel={() => setEditingZone(false)}
          onSave={(next) => {
            saveZone(next);
            setZone(next);
            setEditingZone(false);
          }}
        />
      ) : (
        <>
          <LiveControls
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
              setView('live');
              setEditingZone(true);
            }}
            onSettings={() => setSettingsOpen(true)}
            armed={armedAt !== null}
            onArm={(armed) => setArmedAt(armed ? Date.now() : null)}
            onStop={stopByHand}
          />
          {!showReplay && status === 'idle' && (
            <StartHint runUp={runUp} aboveClips={clips.length > 0} />
          )}
          {!showReplay && clips.length > 0 && <View style={styles.strip}>{clipStrip}</View>}
        </>
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
          removeAllClips();
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
  strip: { position: 'absolute', left: 16, right: 16, bottom: 16 },
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
