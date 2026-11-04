#!/usr/bin/env node
// Captura de pantallas para revisión visual: node tools/shot.js dist/w-ALO.html 1440 ALO-01,ALO-02 [dark] [prefijo]
// Guarda en /tmp/shots/<prefijo><CODIGO>-<ancho>[-d].png (míralas con la herramienta Read)
const path = require('path'), fs = require('fs');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
(async () => {
  const ROOT = path.resolve(__dirname, '..');
  const [file, w, codes, mode, prefix] = process.argv.slice(2);
  const dark = mode === 'dark';
  fs.mkdirSync('/tmp/shots', { recursive: true });
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: +w || 1440, height: +w < 600 ? 844 : 900 }, colorScheme: dark ? 'dark' : 'light' });
  const p = await c.newPage();
  await p.route('https://cdn.jsdelivr.net/**', r => { const u = r.request().url(); const f = u.includes('qrcode') ? 'vendor/qrcode-generator-1.4.4.js' : 'vendor/lp-solver-0.4.24.js'; r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, f), 'utf8') }); });
  await p.route('https://fonts.googleapis.com/**', r => r.abort());
  p.on('pageerror', e => console.log('ERROR JS:', e.message));
  await p.addInitScript(() => { try { localStorage.clear(); } catch (e) { } });
  await p.goto('file://' + path.join(ROOT, file));
  await p.waitForFunction(() => window.G && G.auth && document.querySelector('#app > *'), null, { timeout: 30000 });
  if (process.env.LOGIN !== '1') { await p.evaluate(r => { if (!G.ctx.session) G.auth.demoLogin(r); }, process.env.ROLE || 'GERENTE'); await p.waitForFunction(() => document.querySelector('.main .page')); }
  for (const code of (codes || 'HOME').split(',')) {
    await p.evaluate(cd => { if (cd !== 'HOME' && G.ctx.session) G.go(cd); }, code);
    await p.waitForTimeout(250);
    const out = `/tmp/shots/${prefix || ''}${code}-${w}${dark ? '-d' : ''}.png`;
    await p.screenshot({ path: out, fullPage: process.env.FULL === '1' });
    console.log(out);
  }
  await b.close();
})();
