// Adaptive quality governor (no GPU timer queries exist on Chrome Android).
//
// Ladder, low -> high:
//   canopy 125 · canopy 175 · far shadow 6 s · far shadow 2 s · tufts off · tufts ½ · shafts off ·
//   1280 · 1440 · 1600 · 1800 · 2000 (internal long side)
// Going down lowers resolution first, then features in the brief's order (shafts, tufts,
// far-cascade rate, canopy quads); going up walks back in reverse.
//
// Step down: emergency (>= 8 misses in the last 30 frames -> 2 levels) or normal
// (>= 9 in the last 180 and >= 2 in the last 30 -> 1 level). Isolated misses are ignored.
// Step up: no misses for 240 frames, >= 4 s since the last change, CPU < 0.6 T, and a
// headroom check: on >= 90 Hz screens an uncapped 30-frame burst must show frame cost
// <= 0.72 T (one step costs ~1.23x, so 0.72 * 1.23 = 0.89 < 1: no oscillation); on 60 Hz
// screens a blind probe after probeWait. A probe that misses >= 3 of the next 120 frames
// steps back and blocks that level for min(8 s * 2^n, 128 s).
// Floor: at the lowest level with >= 5 % misses for 3 s, drop to 30 fps; retry 60 later.

const RES = [1280, 1440, 1600, 1800, 2000];
const FEATURES = [ // applied cumulatively, from the top of the feature section downward
  { label: 'shafts off', set: { shafts: false } },
  { label: 'tufts ½', set: { tufts: 0.5 } },
  { label: 'tufts off', set: { tufts: 0 } },
  { label: 'far shadow 2 s', set: { farShadowInterval: 2 } },
  { label: 'far shadow 6 s', set: { farShadowInterval: 6 } },
  { label: 'canopy 175', set: { canopyQuads: 175 / 250 } },
  { label: 'canopy 125', set: { canopyQuads: 125 / 250 } },
];

function buildLadder() {
  const base = { res: RES[0], shafts: true, tufts: 1, farShadowInterval: 0.25, canopyQuads: 1 };
  const down = [];
  let st = { ...base };
  for (const f of FEATURES) { st = { ...st, ...f.set }; down.push({ ...st, label: f.label }); }
  const ladder = down.reverse();
  for (const r of RES) ladder.push({ ...base, res: r, label: `${r}p` });
  return ladder;
}

export class Governor {
  constructor({ targetFps = 60, startRes = 1600, mode = 'auto', fixedRes = 0 }) {
    this.ladder = buildLadder();
    this.resIndex = (r) => this.ladder.findIndex((s) => s.res === r && s.label === `${r}p`);
    this.index = this.resIndex(startRes);
    this.startIndex = this.index;
    this.mode = mode; // auto | max | min | fixed
    this.fixedRes = fixedRes;
    this.miss = new Uint8Array(256);
    this.head = 0; this.frames = 0;
    this.blockedUntil = new Float64Array(this.ladder.length);
    this.blockCount = new Uint8Array(this.ladder.length);
    this.clock = 0; this.lastChange = -10;
    this.ignore = 45;
    this.probe = null; // { from, framesLeft, misses }
    this.probeWait = 8; this.cleanSince = 0;
    this.floorMissTime = 0; this.fpsFloorUntil = 0; this.floorBackoff = 30;
    this.steps = 0; this.stepsDown = 0; this.stepsUp = 0;
    this.capIndex = this.ladder.length - 1;
    this.burstPending = false;
    this.cpuMed = 0;
    this.setTarget(targetFps);
    this.applyMode();
  }

  setTarget(fps) {
    this.targetFps = fps; this.budget = 1000 / fps;
    // Battery mode: cap at 1600 and only step down.
    this.capIndex = fps < 50 ? this.resIndex(1600) : this.ladder.length - 1;
    if (this.index > this.capIndex) this.index = this.capIndex;
  }

  applyMode() {
    if (this.mode === 'max') this.index = this.ladder.length - 1;
    else if (this.mode === 'min') this.index = 0;
  }

  get state() {
    const s = this.ladder[this.index];
    return this.fixedRes ? { ...s, res: this.fixedRes } : s;
  }

  label() {
    const tag = this.mode === 'auto' ? '' : ` [${this.mode}]`;
    const floor = this.fpsFloor ? ' 30fps-floor' : '';
    const lbl = this.fixedRes ? `${this.fixedRes}p fixed` : this.state.label;
    return `L${this.index} ${lbl}${tag}${floor}`;
  }

  /** Ignore the next frames (start, resume, resize, teleport). */
  reset(frames = 45) {
    this.ignore = frames; this.frames = 0; this.miss.fill(0); this.probe = null;
  }

  countMisses(n) {
    let m = 0;
    for (let i = 1; i <= n; i++) m += this.miss[(this.head - i) & 255];
    return m;
  }

  change(newIndex, up) {
    newIndex = Math.max(0, Math.min(this.capIndex, newIndex));
    if (newIndex === this.index) return false;
    this.index = newIndex;
    this.steps++;
    if (up) this.stepsUp++; else this.stepsDown++;
    this.lastChange = this.clock;
    this.reset(60); // hold ~1 s
    return true;
  }

  /**
   * Feed one rendered frame. Returns 'changed' when the quality state changed,
   * 'burst' when the caller should run an uncapped burst (see onBurst), or null.
   */
  update(intervalMs, dtSec, missed, cpuMs, vsyncMs) {
    this.clock += dtSec;
    this.cpuMed += (cpuMs - this.cpuMed) * 0.05;
    if (this.mode !== 'auto') return null;
    if (this.ignore > 0) { this.ignore--; return null; }
    this.miss[this.head] = missed ? 1 : 0;
    this.head = (this.head + 1) & 255;
    this.frames++;

    const m30 = this.countMisses(Math.min(30, this.frames));
    const m180 = this.countMisses(Math.min(180, this.frames));

    // Active probe: did the step up hold?
    if (this.probe) {
      this.probe.framesLeft--;
      if (m30 >= 3 || this.countMisses(Math.min(120, this.frames)) >= 3) {
        const lvl = this.index;
        const n = this.blockCount[lvl] = Math.min(4, this.blockCount[lvl] + 1);
        this.blockedUntil[lvl] = this.clock + Math.min(128, 8 * 2 ** n);
        this.probe = null;
        return this.change(this.index - 1, false) ? 'changed' : null;
      }
      if (this.probe.framesLeft <= 0) this.probe = null;
    }

    if (this.frames >= 30 && m30 >= 8) return this.change(this.index - 2, false) ? 'changed' : this.floorCheck(dtSec, true);
    if (this.frames >= 30 && m180 >= 9 && m30 >= 2) return this.change(this.index - 1, false) ? 'changed' : this.floorCheck(dtSec, true);
    const fl = this.floorCheck(dtSec, m180 > 0.05 * Math.min(180, this.frames));
    if (fl) return fl;

    if (m180 === 0) this.cleanSince += dtSec; else this.cleanSince = 0;
    // Long clean stretches forgive earlier probe failures.
    if (this.cleanSince > 60) this.blockCount.fill(0);

    const next = this.index + 1;
    if (next <= this.capIndex && this.frames >= 240 && this.countMisses(240) === 0 && this.clock - this.lastChange >= 4 &&
        this.cpuMed < 0.6 * this.budget && this.clock >= this.blockedUntil[next] && !this.burstPending) {
      if (vsyncMs <= 11.2) {
        this.burstPending = true;
        return 'burst';
      }
      if (this.cleanSince >= this.probeWait) {
        this.probe = { framesLeft: 120 };
        this.probeWait = Math.min(64, this.probeWait * 1.5);
        return this.change(next, true) ? 'changed' : null;
      }
    }
    return null;
  }

  /** Result of an uncapped burst: mean interval ~ max(GPU, CPU) frame cost. */
  onBurst(meanMs) {
    this.burstPending = false;
    if (this.mode !== 'auto') return false;
    this.lastBurst = meanMs;
    if (meanMs <= 0.72 * this.budget) {
      this.probe = { framesLeft: 120 };
      return this.change(this.index + 1, true);
    }
    // No headroom: wait before measuring again.
    this.lastChange = this.clock;
    return false;
  }

  floorCheck(dtSec, missing) {
    if (this.index === 0 && missing && this.targetFps > 30) {
      this.floorMissTime += dtSec;
      if (this.floorMissTime > 3) {
        this.fpsFloor = true;
        this.fpsFloorUntil = this.clock + this.floorBackoff;
        this.floorBackoff = Math.min(480, this.floorBackoff * 2);
        this.floorMissTime = 0;
        return 'fps30';
      }
    } else {
      this.floorMissTime = 0;
    }
    if (this.fpsFloor && this.clock > this.fpsFloorUntil) { this.fpsFloor = false; return 'fps60'; }
    return null;
  }
}
