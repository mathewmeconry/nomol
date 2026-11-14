import { useKeepAwake } from 'expo-keep-awake';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import Tablet from './components/Tablet';
import { colors, styles as shared } from './components/theme';

/** Full screen and always on: the phone hangs at the apparatus, nobody touches it for long. */
export default function App() {
  useKeepAwake();
  const permission = useCameraPermission();
  const { canRequestPermission, requestPermission } = permission;

  useEffect(() => {
    if (canRequestPermission) void requestPermission();
  }, [canRequestPermission, requestPermission]);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <NavigationBar hidden />
      {permission.hasPermission ? (
        <Tablet />
      ) : (
        <View style={styles.message}>
          <Text style={styles.title}>Nomol braucht die Kamera</Text>
          <Text style={styles.text}>
            {canRequestPermission
              ? 'Damit du dich am Gerät aufnehmen und gleich anschauen kannst. Die Aufnahmen bleiben auf diesem Gerät.'
              : 'Der Kamerazugriff ist abgelehnt. Erlaube ihn in den Einstellungen des Telefons unter Berechtigungen.'}
          </Text>
          <Pressable
            style={[shared.button, shared.primaryButton]}
            onPress={() => {
              if (canRequestPermission) void requestPermission();
              else void Linking.openSettings();
            }}
          >
            <Text style={[shared.buttonText, shared.primaryButtonText]}>
              {canRequestPermission ? 'Kamera erlauben' : 'Einstellungen öffnen'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  title: { color: colors.text, fontSize: 20, fontWeight: '600', textAlign: 'center' },
  text: { maxWidth: 480, color: colors.muted, fontSize: 16, textAlign: 'center' },
});
