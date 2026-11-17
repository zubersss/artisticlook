# Progress

Live URL: https://zubersss.github.io/artisticlook/ (see CLAUDE.md for enabling Pages).
Each stage is committed and pushed when its checks pass. Headless screenshots are for
judging the look only; performance numbers come only from the owner's phone.

## Staged plan
| # | Stage | Checks | Status |
|---|---|---|---|
| 1 | Skeleton: renderer, camera-relative world, HDR target + bloom/shafts/exposure + final pass, governor, HUD, touch/desktop input, bookmarks, basic benchmark, Pages workflow, screenshot/stability/overdraw script | builds; runs headless with no console errors; screenshot script saves every bookmark; workflow present | **done** — placeholder ground/sky through the full HDR chain; tap-to-start, touch look/stick, HUD, benchmark start/stop/report verified headless |
| 2 | Terrain (clipmap, recipe heightfield, path/stream/clearings carving), far hills & ridges, CPU atmosphere LUT sky, aerial perspective + height fog, painter's light | screenshots of all bookmarks; critic rounds (≤ 3) | **done** — 3 critic rounds (log below); CDLOD terrain, CPU atmosphere LUT, painted sky, aerial + ground haze, painter's light, far canopy crowns |
| 3 | Brushwork on ground and rocks: stroke texture, hex-tiled world-space strokes, 2 octaves, broken colour, flecks, sheen, brushed shadow edges; boulders | critic rounds; stability test | **done** — 3 critic rounds, stability sheets at every bookmark |
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

### Stage 2, round 1
Gaps (ranked): (1) sky too dark/navy (#3B5180), heavier than the land — must be the lightest mass;
(2) values compressed (1st pct 0.21–0.29, 99th 0.51–0.69), no light/shade families, flat mustard
ground; (3) Sun a white dot in a grey veil — no warm halo; (4) distance a thin pale jagged wall,
lighter than the sky, no middle planes, mid canopy magenta; (5) aerial canopy reads as camouflage
(magenta darks, red outlines, teal blotches, grey path).
Changes: painter's sky = LUT luminance compressed (exp 0.42) and lifted ×2.1, hues pulled 65 %
toward a painted palette (zenith #7B8EC7, horizon #BCCBE0, cream band, warm halo #EAD8B8 out to
~35°); Sun disc painted cream at a fixed pre-curve value using the current exposure (read per
vertex); exposure metering weights the lower half; ground haze capped (optical depth ≤ 1.1) and
handed over to the aerial colour beyond 0.6–3 km; warmer haze hue; aerial extinction 8e-5/m with a
900 m scale height (misty bases); layered rounded far hills (1.4 km, 3.1 km, 5.2 km wavelengths);
far canopy rebuilt as lit crowns on a jittered 8 m lattice with species clumps (contiguous palette
runs, greens as separate clumps), umber gaps, detail fading 0.5–1.5 km; path stays visible at
distance; brighter grass; tone curve a=1.38, contrast 1.1.

### Stage 2, round 2
Gaps: (1) sky still a saturated "skybox" blue (zenith #4C69B5) with little top-to-bottom value
change; (2) ground dim mustard at near-max chroma, shaded litter blood-red, path s0.86 with red
blotches; (3) the Sun halo a vertical pillar with grey edges; (4) ridges one flat lavender strip as
light as the sky, glowing white behind the Sun, no planes; (5) aerial canopy "flat sequins", too
red/saturated, gaps too dark, no distance shift, clearings not the lightest masses.
Changes: sky luminance now comes from the painted palette (zenith ≈ half the horizon's luminance)
scaled to a CPU reference from the LUT; round halo with a smooth Mie-like falloff walking cream →
peach → blue in Oklab (no grey); no mid-tone vibrance on sky pixels; aerial inscatter 18 % darker
than the sky behind it and the separate Mie glow nearly removed (the painted halo carries it);
new generic `range` terrain primitive → concentric hill ranges at 2.3, 4.6 and 8.5 km (receding
planes); sunlight chroma reduced to 62 % (slightly warm, not orange); terminator/shadow chroma
boosts halved; less red litter and path flecks; crowns lobed, domed, with saturated dark shade
sides and a gold sunward fringe; palette shifted to gold with red as an accent; lighter umber-olive
gaps; exposure key 0.21; post saturation 1.1.

### Stage 2, round 3 (final)
Gaps: (1) value key too high, shadows lifted to lilac-grey (lit:shadow ≈ 2.3:1, darkest 1 % at
0.29–0.46); (2) halo a flat cream plateau running to the top edge, grey seam into the blue, no sky
brushwork (σ 0.003); (3) middle distance a milky salmon haze hiding the crowns; (4) ridges a pale
pink band with a violet crest line, as light as the sky; (5) aerial canopy a uniform carpet of
tiles, no groves.
Changes: exposure key 0.15 and metering less bottom-weighted (contre-jour reads); the painter's fill
is half desaturated toward a warm neutral and 20 % weaker, anti-solar fill halved, shadow-hue fill
0.2; halo smaller and steep (fades by ~28°), hue walk blue → muted lilac → peach → cream with chroma
held in Oklab, gold haze low under the Sun; sky strokes now use the stroke texture in
view-direction space (±16 %); aerial inscatter 0.58 × the painted sky, ground haze no longer lifted
by the sky lift, capped at optical depth 0.6; altitude-based ridge tint (the crest outline) removed,
land beyond 4 km painted as a mauve mass and pushed to blue-violet by a second distance-hue stage
(3–9 km); taller ranges at 2.3/4.6/8.5 km; forest density patchier (groves and meadows), crowns
exist only where density allows, sizes vary 0.4–0.82 of the lattice, brighter gold sunward fringe;
greener grass albedo.
Left for later stages (needs trees/shadows): contre-jour darks near the camera, crown shadows on
neighbours, value structure of forest views.

### Stage 3, round 1
Gaps: (1) broken colour ~3× too weak (hue ±2–3°, value σ 0.02–0.05), path one flat orange, flecks
< 0.5 % and reading as pale pebbles; (2) pixel grain inside strokes (50–64 % of texture energy at
1–3 px) that would crawl, stair-stepped far crown edges; (3) boulders as clay loaves with
near-black neutral shadows; (4) mechanical patterns: random-angle "scales", curling "marbling",
a swirl where path-edge and interior flows meet, one-direction combing; (5) distance as hard-edged
blue-violet "worms" (far species zones), grazing strokes stretched to 4–6 % of height.
Changes: per-stroke broken colour hue ±10°, chroma ±20 %, value ±12 %, plus a cooler darker
underlayer between strokes; path = purple-brown earth (#6A4C3A) with lit leaf dabs on ~25 % of
strokes; flecks on ~5 % of strokes: dark blue-green in shade, warm lit dabs (few cool notes) in
light; stroke texture interiors flattened (bristles only at edges and tails, relief blurred
before normals); crown edges antialiased with fwidth and crown detail faded by 1.1 km; far canopy
beyond detail range = one averaged autumn colour with soft modulation (no species zones); flow
field follows contours almost everywhere (threshold 0.004), slower flat-ground swirl, path strokes
across with edges leaning only 30° (no swirl), jitter 24°; grazing foreshortening capped
(|cos|^-0.2); boulders: flat-faceted knife planes with larger strokes, one direction per facet, warm
reflected ground light and chroma in shadow, gold/moss flecks on tops, warmer rock albedo.

### Stage 3, round 2
Gaps: (1) grass/litter read as felt (stroke-scale contrast 0.02 vs 0.06, hue spread 5–8° vs
25–45°, lit grass too dim); (2) strokes collapse to 2–4 px stipple beyond the foreground (ground
strokes foreshortened vertically) and far land is sandpaper; (3) path = terrazzo chips, too
saturated, no sun pools, soft olive edge band, a dark thread from the air; (4) boulders low-poly clay
with near-black shadows and over-saturated marbled lit faces, no contact with the grass; (5) contour
"agate" bands in aerial meadows.
Changes: flat-colour strokes (winner sharpness 7), per-stroke hue ±14°, chroma ±22 %, value ±20 %, a
darker olive underlayer between strokes, light/dark patches at 4 m and 16 m (±30 %); stroke scale
grows with grazing incidence (|cos|^-0.3) and stroke *shapes* stretch up to 2× along the ground-
projected view direction around world-anchored centres (shapes breathe smoothly with camera
position, centres never slide); path = greyed mauve-umber earth with fallen leaves gathered in 4 m
sun pools (10–55 %), ragged one-stroke edge, pale ochre ribbon from afar; boulders: smooth body with
facets re-introduced in the shader (screen-derivative face normal mixed 45 %), lifted warm darks
(ground bounce + sky fill), less saturation and marbling, grass over the base; stroke jitter 40° on
flat ground; exposure key 0.17.
Also: fixed inverted trunk winding (backlit trunks are now dark with a warm rim); foliage EQUAL-depth
self-test at startup with automatic LESS-EQUAL + alpha-test fallback.

### Stage 3, round 3 (final)
Gaps: (1) camouflage look: notched pixel-stepped stroke outlines and dark 1-px seams; (2) grass
mid-value felt, layers do not read (needs dark underlayer patches and gold accents); (3) path reads
as gravel (random chip directions, too few leaves, too red, blurred edge); (4) litter in raked
parallel rows, mid-distance airbrush, aerial contour marbling, an octave seam of double-size
strokes; (5) rocks unpainted, neutral black shadows.
Changes: stroke texture dry-brush tails and bristles reduced (≤ 6 %, no notched edges); thin-paint
darkening softened (no seams); 18 % of grass strokes are a dark shaded-green underlayer, 7 % gold
accents (#E6D24A); flow field at 1 m texels, path strokes calm (16° jitter) and across the path,
greyed umber earth (#70604A), leaves 7–22 % in sun pools plus stray leaves on the grass, crisp path
edge; litter and meadows random per stroke; contour flow only on real slopes (no rings on hill
tops); radial stroke stretch up to 2.2×; octave cross-fade widened to 0.6 so sizes interleave;
+0.5 mip bias on strokes; rocks lavender-grey, more sky/ground fill, stronger broken colour.
Stability: 3-frame sequences at every bookmark keep strokes attached; remaining risk is fine
detail in mid-distance grass at 30–80 m — check on the phone.

## Phone results
(pasted benchmark results from the owner's S23 Ultra, and the governor changes made)

## Overdraw per bookmark
(from `node scripts/shots.mjs --overdraw`; "shaded" = colour-pass fragments per pixel, "all" also
counts the foliage depth prepass)

| Stage | path | clearing | backlit | hill | aerial |
|---|---|---|---|---|---|
| 3 (ground + 3 hero trees) | 1.09 / 1.10 | 1.03 / 1.05 | 1.10 / 1.23 | 1.18 / 1.18 | 1.00 / 1.00 |

## Tools
- `node scripts/pose-shot.mjs --pose="x,z,eye,yaw,pitch;..." --out="a.jpg;..."` screenshots from
  arbitrary poses (tuning close-ups).
- Load-time profile (SwiftShader, CPU side): heightfield ≈ 2.0 s, stroke texture ≈ 0.5 s, sky LUTs
  ≈ 0.2 s, trees ≈ 0.9 s, shader compile ≈ 0.3 s. Phones are slower on CPU; if loading is too slow,
  the heightfield build is the first candidate for a worker.
