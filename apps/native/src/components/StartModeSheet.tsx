import type { RunUp } from '@nomol/core/detection/session';
import { START_MODES, START_MODES_NOTE } from '@nomol/core/start-modes';
import { CircleCheck } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from './theme';

const strokes = {
  fill: 'none',
  stroke: colors.text,
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function zoneRect(x: number) {
  return (
    <Rect
      x={x}
      y={12}
      width={20}
      height={32}
      fill="none"
      stroke={colors.zoneBlue}
      strokeWidth={2}
      strokeDasharray="3 3"
    />
  );
}

/** The web app's pictures of each way to start, by its `runUp` (`sign` for the start sign). */
const PICTURES: Record<RunUp | 'sign', ReactNode> = {
  sign: (
    <>
      <Path d="M28 24v14M28 38l-4 10M28 38l4 10M25 26l-6-8 15-9M31 26l6-8-15-9" {...strokes} />
      <Circle cx={28} cy={20} r={3.5} fill={colors.text} />
    </>
  ),
  left: (
    <>
      {zoneRect(30)}
      <Path d="M6 30h20m-6-6 6 6-6 6" {...strokes} />
    </>
  ),
  right: (
    <>
      {zoneRect(6)}
      <Path d="M50 30H30m6-6-6 6 6 6" {...strokes} />
    </>
  ),
  any: (
    <>
      <Path d="M14 40 28 16l14 24" {...strokes} />
      <Path d="M8 30h6M8 36h4M42 30h6M44 36h4" {...strokes} stroke={colors.zoneBlue} />
    </>
  ),
};

type Props = {
  open: boolean;
  onClose: () => void;
  runUp: RunUp | null;
  onRunUp: (runUp: RunUp | null) => void;
  /** Two columns where the screen is wide, so all four fit in landscape. */
  wide: boolean;
};

/** How recordings start, each way with a picture, a sentence and where it fits. As on the web. */
export default function StartModeSheet({ open, onClose, runUp, onRunUp, wide }: Props) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Schliessen" />
      {/* A sheet from the bottom, within thumb reach. */}
      <View style={styles.sheet}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Wie soll die Aufnahme starten?</Text>
          <Text style={styles.note}>{START_MODES_NOTE}</Text>
          <View style={[styles.options, wide && styles.wideOptions]} accessibilityRole="radiogroup">
            {START_MODES.map((mode) => {
              const chosen = mode.runUp === runUp;
              return (
                <Pressable
                  key={mode.title}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: chosen }}
                  style={[styles.option, wide && styles.wideOption, chosen && styles.chosen]}
                  onPress={() => {
                    onRunUp(mode.runUp);
                    onClose();
                  }}
                >
                  <Svg viewBox="0 0 56 56" width={56} height={56} style={styles.picture}>
                    {PICTURES[mode.runUp ?? 'sign']}
                  </Svg>
                  <View style={styles.texts}>
                    <Text style={styles.optionTitle}>{mode.title}</Text>
                    <Text style={styles.description}>{mode.description}</Text>
                    <Text style={styles.goodFor}>{mode.goodFor}</Text>
                  </View>
                  {chosen && <CircleCheck size={24} color="#000" fill={colors.sky} />}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '100%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: colors.sheet,
  },
  content: { gap: 12, padding: 16 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  note: { color: colors.muted, fontSize: 14 },
  options: { gap: 8 },
  wideOptions: { flexDirection: 'row', flexWrap: 'wrap' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  // Two per row: half the width less half the gap.
  wideOption: { flexBasis: '48%', flexGrow: 1 },
  chosen: { borderColor: colors.sky, backgroundColor: 'rgba(8, 47, 73, 0.6)' },
  picture: { borderRadius: 12, backgroundColor: '#000' },
  texts: { flex: 1, gap: 2 },
  optionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  description: { color: '#cbd5e1', fontSize: 14 },
  goodFor: { marginTop: 2, color: colors.sky, fontSize: 12, fontWeight: '600' },
});
