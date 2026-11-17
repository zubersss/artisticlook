// CPU noise for terrain recipes (integer-hash gradient noise; no sin hashing).
import { hashU } from '../core/textures.js';

const GRAD = new Float32Array(512);
for (let i = 0; i < 256; i++) {
  const a = (hashU(i * 2654435761 + 12345) / 4294967296) * Math.PI * 2;
  GRAD[i * 2] = Math.cos(a); GRAD[i * 2 + 1] = Math.sin(a);
}

function h2(ix, iz, seed) {
  return hashU(Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)) & 255;
}

/** 2D gradient noise in [-1, 1] (approximately), quintic fade. */
export function gnoise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const g00 = h2(ix, iz, seed) * 2, g10 = h2(ix + 1, iz, seed) * 2, g01 = h2(ix, iz + 1, seed) * 2, g11 = h2(ix + 1, iz + 1, seed) * 2;
  const n00 = GRAD[g00] * fx + GRAD[g00 + 1] * fz;
  const n10 = GRAD[g10] * (fx - 1) + GRAD[g10 + 1] * fz;
  const n01 = GRAD[g01] * fx + GRAD[g01 + 1] * (fz - 1);
  const n11 = GRAD[g11] * (fx - 1) + GRAD[g11 + 1] * (fz - 1);
  const a = n00 + (n10 - n00) * ux, b = n01 + (n11 - n01) * ux;
  return (a + (b - a) * uz) * 1.6;
}

export function fbm(x, z, octaves, gain, seed) {
  let s = 0, amp = 1, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    // Rotate each octave to hide grid alignment.
    const rx = x * f * 0.8 - z * f * 0.6, rz = x * f * 0.6 + z * f * 0.8;
    s += gnoise(rx + o * 17.3, rz - o * 9.1, seed + o) * amp;
    norm += amp; amp *= gain; f *= 2.03;
  }
  return s / norm;
}

/** Ridged multifractal in [0, 1]. */
export function ridged(x, z, octaves, gain, sharpness, seed) {
  let s = 0, amp = 1, f = 1, norm = 0, weight = 1;
  for (let o = 0; o < octaves; o++) {
    const rx = x * f * 0.8 - z * f * 0.6, rz = x * f * 0.6 + z * f * 0.8;
    let n = 1 - Math.abs(gnoise(rx + o * 31.7, rz + o * 5.3, seed + 100 + o));
    n = Math.pow(Math.max(0, n), 1 + sharpness * 2);
    n *= weight;
    weight = Math.min(1, Math.max(0, n * 1.5));
    s += n * amp; norm += amp; amp *= gain; f *= 2.1;
  }
  return s / norm;
}

/** Asymmetric dune profile in [0, 1] along a wind direction (for desert recipes). */
export function dunes(x, z, wavelength, dirDeg, seed) {
  const a = dirDeg * Math.PI / 180;
  const u = (x * Math.cos(a) + z * Math.sin(a)) / wavelength;
  const v = (-x * Math.sin(a) + z * Math.cos(a)) / wavelength;
  const warp = gnoise(u * 0.35, v * 0.35, seed) * 0.9 + gnoise(u * 0.9, v * 0.9, seed + 1) * 0.25;
  let p = u + warp;
  p -= Math.floor(p);
  // Gentle windward slope, steep lee face.
  const prof = p < 0.78 ? p / 0.78 : 1 - (p - 0.78) / 0.22;
  const crest = 0.6 + 0.4 * gnoise(v * 0.5, u * 0.2, seed + 2);
  return prof * prof * (3 - 2 * prof) * crest;
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
