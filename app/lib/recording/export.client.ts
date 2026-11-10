import type { Clip } from './clip';
import { exportBaseName, exportData } from './export';

/**
 * Exports the video and its body points (`.nomol.json`). Phones and tablets get the system share
 * sheet; elsewhere both files are downloaded.
 */
export async function exportClip(clip: Clip) {
  const video = await (await fetch(clip.url)).blob();
  const base = exportBaseName(clip.startedAt);
  const extension = video.type.includes('mp4') ? 'mp4' : 'webm';
  const files = [
    new File([video], `${base}.${extension}`, { type: video.type }),
    new File([JSON.stringify(exportData(clip, navigator.userAgent))], `${base}.nomol.json`, {
      type: 'application/json',
    }),
  ];

  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: base });
      return;
    } catch (error) {
      // Closing the share sheet is not an error worth reporting.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      throw error;
    }
  }

  for (const file of files) {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    // Give the browser a moment to start the download before freeing the file.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
