// Trees: procedural variants (src/vegetation/treegen.js), instanced per variant per
// level of detail. Foliage is drawn in two passes that share geometry and instances:
//   1. depth prepass: colour writes off, alpha-to-coverage (alpha test without MSAA),
//      writes the leaf-dab silhouettes into depth;
//   2. colour pass: depth test EQUAL, no discard, no A2C -> early-Z, every visible
//      sample shaded once, view distance written to alpha like every other material.
// Cards billboard in the vertex shader (camera-facing octagons); normals come from
// each cluster's sphere so canopies shade as soft volumes; backlit transmission uses
// the chord through the cluster sphere toward the Sun.
import * as THREE from 'three';
import { makeMaterial, G } from '../shaders/common.js';
import { GLSL_LIGHTING } from '../shaders/lighting.js';
import { generateTree, buildCards } from './treegen.js';
import { generateDabAtlas } from './dabs.js';
import { generateStrokeTexture } from '../brushwork/strokes.js';
import { lin } from '../core/color.js';
import { Rng } from '../core/textures.js';
import { gnoise } from '../terrain/noise.js';

const CARD_VERT = /* glsl */ `
invariant gl_Position;
in vec2 aCorner;
in vec4 aCluster;
in vec4 aCard;   // cell, roll, size, rank
in vec4 aTint;   // random, random, card aspect, shell depth (r / R)
uniform float uRankCut;
uniform vec4 uLodFade;  // x in-start, y in-end, z out-start, w out-end (m)
uniform float uCardScale;
uniform vec4 uCrown;     // whole-crown centre (tree-local) and radius
out vec2 vUv;
out vec3 vRel;
out vec3 vSN;            // sphere normal (world)
out vec4 vTint;
flat out float vCell;
flat out float vInst;    // per-tree random
out float vSun;          // sun visibility at the card (per vertex)
out vec4 vGlow;          // rgb transmitted light, a = shell depth
void main() {
  mat4 M = modelMatrix * instanceMatrix;
  float sc = length(instanceMatrix[0].xyz);
  vec4 c = M * vec4(position, 1.0);
  vec3 cc = (M * vec4(aCluster.xyz, 1.0)).xyz;
  float R = aCluster.w * sc;
  float d = length(c.xyz);
  // LOD fade: cards shrink (erode) by rank, never pop; and vanish within ~3 m of the eye.
  float fin = smoothstep(uLodFade.x, uLodFade.y, d);
  float fout = 1.0 - smoothstep(uLodFade.z, uLodFade.w, d);
  float f = min(fin, fout);
  float keep = clamp((f - aCard.w * 0.5) * 2.0, 0.0, 1.0);
  float size = aCard.z * sc * uCardScale * keep * smoothstep(1.2, 3.2, d);
  // Governor thinning: cards above the rank cut shrink away smoothly; the rest grow a
  // little to keep the crown's coverage.
  size *= (1.0 - smoothstep(uRankCut - 0.06, uRankCut, aCard.w)) * mix(1.0, 1.3, 1.0 - uRankCut);
  vec4 mv = viewMatrix * c;
  float cr = cos(aCard.y), sr = sin(aCard.y);
  vec2 off = mat2(cr, sr, -sr, cr) * aCorner * (0.5 * size);
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  vec2 cell = vec2(mod(aCard.x, 4.0), floor(aCard.x / 4.0));
  vUv = (cell + 0.5 + aCorner * vec2(1.0 / max(aTint.z, 0.1), 1.0) * 0.47) * 0.25;
  vRel = c.xyz;
  // Normal: cluster sphere blended with the whole crown, so clusters merge into one
  // lit mass with a shaded underside instead of separate cotton balls.
  vec3 crownC = (M * vec4(uCrown.xyz, 1.0)).xyz;
  vec3 crownN = normalize(c.xyz - crownC + 1e-4);
  vSN = normalize(mix(normalize(c.xyz - cc + 1e-4), crownN, 0.35));
  vTint = aTint;
  vCell = aCard.x;
  vInst = hashF(uint(int(floor(instanceMatrix[3].x * 7.0)) * 73856093 ^ int(floor(instanceMatrix[3].z * 7.0)) * 19349663));
  // Transmission through the cluster toward the Sun (per card).
  vec3 pc = c.xyz - cc;
  float b = dot(pc, uSunDir);
  float q = dot(pc, pc) - R * R;
  float chord = max(0.0, -b + sqrt(max(b * b - q, 0.0)));
  float crownDepth = clamp(length(c.xyz - crownC) / (uCrown.w * sc), 0.0, 1.0);
  // Shadow at the card centre, nudged toward the Sun past the card's own caster.
#ifdef SHADOW_CASTER
  vSun = 1.0; // never sample the shadow map while rendering into it
#else
  vSun = sunShadow(c.xyz + uSunDir * 1.6, normalize(c.xyz - cc + 1e-4), 0.0);
#endif
  // Painted leaves are thin: light carries a long way through a crown, strongest at its rim.
  vGlow = vec4(vec3(exp(-0.22 * chord) * mix(0.6, 1.25, smoothstep(0.45, 0.95, crownDepth))), aTint.w * mix(0.55, 1.0, smoothstep(0.35, 0.85, crownDepth)));
}`;


const PREPASS_FRAG = /* glsl */ `
        uniform sampler2D tDabs;
        uniform float uForceOpaque;
        in vec2 vUv;
        void main() {
          float a = max(texture(tDabs, vUv).r, uForceOpaque);
#ifdef A2C
          if (uOverdraw > 0.5) { if (a < 0.5) discard; fragColor = vec4(1.0 / 255.0); return; }
          // Sharpen alpha to ~1 px so coverage is crisp but antialiased.
          a = clamp((a - 0.5) / max(fwidth(a), 1e-4) + 0.5, 0.0, 1.0);
          if (a <= 0.0) discard;
          fragColor = vec4(0.0, 0.0, 0.0, a);
#else
          if (a < 0.5) discard;
          fragColor = vec4(uOverdraw > 0.5 ? 1.0 / 255.0 : 0.0);
#endif
        }`;

const COLOR_FRAG = /* glsl */ `
        uniform sampler2D tDabs;
        uniform vec3 uLeafLit, uLeafMid, uLeafDeep, uLeafGlow, uNbMid;
        uniform float uGlowK;
        uniform vec3 uCamRight, uCamUp;
        uniform float uForceOpaque, uColorAlphaTest;
        in vec2 vUv;
        in vec3 vRel;
        in vec3 vSN;
        in vec4 vTint;
        flat in float vCell;
        in vec4 vGlow;
        flat in float vInst;
        in float vSun;
        void main() {
          vec4 t = texture(tDabs, vUv);
          t.r = max(t.r, uForceOpaque);
          if (uColorAlphaTest > 0.5 && t.r < 0.5) discard;
          float d = length(vRel);
          vec3 V = -vRel / d;
          float shell = vGlow.a;
          float ao = mix(0.5, 1.0, smoothstep(0.3, 1.0, shell));
          // Per-dab colour: variant mid colour, 12 % from the neighbouring variant,
          // hue +-8 deg and value +-12 % per dab, interiors deepen in colour (not grey).
          float id = fract(t.g + vTint.x + vInst);
          // One flat colour per dab; variation lives between dabs (hue +-12 deg, value +-20 %).
          vec3 alb = vTint.y < 0.12 ? uNbMid : uLeafMid;
          float sunFace = smoothstep(-0.15, 0.6, dot(vSN, uSunDir));
          alb = mix(alb, uLeafLit, saturate(sunFace * 0.75 + smoothstep(0.7, 1.0, shell) * 0.25));
          alb = oklabJitter(alb, (id - 0.5) * radians(24.0), 0.14 * cos(6.2831 * id * 2.0), (fract(id * 3.7) - 0.5) * 0.4);
          alb = mix(uLeafDeep, alb, mix(0.45, 1.0, ao));
          vec3 N = normalize(mix(vSN, V, 0.2));
          vec3 col = painterLight(alb, N, vSun, ao);
          if (uViewMode > 0.5) {
            // Foliage shade is burnt umber with its chroma kept, never crimson or black:
            // value floored at ~22 % of the sunlit leaf.
            float L = luma(col);
            float litL = luma(alb * uSunColor) * 0.6;
            float shadeW = 1.0 - smoothstep(0.0, 0.5, dot(N, uSunDir) + 0.2);
            vec3 umber = uLeafDeep / max(luma(uLeafDeep), 1e-4);
            float shellW2 = smoothstep(0.75, 1.0, shell);
            float floorL = litL * mix(0.3, 0.42, shellW2); // outer dabs never read as holes
            col = mix(col, umber * max(L, floorL), max(shadeW * 0.85, 1.0 - smoothstep(0.0, floorL * 1.4, L)));
            // Dark values lean to burnt umber (hue ~30 deg), never crimson.
            vec3 o = toOklab(col);
            float darkW = 1.0 - smoothstep(0.03, 0.16, luma(col));
            vec3 ou = toOklab(umber * luma(col));
            o.yz = mix(o.yz, ou.yz * (length(o.yz) / max(length(ou.yz), 1e-4)), darkW * 0.9);
            col = max(fromOklab(o), vec3(0.0));
          }
          // Backlight. (a) The whole crown transmits warm orange light (wide lobe): the body
          // stays orange. (b) Thin fringe dabs within ~25 deg of the Sun turn gold (narrow lobe).
          float mu = dot(-V, uSunDir);
          float shellW = smoothstep(0.6, 1.0, shell);
          float Es = luma(uSunColor) * uGlowK;
          float wide = hgPhase(mu, 0.3) / hgPhase(1.0, 0.3);
          float narrow = smoothstep(0.82, 0.98, mu);
          vec3 body = alb * 1.3 * Es * 0.35 * wide * vGlow.rgb;
          vec3 fringe = uLeafGlow * Es * 0.42 * narrow * vGlow.rgb * shellW * (0.5 + 0.5 * step(0.25, fract(id * 5.1)));
          fringe = chromaScale(fringe, 1.25); // saturated gold, not chalky cream
          col += (body + fringe) * mix(0.5, 1.0, painterK()) * mix(0.35, 1.0, vSun);
          col = applyAerial(col, vRel, d);
          if (uOverdraw > 0.5) { fragColor = vec4(1.0 / 255.0); return; }
          fragColor = sceneOut(col, d);
        }`;

const TRUNK_VERT = /* glsl */ `
        in vec4 aBark;
        out vec3 vRel;
        out vec3 vN;
        out vec4 vBark;
        void main() {
          mat4 M = modelMatrix * instanceMatrix;
          vec4 wp = M * vec4(position, 1.0);
          vRel = wp.xyz;
          vN = normalize(mat3(M) * normal);
          vBark = aBark;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`;

const TRUNK_FRAG = /* glsl */ `
        uniform sampler2D tBark;
        uniform vec3 uBarkLit, uBarkDark, uMossCol, uMossShade, uMossSide;
        in vec3 vRel;
        in vec3 vN;
        in vec4 vBark;
        void main() {
          float d = length(vRel);
          vec3 N = normalize(vN);
          vec3 V = -vRel / d;
          // Bark strokes in trunk space (metres): vertical, two scales cross-faded by distance.
          float s = log2(max(d * 0.06, 1.0));
          float k0 = floor(s); float fr = s - k0;
          vec2 buv = vec2(vBark.y, vBark.x); // texture U along the trunk -> vertical strokes
          vec4 b0 = texture(tBark, buv / (2.4 * exp2(k0)) * vec2(1.0, 2.5), 0.8);
          vec4 b1 = texture(tBark, buv / (2.4 * exp2(k0 + 1.0)) * vec2(1.0, 2.5) + 0.37, 0.8);
          vec4 b = mix(b0, b1, smoothstep(0.6, 1.0, fr));
          // Ochre where the Sun reaches, mauve on the shade side (a painter's bark).
          float sunSide = smoothstep(-0.25, 0.35, dot(N, uSunDir));
          vec3 alb = mix(uBarkDark, uBarkLit, sunSide);
          alb *= 0.85 + 0.3 * smoothstep(0.2, 0.8, b.r);
          alb = oklabJitter(alb, (b.a - 0.5) * radians(16.0), 0.15 * cos(6.2831 * b.a * 3.0), (fract(b.a * 5.3) - 0.5) * 0.4);
          // Moss at the base and on upward-facing limb tops.
          // Moss: the base and its shaded flank, limb tops and crotches.
          float flank = smoothstep(-0.2, 0.6, dot(N, uMossSide));
          float patchM = smoothstep(0.35, 0.65, vnoise(vBark.xy * vec2(2.0, 1.2) + 11.0));
          float moss = (1.0 - smoothstep(0.3, 0.7 + flank * 1.0, vBark.z)) * flank * (0.4 + 0.6 * patchM) * 1.5
                     + smoothstep(0.45, 0.85, N.y) * 0.7 * step(0.5, vBark.w) * patchM;
          alb = mix(alb, mix(uMossShade, uMossCol, sunSide), clamp(moss, 0.0, 0.9));
          vec3 bn = vec3(b.g, b.b, 0.0) * 2.0 - 1.0;
          vec3 Ns = normalize(N + 0.25 * (bn.x * normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-4) + bn.y * vec3(0.0, 1.0, 0.0)) * painterK());
          float sh = sunShadow(vRel, N, (b.r - 0.5) * 0.5);
          vec3 col = painterLight(alb, Ns, sh, mix(0.6, 1.0, smoothstep(0.0, 1.5, vBark.z)));
          // Shade side: cool mauve reflected light and warm chroma (never neutral black).
          // Warm light bounced from the sunlit ground keeps backlit trunks umber, not black.
          float shadeSide = saturate(0.3 - dot(N, uSunDir));
          col += alb * (uSkyHorizon * 0.12 + uGroundBounce * 0.9) * shadeSide * painterK();
          if (uViewMode > 0.5) {
            col = chromaScale(col, 1.0 + 0.35 * shadeSide);
            // Never neutral black: floor at a warm umber ~25 % of the sunlit bark value.
            float L = luma(col), litL = luma(uBarkLit * uSunColor) * 0.6;
            vec3 umber = vec3(0.034, 0.02, 0.01) / 0.0215;
            col = mix(col, umber * litL * 0.25, 1.0 - smoothstep(0.0, litL * 0.25, L));
          }
          // Gold rim when backlit, broken into strokes on the Sun side.
          float rim = pow(1.0 - saturate(abs(dot(N, V))), 4.0) * pow(saturate(dot(-V, uSunDir)), 2.0) * (vBark.w < 0.5 ? 1.0 : 0.15);
          rim *= smoothstep(0.3, 0.6, fract(b.a * 3.7)) * saturate(dot(N, normalize(uSunDir - V * dot(uSunDir, V))) * 2.0);
          col += uSunColor * vec3(1.0, 0.72, 0.2) * rim * 1.1 * painterK() * sh;
          col = applyAerial(col, vRel, d);
          if (uOverdraw > 0.5) { fragColor = vec4(1.0 / 255.0); return; }
          fragColor = sceneOut(col, d);
        }`;

function push(pool, d, i) {
  if (pool.n >= pool.cap) return; // fixed pool: farthest overflow is dropped
  pool.keys[pool.n] = d; pool.ids[pool.n] = i; pool.n++;
}

function pickWeighted(weights, u, variants, conifer) {
  // Deciduous and conifer groups are picked separately so conifers come in clumps.
  let total = 0;
  for (let i = 0; i < weights.length; i++) if ((variants[i].form === 'conifer') === conifer) total += weights[i];
  if (total <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    if ((variants[i].form === 'conifer') !== conifer) continue;
    acc += weights[i] / total;
    if (u < acc) return i;
  }
  for (let i = weights.length - 1; i >= 0; i--) if ((variants[i].form === 'conifer') === conifer) return i;
  return 0;
}

function crownOf(clusters) {
  const c = new THREE.Vector3();
  let w = 0;
  for (const k of clusters) { c.addScaledVector(k.c, k.r * k.r); w += k.r * k.r; }
  c.multiplyScalar(1 / w);
  let r = 0;
  for (const k of clusters) r = Math.max(r, k.c.distanceTo(c) + k.r);
  return new THREE.Vector4(c.x, c.y, c.z, r);
}

function buildTestCard() {
  const g = new THREE.BufferGeometry();
  const V = 8, pos = [], corner = [], cl = [], card = [], tint = [], idx = [];
  for (let i = 0; i < V; i++) {
    const a = (i / V) * Math.PI * 2 + Math.PI / 8;
    pos.push(0, 0, 0); corner.push(Math.cos(a) * 1.04, Math.sin(a) * 1.04);
    cl.push(0, 0, -1, 2); card.push(0, 0, 3, 0); tint.push(0.5, 0.5, 0.5, 1);
  }
  for (let i = 1; i < V - 1; i++) idx.push(0, i, i + 1);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setAttribute('aCluster', new THREE.Float32BufferAttribute(cl, 4));
  g.setAttribute('aCard', new THREE.Float32BufferAttribute(card, 4));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 4));
  g.setIndex(idx);
  return g;
}


/**
 * Forest: every variant in the world file is generated at startup (near and far
 * geometry), trees are placed from the forest density map (plus explicit placements),
 * and each frame the visible trees are binned by distance into fixed-size instance
 * pools: one InstancedMesh per variant per level of detail, written near -> far.
 *   near  (< ~45 m): full trunk + ~250 leaf cards (fades out 35-45 m by card rank)
 *   far   (35-230 m): simplified trunk + ~70 large dab cards (fades in 35-45 m, out 195-235 m)
 *   beyond: the painted canopy on the terrain (src/terrain/terrain.js).
 */
export class Trees {
  constructor(engine, hf) {
    const W = engine.world;
    const V = W.vegetation;
    this.engine = engine;
    this.hf = hf;
    this.samples = engine.caps.samples;
    this.lod = V.lod;
    const atlas = generateDabAtlas(V.atlasSize ?? 512, { seed: V.atlasSeed ?? 777 });
    this.atlas = atlas.tex;
    const bark = generateStrokeTexture(256, {
      seed: 99, normalStrength: 5,
      layers: [
        { count: 90, len: [0.35, 0.6], wid: [0.06, 0.09], amp: 0.6, jitterDeg: 5, crossFrac: 0 },
        { count: 220, len: [0.2, 0.4], wid: [0.035, 0.06], amp: 0.9, jitterDeg: 6, crossFrac: 0 },
      ],
    });
    this.bark = bark.tex;
    this.shared = {
      tDabs: { value: this.atlas },
      uRankCut: { value: 1.0 },
      uCamRight: { value: new THREE.Vector3() }, uCamUp: { value: new THREE.Vector3() },
      uForceOpaque: { value: 0 },
      uColorAlphaTest: { value: 0 },
    };
    this.meshes = [];
    this.colorMats = []; this.prepassMats = []; this.fadeUniforms = [];
    this.variants = V.variants.map((rec, vi) => this.buildVariant(W, V, rec, vi));
    this.place(W, V, hf);
    this._fwd = new THREE.Vector3();
    engine.onBeforeRender.push((cam) => {
      cam.matrixWorld.extractBasis(this.shared.uCamRight.value, this.shared.uCamUp.value, this._fwd);
    });
    this.frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();
  }

  buildVariant(W, V, rec, vi) {
    const seed = rec.seed ?? (11 + vi * 13);
    const tree = generateTree(rec, seed);
    const treeFar = generateTree(rec, seed, { simple: true });
    const cardOpts = { aspect: rec.cardAspect ?? 1, roll: rec.cardRoll ?? Math.PI };
    const near = buildCards(tree.clusters, rec.nearCards ?? 250, rec.cells ?? [0, 1, 2, 3, 4, 5, 6, 7], rec.cardSize ?? [1.0, 1.4], seed + 1, cardOpts);
    const far = buildCards(tree.clusters, rec.midCards ?? 70, rec.midCells ?? [8, 9, 10, 11, 12, 13, 14, 15], rec.midCardSize ?? [2.4, 3.2], seed + 2, { ...cardOpts, quads: true });
    const pal = rec.palette;
    const nb = V.variants[rec.neighbour ?? vi].palette;
    const L = this.lod;
    const per = {
      uLeafLit: { value: lin(pal.lit) }, uLeafMid: { value: lin(pal.mid) }, uLeafDeep: { value: lin(pal.interior) }, uLeafGlow: { value: lin(pal.glow) },
      uNbMid: { value: lin(nb.mid) },
      uGlowK: { value: rec.glow ?? 1.0 },
      uCrown: { value: crownOf(tree.clusters) },
      uCardScale: { value: 1.0 },
    };
    const nearFade = { uLodFade: { value: new THREE.Vector4(-1, 0, L.nearOut[0], L.nearOut[1]) } };
    const farFade = { uLodFade: { value: new THREE.Vector4(L.nearOut[0], L.nearOut[1], L.farOut[0], L.farOut[1]) } };
    const mk = (fade) => {
      const u = Object.assign({}, this.shared, per, fade);
      const pre = this.makePrepass(u);
      const col = this.makeColor(u);
      this.prepassMats.push(pre); this.colorMats.push(col);
      return { pre, col };
    };
    const mNear = mk(nearFade), mFar = mk(farFade);
    const trunkMat = this.makeTrunk(W, rec);
    const cap = { near: V.pool?.near ?? 48, far: V.pool?.far ?? 600 };
    const mkMesh = (geo, mat, n, order, shareFrom) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      if (shareFrom) m.instanceMatrix = shareFrom.instanceMatrix; // one buffer for both passes
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.visible = false; m.frustumCulled = false; m.renderOrder = order;
      this.engine.scene.add(m);
      this.engine.frame.anchor(m, 0, 0, 0);
      this.meshes.push(m);
      return m;
    };
    const trunkNear = mkMesh(tree.trunk, trunkMat, cap.near, 2);
    const trunkFar = mkMesh(treeFar.trunk, trunkMat, cap.far, 3);
    const preNear = mkMesh(near.geometry, mNear.pre, cap.near, 10, trunkNear);
    const colNear = mkMesh(near.geometry, mNear.col, cap.near, 20, trunkNear);
    const preFar = mkMesh(far.geometry, mFar.pre, cap.far, 11, trunkFar);
    const colFar = mkMesh(far.geometry, mFar.col, cap.far, 21, trunkFar);
    return {
      rec, tree, treeFar, farCards: far, per, height: tree.height, crownR: per.uCrown.value.w, crownY: per.uCrown.value.y,
      near: { meshes: [trunkNear, preNear, colNear], cap: cap.near, n: 0, keys: new Float64Array(cap.near), ids: new Int32Array(cap.near) },
      far: { meshes: [trunkFar, preFar, colFar], cap: cap.far, n: 0, keys: new Float64Array(cap.far), ids: new Int32Array(cap.far) },
    };
  }

  /** Forest placement from the density map: jittered grid, clumped species, keep-outs. */
  place(W, V, hf) {
    const F = V.forest;
    const rng = new Rng(F.seed ?? 3141);
    const list = [];
    const keepOut = (W.bookmarks || []).filter((b) => b.mode === 'walk').map((b) => [b.pos[0], b.pos[2], F.bookmarkClearance ?? 5]);
    for (const p of V.hero || []) {
      list.push({ x: p[0], z: p[1], yaw: p[2] ?? 0, s: p[3] ?? 1, v: p[4] ?? (V.heroVariant ?? 0) });
      keepOut.push([p[0], p[1], F.heroClearance ?? 7]);
    }
    const weights = V.variants.map((r) => r.weight ?? 1);
    const R = F.extent, cell = F.cell;
    const cand = [];
    for (let gz = -R; gz < R; gz += cell) {
      for (let gx = -R; gx < R; gx += cell) {
        const x = gx + rng.next() * cell, z = gz + rng.next() * cell;
        const d = hf.maskAt(x, z, 2);
        if (rng.next() > Math.pow(d, F.densityPower ?? 1.2)) continue;
        if (keepOut.some((k) => (k[0] - x) ** 2 + (k[1] - z) ** 2 < k[2] * k[2])) continue;
        // Species in clumps: a smooth field picks the variant, with some mixing.
        const c = 0.5 + 0.5 * gnoise(x / F.clumpScale, z / F.clumpScale, 99) + (rng.next() - 0.5) * (F.mix ?? 0.35);
        const conifer = gnoise(x / (F.clumpScale * 1.7) + 50, z / (F.clumpScale * 1.7), 7) > (F.coniferThreshold ?? 0.45);
        const v = pickWeighted(weights, Math.min(0.999, Math.max(0, c)), V.variants, conifer);
        // Age: a long tail of young trees, a few old giants; smaller where the forest thins.
        const age = Math.pow(rng.next(), 0.8);
        let s = (F.scale[0] + (F.scale[1] - F.scale[0]) * age) * (0.65 + 0.35 * Math.min(1, d / 0.7));
        // Old spreading trees close to the path lean over it.
        const pd = hf.pathDistance ? hf.pathDistance(x, z) : 1e9;
        if (pd < (F.pathGiants ?? 0)) s *= 1.15 + 0.25 * rng.next();
        const wr = rng.range(0.85, 1.25); // crown width : height variety
        cand.push({ x, z, yaw: rng.next() * Math.PI * 2, s, w: wr, v, r: rng.next() });
        // Trees grow in groups of 2-3 with uneven gaps.
        if (rng.next() < (F.groupChance ?? 0.35)) {
          const a = rng.next() * Math.PI * 2, rr = rng.range(2.5, 5);
          const x2 = x + Math.cos(a) * rr, z2 = z + Math.sin(a) * rr;
          if (hf.maskAt(x2, z2, 2) > 0.25) cand.push({ x: x2, z: z2, yaw: rng.next() * 6.28, s: s * rng.range(0.6, 0.95), w: rng.range(0.85, 1.25), v, r: rng.next() });
        }
        // Thin young pole trees between the mature ones.
        if (d > 0.5 && rng.next() < (F.poles ?? 0)) {
          const a = rng.next() * Math.PI * 2, rr = rng.range(2.5, 4.5);
          cand.push({ x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr, yaw: rng.next() * 6.28, s: rng.range(0.45, 0.7), w: rng.range(0.7, 0.95), v, r: rng.next() * 0.9 });
        }
        // Saplings and young crowns step the forest edge down.
        if (d > 0.12 && d < 0.55 && rng.next() < (F.saplings ?? 0.5)) {
          const a = rng.next() * Math.PI * 2, rr = rng.range(2, 4.5);
          cand.push({ x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr, yaw: rng.next() * 6.28, s: rng.range(0.4, 0.62), w: rng.range(0.9, 1.3), v, r: rng.next() * 0.8 });
        }
      }
    }
    // Cap the count by random selection (never by raster order).
    const room = Math.max(0, F.maxTrees - list.length);
    if (cand.length > room) cand.sort((a, b) => a.r - b.r);
    for (let i = 0; i < Math.min(room, cand.length); i++) list.push(cand[i]);
    this.candidates = cand.length;
    const n = list.length;
    this.count = n;
    this.tx = new Float32Array(n); this.ty = new Float32Array(n); this.tz = new Float32Array(n);
    this.tcos = new Float32Array(n); this.tsin = new Float32Array(n); this.ts = new Float32Array(n); this.tw = new Float32Array(n); this.tv = new Uint8Array(n);
    list.forEach((t, i) => {
      this.tx[i] = t.x; this.tz[i] = t.z; this.ty[i] = hf.heightAt(t.x, t.z) - 0.25;
      this.tcos[i] = Math.cos(t.yaw); this.tsin[i] = Math.sin(t.yaw); this.ts[i] = t.s; this.tw[i] = t.w ?? 1; this.tv[i] = t.v;
    });
  }

  update(ctx) {
    // Ease governor changes over ~1.5 s so canopies never pop.
    const u = this.shared.uRankCut;
    u.value += ((this.rankTarget ?? 1) - u.value) * Math.min(1, ctx.dt * 2);

    const cam = ctx.camera, f = ctx.frame;
    this._pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._pv);
    const cx = f.cam[0], cy = f.cam[1], cz = f.cam[2];
    const L = this.lod;
    const nearMax = L.nearOut[1], farMin = L.nearOut[0], farMax = L.farOut[1];
    const VR = this.variants;
    for (let v = 0; v < VR.length; v++) { VR[v].near.n = 0; VR[v].far.n = 0; }
    const sph = this._sphere;
    for (let i = 0; i < this.count; i++) {
      const vr = VR[this.tv[i]];
      const s = this.ts[i];
      const dx = this.tx[i] - cx, dz = this.tz[i] - cz;
      const dy = this.ty[i] + vr.crownY * s - cy;
      const d2 = dx * dx + dy * dy + dz * dz;
      const reach = farMax + vr.crownR * s;
      if (d2 > reach * reach) continue;
      sph.center.set(dx, dy, dz); sph.radius = (vr.crownR + 2) * s * 1.1;
      if (!this.frustum.intersectsSphere(sph)) continue;
      const d = Math.sqrt(d2);
      // Card fades use the card's own distance; add margin so the band is fully covered.
      if (d < nearMax + vr.crownR * s) push(vr.near, d, i);
      if (d > farMin - vr.crownR * s) push(vr.far, d, i);
    }
    for (let v = 0; v < VR.length; v++) { this.flush(VR[v].near); this.flush(VR[v].far); }
  }

  flush(pool) {
    const n = pool.n;
    // Insertion sort near -> far (small lists, no allocation).
    const k = pool.keys, id = pool.ids;
    for (let i = 1; i < n; i++) {
      const kk = k[i], ii = id[i];
      let j = i - 1;
      while (j >= 0 && k[j] > kk) { k[j + 1] = k[j]; id[j + 1] = id[j]; j--; }
      k[j + 1] = kk; id[j + 1] = ii;
    }
    const meshes = pool.meshes;
    const arr = meshes[0].instanceMatrix.array;
    for (let i = 0; i < n; i++) {
      const t = id[i], o = i * 16, s = this.ts[t], sw = s * this.tw[t], c = this.tcos[t] * sw, sn = this.tsin[t] * sw;
      arr[o] = c; arr[o + 1] = 0; arr[o + 2] = -sn; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = s; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = sn; arr[o + 9] = 0; arr[o + 10] = c; arr[o + 11] = 0;
      arr[o + 12] = this.tx[t]; arr[o + 13] = this.ty[t]; arr[o + 14] = this.tz[t]; arr[o + 15] = 1;
    }
    const im = meshes[0].instanceMatrix;
    im.clearUpdateRanges(); im.addUpdateRange(0, n * 16); im.needsUpdate = true;
    for (const m of meshes) { m.count = n; m.visible = n > 0; }
  }

  /** Shadow casters: per variant, the far trunk and the far leaf cards (alpha tested, facing
   *  the Sun because cards face whatever camera renders them), in the shadow scene. */
  initShadow(shadows) {
    this.shadows = shadows;
    const noFade = { uLodFade: { value: new THREE.Vector4(-1, 0, 1e6, 1e6 + 1) } };
    for (let v = 0; v < this.variants.length; v++) {
      const vr = this.variants[v];
      let n = 0;
      for (let i = 0; i < this.count; i++) if (this.tv[i] === v) n++;
      n = Math.max(1, n);
      const u = Object.assign({}, this.shared, vr.per, noFade, { uCardScale: { value: 0.72 } }); // smaller -> sun flecks through the crowns
      const cardMat = makeMaterial({
        name: 'shadow.cards', chunks: [GLSL_LIGHTING], uniforms: u, defines: { SHADOW_CASTER: 1 },
        vertex: CARD_VERT,
        fragment: /* glsl */ `
          uniform sampler2D tDabs;
          in vec2 vUv;
          void main() { if (texture(tDabs, vUv).r < 0.5) discard; fragColor = vec4(1.0); }`,
      });
      const trunkMat = makeMaterial({ name: 'shadow.trunk', chunks: [GLSL_LIGHTING], vertex: TRUNK_VERT, fragment: 'void main() { fragColor = vec4(1.0); }' });
      const trunk = new THREE.InstancedMesh(vr.treeFar.trunk, trunkMat, n);
      const cards = new THREE.InstancedMesh(vr.farCards.geometry, cardMat, n);
      cards.instanceMatrix = trunk.instanceMatrix;
      trunk.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (const m of [trunk, cards]) {
        m.count = 0;
        shadows.addCaster(m, 'both');
        this.engine.frame.anchor(m, 0, 0, 0);
      }
      vr.shadow = { trunk, cards, cap: n, ids: new Int32Array(n) };
    }
  }

  /** Fill the shadow casters with every tree within reach of a cascade (all directions). */
  fillShadow(cascade, radius) {
    if (!this.shadows) return;
    const f = this.engine.frame.cam;
    const reach = cascade === 0 ? radius + 60 : Math.min(radius, 320);
    const r2 = reach * reach;
    for (let v = 0; v < this.variants.length; v++) {
      const sh = this.variants[v].shadow;
      const arr = sh.trunk.instanceMatrix.array;
      let n = 0;
      for (let i = 0; i < this.count; i++) {
        if (this.tv[i] !== v) continue;
        const dx = this.tx[i] - f[0], dz = this.tz[i] - f[2];
        if (dx * dx + dz * dz > r2 || n >= sh.cap) continue;
        const o = n * 16, s = this.ts[i], sw = s * this.tw[i], c = this.tcos[i] * sw, sn = this.tsin[i] * sw;
        arr[o] = c; arr[o + 1] = 0; arr[o + 2] = -sn; arr[o + 3] = 0;
        arr[o + 4] = 0; arr[o + 5] = s; arr[o + 6] = 0; arr[o + 7] = 0;
        arr[o + 8] = sn; arr[o + 9] = 0; arr[o + 10] = c; arr[o + 11] = 0;
        arr[o + 12] = this.tx[i]; arr[o + 13] = this.ty[i]; arr[o + 14] = this.tz[i]; arr[o + 15] = 1;
        n++;
      }
      const im = sh.trunk.instanceMatrix;
      im.clearUpdateRanges(); im.addUpdateRange(0, n * 16); im.needsUpdate = true;
      sh.trunk.count = n; sh.cards.count = n;
      sh.trunk.visible = sh.cards.visible = n > 0;
    }
  }

  makePrepass(uniforms) {
    const a2c = this.samples > 0;
    const m = makeMaterial({
      name: 'canopy.prepass', chunks: [GLSL_LIGHTING], uniforms,
      colorWrite: false, alphaToCoverage: a2c, defines: a2c ? { A2C: 1 } : {},
      vertex: CARD_VERT, fragment: PREPASS_FRAG,
    });
    m.userData.prepass = true;
    return m;
  }

  makeColor(uniforms) {
    return makeMaterial({
      name: 'canopy.color', chunks: [GLSL_LIGHTING], uniforms,
      depthWrite: false, depthFunc: THREE.EqualDepth,
      vertex: CARD_VERT, fragment: COLOR_FRAG,
    });
  }

  makeTrunk(W, rec) {
    return makeMaterial({
      name: 'trunk', chunks: [GLSL_LIGHTING],
      uniforms: {
        tBark: { value: this.bark },
        uBarkLit: { value: lin(rec.bark?.base ?? '#8a6a50') }, uBarkDark: { value: lin(rec.bark?.dark ?? '#5a4a48') },
        uMossCol: { value: lin(rec.bark?.moss ?? W.ground.moss) }, uMossShade: { value: lin(rec.bark?.mossShade ?? '#4b5020') },
        uMossSide: { value: new THREE.Vector3(0.3, 0, -0.95).normalize() }, // north-facing flank
      },
      vertex: TRUNK_VERT, fragment: TRUNK_FRAG,
    });
  }

  /**
   * Startup self-test: draw one opaque card with the depth prepass and the EQUAL colour
   * pass into a tiny target with the scene's format and MSAA, read it back. If the colour
   * pass wrote nothing, this driver does not keep the two passes' depths identical: fall
   * back to a LESS-EQUAL colour pass with an alpha test (slower, always correct).
   */
  selfTest(renderer, caps) {
    // RGBA8 so readback is always allowed; invariance depends on depth, not the colour format.
    const rt = new THREE.WebGLRenderTarget(16, 16, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, samples: caps.samples, depthBuffer: true });
    const g = buildTestCard();
    const scene = new THREE.Scene();
    const pre = new THREE.InstancedMesh(g, this.prepassMats[0], 1);
    const col = new THREE.InstancedMesh(g, this.colorMats[0], 1);
    // Camera-relative convention: the camera stays at the origin, the card moves.
    const m = new THREE.Matrix4().makeTranslation(0, 0, -6);
    pre.setMatrixAt(0, m); col.setMatrixAt(0, m);
    pre.renderOrder = 0; col.renderOrder = 1;
    pre.frustumCulled = col.frustumCulled = false;
    scene.add(pre, col);
    const cam = new THREE.PerspectiveCamera(40, 1, 0.25, 100);
    cam.position.set(0, 0, 0); cam.lookAt(0, 0, -1); cam.updateMatrixWorld();
    this.shared.uForceOpaque.value = 1;
    const fadeU = this.colorMats[0].uniforms.uLodFade;
    const fade = fadeU.value.clone();
    fadeU.value.set(-1, 0, 1e5, 1e5 + 1);
    const px = new Uint8Array(16 * 16 * 4);
    const count = () => {
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
      renderer.setClearColor(0x000000, 1);
      renderer.readRenderTargetPixels(rt, 0, 0, 16, 16, px);
      let lit = 0;
      for (let i = 0; i < 16 * 16; i++) if (px[i * 4] !== 0 || px[i * 4 + 1] !== 0 || px[i * 4 + 2] !== 0) lit++;
      return lit;
    };
    let ok = true;
    try {
      // Reference: colour pass with depth test ALWAYS (must draw), then the real EQUAL pass.
      const cm = this.colorMats[0];
      const df = cm.depthFunc;
      cm.depthFunc = THREE.AlwaysDepth;
      const ref = count();
      cm.depthFunc = df;
      const lit = count();
      this.selfTestLit = [lit, ref];
      ok = ref < 16 || lit >= ref * 0.5; // inconclusive reference -> keep EQUAL
    } catch (e) {
      this.selfTestError = String(e);
    }
    this.shared.uForceOpaque.value = 0;
    fadeU.value.copy(fade);
    if (!ok) {
      for (const m of this.colorMats) m.depthFunc = THREE.LessEqualDepth;
      this.shared.uColorAlphaTest.value = 1;
      this.foliageFallback = true;
    }
    rt.dispose(); g.dispose();
    renderer.setRenderTarget(null);
    return ok;
  }

  applyQuality(state) {
    this.rankTarget = state.canopyQuads ?? 1;
  }
}
