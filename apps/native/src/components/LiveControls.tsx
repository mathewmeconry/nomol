import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { RunUp } from '@nomol/core/detection/session';
import { parseRunUp } from '@nomol/core/settings';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, styles as shared } from './theme';

const START_MODES = [
  { value: 'sign', label: 'Start mit Zeichen' },
  { value: 'left', label: 'Auto von links' },
  { value: 'right', label: 'Auto von rechts' },
  { value: 'any', label: 'Auto bei Tempo' },
] as const;

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

type Props = {
  status: Status;
  runUp: RunUp | null;
  onRunUp: (runUp: RunUp | null) => void;
  onEditZone: () => void;
  onSettings: () => void;
  armed: boolean;
  onArm: (armed: boolean) => void;
  onStop: () => void;
};

/**
 * The bar over the live picture. One wrapping row, so the two groups stack instead of
 * overlapping on narrow phones.
 */
export default function LiveControls({
  status,
  runUp,
  onRunUp,
  onEditZone,
  onSettings,
  armed,
  onArm,
  onStop,
}: Props) {
  const [choosingMode, setChoosingMode] = useState(false);
  const mode = START_MODES.find((m) => m.value === (runUp ?? 'sign')) ?? START_MODES[0];
  const recording = status === 'recording';
  const canArm = status !== 'loading';

  return (
    <View style={styles.bar} pointerEvents="box-none">
      <View style={shared.floating}>
        <View style={[styles.dot, { backgroundColor: STATUS_COLOR[status] }]} />
        <Text style={[shared.floatingText, { color: STATUS_COLOR[status] }]}>
          {STATUS_TEXT[status]}
        </Text>
      </View>

      <View style={styles.group}>
        <Pressable
          style={[shared.floating, recording && shared.disabled]}
          accessibilityLabel="Start"
          disabled={recording}
          onPress={() => setChoosingMode(true)}
        >
          <MaterialCommunityIcons
            name="lightning-bolt"
            size={16}
            color={runUp ? colors.sky : colors.text}
          />
          <Text style={[shared.floatingText, runUp && { color: colors.sky }]}>{mode.label}</Text>
        </Pressable>
        <Pressable
          style={[shared.floating, recording && shared.disabled]}
          disabled={recording}
          onPress={onEditZone}
        >
          <MaterialCommunityIcons name="selection" size={16} color={colors.text} />
          <Text style={shared.floatingText}>Startzone</Text>
        </Pressable>
        <Pressable
          style={[shared.floating, styles.icon]}
          accessibilityLabel="Einstellungen"
          onPress={onSettings}
        >
          <MaterialCommunityIcons name="cog" size={18} color={colors.text} />
        </Pressable>
        {recording ? (
          <Pressable
            style={[shared.floating, styles.icon, styles.record]}
            accessibilityLabel="Aufnahme stoppen"
            onPress={onStop}
          >
            <MaterialCommunityIcons name="square" size={14} color={colors.text} />
          </Pressable>
        ) : (
          <Pressable
            style={[
              shared.floating,
              styles.icon,
              !armed && styles.record,
              !canArm && shared.disabled,
            ]}
            accessibilityLabel={armed ? 'Abbrechen' : 'Aufnahme starten'}
            disabled={!canArm}
            onPress={() => onArm(!armed)}
          >
            <MaterialCommunityIcons
              name={armed ? 'close' : 'circle'}
              size={armed ? 18 : 14}
              color={colors.text}
            />
          </Pressable>
        )}
      </View>

      <Modal
        visible={choosingMode}
        transparent
        animationType="fade"
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={() => setChoosingMode(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setChoosingMode(false)}>
          <View style={styles.menu}>
            {START_MODES.map((m) => (
              <Pressable
                key={m.value}
                style={styles.item}
                accessibilityState={{ selected: m.value === mode.value }}
                onPress={() => {
                  onRunUp(parseRunUp(m.value));
                  setChoosingMode(false);
                }}
              >
                <Text style={styles.itemText}>{m.label}</Text>
                {m.value === mode.value && (
                  <MaterialCommunityIcons name="check" size={18} color={colors.text} />
                )}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  group: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  icon: { width: 36, paddingHorizontal: 0, justifyContent: 'center' },
  record: { backgroundColor: colors.destructive },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  menu: { minWidth: 240, paddingVertical: 6, borderRadius: 12, backgroundColor: colors.panel },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  itemText: { color: colors.text, fontSize: 16 },
});
