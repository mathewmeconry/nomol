import type { Pose } from '@nomol/core/detection/pose';
import type { Clip } from '@nomol/core/recording/clip';
import { exportBaseName, exportData, parseExport } from '@nomol/core/recording/export';
import { createFileShare } from '@nomol/native-modules';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { APP_VERSION } from './app-version';

/**
 * Clips stay on the device until deleted by hand (they're test footage too). Each one is a
 * folder in the app's documents, named by its start time in ms:
 *
 * - `<name>.mp4`: the video, written there by the recorder
 * - `<name>.nomol.txt`: the export JSON (`exportData`), also what the app reads back
 * - `thumbnail.jpg`: a still from the middle of the routine
 * - `stills/*.jpg` and `samples.json`: frames for the replay skeleton (`Sample`)
 *
 * The video and JSON carry the export's file names, so exporting shares them as they are.
 */
const CLIPS = new Directory(Paths.document, 'clips');

/**
 * A saved frame for computing the replay skeleton later, about 10 per second, with the live
 * tracked pose if the gymnast was found in it.
 */
export type Sample = { time: number; file: string; tracked: Pose | null };

/** `expo-file-system` works with `file://` URIs, the camera and native modules with paths. */
export function filePath(entry: File | Directory) {
  return decodeURI(entry.uri.replace(/^file:\/\//, ''));
}

export function newClipFolder(startedAt: Date) {
  const dir = new Directory(CLIPS, String(startedAt.getTime()));
  dir.create({ intermediates: true, idempotent: true });
  const name = exportBaseName(startedAt);
  return {
    id: dir.name,
    dir,
    video: new File(dir, `${name}.mp4`),
    data: new File(dir, `${name}.nomol.txt`),
    thumbnail: new File(dir, 'thumbnail.jpg'),
    stills: new Directory(dir, 'stills'),
    samples: new File(dir, 'samples.json'),
  };
}

export type ClipFolder = ReturnType<typeof newClipFolder>;

function userAgent() {
  const { Manufacturer, Model } = Platform.constants as { Manufacturer?: string; Model?: string };
  return `Nomol Android app ${APP_VERSION}; Android ${Platform.Version}; ${Manufacturer ?? ''} ${Model ?? ''}`.trim();
}

export async function saveClip(folder: ClipFolder, clip: Clip, samples: Sample[]) {
  await folder.data.write(JSON.stringify(exportData(clip, userAgent())));
  await folder.samples.write(JSON.stringify(samples));
}

/** All stored clips, newest first. Folders without a readable video and JSON are skipped. */
export async function loadClips(): Promise<Clip[]> {
  if (!CLIPS.exists) return [];
  const clips = await Promise.all(
    CLIPS.list().map(async (dir) => {
      if (!(dir instanceof Directory)) return null;
      const files = dir.list().filter((entry) => entry instanceof File);
      const video = files.find((file) => file.name.endsWith('.mp4'));
      const data = files.find((file) => file.name.endsWith('.nomol.txt'));
      if (!video || !data) return null;
      try {
        const stored = parseExport(JSON.parse(await data.text()));
        if (!stored) return null;
        const thumbnail = new File(dir, 'thumbnail.jpg');
        return {
          ...stored,
          id: dir.name,
          url: video.uri,
          thumbnail: thumbnail.exists ? thumbnail.uri : null,
        } satisfies Clip;
      } catch (_error) {
        return null;
      }
    }),
  );
  return clips
    .filter((clip) => clip !== null)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}

export function deleteClip(id: string) {
  const dir = new Directory(CLIPS, id);
  if (dir.exists) dir.delete();
}

/** Video and body points through the share sheet, as `.mp4` and `.nomol.txt`. */
export function exportClip(clip: Clip) {
  const dir = new Directory(CLIPS, clip.id);
  const files = dir.list().filter((entry) => entry instanceof File);
  const video = files.find((file) => file.name.endsWith('.mp4'));
  const data = files.find((file) => file.name.endsWith('.nomol.txt'));
  if (!video || !data) throw new Error('Dateien der Aufnahme fehlen');
  createFileShare().share([video.contentUri, data.contentUri], exportBaseName(clip.startedAt));
}
