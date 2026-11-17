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
    mieScattering: [1.4e-5, 1.4e-5, 1.4e-5], mieAbsorption: [1.6e-6, 1.6e-6, 1.6e-6], mieScaleHeight: 1400, mieG: 0.78,
    ozoneAbsorption: [0.65e-6, 1.881e-6, 0.085e-6], ozoneCenter: 25000, ozoneWidth: 15000,
    solarIrradiance: [1.0, 0.98, 0.94], sunIntensity: 22.0,
    groundAlbedo: [0.12, 0.13, 0.07],
  },

  // --- Painter's light ---
  painter: {
    shadowHue: '#5b5fae', // violet-blue fill in shadows
    shadowFill: 0.55, // how strongly shadows take the hue (0..1)
    distanceHue: '#8c98cc', // cool hue that distance shifts toward
    glowHue: '#ffc27a', // warm haze toward the Sun
    sunWarmth: '#fff0d6', // multiplies direct sunlight
    aerialScale: 1.5, // aerial perspective exaggeration
    strokeStrength: 1.0,
  },

  fog: {
    density: 0.00011, // per metre at the base altitude
    heightFalloff: 0.0035, // per metre
    baseAltitude: 0,
    glow: 1.0, // warm forward lobe toward the Sun
    heightFog: 0.55, // ground-hugging haze in hollows
    mieG: 0.72,
  },

  // --- Post / grade ---
  post: {
    // Auto-exposure maps the clamped log-average to this key (median ~0.40 display).
    exposureKey: 0.13, exposureMin: -8, exposureMax: 8, exposureTau: 2.0, exposureBias: 0.0, exposureFallback: -1.5,
    // Lottes 2016 curve on the max channel: T(mid) = midOut, T(white) = 1.
    curveA: 1.3, curveD: 0.96, curveMid: 0.18, curveMidOut: 0.21, curveWhite: 10,
    bloomStrength: 0.08, bloomTint: [1.0, 0.9, 0.75], shaftStrength: 0.5, shaftColor: [1.0, 0.8, 0.5],
    sharpen: 0.35, warpPx: 2.5,
    saturation: 1.2, blackLift: 0.012, liftColor: [1.0, 0.92, 0.82], vignette: 0.26, canvas: 0.045,
    shadowCool: 0.2, highlightWarm: 0.08, warmTint: [1.06, 1.0, 0.9], contrast: 1.03,
  },

  // --- Terrain recipe ---
  terrain: {
    recipe: 'layered',
    patchSize: 600, // walkable patch (m), centred on the origin
    walkMargin: 10,
    seed: 7,
    // Layers are evaluated in order and summed (generic recipe primitives).
    layers: [
      { type: 'fbm', amplitude: 9, wavelength: 260, octaves: 4, gain: 0.5 },
      { type: 'fbm', amplitude: 2.2, wavelength: 55, octaves: 3, gain: 0.5 },
      { type: 'bump', x: -210, z: -205, radius: 120, height: 26 },
      { type: 'bump', x: 230, z: 160, radius: 140, height: 12 },
      { type: 'far-hills', amplitude: 70, wavelength: 1900, octaves: 5, start: 500, full: 2200 },
      { type: 'ridges', amplitude: 520, wavelength: 5200, octaves: 5, start: 3500, full: 9000, sharpness: 0.65 },
    ],
    // Carvings: paths and streams are splines in world metres.
    path: { width: 2.2, depth: 0.25, points: [[300, -250], [215, -190], [140, -150], [90, -80], [40, -38], [0, 0], [-45, 52], [-110, 96], [-170, 150], [-235, 205], [-300, 250]] },
    stream: { width: 3.0, depth: 1.1, bankWidth: 5, points: [[120, -320], [150, -230], [118, -150], [160, -60], [140, 20], [175, 110], [140, 200], [165, 320]] },
    clearings: [
      { x: -40, z: 35, radius: 42 },
      { x: 112, z: -112, radius: 30 },
      { x: -200, z: -200, radius: 55 },
      { x: 230, z: 165, radius: 38 },
    ],
    flatten: [{ x: -30, z: 42, radius: 9, strength: 0.85 }], // lander pad
  },

  ground: {
    sunGrass: '#9fae3c', // sunlit grass: yellow-green
    shadeGrass: '#2f5a3a', // cool deep green
    dryGrass: '#b59a48',
    litter: '#8e3f1c', // rust leaf litter
    litterDark: '#5a3018', // umber
    path: '#b98a4e', // warm ochre
    pathFleck: '#d0702a',
    moss: '#5f7a2c',
    rock: '#8b877e',
    farForest: ['#c0561c', '#d98a1e', '#e2b13a', '#a33a1a', '#6f7b2e', '#2f4a2c'],
    farFields: '#9aa346',
    ridge: '#6f6e9a',
  },

  sky: {
    strokes: 0.06, // broad soft stroke modulation of the dome
    clouds: { coverage: 0.42, altitudeDeg: [3, 28], scale: 1.0, lit: '#fff1dc', base: '#8a84a6', drift: 0.0015 },
  },

  // --- Camera bookmarks (yaw = azimuth in degrees clockwise from north) ---
  bookmarks: [
    { name: 'path', pos: [44, null, -40], yaw: 228, pitch: 3, mode: 'walk' },
    { name: 'clearing', pos: [-78, null, 18], yaw: 105, pitch: 2, mode: 'walk' },
    { name: 'backlit', pos: [-12, null, 70], yaw: 236, pitch: 9, mode: 'walk' },
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
