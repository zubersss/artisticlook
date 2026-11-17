// CDLOD terrain (Strugar 2009): a quadtree over ±16 km selects chunks per frame;
// two shared grid meshes (16x16 full chunks, 8x8 quarter chunks) are drawn
// instanced. Vertices morph toward the coarser grid near each LOD range, so there
// are no cracks and no popping. Heights are vertex-fetched (manual bilinear on
// R32F with texelFetch: float32 linear filtering is not guaranteed on mobile).
import * as THREE from 'three';
import { makeMaterial, G } from '../shaders/common.js';
import { GLSL_LIGHTING } from '../shaders/lighting.js';
import { GLSL_BRUSH } from '../brushwork/brush.js';
import { NEAR, FAR, BLEND } from './heightfield.js';
import { lin } from '../core/color.js';

const LEVELS = 12; // leaf 16 m ... root 32768 m
const LEAF = 16;
const ROOT = LEAF * 2 ** (LEVELS - 1);
const MAX_INST = 640;

function gridGeometry(cells) {
  const g = new THREE.InstancedBufferGeometry();
  const n = cells + 1;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = (j * n + i) * 3; pos[k] = i; pos[k + 1] = 0; pos[k + 2] = j; }
  const idx = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    // Alternate the diagonal for a more isotropic mesh.
    if ((i + j) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  const inst = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INST * 4), 4);
  inst.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aChunk', inst);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

/** 64-texel weighted palette (nearest filtering): a uniform pick is a weighted pick. */
function paletteTexture(hexes, weights) {
  const n = 64;
  const w = weights || hexes.map(() => 1);
  const total = w.reduce((a, b) => a + b, 0);
  const data = new Uint8Array(n * 4);
  // Contiguous runs: a smooth pick value then yields large same-species masses (clumps).
  const order = [];
  hexes.forEach((h, i) => { const c = Math.max(1, Math.round((w[i] / total) * n)); for (let k = 0; k < c; k++) order.push({ i }); });
  for (let t = 0; t < n; t++) {
    const h = parseInt(hexes[order[Math.min(order.length - 1, t)].i].replace('#', ''), 16);
    data[t * 4] = (h >> 16) & 255; data[t * 4 + 1] = (h >> 8) & 255; data[t * 4 + 2] = h & 255; data[t * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace; // sampled as linear light
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export const GLSL_TERRAIN_HEIGHT = /* glsl */ `
uniform highp sampler2D uHNear;
uniform highp sampler2D uHFar;
uniform vec4 uNear; // origin, origin, spacing, N
uniform vec4 uFar;
uniform vec2 uBlend;
float fetchH(highp sampler2D tex, vec4 g, vec2 xz) {
  vec2 f = (xz - g.xy) / g.z;
  ivec2 c = ivec2(clamp(floor(f), vec2(0.0), vec2(g.w - 2.0)));
  vec2 t = clamp(f - vec2(c), 0.0, 1.0);
  float a = texelFetch(tex, c, 0).r, b = texelFetch(tex, c + ivec2(1, 0), 0).r;
  float e = texelFetch(tex, c + ivec2(0, 1), 0).r, d = texelFetch(tex, c + ivec2(1, 1), 0).r;
  return mix(mix(a, b, t.x), mix(e, d, t.x), t.y);
}
float nearWeight(vec2 xz) { return 1.0 - smoothstep(uBlend.x, uBlend.y, max(abs(xz.x), abs(xz.y))); }
float terrainHeight(vec2 xz) {
  float w = nearWeight(xz);
  float hf = fetchH(uHFar, uFar, xz);
  if (w <= 0.0) return hf;
  return mix(hf, fetchH(uHNear, uNear, xz), w);
}
`;

export class Terrain {
  constructor(engine, hf) {
    this.engine = engine;
    this.hf = hf;
    const W = engine.world;
    const mkTex = (data, N, format, type, filter) => {
      const t = new THREE.DataTexture(data, N, N, format, type);
      t.magFilter = filter; t.minFilter = filter === THREE.LinearFilter ? THREE.LinearMipmapLinearFilter : filter;
      t.generateMipmaps = filter === THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };
    this.tex = {
      hNear: mkTex(hf.near, NEAR.N, THREE.RedFormat, THREE.FloatType, THREE.NearestFilter),
      hFar: mkTex(hf.far, FAR.N, THREE.RedFormat, THREE.FloatType, THREE.NearestFilter),
      nNear: mkTex(hf.nearNormal, NEAR.N, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter),
      nFar: mkTex(hf.farNormal, FAR.N, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter),
      mNear: mkTex(hf.nearMask, NEAR.N, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter),
      mFar: mkTex(hf.farMask, FAR.N, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter),
      flow: mkTex(hf.flow, hf.flowN, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter),
    };
    this.tex.nNear.anisotropy = this.tex.mNear.anisotropy = Math.min(4, engine.caps.anisotropy);

    // LOD ranges and morph windows.
    this.ranges = new Float64Array(LEVELS);
    const r0 = W.terrain.lodRange ?? 48;
    for (let l = 0; l < LEVELS; l++) this.ranges[l] = r0 * 2 ** l;
    const morph = [];
    for (let l = 0; l < LEVELS; l++) morph.push(new THREE.Vector2(this.ranges[l] * 0.68, this.ranges[l] * 0.96));

    const Gd = W.ground;
    this.uniforms = {
      uHNear: { value: this.tex.hNear }, uHFar: { value: this.tex.hFar },
      uNNear: { value: this.tex.nNear }, uNFar: { value: this.tex.nFar },
      uMNear: { value: this.tex.mNear }, uMFar: { value: this.tex.mFar }, uFlow: { value: this.tex.flow },
      uNear: { value: new THREE.Vector4(NEAR.origin, NEAR.origin, NEAR.spacing, NEAR.N) },
      uFar: { value: new THREE.Vector4(FAR.origin, FAR.origin, FAR.spacing, FAR.N) },
      uBlend: { value: new THREE.Vector2(BLEND[0], BLEND[1]) },
      uMorph: { value: morph },
      uCamLocal: { value: new THREE.Vector3() },
      uGrassSun: { value: lin(Gd.sunGrass) }, uGrassShade: { value: lin(Gd.shadeGrass) }, uGrassDry: { value: lin(Gd.dryGrass) },
      uLitter: { value: lin(Gd.litter) }, uLitterDark: { value: lin(Gd.litterDark) },
      uPathCol: { value: lin(Gd.path) }, uPathFleck: { value: lin(Gd.pathFleck) }, uPathDark: { value: lin(Gd.pathDark || Gd.path) },
      uCanopyAvg: { value: lin(Gd.canopyAvg || '#b8782e') },
      uGrassAccent: { value: lin(Gd.grassAccent || Gd.sunGrass) },
      uMoss: { value: lin(Gd.moss) }, uRock: { value: lin(Gd.rock) },
      uFields: { value: lin(Gd.farFields || Gd.dryGrass) }, uRidge: { value: lin(Gd.ridge || Gd.rock) },
      uWet: { value: lin(Gd.wet || '#3a3326') },
      uCanopyPal: { value: paletteTexture(W.ground.farForest, W.ground.farForestWeights) },
      uCanopyGap: { value: lin(Gd.canopyGap || '#4a2814') },
      uCanopyFade: { value: new THREE.Vector2(...(W.vegetation?.canopyFade ?? [150, 260])) },
      uCanopyLift: { value: W.vegetation?.canopyLift ?? 0 },
      uTreeExtent: { value: W.vegetation?.forest?.extent ?? 1e6 },
      uMNearV: { value: this.tex.mNear }, uMFarV: { value: this.tex.mFar },
      uGroundMix: { value: new THREE.Vector4(Gd.meadowGrass ?? 1, Gd.rockSlope ?? 0.55, Gd.canopyFar ?? 1, 0) },
    };
    this.mat = this.makeTerrainMaterial(16);
    this.matQ = this.makeTerrainMaterial(8);
    this.geoFull = gridGeometry(16);
    this.geoQuarter = gridGeometry(8);
    this.meshFull = new THREE.Mesh(this.geoFull, this.mat);
    this.meshQuarter = new THREE.Mesh(this.geoQuarter, this.matQ);
    for (const m of [this.meshFull, this.meshQuarter]) {
      m.frustumCulled = false;
      m.renderOrder = 0;
      engine.scene.add(m);
      engine.frame.anchor(m, 0, 0, 0);
    }
    this.instFull = this.geoFull.attributes.aChunk;
    this.instQuarter = this.geoQuarter.attributes.aChunk;
    this.nFull = 0; this.nQuarter = 0;

    this.mmIndex = new Map();
    this.mmData = new Float32Array(2 * 200000);
    this.mmCount = 0;
    this._mm = new Float32Array(2);
    this.frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this.cam = new Float64Array(3);
  }

  makeTerrainMaterial(cells) {
    return makeMaterial({
      name: 'terrain',
      chunks: [GLSL_LIGHTING, GLSL_TERRAIN_HEIGHT],
      fragChunks: [GLSL_BRUSH],
      uniforms: Object.assign({}, this.uniforms, { uCells: { value: cells } }),
      vertex: /* glsl */ `
        in vec4 aChunk; // x, z, size, level
        uniform vec2 uMorph[${LEVELS}];
        uniform vec2 uCanopyFade;
        uniform float uCanopyLift;
        uniform float uTreeExtent;
        uniform sampler2D uMNearV;
        uniform sampler2D uMFarV;
        uniform vec3 uCamLocal;
        uniform float uCells;
        out vec3 vRel;
        out vec3 vLocal;
        void main() {
          vec2 grid = position.xz;
          float sp = aChunk.z / uCells;
          vec2 xz = aChunk.xy + grid * sp;
          float h0 = terrainHeight(xz);
          float dist = distance(vec3(xz.x, h0, xz.y), uCamLocal);
          vec2 mr = uMorph[int(aChunk.w + 0.5)];
          float k = clamp((dist - mr.x) / (mr.y - mr.x), 0.0, 1.0);
          grid -= fract(grid * 0.5) * 2.0 * k;
          xz = aChunk.xy + grid * sp;
          float h = terrainHeight(xz);
          // Beyond the 3D trees the forest is painted on the ground, raised to crown height so
          // distant silhouettes keep the forest's volume.
          float lift = max(smoothstep(uCanopyFade.x, uCanopyFade.y, dist), smoothstep(uTreeExtent, uTreeExtent + 15.0, max(abs(xz.x), abs(xz.y)))) * uCanopyLift;
          if (lift > 0.0) {
            float fw = nearWeight(xz);
            vec2 uvF = ((xz - uFar.xy) / uFar.z + 0.5) / uFar.w;
            vec2 uvN = ((xz - uNear.xy) / uNear.z + 0.5) / uNear.w;
            float fd = mix(textureLod(uMFarV, uvF, 0.0).b, textureLod(uMNearV, uvN, 0.0).b, fw);
            h += lift * smoothstep(0.2, 0.55, fd);
          }
          vLocal = vec3(xz.x, h, xz.y);
          vec4 wp = modelMatrix * vec4(vLocal, 1.0);
          vRel = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragment: /* glsl */ `
        uniform sampler2D uNNear;
        uniform sampler2D uNFar;
        uniform sampler2D uMNear;
        uniform sampler2D uMFar;
        uniform sampler2D uFlow;
        uniform vec3 uGrassSun, uGrassShade, uGrassDry, uLitter, uLitterDark, uPathCol, uPathFleck, uPathDark, uMoss, uRock, uFields, uRidge, uWet, uCanopyGap, uCanopyAvg, uGrassAccent;
        uniform sampler2D uCanopyPal;
        uniform vec4 uGroundMix;
        uniform vec2 uCanopyFade;
        uniform float uTreeExtent;
        in vec3 vRel;
        in vec3 vLocal;


        // One lattice of painted crowns (cell size in metres): lobed, domed crowns in stands,
        // dark-saturated shade side, gold fringe toward the Sun, warm gaps between.
        void paintedCrowns(vec2 p, float cs, float forest, float clump, vec3 N, vec3 groundAlb, vec2 rdir, float stretch,
                           inout vec3 outCol, inout vec3 outN, inout float outAO) {
          vec2 g = p / cs;
          vec2 cell = floor(g);
          vec2 o = step(0.5, g - cell) - 1.0;
          float best = 1e9; vec2 bc = vec2(0.0); uint bh = 0u; float br = 1.0;
          for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
            vec2 cc = cell + o + vec2(float(i), float(j));
            uint h = hashU2(uvec2(ivec2(cc) + 1048576 + int(cs)));
            vec2 jit = vec2(float(h & 255u), float((h >> 8) & 255u)) * (1.0 / 255.0);
            vec2 ctr = (cc + 0.2 + 0.6 * jit) * cs;
            float r = cs * (0.38 + 0.5 * float((h >> 16) & 255u) / 255.0);
            vec2 dv = p - ctr;
            float lob = 1.0 + 0.16 * cos(atan(dv.y, dv.x) * 5.0 + float(h & 63u));
            // Seen at a grazing angle a dome stands up: elongate toward the viewer so the
            // crown reads round on screen instead of a flat dash.
            float rad = dot(dv, rdir);
            vec2 dvs = dv - rdir * rad * (1.0 - 1.0 / stretch);
            float dd = length(dvs) / (r * lob);
            if (dd < best) { best = dd; bc = ctr; bh = h; br = r * lob; }
          }
          // Species in stands (30-80 m) from a smooth field; greens as separate stands.
          float pick = fract(clump * 1.7 + (hashF(bh) - 0.5) * 0.08);
          vec3 crown = texelFetch(uCanopyPal, ivec2(int(pick * 0.78 * 63.99), 0), 0).rgb;
          vec2 cc2 = bc * (1.0 / 48.0);
          float greenA = vnoise(cc2 + 77.0) * 0.8 + hashF(bh ^ 0x1234567u) * 0.2;
          float greenB = vnoise(cc2 * 1.3 + 151.0) * 0.8 + hashF(bh ^ 0x7654321u) * 0.2;
          if (greenA > 0.64) crown = texelFetch(uCanopyPal, ivec2(63, 0), 0).rgb;
          else if (greenB > 0.68) crown = texelFetch(uCanopyPal, ivec2(54, 0), 0).rgb;
          crown *= 0.88 + 0.24 * hashF(bh ^ 0x68e31da4u);
          vec2 q = (p - bc) / br;
          // Meadow strips between stands; single crowns can stand in the meadow.
          float exists = step(hashF(bh ^ 0x2545f491u), smoothstep(0.3, 0.8, forest + (vnoise(bc * 0.02 + 5.0) - 0.5) * 0.7));
          float aw = max(0.2, fwidth(best) * 1.5);
          float inside = (1.0 - smoothstep(1.0 - aw, 1.0, best)) * exists;
          float z = sqrt(max(0.0, 1.0 - dot(q, q)));
          vec3 Ns = normalize(N * 0.6 + vec3(q.x, z, q.y));
          float lit = smoothstep(-0.2, 0.9, dot(Ns, uSunDir) + 0.3);
          crown = mix(chromaScale(crown * vec3(0.6, 0.5, 0.42), 1.15), crown, lit);
          float sunward = saturate(dot(normalize(q + 1e-4), normalize(uSunDir.xz + 1e-4)));
          crown = mix(crown, uGlowHue * luma(crown) * 1.8, sunward * smoothstep(0.45, 0.95, best) * 0.6);
          // Gaps are the canopy's own shadow, not the forest floor.
          vec3 gapCol = mix(groundAlb, mix(uCanopyGap, crown * vec3(0.55, 0.48, 0.42), 0.5), smoothstep(0.35, 0.75, forest) * exists);
          outCol = mix(gapCol, crown, inside);
          outN = normalize(mix(N, Ns, inside));
          outAO = mix(0.7, mix(0.8, 1.0, z), inside);
        }
        vec2 gridUv(vec4 g, vec2 xz) { return ((xz - g.xy) / g.z + 0.5) / g.w; }
        vec3 decodeN(vec4 t) { vec2 xz = t.rg * 2.0 - 1.0; return normalize(vec3(xz.x, max(0.05, 1.0 - dot(xz, xz)), xz.y)); }

        void main() {
          float dist = length(vRel);
          vec2 xz = vLocal.xz;
          float w = nearWeight(xz);
          vec2 uvN = gridUv(uNear, xz), uvF = gridUv(uFar, xz);
          vec3 N = decodeN(texture(uNFar, uvF));
          vec4 mf = texture(uMFar, uvF);
          vec4 m = vec4(0.0, 0.0, mf.b, 0.0);
          if (w > 0.0) {
            N = normalize(mix(N, decodeN(texture(uNNear, uvN)), w));
            m = mix(m, texture(uMNear, uvN), w);
          }
          vec3 wp = vRel + uCamWrapped; // world-anchored coordinates (wrap-safe)
          float pathM = m.r, wetM = m.g, forest = m.b, meadow = m.a;
          float slope = 1.0 - N.y;

          // --- ground albedo (stage 2: flat painted colour fields; strokes arrive in stage 3).
          // All world-anchored noise uses power-of-two scales (wrap-period rule).
          vec4 n1 = vnoise4(wp.xz * 0.125);
          vec4 n2 = vnoise4(wp.xz * (1.0 / 32.0) + 31.0);
          float dry = smoothstep(0.35, 0.75, n2.r * 0.7 + n1.g * 0.3);
          vec3 grass = mix(uGrassSun, uGrassDry, dry * 0.5);
          // Greener, cooler patches (damp hollows, clover) break the yellow field.
          grass = mix(grass, uGrassShade, smoothstep(0.45, 0.85, n2.g * 0.75 + n1.b * 0.25) * 0.55);
          vec3 litter = mix(uLitter, uLitterDark, smoothstep(0.3, 0.8, n1.b));
          float litterW = smoothstep(0.25, 0.7, forest + (n1.r - 0.5) * 0.35);
          vec3 alb = mix(grass, litter, litterW);
          // Mossy, rocky steep ground.
          alb = mix(alb, mix(uMoss, uRock, smoothstep(0.5, 0.8, n1.a)), smoothstep(uGroundMix.y, uGroundMix.y + 0.2, slope));
          // Path: warm ochre with fallen-leaf flecks.
          // Fallen leaves on the path: a broad warm mottling (individual leaf dabs come from strokes).
          vec3 pathC = mix(uPathCol, uPathFleck, smoothstep(0.45, 0.8, vnoise(wp.xz * 0.5)) * 0.55);
          float farPath = smoothstep(60.0, 300.0, dist);
          alb = mix(alb, mix(pathC, uPathCol * 1.25, farPath), smoothstep(mix(0.15, 0.03, farPath), mix(0.7, 0.3, farPath), pathM));
          // Stream bed and wet banks.
          alb = mix(alb, uWet, smoothstep(0.2, 0.9, wetM) * 0.85);
          // Open country beyond the near grid: meadows and fields.
          float farW = 1.0 - w;
          alb = mix(alb, mix(uFields, uGrassDry, smoothstep(0.3, 0.7, vnoise(wp.xz * (1.0 / 256.0)))), farW * (1.0 - smoothstep(0.2, 0.5, forest)));

          // Forest seen from beyond ~200 m becomes a painted canopy (trees are drawn
          // nearer than that): individual lit crowns on a jittered 8 m lattice, species
          // in clumps, deep umber gaps; detail fades to the averaged colour far away.
          // Painted canopy beyond the 3D trees' range from the camera, and outside the area that
          // has 3D trees at all.
          float outside = smoothstep(uTreeExtent, uTreeExtent + 15.0, max(abs(xz.x), abs(xz.y)));
          float canopyW = max(smoothstep(uCanopyFade.x, uCanopyFade.y, dist), outside) * smoothstep(0.2, 0.55, forest) * uGroundMix.z;
          float cAO = 1.0;
          if (canopyW > 0.0) {
            vec3 Nc = N;
            float clump = vnoise(wp.xz * (1.0 / 32.0)) * 0.55 + vnoise(wp.xz * (1.0 / 128.0) + 7.0) * 0.9;
            // Far away: one averaged autumn colour, gently modulated (no hard species zones).
            vec3 can = oklabJitter(uCanopyAvg, (clump - 0.7) * radians(18.0), 0.0, (vnoise(wp.xz * (1.0 / 64.0) + 3.0) - 0.5) * 0.16);
            float crownAO = 0.62;
            // Two lattices of painted crowns: single trees (8 m) near, stands of crowns
            // (22 m) farther away, so crowns stay ~1-2 % of the screen at any distance.
            float wNear = 1.0 - smoothstep(450.0, 850.0, dist);
            float wFar = smoothstep(450.0, 850.0, dist) * (1.0 - smoothstep(3000.0, 5500.0, dist));
            vec3 cA = can, cB = can; vec3 nA = N, nB = N; float aoA = crownAO, aoB = crownAO;
            vec2 rdir = normalize(vRel.xz + 1e-4);
            float stretch = clamp(1.0 / max(abs(dot(vRel / dist, N)), 0.05), 1.0, 2.5);
            if (wNear > 0.0) paintedCrowns(wp.xz, 8.0, forest, clump, N, alb, rdir, stretch, cA, nA, aoA);
            if (wFar > 0.0) paintedCrowns(wp.xz, 22.0, forest, clump, N, alb, rdir, stretch, cB, nB, aoB);
            float wSum = wNear + wFar;
            if (wSum > 0.0) {
              vec3 cc = (cA * wNear + cB * wFar) / wSum;
              can = mix(can, cc, min(1.0, wSum));
              Nc = normalize(mix(N, normalize(nA * wNear + nB * wFar + 1e-4), min(1.0, wSum)));
              crownAO = mix(crownAO, (aoA * wNear + aoB * wFar) / wSum, min(1.0, wSum));
            } else {
              can = mix(can, uCanopyGap, 0.22);
            }
            alb = mix(alb, can, canopyW);
            N = normalize(mix(N, Nc, canopyW));
            cAO = mix(1.0, crownAO, canopyW);
          }
          // Beyond ~4 km the land is painted as a mauve mass (planes, not detail); the
          // aerial perspective then walks it toward the cool distance hue.
          alb = mix(alb, uRidge, smoothstep(3500.0, 9000.0, dist) * 0.6);

          float ao = (1.0 - 0.35 * forest * (1.0 - canopyW)) * cAO;
          vec3 Ns = N;
          float strokeFleck = 0.0, strokeH = 0.5, sheenW = 0.0;
          if (uViewMode > 1.5) {
            // Stroke direction: flow field near (contours, path, stream, meadow swirl),
            // contours from the normal far away; random per stroke in leaf litter.
            float thetaFar = atan(N.x, -N.z);
            float theta = thetaFar, rnd = 0.0;
            if (w > 0.0) {
              vec4 fl = texture(uFlow, uvN);
              vec2 dv = fl.xy * 2.0 - 1.0;
              float tn = 0.5 * atan(dv.y, dv.x);
              theta = w > 0.5 ? tn : thetaFar;
              rnd = fl.z * w;
            }
            float jitter = mix(radians(40.0), radians(360.0), rnd);
            jitter = mix(jitter, radians(16.0), smoothstep(0.3, 0.7, pathM)); // calm strokes across the path
            BrushOut b = brushSample(vRel.xz, dist, theta, jitter, abs(dot(vRel / dist, N)));
            strokeH = b.h;
            // Broken colour per stroke, plus broad colour zones (32 m).
            float hueJ = mix(16.0, 22.0, max(litterW * (1.0 - canopyW), smoothstep(0.2, 0.7, pathM)));
            // Path: calm earth in broad strokes across it; fallen leaves (~10 %, more in 4 m
            // sun pools) as gold-orange ovals that drift onto the grass at the edges.
            float pools = smoothstep(0.45, 0.75, vnoise(wp.xz * 0.25 + 19.0));
            float leafSel = step(1.0 - mix(0.07, 0.22, pools), fract(b.id * 3.31 + 0.17));
            float pathEdge = smoothstep(0.42, 0.5, pathM + (b.h - 0.5) * 0.25);
            vec3 pathPaint = mix(uPathDark, uPathCol * 1.25, farPath);
            alb = mix(alb, pathPaint, pathEdge * smoothstep(0.1, 0.4, pathM));
            float strayLeaf = step(0.985, fract(b.id * 5.17 + 0.3)) * (1.0 - litterW) * smoothstep(0.0, 0.2, pathM + 0.1);
            alb = mix(alb, uPathFleck * 1.15, max(leafSel * pathEdge, strayLeaf) * (1.0 - farPath));
            alb = brokenColor(alb, b.id, hueJ * 1.4, 0.22, 0.2);
            // Patch-scale light and dark (4 m and 16 m): lit and shaded families in the grass.
            float patchV = (vnoise(wp.xz * 0.25 + 7.0) - 0.5) * 0.7 + (vnoise(wp.xz * 0.0625 + 3.0) - 0.5) * 0.5;
            alb *= 1.0 + patchV * 0.45;
            // Layering by stroke: ~18 % of strokes are the dark shaded-green underlayer,
            // ~7 % are bright gold accents laid on top (grass only).
            float grassW = (1.0 - litterW) * (1.0 - pathEdge) * (1.0 - canopyW) * (1.0 - wetM);
            float under = step(fract(b.id * 7.77 + 0.13), 0.18);
            float accent = step(0.93, fract(b.id * 2.39 + 0.61));
            alb = mix(alb, uGrassShade * 0.62, under * grassW * 0.85);
            alb = mix(alb, uGrassAccent, accent * grassW * 0.8);
            // Thin paint at stroke ends shows a little of the darker layer (no hard seams).
            alb = mix(alb * vec3(0.8, 0.84, 0.76), alb, smoothstep(0.0, 0.3, b.h));
            // Colour zones at two scales (32 m and 8 m): neighbouring strokes share a family.
            vec2 zn = vnoise4(wp.xz * (1.0 / 32.0) + 91.0).xy - 0.5;
            vec2 zn2 = vnoise4(wp.xz * 0.125 + 47.0).zw - 0.5;
            alb = oklabJitter(alb, zn.x * radians(12.0) + zn2.x * radians(10.0), zn2.y * 0.25, zn.y * 0.14 + zn2.y * 0.08);
            // ~2 % of strokes borrow a neighbouring material: fallen leaves in grass.
            // (borrowing happens before lighting; flecks after it)
            float borrow = smoothstep(0.925, 0.932, b.id) * (1.0 - smoothstep(0.94, 0.945, b.id));
            alb = mix(alb, uPathFleck * 1.1, borrow * (1.0 - litterW) * (1.0 - canopyW) * 0.8);
            Ns = normalize(N + 0.2 * uPainter.w * vec3(b.nWorld.x, 0.0, b.nWorld.y));
            ao *= 0.94 + 0.06 * b.h;
            strokeFleck = smoothstep(0.895, 0.905, b.id); // ~5 % of strokes once blended
            sheenW = smoothstep(0.55, 0.85, b.h) * saturate(1.0 - (b.lod - 1.0) / 3.0);
          }
          // Sun shadow (cascades), with the stroke's paint height brushing the edge.
          float sh = mix(sunShadow(vRel, N, strokeH - 0.5), 1.0, canopyW);
          vec3 col = painterLight(alb, Ns, sh, ao);
          if (uViewMode > 1.5) {
            // Flecks: dark blue-green shadow strokes in shade; warm lit dabs (and a few cool
            // sky notes) in light.
            float litE = saturate(dot(N, uSunDir) * 2.5);
            vec3 sh = uShadowHue / max(luma(uShadowHue), 1e-4) * luma(col) * 0.6;
            sh = mix(sh, vec3(0.06, 0.12, 0.1) * luma(col) * 4.0, 0.5);
            float coolNote = step(0.97, fract(strokeH * 7.3 + 0.5));
            vec3 sk = mix(uGlowHue / max(luma(uGlowHue), 1e-4) * luma(col) * 1.35,
                          uSkyZenith / max(luma(uSkyZenith), 1e-4) * luma(col), coolNote);
            col = mix(col, mix(sh, sk, litE), strokeFleck * 0.55);
            // Faint sheen on stroke ridges toward the Sun (strongest at grazing backlight).
            vec3 V = -vRel / dist;
            vec3 Hh = normalize(uSunDir + V);
            float F = 0.04 + 0.96 * pow(1.0 - saturate(dot(V, Ns)), 5.0);
            col += uSunColor * 0.08 * F * pow(saturate(dot(Ns, Hh)), 20.0) * sheenW * sh;
          }
          col = applyAerial(col, vRel, dist);
          if (uOverdraw > 0.5) { fragColor = vec4(1.0 / 255.0); return; }
          fragColor = sceneOut(col, dist);
        }`,
    });
  }

  // ---- quadtree selection
  minMax(level, i, j, x, z, size) {
    const key = level * 4194304 + j * 2048 + i;
    let k = this.mmIndex.get(key);
    if (k === undefined) {
      this.hf.minMax(x, z, size, this._mm);
      k = this.mmCount++;
      if (k * 2 + 1 >= this.mmData.length) { this.mmCount = 0; this.mmIndex.clear(); k = this.mmCount++; }
      this.mmData[k * 2] = this._mm[0]; this.mmData[k * 2 + 1] = this._mm[1];
      this.mmIndex.set(key, k);
    }
    return k;
  }

  sphereHitsBox(r, x, z, size, k) {
    const c = this.cam;
    const y0 = this.mmData[k * 2], y1 = this.mmData[k * 2 + 1];
    const dx = c[0] < x ? x - c[0] : c[0] > x + size ? c[0] - x - size : 0;
    const dz = c[2] < z ? z - c[2] : c[2] > z + size ? c[2] - z - size : 0;
    const dy = c[1] < y0 ? y0 - c[1] : c[1] > y1 ? c[1] - y1 : 0;
    return dx * dx + dy * dy + dz * dz < r * r;
  }

  inFrustum(x, z, size, k) {
    const c = this.cam;
    this._box.min.set(x - c[0], this.mmData[k * 2] - c[1], z - c[2]);
    this._box.max.set(x + size - c[0], this.mmData[k * 2 + 1] - c[1], z + size - c[2]);
    return this.frustum.intersectsBox(this._box);
  }

  emit(attr, n, x, z, size, level) {
    if (n >= MAX_INST) return n;
    const a = attr.array, o = n * 4;
    a[o] = x; a[o + 1] = z; a[o + 2] = size; a[o + 3] = level;
    return n + 1;
  }

  select(x, z, size, level, i, j) {
    const k = this.minMax(level, i, j, x, z, size);
    if (!this.sphereHitsBox(this.ranges[level], x, z, size, k)) return false;
    if (!this.inFrustum(x, z, size, k)) return true;
    if (level === 0 || !this.sphereHitsBox(this.ranges[level - 1], x, z, size, k)) {
      this.nFull = this.emit(this.instFull, this.nFull, x, z, size, level);
      return true;
    }
    const h = size / 2;
    for (let q = 0; q < 4; q++) {
      const ci = i * 2 + (q & 1), cj = j * 2 + (q >> 1);
      const cx = x + (q & 1) * h, cz = z + (q >> 1) * h;
      if (!this.select(cx, cz, h, level - 1, ci, cj)) this.nQuarter = this.emit(this.instQuarter, this.nQuarter, cx, cz, h, level);
    }
    return true;
  }

  update(ctx) {
    const f = ctx.frame;
    this.cam[0] = f.cam[0]; this.cam[1] = f.cam[1]; this.cam[2] = f.cam[2];
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    this._pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._pv);
    this.nFull = 0; this.nQuarter = 0;
    if (!this.select(-ROOT / 2, -ROOT / 2, ROOT, LEVELS - 1, 0, 0)) {
      this.nFull = this.emit(this.instFull, 0, -ROOT / 2, -ROOT / 2, ROOT, LEVELS - 1);
    }
    this.geoFull.instanceCount = this.nFull;
    this.geoQuarter.instanceCount = this.nQuarter;
    this.instFull.clearUpdateRanges(); this.instFull.addUpdateRange(0, this.nFull * 4); this.instFull.needsUpdate = true;
    this.instQuarter.clearUpdateRanges(); this.instQuarter.addUpdateRange(0, this.nQuarter * 4); this.instQuarter.needsUpdate = true;
    this.uniforms.uCamLocal.value.set(f.cam[0], f.cam[1], f.cam[2]);
  }
}

export { G };
