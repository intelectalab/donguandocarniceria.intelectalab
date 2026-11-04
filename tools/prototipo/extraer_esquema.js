// Extrae del prototipo el perfil de sus tablas (schema-prototipo.json) y los datos semilla
// (apps/api/database/seeders/data/prototipo.json).
//
// Uso: abrir aycha-proto/dist/aycha-don-guando.html en el navegador (servido con charset UTF-8,
// ver docs/base-de-datos.md), abrir la consola (F12), pegar este archivo y ejecutar:
//   descargar('schema-prototipo.json', perfilDeTablas())
//   descargar('prototipo.json', semillas('tenants,companies,brands,…'))   (lista de tablas de la base)
// Los archivos bajan a la carpeta de descargas. El esquema va a tools/prototipo/; las semillas se
// comprimen y van a apps/api/database/seeders/data/prototipo.json.gz:
//   python -c "import gzip,shutil;shutil.copyfileobj(open('prototipo.json','rb'),gzip.open('prototipo.json.gz','wb',9))"

function sembrarDeCero() {
  try { localStorage.clear(); } catch (e) { }
  G.db.t = {}; G.db.seq = {}; G.ctx.tenant = 'DG'; G.runSeeds();
}

function perfilDeTablas() {
  sembrarDeCero();
  const names = Object.keys(G.db.t);
  const idx = new Map();
  for (const n of names) for (const r of (G.db.raw(n) || [])) if (r.id != null && !idx.has(r.id)) idx.set(r.id, n);
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s), isDT = s => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s);
  function prof(rows) {
    const cols = {};
    for (const r of rows) for (const [k, v] of Object.entries(r)) {
      const c = cols[k] || (cols[k] = { n: 0, nul: 0, t: {}, refs: {}, max: 0, ex: null, sub: null, vals: new Set(), intOnly: true, maxDec: 0 });
      c.n++;
      if (v == null || v === '') { c.nul++; continue; }
      let t = typeof v;
      if (t === 'number') {
        if (!Number.isInteger(v)) { c.intOnly = false; c.maxDec = Math.max(c.maxDec, (String(v).split('.')[1] || '').length); }
        c.max = Math.max(c.max, Math.abs(v));
      }
      if (t === 'string') {
        c.max = Math.max(c.max, v.length);
        if (isDT(v)) t = 'datetime'; else if (isDate(v)) t = 'date';
        if (idx.has(v)) c.refs[idx.get(v)] = (c.refs[idx.get(v)] || 0) + 1;
        if (c.vals.size < 15) c.vals.add(v);
      }
      if (Array.isArray(v)) {
        if (v.length && typeof v[0] === 'object' && v[0]) { t = 'arrobj'; c.sub = c.sub || []; if (c.sub.length < 400) c.sub.push(...v.slice(0, 5)); }
        else { t = 'arr'; if (v.length && idx.has(v[0])) c.refs[idx.get(v[0])] = (c.refs[idx.get(v[0])] || 0) + 1; }
      } else if (t === 'object') t = 'obj';
      c.t[t] = (c.t[t] || 0) + 1;
      if (c.ex == null) c.ex = typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : v;
    }
    const out = {};
    for (const [k, c] of Object.entries(cols)) {
      out[k] = { n: c.n, nul: c.nul, t: c.t, refs: c.refs, max: c.max, intOnly: c.intOnly, maxDec: c.maxDec, ex: c.ex, vals: c.vals.size < 15 ? [...c.vals] : null };
      if (c.sub) out[k].sub = prof(c.sub);
    }
    return out;
  }
  const tables = {};
  for (const n of names) { const rows = G.db.raw(n) || []; tables[n] = { rows: rows.length, tenants: [...new Set(rows.map(r => r.tenant))], cols: prof(rows) }; }
  const params = Object.entries(G.PARAM_DEFS || {}).map(([k, v]) => ({ key: k, module: v.module, default: v.default, desc: v.desc }));
  return { tables, params, roles: Object.keys(G.ACCESS) };
}

// tablas: las que existen en la base, separadas por coma. Se obtienen con:
//   SELECT string_agg(tablename, ',') FROM pg_tables WHERE schemaname = 'public'
// (las del framework, las hijas —líneas y aplicaciones— y role_module_access se ignoran solas).
function semillas(tablas) {
  sembrarDeCero();
  const T = ['DG', 'CS'];
  const globales = ['platform_modules', 'parameter_definitions', 'sunat_catalog_items', 'ubigeo', 'financial_institutions'];
  const out = { globales: {}, tenants: {} };
  for (const t of globales) out.globales[t] = G.db.raw(t);
  for (const t of String(tablas).split(',').map(x => x.trim()).filter(Boolean)) {
    const rows = G.db.raw(t);
    if (!rows || globales.includes(t)) continue;
    out.tenants[t] = rows.filter(r => t === 'tenants' ? T.includes(r.id) : t === 'tenant_hostnames' ? T.includes(r.tenant_ref) : T.includes(r.tenant));
  }
  out.access = G.ACCESS;
  out.modules = Object.values(G.modules).map(m => ({ code: m.code, name: m.name, phase: m.phase, group: m.group,
    screens: (m.screens || []).filter(s => !s.hidden).map(s => ({ code: s.code, name: s.name, roles: s.roles || null })) }));
  return out;
}

function descargar(nombre, datos) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(datos)], { type: 'application/json' }));
  a.download = nombre;
  a.click();
}
