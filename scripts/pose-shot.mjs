#!/usr/bin/env node
// Screenshot from an arbitrary pose (tuning aid).
//   node scripts/pose-shot.mjs --pose=x,z,eye,yaw,pitch --out=shots-tmp/pose.jpg [--view=2] [--hide=...] [--world=...]
// eye = metres above the ground. Uses the existing dist/ build.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const globalRoot = execSync('npm root -g').toString().trim();
const require = createRequire(path.join(globalRoot, 'noop.js'));
const { chromium } = require(path.join(globalRoot, 'playwright'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = createServer(async (req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try { const f = path.join(dist, u === '/' ? 'index.html' : u); res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(await readFile(f)); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: Number(args.scale || 2) })).newPage();
await page.goto(`http://127.0.0.1:${srv.address().port}/?shot=1&res=1600&world=${args.world || 'earth-forest'}${args.hide ? `&hide=${args.hide}` : ''}`);
await page.waitForFunction(() => window.__app && window.__app.ready, null, { timeout: 600000 });
const poses = String(args.pose).split(';');
const outs = String(args.out || 'shots-tmp/pose.jpg').split(';');
for (let i = 0; i < poses.length; i++) {
  const [x, z, eye, yaw, pitch] = poses[i].split(',').map(Number);
  await page.evaluate(([x, z, eye, yaw, pitch, view]) => {
    const e = window.__app.engine; const g = e.heightAt(x, z);
    window.__app.setPose(x, g + eye, z, yaw, pitch, 'fly'); window.__app.setView(view); window.__app.renderFrames(3);
  }, [x, z, eye, yaw, pitch, Number(args.view ?? 2)]);
  await page.locator('#view').screenshot({ path: path.resolve(root, outs[i] || outs[0]), type: 'jpeg', quality: 90 });
  console.log('saved', outs[i] || outs[0]);
}
await browser.close(); srv.close();
