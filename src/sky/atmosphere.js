// Physically based single-scattering atmosphere (Rayleigh + Mie + ozone) computed
// on the CPU into small lookup tables: a transmittance table and a sky-view LUT
// (azimuth relative to the Sun x elevation, dense near the horizon). Also derives
// the direct sun colour and ambient terms the painter's-light shader uses.
// All parameters come from world.atmosphere. Values are radiance in "sun units"
// (sunIntensity), already divided by pi where they feed Lambertian shading.
import * as THREE from 'three';

export const SKY_W = 128, SKY_H = 64;
const TR_H = 64, TR_MU = 128;

export class Atmosphere {
  constructor(p) {
    this.p = p;
    this.Rg = p.planetRadius;
    this.Rt = p.planetRadius + p.atmosphereHeight;
    this.trans = new Float32Array(TR_H * TR_MU * 3);
    this.msFactor = p.multiScatter ?? 0.05;
    this.buildTransmittance();
  }

  // ---- medium
  sample(h, out) {
    const p = this.p;
    const rr = Math.exp(-Math.max(0, h) / p.rayleighScaleHeight);
    const rm = Math.exp(-Math.max(0, h) / p.mieScaleHeight);
    const ro = Math.max(0, 1 - Math.abs(h - p.ozoneCenter) / p.ozoneWidth);
    for (let c = 0; c < 3; c++) {
      const sR = p.rayleighScattering[c] * rr;
      const sM = p.mieScattering[c] * rm;
      out.sR[c] = sR; out.sM[c] = sM;
      out.ext[c] = sR + sM + p.mieAbsorption[c] * rm + p.ozoneAbsorption[c] * ro;
    }
  }

  // Distance to the top of the atmosphere (or -1 if blocked by the ground, when ground=true).
  rayLength(r, mu, ground) {
    const disc = r * r * (mu * mu - 1) + this.Rt * this.Rt;
    const dTop = -r * mu + Math.sqrt(Math.max(0, disc));
    if (ground) {
      const dg = r * r * (mu * mu - 1) + this.Rg * this.Rg;
      if (mu < 0 && dg >= 0) return { d: -r * mu - Math.sqrt(dg), hitGround: true };
    }
    return { d: dTop, hitGround: false };
  }

  buildTransmittance() {
    const m = { sR: [0, 0, 0], sM: [0, 0, 0], ext: [0, 0, 0] };
    const H = this.Rt - this.Rg;
    for (let j = 0; j < TR_H; j++) {
      const h = (j / (TR_H - 1)) ** 2 * H;
      const r = this.Rg + h;
      for (let i = 0; i < TR_MU; i++) {
        const mu = -1 + 2 * i / (TR_MU - 1);
        const { d, hitGround } = this.rayLength(r, mu, true);
        const k = (j * TR_MU + i) * 3;
        if (hitGround) { this.trans[k] = this.trans[k + 1] = this.trans[k + 2] = 0; continue; }
        const n = 40, ds = d / n;
        let o0 = 0, o1 = 0, o2 = 0;
        for (let s = 0; s < n; s++) {
          const t = (s + 0.5) * ds;
          const hs = Math.sqrt(r * r + t * t + 2 * r * mu * t) - this.Rg;
          this.sample(hs, m);
          o0 += m.ext[0] * ds; o1 += m.ext[1] * ds; o2 += m.ext[2] * ds;
        }
        this.trans[k] = Math.exp(-o0); this.trans[k + 1] = Math.exp(-o1); this.trans[k + 2] = Math.exp(-o2);
      }
    }
  }

  transmittance(h, mu, out) {
    const H = this.Rt - this.Rg;
    const fj = Math.sqrt(Math.max(0, Math.min(1, h / H))) * (TR_H - 1);
    const fi = (Math.max(-1, Math.min(1, mu)) + 1) * 0.5 * (TR_MU - 1);
    const j0 = Math.min(TR_H - 2, Math.floor(fj)), i0 = Math.min(TR_MU - 2, Math.floor(fi));
    const tj = fj - j0, ti = fi - i0;
    for (let c = 0; c < 3; c++) {
      const a = this.trans[(j0 * TR_MU + i0) * 3 + c], b = this.trans[(j0 * TR_MU + i0 + 1) * 3 + c];
      const cc = this.trans[((j0 + 1) * TR_MU + i0) * 3 + c], d = this.trans[((j0 + 1) * TR_MU + i0 + 1) * 3 + c];
      out[c] = (a + (b - a) * ti) * (1 - tj) + (cc + (d - cc) * ti) * tj;
    }
    return out;
  }

  /**
   * Compute the sky-view LUT and lighting terms for a sun direction (local frame, +Y up).
   * Returns { lut: Float32Array RGBA, sunColor, skyZenith, skyHorizon, groundBounce, sunDiskColor }.
   */
  compute(sunDir, cameraAlt = 200) {
    const p = this.p;
    const E = p.sunIntensity;
    const sol = p.solarIrradiance;
    const g = p.mieG;
    const muS = sunDir[1];
    const lut = new Float32Array(SKY_W * SKY_H * 4);
    const m = { sR: [0, 0, 0], sM: [0, 0, 0], ext: [0, 0, 0] };
    const tSun = [0, 0, 0];
    const r0 = this.Rg + cameraAlt;
    const sunAz = Math.atan2(sunDir[0], -sunDir[2]);
    const cosE = Math.sqrt(Math.max(0, 1 - muS * muS));
    for (let y = 0; y < SKY_H; y++) {
      const v = (y + 0.5) / SKY_H;
      const sv = v * 2 - 1;
      const el = Math.sign(sv) * sv * sv * (Math.PI / 2);
      for (let x = 0; x < SKY_W; x++) {
        const az = ((x + 0.5) / SKY_W) * Math.PI; // relative to the Sun (symmetric)
        const dir = [Math.cos(el) * Math.sin(sunAz + az), Math.sin(el), -Math.cos(el) * Math.cos(sunAz + az)];
        const cosTheta = dir[0] * sunDir[0] + dir[1] * sunDir[1] + dir[2] * sunDir[2];
        const pr = 3 / (16 * Math.PI) * (1 + cosTheta * cosTheta);
        const k = 3 / (8 * Math.PI) * (1 - g * g) / (2 + g * g);
        const pm = k * (1 + cosTheta * cosTheta) / Math.pow(1 + g * g - 2 * g * cosTheta, 1.5);
        const mu = dir[1];
        const { d, hitGround } = this.rayLength(r0, mu, true);
        const n = 32;
        const L = [0, 0, 0], T = [1, 1, 1];
        let prevT = 0;
        for (let s = 0; s < n; s++) {
          // Non-uniform steps: dense near the camera.
          const t0 = d * (s / n) ** 2, t1 = d * ((s + 1) / n) ** 2;
          const t = 0.5 * (t0 + t1), ds = t1 - t0;
          const rs = Math.sqrt(r0 * r0 + t * t + 2 * r0 * mu * t);
          const hs = rs - this.Rg;
          this.sample(hs, m);
          // Sun zenith cosine at the sample.
          const px = dir[0] * t, py = r0 + dir[1] * t, pz = dir[2] * t;
          const muSs = (px * sunDir[0] + py * sunDir[1] + pz * sunDir[2]) / rs;
          this.transmittance(hs, muSs, tSun);
          for (let c = 0; c < 3; c++) {
            const scat = m.sR[c] * pr + m.sM[c] * pm;
            // Cheap multiple-scattering term: isotropic, proportional to sun-lit scattering.
            const ms = (m.sR[c] + m.sM[c]) * this.msFactor * Math.max(0.05, tSun[c]) * (0.4 + 0.6 * Math.max(0, muS + 0.1));
            const sampleT = Math.exp(-m.ext[c] * ds);
            const Sint = (scat * tSun[c] + ms) * E * sol[c];
            L[c] += T[c] * Sint * (1 - sampleT) / Math.max(1e-12, m.ext[c]);
            T[c] *= sampleT;
          }
          prevT = t;
        }
        if (hitGround) {
          // Lambertian ground seen through the atmosphere.
          this.transmittance(0, muS, tSun);
          for (let c = 0; c < 3; c++) L[c] += T[c] * p.groundAlbedo[c] / Math.PI * E * sol[c] * tSun[c] * Math.max(0, muS);
        }
        const o = (y * SKY_W + x) * 4;
        lut[o] = L[0]; lut[o + 1] = L[1]; lut[o + 2] = L[2]; lut[o + 3] = 1;
      }
    }

    // Direct sun at the ground (irradiance / pi for Lambert).
    const tg = this.transmittance(cameraAlt, muS, [0, 0, 0]);
    const sunColor = [0, 1, 2].map((c) => E * sol[c] * tg[c] / Math.PI);
    // Sky irradiance on an up-facing surface and on vertical surfaces (from the LUT).
    const lookup = (dx, dy, dz, out) => {
      const elv = Math.asin(Math.max(-1, Math.min(1, dy)));
      const a = Math.atan2(dx, -dz) - sunAz;
      let rel = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) / Math.PI;
      const vv = 0.5 + 0.5 * Math.sign(elv) * Math.sqrt(Math.abs(elv) / (Math.PI / 2));
      const xi = Math.min(SKY_W - 1, Math.floor(rel * SKY_W)), yi = Math.min(SKY_H - 1, Math.floor(vv * SKY_H));
      const o = (yi * SKY_W + xi) * 4;
      out[0] = lut[o]; out[1] = lut[o + 1]; out[2] = lut[o + 2];
      return out;
    };
    const irr = (nx, ny, nz) => {
      const acc = [0, 0, 0], tmp = [0, 0, 0];
      const NE = 12, NA = 24;
      for (let j = 0; j < NE; j++) {
        const elv = ((j + 0.5) / NE) * Math.PI / 2;
        for (let i = 0; i < NA; i++) {
          const a = ((i + 0.5) / NA) * Math.PI * 2;
          const dx = Math.cos(elv) * Math.sin(a), dy = Math.sin(elv), dz = -Math.cos(elv) * Math.cos(a);
          const cw = dx * nx + dy * ny + dz * nz;
          if (cw <= 0) continue;
          const dOmega = Math.cos(elv) * (Math.PI / 2 / NE) * (2 * Math.PI / NA);
          lookup(dx, dy, dz, tmp);
          for (let c = 0; c < 3; c++) acc[c] += tmp[c] * cw * dOmega;
        }
      }
      return acc;
    };
    const eUp = irr(0, 1, 0);
    const sx = Math.sin(sunAz), sz = -Math.cos(sunAz);
    const eSide = irr(-sx, 0, -sz).map((v, c) => 0.5 * (v + irr(sx, 0, sz)[c]));
    const skyZenith = eUp.map((v) => v / Math.PI);
    const skyHorizon = eSide.map((v) => v / Math.PI);
    const ground = [0, 1, 2].map((c) => p.groundAlbedo[c] * (sunColor[c] * Math.PI * Math.max(0, muS) + eUp[c]) / Math.PI);
    const sunDiskColor = [0, 1, 2].map((c) => E * sol[c] * tg[c]);
    const ha = lookup(-sx * 0.996, 0.087, -sz * 0.996, [0, 0, 0]);
    const ha2 = lookup(sz * 0.996, 0.087, -sx * 0.996, [0, 0, 0]);
    const horizonAway = 0.5 * ((0.2126 * ha[0] + 0.7152 * ha[1] + 0.0722 * ha[2]) + (0.2126 * ha2[0] + 0.7152 * ha2[1] + 0.0722 * ha2[2]));
    return { lut, sunColor, skyZenith, skyHorizon, groundBounce: ground, sunDiskColor, cosE, horizonAway };
  }

  static makeTexture() {
    const t = new THREE.DataTexture(new Uint16Array(SKY_W * SKY_H * 4), SKY_W, SKY_H, THREE.RGBAFormat, THREE.HalfFloatType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.name = 'sky-view-lut';
    return t;
  }

  static upload(tex, lut) {
    const d = tex.image.data;
    for (let i = 0; i < lut.length; i++) d[i] = THREE.DataUtils.toHalfFloat(Math.min(65000, lut[i]));
    tex.needsUpdate = true;
  }
}
