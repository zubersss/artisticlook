// Post-processing: quarter-res bloom chain that the light shafts share, a 1x1
// slow auto-exposure, and ONE combined final pass at canvas resolution
// (exposure, bloom+shafts, grade, filmic tone map, view-anchored distance warp,
// sharpened upscale, canvas weave, vignette, dither).
//
// Scene target: allocated at the exact internal size (re-allocated only when the
// governor changes resolution level, which is rare), because three.js resolves the
// whole allocation every frame. Preferred format RGBA16F with view distance in
// alpha (no depth resolve; MSAA may resolve on-tile). Fallback R11G11B10F + a
// resolved depth texture; last resort RGBA8 with a compression curve.
// The small bloom targets are allocated at max size and use viewport sub-rects.
//
// Passes: prefilter(1/4) -> down(1/8) -> down(1/16) -> exposure(1x1) -> up(1/8, additive)
//         -> up+shafts(1/4, separate target) -> final.
import * as THREE from 'three';
import { G, GLSL_COMMON, GLOBAL_DEFINES } from '../shaders/common.js';

const FS_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

function fsMaterial(name, fragment, uniforms, defines = {}, vertex = FS_VERT) {
  return new THREE.ShaderMaterial({
    name,
    glslVersion: THREE.GLSL3,
    uniforms: Object.assign({}, G, uniforms),
    defines: Object.assign({}, GLOBAL_DEFINES, defines),
    vertexShader: 'precision highp float;\nprecision highp int;\n' + GLSL_COMMON + vertex,
    fragmentShader: 'precision highp float;\nprecision highp int;\nlayout(location = 0) out highp vec4 fragColor;\nin vec2 vUv;\n' + GLSL_COMMON + fragment,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

// Shared: view distance of the scene at a uv (alpha channel, or the depth texture fallback).
const SCENE_DIST = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 uNearFar;
float sceneDistAt(vec2 uv, vec4 texel) {
#ifdef DIST_FROM_DEPTH
  float z = texture(tDepth, uv).r;
  if (z >= 0.999999) return 65000.0;
  float n = uNearFar.x, f = uNearFar.y;
  return 2.0 * n * f / (f + n - (2.0 * z - 1.0) * (f - n));
#else
  return decodeDist(texel.a);
#endif
}`;

// --- Prefilter: full-res HDR -> quarter res. RGB = karis-weighted colour, A = shaft source.
const PREFILTER = SCENE_DIST + /* glsl */ `
uniform vec2 uSunUv;
uniform float uSunVisible;
uniform vec4 uSrcTexel; // xy = full-res texel size
void main() {
  vec2 o = uSrcTexel.xy;
  vec2 uv = vUv;
  vec4 ta = texture(tScene, uv + vec2(-o.x, -o.y)), tb = texture(tScene, uv + vec2(o.x, -o.y));
  vec4 tc = texture(tScene, uv + vec2(-o.x, o.y)), td = texture(tScene, uv + vec2(o.x, o.y));
  vec3 a = decodeHDR(ta.rgb), b = decodeHDR(tb.rgb), c = decodeHDR(tc.rgb), d = decodeHDR(td.rgb);
  float wa = 1.0 / (1.0 + luma(a)), wb = 1.0 / (1.0 + luma(b)), wc = 1.0 / (1.0 + luma(c)), wd = 1.0 / (1.0 + luma(d));
  vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  // Shaft source: bright sky (and very far haze) near the Sun.
  float sky = 0.25 * (step(20000.0, sceneDistAt(uv + vec2(-o.x, -o.y), ta)) + step(20000.0, sceneDistAt(uv + vec2(o.x, -o.y), tb))
                    + step(20000.0, sceneDistAt(uv + vec2(-o.x, o.y), tc)) + step(20000.0, sceneDistAt(uv + vec2(o.x, o.y), td)));
  vec2 dsun = (vUv - uSunUv) * vec2(uResolution.x / uResolution.y, 1.0);
  float near = exp(-dot(dsun, dsun) * 5.0);
  float shaft = sky * min(luma(col), 30.0) * near * uSunVisible;
  fragColor = vec4(encodeHDR(col), shaft);
}`;

// --- Dual-filter downsample (5 taps); alpha carried along.
const DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec4 uSrc; // xy uv max of the valid sub-rect, zw texel
vec3 t(vec2 uv) { return decodeHDR(texture(tSrc, clamp(uv, uSrc.zw * 0.5, uSrc.xy - uSrc.zw * 0.5)).rgb); }
void main() {
  vec2 uv = vUv * uSrc.xy;
  vec2 h = uSrc.zw;
  vec3 s = t(uv) * 4.0 + t(uv - h) + t(uv + h) + t(uv + vec2(h.x, -h.y)) + t(uv - vec2(h.x, -h.y));
  fragColor = vec4(encodeHDR(s * 0.125), 0.0);
}`;

// --- Dual-filter upsample (8 taps), added onto the destination by blending.
const UP = /* glsl */ `
uniform sampler2D tSrc;
uniform vec4 uSrc;
vec3 t(vec2 uv) { return decodeHDR(texture(tSrc, clamp(uv, uSrc.zw * 0.5, uSrc.xy - uSrc.zw * 0.5)).rgb); }
vec3 up8(vec2 uv, vec2 h) {
  return (t(uv + vec2(-h.x * 2.0, 0.0)) + t(uv + vec2(-h.x, h.y)) * 2.0 + t(uv + vec2(0.0, h.y * 2.0)) + t(uv + vec2(h.x, h.y)) * 2.0
        + t(uv + vec2(h.x * 2.0, 0.0)) + t(uv + vec2(h.x, -h.y)) * 2.0 + t(uv + vec2(0.0, -h.y * 2.0)) + t(uv + vec2(-h.x, -h.y)) * 2.0) / 12.0;
}
void main() {
  fragColor = vec4(encodeHDR(up8(vUv * uSrc.xy, uSrc.zw)), 0.0);
}`;

// --- Last upsample + light shafts: writes bloom*strength + shafts*strength (pre-scaled).
const UPSHAFTS = /* glsl */ `
uniform sampler2D tSrc;   // 1/8 level (already accumulated)
uniform vec4 uSrc;
uniform sampler2D tQuarter; // 1/4 prefilter (rgb colour, a shaft source)
uniform vec4 uQuarter;
uniform vec2 uSunUv;
uniform vec3 uShaftColor;
uniform vec4 uMix; // x bloom strength, y shaft strength, z bloom tint mix
uniform vec3 uBloomTint;
vec3 t(vec2 uv) { return decodeHDR(texture(tSrc, clamp(uv, uSrc.zw * 0.5, uSrc.xy - uSrc.zw * 0.5)).rgb); }
#define SHAFT_TAPS 24
void main() {
  vec2 uv = vUv * uSrc.xy, h = uSrc.zw;
  vec3 coarse = (t(uv + vec2(-h.x * 2.0, 0.0)) + t(uv + vec2(-h.x, h.y)) * 2.0 + t(uv + vec2(0.0, h.y * 2.0)) + t(uv + vec2(h.x, h.y)) * 2.0
        + t(uv + vec2(h.x * 2.0, 0.0)) + t(uv + vec2(h.x, -h.y)) * 2.0 + t(uv + vec2(0.0, -h.y * 2.0)) + t(uv + vec2(-h.x, -h.y)) * 2.0) / 12.0;
  vec3 fine = decodeHDR(texture(tQuarter, vUv * uQuarter.xy).rgb);
  // Weight the coarse levels most: soft glow rather than a sharp halo.
  vec3 bloom = (fine * 0.25 + coarse * 0.75);
  bloom *= mix(vec3(1.0), uBloomTint, uMix.z);
  vec3 outc = bloom * uMix.x;
  if (uMix.y > 0.0) {
    vec2 delta = (uSunUv - vUv) * (0.85 / float(SHAFT_TAPS));
    float j = hash2i(ivec2(gl_FragCoord.xy));
    vec2 p = vUv + delta * j;
    float acc = 0.0, w = 1.0, wsum = 0.0;
    for (int i = 0; i < SHAFT_TAPS; i++) {
      acc += texture(tQuarter, clamp(p, vec2(0.0), vec2(1.0)) * uQuarter.xy).a * w;
      wsum += w; w *= 0.94; p += delta;
    }
    outc += uShaftColor * (acc / wsum) * uMix.y;
  }
  fragColor = vec4(outc, 1.0);
}`;

// --- Auto-exposure: clamped log-average of the 1/16 image, slow adaptation.
const EXPOSURE = /* glsl */ `
uniform sampler2D tSrc;
uniform vec4 uSrc;
uniform sampler2D tPrev;  // previous 1x1 exposure (log2 in r)
uniform vec4 uExpo;       // x key, y min log2, z max log2, w adapt rate (0..1; 1 = instant)
uniform float uExpoFixed; // > 0: fixed log2 exposure (+100)
uniform float uPrevAvg;
void main() {
  float s = 0.0, ws = 0.0;
  // The running average of the previous frame tells us where mid-grey is; clamp
  // each sample at 4x that so a bright sky cannot darken a backlit forest view.
  for (int y = 0; y < 6; y++) for (int x = 0; x < 9; x++) {
    vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(9.0, 6.0);
    float w = 1.0 - 0.55 * length((uv - 0.5) * vec2(1.0, 1.3));
    float L = luma(decodeHDR(texture(tSrc, uv * uSrc.xy).rgb));
    s += log2(max(L, 1e-4)) * w; ws += w;
  }
  float avg0 = s / ws;
  // Second pass with the clamp relative to the unclamped average.
  float cl = avg0 + 2.0;
  s = 0.0;
  for (int y = 0; y < 6; y++) for (int x = 0; x < 9; x++) {
    vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(9.0, 6.0);
    float w = 1.0 - 0.55 * length((uv - 0.5) * vec2(1.0, 1.3));
    float L = luma(decodeHDR(texture(tSrc, uv * uSrc.xy).rgb));
    s += min(log2(max(L, 1e-4)), cl) * w;
  }
  float avg = s / ws;
  float target = clamp(log2(uExpo.x) - avg, uExpo.y, uExpo.z);
  if (uExpoFixed > 0.0) target = uExpoFixed - 100.0;
  float prev = texture(tPrev, vec2(0.5)).r;
  float rate = target < prev ? min(1.0, uExpo.w * 1.6) : uExpo.w;
  float e = rate >= 1.0 ? target : mix(prev, target, rate);
  fragColor = vec4(e, avg, 0.0, 1.0);
}`;

// --- Final combined pass. Exposure is read once per vertex (flat varying).
const FINAL_VERT = /* glsl */ `
uniform sampler2D tExposure;
uniform vec4 uGrade2;
out vec2 vUv;
flat out float vExpo;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  vExpo = exp2(textureLod(tExposure, vec2(0.5), 0.0).r + uGrade2.w);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FINAL = SCENE_DIST + /* glsl */ `
flat in float vExpo;
uniform sampler2D tBloom;
uniform sampler2D tCanvas;
uniform vec4 uSrc;        // scene texel (zw) ; xy unused (exact-size target)
uniform vec4 uBloomSrc;   // bloom: xy uv max, zw texel
uniform vec4 uBloom;      // x bloom strength (for the base mix), y unused, z sharpen, w warp px
uniform vec4 uGrade;      // x saturation, y black lift, z vignette, w canvas strength
uniform vec4 uGrade2;     // x shadow cool, y highlight warm, z contrast, w exposure bias
uniform vec4 uCurve;      // Lottes: a, d, b, c
uniform vec3 uLiftColor;
uniform vec3 uWarmTint;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform vec2 uTanHalf;
uniform vec2 uOutRes;
uniform float uCanvasScale;

// Lottes 2016 curve on the max channel, ratio-preserving with controlled desaturation.
vec3 lottes(vec3 c) {
  float a = uCurve.x, d = uCurve.y, b = uCurve.z, cc = uCurve.w;
  float peak = max(max(c.r, c.g), c.b);
  peak = max(peak, 1e-6);
  vec3 ratio = c / peak;
  float tp = pow(peak, a) / (pow(peak, a * d) * b + cc);
  tp = clamp(tp, 0.0, 1.0);
  // Crosstalk: desaturate only the top of the range.
  const float s = 1.1;
  ratio = pow(max(ratio, vec3(1e-6)), vec3(s / 16.0));
  ratio = mix(ratio, vec3(1.0), pow(tp, 6.0));
  ratio = pow(ratio, vec3(16.0));
  return clamp(ratio * tp, 0.0, 1.0);
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec4 tap(vec2 uv) { return texture(tScene, uv); }

void main() {
  vec2 uv = vUv;
  float mode = uViewMode;
  vec2 t = uSrc.zw;
  vec2 suv = uv;

  // View-anchored distance warp: noise is a function of the world view direction,
  // so it stays attached to distant forms as the camera turns or walks.
  vec4 c0 = tap(suv);
  if (mode > 1.5 && uBloom.w > 0.0) {
    float d0 = sceneDistAt(suv, c0);
    float amt = smoothstep(150.0, 2000.0, d0) * uBloom.w;
    if (amt > 0.01) {
      vec2 ndc = uv * 2.0 - 1.0;
      vec3 dir = normalize(uCamFwd + ndc.x * uTanHalf.x * uCamRight + ndc.y * uTanHalf.y * uCamUp);
      vec2 n = vnoise3(dir * 52.0) - 0.5;
      vec2 wuv = suv + n * 2.0 * amt * t;
      vec4 cw = tap(wuv);
      // Never pull near objects into the far region (keeps near edges crisp).
      if (sceneDistAt(wuv, cw) > 120.0) { suv = wuv; c0 = cw; }
    }
  }

  // Sharpened upscale: 4 neighbour taps, clamped to the neighbourhood (no halos).
  vec3 c = decodeHDR(c0.rgb);
  vec3 n1 = decodeHDR(tap(suv + vec2(t.x, 0.0)).rgb), n2 = decodeHDR(tap(suv - vec2(t.x, 0.0)).rgb);
  vec3 n3 = decodeHDR(tap(suv + vec2(0.0, t.y)).rgb), n4 = decodeHDR(tap(suv - vec2(0.0, t.y)).rgb);
  vec3 mn = min(c, min(min(n1, n2), min(n3, n4)));
  vec3 mx = max(c, max(max(n1, n2), max(n3, n4)));
  c = clamp(c + (c * 4.0 - (n1 + n2 + n3 + n4)) * (uBloom.z * 0.25), mn, mx);

  // Bloom and shafts arrive pre-scaled in one quarter-res texture.
  vec3 bs = texture(tBloom, uv * uBloomSrc.xy).rgb;
  c = c * (1.0 - uBloom.x) + bs;

  c *= vExpo;

  if (mode > 0.5) {
    // Painter's grade in linear light before the curve.
    float L = luma(c);
    float shadowW = 1.0 - smoothstep(0.02, 0.35, L);
    vec3 coolTint = uShadowHue / max(luma(uShadowHue), 1e-4);
    c = mix(c, c * coolTint, shadowW * uGrade2.x);
    float hiW = smoothstep(0.3, 1.5, L);
    c *= mix(vec3(1.0), uWarmTint, hiW * uGrade2.y);
  }

  vec3 o = lottes(c);

  if (mode > 0.5) {
    // Gold bend of warm highlights (orange -> gold as it brightens).
    float m3 = max(max(o.r, o.g), o.b);
    if (o.r >= o.g && o.g >= o.b) o.g += (o.r - o.g) * 0.25 * smoothstep(0.55, 0.95, m3);
    // Mid-tone vibrance (keeps chroma rich where the eye looks).
    float L = luma(o);
    o = max(vec3(0.0), L + (o - L) * (1.0 + (uGrade.x - 1.0) * 4.0 * L * (1.0 - L)));
    o = clamp(mix(vec3(L), o, 1.0) , 0.0, 1.0);
    o = clamp(mix(vec3(0.5), o, uGrade2.z), 0.0, 1.0);
    // Warm, lifted black floor.
    o = o * (1.0 - uGrade.y) + uLiftColor * uGrade.y;
    vec2 vc = uv - 0.5;
    vc.x *= uOutRes.x / uOutRes.y * 0.75;
    o *= 1.0 - uGrade.z * pow(saturate(length(vc) * 1.25), 2.6);
  }
  if (mode > 1.5) {
    // Canvas weave, screen-fixed (it is the physical canvas), scaled to screen height.
    vec4 cw = texture(tCanvas, gl_FragCoord.xy * uCanvasScale / 256.0);
    float relief = (cw.r - 0.5) + 0.5 * (cw.g - 0.5);
    o *= 1.0 + relief * uGrade.w;
  }
  vec3 srgb = toSrgb(o);
  srgb += (hash2i(ivec2(gl_FragCoord.xy)) - 0.5) / 255.0;
  fragColor = vec4(srgb, 1.0);
}`;

// --- Overdraw visualisation (debug): additive count target -> heat map.
const OVERDRAW_VIEW = /* glsl */ `
uniform sampler2D tCount;
void main() {
  float n = texture(tCount, vUv).r * 255.0;
  vec3 c = n < 1.0 ? vec3(0.0, 0.0, 0.4) * n
         : n < 2.0 ? mix(vec3(0.0, 0.0, 0.4), vec3(0.0, 0.7, 0.0), n - 1.0)
         : n < 3.0 ? mix(vec3(0.0, 0.7, 0.0), vec3(0.9, 0.9, 0.0), n - 2.0)
         : n < 5.0 ? mix(vec3(0.9, 0.9, 0.0), vec3(1.0, 0.0, 0.0), (n - 3.0) * 0.5)
         : vec3(1.0, 0.0, 1.0);
  fragColor = vec4(c, 1.0);
}`;

/** Solve Lottes b, c so that T(mid) = midOut and T(white) = 1. */
function lottesBC(a, d, mid, midOut, white) {
  const b = (-Math.pow(mid, a) + Math.pow(white, a) * midOut) /
    ((Math.pow(white, a * d) - Math.pow(mid, a * d)) * midOut);
  const c = (Math.pow(white, a * d) * Math.pow(mid, a) - Math.pow(white, a) * Math.pow(mid, a * d) * midOut) /
    ((Math.pow(white, a * d) - Math.pow(mid, a * d)) * midOut);
  return [b, c];
}

export class Post {
  constructor(renderer, caps) {
    this.renderer = renderer;
    this.caps = caps;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(geo, null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const defs = caps.hdr.distInAlpha ? {} : { DIST_FROM_DEPTH: 1 };
    const v4 = () => ({ value: new THREE.Vector4() });
    const v2 = () => ({ value: new THREE.Vector2() });
    const v3 = (x = 0, y = 0, z = 0) => ({ value: new THREE.Vector3(x, y, z) });
    const sceneU = () => ({ tScene: { value: null }, tDepth: { value: null }, uNearFar: v2() });
    this.mPrefilter = fsMaterial('post.prefilter', PREFILTER, { ...sceneU(), uSunUv: v2(), uSunVisible: { value: 0 }, uSrcTexel: v4() }, defs);
    this.mDown = fsMaterial('post.down', DOWN, { tSrc: { value: null }, uSrc: v4() });
    this.mUp = fsMaterial('post.up', UP, { tSrc: { value: null }, uSrc: v4() });
    this.mUp.blending = THREE.CustomBlending;
    this.mUp.blendEquation = THREE.AddEquation;
    this.mUp.blendSrc = THREE.OneFactor;
    this.mUp.blendDst = THREE.OneFactor;
    if (caps.bloom.encode) this.mUp.blending = THREE.NoBlending; // encoded targets cannot be summed
    this.mUpShafts = fsMaterial('post.upshafts', UPSHAFTS, { tSrc: { value: null }, uSrc: v4(), tQuarter: { value: null }, uQuarter: v4(), uSunUv: v2(), uShaftColor: v3(1, 0.8, 0.5), uMix: v4(), uBloomTint: v3(1, 0.9, 0.75) });
    this.mExposure = fsMaterial('post.exposure', EXPOSURE, { tSrc: { value: null }, uSrc: v4(), tPrev: { value: null }, uExpo: v4(), uExpoFixed: { value: 0 }, uPrevAvg: { value: 0 } });
    this.mFinal = fsMaterial('post.final', FINAL, {
      ...sceneU(), tBloom: { value: null }, tExposure: { value: null }, tCanvas: { value: null },
      uSrc: v4(), uBloomSrc: v4(), uBloom: v4(), uGrade: v4(), uGrade2: v4(), uCurve: v4(),
      uLiftColor: v3(), uWarmTint: v3(1, 1, 1), uCamRight: v3(), uCamUp: v3(), uCamFwd: v3(),
      uTanHalf: v2(), uOutRes: v2(), uCanvasScale: { value: 1 },
    }, defs, FINAL_VERT);
    this.mOverdraw = fsMaterial('post.overdraw', OVERDRAW_VIEW, { tCount: { value: null } });
    this.materials = [this.mPrefilter, this.mDown, this.mUp, this.mUpShafts, this.mExposure, this.mFinal];

    this.shaftsEnabled = true;
    this.expoInstant = false;
    this.expoReset = true;
    this._v = new THREE.Vector3();
    this._dims = new Map(); // target -> [w, h] valid sub-rect
    this.curveKey = '';
  }

  /** Bloom chain at max internal size (viewport sub-rects); scene target sized separately. */
  allocate(maxW, maxH) {
    this.disposeChain();
    const { caps } = this;
    this.maxW = maxW; this.maxH = maxH;
    const bopts = { format: THREE.RGBAFormat, type: caps.bloom.type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false };
    const q = (d) => [Math.max(4, Math.ceil(maxW / d) + 1), Math.max(4, Math.ceil(maxH / d) + 1)];
    this.b4 = new THREE.WebGLRenderTarget(...q(4), bopts);
    this.b8 = new THREE.WebGLRenderTarget(...q(8), bopts);
    this.b16 = new THREE.WebGLRenderTarget(...q(16), bopts);
    this.bOut = new THREE.WebGLRenderTarget(...q(4), bopts);
    const eopts = { format: THREE.RGBAFormat, type: caps.halfFloatTarget ? THREE.HalfFloatType : THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false };
    this.expo = [new THREE.WebGLRenderTarget(1, 1, eopts), new THREE.WebGLRenderTarget(1, 1, eopts)];
    this.expoIndex = 0;
    this.expoReset = true;
  }

  disposeChain() {
    for (const k of ['b4', 'b8', 'b16', 'bOut']) if (this[k]) { this[k].dispose(); this[k] = null; }
    if (this.expo) { this.expo.forEach((t) => t.dispose()); this.expo = null; }
  }

  /** (Re)create the scene target at exactly w x h. */
  allocateScene(w, h) {
    if (this.sceneRT && this.sceneRT.width === w && this.sceneRT.height === h) return;
    if (this.sceneRT) { this.sceneRT.dispose(); if (this.sceneRT.depthTexture) this.sceneRT.depthTexture.dispose(); }
    const { caps } = this;
    const opts = {
      format: caps.hdr.format, type: caps.hdr.type,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false, samples: caps.samples, generateMipmaps: false,
    };
    if (!caps.hdr.distInAlpha) {
      const dt = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
      dt.minFilter = THREE.NearestFilter; dt.magFilter = THREE.NearestFilter;
      opts.depthTexture = dt;
    } else {
      opts.resolveDepthBuffer = false;
      opts.storeMultisampledDepthBuffer = false;
    }
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, opts);
    this.sceneRT.texture.name = 'scene-hdr';
    if (!caps.hdr.distInAlpha) {
      // The depth texture must be resolved by blit: keep three on the explicit-resolve path.
      this.renderer.properties.get(this.sceneRT).__useRenderToTexture = false;
    }
    if (this.countRT) { this.countRT.dispose(); this.countRT.depthTexture?.dispose(); this.countRT = null; }
  }

  /** Current internal size. */
  setSize(w, h) {
    this.w = w; this.h = h;
    this.allocateScene(w, h);
    const set = (rt, d) => {
      const sw = Math.max(1, Math.ceil(w / d)), sh = Math.max(1, Math.ceil(h / d));
      rt.viewport.set(0, 0, sw, sh); rt.scissor.set(0, 0, sw, sh); rt.scissorTest = true;
      this._dims.set(rt, [sw, sh]);
    };
    set(this.b4, 4); set(this.b8, 8); set(this.b16, 16); set(this.bOut, 4);
  }

  _src(u, rt) {
    const d = this._dims.get(rt);
    u.value.set(d[0] / rt.width, d[1] / rt.height, 1 / rt.width, 1 / rt.height);
  }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  _curve(p) {
    const key = `${p.curveA}|${p.curveD}|${p.curveMid}|${p.curveMidOut}|${p.curveWhite}`;
    if (key === this.curveKey) return;
    this.curveKey = key;
    const [b, c] = lottesBC(p.curveA, p.curveD, p.curveMid, p.curveMidOut, p.curveWhite);
    this.mFinal.uniforms.uCurve.value.set(p.curveA, p.curveD, b, c);
  }

  /**
   * Run the post chain and write the final image to the canvas.
   * f: { camera, sunDir (world Vector3), params (world post block), outW, outH, dt, viewMode }
   */
  run(f) {
    const r = this.renderer;
    const p = f.params;
    const cam = f.camera;
    this._curve(p);
    // Sun position in screen uv (may be off screen).
    const sunView = this._v.copy(f.sunDir).transformDirection(cam.matrixWorldInverse);
    const fwd = -sunView.z;
    const sunUv = this.mPrefilter.uniforms.uSunUv.value;
    let sunVisible = 0;
    if (fwd > 0.05) {
      const th = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
      sunUv.set(0.5 + 0.5 * (sunView.x / fwd) / (th * cam.aspect), 0.5 + 0.5 * (sunView.y / fwd) / th);
      sunVisible = THREE.MathUtils.smoothstep(fwd, 0.2, 0.75);
    } else {
      sunUv.set(-10, -10);
    }
    const shaftOn = this.shaftsEnabled && sunVisible > 0.001 && f.viewMode > 0.5;

    // 1. prefilter to 1/4 (+ shaft source in alpha)
    const pf = this.mPrefilter.uniforms;
    pf.tScene.value = this.sceneRT.texture; pf.tDepth.value = this.sceneRT.depthTexture;
    pf.uNearFar.value.set(cam.near, cam.far);
    pf.uSrcTexel.value.set(1 / this.w, 1 / this.h, 0, 0);
    pf.uSunVisible.value = shaftOn ? sunVisible : 0;
    this._pass(this.mPrefilter, this.b4);

    // 2. downsample 1/8, 1/16
    const du = this.mDown.uniforms;
    du.tSrc.value = this.b4.texture; this._src(du.uSrc, this.b4); this._pass(this.mDown, this.b8);
    du.tSrc.value = this.b8.texture; this._src(du.uSrc, this.b8); this._pass(this.mDown, this.b16);

    // 3. exposure from 1/16
    const eu = this.mExposure.uniforms;
    const prev = this.expo[this.expoIndex], next = this.expo[1 - this.expoIndex];
    eu.tSrc.value = this.b16.texture; this._src(eu.uSrc, this.b16);
    eu.tPrev.value = prev.texture;
    const rate = this.expoInstant || this.expoReset ? 1 : 1 - Math.exp(-f.dt / p.exposureTau);
    eu.uExpo.value.set(p.exposureKey, p.exposureMin, p.exposureMax, rate);
    eu.uExpoFixed.value = this.caps.halfFloatTarget ? 0 : 100 + p.exposureFallback;
    this._pass(this.mExposure, next);
    this.expoIndex = 1 - this.expoIndex;
    this.expoReset = false;

    // 4. upsample 1/16 -> 1/8 (additive)
    const uu = this.mUp.uniforms;
    uu.tSrc.value = this.b16.texture; this._src(uu.uSrc, this.b16);
    this._pass(this.mUp, this.b8);

    // 5. last upsample + shafts -> bOut (pre-scaled bloom + shafts)
    const us = this.mUpShafts.uniforms;
    us.tSrc.value = this.b8.texture; this._src(us.uSrc, this.b8);
    us.tQuarter.value = this.b4.texture; this._src(us.uQuarter, this.b4);
    us.uSunUv.value.copy(sunUv);
    us.uShaftColor.value.set(p.shaftColor[0], p.shaftColor[1], p.shaftColor[2]);
    us.uBloomTint.value.set(p.bloomTint[0], p.bloomTint[1], p.bloomTint[2]);
    us.uMix.value.set(f.viewMode > 0.5 ? p.bloomStrength : p.bloomStrength * 0.5, shaftOn ? p.shaftStrength * sunVisible : 0, f.viewMode > 0.5 ? 1 : 0, 0);
    this._pass(this.mUpShafts, this.bOut);

    // 6. final
    const fu = this.mFinal.uniforms;
    fu.tScene.value = this.sceneRT.texture; fu.tDepth.value = this.sceneRT.depthTexture;
    fu.uNearFar.value.set(cam.near, cam.far);
    fu.tBloom.value = this.bOut.texture;
    fu.tExposure.value = next.texture;
    fu.uSrc.value.set(1, 1, 1 / this.w, 1 / this.h);
    this._src(fu.uBloomSrc, this.bOut);
    fu.uBloom.value.set(f.viewMode > 0.5 ? p.bloomStrength : p.bloomStrength * 0.5, 0, p.sharpen, p.warpPx * (this.h / 744));
    fu.uGrade.value.set(p.saturation, p.blackLift, p.vignette, p.canvas);
    fu.uGrade2.value.set(p.shadowCool, p.highlightWarm, p.contrast, p.exposureBias);
    fu.uLiftColor.value.set(p.liftColor[0], p.liftColor[1], p.liftColor[2]);
    fu.uWarmTint.value.set(p.warmTint[0], p.warmTint[1], p.warmTint[2]);
    cam.matrixWorld.extractBasis(fu.uCamRight.value, fu.uCamUp.value, fu.uCamFwd.value);
    fu.uCamFwd.value.negate();
    const th = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    fu.uTanHalf.value.set(th * cam.aspect, th);
    fu.uOutRes.value.set(f.outW, f.outH);
    fu.uCanvasScale.value = 1080 / Math.max(1, f.outH);
    r.setRenderTarget(null);
    r.setViewport(0, 0, f.outW, f.outH);
    this.quad.material = this.mFinal;
    r.render(this.scene, this.camera);
  }

  /** Debug: show an overdraw counter target as a heat map. */
  showOverdraw(countRT, outW, outH) {
    this.mOverdraw.uniforms.tCount.value = countRT.texture;
    this.renderer.setRenderTarget(null);
    this.renderer.setViewport(0, 0, outW, outH);
    this.quad.material = this.mOverdraw;
    this.renderer.render(this.scene, this.camera);
  }

  ensureCountTarget() {
    if (this.countRT && this.countRT.width === this.w && this.countRT.height === this.h) return this.countRT;
    if (this.countRT) { this.countRT.dispose(); this.countRT.depthTexture?.dispose(); }
    this.countRT = new THREE.WebGLRenderTarget(this.w, this.h, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    return this.countRT;
  }
}
