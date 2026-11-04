// Comprueba que un cambio sobrevive a recargar la página (guardado por diferencias)
const path = require('path'); const fs = require('fs');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const page = await ctx.newPage();
  await page.route('https://cdn.jsdelivr.net/**', route => { const u = route.request().url(); const f = u.includes('qrcode') ? 'vendor/qrcode-generator-1.4.4.js' : 'vendor/lp-solver-0.4.24.js'; route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, f), 'utf8') }); });
  await page.route('https://fonts.**', r => r.abort());
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const url = 'file://' + path.join(ROOT, process.argv[2] || 'dist/aycha-don-guando.html');
  await page.goto(url); await page.waitForFunction(() => window.G && G.auth && document.querySelector('#app > *'));
  const r1 = await page.evaluate(() => { G.auth.demoLogin('VENDEDORA'); const c = G.db.all('customers')[3]; G.db.update('customers', c.id, { full_name: 'CAMBIO PERSISTENTE' }); const o = G.orders.create({ customer_id: c.id, brand_id: 'br-DG', lines: [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }] }); G.db.save(); return { id: c.id, oid: o.id, n: localStorage.getItem('aycha-don-guando-proto-v1').length }; });
  await page.reload(); await page.waitForFunction(() => window.G && G.auth && document.querySelector('#app > *'));
  const r2 = await page.evaluate(id => ({ name: (G.db.get('customers', id.id) || {}).full_name, order: !!G.db.get('sales_orders', id.oid), role: G.ctx.role, n: G.db.raw('sales_orders').length, h1: document.querySelector('h1').textContent }), r1);
  console.log(r1, r2, errs); await b.close();
})();
