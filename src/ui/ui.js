// DOM UI at native resolution: loading / tap-to-start / context-lost screens,
// HUD, on-screen buttons, rotate hint, benchmark banner and results.

const $ = (id) => document.getElementById(id);

export class UI {
  constructor({ onAction }) {
    this.onAction = onAction;
    this.el = {
      loading: $('loading'), loadingText: $('loading-text'), loadingBar: $('loading-bar'),
      start: $('start'), ctxlost: $('ctxlost'), rotate: $('rotate'),
      hud: $('hud'), fps: $('hud-fps'), ms: $('hud-ms'), res: $('hud-res'), gov: $('hud-gov'),
      calls: $('hud-calls'), tris: $('hud-tris'), extra: $('hud-extra'), commit: $('hud-commit'),
      buttons: $('buttons'), bench: $('bench'), benchText: $('bench-text'), benchBanner: $('bench-banner'), benchProgress: $('bench-progress'),
    };
    this.el.commit.textContent = typeof __COMMIT__ !== 'undefined' ? __COMMIT__ : 'dev';
    this.hudOn = false;
    this.el.buttons.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && b.dataset.act) { e.stopPropagation(); this.onAction(b.dataset.act); }
    });
    // Buttons must not start a look-drag on the canvas underneath.
    this.el.buttons.addEventListener('pointerdown', (e) => e.stopPropagation());
    $('bench-copy').addEventListener('click', () => this.copyBench());
    $('bench-close').addEventListener('click', () => this.el.bench.classList.add('hidden'));
    $('bench-stop').addEventListener('click', () => this.onAction('bench-stop'));
    this.hudAccum = 0; this.hudFrames = 0; this.hudMsMax = 0; this.hudMsSum = 0;
  }

  setLoading(text, frac) {
    this.el.loadingText.textContent = text;
    if (frac != null) this.el.loadingBar.style.width = `${Math.round(frac * 100)}%`;
  }

  showStart(onTap) {
    this.el.loading.classList.add('hidden');
    this.el.start.classList.remove('hidden');
    const go = (e) => {
      e.preventDefault();
      this.el.start.removeEventListener('pointerup', go);
      this.el.start.classList.add('hidden');
      onTap();
    };
    this.el.start.addEventListener('pointerup', go);
  }

  hideLoading() { this.el.loading.classList.add('hidden'); }

  showPlayUI() { this.el.buttons.classList.remove('hidden'); this.setHud(this.hudOn); }

  showContextLost() {
    this.el.ctxlost.classList.remove('hidden');
    this.el.ctxlost.addEventListener('pointerup', () => location.reload(), { once: true });
  }

  setHud(on) {
    this.hudOn = on;
    this.el.hud.classList.toggle('hidden', !on);
    this.label('hud', on ? 'on' : 'off');
  }

  label(name, text) {
    const e = $(`lbl-${name}`);
    if (e) e.textContent = text;
  }

  updateRotateHint() {
    this.el.rotate.classList.toggle('hidden', !(window.innerHeight > window.innerWidth));
  }

  /** Called every rendered frame; only touches the DOM ~4 times a second. */
  frame(dtMs, stats) {
    this.hudAccum += dtMs; this.hudFrames++;
    this.hudMsSum += dtMs; if (dtMs > this.hudMsMax) this.hudMsMax = dtMs;
    if (this.hudAccum < 250) return;
    if (this.hudOn) {
      const fps = (this.hudFrames * 1000) / this.hudAccum;
      this.el.fps.textContent = fps.toFixed(0);
      this.el.ms.textContent = `${(this.hudMsSum / this.hudFrames).toFixed(1)}/${this.hudMsMax.toFixed(0)}`;
      this.el.res.textContent = `${stats.w}×${stats.h}`;
      this.el.gov.textContent = stats.gov;
      this.el.calls.textContent = String(stats.calls);
      this.el.tris.textContent = stats.tris >= 1000 ? `${(stats.tris / 1000).toFixed(0)}k` : String(stats.tris);
      this.el.extra.textContent = stats.extra || '';
    }
    this.hudAccum = 0; this.hudFrames = 0; this.hudMsSum = 0; this.hudMsMax = 0;
  }

  /** Show or hide the photo bar; getImage() returns a PNG data URL of the held frame. */
  showPhoto(on, getImage) {
    document.body.classList.toggle('photo', on);
    $('photo-bar').classList.toggle('hidden', !on);
    if (!on) return;
    $('photo-save').onclick = () => {
      const a = document.createElement('a');
      a.href = getImage();
      a.download = `painted-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    };
    $('photo-back').onclick = () => this.onAction('photo');
  }

  benchRunning(on, text) {
    this.el.benchBanner.classList.toggle('hidden', !on);
    if (text != null) this.el.benchProgress.textContent = text;
  }

  showBench(text) {
    this.el.benchText.textContent = text;
    this.el.bench.classList.remove('hidden');
  }

  copyBench() {
    const text = this.el.benchText.textContent;
    const done = () => { $('bench-copy').textContent = 'Copied'; setTimeout(() => ($('bench-copy').textContent = 'Copy results'), 1500); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch { /* ignore */ }
  ta.remove();
}
