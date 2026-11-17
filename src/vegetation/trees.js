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
uniform vec4 uCrown;     // whole-crown centre (tree-local) and radius
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
  // Governor thinning: cards above the rank cut shrink away smoothly; the rest grow a
  // little to keep the crown's coverage.
  size *= (1.0 - smoothstep(uRankCut - 0.06, uRankCut, aCard.w)) * mix(1.0, 1.3, 1.0 - uRankCut);
  vec4 mv = viewMatrix * c;
  float cr = cos(aCard.y), sr = sin(aCard.y);
  vec2 off = mat2(cr, sr, -sr, cr) * aCorner * (0.5 * size);
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  vec2 cell = vec2(mod(aCard.x, 4.0), floor(aCard.x / 4.0));
  vUv = (cell + 0.5 + aCorner * 0.47) * 0.25;
  vRel = c.xyz;
  // Normal: cluster sphere blended with the whole crown, so clusters merge into one
  // lit mass with a shaded underside instead of separate cotton balls.
  vec3 crownC = (M * vec4(uCrown.xyz, 1.0)).xyz;
  vec3 crownN = normalize(c.xyz - crownC + 1e-4);
  vSN = normalize(mix(normalize(c.xyz - cc + 1e-4), crownN, 0.35));
  vTint = aTint;
  vCell = aCard.x;
  // Transmission through the cluster toward the Sun (per card).
  vec3 pc = c.xyz - cc;
  float b = dot(pc, uSunDir);
  float q = dot(pc, pc) - R * R;
  float chord = max(0.0, -b + sqrt(max(b * b - q, 0.0)));
  float crownDepth = clamp(length(c.xyz - crownC) / (uCrown.w * sc), 0.0, 1.0);
  // Painted leaves are thin: light carries a long way through a crown, strongest at its rim.
  vGlow = vec4(vec3(exp(-0.22 * chord) * mix(0.6, 1.25, smoothstep(0.45, 0.95, crownDepth))), aTint.w * mix(0.55, 1.0, smoothstep(0.35, 0.85, crownDepth)));
}`;

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
      uForceOpaque: { value: 0 }, // self-test: treat dabs as opaque
      uCrown: { value: crownOf(tree.clusters) },
      uColorAlphaTest: { value: 0 }, // fallback when EQUAL depth is unreliable on a driver
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
        uniform float uForceOpaque, uColorAlphaTest;
        in vec2 vUv;
        in vec3 vRel;
        in vec3 vSN;
        in vec4 vTint;
        flat in float vCell;
        in vec4 vGlow;
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
          float id = fract(t.g + vTint.x);
          // One flat colour per dab; variation lives between dabs (hue +-12 deg, value +-20 %).
          vec3 alb = vTint.y < 0.12 ? uNbMid : uLeafMid;
          float sunFace = smoothstep(-0.15, 0.6, dot(vSN, uSunDir));
          alb = mix(alb, uLeafLit, saturate(sunFace * 0.75 + smoothstep(0.7, 1.0, shell) * 0.25));
          alb = oklabJitter(alb, (id - 0.5) * radians(24.0), 0.14 * cos(6.2831 * id * 2.0), (fract(id * 3.7) - 0.5) * 0.4);
          alb = mix(uLeafDeep, alb, mix(0.45, 1.0, ao));
          vec3 N = normalize(mix(vSN, V, 0.2));
          vec3 col = painterLight(alb, N, 1.0, ao);
          if (uViewMode > 0.5) {
            // Foliage shade is burnt umber with its chroma kept, never crimson or black:
            // value floored at ~22 % of the sunlit leaf.
            float L = luma(col);
            float litL = luma(alb * uSunColor) * 0.6;
            float shadeW = 1.0 - smoothstep(0.0, 0.5, dot(N, uSunDir) + 0.2);
            vec3 umber = uLeafDeep / max(luma(uLeafDeep), 1e-4);
            col = mix(col, umber * max(L, litL * 0.22), max(shadeW * 0.85, 1.0 - smoothstep(0.0, litL * 0.3, L)));
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
          col += (body + fringe) * mix(0.5, 1.0, painterK());
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
        uMossCol: { value: lin(rec.bark?.moss ?? W.ground.moss) }, uMossShade: { value: lin(rec.bark?.mossShade ?? '#4b5020') }, uMossSide: { value: new THREE.Vector3(0.3, 0, -0.95).normalize() }, // north-facing flank
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
          vec3 col = painterLight(alb, Ns, 1.0, mix(0.6, 1.0, smoothstep(0.0, 1.5, vBark.z)));
          // Shade side: cool mauve reflected light and warm chroma (never neutral black).
          // Warm light bounced from the sunlit ground keeps backlit trunks umber, not black.
          float shadeSide = saturate(0.3 - dot(N, uSunDir));
          col += alb * (uSkyHorizon * 0.08 + uGroundBounce * 0.55) * shadeSide * painterK();
          if (uViewMode > 0.5) col = chromaScale(col, 1.0 + 0.35 * shadeSide);
          // Gold rim when backlit, broken into strokes on the Sun side.
          float rim = pow(1.0 - saturate(abs(dot(N, V))), 4.0) * pow(saturate(dot(-V, uSunDir)), 2.0) * (vBark.w < 0.5 ? 1.0 : 0.15);
          rim *= smoothstep(0.3, 0.6, fract(b.a * 3.7)) * saturate(dot(N, normalize(uSunDir - V * dot(uSunDir, V))) * 2.0);
          col += uSunColor * vec3(1.0, 0.72, 0.2) * rim * 1.1 * painterK();
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
    const pre = new THREE.InstancedMesh(g, this.materials.prepass, 1);
    const col = new THREE.InstancedMesh(g, this.materials.color, 1);
    // Camera-relative convention: the camera stays at the origin, the card moves.
    const m = new THREE.Matrix4().makeTranslation(0, 0, -6);
    pre.setMatrixAt(0, m); col.setMatrixAt(0, m);
    pre.renderOrder = 0; col.renderOrder = 1;
    pre.frustumCulled = col.frustumCulled = false;
    scene.add(pre, col);
    const cam = new THREE.PerspectiveCamera(40, 1, 0.25, 100);
    cam.position.set(0, 0, 0); cam.lookAt(0, 0, -1); cam.updateMatrixWorld();
    this.uniforms.uForceOpaque.value = 1;
    const fade = this.uniforms.uLodFade.value.clone();
    this.uniforms.uLodFade.value.set(-1, 0, 1e5, 1e5 + 1);
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
      const df = this.materials.color.depthFunc;
      this.materials.color.depthFunc = THREE.AlwaysDepth;
      const ref = count();
      this.materials.color.depthFunc = df;
      const lit = count();
      this.selfTestLit = [lit, ref];
      ok = ref < 16 || lit >= ref * 0.5; // inconclusive reference -> keep EQUAL
    } catch (e) {
      this.selfTestError = String(e);
    }
    this.uniforms.uForceOpaque.value = 0;
    this.uniforms.uLodFade.value.copy(fade);
    if (!ok) {
      this.materials.color.depthFunc = THREE.LessEqualDepth;
      this.uniforms.uColorAlphaTest.value = 1;
      this.foliageFallback = true;
    }
    rt.dispose(); g.dispose();
    renderer.setRenderTarget(null);
    return ok;
  }

  applyQuality(state) {
    this.rankTarget = state.canopyQuads ?? 1;
    if (this.uniforms.uRankCut.value === undefined) this.uniforms.uRankCut.value = this.rankTarget;
  }

  update(ctx) {
    // Ease governor changes over ~1.5 s so canopies never pop.
    const u = this.uniforms.uRankCut;
    const t = this.rankTarget ?? 1;
    u.value += (t - u.value) * Math.min(1, ctx.dt * 2);
  }
}
