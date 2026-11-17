// Procedural, tileable brush-stroke texture (generated at startup, no assets).
// RGBA8: R = paint height, G/B = surface normal xy (0.5 + 0.5 n), A = stroke id.
// Three layers (underlayer, body, accents) laid with wrap-around so the tile is
// seamless and fully covered. Strokes have bent spines, tapered tails, bristle
// lanes, edge ridges and dry-brush breakup. Mips are built on the CPU: height is
// averaged, normals renormalised, and the id channel takes the majority id of each
// block (never averaged), so distant strokes keep coherent ids.
import * as THREE from 'three';
import { Rng, hashU } from '../core/textures.js';

function vnoise1(x, seed) {
  const i = Math.floor(x), f = x - i;
  const a = (hashU(i * 374761393 + seed * 668265263) >>> 8) / 16777216;
  const b = (hashU((i + 1) * 374761393 + seed * 668265263) >>> 8) / 16777216;
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

/**
 * @param {number} N texture size (power of two)
 * @param {object} opt { seed, layers: [{count, len:[a,b], wid:[a,b], amp, jitterDeg, crossFrac}] } sizes in fractions of N
 */
export function generateStrokeTexture(N = 512, opt = {}) {
  const rng = new Rng(opt.seed ?? 1234);
  const H = new Float32Array(N * N);
  const ID = new Float32Array(N * N);
  const layers = opt.layers ?? [
    { count: 200, len: [0.215, 0.29], wid: [0.068, 0.088], amp: 0.6, jitterDeg: 14, crossFrac: 0.0 },
    { count: 420, len: [0.137, 0.195], wid: [0.039, 0.058], amp: 0.85, jitterDeg: 14, crossFrac: 0.03 },
    { count: 260, len: [0.068, 0.107], wid: [0.021, 0.033], amp: 1.0, jitterDeg: 25, crossFrac: 0.03 },
  ];
  let strokeIndex = 0;
  for (let L = 0; L < layers.length; L++) {
    const ly = layers[L];
    for (let s = 0; s < ly.count; s++) {
      strokeIndex++;
      const id = rng.next();
      const len = rng.range(ly.len[0], ly.len[1]) * N;
      const wid = rng.range(ly.wid[0], ly.wid[1]) * N;
      let ang = rng.gauss() * ly.jitterDeg * 0.5 * Math.PI / 180;
      if (rng.next() < ly.crossFrac) ang = (rng.range(40, 60) * (rng.next() < 0.5 ? -1 : 1)) * Math.PI / 180;
      const cx = rng.next() * N, cy = rng.next() * N;
      const bend = rng.range(-0.12, 0.12) * len;
      const lanes = 10 + Math.floor(rng.next() * 7);
      const amp = ly.amp * rng.range(0.5, 1.0);
      const seed = strokeIndex * 7 + 3;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const R = Math.ceil(len * 0.5 + wid + Math.abs(bend));
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          // Local stroke frame: u along the stroke (0..1), v across (-1..1).
          const lx = dx * ca + dy * sa, ly2 = -dx * sa + dy * ca;
          const u = lx / len + 0.5;
          if (u < -0.05 || u > 1.05) continue;
          const uc = Math.max(0, Math.min(1, u));
          // Quadratic-Bezier spine offset (max at the middle).
          const spine = bend * 4 * uc * (1 - uc);
          const taper = uc > 0.7 ? 1 - 0.35 * (uc - 0.7) / 0.3 : 1;
          const halfW = wid * 0.5 * taper * (uc < 0.06 ? 0.75 + 0.25 * uc / 0.06 : 1);
          const v = (ly2 - spine) / halfW;
          const av = Math.abs(v);
          if (av >= 1) continue;
          // Soft rounded ends.
          const endFade = Math.min(1, Math.max(0, u / 0.05), Math.max(0, (1.04 - u) / 0.08));
          if (endFade <= 0) continue;
          const load = smooth(0, 0.1, u) * (1.15 - 0.5 * uc) + 0.25 * Math.exp(-(((u - 0.06) / 0.05) ** 2));
          const across = Math.sqrt(Math.max(0, 1 - av ** 2.5)) + 0.07 * Math.exp(-(((av - 0.9) / 0.08) ** 2));
          // Bristle marks only toward the stroke edges and tail; interiors stay close to flat colour.
          const bristle = 1 - (0.06 * smooth(0.45, 0.95, av) + 0.04 * smooth(0.6, 1, u)) * vnoise1(v * lanes + 0.15 * vnoise1(2 * u * 6, seed + 1) * 4, seed);
          let mask = smooth(1, 0.82, av) * endFade;
          // Dry-brush tail: bristle lanes break up toward the end of the stroke.
          const dry = 0.35 * smooth(0.8, 1, u);
          if (vnoise1(1.7 * lanes * v + 3.1, seed + 2) < dry) mask *= 0.0;
          if (mask <= 0.001) continue;
          const h = amp * load * across * bristle;
          const x = ((Math.round(cx + dx) % N) + N) % N, y = ((Math.round(cy + dy) % N) + N) % N;
          const k = y * N + x;
          const base = 0.15 * L;
          H[k] = H[k] + (base + h - H[k]) * mask;
          if (mask > 0.5) ID[k] = id;
        }
      }
    }
  }
  // Normalise height to 0..1.
  let mx = 0;
  for (let i = 0; i < N * N; i++) if (H[i] > mx) mx = H[i];
  for (let i = 0; i < N * N; i++) H[i] /= mx || 1;

  // Soften the relief (3x3 blur, wrap) so normals carry stroke shapes, not pixel grain.
  {
    const T = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let a = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) a += H[((y + j + N) % N) * N + ((x + i + N) % N)] * (i === 0 && j === 0 ? 4 : (i === 0 || j === 0 ? 2 : 1));
      T[y * N + x] = a / 16;
    }
    H.set(T);
  }
  // Level 0 normals (wrap-around Sobel), scaled for ~25-35 degree typical slopes.
  const slope = opt.normalStrength ?? 4.0;
  const levels = [];
  let size = N, h = H, ids = ID;
  while (size >= 1) {
    const data = new Uint8Array(size * size * 4);
    const s = slope * (size / N);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const xm = (x - 1 + size) % size, xp = (x + 1) % size, ym = (y - 1 + size) % size, yp = (y + 1) % size;
        const gx = (h[y * size + xp] - h[y * size + xm]) * 2 + (h[ym * size + xp] - h[ym * size + xm]) + (h[yp * size + xp] - h[yp * size + xm]);
        const gy = (h[yp * size + x] - h[ym * size + x]) * 2 + (h[yp * size + xm] - h[ym * size + xm]) + (h[yp * size + xp] - h[ym * size + xp]);
        let nx = -gx * s / 8 * size / 64, ny = -gy * s / 8 * size / 64, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l;
        const k = (y * size + x) * 4;
        data[k] = Math.round(Math.min(1, Math.max(0, h[y * size + x])) * 255);
        data[k + 1] = Math.round((nx * 0.5 + 0.5) * 255);
        data[k + 2] = Math.round((ny * 0.5 + 0.5) * 255);
        data[k + 3] = Math.round(ids[y * size + x] * 255);
      }
    }
    levels.push({ data, width: size, height: size });
    if (size === 1) break;
    // Next level: average height; id = majority (ties -> highest paint).
    const ns = size >> 1;
    const nh = new Float32Array(ns * ns), nid = new Float32Array(ns * ns);
    for (let y = 0; y < ns; y++) for (let x = 0; x < ns; x++) {
      const k0 = (2 * y) * size + 2 * x, k1 = k0 + 1, k2 = k0 + size, k3 = k2 + 1;
      nh[y * ns + x] = (h[k0] + h[k1] + h[k2] + h[k3]) * 0.25;
      const c = [k0, k1, k2, k3];
      let best = k0, bestCount = -1;
      for (const a of c) {
        let cnt = 0;
        for (const b of c) if (Math.abs(ids[a] - ids[b]) < 1e-6) cnt++;
        if (cnt > bestCount || (cnt === bestCount && h[a] > h[best])) { best = a; bestCount = cnt; }
      }
      nid[y * ns + x] = ids[best];
    }
    size = ns; h = nh; ids = nid;
  }
  const tex = new THREE.DataTexture(levels[0].data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = levels;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.name = 'brush-strokes';
  tex.needsUpdate = true;
  return { tex, levels, size: N };
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
