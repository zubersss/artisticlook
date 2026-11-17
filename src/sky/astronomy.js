// Generic ephemeris: Keplerian heliocentric orbit for the planet, IAU pole +
// prime-meridian rotation for the body-fixed frame, optional Keplerian
// satellites. Everything planet-specific comes from the world file.
// Output directions are in the engine's local frame: +X east, +Y up, -Z north.

const D2R = Math.PI / 180;
const AU_KM = 149597870.7;

function wrap360(a) { a %= 360; return a < 0 ? a + 360 : a; }

function solveKepler(M, e) {
  let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

// Position in the reference plane frame (ecliptic J2000) from classical elements (degrees).
function keplerPosition(a, e, iDeg, nodeDeg, argPeriDeg, meanAnomDeg, out) {
  const M = wrap360(meanAnomDeg) * D2R;
  const E = solveKepler(M, e);
  const xv = a * (Math.cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const N = nodeDeg * D2R, i = iDeg * D2R, w = argPeriDeg * D2R;
  const vw = v + w;
  out[0] = r * (Math.cos(N) * Math.cos(vw) - Math.sin(N) * Math.sin(vw) * Math.cos(i));
  out[1] = r * (Math.sin(N) * Math.cos(vw) + Math.cos(N) * Math.sin(vw) * Math.cos(i));
  out[2] = r * Math.sin(vw) * Math.sin(i);
  return out;
}

// Ecliptic J2000 -> equatorial J2000 (ICRF-aligned).
function eclToEq(v, out) {
  const eps = 23.4392911 * D2R;
  const y = v[1] * Math.cos(eps) - v[2] * Math.sin(eps);
  const z = v[1] * Math.sin(eps) + v[2] * Math.cos(eps);
  out[0] = v[0]; out[1] = y; out[2] = z;
  return out;
}

function rotZ(v, ang, out) { const c = Math.cos(ang), s = Math.sin(ang); const x = c * v[0] + s * v[1], y = -s * v[0] + c * v[1]; out[0] = x; out[1] = y; out[2] = v[2]; return out; }
function rotX(v, ang, out) { const c = Math.cos(ang), s = Math.sin(ang); const y = c * v[1] + s * v[2], z = -s * v[1] + c * v[2]; out[0] = v[0]; out[1] = y; out[2] = z; return out; }

// Days since J2000.0 (TT ~ UTC here; the difference is irrelevant for visuals).
export function daysSinceJ2000(isoUtc) {
  return (Date.parse(isoUtc) - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86400000;
}

/**
 * Compute sky directions for a world at a given time.
 * @param {object} astro world.astronomy block
 * @param {number} d days since J2000
 * @returns {{sun:number[], sunAlt:number, sunAz:number, moons:Array<{dir:number[],alt:number,az:number,angularRadius:number,illum:number}>}}
 */
export function computeSky(astro, d, result) {
  const T = d / 36525;
  const o = astro.orbit;
  const L = o.L0 + o.Ldot * T, wbar = o.wbar0 + o.wbarDot * T, node = o.node0 + o.nodeDot * T;
  const helio = keplerPosition(o.a, o.e, o.i, node, wbar - node, L - wbar, [0, 0, 0]);
  // Sun as seen from the planet, equatorial J2000.
  const sunEq = eclToEq([-helio[0], -helio[1], -helio[2]], [0, 0, 0]);

  // ICRF -> body fixed: Rz(W) Rx(90-dec0) Rz(90+ra0)
  const p = astro.pole;
  const ra0 = (p.ra0 + p.raDot * T) * D2R, dec0 = (p.dec0 + p.decDot * T) * D2R;
  const W = wrap360(p.W0 + p.Wdot * d) * D2R;
  const toBody = (v, out) => { rotZ(v, Math.PI / 2 + ra0, out); rotX(out, Math.PI / 2 - dec0, out); rotZ(out, W, out); return out; };
  const fromBody = (v, out) => { rotZ(v, -W, out); rotX(out, -(Math.PI / 2 - dec0), out); rotZ(out, -(Math.PI / 2 + ra0), out); return out; };

  const lat = astro.latitude * D2R, lon = astro.longitude * D2R;
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const toLocal = (bodyVec) => {
    const len = Math.hypot(bodyVec[0], bodyVec[1], bodyVec[2]);
    const u = (bodyVec[0] * up[0] + bodyVec[1] * up[1] + bodyVec[2] * up[2]) / len;
    const e = (bodyVec[0] * east[0] + bodyVec[1] * east[1] + bodyVec[2] * east[2]) / len;
    const n = (bodyVec[0] * north[0] + bodyVec[1] * north[1] + bodyVec[2] * north[2]) / len;
    return { dir: [e, u, -n], alt: Math.asin(Math.max(-1, Math.min(1, u))) / D2R, az: wrap360(Math.atan2(e, n) / D2R) };
  };

  const sunBody = toBody(sunEq, [0, 0, 0]);
  const sun = toLocal(sunBody);
  const res = result || {};
  res.sun = sun.dir; res.sunAlt = sun.alt; res.sunAz = sun.az;
  res.sunDistanceAU = Math.hypot(helio[0], helio[1], helio[2]);
  res.moons = [];

  const radiusKm = astro.radiusKm;
  const observerBody = [up[0] * radiusKm, up[1] * radiusKm, up[2] * radiusKm];
  const observerEq = fromBody(observerBody, [0, 0, 0]);
  for (const m of astro.moons || []) {
    const pos = keplerPosition(m.aKm, m.e, m.i, m.node0 + m.nodeDot * d, m.argPeri0 + m.argPeriDot * d, m.M0 + m.Mdot * d, [0, 0, 0]);
    const eq = m.frame === 'equatorial' ? pos : eclToEq(pos, [0, 0, 0]);
    // Topocentric: subtract the observer position (parallax).
    const topo = [eq[0] - observerEq[0], eq[1] - observerEq[1], eq[2] - observerEq[2]];
    const dist = Math.hypot(topo[0], topo[1], topo[2]);
    const loc = toLocal(toBody(topo, [0, 0, 0]));
    // Illuminated fraction from the Sun-Moon elongation (Sun treated as at infinity).
    const sunDirEq = [sunEq[0], sunEq[1], sunEq[2]];
    const sl = Math.hypot(sunDirEq[0], sunDirEq[1], sunDirEq[2]);
    const cosElong = (topo[0] * sunDirEq[0] + topo[1] * sunDirEq[1] + topo[2] * sunDirEq[2]) / (dist * sl);
    const illum = 0.5 * (1 - Math.max(-1, Math.min(1, cosElong)));
    res.moons.push({ dir: loc.dir, alt: loc.alt, az: loc.az, angularRadius: Math.atan(m.radiusKm / dist), illum, albedo: m.albedo, name: m.name });
  }
  return res;
}

export { AU_KM };
