// World definition: Earth, an autumn forest in late afternoon.
// DATA ONLY: numbers, hues and recipe names. The engine has no Earth-specific code.
// Units: metres, degrees, linear-light multipliers; hues are sRGB hex strings.

export default {
  name: 'earth-forest',
  label: 'Earth · autumn forest',

  // --- Ephemeris (generic Kepler + IAU rotation; see src/sky/astronomy.js) ---
  astronomy: {
    latitude: 44.5, longitude: -72.6, radiusKm: 6371,
    // Earth-Moon barycentre, JPL approximate elements (J2000 ecliptic, per Julian century).
    orbit: { a: 1.00000261, e: 0.01671123, i: -0.00001531, L0: 100.46457166, Ldot: 35999.37244981, wbar0: 102.93768193, wbarDot: 0.32327364, node0: 0, nodeDot: 0 },
    // IAU: pole RA/Dec (deg, per century) and prime meridian W0 + Wdot * days.
    pole: { ra0: 0, raDot: 0, dec0: 90, decDot: 0, W0: 190.147, Wdot: 360.9856235 },
    moons: [
      // Mean lunar elements (ecliptic, per day since J2000.0).
      { name: 'Moon', aKm: 384400, e: 0.0549, i: 5.1454, node0: 125.04337, nodeDot: -0.0529538083, argPeri0: 318.30994, argPeriDot: 0.1643573223, M0: 134.96289, Mdot: 13.0649929509, radiusKm: 1737.4, albedo: 0.12, hue: '#e9e4da' },
    ],
    sunAngularRadiusDeg: 0.267,
  },

  // Time-of-day presets (UTC). The first is the default: Sun ~20° up, a 34% Moon in the SSE.
  timeOfDay: [
    { label: 'late pm', utc: '2026-10-16T19:58:00Z' },
    { label: 'golden', utc: '2026-10-16T20:48:00Z' },
    { label: 'mid pm', utc: '2026-10-16T18:40:00Z' },
    { label: 'morning', utc: '2026-10-16T13:30:00Z' },
  ],

  // --- Atmosphere (single-scattering Rayleigh + Mie + ozone) ---
  atmosphere: {
    planetRadius: 6360000, atmosphereHeight: 100000,
    rayleighScattering: [5.802e-6, 13.558e-6, 33.1e-6], rayleighScaleHeight: 8000,
    mieScattering: [7e-6, 7e-6, 7e-6], mieAbsorption: [0.8e-6, 0.8e-6, 0.8e-6], mieScaleHeight: 1200, mieG: 0.78,
    ozoneAbsorption: [0.65e-6, 1.881e-6, 0.085e-6], ozoneCenter: 25000, ozoneWidth: 15000,
    solarIrradiance: [1.0, 0.98, 0.94], sunIntensity: 22.0,
    groundAlbedo: [0.12, 0.13, 0.07],
    multiScatter: 0.05,
  },

  // --- Painter's light ---
  painter: {
    distanceMix: 0.75, // how far inscatter is pushed toward the distance hue (0..1)
    chromaKeep: 0.85, // haze keeps this much chroma (passes through mauve, not grey)
    shadowHue: '#5b5fae', // violet-blue fill in shadows
    shadowFill: 0.2, // how strongly shadows take the hue (0..1)
    distanceHue: '#7e82b6', // cool blue-violet that distance shifts toward
    glowHue: '#ffc27a', // warm haze toward the Sun
    sunWarmth: '#fff6e8', // multiplies direct sunlight (slightly warm)
    sunChroma: 0.62, // painters keep sunlight only slightly warm: 1 = physical colour
    aerialScale: 1.5, // aerial perspective exaggeration
    strokeStrength: 1.0,
  },

  fog: {
    aerialExtinction: 1e-4, // per metre at the datum (hazy autumn afternoon)
    aerialScaleHeight: 900,
    glow: 1.0, glowG: 0.8, // warm forward lobe of the aerial haze toward the Sun
    hazeMaxDepth: 0.6, // cap on ground-haze optical depth (distant ridges stay aerial blue)
    hazeDensity: 1.2e-3, // ground haze per metre at ground level (forest interiors, valleys)
    hazeHeight: 30, // metres above the ground
    hazeColor: '#8c7b78', // warm mauve-grey; turns gold toward the Sun
    hazeGlow: 1.0, hazeG: 0.6,
  },

  // --- Post / grade ---
  post: {
    // Auto-exposure maps the clamped log-average to this key (median ~0.40 display).
    exposureKey: 0.17, exposureMin: -8, exposureMax: 8, exposureTau: 2.0, exposureBias: 0.0, exposureFallback: -1.5,
    // Lottes 2016 curve on the max channel: T(mid) = midOut, T(white) = 1.
    curveA: 1.38, curveD: 0.96, curveMid: 0.18, curveMidOut: 0.21, curveWhite: 10,
    bloomStrength: 0.09, bloomKnee: 0.7, bloomTint: [1.0, 0.9, 0.75], shaftStrength: 0.5, shaftColor: [1.0, 0.8, 0.5],
    sharpen: 0.35, warpPx: 2.5,
    saturation: 1.1, blackLift: 0.012, liftColor: [1.0, 0.92, 0.82], vignette: 0.26, canvas: 0.045,
    shadowCool: 0.1, highlightWarm: 0.08, warmTint: [1.06, 1.0, 0.9], contrast: 1.1,
  },

  // --- Terrain recipe ---
  terrain: {
    recipe: 'layered',
    patchSize: 600, // walkable patch (m), centred on the origin
    seed: 7,
    lodRange: 48, // finest CDLOD range (m); each level doubles
    // Layers are evaluated in order and summed (generic recipe primitives).
    layers: [
      { type: 'fbm', amplitude: 13, wavelength: 260, octaves: 4, gain: 0.5 },
      { type: 'fbm', amplitude: 2.0, wavelength: 55, octaves: 3, gain: 0.5 },
      { type: 'bump', x: -210, z: -205, radius: 120, height: 26 },
      { type: 'bump', x: 240, z: 170, radius: 140, height: 10 },
      { type: 'far-hills', amplitude: 90, wavelength: 1400, octaves: 5, start: 420, full: 2000 },
      { type: 'range', distance: 2300, width: 700, amplitude: 200, wavelength: 1300, octaves: 4 },
      { type: 'range', distance: 4600, width: 1300, amplitude: 420, wavelength: 2400, octaves: 4 },
      { type: 'range', distance: 8500, width: 2200, amplitude: 850, wavelength: 4200, octaves: 4 },
      { type: 'ridges', amplitude: 200, wavelength: 4200, octaves: 3, start: 6000, full: 11000, sharpness: 0.15 },
    ],
    // Carvings are splines in world metres (near grid only).
    carve: [
      { name: 'path', kind: 'path', width: 2.2, depth: 0.22, bankWidth: 3, points: [[60, -320], [68, -235], [86, -160], [72, -95], [40, -38], [0, 0], [-45, 52], [-110, 96], [-170, 150], [-235, 205], [-320, 262]] },
      { name: 'stream', kind: 'stream', width: 3.0, depth: 1.1, bankWidth: 5, points: [[120, -330], [150, -230], [120, -150], [160, -60], [140, 20], [175, 110], [140, 200], [165, 330]] },
    ],
    clearings: [
      { x: -40, z: 35, radius: 42 },
      { x: 108, z: -112, radius: 26 },
      { x: -205, z: -205, radius: 58 },
      { x: 235, z: 168, radius: 38 },
    ],
    flatten: [{ x: -55, z: 22, radius: 9, strength: 0.85 }], // lander pad
    forest: { base: 0.7, noiseScale: 150, noiseAmp: 0.8 },
  },

  ground: {
    sunGrass: '#a6b648', // sunlit grass: yellow-green (chartreuse once lit)
    grassAccent: '#e6d24a', // bright gold accent strokes
    shadeGrass: '#4a6a34', // cool deep green
    dryGrass: '#b59a48',
    litter: '#8c5a3a', // rust leaf litter
    litterDark: '#5e4636', // umber
    path: '#b98a4e', // warm ochre
    pathFleck: '#d4924e',
    pathDark: '#70604a', // greyed umber earth under the fallen leaves
    canopyAvg: '#c07e34', // averaged far canopy colour
    moss: '#8a9a36',
    rock: '#b4aca4', // lavender-grey stone
    rockDark: '#857668',
    lichen: '#a89c6c',
    // Far canopy crowns (lit colours): maple orange, beech gold, red maple, russet oak, aspen, turning green, spruce.
    farForest: ['#e0983a', '#e8c450', '#d0663a', '#c08a4a', '#eaaa40', '#b8b848', '#3a543a'],
    farForestWeights: [0.24, 0.2, 0.07, 0.14, 0.17, 0.08, 0.10],
    canopyGap: '#5a4226', // umber-olive between crowns
    farFields: '#9aa346',
    ridge: '#7a6a80',
    wet: '#3b3427',
  },

  // --- Brushwork ---
  brush: {
    textureSize: 512, seed: 1234,
    tileFactor: 0.25, // stroke tile ~= 0.25 x distance -> stroke length ~3-4 % of screen height
    sharpness: 5, // how decisively overlapping strokes win over each other
    octaveFade: 0.6, // fraction of each octave spent cross-fading to the next (sizes interleave)
  },

  rocks: {
    count: 120, seed: 4242, size: [0.35, 2.4],
    // Composition: [x, z, size, yaw] — mossy boulders by the path and in the clearing.
    place: [[31.0, -33.6, 0.9, 1.9], [49, -30, 1.6, 2.6], [-63, 8, 1.6, 0.9], [-70, 28, 0.9, 2.2], [-18.1, 71.7, 1.1, 1.1], [39.6, -29.97, 1.2, 0.7]],
  },

  // --- Vegetation (recipes for the procedural tree generator; palettes are display sRGB) ---
  vegetation: {
    atlasSize: 512, atlasSeed: 777,
    heroVariant: 0,
    // Stage 4: the hero tree at the bookmarks [x, z, yaw, scale].
    hero: [[42.05, -33.94, 0.6, 1.0], [-22.0, 76.7, 2.1, 1.05], [-36.3, 16.8, 4.0, 0.95]],
    variants: [
      {
        name: 'maple-orange', form: 'deciduous', seed: 11, neighbour: 4,
        height: [16, 19], baseRadius: [0.42, 0.5], forkAt: [0.32, 0.4], leanDeg: 5, limbWobble: 0.5,
        limbs: [4, 5], limbStart: 0.45, limbTilt: [40, 62], limbLength: [0.36, 0.48], clusterR: [2.1, 3.0], crown: 3,
        nearCards: 250, cardSize: [0.95, 1.3], cells: [0, 1, 2, 3, 4, 5, 6, 7],
        midCards: 70, midCardSize: [2.4, 3.2], midCells: [8, 9, 10, 11, 12, 13, 14, 15],
        palette: { lit: '#e09a2a', mid: '#b8661e', interior: '#5a3c1c', glow: '#e4a419' },
        bark: { base: '#9c8266', dark: '#705a54', moss: '#c0a830', mossShade: '#4b5020' }, glow: 2.2,
      },
      { name: 'beech-gold', form: 'deciduous', seed: 23, palette: { lit: '#f0cc40', mid: '#d09a22', interior: '#6e4a14', glow: '#f6dc50' } },
      { name: 'red-maple', form: 'deciduous', seed: 37, palette: { lit: '#e0582a', mid: '#b0301e', interior: '#561812', glow: '#f07a2c' } },
      { name: 'russet-oak', form: 'deciduous', seed: 41, palette: { lit: '#c68a40', mid: '#985626', interior: '#4a2814', glow: '#e0a048' } },
      { name: 'aspen', form: 'deciduous', seed: 53, palette: { lit: '#f2a830', mid: '#d07a1e', interior: '#6e3a10', glow: '#f8c840' } },
      { name: 'turning-green', form: 'deciduous', seed: 67, palette: { lit: '#c8c43c', mid: '#7e8e30', interior: '#34461c', glow: '#e0d840' } },
      { name: 'spruce', form: 'conifer', seed: 71, palette: { lit: '#5a7040', mid: '#2e4a32', interior: '#18261c', glow: '#5a7040' }, glow: 0.1 },
      { name: 'pine', form: 'conifer', seed: 83, palette: { lit: '#7a8040', mid: '#3e5434', interior: '#1c2a20', glow: '#7a8040' }, glow: 0.15 },
    ],
  },

  sky: {
    strokes: 0.16, // broad soft stroke modulation of the dome
    compress: 0.42, // painterly compression of the sky's luminance range
    lift: 2.1, // painters make the sky the lightest large mass
    refScale: 1.15, // overall brightness of the painted dome
    hueBlend: 0.82, // how far sky hues and values are pulled toward the painted palette below
    haloSkirt: '#e4c8b8', // peach between the cream core and the blue
    zenithHue: '#8494c6', horizonHue: '#b9c7da', nearSunHue: '#ecdcc0', horizonCream: '#ddd8d0',
    haloCos: 0.88, // warm halo fades out ~28 degrees from the Sun (steep falloff)
    discDisplay: 3.2, // pre-curve value of the painted Sun disc (cream, never pure white)
    clouds: { coverage: 0.42, altitudeDeg: [3, 28], scale: 1.0, lit: '#fff1dc', base: '#8a84a6', drift: 0.0015 },
  },

  // --- Camera bookmarks (yaw = azimuth in degrees clockwise from north) ---
  bookmarks: [
    { name: 'path', pos: [44, null, -40], yaw: 228, pitch: 3, mode: 'walk' },
    { name: 'clearing', pos: [-78, null, 18], yaw: 105, pitch: 2, mode: 'walk' },
    { name: 'backlit', pos: [-12, null, 70], yaw: 236, pitch: 14, mode: 'walk' },
    { name: 'hill', pos: [-212, null, -208], height: 3.5, yaw: 300, pitch: -2, mode: 'fly' },
    { name: 'aerial', pos: [60, null, 300], height: 200, yaw: 345, pitch: -40, mode: 'fly' },
  ],

  benchmark: {
    route: [
      { b: 'path', hold: 14, pan: 30 },
      { b: 'backlit', travel: 16, hold: 14, pan: 40 },
      { b: 'clearing', travel: 16, hold: 14, pan: 50 },
      { b: 'hill', travel: 24, hold: 16, pan: 60 },
      { b: 'aerial', travel: 26, hold: 14, pan: 40 },
      { b: 'path', travel: 26, hold: 0 },
    ],
  },
};
