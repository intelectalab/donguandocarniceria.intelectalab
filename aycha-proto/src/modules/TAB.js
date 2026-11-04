/* =====================================================================
   TAB · Tablero e indicadores (Fase 1)
   Catálogo de indicadores con fórmula visible (kpi_definitions), metas
   por marca y local con tolerancia y semáforo, congelamiento mensual en
   corridas numeradas (kpi_snapshots, solo inserción), tableros por rol,
   comparación mes a mes, bajada al detalle y exportación auditada.
   Los valores se calculan desde los datos de cada módulo: nunca se digitan.
   ===================================================================== */
(function () {
  const { h, btn, badge, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs, pills } = G.ui;
  const U = G.util;
  const R = (n, d = 2) => U.round(n, d);
  const TB = G.tab = G.tab || {};
  const ins = (t, r) => G.db.insert(t, r, { silent: true });
  const CODE_RE = /^KPI-[A-Z0-9]{2,4}-[0-9]{2,3}$/;
  const UNITS = [['PEN', 'Soles'], ['PCT', 'Porcentaje'], ['COUNT', 'Cantidad'], ['KG', 'Kilos'], ['DAYS', 'Días'], ['HOURS', 'Horas'], ['MINUTES', 'Minutos'], ['RATIO', 'Razón'], ['PEN_PER_KG', 'S/ por kg'], ['PEN_PER_UNIT', 'S/ por unidad']];
  const DIRS = [['HIGHER_BETTER', 'Más alto es mejor'], ['LOWER_BETTER', 'Más bajo es mejor'], ['TARGET', 'Objetivo']];
  const FREQ = [['DAILY', 'Diaria'], ['WEEKLY', 'Semanal'], ['MONTHLY', 'Mensual'], ['INSTANT', 'Al instante']];
  const lbl = (arr, v) => (arr.find(x => x[0] === v) || [v, v || '—'])[1];
  const MONTHS = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'];
  const SEM = { GREEN: ['Verde', 'ok'], AMBER: ['Ámbar', 'warn'], RED: ['Rojo', 'bad'] };
  const semBadge = s => s ? badge(SEM[s][0], SEM[s][1]) : badge('Sin meta', '');

  /* ------------------------------------------------------------------
     Catálogo y registro (kpi_register) · RN-TAB-08
     ------------------------------------------------------------------ */
  /** catálogo de la empresa activa (si la empresa no tiene filas propias, se usa el catálogo base sembrado) */
  TB.defs = function () { const own = G.db.all('kpi_definitions'); return own.length ? own : G.db.raw('kpi_definitions').filter(r => r.tenant === 'DG'); };
  TB.def = code => TB.defs().find(d => d.code === code) || null;
  TB.register = function (code, module, name, formula, unit, direction, frequency = 'MONTHLY', dimensions = [], source = null, phase = 1, calculator = null, drilldown = null, roles = [], requiresModule = null) {
    if (!CODE_RE.test(code)) G.fail('RN-TAB-08', `El código ${code} no sigue el formato KPI-<MOD>-NN.`);
    if (!formula) G.fail('RN-TAB-08', 'La fórmula legible es obligatoria.');
    const data = { code, module_code: module, name, formula, unit, direction, frequency, dimensions, source, phase, calculator: calculator || `kpi_${module.toLowerCase()}_${code.split('-').pop()}`, drilldown, visible_roles: roles || [], requires_module: requiresModule || module };
    const prev = TB.def(code);
    const row = prev ? Object.assign(prev, data) : G.db.insert('kpi_definitions', Object.assign({ id: 'kd-' + code, status: 'ACTIVE', decimals: 2 }, data), { silent: true });
    G.db.touch(); TB.seedDashboards();
    return row;
  };
  TB.hasCalc = code => typeof G.kpiCalc[code] === 'function';
  TB.fallbackUsed = TB.fallbackUsed || {};
  /** RN-TAB-07 y RN-TAB-06: activo, con su módulo encendido y visible para el rol */
  TB.visible = function (d, role = G.ctx.role) {
    if (!d || d.status !== 'ACTIVE') return false;
    if (!G.modOn(d.requires_module || d.module_code)) return false;
    const vr = d.visible_roles || [];
    return !vr.length || ['GERENTE', 'AUDITOR'].includes(role) || vr.includes(role);
  };
  TB.fmt = function (v, d) {
    if (v == null || !isFinite(v)) return '—';
    const u = (d && d.unit) || 'COUNT'; const dec = d && d.decimals != null ? d.decimals : 2;
    if (u === 'PEN') return G.fmt.money(v);
    if (u === 'PCT') return G.fmt.pct(v, Math.min(dec, 2));
    if (u === 'RATIO') return G.fmt.num(v, 2);
    if (u === 'MINUTES') return G.fmt.num(v, 1) + ' min';
    if (u === 'HOURS') return G.fmt.num(v, 1) + ' h';
    if (u === 'DAYS') return G.fmt.num(v, 1) + ' días';
    if (u === 'KG') return G.fmt.kg(v, 1);
    if (u === 'PEN_PER_KG') return G.fmt.money(v) + '/kg';
    if (u === 'PEN_PER_UNIT') return G.fmt.money(v) + '/u';
    return G.fmt.num(v, Number.isInteger(v) ? 0 : 1);
  };

  /* ------------------------------------------------------------------
     Semáforo y metas · RN-TAB-04, RN-TAB-05
     ------------------------------------------------------------------ */
  TB.semaphore = function (value, target, direction, tolPct) {
    if (value == null || target == null || !isFinite(value)) return null;
    const tol = (tolPct == null ? Number(G.param('tab_default_tolerance_pct')) || 10 : Number(tolPct)) / 100; const e = 1e-9;
    if (direction === 'LOWER_BETTER') return value <= target + e ? 'GREEN' : value <= target * (1 + tol) + e ? 'AMBER' : 'RED';
    if (direction === 'TARGET') { const d = Math.abs(value - target), band = Math.abs(target) * tol; return d <= band + e ? 'GREEN' : d <= 2 * band + e ? 'AMBER' : 'RED'; }
    return value >= target - e ? 'GREEN' : value >= target * (1 - tol) - e ? 'AMBER' : 'RED';
  };
  const overlap = (a1, a2, b1, b2) => a1 <= (b2 || '9999-12-31') && b1 <= (a2 || '9999-12-31');
  /** meta vigente más específica: marca y local, marca, local, general */
  TB.targetFor = function (code, { brand = null, site = null, date = G.TODAY } = {}) {
    const d = TB.def(code); if (!d) return null;
    const ts = G.db.where('kpi_targets', t => t.kpi_id === d.id && t.valid_from <= date && (!t.valid_to || t.valid_to >= date));
    const pick = (b, s) => ts.find(t => (t.brand_id || null) === b && (t.establishment_id || null) === s);
    return (brand && site && pick(brand, site)) || (brand && pick(brand, null)) || (site && pick(null, site)) || pick(null, null) || null;
  };
  TB.saveTarget = function ({ code, brand_id = null, establishment_id = null, target, tolerance_pct, valid_from, valid_to = null }) {
    if (!G.can('tab.target.manage')) G.fail('RN-TAB-05', `Tu rol (${G.roleName()}) no tiene el permiso tab.target.manage.`);
    const d = TB.def(code); if (!d) G.fail('RN-TAB-05', 'Indicador no encontrado.');
    if (target === '' || target == null || !isFinite(Number(target))) G.fail('RN-TAB-04', 'La meta debe ser un número.');
    if (!valid_from) G.fail('RN-TAB-05', 'Falta la fecha de inicio de la vigencia.');
    if (valid_to && valid_to < valid_from) G.fail('RN-TAB-05', 'La vigencia termina antes de empezar.');
    const clash = G.db.find('kpi_targets', t => t.kpi_id === d.id && (t.brand_id || null) === (brand_id || null) && (t.establishment_id || null) === (establishment_id || null) && overlap(t.valid_from, t.valid_to, valid_from, valid_to));
    if (clash) G.fail('RN-TAB-05', `Ya hay una meta vigente de ${code} para ${brand_id ? G.brandName(brand_id) : 'todas las marcas'} y ${establishment_id ? G.siteName(establishment_id) : 'todos los locales'} entre ${G.fmt.date(clash.valid_from)} y ${clash.valid_to ? G.fmt.date(clash.valid_to) : 'sin fin'}. Cierra esa vigencia primero.`);
    const row = G.db.insert('kpi_targets', { kpi_id: d.id, kpi_code: code, brand_id: brand_id || null, establishment_id: establishment_id || null, target: Number(target), tolerance_pct: tolerance_pct === '' || tolerance_pct == null ? Number(G.param('tab_default_tolerance_pct')) || 10 : Number(tolerance_pct), valid_from, valid_to: valid_to || null, created_by: G.ctx.userName() });
    TB.cache.clear();
    return row;
  };
  TB.closeTarget = function (id, date = G.TODAY) {
    if (!G.can('tab.target.manage')) G.fail('RN-TAB-05', `Tu rol (${G.roleName()}) no tiene el permiso tab.target.manage.`);
    const t = G.db.get('kpi_targets', id); if (t.valid_to && t.valid_to < date) G.fail('RN-TAB-05', 'La meta ya no está vigente.');
    return G.db.update('kpi_targets', id, { valid_to: date < t.valid_from ? t.valid_from : date });
  };

  /* ------------------------------------------------------------------
     Motor: cálculo al vuelo con caché y lectura de snapshots · RN-TAB-01
     ------------------------------------------------------------------ */
  TB.range = period => { const from = G.date.month(period); const last = G.date.add(G.date.addMonths(from, 1), -1); return { from, to: last < G.TODAY ? last : G.TODAY, last }; };
  TB.isFinished = period => TB.range(period).last < G.TODAY;
  TB.dimKey = ({ brand, site } = {}) => [brand ? 'B:' + brand : null, site ? 'S:' + site : null].filter(Boolean).join('|') || 'ALL';
  TB.cache = { m: new Map(), clear() { this.m.clear(); } };
  for (const ev of ['order.confirmed', 'order.delivered', 'order.cancelled', 'order.closed', 'payment.confirmed', 'payment.reversed', 'delivery_cost.allocated', 'ad_spend.imported', 'attribution.created', 'control_alert.raised', 'call.completed', 'call.missed', 'module.enabled', 'module.disabled', 'expense.approved', 'stock.moved', 'document.issued', 'period.closed']) G.events.on(ev, () => TB.cache.clear());
  /** cálculo directo (sin caché) con el calculador registrado; nunca lanza */
  TB.compute = function (code, p) {
    const f = G.kpiCalc[code]; if (!f) return null;
    try { const v = f(Object.assign({ brand: null, site: null }, p)); return v && typeof v === 'object' ? v : { value: v }; } catch (e) { return { value: null, error: String(e.message || e) }; }
  };
  TB.runs = period => G.db.where('kpi_snapshot_runs', r => r.period === period).sort(U.by('run_no'));
  TB.latestRun = period => TB.runs(period).filter(r => r.status === 'OK').pop() || null;
  let snapIdx = null, snapLen = -1, snapTen = null;
  const snapIndex = () => { const raw = G.db.raw('kpi_snapshots'); if (raw.length !== snapLen || snapTen !== G.ctx.tenant || !snapIdx) { snapIdx = new Map(); for (const s of G.db.all('kpi_snapshots')) snapIdx.set(`${s.kpi_code}|${s.period}|${s.dimension_key}|${s.run_no}`, s); snapLen = raw.length; snapTen = G.ctx.tenant; } return snapIdx; };
  /**
   * Valor de un indicador para un mes: mes congelado → snapshot de la última corrida OK; mes en curso → al vuelo con caché.
   * {period, brand, site, live} → {value, numerator, denominator, source:'SNAPSHOT'|'LIVE'|'CACHE', run_no, hidden, nocalc}
   */
  TB.value = function (code, { period = G.date.month(G.TODAY), brand = null, site = null, live = false } = {}) {
    const d = TB.def(code);
    if (d && !G.modOn(d.requires_module || d.module_code)) return { value: null, hidden: true, reason: 'RN-TAB-07' };
    const per = G.date.month(period);
    const run = !live && TB.latestRun(per);
    if (run) { const s = snapIndex().get(`${code}|${per}|${TB.dimKey({ brand, site })}|${run.run_no}`); if (s) return { value: s.value, numerator: s.numerator, denominator: s.denominator, source: 'SNAPSHOT', run_no: run.run_no, computed_at: s.computed_at }; }
    if (!TB.hasCalc(code)) return { value: null, nocalc: true };
    const { from, to } = TB.range(per);
    const key = `${G.ctx.tenant}|${code}|${from}|${to}|${brand}|${site}`;
    const ttl = (Number(G.param('tab_cache_minutes')) || 15) * 60000;
    const hit = TB.cache.m.get(key);
    if (hit && Date.now() - hit.t < ttl) return Object.assign({}, hit.v, { source: 'CACHE' });
    const v = TB.compute(code, { from, to, brand, site }) || { value: null };
    TB.cache.m.set(key, { t: Date.now(), v });
    return Object.assign({}, v, { source: run === false ? 'LIVE' : 'LIVE', frozenMissing: !!TB.latestRun(per) });
  };
  TB.status = function (code, value, opts = {}) { const d = TB.def(code); const t = TB.targetFor(code, opts); return { target: t, sem: t ? TB.semaphore(value, t.target, d.direction, t.tolerance_pct) : null }; };

  /* ------------------------------------------------------------------
     Congelamiento mensual · RN-TAB-03, RN-TAB-10
     ------------------------------------------------------------------ */
  TB.freeze = function (period, { reason, at, codes } = {}) {
    if (!G._seeding && !G.can('tab.snapshot.run')) G.fail('RN-TAB-03', `Tu rol (${G.roleName()}) no tiene el permiso tab.snapshot.run.`);
    const per = G.date.month(period); const { from, last } = TB.range(per);
    if (!TB.isFinished(per)) G.fail('RN-TAB-03', `Solo se congela un mes terminado: ${G.date.monthName(per)} termina el ${G.fmt.date(last)} (hora de Lima).`);
    const prev = TB.runs(per);
    if (prev.some(r => r.status === 'OK') && (!reason || String(reason).trim().length < 10)) G.fail('RN-TAB-03', `${G.date.monthName(per)} ya está congelado (corrida ${TB.latestRun(per).run_no}): recalcular exige un motivo de al menos 10 caracteres.`);
    const run_no = (prev.length ? Math.max(...prev.map(r => r.run_no)) : 0) + 1;
    const run = ins('kpi_snapshot_runs', { period: per, run_no, reason: reason || 'Congelamiento del mes', kpis_count: 0, status: 'RUNNING', started_at: at || G.date.now(), finished_at: null, user: G.ctx.userName() });
    try {
      const brands = G.db.all('brands').map(b => b.id), sites = G.db.all('establishments').map(e => e.id);
      const dims = [{}, ...brands.map(b => ({ brand: b })), ...sites.map(s => ({ site: s }))];
      let n = 0;
      for (const d of TB.defs()) {
        if (d.status !== 'ACTIVE' || !G.modOn(d.requires_module || d.module_code) || !TB.hasCalc(d.code) || (codes && !codes.includes(d.code))) continue;
        for (const dm of dims) { const v = TB.compute(d.code, { from, to: last, brand: dm.brand || null, site: dm.site || null }) || {}; ins('kpi_snapshots', { kpi_id: d.id, kpi_code: d.code, period: per, dimension_key: TB.dimKey(dm), value: v.value == null ? null : Number(v.value), numerator: v.numerator ?? null, denominator: v.denominator ?? null, run_no, computed_at: at || G.date.now(), snapshot_run_id: run.id }); }
        n++;
      }
      Object.assign(run, { status: 'OK', kpis_count: n, finished_at: at || G.date.now() });
    } catch (e) { Object.assign(run, { status: 'FAILED', error: String(e.message || e), finished_at: G.date.now() }); G.db.touch(); throw e; }
    G.db.touch(); TB.cache.clear();
    if (!G._seeding) { G.events.emit('kpi.period_frozen', { period: per, run_no }); G.notify({ role: 'GERENTE', title: `Indicadores de ${G.date.monthName(per)} congelados (corrida ${run_no})`, body: reason || '', tone: 'info', module: 'TAB' }); G.audit('CONGELAR', 'kpi_snapshot_runs', run.id, `${G.date.monthName(per)} corrida ${run_no}${reason ? ' · ' + reason : ''}`); }
    return run;
  };

  /* ------------------------------------------------------------------
     Alcance del usuario · RN-TAB-06
     ------------------------------------------------------------------ */
  TB.scopeOpts = function () {
    const u = G.scope.user(); const notes = [];
    let brand = G.ctx.brand !== 'ALL' ? G.ctx.brand : null, site = G.ctx.site !== 'ALL' ? G.ctx.site : null;
    if (!brand && u && u.brands && u.brands.length) { brand = u.brands[0]; if (u.brands.length > 1) notes.push(`Tu alcance tiene ${u.brands.length} marcas: se muestra ${G.brandName(brand)}; elige otra arriba.`); }
    if (!site && u && u.sites && u.sites.length) { site = u.sites[0]; notes.push(`Alcance limitado a ${G.siteName(site)} (SEG).`); }
    return { brand, site, notes };
  };

  /* ------------------------------------------------------------------
     Tableros por rol (dashboards, dashboard_widgets) · tab_seed_dashboards
     ------------------------------------------------------------------ */
  const DASH = [
    ['GERENCIA', 'TAB-01', 'Tablero de gerencia', ['GERENTE', 'ADMINISTRACION', 'CONTADORA', 'AUDITOR'], ['KPI-PED-01', 'KPI-PED-02', 'KPI-DEL-04', 'KPI-PRE-03', 'KPI-ADS-05', 'KPI-CRM-08', 'KPI-GAS-01', 'KPI-CRM-10', 'KPI-ADS-06', 'KPI-TAB-01'], ['GAS', 'TAB']],
    ['VENTAS', 'TAB-02', 'Tablero de ventas', ['SUPERVISORA_VENTAS', 'VENDEDORA', 'MARKETING', 'ADMINISTRACION', 'CAJERO'], ['KPI-PED-01', 'KPI-PED-08', 'KPI-PED-02', 'KPI-CRM-04', 'KPI-CRM-05', 'KPI-CRM-06', 'KPI-CRM-07', 'KPI-PED-05', 'KPI-CLI-01', 'KPI-PED-03'], ['PED', 'CLI', 'POS', 'WEB']],
    ['SUPERVISORA', 'TAB-03', 'Tablero de la supervisora', ['SUPERVISORA_VENTAS'], ['KPI-CRM-03', 'KPI-CRM-02', 'KPI-CRM-10', 'KPI-CRM-14', 'KPI-CRM-15', 'KPI-TEL-01', 'KPI-TEL-02', 'KPI-TEL-06', 'KPI-TEL-03', 'KPI-TEL-08'], ['CRM', 'TEL']],
    ['DELIVERY', 'TAB-04', 'Tablero de delivery', ['COORDINADOR_DELIVERY', 'ADMINISTRACION'], ['KPI-DEL-01', 'KPI-DEL-02', 'KPI-DEL-03', 'KPI-DEL-04', 'KPI-DEL-05', 'KPI-DEL-07', 'KPI-DEL-08', 'KPI-DEL-13', 'KPI-DEL-16', 'KPI-CAJ-01'], ['DEL', 'CAJ']],
    ['ALMACEN', 'TAB-05', 'Tablero de almacén y preparación', ['ALMACENERO', 'PREPARADOR', 'JEFE_PRODUCCION', 'CALIDAD'], ['KPI-PRE-01', 'KPI-PRE-02', 'KPI-PRE-05', 'KPI-PRE-03', 'KPI-PRE-07', 'KPI-PED-04', 'KPI-ALM-02', 'KPI-ALM-04', 'KPI-ALM-07', 'KPI-PRE-06'], ['PRE', 'ALM']],
    ['MARKETING', 'TAB-06', 'Tablero de marketing', ['MARKETING'], ['KPI-ADS-01', 'KPI-ADS-02', 'KPI-ADS-03', 'KPI-ADS-04', 'KPI-ADS-05', 'KPI-ADS-06', 'KPI-ADS-07', 'KPI-ADS-08', 'KPI-ADS-09', 'KPI-CRM-08'], ['ADS', 'CMP']],
  ];
  TB.DASH = DASH;
  TB.seedDashboards = function () {
    const defs = new Map(TB.defs().map(d => [d.code, d]));
    for (const [code, screen, name, roles, tiles, mods] of DASH) {
      let dsh = G.db.find('dashboards', x => x.code === code);
      if (!dsh) dsh = G.db.insert('dashboards', { id: 'dsh-' + code, code, name, role_codes: roles, is_system: true, layout: { screen } }, { silent: true });
      const have = new Set(G.db.where('dashboard_widgets', w => w.dashboard_id === dsh.id).map(w => w.kpi_code));
      let pos = have.size;
      for (const c of tiles) if (defs.has(c) && !have.has(c)) { G.db.insert('dashboard_widgets', { dashboard_id: dsh.id, kpi_id: defs.get(c).id, kpi_code: c, position: ++pos, viz: 'TILE', dimension: null }, { silent: true }); have.add(c); }
      for (const d of defs.values()) if (mods.includes(d.module_code) && !have.has(d.code)) { G.db.insert('dashboard_widgets', { dashboard_id: dsh.id, kpi_id: d.id, kpi_code: d.code, position: ++pos, viz: 'TABLE', dimension: null }, { silent: true }); have.add(d.code); }
    }
  };
  /** indicadores visibles de un tablero para un rol (RN-TAB-06, RN-TAB-07) */
  TB.dashboardCodes = function (code, role = G.ctx.role) {
    const dsh = G.db.find('dashboards', x => x.code === code); if (!dsh) return [];
    return G.db.where('dashboard_widgets', w => w.dashboard_id === dsh.id).sort(U.by('position')).filter(w => TB.visible(TB.def(w.kpi_code), role)).map(w => w.kpi_code);
  };

  /* ------------------------------------------------------------------
     Cálculos de respaldo (solo si el módulo dueño no registró el suyo en este build)
     ------------------------------------------------------------------ */
  const inR = (d, p) => { const s = String(d || '').slice(0, 10); return s >= p.from && s <= p.to; };
  const routesOf = p => G.db.where('delivery_routes', r => inR(r.route_date, p) && r.status !== 'CANCELLED' && (!p.site || r.establishment_id === p.site));
  TB.routeCosts = function (p) {
    const routes = routesOf(p); const ids = new Set(routes.map(r => r.id));
    const cost = {}, deliv = {};
    for (const c of G.db.where('delivery_costs', c => c.route_id && ids.has(c.route_id))) cost[c.route_id] = (cost[c.route_id] || 0) + Number(c.amount || 0);
    for (const s of G.db.where('delivery_stops', s => ids.has(s.route_id) && s.status === 'DELIVERED')) deliv[s.route_id] = (deliv[s.route_id] || 0) + 1;
    return routes.map(r => ({ r, cost: R(cost[r.id] || 0), deliveries: deliv[r.id] || 0 }));
  };
  const collectedBy = function (p, keyFn) {
    const m = {}; const orders = new Map(G.db.all('sales_orders').map(o => [o.id, o]));
    for (const py of G.db.all('payments')) { if (py.status !== 'CONFIRMED' || !inR(py.paid_at, p)) continue; if (p.brand && py.brand_id !== p.brand) continue; if (p.site && py.establishment_id !== p.site) continue; for (const al of py.allocations || []) { const o = al.order_id && orders.get(al.order_id); const k = o ? keyFn(o, py) : keyFn(null, py); if (k == null) continue; m[k] = (m[k] || 0) + Number(al.amount || 0); } }
    return m;
  };
  TB.collectedBy = collectedBy;
  const delivered = p => G.sales.orders(p);
  TB.FALLBACK = {
    'KPI-DEL-04': p => {
      const per = G.date.month(p.from); const al = G.db.where('delivery_cost_allocations', a => a.period === per);
      if (al.length) { const last = Math.max(...al.map(a => a.run_no || 1)); const rows = al.filter(a => (a.run_no || 1) === last && (!p.brand || (G.db.get('sales_orders', a.order_id) || {}).brand_id === p.brand)); const t = U.sum(rows, a => a.total_cost); return { value: rows.length ? R(t / rows.length) : null, numerator: R(t), denominator: rows.length }; }
      const rs = TB.routeCosts(p); const c = U.sum(rs, x => x.cost), n = U.sum(rs, x => x.deliveries);
      return { value: n ? R(c / n) : null, numerator: R(c), denominator: n };
    },
    'KPI-PRE-03': p => { const os = delivered(p); const ids = new Set(os.map(o => o.id)); const err = new Set(G.db.where('packing_errors', e => ids.has(e.order_id) && ['DELIVERY', 'CUSTOMER_CLAIM'].includes(e.detected_at_stage)).map(e => e.order_id)); return { value: os.length ? R(err.size / os.length * 100, 2) : null, numerator: err.size, denominator: os.length }; },
    'KPI-CRM-05': p => { const first = {}; for (const o of G.db.where('sales_orders', o => ['DELIVERED', 'CLOSED'].includes(o.status) && o.customer_id)) { const d = (o.delivered_at || o.created_at); if (!first[o.customer_id] || d < first[o.customer_id].d) first[o.customer_id] = { d, o }; } const n = Object.values(first).filter(x => inR(x.d, p) && (!p.brand || x.o.brand_id === p.brand) && (!p.site || x.o.establishment_id === p.site)).length; return { value: n, numerator: n, denominator: null }; },
    'KPI-CRM-06': p => { const os = delivered(p); const cs = new Set(os.map(o => o.customer_id)); const from90 = G.date.add(p.from, -90); const prevSet = new Set(G.db.where('sales_orders', o => ['DELIVERED', 'CLOSED'].includes(o.status) && (o.delivered_at || o.created_at).slice(0, 10) >= from90 && (o.delivered_at || o.created_at).slice(0, 10) < p.from).map(o => o.customer_id)); const byC = U.groupBy(os, 'customer_id'); let rec = 0; for (const c of cs) if (prevSet.has(c) || (byC[c] || []).length > 1) rec++; return { value: cs.size ? R(rec / cs.size * 100, 1) : null, numerator: rec, denominator: cs.size }; },
    'KPI-CRM-08': p => { const ch = G.db.where('message_charges', m => inR(m.period, { from: G.date.month(p.from), to: p.to }) && (!p.brand || m.brand_id === p.brand)); const cost = ch.length ? U.sum(ch, m => m.amount) : U.sum(G.db.where('messages', m => inR(m.sent_at, p)), m => m.cost || 0); const n = delivered(p).filter(o => o.channel === 'WHATSAPP').length; return { value: n ? R(cost / n, 4) : null, numerator: R(cost, 4), denominator: n }; },
    'KPI-CRM-10': p => { const n = G.db.where('control_alerts', a => a.status === 'CONFIRMED' && inR(a.reviewed_at, p)).length; return { value: n, numerator: n, denominator: null }; },
    'KPI-CRM-15': p => { const m = collectedBy(p, o => o && o.seller_id ? o.seller_id : null); const t = R(U.sum(Object.values(m))); return { value: t, numerator: t, denominator: Object.keys(m).length }; },
    'KPI-GAS-01': p => { const t = R(U.sum(G.db.where('expenses', e => ['APPROVED', 'PAID'].includes(e.status) && inR(e.issue_date, p) && (!p.brand || e.brand_id === p.brand) && (!p.site || e.establishment_id === p.site)), e => e.amount_pen ?? e.total)); return { value: t, numerator: t, denominator: null }; },
    'KPI-PED-05': p => { const conf = G.db.where('sales_orders', o => o.confirmed_at && inR(o.confirmed_at, p) && (!p.brand || o.brand_id === p.brand) && (!p.site || o.establishment_id === p.site)); const c = conf.filter(o => o.status === 'CANCELLED').length; return { value: conf.length ? R(c / conf.length * 100, 2) : null, numerator: c, denominator: conf.length }; },
    'KPI-PED-08': p => { const conf = G.db.where('sales_orders', o => o.confirmed_at && inR(o.confirmed_at, p) && o.status !== 'CANCELLED' && (!p.brand || o.brand_id === p.brand) && (!p.site || o.establishment_id === p.site)); const days = new Set(conf.map(o => o.confirmed_at.slice(0, 10))).size; return { value: days ? R(conf.length / days, 1) : null, numerator: conf.length, denominator: days }; },
  };
  /* indicadores propios de TAB */
  G.kpiCalc['KPI-TAB-01'] = p => { const act = TB.defs().filter(d => d.status === 'ACTIVE' && G.modOn(d.requires_module || d.module_code)); const w = act.filter(d => TB.targetFor(d.code, { brand: p.brand, site: p.site, date: p.to })).length; return { value: act.length ? R(w / act.length * 100, 1) : null, numerator: w, denominator: act.length }; };
  G.kpiCalc['KPI-TAB-02'] = p => { const per = G.date.month(p.from); const ok = TB.runs(per).filter(r => r.status === 'OK').sort(U.by('finished_at'))[0]; if (!ok) return { value: null }; const d = G.date.diff(String(ok.finished_at).slice(0, 10), TB.range(per).last); return { value: d, numerator: d, denominator: null }; };

  /* ------------------------------------------------------------------
     Bajada al detalle (drilldown) · RN-TAB-02
     ------------------------------------------------------------------ */
  TB.drills = TB.drills || {};
  TB.drills['KPI-DEL-04'] = p => ({ columns: [['ruta', 'Ruta'], ['fecha', 'Fecha'], ['local', 'Local'], ['modalidad', 'Modalidad'], ['vehiculo', 'Vehículo'], ['costo', 'Costo', 'money'], ['entregas', 'Entregas', 'num'], ['por_entrega', 'Costo por entrega', 'money']], rows: TB.routeCosts(p).map(x => ({ ruta: x.r.code, fecha: G.fmt.date(x.r.route_date), local: G.siteName(x.r.establishment_id), establishment_id: x.r.establishment_id, route_id: x.r.id, modalidad: { OWN: 'Propia', RENTED: 'Alquilada', THIRD_PARTY: 'Tercero' }[x.r.mode] || x.r.mode, vehiculo: (G.db.get('vehicles', x.r.vehicle_id) || {}).plate || '—', costo: x.cost, entregas: x.deliveries, por_entrega: x.deliveries ? R(x.cost / x.deliveries) : null })), sum: ['costo', 'entregas'], ratio: ['costo', 'entregas'] });
  const orderDrill = p => ({ columns: [['pedido', 'Pedido'], ['entregado', 'Entregado'], ['canal', 'Canal'], ['marca', 'Marca'], ['cliente', 'Cliente'], ['total', 'Total', 'money']], rows: delivered(p).map(o => ({ pedido: o.number, entregado: G.fmt.date(o.delivered_at), canal: G.channelName(o.channel), marca: G.brandName(o.brand_id), cliente: G.custName(o.customer_id), total: o.final_total ?? o.estimated_total })), sum: ['total'], personal: true });
  TB.drills['KPI-PED-01'] = orderDrill; TB.drills['KPI-PED-02'] = orderDrill;
  TB.drills['KPI-CRM-15'] = p => { const m = collectedBy(p, o => o && o.seller_id ? o.seller_id : null); return { columns: [['vendedora', 'Vendedora'], ['cobrado', 'Cobrado', 'money']], rows: Object.entries(m).map(([k, v]) => ({ vendedora: G.userName(k), cobrado: R(v) })), sum: ['cobrado'] }; };
  TB.drills['KPI-GAS-01'] = p => ({ columns: [['gasto', 'Gasto'], ['fecha', 'Fecha'], ['proveedor', 'Proveedor'], ['detalle', 'Detalle'], ['monto', 'Monto', 'money']], rows: G.db.where('expenses', e => ['APPROVED', 'PAID'].includes(e.status) && inR(e.issue_date, p) && (!p.brand || e.brand_id === p.brand)).map(e => ({ gasto: e.number, fecha: G.fmt.date(e.issue_date), proveedor: G.supName(e.supplier_id), detalle: e.description || '', monto: e.amount_pen ?? e.total })), sum: ['monto'] });
  TB.drills['KPI-TAB-01'] = p => ({ columns: [['indicador', 'Indicador'], ['modulo', 'Módulo'], ['meta', 'Meta vigente'], ['con_meta', 'Con meta (1/0)', 'num']], rows: TB.defs().filter(d => d.status === 'ACTIVE' && G.modOn(d.requires_module || d.module_code)).map(d => { const t = TB.targetFor(d.code, { brand: p.brand, site: p.site, date: p.to }); return { indicador: d.code + ' · ' + d.name, modulo: d.module_code, meta: t ? TB.fmt(t.target, d) : '—', con_meta: t ? 1 : 0 }; }), sum: ['con_meta'] });
  TB.drill = function (code, p) {
    if (TB.drills[code]) return TB.drills[code](p);
    const mod = code.split('-')[1];
    const ns = G[mod.toLowerCase()];
    if (ns && typeof ns.drill === 'function') { try { const r = ns.drill(code, p); if (r) return r; } catch (e) { /* sin detalle */ } }
    return null;
  };

  /* ------------------------------------------------------------------
     Exportación (AUD: data_exports) · RN-TAB-09
     ------------------------------------------------------------------ */
  TB.export = function ({ report, columns, rows, format = 'CSV', filters = {}, personal = false }) {
    if (!G.can('tab.export.run')) G.fail('RN-TAB-09', `Tu rol (${G.roleName()}) no tiene el permiso tab.export.run.`);
    const st0 = personal ? 'REQUESTED' : 'READY';
    const ex = G.db.insert('data_exports', { requested_by: G.ctx.userId(), module_code: 'TAB', report_code: report, filters, file_format: format, row_count: rows.length, contains_personal_data: !!personal, reason: personal ? 'Detalle con datos de clientes' : null, status: st0, expires_at: G.date.add(G.TODAY, 2) + 'T23:59' });
    if (st0 === 'READY' && format !== 'PDF') {
      const esc = v => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const csv = [columns.map(c => esc(c[1])).join(';')].concat(rows.map(r => columns.map(c => esc(r[c[0]])).join(';'))).join('\n');
      try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: format === 'XLSX' ? 'application/vnd.ms-excel' : 'text/csv' })); a.download = report.replace(/\W+/g, '-') + (format === 'XLSX' ? '.xls' : '.csv'); document.body.appendChild(a); a.click(); a.remove(); } catch (e) { /* descarga no disponible en este entorno */ }
    }
    if (format === 'PDF' && st0 === 'READY') G.print();
    return ex;
  };
  function exportBtns(report, getData) {
    if (!G.can('tab.export.run')) return [];
    return ['XLSX', 'CSV', 'PDF'].map(f => btn(f === 'XLSX' ? 'Excel' : f, () => { try { const d = getData(); const ex = TB.export(Object.assign({ report, format: f }, d)); toast(ex.status === 'REQUESTED' ? 'RN-TAB-09: el detalle lleva datos personales; la exportación quedó en AUD-05 esperando aprobación de otra persona' : `Exportación ${f} registrada (${ex.row_count} filas)`, ex.status === 'REQUESTED' ? 'warn' : 'ok'); } catch (e) { toast(e.message, 'bad'); } }, { sm: true }));
  }

  /* ------------------------------------------------------------------
     Semilla (orden 38): respaldo de cálculos, catálogo, tableros, metas y
     snapshots congelados de mayo a setiembre
     ------------------------------------------------------------------ */
  G.seed(38, function seedTAB() {
    for (const [c, f] of Object.entries(TB.FALLBACK)) if (!G.kpiCalc[c] || TB.fallbackUsed[c]) { G.kpiCalc[c] = f; TB.fallbackUsed[c] = true; }
    // catálogo: columnas agregadas por TAB
    const SCREEN = {}; for (const [m, spec] of Object.entries(G.SPEC)) SCREEN[m] = (spec.screens[0] || [])[0];
    for (const d of G.db.all('kpi_definitions')) {
      const nn = d.code.split('-').pop();
      d.calculator = d.calculator || `kpi_${d.module_code.toLowerCase()}_${nn}`;
      d.drilldown = d.drilldown || (TB.drills[d.code] ? 'TAB-10' : SCREEN[d.module_code] || 'TAB-10');
      d.decimals = d.decimals != null ? d.decimals : d.unit === 'COUNT' ? 0 : 2;
      d.visible_roles = d.visible_roles || [];
      d.requires_module = d.requires_module || d.module_code;
      d.dimensions = d.dimensions || ['brand', 'site'];
      d.source = d.source || null;
      d.frequency = /al instante|al cierre del d[ií]a|al d[ií]a/i.test(d.formula) ? 'INSTANT' : /por semana/i.test(d.formula) ? 'WEEKLY' : d.frequency || 'MONTHLY';
    }
    const fix = { 'KPI-TAB-01': ['PCT', 1], 'KPI-TAB-02': ['DAYS', 0], 'KPI-PED-02': ['PEN', 2], 'KPI-PED-08': ['COUNT', 1], 'KPI-CRM-05': ['COUNT', 0], 'KPI-CRM-10': ['COUNT', 0], 'KPI-CRM-08': ['PEN', 4], 'KPI-DEL-01': ['COUNT', 0] };
    for (const [c, [u, dec]] of Object.entries(fix)) { const d = TB.def(c); if (d) Object.assign(d, { unit: u, decimals: dec }); }
    const t1 = TB.def('KPI-TAB-01'); if (t1) Object.assign(t1, { source: 'kpi_definitions, kpi_targets', dimensions: ['brand', 'site'], drilldown: 'TAB-08' });
    const t2 = TB.def('KPI-TAB-02'); if (t2) Object.assign(t2, { source: 'kpi_snapshot_runs', dimensions: [], drilldown: 'TAB-09' });
    TB.seedDashboards();
    // metas iniciales (D-TAB-01: propuestas desde setiembre congelado)
    const T0 = [['KPI-PED-02', null, null, 95, 10], ['KPI-DEL-04', null, null, 12, 10], ['KPI-DEL-04', null, 'es-L2', 14, 10], ['KPI-PRE-03', null, null, 0.5, 10], ['KPI-CRM-04', null, null, 20, 10], ['KPI-CRM-02', null, null, 5, 20], ['KPI-CRM-08', null, null, 0.5, 10], ['KPI-ADS-05', null, null, 4, 10], ['KPI-ADS-05', 'br-DG', null, 5, 10], ['KPI-ADS-05', 'br-M4', null, 3, 15], ['KPI-ADS-02', null, null, 9, 10], ['KPI-ADS-03', null, null, 20, 10], ['KPI-ADS-04', null, null, 45, 10], ['KPI-ADS-06', null, null, 14, 10], ['KPI-ADS-08', null, null, 75, 10], ['KPI-ADS-09', null, null, 30, 10], ['KPI-ADS-01', null, null, 13500, 10], ['KPI-TEL-01', null, null, 90, 5], ['KPI-TEL-03', null, null, 0.5, 20], ['KPI-TEL-06', null, null, 85, 10], ['KPI-PED-05', null, null, 3, 20], ['KPI-PED-08', null, null, 33, 10], ['KPI-CRM-05', null, null, 150, 10], ['KPI-CRM-06', null, null, 35, 10], ['KPI-TAB-01', null, null, 25, 10], ['KPI-TAB-02', null, null, 3, 30], ['KPI-PED-01', 'br-DG', null, 60000, 10], ['KPI-PED-01', 'br-M2', null, 11000, 10], ['KPI-PED-01', null, null, 95000, 10], ['KPI-GAS-01', null, null, 25000, 10]];
    for (const [c, b, s, t, tol] of T0) { const d = TB.def(c); if (d) ins('kpi_targets', { kpi_id: d.id, kpi_code: c, brand_id: b, establishment_id: s, target: t, tolerance_pct: tol, valid_from: '2026-09-01', valid_to: null, created_by: 'Rosa Quispe Huamán' }); }
    const old = TB.def('KPI-DEL-04'); if (old) ins('kpi_targets', { kpi_id: old.id, kpi_code: 'KPI-DEL-04', brand_id: null, establishment_id: null, target: 14, tolerance_pct: 10, valid_from: '2026-05-01', valid_to: '2026-08-31', created_by: 'Rosa Quispe Huamán' });
    // setiembre congelado el 03/10 (corrida 1, valores reales) y mayo–agosto (corridas históricas)
    const sepCodes = TB.defs().filter(d => d.status === 'ACTIVE' && G.modOn(d.requires_module || d.module_code) && TB.hasCalc(d.code)).map(d => d.code);
    const sep = TB.range('2026-09-01');
    const runSep = ins('kpi_snapshot_runs', { period: '2026-09-01', run_no: 1, reason: 'Congelamiento automático (día ' + (G.param('tab_snapshot_day') || 3) + ', 02:00)', kpis_count: 0, status: 'OK', started_at: '2026-10-03T02:00', finished_at: '2026-10-03T02:04', user: 'Programador de tareas' });
    const sepVal = {};
    for (const c of sepCodes) { const d = TB.def(c); const v = c === 'KPI-TAB-02' ? { value: 3, numerator: 3 } : (TB.compute(c, { from: sep.from, to: sep.last }) || {}); sepVal[c] = v; ins('kpi_snapshots', { kpi_id: d.id, kpi_code: c, period: '2026-09-01', dimension_key: 'ALL', value: v.value ?? null, numerator: v.numerator ?? null, denominator: v.denominator ?? null, run_no: 1, computed_at: '2026-10-03T02:03', snapshot_run_id: runSep.id }); }
    runSep.kpis_count = sepCodes.length;
    const r = U.rng(3838);
    const fac = { '2026-05-01': 0.78, '2026-06-01': 0.84, '2026-07-01': 0.9, '2026-08-01': 0.95 };
    for (const per of Object.keys(fac)) {
      const fin = G.date.add(G.date.addMonths(per, 1), Number(G.param('tab_snapshot_day')) || 3);
      const run = ins('kpi_snapshot_runs', { period: per, run_no: 1, reason: 'Congelamiento automático (día 3, 02:00)', kpis_count: sepCodes.length, status: 'OK', started_at: fin + 'T02:00', finished_at: fin + 'T02:0' + U.int(r, 2, 6), user: 'Programador de tareas' });
      for (const c of sepCodes) {
        const d = TB.def(c); const v = sepVal[c]; if (v.value == null) continue;
        const additive = ['PEN', 'COUNT'].includes(d.unit) && !/promedio|por |ticket|costo/i.test(d.name);
        const f = additive ? fac[per] * (0.97 + 0.06 * r()) : (d.direction === 'LOWER_BETTER' ? 1 + (1 - fac[per]) * 0.6 : 1 - (1 - fac[per]) * 0.5) * (0.98 + 0.04 * r());
        const val = c === 'KPI-TAB-02' ? U.int(r, 2, 5) : R(v.value * f, 4);
        ins('kpi_snapshots', { kpi_id: d.id, kpi_code: c, period: per, dimension_key: 'ALL', value: val, numerator: v.numerator != null && additive ? R(v.numerator * f, 4) : v.numerator ?? null, denominator: v.denominator ?? null, run_no: 1, computed_at: run.finished_at, snapshot_run_id: run.id });
      }
    }
    // agosto: recalculado con motivo (corrida 2) por una factura de combustible tardía
    const aug2 = ins('kpi_snapshot_runs', { period: '2026-08-01', run_no: 2, reason: 'Factura de combustible de agosto registrada tarde en GAS (Primax, S/ 412)', kpis_count: 0, status: 'OK', started_at: '2026-09-12T16:20', finished_at: '2026-09-12T16:23', user: 'Carmen Huamán Soto' });
    let n2 = 0;
    for (const s of G.db.where('kpi_snapshots', s => s.period === '2026-08-01' && s.run_no === 1)) { const bump = ['KPI-DEL-04', 'KPI-GAS-01', 'KPI-DEL-05'].includes(s.kpi_code) ? 1.03 : 1; ins('kpi_snapshots', Object.assign({}, s, { id: undefined, value: s.value == null ? null : R(s.value * bump, 4), run_no: 2, computed_at: aug2.finished_at, snapshot_run_id: aug2.id })); n2++; }
    aug2.kpis_count = sepCodes.length; void n2;
    const failed = ins('kpi_snapshot_runs', { period: '2026-07-01', run_no: 2, reason: 'Recalcular por nota de crédito de julio', kpis_count: 0, status: 'FAILED', error: 'Tiempo de espera agotado en kpi_crm_08 (corrida no reemplaza a la anterior, RN-TAB-10)', started_at: '2026-08-05T09:10', finished_at: '2026-08-05T09:14', user: 'Carmen Huamán Soto' });
    void failed;
  }, 'TAB');

  /* ------------------------------------------------------------------
     Interfaz
     ------------------------------------------------------------------ */
  const S = TB.ui = TB.ui || { period: G.date.month(G.TODAY), module: 'ADS' };
  const perName = p => p === G.date.month(G.TODAY) ? G.date.monthName(p) + ' (en curso)' : G.date.monthName(p);
  function periodBar(extra) {
    const run = TB.latestRun(S.period);
    return h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;align-items:center' },
      pills(MONTHS.slice().reverse().map(p => [p, perName(p)]), S.period, v => { S.period = v; G.refresh(); }),
      run ? badge(`Congelado · corrida ${run.run_no} del ${G.fmt.date(run.finished_at)}`, 'info') : badge(TB.isFinished(S.period) ? 'Sin congelar' : 'Al vuelo · caché ' + (G.param('tab_cache_minutes') || 15) + ' min', TB.isFinished(S.period) ? 'warn' : ''),
      extra || null);
  }
  /** fila de mosaicos de un conjunto de indicadores, con semáforo, meta, fórmula al pasar el cursor y bajada al detalle */
  function tiles(codes, sc) {
    const items = [];
    for (const c of codes) {
      const d = TB.def(c); if (!d || !TB.visible(d)) continue;
      const v = TB.value(c, { period: S.period, brand: sc.brand, site: sc.site });
      const s0 = TB.status(c, v.value, { brand: sc.brand, site: sc.site, date: TB.range(S.period).to });
      items.push({ label: d.name, value: v.nocalc ? '—' : TB.fmt(v.value, d), tone: s0.sem ? SEM[s0.sem][1] : '', sub: v.nocalc ? 'sin cálculo en este build' : (s0.target ? `meta ${TB.fmt(s0.target.target, d)} · ${SEM[s0.sem] ? SEM[s0.sem][0].toLowerCase() : '—'}` : 'sin meta') + (v.source === 'SNAPSHOT' ? ' · congelado' : ''), title: `${c} · ${d.formula}${v.numerator != null ? `\nNumerador ${G.fmt.num(v.numerator, 2)}${v.denominator != null ? ' / denominador ' + G.fmt.num(v.denominator, 2) : ''}` : ''}`, onClick: () => G.go('TAB-10', { code: c, period: S.period, brand: sc.brand, site: sc.site }) });
    }
    return items.length ? kpis(items) : G.ui.empty('No hay indicadores visibles para tu rol.');
  }
  function allTable(codes, sc, id) {
    const rows = codes.map(c => TB.def(c)).filter(d => d && TB.visible(d)).map(d => { const v = TB.value(d.code, { period: S.period, brand: sc.brand, site: sc.site }); const s0 = TB.status(d.code, v.value, { brand: sc.brand, site: sc.site, date: TB.range(S.period).to }); return { d, v, s0 }; });
    return table({ id, pageSize: 12, columns: [{ key: 'code', label: 'Código', mono: true, value: x => x.d.code }, { key: 'name', label: 'Indicador', value: x => x.d.name, render: x => h('span', { title: x.d.formula }, x.d.name) }, { key: 'val', label: 'Valor', align: 'r', value: x => x.v.value ?? -Infinity, render: x => x.v.nocalc ? h('span', { class: 'muted small' }, 'sin cálculo') : TB.fmt(x.v.value, x.d) }, { key: 'meta', label: 'Meta', align: 'r', value: x => x.s0.target ? x.s0.target.target : null, render: x => x.s0.target ? TB.fmt(x.s0.target.target, x.d) : '—' }, { key: 'sem', label: 'Semáforo', value: x => x.s0.sem || '', render: x => semBadge(x.s0.sem) }, { key: 'dir', label: 'Sentido', value: x => lbl(DIRS, x.d.direction) }, { key: 'src', label: 'Fuente', value: x => x.v.source === 'SNAPSHOT' ? 'Congelado (corrida ' + x.v.run_no + ')' : x.v.nocalc ? '—' : 'Al vuelo' }], rows, onRow: x => G.go('TAB-10', { code: x.d.code, period: S.period, brand: sc.brand, site: sc.site }) });
  }
  function dash(el, screen, dcode, sub, extras) {
    const d0 = DASH.find(x => x[0] === dcode);
    const sc = TB.scopeOpts();
    const codes = TB.dashboardCodes(dcode);
    const tilesCodes = G.db.where('dashboard_widgets', w => { const ds = G.db.find('dashboards', x => x.code === dcode); return ds && w.dashboard_id === ds.id && w.viz === 'TILE'; }).sort(U.by('position')).map(w => w.kpi_code);
    const body = G.ui.page(el, { code: screen, title: d0[2], sub, actions: [btn('Actualizar', () => { TB.cache.clear(); G.refresh(); toast('Indicadores recalculados', 'ok'); }, { sm: true }), ...exportBtns(d0[2] + ' ' + G.date.monthName(S.period), () => ({ columns: [['code', 'Código'], ['name', 'Indicador'], ['value', 'Valor'], ['target', 'Meta'], ['sem', 'Semáforo']], rows: codes.map(c => { const d = TB.def(c); const v = TB.value(c, { period: S.period, brand: sc.brand, site: sc.site }); const s0 = TB.status(c, v.value, sc); return { code: c, name: d.name, value: v.value, target: s0.target ? s0.target.target : '', sem: s0.sem ? SEM[s0.sem][0] : '' }; }), filters: { period: S.period, brand: sc.brand, site: sc.site } }))] });
    body.appendChild(periodBar(h('span', { class: 'muted small' }, `Marca: ${sc.brand ? G.brandName(sc.brand) : 'todas'} · Local: ${sc.site ? G.siteName(sc.site) : 'todos'}`)));
    for (const n of sc.notes) body.appendChild(notice(n, 'info'));
    body.appendChild(tiles(tilesCodes.filter(c => codes.includes(c)), sc));
    const p = Object.assign(TB.range(S.period), { brand: sc.brand, site: sc.site });
    if (extras) extras(body, p, sc);
    body.appendChild(card('Todos los indicadores del tablero', allTable(codes, sc, 'tab-all-' + dcode), { flush: true }));
    body.appendChild(h('div', { class: 'muted small' }, 'Pasa el cursor sobre un valor para ver su fórmula; haz clic para bajar al detalle (RN-TAB-02). Los indicadores de módulos apagados no se calculan ni se muestran (RN-TAB-07).'));
    return body;
  }
  const hb = (obj, nameFn, fmt = v => G.fmt.money(v), n = 10) => { const items = Object.entries(obj).map(([k, v]) => ({ label: nameFn(k), value: R(v) })).sort((a, b) => b.value - a.value).slice(0, n); return items.length ? G.ui.chart.hbar({ items, format: fmt }) : G.ui.empty('Sin datos en el período.'); };
  const ordersIn = (p, pred = () => true) => G.db.where('sales_orders', o => o.created_at.slice(0, 10) >= p.from && o.created_at.slice(0, 10) <= p.to && !['DRAFT', 'CANCELLED'].includes(o.status) && (!p.brand || o.brand_id === p.brand) && (!p.site || o.establishment_id === p.site) && pred(o));
  const countBy = (rows, fn) => { const m = {}; for (const r of rows) { const k = fn(r); if (k == null) continue; m[k] = (m[k] || 0) + 1; } return m; };

  function s01(el) {
    dash(el, 'TAB-01', 'GERENCIA', 'Ventas cobradas por marca y canal, pedidos, ticket, costo por entrega, error de armado, retorno de la publicidad, costo de WhatsApp por pedido, gastos frente a meta y alertas de control, cada uno con su semáforo.', (body, p) => {
      const byB = collectedBy(p, (o, py) => (o || py).brand_id); const byC = collectedBy(p, o => o ? o.channel : 'Sin pedido');
      const tot = U.sum(Object.values(byB));
      body.appendChild(h('div', { class: 'grid c2' },
        card(`Ventas cobradas por marca · ${G.fmt.money(tot)}`, hb(byB, k => G.brandName(k))),
        card('Ventas cobradas por canal', (() => { const e = Object.entries(byC).sort((a, b) => b[1] - a[1]); return e.length ? G.ui.chart.bar({ labels: e.map(x => G.channelName(x[0])), series: [{ name: 'Cobrado', values: e.map(x => R(x[1])) }], format: v => G.fmt.money(v), axisFormat: v => 'S/ ' + G.fmt.num(v / 1000, 0) + ' k' }) : G.ui.empty('Sin cobros en el período.'); })())));
    });
  }
  function s02(el) {
    dash(el, 'TAB-02', 'VENTAS', 'Pedidos y ventas por canal, número de WhatsApp, vendedora y franja; conversión de leads, clientes nuevos y recurrentes, recompra.', (body, p) => {
      const os = ordersIn(p);
      const first = new Map(); for (const o of G.db.where('sales_orders', o => o.status !== 'CANCELLED' && o.customer_id)) { const f = first.get(o.customer_id); if (!f || o.created_at < f) first.set(o.customer_id, o.created_at); }
      const custs = new Set(os.map(o => o.customer_id)); let nw = 0; for (const c of custs) if (first.get(c) >= p.from) nw++;
      body.appendChild(kpis([{ label: 'Pedidos del período', value: G.fmt.num(os.length) }, { label: 'Clientes que compraron', value: G.fmt.num(custs.size) }, { label: 'Nuevos', value: G.fmt.num(nw), sub: G.fmt.pct(custs.size ? nw / custs.size * 100 : null) }, { label: 'Recurrentes', value: G.fmt.num(custs.size - nw), sub: G.fmt.pct(custs.size ? (custs.size - nw) / custs.size * 100 : null) }]));
      const slot = countBy(os.filter(o => o.slot_from), o => `${o.slot_from}–${o.slot_to}`);
      const sl = Object.keys(slot).sort();
      body.appendChild(h('div', { class: 'grid c2' },
        card('Pedidos por canal', hb(countBy(os, o => o.channel), k => G.channelName(k), v => G.fmt.num(v))),
        card('Pedidos por número de WhatsApp', hb(countBy(os.filter(o => o.origin_wa_number), o => o.origin_wa_number), k => { const ch = G.db.find('messaging_channels', c => c.number === k); return ch ? `${ch.display_name} (${k.slice(-4)})` : k; }, v => G.fmt.num(v))),
        card('Ventas por vendedora', hb(collectedBy(p, o => o && o.seller_id ? o.seller_id : null), k => G.userShort(k))),
        card('Pedidos por franja', sl.length ? G.ui.chart.bar({ labels: sl, series: [{ name: 'Pedidos', values: sl.map(k => slot[k]) }], format: v => G.fmt.num(v) }) : G.ui.empty('Sin franjas'))));
    });
  }
  function s03(el) {
    dash(el, 'TAB-03', 'SUPERVISORA', 'Chats sin responder, primera respuesta por vendedora, alertas abiertas y confirmadas, chats sin pedido, ventas cobradas por vendedora y, si TEL está activo, llamadas atendidas, perdidas y devoluciones a tiempo.', (body, p) => {
      const al = G.db.where('control_alerts', a => !a.raised_at || (a.raised_at.slice(0, 10) >= p.from && a.raised_at.slice(0, 10) <= p.to));
      body.appendChild(h('div', { class: 'grid c2' },
        card('Ventas cobradas por vendedora', hb(collectedBy(p, o => o && o.seller_id ? o.seller_id : null), k => G.userShort(k))),
        card('Alertas de control', kpis([{ label: 'Abiertas', value: G.fmt.num(al.filter(a => ['OPEN', 'UNDER_REVIEW'].includes(a.status)).length), tone: 'warn' }, { label: 'Confirmadas', value: G.fmt.num(al.filter(a => a.status === 'CONFIRMED').length), tone: 'bad' }, { label: 'Descartadas', value: G.fmt.num(al.filter(a => a.status === 'DISMISSED').length) }]))));
      if (!G.modOn('TEL')) body.appendChild(notice('La central de llamadas (TEL) está apagada: sus indicadores no se muestran. Al activarla en PLT-12 aparecen aquí sin cambiar nada más.', 'info'));
    });
  }
  function s04(el) {
    dash(el, 'TAB-04', 'DELIVERY', 'Entregas, a tiempo, no entregados, costo por entrega, por kg, por zona y modalidad, subsidio, descuadres de caja, vehículos y documentos por vencer.', (body, p) => {
      const os = delivered(p).filter(o => o.fulfillment === 'DELIVERY');
      const veh = G.db.where('vehicles', v => (!p.site || v.establishment_id === p.site)).flatMap(v => [['SOAT', v.soat_expires_on], ['Revisión técnica', v.tech_inspection_expires_on]].filter(x => x[1]).map(([k, d]) => ({ v, k, d, days: G.date.diff(d, G.TODAY) }))).sort(U.by('days'));
      const rc = TB.routeCosts(p);
      body.appendChild(h('div', { class: 'grid c2' },
        card('Entregas por zona', hb(countBy(os, o => o.zone_id), k => G.zoneName(k), v => G.fmt.num(v))),
        card('Vehículos y documentos por vencer', table({ id: 'tab-04v', search: false, columns: [{ key: 'p', label: 'Vehículo', value: x => x.v.plate + ' · ' + x.v.vehicle_type }, { key: 'k', label: 'Documento' }, { key: 'd', label: 'Vence', render: x => G.fmt.date(x.d) }, { key: 'days', label: 'Días', align: 'r', render: x => badge(String(x.days), x.days < 0 ? 'bad' : x.days <= 30 ? 'warn' : 'ok') }], rows: veh }), { flush: true })));
      if (rc.length) body.appendChild(card('Rutas del período', table({ id: 'tab-04r', columns: [{ key: 'c', label: 'Ruta', value: x => x.r.code }, { key: 'd', label: 'Fecha', value: x => x.r.route_date, render: x => G.fmt.date(x.r.route_date) }, { key: 'l', label: 'Local', value: x => G.siteName(x.r.establishment_id) }, { key: 'cost', label: 'Costo', align: 'r', render: x => G.fmt.money(x.cost) }, { key: 'deliveries', label: 'Entregas', align: 'r' }, { key: 'pe', label: 'Por entrega', align: 'r', value: x => x.deliveries ? x.cost / x.deliveries : null, render: x => x.deliveries ? G.fmt.money(x.cost / x.deliveries) : '—' }], rows: rc }), { flush: true }));
    });
  }
  function s05(el) {
    dash(el, 'TAB-05', 'ALMACEN', 'Pedidos por preparar por franja, preparados por hora-persona, errores bloqueados y escapados, listos a tiempo, desviación de peso y los indicadores de almacén.', (body, p) => {
      const today = G.db.where('sales_orders', o => o.delivery_date === G.TODAY && ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY'].includes(o.status) && (!p.site || o.establishment_id === p.site) && (!p.brand || o.brand_id === p.brand));
      const slots = [...new Set(today.map(o => o.slot_from ? `${o.slot_from}–${o.slot_to}` : 'Sin franja'))].sort();
      const sts = [['CONFIRMED', 'Por preparar'], ['IN_PREPARATION', 'En preparación'], ['WEIGHED', 'Pesados'], ['READY', 'Listos']];
      const weighed = G.db.where('sales_orders', o => ['WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED', 'CLOSED'].includes(o.status) && o.created_at.slice(0, 10) >= p.from && o.created_at.slice(0, 10) <= p.to && (!p.site || o.establishment_id === p.site));
      let est = 0, real = 0, notices = 0; for (const o of weighed) { for (const l of o.lines || []) if (l.price_basis === 'KG' && l.weighed_kg != null) { est += l.est_weight_kg || 0; real += l.weighed_kg; } if (['NOTICE_REQUIRED', 'NOTICE_SENT'].includes(o.weight_diff_status)) notices++; }
      body.appendChild(h('div', { class: 'grid c2' },
        card(`Pedidos de hoy por franja (${today.length})`, slots.length ? G.ui.chart.bar({ labels: slots, stacked: true, series: sts.map(([s0, n]) => ({ name: n, values: slots.map(sl => today.filter(o => (o.slot_from ? `${o.slot_from}–${o.slot_to}` : 'Sin franja') === sl && o.status === s0).length) })), format: v => G.fmt.num(v) }) : G.ui.empty('Sin pedidos por preparar hoy.')),
        card('Peso pedido frente a real', kpis([{ label: 'Kg estimados', value: G.fmt.kg(est, 1) }, { label: 'Kg reales', value: G.fmt.kg(real, 1) }, { label: 'Desviación', value: G.fmt.pct(est ? (real - est) / est * 100 : null, 2), tone: est && Math.abs((real - est) / est * 100) > 2 ? 'warn' : 'ok' }, { label: 'Pedidos con aviso de peso', value: G.fmt.num(notices), sub: G.fmt.pct(weighed.length ? notices / weighed.length * 100 : null) }]))));
    });
  }
  function s06(el) {
    dash(el, 'TAB-06', 'MARKETING', 'Inversión por plataforma, costo por lead, por pedido y por cliente nuevo, retorno, leads por anuncios de clic a WhatsApp, costo de creadores y costo de WhatsApp.', (body, p) => {
      if (!G.ads || !G.ads.results) { body.appendChild(notice('El módulo ADS no está en este build: los gráficos por plataforma no están disponibles.', 'info')); return; }
      const res = G.ads.results(Object.assign({}, p, { by: 'platform' }));
      const pl = G.ads.PLAT.map(([k, n]) => ({ n, r: res.find(x => x.key === k) || { spend: 0, collected: 0, leads: 0, orders: 0 } }));
      body.appendChild(h('div', { class: 'grid c2' },
        card('Inversión y cobrado por plataforma', G.ui.chart.bar({ labels: pl.map(x => x.n), series: [{ name: 'Inversión', values: pl.map(x => x.r.spend) }, { name: 'Cobrado atribuido', values: pl.map(x => x.r.collected) }], format: v => G.fmt.money(v) })),
        card('Retorno por plataforma', G.ui.chart.hbar({ items: pl.map(x => ({ label: x.n, value: x.r.spend ? R(x.r.collected / x.r.spend, 2) : 0, tone: x.r.spend && x.r.collected / x.r.spend < 2 ? 'bad' : '' })), format: v => G.fmt.num(v, 2) }))));
    });
  }

  function s07(el) {
    const canM = G.can('tab.kpi.manage');
    const body = G.ui.page(el, { code: 'TAB-07', title: 'Catálogo de indicadores', sub: 'Todos los indicadores registrados por los módulos con fórmula, unidad, sentido, frecuencia, dimensiones, módulo, fuente y pantalla de detalle; activar o desactivar (tab.kpi.manage).' });
    const defs = TB.defs();
    const calcState = d => !TB.hasCalc(d.code) ? 'NO' : TB.fallbackUsed[d.code] ? 'FALLBACK' : 'YES';
    body.appendChild(kpis([{ label: 'Indicadores registrados', value: G.fmt.num(defs.length) }, { label: 'Con cálculo en este build', value: G.fmt.num(defs.filter(d => TB.hasCalc(d.code)).length), sub: `${Object.keys(TB.fallbackUsed).filter(c => TB.def(c)).length} con cálculo de respaldo de TAB` }, { label: 'Activos', value: G.fmt.num(defs.filter(d => d.status === 'ACTIVE').length) }, { label: 'Con meta vigente', value: G.fmt.num(defs.filter(d => TB.targetFor(d.code)).length) }, { label: 'De módulos apagados', value: G.fmt.num(defs.filter(d => !G.modOn(d.requires_module || d.module_code)).length), sub: 'no se calculan (RN-TAB-07)' }]));
    const mods = [...new Set(defs.map(d => d.module_code))].sort();
    body.appendChild(table({ id: 'tab-07', columns: [
      { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Indicador' }, { key: 'module_code', label: 'Módulo' },
      { key: 'formula', label: 'Fórmula', render: d => h('span', { class: 'small', title: d.formula }, d.formula.length > 80 ? d.formula.slice(0, 78) + '…' : d.formula) },
      { key: 'unit', label: 'Unidad', value: d => lbl(UNITS, d.unit) }, { key: 'direction', label: 'Sentido', value: d => lbl(DIRS, d.direction) }, { key: 'frequency', label: 'Frecuencia', value: d => lbl(FREQ, d.frequency) },
      { key: 'drilldown', label: 'Detalle', mono: true }, { key: 'calc', label: 'Cálculo', value: d => calcState(d), render: d => ({ YES: badge('Sí', 'ok'), FALLBACK: badge('Respaldo TAB', 'info'), NO: badge('No', '') })[calcState(d)] },
      { key: 'req', label: 'Requiere', value: d => d.requires_module || d.module_code, render: d => G.modOn(d.requires_module || d.module_code) ? (d.requires_module || d.module_code) : badge((d.requires_module || d.module_code) + ' apagado', 'warn') },
      { key: 'status', label: 'Estado', render: d => G.ui.status(d.status) }],
      rows: defs, onRow: d => defDrawer(d), pageSize: 20,
      filters: [{ key: 'module_code', label: 'Módulo', options: mods.map(m => [m, m]) }, { key: 'calc', label: 'Cálculo', options: [['YES', 'Sí'], ['FALLBACK', 'Respaldo TAB'], ['NO', 'No']], value: d => calcState(d) }, { key: 'phase', label: 'Fase', options: [0, 1, 2, 3, 4].map(f => [String(f), 'Fase ' + f]) }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']] }],
      actions: d => canM ? [btn(d.status === 'ACTIVE' ? 'Desactivar' : 'Activar', () => { G.db.update('kpi_definitions', d.id, { status: d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }); TB.cache.clear(); toast('Indicador ' + (d.status === 'ACTIVE' ? 'activado' : 'desactivado'), 'ok'); G.refresh(); }, { sm: true })] : [] }));
  }
  function defDrawer(d) {
    drawer(d.code + ' · ' + d.name, (b, close) => {
      const v = TB.value(d.code, { period: G.date.month(G.TODAY) });
      b.appendChild(h('div', { class: 'row' }, btn('Ver detalle y tendencia', () => { close(); G.go('TAB-10', { code: d.code, period: S.period }); }, { kind: 'primary', sm: true }), d.drilldown && G.screens[d.drilldown] && d.drilldown !== 'TAB-10' ? btn('Abrir ' + d.drilldown, () => { close(); G.go(d.drilldown); }, { sm: true }) : null));
      b.appendChild(dl([['Fórmula', d.formula], ['Unidad', lbl(UNITS, d.unit)], ['Decimales', d.decimals], ['Sentido', lbl(DIRS, d.direction) + (d.direction_text ? ' · ' + d.direction_text : '')], ['Frecuencia', lbl(FREQ, d.frequency)], ['Dimensiones', (d.dimensions || []).join(', ') || '—'], ['Fuente', d.source || '—'], ['Calculador', h('span', { class: 'mono' }, d.calculator)], ['Cálculo en este build', TB.hasCalc(d.code) ? (TB.fallbackUsed[d.code] ? 'Respaldo de TAB (el módulo dueño no está en este build)' : 'Sí') : 'No: el módulo dueño aún no lo registra'], ['Pantalla de detalle', d.drilldown], ['Roles que lo ven', (d.visible_roles || []).length ? d.visible_roles.map(r => G.roleName(r)).join(', ') : 'Todos los roles con tablero'], ['Módulo requerido', (d.requires_module || d.module_code) + (G.modOn(d.requires_module || d.module_code) ? ' (encendido)' : ' (apagado: no se calcula ni se muestra)')], ['Fase', d.phase], ['Valor del mes en curso', v.hidden ? 'Oculto (RN-TAB-07)' : TB.fmt(v.value, d)], ['Estado', G.ui.status(d.status)]]));
      if (G.can('tab.kpi.manage')) b.appendChild(card('Editar', form({ id: 'tab-def', values: { status: d.status, visible_roles: (d.visible_roles || []).join(', '), drilldown: d.drilldown, decimals: d.decimals, frequency: d.frequency }, fields: [{ key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']], required: true }, { key: 'frequency', label: 'Frecuencia', type: 'select', options: FREQ, required: true }, { key: 'drilldown', label: 'Pantalla de detalle', type: 'text' }, { key: 'decimals', label: 'Decimales', type: 'number', min: 0, max: 6 }, { key: 'visible_roles', label: 'Roles que lo ven (códigos separados por coma; vacío = todos)', type: 'text', span: 2 }], submitLabel: 'Guardar', onSubmit: v => { const roles = String(v.visible_roles || '').split(',').map(x => x.trim()).filter(Boolean); const bad = roles.filter(r => !G.ROLES.find(x => x[0] === r)); if (bad.length) return { visible_roles: 'Rol desconocido: ' + bad.join(', ') }; if (v.drilldown && !G.SPEC[String(v.drilldown).split('-')[0]]) return { drilldown: 'Código de pantalla no válido' }; G.db.update('kpi_definitions', d.id, { status: v.status, frequency: v.frequency, drilldown: v.drilldown || null, decimals: Number(v.decimals) || 0, visible_roles: roles }); TB.cache.clear(); close(); toast('Indicador actualizado', 'ok'); G.refresh(); return true; } })));
    }, { code: 'TAB-07', wide: true });
  }

  function s08(el) {
    const canM = G.can('tab.target.manage');
    const body = G.ui.page(el, { code: 'TAB-08', title: 'Metas y semáforo', sub: 'Meta por indicador, marca y local con vigencia y tolerancia; una sola meta vigente por marca y local en cada fecha (RN-TAB-05). Vista previa del semáforo con el valor actual.', actions: canM ? [{ label: 'Nueva meta', kind: 'primary', icon: '+', onClick: () => targetForm() }] : [] });
    const defs = new Map(TB.defs().map(d => [d.id, d]));
    const rows = G.db.all('kpi_targets').filter(t => defs.has(t.kpi_id) && (G.ctx.brand === 'ALL' || !t.brand_id || t.brand_id === G.ctx.brand)).map(t => { const d = defs.get(t.kpi_id); const vig = t.valid_from <= G.TODAY && (!t.valid_to || t.valid_to >= G.TODAY); const v = vig ? TB.value(d.code, { brand: t.brand_id, site: t.establishment_id }) : { value: null }; return { t, d, vig, v, sem: vig ? TB.semaphore(v.value, t.target, d.direction, t.tolerance_pct) : null }; });
    const cnt = s => rows.filter(x => x.sem === s).length;
    body.appendChild(kpis([{ label: 'Metas vigentes', value: G.fmt.num(rows.filter(x => x.vig).length) }, { label: 'En verde', value: G.fmt.num(cnt('GREEN')), tone: 'ok' }, { label: 'En ámbar', value: G.fmt.num(cnt('AMBER')), tone: 'warn' }, { label: 'En rojo', value: G.fmt.num(cnt('RED')), tone: 'bad' }, { label: 'Tolerancia por defecto', value: G.fmt.pct(G.param('tab_default_tolerance_pct'), 0), sub: 'tab_default_tolerance_pct' }]));
    body.appendChild(table({ id: 'tab-08', columns: [
      { key: 'code', label: 'Indicador', value: x => x.d.code + ' · ' + x.d.name }, { key: 'brand', label: 'Marca', value: x => x.t.brand_id ? G.brandName(x.t.brand_id) : 'Todas' }, { key: 'site', label: 'Local', value: x => x.t.establishment_id ? G.siteName(x.t.establishment_id) : 'Todos' },
      { key: 'target', label: 'Meta', align: 'r', value: x => x.t.target, render: x => TB.fmt(x.t.target, x.d) }, { key: 'tol', label: 'Tolerancia', align: 'r', value: x => x.t.tolerance_pct, render: x => G.fmt.pct(x.t.tolerance_pct, 0) }, { key: 'dir', label: 'Sentido', value: x => lbl(DIRS, x.d.direction) },
      { key: 'vig', label: 'Vigencia', value: x => x.t.valid_from, render: x => h('span', null, `${G.fmt.date(x.t.valid_from)} – ${x.t.valid_to ? G.fmt.date(x.t.valid_to) : 'sin fin'} `, x.vig ? badge('vigente', 'info') : badge('vencida', '')) },
      { key: 'val', label: 'Valor del mes', align: 'r', value: x => x.v.value ?? -Infinity, render: x => x.vig ? (x.v.hidden ? 'Oculto (RN-TAB-07)' : x.v.nocalc ? 'sin cálculo' : TB.fmt(x.v.value, x.d)) : '—' }, { key: 'sem', label: 'Semáforo', value: x => x.sem || '', render: x => x.vig ? semBadge(x.sem) : '—' }],
      rows, onRow: x => G.go('TAB-10', { code: x.d.code, brand: x.t.brand_id, site: x.t.establishment_id }), filters: [{ key: 'sem', label: 'Semáforo', options: [['GREEN', 'Verde'], ['AMBER', 'Ámbar'], ['RED', 'Rojo']], value: x => x.sem || '' }, { key: 'mod', label: 'Módulo', options: [...new Set(rows.map(x => x.d.module_code))].sort().map(m => [m, m]), value: x => x.d.module_code }],
      actions: x => canM && x.vig ? [btn('Cerrar vigencia', () => { try { TB.closeTarget(x.t.id); toast('Vigencia cerrada hoy', 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { sm: true })] : [] }));
    // simulador del semáforo
    const out = h('div');
    const sim = v => { const s = TB.semaphore(Number(v.value), Number(v.target), v.direction, Number(v.tol)); G.ui.clear(out).appendChild(h('div', { class: 'row' }, h('span', null, 'Resultado: '), semBadge(s), h('span', { class: 'muted small' }, v.direction === 'LOWER_BETTER' ? `verde ≤ ${G.fmt.num(v.target, 2)}; ámbar ≤ ${G.fmt.num(v.target * (1 + v.tol / 100), 2)}` : v.direction === 'TARGET' ? `verde dentro de ±${G.fmt.num(Math.abs(v.target) * v.tol / 100, 2)}; ámbar hasta ±${G.fmt.num(Math.abs(v.target) * v.tol / 50, 2)}` : `verde ≥ ${G.fmt.num(v.target, 2)}; ámbar ≥ ${G.fmt.num(v.target * (1 - v.tol / 100), 2)}`))); };
    const f = form({ id: 'tab-sim', values: { value: 12.9, target: 12, tol: 10, direction: 'LOWER_BETTER' }, fields: [{ key: 'direction', label: 'Sentido', type: 'select', options: DIRS, required: true, onChange: (x, vals) => sim(vals) }, { key: 'target', label: 'Meta', type: 'number', onChange: (x, vals) => sim(vals) }, { key: 'tol', label: 'Tolerancia %', type: 'number', onChange: (x, vals) => sim(vals) }, { key: 'value', label: 'Valor', type: 'number', onChange: (x, vals) => sim(vals) }], submitLabel: false });
    sim(f.api.values);
    body.appendChild(card('Vista previa del semáforo (RN-TAB-04)', h('div', { class: 'stack' }, f, out)));
  }
  function targetForm(code) {
    drawer('Nueva meta', (b, close) => {
      const defs = TB.defs().filter(d => d.status === 'ACTIVE').sort(U.by('code'));
      const prev = h('div', { class: 'muted small' });
      const upd = v => { const d = TB.def(v.code); if (!d) return; const cur = TB.value(d.code, { brand: v.brand_id || null, site: v.establishment_id || null }); const s = TB.semaphore(cur.value, Number(v.target), d.direction, v.tolerance_pct === '' ? null : Number(v.tolerance_pct)); G.ui.clear(prev).append(`Valor actual (${perName(G.date.month(G.TODAY))}): ${cur.nocalc ? 'sin cálculo' : TB.fmt(cur.value, d)} · ${lbl(DIRS, d.direction)} → `, semBadge(v.target === '' || v.target == null ? null : s)); };
      const f = form({ id: 'tab-tgt', values: { code: code || 'KPI-DEL-04', valid_from: G.TODAY, tolerance_pct: G.param('tab_default_tolerance_pct') }, fields: [
        { key: 'code', label: 'Indicador', type: 'select', options: defs.map(d => [d.code, d.code + ' · ' + d.name]), required: true, span: 2, onChange: (x, vals) => upd(vals) },
        { key: 'brand_id', label: 'Marca (vacío = todas)', type: 'select', options: G.scope.brands().map(x => [x.id, x.name]), onChange: (x, vals) => upd(vals) },
        { key: 'establishment_id', label: 'Local (vacío = todos)', type: 'select', options: G.scope.sites().map(x => [x.id, x.short || x.name]), onChange: (x, vals) => upd(vals) },
        { key: 'target', label: 'Meta', type: 'number', required: true, onChange: (x, vals) => upd(vals) }, { key: 'tolerance_pct', label: 'Tolerancia %', type: 'number', min: 0, max: 100, onChange: (x, vals) => upd(vals) },
        { key: 'valid_from', label: 'Vigente desde', type: 'date', required: true }, { key: 'valid_to', label: 'Hasta (vacío = sin fin)', type: 'date' }],
        submitLabel: 'Guardar meta', onCancel: close,
        onSubmit: v => { TB.saveTarget(v); close(); toast('Meta guardada', 'ok'); G.refresh(); return true; } });
      b.appendChild(f); b.appendChild(prev); upd(f.api.values);
    }, { code: 'TAB-08' });
  }

  function s09(el) {
    const canRun = G.can('tab.snapshot.run');
    const body = G.ui.page(el, { code: 'TAB-09', title: 'Cierre de indicadores', sub: `Meses congelados con su corrida vigente; congelar un mes terminado o recalcularlo con motivo (RN-TAB-03). El congelamiento automático corre el día ${G.param('tab_snapshot_day') || 3} del mes siguiente a las 02:00 (RN-TAB-10).` });
    if (!canRun) body.appendChild(notice('Congelar o recalcular exige el permiso tab.snapshot.run (gerencia o administración).', 'info'));
    const months = MONTHS.map(p => { const runs = TB.runs(p); const ok = TB.latestRun(p); const first = runs.filter(r => r.status === 'OK').sort(U.by('finished_at'))[0]; return { p, runs, ok, days: first ? G.date.diff(String(first.finished_at).slice(0, 10), TB.range(p).last) : null, fin: TB.isFinished(p) }; });
    body.appendChild(table({ id: 'tab-09m', search: false, columns: [
      { key: 'p', label: 'Mes', value: x => x.p, render: x => perName(x.p) }, { key: 'st', label: 'Estado', value: x => x.ok ? 'Congelado' : x.fin ? 'Sin congelar' : 'En curso', render: x => x.ok ? badge('Congelado', 'ok') : x.fin ? badge('Sin congelar', 'warn') : badge('En curso (al vuelo)', 'info') },
      { key: 'run', label: 'Corrida vigente', align: 'r', value: x => x.ok ? x.ok.run_no : '' }, { key: 'at', label: 'Congelado', render: x => x.ok ? G.fmt.datetime(x.ok.finished_at) : '—' }, { key: 'n', label: 'Indicadores', align: 'r', value: x => x.ok ? x.ok.kpis_count : '' },
      { key: 'days', label: 'Días para congelar', align: 'r', value: x => x.days ?? '', render: x => x.days == null ? '—' : badge(String(x.days), x.days <= 3 ? 'ok' : 'warn') }, { key: 'reason', label: 'Motivo de la corrida vigente', value: x => x.ok ? x.ok.reason : '' }],
      rows: months, actions: x => canRun ? [x.ok ? btn('Recalcular', () => freezeForm(x.p, true), { sm: true }) : btn('Congelar', () => freezeForm(x.p, false), { sm: true, kind: 'primary' })] : [] }));
    const runs = G.db.all('kpi_snapshot_runs').sort(U.by('started_at', -1));
    body.appendChild(tabs([
      { key: 'cmp', label: 'Comparación mes a mes', render: p => compare(p) },
      { key: 'runs', label: 'Corridas', count: runs.length, render: p => p.appendChild(table({ id: 'tab-09r', columns: [{ key: 'period', label: 'Mes', render: r => G.date.monthName(r.period) }, { key: 'run_no', label: 'Corrida', align: 'r' }, { key: 'status', label: 'Estado', render: r => r.status === 'OK' ? badge('OK', 'ok') : r.status === 'FAILED' ? badge('Fallida', 'bad') : G.ui.status(r.status) }, { key: 'reason', label: 'Motivo' }, { key: 'kpis_count', label: 'Indicadores', align: 'r' }, { key: 'started_at', label: 'Inicio', render: r => G.fmt.datetime(r.started_at) }, { key: 'finished_at', label: 'Fin', render: r => G.fmt.datetime(r.finished_at) }, { key: 'user', label: 'Ejecutó' }, { key: 'error', label: 'Error', value: r => r.error || '' }], rows: runs })) },
    ]));
  }
  function freezeForm(p, recalc) {
    modal((recalc ? 'Recalcular ' : 'Congelar ') + G.date.monthName(p), b => {
      b.appendChild(notice(recalc ? `Crea la corrida ${TB.runs(p).length + 1}; la anterior se conserva (solo inserción) y el tablero pasa a usar la nueva. El motivo debe tener al menos 10 caracteres.` : 'Congela los valores del mes para todos los indicadores activos con cálculo, por empresa, marca y local.', 'info'));
      b.appendChild(form({ id: 'tab-frz', fields: [{ key: 'reason', label: 'Motivo' + (recalc ? ' (obligatorio)' : ''), type: 'textarea', required: recalc }], submitLabel: recalc ? 'Recalcular' : 'Congelar', onSubmit: v => { const r = TB.freeze(p, { reason: v.reason }); G.ui.closeAll(); toast(`${G.date.monthName(p)} congelado: corrida ${r.run_no}, ${r.kpis_count} indicadores`, 'ok'); G.refresh(); return true; } }));
    });
  }
  function compare(panel) {
    const mods = [...new Set(TB.defs().filter(d => TB.hasCalc(d.code) && TB.visible(d)).map(d => d.module_code))].sort();
    if (!mods.includes(S.module)) S.module = mods[0];
    panel.appendChild(pills(mods.map(m => [m, m]), S.module, v => { S.module = v; G.refresh(); }));
    const sc = TB.scopeOpts();
    const defs = TB.defs().filter(d => d.module_code === S.module && TB.hasCalc(d.code) && TB.visible(d));
    const rows = defs.map(d => { const vals = MONTHS.map(m => TB.value(d.code, { period: m, brand: sc.brand, site: sc.site }).value); return { d, vals }; });
    panel.appendChild(table({ id: 'tab-09c-' + S.module, search: false, pageSize: 30, columns: [{ key: 'code', label: 'Indicador', value: x => x.d.code + ' · ' + x.d.name }].concat(MONTHS.map((m, i) => ({ key: 'm' + i, label: G.date.monthName(m) + (i === MONTHS.length - 1 ? ' *' : ''), align: 'r', value: x => x.vals[i] ?? -Infinity, render: x => { const v = x.vals[i], pv = x.vals[i - 1]; if (v == null) return '—'; const up = pv != null && v > pv, dn = pv != null && v < pv; const good = x.d.direction === 'LOWER_BETTER' ? dn : up; return h('span', null, TB.fmt(v, x.d), pv != null && v !== pv ? h('span', { class: 'small ' + (good ? 'ok' : 'bad'), style: 'margin-left:4px' }, up ? '▲' : '▼') : null); } }))), rows, onRow: x => G.go('TAB-10', { code: x.d.code }) }));
    panel.appendChild(h('div', { class: 'muted small' }, '* Mes en curso calculado al vuelo. Los meses congelados se leen de la corrida vigente; si el congelamiento no guardó la marca o el local elegidos, se calcula al vuelo.'));
  }

  function s10(el, params) {
    const sc0 = TB.scopeOpts();
    const P = Object.assign({ code: 'KPI-ADS-05', period: S.period, brand: sc0.brand, site: sc0.site }, params || {});
    if (sc0.site && !P.site) P.site = sc0.site; // RN-TAB-06: el alcance del usuario no se amplía
    const visibleDefs = TB.defs().filter(d => TB.visible(d) && TB.hasCalc(d.code)).sort(U.by('code'));
    let d = TB.def(P.code); if (!d || !TB.visible(d)) d = visibleDefs[0];
    const per = G.date.month(P.period || G.TODAY);
    const body = G.ui.page(el, { code: 'TAB-10', title: 'Detalle y exportación', sub: 'Bajada al detalle de cualquier valor (por ejemplo, del costo por entrega a las rutas y costos que lo componen) con los mismos filtros, y exportación a Excel y PDF registrada en AUD.' });
    const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Indicador', id: 'tab-10-k' } }, visibleDefs.map(x => h('option', { value: x.code, selected: d && x.code === d.code }, x.code + ' · ' + x.name)));
    sel.addEventListener('change', () => G.go('TAB-10', Object.assign({}, P, { code: sel.value })));
    const perSel = pills(MONTHS.slice().reverse().map(m => [m, perName(m)]), per, v => G.go('TAB-10', Object.assign({}, P, { period: v })));
    body.appendChild(h('div', { class: 'stack', style: 'gap:8px' }, sel, perSel, h('div', { class: 'muted small' }, `Marca: ${P.brand ? G.brandName(P.brand) : 'todas'} · Local: ${P.site ? G.siteName(P.site) : 'todos'}`)));
    if (!d) { body.appendChild(G.ui.empty('No hay indicadores visibles con cálculo.')); return; }
    const v = TB.value(d.code, { period: per, brand: P.brand, site: P.site });
    const st0 = TB.status(d.code, v.value, { brand: P.brand, site: P.site, date: TB.range(per).to });
    body.appendChild(h('div', { class: 'grid side-r' },
      card(d.code + ' · ' + d.name, h('div', { class: 'stack' },
        kpis([{ label: G.date.monthName(per), value: TB.fmt(v.value, d), tone: st0.sem ? SEM[st0.sem][1] : '', sub: v.source === 'SNAPSHOT' ? `congelado · corrida ${v.run_no}` : 'al vuelo', title: d.formula }, { label: 'Meta', value: st0.target ? TB.fmt(st0.target.target, d) : '—', sub: st0.target ? `tolerancia ${G.fmt.pct(st0.target.tolerance_pct, 0)}` : 'sin meta (D-TAB-01)' }, { label: 'Semáforo', value: st0.sem ? SEM[st0.sem][0] : '—', tone: st0.sem ? SEM[st0.sem][1] : '' }]),
        dl([['Fórmula', d.formula], ['Numerador', v.numerator != null ? G.fmt.num(v.numerator, 2) : '—'], ['Denominador', v.denominator != null ? G.fmt.num(v.denominator, 2) : '—'], ['Sentido', lbl(DIRS, d.direction)], ['Fuente', d.source || d.module_code], v.frozenMissing ? ['Nota', 'El congelamiento no guardó esta marca o local: valor calculado al vuelo'] : null]))),
      card('Tendencia mensual', (() => { const vals = MONTHS.map(m => TB.value(d.code, { period: m, brand: P.brand, site: P.site }).value); return vals.some(x => x != null) ? G.ui.chart.line({ labels: MONTHS.map(m => G.date.monthName(m)), series: [{ name: d.name, values: vals.map(x => x == null ? null : R(x, 4)) }], format: x => TB.fmt(x, d), ref: st0.target ? st0.target.target : undefined }) : G.ui.empty('Sin valores'); })())));
    const { from, to } = TB.range(per);
    const dd = TB.drill(d.code, { from, to, brand: P.brand, site: P.site });
    if (dd) {
      const fmtCell = (c, r) => { const val = r[c[0]]; return c[2] === 'money' ? G.fmt.money(val) : c[2] === 'num' ? G.fmt.num(val, Number.isInteger(val) ? 0 : 2) : val; };
      const totals = (dd.sum || []).reduce((m, k) => (m[k] = R(U.sum(dd.rows, r => r[k] || 0), 4), m), {});
      const footer = dd.columns.map((c, i) => i === 0 ? 'Total' : totals[c[0]] != null ? { v: c[2] === 'money' ? G.fmt.money(totals[c[0]]) : G.fmt.num(totals[c[0]], Number.isInteger(totals[c[0]]) ? 0 : 2), align: 'r' } : (dd.ratio && c[0] === 'por_entrega' && totals[dd.ratio[1]] ? { v: G.fmt.money(totals[dd.ratio[0]] / totals[dd.ratio[1]]), align: 'r' } : ''));
      body.appendChild(card(`Detalle que compone el valor · ${dd.rows.length} filas`, table({ id: 'tab-10-' + d.code, columns: dd.columns.map(c => ({ key: c[0], label: c[1], align: c[2] ? 'r' : '', render: r => fmtCell(c, r) })), rows: dd.rows, footer, pageSize: 15 }), { actions: exportBtns(d.code + ' ' + G.date.monthName(per), () => ({ columns: dd.columns, rows: dd.rows, personal: !!dd.personal || dd.columns.some(c => /cliente/i.test(c[1])), filters: { code: d.code, period: per, brand: P.brand, site: P.site } })) }));
      if (dd.ratio && totals[dd.ratio[1]]) body.appendChild(h('div', { class: 'muted small' }, `Comprobación: ${G.fmt.money(totals[dd.ratio[0]])} / ${G.fmt.num(totals[dd.ratio[1]])} = ${G.fmt.money(totals[dd.ratio[0]] / totals[dd.ratio[1]])} (valor del indicador ${TB.fmt(v.value, d)}).`));
    } else {
      body.appendChild(card('Detalle', h('div', { class: 'stack' }, h('div', { class: 'muted small' }, 'Este indicador no publica un detalle fila por fila en este build; su pantalla de detalle es ' + (d.drilldown || '—') + '.'), d.drilldown && G.screens[d.drilldown] ? btn('Abrir ' + d.drilldown, () => G.go(d.drilldown), { sm: true }) : null), { actions: exportBtns(d.code, () => ({ columns: [['mes', 'Mes'], ['valor', 'Valor']], rows: MONTHS.map(m => ({ mes: G.date.monthName(m), valor: TB.value(d.code, { period: m, brand: P.brand, site: P.site }).value })) })) }));
    }
    const exps = G.db.where('data_exports', x => x.module_code === 'TAB').sort(U.by('created_at', -1)).slice(0, 8);
    if (exps.length) body.appendChild(card('Exportaciones recientes (AUD)', table({ id: 'tab-10-ex', search: false, columns: [{ key: 'created_at', label: 'Fecha', render: x => G.fmt.datetime(x.created_at) }, { key: 'report_code', label: 'Reporte' }, { key: 'file_format', label: 'Formato' }, { key: 'row_count', label: 'Filas', align: 'r' }, { key: 'personal', label: 'Datos personales', value: x => x.contains_personal_data ? 'Sí' : 'No' }, { key: 'status', label: 'Estado', render: x => x.status === 'READY' ? badge('Lista', 'ok') : badge('Por aprobar', 'warn') }], rows: exps }), { flush: true }));
  }

  G.register({ code: 'TAB', name: 'Tablero e indicadores', phase: 1, group: 'Control y gestión', screens: [
    { code: 'TAB-01', name: 'Tablero de gerencia', render: s01, roles: ['ADMINISTRACION', 'CONTADORA'] },
    { code: 'TAB-02', name: 'Tablero de ventas', render: s02, roles: ['SUPERVISORA_VENTAS', 'VENDEDORA', 'MARKETING', 'ADMINISTRACION', 'CAJERO'] },
    { code: 'TAB-03', name: 'Tablero de la supervisora', render: s03, roles: ['SUPERVISORA_VENTAS'] },
    { code: 'TAB-04', name: 'Tablero de delivery', render: s04, roles: ['COORDINADOR_DELIVERY', 'ADMINISTRACION'] },
    { code: 'TAB-05', name: 'Tablero de almacén y preparación', render: s05, roles: ['ALMACENERO', 'PREPARADOR', 'JEFE_PRODUCCION', 'CALIDAD'] },
    { code: 'TAB-06', name: 'Tablero de marketing', render: s06, roles: ['MARKETING'] },
    { code: 'TAB-07', name: 'Catálogo de indicadores', render: s07 },
    { code: 'TAB-08', name: 'Metas y semáforo', render: s08 },
    { code: 'TAB-09', name: 'Cierre de indicadores', render: s09 },
    { code: 'TAB-10', name: 'Detalle y exportación', render: s10 },
  ] });

  G.searchProviders.push(q => { const s = q.toUpperCase(); return TB.defs().filter(d => d.code.includes(s) || d.name.toUpperCase().includes(s)).slice(0, 5).map(d => ({ label: d.code + ' · ' + d.name, sub: 'Indicador ' + d.module_code, go: () => G.go('TAB-10', { code: d.code }) })); });
  G.scanHandlers.push(code => CODE_RE.test(code) && TB.def(code) ? () => G.go('TAB-10', { code }) : null);
  G.alertProviders.push(() => {
    if (!G.canSee('TAB')) return [];
    const prev = G.date.addMonths(G.date.month(G.TODAY), -1);
    const out = [];
    if (TB.isFinished(prev) && !TB.latestRun(prev) && G.date.diff(G.TODAY, TB.range(prev).last) > (Number(G.param('tab_snapshot_day')) || 3)) out.push({ module: 'TAB', title: `${G.date.monthName(prev)} sin congelar`, detail: 'RN-TAB-10: el congelamiento automático no corrió.', tone: 'warn', go: () => G.go('TAB-09') });
    return out;
  });

  /* ------------------------------------------------------------------
     Pruebas CA-TAB-01 a 06
     ------------------------------------------------------------------ */
  const expectRule = (fn, code, msg) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`${msg}: se esperaba ${code} y salió «${e.message}»`); } throw new Error(`${msg}: se esperaba ${code} y no falló`); };
  /** ruta del 12/09 con moto propia, 10 entregas y costos (combustible 50, jornal 80, alimentación 15, peaje 5) */
  function routeFixture({ site, code, deliveries = 10, costs = [['FUEL', 50], ['DRIVER_WAGE', 80], ['DRIVER_MEAL', 15], ['TOLL', 5]], date = '2026-09-12' }) {
    const r = G.db.insert('delivery_routes', { code, route_date: date, establishment_id: site, slot_from: '09:00', slot_to: '13:00', mode: 'OWN', vehicle_id: 've-MTA-123', status: 'SETTLED' }, { silent: true });
    for (let i = 0; i < deliveries; i++) G.db.insert('delivery_stops', { route_id: r.id, order_id: 'so-test-' + code + i, seq: i + 1, status: 'DELIVERED' }, { silent: true });
    for (const [t, a] of costs) G.db.insert('delivery_costs', { cost_date: date, cost_type: t, amount: a, route_id: r.id, vehicle_id: 've-MTA-123' }, { silent: true });
    return r;
  }
  G.tests.push({ module: 'TAB', name: 'CA-TAB-01: costo por entrega con meta S/ 12 y tolerancia 10 %: S/ 12,90 ámbar; S/ 13,50 rojo; S/ 11,00 verde', fn: async () => {
    const t = TB.targetFor('KPI-DEL-04', { date: G.TODAY }); if (!t || t.target !== 12 || t.tolerance_pct !== 10) throw new Error('La meta vigente de KPI-DEL-04 debía ser S/ 12 con 10 %');
    const d = TB.def('KPI-DEL-04');
    const s = v => TB.semaphore(v, t.target, d.direction, t.tolerance_pct);
    if (s(12.9) !== 'AMBER' || s(13.5) !== 'RED' || s(11) !== 'GREEN') throw new Error(`Semáforo: 12,90 ${s(12.9)} · 13,50 ${s(13.5)} · 11,00 ${s(11)}`);
  } });
  G.tests.push({ module: 'TAB', name: 'CA-TAB-02: error de armado 0,4 % con meta 0,5 % → verde; conversión de leads 18 % con meta 20 % → ámbar', fn: async () => {
    const a = TB.status('KPI-PRE-03', 0.4).sem, b = TB.status('KPI-CRM-04', 18).sem;
    if (a !== 'GREEN') throw new Error('Error de armado 0,4 % debía ser verde y es ' + a);
    if (b !== 'AMBER') throw new Error('Conversión 18 % debía ser ámbar y es ' + b);
  } });
  /** septiembre congelado el 03/10 en la empresa de prueba CS (sin otros datos de reparto) */
  function caseSep() {
    G.ctx.tenant = 'CS';
    const route = routeFixture({ site: 'es-CS1', code: 'SURCO-B' });
    const run1 = TB.freeze('2026-09-01', { at: '2026-10-03T02:00' });
    return { route, run1 };
  }
  G.tests.push({ module: 'TAB', name: 'CA-TAB-03: setiembre congelado con S/ 15,00; reparación de la moto y recálculo con motivo → corrida 2 con S/ 17,00; sin motivo o congelar octubre → RN-TAB-03', fn: async () => {
    const orig = G.kpiCalc['KPI-DEL-04'];
    try {
      G.kpiCalc['KPI-DEL-04'] = TB.FALLBACK['KPI-DEL-04'];
      const { route, run1 } = caseSep();
      const v1 = TB.value('KPI-DEL-04', { period: '2026-09-01' });
      if (run1.run_no !== 1 || v1.source !== 'SNAPSHOT' || Math.abs(v1.value - 15) > 0.001) throw new Error('Setiembre congelado debía mostrar S/ 15,00 (corrida 1) y muestra ' + v1.value);
      G.db.insert('delivery_costs', { cost_date: '2026-09-20', cost_type: 'MAINTENANCE_CORRECTIVE', amount: 20, route_id: route.id, vehicle_id: 've-MTA-123', notes: 'Reparación de la moto' }, { silent: true });
      if (Math.abs(TB.value('KPI-DEL-04', { period: '2026-09-01' }).value - 15) > 0.001) throw new Error('Sin recalcular, el tablero debía seguir con el valor congelado');
      expectRule(() => TB.freeze('2026-09-01', {}), 'RN-TAB-03', 'Recalcular sin motivo');
      expectRule(() => TB.freeze('2026-09-01', { reason: 'moto' }), 'RN-TAB-03', 'Motivo corto');
      const run2 = TB.freeze('2026-09-01', { reason: 'Reparación de la moto MTA-123 registrada después del cierre' });
      const v2 = TB.value('KPI-DEL-04', { period: '2026-09-01' });
      if (run2.run_no !== 2 || v2.run_no !== 2 || Math.abs(v2.value - 17) > 0.001) throw new Error('La corrida 2 debía mostrar S/ 17,00 y muestra ' + v2.value);
      if (!G.db.where('kpi_snapshots', s => s.kpi_code === 'KPI-DEL-04' && s.period === '2026-09-01' && s.run_no === 1 && s.dimension_key === 'ALL' && Math.abs(s.value - 15) < 0.001).length) throw new Error('La corrida 1 debía conservarse (solo inserción)');
      expectRule(() => TB.freeze('2026-10-01', { reason: 'Congelar octubre el 10/10' }), 'RN-TAB-03', 'Congelar octubre');
    } finally { G.kpiCalc['KPI-DEL-04'] = orig; G.ctx.tenant = 'DG'; }
  } });
  G.tests.push({ module: 'TAB', name: 'CA-TAB-04: clic en «costo por entrega S/ 17,00» de setiembre → rutas con sus costos y entregas que suman ese valor', fn: async () => {
    const orig = G.kpiCalc['KPI-DEL-04'];
    try {
      G.kpiCalc['KPI-DEL-04'] = TB.FALLBACK['KPI-DEL-04'];
      const { route } = caseSep();
      G.db.insert('delivery_costs', { cost_date: '2026-09-20', cost_type: 'MAINTENANCE_CORRECTIVE', amount: 20, route_id: route.id }, { silent: true });
      TB.freeze('2026-09-01', { reason: 'Reparación de la moto registrada tarde' });
      const v = TB.value('KPI-DEL-04', { period: '2026-09-01' });
      const dd = TB.drill('KPI-DEL-04', Object.assign(TB.range('2026-09-01'), { brand: null, site: null }));
      const cost = U.sum(dd.rows, r => r.costo), n = U.sum(dd.rows, r => r.entregas);
      if (!dd.rows.length || !dd.rows.some(r => r.ruta === 'SURCO-B')) throw new Error('El detalle debía listar la ruta SURCO-B');
      if (Math.abs(cost / n - v.value) > 0.001 || Math.abs(v.value - 17) > 0.001) throw new Error(`Las rutas suman ${cost} / ${n} = ${cost / n} y el valor es ${v.value}`);
    } finally { G.kpiCalc['KPI-DEL-04'] = orig; G.ctx.tenant = 'DG'; }
  } });
  G.tests.push({ module: 'TAB', name: 'CA-TAB-05: coordinador de delivery con alcance solo al Local 1 no ve rutas ni costos del Local 2', fn: async () => {
    const role = G.ctx.role, sess = G.ctx.session; const u = G.db.find('users', x => x.role === 'COORDINADOR_DELIVERY'); const sites = u.sites;
    try {
      routeFixture({ site: 'es-L1', code: 'T-L1-SURCO' }); routeFixture({ site: 'es-L2', code: 'T-L2-LURIN', costs: [['FUEL', 90]] });
      G.db.update('users', u.id, { sites: ['es-L1'] }, { silent: true });
      G.ctx.role = 'COORDINADOR_DELIVERY'; G.ctx.session = { user_id: u.id, role: 'COORDINADOR_DELIVERY', tenant: 'DG', name: u.name };
      const sc = TB.scopeOpts(); if (sc.site !== 'es-L1') throw new Error('El alcance debía quedar en el Local 1');
      if (!TB.dashboardCodes('DELIVERY').includes('KPI-DEL-04')) throw new Error('El tablero de delivery debía incluir el costo por entrega');
      const dd = TB.drill('KPI-DEL-04', Object.assign(TB.range('2026-09-01'), { brand: sc.brand, site: sc.site }));
      if (dd.rows.some(r => r.establishment_id !== 'es-L1')) throw new Error('Aparecen rutas de otro local');
      if (!dd.rows.some(r => r.ruta === 'T-L1-SURCO') || dd.rows.some(r => r.ruta === 'T-L2-LURIN')) throw new Error('El detalle debía tener la ruta del Local 1 y no la del Local 2');
      const rc = TB.routeCosts(Object.assign(TB.range('2026-09-01'), { site: sc.site })); if (rc.some(x => x.r.establishment_id === 'es-L2')) throw new Error('Costos del Local 2 visibles');
    } finally { G.db.update('users', u.id, { sites }, { silent: true }); G.ctx.role = role; G.ctx.session = sess; }
  } });
  G.tests.push({ module: 'TAB', name: 'CA-TAB-06: con TEL apagado la supervisora no ve indicadores KPI-TEL; al activar TEL aparecen sin cambiar nada más', fn: async () => {
    try {
      const off = TB.dashboardCodes('SUPERVISORA', 'SUPERVISORA_VENTAS');
      if (off.some(c => c.startsWith('KPI-TEL'))) throw new Error('Con TEL apagado aparecen indicadores KPI-TEL');
      if (TB.value('KPI-TEL-01', {}).hidden !== true) throw new Error('KPI-TEL-01 no debía calcularse con TEL apagado (RN-TAB-07)');
      G.setModule('TEL', true, 'prueba');
      const on = TB.dashboardCodes('SUPERVISORA', 'SUPERVISORA_VENTAS');
      if (!['KPI-TEL-01', 'KPI-TEL-02', 'KPI-TEL-06'].every(c => on.includes(c))) throw new Error('Al activar TEL debían aparecer sus indicadores');
      if (TB.value('KPI-TEL-01', {}).hidden) throw new Error('Encendido, KPI-TEL-01 debía calcularse');
    } finally { G.setModule('TEL', false, 'prueba'); }
  } });
})();
