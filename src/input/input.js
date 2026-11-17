// Touch-first input. Left thumb: floating move stick. Right thumb: drag to look.
// Desktop: WASD/arrows to move, mouse drag to look, Space/E up, C/Q down (fly),
// Shift to go faster. Produces intents only; the controller interprets them.

const STICK_RADIUS = 56; // CSS px

export class Input {
  constructor(surface, { onAction } = {}) {
    this.surface = surface;
    this.onAction = onAction || (() => {});
    this.move = { x: 0, y: 0 }; // x strafe right, y forward, each -1..1
    this.vertical = 0;
    this.sprint = false;
    this.lookYaw = 0; // accumulated radians since last consume
    this.lookPitch = 0;
    this.keys = new Set();
    this.stickId = -1; this.stickOx = 0; this.stickOy = 0; this.stickX = 0; this.stickY = 0;
    this.lookId = -1; this.lookLx = 0; this.lookLy = 0;
    this.mouseDown = false;
    this.enabled = true;
    this.touchSens = 0.0042; // rad per CSS px
    this.mouseSens = 0.0032;
    this.stickBase = document.getElementById('stick-base');
    this.stickKnob = document.getElementById('stick-knob');
    this.bind();
  }

  bind() {
    const s = this.surface;
    s.addEventListener('pointerdown', (e) => this.down(e));
    s.addEventListener('pointermove', (e) => this.moveEv(e));
    s.addEventListener('pointerup', (e) => this.up(e));
    s.addEventListener('pointercancel', (e) => this.up(e));
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.release(); });
  }

  release() {
    this.stickId = -1; this.lookId = -1; this.mouseDown = false;
    this.stickX = this.stickY = 0;
    this.stickBase.classList.add('hidden');
  }

  down(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      if (e.button === 0 || e.button === 2) { this.mouseDown = true; this.lookLx = e.clientX; this.lookLy = e.clientY; s_capture(this.surface, e); }
      return;
    }
    const w = this.surface.clientWidth;
    if (e.clientX < w * 0.45 && this.stickId < 0) {
      this.stickId = e.pointerId;
      this.stickOx = e.clientX; this.stickOy = e.clientY;
      this.stickX = this.stickY = 0;
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickKnob.style.transform = 'translate(0px, 0px)';
      this.stickBase.classList.remove('hidden');
      s_capture(this.surface, e);
    } else if (this.lookId < 0) {
      this.lookId = e.pointerId;
      this.lookLx = e.clientX; this.lookLy = e.clientY;
      s_capture(this.surface, e);
    }
  }

  moveEv(e) {
    if (e.pointerType === 'mouse') {
      if (this.mouseDown) {
        this.lookYaw += (e.clientX - this.lookLx) * this.mouseSens;
        this.lookPitch -= (e.clientY - this.lookLy) * this.mouseSens;
        this.lookLx = e.clientX; this.lookLy = e.clientY;
      }
      return;
    }
    if (e.pointerId === this.stickId) {
      let dx = e.clientX - this.stickOx, dy = e.clientY - this.stickOy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
      this.stickX = dx / STICK_RADIUS; this.stickY = -dy / STICK_RADIUS;
      this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (e.pointerId === this.lookId) {
      this.lookYaw += (e.clientX - this.lookLx) * this.touchSens;
      this.lookPitch -= (e.clientY - this.lookLy) * this.touchSens;
      this.lookLx = e.clientX; this.lookLy = e.clientY;
    }
  }

  up(e) {
    if (e.pointerType === 'mouse') { this.mouseDown = false; return; }
    if (e.pointerId === this.stickId) {
      this.stickId = -1; this.stickX = this.stickY = 0;
      this.stickBase.classList.add('hidden');
    } else if (e.pointerId === this.lookId) {
      this.lookId = -1;
    }
  }

  key(e, isDown) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.code;
    if (isDown) {
      if (!this.keys.has(k)) {
        const map = { KeyB: 'bookmark', KeyF: 'mode', KeyT: 'time', KeyV: 'look', KeyH: 'hud', KeyO: 'quality', KeyP: 'bench', KeyX: 'overdraw' };
        if (map[k]) this.onAction(map[k]);
        if (k >= 'Digit1' && k <= 'Digit9') this.onAction('bookmark:' + (Number(k.slice(5)) - 1));
      }
      this.keys.add(k);
    } else {
      this.keys.delete(k);
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
  }

  /** Called once per frame. */
  poll() {
    const K = this.keys;
    let x = 0, y = 0;
    if (K.has('KeyW') || K.has('ArrowUp')) y += 1;
    if (K.has('KeyS') || K.has('ArrowDown')) y -= 1;
    if (K.has('KeyD') || K.has('ArrowRight')) x += 1;
    if (K.has('KeyA') || K.has('ArrowLeft')) x -= 1;
    if (this.stickId >= 0) { x = this.stickX; y = this.stickY; }
    this.move.x = x; this.move.y = y;
    this.vertical = (K.has('Space') || K.has('KeyE') ? 1 : 0) - (K.has('KeyC') || K.has('KeyQ') ? 1 : 0);
    this.sprint = K.has('ShiftLeft') || K.has('ShiftRight') || (this.stickId >= 0 && Math.hypot(this.stickX, this.stickY) > 0.95);
  }

  consumeLook(out) {
    out.yaw = this.lookYaw; out.pitch = this.lookPitch;
    this.lookYaw = 0; this.lookPitch = 0;
    return out;
  }
}

function s_capture(el, e) {
  try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
}
