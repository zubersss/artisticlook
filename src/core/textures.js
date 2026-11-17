// Small procedural utility textures generated at startup (no external assets).
import * as THREE from 'three';

// Deterministic integer hash (same family as the GLSL one).
export function hashU(x) {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
export function rand01(seed) { return (hashU(seed) >>> 8) / 16777216; }

export class Rng {
  constructor(seed) { this.s = (seed >>> 0) || 1; }
  next() { this.s = (this.s + 0x9e3779b9) >>> 0; return (hashU(this.s) >>> 8) / 16777216; }
  range(a, b) { return a + (b - a) * this.next(); }
  int(n) { return Math.floor(this.next() * n); }
  gauss() { let u = 0; for (let i = 0; i < 4; i++) u += this.next(); return (u - 2) / 0.577; }
}

/** 256x256 RGBA white noise (independent channels), repeat-wrapped, bilinear. */
export function makeNoiseTexture() {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N * 4; i++) data[i] = hashU(i * 747796405 + 2891336453) >>> 24;
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.name = 'noise';
  t.needsUpdate = true;
  return t;
}

/** 256x256 tileable canvas weave: R = thread relief, G = coarse tooth. */
export function makeCanvasTexture() {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const period = 4; // px per thread
  const threads = N / period;
  const rng = new Rng(99);
  const thick = new Float32Array(threads * 2);
  for (let i = 0; i < thick.length; i++) thick[i] = 0.75 + 0.5 * rng.next();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const tx = Math.floor(x / period), ty = Math.floor(y / period);
      const fx = (x % period + 0.5) / period, fy = (y % period + 0.5) / period;
      const over = (tx + ty) & 1; // plain weave: alternate which thread is on top
      const hv = Math.sin(Math.PI * fy) ** 0.8 * thick[ty]; // horizontal thread profile
      const vv = Math.sin(Math.PI * fx) ** 0.8 * thick[threads + tx];
      const h = over ? Math.max(hv, vv * 0.7) : Math.max(vv, hv * 0.7);
      const n = (hashU(x * 131 + y * 7919 + 17) >>> 24) / 255;
      const i = (y * N + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round((0.35 + 0.55 * h + 0.1 * n) * 255)));
      data[i + 1] = hashU(((x >> 3) * 31 + (y >> 3) * 977) | 0) >>> 24;
      data[i + 2] = 128; data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.name = 'canvas-weave';
  t.needsUpdate = true;
  return t;
}
