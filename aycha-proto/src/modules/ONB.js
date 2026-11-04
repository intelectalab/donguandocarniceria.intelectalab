/* =====================================================================
   ONB · Alta de empresas, plantillas por rubro e importadores (Fase 4)
   Registro con RUC (adaptador FAKE de SUNAT, D-ONB-01) → verificación del correo →
   aprovisionamiento idempotente del tenant (RN-ONB-17) → asistente con pasos y
   prerrequisitos (RN-ONB-04/05/06) → plantillas por rubro idempotentes (RN-ONB-07) →
   importadores con validación por fila, lotes de 500 y reversión (RN-ONB-08..16) →
   salida a producción con el primer comprobante aceptado.
   Las empresas en alta son tenants propios: las pantallas del asistente trabajan sobre
   el tenant del alta elegida (simulación de la vista de su administrador).
   Spec: docs/fase-4/modulos/ONB-alta-de-empresas.md
   ===================================================================== */
(function () {
  const { h, btn, badge, status, page, card, table, kpis, dl, notice, drawer, form, toast, modal, tabs, progress } = G.ui;
  const U = G.util, F = G.fmt;
  /* vaciar un nodo: G.ui.clear (G.util no lo tiene) o a mano */
  const clearEl = el => { if (G.ui.clear) return G.ui.clear(el); while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const R = (n, d = 2) => U.round(n, d);
  const raw = t => G.db.raw(t);
  const S = { run: null, imp: null, type: 'PRODUCTS', file: null };

  /* ---------- utilidades propias ---------- */
  function within(tenant, fn) { const prev = G.ctx.tenant; G.ctx.tenant = tenant; try { return fn(); } finally { G.ctx.tenant = prev; } }
  const ins = (t, r, o = {}) => G.db.insert(t, r, Object.assign({ silent: !!G._seeding || !!o.silent }, o));
  const upd = (t, row, patch) => within(row.tenant || G.ctx.tenant, () => G.db.update(t, row.id, patch, { silent: !!G._seeding }));
  const nowIso = () => G._seeding ? G.TODAY + 'T09:00:00' : G.date.now();
  const tenantRow = id => raw('tenants').find(t => t.id === id) || null;
  const tenantName = id => { const t = tenantRow(id); return t ? (t.short || t.name) : id; };
  const guard = perm => { if (!G._seeding && !G.can(perm)) G.fail('RN-SEG-01', `Tu rol (${G.roleName()}) no tiene el permiso ${perm}.`); };
  const emit = (name, p) => { if (!G._seeding) G.events.emit(name, p); };
  const num = v => { if (v === null || v === undefined) return NaN; let s = String(v).trim().replace(/\s/g, ''); if (s === '') return NaN; if (s.includes('.') && s.includes(',')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''); else s = s.replace(',', '.'); return Number(s); };
  const dec = (x, d = 2) => Number(x).toFixed(d).replace('.', ','); // Excel en español: coma decimal
  const isoDate = v => { const s = String(v || '').trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); return m ? `${m[3]}-${U.pad(m[2], 2)}-${U.pad(m[1], 2)}` : null; };
  const yes = v => /^(si|sí|s|1|true|x)$/i.test(String(v || '').trim());
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  /** SHA-256 síncrono (huella de archivos, RN-ONB-09) */
  const K256 = (() => { const k = []; let n = 2; while (k.length < 64) { let p = true; for (let i = 2; i * i <= n; i++) if (n % i === 0) { p = false; break; } if (p) k.push(Math.floor((Math.cbrt(n) % 1) * 4294967296) >>> 0); n++; } return k; })();
  function sha256(str) {
    const bytes = new TextEncoder().encode(String(str));
    const l = bytes.length, total = ((l + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total); buf.set(bytes); buf[l] = 0x80;
    const dv = new DataView(buf.buffer); dv.setUint32(total - 4, (l * 8) >>> 0); dv.setUint32(total - 8, Math.floor(l / 536870912));
    let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const W = new Uint32Array(64); const rr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let i = 0; i < total; i += 64) {
      for (let t = 0; t < 16; t++) W[t] = dv.getUint32(i + t * 4);
      for (let t = 16; t < 64; t++) { const x = W[t - 15], y = W[t - 2]; W[t] = (W[t - 16] + (rr(x, 7) ^ rr(x, 18) ^ (x >>> 3)) + W[t - 7] + (rr(y, 17) ^ rr(y, 19) ^ (y >>> 10))) | 0; }
      let [a, b, c, d, e, f, g, hh] = H;
      for (let t = 0; t < 64; t++) { const t1 = (hh + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K256[t] + W[t]) | 0; const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0; hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
      H = [H[0] + a, H[1] + b, H[2] + c, H[3] + d, H[4] + e, H[5] + f, H[6] + g, H[7] + hh].map(x => x | 0);
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  /* ---------- CSV (Excel guarda como CSV; separador ; para es-PE) ---------- */
  function csvParse(text) {
    text = String(text || '').replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = [';', '\t', ','].map(s => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === sep) { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
  }
  const csvCell = v => { const s = String(v ?? ''); return /[;"\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csvJoin = rows => rows.map(r => r.map(csvCell).join(';')).join('\r\n');
  function download(name, content, mime = 'text/csv') {
    try { const blob = new Blob(['﻿' + content], { type: mime + ';charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); } catch (e) { toast('No se pudo descargar: ' + e.message, 'bad'); }
  }

  /* =====================================================================
     Catálogos del módulo
     ===================================================================== */
  const INDUSTRIES = [['DISTRIBUIDORA_CARNES', 'Distribuidora de carnes'], ['CARNICERIA_PREMIUM', 'Carnicería premium'], ['CHARCUTERIA', 'Charcutería y embutidos'], ['AVICOLA', 'Avícola'], ['TIENDA_GOURMET', 'Tienda gourmet (café y abarrotes)'], ['PROVEEDOR_RESTAURANTES', 'Proveedor de restaurantes'], ['GRANJA', 'Granja'], ['OTRO', 'Otro']];
  const indName = c => (INDUSTRIES.find(x => x[0] === c) || [c, c])[1];
  // D-ONB-02: carnicería premium y proveedor de restaurantes usan la plantilla de distribuidora
  const templateFor = ind => ({ CARNICERIA_PREMIUM: 'DISTRIBUIDORA_CARNES', PROVEEDOR_RESTAURANTES: 'DISTRIBUIDORA_CARNES' }[ind] || ind);
  const PRODUCTS_SAAS = [['COMERCIAL', 'Aycha Comercial (cárnicos y alimentos)'], ['GRANJA', 'Granja Don Guando (crianza)']];
  const ORIGINS = [['google', 'Google'], ['meta', 'Facebook e Instagram'], ['tiktok', 'TikTok'], ['referido', 'Referido'], ['directo', 'Directo / web']];
  const BASE_MODS = ['PLT', 'SEG', 'MAE', 'INT', 'AUD', 'SUS', 'ONB'];
  // D-SUS-03: límites propuestos mientras SUS no publique precios (los planes viven en SUS)
  const PLANS = {
    INICIAL: { name: 'Inicial', brands: 1, sites: 1, users: 5, orders: 300, wa: 1, mods: ['CAT', 'CLI', 'PED', 'POS', 'ALM', 'FAC', 'CAJ', 'TAB'] },
    CRECIMIENTO: { name: 'Crecimiento', brands: 3, sites: 2, users: 15, orders: 1500, wa: 3, mods: ['CAT', 'CLI', 'PED', 'POS', 'ALM', 'FAC', 'CAJ', 'TAB', 'WEB', 'CRM', 'ADS', 'PRE', 'DEL', 'GAS', 'CAL'] },
    MULTIMARCA: { name: 'Multimarca', brands: 10, sites: 5, users: 40, orders: 5000, wa: 8, mods: ['CAT', 'CLI', 'PED', 'POS', 'ALM', 'FAC', 'CAJ', 'TAB', 'WEB', 'CRM', 'ADS', 'PRE', 'DEL', 'GAS', 'CAL', 'PRO', 'DES', 'REC', 'EQU', 'ETQ', 'COM', 'B2B', 'CMP', 'CON', 'FLO', 'PER', 'PRS', 'CNT', 'SEP', 'API'] },
  };
  const planOf = code => PLANS[code] || PLANS.CRECIMIENTO;
  const planName = code => (PLANS[code] || { name: code || '—' }).name;
  const MFA_ROLES = ['GERENTE', 'ADMIN_SISTEMA', 'ADMINISTRACION', 'CONTADORA'];

  /** pasos del alta: [código, nombre, pantalla, obligatorio, prerrequisitos, responsable] (RN-ONB-04/06) */
  const STEPS = [
    ['COMPANY', 'Empresa', 'ONB-03', true, [], 'ADMIN_SISTEMA'],
    ['BRANDS', 'Marcas', 'ONB-04', true, ['COMPANY'], 'ADMIN_SISTEMA'],
    ['ESTABLISHMENTS', 'Locales', 'ONB-05', true, ['COMPANY'], 'ADMIN_SISTEMA'],
    ['WAREHOUSES', 'Almacenes', 'ONB-05', false, ['ESTABLISHMENTS'], 'ALMACENERO'],
    ['SERIES', 'Series de comprobantes', 'ONB-06', true, ['COMPANY', 'ESTABLISHMENTS'], 'CONTADORA'],
    ['EINVOICE', 'Comprobante electrónico (OSE)', 'ONB-06', true, ['SERIES'], 'CONTADORA'],
    ['PAYMENT_METHODS', 'Medios de pago y cajas', 'ONB-07', false, ['COMPANY'], 'ADMINISTRACION'],
    ['WHATSAPP', 'Números de WhatsApp', 'ONB-08', false, ['BRANDS'], 'SUPERVISORA_VENTAS'],
    ['DELIVERY_ZONES', 'Zonas de reparto', 'ONB-09', false, ['ESTABLISHMENTS'], 'COORDINADOR_DELIVERY'],
    ['TEMPLATE', 'Plantilla por rubro', 'ONB-10', false, ['BRANDS'], 'ADMIN_SISTEMA'],
    ['IMPORT_PRODUCTS', 'Importar productos', 'ONB-11', false, ['BRANDS'], 'ADMINISTRACION'],
    ['IMPORT_CUSTOMERS', 'Importar clientes', 'ONB-11', false, ['DELIVERY_ZONES'], 'ADMINISTRACION'],
    ['IMPORT_STOCK', 'Importar stock inicial', 'ONB-11', false, ['WAREHOUSES', 'IMPORT_PRODUCTS'], 'ALMACENERO'],
    ['IMPORT_BALANCES', 'Importar saldos', 'ONB-11', false, ['IMPORT_CUSTOMERS'], 'CONTADORA'],
    ['USERS', 'Usuarios e invitaciones', 'ONB-14', false, ['BRANDS', 'ESTABLISHMENTS'], 'ADMIN_SISTEMA'],
    ['GO_LIVE', 'Salida a producción', 'ONB-15', true, ['*'], 'GERENTE'],
  ];
  const STEP = Object.fromEntries(STEPS.map(s => [s[0], { code: s[0], name: s[1], screen: s[2], required: s[3], pre: s[4], owner: s[5] }]));
  const FIXED_REQUIRED = ['COMPANY', 'BRANDS', 'ESTABLISHMENTS', 'SERIES', 'EINVOICE', 'GO_LIVE'];
  const OPTIONAL_BY_SPEC = ['WHATSAPP', 'IMPORT_BALANCES', 'TEMPLATE'];
  // un prerrequisito opcional omitido no bloquea (la empresa puede cargar productos con la plantilla o vender solo con recojo)
  const SKIP_OK_AS_PRE = ['IMPORT_PRODUCTS', 'DELIVERY_ZONES', 'TEMPLATE', 'IMPORT_CUSTOMERS'];

  /* ---------- adaptador FAKE de consulta de RUC (D-ONB-01) ---------- */
  let _padron = null;
  function padron() {
    if (_padron) return _padron;
    const c = U.rucCheck;
    _padron = {};
    [[c('2061234501'), 'CHARCUTERÍA LA VIENESA SAC', 'ACTIVO', 'HABIDO', 'Av. Arequipa 2450, Lince, Lima', '150116'],
      [c('2061987402'), 'AVÍCOLA LOS ROSALES EIRL', 'ACTIVO', 'HABIDO', 'Carretera Central km 18,5, Ate, Lima', '150103'],
      [c('2060456703'), 'DESPENSA DE ALTURA SAC', 'ACTIVO', 'HABIDO', 'Calle Berlín 380, Miraflores, Lima', '150122'],
      [c('2060111204'), 'CARNES DEL NORTE SAC', 'ACTIVO', 'HABIDO', 'Av. España 1820, Trujillo, La Libertad', '130101'],
      [c('2048899105'), 'DISTRIBUIDORA EL TRUJILLANO SRL', 'ACTIVO', 'NO HABIDO', 'Jr. Pizarro 455, Trujillo', '130101'],
      [c('2052200306'), 'PROVEEDORA GASTRONÓMICA LIMA SAC', 'BAJA DE OFICIO', 'HABIDO', 'Av. Brasil 1550, Jesús María, Lima', '150113'],
      [c('1072233441'), 'QUISPE MAMANI JUANA', 'ACTIVO', 'HABIDO', 'Mercado N.° 1 de Surquillo, puesto 88, Lima', '150141'],
      [c('2061555508'), 'FRIGORÍFICO SAN MARTÍN SAC', 'ACTIVO', 'HABIDO', 'Av. Industrial 640, Lurín, Lima', '150119'],
      [c('2060777709'), 'EMBUTIDOS DEL VALLE SAC', 'ACTIVO', 'HABIDO', 'Jr. Ayacucho 220, Huancayo, Junín', '120101'],
    ].forEach(([ruc, n, st, co, ad, ub]) => { _padron[ruc] = { ruc, legal_name: n, status: st, condition: co, address: ad, ubigeo: ub, regime: 'MYPE' }; });
    return _padron;
  }
  /** consulta del padrón (adaptador FAKE): razón social, estado y condición */
  function sunatLookup(ruc) {
    ruc = String(ruc || '').trim();
    if (!U.rucOk(ruc)) G.fail('RN-ONB-01', `El RUC ${ruc || '(vacío)'} no es válido: debe tener 11 dígitos, empezar con 10, 15, 17 o 20 y cumplir el dígito verificador (módulo 11).`);
    const p = padron()[ruc];
    if (p) return Object.assign({}, p);
    const co = raw('companies').find(x => x.ruc === ruc);
    if (co) return { ruc, legal_name: co.legal_name, status: 'ACTIVO', condition: 'HABIDO', address: co.fiscal_address, ubigeo: co.fiscal_ubigeo, regime: co.tax_regime };
    return { ruc, legal_name: `EMPRESA DE PRUEBA ${ruc.slice(-5)} ${ruc.startsWith('10') ? '' : 'SAC'}`.trim(), status: 'ACTIVO', condition: 'HABIDO', address: 'Dirección registrada en SUNAT (padrón de prueba)', ubigeo: '150101', regime: 'MYPE' };
  }

  /* =====================================================================
     Plantillas por rubro (globales)
     ===================================================================== */
  const P = (code, name, cat, mode, kg, tol, price, cost, storage, shelf, lot, auth) => ['PRODUCT', code, null, { name, category: cat, sku: code, mode, kg, tol, price, cost, storage, shelf, lot, authority: auth }];
  const TPL = {
    DISTRIBUIDORA_CARNES: {
      name: 'Distribuidora de carnes', desc: 'Carnes de granja y cortes con peso variable: cuy, conejo, aves, cerdo y res. Sirve a carnicerías premium y proveedores de restaurantes (D-ONB-02).', items: [
        ['CATEGORY', 'CUY', null, { name: 'Cuy', line: 'CUY' }], ['CATEGORY', 'CONEJO', null, { name: 'Conejo', line: 'CONEJO' }], ['CATEGORY', 'AVES', null, { name: 'Aves de corral', line: 'AVES' }],
        ['CATEGORY', 'CERDO', null, { name: 'Cerdo', line: 'CERDO' }], ['CATEGORY', 'RES', null, { name: 'Res', line: 'RES' }],
        P('CUY-ENT', 'Cuy entero beneficiado', 'CUY', 'UNIT_VARIABLE_WEIGHT', 0.9, 10, 42, 26.5, 'CHILLED', 7, true, 'SENASA'),
        P('CON-ENT', 'Conejo entero', 'CONEJO', 'UNIT_VARIABLE_WEIGHT', 1.6, 10, 32, 19.5, 'CHILLED', 7, true, 'SENASA'),
        P('POL-ENT', 'Pollo de corral entero', 'AVES', 'UNIT_VARIABLE_WEIGHT', 2.2, 10, 22, 14.2, 'CHILLED', 6, true, 'SENASA'),
        P('CER-BON', 'Bondiola de cerdo', 'CERDO', 'KG', null, 5, 38, 24, 'CHILLED', 10, true, 'SENASA'),
        P('CER-PAN', 'Panceta de cerdo', 'CERDO', 'KG', null, 5, 36, 22.5, 'CHILLED', 10, true, 'SENASA'),
        P('RES-LOM', 'Lomo fino de res', 'RES', 'KG', null, 5, 85, 61, 'CHILLED', 10, true, 'SENASA'),
        ['CUT', 'ENTERO', null, { name: 'Entero', lines: ['CUY', 'CONEJO', 'AVES'] }], ['CUT', 'MITADES', null, { name: 'En mitades', lines: ['CUY', 'CONEJO', 'AVES'] }], ['CUT', 'TROZADO', null, { name: 'Trozado', lines: ['CONEJO', 'AVES', 'CERDO'] }],
        ['BREAKDOWN', 'DESP-CERDO-MR', 'DES', { name: 'Despiece de media res de cerdo (de ejemplo, ajustar con pesadas propias)', species: 'CERDO', lines: [['Bondiola', 14], ['Panceta', 18], ['Chuleta', 22], ['Pierna', 26], ['Hueso y recortes', 16], ['Merma', 4]] }],
        ['CHECKLIST', 'CHK-CAMARA', 'CAL', { name: 'Control diario de cámara y BPM', stage: 'STORAGE', items: ['Temperatura de cámara entre 0 y 4 °C', 'Producto rotulado con lote y vencimiento', 'Estantes y pisos limpios y desinfectados', 'Ningún producto en contacto con el piso'] }],
        ['KPI_TARGET', 'KPI-PED-04', null, { target: 3, tol: 10, label: 'Diferencia de peso pedido frente a real ≤ 3 %' }],
        ['KPI_TARGET', 'KPI-DEL-04', null, { target: 9, tol: 10, label: 'Costo por entrega ≤ S/ 9' }],
        ['KPI_TARGET', 'KPI-ALM-02', null, { target: 2, tol: 10, label: 'Mermas ≤ 2 %' }],
        ['PARAMETER', 'ped_weight_tolerance_pct', null, { value: 10, reason: 'Plantilla distribuidora: tolerancia de peso variable' }],
        ['ROLE', 'VENDEDOR_HORECA', null, { name: 'Vendedor de restaurantes (HORECA)', desc: 'Atiende cuentas de restaurantes con lista B2B' }],
        ['EXPENSE_CATEGORY', 'FLETE-FRIO', 'GAS', { name: 'Flete refrigerado', group: 'DELIVERY' }],
        ['DELIVERY_SLOT', 'MANANA-HORECA', 'DEL', { name: '06:00–10:00', from: '06:00', to: '10:00', cutoff: '20:00', capacity: 20 }],
      ],
    },
    CHARCUTERIA: {
      name: 'Charcutería y embutidos', desc: 'Embutidos, ahumados y fiambres con recetas, control de ahumado y vencimientos cortos.', items: [
        ['CATEGORY', 'EMBUTIDOS', null, { name: 'Embutidos', line: 'EMBUTIDOS' }], ['CATEGORY', 'AHUMADOS', null, { name: 'Ahumados', line: 'EMBUTIDOS' }], ['CATEGORY', 'FIAMBRES', null, { name: 'Fiambres', line: 'EMBUTIDOS' }],
        P('CHO-PAR-500', 'Chorizo parrillero 500 g', 'EMBUTIDOS', 'UNIT', null, null, 24, 11.4, 'CHILLED', 21, true, 'DIGESA'),
        P('SAL-HUA-500', 'Salchicha huachana 500 g', 'EMBUTIDOS', 'UNIT', null, null, 16, 7.6, 'CHILLED', 21, true, 'DIGESA'),
        P('JAM-AHU-KG', 'Jamón ahumado por kg', 'AHUMADOS', 'KG', null, 5, 64, 33, 'CHILLED', 30, true, 'DIGESA'),
        P('MOR-500', 'Morcilla 500 g', 'FIAMBRES', 'UNIT', null, null, 15, 6.8, 'CHILLED', 14, true, 'DIGESA'),
        ['RECIPE', 'REC-CHORIZO', 'REC', { name: 'Chorizo parrillero (lote de 20 kg)', product: 'CHO-PAR-500', type: 'SAUSAGE' }],
        ['RECIPE', 'REC-JAMON', 'REC', { name: 'Jamón ahumado (pieza curada)', product: 'JAM-AHU-KG', type: 'CURED' }],
        ['CHECKLIST', 'CHK-AHUMADO', 'CAL', { name: 'Control de ahumado y cocción', stage: 'PRODUCTION', items: ['Temperatura interna ≥ 68 °C', 'Tiempo de ahumado registrado', 'Nitritos dentro de la dosis de la receta', 'Enfriado a ≤ 4 °C antes de empacar'] }],
        ['KPI_TARGET', 'KPI-REC-01', null, { target: 5, tol: 10, label: 'Variación del costo de recetas ≤ 5 %' }],
        ['KPI_TARGET', 'KPI-CAL-05', null, { target: 95, tol: 5, label: 'Cumplimiento de checklists ≥ 95 %' }],
        ['KPI_TARGET', 'KPI-ALM-03', null, { target: 1, tol: 10, label: 'Vencidos ≤ 1 %' }],
        ['PARAMETER', 'rec_cost_alert_pct', null, { value: 5, reason: 'Plantilla charcutería: alerta de costo de receta' }],
        ['ROLE', 'MAESTRO_CHARCUTERO', null, { name: 'Maestro charcutero', desc: 'Aprueba recetas y controla el ahumado' }],
      ],
    },
    AVICOLA: {
      name: 'Avícola', desc: 'Pollo, pato y huevos con beneficio, despiece de ave y control de cadena de frío.', items: [
        ['CATEGORY', 'POLLO', null, { name: 'Pollo', line: 'AVES' }], ['CATEGORY', 'PATO', null, { name: 'Pato', line: 'AVES' }], ['CATEGORY', 'HUEVOS', null, { name: 'Huevos', line: 'AVES' }],
        P('POL-ENT', 'Pollo entero beneficiado', 'POLLO', 'UNIT_VARIABLE_WEIGHT', 2.2, 10, 21, 13.8, 'CHILLED', 6, true, 'SENASA'),
        P('POL-PEC', 'Pechuga de pollo', 'POLLO', 'KG', null, 5, 27, 18, 'CHILLED', 5, true, 'SENASA'),
        P('PAT-ENT', 'Pato entero', 'PATO', 'UNIT_VARIABLE_WEIGHT', 2.5, 10, 30, 19, 'CHILLED', 6, true, 'SENASA'),
        P('HUE-30', 'Huevos de corral × 30', 'HUEVOS', 'UNIT', null, null, 28, 19.5, 'AMBIENT', 21, true, 'SENASA'),
        ['CUT', 'ENTERO', null, { name: 'Entero', lines: ['AVES'] }], ['CUT', 'PECHUGA', null, { name: 'Pechuga', lines: ['AVES'] }], ['CUT', 'PIERNA-ENC', null, { name: 'Pierna y encuentro', lines: ['AVES'] }],
        ['BREAKDOWN', 'DESP-POLLO', 'DES', { name: 'Despiece de pollo entero (de ejemplo, ajustar con pesadas propias)', species: 'AVES', lines: [['Pechuga', 34], ['Pierna y encuentro', 32], ['Alas', 10], ['Carcasa', 18], ['Menudencia', 4], ['Merma', 2]] }],
        ['CHECKLIST', 'CHK-BENEFICIO', 'CAL', { name: 'Recepción de aves beneficiadas', stage: 'RECEPTION', items: ['Temperatura de la carcasa ≤ 4 °C', 'Guía de remisión y certificado sanitario', 'Sin hematomas ni plumas', 'Cajas limpias y rotuladas'] }],
        ['KPI_TARGET', 'KPI-DES-01', null, { target: 98, tol: 3, label: 'Rendimiento de despiece ≥ 98 % del estándar' }],
        ['KPI_TARGET', 'KPI-PED-04', null, { target: 3, tol: 10, label: 'Diferencia de peso ≤ 3 %' }],
        ['KPI_TARGET', 'KPI-CAL-03', null, { target: 2, tol: 10, label: 'Temperaturas fuera de rango ≤ 2 %' }],
        ['PARAMETER', 'alm_max_temp_chilled_c', null, { value: 4, reason: 'Plantilla avícola: cadena de frío' }],
      ],
    },
    TIENDA_GOURMET: {
      name: 'Tienda gourmet (café y abarrotes)', desc: 'Café, frutos secos, mermeladas e infusiones: productos por unidad con lote y vida útil larga.', items: [
        ['CATEGORY', 'CAFE', null, { name: 'Café', line: 'CAFE' }], ['CATEGORY', 'FRUTOS_SECOS', null, { name: 'Frutos secos', line: 'FRUTOS_SECOS' }], ['CATEGORY', 'MERMELADAS', null, { name: 'Mermeladas', line: 'MERMELADAS' }], ['CATEGORY', 'INFUSIONES', null, { name: 'Infusiones', line: 'INFUSIONES' }],
        P('CAF-250', 'Café tostado molido 250 g', 'CAFE', 'UNIT', null, null, 32, 14.5, 'AMBIENT', 270, true, 'DIGESA'),
        P('CAF-G500', 'Café en grano 500 g', 'CAFE', 'UNIT', null, null, 55, 25, 'AMBIENT', 270, true, 'DIGESA'),
        P('ALM-250', 'Almendras tostadas 250 g', 'FRUTOS_SECOS', 'UNIT', null, null, 22, 12.4, 'AMBIENT', 240, true, 'DIGESA'),
        P('MER-AGU', 'Mermelada de aguaymanto 250 g', 'MERMELADAS', 'UNIT', null, null, 16, 6.2, 'AMBIENT', 180, true, 'DIGESA'),
        P('INF-MUN', 'Infusión de muña × 20 sobres', 'INFUSIONES', 'UNIT', null, null, 9, 3.9, 'AMBIENT', 365, true, 'DIGESA'),
        ['RECIPE', 'REC-MERMELADA', 'REC', { name: 'Mermelada de aguaymanto (paila de 12 kg)', product: 'MER-AGU', type: 'PRESERVE' }],
        ['CHECKLIST', 'CHK-SECO', 'CAL', { name: 'Almacén seco y control de plagas', stage: 'STORAGE', items: ['Humedad relativa ≤ 65 %', 'Trampas de plagas revisadas', 'Rotación por vencimiento (FEFO)', 'Envases sin abolladuras ni fugas'] }],
        ['KPI_TARGET', 'KPI-ALM-04', null, { target: 5, tol: 10, label: 'Stock por vencer ≤ 5 %' }],
        ['KPI_TARGET', 'KPI-CAT-01', null, { target: 100, tol: 2, label: 'Cobertura de precios 100 %' }],
        ['KPI_TARGET', 'KPI-PED-02', null, { target: 75, tol: 10, label: 'Ticket promedio ≥ S/ 75' }],
        ['PARAMETER', 'alm_expiry_alert_days', null, { value: 15, reason: 'Plantilla gourmet: vida útil larga' }],
      ],
    },
  };
  const ITEM_TYPE = { CATEGORY: 'Categoría', PRODUCT: 'Producto', VARIANT: 'Presentación', CUT: 'Corte', BREAKDOWN: 'Despiece', RECIPE: 'Receta', CHECKLIST: 'Checklist', KPI_TARGET: 'Meta de indicador', PARAMETER: 'Parámetro', ROLE: 'Rol', EXPENSE_CATEGORY: 'Categoría de gasto', DELIVERY_SLOT: 'Franja de entrega' };

  /* =====================================================================
     Importadores: definición de columnas
     ===================================================================== */
  const IMP = {
    PRODUCTS: { label: 'Productos y presentaciones', step: 'IMPORT_PRODUCTS', perm: 'onb.import.run', needs: ['brand'], fields: [['codigo', 'Código del producto', 1], ['nombre', 'Nombre del producto', 1], ['categoria', 'Categoría (código)', 1], ['sku', 'SKU de la presentación', 1], ['presentacion', 'Presentación', 1], ['modo_venta', 'Modo de venta (UNIDAD, KG, PESO_VARIABLE)', 1], ['peso_nominal_kg', 'Peso nominal (kg)', 0], ['tolerancia_pct', 'Tolerancia de peso (%)', 0], ['precio', 'Precio con IGV', 1], ['costo', 'Costo estándar', 0], ['requiere_lote', 'Requiere lote (SI/NO)', 0], ['conservacion', 'Conservación (REFRIGERADO, CONGELADO, AMBIENTE)', 0], ['vida_util_dias', 'Vida útil (días)', 0], ['codigo_barras', 'Código de barras', 0]], example: ['CUY-ENT', 'Cuy entero', 'CUY', 'CUY-ENT-09', 'Cuy entero beneficiado', 'PESO_VARIABLE', '0,9', '10', '42', '26,5', 'SI', 'REFRIGERADO', '7', ''] },
    CUSTOMERS: { label: 'Clientes con dirección', step: 'IMPORT_CUSTOMERS', perm: 'onb.import.run', needs: [], fields: [['tipo_doc', 'Tipo de documento (DNI, RUC, CE, NINGUNO)', 0], ['num_doc', 'Número de documento', 0], ['nombre', 'Nombre o razón social', 1], ['celular', 'Celular (9 dígitos)', 1], ['correo', 'Correo', 0], ['direccion', 'Dirección', 1], ['referencia', 'Referencia', 1], ['distrito', 'Distrito', 0], ['lat', 'Latitud', 0], ['lng', 'Longitud', 0], ['confianza_geo', 'Confianza de geocodificación (0 a 1)', 0], ['consentimiento', 'Acepta publicidad (SI/NO)', 0]], example: ['DNI', '45128833', 'Javier Cusi Mamani', '954112233', 'jcusi@correo.pe', 'Av. Benavides 4120 dpto 302', 'Frente al parque Reducto, edificio verde', 'Miraflores', '-12.1260', '-77.0190', '0,93', 'SI'] },
    SUPPLIERS: { label: 'Proveedores', step: null, perm: 'onb.import.run', needs: [], fields: [['tipo_doc', 'Tipo de documento (RUC, DNI)', 1], ['num_doc', 'Número de documento', 1], ['razon_social', 'Razón social', 1], ['nombre_comercial', 'Nombre comercial', 0], ['tipo', 'Tipo (PRODUCTOR, INSUMOS, EMPAQUES, SERVICIOS, DELIVERY, OTRO)', 0], ['plazo_dias', 'Plazo de pago (días)', 0], ['celular', 'Celular', 0], ['correo', 'Correo', 0]], example: ['RUC', '20554187237', 'CAMAL SAN PEDRO DE LURÍN SAC', 'Camal San Pedro', 'PRODUCTOR', '15', '987654321', 'ventas@camal.pe'] },
    PRICES: { label: 'Precios', step: null, perm: 'onb.import.run', needs: ['brand'], fields: [['lista', 'Lista de precios (código)', 0], ['sku', 'SKU', 1], ['precio', 'Precio con IGV', 1], ['base', 'Base (UNIDAD o KG)', 1], ['vigente_desde', 'Vigente desde (dd/mm/aaaa)', 0]], example: ['PUB', 'CUY-ENT', '43', 'KG', '01/11/2026'] },
    STOCK: { label: 'Stock inicial', step: 'IMPORT_STOCK', perm: 'onb.import.run', needs: ['warehouse', 'cutover'], fields: [['almacen', 'Almacén (código)', 0], ['sku', 'SKU', 1], ['lote', 'Lote', 0], ['vencimiento', 'Vencimiento (dd/mm/aaaa)', 0], ['cantidad', 'Cantidad', 1], ['peso_kg', 'Peso (kg)', 0], ['costo_unitario', 'Costo unitario', 1]], example: ['CAM-L1', 'CUY-ENT', 'L261030-01', '06/11/2026', '40', '36,4', '26,5'] },
    CUSTOMER_BALANCES: { label: 'Saldos por cobrar', step: 'IMPORT_BALANCES', perm: 'onb.balance.import', needs: ['company', 'cutover'], fields: [['num_doc', 'Documento del cliente', 1], ['tipo', 'Tipo (FACTURA, BOLETA, NC, ND, OTRO)', 1], ['referencia', 'Número del documento', 1], ['emision', 'Emisión (dd/mm/aaaa)', 1], ['vencimiento', 'Vencimiento (dd/mm/aaaa)', 0], ['importe', 'Importe', 1], ['saldo', 'Saldo', 1]], example: ['20512345678', 'FACTURA', 'F001-00003310', '15/10/2026', '14/11/2026', '1250', '850'] },
    SUPPLIER_BALANCES: { label: 'Saldos por pagar', step: 'IMPORT_BALANCES', perm: 'onb.balance.import', needs: ['company', 'cutover'], fields: [['num_doc', 'RUC del proveedor', 1], ['tipo', 'Tipo (FACTURA, BOLETA, NC, ND, OTRO)', 1], ['referencia', 'Número del documento', 1], ['emision', 'Emisión (dd/mm/aaaa)', 1], ['vencimiento', 'Vencimiento (dd/mm/aaaa)', 0], ['importe', 'Importe', 1], ['saldo', 'Saldo', 1]], example: ['20554187237', 'FACTURA', 'E001-00000981', '20/10/2026', '04/11/2026', '3200', '3200'] },
  };
  const DOC_MAP = { FACTURA: 'INVOICE', BOLETA: 'RECEIPT', NC: 'CREDIT_NOTE', ND: 'DEBIT_NOTE', OTRO: 'OTHER' };
  const MODE_MAP = { UNIDAD: 'UNIT', UNIT: 'UNIT', KG: 'KG', PESO_VARIABLE: 'UNIT_VARIABLE_WEIGHT', UNIT_VARIABLE_WEIGHT: 'UNIT_VARIABLE_WEIGHT' };
  const STORE_MAP = { REFRIGERADO: 'CHILLED', CONGELADO: 'FROZEN', AMBIENTE: 'AMBIENT', CHILLED: 'CHILLED', FROZEN: 'FROZEN', AMBIENT: 'AMBIENT' };
  const SUP_MAP = { PRODUCTOR: 'PRODUCER', INSUMOS: 'INPUTS', EMPAQUES: 'PACKAGING', SERVICIOS: 'SERVICES', DELIVERY: 'DELIVERY_COMPANY', OTRO: 'OTHER' };
  const BATCH = 500; // RN-ONB-16

  /* =====================================================================
     Dominio: registro, aprovisionamiento y pasos
     ===================================================================== */
  const runs = () => raw('onboarding_runs');
  const runGet = id => runs().find(r => r.id === id) || null;
  const stepsOf = run => raw('onboarding_steps').filter(s => s.run_id === run.id).sort(U.by('seq'));
  const stepOf = (run, code) => raw('onboarding_steps').find(s => s.run_id === run.id && s.step_code === code) || null;
  const liveSignup = ruc => raw('signup_requests').find(s => s.ruc === ruc && ['PENDING_VERIFICATION', 'VERIFIED', 'PROVISIONED'].includes(s.status));
  function progressOf(run) {
    const st = stepsOf(run); const req = st.filter(s => s.is_required); const done = req.filter(s => s.status === 'DONE');
    return { pct: req.length ? R(done.length / req.length * 100, 1) : 0, done: done.length, req: req.length, all: st.length, allDone: st.filter(s => s.status === 'DONE').length, pending: st.filter(s => s.status === 'PENDING').length };
  }

  /** ONB-01: registro público (RN-ONB-01 y RN-ONB-02) */
  function createSignup(d) {
    const ruc = String(d.ruc || '').trim();
    const p = sunatLookup(ruc); // RN-ONB-01 (dígito verificador)
    if (!/^ACTIVO$/i.test(p.status) || /NO HABIDO/i.test(p.condition)) {
      const rej = ins('signup_requests', { tenant: null, ruc, legal_name: p.legal_name, sunat_status: p.status, sunat_condition: p.condition, contact_name: d.contact_name, contact_email: d.contact_email, contact_phone: d.contact_phone || null, product_id: d.product || 'COMERCIAL', plan_id: d.plan || 'CRECIMIENTO', industry: d.industry || 'OTRO', status: 'REJECTED', reject_reason: `SUNAT: ${p.status} / ${p.condition}`, utm: { source: d.source || 'directo' }, expires_at: G.date.add(G.TODAY, 7) + 'T23:59', created_at: d.at || nowIso() }, { global: true });
      if (!d.noThrow) G.fail('RN-ONB-01', `El RUC ${ruc} figura en SUNAT como ${p.status} / ${p.condition}: el registro se rechaza (${rej.id}).`);
      return rej;
    }
    if (liveSignup(ruc)) G.fail('RN-ONB-02', `El RUC ${ruc} ya tiene un registro vivo (${G.ui.statusLabel(liveSignup(ruc).status)}): no se crea otro.`);
    const client = raw('companies').find(c => c.ruc === ruc && c.status !== 'VOIDED');
    if (client) {
      if (!G._seeding) within(client.tenant, () => G.notify({ role: 'ADMIN_SISTEMA', title: 'Nuevo registro con el RUC de tu empresa', body: `${d.contact_name} (${d.contact_email}) intentó registrar el RUC ${ruc} en Aycha. Ventas de Intelectalab te contactará.`, tone: 'warn', module: 'ONB' }));
      G.fail('RN-ONB-02', `El RUC ${ruc} ya es cliente de la plataforma (${tenantName(client.tenant)}): no se crea otro tenant; se deriva a ventas y se avisa a su administrador.`);
    }
    if (!d.contact_name || !d.contact_email) G.fail('RN-ONB-01', 'Indica el nombre y el correo de contacto.');
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(d.contact_email)) G.fail('RN-ONB-01', `El correo ${d.contact_email} no es válido.`);
    let phone = d.contact_phone ? String(d.contact_phone).replace(/\D/g, '') : '';
    if (phone && phone.length === 9) phone = '+51' + phone; else if (phone && phone.length === 11 && phone.startsWith('51')) phone = '+' + phone; else if (phone) G.fail('RN-ONB-01', 'El celular debe tener 9 dígitos.');
    const token = G._seeding ? 'tok-' + ruc.slice(-6) : U.token(24);
    const at = d.at || nowIso();
    const s = ins('signup_requests', { tenant: null, ruc, legal_name: p.legal_name, sunat_status: p.status, sunat_condition: p.condition, sunat_address: p.address, sunat_ubigeo: p.ubigeo, contact_name: d.contact_name, contact_email: d.contact_email.toLowerCase(), contact_phone: phone || null, product_id: d.product || 'COMERCIAL', plan_id: d.plan || 'CRECIMIENTO', industry: d.industry || 'DISTRIBUIDORA_CARNES', status: 'PENDING_VERIFICATION', email_token_hash: sha256(token), token_sent_at: at, utm: { source: d.source || 'directo', campaign: d.campaign || null }, expires_at: G.date.add(at.slice(0, 10), G.param('onb_signup_expire_days') || 7) + 'T23:59', created_at: at }, { global: true });
    s._token = token; // solo en memoria: el enlace del correo (simulado)
    return s;
  }
  function resendVerification(id) {
    const s = raw('signup_requests').find(x => x.id === id);
    if (!s || s.status !== 'PENDING_VERIFICATION') G.fail('RN-ONB-02', 'Solo se reenvía un registro pendiente de verificación.');
    const token = U.token(24);
    upd('signup_requests', s, { email_token_hash: sha256(token), token_sent_at: nowIso() }); s._token = token;
    return s;
  }
  /** verificación del correo → aprovisionamiento (RN-ONB-17). token opcional en la demo */
  function verifySignup(id, token, opts = {}) {
    const s = raw('signup_requests').find(x => x.id === id);
    if (!s) G.fail('RN-ONB-17', 'Registro no encontrado.');
    if (s.status === 'PROVISIONED') return provision(s.id, opts); // idempotente
    if (s.status !== 'PENDING_VERIFICATION' && s.status !== 'VERIFIED') G.fail('RN-ONB-17', `El registro está ${G.ui.statusLabel(s.status)}: no se puede verificar.`);
    if (token && sha256(token) !== s.email_token_hash) G.fail('RN-ONB-17', 'El enlace de verificación no corresponde a este registro.');
    const hours = G.param('onb_signup_token_hours') || 48;
    const at = opts.at || nowIso();
    if (!opts.ignoreExpiry && s.token_sent_at && G.date.diff(at.slice(0, 10), s.token_sent_at.slice(0, 10)) * 24 > hours) G.fail('RN-ONB-17', `El enlace venció (vigencia de ${hours} h, onb_signup_token_hours): reenvía la verificación.`);
    if (s.status === 'PENDING_VERIFICATION') { upd('signup_requests', s, { status: 'VERIFIED', email_verified_at: at }); emit('signup.verified', { signup_id: s.id, ruc: s.ruc }); }
    return provision(s.id, Object.assign({}, opts, { at }));
  }
  /** aprovisiona el tenant en una sola operación idempotente (RN-ONB-17) */
  function provision(signupId, opts = {}) {
    const s = raw('signup_requests').find(x => x.id === signupId);
    if (s.tenant_ref) { const r0 = runs().find(r => r.tenant === s.tenant_ref && r.status === 'IN_PROGRESS') || runs().find(r => r.tenant === s.tenant_ref); if (r0) return r0; }
    const tid = opts.tenantId || ('T-' + s.ruc.slice(2, 10));
    const plan = s.plan_id || 'CRECIMIENTO'; const pl = planOf(plan);
    const at = opts.at || nowIso();
    const short = (s.legal_name || '').replace(/\b(SAC|S\.A\.C\.|EIRL|SRL|SA)\b/g, '').trim().split(' ').slice(0, 3).join(' ');
    const slug = norm(short).replace(/_/g, '').slice(0, 16) || tid.toLowerCase();
    if (!tenantRow(tid)) ins('tenants', { id: tid, tenant: null, name: s.legal_name, short: titleCase(short), plan, status: 'TRIAL', hostname: slug + '.aycha.pe', product: s.product_id, created_at: at }, { global: true });
    const run = within(tid, () => {
      const live = G.db.find('onboarding_runs', r => r.status === 'IN_PROGRESS');
      if (live) return live; // RN-ONB-03
      const co = G.db.find('companies', c => c.ruc === s.ruc) || ins('companies', { id: 'co-' + tid, legal_name: s.legal_name, ruc: s.ruc, trade_name: titleCase(short), tax_regime: 'MYPE', fiscal_address: s.sunat_address || '', fiscal_ubigeo: s.sunat_ubigeo || '', status: 'ACTIVE', default_currency: 'PEN', timezone: 'America/Lima', sunat_status: s.sunat_status, sunat_condition: s.sunat_condition, primary_color: '#922242', created_at: at });
      const admin = G.db.find('users', u => u.role === 'ADMIN_SISTEMA') || ins('users', { id: 'us-' + tid + '-admin', name: s.contact_name, email: s.contact_email, role: 'ADMIN_SISTEMA', brands: [], sites: [], status: 'INVITED', twofa_required: true, twofa_enabled: false, mfa_enrolled_at: null, created_at: at });
      const days = G.param('sus_trial_days_default') || 14;
      let sub = null;
      if (G.sus && typeof G.sus.startTrial === 'function') { try { sub = G.sus.startTrial({ tenant: tid, product: s.product_id, plan, at }); } catch (e) { sub = null; } }
      if (!sub) sub = ins('subscriptions', { product_code: s.product_id, plan_code: plan, plan_version: 1, status: 'TRIAL', started_at: at, trial_ends_at: G.date.add(at.slice(0, 10), days), source: 'ONB', created_at: at });
      const on = new Set([...BASE_MODS, ...pl.mods]);
      for (const [code, spec] of Object.entries(G.SPEC)) if (!G.db.find('tenant_modules', m => m.module_code === code)) ins('tenant_modules', { module_code: code, phase: spec.phase, enabled: on.has(code) && code !== 'TEL', reason: on.has(code) ? `Plan ${pl.name}` : 'Fuera del plan', sus_source: 'PLAN', changed_at: at, changed_by: 'Aprovisionamiento ONB' }, { silent: true });
      for (const [code, name] of G.ROLES) if (!['CLIENTE_B2B', 'SOPORTE_PLATAFORMA'].includes(code) && !G.db.find('roles', r => r.code === code)) ins('roles', { code, name, is_system: true, requires_mfa: MFA_ROLES.includes(code), scope_mode: code === 'VENDEDORA' ? 'BRAND' : 'ALL', status: 'ACTIVE' }, { silent: true });
      for (const u of raw('units_of_measure').filter(x => x.tenant === 'DG')) if (!G.db.find('units_of_measure', x => x.code === u.code)) ins('units_of_measure', { id: u.id + '~' + tid, code: u.code, name: u.name, kind: u.kind, sunat_code: u.sunat_code }, { silent: true });
      if (!G.db.find('kpi_definitions', () => true)) for (const k of raw('kpi_definitions').filter(x => x.tenant === 'DG')) ins('kpi_definitions', Object.assign({}, k, { id: k.id + '~' + tid, tenant: tid }), { silent: true });
      if (!G.db.find('customers', c => c.customer_type === 'OTHER')) ins('customers', { id: 'cu-VARIOS~' + tid, doc_type: 'NONE', doc_number: null, full_name: 'Clientes varios', customer_type: 'OTHER', status: 'ACTIVE', marketing_opt_in: false });
      const r = ins('onboarding_runs', { id: opts.runId || undefined, signup_ref: s.id, industry: s.industry, industry_template_id: tplRow(templateFor(s.industry)) ? tplRow(templateFor(s.industry)).id : null, plan_code: plan, status: 'IN_PROGRESS', started_at: at, completed_at: null, go_live_at: null, planned_go_live: G.date.addMonths(G.date.add(at.slice(0, 10), 14), 1), first_accepted_document_at: null, owner_user_id: admin.id, company_id: co.id, subscription_id: sub && sub.id, created_at: at });
      STEPS.forEach((st, i) => ins('onboarding_steps', { run_id: r.id, step_code: st[0], seq: i + 1, is_required: st[3], status: 'PENDING', blocked_reason: null, completed_at: null, completed_by: null, owner_role: st[5] }, { silent: true }));
      return r;
    });
    upd('signup_requests', s, { status: 'PROVISIONED', tenant_ref: tid, provisioned_at: at });
    emit('tenant.provisioned', { tenant: tid, signup_id: s.id, plan });
    return run;
  }
  function titleCase(s) { return String(s || '').toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()); }

  /** ¿prerrequisitos del paso cumplidos? → lista de faltantes (RN-ONB-06) */
  function missingPre(run, code) {
    const def = STEP[code]; if (!def) return [];
    const st = stepsOf(run);
    if (def.pre[0] === '*') return st.filter(s => s.step_code !== 'GO_LIVE' && (s.status === 'PENDING' || s.status === 'BLOCKED' || (s.is_required && s.status !== 'DONE'))).map(s => s.step_code);
    return def.pre.filter(p => { const s = st.find(x => x.step_code === p); return !s || !(s.status === 'DONE' || (s.status === 'SKIPPED' && SKIP_OK_AS_PRE.includes(p))); });
  }
  const stepLabel = c => (STEP[c] || { name: c }).name;
  /** comprueba que el paso pueda trabajarse (prerrequisitos) antes de una acción del asistente */
  function assertCanWork(run, code) {
    if (!run || run.status !== 'IN_PROGRESS') return; // altas terminadas: la configuración posterior no se bloquea
    const m = missingPre(run, code);
    if (m.length) G.fail(code === 'GO_LIVE' ? 'RN-ONB-05' : 'RN-ONB-06', `«${stepLabel(code)}» requiere antes: ${m.map(x => `${stepLabel(x)} (${G.ui.statusLabel((stepOf(run, x) || {}).status || 'PENDING').toLowerCase()})`).join(', ')}.`);
  }
  function completeStep(runId, code, opts = {}) {
    const run = typeof runId === 'string' ? runGet(runId) : runId;
    if (!run) G.fail('RN-ONB-03', 'Alta no encontrada.');
    if (!G._seeding && !opts.system) guard('onb.setup.run');
    const st = stepOf(run, code); if (!st) G.fail('RN-ONB-04', `El paso ${code} no existe en esta alta.`);
    if (st.status === 'DONE') return st;
    assertCanWork(run, code);
    if (code === 'GO_LIVE') {
      const req = stepsOf(run).filter(s => s.is_required && s.step_code !== 'GO_LIVE' && s.status !== 'DONE');
      if (req.length) G.fail('RN-ONB-05', `Faltan pasos obligatorios: ${req.map(s => stepLabel(s.step_code)).join(', ')}.`);
      if (!run.first_accepted_document_at) G.fail('RN-ONB-05', 'Para salir a producción se necesita el primer comprobante real aceptado por SUNAT (ONB-15).');
    }
    if (!opts.system) { const miss = within(run.tenant, () => evidence(run, code)); if (miss) G.fail('RN-ONB-05', `«${stepLabel(code)}» no se puede marcar como hecho: ${miss}.`); }
    const by = opts.by || G.ctx.userName(); const at = opts.at || nowIso();
    upd('onboarding_steps', st, { status: 'DONE', completed_at: at, completed_by: by, blocked_reason: null });
    emit('onboarding.step_completed', { run_id: run.id, step: code, tenant: run.tenant });
    if (code === 'GO_LIVE') {
      upd('onboarding_runs', run, { status: 'COMPLETED', completed_at: at, go_live_at: opts.goLive || at.slice(0, 10) });
      if (tenantRow(run.tenant) && tenantRow(run.tenant).status === 'ONBOARDING') upd('tenants', tenantRow(run.tenant), { status: 'TRIAL' });
      emit('onboarding.completed', { run_id: run.id, tenant: run.tenant });
    }
    return st;
  }
  /** datos mínimos para marcar a mano un paso como hecho (null = hay evidencia) */
  function evidence(run, code) {
    const n = (t, p = () => true) => G.db.where(t, p).length;
    switch (code) {
      case 'COMPANY': return (G.db.get('companies', run.company_id) || {}).fiscal_address ? null : 'falta el domicilio fiscal (ONB-03)';
      case 'BRANDS': return n('brands', b => b.status === 'ACTIVE') ? null : 'registra al menos una marca (ONB-04)';
      case 'ESTABLISHMENTS': return n('establishments') ? null : 'registra al menos un local (ONB-05)';
      case 'WAREHOUSES': return n('warehouses') ? null : 'registra al menos un almacén (ONB-05)';
      case 'SERIES': return n('document_series', x => x.doc_type === 'RECEIPT') && n('document_series', x => x.doc_type === 'INVOICE') ? null : 'faltan las series de factura y boleta (ONB-06)';
      case 'EINVOICE': return ((G.db.get('companies', run.company_id) || {}).einvoice_test || {}).result === 'ACCEPTED' ? null : 'falta el comprobante de prueba aceptado por el OSE (ONB-06)';
      case 'PAYMENT_METHODS': return n('payment_methods', p => p.status === 'ACTIVE') && n('cash_accounts') ? null : 'activa un medio de pago y una caja (ONB-07)';
      case 'WHATSAPP': return n('messaging_channels', c => c.kind === 'WHATSAPP') ? null : 'conecta al menos un número (ONB-08)';
      case 'DELIVERY_ZONES': return n('delivery_zones') ? null : 'registra al menos una zona (ONB-09)';
      case 'TEMPLATE': return n('template_applications') ? null : 'aplica la plantilla a una marca (ONB-10)';
      case 'USERS': return n('users', u => u.role !== 'ADMIN_SISTEMA' && !u.platform) ? null : 'invita al menos a un usuario (ONB-14)';
      case 'IMPORT_PRODUCTS': case 'IMPORT_CUSTOMERS': case 'IMPORT_STOCK': case 'IMPORT_BALANCES': { const types = Object.entries(IMP).filter(([, d]) => d.step === code).map(([k]) => k); return n('data_imports', i => i.run_id === run.id && types.includes(i.import_type) && i.status === 'COMPLETED') ? null : 'ejecuta una importación de este tipo (ONB-11 a ONB-13) u omite el paso'; }
      default: return null;
    }
  }
  function skipStep(runId, code, reason) {
    const run = typeof runId === 'string' ? runGet(runId) : runId; guard('onb.setup.run');
    const st = stepOf(run, code);
    if (st.is_required) G.fail('RN-ONB-04', `«${stepLabel(code)}» es obligatorio: no se puede omitir.`);
    if (st.status === 'DONE') G.fail('RN-ONB-04', 'El paso ya está hecho.');
    upd('onboarding_steps', st, { status: 'SKIPPED', completed_at: nowIso(), completed_by: G.ctx.userName(), blocked_reason: reason || 'Omitido por la empresa' });
    return st;
  }
  function setRequired(runId, code, req) {
    const run = typeof runId === 'string' ? runGet(runId) : runId; guard('onb.setup.run');
    if (FIXED_REQUIRED.includes(code)) G.fail('RN-ONB-04', `«${stepLabel(code)}» es obligatorio en toda alta.`);
    const st = stepOf(run, code);
    if (st.status !== 'PENDING' && req) G.fail('RN-ONB-04', 'Solo un paso pendiente pasa a obligatorio.');
    upd('onboarding_steps', st, { is_required: !!req });
  }
  /** marca un paso como hecho al terminar su acción (si el alta sigue en curso) */
  function autoStep(run, code, by) { if (!run || run.status !== 'IN_PROGRESS') return; const st = stepOf(run, code); if (st && st.status !== 'DONE') completeStep(run, code, { system: true, by }); }
  function nextStep(run) { return stepsOf(run).find(s => s.status === 'PENDING' && !missingPre(run, s.step_code).length) || stepsOf(run).find(s => s.status === 'PENDING') || null; }

  /* ---------- configuración del tenant (ONB-03 a ONB-09, ONB-14) ---------- */
  function saveCompany(runId, v) {
    const run = runGet(runId); guard('onb.setup.run'); const by = G.ctx.userName();
    within(run.tenant, () => {
      const co = G.db.get('companies', run.company_id);
      if (!v.trade_name) G.fail('RN-ONB-01', 'Indica el nombre comercial.');
      if (!v.fiscal_address) G.fail('RN-ONB-01', 'Indica el domicilio fiscal.');
      if (v.primary_color && !/^#[0-9a-f]{6}$/i.test(v.primary_color)) G.fail('RN-ONB-01', 'El color debe tener el formato #RRGGBB.');
      G.db.update('companies', co.id, { trade_name: v.trade_name, fiscal_address: v.fiscal_address, fiscal_ubigeo: v.fiscal_ubigeo || co.fiscal_ubigeo, tax_regime: v.tax_regime || co.tax_regime, logo_url: v.logo_url || null, primary_color: v.primary_color || co.primary_color, secondary_color: v.secondary_color || null }, { silent: !!G._seeding });
      const t = tenantRow(run.tenant); if (t) upd('tenants', t, { short: v.trade_name });
      autoStep(run, 'COMPANY', by);
    });
  }
  function addBrand(runId, v) {
    const run = runGet(runId); guard('onb.setup.run'); const by = G.ctx.userName();
    return within(run.tenant, () => {
      assertCanWork(run, 'BRANDS');
      const code = String(v.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{2,6}$/.test(code)) G.fail('RN-ONB-04', 'El código de la marca tiene de 2 a 6 letras o números.');
      if (G.db.find('brands', b => b.code === code)) G.fail('RN-ONB-04', `Ya existe la marca ${code}.`);
      if (!v.name) G.fail('RN-ONB-04', 'Indica el nombre de la marca.');
      const lim = planOf(run.plan_code).brands; const n = G.db.where('brands', b => b.status === 'ACTIVE').length;
      if (n >= lim) G.fail('RN-SUS-06', `El plan ${planName(run.plan_code)} permite ${lim} marca(s) activa(s) y ya tienes ${n}: contrata marcas adicionales o sube de plan.`);
      const co = G.db.get('companies', run.company_id);
      const b = ins('brands', { id: 'br-' + code + '~' + run.tenant, company_id: co.id, code, name: v.name, primary_color: v.color || '#922242', description: v.description || null, legal_footer: `${v.name} es una marca de ${co.legal_name} · RUC ${co.ruc}`, whatsapp_display_name: v.wa_name || v.name, status: 'ACTIVE', sort_order: n + 1, logo_url: v.logo_url || null });
      autoStep(run, 'BRANDS', by);
      return b;
    });
  }
  function addEstablishment(runId, v) {
    const run = runGet(runId); guard('onb.setup.run'); const by = G.ctx.userName();
    return within(run.tenant, () => {
      assertCanWork(run, 'ESTABLISHMENTS');
      const code = String(v.code || '').trim().toUpperCase();
      if (!code) G.fail('RN-ONB-06', 'Indica el código del local.');
      if (G.db.find('establishments', e => e.code === code)) G.fail('RN-ONB-06', `Ya existe el local ${code}.`);
      if (!/^\d{4}$/.test(String(v.sunat_code || ''))) G.fail('RN-ONB-06', 'El código de anexo SUNAT tiene 4 dígitos (0000 es el domicilio fiscal).');
      if (G.db.find('establishments', e => e.sunat_code === v.sunat_code)) G.fail('RN-ONB-06', `El anexo ${v.sunat_code} ya está usado por otro local.`);
      const lim = planOf(run.plan_code).sites; const n = G.db.all('establishments').length;
      if (n >= lim) G.fail('RN-SUS-06', `El plan ${planName(run.plan_code)} permite ${lim} local(es) y ya tienes ${n}.`);
      const e = ins('establishments', { id: 'es-' + code + '~' + run.tenant, company_id: run.company_id, code, name: v.name, short: v.short || v.name, sunat_code: v.sunat_code, est_type: v.est_type || 'MIXED', address: v.address || '', status: 'ACTIVE', has_counter: !!v.has_counter });
      autoStep(run, 'ESTABLISHMENTS', by);
      return e;
    });
  }
  const WH_TYPES = [['MAIN', 'Almacén principal (seco)'], ['COLD_ROOM', 'Cámara de frío'], ['FREEZER', 'Congeladora'], ['STORE', 'Tienda o exhibidora'], ['QUARANTINE', 'Cuarentena'], ['PRODUCTION', 'Sala de producción']];
  function addWarehouse(runId, v) {
    const run = runGet(runId); guard('onb.setup.run'); const by = G.ctx.userName();
    return within(run.tenant, () => {
      assertCanWork(run, 'WAREHOUSES');
      const code = String(v.code || '').trim().toUpperCase();
      if (!v.establishment_id) G.fail('RN-ONB-06', 'Elige el local del almacén.');
      if (!code) G.fail('RN-ONB-06', 'Indica el código del almacén.');
      if (G.db.find('warehouses', w => w.code === code)) G.fail('RN-ONB-06', `Ya existe el almacén ${code}.`);
      const mi = v.min_temp_c === '' || v.min_temp_c == null ? null : Number(v.min_temp_c), ma = v.max_temp_c === '' || v.max_temp_c == null ? null : Number(v.max_temp_c);
      if (mi != null && ma != null && mi >= ma) G.fail('RN-ONB-06', 'La temperatura mínima debe ser menor que la máxima.');
      if (v.wh_type === 'COLD_ROOM' && (ma == null || ma > (G.param('alm_max_temp_chilled_c') ?? 4))) G.fail('RN-ALM-04', `Una cámara de frío trabaja hasta ${G.param('alm_max_temp_chilled_c') ?? 4} °C.`);
      if (v.wh_type === 'FREEZER' && (ma == null || ma > (G.param('alm_max_temp_frozen_c') ?? -18))) G.fail('RN-ALM-04', `Una congeladora trabaja a ${G.param('alm_max_temp_frozen_c') ?? -18} °C o menos.`);
      const w = ins('warehouses', { id: 'wh-' + code + '~' + run.tenant, establishment_id: v.establishment_id, code, name: v.name, wh_type: v.wh_type || 'MAIN', min_temp_c: mi, max_temp_c: ma, status: 'ACTIVE', allows_sale: ['MAIN', 'COLD_ROOM', 'FREEZER', 'STORE'].includes(v.wh_type || 'MAIN'), pick_priority: Number(v.pick_priority) || 10 });
      autoStep(run, 'WAREHOUSES', by);
      return w;
    });
  }
  /** ONB-06: series propuestas por empresa (una serie) o por marca (una por marca) */
  function proposeSeries(runId, mode = 'BRAND') {
    const run = runGet(runId); guard('onb.setup.run'); const by = G.ctx.userName();
    return within(run.tenant, () => {
      assertCanWork(run, 'SERIES');
      const brands = G.db.where('brands', b => b.status === 'ACTIVE').sort(U.by('sort_order'));
      const ests = G.db.all('establishments').sort(U.by('sunat_code'));
      if (!ests.length) G.fail('RN-ONB-06', 'Registra al menos un local antes de las series.');
      const main = ests[0];
      const out = [];
      const add = (doc_type, series, brand_id, est, extra = {}) => { if (G.db.find('document_series', s => s.series === series)) return; out.push(ins('document_series', Object.assign({ id: 'se-' + series + '~' + run.tenant, company_id: run.company_id, establishment_id: est, brand_id, doc_type, series, next_number: 1, is_electronic: true, status: 'ACTIVE' }, extra))); };
      const list = mode === 'BRAND' && brands.length ? brands : [null];
      list.forEach((b, i) => { const n = i + 1; add('INVOICE', `F00${n}`, b && b.id, main.id); add('RECEIPT', `B00${n}`, b && b.id, main.id); add('CREDIT_NOTE', `FC0${n}`, b && b.id, main.id, { applies_to: 'INVOICE' }); add('CREDIT_NOTE', `BC0${n}`, b && b.id, main.id, { applies_to: 'RECEIPT' }); });
      ests.forEach((e, i) => add('DISPATCH_GUIDE', `T00${i + 1}`, null, e.id));
      autoStep(run, 'SERIES', by);
      return out;
    });
  }
  /** RN-ONB-18: el último correlativo del sistema anterior fija el siguiente; no se reutiliza un número emitido */
  function setLastNumber(runId, series, last) {
    const run = runGet(runId); guard('onb.setup.run');
    return within(run.tenant, () => {
      const s = G.db.find('document_series', x => x.series === series); if (!s) G.fail('RN-PLT-03', `No existe la serie ${series}.`);
      const n = Number(last); if (!Number.isInteger(n) || n < 0) G.fail('RN-ONB-18', 'El último correlativo es un número entero mayor o igual que 0.');
      const used = G.db.where('sales_documents', d => d.series === series).reduce((m, d) => Math.max(m, d.number), 0);
      if (used && n + 1 <= used) G.fail('RN-ONB-18', `En Aycha ya se emitió ${series}-${U.pad(used, 8)}: no se puede reutilizar un número emitido.`);
      if (n + 1 < s.next_number && used) G.fail('RN-ONB-18', `La numeración ya va en ${series}-${U.pad(s.next_number, 8)}.`);
      G.db.update('document_series', s.id, { next_number: n + 1, legacy_last_number: n }, { silent: !!G._seeding });
      return s;
    });
  }
  /** credenciales del OSE y comprobante de prueba (adaptador FAKE del EInvoiceProvider) */
  function testEinvoice(runId, v) {
    const run = runGet(runId); guard('onb.setup.run'); const by = G.ctx.userName();
    return within(run.tenant, () => {
      assertCanWork(run, 'EINVOICE');
      if (!v.provider || !v.user || !v.secret) G.fail('RN-ONB-06', 'Completa el proveedor, el usuario y la clave del OSE.');
      if (String(v.secret).length < 8) G.fail('RN-ONB-06', 'La clave del OSE tiene al menos 8 caracteres.');
      const ser = G.db.find('document_series', s => s.doc_type === 'RECEIPT');
      if (!ser) G.fail('RN-ONB-06', 'Primero crea las series (B001).');
      const ok = !/fail|error/i.test(v.user);
      const at = v.at || nowIso();
      const co = G.db.get('companies', run.company_id);
      G.db.update('companies', co.id, { einvoice_provider: v.provider, einvoice_user: v.user, einvoice_secret_last4: String(v.secret).slice(-4), einvoice_env: 'BETA', einvoice_test: { at, series: ser.series, result: ok ? 'ACCEPTED' : 'REJECTED', ticket: 'BETA-' + sha256(at + v.user).slice(0, 10).toUpperCase(), message: ok ? 'La boleta de prueba fue aceptada en el entorno de homologación.' : 'Credenciales rechazadas por el OSE (usuario o clave)' } }, { silent: !!G._seeding });
      if (!ok) G.fail('RN-ONB-06', 'El OSE rechazó las credenciales: revisa usuario y clave.');
      autoStep(run, 'EINVOICE', by);
      return co.einvoice_test;
    });
  }
  const PM_DEFAULTS = [['CASH', 'Efectivo', 'CASH', false, true], ['YAPE', 'Yape', 'WALLET', true, true], ['PLIN', 'Plin', 'WALLET', true, true], ['CARD', 'Tarjeta (POS)', 'CARD', true, true], ['GATEWAY', 'Pasarela web', 'GATEWAY', true, false], ['TRANSFER', 'Transferencia bancaria', 'BANK', true, false]];
  function savePayments(runId, codes, cashBoxes) {
    const run = runGet(runId); guard('onb.setup.run'); const by = G.ctx.userName();
    within(run.tenant, () => {
      assertCanWork(run, 'PAYMENT_METHODS');
      if (!codes.length) G.fail('RN-ONB-06', 'Activa al menos un medio de pago.');
      for (const [c, n, k, ref, cod] of PM_DEFAULTS) {
        const ex = G.db.find('payment_methods', p => p.code === c);
        if (ex) G.db.update('payment_methods', ex.id, { status: codes.includes(c) ? 'ACTIVE' : 'INACTIVE' }, { silent: !!G._seeding });
        else if (codes.includes(c)) ins('payment_methods', { id: 'pm-' + c + '~' + run.tenant, code: c, name: n, kind: k, requires_reference: ref, allowed_on_delivery: cod, status: 'ACTIVE' });
      }
      for (const cb of cashBoxes || []) if (!G.db.find('cash_accounts', a => a.code === cb.code)) ins('cash_accounts', { id: 'ca-' + cb.code + '~' + run.tenant, code: cb.code, name: cb.name, account_type: cb.type, establishment_id: cb.establishment_id || null, currency: 'PEN', status: 'ACTIVE', account_number: cb.account_number || null });
      if (!G.db.where('cash_accounts', () => true).length) G.fail('RN-ONB-06', 'Crea al menos una caja (por ejemplo la caja del local).');
      autoStep(run, 'PAYMENT_METHODS', by);
    });
  }
  /** RN-ONB-19 (y RN-SUS-06): número de WhatsApp ligado a marca o compartido, dentro del límite del plan */
  function connectWhatsapp(runId, v) {
    const run = runGet(runId); guard('onb.setup.run'); const by = G.ctx.userName();
    return within(run.tenant, () => {
      assertCanWork(run, 'WHATSAPP');
      let num = String(v.number || '').replace(/\D/g, ''); if (num.length === 9) num = '51' + num;
      if (!/^51\d{9}$/.test(num)) G.fail('RN-ONB-19', 'El número debe ser un celular peruano de 9 dígitos.');
      num = '+' + num;
      if (!v.brand_id && !v.shared) G.fail('RN-ONB-19', 'Liga el número a una marca o márcalo como compartido.');
      if (G.db.find('messaging_channels', c => c.number === num && c.status !== 'DISCONNECTED')) G.fail('RN-ONB-19', `El número ${num} ya está conectado.`);
      const lim = planOf(run.plan_code).wa; const n = G.db.where('messaging_channels', c => c.kind === 'WHATSAPP' && c.status !== 'DISCONNECTED').length;
      if (n >= lim) G.fail('RN-SUS-06', `El plan ${planName(run.plan_code)} permite ${lim} número(s) de WhatsApp y ya tienes ${n}.`);
      const ch = ins('messaging_channels', { kind: 'WHATSAPP', brand_id: v.shared ? null : v.brand_id, shared: !!v.shared, number: num, display_name: v.display_name || num, coexistence: v.coexistence !== false, provider: 'CLOUD_API', status: 'ACTIVE', quality_rating: 'HIGH', messaging_limit: 250, embedded_signup_at: nowIso(), waba_id: 'WABA-' + sha256(num).slice(0, 8) });
      autoStep(run, 'WHATSAPP', by);
      return ch;
    });
  }
  function addZone(runId, v) {
    const run = runGet(runId); guard('onb.setup.run'); const by = G.ctx.userName();
    return within(run.tenant, () => {
      assertCanWork(run, 'DELIVERY_ZONES');
      const code = String(v.code || '').trim().toUpperCase();
      if (!code || !v.name) G.fail('RN-ONB-06', 'Indica el código y el nombre de la zona.');
      if (!v.establishment_id) G.fail('RN-ONB-06', 'Elige el local que despacha la zona.');
      if (G.db.find('delivery_zones', z => z.code === code)) G.fail('RN-ONB-06', `Ya existe la zona ${code}.`);
      const districts = String(v.districts || '').split(',').map(x => x.trim()).filter(Boolean);
      if (!districts.length) G.fail('RN-ONB-06', 'Indica al menos un distrito (separados por coma).');
      if (!(Number(v.delivery_fee) >= 0)) G.fail('RN-ONB-06', 'La tarifa no puede ser negativa.');
      const z = ins('delivery_zones', { id: 'dz-' + code + '~' + run.tenant, establishment_id: v.establishment_id, code, name: v.name, districts, delivery_fee: Number(v.delivery_fee) || 0, free_from_units: Number(v.free_from_units) || null, free_from_kg: Number(v.free_from_kg) || null, min_order_amount: Number(v.min_order_amount) || 0, province: !!v.province, status: 'ACTIVE' });
      autoStep(run, 'DELIVERY_ZONES', by);
      return z;
    });
  }
  function inviteUser(runId, v) {
    const run = runGet(runId); guard('onb.setup.run'); const by = G.ctx.userName();
    return within(run.tenant, () => {
      assertCanWork(run, 'USERS');
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v.email || '')) G.fail('RN-ONB-06', 'Indica un correo válido.');
      if (!v.name) G.fail('RN-ONB-06', 'Indica el nombre.');
      if (G.db.find('users', u => u.email === v.email.toLowerCase())) G.fail('RN-ONB-06', `Ya existe un usuario con ${v.email}.`);
      if (v.role === 'VENDEDORA' && !(v.brands || []).length) G.fail('RN-ONB-06', 'Una vendedora necesita al menos una marca.');
      const lim = planOf(run.plan_code).users; const n = G.db.where('users', u => ['ACTIVE', 'INVITED'].includes(u.status) && !u.platform && u.role !== 'CLIENTE_B2B').length;
      if (n >= lim) G.fail('RN-SUS-06', `El plan ${planName(run.plan_code)} permite ${lim} usuarios del personal y ya tienes ${n}.`);
      const role = G.db.find('roles', r => r.code === v.role);
      const u = ins('users', { name: v.name, email: v.email.toLowerCase(), role: v.role, brands: v.brands || [], sites: v.sites || [], status: 'INVITED', twofa_required: role ? !!role.requires_mfa : MFA_ROLES.includes(v.role), twofa_enabled: false, invited_at: nowIso(), invited_by: by });
      autoStep(run, 'USERS', by);
      return u;
    });
  }
  /** la invitación se acepta; los roles que exigen segundo factor lo activan al entrar */
  function acceptInvite(runId, userId, withMfa) {
    const run = runGet(runId);
    return within(run.tenant, () => {
      const u = G.db.get('users', userId);
      if (u.twofa_required && !withMfa) G.fail('RN-SEG-03', `El rol ${G.roleName(u.role)} exige segundo factor: el usuario debe activarlo al aceptar la invitación.`);
      return G.db.update('users', u.id, { status: 'ACTIVE', twofa_enabled: !!withMfa || !!u.twofa_enabled, mfa_enrolled_at: withMfa ? nowIso() : u.mfa_enrolled_at, last_login: nowIso() });
    });
  }
  /** ONB-15: primer comprobante real (lo consume también el evento document.accepted) */
  function issueFirstDocument(runId, v = {}) {
    const run = runGet(runId); guard('onb.setup.run');
    return within(run.tenant, () => {
      const eStep = stepOf(run, 'EINVOICE');
      if (eStep && eStep.status !== 'DONE') G.fail('RN-ONB-06', 'Primero conecta el OSE y envía el comprobante de prueba (ONB-06).');
      const series = v.series || (G.db.find('document_series', s => s.doc_type === 'RECEIPT' && s.status === 'ACTIVE') || {}).series;
      if (!series) G.fail('RN-PLT-03', 'No hay series de boleta.');
      const ser = G.db.find('document_series', s => s.series === series);
      const brand = ser.brand_id || (G.db.find('brands', b => b.status === 'ACTIVE') || {}).id;
      const total = Number(v.amount) || 45;
      const cust = G.db.find('customers', c => c.customer_type === 'OTHER');
      const doc = G.docs.issue({ doc_type: ser.doc_type, brand_id: brand, establishment_id: ser.establishment_id, customer_id: cust && cust.id, series, lines: [{ description: v.description || 'Primera venta en Aycha', qty: 1, uom_code: 'NIU', unit_price: total, total, igv_affectation: '10' }], date: v.date || G.TODAY, accept: true });
      G.db.update('sales_documents', doc.id, { company_id: run.company_id }, { silent: true });
      if (!run.first_accepted_document_at) upd('onboarding_runs', run, { first_accepted_document_at: v.at || nowIso(), first_document_id: doc.id });
      return doc;
    });
  }
  function goLive(runId, date) {
    const run = runGet(runId); guard('onb.setup.run');
    if (date && date < G.TODAY) G.fail('RN-ONB-05', 'La fecha de inicio de operación no puede ser anterior a hoy.');
    return within(run.tenant, () => completeStep(run, 'GO_LIVE', { goLive: date || G.TODAY }));
  }
  // consume document.accepted (FAC): fija el primer comprobante aceptado del alta en curso del tenant
  G.events.on('document.accepted', p => {
    const r = G.db.find('onboarding_runs', x => x.status === 'IN_PROGRESS');
    if (r && !r.first_accepted_document_at) G.db.update('onboarding_runs', r.id, { first_accepted_document_at: G.date.now(), first_document_id: p.document_id }, { silent: true });
  });

  /* ---------- plantillas por rubro (RN-ONB-07) ---------- */
  const tplRow = code => raw('industry_templates').find(t => t.code === code && t.status === 'PUBLISHED') || null;
  const tplItems = tpl => raw('industry_template_items').filter(i => i.template_id === tpl.id).sort(U.by('seq'));
  function applyTemplate(runId, templateCode, brandId, opts = {}) {
    const run = runGet(runId); guard('onb.template.apply'); const by = G.ctx.userName();
    const tpl = tplRow(templateCode); if (!tpl) G.fail('RN-ONB-07', `No hay una plantilla publicada ${templateCode}.`);
    return within(run.tenant, () => {
      assertCanWork(run, 'TEMPLATE');
      const brand = G.db.get('brands', brandId); if (!brand) G.fail('RN-ONB-07', 'Elige la marca a la que se aplica la plantilla.');
      const prev = G.db.find('template_applications', a => a.template_id === tpl.id && a.brand_id === brandId && a.status !== 'FAILED');
      if (prev) G.fail('RN-ONB-07', `La plantilla ${tpl.name} ya se aplicó a ${brand.name} el ${F.datetime(prev.applied_at)}: se aplica una vez por marca.`);
      const detail = []; let created = 0, skipped = 0, failed = 0;
      const pl = G.db.find('price_lists', l => l.brand_id === brandId && l.code === 'PUB') || ins('price_lists', { brand_id: brandId, code: 'PUB', name: 'Lista pública ' + brand.name, channels: ['WHATSAPP', 'WEB', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM', 'PHONE', 'COUNTER'], includes_igv: true, status: 'ACTIVE' });
      for (const it of tplItems(tpl)) {
        const p = it.payload; const res = { item_type: it.item_type, item_code: it.item_code, name: p.name || p.label || it.item_code };
        try {
          if (it.requires_module && !G.modOn(it.requires_module)) { res.result = 'SKIPPED'; res.reason = `Requiere ${it.requires_module} (${(G.SPEC[it.requires_module] || {}).name || ''}), apagado en esta empresa`; }
          else {
            const r = applyItem(it, p, brand, pl);
            Object.assign(res, r);
          }
        } catch (e) { res.result = 'FAILED'; res.reason = e.message; }
        if (res.result === 'CREATED') created++; else if (res.result === 'SKIPPED') skipped++; else failed++;
        detail.push(res);
      }
      const byModule = detail.some(d => d.result === 'SKIPPED' && /^Requiere/.test(d.reason || ''));
      const app = ins('template_applications', { run_id: run.id, template_id: tpl.id, template_code: tpl.code, template_version: tpl.version, brand_id: brandId, mode: 'SKIP_EXISTING', status: failed ? 'PARTIAL' : byModule ? 'PARTIAL' : 'APPLIED', items_created: created, items_skipped: skipped, items_failed: failed, applied_at: opts.at || nowIso(), applied_by: by, detail });
      autoStep(run, 'TEMPLATE', by);
      emit('template.applied', { run_id: run.id, template: tpl.code, brand_id: brandId, created, skipped, failed });
      return app;
    });
  }
  function applyItem(it, p, brand, pl) {
    const code = it.item_code; const T = (t, pred) => G.db.find(t, pred);
    switch (it.item_type) {
      case 'CATEGORY': {
        if (T('product_categories', c => c.code === code)) return { result: 'SKIPPED', reason: 'Ya existe con el mismo código' };
        const c = ins('product_categories', { id: 'pc-' + code + '~' + G.ctx.tenant, code, name: p.name, line: p.line || code, source: 'TEMPLATE' }); return { result: 'CREATED', target_id: c.id };
      }
      case 'PRODUCT': {
        if (T('products', x => x.code === code) || T('product_variants', x => x.sku === p.sku)) return { result: 'SKIPPED', reason: 'Ya existe con el mismo código' };
        const cat = T('product_categories', c => c.code === p.category); if (!cat) return { result: 'FAILED', reason: `Falta la categoría ${p.category}` };
        const pr = ins('products', { brand_id: brand.id, category_id: cat.id, code, name: p.name, line: cat.line, product_type: 'GOODS', origin: 'PRODUCED', storage: p.storage, shelf_life_days: p.shelf, requires_lot: !!p.lot, igv_affectation: '10', sanitary_authority: p.authority, status: 'ACTIVE', web_publishable: false, source: 'TEMPLATE' });
        const tol = p.tol || null;
        const v = ins('product_variants', { product_id: pr.id, brand_id: brand.id, sku: p.sku, name: p.name, uom_id: p.mode === 'UNIT' ? 'um-NIU' : 'um-KGM', sale_mode: p.mode, nominal_weight_kg: p.kg || null, weight_tolerance_pct: tol, min_weight_kg: p.kg ? R(p.kg * (1 - tol / 100), 3) : null, max_weight_kg: p.kg ? R(p.kg * (1 + tol / 100), 3) : null, status: 'ACTIVE', std_cost: p.cost, sellable: true, line: cat.line });
        ins('price_list_items', { list_id: pl.id, variant_id: v.id, price: p.price, basis: p.mode === 'UNIT' ? 'UNIT' : 'KG', valid_from: G.TODAY, valid_to: null });
        return { result: 'CREATED', target_id: v.id };
      }
      case 'CUT': {
        if (T('cut_types', c => c.code === code)) return { result: 'SKIPPED', reason: 'Ya existe con el mismo código' };
        const c = ins('cut_types', { code, name: p.name, applies_to_lines: p.lines || [], sort_order: it.seq, status: 'ACTIVE', source: 'TEMPLATE' }); return { result: 'CREATED', target_id: c.id };
      }
      case 'BREAKDOWN': {
        if (T('cutting_templates', c => c.code === code)) return { result: 'SKIPPED', reason: 'Ya existe con el mismo código' };
        const c = ins('cutting_templates', { code, name: p.name, species: p.species, version: 1, mass_balance_tolerance_pct: 2, status: 'DRAFT', lines: p.lines.map(([n, y]) => ({ output: n, yield_pct: y })), source: 'TEMPLATE' }); return { result: 'CREATED', target_id: c.id };
      }
      case 'RECIPE': {
        if (T('recipes', c => c.code === code)) return { result: 'SKIPPED', reason: 'Ya existe con el mismo código' };
        const prod = T('products', x => x.code === p.product);
        const c = ins('recipes', { product_id: prod ? prod.id : null, code, name: p.name, recipe_type: p.type, brand_id: brand.id, status: 'DRAFT', source: 'TEMPLATE' }); return { result: 'CREATED', target_id: c.id };
      }
      case 'CHECKLIST': {
        if (T('qc_checklists', c => c.code === code)) return { result: 'SKIPPED', reason: 'Ya existe con el mismo código' };
        const c = ins('qc_checklists', { code, name: p.name, stage: p.stage, version: 1, status: 'ACTIVE', items: p.items, source: 'TEMPLATE' }); return { result: 'CREATED', target_id: c.id };
      }
      case 'KPI_TARGET': {
        const def = T('kpi_definitions', k => k.code === code);
        if (!def) return { result: 'SKIPPED', reason: 'El indicador no existe en esta empresa: no se crea la meta' };
        if (T('kpi_targets', k => k.kpi_code === code && k.brand_id === brand.id)) return { result: 'SKIPPED', reason: 'Ya hay una meta para esta marca' };
        const c = ins('kpi_targets', { kpi_id: def.id, kpi_code: code, brand_id: brand.id, establishment_id: null, target: p.target, tolerance_pct: p.tol, valid_from: G.TODAY, valid_to: null, note: p.label, source: 'TEMPLATE' }); return { result: 'CREATED', target_id: c.id };
      }
      case 'PARAMETER': {
        if (T('parameters', x => x.key === code && x.scope === 'BRAND' && x.scope_id === brand.id && !x.voided)) return { result: 'SKIPPED', reason: 'Ya está configurado para la marca' };
        G.setParam(code, p.value, p.reason, { brand: brand.id }); return { result: 'CREATED', target_id: code };
      }
      case 'ROLE': {
        if (T('roles', r => r.code === code)) return { result: 'SKIPPED', reason: 'Ya existe con el mismo código' };
        const c = ins('roles', { code, name: p.name, is_system: false, description: p.desc, requires_mfa: false, scope_mode: 'BRAND', status: 'ACTIVE', source: 'TEMPLATE' }); return { result: 'CREATED', target_id: c.id };
      }
      case 'EXPENSE_CATEGORY': {
        if (T('expense_categories', r => r.code === code)) return { result: 'SKIPPED', reason: 'Ya existe con el mismo código' };
        const c = ins('expense_categories', { code, name: p.name, category_group: p.group, status: 'ACTIVE', source: 'TEMPLATE' }); return { result: 'CREATED', target_id: c.id };
      }
      case 'DELIVERY_SLOT': {
        const ests = G.db.all('establishments'); if (!ests.length) return { result: 'FAILED', reason: 'Sin locales: registra un local (ONB-05)' };
        if (T('order_time_slots', s => s.template_code === code)) return { result: 'SKIPPED', reason: 'Ya existe con el mismo código' };
        let first = null; for (const e of ests) { const s = ins('order_time_slots', { establishment_id: e.id, zone_id: null, name: p.name, slot_from: p.from, slot_to: p.to, cutoff: p.cutoff, capacity: p.capacity, weekdays: [1, 2, 3, 4, 5, 6], status: 'ACTIVE', template_code: code }); first = first || s; }
        return { result: 'CREATED', target_id: first.id };
      }
      default: return { result: 'SKIPPED', reason: 'Tipo no aplicable' };
    }
  }

  /* =====================================================================
     Importadores
     ===================================================================== */
  /** transacción simulada: foto de las tablas y reverso de lo que cambió (RN-ONB-16) */
  function snap(tables) { const m = {}; for (const t of tables) { const mm = new Map(); for (const r of raw(t)) mm.set(r.id, JSON.stringify(r)); m[t] = mm; } return m; }
  function rollback(s) {
    for (const [t, mm] of Object.entries(s)) {
      const arr = raw(t); const keep = [];
      for (const r of arr) { const b = mm.get(r.id); if (b === undefined) continue; keep.push(b === JSON.stringify(r) ? r : JSON.parse(b)); }
      G.db.t[t] = keep;
    }
    G.db.touch();
  }
  const TX_TABLES = ['products', 'product_variants', 'price_lists', 'price_list_items', 'customers', 'customer_addresses', 'suppliers', 'lots', 'stock_balances', 'stock_movements', 'opening_balances'];

  const importsOf = run => raw('data_imports').filter(i => i.run_id === run.id).sort(U.by('created_at', -1));
  const impGet = id => raw('data_imports').find(i => i.id === id) || null;
  const rowsOf = imp => raw('data_import_rows').filter(r => r.import_id === imp.id).sort(U.by('row_no'));

  /** mapeo automático de columnas por nombre normalizado */
  function autoMap(type, headers) {
    const map = {}; const hn = headers.map(norm);
    for (const [k, label] of IMP[type].fields) { let i = hn.indexOf(k); if (i < 0) i = hn.indexOf(norm(label)); if (i < 0) i = hn.findIndex(x => x.startsWith(k) || k.startsWith(x) && x.length > 3); if (i >= 0) map[k] = i; }
    return map;
  }
  /** ONB-11: crea la importación (archivo, huella, mapeo) y valida (ONB-12) */
  function createImport(runId, d) {
    const run = runGet(runId); const def = IMP[d.type]; if (!def) G.fail('RN-ONB-08', 'Tipo de importación no válido.');
    guard(def.perm); const by = G.ctx.userName();
    return within(run.tenant, () => {
      if (def.step) assertCanWork(run, def.step);
      const rows = csvParse(d.content);
      if (rows.length < 2) G.fail('RN-ONB-08', 'El archivo no tiene filas de datos (la fila 1 es la cabecera).');
      const max = G.param('onb_import_max_rows') || 20000;
      if (rows.length - 1 > max) G.fail('RN-ONB-12', `El archivo tiene ${F.num(rows.length - 1)} filas y el máximo es ${F.num(max)} (onb_import_max_rows): divídelo en partes.`);
      const hash = sha256(d.content);
      const dup = G.db.find('data_imports', i => i.file_hash === hash && i.import_type === d.type && i.status !== 'CANCELLED');
      if (dup) G.fail('RN-ONB-09', `Este archivo ya se importó (${dup.file_name}, ${F.datetime(dup.created_at)}, ${G.ui.statusLabel(dup.status)}): no se importa dos veces salvo que se cancele la anterior.`);
      if (def.needs.includes('warehouse') && !d.warehouse_id) G.fail('RN-ONB-10', 'El stock inicial exige el almacén por defecto.');
      if (def.needs.includes('cutover') && !d.cutover_date) G.fail('RN-ONB-10', 'Indica la fecha de corte.');
      if (def.needs.includes('company') && !d.company_id) G.fail('RN-ONB-10', 'Los saldos exigen la empresa.');
      if (def.needs.includes('brand') && !d.brand_id) G.fail('RN-ONB-08', 'Elige la marca.');
      if (d.type === 'STOCK' && run.planned_go_live && d.cutover_date >= (run.go_live_at || run.planned_go_live)) G.fail('RN-ONB-15', `La fecha de corte (${F.date(d.cutover_date)}) debe ser anterior al primer día de operación (${F.date(run.go_live_at || run.planned_go_live)}).`);
      const headers = rows[0].map(x => String(x).trim());
      const map = d.map || autoMap(d.type, headers);
      const missing = def.fields.filter(f => f[2] && map[f[0]] === undefined).map(f => f[1]);
      const file = ins('file_attachments', { module_code: 'ONB', entity_type: 'data_imports', entity_id: null, storage_key: 'onb/' + hash.slice(0, 16), file_name: d.file_name || `${d.type.toLowerCase()}.csv`, mime_type: 'text/csv', size_bytes: new TextEncoder().encode(d.content).length, sha256: hash, classification: ['CUSTOMERS', 'CUSTOMER_BALANCES'].includes(d.type) ? 'PERSONAL_DATA' : 'INTERNAL', status: 'ACTIVE' });
      const imp = ins('data_imports', { run_id: run.id, import_type: d.type, file_id: file.id, file_hash: hash, file_name: file.file_name, template_version: 'v1', company_id: d.company_id || null, brand_id: d.brand_id || null, warehouse_id: d.warehouse_id || null, cutover_date: d.cutover_date || null, mode: d.mode || 'INSERT_ONLY', allow_partial: false, status: 'UPLOADED', headers, map, total_rows: rows.length - 1, valid_rows: 0, warning_rows: 0, error_rows: 0, imported_rows: 0, skipped_rows: 0, created_by: by, created_at: d.at || nowIso() });
      G.db.update('file_attachments', file.id, { entity_id: imp.id }, { silent: true });
      rows.slice(1).forEach((r, i) => { const o = {}; for (const [k] of def.fields) o[k] = map[k] !== undefined ? String(r[map[k]] ?? '').trim() : ''; ins('data_import_rows', { import_id: imp.id, row_no: i + 2, raw: o, status: 'PENDING', errors: [] }); });
      if (missing.length) { G.db.update('data_imports', imp.id, { status: 'FAILED_VALIDATION', file_error: `Faltan columnas obligatorias: ${missing.join(', ')}` }, { silent: true }); return imp; }
      validateImport(imp.id);
      return impGet(imp.id);
    });
  }
  /** contexto de validación: lo que ya existe en el tenant */
  function vctx(imp) {
    const c = { seen: new Map(), seen2: new Map() };
    c.variants = new Map(G.db.all('product_variants').map(v => [String(v.sku).toUpperCase(), v]));
    c.cats = new Map(G.db.all('product_categories').map(x => [String(x.code).toUpperCase(), x]));
    c.whs = new Map(G.db.all('warehouses').map(w => [String(w.code).toUpperCase(), w]));
    if (['CUSTOMERS', 'CUSTOMER_BALANCES'].includes(imp.import_type)) { const cs = G.db.where('customers', x => x.status !== 'VOIDED'); c.custDoc = new Map(cs.filter(x => x.doc_number).map(x => [x.doc_number, x])); c.custPhone = new Map(cs.filter(x => x.phone).map(x => [x.phone, x])); }
    if (['SUPPLIERS', 'SUPPLIER_BALANCES'].includes(imp.import_type)) c.sups = new Map(G.db.all('suppliers').filter(x => x.status !== 'VOIDED').map(x => [x.doc_number, x]));
    if (['CUSTOMER_BALANCES', 'SUPPLIER_BALANCES'].includes(imp.import_type)) c.obRefs = new Set(G.db.where('opening_balances', o => o.status !== 'VOIDED').map(o => o.party_type + '|' + (o.customer_id || o.supplier_id) + '|' + o.doc_reference));
    if (imp.import_type === 'PRICES') c.lists = G.db.where('price_lists', l => l.brand_id === imp.brand_id);
    return c;
  }
  function validateImport(impId) {
    const imp = impGet(impId);
    return within(imp.tenant, () => {
      if (!['UPLOADED', 'VALIDATED', 'FAILED_VALIDATION'].includes(imp.status)) G.fail('RN-ONB-08', 'Solo se valida una importación que no se ha ejecutado.');
      G.db.update('data_imports', imp.id, { status: 'VALIDATING' }, { silent: true });
      const c = vctx(imp); let v = 0, w = 0, e = 0;
      for (const row of rowsOf(imp)) {
        const res = validateRow(imp, row, c);
        row.status = res.errors.some(x => x.level === 'ERROR') ? 'ERROR' : res.errors.length ? 'WARNING' : 'VALID';
        row.errors = res.errors; row.norm = res.norm; row.dup_of = res.dup_of || null;
        if (row.status === 'ERROR') e++; else if (row.status === 'WARNING') w++; else v++;
      }
      G.db.touch();
      return G.db.update('data_imports', imp.id, { status: v + w > 0 ? 'VALIDATED' : 'FAILED_VALIDATION', valid_rows: v, warning_rows: w, error_rows: e, validated_at: nowIso() }, { silent: !!G._seeding });
    });
  }
  function validateRow(imp, row, c) {
    const r = row.raw, errs = [], n = {}; let dup_of = null;
    const E = (col, msg) => errs.push({ col, msg, level: 'ERROR' }), W = (col, msg) => errs.push({ col, msg, level: 'WARNING' });
    const def = IMP[imp.import_type];
    for (const [k, label, req] of def.fields) if (req && !String(r[k] || '').trim()) E(k, `${label}: dato obligatorio.`);
    const T = imp.import_type;
    if (T === 'PRODUCTS') {
      const mode = MODE_MAP[String(r.modo_venta || '').toUpperCase()]; if (r.modo_venta && !mode) E('modo_venta', `Modo «${r.modo_venta}» no válido: usa UNIDAD, KG o PESO_VARIABLE.`);
      const cat = c.cats.get(String(r.categoria || '').toUpperCase()); if (r.categoria && !cat) E('categoria', `La categoría ${r.categoria} no existe: créala o aplica la plantilla del rubro.`);
      const price = num(r.precio); if (r.precio && !(price > 0)) E('precio', 'El precio debe ser mayor que 0.');
      const kg = num(r.peso_nominal_kg); if (mode === 'UNIT_VARIABLE_WEIGHT' && !(kg > 0)) E('peso_nominal_kg', 'Un producto de peso variable necesita el peso nominal.');
      const st = r.conservacion ? STORE_MAP[String(r.conservacion).toUpperCase()] : 'CHILLED'; if (!st) E('conservacion', 'Usa REFRIGERADO, CONGELADO o AMBIENTE.');
      const sku = String(r.sku || '').toUpperCase();
      if (sku) { if (c.seen.has(sku)) E('sku', `SKU repetido en la fila ${c.seen.get(sku)}.`); else c.seen.set(sku, row.row_no); }
      if (sku && c.variants.has(sku)) { if (imp.mode === 'UPSERT') W('sku', 'Ya existe: se actualizará el precio, el costo y el nombre.'); else { W('sku', 'Ya existe: se omite (modo solo nuevos).'); dup_of = c.variants.get(sku).id; } }
      Object.assign(n, { mode, cat: cat && cat.id, line: cat && cat.line, price, kg: kg > 0 ? kg : null, tol: num(r.tolerancia_pct) > 0 ? num(r.tolerancia_pct) : (mode === 'UNIT' ? null : 10), cost: num(r.costo) > 0 ? num(r.costo) : null, lot: r.requiere_lote ? yes(r.requiere_lote) : true, storage: st, shelf: num(r.vida_util_dias) > 0 ? num(r.vida_util_dias) : null, sku });
    } else if (T === 'CUSTOMERS') {
      const dt = String(r.tipo_doc || (r.num_doc ? 'DNI' : 'NINGUNO')).toUpperCase(); const dn = String(r.num_doc || '').replace(/\s/g, '');
      if (dt === 'DNI' && !U.dniOk(dn)) E('num_doc', 'RN-ONB-13: el DNI tiene 8 dígitos.');
      if (dt === 'RUC' && !U.rucOk(dn)) E('num_doc', 'RN-ONB-13: el RUC no cumple el dígito verificador.');
      if (dt === 'CE' && !/^[A-Z0-9]{8,12}$/i.test(dn)) E('num_doc', 'El carné de extranjería tiene de 8 a 12 caracteres.');
      let ph = String(r.celular || '').replace(/\D/g, ''); if (ph.length === 11 && ph.startsWith('51')) ph = ph.slice(2);
      if (r.celular && !/^9\d{8}$/.test(ph)) E('celular', 'RN-ONB-13: el celular tiene 9 dígitos y empieza con 9.');
      const phone = /^9\d{8}$/.test(ph) ? (G.param('onb_import_phone_prefix') || '+51') + ph : null;
      if (r.correo && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(r.correo)) E('correo', 'Correo no válido.');
      const minRef = G.param('cli_min_reference_chars') || 10;
      if (r.direccion && String(r.referencia || '').trim().length < minRef) E('referencia', `RN-ONB-13: la dirección exige una referencia de al menos ${minRef} caracteres.`);
      const conf = num(r.confianza_geo), lat = num(r.lat), lng = num(r.lng), min = G.param('onb_geocode_min_confidence') ?? 0.8;
      const pin = isFinite(lat) && isFinite(lng) && conf >= min;
      if (r.direccion && !pin) W('lat', `Sin pin: confianza ${isFinite(conf) ? F.num(conf, 2) : 'sin dato'} < ${F.num(min, 1)}; CLI pedirá el pin en el primer pedido.`);
      const kDoc = dn && dt !== 'NINGUNO' ? dn : null;
      if (kDoc && c.custDoc.has(kDoc)) { W('num_doc', `Duplicado: ya existe ${c.custDoc.get(kDoc).full_name} con el documento ${kDoc}; no se crea otro cliente.`); dup_of = c.custDoc.get(kDoc).id; }
      else if (phone && c.custPhone.has(phone)) { W('celular', `Duplicado por celular con ${c.custPhone.get(phone).full_name}: no se crea otro cliente.`); dup_of = c.custPhone.get(phone).id; }
      else if (kDoc && c.seen.has('D' + kDoc)) { W('num_doc', `Duplicado por documento con la fila ${c.seen.get('D' + kDoc)}: no se crea otro cliente.`); dup_of = 'row:' + c.seen.get('D' + kDoc); }
      else if (phone && c.seen.has('P' + phone)) { W('celular', `Duplicado por celular con la fila ${c.seen.get('P' + phone)}: no se crea otro cliente.`); dup_of = 'row:' + c.seen.get('P' + phone); }
      if (!dup_of) { if (kDoc) c.seen.set('D' + kDoc, row.row_no); if (phone) c.seen.set('P' + phone, row.row_no); }
      Object.assign(n, { doc_type: dt === 'NINGUNO' ? 'NONE' : dt, doc_number: kDoc, phone, pin, lat: pin ? lat : null, lng: pin ? lng : null, conf: isFinite(conf) ? conf : null, optin: yes(r.consentimiento) });
    } else if (T === 'SUPPLIERS') {
      const dt = String(r.tipo_doc || 'RUC').toUpperCase(), dn = String(r.num_doc || '').trim();
      if (dt === 'RUC' && !U.rucOk(dn)) E('num_doc', 'El RUC no cumple el dígito verificador.');
      if (dt === 'DNI' && !U.dniOk(dn)) E('num_doc', 'El DNI tiene 8 dígitos.');
      if (dn && c.sups.has(dn)) { W('num_doc', 'El proveedor ya existe: se omite.'); dup_of = c.sups.get(dn).id; }
      else if (dn && c.seen.has(dn)) E('num_doc', `Repetido en la fila ${c.seen.get(dn)}.`); else if (dn) c.seen.set(dn, row.row_no);
      const tp = r.tipo ? SUP_MAP[String(r.tipo).toUpperCase()] : 'OTHER'; if (!tp) E('tipo', 'Tipo de proveedor no válido.');
      Object.assign(n, { doc_type: dt, tp, terms: num(r.plazo_dias) >= 0 ? num(r.plazo_dias) : 0 });
    } else if (T === 'PRICES') {
      const v = c.variants.get(String(r.sku || '').toUpperCase()); if (r.sku && !v) E('sku', `El SKU ${r.sku} no existe en el catálogo.`);
      if (v && v.brand_id !== imp.brand_id) E('sku', `El SKU ${r.sku} es de otra marca.`);
      const price = num(r.precio); if (r.precio && !(price > 0)) E('precio', 'El precio debe ser mayor que 0.');
      const basis = { UNIDAD: 'UNIT', UNIT: 'UNIT', KG: 'KG' }[String(r.base || '').toUpperCase()]; if (r.base && !basis) E('base', 'Usa UNIDAD o KG.');
      if (v && basis && (v.sale_mode === 'UNIT') !== (basis === 'UNIT')) E('base', `La presentación se vende ${G.saleModeName(v.sale_mode).toLowerCase()}: la base debe ser ${v.sale_mode === 'UNIT' ? 'UNIDAD' : 'KG'}.`);
      const lc = String(r.lista || 'PUB').toUpperCase(); const list = c.lists.find(l => String(l.code).toUpperCase() === lc);
      if (!list && lc !== 'PUB') E('lista', `La lista ${lc} no existe para la marca.`);
      const from = r.vigente_desde ? isoDate(r.vigente_desde) : (imp.cutover_date ? G.date.add(imp.cutover_date, 1) : G.TODAY); if (r.vigente_desde && !from) E('vigente_desde', 'Fecha no válida (dd/mm/aaaa).');
      const k = (v && v.id) + '|' + lc; if (v && c.seen.has(k)) E('sku', `Precio repetido en la fila ${c.seen.get(k)}.`); else if (v) c.seen.set(k, row.row_no);
      Object.assign(n, { variant_id: v && v.id, price, basis, list_id: list && list.id, list_code: lc, from });
    } else if (T === 'STOCK') {
      const v = c.variants.get(String(r.sku || '').toUpperCase()); if (r.sku && !v) E('sku', `El SKU ${r.sku} no existe: importa primero los productos.`);
      const whc = String(r.almacen || '').toUpperCase(); const wh = whc ? c.whs.get(whc) : G.db.get('warehouses', imp.warehouse_id);
      if (!wh) E('almacen', `El almacén ${r.almacen} no existe.`);
      const prod = v && G.db.get('products', v.product_id);
      const exp = r.vencimiento ? isoDate(r.vencimiento) : null; if (r.vencimiento && !exp) E('vencimiento', 'Fecha no válida (dd/mm/aaaa).');
      if (prod && prod.requires_lot && (!r.lote || !exp)) E(!r.lote ? 'lote' : 'vencimiento', 'RN-ONB-14: el producto lleva lote: el lote y el vencimiento son obligatorios.');
      if (exp && imp.cutover_date && exp < imp.cutover_date) W('vencimiento', 'El lote ya estaba vencido a la fecha de corte.');
      const qty = num(r.cantidad); if (r.cantidad && !(qty > 0)) E('cantidad', 'La cantidad debe ser mayor que 0.');
      const cost = num(r.costo_unitario); if (r.costo_unitario !== undefined && String(r.costo_unitario).trim() !== '' && !(cost > 0)) E('costo_unitario', 'RN-ONB-15: el costo unitario debe ser mayor que 0.');
      let w = num(r.peso_kg); if (v && v.sale_mode === 'UNIT_VARIABLE_WEIGHT' && !(w > 0)) { w = R((qty || 0) * (v.nominal_weight_kg || 0), 3); W('peso_kg', `Sin peso: se usa el nominal (${F.kg(w, 3)}).`); }
      const k = (wh && wh.id) + '|' + (v && v.id) + '|' + (r.lote || ''); if (c.seen.has(k)) E('lote', `Lote repetido en el mismo almacén (fila ${c.seen.get(k)}).`); else c.seen.set(k, row.row_no);
      Object.assign(n, { variant_id: v && v.id, wh: wh && wh.id, lot: r.lote || null, exp, qty, weight: v && v.sale_mode === 'KG' ? qty : (w > 0 ? w : null), cost });
    } else if (T === 'CUSTOMER_BALANCES' || T === 'SUPPLIER_BALANCES') {
      const cust = T === 'CUSTOMER_BALANCES'; const dn = String(r.num_doc || '').trim();
      const party = cust ? c.custDoc.get(dn) : c.sups.get(dn);
      if (dn && !party) E('num_doc', cust ? `No existe el cliente con documento ${dn}: impórtalo primero.` : `No existe el proveedor ${dn}.`);
      const dt = DOC_MAP[String(r.tipo || '').toUpperCase()]; if (r.tipo && !dt) E('tipo', 'Usa FACTURA, BOLETA, NC, ND u OTRO.');
      const iss = isoDate(r.emision), due = r.vencimiento ? isoDate(r.vencimiento) : null;
      if (r.emision && !iss) E('emision', 'Fecha no válida.');
      if (due && iss && due < iss) E('vencimiento', 'RN-ONB-11: el vencimiento no es anterior a la emisión.');
      if (iss && imp.cutover_date && iss > imp.cutover_date) W('emision', 'Emitido después de la fecha de corte.');
      const amt = num(r.importe), bal = num(r.saldo);
      if (r.importe && !(amt > 0)) E('importe', 'RN-ONB-11: el importe debe ser positivo.');
      if (r.saldo !== '' && (!(bal >= 0) || bal > amt + 0.005)) E('saldo', 'RN-ONB-11: el saldo va de 0 al importe.');
      const k = (cust ? 'CUSTOMER' : 'SUPPLIER') + '|' + (party && party.id) + '|' + r.referencia;
      if (party && (c.obRefs.has(k) || c.seen.has(k))) E('referencia', 'El documento ya tiene saldo inicial.'); else c.seen.set(k, row.row_no);
      Object.assign(n, { party_id: party && party.id, doc_type: dt, iss, due, amt, bal });
    }
    return { errors: errs, norm: n, dup_of };
  }
  /** ONB-13: ejecución por lotes de 500 en transacción (RN-ONB-08 y RN-ONB-16) */
  function runImport(impId, opts = {}) {
    const imp = impGet(impId); const def = IMP[imp.import_type];
    guard(def.perm); const by = G.ctx.userName();
    const run = runGet(imp.run_id);
    return within(imp.tenant, () => {
      if (imp.status !== 'VALIDATED') G.fail('RN-ONB-08', `Solo se ejecuta una importación validada (está ${G.ui.statusLabel(imp.status)}).`);
      const allow = opts.allowPartial !== undefined ? !!opts.allowPartial : !!imp.allow_partial;
      if (imp.error_rows > 0 && !allow) G.fail('RN-ONB-08', `Hay ${imp.error_rows} fila(s) con error: acepta importar solo las ${imp.valid_rows + imp.warning_rows} válidas o corrige el archivo.`);
      if (def.step) assertCanWork(run, def.step);
      G.db.update('data_imports', imp.id, { status: 'IMPORTING', allow_partial: allow, started_at: nowIso() }, { silent: true });
      const all = rowsOf(imp); const batches = []; const ctx = { products: new Map(), lists: new Map(), rowTarget: new Map(), lots: [] };
      for (let i = 0; i < all.length; i += BATCH) {
        const part = all.slice(i, i + BATCH); const s = snap(TX_TABLES); const b = { n: batches.length + 1, rows: part.length, imported: 0, skipped: 0, failed: 0, status: 'OK' };
        try {
          for (const row of part) {
            if (row.status === 'ERROR') { b.failed++; continue; }
            if (opts.failAtRow && row.row_no === opts.failAtRow) throw new Error(`Error simulado del servidor en la fila ${row.row_no}`);
            const r = execRow(imp, row, ctx);
            if (r.skipped) { row.status = 'SKIPPED'; row.target_id = r.target_id || null; b.skipped++; }
            else { row.status = 'IMPORTED'; row.target_table = r.table; row.target_id = r.id; b.imported++; }
            if (row.row_no) ctx.rowTarget.set(row.row_no, row.target_id);
          }
        } catch (e) {
          rollback(s); b.status = 'ROLLED_BACK'; b.error = e.message; b.imported = 0; b.skipped = 0; b.failed = part.length;
          for (const row of part) { if (row.status !== 'ERROR') { row.status = 'ERROR'; row.errors = (row.errors || []).concat([{ col: '', msg: `RN-ONB-16: el lote ${b.n} se revirtió (${e.message}).`, level: 'ERROR' }]); row.target_id = null; } }
        }
        batches.push(b);
      }
      G.db.touch();
      const imported = U.sum(batches, b => b.imported), skipped = U.sum(batches, b => b.skipped);
      const errorRows = all.filter(r => r.status === 'ERROR').length;
      G.db.update('data_imports', imp.id, { status: 'COMPLETED', imported_rows: imported, skipped_rows: skipped, error_rows: errorRows, batches, finished_at: nowIso(), executed_by: by, opening_lots: ctx.lots }, { silent: !!G._seeding });
      if (def.step) autoStep(run, def.step, by);
      emit('import.completed', { import_id: imp.id, type: imp.import_type, imported, errors: errorRows });
      return impGet(imp.id);
    });
  }
  function execRow(imp, row, ctx) {
    const n = row.norm || {}, r = row.raw;
    switch (imp.import_type) {
      case 'PRODUCTS': {
        const ex = G.db.find('product_variants', v => String(v.sku).toUpperCase() === n.sku);
        if (ex) { if (imp.mode !== 'UPSERT') return { skipped: true, target_id: ex.id }; G.db.update('product_variants', ex.id, { name: r.presentacion, std_cost: n.cost ?? ex.std_cost }, { silent: true }); setPrice(imp.brand_id, ex.id, n.price, n.mode === 'UNIT' ? 'UNIT' : 'KG', G.TODAY, ctx); return { table: 'product_variants', id: ex.id }; }
        const code = String(r.codigo).toUpperCase();
        let pr = ctx.products.get(code) || G.db.find('products', p => p.code === code);
        if (!pr) { pr = ins('products', { brand_id: imp.brand_id, category_id: n.cat, code, name: r.nombre, line: n.line, product_type: 'GOODS', origin: 'PRODUCED', storage: n.storage, shelf_life_days: n.shelf, requires_lot: n.lot, igv_affectation: '10', status: 'ACTIVE', source: 'IMPORT', import_id: imp.id }, { silent: true }); ctx.products.set(code, pr); }
        const v = ins('product_variants', { product_id: pr.id, brand_id: imp.brand_id, sku: n.sku, name: r.presentacion, barcode: r.codigo_barras || null, uom_id: n.mode === 'UNIT' ? 'um-NIU' : 'um-KGM', sale_mode: n.mode, nominal_weight_kg: n.kg, weight_tolerance_pct: n.tol, min_weight_kg: n.kg && n.tol ? R(n.kg * (1 - n.tol / 100), 3) : null, max_weight_kg: n.kg && n.tol ? R(n.kg * (1 + n.tol / 100), 3) : null, status: 'ACTIVE', std_cost: n.cost, sellable: true, line: n.line, import_id: imp.id }, { silent: true });
        setPrice(imp.brand_id, v.id, n.price, n.mode === 'UNIT' ? 'UNIT' : 'KG', G.TODAY, ctx);
        return { table: 'product_variants', id: v.id };
      }
      case 'CUSTOMERS': {
        if (row.dup_of) return { skipped: true, target_id: String(row.dup_of).startsWith('row:') ? ctx.rowTarget.get(Number(String(row.dup_of).slice(4))) : row.dup_of };
        const c = ins('customers', { doc_type: n.doc_type, doc_number: n.doc_number, full_name: r.nombre, phone: n.phone, email: r.correo || null, customer_type: n.doc_type === 'RUC' ? 'BUSINESS' : 'PERSON', source_channel: 'IMPORT', marketing_opt_in: n.optin, consent_source: n.optin ? 'IMPORT' : null, status: 'ACTIVE', import_id: imp.id }, { silent: true });
        const dist = String(r.distrito || '').trim().toLowerCase();
        const zone = dist ? G.db.find('delivery_zones', z => (Array.isArray(z.districts) ? z.districts : String(z.districts || '').split(',')).some(d => String(d).trim().toLowerCase() === dist)) : null;
        ins('customer_addresses', { customer_id: c.id, label: 'Principal', address_line: r.direccion, reference: r.referencia, district: r.distrito || null, lat: n.lat, lng: n.lng, zone_id: zone ? zone.id : null, contact_name: r.nombre, contact_phone: n.phone, is_default: true, pin_source: n.pin ? 'GEOCODE' : null, geocode_confidence: n.conf, needs_pin: !n.pin, status: 'ACTIVE', import_id: imp.id }, { silent: true });
        return { table: 'customers', id: c.id };
      }
      case 'SUPPLIERS': {
        if (row.dup_of) return { skipped: true, target_id: row.dup_of };
        const s = ins('suppliers', { doc_type: n.doc_type, doc_number: r.num_doc, legal_name: r.razon_social, trade_name: r.nombre_comercial || r.razon_social, supplier_type: n.tp, payment_terms_days: n.terms, phone: r.celular ? '+51' + String(r.celular).replace(/\D/g, '').slice(-9) : null, email: r.correo || null, status: 'ACTIVE', import_id: imp.id }, { silent: true });
        return { table: 'suppliers', id: s.id };
      }
      case 'PRICES': {
        const it = setPrice(imp.brand_id, n.variant_id, n.price, n.basis, n.from, ctx, n.list_id);
        return { table: 'price_list_items', id: it.id };
      }
      case 'STOCK': {
        let lot = null;
        if (n.lot) {
          lot = G.db.find('lots', l => l.code === n.lot && l.variant_id === n.variant_id);
          if (!lot) { const v = G.variant(n.variant_id); lot = ins('lots', { product_id: v.product_id, variant_id: v.id, code: n.lot, origin: 'OPENING', production_date: null, expiry_date: n.exp, qc_status: G.param('onb_opening_stock_requires_release') === false ? 'RELEASED' : 'QUARANTINE', unit_cost: n.cost, import_id: imp.id, released_at: null }, { silent: true }); ctx.lots.push(lot.id); }
        }
        const mv = G.inv.move({ type: 'ADJUSTMENT', wh: n.wh, variant: n.variant_id, lot: lot && lot.id, qty: n.qty, weight: n.weight, unitCost: n.cost, source: { type: 'ONB_OPENING', id: imp.id }, at: imp.cutover_date + 'T23:59:00', reason: 'Stock inicial: ajuste de apertura (ONB)', allowUnreleased: true });
        return { table: 'stock_movements', id: mv.moves[0].id };
      }
      case 'CUSTOMER_BALANCES': case 'SUPPLIER_BALANCES': {
        const cust = imp.import_type === 'CUSTOMER_BALANCES';
        const ob = ins('opening_balances', { import_id: imp.id, company_id: imp.company_id, brand_id: imp.brand_id || null, party_type: cust ? 'CUSTOMER' : 'SUPPLIER', customer_id: cust ? n.party_id : null, supplier_id: cust ? null : n.party_id, doc_type: n.doc_type, doc_reference: r.referencia, issue_date: n.iss, due_date: n.due, currency: 'PEN', amount: n.amt, balance: n.bal, status: n.bal > 0 ? 'OPEN' : 'SETTLED', cutover_date: imp.cutover_date }, { silent: true });
        return { table: 'opening_balances', id: ob.id };
      }
    }
    G.fail('RN-ONB-08', 'Tipo no soportado.');
  }
  function setPrice(brandId, variantId, price, basis, from, ctx, listId) {
    let list = listId ? G.db.get('price_lists', listId) : (ctx.lists.get(brandId) || G.db.find('price_lists', l => l.brand_id === brandId && l.code === 'PUB'));
    if (!list) { const b = G.db.get('brands', brandId); list = ins('price_lists', { brand_id: brandId, code: 'PUB', name: 'Lista pública ' + (b ? b.name : ''), channels: ['WHATSAPP', 'WEB', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM', 'PHONE', 'COUNTER'], includes_igv: true, status: 'ACTIVE' }, { silent: true }); }
    ctx.lists.set(brandId, list);
    const cur = G.db.find('price_list_items', x => x.list_id === list.id && x.variant_id === variantId && !x.valid_to && x.status !== 'VOIDED');
    if (cur) G.db.update('price_list_items', cur.id, { valid_to: G.date.add(from, -1) }, { silent: true });
    return ins('price_list_items', { list_id: list.id, variant_id: variantId, price, basis, valid_from: from, valid_to: null, prev_item_id: cur ? cur.id : null, source: 'IMPORT' }, { silent: true });
  }
  /** reversión de una importación ejecutada (deja la importación CANCELADA; permite reimportar, RN-ONB-09) */
  function revertImport(impId, reason) {
    const imp = impGet(impId); guard(IMP[imp.import_type].perm);
    if (!reason) G.fail('RN-ONB-08', 'La reversión exige motivo.');
    return within(imp.tenant, () => {
      if (imp.status !== 'COMPLETED') G.fail('RN-ONB-08', 'Solo se revierte una importación ejecutada.');
      const done = rowsOf(imp).filter(r => r.status === 'IMPORTED');
      const blockers = [];
      if (imp.import_type === 'CUSTOMERS') { const used = new Set(G.db.all('sales_orders').map(o => o.customer_id)); done.forEach(r => { if (used.has(r.target_id)) blockers.push(`fila ${r.row_no}: el cliente ya tiene pedidos`); }); }
      if (imp.import_type === 'STOCK') done.forEach(r => { const m = G.db.get('stock_movements', r.target_id); const b = m && G.inv._bal(m.warehouse_id, m.variant_id, m.lot_id); if (!b || b.qty + 1e-6 < m.qty) blockers.push(`fila ${r.row_no}: el stock ya se consumió`); });
      if (/BALANCES/.test(imp.import_type)) done.forEach(r => { const o = G.db.get('opening_balances', r.target_id); if (o && o.balance < Number(r.norm.bal) - 0.005) blockers.push(`fila ${r.row_no}: el saldo ya tiene cobros o pagos`); });
      if (blockers.length) G.fail('RN-ONB-08', `No se puede revertir: ${blockers.slice(0, 3).join('; ')}${blockers.length > 3 ? ` y ${blockers.length - 3} más` : ''}.`);
      for (const r of done) {
        if (imp.import_type === 'PRODUCTS') { G.db.update('product_variants', r.target_id, { status: 'INACTIVE', sellable: false }, { silent: true }); G.db.where('price_list_items', x => x.variant_id === r.target_id && !x.valid_to).forEach(x => G.db.update('price_list_items', x.id, { status: 'VOIDED', valid_to: G.TODAY }, { silent: true })); }
        if (imp.import_type === 'CUSTOMERS') { G.db.update('customers', r.target_id, { status: 'VOIDED', void_reason: reason }, { silent: true }); G.db.where('customer_addresses', a => a.customer_id === r.target_id).forEach(a => G.db.update('customer_addresses', a.id, { status: 'VOIDED' }, { silent: true })); }
        if (imp.import_type === 'SUPPLIERS') G.db.update('suppliers', r.target_id, { status: 'VOIDED' }, { silent: true });
        if (imp.import_type === 'PRICES') { const it = G.db.get('price_list_items', r.target_id); G.db.update('price_list_items', it.id, { status: 'VOIDED' }, { silent: true }); if (it.prev_item_id) G.db.update('price_list_items', it.prev_item_id, { valid_to: null }, { silent: true }); }
        if (imp.import_type === 'STOCK') { const m = G.db.get('stock_movements', r.target_id); G.inv.move({ type: 'REVERSAL', wh: m.warehouse_id, variant: m.variant_id, lot: m.lot_id, qty: -m.qty, weight: m.weight_kg != null ? -m.weight_kg : null, source: { type: 'ONB_OPENING_REVERSAL', id: imp.id }, at: nowIso(), reason: 'Reversión del stock inicial: ' + reason, allowUnreleased: true, reversal_of: m.id }); }
        if (/BALANCES/.test(imp.import_type)) G.db.update('opening_balances', r.target_id, { status: 'VOIDED' }, { silent: true });
      }
      for (const id of imp.opening_lots || []) { const l = G.db.get('lots', id); if (l) G.db.update('lots', id, { qc_status: 'BLOCKED', block_reason: 'Importación revertida' }, { silent: true }); }
      return G.db.update('data_imports', imp.id, { status: 'CANCELLED', reverted_at: nowIso(), reverted_by: G.ctx.userName(), revert_reason: reason });
    });
  }
  function cancelImport(impId, reason) {
    const imp = impGet(impId); guard(IMP[imp.import_type].perm);
    return within(imp.tenant, () => { if (!['UPLOADED', 'VALIDATED', 'FAILED_VALIDATION'].includes(imp.status)) G.fail('RN-ONB-08', 'Solo se cancela una importación sin ejecutar (las ejecutadas se revierten).'); return G.db.update('data_imports', imp.id, { status: 'CANCELLED', revert_reason: reason || 'Cancelada antes de ejecutar' }); });
  }
  /** RN-ONB-14: Calidad libera el stock inicial en cuarentena */
  function releaseOpeningStock(impId) {
    const imp = impGet(impId); guard('onb.import.release_opening_stock'); const by = G.ctx.userName();
    return within(imp.tenant, () => {
      const lots = (imp.opening_lots || []).map(id => G.db.get('lots', id)).filter(l => l && l.qc_status === 'QUARANTINE');
      if (!lots.length) G.fail('RN-ONB-14', 'No hay lotes del stock inicial en cuarentena.');
      for (const l of lots) { G.db.update('lots', l.id, { qc_status: 'RELEASED', released_at: nowIso(), released_by: by }, { silent: true }); ins('lot_status_changes', { lot_id: l.id, from_status: 'QUARANTINE', to_status: 'RELEASED', reason: 'Liberación del stock inicial (ONB)', changed_by: by, changed_at: nowIso() }, { silent: true }); emit('lot.released', { lot_id: l.id, source: 'ONB' }); }
      G.db.update('data_imports', imp.id, { released_at: nowIso(), released_by: by });
      return lots.length;
    });
  }
  function errorFile(impId) {
    const imp = impGet(impId); const def = IMP[imp.import_type];
    const head = def.fields.map(f => f[0]).concat(['fila', 'errores']);
    const rows = rowsOf(imp).filter(r => r.status === 'ERROR').map(r => def.fields.map(f => r.raw[f[0]]).concat([r.row_no, (r.errors || []).filter(e => e.level === 'ERROR').map(e => (e.col ? e.col + ': ' : '') + e.msg).join(' | ')]));
    return csvJoin([head, ...rows]);
  }
  function templateCsv(type) { const d = IMP[type]; return csvJoin([d.fields.map(f => f[0]), d.example]); }

  /** archivos de ejemplo deterministas (para la demo y las pruebas CA) */
  function sampleCsv(runId, type, o = {}) {
    const run = runGet(runId);
    return within(run.tenant, () => {
      const r = U.rng(o.seed || 4242); const d = IMP[type]; const head = d.fields.map(f => f[0]); const rows = [];
      if (type === 'PRODUCTS') {
        const cats = G.db.all('product_categories').map(c => c.code); if (!cats.length) G.fail('RN-ONB-08', 'No hay categorías: aplica la plantilla del rubro (ONB-10) antes de importar productos.');
        const n = o.n || 120, bad = new Set(); const nb = o.errors ?? 3; while (bad.size < nb) bad.add(U.int(r, 3, n - 2));
        const names = ['Cuy', 'Conejo', 'Pollo', 'Pato', 'Gallina', 'Cordero', 'Bondiola', 'Panceta', 'Chuleta', 'Lomo', 'Asado', 'Chorizo', 'Jamón', 'Morcilla', 'Caldo', 'Manteca'];
        for (let i = 1; i <= n; i++) {
          const nm = names[i % names.length]; const mode = i % 3 === 0 ? 'PESO_VARIABLE' : i % 3 === 1 ? 'KG' : 'UNIDAD';
          const row = [`P${U.pad(i, 3)}`, `${nm} ${i}`, cats[i % cats.length], `IMP-${U.pad(i, 4)}`, `${nm} ${i} ${mode === 'UNIDAD' ? '500 g' : mode === 'KG' ? 'por kg' : 'entero'}`, mode, mode === 'PESO_VARIABLE' ? dec(0.8 + r() * 1.5) : '', mode === 'UNIDAD' ? '' : '10', dec(15 + Math.floor(r() * 60)), dec(8 + Math.floor(r() * 30)), 'SI', 'REFRIGERADO', String(5 + Math.floor(r() * 20)), ''];
          if (bad.has(i)) { const k = [...bad].indexOf(i) % 3; if (k === 0) row[8] = '0'; else if (k === 1) row[5] = 'CAJA'; else row[2] = 'NO_EXISTE'; }
          rows.push(row);
        }
      } else if (type === 'CUSTOMERS') {
        const n = o.n || 850, noPin = o.noPin ?? 40, dups = o.dups ?? 12;
        const first = ['Ana', 'Luis', 'Rosa', 'Jorge', 'Carmen', 'Miguel', 'Lucía', 'Pedro', 'Elena', 'Raúl', 'Sofía', 'Diego', 'Marta', 'Iván', 'Julia', 'César'];
        const last = ['Quispe', 'Huamán', 'Rojas', 'Flores', 'Torres', 'Ramos', 'Vargas', 'Chávez', 'Castillo', 'Mendoza', 'Salazar', 'Paredes', 'Cárdenas', 'León'];
        const dists = ['Santiago de Surco', 'Miraflores', 'San Borja', 'La Molina', 'San Isidro', 'Barranco', 'Chorrillos', 'Surquillo'];
        const uniq = n - dups; const phones = [];
        for (let i = 1; i <= n; i++) {
          let ph; if (i > uniq) ph = phones[(i - uniq - 1) * 7 % phones.length]; else { ph = '9' + U.pad(10000000 + i * 104729 % 89999999, 8); phones.push(ph); }
          const lowConf = i <= uniq && i % Math.floor(uniq / noPin) === 0 && rows.filter(x => x[10] === '0,55').length < noPin;
          rows.push([i % 5 === 0 ? 'NINGUNO' : 'DNI', i % 5 === 0 ? '' : String(40000000 + i * 7919), `${first[i % first.length]} ${last[(i * 7) % last.length]} ${last[(i * 3) % last.length]}`, ph, i % 3 ? '' : `cliente${i}@correo.pe`, `Calle ${i} n.° ${100 + i % 900}`, `Frente al parque ${i % 40 + 1}, puerta verde`, dists[i % dists.length], (-12.08 - r() * 0.12).toFixed(5), (-76.95 - r() * 0.1).toFixed(5), lowConf ? '0,55' : '0,93', i % 4 ? 'SI' : 'NO']);
        }
      } else if (type === 'STOCK') {
        const vs = G.db.where('product_variants', v => v.status === 'ACTIVE' && v.sellable); if (!vs.length) G.fail('RN-ONB-08', 'No hay productos: importa o aplica la plantilla antes del stock.');
        const whs = (o.warehouses || G.db.where('warehouses', w => w.allows_sale).map(w => w.code)).slice(0, 2); if (!whs.length) G.fail('RN-ONB-08', 'No hay almacenes de venta (ONB-05).');
        const n = o.lots || 230; const cut = o.cutover || '2026-10-31';
        for (let i = 1; i <= n; i++) {
          const v = vs[i % vs.length]; const q = v.sale_mode === 'KG' ? 5 + Math.floor(r() * 30) : 4 + Math.floor(r() * 40);
          rows.push([whs[i % whs.length], v.sku, `AP${cut.slice(2, 4)}${cut.slice(5, 7)}-${U.pad(i, 3)}`, F.date(G.date.add(cut, 5 + Math.floor(r() * 60))), String(q), v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? dec(q * (v.nominal_weight_kg || 1), 3) : '', dec(v.std_cost || 10)]);
        }
      } else if (type === 'PRICES') {
        const vs = G.db.where('product_variants', v => v.brand_id === o.brand_id && v.sellable);
        vs.forEach((v, i) => { const cur = G.price.of(v.id, { brand_id: v.brand_id }); rows.push(['PUB', v.sku, dec(R((cur ? cur.price : 20) * 1.05, 1)), v.sale_mode === 'UNIT' ? 'UNIDAD' : 'KG', F.date(G.date.add(o.cutover || G.TODAY, 1))]); });
        if (rows.length) rows.push(['PUB', 'SKU-INEXISTENTE', '10', 'UNIDAD', '']);
      } else if (type === 'CUSTOMER_BALANCES') {
        const cs = G.db.where('customers', c => c.doc_number && c.status === 'ACTIVE').slice(0, o.n || 25);
        cs.forEach((c, i) => { const amt = 200 + Math.floor(r() * 1800); rows.push([c.doc_number, c.doc_type === 'RUC' ? 'FACTURA' : 'BOLETA', `${c.doc_type === 'RUC' ? 'F001' : 'B001'}-${U.pad(3100 + i, 8)}`, F.date(G.date.add(o.cutover || G.TODAY, -10 - i)), F.date(G.date.add(o.cutover || G.TODAY, 20 - i)), String(amt), String(i === 3 ? amt + 50 : Math.round(amt * (0.3 + r() * 0.7)))]); });
      } else if (type === 'SUPPLIERS') {
        [['2055418723', 'CAMAL SAN PEDRO DE LURÍN SAC', 'PRODUCTOR', 15], ['2050011873', 'EMPAQUES Y BOLSAS DEL PERÚ SAC', 'EMPAQUES', 30], ['2052219974', 'INSUMOS CÁRNICOS LIMA SAC', 'INSUMOS', 30], ['2060432871', 'MENSAJERÍA EXPRESS LIMA SAC', 'DELIVERY', 15]].forEach(([b, n2, t, d2]) => rows.push(['RUC', U.rucCheck(b), n2, n2.split(' ').slice(0, 2).join(' '), t, String(d2), '987' + U.pad(Math.floor(r() * 999999), 6), '']));
        rows.push(['RUC', '20123456789', 'PROVEEDOR CON RUC ERRADO SAC', '', 'OTRO', '0', '', '']);
      } else if (type === 'SUPPLIER_BALANCES') {
        G.db.all('suppliers').slice(0, 6).forEach((s, i) => { const amt = 500 + Math.floor(r() * 4000); rows.push([s.doc_number, 'FACTURA', `E001-${U.pad(900 + i, 8)}`, F.date(G.date.add(o.cutover || G.TODAY, -8 - i)), F.date(G.date.add(o.cutover || G.TODAY, 15)), String(amt), String(amt)]); });
      }
      return csvJoin([head, ...rows]);
    });
  }

  /* =====================================================================
     Semillas (orden 82): plantillas globales, registros y altas en curso
     ===================================================================== */
  G.seed(82, function seedONB() {
    // plantillas publicadas (globales)
    for (const [code, t] of Object.entries(TPL)) {
      const tpl = ins('industry_templates', { id: 'it-' + code + '-1', tenant: null, code, version: 1, product_id: 'COMERCIAL', name: t.name, description: t.desc, status: 'PUBLISHED', published_at: '2026-09-01T10:00' }, { global: true });
      t.items.forEach(([type, ic, req, payload], i) => ins('industry_template_items', { tenant: null, template_id: tpl.id, item_type: type, item_code: ic, requires_module: req, payload, seq: i + 1 }, { global: true }));
    }
    ins('industry_templates', { id: 'it-DISTRIBUIDORA_CARNES-2', tenant: null, code: 'DISTRIBUIDORA_CARNES', version: 2, product_id: 'COMERCIAL', name: 'Distribuidora de carnes v2 (con cordero y caldos)', description: 'Borrador: agrega cordero, caldos y despiece de cordero; pendiente de validar rendimientos (D-ONB-03).', status: 'DRAFT' }, { global: true });

    // altas completadas: Don Guando (piloto) y Carnes Selectas del Sur
    const done = (tenant, id, started, golive, firstDoc, ind, plan) => {
      within(tenant, () => {
        const co = G.db.find('companies', () => true);
        const r = ins('onboarding_runs', { id, signup_ref: null, industry: ind, industry_template_id: 'it-' + templateFor(ind) + '-1', plan_code: plan, status: 'COMPLETED', started_at: started, completed_at: golive + 'T09:00', go_live_at: golive, planned_go_live: golive, first_accepted_document_at: firstDoc, owner_user_id: null, company_id: co && co.id });
        STEPS.forEach((st, i) => ins('onboarding_steps', { run_id: r.id, step_code: st[0], seq: i + 1, is_required: st[3], status: tenant === 'CS' && ['WHATSAPP', 'IMPORT_BALANCES', 'IMPORT_STOCK'].includes(st[0]) ? 'SKIPPED' : 'DONE', completed_at: G.date.add(started.slice(0, 10), Math.min(i, G.date.diff(golive, started.slice(0, 10)))) + 'T17:00', completed_by: tenant === 'DG' ? 'Luis Ccahuana Rojas' : 'Hernán Salas Pino', owner_role: st[5] }));
      });
    };
    done('DG', 'onr-DG', '2026-08-18T09:00', '2026-09-01', '2026-09-01T10:42', 'DISTRIBUIDORA_CARNES', 'PILOTO');
    done('CS', 'onr-CS', '2026-09-08T11:00', '2026-09-20', '2026-09-20T12:15', 'DISTRIBUIDORA_CARNES', 'CRECIMIENTO');
    // importaciones históricas de Don Guando (resumen y filas con error)
    within('DG', () => {
      const hist = [['PRODUCTS', 'catalogo-don-guando.csv', 64, 2, 0, '2026-08-20T10:10', 'br-DG'], ['CUSTOMERS', 'clientes-whatsapp-web.csv', 436, 4, 12, '2026-08-22T15:30', null], ['STOCK', 'stock-apertura-31-08.csv', 74, 0, 0, '2026-08-29T18:00', null], ['CUSTOMER_BALANCES', 'saldos-restaurantes.csv', 18, 1, 0, '2026-08-30T11:00', null]];
      hist.forEach(([t, fn, tot, err, warn, at, br]) => {
        const hash = sha256(fn + at);
        const f = ins('file_attachments', { module_code: 'ONB', entity_type: 'data_imports', storage_key: 'onb/' + hash.slice(0, 16), file_name: fn, mime_type: 'text/csv', size_bytes: tot * 96, sha256: hash, classification: 'INTERNAL', status: 'ACTIVE' });
        const imp = ins('data_imports', { run_id: 'onr-DG', import_type: t, file_id: f.id, file_hash: hash, file_name: fn, template_version: 'v1', company_id: 'co-dg', brand_id: br, warehouse_id: t === 'STOCK' ? 'wh-ALM-L1' : null, cutover_date: t === 'STOCK' || t === 'CUSTOMER_BALANCES' ? '2026-08-31' : null, mode: 'INSERT_ONLY', allow_partial: err > 0, status: 'COMPLETED', headers: IMP[t].fields.map(x => x[0]), total_rows: tot, valid_rows: tot - err - warn, warning_rows: warn, error_rows: err, imported_rows: tot - err - warn, skipped_rows: warn, created_at: at, started_at: at, finished_at: at, executed_by: 'Luis Ccahuana Rojas', batches: [{ n: 1, rows: tot, imported: tot - err - warn, skipped: warn, failed: err, status: 'OK' }] });
        for (let k = 0; k < err; k++) ins('data_import_rows', { import_id: imp.id, row_no: 7 + k * 31, raw: Object.fromEntries(IMP[t].fields.map(x => [x[0], ''])), status: 'ERROR', errors: [{ col: t === 'CUSTOMERS' ? 'celular' : t === 'PRODUCTS' ? 'precio' : 'saldo', msg: t === 'CUSTOMERS' ? 'RN-ONB-13: el celular tiene 9 dígitos y empieza con 9.' : t === 'PRODUCTS' ? 'El precio debe ser mayor que 0.' : 'RN-ONB-11: el saldo va de 0 al importe.', level: 'ERROR' }] });
      });
    });

    // registros públicos (globales) y altas en curso de otras empresas
    const c = U.rucCheck;
    const mk = (ruc, contact, email, phone, ind, plan, src, at) => createSignup({ ruc, contact_name: contact, contact_email: email, contact_phone: phone, industry: ind, plan, source: src, at, noThrow: true });
    const sV = mk(c('2061234501'), 'Klaus Weber Ríos', 'kweber@lavienesa.pe', '987100201', 'CHARCUTERIA', 'CRECIMIENTO', 'google', '2026-09-28T09:15');
    const sR = mk(c('2061987402'), 'Gladys Rosales Paz', 'gerencia@avicolalosrosales.pe', '987100202', 'AVICOLA', 'INICIAL', 'tiktok', '2026-10-06T16:40');
    const sA = mk(c('2060456703'), 'Mariana Puente Arce', 'mariana@despensadealtura.pe', '987100203', 'TIENDA_GOURMET', 'MULTIMARCA', 'referido', '2026-09-15T11:05');
    mk(c('2060111204'), 'Óscar Benites Lara', 'obenites@carnesdelnorte.pe', '987100204', 'DISTRIBUIDORA_CARNES', 'CRECIMIENTO', 'meta', '2026-10-09T19:20');
    mk(c('2060777709'), 'Rubén Inga Castro', 'ventas@embutidosdelvalle.pe', '987100207', 'CHARCUTERIA', 'INICIAL', 'meta', '2026-10-07T08:30');
    mk(c('2048899105'), 'Walter Pizarro Díaz', 'wpizarro@eltrujillano.pe', '987100205', 'PROVEEDOR_RESTAURANTES', 'CRECIMIENTO', 'google', '2026-10-02T10:00');
    mk(c('2052200306'), 'Patricia Gamarra', 'pgamarra@provgastro.pe', '987100206', 'PROVEEDOR_RESTAURANTES', 'INICIAL', 'directo', '2026-09-25T12:30');
    const sQ = mk(c('1072233441'), 'Juana Quispe Mamani', 'juanaquispe@correo.pe', '987100208', 'CARNICERIA_PREMIUM', 'INICIAL', 'tiktok', '2026-09-20T18:05');
    upd('signup_requests', sQ, { status: 'EXPIRED', reject_reason: 'No verificó el correo en 7 días (onb_signup_expire_days)' });

    // La Vienesa: 50 % (empresa, marcas, locales, almacenes, plantilla; productos validados con errores)
    const rV = verifySignup(sV.id, null, { at: '2026-09-28T09:40', ignoreExpiry: true, runId: 'onr-VIENESA' });
    saveCompany(rV.id, { trade_name: 'La Vienesa', fiscal_address: 'Av. Arequipa 2450, Lince, Lima', tax_regime: 'MYPE', primary_color: '#6B2D1A' });
    addBrand(rV.id, { code: 'LV', name: 'La Vienesa', color: '#6B2D1A' });
    addBrand(rV.id, { code: 'AHU', name: 'Ahumados Weber', color: '#3E5C2B' });
    const eV = addEstablishment(rV.id, { code: 'LIN', name: 'Planta y tienda Lince', sunat_code: '0000', est_type: 'MIXED', address: 'Av. Arequipa 2450, Lince', has_counter: true });
    addWarehouse(rV.id, { establishment_id: eV.id, code: 'CAM-LIN', name: 'Cámara de frío Lince', wh_type: 'COLD_ROOM', min_temp_c: 0, max_temp_c: 4 });
    addWarehouse(rV.id, { establishment_id: eV.id, code: 'TDA-LIN', name: 'Exhibidora de la tienda', wh_type: 'STORE', min_temp_c: 0, max_temp_c: 4 });
    within(rV.tenant, () => { if (!G.db.find('tenant_modules', m => m.module_code === 'REC' && m.enabled)) { const m = G.db.find('tenant_modules', x => x.module_code === 'REC'); if (m) G.db.update('tenant_modules', m.id, { enabled: true, reason: 'Complemento recetas' }, { silent: true }); } });
    applyTemplate(rV.id, 'CHARCUTERIA', 'br-LV~' + rV.tenant, { at: '2026-09-30T10:00' });
    const pV = createImport(rV.id, { type: 'PRODUCTS', content: sampleCsv(rV.id, 'PRODUCTS', { n: 48, errors: 3, seed: 11 }), file_name: 'catalogo-la-vienesa.csv', brand_id: 'br-LV~' + rV.tenant, at: '2026-10-02T16:20' });
    void pV;
    // Los Rosales: recién empieza
    const rR = verifySignup(sR.id, null, { at: '2026-10-06T17:02', ignoreExpiry: true, runId: 'onr-ROSALES' });
    saveCompany(rR.id, { trade_name: 'Los Rosales', fiscal_address: 'Carretera Central km 18,5, Ate, Lima', tax_regime: 'MYPE', primary_color: '#B35C1E' });
    // Despensa de Altura: casi lista (falta el primer comprobante y la salida)
    const rA = verifySignup(sA.id, null, { at: '2026-09-15T11:30', ignoreExpiry: true, runId: 'onr-ALTURA' });
    saveCompany(rA.id, { trade_name: 'Despensa de Altura', fiscal_address: 'Calle Berlín 380, Miraflores, Lima', tax_regime: 'MYPE', primary_color: '#2A6A8C' });
    addBrand(rA.id, { code: 'DA', name: 'Despensa de Altura', color: '#2A6A8C' });
    addBrand(rA.id, { code: 'QC', name: 'Qori Café', color: '#5A3A22' });
    const eA = addEstablishment(rA.id, { code: 'MIR', name: 'Tienda Miraflores', sunat_code: '0000', est_type: 'STORE', address: 'Calle Berlín 380, Miraflores', has_counter: true });
    const eA2 = addEstablishment(rA.id, { code: 'SUR', name: 'Almacén Surquillo', sunat_code: '0001', est_type: 'WAREHOUSE', address: 'Jr. Dante 912, Surquillo', has_counter: false });
    addWarehouse(rA.id, { establishment_id: eA.id, code: 'TDA-MIR', name: 'Tienda Miraflores', wh_type: 'STORE', min_temp_c: 15, max_temp_c: 25 });
    addWarehouse(rA.id, { establishment_id: eA2.id, code: 'ALM-SUR', name: 'Almacén seco Surquillo', wh_type: 'MAIN' });
    proposeSeries(rA.id, 'BRAND');
    setLastNumber(rA.id, 'B001', 4521); setLastNumber(rA.id, 'F001', 388);
    testEinvoice(rA.id, { provider: 'OSE_GENERICO', user: 'despensa.ose', secret: 'clave-segura-01', at: '2026-09-22T10:00' });
    savePayments(rA.id, ['CASH', 'YAPE', 'PLIN', 'CARD', 'TRANSFER'], [{ code: 'CAJA-MIR', name: 'Caja tienda Miraflores', type: 'CASH_REGISTER', establishment_id: eA.id }, { code: 'YAPE', name: 'Yape empresa', type: 'WALLET', account_number: '+51987300100' }]);
    connectWhatsapp(rA.id, { number: '987300101', brand_id: 'br-DA~' + rA.tenant, display_name: 'Despensa de Altura' });
    addZone(rA.id, { code: 'MIR', name: 'Miraflores y San Isidro', establishment_id: eA.id, districts: 'Miraflores, San Isidro, Surquillo, Barranco', delivery_fee: 8, free_from_units: 4, min_order_amount: 40 });
    applyTemplate(rA.id, 'TIENDA_GOURMET', 'br-DA~' + rA.tenant, { at: '2026-09-23T09:30' });
    const cA = createImport(rA.id, { type: 'CUSTOMERS', content: sampleCsv(rA.id, 'CUSTOMERS', { n: 160, noPin: 9, dups: 4, seed: 21 }), file_name: 'clientes-despensa.csv', at: '2026-09-24T12:00' });
    runImport(cA.id, { allowPartial: true });
    skipStep(rA.id, 'IMPORT_PRODUCTS', 'Catálogo cargado con la plantilla gourmet');
    const stA = createImport(rA.id, { type: 'STOCK', content: sampleCsv(rA.id, 'STOCK', { lots: 36, warehouses: ['TDA-MIR', 'ALM-SUR'], cutover: '2026-09-30', seed: 31 }), file_name: 'stock-30-09.csv', warehouse_id: 'wh-ALM-SUR~' + rA.tenant, cutover_date: '2026-09-30', at: '2026-09-25T17:45' });
    runImport(stA.id);
    inviteUser(rA.id, { name: 'Tomás Arce Puente', email: 'tomas@despensadealtura.pe', role: 'CAJERO', sites: [eA.id], brands: [] });
    inviteUser(rA.id, { name: 'Nadia Chuquimango', email: 'nadia@despensadealtura.pe', role: 'VENDEDORA', sites: [], brands: ['br-DA~' + rA.tenant, 'br-QC~' + rA.tenant] });
    skipStep(rA.id, 'IMPORT_BALANCES', 'Sin cuentas por cobrar al corte');
  }, 'ONB alta de empresas');

  /* =====================================================================
     Indicadores (KPI-ONB-01..03)
     ===================================================================== */
  const curRun = () => G.db.find('onboarding_runs', r => r.status === 'IN_PROGRESS') || G.db.where('onboarding_runs', () => true).sort(U.by('started_at', -1))[0] || null;
  G.kpiCalc['KPI-ONB-01'] = () => { const r = curRun(); if (!r) return { value: null }; const p = progressOf(r); return { value: p.pct, numerator: p.done, denominator: p.req }; };
  G.kpiCalc['KPI-ONB-02'] = () => { const r = curRun(); if (!r || !r.first_accepted_document_at) return { value: null }; return { value: G.date.diff(r.first_accepted_document_at.slice(0, 10), r.started_at.slice(0, 10)) }; };
  G.kpiCalc['KPI-ONB-03'] = p => { const imps = G.db.where('data_imports', i => ['COMPLETED', 'VALIDATED', 'FAILED_VALIDATION'].includes(i.status) && (!p || !p.type || i.import_type === p.type)); const tot = U.sum(imps, i => i.total_rows), err = U.sum(imps, i => i.error_rows); return { value: tot ? R(err / tot * 100, 2) : 0, numerator: err, denominator: tot }; };

  /* =====================================================================
     Interfaz
     ===================================================================== */
  function pickRun(params) {
    const all = runs();
    let r = (params && params.run && runGet(params.run)) || (S.run && runGet(S.run)) || all.find(x => x.status === 'IN_PROGRESS' && x.id === 'onr-VIENESA') || all.find(x => x.status === 'IN_PROGRESS') || all[0];
    if (r) S.run = r.id;
    return r;
  }
  /** selector de alta (empresa) en la cabecera de las pantallas del asistente */
  function runBar(run, code) {
    const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Alta', id: 'onb-run-pick' }, style: 'max-width:100%' }, runs().slice().sort(U.by('started_at', -1)).map(r => h('option', { value: r.id, selected: r.id === run.id }, `${tenantName(r.tenant)} · ${G.ui.statusLabel(r.status)} · ${F.pct(progressOf(r).pct, 0)}`)));
    sel.addEventListener('change', () => { S.run = sel.value; G.go(code, { run: sel.value }); });
    const p = progressOf(run);
    return h('div', { class: 'card' }, h('div', { class: 'card-body' }, h('div', { class: 'row', style: 'flex-wrap:wrap;gap:12px;align-items:center' },
      h('div', { style: 'flex:1;min-width:220px' }, h('label', { class: 'muted small', attrs: { for: 'onb-run-pick' } }, 'Alta (empresa cliente del SaaS)'), sel),
      h('div', { style: 'min-width:160px' }, h('div', { class: 'muted small' }, `Avance ${p.done} de ${p.req} obligatorios`), progress(p.pct, p.pct >= 100 ? 'ok' : ''), h('b', null, F.pct(p.pct, 0))),
      status(run.status), badge('Plan ' + planName(run.plan_code), 'info'),
      run.tenant !== G.ctx.tenant ? h('span', { class: 'muted small' }, 'Vista del asistente de esta empresa (simulación desde la consola)') : null)));
  }
  /** envuelve la pantalla del asistente: datos del tenant del alta */
  function wizard(code, title, sub, body) {
    return (el, params) => {
      const run = pickRun(params);
      const b = page(el, { code, title, sub });
      if (!run) { b.appendChild(notice('No hay altas registradas. Crea un registro en ONB-01.', 'info')); return; }
      b.appendChild(runBar(run, code));
      within(run.tenant, () => body(b, run, params || {}));
    };
  }
  /** acción con el tenant del alta; refresca al terminar; muestra el error de regla */
  const act = (run, fn, okMsg) => (...a) => { try { const r = within(run.tenant, () => fn(...a)); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); return false; } };
  const stepChip = (run, code) => { const s = stepOf(run, code); return s ? h('span', { class: 'row', style: 'gap:6px' }, h('span', { class: 'muted small' }, 'Paso ' + stepLabel(code) + ':'), status(s.status), s.is_required ? badge('Obligatorio', 'warn') : badge('Opcional')) : null; };
  const preNotice = (run, code) => { if (run.status !== 'IN_PROGRESS') return null; const m = missingPre(run, code); return m.length ? notice(`RN-ONB-06: este paso requiere antes ${m.map(stepLabel).join(', ')}.`, 'warn') : null; };
  const brandOpts = () => G.db.where('brands', b => b.status === 'ACTIVE').map(b => [b.id, b.name]);
  const estOpts = () => G.db.all('establishments').map(e => [e.id, `${e.code} · ${e.name}`]);
  /** pide un dato en un modal (reemplaza prompt) */
  function ask(title, label, def, onOk, opts = {}) {
    modal(title, body => { const i = h(opts.textarea ? 'textarea' : 'input', { class: 'input', value: def ?? '', attrs: { 'aria-label': label, id: 'onb-ask' } }); body.appendChild(h('div', { class: 'field' }, h('label', { attrs: { for: 'onb-ask' } }, label), i)); body._i = i; },
      [{ label: 'Cancelar' }, { label: opts.ok || 'Aceptar', kind: opts.danger ? 'danger' : 'primary', onClick: () => { const v = document.getElementById('onb-ask').value; if (opts.required && !String(v).trim()) { toast('Este dato es obligatorio.', 'warn'); return false; } return onOk(v) === false ? false : undefined; } }]);
  }
  const dot = color => h('span', { style: { display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', background: color || 'var(--muted)', marginRight: '6px', verticalAlign: 'middle' } });

  /* ---------- ONB-01 Registro ---------- */
  function scrRegistro(el) {
    const b = page(el, { code: 'ONB-01', title: 'Registro', sub: 'Formulario público: el RUC se valida con el dígito verificador y se consulta en SUNAT (adaptador FAKE, D-ONB-01); al verificar el correo se aprovisiona la empresa con prueba gratuita.' });
    const info = h('div');
    const showSunat = ruc => { clearEl(info); if (!ruc || String(ruc).length < 11) return; try { const p = sunatLookup(ruc); info.appendChild(notice(dl([['Razón social', p.legal_name], ['Estado', p.status], ['Condición', p.condition], ['Domicilio fiscal', p.address]]), /ACTIVO/.test(p.status) && !/NO HABIDO/.test(p.condition) ? 'ok' : 'bad')); } catch (e) { info.appendChild(notice(e.message, 'bad')); } };
    const f = form({
      id: 'onb-signup', submitLabel: 'Registrarme y enviar el enlace',
      fields: [
        { key: 'ruc', label: 'RUC', required: true, placeholder: '20XXXXXXXXX', onChange: v => showSunat(String(v).trim()), help: 'Prueba: 20612345015 (activo), un RUC con el último dígito cambiado (rechazado), 20488991050 (NO HABIDO).' },
        { key: 'contact_name', label: 'Nombre del contacto', required: true }, { key: 'contact_email', label: 'Correo', required: true },
        { key: 'contact_phone', label: 'Celular', placeholder: '9 dígitos' },
        { key: 'product', label: 'Producto', type: 'select', options: PRODUCTS_SAAS, required: true },
        { key: 'plan', label: 'Plan de la prueba', type: 'select', options: Object.entries(PLANS).map(([k, p]) => [k, `${p.name} · ${p.brands} marca(s), ${p.sites} local(es), ${p.users} usuarios, ${F.num(p.orders)} pedidos, ${p.wa} WhatsApp`]), required: true, help: 'D-SUS-03: límites propuestos.' },
        { key: 'industry', label: 'Rubro', type: 'select', options: INDUSTRIES, required: true },
        { key: 'source', label: '¿Cómo nos conociste?', type: 'select', options: ORIGINS, required: true },
      ],
      values: { product: 'COMERCIAL', plan: 'CRECIMIENTO', industry: 'DISTRIBUIDORA_CARNES', source: 'google' },
      onSubmit(v) {
        try { const s = createSignup(v); toast(`Registro creado: enviamos el enlace de verificación a ${s.contact_email}`, 'ok'); showLink(s); G.refresh(); return true; } catch (e) { toast(e.message, 'bad'); return e.message; }
      },
    });
    b.appendChild(h('div', { class: 'grid c2' }, card('Datos del registro', h('div', null, f, info)), card('Qué pasa al verificar el correo (RN-ONB-17)', h('ol', { class: 'small', style: 'padding-left:18px;margin:0;line-height:1.7' },
      h('li', null, 'Se crea el tenant con la empresa y los datos de SUNAT.'), h('li', null, `Suscripción TRIAL del plan elegido por ${G.param('sus_trial_days_default') || 14} días (SUS).`), h('li', null, 'Usuario administrador con segundo factor obligatorio.'), h('li', null, 'Roles, permisos, módulos del plan, parámetros e indicadores de todas las fases.'), h('li', null, 'La lista de 16 pasos del alta (ONB-02).'),
      h('li', null, `El enlace vence a las ${G.param('onb_signup_token_hours') || 48} h; un registro sin verificar vence a los ${G.param('onb_signup_expire_days') || 7} días.`)))));
    const recent = raw('signup_requests').slice().sort(U.by('created_at', -1)).slice(0, 8);
    b.appendChild(table({ id: 'onb01-recent', columns: [{ key: 'created_at', label: 'Fecha', render: s => F.datetime(s.created_at) }, { key: 'ruc', label: 'RUC', mono: true }, { key: 'legal_name', label: 'Razón social' }, { key: 'industry', label: 'Rubro', render: s => indName(s.industry) }, { key: 'status', label: 'Estado', render: s => status(s.status) }],
      rows: recent, search: false, onRow: s => signupDrawer(s), actions: s => s.status === 'PENDING_VERIFICATION' ? [btn('Abrir enlace', () => showLink(s), { sm: true })] : [] }));
  }
  function showLink(s) {
    modal('Correo de verificación (simulado)', body => {
      body.appendChild(dl([['Para', s.contact_email], ['Asunto', 'Confirma tu correo para empezar con Aycha'], ['Empresa', `${s.legal_name} · RUC ${s.ruc}`], ['Enlace', h('span', { class: 'mono small', style: 'word-break:break-all' }, `https://registro.aycha.pe/verificar?t=${s._token || '…(enviado por correo)'}`)], ['Vence', `${G.param('onb_signup_token_hours') || 48} h después del envío (${F.datetime(s.token_sent_at)})`]]));
    }, [{ label: 'Cerrar' }, { label: 'Reenviar enlace', onClick: () => { try { resendVerification(s.id); toast('Enlace reenviado', 'ok'); } catch (e) { toast(e.message, 'bad'); } return true; } },
      { label: 'Verificar correo y crear empresa', kind: 'primary', onClick: () => { try { const r = verifySignup(s.id, s._token || null, { ignoreExpiry: !s._token && false }); S.run = r.id; toast(`Empresa aprovisionada (${tenantName(r.tenant)}): sigue con la lista de pasos`, 'ok'); G.go('ONB-02', { run: r.id }); } catch (e) { toast(e.message, 'bad'); return false; } } }]);
  }
  function signupDrawer(s) {
    drawer(s.legal_name || s.ruc, body => {
      body.appendChild(dl([['RUC', s.ruc], ['SUNAT', `${s.sunat_status || '—'} / ${s.sunat_condition || '—'}`], ['Contacto', `${s.contact_name} · ${s.contact_email} · ${s.contact_phone || '—'}`], ['Producto y plan', `${s.product_id} · ${planName(s.plan_id)}`], ['Rubro', indName(s.industry)], ['Origen', (ORIGINS.find(o => o[0] === (s.utm || {}).source) || ['', (s.utm || {}).source || '—'])[1]], ['Estado', status(s.status)], ['Motivo', s.reject_reason], ['Verificado', F.datetime(s.email_verified_at)], ['Vence', F.datetime(s.expires_at)], ['Empresa creada', s.tenant_ref ? tenantName(s.tenant_ref) : '—']]));
      const r = s.tenant_ref && runs().find(x => x.tenant === s.tenant_ref);
      if (r) body.appendChild(h('div', { class: 'row', style: 'margin-top:12px' }, btn('Abrir lista de pasos', () => { S.run = r.id; G.go('ONB-02', { run: r.id }); }, { kind: 'primary' })));
      if (s.status === 'PENDING_VERIFICATION') body.appendChild(h('div', { class: 'row', style: 'margin-top:12px' }, btn('Ver enlace de verificación', () => showLink(s))));
    }, { code: 'ONB-01' });
  }

  /* ---------- ONB-02 Lista de pasos ---------- */
  const scrPasos = wizard('ONB-02', 'Lista de pasos', 'Pasos obligatorios y opcionales con estado, prerrequisitos (RN-ONB-06), responsable y avance; «Continuar donde quedé» lleva al siguiente paso posible.', (b, run) => {
    const p = progressOf(run); const st = stepsOf(run);
    const days = G.date.diff((run.completed_at || G.TODAY).slice(0, 10), run.started_at.slice(0, 10));
    const sub = G.db.find('subscriptions', () => true);
    const remind = G.param('onb_pending_step_reminder_days') || 3;
    b.appendChild(kpis([
      { label: 'Avance del alta (KPI-ONB-01)', value: F.pct(p.pct, 0), sub: `${p.done} de ${p.req} obligatorios`, tone: p.pct >= 100 ? 'ok' : '' },
      { label: 'Pasos hechos', value: `${p.allDone} / ${p.all}`, sub: `${p.pending} pendientes` },
      { label: 'Días desde el inicio', value: F.num(days), sub: 'Inicio ' + F.date(run.started_at) },
      { label: 'Prueba gratuita', value: sub && sub.trial_ends_at ? F.date(sub.trial_ends_at) : '—', sub: sub ? G.ui.statusLabel(sub.status) : 'Sin suscripción (piloto)' },
      { label: 'Tiempo de alta (KPI-ONB-02)', value: run.first_accepted_document_at ? F.days(G.date.diff(run.first_accepted_document_at.slice(0, 10), run.started_at.slice(0, 10))) : '—', sub: 'Hasta el primer comprobante aceptado' },
    ]));
    const nx = nextStep(run);
    if (run.status === 'IN_PROGRESS') b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap' }, nx ? Object.assign(btn(`Continuar donde quedé: ${stepLabel(nx.step_code)}`, () => G.go(STEP[nx.step_code].screen, { run: run.id }), { kind: 'primary' }), { style: 'white-space:normal;text-align:left;max-width:100%' }) : null,
      days >= remind && p.pending ? notice(`Hay ${p.pending} pasos pendientes y ya pasaron ${days} días: se envía un recordatorio cada ${remind} días (onb_pending_step_reminder_days).`, 'warn') : null));
    else b.appendChild(notice(`Alta completada el ${F.datetime(run.completed_at)} · inicio de operación ${F.date(run.go_live_at)}.`, 'ok'));
    b.appendChild(table({
      id: 'onb02-steps', search: false, pageSize: 20,
      columns: [{ key: 'seq', label: '#', align: 'r' }, { key: 'step_code', label: 'Paso', render: s => h('div', null, h('b', null, stepLabel(s.step_code)), h('div', { class: 'muted small' }, STEP[s.step_code].screen)) },
        { key: 'is_required', label: 'Tipo', render: s => s.is_required ? badge('Obligatorio', 'warn') : badge('Opcional') },
        { key: 'status', label: 'Estado', render: s => status(s.status) },
        { key: 'pre', label: 'Prerrequisitos', sort: false, render: s => { const pre = STEP[s.step_code].pre; if (!pre.length) return '—'; if (pre[0] === '*') return 'Todo lo obligatorio'; const m = missingPre(run, s.step_code); return h('span', null, pre.map(x => h('span', { class: 'badge ' + (m.includes(x) ? 'warn' : 'ok'), style: 'margin:1px' }, stepLabel(x)))); } },
        { key: 'owner_role', label: 'Responsable', render: s => G.roleName(s.owner_role) },
        { key: 'completed_at', label: 'Hecho', render: s => s.completed_at ? h('div', null, F.datetime(s.completed_at), h('div', { class: 'muted small' }, s.completed_by || '')) : '—' }],
      rows: st, onRow: s => G.go(STEP[s.step_code].screen, { run: run.id }),
      actions: s => run.status !== 'IN_PROGRESS' ? [] : [
        s.status === 'PENDING' && !['GO_LIVE'].includes(s.step_code) ? btn('Marcar hecho', act(run, () => completeStep(run, s.step_code), 'Paso marcado como hecho'), { sm: true }) : null,
        s.status === 'PENDING' && !s.is_required ? btn('Omitir', act(run, () => skipStep(run, s.step_code), 'Paso omitido'), { sm: true, kind: 'ghost' }) : null,
        s.status === 'PENDING' && !FIXED_REQUIRED.includes(s.step_code) ? btn(s.is_required ? 'Hacer opcional' : 'Hacer obligatorio', act(run, () => setRequired(run, s.step_code, !s.is_required)), { sm: true, kind: 'ghost', title: OPTIONAL_BY_SPEC.includes(s.step_code) ? 'Opcional por defecto (RN-ONB-04)' : null }) : null,
      ].filter(Boolean),
    }));
  });

  /* ---------- ONB-03 Empresa ---------- */
  const scrEmpresa = wizard('ONB-03', 'Empresa', 'Datos fiscales traídos de SUNAT (la razón social y el RUC no se editan), nombre comercial, domicilio, régimen, logo y colores.', (b, run) => {
    const co = G.db.get('companies', run.company_id) || {};
    b.appendChild(stepChip(run, 'COMPANY'));
    const prev = h('div');
    const draw = v => { clearEl(prev).appendChild(h('div', { class: 'card', style: { borderTop: `6px solid ${v.primary_color || '#922242'}` } }, h('div', { class: 'card-body row', style: 'gap:12px;align-items:center' }, h('div', { style: { width: '48px', height: '48px', borderRadius: '10px', background: v.primary_color || '#922242', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: '700' } }, String(v.trade_name || co.legal_name || '?').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()), h('div', { style: 'min-width:0' }, h('b', null, v.trade_name || '—'), h('div', { class: 'muted small' }, `${co.legal_name} · RUC ${co.ruc}`), h('div', { class: 'muted small' }, v.fiscal_address || ''))))); };
    const f = form({ id: 'onb03', submitLabel: 'Guardar empresa', values: { legal_name: co.legal_name, ruc: co.ruc, sunat: `${co.sunat_status || 'ACTIVO'} / ${co.sunat_condition || 'HABIDO'}`, trade_name: co.trade_name, fiscal_address: co.fiscal_address, fiscal_ubigeo: co.fiscal_ubigeo, tax_regime: co.tax_regime || 'MYPE', logo_url: co.logo_url || '', primary_color: co.primary_color || '#922242', secondary_color: co.secondary_color || '#FFC676' },
      fields: [{ key: 'legal_name', label: 'Razón social (SUNAT)', type: 'readonly' }, { key: 'ruc', label: 'RUC', type: 'readonly' }, { key: 'sunat', label: 'Estado / condición', type: 'readonly' },
        { key: 'trade_name', label: 'Nombre comercial', required: true, onChange: (v, vals) => draw(vals) }, { key: 'fiscal_address', label: 'Domicilio fiscal', required: true, span: 2, onChange: (v, vals) => draw(vals) }, { key: 'fiscal_ubigeo', label: 'Ubigeo' },
        { key: 'tax_regime', label: 'Régimen tributario', type: 'select', options: [['MYPE', 'Régimen MYPE Tributario'], ['RER', 'Régimen Especial (RER)'], ['RG', 'Régimen General'], ['NRUS', 'Nuevo RUS']] },
        { key: 'logo_url', label: 'Logo (URL o archivo en INT)' }, { key: 'primary_color', label: 'Color principal', type: 'color', onChange: (v, vals) => draw(vals) }, { key: 'secondary_color', label: 'Color secundario', type: 'color' }],
      onSubmit: v => { try { saveCompany(run.id, v); toast('Empresa guardada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } });
    draw(f.api.values);
    b.appendChild(h('div', { class: 'grid side-r' }, card('Datos de la empresa', f), card('Vista previa', prev)));
  });

  /* ---------- ONB-04 Marcas ---------- */
  const scrMarcas = wizard('ONB-04', 'Marcas', 'Alta de marcas con logo, color y pie legal; avisa al acercarse al límite del plan (RN-SUS-06).', (b, run) => {
    b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, stepChip(run, 'BRANDS'), preNotice(run, 'BRANDS')));
    const bs = G.db.all('brands').sort(U.by('sort_order')); const lim = planOf(run.plan_code).brands; const act0 = bs.filter(x => x.status === 'ACTIVE').length;
    b.appendChild(kpis([{ label: 'Marcas activas', value: `${act0} de ${lim}`, sub: 'Límite del plan ' + planName(run.plan_code), tone: act0 >= lim ? 'bad' : act0 >= lim - 1 ? 'warn' : '' }]));
    if (act0 >= lim - 1 && act0 < lim) b.appendChild(notice(`Te queda ${lim - act0} marca en el plan ${planName(run.plan_code)}: al superar el límite se pedirá un complemento de marcas (SUS-03).`, 'warn'));
    b.appendChild(table({ id: 'onb04', search: false, columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Marca', render: x => h('span', null, dot(x.primary_color), x.name) }, { key: 'whatsapp_display_name', label: 'Nombre en WhatsApp' }, { key: 'legal_footer', label: 'Pie legal', render: x => h('span', { class: 'small' }, x.legal_footer) }, { key: 'status', label: 'Estado', render: x => status(x.status) }], rows: bs, empty: 'Aún no hay marcas.' }));
    b.appendChild(card('Nueva marca', form({ id: 'onb04f', submitLabel: 'Agregar marca', values: { color: '#922242' }, fields: [{ key: 'code', label: 'Código (2 a 6)', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'color', label: 'Color', type: 'color' }, { key: 'wa_name', label: 'Nombre visible en WhatsApp' }, { key: 'logo_url', label: 'Logo (URL)' }, { key: 'description', label: 'Descripción', type: 'textarea' }],
      onSubmit: v => { try { addBrand(run.id, v); toast('Marca agregada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })));
  });

  /* ---------- ONB-05 Locales y almacenes ---------- */
  const scrLocales = wizard('ONB-05', 'Locales y almacenes', 'Locales con código de anexo SUNAT y tipo; almacenes por local (cámara, congeladora, tienda) con su rango de temperatura.', (b, run) => {
    b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, stepChip(run, 'ESTABLISHMENTS'), stepChip(run, 'WAREHOUSES'), preNotice(run, 'ESTABLISHMENTS')));
    const es = G.db.all('establishments'), ws = G.db.all('warehouses');
    b.appendChild(h('div', { class: 'grid c2' },
      card('Locales', h('div', null, table({ id: 'onb05e', search: false, columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Local' }, { key: 'sunat_code', label: 'Anexo SUNAT', mono: true }, { key: 'est_type', label: 'Tipo', render: e => ({ MIXED: 'Producción y tienda', STORE: 'Tienda', PLANT: 'Planta', WAREHOUSE: 'Almacén' }[e.est_type] || e.est_type) }, { key: 'has_counter', label: 'Mostrador', render: e => e.has_counter ? 'Sí' : 'No' }], rows: es, empty: 'Sin locales.' }),
        form({ id: 'onb05ef', submitLabel: 'Agregar local', values: { sunat_code: es.length ? U.pad(es.length, 4) : '0000', est_type: 'MIXED' }, fields: [{ key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'sunat_code', label: 'Código de anexo SUNAT', required: true, help: '0000 = domicilio fiscal' }, { key: 'est_type', label: 'Tipo', type: 'select', options: [['MIXED', 'Producción y tienda'], ['STORE', 'Tienda'], ['PLANT', 'Planta'], ['WAREHOUSE', 'Almacén']] }, { key: 'address', label: 'Dirección', span: 2 }, { key: 'has_counter', label: 'Tiene mostrador', type: 'checkbox' }],
          onSubmit: v => { try { addEstablishment(run.id, v); toast('Local agregado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))),
      card('Almacenes', h('div', null, table({ id: 'onb05w', search: false, columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Almacén' }, { key: 'establishment_id', label: 'Local', render: w => (G.db.get('establishments', w.establishment_id) || {}).code || '—' }, { key: 'wh_type', label: 'Tipo', render: w => (WH_TYPES.find(t => t[0] === w.wh_type) || [0, w.wh_type])[1] }, { key: 'temp', label: 'Temperatura', render: w => w.min_temp_c != null ? `${w.min_temp_c} a ${w.max_temp_c} °C` : 'Ambiente' }], rows: ws, empty: 'Sin almacenes.' }),
        es.length ? form({ id: 'onb05wf', submitLabel: 'Agregar almacén', values: { establishment_id: es[0].id, wh_type: 'COLD_ROOM', min_temp_c: 0, max_temp_c: 4 }, fields: [{ key: 'establishment_id', label: 'Local', type: 'select', options: estOpts(), required: true }, { key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'wh_type', label: 'Tipo', type: 'select', options: WH_TYPES, onChange: (v, vals, api) => { const d = { COLD_ROOM: [0, 4], FREEZER: [-22, -18], STORE: [0, 4], MAIN: ['', ''] }[v]; if (d) { api.set('min_temp_c', d[0]); api.set('max_temp_c', d[1]); } } }, { key: 'min_temp_c', label: 'Temp. mínima (°C)', type: 'number' }, { key: 'max_temp_c', label: 'Temp. máxima (°C)', type: 'number' }],
          onSubmit: v => { try { addWarehouse(run.id, v); toast('Almacén agregado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }) : notice('RN-ONB-06: registra primero un local.', 'warn')))));
  });

  /* ---------- ONB-06 Series y comprobante electrónico ---------- */
  const scrSeries = wizard('ONB-06', 'Series y comprobante electrónico', 'Series propuestas (F001, B001, T001) por empresa o por marca; último correlativo del sistema anterior (RN-ONB-18); credenciales del OSE y comprobante de prueba.', (b, run) => {
    b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, stepChip(run, 'SERIES'), stepChip(run, 'EINVOICE'), preNotice(run, 'SERIES')));
    const ss = G.db.all('document_series').sort(U.by('series'));
    let mode = 'BRAND';
    const modeSel = h('select', { class: 'input', attrs: { 'aria-label': 'Modo de series' } }, h('option', { value: 'BRAND' }, 'Una serie por marca (F001, F002…)'), h('option', { value: 'COMPANY' }, 'Una serie para toda la empresa'));
    modeSel.addEventListener('change', () => { mode = modeSel.value; });
    b.appendChild(card('Series', h('div', null,
      h('div', { class: 'row', style: 'flex-wrap:wrap;margin-bottom:10px' }, modeSel, btn('Generar series propuestas', () => act(run, () => proposeSeries(run.id, mode), r => `${r.length} serie(s) creada(s)`)(), { kind: 'primary' })),
      table({ id: 'onb06', search: false, pageSize: 30, columns: [{ key: 'series', label: 'Serie', mono: true }, { key: 'doc_type', label: 'Tipo', render: s => G.docTypeName(s.doc_type) === s.doc_type ? ({ DISPATCH_GUIDE: 'Guía de remisión' }[s.doc_type] || s.doc_type) : G.docTypeName(s.doc_type) }, { key: 'brand_id', label: 'Marca', render: s => s.brand_id ? G.brandName(s.brand_id) : 'Toda la empresa' }, { key: 'establishment_id', label: 'Local', render: s => (G.db.get('establishments', s.establishment_id) || {}).code || '—' }, { key: 'legacy_last_number', label: 'Último en el sistema anterior', align: 'r', render: s => s.legacy_last_number != null ? F.num(s.legacy_last_number) : '—' }, { key: 'next_number', label: 'Primer número en Aycha', render: s => h('span', { class: 'mono' }, `${s.series}-${U.pad(s.next_number, 8)}`) }],
        rows: ss, empty: 'Genera las series propuestas.', actions: s => [btn('Último correlativo', () => ask(`Serie ${s.series}`, 'Último número emitido en el sistema anterior', s.legacy_last_number ?? '', v => act(run, () => setLastNumber(run.id, s.series, v), r => `${r.series}: el primero en Aycha será ${r.series}-${U.pad(r.next_number, 8)}`)(), { required: true, ok: 'Guardar' }), { sm: true })] }))));
    const co = G.db.get('companies', run.company_id) || {};
    const t = co.einvoice_test;
    b.appendChild(h('div', { class: 'grid c2' },
      card('Credenciales del OSE', form({ id: 'onb06o', submitLabel: 'Guardar y enviar comprobante de prueba', values: { provider: co.einvoice_provider || 'OSE_GENERICO', user: co.einvoice_user || '' }, fields: [{ key: 'provider', label: 'Proveedor (EInvoiceProvider)', type: 'select', options: [['OSE_GENERICO', 'OSE homologado (genérico)'], ['SUNAT_SEE', 'SEE SUNAT (sistema del contribuyente)'], ['FAKE', 'FAKE (desarrollo)']] }, { key: 'user', label: 'Usuario SOL / OSE', required: true }, { key: 'secret', label: 'Clave', type: 'password', required: true, help: 'Se guarda cifrada (INT); se muestran solo los 4 últimos caracteres.' }],
        onSubmit: v => { try { const r = within(run.tenant, () => testEinvoice(run.id, v)); toast('Comprobante de prueba aceptado: ' + r.ticket, 'ok'); G.refresh(); return true; } catch (e) { toast(e.message, 'bad'); G.refresh(); return true; } } })),
      card('Último comprobante de prueba', t ? h('div', null, notice(t.message, t.result === 'ACCEPTED' ? 'ok' : 'bad'), dl([['Enviado', F.datetime(t.at)], ['Serie', t.series], ['Resultado', status(t.result)], ['Ticket', t.ticket], ['Entorno', co.einvoice_env || 'BETA'], ['Clave', co.einvoice_secret_last4 ? '••••' + co.einvoice_secret_last4 : '—']])) : G.ui.empty('Aún no se envió el comprobante de prueba.'))));
  });

  /* ---------- ONB-07 Medios de pago y cajas ---------- */
  const scrPagos = wizard('ONB-07', 'Medios de pago y cajas', 'Efectivo, Yape, Plin, POS de tarjeta, pasarela web y transferencia; cajas por local.', (b, run) => {
    b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, stepChip(run, 'PAYMENT_METHODS'), preNotice(run, 'PAYMENT_METHODS')));
    const pms = G.db.all('payment_methods'); const on = new Set(pms.filter(p => p.status === 'ACTIVE').map(p => p.code));
    const boxes = h('div', { class: 'stack', style: 'gap:6px' });
    const checks = PM_DEFAULTS.map(([c, n, k, ref]) => { const i = h('input', { type: 'checkbox', checked: on.has(c) || (!pms.length && ['CASH', 'YAPE', 'PLIN'].includes(c)) }); boxes.appendChild(h('label', { class: 'check' }, i, h('span', null, `${n}${ref ? ' · exige referencia (RN-CAJ-02)' : ''}`))); return [c, i]; });
    const cas = G.db.all('cash_accounts');
    const es = G.db.all('establishments');
    b.appendChild(h('div', { class: 'grid c2' },
      card('Medios de pago', h('div', null, boxes, h('div', { class: 'row', style: 'margin-top:10px' }, btn('Guardar medios y crear cajas por local', () => act(run, () => savePayments(run.id, checks.filter(x => x[1].checked).map(x => x[0]), es.map(e => ({ code: 'CAJA-' + e.code, name: 'Caja ' + e.name, type: 'CASH_REGISTER', establishment_id: e.id }))), 'Medios de pago y cajas guardados')(), { kind: 'primary' })))),
      card('Cajas y cuentas', h('div', null, table({ id: 'onb07', search: false, columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Caja o cuenta' }, { key: 'account_type', label: 'Tipo' }, { key: 'establishment_id', label: 'Local', render: a => (G.db.get('establishments', a.establishment_id) || {}).code || 'Empresa' }], rows: cas, empty: 'Sin cajas.' }),
        form({ id: 'onb07f', submitLabel: 'Agregar caja o cuenta', values: { type: 'BANK' }, fields: [{ key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'type', label: 'Tipo', type: 'select', options: [['CASH_REGISTER', 'Caja de local'], ['PETTY_CASH', 'Caja chica'], ['BANK', 'Cuenta bancaria'], ['WALLET', 'Billetera (Yape/Plin)'], ['GATEWAY', 'Pasarela'], ['CARD_ACQUIRER', 'POS de tarjeta']] }, { key: 'establishment_id', label: 'Local', type: 'select', options: estOpts() }, { key: 'account_number', label: 'Número de cuenta o celular' }],
          onSubmit: v => { try { within(run.tenant, () => savePayments(run.id, G.db.where('payment_methods', p => p.status === 'ACTIVE').map(p => p.code).concat(on.size ? [] : ['CASH']), [v])); toast('Caja agregada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })))));
  });

  /* ---------- ONB-08 Números de WhatsApp ---------- */
  const scrWhatsapp = wizard('ONB-08', 'Números de WhatsApp', 'Un número por marca o compartido, conectado con el registro integrado del proveedor oficial (Cloud API con coexistencia); prohibidos los conectores por QR.', (b, run) => {
    b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, stepChip(run, 'WHATSAPP'), preNotice(run, 'WHATSAPP')));
    const chs = G.db.where('messaging_channels', c => c.kind === 'WHATSAPP'); const lim = planOf(run.plan_code).wa;
    b.appendChild(kpis([{ label: 'Números conectados', value: `${chs.filter(c => c.status !== 'DISCONNECTED').length} de ${lim}`, sub: 'Límite del plan (RN-SUS-06)', tone: chs.length >= lim ? 'warn' : '' }]));
    b.appendChild(table({ id: 'onb08', search: false, columns: [{ key: 'number', label: 'Número', mono: true }, { key: 'display_name', label: 'Nombre visible' }, { key: 'brand_id', label: 'Marca', render: c => c.shared ? badge('Compartido', 'info') : G.brandName(c.brand_id) }, { key: 'coexistence', label: 'Coexistencia', render: c => c.coexistence ? 'Sí (app + API)' : 'Solo API' }, { key: 'quality_rating', label: 'Calidad' }, { key: 'status', label: 'Estado', render: c => status(c.status) }], rows: chs, empty: 'Sin números conectados.' }));
    b.appendChild(card('Conectar un número (registro integrado)', form({ id: 'onb08f', submitLabel: 'Conectar con el proveedor oficial', values: { coexistence: true }, fields: [{ key: 'number', label: 'Celular', required: true, placeholder: '9 dígitos' }, { key: 'display_name', label: 'Nombre visible' }, { key: 'brand_id', label: 'Marca', type: 'select', options: brandOpts() }, { key: 'shared', label: 'Número compartido por varias marcas', type: 'checkbox' }, { key: 'coexistence', label: 'Coexistencia (sigue funcionando la app WhatsApp Business)', type: 'checkbox' }],
      onSubmit: v => { try { within(run.tenant, () => connectWhatsapp(run.id, Object.assign({}, v, { brand_id: v.shared ? null : v.brand_id }))); toast('Número conectado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })));
  });

  /* ---------- ONB-09 Zonas de reparto ---------- */
  const scrZonas = wizard('ONB-09', 'Zonas de reparto', 'Zonas por local con distritos (o polígono en CLI), tarifa y regla de delivery gratis.', (b, run) => {
    b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, stepChip(run, 'DELIVERY_ZONES'), preNotice(run, 'DELIVERY_ZONES')));
    const zs = G.db.all('delivery_zones');
    b.appendChild(table({ id: 'onb09', search: false, columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Zona' }, { key: 'establishment_id', label: 'Despacha', render: z => (G.db.get('establishments', z.establishment_id) || {}).code || '—' }, { key: 'districts', label: 'Distritos', render: z => (Array.isArray(z.districts) ? z.districts : [z.districts]).join(', ') }, { key: 'delivery_fee', label: 'Tarifa', align: 'r', render: z => F.money(z.delivery_fee) }, { key: 'free', label: 'Gratis desde', render: z => [z.free_from_units ? `${z.free_from_units} u` : null, z.free_from_kg ? `${z.free_from_kg} kg` : null].filter(Boolean).join(' o ') || '—' }, { key: 'min_order_amount', label: 'Pedido mínimo', align: 'r', render: z => F.money(z.min_order_amount) }], rows: zs, empty: 'Sin zonas.' }));
    const es = G.db.all('establishments');
    b.appendChild(card('Nueva zona', es.length ? form({ id: 'onb09f', submitLabel: 'Agregar zona', values: { establishment_id: es[0].id, delivery_fee: 8, free_from_units: 3, min_order_amount: 30 }, fields: [{ key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'establishment_id', label: 'Local que despacha', type: 'select', options: estOpts(), required: true }, { key: 'districts', label: 'Distritos (separados por coma)', required: true, span: 2 }, { key: 'delivery_fee', label: 'Tarifa (S/)', type: 'money', min: 0 }, { key: 'free_from_units', label: 'Gratis desde (unidades)', type: 'number', min: 0 }, { key: 'free_from_kg', label: 'Gratis desde (kg)', type: 'number', min: 0 }, { key: 'min_order_amount', label: 'Pedido mínimo (S/)', type: 'money', min: 0 }, { key: 'province', label: 'Envío a provincia', type: 'checkbox' }],
      onSubmit: v => { try { addZone(run.id, v); toast('Zona agregada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }) : notice('RN-ONB-06: registra primero un local.', 'warn')));
  });

  /* ---------- ONB-10 Plantilla por rubro ---------- */
  const scrPlantilla = wizard('ONB-10', 'Plantilla por rubro', 'Vista previa de lo que crea la plantilla por tipo y módulo requerido; se aplica una vez por marca y es idempotente (RN-ONB-07).', (b, run, params) => {
    b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, stepChip(run, 'TEMPLATE'), preNotice(run, 'TEMPLATE')));
    const pub = raw('industry_templates').filter(t => t.status === 'PUBLISHED');
    let code = params.tpl || S.tpl || templateFor(run.industry) || 'DISTRIBUIDORA_CARNES'; if (!pub.find(t => t.code === code)) code = pub[0].code; S.tpl = code;
    const tpl = tplRow(code); const items = tplItems(tpl);
    const bs = brandOpts();
    const selT = h('select', { class: 'input', attrs: { 'aria-label': 'Plantilla' } }, pub.map(t => h('option', { value: t.code, selected: t.code === code }, `${t.name} · v${t.version}`)));
    selT.addEventListener('change', () => { S.tpl = selT.value; G.refresh(); });
    const selB = h('select', { class: 'input', attrs: { 'aria-label': 'Marca' } }, bs.map(([v, l]) => h('option', { value: v }, l)));
    const byType = U.groupBy(items, 'item_type');
    b.appendChild(card('Plantilla', h('div', null,
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, selT, selB, btn('Aplicar a la marca', () => { if (!selB.value) return toast('RN-ONB-07: registra una marca (ONB-04).', 'bad'); act(run, () => applyTemplate(run.id, code, selB.value), a => `Plantilla aplicada: ${a.items_created} creados, ${a.items_skipped} omitidos, ${a.items_failed} fallidos`)(); }, { kind: 'primary', disabled: !bs.length })),
      h('p', { class: 'muted small' }, tpl.description), notice('D-ONB-03: rendimientos de despiece y fórmulas «de ejemplo, ajustar con pesadas propias».', 'info'))));
    b.appendChild(kpis(Object.entries(byType).map(([t, arr]) => ({ label: ITEM_TYPE[t] || t, value: arr.length, sub: arr[0].requires_module ? `Requiere ${arr[0].requires_module}${G.modOn(arr[0].requires_module) ? '' : ' (apagado: se omitirá)'}` : 'Núcleo', tone: arr[0].requires_module && !G.modOn(arr[0].requires_module) ? 'warn' : '' }))));
    b.appendChild(table({ id: 'onb10i', pageSize: 30, filters: [{ key: 'item_type', label: 'Tipo', options: Object.keys(byType).map(t => [t, ITEM_TYPE[t] || t]) }], columns: [{ key: 'seq', label: '#', align: 'r' }, { key: 'item_type', label: 'Tipo', render: i => ITEM_TYPE[i.item_type] || i.item_type }, { key: 'item_code', label: 'Código', mono: true }, { key: 'name', label: 'Qué crea', value: i => i.payload.name || i.payload.label || i.item_code, render: i => i.payload.name || i.payload.label || `${i.item_code} = ${i.payload.value}` }, { key: 'requires_module', label: 'Módulo', render: i => i.requires_module ? h('span', null, i.requires_module, ' ', G.modOn(i.requires_module) ? badge('Encendido', 'ok') : badge('Apagado', 'warn')) : '—' }, { key: 'detail', label: 'Detalle', sort: false, render: i => i.item_type === 'PRODUCT' ? `${G.saleModeName(i.payload.mode)} · ${F.money(i.payload.price)}${i.payload.mode === 'UNIT' ? '' : '/kg'}` : i.item_type === 'KPI_TARGET' ? `Meta ${i.payload.target}` : i.item_type === 'BREAKDOWN' ? i.payload.lines.map(l => `${l[0]} ${l[1]} %`).join(', ') : i.item_type === 'CHECKLIST' ? `${i.payload.items.length} puntos` : '' }], rows: items }));
    const apps = G.db.all('template_applications').sort(U.by('applied_at', -1));
    b.appendChild(card('Aplicaciones', apps.length ? table({ id: 'onb10a', search: false, columns: [{ key: 'applied_at', label: 'Fecha', render: a => F.datetime(a.applied_at) }, { key: 'template_code', label: 'Plantilla', render: a => (TPL[a.template_code] || {}).name || a.template_code }, { key: 'brand_id', label: 'Marca', render: a => G.brandName(a.brand_id) }, { key: 'items_created', label: 'Creados', align: 'r' }, { key: 'items_skipped', label: 'Omitidos', align: 'r' }, { key: 'items_failed', label: 'Fallidos', align: 'r' }, { key: 'status', label: 'Estado', render: a => status(a.status) }], rows: apps, onRow: a => appDrawer(a) }) : G.ui.empty('La plantilla aún no se aplicó.'), { flush: true }));
  });
  function appDrawer(a) {
    drawer('Resultado de la plantilla', body => {
      body.appendChild(dl([['Plantilla', `${(TPL[a.template_code] || {}).name || a.template_code} v${a.template_version}`], ['Marca', G.brandName(a.brand_id)], ['Aplicada', `${F.datetime(a.applied_at)} · ${a.applied_by || ''}`], ['Resultado', `${a.items_created} creados · ${a.items_skipped} omitidos · ${a.items_failed} fallidos`]]));
      body.appendChild(table({ id: 'onb10d', search: false, pageSize: 40, columns: [{ key: 'item_type', label: 'Tipo', render: d => ITEM_TYPE[d.item_type] || d.item_type }, { key: 'item_code', label: 'Código', mono: true }, { key: 'result', label: 'Resultado', render: d => badge({ CREATED: 'Creado', SKIPPED: 'Omitido', FAILED: 'Fallido' }[d.result], { CREATED: 'ok', SKIPPED: 'warn', FAILED: 'bad' }[d.result]) }, { key: 'reason', label: 'Motivo' }], rows: a.detail }));
    }, { wide: true, code: 'ONB-10' });
  }

  /* ---------- ONB-11 Importar: subir y mapear ---------- */
  const scrImportar = wizard('ONB-11', 'Importar: subir y mapear', 'Descarga la plantilla del tipo, sube el archivo (CSV guardado desde Excel), asocia columnas y elige el modo y los datos de corte.', (b, run) => {
    const type = S.type; const def = IMP[type];
    b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, def.step ? stepChip(run, def.step) : null, def.step ? preNotice(run, def.step) : null));
    const selT = h('select', { class: 'input', attrs: { 'aria-label': 'Tipo de importación' } }, Object.entries(IMP).map(([k, d]) => h('option', { value: k, selected: k === type }, d.label)));
    selT.addEventListener('change', () => { S.type = selT.value; S.file = null; G.refresh(); });
    const fileIn = h('input', { type: 'file', class: 'input', attrs: { accept: '.csv,.txt,.tsv', 'aria-label': 'Archivo' } });
    fileIn.addEventListener('change', () => { const f = fileIn.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { S.file = { name: f.name, content: String(rd.result) }; G.refresh(); }; rd.readAsText(f); });
    b.appendChild(card('1. Tipo y archivo', h('div', { class: 'stack' },
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, selT, btn('Descargar plantilla de Excel', () => download(`plantilla-${type.toLowerCase()}.csv`, templateCsv(type))), btn('Usar archivo de ejemplo', act(run, () => { S.file = { name: `ejemplo-${type.toLowerCase()}.csv`, content: sampleCsv(run.id, type, { brand_id: (brandOpts()[0] || [])[0], seed: Date.now() % 1000 }) }; }), { kind: 'ghost' })),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, fileIn, S.file ? badge(`${S.file.name} · ${F.num(csvParse(S.file.content).length - 1)} filas`, 'info') : h('span', { class: 'muted small' }, 'Sin archivo')),
      h('p', { class: 'muted small' }, `Columnas: ${def.fields.map(f => f[0] + (f[2] ? '*' : '')).join(', ')}. Máximo ${F.num(G.param('onb_import_max_rows') || 20000)} filas (RN-ONB-12). El mismo archivo no se importa dos veces (RN-ONB-09).`))));
    if (!S.file) return;
    const rows = csvParse(S.file.content); const headers = rows[0] || []; const map = autoMap(type, headers);
    const sels = {};
    const mapTbl = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Campo de Aycha'), h('th', null, 'Columna del archivo'), h('th', null, 'Ejemplo'))), h('tbody', null, def.fields.map(([k, label, req]) => {
      const s = h('select', { class: 'input', attrs: { 'aria-label': label } }, h('option', { value: '' }, '— sin asociar —'), headers.map((hh, i) => h('option', { value: i, selected: map[k] === i }, hh)));
      const ex = h('span', { class: 'muted small' }, map[k] !== undefined && rows[1] ? rows[1][map[k]] : '');
      s.addEventListener('change', () => { ex.textContent = s.value !== '' && rows[1] ? rows[1][Number(s.value)] : ''; });
      sels[k] = s; return h('tr', null, h('td', null, label, req ? h('b', { style: 'color:var(--bad)' }, ' *') : ''), h('td', null, s), h('td', null, ex));
    })));
    b.appendChild(card('2. Asociar columnas', h('div', { class: 'tbl-wrap' }, mapTbl)));
    const whs = G.db.all('warehouses');
    const f = form({ id: 'onb11', submitLabel: 'Validar archivo', values: { mode: 'INSERT_ONLY', brand_id: (brandOpts()[0] || [])[0], warehouse_id: whs[0] && whs[0].id, company_id: run.company_id, cutover_date: G.date.add(run.planned_go_live || G.TODAY, -1) },
      fields: [{ key: 'mode', label: 'Modo', type: 'select', options: [['INSERT_ONLY', 'Solo nuevos'], ['UPSERT', 'Nuevos y actualizar existentes']] },
        def.needs.includes('brand') ? { key: 'brand_id', label: 'Marca', type: 'select', options: brandOpts(), required: true } : null,
        def.needs.includes('warehouse') ? { key: 'warehouse_id', label: 'Almacén por defecto (RN-ONB-10)', type: 'select', options: whs.map(w => [w.id, `${w.code} · ${w.name}`]), required: true } : null,
        def.needs.includes('company') ? { key: 'company_id', label: 'Empresa (RN-ONB-10)', type: 'select', options: G.db.all('companies').map(c => [c.id, `${c.legal_name} · ${c.ruc}`]), required: true } : null,
        def.needs.includes('cutover') ? { key: 'cutover_date', label: 'Fecha de corte', type: 'date', required: true, help: `Anterior al primer día de operación (${F.date(run.go_live_at || run.planned_go_live)}, RN-ONB-15).` } : null].filter(Boolean),
      onSubmit: v => {
        const m = {}; for (const [k, s] of Object.entries(sels)) if (s.value !== '') m[k] = Number(s.value);
        try { const imp = within(run.tenant, () => createImport(run.id, Object.assign({}, v, { type, content: S.file.content, file_name: S.file.name, map: m }))); S.imp = imp.id; S.file = null; toast(`Validación: ${imp.valid_rows} válidas, ${imp.warning_rows} con advertencia, ${imp.error_rows} con error`, imp.error_rows ? 'warn' : 'ok'); G.go('ONB-12', { run: run.id, imp: imp.id }); return true; } catch (e) { return e.message; }
      } });
    b.appendChild(card('3. Modo y datos de corte', f));
  });

  /* ---------- ONB-12 Importar: validación ---------- */
  function impPicker(run, code, params) {
    const imps = importsOf(run);
    let imp = (params.imp && impGet(params.imp)) || (S.imp && imps.find(i => i.id === S.imp)) || imps[0];
    if (imp) S.imp = imp.id;
    const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Importación' } }, imps.map(i => h('option', { value: i.id, selected: imp && i.id === imp.id }, `${F.datetime(i.created_at)} · ${IMP[i.import_type].label} · ${i.file_name} · ${G.ui.statusLabel(i.status)}`)));
    sel.addEventListener('change', () => { S.imp = sel.value; G.go(code, { run: run.id, imp: sel.value }); });
    return { imp, bar: imps.length ? h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, sel, btn('Nueva importación', () => G.go('ONB-11', { run: run.id }), { kind: 'ghost' })) : null };
  }
  const scrValidacion = wizard('ONB-12', 'Importar: validación', 'Resultado por fila con errores por columna; descarga del Excel con la columna de errores; aceptar importar solo las filas válidas (RN-ONB-08).', (b, run, params) => {
    const { imp, bar } = impPicker(run, 'ONB-12', params);
    if (!imp) { b.appendChild(notice('No hay importaciones. Sube un archivo en ONB-11.', 'info')); return; }
    b.appendChild(bar);
    const pct = imp.total_rows ? R(imp.error_rows / imp.total_rows * 100, 1) : 0;
    b.appendChild(kpis([{ label: 'Filas leídas', value: F.num(imp.total_rows) }, { label: 'Válidas', value: F.num(imp.valid_rows), tone: 'ok' }, { label: 'Con advertencia', value: F.num(imp.warning_rows), tone: imp.warning_rows ? 'warn' : '' }, { label: 'Con error', value: F.num(imp.error_rows), tone: imp.error_rows ? 'bad' : '' }, { label: 'Filas con error (KPI-ONB-03)', value: F.pct(pct, 1), tone: pct > 0 ? 'warn' : 'ok' }]));
    if (imp.file_error) b.appendChild(notice(imp.file_error, 'bad'));
    const acc = h('input', { type: 'checkbox', checked: !!imp.allow_partial, attrs: { id: 'onb12-acc' } });
    const canRun = imp.status === 'VALIDATED';
    b.appendChild(card('Decisión', h('div', { class: 'stack' },
      dl([['Archivo', `${imp.file_name} · huella ${imp.file_hash.slice(0, 16)}…`], ['Tipo', IMP[imp.import_type].label], ['Modo', imp.mode === 'UPSERT' ? 'Nuevos y actualizar' : 'Solo nuevos'], ['Estado', status(imp.status)], imp.cutover_date ? ['Fecha de corte', F.date(imp.cutover_date)] : null, imp.warehouse_id ? ['Almacén', (G.db.get('warehouses', imp.warehouse_id) || {}).name] : null]),
      imp.error_rows && canRun ? h('label', { class: 'check', attrs: { for: 'onb12-acc' } }, acc, h('span', null, `Acepto importar solo las ${imp.valid_rows + imp.warning_rows} filas válidas; las ${imp.error_rows} con error quedan fuera.`)) : null,
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' },
        btn('Descargar Excel con errores', () => download(`errores-${imp.file_name}`, errorFile(imp.id)), { disabled: !imp.error_rows }),
        canRun ? btn('Ejecutar importación', () => { const r = act(run, () => runImport(imp.id, { allowPartial: acc.checked }), x => `Importación terminada: ${x.imported_rows} filas importadas`)(); if (r) G.go('ONB-13', { run: run.id, imp: imp.id }); }, { kind: 'primary' }) : null,
        ['UPLOADED', 'VALIDATED', 'FAILED_VALIDATION'].includes(imp.status) ? btn('Volver a validar', act(run, () => validateImport(imp.id), 'Validación actualizada'), { kind: 'ghost' }) : null,
        ['UPLOADED', 'VALIDATED', 'FAILED_VALIDATION'].includes(imp.status) ? btn('Cancelar importación', act(run, () => cancelImport(imp.id), 'Importación cancelada'), { kind: 'danger' }) : null))));
    const def = IMP[imp.import_type];
    b.appendChild(table({ id: 'onb12r-' + imp.id, pageSize: 25, filters: [{ key: 'status', label: 'Estado', options: [['VALID', 'Válida'], ['WARNING', 'Advertencia'], ['ERROR', 'Error'], ['IMPORTED', 'Importada'], ['SKIPPED', 'Omitida']] }],
      columns: [{ key: 'row_no', label: 'Fila', align: 'r' }, { key: 'status', label: 'Estado', render: r => status(r.status) }, ...def.fields.slice(0, 4).map(([k, l]) => ({ key: k, label: l.split(' (')[0], value: r => r.raw[k] })), { key: 'errors', label: 'Errores y advertencias', sort: false, value: r => (r.errors || []).map(e => e.msg).join(' '), render: r => (r.errors || []).length ? h('div', { class: 'small' }, r.errors.map(e => h('div', null, badge(e.col || 'fila', e.level === 'ERROR' ? 'bad' : 'warn'), ' ', e.msg))) : '—' }],
      rows: rowsOf(imp), searchText: r => Object.values(r.raw).join(' ') }));
  });

  /* ---------- ONB-13 Importar: ejecución ---------- */
  const scrEjecucion = wizard('ONB-13', 'Importar: ejecución', 'Avance por lotes de 500 filas en transacción (RN-ONB-16): importadas, omitidas y fallidas, enlace a lo creado, liberación del stock inicial y reversión.', (b, run, params) => {
    const { imp, bar } = impPicker(run, 'ONB-13', params);
    if (!imp) { b.appendChild(notice('No hay importaciones ejecutadas.', 'info')); return; }
    b.appendChild(bar);
    if (!['COMPLETED', 'CANCELLED', 'IMPORTING'].includes(imp.status)) { b.appendChild(notice(`La importación está ${G.ui.statusLabel(imp.status)}: revísala y ejecútala en ONB-12 (RN-ONB-08).`, 'warn')); b.appendChild(btn('Ir a la validación', () => G.go('ONB-12', { run: run.id, imp: imp.id }), { kind: 'primary' })); return; }
    const bs = imp.batches || [];
    const tot = imp.total_rows || 1;
    b.appendChild(kpis([{ label: 'Importadas', value: F.num(imp.imported_rows), tone: 'ok' }, { label: 'Omitidas (duplicados o existentes)', value: F.num(imp.skipped_rows || 0), tone: imp.skipped_rows ? 'warn' : '' }, { label: 'Fallidas', value: F.num(imp.error_rows), tone: imp.error_rows ? 'bad' : '' }, { label: 'Lotes', value: bs.length, sub: `de ${BATCH} filas` }]));
    b.appendChild(h('div', null, progress(R((imp.imported_rows + (imp.skipped_rows || 0)) / tot * 100), 'ok'), h('div', { class: 'muted small' }, `${F.pct((imp.imported_rows + (imp.skipped_rows || 0)) / tot * 100, 0)} de las filas procesadas · ${F.datetime(imp.started_at)} → ${F.datetime(imp.finished_at)}`)));
    if (imp.status === 'CANCELLED') b.appendChild(notice(`Importación ${imp.reverted_at ? 'revertida el ' + F.datetime(imp.reverted_at) + ' por ' + (imp.reverted_by || '') : 'cancelada'}: ${imp.revert_reason || ''}`, 'warn'));
    b.appendChild(table({ id: 'onb13b', search: false, columns: [{ key: 'n', label: 'Lote', align: 'r' }, { key: 'rows', label: 'Filas', align: 'r' }, { key: 'imported', label: 'Importadas', align: 'r' }, { key: 'skipped', label: 'Omitidas', align: 'r' }, { key: 'failed', label: 'Fallidas', align: 'r' }, { key: 'status', label: 'Resultado', render: x => x.status === 'OK' ? badge('Confirmado', 'ok') : badge('Revertido', 'bad') }, { key: 'error', label: 'Detalle' }], rows: bs }));
    const created = rowsOf(imp).filter(r => r.status === 'IMPORTED');
    const extra = [];
    if (imp.import_type === 'STOCK') {
      const lots = (imp.opening_lots || []).map(id => G.db.get('lots', id)).filter(Boolean);
      const q = lots.filter(l => l.qc_status === 'QUARANTINE').length;
      const val = R(U.sum(created, r => (r.norm.qty || 0) * (r.norm.cost || 0)));
      extra.push(kpis([{ label: 'Valor del inventario inicial', value: F.money(val), sub: 'Σ cantidad × costo unitario del archivo' }, { label: 'Lotes en cuarentena', value: `${q} de ${lots.length}`, sub: 'RN-ONB-14 · D-ONB-04', tone: q ? 'warn' : 'ok' }]));
      if (q && imp.status === 'COMPLETED') extra.push(h('div', { class: 'row' }, btn(`Liberar ${q} lotes (Calidad)`, () => G.require('onb.import.release_opening_stock', act(run, () => releaseOpeningStock(imp.id), n => `${n} lotes liberados`)), { kind: 'primary' })));
    }
    b.appendChild(h('div', { class: 'stack' }, ...extra,
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' },
        btn(`Ver lo creado (${created.length})`, () => createdDrawer(run, imp, created)),
        btn('Descargar Excel con errores', () => download(`errores-${imp.file_name}`, errorFile(imp.id)), { disabled: !imp.error_rows }),
        imp.status === 'COMPLETED' ? btn('Revertir importación', () => ask('Revertir importación', 'Motivo de la reversión', '', why => act(run, () => revertImport(imp.id, why), 'Importación revertida: puedes volver a subir el archivo')(), { required: true, textarea: true, danger: true, ok: 'Revertir' }), { kind: 'danger' }) : null)));
  });
  function createdDrawer(run, imp, created) {
    drawer(`Creado por ${imp.file_name}`, body => within(run.tenant, () => {
      const name = r => { const t = r.target_table, x = t && G.db.get(t, r.target_id); if (!x) return r.target_id; if (t === 'stock_movements') return `${G.variantName(x.variant_id)} · ${G.whName(x.warehouse_id)} · ${F.num(x.qty, 3)} · ${x.lot_id ? (G.db.get('lots', x.lot_id) || {}).code : 'sin lote'}`; if (t === 'opening_balances') return `${x.doc_reference} · ${F.money(x.balance)}`; if (t === 'price_list_items') return `${G.variantName(x.variant_id)} · ${F.money(x.price)}`; return x.full_name || x.name || x.legal_name || x.sku || x.id; };
      body.appendChild(table({ id: 'onb13c', pageSize: 20, columns: [{ key: 'row_no', label: 'Fila', align: 'r' }, { key: 'target_table', label: 'Tabla', mono: true }, { key: 'n', label: 'Registro', value: r => name(r) }], rows: created }));
    }), { wide: true, code: 'ONB-13' });
  }

  /* ---------- ONB-14 Usuarios e invitaciones ---------- */
  const scrUsuarios = wizard('ONB-14', 'Usuarios e invitaciones', 'Invitar por correo con rol, locales y marcas; segundo factor obligatorio para los roles que lo exigen.', (b, run) => {
    b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, stepChip(run, 'USERS'), preNotice(run, 'USERS')));
    const us = G.db.where('users', u => !u.platform && u.role !== 'CLIENTE_B2B'); const lim = planOf(run.plan_code).users;
    b.appendChild(kpis([{ label: 'Usuarios del personal', value: `${us.filter(u => ['ACTIVE', 'INVITED'].includes(u.status)).length} de ${lim}`, sub: 'Límite del plan (RN-SUS-06)' }, { label: 'Invitaciones pendientes', value: us.filter(u => u.status === 'INVITED').length }, { label: 'Con segundo factor', value: us.filter(u => u.twofa_enabled).length }]));
    b.appendChild(table({ id: 'onb14', search: false, columns: [{ key: 'name', label: 'Nombre' }, { key: 'email', label: 'Correo' }, { key: 'role', label: 'Rol', render: u => G.roleName(u.role) }, { key: 'scope', label: 'Alcance', sort: false, render: u => [(u.brands || []).map(G.brandName).join(', '), (u.sites || []).map(s => (G.db.get('establishments', s) || {}).code).join(', ')].filter(Boolean).join(' · ') || 'Todo' }, { key: 'twofa', label: 'Segundo factor', render: u => u.twofa_required ? (u.twofa_enabled ? badge('Activo', 'ok') : badge('Obligatorio', 'warn')) : (u.twofa_enabled ? badge('Activo', 'ok') : 'Opcional') }, { key: 'status', label: 'Estado', render: u => status(u.status) }], rows: us,
      actions: u => u.status === 'INVITED' ? [btn('Aceptar invitación (simulado)', () => act(run, () => acceptInvite(run.id, u.id, true), 'Invitación aceptada con segundo factor')(), { sm: true })] : [] }));
    const roles = G.db.where('roles', r => r.status === 'ACTIVE'); const roleOpts = (roles.length ? roles.map(r => [r.code, r.name + (r.requires_mfa ? ' · 2FA' : '')]) : G.ROLES.filter(r => !['CLIENTE_B2B', 'SOPORTE_PLATAFORMA'].includes(r[0])));
    const bx = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:10px' }); const bChk = G.db.where('brands', x => x.status === 'ACTIVE').map(x => { const i = h('input', { type: 'checkbox' }); bx.appendChild(h('label', { class: 'check' }, i, h('span', null, x.name))); return [x.id, i]; });
    const sx = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:10px' }); const sChk = G.db.all('establishments').map(x => { const i = h('input', { type: 'checkbox' }); sx.appendChild(h('label', { class: 'check' }, i, h('span', null, x.code))); return [x.id, i]; });
    b.appendChild(card('Invitar', h('div', { class: 'stack' }, form({ id: 'onb14f', submitLabel: 'Enviar invitación', values: { role: 'VENDEDORA' }, fields: [{ key: 'name', label: 'Nombre', required: true }, { key: 'email', label: 'Correo', required: true }, { key: 'role', label: 'Rol', type: 'select', options: roleOpts, required: true, help: 'Gerencia, Administrador, Administración y Contadora exigen segundo factor.' }],
      extraActions: [h('div', { class: 'stack', style: 'gap:4px;width:100%' }, h('span', { class: 'muted small' }, 'Marcas'), bx, h('span', { class: 'muted small' }, 'Locales'), sx)],
      onSubmit: v => { try { within(run.tenant, () => inviteUser(run.id, Object.assign({}, v, { brands: bChk.filter(x => x[1].checked).map(x => x[0]), sites: sChk.filter(x => x[1].checked).map(x => x[0]) }))); toast('Invitación enviada a ' + v.email, 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))));
  });

  /* ---------- ONB-15 Salida a producción ---------- */
  const scrSalida = wizard('ONB-15', 'Salida a producción', 'Checklist final, primer comprobante real aceptado por SUNAT y fecha de inicio de operación (RN-ONB-05).', (b, run) => {
    const st = stepsOf(run).filter(s => s.step_code !== 'GO_LIVE');
    const pend = st.filter(s => s.status === 'PENDING' || (s.is_required && s.status !== 'DONE'));
    b.appendChild(h('div', { class: 'grid c2' },
      card('Checklist final', h('div', { class: 'stack', style: 'gap:6px' }, st.map(s => h('div', { class: 'row between' }, h('span', null, (s.status === 'DONE' ? '✓ ' : s.status === 'SKIPPED' ? '– ' : '○ ') + stepLabel(s.step_code), s.is_required ? h('span', { class: 'muted small' }, ' · obligatorio') : null), status(s.status))),
        h('div', { class: 'row between' }, h('span', null, (run.first_accepted_document_at ? '✓ ' : '○ ') + 'Primer comprobante real aceptado'), run.first_accepted_document_at ? badge('Aceptado', 'ok') : badge('Pendiente', 'warn')))),
      card('Primer comprobante real', run.first_accepted_document_at ? (() => { const d = run.first_document_id && G.db.get('sales_documents', run.first_document_id); return h('div', null, notice(`Aceptado por SUNAT el ${F.datetime(run.first_accepted_document_at)}.`, 'ok'), d ? dl([['Comprobante', d.full_number], ['Total', F.money(d.total)], ['Cliente', d.customer_name || 'Clientes varios']]) : null); })() :
        form({ id: 'onb15d', submitLabel: 'Emitir y enviar a SUNAT', values: { series: (G.db.find('document_series', s => s.doc_type === 'RECEIPT') || {}).series, amount: 45, description: 'Primera venta en Aycha' }, fields: [{ key: 'series', label: 'Serie', type: 'select', options: G.db.where('document_series', s => ['RECEIPT', 'INVOICE'].includes(s.doc_type)).map(s => [s.series, `${s.series} · siguiente ${s.series}-${U.pad(s.next_number, 8)}`]), required: true }, { key: 'description', label: 'Descripción', required: true }, { key: 'amount', label: 'Total con IGV', type: 'money', min: 1, required: true }],
          onSubmit: v => { try { const d = within(run.tenant, () => issueFirstDocument(run.id, v)); toast(`Comprobante ${d.full_number} aceptado`, 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))));
    if (run.status === 'COMPLETED') { b.appendChild(notice(`La empresa opera en Aycha desde el ${F.date(run.go_live_at)}.`, 'ok')); return; }
    if (pend.length) b.appendChild(notice(`RN-ONB-05: no se sale a producción con pasos pendientes: ${pend.map(s => stepLabel(s.step_code)).join(', ')}.`, 'warn'));
    b.appendChild(card('Inicio de operación', form({ id: 'onb15g', submitLabel: 'Salir a producción', values: { date: G.TODAY }, fields: [{ key: 'date', label: 'Fecha de inicio de operación', type: 'date', required: true }],
      onSubmit: v => { try { goLive(run.id, v.date); toast('Alta completada: la empresa sale a producción', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })));
  });

  /* ---------- ONB-16 Registros y altas (consola) ---------- */
  function scrConsola(el) {
    const b = page(el, { code: 'ONB-16', title: 'Registros y altas (consola)', sub: 'Para Intelectalab: registros por estado, rubro y origen; altas en curso con su avance y días transcurridos.' });
    const sg = raw('signup_requests'); const rs = runs();
    const cnt = st => sg.filter(s => s.status === st).length;
    const live = rs.filter(r => r.status === 'IN_PROGRESS');
    const done = rs.filter(r => r.first_accepted_document_at);
    const med = (() => { const d = done.map(r => G.date.diff(r.first_accepted_document_at.slice(0, 10), r.started_at.slice(0, 10))).sort((a, c) => a - c); return d.length ? d[Math.floor((d.length - 1) / 2)] : null; })();
    b.appendChild(kpis([{ label: 'Pendientes de verificar', value: cnt('PENDING_VERIFICATION'), tone: 'warn' }, { label: 'Aprovisionados', value: cnt('PROVISIONED'), tone: 'ok' }, { label: 'Rechazados', value: cnt('REJECTED'), tone: cnt('REJECTED') ? 'bad' : '' }, { label: 'Vencidos', value: cnt('EXPIRED') }, { label: 'Altas en curso', value: live.length }, { label: 'Tiempo de alta (mediana)', value: med != null ? F.days(med) : '—', sub: 'KPI-OPS-09 en OPS' }]));
    b.appendChild(h('div', { class: 'grid c2' },
      card('Registros por rubro', G.ui.chart.hbar({ items: Object.entries(U.groupBy(sg, 'industry')).map(([k, v]) => ({ label: indName(k), value: v.length })).sort((a, c) => c.value - a.value) })),
      card('Registros por origen', G.ui.chart.hbar({ items: Object.entries(U.groupBy(sg, s => (s.utm || {}).source || 'directo')).map(([k, v]) => ({ label: (ORIGINS.find(o => o[0] === k) || [k, k])[1], value: v.length })).sort((a, c) => c.value - a.value) }))));
    b.appendChild(card('Altas', table({ id: 'onb16r', search: true, filters: [{ key: 'status', label: 'Estado', options: [['IN_PROGRESS', 'En proceso'], ['COMPLETED', 'Completada'], ['ABANDONED', 'Abandonada']] }],
      columns: [{ key: 'tenant', label: 'Empresa', value: r => tenantName(r.tenant) }, { key: 'industry', label: 'Rubro', value: r => indName(r.industry) }, { key: 'plan_code', label: 'Plan', value: r => planName(r.plan_code) }, { key: 'pct', label: 'Avance', value: r => progressOf(r).pct, render: r => { const p = progressOf(r); return h('div', { style: 'min-width:110px' }, progress(p.pct, p.pct >= 100 ? 'ok' : ''), h('span', { class: 'small' }, `${F.pct(p.pct, 0)} · ${p.done}/${p.req}`)); } }, { key: 'days', label: 'Días', align: 'r', value: r => G.date.diff((r.completed_at || G.TODAY).slice(0, 10), r.started_at.slice(0, 10)) }, { key: 'pending', label: 'Pendientes', sort: false, render: r => stepsOf(r).filter(s => s.status === 'PENDING').map(s => stepLabel(s.step_code)).slice(0, 3).join(', ') || '—' }, { key: 'status', label: 'Estado', render: r => status(r.status) }],
      rows: rs, onRow: r => { S.run = r.id; G.go('ONB-02', { run: r.id }); },
      actions: r => r.status === 'IN_PROGRESS' ? [btn('Recordar pasos', () => { within(r.tenant, () => G.notify({ role: 'ADMIN_SISTEMA', title: 'Tienes pasos pendientes en tu alta', body: stepsOf(r).filter(s => s.status === 'PENDING').map(s => stepLabel(s.step_code)).join(', '), tone: 'info', module: 'ONB' })); toast('Recordatorio enviado al administrador de ' + tenantName(r.tenant), 'ok'); }, { sm: true })] : [] }), { flush: true }));
    b.appendChild(card('Registros', table({ id: 'onb16s', filters: [{ key: 'status', label: 'Estado', options: ['PENDING_VERIFICATION', 'VERIFIED', 'PROVISIONED', 'REJECTED', 'EXPIRED'].map(s => [s, G.ui.statusLabel(s)]) }, { key: 'industry', label: 'Rubro', options: INDUSTRIES }, { key: 'src', label: 'Origen', options: ORIGINS, value: s => (s.utm || {}).source }],
      columns: [{ key: 'created_at', label: 'Fecha', render: s => F.datetime(s.created_at) }, { key: 'ruc', label: 'RUC', mono: true }, { key: 'legal_name', label: 'Razón social' }, { key: 'industry', label: 'Rubro', value: s => indName(s.industry) }, { key: 'plan_id', label: 'Plan', value: s => planName(s.plan_id) }, { key: 'src', label: 'Origen', value: s => (ORIGINS.find(o => o[0] === (s.utm || {}).source) || ['', '—'])[1] }, { key: 'status', label: 'Estado', render: s => status(s.status) }, { key: 'reject_reason', label: 'Motivo' }],
      rows: sg.slice().sort(U.by('created_at', -1)), onRow: s => signupDrawer(s) }), { flush: true }));
  }

  /* ---------- registro del módulo ---------- */
  G.register({ code: 'ONB', name: 'Alta de empresas', phase: 4, group: 'Producto SaaS', screens: [
    { code: 'ONB-01', name: 'Registro', render: scrRegistro },
    { code: 'ONB-02', name: 'Lista de pasos', render: scrPasos },
    { code: 'ONB-03', name: 'Empresa', render: scrEmpresa },
    { code: 'ONB-04', name: 'Marcas', render: scrMarcas },
    { code: 'ONB-05', name: 'Locales y almacenes', render: scrLocales },
    { code: 'ONB-06', name: 'Series y comprobante electrónico', render: scrSeries },
    { code: 'ONB-07', name: 'Medios de pago y cajas', render: scrPagos },
    { code: 'ONB-08', name: 'Números de WhatsApp', render: scrWhatsapp },
    { code: 'ONB-09', name: 'Zonas de reparto', render: scrZonas },
    { code: 'ONB-10', name: 'Plantilla por rubro', render: scrPlantilla },
    { code: 'ONB-11', name: 'Importar: subir y mapear', render: scrImportar },
    { code: 'ONB-12', name: 'Importar: validación', render: scrValidacion },
    { code: 'ONB-13', name: 'Importar: ejecución', render: scrEjecucion },
    { code: 'ONB-14', name: 'Usuarios e invitaciones', render: scrUsuarios },
    { code: 'ONB-15', name: 'Salida a producción', render: scrSalida },
    { code: 'ONB-16', name: 'Registros y altas (consola)', render: scrConsola },
  ] });

  G.searchProviders.push(q => { const s = String(q).toLowerCase(); return raw('signup_requests').filter(x => x.ruc.includes(s) || String(x.legal_name || '').toLowerCase().includes(s)).slice(0, 5).map(x => ({ label: `${x.legal_name} · ${x.ruc}`, sub: 'Registro ONB · ' + G.ui.statusLabel(x.status), go: () => { G.go('ONB-16'); signupDrawer(x); } })); });
  G.alertProviders.push(() => {
    const q = G.db.where('data_imports', i => i.import_type === 'STOCK' && i.status === 'COMPLETED' && (i.opening_lots || []).some(id => (G.db.get('lots', id) || {}).qc_status === 'QUARANTINE'));
    return q.length ? [{ module: 'ONB', title: 'Stock inicial en cuarentena', detail: `${q.length} importación(es) esperan la liberación de Calidad (RN-ONB-14).`, tone: 'warn', go: () => G.go('ONB-13', { run: q[0].run_id, imp: q[0].id }) }] : [];
  });

  /* ---------- API para otros módulos y pruebas ---------- */
  G.onb = { sha256, csvParse, csvJoin, download, sunatLookup, createSignup, verifySignup, provision, completeStep, skipStep, setRequired, progressOf, stepsOf, missingPre, saveCompany, addBrand, addEstablishment, addWarehouse, proposeSeries, setLastNumber, testEinvoice, savePayments, connectWhatsapp, addZone, inviteUser, acceptInvite, issueFirstDocument, goLive, applyTemplate, createImport, validateImport, runImport, revertImport, cancelImport, releaseOpeningStock, errorFile, templateCsv, sampleCsv, within, runGet, PLANS, TPL, IMP, STEPS };

  /* =====================================================================
     Pruebas de aceptación (CA-ONB-01..08)
     ===================================================================== */
  const T = (name, fn) => G.tests.push({ module: 'ONB', name, fn });
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (!String(e.message).startsWith(code)) throw new Error(`Se esperaba ${code} y salió: ${e.message}`); return e; } throw new Error(`Se esperaba el rechazo ${code}`); };
  /** empresa de prueba lista para importar: registro → alta → empresa, marca, 2 locales, 2 almacenes, plantilla */
  function fixture(rucBase, o = {}) {
    const s = createSignup({ ruc: U.rucCheck(rucBase), contact_name: 'Prueba ONB', contact_email: `prueba${rucBase.slice(-4)}@correo.pe`, contact_phone: '987654321', industry: 'DISTRIBUIDORA_CARNES', plan: o.plan || 'CRECIMIENTO', source: 'directo' });
    const run = verifySignup(s.id, s._token);
    if (o.bare) return run;
    saveCompany(run.id, { trade_name: 'Prueba', fiscal_address: 'Av. Prueba 123, Lima' });
    addBrand(run.id, { code: 'DG', name: 'Don Guando' });
    const e1 = addEstablishment(run.id, { code: 'L1', name: 'Local 1', sunat_code: '0000' });
    const e2 = addEstablishment(run.id, { code: 'L2', name: 'Local 2', sunat_code: '0001' });
    addWarehouse(run.id, { establishment_id: e1.id, code: 'ALM-1', name: 'Almacén 1', wh_type: 'COLD_ROOM', min_temp_c: 0, max_temp_c: 4 });
    addWarehouse(run.id, { establishment_id: e2.id, code: 'ALM-2', name: 'Almacén 2', wh_type: 'COLD_ROOM', min_temp_c: 0, max_temp_c: 4 });
    if (o.template !== false) applyTemplate(run.id, 'DISTRIBUIDORA_CARNES', 'br-DG~' + run.tenant);
    return runGet(run.id);
  }
  T('CA-ONB-01: registro con RUC válido → tenant TRIAL 14 días, empresa SUNAT, administrador con 2FA y pasos; RUC errado RN-ONB-01; segundo registro RN-ONB-02', async () => {
    const ruc = U.rucCheck('2061555508');
    const bad = ruc.slice(0, 10) + ((Number(ruc[10]) + 1) % 10);
    expectFail(() => createSignup({ ruc: bad, contact_name: 'X', contact_email: 'x@x.pe' }), 'RN-ONB-01');
    const s = createSignup({ ruc, contact_name: 'Ana Prueba', contact_email: 'ana@frigosanmartin.pe', contact_phone: '987111222', industry: 'DISTRIBUIDORA_CARNES', plan: 'CRECIMIENTO' });
    if (s.status !== 'PENDING_VERIFICATION') throw new Error('El registro debe quedar pendiente de verificación');
    expectFail(() => createSignup({ ruc, contact_name: 'Otro', contact_email: 'otro@x.pe' }), 'RN-ONB-02');
    const run = verifySignup(s.id, s._token);
    const t = tenantRow(run.tenant); if (!t || t.status !== 'TRIAL') throw new Error('El tenant debe quedar en TRIAL');
    within(run.tenant, () => {
      const co = G.db.get('companies', run.company_id); if (co.legal_name !== 'FRIGORÍFICO SAN MARTÍN SAC') throw new Error('Razón social distinta de SUNAT: ' + co.legal_name);
      const sub = G.db.find('subscriptions', () => true); if (!sub || sub.status !== 'TRIAL' || G.date.diff(sub.trial_ends_at, sub.started_at.slice(0, 10)) !== 14) throw new Error('La prueba debe durar 14 días');
      const adm = G.db.find('users', u => u.role === 'ADMIN_SISTEMA'); if (!adm || !adm.twofa_required) throw new Error('El administrador debe exigir segundo factor');
    });
    if (stepsOf(run).length !== 16) throw new Error('La lista debe tener 16 pasos');
    const again = verifySignup(s.id, s._token); if (again.id !== run.id) throw new Error('El aprovisionamiento debe ser idempotente');
    expectFail(() => createSignup({ ruc: U.rucCheck('2048899105'), contact_name: 'W', contact_email: 'w@x.pe' }), 'RN-ONB-01');
  });
  T('CA-ONB-02: las 4 plantillas publicadas traen ≥2 categorías, ≥4 productos, ≥1 checklist y ≥3 metas; charcutería con recetas y avícola con despiece', async () => {
    const pub = raw('industry_templates').filter(t => t.status === 'PUBLISHED');
    if (pub.length !== 4) throw new Error('Debe haber 4 plantillas publicadas y hay ' + pub.length);
    for (const t of pub) { const it = tplItems(t); const c = ty => it.filter(i => i.item_type === ty).length; if (c('CATEGORY') < 2 || c('PRODUCT') < 4 || c('CHECKLIST') < 1 || c('KPI_TARGET') < 3) throw new Error(`${t.code} incompleta`); }
    if (!tplItems(tplRow('CHARCUTERIA')).some(i => i.item_type === 'RECIPE')) throw new Error('Charcutería sin recetas');
    if (!tplItems(tplRow('AVICOLA')).some(i => i.item_type === 'BREAKDOWN')) throw new Error('Avícola sin despiece');
  });
  T('CA-ONB-03: distribuidora a la marca Don Guando con DES apagado → 5 categorías, 6 productos, 3 cortes; despiece omitido; reaplicar RN-ONB-07', async () => {
    const run = fixture('2060900103', { template: false });
    within(run.tenant, () => { if (G.modOn('DES')) throw new Error('El plan Crecimiento no incluye DES'); });
    const app = applyTemplate(run.id, 'DISTRIBUIDORA_CARNES', 'br-DG~' + run.tenant);
    const c = (ty, res) => app.detail.filter(d => d.item_type === ty && d.result === res).length;
    if (c('CATEGORY', 'CREATED') !== 5 || c('PRODUCT', 'CREATED') !== 6 || c('CUT', 'CREATED') !== 3) throw new Error(`Creados: ${c('CATEGORY', 'CREATED')} categorías, ${c('PRODUCT', 'CREATED')} productos, ${c('CUT', 'CREATED')} cortes`);
    const br = app.detail.find(d => d.item_type === 'BREAKDOWN'); if (br.result !== 'SKIPPED' || !/DES/.test(br.reason)) throw new Error('El despiece debe omitirse informando DES');
    within(run.tenant, () => { if (G.db.all('product_variants').length !== 6) throw new Error('Deben existir 6 presentaciones'); });
    expectFail(() => applyTemplate(run.id, 'DISTRIBUIDORA_CARNES', 'br-DG~' + run.tenant), 'RN-ONB-07');
  });
  T('CA-ONB-04: 120 productos con 3 errores → sin aceptar el parcial se rechaza; aceptando se importan 117; Excel con 3 errores (2,5 %)', async () => {
    const run = fixture('2060900204');
    const imp = createImport(run.id, { type: 'PRODUCTS', content: sampleCsv(run.id, 'PRODUCTS', { n: 120, errors: 3, seed: 7 }), file_name: 'productos.csv', brand_id: 'br-DG~' + run.tenant });
    if (imp.total_rows !== 120 || imp.error_rows !== 3) throw new Error(`Filas ${imp.total_rows}, errores ${imp.error_rows}`);
    expectFail(() => runImport(imp.id), 'RN-ONB-08');
    const done = runImport(imp.id, { allowPartial: true });
    if (done.imported_rows !== 117) throw new Error('Importadas ' + done.imported_rows);
    const ef = csvParse(errorFile(imp.id)); if (ef.length !== 4 || !ef[0].includes('errores')) throw new Error('El Excel de errores debe tener cabecera y 3 filas');
    const k = within(run.tenant, () => G.kpi('KPI-ONB-03', { type: 'PRODUCTS' })); if (k.value !== 2.5) throw new Error('KPI-ONB-03 = ' + k.value);
    expectFail(() => createImport(run.id, { type: 'PRODUCTS', content: sampleCsv(run.id, 'PRODUCTS', { n: 120, errors: 3, seed: 7 }), brand_id: 'br-DG~' + run.tenant }), 'RN-ONB-09');
  });
  T('CA-ONB-05: 850 clientes con celulares de 9 dígitos → +51; 40 sin pin; 12 duplicados por celular como advertencia sin segundo cliente', async () => {
    const run = fixture('2060900305', { template: false });
    addZone(run.id, { code: 'SUR', name: 'Surco', establishment_id: within(run.tenant, () => G.db.all('establishments')[0].id), districts: 'Santiago de Surco, Miraflores', delivery_fee: 8 });
    const imp = createImport(run.id, { type: 'CUSTOMERS', content: sampleCsv(run.id, 'CUSTOMERS', { n: 850, noPin: 40, dups: 12, seed: 5 }), file_name: 'clientes.csv' });
    if (imp.error_rows !== 0) throw new Error('No debe haber errores: ' + imp.error_rows);
    const done = runImport(imp.id);
    const rows = rowsOf(done);
    const dups = rows.filter(r => r.status === 'SKIPPED' && (r.errors || []).some(e => /Duplicado por celular/.test(e.msg))).length;
    if (dups !== 12) throw new Error('Duplicados ' + dups);
    within(run.tenant, () => {
      const cs = G.db.where('customers', c => c.source_channel === 'IMPORT');
      if (cs.length !== 838) throw new Error('Clientes creados ' + cs.length);
      if (!cs.every(c => /^\+519\d{8}$/.test(c.phone))) throw new Error('Celulares sin +51');
      const noPin = G.db.where('customer_addresses', a => a.needs_pin && a.status === 'ACTIVE').length; if (noPin !== 40) throw new Error('Sin pin ' + noPin);
    });
  });
  T('CA-ONB-06: stock inicial al 31/10 en 2 almacenes con 230 lotes → 230 ajustes de apertura, lotes en cuarentena y valor Σ cantidad × costo', async () => {
    const run = fixture('2060900406');
    // precondición (RN-ONB-06): el catálogo llegó con la plantilla, así que «Importar productos» se omite antes del stock
    skipStep(run.id, 'IMPORT_PRODUCTS', 'Catálogo cargado con la plantilla de distribuidora');
    const csv = sampleCsv(run.id, 'STOCK', { lots: 230, warehouses: ['ALM-1', 'ALM-2'], cutover: '2026-10-31', seed: 9 });
    const imp = createImport(run.id, { type: 'STOCK', content: csv, file_name: 'stock-31-10.csv', warehouse_id: 'wh-ALM-1~' + run.tenant, cutover_date: '2026-10-31' });
    if (imp.error_rows) throw new Error('Errores ' + imp.error_rows);
    runImport(imp.id);
    const expected = R(U.sum(csvParse(csv).slice(1), r => num(r[4]) * num(r[6])));
    within(run.tenant, () => {
      const mv = G.db.where('stock_movements', m => m.source_type === 'ONB_OPENING' && m.source_id === imp.id && m.movement_type === 'ADJUSTMENT');
      if (mv.length !== 230) throw new Error('Movimientos ' + mv.length);
      if (new Set(mv.map(m => m.warehouse_id)).size !== 2) throw new Error('Deben ser 2 almacenes');
      const lots = impGet(imp.id).opening_lots.map(id => G.db.get('lots', id));
      if (lots.length !== 230 || !lots.every(l => l.qc_status === 'QUARANTINE')) throw new Error('Los 230 lotes deben quedar en cuarentena');
      const val = R(U.sum(mv, m => m.total_cost)); if (Math.abs(val - expected) > 0.01) throw new Error(`Valor ${val} ≠ ${expected}`);
    });
    const n = releaseOpeningStock(imp.id); if (n !== 230) throw new Error('Liberados ' + n);
    expectFail(() => createImport(run.id, { type: 'STOCK', content: csv + '\r\n', warehouse_id: 'wh-ALM-1~' + run.tenant, cutover_date: '2026-12-01' }), 'RN-ONB-15');
  });
  T('CA-ONB-07: lista de pasos: stock sin almacenes RN-ONB-06, sin salida con pendientes, avance 0 % → 50 % → 100 %', async () => {
    const run = fixture('2060900507', { bare: true });
    if (progressOf(run).pct !== 0) throw new Error('Debe empezar en 0 %');
    expectFail(() => completeStep(run.id, 'IMPORT_STOCK'), 'RN-ONB-06');
    saveCompany(run.id, { trade_name: 'Prueba', fiscal_address: 'Av. Prueba 1' });
    addBrand(run.id, { code: 'PR', name: 'Prueba' });
    const e = addEstablishment(run.id, { code: 'L1', name: 'Local', sunat_code: '0000' });
    const p = progressOf(run); if (p.pct !== 50 || p.done !== 3 || p.req !== 6) throw new Error(`Avance ${p.pct} (${p.done}/${p.req})`);
    expectFail(() => completeStep(run.id, 'GO_LIVE'), 'RN-ONB-05');
    proposeSeries(run.id); testEinvoice(run.id, { provider: 'FAKE', user: 'prueba', secret: 'secreto-123' });
    addWarehouse(run.id, { establishment_id: e.id, code: 'W1', name: 'Almacén', wh_type: 'MAIN' });
    for (const s of stepsOf(run)) if (s.status === 'PENDING' && !s.is_required) skipStep(run.id, s.step_code);
    expectFail(() => goLive(run.id), 'RN-ONB-05'); // falta el primer comprobante aceptado
    issueFirstDocument(run.id, { amount: 30 });
    goLive(run.id);
    const r2 = runGet(run.id); if (r2.status !== 'COMPLETED' || progressOf(r2).pct !== 100) throw new Error('El alta debe completarse al 100 %');
  });
  T('CA-ONB-08: último comprobante del sistema anterior B001-00004521 → el primero en Aycha sale B001-00004522', async () => {
    const run = fixture('2060900608', { template: false });
    proposeSeries(run.id, 'BRAND');
    setLastNumber(run.id, 'B001', 4521);
    testEinvoice(run.id, { provider: 'FAKE', user: 'prueba', secret: 'secreto-123' });
    const d = issueFirstDocument(run.id, { series: 'B001', amount: 50 });
    if (d.full_number !== 'B001-00004522') throw new Error('Salió ' + d.full_number);
    expectFail(() => setLastNumber(run.id, 'B001', 4000), 'RN-ONB-18');
    if (!runGet(run.id).first_accepted_document_at) throw new Error('Debe registrar el primer comprobante aceptado');
  });
})();
