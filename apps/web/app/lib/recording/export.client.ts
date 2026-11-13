import type { Clip } from '@nomol/core/recording/clip';
import { exportBaseName, exportData } from '@nomol/core/recording/export';

/**
 * Exports the video and its body points. Phones and tablets get the system share sheet; elsewhere
 * both files are downloaded. The body points are JSON but saved as `.txt`, because Chrome on
 * Android refuses to share `.json` files.
 */
export async function exportClip(clip: Clip) {
  const video = await (await fetch(clip.url)).blob();
  const base = exportBaseName(clip.startedAt);
  const extension = video.type.includes('mp4') ? 'mp4' : 'webm';
  const files = [
    new File([video], `${base}.${extension}`, { type: video.type }),
    new File([JSON.stringify(exportData(clip, navigator.userAgent))], `${base}.nomol.txt`, {
      type: 'text/plain',
    }),
  ];

  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: base });
      return;
    } catch (error) {
      // Closing the share sheet is not an error worth reporting. Other refusals (e.g. the tap
      // counts as too long ago) fall through to downloading.
      if (error instanceof DOMException && error.name === 'AbortError') return;
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
