// World-anchored brushwork sampling (shared GLSL).
//
// Strokes live in world space on a sheared triangle lattice ("hex tiling"): each
// lattice vertex owns one stroke-texture placement with its own rotation (flow
// direction + jitter), scale and offset; a pixel blends the 3 vertices of its
// triangle with sharpened, height-biased weights so strokes overlap like paint.
// Two octaves (tile = 0.5 m * 2^k) are cross-faded by straight-line distance so
// strokes stay ~2-4 % of screen height: at most 6 stroke samples per pixel.
//
// Stability: the lattice origin comes from JS doubles. uBrushCam = (f.x, f.z, C.x, C.z)
// where C = camera (wrapped) rounded to 128 m and f = the remainder, so for octaves
// k <= 8 the lattice offset C/hex is an exact even integer and the fine part is small.
// Mip level comes from the world-position derivatives (rotation-invariant), so there
// are no derivative jumps at lattice borders. Nothing depends on time or screen space.
export const GLSL_BRUSH = /* glsl */ `
uniform sampler2D uStroke;
uniform vec4 uBrush;    // x tile factor (tile ~= x * distance), y texture size, z weight sharpness, w octave fade width
uniform vec4 uBrushCam; // xy fine camera offset (m), zw coarse camera offset (multiple of 128 m)

struct BrushOut { float h; vec2 nWorld; float id; float lod; float fleck; };

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// One octave: 3 lattice samples, weighted. Returns (h, nx, nz) in .xyz and id in .w; weight sum in wsum.
vec4 brushOctave(int k, vec2 rel, vec2 dRx, vec2 dRy, float theta, float jitterAmt, mat2 S, out float lodOut) {
  float hexS = 0.25 * exp2(float(k));
  vec2 P; vec2 coarse;
  if (k <= 8) { P = (rel + uBrushCam.xy) / hexS; coarse = uBrushCam.zw / hexS; }
  else { P = (rel + uCamWrapped.xz) / hexS; coarse = vec2(0.0); }
  vec2 sk = vec2(P.x - 0.5 * P.y, P.y);
  ivec2 co = ivec2(round(coarse.x - 0.5 * coarse.y), round(coarse.y));
  vec2 b = floor(sk);
  vec2 f = sk - b;
  ivec2 bi = ivec2(b);
  ivec2 v0, v1, v2; vec3 w;
  if (f.x + f.y < 1.0) { v0 = bi; v1 = bi + ivec2(1, 0); v2 = bi + ivec2(0, 1); w = vec3(1.0 - f.x - f.y, f.x, f.y); }
  else { v0 = bi + ivec2(1, 1); v1 = bi + ivec2(0, 1); v2 = bi + ivec2(1, 0); w = vec3(f.x + f.y - 1.0, 1.0 - f.x, 1.0 - f.y); }
  // Derivatives of the lattice coordinate; rotated per stroke below, so there are no
  // derivative jumps at lattice borders. textureGrad + anisotropic filtering keeps
  // strokes crisp on ground seen at grazing angles without shimmering.
  vec2 dPx = dRx / hexS, dPy = dRy / hexS;
  float lodBase = log2(max(sqrt(length(dPx) * length(dPy)) * 0.5 * uBrush.y, 1e-6));
  lodOut = lodBase;
  vec4 acc = vec4(0.0); float idAcc = 0.0, wsum = 0.0;
  ivec2 vs[3] = ivec2[3](v0, v1, v2);
  for (int i = 0; i < 3; i++) {
    ivec2 v = vs[i];
    uint hsh = hashU2(uvec2(v + co) + uvec2(uint(k) * 7919u, uint(k) * 104729u));
    vec3 r = hash3u(hsh);
    float sc = mix(0.85, 1.2, r.x);
    float ang = theta + (r.y - 0.5) * jitterAmt;
    vec2 c = vec2(float(v.x) + 0.5 * float(v.y), float(v.y));
    // S compresses the stroke shape along the ground-projected view direction (stroke
    // centres stay world-anchored; only shapes stretch, smoothly with camera position).
    mat2 R = rot2(ang) * S * (0.5 / sc);
    vec2 uv = R * (P - c) + vec2(r.z, hashF(hsh ^ 0x5bd1e995u));
    vec4 t = textureGrad(uStroke, uv, R * dPx, R * dPy);
    float h = t.r;
    vec2 n = t.gb * 2.0 - 1.0;
    // Tangent-space normal back to world xz (inverse rotation).
    vec2 nw = transpose(rot2(ang)) * n;
    float wi = pow(max(w[i] * (0.2 + h), 1e-4), uBrush.z);
    acc += vec4(h, nw, 0.0) * wi;
    idAcc += t.a * wi;
    wsum += wi;
  }
  acc /= wsum;
  acc.w = idAcc / wsum;
  return acc;
}

// Full brush evaluation for a surface point. rel = camera-relative world coords in
// the projection plane, d = straight-line distance, theta = stroke direction (rad),
// cosInc = |cos| of the angle between the view ray and the surface normal.
// Stroke scale depends only on distance and incidence (both independent of where the
// camera looks), so turning the camera never re-scales strokes.
BrushOut brushSample(vec2 rel, float d, float theta, float jitterAmt, float cosInc) {
  vec2 dRx = dFdx(rel), dRy = dFdy(rel);
  float foreshorten = pow(max(cosInc, 0.08), -0.3);
  // Radial stretch: strokes lying on ground seen at grazing angles keep a readable
  // thickness on screen (up to 2x longer along the view direction).
  float sr = clamp(pow(max(cosInc, 0.05), -0.35), 1.0, 2.0);
  vec2 rdir = normalize(rel + vec2(1e-4, 0.0));
  mat2 S = mat2(1.0) + (1.0 / sr - 1.0) * mat2(rdir.x * rdir.x, rdir.x * rdir.y, rdir.x * rdir.y, rdir.y * rdir.y);
  float s = log2(max(uBrush.x * d * foreshorten / 0.5, 1.0));
  float k0f = floor(s);
  float fr = s - k0f;
  int k0 = int(k0f);
  float lod0, lod1;
  vec4 a = brushOctave(k0, rel, dRx, dRy, theta, jitterAmt, S, lod0);
  vec4 r = a;
  float lod = lod0;
  float fw = smoothstep(1.0 - uBrush.w, 1.0, fr);
  if (fw > 0.001) {
    vec4 c = brushOctave(k0 + 1, rel, dRx, dRy, theta, jitterAmt, S, lod1);
    // Height-biased cross-fade: the coarser strokes arrive like paint laid on top.
    float t = clamp((fw - 0.5) * 2.0 + (c.x - a.x) * 0.9 + 0.5, 0.0, 1.0);
    t = smoothstep(0.0, 1.0, t);
    r = mix(a, c, t);
    lod = mix(lod0, lod1, t);
  }
  BrushOut o;
  o.h = r.x; o.nWorld = r.yz; o.id = r.w; o.lod = lod;
  o.fleck = smoothstep(0.945, 0.955, r.w);
  return o;
}

// Broken colour from the stroke id (smooth in id, so filtered ids blend like colour).
vec3 brokenColor(vec3 albedo, float id, float hueDeg, float chromaAmt, float lAmt) {
  float dh = (id - 0.5) * radians(hueDeg);
  float dc = chromaAmt * cos(6.2831853 * 3.0 * id + 0.7);
  float dl = lAmt * sin(6.2831853 * 5.0 * id + 1.0);
  return oklabJitter(albedo, dh, dc, dl);
}
`;
