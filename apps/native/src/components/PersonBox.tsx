import { boundingBox, type Pose } from '@nomol/core/detection/pose';
import { StyleSheet, Text, View } from 'react-native';
import type { Frame } from './theme';

/** Room around the body, so the box doesn't cut through hands and feet. */
const PAD = 0.02;

/** A labelled box around a person, as in the web app. */
export default function PersonBox({
  pose,
  picture,
  color,
  label,
}: {
  pose: Pose;
  picture: Frame;
  color: string;
  label: string;
}) {
  const box = boundingBox(pose);
  return (
    <View
      pointerEvents="none"
      style={[
        styles.box,
        {
          borderColor: color,
          left: (box.left - PAD) * picture.width,
          top: (box.top - PAD) * picture.height,
          width: (box.right - box.left + 2 * PAD) * picture.width,
          height: (box.bottom - box.top + 2 * PAD) * picture.height,
        },
      ]}
    >
      <Text style={[styles.label, { backgroundColor: color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', borderWidth: 2.5 },
  label: {
    position: 'absolute',
    top: -20,
    left: -2.5,
    paddingHorizontal: 5,
    color: '#08130f',
    fontSize: 12,
    fontWeight: '600',
  },
});
