// Arranca el HTML, inicia sesión y mide el seed; imprime errores y conteos de tablas
//   node tools/boot-check.js [archivo.html]
const path = require('path'); const fs = require('fs');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const b = await chromium.launch(); const page = await b.newPage();
  await page.route('https://cdn.jsdelivr.net/**', route => { const u = route.request().url(); const f = u.includes('qrcode') ? 'vendor/qrcode-generator-1.4.4.js' : u.includes('lp-solver') ? 'vendor/lp-solver-0.4.24.js' : null; if (f) route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, f), 'utf8') }); else route.abort(); });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + path.join(ROOT, process.argv[2] || 'dist/aycha-don-guando.html'));
  await page.waitForFunction(() => window.G && G.auth, null, { timeout: 30000 });
  const info = await page.evaluate(() => {
    const t0 = performance.now(); G.db.t = {}; G.db.seq = {}; G.runSeeds(); const ms = performance.now() - t0;
    G.auth.demoLogin('GERENTE');
    const counts = {}; for (const [k, v] of Object.entries(G.db.t)) counts[k] = v.length;
    const size = JSON.stringify({ t: G.db.t }).length;
    const sep = G.db.raw('sales_orders').filter(o => o.created_at.startsWith('2026-09')).length;
    const st = {}; for (const o of G.db.raw('sales_orders').filter(o => o.created_at.startsWith('2026-10-10'))) st[o.status] = (st[o.status] || 0) + 1;
    return { ms: Math.round(ms), size, counts, sep, st, kpi: G.kpi('KPI-PED-01'), h1: document.querySelector('h1') && document.querySelector('h1').textContent };
  });
  console.log(JSON.stringify(info));
  console.log('errores', errs);
  await b.close();
})();
