# Reference notes — what the owner's paintings show

The owner supplied 20 reference paintings (study only; they are **not** in the repo). These notes
let a later session judge the look without them. Numbers are display sRGB, measured with numpy on
the full images (luma = Rec.709, HSV saturation `s`, hue in degrees, sizes as % of image height H).
Measured per-element targets also live in `docs/ART_DIRECTION.md` (section 1); this file adds the
painter's handling, the variety across the set, and notes useful for later milestones (summer, mist,
mountains, aerial country). Once the owner approves looks, `docs/shots/approved/` outranks these
notes for handling and colour.

## 1. The set at a glance
All are landscape-format realist oil paintings in one hand: thick, visible, directional strokes;
rich saturated mid-tones; warm sunlight against cool, coloured shadow; soft, hazy distance.

| Group | Count | What it shows |
|---|---|---|
| Autumn forest paths, backlit | 7 | Eye-level, a winding dirt path leading into hazy backlit woods; one or two big trunks framing the left or right edge; orange/gold canopies glowing against a pale haze; sunlit grass in patches; leaf litter on the path. |
| Autumn clearings and hillsides | 4 | Eye-level or slightly raised view across a sunny meadow or slope to trees and, in two, distant blue-violet hills under a cumulus sky; mossy boulders in the foreground. |
| Stream through autumn woods | 1 | A stream with rounded stones on its banks winding through orange woods; water reflects pale sky. |
| Aerial autumn country | 5 | High view over continuous autumn forest with meadow clearings, winding paths and a stream, out to layered violet-blue ridges and (in two) mist lying in valleys. |
| Summer / late-summer green woods | 3 (+1 mixed) | Same handling in greens: one bright spring-green path scene; two misty, shadowy green woods with a rust path and soft light through haze; one mixed green/orange. Useful for milestone 2 (misty sunrise) and milestone 4 (summer forest). |

## 2. Value structure (how light and dark are arranged)
- Whole-frame luma, median of the set: darkest 1 % ≈ **0.14** (range 0.12–0.23), 10th pct ≈ 0.22,
  median ≈ **0.38** (0.30–0.43), 90th pct ≈ 0.60, brightest 1 % ≈ **0.77** (0.68–0.86).
  Nothing is pure white or pure black. The brightest things (cloud tops, sky beside the Sun, the
  sunlit haze at a path's vanishing point) are warm cream, around #F0D8B9.
- **Darks are warm.** The mean of the darkest 10 % is warm umber-olive in every autumn painting:
  #2D281B, #302D1D, #362C1D, #392E1D, #3C301F (hue ≈ 35–45°, s ≈ 0.4). Green woods: #252721–#2B2D28.
  Darks sit on trunk shadow sides, the base of trunks, and shaded grass in the bottom corners.
- **Lights are gold.** The mean of the brightest 10 %: #C5A357, #C9A454, #CDA95F, #CFB55B, #D19829,
  #D6A131 (hue 40–45°, s 0.5–0.75). Lights sit in the backlit haze, canopy fringes around the Sun,
  sun patches on the path and bands of sunlit grass.
- **Frame structure, eye-level views:** sky/canopy top band median luma ≈ 0.45–0.54; middle ≈ 0.37–0.45
  (canopy body and haze); the bottom quarter is the darkest band (≈ 0.26–0.32). Paths read as a
  dark frame (foreground trunks and shaded grass) around a light centre (haze at the vanishing point).
- **Aerial views are higher-key** with lifted darks: darkest 1 % ≈ 0.20–0.23, median ≈ 0.40, and
  luma rising gently toward the horizon (bands 0.36 → 0.47 from bottom to top).

## 3. Palette and warm/cool balance
- **Sunlight is warm but not orange:** it lifts gold and yellow-green; it never tints everything orange.
- **Shadows are coloured, never grey.** On grass, shadow turns cooler and deeper in hue (toward
  blue-green/olive, #393B16, #3C4338) while staying saturated (s ≥ 0.3). On trunks, the shadow side
  is umber-mauve with cool mauve reflected light (#84746E); the core is a warm dark (#4A3A45 to #34271A).
  Violet appears as a *fill tint* in shade and as the colour of distance — not as a wash over everything.
- **Saturation is high overall:** mean s ≈ 0.55–0.66 for autumn scenes (≈ 0.25–0.34 for the misty
  green ones), 90th percentile 0.85–0.97. Mid-tones carry the most chroma; only the highest lights
  desaturate toward cream.
- **Hue families by band (median hue of saturated pixels):** autumn canopy/top band 29–38°
  (orange-gold); sunny grass in the lower bands 47–63° (yellow-green); summer scenes 62–78°.
- **Autumn canopy palette:** lit gold #EDA416–#F4A815, orange body #D4881C/#C0601C/#A35E1D, red
  accents #E0582A/#B0301E used sparingly, deep interior umber #4A2E19–#68401B. Scattered dark green
  conifers (#2E4A32) give the cool notes in aerial views.
- **Grass:** sunlit chartreuse #CBBE26 (peaks #EAD648), shaded olive/blue-green #393B16–#4B5020,
  with a darker green underlayer showing between strokes and small white and yellow flower dabs.
- **Paths:** warm ochre in sun (#D89D42–#E2B477), mauve-brown earth in shade (#4B3424, #7C5834),
  scattered orange leaves gathering in sun pools.

## 4. Strokes — size, shape and direction
- Stroke **width** is about **0.6–1.1 % of image height**, nearly constant from foreground to far hills
  (autocorrelation measure across the set ≈ 1.25–1.8 % for the full stroke footprint). Strokes are
  **2.5–4× longer than wide** (length ≈ 2–4 % of H).
- Each stroke is close to one flat colour; variation lives *between* strokes (hue ±8–15°, value
  ±10–15 %). Bristle texture is subtle and only inside the stroke.
- **Grass:** short upward flicks and horizontal dabs; long flicks 3–5 % of H in the immediate
  foreground; darker underlayer visible between them; white/yellow flower dabs about 0.4 % of H.
- **Leaves:** separate flat dabs 1.5–3 % of H near, ≈ 1 % mid, 1.2–2 % in aerial views; each dab a
  little different in hue and value, with sky holes between them; edges crisp on lit fringes.
- **Paths:** strokes laid across the path (they read as flattened leaf shapes in perspective), with
  lit orange leaf dabs scattered over a darker earth; grass strokes overlap the edges raggedly.
- **Trunks:** long vertical strokes following the bark, ochre in light, mauve in shade; moss on one
  flank laid as thick yellow-olive strokes; a broken gold rim where backlit.
- **Rocks:** broad flat knife-like strokes following each plane, lavender-grey with gold flecks on lit
  tops, moss caps in chartreuse; grass strokes overlapping the base.
- **Sky:** broad soft strokes, horizontal near the horizon and diagonal higher up; cumulus with
  thick lit tops (warm cream) and violet-grey bases.
- **Distance:** fewer, broader, horizontal strokes; far ridges laid as horizontal dabs ≈ 1 % wide and
  2–3 % long; zone edges dissolve.

## 5. Edges and softness
- Near edges are crisp (foreground trunks, leaf fringes against sky, grass blades).
- From about 100 m, detail smaller than one stroke disappears; edges soften by distance and
  aerial haze, never by blur.
- Far ridges have soft edges about 0.3–0.5 % of H and little internal contrast (±0.06 in value);
  ridge-to-sky contrast is small (0.05–0.1 luma) and ridges are a step *darker* than the sky.
- Backlit haze softens everything at the vanishing point of path scenes; trunks there are pale mauve
  silhouettes, a step lighter and cooler per plane (≈ +0.08 value per plane).

## 6. Distance (aerial perspective)
- Exaggerated and coloured: saturation drops from ≈ 0.7 near to ≈ 0.4 at 1–2 km to ≈ 0.27 on the
  ridges; hue walks orange (≈ 33°) → mauve-red (23–26°) → violet → blue-violet (225–240°).
- Distance passes through **mauve, never grey**. Darks lift first (10th-percentile luma rises
  0.27 → 0.40–0.49 into the distance).
- Far ridges ≈ #7D89B8 (s 0.3, v 0.72); nearer ridges mauve #9D8EA3; mist lies lavender in valleys
  in the aerial views. Toward the Sun the haze turns gold (#CEA34C); away from it, mauve-grey (#8A7766).

## 7. Backlight — the strongest effect in the set
- When the painter looks toward the Sun, crowns glow: thin fringes and outer dabs within ≈ 25° of the
  Sun turn gold (#DFA41A–#E4A419, s 0.85–0.9, v ≈ 0.88); only leaves directly over the Sun go
  cream (#E6D8C1). The crown body stays orange (#A0671C) and interiors stay deep and saturated
  (#633917), never grey or crimson.
- A warm halo fills 20–30 % of the frame around the Sun; trunks and limbs in front of it stay dark
  umber silhouettes with a thin gold rim.

## 8. For later milestones (variety already present in the set)
- **Summer / misty woods:** desaturated (mean s ≈ 0.25–0.34), cooler greens (hue 60–75°), deep
  green-grey darks (#252721–#2B2D28), pale luminous mist (#C2BA83–#BFBBA1 lights) filling the middle
  distance; trunks become flat dark-green silhouettes receding plane by plane; a rust-red path is the
  warm accent. A good model for "misty sunrise".
- **Bright summer path:** saturated spring green (hue ≈ 70–78°) with yellow sunlit flicks, white
  flowers and an ochre path — same stroke size and handling as autumn.
- **Mountains and ridges:** layered planes, each lighter and bluer; ridge crests softly modelled,
  sunlit faces warm mauve, shaded faces blue-violet.
- **Water:** reflects pale sky in short horizontal strokes, with rounded grey-violet stones and white
  highlights where it breaks.

## 9. Quick checklist for judging a screenshot
1. Darkest 1 % ≈ 0.11–0.16 and warm; brightest ≈ 0.75–0.85 and cream-gold; nothing white or black.
2. Shadows coloured and saturated (grass shade blue-green/olive; trunk shade umber-mauve).
3. Mid-tones rich (mean s ≈ 0.55); no grey patches in the middle distance.
4. Strokes 0.6–1.1 % of H wide, 2–4 % long, one flat colour each, same size near and far.
5. Distance walks through mauve to blue-violet; ridges darker than the sky; soft far edges.
6. Backlit crowns: orange body, gold fringe near the Sun, deep warm interiors, dark trunks with a rim.
7. Composition reads painterly: dark frame, light centre in path views; clumped groves and bright
   chartreuse clearings in aerial views.
