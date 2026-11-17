// Recipe-driven heightfield and material masks, generated on the CPU at startup.
// Two grids: a 1 m near grid around the walkable patch and a 64 m far grid out to
// ±16 km. Carvings (paths, streams, flattened pads) apply to the near grid only.
// The same arrays feed the GPU (vertex-fetched textures) and CPU height queries,
// so walking height always matches what is drawn.
import { fbm, ridged, dunes, gnoise, smoothstep } from './noise.js';

export const NEAR = { N: 1024, spacing: 1, origin: -512 };
export const FAR = { N: 512, spacing: 64, origin: -16384 };
// Near -> far blend band (Chebyshev distance from the origin, metres).
export const BLEND = [380, 470];

function catmullRom(points, step) {
  const out = [];
  const P = points;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(P[P.length - 1].slice());
  return out;
}

export class Heightfield {
  constructor(recipe, seed = 1) {
    this.r = recipe;
    this.seed = recipe.seed ?? seed;
    this.near = new Float32Array(NEAR.N * NEAR.N);
    this.far = new Float32Array(FAR.N * FAR.N);
    this.nearMask = new Uint8Array(NEAR.N * NEAR.N * 4); // R path, G water/banks, B forest density, A meadow
    this.farMask = new Uint8Array(FAR.N * FAR.N * 4); // B forest density, A fields
    this.splines = {}; // name -> { pts, dist(Float32Array), idx(Int32Array) }
  }

  /** Base height from the layered recipe; layers finer than minWl are skipped (band limit). */
  base(x, z, minWl) {
    const L = this.r.layers;
    let h = 0;
    const r = Math.hypot(x, z);
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      const s = this.seed + i * 101;
      switch (l.type) {
        case 'fbm': {
          const oct = Math.max(1, Math.min(l.octaves, Math.floor(Math.log2(l.wavelength / minWl)) + 1));
          h += l.amplitude * fbm(x / l.wavelength, z / l.wavelength, oct, l.gain ?? 0.5, s);
          break;
        }
        case 'bump': {
          const d = Math.hypot(x - l.x, z - l.z) / l.radius;
          h += l.height * Math.exp(-d * d * 2.2);
          break;
        }
        case 'far-hills': {
          const w = smoothstep(l.start, l.full, r);
          if (w > 0) {
            const oct = Math.max(1, Math.min(l.octaves, Math.floor(Math.log2(l.wavelength / minWl)) + 1));
            h += w * l.amplitude * (0.5 + 0.5 * fbm(x / l.wavelength, z / l.wavelength, oct, l.gain ?? 0.5, s));
          }
          break;
        }
        case 'ridges': {
          const w = smoothstep(l.start, l.full, r);
          if (w > 0) {
            const oct = Math.max(1, Math.min(l.octaves, Math.floor(Math.log2(l.wavelength / minWl)) + 1));
            h += w * l.amplitude * ridged(x / l.wavelength, z / l.wavelength, oct, l.gain ?? 0.5, l.sharpness ?? 0.5, s);
          }
          break;
        }
        case 'range': {
          // A band of hills at a given distance from the origin: from anywhere in the
          // patch it reads as a ridgeline, so several ranges give receding planes.
          const t = (r - l.distance) / l.width;
          const band = Math.exp(-t * t * 2.0);
          if (band > 1e-3) {
            const oct = Math.max(1, Math.min(l.octaves ?? 4, Math.floor(Math.log2(l.wavelength / minWl)) + 1));
            const n = 0.55 + 0.45 * fbm(x / l.wavelength, z / l.wavelength, oct, l.gain ?? 0.5, s);
            h += l.amplitude * band * n;
          }
          break;
        }
        case 'dunes': {
          if (l.wavelength >= minWl * 2) h += l.amplitude * dunes(x, z, l.wavelength, l.direction ?? 0, s);
          break;
        }
        default: break;
      }
    }
    return h;
  }

  async build(progress = () => {}) {
    const yieldUI = () => new Promise((res) => setTimeout(res, 0));
    // Far grid (band-limited to 2 cells).
    for (let j = 0; j < FAR.N; j++) {
      const z = FAR.origin + j * FAR.spacing;
      for (let i = 0; i < FAR.N; i++) this.far[j * FAR.N + i] = this.base(FAR.origin + i * FAR.spacing, z, FAR.spacing * 2);
      if ((j & 63) === 63) { progress(j / FAR.N * 0.3); await yieldUI(); }
    }
    // Near grid.
    for (let j = 0; j < NEAR.N; j++) {
      const z = NEAR.origin + j * NEAR.spacing;
      for (let i = 0; i < NEAR.N; i++) this.near[j * NEAR.N + i] = this.base(NEAR.origin + i * NEAR.spacing, z, NEAR.spacing * 2);
      if ((j & 63) === 63) { progress(0.3 + j / NEAR.N * 0.5); await yieldUI(); }
    }
    for (const c of this.r.carve || []) this.carve(c);
    for (const f of this.r.flatten || []) this.flattenPad(f);
    this.buildMasks();
    this.buildNormals();
    this.buildFlow();
    progress(1);
  }

  /** Rasterise distance-to-spline into a near-grid field. */
  splineField(points, radius) {
    const pts = catmullRom(points, 1.0);
    const N = NEAR.N;
    const dist = new Float32Array(N * N).fill(1e9);
    const idx = new Int32Array(N * N).fill(-1);
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - radius - NEAR.origin));
      const x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx) + radius - NEAR.origin));
      const z0 = Math.max(0, Math.floor(Math.min(az, bz) - radius - NEAR.origin));
      const z1 = Math.min(N - 1, Math.ceil(Math.max(az, bz) + radius - NEAR.origin));
      const dx = bx - ax, dz = bz - az, ll = dx * dx + dz * dz || 1;
      for (let j = z0; j <= z1; j++) {
        const pz = NEAR.origin + j;
        for (let i = x0; i <= x1; i++) {
          const px = NEAR.origin + i;
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / ll));
          const qx = ax + dx * t - px, qz = az + dz * t - pz;
          const d = Math.sqrt(qx * qx + qz * qz);
          const k = j * N + i;
          if (d < dist[k]) { dist[k] = d; idx[k] = s; }
        }
      }
    }
    return { pts, dist, idx };
  }

  nearAtIndex(x, z) {
    const i = Math.round(x - NEAR.origin), j = Math.round(z - NEAR.origin);
    if (i < 0 || j < 0 || i >= NEAR.N || j >= NEAR.N) return 0;
    return this.near[j * NEAR.N + i];
  }

  carve(c) {
    const half = c.width / 2;
    const reach = half + (c.bankWidth ?? 3);
    const f = this.splineField(c.points, reach + 2);
    this.splines[c.name] = { ...f, carve: c };
    const n = f.pts.length;
    // Centre-line heights.
    const hc = new Float32Array(n);
    for (let s = 0; s < n; s++) hc[s] = this.nearAtIndex(f.pts[s][0], f.pts[s][1]);
    const target = new Float32Array(n);
    if (c.kind === 'stream') {
      // Water must run downhill: pick the higher end as the source, take a running minimum.
      const forward = hc[0] >= hc[n - 1];
      let m = 1e9;
      for (let k = 0; k < n; k++) {
        const s = forward ? k : n - 1 - k;
        m = Math.min(m, hc[s]);
        target[s] = m - c.depth;
      }
      f.bed = target;
      f.flowForward = forward;
    } else {
      // Smooth the path grade along its length (±6 m window).
      for (let s = 0; s < n; s++) {
        let acc = 0, w = 0;
        for (let k = -6; k <= 6; k++) { const q = Math.min(n - 1, Math.max(0, s + k)); acc += hc[q]; w++; }
        target[s] = acc / w;
      }
    }
    const N = NEAR.N;
    for (let k = 0; k < N * N; k++) {
      const d = f.dist[k];
      if (d > reach) continue;
      const s = f.idx[k];
      const h = this.near[k];
      if (c.kind === 'stream') {
        const bed = target[s] - c.depth * 0.25 * (1 - smoothstep(0, half, d));
        const t = smoothstep(half * 0.8, reach, d);
        this.near[k] = Math.min(h, bed + (h - bed) * t * t);
      } else {
        const w = 1 - smoothstep(half, reach, d);
        const dip = c.depth * (1 - smoothstep(0, half, d));
        this.near[k] = h + (target[s] - dip - h) * w;
      }
    }
  }

  flattenPad(p) {
    const N = NEAR.N;
    const ci = Math.round(p.x - NEAR.origin), cj = Math.round(p.z - NEAR.origin);
    const R = Math.ceil(p.radius * 1.8);
    let acc = 0, cnt = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { acc += this.near[(cj + j) * N + ci + i]; cnt++; }
    const h0 = acc / cnt;
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const d = Math.hypot(i, j);
      const w = (1 - smoothstep(p.radius, p.radius * 1.8, d)) * p.strength;
      const k = (cj + j) * N + ci + i;
      this.near[k] += (h0 - this.near[k]) * w;
    }
  }

  forestDensity(x, z) {
    const F = this.r.forest;
    if (!F || F.base <= 0) return 0;
    let d = F.base + F.noiseAmp * fbm(x / F.noiseScale, z / F.noiseScale, 3, 0.5, this.seed + 777);
    for (const c of this.r.clearings || []) {
      const r = Math.hypot(x - c.x, z - c.z);
      const edge = c.radius * (1 + 0.18 * gnoise(Math.atan2(z - c.z, x - c.x) * 2.5, c.radius * 0.1, this.seed + 3));
      d *= smoothstep(edge * 0.75, edge * 1.1, r);
    }
    return Math.max(0, Math.min(1, d));
  }

  buildMasks() {
    const N = NEAR.N;
    const path = this.splines.path, stream = this.splines.stream;
    for (let j = 0; j < N; j++) {
      const z = NEAR.origin + j;
      for (let i = 0; i < N; i++) {
        const x = NEAR.origin + i;
        const k = j * N + i;
        let pm = 0, wm = 0;
        if (path) { const half = path.carve.width / 2; pm = 1 - smoothstep(half - 0.4, half + 0.9, path.dist[k]); }
        if (stream) { const half = stream.carve.width / 2; wm = 1 - smoothstep(half, half + stream.carve.bankWidth, stream.dist[k]); }
        let fd = this.forestDensity(x, z);
        if (path) fd *= smoothstep(path.carve.width * 0.5 + 1, path.carve.width * 0.5 + 6, path.dist[k]);
        if (stream) fd *= smoothstep(stream.carve.width * 0.5 + 1, stream.carve.width * 0.5 + 4, stream.dist[k]);
        let meadow = 0;
        for (const c of this.r.clearings || []) meadow = Math.max(meadow, 1 - smoothstep(c.radius * 0.7, c.radius * 1.15, Math.hypot(x - c.x, z - c.z)));
        this.nearMask[k * 4] = Math.round(pm * 255);
        this.nearMask[k * 4 + 1] = Math.round(wm * 255);
        this.nearMask[k * 4 + 2] = Math.round(fd * 255);
        this.nearMask[k * 4 + 3] = Math.round(meadow * 255);
      }
    }
    const M = FAR.N;
    for (let j = 0; j < M; j++) {
      const z = FAR.origin + j * FAR.spacing;
      for (let i = 0; i < M; i++) {
        const x = FAR.origin + i * FAR.spacing;
        const k = j * M + i;
        const fd = this.forestDensity(x, z);
        const fields = this.r.forest ? smoothstep(0.15, 0.45, 0.5 + 0.5 * fbm(x / 900, z / 900, 3, 0.5, this.seed + 55)) * (1 - fd * 0.6) : 0;
        this.farMask[k * 4 + 2] = Math.round(fd * 255);
        this.farMask[k * 4 + 3] = Math.round(fields * 255);
      }
    }
  }

  /**
   * Stroke flow field over the near grid (2 m texels): doubled-angle direction
   * (cos 2θ, sin 2θ) so opposite directions are equal, plus a randomness weight.
   * Rules: along contours on slopes, slow curl-like noise on flat ground, across the
   * path inside it and along it at its edges, along the stream, random in litter.
   */
  buildFlow() {
    const M = NEAR.N / 2, N = NEAR.N;
    const out = new Uint8Array(M * M * 4);
    const path = this.splines.path, stream = this.splines.stream;
    const tangent = (sp, k) => {
      const i = sp.idx[k];
      if (i < 0) return 0;
      const a = sp.pts[Math.max(0, i - 1)], b = sp.pts[Math.min(sp.pts.length - 1, i + 2)];
      return Math.atan2(b[1] - a[1], b[0] - a[0]);
    };
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const gi = i * 2, gj = j * 2, k = gj * N + gi;
        const x = NEAR.origin + gi, z = NEAR.origin + gj;
        const hx = this.near[gj * N + Math.min(N - 1, gi + 2)] - this.near[gj * N + Math.max(0, gi - 2)];
        const hz = this.near[Math.min(N - 1, gj + 2) * N + gi] - this.near[Math.max(0, gj - 2) * N + gi];
        const gl = Math.hypot(hx, hz) / 4;
        // Flat ground: slowly turning noise directions (64 m scale).
        let ang = Math.PI * fbm(x / 128, z / 128, 2, 0.5, this.seed + 909) * 0.9;
        let vx = Math.cos(2 * ang), vz = Math.sin(2 * ang);
        // Slopes: along the contours.
        const ws = smoothstep(0.004, 0.04, gl);
        if (ws > 0) {
          const ca = Math.atan2(hx, -hz);
          vx += (Math.cos(2 * ca) - vx) * ws; vz += (Math.sin(2 * ca) - vz) * ws;
        }
        let rnd = this.nearMask[k * 4 + 2] / 255; // litter under the forest: random per stroke
        if (stream && stream.dist[k] < stream.carve.width * 0.5 + stream.carve.bankWidth + 2) {
          const t = tangent(stream, k);
          const w = 1 - smoothstep(stream.carve.width * 0.5 + 1, stream.carve.width * 0.5 + stream.carve.bankWidth + 2, stream.dist[k]);
          vx += (Math.cos(2 * t) - vx) * w; vz += (Math.sin(2 * t) - vz) * w; rnd *= 1 - w;
        }
        if (path && path.dist[k] < path.carve.width * 0.5 + 2) {
          const t = tangent(path, k);
          const half = path.carve.width * 0.5;
          // Across the path (flattened leaf dabs in perspective); edges lean only 30 deg
          // toward the path direction so the field never swirls.
          const edge = smoothstep(half - 0.9, half - 0.2, path.dist[k]);
          const a = t + Math.PI / 2 - edge * Math.PI / 6;
          const w = 1 - smoothstep(half + 0.5, half + 2, path.dist[k]);
          vx += (Math.cos(2 * a) - vx) * w; vz += (Math.sin(2 * a) - vz) * w; rnd *= 1 - w;
        }
        const l = Math.hypot(vx, vz) || 1;
        const o = (j * M + i) * 4;
        out[o] = Math.round((vx / l * 0.5 + 0.5) * 255);
        out[o + 1] = Math.round((vz / l * 0.5 + 0.5) * 255);
        out[o + 2] = Math.round(Math.min(1, rnd) * 255);
        out[o + 3] = 255;
      }
    }
    this.flow = out;
    this.flowN = M;
  }

  buildNormals() {
    const mk = (H, G) => {
      const N = G.N, out = new Uint8Array(N * N * 4), s2 = 2 * G.spacing;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const hx = H[j * N + Math.min(N - 1, i + 1)] - H[j * N + Math.max(0, i - 1)];
        const hz = H[Math.min(N - 1, j + 1) * N + i] - H[Math.max(0, j - 1) * N + i];
        let nx = -hx / s2, ny = 1, nz = -hz / s2;
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        const k = (j * N + i) * 4;
        out[k] = Math.round((nx * 0.5 + 0.5) * 255);
        out[k + 1] = Math.round((nz * 0.5 + 0.5) * 255);
        out[k + 2] = Math.round(ny * 255);
        out[k + 3] = 255;
      }
      return out;
    };
    this.nearNormal = mk(this.near, NEAR);
    this.farNormal = mk(this.far, FAR);
  }

  sampleGrid(H, G, x, z) {
    const fx = (x - G.origin) / G.spacing, fz = (z - G.origin) / G.spacing;
    const N = G.N;
    const i = Math.max(0, Math.min(N - 2, Math.floor(fx))), j = Math.max(0, Math.min(N - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
    const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
  }

  /** Ground height at world (x, z): identical blend to the terrain vertex shader. */
  heightAt(x, z) {
    const r = Math.max(Math.abs(x), Math.abs(z));
    const w = 1 - smoothstep(BLEND[0], BLEND[1], r);
    const hf = w < 1 ? this.sampleGrid(this.far, FAR, x, z) : 0;
    if (w <= 0) return hf;
    const hn = this.sampleGrid(this.near, NEAR, x, z);
    return hf + (hn - hf) * w;
  }

  maskAt(x, z, channel) {
    const i = Math.round(x - NEAR.origin), j = Math.round(z - NEAR.origin);
    if (i < 0 || j < 0 || i >= NEAR.N || j >= NEAR.N) return 0;
    return this.nearMask[(j * NEAR.N + i) * 4 + channel] / 255;
  }

  /** Conservative min/max height over a square (for quadtree culling). */
  minMax(x0, z0, size, out) {
    let mn = 1e9, mx = -1e9;
    const n = 6;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const h = this.heightAt(x0 + size * i / n, z0 + size * j / n);
      if (h < mn) mn = h; if (h > mx) mx = h;
    }
    const pad = 2 + size * 0.02;
    out[0] = mn - pad; out[1] = mx + pad;
    return out;
  }
}
