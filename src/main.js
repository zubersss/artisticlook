// Boot: load the world definition, build the engine behind the loading screen,
// then wait for a tap (fullscreen, landscape lock, wake lock) and run the loop.
import './ui/style.css';
import { config } from './core/config.js';
import { Engine } from './core/engine.js';
import { Loop } from './core/loop.js';
import { UI } from './ui/ui.js';
import { loadWorld } from './worlds/index.js';
import { installDebugApi } from './debug/debug.js';

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => { wakeLock = null; });
    }
  } catch { /* not available or denied */ }
}

async function enterFullscreenLandscape() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  } catch { /* ignore */ }
  try {
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
  } catch { /* not allowed on this browser */ }
}

async function main() {
  if (config.shot) document.body.classList.add('shot');
  let engine;
  const ui = new UI({ onAction: (a) => engine && engine.action(a) });
  const world = await loadWorld(config.world);
  const canvas = document.getElementById('view');
  engine = new Engine(canvas, world, ui);
  const loop = new Loop((dt, interval) => engine.tick(dt, interval));
  loop.setTargetFps(config.fps);
  engine.loop = loop;
  engine.onContextLost = () => { loop.stop(); ui.showContextLost(); };

  try {
    await engine.init((text, frac) => ui.setLoading(text, frac));
  } catch (e) {
    console.error(e);
    ui.setLoading(`Sorry — ${e.message}`, 0);
    return;
  }
  installDebugApi(engine, loop);

  document.getElementById('bench-3').addEventListener('click', () => engine.startBench(3));
  document.getElementById('bench-10').addEventListener('click', () => engine.startBench(10));
  document.getElementById('bench-cancel').addEventListener('click', () => document.getElementById('bench-menu').classList.add('hidden'));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      loop.stop();
    } else if (engine.started && !engine.contextLost) {
      engine.governor.reset();
      loop.start();
      requestWakeLock();
    }
  });

  if (config.shot) {
    // Screenshot mode: the script drives frames through window.__app.
    loop.manual = true;
    ui.hideLoading();
    engine.started = true;
    return;
  }

  ui.showStart(async () => {
    await enterFullscreenLandscape();
    requestWakeLock();
    engine.resize();
    engine.started = true;
    ui.showPlayUI();
    if (config.hud) ui.setHud(true);
    engine.governor.reset();
    loop.start();
    if (config.bench) engine.startBench(Number(config.bench) >= 10 ? 10 : 3);
  });
}

main();
