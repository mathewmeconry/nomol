/**
 * Downloads a model file, reporting progress as whole percents (the model libraries' own loading
 * reports none). Goes through the service worker like any fetch, so it's cached for offline use.
 */
export async function download(url: string, onProgress?: (percent: number) => void) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`);
  const total = Number(response.headers.get('content-length'));
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let reported = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    const percent = Math.min(100, Math.floor((loaded / total) * 100));
    if (total && percent !== reported) {
      reported = percent;
      onProgress?.(percent);
    }
  }
  const file = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    file.set(chunk, offset);
    offset += chunk.length;
  }
  return file;
}
