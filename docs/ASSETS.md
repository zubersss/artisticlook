# Assets and data sources

Charter rule: textures and data are procedural, public domain or CC0, each listed here with its
source. The owner's reference paintings are for study only and are never committed.

| Asset | Kind | Source | Licence |
|---|---|---|---|
| Brush-stroke texture (height, normal, stroke id) | generated at startup | `src/brushwork/strokes.js` | procedural (this repo) |
| Leaf-dab atlas | generated at startup | `src/vegetation/dabs.js` | procedural |
| Bark strokes | generated at startup | `src/brushwork/strokes.js` (bark settings in `src/vegetation/trees.js`) | procedural |
| Noise texture, canvas weave | generated at startup | `src/core/textures.js` | procedural |
| Terrain heights, masks, flow field | generated at startup from the world recipe | `src/terrain/heightfield.js`, `src/worlds/*.js` | procedural |
| Sky look-up tables | computed at startup (Rayleigh/Mie/ozone) | `src/sky/atmosphere.js` | procedural; physical constants from published atmospheric-scattering literature |
| Sun and Moon positions | computed (Kepler orbits, IAU rotation) | `src/sky/astronomy.js`; orbital elements: JPL "Approximate Positions of the Planets" and mean lunar elements | public data (US government works / published constants) |
| three.js | library | npm `three` | MIT (code dependency, not an asset) |

No external image, model or audio files are used yet.
