/* =====================================================================
   CNT · Contabilidad (fase 2)
   Plan PCGE con amarre a clase 9 y 79, reglas de asiento por origen y
   subtipo, asientos automáticos (ventas, compras, NTI, gastos, cobros,
   pagos, planilla, consumos, producción, costo de ventas, ajustes de
   inventario), bandeja de la contadora, SIRE de compras y ventas, libros
   por régimen y PLE, conciliación bancaria, cierre mensual con bloqueo y
   estados financieros por marca, local y consolidados.
   Tablas propias: gl_accounts, journal_rules, journal_rule_lines,
   journal_entries, journal_lines, accountant_inbox_items, sire_proposals,
   sire_proposal_lines, sire_submissions, cnt_fiscal_years, ledger_exports,
   bank_statement_lines, bank_reconciliations, period_close_tasks,
   payroll_journal_imports, fs_templates, fs_template_lines.
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, toast, form, tabs, empty, progress } = G.ui;
  const U = G.util, F = G.fmt, D = G.db, R = (n, d = 2) => U.round(n, d);
  const MOD = 'CNT';
  const T = { acc: 'gl_accounts', rule: 'journal_rules', rl: 'journal_rule_lines', je: 'journal_entries', jl: 'journal_lines', inbox: 'accountant_inbox_items', sp: 'sire_proposals', spl: 'sire_proposal_lines', ss: 'sire_submissions', fy: 'cnt_fiscal_years', lx: 'ledger_exports', bsl: 'bank_statement_lines', brc: 'bank_reconciliations', task: 'period_close_tasks', pay: 'payroll_journal_imports', fst: 'fs_templates', fsl: 'fs_template_lines' };
  const CNT = G.cnt = {};

  /* ---------- etiquetas ---------- */
  const LBL = {
    DRAFT: ['Borrador', ''], PENDING_APPROVAL: ['Por aprobar', 'warn'], APPROVED: ['Aprobado', 'ok'], REVERSED: ['Reversado', 'bad'], VOIDED: ['Anulado', 'bad'], BLOCKED: ['Retenido en la bandeja', 'bad'],
    PENDING: ['Pendiente', 'warn'], CLASSIFIED: ['Clasificado', 'info'], RETURNED: ['Devuelto', 'bad'], ACTIVE: ['Vigente', 'ok'], INACTIVE: ['Inactiva', ''],
    MATCHED: ['Coincide', 'ok'], AMOUNT_DIFF: ['Diferencia de importe', 'warn'], MISSING_IN_SYSTEM: ['Falta en el sistema', 'bad'], MISSING_IN_PROPOSAL: ['Falta en la propuesta', 'warn'],
    IMPORTED: ['Importada', 'info'], WITH_DIFFS: ['Con diferencias', 'warn'], RECONCILED: ['Conciliada', 'ok'], SUBMITTED: ['Presentada', 'ok'], PREPARED: ['Preparado', 'info'], SENT: ['Enviado', 'info'], ACCEPTED: ['Aceptado', 'ok'], REJECTED: ['Rechazado', 'bad'],
    OPEN: ['Abierto', 'info'], CLOSED: ['Cerrado', ''], CLOSING: ['En cierre', 'warn'], DONE: ['Hecha', 'ok'], WAIVED: ['Dispensada', 'info'], UNMATCHED: ['Sin cruzar', 'warn'], POSTED: ['Con asiento', 'ok'],
    SIMPLIFIED: ['Libros simplificados', 'ok'], FULL: ['Contabilidad completa', 'warn'], RESOLVED: ['Resuelta', 'ok'],
  };
  const st = s => LBL[s] ? badge(LBL[s][0], LBL[s][1]) : G.ui.status(s);
  const REASONS = { NO_RULE: 'Sin regla de asiento', MISSING_ACCOUNT: 'Falta la cuenta', MISSING_COST_CENTER: 'Falta el centro de costo', MISSING_BRAND: 'Falta la marca', PO_MISMATCH: 'Observado en el cruce de tres vías', SIRE_DIFF: 'Observado por SIRE', NO_VALID_RECEIPT: 'Gasto sin comprobante válido' };
  const SOURCES = [['SALE', 'Venta'], ['PURCHASE', 'Compra'], ['NTI', 'NTI de la granja'], ['EXPENSE', 'Gasto'], ['COLLECTION', 'Cobro y tesorería'], ['PAYMENT', 'Pago'], ['PAYROLL', 'Planilla'], ['CONSUMPTION', 'Consumo de producción'], ['PRODUCTION', 'Producción'], ['COGS', 'Costo de ventas'], ['INV_ADJUSTMENT', 'Ajuste de inventario'], ['MANUAL', 'Manual'], ['OPENING', 'Apertura y migración']];
  const srcName = s => (SOURCES.find(x => x[0] === s) || [s, s])[1];
  const SUBTYPES = { SALE: [['INVOICE', 'Factura'], ['RECEIPT', 'Boleta'], ['CREDIT_NOTE', 'Nota de crédito'], ['DEBIT_NOTE', 'Nota de débito'], ['INTERNAL_NOTE', 'Nota interna']], PURCHASE: [['INVOICE', 'Factura'], ['RECEIPT', 'Boleta'], ['CREDIT_NOTE', 'Nota de crédito'], ['DEBIT_NOTE', 'Nota de débito'], ['FEE_RECEIPT', 'Recibo por honorarios'], ['OTHER', 'Comprobante del exterior']], COLLECTION: [['PAYMENT', 'Cobro'], ['TRANSFER', 'Traslado entre cajas y bancos'], ['FEE', 'Comisión de pasarela']], PAYMENT: [['SUPPLIER', 'Pago a proveedor'], ['EXPENSE', 'Pago de gasto']], INV_ADJUSTMENT: [['WASTE', 'Merma'], ['ADJUSTMENT_OUT', 'Faltante'], ['ADJUSTMENT_IN', 'Sobrante']] };
  const subName = (s, t) => t === '*' ? 'Todos' : ((SUBTYPES[s] || []).find(x => x[0] === t) || [t, t])[1];
  const AMOUNT_KEYS = [['BASE', 'Base imponible'], ['IGV', 'IGV'], ['TOTAL', 'Total'], ['COST', 'Costo'], ['FEE_IGV', 'IGV de la comisión'], ['DETAIL', 'Detalle por línea'], ['TOTAL_PAYABLE', 'Total por pagar (menos retención)'], ['WITHHOLDING', 'Retención de 4.ª categoría'], ['ESSALUD', 'EsSalud'], ['PENSION', 'ONP retenida'], ['CTS', 'Provisión CTS'], ['VAC', 'Provisión de vacaciones'], ['NET', 'Neto a pagar']];
  const ACC_FROM = [['FIXED', 'Cuenta fija'], ['DETAIL', 'Según la línea del documento'], ['CASH', 'Cuenta de caja o banco del documento'], ['CASH_TO', 'Caja o banco de destino'], ['PAYABLE', 'Cuenta por pagar del documento'], ['PARAM', 'Parámetro (enlace con la granja)']];
  const lbl = (arr, v) => (arr.find(x => x[0] === v) || [v, v])[1];
  const DEST_BY_AREA = { PRODUCTION: '921', QUALITY: '921', WAREHOUSE: '921', ADMIN: '941', FINANCE: '941', HR: '941', SALES: '951', MARKETING: '951', DELIVERY: '952' };

  /* ---------- ayudas ---------- */
  const day = s => String(s || '').slice(0, 10);
  const monthOf = s => G.date.month(day(s));
  const lastDay = p => G.date.add(G.date.addMonths(p, 1), -1);
  const pName = p => G.date.monthName(p);
  const userId = () => G.ctx.userId();
  const roleOf = u => { const x = u && D.get('users', u); return x ? x.role : G.ctx.role; };
  const canU = (perm, u) => G.can(perm, roleOf(u || userId()));
  const uName = u => u ? G.userName(u) : 'Sistema';
  const nowAt = o => (o && o.at) || G.date.now();
  const modOn = () => { if (!G._seeding) G.assertMod(MOD); };
  const roleUser = r => (D.find('users', u => u.role === r && u.status === 'ACTIVE') || {}).id;
  let ver = 0; const bump = () => { ver++; };
  const ins = (t, row, silent) => { const r = D.insert(t, row, { silent: silent !== false }); bump(); idxAdd(t, r); return r; };
  const upd = (t, id, patch, silent) => { const r = D.update(t, id, patch, { silent: silent !== false }); bump(); return r; };
  const tryDo = (fn, ok) => { try { const r = fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); G.refresh(); return r || true; } catch (e) { toast(e.message, 'bad'); if (!(e instanceof G.RuleError)) console.warn(e); return null; } };
  const sameUser = (a, b) => a && b && a === b;
  const COMPANY = () => D.get('companies', 'co-dg') || D.find('companies', () => true) || {};
  const ccRow = id => id ? D.get('cost_centers', id) : null;
  const ccBrand = id => (ccRow(id) || {}).brand_id || null;
  const fnv = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return ('00000000' + x.toString(16)).slice(-8); };
  const hash = s => fnv(s) + fnv('x' + s) + fnv(s + 'y') + fnv(s.length + s);

  /* ---------- índices en memoria (evitan O(n²) con ~10 000 líneas) ---------- */
  const cache = {};
  function idx(table, key, build) {
    const raw = D.raw(table); const c = cache[key];
    if (c && c.raw === raw && c.len === raw.length && c.ten === G.ctx.tenant) return c.val;
    const val = build(D.all(table)); cache[key] = { raw, len: raw.length, ten: G.ctx.tenant, val, table }; return val;
  }
  const ADDERS = {
    lbe: (m, r) => { if (!m.has(r.entry_id)) m.set(r.entry_id, []); m.get(r.entry_id).push(r); },
    ebs: (m, r) => { const k = r.source_kind + '|' + r.source_id; if (!m.has(k)) m.set(k, []); m.get(k).push(r); },
    acc: (m, r) => m.set(r.code, r),
  };
  function idxAdd(table, row) { for (const [k, c] of Object.entries(cache)) { if (c.table !== table) continue; const raw = D.raw(table); if (c.raw === raw && c.len === raw.length - 1 && ADDERS[k] && (!row.tenant || row.tenant === c.ten)) { ADDERS[k](c.val, row); c.len++; } } }
  const linesOf = id => idx(T.jl, 'lbe', rows => { const m = new Map(); rows.forEach(r => ADDERS.lbe(m, r)); return m; }).get(id) || [];
  const entriesOfSrc = (kind, id) => idx(T.je, 'ebs', rows => { const m = new Map(); rows.forEach(r => ADDERS.ebs(m, r)); return m; }).get(kind + '|' + id) || [];
  const acct = code => idx(T.acc, 'acc', rows => { const m = new Map(); rows.forEach(r => m.set(r.code, r)); return m; }).get(String(code || '')) || null;
  const accName = code => { const a = acct(code); return a ? a.name : '—'; };
  const accLbl = code => code ? `${code} · ${accName(code)}` : '—';
  const isLive = e => e.status !== 'VOIDED' && !e.reversed_by_id && !e.reversal_of;
  const dispStatus = e => e.reversed_by_id ? 'REVERSED' : (e.status === 'DRAFT' && e.blocked ? 'BLOCKED' : e.status);
  /** líneas aprobadas con su asiento (para mayor, balance y estados) */
  function approved() {
    const k = [D.raw(T.je).length, D.raw(T.jl).length, ver, G.ctx.tenant].join('|');
    if (cache._ap && cache._ap.k === k && cache._ap.raw === D.raw(T.jl)) return cache._ap.val;
    const es = new Map(D.where(T.je, e => e.status === 'APPROVED').map(e => [e.id, e]));
    const val = []; for (const l of D.all(T.jl)) { const e = es.get(l.entry_id); if (e) val.push({ l, e }); }
    cache._ap = { k, raw: D.raw(T.jl), val }; return val;
  }
  /** RN-CNT-14: número correlativo por empresa y período, sin saltos, al aprobar */
  function numMap() {
    const raw = D.raw(T.je); const c = cache._num;
    if (c && c.raw === raw && c.ten === G.ctx.tenant) return c.m;
    const m = new Map(); for (const e of D.all(T.je)) if (e.seq) m.set(e.period, Math.max(m.get(e.period) || 0, e.seq));
    cache._num = { raw, ten: G.ctx.tenant, m }; return m;
  }
  const nextSeq = p => { const m = numMap(); const n = (m.get(p) || 0) + 1; m.set(p, n); return n; };
  const fmtNum = (p, n) => `${p.slice(0, 7)}-${U.pad(n, 5)}`;

  /* ---------- plan de cuentas PCGE (demostración; la contadora lo ajusta) ---------- */
  const ACC = [
    ['10', 'Efectivo y equivalentes de efectivo'], ['101', 'Caja'], ['1011', 'Caja general (mostrador Local 1)', 'P'], ['1012', 'Caja chica', 'P'], ['1013', 'Efectivo en poder de repartidores', 'PT'],
    ['103', 'Efectivo en tránsito'], ['1031', 'Pasarela Mercado Pago por liquidar', 'P'], ['1032', 'Adquirente POS de tarjetas por liquidar', 'P'],
    ['104', 'Cuentas corrientes en instituciones financieras'], ['1041', 'Cuentas corrientes operativas'], ['104101', 'BCP cuenta corriente soles', 'P'], ['104102', 'Interbank cuenta corriente soles', 'P'], ['104103', 'Billeteras digitales (Yape y Plin)', 'P'],
    ['12', 'Cuentas por cobrar comerciales – terceros'], ['121', 'Facturas, boletas y otros comprobantes por cobrar'], ['1212', 'Emitidas en cartera', 'PT'],
    ['16', 'Cuentas por cobrar diversas – terceros'], ['169', 'Otras cuentas por cobrar diversas'], ['1699', 'Otras cuentas por cobrar diversas', 'PT'],
    ['20', 'Mercaderías'], ['201', 'Mercaderías manufacturadas'], ['2011', 'Mercaderías para reventa', 'P'],
    ['21', 'Productos terminados'], ['211', 'Productos manufacturados'], ['2111', 'Productos manufacturados (cárnicos, embutidos y caldos)', 'P'],
    ['23', 'Productos en proceso'], ['231', 'Productos en proceso de manufactura'], ['2311', 'Productos en proceso', 'P'],
    ['24', 'Materias primas'], ['241', 'Materias primas para productos manufacturados'], ['2411', 'Materias primas (canales y aves)', 'P'],
    ['25', 'Materiales auxiliares, suministros y repuestos'], ['252', 'Suministros'], ['2521', 'Insumos y suministros de producción', 'P'],
    ['26', 'Envases y embalajes'], ['261', 'Envases'], ['2611', 'Envases y embalajes', 'P'],
    ['33', 'Propiedades, planta y equipo'], ['333', 'Maquinarias y equipos de explotación'], ['3331', 'Cámaras, balanzas y empacadoras', 'P'], ['334', 'Unidades de transporte'], ['3341', 'Vehículos de reparto', 'P'],
    ['39', 'Depreciación y amortización acumuladas'], ['391', 'Depreciación acumulada'], ['3913', 'Depreciación acumulada de propiedades, planta y equipo', 'P'],
    ['40', 'Tributos, contraprestaciones y aportes por pagar'], ['401', 'Gobierno central'], ['4011', 'Impuesto general a las ventas'], ['40111', 'IGV – cuenta propia', 'P'], ['4017', 'Impuesto a la renta'], ['40171', 'Renta de tercera categoría', 'P'], ['40172', 'Renta de cuarta categoría (retenciones)', 'PT'],
    ['403', 'Instituciones públicas'], ['4031', 'EsSalud', 'P'], ['4032', 'ONP', 'P'],
    ['41', 'Remuneraciones y participaciones por pagar'], ['411', 'Remuneraciones por pagar'], ['4111', 'Sueldos y salarios por pagar', 'P'], ['4114', 'Vacaciones por pagar', 'P'], ['415', 'Beneficios sociales por pagar'], ['4151', 'Compensación por tiempo de servicios', 'P'],
    ['42', 'Cuentas por pagar comerciales – terceros'], ['421', 'Facturas, boletas y otros comprobantes por pagar'], ['4212', 'Emitidas', 'PT'], ['424', 'Honorarios por pagar'], ['4241', 'Honorarios por pagar', 'PT'],
    ['46', 'Cuentas por pagar diversas – terceros'], ['469', 'Otras cuentas por pagar diversas'], ['4691', 'Gastos por pagar sin proveedor identificado', 'P'], ['4699', 'Enlace interno con la unidad Granja (D-CNT-03)', 'P'],
    ['50', 'Capital'], ['501', 'Capital social'], ['5011', 'Acciones', 'P'],
    ['59', 'Resultados acumulados'], ['591', 'Utilidades no distribuidas'], ['5911', 'Utilidades acumuladas', 'P'],
    ['60', 'Compras'], ['601', 'Mercaderías'], ['6011', 'Mercaderías', 'P', '2011', '6111'], ['602', 'Materias primas'], ['6021', 'Materias primas', 'P', '2411', '6121'], ['603', 'Materiales auxiliares, suministros y repuestos'], ['6032', 'Suministros', 'P', '2521', '6132'], ['604', 'Envases y embalajes'], ['6041', 'Envases y embalajes', 'P', '2611', '6141'],
    ['61', 'Variación de existencias'], ['611', 'Mercaderías'], ['6111', 'Mercaderías', 'P'], ['612', 'Materias primas'], ['6121', 'Materias primas', 'P'], ['613', 'Materiales auxiliares y suministros'], ['6132', 'Suministros', 'P'], ['614', 'Envases y embalajes'], ['6141', 'Envases y embalajes', 'P'],
    ['62', 'Gastos de personal y directores'], ['621', 'Remuneraciones'], ['6211', 'Sueldos y salarios', 'PCB', 'CC', '791'], ['6215', 'Vacaciones', 'PCB', 'CC', '791'], ['627', 'Seguridad, previsión social y otras contribuciones'], ['6271', 'Régimen de prestaciones de salud (EsSalud)', 'PCB', 'CC', '791'], ['629', 'Beneficios sociales de los trabajadores'], ['6291', 'Compensación por tiempo de servicio', 'PCB', 'CC', '791'],
    ['63', 'Gastos de servicios prestados por terceros'], ['631', 'Transporte, correos y gastos de viaje'], ['6311', 'Transporte de carga, reparto y fletes', 'PCB', 'CC', '791'], ['632', 'Asesoría y consultoría'], ['6321', 'Honorarios de terceros', 'PCB', 'CC', '791'], ['634', 'Mantenimiento y reparaciones'], ['6343', 'Mantenimiento de equipos y vehículos', 'PCB', 'CC', '791'], ['635', 'Alquileres'], ['6352', 'Alquiler de locales', 'PCB', 'CC', '791'], ['6354', 'Alquiler de vehículos', 'PCB', 'CC', '791'], ['636', 'Servicios básicos'], ['6361', 'Energía eléctrica', 'PCB', 'CC', '791'], ['6363', 'Agua', 'PCB', 'CC', '791'], ['6364', 'Teléfono e internet', 'PCB', 'CC', '791'], ['637', 'Publicidad, publicaciones y relaciones públicas'], ['6371', 'Publicidad y creadores de contenido', 'PCB', 'CC', '791'], ['639', 'Otros servicios prestados por terceros'], ['6391', 'Gastos bancarios y comisiones de pasarelas', 'PCB', 'CC', '791'], ['6399', 'Otros servicios de terceros', 'PCB', 'CC', '791'],
    ['64', 'Gastos por tributos'], ['641', 'Gobierno central'], ['6411', 'IGV no deducible', 'PCB', 'CC', '791'],
    ['65', 'Otros gastos de gestión'], ['651', 'Seguros'], ['6511', 'Seguros (SOAT y otros)', 'PCB', 'CC', '791'], ['656', 'Suministros'], ['6561', 'Combustibles y lubricantes', 'PCB', 'CC', '791'], ['6562', 'Útiles de oficina y limpieza', 'PCB', 'CC', '791'], ['659', 'Otros gastos de gestión'], ['6593', 'Mermas y desmedros de existencias', 'PCB', 'CC', '791'], ['6599', 'Otros gastos de gestión (no deducibles y multas)', 'PCB', 'CC', '791'],
    ['68', 'Valuación y deterioro de activos y provisiones'], ['681', 'Depreciación'], ['6814', 'Depreciación de propiedades, planta y equipo', 'PCB', 'CC', '791'],
    ['69', 'Costo de ventas'], ['692', 'Productos terminados', 'PB'],
    ['70', 'Ventas'], ['702', 'Productos terminados', 'PB'],
    ['75', 'Otros ingresos de gestión'], ['759', 'Otros ingresos de gestión'], ['7599', 'Otros ingresos (sobrantes de inventario)', 'PB'],
    ['79', 'Cargas imputables a cuentas de costos y gastos'], ['791', 'Cargas imputables a cuentas de costos y gastos', 'P'],
    ['92', 'Costo de producción'], ['921', 'Costo de producción (plantas)', 'PB'],
    ['94', 'Gastos de administración'], ['941', 'Gastos de administración', 'PB'],
    ['95', 'Gastos de ventas y distribución'], ['951', 'Gastos de ventas y marketing', 'PB'], ['952', 'Gastos de distribución (reparto)', 'PB'],
  ];
  const ACC_TYPES = [['ASSET', 'Activo'], ['LIABILITY', 'Pasivo'], ['EQUITY', 'Patrimonio'], ['EXPENSE', 'Gasto por naturaleza'], ['COST', 'Costo de ventas'], ['INCOME', 'Ingreso'], ['CONTROL', 'Cargas imputables (79)'], ['ANALYTIC', 'Analítica por función (9)']];
  function accType(code) { const c = code[0], c2 = code.slice(0, 2); if ('123'.includes(c)) return 'ASSET'; if (c === '4') return 'LIABILITY'; if (c === '5') return 'EQUITY'; if (c2 === '69') return 'COST'; if (c === '6') return 'EXPENSE'; if (c2 === '79') return 'CONTROL'; if (c === '7') return 'INCOME'; return 'ANALYTIC'; }
  function accNature(code) { const c = code[0], c2 = code.slice(0, 2); return (c2 === '39' || c2 === '61' || '457'.includes(c)) ? 'CREDIT' : 'DEBIT'; }
  const CASH_GL = { 'ca-CAJA-L1': '1011', 'ca-CCH-L1': '1012', 'ca-CCH-L2': '1012', 'ca-BCP-CTE': '104101', 'ca-IBK-CTE': '104102', 'ca-YAPE': '104103', 'ca-PLIN': '104103', 'ca-MP': '1031', 'ca-POS-VISA': '1032' };
  function cashGl(id) { if (!id) return null; const ca = D.get('cash_accounts', id) || {}; if (ca.gl_account_code) return ca.gl_account_code; if (CASH_GL[id]) return CASH_GL[id]; if (String(id).startsWith('ca-DRV-')) return '1013'; return { CASH_REGISTER: '1011', PETTY_CASH: '1012', DRIVER_CASH: '1013', BANK: '104101', WALLET: '104103', GATEWAY: '1031', CARD_ACQUIRER: '1032' }[ca.account_type] || null; }
  const glCash = code => Object.entries(CASH_GL).filter(([, g]) => g === code).map(([k]) => k);
  function invGl(vid) { const p = G.productOf(vid) || {}; if (p.product_type === 'PACKAGING') return '2611'; if (p.origin === 'RAW_MATERIAL') return '2411'; if (p.product_type === 'INPUT') return '2521'; if (p.origin === 'RESALE') return '2011'; return '2111'; }
  const PURCH_OF_INV = { '2011': '6011', '2111': '6011', '2411': '6021', '2521': '6032', '2611': '6041' };

  /* ---------- terceros ---------- */
  const custThird = id => { const c = D.get('customers', id); return c ? { type: 'CUSTOMER', id, doc: c.doc_number, name: c.trade_name || c.full_name } : null; };
  const supThird = id => { const s = D.get('suppliers', id); return s ? { type: 'SUPPLIER', id, doc: s.doc_number, name: s.trade_name || s.legal_name } : null; };
  function cashThird(caId) { if (!caId) return null; const ca = D.get('cash_accounts', caId) || {}; const u = D.get('users', ca.user_id || (String(caId).startsWith('ca-DRV-') ? 'us-' + String(caId).slice(7) : null)); return u ? { type: 'EMPLOYEE', id: u.employee_id || u.id, doc: (D.get('employees', u.employee_id) || {}).doc_number || null, name: u.name } : null; }

  /* ---------- reparto de gastos comunes por ventas de cada marca ---------- */
  function brandShares(period) {
    const k = 'shares|' + period + '|' + D.raw('sales_documents').length;
    if (cache[k]) return cache[k].val;
    const tot = {}; let all = 0;
    for (const d of D.all('sales_documents')) if (d.issue_date && monthOf(d.issue_date) === period && d.status !== 'VOIDED' && ['INVOICE', 'RECEIPT'].includes(d.doc_type)) { tot[d.brand_id] = (tot[d.brand_id] || 0) + d.subtotal; all += d.subtotal; }
    let val;
    if (all > 0) val = Object.entries(tot).filter(([b]) => b && b !== 'undefined').map(([b, v]) => [b, v / all]);
    else val = [['br-DG', 0.69], ['br-M2', 0.12], ['br-M3', 0.08], ['br-M4', 0.03], ['br-M5', 0.08]];
    val.sort((a, b) => b[1] - a[1]); cache[k] = { val }; return val;
  }
  /** reparte un importe por marca; el redondeo va a la marca con más ventas */
  function prorate(amount, period) { const sh = brandShares(period); let acc = 0; const out = sh.map(([b, p], i) => { const a = i === sh.length - 1 ? R(amount - acc) : R(amount * p); acc = R(acc + a); return { brand: b, amount: a }; }); return out.filter(x => Math.abs(x.amount) >= 0.005); }
  CNT.prorate = prorate; CNT.brandShares = brandShares;

  /* =====================================================================
     Hechos contables de cada documento de origen (lo que la regla usa)
     ===================================================================== */
  const isValidSale = d => d && d.status !== 'VOIDED' && !['REJECTED', 'VOIDED'].includes(d.sunat_status);
  const docLbl = d => `${G.docTypeName(d.doc_type)} ${d.series}-${d.number}`;
  /** costo de ventas diario por marca y local (inventario permanente, D-CNT-04) */
  function cogsGroups() {
    const raw = D.raw('sales_documents'); const c = cache._cogs;
    if (c && c.raw === raw && c.len === raw.length && c.ten === G.ctx.tenant) return c.m;
    const m = new Map();
    for (const d of D.all('sales_documents')) {
      if (!isValidSale(d) || !['INVOICE', 'RECEIPT'].includes(d.doc_type) || !d.issue_date || d.issue_date >= G.TODAY) continue;
      const k = `${d.issue_date}|${d.brand_id}|${d.establishment_id}`;
      let g = m.get(k); if (!g) { g = { n: 0, byAcc: {} }; m.set(k, g); }
      g.n++;
      const ls = (d.lines || []).filter(l => l.variant_id);
      let sum = 0;
      for (const l of ls) { const cst = Number(l.cost) || R((Number(l.qty) || 0) * (Number(l.unit_cost) || 0)); if (!cst) continue; const a = invGl(l.variant_id); g.byAcc[a] = (g.byAcc[a] || 0) + cst; sum += cst; }
      if (!sum && d.cost) g.byAcc['2111'] = (g.byAcc['2111'] || 0) + Number(d.cost);
    }
    cache._cogs = { raw, len: raw.length, ten: G.ctx.tenant, m }; return m;
  }
  const pdLines = id => D.where('purchase_document_lines', l => l.document_id === id);
  /** ajusta el redondeo de los detalles para que sumen exactamente el total */
  function fitDetails(det, total) { const s = R(U.sum(det, x => x.amount)); const diff = R(total - s); if (Math.abs(diff) >= 0.005 && det.length) { const big = det.slice().sort((a, b) => b.amount - a.amount)[0]; big.amount = R(big.amount + diff); } return det; }
  function fxRate(currency, date, given) { if (!currency || currency === 'PEN') return 1; if (Number(given) > 0) return Number(given); const rs = D.where('exchange_rates', x => x.currency === currency && x.date <= date).sort(U.by('date', -1)); if (!rs.length) G.fail('RN-CNT-19', `No hay tipo de cambio de ${currency} al ${F.date(date)} en MAE: cárgalo antes de asentar el documento.`); return Number(rs[0].sell); }

  const FACTS = {
    SALE(id) {
      const d = D.get('sales_documents', id); if (!d) return null;
      if (!isValidSale(d)) return { skip: 'Comprobante anulado o rechazado por la SUNAT', void: true, date: d.issue_date };
      return { source: 'SALE', subtype: d.doc_type, date: d.issue_date, label: docLbl(d), brand: d.brand_id, site: d.establishment_id, third: custThird(d.customer_id) || { type: 'CUSTOMER', id: d.customer_id, doc: d.customer_doc_number, name: d.customer_name }, amounts: { BASE: d.subtotal, IGV: d.igv, TOTAL: d.total }, go: () => G.screens['FAC-04'] && G.go('FAC-04', { id }) };
    },
    COGS(key) {
      const [date, brand, site] = key.split('|'); const g = cogsGroups().get(key); if (!g) return { skip: 'Sin ventas ese día', date };
      const det = Object.entries(g.byAcc).map(([account, amount]) => ({ account, amount: R(amount), brand, site, desc: `Salida de ${accName(account).toLowerCase()}` }));
      const tot = R(U.sum(det, x => x.amount)); if (!(tot > 0)) return { skip: 'Costo cero', date };
      return { source: 'COGS', subtype: '*', date, label: `Costo de ventas del ${F.date(date)} · ${G.brandName(brand)} · ${G.siteName(site)} (${g.n} comprobantes)`, brand, site, cc: null, amounts: { COST: tot }, details: det };
    },
    COLLECTION(id) {
      const p = D.get('payments', id); if (!p) return null;
      if (p.status !== 'CONFIRMED') return { skip: 'Cobro revertido', void: true, date: day(p.paid_at) };
      const gl = cashGl(p.cash_account_id); if (!gl) return { skip: 'Aplicación de saldo a favor o venta al crédito: sin movimiento de caja', date: day(p.paid_at) };
      return { source: 'COLLECTION', subtype: 'PAYMENT', date: day(p.paid_at), label: `Cobro ${p.number} · ${G.pmName(p.payment_method_id)}${p.reference ? ' · op. ' + p.reference : ''}`, brand: p.brand_id, site: p.establishment_id, cash_gl: gl, cash_third: cashThird(p.cash_account_id), third: custThird(p.customer_id), amounts: { TOTAL: p.amount }, ref: p.reference };
    },
    TRANSFER(id) {
      const t = D.get('cash_transfers', id); if (!t) return null;
      if (t.status && t.status !== 'CONFIRMED') return { skip: 'Traslado anulado', void: true, date: day(t.transferred_at) };
      const a = cashGl(t.from_account_id), b = cashGl(t.to_account_id);
      if (!a || !b || a === b) return { skip: 'Traslado dentro de la misma cuenta contable', date: day(t.transferred_at) };
      return { source: 'COLLECTION', subtype: 'TRANSFER', date: day(t.transferred_at), label: `${t.reason || 'Traslado'}${t.reference ? ' · ' + t.reference : ''}`, brand: null, site: (D.get('cash_accounts', t.to_account_id) || {}).establishment_id || null, cash_gl: a, cash_gl_to: b, cash_third: cashThird(t.from_account_id), cash_third_to: cashThird(t.to_account_id), amounts: { TOTAL: t.amount }, ref: t.reference };
    },
    FEE(id) {
      const b = D.get('settlement_batches', id); if (!b) return null;
      const fee = R(Number(b.fee_amount) || 0), igv = R(Number(b.fee_igv) || 0);
      if (b.kind !== 'SETTLEMENT' || fee + igv <= 0) return { skip: 'Sin comisión', date: b.deposit_date };
      const gl = cashGl(b.source_account_id); if (!gl) return { skip: 'Cuenta sin equivalente contable', date: b.deposit_date };
      const items = D.where('settlement_batch_items', x => x.batch_id === id); const byB = {};
      for (const it of items) { const p = D.get('payments', it.payment_id); const br = (p && p.brand_id) || 'br-DG'; byB[br] = (byB[br] || 0) + (Number(it.gross_amount) || 0); }
      const tot = U.sum(Object.values(byB)) || 1; const det = Object.keys(byB).length ? Object.entries(byB).map(([br, v]) => ({ account: '6391', amount: R(fee * v / tot), brand: br, cc: 'cc-FIN' })) : [{ account: '6391', amount: fee, brand: null, cc: 'cc-FIN' }];
      fitDetails(det, fee);
      return { source: 'COLLECTION', subtype: 'FEE', date: b.deposit_date, label: `Comisión ${(D.get('cash_accounts', b.source_account_id) || {}).name || b.source_account_id} · abono ${b.reference || ''}`, cash_gl: gl, amounts: { FEE_IGV: igv, TOTAL: R(fee + igv) }, details: det, ref: b.reference };
    },
    PURCHASE(id) {
      const d = D.get('purchase_documents', id); if (!d) return null;
      if (d.status === 'VOIDED') return { skip: 'Comprobante anulado', void: true, date: d.accounting_date };
      if (d.match_status === 'OBSERVED') return { skip: 'Observado en el cruce de tres vías (RN-COM-07): espera la aprobación en la bandeja', date: d.accounting_date, held: true };
      const fx = fxRate(d.currency, d.issue_date, d.exchange_rate);
      const nti = d.doc_type === 'INTERNAL_TRANSFER';
      const s = D.get('suppliers', d.supplier_id) || {};
      const base = R((Number(d.base_taxed) + Number(d.non_taxed || 0) + Number(d.other_charges || 0)) * fx);
      const igvRaw = R(Number(d.igv || 0) * fx); const credit = !!d.igv_is_credit && igvRaw > 0;
      const detBase = credit ? base : R(base + igvRaw);
      const ls = pdLines(id); const brand = d.brand_id || ccBrand(d.cost_center_id) || null;
      let det = ls.map(l => { const amt = R((Number(l.subtotal) || Number(l.non_taxed) || Number(l.qty) * Number(l.unit_price)) * fx); return { amount: amt, variant_id: l.variant_id || null, supplier_id: s.id, supplier_type: s.supplier_type, cc: l.cost_center_id || d.cost_center_id || null, brand: brand || ccBrand(l.cost_center_id), desc: l.description || G.variantName(l.variant_id) }; });
      if (!det.length) det = [{ amount: detBase, supplier_id: s.id, supplier_type: s.supplier_type, cc: d.cost_center_id || null, brand, desc: d.description || 'Servicio' }];
      const sumL = U.sum(det, x => x.amount) || 1; det.forEach(x => { x.amount = R(x.amount * detBase / sumL); }); fitDetails(det, detBase);
      return { source: nti ? 'NTI' : 'PURCHASE', subtype: nti ? '*' : d.doc_type, date: d.accounting_date || d.issue_date, label: `${nti ? 'NTI' : lbl(SUBTYPES.PURCHASE, d.doc_type)} ${d.series}-${d.number} · ${G.supName(d.supplier_id)}`, brand, site: d.establishment_id, cc: d.cost_center_id, third: supThird(d.supplier_id), payable_gl: nti ? null : d.doc_type === 'FEE_RECEIPT' ? '4241' : '4212', amounts: { BASE: base, IGV: credit ? igvRaw : 0, TOTAL: R(Number(d.total) * fx) }, details: det, currency: d.currency || 'PEN', fx, fx_total: d.total, go: () => G.com && G.com.openDoc && (G.go('COM-07'), G.com.openDoc(id)) };
    },
    SUPPLIER_PAYMENT(id) {
      const p = D.get('supplier_payments', id); if (!p) return null;
      if (p.status !== 'CONFIRMED') return { skip: 'Pago revertido', void: true, date: day(p.paid_at) };
      const gl = cashGl(p.cash_account_id); if (!gl) return { skip: 'Cuenta sin equivalente contable', date: day(p.paid_at) };
      const al = D.where('supplier_payment_allocations', a => a.payment_id === id);
      const det = (al.length ? al : [{ amount: p.amount }]).map(a => { const doc = a.document_id ? D.get('purchase_documents', a.document_id) : null; return { account: doc && doc.doc_type === 'FEE_RECEIPT' ? '4241' : '4212', amount: R(a.amount), desc: doc ? `${doc.series}-${doc.number}` : 'Pago a cuenta' }; });
      fitDetails(det, p.amount);
      return { source: 'PAYMENT', subtype: 'SUPPLIER', date: day(p.paid_at), label: `Pago ${p.number} · ${G.supName(p.supplier_id)}${p.is_detraction ? ' · detracción' : ''}`, cash_gl: gl, third: supThird(p.supplier_id), amounts: { TOTAL: p.amount }, details: det.map(x => Object.assign(x, { third: true })), ref: p.reference };
    },
    EXPENSE(id) {
      const e = D.get('expenses', id); if (!e) return null;
      if (['VOIDED', 'REJECTED'].includes(e.status)) return { skip: 'Gasto anulado o rechazado', void: true, date: e.issue_date };
      if (!['APPROVED', 'PAID'].includes(e.status)) return { skip: 'Gasto aún no aprobado (GAS)', date: e.issue_date, notYet: true };
      const fx = Number(e.exchange_rate) || 1;
      const igv = R(Number(e.igv || 0) * fx);
      const credit = e.doc_type === 'INVOICE' && e.accounting_flag === 'OK' && igv > 0;
      const gross = R(Number(e.amount_pen) || Number(e.total) * fx);
      const detBase = credit ? R(gross - igv) : gross;
      const wh = R(Number(e.withholding_amount) || 0);
      const allocs = D.where('expense_allocations', a => a.expense_id === id);
      let det = allocs.length ? allocs.map(a => ({ amount: R(detBase * (Number(a.pct) || 0) / 100), category_id: e.category_id, cc: a.cost_center_id || e.cost_center_id, brand: a.brand_id || e.brand_id || ccBrand(a.cost_center_id) })) : [{ amount: detBase, category_id: e.category_id, cc: e.cost_center_id, brand: e.brand_id || ccBrand(e.cost_center_id) }];
      det.forEach(x => { x.desc = `${e.number} · ${e.description || ''}`.slice(0, 90); if (e.accounting_flag === 'NO_VALID_RECEIPT') x.desc += ' · no deducible'; });
      fitDetails(det, detBase);
      const petty = e.pay_source === 'PETTY';
      const payable = petty ? cashGl(e.paid_from_account_id) || '1012' : e.doc_type === 'FEES_RECEIPT' ? '4241' : e.supplier_id ? '4212' : '4691';
      return { source: 'EXPENSE', subtype: '*', date: e.issue_date, label: `Gasto ${e.number} · ${e.description || ''}`.slice(0, 120), brand: e.brand_id, site: e.establishment_id, cc: e.cost_center_id, third: e.supplier_id ? supThird(e.supplier_id) : null, payable_gl: payable, amounts: { IGV: credit ? igv : 0, WITHHOLDING: wh, TOTAL_PAYABLE: R(gross - wh) }, details: det, flag: e.accounting_flag };
    },
    EXPENSE_PAYMENT(id) {
      const e = D.get('expenses', id); if (!e) return null;
      if (e.status !== 'PAID' || e.pay_source === 'PETTY' || !e.paid_from_account_id) return { skip: 'Sin pago desde caja o banco', date: day(e.paid_at || e.issue_date) };
      const gl = cashGl(e.paid_from_account_id); const amt = R(Number(e.paid_amount) || (Number(e.amount_pen) - Number(e.withholding_amount || 0)));
      const payable = e.doc_type === 'FEES_RECEIPT' ? '4241' : e.supplier_id ? '4212' : '4691';
      return { source: 'PAYMENT', subtype: 'EXPENSE', date: day(e.paid_at), label: `Pago del gasto ${e.number}${e.payment_reference ? ' · op. ' + e.payment_reference : ''}`, cash_gl: gl, third: e.supplier_id ? supThird(e.supplier_id) : null, amounts: { TOTAL: amt }, details: [{ account: payable, amount: amt, third: true, desc: e.description }], ref: e.payment_reference };
    },
    PAYROLL(id) {
      const p = D.get(T.pay, id); if (!p) return null;
      if (p.status === 'VOIDED') return { skip: 'Importación anulada', void: true, date: lastDay(p.period) };
      const det = [];
      for (const l of p.lines || []) for (const [acc, key] of [['6211', 'gross'], ['6215', 'vac'], ['6271', 'essalud'], ['6291', 'cts']]) if (l[key] > 0) det.push({ account: acc, amount: R(l[key]), cc: l.cost_center_id, brand: ccBrand(l.cost_center_id), desc: `${accName(acc)} · ${G.ccName(l.cost_center_id)}` });
      return { source: 'PAYROLL', subtype: '*', date: lastDay(p.period), label: `Planilla de ${pName(p.period)} · ${p.source === 'AYNI_HR' ? 'Ayni HR' : 'archivo ' + (p.file_name || '')}`, amounts: { ESSALUD: p.essalud_total, PENSION: p.pension_total, CTS: p.cts_total, VAC: p.vac_total, NET: p.net_total }, details: det };
    },
    CONSUMPTION(id) {
      const o = D.get('production_orders', id); if (!o) return null;
      if (o.status !== 'CLOSED') return { skip: 'Orden no cerrada', date: o.close_date || G.TODAY };
      const cs = D.where('production_order_consumptions', c => c.order_id === id && c.total_cost > 0);
      const det = cs.map(c => ({ account: invGl(c.variant_id), amount: R(c.total_cost), desc: G.variantName(c.variant_id) }));
      const tot = R(U.sum(det, x => x.amount)); if (!tot) return { skip: 'Sin consumos valorizados', date: o.close_date };
      return { source: 'CONSUMPTION', subtype: '*', date: o.close_date, label: `Consumos de la orden ${o.number}`, site: o.establishment_id, amounts: { COST: tot }, details: det };
    },
    PRODUCTION(id) {
      const o = D.get('production_orders', id); if (!o) return null;
      if (o.status !== 'CLOSED') return { skip: 'Orden no cerrada', date: o.close_date || G.TODAY };
      const tot = R(U.sum(D.where('production_order_consumptions', c => c.order_id === id), c => c.total_cost || 0)); if (!tot) return { skip: 'Sin costo de materiales', date: o.close_date };
      const outs = D.where('production_order_outputs', x => x.order_id === id && (x.allocated_cost || 0) > 0);
      const sum = U.sum(outs, x => x.allocated_cost) || 1;
      const det = outs.length ? outs.map(x => ({ account: invGl(x.variant_id), amount: R(tot * x.allocated_cost / sum), desc: G.variantName(x.variant_id) })) : [{ account: '2111', amount: tot, desc: o.number }];
      fitDetails(det, tot);
      return { source: 'PRODUCTION', subtype: '*', date: o.close_date, label: `Producción terminada de la orden ${o.number}`, site: o.establishment_id, amounts: { COST: tot }, details: det };
    },
    INV_ADJUSTMENT(id) {
      const m = D.get('stock_movements', id); if (!m) return null;
      const amt = R(Math.abs(Number(m.total_cost) || 0)); if (!amt || !['WASTE', 'ADJUSTMENT'].includes(m.movement_type)) return { skip: 'Sin valor', date: day(m.moved_at) };
      const site = (D.get('warehouses', m.warehouse_id) || {}).establishment_id; const p = G.productOf(m.variant_id) || {};
      const sub = m.movement_type === 'WASTE' ? 'WASTE' : (Number(m.qty) > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT');
      return { source: 'INV_ADJUSTMENT', subtype: sub, date: day(m.moved_at), label: `${lbl(SUBTYPES.INV_ADJUSTMENT, sub)} · ${G.variantName(m.variant_id)} · ${G.whName(m.warehouse_id)}`, site, brand: p.brand_id || 'br-DG', cc: site === 'es-L2' ? 'cc-PROD-L2' : 'cc-ALM-L1', amounts: { COST: amt }, details: [{ account: invGl(m.variant_id), amount: amt, brand: p.brand_id || 'br-DG' }] };
    },
  };
  const KIND_NAMES = { SALE: 'Comprobante de venta', COGS: 'Costo de ventas diario', COLLECTION: 'Cobro', TRANSFER: 'Traslado de tesorería', FEE: 'Comisión de pasarela', PURCHASE: 'Comprobante de compra', SUPPLIER_PAYMENT: 'Pago a proveedor', EXPENSE: 'Gasto', EXPENSE_PAYMENT: 'Pago de gasto', PAYROLL: 'Planilla', CONSUMPTION: 'Consumo de producción', PRODUCTION: 'Producción', INV_ADJUSTMENT: 'Ajuste de inventario', MANUAL: 'Asiento manual', OPENING: 'Apertura' };
  const kindAlias = k => k === 'PURCHASE_DOCUMENT' ? 'PURCHASE' : k;
  /** documentos candidatos por tipo en un rango de fechas: [{id, date}] */
  const inR = (s, from, to) => { const x = day(s); return x >= from && x <= to; };
  const ENUM = {
    SALE: (f, t) => D.where('sales_documents', d => inR(d.issue_date, f, t)).map(d => ({ id: d.id, date: d.issue_date, t: d.issued_at || d.issue_date })),
    COLLECTION: (f, t) => D.where('payments', p => inR(p.paid_at, f, t)).map(p => ({ id: p.id, date: day(p.paid_at), t: p.paid_at })),
    TRANSFER: (f, t) => D.where('cash_transfers', x => inR(x.transferred_at, f, t)).map(x => ({ id: x.id, date: day(x.transferred_at), t: x.transferred_at })),
    FEE: (f, t) => D.where('settlement_batches', b => b.kind === 'SETTLEMENT' && inR(b.deposit_date, f, t)).map(b => ({ id: b.id, date: b.deposit_date, t: b.deposit_date + 'T12:00' })),
    PURCHASE: (f, t) => D.where('purchase_documents', d => inR(d.accounting_date || d.issue_date, f, t)).map(d => ({ id: d.id, date: d.accounting_date || d.issue_date, t: d.registered_at || d.accounting_date })),
    SUPPLIER_PAYMENT: (f, t) => D.where('supplier_payments', p => inR(p.paid_at, f, t)).map(p => ({ id: p.id, date: day(p.paid_at), t: p.paid_at })),
    EXPENSE: (f, t) => D.where('expenses', e => inR(e.issue_date, f, t)).map(e => ({ id: e.id, date: e.issue_date, t: e.approved_at || e.issue_date })),
    EXPENSE_PAYMENT: (f, t) => D.where('expenses', e => e.status === 'PAID' && e.paid_at && inR(e.paid_at, f, t)).map(e => ({ id: e.id, date: day(e.paid_at), t: e.paid_at })),
    PAYROLL: (f, t) => D.where(T.pay, p => inR(lastDay(p.period), f, t)).map(p => ({ id: p.id, date: lastDay(p.period), t: lastDay(p.period) + 'T23:00' })),
    CONSUMPTION: (f, t) => D.where('production_orders', o => o.status === 'CLOSED' && o.close_date && inR(o.close_date, f, t)).map(o => ({ id: o.id, date: o.close_date, t: o.closed_at || o.close_date })),
    PRODUCTION: (f, t) => D.where('production_orders', o => o.status === 'CLOSED' && o.close_date && inR(o.close_date, f, t)).map(o => ({ id: o.id, date: o.close_date, t: (o.closed_at || o.close_date) + 'z' })),
    INV_ADJUSTMENT: (f, t) => D.where('stock_movements', m => ['WASTE', 'ADJUSTMENT'].includes(m.movement_type) && inR(m.moved_at, f, t)).map(m => ({ id: m.id, date: day(m.moved_at), t: m.moved_at })),
    COGS: (f, t) => [...cogsGroups().keys()].filter(k => k.slice(0, 10) >= f && k.slice(0, 10) <= t).map(k => ({ id: k, date: k.slice(0, 10), t: k.slice(0, 10) + 'T23:59' })),
  };

  /* =====================================================================
     Motor de asientos: reglas → líneas → amarre → validación
     ===================================================================== */
  const ruleLines = id => D.where(T.rl, l => l.rule_id === id).sort(U.by('seq'));
  /** regla vigente del origen y subtipo a la fecha (la exacta gana a «*») */
  function ruleFor(source, subtype, date) {
    const rs = D.where(T.rule, r => r.status === 'ACTIVE' && r.source === source && (r.subtype === subtype || r.subtype === '*') && (!r.valid_from || r.valid_from <= date) && (!r.valid_to || r.valid_to >= date));
    rs.sort((a, b) => (b.subtype === subtype) - (a.subtype === subtype) || String(b.valid_from || '').localeCompare(String(a.valid_from || '')));
    return rs[0] || null;
  }
  /** cuenta de una línea de detalle según el mapa de la regla (proveedor, tipo de proveedor, categoría de gasto o producto) */
  function mapAccount(rule, it) {
    const m = (rule && rule.account_map) || {};
    if (it.supplier_id && m.suppliers && m.suppliers[it.supplier_id]) return m.suppliers[it.supplier_id];
    if (it.variant_id) return PURCH_OF_INV[invGl(it.variant_id)] || null;
    if (it.category_id) { const cat = D.get('expense_categories', it.category_id) || {}; return (m.categories || {})[cat.code] || null; }
    if (it.supplier_type) return (m.supplier_types || {})[it.supplier_type] || null;
    return null;
  }
  /** regla de respaldo cuando la contadora clasifica un documento sin regla (NO_RULE) */
  function fallbackLines(f) {
    if (f.source === 'SALE') return f.subtype === 'CREDIT_NOTE' ? [{ side: 'D', account_from: 'OVERRIDE', amount_key: 'BASE' }, { side: 'D', account_from: 'FIXED', account_code: '40111', amount_key: 'IGV' }, { side: 'C', account_from: 'FIXED', account_code: '1212', amount_key: 'TOTAL', third: 'DOC' }]
      : [{ side: 'D', account_from: 'FIXED', account_code: '1212', amount_key: 'TOTAL', third: 'DOC' }, { side: 'C', account_from: 'FIXED', account_code: '40111', amount_key: 'IGV' }, { side: 'C', account_from: 'OVERRIDE', amount_key: 'BASE' }];
    return [{ side: 'D', account_from: 'OVERRIDE', amount_key: 'DETAIL' }, { side: 'D', account_from: 'FIXED', account_code: '40111', amount_key: 'IGV' }, { side: 'C', account_from: 'PAYABLE', amount_key: 'TOTAL', third: 'DOC' }];
  }
  /** expande la regla sobre los hechos: devuelve líneas y problemas (RN-CNT-05, RN-CNT-16) */
  function expand(rule, f, ov = {}) {
    const raw = [];
    const rls = rule ? ruleLines(rule.id) : fallbackLines(f);
    for (const rl of rls) {
      const items = rl.amount_key === 'DETAIL' ? (f.details || []) : [{ amount: (f.amounts || {})[rl.amount_key] }];
      for (const it of items) {
        let amt = R(Number(it.amount) || 0); if (Math.abs(amt) < 0.005) continue;
        let side = rl.side; if (amt < 0) { amt = -amt; side = side === 'D' ? 'C' : 'D'; }
        let code = rl.account_from === 'FIXED' ? rl.account_code : rl.account_from === 'CASH' ? f.cash_gl : rl.account_from === 'CASH_TO' ? f.cash_gl_to : rl.account_from === 'PAYABLE' ? f.payable_gl : rl.account_from === 'PARAM' ? String(G.param(rl.param_key) || '') : rl.account_from === 'OVERRIDE' ? ov.account : (it.account || mapAccount(rule, it));
        if (!code && ov.account) code = ov.account;
        const third = rl.third === 'DOC' || it.third ? f.third : rl.third === 'CASH' ? f.cash_third : rl.third === 'CASH_TO' ? f.cash_third_to : null;
        const isDet = rl.amount_key === 'DETAIL';
        raw.push({ account_code: code || null, side, amount: amt, description: it.desc || rl.description || f.label, cost_center_id: it.cc || (isDet ? f.cc : f.cc) || null, brand_id: it.brand || f.brand || null, establishment_id: it.site || f.site || null, third });
      }
    }
    const lines = [], problems = new Set(), period = monthOf(f.date);
    for (const l of raw) {
      const a = acct(l.account_code);
      if (!a) { if (ov.account) l.account_code = ov.account; else { problems.add('MISSING_ACCOUNT'); lines.push(l); continue; } }
      const ac = acct(l.account_code);
      if (ac && ac.requires_third_party && !l.third) l.third = f.third || f.cash_third || null;
      if (ac && !ac.requires_third_party && l.third && !['SUPPLIER', 'CUSTOMER', 'EMPLOYEE'].includes(l.third.type)) l.third = null;
      if (ac && ac.requires_cost_center && !l.cost_center_id) { if (ov.cc) l.cost_center_id = ov.cc; else problems.add('MISSING_COST_CENTER'); }
      if (ac && ac.requires_brand && !l.brand_id) {
        l.brand_id = ccBrand(l.cost_center_id) || ov.brand || null;
        if (!l.brand_id && rule && rule.allocate_common) { for (const p of prorate(l.amount, period)) lines.push(Object.assign({}, l, { amount: p.amount, brand_id: p.brand, description: l.description + ' (reparto por ventas)' })); continue; }
        if (!l.brand_id) problems.add('MISSING_BRAND');
      }
      lines.push(l);
    }
    return { lines: withDestination(lines), problems: [...problems] };
  }
  /** amarre: clase 6 con destino → 9 por función (según el área del centro de costo) y 79; compras 60 → existencias y 61 */
  function withDestination(lines) {
    const out = lines.slice(); const agg = new Map();
    const add = (code, side, l) => { const k = [code, side, l.brand_id, l.cost_center_id, l.establishment_id].join('|'); const x = agg.get(k); if (x) x.amount = R(x.amount + l.amount); else agg.set(k, { account_code: code, side, amount: l.amount, description: 'Amarre (destino)', cost_center_id: l.cost_center_id, brand_id: l.brand_id, establishment_id: l.establishment_id, third: null, is_destination: true }); };
    for (const l of lines) {
      const a = acct(l.account_code); if (!a || !a.dest_debit_code || !a.dest_credit_code) continue;
      const dd = a.dest_debit_code === 'CC' ? DEST_BY_AREA[(ccRow(l.cost_center_id) || {}).area] || '941' : a.dest_debit_code;
      add(dd, l.side, l); add(a.dest_credit_code, l.side === 'D' ? 'C' : 'D', l);
    }
    return out.concat([...agg.values()]);
  }
  /** RN-CNT-04 y RN-CNT-05 y RN-CNT-16 sobre líneas guardadas o por guardar */
  function lineProblems(ls) {
    const out = [];
    ls.forEach((l, i) => {
      const n = `Línea ${i + 1}`; const d = Number(l.debit) || 0, c = Number(l.credit) || 0;
      if (d < 0 || c < 0) out.push(['RN-CNT-04', `${n}: el importe no puede ser negativo.`]);
      if ((d > 0) === (c > 0)) out.push(['RN-CNT-04', `${n}: lleva importe al debe o al haber, no ambos ni ninguno.`]);
      const a = acct(l.account_code);
      if (!a) { out.push(['RN-CNT-05', `${n}: la cuenta ${l.account_code || '(vacía)'} no existe en el plan.`]); return; }
      if (!a.postable || a.status === 'INACTIVE') out.push(['RN-CNT-05', `${n}: la cuenta ${a.code} ${a.name} no recibe movimientos (es de título o está inactiva).`]);
      if (a.requires_cost_center && !l.cost_center_id) out.push(['RN-CNT-05', `${n}: la cuenta ${a.code} exige centro de costo.`]);
      if (a.requires_third_party && !l.third_party_id && !l.third_party_doc) out.push(['RN-CNT-05', `${n}: la cuenta ${a.code} exige tercero (cliente, proveedor o trabajador).`]);
      if (a.requires_brand && !l.brand_id) out.push(['RN-CNT-16', `${n}: la cuenta ${a.code} es de ingresos, costos o gastos y lleva marca.`]);
    });
    return out;
  }
  const toRow = l => ({ account_code: l.account_code, description: l.description, debit: l.side === 'D' ? R(l.amount) : 0, credit: l.side === 'C' ? R(l.amount) : 0, cost_center_id: l.cost_center_id || null, brand_id: l.brand_id || null, establishment_id: l.establishment_id || null, third_party_type: l.third ? l.third.type : null, third_party_id: l.third ? l.third.id : null, third_party_doc: l.third ? l.third.doc : null, third_party_name: l.third ? l.third.name : null, is_destination: !!l.is_destination });
  function insertEntry(hdr, rows, opts = {}) {
    const td = R(U.sum(rows, l => l.debit)), tc = R(U.sum(rows, l => l.credit));
    const e = ins(T.je, Object.assign({ company_id: 'co-dg', number: null, seq: null, period: monthOf(hdr.entry_date), currency: 'PEN', total_debit: td, total_credit: tc, prepared_at: nowAt(opts), approved_by: null, approved_at: null, auto_approved: false, reversal_of: null, reversed_by_id: null, blocked: false, history: [{ at: nowAt(opts), user: uName(hdr.prepared_by), action: hdr.prepared_by ? 'Registrado' : 'Generado por la regla' }] }, hdr), opts.silent !== false && G._seeding ? true : !!opts.silentHeader);
    rows.forEach((l, i) => ins(T.jl, Object.assign({ entry_id: e.id, seq: i + 1 }, l)));
    return e;
  }
  const addHist = (e, action, user, at) => { e.history = (e.history || []).concat([{ at: at || G.date.now(), user: uName(user), action }]); };
  const openInbox = (kind, id) => D.find(T.inbox, x => kindAlias(x.source_type) === kind && x.source_id === id && ['PENDING', 'CLASSIFIED', 'RETURNED'].includes(x.status));
  const liveEntries = (kind, id) => entriesOfSrc(kind, id).filter(isLive);

  /**
   * cnt_build_entry(kind, id) · RN-CNT-09, RN-CNT-20, RN-CNT-06
   * opts: {user, at, override:{account, cc, brand}, fallback, approveBy, seed, dry, replace}
   * devuelve {entry} | {inbox} | {skip} | {lines, problems} (dry)
   */
  function buildEntry(kind, id, opts = {}) {
    const fn = FACTS[kind]; if (!fn) throw new Error('Origen desconocido: ' + kind);
    const f = fn(id); if (!f) throw new Error(`${KIND_NAMES[kind] || kind} no encontrado.`);
    if (f.skip) return { skip: f.skip };
    if (!G._seeding && G.period.isClosed(f.date)) G.fail('RN-CNT-06', `El período ${pName(f.date)} está cerrado: no se genera el asiento de ${f.label} (RN-PLT-05).`);
    const rule = opts.fallback ? null : (opts.rule || ruleFor(f.source, f.subtype, f.date));
    if (!rule && !opts.fallback) {
      if (opts.dry) return { lines: [], problems: ['NO_RULE'], facts: f };
      const it = toInbox({ source_type: kind, source_id: id, reason: 'NO_RULE', date: f.date, notes: `RN-CNT-09: no hay regla vigente para ${srcName(f.source)} · ${subName(f.source, f.subtype)}.`, ref_label: f.label, amount: (f.amounts || {}).TOTAL || (f.amounts || {}).COST || null, at: opts.at, subtype: f.subtype, origin: f.source });
      return { inbox: it };
    }
    const live = liveEntries(kind, id).filter(e => (e.rule_id || null) === (rule ? rule.id : null) && e.id !== opts.replace);
    if (live.length) { if (opts.regenerate) G.fail('RN-CNT-20', `${f.label} ya tiene el asiento vigente ${live[0].number || '(sin número)'} con la regla ${rule ? rule.code : 'de respaldo'}: revérsalo antes de generar otro.`); return { entry: live[0], existing: true }; }
    const x = expand(rule, f, opts.override || {});
    if (opts.dry) return Object.assign(x, { facts: f, rule });
    const rows = x.lines.map(toRow);
    const blocked = x.problems.length > 0;
    const auto = !blocked && rule && rule.auto_approve && !opts.approveBy;
    const e = insertEntry({ entry_date: f.date, source_kind: kind, source_type: f.source, source_subtype: f.subtype, source_id: id, source_label: f.label, rule_id: rule ? rule.id : null, rule_code: rule ? rule.code : 'Respaldo (bandeja)', description: f.label, status: blocked ? 'DRAFT' : (auto ? 'APPROVED' : 'PENDING_APPROVAL'), blocked, blocked_reasons: x.problems, prepared_by: opts.user || null, brand_id: f.brand || null, establishment_id: f.site || null, currency: f.currency || 'PEN', exchange_rate: f.fx || 1, fx_total: f.currency && f.currency !== 'PEN' ? f.fx_total : null }, rows, opts);
    if (auto) { const n = nextSeq(e.period); Object.assign(e, { seq: n, number: fmtNum(e.period, n), approved_at: e.prepared_at, auto_approved: true }); addHist(e, `Aprobado por la regla ${rule.code} (auto_approve, aprobada por la contadora · D-CNT-06) · número ${e.number}`, null, e.prepared_at); }
    if (blocked) toInbox({ source_type: kind, source_id: id, reason: x.problems[0], missing: x.problems, entry_id: e.id, date: f.date, notes: `${x.problems.map(p => REASONS[p]).join(' · ')} (${x.problems.includes('MISSING_BRAND') ? 'RN-CNT-16' : 'RN-CNT-05'}).`, ref_label: f.label, amount: e.total_debit, at: opts.at });
    if (opts.approveBy && !blocked) approveEntry(e.id, { user: opts.approveBy, at: opts.at });
    if (kind === 'EXPENSE' && f.flag === 'NO_VALID_RECEIPT' && !(D.get('expenses', id) || {}).accounting_reviewed_at) toInbox({ source_type: 'EXPENSE', source_id: id, reason: 'NO_VALID_RECEIPT', entry_id: e.id, date: f.date, notes: 'RN-GAS-06: sin comprobante válido; no da crédito fiscal ni es deducible salvo que la contadora lo valide.', ref_label: f.label, amount: (f.amounts || {}).TOTAL_PAYABLE, at: opts.at });
    if (opts.replace) { const old = D.get(T.je, opts.replace); if (old && old.status !== 'APPROVED') { upd(T.je, old.id, { status: 'VOIDED', void_reason: 'Reemplazado por el asiento clasificado en la bandeja' }); } }
    return { entry: D.get(T.je, e.id) };
  }
  CNT.buildEntry = buildEntry;

  /** RN-CNT-01, RN-CNT-02, RN-CNT-06, RN-CNT-14 */
  function approveEntry(id, opts = {}) {
    modOn();
    const e = D.get(T.je, id); if (!e) throw new Error('Asiento no encontrado.');
    const user = opts.user || userId();
    if (e.status === 'APPROVED') throw new Error(`El asiento ${e.number} ya está aprobado.`);
    if (e.status === 'VOIDED') throw new Error('El asiento está anulado.');
    if (!G._seeding && G.period.isClosed(e.entry_date)) G.fail('RN-CNT-06', `El período ${pName(e.entry_date)} está cerrado: no se aprueba un asiento con fecha ${F.date(e.entry_date)} (RN-PLT-05).`);
    if (!canU('cnt.entry.approve', user)) G.fail('RN-CNT-02', `Aprobar asientos exige cnt.entry.approve (CONTADORA); ${G.roleName(roleOf(user))} no aprueba (RN-CNT-21).`);
    if (sameUser(e.prepared_by, user)) G.fail('RN-CNT-02', `Quien prepara no aprueba: ${uName(e.prepared_by)} registró este asiento; debe aprobarlo otra persona con cnt.entry.approve.`);
    if (e.blocked) G.fail('RN-CNT-05', 'El asiento está retenido en la bandeja: clasifícalo allí primero.');
    const ls = linesOf(id); const pr = lineProblems(ls); if (pr.length) G.fail(pr[0][0], pr[0][1]);
    const td = R(U.sum(ls, l => l.debit)), tc = R(U.sum(ls, l => l.credit));
    if (!(td > 0) || Math.abs(td - tc) > 0.004) G.fail('RN-CNT-01', `El asiento no cuadra: debe ${F.money(td)} y haber ${F.money(tc)} (diferencia ${F.money(R(td - tc))}). Solo se aprueba si Σ debe = Σ haber y es mayor que 0.`);
    const n = nextSeq(e.period); const at = nowAt(opts);
    upd(T.je, id, { status: 'APPROVED', seq: n, number: fmtNum(e.period, n), approved_by: user, approved_at: at, total_debit: td, total_credit: tc }, G._seeding);
    addHist(e, `Aprobado · número ${fmtNum(e.period, n)}`, user, at);
    if (!G._seeding) G.audit('APROBAR', T.je, id, `${fmtNum(e.period, n)} · ${e.description}`);
    return e;
  }
  /** RN-CNT-03: aprobado no se modifica */
  function updateLine(lineId, patch) {
    const l = D.get(T.jl, lineId); if (!l) throw new Error('Línea no encontrada.');
    const e = D.get(T.je, l.entry_id);
    if (e.status === 'APPROVED') G.fail('RN-CNT-03', `El asiento ${e.number} está aprobado: no se modifica ni se borra, ni sus líneas. Corrígelo con un asiento de reverso.`);
    if (e.status === 'VOIDED') throw new Error('El asiento está anulado.');
    if (G.period.isClosed(e.entry_date)) G.fail('RN-CNT-06', 'El período del asiento está cerrado.');
    const r = upd(T.jl, lineId, patch, false);
    const ls = linesOf(e.id); upd(T.je, e.id, { total_debit: R(U.sum(ls, x => x.debit)), total_credit: R(U.sum(ls, x => x.credit)) });
    return r;
  }
  function voidEntry(id, reason, opts = {}) {
    const e = D.get(T.je, id); if (!e) throw new Error('Asiento no encontrado.');
    if (e.status === 'APPROVED') G.fail('RN-CNT-03', `El asiento ${e.number} está aprobado: no se borra; se corrige con un asiento de reverso.`);
    if (!String(reason || '').trim()) throw new Error('Indica el motivo.');
    upd(T.je, id, { status: 'VOIDED', void_reason: reason }, false); addHist(e, 'Anulado: ' + reason, opts.user || userId());
    if (e.reversal_of) { const o = D.get(T.je, e.reversal_of); if (o && o.reversed_by_id === id) upd(T.je, o.id, { reversed_by_id: null }); }
  }
  /** reverso: líneas invertidas; el original deja de estar vigente (RN-CNT-03, RN-CNT-20) */
  function reverseEntry(id, reason, opts = {}) {
    modOn();
    const e = D.get(T.je, id); if (!e) throw new Error('Asiento no encontrado.');
    if (e.status !== 'APPROVED') throw new Error('Solo se reversa un asiento aprobado; un borrador se anula.');
    if (e.reversed_by_id) throw new Error(`El asiento ${e.number} ya tiene reverso.`);
    const user = opts.user === undefined ? userId() : opts.user;
    if (user && !canU('cnt.entry.prepare', user)) G.fail('RN-CNT-21', 'Reversar asientos exige cnt.entry.prepare.');
    if (!String(reason || '').trim()) throw new Error('Indica el motivo del reverso.');
    const date = opts.date || (G.period.isClosed(e.entry_date) ? G.TODAY : e.entry_date);
    if (!G._seeding && G.period.isClosed(date)) G.fail('RN-CNT-06', `El período ${pName(date)} está cerrado.`);
    const rows = linesOf(id).map(l => ({ account_code: l.account_code, description: 'Reverso · ' + (l.description || ''), debit: l.credit, credit: l.debit, cost_center_id: l.cost_center_id, brand_id: l.brand_id, establishment_id: l.establishment_id, third_party_type: l.third_party_type, third_party_id: l.third_party_id, third_party_doc: l.third_party_doc, third_party_name: l.third_party_name, is_destination: l.is_destination }));
    const auto = !!opts.auto;
    const r = insertEntry({ entry_date: date, source_kind: e.source_kind, source_type: e.source_type, source_subtype: e.source_subtype, source_id: e.source_id, source_label: e.source_label, rule_id: e.rule_id, rule_code: e.rule_code, description: `Reverso de ${e.number}: ${reason}`, status: auto ? 'APPROVED' : 'PENDING_APPROVAL', prepared_by: user || null, brand_id: e.brand_id, establishment_id: e.establishment_id, reversal_of: e.id, reverse_reason: reason }, rows, opts);
    if (auto) { const n = nextSeq(r.period); Object.assign(r, { seq: n, number: fmtNum(r.period, n), approved_at: r.prepared_at, auto_approved: true }); }
    upd(T.je, e.id, { reversed_by_id: r.id }); addHist(e, `Reversado por ${r.number || 'asiento por aprobar'}: ${reason}`, user);
    return r;
  }
  /** asiento manual (CNT-04): queda en borrador o pendiente de aprobación */
  function createManual(d, opts = {}) {
    modOn();
    const user = opts.user || userId();
    if (!canU('cnt.entry.prepare', user)) G.fail('RN-CNT-21', 'Registrar asientos manuales exige cnt.entry.prepare (PRACTICANTE_CONTABLE o CONTADORA).');
    const date = d.entry_date || d.date || G.TODAY;
    if (!G._seeding && G.period.isClosed(date)) G.fail('RN-CNT-06', `El período ${pName(date)} está cerrado: no se registra un asiento con fecha ${F.date(date)} (RN-PLT-05).`);
    if (!String(d.description || '').trim()) throw new Error('Indica la glosa del asiento.');
    const rows = (d.lines || []).filter(l => l && l.account_code && (Number(l.debit) > 0 || Number(l.credit) > 0 || Number(l.debit) < 0 || Number(l.credit) < 0)).map(l => ({ account_code: String(l.account_code), description: l.description || d.description, debit: R(Number(l.debit) || 0), credit: R(Number(l.credit) || 0), cost_center_id: l.cost_center_id || null, brand_id: l.brand_id || null, establishment_id: l.establishment_id || null, third_party_type: l.third_party_type || (l.third_party_doc ? 'OTHER' : null), third_party_id: l.third_party_id || null, third_party_doc: l.third_party_doc || null, third_party_name: l.third_party_name || null, is_destination: !!l.is_destination }));
    if (rows.length < 2) throw new Error('Un asiento tiene al menos dos líneas con importe.');
    const pr = lineProblems(rows); if (pr.length) G.fail(pr[0][0], pr[0][1]);
    const td = R(U.sum(rows, l => l.debit)), tc = R(U.sum(rows, l => l.credit));
    if (d.submit && Math.abs(td - tc) > 0.004) G.fail('RN-CNT-01', `No cuadra: debe ${F.money(td)} y haber ${F.money(tc)}. Guárdalo como borrador o corrige las líneas.`);
    let all = rows;
    if (d.destination !== false) { const extra = withDestination(rows.filter(r => !r.is_destination).map(r => ({ account_code: r.account_code, side: r.debit > 0 ? 'D' : 'C', amount: r.debit || r.credit, cost_center_id: r.cost_center_id, brand_id: r.brand_id, establishment_id: r.establishment_id }))).filter(x => x.is_destination).map(toRow); all = rows.concat(extra); }
    const e = insertEntry({ entry_date: date, source_kind: d.kind || 'MANUAL', source_type: d.kind === 'OPENING' ? 'OPENING' : 'MANUAL', source_subtype: d.subtype || '*', source_id: null, source_label: d.reference || null, rule_id: null, rule_code: null, description: d.description, status: d.submit ? 'PENDING_APPROVAL' : 'DRAFT', prepared_by: user, brand_id: d.brand_id || null, establishment_id: d.establishment_id || null, bank_line_id: d.bank_line_id || null }, all, Object.assign({ silentHeader: G._seeding }, opts));
    if (!G._seeding) { G.audit('REGISTRAR', T.je, e.id, `${G.roleName(roleOf(user))} · ${d.description}`); if (d.submit) G.notify({ role: 'CONTADORA', title: 'Asiento manual por aprobar', body: d.description, ref: e.id, module: MOD, tone: 'warn' }); }
    return e;
  }
  function submitEntry(id, opts = {}) {
    const e = D.get(T.je, id); if (!e || e.status !== 'DRAFT') throw new Error('Solo se envía un borrador.');
    if (e.blocked) G.fail('RN-CNT-05', 'El asiento está retenido en la bandeja.');
    const ls = linesOf(id); const td = R(U.sum(ls, l => l.debit)), tc = R(U.sum(ls, l => l.credit));
    if (!(td > 0) || Math.abs(td - tc) > 0.004) G.fail('RN-CNT-01', `No cuadra: debe ${F.money(td)} y haber ${F.money(tc)}.`);
    upd(T.je, id, { status: 'PENDING_APPROVAL' }, false); addHist(e, 'Enviado a aprobación', opts.user || userId());
  }
  Object.assign(CNT, { approveEntry, updateLine, voidEntry, reverseEntry, createManual, submitEntry, linesOf, lineProblems, expand, ruleFor, cashGl, invGl, FACTS });

  /* =====================================================================
     Bandeja de la contadora (RN-CNT-09, RN-CNT-10)
     ===================================================================== */
  function toInbox(o) {
    const kind = kindAlias(o.source_type);
    const ex = D.find(T.inbox, x => kindAlias(x.source_type) === kind && x.source_id === o.source_id && x.reason === o.reason && ['PENDING', 'CLASSIFIED', 'RETURNED'].includes(x.status) && (!o.sire_line_id || x.sire_line_id === o.sire_line_id));
    if (ex) { if (o.entry_id && !ex.entry_id) upd(T.inbox, ex.id, { entry_id: o.entry_id }); return ex; }
    const it = ins(T.inbox, { company_id: 'co-dg', period: monthOf(o.date || G.TODAY), source_type: o.source_type, source_id: o.source_id, reason: o.reason, missing: o.missing || [o.reason], status: 'PENDING', assigned_to: null, classification: null, classified_by: null, classified_at: null, approved_by: null, approved_at: null, returned_reason: null, notes: o.notes || null, ref_label: o.ref_label || null, amount: o.amount || null, entry_id: o.entry_id || null, sire_line_id: o.sire_line_id || null, created_at: o.at || G.date.now(), history: [{ at: o.at || G.date.now(), user: 'Sistema', action: 'Ingresó: ' + (REASONS[o.reason] || o.reason) }] }, G._seeding);
    if (!G._seeding) G.notify({ role: 'PRACTICANTE_CONTABLE', title: 'Nuevo ítem en la bandeja contable', body: `${REASONS[o.reason] || o.reason} · ${o.ref_label || ''}`, ref: it.id, module: MOD, tone: 'info' });
    return it;
  }
  const itemHist = (it, action, user, at) => { it.history = (it.history || []).concat([{ at: at || G.date.now(), user: uName(user), action }]); };
  /** la practicante clasifica: cuenta, centro de costo, marca y nota */
  function classifyItem(id, c = {}, opts = {}) {
    modOn();
    const it = D.get(T.inbox, id); if (!it) throw new Error('Ítem no encontrado.');
    const user = opts.user || userId();
    if (!canU('cnt.entry.prepare', user)) G.fail('RN-CNT-10', 'Clasificar exige cnt.entry.prepare (PRACTICANTE_CONTABLE o CONTADORA).');
    if (!['PENDING', 'RETURNED', 'CLASSIFIED'].includes(it.status)) throw new Error('El ítem ya está resuelto.');
    const miss = it.missing || [it.reason];
    if ((miss.includes('MISSING_ACCOUNT') || it.reason === 'NO_RULE') && !c.account_code) throw new Error('Elige la cuenta contable.');
    if (c.account_code) { const a = acct(c.account_code); if (!a || !a.postable) G.fail('RN-CNT-05', `La cuenta ${c.account_code} no recibe movimientos.`); }
    if (miss.includes('MISSING_COST_CENTER') && !c.cost_center_id) throw new Error('Elige el centro de costo.');
    if (miss.includes('MISSING_BRAND') && !c.brand_id) G.fail('RN-CNT-16', 'Elige la marca de la línea de ingresos, costos o gastos.');
    if (!String(c.note || '').trim() && ['PO_MISMATCH', 'SIRE_DIFF', 'NO_VALID_RECEIPT'].includes(it.reason)) throw new Error('Indica la nota de clasificación.');
    const at = nowAt(opts);
    upd(T.inbox, id, { status: 'CLASSIFIED', classification: { account_code: c.account_code || null, cost_center_id: c.cost_center_id || null, brand_id: c.brand_id || null, note: c.note || null, remember: !!c.remember, action: c.action || null }, classified_by: user, classified_at: at }, G._seeding);
    itemHist(it, `Clasificado${c.account_code ? ' · cuenta ' + c.account_code : ''}${c.brand_id ? ' · ' + G.brandName(c.brand_id) : ''}${c.note ? ' · ' + c.note : ''}`, user, at);
    if (!G._seeding) G.audit('CLASIFICAR', T.inbox, id, it.ref_label || '');
    return it;
  }
  /** la contadora aprueba: genera o completa el asiento según el motivo */
  function approveItem(id, opts = {}) {
    modOn();
    const it = D.get(T.inbox, id); if (!it) throw new Error('Ítem no encontrado.');
    const user = opts.user || userId();
    if (sameUser(it.classified_by, user)) G.fail('RN-CNT-10', `Quien clasifica no aprueba: ${uName(it.classified_by)} clasificó este ítem; lo aprueba la contadora.`);
    if (!canU('cnt.entry.approve', user)) G.fail('RN-CNT-10', 'PRACTICANTE_CONTABLE clasifica y CONTADORA aprueba: tu rol no tiene cnt.entry.approve.');
    if (!['PENDING', 'CLASSIFIED', 'RETURNED'].includes(it.status)) throw new Error('El ítem ya está resuelto.');
    const c = it.classification || {}; const kind = kindAlias(it.source_type); const at = nowAt(opts);
    const needCls = ['NO_RULE', 'MISSING_ACCOUNT', 'MISSING_COST_CENTER', 'MISSING_BRAND'].includes(it.reason);
    if (needCls && it.status !== 'CLASSIFIED') G.fail('RN-CNT-10', 'Primero lo clasifica la practicante (cuenta, centro de costo y marca); luego lo apruebas.');
    let entry = null;
    const ov = { account: c.account_code, cc: c.cost_center_id, brand: c.brand_id };
    if (it.reason === 'NO_RULE') { const r = buildEntry(kind, it.source_id, { fallback: true, override: ov, user: it.classified_by, approveBy: user, at }); entry = r.entry; }
    else if (needCls) {
      if (c.remember && c.account_code && kind === 'PURCHASE') { const doc = D.get('purchase_documents', it.source_id); const f = FACTS.PURCHASE(it.source_id); const rule = f && !f.skip && ruleFor(f.source, f.subtype, f.date); if (rule && doc) { const m = Object.assign({}, rule.account_map || {}); m.suppliers = Object.assign({}, m.suppliers || {}, { [doc.supplier_id]: c.account_code }); upd(T.rule, rule.id, { account_map: m }); } }
      const r = buildEntry(kind, it.source_id, { override: ov, user: it.classified_by, approveBy: user, at, replace: it.entry_id }); entry = r.entry;
      if (!entry || entry.blocked) G.fail('RN-CNT-05', 'La clasificación no completa todos los datos del asiento: devuélvelo con la indicación.');
    } else if (it.reason === 'PO_MISMATCH') {
      const note = c.note || opts.note || 'Diferencia aceptada por la contadora';
      const doc = D.get('purchase_documents', it.source_id);
      if (doc && doc.match_status === 'OBSERVED') { if (G.com && G.com.approveMatch) { const prev = G.ctx.role; try { G.ctx.role = roleOf(user); G.com.approveMatch(doc.id, note, user); } finally { G.ctx.role = prev; } } else upd('purchase_documents', doc.id, { match_status: 'APPROVED_DIFF', status: 'APPROVED', match_note: note }); }
      const r = buildEntry('PURCHASE', it.source_id, { user: it.classified_by, at }); entry = r.entry || null;
    } else if (it.reason === 'NO_VALID_RECEIPT') {
      if (G.gas && G.gas.accountingReview && !G._seeding) { const prev = G.ctx.role; try { G.ctx.role = roleOf(user); G.gas.accountingReview(it.source_id, { action: c.action === 'VALIDATE' ? 'VALIDATE' : 'NOT_DEDUCTIBLE', note: c.note }); } catch (e) { if (!(e instanceof G.RuleError)) console.warn(e); } finally { G.ctx.role = prev; } }
      else { const e = D.get('expenses', it.source_id); if (e) upd('expenses', e.id, { accounting_reviewed_at: at, accounting_reviewed_by: user }); }
    } else if (it.reason === 'SIRE_DIFF' && it.sire_line_id) {
      const l = D.get(T.spl, it.sire_line_id); if (l && !l.resolution) upd(T.spl, l.id, { resolution: 'JUSTIFIED', resolution_note: c.note || opts.note || 'Justificado en la bandeja', resolved_by: user, resolved_at: at });
    }
    upd(T.inbox, id, { status: 'APPROVED', approved_by: user, approved_at: at, entry_id: entry ? entry.id : it.entry_id }, G._seeding);
    itemHist(it, 'Aprobado' + (entry ? ` · asiento ${entry.number || ''}` : ''), user, at);
    if (!G._seeding) G.audit('APROBAR', T.inbox, id, it.ref_label || '');
    return D.get(T.inbox, id);
  }
  function returnItem(id, reason, opts = {}) {
    const it = D.get(T.inbox, id); if (!it) throw new Error('Ítem no encontrado.');
    const user = opts.user || userId();
    if (!canU('cnt.entry.approve', user)) G.fail('RN-CNT-10', 'Devolver exige cnt.entry.approve (CONTADORA).');
    if (it.status !== 'CLASSIFIED') throw new Error('Solo se devuelve un ítem clasificado.');
    if (!String(reason || '').trim()) throw new Error('Indica qué debe corregirse.');
    upd(T.inbox, id, { status: 'RETURNED', returned_reason: reason }, G._seeding); itemHist(it, 'Devuelto: ' + reason, user, opts.at);
    if (!G._seeding && it.classified_by) G.notify({ user_id: it.classified_by, title: 'La contadora devolvió un ítem', body: reason, ref: id, module: MOD, tone: 'warn' });
  }
  const inboxOpen = (period) => D.where(T.inbox, x => ['PENDING', 'CLASSIFIED', 'RETURNED'].includes(x.status) && (!period || x.period === period));
  Object.assign(CNT, { toInbox, classifyItem, approveItem, returnItem, inboxOpen });

  /** genera los asientos faltantes del rango y reversa los de documentos anulados */
  function generatePending(o = {}) {
    modOn();
    const from = o.from || '2026-01-01', to = o.to || G.TODAY; const res = { created: 0, inbox: 0, reversed: 0, existing: 0, skipped: 0, errors: [] };
    for (const kind of Object.keys(ENUM)) for (const x of ENUM[kind](from, to)) {
      if (!G._seeding && G.period.isClosed(x.date)) continue;
      try {
        const f = FACTS[kind](x.id); if (!f) continue;
        if (f.skip) { if (f.void) for (const e of liveEntries(kind, x.id)) if (e.status === 'APPROVED') { reverseEntry(e.id, 'Documento de origen anulado', { user: null, auto: true, date: G.period.isClosed(e.entry_date) ? G.TODAY : e.entry_date }); res.reversed++; } else if (e.status !== 'VOIDED') { voidEntry(e.id, 'Documento de origen anulado', { user: null }); res.reversed++; } res.skipped++; continue; }
        if (liveEntries(kind, x.id).length) { res.existing++; continue; }
        if (openInbox(kind, x.id)) { res.inbox++; continue; }
        const r = buildEntry(kind, x.id, { user: o.user || null, at: o.at });
        if (r.entry) res.created++; else if (r.inbox) res.inbox++;
      } catch (e) { res.errors.push(e.message); }
    }
    return res;
  }
  /** v_documents_without_entry: comprobantes de venta y compra (y gastos) sin asiento aprobado */
  function docsWithoutEntry(o = {}) {
    const from = o.from || G.date.month(G.TODAY), to = o.to || lastDay(G.date.month(from)); const out = [];
    for (const kind of ['SALE', 'PURCHASE', 'EXPENSE']) for (const x of ENUM[kind](from, to)) {
      let f; try { f = FACTS[kind](x.id); } catch (e) { f = { label: x.id, date: x.date }; }
      if (!f || (f.skip && !f.held)) continue;
      const es = liveEntries(kind, x.id); const ok = es.find(e => e.status === 'APPROVED'); if (ok) continue;
      const ib = openInbox(kind, x.id);
      if (o.brand && f.brand && f.brand !== o.brand) continue;
      if (o.site && f.site && f.site !== o.site) continue;
      out.push({ kind, id: x.id, date: x.date, label: f.label || x.id, amount: f.amounts ? (f.amounts.TOTAL || f.amounts.TOTAL_PAYABLE || 0) : 0, state: ib ? 'En la bandeja · ' + (REASONS[ib.reason] || ib.reason) : es.length ? 'Asiento ' + LBL[es[0].status][0].toLowerCase() : f.held ? 'Observado (RN-COM-07)' : 'Sin asiento', entry: es[0] || null, item: ib });
    }
    return out;
  }
  Object.assign(CNT, { generatePending, docsWithoutEntry });

  /* =====================================================================
     SIRE: propuestas de compras y ventas, cruce y envíos (RN-CNT-11, 18)
     ===================================================================== */
  const SUNAT_CODE = { INVOICE: '01', RECEIPT: '03', FEE_RECEIPT: '02', CREDIT_NOTE: '07', DEBIT_NOTE: '08', PURCHASE_SETTLEMENT: '04' };
  const normSer = s => String(s ?? '').trim().toUpperCase();
  const normNum = n => String(n ?? '').trim().replace(/^0+(?=\d)/, '');
  const sireKey = (ruc, type, ser, num) => [String(ruc || '').trim(), type, normSer(ser), normNum(num)].join('|');
  /** comprobantes de compra registrados del período (COM y GAS) */
  function systemPurchases(period) {
    const to = lastDay(period); const out = [];
    for (const d of D.where('purchase_documents', d => d.status !== 'VOIDED' && SUNAT_CODE[d.doc_type] && d.doc_type !== 'FEE_RECEIPT' && inR(d.accounting_date || d.issue_date, period, to))) { const s = D.get('suppliers', d.supplier_id) || {}; out.push({ key: sireKey(s.doc_number, SUNAT_CODE[d.doc_type], d.series, d.number), kind: 'PURCHASE', id: d.id, ruc: s.doc_number, name: s.legal_name || s.trade_name, type: SUNAT_CODE[d.doc_type], series: d.series, number: d.number, date: d.issue_date, base: R(Number(d.base_taxed) * (Number(d.exchange_rate) || 1)), igv: R(Number(d.igv) * (Number(d.exchange_rate) || 1)), total: R(Number(d.total) * (Number(d.exchange_rate) || 1)) }); }
    for (const e of D.where('expenses', e => ['SUBMITTED', 'APPROVED', 'PAID'].includes(e.status) && ['INVOICE', 'RECEIPT'].includes(e.doc_type) && e.supplier_id && inR(e.issue_date, period, to))) { const s = D.get('suppliers', e.supplier_id) || {}; if (s.doc_type && s.doc_type !== 'RUC') continue; out.push({ key: sireKey(s.doc_number, SUNAT_CODE[e.doc_type], e.doc_series, e.doc_number), kind: 'EXPENSE', id: e.id, ruc: s.doc_number, name: s.legal_name || s.trade_name, type: SUNAT_CODE[e.doc_type], series: e.doc_series, number: e.doc_number, date: e.issue_date, base: R(e.net_pen || e.subtotal || 0), igv: R(e.igv || 0), total: R(e.amount_pen || e.total || 0) }); }
    return out;
  }
  /** comprobantes emitidos del período (FAC) */
  function systemSales(period) {
    const to = lastDay(period); const ruc = COMPANY().ruc;
    return D.where('sales_documents', d => isValidSale(d) && SUNAT_CODE[d.doc_type] && inR(d.issue_date, period, to)).map(d => ({ key: sireKey(ruc, SUNAT_CODE[d.doc_type], d.series, d.number), kind: 'SALE', id: d.id, ruc, name: d.customer_name || G.custName(d.customer_id), cust: d.customer_doc_number, type: SUNAT_CODE[d.doc_type], series: d.series, number: d.number, date: d.issue_date, base: d.subtotal, igv: d.igv, total: d.total, sunat: d.sunat_status }));
  }
  /** cnt_match_sire_purchases(propuesta) y su par de ventas */
  function matchSire(proposalId, opts = {}) {
    const p = D.get(T.sp, proposalId); if (!p) throw new Error('Propuesta no encontrada.');
    const tol = Number(G.param('cnt_sire_amount_tolerance_pen') ?? 1);
    const sys = p.register === 'SALES' ? systemSales(p.period) : systemPurchases(p.period);
    const map = new Map(); for (const s of sys) if (!map.has(s.key)) map.set(s.key, s);
    const seen = new Set(); const sum = { MATCHED: 0, AMOUNT_DIFF: 0, MISSING_IN_SYSTEM: 0, MISSING_IN_PROPOSAL: 0 };
    const lines = D.where(T.spl, l => l.proposal_id === proposalId);
    const derived = new Map(lines.filter(l => l.origin === 'SYSTEM').map(l => [l.key, l]));
    for (const l of lines.filter(l => l.origin !== 'SYSTEM')) {
      const s = map.get(l.key); let status, patch;
      if (!s) { status = 'MISSING_IN_SYSTEM'; patch = { system_kind: null, system_id: null, system_total: null, diff: null }; }
      else { seen.add(s.key); const diff = R(Number(l.total) - Number(s.total)); status = Math.abs(diff) > tol + 1e-9 ? 'AMOUNT_DIFF' : 'MATCHED'; patch = { system_kind: s.kind, system_id: s.id, system_total: s.total, diff }; }
      sum[status]++;
      if (l.match_status !== status || l.system_id !== patch.system_id) { Object.assign(l, patch, { match_status: status }); if (status === 'MATCHED') l.resolution = null; }
    }
    for (const s of sys) {
      if (seen.has(s.key)) { const d = derived.get(s.key); if (d) { D.remove(T.spl, d.id); } continue; }
      sum.MISSING_IN_PROPOSAL++;
      if (!derived.has(s.key)) ins(T.spl, { proposal_id: proposalId, origin: 'SYSTEM', key: s.key, seq: 100000 + sum.MISSING_IN_PROPOSAL, issuer_ruc: s.ruc, issuer_name: s.name, counterparty_doc: s.cust || null, doc_type_code: s.type, series: s.series, number: String(s.number), issue_date: s.date, base: s.base, igv: s.igv, total: null, match_status: 'MISSING_IN_PROPOSAL', system_kind: s.kind, system_id: s.id, system_total: s.total, diff: null, resolution: null });
    }
    for (const [k, d] of derived) if (!sys.find(s => s.key === k)) D.remove(T.spl, d.id);
    D.touch(); bump();
    const pending = D.where(T.spl, l => l.proposal_id === proposalId && l.match_status !== 'MATCHED' && !l.resolution).length;
    upd(T.sp, proposalId, { matched_at: nowAt(opts), summary: sum, status: p.status === 'SUBMITTED' ? 'SUBMITTED' : pending ? 'WITH_DIFFS' : 'RECONCILED', system_count: sys.length }, G._seeding);
    if (opts.inbox) for (const l of D.where(T.spl, l => l.proposal_id === proposalId && ['AMOUNT_DIFF', 'MISSING_IN_SYSTEM'].includes(l.match_status) && !l.resolution)) toInbox({ source_type: 'SIRE', source_id: proposalId, sire_line_id: l.id, reason: 'SIRE_DIFF', date: p.period, notes: `RN-CNT-11: ${LBL[l.match_status][0]} · ${l.issuer_ruc} ${l.doc_type_code} ${l.series}-${l.number}${l.diff != null ? ' · diferencia ' + F.money(l.diff) : ''}`, ref_label: `SIRE ${p.register === 'SALES' ? 'ventas' : 'compras'} ${pName(p.period)} · ${l.series}-${l.number}`, amount: l.total, at: opts.at });
    return sum;
  }
  /** archivo de la propuesta: RUC|Razón social|Tipo|Serie|Número|Fecha|Base|IGV|Total */
  function parseProposal(text, reg) {
    const out = [], errs = [];
    String(text || '').split(/\r?\n/).forEach((ln, i) => {
      const s = ln.trim(); if (!s || /^ruc\|/i.test(s)) return;
      const c = s.split('|').map(x => x.trim());
      if (c.length < 9) { errs.push(`Línea ${i + 1}: se esperaban 9 columnas separadas por «|».`); return; }
      const [ruc, name, type, series, number, date, base, igv, total] = c;
      if (!(reg === 'SALES' ? /^\d{8,11}$/ : /^\d{11}$/).test(ruc)) { errs.push(`Línea ${i + 1}: ${reg === 'SALES' ? 'documento del cliente' : 'RUC'} ${ruc} inválido.`); return; }
      if (!/^\d{2}$/.test(type)) { errs.push(`Línea ${i + 1}: tipo de comprobante ${type} inválido (01, 03, 07…).`); return; }
      const iso = /^\d{2}\/\d{2}\/\d{4}$/.test(date) ? `${date.slice(6)}-${date.slice(3, 5)}-${date.slice(0, 2)}` : date;
      if (isNaN(Number(total))) { errs.push(`Línea ${i + 1}: total inválido.`); return; }
      out.push({ issuer_ruc: ruc, issuer_name: name, doc_type_code: type, series: normSer(series), number: normNum(number), issue_date: iso, base: Number(base) || 0, igv: Number(igv) || 0, total: Number(total) });
    });
    return { lines: out, errors: errs };
  }
  function importProposal(d, opts = {}) {
    modOn();
    const user = opts.user || userId();
    if (!canU('cnt.sire.manage', user)) G.fail('RN-CNT-18', 'Importar propuestas SIRE exige cnt.sire.manage.');
    const period = G.date.month(d.period || G.TODAY); const reg = d.register || 'PURCHASES';
    const parsed = d.lines ? { lines: d.lines, errors: [] } : parseProposal(d.text, d.register);
    if (parsed.errors.length) throw new Error(parsed.errors.slice(0, 3).join(' '));
    if (!parsed.lines.length) throw new Error('El archivo no tiene comprobantes.');
    for (const old of D.where(T.sp, p => p.register === reg && p.period === period && p.status !== 'SUBMITTED' && !p.superseded)) upd(T.sp, old.id, { superseded: true, status: 'REPLACED' });
    const p = ins(T.sp, { company_id: 'co-dg', register: reg, period, file_name: d.file_name || `propuesta-${reg === 'SALES' ? 'rvie' : 'rce'}-${period.slice(0, 7)}.txt`, imported_at: nowAt(opts), imported_by: user, line_count: parsed.lines.length, total_amount: R(U.sum(parsed.lines, l => l.total)), status: 'IMPORTED', summary: null, superseded: false }, G._seeding);
    parsed.lines.forEach((l, i) => ins(T.spl, Object.assign({ proposal_id: p.id, origin: 'PROPOSAL', seq: i + 1, key: sireKey(l.issuer_ruc, l.doc_type_code, l.series, l.number), match_status: null, resolution: null }, l, reg === 'SALES' ? { counterparty_doc: l.issuer_ruc, issuer_ruc: COMPANY().ruc, key: sireKey(COMPANY().ruc, l.doc_type_code, l.series, l.number) } : {})));
    const sum = matchSire(p.id, { inbox: d.inbox !== false && !G._seeding, at: opts.at });
    if (!G._seeding) G.audit('IMPORTAR', T.sp, p.id, `${reg} ${pName(period)} · ${parsed.lines.length} líneas`);
    return { proposal: D.get(T.sp, p.id), summary: sum };
  }
  /** archivo de ejemplo como lo descarga la contadora de SUNAT Operaciones en Línea */
  function sampleProposalText(reg, period) {
    const r = U.rng(period.slice(5, 7) * 31 + (reg === 'SALES' ? 7 : 3));
    const sys = reg === 'SALES' ? systemSales(period).filter(s => s.sunat !== 'PENDING') : systemPurchases(period);
    const rows = sys.map(s => [reg === 'SALES' ? (s.cust || '00000000') : s.ruc, s.name, s.type, s.series, s.number, F.date(s.date), s.base, s.igv, s.total]);
    if (reg !== 'SALES' && rows.length > 3) {
      const i = Math.floor(r() * rows.length); rows[i] = rows[i].slice(); rows[i][8] = R(Number(rows[i][8]) + 12.5); rows[i][6] = R(Number(rows[i][6]) + 10.59); rows[i][7] = R(Number(rows[i][7]) + 1.91);
      const luz = D.get('suppliers', 'su-GAS-LUZ') || { doc_number: '20331898008', legal_name: 'LUZ DEL SUR SAA' }; const tel = D.get('suppliers', 'su-GAS-TEL') || { doc_number: '20100017491', legal_name: 'TELEFÓNICA DEL PERÚ SAA' };
      rows.push([luz.doc_number, luz.legal_name, '01', 'F104', String(880000 + U.int(r, 100, 999)), F.date(G.date.add(period, 20)), 186.44, 33.56, 220.0]);
      rows.push([tel.doc_number, tel.legal_name, '01', 'F310', String(450000 + U.int(r, 100, 999)), F.date(G.date.add(period, 7)), 254.24, 45.76, 300.0]);
      const drop = rows.length - 3; if (drop > 0) rows.splice(Math.floor(r() * drop), 1);
    }
    return 'RUC|Razon social|Tipo|Serie|Numero|Fecha|Base|IGV|Total\n' + rows.map(x => x.join('|')).join('\n');
  }
  const RESOLUTIONS = { AMOUNT_DIFF: [['KEEP_SYSTEM', 'Ajustar la propuesta al importe registrado'], ['FIX_SYSTEM', 'Corregir el registro del sistema'], ['JUSTIFIED', 'Justificado (nota)']], MISSING_IN_SYSTEM: [['REGISTER', 'Se registrará en el sistema (COM o GAS)'], ['EXCLUDE', 'Excluir: no corresponde al período o a la empresa'], ['JUSTIFIED', 'Justificado (nota)']], MISSING_IN_PROPOSAL: [['ADD_TO_REGISTER', 'Agregar en el ajuste del registro'], ['NEXT_PERIOD', 'Se anota en el período siguiente'], ['JUSTIFIED', 'Justificado (nota)']] };
  function resolveSireLine(id, resolution, note, opts = {}) {
    const l = D.get(T.spl, id); if (!l) throw new Error('Línea no encontrada.');
    const user = opts.user || userId();
    if (!canU('cnt.sire.manage', user)) G.fail('RN-CNT-18', 'Resolver diferencias SIRE exige cnt.sire.manage.');
    if (l.match_status === 'MATCHED') throw new Error('La línea coincide: no hay diferencia que resolver.');
    if (!resolution) throw new Error('Elige cómo se resuelve.');
    if (!String(note || '').trim()) throw new Error('Indica la nota de sustento.');
    upd(T.spl, id, { resolution, resolution_note: note, resolved_by: user, resolved_at: nowAt(opts) }, G._seeding);
    for (const it of D.where(T.inbox, x => x.sire_line_id === id && ['PENDING', 'CLASSIFIED', 'RETURNED'].includes(x.status))) { upd(T.inbox, it.id, { status: 'APPROVED', approved_by: user, approved_at: nowAt(opts) }); itemHist(it, 'Resuelto en SIRE: ' + note, user); }
    const p = D.get(T.sp, l.proposal_id); const pend = D.where(T.spl, x => x.proposal_id === p.id && x.match_status !== 'MATCHED' && !x.resolution).length;
    if (!pend && p.status === 'WITH_DIFFS') upd(T.sp, p.id, { status: 'RECONCILED' });
  }
  const currentProposal = (reg, period) => D.where(T.sp, p => p.register === reg && p.period === period && !p.superseded).sort(U.by('imported_at', -1))[0] || null;
  const unresolved = pid => D.where(T.spl, l => l.proposal_id === pid && l.match_status && l.match_status !== 'MATCHED' && !l.resolution);
  function prepareSubmission(d, opts = {}) {
    modOn();
    const user = opts.user || userId();
    if (!canU('cnt.sire.manage', user)) G.fail('RN-CNT-18', 'Preparar envíos SIRE exige cnt.sire.manage.');
    const p = currentProposal(d.register, d.period); if (!p) throw new Error(`No hay propuesta de ${d.register === 'SALES' ? 'ventas' : 'compras'} de ${pName(d.period)} importada.`);
    const un = unresolved(p.id); if (un.length) G.fail('RN-CNT-18', `Quedan ${un.length} diferencia(s) sin resolver o justificar en la propuesta de ${pName(d.period)}: resuélvelas antes de preparar el envío.`);
    const diffs = D.where(T.spl, l => l.proposal_id === p.id && l.match_status !== 'MATCHED').length;
    const action = d.action || (diffs ? 'ADJUST' : 'ACCEPT');
    if (action === 'ACCEPT' && diffs) G.fail('RN-CNT-18', 'Hay diferencias resueltas: el envío es de ajuste o de reemplazo, no de aceptación.');
    const ruc = COMPANY().ruc; const code = d.register === 'SALES' ? '140400' : '080400';
    const content = D.where(T.spl, l => l.proposal_id === p.id).map(l => [l.key, l.total, l.resolution || ''].join('|')).join('\n');
    return ins(T.ss, { company_id: 'co-dg', register: d.register, period: d.period, proposal_id: p.id, action, file_name: `LE${ruc}${d.period.slice(0, 4)}${d.period.slice(5, 7)}00${code}${action === 'ACCEPT' ? '1' : '2'}.zip`, file_hash: hash(content), line_count: D.where(T.spl, l => l.proposal_id === p.id).length, adjustments: diffs, generated_at: nowAt(opts), prepared_by: user, status: 'PREPARED', ticket: null, receipt_number: null, submitted_by: null, submitted_at: null }, G._seeding);
  }
  function markSubmissionSent(id, ticket, opts = {}) {
    const s = D.get(T.ss, id); const user = opts.user || userId();
    if (!canU('cnt.sire.submit', user)) G.fail('RN-CNT-18', 'Marcar el envío como presentado exige cnt.sire.submit (CONTADORA).');
    if (!s || s.status !== 'PREPARED') throw new Error('Solo se envía un archivo preparado.');
    if (unresolved(s.proposal_id).length) G.fail('RN-CNT-18', 'La propuesta tiene diferencias sin resolver.');
    if (!String(ticket || '').trim()) throw new Error('Indica el número de ticket que devolvió SUNAT.');
    upd(T.ss, id, { status: 'SENT', ticket, submitted_by: user, submitted_at: nowAt(opts) }, G._seeding);
  }
  function markSubmissionResult(id, ok, ref, opts = {}) {
    const s = D.get(T.ss, id); const user = opts.user || userId();
    if (!canU('cnt.sire.submit', user)) G.fail('RN-CNT-18', 'Registrar la constancia exige cnt.sire.submit.');
    if (!s || s.status !== 'SENT') throw new Error('Solo se registra la respuesta de un envío presentado.');
    if (!String(ref || '').trim()) throw new Error(ok ? 'Indica el número de constancia.' : 'Indica el motivo del rechazo.');
    upd(T.ss, id, ok ? { status: 'ACCEPTED', receipt_number: ref, accepted_at: nowAt(opts) } : { status: 'REJECTED', reject_reason: ref }, G._seeding);
    if (ok) upd(T.sp, s.proposal_id, { status: 'SUBMITTED' }, G._seeding);
  }
  Object.assign(CNT, { matchSire, matchSirePurchases: matchSire, importProposal, parseProposal, sampleProposalText, resolveSireLine, prepareSubmission, markSubmissionSent, markSubmissionResult, systemPurchases, systemSales, currentProposal });

  /* =====================================================================
     Régimen y libros del año (RN-CNT-12, 13, 17)
     ===================================================================== */
  const BOOKS = { RV: ['Registro de Ventas e Ingresos', 'SIRE'], RC: ['Registro de Compras', 'SIRE'], LDS: ['Libro Diario de Formato Simplificado', 'PLE'], LD: ['Libro Diario', 'PLE'], LM: ['Libro Mayor', 'PLE'], LCB: ['Libro Caja y Bancos', 'PLE'], LIB: ['Libro de Inventarios y Balances', 'PLE'] };
  const fyOf = y => D.find(T.fy, f => f.year === Number(y));
  /** ingresos netos del año: cuentas 70 y 75 de los asientos aprobados */
  function netRevenue(year, upTo) { const f = `${year}-01-01`, t = upTo || `${year}-12-31`; let v = 0; for (const { l, e } of approved()) { if (e.entry_date < f || e.entry_date > t) continue; const c = l.account_code; if (c.startsWith('70') || c.startsWith('75')) v += l.credit - l.debit; } return R(v); }
  /** cnt_books_regime(empresa, año) */
  function booksRegime(company, year, opts = {}) {
    const fy = fyOf(year) || {};
    const uit = Number(opts.uit ?? fy.uit_value_pen);
    if (!(uit > 0) || (!opts.uit && !fy.uit_confirmed_at)) G.fail('RN-CNT-13', `Falta el valor de la UIT de ${year} cargado y confirmado por la contadora (CNT-10): sin ese dato no se calcula el régimen de libros.`);
    const thr = Number(G.param('cnt_mype_books_threshold_uit') ?? 300);
    const revenue = R(Number(opts.revenue ?? (fy.revenue_pen != null && fy.revenue_pen !== '' ? fy.revenue_pen : netRevenue(year))));
    const limit = R(thr * uit);
    const result = revenue <= limit ? 'SIMPLIFIED' : 'FULL';
    const books = result === 'SIMPLIFIED' ? ['RV', 'RC', 'LDS'] : ['RV', 'RC', 'LD', 'LM', 'LCB', 'LIB'];
    return { company: company || 'co-dg', year: Number(year), uit, threshold_uit: thr, limit, revenue, result, books, revenue_source: opts.revenue != null ? 'dato de la prueba' : fy.revenue_pen != null && fy.revenue_pen !== '' ? 'cargado por la contadora' : 'cuentas 70 y 75 del año' };
  }
  function saveFiscalYear(d, opts = {}) {
    modOn();
    const user = opts.user || userId();
    if (!canU('cnt.account.manage', user)) G.fail('RN-CNT-13', 'La UIT y los ingresos del año los carga y confirma la contadora (cnt.account.manage).');
    const y = Number(d.year); if (!(y >= 2020 && y <= 2100)) throw new Error('Indica el año.');
    const uit = d.uit_value_pen === '' || d.uit_value_pen == null ? null : Number(d.uit_value_pen);
    if (uit != null && !(uit > 0)) throw new Error('La UIT debe ser mayor que cero.');
    const patch = { year: y, uit_value_pen: uit, revenue_pen: d.revenue_pen === '' || d.revenue_pen == null ? null : Number(d.revenue_pen), uit_source: d.uit_source || null, notes: d.notes || null, uit_confirmed_by: uit ? user : null, uit_confirmed_at: uit ? nowAt(opts) : null };
    const ex = fyOf(y); const r = ex ? upd(T.fy, ex.id, patch, G._seeding) : ins(T.fy, Object.assign({ company_id: 'co-dg' }, patch), G._seeding);
    if (uit) { try { const b = booksRegime('co-dg', y); upd(T.fy, r.id, { regime_result: b.result, books: b.books, calculated_at: nowAt(opts) }); } catch (e) { } }
    return r;
  }
  /** contenido de un libro: filas y huella */
  function bookRows(code, period) {
    const from = period, to = lastDay(period);
    if (code === 'RV') return systemSales(period).map(s => [F.date(s.date), s.type, s.series, s.number, s.cust || '', s.name, F.num(s.base, 2), F.num(s.igv, 2), F.num(s.total, 2)]);
    if (code === 'RC') return systemPurchases(period).map(s => [F.date(s.date), s.type, s.series, s.number, s.ruc, s.name, F.num(s.base, 2), F.num(s.igv, 2), F.num(s.total, 2)]);
    const ap = approved().filter(x => x.e.entry_date >= from && x.e.entry_date <= to);
    if (code === 'LDS') { const by = new Map(); for (const { l, e } of ap) { let r = by.get(e.id); if (!r) { r = { e, c: {} }; by.set(e.id, r); } const k = l.account_code.slice(0, 2); r.c[k] = (r.c[k] || 0) + l.debit - l.credit; } return [...by.values()].sort((a, b) => (a.e.seq || 0) - (b.e.seq || 0)).map(({ e, c }) => [e.number, F.date(e.entry_date), e.description, Object.entries(c).filter(([, v]) => Math.abs(v) > 0.004).map(([k, v]) => `${k}: ${F.num(v, 2)}`).join(' · ')]); }
    if (code === 'LD') return ap.sort((a, b) => (a.e.seq || 0) - (b.e.seq || 0) || a.l.seq - b.l.seq).map(({ l, e }) => [e.number, F.date(e.entry_date), e.description, l.account_code, accName(l.account_code), F.num(l.debit, 2), F.num(l.credit, 2)]);
    if (code === 'LCB') return ap.filter(x => x.l.account_code.startsWith('10')).map(({ l, e }) => [F.date(e.entry_date), e.number, l.account_code, e.description, F.num(l.debit, 2), F.num(l.credit, 2)]);
    const tb = trialBalance({ from, to }); return tb.map(r => [r.code, r.name, F.num(r.opening, 2), F.num(r.debit, 2), F.num(r.credit, 2), F.num(r.closing, 2)]);
  }
  function generateBook(d, opts = {}) {
    modOn();
    const user = opts.user || userId();
    if (!canU('cnt.report.view', user) && !canU('cnt.entry.prepare', user)) G.fail('RN-CNT-17', 'Generar libros exige cnt.report.view.');
    const period = G.date.month(d.period); const y = Number(period.slice(0, 4));
    const reg = booksRegime('co-dg', y);
    if (!reg.books.includes(d.book_code)) G.fail('RN-CNT-12', `${BOOKS[d.book_code] ? BOOKS[d.book_code][0] : d.book_code} no lo exige el régimen de ${y} (${LBL[reg.result][0].toLowerCase()}).`);
    let ple = null;
    if (d.format === 'TXT_PLE') {
      if (BOOKS[d.book_code][1] === 'SIRE') G.fail('RN-CNT-17', `${BOOKS[d.book_code][0]} se lleva en SIRE: no se exporta en PLE.`);
      const codes = G.param('cnt_ple_book_codes'); ple = codes && typeof codes === 'object' ? codes[d.book_code] : null;
      if (!ple) G.fail('RN-CNT-17', `Falta el código PLE de ${BOOKS[d.book_code][0]} en cnt_ple_book_codes: la contadora lo confirma antes de la primera exportación (D-CNT-05).`);
    }
    const rows = bookRows(d.book_code, period); const content = rows.map(r => r.join('|')).join('\n');
    const ext = d.format === 'PDF' ? 'pdf' : d.format === 'XLSX' ? 'xlsx' : 'txt';
    const fname = d.format === 'TXT_PLE' ? `LE${COMPANY().ruc}${period.slice(0, 4)}${period.slice(5, 7)}00${ple}00111.txt` : `${d.book_code}-${period.slice(0, 7)}.${ext}`;
    return ins(T.lx, { company_id: 'co-dg', book_code: d.book_code, book_name: BOOKS[d.book_code][0], period, format: d.format, ple_code: ple, file_name: fname, row_count: rows.length, hash: hash(content), generated_at: nowAt(opts), generated_by: user }, G._seeding);
  }
  Object.assign(CNT, { booksRegime, saveFiscalYear, netRevenue, generateBook, bookRows, BOOKS });

  /* =====================================================================
     Conciliación bancaria (RN-CNT-15)
     ===================================================================== */
  /** líneas aprobadas de la cuenta contable del banco en el período */
  function bookLines(caId, period) { const gl = cashGl(caId); const to = lastDay(period); return approved().filter(x => x.l.account_code === gl && x.e.entry_date >= period && x.e.entry_date <= to).map(x => ({ id: x.l.id, date: x.e.entry_date, amount: R(x.l.debit - x.l.credit), label: x.e.description, number: x.e.number, entry_id: x.e.id })); }
  function bookBalance(caId, upTo) { const gl = cashGl(caId); let v = 0; for (const { l, e } of approved()) if (l.account_code === gl && e.entry_date <= upTo) v += l.debit - l.credit; return R(v); }
  const recOf = (caId, period) => D.find(T.brc, r => r.cash_account_id === caId && r.period === period);
  const stmtLines = recId => D.where(T.bsl, l => l.reconciliation_id === recId).sort((a, b) => a.line_date.localeCompare(b.line_date) || a.seq - b.seq);
  function importStatement(d, opts = {}) {
    modOn();
    const user = opts.user || userId();
    if (!canU('cnt.entry.prepare', user)) G.fail('RN-CNT-21', 'Importar extractos exige cnt.entry.prepare.');
    const period = G.date.month(d.period); const ca = D.get('cash_accounts', d.cash_account_id); if (!ca) throw new Error('Elige la cuenta bancaria.');
    let rec = recOf(ca.id, period);
    if (rec && rec.status === 'CLOSED') G.fail('RN-CNT-15', 'La conciliación de ese mes ya está cerrada.');
    const opening = d.opening_balance != null ? Number(d.opening_balance) : bookBalance(ca.id, G.date.add(period, -1));
    if (!rec) rec = ins(T.brc, { company_id: 'co-dg', cash_account_id: ca.id, period, opening_balance: R(opening), statement_balance: R(opening), status: 'OPEN', file_name: d.file_name || null, imported_at: nowAt(opts), imported_by: user, closed_by: null, closed_at: null }, G._seeding);
    else { for (const l of stmtLines(rec.id)) D.remove(T.bsl, l.id); upd(T.brc, rec.id, { file_name: d.file_name || rec.file_name, imported_at: nowAt(opts), imported_by: user, opening_balance: R(opening) }); }
    let bal = R(opening);
    (d.lines || []).forEach((l, i) => { bal = R(bal + Number(l.amount)); ins(T.bsl, { reconciliation_id: rec.id, cash_account_id: ca.id, seq: i + 1, line_date: l.date, description: l.description, reference: l.reference || null, amount: R(Number(l.amount)), balance: bal, match_status: 'UNMATCHED', matched_line_id: null, matched_by: null }); });
    upd(T.brc, rec.id, { statement_balance: bal, line_count: (d.lines || []).length });
    autoMatch(rec.id);
    return D.get(T.brc, rec.id);
  }
  /** cruce automático: mismo importe y fecha a ±3 días (la referencia desempata) */
  function autoMatch(recId) {
    const rec = D.get(T.brc, recId); const sl = stmtLines(recId); const bl = bookLines(rec.cash_account_id, rec.period);
    const used = new Set(sl.filter(s => s.matched_line_id).map(s => s.matched_line_id)); let n = 0;
    const byAmt = U.groupBy(bl.filter(b => !used.has(b.id)), b => b.amount.toFixed(2));
    for (const s of sl) { if (s.matched_line_id) continue; const c = (byAmt[s.amount.toFixed(2)] || []).filter(b => !used.has(b.id) && Math.abs(G.date.diff(s.line_date, b.date)) <= 3); if (!c.length) continue; const pick = c.find(b => s.reference && b.label.includes(s.reference)) || c.sort((a, b) => Math.abs(G.date.diff(s.line_date, a.date)) - Math.abs(G.date.diff(s.line_date, b.date)))[0]; used.add(pick.id); s.matched_line_id = pick.id; s.match_status = 'MATCHED'; n++; }
    D.touch(); bump(); return n;
  }
  function manualMatch(stmtId, lineId, opts = {}) {
    const s = D.get(T.bsl, stmtId); if (!s) throw new Error('Línea del extracto no encontrada.');
    const rec = D.get(T.brc, s.reconciliation_id); if (rec.status === 'CLOSED') G.fail('RN-CNT-15', 'La conciliación está cerrada.');
    if (lineId && D.find(T.bsl, x => x.matched_line_id === lineId && x.id !== stmtId)) throw new Error('Ese movimiento contable ya está cruzado.');
    upd(T.bsl, stmtId, { matched_line_id: lineId || null, match_status: lineId ? 'MATCHED' : 'UNMATCHED', matched_by: opts.user || userId() });
  }
  function reconSummary(recId) {
    const rec = D.get(T.brc, recId); const sl = stmtLines(recId); const bl = bookLines(rec.cash_account_id, rec.period);
    const used = new Set(sl.map(s => s.matched_line_id).filter(Boolean));
    const transit = bl.filter(b => !used.has(b.id)); const bankOnly = sl.filter(s => !s.matched_line_id);
    const book = bookBalance(rec.cash_account_id, lastDay(rec.period));
    const transitSum = R(U.sum(transit, b => b.amount));
    const unexplained = R(rec.statement_balance - (book - transitSum));
    return { rec, statement: rec.statement_balance, book, transit, transitSum, bankOnly, bankOnlySum: R(U.sum(bankOnly, s => s.amount)), unexplained, matched: sl.length - bankOnly.length, lines: sl, bookLines: bl };
  }
  /** registra el cargo bancario que solo está en el extracto (comisiones, ITF) como asiento manual por aprobar */
  function bookBankCharge(stmtId, d = {}, opts = {}) {
    const s = D.get(T.bsl, stmtId); if (!s) throw new Error('Línea no encontrada.');
    const gl = cashGl(s.cash_account_id); const amt = Math.abs(s.amount); const acc = d.account_code || '6391'; const cc = d.cost_center_id || 'cc-FIN';
    const lines = s.amount < 0 ? prorate(amt, G.date.month(s.line_date)).map(p => ({ account_code: acc, debit: p.amount, credit: 0, cost_center_id: cc, brand_id: p.brand, description: s.description })).concat([{ account_code: gl, debit: 0, credit: amt, description: s.description }])
      : [{ account_code: gl, debit: amt, credit: 0, description: s.description }, { account_code: d.account_code || '7599', debit: 0, credit: amt, brand_id: 'br-DG', description: s.description }];
    const e = createManual({ entry_date: s.line_date, description: `Extracto ${(D.get('cash_accounts', s.cash_account_id) || {}).name || ''}: ${s.description}`, reference: s.reference, lines, submit: true, bank_line_id: s.id }, opts);
    upd(T.bsl, s.id, { booked_entry_id: e.id });
    return e;
  }
  function closeReconciliation(recId, opts = {}) {
    modOn();
    const user = opts.user || userId();
    if (!canU('cnt.entry.approve', user)) G.fail('RN-CNT-15', 'Cerrar la conciliación exige cnt.entry.approve (CONTADORA).');
    autoMatch(recId); const s = reconSummary(recId);
    if (Math.abs(s.unexplained) > 0.004) G.fail('RN-CNT-15', `No cierra: saldo del extracto ${F.money(s.statement)} ≠ saldo contable ${F.money(s.book)} − partidas en tránsito ${F.money(s.transitSum)}. Diferencia no explicada ${F.money(s.unexplained)}${s.bankOnly.length ? ` (${s.bankOnly.length} movimiento(s) del banco sin asiento aprobado)` : ''}.`);
    upd(T.brc, recId, { status: 'CLOSED', closed_by: user, closed_at: nowAt(opts), book_balance: s.book, in_transit: s.transitSum, unexplained_diff: 0 }, G._seeding);
  }
  Object.assign(CNT, { importStatement, autoMatch, manualMatch, reconSummary, bookBankCharge, closeReconciliation, bookLines, bookBalance });

  /* =====================================================================
     Cierre mensual (RN-CNT-07, RN-CNT-08)
     ===================================================================== */
  const TASKS = [
    ['DOCS_ENTRY', 'Comprobantes con asiento aprobado', true], ['INBOX_EMPTY', 'Bandeja de la contadora vacía', true], ['SIRE', 'SIRE de compras y ventas conciliado', true],
    ['BANKS', 'Bancos conciliados', true], ['PRODUCTION', 'Producción e inventario cerrados', true], ['FARM', 'Conciliación con la granja (enlace 4699)', false], ['FS', 'Estados financieros revisados', false],
  ];
  function ensureTasks(period) { const have = D.where(T.task, t => t.period === period); if (have.length >= TASKS.length) return have.sort((a, b) => a.seq - b.seq); TASKS.forEach(([code, name, auto], i) => { if (!have.find(t => t.code === code)) ins(T.task, { company_id: 'co-dg', period, seq: i + 1, code, name, auto_check: auto, status: 'PENDING', done_by: null, done_at: null, waive_reason: null, evidence: null, last_check: null }); }); return D.where(T.task, t => t.period === period).sort((a, b) => a.seq - b.seq); }
  /** verificación automática de una tarea: {ok, detail} */
  function checkTask(code, period) {
    const to = lastDay(period);
    if (code === 'DOCS_ENTRY') { const n = docsWithoutEntry({ from: period, to }).length; return { ok: !n, detail: n ? `${n} comprobante(s) sin asiento aprobado` : 'Todos los comprobantes tienen asiento aprobado' }; }
    if (code === 'INBOX_EMPTY') { const n = inboxOpen(period).length; return { ok: !n, detail: n ? `${n} ítem(s) abiertos en la bandeja` : 'Bandeja vacía' }; }
    if (code === 'SIRE') { const out = []; for (const reg of ['PURCHASES', 'SALES']) { const p = currentProposal(reg, period); if (!p) out.push(`falta la propuesta de ${reg === 'SALES' ? 'ventas' : 'compras'}`); else if (unresolved(p.id).length) out.push(`${unresolved(p.id).length} diferencia(s) en ${reg === 'SALES' ? 'ventas' : 'compras'}`); } return { ok: !out.length, detail: out.length ? out.join(' · ') : 'Ambos registros conciliados' }; }
    if (code === 'BANKS') { const out = []; for (const ca of D.where('cash_accounts', c => c.account_type === 'BANK')) { if (!bookLines(ca.id, period).length) continue; const r = recOf(ca.id, period); if (!r || r.status !== 'CLOSED') out.push(`${ca.name || ca.id}: ${r ? 'conciliación abierta' : 'sin extracto'}`); } return { ok: !out.length, detail: out.length ? out.join(' · ') : 'Cuentas bancarias conciliadas' }; }
    if (code === 'PRODUCTION') { const op = D.where('production_orders', o => !['CLOSED', 'CANCELLED', 'VOIDED'].includes(o.status) && (o.planned_date || o.created_at || '').slice(0, 10) <= to && (o.planned_date || o.created_at || '').slice(0, 10) >= period).length; const sc = D.where('stock_counts', c => c.status === 'OPEN' && day(c.created_at) <= to).length; return { ok: !op && !sc, detail: op || sc ? `${op} orden(es) de producción abiertas · ${sc} inventario(s) abiertos` : 'Sin órdenes ni inventarios abiertos' }; }
    if (code === 'FARM') { const r = D.find('farm_reconciliations', x => x.period === period); return { ok: !!r && ['CLOSED', 'APPROVED'].includes(r.status), detail: r ? 'Conciliación GRJ ' + (r.status || '') : 'Sin conciliación en GRJ: márcala con el acta firmada' }; }
    const bal = fsCompute('ESF', { from: '2026-01-01', to }); const ok = Math.abs((bal.find(x => x.code === 'AT') || {}).value - (bal.find(x => x.code === 'PP') || {}).value) < 0.01;
    return { ok, detail: ok ? 'Activo = pasivo + patrimonio' : 'El estado de situación no cuadra' };
  }
  function markTask(id, d = {}, opts = {}) {
    const t = D.get(T.task, id); if (!t) throw new Error('Tarea no encontrada.');
    const user = opts.user || userId();
    if (G.period.isClosed(t.period)) G.fail('RN-CNT-06', 'El período ya está cerrado.');
    if (d.waive) {
      if (!canU('cnt.period.close', user)) G.fail('RN-CNT-07', 'Dispensar una tarea exige cnt.period.close (CONTADORA).');
      if (String(d.reason || '').trim().length < 10) G.fail('RN-CNT-07', 'Dispensar una tarea exige un motivo de al menos 10 caracteres.');
      return upd(T.task, id, { status: 'WAIVED', waive_reason: d.reason, done_by: user, done_at: nowAt(opts) }, G._seeding);
    }
    if (!canU('cnt.entry.prepare', user)) G.fail('RN-CNT-21', 'Marcar tareas exige cnt.entry.prepare.');
    if (t.auto_check) { const c = checkTask(t.code, t.period); upd(T.task, id, { last_check: c.detail, last_check_at: nowAt(opts) }); if (!c.ok) G.fail('RN-CNT-07', `${t.name}: ${c.detail}.`); }
    else if (t.code === 'FS' && !checkTask('FS', t.period).ok) G.fail('RN-CNT-07', 'El estado de situación no cuadra: revísalo antes de marcar la tarea.');
    return upd(T.task, id, { status: 'DONE', done_by: user, done_at: nowAt(opts), evidence: d.evidence || null, waive_reason: null }, G._seeding);
  }
  function reopenTask(id) { const t = D.get(T.task, id); if (G.period.isClosed(t.period)) G.fail('RN-CNT-06', 'El período ya está cerrado.'); upd(T.task, id, { status: 'PENDING', done_by: null, done_at: null, waive_reason: null }); }
  function closeBlockers(period) {
    const out = [];
    const ts = ensureTasks(period).filter(t => !['DONE', 'WAIVED'].includes(t.status)); if (ts.length) out.push(`${ts.length} tarea(s) pendientes: ${ts.map(t => t.name).join(', ')}`);
    const es = D.where(T.je, e => e.period === period && ['DRAFT', 'PENDING_APPROVAL'].includes(e.status)); if (es.length) out.push(`${es.length} asiento(s) en borrador o por aprobar`);
    const ib = inboxOpen(period).length; if (ib) out.push(`${ib} ítem(s) en la bandeja`);
    return out;
  }
  /** cnt_close_period(período) */
  function closePeriod(period, opts = {}) {
    modOn();
    const user = opts.user || userId(); period = G.date.month(period);
    if (!canU('cnt.period.close', user)) G.fail('RN-CNT-07', `Cerrar el período exige cnt.period.close (CONTADORA); ${G.roleName(roleOf(user))} no cierra períodos (RN-CNT-21).`);
    const p = G.period.of(period); if (!p) throw new Error('Período no encontrado.'); if (p.status === 'CLOSED') throw new Error(`${pName(period)} ya está cerrado.`);
    const b = closeBlockers(period); if (b.length) G.fail('RN-CNT-07', `No se cierra ${pName(period)}: ${b.join(' · ')}.`);
    const prev = G.period.of(G.date.addMonths(period, -1)); if (prev && prev.status !== 'CLOSED') G.fail('RN-CNT-07', `Primero cierra ${pName(prev.period)}: los períodos se cierran en orden.`);
    const at = nowAt(opts);
    if (G.plt && G.plt.closePeriod && !G._seeding && period < G.date.month(G.TODAY)) { const prevRole = G.ctx.role; try { G.ctx.role = roleOf(user); G.plt.closePeriod(p.id, 'Cierre contable CNT-12'); } finally { G.ctx.role = prevRole; } }
    else { D.update('accounting_periods', p.id, { status: 'CLOSED', closed_at: at, closed_by: uName(user) }, { silent: G._seeding }); ins('accounting_period_events', { period_id: p.id, period, action: 'CLOSE', reason: 'Cierre contable CNT-12', acted_by: user, acted_by_name: uName(user), acted_at: at }); if (!G._seeding) G.events.emit('period.closed', { period_id: p.id, period, source: 'CNT' }); }
    D.update('accounting_periods', p.id, { closed_by_user: user, cnt_closed_at: at }, { silent: true });
    if (!G._seeding) G.audit('CERRAR_PERIODO', 'accounting_periods', p.id, pName(period));
    return G.period.of(period);
  }
  /** cnt_reopen_period(período, motivo) */
  function reopenPeriod(period, reason, opts = {}) {
    modOn();
    const user = opts.user || userId(); period = G.date.month(period);
    if (!canU('cnt.period.reopen', user)) G.fail('RN-CNT-08', `Reabrir exige cnt.period.reopen (CONTADORA o GERENTE).`);
    if (String(reason || '').trim().length < 10) G.fail('RN-CNT-08', 'Reabrir exige un motivo escrito de al menos 10 caracteres.');
    const p = G.period.of(period); if (!p || p.status !== 'CLOSED') throw new Error(`${pName(period)} no está cerrado.`);
    const later = D.find('accounting_periods', x => x.period > period && x.status === 'CLOSED' && (x.company_id || 'co-dg') === (p.company_id || 'co-dg')); if (later) G.fail('RN-CNT-08', `Reabre primero ${pName(later.period)} (posterior y cerrado).`);
    const at = nowAt(opts);
    if (G.plt && G.plt.reopenPeriod && !G._seeding && reason.trim().length >= (G.param('plt_parameter_reason_min_length') || 10)) { const prevRole = G.ctx.role; try { G.ctx.role = roleOf(user); G.plt.reopenPeriod(p.id, reason.trim()); } finally { G.ctx.role = prevRole; } }
    else { D.update('accounting_periods', p.id, { status: 'OPEN', reopened_at: at, reopened_by: uName(user), reopen_reason: reason.trim() }); ins('accounting_period_events', { period_id: p.id, period, action: 'REOPEN', reason: reason.trim(), acted_by: user, acted_by_name: uName(user), acted_at: at }); if (!G._seeding) G.events.emit('period.reopened', { period_id: p.id, period, reason }); }
    G.audit('REABRIR_PERIODO', 'accounting_periods', p.id, `${pName(period)} · ${reason.trim()}`);
    for (const t of D.where(T.task, t => t.period === period && t.code === 'FS')) upd(T.task, t.id, { status: 'PENDING', done_by: null, done_at: null });
    return G.period.of(period);
  }
  Object.assign(CNT, { ensureTasks, checkTask, markTask, reopenTask, closeBlockers, closePeriod, reopenPeriod });

  /* =====================================================================
     Planilla (CNT-15): resumen mensual de Ayni HR o archivo → asiento
     ===================================================================== */
  const ROLE_CC = { GERENTE: 'cc-ADM', ADMIN_SISTEMA: 'cc-ADM', ADMINISTRACION: 'cc-FIN', CONTADORA: 'cc-FIN', PRACTICANTE_CONTABLE: 'cc-FIN', RRHH: 'cc-RRHH', COMPRAS: 'cc-ADM', SUPERVISORA_VENTAS: 'cc-VEN-DG', CAJERO: 'cc-VEN-MOS', MARKETING: 'cc-MKT-DG', JEFE_PRODUCCION: 'cc-PROD-L2', CALIDAD: 'cc-CAL', COORDINADOR_DELIVERY: 'cc-DEL', REPARTIDOR: 'cc-DEL', PREPARADOR: 'cc-ALM-L1', VISITADOR_CONSIGNACION: 'cc-VEN-DG' };
  function empCc(emp) {
    const u = D.find('users', x => x.employee_id === emp.id);
    if (u) { if (u.role === 'VENDEDORA') return 'cc-VEN-' + String((u.brands || ['br-DG'])[0]).slice(3); if (u.role === 'ALMACENERO' || u.role === 'OPERARIO_PRODUCCION') return (u.role === 'ALMACENERO' ? 'cc-ALM-' : 'cc-PROD-') + (emp.establishment_id === 'es-L2' ? 'L2' : 'L1'); if (ROLE_CC[u.role]) return ROLE_CC[u.role]; if (u.role === 'AUDITOR') return null; }
    return /almac/i.test(emp.position || '') ? 'cc-ALM-' + (emp.establishment_id === 'es-L2' ? 'L2' : 'L1') : emp.establishment_id === 'es-L2' ? 'cc-PROD-L2' : 'cc-PROD-L1';
  }
  /** resumen por centro de costo (EsSalud 9 %, CTS 9,72 %, vacaciones 8,33 %, ONP 13 % retenida) */
  function payrollPreview(period) {
    const to = lastDay(period); const by = {};
    const perLines = G.per && G.per.importOf ? (() => { const imp = G.per.importOf(period); return imp ? D.where('payroll_cost_lines', l => l.exchange_id === imp.id) : null; })() : null;
    if (perLines && perLines.length) for (const l of perLines) { const k = l.cost_center_id; const x = by[k] = by[k] || { cost_center_id: k, employees: 0, gross: 0 }; x.employees++; x.gross += Number(l.gross_salary) || 0; }
    else for (const e of D.where('employees', e => e.status === 'ACTIVE' && (!e.hire_date || e.hire_date <= to) && Number(e.monthly_salary) > 0)) { const cc = empCc(e); if (!cc) continue; const x = by[cc] = by[cc] || { cost_center_id: cc, employees: 0, gross: 0 }; x.employees++; x.gross += Number(e.monthly_salary); }
    const lines = Object.values(by).sort(U.by('cost_center_id')).map(x => ({ cost_center_id: x.cost_center_id, employees: x.employees, gross: R(x.gross), essalud: R(x.gross * 0.09), cts: R(x.gross * 0.0972), vac: R(x.gross * 0.0833), pension: R(x.gross * 0.13) }));
    const s = k => R(U.sum(lines, l => l[k]));
    return { lines, source_hint: perLines && perLines.length ? 'AYNI_HR' : 'FILE', gross_total: s('gross'), essalud_total: s('essalud'), cts_total: s('cts'), vac_total: s('vac'), pension_total: s('pension'), net_total: R(s('gross') - s('pension')), employees: U.sum(lines, l => l.employees) };
  }
  function importPayroll(d, opts = {}) {
    modOn();
    const user = opts.user || userId();
    if (!canU('cnt.entry.prepare', user)) G.fail('RN-CNT-21', 'Importar la planilla exige cnt.entry.prepare.');
    const period = G.date.month(d.period);
    if (G.period.isClosed(period)) G.fail('RN-CNT-06', `El período ${pName(period)} está cerrado.`);
    const prev = D.find(T.pay, p => p.period === period && p.status !== 'VOIDED');
    if (prev) { const live = liveEntries('PAYROLL', prev.id); if (live.length) G.fail('RN-CNT-20', `La planilla de ${pName(period)} ya tiene el asiento ${live[0].number || 'por aprobar'}: revérsalo o anula la importación antes de importar otra.`); upd(T.pay, prev.id, { status: 'VOIDED' }); }
    const pv = payrollPreview(period);
    const imp = ins(T.pay, Object.assign({ company_id: 'co-dg', period, source: d.source || pv.source_hint, file_name: d.file_name || (d.source === 'AYNI_HR' ? null : `planilla-${period.slice(0, 7)}.xlsx`), imported_at: nowAt(opts), imported_by: user, status: 'IMPORTED', entry_id: null }, pv), G._seeding);
    const r = buildEntry('PAYROLL', imp.id, { user, at: opts.at });
    upd(T.pay, imp.id, { entry_id: r.entry ? r.entry.id : null, status: r.entry ? 'POSTED' : 'IMPORTED' });
    return D.get(T.pay, imp.id);
  }
  Object.assign(CNT, { payrollPreview, importPayroll });

  /* =====================================================================
     Balance de comprobación, mayor y estados financieros
     ===================================================================== */
  const lineOk = (l, o) => (!o.brand || l.brand_id === o.brand) && (!o.site || l.establishment_id === o.site);
  /** v_trial_balance */
  function trialBalance(o = {}) {
    const from = o.from || G.date.month(G.TODAY), to = o.to || G.TODAY; const m = new Map();
    for (const { l, e } of approved()) {
      if (e.entry_date > to || !lineOk(l, o)) continue;
      let r = m.get(l.account_code); if (!r) { r = { code: l.account_code, opening: 0, debit: 0, credit: 0 }; m.set(l.account_code, r); }
      if (e.entry_date < from) r.opening += l.debit - l.credit; else { r.debit += l.debit; r.credit += l.credit; }
    }
    return [...m.values()].map(r => Object.assign(r, { name: accName(r.code), opening: R(r.opening), debit: R(r.debit), credit: R(r.credit), closing: R(r.opening + r.debit - r.credit) })).sort(U.by('code'));
  }
  function ledger(code, o = {}) { const from = o.from || '0000', to = o.to || G.TODAY; const rows = approved().filter(x => x.l.account_code === code && x.e.entry_date <= to && lineOk(x.l, o)).sort((a, b) => a.e.entry_date.localeCompare(b.e.entry_date) || (a.e.seq || 0) - (b.e.seq || 0)); let opening = 0, run = 0; const out = []; for (const { l, e } of rows) { if (e.entry_date < from) { opening += l.debit - l.credit; continue; } if (!out.length) run = opening; run += l.debit - l.credit; out.push({ l, e, balance: R(run) }); } return { opening: R(opening), rows: out }; }
  const FS = {
    ESF: ['Estado de situación financiera', 'BALANCE', [['H1', 'Activo', 'HEADER'], ['A1', 'Efectivo y equivalentes de efectivo', 'ACC', ['10'], 1], ['A2', 'Cuentas por cobrar comerciales', 'ACC', ['12'], 1], ['A3', 'Otras cuentas por cobrar', 'ACC', ['16'], 1], ['A4', 'Existencias', 'ACC', ['20', '21', '23', '24', '25', '26'], 1], ['AC', 'Total activo corriente', 'SUM', ['A1', 'A2', 'A3', 'A4']], ['A5', 'Propiedades, planta y equipo (neto)', 'ACC', ['33', '39'], 1], ['AT', 'TOTAL ACTIVO', 'SUM', ['AC', 'A5']],
      ['H2', 'Pasivo y patrimonio', 'HEADER'], ['P1', 'Tributos por pagar', 'ACC', ['40'], -1], ['P2', 'Remuneraciones y beneficios por pagar', 'ACC', ['41'], -1], ['P3', 'Cuentas por pagar comerciales', 'ACC', ['42'], -1], ['P4', 'Otras cuentas por pagar (incluye enlace con la granja)', 'ACC', ['46'], -1], ['PT', 'Total pasivo', 'SUM', ['P1', 'P2', 'P3', 'P4']], ['E1', 'Capital', 'ACC', ['50'], -1], ['E2', 'Resultados acumulados', 'ACC', ['59'], -1], ['E3', 'Resultado del ejercicio', 'RESULT'], ['ET', 'Total patrimonio', 'SUM', ['E1', 'E2', 'E3']], ['PP', 'TOTAL PASIVO Y PATRIMONIO', 'SUM', ['PT', 'ET']]]],
    ERF: ['Estado de resultados por función', 'INCOME', [['F1', 'Ventas netas', 'ACC', ['70'], -1], ['F2', 'Costo de ventas', 'ACC', ['69'], -1], ['F3', 'Costo de producción del período', 'ACC', ['92'], -1], ['FB', 'Utilidad bruta', 'SUM', ['F1', 'F2', 'F3']], ['F4', 'Gastos de administración', 'ACC', ['94'], -1], ['F5', 'Gastos de ventas y marketing', 'ACC', ['951'], -1], ['F6', 'Gastos de distribución (reparto)', 'ACC', ['952'], -1], ['F7', 'Otros ingresos de gestión', 'ACC', ['75'], -1], ['FR', 'Resultado de operación', 'SUM', ['FB', 'F4', 'F5', 'F6', 'F7']]]],
    ERN: ['Estado de resultados por naturaleza', 'INCOME', [['N1', 'Ventas netas', 'ACC', ['70'], -1], ['N2', 'Otros ingresos de gestión', 'ACC', ['75'], -1], ['N3', 'Compras', 'ACC', ['60'], -1], ['N4', 'Variación de existencias', 'ACC', ['61'], -1], ['N5', 'Costo de ventas (inventario permanente)', 'ACC', ['69'], -1], ['N6', 'Gastos de personal', 'ACC', ['62'], -1], ['N7', 'Servicios prestados por terceros', 'ACC', ['63'], -1], ['N8', 'Tributos', 'ACC', ['64'], -1], ['N9', 'Otros gastos de gestión', 'ACC', ['65'], -1], ['N10', 'Depreciación', 'ACC', ['68'], -1], ['NR', 'Resultado del período', 'SUM', ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9', 'N10']]]],
  };
  const fsLines = code => { const t = D.find(T.fst, x => x.code === code); return t ? D.where(T.fsl, l => l.template_id === t.id).sort(U.by('seq')) : FS[code][2].map((x, i) => ({ seq: i + 1, code: x[0], label: x[1], kind: x[2], refs: x[3] || [], sign: x[4] || 1 })); };
  /** calcula una plantilla de estado financiero sobre las líneas aprobadas */
  function fsCompute(code, o = {}) {
    const bal = String(code) === 'ESF'; const to = o.to || G.TODAY; const from = bal ? '0000' : (o.from || G.date.month(to));
    const sums = new Map(); let result = 0; const yStart = to.slice(0, 4) + '-01-01';
    for (const { l, e } of approved()) {
      if (e.entry_date > to || e.entry_date < from || (!bal && !lineOk(l, o))) continue;
      const v = l.debit - l.credit; const c = l.account_code;
      for (let k = 2; k <= c.length; k++) { const p = c.slice(0, k); sums.set(p, (sums.get(p) || 0) + v); }
      if (bal && e.entry_date >= yStart && (c[0] === '6' || (c[0] === '7' && !c.startsWith('79')))) result -= v;
    }
    const vals = {}; const out = [];
    for (const ln of fsLines(code)) {
      let v = null;
      if (ln.kind === 'ACC') v = R(U.sum(ln.refs, p => sums.get(p) || 0) * ln.sign);
      else if (ln.kind === 'SUM') v = R(U.sum(ln.refs, r => vals[r] || 0));
      else if (ln.kind === 'RESULT') v = R(result);
      vals[ln.code] = v; out.push({ code: ln.code, label: ln.label, kind: ln.kind, value: v, refs: ln.refs });
    }
    return out;
  }
  Object.assign(CNT, { trialBalance, ledger, fsCompute });

  /* ---------- indicadores KPI-CNT-01 a 06 ---------- */
  const inP = (d, p) => { const x = day(d); return x >= (p.from || '0000') && x <= (p.to || '9999'); };
  G.kpiCalc['KPI-CNT-01'] = p => { const n = docsWithoutEntry({ from: p.from, to: p.to, brand: p.brand, site: p.site }).length; return { value: n, numerator: n, denominator: null }; };
  G.kpiCalc['KPI-CNT-02'] = p => D.where(T.je, e => e.status === 'PENDING_APPROVAL' && inP(e.entry_date, p) && (!p.brand || !e.brand_id || e.brand_id === p.brand)).length;
  G.kpiCalc['KPI-CNT-03'] = p => { const per = new Set(); for (let m = G.date.month(p.from || G.TODAY); m <= (p.to || G.TODAY); m = G.date.addMonths(m, 1)) per.add(m); const props = D.where(T.sp, x => per.has(x.period) && !x.superseded); return U.sum(props, x => unresolved(x.id).length); };
  G.kpiCalc['KPI-CNT-04'] = p => { const ps = D.where('accounting_periods', x => x.status === 'CLOSED' && x.closed_at && (x.company_id || 'co-dg') === 'co-dg'); const inR2 = ps.filter(x => x.period >= G.date.month(p.from || '0000') && x.period <= (p.to || '9999')); const use = inR2.length ? inR2 : ps.sort(U.by('period', -1)).slice(0, 1); const ds = use.map(x => G.date.diff(day(x.cnt_closed_at || x.closed_at), lastDay(x.period))); return { value: ds.length ? R(U.sum(ds) / ds.length, 1) : 0, numerator: R(U.sum(ds), 1), denominator: ds.length }; };
  G.kpiCalc['KPI-CNT-05'] = p => { const es = D.where('expenses', e => ['APPROVED', 'PAID', 'SUBMITTED'].includes(e.status) && inP(e.issue_date, p) && (!p.brand || e.brand_id === p.brand)); const ds = D.where('purchase_documents', d => d.status !== 'VOIDED' && d.doc_type !== 'INTERNAL_TRANSFER' && inP(d.accounting_date, p)); const bad = U.sum(es.filter(e => e.accounting_flag === 'NO_VALID_RECEIPT' || ['TICKET', 'SIMPLE_RECEIPT', 'MOBILITY_SHEET', 'NONE'].includes(e.doc_type)), e => e.amount_pen || 0) + U.sum(ds.filter(d => d.doc_type === 'RECEIPT' || (!d.igv_is_credit && ['INVOICE'].includes(d.doc_type))), d => d.total * (d.exchange_rate || 1)); const tot = U.sum(es, e => e.amount_pen || 0) + U.sum(ds, d => d.total * (d.exchange_rate || 1)); return { value: tot ? R(bad / tot * 100, 1) : 0, numerator: R(bad), denominator: R(tot) }; };
  G.kpiCalc['KPI-CNT-06'] = p => { const ref = p.to || G.TODAY; const max = Number(G.param('cnt_inbox_max_age_days') ?? 3); return D.where(T.inbox, x => ['PENDING', 'CLASSIFIED'].includes(x.status) && G.date.diff(ref, day(x.created_at)) > max).length; };

  /* ---------- eventos: asientos automáticos al vuelo ---------- */
  function onEvent(kind, idOf) { return pl => { try { if (!G.modOn(MOD) || G._seeding) return; const id = idOf(pl); if (!id) return; const f = FACTS[kind](id); if (!f) return; if (f.skip) { if (f.void) for (const e of liveEntries(kind, id)) { if (e.status === 'APPROVED' && !G.period.isClosed(G.TODAY)) reverseEntry(e.id, 'Documento de origen anulado o revertido', { user: null, auto: true }); else if (e.status !== 'APPROVED') voidEntry(e.id, 'Documento de origen anulado', { user: null }); } return; } if (G.period.isClosed(f.date) || liveEntries(kind, id).length || openInbox(kind, id)) return; buildEntry(kind, id, {}); } catch (e) { if (!(e instanceof G.RuleError)) console.warn('CNT', kind, e); } }; }
  G.events.on('document.issued', onEvent('SALE', p => p.document_id));
  G.events.on('payment.confirmed', onEvent('COLLECTION', p => p.payment_id));
  G.events.on('payment.reversed', onEvent('COLLECTION', p => p.payment_id));
  G.events.on('purchase_document.registered', onEvent('PURCHASE', p => p.document_id));
  G.events.on('supplier_payment.registered', onEvent('SUPPLIER_PAYMENT', p => p.payment_id));
  G.events.on('expense.approved', onEvent('EXPENSE', p => p.expense_id));
  G.events.on('production_order.closed', p => { onEvent('CONSUMPTION', x => x.order_id)(p); onEvent('PRODUCTION', x => x.order_id)(p); });
  G.events.on('stock.moved', p => { if (['WASTE', 'ADJUSTMENT'].includes(p.type)) onEvent('INV_ADJUSTMENT', x => x.movement_id)(p); });

  /* =====================================================================
     Interfaz: piezas comunes
     ===================================================================== */
  const ui = CNT._ui = CNT._ui || {};
  const periods = () => D.where('accounting_periods', p => (p.company_id || 'co-dg') === 'co-dg').sort(U.by('period', -1));
  const monthOpts = () => periods().map(p => [p.period, pName(p.period) + (p.status === 'CLOSED' ? ' · cerrado' : '')]);
  const firstOpen = () => (periods().slice().reverse().find(p => p.status !== 'CLOSED') || {}).period || G.date.month(G.TODAY);
  function periodSel(key, def) { const v = ui[key] || def || G.date.month(G.TODAY); const s = h('select', { class: 'input', style: 'width:auto;max-width:100%', attrs: { 'aria-label': 'Período' }, on: { change: e => { ui[key] = e.target.value; G.refresh(); } } }, monthOpts().map(([p, l]) => h('option', { value: p, selected: p === v }, l))); return { value: v, el: s }; }
  const accOpts = (pred = a => a.postable && a.status !== 'INACTIVE') => D.where(T.acc, pred).sort(U.by('code')).map(a => [a.code, `${a.code} · ${a.name}`]);
  const ccOpts = () => G.ui.opts('cost_centers', c => `${c.code} · ${c.name}`);
  const brandOpts = () => G.ui.opts('brands', b => b.name.split(' · ')[0]);
  const siteOpts = () => G.ui.opts('establishments', e => e.short || e.name);
  const minw = el => { el.style.minWidth = '0'; return el; };
  const money0 = v => v ? F.money(v) : '';
  function promptReason(title, fn, opts = {}) { modal(title, (b, close) => { if (opts.help) b.append(notice(opts.help, 'info')); b.append(form({ id: 'cntwhy', fields: [{ key: 'r', label: opts.label || 'Motivo', type: 'textarea', required: true }].concat(opts.extra || []), submitLabel: opts.submit || 'Confirmar', onCancel: close, onSubmit: v => { try { fn(v.r, v); close(); G.refresh(); return true; } catch (e) { return e.message; } } })); }); }
  function linesTable(ls, opts = {}) {
    const td = R(U.sum(ls, l => l.debit)), tc = R(U.sum(ls, l => l.credit));
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Cuenta', 'Glosa', 'C. costo', 'Marca', 'Tercero', 'Debe', 'Haber'].map((x, i) => h('th', { class: i > 4 ? 'r' : '' }, x)))),
      h('tbody', null, ls.map(l => h('tr', { class: l.is_destination ? 'muted' : '' }, h('td', { class: 'mono' }, l.account_code ? h('span', { title: accName(l.account_code) }, l.account_code, ' ', h('span', { class: 'small muted' }, accName(l.account_code).slice(0, 28))) : badge('Falta la cuenta', 'bad')), h('td', { class: 'small' }, (l.description || '').slice(0, 70)), h('td', { class: 'small' }, l.cost_center_id ? (ccRow(l.cost_center_id) || {}).code : '—'), h('td', { class: 'small' }, l.brand_id ? G.brandName(l.brand_id) : '—'), h('td', { class: 'small' }, l.third_party_doc ? `${l.third_party_doc}${l.third_party_name ? ' · ' + String(l.third_party_name).slice(0, 18) : ''}` : '—'), h('td', { class: 'r' }, money0(l.debit)), h('td', { class: 'r' }, money0(l.credit))))),
      h('tfoot', null, h('tr', null, h('td', { attrs: { colspan: 5 } }, Math.abs(td - tc) > 0.004 ? badge(`No cuadra: diferencia ${F.money(R(td - tc))}`, 'bad') : badge('Cuadra', 'ok')), h('td', { class: 'r' }, h('b', null, F.money(td))), h('td', { class: 'r' }, h('b', null, F.money(tc)))))));
  }
  function entryDrawer(id) {
    const e = D.get(T.je, id); if (!e) return;
    drawer(`Asiento ${e.number || '(sin número)'}`, (b, close) => {
      const re = () => { close(); entryDrawer(id); };
      const me = userId(); const acts = h('div', { class: 'row' });
      if (['DRAFT', 'PENDING_APPROVAL'].includes(e.status) && !e.blocked) acts.append(btn('Aprobar', () => tryDo(() => approveEntry(id), r => `Asiento aprobado · ${r.number}`) && re(), { sm: true, kind: 'primary', disabled: !G.can('cnt.entry.approve') || sameUser(e.prepared_by, me), title: sameUser(e.prepared_by, me) ? 'RN-CNT-02: quien prepara no aprueba' : null }));
      if (e.status === 'DRAFT' && !e.blocked) acts.append(btn('Enviar a aprobación', () => tryDo(() => submitEntry(id), 'Enviado a aprobación') && re(), { sm: true, disabled: !G.can('cnt.entry.prepare') }));
      if (e.status === 'APPROVED' && !e.reversed_by_id && !e.reversal_of) acts.append(btn('Reversar', () => promptReason('Reversar ' + e.number, r => { const x = reverseEntry(id, r); toast(`Reverso registrado (${x.number || 'por aprobar'})`, 'ok'); close(); }, { help: 'RN-CNT-03: un asiento aprobado no se modifica; se corrige con un asiento de reverso que también se aprueba.' }), { sm: true, kind: 'danger', disabled: !G.can('cnt.entry.prepare') }));
      if (['DRAFT', 'PENDING_APPROVAL'].includes(e.status)) acts.append(btn('Anular borrador', () => promptReason('Anular asiento', r => { voidEntry(id, r); toast('Asiento anulado', 'ok'); close(); }), { sm: true, disabled: !G.can('cnt.entry.prepare') }));
      if (e.blocked) acts.append(btn('Ver en la bandeja (CNT-05)', () => { close(); G.go('CNT-05'); }, { sm: true, kind: 'accent' }));
      const src = e.source_kind && FACTS[e.source_kind] ? (() => { try { return FACTS[e.source_kind](e.source_id); } catch (x) { return null; } })() : null;
      if (src && src.go) acts.append(btn('Ver documento de origen', () => { close(); src.go(); }, { sm: true, kind: 'ghost' }));
      b.append(acts);
      if (e.status === 'APPROVED') b.append(notice('RN-CNT-03: asiento aprobado e inmutable. Para corregirlo, regístrale un reverso.', 'info'));
      if (e.blocked) b.append(notice(`Retenido: ${(e.blocked_reasons || []).map(r => REASONS[r]).join(' · ')}. La practicante lo clasifica en la bandeja y la contadora lo aprueba.`, 'bad'));
      if (sameUser(e.prepared_by, me) && e.status !== 'APPROVED') b.append(notice('RN-CNT-02: preparaste este asiento; lo aprueba otra persona con cnt.entry.approve.', 'warn'));
      b.append(dl([['Estado', st(dispStatus(e))], ['Número', e.number || 'Se asigna al aprobar (RN-CNT-14)'], ['Fecha', F.date(e.entry_date)], ['Período', pName(e.period)], ['Origen', `${srcName(e.source_type)}${e.source_subtype && e.source_subtype !== '*' ? ' · ' + subName(e.source_type, e.source_subtype) : ''}`], ['Documento', e.source_label || '—'], ['Regla', e.rule_code || 'Manual'], ['Glosa', e.description], ['Preparó', e.prepared_by ? G.userName(e.prepared_by) : 'Sistema (regla)'], ['Aprobó', e.auto_approved ? 'Regla con auto_approve (D-CNT-06)' : e.approved_by ? `${G.userName(e.approved_by)} · ${F.datetime(e.approved_at)}` : '—'], ['Moneda', e.currency !== 'PEN' ? `${e.currency} ${F.num(e.fx_total, 2)} × ${F.num(e.exchange_rate, 3)} (RN-CNT-19)` : 'Soles'], e.reversal_of ? ['Reversa a', (D.get(T.je, e.reversal_of) || {}).number] : null, e.reversed_by_id ? ['Reversado por', (D.get(T.je, e.reversed_by_id) || {}).number || 'reverso por aprobar'] : null]));
      b.append(card('Líneas', linesTable(linesOf(id)), { flush: true }));
      b.append(card('Historial', h('div', { class: 'timeline' }, (e.history || []).map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.datetime(x.at)), h('span', { class: 'dot' }), h('div', null, h('b', null, x.action), h('div', { class: 'muted small' }, x.user)))))));
    }, { code: 'CNT-03', wide: true });
  }
  CNT.openEntry = entryDrawer;
  const entryCols = [
    { key: 'number', label: 'Número', mono: true, value: e => e.number || '' , render: e => e.number || h('span', { class: 'muted small' }, 'sin número') },
    { key: 'entry_date', label: 'Fecha', render: e => F.date(e.entry_date) },
    { key: 'src', label: 'Origen', value: e => srcName(e.source_type) },
    { key: 'description', label: 'Glosa', value: e => e.description, render: e => h('span', { class: 'small' }, String(e.description || '').slice(0, 70)) },
    { key: 'brand', label: 'Marca', value: e => e.brand_id ? G.brandName(e.brand_id) : '' },
    { key: 'total_debit', label: 'Importe', align: 'r', render: e => F.money(e.total_debit) },
    { key: 'status', label: 'Estado', value: e => dispStatus(e), render: e => st(dispStatus(e)) },
  ];

  /* ---------- CNT-01 Plan de cuentas ---------- */
  function scrAccounts(el) {
    const can = G.can('cnt.account.manage');
    const body = page(el, { code: 'CNT-01', title: 'Plan de cuentas', sub: 'PCGE de la empresa: qué cuentas reciben movimientos, cuáles exigen centro de costo, tercero o marca, y su amarre a la clase 9 y a la 79.', actions: [{ label: 'Nueva cuenta', kind: 'primary', icon: '+', disabled: !can, title: can ? null : 'Exige cnt.account.manage (CONTADORA)', onClick: () => accForm(null) }] });
    const all = D.all(T.acc); const tb = new Map(trialBalance({ from: '0000-01-01', to: G.TODAY }).map(r => [r.code, r.closing]));
    const bal = a => a.postable ? (tb.get(a.code) || 0) : R(U.sum([...tb.entries()].filter(([k]) => k.startsWith(a.code)), ([, v]) => v));
    body.append(kpis([{ label: 'Cuentas', value: all.length }, { label: 'Reciben movimientos', value: all.filter(a => a.postable).length }, { label: 'Exigen centro de costo', value: all.filter(a => a.requires_cost_center).length }, { label: 'Exigen tercero', value: all.filter(a => a.requires_third_party).length }, { label: 'Con amarre a clase 9', value: all.filter(a => a.dest_debit_code).length }]));
    body.append(table({ id: 'cnt01', rows: all.sort(U.by('code')), onRow: a => accDrawer(a.code), pageSize: 60, searchPlaceholder: 'Código o nombre…',
      filters: [{ key: 'cls', label: 'Clase', options: '123456789'.split('').map(c => [c, 'Clase ' + c]), value: a => a.code[0] }, { key: 'acc_type', label: 'Tipo', options: ACC_TYPES }, { key: 'postable', label: 'Movimiento', options: [['true', 'Recibe movimientos'], ['false', 'De título']], value: a => String(!!a.postable) }],
      columns: [{ key: 'code', label: 'Código', mono: true, render: a => h('span', { style: `padding-left:${(a.level - 1) * 12}px;${a.postable ? '' : 'font-weight:700'}` }, a.code) }, { key: 'name', label: 'Nombre', render: a => h('span', { style: a.postable ? '' : 'font-weight:700' }, a.name) }, { key: 'nature', label: 'Naturaleza', value: a => a.nature === 'DEBIT' ? 'Deudora' : 'Acreedora' }, { key: 'flags', label: 'Exige', value: a => [a.requires_cost_center ? 'C. costo' : '', a.requires_third_party ? 'Tercero' : '', a.requires_brand ? 'Marca' : ''].filter(Boolean).join(' · ') }, { key: 'dest', label: 'Amarre', value: a => a.dest_debit_code ? `${a.dest_debit_code === 'CC' ? '9x según área' : a.dest_debit_code} / ${a.dest_credit_code}` : '' }, { key: 'bal', label: 'Saldo', align: 'r', value: a => bal(a), render: a => { const v = bal(a); return Math.abs(v) > 0.004 ? F.money(v) : ''; } }] }));
    body.append(notice('D-CNT-04: inventario permanente con reglas de demostración (consumo 23 ← 24, producción 21 ← 23, costo de ventas 692 ← 21). La contadora las ajusta. «9x según área»: el destino lo decide el área del centro de costo (producción 921, administración 941, ventas 951, reparto 952).', 'info'));
  }
  function accDrawer(code) {
    const a = acct(code); if (!a) return;
    drawer(`${a.code} · ${a.name}`, (b, close) => {
      if (G.can('cnt.account.manage')) b.append(h('div', { class: 'row' }, btn('Editar', () => { close(); accForm(a); }, { sm: true, kind: 'primary' }), btn(a.status === 'INACTIVE' ? 'Activar' : 'Desactivar', () => tryDo(() => { if (a.status !== 'INACTIVE' && Math.abs(U.sum(trialBalance({ from: '0000-01-01' }).filter(r => r.code.startsWith(a.code)), r => r.closing)) > 0.004) throw new Error('La cuenta tiene saldo: no se desactiva.'); upd(T.acc, a.id, { status: a.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE' }, false); }, 'Cuenta actualizada') && (close(), accDrawer(code)), { sm: true })));
      b.append(dl([['Tipo', lbl(ACC_TYPES, a.acc_type)], ['Naturaleza', a.nature === 'DEBIT' ? 'Deudora' : 'Acreedora'], ['Recibe movimientos', a.postable ? 'Sí' : 'No (cuenta de título)'], ['Exige centro de costo', a.requires_cost_center ? 'Sí' : 'No'], ['Exige tercero', a.requires_third_party ? 'Sí' : 'No'], ['Exige marca (RN-CNT-16)', a.requires_brand ? 'Sí' : 'No'], ['Amarre al debe', a.dest_debit_code ? (a.dest_debit_code === 'CC' ? 'Clase 9 según el área del centro de costo' : accLbl(a.dest_debit_code)) : '—'], ['Amarre al haber', a.dest_credit_code ? accLbl(a.dest_credit_code) : '—'], ['Estado', st(a.status || 'ACTIVE')]]));
      if (a.postable) { const lg = ledger(code, { from: G.date.month(G.TODAY) }); b.append(card(`Mayor de ${pName(G.TODAY)} (saldo inicial ${F.money(lg.opening)})`, lg.rows.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('tbody', null, lg.rows.slice(-15).reverse().map(x => h('tr', { class: 'click', on: { click: () => { close(); entryDrawer(x.e.id); } } }, h('td', { class: 'mono' }, x.e.number), h('td', null, F.date(x.e.entry_date)), h('td', { class: 'small' }, String(x.e.description).slice(0, 40)), h('td', { class: 'r' }, money0(x.l.debit)), h('td', { class: 'r' }, money0(x.l.credit)), h('td', { class: 'r' }, F.money(x.balance))))))) : empty('Sin movimientos aprobados este mes.'), { flush: true })); }
    }, { code: 'CNT-01' });
  }
  function accForm(a) {
    drawer(a ? 'Editar ' + a.code : 'Nueva cuenta', (b, close) => {
      b.append(form({ id: 'cntacc', values: a ? Object.assign({}, a, { dest: a.dest_debit_code || '' }) : { postable: true }, fields: [
        { key: 'code', label: 'Código', required: true, disabled: !!a, help: 'Debe colgar de una cuenta existente (p. ej. 6365 cuelga de 636).' }, { key: 'name', label: 'Nombre', required: true, span: 2 },
        { key: 'postable', label: 'Recibe movimientos', type: 'checkbox' }, { key: 'requires_cost_center', label: 'Exige centro de costo', type: 'checkbox' }, { key: 'requires_third_party', label: 'Exige tercero', type: 'checkbox' }, { key: 'requires_brand', label: 'Exige marca', type: 'checkbox' },
        { key: 'dest', label: 'Amarre al debe', type: 'select', options: [['CC', 'Clase 9 según área del centro de costo']].concat(accOpts(x => x.postable && (x.code[0] === '9' || '2'.includes(x.code[0])))) }, { key: 'dest_credit_code', label: 'Amarre al haber', type: 'select', options: accOpts(x => x.postable && (x.code.startsWith('79') || x.code.startsWith('61'))) }],
        submitLabel: a ? 'Guardar' : 'Crear cuenta', onCancel: close, onSubmit: v => {
          if (!G.can('cnt.account.manage')) return 'Editar el plan de cuentas exige cnt.account.manage (CONTADORA).';
          const code = String(v.code || '').trim(); if (!/^\d{2,8}$/.test(code)) return { code: 'Solo dígitos (2 a 8).' };
          if (!a && acct(code)) return { code: 'Ya existe.' };
          const parent = code.length > 2 ? [...Array(code.length - 2).keys()].map(i => code.slice(0, code.length - 1 - i)).find(p => acct(p)) : null;
          if (code.length > 2 && !parent) return { code: 'No existe la cuenta de título de la que cuelga.' };
          if (parent && acct(parent).postable && !a) return { code: `La cuenta ${parent} recibe movimientos: no puede tener subcuentas.` };
          if (a && a.postable && !v.postable && approved().some(x => x.l.account_code === code)) return 'RN-CNT-05: la cuenta ya tiene movimientos; no puede volverse de título.';
          if (a && !a.postable && v.postable && D.find(T.acc, x => x.code !== code && x.code.startsWith(code))) return 'RN-CNT-05: tiene subcuentas; una cuenta de título no recibe movimientos.';
          if (!!v.dest !== !!v.dest_credit_code) return 'El amarre necesita la cuenta del debe y la del haber.';
          const row = { name: v.name, postable: !!v.postable, requires_cost_center: !!v.requires_cost_center, requires_third_party: !!v.requires_third_party, requires_brand: !!v.requires_brand, dest_debit_code: v.dest || null, dest_credit_code: v.dest_credit_code || null };
          if (a) upd(T.acc, a.id, row, false); else ins(T.acc, Object.assign({ company_id: 'co-dg', code, parent_code: parent, level: code.length <= 2 ? 1 : code.length - 1, acc_type: accType(code), nature: accNature(code), status: 'ACTIVE' }, row), false);
          toast(a ? 'Cuenta actualizada' : 'Cuenta creada', 'ok'); close(); G.refresh(); return true;
        } }));
    }, { code: 'CNT-01' });
  }

  /* ---------- CNT-02 Reglas de asiento ---------- */
  const sampleFor = src => { const m = { SALE: ['SALE', 'sales_documents', d => isValidSale(d) && d.doc_type === 'INVOICE'], PURCHASE: ['PURCHASE', 'purchase_documents', d => d.doc_type === 'INVOICE' && d.status !== 'VOIDED' && d.match_status !== 'OBSERVED'], NTI: ['PURCHASE', 'purchase_documents', d => d.doc_type === 'INTERNAL_TRANSFER'], EXPENSE: ['EXPENSE', 'expenses', e => ['APPROVED', 'PAID'].includes(e.status)], COLLECTION: ['COLLECTION', 'payments', p => p.status === 'CONFIRMED' && p.cash_account_id], PAYMENT: ['SUPPLIER_PAYMENT', 'supplier_payments', p => p.status === 'CONFIRMED'], PAYROLL: ['PAYROLL', T.pay, () => true], COGS: ['COGS', null], INV_ADJUSTMENT: ['INV_ADJUSTMENT', 'stock_movements', m => ['WASTE', 'ADJUSTMENT'].includes(m.movement_type) && m.total_cost] }[src]; if (!m) return null; if (src === 'COGS') { const k = [...cogsGroups().keys()].pop(); return k ? ['COGS', k] : null; } const r = D.find(m[1], m[2]); return r ? [m[0], r.id] : null; };
  function scrRules(el) {
    const can = G.can('cnt.rule.manage');
    const body = page(el, { code: 'CNT-02', title: 'Reglas de asiento', sub: 'Por origen y subtipo: qué cuenta va al debe y al haber y qué importe toma (base, IGV, total, costo o detalle por línea). Las reglas de ventas, cobros y costo de ventas se aprueban solas (D-CNT-06).', actions: [{ label: 'Nueva regla', kind: 'primary', icon: '+', disabled: !can, title: can ? null : 'RN-CNT-21: solo la contadora crea y aprueba reglas', onClick: () => ruleForm(null) }] });
    const rs = D.all(T.rule).sort((a, b) => a.source.localeCompare(b.source) || a.code.localeCompare(b.code));
    const noRule = D.where(T.inbox, x => x.reason === 'NO_RULE' && ['PENDING', 'CLASSIFIED', 'RETURNED'].includes(x.status));
    body.append(kpis([{ label: 'Reglas vigentes', value: rs.filter(r => r.status === 'ACTIVE').length }, { label: 'Con auto_approve', value: rs.filter(r => r.status === 'ACTIVE' && r.auto_approve).length, sub: 'ventas, cobros y costo de ventas' }, { label: 'Borradores', value: rs.filter(r => r.status === 'DRAFT').length }, { label: 'Documentos sin regla', value: noRule.length, tone: noRule.length ? 'warn' : 'ok', sub: 'RN-CNT-09 · en la bandeja', onClick: () => G.go('CNT-05') }]));
    body.append(table({ id: 'cnt02', rows: rs, onRow: r => ruleDrawer(r.id), filters: [{ key: 'source', label: 'Origen', options: SOURCES.slice(0, 11) }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Vigente'], ['DRAFT', 'Borrador'], ['INACTIVE', 'Inactiva']] }],
      columns: [{ key: 'code', label: 'Regla', mono: true }, { key: 'source', label: 'Origen', value: r => srcName(r.source) }, { key: 'subtype', label: 'Subtipo', value: r => subName(r.source, r.subtype) }, { key: 'name', label: 'Nombre' }, { key: 'lines', label: 'Debe / Haber', value: r => ruleLines(r.id).map(l => `${l.side} ${l.account_from === 'FIXED' ? l.account_code : lbl(ACC_FROM, l.account_from).split(' ')[0].toLowerCase() + '…'}`).join(' · ') }, { key: 'auto_approve', label: 'Aprobación', value: r => r.auto_approve ? 'Automática' : 'Contadora' }, { key: 'status', label: 'Estado', render: r => st(r.status) }] }));
    if (noRule.length) body.append(notice(`RN-CNT-09: ${noRule.length} documento(s) sin regla vigente esperan en la bandeja (${[...new Set(noRule.map(x => x.ref_label.split(' ')[0]))].slice(0, 4).join(', ')}). No se pierden: la contadora crea la regla o clasifica cada uno.`, 'warn'));
  }
  function ruleDrawer(id) {
    const r = D.get(T.rule, id); if (!r) return;
    drawer(`${r.code} · ${r.name}`, (b, close) => {
      const can = G.can('cnt.rule.manage'); const acts = h('div', { class: 'row' });
      if (can) { acts.append(btn('Editar', () => { close(); ruleForm(r); }, { sm: true, kind: 'primary' })); if (r.status !== 'ACTIVE') acts.append(btn('Aprobar y activar', () => tryDo(() => setRuleStatus(id, 'ACTIVE'), 'Regla vigente') && (close(), ruleDrawer(id)), { sm: true, kind: 'accent' })); else acts.append(btn('Desactivar', () => tryDo(() => setRuleStatus(id, 'INACTIVE'), 'Regla desactivada') && (close(), ruleDrawer(id)), { sm: true })); }
      b.append(acts); if (!can) b.append(notice('RN-CNT-21: la practicante no cambia reglas; las crea y aprueba la contadora (cnt.rule.manage).', 'info'));
      b.append(dl([['Origen', srcName(r.source)], ['Subtipo', subName(r.source, r.subtype)], ['Vigente desde', F.date(r.valid_from)], ['Aprobación del asiento', r.auto_approve ? 'Automática: la regla la aprobó la contadora (RN-CNT-02, D-CNT-06)' : 'Pasa por la contadora'], ['Reparte gastos comunes por ventas', r.allocate_common ? 'Sí (RN-CNT-16)' : 'No: sin marca va a la bandeja'], ['Aprobó la regla', r.approved_by ? `${G.userName(r.approved_by)} · ${F.date(r.approved_at)}` : '—'], ['Estado', st(r.status)]]));
      b.append(card('Líneas', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['#', 'Lado', 'Cuenta', 'Importe', 'Tercero'].map(x => h('th', null, x)))), h('tbody', null, ruleLines(id).map(l => h('tr', null, h('td', null, l.seq), h('td', null, l.side === 'D' ? 'Debe' : 'Haber'), h('td', null, l.account_from === 'FIXED' ? accLbl(l.account_code) : l.account_from === 'PARAM' ? `${G.param(l.param_key)} (parámetro ${l.param_key})` : lbl(ACC_FROM, l.account_from)), h('td', null, lbl(AMOUNT_KEYS, l.amount_key)), h('td', null, l.third ? 'Sí' : '—'))))))));
      const m = r.account_map || {}; const pairs = [].concat(Object.entries(m.categories || {}).map(([k, v]) => [`Categoría ${k}`, accLbl(v)]), Object.entries(m.supplier_types || {}).map(([k, v]) => [`Proveedor tipo ${k}`, accLbl(v)]), Object.entries(m.suppliers || {}).map(([k, v]) => [G.supName(k), accLbl(v)]));
      if (pairs.length) b.append(card('Mapa de cuentas del detalle', dl(pairs)));
      const smp = sampleFor(r.source);
      if (smp) { let x; try { x = buildEntry(smp[0], smp[1], { dry: true, rule: r }); } catch (e) { x = { lines: [], problems: [e.message] }; }
        b.append(card(`Prueba con un documento real: ${x.facts ? x.facts.label : smp[1]}`, x.lines && x.lines.length ? h('div', null, linesTable(x.lines.map(toRow)), x.problems.length ? notice('Iría a la bandeja: ' + x.problems.map(p => REASONS[p] || p).join(' · '), 'warn') : null) : empty('Sin resultado: ' + (x.problems || []).join(' · ')), { flush: true })); }
    }, { code: 'CNT-02', wide: true });
  }
  function setRuleStatus(id, status, opts = {}) {
    const user = opts.user || userId(); if (!canU('cnt.rule.manage', user)) G.fail('RN-CNT-21', 'Crear y aprobar reglas exige cnt.rule.manage (CONTADORA).');
    const r = D.get(T.rule, id); const ls = ruleLines(id);
    if (status === 'ACTIVE') { if (ls.length < 2 || !ls.some(l => l.side === 'D') || !ls.some(l => l.side === 'C')) throw new Error('La regla necesita al menos una línea al debe y otra al haber.'); for (const l of ls) if (l.account_from === 'FIXED') { const a = acct(l.account_code); if (!a || !a.postable) G.fail('RN-CNT-05', `La cuenta ${l.account_code} no recibe movimientos.`); } for (const o of D.where(T.rule, x => x.id !== id && x.status === 'ACTIVE' && x.source === r.source && x.subtype === r.subtype)) upd(T.rule, o.id, { status: 'INACTIVE', valid_to: G.date.add(G.TODAY, -1) }, false); }
    return upd(T.rule, id, Object.assign({ status }, status === 'ACTIVE' ? { approved_by: user, approved_at: nowAt(opts), valid_from: r.valid_from && r.valid_from > G.TODAY ? r.valid_from : (r.valid_from || G.TODAY) } : {}), false);
  }
  function ruleForm(r) {
    const model = r ? ruleLines(r.id).map(l => Object.assign({}, l)) : [{ side: 'D', account_from: 'FIXED', account_code: '', amount_key: 'TOTAL' }, { side: 'C', account_from: 'FIXED', account_code: '', amount_key: 'TOTAL' }];
    drawer(r ? 'Editar ' + r.code : 'Nueva regla de asiento', (b, close) => {
      if (!G.can('cnt.rule.manage')) b.append(notice('RN-CNT-21: solo la contadora crea y cambia reglas.', 'bad'));
      const hdr = { code: r ? r.code : 'R-' + U.pad(D.all(T.rule).length + 1, 3), name: r ? r.name : '', source: r ? r.source : 'SALE', subtype: r ? r.subtype : '*', auto_approve: r ? !!r.auto_approve : false, allocate_common: r ? !!r.allocate_common : true, valid_from: r ? r.valid_from : G.TODAY };
      const f = form({ id: 'cntrule', values: hdr, submitLabel: false, fields: [{ key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'source', label: 'Origen', type: 'select', options: SOURCES.slice(0, 11), required: true }, { key: 'subtype', label: 'Subtipo', type: 'select', options: () => [['*', 'Todos']].concat(Object.values(SUBTYPES).flat()), required: true }, { key: 'valid_from', label: 'Vigente desde', type: 'date', required: true }, { key: 'auto_approve', label: 'Aprobación automática (D-CNT-06)', type: 'checkbox' }, { key: 'allocate_common', label: 'Repartir gastos sin marca por ventas', type: 'checkbox' }] });
      b.append(f); const box = h('div'); b.append(card('Líneas de la regla', box));
      const draw = () => { G.ui.clear(box); box.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Lado', 'Cuenta desde', 'Cuenta', 'Importe', 'Tercero', ''].map(x => h('th', null, x)))), h('tbody', null, model.map((l, i) => h('tr', null,
        h('td', null, h('select', { class: 'input', on: { change: e => { l.side = e.target.value; } } }, [['D', 'Debe'], ['C', 'Haber']].map(([v, t]) => h('option', { value: v, selected: l.side === v }, t)))),
        h('td', null, h('select', { class: 'input', on: { change: e => { l.account_from = e.target.value; draw(); } } }, ACC_FROM.map(([v, t]) => h('option', { value: v, selected: l.account_from === v }, t)))),
        h('td', null, l.account_from === 'FIXED' ? h('select', { class: 'input', on: { change: e => { l.account_code = e.target.value; } } }, h('option', { value: '' }, '—'), accOpts().map(([v, t]) => h('option', { value: v, selected: l.account_code === v }, t))) : l.account_from === 'PARAM' ? 'cnt_interunit_account_code' : '—'),
        h('td', null, h('select', { class: 'input', on: { change: e => { l.amount_key = e.target.value; } } }, AMOUNT_KEYS.map(([v, t]) => h('option', { value: v, selected: l.amount_key === v }, t)))),
        h('td', null, h('input', { type: 'checkbox', checked: !!l.third, on: { change: e => { l.third = e.target.checked ? 'DOC' : null; } } })),
        h('td', null, btn('Quitar', () => { model.splice(i, 1); draw(); }, { sm: true, kind: 'ghost' }))))))), btn('Agregar línea', () => { model.push({ side: 'C', account_from: 'FIXED', account_code: '', amount_key: 'TOTAL' }); draw(); }, { sm: true })); };
      draw();
      b.append(h('div', { class: 'form-actions' }, btn('Cancelar', close), btn(r ? 'Guardar como borrador' : 'Crear en borrador', () => tryDo(() => { const v = f.api.values; if (!G.can('cnt.rule.manage')) G.fail('RN-CNT-21', 'Crear reglas exige cnt.rule.manage (CONTADORA).'); if (!v.name) throw new Error('Indica el nombre.'); if (model.some(l => l.account_from === 'FIXED' && !l.account_code)) throw new Error('Elige la cuenta de cada línea fija.'); if (!r && D.find(T.rule, x => x.code === v.code)) throw new Error('Ya existe una regla con ese código.'); const row = { code: v.code, name: v.name, source: v.source, subtype: v.subtype, valid_from: v.valid_from, auto_approve: !!v.auto_approve, allocate_common: !!v.allocate_common, status: 'DRAFT' }; const rr = r ? upd(T.rule, r.id, row, false) : ins(T.rule, Object.assign({ company_id: 'co-dg', account_map: {}, version: 1 }, row), false); for (const l of ruleLines(rr.id)) D.remove(T.rl, l.id); model.forEach((l, i) => ins(T.rl, { rule_id: rr.id, seq: i + 1, side: l.side, account_from: l.account_from, account_code: l.account_from === 'FIXED' ? l.account_code : null, param_key: l.account_from === 'PARAM' ? 'cnt_interunit_account_code' : null, amount_key: l.amount_key, third: l.third || null })); close(); ruleDrawer(rr.id); }, 'Regla guardada en borrador: apruébala para que quede vigente'), { kind: 'primary' })));
    }, { code: 'CNT-02', wide: true });
  }
  CNT.setRuleStatus = setRuleStatus;

  /* ---------- CNT-03 Asientos ---------- */
  function scrEntries(el) {
    const ps = periodSel('p03');
    const body = page(el, { code: 'CNT-03', title: 'Asientos', sub: 'Todos los asientos del período con su origen, estado, número, quién preparó y quién aprobó. El número se asigna al aprobar, correlativo y sin saltos (RN-CNT-14).', actions: [ps.el, { label: 'Generar asientos pendientes', kind: 'accent', disabled: !G.can('cnt.entry.prepare'), onClick: () => tryDo(() => generatePending({ from: ps.value, to: G.TODAY < lastDay(ps.value) ? G.TODAY : lastDay(ps.value), user: null }), r => `Generados ${r.created} · a la bandeja ${r.inbox} · reversados ${r.reversed} · ya tenían asiento ${r.existing}`) }, { label: 'Asiento manual', kind: 'primary', icon: '+', onClick: () => G.go('CNT-04') }] });
    const rows = G.scope.filter(D.where(T.je, e => e.period === ps.value)).sort((a, b) => (b.entry_date.localeCompare(a.entry_date)) || ((b.seq || 0) - (a.seq || 0)));
    const acc = ui.acc03 || '';
    const withAcc = acc ? new Set(D.where(T.jl, l => l.account_code.startsWith(acc)).map(l => l.entry_id)) : null;
    const shown = withAcc ? rows.filter(e => withAcc.has(e.id)) : rows;
    const c = s => rows.filter(e => e.status === s).length;
    body.append(kpis([{ label: 'Aprobados', value: c('APPROVED'), sub: `último número ${(numMap().get(ps.value) || 0)}` }, { label: 'Por aprobar', value: c('PENDING_APPROVAL'), tone: c('PENDING_APPROVAL') ? 'warn' : 'ok', sub: 'KPI-CNT-02' }, { label: 'Borradores', value: c('DRAFT'), sub: `${rows.filter(e => e.blocked && e.status === 'DRAFT').length} retenidos en la bandeja` }, { label: 'Reversados', value: rows.filter(e => e.reversed_by_id).length }, { label: 'Debe aprobado', value: F.money(R(U.sum(rows.filter(e => e.status === 'APPROVED'), e => e.total_debit))) }]));
    const accIn = h('input', { class: 'input', placeholder: 'Cuenta (p. ej. 6371)', value: acc, attrs: { 'aria-label': 'Filtrar por cuenta' }, style: 'width:150px', on: { change: e => { ui.acc03 = e.target.value.trim(); G.refresh(); } } });
    body.append(table({ id: 'cnt03', rows: shown, onRow: e => entryDrawer(e.id), toolbar: [accIn], columns: entryCols.concat([{ key: 'prep', label: 'Preparó', value: e => e.prepared_by ? G.userShort(e.prepared_by) : 'Sistema' }, { key: 'appr', label: 'Aprobó', value: e => e.auto_approved ? 'Regla' : e.approved_by ? G.userShort(e.approved_by) : '' }]),
      filters: [{ key: 'source_type', label: 'Origen', options: SOURCES }, { key: 'st', label: 'Estado', options: [['APPROVED', 'Aprobado'], ['PENDING_APPROVAL', 'Por aprobar'], ['DRAFT', 'Borrador'], ['BLOCKED', 'Retenido'], ['REVERSED', 'Reversado'], ['VOIDED', 'Anulado']], value: e => dispStatus(e) }, { key: 'brand_id', label: 'Marca', options: brandOpts() }, { key: 'establishment_id', label: 'Local', options: siteOpts() }] }));
  }

  /* ---------- CNT-04 Asiento manual ---------- */
  function scrManual(el, params) {
    const body = page(el, { code: 'CNT-04', title: 'Asiento manual', sub: 'Registro con validación de cuadre, cuentas que reciben movimientos, centro de costo, tercero y marca. Queda pendiente de aprobación de la contadora (RN-CNT-02).' });
    if (!G.can('cnt.entry.prepare')) { body.append(notice('Registrar asientos exige cnt.entry.prepare (PRACTICANTE_CONTABLE o CONTADORA).', 'warn')); }
    const m = ui.m04 = ui.m04 || { entry_date: G.TODAY, description: '', lines: [{}, {}] };
    const hdr = form({ id: 'cnt04h', values: m, submitLabel: false, fields: [{ key: 'entry_date', label: 'Fecha', type: 'date', required: true, onChange: v => { m.entry_date = v; tot(); } }, { key: 'description', label: 'Glosa', required: true, span: 2, onChange: v => { m.description = v; } }] });
    body.append(card('Cabecera', hdr));
    const box = h('div'); const totals = h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:8px' });
    body.append(card('Líneas', h('div', null, box, totals), { actions: [btn('Plantilla: depreciación del mes', () => { const amt = 1450; m.description = m.description || `Depreciación de ${pName(m.entry_date)}`; m.lines = prorate(R(amt * 0.7), monthOf(m.entry_date)).map(p => ({ account_code: '6814', debit: p.amount, cost_center_id: 'cc-PROD-L2', brand_id: p.brand })).concat(prorate(R(amt * 0.3), monthOf(m.entry_date)).map(p => ({ account_code: '6814', debit: p.amount, cost_center_id: 'cc-ADM', brand_id: p.brand }))).concat([{ account_code: '3913', credit: amt }]); G.refresh(); }, { sm: true }), btn('Limpiar', () => { ui.m04 = null; G.refresh(); }, { sm: true, kind: 'ghost' })] }));
    const sel = (opts, v, on, ph) => h('select', { class: 'input', on: { change: e => on(e.target.value) } }, h('option', { value: '' }, ph || '—'), opts.map(([k, t]) => h('option', { value: k, selected: String(v || '') === String(k) }, t)));
    const AO = accOpts(), CO = ccOpts(), BO = brandOpts();
    function tot() { const d = R(U.sum(m.lines, l => Number(l.debit) || 0)), c = R(U.sum(m.lines, l => Number(l.credit) || 0)); G.ui.clear(totals); totals.append(h('span', null, 'Debe ', h('b', null, F.money(d))), h('span', null, 'Haber ', h('b', null, F.money(c))), Math.abs(d - c) > 0.004 ? badge(`Diferencia ${F.money(R(d - c))} · RN-CNT-01`, 'bad') : d > 0 ? badge('Cuadra', 'ok') : badge('Sin importes', ''), G.period.isClosed(m.entry_date || G.TODAY) ? badge(`${pName(m.entry_date)} cerrado · RN-CNT-06`, 'bad') : null); }
    function draw() {
      G.ui.clear(box);
      box.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Cuenta', 'Glosa', 'Debe', 'Haber', 'C. costo', 'Marca', 'Tercero (RUC/DNI)', ''].map(x => h('th', null, x)))), h('tbody', null, m.lines.map((l, i) => { const a = acct(l.account_code); return h('tr', null,
        h('td', null, sel(AO, l.account_code, v => { l.account_code = v; draw(); }, 'Cuenta…')),
        h('td', null, h('input', { class: 'input', value: l.description || '', placeholder: 'Glosa de la línea', on: { input: e => { l.description = e.target.value; } } })),
        h('td', null, h('input', { class: 'input', type: 'number', step: '0.01', min: '0', style: 'width:110px', value: l.debit ?? '', on: { input: e => { l.debit = e.target.value === '' ? '' : Number(e.target.value); tot(); } } })),
        h('td', null, h('input', { class: 'input', type: 'number', step: '0.01', min: '0', style: 'width:110px', value: l.credit ?? '', on: { input: e => { l.credit = e.target.value === '' ? '' : Number(e.target.value); tot(); } } })),
        h('td', null, a && a.requires_cost_center ? sel(CO, l.cost_center_id, v => { l.cost_center_id = v; }, 'Obligatorio') : h('span', { class: 'muted small' }, 'no exige')),
        h('td', null, a && a.requires_brand ? h('div', { class: 'row', style: 'flex-wrap:nowrap' }, sel(BO, l.brand_id, v => { l.brand_id = v; }, 'Obligatoria'), btn('Repartir', () => { const amt = Number(l.debit) || Number(l.credit) || 0; if (!amt) return toast('Indica el importe antes de repartir.', 'warn'); const side = Number(l.debit) ? 'debit' : 'credit'; const parts = prorate(amt, monthOf(m.entry_date || G.TODAY)).map(p => Object.assign({}, l, { [side]: p.amount, brand_id: p.brand })); m.lines.splice(i, 1, ...parts); draw(); }, { sm: true, kind: 'ghost', title: 'Repartir por ventas de cada marca del mes' })) : h('span', { class: 'muted small' }, 'no exige')),
        h('td', null, a && a.requires_third_party ? h('input', { class: 'input', style: 'width:120px', value: l.third_party_doc || '', placeholder: 'Obligatorio', on: { input: e => { l.third_party_doc = e.target.value.trim(); } } }) : h('span', { class: 'muted small' }, '—')),
        h('td', null, btn('×', () => { m.lines.splice(i, 1); draw(); }, { sm: true, kind: 'ghost', title: 'Quitar línea' }))); })))),
        btn('Agregar línea', () => { m.lines.push({}); draw(); }, { sm: true }));
      tot();
    }
    draw();
    const save = submit => tryDo(() => { const e = createManual({ entry_date: m.entry_date, description: m.description, lines: m.lines.map(l => Object.assign({}, l, { third_party_type: l.third_party_doc ? 'OTHER' : null })), submit }); ui.m04 = null; entryDrawer(e.id); return e; }, submit ? 'Asiento enviado a aprobación' : 'Borrador guardado');
    body.append(h('div', { class: 'form-actions' }, btn('Guardar borrador', () => save(false)), btn('Enviar a aprobación', () => save(true), { kind: 'primary' })));
    body.append(notice('Las líneas de gasto (clase 6 con destino) generan su amarre a la clase 9 y a la 79 al guardar. RN-CNT-04: cada línea va al debe o al haber, no ambos. RN-CNT-16: ingresos, costos y gastos llevan marca; usa «Repartir» para gastos comunes.', 'info'));
    const mine = D.where(T.je, e => e.source_type === 'MANUAL' && e.status !== 'VOIDED').sort(U.by('prepared_at', -1)).slice(0, 12);
    body.append(card('Asientos manuales recientes', table({ id: 'cnt04r', rows: mine, onRow: e => entryDrawer(e.id), search: false, pageSize: 12, columns: entryCols.concat([{ key: 'prep', label: 'Preparó', value: e => G.userShort(e.prepared_by) }]) }), { flush: true }));
  }

  /* ---------- CNT-05 Bandeja de la contadora ---------- */
  const srcOpen = it => { const k = kindAlias(it.source_type); if (k === 'SIRE') return () => G.go(D.get(T.sp, it.source_id) && D.get(T.sp, it.source_id).register === 'SALES' ? 'CNT-07' : 'CNT-06'); if (it.entry_id) return () => entryDrawer(it.entry_id); try { const f = FACTS[k] && FACTS[k](it.source_id); return f && f.go ? f.go : null; } catch (e) { return null; } };
  const ageDays = it => G.date.diff(G.TODAY, day(it.created_at));
  function scrInbox(el) {
    const body = page(el, { code: 'CNT-05', title: 'Bandeja de la contadora', sub: 'Documentos sin regla, con cuenta, centro de costo o marca faltante, observados por el cruce de tres vías o por SIRE y gastos sin comprobante válido. La practicante clasifica; la contadora aprueba o devuelve (RN-CNT-10).' });
    const all = D.all(T.inbox); const open = all.filter(x => ['PENDING', 'CLASSIFIED', 'RETURNED'].includes(x.status)); const max = Number(G.param('cnt_inbox_max_age_days') ?? 3);
    body.append(kpis([{ label: 'Por clasificar', value: open.filter(x => x.status === 'PENDING').length, tone: 'warn' }, { label: 'Por aprobar', value: open.filter(x => x.status === 'CLASSIFIED').length, sub: 'clasificados por la practicante' }, { label: 'Devueltos', value: open.filter(x => x.status === 'RETURNED').length, tone: open.some(x => x.status === 'RETURNED') ? 'bad' : '' }, { label: `Con más de ${max} días`, value: open.filter(x => x.status !== 'RETURNED' && ageDays(x) > max).length, tone: open.some(x => ageDays(x) > max) ? 'bad' : 'ok', sub: 'KPI-CNT-06' }, { label: 'Resueltos este mes', value: all.filter(x => x.status === 'APPROVED' && day(x.approved_at) >= G.date.month(G.TODAY)).length }]));
    const byR = U.groupBy(open, 'reason'); if (open.length) body.append(h('div', { class: 'row' }, Object.entries(byR).map(([k, v]) => badge(`${REASONS[k] || k}: ${v.length}`, k === 'NO_RULE' ? 'bad' : 'warn'))));
    const cols = [{ key: 'created_at', label: 'Ingresó', render: x => h('span', null, F.date(x.created_at), ' ', ageDays(x) > max && x.status !== 'APPROVED' ? badge(ageDays(x) + ' días', 'bad') : null) }, { key: 'reason', label: 'Motivo', value: x => REASONS[x.reason] || x.reason }, { key: 'ref_label', label: 'Documento', render: x => h('span', { class: 'small' }, x.ref_label) }, { key: 'period', label: 'Período', value: x => pName(x.period) }, { key: 'amount', label: 'Importe', align: 'r', render: x => x.amount ? F.money(x.amount) : '—' }, { key: 'cls', label: 'Clasificó', value: x => x.classified_by ? G.userShort(x.classified_by) : '' }, { key: 'status', label: 'Estado', render: x => st(x.status) }];
    const filt = [{ key: 'reason', label: 'Motivo', options: Object.entries(REASONS) }, { key: 'period', label: 'Período', options: monthOpts() }];
    body.append(minw(tabs([{ key: 'open', label: 'Abiertos', count: open.length, render: p => p.append(table({ id: 'cnt05o', rows: open.sort(U.by('created_at')), onRow: x => itemDrawer(x.id), columns: cols, filters: filt.concat([{ key: 'status', label: 'Estado', options: [['PENDING', 'Pendiente'], ['CLASSIFIED', 'Clasificado'], ['RETURNED', 'Devuelto']] }]) })) },
      { key: 'done', label: 'Resueltos', render: p => p.append(table({ id: 'cnt05d', rows: all.filter(x => x.status === 'APPROVED').sort(U.by('approved_at', -1)), onRow: x => itemDrawer(x.id), columns: cols.concat([{ key: 'appr', label: 'Aprobó', value: x => G.userShort(x.approved_by) }]), filters: filt })) }], { key: 'cnt05tabs' })));
  }
  function itemDrawer(id) {
    const it = D.get(T.inbox, id); if (!it) return;
    drawer(REASONS[it.reason] || it.reason, (b, close) => {
      const re = () => { close(); itemDrawer(id); }; const me = userId(); const open = ['PENDING', 'CLASSIFIED', 'RETURNED'].includes(it.status);
      const go = srcOpen(it); if (go) b.append(h('div', { class: 'row' }, btn(it.entry_id ? 'Ver asiento retenido' : 'Ver documento de origen', () => { close(); go(); }, { sm: true, kind: 'ghost' })));
      if (it.status === 'RETURNED') b.append(notice('Devuelto por la contadora: ' + it.returned_reason, 'bad'));
      b.append(dl([['Documento', it.ref_label], ['Motivo', REASONS[it.reason]], ['Detalle', it.notes], ['Importe', it.amount ? F.money(it.amount) : '—'], ['Período', pName(it.period)], ['Antigüedad', F.days(ageDays(it))], ['Estado', st(it.status)], ['Clasificación', it.classification ? [it.classification.account_code && accLbl(it.classification.account_code), it.classification.cost_center_id && G.ccName(it.classification.cost_center_id), it.classification.brand_id && G.brandName(it.classification.brand_id), it.classification.note].filter(Boolean).join(' · ') : '—'], ['Clasificó', it.classified_by ? `${G.userName(it.classified_by)} · ${F.datetime(it.classified_at)}` : '—'], ['Aprobó', it.approved_by ? `${G.userName(it.approved_by)} · ${F.datetime(it.approved_at)}` : '—']]));
      if (it.entry_id && linesOf(it.entry_id).length) b.append(card('Asiento propuesto (retenido)', linesTable(linesOf(it.entry_id)), { flush: true }));
      if (open && it.status !== 'CLASSIFIED' || (open && G.can('cnt.entry.prepare') && !G.can('cnt.entry.approve'))) {
        const miss = it.missing || [it.reason]; const needAcc = it.reason === 'NO_RULE' || miss.includes('MISSING_ACCOUNT');
        const fields = [];
        if (needAcc) fields.push({ key: 'account_code', label: it.reason === 'NO_RULE' ? 'Cuenta de contrapartida (ingreso, gasto o compra)' : 'Cuenta contable', type: 'select', options: accOpts(), required: true, span: 2 });
        if (miss.includes('MISSING_COST_CENTER') || needAcc) fields.push({ key: 'cost_center_id', label: 'Centro de costo', type: 'select', options: ccOpts(), required: miss.includes('MISSING_COST_CENTER') });
        if (miss.includes('MISSING_BRAND') || needAcc) fields.push({ key: 'brand_id', label: 'Marca (RN-CNT-16)', type: 'select', options: brandOpts(), required: miss.includes('MISSING_BRAND') });
        if (it.reason === 'NO_VALID_RECEIPT') fields.push({ key: 'action', label: 'Propuesta', type: 'select', options: [['NOT_DEDUCTIBLE', 'Gasto no deducible, sin crédito fiscal'], ['VALIDATE', 'El comprobante sí es válido']], required: true });
        if (needAcc && kindAlias(it.source_type) === 'PURCHASE') fields.push({ key: 'remember', label: 'Recordar esta cuenta para el proveedor (mapa de la regla)', type: 'checkbox', span: 2 });
        fields.push({ key: 'note', label: 'Nota de clasificación', type: 'textarea' });
        b.append(card(it.status === 'CLASSIFIED' ? 'Reclasificar' : 'Clasificar (practicante)', form({ id: 'cnt05c', values: it.classification || {}, fields, submitLabel: 'Guardar clasificación', onSubmit: v => { classifyItem(id, v); toast('Clasificado: pasa a la contadora', 'ok'); re(); G.refresh(); return true; } })));
      }
      if (open && (it.status === 'CLASSIFIED' || !['NO_RULE', 'MISSING_ACCOUNT', 'MISSING_COST_CENTER', 'MISSING_BRAND'].includes(it.reason))) {
        const mine = sameUser(it.classified_by, me);
        if (mine) b.append(notice('RN-CNT-10: clasificaste este ítem; lo aprueba otra persona (la contadora).', 'warn'));
        b.append(h('div', { class: 'row' }, btn('Aprobar', () => tryDo(() => approveItem(id), r => 'Aprobado' + (r.entry_id ? ' · asiento generado' : '')) && re(), { kind: 'primary', disabled: !G.can('cnt.entry.approve') || mine, title: !G.can('cnt.entry.approve') ? 'RN-CNT-10: aprueba la CONTADORA' : null }), it.status === 'CLASSIFIED' ? btn('Devolver', () => promptReason('Devolver a la practicante', r => { returnItem(id, r); toast('Devuelto', 'ok'); close(); }, { label: 'Qué debe corregirse' }), { disabled: !G.can('cnt.entry.approve') }) : null));
      }
      b.append(card('Historial', h('div', { class: 'timeline' }, (it.history || []).map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.datetime(x.at)), h('span', { class: 'dot' }), h('div', null, h('b', null, x.action), h('div', { class: 'muted small' }, x.user)))))));
    }, { code: 'CNT-05', wide: true });
  }
  CNT.openItem = itemDrawer;

  /* ---------- CNT-06 / CNT-07 SIRE ---------- */
  function scrSire(el, reg) {
    const code = reg === 'SALES' ? 'CNT-07' : 'CNT-06';
    const ps = periodSel('p' + code, G.date.addMonths(G.date.month(G.TODAY), reg === 'SALES' ? -1 : 0));
    const can = G.can('cnt.sire.manage');
    const body = page(el, { code, title: reg === 'SALES' ? 'SIRE de ventas' : 'Propuesta SIRE de compras', sub: reg === 'SALES' ? 'Compara la propuesta del Registro de Ventas e Ingresos de SUNAT con los comprobantes emitidos en FAC y prepara la respuesta.' : 'Importa el archivo de la propuesta del Registro de Compras y lo cruza con los comprobantes registrados (COM y GAS) por RUC, tipo, serie y número (RN-CNT-11).', actions: [ps.el, { label: 'Importar propuesta', kind: 'primary', disabled: !can, title: can ? null : 'Exige cnt.sire.manage', onClick: () => importModal(reg, ps.value) }, { label: 'Envíos SIRE', onClick: () => G.go('CNT-08') }] });
    const p = currentProposal(reg, ps.value);
    if (!p) { body.append(notice(`No hay propuesta de ${pName(ps.value)} importada. ${reg === 'SALES' ? 'SUNAT publica la propuesta del mes desde el día 1 del mes siguiente.' : 'Descárgala de SUNAT Operaciones en Línea (SIRE) e impórtala aquí.'}`, 'info')); const sys = reg === 'SALES' ? systemSales(ps.value) : systemPurchases(ps.value); body.append(kpis([{ label: reg === 'SALES' ? 'Comprobantes emitidos del mes' : 'Comprobantes registrados del mes', value: sys.length }, { label: 'Total', value: F.money(R(U.sum(sys, s => s.total))) }])); return; }
    const s = p.summary || {}; const un = unresolved(p.id).length;
    body.append(kpis([{ label: 'En la propuesta', value: p.line_count, sub: F.money(p.total_amount) }, { label: 'Registrados', value: p.system_count || 0 }, { label: 'Coinciden', value: s.MATCHED || 0, tone: 'ok' }, { label: 'Diferencia de importe', value: s.AMOUNT_DIFF || 0, tone: s.AMOUNT_DIFF ? 'warn' : '', sub: `tolerancia ${F.money(G.param('cnt_sire_amount_tolerance_pen'))}` }, { label: 'Faltan en el sistema', value: s.MISSING_IN_SYSTEM || 0, tone: s.MISSING_IN_SYSTEM ? 'bad' : '' }, { label: 'Faltan en la propuesta', value: s.MISSING_IN_PROPOSAL || 0, tone: s.MISSING_IN_PROPOSAL ? 'warn' : '' }, { label: 'Sin resolver', value: un, tone: un ? 'bad' : 'ok', sub: 'KPI-CNT-03 · RN-CNT-18' }]));
    body.append(h('div', { class: 'row between' }, h('span', { class: 'muted small' }, `${p.file_name} · importó ${G.userName(p.imported_by)} el ${F.datetime(p.imported_at)} · cruce ${F.datetime(p.matched_at)}`), h('div', { class: 'row' }, st(p.status), btn('Volver a cruzar', () => tryDo(() => matchSire(p.id, { inbox: true }), 'Cruce actualizado'), { sm: true, disabled: !can }), btn('Preparar envío', () => tryDo(() => prepareSubmission({ register: reg, period: ps.value }), r => `Archivo ${r.file_name} preparado`) && G.go('CNT-08'), { sm: true, kind: 'accent', disabled: !can || p.status === 'SUBMITTED' }))));
    const rows = D.where(T.spl, l => l.proposal_id === p.id).sort((a, b) => (a.match_status === 'MATCHED') - (b.match_status === 'MATCHED') || a.seq - b.seq);
    body.append(table({ id: 'sire' + reg, rows, onRow: l => sireLineDrawer(l.id), pageSize: 30, filters: [{ key: 'match_status', label: 'Resultado', options: ['MATCHED', 'AMOUNT_DIFF', 'MISSING_IN_SYSTEM', 'MISSING_IN_PROPOSAL'].map(k => [k, LBL[k][0]]) }, { key: 'res', label: 'Resolución', options: [['open', 'Sin resolver'], ['done', 'Resuelta']], value: l => l.match_status === 'MATCHED' ? '' : l.resolution ? 'done' : 'open' }],
      columns: [{ key: 'doc', label: 'Comprobante', mono: true, value: l => `${l.doc_type_code} ${l.series}-${l.number}` }, { key: 'issue_date', label: 'Fecha', render: l => F.date(l.issue_date) }, { key: 'party', label: reg === 'SALES' ? 'Cliente' : 'Emisor', value: l => `${reg === 'SALES' ? (l.counterparty_doc || '') : l.issuer_ruc} ${String(l.issuer_name || '').slice(0, 26)}` }, { key: 'total', label: 'Propuesta', align: 'r', render: l => l.total != null ? F.money(l.total) : '—' }, { key: 'system_total', label: 'Sistema', align: 'r', render: l => l.system_total != null ? F.money(l.system_total) : '—' }, { key: 'diff', label: 'Diferencia', align: 'r', render: l => l.diff ? F.money(l.diff) : '' }, { key: 'match_status', label: 'Resultado', render: l => st(l.match_status) }, { key: 'resolution', label: 'Resolución', value: l => l.resolution ? lbl(Object.values(RESOLUTIONS).flat(), l.resolution) : l.match_status === 'MATCHED' ? '' : 'Pendiente' }] }));
  }
  function sireLineDrawer(id) {
    const l = D.get(T.spl, id); if (!l) return;
    drawer(`${l.doc_type_code} ${l.series}-${l.number}`, (b, close) => {
      b.append(dl([['Resultado', st(l.match_status)], ['Emisor / cliente', `${l.issuer_ruc} ${l.issuer_name || ''}`], ['Fecha', F.date(l.issue_date)], ['Base · IGV', `${F.money(l.base)} · ${F.money(l.igv)}`], ['Total en la propuesta', l.total != null ? F.money(l.total) : 'No está en la propuesta'], ['Total registrado', l.system_total != null ? F.money(l.system_total) : 'No está registrado'], ['Diferencia', l.diff != null ? F.money(l.diff) : '—'], ['Resolución', l.resolution ? `${lbl(Object.values(RESOLUTIONS).flat(), l.resolution)} · ${l.resolution_note} (${G.userShort(l.resolved_by)})` : '—']]));
      if (l.system_id && l.system_kind) { const f = (() => { try { return FACTS[l.system_kind](l.system_id); } catch (e) { return null; } })(); if (f && f.go) b.append(btn('Ver comprobante registrado', () => { close(); f.go(); }, { sm: true, kind: 'ghost' })); }
      if (l.match_status !== 'MATCHED' && !l.resolution) b.append(card('Resolver la diferencia', form({ id: 'cntsire', fields: [{ key: 'resolution', label: 'Resolución', type: 'select', options: RESOLUTIONS[l.match_status] || [], required: true, span: 2 }, { key: 'note', label: 'Sustento', type: 'textarea', required: true }], submitLabel: 'Resolver', onSubmit: v => { resolveSireLine(id, v.resolution, v.note); toast('Diferencia resuelta', 'ok'); close(); G.refresh(); return true; } })));
    }, { code: 'CNT-06' });
  }
  function importModal(reg, period) {
    modal(`Importar propuesta SIRE de ${reg === 'SALES' ? 'ventas' : 'compras'}`, (b, close) => {
      b.append(notice('Pega el contenido del archivo (una línea por comprobante: RUC|Razón social|Tipo|Serie|Número|Fecha|Base|IGV|Total) o usa el archivo descargado de SUNAT para esta demostración.', 'info'));
      const f = form({ id: 'cntimp', values: { period, text: '' }, fields: [{ key: 'period', label: 'Período', type: 'select', options: monthOpts(), required: true }, { key: 'text', label: 'Contenido del archivo', type: 'textarea', required: true }], submitLabel: 'Importar y cruzar', onCancel: close, onSubmit: v => { const r = importProposal({ register: reg, period: v.period, text: v.text }); toast(`Importadas ${r.proposal.line_count} líneas · ${r.summary.MATCHED} coinciden, ${r.summary.AMOUNT_DIFF} con diferencia, ${r.summary.MISSING_IN_SYSTEM} faltan en el sistema`, 'ok'); ui['p' + (reg === 'SALES' ? 'CNT-07' : 'CNT-06')] = v.period; close(); G.refresh(); return true; } });
      b.append(btn('Cargar el archivo descargado de SUNAT', () => { f.api.set('text', sampleProposalText(reg, f.api.values.period)); }, { sm: true }), f);
    }, [], { wide: true });
  }

  /* ---------- CNT-08 Envíos SIRE ---------- */
  function scrSubmissions(el) {
    const can = G.can('cnt.sire.manage'), sub = G.can('cnt.sire.submit');
    const body = page(el, { code: 'CNT-08', title: 'Envíos SIRE', sub: 'Por período y registro: acción (aceptar, reemplazar o ajustar), archivo generado, ticket, constancia y estado. Solo se envía con todas las diferencias resueltas o justificadas (RN-CNT-18).', actions: [{ label: 'Preparar envío', kind: 'primary', disabled: !can, onClick: () => modal('Preparar envío SIRE', (b, close) => b.append(form({ id: 'cnt08', values: { register: 'PURCHASES', period: firstOpen(), action: '' }, fields: [{ key: 'register', label: 'Registro', type: 'select', options: [['PURCHASES', 'Registro de Compras (RCE)'], ['SALES', 'Registro de Ventas (RVIE)']], required: true }, { key: 'period', label: 'Período', type: 'select', options: monthOpts(), required: true }, { key: 'action', label: 'Acción', type: 'select', options: [['ACCEPT', 'Aceptar la propuesta'], ['REPLACE', 'Reemplazar la propuesta'], ['ADJUST', 'Ajustar la propuesta']] }], submitLabel: 'Generar archivo', onCancel: close, onSubmit: v => { const r = prepareSubmission(v); toast(`Archivo ${r.file_name} preparado`, 'ok'); close(); G.refresh(); return true; } }))) }] });
    const rows = D.all(T.ss).sort(U.by('generated_at', -1));
    body.append(kpis([{ label: 'Preparados', value: rows.filter(r => r.status === 'PREPARED').length }, { label: 'Enviados sin constancia', value: rows.filter(r => r.status === 'SENT').length, tone: rows.some(r => r.status === 'SENT') ? 'warn' : '' }, { label: 'Aceptados', value: rows.filter(r => r.status === 'ACCEPTED').length, tone: 'ok' }, { label: 'Propuestas con diferencias', value: D.where(T.sp, p => !p.superseded && unresolved(p.id).length).length, tone: 'warn', sub: 'bloquean el envío' }]));
    body.append(table({ id: 'cnt08', rows, filters: [{ key: 'register', label: 'Registro', options: [['PURCHASES', 'Compras'], ['SALES', 'Ventas']] }, { key: 'status', label: 'Estado', options: [['PREPARED', 'Preparado'], ['SENT', 'Enviado'], ['ACCEPTED', 'Aceptado'], ['REJECTED', 'Rechazado']] }],
      columns: [{ key: 'period', label: 'Período', value: r => pName(r.period) }, { key: 'register', label: 'Registro', value: r => r.register === 'SALES' ? 'Ventas (RVIE)' : 'Compras (RCE)' }, { key: 'action', label: 'Acción', value: r => ({ ACCEPT: 'Aceptar', REPLACE: 'Reemplazar', ADJUST: 'Ajustar' })[r.action] }, { key: 'file_name', label: 'Archivo', mono: true, render: r => h('span', { class: 'small mono', title: 'Huella ' + r.file_hash }, r.file_name) }, { key: 'line_count', label: 'Líneas', align: 'r' }, { key: 'ticket', label: 'Ticket', mono: true }, { key: 'receipt_number', label: 'Constancia', mono: true }, { key: 'status', label: 'Estado', render: r => st(r.status) }],
      actions: r => [r.status === 'PREPARED' ? btn('Marcar enviado', () => promptReason('Ticket de SUNAT', t => markSubmissionSent(r.id, t), { label: 'Número de ticket', submit: 'Registrar envío' }), { sm: true, disabled: !sub, title: sub ? null : 'Exige cnt.sire.submit (CONTADORA)' }) : null, r.status === 'SENT' ? btn('Constancia', () => promptReason('Constancia de SUNAT', t => markSubmissionResult(r.id, true, t), { label: 'Número de constancia', submit: 'Registrar' }), { sm: true, kind: 'primary', disabled: !sub }) : null, r.status === 'SENT' ? btn('Rechazado', () => promptReason('Rechazo de SUNAT', t => markSubmissionResult(r.id, false, t)), { sm: true, kind: 'danger', disabled: !sub }) : null].filter(Boolean) }));
  }

  /* ---------- CNT-09 Libros y PLE ---------- */
  function scrBooks(el) {
    const ps = periodSel('p09', G.date.addMonths(G.date.month(G.TODAY), -1)); const y = Number(ps.value.slice(0, 4));
    const body = page(el, { code: 'CNT-09', title: 'Libros y PLE', sub: 'Libros que exige el régimen del año, generados en PDF, Excel o TXT PLE con huella y fecha. Solo se exportan en PLE los libros que no se llevan en SIRE y con código confirmado (RN-CNT-17).', actions: [ps.el] });
    if (!G.can('cnt.report.view') && !G.can('cnt.entry.prepare')) { body.append(notice('Ver libros exige cnt.report.view.', 'warn')); return; }
    let reg; try { reg = booksRegime('co-dg', y); } catch (e) { body.append(notice(e.message, 'bad')); body.append(btn('Ir a Régimen y libros del año (CNT-10)', () => G.go('CNT-10'), { kind: 'primary' })); return; }
    const codes = G.param('cnt_ple_book_codes'); const codesOk = codes && typeof codes === 'object' && Object.keys(codes).length;
    body.append(notice([`${y}: ${LBL[reg.result][0]} (ingresos ${F.money(reg.revenue)} frente al umbral de ${F.num(reg.threshold_uit)} UIT = ${F.money(reg.limit)}). `, reg.result === 'SIMPLIFIED' ? 'D-CNT-01: se asumen libros simplificados hasta que la contadora confirme ingresos y UIT.' : '', codesOk ? '' : ' D-CNT-05: los códigos PLE aún no están cargados (parámetro cnt_ple_book_codes): la exportación TXT queda bloqueada.'], reg.result === 'SIMPLIFIED' ? 'info' : 'warn'));
    const ex = D.all(T.lx);
    body.append(card('Libros exigidos', table({ id: 'cnt09b', search: false, rows: reg.books.map(b => ({ id: b, b })), columns: [{ key: 'b', label: 'Libro', value: r => BOOKS[r.b][0] }, { key: 'how', label: 'Cómo se lleva', value: r => BOOKS[r.b][1] === 'SIRE' ? 'SIRE (CNT-06, CNT-07)' : 'PLE o físico' }, { key: 'rows', label: `Filas en ${pName(ps.value)}`, align: 'r', value: r => bookRows(r.b, ps.value).length }, { key: 'last', label: 'Última generación', value: r => { const x = ex.filter(e => e.book_code === r.b && e.period === ps.value).sort(U.by('generated_at', -1))[0]; return x ? `${x.format} · ${F.datetime(x.generated_at)}` : '—'; } }],
      onRow: r => bookPreview(r.b, ps.value), actions: r => ['PDF', 'XLSX', 'TXT_PLE'].map(fm => btn(fm === 'TXT_PLE' ? 'TXT PLE' : fm, () => tryDo(() => generateBook({ book_code: r.b, period: ps.value, format: fm }), x => `${x.file_name} generado · huella ${x.hash.slice(0, 12)}…`), { sm: true, kind: fm === 'PDF' ? 'primary' : '', disabled: fm === 'TXT_PLE' && BOOKS[r.b][1] === 'SIRE', title: fm === 'TXT_PLE' && BOOKS[r.b][1] === 'SIRE' ? 'RN-CNT-17: se lleva en SIRE' : null })) }), { flush: true }));
    body.append(card('Archivos generados', table({ id: 'cnt09x', rows: ex.sort(U.by('generated_at', -1)), columns: [{ key: 'book_name', label: 'Libro' }, { key: 'period', label: 'Período', value: x => pName(x.period) }, { key: 'format', label: 'Formato' }, { key: 'file_name', label: 'Archivo', mono: true }, { key: 'row_count', label: 'Filas', align: 'r' }, { key: 'hash', label: 'Huella', mono: true, render: x => h('span', { class: 'small mono' }, x.hash.slice(0, 16) + '…') }, { key: 'generated_at', label: 'Generado', render: x => `${F.datetime(x.generated_at)} · ${G.userShort(x.generated_by)}` }] }), { flush: true }));
  }
  function bookPreview(code, period) { drawer(`${BOOKS[code][0]} · ${pName(period)}`, b => { const rows = bookRows(code, period); b.append(h('p', { class: 'muted small' }, `${rows.length} filas · se muestran las primeras 40`)); b.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('tbody', null, rows.slice(0, 40).map(r => h('tr', null, r.map(c => h('td', { class: 'small' }, String(c).slice(0, 60))))))))); }, { code: 'CNT-09', wide: true }); }

  /* ---------- CNT-10 Régimen y libros del año ---------- */
  function scrRegime(el) {
    const can = G.can('cnt.account.manage');
    const body = page(el, { code: 'CNT-10', title: 'Régimen y libros del año', sub: 'Ingresos del año, valor de la UIT cargado y confirmado por la contadora, umbral en UIT y resultado: libros simplificados o contabilidad completa (RN-CNT-12, RN-CNT-13).', actions: [{ label: 'Cargar año', kind: 'primary', disabled: !can, title: can ? null : 'La UIT la carga y confirma la contadora', onClick: () => fyForm(null) }] });
    const fys = D.all(T.fy).sort(U.by('year', -1));
    for (const fy of fys) {
      let r = null, err = null; try { r = booksRegime('co-dg', fy.year); } catch (e) { err = e.message; }
      const acc = netRevenue(fy.year);
      body.append(card(`Año ${fy.year}`, h('div', { class: 'stack' }, err ? notice(err, 'bad') : null,
        r ? kpis([{ label: 'Ingresos netos considerados', value: F.money(r.revenue), sub: r.revenue_source }, { label: 'UIT del año', value: F.money(r.uit), sub: fy.uit_confirmed_by ? `confirmó ${G.userShort(fy.uit_confirmed_by)} el ${F.date(fy.uit_confirmed_at)}` : '' }, { label: 'Umbral', value: F.money(r.limit), sub: `${F.num(r.threshold_uit)} UIT (cnt_mype_books_threshold_uit)` }, { label: 'Resultado', value: LBL[r.result][0], tone: r.result === 'SIMPLIFIED' ? 'ok' : 'warn', sub: r.books.map(b => b).join(' · ') }]) : null,
        r ? progress(Math.min(100, r.revenue / r.limit * 100), r.revenue > r.limit ? 'bad' : r.revenue > r.limit * 0.8 ? 'warn' : '') : null,
        dl([['Ingresos según cuentas 70 y 75 (asientos aprobados)', F.money(acc)], ['Ingresos cargados por la contadora', fy.revenue_pen != null ? F.money(fy.revenue_pen) : 'No cargados: se usan las cuentas'], ['Fuente del valor de la UIT', fy.uit_source || '—'], ['Libros', r ? r.books.map(b => BOOKS[b][0]).join(', ') : '—'], ['Notas', fy.notes]]),
        h('div', { class: 'row' }, btn('Editar', () => fyForm(fy), { sm: true, disabled: !can })))));
    }
    body.append(notice('El valor de la UIT y cualquier tasa legal son datos configurables: el sistema no los trae fijos. El IGV usa fac_igv_rate de FAC. D-CNT-01: hasta que la contadora cargue los ingresos y la UIT, se asumen libros simplificados.', 'info'));
  }
  function fyForm(fy) { drawer(fy ? `Año ${fy.year}` : 'Cargar año', (b, close) => b.append(form({ id: 'cnt10', values: fy ? Object.assign({}, fy) : { year: Number(G.TODAY.slice(0, 4)) + 1 }, fields: [{ key: 'year', label: 'Año', type: 'number', required: true }, { key: 'uit_value_pen', label: 'Valor de la UIT (S/)', type: 'money', help: 'Al guardar queda confirmado por ti (RN-CNT-13). Vacío: el régimen no se calcula.' }, { key: 'uit_source', label: 'Fuente (decreto supremo)' }, { key: 'revenue_pen', label: 'Ingresos netos del año (S/)', type: 'money', help: 'Vacío: se toman las cuentas 70 y 75 de los asientos aprobados.' }, { key: 'notes', label: 'Notas', type: 'textarea' }], submitLabel: 'Guardar y confirmar', onCancel: close, onSubmit: v => { saveFiscalYear(v); toast('Año guardado', 'ok'); close(); G.refresh(); return true; } })), { code: 'CNT-10' }); }

  /* ---------- CNT-11 Conciliación bancaria ---------- */
  function scrBank(el) {
    const banks = D.where('cash_accounts', c => c.account_type === 'BANK');
    const ca = ui.ca11 || (banks[0] || {}).id; const ps = periodSel('p11', G.date.addMonths(G.date.month(G.TODAY), -1));
    const caSel = h('select', { class: 'input', style: 'width:auto;max-width:100%', attrs: { 'aria-label': 'Cuenta' }, on: { change: e => { ui.ca11 = e.target.value; G.refresh(); } } }, banks.map(b => h('option', { value: b.id, selected: b.id === ca }, b.name || b.id)));
    const body = page(el, { code: 'CNT-11', title: 'Conciliación bancaria', sub: 'Extracto importado, cruce con cobros, pagos y asientos de la cuenta, partidas pendientes y diferencia final. Se cierra solo si el saldo del extracto = saldo contable + partidas en tránsito (RN-CNT-15).', actions: [caSel, ps.el, { label: 'Importar extracto', kind: 'primary', disabled: !G.can('cnt.entry.prepare'), onClick: () => tryDo(() => importStatement({ cash_account_id: ca, period: ps.value, lines: sampleStatement(ca, ps.value), file_name: `extracto-${(ca || '').slice(3)}-${ps.value.slice(0, 7)}.csv` }), r => `Extracto importado: ${r.line_count} movimientos`) }] });
    const rec = recOf(ca, ps.value);
    if (!rec) { const bl = bookLines(ca, ps.value); body.append(notice(`Sin extracto de ${pName(ps.value)} para esta cuenta. Hay ${bl.length} movimientos contables aprobados (saldo contable al cierre ${F.money(bookBalance(ca, lastDay(ps.value)))}).`, 'info')); return; }
    const s = reconSummary(rec.id);
    body.append(kpis([{ label: 'Saldo del extracto', value: F.money(s.statement), sub: `inicial ${F.money(rec.opening_balance)}` }, { label: 'Saldo contable', value: F.money(s.book), sub: `cuenta ${cashGl(ca)}` }, { label: 'Partidas en tránsito', value: F.money(s.transitSum), sub: `${s.transit.length} movimiento(s) del libro sin extracto` }, { label: 'Solo en el banco', value: F.money(s.bankOnlySum), sub: `${s.bankOnly.length} sin asiento`, tone: s.bankOnly.length ? 'warn' : '' }, { label: 'Diferencia no explicada', value: F.money(s.unexplained), tone: Math.abs(s.unexplained) > 0.004 ? 'bad' : 'ok', sub: 'debe ser 0,00' }]));
    body.append(h('div', { class: 'row between' }, h('span', { class: 'muted small' }, `${rec.file_name || ''} · ${s.matched} de ${s.lines.length} cruzados · ${st(rec.status).textContent}`), h('div', { class: 'row' }, btn('Cruzar automáticamente', () => tryDo(() => autoMatch(rec.id), n => `${n} movimiento(s) cruzados`), { sm: true, disabled: rec.status === 'CLOSED' }), btn('Cerrar conciliación', () => tryDo(() => closeReconciliation(rec.id), 'Conciliación cerrada'), { sm: true, kind: 'primary', disabled: rec.status === 'CLOSED' || !G.can('cnt.entry.approve') }))));
    body.append(card('Extracto bancario', table({ id: 'cnt11s', rows: s.lines, pageSize: 20, onRow: l => stmtDrawer(l.id), filters: [{ key: 'match_status', label: 'Cruce', options: [['MATCHED', 'Cruzado'], ['UNMATCHED', 'Sin cruzar']] }], columns: [{ key: 'line_date', label: 'Fecha', render: l => F.date(l.line_date) }, { key: 'description', label: 'Descripción' }, { key: 'reference', label: 'Referencia', mono: true }, { key: 'amount', label: 'Importe', align: 'r', render: l => F.money(l.amount) }, { key: 'balance', label: 'Saldo', align: 'r', render: l => F.money(l.balance) }, { key: 'match_status', label: 'Cruce', render: l => l.booked_entry_id && !l.matched_line_id ? badge('Asiento por aprobar', 'info') : st(l.match_status) }] }), { flush: true }));
    body.append(card('Partidas en tránsito (en el libro, aún no en el banco)', s.transit.length ? table({ id: 'cnt11t', rows: s.transit, search: false, onRow: x => entryDrawer(x.entry_id), columns: [{ key: 'date', label: 'Fecha', render: x => F.date(x.date) }, { key: 'number', label: 'Asiento', mono: true }, { key: 'label', label: 'Glosa' }, { key: 'amount', label: 'Importe', align: 'r', render: x => F.money(x.amount) }] }) : empty('Sin partidas en tránsito.'), { flush: true }));
  }
  function stmtDrawer(id) {
    const s = D.get(T.bsl, id); if (!s) return; const rec = D.get(T.brc, s.reconciliation_id);
    drawer('Movimiento del extracto', (b, close) => {
      b.append(dl([['Fecha', F.date(s.line_date)], ['Descripción', s.description], ['Referencia', s.reference], ['Importe', F.money(s.amount)], ['Cruce', st(s.match_status)], ['Asiento cruzado', s.matched_line_id ? (D.get(T.je, (D.get(T.jl, s.matched_line_id) || {}).entry_id) || {}).number : '—']]));
      if (rec.status === 'CLOSED') return;
      if (s.matched_line_id) { b.append(btn('Deshacer cruce', () => tryDo(() => manualMatch(id, null), 'Cruce deshecho') && close(), { sm: true })); return; }
      const used = new Set(D.where(T.bsl, x => x.reconciliation_id === rec.id && x.matched_line_id).map(x => x.matched_line_id));
      const cands = bookLines(rec.cash_account_id, rec.period).filter(x => !used.has(x.id) && Math.abs(x.amount - s.amount) < 0.005);
      b.append(card('Movimientos contables con el mismo importe', cands.length ? h('div', { class: 'stack' }, cands.map(x => h('div', { class: 'row between' }, h('span', { class: 'small' }, `${F.date(x.date)} · ${x.number} · ${x.label.slice(0, 50)}`), btn('Cruzar', () => tryDo(() => manualMatch(id, x.id), 'Cruzado') && close(), { sm: true, kind: 'primary' })))) : empty('Ninguno: si es un cargo o abono del banco, regístralo como asiento.')));
      if (!s.booked_entry_id) b.append(btn(s.amount < 0 ? 'Registrar el cargo bancario (asiento por aprobar)' : 'Registrar el abono (asiento por aprobar)', () => tryDo(() => bookBankCharge(id), e => `Asiento manual registrado: lo aprueba la contadora y luego se cruza`) && close(), { kind: 'accent', disabled: !G.can('cnt.entry.prepare') }));
      else b.append(notice('Ya tiene asiento registrado: al aprobarse, «Cruzar automáticamente» lo concilia.', 'info'));
    }, { code: 'CNT-11' });
  }
  /** extracto de demostración: los movimientos del libro como los registra el banco, más los cargos propios del banco */
  function sampleStatement(caId, period) {
    const bl = bookLines(caId, period).sort((a, b) => a.date.localeCompare(b.date)); const last = lastDay(period); const out = [];
    const transit = bl.filter(x => x.date === last && x.amount > 0).slice(-2).map(x => x.id);
    for (const x of bl) { if (transit.includes(x.id)) continue; const d = /Depósito|Barrido|DEP-/i.test(x.label) && x.date < last ? G.date.add(x.date, 1) : x.date; out.push({ date: d > last ? last : d, description: x.amount > 0 ? (/Abono|neto/i.test(x.label) ? 'ABONO LIQUIDACION ' : 'DEPOSITO ') + x.label.replace(/^.*· /, '').slice(0, 24).toUpperCase() : 'CARGO ' + x.label.slice(0, 28).toUpperCase(), reference: (x.label.match(/(OP\w+|DEP-[\w-]+|BAR-[\w-]+|PP-\d+|CB-\d+)/) || [])[0] || null, amount: x.amount }); }
    out.push({ date: G.date.add(period, 14), description: 'COM. TRANSF. INTERBANCARIA', reference: 'CTI' + period.slice(5, 7), amount: -10.6 });
    out.push({ date: last, description: 'COMISION MANTENIMIENTO CTA. CTE.', reference: 'MNT' + period.slice(5, 7), amount: -25 });
    out.push({ date: last, description: 'ITF', reference: 'ITF' + period.slice(5, 7), amount: -4.8 });
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
  CNT.sampleStatement = sampleStatement;

  /* ---------- CNT-12 Cierre mensual ---------- */
  function scrClose(el) {
    const ps = periodSel('p12', firstOpen()); const per = G.period.of(ps.value) || {}; const closed = per.status === 'CLOSED';
    const body = page(el, { code: 'CNT-12', title: 'Cierre mensual', sub: 'Tareas del cierre y bloqueo del período: con todo hecho o dispensado con motivo, sin asientos en borrador o pendientes y con la bandeja vacía, la contadora lo cierra (RN-CNT-07). Reabrir exige motivo y queda en la auditoría (RN-CNT-08).', actions: [ps.el, { label: 'Cerrar período', kind: 'primary', disabled: closed || !G.can('cnt.period.close'), title: G.can('cnt.period.close') ? null : 'RN-CNT-21: cierra la CONTADORA', onClick: () => G.ui.confirm({ title: `Cerrar ${pName(ps.value)}`, message: 'Al cerrarlo se bloquean las escrituras con fecha del período en todos los módulos (RN-PLT-05).', confirmLabel: 'Cerrar período', onConfirm: () => tryDo(() => closePeriod(ps.value), `${pName(ps.value)} cerrado`) }) }, { label: 'Reabrir', kind: 'danger', disabled: !closed || !G.can('cnt.period.reopen'), onClick: () => promptReason(`Reabrir ${pName(ps.value)}`, r => { reopenPeriod(ps.value, r); toast('Período reabierto', 'ok'); }, { help: 'RN-CNT-08: el motivo queda en la auditoría.', label: 'Motivo (mínimo 10 caracteres)' }) }] });
    const tasks = closed ? D.where(T.task, t => t.period === ps.value).sort(U.by('seq')) : ensureTasks(ps.value); const bl = closed ? [] : closeBlockers(ps.value);
    const done = tasks.filter(t => ['DONE', 'WAIVED'].includes(t.status)).length;
    const due = G.date.add(G.date.addMonths(ps.value, 1), (G.param('plt_period_close_day') || 5) - 1);
    body.append(kpis([{ label: 'Estado', value: LBL[per.status || 'OPEN'][0], tone: closed ? 'ok' : 'warn', sub: closed ? `cerró ${per.closed_by || ''} el ${F.date(per.cnt_closed_at || per.closed_at)}` : `meta ${F.date(due)}` }, { label: 'Tareas', value: `${done} de ${tasks.length}`, tone: done === tasks.length ? 'ok' : 'warn' }, { label: 'Asientos sin aprobar', value: D.where(T.je, e => e.period === ps.value && ['DRAFT', 'PENDING_APPROVAL'].includes(e.status)).length, onClick: () => { ui.p03 = ps.value; G.go('CNT-03'); } }, { label: 'Bandeja del período', value: inboxOpen(ps.value).length, onClick: () => G.go('CNT-05') }, { label: 'Días para cerrar', value: closed ? F.num(G.date.diff(day(per.cnt_closed_at || per.closed_at), lastDay(ps.value))) : F.num(G.date.diff(G.TODAY, lastDay(ps.value))) + ' y contando', sub: 'KPI-CNT-04' }]));
    body.append(progress(tasks.length ? done / tasks.length * 100 : 0, done === tasks.length ? 'ok' : 'warn'));
    if (bl.length) body.append(notice('RN-CNT-07 · falta: ' + bl.join(' · '), 'warn'));
    body.append(card('Tareas del cierre', h('div', { class: 'stack' }, tasks.map(t => { const chk = !closed && t.auto_check ? checkTask(t.code, t.period) : null; return h('div', { class: 'row between', style: 'border-bottom:1px solid var(--line);padding:8px 0' }, h('div', { style: 'min-width:0;flex:1' }, h('b', null, t.name), h('div', { class: 'muted small' }, t.status === 'WAIVED' ? 'Dispensada: ' + t.waive_reason : t.status === 'DONE' ? `Hecha por ${G.userShort(t.done_by)} el ${F.datetime(t.done_at)}${t.evidence ? ' · ' + t.evidence : ''}` : chk ? chk.detail : t.auto_check ? '' : 'Tarea manual: márcala con su evidencia')), h('div', { class: 'row' }, st(t.status), !closed && t.status === 'PENDING' ? btn('Marcar hecha', () => t.auto_check ? tryDo(() => markTask(t.id), 'Tarea hecha') : promptReason(t.name, r => { markTask(t.id, { evidence: r }); toast('Tarea hecha', 'ok'); }, { label: 'Evidencia (acta, archivo o nota)', submit: 'Marcar hecha' }), { sm: true, kind: 'primary', disabled: !G.can('cnt.entry.prepare') || (chk && !chk.ok), title: chk && !chk.ok ? chk.detail : null }) : null, !closed && t.status === 'PENDING' ? btn('Dispensar', () => promptReason('Dispensar: ' + t.name, r => { markTask(t.id, { waive: true, reason: r }); toast('Tarea dispensada', 'ok'); }, { label: 'Motivo (mínimo 10 caracteres)' }), { sm: true, disabled: !G.can('cnt.period.close') }) : null, !closed && t.status !== 'PENDING' ? btn('Reabrir tarea', () => tryDo(() => reopenTask(t.id), 'Tarea pendiente otra vez'), { sm: true, kind: 'ghost' }) : null)); }))));
    const ev = D.where('accounting_period_events', x => x.period === ps.value).sort(U.by('acted_at', -1));
    if (ev.length) body.append(card('Historial del período', h('div', { class: 'timeline' }, ev.map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.datetime(x.acted_at)), h('span', { class: 'dot' }), h('div', null, h('b', null, x.action === 'CLOSE' ? 'Cerrado' : 'Reabierto'), h('div', { class: 'muted small' }, `${x.acted_by_name || ''}${x.reason ? ' · ' + x.reason : ''}`)))))));
  }

  /* ---------- CNT-13 Estados financieros ---------- */
  function fsTable(code, cols) {
    const res = cols.map(c => fsCompute(code, c.o)); const lines = res[0];
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Rubro'), cols.map(c => h('th', { class: 'r' }, c.label)))), h('tbody', null, lines.map((ln, i) => ln.kind === 'HEADER' ? h('tr', null, h('td', { attrs: { colspan: cols.length + 1 } }, h('b', null, ln.label.toUpperCase()))) : h('tr', { style: ln.kind === 'SUM' || ln.kind === 'RESULT' ? 'font-weight:700' : '' }, h('td', null, ln.label), res.map(r => h('td', { class: 'r' }, F.money(r[i].value))))))));
  }
  function scrStatements(el) {
    const ps = periodSel('p13', G.date.month(G.TODAY)); const site = ui.site13 || '';
    const siteSel = h('select', { class: 'input', style: 'width:auto;max-width:100%', attrs: { 'aria-label': 'Local' }, on: { change: e => { ui.site13 = e.target.value; G.refresh(); } } }, h('option', { value: '' }, 'Todos los locales'), siteOpts().map(([v, l]) => h('option', { value: v, selected: v === site }, l)));
    const body = page(el, { code: 'CNT-13', title: 'Estados financieros', sub: 'Estado de situación financiera y estado de resultados por función y por naturaleza, por marca, local y consolidado, con comparativo mensual. Solo asientos aprobados.', actions: [{ label: 'PDF', kind: 'ghost', onClick: () => G.print() }] });
    body.append(h('div', { class: 'row' }, ps.el, siteSel));
    if (!G.can('cnt.report.view')) { body.append(notice('Ver estados financieros exige cnt.report.view (CONTADORA, GERENTE, AUDITOR o ADMINISTRACIÓN).', 'warn')); return; }
    const months = [G.date.addMonths(ps.value, -2), G.date.addMonths(ps.value, -1), ps.value];
    const brand = G.ctx.brand !== 'ALL' ? G.ctx.brand : null;
    const mcol = m => ({ label: pName(m), o: { from: m, to: lastDay(m) > G.TODAY ? G.TODAY : lastDay(m), brand, site: site || null } });
    const esf = fsCompute('ESF', { to: lastDay(ps.value) > G.TODAY ? G.TODAY : lastDay(ps.value) }); const at = esf.find(x => x.code === 'AT').value, pp = esf.find(x => x.code === 'PP').value;
    const erm = fsCompute('ERF', mcol(ps.value).o); const sales = (erm.find(x => x.code === 'F1') || {}).value || 0, res = (erm.find(x => x.code === 'FR') || {}).value || 0;
    body.append(kpis([{ label: `Ventas netas ${pName(ps.value)}`, value: F.money(sales) }, { label: 'Resultado de operación', value: F.money(res), tone: res >= 0 ? 'ok' : 'bad', sub: sales ? F.pct(res / sales * 100) + ' de las ventas' : '' }, { label: 'Total activo', value: F.money(at) }, { label: 'Cuadre del balance', value: Math.abs(at - pp) < 0.01 ? 'Cuadra' : F.money(R(at - pp)), tone: Math.abs(at - pp) < 0.01 ? 'ok' : 'bad', sub: 'activo = pasivo + patrimonio' }]));
    const brands = D.all('brands').filter(b => b.status !== 'SEPARATED');
    body.append(minw(tabs([
      { key: 'erf', label: 'Resultados por función', render: p => { p.append(card('Comparativo mensual' + (brand ? ' · ' + G.brandName(brand) : ' · consolidado'), fsTable('ERF', months.map(mcol)), { flush: true })); p.append(card('Ventas y resultado por mes', G.ui.chart.bar({ labels: months.map(pName), series: [{ name: 'Ventas netas', values: months.map(m => fsCompute('ERF', mcol(m).o)[0].value) }, { name: 'Resultado de operación', values: months.map(m => fsCompute('ERF', mcol(m).o).find(x => x.code === 'FR').value) }], format: v => F.money(v) }))); } },
      { key: 'ern', label: 'Resultados por naturaleza', render: p => p.append(card('Comparativo mensual', fsTable('ERN', months.map(mcol)), { flush: true })) },
      { key: 'brand', label: 'Por marca', render: p => p.append(card(`Resultados por función de ${pName(ps.value)} por marca`, fsTable('ERF', brands.map(b => ({ label: G.brandName(b.id), o: Object.assign({}, mcol(ps.value).o, { brand: b.id }) })).concat([{ label: 'Consolidado', o: Object.assign({}, mcol(ps.value).o, { brand: null }) }])), { flush: true })) },
      { key: 'esf', label: 'Situación financiera', render: p => { p.append(card('Al cierre de cada mes · empresa (un RUC)', fsTable('ESF', months.map(m => ({ label: pName(m), o: { to: lastDay(m) > G.TODAY ? G.TODAY : lastDay(m) } }))), { flush: true })); if (brand || site) p.append(notice('El estado de situación es de la empresa (un solo RUC para las 5 marcas): no se filtra por marca ni local.', 'info')); } },
    ], { key: 'cnt13tabs' })));
  }

  /* ---------- CNT-14 Balance de comprobación ---------- */
  function scrTrial(el) {
    const from = ui.f14 || G.date.month(G.TODAY), to = ui.t14 || G.TODAY; const site = ui.s14 || '';
    const inp = (k, v) => h('input', { class: 'input', type: 'date', value: v, style: 'width:150px', on: { change: e => { ui[k] = e.target.value; G.refresh(); } } });
    const siteSel = h('select', { class: 'input', style: 'width:auto;max-width:100%', on: { change: e => { ui.s14 = e.target.value; G.refresh(); } } }, h('option', { value: '' }, 'Todos los locales'), siteOpts().map(([v, l]) => h('option', { value: v, selected: v === site }, l)));
    const body = page(el, { code: 'CNT-14', title: 'Balance de comprobación', sub: 'Saldos por cuenta del rango, por marca (selector superior) y local; clic en una cuenta abre su libro mayor con el detalle.', actions: [inp('f14', from), inp('t14', to), siteSel] });
    if (!G.can('cnt.report.view') && !G.can('cnt.entry.prepare')) { body.append(notice('Exige cnt.report.view.', 'warn')); return; }
    const o = { from, to, brand: G.ctx.brand !== 'ALL' ? G.ctx.brand : null, site: site || null };
    const rows = trialBalance(o).filter(r => Math.abs(r.opening) > 0.004 || r.debit || r.credit);
    const td = R(U.sum(rows, r => r.debit)), tc = R(U.sum(rows, r => r.credit));
    body.append(kpis([{ label: 'Cuentas con saldo o movimiento', value: rows.length }, { label: 'Debe del rango', value: F.money(td) }, { label: 'Haber del rango', value: F.money(tc) }, { label: 'Sumas iguales', value: Math.abs(td - tc) < 0.01 ? 'Sí' : F.money(R(td - tc)), tone: Math.abs(td - tc) < 0.01 ? 'ok' : 'bad', sub: o.brand || o.site ? 'con filtro: las cuentas sin marca o local no entran' : 'RN-CNT-01' }]));
    body.append(table({ id: 'cnt14', rows, pageSize: 60, onRow: r => ledgerDrawer(r.code, o), filters: [{ key: 'cls', label: 'Clase', options: '1234567 9'.replace(' ', '').split('').map(c => [c, 'Clase ' + c]), value: r => r.code[0] }],
      columns: [{ key: 'code', label: 'Cuenta', mono: true }, { key: 'name', label: 'Nombre' }, { key: 'opening', label: 'Saldo inicial', align: 'r', render: r => F.money(r.opening) }, { key: 'debit', label: 'Debe', align: 'r', render: r => F.money(r.debit) }, { key: 'credit', label: 'Haber', align: 'r', render: r => F.money(r.credit) }, { key: 'closing', label: 'Saldo final', align: 'r', render: r => F.money(r.closing) }],
      footer: ['', 'Totales', { v: F.money(R(U.sum(rows, r => r.opening))), align: 'r' }, { v: F.money(td), align: 'r' }, { v: F.money(tc), align: 'r' }, { v: F.money(R(U.sum(rows, r => r.closing))), align: 'r' }] }));
  }
  function ledgerDrawer(code, o) {
    drawer(`Libro mayor · ${accLbl(code)}`, (b, close) => {
      const lg = ledger(code, o);
      b.append(dl([['Rango', `${F.date(o.from)} al ${F.date(o.to)}`], ['Saldo inicial', F.money(lg.opening)], ['Movimientos', lg.rows.length], ['Saldo final', F.money(lg.rows.length ? lg.rows[lg.rows.length - 1].balance : lg.opening)]]));
      b.append(table({ id: 'cnt14l', rows: lg.rows.slice().reverse(), pageSize: 25, onRow: x => { close(); entryDrawer(x.e.id); }, columns: [{ key: 'n', label: 'Asiento', mono: true, value: x => x.e.number }, { key: 'd', label: 'Fecha', value: x => x.e.entry_date, render: x => F.date(x.e.entry_date) }, { key: 'g', label: 'Glosa', value: x => x.l.description || x.e.description, render: x => h('span', { class: 'small' }, String(x.l.description || x.e.description).slice(0, 50)) }, { key: 'b', label: 'Marca', value: x => x.l.brand_id ? G.brandName(x.l.brand_id) : '' }, { key: 'db', label: 'Debe', align: 'r', value: x => x.l.debit, render: x => money0(x.l.debit) }, { key: 'cr', label: 'Haber', align: 'r', value: x => x.l.credit, render: x => money0(x.l.credit) }, { key: 'bal', label: 'Saldo', align: 'r', value: x => x.balance, render: x => F.money(x.balance) }] }));
    }, { code: 'CNT-14', wide: true });
  }

  /* ---------- CNT-15 Importación de planilla ---------- */
  function scrPayroll(el) {
    const body = page(el, { code: 'CNT-15', title: 'Importación de planilla', sub: 'Resumen mensual de la planilla (Ayni HR o archivo) por centro de costo que genera su asiento: sueldos, vacaciones, EsSalud y CTS al debe; tributos, provisiones y neto por pagar al haber.', actions: [{ label: 'Importar planilla', kind: 'primary', disabled: !G.can('cnt.entry.prepare'), onClick: () => payrollForm() }] });
    const rows = D.all(T.pay).sort(U.by('period', -1));
    const last = rows.find(r => r.status !== 'VOIDED');
    body.append(kpis([{ label: 'Importaciones', value: rows.length }, { label: 'Último período', value: last ? pName(last.period) : '—' }, { label: 'Sueldos brutos', value: last ? F.money(last.gross_total) : '—', sub: last ? `${last.employees} trabajadores` : '' }, { label: 'Costo empleador', value: last ? F.money(R(last.gross_total + last.essalud_total + last.cts_total + last.vac_total)) : '—' }, { label: 'Fuente', value: G.per ? 'Ayni HR (PER)' : 'Archivo', sub: G.per ? 'conector disponible' : 'PER no está en esta instalación' }]));
    body.append(table({ id: 'cnt15', rows, onRow: r => { const e = r.entry_id && D.get(T.je, r.entry_id); if (e) entryDrawer(e.id); }, columns: [{ key: 'period', label: 'Período', value: r => pName(r.period) }, { key: 'source', label: 'Fuente', value: r => r.source === 'AYNI_HR' ? 'Ayni HR' : 'Archivo ' + (r.file_name || '') }, { key: 'employees', label: 'Trabajadores', align: 'r' }, { key: 'gross_total', label: 'Bruto', align: 'r', render: r => F.money(r.gross_total) }, { key: 'essalud_total', label: 'EsSalud', align: 'r', render: r => F.money(r.essalud_total) }, { key: 'net_total', label: 'Neto', align: 'r', render: r => F.money(r.net_total) }, { key: 'entry', label: 'Asiento', value: r => { const e = r.entry_id && D.get(T.je, r.entry_id); return e ? `${e.number || 'por aprobar'}` : '—'; } }, { key: 'status', label: 'Estado', render: r => { const e = r.entry_id && D.get(T.je, r.entry_id); return r.status === 'VOIDED' ? st('VOIDED') : e ? st(dispStatus(e)) : st(r.status); } }, { key: 'imported_at', label: 'Importó', value: r => `${G.userShort(r.imported_by)} · ${F.date(r.imported_at)}` }] }));
  }
  function payrollForm() {
    drawer('Importar planilla', (b, close) => {
      const open = periods().filter(p => p.status !== 'CLOSED').map(p => [p.period, pName(p.period)]);
      const box = h('div'); const v = { period: open.find(([p]) => !D.find(T.pay, x => x.period === p && x.status !== 'VOIDED')) ? open.find(([p]) => !D.find(T.pay, x => x.period === p && x.status !== 'VOIDED'))[0] : open[0][0], source: G.per ? 'AYNI_HR' : 'FILE' };
      const show = () => { G.ui.clear(box); const pv = payrollPreview(v.period); box.append(kpis([{ label: 'Trabajadores', value: pv.employees }, { label: 'Bruto', value: F.money(pv.gross_total) }, { label: 'EsSalud 9 %', value: F.money(pv.essalud_total) }, { label: 'ONP 13 % retenida', value: F.money(pv.pension_total) }, { label: 'Neto por pagar', value: F.money(pv.net_total) }]), h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Centro de costo', 'Trab.', 'Bruto', 'EsSalud', 'CTS', 'Vacaciones'].map((x, i) => h('th', { class: i > 0 ? 'r' : '' }, x)))), h('tbody', null, pv.lines.map(l => h('tr', null, h('td', null, G.ccName(l.cost_center_id)), h('td', { class: 'r' }, l.employees), h('td', { class: 'r' }, F.money(l.gross)), h('td', { class: 'r' }, F.money(l.essalud)), h('td', { class: 'r' }, F.money(l.cts)), h('td', { class: 'r' }, F.money(l.vac)))))))); };
      b.append(form({ id: 'cnt15', values: v, fields: [{ key: 'period', label: 'Período', type: 'select', options: open, required: true, onChange: x => { v.period = x; show(); } }, { key: 'source', label: 'Fuente', type: 'select', options: [['AYNI_HR', 'Ayni HR (conector)'], ['FILE', 'Archivo Excel de la planilla']], required: true, onChange: x => { v.source = x; } }, { key: 'file_name', label: 'Nombre del archivo', placeholder: 'planilla-2026-10.xlsx' }], submitLabel: 'Importar y generar asiento', onCancel: close, onSubmit: x => { const r = importPayroll(Object.assign({}, x, { period: v.period })); toast(`Planilla de ${pName(r.period)} importada: asiento por aprobar`, 'ok'); close(); G.refresh(); return true; } }));
      b.append(box); show();
      b.append(notice('Los sueldos de áreas comunes (administración, producción, reparto) se reparten por las ventas de cada marca del mes (RN-CNT-16). El asiento queda pendiente de la contadora.', 'info'));
    }, { code: 'CNT-15', wide: true });
  }

  /* ---------- CNT-16 Tablero contable ---------- */
  function scrBoard(el) {
    const ps = periodSel('p16', G.date.month(G.TODAY)); const p = { from: ps.value, to: lastDay(ps.value) > G.TODAY ? G.TODAY : lastDay(ps.value) };
    const body = page(el, { code: 'CNT-16', title: 'Tablero contable', sub: 'KPI-CNT-01 a KPI-CNT-06 del período: lo que falta asentar, aprobar, conciliar y cerrar.', actions: [ps.el] });
    const k = c => { const r = G.kpi(c, p); return r ? r.value : 0; };
    const v1 = k('KPI-CNT-01'), v2 = k('KPI-CNT-02'), v3 = k('KPI-CNT-03'), v4 = k('KPI-CNT-04'), v5 = G.kpi('KPI-CNT-05', p), v6 = k('KPI-CNT-06');
    body.append(kpis([{ label: 'Comprobantes sin asiento', value: F.num(v1), tone: v1 ? 'warn' : 'ok', sub: 'KPI-CNT-01', onClick: () => docsDrawer(p) }, { label: 'Asientos por aprobar', value: F.num(v2), tone: v2 ? 'warn' : 'ok', sub: 'KPI-CNT-02', onClick: () => { ui.p03 = ps.value; G.go('CNT-03'); } }, { label: 'Diferencias SIRE', value: F.num(v3), tone: v3 ? 'bad' : 'ok', sub: 'KPI-CNT-03', onClick: () => G.go('CNT-06') }, { label: 'Días para cerrar el mes', value: F.num(v4, 1), tone: v4 > 15 ? 'warn' : 'ok', sub: 'KPI-CNT-04 · últimos cierres', onClick: () => G.go('CNT-12') }, { label: 'Gastos sin comprobante válido', value: F.pct(v5 ? v5.value : 0), tone: (v5 && v5.value > 5) ? 'warn' : 'ok', sub: v5 ? `KPI-CNT-05 · ${F.money(v5.numerator)} de ${F.money(v5.denominator)}` : 'KPI-CNT-05' }, { label: `Bandeja con más de ${G.param('cnt_inbox_max_age_days')} días`, value: F.num(v6), tone: v6 ? 'bad' : 'ok', sub: 'KPI-CNT-06', onClick: () => G.go('CNT-05') }]));
    const es = D.where(T.je, e => e.period === ps.value && e.status !== 'VOIDED');
    const by = U.groupBy(es, 'source_type');
    const closedP = periods().filter(x => x.status === 'CLOSED' && x.closed_at).slice(0, 8).reverse();
    body.append(h('div', { class: 'grid c2' },
      card('Asientos del período por origen', G.ui.chart.hbar({ items: Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([s, v]) => ({ label: srcName(s), value: v.length })), format: v => F.num(v) })),
      card('Días para cerrar cada mes (KPI-CNT-04)', closedP.length ? G.ui.chart.bar({ labels: closedP.map(x => pName(x.period)), series: [{ name: 'Días', values: closedP.map(x => G.date.diff(day(x.cnt_closed_at || x.closed_at), lastDay(x.period))) }], format: v => F.num(v) + ' días' }) : empty('Sin cierres.'))));
    const nxt = firstOpen(); const bl = closeBlockers(nxt);
    body.append(card(`Próximo cierre: ${pName(nxt)}`, h('div', { class: 'stack' }, bl.length ? bl.map(x => h('div', { class: 'row' }, badge('Pendiente', 'warn'), h('span', null, x))) : notice('Listo para cerrar.', 'ok'), btn('Ir al cierre (CNT-12)', () => { ui.p12 = nxt; G.go('CNT-12'); }, { sm: true, kind: 'primary' }))));
  }
  function docsDrawer(p) { drawer('Comprobantes sin asiento aprobado', (b, close) => { const rows = docsWithoutEntry(p); b.append(table({ id: 'cnt16d', rows, onRow: r => { close(); if (r.entry) entryDrawer(r.entry.id); else if (r.item) itemDrawer(r.item.id); }, filters: [{ key: 'kind', label: 'Tipo', options: [['SALE', 'Venta'], ['PURCHASE', 'Compra'], ['EXPENSE', 'Gasto']] }], columns: [{ key: 'date', label: 'Fecha', render: r => F.date(r.date) }, { key: 'kind', label: 'Tipo', value: r => KIND_NAMES[r.kind] }, { key: 'label', label: 'Documento' }, { key: 'amount', label: 'Importe', align: 'r', render: r => F.money(r.amount) }, { key: 'state', label: 'Situación' }] })); }, { code: 'CNT-16', wide: true }); }

  /* =====================================================================
     Registro y ganchos globales
     ===================================================================== */
  const SC = (G.SPEC.CNT || { screens: [] }).screens; const nm = c => (SC.find(s => s[0] === c) || [c, c])[1];
  const RENDER = { 'CNT-01': scrAccounts, 'CNT-02': scrRules, 'CNT-03': scrEntries, 'CNT-04': scrManual, 'CNT-05': scrInbox, 'CNT-06': el => scrSire(el, 'PURCHASES'), 'CNT-07': el => scrSire(el, 'SALES'), 'CNT-08': scrSubmissions, 'CNT-09': scrBooks, 'CNT-10': scrRegime, 'CNT-11': scrBank, 'CNT-12': scrClose, 'CNT-13': scrStatements, 'CNT-14': scrTrial, 'CNT-15': scrPayroll, 'CNT-16': scrBoard };
  G.register({ code: MOD, name: 'Contabilidad', phase: 2, group: 'Abastecimiento y contabilidad', screens: Object.entries(RENDER).map(([code, render]) => ({ code, name: nm(code), render })) });
  G.alertProviders.push(() => {
    if (!G.canSee(MOD) || !G.modOn(MOD)) return [];
    const out = []; const max = Number(G.param('cnt_inbox_max_age_days') ?? 3);
    const old = D.where(T.inbox, x => ['PENDING', 'CLASSIFIED'].includes(x.status) && G.date.diff(G.TODAY, day(x.created_at)) > max);
    if (old.length) out.push({ module: MOD, title: `${old.length} ítem(s) en la bandeja contable con más de ${max} días`, detail: 'KPI-CNT-06 · la practicante clasifica, la contadora aprueba', tone: 'bad', go: () => G.go('CNT-05') });
    const pa = D.where(T.je, e => e.status === 'PENDING_APPROVAL'); if (pa.length) out.push({ module: MOD, title: `${pa.length} asiento(s) por aprobar`, detail: F.money(R(U.sum(pa, e => e.total_debit))), tone: 'warn', go: () => G.go('CNT-03') });
    const fo = firstOpen(); const due = G.date.add(G.date.addMonths(fo, 1), (G.param('plt_period_close_day') || 5) - 1);
    if (fo < G.date.month(G.TODAY) && G.TODAY > due) out.push({ module: MOD, title: `${pName(fo)} sigue abierto (meta de cierre ${F.date(due)})`, detail: closeBlockers(fo).slice(0, 2).join(' · ') || 'listo para cerrar', tone: 'warn', go: () => { ui.p12 = fo; G.go('CNT-12'); } });
    const sd = D.where(T.sp, p => !p.superseded && p.status === 'WITH_DIFFS'); if (sd.length) out.push({ module: MOD, title: `${U.sum(sd, p => unresolved(p.id).length)} diferencia(s) SIRE sin resolver`, detail: sd.map(p => `${p.register === 'SALES' ? 'ventas' : 'compras'} ${pName(p.period)}`).join(', ') + ' · RN-CNT-18', tone: 'warn', go: () => G.go(sd[0].register === 'SALES' ? 'CNT-07' : 'CNT-06') });
    const br = D.where(T.brc, r => r.status === 'OPEN'); for (const r of br) { const s = reconSummary(r.id); if (Math.abs(s.unexplained) > 0.004) out.push({ module: MOD, title: `Conciliación ${(D.get('cash_accounts', r.cash_account_id) || {}).name || ''} ${pName(r.period)} con diferencia ${F.money(s.unexplained)}`, detail: 'RN-CNT-15 · cargos del banco sin asiento', tone: 'warn', go: () => { ui.ca11 = r.cash_account_id; ui.p11 = r.period; G.go('CNT-11'); } }); }
    return out;
  });
  G.searchProviders.push(q => {
    const s = q.toLowerCase(); const out = [];
    for (const a of D.all(T.acc)) if (a.code.startsWith(q) || a.name.toLowerCase().includes(s)) out.push({ label: `${a.code} · ${a.name}`, sub: 'Cuenta contable', go: () => { G.go('CNT-01'); accDrawer(a.code); } });
    for (const e of D.all(T.je)) if (out.length < 12 && ((e.number || '').includes(q) || (e.description || '').toLowerCase().includes(s))) out.push({ label: e.number || 'Asiento sin número', sub: `${srcName(e.source_type)} · ${String(e.description).slice(0, 50)}`, go: () => { G.go('CNT-03'); entryDrawer(e.id); } });
    for (const it of D.all(T.inbox)) if (out.length < 14 && (it.ref_label || '').toLowerCase().includes(s)) out.push({ label: it.ref_label, sub: 'Bandeja contable · ' + REASONS[it.reason], go: () => { G.go('CNT-05'); itemDrawer(it.id); } });
    return out.slice(0, 10);
  });
  G.scanHandlers.push(code => { const e = D.find(T.je, x => x.number === code); return e ? () => { G.go('CNT-03'); entryDrawer(e.id); } : null; });

  /* =====================================================================
     Datos de ejemplo (orden 50): plan, reglas, apertura y migración
     ene–ago (D-CNT-02), asientos reales de setiembre y octubre, bandeja,
     SIRE, conciliación del BCP, planilla, cierre de setiembre pendiente.
     ===================================================================== */
  const RULES = [
    ['R-VEN-01', 'SALE', 'INVOICE', 'Venta con factura', true, false, [['D', 'FIXED', '1212', 'TOTAL', 'DOC'], ['C', 'FIXED', '40111', 'IGV'], ['C', 'FIXED', '702', 'BASE']]],
    ['R-VEN-02', 'SALE', 'RECEIPT', 'Venta con boleta', true, false, [['D', 'FIXED', '1212', 'TOTAL', 'DOC'], ['C', 'FIXED', '40111', 'IGV'], ['C', 'FIXED', '702', 'BASE']]],
    ['R-VEN-03', 'SALE', 'CREDIT_NOTE', 'Nota de crédito de venta', true, false, [['D', 'FIXED', '702', 'BASE'], ['D', 'FIXED', '40111', 'IGV'], ['C', 'FIXED', '1212', 'TOTAL', 'DOC']]],
    ['R-CV-01', 'COGS', '*', 'Costo de ventas del día (inventario permanente)', true, false, [['D', 'FIXED', '692', 'COST'], ['C', 'DETAIL', null, 'DETAIL']]],
    ['R-COB-01', 'COLLECTION', 'PAYMENT', 'Cobro a clientes', true, false, [['D', 'CASH', null, 'TOTAL', 'CASH'], ['C', 'FIXED', '1212', 'TOTAL', 'DOC']]],
    ['R-COB-02', 'COLLECTION', 'TRANSFER', 'Depósitos y traslados entre cajas y bancos', true, false, [['D', 'CASH_TO', null, 'TOTAL', 'CASH_TO'], ['C', 'CASH', null, 'TOTAL', 'CASH']]],
    ['R-COB-03', 'COLLECTION', 'FEE', 'Comisión de pasarela o adquirente', true, false, [['D', 'DETAIL', null, 'DETAIL'], ['D', 'FIXED', '40111', 'FEE_IGV'], ['C', 'CASH', null, 'TOTAL', 'CASH']]],
    ['R-CMP-01', 'PURCHASE', 'INVOICE', 'Compra con factura', false, false, [['D', 'DETAIL', null, 'DETAIL'], ['D', 'FIXED', '40111', 'IGV'], ['C', 'PAYABLE', null, 'TOTAL', 'DOC']]],
    ['R-CMP-02', 'PURCHASE', 'RECEIPT', 'Compra con boleta (sin crédito fiscal)', false, false, [['D', 'DETAIL', null, 'DETAIL'], ['C', 'PAYABLE', null, 'TOTAL', 'DOC']]],
    ['R-CMP-03', 'PURCHASE', 'CREDIT_NOTE', 'Nota de crédito del proveedor', false, false, [['D', 'PAYABLE', null, 'TOTAL', 'DOC'], ['C', 'FIXED', '40111', 'IGV'], ['C', 'DETAIL', null, 'DETAIL']]],
    ['R-CMP-04', 'PURCHASE', 'FEE_RECEIPT', 'Recibo por honorarios', false, false, [['D', 'DETAIL', null, 'DETAIL'], ['C', 'PAYABLE', null, 'TOTAL', 'DOC']]],
    ['R-NTI-01', 'NTI', '*', 'NTI de la granja (sin IGV, enlace interno)', false, false, [['D', 'DETAIL', null, 'DETAIL'], ['C', 'PARAM', 'cnt_interunit_account_code', 'TOTAL']]],
    ['R-GAS-01', 'EXPENSE', '*', 'Gasto aprobado', false, true, [['D', 'DETAIL', null, 'DETAIL'], ['D', 'FIXED', '40111', 'IGV'], ['C', 'FIXED', '40172', 'WITHHOLDING', 'DOC'], ['C', 'PAYABLE', null, 'TOTAL_PAYABLE', 'DOC']]],
    ['R-PAG-01', 'PAYMENT', 'SUPPLIER', 'Pago a proveedores', false, false, [['D', 'DETAIL', null, 'DETAIL'], ['C', 'CASH', null, 'TOTAL', 'CASH']]],
    ['R-PAG-02', 'PAYMENT', 'EXPENSE', 'Pago de gastos por pagar', false, false, [['D', 'DETAIL', null, 'DETAIL'], ['C', 'CASH', null, 'TOTAL', 'CASH']]],
    ['R-PLA-01', 'PAYROLL', '*', 'Planilla mensual', false, true, [['D', 'DETAIL', null, 'DETAIL'], ['C', 'FIXED', '4031', 'ESSALUD'], ['C', 'FIXED', '4032', 'PENSION'], ['C', 'FIXED', '4151', 'CTS'], ['C', 'FIXED', '4114', 'VAC'], ['C', 'FIXED', '4111', 'NET']]],
    ['R-CON-01', 'CONSUMPTION', '*', 'Consumo de materias primas e insumos en producción', false, false, [['D', 'FIXED', '2311', 'COST'], ['C', 'DETAIL', null, 'DETAIL']]],
    ['R-PRO-01', 'PRODUCTION', '*', 'Producción terminada', false, false, [['D', 'DETAIL', null, 'DETAIL'], ['C', 'FIXED', '2311', 'COST']]],
    ['R-AJI-01', 'INV_ADJUSTMENT', 'WASTE', 'Merma registrada en almacén', false, false, [['D', 'FIXED', '6593', 'COST'], ['C', 'DETAIL', null, 'DETAIL']]],
    ['R-AJI-02', 'INV_ADJUSTMENT', 'ADJUSTMENT_OUT', 'Faltante de inventario', false, false, [['D', 'FIXED', '6593', 'COST'], ['C', 'DETAIL', null, 'DETAIL']]],
    ['R-AJI-03', 'INV_ADJUSTMENT', 'ADJUSTMENT_IN', 'Sobrante de inventario', false, false, [['D', 'DETAIL', null, 'DETAIL'], ['C', 'FIXED', '7599', 'COST']]],
  ];
  const MAP_SUP = { PRODUCER: '6021', SLAUGHTERHOUSE: '6021', RELATED_FARM: '6021', PACKAGING: '6041', INPUTS: '6032', DELIVERY_COMPANY: '6311', VEHICLE_RENTAL: '6354', ADVERTISING: '6371', CONTENT_CREATOR: '6371' };
  const MAP_CAT = { 'DEL-COMB': '6561', 'DEL-PEAJE': '6311', 'DEL-MANT': '6343', 'DEL-SOAT': '6511', 'DEL-ALQ': '6354', 'DEL-MULTA': '6599', 'DEL-ALIM': '6599', 'DEL-MOV': '6311', 'DEL-JOR': '6321', 'DEL-EMP': '6311', 'DEL-PROV': '6311', 'PUB-ANUN': '6371', 'PUB-CREA': '6371', 'COM-MUE': '6599', 'INS-EMP': '6041', 'PRO-INS': '6032', 'EQU-MAN': '6343', 'ALQ-LOC': '6352', 'SER-LUZ': '6361', 'SER-AGUA': '6363', 'SER-INT': '6364', 'ADM-UTI': '6562', 'ADM-TRA': '6399' };

  G.seed(50, function seedCNT() {
    const prevRole = G.ctx.role; G.ctx.role = 'GERENTE';
    const CONT = roleUser('CONTADORA'); const PRS = D.where('users', u => u.role === 'PRACTICANTE_CONTABLE' && u.status === 'ACTIVE').map(u => u.id); const PR1 = PRS[0] || CONT, PR2 = PRS[1] || PR1;
    const r = U.rng(5050);
    try {
      /* plan de cuentas */
      const codes = new Set();
      for (const [code, name, fl = '', dd, dc] of ACC) { const parent = [...codes].filter(c => code.startsWith(c)).sort((a, b) => b.length - a.length)[0] || null; codes.add(code); ins(T.acc, { id: 'gl-' + code, company_id: 'co-dg', code, name, parent_code: parent, level: code.length <= 2 ? 1 : code.length - 1, acc_type: accType(code), nature: accNature(code), postable: fl.includes('P'), requires_cost_center: fl.includes('C'), requires_third_party: fl.includes('T'), requires_brand: fl.includes('B'), dest_debit_code: dd || null, dest_credit_code: dc || null, status: 'ACTIVE' }); }
      /* reglas */
      for (const [code, source, subtype, name, auto, alloc, lines] of RULES) {
        const rr = ins(T.rule, { id: 'jr-' + code, company_id: 'co-dg', code, source, subtype, name, auto_approve: auto, allocate_common: alloc, status: 'ACTIVE', valid_from: '2026-01-01', valid_to: null, version: 1, approved_by: CONT, approved_at: '2026-01-05T10:00', account_map: source === 'PURCHASE' ? { supplier_types: MAP_SUP } : source === 'EXPENSE' ? { categories: MAP_CAT } : {} });
        lines.forEach(([side, from, a, amount_key, third], i) => ins(T.rl, { rule_id: rr.id, seq: i + 1, side, account_from: from, account_code: from === 'FIXED' ? a : null, param_key: from === 'PARAM' ? a : null, amount_key, third: third || null }));
      }
      /* plantillas de estados financieros */
      for (const [code, [name, kind, lines]] of Object.entries(FS)) { const t = ins(T.fst, { id: 'fst-' + code, company_id: 'co-dg', code, name, kind, status: 'ACTIVE' }); lines.forEach((x, i) => ins(T.fsl, { template_id: t.id, seq: i + 1, code: x[0], label: x[1], kind: x[2], refs: x[3] || [], sign: x[4] || 1 })); }
      /* años fiscales (la UIT la carga la contadora: valor de demostración) */
      ins(T.fy, { company_id: 'co-dg', year: 2025, uit_value_pen: 5350, uit_source: 'Cargado por la contadora', revenue_pen: 1012400, uit_confirmed_by: CONT, uit_confirmed_at: '2025-01-10T09:00', regime_result: 'SIMPLIFIED', books: ['RV', 'RC', 'LDS'], notes: 'Año cerrado con libros simplificados.' });
      ins(T.fy, { company_id: 'co-dg', year: 2026, uit_value_pen: 5500, uit_source: 'Cargado por la contadora (verificar con el decreto supremo del año)', revenue_pen: null, uit_confirmed_by: CONT, uit_confirmed_at: '2026-01-12T09:00', notes: 'D-CNT-01: los ingresos se toman de las cuentas 70 y 75 hasta que la contadora cargue la proyección anual.' });
      /* apertura al 01/01/2026 y migración mensual ene–ago (D-CNT-02) */
      const T0 = { third_party_doc: 'SALDOS-2025', third_party_type: 'OTHER', third_party_name: 'Saldos migrados (Excel)' };
      const op = createManual({ kind: 'OPENING', entry_date: '2026-01-01', description: 'Asiento de apertura: balance de comprobación al 31/12/2025 importado de Excel (D-CNT-02)', destination: false, lines: [['1011', 2500, 0], ['104101', 95000, 0], ['1212', 12500, 0, T0], ['2111', 62000, 0], ['2411', 7500, 0], ['2611', 5200, 0], ['3331', 135000, 0], ['3341', 38000, 0], ['3913', 0, 41000], ['4212', 0, 16800, T0], ['40111', 0, 3100], ['5011', 0, 150000]].map(([a, d, c, t]) => Object.assign({ account_code: a, debit: d, credit: c }, t || {})).concat([{ account_code: '5911', debit: 0, credit: R(2500 + 95000 + 12500 + 62000 + 7500 + 5200 + 135000 + 38000 - 41000 - 16800 - 3100 - 150000) }]) }, { user: PR1, at: '2026-01-12T10:00' });
      approveEntry(op.id, { user: CONT, at: '2026-01-12T16:00' });
      const DEF = [['br-DG', 0.69], ['br-M2', 0.12], ['br-M3', 0.08], ['br-M4', 0.03], ['br-M5', 0.08]];
      const split = (amt) => { let acc = 0; return DEF.map(([b, p], i) => { const a = i === DEF.length - 1 ? R(amt - acc) : R(amt * p); acc = R(acc + a); return [b, a]; }); };
      for (let m = 1; m <= 8; m++) {
        const per = `2026-${U.pad(m, 2)}-01`, end = lastDay(per); const S = R(88000 + 1800 * m + U.int(r, -2500, 2500)); const P = R(S * 0.6), C = R(S * 0.61);
        const L = [];
        L.push(Object.assign({ account_code: '1212', debit: R(S + R(S * 0.18)) }, T0)); for (const [b, a] of split(S)) L.push({ account_code: '702', credit: a, brand_id: b }); L.push({ account_code: '40111', credit: R(S * 0.18) });
        for (const [b, a] of split(C)) L.push({ account_code: '692', debit: a, brand_id: b }); L.push({ account_code: '2111', credit: C });
        L.push({ account_code: '6021', debit: P }, { account_code: '40111', debit: R(P * 0.18) }, Object.assign({ account_code: '4212', credit: R(P + R(P * 0.18)) }, T0));
        L.push({ account_code: '2311', debit: P }, { account_code: '2411', credit: P }, { account_code: '2111', debit: C }, { account_code: '2311', credit: C }, { account_code: '2311', debit: R(C - P) }, { account_code: '6211', credit: R(C - P), cost_center_id: 'cc-PROD-L2', brand_id: 'br-DG', description: 'Mano de obra de planta absorbida por la producción' });
        const EXP = [['6211', 9000, 'cc-ADM'], ['6211', 8500, 'cc-PROD-L2'], ['6211', 4200, 'cc-DEL'], ['6352', 9000, 'cc-ADM'], ['6311', 3200, 'cc-DEL'], ['6361', 1600, 'cc-PROD-L2']];
        let paid = 0; for (const [a, v, cc] of EXP) for (const [b, x] of split(v)) { L.push({ account_code: a, debit: x, cost_center_id: cc, brand_id: b }); paid += x; }
        for (const [b, x] of split(R(S * 0.03))) { L.push({ account_code: '6371', debit: x, cost_center_id: 'cc-MKT-' + b.slice(3), brand_id: b }); paid += x; }
        for (const [b, x] of split(1450)) L.push({ account_code: '6814', debit: x, cost_center_id: 'cc-PROD-L2', brand_id: b }); L.push({ account_code: '3913', credit: 1450 });
        L.push({ account_code: '104101', credit: R(paid) });
        const col = R(S * 1.18 * 0.99), pay = R(P * 1.18 * 0.98), igv = R(S * 0.18 - P * 0.18);
        L.push({ account_code: '104101', debit: col }, Object.assign({ account_code: '1212', credit: col }, T0), Object.assign({ account_code: '4212', debit: pay }, T0), { account_code: '104101', credit: pay }, { account_code: '40111', debit: igv }, { account_code: '104101', credit: igv });
        const e = createManual({ kind: 'OPENING', subtype: 'MIGRATION', entry_date: end, description: `Migración de ${pName(per)}: resumen mensual de ventas, costos, compras, gastos y tesorería (sistema anterior, D-CNT-02)`, lines: L }, { user: PR1, at: G.date.add(end, 10) + 'T10:00' });
        approveEntry(e.id, { user: CONT, at: G.date.add(end, 12) + 'T16:00' });
      }
      /* planilla de setiembre (archivo, Ayni HR no conectado) */
      const pay9 = importPayroll({ period: '2026-09-01', source: 'FILE', file_name: 'planilla-2026-09.xlsx' }, { user: PR1, at: '2026-09-30T18:00' });
      if (pay9.entry_id) approveEntry(pay9.entry_id, { user: CONT, at: '2026-10-02T11:00' });
      /* documentos reales de setiembre y octubre, en orden cronológico */
      const jobs = [];
      for (const kind of ['SALE', 'COGS', 'COLLECTION', 'TRANSFER', 'FEE', 'PURCHASE', 'SUPPLIER_PAYMENT', 'EXPENSE', 'EXPENSE_PAYMENT', 'CONSUMPTION', 'PRODUCTION', 'INV_ADJUSTMENT']) for (const x of ENUM[kind]('2026-09-01', G.TODAY)) jobs.push(Object.assign({ kind }, x));
      jobs.sort((a, b) => String(a.t).localeCompare(String(b.t)));
      let leftSep = 0;
      for (const j of jobs) {
        let res; try { res = buildEntry(j.kind, j.id, { at: String(j.t).length > 10 ? String(j.t).slice(0, 16).replace('z', '') : j.date + 'T18:00' }); } catch (e) { continue; }
        const e = res && res.entry; if (!e || res.existing || e.status !== 'PENDING_APPROVAL') continue;
        if (j.date > '2026-10-05') continue;
        if (j.date >= '2026-09-29' && j.date <= '2026-09-30' && j.kind === 'EXPENSE' && leftSep < 2) { leftSep++; continue; }
        approveEntry(e.id, { user: CONT, at: G.date.add(j.date, 2) + 'T10:30' });
      }
      /* asientos manuales */
      const dep = createManual({ entry_date: '2026-09-30', description: 'Depreciación de setiembre 2026 (cámaras, balanzas y vehículos)', lines: prorate(1015, '2026-09-01').map(p => ({ account_code: '6814', debit: p.amount, cost_center_id: 'cc-PROD-L2', brand_id: p.brand })).concat(prorate(435, '2026-09-01').map(p => ({ account_code: '6814', debit: p.amount, cost_center_id: 'cc-ADM', brand_id: p.brand }))).concat([{ account_code: '3913', credit: 1450 }]), submit: true }, { user: PR1, at: '2026-10-01T09:30' });
      approveEntry(dep.id, { user: CONT, at: '2026-10-01T15:00' });
      const bad = createManual({ entry_date: '2026-09-18', description: 'Reclasificación de publicidad de la Marca 2 (cuenta errada)', lines: [{ account_code: '6371', debit: 350, cost_center_id: 'cc-MKT-M2', brand_id: 'br-M2' }, { account_code: '4691', credit: 350 }], submit: true }, { user: PR2, at: '2026-09-19T10:00' });
      approveEntry(bad.id, { user: CONT, at: '2026-09-19T17:00' });
      const rv = reverseEntry(bad.id, 'La contrapartida era 4212 del creador de contenido, no 4691', { user: PR2, at: '2026-09-22T09:00' }); approveEntry(rv.id, { user: CONT, at: '2026-09-22T12:00' });
      createManual({ entry_date: '2026-10-09', description: 'Provisión de energía eléctrica de octubre (estimado según medidor)', lines: prorate(1180, '2026-10-01').map(p => ({ account_code: '6361', debit: p.amount, cost_center_id: 'cc-PROD-L2', brand_id: p.brand })).concat([{ account_code: '4691', credit: 1180 }]), submit: true }, { user: PR2, at: '2026-10-09T16:00' });
      createManual({ entry_date: '2026-10-08', description: 'Reclasificación de gastos de publicidad M2 → M3 (en revisión)', lines: [{ account_code: '6371', debit: 350, cost_center_id: 'cc-MKT-M3', brand_id: 'br-M3' }, { account_code: '6371', credit: 300, cost_center_id: 'cc-MKT-M2', brand_id: 'br-M2' }], submit: false }, { user: PR1, at: '2026-10-08T12:00' });
      /* bandeja: setiembre casi resuelta; octubre en curso */
      const clsFor = it => { const miss = it.missing || [it.reason]; const e = it.entry_id && D.get(T.je, it.entry_id); const l = e && linesOf(e.id).find(x => !x.brand_id || !x.account_code); return { account_code: miss.includes('MISSING_ACCOUNT') ? '6399' : it.reason === 'NO_RULE' ? (kindAlias(it.source_type) === 'SALE' ? '702' : '6371') : null, cost_center_id: (l && l.cost_center_id) || (it.reason === 'NO_RULE' ? 'cc-MKT-DG' : 'cc-ADM'), brand_id: 'br-DG', note: { PO_MISMATCH: 'El proveedor subió el precio por kg; Compras lo confirmó por correo', NO_VALID_RECEIPT: 'Movilidad sin comprobante: no deducible', SIRE_DIFF: 'Revisado con el proveedor' }[it.reason] || 'Clasificado según el contrato del proveedor', action: 'NOT_DEDUCTIBLE' }; };
      const items = D.where(T.inbox, x => x.status === 'PENDING').sort(U.by('created_at'));
      const sepIt = items.filter(x => x.period === '2026-09-01'), octIt = items.filter(x => x.period !== '2026-09-01');
      sepIt.forEach((it, i) => { const at = G.date.add(day(it.created_at), 1) + 'T10:00'; if (i === sepIt.length - 1) return; try { classifyItem(it.id, clsFor(it), { user: PR1, at }); if (i === sepIt.length - 2) return; approveItem(it.id, { user: CONT, at: G.date.add(day(it.created_at), 2) + 'T15:00' }); } catch (e) { } });
      octIt.forEach((it, i) => { if (day(it.created_at) > '2026-10-05') return; const at = G.date.add(day(it.created_at), 1) + 'T11:00'; try { if (i % 3 === 0) return; classifyItem(it.id, clsFor(it), { user: i % 2 ? PR2 : PR1, at }); if (i % 3 === 1) approveItem(it.id, { user: CONT, at: G.date.add(day(it.created_at), 2) + 'T16:00' }); else if (i === 2) returnItem(it.id, 'La marca no corresponde: el servicio fue para la Marca 4 (Despensa)', { user: CONT, at: G.date.add(day(it.created_at), 2) + 'T16:00' }); } catch (e) { } });
      /* SIRE: setiembre presentado; octubre con diferencias */
      const sep = '2026-09-01';
      const pc = importProposal({ register: 'PURCHASES', period: sep, text: sampleProposalText('PURCHASES', sep), file_name: 'propuesta-rce-2026-09.txt', inbox: false }, { user: PR1, at: '2026-10-04T10:00' });
      for (const l of unresolved(pc.proposal.id)) resolveSireLine(l.id, (RESOLUTIONS[l.match_status] || [])[l.match_status === 'MISSING_IN_SYSTEM' ? 1 : 0][0], l.match_status === 'MISSING_IN_SYSTEM' ? 'El comprobante es de la Granja Don Guando (otra unidad del RUC) y se excluye' : 'Revisado con el proveedor: el importe registrado es el correcto', { user: PR1, at: '2026-10-04T12:00' });
      const sc = prepareSubmission({ register: 'PURCHASES', period: sep }, { user: PR1, at: '2026-10-05T09:00' }); markSubmissionSent(sc.id, '20260900' + U.int(r, 100000, 999999), { user: CONT, at: '2026-10-05T10:00' }); markSubmissionResult(sc.id, true, 'CONST-RCE-' + U.int(r, 1000000, 9999999), { user: CONT, at: '2026-10-05T15:00' });
      const pv = importProposal({ register: 'SALES', period: sep, text: sampleProposalText('SALES', sep), file_name: 'propuesta-rvie-2026-09.txt', inbox: false }, { user: PR2, at: '2026-10-03T10:00' });
      for (const l of unresolved(pv.proposal.id)) resolveSireLine(l.id, l.match_status === 'MISSING_IN_PROPOSAL' ? 'ADD_TO_REGISTER' : 'JUSTIFIED', 'Boleta enviada al OSE después de la generación de la propuesta: se agrega en el ajuste', { user: PR2, at: '2026-10-03T12:00' });
      const sv = prepareSubmission({ register: 'SALES', period: sep }, { user: PR2, at: '2026-10-04T09:00' }); markSubmissionSent(sv.id, '20260900' + U.int(r, 100000, 999999), { user: CONT, at: '2026-10-04T10:00' }); markSubmissionResult(sv.id, true, 'CONST-RVIE-' + U.int(r, 1000000, 9999999), { user: CONT, at: '2026-10-04T16:00' });
      const po = importProposal({ register: 'PURCHASES', period: '2026-10-01', text: sampleProposalText('PURCHASES', '2026-10-01'), file_name: 'propuesta-rce-2026-10-preliminar.txt', inbox: false }, { user: PR2, at: '2026-10-09T10:00' });
      matchSire(po.proposal.id, { inbox: true, at: '2026-10-09T10:05' });
      /* conciliación del BCP de setiembre (con cargos del banco sin asentar) */
      importStatement({ cash_account_id: 'ca-BCP-CTE', period: sep, lines: sampleStatement('ca-BCP-CTE', sep), file_name: 'extracto-BCP-CTE-2026-09.csv' }, { user: PR1, at: '2026-10-03T09:00' });
      const rec = recOf('ca-BCP-CTE', sep); const mnt = rec && stmtLines(rec.id).find(l => /MANTENIMIENTO/.test(l.description));
      if (mnt) bookBankCharge(mnt.id, {}, { user: PR1, at: '2026-10-03T11:00' });
      /* tareas de cierre */
      for (let m = 1; m <= 8; m++) { const per = `2026-${U.pad(m, 2)}-01`; for (const t of ensureTasks(per)) Object.assign(t, { status: 'DONE', done_by: CONT, done_at: G.date.add(G.date.addMonths(per, 1), 13) + 'T17:00', evidence: m < 8 ? 'Cierre migrado del sistema anterior' : null }); }
      ensureTasks(sep);
      for (const code of ['SIRE', 'PRODUCTION']) { const t = D.find(T.task, x => x.period === sep && x.code === code); try { markTask(t.id, {}, { user: CONT, at: '2026-10-06T10:00' }); } catch (e) { } }
      const farm = D.find(T.task, x => x.period === sep && x.code === 'FARM'); markTask(farm.id, { evidence: 'Acta de conciliación de NTI de setiembre firmada con la granja (saldo 4699 cuadrado)' }, { user: PR1, at: '2026-10-06T12:00' });
      ensureTasks('2026-10-01');
      /* libros generados */
      generateBook({ book_code: 'LDS', period: '2026-07-01', format: 'PDF' }, { user: CONT, at: '2026-08-14T17:00' });
      generateBook({ book_code: 'LDS', period: '2026-08-01', format: 'PDF' }, { user: CONT, at: '2026-09-14T17:00' });
      generateBook({ book_code: 'LDS', period: '2026-08-01', format: 'XLSX' }, { user: PR1, at: '2026-09-14T17:10' });
    } catch (e) { console.error('Seed CNT', e); } finally { G.ctx.role = prevRole; }
  }, 'CNT contabilidad');

  /* =====================================================================
     Pruebas funcionales: una por criterio CA-CNT-01 a CA-CNT-10
     ===================================================================== */
  const asRole = async (role, fn) => { const prev = G.ctx.role; G.ctx.role = role; try { return await fn(); } finally { G.ctx.role = prev; } };
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y llegó: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code} y no ocurrió`); };
  const mkSale = (type, series, number, sub, igv, tot) => { const c = D.find('customers', x => x.doc_type === 'RUC') || D.find('customers', () => true); return D.insert('sales_documents', { company_id: 'co-dg', establishment_id: 'es-L1', brand_id: 'br-DG', doc_type: type, series, number, full_number: `${series}-${U.pad(number, 8)}`, issue_date: G.TODAY, customer_id: c.id, customer_doc_type: c.doc_type, customer_doc_number: c.doc_number, customer_name: c.full_name, subtotal: sub, igv, total: tot, cost: 0, lines: [], sunat_status: 'ACCEPTED', status: 'ISSUED', currency: 'PEN' }, { silent: true }); };
  const T_ = (name, fn) => G.tests.push({ module: MOD, name, fn });
  T_('CA-CNT-01: factura F001-1250 de S/ 1 180,00 → debe 1212 S/ 1 180,00; haber 40111 S/ 180,00 y 702 S/ 1 000,00; cuadra', async () => {
    const d = mkSale('INVOICE', 'F001', 1250, 1000, 180, 1180);
    const r = buildEntry('SALE', d.id); const e = r.entry; if (!e) throw new Error('No generó el asiento: ' + JSON.stringify(r));
    const ls = linesOf(e.id); const g = (c, k) => R(U.sum(ls.filter(l => l.account_code === c), l => l[k]));
    if (g('1212', 'debit') !== 1180 || g('40111', 'credit') !== 180 || g('702', 'credit') !== 1000) throw new Error(`Líneas inesperadas: ${ls.map(l => l.account_code + ' ' + l.debit + '/' + l.credit).join(', ')}`);
    if (R(U.sum(ls, l => l.debit)) !== R(U.sum(ls, l => l.credit))) throw new Error('No cuadra');
    if (e.status !== 'APPROVED' || !e.number) throw new Error('La regla de ventas es auto_approve: debía quedar aprobado y numerado');
  });
  T_('CA-CNT-02: la practicante no aprueba su asiento manual (RN-CNT-02); la contadora sí y recibe el número siguiente del período', async () => {
    const e = await asRole('PRACTICANTE_CONTABLE', () => createManual({ entry_date: G.TODAY, description: 'Reembolso de caja por cobrar', lines: [{ account_code: '1699', debit: 100, third_party_doc: '20100017491' }, { account_code: '1011', credit: 100 }], submit: true }));
    if (e.status !== 'PENDING_APPROVAL') throw new Error('Debía quedar pendiente de aprobación');
    await asRole('PRACTICANTE_CONTABLE', () => expectFail(() => approveEntry(e.id), 'RN-CNT-02'));
    const per = G.date.month(G.TODAY); const expected = Math.max(0, ...D.where(T.je, x => x.period === per && x.seq).map(x => x.seq)) + 1;
    await asRole('CONTADORA', () => approveEntry(e.id));
    const a = D.get(T.je, e.id); if (a.status !== 'APPROVED' || a.seq !== expected || a.number !== fmtNum(per, expected)) throw new Error(`Número ${a.number} (seq ${a.seq}); se esperaba ${expected}`);
  });
  T_('CA-CNT-03: asiento con debe S/ 100,00 y haber S/ 90,00 → al aprobarse se rechaza con RN-CNT-01', async () => {
    const e = await asRole('PRACTICANTE_CONTABLE', () => createManual({ entry_date: G.TODAY, description: 'Asiento que no cuadra', lines: [{ account_code: '1699', debit: 100, third_party_doc: '20100017491' }, { account_code: '1011', credit: 90 }], submit: false }));
    await asRole('CONTADORA', () => expectFail(() => approveEntry(e.id), 'RN-CNT-01'));
    if (D.get(T.je, e.id).status === 'APPROVED') throw new Error('Quedó aprobado');
  });
  T_('CA-CNT-04: con setiembre 2026 cerrado, un asiento con fecha 15/09/2026 se rechaza con RN-CNT-06', async () => {
    const p = G.period.of('2026-09-15'); D.update('accounting_periods', p.id, { status: 'CLOSED', closed_at: G.TODAY + 'T10:00' }, { silent: true });
    await asRole('CONTADORA', () => expectFail(() => createManual({ entry_date: '2026-09-15', description: 'Ajuste tardío', lines: [{ account_code: '1699', debit: 50, third_party_doc: '20100017491' }, { account_code: '1011', credit: 50 }], submit: true }), 'RN-CNT-06'));
  });
  T_('CA-CNT-05: propuesta SIRE de octubre con 412 comprobantes y 405 registrados (3 con otro importe) → 402 coinciden, 3 con diferencia y 7 faltan en el sistema', async () => {
    const per = '2026-10-01'; let sys = systemPurchases(per);
    const sup = D.find('suppliers', s => s.doc_type === 'RUC' && s.supplier_type === 'PACKAGING') || D.find('suppliers', s => s.doc_type === 'RUC');
    for (let i = sys.length; i < 405; i++) D.insert('purchase_documents', { company_id: 'co-dg', supplier_id: sup.id, doc_type: 'INVOICE', series: 'F900', number: String(10000 + i), issue_date: '2026-10-05', accounting_date: '2026-10-05', currency: 'PEN', exchange_rate: 1, base_taxed: 100, igv: 18, non_taxed: 0, other_charges: 0, total: 118, igv_is_credit: true, status: 'REGISTERED', match_status: 'NOT_CHECKED' }, { silent: true });
    sys = systemPurchases(per); const uniq = new Map(sys.map(s => [s.key, s])); if (uniq.size !== 405) throw new Error(`Registrados únicos: ${uniq.size}`);
    const lines = [...uniq.values()].map((s, i) => ({ issuer_ruc: s.ruc, issuer_name: s.name, doc_type_code: s.type, series: normSer(s.series), number: normNum(s.number), issue_date: s.date, base: s.base, igv: s.igv, total: i < 3 ? R(s.total + 25) : s.total }));
    for (let i = 0; i < 7; i++) lines.push({ issuer_ruc: '20331898008', issuer_name: 'LUZ DEL SUR SAA', doc_type_code: '01', series: 'F104', number: String(990000 + i), issue_date: '2026-10-08', base: 100, igv: 18, total: 118 });
    const r = importProposal({ register: 'PURCHASES', period: per, lines, inbox: false });
    const s = r.summary; if (r.proposal.line_count !== 412 || s.MATCHED !== 402 || s.AMOUNT_DIFF !== 3 || s.MISSING_IN_SYSTEM !== 7 || s.MISSING_IN_PROPOSAL !== 0) throw new Error('Resultado: ' + JSON.stringify(s));
  });
  T_('CA-CNT-06: ingresos S/ 1 500 000 con UIT S/ 5 000 (umbral 300 UIT) → libros simplificados; S/ 1 500 001 → contabilidad completa; sin UIT → RN-CNT-13', async () => {
    await asRole('CONTADORA', () => saveFiscalYear({ year: 2026, uit_value_pen: 5000, revenue_pen: 1500000 }));
    let b = booksRegime('co-dg', 2026); if (b.limit !== 1500000 || b.result !== 'SIMPLIFIED') throw new Error('Con S/ 1 500 000: ' + b.result + ' límite ' + b.limit);
    await asRole('CONTADORA', () => saveFiscalYear({ year: 2026, uit_value_pen: 5000, revenue_pen: 1500001 }));
    b = booksRegime('co-dg', 2026); if (b.result !== 'FULL') throw new Error('Con S/ 1 500 001 debía ser contabilidad completa');
    await asRole('CONTADORA', () => saveFiscalYear({ year: 2027, uit_value_pen: '', revenue_pen: 900000 }));
    expectFail(() => booksRegime('co-dg', 2027), 'RN-CNT-13');
  });
  T_('CA-CNT-07: setiembre con una tarea pendiente no se cierra (RN-CNT-07); con todo hecho queda CLOSED y bloquea escrituras', async () => {
    const per = '2026-09-01'; const ger = roleUser('GERENTE');
    await asRole('CONTADORA', () => expectFail(() => closePeriod(per), 'RN-CNT-07'));
    await asRole('CONTADORA', async () => {
      for (const it of inboxOpen(per)) D.update(T.inbox, it.id, { status: 'APPROVED', approved_by: userId(), approved_at: G.TODAY }, { silent: true });
      for (const e of D.where(T.je, e => e.period === per && e.status === 'DRAFT')) voidEntry(e.id, 'Depuración previa al cierre');
      for (const e of D.where(T.je, e => e.period === per && e.status === 'PENDING_APPROVAL')) approveEntry(e.id, { user: sameUser(e.prepared_by, userId()) ? ger : userId() });
      for (const t of ensureTasks(per)) if (t.status === 'PENDING') { try { markTask(t.id, { evidence: 'Revisado' }); } catch (e) { markTask(t.id, { waive: true, reason: 'Dispensada en la prueba con motivo registrado' }); } }
      closePeriod(per);
    });
    if (G.period.of(per).status !== 'CLOSED' || !G.period.isClosed('2026-09-15')) throw new Error('Setiembre no quedó cerrado');
    await asRole('CONTADORA', () => expectFail(() => createManual({ entry_date: '2026-09-20', description: 'Escritura tardía', lines: [{ account_code: '1699', debit: 10, third_party_doc: '20100017491' }, { account_code: '1011', credit: 10 }] }), 'RN-CNT-06'));
  });
  T_('CA-CNT-08: un documento sin regla de asiento (nota de débito de venta) crea un ítem NO_RULE en la bandeja', async () => {
    const d = mkSale('DEBIT_NOTE', 'FD01', 77, 50, 9, 59);
    const r = buildEntry('SALE', d.id); if (!r.inbox || r.inbox.reason !== 'NO_RULE' || r.inbox.status !== 'PENDING') throw new Error('No llegó a la bandeja como NO_RULE');
    if (liveEntries('SALE', d.id).length) throw new Error('No debía crear asiento');
  });
  T_('CA-CNT-09: cambiar el importe de una línea de un asiento aprobado se rechaza con RN-CNT-03', async () => {
    const e = D.find(T.je, x => x.status === 'APPROVED' && x.source_type === 'SALE'); const l = linesOf(e.id)[0];
    expectFail(() => updateLine(l.id, { debit: R(l.debit + 1), credit: l.credit }), 'RN-CNT-03');
    if (D.get(T.jl, l.id).debit !== l.debit) throw new Error('La línea cambió');
  });
  T_('CA-CNT-10: la practicante clasifica un ítem de la bandeja y no puede aprobarlo (RN-CNT-10); la contadora sí', async () => {
    const d = mkSale('DEBIT_NOTE', 'FD01', 78, 100, 18, 118);
    const it = buildEntry('SALE', d.id).inbox;
    await asRole('PRACTICANTE_CONTABLE', () => classifyItem(it.id, { account_code: '702', brand_id: 'br-DG', cost_center_id: 'cc-VEN-DG', note: 'Intereses moratorios facturados con nota de débito' }));
    await asRole('PRACTICANTE_CONTABLE', () => expectFail(() => approveItem(it.id), 'RN-CNT-10'));
    await asRole('CONTADORA', () => approveItem(it.id));
    const x = D.get(T.inbox, it.id); const e = D.get(T.je, x.entry_id); if (x.status !== 'APPROVED' || !e || e.status !== 'APPROVED') throw new Error('No se aprobó ni generó el asiento');
  });
})();
