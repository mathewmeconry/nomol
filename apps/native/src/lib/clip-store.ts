import type { Pose } from '@nomol/core/detection/pose';
import type { Clip, ClipFrame } from '@nomol/core/recording/clip';
import { exportBaseName, exportData, parseExport } from '@nomol/core/recording/export';
import { createFileShare } from '@nomol/native-modules';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import z from 'zod';
import { APP_VERSION } from './app-version';

/**
 * Clips stay on the device until deleted by hand (they're test footage too). Each one is a
 * folder in the app's documents, named by its start time in ms:
 *
 * - `<name>.mp4`: the video, written there by the recorder
 * - `<name>.nomol.txt`: the export JSON (`exportData`), also what the app reads back
 * - `thumbnail.jpg`: a still from the middle of the routine
 * - `stills/*.jpg` and `samples.json`: frames for the replay skeleton (`Sample`), and
 *   `skeleton-done.json` how many of them are computed; all deleted once the skeleton is complete
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

/**
 * A folder without its JSON this long after its start never became a clip (the app was closed
 * mid-recording) and is deleted. Far longer than storing a clip takes.
 */
const LEFTOVER_AFTER_MS = 10 * 60_000;

/** Deletes `dir` if it is an old leftover of a recording that was never stored. */
function deleteLeftover(dir: Directory) {
  const startedAt = Number(dir.name);
  if (!Number.isFinite(startedAt) || Date.now() - startedAt <= LEFTOVER_AFTER_MS) return;
  try {
    dir.delete();
  } catch (_error) {
    // Tried again on the next start; the clips must load regardless.
  }
}

/**
 * All stored clips, newest first. Folders without a readable video and JSON are skipped, and
 * deleted when there is no JSON or it isn't JSON at all: one in another format (e.g. a later
 * export version) stays.
 */
export async function loadClips(): Promise<Clip[]> {
  if (!CLIPS.exists) return [];
  const clips = await Promise.all(
    CLIPS.list().map(async (dir) => {
      if (!(dir instanceof Directory)) return null;
      const files = dir.list().filter((entry) => entry instanceof File);
      const video = files.find((file) => file.name.endsWith('.mp4'));
      const data = files.find((file) => file.name.endsWith('.nomol.txt'));
      if (!data) {
        deleteLeftover(dir);
        return null;
      }
      if (!video) return null;
      const text = await data.text().catch(() => null);
      if (text === null) return null;
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (_error) {
        // Cut off while being written.
        deleteLeftover(dir);
        return null;
      }
      try {
        const stored = parseExport(raw);
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

const poseSchema = z.array(
  z.object({ x: z.number(), y: z.number(), visibility: z.number().optional() }),
);
const samplesSchema = z.array(
  z.object({ time: z.number(), file: z.string(), tracked: poseSchema.nullable() }),
);
const doneSchema = z.object({ done: z.number().int().nonnegative() });

/** A clip's replay skeleton still to compute: its saved frames and how many are done. */
export type PendingSkeleton = {
  samples: Sample[];
  /** Saved frames already computed, in the order they are computed (`skeletonPasses`). */
  done: number;
  /** Path of a saved frame. */
  still: (sample: Sample) => string;
};

function skeletonFiles(id: string) {
  const dir = new Directory(CLIPS, id);
  return {
    dir,
    stills: new Directory(dir, 'stills'),
    samples: new File(dir, 'samples.json'),
    done: new File(dir, 'skeleton-done.json'),
  };
}

/** Null when the skeleton is complete (its saved frames are deleted then) or unreadable. */
export async function loadPendingSkeleton(id: string): Promise<PendingSkeleton | null> {
  const files = skeletonFiles(id);
  if (!files.samples.exists) return null;
  try {
    const samples = samplesSchema.safeParse(JSON.parse(await files.samples.text()));
    if (!samples.success) return null;
    const done = files.done.exists
      ? doneSchema.safeParse(JSON.parse(await files.done.text()))
      : null;
    return {
      samples: samples.data,
      done: done?.success ? done.data.done : 0,
      still: (sample) => filePath(new File(files.stills, sample.file)),
    };
  } catch (_error) {
    return null;
  }
}

/** Replaces the skeleton in the clip's JSON; everything else in it stays as recorded. */
async function writeSkeleton(id: string, skeleton: ClipFrame[]) {
  const dir = new Directory(CLIPS, id);
  const data = dir
    .list()
    .find((entry) => entry instanceof File && entry.name.endsWith('.nomol.txt'));
  if (!(data instanceof File)) return;
  const stored = JSON.parse(await data.text()) as Record<string, unknown>;
  // Written beside it and moved over it: the app may be closed mid-write, and a cut-off JSON
  // would lose the whole clip.
  const temporary = new File(dir, 'skeleton.tmp');
  await temporary.write(JSON.stringify({ ...stored, skeleton }));
  await temporary.move(data, { overwrite: true });
}

/**
 * Stores the skeleton computed so far, so it shows after a restart and the computation
 * continues from `done` there.
 */
export async function saveSkeleton(id: string, skeleton: ClipFrame[], done: number) {
  await writeSkeleton(id, skeleton);
  await skeletonFiles(id).done.write(JSON.stringify({ done }));
}

/**
 * Stores the complete skeleton and deletes the saved frames it was computed from, which take
 * most of a clip's space besides the video. The web app doesn't keep them either.
 */
export async function finishSkeleton(id: string, skeleton: ClipFrame[]) {
  await writeSkeleton(id, skeleton);
  const files = skeletonFiles(id);
  for (const entry of [files.samples, files.done, files.stills]) {
    if (entry.exists) entry.delete();
  }
}

export function deleteClip(id: string) {
  const dir = new Directory(CLIPS, id);
  if (dir.exists) dir.delete();
}

/** Everything under `clips/` except the folder `keep` (a recording running into it). */
export function deleteAllClips(keep: string | null) {
  if (!CLIPS.exists) return;
  for (const entry of CLIPS.list()) {
    if (entry.name !== keep) entry.delete();
  }
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
