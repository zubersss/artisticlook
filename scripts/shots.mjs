#!/usr/bin/env node
// Screenshot / stability / overdraw harness (headless Chromium, software WebGL).
// Headless frame rates are meaningless: this script never reports performance.
//
//   npm run build && npm run shots                     # every bookmark x 3 views -> docs/shots/
//   node scripts/shots.mjs --views=2 --bookmarks=path  # subset
//   node scripts/shots.mjs --stability                 # 3 consecutive moving frames per bookmark
//   node scripts/shots.mjs --overdraw                  # print overdraw per bookmark
//   options: --world=earth-forest --out=dir --scale=1 --res=1600 --time=0 --nobuild --quick
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  const globalRoot = execSync('npm root -g').toString().trim();
  const require = createRequire(path.join(globalRoot, 'noop.js'));
  return require(path.join(globalRoot, 'playwright'));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const f = path.join(dist, u === '/' ? 'index.html' : u);
      try {
        const data = await readFile(f);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
        res.end(data);
      } catch { res.writeHead(404); res.end(); }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function main() {
  if (!args.nobuild || !existsSync(dist)) {
    console.log('building…');
    execSync('npx vite build', { cwd: root, stdio: 'ignore' });
  }
  const srv = await serve();
  const port = srv.address().port;
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const scale = Number(args.scale || (args.stability || args.overdraw ? 1 : 2));
  const context = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: scale });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  const worlds = (args.world || 'earth-forest').split(',');
  const views = String(args.views ?? '0,1,2').split(',').map(Number);
  const res = Number(args.res || 1600);
  const out = path.resolve(root, args.out || (args.stability ? 'shots-tmp/stability' : 'docs/shots'));
  await mkdir(out, { recursive: true });

  for (const world of worlds) {
    const url = `http://127.0.0.1:${port}/?shot=1&world=${world}&res=${res}&time=${args.time || 0}`;
    await page.goto(url);
    await page.waitForFunction(() => (window.__app && window.__app.ready) || /^Sorry/.test(document.getElementById('loading-text')?.textContent || ''), null, { timeout: 900000, polling: 500 });
    const failed = await page.evaluate(() => !(window.__app && window.__app.ready) && document.getElementById('loading-text').textContent);
    if (failed) { console.log('LOAD FAILED:', failed); for (const e of errors) console.log('  ' + e.slice(0, 3000)); process.exit(2); }
    const info = await page.evaluate(() => window.__app.info());
    const bms = args.bookmarks ? String(args.bookmarks).split(',') : info.bookmarks;
    console.log(`${world}: renderer ${info.caps.renderer} hdr ${info.caps.hdr.name} msaa ${info.caps.samples} internal ${info.intW}x${info.intH} canvas ${info.outW}x${info.outH}`);
    for (const b of bms) {
      if (args.overdraw) {
        const od = await page.evaluate((b) => { window.__app.setBookmark(b); window.__app.setView(2); window.__app.renderFrames(2); return window.__app.overdraw(); }, b);
        const st = await page.evaluate(() => window.__app.stats());
        console.log(`  overdraw ${b}: ${od.toFixed(2)}  (calls ${st.calls}, tris ${st.tris})`);
        continue;
      }
      if (args.stability) {
        await page.evaluate((b) => { window.__app.setBookmark(b); window.__app.setView(2); window.__app.renderFrames(3); }, b);
        for (let i = 0; i < 3; i++) {
          // Walk forward 0.12 m, strafe 0.04 m and turn 0.35 deg per frame.
          await page.evaluate(() => window.__app.step(0.12, 0.04, 0.35));
          await page.locator('#view').screenshot({ path: path.join(out, `${world}-${b}-f${i}.png`) });
        }
        console.log(`  stability ${b}: 3 frames`);
        continue;
      }
      for (const v of views) {
        await page.evaluate(([b, v]) => { window.__app.setBookmark(b); window.__app.setView(v); window.__app.renderFrames(3); }, [b, v]);
        const file = path.join(out, `${world}-${b}-${['raw', 'light', 'painted'][v]}.jpg`);
        await page.locator('#view').screenshot({ path: file, type: 'jpeg', quality: 88 });
        console.log(`  saved ${path.relative(root, file)}`);
      }
    }
  }
  if (errors.length) {
    console.log('\nconsole messages:');
    for (const e of [...new Set(errors)].slice(0, 40)) console.log('  ' + e.slice(0, 2000));
  }
  await browser.close();
  srv.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
