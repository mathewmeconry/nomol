import type { Clip } from '@nomol/core/recording/clip';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type ScrollViewInstance,
} from 'react-native';
import { colors } from './theme';

type Props = {
  clips: Clip[];
  /** Highlighted clip, if one is open. */
  currentId: string | null;
  onSelect: (clip: Clip) => void;
  /**
   * Scroll position, kept by the parent: the strip is remounted with each clip it opens, and
   * would otherwise jump back to the newest clip.
   */
  scrollRef: RefObject<number>;
  /** Narrow phones get smaller thumbnails. */
  compact: boolean;
};

/** The latest recordings as thumbnails, newest first. */
export default function ClipStrip({ clips, currentId, onSelect, scrollRef, compact }: Props) {
  const width = compact ? 80 : 112;
  const stripRef = useRef<ScrollViewInstance>(null);
  useLayoutEffect(() => {
    stripRef.current?.scrollTo({ x: scrollRef.current, animated: false });
  }, [scrollRef]);

  return (
    <ScrollView
      ref={stripRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      onScroll={(event) => (scrollRef.current = event.nativeEvent.contentOffset.x)}
      scrollEventThrottle={100}
      contentContainerStyle={styles.strip}
      accessibilityLabel="Letzte Aufnahmen"
    >
      {clips.map((clip) => (
        <Pressable
          key={clip.id}
          onPress={() => onSelect(clip)}
          accessibilityState={{ selected: clip.id === currentId }}
          style={[
            styles.item,
            { width, height: (width * 9) / 16 },
            clip.id === currentId && styles.current,
          ]}
        >
          {clip.thumbnail && (
            <Image
              source={{ uri: clip.thumbnail }}
              // Decoded at thumbnail size, not the 640 px of the saved still.
              resizeMethod="resize"
              style={StyleSheet.absoluteFill}
            />
          )}
          <Text style={styles.time}>{clip.startedAt.toLocaleTimeString('de-CH')}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: 8 },
  item: {
    justifyContent: 'flex-end',
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    backgroundColor: '#1e293b',
  },
  current: { borderColor: colors.sky },
  time: {
    paddingVertical: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    color: '#e2e8f0',
    fontFamily: 'monospace',
    fontSize: 11,
    textAlign: 'center',
  },
});
