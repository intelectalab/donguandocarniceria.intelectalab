/* =====================================================================
   Aycha · Don Guando Comercial · Prototipo funcional (Fases 0 a 4)
   Núcleo: namespace, utilidades, base de datos en memoria, contexto,
   permisos, registro de módulos/pantallas y enrutador.
   ===================================================================== */
'use strict';
const G = window.G = {
  version: 'aycha-proto-1.0',
  modules: {}, screens: {}, moduleOrder: [],
  seeds: [], alertProviders: [], searchProviders: [], tests: [],
};

/* ---------- utilidades ---------- */
G.util = {
  uid(prefix = 'x') { if (G._seeding) { G._seedc = (G._seedc || 0) + 1; return prefix + '-s' + G._seedc.toString(36); } G._uidc = (G._uidc || 0) + 1; return prefix + '-' + Date.now().toString(36).slice(-4) + G._uidc.toString(36); },
  clone(o) { return JSON.parse(JSON.stringify(o)); },
  round(n, d = 2) { const f = Math.pow(10, d); return Math.round((Number(n) + Number.EPSILON) * f) / f; },
  sum(arr, fn = x => x) { return arr.reduce((a, x) => a + (Number(fn(x)) || 0), 0); },
  groupBy(arr, fn) { const m = {}; for (const x of arr) { const k = typeof fn === 'function' ? fn(x) : x[fn]; (m[k] = m[k] || []).push(x); } return m; },
  by(key, dir = 1) { return (a, b) => (a[key] > b[key] ? dir : a[key] < b[key] ? -dir : 0); },
  pad(n, w = 4) { return String(n).padStart(w, '0'); },
  esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  // PRNG determinista (mulberry32) para datos de demo reproducibles
  rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; },
  pick(r, arr) { return arr[Math.floor(r() * arr.length)]; },
  between(r, a, b) { return a + (b - a) * r(); },
  int(r, a, b) { return Math.floor(a + (b - a + 1) * r()); },
  token(len = 22) { const c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < len; i++) s += c[Math.floor(Math.random() * c.length)]; return s; },
};

/* ---------- fechas (la demo usa una fecha fija: 10/10/2026) ---------- */
G.TODAY = '2026-10-10';
G.date = {
  today() { return G.TODAY; },
  parse(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); },
  iso(d) { return d.toISOString().slice(0, 10); },
  add(s, days) { const d = G.date.parse(s); d.setUTCDate(d.getUTCDate() + Number(days)); return G.date.iso(d); },
  diff(a, b) { return Math.round((G.date.parse(a) - G.date.parse(b)) / 86400000); }, // a - b en días
  month(s) { return String(s).slice(0, 7) + '-01'; },
  addMonths(s, n) { const d = G.date.parse(G.date.month(s)); d.setUTCMonth(d.getUTCMonth() + n); return G.date.iso(d); },
  now() { return G.TODAY + 'T' + new Date().toTimeString().slice(0, 8); },
  monthName(s) { return ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][G.date.parse(s).getUTCMonth()] + ' ' + String(s).slice(2, 4); },
};

/* ---------- formatos ---------- */
const _nf = {};
function nf(d) { return _nf[d] || (_nf[d] = new Intl.NumberFormat('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d })); }
G.fmt = {
  num(v, d = 0) { if (v === null || v === undefined || v === '' || isNaN(v)) return '—'; return nf(d).format(Number(v)); },
  money(v, d = 2) { if (v === null || v === undefined || isNaN(v)) return '—'; return 'S/ ' + nf(d).format(Number(v)); },
  pct(v, d = 1) { if (v === null || v === undefined || !isFinite(v)) return '—'; return nf(d).format(Number(v)) + ' %'; },
  kg(v, d = 1) { return v === null || v === undefined || isNaN(v) ? '—' : nf(d).format(Number(v)) + ' kg'; },
  date(s) { if (!s) return '—'; const p = String(s).slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; },
  datetime(s) { if (!s) return '—'; return G.fmt.date(s) + ' ' + String(s).slice(11, 16); },
  days(n) { return n === null || n === undefined ? '—' : `${n} ${Math.abs(n) === 1 ? 'día' : 'días'}`; },
  f(v) { return v === null || v === undefined ? '—' : nf(4).format(Number(v)); }, // coeficiente F
};

/* ---------- base de datos en memoria (multiempresa) ---------- */
const STORE_KEY = 'aycha-don-guando-proto-v1';
G.db = {
  t: {},            // tablas: nombre → array de filas
  seq: {},          // correlativos
  _dirty: false,
  ensure(name) { return this.t[name] || (this.t[name] = []); },
  // filas del tenant activo (las filas sin tenant son globales)
  all(name) { const ten = G.ctx.tenant; return this.ensure(name).filter(r => !r.tenant || r.tenant === ten); },
  raw(name) { return this.ensure(name); },
  get(name, id) { if (id === null || id === undefined) return null; const r = this.ensure(name).find(x => x.id === id); return r && (!r.tenant || r.tenant === G.ctx.tenant) ? r : null; },
  find(name, pred) { return this.all(name).find(pred) || null; },
  where(name, pred) { return this.all(name).filter(pred); },
  by(name, field, value) { return this.all(name).filter(r => r[field] === value); },
  insert(name, row, opts = {}) {
    const r = Object.assign({}, row);
    if (!r.id) r.id = G.util.uid(name.slice(0, 3));
    if (r.tenant === undefined && !opts.global) r.tenant = G.ctx.tenant;
    if (!r.created_at) r.created_at = G.date.now();
    this.ensure(name).push(r);
    if (!opts.silent) G.audit('CREAR', name, r.id, r.code || r.number || r.name || '');
    this.touch();
    return r;
  },
  update(name, id, patch, opts = {}) {
    const r = this.get(name, id);
    if (!r) throw new Error(`No existe ${name} ${id}`);
    const before = {};
    for (const k of Object.keys(patch)) before[k] = r[k];
    Object.assign(r, patch, { updated_at: G.date.now() });
    if (!opts.silent) G.audit('EDITAR', name, id, Object.keys(patch).join(', '), before, patch);
    this.touch();
    return r;
  },
  remove(name, id) { const arr = this.ensure(name); const i = arr.findIndex(x => x.id === id); if (i >= 0) { arr.splice(i, 1); G.audit('ELIMINAR', name, id, ''); this.touch(); } },
  next(key, prefix = key + '-', width = 4) { const k = G.ctx.tenant + ':' + key; this.seq[k] = (this.seq[k] || 0) + 1; this.touch(); return prefix + G.util.pad(this.seq[k], width); },
  touch() { this._dirty = true; clearTimeout(this._tm); this._tm = setTimeout(() => this.save(), 600); },
  /** foto de los datos sembrados: se guarda solo lo que cambió respecto de ella (los datos de demo pesan ~5 MB) */
  snapshot() { this.base = {}; for (const [k, rows] of Object.entries(this.t)) { const m = new Map(); for (const r of rows) m.set(r.id, JSON.stringify(r)); this.base[k] = m; } },
  diff() {
    const out = {};
    for (const [k, rows] of Object.entries(this.t)) {
      const b = (this.base || {})[k] || new Map(); const seen = new Set(); const ch = [];
      for (const r of rows) { seen.add(r.id); if (b.get(r.id) !== JSON.stringify(r)) ch.push(r); }
      const del = []; for (const id of b.keys()) if (!seen.has(id)) del.push(id);
      if (ch.length || del.length) out[k] = { rows: ch, del };
    }
    return out;
  },
  save() { try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: G.version, diff: this.diff(), seq: this.seq, ctx: Object.assign({}, G.ctx) })); } catch (e) { /* almacenamiento no disponible o lleno: la demo sigue en memoria */ } },
  load() {
    let o; try { const s = localStorage.getItem(STORE_KEY); if (!s) return false; o = JSON.parse(s); if (o.v !== G.version || !o.diff) return false; } catch (e) { return false; }
    G.runSeeds();
    for (const [k, d] of Object.entries(o.diff)) {
      const arr = this.ensure(k); const del = new Set(d.del || []);
      const idx = new Map(arr.map((r, i) => [r.id, i]));
      for (const r of d.rows) { if (idx.has(r.id)) arr[idx.get(r.id)] = r; else arr.push(r); }
      if (del.size) this.t[k] = arr.filter(r => !del.has(r.id));
    }
    this.seq = Object.assign(this.seq, o.seq || {}); if (o.ctx) Object.assign(G.ctx, o.ctx);
    return true;
  },
  reset() { try { localStorage.removeItem(STORE_KEY); } catch (e) { } this.t = {}; this.seq = {}; G.runSeeds(); G.ui.toast('Datos de demostración restablecidos', 'ok'); G.render(); },
};

/* ---------- auditoría ---------- */
G.audit = function (action, entity, id, detail, before, after) {
  if (!G._seeding) G.db.ensure('audit').push({ id: G.util.uid('aud'), tenant: G.ctx.tenant, at: G.date.now(), user: G.ctx.userName(), role: G.ctx.role, action, entity, entity_id: id, detail, before: before || null, after: after || null });
};

/* ---------- contexto ---------- */
G.ctx = {
  tenant: 'DG', role: 'GERENTE', brand: 'ALL', site: 'ALL', theme: 'system', portalCustomer: null,
  userName() {
    if (this.session && this.session.role === this.role && this.session.tenant === this.tenant) return this.session.name;
    const u = (G.db.t.users || []).find(x => x.tenant === this.tenant && x.role === this.role && x.status === 'ACTIVE');
    return u ? u.name : (G.roleName ? G.roleName(this.role) : this.role);
  },
  userId() { if (this.session && this.session.role === this.role && this.session.tenant === this.tenant) return this.session.user_id; const u = (G.db.t.users || []).find(x => x.tenant === this.tenant && x.role === this.role && x.status === 'ACTIVE'); return u ? u.id : null; },
};

/* ---------- roles (docs/02-mapa-de-modulos.md §5) ---------- */
G.ROLES = [
  ['GERENTE', 'Gerencia'], ['ADMIN_SISTEMA', 'Administrador del sistema'], ['ADMINISTRACION', 'Administración y finanzas'],
  ['SUPERVISORA_VENTAS', 'Supervisora de ventas'], ['VENDEDORA', 'Vendedora'], ['CAJERO', 'Cajero de mostrador'],
  ['ALMACENERO', 'Almacenero'], ['PREPARADOR', 'Preparador de pedidos'], ['COORDINADOR_DELIVERY', 'Coordinador de delivery'], ['REPARTIDOR', 'Repartidor'],
  ['MARKETING', 'Marketing'], ['JEFE_PRODUCCION', 'Jefe de producción'], ['OPERARIO_PRODUCCION', 'Operario de producción'], ['CALIDAD', 'Calidad'],
  ['COMPRAS', 'Compras'], ['CONTADORA', 'Contadora'], ['PRACTICANTE_CONTABLE', 'Practicante contable'], ['VISITADOR_CONSIGNACION', 'Visitador de consignación'],
  ['RRHH', 'Recursos humanos'], ['CLIENTE_B2B', 'Cliente empresarial (portal)'], ['SOPORTE_PLATAFORMA', 'Soporte de plataforma (Intelectalab)'], ['AUDITOR', 'Auditor (solo lectura)'],
];
// Acceso por módulo: letras C L E A (crear, leer, editar, aprobar/anular). '' = sin acceso. '*' en la clave = resto de módulos.
const ALL = 'CLEA';
G.ACCESS = {
  GERENTE: '*',
  ADMIN_SISTEMA: { PLT: ALL, SEG: ALL, MAE: ALL, INT: ALL, AUD: ALL, ONB: ALL, API: ALL, TEL: 'CLE', SEP: 'CLE', OPS: 'L', SUS: 'L', '*': 'L' },
  ADMINISTRACION: { PLT: 'LE', MAE: ALL, CAT: 'CLE', CLI: 'CLE', ALM: 'CLE', FAC: ALL, CAJ: ALL, GAS: ALL, COM: ALL, PRS: ALL, PER: 'CLE', CON: ALL, B2B: ALL, FLO: 'CLE', SUS: ALL, ONB: 'CLE', SEG: '', OPS: '', '*': 'L' },
  SUPERVISORA_VENTAS: { CAT: 'L', CLI: ALL, PED: ALL, POS: 'CLE', WEB: 'L', CRM: ALL, ADS: 'L', TEL: ALL, ALM: 'L', PRE: 'L', DEL: 'L', FAC: 'CL', CAJ: 'L', GAS: 'C', TAB: 'L', B2B: 'CLE', CMP: 'L', CON: 'L', PER: 'L', '*': '' },
  VENDEDORA: { CAT: 'L', CLI: 'CLE', PED: 'CLE', CRM: 'CLE', TEL: 'CL', FAC: 'L', CAJ: 'CL', B2B: 'L', TAB: 'L', DEL: 'L', PRE: 'L', WEB: 'L', CMP: 'L', '*': '' },
  CAJERO: { POS: 'CLE', PED: 'CLE', CLI: 'CLE', CAT: 'L', FAC: 'CL', CAJ: 'CLE', ALM: 'L', ETQ: 'L', TAB: 'L', '*': '' },
  ALMACENERO: { ALM: 'CLE', PRE: 'CLE', CAT: 'L', COM: 'CL', CAL: 'CL', ETQ: 'CL', GRJ: 'CL', CON: 'L', EQU: 'CL', FAC: 'CL', '*': '' },
  PREPARADOR: { PRE: 'CLE', ALM: 'L', ETQ: 'L', CAL: 'C', '*': '' },
  COORDINADOR_DELIVERY: { DEL: ALL, FLO: ALL, PRE: 'L', PED: 'LE', CLI: 'LE', GAS: 'CL', FAC: 'L', CAJ: 'L', CON: 'L', TAB: 'L', '*': '' },
  REPARTIDOR: { DEL: 'CLE', FLO: 'CL', '*': '' },
  MARKETING: { ADS: ALL, CMP: ALL, WEB: 'CLE', CRM: 'L', CAT: 'LE', PED: 'L', CLI: 'L', GAS: 'CL', TAB: 'L', '*': '' },
  JEFE_PRODUCCION: { PRO: ALL, DES: ALL, REC: ALL, EQU: ALL, CAL: 'CL', ETQ: 'CLE', GRJ: 'CL', COM: 'CL', ALM: 'L', CAT: 'L', PER: 'L', TAB: 'L', '*': '' },
  OPERARIO_PRODUCCION: { PRO: 'CL', DES: 'CL', REC: 'L', CAL: 'CL', EQU: 'CL', ETQ: 'CL', '*': '' },
  CALIDAD: { CAL: ALL, ETQ: ALL, REC: 'LE', PRO: 'L', DES: 'L', EQU: 'CLE', ALM: 'L', COM: 'L', GRJ: 'L', B2B: 'L', TAB: 'L', '*': '' },
  COMPRAS: { COM: ALL, GRJ: 'CLE', CAT: 'L', ALM: 'L', GAS: 'L', PRS: 'L', '*': '' },
  CONTADORA: { CNT: ALL, FAC: 'LA', CAJ: 'LA', GAS: 'LA', COM: 'LA', PLT: 'LE', PRS: 'L', CON: 'L', GRJ: 'L', PER: 'L', AUD: 'L', TAB: 'L', '*': '' },
  PRACTICANTE_CONTABLE: { CNT: 'CLE', GAS: 'CLE', COM: 'CL', FAC: 'L', CAJ: 'L', CON: 'L', '*': '' },
  VISITADOR_CONSIGNACION: { CON: 'CLE', CLI: 'L', CAT: 'L', '*': '' },
  RRHH: { PER: ALL, MAE: 'CLE', FLO: 'L', AUD: 'L', TAB: 'L', '*': '' },
  CLIENTE_B2B: { B2B: 'CL', '*': '' },
  SOPORTE_PLATAFORMA: { OPS: 'CLE', ONB: 'CLE', INT: 'L', API: 'L', SUS: 'L', AUD: 'L', '*': '' },
  AUDITOR: { '*': 'L' },
};
/** Módulos que el rol ve solo en algunas pantallas (el resto del módulo es de otras áreas: costos, planificación, configuración). Ajusta aquí lo que ve cada rol. */
G.SCREEN_ONLY = {
  VENDEDORA: {
    DEL: ['DEL-07', 'DEL-08', 'DEL-16', 'DEL-18', 'DEL-19'],      // dónde va su pedido, enlace de seguimiento para el cliente, no entregados
    PRE: ['PRE-03', 'PRE-11'],                // si su pedido ya se está armando, pesando o está listo
    WEB: ['WEB-04', 'WEB-08'],                // pedidos de las tiendas web y stock publicado
    CMP: ['CMP-09', 'CMP-12'],                // puntos del cliente y recompra esperada
    CAJ: ['CAJ-02', 'CAJ-03', 'CAJ-05', 'CAJ-11'], // registrar cobro, ver cobros, mensaje de pago, cuentas por cobrar
    CRM: ['CRM-01', 'CRM-02', 'CRM-03', 'CRM-04', 'CRM-05', 'CRM-09', 'CRM-10', 'CRM-15', 'CRM-16', 'CRM-17', 'CRM-18'], // sin supervisión, números, equipos, costos, alertas, reglas ni muestreo
    TAB: ['TAB-02', 'TAB-07'],                // su tablero de ventas y el catálogo de indicadores
  },
  REPARTIDOR: {
    DEL: ['DEL-04', 'DEL-05', 'DEL-06', 'DEL-17', 'DEL-18', 'DEL-21'], // solo su app: rutas, parada, gastos, ticket, mensajes y liquidación
    FLO: ['FLO-15'],                          // jornada y odómetro
  },
};
G.PERMS = {}; // permisos especiales por rol: se arman desde G.SPEC (tablas «Permisos especiales» de cada módulo) en 03-services.js
G.access = function (mod, role = G.ctx.role) {
  const a = G.ACCESS[role];
  if (a === '*') return ALL;
  if (!a) return '';
  return a[mod] !== undefined ? a[mod] : (a['*'] || '');
};
G.canSee = mod => G.access(mod).includes('L') || G.access(mod).includes('C');
G.canDo = (mod, letter) => G.access(mod).includes(letter);
G.can = function (perm, role = G.ctx.role) { if (role === 'GERENTE') return true; const p = G.PERMS[role]; return p === '*' || (Array.isArray(p) && p.includes(perm)); };
// Ejecuta fn solo si el rol tiene el permiso; si no, avisa con el motivo
G.require = function (perm, fn) { if (G.can(perm)) return fn(); G.ui.toast(`Tu rol (${G.roleName()}) no tiene el permiso ${perm}. Cambia de usuario arriba a la derecha para probarlo.`, 'warn'); return false; };
G.roleName = (r = G.ctx.role) => (G.ROLES.find(x => x[0] === r) || [r, r])[1];
/** Pantalla visible para el rol: el módulo debe verse y, si la pantalla declara roles, el rol debe estar en la lista (GERENTE y AUDITOR siempre la ven). */
G.screenVisible = function (sc, role = G.ctx.role) {
  if (!sc) return false;
  if (!G.canSee(sc.module)) return false;
  const only = (G.SCREEN_ONLY[role] || {})[sc.module]; if (only && !only.includes(sc.code)) return false;
  if (role === 'CLIENTE_B2B') return !!(sc.roles && sc.roles.includes('CLIENTE_B2B'));
  if (sc.roles && !['GERENTE', 'AUDITOR'].includes(role) && !sc.roles.includes(role)) return false;
  return true;
};

/* ---------- registro de módulos y pantallas ---------- */
/**
 * G.register({ code:'ALO', name:'Jaulas, pozas y corrales', phase:1, group:'Operación', icon:'▦',
 *   screens:[{ code:'ALO-02', name:'Mapa del galpón', render(el, p){…} }, …] })
 */
G.register = function (mod) {
  if (G.modules[mod.code]) throw new Error('Módulo duplicado ' + mod.code);
  G.modules[mod.code] = mod;
  G.moduleOrder.push(mod.code);
  for (const s of mod.screens) {
    if (G.screens[s.code]) throw new Error('Pantalla duplicada ' + s.code);
    s.module = mod.code; // el menú lateral consulta mod.screens y necesita el módulo en cada pantalla
    G.screens[s.code] = Object.assign({ module: mod.code }, s);
  }
};
G.seed = function (order, fn, name) { G.seeds.push({ order, fn, name: name || 'seed' + order }); };
G.runSeeds = function () {
  G._seeding = true; G._seedc = 0; G.db.t = {}; G.db.seq = {};
  const prevTenant = G.ctx.tenant;
  try {
    for (const s of G.seeds.sort((a, b) => a.order - b.order)) {
      G.ctx.tenant = 'DG';
      try { s.fn(); } catch (e) { console.error('Error en seed ' + s.name, e); }
    }
  } finally { G.ctx.tenant = prevTenant; G._seeding = false; }
  G.db.snapshot();
};

/* ---------- enrutador ---------- */
G.nav = { current: 'HOME', params: {}, history: [] };
G.go = function (code, params = {}) {
  if (code !== 'HOME' && !G.screens[code]) { G.ui.toast('Pantalla no encontrada: ' + code, 'bad'); return; }
  if (code !== 'HOME') {
    const mod = G.screens[code].module;
    if (!G.screenVisible(G.screens[code])) { G.ui.toast(`Tu rol (${G.roleName()}) no tiene acceso a ${G.modules[mod].name} · ${G.screens[code].name}.`, 'warn'); return; }
  }
  if (G.nav.current !== code || JSON.stringify(G.nav.params) !== JSON.stringify(params)) G.nav.history.push({ code: G.nav.current, params: G.nav.params });
  G.nav.current = code; G.nav.params = params;
  if (code !== 'HOME') G.shell.expanded[G.screens[code].module] = true;
  try { if (/^[A-Za-z0-9._~-]+$/.test(code) && location.hash !== '#' + code) history.replaceState(null, '', '#' + code); } catch (e) { }
  G.ui.closeAll();
  document.getElementById('app')?.classList.remove('nav-open');
  G.render();
  const main = document.querySelector('.main'); if (main) main.scrollTop = 0;
};
G.back = function () { const h = G.nav.history.pop(); if (h) { G.nav.current = h.code; G.nav.params = h.params; G.render(); } };
G.refresh = function () { G.renderMain(); G.shell.updateBadges(); };
