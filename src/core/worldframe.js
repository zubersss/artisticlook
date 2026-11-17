// 64-bit world positions (JS numbers, metres) and camera-relative rendering.
// The three.js camera sits at the origin; every anchored object is placed at
// (anchor - camera) each frame, so the GPU only ever sees small offsets.
import { ENGINE } from './config.js';

export class WorldFrame {
  constructor() {
    this.cam = new Float64Array(3);
    this.camWrapped = new Float64Array(3); // cam mod ENGINE.wrapPeriod, in [0, period)
    this.anchors = [];
  }

  setCamera(x, y, z) {
    this.cam[0] = x; this.cam[1] = y; this.cam[2] = z;
    const p = ENGINE.wrapPeriod;
    this.camWrapped[0] = x - Math.floor(x / p) * p;
    this.camWrapped[1] = y - Math.floor(y / p) * p;
    this.camWrapped[2] = z - Math.floor(z / p) * p;
  }

  /** Keep `object3D` at world position (x, y, z). Returns the anchor record (mutable). */
  anchor(object3D, x, y, z) {
    const a = { object: object3D, x, y, z };
    this.anchors.push(a);
    return a;
  }

  update() {
    const c = this.cam;
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i];
      a.object.position.set(a.x - c[0], a.y - c[1], a.z - c[2]);
    }
  }

  /** Camera-relative position of a world point, written to a THREE.Vector3. */
  relative(x, y, z, out) {
    return out.set(x - this.cam[0], y - this.cam[1], z - this.cam[2]);
  }
}
