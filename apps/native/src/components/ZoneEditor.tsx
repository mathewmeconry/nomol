import type { Point } from '@nomol/core/detection/pose';
import { normalizeZone, type Zone } from '@nomol/core/detection/zone';
import { DEFAULT_ZONE } from '@nomol/core/settings';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { colors, styles as shared, type Frame } from './theme';

/** Smaller than about one body width is almost certainly a slip of the finger. */
const MIN_SIZE = 0.05;

type Props = {
  /** Where the camera picture is on the screen; the zone is relative to it. */
  picture: Frame;
  zone: Zone;
  onSave: (zone: Zone) => void;
  onCancel: () => void;
};

/** Coach draws the start zone on the live image. Its bottom edge marks the floor. */
export default function ZoneEditor({ picture, zone, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<Zone>(zone);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const tooSmall = draft.right - draft.left < MIN_SIZE || draft.bottom - draft.top < MIN_SIZE;

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
          setDraft(normalizeZone(point, point));
        }}
        onResponderMove={(event) => {
          if (anchor) setDraft(normalizeZone(anchor, toPoint(event)));
        }}
        onResponderRelease={() => setAnchor(null)}
        onResponderTerminate={() => setAnchor(null)}
      >
        <View
          pointerEvents="none"
          style={[
            styles.draft,
            {
              left: draft.left * picture.width,
              top: draft.top * picture.height,
              width: (draft.right - draft.left) * picture.width,
              height: (draft.bottom - draft.top) * picture.height,
            },
          ]}
        >
          <Text style={styles.floor}>Boden</Text>
        </View>
      </View>

      {/*
        Anchored to the screen, not the picture: in portrait it sits in the empty space around the
        picture. It takes the side away from the floor line and steps aside while drawing.
      */}
      <View
        pointerEvents={anchor ? 'none' : 'auto'}
        style={[
          styles.bar,
          draft.bottom > 0.5 ? { top: 12 } : { bottom: 12 },
          anchor && { opacity: 0 },
        ]}
      >
        <Text style={styles.text}>
          {tooSmall
            ? 'Zu klein. Zieh einen grösseren Bereich auf.'
            : 'Zieh die Startzone auf. Die untere Kante ist der Boden.'}
        </Text>
        <View style={styles.buttons}>
          <Pressable style={shared.button} onPress={() => setDraft(DEFAULT_ZONE)}>
            <Text style={shared.buttonText}>Standard</Text>
          </Pressable>
          <Pressable style={shared.button} onPress={onCancel}>
            <Text style={shared.buttonText}>Abbrechen</Text>
          </Pressable>
          <Pressable
            style={[shared.button, shared.primaryButton, tooSmall && shared.disabled]}
            disabled={tooSmall}
            onPress={() => onSave(draft)}
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
  buttons: { flexDirection: 'row', gap: 8 },
});
