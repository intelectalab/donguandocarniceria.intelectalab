/* =====================================================================
   Estructura de la aplicación: barra lateral, barra superior, inicio
   ===================================================================== */
G.GROUPS = [
  { phase: 0, name: 'Plataforma', mods: ['PLT', 'SEG', 'MAE', 'INT', 'AUD'] },
  { phase: 1, name: 'Ventas y canales', mods: ['CAT', 'CLI', 'PED', 'POS', 'WEB'] },
  { phase: 1, name: 'Atención y marketing', mods: ['CRM', 'ADS', 'TEL'] },
  { phase: 1, name: 'Almacén y reparto', mods: ['ALM', 'PRE', 'DEL'] },
  { phase: 1, name: 'Finanzas e indicadores', mods: ['FAC', 'CAJ', 'GAS', 'TAB'] },
  { phase: 2, name: 'Producción y calidad', mods: ['PRO', 'DES', 'REC', 'CAL', 'EQU', 'ETQ'] },
  { phase: 2, name: 'Abastecimiento y contabilidad', mods: ['COM', 'GRJ', 'CNT'] },
  { phase: 3, name: 'Nuevos canales', mods: ['CON', 'B2B', 'CMP'] },
  { phase: 3, name: 'Control fino', mods: ['FLO', 'PER', 'PRS'] },
  { phase: 4, name: 'Producto SaaS', mods: ['SUS', 'ONB', 'SEP', 'OPS', 'API'] },
];
G.PHASE_NAMES = { 0: 'Fase 0 · Núcleo de plataforma', 1: 'Fase 1 · Ningún pedido se pierde', 2: 'Fase 2 · Producción, calidad y contabilidad', 3: 'Fase 3 · Crecer', 4: 'Fase 4 · Producto SaaS' };
G.shell = { expanded: {} };
const h2 = G.ui.h;

G.render = function () {
  const app = document.getElementById('app');
  if (!app) return;
  try { document.documentElement.dataset.theme = G.ctx.theme === 'system' ? '' : G.ctx.theme; if (G.ctx.theme === 'system') delete document.documentElement.dataset.theme; } catch (e) { }
  G.ui.clear(app);
  if (!G.ctx.session && G.auth) { G.auth.renderLogin(app); return; }
  app.className = 'app';
  app.append(G.shell.side(), G.shell.top(), h2('main', { class: 'main', attrs: { id: 'main' } }));
  G.renderMain();
};
G.renderMain = function () {
  const main = document.getElementById('main'); if (!main) return;
  const code = G.nav.current;
  try {
    if (code === 'HOME' || !G.screens[code]) G.shell.home(main);
    else {
      const sc = G.screens[code];
      if (!G.screenVisible(sc)) { G.ui.clear(main).appendChild(h2('div', { class: 'page' }, G.ui.notice(`Tu rol (${G.roleName()}) no tiene acceso a esta pantalla.`, 'warn'))); return; }
      sc.render(main, G.nav.params || {});
      if (G.modOn && !G.modOn(sc.module)) {
        const pg = main.querySelector('.page');
        const n = G.ui.notice([h2('b', null, `Módulo ${sc.module} desactivado (RN-PLT-07). `), 'En el sistema real no aparece en el menú y la API responde 403. Aquí ves una vista previa para dejarlo listo. ', G.canSee('PLT') && G.screens['PLT-12'] ? G.ui.btn('Ir a módulos activables (PLT-12)', () => G.go('PLT-12'), { sm: true }) : null], 'warn');
        n.classList.add('mod-off-banner');
        if (pg) pg.insertBefore(n, pg.children[1] || null); else main.prepend(n);
      }
    }
  } catch (e) {
    console.error(e);
    G.ui.clear(main).appendChild(h2('div', { class: 'page' }, G.ui.notice([h2('b', null, 'No se pudo mostrar la pantalla. '), String(e.message || e)], 'bad')));
  }
  // marcar activo en la barra lateral
  document.querySelectorAll('.nav-screen').forEach(b => b.classList.toggle('active', b.dataset.code === code));
  document.querySelectorAll('.nav-home').forEach(b => b.classList.toggle('active', code === 'HOME'));
  const ft = h2('footer', { class: 'screen-foot' }, h2('span', { class: 'mono' }, code === 'HOME' ? 'INICIO' : code), h2('span', null, 'Aycha · prototipo de demostración · datos de ejemplo'));
  main.appendChild(ft);
};

G.shell.side = function () {
  const side = h2('nav', { class: 'side', attrs: { 'aria-label': 'Módulos' } });
  side.appendChild(h2('div', { class: 'side-brand' }, h2('div', { class: 'mark' }, 'DG'), h2('div', null, h2('b', null, 'Don Guando'), h2('span', null, 'Comercial · Aycha'))));
  const sc = h2('div', { class: 'side-scroll' });
  sc.appendChild(h2('button', { class: 'nav-home', on: { click: () => G.go('HOME') } }, h2('span', { 'aria-hidden': 'true' }, '⌂'), 'Inicio y guía de la demo'));
  let lastPhase = -1;
  for (const g of G.GROUPS) {
    const mods = g.mods.filter(m => G.modules[m] && G.canSee(m) && G.modules[m].screens.some(sc => !sc.hidden && G.screenVisible(sc)));
    if (!mods.length) continue;
    if (g.phase !== lastPhase) { sc.appendChild(h2('div', { class: 'nav-phase' }, G.PHASE_NAMES[g.phase].replace(/^Fase \d · /, ''), h2('span', { class: 'tag' }, 'F' + g.phase))); lastPhase = g.phase; }
    sc.appendChild(h2('div', { class: 'nav-group' }, g.name));
    for (const m of mods) {
      const mod = G.modules[m];
      const open = !!G.shell.expanded[m];
      const btn = h2('button', { class: 'nav-mod' + (G.nav.current !== 'HOME' && G.screens[G.nav.current]?.module === m ? ' active' : ''), attrs: { 'aria-expanded': open ? 'true' : 'false' }, on: { click: () => { G.shell.expanded[m] = !G.shell.expanded[m]; G.render(); } } },
        h2('span', { class: 'code' }, m), h2('span', { class: 'name' }, mod.name), G.modOn && !G.modOn(m) ? h2('span', { class: 'off-tag', title: 'Módulo desactivado' }, 'apagado') : null, h2('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
      sc.appendChild(btn);
      if (open) sc.appendChild(h2('div', { class: 'nav-screens' }, mod.screens.filter(s => !s.hidden && G.screenVisible(s)).map(s => h2('button', { class: 'nav-screen' + (G.nav.current === s.code ? ' active' : ''), dataset: { code: s.code }, on: { click: () => G.go(s.code) } }, s.name))));
    }
  }
  side.appendChild(sc);
  return side;
};

G.shell.top = function () {
  const top = h2('header', { class: 'top' });
  top.appendChild(h2('button', { class: 'icon-btn menu-btn', title: 'Menú', attrs: { 'aria-label': 'Abrir menú' }, on: { click: () => document.getElementById('app').classList.toggle('nav-open') } }, '☰'));
  const ctx = h2('div', { class: 'ctx' });
  const tnr = G.db.raw('tenants').find(t => t.id === G.ctx.tenant) || {}; const tn = tnr.short || tnr.name || G.ctx.tenant;
  ctx.appendChild(h2('div', { class: 'ctx-select ctx-static' }, h2('label', null, 'Empresa'), h2('b', { attrs: { id: 'ctx-tenant' }, title: (tnr.name || '') + ' · la empresa sale de tu usuario: cada empresa ve solo sus datos' }, tn)));
  const brands = G.scope.brands();
  const brandSel = h2('select', { attrs: { id: 'ctx-brand', 'aria-label': 'Marca' } }, brands.length > 1 ? h2('option', { value: 'ALL' }, 'Todas las marcas') : null, brands.map(b => h2('option', { value: b.id, selected: G.ctx.brand === b.id }, b.name.split(' · ')[0])));
  brandSel.addEventListener('change', () => { G.ctx.brand = brandSel.value; G.db.save(); G.render(); });
  const curB = G.ctx.brand !== 'ALL' && G.db.get('brands', G.ctx.brand);
  ctx.appendChild(h2('div', { class: 'ctx-select hide-sm' }, h2('label', { attrs: { for: 'ctx-brand' } }, h2('i', { class: 'brand-dot', style: 'background:' + (curB ? curB.primary_color : 'var(--brand-gold)') }), 'Marca'), brandSel));
  const sites = G.scope.sites();
  const siteSel = h2('select', { attrs: { id: 'ctx-site', 'aria-label': 'Local' } }, sites.length > 1 ? h2('option', { value: 'ALL' }, 'Todos los locales') : null, sites.map(e => h2('option', { value: e.id, selected: G.ctx.site === e.id }, e.short || e.name)));
  siteSel.addEventListener('change', () => { G.ctx.site = siteSel.value; G.db.save(); G.refresh(); });
  ctx.appendChild(h2('div', { class: 'ctx-select hide-sm' }, h2('label', { attrs: { for: 'ctx-site' } }, 'Local'), siteSel));
  top.appendChild(ctx);
  top.appendChild(h2('div', { class: 'spacer' }));
  top.appendChild(h2('span', { class: 'date-chip hide-sm', title: 'La demo usa una fecha fija para que los datos sean coherentes' }, 'Hoy: ' + G.fmt.date(G.TODAY)));
  // búsqueda global
  const res = h2('div', { class: 'search-results', hidden: true });
  const inp = h2('input', { type: 'search', placeholder: 'Buscar pedido, cliente, producto, pantalla… ( / )', attrs: { id: 'global-search', 'aria-label': 'Búsqueda global' } });
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase(); G.ui.clear(res);
    if (q.length < 2) { res.hidden = true; return; }
    const hits = [];
    for (const s of Object.values(G.screens)) if (!s.hidden && (s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)) && G.screenVisible(s)) hits.push({ label: s.name, sub: s.code + ' · ' + G.modules[s.module].name, go: () => G.go(s.code) });
    for (const p of G.searchProviders) { try { hits.push(...(p(q) || [])); } catch (e) { } }
    for (const hh of hits.slice(0, 14)) res.appendChild(h2('button', { on: { click: () => { res.hidden = true; inp.value = ''; hh.go(); } } }, h2('span', null, h2('b', null, hh.label), h2('div', { class: 'small muted' }, hh.sub))));
    if (!hits.length) res.appendChild(h2('div', { class: 'empty' }, 'Sin resultados.'));
    res.hidden = false;
  });
  inp.addEventListener('blur', () => setTimeout(() => { res.hidden = true; }, 200));
  top.appendChild(h2('div', { class: 'top-search' }, h2('span', { class: 'ico', 'aria-hidden': 'true' }, G.shell.icon('search')), inp, res));
  top.appendChild(h2('button', { class: 'icon-btn', title: 'Escanear QR (simulado)', attrs: { 'aria-label': 'Escanear QR' }, on: { click: () => G.shell.scan() } }, G.shell.icon('qr')));
  const alerts = G.alerts();
  const bell = h2('button', { class: 'icon-btn', title: 'Alertas', attrs: { 'aria-label': 'Alertas', id: 'bell' }, on: { click: () => G.shell.alertsPanel() } }, G.shell.icon('bell'), alerts.length ? h2('span', { class: 'dot' }, alerts.length > 99 ? '99+' : alerts.length) : null);
  top.appendChild(bell);
  top.appendChild(h2('button', { class: 'icon-btn', title: 'Cambiar tema', attrs: { 'aria-label': 'Cambiar tema claro u oscuro' }, on: { click: () => { const cur = G.ctx.theme; G.ctx.theme = cur === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark') : cur === 'dark' ? 'light' : 'dark'; G.db.save(); G.render(); } } }, G.shell.icon('theme')));
  if (G.auth) top.appendChild(G.auth.userMenu());
  return top;
};
G.shell.updateBadges = function () {
  const bell = document.getElementById('bell'); if (!bell) return;
  const n = G.alerts().length; const dot = bell.querySelector('.dot');
  if (n && dot) dot.textContent = n > 99 ? '99+' : n; else if (n) bell.appendChild(h2('span', { class: 'dot' }, n)); else if (dot) dot.remove();
};
G.shell.alertsPanel = function () {
  const list = G.alerts();
  G.ui.drawer('Alertas', bd => {
    if (!list.length) return G.ui.empty('Sin alertas. Todo en orden.');
    const by = G.util.groupBy(list, 'module');
    for (const [m, items] of Object.entries(by)) {
      bd.appendChild(h2('h3', null, (G.modules[m] ? G.modules[m].name : m) + ` (${items.length})`));
      bd.appendChild(h2('div', { class: 'stack' }, items.map(a => h2('div', { class: 'notice ' + (a.tone || 'warn'), style: a.go ? 'cursor:pointer' : '', on: a.go ? { click: () => { G.ui.closeAll(); a.go(); } } : null }, h2('div', null, h2('b', null, a.title), a.detail ? h2('div', { class: 'small' }, a.detail) : null)))));
    }
  });
};
/** Escaneo de QR simulado: elegir o escribir un código y abrir su ficha */
G.shell.scan = function () {
  G.ui.modal('Escanear QR', (bd, close) => {
    bd.appendChild(G.ui.notice('La cámara no está disponible en esta demo. Escribe o elige el código impreso: bolsa del pedido, lote, etiqueta, producto o equipo.', 'info'));
    const inp = h2('input', { class: 'input', placeholder: 'Ej.: P-001300, L261008-012, DG-CUY-ENT', attrs: { id: 'scan-code' } });
    const out = h2('div', { class: 'stack' });
    const sample = [];
    sample.push(...G.db.where('sales_orders', o => o.created_at.slice(0, 10) === G.TODAY && ['CONFIRMED', 'IN_PREPARATION'].includes(o.status)).slice(0, 2).map(x => x.number));
    sample.push(...G.db.all('lots').slice(0, 2).map(x => x.code));
    sample.push(...G.db.all('product_variants').filter(v => v.sellable).slice(0, 1).map(x => x.sku));
    sample.push(...(G.db.all('equipment') || []).slice(0, 1).map(x => x.code));
    function doScan(code) {
      code = (code || '').trim().toUpperCase(); if (!code) return;
      const handlers = G.scanHandlers || [];
      for (const hd of handlers) { const r = hd(code); if (r) { close(); r(); return; } }
      G.ui.clear(out).appendChild(G.ui.notice('No se reconoce el código ' + code + '.', 'warn'));
    }
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') doScan(inp.value); });
    bd.append(inp, h2('div', { class: 'row' }, sample.map(c => G.ui.btn(c, () => doScan(c), { sm: true }))), out);
  }, [{ label: 'Abrir', kind: 'primary', onClick: () => { const v = document.getElementById('scan-code').value; const hs = G.scanHandlers || []; for (const hd of hs) { const r = hd(v.trim().toUpperCase()); if (r) { setTimeout(r, 0); return; } } G.ui.toast('Código no reconocido', 'warn'); return false; } }]);
};
G.scanHandlers = [];

/* ---------- inicio ---------- */
G.shell.home = function (main) {
  const body = G.ui.page(main, {
    title: 'Don Guando Comercial · prototipo funcional', sub: 'SaaS Aycha para AGROPECUARIA DON GUANDO SAC: 5 marcas con un solo RUC, 2 locales, ~1000 pedidos al mes. Recorre las fases 0 a 4. Lo que registres se guarda solo en este navegador y puedes restablecerlo.',
    actions: [{ label: 'Restablecer datos de demo', onClick: () => G.ui.confirm({ title: 'Restablecer datos', message: 'Se borran los cambios que hiciste y se cargan de nuevo los datos de ejemplo.', confirmLabel: 'Restablecer', danger: true, onConfirm: () => G.db.reset() }) }],
  });
  const today = G.db.where('sales_orders', o => o.delivery_date === G.TODAY && G.scope.ok(o));
  const pend = today.filter(o => ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY'].includes(o.status));
  const route = today.filter(o => o.status === 'IN_ROUTE');
  const drafts = G.db.where('sales_orders', o => o.status === 'DRAFT' && G.scope.ok(o));
  const month = G.sales.orders({ from: G.date.month(G.TODAY), to: G.TODAY, brand: G.ctx.brand !== 'ALL' ? G.ctx.brand : null, site: G.ctx.site !== 'ALL' ? G.ctx.site : null });
  const alerts = G.alerts();
  body.appendChild(G.ui.kpis([
    { label: 'Pedidos para hoy', value: G.fmt.num(today.length), sub: `${pend.length} por preparar o despachar · ${route.length} en ruta`, onClick: () => G.screens['PED-14'] && G.screenVisible(G.screens['PED-14']) && G.go('PED-14') },
    { label: 'Borradores', value: drafts.length, sub: 'no se confirman sin datos completos', tone: drafts.length ? 'warn' : 'ok', onClick: () => G.screens['PED-01'] && G.screenVisible(G.screens['PED-01']) && G.go('PED-01') },
    { label: 'Ventas entregadas del mes', value: G.fmt.money(G.sales.total(month), 0), sub: `${G.fmt.num(month.length)} pedidos · ticket ${G.fmt.money(month.length ? G.sales.total(month) / month.length : 0)}` },
    { label: 'Alertas', value: alerts.length, sub: 'pedidos, lotes, calidad, cobros', tone: alerts.length ? 'warn' : 'ok', onClick: () => G.shell.alertsPanel() },
  ]));
  const tour = (title, items) => G.ui.card(title, h2('div', { class: 'stack' }, items.filter(([, c]) => G.screens[c] && G.screenVisible(G.screens[c])).map(([l, c]) => h2('button', { class: 'btn', style: 'justify-content:space-between', on: { click: () => G.go(c) } }, l, h2('span', { class: 'mono muted' }, c)))));
  body.appendChild(h2('div', { class: 'grid c3' },
    G.ui.card('Cómo usar la demo', h2('ol', { class: 'stack', style: 'padding-left:18px;margin:0' },
      h2('li', null, 'Toca tu ', h2('b', null, 'usuario'), ' (arriba a la derecha) para cambiar de rol sin contraseña: la vendedora solo ve sus marcas y su bandeja; el repartidor, su ruta; la contadora, la contabilidad.'),
      h2('li', null, 'Usa los selectores de ', h2('b', null, 'marca y local'), ' para filtrar listas y tableros.'),
      h2('li', null, 'Cada pantalla muestra su código (por ejemplo ', h2('span', { class: 'mono' }, 'PED-02'), ') para ubicarla en el kit de desarrollo y en Jira.'),
      h2('li', null, 'La central de llamadas (TEL) está ', h2('b', null, 'incluida y apagada'), ': se activa en PLT-12 cuando la gerencia lo decida.'))),
    tour('Recorridos de la Fase 1', [['Nuevo pedido con datos obligatorios', 'PED-02'], ['Bandeja de WhatsApp y alertas de control', 'CRM-01'], ['Preparación con escaneo y bolsas numeradas', 'PRE-03'], ['Rutas y costo por entrega', 'DEL-02'], ['Mostrador con balanza', 'POS-02'], ['Atribución de anuncios a ventas cobradas', 'ADS-04'], ['Tablero de gerencia', 'TAB-01']]),
    tour('Recorridos de las fases 2 a 4', [['Orden de producción y costo real', 'PRO-03'], ['Despiece con costeo conjunto', 'DES-03'], ['Liberación de lotes (calidad)', 'CAL-05'], ['Asientos automáticos y SIRE', 'CNT-03'], ['Consignación con guía de remisión', 'CON-04'], ['Portal del cliente empresarial', 'B2B-13'], ['Separar una marca a otro RUC', 'SEP-02']]),
  ));
  for (const ph of [0, 1, 2, 3, 4]) {
    const mods = h2('div', { class: 'grid c4' });
    for (const g of G.GROUPS.filter(x => x.phase === ph)) for (const m of g.mods) {
      const mod = G.modules[m]; if (!mod || !G.canSee(m)) continue;
      const vis = mod.screens.filter(s => !s.hidden && G.screenVisible(s)); if (!vis.length) continue;
      const off = G.modOn && !G.modOn(m);
      mods.appendChild(h2('button', { class: 'card mod-card', style: 'text-align:left;cursor:pointer;padding:12px 14px;display:grid;gap:4px;background:var(--surface)', on: { click: () => { G.shell.expanded[m] = true; G.go(vis[0].code); } } },
        h2('div', { class: 'row between' }, h2('span', { class: 'mono muted small' }, m), off ? G.ui.badge('Apagado', 'warn') : G.ui.badge('Fase ' + mod.phase, ph === 0 ? '' : 'primary')),
        h2('b', null, mod.name), h2('span', { class: 'small muted' }, `${vis.length} pantallas`)));
    }
    if (mods.children.length) body.appendChild(G.ui.card(G.PHASE_NAMES[ph], mods));
  }
  const total = Object.values(G.screens).filter(s => !s.hidden).length;
  body.appendChild(h2('p', { class: 'small muted' }, `Prototipo con ${Object.keys(G.modules).length} módulos y ${total} pantallas. Datos de ejemplo de AGROPECUARIA DON GUANDO SAC: no son cifras reales. Marcas 2 a 5 con nombres provisionales.`));
};

/* ---------- arranque ---------- */
G.boot = function () {
  const loaded = G.db.load();
  if (!loaded) { const keep = { theme: G.ctx.theme }; G.runSeeds(); Object.assign(G.ctx, keep); }
  const hash = (location.hash || '').slice(1);
  if (hash && G.screens[hash]) { G.nav.current = hash; G.shell.expanded[G.screens[hash].module] = true; }
  if (G.nav.current !== 'HOME' && !G.screenVisible(G.screens[G.nav.current])) G.nav.current = 'HOME';
  G.render();
  window.addEventListener('keydown', e => { if (e.key === 'Escape') { const l = G.ui._layers[G.ui._layers.length - 1]; if (l) l.close(); } if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) { const s = document.getElementById('global-search'); if (s) { e.preventDefault(); s.focus(); } } });
};

G.shell = G.shell || {};
G.shell.icon = function (name) {
  const P = {
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'
  };
  const sp = document.createElement('span'); sp.setAttribute('aria-hidden', 'true'); sp.style.display = 'inline-flex';
  sp.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (P[name] || '') + '</svg>';
  return sp;
};
