// Procedural tree generator (data in, geometry out). A variant recipe from the world
// file gives height, fork height, limb count/angles, crown clusters and dab budget.
// Output (tree-local metres, y up, base at the origin):
//   trunk: BufferGeometry with position, normal, aBark (u around in m, v along in m, height, level)
//   cards: BufferGeometry of octagonal foliage cards, attributes:
//     position  = card centre (tree-local)          aCorner = octagon corner (-1..1)
//     aCluster  = cluster centre xyz + radius       aCard   = cell index, roll, size, rank (0..1)
//     aTint     = per-card random (variant mix, value jitter)
import * as THREE from 'three';
import { Rng } from '../core/textures.js';

const UP = new THREE.Vector3(0, 1, 0);

function frameFor(dir) {
  const t = Math.abs(dir.y) < 0.99 ? new THREE.Vector3().crossVectors(UP, dir).normalize() : new THREE.Vector3(1, 0, 0);
  const b = new THREE.Vector3().crossVectors(dir, t).normalize();
  return { t, b };
}

/** Tube along a polyline with per-point radius. */
function addTube(out, pts, radii, sides, level, vStart, flare) {
  const n = pts.length;
  const base = out.pos.length / 3;
  let v = vStart;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const dir = (i < n - 1 ? pts[i + 1].clone().sub(p) : p.clone().sub(pts[i - 1])).normalize();
    const { t, b } = frameFor(dir);
    if (i > 0) v += pts[i].distanceTo(pts[i - 1]);
    const r = radii[i];
    const circ = 2 * Math.PI * r;
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      let rr = r;
      if (flare && i < (flare.rings ?? 1) + 1) rr *= 1 + flare.amount * Math.max(0, 1 - Math.max(0, i - (flare.rings ?? 1) + 1)) * (0.7 + 0.3 * Math.cos(a * flare.lobes + flare.phase));
      const nx = t.x * Math.cos(a) + b.x * Math.sin(a), ny = t.y * Math.cos(a) + b.y * Math.sin(a), nz = t.z * Math.cos(a) + b.z * Math.sin(a);
      out.pos.push(p.x + nx * rr, p.y + ny * rr, p.z + nz * rr);
      out.nrm.push(nx, ny, nz);
      out.bark.push((s / sides) * circ, v, p.y, level);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < sides; s++) {
    const a = base + i * (sides + 1) + s, b2 = a + sides + 1;
    out.idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
  }
}

/** Curved branch from p0 along dir, bending upward; returns points. */
function branchPoints(p0, dir, len, segs, upBend, rng, wobble) {
  const pts = [p0.clone()];
  const d = dir.clone().normalize();
  const p = p0.clone();
  for (let i = 1; i <= segs; i++) {
    const step = len / segs;
    d.lerp(UP, upBend / segs).normalize();
    d.x += (rng.next() - 0.5) * wobble; d.z += (rng.next() - 0.5) * wobble; d.normalize();
    p.addScaledVector(d, step);
    pts.push(p.clone());
  }
  return pts;
}

export function generateTree(recipe, seed) {
  const rng = new Rng(seed);
  const R = recipe;
  const H = rng.range(R.height[0], R.height[1]);
  const baseR = rng.range(R.baseRadius[0], R.baseRadius[1]);
  const out = { pos: [], nrm: [], bark: [], idx: [] };
  const clusters = [];
  const conifer = R.form === 'conifer';

  // --- trunk spine with lean and a slight S-curve
  const leanA = rng.next() * Math.PI * 2, lean = (R.leanDeg ?? 5) * Math.PI / 180 * rng.range(0.5, 1);
  const trunkTop = conifer ? H * 0.96 : H * rng.range(R.forkAt[0], R.forkAt[1]) + H * 0.12;
  const trunkPts = [], trunkR = [];
  const segs = 8;
  for (let i = 0; i <= segs; i++) {
    const f = i / segs;
    const y = f * trunkTop;
    const s = Math.sin(f * Math.PI * 1.3) * 0.35 * H * 0.02;
    trunkPts.push(new THREE.Vector3(Math.cos(leanA) * (Math.sin(lean) * y + s), y, Math.sin(leanA) * (Math.sin(lean) * y + s)));
    trunkR.push(baseR * (conifer ? (1 - f * 0.92) : (1 - f * 0.55)));
  }
  // Root collar below ground so the flared base never floats on slopes.
  const tubePts = [new THREE.Vector3(trunkPts[0].x, -1.2, trunkPts[0].z), ...trunkPts];
  const tubeR = [trunkR[0] * 1.15, ...trunkR];
  addTube(out, tubePts, tubeR, R.trunkSides ?? 10, 0, -1.2, { amount: 0.6, lobes: 4 + rng.int(2), phase: rng.next() * 6, rings: 2 });

  if (conifer) {
    // Tiered cone of clusters along the trunk; short drooping whorls.
    const tiers = R.tiers ?? 9;
    for (let t = 0; t < tiers; t++) {
      const f = 0.22 + 0.76 * (t / (tiers - 1));
      const y = f * H;
      const rad = (1 - f) * R.crownRadius + 0.5;
      const per = Math.max(3, Math.round(rad * 2.2));
      for (let k = 0; k < per; k++) {
        const a = (k / per) * Math.PI * 2 + rng.next() * 0.6;
        const c = new THREE.Vector3(Math.cos(a) * rad * 0.55, y - rad * 0.15, Math.sin(a) * rad * 0.55);
        c.x += trunkPts[Math.min(segs, Math.round(f * segs))].x; c.z += trunkPts[Math.min(segs, Math.round(f * segs))].z;
        clusters.push({ c, r: Math.max(0.8, rad * 0.55), flat: 0.55 });
      }
    }
    clusters.push({ c: trunkPts[segs].clone().add(new THREE.Vector3(0, -0.4, 0)), r: 0.9, flat: 1 });
  } else {
    // Limbs from the upper trunk, each splitting into secondaries; clusters at tips.
    const nLimbs = R.limbs[0] + rng.int(R.limbs[1] - R.limbs[0] + 1);
    for (let l = 0; l < nLimbs; l++) {
      const f = rng.range(R.limbStart, 1.0);
      const idx = Math.min(segs - 1, Math.floor(f * segs));
      const p0 = trunkPts[idx].clone().lerp(trunkPts[idx + 1], f * segs - idx);
      const ang = (l / nLimbs) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const tilt = rng.range(R.limbTilt[0], R.limbTilt[1]) * Math.PI / 180;
      const dir = new THREE.Vector3(Math.cos(ang) * Math.sin(tilt), Math.cos(tilt), Math.sin(ang) * Math.sin(tilt));
      const len = H * rng.range(0.32, 0.45) * (1 - (f - R.limbStart) * 0.5);
      const pts = branchPoints(p0, dir, len, 5, 0.35, rng, 0.25);
      const r0 = trunkR[idx] * rng.range(0.5, 0.65);
      addTube(out, pts, pts.map((_, i) => r0 * (1 - 0.75 * i / (pts.length - 1))), 6, 1, 0);
      // Secondaries.
      const nSec = 2 + rng.int(2);
      for (let s = 0; s < nSec; s++) {
        const k = 2 + rng.int(3);
        const q0 = pts[Math.min(pts.length - 1, k)];
        const sd = dir.clone().applyAxisAngle(UP, rng.range(-1.2, 1.2)).lerp(UP, 0.25).normalize();
        const sl = len * rng.range(0.35, 0.55);
        const sp = branchPoints(q0, sd, sl, 3, 0.25, rng, 0.35);
        const sr = r0 * (1 - 0.75 * k / (pts.length - 1)) * 0.7;
        addTube(out, sp, sp.map((_, i) => sr * (1 - 0.8 * i / (sp.length - 1))), 5, 2, 0);
        clusters.push({ c: sp[sp.length - 1].clone(), r: rng.range(R.clusterR[0], R.clusterR[1]) * 0.85, flat: 0.85 });
      }
      clusters.push({ c: pts[pts.length - 1].clone(), r: rng.range(R.clusterR[0], R.clusterR[1]), flat: 0.85 });
    }
    // Crown spheres to close the top.
    for (let k = 0; k < (R.crown ?? 2); k++) {
      clusters.push({ c: trunkPts[segs].clone().add(new THREE.Vector3(rng.range(-1, 1), H * 0.18 + rng.range(-0.5, 1), rng.range(-1, 1))), r: rng.range(R.clusterR[0], R.clusterR[1]) * 1.15, flat: 0.8 });
    }
  }

  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  trunk.setAttribute('normal', new THREE.Float32BufferAttribute(out.nrm, 3));
  trunk.setAttribute('aBark', new THREE.Float32BufferAttribute(out.bark, 4));
  trunk.setIndex(out.idx);
  trunk.computeBoundingSphere();

  return { trunk, clusters, height: H, baseRadius: baseR };
}

/**
 * Foliage cards for a set of clusters. Cards sit in the outer shell (r^3 in
 * [0.55R, R]); count per cluster proportional to R^2 within a total budget.
 * cells: list of atlas cell indices to draw from; size: [min, max] card size (m).
 */
export function buildCards(clusters, budget, cells, size, seed, opts = {}) {
  const rng = new Rng(seed);
  const area = clusters.reduce((a, c) => a + c.r * c.r, 0);
  const centers = [], cl = [], card = [], tint = [];
  let rankIndex = 0;
  for (const c of clusters) {
    const n = Math.max(2, Math.round(budget * c.r * c.r / area));
    for (let k = 0; k < n; k++) {
      // Uniform direction, radius biased to the shell.
      const u = rng.next() * 2 - 1, a = rng.next() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const t = Math.cbrt(0.55 ** 3 + rng.next() * (1 - 0.55 ** 3));
      const d = new THREE.Vector3(s * Math.cos(a), u * (c.flat ?? 1), s * Math.sin(a));
      const p = c.c.clone().addScaledVector(d, c.r * t);
      centers.push(p.x, p.y, p.z);
      cl.push(c.c.x, c.c.y, c.c.z, c.r);
      card.push(cells[rng.int(cells.length)], rng.next() * Math.PI * 2, rng.range(size[0], size[1]), 0);
      tint.push(rng.next(), rng.next(), rng.next(), t);
      rankIndex++;
    }
  }
  const n = centers.length / 3;
  // Rank: random order for LOD erosion / governor thinning (outer shell kept longest).
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  order.forEach((ci, r) => { card[ci * 4 + 3] = (r + 0.5) / n; });

  // Octagon cards: 8 corners + fan triangles (6 tris), fitted to the dab disc.
  const V = 8;
  const pos = new Float32Array(n * V * 3), corner = new Float32Array(n * V * 2);
  const aCl = new Float32Array(n * V * 4), aCard = new Float32Array(n * V * 4), aTint = new Float32Array(n * V * 4);
  const idx = [];
  const oct = [];
  for (let i = 0; i < V; i++) { const a = (i / V) * Math.PI * 2 + Math.PI / 8; oct.push([Math.cos(a) / Math.cos(Math.PI / 8), Math.sin(a) / Math.cos(Math.PI / 8)]); }
  for (let q = 0; q < n; q++) {
    for (let i = 0; i < V; i++) {
      const o = q * V + i;
      pos.set(centers.slice(q * 3, q * 3 + 3), o * 3);
      corner[o * 2] = oct[i][0] * (opts.outline ?? 0.96); corner[o * 2 + 1] = oct[i][1] * (opts.outline ?? 0.96);
      aCl.set(cl.slice(q * 4, q * 4 + 4), o * 4);
      aCard.set(card.slice(q * 4, q * 4 + 4), o * 4);
      aTint.set(tint.slice(q * 4, q * 4 + 4), o * 4);
    }
    const b = q * V;
    for (let i = 1; i < V - 1; i++) idx.push(b, b + i, b + i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aCluster', new THREE.BufferAttribute(aCl, 4));
  g.setAttribute('aCard', new THREE.BufferAttribute(aCard, 4));
  g.setAttribute('aTint', new THREE.BufferAttribute(aTint, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.boundingSphere.radius += size[1];
  return { geometry: g, count: n };
}
