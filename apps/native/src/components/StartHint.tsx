import type { RunUp } from '@nomol/core/detection/session';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

/** Tells the gymnast how to start a recording. Same texts as the web app. */
export default function StartHint({
  runUp,
  aboveClips,
}: {
  runUp: RunUp | null;
  aboveClips: boolean;
}) {
  return (
    <View style={[styles.wrap, aboveClips && styles.aboveClips]} pointerEvents="none">
      <View style={styles.hint}>
        {runUp ? (
          <>
            <Text style={styles.title}>
              {runUp === 'any'
                ? 'Automatisch: Tempo in der Startzone startet die Aufnahme'
                : `Automatisch: Anlauf von ${runUp === 'left' ? 'links' : 'rechts'} startet die Aufnahme`}
            </Text>
            <Text style={styles.detail}>
              Startzone über Gerät und Landung, unten bis zu den Füssen auf der Landematte · endet
              beim Weggehen
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Aufnehmen? Arme über dem Kopf kreuzen</Text>
            <Text style={styles.detail}>
              in der Startzone · zur Kamera schauen · 1 Sekunde halten
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, bottom: 24, alignItems: 'center' },
  aboveClips: { bottom: 112 },
  hint: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  detail: { color: colors.muted, fontSize: 14, textAlign: 'center' },
});
