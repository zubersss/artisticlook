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
  if (out.simple) {
    if (level >= 2) return; // far version: trunk and main limbs only
    sides = Math.max(3, Math.round(sides * 0.5));
    if (level > 0 && pts.length > 4) { const keep = [pts[0], pts[Math.floor(pts.length / 3)], pts[Math.floor(2 * pts.length / 3)], pts[pts.length - 1]]; radii = [radii[0], radii[Math.floor(radii.length / 3)], radii[Math.floor(2 * radii.length / 3)], radii[radii.length - 1]]; pts = keep; }
  }
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
    out.idx.push(a, a + 1, b2, a + 1, b2 + 1, b2); // CCW seen from outside
  }
}

/** Curved branch from p0 along dir, bending upward; returns points. */
function branchPoints(p0, dir, len, segs, upBend, rng, wobble) {
  const pts = [p0.clone()];
  const d = dir.clone().normalize();
  const p = p0.clone();
  // 1-2 elbows: a crook of 20-35 degrees at random segments.
  const e1 = 1 + rng.int(Math.max(1, segs - 1)), e2 = 1 + rng.int(Math.max(1, segs - 1));
  for (let i = 1; i <= segs; i++) {
    const step = len / segs;
    if (segs >= 3 && (i === e1 || i === e2)) {
      const axis = new THREE.Vector3(rng.next() - 0.5, 0, rng.next() - 0.5).normalize();
      d.applyAxisAngle(axis, rng.range(0.35, 0.6) * (rng.next() < 0.5 ? -1 : 1));
    }
    d.lerp(UP, upBend / segs).normalize();
    d.x += (rng.next() - 0.5) * wobble; d.z += (rng.next() - 0.5) * wobble; d.normalize();
    p.addScaledVector(d, step);
    pts.push(p.clone());
  }
  return pts;
}

/** Thin dark twigs radiating from a cluster centre (they show through canopy gaps). */
function addTwigs(out, c, len, r, rng) {
  const n = 3;
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2, e = rng.range(-0.3, 0.8);
    const d = new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
    const pts = branchPoints(c.clone().addScaledVector(d, -0.4), d, len * rng.range(0.5, 0.8), 3, 0.25, rng, 0.7);
    addTube(out, pts, pts.map((_, j) => Math.max(0.05, r) * (1 - 0.5 * j / (pts.length - 1))), 3, 3, 0);
  }
}

export function generateTree(recipe, seed, opts = {}) {
  const rng = new Rng(seed);
  const R = recipe;
  const H = rng.range(R.height[0], R.height[1]);
  const baseR = rng.range(R.baseRadius[0], R.baseRadius[1]);
  const out = { pos: [], nrm: [], bark: [], idx: [], simple: !!opts.simple };
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
    trunkR.push(baseR * (conifer ? (1 - f * 0.92) : (1 - f * 0.55) * (f > 0.85 ? 1 - (f - 0.85) / 0.15 * 0.75 : 1)));
  }
  // Root collar below ground so the flared base never floats on slopes.
  const tubePts = [new THREE.Vector3(trunkPts[0].x, -1.2, trunkPts[0].z), ...trunkPts];
  const tubeR = [trunkR[0] * 1.15, ...trunkR];
  addTube(out, tubePts, tubeR, R.trunkSides ?? 10, 0, -1.2, { amount: 0.9, lobes: 4 + rng.int(2), phase: rng.next() * 6, rings: 2 });

  if (conifer) {
    // Tiered cone of clusters along the trunk; short drooping whorls.
    const tiers = R.tiers ?? 9;
    for (let t = 0; t < tiers; t++) {
      const f = 0.22 + 0.76 * (t / (tiers - 1));
      const y = f * H;
      const rad = Math.pow(1 - f, 0.85) * R.crownRadius + 0.35;
      const per = Math.max(3, Math.round(rad * 2.6));
      for (let k = 0; k < per; k++) {
        const a = (k / per) * Math.PI * 2 + rng.next() * 0.6;
        const c = new THREE.Vector3(Math.cos(a) * rad * 0.55, y - rad * 0.15, Math.sin(a) * rad * 0.55);
        c.x += trunkPts[Math.min(segs, Math.round(f * segs))].x; c.z += trunkPts[Math.min(segs, Math.round(f * segs))].z;
        clusters.push({ c, r: Math.max(0.7, rad * 0.62), flat: 0.85 });
      }
    }
    clusters.push({ c: trunkPts[segs].clone().add(new THREE.Vector3(0, -0.4, 0)), r: 0.9, flat: 1 });
  } else {
    // Limbs from the upper trunk, each splitting into secondaries; clusters at tips.
    const nLimbs = R.limbs[0] + rng.int(R.limbs[1] - R.limbs[0] + 1);
    for (let l = 0; l < nLimbs; l++) {
      // Staggered fork heights.
      const f = R.limbStart + (1 - R.limbStart) * Math.min(0.98, (l + rng.range(0.1, 0.8)) / nLimbs);
      const idx = Math.min(segs - 1, Math.floor(f * segs));
      const p0 = trunkPts[idx].clone().lerp(trunkPts[idx + 1], f * segs - idx);
      const ang = (l / nLimbs) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const tilt = rng.range(R.limbTilt[0], R.limbTilt[1]) * Math.PI / 180;
      const dir = new THREE.Vector3(Math.cos(ang) * Math.sin(tilt), Math.cos(tilt), Math.sin(ang) * Math.sin(tilt));
      const ll = R.limbLength ?? [0.32, 0.45];
      const len = H * rng.range(ll[0], ll[1]) * (1 - (f - R.limbStart) * 0.5);
      const pts = branchPoints(p0, dir, len, 6, 0.4, rng, R.limbWobble ?? 0.45);
      const r0 = trunkR[idx] * rng.range(0.5, 0.65);
      const limbR = pts.map((_, i) => r0 * Math.pow(1 - 0.85 * i / (pts.length - 1), 1.3));
      addTube(out, pts, limbR, 5, 1, 0);
      // Secondaries (2-3), each splitting once more into tertiaries.
      const nSec = 2 + rng.int(2);
      for (let s = 0; s < nSec; s++) {
        const k = 2 + rng.int(3);
        const q0 = pts[Math.min(pts.length - 1, k)];
        const sd = dir.clone().applyAxisAngle(UP, rng.range(-1.2, 1.2)).lerp(UP, 0.25).normalize();
        const sl = len * rng.range(0.35, 0.55);
        const sp = branchPoints(q0, sd, sl, 4, 0.25, rng, 0.5);
        const sr = limbR[Math.min(limbR.length - 1, k)] * 0.75;
        addTube(out, sp, sp.map((_, i) => sr * (1 - 0.8 * i / (sp.length - 1))), 4, 2, 0);
        const tc = sp[sp.length - 1].clone();
        clusters.push({ c: tc, r: rng.range(R.clusterR[0], R.clusterR[1]) * 0.85, flat: 0.85 });
        addTwigs(out, tc, 1.6, sr * 0.3, rng);
      }
      const lc = pts[pts.length - 1].clone();
      clusters.push({ c: lc, r: rng.range(R.clusterR[0], R.clusterR[1]), flat: 0.85 });
      addTwigs(out, lc, 1.8, limbR[limbR.length - 1] * 0.6, rng);
    }
    // Crown spheres to close the top, each reached by a leader from the trunk top.
    const top = trunkPts[segs];
    for (let k = 0; k < (R.crown ?? 2); k++) {
      const c = top.clone().add(new THREE.Vector3(rng.range(-1.2, 1.2), H * 0.18 + rng.range(-0.5, 1), rng.range(-1.2, 1.2)));
      clusters.push({ c, r: rng.range(R.clusterR[0], R.clusterR[1]) * 1.15, flat: 0.8 });
      const d = c.clone().sub(top);
      const lp = branchPoints(top, d.clone().normalize(), d.length(), 4, 0.1, rng, 0.3);
      addTube(out, lp, lp.map((_, i) => trunkR[segs - 1] * 0.9 * (1 - 0.8 * i / (lp.length - 1))), 6, 2, 0);
      addTwigs(out, c, 1.8, trunkR[segs] * 0.4, rng);
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
      const roll = opts.roll ?? Math.PI;
      card.push(cells[rng.int(cells.length)], roll >= Math.PI ? rng.next() * Math.PI * 2 : (rng.next() - 0.5) * 2 * roll, rng.range(size[0], size[1]), 0);
      rng.next(); tint.push(rng.next(), rng.next(), opts.aspect ?? 1, t); // z = card aspect (for uv)
      rankIndex++;
    }
  }
  const n = centers.length / 3;
  // Rank: random order for LOD erosion / governor thinning (outer shell kept longest).
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  order.forEach((ci, r) => { card[ci * 4 + 3] = (r + 0.5) / n; });

  // Octagon cards (8 corners, 6 tris) fitted to the dab disc for near trees (they save
  // fill rate); plain quads (2 tris) for far trees, where vertex cost matters more.
  const V = opts.quads ? 4 : 8;
  const pos = new Float32Array(n * V * 3), corner = new Float32Array(n * V * 2);
  const aCl = new Float32Array(n * V * 4), aCard = new Float32Array(n * V * 4), aTint = new Float32Array(n * V * 4);
  const idx = [];
  const oct = [];
  for (let i = 0; i < V; i++) { const a = (i / V) * Math.PI * 2 + Math.PI / V; oct.push([Math.cos(a) / Math.cos(Math.PI / V), Math.sin(a) / Math.cos(Math.PI / V)]); }
  for (let q = 0; q < n; q++) {
    for (let i = 0; i < V; i++) {
      const o = q * V + i;
      pos.set(centers.slice(q * 3, q * 3 + 3), o * 3);
      corner[o * 2] = oct[i][0] * (opts.outline ?? 0.96) * (opts.aspect ?? 1); corner[o * 2 + 1] = oct[i][1] * (opts.outline ?? 0.96);
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
