// Procedural leaf-dab atlas (no assets). 4x4 cells; each cell is one foliage card:
// a cluster of painted leaf dabs (2-3 overlapping ellipses or a lobed maple star,
// ragged bristle edges). Rows 0-1 hold near-tree cards (5-9 small dabs, 50-60 %
// coverage), rows 2-3 hold mid-tree cards (3-5 merged large dabs).
// Channels: R = alpha, G = per-dab id, B = distance from the dab edge (0..1), A = paint height.
// Mips are coverage-preserving: alpha is rescaled per cell so the fraction of texels
// passing the alpha test matches the full-resolution cell (canopies keep their density
// and holes at distance instead of thinning out or filling in).
import * as THREE from 'three';
import { Rng, hashU } from '../core/textures.js';

const CUT = 0.5;

function n1(x, s) {
  const i = Math.floor(x), f = x - i;
  const a = (hashU(i * 374761393 + s * 668265263) >>> 8) / 16777216;
  const b = (hashU((i + 1) * 374761393 + s * 668265263) >>> 8) / 16777216;
  return a + (b - a) * f * f * (3 - 2 * f);
}

export function generateDabAtlas(N = 512, opt = {}) {
  const rng = new Rng(opt.seed ?? 777);
  const C = N / 4; // cell size
  const A = new Float32Array(N * N), ID = new Float32Array(N * N), E = new Float32Array(N * N), H = new Float32Array(N * N);
  const cellOutline = []; // per cell: radius (fraction of cell) of the octagon that bounds the dabs

  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      const near = cy < 2;
      const ox = cx * C, oy = cy * C;
      const count = near ? 8 + rng.int(5) : 4 + rng.int(3);
      const dabs = [];
      // Place dabs inside a disc (the card is an octagon around it), avoid heavy overlap.
      for (let k = 0; k < count; k++) {
        const r = near ? rng.range(0.11, 0.165) : rng.range(0.2, 0.3); // dab radius as fraction of cell
        let px = 0.5, py = 0.5, tries = 0;
        do {
          const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * (0.5 - r - 0.03);
          px = 0.5 + Math.cos(a) * d; py = 0.5 + Math.sin(a) * d;
          tries++;
        } while (tries < 30 && dabs.some((q) => Math.hypot(q.x - px, q.y - py) < (q.r + r) * (near ? 0.85 : 0.7)));
        dabs.push({
          x: px, y: py, r, id: rng.next(), ang: rng.next() * Math.PI,
          star: near && rng.next() < 0.3, lobes: 3 + rng.int(3),
          sub: Array.from({ length: 2 + rng.int(2) }, () => ({ dx: rng.range(-0.35, 0.35), dy: rng.range(-0.35, 0.35), s: rng.range(0.55, 0.9), a: rng.next() * Math.PI })),
          seed: rng.int(1e6),
        });
      }
      cellOutline.push(0.5);
      for (let y = 0; y < C; y++) {
        for (let x = 0; x < C; x++) {
          const u = (x + 0.5) / C, v = (y + 0.5) / C;
          let best = -1, bestDab = null;
          for (const d of dabs) {
            // Signed "inside-ness" of this dab: max over its ellipses / star.
            const lx = (u - d.x) / d.r, ly = (v - d.y) / d.r;
            let inside = -1;
            if (d.star) {
              const ca = Math.cos(d.ang), sa = Math.sin(d.ang);
              const rx = lx * ca + ly * sa, ry = -lx * sa + ly * ca;
              const th = Math.atan2(ry, rx), rr = Math.hypot(rx, ry);
              const lobe = 0.62 + 0.38 * Math.pow(Math.abs(Math.cos(th * d.lobes * 0.5)), 0.7);
              inside = 1 - rr / lobe;
            } else {
              for (const s of d.sub) {
                const ex = lx - s.dx, ey = ly - s.dy;
                const ca = Math.cos(s.a), sa = Math.sin(s.a);
                const rx = (ex * ca + ey * sa) / (s.s * 1.25), ry = (-ex * sa + ey * ca) / (s.s * 0.78);
                inside = Math.max(inside, 1 - Math.hypot(rx, ry));
              }
            }
            // Ragged bristle edge.
            const ang = Math.atan2(ly, lx);
            inside += (n1(ang * 6 + d.seed, d.seed) - 0.5) * 0.22 + (n1(ang * 17 + 3, d.seed + 1) - 0.5) * 0.1;
            if (inside > best) { best = inside; bestDab = d; }
          }
          const k = (oy + y) * N + ox + x;
          // 2-3 texel alpha ramp around the edge.
          const ramp = 2.5 / (C * (bestDab ? bestDab.r : 0.2));
          const a = Math.min(1, Math.max(0, 0.5 + best / ramp));
          A[k] = a;
          ID[k] = bestDab ? bestDab.id : 0;
          E[k] = Math.max(0, Math.min(1, best * 1.6));
          // Paint height: dome + bristle streaks along the dab.
          const hb = bestDab ? 0.75 + 0.25 * n1((u * Math.cos(bestDab.ang) + v * Math.sin(bestDab.ang)) * 60, bestDab.seed + 7) : 0;
          H[k] = Math.max(0, Math.min(1, Math.sqrt(Math.max(0, best)) * hb));
        }
      }
    }
  }

  // Level 0 + coverage-preserving mips (per cell).
  const levels = [];
  const pack = (size, a, id, e, h) => {
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      data[i * 4] = Math.round(Math.min(1, Math.max(0, a[i])) * 255);
      data[i * 4 + 1] = Math.round(id[i] * 255);
      data[i * 4 + 2] = Math.round(e[i] * 255);
      data[i * 4 + 3] = Math.round(h[i] * 255);
    }
    return { data, width: size, height: size };
  };
  levels.push(pack(N, A, ID, E, H));
  // Reference coverage per cell at level 0.
  const cov0 = new Float32Array(16);
  for (let c = 0; c < 16; c++) {
    const ox = (c % 4) * C, oy = Math.floor(c / 4) * C;
    let n = 0;
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) if (A[(oy + y) * N + ox + x] > CUT) n++;
    cov0[c] = n / (C * C);
  }
  let size = N, a = A, id = ID, e = E, h = H;
  while (size > 4) {
    const ns = size >> 1;
    const na = new Float32Array(ns * ns), nid = new Float32Array(ns * ns), ne = new Float32Array(ns * ns), nh = new Float32Array(ns * ns);
    for (let y = 0; y < ns; y++) for (let x = 0; x < ns; x++) {
      const k0 = 2 * y * size + 2 * x, k1 = k0 + 1, k2 = k0 + size, k3 = k2 + 1;
      const o = y * ns + x;
      na[o] = (a[k0] + a[k1] + a[k2] + a[k3]) * 0.25;
      ne[o] = (e[k0] + e[k1] + e[k2] + e[k3]) * 0.25;
      nh[o] = (h[k0] + h[k1] + h[k2] + h[k3]) * 0.25;
      // id: from the most opaque child (never averaged).
      let bk = k0;
      for (const kk of [k1, k2, k3]) if (a[kk] > a[bk]) bk = kk;
      nid[o] = id[bk];
    }
    // Rescale alpha per cell so coverage at the cutoff matches level 0.
    const cs = ns / 4;
    for (let c = 0; c < 16; c++) {
      const ox = (c % 4) * cs, oy = Math.floor(c / 4) * cs;
      const target = cov0[c];
      let lo = 0.25, hi = 6;
      for (let it = 0; it < 18; it++) {
        const mid = (lo + hi) * 0.5;
        let n = 0;
        for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) if (na[(oy + y) * ns + ox + x] * mid > CUT) n++;
        if (n / (cs * cs) < target) lo = mid; else hi = mid;
      }
      const sc = (lo + hi) * 0.5;
      for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) { const o = (oy + y) * ns + ox + x; na[o] = Math.min(1, na[o] * sc); }
    }
    levels.push(pack(ns, na, nid, ne, nh));
    size = ns; a = na; id = nid; e = ne; h = nh;
  }
  const tex = new THREE.DataTexture(levels[0].data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = levels;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.name = 'leaf-dabs';
  tex.needsUpdate = true;
  return { tex, coverage: cov0, levels };
}
