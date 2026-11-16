import type { Point } from '@nomol/core/detection/pose';
import { MAX_ZONES, normalizeZone, secondZone, type Zone } from '@nomol/core/detection/zone';
import { DEFAULT_ZONE } from '@nomol/core/settings';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, styles as shared, type Frame } from './theme';

/** Smaller than about one body width is almost certainly a slip of the finger. */
const MIN_SIZE = 0.05;
/** Narrower than this, the bar's two last buttons stack. */
const NARROW_BAR = 256;
const DOCKED_PADDING = 12;
/** Least distance from the screen's edges, whose corners are rounded. */
const EDGE = 16;

type Props = {
  /** Where the camera picture is on the screen; the zones are relative to it. */
  picture: Frame;
  zones: Zone[];
  onSave: (zones: Zone[]) => void;
  onCancel: () => void;
  /**
   * Where the docked controls are, for the bar to take their place (its height at most that);
   * null: over the picture.
   */
  dock: Frame | null;
  /** Below the picture: the height the docked bar needs, so the strip makes room for it. */
  onBarHeight: (height: number) => void;
  /** The strip is left of the picture (its border on the right) rather than below it. */
  side: boolean;
};

function isTooSmall(zone: Zone) {
  return zone.right - zone.left < MIN_SIZE || zone.bottom - zone.top < MIN_SIZE;
}

/**
 * Coach draws the start zones on the live image; their bottom edges mark the floor. Dragging
 * draws the selected one; a second one is for gymnasts starting at the other end of the floor
 * track.
 */
export default function ZoneEditor({
  picture,
  zones,
  onSave,
  onCancel,
  dock,
  onBarHeight,
  side,
}: Props) {
  const [drafts, setDrafts] = useState<Zone[]>(zones);
  const [selected, setSelected] = useState(0);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const tooSmall = drafts.some(isTooSmall);
  const several = drafts.length > 1;
  // Clear of the camera hole and the rounded screen corners, as the controls.
  const insets = useSafeAreaInsets();

  function draw(zone: Zone) {
    setDrafts(drafts.map((draft, i) => (i === selected ? zone : draft)));
  }

  // The surface's children don't take touches, so locationX/Y are always relative to it.
  function toPoint(event: GestureResponderEvent): Point {
    return {
      x: Math.min(1, Math.max(0, event.nativeEvent.locationX / picture.width)),
      y: Math.min(1, Math.max(0, event.nativeEvent.locationY / picture.height)),
    };
  }

  return (
    <>
      <View
        style={[styles.surface, picture]}
        accessibilityLabel="Startzone zeichnen"
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => {
          const point = toPoint(event);
          setAnchor(point);
          draw(normalizeZone(point, point));
        }}
        onResponderMove={(event) => {
          if (anchor) draw(normalizeZone(anchor, toPoint(event)));
        }}
        onResponderRelease={() => setAnchor(null)}
        onResponderTerminate={() => setAnchor(null)}
      >
        {drafts.map((draft, i) => (
          <View
            key={i}
            pointerEvents="none"
            style={[
              styles.draft,
              i === selected ? styles.floorEdge : styles.otherDraft,
              {
                left: draft.left * picture.width,
                top: draft.top * picture.height,
                width: (draft.right - draft.left) * picture.width,
                height: (draft.bottom - draft.top) * picture.height,
              },
            ]}
          >
            {several && <Text style={styles.number}>{i + 1}</Text>}
            {/* Wider than a narrow zone: centred under it rather than cut to its width. */}
            <View style={styles.floorRow}>
              <Text style={[styles.floor, i !== selected && styles.otherFloor]}>
                {i === selected ? 'Boden · hier stehen die Füsse' : 'Boden'}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/*
        Docked in the strip of the controls. Otherwise anchored to the screen, not the picture: it
        takes the side away from the floor line and steps aside while drawing.
      */}
      <View
        pointerEvents={!dock && anchor ? 'none' : 'auto'}
        style={
          dock
            ? [
                styles.docked,
                side ? styles.dockedSide : styles.dockedBottom,
                { left: dock.left, top: dock.top, width: dock.width, maxHeight: dock.height },
                side && { paddingTop: EDGE, paddingLeft: EDGE },
              ]
            : [
                styles.bar,
                { left: Math.max(12, insets.left), right: Math.max(12, insets.right) },
                drafts[selected].bottom > 0.5
                  ? { top: Math.max(EDGE, insets.top) }
                  : { bottom: Math.max(EDGE, insets.bottom) },
                anchor && { opacity: 0 },
              ]
        }
      >
        <ScrollView
          contentContainerStyle={styles.content}
          onContentSizeChange={(_width, height) =>
            onBarHeight(height + (dock ? DOCKED_PADDING * 2 + 1 : 0))
          }
        >
          <View>
            <Text style={styles.title}>{several ? `Startzone ${selected + 1}` : 'Startzone'}</Text>
            {/* Where the bottom edge goes is what coaches got wrong: it's the floor line. */}
            <Text style={styles.text}>
              {tooSmall ? (
                'Zu klein. Zieh einen grösseren Bereich auf.'
              ) : (
                <>
                  Zieh einen Rahmen um die Stelle, wo gestartet wird. Die{' '}
                  <Text style={styles.edge}>untere Kante</Text> gehört dahin, wo die Füsse nach dem
                  Element stehen (Sprung: auf oder hinter der Landematte).
                </>
              )}
            </Text>
          </View>
          <View style={styles.buttons}>
            {several &&
              drafts.map((_draft, i) => (
                <Pressable
                  key={i}
                  style={[shared.button, i === selected && shared.primaryButton]}
                  accessibilityState={{ selected: i === selected }}
                  onPress={() => setSelected(i)}
                >
                  <Text style={[shared.buttonText, i === selected && shared.primaryButtonText]}>
                    Zone {i + 1}
                  </Text>
                </Pressable>
              ))}
            {several ? (
              <Pressable
                style={shared.button}
                onPress={() => {
                  setDrafts(drafts.filter((_draft, i) => i !== selected));
                  setSelected(0);
                }}
              >
                <Text style={shared.buttonText}>Zone {selected + 1} entfernen</Text>
              </Pressable>
            ) : (
              drafts.length < MAX_ZONES && (
                <Pressable
                  style={shared.button}
                  onPress={() => {
                    setDrafts([...drafts, secondZone(drafts[0])]);
                    setSelected(drafts.length);
                  }}
                >
                  <Text style={shared.buttonText}>Zweite Zone</Text>
                </Pressable>
              )
            )}
            <Pressable
              style={shared.button}
              onPress={() => {
                setDrafts([DEFAULT_ZONE]);
                setSelected(0);
              }}
            >
              <Text style={shared.buttonText}>Standard</Text>
            </Pressable>
          </View>
          <View style={[styles.finish, dock && dock.width < NARROW_BAR && styles.stacked]}>
            <Pressable style={[shared.button, styles.big]} onPress={onCancel}>
              <Text style={shared.buttonText}>Abbrechen</Text>
            </Pressable>
            <Pressable
              style={[shared.button, styles.big, styles.save, tooSmall && shared.disabled]}
              disabled={tooSmall}
              onPress={() => onSave(drafts)}
            >
              <Text style={[shared.buttonText, styles.saveText]}>Speichern</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  surface: { position: 'absolute', backgroundColor: 'rgba(0, 0, 0, 0.3)' },
  draft: {
    position: 'absolute',
    borderWidth: 2,
    borderBottomWidth: 4,
    borderColor: colors.sky,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    alignItems: 'center',
  },
  floorEdge: { borderBottomColor: colors.floor },
  otherDraft: {
    borderColor: 'rgba(203, 213, 225, 0.6)',
    backgroundColor: 'rgba(203, 213, 225, 0.1)',
  },
  number: {
    position: 'absolute',
    top: 2,
    left: 6,
    color: '#f1f5f9',
    fontSize: 14,
    fontWeight: '600',
  },
  floorRow: { position: 'absolute', bottom: -24, left: -200, right: -200, alignItems: 'center' },
  floor: {
    paddingHorizontal: 6,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.floor,
    color: '#020618',
    fontSize: 12,
    fontWeight: '600',
  },
  otherFloor: { backgroundColor: 'rgba(203, 213, 225, 0.8)' },
  bar: {
    position: 'absolute',
    maxWidth: 576,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.panel,
  },
  docked: { position: 'absolute', padding: DOCKED_PADDING, backgroundColor: colors.sheet },
  dockedBottom: { borderTopWidth: 1, borderColor: colors.border },
  dockedSide: { borderRightWidth: 1, borderColor: colors.border },
  content: { gap: 12 },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  text: { marginTop: 4, color: '#cbd5e1', fontSize: 14, lineHeight: 19 },
  edge: { color: colors.amber, fontWeight: '700' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  finish: { flexDirection: 'row', gap: 8 },
  stacked: { flexDirection: 'column' },
  big: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  save: { backgroundColor: colors.zoneBlue, borderColor: colors.zoneBlue },
  saveText: { color: '#020618' },
});
