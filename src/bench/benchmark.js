// Scripted benchmark flight through every bookmark (3 minutes) or a 10-minute
// soak (the same route repeated). Records rendered-frame intervals into a
// preallocated buffer and reports average / 1% low fps, resolution and
// governor activity.

const D2R = Math.PI / 180;

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function lerpAngle(a, b, t) {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}
const ease = (t) => t * t * (3 - 2 * t);

export class Benchmark {
  constructor(world, heightAt) {
    this.world = world;
    this.heightAt = heightAt;
    this.active = false;
    this.samples = new Float32Array(60 * 60 * 11); // up to 11 minutes at 60 fps
    this.res = new Float32Array(this.samples.length); // rendered megapixels per frame
    this.n = 0;
    this.buildRoute();
  }

  buildRoute() {
    const W = this.world;
    const bm = Object.fromEntries(W.bookmarks.map((b) => [b.name, b]));
    const keys = [];
    let t = 0;
    for (const k of W.benchmark.route) {
      const b = bm[k.b];
      const y = b.mode === 'fly' ? this.heightAt(b.pos[0], b.pos[2]) + b.height : this.heightAt(b.pos[0], b.pos[2]) + 1.7;
      if (keys.length) t += k.travel;
      keys.push({ t, x: b.pos[0], y, z: b.pos[2], yaw: b.yaw, pitch: b.pitch, hold: k.hold, pan: k.pan || 25 });
      t += k.hold;
    }
    this.keys = keys;
    this.routeDuration = t;
  }

  start(minutes, governor) {
    this.minutes = minutes;
    this.duration = minutes * 60;
    this.time = 0;
    this.n = 0;
    this.active = true;
    this.gov = governor;
    this.govSteps0 = governor.steps;
    this.govDown0 = governor.stepsDown;
    this.govUp0 = governor.stepsUp;
    this.minRes = 1e9;
  }

  /** Advance the scripted camera. Returns pose {x,y,z,yaw,pitch} in degrees. */
  pose(out) {
    const K = this.keys;
    let tt = (this.time * (this.routeDuration / Math.min(this.duration, 180))) % this.routeDuration;
    if (this.minutes > 3) tt = this.time % this.routeDuration;
    // Find segment.
    for (let i = 0; i < K.length; i++) {
      const k = K[i];
      if (tt <= k.t + k.hold || i === K.length - 1) {
        if (tt >= k.t) {
          // Holding at a bookmark: slow pan around it.
          const h = Math.min(1, (tt - k.t) / Math.max(1, k.hold));
          out.x = k.x; out.y = k.y; out.z = k.z;
          out.yaw = k.yaw + Math.sin(h * Math.PI * 2) * k.pan * 0.5;
          out.pitch = k.pitch;
          return out;
        }
        // Travelling from K[i-1] to K[i].
        const a = K[i - 1], b = k;
        const p0 = K[Math.max(0, i - 2)], p3 = K[Math.min(K.length - 1, i + 1)];
        const u = ease((tt - (a.t + a.hold)) / Math.max(0.001, b.t - (a.t + a.hold)));
        out.x = catmull(p0.x, a.x, b.x, p3.x, u);
        out.z = catmull(p0.z, a.z, b.z, p3.z, u);
        const ground = this.heightAt(out.x, out.z);
        const lift = Math.sin(u * Math.PI) * 25; // hop over the canopy between stops
        out.y = Math.max(catmull(p0.y, a.y, b.y, p3.y, u) + lift, ground + 1.7);
        out.yaw = ((lerpAngle(a.yaw, b.yaw, u) % 360) + 360) % 360;
        out.pitch = a.pitch + (b.pitch - a.pitch) * u;
        return out;
      }
    }
    return out;
  }

  record(intervalMs, megapixels, dt) {
    const longSide = megapixels;
    if (!this.active) return false;
    if (this.n < this.samples.length) {
      this.samples[this.n] = intervalMs;
      this.res[this.n] = longSide;
      this.n++;
    }
    if (longSide < this.minRes) this.minRes = longSide;
    this.time += dt;
    return this.time >= this.duration;
  }

  progress() { return `${Math.floor(this.time)}s / ${this.duration}s`; }

  report(info) {
    this.active = false;
    const n = this.n;
    const s = Array.from(this.samples.subarray(0, n));
    const total = s.reduce((a, b) => a + b, 0);
    const avgFps = (n * 1000) / Math.max(1, total);
    const sorted = s.slice().sort((a, b) => b - a);
    const worst = sorted.slice(0, Math.max(1, Math.floor(n * 0.01)));
    const low1 = 1000 / (worst.reduce((a, b) => a + b, 0) / worst.length);
    const p99 = sorted[Math.floor(n * 0.01)] || 0;
    let resSum = 0;
    for (let i = 0; i < n; i++) resSum += this.res[i];
    const lines = [
      `Benchmark ${this.minutes} min · ${info.world}`,
      `avg fps        ${avgFps.toFixed(1)}`,
      `1% low fps     ${low1.toFixed(1)}  (p99 frame ${p99.toFixed(1)} ms)`,
      `frames         ${n}  over ${(total / 1000).toFixed(1)} s`,
      `render res     avg ${(resSum / Math.max(1, n)).toFixed(2)} MP  min ${this.minRes === 1e9 ? '-' : this.minRes.toFixed(2)} MP  (native ${info.native})`,
      `governor       ${this.gov.steps - this.govSteps0} steps (${this.gov.stepsDown - this.govDown0} down, ${this.gov.stepsUp - this.govUp0} up), end ${this.gov.label()}`,
      `target         ${info.targetFps} fps cap, display ~${info.vsyncHz} Hz`,
      `GPU            ${info.gpu}`,
      `mode           ${info.mode}`,
      `HDR / MSAA     ${info.hdr} / ${info.samples}x`,
      `screen         ${info.screen}  dpr ${info.dpr}  canvas ${info.canvas}`,
      `three.js       r${info.three}`,
      `build          ${info.commit}`,
      `ua             ${navigator.userAgent}`,
    ];
    return lines.join('\n');
  }
}

export { D2R };
