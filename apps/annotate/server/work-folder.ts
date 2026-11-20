import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
};
/** Only labels and the COCO exports are written; frames and tasks come from prepare.py. */
const WRITABLE = /^(labels\/[\w.+-]+\.json|coco_(test|train)\.json)$/;

/** The file under `dir` for a request path, or null if it would leave the folder. */
export function workPath(dir: string, path: string) {
  const root = resolve(dir);
  const file = resolve(root, decodeURIComponent(path));
  return file.startsWith(root + sep) ? file : null;
}

export function canWrite(path: string) {
  return WRITABLE.test(path);
}

/**
 * Serves the work folder (frames and tasks from prepare.py) under /work/ and stores the labels in
 * it, so the tool resumes after a reload. Only for `vite` dev on the laptop; nothing is built.
 */
export function workFolder(dir: string): Plugin {
  return {
    name: 'work-folder',
    configureServer(server) {
      server.middlewares.use('/work/', (req, res) => {
        handle(dir, req, res).catch((error: Error) => {
          res.statusCode = 500;
          res.end(error.message);
        });
      });
    },
  };
}

async function handle(dir: string, req: IncomingMessage, res: ServerResponse) {
  const path = (req.url ?? '').split('?')[0].replace(/^\//, '');
  if (req.method === 'GET' && path === 'labels.json') {
    res.setHeader('Content-Type', TYPES['.json']);
    res.end(JSON.stringify(await readLabels(dir)));
    return;
  }
  const file = workPath(dir, path);
  if (!file) {
    res.statusCode = 404;
    res.end();
  } else if (req.method === 'GET') {
    const content = await readFile(file).catch(() => null);
    res.statusCode = content ? 200 : 404;
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.end(content);
  } else if (req.method === 'PUT' && canWrite(path)) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    await mkdir(resolve(file, '..'), { recursive: true });
    await writeFile(file, Buffer.concat(chunks));
    res.statusCode = 204;
    res.end();
  } else {
    res.statusCode = 405;
    res.end();
  }
}

/** All labels in one response, oldest first, so the tool knows where to continue and go back. */
async function readLabels(dir: string) {
  const folder = resolve(dir, 'labels');
  const names = await readdir(folder).catch(() => []);
  const labels = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        const file = resolve(folder, name);
        const [content, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
        return { label: JSON.parse(content) as unknown, saved: info.mtimeMs };
      }),
  );
  return labels.sort((a, b) => a.saved - b.saved).map((entry) => entry.label);
}
