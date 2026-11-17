// Sky dome: drawn last as a full-screen triangle at the far plane (early-Z skips
// covered pixels). LUT sky, limb-darkened Sun, painted strokes anchored to view
// direction. Clouds and the Moon are added in stage 7.
import * as THREE from 'three';
import { G, makeMaterial } from '../shaders/common.js';
import { GLSL_LIGHTING } from '../shaders/lighting.js';
import { Atmosphere } from './atmosphere.js';
import { lin } from '../core/color.js';

export class Sky {
  constructor(engine) {
    const W = engine.world;
    this.engine = engine;
    this.atmo = new Atmosphere(W.atmosphere);
    this.lutTex = Atmosphere.makeTexture();
    G.uSkyLut.value = this.lutTex;
    this.cache = new Map(); // time index -> computed lighting (precomputed at load)
    this.mat = makeMaterial({
      name: 'sky',
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      chunks: [GLSL_LIGHTING],
      uniforms: {
        uInvViewProj: { value: new THREE.Matrix4() },
        uSunDisk: { value: new THREE.Vector3() },
        uSunCos: { value: Math.cos(THREE.MathUtils.degToRad(W.astronomy.sunAngularRadiusDeg * 1.6)) },
        tExposure: { value: null },
        uDiscDisplay: { value: 3 },
      },
      vertex: /* glsl */ `
        uniform mat4 uInvViewProj;
        uniform sampler2D tExposure;
        out vec3 vDir;
        flat out float vInvExpo;
        void main() {
          vInvExpo = exp2(-textureLod(tExposure, vec2(0.5), 0.0).r);
          vec4 p = uInvViewProj * vec4(position.xy, 1.0, 1.0);
          vDir = p.xyz / p.w;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }`,
      fragment: /* glsl */ `
        uniform vec3 uSunDisk;
        uniform float uSunCos;
        uniform float uDiscDisplay;
        uniform sampler2D uStroke;
        in vec3 vDir;
        flat in float vInvExpo;
        void main() {
          vec3 d = normalize(vDir);
          vec3 c = paintSky(skyLut(d), d);
          float k = painterK();
          if (k > 0.5) {
            // Broad soft strokes anchored to view direction: horizontal near the horizon,
            // tilting diagonally higher up (stroke texture in direction space).
            float el = asin(clamp(d.y, -1.0, 1.0));
            float az = atan(d.x, -d.z);
            float tilt = smoothstep(0.1, 0.9, el) * 0.6;
            vec2 sp = vec2(az * cos(el), el) * vec2(2.2, 2.2);
            sp = mat2(cos(tilt), sin(tilt), -sin(tilt), cos(tilt)) * sp;
            vec4 st = textureLod(uStroke, sp, 1.5);
            float str = (st.r - 0.5) * 0.6 + (st.a - 0.5) * 0.5;
            c *= 1.0 + str * uSkyPaint.x;
            c = chromaScale(c, 1.0 + str * uSkyPaint.x * 2.5);
          }
          // Sun disk with limb darkening and a soft painted edge.
          float mu = dot(d, uSunDir);
          float r = clamp((1.0 - mu) / (1.0 - uSunCos), 0.0, 4.0);
          float disk = 1.0 - smoothstep(0.75, 1.0, r);
          float limb = 1.0 - 0.45 * (1.0 - sqrt(max(0.0, 1.0 - min(r, 1.0) * min(r, 1.0))));
          if (k > 0.5) {
            // Painted Sun: a cream disc at a fixed display value, never a white hole.
            vec3 cream = uSkyHues[2] / max(luma(uSkyHues[2]), 1e-4);
            vec3 target = cream * uDiscDisplay * vInvExpo * limb;
            c = mix(c, max(c, target), disk);
          } else {
            c += uSunDisk * disk * limb;
          }
          if (uOverdraw > 0.5) { fragColor = vec4(1.0 / 255.0); return; }
          fragColor = sceneOut(c, 65000.0);
        }`,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, 3, -1, 1, -1, 3, 1]), 3));
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000; // after everything opaque: only uncovered pixels shade
    engine.scene.add(this.mesh);
    engine.onBeforeRender.push((cam) => {
      this.mat.uniforms.uInvViewProj.value.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
      const post = engine.post;
      if (post.expo) this.mat.uniforms.tExposure.value = post.expo[post.expoIndex].texture;
    });

    // Painter / fog uniforms from the world file (shared via G-like objects on this material).
    const P = W.painter, F = W.fog;
    lin(P.sunWarmth, 1, G.uSunWarm.value);
    const S = W.sky;
    G.uSkyPaint.value.set(S.strokes, S.compress ?? 0.7, S.lift ?? 1, S.hueBlend ?? 0.6);
    lin(S.zenithHue, 1, G.uSkyHues.value[0]); lin(S.horizonHue, 1, G.uSkyHues.value[1]);
    lin(S.nearSunHue, 1, G.uSkyHues.value[2]); lin(S.horizonCream, 1, G.uSkyHues.value[3]);
    G.uSkyHalo.value = S.haloCos ?? 0.85;
    lin(S.haloSkirt ?? '#e2c4b4', 1, G.uSkyPeach.value);
    G.uSunChroma.value = P.sunChroma ?? 1;
    this.mat.uniforms.uDiscDisplay.value = S.discDisplay ?? 3;
    G.uAtmo.value.set(0, 1600, P.distanceMix ?? 0.5, P.chromaKeep ?? 0.85);
    G.uAtmo2.value.set(0.035, 0.8, 0, 0);
    lin(P.shadowHue, 1, G.uShadowHue.value);
    lin(P.distanceHue, 1, G.uDistanceHue.value);
    lin(P.glowHue, 1, G.uGlowHue.value);
    G.uPainter.value.set(P.shadowFill, P.aerialScale, P.castShadowLift ?? 0, P.strokeStrength);
    G.uFog.value.set(F.hazeDensity, 1 / F.hazeHeight, F.hazeMaxDepth ?? 1.2, F.hazeG);
    G.uFog2.value.set(F.glow, F.hazeGlow, 0, 0);
    G.uAtmo.value.x = F.aerialExtinction;
    G.uAtmo.value.y = F.aerialScaleHeight;
    G.uAtmo2.value.y = F.glowG;
    const hz = lin(F.hazeColor);
    G.uHazeColor.value.copy(hz).multiplyScalar(1 / Math.max(1e-4, 0.2126 * hz.x + 0.7152 * hz.y + 0.0722 * hz.z));
  }

  /** Precompute the lighting for every time-of-day preset (behind the loading screen). */
  precompute(skyStates) {
    skyStates.forEach((s, i) => this.cache.set(i, this.atmo.compute(s.sun, 200)));
  }

  onSkyChange(state, index) {
    let r = this.cache.get(index);
    if (!r) { r = this.atmo.compute(state.sun, 200); this.cache.set(index, r); }
    Atmosphere.upload(this.lutTex, r.lut);
    // Painted-sky reference: compressed + lifted luminance of the horizon away from the Sun.
    const S = this.engine.world.sky;
    const L = r.horizonAway;
    G.uSkyRef.value = Math.pow(L, S.compress ?? 0.6) * Math.pow(0.6, 1 - (S.compress ?? 0.6)) * (S.lift ?? 1) * (S.refScale ?? 1);
    G.uSunColor.value.fromArray(r.sunColor);
    G.uSkyZenith.value.fromArray(r.skyZenith);
    G.uSkyHorizon.value.fromArray(r.skyHorizon);
    G.uGroundBounce.value.fromArray(r.groundBounce);
    // The disk is kept below fp16 range; bloom supplies the glare.
    const s = Math.min(1, 4000 / Math.max(...r.sunDiskColor)) * 60;
    this.mat.uniforms.uSunDisk.value.set(r.sunDiskColor[0] * s, r.sunDiskColor[1] * s, r.sunDiskColor[2] * s);
  }
}
