import { homedir } from 'node:os';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { workFolder } from './server/work-folder.ts';

// The frames show people, so they live outside the repo.
const dir = resolve(process.env.ANNOTATE_DIR ?? resolve(homedir(), 'nomol-annotate'));

export default defineConfig({
  plugins: [tailwindcss(), react(), workFolder(dir)],
  server: { port: 5174 },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
