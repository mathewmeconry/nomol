import type { Clip, ClipFrame } from './clip';

/**
 * Keeps recent clips in the browser's IndexedDB, so a reload or a killed app doesn't lose them.
 * Nothing leaves the device.
 */

const DB_NAME = 'nomol';
const STORE = 'clips';

type StoredClip = Omit<Clip, 'url' | 'skeleton'> & {
  video: Blob;
  /** Missing in clips stored before the replay skeleton existed. */
  skeleton?: ClipFrame[];
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveClip(clip: Clip, video: Blob) {
  const { url: _url, ...data } = clip;
  await run('readwrite', (store) => store.put({ ...data, video } satisfies StoredClip));
}

/** Stores the skeleton once it's computed (the clip itself is saved right after recording). */
export async function saveSkeleton(id: string, skeleton: ClipFrame[]) {
  const stored = await run<StoredClip | undefined>('readonly', (store) => store.get(id));
  if (stored) await run('readwrite', (store) => store.put({ ...stored, skeleton }));
}

export async function deleteClip(id: string) {
  await run('readwrite', (store) => store.delete(id));
}

/** All stored clips, newest first, each with a fresh object URL for its video. */
export async function loadClips(): Promise<Clip[]> {
  const stored = await run<StoredClip[]>('readonly', (store) => store.getAll());
  return stored
    .map(({ video, skeleton, ...clip }) => ({
      ...clip,
      skeleton: skeleton ?? [],
      url: URL.createObjectURL(video),
    }))
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}
