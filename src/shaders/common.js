// Shared GLSL library and the material factory every engine material uses.
// Global uniforms are shared {value} objects: updating one updates all materials.
import * as THREE from 'three';

export const G = {
  uTime: { value: 0 },
  uViewMode: { value: 2 }, // 0 raw, 1 painter's light, 2 full painted
  uCamWrapped: { value: new THREE.Vector3() }, // camera position mod wrapPeriod
  uCamAlt: { value: 0 }, // camera altitude above the world datum (m)
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, // toward the Sun, world axes
  uSunColor: { value: new THREE.Vector3(1, 1, 1) }, // direct sun irradiance at the ground (linear)
  uSkyZenith: { value: new THREE.Vector3(0.3, 0.4, 0.6) }, // ambient from the upper sky
  uSkyHorizon: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, // ambient from the horizon band
  uGroundBounce: { value: new THREE.Vector3(0.1, 0.1, 0.05) },
  uShadowHue: { value: new THREE.Vector3(0.4, 0.4, 0.7) }, // painter's shadow fill hue (world)
  uDistanceHue: { value: new THREE.Vector3(0.5, 0.55, 0.75) },
  uGlowHue: { value: new THREE.Vector3(1.0, 0.8, 0.5) },
  uPainter: { value: new THREE.Vector4(0.5, 1.5, 0.15, 1.0) }, // x shadow-hue fill, y aerial scale, z warmth, w stroke strength
  uFog: { value: new THREE.Vector4(0.0002, 0.0015, 0.0, 0.6) }, // x density, y height falloff, z base alt, w mie g
  uFog2: { value: new THREE.Vector4(1.0, 1.0, 0.0, 0.0) }, // x glow strength, y height-fog strength, z,w spare
  uSkyLut: { value: null },
  uNoise: { value: null },
  uStroke: { value: null }, // RGBA brush-stroke texture (height, normal xy, id)
  uResolution: { value: new THREE.Vector2(1600, 744) },
  uOverdraw: { value: 0 },
  // Painter's light / painted distance (set from the world file by the sky module).
  uSunWarm: { value: new THREE.Vector3(1, 1, 1) },
  uAtmo: { value: new THREE.Vector4(1.2e-5, 1500, 0.5, 0.85) },
  uAtmo2: { value: new THREE.Vector4(0.035, 0.72, 0, 0) },
  uHazeColor: { value: new THREE.Vector3(0.25, 0.21, 0.19) },
  uCamAGL: { value: 1.7 }, // camera height above the ground (m)
  uSkyPaint: { value: new THREE.Vector4(0.08, 0.62, 2.0, 0.65) }, // strokes, compress, lift, hue blend
  uSkyHues: { value: [new THREE.Vector3(0.2, 0.27, 0.57), new THREE.Vector3(0.5, 0.6, 0.75), new THREE.Vector3(0.82, 0.69, 0.48), new THREE.Vector3(0.8, 0.72, 0.6)] },
  uSkyHalo: { value: 0.82 },
  uSkyRef: { value: 1.0 }, // painted sky reference luminance (horizon), from the LUT on the CPU
  uSkyPeach: { value: new THREE.Vector3(0.75, 0.55, 0.45) },
  uSunChroma: { value: 1.0 },
  // Brushwork: x tile factor (tile ~= x * distance), y stroke texture size, z weight sharpness, w octave fade width.
  uBrush: { value: new THREE.Vector4(0.21, 512, 6, 0.35) },
  uBrushCam: { value: new THREE.Vector4() }, // fine (xy) and 128 m-coarse (zw) camera offsets
  // Sun shadow cascades (src/shadows/shadows.js); disabled (uShadowP.z = 0) until created.
  uShadow0: { value: null }, uShadow1: { value: null },
  uShadowM0: { value: new THREE.Matrix4() }, uShadowM1: { value: new THREE.Matrix4() },
  uShadowP: { value: new THREE.Vector4(0.12, 0.9, 0, 1.2) }, uShadowT: { value: new THREE.Vector4() },
};

export const GLOBAL_DEFINES = {};

export function setGlobalDefine(name, value) {
  GLOBAL_DEFINES[name] = value;
}

export const GLSL_COMMON = /* glsl */ `
#define PI 3.14159265359
uniform float uTime;
uniform float uViewMode;
uniform vec3 uCamWrapped;
uniform float uCamAlt;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uGroundBounce;
uniform vec3 uShadowHue;
uniform vec3 uDistanceHue;
uniform vec3 uGlowHue;
uniform vec4 uPainter;
uniform vec4 uFog;
uniform vec4 uFog2;
uniform sampler2D uSkyLut;
uniform sampler2D uNoise;
uniform vec2 uResolution;
uniform float uOverdraw;

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3 saturate3(vec3 x) { return clamp(x, 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float sq(float x) { return x * x; }

// Integer hashes (no sin-based hashing anywhere).
uint hashU(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16; return x;
}
uint hashU2(uvec2 v) { return hashU(v.x ^ hashU(v.y + 0x9e3779b9u)); }
float hashF(uint x) { return float(hashU(x) >> 8) * (1.0 / 16777216.0); }
float hash2i(ivec2 p) { return float(hashU2(uvec2(p)) >> 8) * (1.0 / 16777216.0); }
vec2 hash2i2(ivec2 p) { uint h = hashU2(uvec2(p)); return vec2(float(h & 0xffffu), float(h >> 16)) * (1.0 / 65535.0); }
vec3 hash3u(uint x) { uint a = hashU(x); uint b = hashU(a); uint c = hashU(b);
  return vec3(float(a >> 8), float(b >> 8), float(c >> 8)) * (1.0 / 16777216.0); }

// Smooth value noise from the 256x256 RGBA noise texture (bilinear, wraps).
float vnoise(vec2 p) { return texture(uNoise, p * (1.0 / 256.0)).r; }
vec4 vnoise4(vec2 p) { return texture(uNoise, p * (1.0 / 256.0)); }
// Seamless 3D value noise from the 2D texture (two taps, z slices offset).
vec2 vnoise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = (i.xy + vec2(37.0, 17.0) * i.z) + f.xy;
  vec4 a = textureLod(uNoise, (uv + 0.5) * (1.0 / 256.0), 0.0);
  vec4 b = textureLod(uNoise, (uv + vec2(37.0, 17.0) + 0.5) * (1.0 / 256.0), 0.0);
  return mix(a.xy, b.xy, f.z);
}

// View distance stored in the scene target alpha (log encoded, 0..1 = 0..65 km).
float encodeDist(float d) { return clamp(log2(1.0 + d) * (1.0 / 16.0), 0.0, 1.0); }
float decodeDist(float a) { return exp2(a * 16.0) - 1.0; }

vec3 encodeHDR(vec3 c) {
#ifdef HDR_ENCODE
  c = max(c, 0.0); return c / (1.0 + c);
#else
  return c;
#endif
}
vec3 decodeHDR(vec3 c) {
#ifdef HDR_ENCODE
  c = min(c, vec3(0.9995)); return c / (1.0 - c);
#else
  return c;
#endif
}
// Every scene material ends with this: HDR colour + view distance.
vec4 sceneOut(vec3 c, float dist) {
  // Guard against NaN/Inf reaching the bloom chain (one bad pixel blooms into a square).
  float s = c.r + c.g + c.b;
  c = (s >= 0.0 && s < 1.0e6) ? min(c, vec3(60000.0)) : vec3(0.0);
  return vec4(encodeHDR(c), encodeDist(dist));
}
`;

const VERT_HEAD = /* glsl */ `
precision highp float;
precision highp int;
`;

const FRAG_HEAD = /* glsl */ `
precision highp float;
precision highp int;
layout(location = 0) out highp vec4 fragColor;
`;

/**
 * Build a GLSL ES 3.00 ShaderMaterial with the common library prepended.
 * o: { name, vertex, fragment, uniforms, defines, side, depthWrite, depthTest, depthFunc,
 *      alphaToCoverage, colorWrite, chunks: [extra glsl strings inserted after common] }
 */
export function makeMaterial(o) {
  const chunks = (o.chunks || []).join('\n');
  const fchunks = (o.fragChunks || []).join('\n'); // fragment-only (derivatives etc.)
  const mat = new THREE.ShaderMaterial({
    name: o.name || 'engine',
    glslVersion: THREE.GLSL3,
    uniforms: Object.assign({}, G, o.uniforms || {}),
    defines: Object.assign({}, GLOBAL_DEFINES, o.defines || {}),
    vertexShader: VERT_HEAD + GLSL_COMMON + chunks + o.vertex,
    fragmentShader: FRAG_HEAD + GLSL_COMMON + chunks + fchunks + o.fragment,
    side: o.side ?? THREE.FrontSide,
    depthWrite: o.depthWrite ?? true,
    depthTest: o.depthTest ?? true,
    transparent: false,
    toneMapped: false,
    fog: false,
    lights: false,
  });
  if (o.depthFunc !== undefined) mat.depthFunc = o.depthFunc;
  if (o.alphaToCoverage) mat.alphaToCoverage = true;
  if (o.colorWrite === false) mat.colorWrite = false;
  return mat;
}
