# Roadmap

Source: docs/CHARTER.md. Status values: **done**, **in progress**, **waiting on owner**, **not started**.
Update this file when a milestone or a checkpoint changes state.

| # | Milestone | Status | Checkpoint / notes |
|---|---|---|---|
| 1 | Painted autumn forest on Earth (docs/BRIEF.md: 10 stages + Mars swap) | **in progress** — stages 1–4 done; stage 5 next | Phone checkpoint 1 (end of stage 4) sent; benchmark numbers not yet received — tune the governor from them when they arrive. Phone checkpoints 2 (stage 6) and 3 (stage 10) to come. See docs/PROGRESS.md. |
| 2 | Make the forest hold up on the phone: tune governor, resolution range, Smooth and Sharp modes from benchmarks; close biggest gaps vs references; times of day as data (misty sunrise, noon, golden hour, dusk, moonlit night with painted stars); ambient life (a few birds, drifting seeds and insects, fireflies at dusk) | not started | |
| 3 | A character to play as (ask which design), walking, running, flying, a camera that keeps the character in view, same stroke treatment on the figure | not started | Taste question: character design. |
| 4 | A bigger piece of Earth: streamed terrain several km across; summer forest, river meadows, rocky hilltops, misty mountains, a lake; seasons as palettes | not started | Taste question: which landscape first. |
| 5 | The whole Earth: planet-scale terrain on the existing conventions, real landforms from public-domain elevation data, landscapes by climate and height; rise through painted clouds to orbit without a loading screen; painted globe with clouds, night lights, thin blue edge | not started | |
| 6 | The Moon and Mars as landable painted worlds (data files), flight between them and Earth, every sky showing the right bodies in the right places | not started | |
| 7 | More worlds, one at a time (data files, real maps where they exist): Mercury; Io and Europa under Jupiter; Saturn with rings plus Enceladus and Titan; Venus; Triton with Neptune; Pluto and Charon | not started | Checkpoint after every two worlds. |
| 8 | Getting around: bodies at real positions for a chosen date, solar system map, fast travel with a clear visual effect, time controls | not started | |
| 9 | Things to do: photo mode saving a full-native-resolution painting, real landmarks to discover with a journal, progress saved in the browser, procedural audio (wind, leaves, water, birdsong) | not started | |

## Fixed decisions that changed during milestone 1
- Resolution: the 2000 px internal limit of the first brief is replaced by the canvas's native pixel
  size (CSS size × devicePixelRatio; 3088 × 1440 on the S23 Ultra at WQHD+). The governor searches
  from about 1 million pixels up to native. Two modes on a button: Smooth (60 fps, default) and Sharp
  (30 fps, favouring native). Photo mode renders one frame at full native resolution.
