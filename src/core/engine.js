// Engine: owns the renderer, the camera-relative world frame, the modules and
// the per-frame order. Nothing in here is world-specific: all content comes
// from the world definition (src/worlds/*.js) and the recipe modules.
import * as THREE from 'three';
import { config, ENGINE } from './config.js';
import { WorldFrame } from './worldframe.js';
import { detectCapabilities } from './capabilities.js';
import { makeNoiseTexture, makeCanvasTexture } from './textures.js';
import { G, setGlobalDefine } from '../shaders/common.js';
import { Post } from '../post/post.js';
import { Governor, pixelSteps, MIN_PIXELS } from '../governor/governor.js';
import { Input } from '../input/input.js';
import { Controller } from '../input/controller.js';
import { Benchmark } from '../bench/benchmark.js';
import { computeSky, daysSinceJ2000 } from '../sky/astronomy.js';
import { Heightfield } from '../terrain/heightfield.js';
import { Terrain } from '../terrain/terrain.js';
import { Sky } from '../sky/sky.js';
import { Rocks } from '../terrain/rocks.js';
import { Trees } from '../vegetation/trees.js';
import { Shadows } from '../shadows/shadows.js';
import { generateStrokeTexture } from '../brushwork/strokes.js';
import { measureOverdraw } from '../debug/debug.js';

const VIEW_NAMES = ['raw', "painter's", 'painted'];

export class Engine {
  constructor(canvas, world, ui) {
    this.canvas = canvas;
    this.world = world;
    this.ui = ui;
    this.frame = new WorldFrame();
    this.onBeforeRender = []; // (camera) => void, for modules needing camera matrices
    this.modules = []; // { update(ctx) }
    this.viewMode = config.view;
    this.timeIndex = Math.min(config.time, world.timeOfDay.length - 1);
    this.bookmarkIndex = 0;
    this.ready = false;
    this.paused = false;
    this.stats = { w: 0, h: 0, gov: '', calls: 0, tris: 0, extra: '' };
    this._benchPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.time = 0;
    this.sky = null;
  }

  async init(progress) {
    progress('Starting renderer', 0.05);
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: config.shot, premultipliedAlpha: false,
    });
    if (!r.capabilities.isWebGL2) throw new Error('WebGL 2 is required');
    r.setPixelRatio(1);
    r.autoClear = false;
    r.info.autoReset = false;
    r.outputColorSpace = THREE.LinearSRGBColorSpace; // the final pass encodes sRGB itself
    r.setClearColor(0x000000, 1);
    this.renderer = r;

    this.caps = detectCapabilities(r, config.msaa);
    if (this.caps.hdr.encode) setGlobalDefine('HDR_ENCODE', 1);

    progress('Mixing paints', 0.12);
    G.uNoise.value = makeNoiseTexture();
    this.canvasTex = makeCanvasTexture();

    this.post = new Post(r, this.caps);
    this.post.mFinal.uniforms.tCanvas.value = this.canvasTex;
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.camera = new THREE.PerspectiveCamera(ENGINE.vfovDeg, 16 / 9, ENGINE.near, ENGINE.far);

    // World content. Stage 1 uses a placeholder; later stages build modules here.
    progress('Shaping the land', 0.2);
    const content = await this.buildContent(progress);
    this.heightAt = content.heightAt;

    const W = this.world;
    this.governor = new Governor({ targetFps: config.fps < 50 ? 30 : 60, sharp: config.fps < 50, mode: config.quality === 'auto' ? 'auto' : config.quality, fixedRes: config.res });
    if (config.shot) this.governor.mode = 'fixed';
    this.controller = new Controller(this.heightAt, {
      bounds: W.terrain ? { minX: -W.terrain.patchSize / 2 + 5, maxX: W.terrain.patchSize / 2 - 5, minZ: -W.terrain.patchSize / 2 + 5, maxZ: W.terrain.patchSize / 2 - 5 } : null,
    });
    this.input = new Input(this.canvas, { onAction: (a) => this.action(a) });
    this.bench = new Benchmark(W, this.heightAt);

    const bi = config.bookmark ? W.bookmarks.findIndex((b) => b.name === config.bookmark) : 0;
    this.setBookmark(Math.max(0, bi));
    this.setTime(this.timeIndex);
    this.setView(this.viewMode);

    this.resize(true);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; this.onContextLost?.(); });

    progress('Compiling shaders', 0.7);
    await this.compileAll(progress);
    if (this.trees) {
      const ok = this.trees.selfTest(this.renderer, this.caps);
      if (!ok) console.warn('Foliage EQUAL-depth self-test failed; using LESS-EQUAL + alpha test');
    }
    await this.calibrate(progress);
    this.ready = true;
    progress('Ready', 1);
  }

  async buildContent(progress) {
    const W = this.world;
    const hf = new Heightfield(W.terrain);
    await hf.build((f) => progress('Shaping the land', 0.2 + 0.35 * f));
    this.heightfield = hf;
    progress('Loading the brushes', 0.56);
    await new Promise((r) => setTimeout(r, 0));
    const strokes = generateStrokeTexture(W.brush?.textureSize ?? 512, { seed: W.brush?.seed ?? 1234 });
    strokes.tex.anisotropy = Math.min(W.brush?.anisotropy ?? 4, this.caps.anisotropy);
    G.uStroke.value = strokes.tex;
    G.uBrush.value.set(W.brush?.tileFactor ?? 0.21, strokes.size, W.brush?.sharpness ?? 6, W.brush?.octaveFade ?? 0.35);
    progress('Mixing the sky', 0.6);
    this.sky = new Sky(this);
    this.sky.precompute(W.timeOfDay.map((t) => computeSky(W.astronomy, daysSinceJ2000(t.utc))));
    this.modules.push(this.sky);
    progress('Laying the ground', 0.64);
    this.terrain = new Terrain(this, hf);
    this.modules.push(this.terrain);
    if (W.rocks && W.rocks.count > 0 && !config.hide.has('rocks')) this.rocks = new Rocks(this, hf);
    if (W.vegetation && W.vegetation.variants?.length && !config.hide.has('trees')) {
      progress('Growing trees', 0.66);
      await new Promise((r) => setTimeout(r, 0));
      this.trees = new Trees(this, hf);
      this.modules.push(this.trees);
    }
    if (W.shadows && !config.hide.has('shadows')) {
      progress('Casting shadows', 0.68);
      this.shadows = new Shadows(this, hf, W.shadows);
      this.trees?.initShadow(this.shadows);
      this.rocks?.initShadow(this.shadows);
      this.modules.push(this.shadows);
    }
    return { heightAt: (x, z) => hf.heightAt(x, z) };
  }

  /** Compile every program behind the loading screen, then warm up each bookmark. */
  async compileAll(progress) {
    const r = this.renderer;
    try {
      await r.compileAsync(this.scene, this.camera);
      if (this.shadows) await r.compileAsync(this.shadows.scene, this.shadows.cascades[0].cam);
      for (const m of this.post.materials) {
        this.post.quad.material = m;
        await r.compileAsync(this.post.scene, this.post.camera);
      }
    } catch (e) {
      console.warn('compileAsync failed, falling back to warm-up renders', e);
    }
    // Warm-up: render one frame at every bookmark so all state combinations and
    // texture uploads happen now, not during play.
    const saved = this.bookmarkIndex;
    for (let i = 0; i < this.world.bookmarks.length; i++) {
      this.setBookmark(i);
      this.renderFrame(1 / 60, 16.7, true);
      progress(`Warming up ${this.world.bookmarks[i].name}`, 0.75 + 0.2 * (i / this.world.bookmarks.length));
      await new Promise((res) => setTimeout(res, 0));
    }
    this.setBookmark(saved);
    this.post.expoReset = true;
  }

  // ---------------------------------------------------------------- sizing
  resize(force = false) {
    const cssW = Math.max(1, window.innerWidth), cssH = Math.max(1, window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    // Native canvas pixels (CSS size x devicePixelRatio): the resolution ceiling.
    const outW = Math.round(cssW * dpr), outH = Math.round(cssH * dpr);
    this.outW = outW; this.outH = outH;
    this.renderer.setSize(outW, outH, false);
    const aspect = cssW / cssH;
    // Screenshot / fixed-resolution runs may ask for more than the (small) headless canvas.
    const fixedLong = config.res || 0;
    const maxW = Math.max(outW, aspect >= 1 ? fixedLong : Math.ceil(fixedLong * aspect));
    const maxH = Math.max(outH, aspect >= 1 ? Math.ceil(fixedLong / aspect) : fixedLong);
    if (force || !this.post.b4 || this.allocW !== maxW || this.allocH !== maxH) {
      this.post.allocate(maxW + 8, maxH + 8);
      this.allocW = maxW; this.allocH = maxH;
    }
    this.aspect = aspect;
    this.nativeW = outW; this.nativeH = outH;
    this.governor.setNative(outW * outH);
    this.applyInternalRes();
    this.governor?.reset();
    this.ui?.updateRotateHint();
  }

  applyInternalRes() {
    const st = this.governor.state;
    const a = this.aspect;
    let w, h;
    if (this.photoPending) { w = this.nativeW; h = this.nativeH; }
    else if (this.governor.fixedRes) {
      const L = this.governor.fixedRes;
      if (a >= 1) { w = L; h = Math.round(L / a); } else { h = L; w = Math.round(L * a); }
    } else {
      const P = Math.min(st.pixels, this.nativeW * this.nativeH);
      w = Math.sqrt(P * a); h = w / a;
      w = Math.min(Math.round(w), this.nativeW); h = Math.min(Math.round(h), this.nativeH);
    }
    w = Math.max(64, Math.min(w, this.post.maxW - 8)) & ~3; h = Math.max(64, Math.min(h, this.post.maxH - 8)) & ~3;
    this.intW = w; this.intH = h;
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    G.uResolution.value.set(w, h);
    this.post.shaftsEnabled = st.shafts;
    for (const m of this.modules) m.applyQuality?.(st);
  }

  // ---------------------------------------------------------------- state
  setBookmark(i) {
    const B = this.world.bookmarks;
    this.bookmarkIndex = ((i % B.length) + B.length) % B.length;
    const b = B[this.bookmarkIndex];
    const g = this.heightAt(b.pos[0], b.pos[2]);
    const y = b.mode === 'fly' ? g + (b.height ?? 3) : null;
    this.controller.setPose(b.pos[0], y, b.pos[2], b.yaw, b.pitch, b.mode);
    this.ui?.label('bookmark', b.name);
    this.ui?.label('mode', this.controller.mode);
    this.modules.forEach((m) => m.onTeleport?.());
    this.governor?.reset();
  }

  setTime(i) {
    const T = this.world.timeOfDay;
    this.timeIndex = ((i % T.length) + T.length) % T.length;
    const t = T[this.timeIndex];
    this.skyState = computeSky(this.world.astronomy, daysSinceJ2000(t.utc));
    const s = this.skyState.sun;
    G.uSunDir.value.set(s[0], s[1], s[2]).normalize();
    this.modules.forEach((m) => m.onSkyChange?.(this.skyState, this.timeIndex));
    this.ui?.label('time', t.label);
    if (this.post) this.post.expoReset = !this.ready || config.shot;
  }

  setView(v) {
    this.viewMode = ((v % 3) + 3) % 3;
    G.uViewMode.value = this.viewMode;
    this.ui?.label('look', VIEW_NAMES[this.viewMode]);
  }

  action(a) {
    if (a === 'bookmark') this.setBookmark(this.bookmarkIndex + 1);
    else if (a.startsWith('bookmark:')) this.setBookmark(Number(a.split(':')[1]));
    else if (a === 'mode') {
      const c = this.controller;
      c.mode = c.mode === 'walk' ? 'fly' : 'walk';
      if (c.mode === 'fly') c.pos[1] += 2;
      this.ui.label('mode', c.mode);
    } else if (a === 'time') this.setTime(this.timeIndex + 1);
    else if (a === 'look') this.setView(this.viewMode + 1);
    else if (a === 'hud') this.ui.setHud(!this.ui.hudOn);
    else if (a === 'quality') this.cycleQuality();
    else if (a === 'photo') this.takePhoto();
    else if (a === 'bench') document.getElementById('bench-menu').classList.remove('hidden');
    else if (a === 'bench-stop') this.stopBench(true);
    else if (a === 'overdraw') this.showOverdraw = !this.showOverdraw;
  }

  /** The quality button: Smooth (60 fps, default) <-> Sharp (30 fps, favours native). */
  cycleQuality() {
    const sharp = !this.governor.sharp;
    this.governor.setSharp(sharp);
    this.loop?.setTargetFps(this.governor.targetFps);
    this.applyInternalRes();
    this.ui.label('quality', sharp ? 'Sharp 30' : 'Smooth 60');
  }

  /** Photo: render one frame at full native resolution and hold it on screen. */
  takePhoto() {
    if (this.photoHeld) { this.photoHeld = false; this.ui.showPhoto(false); this.loop?.start(); return; }
    this.loop?.stop();
    this.photoPending = true;
    this.applyInternalRes();
    this.renderFrame(1 / 60, 16.7, true);
    this.photoPending = false;
    this.photoHeld = true;
    this.ui.showPhoto(true, () => this.canvas.toDataURL('image/png'));
    this.applyInternalRes();
  }

  startBench(minutes) {
    document.getElementById('bench-menu').classList.add('hidden');
    this.bench.start(minutes, this.governor);
    this.controller.mode = 'fly';
    this.ui.benchRunning(true, this.bench.progress());
  }

  stopBench(aborted) {
    const text = this.bench.report({
      world: this.world.name, targetFps: this.governor.targetFps, vsyncHz: Math.round(1000 / (this.loop?.vsync || 16.7)),
      gpu: this.caps.renderer, hdr: this.caps.hdr.name, samples: this.caps.samples,
      screen: `${screen.width}x${screen.height} (view ${window.innerWidth}x${window.innerHeight})`, dpr: (window.devicePixelRatio || 1).toFixed(3),
      canvas: `${this.outW}x${this.outH}`, three: this.caps.three, commit: typeof __COMMIT__ !== 'undefined' ? __COMMIT__ : 'dev',
      native: `${this.nativeW}x${this.nativeH} = ${((this.nativeW * this.nativeH) / 1e6).toFixed(2)} MP`,
      mode: `${this.governor.sharp ? 'Sharp (30 fps)' : 'Smooth (60 fps)'}${this.calibrationMs ? `, startup test ${this.calibrationMs.toFixed(1)} ms/frame` : ''}`,
    }) + (aborted ? '\n(stopped early)' : '');
    this.ui.benchRunning(false);
    this.ui.showBench(text);
    this.setBookmark(this.bookmarkIndex);
    return text;
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    this.time += dt;
    this.lastDt = dt;
    G.uTime.value = this.time % 3600;
    const c = this.controller;
    if (this.bench.active) {
      const p = this.bench.pose(this._benchPose);
      c.pos[0] = p.x; c.pos[1] = p.y; c.pos[2] = p.z;
      c.yaw = p.yaw * Math.PI / 180; c.pitch = p.pitch * Math.PI / 180;
    } else {
      this.input.poll();
      c.update(dt, this.input);
    }
    this.frame.setCamera(c.pos[0], c.pos[1], c.pos[2]);
    c.apply(this.camera);
    const cw = this.frame.camWrapped;
    G.uCamWrapped.value.set(cw[0], cw[1], cw[2]);
    // Brush lattice origin: coarse part a multiple of 128 m (exact), fine part small.
    const cx = Math.round(cw[0] / 128) * 128, cz = Math.round(cw[2] / 128) * 128;
    G.uBrushCam.value.set(cw[0] - cx, cw[2] - cz, cx, cz);
    G.uCamAlt.value = c.pos[1];
    G.uCamAGL.value = c.pos[1] - this.heightAt(c.pos[0], c.pos[2]);
    const ctx = { dt, time: this.time, camera: this.camera, frame: this.frame, engine: this };
    for (let i = 0; i < this.modules.length; i++) this.modules[i].update?.(ctx);
    this.frame.update();
    for (let i = 0; i < this.onBeforeRender.length; i++) this.onBeforeRender[i](this.camera);
  }

  renderFrame(dt, intervalMs, warm = false) {
    const r = this.renderer;
    this.update(dt);
    r.info.reset();
    for (let i = 0; i < this.modules.length; i++) this.modules[i].prerender?.(this);
    // Main scene into the HDR target (opaque first, foliage near->far, sky last).
    r.setRenderTarget(this.post.sceneRT);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    this.post.run({
      camera: this.camera, sunDir: G.uSunDir.value, params: this.world.post,
      outW: this.outW, outH: this.outH, dt: warm ? 1 : dt, viewMode: this.viewMode,
    });
    if (this.showOverdraw) {
      this.lastOverdraw = measureOverdraw(this, false);
      this.post.showOverdraw(this.post.countRT, this.outW, this.outH);
    }
    const st = this.stats;
    st.w = this.intW; st.h = this.intH; st.gov = this.governor.label();
    st.calls = r.info.render.calls; st.tris = r.info.render.triangles;
    st.extra = (this.showOverdraw && this.lastOverdraw ? `overdraw ${this.lastOverdraw.toFixed(2)} · ` : '') + `${this.caps.hdr.name} ${this.caps.samples}x` + (this.calibrationMs ? ` · cal ${this.calibrationMs.toFixed(1)}ms` : '') + (this.governor.lastBurst ? ` · burst ${this.governor.lastBurst.toFixed(1)}ms` : '') + (this.trees?.foliageFallback ? ' · foliage LEQ' : '');
  }

  /** Called by the loop for every rendered frame during play. */
  tick(dt, intervalMs, missed, cpuMs) {
    if (!this.ready || this.contextLost) return;
    this.renderFrame(dt, intervalMs);
    this.ui.frame(intervalMs, this.stats);
    const g = this.governor.update(intervalMs, dt, missed, cpuMs, this.loop.vsync);
    if (g === 'changed') this.applyInternalRes();
    else if (g === 'burst') this.loop.requestBurst(30, (mean) => { if (this.governor.onBurst(mean)) this.applyInternalRes(); });
    else if (g === 'fps30') this.loop.setTargetFps(this.governor.targetFps / 2);
    else if (g === 'fps60') this.loop.setTargetFps(this.governor.targetFps);
    if (this.bench.active) {
      const done = this.bench.record(intervalMs, (this.intW * this.intH) / 1e6, dt);
      if ((this.benchFrame = (this.benchFrame || 0) + 1) % 30 === 0) this.ui.benchRunning(true, this.bench.progress());
      if (done) this.stopBench(false);
    }
  }

  /**
   * Startup calibration behind the loading screen: let clocks ramp, then time three
   * batches of 10 frames at the first bookmark (1x1 readback = full GPU sync) and
   * pick the starting resolution from the fastest batch.
   */
  async calibrate(progress) {
    if (config.shot || config.res || this.governor.mode !== 'auto') return;
    const r = this.renderer;
    const gl = r.getContext();
    const px = new Uint8Array(4);
    const sync = () => { r.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    this.setBookmark(0);
    const native = this.nativeW * this.nativeH;
    const P0 = Math.min(native, 1.6e6);
    this.governor.index = this.governor.indexForPixels(P0);
    this.applyInternalRes();
    const P = this.intW * this.intH;
    progress('Measuring the easel', 0.96);
    for (let i = 0; i < 15; i++) this.renderFrame(1 / 60, 16.7, true);
    sync();
    let best = 1e9;
    for (let b = 0; b < 3; b++) {
      await new Promise((res) => setTimeout(res, 0));
      const t0 = performance.now();
      for (let i = 0; i < 10; i++) this.renderFrame(1 / 60, 16.7, true);
      sync();
      best = Math.min(best, (performance.now() - t0) / 10);
    }
    this.calibrationMs = best;
    // Model: ~30 % fixed cost, ~70 % proportional to pixels. Start at the highest step whose
    // predicted cost leaves headroom (<= 0.65 of the frame budget).
    const target = 0.65 * this.governor.budget;
    const predicted = (p) => best * (0.3 + 0.7 * p / P);
    let pick = MIN_PIXELS;
    for (const p of pixelSteps(native)) if (predicted(p) <= target) pick = p;
    this.governor.calibratedPixels = pick;
    this.governor.index = this.governor.startIndex = this.governor.sharp ? this.governor.ladder.length - 1 : this.governor.indexForPixels(pick);
    this.applyInternalRes();
    this.post.expoReset = true;
  }
}
