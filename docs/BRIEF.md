# Milestone 1 brief (verbatim from the project owner)

> Kept in the repo because future sessions have no memory except these files.
> The reference paintings that came with the brief are NOT in the repo (by instruction).
> They are summarised in docs/ART_DIRECTION.md.

You are building the first milestone of a browser-based exploration game set in our real solar system, rendered to look like realist oil paintings. This milestone is one scene on Earth that proves the look, the foundations and the performance on a phone. Read the whole brief before writing code.

## ART DIRECTION: "Painted realism"
The world painted from life by a realist landscape painter in oils. Light, form and scale are realistic. The surface is paint. I have attached reference paintings: study them for light, color, stroke size and softness of distance. Do not copy any specific painting and do not commit the reference images to the repo.

### Painter's light
1. One real light source (the Sun), physically computed shadows and sky, HDR with slow auto-exposure and filmic tone mapping.
2. Warm light, cool shadow. Sunlight is slightly warm; shadows are filled with a cool hue from the world file (violet-blue on Earth). Shadows always have color and readable form, never pure black.
3. Rich saturated mid-tones, gently lifted blacks, no grey washed-out areas.
4. Painted distance: aerial perspective exaggerated about 1.5x, shifting toward a cool distance hue. Far edges soften, near edges stay crisp.
5. Glow: soft warm bloom around the Sun and in bright haze.

### Brushwork anchored to the world (it must never swim, crawl or flicker)
6. Generate all textures procedurally at startup, with no external assets: a tileable brush-stroke texture (stroke height, normal, per-stroke random ID in one RGBA texture), a leaf-dab atlas, bark strokes.
7. Map strokes onto terrain and rocks in world space at scales that cross-fade with distance, so strokes stay about 2 to 4 percent of screen height. At most 6 stroke samples per pixel.
8. Strokes follow form. Broken color: vary hue, saturation and value slightly per stroke, and let about 5 percent of strokes pick up the shadow or sky hue as flecks.
9. Shadow edges are offset by stroke height so they look brushed. Strokes catch a faint sheen from the Sun.

### Finish
10. Sky modulated by broad soft strokes anchored to view direction. Distant silhouettes softened by a small view-anchored warp (none near, a few pixels far). Faint canvas weave, gentle vignette.
11. No outlines, posterization, cel shading, halftone or chromatic aberration.

## TARGET DEVICE AND PERFORMANCE POLICY
- The test device is a Samsung Galaxy S23 Ultra (Snapdragon 8 Gen 2, Adreno 740, 120 Hz screen) running Chrome for Android in landscape. It must also run on desktop browsers with keyboard and mouse.
- Policy: the best image quality that holds a steady 60 fps on that phone, including after 10 minutes of play when it throttles from heat. Never below 30 fps.
- Adaptive governor: measure frame time continuously. When over budget, lower render resolution first, then step features down in this order: light shafts, grass tufts, far shadow cascade update rate, canopy quads per tree. When there is sustained headroom, step back up in reverse. Use hysteresis so it never oscillates visibly.
- Internal resolution: render the 3D scene to a target whose long side ranges from 1280 to 2000 px (start at 1600), independent of the phone's very high pixel ratio, and upscale with mild sharpening in the final pass. Draw UI in DOM at native resolution.
- Cap rendering at 60 fps on 120 Hz screens. Offer a 30 fps battery mode.

## TECH CONSTRAINTS (do not change without asking me)
- three.js, current stable release from npm. Check the installed version and its docs instead of relying on memory. WebGLRenderer on WebGL 2 with GLSL ES 3.00 shaders. No WebGPURenderer, no TSL.
- Vite, plain JavaScript ES modules, no framework, relative base path so the static build works on GitHub Pages.
- World positions are 64-bit JS numbers in metres; the GPU gets camera-relative positions. No logarithmic depth buffer. Later milestones add planet-scale terrain, space flight and other worlds, so keep these conventions even though this scene is local.

## MOBILE GPU RULES
- highp precision for positions, depth and noise in fragment shaders. No sin-based hash noise; use integer hashes or noise textures.
- Few full-screen passes: the scene, a quarter-resolution bloom chain that light shafts share, and one combined final pass (tone map, grade, distance warp, canvas, vignette, upscale).
- HDR target in the cheapest renderable float format the device supports, checked at startup, with a working fallback.
- Draw opaque geometry first, then alpha-tested foliage near before far. Average overdraw under 2.5 at every bookmark.
- Hardware shadow comparison sampling. Compile every shader behind a loading screen so there are no hitches during play. No per-frame allocations in the render loop.
- Under 150 draw calls, 600k triangles and about 250 MB of GPU memory, with fixed-size pools.
- Handle WebGL context loss (offer tap to reload), pause when the page is hidden, handle rotation and resize, respect safe-area insets, and hold a screen wake lock during play where available.

## ARCHITECTURE RULES
- Data-driven worlds: one definition file per world (src/worlds/earth-forest.js, src/worlds/mars.js) holding only numbers, hues and recipe names. No world-specific code paths in the engine.
- Small single-purpose modules: terrain, brushwork, vegetation, sky and atmosphere, shadows, water, post-processing, governor, ship, input, debug.
- Write and keep updated: CLAUDE.md (how to run, test and deploy, plus these rules), docs/ART_DIRECTION.md, docs/ARCHITECTURE.md, docs/PROGRESS.md. Future sessions have no memory except these files.

## THE SCENE: Earth, an autumn forest in late afternoon, Sun about 20 degrees high
- Terrain: a 600 m by 600 m walkable patch of rolling hills with meadow clearings, a winding dirt path and a stream, surrounded by several kilometres of low-detail hills out to violet-blue ridges.
- Ground: sunlit grass in yellow-green, shaded grass in cool deep green, rust and umber leaf litter under trees, a warm ochre path flecked with fallen leaves, mossy boulders, grass tufts and small white and yellow flower dabs near the camera.
- Trees, built entirely from code: low-poly tapered trunks with 3 to 6 limbs and bark painted in vertical strokes, warm on the lit side, violet in shade, mossy at the base. Canopies are clusters of camera-facing quads carrying leaf-sized dab cutouts (alpha-tested with coverage-preserving mipmaps, never alpha-blended). Take normals from each cluster's sphere so canopies shade as soft volumes with darker interiors. When the camera looks toward the Sun through leaves, they must glow warmly; this backlit glow is the strongest effect in the references. Six deciduous variants in orange, gold, yellow, red and some green, plus two dark conifer variants.
- Forest: 1,500 to 2,500 trees from a density map. Near trees (under 40 m) use up to 250 quads, mid trees (to 200 m) about 70 larger dabs, and beyond that the forest becomes a painted canopy texture on the terrain. Transitions fade, never pop. One InstancedMesh per variant per level of detail, billboarding in the vertex shader.
- Dappled light: two shadow cascades (about 120 m and about 900 m) that trees cast into, each re-rendered only when the camera or Sun has moved enough, never both in one frame. Soft filtering.
- Air: a physically based sky from a small precomputed lookup (Rayleigh and Mie, parameters from the world file), height fog shifting from the cool distance hue to warm glow toward the Sun, and quarter-resolution light shafts through the trees.
- Sky: painted cumulus clouds on the dome with lit tops and violet-grey bases, and a pale daytime Moon at a correct position and phase.
- Stream: a 2 to 4 m ribbon with painted ripple strokes moving along the flow, sky reflection by Fresnel, sun glints, stones on the banks. No refraction, no screen-space reflections.
- Life: gentle wind sway in canopies and tufts, about 200 drifting falling leaves near the camera.
- Ship: a small lander about 4 m tall parked in a meadow clearing, built from code, realistic materials with the same stroke treatment at a finer scale, blinking nav lights.

## CONTROLS AND UI
- Touch first: left thumb stick to move, right thumb drag to look, and on-screen buttons for next bookmark, walk or fly, time of day, view cycle (raw lighting, painter's light, full painted look), quality, HUD and benchmark. A tap-to-start screen that enters fullscreen and locks landscape where the browser allows. Desktop: WASD, mouse and the same buttons.
- Camera bookmarks, also selectable by URL: path (on the path looking into hazy backlit forest, big trunk in the left foreground), clearing, backlit, hill (over treetops to distant ridges), aerial (200 m up, looking down at 40 degrees over forest, stream and paths).
- HUD: fps, frame time, render resolution, governor state, draw calls, triangles, and the build's commit hash so I can confirm the phone has the latest version.

## BENCHMARK MODE
A button and URL parameter that fly a scripted 3-minute path through every bookmark (and a 10-minute soak option), then show a results screen: average fps, 1 percent low fps, average and minimum render resolution, governor steps taken, GPU renderer string, screen size and pixel ratio, three.js version, commit hash. Include a Copy results button.

## DEPLOYMENT
Set up GitHub Actions to build and publish to GitHub Pages on every push to main, and give me the link. If you cannot enable Pages yourself, tell me exactly what to tap in the repo settings.

## DO NOT BUILD
Gameplay systems, animals, people, buildings, menus beyond the above, other seasons, planet-scale terrain, space flight, volumetric clouds, SSAO, SSR, global illumination, motion blur, depth of field, TAA.

## HOW TO WORK
1. Plan before code. Write CLAUDE.md, the docs and a staged plan in docs/PROGRESS.md. For the rendering plan, draft it from two or three independent angles and keep the best parts.
2. Stages are sequential. Do not start one until the previous passes its checks. Commit and push after each so the link updates. (1) skeleton, HDR post, governor, HUD, touch input, deployment, screenshot script; (2) terrain, far hills, sky, haze, painter's light; (3) brushwork on ground and rocks; (4) one hero tree, tuned against the references before making any others; (5) forest placement, instancing, levels of detail, far canopy; (6) shadows and dappled light; (7) ground dressing, stream, clouds, Moon, lander; (8) light shafts, wind, falling leaves, finish; (9) performance pass and benchmark mode; (10) Mars swap.
3. One agent owns the look. The tuning loops for light, brushwork and the hero tree stay in a single agent with full context. Use parallel agents only for independent modules inside a stage (for example stream, clouds, Moon and lander in stage 7), and keep shared shader code and conventions with the main agent.
4. You cannot judge this by reading code. Set up a script (Playwright or Puppeteer, headless Chromium with software WebGL, phone-landscape viewport) that saves a screenshot at every bookmark. Headless frame rates are meaningless; never report them as performance.
5. Independent critic. After every visual stage, start a fresh agent that sees only the screenshots, my reference paintings and the art rules, never the code. It returns the five biggest gaps, ranked. Fix them and repeat, up to three rounds per stage. Log each round in docs/PROGRESS.md.
6. Stability test: at each bookmark, move the camera along a short scripted path and save 3 consecutive frames. Strokes must stay attached to surfaces and distant canopies must not sparkle. Fix or remove anything that crawls or boils.
7. Independent performance audit before stage 9: a fresh agent reviews shaders and the render loop for mobile cost (texture samples per pixel, passes, overdraw, allocations) and reports what to cut.
8. Phone checkpoints. At the end of stages 4, 6 and 10, push, then stop and ask me to open the link on the S23 Ultra, run the benchmark and paste the results. Use my numbers to tune the governor before continuing.
9. Stage 10 proves the style travels. Add src/worlds/mars.js, loaded by URL parameter, that changes only data: no vegetation or water, a rock-and-dust terrain recipe with dunes and scattered rocks, a butterscotch sky with dust haze, a smaller and dimmer Sun, warm peach light, plum-violet shadows, a mauve distance hue. It must look like a painted Mars with no engine code changes. If it needs them, fix the architecture.
10. If something proves infeasible, choose the simplest alternative that keeps the look and the performance policy, and record it in docs/PROGRESS.md.

## DONE MEANS
- The link runs the scene on the S23 Ultra with touch controls, and the build is a static site.
- Screenshots of every bookmark in all three views, for Earth and Mars, are saved in docs/shots/.
- Your final message tells me: what was built, what was simplified and why, where the result still falls short of the references, the overdraw number at each bookmark, and what to look for on the phone (shimmer, popping, heat slowdown).
