# CLAUDE.md — Painted Worlds

An exploration game set in our real solar system where every view looks like a realist oil
painting. You start in a painted forest on Earth; over time you roam further, rise through the
clouds to orbit, and visit other worlds painted in the same hand.

**Future sessions have no memory except these files. Read, in order, at the start of every session:**
1. `docs/CHARTER.md` — the owner's project charter, verbatim (rules for every session).
2. `docs/ROADMAP.md` — milestones with a status each. Work on the first unfinished one.
3. `docs/PROGRESS.md` — what is done, decisions, critic logs, phone results, open issues.
4. `docs/BRIEF.md` — milestone 1's brief, verbatim (its stages and checkpoints still apply until
   milestone 1 is done).
5. `docs/ARCHITECTURE.md` — modules, frame order, conventions, budgets.
6. `docs/ART_DIRECTION.md` and `docs/REFERENCE_NOTES.md` — the look, as measurable targets. The
   owner's reference paintings are NOT in the repo; judge against these notes and against
   `docs/shots/approved/` (the looks the owner approved).
7. `docs/ASSETS.md` — every texture/data source and its licence.

Then write a short plan before working (charter: "How to work on every milestone", step 1).

## Fixed decisions (ask the owner before changing any of these)
- **Art direction: "Painted realism"**, rules 1–11 of the first brief (docs/BRIEF.md, sections
  *Painter's light*, *Brushwork*, *Finish*).
- **Tech:** three.js `WebGLRenderer` on WebGL 2, GLSL ES 3.00 (`ShaderMaterial`, `glslVersion:
  GLSL3`, own `fragColor` output), Vite, plain JavaScript ES modules, no framework, static build
  (`base: './'`), 64-bit world positions with camera-relative rendering (`src/core/worldframe.js`),
  no logarithmic depth. Must run in a phone browser. No WebGPURenderer, no TSL. Use the current
  stable three.js from npm (check `node_modules/three`, not memory; currently r187).
- **Worlds are data-driven:** one definition file per world (`src/worlds/<name>.js`, numbers, hues
  and recipe names only); only generic engine additions, no world-specific code paths.
- **Assets:** procedural, public domain or CC0 only, each listed with its source in
  `docs/ASSETS.md`. Reference paintings are for study only and never enter the repo.
- **Test device:** Samsung Galaxy S23 Ultra, Chrome, landscape. Policy: the best image quality
  that holds a steady frame rate there, including after 10 minutes of heat throttling.
  **Headless frame rates say nothing about the phone — never report them as performance.**
- **Resolution:** the ceiling is the canvas's native pixel size (CSS size × devicePixelRatio;
  3088 × 1440 on the S23 Ultra at WQHD+). The governor finds the highest resolution that holds
  the frame target, from about 1 million pixels up to native, lowering resolution first and
  features second, with hysteresis. Two modes on a button: **Smooth** (60 fps target, default)
  and **Sharp** (30 fps target, favouring native resolution). **Photo mode** renders one frame at
  full native resolution. (This replaces the first brief's 2000 px limit.)
- **Mobile GPU rules and budgets:** under 150 draw calls, 600,000 triangles, about 250 MB GPU
  memory, average overdraw under 2.5. Few full-screen passes (scene, quarter-res bloom chain
  shared with light shafts, one combined final pass); HDR target in the cheapest renderable
  float format checked at startup; opaque first then alpha-tested foliage near→far
  (alpha-to-coverage, never alpha blending); hardware shadow comparison; every shader compiled
  behind the loading screen; no per-frame allocations in the render loop; fixed-size pools;
  highp for positions/depth/noise; no sin-based hash noise (integer hashes or noise texture);
  handle context loss, page hidden, rotation/resize, safe-area insets, wake lock.

## Scope rules
- Until milestone 1 is done, its brief's scope and "do not build" list still apply
  (docs/BRIEF.md). **When milestone 1 is done:** delete that list and the one-scene scope from
  this file and the docs, and keep only this rule: add an expensive effect (volumetric clouds,
  screen-space reflections, ambient occlusion, global illumination, motion blur, temporal
  anti-aliasing) only when the phone benchmark shows headroom and the governor can switch it off.

## What I can do without asking
Everything routine: implementation choices, tuning, refactoring, task order inside a milestone,
bug fixes, small quality-of-life features, installing packages, downloading public-domain data,
committing, pushing, opening and merging my own pull requests, performance trade-offs inside the
policy. Record notable decisions in `docs/PROGRESS.md`. When torn, serve in this order: (1) the
art rules and approved shots, (2) steady frame rate on the phone, (3) the data-driven architecture.

Ownership: I maintain this codebase and may restructure it, but a clean-up must not change how
the game looks or feels; every behaviour change goes in the checkpoint message.

## Ask the owner before
- changing a fixed decision;
- removing a feature the player can see or use;
- anything that costs money or needs a new account or key;
- using an asset whose licence is not public domain or CC0.

Taste questions ("ask me" in the roadmap): put them in a checkpoint message with 2–3 options and
a screenshot or sketch of each, then build the owner's choice. Never stop mid-milestone for a taste
question: pick the option closest to the approved shots and say what I picked.

## How to work on every milestone
1. Read the files above, then write a short plan.
2. One agent owns the look and the shared shader code. Parallel agents only for independent
   pieces that touch separate files.
3. Judge visuals by looking: screenshots at every bookmark in all three views (`npm run shots`),
   then the independent critic: a fresh agent that sees only the screenshots, the reference notes
   (or paintings when attached), `docs/shots/approved/` and the art rules — never the code — and
   returns the five biggest gaps, ranked. Fix and repeat, up to three rounds. Log every round in
   `docs/PROGRESS.md`.
4. Stability test: 3 consecutive frames along short scripted moves (`npm run stability`,
   `scripts/stability-sheet.py`). Strokes stay attached to surfaces; nothing crawls, boils or
   sparkles.
5. Every new feature gets a place in the governor's step-down order, an overdraw measurement
   (`node scripts/shots.mjs --overdraw`), and coverage in the benchmark path.
6. Commit, push so the phone link updates, update the docs, mark the milestone in
   `docs/ROADMAP.md`.
7. Checkpoint: stop and send the checkpoint message (below).

Finishing work: work through each milestone to its checkpoint. Errors, timeouts, failing tools
and empty results are not blockers — diagnose and work through them. The only planned stops are
the checkpoints and the approvals above. Do not end a turn by listing remaining work or offering
to continue. If something truly needs the owner, say plainly what is needed and carry on with
everything that does not depend on it.

## What the owner's replies mean
- **"continue"** — start the next unfinished stage or milestone and work through it to its
  checkpoint.
- **Pasted benchmark results** — tune the governor and resolution range from them first, record
  them in `docs/PROGRESS.md` ("Phone results"), then continue.
- **"approved"** — copy the current `docs/shots/*.jpg` to `docs/shots/approved/` (they become the
  reference for later milestones), then continue.
- **A complaint about how something looks or feels** — reproduce it in a screenshot, fix it, show
  before and after, then return to the roadmap.

## How to write to the owner
The owner is not a programmer and reads on a phone. Before a long stretch of work, say in one line
what I'm about to do; give a one-line update every so often. Checkpoint messages are short, in
plain words, with no terms invented during the work: the link, what is new, three things to try on
the phone, what to paste back, any question, and known problems.

## Run, test, deploy
- `npm install` then `npm run dev` (Vite dev server, `--host` so a phone on the LAN can open it).
- `npm run build` → static site in `dist/` (relative base path; works from any sub-path).
- `npm run shots` → builds, opens headless Chromium (SwiftShader WebGL 2, 915×412 phone-landscape
  viewport, deviceScaleFactor 2) and saves every bookmark × 3 views to `docs/shots/*.jpg`.
  Options: `--world=mars`, `--bookmarks=path,hill`, `--views=2`, `--scale=1`, `--out=shots-tmp/x`,
  `--nobuild`, `--hide=trees,rocks` (staged screenshots).
- `npm run stability` → 3 consecutive frames per bookmark while the camera moves, into
  `shots-tmp/stability/`; `python3 scripts/stability-sheet.py shots-tmp/stability` → contact sheet
  (frames, 2× crops near/mid/far, consecutive-frame differences: sparkle shows as speckle).
- `node scripts/shots.mjs --overdraw` → overdraw per bookmark (shaded / all rasterized).
- `node scripts/pose-shot.mjs --pose="x,z,eye,yaw,pitch;..." --out="a.jpg;..."` → close-ups from
  arbitrary poses.
- Playwright is the pre-installed global one; scripts find it via `npm root -g`. Do not
  `npx playwright install`.
- Deploy: `.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to
  `main` and to the working branch (Pages is enabled, source: GitHub Actions; the workflow can also
  be started by hand). Live URL: **https://zubersss.github.io/artisticlook/**. The HUD shows the
  build's commit so the owner can confirm the phone has the latest version.
- URL parameters: `world=earth-forest|mars`, `bookmark=path|clearing|backlit|hill|aerial`,
  `view=0|1|2` (raw / painter's light / painted), `time=N` (time-of-day preset), `hud=1`,
  `bench=3|10` (starts the benchmark after the tap), `res=1600` (fixed internal long side),
  `fps=30`, `quality=auto|max|min`, `msaa=0|2|4`, `shot=1` (deterministic, script-driven),
  `hide=trees,rocks`.
- Keys: WASD/arrows move, mouse drag look, Space/E up, C/Q down (fly), Shift fast, B next bookmark,
  1–5 bookmarks, F walk/fly, T time, V view, O quality, H HUD, X overdraw view.

## Git
- Work on the session branch given by the environment (currently `ccr-e519796c-145ibk`, which is
  also the repository's default branch); push with `git push -u origin <branch>`. Do not push other
  branches without permission.
- Never commit `dist/`, `shots-tmp/` or reference images. `docs/shots/` holds the curated
  screenshots (JPEG); `docs/shots/approved/` holds the owner-approved looks.
