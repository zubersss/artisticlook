// requestAnimationFrame loop with frame pacing.
// V = display vsync period (median rAF interval, snapped to common refresh rates,
// re-measured continuously: the S23 switches between 120 and 60 Hz).
// T = target frame time (16.7 ms, or 33.3 ms in battery mode). We render every
// d = round(T / V) vsyncs; skipped callbacks make no GL calls. A rendered frame is a
// "miss" when more than d vsyncs passed since the previous one.
// Burst mode renders every vsync for N frames (uncapped) so the governor can
// measure real frame cost on >= 90 Hz screens without GPU timer queries.

const SNAP = [1000 / 144, 1000 / 120, 1000 / 90, 1000 / 60, 1000 / 30];

export class Loop {
  constructor(onFrame) {
    this.onFrame = onFrame; // (dtSec, intervalMs, missed, cpuMs)
    this.targetFps = 60;
    this.running = false;
    this.raf = 0;
    this.lastRaf = 0;
    this.lastRender = 0;
    this.vsync = 1000 / 60;
    this.deltas = new Float32Array(64);
    this.sorted = new Float32Array(64);
    this.head = 0; this.count = 0; this.sinceEstimate = 0;
    this.burstLeft = 0; this.burstSum = 0; this.burstN = 0; this.burstCb = null;
    this.cpuMs = 0;
    this._tick = (t) => this.tick(t);
    this.manual = false;
  }

  setTargetFps(fps) { this.targetFps = fps; }
  get divisor() { return Math.max(1, Math.round(1000 / this.targetFps / this.vsync)); }

  start() {
    if (this.running || this.manual) return;
    this.running = true;
    this.lastRaf = 0; this.lastRender = 0;
    this.raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.burstLeft = 0;
  }

  /** Render the next n frames on every vsync; cb(meanIntervalMs) afterwards. */
  requestBurst(n, cb) {
    this.burstLeft = n; this.burstSum = 0; this.burstN = -1; this.burstCb = cb;
  }

  estimate() {
    const n = this.count;
    if (n < 16) return;
    this.sorted.set(this.deltas);
    const med = this.sorted.subarray(0, n).sort()[n >> 1];
    let best = SNAP[0], bd = 1e9;
    for (let i = 0; i < SNAP.length; i++) { const d = Math.abs(SNAP[i] - med); if (d < bd) { bd = d; best = SNAP[i]; } }
    this.vsync = best;
  }

  tick(t) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this._tick);
    if (this.lastRaf > 0) {
      const d = t - this.lastRaf;
      if (d > 2 && d < 60) {
        this.deltas[this.head] = d;
        this.head = (this.head + 1) & 63;
        if (this.count < 64) this.count++;
        if (++this.sinceEstimate >= 32) { this.sinceEstimate = 0; this.estimate(); }
      }
    }
    this.lastRaf = t;
    const V = this.vsync;
    const div = this.burstLeft > 0 ? 1 : this.divisor;
    let vs = div;
    if (this.lastRender > 0) {
      vs = Math.round((t - this.lastRender) / V);
      if (vs < div) return;
    }
    const interval = this.lastRender > 0 ? t - this.lastRender : div * V;
    this.lastRender = t;
    const missed = vs > div;
    if (this.burstLeft > 0) {
      if (this.burstN >= 0) { this.burstSum += interval; }
      this.burstN++;
      if (--this.burstLeft === 0) {
        const cb = this.burstCb; this.burstCb = null;
        const mean = this.burstN > 0 ? this.burstSum / this.burstN : 1e9;
        cb && cb(mean);
      }
    }
    const c0 = performance.now();
    this.onFrame(Math.min(interval, 100) / 1000, interval, missed && this.burstLeft === 0, this.cpuMs);
    this.cpuMs = performance.now() - c0;
  }
}
