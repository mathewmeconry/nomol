import type { Config } from '@react-router/dev/config';

export default {
  // Everything runs in the browser (camera, detection, recording), so the app is built as a
  // static single-page app and can be hosted anywhere, e.g. GitHub Pages.
  ssr: false,
  // GitHub Pages serves the app under /nomol/; locally it runs at the root.
  basename: process.env.BASE_PATH ?? '/',
} satisfies Config;
