# CLAUDE.md — Painted Worlds

Browser exploration game set in the real solar system, rendered as realist oil
paintings. Milestone 1 = one Earth scene (autumn forest, late afternoon) that proves
the look, the foundations and 60 fps on a Samsung S23 Ultra, plus a data-only Mars swap.

**Future sessions have no memory except these files. Read, in order:**
1. `docs/BRIEF.md` — the owner's milestone brief, verbatim (source of truth).
2. `docs/PROGRESS.md` — staged plan, what is done, critic logs, phone results, open issues.
3. `docs/ARCHITECTURE.md` — modules, frame order, conventions, budgets.
4. `docs/ART_DIRECTION.md` — measured look targets (reference paintings are NOT in the repo).

## Run, test, deploy
- `npm install` then `npm run dev` (Vite dev server, `--host` so a phone on the LAN can open it).
- `npm run build` → static site in `dist/` (relative base path; works from any sub-path).
- `npm run shots` → builds, opens headless Chromium (SwiftShader WebGL 2, 915×412 phone-landscape
  viewport, deviceScaleFactor 2) and saves every bookmark × 3 views to `docs/shots/*.jpg`.
  Options: `--world=mars`, `--bookmarks=path,hill`, `--views=2`, `--scale=1`, `--out=shots-tmp/x`, `--nobuild`.
- `npm run stability` → 3 consecutive frames per bookmark while the camera moves, into
  `shots-tmp/stability/` (compare them: strokes must stay attached, far canopies must not sparkle).
- `node scripts/shots.mjs --overdraw` → overdraw (shaded fragments per pixel) at each bookmark.
- Playwright is the pre-installed global one; the script finds it via `npm root -g`.
  Do not `npx playwright install`.
- **Headless frame rates are meaningless. Never report them as performance.** Real numbers
  come only from the owner's phone (Bench button → Copy results).
- Deploy: `.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to
  `main` and to the working branch. Live URL: https://zubersss.github.io/artisticlook/
  (Pages must be enabled once: repo Settings → Pages → Build and deployment → Source: GitHub Actions).
- URL parameters: `world=earth-forest|mars`, `bookmark=path|clearing|backlit|hill|aerial`,
  `view=0|1|2` (raw / painter's light / painted), `time=N` (time-of-day preset), `hud=1`,
  `bench=3|10`, `res=1600` (fixed internal long side), `fps=30`, `quality=auto|max|min`,
  `msaa=0|2|4`, `shot=1` (deterministic, script-driven).
- Keys: WASD/arrows move, mouse drag look, Space/E up, C/Q down (fly), Shift fast,
  B next bookmark, 1–5 bookmarks, F walk/fly, T time, V view, O quality, H HUD, X overdraw view.

## Hard rules (from the brief — do not change without asking the owner)
- three.js current stable from npm (currently r187; check `node_modules/three` not memory).
  `WebGLRenderer`, WebGL 2, GLSL ES 3.00 `ShaderMaterial`s (`glslVersion: GLSL3`, own
  `fragColor` output). **No WebGPURenderer, no TSL.**
- Vite, plain JS ES modules, no framework, `base: './'`.
- World positions are 64-bit JS numbers in metres; the GPU only gets camera-relative
  positions (`src/core/worldframe.js`). World-anchored texture coordinates use per-scale
  origins computed in JS doubles. No logarithmic depth buffer.
- highp in fragment shaders for positions/depth/noise. **No sin-based hash noise** — integer
  hashes (`hashU` in `src/shaders/common.js`) or the noise texture.
- Full-screen passes: scene, quarter-res bloom chain (light shafts share it), one combined
  final pass. HDR target = cheapest renderable float format (R11F_G11F_B10F → RGBA16F →
  encoded RGBA8), checked at startup.
- Opaque first, then alpha-tested foliage near→far (alpha-to-coverage with MSAA; never
  alpha blending). Average overdraw < 2.5 at every bookmark.
- Hardware shadow comparison (`sampler2DShadow`). Every shader compiled behind the loading
  screen. **No per-frame allocations in the render loop** (preallocate; reuse typed arrays).
- < 150 draw calls, < 600k triangles, ≈ 250 MB GPU memory, fixed-size pools.
- Handle context loss (tap to reload), pause when hidden, rotation/resize, safe-area insets,
  screen wake lock.
- **Data-driven worlds**: `src/worlds/<name>.js` hold only numbers, hues and recipe names.
  No world-specific code paths in the engine. If a new world needs engine code, generalise
  the engine instead.
- Small single-purpose modules (terrain, brushwork, vegetation, sky/atmosphere, shadows,
  water, post, governor, ship, input, debug).
- Do not build: gameplay, animals, people, buildings, extra menus, other seasons, planet-scale
  terrain, space flight, volumetric clouds, SSAO, SSR, GI, motion blur, DoF, TAA.
- Reference paintings must never be committed. Their measured targets live in
  `docs/ART_DIRECTION.md`.

## How to work (from the brief)
- Stages are sequential; each must pass its checks before the next starts. Commit and push
  after each stage so the Pages link updates.
- One agent owns the look (light, brushwork, hero tree tuning stay in the main agent).
  Parallel agents only for independent modules inside a stage.
- After every visual stage: fresh critic agent that sees only screenshots + reference
  paintings + `docs/ART_DIRECTION.md` (never code) → five biggest gaps, ranked. Fix, repeat
  (≤ 3 rounds). Log every round in `docs/PROGRESS.md`.
- Stability test at every bookmark (`npm run stability`).
- Independent performance audit (fresh agent) before stage 9.
- Phone checkpoints at the end of stages 4, 6 and 10: push, stop, ask the owner to run the
  benchmark on the S23 Ultra and paste the results; tune the governor from them.
- If something is infeasible: simplest alternative that keeps the look and the performance
  policy, recorded in `docs/PROGRESS.md`.

## Git
- Work on the session branch given by the environment (currently `ccr-e519796c-145ibk`);
  push with `git push -u origin <branch>`. Do not push other branches without permission.
- Never commit `dist/`, `shots-tmp/` or reference images. `docs/shots/` holds the curated
  screenshots (JPEG).
