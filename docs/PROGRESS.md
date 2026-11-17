# Progress

Live URL: https://zubersss.github.io/artisticlook/ (see CLAUDE.md for enabling Pages).
Each stage is committed and pushed when its checks pass. Headless screenshots are for
judging the look only; performance numbers come only from the owner's phone.

## Staged plan
| # | Stage | Checks | Status |
|---|---|---|---|
| 1 | Skeleton: renderer, camera-relative world, HDR target + bloom/shafts/exposure + final pass, governor, HUD, touch/desktop input, bookmarks, basic benchmark, Pages workflow, screenshot/stability/overdraw script | builds; runs headless with no console errors; screenshot script saves every bookmark; workflow present | **done** — placeholder ground/sky through the full HDR chain; tap-to-start, touch look/stick, HUD, benchmark start/stop/report verified headless |
| 2 | Terrain (clipmap, recipe heightfield, path/stream/clearings carving), far hills & ridges, CPU atmosphere LUT sky, aerial perspective + height fog, painter's light | screenshots of all bookmarks; critic rounds (≤ 3) | |
| 3 | Brushwork on ground and rocks: stroke texture, hex-tiled world-space strokes, 2 octaves, broken colour, flecks, sheen, brushed shadow edges; boulders | critic rounds; stability test | |
| 4 | One hero tree: trunk/limbs/bark strokes, leaf-dab atlas (coverage-preserving mips), canopy clusters, backlit glow; tuned against references | critic rounds; stability; **phone checkpoint 1** | |
| 5 | Forest: density map placement (1,500–2,500), 6 deciduous + 2 conifer variants, instancing per variant per LOD, near/mid LOD fades, far painted canopy on terrain | critic; stability; overdraw < 2.5 | |
| 6 | Shadows: two cascades (120 m / 900 m), staggered updates, soft + brushed filtering, dappled light | critic; stability; **phone checkpoint 2** | |
| 7 | Ground dressing (tufts, flowers), stream, clouds, Moon, lander (parallel agents allowed for independent modules) | critic; stability | |
| 8 | Light shafts tuning, wind sway, falling leaves, finish | critic; stability | |
| 9 | Performance pass (after an independent performance audit) and full benchmark mode | audit findings addressed; overdraw per bookmark | |
| 10 | Mars swap: `src/worlds/mars.js` data only | Mars screenshots; no engine changes needed; **phone checkpoint 3** | |

## Rendering plan — what came from where
- **Lead (architecture/stability):** camera-relative 64-bit world, wrap-period texture anchoring,
  max-size targets with viewport-only resolution changes, explicit MSAA resolve for depth,
  clipmap terrain, CPU atmosphere LUT, uniform-switched view modes (no recompiles), ladder
  governor with probe/back-off.
- **Planner B (art fidelity):** measured reference targets (now `docs/ART_DIRECTION.md`),
  painter's light math (light-family compression, terminator bleed, anti-solar fill, chroma-
  preserving haze through mauve), Lottes max-channel tone curve, exposure texel clamp,
  stroke texture recipe (3 layers, bent spines, bristles, id-safe mips), flow-field rules,
  `textureGrad` + JS-double origins for stability, octave choice by straight-line distance,
  hero tree proportions, palettes, glow phase function, dab sizes (clusters, not leaves).
- **Planner A (mobile budget):** per-pass ms budget and design rule (≤ 9.5 ms cool at 1600);
  exact-size scene target (three resolves the whole allocation); RGBA16F with distance in alpha
  instead of a depth resolve; foliage depth prepass with A2C + EQUAL colour pass (Adreno runs
  late-Z for alpha-tested draws); octagon cards fitted to dabs; rank-threshold dab culling for
  LOD fade and governor; sun-aligned 2048×1024 D16 shadow maps with opaque sun-facing caster
  cards and a camera-centred near cascade; bloom without the 1/32 level and shafts merged into
  the last upsample; exposure read per vertex; final pass capped at 2.5 Mpx; vsync-snapped pacing,
  miss-count step-down rules, uncapped-burst headroom probing, startup calibration, 30 fps floor.
- **Rejected / deferred:** uncapped-burst is used, but GPU fence sampling is not (allocates sync
  objects). Exact per-instance foliage sorting replaced by 8-bucket ordering (planner A).

## Decisions and simplifications
- Deployment: the session may only push its working branch, so the Pages workflow runs on
  pushes to `main` **and** to the working branch. The first push to the empty repository makes
  the working branch the default branch, which GitHub Pages' environment rules allow.
- Scene time: 2026-10-16 19:58 UTC at 44.5° N 72.6° W → Sun 19.9° high at azimuth 234°
  (south-west), a 34 % waxing Moon 14° up at azimuth 159°. Ephemeris checked against the
  2024-04-08 total eclipse (Sun/Moon within ~1°; mean lunar elements without perturbations).

## Critic log
(per stage, per round: the five gaps returned, what was changed)

## Phone results
(pasted benchmark results from the owner's S23 Ultra, and the governor changes made)

## Overdraw per bookmark
(from `node scripts/shots.mjs --overdraw`)
