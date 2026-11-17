// Debug tools: overdraw measurement (fragments shaded per pixel) and the
// window.__app API used by the screenshot / stability scripts.
import * as THREE from 'three';
import { G } from '../shaders/common.js';

const saved = new Map();

/**
 * Render the scene into an RGBA8 counter target with additive blending and every
 * material in count mode (each shaded fragment adds 1/255), then read it back.
 * Debug only: readPixels stalls the pipeline.
 */
export function measureOverdraw(engine, readback = true, includePrepass = false) {
  const r = engine.renderer;
  const rt = engine.post.ensureCountTarget();
  const w = rt.width, h = rt.height;
  saved.clear();
  engine.scene.traverse((o) => {
    if (!o.material || saved.has(o.material)) return;
    const m = o.material;
    saved.set(m, { blending: m.blending, a2c: m.alphaToCoverage, src: m.blendSrc, dst: m.blendDst, eq: m.blendEquation, cw: m.colorWrite });
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;
    m.alphaToCoverage = false;
    // 'Shaded' overdraw counts colour-pass fragments; the foliage depth prepass is
    // counted only when includePrepass (all rasterized fragments).
    m.colorWrite = includePrepass || !m.userData.prepass;
  });
  G.uOverdraw.value = 1;
  r.setRenderTarget(rt);
  r.setClearColor(0x000000, 0);
  r.clear(true, true, false);
  r.render(engine.scene, engine.camera);
  r.setClearColor(0x000000, 1);
  G.uOverdraw.value = 0;
  for (const [m, s] of saved) {
    m.blending = s.blending; m.alphaToCoverage = s.a2c; m.blendSrc = s.src; m.blendDst = s.dst; m.blendEquation = s.eq; m.colorWrite = s.cw;
  }
  if (!readback) return engine.lastOverdraw || 0;
  const buf = new Uint8Array(w * h * 4);
  r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) sum += buf[i];
  return sum / (w * h);
}

export function installDebugApi(engine, loop) {
  const api = {
    get ready() { return engine.ready; },
    info: () => ({ caps: engine.caps, intW: engine.intW, intH: engine.intH, outW: engine.outW, outH: engine.outH, bookmarks: engine.world.bookmarks.map((b) => b.name) }),
    setBookmark: (name) => { const i = engine.world.bookmarks.findIndex((b) => b.name === name); engine.setBookmark(i < 0 ? 0 : i); },
    setView: (v) => engine.setView(v),
    setTime: (i) => engine.setTime(i),
    /** Render n frames with a fixed dt (deterministic). */
    renderFrames: (n = 3, dt = 1 / 60) => {
      for (let i = 0; i < n; i++) engine.renderFrame(dt, dt * 1000);
      return engine.stats;
    },
    /** Move the camera by (forward m, right m, yaw deg) per frame and render one frame. */
    step: (fwd, right, yawDeg, dt = 1 / 60) => {
      const c = engine.controller;
      const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
      c.pos[0] += sy * fwd + cy * right;
      c.pos[2] += -cy * fwd + sy * right;
      if (c.mode === 'walk') c.groundY = engine.heightAt(c.pos[0], c.pos[2]);
      c.pos[1] = c.mode === 'walk' ? c.groundY + c.eye : c.pos[1];
      c.yaw += yawDeg * Math.PI / 180;
      engine.renderFrame(dt, dt * 1000);
    },
    overdraw: () => ({ shaded: measureOverdraw(engine, true, false), all: measureOverdraw(engine, true, true) }),
    stats: () => engine.stats,
    pose: () => ({ pos: Array.from(engine.controller.pos), yaw: engine.controller.yaw * 180 / Math.PI, pitch: engine.controller.pitch * 180 / Math.PI }),
    setPose: (x, y, z, yaw, pitch, mode) => engine.controller.setPose(x, y, z, yaw, pitch, mode),
    loop,
    engine,
  };
  window.__app = api;
  return api;
}
