// Colour helpers. All shader colours are linear-light Vector3s built here; we do
// not use THREE.Color in uniforms so no implicit colour management applies.
import * as THREE from 'three';

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** '#rrggbb' or 0xrrggbb -> linear Vector3 (optionally scaled). */
export function lin(hex, scale = 1, out = new THREE.Vector3()) {
  const h = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
  return out.set(
    srgbToLinear(((h >> 16) & 255) / 255) * scale,
    srgbToLinear(((h >> 8) & 255) / 255) * scale,
    srgbToLinear((h & 255) / 255) * scale,
  );
}

export function linArray(hex) {
  const v = lin(hex);
  return [v.x, v.y, v.z];
}
