// URL parameters and engine-wide constants. Parsed once at startup.

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) && q.get(k) !== '' && !Number.isNaN(Number(q.get(k))) ? Number(q.get(k)) : d);
const bool = (k, d) => (q.has(k) ? q.get(k) !== '0' && q.get(k) !== 'false' : d);

export const config = {
  world: q.get('world') || 'earth-forest',
  bookmark: q.get('bookmark') || q.get('b') || null,
  view: num('view', 2), // 0 raw lighting, 1 painter's light, 2 full painted
  time: num('time', 0), // index into world.timeOfDay presets
  shot: bool('shot', false), // deterministic screenshot mode (no tap screen, no governor)
  bench: q.get('bench') || null, // '3' or '10' (minutes) starts the benchmark immediately after tap
  hud: bool('hud', false),
  res: num('res', 0), // fixed internal long side (disables resolution stepping)
  msaa: num('msaa', 4),
  fps: num('fps', 60), // 60 or 30 (battery)
  overdraw: bool('overdraw', false),
  quality: q.get('quality') || 'auto', // auto | max | min
  debug: q.get('debug') || '',
};

export const ENGINE = {
  minLongSide: 1280,
  maxLongSide: 2000,
  startLongSide: 1600,
  maxCanvasPixels: 2.5e6, // final pass (DOM canvas) pixel cap
  near: 0.25,
  far: 40000,
  vfovDeg: 55,
  // World-anchored textures repeat with periods that divide this; the camera
  // position modulo this period is passed to shaders (keeps floats small).
  wrapPeriod: 4096,
};
