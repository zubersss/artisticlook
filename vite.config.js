import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

function commitHash() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    const h = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() ? '+' : '';
    return h + dirty;
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  // Relative base so the static build works from any GitHub Pages sub-path.
  base: './',
  define: {
    __COMMIT__: JSON.stringify(commitHash()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1200 },
  server: { host: true },
  preview: { host: true },
});
