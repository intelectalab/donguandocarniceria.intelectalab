/* =====================================================================
   Componentes de interfaz reutilizables (G.ui)
   ===================================================================== */
G.ui = {};
const U = G.ui;

/** h('div', {class, style, on:{click}, attrs:{}, html, title, ...props}, ...children) */
U.h = function (tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'style') el.setAttribute('style', v);
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'attrs') for (const [a, av] of Object.entries(v)) { if (av !== undefined && av !== null && av !== false) el.setAttribute(a, av === true ? '' : av); }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  U.append(el, children);
  return el;
};
U.append = function (el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
};
const h = U.h;
U.clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
U.text = (s, cls) => h('span', { class: cls }, s);
U.mono = s => h('span', { class: 'mono' }, s ?? '—');

/* ---------- botones ---------- */
U.btn = function (label, onClick, opts = {}) {
  return h('button', { class: 'btn ' + (opts.kind || '') + (opts.sm ? ' sm' : ''), type: opts.type || 'button', title: opts.title, disabled: opts.disabled, on: { click: e => { e.stopPropagation(); onClick && onClick(e); } }, attrs: { id: opts.id } }, opts.icon ? h('span', { 'aria-hidden': 'true' }, opts.icon) : null, label);
};

/* ---------- estados ---------- */
const TONES = {
  ACTIVE: 'ok', ACTIVO: 'ok', AVAILABLE: 'ok', RELEASED: 'ok', APPROVED: 'ok', POSTED: 'ok', PAID: 'ok', DONE: 'ok', CLOSED: '', VALID: 'ok', WON: 'ok', OK: 'ok', ACCEPTED: 'ok', OPTIMAL: 'ok', LISTED: 'ok', CONVERTED: 'ok', DELIVERED: 'ok', DISPATCHED: 'ok', INVOICED: 'ok', HARVESTED: 'ok', PRESENT: 'ok', BORN: 'ok', PALPATED_POS: 'ok', QUALIFIED: 'ok', RESOLVED: 'ok', SENT: 'info', CONFIRMED: 'info',
  OCCUPIED: 'info', OPEN: 'info', IN_PROGRESS: 'info', PLANNED: 'info', RELEASED_WITH_NOTE: 'warn', SERVED: 'info', IN_REVIEW: 'warn', DRAFT: '', PENDING: 'warn', SUBMITTED: 'info', FASTING: 'info', IN_PROCESS: 'info', PRECOMPOSTING: 'warn', NEW: 'info', CONTACTED: 'info', NURTURING: 'warn', RESERVED: 'warn', ISSUED: 'info', PARTIAL: 'warn', IN_TRANSIT: 'info', ON_LOAN: 'info',
  CLEANING: 'warn', REPAIR: 'warn', QUARANTINE: 'warn', REPORTED: 'warn', IN_REPAIR: 'warn', RESTING: 'warn', OBSERVED: 'warn', LOCKED: 'bad', EXPIRED: 'bad', OUT_OF_SERVICE: 'bad', MISSING: 'bad', BLOCKED: 'bad',
  IN_PREPARATION: 'info', WEIGHED: 'info', READY: 'ok', IN_ROUTE: 'info', NOT_DELIVERED: 'bad', SCHEDULED: 'info', PICKING: 'info', PACKED: 'info', LOADED: 'info', RETRY: 'warn', NOTICE_REQUIRED: 'warn', PENDING_APPROVAL: 'warn', SUSPENDED: 'bad', TRIAL: 'info', PAST_DUE: 'bad', SETTLED: 'ok', MATCHED: 'ok', DIFFERENCE: 'warn', REVERSED: 'bad', ONLINE: 'ok', OFFLINE: '', BUSY: 'warn', AWAY: 'warn', ESCALATED: 'bad', SEPARATED: '', COMPLETED: 'ok', RUNNING: 'info', ON: 'ok', OFF: '',
  RETIRED: '', VOIDED: 'bad', REJECTED: 'bad', DEAD: 'bad', SOLD: '', CULLED: '', FAILED: 'bad', PALPATED_NEG: 'bad', LOST: 'bad', REVOKED: 'bad', RECALLED: 'bad', INFEASIBLE: 'bad', REPLACED: '', INACTIVE: '', DISCARDED: '', CANCELLED: '', EMPTY: '', ABSENT: 'bad', LEAVE: 'warn', REST: '', NOT_APPLICABLE: '',
};
const LABELS = {
  ACTIVE: 'Activo', AVAILABLE: 'Disponible', OCCUPIED: 'Ocupada', CLEANING: 'Limpieza', REPAIR: 'En reparación', RETIRED: 'De baja', QUARANTINE: 'Cuarentena', RELEASED: 'Liberado', REJECTED: 'Rechazado', RECALLED: 'Retirado',
  DRAFT: 'Borrador', APPROVED: 'Aprobado', POSTED: 'Registrado', VOIDED: 'Anulado', OPEN: 'Abierto', CLOSED: 'Cerrado', PENDING: 'Pendiente', DONE: 'Hecho', PLANNED: 'Planificada', IN_PROGRESS: 'En proceso', ISSUED: 'Emitido', PAID: 'Pagado', PARTIAL: 'Parcial',
  SERVED: 'Servida', PALPATED_POS: 'Palpada +', PALPATED_NEG: 'Palpada −', BORN: 'Parida', FAILED: 'Fallida', SOLD: 'Vendido', DEAD: 'Muerto', CULLED: 'Descartado', TRANSFERRED: 'Transferido', RESTING: 'En descanso',
  VALID: 'Válido', REVOKED: 'Revocado', REPLACED: 'Reemplazado', WON: 'Ganada', LOST: 'Perdida', NEW: 'Nuevo', CONTACTED: 'Contactado', NURTURING: 'En seguimiento', QUALIFIED: 'Prospecto', CONVERTED: 'Convertido', DISCARDED: 'Descartado',
  ACCEPTED: 'Aceptado', SENT: 'Enviado', OBSERVED: 'Observado', NOT_APPLICABLE: 'No aplica', ON_LOAN: 'Prestado', OUT_OF_SERVICE: 'Fuera de servicio', MISSING: 'Extraviado', IN_REPAIR: 'En reparación', REPORTED: 'Reportado',
  CONFIRMED: 'Confirmado', DISPATCHED: 'Despachado', INVOICED: 'Facturado', IN_TRANSIT: 'En tránsito', SUBMITTED: 'Enviado', RETURNED: 'Devuelto', INACTIVE: 'Inactivo', LISTED: 'En venta', RESERVED: 'Reservado', EXPIRED: 'Vencido', CANCELLED: 'Cancelado',
  OPTIMAL: 'Óptima', INFEASIBLE: 'Infactible', IN_REVIEW: 'En revisión', HARVESTED: 'Cosechado', PRECOMPOSTING: 'Precompostaje', EMPTY: 'Vacío', FASTING: 'Ayuno', IN_PROCESS: 'En proceso', RELEASED_WITH_NOTE: 'Liberado c/obs.',
  IN_PREPARATION: 'En preparación', WEIGHED: 'Pesado', READY: 'Listo', IN_ROUTE: 'En ruta', NOT_DELIVERED: 'No entregado', SCHEDULED: 'Programado', PICKING: 'Armando', PACKED: 'Embolsado', LOADED: 'Cargado', RETRY: 'Reintento', NOTICE_REQUIRED: 'Aviso requerido', PENDING_APPROVAL: 'Por aprobar', SUSPENDED: 'Suspendido', TRIAL: 'Prueba', PAST_DUE: 'Vencido', SETTLED: 'Liquidado', MATCHED: 'Conciliado', DIFFERENCE: 'Diferencia', REVERSED: 'Revertido', ONLINE: 'En línea', OFFLINE: 'Desconectado', BUSY: 'Ocupada', AWAY: 'Ausente', ESCALATED: 'Escalado', SEPARATED: 'Separada', COMPLETED: 'Completado', RUNNING: 'En curso', ON: 'Encendido', OFF: 'Apagado', CLOSING: 'En cierre', FROZEN: 'Congelado', CHILLED: 'Refrigerado', AMBIENT: 'Ambiente',
  PRESENT: 'Presente', ABSENT: 'Falta', LEAVE: 'Permiso', REST: 'Descanso', LOCKED: 'Bloqueado', BLOCKED: 'Bloqueado', RESOLVED: 'Resuelto', DELIVERED: 'Entregado',
};
U.statusLabel = s => LABELS[s] || s;
U.badge = (text, tone = '') => h('span', { class: 'badge ' + tone }, text);
U.status = s => U.badge(U.statusLabel(s), TONES[s] ?? '');

/* ---------- página ---------- */
/** U.page(el, {code, title, sub, actions:[node|{label,onClick,kind,icon}]}) → contenedor de contenido */
U.page = function (el, o) {
  const mod = o.code && G.screens[o.code] ? G.modules[G.screens[o.code].module] : null;
  const crumbs = h('div', { class: 'crumbs' },
    mod ? [h('span', null, 'Fase ' + mod.phase), '›', h('span', null, mod.name)] : null,
    o.code ? h('span', { class: 'code' }, o.code) : null);
  const acts = h('div', { class: 'page-actions' }, (o.actions || []).map(a => a instanceof Node ? a : U.btn(a.label, a.onClick, a)));
  const head = h('div', { class: 'page-head' }, h('div', { style: 'min-width:0' }, crumbs, h('h1', null, o.title), o.sub ? h('p', { class: 'sub' }, o.sub) : null), acts);
  const body = h('div', { class: 'stack', style: 'gap:18px' });
  const page = h('div', { class: 'page' }, head, body);
  U.clear(el).appendChild(page);
  return body;
};
U.card = function (title, body, opts = {}) {
  return h('section', { class: 'card ' + (opts.class || '') },
    title || opts.actions ? h('div', { class: 'card-head' }, h('h3', null, title), opts.actions ? h('div', { class: 'row' }, opts.actions) : null) : null,
    h('div', { class: 'card-body' + (opts.flush ? ' flush' : '') }, body));
};
U.kpis = function (list) {
  return h('div', { class: 'kpis' }, list.map(k => h('div', { class: 'kpi ' + (k.tone || ''), attrs: { 'data-click': k.onClick ? '1' : null, role: k.onClick ? 'button' : null, tabindex: k.onClick ? '0' : null }, title: k.title, on: k.onClick ? { click: k.onClick } : null },
    h('span', { class: 'lbl' }, k.label), h('span', { class: 'val' }, k.value), k.sub ? h('span', { class: 'sub' }, k.sub) : null)));
};
U.notice = (content, tone = 'info') => h('div', { class: 'notice ' + tone }, h('div', { style: 'min-width:0' }, content));
U.empty = (msg = 'Sin registros.') => h('div', { class: 'empty' }, msg);
U.dl = pairs => h('dl', { class: 'dl' }, pairs.filter(Boolean).map(([k, v]) => [h('dt', null, k), h('dd', null, v instanceof Node ? v : (v === null || v === undefined || v === '' ? '—' : String(v)))]));
U.progress = (pct, tone = '') => h('div', { class: 'progress ' + tone }, h('i', { style: { width: Math.max(0, Math.min(100, pct)) + '%' } }));

/* ---------- pestañas ---------- */
U.tabs = function (tabs, opts = {}) {
  const key = opts.key || ('tabs:' + G.nav.current);
  U._tabState = U._tabState || {};
  let active = U._tabState[key] || opts.active || tabs[0].key;
  if (!tabs.find(t => t.key === active)) active = tabs[0].key;
  const wrap = h('div');
  const bar = h('div', { class: 'tabs', attrs: { role: 'tablist' } });
  const panel = h('div', { class: 'tab-panel' });
  function show(k) {
    active = k; U._tabState[key] = k;
    for (const b of bar.children) b.classList.toggle('active', b.dataset.k === k);
    U.clear(panel);
    const t = tabs.find(x => x.key === k);
    const r = t.render(panel);
    if (r instanceof Node) panel.appendChild(r);
  }
  for (const t of tabs) bar.appendChild(h('button', { class: 'tab', dataset: { k: t.key }, attrs: { role: 'tab' }, on: { click: () => show(t.key) } }, t.label, t.count !== undefined ? h('span', { class: 'badge', style: 'margin-left:6px' }, t.count) : null));
  wrap.append(bar, panel); show(active);
  return wrap;
};
U.pills = function (options, value, onChange) {
  return h('div', { class: 'pill-tabs' }, options.map(([v, l]) => h('button', { class: v === value ? 'active' : '', on: { click: () => onChange(v) } }, l)));
};

/* ---------- tabla ---------- */
/**
 * U.table({ columns:[{key,label,render(row),align:'r'|'c',mono,sort:true,width,value(row)}], rows,
 *   onRow(row), search:true, filters:[{key,label,options:[[v,l]], value(row)}], pageSize:25,
 *   actions:(row)=>[nodes], footer:[cells], empty, id, toolbar:[nodes] })
 */
U.table = function (o) {
  const id = o.id || ('tbl:' + G.nav.current + ':' + (o.columns.map(c => c.key).join(',')));
  U._tblState = U._tblState || {};
  const st = U._tblState[id] = U._tblState[id] || { q: '', sort: o.sort || null, dir: o.dir || 1, page: 0, f: {} };
  const wrap = h('div', { class: 'tbl-box' });
  const pageSize = o.pageSize || 25;
  function val(c, r) { return c.value ? c.value(r) : r[c.key]; }
  function draw() {
    U.clear(wrap);
    let rows = o.rows.slice();
    if (st.q) {
      const q = st.q.toLowerCase();
      rows = rows.filter(r => o.columns.some(c => { const v = val(c, r); return v !== null && v !== undefined && String(v).toLowerCase().includes(q); }) || (o.searchText && o.searchText(r).toLowerCase().includes(q)));
    }
    for (const f of o.filters || []) { const fv = st.f[f.key]; if (fv) rows = rows.filter(r => String(f.value ? f.value(r) : r[f.key]) === fv); }
    if (st.sort) { const c = o.columns.find(x => x.key === st.sort); if (c) rows.sort((a, b) => { const va = val(c, a), vb = val(c, b); return (va > vb ? 1 : va < vb ? -1 : 0) * st.dir; }); }
    const total = rows.length; const pages = Math.max(1, Math.ceil(total / pageSize)); if (st.page >= pages) st.page = pages - 1;
    const shown = rows.slice(st.page * pageSize, st.page * pageSize + pageSize);
    if (o.search !== false || (o.filters && o.filters.length) || o.toolbar) {
      const tools = h('div', { class: 'tbl-tools' });
      if (o.search !== false) { const inp = h('input', { class: 'input search', placeholder: o.searchPlaceholder || 'Buscar…', value: st.q, attrs: { 'aria-label': 'Buscar', id: id + ':q' } }); inp.addEventListener('input', () => { st.q = inp.value; st.page = 0; const pos = inp.selectionStart; draw(); const n = wrap.querySelector('.search'); n.focus(); n.setSelectionRange(pos, pos); }); tools.appendChild(inp); }
      for (const f of o.filters || []) {
        const sel = h('select', { class: 'input', attrs: { 'aria-label': f.label, id: id + ':f:' + f.key } }, h('option', { value: '' }, f.label + ': todos'), f.options.map(([v, l]) => h('option', { value: v, selected: st.f[f.key] === String(v) }, l)));
        sel.addEventListener('change', () => { st.f[f.key] = sel.value; st.page = 0; draw(); });
        tools.appendChild(sel);
      }
      if (o.toolbar) U.append(tools, o.toolbar);
      wrap.appendChild(tools);
    }
    const table = h('table', { class: 'tbl' });
    const trh = h('tr', null, o.columns.map(c => {
      const th = h('th', { class: (c.align || '') + (c.sort !== false ? ' sortable' : ''), style: c.width ? { width: c.width } : null }, c.label, st.sort === c.key ? h('span', { class: 'arr' }, st.dir > 0 ? ' ▲' : ' ▼') : null);
      if (c.sort !== false) th.addEventListener('click', () => { if (st.sort === c.key) st.dir = -st.dir; else { st.sort = c.key; st.dir = 1; } draw(); });
      return th;
    }), o.actions ? h('th', { class: 'r' }, '') : null);
    table.appendChild(h('thead', null, trh));
    const tb = h('tbody');
    if (!shown.length) tb.appendChild(h('tr', null, h('td', { attrs: { colspan: o.columns.length + (o.actions ? 1 : 0) } }, U.empty(o.empty || 'No hay registros con estos filtros.'))));
    for (const r of shown) {
      const tr = h('tr', { class: o.onRow ? 'click' : '', on: o.onRow ? { click: () => o.onRow(r) } : null },
        o.columns.map(c => { const v = c.render ? c.render(r) : val(c, r); return h('td', { class: (c.align || '') + (c.mono ? ' mono' : '') }, v instanceof Node ? v : (v === null || v === undefined || v === '' ? '—' : String(v))); }),
        o.actions ? h('td', { class: 'r' }, h('div', { class: 'row-actions' }, o.actions(r))) : null);
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    if (o.footer) table.appendChild(h('tfoot', null, h('tr', null, o.footer.map(f => h('td', { class: f && f.align || '' }, f && f.v !== undefined ? f.v : f)), o.actions ? h('td') : null)));
    wrap.appendChild(h('div', { class: 'tbl-wrap' }, table));
    const foot = h('div', { class: 'tbl-foot' }, h('span', null, `${G.fmt.num(total)} registro${total === 1 ? '' : 's'}`));
    if (pages > 1) foot.appendChild(h('div', { class: 'row' }, U.btn('‹', () => { st.page = Math.max(0, st.page - 1); draw(); }, { sm: true, disabled: st.page === 0 }), h('span', null, `Página ${st.page + 1} de ${pages}`), U.btn('›', () => { st.page = Math.min(pages - 1, st.page + 1); draw(); }, { sm: true, disabled: st.page >= pages - 1 })));
    wrap.appendChild(foot);
  }
  draw();
  return h('div', { class: 'card' }, wrap);
};

/* ---------- formulario ---------- */
/**
 * U.form({ fields:[{key,label,type:'text'|'number'|'date'|'datetime'|'select'|'textarea'|'checkbox'|'readonly'|'money',
 *   options:[[v,l]] | ()=>[[v,l]], required, min, max, step, help, span:2, placeholder, disabled, onChange(v, vals, form)}],
 *   values, submitLabel, onSubmit(values) → true|string (error)|{field:msg}, onCancel, extraActions:[nodes] })
 */
U.form = function (o) {
  const vals = Object.assign({}, o.values || {});
  const form = h('form', { attrs: { novalidate: true } });
  const grid = h('div', { class: 'form-grid' });
  const errs = {};
  const inputs = {};
  for (const f of o.fields) {
    if (f.hidden) continue;
    const fid = 'f-' + (o.id || 'form') + '-' + f.key;
    let input;
    const type = f.type || 'text';
    if (type === 'select') {
      const opts = typeof f.options === 'function' ? f.options(vals) : f.options;
      input = h('select', { class: 'input', id: fid, disabled: f.disabled }, f.required ? null : h('option', { value: '' }, '—'), (opts || []).map(([v, l]) => h('option', { value: v, selected: String(vals[f.key] ?? '') === String(v) }, l)));
      if (f.required && (vals[f.key] === undefined || vals[f.key] === '') && opts && opts.length) vals[f.key] = opts[0][0];
    } else if (type === 'textarea') input = h('textarea', { class: 'input', id: fid, placeholder: f.placeholder, disabled: f.disabled }, vals[f.key] ?? '');
    else if (type === 'checkbox') input = h('input', { type: 'checkbox', id: fid, checked: !!vals[f.key], disabled: f.disabled });
    else if (type === 'readonly') input = h('input', { class: 'input', id: fid, value: vals[f.key] ?? '', readOnly: true });
    else input = h('input', { class: 'input', id: fid, type: type === 'money' ? 'number' : type === 'datetime' ? 'datetime-local' : type, value: vals[f.key] ?? '', placeholder: f.placeholder, disabled: f.disabled, attrs: { min: f.min, max: f.max, step: f.step || (type === 'money' ? '0.01' : type === 'number' ? 'any' : null) } });
    inputs[f.key] = input;
    const read = () => { let v = type === 'checkbox' ? input.checked : input.value; if ((type === 'number' || type === 'money') && v !== '') v = Number(v); vals[f.key] = v; if (f.onChange) f.onChange(v, vals, api); };
    input.addEventListener(type === 'select' || type === 'checkbox' ? 'change' : 'input', read);
    const err = h('div', { class: 'err' }); errs[f.key] = err;
    const wrap = type === 'checkbox'
      ? h('div', { class: 'field' + (f.span === 2 ? ' span2' : '') }, h('label', { class: 'check', attrs: { for: fid } }, input, h('span', null, f.label)), f.help ? h('div', { class: 'help' }, f.help) : null, err)
      : h('div', { class: 'field' + (f.span === 2 || type === 'textarea' ? ' span2' : '') }, h('label', { attrs: { for: fid } }, f.label, f.required ? ' *' : ''), input, f.help ? h('div', { class: 'help' }, f.help) : null, err);
    grid.appendChild(wrap);
  }
  const general = h('div', { class: 'err', style: 'margin-top:8px' });
  form.append(grid, general);
  const api = {
    values: vals, inputs,
    set(k, v) { vals[k] = v; const i = inputs[k]; if (i) { if (i.type === 'checkbox') i.checked = !!v; else i.value = v ?? ''; } },
  };
  form.addEventListener('submit', e => {
    e.preventDefault();
    for (const e2 of Object.values(errs)) e2.textContent = ''; general.textContent = '';
    let bad = false;
    for (const f of o.fields) if (f.required && !f.hidden && (vals[f.key] === undefined || vals[f.key] === '' || vals[f.key] === null)) { errs[f.key].textContent = 'Este dato es obligatorio.'; bad = true; }
    for (const f of o.fields) if ((f.type === 'number' || f.type === 'money') && vals[f.key] !== '' && vals[f.key] !== undefined) { if (f.min !== undefined && vals[f.key] < f.min) { errs[f.key].textContent = `Debe ser ≥ ${f.min}.`; bad = true; } if (f.max !== undefined && vals[f.key] > f.max) { errs[f.key].textContent = `Debe ser ≤ ${f.max}.`; bad = true; } }
    if (bad) return;
    let res;
    try { res = o.onSubmit(vals, api); } catch (ex) { res = ex.message; }
    if (typeof res === 'string') general.textContent = res;
    else if (res && typeof res === 'object') for (const [k, m] of Object.entries(res)) (errs[k] || general).textContent = m;
  });
  const actions = h('div', { class: 'form-actions' }, o.extraActions || null, o.onCancel ? U.btn('Cancelar', o.onCancel) : null, h('button', { class: 'btn primary', type: 'submit' }, o.submitLabel || 'Guardar'));
  if (o.submitLabel !== false) form.appendChild(actions);
  form.api = api;
  return form;
};

/* ---------- capas: drawer, modal, confirm, toast ---------- */
U._layers = [];
U.drawer = function (title, body, opts = {}) {
  const root = document.getElementById('overlay-root');
  const content = h('div', { class: 'drawer-body' });
  const closeBtn = U.btn('Cerrar', () => close(), { kind: 'ghost', sm: true });
  const dr = h('div', { class: 'drawer' + (opts.wide ? ' wide' : ''), attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof title === 'string' ? title : 'Detalle' } },
    h('div', { class: 'drawer-head' }, h('div', { style: 'min-width:0' }, opts.code ? h('div', { class: 'muted small mono' }, opts.code) : null, h('h2', null, title)), closeBtn), content);
  const scrim = h('div', { class: 'scrim', on: { mousedown: e => { if (e.target === scrim) close(); } } }, dr);
  function close() { scrim.remove(); U._layers = U._layers.filter(l => l !== layer); if (opts.onClose) opts.onClose(); }
  const layer = { close, el: scrim };
  U._layers.push(layer);
  root.appendChild(scrim);
  const b = typeof body === 'function' ? body(content, close) : body;
  if (b instanceof Node) content.appendChild(b);
  setTimeout(() => { const f = content.querySelector('input,select,textarea'); if (f && !opts.noFocus) f.focus(); }, 30);
  return { close, body: content };
};
U.modal = function (title, body, actions = [], opts = {}) {
  const root = document.getElementById('overlay-root');
  const content = h('div', { class: 'modal-body' });
  const foot = h('div', { class: 'modal-foot' });
  const md = h('div', { class: 'modal' + (opts.wide ? ' wide' : ''), attrs: { role: 'dialog', 'aria-modal': 'true' } }, h('div', { class: 'modal-head' }, h('h2', null, title), U.btn('Cerrar', () => close(), { kind: 'ghost', sm: true })), content, foot);
  const scrim = h('div', { class: 'scrim center', on: { mousedown: e => { if (e.target === scrim) close(); } } }, md);
  function close() { scrim.remove(); U._layers = U._layers.filter(l => l !== layer); }
  const layer = { close, el: scrim }; U._layers.push(layer);
  const b = typeof body === 'function' ? body(content, close) : body;
  if (b instanceof Node) content.appendChild(b);
  for (const a of actions) foot.appendChild(a instanceof Node ? a : U.btn(a.label, () => { const r = a.onClick && a.onClick(close); if (r !== false) close(); }, a));
  if (!actions.length) foot.remove();
  root.appendChild(scrim);
  return { close, body: content };
};
U.confirm = function (o) {
  return U.modal(o.title || 'Confirmar', h('p', null, o.message), [
    { label: 'Cancelar' },
    { label: o.confirmLabel || 'Confirmar', kind: o.danger ? 'danger' : 'primary', onClick: () => o.onConfirm && o.onConfirm() },
  ]);
};
U.closeAll = () => { for (const l of U._layers.slice()) l.close(); };
U.toast = function (msg, tone = '') {
  const root = document.getElementById('toast-root'); if (!root) return;
  const t = h('div', { class: 'toast ' + tone, attrs: { role: 'status' } }, msg);
  root.appendChild(t); setTimeout(() => t.remove(), tone === 'bad' || tone === 'warn' ? 6500 : 3500);
};

/* ---------- gráficos SVG ---------- */
const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null) el.setAttribute(k, v); for (const c of kids.flat()) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); return el; }
U.svg = s;
U.palette = ['var(--primary)', 'var(--accent)', 'var(--info)', 'var(--bad)', 'var(--muted)', 'var(--ok)'];
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function axisFmt(v, f) { return f ? f(v) : (Math.abs(v) >= 1000 ? G.fmt.num(v / 1000, v % 1000 ? 1 : 0) + ' k' : G.fmt.num(v, Math.abs(v) < 10 && v % 1 ? 1 : 0)); }
/** U.chart.bar({labels, series:[{name, values, color}], height, stacked, format, horizontal}) */
U.chart = {
  bar(o) {
    const W = 640, H = o.height || 240, L = 54, R = 12, T = 12, B = 34;
    const n = o.labels.length, ser = o.series;
    const allVals = o.stacked ? o.labels.map((_, i) => U.sum(ser.map(x => Math.max(0, x.values[i] || 0)))) : ser.flatMap(x => x.values.map(v => v || 0));
    const minV = Math.min(0, ...ser.flatMap(x => x.values.map(v => v || 0)));
    const maxV = niceMax(Math.max(...allVals, 0));
    const lo = minV < 0 ? -niceMax(-minV) : 0;
    const y = v => T + (H - T - B) * (1 - (v - lo) / (maxV - lo));
    const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.title || 'Gráfico' });
    for (let i = 0; i <= 4; i++) { const v = lo + (maxV - lo) * i / 4; svg.appendChild(s('line', { class: 'grid-line', x1: L, x2: W - R, y1: y(v), y2: y(v) })); svg.appendChild(s('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, axisFmt(v, o.axisFormat))); }
    const bw = (W - L - R) / n;
    const inner = o.stacked ? bw * 0.6 : (bw * 0.72) / ser.length;
    o.labels.forEach((lab, i) => {
      let acc = 0;
      ser.forEach((se, j) => {
        const v = se.values[i] || 0;
        const x = L + bw * i + (o.stacked ? bw * 0.2 : bw * 0.14 + inner * j);
        const y0 = o.stacked ? y(acc) : y(0), y1 = o.stacked ? y(acc + v) : y(v);
        const rect = s('rect', { x, y: Math.min(y0, y1), width: Math.max(1, inner - 2), height: Math.max(0.5, Math.abs(y1 - y0)), rx: 2, fill: se.color || U.palette[j % U.palette.length] });
        rect.appendChild(s('title', {}, `${se.name || ''} ${lab}: ${o.format ? o.format(v) : G.fmt.num(v, 1)}`));
        svg.appendChild(rect);
        if (o.stacked) acc += v;
      });
      svg.appendChild(s('text', { x: L + bw * i + bw / 2, y: H - 12, 'text-anchor': 'middle' }, String(lab).length > 10 ? String(lab).slice(0, 9) + '…' : lab));
    });
    if (lo < 0) svg.appendChild(s('line', { class: 'axis', x1: L, x2: W - R, y1: y(0), y2: y(0), stroke: 'var(--muted)' }));
    return U.chart._wrap(svg, ser);
  },
  line(o) {
    const W = 640, H = o.height || 220, L = 54, R = 16, T = 14, B = 30;
    const n = o.labels.length, ser = o.series;
    const vals = ser.flatMap(x => x.values.filter(v => v !== null && v !== undefined));
    const lo = o.min !== undefined ? o.min : Math.min(0, ...vals);
    const maxV = o.max !== undefined ? o.max : niceMax(Math.max(...vals, 0.0001));
    const y = v => T + (H - T - B) * (1 - (v - lo) / ((maxV - lo) || 1));
    const x = i => L + (W - L - R) * (n === 1 ? 0.5 : i / (n - 1));
    const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.title || 'Gráfico' });
    for (let i = 0; i <= 4; i++) { const v = lo + (maxV - lo) * i / 4; svg.appendChild(s('line', { class: 'grid-line', x1: L, x2: W - R, y1: y(v), y2: y(v) })); svg.appendChild(s('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, axisFmt(v, o.axisFormat))); }
    o.labels.forEach((lab, i) => { if (n <= 14 || i % Math.ceil(n / 12) === 0) svg.appendChild(s('text', { x: x(i), y: H - 10, 'text-anchor': 'middle' }, lab)); });
    ser.forEach((se, j) => {
      const col = se.color || U.palette[j % U.palette.length];
      const pts = se.values.map((v, i) => v === null || v === undefined ? null : [x(i), y(v)]).filter(Boolean);
      if (!pts.length) return;
      if (ser.length === 1 && o.area !== false) svg.appendChild(s('path', { d: `M${pts[0][0]},${y(lo)} ` + pts.map(p => `L${p[0]},${p[1]}`).join(' ') + ` L${pts[pts.length - 1][0]},${y(lo)} Z`, fill: col, 'fill-opacity': 0.12 }));
      svg.appendChild(s('path', { d: pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(' '), fill: 'none', stroke: col, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
      const last = pts[pts.length - 1];
      svg.appendChild(s('circle', { cx: last[0], cy: last[1], r: 4, fill: col }));
      se.values.forEach((v, i) => { if (v === null || v === undefined) return; const c = s('circle', { cx: x(i), cy: y(v), r: 7, fill: 'transparent' }); c.appendChild(s('title', {}, `${se.name || ''} ${o.labels[i]}: ${o.format ? o.format(v) : G.fmt.num(v, 2)}`)); svg.appendChild(c); });
    });
    if (o.ref !== undefined) svg.appendChild(s('line', { x1: L, x2: W - R, y1: y(o.ref), y2: y(o.ref), stroke: 'var(--bad)', 'stroke-dasharray': '4 4' }));
    return U.chart._wrap(svg, ser);
  },
  hbar(o) { // barras horizontales: o.items=[{label, value, tone}]
    const max = niceMax(Math.max(...o.items.map(i => Math.abs(i.value)), 0.0001));
    return h('div', { class: 'stack', style: 'gap:6px' }, o.items.map(it => h('div', { style: 'display:grid;grid-template-columns:minmax(90px,30%) minmax(0,1fr) auto;gap:10px;align-items:center' },
      h('span', { class: 'small', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, it.label),
      h('div', { class: 'progress ' + (it.tone || '') }, h('i', { style: { width: (Math.abs(it.value) / max * 100) + '%' } })),
      h('span', { class: 'small num' }, o.format ? o.format(it.value) : G.fmt.num(it.value, 1)))));
  },
  _wrap(svg, ser) {
    return h('div', null, svg, ser.length > 1 || ser[0]?.name ? h('div', { class: 'legend' }, ser.map((se, j) => h('span', null, h('i', { style: { background: se.color || U.palette[j % U.palette.length] } }), se.name))) : null);
  },
};
U.sum = (a) => a.reduce((x, y) => x + y, 0);

/* ---------- QR ---------- */
U.qr = function (text, size = 120) {
  const box = h('div', { class: 'qr-box', title: text });
  try {
    if (typeof window.qrcode === 'function') {
      const q = window.qrcode(0, 'M'); q.addData(String(text)); q.make();
      const n = q.getModuleCount(); const cell = size / (n + 2);
      const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': 'Código QR ' + text });
      svg.appendChild(s('rect', { x: 0, y: 0, width: size, height: size, fill: '#ffffff' }));
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${(c + 1) * cell},${(r + 1) * cell}h${cell}v${cell}h${-cell}z`;
      svg.appendChild(s('path', { d, fill: '#111111' }));
      box.appendChild(svg);
      return box;
    }
  } catch (e) { }
  box.appendChild(h('div', { style: { width: size + 'px', height: size + 'px', display: 'grid', placeItems: 'center', color: '#333', fontSize: '11px', textAlign: 'center' } }, 'QR\n' + text));
  return box;
};

/* ---------- CRUD genérico ---------- */
/**
 * U.crud(el, { code, title, sub, table, columns, fields, filters, defaults(), canCreate, createLabel,
 *   rows: ()=>[], beforeSave(vals, row)→error|undefined, afterSave(row, isNew), detail(row, drawerBody, close)→node,
 *   rowActions(row)→[nodes], kpis()→[...], extraActions:[...], above(el), mod })
 */
U.crud = function (el, o) {
  const mod = o.mod || (G.screens[o.code] ? G.screens[o.code].module : null);
  const canC = o.canCreate !== false && (!mod || G.canDo(mod, 'C'));
  const canE = o.canEdit !== false && (!mod || G.canDo(mod, 'E'));
  const acts = (o.extraActions || []).slice();
  if (canC && o.fields) acts.unshift({ label: o.createLabel || 'Nuevo', kind: 'primary', icon: '+', onClick: () => edit(null) });
  const body = U.page(el, { code: o.code, title: o.title, sub: o.sub, actions: acts });
  if (o.kpis) body.appendChild(U.kpis(o.kpis()));
  if (o.above) { const a = o.above(body); if (a instanceof Node) body.appendChild(a); }
  const rows = o.rows ? o.rows() : G.db.all(o.table);
  body.appendChild(U.table({ columns: o.columns, rows, filters: o.filters, onRow: r => open(r), actions: o.rowActions, pageSize: o.pageSize, id: 'crud:' + o.code, sort: o.sort, dir: o.dir, empty: o.empty }));
  if (o.below) { const b = o.below(body); if (b instanceof Node) body.appendChild(b); }
  function open(r) {
    U.drawer(o.detailTitle ? o.detailTitle(r) : (r.code || r.number || r.name || 'Detalle'), (bd, close) => {
      const actions = h('div', { class: 'row' });
      if (canE && o.fields && o.editable !== false && (!o.isEditable || o.isEditable(r))) actions.appendChild(U.btn('Editar', () => { close(); edit(r); }, { kind: 'primary', sm: true }));
      if (o.detailActions) U.append(actions, o.detailActions(r, close));
      if (actions.children.length) bd.appendChild(actions);
      const d = o.detail ? o.detail(r, bd, close) : U.dl((o.fields || o.columns).filter(f => f.type !== 'hidden').map(f => [f.label, f.render ? f.render(r) : (f.options ? optLabel(f, r[f.key]) : fmtVal(r[f.key], f.type))]));
      if (d instanceof Node) bd.appendChild(d);
    }, { code: o.code, wide: o.wideDetail });
  }
  function optLabel(f, v) { const opts = typeof f.options === 'function' ? f.options({}) : f.options; const m = (opts || []).find(x => String(x[0]) === String(v)); return m ? m[1] : v; }
  function fmtVal(v, t) { if (t === 'date') return G.fmt.date(v); if (t === 'money') return G.fmt.money(v); if (t === 'checkbox') return v ? 'Sí' : 'No'; return v; }
  function edit(r) {
    U.drawer(r ? 'Editar ' + (r.code || r.number || r.name || '') : (o.createLabel || 'Nuevo registro'), (bd, close) => {
      const values = r ? Object.assign({}, r) : (o.defaults ? o.defaults() : {});
      bd.appendChild(U.form({
        id: o.code, fields: o.fields, values, submitLabel: r ? 'Guardar cambios' : 'Crear', onCancel: close,
        onSubmit: vals => {
          const err = o.beforeSave && o.beforeSave(vals, r);
          if (err) return err;
          const clean = {}; for (const f of o.fields) if (vals[f.key] !== undefined) clean[f.key] = vals[f.key];
          let row;
          if (r) row = G.db.update(o.table, r.id, clean);
          else row = G.db.insert(o.table, Object.assign({}, o.defaults ? o.defaults() : {}, clean));
          if (o.afterSave) o.afterSave(row, !r);
          close(); G.ui.toast(r ? 'Cambios guardados' : 'Registro creado', 'ok'); G.refresh();
          return true;
        },
      }));
    }, { code: o.code });
  }
  return { open, edit, body };
};

/* ---------- utilidades de opciones ---------- */
U.opts = (table, label = r => r.name, pred = () => true, value = r => r.id) => G.db.all(table).filter(pred).map(r => [value(r), label(r)]);

/** Impresión: el prototipo publicado no puede abrir el diálogo de impresión del navegador. */
G.print = function () {
  G.ui.toast('Documento listo. En el sistema final este botón genera el PDF para imprimir; en este prototipo publicado la impresión del navegador no está disponible.', 'info');
  return false;
};
