import { useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { colors } from './theme';

type Props = {
  valueMs: number;
  durationMs: number;
  onScrubStart: () => void;
  onScrub: (ms: number) => void;
  onScrubEnd: () => void;
};

const THUMB = 16;

/** The video's timeline: tap or drag anywhere on it to seek. */
export default function Timeline({
  valueMs,
  durationMs,
  onScrubStart,
  onScrub,
  onScrubEnd,
}: Props) {
  const [width, setWidth] = useState(1);
  /** Screen x of the track's left edge, found on touch (it moves with the layout). */
  const originRef = useRef(0);

  function scrub(event: GestureResponderEvent) {
    const share = (event.nativeEvent.pageX - originRef.current) / width;
    onScrub(Math.min(Math.max(share, 0), 1) * durationMs);
  }

  const played = (durationMs > 0 ? Math.min(Math.max(valueMs / durationMs, 0), 1) : 0) * width;
  return (
    <View
      style={styles.touch}
      accessibilityRole="adjustable"
      accessibilityLabel="Zeitleiste"
      onLayout={(event) => setWidth(Math.max(event.nativeEvent.layout.width, 1))}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        // Children ignore touches, so locationX is measured from the track's left edge.
        originRef.current = event.nativeEvent.pageX - event.nativeEvent.locationX;
        onScrubStart();
        scrub(event);
      }}
      onResponderMove={scrub}
      onResponderRelease={onScrubEnd}
      onResponderTerminate={onScrubEnd}
    >
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.played, { width: played }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: played - THUMB / 2 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  touch: { height: 28, justifyContent: 'center' },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  played: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.text },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.text,
  },
});
