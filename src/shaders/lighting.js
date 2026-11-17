// Painter's light and painted distance (shared GLSL). `pk` is the painter strength:
// 0 in the raw-lighting view, 1 in painter's light and the full painted look.
export const GLSL_LIGHTING = /* glsl */ `
uniform vec3 uSunWarm;      // world sunWarmth (linear), applied in painter views
uniform vec4 uAtmo;         // x aerial extinction/m at the datum, y aerial scale height (m), z distance-hue mix, w chroma keep
uniform vec4 uAtmo2;        // x horizon tilt for inscatter lookup, y aerial glow g, z,w spare
uniform vec3 uHazeColor;    // ground-haze base hue (linear, luma-normalised on the CPU)
uniform float uCamAGL;      // camera height above ground

float painterK() { return uViewMode > 0.5 ? 1.0 : 0.0; }

// ---- Sun shadows (src/shadows/shadows.js renders the cascades)
uniform highp sampler2DShadow uShadow0;
uniform highp sampler2DShadow uShadow1;
uniform mat4 uShadowM0;   // camera-relative position -> cascade 0 clip space
uniform mat4 uShadowM1;
uniform vec4 uShadowP;    // x near texel (m), y far texel (m), z enabled, w softness (texels)
uniform vec4 uShadowT;    // xy near texel uv size, zw far texel uv size

float shadowTap0(vec3 p) { return texture(uShadow0, p); }
// Sun visibility 0..1 for a camera-relative position. nrm: geometric normal (for the
// normal-offset bias); edge: -0.5..0.5 brush offset (stroke height - 0.5) so shadow
// edges look brushed.
float sunShadow(vec3 rel, vec3 nrm, float edge) {
  if (uShadowP.z < 0.5) return 1.0;
  float ndl = dot(nrm, uSunDir);
  vec3 pb = rel + nrm * (uShadowP.x * 1.5) + uSunDir * (uShadowP.x * (1.0 + 2.0 * (1.0 - abs(ndl))));
  vec4 c0 = uShadowM0 * vec4(pb, 1.0);
  vec3 s0 = c0.xyz * 0.5 + 0.5;
  float r = 1.0;
  vec3 e0 = abs(c0.xyz);
  float in0 = 1.0 - smoothstep(0.86, 0.97, max(e0.x, e0.y));
  float sh0 = 1.0, sh1 = 1.0;
  if (in0 > 0.0 && e0.z < 1.0) {
    vec2 o = uShadowT.xy * uShadowP.w;
    sh0 = 0.25 * (texture(uShadow0, vec3(s0.xy + vec2(-o.x, -o.y * 0.6), s0.z)) + texture(uShadow0, vec3(s0.xy + vec2(o.x, -o.y * 0.6), s0.z))
                + texture(uShadow0, vec3(s0.xy + vec2(-o.x * 0.6, o.y), s0.z)) + texture(uShadow0, vec3(s0.xy + vec2(o.x * 0.6, o.y), s0.z)));
  }
  if (in0 < 1.0) {
    vec3 pf = rel + nrm * (uShadowP.y * 1.5) + uSunDir * (uShadowP.y * 2.0);
    vec4 c1 = uShadowM1 * vec4(pf, 1.0);
    vec3 s1 = c1.xyz * 0.5 + 0.5;
    vec3 e1 = abs(c1.xyz);
    if (max(e1.x, e1.y) < 1.0 && e1.z < 1.0) {
      // Far map: 4 taps over ~1.5 texels (wide, filtered penumbra; no saw-tooth).
      vec2 o1 = uShadowT.zw * 1.5;
      sh1 = 0.25 * (texture(uShadow1, vec3(s1.xy + vec2(-o1.x, -o1.y), s1.z)) + texture(uShadow1, vec3(s1.xy + vec2(o1.x, -o1.y), s1.z))
                  + texture(uShadow1, vec3(s1.xy + vec2(-o1.x, o1.y), s1.z)) + texture(uShadow1, vec3(s1.xy + vec2(o1.x, o1.y), s1.z)));
    }
    sh1 = mix(sh1, 1.0, smoothstep(0.85, 1.0, max(e1.x, e1.y)));
  }
  float sh = mix(sh1, sh0, in0);
  // Brushed edge: the stroke's paint height pushes the shadow boundary in or out.
  // Half-shade across the penumbra (no binary stroke flip): the stroke height only nudges it.
  return smoothstep(0.05, 0.95, sh + edge * 0.3 * (1.0 - abs(sh * 2.0 - 1.0)));
}


// ---- Oklab (Ottosson) for chroma operations
vec3 toOklab(vec3 c) {
  c = max(c, vec3(0.0));
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  l = pow(l, 1.0 / 3.0); m = pow(m, 1.0 / 3.0); s = pow(s, 1.0 / 3.0);
  return vec3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
              1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
              0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}
vec3 fromOklab(vec3 o) {
  float l = o.x + 0.3963377774 * o.y + 0.2158037573 * o.z;
  float m = o.x - 0.1055613458 * o.y - 0.0638541728 * o.z;
  float s = o.x - 0.0894841775 * o.y - 1.2914855480 * o.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
             -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
             -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
vec3 chromaScale(vec3 c, float k) {
  vec3 o = toOklab(c); o.yz *= k; return max(fromOklab(o), vec3(0.0));
}
// Hue rotation + chroma/lightness jitter in Oklab (broken colour).
vec3 oklabJitter(vec3 c, float dHueRad, float dChroma, float dL) {
  vec3 o = toOklab(c);
  float cs = cos(dHueRad), sn = sin(dHueRad);
  o.yz = mat2(cs, sn, -sn, cs) * o.yz * (1.0 + dChroma);
  o.x *= 1.0 + dL;
  return max(fromOklab(o), vec3(0.0));
}

// ---- Sky-view LUT lookup (azimuth relative to the Sun x elevation, dense at the horizon).
vec3 skyLut(vec3 dir) {
  float el = asin(clamp(dir.y, -1.0, 1.0));
  vec2 sxz = normalize(uSunDir.xz + vec2(1e-5, 0.0));
  vec2 dxz = dir.xz / max(length(dir.xz), 1e-5);
  float rel = acos(clamp(dot(sxz, dxz), -1.0, 1.0)) / PI;
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (0.5 * PI));
  return texture(uSkyLut, vec2(rel, v)).rgb;
}

// Painter's sky: luminance structure from the physical LUT (range-compressed and
// lifted so the sky is the lightest large mass), hues pulled toward a painted
// palette: zenith, horizon, a broad warm halo around the Sun, a cream band at the
// very bottom. Used by the sky dome and by the aerial inscatter so they agree.
uniform vec4 uSkyPaint; // x stroke strength, y range compression exponent, z lift, w palette blend
uniform vec3 uSkyHues[4]; // zenith, horizon, near-Sun, horizon cream (linear)
uniform float uSkyHalo;   // cos of the halo radius
uniform float uSkyRef;    // reference luminance of the painted horizon
uniform vec3 uSkyPeach;   // halo skirt hue between cream and blue
uniform float uSunChroma; // painter: chroma kept in direct sunlight
vec3 paintSky(vec3 c, vec3 dir) {
  if (uViewMode < 0.5) return c;
  float L = luma(c);
  float Lc = pow(max(L, 1e-5), uSkyPaint.y) * pow(0.6, 1.0 - uSkyPaint.y) * uSkyPaint.z;
  float el = clamp(dir.y, 0.0, 1.0);
  float mu = dot(dir, uSunDir);
  // Painted palette: luminance comes from the palette itself (zenith darker than the
  // milky horizon), scaled to the reference; a round halo walks cream -> peach -> blue.
  vec3 sky = mix(uSkyHues[1], uSkyHues[0], smoothstep(0.0, 0.8, sqrt(el)));
  sky = mix(sky, uSkyHues[3], (1.0 - smoothstep(0.0, 0.3, el)) * 0.5);
  // Smooth Mie-like falloff: no edge anywhere, a concentrated core.
  float a = saturate((mu - uSkyHalo) / (1.0 - uSkyHalo));
  float skirt = a * a;               // steep: cream stays close to the disc
  float core = pow(a, 7.0);
  // Hue walk blue -> lilac -> peach -> cream, all in Oklab with chroma kept (no grey).
  vec3 lilac = mix(uSkyHues[1], vec3(0.6, 0.55, 0.68), 0.22);
  vec3 halo = mix(lilac, uSkyPeach, smoothstep(0.25, 0.75, a));
  halo = mix(halo, uSkyHues[2], core);
  vec3 skyO = toOklab(sky), haloO = toOklab(halo);
  vec3 mO = mix(skyO, haloO, skirt);
  float cS = length(skyO.yz), cH = length(haloO.yz), cM = length(mO.yz);
  float cT = mix(cS, cH, skirt);
  if (cM > 1e-5) mO.yz *= cT / cM;
  vec3 mixed = fromOklab(mO);
  mixed *= 1.0 + 0.3 * core;
  // Gold haze low on the horizon under the Sun.
  float gold = (1.0 - smoothstep(0.0, 0.16, el)) * smoothstep(0.55, 0.95, mu);
  mixed = mix(mixed, uGlowHue * luma(mixed) * 0.95 / max(luma(uGlowHue), 1e-4), gold * 0.55);
  vec3 painted = max(mixed, vec3(0.0)) * (uSkyRef / max(luma(uSkyHues[1]), 1e-4));
  return mix(c * (Lc / max(L, 1e-5)), painted, uSkyPaint.w);
}

float hgPhase(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1e-4, 1.0 + g2 - 2.0 * g * mu), 1.5));
}

// Painter's shadow hue rule (Oklab hue angles): greens and yellows lean toward blue-green,
// warm colours (reds, oranges, browns, rose) are pulled to burnt umber - never rose or oxblood.
vec3 shadeHue(vec3 c, float w) {
  if (w <= 0.0) return c;
  vec3 o = toOklab(c);
  float C = length(o.yz);
  if (C < 1e-4) return c;
  float hd = degrees(atan(o.z, o.y));
  if (hd < 0.0) hd += 360.0;
  float target;
  if (hd >= 85.0 && hd < 200.0) target = hd + 24.0;      // yellow-green -> green / blue-green
  else if (hd >= 200.0 && hd < 300.0) target = hd;        // blues stay
  else target = 62.0;                                      // warm (incl. rose/magenta) -> umber
  float d = target - hd;
  if (d > 180.0) d -= 360.0;
  if (d < -180.0) d += 360.0;
  float hn = radians(hd + d * clamp(w, 0.0, 1.0));
  o.yz = vec2(cos(hn), sin(hn)) * C;
  return max(fromOklab(o), vec3(0.0));
}

// ---- Painter's light (docs/ART_DIRECTION.md section 2).
// albedo: linear; N: shading normal; shadow: sun visibility 0..1; ao: ambient occlusion 0..1.
vec3 painterLight(vec3 albedo, vec3 N, float shadow, float ao) {
  float k = painterK();
  float ndl = dot(N, uSunDir);
  float w = 0.2 * k;
  float dif = clamp((ndl + w) / (1.0 + w), 0.0, 1.0);
  dif = mix(dif, smoothstep(-0.05, 0.55, ndl), 0.5 * k);
  float lit = dif * shadow;
  // Warm chroma bleed at the terminator.
  float term = exp(-sq((ndl - 0.05) / 0.15)) * shadow;
  vec3 a2 = k > 0.5 ? chromaScale(albedo, 1.0 + 0.25 * term) : albedo;
  vec3 sunC = mix(uSunColor, vec3(luma(uSunColor)), (1.0 - uSunChroma) * k);
  vec3 sun = sunC * mix(vec3(1.0), uSunWarm, k) * lit;
  // Fill: sky/bounce hemisphere plus anti-solar sky light, so form reads in shadow.
  vec3 Lflat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(0.0, 1e-4, 0.0));
  vec3 amb = mix(uGroundBounce, uSkyZenith, 0.5 + 0.5 * N.y);
  amb += 0.12 * uSkyHorizon * max(dot(N, -Lflat), 0.0) * k;
  // Cast shadow on a face that would be sunlit: a painter fills it with cool sky light and
  // reflected light from the sunlit surroundings, so shadows keep colour and form
  // (lit : shadow ~ 5 : 1, not 20 : 1) and shift 15-40 deg toward blue-green.
  float castShade = (1.0 - shadow) * saturate(ndl * 2.0 + 0.3);
  // Elsewhere painters warm the fill a little (umber-olive form shadows).
  amb = mix(amb, vec3(luma(amb)) * vec3(1.05, 0.98, 0.9), 0.5 * k * (1.0 - castShade)) * mix(1.0, 0.8, k * (1.0 - castShade));
  vec3 hueN = uShadowHue / max(luma(uShadowHue), 1e-4);
  vec3 fill = amb * mix(vec3(1.0), hueN, 0.12 * k * (1.0 - lit)) * mix(1.0, ao, 0.85 * (1.0 - 0.5 * castShade));
  // Mostly neutral with a modest cool lean (shaded grass reads olive / blue-green, not teal).
  vec3 skyN = uSkyZenith / max(luma(uSkyZenith), 1e-4);
  vec3 skyCool = mix(vec3(1.0), mix(skyN, hueN, 0.4), 0.3) * luma(uSkyZenith + uSkyHorizon);
  fill += skyCool * uPainter.z * castShade * k * mix(1.0, ao, 0.5);
  vec3 col = a2 * (sun + fill);
  // Shadows deepen in hue and chroma, not only in value.
  // The hue rule acts on cast shadow and on faces turned from the Sun, never on lit ground.
  float shadeW = max(1.0 - shadow, 1.0 - smoothstep(-0.15, 0.2, ndl));
  if (k > 0.5) col = shadeHue(chromaScale(col, 1.0 + 0.1 * (1.0 - lit) + 0.25 * castShade), shadeW * uPainter.x);
  return col;
}

// ---- Painted distance: aerial perspective (exaggerated, toward the distance hue)
// plus a ground haze layer measured from the camera's height above the ground
// (warm gold toward the Sun, mauve-grey elsewhere). rel = camera-relative position.
// uFog: x haze density at the ground, y 1/haze height, z unused, w haze phase g.
// uFog2: x aerial glow strength, y haze glow strength.
float layerDepth(float d, float dh, float h0, float H) {
  float x = dh / H;
  float f = abs(x) > 1e-3 ? (1.0 - exp(-x)) / x : 1.0 - 0.5 * x;
  return d * exp(-h0 / H) * f;
}
vec3 applyAerial(vec3 col, vec3 rel, float d) {
  float k = painterK();
  vec3 V = rel / max(d, 1e-3);
  float scale = mix(1.0, uPainter.y, k);
  float odA = uAtmo.x * layerDepth(d, rel.y, max(uCamAlt - uFog.z, -100.0), uAtmo.y) * scale;
  float odF = min(uFog.x * layerDepth(d, rel.y, max(uCamAGL, 0.0), 1.0 / uFog.y) * scale, uFog.z);
  float od = odA + odF;
  float T = exp(-od);
  float mu = dot(V, uSunDir);
  // Aerial inscatter: horizon sky radiance in this direction, pushed toward the
  // world's cool distance hue with distance, plus a small warm Mie lobe.
  vec3 Vh = normalize(vec3(V.x, max(V.y, 0.0) * 0.5 + uAtmo2.x, V.z));
  // A finite path inscatters less than the infinite sky behind it: distant forms
  // stay a step darker than the sky (the painted halo already carries the glow).
  vec3 insA = paintSky(skyLut(Vh), Vh) * mix(1.0, 0.58, k);
  insA += uGlowHue * luma(uSunColor) * 0.02 * uFog2.x * min(hgPhase(mu, uAtmo2.y) * 4.0 * PI, 4.0) * k;
  float dm = uAtmo.z * (0.6 * smoothstep(300.0, 3000.0, d) + 0.4 * smoothstep(3000.0, 9000.0, d)) * k;
  vec3 dh3 = uDistanceHue / max(luma(uDistanceHue), 1e-4);
  insA = mix(insA, luma(insA) * dh3, dm);
  // Ground haze: lit by the sky, glowing gold toward the Sun. Far away it hands
  // over to the aerial colour so distant ridges stay cool and below the sky.
  float ph = hgPhase(mu, uFog.w) * 4.0 * PI;
  vec3 insF = uHazeColor * luma(uSkyZenith + uSkyHorizon) * 0.9
            + mix(uHazeColor, uGlowHue, 0.75) * luma(uSunColor) * 0.06 * ph * uFog2.y;
  insF = mix(insF, insA, smoothstep(600.0, 3000.0, d));
  vec3 ins = (insA * odA + insF * odF) / max(od, 1e-6);
  vec3 r = col * T + ins * (1.0 - T);
  if (k > 0.5) {
    // Keep chroma: haze passes through mauve, never through grey.
    vec3 oR = toOklab(r);
    vec3 oS = toOklab(col), oI = toOklab(ins);
    float cR = length(oR.yz), cT = uAtmo.w * mix(length(oS.yz), length(oI.yz), 1.0 - T);
    if (cR > 1e-5 && cR < cT) oR.yz *= cT / cR;
    r = max(fromOklab(oR), vec3(0.0));
  }
  return r;
}
`;
