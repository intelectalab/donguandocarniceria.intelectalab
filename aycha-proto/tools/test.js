#!/usr/bin/env node
/**
 * Prueba automática del prototipo.
 *   node tools/test.js                 → todas las pantallas y todas las pruebas funcionales (G.tests)
 *   node tools/test.js ALO REP         → solo esos módulos
 *   node tools/test.js --mobile        → además revisa desbordes horizontales a 390 px
 *   node tools/test.js --shots ALO-02  → guarda capturas en dist/shots/
 * Requiere haber corrido: python3 tools/build.py
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const mobile = args.includes('--mobile');
const shots = args.includes('--shots');
const fileArg = (args.find(a => a.startsWith('--file=')) || '').slice(7);
const filters = args.filter(a => !a.startsWith('--'));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route('https://cdn.jsdelivr.net/**', route => {
    const u = route.request().url();
    const f = u.includes('qrcode-generator') ? 'vendor/qrcode-generator-1.4.4.js' : u.includes('javascript-lp-solver') ? 'vendor/lp-solver-0.4.24.js' : null;
    if (f) route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, f), 'utf8') });
    else route.abort();
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  let errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { } });
  await page.goto('file://' + path.join(ROOT, fileArg || 'dist/aycha-don-guando.html'));
  await page.waitForFunction(() => window.G && G.auth && document.querySelector('#app > *'), null, { timeout: 30000 });
  await page.evaluate(() => { if (!G.ctx.session) G.auth.demoLogin('GERENTE'); });
  await page.waitForFunction(() => document.querySelector('.main .page'), null, { timeout: 20000 });
  if (errors.length) { console.log('ERRORES AL ARRANCAR:\n  ' + errors.join('\n  ')); }
  const bootErrors = errors.slice(); errors = [];
  const info = await page.evaluate(() => ({ mods: Object.keys(G.modules), screens: Object.values(G.screens).map(s => ({ code: s.code, module: s.module, name: s.name })), tests: G.tests.map(t => ({ name: t.name, module: t.module })) }));
  const want = s => !filters.length || filters.some(f => s.code === f || s.module === f);
  const screens = info.screens.filter(want);
  const results = [];
  if (shots) fs.mkdirSync(path.join(ROOT, 'dist/shots'), { recursive: true });
  for (const s of screens) {
    errors = [];
    const r = await page.evaluate(async code => {
      G.ctx.role = 'GERENTE'; G.ui.closeAll(); G.go(code);
      await new Promise(r => setTimeout(r, 30));
      const main = document.querySelector('.main');
      const bad = main.querySelector('.notice.bad b');
      const failed = bad && /No se pudo mostrar/.test(bad.textContent) ? main.querySelector('.notice.bad').textContent : null;
      const h1 = main.querySelector('h1');
      const over = document.documentElement.scrollWidth > window.innerWidth + 1 || main.scrollWidth > main.clientWidth + 1;
      return { failed, title: h1 ? h1.textContent : null, len: main.textContent.length, over };
    }, s.code);
    if (shots && (filters.includes(s.code) || filters.includes(s.module))) await page.screenshot({ path: path.join(ROOT, 'dist/shots', s.code + (mobile ? '-m' : '') + '.png'), fullPage: false });
    const problems = [];
    if (r.failed) problems.push('render: ' + r.failed);
    if (!r.title) problems.push('sin título h1');
    if (r.len < 120) problems.push('contenido casi vacío');
    if (mobile && r.over) problems.push('desborde horizontal a 390 px');
    problems.push(...errors);
    results.push({ code: s.code, module: s.module, problems });
  }
  // pruebas funcionales registradas por los módulos
  // en modo celular solo se revisan las pantallas (desborde a 390 px); las pruebas funcionales ya corren en escritorio
  const tests = mobile ? [] : info.tests.filter(t => !filters.length || filters.includes(t.module));
  const tres = [];
  for (let i = 0; i < (mobile ? 0 : info.tests.length); i++) {
    const t = info.tests[i]; if (!tests.includes(t) && !tests.find(x => x.name === t.name)) continue;
    errors = [];
    // cada prueba corre sobre datos recién sembrados
    const r = await page.evaluate(async idx => {
      try { localStorage.clear(); } catch (e) { }
      G.db.t = {}; G.db.seq = {}; G.ctx.tenant = 'DG'; G.ctx.role = 'GERENTE'; G.runSeeds(); G.ui.closeAll(); G.nav.current = 'HOME'; G.render();
      const t = G.tests[idx];
      try { await t.fn(); return { ok: true }; } catch (e) { return { ok: false, msg: String(e && e.message || e) }; }
    }, i);
    tres.push({ name: t.name, module: t.module, ok: r.ok && !errors.length, msg: r.msg || errors.join(' | ') });
  }
  const badS = results.filter(r => r.problems.length);
  console.log(`Módulos: ${info.mods.length} · Pantallas probadas: ${results.length} · con problemas: ${badS.length}`);
  for (const r of badS) console.log(`  ✗ ${r.code}: ${r.problems.join(' | ')}`);
  const badT = tres.filter(t => !t.ok);
  console.log(`Pruebas funcionales: ${tres.length} · fallidas: ${badT.length}`);
  for (const t of badT) console.log(`  ✗ [${t.module}] ${t.name}: ${t.msg}`);
  if (bootErrors.length) console.log('Errores de arranque: ' + bootErrors.length);
  await browser.close();
  process.exit(badS.length || badT.length || bootErrors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
