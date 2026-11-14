import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Constants from 'expo-constants';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { CameraDevice } from 'react-native-vision-camera';
import { colors, styles as shared } from './theme';

const extra = Constants.expoConfig?.extra;
const APP_VERSION = typeof extra?.appVersion === 'string' ? extra.appVersion : 'unbekannt';
const BUILT_AT =
  typeof extra?.builtAt === 'string'
    ? new Date(extra.builtAt).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' })
    : 'unbekannt';

const POSITION: Record<CameraDevice['position'], string> = {
  back: 'Rückkamera',
  front: 'Frontkamera',
  external: 'Externe Kamera',
  unspecified: 'Kamera',
};

const LENS: Partial<Record<CameraDevice['type'], string>> = {
  'ultra-wide-angle': 'Ultraweitwinkel',
  telephoto: 'Tele',
};

function zoomText(zoom: number) {
  return zoom.toLocaleString('de-CH', { maximumFractionDigits: 1 });
}

/** e.g. "Rückkamera · 0,5–8×", so lenses that zoom out below 1× stand out. */
function cameraLabel(device: CameraDevice) {
  const lens = LENS[device.type];
  return [
    POSITION[device.position],
    lens,
    `${zoomText(device.minZoom)}–${zoomText(device.maxZoom)}×`,
  ]
    .filter(Boolean)
    .join(' · ');
}

type Props = {
  open: boolean;
  onClose: () => void;
  devices: CameraDevice[];
  deviceId: string | undefined;
  onDevice: (id: string) => void;
  /** The widest zoom of the current camera, if it goes below 1× (an ultra-wide lens). */
  wideZoom: number | undefined;
  wide: boolean;
  onWide: (wide: boolean) => void;
  soundOn: boolean;
  onSound: (on: boolean) => void;
};

/** What's set up once per device, kept off the live picture. */
export default function Settings({
  open,
  onClose,
  devices,
  deviceId,
  onDevice,
  wideZoom,
  wide,
  onWide,
  soundOn,
  onSound,
}: Props) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Einstellungen</Text>
              <Text style={styles.muted}>Gelten für dieses Gerät.</Text>
            </View>
            <Pressable accessibilityLabel="Schliessen" onPress={onClose} hitSlop={12}>
              <MaterialCommunityIcons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.heading}>Kamera</Text>
            {devices.map((device) => (
              <Pressable
                key={device.id}
                style={styles.row}
                accessibilityRole="radio"
                accessibilityState={{ selected: device.id === deviceId }}
                onPress={() => onDevice(device.id)}
              >
                <Text style={styles.text}>{cameraLabel(device)}</Text>
                <MaterialCommunityIcons
                  name={device.id === deviceId ? 'radiobox-marked' : 'radiobox-blank'}
                  size={20}
                  color={colors.text}
                />
              </Pressable>
            ))}
            {wideZoom !== undefined && (
              <View style={styles.row}>
                <Text style={styles.text}>{`Weitwinkel (${zoomText(wideZoom)}×)`}</Text>
                <Switch accessibilityLabel="Weitwinkel" value={wide} onValueChange={onWide} />
              </View>
            )}

            <Text style={styles.heading}>Ton</Text>
            <View style={styles.row}>
              <Text style={styles.text}>Piepton beim Aufnahmestart</Text>
              <Switch accessibilityLabel="Piepton" value={soundOn} onValueChange={onSound} />
            </View>

            <Text style={[styles.muted, styles.version]}>
              Version {APP_VERSION} · gebaut {BUILT_AT}
            </Text>
          </ScrollView>
          <Pressable style={[shared.button, styles.done]} onPress={onClose}>
            <Text style={shared.buttonText}>Fertig</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  dialog: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '100%',
    padding: 20,
    gap: 12,
    borderRadius: 12,
    backgroundColor: '#0f172a',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { color: colors.text, fontSize: 18, fontWeight: '600' },
  content: { gap: 8 },
  heading: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    minHeight: 40,
  },
  text: { flexShrink: 1, color: colors.text, fontSize: 14 },
  muted: { color: colors.muted, fontSize: 13 },
  version: { marginTop: 8, fontSize: 12 },
  done: { alignSelf: 'flex-end' },
});
