# Architecture

Rendering plan merged from three independent drafts (lead: architecture/stability;
planner A: mobile GPU budget; planner B: art fidelity — see `docs/PROGRESS.md` for what
was taken from each). Keep this file current when modules change.

## Conventions
- **Units & axes:** metres, +X east, +Y up, −Z north. Yaw/azimuth in degrees clockwise from north.
- **World positions** are JS doubles. `WorldFrame` (`src/core/worldframe.js`) holds the camera
  position; the three.js camera sits at the origin and every anchored object is placed at
  `anchor − camera` each frame. Instanced content is stored relative to its mesh anchor (small
  floats) and the anchor is re-placed per frame.
- **World-anchored textures**: shaders reconstruct world coordinates as `rel + uCamWrapped`,
  where `uCamWrapped = camera mod 4096 m` (computed in doubles). Every world-anchored texture
  period divides 4096 m. Brush octaves additionally get per-octave fractional origins and
  integer cell bases from JS, so precision does not depend on distance from the origin.
  This survives planet-scale coordinates later.
- **Depth:** standard 24-bit depth, near 0.25 m, far 40 km. No logarithmic depth.
- **Colours:** shader colours are linear-light `Vector3`s from `src/core/color.js`; no
  `THREE.Color` in uniforms (no implicit colour management). The final pass encodes sRGB.
- **Shaders:** GLSL ES 3.00 via `makeMaterial()` (`src/shaders/common.js`), which prepends the
  shared library (integer hashes, noise-texture noise, HDR encode) and shares global uniforms
  (`G`) by reference. Feature switches that change at runtime are uniforms (view mode,
  overdraw count mode), never defines, so nothing recompiles during play.
- **No per-frame allocation:** typed arrays and Vector objects are preallocated; pools are fixed
  size (instance buffers, falling leaves, tufts).

## Modules
| Path | Responsibility |
|---|---|
| `src/main.js` | boot, tap-to-start (fullscreen, landscape lock, wake lock), visibility pause |
| `src/core/engine.js` | owns renderer, scene, camera, modules; frame order; actions |
| `src/core/config.js` | URL parameters, engine constants |
| `src/core/worldframe.js` | 64-bit camera, camera-relative anchoring |
| `src/core/capabilities.js` | HDR format / MSAA / GPU string detection |
| `src/core/loop.js` | rAF loop, 60/30 fps cap on any refresh rate, interval measurement |
| `src/core/textures.js` | noise + canvas-weave textures, deterministic RNG |
| `src/shaders/common.js` | GLSL library, global uniforms, material factory |
| `src/sky/astronomy.js` | generic Kepler + IAU-rotation ephemeris (Sun, moons) |
| `src/sky/atmosphere.js` | CPU Rayleigh/Mie/ozone LUTs (transmittance, sky-view), sun colour, ambient |
| `src/sky/sky.js` | sky dome pass: LUT sky, sun disk, painted clouds, Moon, sky strokes |
| `src/terrain/heightfield.js` | recipe-driven height + material masks (CPU), height queries |
| `src/terrain/clipmap.js` | nested-ring clipmap mesh, vertex-fetched heights, terrain material |
| `src/brushwork/strokes.js` | procedural stroke texture (height, normal, id) with id-safe mips |
| `src/brushwork/*.glsl.js` | hex-tiled world-space stroke sampling, broken colour |
| `src/vegetation/*` | tree generator, leaf-dab atlas, instancing + LOD, tufts, falling leaves |
| `src/shadows/shadows.js` | two custom cascades, staggered updates, shadow chunk |
| `src/water/stream.js` | stream ribbon |
| `src/ship/lander.js` | procedural lander |
| `src/post/post.js` | bloom chain, light shafts, auto-exposure, final pass |
| `src/governor/governor.js` | adaptive quality ladder |
| `src/input/*` | touch stick / look drag / keyboard+mouse; walk/fly controller |
| `src/ui/*` | DOM HUD, buttons, screens |
| `src/bench/benchmark.js` | scripted route, statistics, report |
| `src/debug/*` | overdraw measurement, `window.__app` for scripts |
| `src/worlds/*.js` | world definitions (data only) |

## Frame order
1. Loop decides whether to render (target interval minus half a vsync of slack).
2. Input → controller (or benchmark route) → 64-bit camera pose.
3. Global uniforms (time, wrapped camera, sun), module `update(ctx)` (LOD binning, instance
   buffer writes into preallocated arrays), anchors re-placed.
4. Module `prerender` (shadow cascade: at most one per frame, only when needed).
5. Scene → HDR MSAA target (opaque near→far, foliage near→far, sky last at the far plane).
6. Post: prefilter to ¼ (karis-weighted colour; shaft source in alpha) → down ⅛ → down 1/16 →
   exposure (1×1 ping-pong, reads 1/16, texels clamped at 4× the scene average) → up 1/16→⅛
   (additive) → last up + light shafts (24-tap radial blur of the ¼ alpha, only when the Sun is
   in front) into one pre-scaled ¼ texture → final pass at canvas resolution.
7. HUD (DOM writes 4×/s), governor update, benchmark recording.

## Render targets
| Target | Size | Format |
|---|---|---|
| scene colour | **exact** internal size (re-allocated only on a resolution-level change) MSAA 4× | RGBA16F, **view distance (log) in alpha** → no depth resolve; MSAA may resolve on-tile |
| scene depth | MSAA renderbuffer, never resolved (`resolveDepthBuffer=false`, not stored) | DEPTH24 |
| fallback | R11F_G11F_B10F + resolved depth texture (explicit blit resolve), or RGBA8 encoded + dist in A | |
| bloom ¼, ⅛, 1/16, out ¼ | max size, viewport sub-rects | RGBA16F |
| exposure | 1×1 ×2 | RGBA16F |
| shadow cascades | 2048×1024 sun-aligned (stage 6) | DEPTH16 + compare |
| canvas | CSS × DPR, capped at 2.5 Mpx | default framebuffer, no depth |

Why RGBA16F rather than "the cheapest float format" alone: post needs view distance. RGBA16F with
distance in alpha costs the same bytes as R11G11B10F plus a resolved depth texture, needs no
depth resolve (three.js resolves the whole target every frame), avoids the undefined depth
contents of WEBGL_multisampled_render_to_texture, and avoids 5-bit-mantissa banding in the sky.
R11G11B10F is the automatic fallback when RGBA16F is not renderable.

Alpha-to-coverage is therefore confined to the **foliage depth prepass** (colour writes off);
the foliage colour pass uses depth test EQUAL, no discard, no A2C, so it gets early-Z and writes
distance into alpha like every other material (stage 4/5).

## Brushwork (src/brushwork)
- `strokes.js`: 512² RGBA8 stroke texture generated at startup (≈0.7 s): three layers (underlayer,
  body, accents) of bent, tapered, bristled strokes with dry-brush tails, wrap-around tileable;
  R height, GB normal, A stroke id; CPU mips with majority-id downsampling (ids never averaged).
- `brush.js` (GLSL, fragment-only chunk): world-space sheared triangle lattice per octave
  (tile 0.5 m·2^k, lattice cell = tile/2). Each lattice vertex places one stroke with rotation =
  flow direction + jitter, scale 0.85–1.2, random offset; a pixel blends its triangle's 3 vertices
  with sharpened height-biased weights. Two octaves cross-fade by straight-line distance and a
  rotation-invariant foreshortening term (|cos incidence|^-0.3), so strokes stay ~2–4 % of screen
  height and never re-scale when the camera turns. ≤ 6 `textureGrad` samples (anisotropic 4×),
  derivatives from world position rotated per stroke (no seams at lattice borders).
- Lattice origin from JS doubles: `uBrushCam` = (fine xz, 128 m-coarse xz) of the wrapped camera, so
  octaves ≤ 8 use exact integer lattice offsets — stable at any distance from the world origin.
- Flow field (heightfield `buildFlow`, 2 m texels, doubled-angle): along contours on slopes, slow
  noise swirl on flat ground, across the path inside it and along its edges, along the stream,
  random per stroke in leaf litter; far terrain uses contours from the normal.
- Terrain use: broken colour per stroke (Oklab hue/chroma/lightness, smooth in id), colour zones at
  32 m and 8 m, ~2 % borrowed fallen-leaf strokes in grass, ~5 % flecks of shadow hue (shade) or sky
  hue (light), stroke normals (0.2), faint sun sheen on ridges fading with mip level. Rocks: biplanar
  (sides along horizontal contours, tops along the ground plane), same rules.
- World-anchored noise rule: every world-space pattern uses power-of-two periods (m) so it is
  continuous across the 65 536 m camera wrap.

## Post / final pass (one full-screen pass at canvas resolution)
Exposure is read once per vertex (flat varying). Per pixel: distance warp (view-direction
3D value noise, 2 taps; amount `smoothstep(150 m, 2 km, dist) × ~2.5 px`; rejected when the
warped sample is nearer than 120 m so near silhouettes stay crisp) → 5-tap sharpened upscale
clamped to the neighbourhood → bloom+shafts (1 tap, pre-scaled) → exposure → painter's grade
(cool shadows toward the world shadow hue, warm highlights) → **Lottes 2016 curve on the max
channel** (b, c solved on the CPU: T(0.18)=0.21, T(10)=1) → gold bend of warm highlights,
mid-tone vibrance, contrast, warm lifted black floor (≈0.11 display), vignette → canvas weave
(screen-fixed, scaled to screen height) → sRGB + 1/255 dither. Raw view: same curve, no grade.

## Frame pacing and governor
- Loop: V = median rAF interval snapped to 144/120/90/60/30 Hz, re-measured continuously.
  Render every d = round(T/V) vsyncs (T = 16.7 ms, 33.3 ms battery); skipped callbacks issue no
  GL calls; a frame is a **miss** when more than d vsyncs passed.
- Ladder (low → high): canopy 125 · canopy 175 · far shadow 6 s · far shadow 2 s · tufts off ·
  tufts ½ · shafts off · 1280 · 1440 · 1600 · 1800 · 2000 (internal long side).
- Down: ≥ 8 misses in 30 frames → 2 levels; ≥ 9 in 180 and ≥ 2 in 30 → 1 level. Ignore 45–60
  frames after start, resume, resize, teleport or a change.
- Up: 240 clean frames, ≥ 4 s since the last change, CPU < 0.6 T, then a headroom check: on
  ≥ 90 Hz screens an **uncapped 30-frame burst** (mean interval ≈ frame cost) must be ≤ 0.72 T;
  on 60 Hz screens a blind probe with growing wait. A failed probe (≥ 3 misses in the next 120
  frames) steps back and blocks the level for min(8 s·2ⁿ, 128 s).
- Floor: at the lowest level with ≥ 5 % misses for 3 s → 30 fps; retry 60 after 30 s (doubling).
- Startup calibration behind the loading screen: 3 × 10 frames at the first bookmark with a 1×1
  readback sync; fastest batch ≤ 8 ms → start 1800, ≤ 11 → 1600, ≤ 13 → 1440, else 1280.
- Battery mode: T = 33.3 ms, capped at 1600, only steps down.

## Budgets (S23 Ultra, Adreno 740) — planning estimates from planner A, to be corrected by phone data
Design rule: the worst bookmark ≤ 9.5 ms GPU at 1600×744 on a cool phone, so a hot phone
(≈1.4× slower) stays under 16.6 ms at 1600.
| Pass | Target ms |
|---|---|
| shadow update (≤ 1 cascade/frame) | 0.3 avg, ≤ 1.0 on update frames |
| geometry + binning | 0.7 |
| terrain (≤ 4–6 stroke taps + shadow) | 1.1 |
| trunks, rocks, lander, stream | 0.4 |
| foliage depth prepass (A2C) + colour pass (EQUAL) | 0.6 + 0.6 |
| tufts, flowers, falling leaves | 0.4 |
| sky (last, early-Z) | 0.2 |
| MSAA resolve | 0.6 |
| bloom/shafts/exposure | 0.8 |
| final pass at ≤ 2.5 Mpx | 1.4 |
| compositor/DOM/ANGLE | 1.0 |
Limits: < 150 draw calls, < 600k triangles, ≈ 250 MB GPU memory (estimate ≈ 190 MB at 1600),
overdraw: shaded colour-pass fragments ≤ 2.0–2.5 per pixel, all rasterized incl. prepass ≤ 3.5.
Measured numbers per stage go in `docs/PROGRESS.md`.
