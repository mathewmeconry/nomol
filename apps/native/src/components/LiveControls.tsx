import type { RunUp } from '@nomol/core/detection/session';
import type { Dock } from '@nomol/core/layout';
import type { Clip } from '@nomol/core/recording/clip';
import { startMode } from '@nomol/core/start-modes';
import {
  ChevronDown,
  Circle,
  Settings as SettingsIcon,
  Square,
  SquareDashed,
  X,
} from 'lucide-react-native';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import StartModeSheet from './StartModeSheet';
import { colors, styles as shared, type Frame } from './theme';

/** `loading` until the pose model is ready; the others as in the web app. */
export type Status = 'loading' | 'idle' | 'sign' | 'armed' | 'recording';

const STATUS_TEXT: Record<Status, string> = {
  loading: 'Erkennung startet …',
  idle: 'Bereit',
  sign: 'Zeichen erkannt …',
  armed: 'Warte auf Person in der Startzone',
  recording: 'Aufnahme läuft',
};

const STATUS_COLOR: Record<Status, string> = {
  loading: colors.muted,
  idle: colors.emerald,
  sign: colors.amber,
  armed: colors.amber,
  recording: colors.red,
};

/** Strips narrower than this get smaller buttons, so their labels don't run into each other. */
const NARROW_STRIP = 288;
/** Left of a 16:9 picture: the start button's name wraps and loses its arrow. */
const TIGHT_STRIP = 144;
/** Where the screen is this wide the start sheet shows two columns. */
const WIDE_SCREEN = 640;

type Props = {
  /** Where the controls sit: in the strips beside or below the picture, or over it (null). */
  dock: Dock;
  /** Below the picture, or left of it. */
  strip: Frame | null;
  /** Right of the picture (`side` only): the record button and its row. */
  recordStrip: Frame | null;
  /** The height the controls below the picture need, padding included. */
  onStripHeight: (height: number) => void;
  screenWidth: number;
  status: Status;
  runUp: RunUp | null;
  onRunUp: (runUp: RunUp | null) => void;
  editingZone: boolean;
  onEditZone: () => void;
  onSettings: () => void;
  armed: boolean;
  onArm: (armed: boolean) => void;
  onStop: () => void;
  /** A clip is on screen: only the status, a small record button and the settings stay. */
  replay: boolean;
  /** Newest first. */
  clips: Clip[];
  onClips: () => void;
};

/**
 * Laid out like a phone's camera app, as in the web app: status on top, then how recordings
 * start, and a row with the clips, a large round record button and the start zone, lowest within
 * thumb reach. In landscape that row stands upright right of the picture, the rest is left of it.
 * Hidden while drawing the zone, whose own bar takes its place.
 */
export default function LiveControls({
  dock,
  strip,
  recordStrip,
  onStripHeight,
  screenWidth,
  status,
  runUp,
  onRunUp,
  editingZone,
  onEditZone,
  onSettings,
  armed,
  onArm,
  onStop,
  replay,
  clips,
  onClips,
}: Props) {
  const [choosingMode, setChoosingMode] = useState(false);
  // The app draws under the camera hole. The strips lie beside it (`Tablet` lays out the safe
  // area) and only keep clear of the rounded screen corners; floating controls keep clear of both.
  const insets = useSafeAreaInsets();
  const edge = {
    top: Math.max(EDGE, insets.top),
    bottom: Math.max(EDGE, insets.bottom),
    left: Math.max(EDGE, insets.left),
    right: Math.max(EDGE, insets.right),
  };
  const mode = startMode(runUp);
  const recording = status === 'recording';
  const canArm = status !== 'loading';
  const latest = clips[0];
  const narrow = (dock === 'side' ? recordStrip : strip)?.width ?? Infinity;
  const small = narrow < NARROW_STRIP;
  const tight = dock === 'side' && (strip?.width ?? Infinity) < TIGHT_STRIP;

  const statusLine = (
    <View
      style={[
        styles.status,
        dock === 'bottom' && styles.grow,
        dock === 'side' && styles.statusSide,
        !dock && shared.floating,
      ]}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.dot, { backgroundColor: STATUS_COLOR[status] }]} />
      <Text
        style={[
          styles.statusText,
          !dock && styles.statusFloating,
          tight && styles.statusTight,
          { color: STATUS_COLOR[status] },
        ]}
      >
        {STATUS_TEXT[status]}
      </Text>
    </View>
  );
  const settings = (
    <Pressable
      style={[styles.round, !dock && shared.floating, !dock && styles.roundFloating]}
      accessibilityLabel="Einstellungen"
      onPress={onSettings}
    >
      <SettingsIcon size={20} color={colors.muted} />
    </Pressable>
  );
  // While a clip is on screen there's no room for the record row, but a recording can still run.
  const smallRecord = (
    <Pressable
      style={[
        shared.floating,
        styles.roundFloating,
        !armed && styles.destructive,
        !recording && !canArm && shared.disabled,
      ]}
      accessibilityLabel={recording ? 'Aufnahme stoppen' : armed ? 'Abbrechen' : 'Aufnahme starten'}
      disabled={!recording && !canArm}
      onPress={() => (recording ? onStop() : onArm(!armed))}
    >
      {recording ? (
        <Square size={14} color={colors.text} fill={colors.text} />
      ) : armed ? (
        <X size={18} color={colors.text} />
      ) : (
        <Circle size={14} color={colors.text} fill={colors.text} />
      )}
    </Pressable>
  );
  const modeButton = (
    <Pressable
      style={[
        styles.mode,
        dock === 'side' ? styles.modeSide : styles.modeFixed,
        tight && styles.modeTight,
        !dock && styles.modeFloating,
        recording && shared.disabled,
      ]}
      accessibilityLabel={`Start: ${mode.short}`}
      disabled={recording}
      onPress={() => setChoosingMode(true)}
    >
      <View style={styles.texts}>
        <Text style={styles.modeLabel}>Start</Text>
        <Text style={styles.modeName} numberOfLines={dock === 'side' ? undefined : 1}>
          {mode.short}
        </Text>
      </View>
      {!tight && <ChevronDown size={18} color={colors.text} />}
    </Pressable>
  );
  // Docked it keeps its space when hidden: the strip's height sets the picture's size, which
  // shouldn't jump when a recording starts.
  const hint = (status === 'idle' || dock) && (
    <Text
      style={[styles.hint, !dock && styles.hintFloating, status !== 'idle' && styles.invisible]}
    >
      {mode.description}
    </Text>
  );

  const clipsItem = latest ? (
    <Pressable style={styles.item} onPress={onClips} accessibilityLabel={`Clips (${clips.length})`}>
      <View style={[styles.thumb, small && styles.smallItem]}>
        {latest.thumbnail && (
          <Image
            source={{ uri: latest.thumbnail }}
            resizeMethod="resize"
            style={StyleSheet.absoluteFill}
          />
        )}
      </View>
      <Text style={styles.itemLabel}>Clips ({clips.length})</Text>
    </Pressable>
  ) : (
    <View />
  );
  const recordItem = (
    <Pressable
      style={[styles.item, !recording && !canArm && shared.disabled]}
      disabled={!recording && !canArm}
      onPress={() => (recording ? onStop() : onArm(!armed))}
    >
      <View
        style={[
          styles.shutter,
          small && styles.smallShutter,
          { borderColor: recording ? '#ef4444' : armed ? colors.amber : '#fff' },
        ]}
      >
        {recording ? (
          <View style={styles.stopSquare} />
        ) : armed ? (
          <X size={32} color={colors.amber} />
        ) : (
          <View style={[styles.redDisc, small && styles.smallDisc]} />
        )}
      </View>
      <Text style={styles.itemLabel}>
        {recording ? 'Stoppen' : armed ? 'Abbrechen' : 'Aufnehmen'}
      </Text>
    </Pressable>
  );
  const zoneItem = (
    <Pressable
      style={[styles.item, recording && shared.disabled]}
      disabled={recording}
      onPress={onEditZone}
    >
      <View style={[styles.zoneButton, small && styles.smallItem]}>
        <SquareDashed size={24} color={colors.sky} />
      </View>
      <Text style={styles.itemLabel}>Startzone</Text>
    </Pressable>
  );
  const recordRow = (
    <View style={styles.recordRow}>
      <View style={styles.cell}>{clipsItem}</View>
      {recordItem}
      <View style={styles.cell}>{zoneItem}</View>
    </View>
  );

  const sheet = (
    <StartModeSheet
      open={choosingMode}
      onClose={() => setChoosingMode(false)}
      runUp={runUp}
      onRunUp={onRunUp}
      wide={screenWidth >= WIDE_SCREEN}
    />
  );

  if (editingZone) return null;
  if (dock === 'side' && strip && recordStrip) {
    return (
      <>
        <View
          style={[
            styles.strip,
            styles.leftStrip,
            strip,
            { paddingTop: EDGE, paddingBottom: EDGE, paddingLeft: EDGE },
          ]}
        >
          {statusLine}
          {modeButton}
          {hint}
        </View>
        {/* Right of the picture, as a phone's camera app held sideways. */}
        <View
          style={[
            styles.strip,
            styles.rightStrip,
            recordStrip,
            { paddingTop: EDGE, paddingBottom: EDGE, paddingRight: EDGE },
          ]}
        >
          {settings}
          <View style={styles.recordColumn}>
            {zoneItem}
            {recordItem}
            {clipsItem}
          </View>
        </View>
        {sheet}
      </>
    );
  }
  if (dock === 'bottom' && strip) {
    return (
      <>
        <View style={[styles.strip, styles.bottomStrip, strip]}>
          <View
            style={styles.bottomContent}
            onLayout={(event) =>
              onStripHeight(event.nativeEvent.layout.height + BOTTOM_PADDING * 2 + 1)
            }
          >
            <View style={styles.header}>
              {statusLine}
              {/* Below the picture the strip may be only 200 points high: one row for both. */}
              {!replay && modeButton}
              {settings}
            </View>
            {hint}
            {recordRow}
          </View>
        </View>
        {sheet}
      </>
    );
  }
  return (
    <>
      <View
        style={[styles.floatingTop, { top: edge.top, left: edge.left, right: edge.right }]}
        pointerEvents="box-none"
      >
        {statusLine}
        <View style={styles.grow} pointerEvents="none" />
        {replay ? smallRecord : modeButton}
        {settings}
      </View>
      {!replay && (
        <View
          style={[
            styles.floatingBottom,
            { bottom: edge.bottom, left: edge.left, right: edge.right },
          ]}
          pointerEvents="box-none"
        >
          {hint && <View style={styles.hintPill}>{hint}</View>}
          <View style={styles.recordPill}>{recordRow}</View>
        </View>
      )}
      {sheet}
    </>
  );
}

const BOTTOM_PADDING = 12;
/** Least distance from the screen's edges, whose corners are rounded (Pixel 8: radius 47). */
const EDGE = 16;

const styles = StyleSheet.create({
  grow: { flex: 1 },
  invisible: { opacity: 0 },
  texts: { flexShrink: 1 },
  strip: { position: 'absolute', backgroundColor: colors.sheet, borderColor: colors.border },
  bottomStrip: { borderTopWidth: 1, padding: BOTTOM_PADDING },
  bottomContent: { gap: 8 },
  leftStrip: { borderRightWidth: 1, paddingRight: 8, gap: 8 },
  rightStrip: { borderLeftWidth: 1, paddingLeft: 8, alignItems: 'center' },
  recordColumn: { flex: 1, alignItems: 'center', justifyContent: 'space-evenly' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  statusSide: { alignItems: 'flex-start' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 1 },
  statusText: { flexShrink: 1, fontSize: 16, fontWeight: '600' },
  statusFloating: { fontSize: 14 },
  statusTight: { fontSize: 14 },
  round: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  roundFloating: { width: 36, paddingHorizontal: 0, justifyContent: 'center' },
  destructive: { backgroundColor: colors.destructive },
  mode: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  modeFixed: { width: 224 },
  modeSide: { alignSelf: 'stretch' },
  modeTight: { paddingHorizontal: 8 },
  modeFloating: { backgroundColor: 'rgba(0, 0, 0, 0.6)', maxWidth: 224 },
  modeLabel: { color: colors.muted, fontSize: 12 },
  modeName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  hint: { color: '#cbd5e1', fontSize: 14, lineHeight: 19 },
  hintFloating: { maxWidth: 384, textAlign: 'center' },
  hintPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  recordRow: { flexDirection: 'row', alignItems: 'flex-end' },
  cell: { flex: 1, alignItems: 'center' },
  item: { alignItems: 'center', gap: 6 },
  itemLabel: { color: '#cbd5e1', fontSize: 11, fontWeight: '600' },
  thumb: {
    width: 48,
    height: 48,
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: '#1e293b',
  },
  zoneButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  smallItem: { width: 44, height: 44 },
  shutter: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 32,
    borderWidth: 4,
  },
  smallShutter: { width: 56, height: 56, borderRadius: 28 },
  redDisc: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#dc2626' },
  smallDisc: { width: 40, height: 40, borderRadius: 20 },
  stopSquare: { width: 24, height: 24, borderRadius: 4, backgroundColor: '#ef4444' },
  floatingTop: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  floatingBottom: { position: 'absolute', alignItems: 'center', gap: 8 },
  recordPill: {
    width: 288,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
});
