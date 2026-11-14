import type { RunUp } from '@nomol/core/detection/session';
import type { Zone } from '@nomol/core/detection/zone';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { callback } from 'react-native-nitro-modules';
import {
  NativePreviewView,
  useCamera,
  useCameraDevices,
  usePreviewOutput,
} from 'react-native-vision-camera';
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
import LiveControls from './LiveControls';
import Settings from './Settings';
import StartHint from './StartHint';
import { colors, type Frame } from './theme';
import ZoneEditor from './ZoneEditor';

/** Until the preview reports its size; phone sensors are 4:3. */
const DEFAULT_ASPECT = 4 / 3;

/** Where a picture of the given aspect ratio (width / height) fits, centred, on the screen. */
function fit(screen: { width: number; height: number }, aspectRatio: number): Frame {
  const width = Math.min(screen.width, screen.height * aspectRatio);
  const height = width / aspectRatio;
  return { left: (screen.width - width) / 2, top: (screen.height - height) / 2, width, height };
}

/** The live screen: camera picture, start zone and the controls over it. */
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

  const device =
    devices.find((d) => d.id === cameraId) ??
    devices.find((d) => d.position === 'back') ??
    devices[0];
  // Phones often show their lenses as one back camera; zooming below 1× switches to the
  // ultra-wide lens.
  const wideZoom = device && device.minZoom < 1 ? device.minZoom : undefined;

  const previewOutput = usePreviewOutput();
  useCamera({
    isActive: device !== undefined,
    device: device ?? 'back',
    outputs: [previewOutput],
    // The picture turns with the screen, so the zone stays where the coach drew it.
    orientationSource: 'interface',
    zoom: wide && wideZoom !== undefined ? wideZoom : 1,
    onError: (e) => setError(e.message),
  });

  const portrait = screen.height > screen.width;
  const aspectRatio = portrait ? 1 / sensorAspect : sensorAspect;
  const picture = fit(screen, aspectRatio);

  return (
    <View
      style={styles.root}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setScreen({ width, height });
      }}
    >
      <View style={[styles.picture, picture]}>
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
            runUp={runUp}
            onRunUp={(next) => {
              saveRunUp(next);
              setRunUp(next);
            }}
            onEditZone={() => setEditingZone(true)}
            onSettings={() => setSettingsOpen(true)}
          />
          <StartHint runUp={runUp} />
        </>
      )}

      {error !== null && (
        <View style={styles.error} pointerEvents="none">
          <Text style={styles.errorText}>Kamerafehler: {error}</Text>
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  picture: { position: 'absolute', overflow: 'hidden' },
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
