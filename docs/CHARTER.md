# Project charter (verbatim from the owner)

> Saved because future sessions have no memory except the repo. The rules are summarised in
> CLAUDE.md and the roadmap status lives in docs/ROADMAP.md; this file is the source text.

PROJECT CHARTER. Save this into the repo (CLAUDE.md for the rules, docs/ROADMAP.md for the roadmap with a status per milestone) and follow it in every session.

WHERE WE ARE
Milestone 1 is the brief you already have: the painted autumn forest on Earth, its ten stages and the Mars swap. If it is not finished, keep working on it exactly as that brief says, including its phone checkpoints. The roadmap below starts when milestone 1 is done. The rules here about finishing, replies and writing apply from now.

WHAT THIS GAME IS
An exploration game set in our real solar system where every view looks like a realist oil painting. You start in a painted forest on Earth. Over time you roam further, rise through the clouds to orbit, and visit other worlds painted in the same hand.

OWNERSHIP
You built this codebase and you maintain it. Its design is up to you: consolidate and restructure when that makes it healthier. Do not change how the game looks or feels as a side effect of a clean-up, and list every behaviour change in your checkpoint message.

FIXED DECISIONS (ask me before changing these)
- Art direction: "Painted realism", rules 1 to 11 of the first brief. This is the look I chose.
- Tech: three.js WebGLRenderer on WebGL 2, GLSL ES 3.00, Vite, plain JavaScript, static build, 64-bit world positions with camera-relative rendering, no logarithmic depth. The game must run in a phone browser and the codebase is built on these.
- Worlds are data-driven: one definition file per world, only generic engine additions. Textures are procedural or public domain or CC0, with sources in docs/ASSETS.md. My reference paintings are for study only and stay out of the repo.
- Test device: Samsung Galaxy S23 Ultra, Chrome, landscape. Policy: the best image quality that holds a steady frame rate there, including after 10 minutes when it throttles from heat. Frame rates from headless rendering say nothing about the phone, so do not report them as performance.
- Resolution (this replaces the 2000 px limit in the first brief): the ceiling is the canvas's native pixel size (CSS size times devicePixelRatio, which is 3088 x 1440 on this phone at its WQHD+ setting). The governor finds the highest resolution that holds the frame target, from about 1 million pixels up to native, lowering resolution first and features second, with hysteresis. Two modes on a button: Smooth (60 fps target, the default) and Sharp (30 fps target, favouring native resolution). Photo mode renders one frame at full native resolution.
- The mobile GPU rules and budgets of the first brief stay: under 150 draw calls, 600,000 triangles, about 250 MB of GPU memory, and average overdraw under 2.5.

AFTER MILESTONE 1: CLEAN UP OLD RULES
Delete the first brief's "do not build" list and its one-scene scope from CLAUDE.md and the docs, because the roadmap replaces them. Keep one scoped rule in their place: add an expensive effect (volumetric clouds, screen-space reflections, ambient occlusion, global illumination, motion blur, temporal anti-aliasing) only when the phone benchmark shows headroom and the governor can switch it off.

KEEPING THE LOOK CONSISTENT WITHOUT ME
- While my reference paintings are attached, write docs/REFERENCE_NOTES.md: what they show about palette, warm and cool balance, stroke size, edge softness and distance, in enough detail that a later session can judge against it without the pictures.
- When I approve a look at a checkpoint, copy those screenshots to docs/shots/approved/. Every later milestone must match them in handling and color unless I ask for a change.
- The independent critic from the first brief stays. After each visually significant step, start a fresh agent that sees only the screenshots, the reference notes or paintings, the approved shots and the art rules, never the code. It returns the five biggest gaps, ranked. Fix and repeat, up to three rounds.

WHAT YOU CAN DO WITHOUT ASKING
Everything routine: implementation choices, tuning, refactoring, task order inside a milestone, bug fixes, small quality-of-life features, installing packages, downloading public-domain data, committing, pushing, opening and merging your own pull requests, and performance trade-offs inside the policy. Record notable decisions in docs/PROGRESS.md. When torn, choose what best serves, in order: the art rules and approved shots, steady frame rate on the phone, the data-driven architecture.

ASK FOR APPROVAL BEFORE
- changing a fixed decision
- removing a feature the player can see or use
- anything that costs money or needs a new account or key
- using an asset whose licence is not public domain or CC0

QUESTIONS OF TASTE
Where the roadmap says "ask me", put the question in a checkpoint message with two or three options and a screenshot or sketch of each, and build my choice next. Do not stop in the middle of a milestone for a taste question: pick the option closest to the approved shots and tell me what you picked.

FINISHING WORK
Work through each milestone to its checkpoint. Please avoid ending a turn by listing remaining work or offering to continue. Ordinary obstacles such as errors, timeouts, failing tools and empty results are not blockers: diagnose them and work through them. The only planned stops are the checkpoints and the approvals listed above. If something truly cannot move without me, say plainly what you need and carry on with everything that does not depend on it.

HOW TO WORK ON EVERY MILESTONE
1. Read CLAUDE.md, docs/ROADMAP.md and docs/PROGRESS.md, then write a short plan.
2. One agent owns the look and the shared shader code. Use parallel agents only for independent pieces that touch separate files.
3. Judge visuals by looking, not by reading code: screenshots at every bookmark in all three views, then the critic.
4. Stability test: save 3 consecutive frames along short scripted moves. Strokes must stay attached to surfaces and nothing may crawl, boil or sparkle.
5. Give every new feature a place in the governor's step-down order, measure its overdraw, and extend the benchmark path to cover it.
6. Commit, push so the phone link updates, update the docs and mark the milestone in docs/ROADMAP.md.
7. Checkpoint: stop and send me the checkpoint message described below.

WHAT MY REPLIES MEAN
- "continue" means: start the next unfinished stage or milestone and work through it to its checkpoint.
- Pasted benchmark results mean: tune the governor and resolution range from them first, then continue as above.
- "approved" means: save the current screenshots as approved references, then continue.
- A complaint about how something looks or feels means: reproduce it in a screenshot, fix it, show me before and after, then return to the roadmap.

HOW TO WRITE TO ME
I am not a programmer and I read on a phone. Before a long stretch of work, say in a line what you are about to do, and give a one-line update every so often. Checkpoint messages are short and in plain words, with no terms you made up during the work: the link, what is new, three things to try on the phone, what to paste back, any question for me, and known problems.

ROADMAP (in order, after milestone 1)
2. Make the forest hold up on the phone. Use my benchmark results to tune the governor, the resolution range and the Smooth and Sharp modes. Close the biggest gaps against the references. Add times of day as data (misty sunrise, noon, golden hour, dusk, moonlit night with painted stars) and ambient life: a few birds, drifting seeds and insects, fireflies at dusk.
3. A character to play as. Ask me which design I want. Then build walking, running and flying, with a camera that keeps the character in view and the same stroke treatment on the figure.
4. A bigger piece of Earth. Streamed terrain several kilometres across with more painted landscapes: summer forest, river meadows, rocky hilltops, misty mountains, a lake. Seasons as palettes. Ask me which landscape to build first.
5. The whole Earth. Planet-scale terrain on the conventions already in place, real landforms from public-domain elevation data, landscapes placed by climate and height. Rise from the forest through painted clouds to orbit with no loading screen. From orbit, the globe painted in the same hand, with clouds, night lights and a thin blue edge.
6. The Moon and Mars as landable painted worlds, each a data file, with flight between them and Earth, and every sky showing the right bodies in the right places.
7. More worlds, one at a time, each a data file with real maps where they exist: Mercury, Io and Europa under Jupiter, Saturn with rings plus Enceladus and Titan, Venus, Triton with Neptune, Pluto and Charon. Checkpoint after every two.
8. Getting around: bodies at their real positions for a chosen date, a solar system map, fast travel with a clear visual effect, time controls.
9. Things to do: a photo mode that saves a frame at full native resolution as a painting, real landmarks to discover with a journal, progress saved in the browser, procedural audio (wind, leaves, water, birdsong).

START NOW
Save the charter and roadmap and write the reference notes. Then carry on with milestone 1 from wherever it stands.
