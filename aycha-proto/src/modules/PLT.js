/* =====================================================================
   PLT · Plataforma: armazón, búsqueda global, empresas, locales, marcas,
   colores por marca, centros de costo, series, períodos, parámetros,
   módulos activables, dominio de acceso y asistente de configuración.
   Expone G.plt (servicios que usan SEG y los demás módulos).
   ===================================================================== */
(function () {
  'use strict';
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs, pills, progress } = G.ui;
  const D = G.db, F = G.fmt, U = G.util;
  const P = G.plt = G.plt || {};
  const CORE = ['PLT', 'SEG', 'MAE', 'INT', 'AUD'];
  const EVERYONE = ['plt.search.use', 'seg.self.manage'];
  P.CORE = CORE;

  /* ---------- etiquetas ---------- */
  const ST = {
    OPEN: ['Abierto', 'info'], CLOSING: ['En cierre', 'warn'], CLOSED: ['Cerrado', ''], ACTIVE: ['Activo', 'ok'], INACTIVE: ['Inactivo', ''], SEPARATED: ['Separada', 'warn'],
    SUSPENDED: ['Suspendido', 'bad'], TRIAL: ['En prueba', 'info'], CANCELLED: ['Cerrado', ''],
  };
  const stBadge = s => badge((ST[s] || [G.ui.statusLabel(s)])[0], (ST[s] || [0, ''])[1]);
  P.stBadge = stBadge;
  const AREAS = [['PRODUCTION', 'Producción'], ['QUALITY', 'Calidad'], ['WAREHOUSE', 'Almacén'], ['DELIVERY', 'Delivery'], ['SALES', 'Ventas'], ['MARKETING', 'Marketing'], ['ADMIN', 'Administración'], ['FINANCE', 'Finanzas'], ['HR', 'RR. HH.']];
  const EST_TYPES = [['PLANT', 'Planta'], ['STORE', 'Tienda'], ['WAREHOUSE', 'Almacén'], ['OFFICE', 'Oficina'], ['MIXED', 'Mixto (planta y mostrador)']];
  const DOC_SERIES = [['INVOICE', 'Factura', /^F[A-Z0-9]{3}$/], ['RECEIPT', 'Boleta', /^B[A-Z0-9]{3}$/], ['CREDIT_NOTE', 'Nota de crédito', /^[FB]C[A-Z0-9]{2}$/], ['DEBIT_NOTE', 'Nota de débito', /^[FB]D[A-Z0-9]{2}$/], ['DISPATCH_GUIDE', 'Guía de remisión', /^T[A-Z0-9]{3}$/],
    ['INTERNAL_NOTE', 'Nota interna', null], ['PURCHASE_ORDER', 'Orden de compra', null], ['PRODUCTION_ORDER', 'Orden de producción', null], ['QUOTE', 'Cotización', null], ['CONSIGNMENT_NOTE', 'Nota de consignación', null], ['JOURNAL', 'Asiento contable', null]];
  const lbl = (list, v) => (list.find(x => x[0] === v) || [v, v || '—'])[1];
  const SERIES_MAX = 99999999;
  P.lbl = lbl;

  /* ---------- tiempo con minutos (simulaciones de SEG y períodos) ---------- */
  const toMs = iso => Date.parse(String(iso).slice(0, 19) + 'Z');
  P.toMs = toMs;
  P.addMin = (iso, m) => new Date(toMs(iso) + m * 60000).toISOString().slice(0, 19);
  P.minDiff = (a, b) => (toMs(a) - toMs(b)) / 60000;

  /* ---------- permisos especiales y API simulada ---------- */
  /** ¿el rol tiene el permiso? (RN-PLT-07: un módulo apagado no concede permisos; «Todos» para los de uso propio) */
  P.hasPerm = function (perm, role = G.ctx.role) {
    const info = G.PERM_INFO[perm];
    if (info && !G.modOn(info.module)) return false;
    const r = D.find('roles', x => x.code === role);
    if (r && r.status === 'INACTIVE') return false;
    if (EVERYONE.includes(perm)) return true;
    return G.can(perm, role);
  };
  /** lanza 403 si no tiene el permiso (RN-SEG-12) o si el módulo está apagado (RN-PLT-07) */
  P.assertPerm = function (perm) {
    const info = G.PERM_INFO[perm];
    if (info && !G.modOn(info.module)) G.fail('RN-PLT-07', `403 · el módulo ${info.module} está apagado: el permiso ${perm} no se concede.`, { status: 403 });
    if (!P.hasPerm(perm)) G.fail('RN-SEG-12', `403 · tu rol (${G.roleName()}) no tiene el permiso ${perm}${info ? ' (' + info.desc.toLowerCase() + ')' : ''}.`, { status: 403 });
  };
  /** llamada a la API simulada: /api/v1/<mod>/… responde 403 RN-PLT-07 si el módulo está apagado */
  P.apiCall = function (method, path, opts = {}) {
    const m = (String(path).match(/\/api\/v1\/([a-z0-9]+)\//i) || [])[1];
    const code = m ? m.toUpperCase() : null;
    if (code && G.SPEC[code] && !G.modOn(code)) return { status: 403, body: { code: 'RN-PLT-07', message: `Módulo ${code} desactivado para la empresa` } };
    if (opts.perm && !P.hasPerm(opts.perm, opts.role || G.ctx.role)) return { status: 403, body: { code: 'RN-SEG-12', message: 'Sin permiso ' + opts.perm } };
    return { status: method === 'POST' ? 201 : 200, body: { ok: true } };
  };
  /** RN-PLT-02: no se enlaza un registro de otra empresa cliente */
  P.assertSameTenant = function (table, id) { if (id && !D.get(table, id)) G.fail('RN-PLT-02', `El registro ${id} de ${table} no pertenece a esta empresa: no se puede enlazar.`); return D.get(table, id); };
  const GLOBAL_TABLES = ['tenants', 'platform_modules', 'parameter_definitions', 'tenant_hostnames', 'kpi_definitions', 'sunat_catalog_items', 'ubigeo', 'audit'];
  /** RN-PLT-01: tablas de negocio con filas sin empresa (debe dar cero) */
  P.rlsGaps = function () { const out = []; for (const [t, rows] of Object.entries(D.t)) { if (GLOBAL_TABLES.includes(t)) continue; const n = rows.filter(r => !r.tenant).length; if (n) out.push({ table: t, rows: n }); } return out; };
  /** CA-PLT-01: recorre todas las tablas con la sesión de una empresa y busca filas de otra */
  P.isolationCheck = function (tenant = G.ctx.tenant) {
    const prev = G.ctx.tenant; G.ctx.tenant = tenant; const res = [];
    try {
      for (const t of Object.keys(D.t)) {
        const rows = D.all(t); const leak = rows.filter(r => r.tenant && r.tenant !== tenant).length;
        const foreign = D.raw(t).find(r => r.tenant && r.tenant !== tenant);
        let writeBlocked = true; if (foreign) { try { D.update(t, foreign.id, { _probe: 1 }, { silent: true }); writeBlocked = false; delete foreign._probe; } catch (e) { writeBlocked = true; } }
        res.push({ table: t, visible: rows.length, leak, foreignRows: D.raw(t).filter(r => r.tenant && r.tenant !== tenant).length, writeBlocked });
      }
    } finally { G.ctx.tenant = prev; }
    return res;
  };

  /* ---------- catálogo de módulos y dependencias (RN-PLT-08 a RN-PLT-10) ---------- */
  const DEP_TXT = {
    AUD: 'PLT, SEG, INT', INT: 'PLT, SEG, AUD', MAE: 'PLT, SEG, INT', PLT: '', SEG: 'PLT',
    ADS: 'PLT, INT, MAE, CRM, PED, CAJ, GAS', ALM: 'PLT, CAT, PED, FAC', CAJ: 'PLT, SEG, MAE, INT, CLI, PED, FAC, WEB, POS', CAT: 'PLT, MAE, INT', CLI: 'PLT, MAE, INT',
    CRM: 'PLT, SEG, INT, CLI, CAT, PED, CAJ', DEL: 'PED, CLI, PRE, FAC, CAJ, GAS, MAE, INT', FAC: 'PLT, MAE, INT, CLI, PED, ALM', GAS: 'PLT, SEG, MAE, CAJ, INT, COM',
    PED: 'PLT, SEG, MAE, CAT, CLI, ALM', POS: 'PLT, SEG, MAE, CAT, CLI, PED, ALM, FAC, CAJ', PRE: 'PED, ALM, CAT, DEL, INT', TAB: 'PLT, SEG, AUD, INT', TEL: 'PLT, SEG, INT, CLI, CRM, PED',
    WEB: 'INT, CAT, CLI, PED, ALM, CAJ', CAL: 'PLT, SEG, CAT, CLI, PED, ALM, PRE, DEL, FAC, CRM, PRO, REC, EQU, COM', CNT: 'PLT, SEG, MAE, AUD, FAC, CAJ, GAS, ALM, TAB, COM, GRJ, PRO',
    COM: 'PLT, SEG, MAE, CAT, ALM, GAS, CAJ, CAL, EQU, GRJ, CNT', DES: 'PLT, MAE, CAT, ALM, PRO, EQU, CAL', EQU: 'PLT, MAE, ALM, GAS, COM, CAL, PRO', ETQ: 'PLT, INT, CAT, CLI, PED, ALM, PRE, FAC, CRM, PRO, CAL, COM, GRJ',
    GRJ: 'PLT, INT, CAT, ALM, COM, CAL, ETQ, CNT', PRO: 'PLT, SEG, MAE, CAT, ALM, TAB, REC, DES, EQU, CAL', REC: 'PLT, SEG, CAT, ALM, PRO, CAL',
    B2B: 'PLT, SEG, CLI, CAT, PED, FAC, CAJ, CRM, DEL, TAB, CNT', CMP: 'PLT, SEG, INT, CLI, PED, CRM, ADS, CAJ, FAC, TAB', CON: 'PLT, SEG, MAE, CLI, CAT, ALM, FAC, CAJ, DEL, TAB, CAL, CNT, B2B',
    FLO: 'PLT, SEG, MAE, INT, DEL, GAS, CAL, TAB, CNT, PER', PER: 'PLT, SEG, MAE, PED, DEL, CAJ, CRM, TEL, TAB, CNT, FLO', PRS: 'PLT, GAS, FAC, ADS, TAB, CNT, COM, PER, FLO',
    API: 'SUS, INT, SEG, PLT, PED, CLI, CAT, ALM, FAC, CAJ, DEL', ONB: 'SUS, PLT, SEG, MAE, CAT, CLI, ALM, FAC, CRM, TAB, INT, DES, REC, CAL, GAS', OPS: 'SUS, ONB, INT, AUD, SEG, PLT',
    SEP: 'PLT, ALM, FAC, PED, CLI, CAJ, CRM, WEB, ADS, AUD, INT, SUS', SUS: 'PLT, SEG, INT, AUD',
  };
  const EXTRA_HARD = { TEL: ['CRM', 'CLI', 'PED'] };
  /** dependencias obligatorias (módulos de fases anteriores; TEL exige CRM) y las que solo usa si están encendidas */
  P.depsOf = function (code) {
    const sp = G.SPEC[code]; if (!sp) return { hard: [], soft: [] };
    const all = [...new Set(String(DEP_TXT[code] || '').match(/\b[A-Z0-9]{3}\b/g) || [])].filter(c => G.SPEC[c] && c !== code && !CORE.includes(c));
    const hard = all.filter(c => (G.SPEC[c].phase < sp.phase && c !== 'TEL') || (EXTRA_HARD[code] || []).includes(c)); // TEL llega apagado: quien lo usa lo trata como opcional
    return { hard, soft: all.filter(c => !hard.includes(c)) };
  };
  P.modName = code => (G.modules[code] && G.modules[code].name) || (G.SPEC[code] || {}).name || code;
  P.dependents = code => Object.keys(G.SPEC).filter(c => P.depsOf(c).hard.includes(code));
  /** valida un cambio de interruptor sin aplicarlo: devuelve el error o null */
  P.checkToggle = function (code, on) {
    if (!D.find('platform_modules', m => m.code === code)) return `RN-PLT-08: ${code} no está en el catálogo global de módulos.`;
    if (!on && CORE.includes(code)) return `RN-PLT-09: ${code} es un módulo núcleo y siempre está encendido.`;
    if (on) {
      const miss = P.depsOf(code).hard.filter(c => !G.modOn(c));
      if (miss.length) return `RN-PLT-10: para encender ${code} primero enciende ${miss.map(c => c + ' (' + P.modName(c) + ')').join(', ')}.`;
      if (code === 'TEL') { const pend = P.telChecklist().filter(s => s.step_code !== 'SWITCH_ON' && !s.done); if (pend.length) return `RN-TEL-02: la lista de activación de TEL está incompleta: falta ${pend.map(s => s.step_no + '. ' + TEL_STEPS.find(x => x[0] === s.step_code)[1].toLowerCase()).join('; ')}.`; }
    } else {
      const deps = P.dependents(code).filter(c => G.modOn(c));
      if (deps.length) return `RN-PLT-10: no se puede apagar ${code}: ${deps.join(', ')} depende${deps.length > 1 ? 'n' : ''} de él. Apágalos primero.`;
    }
    return null;
  };
  P.toggleModule = function (code, on, reason) {
    P.assertPerm('plt.module.toggle');
    const err = P.checkToggle(code, on); if (err) { const [c, ...m] = err.split(': '); G.fail(c, m.join(': ')); }
    const min = G.param('plt_parameter_reason_min_length') || 10;
    if (String(reason || '').trim().length < min) G.fail('RN-PLT-06', `Escribe el motivo del cambio (mínimo ${min} caracteres).`);
    G.setModule(code, !!on, reason.trim());
    const t = D.find('tenant_modules', x => x.module_code === code);
    if (t) D.update('tenant_modules', t.id, on ? { enabled_by: G.ctx.userName(), disabled_reason: null } : { disabled_reason: reason.trim() }, { silent: true });
    if (code === 'TEL' && on) { const s = P.telChecklist().find(x => x.step_code === 'SWITCH_ON'); if (s) D.update('tel_activation_steps', s.id, { done: true, done_by: G.ctx.userId(), done_at: G.date.now(), notes: reason.trim() }, { silent: true }); }
    return t;
  };

  /* ---------- lista de activación de TEL (tabla del dueño: tel_activation_steps) ---------- */
  const TEL_STEPS = [
    ['PROVIDER_AND_NUMBERS', 'Proveedor y números contratados', 'Conector TelephonyProvider (Twilio o falso) y números de la central por marca o general'],
    ['CARRIER_FORWARDING', 'Desvío del operador', 'Los celulares de la publicidad desviados a la central (constancia del operador)'],
    ['RECORDING_NOTICE', 'Aviso de grabación (Ley 29733)', '«Esta llamada puede ser grabada para fines de calidad»: audio cargado y probado antes de grabar'],
    ['SELLER_USERS', 'Usuarias de las vendedoras', 'Cada vendedora con usuario, extensión y permiso tel.call.make'],
    ['SIGNED_POLICY', 'Política de grabación firmada', 'Política de datos personales y de grabación firmada por gerencia (retención 180 días, D-TEL-03)'],
    ['SWITCH_ON', 'Encendido', 'Se marca solo al encender el módulo en PLT-12'],
  ];
  P.TEL_STEPS = TEL_STEPS;
  P.telChecklist = function () {
    let rows = D.all('tel_activation_steps');
    if (!rows.length) { for (const [code, name, desc] of TEL_STEPS) D.insert('tel_activation_steps', { step_no: TEL_STEPS.findIndex(x => x[0] === code) + 1, step_code: code, name, description: desc, done: false, done_by: null, done_at: null, notes: null }, { silent: true }); rows = D.all('tel_activation_steps'); }
    return rows.slice().sort(U.by('step_no'));
  };
  P.telStepDone = function (stepId, { notes, owner } = {}) {
    if (!P.hasPerm('plt.module.toggle') && !G.can('tel.settings.manage')) P.assertPerm('plt.module.toggle');
    const s = D.get('tel_activation_steps', stepId); if (!s) G.fail('RN-TEL-02', 'Paso no encontrado.');
    if (s.step_code === 'SWITCH_ON') G.fail('RN-TEL-02', 'El encendido se marca al activar el módulo.');
    if (!String(notes || '').trim()) G.fail('RN-TEL-02', 'Cada paso exige responsable, fecha y evidencia: escribe la evidencia.');
    return D.update('tel_activation_steps', s.id, { done: true, done_by: owner || G.ctx.userId(), done_at: G.date.now(), notes: String(notes).trim() });
  };

  /* ---------- temas por marca (RN-PLT-15, RN-PLT-23) ---------- */
  P.THEME_KEYS = [['primary', 'Primario'], ['primary_dark', 'Primario oscuro'], ['accent', 'Acento'], ['background', 'Fondo'], ['surface', 'Superficie'], ['text', 'Texto'], ['on_primary', 'Texto sobre primario']];
  P.PAIRS = [['text', 'background', 'Texto sobre fondo'], ['text', 'surface', 'Texto sobre superficie'], ['on_primary', 'primary', 'Texto sobre primario']];
  const hexOk = c => /^#[0-9A-Fa-f]{6}$/.test(String(c || ''));
  P.luminance = hex => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  /** contraste WCAG 2.x entre dos colores #RRGGBB */
  P.contrast = (a, b) => { if (!hexOk(a) || !hexOk(b)) return 0; const l1 = P.luminance(a), l2 = P.luminance(b); return U.round((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), 2); };
  P.checkTheme = function (light, dark) {
    const min = G.param('plt_ui_min_contrast_ratio') || 4.5; const out = [];
    for (const [mode, t] of [['LIGHT', light], ['DARK', dark]]) {
      for (const [k] of P.THEME_KEYS) if (!hexOk(t[k])) out.push({ mode, pair: k, ratio: 0, ok: false, bad_hex: true, label: `${lbl(P.THEME_KEYS, k)} no es #RRGGBB` });
      for (const [a, b, l] of P.PAIRS) { const r = P.contrast(t[a], t[b]); out.push({ mode, pair: a + '/' + b, label: l, ratio: r, ok: r >= min }); }
    }
    return out;
  };
  P.themeFor = function (brand_id) {
    const own = brand_id && D.find('ui_themes', t => t.brand_id === brand_id && t.status === 'ACTIVE');
    return own || D.find('ui_themes', t => !t.brand_id && t.status === 'ACTIVE') || null;
  };
  P.saveTheme = function (brand_id, light, dark, name) {
    P.assertPerm('plt.theme.manage');
    light = Object.fromEntries(Object.entries(light).map(([k, v]) => [k, String(v).toUpperCase()]));
    dark = Object.fromEntries(Object.entries(dark).map(([k, v]) => [k, String(v).toUpperCase()]));
    const bad = P.checkTheme(light, dark).filter(x => !x.ok);
    if (bad.length) G.fail('RN-PLT-15', `El tema no cumple: ${bad.map(b => `${b.mode === 'LIGHT' ? 'claro' : 'oscuro'} · ${b.label}${b.ratio ? ' ' + F.num(b.ratio, 2) + ':1' : ''}`).join('; ')}. Mínimo ${F.num(G.param('plt_ui_min_contrast_ratio') || 4.5, 1)}:1.`);
    for (const t of D.where('ui_themes', t => (t.brand_id || null) === (brand_id || null) && t.status === 'ACTIVE')) D.update('ui_themes', t.id, { status: 'INACTIVE' }, { silent: true });
    return D.insert('ui_themes', { brand_id: brand_id || null, name: name || (brand_id ? 'Tema ' + G.brandName(brand_id) : 'Tema de la empresa'), light, dark, font_family: 'Source Sans 3', radius_px: 8, status: 'ACTIVE', changed_by: G.ctx.userName() });
  };

  /* ---------- empresas, locales y marcas ---------- */
  P.saveCompany = function (v, id) {
    P.assertPerm('plt.company.manage');
    const ruc = String(v.ruc || '').trim();
    if (!/^\d{11}$/.test(ruc) || !/^(10|15|17|20)/.test(ruc)) G.fail('RN-PLT-13', 'El RUC tiene 11 dígitos y empieza en 10, 15, 17 o 20.');
    if (!U.rucOk(ruc)) G.fail('RN-PLT-13', `El dígito verificador del RUC ${ruc} no es correcto (módulo 11). Debería terminar en ${U.rucCheck(ruc.slice(0, 10)).slice(-1)}.`);
    if (D.find('companies', c => c.ruc === ruc && c.id !== id)) G.fail('RN-PLT-13', 'Ya existe una empresa con ese RUC.');
    if (v.fiscal_ubigeo && !/^\d{6}$/.test(v.fiscal_ubigeo)) G.fail('RN-PLT-13', 'El ubigeo tiene 6 dígitos (INEI).');
    const row = { legal_name: String(v.legal_name || '').trim().toUpperCase(), trade_name: v.trade_name, ruc, tax_regime: v.tax_regime, fiscal_address: v.fiscal_address, fiscal_ubigeo: v.fiscal_ubigeo, default_currency: v.default_currency || 'PEN', timezone: v.timezone || 'America/Lima', status: v.status || 'ACTIVE' };
    return id ? D.update('companies', id, row) : D.insert('companies', row);
  };
  P.saveEstablishment = function (v, id) {
    P.assertPerm('plt.establishment.manage');
    if (!/^[A-Z0-9]{1,6}$/.test(String(v.code || '').toUpperCase())) G.fail('RN-PLT-04', 'El código interno del local tiene de 1 a 6 letras o números.');
    if (v.sunat_code && !/^\d{4}$/.test(v.sunat_code)) G.fail('RN-PLT-04', 'El código de establecimiento anexo SUNAT tiene 4 dígitos (0000 es el domicilio fiscal).');
    if (D.find('establishments', e => e.code === String(v.code).toUpperCase() && e.id !== id)) G.fail('RN-PLT-04', 'Ya existe un local con ese código.');
    if (v.sunat_code && D.find('establishments', e => e.company_id === (v.company_id || 'co-dg') && e.sunat_code === v.sunat_code && e.id !== id)) G.fail('RN-PLT-04', `El código anexo ${v.sunat_code} ya está usado por otro local de la empresa.`);
    P.assertSameTenant('companies', v.company_id || 'co-dg');
    const row = { company_id: v.company_id || 'co-dg', code: String(v.code).toUpperCase(), name: v.name, short: v.short || v.name, est_type: v.est_type, sunat_code: v.sunat_code || null, address: v.address, ubigeo: v.ubigeo, lat: v.lat != null && v.lat !== '' ? Number(v.lat) : null, lng: v.lng != null && v.lng !== '' ? Number(v.lng) : null, status: v.status || 'ACTIVE', has_counter: !!v.has_counter };
    return id ? D.update('establishments', id, row) : D.insert('establishments', row);
  };
  P.saveBrand = function (v, id) {
    P.assertPerm('plt.brand.manage');
    const code = String(v.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,6}$/.test(code)) G.fail('RN-PLT-14', 'El código de la marca tiene de 2 a 6 letras o números.');
    if (D.find('brands', b => b.code === code && b.id !== id)) G.fail('RN-PLT-14', 'Ya existe una marca con ese código.');
    P.assertSameTenant('companies', v.company_id || 'co-dg');
    const row = { code, name: v.name, company_id: v.company_id || 'co-dg', website: v.website || null, whatsapp_display_name: v.whatsapp_display_name, legal_footer: v.legal_footer, sort_order: Number(v.sort_order) || 99, status: v.status || 'ACTIVE', description: v.description || null, logo_url: v.logo_url || null };
    if (!id) row.primary_color = '#922242';
    return id ? D.update('brands', id, row) : D.insert('brands', Object.assign({ id: 'br-' + code }, row));
  };
  /** RN-PLT-14: una marca inactiva o separada no admite documentos nuevos */
  P.assertBrandActive = function (brand_id) { const b = D.get('brands', brand_id); if (!b) G.fail('RN-PLT-14', 'Marca no encontrada.'); if (b.status !== 'ACTIVE') G.fail('RN-PLT-14', `La marca ${b.name} está ${b.status === 'SEPARATED' ? 'separada' : 'inactiva'}: no admite documentos nuevos (sus documentos históricos se siguen consultando).`); return b; };

  /* ---------- centros de costo en árbol (RN-PLT-21) ---------- */
  P.ccDepth = function (id, seen = new Set()) { let d = 0, cur = D.get('cost_centers', id); while (cur) { if (seen.has(cur.id)) return Infinity; seen.add(cur.id); d++; cur = cur.parent_id ? D.get('cost_centers', cur.parent_id) : null; } return d; };
  P.saveCostCenter = function (v, id) {
    P.assertPerm('plt.cost_center.manage');
    const code = String(v.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{2,12}$/.test(code)) G.fail('RN-PLT-21', 'El código tiene de 2 a 12 letras, números o guiones.');
    if (D.find('cost_centers', c => c.code === code && c.id !== id)) G.fail('RN-PLT-21', 'Ya existe un centro de costo con ese código.');
    const parent = v.parent_id ? D.get('cost_centers', v.parent_id) : null;
    if (id && v.parent_id) { let cur = parent; while (cur) { if (cur.id === id) G.fail('RN-PLT-21', 'El padre elegido está debajo de este centro de costo: se formaría un ciclo.'); cur = cur.parent_id ? D.get('cost_centers', cur.parent_id) : null; } }
    const max = G.param('plt_cost_center_max_depth') || 4;
    const depth = (parent ? P.ccDepth(parent.id) : 0) + 1;
    const subDepth = id ? (function sd(x) { const ch = D.where('cost_centers', c => c.parent_id === x); return ch.length ? 1 + Math.max(...ch.map(c => sd(c.id))) : 0; })(id) : 0;
    if (depth + subDepth > max) G.fail('RN-PLT-21', `El árbol admite como máximo ${max} niveles: quedaría con ${depth + subDepth}.`);
    const row = { code, name: v.name, area: v.area || (parent && parent.area), parent_id: v.parent_id || null, establishment_id: v.establishment_id || null, brand_id: v.brand_id || null, company_id: 'co-dg', status: v.status || 'ACTIVE' };
    return id ? D.update('cost_centers', id, row) : D.insert('cost_centers', row);
  };

  /* ---------- series (RN-PLT-03, RN-PLT-04, RN-PLT-20) ---------- */
  P.seriesUse = s => U.round((s.next_number - 1) / SERIES_MAX * 100, 4);
  P.validSeriesCode = function (code, docType, electronic) {
    const d = DOC_SERIES.find(x => x[0] === docType);
    if (electronic) { if (!d || !d[2]) return `RN-PLT-04: ${lbl(DOC_SERIES, docType)} no es un comprobante electrónico.`; if (!d[2].test(code)) return `RN-PLT-04: la serie ${code} no tiene el formato de ${d[1].toLowerCase()} (${docType === 'INVOICE' ? 'F + 3 caracteres, p. ej. F006' : docType === 'RECEIPT' ? 'B + 3 caracteres, p. ej. B011' : docType === 'DISPATCH_GUIDE' ? 'T + 3 caracteres, p. ej. T003' : 'FC01/BC01 o FD01/BD01'}).`; }
    else if (!/^[A-Z0-9]{2,4}$/.test(code)) return 'RN-PLT-04: las series internas tienen de 2 a 4 letras o números.';
    return null;
  };
  P.saveSeries = function (v) {
    P.assertPerm('plt.series.manage');
    const code = String(v.series || '').trim().toUpperCase();
    const err = P.validSeriesCode(code, v.doc_type, !!v.is_electronic); if (err) G.fail('RN-PLT-04', err.replace(/^RN-PLT-04: /, ''));
    if (D.find('document_series', s => s.series === code && (s.company_id || 'co-dg') === (v.company_id || 'co-dg'))) G.fail('RN-PLT-04', `La serie ${code} ya existe en la empresa.`);
    const n = Number(v.next_number || 1); if (!(n >= 1 && n <= SERIES_MAX)) G.fail('RN-PLT-20', 'El correlativo va de 1 a 99 999 999.');
    return D.insert('document_series', { company_id: v.company_id || 'co-dg', establishment_id: v.establishment_id || null, brand_id: v.brand_id || null, doc_type: v.doc_type, series: code, next_number: n, is_electronic: !!v.is_electronic, status: 'ACTIVE', applies_to: v.doc_type === 'CREDIT_NOTE' || v.doc_type === 'DEBIT_NOTE' ? (code[0] === 'F' ? 'INVOICE' : 'RECEIPT') : null, note: v.note || null });
  };
  P.setSeriesStatus = function (id, active, reason) { P.assertPerm('plt.series.manage'); if (!String(reason || '').trim()) G.fail('RN-PLT-03', 'Indica el motivo.'); return D.update('document_series', id, { status: active ? 'ACTIVE' : 'INACTIVE', status_reason: reason }); };
  /** numera al emitir en la misma «transacción»: si fn falla, el número no se consume (RN-PLT-03) */
  P.issueNumbered = function (seriesCode, fn) {
    const s = D.find('document_series', x => x.series === seriesCode);
    if (s && s.next_number > SERIES_MAX) G.fail('RN-PLT-20', `La serie ${seriesCode} llegó al máximo (99 999 999): crea otra serie.`);
    const n = G.series.next(seriesCode);
    try { return fn(n); } catch (e) { const row = D.find('document_series', x => x.series === seriesCode); if (row && row.next_number === n.number + 1) { row.next_number = n.number; D.touch(); } throw e; }
  };

  /* ---------- períodos (RN-PLT-05, RN-PLT-17, RN-PLT-18) ---------- */
  P.periodEvents = pid => D.where('accounting_period_events', e => e.period_id === pid).sort(U.by('acted_at'));
  P.closePeriod = function (pid, reason) {
    P.assertPerm('plt.period.close');
    const p = D.get('accounting_periods', pid); if (!p) G.fail('RN-PLT-05', 'Período no encontrado.');
    if (p.status === 'CLOSED') G.fail('RN-PLT-17', `${G.date.monthName(p.period)} ya está cerrado.`);
    if (p.period >= G.date.month(G.TODAY)) G.fail('RN-PLT-17', `${G.date.monthName(p.period)} aún está en curso: se cierra desde el mes siguiente.`);
    const prev = D.find('accounting_periods', x => x.period === G.date.addMonths(p.period, -1) && (x.company_id || 'co-dg') === (p.company_id || 'co-dg'));
    if (prev && prev.status !== 'CLOSED') G.fail('RN-PLT-17', `Primero cierra ${G.date.monthName(prev.period)}: los períodos se cierran en orden.`);
    const at = G.date.now();
    D.update('accounting_periods', p.id, { status: 'CLOSED', closed_at: at, closed_by: G.ctx.userName() });
    D.insert('accounting_period_events', { period_id: p.id, period: p.period, action: 'CLOSE', reason: reason || null, acted_by: G.ctx.userId(), acted_by_name: G.ctx.userName(), acted_at: at }, { silent: true });
    G.events.emit('period.closed', { period_id: p.id, period: p.period, source: G.modOn('CNT') && G.cnt ? 'CNT' : 'PLT' });
    return p;
  };
  P.reopenPeriod = function (pid, reason) {
    P.assertPerm('plt.period.reopen');
    const p = D.get('accounting_periods', pid); if (!p) G.fail('RN-PLT-18', 'Período no encontrado.');
    if (p.status !== 'CLOSED') G.fail('RN-PLT-18', `${G.date.monthName(p.period)} no está cerrado.`);
    const min = G.param('plt_parameter_reason_min_length') || 10;
    if (String(reason || '').trim().length < min) G.fail('RN-PLT-18', `Reabrir exige un motivo de al menos ${min} caracteres.`);
    const later = D.find('accounting_periods', x => x.period > p.period && x.status === 'CLOSED' && (x.company_id || 'co-dg') === (p.company_id || 'co-dg'));
    if (later) G.fail('RN-PLT-18', `No se puede reabrir: ${G.date.monthName(later.period)} (posterior) está cerrado. Reabre primero los meses posteriores.`);
    const at = G.date.now();
    D.update('accounting_periods', p.id, { status: 'OPEN', reopened_at: at, reopened_by: G.ctx.userName(), reopen_reason: reason.trim() });
    D.insert('accounting_period_events', { period_id: p.id, period: p.period, action: 'REOPEN', reason: reason.trim(), acted_by: G.ctx.userId(), acted_by_name: G.ctx.userName(), acted_at: at }, { silent: true });
    G.events.emit('period.reopened', { period_id: p.id, period: p.period, reason: reason.trim() });
    return p;
  };
  /** cierre a tiempo: hasta el día plt_period_close_day del mes siguiente (KPI-PLT-01) */
  P.closedOnTime = function (p) { const ev = P.periodEvents(p.id).filter(e => e.action === 'CLOSE').pop(); if (!ev) return null; const due = G.date.add(G.date.addMonths(p.period, 1), (G.param('plt_period_close_day') || 5) - 1); return ev.acted_at.slice(0, 10) <= due; };

  /* ---------- parámetros con definición (RN-PLT-06, RN-PLT-11, RN-PLT-12) ---------- */
  const RANGE = { plt_period_close_day: [1, 28], plt_parameter_reason_min_length: [5, 200], plt_ui_min_contrast_ratio: [3, 21], plt_cost_center_max_depth: [2, 6], plt_search_min_chars: [2, 10], plt_search_max_results: [5, 100], plt_series_alert_pct: [50, 99],
    seg_password_min_length: [8, 64], seg_password_history_count: [0, 24], seg_password_max_age_days: [0, 365], seg_max_failed_logins: [3, 10], seg_lockout_minutes: [5, 1440], seg_session_idle_minutes: [5, 480], seg_session_max_hours: [1, 24], seg_mobile_session_days: [1, 30],
    seg_max_concurrent_sessions: [1, 10], seg_reset_token_minutes: [10, 120], seg_totp_window_steps: [0, 2], seg_recovery_codes_count: [5, 20], seg_inactive_user_days: [15, 365] };
  const LISTS = { plt_ui_default_theme_mode: [['LIGHT', 'Claro'], ['DARK', 'Oscuro'], ['SYSTEM', 'El del sistema']], plt_default_currency: [['PEN', 'Soles (PEN)'], ['USD', 'Dólares (USD)']] };
  const unitOf = k => /_pct$/.test(k) ? '%' : /_minutes$/.test(k) ? 'min' : /_hours$/.test(k) ? 'h' : /_days$/.test(k) ? 'días' : /_kg$/.test(k) ? 'kg' : /_(amount|fee|above|rate_[a-z]+)$/.test(k) ? 'S/' : /_s$/.test(k) ? 's' : /_ratio$/.test(k) ? ':1' : null;
  function inferDef(key, d) {
    const v = d.default; let type = 'TEXT';
    if (LISTS[key]) type = 'LIST'; else if (typeof v === 'boolean') type = 'BOOL'; else if (typeof v === 'number') type = Number.isInteger(v) && !/_ratio$|_pct$|rate/.test(key) ? 'INT' : 'DECIMAL'; else if (v && typeof v === 'object') type = 'JSON'; else if (/^\d{2}:\d{2}$/.test(String(v))) type = 'TIME';
    const r = RANGE[key] || (type === 'INT' || type === 'DECIMAL' ? [0, /_pct$/.test(key) ? 100 : null] : [null, null]);
    return { key, module_code: d.module, value_type: type, default_value: v, min_value: r[0], max_value: r[1], allowed_scopes: CORE.includes(d.module) ? ['TENANT'] : ['TENANT', 'ESTABLISHMENT', 'BRAND'], unit: unitOf(key), description: d.desc, options: LISTS[key] || null };
  }
  P.paramDef = key => D.find('parameter_definitions', x => x.key === key) || (G.PARAM_DEFS[key] ? inferDef(key, G.PARAM_DEFS[key]) : null);
  P.SCOPES = [['TENANT', 'Empresa (tenant)'], ['ESTABLISHMENT', 'Local'], ['BRAND', 'Marca']];
  /** convierte y valida un valor contra su definición (RN-PLT-11) */
  P.parseParam = function (key, raw) {
    const d = P.paramDef(key); if (!d) G.fail('RN-PLT-11', `El parámetro ${key} no está definido.`);
    let v = raw;
    if (d.value_type === 'BOOL') { v = raw === true || raw === 'true' || raw === 'sí' || raw === 'si'; if (raw !== true && raw !== false && !['true', 'false', 'sí', 'si', 'no'].includes(String(raw))) G.fail('RN-PLT-11', `${key} es sí/no.`); }
    else if (d.value_type === 'INT' || d.value_type === 'DECIMAL') {
      v = Number(String(raw).replace(',', '.'));
      if (String(raw).trim() === '' || !isFinite(v)) G.fail('RN-PLT-11', `${key} debe ser un número.`);
      if (d.value_type === 'INT' && !Number.isInteger(v)) G.fail('RN-PLT-11', `${key} debe ser un número entero.`);
      if (d.min_value != null && v < d.min_value) G.fail('RN-PLT-11', `${key} debe ser al menos ${d.min_value}${d.unit ? ' ' + d.unit : ''}.`);
      if (d.max_value != null && v > d.max_value) G.fail('RN-PLT-11', `${key} debe ser como máximo ${d.max_value}${d.unit ? ' ' + d.unit : ''}.`);
    } else if (d.value_type === 'TIME') { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw))) G.fail('RN-PLT-11', `${key} es una hora HH:MM.`); }
    else if (d.value_type === 'LIST') { if (!(d.options || []).some(o => o[0] === raw)) G.fail('RN-PLT-11', `${key} admite: ${(d.options || []).map(o => o[0]).join(', ')}.`); }
    else if (d.value_type === 'JSON') { if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch (e) { G.fail('RN-PLT-11', `${key} debe ser JSON válido.`); } } }
    return v;
  };
  P.setParam = function (key, raw, reason, scope = {}) {
    P.assertPerm(key.startsWith('seg_') && !P.hasPerm('plt.parameter.edit') ? 'seg.policy.edit' : 'plt.parameter.edit');
    const min = G.param('plt_parameter_reason_min_length') || 10;
    if (String(reason || '').trim().length < min) G.fail('RN-PLT-06', `Cambiar un parámetro exige un motivo de al menos ${min} caracteres.`);
    const d = P.paramDef(key);
    const sc = scope.brand ? 'BRAND' : scope.site ? 'ESTABLISHMENT' : 'TENANT';
    if (d && !d.allowed_scopes.includes(sc)) G.fail('RN-PLT-11', `${key} no admite el ámbito ${lbl(P.SCOPES, sc).toLowerCase()}.`);
    const v = P.parseParam(key, raw);
    const before = G.param(key, scope);
    if (JSON.stringify(before) === JSON.stringify(v)) G.fail('RN-PLT-11', 'El valor nuevo es igual al vigente.');
    G.setParam(key, v, reason.trim(), scope);
    const hrow = D.where('parameter_history', x => x.key === key).sort(U.by('created_at', -1))[0];
    if (hrow) D.update('parameter_history', hrow.id, { changed_by_id: G.ctx.userId(), module_code: d ? d.module_code : null }, { silent: true });
    G.events.emit('parameter.changed', { key, old: before, value: v, scope: sc });
    return v;
  };
  /** valor vigente y de qué ámbito sale (RN-PLT-12) */
  P.paramSource = function (key, scope = {}) {
    const rows = D.where('parameters', p => p.key === key && !p.voided);
    if (scope.brand && rows.find(p => p.scope === 'BRAND' && p.scope_id === scope.brand)) return 'BRAND';
    if (scope.site && rows.find(p => p.scope === 'ESTABLISHMENT' && p.scope_id === scope.site)) return 'ESTABLISHMENT';
    if (rows.find(p => p.scope === 'TENANT')) return 'TENANT';
    return 'DEFAULT';
  };
  P.fmtParam = function (key, v) {
    const d = P.paramDef(key) || {};
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (d.value_type === 'LIST') return lbl(d.options || [], v);
    if (typeof v === 'object') return JSON.stringify(v);
    if (typeof v === 'number') return F.num(v, Number.isInteger(v) ? 0 : (String(v).split('.')[1] || '').length > 3 ? 4 : (String(v).split('.')[1] || '').length) + (d.unit && d.unit !== 'S/' ? ' ' + d.unit : '');
    return String(v);
  };

  /* ---------- dominio de acceso (RN-PLT-19) ---------- */
  P.resolveHost = function (host) {
    const hn = String(host || '').trim().toLowerCase();
    const row = D.raw('tenant_hostnames').find(x => x.hostname === hn && x.status === 'ACTIVE');
    if (!row) G.fail('RN-PLT-19', `El dominio ${hn || '(vacío)'} no está registrado: no se muestra el inicio de sesión.`);
    const t = D.raw('tenants').find(x => x.id === row.tenant_ref);
    if (!t || !['ACTIVE', 'TRIAL'].includes(t.status)) G.fail('RN-PLT-19', `La empresa de ${hn} está ${t ? lbl([['SUSPENDED', 'suspendida'], ['CANCELLED', 'cerrada']], t.status) : 'dada de baja'}: no se muestra el inicio de sesión.`);
    return { tenant: t, hostname: row };
  };
  P.addHostname = function (hostname, primary) {
    P.assertPerm('plt.hostname.manage');
    const hn = String(hostname || '').trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(hn)) G.fail('RN-PLT-19', 'Escribe un dominio válido, p. ej. sistema.donguando.com.');
    if (D.raw('tenant_hostnames').find(x => x.hostname === hn)) G.fail('RN-PLT-19', `${hn} ya identifica a una empresa: cada dominio es de una sola empresa.`);
    if (primary) for (const x of D.raw('tenant_hostnames').filter(x => x.tenant_ref === G.ctx.tenant)) x.is_primary = false;
    const r = D.insert('tenant_hostnames', { tenant_ref: G.ctx.tenant, hostname: hn, is_primary: !!primary, status: 'PENDING_DNS', verify_token: 'aycha-verify=' + U.rng(hn.length * 7919)().toString(36).slice(2, 12) }, { global: true });
    return r;
  };

  /* ---------- búsqueda global (RN-PLT-16) ---------- */
  const SCREEN_RE = { CLI: /ficha/i, PED: /ficha|detalle/i, FAC: /ficha|detalle|comprobante$/i, CAT: /ficha|presentaci/i, MAE: /trabajador/i };
  function openIn(mod, params, fallback) {
    const sp = (G.SPEC[mod] || { screens: [] }).screens.find(s => SCREEN_RE[mod] && SCREEN_RE[mod].test(s[1]));
    if (sp && G.screens[sp[0]] && G.screenVisible(G.screens[sp[0]])) return G.go(sp[0], params);
    fallback();
  }
  const quick = (title, pairs) => drawer(title, bd => { bd.appendChild(dl(pairs)); }, { code: 'PLT-02' });
  const TYPES = { customer: 'Clientes', order: 'Pedidos', document: 'Comprobantes', product: 'Productos', employee: 'Trabajadores', conversation: 'Conversaciones', call: 'Llamadas', other: 'Otros' };
  P.SEARCH_TYPES = TYPES;
  P.search = function (q, opts = {}) {
    const min = G.param('plt_search_min_chars') || 3, max = opts.noLimit ? 1e9 : (G.param('plt_search_max_results') || 20);
    const qq = String(q || '').trim().toLowerCase();
    const res = { q: qq, hits: [], total: 0, min, max, tooShort: qq.length < min, byType: {} };
    if (res.tooShort) return res;
    const u = opts.user || G.scope.user() || D.find('users', x => x.role === G.ctx.role && x.status === 'ACTIVE');
    const role = u ? u.role : G.ctx.role;
    if (!P.hasPerm('plt.search.use', role)) return res;
    const ub = u && (u.brands || []).length ? u.brands : null, us = u && (u.sites || []).length ? u.sites : null;
    const bOk = b => !b || !ub || ub.includes(b), sOk = s => !s || !us || us.includes(s);
    const can = m => G.modOn(m) && /[LC]/.test(G.access(m, role));
    const hits = [];
    const has = (...xs) => xs.some(x => x && String(x).toLowerCase().includes(qq));
    if (can('CLI')) for (const c of D.all('customers')) if (has(c.full_name, c.trade_name, c.doc_number, c.phone) && (!ub || !(c.segment_brands || []).length || c.segment_brands.some(b => ub.includes(b)))) hits.push({ type: 'customer', module: 'CLI', id: c.id, title: c.trade_name || c.full_name, sub: [c.doc_type !== 'NONE' ? c.doc_type + ' ' + (c.doc_number || '') : null, c.phone, c.orders_count ? c.orders_count + ' pedidos' : null].filter(Boolean).join(' · '), at: c.last_order_at || '', go: () => openIn('CLI', { id: c.id }, () => quick(c.full_name, [['Documento', (c.doc_type || '') + ' ' + (c.doc_number || '')], ['Celular', c.phone], ['Correo', c.email], ['Tipo', c.customer_type], ['Pedidos', c.orders_count], ['Último pedido', F.date(c.last_order_at)]])) });
    if (can('PED')) {
      const names = new Map(D.all('customers').map(c => [c.id, (c.trade_name || c.full_name || '')]));
      for (const o of D.all('sales_orders')) { const n = names.get(o.customer_id) || ''; if ((has(o.number, n, o.external_ref)) && bOk(o.brand_id) && sOk(o.establishment_id)) hits.push({ type: 'order', module: 'PED', id: o.id, brand_id: o.brand_id, title: `${o.number} · ${n}`, sub: `${G.brandName(o.brand_id)} · ${G.ui.statusLabel(o.status)} · ${F.money(o.final_total ?? o.estimated_total)} · ${F.date(o.delivery_date || o.created_at)}`, at: o.created_at, go: () => openIn('PED', { id: o.id }, () => quick(o.number, [['Cliente', n], ['Marca', G.brandName(o.brand_id)], ['Local', G.siteName(o.establishment_id)], ['Canal', G.channelName(o.channel)], ['Estado', G.ui.status(o.status)], ['Total', F.money(o.final_total ?? o.estimated_total)], ['Entrega', F.date(o.delivery_date)]])) }); }
    }
    if (can('FAC')) for (const d of D.all('sales_documents')) if (has(d.full_number, d.customer_name, d.customer_doc_number) && bOk(d.brand_id) && sOk(d.establishment_id)) hits.push({ type: 'document', module: 'FAC', id: d.id, brand_id: d.brand_id, title: `${G.docTypeName(d.doc_type)} ${d.full_number}`, sub: `${d.customer_name || '—'} · ${F.money(d.total)} · ${F.date(d.issue_date)} · SUNAT ${G.ui.statusLabel(d.sunat_status)}`, at: d.issue_date, go: () => openIn('FAC', { id: d.id }, () => quick(d.full_number, [['Tipo', G.docTypeName(d.doc_type)], ['Cliente', d.customer_name], ['Documento', d.customer_doc_number], ['Marca', G.brandName(d.brand_id)], ['Total', F.money(d.total)], ['IGV', F.money(d.igv)], ['Estado SUNAT', G.ui.status(d.sunat_status)]])) });
    if (can('CAT')) for (const v of D.all('product_variants')) if (has(v.name, v.sku, v.barcode) && bOk(v.brand_id)) hits.push({ type: 'product', module: 'CAT', id: v.id, brand_id: v.brand_id, title: v.name, sub: `${v.sku} · ${G.brandName(v.brand_id)} · ${G.saleModeName(v.sale_mode)}`, at: '', go: () => openIn('CAT', { id: v.product_id, variant: v.id }, () => quick(v.name, [['SKU', v.sku], ['Código de barras', v.barcode], ['Marca', G.brandName(v.brand_id)], ['Modo de venta', G.saleModeName(v.sale_mode)], ['Estado', G.ui.status(v.status)]])) });
    if (can('MAE')) for (const e of D.all('employees')) if (has(e.full_name, e.doc_number, e.position) && sOk(e.establishment_id)) hits.push({ type: 'employee', module: 'MAE', id: e.id, title: e.full_name, sub: `${e.position} · ${G.siteName(e.establishment_id)} · DNI ${e.doc_number}`, at: '', go: () => openIn('MAE', { id: e.id }, () => quick(e.full_name, [['DNI', e.doc_number], ['Cargo', e.position], ['Local', G.siteName(e.establishment_id)], ['Ingreso', F.date(e.hire_date)], ['Estado', G.ui.status(e.status)]])) });
    // entradas que publican otros módulos (conversaciones, llamadas…)
    for (const s of D.all('search_entries')) {
      if (!can(s.module_code) || (s.permission_code && G.PERM_INFO[s.permission_code] && !P.hasPerm(s.permission_code, role))) continue;
      if (!has(s.title, s.subtitle, s.keywords) || !bOk(s.brand_id) || !sOk(s.establishment_id)) continue;
      hits.push({ type: s.entity_type in TYPES ? s.entity_type : 'other', module: s.module_code, id: s.entity_id, brand_id: s.brand_id, title: s.title, sub: s.subtitle || '', at: s.created_at, go: () => { const code = (s.url || '').replace('#', ''); if (G.screens[code]) G.go(code, { id: s.entity_id }); else quick(s.title, [['Módulo', s.module_code], ['Detalle', s.subtitle]]); } });
    }
    const starts = x => String(x.title).toLowerCase().startsWith(qq) ? 0 : 1;
    hits.sort((a, b) => starts(a) - starts(b) || String(b.at).localeCompare(String(a.at)));
    res.total = hits.length;
    // reparto justo entre tipos hasta el máximo
    const byT = U.groupBy(hits, 'type'); const out = []; let i = 0;
    while (out.length < Math.min(max, hits.length)) { let added = false; for (const t of Object.keys(TYPES)) { const arr = byT[t]; if (arr && arr[i] && out.length < max) { out.push(arr[i]); added = true; } } if (!added) break; i++; }
    res.hits = out; for (const t of Object.keys(byT)) res.byType[t] = byT[t].length;
    return res;
  };
  G.searchProviders.push(q => { const r = P.search(q); return r.hits.slice(0, 10).map(x => ({ label: x.title, sub: TYPES[x.type] + ' · ' + x.sub, go: x.go })); });

  /* ---------- asistente de configuración (PLT-14) ---------- */
  P.setupSteps = function () {
    const co = D.all('companies'); const comp = co[0] || {};
    const brands = D.where('brands', b => b.status === 'ACTIVE');
    const ests = D.where('establishments', e => e.status !== 'INACTIVE');
    const ccs = D.where('cost_centers', c => c.status === 'ACTIVE');
    const series = D.where('document_series', s => s.status === 'ACTIVE');
    const users = D.where('users', u => u.status === 'ACTIVE');
    const pms = D.where('payment_methods', p => p.status === 'ACTIVE');
    const tel = D.find('tenant_modules', m => m.module_code === 'TEL');
    const chk = (label, ok, detail) => ({ label, ok: !!ok, detail });
    const S = [
      { key: 'company', title: 'Datos de la empresa', screen: 'PLT-03', checks: [chk('Razón social y RUC válido', comp.legal_name && U.rucOk(comp.ruc), comp.ruc), chk('Régimen tributario', comp.tax_regime, comp.tax_regime), chk('Domicilio fiscal con ubigeo', comp.fiscal_address && /^\d{6}$/.test(comp.fiscal_ubigeo || ''), comp.fiscal_ubigeo), chk('Moneda y zona horaria', comp.default_currency && comp.timezone, `${comp.default_currency || '—'} · ${comp.timezone || '—'}`)] },
      { key: 'brands', title: 'Marcas y colores', screen: 'PLT-05', checks: [chk('Al menos una marca activa', brands.length, `${brands.length} activas`), chk('Pie legal de la representación impresa en todas', brands.every(b => b.legal_footer), `${brands.filter(b => b.legal_footer).length} de ${brands.length}`), chk('Nombre visible en WhatsApp en todas', brands.every(b => b.whatsapp_display_name), `${brands.filter(b => b.whatsapp_display_name).length} de ${brands.length}`), chk('Tema de la empresa con contraste suficiente', (() => { const t = P.themeFor(null); return t && P.checkTheme(t.light, t.dark).every(x => x.ok); })(), 'RN-PLT-15'), chk('Marca principal con tema propio', D.find('ui_themes', t => t.brand_id === 'br-DG' && t.status === 'ACTIVE'), 'Don Guando')] },
      { key: 'sites', title: 'Locales', screen: 'PLT-04', checks: [chk('Al menos un local activo', ests.length, `${ests.length} locales`), chk('Todos con pin en el mapa', ests.every(e => e.lat != null && e.lng != null), `${ests.filter(e => e.lat != null).length} de ${ests.length}`), chk('Código de establecimiento anexo SUNAT', ests.every(e => /^\d{4}$/.test(e.sunat_code || '')), 'D-PLT-02: por confirmar con la ficha RUC')] },
      { key: 'cc', title: 'Centros de costo', screen: 'PLT-07', checks: AREAS.map(([a, n]) => chk(n, ccs.some(c => c.area === a), `${ccs.filter(c => c.area === a).length} centros`)) },
      { key: 'series', title: 'Series', screen: 'PLT-08', checks: [chk('Factura y boleta por cada marca activa', brands.every(b => series.some(s => s.doc_type === 'INVOICE' && s.brand_id === b.id) && series.some(s => s.doc_type === 'RECEIPT' && s.brand_id === b.id)), `${brands.filter(b => series.some(s => s.doc_type === 'INVOICE' && s.brand_id === b.id)).length} de ${brands.length} marcas`), chk('Notas de crédito', series.some(s => s.doc_type === 'CREDIT_NOTE'), ''), chk('Guía de remisión por local con producción', ests.filter(e => ['PLANT', 'MIXED'].includes(e.est_type)).every(e => series.some(s => s.doc_type === 'DISPATCH_GUIDE' && s.establishment_id === e.id)), ''), chk('Ninguna serie sobre el 95 % del rango', !series.some(s => P.seriesUse(s) >= (G.param('plt_series_alert_pct') || 95)), 'RN-PLT-20')] },
      { key: 'users', title: 'Usuarios iniciales', screen: 'SEG-08', checks: [chk('Administrador del sistema con segundo factor', users.some(u => u.role === 'ADMIN_SISTEMA' && u.twofa_enabled), ''), chk('Gerencia con segundo factor', users.some(u => u.role === 'GERENTE' && u.twofa_enabled), ''), chk('Contadora', users.some(u => u.role === 'CONTADORA'), ''), chk('Vendedoras con marcas asignadas', users.filter(u => u.role === 'VENDEDORA').length && users.filter(u => u.role === 'VENDEDORA').every(u => (u.brands || []).length), `${users.filter(u => u.role === 'VENDEDORA').length} vendedoras`)] },
      { key: 'pay', title: 'Medios de pago', screen: G.screens['MAE-04'] ? 'MAE-04' : null, checks: [chk('Efectivo, Yape, Plin, tarjeta y transferencia', ['pm-CASH', 'pm-YAPE', 'pm-PLIN', 'pm-CARD', 'pm-TRANSFER'].every(id => pms.find(p => p.id === id)), `${pms.length} activos`), chk('Mercado Pago para la web', pms.find(p => p.id === 'pm-MP'), '')] },
      { key: 'mods', title: 'Módulos', screen: 'PLT-12', checks: [chk('Módulos núcleo encendidos', CORE.every(c => G.modOn(c)), ''), chk('Decisión registrada sobre TEL (incluido y apagado)', tel && tel.reason, tel ? tel.reason : ''), chk('Ningún módulo encendido sin sus dependencias', Object.keys(G.SPEC).every(c => !G.modOn(c) || P.depsOf(c).hard.every(d => G.modOn(d))), 'RN-PLT-10')] },
    ];
    for (const s of S) { s.done = s.checks.filter(c => c.ok).length; s.total = s.checks.length; s.ok = s.done === s.total; }
    const done = U.sum(S, s => s.done), total = U.sum(S, s => s.total);
    return { steps: S, done, total, pct: total ? U.round(done / total * 100, 1) : 0 };
  };

  /* ---------- seed_plataforma idempotente (CA-PLT-08) ---------- */
  const BASE_SERIES = [['INVOICE', 'F001', true], ['RECEIPT', 'B001', true], ['CREDIT_NOTE', 'FC01', true, 'INVOICE'], ['CREDIT_NOTE', 'BC01', true, 'RECEIPT'], ['DEBIT_NOTE', 'FD01', true, 'INVOICE'], ['DEBIT_NOTE', 'BD01', true, 'RECEIPT'], ['DISPATCH_GUIDE', 'T001', true], ['INTERNAL_NOTE', 'NI01', false], ['PURCHASE_ORDER', 'OC01', false], ['PRODUCTION_ORDER', 'OP01', false], ['QUOTE', 'CT01', false], ['CONSIGNMENT_NOTE', 'NC01', false], ['JOURNAL', 'AS01', false]];
  P.seedPlataforma = function (tenant, { legal_name = 'EMPRESA NUEVA SAC', ruc = U.rucCheck('2060000001') } = {}) {
    const prev = G.ctx.tenant; G.ctx.tenant = tenant;
    const ins = (t, r) => D.insert(t, r, { silent: true });
    try {
      let co = D.find('companies', () => true); if (!co) co = ins('companies', { legal_name, ruc, tax_regime: 'MYPE', status: 'ACTIVE', default_currency: 'PEN', timezone: 'America/Lima' });
      for (const [code, name] of G.ROLES) if (!D.find('roles', r => r.code === code)) ins('roles', { code, name, is_system: true, requires_mfa: MFA_ROLES.includes(code), scope_mode: ASSIGNED_ROLES.includes(code) ? 'ASSIGNED' : 'ALL', phase: ROLE_PHASE[code] ?? 0, status: 'ACTIVE' });
      for (const [t, s, el, ap] of BASE_SERIES) if (!D.find('document_series', x => x.series === s)) ins('document_series', { company_id: co.id, doc_type: t, series: s, next_number: 1, is_electronic: el, status: 'ACTIVE', applies_to: ap || null });
      [['CASH', 'Efectivo'], ['YAPE', 'Yape'], ['PLIN', 'Plin'], ['CARD', 'Tarjeta (POS)'], ['MP', 'Mercado Pago'], ['TRANSFER', 'Transferencia bancaria'], ['CREDIT', 'Crédito']].forEach(([c, n]) => { if (!D.find('payment_methods', p => p.code === c)) ins('payment_methods', { code: c, name: n, status: 'ACTIVE' }); });
      for (const [code, sp] of Object.entries(G.SPEC)) if (!D.find('tenant_modules', x => x.module_code === code)) ins('tenant_modules', { module_code: code, phase: sp.phase, enabled: code !== 'TEL', reason: code === 'TEL' ? 'Incluido y desactivado (D-PLT-05)' : 'seed_plataforma', changed_at: G.date.now(), changed_by: 'seed_plataforma' });
      for (const [key, d] of Object.entries(G.PARAM_DEFS)) if (G.SPEC[d.module] && G.SPEC[d.module].phase === 0 && !D.find('parameters', p => p.key === key && p.scope === 'TENANT')) ins('parameters', { key, scope: 'TENANT', scope_id: null, value: U.clone(d.default), reason: 'Valor por defecto (seed_plataforma)' });
      return { companies: D.all('companies').length, roles: D.where('roles', r => r.is_system).length, series: D.all('document_series').length, payment_methods: D.all('payment_methods').length, modules: D.all('tenant_modules').length, enabled: D.where('tenant_modules', m => m.enabled).length, tel: !!(D.find('tenant_modules', m => m.module_code === 'TEL') || {}).enabled, params: D.all('parameters').filter(x => { const d = G.PARAM_DEFS[x.key]; return d && G.SPEC[d.module].phase === 0; }).length /* solo los de la fase 0: SUS guarda aparte el RUC emisor de la plataforma */ };
    } finally { G.ctx.tenant = prev; }
  };
  // constantes de roles compartidas con SEG (02-mapa §5 y RN-SEG-05/13)
  const MFA_ROLES = ['ADMIN_SISTEMA', 'GERENTE', 'ADMINISTRACION', 'AUDITOR', 'SUPERVISORA_VENTAS', 'CONTADORA', 'RRHH', 'SOPORTE_PLATAFORMA'];
  const ASSIGNED_ROLES = ['VENDEDORA', 'CAJERO', 'ALMACENERO', 'PREPARADOR', 'REPARTIDOR', 'OPERARIO_PRODUCCION', 'VISITADOR_CONSIGNACION', 'CLIENTE_B2B'];
  const ROLE_PHASE = { GERENTE: 0, ADMIN_SISTEMA: 0, ADMINISTRACION: 0, AUDITOR: 0, SOPORTE_PLATAFORMA: 0, SUPERVISORA_VENTAS: 1, VENDEDORA: 1, CAJERO: 1, ALMACENERO: 1, PREPARADOR: 1, COORDINADOR_DELIVERY: 1, REPARTIDOR: 1, MARKETING: 1, JEFE_PRODUCCION: 2, OPERARIO_PRODUCCION: 2, CALIDAD: 2, COMPRAS: 2, CONTADORA: 2, PRACTICANTE_CONTABLE: 2, VISITADOR_CONSIGNACION: 3, RRHH: 3, CLIENTE_B2B: 3 };
  Object.assign(P, { MFA_ROLES, ASSIGNED_ROLES, ROLE_PHASE });

  /* ---------- semillas (orden 10) ---------- */
  G.seed(10, function seedPLT() {
    const ins = (t, r, o = {}) => D.insert(t, r, Object.assign({ silent: true }, o));
    const r = U.rng(101010);
    // catálogo global de módulos y de definiciones de parámetros
    Object.keys(G.SPEC).forEach((code, i) => { const dp = P.depsOf(code); ins('platform_modules', { id: 'pmod-' + code, code, name: G.SPEC[code].name, phase: G.SPEC[code].phase, is_core: CORE.includes(code), depends_on: dp.hard, uses: dp.soft, sort_order: i + 1 }, { global: true }); });
    for (const [key, d] of Object.entries(G.PARAM_DEFS)) ins('parameter_definitions', Object.assign({ id: 'pdef-' + key }, inferDef(key, d)), { global: true });
    // dominios de acceso
    ins('tenant_hostnames', { id: 'th-dg', tenant_ref: 'DG', hostname: 'donguando.aycha.pe', is_primary: true, status: 'ACTIVE', verified_at: '2026-09-01T10:00' }, { global: true });
    ins('tenant_hostnames', { id: 'th-dg2', tenant_ref: 'DG', hostname: 'sistema.donguando.com', is_primary: false, status: 'PENDING_DNS', verify_token: 'aycha-verify=dg7k2m9q4w' }, { global: true });
    ins('tenant_hostnames', { id: 'th-cs', tenant_ref: 'CS', hostname: 'carnesselectas.aycha.pe', is_primary: true, status: 'ACTIVE', verified_at: '2026-09-20T10:00' }, { global: true });
    // temas: empresa (tenant), Don Guando y Marca 5
    ins('ui_themes', { id: 'th-tenant', brand_id: null, name: 'Tema de la empresa', light: { primary: '#6D102B', primary_dark: '#4A0B1D', accent: '#B9781A', background: '#FBF8F0', surface: '#FFFEFB', text: '#1D1D1D', on_primary: '#FFFFFF' }, dark: { primary: '#E57F9B', primary_dark: '#922242', accent: '#FFC676', background: '#161012', surface: '#1F171A', text: '#F3E9E3', on_primary: '#2A0A14' }, font_family: 'Source Sans 3', radius_px: 8, status: 'ACTIVE', changed_by: 'Luis Ccahuana Rojas' });
    ins('ui_themes', { id: 'th-br-DG', brand_id: 'br-DG', name: 'Don Guando (donguando.com)', light: { primary: '#922242', primary_dark: '#6D102B', accent: '#FFC676', background: '#FFFCE3', surface: '#FFFEF8', text: '#1D1D1D', on_primary: '#FFFFFF' }, dark: { primary: '#E57F9B', primary_dark: '#922242', accent: '#FFC676', background: '#1A1013', surface: '#241A1D', text: '#FFFCE3', on_primary: '#2A0A14' }, font_family: 'Source Sans 3', radius_px: 8, status: 'ACTIVE', changed_by: 'Rosa Quispe Huamán' });
    ins('ui_themes', { id: 'th-br-M5', brand_id: 'br-M5', name: 'Marca 5 · Gourmet', light: { primary: '#2A6A8C', primary_dark: '#1C4A63', accent: '#C9A227', background: '#F7F5EF', surface: '#FFFFFF', text: '#1E2326', on_primary: '#FFFFFF' }, dark: { primary: '#79B8DC', primary_dark: '#2A6A8C', accent: '#E3C766', background: '#11171B', surface: '#182127', text: '#ECF1F4', on_primary: '#0E2230' }, font_family: 'Source Sans 3', radius_px: 8, status: 'ACTIVE', changed_by: 'Rosa Quispe Huamán' });
    // empresa: logo y datos agregados con A()
    const co = D.get('companies', 'co-dg'); if (co) Object.assign(co, { logo_url: 'logo-don-guando.svg', default_currency: co.default_currency || 'PEN', timezone: co.timezone || 'America/Lima' });
    // períodos: historial de apertura y cierre (ene–ago), con cierres a tiempo y tardíos
    const closeDay = [4, 5, 9, 3, 5, 12, 4, 6];
    for (const p of D.all('accounting_periods').filter(x => x.company_id === 'co-dg').sort(U.by('period'))) {
      const m = Number(p.period.slice(5, 7));
      ins('accounting_period_events', { period_id: p.id, period: p.period, action: 'OPEN', reason: 'Apertura del mes', acted_by: 'us-lccahuana', acted_by_name: 'Luis Ccahuana Rojas', acted_at: p.period + 'T00:05:00' });
      if (p.status === 'CLOSED') {
        const at = G.date.add(G.date.addMonths(p.period, 1), closeDay[m - 1] - 1) + 'T18:' + U.pad(U.int(r, 10, 55), 2) + ':00';
        if (m === 6) { const first = G.date.add(G.date.addMonths(p.period, 1), 3) + 'T17:40:00'; ins('accounting_period_events', { period_id: p.id, period: p.period, action: 'CLOSE', reason: 'Cierre mensual', acted_by: 'us-mcardenas', acted_by_name: 'CPC Marisol Cárdenas', acted_at: first }); ins('accounting_period_events', { period_id: p.id, period: p.period, action: 'REOPEN', reason: 'Nota de crédito de proveedor de empaques del 27/06 recibida tarde', acted_by: 'us-mcardenas', acted_by_name: 'CPC Marisol Cárdenas', acted_at: G.date.add(G.date.addMonths(p.period, 1), 8) + 'T10:15:00' }); }
        ins('accounting_period_events', { period_id: p.id, period: p.period, action: 'CLOSE', reason: 'Cierre mensual', acted_by: 'us-mcardenas', acted_by_name: 'CPC Marisol Cárdenas', acted_at: at });
        p.closed_at = at; p.closed_by = 'CPC Marisol Cárdenas';
      }
    }
    // centros de costo en árbol: raíz por área y los del núcleo debajo
    const roots = { PRODUCTION: ['PRD', 'Producción'], QUALITY: null, WAREHOUSE: ['ALM', 'Almacenes'], DELIVERY: null, SALES: ['VEN', 'Ventas'], MARKETING: ['MKT', 'Marketing'], ADMIN: null, FINANCE: null, HR: null };
    for (const [area, rt] of Object.entries(roots)) if (rt) ins('cost_centers', { id: 'cc-' + rt[0], company_id: 'co-dg', code: rt[0], name: rt[1], area, establishment_id: null, brand_id: null, parent_id: null, status: 'ACTIVE' });
    for (const c of D.all('cost_centers')) if (!c.parent_id && roots[c.area] && c.id !== 'cc-' + roots[c.area][0]) c.parent_id = 'cc-' + roots[c.area][0];
    ins('cost_centers', { id: 'cc-VEN-WEB', company_id: 'co-dg', code: 'VEN-WEB', name: 'Tienda web (WooCommerce)', area: 'SALES', establishment_id: 'es-L1', brand_id: 'br-DG', parent_id: 'cc-VEN-DG', status: 'ACTIVE' });
    ins('cost_centers', { id: 'cc-PROD-L2-CAL', company_id: 'co-dg', code: 'PRD-CALDOS', name: 'Línea de caldos Local 2', area: 'PRODUCTION', establishment_id: 'es-L2', brand_id: 'br-M4', parent_id: 'cc-PROD-L2', status: 'ACTIVE' });
    ins('cost_centers', { id: 'cc-FER', company_id: 'co-dg', code: 'FERIAS', name: 'Ferias y degustaciones (sin uso)', area: 'MARKETING', establishment_id: null, brand_id: null, parent_id: 'cc-MKT', status: 'INACTIVE' });
    // serie interna migrada casi al tope del rango (alerta del 95 %)
    ins('document_series', { id: 'se-NI09', company_id: 'co-dg', establishment_id: 'es-L2', brand_id: null, doc_type: 'INTERNAL_NOTE', series: 'NI09', next_number: 96000001, is_electronic: false, status: 'ACTIVE', note: 'Notas internas migradas del sistema anterior (Local 2)' });
    ins('document_series', { id: 'se-B099', company_id: 'co-dg', establishment_id: 'es-L1', brand_id: null, doc_type: 'RECEIPT', series: 'B099', next_number: 1844, is_electronic: true, status: 'INACTIVE', note: 'Boletas de la feria de agosto (desactivada)', status_reason: 'Feria terminada' });
    // historial de parámetros (valores vigentes = valor nuevo)
    const H = [['plt_series_alert_pct', 90, 95, 'Alinear el aviso de series con el estándar de la plataforma', '2026-09-03T09:20:00', 'Luis Ccahuana Rojas'], ['seg_max_concurrent_sessions', 2, 3, 'Las vendedoras usan celular y computadora a la vez', '2026-09-12T11:05:00', 'Luis Ccahuana Rojas'], ['seg_session_idle_minutes', 15, 30, 'Mostrador se desconectaba a media venta', '2026-09-18T16:40:00', 'Rosa Quispe Huamán']];
    for (const [key, old, val, reason, at, by] of H) { if (!G.PARAM_DEFS[key]) continue; ins('parameters', { key, scope: 'TENANT', scope_id: null, value: val, reason, description: G.PARAM_DEFS[key].desc, created_at: at }); ins('parameter_history', { key, scope: 'TENANT', scope_id: null, old_value: old, new_value: val, reason, changed_by: by, changed_at: at, created_at: at, module_code: G.PARAM_DEFS[key].module }); }
    // llamadas publicadas por TEL en la búsqueda (no aparecen mientras TEL esté apagado)
    ins('search_entries', { module_code: 'TEL', entity_type: 'call', entity_id: 'call-demo-1', title: 'Llamada de Rosa Huamán Ccori', subtitle: 'Entrante · 4 min · grabada · 08/10/2026', keywords: 'rosa huaman llamada', url: '#TEL-08', brand_id: 'br-DG', establishment_id: 'es-L1', permission_code: 'tel.call.view_own', created_at: '2026-10-08T10:20:00' });
    ins('search_entries', { module_code: 'TEL', entity_type: 'call', entity_id: 'call-demo-2', title: 'Llamada perdida de Rosa Medina', subtitle: 'Perdida · devolver antes de 30 min · 09/10/2026', keywords: 'rosa medina perdida', url: '#TEL-08', brand_id: 'br-M3', establishment_id: 'es-L1', permission_code: 'tel.call.view_own', created_at: '2026-10-09T17:02:00' });
    // notificaciones del armazón (campana)
    const N = [['us-rquispe', 'Setiembre pendiente de cierre', 'El período 2026-09 sigue abierto: la meta es cerrarlo hasta el día 5 (KPI-PLT-01).', 'warn', 'PLT', '#PLT-09', '2026-10-06T08:00:00'], ['us-lccahuana', 'Serie NI09 al 96 % de su rango', 'Crea otra serie interna antes de llegar al tope (RN-PLT-20).', 'warn', 'PLT', '#PLT-08', '2026-10-09T07:30:00'], ['us-rquispe', 'TEL incluido y apagado', 'La lista de activación tiene pasos pendientes. Revísala en PLT-12.', 'info', 'PLT', '#PLT-12', '2026-10-01T09:05:00'], ['us-lccahuana', 'Celular nuevo por aprobar', 'Pedro Condori Ari registró un celular nuevo para la app de reparto.', 'info', 'SEG', '#SEG-13', '2026-10-10T07:12:00'], ['us-mcardenas', 'Setiembre listo para cierre', 'Revisa SIRE y cierra el período en PLT-09.', 'info', 'PLT', '#PLT-09', '2026-10-07T09:00:00']];
    for (const [uid, title, body, tone, module, ref, at] of N) if (D.get('users', uid)) ins('notifications', { user_id: uid, title, body, ref, tone, module, read_at: null, at, created_at: at });
  }, 'PLT');

  /* ---------- indicadores ---------- */
  G.kpiCalc['KPI-PLT-01'] = ({ to }) => { const ps = D.where('accounting_periods', p => p.status === 'CLOSED' && p.period <= (to || G.TODAY)); const ok = ps.filter(p => P.closedOnTime(p) === true).length; return { value: ps.length ? U.round(ok / ps.length * 100, 1) : null, numerator: ok, denominator: ps.length }; };
  G.kpiCalc['KPI-PLT-02'] = () => { const ss = D.where('document_series', s => s.status === 'ACTIVE'); const top = ss.slice().sort((a, b) => b.next_number - a.next_number)[0]; return { value: top ? U.round(P.seriesUse(top), 2) : 0, numerator: top ? top.next_number - 1 : 0, denominator: SERIES_MAX, detail: top ? top.series : null }; };

  /* ---------- alertas ---------- */
  G.alertProviders.push(() => {
    const out = []; const pct = G.param('plt_series_alert_pct') || 95;
    const hi = D.where('document_series', s => s.status === 'ACTIVE' && P.seriesUse(s) >= pct);
    if (hi.length) out.push({ module: 'PLT', title: `${hi.length} serie(s) sobre el ${pct} % del rango`, detail: hi.map(s => `${s.series} (${F.pct(P.seriesUse(s), 1)})`).join(', ') + ' · RN-PLT-20', tone: 'warn', go: () => G.go('PLT-08') });
    const prevM = G.date.addMonths(G.TODAY, -1); const p = D.find('accounting_periods', x => x.period === prevM && x.company_id === 'co-dg');
    const due = G.date.add(G.date.month(G.TODAY), (G.param('plt_period_close_day') || 5) - 1);
    if (p && p.status !== 'CLOSED' && G.TODAY > due) out.push({ module: 'PLT', title: `${G.date.monthName(prevM)} sin cerrar`, detail: `La meta era cerrarlo hasta el ${F.date(due)} (KPI-PLT-01).`, tone: 'warn', go: () => G.go('PLT-09') });
    return out;
  });

  /* =================== PANTALLAS =================== */
  const can = perm => P.hasPerm(perm);
  const guard = (perm, fn) => () => { if (!can(perm)) { toast(`RN-SEG-12: tu rol (${G.roleName()}) no tiene el permiso ${perm}.`, 'warn'); return; } fn(); };
  const run = (fn, okMsg) => { try { const r = fn(); if (okMsg) toast(okMsg, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); return null; } };
  const swatch = c => h('span', { style: `display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid var(--line);vertical-align:-2px;margin-right:6px;background:${hexOk(c) ? c : 'transparent'}` });
  const userNameById = id => (D.get('users', id) || {}).name || id || '—';

  /* ---- PLT-01 Armazón ---- */
  function shellScreen(el) {
    const body = page(el, { code: 'PLT-01', title: 'Armazón de la aplicación', sub: 'Lo que ves alrededor de cada pantalla: barra con los colores de la marca activa, selectores de marca y local según tu alcance, campana, menú con los módulos encendidos y permitidos, modo claro/oscuro y el código de pantalla en el pie.' });
    const u = G.scope.user() || D.find('users', x => x.role === G.ctx.role && x.status === 'ACTIVE');
    const brands = G.scope.brands().filter(b => b.status === 'ACTIVE'); const sites = G.scope.sites();
    const curBrand = G.ctx.brand !== 'ALL' ? G.ctx.brand : (u && u.default_brand_id) || 'br-DG';
    const th = P.themeFor(curBrand); const t = th ? th.light : {};
    const visMods = G.moduleOrder.filter(m => G.canSee(m) && G.modOn(m) && G.modules[m].screens.some(s => !s.hidden && G.screenVisible(s)));
    const offMods = Object.keys(G.SPEC).filter(m => !G.modOn(m));
    const notes = D.where('notifications', n => u && n.user_id === u.id).sort(U.by('at', -1));
    body.appendChild(kpis([
      { label: 'Módulos en tu menú', value: visMods.length, sub: `encendidos y permitidos para ${G.roleName()}` },
      { label: 'Módulos apagados', value: offMods.length, sub: offMods.join(', ') || 'ninguno', tone: offMods.length ? 'warn' : 'ok', onClick: () => G.go('PLT-12') },
      { label: 'Marcas y locales en tu alcance', value: `${brands.length} · ${sites.length}`, sub: u && (u.brands || []).length ? 'alcance asignado (RN-SEG-13)' : 'alcance total' },
      { label: 'Notificaciones sin leer', value: notes.filter(n => !n.read_at).length, sub: `${notes.length} en total`, tone: notes.some(n => !n.read_at) ? 'warn' : '' },
    ]));
    // vista previa del armazón con la marca activa
    const prev = h('div', { style: `border:1px solid var(--line);border-radius:10px;overflow:hidden;background:${t.background || 'var(--bg)'};color:${t.text || 'var(--ink)'}` },
      h('div', { style: `display:flex;align-items:center;gap:10px;padding:10px 14px;background:${t.primary || 'var(--primary)'};color:${t.on_primary || '#fff'};flex-wrap:wrap` },
        h('span', { style: `width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-weight:800;background:${t.accent || 'var(--brand-gold)'};color:${t.primary_dark || t.primary || '#000'}` }, (D.get('brands', curBrand) || { code: 'DG' }).code),
        h('b', null, G.brandName(curBrand)), h('span', { style: 'opacity:.85;font-size:.85rem' }, '· ' + (G.ctx.site === 'ALL' ? 'Todos los locales' : G.siteName(G.ctx.site))), h('span', { style: 'margin-left:auto;font-size:.85rem;opacity:.9' }, (u ? u.name : G.ctx.userName()) + ' · ' + G.roleName())),
      h('div', { style: 'display:grid;grid-template-columns:minmax(0,150px) minmax(0,1fr);min-height:150px' },
        h('div', { style: `background:${t.primary_dark || 'var(--side)'};color:${t.on_primary || '#fff'};padding:10px;font-size:.8rem;display:grid;gap:4px;align-content:start` }, visMods.slice(0, 7).map(m => h('div', null, h('span', { class: 'mono', style: 'opacity:.7' }, m), ' ', P.modName(m))), visMods.length > 7 ? h('div', { style: 'opacity:.7' }, `+${visMods.length - 7} módulos`) : null),
        h('div', { style: `padding:12px;display:grid;gap:8px;align-content:start;background:${t.surface || 'var(--surface)'}` }, h('b', null, G.nav.current === 'PLT-01' ? 'Armazón de la aplicación' : ''), h('div', { style: 'font-size:.85rem' }, 'Contenido de la pantalla'), h('span', { style: `justify-self:start;padding:6px 12px;border-radius:6px;background:${t.primary || 'var(--primary)'};color:${t.on_primary || '#fff'};font-size:.85rem` }, 'Botón primario'))),
      h('div', { style: `display:flex;justify-content:space-between;padding:6px 14px;font-size:.75rem;border-top:1px dashed ${t.text || 'var(--line)'}33` }, h('span', { class: 'mono' }, 'PLT-01'), h('span', null, th ? (th.brand_id ? th.name : 'Tema de la empresa (la marca no tiene tema propio, RN-PLT-23)') : '')));
    const brandPills = pills([['ALL', 'Todas']].concat(brands.map(b => [b.id, b.name.split(' · ')[0]])).filter(x => x[0] !== 'ALL' || brands.length > 1), G.ctx.brand, v => { G.ctx.brand = v; G.db.save(); G.render(); });
    const sitePills = pills([['ALL', 'Todos']].concat(sites.map(e => [e.id, e.short || e.name])).filter(x => x[0] !== 'ALL' || sites.length > 1), G.ctx.site, v => { G.ctx.site = v; G.db.save(); G.render(); });
    const modePills = pills([['light', 'Claro'], ['dark', 'Oscuro'], ['system', 'Sistema']], G.ctx.theme, v => { G.ctx.theme = v; G.db.save(); G.render(); });
    body.appendChild(h('div', { class: 'grid c2' },
      card('Vista previa con la marca activa', h('div', { class: 'stack' }, prev, h('p', { class: 'small muted' }, 'Cambia la marca abajo o en la barra superior: el primario, el acento y los fondos salen de ui_themes (PLT-06). Las marcas sin tema propio usan el de la empresa.'))),
      card('Selectores y preferencias', h('div', { class: 'stack' },
        h('div', null, h('div', { class: 'small muted' }, 'Marca (solo las de tu alcance; las inactivas o separadas no aparecen, RN-PLT-14)'), brandPills),
        h('div', null, h('div', { class: 'small muted' }, 'Local'), sitePills),
        h('div', null, h('div', { class: 'small muted' }, `Modo de color · valor inicial de la empresa: ${P.fmtParam('plt_ui_default_theme_mode', G.param('plt_ui_default_theme_mode'))}`), modePills),
        dl([['Código de la pantalla', h('span', { class: 'mono' }, G.nav.current + ' (en el pie de cada pantalla)')], ['Atajo de búsqueda', h('span', null, h('span', { class: 'mono' }, '/'), ' abre la búsqueda global (PLT-02)')], ['En celular', 'El menú pasa al botón ☰ con botones grandes; la búsqueda se usa desde PLT-02']])))));
    // notificaciones
    body.appendChild(card('Notificaciones de ' + (u ? u.name : G.ctx.userName()), notes.length ? h('div', { class: 'stack' }, notes.slice(0, 8).map(n => h('div', { class: 'notice ' + (n.read_at ? '' : (n.tone || 'info')), style: 'display:flex;gap:10px;align-items:flex-start' },
      h('div', { style: 'min-width:0;flex:1' }, h('b', null, n.title), h('div', { class: 'small' }, n.body), h('div', { class: 'small muted' }, `${n.module || ''} · ${F.datetime(n.at)}${n.read_at ? ' · leída' : ''}`)),
      h('div', { class: 'row' }, refTarget(n.ref) && G.screens[refTarget(n.ref).screen] ? btn('Abrir', () => { D.update('notifications', n.id, { read_at: G.date.now() }, { silent: true }); G.go(refTarget(n.ref).screen, refTarget(n.ref).params); }, { sm: true }) : null, !n.read_at ? btn('Marcar leída', () => { D.update('notifications', n.id, { read_at: G.date.now() }, { silent: true }); G.refresh(); G.shell.updateBadges(); }, { sm: true, kind: 'ghost' }) : null)))) : G.ui.empty('No tienes notificaciones.'),
      { actions: notes.some(n => !n.read_at) ? [btn('Marcar todas como leídas', () => { for (const n of notes.filter(x => !x.read_at)) D.update('notifications', n.id, { read_at: G.date.now() }, { silent: true }); G.refresh(); }, { sm: true })] : null }));
    body.appendChild(card('Menú por fases para tu rol', table({ id: 'plt01-mods', search: false, pageSize: 50, rows: G.GROUPS.flatMap(g => g.mods.filter(m => G.SPEC[m]).map(m => ({ id: m, m, g: g.name, phase: g.phase }))),
      columns: [{ key: 'm', label: 'Módulo', render: r => h('span', null, h('span', { class: 'mono' }, r.m), ' ', P.modName(r.m)) }, { key: 'g', label: 'Grupo' }, { key: 'phase', label: 'Fase', align: 'c' },
        { key: 'on', label: 'Encendido', value: r => G.modOn(r.m) ? 'Sí' : 'No', render: r => G.modOn(r.m) ? badge('Encendido', 'ok') : badge('Apagado', 'warn') },
        { key: 'acc', label: `Acceso de ${G.roleName()}`, value: r => G.access(r.m) || 'sin acceso', render: r => G.access(r.m) ? h('span', { class: 'mono' }, G.access(r.m)) : h('span', { class: 'muted' }, 'sin acceso') },
        { key: 'menu', label: 'En el menú', value: r => G.modOn(r.m) && G.canSee(r.m) && !!G.modules[r.m] ? 'Sí' : 'No' }] })));
  }

  /* ---- PLT-02 Búsqueda global ---- */
  const SS = { q: 'rosa', as: '' };
  function searchScreen(el) {
    const body = page(el, { code: 'PLT-02', title: 'Búsqueda global', sub: `Busca desde ${G.param('plt_search_min_chars') || 3} caracteres en clientes, pedidos, comprobantes, productos, trabajadores y lo que publican los demás módulos. Respeta módulos encendidos, permisos y el alcance de marcas y locales del usuario (RN-PLT-16).` });
    const users = D.where('users', u => u.status === 'ACTIVE' && u.role !== 'CLIENTE_B2B');
    const me = G.scope.user() || D.find('users', x => x.role === G.ctx.role && x.status === 'ACTIVE');
    const asU = SS.as ? D.get('users', SS.as) : me;
    const inp = h('input', { class: 'input', type: 'search', value: SS.q, placeholder: 'Nombre, número de pedido, RUC, SKU…', attrs: { id: 'plt02-q', 'aria-label': 'Buscar' } });
    const sel = h('select', { class: 'input', attrs: { id: 'plt02-as', 'aria-label': 'Buscar como' } }, users.map(u => h('option', { value: u.id, selected: asU && u.id === asU.id }, `${u.name} · ${G.roleName(u.role)}${(u.brands || []).length ? ' · ' + u.brands.map(G.brandName).join('+') : ''}`)));
    const out = h('div', { class: 'stack' });
    function draw() {
      G.ui.clear(out);
      const r = P.search(SS.q, { user: asU });
      if (r.tooShort) { out.appendChild(notice(`Escribe al menos ${r.min} caracteres (plt_search_min_chars).`, 'info')); return; }
      out.appendChild(kpis([{ label: 'Coincidencias', value: r.total, sub: `se muestran ${r.hits.length} (máximo ${r.max})` }].concat(Object.entries(r.byType).map(([t, n]) => ({ label: TYPES[t], value: n })))));
      if (!G.modOn('TEL')) out.appendChild(notice('TEL está apagado: las llamadas publicadas por la central no aparecen en ningún resultado (CA-PLT-07).', 'info'));
      if (!r.hits.length) { out.appendChild(G.ui.empty('Sin resultados para este usuario.')); return; }
      const groups = U.groupBy(r.hits, 'type');
      for (const [t, list] of Object.entries(groups)) out.appendChild(card(`${TYPES[t]} (${r.byType[t]})`, h('div', { class: 'stack', style: 'gap:4px' }, list.map(x => h('button', { class: 'btn', style: 'justify-content:space-between;text-align:left;white-space:normal', on: { click: x.go } }, h('span', { style: 'min-width:0' }, h('b', null, x.title), h('div', { class: 'small muted' }, x.sub)), h('span', { class: 'mono muted small' }, x.module))))));
    }
    inp.addEventListener('input', () => { SS.q = inp.value; draw(); });
    sel.addEventListener('change', () => { SS.as = sel.value; draw(); });
    body.appendChild(card('Buscar', h('div', { class: 'grid c2' }, h('div', { class: 'field' }, h('label', { attrs: { for: 'plt02-q' } }, 'Texto'), inp), h('div', { class: 'field' }, h('label', { attrs: { for: 'plt02-as' } }, 'Buscar como (prueba de alcance y permisos)'), sel))));
    body.appendChild(out); draw();
    body.appendChild(card('Cómo publica cada módulo', h('div', { class: 'stack' }, h('p', { class: 'small' }, 'Al crear o cambiar un registro buscable, el módulo dueño escribe su fila en search_entries (tipo, título, subtítulo, marca, local, URL y permiso de ver) en la misma transacción. Filas publicadas hoy:'),
      table({ id: 'plt02-se', search: false, pageSize: 10, rows: D.all('search_entries'), columns: [{ key: 'module_code', label: 'Módulo', mono: true }, { key: 'entity_type', label: 'Tipo', value: r => TYPES[r.entity_type] || r.entity_type }, { key: 'title', label: 'Título' }, { key: 'brand_id', label: 'Marca', value: r => G.brandName(r.brand_id) }, { key: 'permission_code', label: 'Permiso de ver', mono: true }, { key: 'vis', label: 'Visible', value: r => G.modOn(r.module_code) ? 'Sí' : 'No (módulo apagado)' }] }))));
  }

  /* ---- PLT-03 Empresas ---- */
  const COMP_FIELDS = [{ key: 'legal_name', label: 'Razón social', required: true, span: 2 }, { key: 'trade_name', label: 'Nombre comercial' }, { key: 'ruc', label: 'RUC', required: true, help: '11 dígitos, empieza en 10, 15, 17 o 20; se valida el dígito verificador (RN-PLT-13).' },
    { key: 'tax_regime', label: 'Régimen tributario', type: 'select', required: true, options: [['MYPE', 'Régimen MYPE Tributario'], ['RER', 'Régimen Especial'], ['GENERAL', 'Régimen General'], ['NRUS', 'Nuevo RUS']] }, { key: 'fiscal_ubigeo', label: 'Ubigeo del domicilio fiscal', help: '6 dígitos INEI (150140 = Santiago de Surco).' },
    { key: 'fiscal_address', label: 'Domicilio fiscal', required: true, span: 2 }, { key: 'default_currency', label: 'Moneda', type: 'select', required: true, options: [['PEN', 'Soles (PEN)'], ['USD', 'Dólares (USD)']] }, { key: 'timezone', label: 'Zona horaria', type: 'select', required: true, options: [['America/Lima', 'America/Lima (UTC−5)']] },
    { key: 'status', label: 'Estado', type: 'select', required: true, options: [['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva']] }];
  function companyForm(c) {
    drawer(c ? c.legal_name : 'Nueva empresa', (bd, close) => {
      const rucInfo = h('div', { class: 'small' });
      const showRuc = v => { G.ui.clear(rucInfo); const s = String(v || ''); if (s.length === 11) rucInfo.appendChild(U.rucOk(s) ? badge('RUC válido (dígito verificador correcto)', 'ok') : badge(`Dígito verificador incorrecto: debería terminar en ${/^\d{10}/.test(s) ? U.rucCheck(s.slice(0, 10)).slice(-1) : '?'}`, 'bad')); };
      const fields = COMP_FIELDS.map(f => f.key === 'ruc' ? Object.assign({}, f, { onChange: showRuc }) : f);
      bd.appendChild(form({ id: 'plt03', fields, values: c || { tax_regime: 'MYPE', default_currency: 'PEN', timezone: 'America/Lima', status: 'ACTIVE' }, onCancel: close, submitLabel: c ? 'Guardar empresa' : 'Crear empresa',
        onSubmit: v => { try { P.saveCompany(v, c && c.id); } catch (e) { return e.message; } toast('Empresa guardada', 'ok'); close(); G.refresh(); return true; } }));
      bd.appendChild(rucInfo); showRuc(c && c.ruc);
    }, { code: 'PLT-03' });
  }
  function companiesScreen(el) {
    const body = page(el, { code: 'PLT-03', title: 'Empresas', sub: 'Razón social con RUC validado, régimen, domicilio fiscal, moneda y zona horaria. Cada empresa muestra sus marcas, locales y series: las 5 marcas de Don Guando facturan con el mismo RUC.', actions: [{ label: 'Nueva empresa', kind: 'primary', onClick: guard('plt.company.manage', () => companyForm(null)) }] });
    const cos = D.all('companies');
    for (const c of cos) {
      const brands = D.where('brands', b => b.company_id === c.id).sort(U.by('sort_order'));
      const ests = D.where('establishments', e => e.company_id === c.id);
      const series = D.where('document_series', s => (s.company_id || 'co-dg') === c.id);
      body.appendChild(card(c.legal_name, h('div', { class: 'stack' },
        h('div', { class: 'grid c2' }, dl([['RUC', h('span', null, h('span', { class: 'mono' }, c.ruc), ' ', U.rucOk(c.ruc) ? badge('válido', 'ok') : badge('dígito verificador incorrecto', 'bad'))], ['Nombre comercial', c.trade_name], ['Régimen', c.tax_regime === 'MYPE' ? 'Régimen MYPE Tributario' : c.tax_regime], ['Estado', stBadge(c.status || 'ACTIVE')]]),
          dl([['Domicilio fiscal', c.fiscal_address], ['Ubigeo', c.fiscal_ubigeo], ['Moneda', c.default_currency], ['Zona horaria', c.timezone + ' · se guarda en UTC']])),
        kpis([{ label: 'Marcas', value: brands.length, sub: `${brands.filter(b => b.status === 'ACTIVE').length} activas`, onClick: () => G.go('PLT-05') }, { label: 'Locales', value: ests.length, sub: ests.map(e => e.short || e.name).join(', '), onClick: () => G.go('PLT-04') }, { label: 'Series', value: series.length, sub: `${series.filter(s => s.is_electronic).length} electrónicas`, onClick: () => G.go('PLT-08') }]),
        h('div', { class: 'row' }, brands.map(b => h('span', { class: 'badge' }, swatch(b.primary_color), b.name))),
      ), { actions: [btn('Editar', guard('plt.company.manage', () => companyForm(c)), { sm: true })] }));
    }
    if (!cos.length) body.appendChild(G.ui.empty('Sin empresas: usa el asistente de configuración (PLT-14).'));
    body.appendChild(notice([h('b', null, 'Separar una marca a otro RUC '), 'se hace en SEP (fase 4); la marca queda «separada» aquí y sus documentos históricos se siguen consultando (RN-PLT-14).'], 'info'));
  }

  /* ---- PLT-04 Locales ---- */
  function estForm(e) {
    drawer(e ? e.name : 'Nuevo local', (bd, close) => {
      const vals = Object.assign({ est_type: 'STORE', status: 'ACTIVE', company_id: 'co-dg' }, e || {});
      const f = form({ id: 'plt04', values: vals, onCancel: close, submitLabel: e ? 'Guardar local' : 'Crear local',
        fields: [{ key: 'code', label: 'Código interno', required: true }, { key: 'short', label: 'Nombre corto', required: true }, { key: 'name', label: 'Nombre', required: true, span: 2 }, { key: 'est_type', label: 'Tipo', type: 'select', required: true, options: EST_TYPES },
          { key: 'sunat_code', label: 'Código anexo SUNAT', help: '4 dígitos. D-PLT-02: por confirmar con la ficha RUC.' }, { key: 'address', label: 'Dirección', required: true, span: 2 }, { key: 'ubigeo', label: 'Ubigeo' }, { key: 'status', label: 'Estado', type: 'select', required: true, options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']] },
          { key: 'lat', label: 'Latitud (pin)', type: 'number', help: 'Toca el mapa para fijar el pin.' }, { key: 'lng', label: 'Longitud (pin)', type: 'number' }, { key: 'has_counter', label: 'Tiene mostrador (POS)', type: 'checkbox' }],
        onSubmit: v => { try { P.saveEstablishment(v, e && e.id); } catch (ex) { return ex.message; } toast('Local guardado', 'ok'); close(); G.refresh(); return true; } });
      bd.appendChild(f);
      const mapBox = h('div');
      const drawMap = () => { G.ui.clear(mapBox).appendChild(G.ui.map({ height: 260, points: D.all('establishments').filter(x => x.lat != null && (!e || x.id !== e.id)).map(x => ({ lat: x.lat, lng: x.lng, label: x.code, tone: 'muted', title: x.name })), pick: vals.lat != null && vals.lat !== '' ? { lat: Number(f.api.values.lat), lng: Number(f.api.values.lng) } : null, onPick: (lat, lng) => { f.api.set('lat', U.round(lat, 5)); f.api.set('lng', U.round(lng, 5)); drawMap(); } })); };
      bd.appendChild(mapBox); drawMap();
    }, { code: 'PLT-04', wide: true });
  }
  function sitesScreen(el) {
    const body = page(el, { code: 'PLT-04', title: 'Locales', sub: 'Establecimientos anexos SUNAT con tipo, dirección y pin. Don Guando: Local 1 Surco (producción y mostrador) y Local 2 Lurín (producción). El local fija almacenes, series de guía, zonas de reparto y centros de costo.', actions: [{ label: 'Nuevo local', kind: 'primary', onClick: guard('plt.establishment.manage', () => estForm(null)) }] });
    const ests = D.all('establishments');
    const wh = U.groupBy(D.all('warehouses'), 'establishment_id'); const zs = U.groupBy(D.all('delivery_zones'), 'establishment_id');
    body.appendChild(h('div', { class: 'grid side-r' },
      table({ id: 'plt04', rows: ests, onRow: e => estForm(e), columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Local' }, { key: 'est_type', label: 'Tipo', value: e => lbl(EST_TYPES, e.est_type) }, { key: 'sunat_code', label: 'Anexo SUNAT', mono: true }, { key: 'address', label: 'Dirección' }, { key: 'pin', label: 'Pin', value: e => e.lat != null ? 'Sí' : 'No', render: e => e.lat != null ? badge('con pin', 'ok') : badge('sin pin', 'warn') }, { key: 'wh', label: 'Almacenes', align: 'r', value: e => (wh[e.id] || []).length }, { key: 'zones', label: 'Zonas', align: 'r', value: e => (zs[e.id] || []).length }, { key: 'status', label: 'Estado', render: e => stBadge(e.status || 'ACTIVE') }] }),
      card('Mapa', G.ui.map({ height: 300, points: ests.filter(e => e.lat != null).map(e => ({ lat: e.lat, lng: e.lng, label: e.code, title: e.name, tone: 'primary', onClick: () => estForm(e) })) }))));
    body.appendChild(notice([h('b', null, 'D-PLT-02 · valor provisional: '), 'los códigos de establecimiento anexo (0000 y 0001) se confirman con la ficha RUC de la contadora; hasta entonces las guías usan el domicilio fiscal.'], 'info'));
  }

  /* ---- PLT-05 Marcas ---- */
  function brandForm(b) {
    drawer(b ? b.name : 'Nueva marca', (bd, close) => {
      bd.appendChild(form({ id: 'plt05', values: Object.assign({ company_id: 'co-dg', status: 'ACTIVE', sort_order: D.all('brands').length + 1 }, b || {}), onCancel: close, submitLabel: b ? 'Guardar marca' : 'Crear marca',
        fields: [{ key: 'code', label: 'Código', required: true, disabled: !!b }, { key: 'name', label: 'Nombre', required: true }, { key: 'company_id', label: 'Empresa que factura', type: 'select', required: true, options: D.all('companies').map(c => [c.id, c.legal_name]) }, { key: 'status', label: 'Estado', type: 'select', required: true, options: [['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva'], ['SEPARATED', 'Separada (SEP)']] },
          { key: 'whatsapp_display_name', label: 'Nombre visible en WhatsApp', required: true }, { key: 'website', label: 'Web' }, { key: 'sort_order', label: 'Orden', type: 'number', min: 1 }, { key: 'logo_url', label: 'Logo (archivo)' }, { key: 'description', label: 'Qué vende', span: 2 }, { key: 'legal_footer', label: 'Pie legal de la representación impresa', type: 'textarea', required: true }],
        onSubmit: v => { try { P.saveBrand(v, b && b.id); } catch (e) { return e.message; } toast('Marca guardada', 'ok'); close(); G.refresh(); return true; } }));
      if (b) {
        const n = { orders: D.where('sales_orders', o => o.brand_id === b.id).length, docs: D.where('sales_documents', d => d.brand_id === b.id).length, prods: D.where('products', p => p.brand_id === b.id).length, wa: D.where('messaging_channels', c => c.brand_id === b.id).length };
        bd.appendChild(h('h3', null, 'Uso de la marca')); bd.appendChild(dl([['Pedidos', F.num(n.orders)], ['Comprobantes', F.num(n.docs)], ['Productos', n.prods], ['Números de WhatsApp', n.wa], ['Series propias', D.where('document_series', s => s.brand_id === b.id).map(s => s.series).join(', ')], ['Tema', P.themeFor(b.id) && P.themeFor(b.id).brand_id ? P.themeFor(b.id).name : 'Usa el tema de la empresa']]));
      }
    }, { code: 'PLT-05' });
  }
  function brandsScreen(el) {
    const body = page(el, { code: 'PLT-05', title: 'Marcas', sub: 'Las 5 marcas que facturan con el RUC de AGROPECUARIA DON GUANDO SAC: logo, pie legal del comprobante, web, nombre en WhatsApp, orden y estado. Una marca inactiva o separada no aparece en los selectores ni admite documentos nuevos (RN-PLT-14).', actions: [{ label: 'Nueva marca', kind: 'primary', onClick: guard('plt.brand.manage', () => brandForm(null)) }] });
    const bs = D.all('brands').slice().sort(U.by('sort_order'));
    const oc = U.groupBy(D.where('sales_orders', o => o.created_at >= G.date.month(G.TODAY)), 'brand_id');
    body.appendChild(table({ id: 'plt05', rows: bs, onRow: b => brandForm(b), filters: [{ key: 'status', label: 'Estado', options: [['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva'], ['SEPARATED', 'Separada']] }],
      columns: [{ key: 'sort_order', label: '#', align: 'r' }, { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Marca', render: b => h('span', null, swatch(b.primary_color), b.name) }, { key: 'company_id', label: 'Factura', value: b => (D.get('companies', b.company_id) || {}).trade_name || '—' }, { key: 'whatsapp_display_name', label: 'Nombre en WhatsApp' }, { key: 'website', label: 'Web' },
        { key: 'theme', label: 'Tema', value: b => P.themeFor(b.id) && P.themeFor(b.id).brand_id ? 'Propio' : 'De la empresa' }, { key: 'oct', label: 'Pedidos del mes', align: 'r', value: b => (oc[b.id] || []).length }, { key: 'status', label: 'Estado', render: b => stBadge(b.status) }],
      actions: b => [btn(b.status === 'ACTIVE' ? 'Desactivar' : 'Activar', guard('plt.brand.manage', () => { if (b.status === 'SEPARATED') return toast('RN-PLT-14: una marca separada no se reactiva aquí (SEP).', 'warn'); run(() => D.update('brands', b.id, { status: b.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }), 'Estado de la marca actualizado'); }), { sm: true })] }));
    body.appendChild(notice([h('b', null, 'D-PLT-01 · valor provisional: '), 'Marca 2 a Marca 5 con nombres provisionales y el tema de la empresa; la Marca 5 agrupa café, frutos secos, mermeladas e infusiones.'], 'info'));
    const test = h('div', { class: 'row' }, bs.map(b => btn(`Probar documento nuevo · ${b.code}`, () => { try { P.assertBrandActive(b.id); toast(`${b.name}: admite documentos nuevos.`, 'ok'); } catch (e) { toast(e.message, 'bad'); } }, { sm: true })));
    body.appendChild(card('assert_brand_active', test));
  }

  /* ---- PLT-06 Colores por marca ---- */
  const TS = { brand: 'br-DG' };
  function themePreview(t, brand) {
    const b = D.get('brands', brand) || {};
    return h('div', { style: `background:${t.background};color:${t.text};border:1px solid ${t.primary_dark}55;border-radius:10px;padding:12px;display:grid;gap:10px;min-width:0` },
      h('div', { style: `display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:8px;background:${t.primary};color:${t.on_primary}` }, h('b', null, b.name || 'Empresa'), h('span', { style: 'margin-left:auto;font-size:.8rem' }, 'Barra superior')),
      h('div', { class: 'row' }, h('span', { style: `padding:6px 12px;border-radius:6px;background:${t.primary};color:${t.on_primary};font-weight:600` }, 'Confirmar pedido'), h('span', { style: `padding:6px 12px;border-radius:6px;border:1px solid ${t.primary};color:${t.text}` }, 'Cancelar'), h('span', { style: `padding:3px 8px;border-radius:99px;background:${t.accent};color:${t.primary_dark};font-size:.8rem;font-weight:700` }, 'Acento')),
      h('table', { style: `width:100%;border-collapse:collapse;background:${t.surface};font-size:.85rem` }, h('tr', null, ['Pedido', 'Cliente', 'Total'].map(x => h('th', { style: `text-align:left;padding:4px 6px;color:${t.text};background:${t.surface};border-bottom:2px solid ${t.primary}` }, x))), [['P-001301', 'Rosa Q.', 'S/ 82,32'], ['P-001302', 'El Cuy Dorado', 'S/ 540,00']].map(r => h('tr', null, r.map(c => h('td', { style: `padding:4px 6px;color:${t.text};background:${t.surface};border-bottom:1px solid ${t.text}22` }, c))))),
      h('div', { style: `background:${t.surface};border:1px dashed ${t.text}44;border-radius:6px;padding:8px;font-size:.78rem;display:grid;gap:2px` }, h('b', { style: `color:${t.primary}` }, 'BOLETA ELECTRÓNICA B001-00000123'), h('span', null, 'Cuy entero beneficiado · 1,960 kg × S/ 42,00 = S/ 82,32'), h('span', { style: 'opacity:.75' }, b.legal_footer || 'Representación impresa del comprobante electrónico')));
  }
  function themesScreen(el) {
    const body = page(el, { code: 'PLT-06', title: 'Colores por marca', sub: `Tokens del modo claro y del oscuro con vista previa y el contraste calculado de cada par (WCAG). Mínimo ${F.num(G.param('plt_ui_min_contrast_ratio') || 4.5, 1)}:1 entre texto y fondo, texto y superficie, y texto sobre primario (RN-PLT-15). Una marca sin tema usa el de la empresa (RN-PLT-23).` });
    const brands = D.all('brands').slice().sort(U.by('sort_order'));
    body.appendChild(pills([['', 'Empresa (tenant)']].concat(brands.map(b => [b.id, b.name.split(' · ')[0]])), TS.brand, v => { TS.brand = v; G.refresh(); }));
    const bid = TS.brand || null;
    const own = bid ? D.find('ui_themes', t => t.brand_id === bid && t.status === 'ACTIVE') : D.find('ui_themes', t => !t.brand_id && t.status === 'ACTIVE');
    const base = own || P.themeFor(bid) || { light: {}, dark: {} };
    if (bid && !own) body.appendChild(notice(`${G.brandFull(bid)} no tiene tema propio: hoy usa el tema de la empresa (RN-PLT-23). Edita los colores y guarda para crearle uno.`, 'info'));
    const st = { light: Object.assign({}, base.light), dark: Object.assign({}, base.dark) };
    if (bid && !own) { const b = D.get('brands', bid); if (b && b.primary_color) st.light.primary = b.primary_color.toUpperCase(); }
    const checks = h('div'); const prevL = h('div'); const prevD = h('div');
    function redraw() {
      const res = P.checkTheme(st.light, st.dark);
      G.ui.clear(checks).appendChild(table({ id: 'plt06-c', search: false, rows: res.filter(x => !x.bad_hex).map((x, i) => Object.assign({ id: i }, x)), columns: [{ key: 'mode', label: 'Modo', value: x => x.mode === 'LIGHT' ? 'Claro' : 'Oscuro' }, { key: 'label', label: 'Par' }, { key: 'ratio', label: 'Contraste', align: 'r', value: x => F.num(x.ratio, 2) + ':1' }, { key: 'ok', label: 'WCAG AA', render: x => x.ok ? badge('Cumple', 'ok') : badge('No cumple', 'bad') }] }));
      G.ui.clear(prevL).appendChild(themePreview(st.light, bid)); G.ui.clear(prevD).appendChild(themePreview(st.dark, bid));
    }
    const editor = mode => h('div', { class: 'stack', style: 'gap:6px' }, P.THEME_KEYS.map(([k, n]) => {
      const txt = h('input', { class: 'input mono', value: st[mode][k] || '', style: 'width:100px', attrs: { 'aria-label': `${n} (${mode})`, maxlength: 7 } });
      const col = h('input', { type: 'color', value: hexOk(st[mode][k]) ? st[mode][k] : '#000000', style: 'width:40px;height:32px;border:0;background:none', attrs: { 'aria-label': n } });
      col.addEventListener('input', () => { st[mode][k] = col.value.toUpperCase(); txt.value = st[mode][k]; redraw(); });
      txt.addEventListener('input', () => { st[mode][k] = txt.value.trim().toUpperCase(); if (hexOk(txt.value.trim())) col.value = txt.value.trim(); redraw(); });
      return h('div', { style: 'display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;align-items:center' }, h('span', { class: 'small' }, n), col, txt);
    }));
    body.appendChild(h('div', { class: 'grid c2' }, card('Modo claro', h('div', { class: 'stack' }, editor('light'), prevL)), card('Modo oscuro', h('div', { class: 'stack' }, editor('dark'), prevD))));
    body.appendChild(card('Contraste calculado', checks, { actions: [btn('Guardar tema', guard('plt.theme.manage', () => run(() => P.saveTheme(bid, st.light, st.dark), 'Tema guardado: es el único activo de ' + (bid ? G.brandName(bid) : 'la empresa'))), { kind: 'primary', sm: true }), own && bid ? btn('Quitar tema propio', guard('plt.theme.manage', () => run(() => D.update('ui_themes', own.id, { status: 'INACTIVE' }), 'La marca vuelve al tema de la empresa')), { sm: true }) : null].filter(Boolean) }));
    redraw();
    const hist = D.where('ui_themes', t => (t.brand_id || '') === (bid || '')).sort(U.by('created_at', -1));
    body.appendChild(card('Versiones del tema', table({ id: 'plt06-h', search: false, rows: hist, columns: [{ key: 'name', label: 'Tema' }, { key: 'primary', label: 'Primario', render: t => h('span', { class: 'mono' }, swatch(t.light.primary), t.light.primary) }, { key: 'changed_by', label: 'Por' }, { key: 'created_at', label: 'Fecha', value: t => F.datetime(t.created_at) }, { key: 'status', label: 'Estado', render: t => stBadge(t.status) }] })));
  }

  /* ---- PLT-07 Centros de costo ---- */
  function ccForm(c, parent) {
    drawer(c ? `${c.code} · ${c.name}` : 'Nuevo centro de costo', (bd, close) => {
      bd.appendChild(form({ id: 'plt07', values: Object.assign({ status: 'ACTIVE', parent_id: parent ? parent.id : '', area: parent ? parent.area : 'SALES' }, c || {}), onCancel: close, submitLabel: c ? 'Guardar' : 'Crear',
        fields: [{ key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'area', label: 'Área', type: 'select', required: true, options: AREAS }, { key: 'parent_id', label: 'Depende de', type: 'select', options: D.all('cost_centers').filter(x => !c || x.id !== c.id).map(x => [x.id, `${x.code} · ${x.name}`]) },
          { key: 'establishment_id', label: 'Local (opcional)', type: 'select', options: D.all('establishments').map(e => [e.id, e.short || e.name]) }, { key: 'brand_id', label: 'Marca (opcional)', type: 'select', options: D.all('brands').map(b => [b.id, b.name]) }, { key: 'status', label: 'Estado', type: 'select', required: true, options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']] }],
        onSubmit: v => { try { P.saveCostCenter(v, c && c.id); } catch (e) { return e.message; } toast('Centro de costo guardado', 'ok'); close(); G.refresh(); return true; } }));
      if (c) { const n = D.where('expenses', x => x.cost_center_id === c.id).length; bd.appendChild(dl([['Nivel', P.ccDepth(c.id)], ['Hijos', D.where('cost_centers', x => x.parent_id === c.id).map(x => x.code).join(', ') || '—'], ['Gastos imputados (GAS)', n]])); }
    }, { code: 'PLT-07' });
  }
  function ccScreen(el) {
    const body = page(el, { code: 'PLT-07', title: 'Centros de costo', sub: `Árbol por área con local y marca opcionales, hasta ${G.param('plt_cost_center_max_depth') || 4} niveles y sin ciclos (RN-PLT-21). Todo gasto y costo se imputa a un centro de costo activo.`, actions: [{ label: 'Nuevo centro de costo', kind: 'primary', onClick: guard('plt.cost_center.manage', () => ccForm(null)) }] });
    const all = D.all('cost_centers'); const kids = U.groupBy(all.filter(c => c.parent_id), 'parent_id');
    body.appendChild(kpis([{ label: 'Centros de costo', value: all.length, sub: `${all.filter(c => c.status === 'ACTIVE').length} activos` }, { label: 'Áreas con centros', value: new Set(all.map(c => c.area)).size + ' de ' + AREAS.length }, { label: 'Nivel máximo', value: Math.max(...all.map(c => P.ccDepth(c.id))), sub: `límite ${G.param('plt_cost_center_max_depth') || 4}` }, { label: 'Por marca', value: all.filter(c => c.brand_id).length, sub: 'ventas y marketing de cada marca' }]));
    const tree = h('div', { class: 'grid c3' });
    for (const [area, an] of AREAS) {
      const roots = all.filter(c => c.area === area && (!c.parent_id || !D.get('cost_centers', c.parent_id)));
      const node = (c, lvl) => [h('div', { style: `display:flex;gap:6px;align-items:center;padding:3px 0 3px ${lvl * 16}px;${c.status !== 'ACTIVE' ? 'opacity:.55' : ''}` },
        h('button', { class: 'linklike', style: 'text-align:left', on: { click: () => ccForm(c) } }, h('span', { class: 'mono small' }, c.code), ' ', c.name),
        c.establishment_id ? badge(G.siteName(c.establishment_id), 'info') : null, c.brand_id ? badge(G.brandName(c.brand_id), 'primary') : null, c.status !== 'ACTIVE' ? badge('inactivo') : null,
        lvl < (G.param('plt_cost_center_max_depth') || 4) - 1 ? h('button', { class: 'linklike small', title: 'Agregar hijo', on: { click: guard('plt.cost_center.manage', () => ccForm(null, c)) } }, '+ hijo') : null),
        ...(kids[c.id] || []).sort(U.by('code')).flatMap(k => node(k, lvl + 1))];
      tree.appendChild(card(an, roots.length ? h('div', null, roots.sort(U.by('code')).flatMap(r => node(r, 0))) : G.ui.empty('Sin centros en esta área.')));
    }
    body.appendChild(tree);
    body.appendChild(table({ id: 'plt07-t', rows: all, onRow: c => ccForm(c), filters: [{ key: 'area', label: 'Área', options: AREAS }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']] }],
      columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Nombre' }, { key: 'area', label: 'Área', value: c => lbl(AREAS, c.area) }, { key: 'parent', label: 'Depende de', value: c => c.parent_id ? (D.get('cost_centers', c.parent_id) || {}).code : '—' }, { key: 'lvl', label: 'Nivel', align: 'r', value: c => P.ccDepth(c.id) }, { key: 'est', label: 'Local', value: c => c.establishment_id ? G.siteName(c.establishment_id) : '—' }, { key: 'br', label: 'Marca', value: c => c.brand_id ? G.brandName(c.brand_id) : '—' }, { key: 'status', label: 'Estado', render: c => stBadge(c.status) }],
      actions: c => [btn(c.status === 'ACTIVE' ? 'Desactivar' : 'Activar', guard('plt.cost_center.manage', () => run(() => D.update('cost_centers', c.id, { status: c.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }), 'Estado actualizado')), { sm: true })] }));
  }

  /* ---- PLT-08 Series ---- */
  function seriesForm() {
    drawer('Nueva serie', (bd, close) => {
      const hint = h('div', { class: 'small' });
      const f = form({ id: 'plt08', values: { doc_type: 'RECEIPT', is_electronic: true, next_number: 1, establishment_id: 'es-L1' }, onCancel: close, submitLabel: 'Crear serie',
        fields: [{ key: 'doc_type', label: 'Tipo de documento', type: 'select', required: true, options: DOC_SERIES.map(d => [d[0], d[1]]), onChange: (v, vals) => { vals.is_electronic = !!(DOC_SERIES.find(d => d[0] === v) || [])[2]; f.api.set('is_electronic', vals.is_electronic); chk(); } },
          { key: 'series', label: 'Serie', required: true, onChange: () => chk(), help: 'Factura F001, boleta B001, notas FC01/BC01, guía T001; internas de 2 a 4 caracteres (RN-PLT-04).' }, { key: 'is_electronic', label: 'Electrónica (se envía al OSE/PSE)', type: 'checkbox', onChange: () => chk() },
          { key: 'establishment_id', label: 'Local', type: 'select', options: D.all('establishments').map(e => [e.id, e.short || e.name]) }, { key: 'brand_id', label: 'Marca (opcional, D-PLT-03)', type: 'select', options: D.all('brands').map(b => [b.id, b.name]) }, { key: 'next_number', label: 'Correlativo siguiente', type: 'number', min: 1, max: SERIES_MAX }, { key: 'note', label: 'Nota', span: 2 }],
        onSubmit: v => { try { P.saveSeries(v); } catch (e) { return e.message; } toast('Serie creada', 'ok'); close(); G.refresh(); return true; } });
      function chk() { const v = f.api.values; G.ui.clear(hint); if (!v.series) return; const e = P.validSeriesCode(String(v.series).toUpperCase(), v.doc_type, !!v.is_electronic); hint.appendChild(e ? badge(e, 'bad') : badge('Formato correcto', 'ok')); }
      bd.append(f, hint);
    }, { code: 'PLT-08' });
  }
  function seriesScreen(el) {
    const pct = G.param('plt_series_alert_pct') || 95;
    const body = page(el, { code: 'PLT-08', title: 'Series y numeración', sub: `Series por empresa, tipo, local y marca. El correlativo se asigna al emitir, en la misma transacción: si la emisión falla el número no se consume (RN-PLT-03). Aviso al ${pct} % del rango de 99 999 999 (RN-PLT-20).`, actions: [{ label: 'Nueva serie', kind: 'primary', onClick: guard('plt.series.manage', seriesForm) }] });
    const ss = D.all('document_series');
    const k2 = G.kpi('KPI-PLT-02') || {};
    body.appendChild(kpis([{ label: 'Series', value: ss.length, sub: `${ss.filter(s => s.status === 'ACTIVE').length} activas · ${ss.filter(s => s.is_electronic).length} electrónicas` }, { label: 'KPI-PLT-02 · serie más cargada', value: F.pct(k2.value, 2), sub: k2.detail || '', tone: k2.value >= pct ? 'bad' : 'ok' }, { label: 'Sobre el aviso', value: ss.filter(s => s.status === 'ACTIVE' && P.seriesUse(s) >= pct).length, tone: ss.some(s => s.status === 'ACTIVE' && P.seriesUse(s) >= pct) ? 'warn' : 'ok' }, { label: 'Documentos numerados', value: F.num(U.sum(ss, s => s.next_number - 1 > 90000000 ? 0 : s.next_number - 1)), sub: 'sin contar series migradas' }]));
    body.appendChild(table({ id: 'plt08', rows: ss, pageSize: 40, filters: [{ key: 'doc_type', label: 'Tipo', options: DOC_SERIES.map(d => [d[0], d[1]]) }, { key: 'brand_id', label: 'Marca', options: D.all('brands').map(b => [b.id, b.name.split(' · ')[0]]) }, { key: 'establishment_id', label: 'Local', options: D.all('establishments').map(e => [e.id, e.short]) }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva']] }],
      onRow: s => drawer(`Serie ${s.series}`, bd => { bd.appendChild(dl([['Tipo', lbl(DOC_SERIES, s.doc_type)], ['Electrónica', s.is_electronic ? 'Sí' : 'No'], ['Local', G.siteName(s.establishment_id)], ['Marca', s.brand_id ? G.brandName(s.brand_id) : 'Todas'], ['Siguiente', F.num(s.next_number)], ['Uso del rango', F.pct(P.seriesUse(s), 4)], ['Estado', stBadge(s.status)], ['Nota', s.note || s.status_reason]])); const docs = D.where('sales_documents', d => d.series === s.series).sort(U.by('number', -1)).slice(0, 8); if (docs.length) { bd.appendChild(h('h3', null, 'Últimos números emitidos')); bd.appendChild(dl(docs.map(d => [d.full_number, `${d.customer_name || '—'} · ${F.money(d.total)} · ${F.date(d.issue_date)}`]))); } }, { code: 'PLT-08' }),
      columns: [{ key: 'series', label: 'Serie', mono: true }, { key: 'doc_type', label: 'Tipo', value: s => lbl(DOC_SERIES, s.doc_type) }, { key: 'el', label: 'Electrónica', value: s => s.is_electronic ? 'Sí' : 'Interna' }, { key: 'establishment_id', label: 'Local', value: s => s.establishment_id ? G.siteName(s.establishment_id) : 'Empresa' }, { key: 'brand_id', label: 'Marca', value: s => s.brand_id ? G.brandName(s.brand_id) : 'Todas' },
        { key: 'next_number', label: 'Siguiente', align: 'r', value: s => s.next_number, render: s => F.num(s.next_number) }, { key: 'use', label: 'Uso del rango', align: 'r', value: s => P.seriesUse(s), render: s => { const u = P.seriesUse(s); return h('div', { style: 'min-width:110px' }, h('div', { class: 'small' }, F.pct(u, u < 0.01 ? 4 : 1)), progress(Math.max(u, 0.5), u >= pct ? 'bad' : '')); } },
        { key: 'status', label: 'Estado', render: s => stBadge(s.status) }],
      actions: s => [btn(s.status === 'ACTIVE' ? 'Desactivar' : 'Activar', guard('plt.series.manage', () => G.ui.modal(`${s.status === 'ACTIVE' ? 'Desactivar' : 'Activar'} serie ${s.series}`, bd => { bd.appendChild(h('p', null, s.status === 'ACTIVE' ? 'Una serie inactiva no numera (RN-PLT-03).' : 'La serie vuelve a numerar desde ' + F.num(s.next_number) + '.')); bd.appendChild(h('textarea', { class: 'input', attrs: { id: 'plt08-reason', placeholder: 'Motivo' } })); }, [{ label: 'Cancelar' }, { label: 'Confirmar', kind: 'primary', onClick: () => { const r = document.getElementById('plt08-reason').value; return run(() => P.setSeriesStatus(s.id, s.status !== 'ACTIVE', r), 'Serie actualizada') ? undefined : false; } }])), { sm: true })] }));
    // prueba de numeración sin saltos
    const out = h('div', { class: 'small' });
    body.appendChild(card('Prueba de numeración sin saltos (CA-PLT-02)', h('div', { class: 'stack' }, h('p', { class: 'small' }, 'Simula 10 emisiones en la serie de boletas B002 donde la 5.ª falla a mitad (rechazo de la validación previa): el número no se consume y la siguiente emisión lo usa.'),
      btn('Simular 10 emisiones en B002', guard('plt.series.manage', () => { const got = []; for (let i = 1; i <= 10; i++) { try { got.push(P.issueNumbered('B002', n => { if (i === 5) throw new Error('falla simulada'); return n.number; })); } catch (e) { got.push('falla'); } } G.ui.clear(out).appendChild(h('div', null, 'Números asignados: ', h('span', { class: 'mono' }, got.join(', ')), ' · ', got.filter(x => x !== 'falla').every((x, i, a) => !i || x === a[i - 1] + 1) ? badge('sin saltos ni duplicados', 'ok') : badge('hay saltos', 'bad'))); toast('Simulación hecha: revisa el correlativo de B002', 'ok'); }), { sm: true }), out)));
  }

  /* ---- PLT-09 Períodos ---- */
  function periodsScreen(el) {
    const body = page(el, { code: 'PLT-09', title: 'Períodos', sub: 'Meses por empresa con su estado. Un mes cerrado no admite documentos con esa fecha (RN-PLT-05); se cierran en orden (RN-PLT-17) y reabrir exige permiso, motivo y que no haya meses posteriores cerrados (RN-PLT-18).' });
    const ps = D.where('accounting_periods', p => (p.company_id || 'co-dg') === 'co-dg').sort(U.by('period'));
    const k1 = G.kpi('KPI-PLT-01') || {};
    const due = G.date.add(G.date.month(G.TODAY), (G.param('plt_period_close_day') || 5) - 1);
    const prevM = G.date.addMonths(G.TODAY, -1);
    body.appendChild(kpis([{ label: 'Cerrados', value: ps.filter(p => p.status === 'CLOSED').length, sub: `de ${ps.length} meses de 2026` }, { label: 'KPI-PLT-01 · cerrados a tiempo', value: F.pct(k1.value, 0), sub: `${k1.numerator ?? 0} de ${k1.denominator ?? 0} hasta el día ${G.param('plt_period_close_day') || 5} del mes siguiente`, tone: k1.value >= 100 ? 'ok' : 'warn' },
      { label: 'Pendiente de cierre', value: G.date.monthName(prevM), sub: G.TODAY > due ? `vencido: la meta era el ${F.date(due)}` : `meta: ${F.date(due)}`, tone: G.TODAY > due ? 'warn' : '' }, { label: 'CNT', value: G.modOn('CNT') ? 'Encendido' : 'Apagado', sub: 'con CNT encendido el cierre contable usa este mismo período' }]));
    const cal = h('div', { class: 'grid c4' });
    for (const p of ps) {
      const ev = P.periodEvents(p.id); const ontime = P.closedOnTime(p); const pending = p.status !== 'CLOSED' && p.period < G.date.month(G.TODAY);
      cal.appendChild(h('div', { class: 'card', style: 'padding:12px;display:grid;gap:6px' },
        h('div', { class: 'row between' }, h('b', null, G.date.monthName(p.period)), stBadge(p.status)),
        h('div', { class: 'small muted' }, p.status === 'CLOSED' ? `Cerrado ${F.date(p.closed_at)} · ${p.closed_by || ''}` : pending ? 'Pendiente de cierre' : 'Mes en curso'),
        ontime === false ? badge('cerrado fuera de plazo', 'warn') : ontime ? badge('a tiempo', 'ok') : null, ev.some(e => e.action === 'REOPEN') ? badge(`${ev.filter(e => e.action === 'REOPEN').length} reapertura(s)`, 'info') : null,
        h('div', { class: 'row' }, p.status !== 'CLOSED' ? btn('Cerrar', () => closeDlg(p), { sm: true, kind: 'primary', disabled: !pending }) : btn('Reabrir', () => reopenDlg(p), { sm: true }), btn('Historial', () => histDlg(p), { sm: true, kind: 'ghost' }))));
    }
    body.appendChild(card('Calendario 2026 · ' + ((D.get('companies', 'co-dg') || {}).legal_name || ''), cal));
    // prueba de escritura
    const out = h('div');
    const di = h('input', { class: 'input', type: 'date', value: '2026-09-30', attrs: { id: 'plt09-d', 'aria-label': 'Fecha del documento' } });
    body.appendChild(card('Probar el bloqueo de escritura (assert_period_open)', h('div', { class: 'stack' }, h('div', { class: 'row' }, di, btn('Registrar documento con esta fecha', () => { G.ui.clear(out); try { G.period.assertOpen(di.value); out.appendChild(notice(`Período abierto: se puede registrar un documento del ${F.date(di.value)}.`, 'ok')); } catch (e) { out.appendChild(notice(e.message, 'bad')); } }, { sm: true })), out)));
    const evs = D.all('accounting_period_events').sort(U.by('acted_at', -1));
    body.appendChild(card('Historial de todos los períodos', table({ id: 'plt09-ev', rows: evs, filters: [{ key: 'action', label: 'Acción', options: [['OPEN', 'Apertura'], ['CLOSE', 'Cierre'], ['REOPEN', 'Reapertura']] }], columns: [{ key: 'period', label: 'Período', value: e => G.date.monthName(e.period) }, { key: 'action', label: 'Acción', render: e => badge({ OPEN: 'Apertura', CLOSE: 'Cierre', REOPEN: 'Reapertura' }[e.action], e.action === 'REOPEN' ? 'warn' : e.action === 'CLOSE' ? 'info' : '') }, { key: 'acted_by_name', label: 'Por' }, { key: 'acted_at', label: 'Fecha', value: e => e.acted_at, render: e => F.datetime(e.acted_at) }, { key: 'reason', label: 'Motivo' }] })));
  }
  function closeDlg(p) {
    if (!can('plt.period.close')) return toast(`RN-SEG-12: 403 · tu rol (${G.roleName()}) no tiene el permiso plt.period.close.`, 'warn');
    G.ui.modal(`Cerrar ${G.date.monthName(p.period)}`, bd => { bd.appendChild(h('p', null, 'Al cerrar, ningún módulo podrá registrar documentos con fecha de este mes (RN-PLT-05). Se emite period.closed.')); bd.appendChild(h('textarea', { class: 'input', attrs: { id: 'plt09-cr', placeholder: 'Nota del cierre (opcional)' } })); },
      [{ label: 'Cancelar' }, { label: 'Cerrar período', kind: 'primary', onClick: () => run(() => P.closePeriod(p.id, document.getElementById('plt09-cr').value || 'Cierre mensual'), `${G.date.monthName(p.period)} cerrado`) ? undefined : false }]);
  }
  function reopenDlg(p) {
    if (!can('plt.period.reopen')) return toast(`RN-SEG-12: 403 · tu rol (${G.roleName()}) no tiene el permiso plt.period.reopen.`, 'warn');
    G.ui.modal(`Reabrir ${G.date.monthName(p.period)}`, bd => { bd.appendChild(h('p', null, `Escribe el motivo (mínimo ${G.param('plt_parameter_reason_min_length') || 10} caracteres). Queda en el historial y se emite period.reopened.`)); bd.appendChild(h('textarea', { class: 'input', attrs: { id: 'plt09-rr', placeholder: 'Ej.: Factura de proveedor del 28/09 sin registrar' } })); },
      [{ label: 'Cancelar' }, { label: 'Reabrir', kind: 'danger', onClick: () => run(() => P.reopenPeriod(p.id, document.getElementById('plt09-rr').value), `${G.date.monthName(p.period)} reabierto`) ? undefined : false }]);
  }
  function histDlg(p) { drawer(`Historial · ${G.date.monthName(p.period)}`, bd => { bd.appendChild(dl([['Estado', stBadge(p.status)], ['Cerrado', p.closed_at ? F.datetime(p.closed_at) + ' · ' + (p.closed_by || '') : '—'], ['A tiempo', P.closedOnTime(p) == null ? '—' : P.closedOnTime(p) ? 'Sí' : 'No']])); bd.appendChild(h('div', { class: 'timeline' }, P.periodEvents(p.id).map(e => h('div', { class: 'tl-item' }, h('b', null, { OPEN: 'Apertura', CLOSE: 'Cierre', REOPEN: 'Reapertura' }[e.action]), h('div', { class: 'small muted' }, `${F.datetime(e.acted_at)} · ${e.acted_by_name || userNameById(e.acted_by)}`), e.reason ? h('div', { class: 'small' }, e.reason) : null)))); }, { code: 'PLT-09' }); }

  /* ---- PLT-10 Parámetros ---- */
  const PS = { mod: 'PLT' };
  function paramEditor(key) {
    const d = P.paramDef(key);
    drawer(key, (bd, close) => {
      const cur = G.param(key);
      bd.appendChild(dl([['Módulo', d.module_code + ' · ' + P.modName(d.module_code)], ['Descripción', d.description], ['Tipo', d.value_type], ['Rango', d.min_value != null || d.max_value != null ? `${d.min_value ?? '—'} a ${d.max_value ?? '—'}${d.unit ? ' ' + d.unit : ''}` : '—'], ['Ámbitos permitidos', d.allowed_scopes.map(s => lbl(P.SCOPES, s)).join(', ')], ['Valor vigente (empresa)', P.fmtParam(key, cur)], ['Por defecto', P.fmtParam(key, d.default_value)], ['Sale de', lbl([['TENANT', 'la empresa'], ['DEFAULT', 'el valor por defecto']], P.paramSource(key))]]));
      const scopeOpts = d.allowed_scopes.map(s => [s, lbl(P.SCOPES, s)]);
      const vf = d.value_type === 'BOOL' ? { key: 'value', label: 'Nuevo valor', type: 'select', required: true, options: [['true', 'Sí'], ['false', 'No']] } : d.value_type === 'LIST' ? { key: 'value', label: 'Nuevo valor', type: 'select', required: true, options: d.options } : d.value_type === 'JSON' ? { key: 'value', label: 'Nuevo valor (JSON)', type: 'textarea', required: true } : { key: 'value', label: 'Nuevo valor' + (d.unit ? ` (${d.unit})` : ''), type: d.value_type === 'TEXT' || d.value_type === 'TIME' ? 'text' : 'text', required: true, placeholder: d.value_type === 'TIME' ? 'HH:MM' : '' };
      bd.appendChild(form({ id: 'plt10', values: { value: d.value_type === 'JSON' ? JSON.stringify(cur) : d.value_type === 'BOOL' ? String(!!cur) : (cur ?? ''), scope: 'TENANT' }, onCancel: close, submitLabel: 'Guardar cambio',
        fields: [vf, scopeOpts.length > 1 ? { key: 'scope', label: 'Ámbito', type: 'select', required: true, options: scopeOpts } : null, { key: 'scope_id', label: 'Local o marca', type: 'select', options: D.all('establishments').map(e => [e.id, 'Local · ' + (e.short || e.name)]).concat(D.all('brands').map(b => [b.id, 'Marca · ' + b.name])), hidden: scopeOpts.length < 2 }, { key: 'reason', label: 'Motivo (obligatorio)', type: 'textarea', required: true, help: `Mínimo ${G.param('plt_parameter_reason_min_length') || 10} caracteres (RN-PLT-06).` }].filter(Boolean),
        onSubmit: v => { const sc = v.scope === 'BRAND' ? { brand: v.scope_id } : v.scope === 'ESTABLISHMENT' ? { site: v.scope_id } : {}; if (v.scope && v.scope !== 'TENANT' && !v.scope_id) return { scope_id: 'Elige el local o la marca.' }; if ((v.scope === 'BRAND' && !String(v.scope_id).startsWith('br-')) || (v.scope === 'ESTABLISHMENT' && !String(v.scope_id).startsWith('es-'))) return { scope_id: 'El ámbito no coincide con lo elegido.' }; try { P.setParam(key, d.value_type === 'BOOL' ? v.value === 'true' : v.value, v.reason, sc); } catch (e) { return e.message; } toast('Parámetro actualizado y registrado en el historial', 'ok'); close(); G.refresh(); return true; } }));
      const over = D.where('parameters', p => p.key === key && p.scope !== 'TENANT');
      if (over.length) { bd.appendChild(h('h3', null, 'Valores por local o marca (ganan al de la empresa, RN-PLT-12)')); bd.appendChild(dl(over.map(p => [p.scope === 'BRAND' ? G.brandName(p.scope_id) : G.siteName(p.scope_id), P.fmtParam(key, p.value)]))); }
      const hist = D.where('parameter_history', x => x.key === key).sort(U.by('changed_at', -1));
      bd.appendChild(h('h3', null, 'Historial')); bd.appendChild(hist.length ? h('div', { class: 'timeline' }, hist.map(x => h('div', { class: 'tl-item' }, h('b', null, `${P.fmtParam(key, x.old_value)} → ${P.fmtParam(key, x.new_value)}`), h('div', { class: 'small muted' }, `${F.datetime(x.changed_at)} · ${x.changed_by}${x.scope !== 'TENANT' ? ' · ' + (x.scope === 'BRAND' ? G.brandName(x.scope_id) : G.siteName(x.scope_id)) : ''}`), h('div', { class: 'small' }, x.reason)))) : G.ui.empty('Sin cambios: rige el valor por defecto.'));
    }, { code: 'PLT-10' });
  }
  P.paramEditor = paramEditor;
  /* la referencia de una notificación puede ser «#PED-01» o {screen, params} (INT) */
  function refTarget(ref) { if (!ref) return null; if (typeof ref === 'string') return { screen: ref.replace('#', ''), params: undefined }; if (typeof ref === 'object' && ref.screen) return { screen: ref.screen, params: ref.params }; return null; }
  function paramsScreen(el) {
    const body = page(el, { code: 'PLT-10', title: 'Parámetros', sub: 'Valor vigente, ámbito, unidad, rango y descripción de cada parámetro, agrupados por módulo. Se resuelve de lo más específico a lo general: marca, local, empresa y valor por defecto (RN-PLT-12). Editar exige motivo (RN-PLT-06) y se valida contra la definición (RN-PLT-11).' });
    const defs = D.all('parameter_definitions').length ? D.all('parameter_definitions') : Object.keys(G.PARAM_DEFS).map(P.paramDef);
    const byMod = U.groupBy(defs, 'module_code');
    const mods = Object.keys(byMod).sort((a, b) => (G.SPEC[a].phase - G.SPEC[b].phase) || a.localeCompare(b));
    const changed = new Set(D.where('parameters', p => !p.voided).map(p => p.key));
    body.appendChild(kpis([{ label: 'Parámetros', value: defs.length, sub: `${mods.length} módulos` }, { label: 'Con valor propio', value: changed.size, sub: 'distintos del valor por defecto o fijados' }, { label: 'Cambios registrados', value: D.all('parameter_history').length, onClick: () => G.go('PLT-11') }, { label: 'Del módulo elegido', value: (byMod[PS.mod] || []).length, sub: PS.mod + ' · ' + P.modName(PS.mod) }]));
    const sel = h('select', { class: 'input', attrs: { id: 'plt10-mod', 'aria-label': 'Módulo' } }, mods.map(m => h('option', { value: m, selected: m === PS.mod }, `F${G.SPEC[m].phase} · ${m} · ${P.modName(m)} (${byMod[m].length})${G.modOn(m) ? '' : ' · apagado'}`)));
    sel.addEventListener('change', () => { PS.mod = sel.value; G.refresh(); });
    body.appendChild(h('div', { class: 'row' }, h('label', { attrs: { for: 'plt10-mod' }, class: 'small muted' }, 'Módulo'), sel));
    body.appendChild(table({ id: 'plt10-' + PS.mod, rows: (byMod[PS.mod] || []).map(d => Object.assign({ id: d.key }, d)), pageSize: 50, onRow: d => paramEditor(d.key),
      columns: [{ key: 'key', label: 'Clave', mono: true }, { key: 'description', label: 'Para qué' }, { key: 'val', label: 'Valor vigente', value: d => P.fmtParam(d.key, G.param(d.key)), render: d => h('b', null, P.fmtParam(d.key, G.param(d.key))) }, { key: 'src', label: 'Ámbito', value: d => lbl([['TENANT', 'Empresa'], ['DEFAULT', 'Por defecto'], ['BRAND', 'Marca'], ['ESTABLISHMENT', 'Local']], P.paramSource(d.key)) },
        { key: 'unit', label: 'Unidad' }, { key: 'range', label: 'Rango', value: d => d.min_value != null || d.max_value != null ? `${d.min_value ?? '—'} – ${d.max_value ?? '—'}` : '—' }, { key: 'value_type', label: 'Tipo' }, { key: 'def', label: 'Por defecto', value: d => P.fmtParam(d.key, d.default_value) }] }));
  }

  /* ---- PLT-11 Historial de parámetros ---- */
  function paramHistScreen(el) {
    const body = page(el, { code: 'PLT-11', title: 'Historial de parámetros', sub: 'Quién cambió qué parámetro, cuándo, el valor anterior y el nuevo, y el motivo. Es de solo inserción; los cálculos ya hechos no se recalculan (RN-PLT-06).' });
    const rows = D.all('parameter_history').map(x => Object.assign({ module_code: (P.paramDef(x.key) || {}).module_code || x.module_code }, x)).sort(U.by('changed_at', -1));
    body.appendChild(kpis([{ label: 'Cambios', value: rows.length }, { label: 'Parámetros distintos', value: new Set(rows.map(r => r.key)).size }, { label: 'Usuarios', value: new Set(rows.map(r => r.changed_by)).size }, { label: 'Último cambio', value: rows[0] ? F.date(rows[0].changed_at) : '—', sub: rows[0] ? rows[0].key : '' }]));
    body.appendChild(table({ id: 'plt11', rows, onRow: r => paramEditor(r.key), filters: [{ key: 'module_code', label: 'Módulo', options: [...new Set(rows.map(r => r.module_code))].map(m => [m, m]) }, { key: 'key', label: 'Clave', options: [...new Set(rows.map(r => r.key))].map(k => [k, k]) }, { key: 'changed_by', label: 'Usuario', options: [...new Set(rows.map(r => r.changed_by))].map(u => [u, u]) }],
      columns: [{ key: 'changed_at', label: 'Fecha', render: r => F.datetime(r.changed_at) }, { key: 'module_code', label: 'Módulo', mono: true }, { key: 'key', label: 'Clave', mono: true }, { key: 'scope', label: 'Ámbito', value: r => r.scope === 'TENANT' ? 'Empresa' : r.scope === 'BRAND' ? 'Marca · ' + G.brandName(r.scope_id) : 'Local · ' + G.siteName(r.scope_id) }, { key: 'old', label: 'Anterior', value: r => P.fmtParam(r.key, r.old_value) }, { key: 'new', label: 'Nuevo', value: r => P.fmtParam(r.key, r.new_value), render: r => h('b', null, P.fmtParam(r.key, r.new_value)) }, { key: 'changed_by', label: 'Usuario' }, { key: 'reason', label: 'Motivo' }] }));
  }

  /* ---- PLT-12 Módulos activables ---- */
  function toggleDlg(code, on) {
    if (!can('plt.module.toggle')) return toast(`RN-SEG-12: tu rol (${G.roleName()}) no tiene el permiso plt.module.toggle.`, 'warn');
    const err = P.checkToggle(code, on); if (err) return toast(err, 'bad');
    const deps = P.depsOf(code);
    G.ui.modal(`${on ? 'Encender' : 'Apagar'} ${code} · ${P.modName(code)}`, bd => {
      bd.appendChild(h('p', null, on ? `Se muestran sus pantallas, botones e indicadores y su API deja de responder 403. Necesita: ${deps.hard.join(', ') || 'solo el núcleo'}.` : `Se ocultan sus pantallas, botones e indicadores; la API responde 403 RN-PLT-07 y sus permisos no se conceden. Lo registrado se conserva.`));
      if (deps.soft.length) bd.appendChild(h('p', { class: 'small muted' }, `Usa también, si están encendidos: ${deps.soft.join(', ')}.`));
      bd.appendChild(h('textarea', { class: 'input', attrs: { id: 'plt12-r', placeholder: 'Motivo del cambio (obligatorio)' } }));
    }, [{ label: 'Cancelar' }, { label: on ? 'Encender' : 'Apagar', kind: on ? 'primary' : 'danger', onClick: () => { const r = run(() => P.toggleModule(code, on, document.getElementById('plt12-r').value), `${code} ${on ? 'encendido' : 'apagado'}`); if (r) G.render(); return r ? undefined : false; } }]);
  }
  function telCard() {
    const steps = P.telChecklist(); const on = G.modOn('TEL');
    const pend = steps.filter(s => s.step_code !== 'SWITCH_ON' && !s.done);
    const tbl = h('div', { class: 'stack', style: 'gap:6px' }, steps.map(s => {
      const meta = TEL_STEPS.find(x => x[0] === s.step_code) || [s.step_code, s.name, ''];
      return h('div', { style: 'display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:8px;align-items:start;padding:6px 0;border-bottom:1px solid var(--line)' },
        h('span', { class: 'badge ' + (s.done ? 'ok' : '') }, s.step_no), h('div', { style: 'min-width:0' }, h('b', null, meta[1]), h('div', { class: 'small muted' }, meta[2]), s.done ? h('div', { class: 'small' }, `Hecho ${F.datetime(s.done_at)} · ${userNameById(s.done_by)} · ${s.notes || ''}`) : null),
        s.step_code === 'SWITCH_ON' ? (s.done ? badge('Encendido', 'ok') : badge('al encender', '')) : s.done ? btn('Deshacer', guard('plt.module.toggle', () => { if (on) return toast('RN-TEL-02: con TEL encendido la lista no se deshace; apágalo primero.', 'warn'); run(() => D.update('tel_activation_steps', s.id, { done: false, done_at: null, done_by: null }), 'Paso reabierto'); }), { sm: true, kind: 'ghost' }) : btn('Marcar hecho', guard('plt.module.toggle', () => stepDlg(s, meta)), { sm: true }));
    }));
    const vend = D.find('users', u => u.role === 'VENDEDORA' && u.status === 'ACTIVE');
    const api = P.apiCall('POST', '/api/v1/tel/calls', { perm: 'tel.call.make', role: 'VENDEDORA' });
    const ficha = h('div', { class: 'card', style: 'padding:10px;display:grid;gap:6px;align-content:start' }, h('div', { class: 'small muted' }, `Ficha de cliente vista por ${vend ? vend.name : 'la vendedora'}`), h('b', null, 'Rosa Huamán Ccori · +51 987 654 321'), h('div', { class: 'row' }, btn('WhatsApp', () => toast('Abre la conversación en CRM', 'info'), { sm: true }), btn('Nuevo pedido', () => toast('Abre PED-02', 'info'), { sm: true }), on && P.hasPerm('tel.call.make', 'VENDEDORA') ? btn('Llamar', () => toast('Llamada saliente por la central (TEL)', 'ok'), { sm: true, kind: 'primary' }) : null),
      h('div', { class: 'small mono' }, `POST /api/v1/tel/calls → ${api.status} ${JSON.stringify(api.body.code ? { code: api.body.code } : api.body)}`));
    return card('TEL · Telefonía con grabación: lista de activación', h('div', { class: 'grid c2' }, h('div', { class: 'stack' }, h('div', { class: 'row' }, on ? badge('Encendido', 'ok') : badge('Incluido y apagado', 'warn'), badge(`${steps.filter(s => s.done).length} de ${steps.length} pasos`, pend.length ? 'warn' : 'ok'), badge(`Necesita: ${P.depsOf('TEL').hard.join(', ')}`, P.depsOf('TEL').hard.every(G.modOn) ? 'ok' : 'bad')), tbl,
      pend.length && !on ? notice(`Solo se puede encender con los pasos 1 a 5 hechos (RN-TEL-02). Faltan ${pend.length}.`, 'warn') : null),
      h('div', { class: 'stack', style: 'align-content:start' }, ficha, h('p', { class: 'small muted' }, 'Con TEL apagado la vendedora no ve el botón «Llamar» y la API responde 403 RN-PLT-07 (CA-PLT-03). Al encenderlo, con CRM encendido, el permiso tel.call.make y el botón aparecen sin desarrollo adicional.'))),
      { actions: [on ? btn('Apagar TEL', () => toggleDlg('TEL', false), { sm: true, kind: 'danger' }) : btn('Encender TEL', () => toggleDlg('TEL', true), { sm: true, kind: 'primary', disabled: pend.length > 0, title: pend.length ? 'Completa la lista de activación' : '' })] });
  }
  function stepDlg(s, meta) {
    G.ui.modal(`Paso ${s.step_no}: ${meta[1]}`, bd => {
      bd.appendChild(h('p', { class: 'small' }, meta[2]));
      bd.appendChild(h('label', { class: 'small muted', attrs: { for: 'plt12-own' } }, 'Responsable'));
      bd.appendChild(h('select', { class: 'input', attrs: { id: 'plt12-own' } }, D.where('users', u => u.status === 'ACTIVE' && ['ADMIN_SISTEMA', 'GERENTE', 'SUPERVISORA_VENTAS', 'ADMINISTRACION'].includes(u.role)).map(u => h('option', { value: u.id, selected: u.id === G.ctx.userId() }, `${u.name} · ${G.roleName(u.role)}`))));
      bd.appendChild(h('textarea', { class: 'input', attrs: { id: 'plt12-ev', placeholder: s.step_code === 'RECORDING_NOTICE' ? 'Ej.: audio «Esta llamada puede ser grabada…» cargado y probado (Ley 29733)' : s.step_code === 'SIGNED_POLICY' ? 'Ej.: Política de grabación firmada por gerencia el 10/10/2026 (archivo POL-TEL-01.pdf)' : 'Evidencia: documento, constancia o prueba realizada' } }));
    }, [{ label: 'Cancelar' }, { label: 'Marcar hecho', kind: 'primary', onClick: () => run(() => P.telStepDone(s.id, { notes: document.getElementById('plt12-ev').value, owner: document.getElementById('plt12-own').value }), 'Paso registrado') ? undefined : false }]);
  }
  function modulesScreen(el) {
    const body = page(el, { code: 'PLT-12', title: 'Módulos activables', sub: 'Interruptor por módulo con fase, dependencias y estado. Los núcleo (PLT, SEG, MAE, INT, AUD) no se apagan (RN-PLT-09); encender exige sus dependencias y apagar, que nadie encendido dependa de él (RN-PLT-10). Un módulo apagado oculta pantallas, botones e indicadores y su API responde 403 (RN-PLT-07).' });
    const mods = D.all('platform_modules').sort((a, b) => a.phase - b.phase || a.sort_order - b.sort_order);
    const on = mods.filter(m => G.modOn(m.code));
    body.appendChild(kpis([{ label: 'Catálogo', value: mods.length, sub: 'módulos de las fases 0 a 4' }, { label: 'Encendidos', value: on.length, tone: 'ok' }, { label: 'Apagados', value: mods.length - on.length, sub: mods.filter(m => !G.modOn(m.code)).map(m => m.code).join(', '), tone: mods.length - on.length ? 'warn' : '' }, { label: 'Núcleo', value: CORE.length, sub: CORE.join(', ') }]));
    body.appendChild(telCard());
    const tmBy = new Map(D.all('tenant_modules').map(t => [t.module_code, t]));
    body.appendChild(table({ id: 'plt12', rows: mods, pageSize: 50, filters: [{ key: 'phase', label: 'Fase', options: [0, 1, 2, 3, 4].map(p => [p, 'Fase ' + p]) }, { key: 'st', label: 'Estado', value: m => G.modOn(m.code) ? 'ON' : 'OFF', options: [['ON', 'Encendido'], ['OFF', 'Apagado']] }],
      onRow: m => drawer(`${m.code} · ${m.name}`, bd => { const t = tmBy.get(m.code) || {}; const dp = P.depsOf(m.code); bd.appendChild(dl([['Fase', m.phase], ['Núcleo', m.is_core ? 'Sí (siempre encendido)' : 'No'], ['Estado', G.modOn(m.code) ? badge('Encendido', 'ok') : badge('Apagado', 'warn')], ['Necesita', dp.hard.map(c => `${c}${G.modOn(c) ? '' : ' (apagado)'}`).join(', ') || 'solo el núcleo'], ['Usa si están encendidos', dp.soft.join(', ') || '—'], ['Dependen de él', P.dependents(m.code).join(', ') || '—'], ['Último cambio', t.changed_at ? `${F.datetime(t.changed_at)} · ${t.changed_by}` : '—'], ['Motivo', t.reason]])); const ev = D.where('domain_events', e => ['module.enabled', 'module.disabled'].includes(e.name) && e.payload && e.payload.module === m.code); if (ev.length) { bd.appendChild(h('h3', null, 'Eventos')); bd.appendChild(dl(ev.map(e => [F.datetime(e.at), e.name + ' · ' + e.user]))); } }, { code: 'PLT-12' }),
      columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Módulo' }, { key: 'phase', label: 'Fase', align: 'c' }, { key: 'deps', label: 'Necesita', value: m => P.depsOf(m.code).hard.join(', ') || (m.is_core ? 'núcleo' : '—') }, { key: 'dependents', label: 'Dependen de él', value: m => P.dependents(m.code).filter(G.modOn).join(', ') || '—' },
        { key: 'st', label: 'Estado', value: m => G.modOn(m.code) ? 'Encendido' : 'Apagado', render: m => m.is_core ? badge('Núcleo', 'info') : G.modOn(m.code) ? badge('Encendido', 'ok') : badge('Apagado', 'warn') }, { key: 'reason', label: 'Motivo', value: m => (tmBy.get(m.code) || {}).reason || '—' }],
      actions: m => m.is_core ? [] : [btn(G.modOn(m.code) ? 'Apagar' : 'Encender', () => toggleDlg(m.code, !G.modOn(m.code)), { sm: true, kind: G.modOn(m.code) ? 'ghost' : 'primary' })] }));
    body.appendChild(notice([h('b', null, 'D-PLT-05 · valor provisional: '), 'a un cliente nuevo del SaaS se le encienden todos los módulos menos TEL; en la fase 4 los define el plan (SUS).'], 'info'));
  }

  /* ---- PLT-13 Dominio de acceso ---- */
  function hostScreen(el) {
    const body = page(el, { code: 'PLT-13', title: 'Dominio de acceso', sub: 'Subdominio o dominio propio con el que entran los usuarios de la empresa. Cada dominio identifica a una sola empresa; si no existe o la empresa está suspendida o cerrada, no se muestra el inicio de sesión (RN-PLT-19).', actions: [{ label: 'Agregar dominio', kind: 'primary', onClick: guard('plt.hostname.manage', () => drawer('Agregar dominio', (bd, close) => bd.appendChild(form({ id: 'plt13', values: { primary: false }, onCancel: close, submitLabel: 'Agregar', fields: [{ key: 'hostname', label: 'Dominio', required: true, placeholder: 'sistema.donguando.com' }, { key: 'primary', label: 'Usar como principal al verificarse', type: 'checkbox' }], onSubmit: v => { try { P.addHostname(v.hostname, v.primary); } catch (e) { return e.message; } toast('Dominio agregado: crea el registro TXT para verificarlo', 'ok'); close(); G.refresh(); return true; } })), { code: 'PLT-13' })) }] });
    const tn = D.raw('tenants').find(t => t.id === G.ctx.tenant) || {};
    const mine = D.raw('tenant_hostnames').filter(x => x.tenant_ref === G.ctx.tenant);
    body.appendChild(kpis([{ label: 'Empresa cliente', value: tn.short || tn.name, sub: `${tn.name} · plan ${tn.plan}` }, { label: 'Estado del tenant', value: (ST[tn.status] || [tn.status])[0], tone: tn.status === 'ACTIVE' ? 'ok' : 'bad' }, { label: 'Dominio principal', value: (mine.find(x => x.is_primary && x.status === 'ACTIVE') || {}).hostname || '—' }, { label: 'Dominios', value: mine.length }]));
    body.appendChild(table({ id: 'plt13', rows: mine, search: false, columns: [{ key: 'hostname', label: 'Dominio', mono: true }, { key: 'is_primary', label: 'Principal', value: x => x.is_primary ? 'Sí' : 'No' }, { key: 'status', label: 'Estado', render: x => x.status === 'PENDING_DNS' ? badge('Pendiente de DNS', 'warn') : stBadge(x.status) }, { key: 'verify', label: 'Verificación', value: x => x.verified_at ? 'Verificado ' + F.date(x.verified_at) : (x.verify_token ? 'TXT ' + x.verify_token : '—') }],
      actions: x => [x.status === 'PENDING_DNS' ? btn('Verificar DNS', guard('plt.hostname.manage', () => run(() => { if (x.is_primary) for (const y of mine) y.is_primary = y.id === x.id; return D.update('tenant_hostnames', x.id, { status: 'ACTIVE', verified_at: G.date.now() }); }, 'Registro TXT encontrado: dominio activo')), { sm: true }) : null, x.status === 'ACTIVE' && !x.is_primary ? btn('Hacer principal', guard('plt.hostname.manage', () => run(() => { for (const y of mine) y.is_primary = y.id === x.id; D.touch(); }, 'Dominio principal cambiado')), { sm: true }) : null, x.status === 'ACTIVE' && !x.is_primary ? btn('Desactivar', guard('plt.hostname.manage', () => run(() => D.update('tenant_hostnames', x.id, { status: 'INACTIVE' }), 'Dominio desactivado')), { sm: true, kind: 'ghost' }) : null].filter(Boolean) }));
    body.appendChild(notice([h('b', null, 'D-PLT-04 · valor provisional: '), 'se entra por el subdominio donguando.aycha.pe; sistema.donguando.com queda pendiente hasta que se decida y se cree el registro DNS.'], 'info'));
    const out = h('div'); const hi = h('input', { class: 'input mono', value: 'donguando.aycha.pe', attrs: { id: 'plt13-h', 'aria-label': 'Dominio a resolver' } });
    body.appendChild(card('Probar resolve_tenant_by_host', h('div', { class: 'stack' }, h('div', { class: 'row' }, hi, btn('Resolver', () => { G.ui.clear(out); try { const r = P.resolveHost(hi.value); out.appendChild(notice(`${r.hostname.hostname} → ${r.tenant.name} (${r.tenant.id}). Se muestra el inicio de sesión de esta empresa.`, 'ok')); } catch (e) { out.appendChild(notice(e.message, 'bad')); } }, { sm: true }), ['carnesselectas.aycha.pe', 'sistema.donguando.com', 'otraempresa.aycha.pe'].map(x => btn(x, () => { hi.value = x; }, { sm: true, kind: 'ghost' }))), out)));
    // pruebas de aislamiento
    const iso = h('div');
    body.appendChild(card('Pruebas de aislamiento entre empresas (CI · RN-PLT-01 y RN-PLT-02)', h('div', { class: 'stack' }, h('p', { class: 'small' }, 'Recorre todas las tablas con la sesión de esta empresa: no debe aparecer ninguna fila de otra empresa, escribir filas ajenas debe fallar y plt_rls_gaps() debe devolver cero filas.'), btn('Ejecutar pruebas', () => {
      const res = P.isolationCheck(); const gaps = P.rlsGaps(); const leaks = res.filter(r => r.leak); const writes = res.filter(r => r.foreignRows && !r.writeBlocked);
      let fk = ''; try { P.assertSameTenant('customers', (D.raw('customers').find(c => c.tenant && c.tenant !== G.ctx.tenant) || {}).id || 'x'); fk = 'enlazó un registro ajeno'; } catch (e) { fk = e.message; }
      G.ui.clear(iso).append(kpis([{ label: 'Tablas revisadas', value: res.length }, { label: 'Filas ajenas visibles', value: U.sum(leaks, r => r.leak), tone: leaks.length ? 'bad' : 'ok' }, { label: 'Escrituras ajenas permitidas', value: writes.length, tone: writes.length ? 'bad' : 'ok' }, { label: 'plt_rls_gaps()', value: gaps.length, sub: gaps.map(g => g.table).join(', ') || 'cero filas', tone: gaps.length ? 'bad' : 'ok' }]), notice(fk, /RN-PLT-02/.test(fk) ? 'ok' : 'bad'),
        table({ id: 'plt13-iso', rows: res.filter(r => r.foreignRows).map(r => Object.assign({ id: r.table }, r)), search: false, pageSize: 10, columns: [{ key: 'table', label: 'Tabla', mono: true }, { key: 'visible', label: 'Filas visibles', align: 'r' }, { key: 'foreignRows', label: 'Filas de otra empresa', align: 'r' }, { key: 'leak', label: 'Fugas', align: 'r' }, { key: 'writeBlocked', label: 'Escritura ajena', render: r => r.writeBlocked ? badge('rechazada', 'ok') : badge('permitida', 'bad') }] }));
    }, { sm: true, kind: 'primary' }), iso)));
  }

  /* ---- PLT-14 Asistente ---- */
  function setupScreen(el) {
    const st = P.setupSteps();
    const body = page(el, { code: 'PLT-14', title: 'Asistente de configuración inicial', sub: 'Lista guiada para poner en marcha la empresa. El avance se calcula con los datos reales: cada casilla se marca sola cuando el dato existe y es válido.', actions: [{ label: 'Probar seed_plataforma en una empresa nueva', onClick: guard('plt.setup.run', () => { const r1 = P.seedPlataforma('NV'); const r2 = P.seedPlataforma('NV'); const same = JSON.stringify(r1) === JSON.stringify(r2); G.ui.modal('seed_plataforma (dos corridas)', bd => { bd.appendChild(dl([['Empresas', r2.companies], ['Roles del sistema', r2.roles], ['Series base', r2.series], ['Medios de pago', r2.payment_methods], ['Módulos', `${r2.modules} (${r2.enabled} encendidos, TEL ${r2.tel ? 'encendido' : 'apagado'})`], ['Parámetros de la fase 0', r2.params], ['Idempotente', same ? 'Sí: la segunda corrida no duplicó nada' : 'No']])); bd.appendChild(notice('La empresa de prueba se borra al cerrar este aviso.', 'info')); }, [{ label: 'Cerrar', onClick: () => { for (const t of Object.keys(D.t)) D.t[t] = D.t[t].filter(r => r.tenant !== 'NV'); D.touch(); } }]); }) }] });
    body.appendChild(h('div', { class: 'card', style: 'padding:14px;display:grid;gap:8px' }, h('div', { class: 'row between' }, h('b', null, `Avance: ${F.pct(st.pct, 0)}`), h('span', { class: 'small muted' }, `${st.done} de ${st.total} comprobaciones · ${st.steps.filter(s => s.ok).length} de ${st.steps.length} pasos completos`)), progress(st.pct, st.pct >= 100 ? 'ok' : '')));
    body.appendChild(h('div', { class: 'steps' }, st.steps.map((s, i) => h('div', { class: 'step' + (s.ok ? ' done' : (st.steps.findIndex(x => !x.ok) === i ? ' cur' : '')) }, `${i + 1}. ${s.title}`))));
    body.appendChild(h('div', { class: 'grid c2' }, st.steps.map((s, i) => card(`${i + 1}. ${s.title}`, h('div', { class: 'stack', style: 'gap:4px' }, s.checks.map(c => h('div', { style: 'display:flex;gap:8px;align-items:flex-start' }, badge(c.ok ? 'Listo' : 'Pendiente', c.ok ? 'ok' : 'warn'), h('div', { style: 'min-width:0' }, h('span', null, c.label), c.detail ? h('div', { class: 'small muted' }, String(c.detail)) : null)))),
      { actions: [h('span', { class: 'small muted' }, `${s.done}/${s.total}`), s.screen && G.screens[s.screen] ? btn('Ir a ' + s.screen, () => G.go(s.screen), { sm: true }) : null].filter(Boolean) }))));
  }

  /* ---------- registro ---------- */
  const SC = Object.fromEntries(G.SPEC.PLT.screens.map(s => [s[0], s[1]]));
  G.register({ code: 'PLT', name: 'Plataforma', phase: 0, group: 'Plataforma', screens: [
    { code: 'PLT-01', name: SC['PLT-01'], render: shellScreen }, { code: 'PLT-02', name: SC['PLT-02'], render: searchScreen }, { code: 'PLT-03', name: SC['PLT-03'], render: companiesScreen },
    { code: 'PLT-04', name: SC['PLT-04'], render: sitesScreen }, { code: 'PLT-05', name: SC['PLT-05'], render: brandsScreen }, { code: 'PLT-06', name: SC['PLT-06'], render: themesScreen },
    { code: 'PLT-07', name: SC['PLT-07'], render: ccScreen }, { code: 'PLT-08', name: SC['PLT-08'], render: seriesScreen }, { code: 'PLT-09', name: SC['PLT-09'], render: periodsScreen },
    { code: 'PLT-10', name: SC['PLT-10'], render: paramsScreen }, { code: 'PLT-11', name: SC['PLT-11'], render: paramHistScreen }, { code: 'PLT-12', name: SC['PLT-12'], render: modulesScreen },
    { code: 'PLT-13', name: SC['PLT-13'], render: hostScreen }, { code: 'PLT-14', name: SC['PLT-14'], render: setupScreen },
  ] });

  /* ---------- pruebas (criterios CA-PLT) ---------- */
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (code && !String(e.message).startsWith(code)) throw new Error(`Se esperaba ${code} y llegó: ${e.message}`); return e; } throw new Error(`Se esperaba el error ${code} y no falló.`); };
  const T = (name, fn) => G.tests.push({ module: 'PLT', name, fn: async () => { const role = G.ctx.role; try { await fn(); } finally { G.ctx.role = role; G.ctx.tenant = 'DG'; } } });
  T('CA-PLT-01: con la sesión de Don Guando ninguna tabla muestra filas de Carnes Selectas y escribirlas falla', () => {
    assert(D.raw('sales_orders').some(r => r.tenant === 'CS') || D.raw('customers').some(r => r.tenant === 'CS') || D.raw('users').some(r => r.tenant === 'CS'), 'Falta la segunda empresa en los datos');
    const res = P.isolationCheck('DG');
    assert(res.length > 20, 'Debe recorrer todas las tablas');
    const leak = res.filter(r => r.leak); assert(!leak.length, 'Filas ajenas visibles en ' + leak.map(r => r.table).join(', '));
    const w = res.filter(r => r.foreignRows && !r.writeBlocked); assert(!w.length, 'Escritura ajena permitida en ' + w.map(r => r.table).join(', '));
    const cs = D.raw('users').find(u => u.tenant === 'CS'); expectFail(() => P.assertSameTenant('users', cs.id), 'RN-PLT-02');
    const gaps = P.rlsGaps().filter(g => ['companies', 'establishments', 'brands', 'users', 'customers', 'sales_orders', 'sales_documents', 'payments', 'document_series', 'accounting_periods', 'tenant_modules', 'ui_themes', 'user_sessions'].includes(g.table));
    assert(!gaps.length, 'plt_rls_gaps() con filas: ' + gaps.map(g => g.table).join(', '));
  });
  T('CA-PLT-02: 100 boletas en B002 numeran 1 a 100 sin saltos ni duplicados aunque una emisión falle a mitad', () => {
    const s = D.find('document_series', x => x.series === 'B002'); s.next_number = 1;
    const got = []; let fails = 0;
    for (let i = 1; i <= 101; i++) { try { got.push(P.issueNumbered('B002', n => { if (i === 50) throw new Error('OSE caído'); return n.number; })); } catch (e) { fails++; } }
    assert(fails === 1 && got.length === 100, 'Deben quedar 100 emisiones y 1 falla');
    assert(got.every((n, i) => n === i + 1), 'Correlativos con saltos: ' + got.slice(45, 55).join(','));
    assert(new Set(got).size === 100 && s.next_number === 101, 'Duplicados o correlativo siguiente incorrecto');
    D.update('document_series', s.id, { status: 'INACTIVE' }, { silent: true }); expectFail(() => P.issueNumbered('B002', n => n), 'RN-PLT-03');
  });
  T('CA-PLT-03: con TEL apagado la vendedora no tiene «Llamar» y la API responde 403 RN-PLT-07; al encenderlo con CRM aparece', () => {
    assert(!G.modOn('TEL'), 'TEL debe empezar apagado');
    assert(!P.hasPerm('tel.call.make', 'VENDEDORA'), 'Con TEL apagado no se concede tel.call.make');
    const r = P.apiCall('POST', '/api/v1/tel/calls'); assert(r.status === 403 && r.body.code === 'RN-PLT-07', 'La API debe responder 403 RN-PLT-07');
    expectFail(() => P.toggleModule('TEL', true, 'Encender la central telefónica'), 'RN-TEL-02');
    for (const s of P.telChecklist().filter(x => x.step_code !== 'SWITCH_ON')) P.telStepDone(s.id, { notes: 'Evidencia de prueba ' + s.step_no });
    const crm = D.find('tenant_modules', m => m.module_code === 'CRM'); crm.enabled = false;
    expectFail(() => P.toggleModule('TEL', true, 'Encender la central telefónica'), 'RN-PLT-10'); crm.enabled = true;
    P.toggleModule('TEL', true, 'Encender la central telefónica');
    assert(G.modOn('TEL') && P.hasPerm('tel.call.make', 'VENDEDORA'), 'Con TEL encendido la vendedora debe tener tel.call.make');
    const r2 = P.apiCall('POST', '/api/v1/tel/calls', { perm: 'tel.call.make', role: 'VENDEDORA' }); assert(r2.status === 201, 'La API debe aceptar la llamada');
    assert(D.where('domain_events', e => e.name === 'module.enabled' && e.payload.module === 'TEL').length === 1, 'Falta el evento module.enabled');
    expectFail(() => P.toggleModule('SEG', false, 'Prueba de apagar el núcleo'), 'RN-PLT-09');
  });
  T('CA-PLT-04: Don Guando usa vino #922242, crema #FFFCE3 y texto #1D1D1D (oscuro #FFFCE3); la Marca 2 usa el tema de la empresa', () => {
    const t = P.themeFor('br-DG'); assert(t && t.brand_id === 'br-DG', 'Don Guando debe tener tema propio');
    assert(t.light.primary === '#922242' && t.light.background === '#FFFCE3' && t.light.text === '#1D1D1D' && t.dark.text === '#FFFCE3', 'Colores de Don Guando incorrectos');
    assert(P.checkTheme(t.light, t.dark).every(x => x.ok), 'El tema de Don Guando no cumple el contraste');
    const t2 = P.themeFor('br-M2'); assert(t2 && !t2.brand_id, 'La Marca 2 debe usar el tema del tenant');
    expectFail(() => P.saveTheme('br-M3', Object.assign({}, t2.light, { primary: '#B9781A', on_primary: '#FFFFFF' }), t2.dark), 'RN-PLT-15');
    assert(P.contrast('#FFFFFF', '#000000') === 21, 'Contraste blanco/negro debe ser 21');
  });
  T('CA-PLT-05: setiembre cerrado rechaza un documento del 30/09 (RN-PLT-05); al reabrir con motivo queda abierto y el historial muestra cierre y reapertura', () => {
    const p = D.find('accounting_periods', x => x.period === '2026-09-01' && x.company_id === 'co-dg');
    P.closePeriod(p.id, 'Cierre mensual');
    expectFail(() => G.period.assertOpen('2026-09-30'), 'RN-PLT-05');
    expectFail(() => P.reopenPeriod(p.id, 'corto'), 'RN-PLT-18');
    P.reopenPeriod(p.id, 'Factura de proveedor del 28/09 sin registrar');
    assert(!G.period.isClosed('2026-09-30'), 'Debe quedar abierto');
    const ev = P.periodEvents(p.id).map(e => e.action); assert(ev.includes('CLOSE') && ev[ev.length - 1] === 'REOPEN', 'El historial debe mostrar cierre y reapertura: ' + ev.join(','));
    assert(D.where('domain_events', e => e.name === 'period.closed').length && D.where('domain_events', e => e.name === 'period.reopened').length, 'Faltan los eventos period.closed y period.reopened');
    const jul = D.find('accounting_periods', x => x.period === '2026-07-01'); expectFail(() => P.reopenPeriod(jul.id, 'Reabrir julio con agosto cerrado'), 'RN-PLT-18');
    const oct = D.find('accounting_periods', x => x.period === '2026-10-01'); expectFail(() => P.closePeriod(oct.id), 'RN-PLT-17');
  });
  T('CA-PLT-06: seg_max_failed_logins 5 → 3 con motivo queda en el historial; sin motivo se rechaza con RN-PLT-06', () => {
    assert(G.param('seg_max_failed_logins') === 5, 'Debe empezar en 5');
    expectFail(() => P.setParam('seg_max_failed_logins', 3, ''), 'RN-PLT-06');
    expectFail(() => P.setParam('seg_max_failed_logins', 50, 'Política más estricta tras auditoría'), 'RN-PLT-11');
    P.setParam('seg_max_failed_logins', 3, 'Política más estricta tras auditoría');
    const hrow = D.where('parameter_history', x => x.key === 'seg_max_failed_logins').pop();
    assert(hrow && hrow.old_value === 5 && hrow.new_value === 3 && hrow.reason === 'Política más estricta tras auditoría' && hrow.changed_by, 'Historial incompleto');
    assert(G.param('seg_max_failed_logins') === 3, 'El valor vigente debe ser 3');
    P.setParam('plt_search_max_results', 15, 'Prueba de valor por marca para Marca 3', {}); assert(G.param('plt_search_max_results') === 15, 'Valor de empresa');
  });
  T('CA-PLT-07: la vendedora de la Marca 3 que busca «rosa» ve solo el pedido de la Marca 3; la gerente ve los dos; nadie ve llamadas con TEL apagado', () => {
    const c1 = D.insert('customers', { doc_type: 'DNI', doc_number: '41112223', full_name: 'Rosa Zevallos Pino', phone: '+51987000111', customer_type: 'PERSON', status: 'ACTIVE', segment_brands: ['br-DG'] });
    const c2 = D.insert('customers', { doc_type: 'DNI', doc_number: '41112224', full_name: 'Rosa Ugarte Lima', phone: '+51987000112', customer_type: 'PERSON', status: 'ACTIVE', segment_brands: ['br-M3'] });
    const o1 = G.orders.create({ customer_id: c1.id, brand_id: 'br-DG', channel: 'WHATSAPP', fulfillment: 'PICKUP', lines: [] });
    const o2 = G.orders.create({ customer_id: c2.id, brand_id: 'br-M3', channel: 'WHATSAPP', fulfillment: 'PICKUP', lines: [] });
    const v = D.find('users', u => u.role === 'VENDEDORA' && (u.brands || []).length === 1 && u.brands[0] === 'br-M3'); assert(v, 'Falta una vendedora asignada solo a la Marca 3');
    const rv = P.search('rosa', { user: v, noLimit: true }); const ov = rv.hits.filter(x => x.type === 'order');
    assert(ov.some(x => x.id === o2.id) && !ov.some(x => x.id === o1.id), 'La vendedora debe ver solo el pedido de la Marca 3');
    assert(ov.every(x => x.brand_id === 'br-M3'), 'La vendedora ve pedidos de otras marcas');
    const g = D.find('users', u => u.role === 'GERENTE'); const rg = P.search('rosa', { user: g, noLimit: true }).hits.filter(x => x.type === 'order');
    assert(rg.some(x => x.id === o1.id) && rg.some(x => x.id === o2.id), 'La gerente debe ver los dos');
    assert(!P.search('rosa', { user: g, noLimit: true }).hits.some(x => x.type === 'call'), 'Nadie ve llamadas con TEL apagado');
    assert(P.search('ro', { user: g }).tooShort, 'Menos de 3 caracteres no busca');
    assert(P.search('rosa', { user: g }).hits.length <= 20, 'Máximo 20 resultados');
  });
  T('CA-PLT-08: seed_plataforma (una o dos veces) deja 1 empresa, 22 roles, 13 series, 7 medios de pago, 40 módulos (39 encendidos, TEL apagado) y los parámetros de la fase 0', () => {
    try {
      const r1 = P.seedPlataforma('NV'); const r2 = P.seedPlataforma('NV');
      assert(JSON.stringify(r1) === JSON.stringify(r2), 'La segunda corrida duplicó datos');
      assert(r2.companies === 1 && r2.roles === 22 && r2.series === 13 && r2.payment_methods === 7, 'Conteos: ' + JSON.stringify(r2));
      assert(r2.modules === 40 && r2.enabled === 39 && !r2.tel, 'Módulos: ' + JSON.stringify(r2));
      const n0 = Object.values(G.PARAM_DEFS).filter(d => G.SPEC[d.module].phase === 0).length; assert(r2.params === n0, `Parámetros de la fase 0: ${r2.params} de ${n0}`);
      G.ctx.tenant = 'NV'; assert(!D.all('sales_orders').length, 'La empresa nueva no debe ver pedidos de Don Guando');
    } finally { G.ctx.tenant = 'DG'; for (const t of Object.keys(D.t)) D.t[t] = D.t[t].filter(r => r.tenant !== 'NV'); }
  });
})();
