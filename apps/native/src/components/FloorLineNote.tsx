import { useEffect, useEffectEvent } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { styles as shared } from './theme';

/** Long enough to read and undo, short enough not to linger over the replay. */
const SHOWN_MS = 10_000;

/** Tells the coach the floor line moved by itself (`learnFloorLine`), with a way back. */
export default function FloorLineNote({
  onUndo,
  onClose,
}: {
  onUndo: () => void;
  onClose: () => void;
}) {
  // The screen re-renders with every detected frame; that mustn't restart the timer.
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const timer = setTimeout(close, SHOWN_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[shared.floating, styles.note]} accessibilityRole="alert">
        <Text style={shared.floatingText}>Bodenlinie an die Landung angepasst</Text>
        <Pressable onPress={onUndo} style={styles.undo} accessibilityRole="button">
          <Text style={shared.floatingText}>Rückgängig</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 64, left: 0, right: 0, alignItems: 'center' },
  note: { gap: 12, paddingRight: 4 },
  undo: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
});
