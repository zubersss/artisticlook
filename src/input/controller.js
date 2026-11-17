// Walk / fly camera controller working in 64-bit world coordinates.
// yaw: radians clockwise from north (-Z); pitch: radians, positive looks up.
import * as THREE from 'three';

const D2R = Math.PI / 180;

export class Controller {
  constructor(heightAt, opts = {}) {
    this.heightAt = heightAt; // (x, z) -> ground height (m)
    this.pos = new Float64Array(3);
    this.yaw = 0; this.pitch = 0;
    this.mode = 'walk';
    this.eye = opts.eyeHeight ?? 1.7;
    this.walkSpeed = opts.walkSpeed ?? 2.2;
    this.runSpeed = opts.runSpeed ?? 6.5;
    this.flySpeed = opts.flySpeed ?? 14;
    this.flyFast = opts.flyFast ?? 60;
    this.groundY = 0;
    this.look = { yaw: 0, pitch: 0 };
    this.bounds = opts.bounds || null; // { minX, maxX, minZ, maxZ } walkable patch
  }

  setPose(x, y, z, yawDeg, pitchDeg, mode) {
    this.mode = mode || this.mode;
    this.yaw = yawDeg * D2R; this.pitch = pitchDeg * D2R;
    const g = this.heightAt(x, z);
    this.pos[0] = x; this.pos[2] = z;
    this.pos[1] = y == null ? g + this.eye : y;
    this.groundY = g;
  }

  update(dt, input) {
    input.consumeLook(this.look);
    this.yaw += this.look.yaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + this.look.pitch, -85 * D2R, 85 * D2R);
    const mx = input.move.x, my = input.move.y;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    if (this.mode === 'walk') {
      const sp = input.sprint ? this.runSpeed : this.walkSpeed;
      this.pos[0] += (sy * my + cy * mx) * sp * dt;
      this.pos[2] += (-cy * my + sy * mx) * sp * dt;
      if (this.bounds) {
        const b = this.bounds;
        this.pos[0] = Math.min(b.maxX, Math.max(b.minX, this.pos[0]));
        this.pos[2] = Math.min(b.maxZ, Math.max(b.minZ, this.pos[2]));
      }
      const g = this.heightAt(this.pos[0], this.pos[2]);
      // Critically damped follow of the ground: no jitter over small bumps.
      this.groundY += (g - this.groundY) * Math.min(1, dt * 10);
      this.pos[1] = this.groundY + this.eye;
    } else {
      const sp = input.sprint ? this.flyFast : this.flySpeed;
      const sp_ = Math.sin(this.pitch), cp = Math.cos(this.pitch);
      this.pos[0] += (sy * cp * my + cy * mx) * sp * dt;
      this.pos[1] += (sp_ * my + input.vertical) * sp * dt;
      this.pos[2] += (-cy * cp * my + sy * mx) * sp * dt;
      const g = this.heightAt(this.pos[0], this.pos[2]);
      if (this.pos[1] < g + 1.0) this.pos[1] = g + 1.0;
      this.groundY = g;
    }
  }

  /** Orient the three.js camera (which stays at the origin). */
  apply(camera) {
    camera.position.set(0, 0, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, -this.yaw, 0);
    camera.updateMatrixWorld(true);
  }
}
