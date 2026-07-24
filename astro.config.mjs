import { defineConfig } from 'astro/config';

// Client-rendered Lit UI. Tauri loads the built output (dist/) as the window's
// frontend; `tauri dev` points at the Astro dev server on port 4321.
export default defineConfig({
  server: { port: 4321, strictPort: true },
  build: { assets: 'assets' },
});
