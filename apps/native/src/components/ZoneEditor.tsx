import type { Point } from '@nomol/core/detection/pose';
import { MAX_ZONES, normalizeZone, secondZone, type Zone } from '@nomol/core/detection/zone';
import { DEFAULT_ZONE } from '@nomol/core/settings';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { colors, styles as shared, type Frame } from './theme';

/** Smaller than about one body width is almost certainly a slip of the finger. */
const MIN_SIZE = 0.05;

type Props = {
  /** Where the camera picture is on the screen; the zones are relative to it. */
  picture: Frame;
  zones: Zone[];
  onSave: (zones: Zone[]) => void;
  onCancel: () => void;
};

function isTooSmall(zone: Zone) {
  return zone.right - zone.left < MIN_SIZE || zone.bottom - zone.top < MIN_SIZE;
}

/**
 * Coach draws the start zones on the live image; their bottom edges mark the floor. Dragging
 * draws the selected one; a second one is for gymnasts starting at the other end of the floor
 * track.
 */
export default function ZoneEditor({ picture, zones, onSave, onCancel }: Props) {
  const [drafts, setDrafts] = useState<Zone[]>(zones);
  const [selected, setSelected] = useState(0);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const tooSmall = drafts.some(isTooSmall);
  const several = drafts.length > 1;

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
              i !== selected && styles.otherDraft,
              {
                left: draft.left * picture.width,
                top: draft.top * picture.height,
                width: (draft.right - draft.left) * picture.width,
                height: (draft.bottom - draft.top) * picture.height,
              },
            ]}
          >
            {several && <Text style={styles.number}>{i + 1}</Text>}
            <Text style={[styles.floor, i !== selected && styles.otherFloor]}>Boden</Text>
          </View>
        ))}
      </View>

      {/*
        Anchored to the screen, not the picture: in portrait it sits in the empty space around the
        picture. It takes the side away from the floor line and steps aside while drawing.
      */}
      <View
        pointerEvents={anchor ? 'none' : 'auto'}
        style={[
          styles.bar,
          drafts[selected].bottom > 0.5 ? { top: 12 } : { bottom: 12 },
          anchor && { opacity: 0 },
        ]}
      >
        <Text style={styles.text}>
          {tooSmall
            ? 'Zu klein. Zieh einen grösseren Bereich auf.'
            : several
              ? `Zieh Startzone ${selected + 1} auf. Die untere Kante ist der Boden.`
              : 'Zieh die Startzone auf. Die untere Kante ist der Boden.'}
        </Text>
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
          <Pressable style={shared.button} onPress={onCancel}>
            <Text style={shared.buttonText}>Abbrechen</Text>
          </Pressable>
          <Pressable
            style={[shared.button, shared.primaryButton, tooSmall && shared.disabled]}
            disabled={tooSmall}
            onPress={() => onSave(drafts)}
          >
            <Text style={[shared.buttonText, shared.primaryButtonText]}>Speichern</Text>
          </Pressable>
        </View>
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
  floor: {
    position: 'absolute',
    bottom: -24,
    paddingHorizontal: 6,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.sky,
    color: '#020618',
    fontSize: 12,
    fontWeight: '600',
  },
  otherFloor: { backgroundColor: 'rgba(203, 213, 225, 0.8)' },
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.panel,
  },
  text: { flexGrow: 1, flexBasis: 200, color: '#cbd5e1', fontSize: 14 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
