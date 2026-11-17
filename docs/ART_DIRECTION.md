# Art direction: "Painted realism"

The world painted from life by a realist landscape painter in oils. Light, form and
scale are realistic; the surface is paint. The full rules are in `docs/BRIEF.md`
(sections *Painter's light*, *Brushwork*, *Finish*). This file turns them into
**measurable targets** so screenshots can be judged without the reference images
(which are deliberately not in the repo).

The numbers below were measured from the 20 reference paintings the owner supplied
(numpy: value percentiles, HSV region samples, distance bands in the aerial views,
stroke scale from autocorrelation width). Colours are **display sRGB targets** for
comparing screenshots, not albedos. HSV is written `h°/s/v`.

## 1. Measured targets

### Value structure
- Darkest 1 %: luma 0.11–0.14 in forest views, 0.18–0.21 in aerial views. Median 0.30–0.43. 99th percentile 0.75–0.87.
- Only cloud tops and sky next to the Sun reach ~0.94, and they are warm cream (#F0D8B9), never white.
- Darks are warm umber (#34271A, s≈0.45), never black, never blue. They live on foreground trunk shadow sides, trunk bases and shaded grass in the bottom corners.
- Lights: haze at the vanishing point, the canopy fringe around the Sun, lit patches on the path, bands of sunlit clearing.
- Path views read as a dark frame around a light centre.

### Ground, trunks, path
| Element | Target |
|---|---|
| Sunlit grass | chartreuse h50–57, s0.6–0.8, v0.6–0.9 (#CBBE26, peaks #EAD648) |
| Shaded grass | h63–100, s0.3–0.65, v0.18–0.30 (#393B16 forest, #3C4338 meadow). Shadows shift hue 15–40° toward blue-green and stay saturated |
| Lit : shaded grass | about 5 : 1 in linear light |
| Trunk shadow side | umber-mauve h15–30, s0.2–0.45, v0.25–0.33, core v0.12; cool mauve reflected light #84746E |
| Backlit trunk rim | gold #E0B02B |
| Moss | lit #D0B233, shade olive #4B5020 |
| Path | lit #D89D42–#E2B477, mid #7C5834, shade purple-brown #4B3424 |

### Distance (aerial views, by row)
- Saturation falls 0.7 (near) → 0.4 (1–2 km) → 0.27 (ridges).
- Hue walks orange 33° → mauve-red 23–26° → violet 270–300° → blue-violet 225–240° on the farthest ridges. **Distance passes through mauve, never through grey.**
- 10th-percentile luma rises 0.27 → 0.40–0.49: darks lift first.
- Far ridges #7D89B8 (s0.3, v0.72); nearer ridges mauve #9D8EA3.
- Backlit haze inside the forest: warm mauve-grey #8A7766, turning gold #CEA34C toward the Sun.
- Crisp under 30 m. At 100–300 m detail finer than a stroke disappears. Ridges: soft edges 0.3–0.5 % of image height, internal contrast ≤ ±0.06 v.

### Saturation
Mean HSV s 0.53–0.66, 90th percentile 0.85–0.97. Target mean ≈ 0.55 excluding sky.
No mid-value non-sky patch below s 0.15.

### Stroke size (as % of image height)
- Stroke **width** 0.6–1.1 %, almost constant from foreground to far hills.
- Strokes are 2.5–4× longer than wide → **length 2–4 %** (the brief's rule).
- Sky strokes 1–1.4 % wide, up to 3 % long (the dome: broad and soft).
- Leaf dabs: 1.5–3 % on near trees, ~1 % on mid trees, 1.2–2 % in aerial views.
- Foreground grass flicks 3–5 % long, ~0.5 % wide.

### Backlit glow (the strongest effect)
- Brightest on the outer fringe and thin parts of crowns within ~25° of the Sun.
- Glowing leaves turn gold h40–46, s0.85–0.9, v0.85–0.89 (#DFA41A–#E4A419) against an orange body #A0671C.
- Only leaves directly over the Sun go cream (#E6D8C1).
- Canopy interiors dark but saturated (#633917, s0.77).
- A warm halo covers 20–30 % of the frame around the Sun.

## 2. Painter's light model (shader intent)
`k` = 0 in the raw-lighting view, 1 in painter's light and the full look.
- Wrap diffuse `w = 0.2k`; compress lit values into one light family (`mix(dif, smoothstep(-0.05,0.55,ndl), 0.5k)`).
- Terminator bleed: chroma ×(1 + 0.35k) in a narrow band around N·L≈0.05.
- Sunlight ×(1.06, 1.0, 0.88) warm in painter's views.
- Fill = sky/bounce hemisphere + 0.25 × sky from the anti-solar side (keeps form in shadow), tinted toward the world's shadow hue by `0.55k(1−lit)`, × AO.
- Shadows deepen in **hue and chroma**, not just value: chroma ×(1 + 0.2k(1−lit)). No shadow below Oklab chroma 0.025 unless the albedo is neutral.
- Lit : shadow on flat grass 4–6 : 1. Faces turned from the Sun keep ≥ 15 % of lit luma.
- Aerial perspective: `surf·T + In`, `In` pushed toward the distance hue by `0.5·smoothstep(300,3000,d)`, chroma held at `max(C, 0.85·mix(Csurf, Cin, 1−T))` so mid-distance goes mauve, not grey. Distance ×1.5.
- Height fog scale height 80–120 m: lavender mist in valleys; looking into backlit forest, trees at 100 m carry 35–45 % haze, each plane of trunks ~0.08 v lighter and cooler.

### Tone and grade
- Tone curve: Lottes 2016 on the brightest channel, `T(x)=x^a/(x^(a·d)·b+c)`, a=1.3, d=0.96, b and c solved so T(0.18)=0.21 and T(10)=1; channel ratios via `pow(mix(pow(r,s/16),1,pow(peak,6)),16)`, s=1.1. Keeps mid-tones saturated, desaturates only the top. (Not AgX: greys the mids. Not plain ACES: skews skies cyan.)
- After the curve: optional gold bend of warm highlights; Oklab mid-tone vibrance `C *= 1+0.2·4L(1−L)`; split toning (shadow hue 0.03(1−L)², warm 0.02L²); warm black floor ≈ 0.11 display.
- Auto-exposure: log-average with each texel clamped at 4× mid-grey (so the sky cannot darken backlit views), mapped to 0.13 → median ≈ 0.40 display; τ ≈ 1.5–2.5 s.
- Bloom: soft, warm-tinted (1, 0.9, 0.75), coarse mips weighted most, mix ≈ 0.08. Light shafts add ≤ +0.08 display, gold.
- The raw view uses the same tone curve with no grade so the three views compare fairly.

## 3. Brushwork rules
- One procedural RGBA stroke texture (R height, GB normal, A stroke ID), three layers (underlayer, body, accents), full coverage, bent spines, tapered ends, bristle lanes, dry-brush tails. Mips built so the ID channel is never averaged.
- World-space mapping, hex-tiled (3 samples per octave, per-hex rotation from a flow field, scale and offset jitter); two octaves cross-faded by **straight-line distance** (never view depth) → ≤ 6 samples per pixel. Octave tile sizes are powers of two (0.5 m · 2^k) so they tile the 4096 m wrap period exactly.
- Strokes follow form: along contours on slopes, across the path in its interior and along it at its edges, along the flow in and beside the stream, slow curl noise on flat meadows, random per hex in leaf litter.
- Broken colour per stroke: hue ±6° (grass/leaves), ±10° (path/litter), ±4° (rock); chroma ±15 %; lightness ±4 %; plus 40 m colour zones (±6 % L, ±5° hue). ~5 % of strokes are flecks of shadow hue (in shade) or sky hue (in light); ~2 % borrow a neighbouring material (fallen leaves in grass).
- Shadow edges: `smoothstep(.25,.75, pcf + (h−.5)·0.6)`; the near-cascade penumbra must be at least half a stroke long.
- Shading normal = geometric + 0.35 × stroke normal (diffuse varies ≤ ±12 %). Sheen ≤ +0.05, strongest at grazing backlight, faded with distance.
- **Stability:** per-octave UV origins and integer hex origins come from 64-bit JS; sampling uses `textureGrad` with world-UV derivatives (no derivative jumps at hex borders); textures stay minified-or-1:1; nothing time-varying or screen-space in stroke placement; shadow cascades snap to texels.

## 4. Trees
- Hero tree: 16–20 m, fork at 25–30 %, base 0.7–0.9 m flaring 1.6× over 0.8 m, 3–6 limbs at 35–60 % height, 30–55° from vertical, each splitting 2–3 times (Leonardo's rule). Limbs show through canopy gaps as dark winding shapes (#3A2A1E).
- Bark strokes 0.4–0.8 × 0.06–0.12 m, ±5° from vertical. Lit ochre #B07A45, shade mauve #6D5A66, core #4A3A45. Moss to 1.2 m and in crotches. Gold rim when backlit.
- Leaf dabs are painted clusters 0.25–0.45 m (never 10 cm leaves: those sparkle). Near quads 1.2–1.6 m with 5–9 dabs, 50–60 % coverage. Coverage-preserving mips.
- Canopy: 5–9 cluster spheres (R 1.5–3 m) at limb tips plus 1–2 crown spheres; quads in the outer shell (r ∈ [0.55R, R]); normals from the sphere (+ a little view-facing); AO 0.35→1 with depth; interiors deepen in colour, not grey.
- Backlit glow: `Es · glowCol · P(μ) · exp(−0.75·chord) · shadow · edge`, P = 0.5·HG(0.7) + 0.5·HG(0.25) normalised so P(1)=1, P(0.95)=0.68, P(0.5)=0.31. Peak glow ≈ 1.6× sunlit grass, landing at v≈0.88, s≥0.8.
- Palettes (lit / mid / interior / glow):
  - maple orange #E8962A / #C0601C / #6A2E12 / #F0B02A
  - beech gold #F0CC40 / #D09A22 / #6E4A14 / #F6DC50
  - red maple #E0582A / #B0301E / #561812 / #F07A2C
  - russet oak #C68A40 / #985626 / #4A2814 / #E0A048
  - aspen orange-gold #F2A830 / #D07A1E / #6E3A10 / #F8C840
  - turning green #C8C43C / #7E8E30 / #34461C / #E0D840
  - spruce #5A7040 / #2E4A32 / #18261C (glow ×0.1); pine #7A8040 / #3E5434 / #1C2A20 (glow ×0.15)
- Every tree mixes 10–15 % dabs from a neighbouring variant; per dab hue ±8°, value ±12 %.
- Mid LOD: 0.9–1.4 m dabs, 15–25 % holes, same shading; coverage matched to near LOD within 5 %; fades erode dabs from the edges (alpha threshold), never screen dither.

## 5. Sky, clouds, Moon, ridges
- Sky targets: zenith #7B8EC7, horizon #B7C6D9, next to the Sun #E6D8C1. Strokes anchored to view direction, 4–8 % of height, horizontal near the horizon, ±4 % value, ±10 % chroma.
- Clouds: flat layer, cumulus of 3–8 circles with flat bottoms, 25–35 % cover, edges broken by strokes; lit tops #F0D8B9, violet-grey bases #8F97B6; silver lining near the Sun; fade into the horizon.
- Moon: true position and phase, ≤ 1.25× true size, lit part = sky + 0.15 v tinted half toward the sky; no visible dark side.
- Ridges: warp 0 px under 150 m rising to 2–3 px beyond 2 km; ridge-to-sky contrast 0.05–0.1 luma; misty lighter bases, slightly darker crests.

## 6. Critic checklist: why renders look CG (check every screenshot)
1. Grey mid-distance or washed-out areas → chroma-preserving haze, max-channel curve, vibrance.
2. Shadows that only get darker → violet fill + chroma boost (shaded grass h75–100, s ≥ 0.3).
3. Backlit glow too weak or blown to white.
4. Strokes look like a decal → flow-field rotation, colour zones, hex jitter.
5. Stroke scale drifts with distance → width 0.7–1.1 % of height at every depth.
6. Canopies look like sprite blobs → shell distribution, 25–40 % sky holes, lobed outlines, visible limbs.
7. Hard or dithered shadow edges → stroke-height offset and a wide penumbra.
8. Distance too crisp → 1.5× haze, ridge contrast ≤ ±0.06, warp.
9. Even "game" lighting or plastic highlights → light-family compression, terminator bleed, sheen ≤ +0.05.
10. Pure white / pure black / shimmer → highlights ≤ 0.95 warm cream, blacks ≥ 0.11, stability rules.

## 7. Forbidden
Outlines, posterization, cel shading, halftone, chromatic aberration; and (scope) SSAO,
SSR, GI, motion blur, depth of field, TAA, volumetric clouds.
