/* =====================================================================
   GAS · Gastos con comprobante, centro de costo, aprobaciones y caja chica
   Fase 1 · docs/fase-1/modulos/GAS-gastos.md
   Tablas: expense_categories, expense_approval_rules, petty_cash_funds,
   petty_cash_reports, expenses, expense_allocations, expense_approvals
   (solo inserción) y expense_recurrences (plantillas de gastos fijos).
   Copia a delivery_costs (DEL) los gastos de reparto aprobados (RN-GAS-12).
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, toast, confirm } = G.ui;
  const U = G.util;
  const R = (n, d = 2) => U.round(n, d);
  const GAS = G.gas = {};

  /* ------------------------------------------------------------------
     Catálogos y etiquetas
     ------------------------------------------------------------------ */
  const DOC_TYPES = [['INVOICE', 'Factura'], ['RECEIPT', 'Boleta de venta'], ['FEES_RECEIPT', 'Recibo por honorarios'], ['TICKET', 'Ticket'], ['FOREIGN_INVOICE', 'Factura del exterior'], ['SIMPLE_RECEIPT', 'Recibo simple'], ['MOBILITY_SHEET', 'Planilla de movilidad'], ['NONE', 'Sin comprobante']];
  const NO_VALID = ['SIMPLE_RECEIPT', 'MOBILITY_SHEET', 'NONE'];
  const GROUPS = [['PRODUCTION', 'Producción'], ['DELIVERY', 'Delivery y reparto'], ['COMMERCIAL', 'Comercial'], ['ADVERTISING', 'Publicidad'], ['CONTENT_CREATORS', 'Creadores de contenido'], ['SUPPLIES_PACKAGING', 'Insumos y empaques'], ['EQUIPMENT_MAINTENANCE', 'Equipos y mantenimiento'], ['RENT', 'Alquileres'], ['SERVICES', 'Servicios'], ['ADMIN', 'Administración'], ['PERSONNEL', 'Personal'], ['OTHER', 'Otros']];
  const AREAS = [['PRODUCTION', 'Producción'], ['QUALITY', 'Calidad'], ['WAREHOUSE', 'Almacén'], ['DELIVERY', 'Reparto'], ['SALES', 'Ventas'], ['MARKETING', 'Marketing'], ['ADMIN', 'Administración'], ['FINANCE', 'Finanzas'], ['HR', 'RR. HH.'], ['OTHER', 'Otro']];
  const DC_TYPES = [['FUEL', 'Combustible'], ['MAINTENANCE_PREVENTIVE', 'Mantenimiento preventivo'], ['MAINTENANCE_CORRECTIVE', 'Mantenimiento correctivo'], ['SOAT', 'SOAT'], ['TECH_INSPECTION', 'Revisión técnica'], ['RENT', 'Alquiler de vehículo'], ['TOLL', 'Peaje'], ['PARKING', 'Estacionamiento'], ['FINE', 'Multa'], ['DRIVER_WAGE', 'Jornal del repartidor'], ['DRIVER_MEAL', 'Alimentación del repartidor'], ['DRIVER_TRANSPORT', 'Movilidad del repartidor'], ['DELIVERY_BONUS', 'Bono por entrega'], ['CARRIER_FEE', 'Empresa de delivery'], ['PROVINCE_FREIGHT', 'Flete a provincia'], ['PACKAGING', 'Empaque de reparto'], ['OTHER', 'Otro']];
  const ST = { DRAFT: ['Borrador', ''], SUBMITTED: ['Por aprobar', 'warn'], APPROVED: ['Aprobado', 'ok'], REJECTED: ['Rechazado', 'bad'], PAID: ['Pagado', 'ok'], VOIDED: ['Anulado', 'bad'] };
  const PST = { OPEN: ['Abierta', 'info'], SUBMITTED: ['Enviada', 'warn'], APPROVED: ['Aprobada', 'ok'], REIMBURSED: ['Repuesta', 'ok'], OBSERVED: ['Observada', 'bad'] };
  const FLAG = { OK: ['Válido', 'ok'], NO_VALID_RECEIPT: ['Sin comprobante válido', 'warn'], OBSERVED: ['Observado', 'bad'] };
  const LEVELS = { 1: ['Nivel 1 · jefe de área', 'gas.expense.approve_area'], 2: ['Nivel 2 · administración', 'gas.expense.approve_admin'], 3: ['Nivel 3 · gerencia', 'gas.expense.approve_management'] };
  const lbl = (list, v) => (list.find(x => x[0] === v) || [v, v || '—'])[1];
  const stBadge = s => badge((ST[s] || [s])[0], (ST[s] || [, ''])[1]);
  const pBadge = s => badge((PST[s] || [s])[0], (PST[s] || [, ''])[1]);
  const fBadge = s => badge((FLAG[s] || [s])[0], (FLAG[s] || [, ''])[1]);
  GAS.DOC_TYPES = DOC_TYPES; GAS.docName = v => lbl(DOC_TYPES, v);
  const cat = id => G.db.get('expense_categories', id);
  const catName = id => (cat(id) || {}).name || '—';
  const docLabel = e => e.doc_type === 'NONE' ? 'Sin comprobante' : `${lbl(DOC_TYPES, e.doc_type)} ${[e.doc_series, e.doc_number].filter(Boolean).join('-') || ''}`.trim();
  const isLive = e => !['VOIDED', 'REJECTED'].includes(e.status);
  const counted = e => ['APPROVED', 'PAID'].includes(e.status);
  const userRole = uid => (G.db.get('users', uid) || {}).role;
  const now = () => G.date.now();

  /* ------------------------------------------------------------------
     Tipo de cambio (RN-GAS-13) y niveles (RN-GAS-07)
     ------------------------------------------------------------------ */
  GAS.rate = function (currency, date) {
    if (!currency || currency === 'PEN') return 1;
    const r = G.db.where('exchange_rates', x => x.currency === currency && x.date <= date).sort(U.by('date', -1))[0];
    return r ? r.sell : null;
  };
  GAS.userLevel = function (uid) {
    const role = userRole(uid); if (!role) return 0;
    if (G.can('gas.expense.approve_management', role)) return 3;
    if (G.can('gas.expense.approve_admin', role)) return 2;
    if (G.can('gas.expense.approve_area', role)) return 1;
    return 0;
  };
  GAS.levelFor = function (amountPen, category_id, establishment_id) {
    const specific = G.db.where('expense_approval_rules', r => r.status !== 'INACTIVE' && (r.category_id || r.establishment_id) && (!r.category_id || r.category_id === category_id) && (!r.establishment_id || r.establishment_id === establishment_id) && amountPen >= (r.min_amount || 0) && (r.max_amount == null || amountPen <= r.max_amount));
    if (specific.length) return Math.max(...specific.map(r => r.level));
    const l1 = Number(G.param('gas_level1_max') ?? 300), l2 = Number(G.param('gas_level2_max') ?? 2000);
    return amountPen <= l1 ? 1 : amountPen <= l2 ? 2 : 3;
  };
  GAS.requiredLevel = e => GAS.levelFor(e.amount_pen || 0, e.category_id, e.establishment_id);
  GAS.approvalsOf = id => G.db.where('expense_approvals', a => a.expense_id === id).sort(U.by('decided_at'));

  /* ------------------------------------------------------------------
     Caja chica
     ------------------------------------------------------------------ */
  GAS.fundFor = site => G.db.find('petty_cash_funds', f => f.establishment_id === site && f.status === 'ACTIVE');
  GAS.fundMax = f => Number(f && f.max_expense_amount) || Number(G.param('gas_petty_cash_max_expense') ?? 200);
  GAS.reportExpenses = repId => G.db.where('expenses', e => e.petty_cash_report_id === repId && isLive(e));
  GAS.fundBalance = function (f) {
    const reps = new Set(G.db.where('petty_cash_reports', r => r.fund_id === f.id && r.status !== 'REIMBURSED').map(r => r.id));
    const used = U.sum(G.db.where('expenses', e => reps.has(e.petty_cash_report_id) && isLive(e)), e => e.amount_pen);
    return R(f.fund_amount - used);
  };
  GAS.openReport = function (fund) {
    let rep = G.db.find('petty_cash_reports', r => r.fund_id === fund.id && r.status === 'OPEN');
    if (!rep) {
      const est = G.db.get('establishments', fund.establishment_id) || {};
      rep = G.db.insert('petty_cash_reports', { fund_id: fund.id, number: G.db.next('RCC-' + est.code, `RCC-${est.code}-`, 4), period_from: G.TODAY, period_to: G.TODAY, total_expenses: 0, replenishment_amount: null, status: 'OPEN', submitted_at: null, approved_by: null, approved_at: null });
    }
    return rep;
  };
  GAS.reportAgeDays = function (rep) {
    const es = GAS.reportExpenses(rep.id); if (!es.length) return 0;
    return G.date.diff(G.TODAY, es.map(e => e.issue_date).sort()[0]);
  };

  /* ------------------------------------------------------------------
     Cálculo y validación de un gasto (RN-GAS-01/02/03/05/06/09/10/11/13)
     ------------------------------------------------------------------ */
  GAS.compute = function (d) {
    const total = R(Number(d.total) || 0);
    const igv = d.doc_type === 'INVOICE' ? R(Number(d.igv) || 0) : R(Number(d.igv) || 0);
    const other = R(Number(d.other_taxes) || 0);
    const subtotal = R(total - igv - other);
    const rate = GAS.rate(d.currency || 'PEN', d.issue_date || G.TODAY);
    const amount_pen = rate ? R(total * rate) : null;
    const net_pen = rate ? R((d.doc_type === 'INVOICE' ? subtotal + other : total) * rate) : null;
    const pct = Number(G.param('gas_fees_withholding_pct') ?? 8), thr = Number(G.param('gas_fees_withholding_threshold') ?? 1500);
    const withholding_amount = d.doc_type === 'FEES_RECEIPT' && (amount_pen || 0) > thr ? R(total * pct / 100) : 0;
    const accounting_flag = NO_VALID.includes(d.doc_type) ? 'NO_VALID_RECEIPT' : (d.accounting_flag === 'OBSERVED' ? 'OBSERVED' : 'OK');
    const level = amount_pen != null ? GAS.levelFor(amount_pen, d.category_id, d.establishment_id) : null;
    return { total, igv, other_taxes: other, subtotal, exchange_rate: rate || 0, amount_pen, net_pen, withholding_amount, accounting_flag, level };
  };
  /** lista de problemas [{code,msg}] · submit=true exige además la foto */
  GAS.validate = function (d, { submit = false, selfId = null } = {}) {
    const out = []; const add = (code, msg) => out.push({ code, msg });
    const c = cat(d.category_id); const sup = d.supplier_id && G.db.get('suppliers', d.supplier_id);
    const miss = [];
    if (!d.establishment_id) miss.push('local'); if (!d.cost_center_id) miss.push('centro de costo'); if (!d.brand_id) miss.push('marca');
    if (!d.category_id) miss.push('categoría'); if (!d.issue_date) miss.push('fecha'); if (!(Number(d.total) > 0)) miss.push('monto total'); if (!String(d.description || '').trim()) miss.push('descripción');
    if (miss.length) add('RN-GAS-01', `Faltan datos obligatorios: ${miss.join(', ')}.`);
    if (submit && d.doc_type !== 'NONE' && !d.receipt_file_id) add('RN-GAS-01', 'Para enviarlo a aprobación adjunta la foto del comprobante (solo el tipo «sin comprobante» no la lleva).');
    if (d.issue_date && G.period.isClosed(d.issue_date)) add('RN-GAS-10', `El período ${G.date.monthName(d.issue_date)} está cerrado (RN-PLT-05): no se registran gastos con esa fecha.`);
    if (d.issue_date && d.issue_date > G.TODAY) add('RN-GAS-01', 'La fecha del comprobante no puede ser futura.');
    const cp = GAS.compute(d);
    if (cp.subtotal < 0) add('RN-GAS-02', 'El IGV y otros tributos no pueden superar el total.');
    if (d.doc_type !== 'INVOICE' && cp.igv > 0) add('RN-GAS-02', `Solo la factura lleva IGV con crédito fiscal: en ${lbl(DOC_TYPES, d.doc_type).toLowerCase()} registra el total sin separar IGV.`);
    if (['INVOICE', 'FEES_RECEIPT'].includes(d.doc_type)) {
      const code = d.doc_type === 'FEES_RECEIPT' ? 'RN-GAS-11' : 'RN-GAS-02';
      if (!sup) add(code, `${lbl(DOC_TYPES, d.doc_type)} exige proveedor.`);
      if (!d.doc_number) add(code, `${lbl(DOC_TYPES, d.doc_type)} exige serie y número.`);
      if (d.doc_type === 'INVOICE' && sup && !(sup.doc_type === 'RUC' && U.rucOk(sup.doc_number))) add('RN-GAS-02', `La factura exige un proveedor con RUC válido: ${sup.trade_name || sup.legal_name} tiene ${sup.doc_type} ${sup.doc_number}.`);
    }
    if (c) {
      const need = [];
      if (c.requires_vehicle && !d.vehicle_id) need.push('vehículo');
      if (c.requires_gallons && !(Number(d.fuel_gallons) > 0)) need.push('galones del vale');
      if (c.requires_employee && !d.employee_id) need.push('repartidor o trabajador');
      if (c.requires_supplier && !d.supplier_id) need.push('proveedor');
      if (c.requires_campaign && !d.ad_campaign_id) need.push('campaña');
      if (need.length) add('RN-GAS-03', `La categoría «${c.name}» exige: ${need.join(', ')}.`);
    }
    if (d.supplier_id && d.doc_number && !['NONE', 'MOBILITY_SHEET'].includes(d.doc_type)) {
      const dup = G.db.find('expenses', e => e.id !== selfId && e.status !== 'VOIDED' && e.supplier_id === d.supplier_id && e.doc_type === d.doc_type && (e.doc_series || '') === (d.doc_series || '') && String(e.doc_number) === String(d.doc_number));
      if (dup) add('RN-GAS-05', `El comprobante ${docLabel(d)} de ${G.supName(d.supplier_id)} ya está registrado en ${dup.number} (${(ST[dup.status] || [dup.status])[0].toLowerCase()}). Anúlalo antes si fue un error.`);
    }
    if (d.currency && d.currency !== 'PEN' && !cp.exchange_rate) add('RN-GAS-13', `No hay tipo de cambio de venta ${d.currency} al ${G.fmt.date(d.issue_date)} en MAE.`);
    if (d.pay_source === 'PETTY') {
      const f = GAS.fundFor(d.establishment_id);
      if (!f) add('RN-GAS-09', `El local ${G.siteName(d.establishment_id)} no tiene fondo de caja chica activo.`);
      else if ((cp.amount_pen || 0) > GAS.fundMax(f)) add('RN-GAS-09', `Un gasto de caja chica no supera ${G.fmt.money(GAS.fundMax(f))} por gasto (fondo ${G.siteName(f.establishment_id)}); este es de ${G.fmt.money(cp.amount_pen)}. Regístralo por pagar desde CAJ.`);
    }
    return out;
  };

  const FIELDS = ['establishment_id', 'cost_center_id', 'brand_id', 'sales_channel', 'category_id', 'supplier_id', 'doc_type', 'doc_series', 'doc_number', 'issue_date', 'currency', 'payment_method_id', 'vehicle_id', 'route_id', 'employee_id', 'fuel_gallons', 'fuel_voucher_no', 'odometer_km', 'ad_campaign_id', 'receipt_file_id', 'receipt_photo', 'description', 'recurrence_id'];
  function rowFrom(d, cp) {
    const row = {};
    for (const k of FIELDS) row[k] = d[k] === '' || d[k] === undefined ? null : d[k];
    row.fuel_gallons = d.fuel_gallons ? Number(d.fuel_gallons) : null; row.odometer_km = d.odometer_km ? Number(d.odometer_km) : null;
    row.currency = d.currency || 'PEN';
    Object.assign(row, { company_id: 'co-dg', subtotal: cp.subtotal, igv: cp.igv, other_taxes: cp.other_taxes, total: cp.total, exchange_rate: cp.exchange_rate, amount_pen: cp.amount_pen, net_pen: cp.net_pen, withholding_amount: cp.withholding_amount, accounting_flag: cp.accounting_flag });
    return row;
  }

  /** crea un gasto (borrador o enviado). d.pay_source: PAYABLE | PETTY */
  GAS.create = function (d, { submit = false, user_id } = {}) {
    const issues = GAS.validate(d, { submit });
    if (issues.length) G.fail(issues[0].code, issues[0].msg.replace(/^RN-[A-Z]+-\d+: /, ''), { issues });
    const cp = GAS.compute(d);
    const row = rowFrom(d, cp);
    const by = user_id || G.ctx.userId();
    row.number = G.db.next('GAS', 'GS-', 6); row.status = 'DRAFT'; row.created_by = by; row.pay_source = d.pay_source || 'PAYABLE';
    row.history = [{ at: now(), action: 'Registrado', user: G.userName(by) }];
    if (row.pay_source === 'PETTY') { const f = GAS.fundFor(d.establishment_id); const rep = GAS.openReport(f); row.petty_cash_report_id = rep.id; row.paid_from_account_id = f.cash_account_id; }
    const e = G.db.insert('expenses', row);
    if (d.allocations && d.allocations.length) GAS.setAllocations(e.id, d.allocations);
    if (submit) GAS.submit(e.id, { user_id: by });
    return e;
  };
  GAS.update = function (id, d) {
    const e = G.db.get('expenses', id);
    if (!['DRAFT', 'REJECTED'].includes(e.status)) G.fail('RN-GAS-07', 'Solo se corrige un gasto en borrador o rechazado; uno enviado espera su aprobación.');
    const merged = Object.assign({}, e, d);
    const issues = GAS.validate(merged, { selfId: id });
    if (issues.length) G.fail(issues[0].code, issues[0].msg);
    const cp = GAS.compute(merged);
    const row = rowFrom(merged, cp);
    row.status = 'DRAFT'; row.history = (e.history || []).concat([{ at: now(), action: 'Corregido', user: G.ctx.userName() }]);
    if (e.accounting_flag === 'OBSERVED' && cp.accounting_flag === 'OK') { row.accounting_flag = 'OK'; row.accounting_note = (e.accounting_note || '') + ' · Corregido por el registrador'; }
    return G.db.update('expenses', id, row);
  };
  GAS.submit = function (id, { user_id } = {}) {
    const e = G.db.get('expenses', id);
    if (!['DRAFT', 'REJECTED'].includes(e.status)) G.fail('RN-GAS-01', `El gasto ${e.number} ya está ${(ST[e.status] || [e.status])[0].toLowerCase()}.`);
    const issues = GAS.validate(e, { submit: true, selfId: id });
    if (issues.length) G.fail(issues[0].code, issues[0].msg);
    const lvl = GAS.requiredLevel(e);
    G.db.update('expenses', id, { status: 'SUBMITTED', submitted_at: now(), required_level: lvl, rejection_reason: null, history: (e.history || []).concat([{ at: now(), action: `Enviado a aprobación (${LEVELS[lvl][0]})`, user: G.userName(user_id || G.ctx.userId()) }]) });
    for (const u of G.db.where('users', u => u.status === 'ACTIVE' && GAS.userLevel(u.id) >= lvl && u.id !== e.created_by && u.role !== 'GERENTE')) G.notify({ user_id: u.id, title: `Gasto por aprobar ${e.number}`, body: `${catName(e.category_id)} · ${G.fmt.money(e.amount_pen)} · ${G.userName(e.created_by)}`, ref: { screen: 'GAS-03', id }, tone: 'warn', module: 'GAS' });
    return G.db.get('expenses', id);
  };

  /* ---------- reparto entre centros de costo o marcas (RN-GAS-04) ---------- */
  GAS.allocationsOf = id => G.db.where('expense_allocations', a => a.expense_id === id);
  GAS.checkAllocations = function (e, rows) {
    if (!rows.length) return;
    const pct = R(U.sum(rows, r => r.pct), 4);
    if (Math.abs(pct - 100) > 0.001) G.fail('RN-GAS-04', `El reparto de ${e.number} suma ${G.fmt.num(pct, 2)} % y debe sumar 100 %.`);
    const amt = R(U.sum(rows, r => r.amount));
    if (Math.abs(amt - e.amount_pen) > 0.009) G.fail('RN-GAS-04', `El reparto suma ${G.fmt.money(amt)} y el gasto es de ${G.fmt.money(e.amount_pen)}.`);
    if (rows.some(r => !r.cost_center_id)) G.fail('RN-GAS-04', 'Cada línea del reparto lleva centro de costo.');
  };
  GAS.setAllocations = function (id, rows) {
    const e = G.db.get('expenses', id);
    if (['APPROVED', 'PAID', 'VOIDED'].includes(e.status)) G.fail('RN-GAS-04', `El reparto de ${e.number} ya no cambia: el gasto está ${(ST[e.status] || [e.status])[0].toLowerCase()}.`);
    const clean = rows.filter(r => r && Number(r.pct) > 0).map(r => ({ cost_center_id: r.cost_center_id, brand_id: r.brand_id || null, sales_channel: r.sales_channel || null, pct: Number(r.pct) }));
    let acc = 0;
    clean.forEach((r, i) => { r.amount = i === clean.length - 1 ? R(e.amount_pen - acc) : R(e.amount_pen * r.pct / 100); acc = R(acc + r.amount); });
    GAS.checkAllocations(e, clean);
    for (const a of GAS.allocationsOf(id)) G.db.remove('expense_allocations', a.id);
    for (const r of clean) G.db.insert('expense_allocations', Object.assign({ expense_id: id }, r), { silent: true });
    G.db.update('expenses', id, { allocated: clean.length > 0 }, { silent: true });
    return GAS.allocationsOf(id);
  };
  /** reparto proporcional a las ventas del mes anterior por marca (apoyo de GAS-10) */
  GAS.salesMix = function (date = G.TODAY) {
    const m0 = G.date.addMonths(G.date.month(date), -1), m1 = G.date.add(G.date.month(date), -1);
    const os = G.sales.orders({ from: m0, to: m1 }); const tot = G.sales.total(os) || 1;
    const by = U.groupBy(os, 'brand_id');
    const mix = G.db.all('brands').filter(b => b.status === 'ACTIVE').map(b => ({ brand_id: b.id, pct: R(G.sales.total(by[b.id] || []) / tot * 100, 2) })).filter(x => x.pct > 0);
    const s = R(U.sum(mix, x => x.pct), 2); if (mix.length) mix[0].pct = R(mix[0].pct + 100 - s, 2);
    return mix;
  };

  /* ---------- aprobación (RN-GAS-07/08/12) ---------- */
  function guardDecision(e, uid) {
    if (!e) G.fail('RN-GAS-07', 'Gasto no encontrado.');
    if (e.status !== 'SUBMITTED') G.fail('RN-GAS-07', `Solo se aprueba un gasto enviado; ${e.number} está ${(ST[e.status] || [e.status])[0].toLowerCase()}.`);
    if (uid && uid === e.created_by) G.fail('RN-GAS-08', `${G.userName(uid)} registró ${e.number}: nadie aprueba su propio gasto (segregación de funciones).`);
  }
  /** visto bueno de un nivel inferior al requerido (queda el gasto enviado) */
  GAS.endorse = function (id, { user_id, comment } = {}) {
    const e = G.db.get('expenses', id); const uid = user_id || G.ctx.userId(); guardDecision(e, uid);
    const lvl = GAS.userLevel(uid), req = GAS.requiredLevel(e);
    if (lvl < 1) G.fail('RN-GAS-07', `${G.userName(uid)} no tiene permiso de aprobación de gastos.`);
    if (lvl >= req) return GAS.approve(id, { user_id: uid, comment });
    if (GAS.approvalsOf(id).some(a => a.approver_user_id === uid && a.decision === 'APPROVED')) G.fail('RN-GAS-07', 'Ya diste tu visto bueno a este gasto.');
    G.db.insert('expense_approvals', { expense_id: id, level: lvl, approver_user_id: uid, decision: 'APPROVED', comment: comment || 'Visto bueno', decided_at: now() }, { silent: true });
    G.db.update('expenses', id, { history: (e.history || []).concat([{ at: now(), action: `Visto bueno de ${LEVELS[lvl][0]}; falta ${LEVELS[req][0]}`, user: G.userName(uid) }]) });
    return G.db.get('expenses', id);
  };
  GAS.approve = function (id, { user_id, comment } = {}) {
    const e = G.db.get('expenses', id); const uid = user_id || G.ctx.userId(); guardDecision(e, uid);
    const lvl = GAS.userLevel(uid), req = GAS.requiredLevel(e);
    if (lvl < req) {
      const prev = GAS.approvalsOf(id).filter(a => a.decision === 'APPROVED');
      G.fail('RN-GAS-07', `${e.number} es de ${G.fmt.money(e.amount_pen)} y requiere ${LEVELS[req][0]} (${LEVELS[req][1]})${prev.length ? `; solo tiene aprobación de nivel ${Math.max(...prev.map(a => a.level))}` : ''}. ${G.userName(uid)} aprueba hasta el nivel ${lvl}.`);
    }
    const al = GAS.allocationsOf(id); if (al.length) GAS.checkAllocations(e, al);
    G.db.insert('expense_approvals', { expense_id: id, level: lvl, approver_user_id: uid, decision: 'APPROVED', comment: comment || null, decided_at: now() }, { silent: true });
    G.db.update('expenses', id, { status: 'APPROVED', approved_by: uid, approved_at: now(), history: (e.history || []).concat([{ at: now(), action: `Aprobado (${LEVELS[lvl][0]})`, user: G.userName(uid), note: comment }]) });
    const dc = GAS.copyToDelivery(e);
    G.events.emit('expense.approved', { expense_id: id, number: e.number, amount_pen: e.amount_pen, net_pen: e.net_pen, category_id: e.category_id, cost_center_id: e.cost_center_id, brand_id: e.brand_id, establishment_id: e.establishment_id, ad_campaign_id: e.ad_campaign_id, vehicle_id: e.vehicle_id, delivery_cost_id: dc ? dc.id : null });
    G.notify({ user_id: e.created_by, title: `Gasto ${e.number} aprobado`, body: `${catName(e.category_id)} · ${G.fmt.money(e.amount_pen)}`, ref: { screen: 'GAS-02', id }, tone: 'ok', module: 'GAS' });
    return G.db.get('expenses', id);
  };
  GAS.reject = function (id, { user_id, comment } = {}) {
    const e = G.db.get('expenses', id); const uid = user_id || G.ctx.userId(); guardDecision(e, uid);
    if (!String(comment || '').trim()) G.fail('RN-GAS-07', 'Rechazar exige un comentario para quien registró el gasto.');
    const lvl = GAS.userLevel(uid); if (lvl < 1) G.fail('RN-GAS-07', `${G.userName(uid)} no tiene permiso de aprobación de gastos.`);
    G.db.insert('expense_approvals', { expense_id: id, level: lvl, approver_user_id: uid, decision: 'REJECTED', comment, decided_at: now() }, { silent: true });
    G.db.update('expenses', id, { status: 'REJECTED', rejection_reason: comment, history: (e.history || []).concat([{ at: now(), action: 'Rechazado', user: G.userName(uid), note: comment }]) });
    G.events.emit('expense.rejected', { expense_id: id, number: e.number, reason: comment });
    G.notify({ user_id: e.created_by, title: `Gasto ${e.number} rechazado`, body: comment, ref: { screen: 'GAS-02', id }, tone: 'bad', module: 'GAS' });
    return G.db.get('expenses', id);
  };
  /** RN-GAS-12: copia el gasto de reparto aprobado como costo de DEL (sin IGV) */
  GAS.copyToDelivery = function (e) {
    const c = cat(e.category_id); if (!c || !c.delivery_cost_type) return null;
    const ex = G.db.find('delivery_costs', d => d.expense_id === e.id); if (ex) return ex;
    const row = { cost_date: e.issue_date, cost_type: c.delivery_cost_type, amount: e.net_pen, vehicle_id: e.vehicle_id || null, route_id: e.route_id || null, employee_id: e.employee_id || null, supplier_id: e.supplier_id || null, zone_id: null, fuel_gallons: e.fuel_gallons || null, fuel_voucher_no: e.fuel_voucher_no || null, odometer_km: e.odometer_km || null, expense_id: e.id, establishment_id: e.establishment_id, notes: `${e.number} · ${e.description}`, source: 'GAS' };
    if (G.del && typeof G.del.costFromExpense === 'function') { try { return G.del.costFromExpense(row); } catch (err) { if (err instanceof G.RuleError) throw err; } }
    return G.db.insert('delivery_costs', row, { silent: G._seeding });
  };
  GAS.creatorCost = function (campaign_id, { from, to } = {}) {
    return R(U.sum(G.db.where('expenses', e => counted(e) && e.ad_campaign_id === campaign_id && (cat(e.category_id) || {}).category_group === 'CONTENT_CREATORS' && (!from || e.issue_date >= from) && (!to || e.issue_date <= to)), e => e.net_pen));
  };

  /* ---------- pago, reverso y anulación (RN-GAS-14) ---------- */
  GAS.pay = function (id, { cash_account_id, reference, at } = {}) {
    const e = G.db.get('expenses', id);
    if (e.status !== 'APPROVED') G.fail('RN-GAS-07', `Solo se paga un gasto aprobado; ${e.number} está ${(ST[e.status] || [e.status])[0].toLowerCase()}.`);
    if (e.pay_source === 'PETTY') G.fail('RN-GAS-09', `${e.number} se pagó de la caja chica: se repone con la rendición (GAS-08).`);
    if (!cash_account_id) G.fail('RN-CAJ-01', 'Elige la cuenta desde la que se paga.');
    const date = (at || G.TODAY).slice(0, 10); G.period.assertOpen(date);
    const ca = G.db.get('cash_accounts', cash_account_id) || {};
    if (['BANK', 'WALLET'].includes(ca.account_type) && !reference) G.fail('RN-CAJ-02', `Un pago desde ${ca.name} exige el número de operación.`);
    const net = R(e.amount_pen - (e.withholding_amount || 0) * (e.exchange_rate || 1));
    if (G.caj && typeof G.caj.payExpense === 'function') { try { G.caj.payExpense({ expense_id: id, cash_account_id, amount: net, reference, at: date }); } catch (err) { if (err instanceof G.RuleError) throw err; } }
    G.db.update('expenses', id, { status: 'PAID', paid_from_account_id: cash_account_id, paid_at: date + 'T' + now().slice(11, 16), payment_reference: reference || null, paid_amount: net, history: (e.history || []).concat([{ at: now(), action: `Pagado desde ${ca.name || cash_account_id}${e.withholding_amount ? ` (neto de retención ${G.fmt.money(e.withholding_amount)})` : ''}`, user: G.ctx.userName(), note: reference }]) });
    return G.db.get('expenses', id);
  };
  GAS.reversePayment = function (id, reason) {
    const e = G.db.get('expenses', id);
    if (e.status !== 'PAID') G.fail('RN-GAS-14', `${e.number} no está pagado.`);
    if (!reason) G.fail('RN-GAS-14', 'El reverso del pago exige motivo.');
    if (e.pay_source === 'PETTY') G.fail('RN-GAS-14', 'Un gasto de caja chica repuesto se corrige con un reverso de la rendición en CAJ.');
    if (G.caj && typeof G.caj.reverseExpensePayment === 'function') { try { G.caj.reverseExpensePayment({ expense_id: id, reason }); } catch (err) { if (err instanceof G.RuleError) throw err; } }
    G.db.update('expenses', id, { status: 'APPROVED', payment_reversed_at: now(), history: (e.history || []).concat([{ at: now(), action: 'Reverso del pago (CAJ)', user: G.ctx.userName(), note: reason }]) });
    return G.db.get('expenses', id);
  };
  GAS.void = function (id, reason) {
    const e = G.db.get('expenses', id);
    if (!String(reason || '').trim()) G.fail('RN-GAS-14', 'Anular un gasto exige motivo (los gastos no se borran).');
    if (e.status === 'PAID') G.fail('RN-GAS-14', `${e.number} está pagado: primero registra el reverso del pago en CAJ y luego anúlalo.`);
    if (e.status === 'VOIDED') G.fail('RN-GAS-14', `${e.number} ya está anulado.`);
    G.db.update('expenses', id, { status: 'VOIDED', void_reason: reason, voided_at: now(), history: (e.history || []).concat([{ at: now(), action: 'Anulado', user: G.ctx.userName(), note: reason }]) });
    for (const d of G.db.where('delivery_costs', d => d.expense_id === id)) G.db.update('delivery_costs', d.id, { status: 'VOIDED', notes: (d.notes || '') + ' · gasto anulado: ' + reason });
    return G.db.get('expenses', id);
  };

  /* ---------- bandeja de la contadora (RN-GAS-06) ---------- */
  GAS.inbox = () => G.db.where('expenses', e => e.status !== 'VOIDED' && e.status !== 'DRAFT' && (e.accounting_flag === 'OBSERVED' || (e.accounting_flag === 'NO_VALID_RECEIPT' && !e.accounting_reviewed_at)));
  GAS.accountingReview = function (id, { action, note, category_id }) {
    const e = G.db.get('expenses', id);
    if (!G.can('gas.accounting.review')) G.fail('RN-GAS-06', 'Tu rol no tiene gas.accounting.review.');
    const patch = { accounting_reviewed_at: now(), accounting_reviewed_by: G.ctx.userId() };
    if (action === 'OBSERVE') { if (!note) G.fail('RN-GAS-06', 'Observar exige indicar qué debe corregirse.'); Object.assign(patch, { accounting_flag: 'OBSERVED', accounting_note: note, accounting_reviewed_at: null }); G.notify({ user_id: e.created_by, title: `La contadora observó ${e.number}`, body: note, ref: { screen: 'GAS-02', id }, tone: 'warn', module: 'GAS' }); }
    else if (action === 'NOT_DEDUCTIBLE') Object.assign(patch, { accounting_flag: 'NO_VALID_RECEIPT', accounting_note: note || 'Gasto sin sustento: no deducible ni con crédito fiscal' });
    else if (action === 'VALIDATE') Object.assign(patch, { accounting_flag: 'OK', accounting_note: note || 'Validado por la contadora (D-GAS-05)' });
    if (category_id && category_id !== e.category_id) { patch.category_id = category_id; patch.accounting_note = (patch.accounting_note || '') + ` · Reclasificado de ${catName(e.category_id)} a ${catName(category_id)}`; }
    patch.history = (e.history || []).concat([{ at: now(), action: { OBSERVE: 'Observado por contabilidad', NOT_DEDUCTIBLE: 'Clasificado como no deducible', VALIDATE: 'Validado por contabilidad' }[action] || 'Revisado', user: G.ctx.userName(), note }]);
    return G.db.update('expenses', id, patch);
  };

  /* ---------- rendición de caja chica (RN-GAS-09) ---------- */
  GAS.submitReport = function (repId, { user_id } = {}) {
    const rep = G.db.get('petty_cash_reports', repId); const fund = G.db.get('petty_cash_funds', rep.fund_id);
    if (!['OPEN', 'OBSERVED'].includes(rep.status)) G.fail('RN-GAS-09', `La rendición ${rep.number} ya fue enviada.`);
    const es = GAS.reportExpenses(repId);
    const ok = es.filter(e => counted(e));
    if (!ok.length) G.fail('RN-GAS-09', 'La rendición no tiene gastos aprobados que reponer.');
    const pending = es.filter(e => !counted(e));
    let next = null;
    if (pending.length) { G.db.update('petty_cash_reports', repId, { status: 'SUBMITTED' }, { silent: true }); next = GAS.openReport(fund); for (const e of pending) G.db.update('expenses', e.id, { petty_cash_report_id: next.id }, { silent: true }); }
    const total = R(U.sum(ok, e => e.amount_pen));
    G.db.update('petty_cash_reports', repId, { status: 'SUBMITTED', total_expenses: total, replenishment_amount: total, submitted_at: now(), submitted_by: user_id || G.ctx.userId(), period_to: G.TODAY, period_from: ok.map(e => e.issue_date).sort()[0] });
    G.events.emit('petty_cash.report_submitted', { report_id: repId, number: rep.number, amount: total, fund_id: fund.id });
    return { report: G.db.get('petty_cash_reports', repId), moved: pending.length, next };
  };
  GAS.approveReport = function (repId, { user_id } = {}) {
    const rep = G.db.get('petty_cash_reports', repId); const fund = G.db.get('petty_cash_funds', rep.fund_id); const uid = user_id || G.ctx.userId();
    if (rep.status !== 'SUBMITTED') G.fail('RN-GAS-09', 'Solo se aprueba una rendición enviada.');
    if (uid === fund.custodian_user_id || uid === rep.submitted_by) G.fail('RN-GAS-08', 'Quien rinde la caja chica no aprueba su propia rendición.');
    if (!G.can('gas.petty_cash.manage', userRole(uid)) && GAS.userLevel(uid) < 2) G.fail('RN-GAS-09', 'Aprobar rendiciones requiere gas.petty_cash.manage.');
    return G.db.update('petty_cash_reports', repId, { status: 'APPROVED', approved_by: uid, approved_at: now() });
  };
  GAS.observeReport = function (repId, note) {
    if (!note) G.fail('RN-GAS-09', 'Observar exige motivo.');
    return G.db.update('petty_cash_reports', repId, { status: 'OBSERVED', observation: note });
  };
  GAS.reimburse = function (repId, { from_account_id, reference } = {}) {
    const rep = G.db.get('petty_cash_reports', repId); const fund = G.db.get('petty_cash_funds', rep.fund_id);
    if (rep.status !== 'APPROVED') G.fail('RN-GAS-09', 'Solo se repone una rendición aprobada.');
    if (!from_account_id) G.fail('RN-CAJ-01', 'Elige la cuenta de donde sale la reposición.');
    for (const e of GAS.reportExpenses(repId).filter(counted)) G.db.update('expenses', e.id, { status: 'PAID', paid_at: now(), paid_from_account_id: fund.cash_account_id, payment_reference: rep.number }, { silent: true });
    G.db.update('petty_cash_reports', repId, { status: 'REIMBURSED', reimbursed_at: now(), reimbursed_from: from_account_id, reimbursement_reference: reference || null });
    GAS.openReport(fund);
    return G.db.get('petty_cash_reports', repId);
  };

  /* ---------- gastos recurrentes (alquiler, luz, agua, internet) ---------- */
  GAS.generateRecurring = function (period, { silent } = {}) {
    const out = [];
    for (const t of G.db.where('expense_recurrences', t => t.status === 'ACTIVE')) {
      if (G.db.find('expenses', e => e.recurrence_id === t.id && G.date.month(e.issue_date) === period && e.status !== 'VOIDED')) continue;
      const date = G.date.add(period, Math.min(28, t.day_of_month || 1) - 1);
      const d = { establishment_id: t.establishment_id, cost_center_id: t.cost_center_id, brand_id: t.brand_id, category_id: t.category_id, supplier_id: t.supplier_id, doc_type: t.doc_type, issue_date: date > G.TODAY ? G.TODAY : date, currency: 'PEN', total: t.total, igv: t.doc_type === 'INVOICE' ? R(t.total - t.total / 1.18) : 0, description: `${t.name} · ${G.date.monthName(period)}`, recurrence_id: t.id, pay_source: 'PAYABLE' };
      if (G.period.isClosed(d.issue_date)) continue;
      const cp = GAS.compute(d); const row = rowFrom(d, cp);
      Object.assign(row, { number: G.db.next('GAS', 'GS-', 6), status: 'DRAFT', created_by: t.owner_user_id || G.ctx.userId(), pay_source: 'PAYABLE', history: [{ at: now(), action: `Generado desde la plantilla ${t.code}; falta el comprobante del mes`, user: G.ctx.userName() }] });
      const e = G.db.insert('expenses', row, { silent: !!silent });
      if (t.allocate_by_sales_mix) { try { GAS.setAllocations(e.id, GAS.salesMix(date).map(m => ({ cost_center_id: t.cost_center_id, brand_id: m.brand_id, pct: m.pct }))); } catch (err) { } }
      G.db.update('expense_recurrences', t.id, { last_generated_period: period }, { silent: true });
      out.push(e);
    }
    return out;
  };

  /* ---------- filas para reportes y presupuesto ---------- */
  /** filas por centro de costo/marca (repartidas si hay reparto): {e, cost_center_id, brand_id, sales_channel, amount (con IGV en soles), net (sin IGV)} */
  GAS.rows = function ({ from, to, statuses = ['APPROVED', 'PAID'] } = {}) {
    const es = G.db.where('expenses', e => statuses.includes(e.status) && (!from || e.issue_date >= from) && (!to || e.issue_date <= to));
    const al = U.groupBy(G.db.all('expense_allocations'), 'expense_id');
    const out = [];
    for (const e of es) {
      const a = al[e.id];
      if (a && a.length) for (const x of a) out.push({ e, cost_center_id: x.cost_center_id, brand_id: x.brand_id || e.brand_id, sales_channel: x.sales_channel || e.sales_channel, establishment_id: e.establishment_id, amount: x.amount, net: R((e.net_pen || 0) * x.pct / 100) });
      else out.push({ e, cost_center_id: e.cost_center_id, brand_id: e.brand_id, sales_channel: e.sales_channel, establishment_id: e.establishment_id, amount: e.amount_pen, net: e.net_pen });
    }
    return out;
  };

  /* ------------------------------------------------------------------
     Indicadores (TAB)
     ------------------------------------------------------------------ */
  const inP = (e, p) => e.issue_date >= (p.from || '0000') && e.issue_date <= (p.to || '9999') && (!p.site || e.establishment_id === p.site);
  G.kpiCalc['KPI-GAS-01'] = p => R(U.sum(G.db.where('expenses', e => counted(e) && inP(e, p) && (!p.brand || e.brand_id === p.brand)), e => e.amount_pen));
  G.kpiCalc['KPI-GAS-02'] = p => R(U.sum(GAS.rows({ from: p.from, to: p.to }).filter(r => (!p.site || r.establishment_id === p.site) && (!p.brand || r.brand_id === p.brand)), r => r.amount));
  G.kpiCalc['KPI-GAS-03'] = p => { const es = G.db.where('expenses', e => isLive(e) && e.status !== 'DRAFT' && inP(e, p) && (!p.brand || e.brand_id === p.brand)); const tot = U.sum(es, e => e.amount_pen); const nv = U.sum(es.filter(e => e.accounting_flag === 'NO_VALID_RECEIPT'), e => e.amount_pen); return { value: tot ? R(nv / tot * 100, 1) : 0, numerator: R(nv), denominator: R(tot) }; };
  GAS.approvalHours = e => e.approved_at && e.submitted_at ? (new Date(e.approved_at) - new Date(e.submitted_at)) / 3600000 : null;
  const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  G.kpiCalc['KPI-GAS-04'] = p => { const hs = G.db.where('expenses', e => e.approved_at && inP(e, p) && (!p.brand || e.brand_id === p.brand)).map(GAS.approvalHours).filter(x => x != null && x >= 0); return { value: R(median(hs), 1), denominator: hs.length }; };
  G.kpiCalc['KPI-GAS-05'] = p => G.db.where('expenses', e => e.status === 'SUBMITTED' && (!p.site || e.establishment_id === p.site) && (!p.brand || e.brand_id === p.brand)).length;
  G.kpiCalc['KPI-GAS-06'] = p => { const reps = G.db.where('petty_cash_reports', r => r.status === 'OPEN' && (!p.site || (G.db.get('petty_cash_funds', r.fund_id) || {}).establishment_id === p.site)); return reps.length ? Math.max(...reps.map(GAS.reportAgeDays)) : 0; };

  /* ------------------------------------------------------------------
     Alertas, búsqueda y escaneo
     ------------------------------------------------------------------ */
  G.alertProviders.push(() => {
    const out = [];
    const subm = G.db.where('expenses', e => e.status === 'SUBMITTED');
    if (subm.length) {
      const uid = G.ctx.userId(); const lv = GAS.userLevel(uid);
      const mine = subm.filter(e => e.created_by !== uid && lv >= 1);
      const old = subm.filter(e => e.submitted_at && G.date.diff(G.TODAY, e.submitted_at.slice(0, 10)) >= 3);
      out.push({ module: 'GAS', title: `${subm.length} gastos por aprobar (${G.fmt.money(U.sum(subm, e => e.amount_pen))})`, detail: (mine.length ? `${mine.length} en tu bandeja` : 'Aprobación por monto RN-GAS-07') + (old.length ? ` · ${old.length} con 3 días o más` : ''), tone: old.length ? 'bad' : 'warn', go: () => G.go('GAS-03') });
    }
    const inbox = GAS.inbox();
    if (inbox.length) out.push({ module: 'GAS', title: `${inbox.length} gastos sin comprobante válido u observados`, detail: 'Bandeja de la contadora (RN-GAS-06)', tone: 'info', go: () => G.go('GAS-09') });
    for (const r of G.db.where('petty_cash_reports', r => r.status === 'OPEN')) { const d = GAS.reportAgeDays(r); if (d >= 15) out.push({ module: 'GAS', title: `Caja chica ${r.number} sin rendir hace ${d} días`, detail: 'D-GAS-03: rendición quincenal', tone: 'warn', go: () => G.go('GAS-08') }); }
    return out;
  });
  G.searchProviders.push(q => {
    const s = q.toLowerCase();
    return G.db.where('expenses', e => (e.number || '').toLowerCase().includes(s) || String(e.doc_number || '').toLowerCase() === s || `${e.doc_series || ''}-${e.doc_number || ''}`.toLowerCase().includes(s)).slice(0, 6)
      .map(e => ({ label: `${e.number} · ${catName(e.category_id)}`, sub: `${docLabel(e)} · ${G.fmt.money(e.amount_pen)} · ${(ST[e.status] || [e.status])[0]}`, go: () => { G.go('GAS-02', { all: 1 }); setTimeout(() => GAS.open(e.id), 30); } }));
  });
  G.scanHandlers.push(code => { const e = G.db.find('expenses', x => x.number === code); return e ? () => { G.go('GAS-02', { all: 1 }); setTimeout(() => GAS.open(e.id), 30); } : null; });

  /* ------------------------------------------------------------------
     Interfaz: ficha del gasto (drawer común)
     ------------------------------------------------------------------ */
  function receiptView(e) {
    if (!e.receipt_file_id) return notice(e.doc_type === 'NONE' ? 'Gasto sin comprobante: no lleva foto (RN-GAS-01).' : 'Sin foto del comprobante: no se puede enviar a aprobación (RN-GAS-01).', e.doc_type === 'NONE' ? 'info' : 'warn');
    const sup = e.supplier_id && G.db.get('suppliers', e.supplier_id);
    const txt = [(sup ? sup.legal_name : 'Emisor no identificado'), sup ? `${sup.doc_type} ${sup.doc_number}` : '', `${lbl(DOC_TYPES, e.doc_type).toUpperCase()} ${[e.doc_series, e.doc_number].filter(Boolean).join('-')}`, `Fecha: ${G.fmt.date(e.issue_date)}`, '------------------------------', e.description, '------------------------------', e.igv ? `Op. gravada  ${e.currency} ${G.fmt.num(e.subtotal, 2)}` : null, e.igv ? `IGV 18 %     ${e.currency} ${G.fmt.num(e.igv, 2)}` : null, `TOTAL        ${e.currency} ${G.fmt.num(e.total, 2)}`, e.fuel_gallons ? `Galones: ${G.fmt.num(e.fuel_gallons, 3)} · Vale ${e.fuel_voucher_no || '—'}` : null].filter(x => x !== null).join('\n');
    return h('div', { class: 'stack' }, h('div', { class: 'small muted' }, `Foto del comprobante · ${(e.receipt_photo || {}).name || e.receipt_file_id}`), h('div', { class: 'ticket' }, txt));
  }
  function timeline(items) {
    return h('div', { class: 'timeline' }, items.map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, G.fmt.datetime(x.at)), h('span', { class: 'dot' }), h('div', null, h('b', null, x.action), h('div', { class: 'small muted' }, [x.user, x.note].filter(Boolean).join(' · '))))));
  }
  GAS.open = function (id) {
    const e = G.db.get('expenses', id); if (!e) return;
    drawer(`${e.number} · ${catName(e.category_id)}`, (bd, close) => {
      const uid = G.ctx.userId(); const lv = GAS.userLevel(uid); const req = GAS.requiredLevel(e);
      const act = h('div', { class: 'row' });
      const run = (fn, ok) => { try { fn(); toast(ok, 'ok'); close(); G.refresh(); } catch (err) { toast(err.message, 'bad'); } };
      if (['DRAFT', 'REJECTED'].includes(e.status) && (e.created_by === uid || G.canDo('GAS', 'E'))) {
        act.appendChild(btn('Corregir', () => { close(); G.go('GAS-01', { edit: e.id }); }, { sm: true }));
        act.appendChild(btn('Enviar a aprobación', () => run(() => GAS.submit(e.id), `${e.number} enviado a aprobación`), { kind: 'primary', sm: true }));
      }
      if (e.status === 'SUBMITTED' && lv >= 1) {
        act.appendChild(btn(lv >= req ? 'Aprobar' : `Visto bueno nivel ${lv}`, () => run(() => lv >= req ? GAS.approve(e.id) : GAS.endorse(e.id), lv >= req ? `${e.number} aprobado` : 'Visto bueno registrado'), { kind: 'primary', sm: true }));
        act.appendChild(btn('Rechazar', () => askReject(e, close), { kind: 'danger', sm: true }));
      }
      if (e.status === 'APPROVED' && e.pay_source !== 'PETTY' && G.canDo('GAS', 'A')) act.appendChild(btn('Pagar', () => { close(); payModal(e); }, { kind: 'accent', sm: true }));
      if (e.status === 'PAID' && e.pay_source !== 'PETTY' && G.canDo('GAS', 'A')) act.appendChild(btn('Reverso del pago', () => askReason('Reverso del pago (CAJ)', 'Motivo del reverso', r => run(() => GAS.reversePayment(e.id, r), 'Pago revertido'))));
      if (!['VOIDED', 'PAID'].includes(e.status) && (e.created_by === uid || G.canDo('GAS', 'A'))) act.appendChild(btn('Anular', () => askReason(`Anular ${e.number}`, 'Motivo (RN-GAS-14)', r => run(() => GAS.void(e.id, r), `${e.number} anulado`)), { kind: 'ghost', sm: true }));
      if (['DRAFT', 'SUBMITTED', 'REJECTED'].includes(e.status)) act.appendChild(btn('Reparto', () => { close(); G.go('GAS-10', { id: e.id }); }, { kind: 'ghost', sm: true }));
      if (act.children.length) bd.appendChild(act);
      if (e.status === 'REJECTED') bd.appendChild(notice(`Rechazado: ${e.rejection_reason}`, 'bad'));
      if (e.accounting_flag !== 'OK') bd.appendChild(notice(e.accounting_flag === 'OBSERVED' ? `Observado por contabilidad: ${e.accounting_note || ''}` : 'RN-GAS-06: sin comprobante válido; no da crédito fiscal y queda en la bandeja de la contadora.', e.accounting_flag === 'OBSERVED' ? 'bad' : 'warn'));
      const c = cat(e.category_id);
      bd.appendChild(h('div', { class: 'grid c2' },
        dl([['Estado', stBadge(e.status)], ['Comprobante', docLabel(e)], ['Proveedor', e.supplier_id ? G.supName(e.supplier_id) + ' · ' + ((G.db.get('suppliers', e.supplier_id) || {}).doc_number || '') : '—'], ['Fecha', G.fmt.date(e.issue_date)], ['Categoría', `${c ? c.name : '—'} (${lbl(GROUPS, c && c.category_group)})`], ['Local', G.siteName(e.establishment_id)], ['Centro de costo', G.ccName(e.cost_center_id)], ['Marca', G.brandName(e.brand_id)], ['Canal', e.sales_channel ? G.channelName(e.sales_channel) : '—'], ['Descripción', e.description]]),
        dl([['Moneda', e.currency + (e.currency !== 'PEN' ? ` · T. C. ${G.fmt.num(e.exchange_rate, 3)}` : '')], ['Base', G.fmt.num(e.subtotal, 2)], ['IGV (crédito fiscal)', G.fmt.num(e.igv, 2)], ['Otros tributos', G.fmt.num(e.other_taxes, 2)], ['Total', `${e.currency} ${G.fmt.num(e.total, 2)}`], ['Total en soles', G.fmt.money(e.amount_pen)], ['Costo sin IGV', G.fmt.money(e.net_pen)], e.withholding_amount ? ['Retención 4.ª categoría', G.fmt.money(e.withholding_amount)] : null, ['Nivel requerido', LEVELS[req][0]], ['Pago', e.pay_source === 'PETTY' ? `Caja chica · ${(G.db.get('petty_cash_reports', e.petty_cash_report_id) || {}).number || ''}` : e.status === 'PAID' ? `${(G.db.get('cash_accounts', e.paid_from_account_id) || {}).name || ''} · ${G.fmt.date(e.paid_at)}` : 'Por pagar (CAJ)'], e.vehicle_id ? ['Vehículo', (G.db.get('vehicles', e.vehicle_id) || {}).plate] : null, e.fuel_gallons ? ['Galones · vale', `${G.fmt.num(e.fuel_gallons, 3)} gal · ${e.fuel_voucher_no || '—'}`] : null, e.employee_id ? ['Trabajador', (G.db.get('employees', e.employee_id) || {}).full_name] : null, e.ad_campaign_id ? ['Campaña', (G.db.get('ad_campaigns', e.ad_campaign_id) || {}).name] : null, ['Registró', G.userName(e.created_by)]])));
      const al = GAS.allocationsOf(e.id);
      if (al.length) bd.appendChild(card('Reparto (RN-GAS-04)', table({ id: 'gas-al-' + e.id, search: false, columns: [{ key: 'cc', label: 'Centro de costo', render: a => G.ccName(a.cost_center_id) }, { key: 'b', label: 'Marca', render: a => G.brandName(a.brand_id) }, { key: 'pct', label: '%', align: 'r', render: a => G.fmt.num(a.pct, 2) }, { key: 'amount', label: 'Monto', align: 'r', render: a => G.fmt.money(a.amount) }], rows: al })));
      const dcost = G.db.find('delivery_costs', d => d.expense_id === e.id);
      if (dcost) bd.appendChild(notice(`RN-GAS-12: copiado a DEL como ${lbl(DC_TYPES, dcost.cost_type).toLowerCase()} de ${G.fmt.money(dcost.amount)} sin IGV${dcost.fuel_gallons ? ` · ${G.fmt.num(dcost.fuel_gallons, 3)} gal` : ''}${dcost.status === 'VOIDED' ? ' (anulado)' : ''}.`, 'ok'));
      bd.appendChild(h('div', { class: 'grid c2' }, card('Comprobante', receiptView(e)), card('Aprobaciones e historial', h('div', { class: 'stack' },
        GAS.approvalsOf(e.id).length ? table({ id: 'gas-ap-' + e.id, search: false, columns: [{ key: 'decided_at', label: 'Fecha', render: a => G.fmt.datetime(a.decided_at) }, { key: 'level', label: 'Nivel', align: 'c' }, { key: 'u', label: 'Aprobador', render: a => G.userShort(a.approver_user_id) }, { key: 'decision', label: 'Decisión', render: a => a.decision === 'APPROVED' ? badge('Aprobó', 'ok') : badge('Rechazó', 'bad') }, { key: 'comment', label: 'Comentario' }], rows: GAS.approvalsOf(e.id) }) : h('p', { class: 'muted small' }, 'Sin decisiones todavía (solo inserción).'),
        timeline(e.history || [])))));
    }, { wide: true, code: 'GAS' });
  };
  function askReason(title, label, fn) {
    modal(title, body => { body.appendChild(h('div', { class: 'field' }, h('label', { attrs: { for: 'gas-reason' } }, label), h('textarea', { class: 'input', id: 'gas-reason' }))); }, [{ label: 'Cancelar' }, { label: 'Confirmar', kind: 'primary', onClick: () => { const v = document.getElementById('gas-reason').value.trim(); if (!v) { toast('Escribe el motivo.', 'warn'); return false; } fn(v); } }]);
  }
  function askReject(e, after) {
    askReason(`Rechazar ${e.number}`, 'Comentario para quien registró', c => { try { GAS.reject(e.id, { comment: c }); toast(`${e.number} rechazado`, 'ok'); if (after) after(); G.refresh(); } catch (err) { toast(err.message, 'bad'); } });
  }
  function payModal(e) {
    const accs = G.db.where('cash_accounts', a => ['BANK', 'CASH_REGISTER', 'WALLET'].includes(a.account_type) && a.status === 'ACTIVE');
    modal(`Pagar ${e.number}`, body => {
      body.appendChild(dl([['Proveedor', G.supName(e.supplier_id)], ['Comprobante', docLabel(e)], ['Total', G.fmt.money(e.amount_pen)], e.withholding_amount ? ['Retención 4.ª (se declara)', G.fmt.money(e.withholding_amount)] : null, ['Neto a pagar', G.fmt.money(R(e.amount_pen - (e.withholding_amount || 0) * (e.exchange_rate || 1)))]]));
      body.appendChild(h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { attrs: { for: 'gas-pay-acc' } }, 'Cuenta (CAJ)'), h('select', { class: 'input', id: 'gas-pay-acc' }, accs.map(a => h('option', { value: a.id }, a.name)))),
        h('div', { class: 'field' }, h('label', { attrs: { for: 'gas-pay-ref' } }, 'N.º de operación'), h('input', { class: 'input', id: 'gas-pay-ref', placeholder: 'Obligatorio en banco y billeteras' })),
        h('div', { class: 'field' }, h('label', { attrs: { for: 'gas-pay-at' } }, 'Fecha de pago'), h('input', { class: 'input', type: 'date', id: 'gas-pay-at', value: G.TODAY }))));
    }, [{ label: 'Cancelar' }, { label: 'Registrar pago', kind: 'primary', onClick: () => { try { GAS.pay(e.id, { cash_account_id: document.getElementById('gas-pay-acc').value, reference: document.getElementById('gas-pay-ref').value.trim(), at: document.getElementById('gas-pay-at').value }); toast(`${e.number} pagado`, 'ok'); G.refresh(); } catch (err) { toast(err.message, 'bad'); return false; } } }]);
  }
  const expCols = (extra = []) => [
    { key: 'number', label: 'Gasto', mono: true },
    { key: 'issue_date', label: 'Fecha', render: e => G.fmt.date(e.issue_date) },
    { key: 'cat', label: 'Categoría', value: e => catName(e.category_id) },
    { key: 'doc', label: 'Comprobante', value: e => docLabel(e) },
    { key: 'sup', label: 'Proveedor', value: e => e.supplier_id ? G.supName(e.supplier_id) : (e.employee_id ? (G.db.get('employees', e.employee_id) || {}).full_name : '—') },
    { key: 'site', label: 'Local · CC', value: e => `${G.siteName(e.establishment_id)} · ${(G.db.get('cost_centers', e.cost_center_id) || {}).code || ''}` },
    { key: 'brand', label: 'Marca', value: e => G.brandName(e.brand_id) + (e.allocated ? ' +rep.' : '') },
    { key: 'amount_pen', label: 'Total S/', align: 'r', render: e => G.fmt.money(e.amount_pen) },
    ...extra,
    { key: 'status', label: 'Estado', render: e => h('span', { class: 'row', style: 'gap:4px' }, stBadge(e.status), e.accounting_flag !== 'OK' ? fBadge(e.accounting_flag) : null) },
  ];
  const brandOpts = () => G.scope.brands().map(b => [b.id, G.brandName(b.id)]);
  const siteOpts = () => G.scope.sites().map(s => [s.id, s.short || s.name]);
  const ccOpts = () => G.db.where('cost_centers', c => c.status === 'ACTIVE').map(c => [c.id, `${c.code} · ${c.name}`]);
  const catOpts = () => G.db.where('expense_categories', c => c.status === 'ACTIVE').sort(U.by('code')).map(c => [c.id, `${c.name}`]);

  /* ------------------------------------------------------------------
     GAS-01 Registrar gasto (formulario y app del repartidor)
     ------------------------------------------------------------------ */
  let S01 = null;
  const DRIVER_VEHICLE = { 'us-pcondori': 've-MTA-123', 'us-hticona': 've-BXR-871', 'us-jchoque': 've-MTC-789' };
  function blank01(params) {
    const u = G.scope.user() || {};
    const site = G.ctx.site !== 'ALL' ? G.ctx.site : ((u.sites || [])[0] || 'es-L1');
    return { mode: G.ctx.role === 'REPARTIDOR' ? 'APP' : 'FULL', establishment_id: site, brand_id: G.ctx.brand !== 'ALL' ? G.ctx.brand : 'br-DG', cost_center_id: '', category_id: '', doc_type: 'INVOICE', issue_date: G.TODAY, currency: 'PEN', total: '', igv: '', other_taxes: 0, igvManual: false, pay_source: params.petty ? 'PETTY' : 'PAYABLE', description: '', ruc_q: '', supplier_id: '', doc_series: '', doc_number: '', driver: G.ctx.role === 'REPARTIDOR' ? G.ctx.userId() : 'us-pcondori' };
  }
  function screen01(el, params) {
    if (!S01 || params.reset || (params.edit && S01.editId !== params.edit)) {
      S01 = blank01(params);
      if (params.edit) { const e = G.db.get('expenses', params.edit); if (e) Object.assign(S01, U.clone(e), { editId: e.id, mode: 'FULL', ruc_q: e.supplier_id ? (G.db.get('suppliers', e.supplier_id) || {}).doc_number : '', igvManual: true }); }
      if (params.petty) { S01.pay_source = 'PETTY'; if (params.site) S01.establishment_id = params.site; }
    }
    const st = S01;
    const canCreate = G.can('gas.expense.create') || G.canDo('GAS', 'C');
    const body = page(el, { code: 'GAS-01', title: st.editId ? `Corregir ${st.number}` : 'Registrar gasto', sub: 'Foto del comprobante, proveedor por RUC, categoría, centro de costo, marca y local obligatorios; el nivel de aprobación sale del monto.', actions: [G.ui.pills([['FULL', 'Formulario'], ['APP', 'App del repartidor']], st.mode, v => { st.mode = v; G.refresh(); })] });
    if (!canCreate) body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene gas.expense.create: puedes ver el formulario pero no guardar.`, 'warn'));
    if (st.mode === 'APP') return appView(body, st);
    const wrap = h('div', { class: 'grid side-r' });
    const formBox = h('div'); const sumBox = h('div', { class: 'stack' });
    wrap.append(formBox, sumBox); body.appendChild(wrap);
    const redraw = () => { G.ui.clear(formBox); formBox.appendChild(buildForm(st, redraw, updateSum)); updateSum(); };
    function updateSum() { G.ui.clear(sumBox); sumBox.appendChild(summary(st)); }
    redraw();
  }
  function autoIgv(st) { if (st.doc_type === 'INVOICE' && !st.igvManual) st.igv = st.total ? R(Number(st.total) - Number(st.total) / 1.18) : ''; if (st.doc_type !== 'INVOICE') st.igv = 0; }
  function fld(st, key, label, type, o = {}) {
    const id = 'g01-' + key; let input;
    if (type === 'select') input = h('select', { class: 'input', id, disabled: o.disabled }, o.empty === false ? null : h('option', { value: '' }, o.empty || '—'), (o.options || []).map(([v, l]) => h('option', { value: v, selected: String(st[key] ?? '') === String(v) }, l)));
    else if (type === 'textarea') input = h('textarea', { class: 'input', id, placeholder: o.placeholder }, st[key] ?? '');
    else input = h('input', { class: 'input', id, type, value: st[key] ?? '', placeholder: o.placeholder, readOnly: !!o.readonly, attrs: { step: type === 'number' ? 'any' : null, min: o.min, inputmode: type === 'number' ? 'decimal' : null } });
    input.addEventListener(type === 'select' ? 'change' : 'input', () => { let v = input.value; if (type === 'number') v = v === '' ? '' : Number(v); st[key] = v; if (o.onChange) o.onChange(v); });
    return h('div', { class: 'field' + (o.span2 ? ' span2' : '') }, h('label', { attrs: { for: id } }, label, o.req ? ' *' : ''), input, o.help ? h('div', { class: 'help' }, o.help) : null);
  }
  function supplierFinder(st, redraw, updateSum) {
    const sup = st.supplier_id && G.db.get('suppliers', st.supplier_id);
    const inp = h('input', { class: 'input', id: 'g01-ruc', value: st.ruc_q || '', placeholder: 'RUC, DNI o nombre', attrs: { inputmode: 'numeric' } });
    const res = h('div', { class: 'small' });
    const look = () => {
      const q = inp.value.trim(); st.ruc_q = q; G.ui.clear(res);
      if (!q) { st.supplier_id = ''; if (updateSum) updateSum(); return; }
      const hit = G.db.find('suppliers', s => s.doc_number === q) || (q.length >= 3 && !/^\d+$/.test(q) ? G.db.find('suppliers', s => (s.trade_name + ' ' + s.legal_name).toLowerCase().includes(q.toLowerCase())) : null);
      if (hit) { st.supplier_id = hit.id; if (updateSum) updateSum(); res.appendChild(h('span', null, badge('Proveedor registrado', 'ok'), ' ', `${hit.legal_name} · ${hit.doc_type} ${hit.doc_number} · SUNAT ${hit.sunat_status === 'ACTIVE' ? 'activo' : hit.sunat_status}`)); return; }
      st.supplier_id = '';
      if (/^\d{11}$/.test(q)) {
        if (!U.rucOk(q)) { res.appendChild(h('span', { style: 'color:var(--bad)' }, 'RN-GAS-02: el RUC no tiene un dígito verificador válido (módulo 11 SUNAT).')); return; }
        res.appendChild(h('span', null, badge('Consulta RUC (adaptador de prueba INT)', 'info'), ` ${q.startsWith('10') ? 'PERSONA NATURAL' : 'EMPRESA'} ${q.slice(2, 6)} · ACTIVO · HABIDO `, btn('Registrar proveedor', () => {
          const s = G.db.insert('suppliers', { doc_type: 'RUC', doc_number: q, legal_name: `PROVEEDOR ${q} ${q.startsWith('10') ? '' : 'SAC'}`.trim(), trade_name: `Proveedor ${q.slice(-4)}`, supplier_type: 'SERVICES', status: 'ACTIVE', payment_terms_days: 0, sunat_status: 'ACTIVE', rating: 3, created_from: 'GAS' });
          st.supplier_id = s.id; toast('Proveedor registrado desde la consulta RUC', 'ok'); redraw();
        }, { sm: true })));
      } else if (/^\d+$/.test(q)) res.appendChild(h('span', { class: 'muted' }, 'Escribe los 11 dígitos del RUC.'));
      else res.appendChild(h('span', { class: 'muted' }, 'Sin coincidencias.'));
    };
    inp.addEventListener('change', () => { look(); redraw(); });
    setTimeout(look, 0);
    return h('div', { class: 'field span2' }, h('label', { attrs: { for: 'g01-ruc' } }, 'Proveedor (RUC validado)', ['INVOICE', 'FEES_RECEIPT'].includes(st.doc_type) ? ' *' : ''), inp, res, sup ? null : h('div', { class: 'help' }, 'Escribe el RUC y pulsa Tab: se valida el dígito verificador y se consulta SUNAT.'));
  }
  function buildForm(st, redraw, updateSum) {
    const c = cat(st.category_id) || {};
    const grid = h('div', { class: 'form-grid' });
    const onCat = v => { const k = cat(v); if (k) { if (k.default_cost_center_id) st.cost_center_id = k.default_cost_center_id; if (k.default_doc_type) st.doc_type = k.default_doc_type; } autoIgv(st); redraw(); };
    grid.append(
      fld(st, 'category_id', 'Categoría', 'select', { req: true, options: catOpts(), empty: 'Elige la categoría', onChange: onCat }),
      fld(st, 'issue_date', 'Fecha del comprobante', 'date', { req: true, onChange: updateSum }),
      fld(st, 'establishment_id', 'Local', 'select', { req: true, options: siteOpts(), empty: false, onChange: updateSum }),
      fld(st, 'cost_center_id', 'Centro de costo', 'select', { req: true, options: ccOpts(), empty: 'Elige el centro de costo', onChange: updateSum }),
      fld(st, 'brand_id', 'Marca', 'select', { req: true, options: brandOpts(), empty: false, onChange: updateSum, help: 'Si el gasto es compartido, repártelo entre marcas en GAS-10.' }),
      fld(st, 'sales_channel', 'Canal (opcional)', 'select', { options: G.CHANNELS, onChange: updateSum }),
      fld(st, 'doc_type', 'Tipo de comprobante', 'select', { req: true, options: DOC_TYPES, empty: false, onChange: () => { autoIgv(st); redraw(); } }),
    );
    if (!['NONE', 'MOBILITY_SHEET'].includes(st.doc_type)) grid.append(
      h('div', { class: 'field' }, h('label', { attrs: { for: 'g01-doc_series' } }, 'Serie y número', ['INVOICE', 'FEES_RECEIPT'].includes(st.doc_type) ? ' *' : ''), h('div', { style: 'display:grid;grid-template-columns:90px minmax(0,1fr);gap:6px' },
        (() => { const i = h('input', { class: 'input', id: 'g01-doc_series', value: st.doc_series || '', placeholder: 'F001' }); i.addEventListener('input', () => { st.doc_series = i.value.toUpperCase().trim(); updateSum(); }); return i; })(),
        (() => { const i = h('input', { class: 'input', id: 'g01-doc_number', value: st.doc_number || '', placeholder: '345', attrs: { 'aria-label': 'Número' } }); i.addEventListener('input', () => { st.doc_number = i.value.trim(); updateSum(); }); return i; })())));
    grid.append(supplierFinder(st, redraw, updateSum));
    grid.append(
      fld(st, 'currency', 'Moneda', 'select', { empty: false, options: [['PEN', 'Soles (PEN)'], ['USD', 'Dólares (USD)']], onChange: updateSum }),
      fld(st, 'total', 'Total del comprobante', 'number', { req: true, min: 0, onChange: () => { autoIgv(st); const i = document.getElementById('g01-igv'); if (i && !st.igvManual) i.value = st.igv; updateSum(); } }),
    );
    if (st.doc_type === 'INVOICE') grid.append(fld(st, 'igv', 'IGV (18 %, crédito fiscal)', 'number', { min: 0, onChange: () => { st.igvManual = true; updateSum(); }, help: 'Se calcula del total; corrígelo si la factura tiene partes inafectas.' }), fld(st, 'other_taxes', 'Otros tributos (ISC, ICBPER)', 'number', { min: 0, onChange: updateSum }));
    if (c.requires_vehicle || c.category_group === 'DELIVERY') grid.append(fld(st, 'vehicle_id', 'Vehículo', 'select', { req: !!c.requires_vehicle, options: G.db.all('vehicles').map(v => [v.id, `${v.plate} · ${v.vehicle_type === 'MOTO' ? 'moto' : 'furgoneta'}${v.ownership === 'RENTED' ? ' alquilada' : ''}`]), onChange: updateSum }));
    if (c.requires_gallons) grid.append(fld(st, 'fuel_gallons', 'Galones del vale', 'number', { req: true, min: 0, onChange: updateSum }), fld(st, 'fuel_voucher_no', 'N.º de vale', 'text', { onChange: updateSum }), fld(st, 'odometer_km', 'Kilometraje', 'number', { min: 0 }));
    if (c.requires_employee || c.category_group === 'DELIVERY') grid.append(fld(st, 'employee_id', 'Repartidor o trabajador', 'select', { req: !!c.requires_employee, options: G.db.where('employees', x => x.status === 'ACTIVE').map(x => [x.id, `${x.full_name} · ${x.position}`]), onChange: updateSum }));
    if (c.category_group === 'DELIVERY') { const routes = G.db.where('delivery_routes', r => r.route_date === st.issue_date); if (routes.length) grid.append(fld(st, 'route_id', 'Ruta (DEL)', 'select', { options: routes.map(r => [r.id, `${r.code} · ${G.userShort(r.driver_user_id)}`]) })); }
    if (c.requires_campaign || ['ADVERTISING', 'CONTENT_CREATORS'].includes(c.category_group)) grid.append(fld(st, 'ad_campaign_id', 'Campaña (ADS)', 'select', { req: !!c.requires_campaign, options: G.db.all('ad_campaigns').filter(a => !st.brand_id || a.brand_id === st.brand_id).map(a => [a.id, `${a.name} · ${a.platform}`]), onChange: updateSum, help: 'ADS suma estos gastos al costo de la campaña (KPI-ADS-07).' }));
    grid.append(fld(st, 'pay_source', 'Cómo se paga', 'select', { empty: false, options: [['PAYABLE', 'Por pagar desde CAJ (proveedor o reembolso)'], ['PETTY', `Caja chica del local (máx. ${G.fmt.money(GAS.fundMax(GAS.fundFor(st.establishment_id)))})`]], onChange: updateSum }));
    grid.append(fld(st, 'description', 'Descripción', 'textarea', { req: true, placeholder: 'Qué se compró o pagó y para qué', onChange: updateSum }));
    // foto
    const photo = h('div', { class: 'field span2' }, h('label', null, 'Foto del comprobante', st.doc_type !== 'NONE' ? ' *' : ''),
      h('div', { class: 'row' },
        (() => { const f = h('input', { type: 'file', id: 'g01-photo', attrs: { accept: 'image/*,application/pdf', capture: 'environment' }, style: 'max-width:100%' }); f.addEventListener('change', () => { const x = f.files && f.files[0]; if (x) { st.receipt_file_id = 'fa-' + U.uid('img').slice(-6); st.receipt_photo = { name: x.name, size: x.size, taken_at: now() }; redraw(); } }); return f; })(),
        btn('Tomar foto (simulada)', () => { st.receipt_file_id = 'fa-' + U.uid('img').slice(-6); st.receipt_photo = { name: `comprobante-${st.doc_series || 'S'}-${st.doc_number || 'SN'}.jpg`, size: 284000, taken_at: now() }; redraw(); }, { sm: true }),
        st.receipt_file_id ? badge('Foto adjunta · ' + ((st.receipt_photo || {}).name || st.receipt_file_id), 'ok') : badge(st.doc_type === 'NONE' ? 'No requiere foto' : 'Falta la foto', st.doc_type === 'NONE' ? '' : 'warn'),
        st.receipt_file_id ? btn('Quitar', () => { st.receipt_file_id = null; st.receipt_photo = null; redraw(); }, { sm: true, kind: 'ghost' }) : null),
      h('div', { class: 'help' }, 'D-GAS-04: registro manual con foto; la lectura automática (OCR o XML) queda para una versión posterior.'));
    grid.append(photo);
    const save = submit => {
      try {
        const d = Object.assign({}, st);
        let e;
        if (st.editId) { e = GAS.update(st.editId, d); if (submit) e = GAS.submit(e.id); }
        else e = GAS.create(d, { submit });
        toast(submit ? `${e.number} enviado a aprobación (${LEVELS[GAS.requiredLevel(e)][0]})` : `${e.number} guardado como borrador`, 'ok');
        S01 = null; G.go('GAS-02');
        setTimeout(() => GAS.open(e.id), 40);
      } catch (err) { toast(err.message, 'bad'); }
    };
    const can = G.can('gas.expense.create') || G.canDo('GAS', 'C');
    return card(st.editId ? 'Datos del gasto' : 'Nuevo gasto', h('div', { class: 'stack' }, grid, h('div', { class: 'form-actions' },
      btn('Limpiar', () => { S01 = null; G.go('GAS-01', { reset: 1 }); }, { kind: 'ghost' }),
      btn('Guardar borrador', () => save(false), { disabled: !can }),
      btn('Enviar a aprobación', () => save(true), { kind: 'primary', disabled: !can }))));
  }
  function summary(st) {
    const cp = GAS.compute(st); const issues = GAS.validate(st, { submit: true, selfId: st.editId });
    const f = st.pay_source === 'PETTY' ? GAS.fundFor(st.establishment_id) : null;
    const lv = cp.level || 1;
    return h('div', { class: 'stack' },
      card('Cálculo en vivo', h('div', { class: 'stack' }, dl([
        ['Base', `${st.currency || 'PEN'} ${G.fmt.num(cp.subtotal, 2)}`], ['IGV', `${G.fmt.num(cp.igv, 2)}${st.doc_type === 'INVOICE' ? ' (crédito fiscal)' : ''}`], ['Otros tributos', G.fmt.num(cp.other_taxes, 2)],
        ['Total', `${st.currency || 'PEN'} ${G.fmt.num(cp.total, 2)}`], st.currency !== 'PEN' ? ['Tipo de cambio venta', cp.exchange_rate ? G.fmt.num(cp.exchange_rate, 3) + ' (MAE, RN-GAS-13)' : 'sin tipo de cambio'] : null,
        ['Total en soles', G.fmt.money(cp.amount_pen)], ['Costo sin IGV', G.fmt.money(cp.net_pen)], cp.withholding_amount ? ['Retención 4.ª categoría', `${G.fmt.money(cp.withholding_amount)} (D-GAS-02: ${G.param('gas_fees_withholding_pct')} % desde ${G.fmt.money(G.param('gas_fees_withholding_threshold'))})`] : null,
        ['Aprobación', LEVELS[lv][0]], f ? ['Caja chica', `Saldo ${G.fmt.money(GAS.fundBalance(f))} · máx. ${G.fmt.money(GAS.fundMax(f))} por gasto`] : null,
        ['Contabilidad', fBadge(cp.accounting_flag)]]),
        cp.accounting_flag === 'NO_VALID_RECEIPT' ? notice('RN-GAS-06: se acepta, sin crédito fiscal, y pasa a la bandeja de la contadora.', 'warn') : null)),
      card('Antes de enviar', issues.length ? h('div', { class: 'stack' }, issues.map(i => h('div', { class: 'small', style: 'color:var(--bad)' }, (i.msg.startsWith('RN-') ? '' : i.code + ': ') + i.msg))) : notice('Listo para enviar a aprobación.', 'ok')));
  }
  function appView(body, st) {
    const drivers = G.db.where('users', u => u.role === 'REPARTIDOR' && u.status === 'ACTIVE');
    if (G.ctx.role !== 'REPARTIDOR') body.appendChild(h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Simular el celular de:'), G.ui.pills(drivers.map(d => [d.id, G.userShort(d.id)]), st.driver, v => { st.driver = v; G.refresh(); })));
    const uid = st.driver; const u = G.db.get('users', uid) || {};
    const q = st.app = st.app || { kind: 'FUEL', doc_type: 'INVOICE', total: '', gallons: '', km: '', vale: '', ruc: '', series: '', number: '', photo: false };
    const kinds = [['FUEL', 'Combustible', 'DEL-COMB'], ['TOLL', 'Peaje', 'DEL-PEAJE'], ['MEAL', 'Alimentación', 'DEL-ALIM'], ['MOB', 'Movilidad', 'DEL-MOV']];
    const k = kinds.find(x => x[0] === q.kind); const c = G.db.find('expense_categories', x => x.code === k[2]);
    const veh = G.db.get('vehicles', DRIVER_VEHICLE[uid]) || G.db.all('vehicles')[0];
    const scr = h('div', { class: 'phone-screen' });
    const head = h('div', { style: 'padding:14px;background:var(--primary);color:var(--primary-ink)' }, h('b', null, 'Mis gastos de ruta'), h('div', { class: 'small' }, `${u.name || '—'} · ${veh ? veh.plate : ''} · ${G.fmt.date(G.TODAY)}`));
    const inner = h('div', { class: 'stack', style: 'padding:14px' });
    inner.appendChild(h('div', { class: 'grid c2', style: 'gap:8px' }, kinds.map(([v, l]) => btn(l, () => { q.kind = v; q.doc_type = v === 'MOB' ? 'MOBILITY_SHEET' : v === 'TOLL' ? 'TICKET' : v === 'MEAL' ? 'RECEIPT' : 'INVOICE'; G.refresh(); }, { kind: q.kind === v ? 'primary' : '' }))));
    const inp = (label, key, type = 'text', ph) => { const i = h('input', { class: 'input', id: 'gapp-' + key, type, value: q[key], placeholder: ph, attrs: { inputmode: type === 'number' ? 'decimal' : null, step: 'any' } }); i.addEventListener('input', () => { q[key] = i.value; }); return h('div', { class: 'field' }, h('label', { attrs: { for: 'gapp-' + key } }, label), i); };
    const dsel = h('select', { class: 'input', id: 'gapp-doc' }, DOC_TYPES.filter(d => ['INVOICE', 'RECEIPT', 'TICKET', 'MOBILITY_SHEET', 'NONE'].includes(d[0])).map(([v, l]) => h('option', { value: v, selected: q.doc_type === v }, l)));
    dsel.addEventListener('change', () => { q.doc_type = dsel.value; G.refresh(); });
    inner.append(h('div', { class: 'field' }, h('label', { attrs: { for: 'gapp-doc' } }, 'Comprobante'), dsel), inp('Monto total S/', 'total', 'number', '0.00'));
    if (q.doc_type === 'INVOICE') inner.append(inp('RUC del grifo o proveedor', 'ruc', 'text', '20…'), h('div', { class: 'grid c2', style: 'gap:8px' }, inp('Serie', 'series', 'text', 'F001'), inp('Número', 'number', 'text', '345')));
    if (q.kind === 'FUEL') inner.append(h('div', { class: 'grid c2', style: 'gap:8px' }, inp('Galones', 'gallons', 'number'), inp('Kilometraje', 'km', 'number')), inp('N.º de vale', 'vale'));
    inner.append(h('div', { class: 'row' }, btn(q.photo ? 'Foto lista' : 'Tomar foto', () => { q.photo = !q.photo; G.refresh(); }, { kind: q.photo ? 'accent' : '' }), q.doc_type === 'NONE' || q.doc_type === 'MOBILITY_SHEET' ? h('span', { class: 'small muted' }, 'Sin comprobante válido: va a la contadora (RN-GAS-06)') : null));
    inner.appendChild(btn('Enviar gasto', () => {
      try {
        const sup = q.doc_type === 'INVOICE' ? G.db.find('suppliers', s => s.doc_number === q.ruc.trim()) : null;
        if (q.doc_type === 'INVOICE' && !sup) G.fail(U.rucOk(q.ruc.trim()) ? 'RN-GAS-02' : 'RN-GAS-02', U.rucOk(q.ruc.trim()) ? `El RUC ${q.ruc} no está registrado: pide a administración que lo registre o usa el formulario completo.` : 'El RUC no es válido (dígito verificador).');
        const total = Number(q.total);
        const e = GAS.create({ establishment_id: (u.sites || [])[0] || 'es-L1', cost_center_id: 'cc-DEL', brand_id: 'br-DG', category_id: c.id, doc_type: q.doc_type, supplier_id: sup ? sup.id : null, doc_series: q.series.toUpperCase(), doc_number: q.number, issue_date: G.TODAY, currency: 'PEN', total, igv: q.doc_type === 'INVOICE' ? R(total - total / 1.18) : 0, vehicle_id: veh ? veh.id : null, employee_id: u.employee_id, fuel_gallons: q.kind === 'FUEL' ? Number(q.gallons) : null, odometer_km: q.km ? Number(q.km) : null, fuel_voucher_no: q.vale || null, description: `${k[1]} en ruta · ${veh ? veh.plate : ''}`, receipt_file_id: q.photo ? 'fa-' + U.uid('img').slice(-6) : null, receipt_photo: q.photo ? { name: 'foto-celular.jpg', taken_at: now() } : null, pay_source: q.kind === 'FUEL' ? 'PAYABLE' : 'PETTY' }, { submit: true, user_id: uid });
        st.app = null; toast(`${e.number} enviado: ${G.fmt.money(e.amount_pen)} (${LEVELS[GAS.requiredLevel(e)][0]})`, 'ok'); G.refresh();
      } catch (err) { toast(err.message, 'bad'); }
    }, { kind: 'primary' }));
    const mine = G.db.where('expenses', e => e.created_by === uid).sort(U.by('created_at', -1)).slice(0, 6);
    inner.appendChild(h('div', { class: 'stack', style: 'gap:6px' }, h('b', { class: 'small' }, 'Últimos gastos'), mine.length ? mine.map(e => h('div', { class: 'row between small', style: 'border-bottom:1px solid var(--line);padding:4px 0', on: { click: () => GAS.open(e.id) } }, h('span', null, `${G.fmt.date(e.issue_date)} · ${catName(e.category_id)}`), h('span', null, G.fmt.money(e.amount_pen), ' ', stBadge(e.status)))) : h('span', { class: 'muted small' }, 'Sin gastos registrados.')));
    scr.append(head, inner);
    body.appendChild(h('div', { class: 'grid c2' }, h('div', { class: 'phone' }, scr), card('Cómo funciona en el celular', h('div', { class: 'stack small' },
      h('p', null, 'El repartidor elige el tipo de gasto, toma la foto y envía. El sistema completa local, centro de costo DEL, marca, vehículo y su ficha de trabajador; el combustible exige galones (RN-GAS-03).'),
      h('p', null, 'Al aprobarse, el gasto se copia como costo de reparto sin IGV en DEL (RN-GAS-12) y suma al costo por entrega.'),
      h('p', null, 'Peajes, alimentación y movilidad salen de la caja chica del local (máximo por gasto RN-GAS-09); la movilidad sin comprobante queda marcada para la contadora (RN-GAS-06).')))));
  }

  /* ------------------------------------------------------------------
     GAS-02 Mis gastos
     ------------------------------------------------------------------ */
  function screen02(el, params) {
    const uid = G.ctx.userId(); const all = G.can('gas.expense.view_all') && (params.all || G.ctx.role === 'GERENTE' || G.ctx.role === 'AUDITOR');
    const rows = G.scope.filter(G.db.where('expenses', e => all || e.created_by === uid)).sort(U.by('created_at', -1));
    const body = page(el, { code: 'GAS-02', title: all ? 'Gastos registrados' : 'Mis gastos', sub: all ? 'Todos los gastos en tu alcance de marca y local, con estado, observaciones y rechazos.' : 'Tus gastos con su estado, observaciones de la contadora y motivo de rechazo.', actions: [G.can('gas.expense.view_all') ? btn(all ? 'Solo los míos' : 'Ver todos', () => G.go('GAS-02', all ? {} : { all: 1 }), { kind: 'ghost' }) : null, { label: 'Registrar gasto', kind: 'primary', icon: '+', onClick: () => G.go('GAS-01', { reset: 1 }) }].filter(Boolean) });
    const sum = s => R(U.sum(rows.filter(e => s.includes(e.status)), e => e.amount_pen));
    body.appendChild(kpis([
      { label: 'Borradores', value: rows.filter(e => e.status === 'DRAFT').length, sub: 'Sin enviar' },
      { label: 'Por aprobar', value: rows.filter(e => e.status === 'SUBMITTED').length, sub: G.fmt.money(sum(['SUBMITTED'])), tone: 'warn' },
      { label: 'Aprobados por pagar', value: rows.filter(e => e.status === 'APPROVED').length, sub: G.fmt.money(sum(['APPROVED'])) },
      { label: 'Rechazados u observados', value: rows.filter(e => e.status === 'REJECTED' || e.accounting_flag === 'OBSERVED').length, tone: 'bad' },
      { label: 'Pagados del mes', value: G.fmt.money(R(U.sum(rows.filter(e => e.status === 'PAID' && e.issue_date >= G.date.month(G.TODAY)), e => e.amount_pen))) },
    ]));
    const obs = rows.filter(e => e.status === 'REJECTED' || e.accounting_flag === 'OBSERVED');
    if (obs.length && !all) body.appendChild(notice(h('div', null, h('b', null, 'Corrige y reenvía: '), obs.slice(0, 4).map(e => `${e.number} (${e.rejection_reason || e.accounting_note})`).join(' · ')), 'warn'));
    body.appendChild(table({ id: 'gas02', rows, onRow: e => GAS.open(e.id), columns: expCols(all ? [{ key: 'by', label: 'Registró', value: e => G.userShort(e.created_by) }] : []), filters: [{ key: 'status', label: 'Estado', options: Object.entries(ST).map(([k, v]) => [k, v[0]]) }, { key: 'month', label: 'Mes', options: [['2026-10', 'oct 2026'], ['2026-09', 'set 2026']], value: e => e.issue_date.slice(0, 7) }, { key: 'grp', label: 'Grupo', options: GROUPS, value: e => (cat(e.category_id) || {}).category_group }, { key: 'accounting_flag', label: 'Contabilidad', options: Object.entries(FLAG).map(([k, v]) => [k, v[0]]) }] }));
  }

  /* ------------------------------------------------------------------
     GAS-03 Bandeja de aprobación
     ------------------------------------------------------------------ */
  function screen03(el) {
    const uid = G.ctx.userId(); const lv = GAS.userLevel(uid);
    const rows = G.scope.filter(G.db.where('expenses', e => e.status === 'SUBMITTED')).sort(U.by('submitted_at'));
    const body = page(el, { code: 'GAS-03', title: 'Bandeja de aprobación', sub: `Aprobación por monto: hasta ${G.fmt.money(G.param('gas_level1_max'))} nivel 1, hasta ${G.fmt.money(G.param('gas_level2_max'))} nivel 2 y más nivel 3. Nadie aprueba su propio gasto.` });
    body.appendChild(notice(lv ? `Tu nivel de aprobación: ${LEVELS[lv][0]} (${LEVELS[lv][1]}). Los gastos de mayor nivel puedes darles visto bueno.` : `Tu rol (${G.roleName()}) no aprueba gastos; solo ves la bandeja.`, lv ? 'info' : 'warn'));
    const byLv = l => rows.filter(e => GAS.requiredLevel(e) === l);
    const ages = rows.map(e => (new Date(G.date.now()) - new Date(e.submitted_at)) / 3600000);
    body.appendChild(kpis([
      { label: 'Por aprobar', value: rows.length, sub: G.fmt.money(R(U.sum(rows, e => e.amount_pen))), tone: rows.length ? 'warn' : '' },
      ...[1, 2, 3].map(l => ({ label: LEVELS[l][0], value: byLv(l).length, sub: G.fmt.money(R(U.sum(byLv(l), e => e.amount_pen))) })),
      { label: 'Espera más larga', value: rows.length ? G.fmt.num(Math.max(...ages) / 24, 1) + ' días' : '—', tone: ages.some(a => a > 72) ? 'bad' : '' },
      { label: 'Mediana de aprobación (KPI-GAS-04)', value: G.fmt.num((G.kpi('KPI-GAS-04', { from: '2026-09-01' }) || {}).value, 1) + ' h' },
    ]));
    const act = e => {
      if (!lv) return [];
      const req = GAS.requiredLevel(e); const own = e.created_by === uid;
      const run = (fn, ok) => { try { fn(); toast(ok, 'ok'); G.refresh(); } catch (err) { toast(err.message, 'bad'); } };
      return [
        btn('Aprobar', () => run(() => GAS.approve(e.id), `${e.number} aprobado`), { sm: true, kind: 'primary', title: own ? 'RN-GAS-08: es tu gasto' : lv < req ? `Requiere ${LEVELS[req][0]}` : '' }),
        lv < req ? btn(`Visto bueno N${lv}`, () => run(() => GAS.endorse(e.id), 'Visto bueno registrado'), { sm: true }) : null,
        btn('Rechazar', () => askReject(e), { sm: true, kind: 'danger' }),
      ].filter(Boolean);
    };
    body.appendChild(table({ id: 'gas03', rows, onRow: e => GAS.open(e.id), actions: act, columns: [
      { key: 'number', label: 'Gasto', mono: true },
      { key: 'submitted_at', label: 'Enviado', render: e => G.fmt.datetime(e.submitted_at) },
      { key: 'by', label: 'Registró', value: e => G.userShort(e.created_by) + (e.created_by === uid ? ' (tú)' : '') },
      { key: 'cat', label: 'Categoría', value: e => catName(e.category_id) },
      { key: 'doc', label: 'Comprobante', value: e => docLabel(e) },
      { key: 'cc', label: 'CC · marca', value: e => `${(G.db.get('cost_centers', e.cost_center_id) || {}).code} · ${G.brandName(e.brand_id)}` },
      { key: 'amount_pen', label: 'Total S/', align: 'r', render: e => G.fmt.money(e.amount_pen) },
      { key: 'lvl', label: 'Requiere', value: e => GAS.requiredLevel(e), render: e => badge('Nivel ' + GAS.requiredLevel(e), GAS.requiredLevel(e) === 3 ? 'bad' : GAS.requiredLevel(e) === 2 ? 'warn' : 'info') },
      { key: 'vb', label: 'Vistos buenos', value: e => GAS.approvalsOf(e.id).filter(a => a.decision === 'APPROVED').map(a => 'N' + a.level + ' ' + G.userShort(a.approver_user_id)).join(', ') },
      { key: 'flag', label: 'Comprobante', render: e => fBadge(e.accounting_flag) },
    ], filters: [{ key: 'lvl', label: 'Nivel', options: [[1, 'Nivel 1'], [2, 'Nivel 2'], [3, 'Nivel 3']], value: e => GAS.requiredLevel(e) }, { key: 'establishment_id', label: 'Local', options: siteOpts() }] }));
  }

  /* ------------------------------------------------------------------
     GAS-04 Gastos por pagar y pagados (+ recurrentes)
     ------------------------------------------------------------------ */
  function screen04(el) {
    const body = page(el, { code: 'GAS-04', title: 'Gastos por pagar y pagados', sub: 'Gastos aprobados pendientes de pago y su pago desde CAJ; los de caja chica se reponen con la rendición. Plantillas de gastos fijos del mes.' });
    const rows = G.scope.filter(G.db.where('expenses', e => ['APPROVED', 'PAID'].includes(e.status)));
    const due = rows.filter(e => e.status === 'APPROVED' && e.pay_source !== 'PETTY');
    const paidM = rows.filter(e => e.status === 'PAID' && (e.paid_at || '').slice(0, 7) === G.TODAY.slice(0, 7));
    const old = due.filter(e => G.date.diff(G.TODAY, e.issue_date) > 15);
    body.appendChild(kpis([
      { label: 'Por pagar', value: due.length, sub: G.fmt.money(R(U.sum(due, e => e.amount_pen))), tone: due.length ? 'warn' : '' },
      { label: 'Con más de 15 días', value: old.length, sub: G.fmt.money(R(U.sum(old, e => e.amount_pen))), tone: old.length ? 'bad' : '' },
      { label: 'Pagados este mes', value: paidM.length, sub: G.fmt.money(R(U.sum(paidM, e => e.amount_pen))) },
      { label: 'Retenciones 4.ª por declarar', value: G.fmt.money(R(U.sum(rows.filter(e => e.withholding_amount > 0 && (e.paid_at || '').slice(0, 7) === G.TODAY.slice(0, 7)), e => e.withholding_amount))) },
    ]));
    body.appendChild(G.ui.tabs([
      { key: 'due', label: 'Por pagar', count: due.length, render: p => p.appendChild(table({ id: 'gas04d', rows: due.sort(U.by('issue_date')), onRow: e => GAS.open(e.id), columns: expCols([{ key: 'age', label: 'Días', align: 'r', value: e => G.date.diff(G.TODAY, e.issue_date) }]), actions: e => G.canDo('GAS', 'A') ? [btn('Pagar', () => payModal(e), { sm: true, kind: 'accent' })] : [] })) },
      { key: 'paid', label: 'Pagados', render: p => p.appendChild(table({ id: 'gas04p', rows: rows.filter(e => e.status === 'PAID').sort(U.by('paid_at', -1)), onRow: e => GAS.open(e.id), columns: expCols([{ key: 'paid_at', label: 'Pagado', render: e => G.fmt.date(e.paid_at) }, { key: 'acc', label: 'Desde', value: e => (G.db.get('cash_accounts', e.paid_from_account_id) || {}).name || '—' }]) })) },
      { key: 'rec', label: 'Gastos recurrentes', render: p => recurring(p) },
    ]));
  }
  function recurring(p) {
    const ts = G.db.all('expense_recurrences');
    const period = G.date.month(G.TODAY);
    const gen = t => G.db.find('expenses', e => e.recurrence_id === t.id && G.date.month(e.issue_date) === period && e.status !== 'VOIDED');
    p.appendChild(h('div', { class: 'row', style: 'margin-bottom:10px' }, btn(`Generar los de ${G.date.monthName(period)}`, () => { try { const n = GAS.generateRecurring(period); toast(n.length ? `${n.length} gastos generados en borrador (falta su comprobante)` : 'Los gastos del mes ya estaban generados', n.length ? 'ok' : 'info'); G.refresh(); } catch (err) { toast(err.message, 'bad'); } }, { kind: 'primary', disabled: !G.canDo('GAS', 'C') }), h('span', { class: 'small muted' }, 'Se crean en borrador con su reparto por mezcla de ventas; quien recibe la factura adjunta la foto y lo envía.')));
    p.appendChild(table({ id: 'gas04r', rows: ts, columns: [
      { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Gasto fijo' }, { key: 'sup', label: 'Proveedor', value: t => G.supName(t.supplier_id) },
      { key: 'site', label: 'Local', value: t => G.siteName(t.establishment_id) }, { key: 'cc', label: 'CC', value: t => (G.db.get('cost_centers', t.cost_center_id) || {}).code },
      { key: 'day_of_month', label: 'Día', align: 'r' }, { key: 'total', label: 'Monto ref.', align: 'r', render: t => G.fmt.money(t.total) },
      { key: 'mix', label: 'Reparto', value: t => t.allocate_by_sales_mix ? 'Mezcla de ventas' : '—' },
      { key: 'g', label: G.date.monthName(period), render: t => { const e = gen(t); return e ? h('span', null, stBadge(e.status), ' ', e.number) : badge('Pendiente', 'warn'); } },
    ], onRow: t => { const e = gen(t); if (e) GAS.open(e.id); } }));
  }

  /* ------------------------------------------------------------------
     GAS-05 Categorías
     ------------------------------------------------------------------ */
  function screen05(el) {
    const can = G.can('gas.category.manage');
    G.ui.crud(el, {
      code: 'GAS-05', title: 'Categorías de gasto', sub: 'Grupo, área por defecto, tipo de costo de reparto (DEL) y lo que exige cada categoría (RN-GAS-03).', table: 'expense_categories', canCreate: can, canEdit: can,
      rows: () => G.db.all('expense_categories').sort(U.by('code')),
      kpis: () => { const cs = G.db.all('expense_categories'); const m = G.date.month(G.TODAY); const sp = U.groupBy(G.db.where('expenses', e => counted(e) && e.issue_date >= m), 'category_id'); return [{ label: 'Categorías activas', value: cs.filter(c => c.status === 'ACTIVE').length }, { label: 'Copian a DEL', value: cs.filter(c => c.delivery_cost_type).length }, { label: 'Exigen campaña', value: cs.filter(c => c.requires_campaign).length }, { label: 'Gasto del mes (aprobado)', value: G.fmt.money(R(U.sum(Object.values(sp).flat(), e => e.amount_pen))) }]; },
      columns: [
        { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Categoría' }, { key: 'category_group', label: 'Grupo', value: c => lbl(GROUPS, c.category_group) },
        { key: 'default_area', label: 'Área', value: c => lbl(AREAS, c.default_area) }, { key: 'cc', label: 'CC por defecto', value: c => (G.db.get('cost_centers', c.default_cost_center_id) || {}).code || '—' },
        { key: 'delivery_cost_type', label: 'Costo DEL', value: c => c.delivery_cost_type ? lbl(DC_TYPES, c.delivery_cost_type) : '—' },
        { key: 'req', label: 'Exige', value: c => [c.requires_vehicle && 'vehículo', c.requires_gallons && 'galones', c.requires_employee && 'trabajador', c.requires_supplier && 'proveedor', c.requires_campaign && 'campaña'].filter(Boolean).join(', ') || '—' },
        { key: 'm', label: 'Mes S/', align: 'r', value: c => R(U.sum(G.db.where('expenses', e => counted(e) && e.category_id === c.id && e.issue_date >= G.date.month(G.TODAY)), e => e.amount_pen)), render: c => G.fmt.money(R(U.sum(G.db.where('expenses', e => counted(e) && e.category_id === c.id && e.issue_date >= G.date.month(G.TODAY)), e => e.amount_pen))) },
        { key: 'status', label: 'Estado', render: c => G.ui.status(c.status) },
      ],
      fields: [
        { key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true },
        { key: 'category_group', label: 'Grupo', type: 'select', options: GROUPS, required: true }, { key: 'default_area', label: 'Área por defecto', type: 'select', options: AREAS },
        { key: 'default_cost_center_id', label: 'Centro de costo por defecto', type: 'select', options: ccOpts }, { key: 'default_doc_type', label: 'Comprobante habitual', type: 'select', options: DOC_TYPES },
        { key: 'delivery_cost_type', label: 'Tipo de costo de reparto (copia a DEL)', type: 'select', options: DC_TYPES, span: 2 },
        { key: 'requires_vehicle', label: 'Exige vehículo', type: 'checkbox' }, { key: 'requires_gallons', label: 'Exige galones del vale', type: 'checkbox' },
        { key: 'requires_employee', label: 'Exige repartidor o trabajador', type: 'checkbox' }, { key: 'requires_supplier', label: 'Exige proveedor', type: 'checkbox' },
        { key: 'requires_campaign', label: 'Exige campaña (ADS)', type: 'checkbox' }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva']], required: true },
      ],
      defaults: () => ({ status: 'ACTIVE', category_group: 'OTHER' }),
      beforeSave: (v, r) => { if (G.db.find('expense_categories', c => c.code === v.code && (!r || c.id !== r.id))) return { code: 'Ya existe una categoría con ese código.' }; if (v.requires_gallons && !v.requires_vehicle) return 'RN-GAS-03: los galones solo aplican a categorías con vehículo.'; },
    });
  }

  /* ------------------------------------------------------------------
     GAS-06 Reglas de aprobación
     ------------------------------------------------------------------ */
  function screen06(el) {
    const can = G.can('gas.category.manage');
    const body = page(el, { code: 'GAS-06', title: 'Reglas de aprobación', sub: 'Montos por nivel y permiso que aprueba (RN-GAS-07); reglas específicas por categoría o local cuando se necesitan.' });
    const l1 = G.param('gas_level1_max'), l2 = G.param('gas_level2_max');
    const roles = perm => G.ROLES.filter(([r]) => r !== 'GERENTE' && G.can(perm, r)).map(([, n]) => n).concat(['Gerencia']).join(', ');
    body.appendChild(notice(`D-GAS-01: valores provisionales S/ ${l1} y S/ ${l2} mientras gerencia no decida otros montos.`, 'info'));
    const levels = [[1, 0, l1], [2, l1, l2], [3, l2, null]];
    body.appendChild(card('Niveles generales', table({ id: 'gas06l', search: false, rows: levels.map(([lv, a, b]) => ({ lv, a, b })), columns: [
      { key: 'lv', label: 'Nivel', render: r => LEVELS[r.lv][0] }, { key: 'a', label: 'Desde (más de)', align: 'r', render: r => G.fmt.money(r.a) }, { key: 'b', label: 'Hasta', align: 'r', render: r => r.b == null ? 'sin tope' : G.fmt.money(r.b) },
      { key: 'p', label: 'Permiso', mono: true, value: r => LEVELS[r.lv][1] }, { key: 'roles', label: 'Roles que aprueban', value: r => roles(LEVELS[r.lv][1]) },
      { key: 'n', label: 'Enviados ahora', align: 'r', value: r => G.db.where('expenses', e => e.status === 'SUBMITTED' && GAS.requiredLevel(e) === r.lv).length },
    ] }), { actions: can ? [btn('Cambiar montos', () => {
      modal('Montos de aprobación', b => b.appendChild(h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { attrs: { for: 'g06-l1' } }, 'Tope nivel 1 (gas_level1_max)'), h('input', { class: 'input', id: 'g06-l1', type: 'number', value: l1 })),
        h('div', { class: 'field' }, h('label', { attrs: { for: 'g06-l2' } }, 'Tope nivel 2 (gas_level2_max)'), h('input', { class: 'input', id: 'g06-l2', type: 'number', value: l2 })),
        h('div', { class: 'field span2' }, h('label', { attrs: { for: 'g06-r' } }, 'Motivo del cambio'), h('input', { class: 'input', id: 'g06-r' })))), [{ label: 'Cancelar' }, { label: 'Guardar', kind: 'primary', onClick: () => {
        const a = Number(document.getElementById('g06-l1').value), b = Number(document.getElementById('g06-l2').value), r = document.getElementById('g06-r').value.trim();
        if (!(a > 0 && b > a)) { toast('RN-GAS-07: el tope de nivel 2 debe ser mayor que el de nivel 1.', 'bad'); return false; }
        try { G.setParam('gas_level1_max', a, r); G.setParam('gas_level2_max', b, r); toast('Montos actualizados', 'ok'); G.refresh(); } catch (err) { toast(err.message, 'bad'); return false; }
      } }]);
    }, { sm: true })] : null }));
    const spec = G.db.where('expense_approval_rules', r => r.category_id || r.establishment_id);
    const sub = h('div');
    G.ui.crud(sub, {
      code: 'GAS-06', title: 'Reglas específicas', table: 'expense_approval_rules', canCreate: can, canEdit: can, createLabel: 'Nueva regla',
      rows: () => spec,
      columns: [{ key: 'cat', label: 'Categoría', value: r => r.category_id ? catName(r.category_id) : 'Todas' }, { key: 'site', label: 'Local', value: r => r.establishment_id ? G.siteName(r.establishment_id) : 'Todos' }, { key: 'min_amount', label: 'Desde', align: 'r', render: r => G.fmt.money(r.min_amount) }, { key: 'max_amount', label: 'Hasta', align: 'r', render: r => r.max_amount == null ? 'sin tope' : G.fmt.money(r.max_amount) }, { key: 'level', label: 'Nivel', align: 'c' }, { key: 'permission_code', label: 'Permiso', mono: true }, { key: 'note', label: 'Por qué' }, { key: 'status', label: 'Estado', render: r => G.ui.status(r.status || 'ACTIVE') }],
      fields: [{ key: 'category_id', label: 'Categoría', type: 'select', options: catOpts }, { key: 'establishment_id', label: 'Local', type: 'select', options: siteOpts }, { key: 'min_amount', label: 'Desde S/', type: 'money', min: 0, required: true }, { key: 'max_amount', label: 'Hasta S/ (vacío = sin tope)', type: 'money', min: 0 }, { key: 'level', label: 'Nivel', type: 'select', options: [[1, 'Nivel 1'], [2, 'Nivel 2'], [3, 'Nivel 3']], required: true }, { key: 'note', label: 'Motivo de la regla', required: true }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva']], required: true }],
      defaults: () => ({ min_amount: 0, level: 3, status: 'ACTIVE' }),
      afterSave: row => G.db.update('expense_approval_rules', row.id, { level: Number(row.level), permission_code: LEVELS[Number(row.level)][1], max_amount: row.max_amount === '' || row.max_amount == null ? null : Number(row.max_amount), min_amount: Number(row.min_amount) || 0 }, { silent: true }),
      beforeSave: v => { v.level = Number(v.level); v.max_amount = v.max_amount === '' || v.max_amount == null ? null : Number(v.max_amount); v.permission_code = LEVELS[v.level][1]; if (!v.category_id && !v.establishment_id) return 'Una regla específica lleva categoría o local; los niveles generales se cambian arriba.'; if (v.max_amount != null && v.max_amount < v.min_amount) return 'El tope debe ser mayor que el monto inicial.'; },
    });
    const inner = sub.querySelector('.page .stack'); const hd = sub.querySelector('.page-head');
    body.appendChild(card('Reglas por categoría o local', h('div', { class: 'stack' }, hd ? hd.querySelector('.page-actions') : null, inner)));
  }

  /* ------------------------------------------------------------------
     GAS-07 Caja chica
     ------------------------------------------------------------------ */
  function screen07(el) {
    const can = G.can('gas.petty_cash.manage');
    const body = page(el, { code: 'GAS-07', title: 'Caja chica', sub: 'Fondo fijo por local con responsable y máximo por gasto; saldo disponible = fondo − gastos de rendiciones no repuestas (D-GAS-03: S/ 1000 por local, rendición quincenal).' });
    const funds = G.db.all('petty_cash_funds').filter(f => G.ctx.site === 'ALL' || f.establishment_id === G.ctx.site);
    body.appendChild(h('div', { class: 'grid c2' }, funds.map(f => {
      const bal = GAS.fundBalance(f); const rep = G.db.find('petty_cash_reports', r => r.fund_id === f.id && r.status === 'OPEN'); const used = R(f.fund_amount - bal);
      const es = rep ? GAS.reportExpenses(rep.id) : [];
      return card(`${G.siteName(f.establishment_id)} · ${(G.db.get('cash_accounts', f.cash_account_id) || {}).name}`, h('div', { class: 'stack' },
        kpis([{ label: 'Saldo disponible', value: G.fmt.money(bal), tone: bal < f.fund_amount * 0.25 ? 'bad' : bal < f.fund_amount * 0.5 ? 'warn' : 'ok' }, { label: 'Usado sin reponer', value: G.fmt.money(used) }, { label: 'Antigüedad sin rendir (KPI-GAS-06)', value: rep ? G.fmt.days(GAS.reportAgeDays(rep)) : '—' }]),
        G.ui.progress(used / f.fund_amount * 100, used / f.fund_amount > 0.75 ? 'bad' : used / f.fund_amount > 0.5 ? 'warn' : ''),
        dl([['Responsable', G.userName(f.custodian_user_id)], ['Fondo fijo', G.fmt.money(f.fund_amount)], ['Máximo por gasto', G.fmt.money(GAS.fundMax(f)) + ' (RN-GAS-09)'], ['Rendición abierta', rep ? `${rep.number} · ${es.length} gastos desde ${G.fmt.date(rep.period_from)}` : '—'], ['Estado', G.ui.status(f.status)]]),
        h('div', { class: 'row' }, btn('Registrar gasto de caja chica', () => { S01 = null; G.go('GAS-01', { reset: 1, petty: 1, site: f.establishment_id }); }, { kind: 'primary', sm: true }), rep ? btn('Ver rendición', () => G.go('GAS-08', { id: rep.id }), { sm: true }) : null, can ? btn('Editar fondo', () => editFund(f), { sm: true, kind: 'ghost' }) : null),
        es.length ? table({ id: 'gas07-' + f.id, search: false, pageSize: 8, rows: es.sort(U.by('issue_date', -1)), onRow: e => GAS.open(e.id), columns: [{ key: 'issue_date', label: 'Fecha', render: e => G.fmt.date(e.issue_date) }, { key: 'd', label: 'Gasto', value: e => `${catName(e.category_id)} · ${e.description}` }, { key: 'amount_pen', label: 'S/', align: 'r', render: e => G.fmt.num(e.amount_pen, 2) }, { key: 'status', label: 'Estado', render: e => stBadge(e.status) }] }) : null));
    })));
  }
  function editFund(f) {
    drawer('Fondo de caja chica · ' + G.siteName(f.establishment_id), (bd, close) => bd.appendChild(G.ui.form({ id: 'gas07f', values: f, fields: [
      { key: 'custodian_user_id', label: 'Responsable', type: 'select', options: G.db.where('users', u => u.employee_id && u.status === 'ACTIVE').map(u => [u.id, `${u.name} · ${G.roleName(u.role)}`]), required: true },
      { key: 'fund_amount', label: 'Fondo fijo S/', type: 'money', min: 1, required: true }, { key: 'max_expense_amount', label: 'Máximo por gasto S/', type: 'money', min: 1, required: true },
      { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['CLOSED', 'Cerrado']], required: true }, { key: 'reason', label: 'Motivo del cambio', required: true, span: 2 },
    ], onCancel: close, onSubmit: v => { if (v.max_expense_amount > v.fund_amount) return 'RN-GAS-09: el máximo por gasto no supera el fondo.'; G.db.update('petty_cash_funds', f.id, { custodian_user_id: v.custodian_user_id, fund_amount: Number(v.fund_amount), max_expense_amount: Number(v.max_expense_amount), status: v.status, last_change_reason: v.reason }); close(); toast('Fondo actualizado', 'ok'); G.refresh(); return true; } })), { code: 'GAS-07' });
  }

  /* ------------------------------------------------------------------
     GAS-08 Rendición de caja chica
     ------------------------------------------------------------------ */
  function screen08(el, params) {
    const body = page(el, { code: 'GAS-08', title: 'Rendición de caja chica', sub: 'Gastos del período del fondo, total y reposición pedida; envío por el responsable y aprobación por otra persona (RN-GAS-09).' });
    const reps = G.db.all('petty_cash_reports').filter(r => { const f = G.db.get('petty_cash_funds', r.fund_id); return f && (G.ctx.site === 'ALL' || f.establishment_id === G.ctx.site); }).sort(U.by('number', -1));
    const tot = r => r.status === 'OPEN' ? R(U.sum(GAS.reportExpenses(r.id).filter(counted), e => e.amount_pen)) : r.total_expenses;
    body.appendChild(kpis([
      { label: 'Abiertas', value: reps.filter(r => r.status === 'OPEN').length }, { label: 'Por aprobar', value: reps.filter(r => r.status === 'SUBMITTED').length, tone: 'warn' },
      { label: 'Aprobadas por reponer', value: reps.filter(r => r.status === 'APPROVED').length, sub: G.fmt.money(R(U.sum(reps.filter(r => r.status === 'APPROVED'), r => r.replenishment_amount))) },
      { label: 'Repuesto en el año', value: G.fmt.money(R(U.sum(reps.filter(r => r.status === 'REIMBURSED'), r => r.replenishment_amount))) },
    ]));
    body.appendChild(table({ id: 'gas08', rows: reps, onRow: r => openReport(r.id), columns: [
      { key: 'number', label: 'Rendición', mono: true }, { key: 'fund', label: 'Fondo', value: r => G.siteName((G.db.get('petty_cash_funds', r.fund_id) || {}).establishment_id) },
      { key: 'period_from', label: 'Desde', render: r => G.fmt.date(r.period_from) }, { key: 'period_to', label: 'Hasta', render: r => r.status === 'OPEN' ? 'abierta' : G.fmt.date(r.period_to) },
      { key: 'n', label: 'Gastos', align: 'r', value: r => GAS.reportExpenses(r.id).length }, { key: 'tot', label: 'Total aprobado', align: 'r', value: tot, render: r => G.fmt.money(tot(r)) },
      { key: 'replenishment_amount', label: 'Reposición', align: 'r', render: r => r.replenishment_amount ? G.fmt.money(r.replenishment_amount) : '—' },
      { key: 'age', label: 'Antigüedad', align: 'r', value: r => r.status === 'OPEN' ? GAS.reportAgeDays(r) : null, render: r => r.status === 'OPEN' ? G.fmt.days(GAS.reportAgeDays(r)) : '—' },
      { key: 'status', label: 'Estado', render: r => pBadge(r.status) },
    ], filters: [{ key: 'status', label: 'Estado', options: Object.entries(PST).map(([k, v]) => [k, v[0]]) }] }));
    if (params.id) setTimeout(() => openReport(params.id), 20);
  }
  function openReport(id) {
    const rep = G.db.get('petty_cash_reports', id); const fund = G.db.get('petty_cash_funds', rep.fund_id); const es = GAS.reportExpenses(id).sort(U.by('issue_date'));
    drawer(`Rendición ${rep.number}`, (bd, close) => {
      const run = (fn, ok) => { try { const r = fn(); toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); close(); G.refresh(); } catch (err) { toast(err.message, 'bad'); } };
      const act = h('div', { class: 'row' });
      if (['OPEN', 'OBSERVED'].includes(rep.status)) act.appendChild(btn('Enviar rendición', () => run(() => GAS.submitReport(id), r => `Rendición enviada por ${G.fmt.money(r.report.replenishment_amount)}${r.moved ? `; ${r.moved} gastos sin aprobar pasan a ${r.next.number}` : ''}`), { kind: 'primary', sm: true }));
      if (rep.status === 'SUBMITTED') { act.appendChild(btn('Aprobar', () => run(() => GAS.approveReport(id), 'Rendición aprobada'), { kind: 'primary', sm: true })); act.appendChild(btn('Observar', () => askReason('Observar rendición', 'Qué falta o debe corregirse', n => run(() => GAS.observeReport(id, n), 'Rendición observada')), { sm: true, kind: 'danger' })); }
      if (rep.status === 'APPROVED') act.appendChild(btn('Registrar reposición (CAJ)', () => run(() => GAS.reimburse(id, { from_account_id: 'ca-BCP-CTE', reference: 'TR-' + rep.number }), `Fondo repuesto con ${G.fmt.money(rep.replenishment_amount)} desde BCP`), { kind: 'accent', sm: true }));
      if (act.children.length) bd.appendChild(act);
      if (rep.observation && rep.status === 'OBSERVED') bd.appendChild(notice('Observada: ' + rep.observation, 'bad'));
      const ok = es.filter(counted), pend = es.filter(e => !counted(e));
      bd.appendChild(dl([['Fondo', `${G.siteName(fund.establishment_id)} · ${G.fmt.money(fund.fund_amount)}`], ['Responsable', G.userName(fund.custodian_user_id)], ['Período', `${G.fmt.date(rep.period_from)} – ${rep.status === 'OPEN' ? 'hoy' : G.fmt.date(rep.period_to)}`], ['Estado', pBadge(rep.status)], ['Gastos aprobados', `${ok.length} · ${G.fmt.money(R(U.sum(ok, e => e.amount_pen)))}`], ['Gastos sin aprobar', pend.length ? `${pend.length} · ${G.fmt.money(R(U.sum(pend, e => e.amount_pen)))} (no entran en la reposición)` : '—'], ['Reposición pedida', rep.replenishment_amount ? G.fmt.money(rep.replenishment_amount) : '—'], rep.approved_by ? ['Aprobó', `${G.userName(rep.approved_by)} · ${G.fmt.datetime(rep.approved_at)}`] : null, rep.reimbursed_at ? ['Repuesto', G.fmt.datetime(rep.reimbursed_at)] : null]));
      const byCat = U.groupBy(ok, 'category_id');
      bd.appendChild(card('Resumen por categoría', G.ui.chart.hbar({ items: Object.entries(byCat).map(([c, l]) => ({ label: catName(c), value: R(U.sum(l, e => e.amount_pen)) })).sort((a, b) => b.value - a.value), format: v => G.fmt.money(v) })));
      bd.appendChild(table({ id: 'gas08d', rows: es, onRow: e => GAS.open(e.id), columns: [{ key: 'number', label: 'Gasto', mono: true }, { key: 'issue_date', label: 'Fecha', render: e => G.fmt.date(e.issue_date) }, { key: 'c', label: 'Categoría', value: e => catName(e.category_id) }, { key: 'doc', label: 'Comprobante', value: e => docLabel(e) }, { key: 'description', label: 'Descripción' }, { key: 'amount_pen', label: 'S/', align: 'r', render: e => G.fmt.num(e.amount_pen, 2) }, { key: 'status', label: 'Estado', render: e => h('span', null, stBadge(e.status), e.accounting_flag !== 'OK' ? fBadge(e.accounting_flag) : null) }] }));
    }, { wide: true, code: 'GAS-08' });
  }

  /* ------------------------------------------------------------------
     GAS-09 Bandeja de la contadora
     ------------------------------------------------------------------ */
  function screen09(el) {
    const can = G.can('gas.accounting.review');
    const body = page(el, { code: 'GAS-09', title: 'Bandeja de la contadora', sub: 'Gastos sin comprobante válido (recibo simple, planilla de movilidad o sin comprobante) u observados, con su foto, para clasificar o pedir corrección.' });
    const rows = G.scope.filter(GAS.inbox()).sort(U.by('issue_date', -1));
    const k3 = G.kpi('KPI-GAS-03') || {};
    body.appendChild(kpis([
      { label: 'Por revisar', value: rows.length, tone: rows.length ? 'warn' : 'ok' },
      { label: 'Sin comprobante válido', value: rows.filter(e => e.accounting_flag === 'NO_VALID_RECEIPT').length, sub: G.fmt.money(R(U.sum(rows.filter(e => e.accounting_flag === 'NO_VALID_RECEIPT'), e => e.amount_pen))) },
      { label: 'Observados (esperan corrección)', value: rows.filter(e => e.accounting_flag === 'OBSERVED').length, tone: 'bad' },
      { label: 'KPI-GAS-03 del mes', value: G.fmt.pct(k3.value), sub: `${G.fmt.money(k3.numerator)} de ${G.fmt.money(k3.denominator)}` },
    ]));
    body.appendChild(notice('D-GAS-05: la planilla de movilidad se marca sin comprobante válido hasta que la contadora confirme que cumple los requisitos para deducir el gasto.', 'info'));
    if (!can) body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene gas.accounting.review: solo lectura.`, 'warn'));
    const review = (e, action) => {
      modal(`${{ OBSERVE: 'Observar', NOT_DEDUCTIBLE: 'Clasificar como no deducible', VALIDATE: 'Validar comprobante' }[action]} · ${e.number}`, b => {
        b.appendChild(h('div', { class: 'grid c2' }, receiptView(e), h('div', { class: 'stack' }, dl([['Categoría', catName(e.category_id)], ['Total', G.fmt.money(e.amount_pen)], ['Registró', G.userName(e.created_by)], ['Descripción', e.description]]),
          h('div', { class: 'field' }, h('label', { attrs: { for: 'g09-cat' } }, 'Reclasificar categoría'), h('select', { class: 'input', id: 'g09-cat' }, catOpts().map(([v, l]) => h('option', { value: v, selected: v === e.category_id }, l)))),
          h('div', { class: 'field' }, h('label', { attrs: { for: 'g09-n' } }, action === 'OBSERVE' ? 'Qué debe corregir' : 'Nota'), h('textarea', { class: 'input', id: 'g09-n' })))));
      }, [{ label: 'Cancelar' }, { label: 'Guardar', kind: 'primary', onClick: () => { try { GAS.accountingReview(e.id, { action, note: document.getElementById('g09-n').value.trim(), category_id: document.getElementById('g09-cat').value }); toast('Revisión registrada', 'ok'); G.refresh(); } catch (err) { toast(err.message, 'bad'); return false; } } }], { wide: true });
    };
    body.appendChild(table({ id: 'gas09', rows, onRow: e => GAS.open(e.id), columns: expCols([{ key: 'note', label: 'Nota contable', value: e => e.accounting_note || '' }]), actions: e => can ? [btn('Validar', () => review(e, 'VALIDATE'), { sm: true }), btn('No deducible', () => review(e, 'NOT_DEDUCTIBLE'), { sm: true }), btn('Observar', () => review(e, 'OBSERVE'), { sm: true, kind: 'danger' })] : [],
      filters: [{ key: 'accounting_flag', label: 'Marca contable', options: [['NO_VALID_RECEIPT', 'Sin comprobante válido'], ['OBSERVED', 'Observado']] }, { key: 'doc_type', label: 'Comprobante', options: DOC_TYPES }] }));
  }

  /* ------------------------------------------------------------------
     GAS-10 Reparto entre centros de costo
     ------------------------------------------------------------------ */
  function screen10(el, params) {
    const body = page(el, { code: 'GAS-10', title: 'Reparto entre centros de costo', sub: 'Porcentajes y montos por centro de costo, marca y canal de un gasto; deben sumar el 100 % y el total antes de aprobarlo (RN-GAS-04).' });
    const cands = G.scope.filter(G.db.where('expenses', e => isLive(e) && (e.allocated || ['DRAFT', 'SUBMITTED'].includes(e.status)))).sort(U.by('issue_date', -1));
    const sel = h('select', { class: 'input', id: 'g10-exp', style: 'max-width:100%' }, h('option', { value: '' }, 'Elige un gasto'), cands.map(e => h('option', { value: e.id, selected: e.id === params.id }, `${e.number} · ${catName(e.category_id)} · ${G.fmt.money(e.amount_pen)} · ${(ST[e.status] || [])[0]}${e.allocated ? ' · repartido' : ''}`)));
    sel.addEventListener('change', () => G.go('GAS-10', sel.value ? { id: sel.value } : {}));
    body.appendChild(card('Gasto', h('div', { class: 'field' }, h('label', { attrs: { for: 'g10-exp' } }, 'Gasto a repartir'), sel)));
    const e = params.id && G.db.get('expenses', params.id);
    if (!e) {
      const rep = G.db.where('expenses', x => x.allocated && isLive(x));
      body.appendChild(card('Gastos repartidos', table({ id: 'gas10l', rows: rep, onRow: x => G.go('GAS-10', { id: x.id }), columns: expCols([{ key: 'n', label: 'Líneas', align: 'r', value: x => GAS.allocationsOf(x.id).length }]) })));
      return;
    }
    const locked = ['APPROVED', 'PAID', 'VOIDED'].includes(e.status);
    const cur = GAS.allocationsOf(e.id);
    const lines = (params.draft && params.draft.length ? params.draft : cur.length ? cur.map(a => ({ cost_center_id: a.cost_center_id, brand_id: a.brand_id, sales_channel: a.sales_channel, pct: a.pct })) : [{ cost_center_id: e.cost_center_id, brand_id: e.brand_id, sales_channel: e.sales_channel, pct: 100 }]).map(x => Object.assign({}, x));
    body.appendChild(dl([['Gasto', `${e.number} · ${e.description}`], ['Total a repartir', G.fmt.money(e.amount_pen)], ['Estado', stBadge(e.status)]]));
    if (locked) body.appendChild(notice('El gasto ya está ' + (ST[e.status] || [])[0].toLowerCase() + ': su reparto es de solo lectura.', 'info'));
    const box = h('div');
    const totBox = h('div');
    const drawTot = () => { G.ui.clear(totBox); const p = R(U.sum(lines, l => Number(l.pct) || 0), 4); totBox.appendChild(notice(`Suma ${G.fmt.num(p, 2)} % · ${G.fmt.money(R(e.amount_pen * p / 100))} de ${G.fmt.money(e.amount_pen)}${Math.abs(p - 100) > 0.001 ? ' · RN-GAS-04: debe sumar 100 %' : ''}`, Math.abs(p - 100) > 0.001 ? 'bad' : 'ok')); };
    const draw = () => {
      G.ui.clear(box);
      const tb = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Centro de costo', 'Marca', 'Canal', '%', 'Monto S/', ''].map(t => h('th', null, t)))));
      const tbody = h('tbody');
      lines.forEach((l, i) => {
        const mk = (key, opts) => { const s = h('select', { class: 'input', disabled: locked, attrs: { 'aria-label': key } }, h('option', { value: '' }, '—'), opts.map(([v, t]) => h('option', { value: v, selected: l[key] === v }, t))); s.addEventListener('change', () => { l[key] = s.value || null; }); return s; };
        const pin = h('input', { class: 'input', type: 'number', value: l.pct, disabled: locked, style: 'width:90px', attrs: { step: 'any', 'aria-label': 'Porcentaje' } });
        const am = h('span', { class: 'num' }, G.fmt.num(R(e.amount_pen * (Number(l.pct) || 0) / 100), 2));
        pin.addEventListener('input', () => { l.pct = Number(pin.value) || 0; am.textContent = G.fmt.num(R(e.amount_pen * l.pct / 100), 2); drawTot(); });
        tbody.appendChild(h('tr', null, h('td', null, mk('cost_center_id', ccOpts())), h('td', null, mk('brand_id', brandOpts())), h('td', null, mk('sales_channel', G.CHANNELS)), h('td', null, pin), h('td', { class: 'r' }, am), h('td', null, locked ? null : btn('Quitar', () => { lines.splice(i, 1); draw(); }, { sm: true, kind: 'ghost' }))));
      });
      tb.appendChild(tbody);
      box.append(h('div', { class: 'tbl-wrap' }, tb));
      drawTot();
    };
    draw();
    const actions = locked ? null : h('div', { class: 'row' },
      btn('Agregar línea', () => { lines.push({ cost_center_id: e.cost_center_id, brand_id: null, sales_channel: null, pct: 0 }); draw(); }, { sm: true }),
      btn('Por mezcla de ventas del mes anterior', () => { const mix = GAS.salesMix(e.issue_date); lines.splice(0, lines.length, ...mix.map(m => ({ cost_center_id: e.cost_center_id, brand_id: m.brand_id, sales_channel: null, pct: m.pct }))); draw(); }, { sm: true }),
      btn('Partes iguales entre marcas', () => { const bs = G.db.where('brands', b => b.status === 'ACTIVE'); const p = R(100 / bs.length, 4); lines.splice(0, lines.length, ...bs.map((b, i) => ({ cost_center_id: e.cost_center_id, brand_id: b.id, pct: i === bs.length - 1 ? R(100 - p * (bs.length - 1), 4) : p }))); draw(); }, { sm: true }),
      btn('Guardar reparto', () => { try { GAS.setAllocations(e.id, lines); G.db.update('expenses', e.id, { history: (e.history || []).concat([{ at: now(), action: `Reparto en ${lines.length} líneas`, user: G.ctx.userName() }]) }, { silent: true }); toast('Reparto guardado (RN-GAS-04 cumplida)', 'ok'); G.refresh(); } catch (err) { toast(err.message, 'bad'); } }, { kind: 'primary', sm: true }),
      cur.length ? btn('Quitar reparto', () => { GAS.setAllocations(e.id, []); toast('Reparto eliminado', 'ok'); G.refresh(); }, { sm: true, kind: 'ghost' }) : null);
    body.appendChild(card('Reparto', h('div', { class: 'stack' }, box, totBox, actions)));
  }

  /* ------------------------------------------------------------------
     GAS-11 Reporte de gastos
     ------------------------------------------------------------------ */
  const R11 = { month: '2026-10', dim: 'category' };
  function screen11(el) {
    const body = page(el, { code: 'GAS-11', title: 'Reporte de gastos', sub: 'Gasto aprobado o pagado por mes, categoría, centro de costo, local, marca y canal (repartido cuando el gasto tiene reparto); exportación a CSV.', actions: [btn('Exportar CSV', () => exportCsv(), { kind: 'ghost' })] });
    const from = R11.month + '-01', to = G.date.add(G.date.addMonths(from, 1), -1);
    const rows = GAS.rows({ from, to }).filter(r => G.scope.ok(r));
    const prev = GAS.rows({ from: G.date.addMonths(from, -1), to: G.date.add(from, -1) }).filter(r => G.scope.ok(r));
    const total = R(U.sum(rows, r => r.amount)), pt = R(U.sum(prev, r => r.amount));
    body.appendChild(h('div', { class: 'row' }, G.ui.pills([['2026-09', 'Setiembre 2026'], ['2026-10', 'Octubre 2026 (al 10)']], R11.month, v => { R11.month = v; G.refresh(); }), G.ui.pills([['category', 'Categoría'], ['group', 'Grupo'], ['cc', 'Centro de costo'], ['site', 'Local'], ['brand', 'Marca'], ['channel', 'Canal']], R11.dim, v => { R11.dim = v; G.refresh(); })));
    const k3 = G.kpi('KPI-GAS-03', { from, to }) || {};
    body.appendChild(kpis([
      { label: 'Gasto aprobado (KPI-GAS-01)', value: G.fmt.money(total), sub: pt ? `${total >= pt ? '+' : ''}${G.fmt.pct((total - pt) / pt * 100)} vs. mes anterior` : '' },
      { label: 'Costo sin IGV', value: G.fmt.money(R(U.sum(rows, r => r.net))) },
      { label: 'Sin comprobante válido (KPI-GAS-03)', value: G.fmt.pct(k3.value), tone: k3.value > 5 ? 'warn' : '' },
      { label: 'Publicidad y creadores', value: G.fmt.money(R(U.sum(rows.filter(r => ['ADVERTISING', 'CONTENT_CREATORS'].includes((cat(r.e.category_id) || {}).category_group)), r => r.amount))) },
      { label: 'Reparto (DEL)', value: G.fmt.money(R(U.sum(rows.filter(r => (cat(r.e.category_id) || {}).category_group === 'DELIVERY'), r => r.amount))) },
    ]));
    const keyOf = { category: r => catName(r.e.category_id), group: r => lbl(GROUPS, (cat(r.e.category_id) || {}).category_group), cc: r => G.ccName(r.cost_center_id), site: r => G.siteName(r.establishment_id), brand: r => G.brandName(r.brand_id), channel: r => r.sales_channel ? G.channelName(r.sales_channel) : 'Sin canal' }[R11.dim];
    const g = U.groupBy(rows, keyOf); const gp = U.groupBy(prev, keyOf);
    const items = Object.entries(g).map(([k, l]) => ({ k, amount: R(U.sum(l, r => r.amount)), net: R(U.sum(l, r => r.net)), n: new Set(l.map(r => r.e.id)).size, prev: R(U.sum(gp[k] || [], r => r.amount)) })).sort((a, b) => b.amount - a.amount);
    body.appendChild(h('div', { class: 'grid c2' },
      card('Distribución', G.ui.chart.hbar({ items: items.slice(0, 12).map(i => ({ label: i.k, value: i.amount })), format: v => G.fmt.money(v, 0) })),
      card('Por día', (() => { const days = []; for (let d = from; d <= (to > G.TODAY ? G.TODAY : to); d = G.date.add(d, 1)) days.push(d); const bd = U.groupBy(rows, r => r.e.issue_date); return G.ui.chart.bar({ labels: days.map(d => d.slice(8)), series: [{ name: 'Gasto S/', values: days.map(d => R(U.sum(bd[d] || [], r => r.amount))) }], format: v => G.fmt.money(v) }); })())));
    body.appendChild(table({ id: 'gas11', rows: items, search: true, columns: [{ key: 'k', label: { category: 'Categoría', group: 'Grupo', cc: 'Centro de costo', site: 'Local', brand: 'Marca', channel: 'Canal' }[R11.dim] }, { key: 'n', label: 'Gastos', align: 'r' }, { key: 'amount', label: 'Total S/', align: 'r', render: i => G.fmt.money(i.amount) }, { key: 'net', label: 'Sin IGV', align: 'r', render: i => G.fmt.money(i.net) }, { key: 'pct', label: '% del mes', align: 'r', value: i => total ? i.amount / total * 100 : 0, render: i => G.fmt.pct(total ? i.amount / total * 100 : 0) }, { key: 'prev', label: 'Mes anterior', align: 'r', render: i => G.fmt.money(i.prev) }], footer: ['Total', '', { v: G.fmt.money(total), align: 'r' }, { v: G.fmt.money(R(U.sum(items, i => i.net))), align: 'r' }, { v: '100 %', align: 'r' }, { v: G.fmt.money(pt), align: 'r' }] }));
    function exportCsv() {
      const head = ['gasto', 'fecha', 'categoria', 'grupo', 'comprobante', 'proveedor', 'local', 'centro_costo', 'marca', 'canal', 'monto_soles', 'sin_igv', 'estado', 'marca_contable'];
      const lines = rows.map(r => [r.e.number, r.e.issue_date, catName(r.e.category_id), (cat(r.e.category_id) || {}).category_group, docLabel(r.e), r.e.supplier_id ? G.supName(r.e.supplier_id) : '', G.siteName(r.establishment_id), (G.db.get('cost_centers', r.cost_center_id) || {}).code, G.brandName(r.brand_id), r.sales_channel || '', r.amount.toFixed(2), (r.net || 0).toFixed(2), r.e.status, r.e.accounting_flag].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));
      const csv = [head.join(';'), ...lines].join('\n');
      try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `gastos-${R11.month}.csv`; document.body.appendChild(a); a.click(); a.remove(); } catch (err) { }
      G.audit('EXPORTAR', 'expenses', R11.month, `${lines.length} filas`);
      modal(`Exportación gastos-${R11.month}.csv`, b => { b.appendChild(h('p', { class: 'small muted' }, `${lines.length} filas (una por línea de reparto). Si la descarga no se abrió, copia el contenido:`)); b.appendChild(h('textarea', { class: 'input mono', style: 'height:220px;font-size:11px' }, csv.slice(0, 20000))); }, [], { wide: true });
    }
  }

  /* ------------------------------------------------------------------
     Registro del módulo
     ------------------------------------------------------------------ */
  const sp = G.SPEC.GAS.screens; const nm = c => (sp.find(s => s[0] === c) || [, c])[1];
  G.register({ code: 'GAS', name: 'Gastos', phase: 1, group: 'Finanzas', screens: [
    { code: 'GAS-01', name: nm('GAS-01'), render: screen01 }, { code: 'GAS-02', name: nm('GAS-02'), render: screen02 }, { code: 'GAS-03', name: nm('GAS-03'), render: screen03 },
    { code: 'GAS-04', name: nm('GAS-04'), render: screen04 }, { code: 'GAS-05', name: nm('GAS-05'), render: screen05 }, { code: 'GAS-06', name: nm('GAS-06'), render: screen06 },
    { code: 'GAS-07', name: nm('GAS-07'), render: screen07 }, { code: 'GAS-08', name: nm('GAS-08'), render: screen08 }, { code: 'GAS-09', name: nm('GAS-09'), render: screen09 },
    { code: 'GAS-10', name: nm('GAS-10'), render: screen10 }, { code: 'GAS-11', name: nm('GAS-11'), render: screen11 },
  ] });

  /* ------------------------------------------------------------------
     Datos de ejemplo (setiembre y octubre 2026)
     ------------------------------------------------------------------ */
  G.seed(32, function seedGastos() {
    const r = U.rng(32032);
    const ins = (t, row) => G.db.insert(t, row, { silent: true });
    const usr = n => (G.db.find('users', u => u.name.startsWith(n)) || {}).id;
    const empOf = uid => (G.db.get('users', uid) || {}).employee_id;
    const supT = n => (G.db.find('suppliers', s => s.trade_name === n) || {}).id;
    const U_ADM = usr('Carmen'), U_GER = usr('Rosa Quispe'), U_COO = usr('Raúl'), U_SUP = usr('Patricia'), U_MKT = usr('Lucía'), U_PED = usr('Pedro'), U_HUG = usr('Hugo'), U_JUL = usr('Julio'), U_OSC = usr('Óscar');
    // proveedores de servicios que usa GAS (los registra administración)
    const NS = [['GAS-INMLP', '2051478236', 'INVERSIONES LOS PRÓCERES SAC', 'Inversiones Los Próceres', 'SERVICES'], ['GAS-INMLU', '2060887413', 'INMOBILIARIA LURÍN SUR EIRL', 'Inmobiliaria Lurín Sur', 'SERVICES'], ['GAS-LUZ', '2033189800', 'LUZ DEL SUR SAA', 'Luz del Sur', 'SERVICES'], ['GAS-AGUA', '2010015583', 'SERVICIO DE AGUA POTABLE Y ALCANTARILLADO DE LIMA', 'Sedapal', 'SERVICES'], ['GAS-TEL', '2010001714', 'TELEFÓNICA DEL PERÚ SAA', 'Movistar Empresas', 'SERVICES'],
      ['GAS-GRIFO', '2060312548', 'ESTACIÓN DE SERVICIOS BENAVIDES SAC', 'Grifo Benavides', 'SERVICES'], ['GAS-GRIFO2', '2060774102', 'COMBUSTIBLES LURÍN EIRL', 'Grifo Lurín', 'SERVICES'], ['GAS-PEAJE', '2054402879', 'CONCESIONARIA VIAL DEL SUR SAC', 'Peaje Panamericana Sur', 'SERVICES'], ['GAS-TALLER', '2060219987', 'TALLER MOTOS SURCO EIRL', 'Taller Motos Surco', 'SERVICES'],
      ['GAS-IMPR', '2050991236', 'GRÁFICA ANDINA IMPRESIONES SAC', 'Gráfica Andina', 'PACKAGING'], ['GAS-ENV', '2060448831', 'ENVASES PLÁSTICOS DEL PACÍFICO SAC', 'Envases del Pacífico', 'PACKAGING'], ['GAS-LIB', '2060655720', 'LIBRERÍA Y ÚTILES SURCO EIRL', 'Librería Surco', 'SERVICES'], ['GAS-LIMP', '2052877451', 'DISTRIBUIDORA DE LIMPIEZA LIMA SAC', 'Limpieza Lima', 'SERVICES'], ['GAS-POLLO', '1041237785', 'HUAMANÍ QUISPE ROSA', 'Menú Doña Rosa', 'SERVICES']];
    for (const [id, ruc10, ln, tn, t] of NS) if (!G.db.get('suppliers', 'su-' + id)) ins('suppliers', { id: 'su-' + id, doc_type: 'RUC', doc_number: U.rucCheck(ruc10.slice(0, 10)), legal_name: ln, trade_name: tn, supplier_type: t, status: 'ACTIVE', payment_terms_days: t === 'PACKAGING' ? 15 : 0, sunat_status: 'ACTIVE', rating: 4, default_cost_center_id: 'cc-ADM', created_from: 'GAS' });
    // categorías
    const C = [
      ['DEL-COMB', 'Combustible', 'DELIVERY', 'DELIVERY', 'FUEL', 'cc-DEL', 'INVOICE', { v: 1, g: 1 }], ['DEL-PEAJE', 'Peajes y estacionamiento', 'DELIVERY', 'DELIVERY', 'TOLL', 'cc-DEL', 'TICKET', {}], ['DEL-MANT', 'Mantenimiento de vehículos', 'DELIVERY', 'DELIVERY', 'MAINTENANCE_CORRECTIVE', 'cc-DEL', 'INVOICE', { v: 1 }],
      ['DEL-SOAT', 'SOAT y revisión técnica', 'DELIVERY', 'DELIVERY', 'SOAT', 'cc-DEL', 'INVOICE', { v: 1 }], ['DEL-ALQ', 'Alquiler de vehículos', 'DELIVERY', 'DELIVERY', 'RENT', 'cc-DEL', 'INVOICE', { v: 1, s: 1 }], ['DEL-MULTA', 'Multas de tránsito', 'DELIVERY', 'DELIVERY', 'FINE', 'cc-DEL', 'SIMPLE_RECEIPT', { v: 1 }],
      ['DEL-ALIM', 'Alimentación del repartidor', 'DELIVERY', 'DELIVERY', 'DRIVER_MEAL', 'cc-DEL', 'RECEIPT', { e: 1 }], ['DEL-MOV', 'Movilidad del repartidor', 'DELIVERY', 'DELIVERY', 'DRIVER_TRANSPORT', 'cc-DEL', 'MOBILITY_SHEET', { e: 1 }], ['DEL-JOR', 'Jornal de repartidor eventual', 'DELIVERY', 'DELIVERY', 'DRIVER_WAGE', 'cc-DEL', 'FEES_RECEIPT', { e: 1 }],
      ['DEL-EMP', 'Empresas de delivery', 'DELIVERY', 'DELIVERY', 'CARRIER_FEE', 'cc-DEL', 'INVOICE', { s: 1 }], ['DEL-PROV', 'Fletes a provincia', 'DELIVERY', 'DELIVERY', 'PROVINCE_FREIGHT', 'cc-DEL', 'INVOICE', { s: 1 }],
      ['PUB-ANUN', 'Publicidad en plataformas', 'ADVERTISING', 'MARKETING', null, 'cc-MKT-DG', 'FOREIGN_INVOICE', { c: 1, s: 1 }], ['PUB-CREA', 'Creadores de contenido', 'CONTENT_CREATORS', 'MARKETING', null, 'cc-MKT-DG', 'FEES_RECEIPT', { c: 1, s: 1 }],
      ['COM-MUE', 'Muestras y degustaciones', 'COMMERCIAL', 'SALES', null, 'cc-VEN-DG', 'RECEIPT', {}], ['INS-EMP', 'Empaques e impresiones', 'SUPPLIES_PACKAGING', 'PRODUCTION', null, 'cc-PROD-L2', 'INVOICE', {}], ['PRO-INS', 'Insumos menores de producción', 'PRODUCTION', 'PRODUCTION', null, 'cc-PROD-L2', 'RECEIPT', {}],
      ['EQU-MAN', 'Mantenimiento de equipos y cámaras', 'EQUIPMENT_MAINTENANCE', 'PRODUCTION', null, 'cc-PROD-L2', 'INVOICE', {}], ['ALQ-LOC', 'Alquiler de locales', 'RENT', 'ADMIN', null, 'cc-ADM', 'INVOICE', { s: 1 }],
      ['SER-LUZ', 'Energía eléctrica', 'SERVICES', 'ADMIN', null, 'cc-ADM', 'INVOICE', { s: 1 }], ['SER-AGUA', 'Agua y alcantarillado', 'SERVICES', 'ADMIN', null, 'cc-ADM', 'INVOICE', { s: 1 }], ['SER-INT', 'Internet y telefonía', 'SERVICES', 'ADMIN', null, 'cc-ADM', 'INVOICE', { s: 1 }],
      ['ADM-UTI', 'Útiles y limpieza', 'ADMIN', 'ADMIN', null, 'cc-ADM', 'RECEIPT', {}], ['ADM-TRA', 'Trámites y notaría', 'ADMIN', 'ADMIN', null, 'cc-ADM', 'RECEIPT', {}], ['OTR', 'Otros gastos', 'OTHER', 'OTHER', null, 'cc-ADM', 'RECEIPT', {}],
    ];
    const CID = {};
    for (const [code, name, grp, area, dct, cc, dt, f] of C) { const row = ins('expense_categories', { id: 'gc-' + code, code, name, category_group: grp, default_area: area, delivery_cost_type: dct, default_cost_center_id: cc, default_doc_type: dt, requires_vehicle: !!f.v, requires_gallons: !!f.g, requires_employee: !!f.e, requires_supplier: !!f.s, requires_campaign: !!f.c, status: 'ACTIVE', parent_id: null }); CID[code] = row.id; }
    // reglas: niveles generales (espejo de los parámetros) y una específica
    [[1, 0, 300], [2, 300.01, 2000], [3, 2000.01, null]].forEach(([lv, a, b]) => ins('expense_approval_rules', { id: 'gr-L' + lv, min_amount: a, max_amount: b, level: lv, permission_code: LEVELS[lv][1], category_id: null, establishment_id: null, status: 'ACTIVE', note: 'Nivel general (D-GAS-01)' }));
    ins('expense_approval_rules', { id: 'gr-ALQ', min_amount: 0, max_amount: null, level: 3, permission_code: LEVELS[3][1], category_id: CID['ALQ-LOC'], establishment_id: null, status: 'ACTIVE', note: 'Los contratos de alquiler los aprueba gerencia sin importar el monto' });
    // caja chica
    const F1 = ins('petty_cash_funds', { id: 'pcf-L1', cash_account_id: 'ca-CCH-L1', establishment_id: 'es-L1', custodian_user_id: U_ADM, fund_amount: 1000, max_expense_amount: 200, status: 'ACTIVE' });
    const F2 = ins('petty_cash_funds', { id: 'pcf-L2', cash_account_id: 'ca-CCH-L2', establishment_id: 'es-L2', custodian_user_id: U_OSC, fund_amount: 1000, max_expense_amount: 200, status: 'ACTIVE' });
    const REP = {};
    [[F1, 'L1', [['2026-09-01', '2026-09-15', 'REIMBURSED'], ['2026-09-16', '2026-09-30', 'REIMBURSED'], ['2026-10-01', null, 'OPEN']]], [F2, 'L2', [['2026-09-01', '2026-09-15', 'REIMBURSED'], ['2026-09-16', '2026-09-30', 'APPROVED'], ['2026-10-01', null, 'OPEN']]]].forEach(([f, code, list]) => list.forEach(([a, b, s], i) => {
      REP[code + i] = ins('petty_cash_reports', { id: `pcr-${code}-${i + 1}`, fund_id: f.id, number: G.db.next('RCC-' + code, `RCC-${code}-`, 4), period_from: a, period_to: b || G.TODAY, total_expenses: 0, replenishment_amount: null, status: s, submitted_at: b ? G.date.add(b, 1) + 'T10:00' : null, submitted_by: b ? f.custodian_user_id : null, approved_by: s !== 'OPEN' ? U_GER : null, approved_at: s !== 'OPEN' ? G.date.add(b, 2) + 'T11:30' : null, reimbursed_at: s === 'REIMBURSED' ? G.date.add(b, 3) + 'T09:00' : null, reimbursed_from: s === 'REIMBURSED' ? 'ca-BCP-CTE' : null });
    }));
    const repFor = (site, date) => { const code = site === 'es-L2' ? 'L2' : 'L1'; return date <= '2026-09-15' ? REP[code + 0] : date <= '2026-09-30' ? REP[code + 1] : REP[code + 2]; };
    // plantillas recurrentes
    const RT = [['REC-ALQ-L1', 'Alquiler Local 1 (Surco)', 'ALQ-LOC', 'su-GAS-INMLP', 'es-L1', 'cc-ADM', 5310, 1, true, U_ADM], ['REC-ALQ-L2', 'Alquiler Local 2 (Lurín)', 'ALQ-LOC', 'su-GAS-INMLU', 'es-L2', 'cc-PROD-L2', 3540, 1, true, U_ADM], ['REC-LUZ-L1', 'Energía Local 1', 'SER-LUZ', 'su-GAS-LUZ', 'es-L1', 'cc-PROD-L1', 1920, 6, false, U_ADM], ['REC-LUZ-L2', 'Energía Local 2 (cámaras y producción)', 'SER-LUZ', 'su-GAS-LUZ', 'es-L2', 'cc-PROD-L2', 2640, 6, false, U_ADM],
      ['REC-AGU-L1', 'Agua Local 1', 'SER-AGUA', 'su-GAS-AGUA', 'es-L1', 'cc-ADM', 310, 8, false, U_ADM], ['REC-AGU-L2', 'Agua Local 2', 'SER-AGUA', 'su-GAS-AGUA', 'es-L2', 'cc-PROD-L2', 268, 8, false, U_ADM], ['REC-INT-L1', 'Internet y telefonía Local 1', 'SER-INT', 'su-GAS-TEL', 'es-L1', 'cc-ADM', 239, 3, false, U_ADM], ['REC-INT-L2', 'Internet Local 2', 'SER-INT', 'su-GAS-TEL', 'es-L2', 'cc-PROD-L2', 179, 3, false, U_ADM],
      ['REC-MOTO', 'Alquiler moto MTC-789 (mes)', 'DEL-ALQ', null, 'es-L2', 'cc-DEL', 1380.6, 2, false, U_COO]];
    const motos = G.db.find('suppliers', s => s.supplier_type === 'VEHICLE_RENTAL');
    for (const [code, name, c, sup, site, cc, total, day, mix, owner] of RT) ins('expense_recurrences', { id: 'grc-' + code, code, name, category_id: CID[c], supplier_id: sup || (motos && motos.id), establishment_id: site, cost_center_id: cc, brand_id: 'br-DG', doc_type: 'INVOICE', total, day_of_month: day, allocate_by_sales_mix: mix, owner_user_id: owner, status: 'ACTIVE', last_generated_period: '2026-10-01' });
    const MIX = [['br-DG', 58], ['br-M2', 12], ['br-M3', 11], ['br-M4', 7], ['br-M5', 12]];
    // generador de gastos
    let inv = 3400;
    const apprFor = (lvl, by) => lvl === 3 ? U_GER : lvl === 2 ? (by === U_ADM ? U_GER : U_ADM) : (by === U_COO ? U_ADM : by === U_ADM ? U_GER : (by === U_MKT || by === U_SUP ? U_ADM : U_COO));
    function E(o) {
      const c = G.db.get('expense_categories', CID[o.cat]);
      const d = Object.assign({ establishment_id: 'es-L1', cost_center_id: c.default_cost_center_id, brand_id: 'br-DG', currency: 'PEN', doc_type: c.default_doc_type, other_taxes: 0 }, o, { category_id: c.id });
      if (d.doc_type === 'INVOICE') d.igv = R(d.total - d.total / 1.18); else d.igv = 0;
      if (['INVOICE', 'RECEIPT', 'TICKET', 'FEES_RECEIPT', 'FOREIGN_INVOICE'].includes(d.doc_type) && !d.doc_number) { inv += 1 + U.int(r, 0, 40); d.doc_series = d.doc_series || { INVOICE: 'F00' + U.int(r, 1, 3), RECEIPT: 'B00' + U.int(r, 1, 4), TICKET: 'T' + U.int(r, 100, 299), FEES_RECEIPT: 'E001', FOREIGN_INVOICE: 'INV' }[d.doc_type]; d.doc_number = String(inv); }
      const cp = GAS.compute(d); const row = rowFrom(d, cp);
      const by = o.by || U_ADM; let status = o.status || 'PAID'; if (o.petty && status === 'PAID' && repFor(d.establishment_id, d.issue_date).status !== 'REIMBURSED') status = 'APPROVED';
      const t0 = d.issue_date + 'T' + U.pad(U.int(r, 8, 18), 2) + ':' + U.pad(U.int(r, 0, 59), 2);
      const lvl = GAS.levelFor(cp.amount_pen, c.id, d.establishment_id);
      Object.assign(row, { number: G.db.next('GAS', 'GS-', 6), status, created_by: by, created_at: t0, pay_source: o.petty ? 'PETTY' : 'PAYABLE', receipt_file_id: d.doc_type === 'NONE' || o.nophoto ? null : 'fa-seed-' + inv, receipt_photo: d.doc_type === 'NONE' || o.nophoto ? null : { name: `${(d.doc_series || 'doc').toLowerCase()}-${d.doc_number || 'sn'}.jpg`, taken_at: t0 }, required_level: lvl, history: [{ at: t0, action: 'Registrado', user: G.userName(by) }] });
      if (o.petty) { const rep = repFor(d.establishment_id, d.issue_date); row.petty_cash_report_id = rep.id; if (row.status === 'PAID' && rep.status !== 'REIMBURSED') row.status = 'APPROVED'; row.paid_from_account_id = d.establishment_id === 'es-L2' ? 'ca-CCH-L2' : 'ca-CCH-L1'; }
      if (status !== 'DRAFT') { row.submitted_at = G.date.add(d.issue_date, 0) + 'T' + U.pad(Math.min(23, Number(t0.slice(11, 13)) + 1), 2) + ':' + t0.slice(14, 16); row.history.push({ at: row.submitted_at, action: `Enviado a aprobación (${LEVELS[lvl][0]})`, user: G.userName(by) }); }
      if (o.flag) { row.accounting_flag = o.flag; row.accounting_note = o.note; }
      if (o.reviewed) { row.accounting_reviewed_at = G.date.add(d.issue_date, 4) + 'T16:00'; row.accounting_reviewed_by = usr('CPC'); row.accounting_note = o.reviewed; }
      const e = ins('expenses', row);
      if (o.mix) { let acc = 0; MIX.forEach(([b, p], i) => { const amt = i === MIX.length - 1 ? R(e.amount_pen - acc) : R(e.amount_pen * p / 100); acc = R(acc + amt); ins('expense_allocations', { expense_id: e.id, cost_center_id: e.cost_center_id, brand_id: b, sales_channel: null, pct: p, amount: amt }); }); e.allocated = true; }
      if (['APPROVED', 'PAID'].includes(status) || o.endorse || status === 'REJECTED') {
        const hrs = o.hours != null ? o.hours : U.int(r, 2, lvl === 3 ? 52 : 30);
        const at = new Date(new Date(row.submitted_at + ':00Z').getTime() + hrs * 3600000).toISOString().slice(0, 16);
        if (o.endorse) { const lv1 = U_COO === by ? U_SUP : U_COO; ins('expense_approvals', { expense_id: e.id, level: 1, approver_user_id: lv1, decision: 'APPROVED', comment: 'Visto bueno', decided_at: at }); e.history.push({ at, action: `Visto bueno de ${LEVELS[1][0]}; falta ${LEVELS[lvl][0]}`, user: G.userName(lv1) }); }
        else if (status === 'REJECTED') { const ap = apprFor(Math.max(lvl, 1), by); ins('expense_approvals', { expense_id: e.id, level: GAS.userLevel(ap), approver_user_id: ap, decision: 'REJECTED', comment: o.reject, decided_at: at }); e.rejection_reason = o.reject; e.history.push({ at, action: 'Rechazado', user: G.userName(ap), note: o.reject }); }
        else {
          const ap = apprFor(lvl, by);
          ins('expense_approvals', { expense_id: e.id, level: Math.max(lvl, GAS.userLevel(ap)), approver_user_id: ap, decision: 'APPROVED', comment: null, decided_at: at });
          e.approved_by = ap; e.approved_at = at; e.history.push({ at, action: `Aprobado (${LEVELS[Math.max(lvl, GAS.userLevel(ap))][0]})`, user: G.userName(ap) });
          if (status === 'PAID') { const pd = o.petty ? (row.petty_cash_report_id && G.db.get('petty_cash_reports', row.petty_cash_report_id).reimbursed_at || at) : (at.slice(0, 10) > G.TODAY ? G.TODAY : G.date.add(at.slice(0, 10), U.int(r, 0, 3)) > G.TODAY ? G.TODAY : G.date.add(at.slice(0, 10), U.int(r, 0, 3))) + 'T11:00'; e.paid_at = pd; if (!o.petty) { e.paid_from_account_id = o.acc || (r() < 0.7 ? 'ca-BCP-CTE' : 'ca-IBK-CTE'); e.payment_reference = 'OP' + U.int(r, 1000000, 9999999); } e.paid_amount = R(e.amount_pen - (e.withholding_amount || 0)); e.history.push({ at: pd, action: 'Pagado', user: G.userName(U_ADM) }); }
          GAS.copyToDelivery(e);
        }
      }
      if (status === 'VOIDED') { e.void_reason = o.void; e.voided_at = G.date.add(d.issue_date, 1) + 'T09:00'; e.history.push({ at: e.voided_at, action: 'Anulado', user: G.userName(by), note: o.void }); }
      return e;
    }
    const ADS = n => (G.db.find('ad_campaigns', a => a.id === n) || {}).id || null;
    const veh = { P: 've-MTA-123', H: 've-BXR-871', J: 've-MTC-789' };
    const months = [['2026-09-01', 30, false], ['2026-10-01', 10, true]];
    for (const [m0, ndays, cur] of months) {
      const day = n => G.date.add(m0, n - 1);
      const st = (d, base = 'PAID') => !cur ? base : (G.date.diff(G.TODAY, d) <= 1 ? 'SUBMITTED' : G.date.diff(G.TODAY, d) <= 4 ? (r() < 0.55 ? 'APPROVED' : 'SUBMITTED') : base === 'PAID' && r() < 0.5 ? 'APPROVED' : base);
      // fijos del mes
      const fx = (code, cat, sup, site, cc, total, d, mix, extra = {}) => E(Object.assign({ cat, supplier_id: sup, establishment_id: site, cost_center_id: cc, total, issue_date: day(d), description: `${(G.db.get('expense_recurrences', 'grc-' + code) || {}).name} · ${G.date.monthName(m0)}`, recurrence_id: 'grc-' + code, mix, by: U_ADM, status: cur ? (d <= 3 ? 'APPROVED' : 'SUBMITTED') : 'PAID', acc: 'ca-BCP-CTE' }, extra));
      fx('REC-ALQ-L1', 'ALQ-LOC', 'su-GAS-INMLP', 'es-L1', 'cc-ADM', 5310, 1, true);
      fx('REC-ALQ-L2', 'ALQ-LOC', 'su-GAS-INMLU', 'es-L2', 'cc-PROD-L2', 3540, 1, true);
      fx('REC-INT-L1', 'SER-INT', 'su-GAS-TEL', 'es-L1', 'cc-ADM', 239, 3, false);
      fx('REC-INT-L2', 'SER-INT', 'su-GAS-TEL', 'es-L2', 'cc-PROD-L2', 179, 3, false);
      fx('REC-LUZ-L1', 'SER-LUZ', 'su-GAS-LUZ', 'es-L1', 'cc-PROD-L1', cur ? 1874.3 : 1921.6, 6, false);
      fx('REC-LUZ-L2', 'SER-LUZ', 'su-GAS-LUZ', 'es-L2', 'cc-PROD-L2', cur ? 2712.4 : 2638.9, 6, false);
      fx('REC-AGU-L1', 'SER-AGUA', 'su-GAS-AGUA', 'es-L1', 'cc-ADM', cur ? 296.4 : 311.2, 8, false);
      fx('REC-AGU-L2', 'SER-AGUA', 'su-GAS-AGUA', 'es-L2', 'cc-PROD-L2', cur ? 254.9 : 268.5, 8, false);
      E({ cat: 'DEL-ALQ', supplier_id: motos && motos.id, establishment_id: 'es-L2', vehicle_id: veh.J, total: 1380.6, issue_date: day(2), description: `Alquiler moto MTC-789 · ${G.date.monthName(G.date.addMonths(m0, -1))} (26 días × S/ 45)`, recurrence_id: 'grc-REC-MOTO', by: U_COO, status: cur ? 'APPROVED' : 'PAID' });
      // combustible: Pedro (moto) cada 3 días, Hugo (furgoneta) cada 3-4 días, Julio (moto L2) cada 3 días
      for (const [who, uid, every, lo, hi, price, gr, site] of [['P', U_PED, 3, 38, 55, 17.6, 'su-GAS-GRIFO', 'es-L1'], ['H', U_HUG, 3, 150, 215, 16.2, 'su-GAS-GRIFO', 'es-L1'], ['J', U_JUL, 3, 32, 46, 17.4, 'su-GAS-GRIFO2', 'es-L2']]) {
        let odo = { P: 18050, H: 63500, J: 9550 }[who] - (cur ? 0 : 900);
        for (let d = 1 + (who === 'H' ? 1 : who === 'J' ? 2 : 0); d <= ndays; d += every + (who === 'H' && r() < 0.4 ? 1 : 0)) {
          const total = R(U.int(r, lo * 10, hi * 10) / 10); odo += who === 'H' ? U.int(r, 160, 240) : U.int(r, 90, 140);
          const s = st(day(d));
          E({ cat: 'DEL-COMB', supplier_id: gr, establishment_id: site, vehicle_id: veh[who], employee_id: empOf(uid), total, fuel_gallons: R(total / price, 3), fuel_voucher_no: 'V-' + U.int(r, 20000, 29999), odometer_km: odo, issue_date: day(d), description: `Combustible ${who === 'H' ? 'diésel' : 'gasohol 90'} · ruta ${site === 'es-L2' ? 'Lurín' : 'Surco'}`, by: uid, status: cur ? s : 'PAID', nophoto: cur && d === ndays && who === 'P' ? true : false });
        }
      }
      // peajes de la furgoneta (ticket, caja chica L1) y alimentación de repartidores (boleta, caja chica)
      for (let d = 2; d <= ndays; d += 2) E({ cat: 'DEL-PEAJE', supplier_id: 'su-GAS-PEAJE', vehicle_id: veh.H, employee_id: empOf(U_HUG), doc_type: 'TICKET', total: 7.5 * (r() < 0.3 ? 2 : 1), issue_date: day(d), description: 'Peaje Panamericana Sur (Surco–Lurín)', by: U_HUG, petty: true, status: cur ? (d >= 9 ? 'SUBMITTED' : 'APPROVED') : 'PAID' });
      for (let d = 3; d <= ndays; d += 4) for (const uid of [U_PED, U_JUL]) { const site = uid === U_JUL ? 'es-L2' : 'es-L1'; E({ cat: 'DEL-ALIM', supplier_id: 'su-GAS-POLLO', employee_id: empOf(uid), doc_type: 'RECEIPT', total: [12, 14, 15][U.int(r, 0, 2)], issue_date: day(d), establishment_id: site, description: 'Menú en ruta (doble turno)', by: U_COO, petty: true, status: cur ? (d >= 9 ? 'SUBMITTED' : 'APPROVED') : 'PAID' }); }
      E({ cat: 'DEL-MOV', doc_type: 'MOBILITY_SHEET', employee_id: empOf(U_PED), total: 25, issue_date: day(cur ? 7 : 12), description: 'Taxi de regreso al local con la caja de cobros (moto en taller)', by: U_COO, petty: true, status: cur ? 'APPROVED' : 'PAID', reviewed: cur ? null : 'Planilla de movilidad: no deducible hasta confirmar requisitos (D-GAS-05)' });
      // empresas de delivery y provincia
      E({ cat: 'DEL-EMP', supplier_id: G.db.find('suppliers', s => s.trade_name === 'Express Lima').id, total: cur ? 1062 : 2124, issue_date: day(cur ? 5 : 30), description: cur ? 'Express Lima · repartos del 01 al 04/10 (Chorrillos y Jesús María)' : 'Express Lima · repartos tercerizados de setiembre (118 entregas)', by: U_COO, status: cur ? 'SUBMITTED' : 'APPROVED', endorse: cur });
      for (const d of (cur ? [4, 9] : [5, 12, 19, 26])) E({ cat: 'DEL-PROV', supplier_id: G.db.find('suppliers', s => s.trade_name.startsWith('Andinos')).id, total: R(U.int(r, 1600, 2700) / 10), issue_date: day(d), description: `Flete a provincia (${U.pick(r, ['Huancayo', 'Arequipa', 'Trujillo', 'Ica'])}) · cajas isotérmicas`, by: U_COO, status: st(day(d)) });
      // mantenimiento y multas
      if (!cur) { E({ cat: 'DEL-MANT', supplier_id: 'su-GAS-TALLER', vehicle_id: 've-MTB-456', total: 280, issue_date: day(11), description: 'Cambio de pastillas, cadena y aceite · MTB-456', by: U_COO }); E({ cat: 'DEL-MULTA', doc_type: 'SIMPLE_RECEIPT', vehicle_id: veh.H, total: 220, issue_date: day(18), description: 'Papeleta SAT por estacionar en zona rígida (BXR-871)', by: U_COO, reviewed: 'Multa: no deducible' }); }
      else { E({ cat: 'DEL-SOAT', supplier_id: G.db.find('suppliers', s => s.trade_name === 'Frío Total').id, vehicle_id: 've-MTB-456', total: 365, issue_date: day(8), description: 'Renovación SOAT moto MTB-456 (vence el 03/11)', by: U_COO, status: 'SUBMITTED', flag: 'OBSERVED', note: 'El proveedor no corresponde a una aseguradora: adjunta la póliza o la factura correcta' }); E({ cat: 'DEL-MANT', supplier_id: 'su-GAS-TALLER', vehicle_id: veh.P, total: 145, issue_date: day(6), description: 'Parchado y cámara posterior · MTA-123', by: U_COO, status: 'APPROVED' }); }
      // publicidad (plataformas) y creadores de contenido
      const pub = cur ? [['Google Ads', 'PEN', 1200, 'ac-DG-GOOGLE-SRCH', 'br-DG', 'cc-MKT-DG', 5], ['Meta Ads', 'USD', 280, 'ac-DG-META-CTWA', 'br-DG', 'cc-MKT-DG', 3], ['Meta Ads', 'USD', 95, 'ac-M5-META-CTWA', 'br-M5', 'cc-MKT-M5', 8]]
        : [['Google Ads', 'PEN', 2850, 'ac-DG-GOOGLE-SRCH', 'br-DG', 'cc-MKT-DG', 30], ['Meta Ads', 'USD', 690, 'ac-DG-META-CTWA', 'br-DG', 'cc-MKT-DG', 30], ['TikTok Ads', 'USD', 210, 'ac-DG-TIKTOK-VID', 'br-DG', 'cc-MKT-DG', 30], ['Meta Ads', 'USD', 140, 'ac-M2-META-CTWA', 'br-M2', 'cc-MKT-M2', 30], ['Meta Ads', 'USD', 120, 'ac-M3-META-CTWA', 'br-M3', 'cc-MKT-M3', 30], ['Meta Ads', 'USD', 90, 'ac-M4-META-CTWA', 'br-M4', 'cc-MKT-M4', 30], ['Google Ads', 'PEN', 480, 'ac-M5-GOOGLE-SRCH', 'br-M5', 'cc-MKT-M5', 30], ['Meta Ads', 'USD', 160, 'ac-M5-META-CTWA', 'br-M5', 'cc-MKT-M5', 30]];
      const existsAds = G.db.find('expenses', e => !e.number && e.ad_campaign_id);
      if (!existsAds) for (const [sup, curr, tot, camp, b, cc, d] of pub) { const s = G.db.find('suppliers', x => x.trade_name === sup) || G.db.find('suppliers', x => x.supplier_type === 'ADVERTISING'); E({ cat: 'PUB-ANUN', supplier_id: s.id, doc_type: 'FOREIGN_INVOICE', currency: curr, total: tot, ad_campaign_id: ADS(camp), brand_id: b, cost_center_id: cc, sales_channel: camp.includes('CTWA') ? 'WHATSAPP' : camp.includes('TIKTOK') ? 'TIKTOK' : 'WEB', issue_date: day(d), description: `${s.trade_name} · consumo ${cur ? 'por umbral' : 'de setiembre'} · ${(G.db.get('ad_campaigns', camp) || {}).name || camp}`, by: U_MKT, status: cur ? 'APPROVED' : 'PAID' }); }
      const vale = supT('Vale Cocina'), renzo = supT('Renzo Parrillero');
      if (!cur) { E({ cat: 'PUB-CREA', supplier_id: vale, doc_type: 'FEES_RECEIPT', total: 800, ad_campaign_id: ADS('ac-DG-META-CTWA'), sales_channel: 'INSTAGRAM', issue_date: day(14), description: 'Reel de receta «cuy al horno con papas nativas» + 3 historias', by: U_MKT }); E({ cat: 'PUB-CREA', supplier_id: renzo, doc_type: 'FEES_RECEIPT', total: 1800, brand_id: 'br-M2', cost_center_id: 'cc-MKT-M2', ad_campaign_id: ADS('ac-M2-META-CTWA'), sales_channel: 'TIKTOK', issue_date: day(20), description: 'Serie de 4 videos de parrilla con cortes de Marca 2', by: U_MKT }); }
      else { E({ cat: 'PUB-CREA', supplier_id: vale, doc_type: 'FEES_RECEIPT', total: 800, ad_campaign_id: ADS('ac-DG-META-CTWA'), sales_channel: 'INSTAGRAM', issue_date: day(7), description: 'Reel «caldo de gallina para el frío» + historias', by: U_MKT, status: 'SUBMITTED' }); E({ cat: 'PUB-CREA', supplier_id: renzo, doc_type: 'FEES_RECEIPT', total: 1200, brand_id: 'br-M2', cost_center_id: 'cc-MKT-M2', ad_campaign_id: ADS('ac-M2-META-CTWA'), sales_channel: 'TIKTOK', issue_date: day(9), description: 'Video «bondiola a la caja china»', by: U_MKT, status: 'DRAFT', nophoto: true }); }
      // empaques, insumos y equipos
      E({ cat: 'INS-EMP', supplier_id: 'su-GAS-IMPR', total: cur ? 413 : 1062, establishment_id: 'es-L2', issue_date: day(cur ? 2 : 4), description: cur ? 'Etiquetas adhesivas con registro sanitario (3 000 u)' : 'Bolsas impresas Don Guando y Marca 5 (2 000 u)', by: U_ADM, status: cur ? 'APPROVED' : 'PAID' });
      E({ cat: 'INS-EMP', supplier_id: 'su-GAS-ENV', total: 944, establishment_id: 'es-L2', issue_date: day(cur ? 6 : 9), description: 'Botellas PET de 1 L y 500 ml para caldos (1 600 u)', by: U_ADM, status: cur ? 'SUBMITTED' : 'PAID' });
      E({ cat: 'EQU-MAN', supplier_id: G.db.find('suppliers', s => s.trade_name === 'Frío Total').id, total: cur ? 1534 : 885, establishment_id: cur ? 'es-L1' : 'es-L2', cost_center_id: cur ? 'cc-PROD-L1' : 'cc-PROD-L2', issue_date: day(cur ? 7 : 16), description: cur ? 'Correctivo cámara de frío Local 1: compresor y gas refrigerante (excursión 7,8 °C)' : 'Mantenimiento preventivo cámara Local 2', by: U_ADM, status: cur ? 'SUBMITTED' : 'PAID' });
      // caja chica: útiles, limpieza, insumos menores, muestras
      const small = [['ADM-UTI', 'su-GAS-LIB', 'es-L1', 46.5, 'Archivadores, tóner y papel bond'], ['ADM-UTI', 'su-GAS-LIMP', 'es-L1', 78.9, 'Detergente, lejía y desinfectante'], ['PRO-INS', null, 'es-L2', 35, 'Hierbas y especias en mercado de Lurín (huacatay, ají panca)'], ['PRO-INS', 'su-GAS-LIMP', 'es-L2', 58, 'Balón de gas GLP 10 kg'], ['COM-MUE', null, 'es-L1', 120, 'Degustación de caldos en bodega de Surco'], ['ADM-TRA', null, 'es-L1', 96, 'Legalización de libros en notaría']];
      small.forEach(([c, sup, site, tot, desc], i) => { if (cur && i > 3) return; const d = cur ? 2 + i * 2 : 3 + i * 4; const simple = !sup; E({ cat: c, supplier_id: sup, doc_type: simple ? (c === 'ADM-TRA' ? 'RECEIPT' : 'SIMPLE_RECEIPT') : 'RECEIPT', establishment_id: site, cost_center_id: site === 'es-L2' ? (c === 'PRO-INS' ? 'cc-PROD-L2' : 'cc-ADM') : (c === 'COM-MUE' ? 'cc-VEN-DG' : 'cc-ADM'), total: tot, issue_date: day(d), description: desc, by: site === 'es-L2' ? U_OSC : U_ADM, petty: true, status: cur ? (d >= 8 ? 'SUBMITTED' : 'APPROVED') : 'PAID', reviewed: simple && !cur ? 'Recibo simple: gasto aceptado sin crédito fiscal' : null }); });
    }
    // casos especiales de octubre
    E({ cat: 'DEL-COMB', supplier_id: 'su-GAS-GRIFO', vehicle_id: veh.P, employee_id: empOf(U_PED), total: 180, fuel_gallons: 10.2, fuel_voucher_no: 'V-24417', issue_date: '2026-10-04', description: 'Combustible gasohol 90 (registrado con monto del vale de la semana)', by: U_PED, status: 'REJECTED', reject: 'El monto no coincide con el vale (S/ 52,00). Corrige y reenvía.' });
    E({ cat: 'DEL-COMB', supplier_id: 'su-GAS-GRIFO2', vehicle_id: veh.J, employee_id: empOf(U_JUL), total: 41.2, fuel_gallons: 2.37, issue_date: '2026-10-05', description: 'Combustible gasohol 90 · registrado dos veces desde el celular', by: U_JUL, status: 'VOIDED', void: 'Duplicado de GS del mismo vale' });
    E({ cat: 'ADM-UTI', doc_type: 'NONE', total: 18, issue_date: '2026-10-09', description: 'Copias y anillado de contratos (sin comprobante)', by: U_ADM, petty: true, status: 'SUBMITTED' });
    E({ cat: 'OTR', supplier_id: 'su-GAS-LIB', doc_type: 'INVOICE', total: 236, issue_date: '2026-10-08', description: 'Factura emitida a nombre de persona natural (no a la empresa)', by: U_SUP, status: 'SUBMITTED', flag: 'OBSERVED', note: 'La factura está a nombre de otra persona: pide al proveedor una factura a nombre de la empresa' });
    // totales de las rendiciones cerradas
    for (const rep of G.db.all('petty_cash_reports')) if (rep.status !== 'OPEN') { const t = R(U.sum(G.db.where('expenses', e => e.petty_cash_report_id === rep.id && ['APPROVED', 'PAID'].includes(e.status)), e => e.amount_pen)); rep.total_expenses = t; rep.replenishment_amount = t; }
    // normaliza gastos que otro módulo haya creado antes (p. ej. ADS) sin los campos de GAS
    for (const e of G.db.all('expenses')) if (!e.number) Object.assign(e, { number: G.db.next('GAS', 'GS-', 6), status: e.status || 'APPROVED', accounting_flag: e.accounting_flag || 'OK', amount_pen: e.amount_pen ?? e.total, net_pen: e.net_pen ?? R((e.total || 0) - (e.igv || 0)), brand_id: e.brand_id || 'br-DG', establishment_id: e.establishment_id || 'es-L1', category_id: e.category_id || CID['PUB-ANUN'], cost_center_id: e.cost_center_id || 'cc-MKT-DG', issue_date: e.issue_date || G.TODAY, pay_source: 'PAYABLE', history: e.history || [] });
  }, 'gastos');

  /* ------------------------------------------------------------------
     Pruebas de aceptación (CA-GAS-01 … 08)
     ------------------------------------------------------------------ */
  const T = (name, fn) => G.tests.push({ module: 'GAS', name, fn });
  const uidOf = role => (G.db.find('users', u => u.role === role && u.status === 'ACTIVE') || {}).id;
  const expectRule = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code} y la operación pasó.`); };
  const fuelCase = () => {
    if (!G.db.get('vehicles', 've-ABC-123')) G.db.insert('vehicles', { id: 've-ABC-123', plate: 'ABC-123', vehicle_type: 'MOTO', ownership: 'OWN', establishment_id: 'es-L1', capacity_kg: 60, refrigerated: false, status: 'ACTIVE', fuel_type: 'GASOLINE' }, { silent: true });
    return { establishment_id: 'es-L1', cost_center_id: 'cc-DEL', brand_id: 'br-DG', category_id: 'gc-DEL-COMB', supplier_id: 'su-GAS-GRIFO', doc_type: 'INVOICE', doc_series: 'F001', doc_number: '345', issue_date: '2026-10-09', currency: 'PEN', total: 180, igv: 27.46, vehicle_id: 've-ABC-123', employee_id: (G.db.get('users', uidOf('REPARTIDOR')) || {}).employee_id, fuel_gallons: 10.5, fuel_voucher_no: 'V-30001', description: 'Combustible moto ABC-123', receipt_file_id: 'fa-test', pay_source: 'PAYABLE' };
  };
  T('CA-GAS-01: combustible S/ 180 aprobado aparece en DEL como S/ 152,54 con 10,5 galones', () => {
    const e = GAS.create(fuelCase(), { submit: true, user_id: uidOf('COORDINADOR_DELIVERY') });
    if (e.subtotal !== 152.54) throw new Error('Base esperada 152,54 y salió ' + e.subtotal);
    const a = GAS.approve(e.id, { user_id: uidOf('SUPERVISORA_VENTAS') });
    if (a.status !== 'APPROVED') throw new Error('No quedó aprobado');
    const dc = G.db.find('delivery_costs', d => d.expense_id === e.id);
    if (!dc || dc.cost_type !== 'FUEL' || dc.amount !== 152.54 || dc.fuel_gallons !== 10.5) throw new Error('Costo de DEL incorrecto: ' + JSON.stringify(dc));
    if (!G.db.find('domain_events', x => x.name === 'expense.approved' && x.payload.expense_id === e.id)) throw new Error('No se emitió expense.approved');
  });
  T('CA-GAS-02: gasto de S/ 1500 con solo aprobación de nivel 1 se rechaza con RN-GAS-07', () => {
    const d = Object.assign(fuelCase(), { category_id: 'gc-INS-EMP', cost_center_id: 'cc-PROD-L2', supplier_id: 'su-GAS-IMPR', doc_number: '9001', total: 1500, igv: 228.81, vehicle_id: null, fuel_gallons: null, description: 'Bolsas impresas' });
    const e = GAS.create(d, { submit: true, user_id: uidOf('MARKETING') });
    if (GAS.requiredLevel(e) !== 2) throw new Error('Debía requerir nivel 2');
    GAS.endorse(e.id, { user_id: uidOf('COORDINADOR_DELIVERY') });
    const err = expectRule(() => GAS.approve(e.id, { user_id: uidOf('SUPERVISORA_VENTAS') }), 'RN-GAS-07');
    if (!/nivel 2/i.test(err.message)) throw new Error('El mensaje no indica que requiere nivel 2: ' + err.message);
    GAS.approve(e.id, { user_id: uidOf('ADMINISTRACION') });
    if (G.db.get('expenses', e.id).status !== 'APPROVED') throw new Error('Nivel 2 no pudo aprobar');
  });
  T('CA-GAS-03: el coordinador no aprueba su propio gasto (RN-GAS-08)', () => {
    const coo = uidOf('COORDINADOR_DELIVERY');
    const e = GAS.create(Object.assign(fuelCase(), { doc_number: '777' }), { submit: true, user_id: coo });
    expectRule(() => GAS.approve(e.id, { user_id: coo }), 'RN-GAS-08');
    if (G.db.get('expenses', e.id).status !== 'SUBMITTED') throw new Error('El gasto cambió de estado');
  });
  T('CA-GAS-04: la factura F001-345 del mismo proveedor no se registra dos veces (RN-GAS-05)', () => {
    GAS.create(fuelCase(), { submit: true, user_id: uidOf('COORDINADOR_DELIVERY') });
    expectRule(() => GAS.create(fuelCase(), { user_id: uidOf('COORDINADOR_DELIVERY') }), 'RN-GAS-05');
  });
  T('CA-GAS-05: movilidad de S/ 25 sin comprobante queda marcada y en la bandeja de la contadora', () => {
    const e = GAS.create({ establishment_id: 'es-L1', cost_center_id: 'cc-DEL', brand_id: 'br-DG', category_id: 'gc-DEL-MOV', doc_type: 'NONE', issue_date: '2026-10-10', total: 25, employee_id: (G.db.get('users', uidOf('REPARTIDOR')) || {}).employee_id, description: 'Movilidad de regreso', pay_source: 'PAYABLE' }, { submit: true, user_id: uidOf('COORDINADOR_DELIVERY') });
    if (e.accounting_flag !== 'NO_VALID_RECEIPT') throw new Error('No quedó marcado NO_VALID_RECEIPT');
    if (!GAS.inbox().some(x => x.id === e.id)) throw new Error('No aparece en la bandeja de la contadora');
  });
  T('CA-GAS-06: gasto de S/ 250 en la caja chica del Local 1 (fondo S/ 1000, máx. S/ 200) se rechaza con RN-GAS-09', () => {
    const f = GAS.fundFor('es-L1'); if (f.fund_amount !== 1000 || GAS.fundMax(f) !== 200) throw new Error('Fondo del Local 1 distinto de lo esperado');
    expectRule(() => GAS.create({ establishment_id: 'es-L1', cost_center_id: 'cc-ADM', brand_id: 'br-DG', category_id: 'gc-ADM-UTI', doc_type: 'RECEIPT', issue_date: '2026-10-10', total: 250, description: 'Útiles', pay_source: 'PETTY' }), 'RN-GAS-09');
  });
  T('CA-GAS-07: alquiler de S/ 2000 repartido 60/40 deja S/ 1200 y S/ 800; con 90 % se rechaza con RN-GAS-04', () => {
    const e = GAS.create({ establishment_id: 'es-L1', cost_center_id: 'cc-ADM', brand_id: 'br-DG', category_id: 'gc-ALQ-LOC', supplier_id: 'su-GAS-INMLP', doc_type: 'INVOICE', doc_series: 'F002', doc_number: '1200', issue_date: '2026-10-10', total: 2000, igv: 305.08, description: 'Alquiler de depósito', receipt_file_id: 'fa-t', pay_source: 'PAYABLE' }, { user_id: uidOf('ADMINISTRACION') });
    expectRule(() => GAS.setAllocations(e.id, [{ cost_center_id: 'cc-VEN-DG', brand_id: 'br-DG', pct: 60 }, { cost_center_id: 'cc-VEN-M2', brand_id: 'br-M2', pct: 30 }]), 'RN-GAS-04');
    GAS.setAllocations(e.id, [{ cost_center_id: 'cc-VEN-DG', brand_id: 'br-DG', pct: 60 }, { cost_center_id: 'cc-VEN-M2', brand_id: 'br-M2', pct: 40 }]);
    GAS.submit(e.id, { user_id: uidOf('ADMINISTRACION') });
    GAS.approve(e.id, { user_id: uidOf('GERENTE') });
    const by = Object.fromEntries(GAS.allocationsOf(e.id).map(a => [a.cost_center_id, a.amount]));
    if (by['cc-VEN-DG'] !== 1200 || by['cc-VEN-M2'] !== 800) throw new Error('Montos por centro de costo: ' + JSON.stringify(by));
  });
  T('CA-GAS-08: creadora con recibo por honorarios de S/ 800 para «Cuy navideño» suma S/ 800 al costo de creadores (KPI-ADS-07)', () => {
    const camp = G.db.insert('ad_campaigns', { id: 'ac-TEST-NAV', account_id: 'aa-DG-META', brand_id: 'br-DG', platform: 'META', code: 'DG-ME-NAV', name: 'Cuy navideño', objective: 'MESSAGES', status: 'ACTIVE', daily_budget: 50 }, { silent: true });
    const vale = G.db.find('suppliers', s => s.supplier_type === 'CONTENT_CREATOR');
    const e = GAS.create({ establishment_id: 'es-L1', cost_center_id: 'cc-MKT-DG', brand_id: 'br-DG', category_id: 'gc-PUB-CREA', supplier_id: vale.id, doc_type: 'FEES_RECEIPT', doc_series: 'E001', doc_number: '88', issue_date: '2026-10-10', total: 800, ad_campaign_id: camp.id, description: 'Reel navideño', receipt_file_id: 'fa-t', pay_source: 'PAYABLE' }, { submit: true, user_id: uidOf('MARKETING') });
    if (e.withholding_amount !== 0) throw new Error('S/ 800 no supera el umbral de retención');
    GAS.approve(e.id, { user_id: uidOf('ADMINISTRACION') });
    const k = G.kpiCalc['KPI-ADS-07'] ? G.kpi('KPI-ADS-07', { campaign: camp.id, campaign_id: camp.id, from: '2026-10-01', to: '2026-10-31' }) : null;
    const v = GAS.creatorCost(camp.id);
    if (v !== 800) throw new Error('Costo de creadores esperado 800 y salió ' + v);
    if (k && typeof k.value === 'number' && k.value !== 800 && k.value < 800) throw new Error('KPI-ADS-07 no suma el gasto: ' + k.value);
  });
})();
