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

const CARD_VERT = /* glsl */ `
invariant gl_Position;
in vec2 aCorner;
in vec4 aCluster;
in vec4 aCard;   // cell, roll, size, rank
in vec4 aTint;   // random, random, random, shell depth (r / R)
uniform float uRankCut;
uniform vec4 uLodFade;  // x in-start, y in-end, z out-start, w out-end (m)
uniform float uCardScale;
out vec2 vUv;
out vec3 vRel;
out vec3 vSN;            // sphere normal (world)
out vec4 vTint;
flat out float vCell;
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
  if (aCard.w > uRankCut) size = 0.0;
  vec4 mv = viewMatrix * c;
  float cr = cos(aCard.y), sr = sin(aCard.y);
  vec2 off = mat2(cr, sr, -sr, cr) * aCorner * (0.5 * size);
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  vec2 cell = vec2(mod(aCard.x, 4.0), floor(aCard.x / 4.0));
  vUv = (cell + 0.5 + aCorner * 0.47) * 0.25;
  vRel = c.xyz;
  vSN = normalize(c.xyz - cc + 1e-4);
  vTint = aTint;
  vCell = aCard.x;
  // Transmission through the cluster toward the Sun (per card).
  vec3 pc = c.xyz - cc;
  float b = dot(pc, uSunDir);
  float q = dot(pc, pc) - R * R;
  float chord = max(0.0, -b + sqrt(max(b * b - q, 0.0)));
  vGlow = vec4(vec3(exp(-0.4 * chord)), aTint.w);
}`;

export class Trees {
  constructor(engine, hf) {
    const W = engine.world;
    const V = W.vegetation;
    this.engine = engine;
    this.hf = hf;
    this.samples = engine.caps.samples;
    const atlas = generateDabAtlas(V.atlasSize ?? 512, { seed: V.atlasSeed ?? 777 });
    this.atlas = atlas.tex;
    const bark = generateStrokeTexture(256, {
      seed: 99, normalStrength: 5,
      layers: [
        { count: 90, len: [0.35, 0.6], wid: [0.06, 0.09], amp: 0.6, jitterDeg: 5, crossFrac: 0 },
        { count: 220, len: [0.2, 0.4], wid: [0.035, 0.06], amp: 0.9, jitterDeg: 6, crossFrac: 0 },
      ],
    });
    // Bark strokes run vertically: the generator draws along U, so rotate in the shader.
    this.bark = bark.tex;
    this.variants = [];
    this.meshes = [];
    const recipes = V.variants;
    const placements = V.hero || [];
    // Stage 4: the hero variant only, instanced at its placements.
    const vi = V.heroVariant ?? 0;
    const rec = recipes[vi];
    const tree = generateTree(rec, rec.seed ?? 11);
    const cards = buildCards(tree.clusters, rec.nearCards ?? 250, rec.cells ?? [0, 1, 2, 3, 4, 5, 6, 7], rec.cardSize ?? [1.1, 1.5], (rec.seed ?? 11) + 1);
    this.tree = tree; this.cards = cards;
    const pal = rec.palette;
    const nb = recipes[rec.neighbour ?? vi].palette;
    const uniforms = {
      tDabs: { value: this.atlas },
      uRankCut: { value: 1.0 },
      uLodFade: { value: new THREE.Vector4(-1, 0, 1e5, 1e5 + 1) },
      uCardScale: { value: 1.0 },
      uLeafLit: { value: lin(pal.lit) }, uLeafMid: { value: lin(pal.mid) }, uLeafDeep: { value: lin(pal.interior) }, uLeafGlow: { value: lin(pal.glow) },
      uNbMid: { value: lin(nb.mid) },
      uGlowK: { value: rec.glow ?? 1.0 },
      uCamRight: { value: new THREE.Vector3() }, uCamUp: { value: new THREE.Vector3() },
    };
    this.uniforms = uniforms;
    const a2c = this.samples > 0;
    const prepass = makeMaterial({
      name: 'canopy.prepass',
      chunks: [GLSL_LIGHTING],
      uniforms,
      colorWrite: false,
      alphaToCoverage: a2c,
      defines: a2c ? { A2C: 1 } : {},
      vertex: CARD_VERT,
      fragment: /* glsl */ `
        uniform sampler2D tDabs;
        in vec2 vUv;
        void main() {
          float a = texture(tDabs, vUv).r;
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
        }`,
    });
    const color = makeMaterial({
      name: 'canopy.color',
      chunks: [GLSL_LIGHTING],
      uniforms,
      depthWrite: false,
      depthFunc: THREE.EqualDepth,
      vertex: CARD_VERT,
      fragment: /* glsl */ `
        uniform sampler2D tDabs;
        uniform vec3 uLeafLit, uLeafMid, uLeafDeep, uLeafGlow, uNbMid;
        uniform float uGlowK;
        uniform vec3 uCamRight, uCamUp;
        in vec2 vUv;
        in vec3 vRel;
        in vec3 vSN;
        in vec4 vTint;
        flat in float vCell;
        in vec4 vGlow;
        float phaseLeaf(float mu) {
          float a = hgPhase(mu, 0.7) / hgPhase(1.0, 0.7);
          float b = hgPhase(mu, 0.25) / hgPhase(1.0, 0.25);
          return 0.5 * a + 0.5 * b;
        }
        void main() {
          vec4 t = texture(tDabs, vUv);
          float d = length(vRel);
          vec3 V = -vRel / d;
          float shell = vGlow.a;
          float ao = mix(0.5, 1.0, smoothstep(0.3, 1.0, shell));
          // Per-dab colour: variant mid colour, 12 % from the neighbouring variant,
          // hue +-8 deg and value +-12 % per dab, interiors deepen in colour (not grey).
          float id = fract(t.g + vTint.x);
          vec3 alb = vTint.y < 0.12 ? uNbMid : uLeafMid;
          alb = mix(alb, uLeafLit, smoothstep(0.55, 1.0, shell) * 0.5);
          alb = oklabJitter(alb, (id - 0.5) * radians(16.0), 0.1 * cos(6.2831 * id * 2.0), (fract(id * 3.7) - 0.5) * 0.24);
          alb = mix(uLeafDeep, alb, mix(0.35, 1.0, ao));
          // Soft volume normal: cluster sphere, a little toward the viewer, plus dab relief.
          float dhx = dFdx(t.a), dhy = dFdy(t.a);
          vec3 N = normalize(mix(vSN, V, 0.2) - (dhx * uCamRight + dhy * uCamUp) * 3.0);
          vec3 col = painterLight(alb, N, 1.0, ao);
          // Backlit glow: strongest effect of the references. Thin edges glow most.
          float mu = dot(-V, uSunDir);
          float edge = 1.0 - t.b;
          vec3 glow = luma(uSunColor) * uLeafGlow * uGlowK * phaseLeaf(mu) * vGlow.rgb * mix(0.7, 1.2, edge);
          col += glow * mix(0.5, 1.0, painterK());
          col = applyAerial(col, vRel, d);
          if (uOverdraw > 0.5) { fragColor = vec4(1.0 / 255.0); return; }
          fragColor = sceneOut(col, d);
        }`,
    });
    const trunkMat = makeMaterial({
      name: 'trunk',
      chunks: [GLSL_LIGHTING],
      uniforms: {
        tBark: { value: this.bark },
        uBarkLit: { value: lin(rec.bark?.base ?? '#8a6a50') }, uBarkDark: { value: lin(rec.bark?.dark ?? '#5a4a48') },
        uMossCol: { value: lin(W.ground.moss) },
      },
      vertex: /* glsl */ `
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
        }`,
      fragment: /* glsl */ `
        uniform sampler2D tBark;
        uniform vec3 uBarkLit, uBarkDark, uMossCol;
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
          vec4 b0 = texture(tBark, buv / (1.6 * exp2(k0)));
          vec4 b1 = texture(tBark, buv / (1.6 * exp2(k0 + 1.0)) + 0.37);
          vec4 b = mix(b0, b1, smoothstep(0.6, 1.0, fr));
          vec3 alb = mix(uBarkDark, uBarkLit, smoothstep(0.2, 0.8, b.r));
          alb = oklabJitter(alb, (b.a - 0.5) * radians(10.0), 0.15 * cos(6.2831 * b.a * 3.0), (b.a - 0.5) * 0.18);
          // Moss at the base and on upward-facing limb tops.
          float moss = (1.0 - smoothstep(0.3, 1.3, vBark.z)) * (0.6 + 0.4 * b.r) + smoothstep(0.55, 0.9, N.y) * 0.6 * step(0.5, vBark.w);
          alb = mix(alb, uMossCol, clamp(moss, 0.0, 0.85));
          vec3 bn = vec3(b.g, b.b, 0.0) * 2.0 - 1.0;
          vec3 Ns = normalize(N + 0.25 * (bn.x * normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-4) + bn.y * vec3(0.0, 1.0, 0.0)) * painterK());
          vec3 col = painterLight(alb, Ns, 1.0, mix(0.6, 1.0, smoothstep(0.0, 1.5, vBark.z)));
          // Gold rim when backlit.
          float rim = pow(1.0 - saturate(abs(dot(N, V))), 3.0) * pow(saturate(dot(-V, uSunDir)), 2.0);
          col += uSunColor * uGlowHue * rim * 0.6 * painterK();
          col = applyAerial(col, vRel, d);
          if (uOverdraw > 0.5) { fragColor = vec4(1.0 / 255.0); return; }
          fragColor = sceneOut(col, d);
        }`,
    });
    prepass.userData.prepass = true;
    this.materials = { prepass, color, trunk: trunkMat };

    const n = Math.max(1, placements.length);
    const trunkMesh = new THREE.InstancedMesh(tree.trunk, trunkMat, n);
    const preMesh = new THREE.InstancedMesh(cards.geometry, prepass, n);
    const colMesh = new THREE.InstancedMesh(cards.geometry, color, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    placements.forEach((p, i) => {
      const y = hf.heightAt(p[0], p[1]) - 0.25;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p[2] ?? 0);
      const s = p[3] ?? 1;
      sc.set(s, s, s);
      m4.compose(new THREE.Vector3(p[0], y, p[1]), q, sc);
      for (const m of [trunkMesh, preMesh, colMesh]) m.setMatrixAt(i, m4);
    });
    trunkMesh.renderOrder = 2; preMesh.renderOrder = 10; colMesh.renderOrder = 20;
    for (const m of [trunkMesh, preMesh, colMesh]) {
      m.count = placements.length;
      m.frustumCulled = false;
      m.instanceMatrix.needsUpdate = true;
      engine.scene.add(m);
      engine.frame.anchor(m, 0, 0, 0);
      this.meshes.push(m);
    }
    engine.onBeforeRender.push((cam) => {
      cam.matrixWorld.extractBasis(uniforms.uCamRight.value, uniforms.uCamUp.value, this._fwd || (this._fwd = new THREE.Vector3()));
    });
  }

  applyQuality(state) {
    this.uniforms.uRankCut.value = state.canopyQuads ?? 1;
  }
}
