/* =====================================================================
   CON · Consignación (fase 3) · CON-01 … CON-17
   Puntos de venta en consignación (cliente con RUC y almacén CONSIGNMENT
   propio), contratos con comisión o margen y escalas por volumen, equipos
   en comodato, entregas con guía de remisión (motivo 05) y Registro de
   consignaciones, app de visitas (conteo, retiros, fotos, reposición),
   liquidación con factura dentro de 9 días hábiles, incentivos y
   rentabilidad neta por punto.
   Expone G.con (dominio) para B2B, TAB y pruebas.
   ===================================================================== */
(function () {
  const { h, btn, badge, status, page, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs, pills, chart, confirm } = G.ui;
  const U = G.util, F = G.fmt, D = G.db;
  const R = (n, d = 2) => U.round(n, d);
  const T = { pts: 'consignment_points', ctr: 'consignment_contracts', cp: 'consignment_contract_products', tier: 'consignment_margin_tiers', tgt: 'consignment_targets', eq: 'consignment_equipment_loans', vis: 'consignment_visits', del: 'consignment_deliveries', dl: 'consignment_delivery_lines', reg: 'consignment_register', cnt: 'consignment_visit_counts', ph: 'consignment_visit_photos', st: 'consignment_settlements', sl: 'consignment_settlement_lines', hol: 'calendar_holidays' };
  const P = k => G.param(k);
  const num = (v, d = 0) => F.num(v, d);
  const err = e => toast(e && e.message ? e.message : String(e), 'bad');
  const tryDo = (fn, ok) => { try { const r = fn(); if (ok) toast(ok, 'ok'); G.refresh(); return r; } catch (e) { err(e); return null; } };
  const PSTATUS = { PROSPECT: ['Prospecto', 'info'], ACTIVE: ['Activo', 'ok'], SUSPENDED: ['Suspendido', 'warn'], CLOSED: ['Cerrado', ''] };
  const pBadge = s => badge((PSTATUS[s] || [s])[0], (PSTATUS[s] || [, ''])[1]);
  const ETYPE = { DELIVERY: ['Entrega', 'info'], SALE: ['Venta informada', 'ok'], RETURN: ['Devolución', 'warn'], WITHDRAWAL: ['Retiro por vencer', 'bad'], SURPLUS: ['Sobrante', 'warn'], REVERSAL: ['Reverso', ''] };
  const eBadge = t => badge((ETYPE[t] || [t])[0], (ETYPE[t] || [, ''])[1]);
  const EQT = [['FREEZER', 'Congeladora'], ['COOLER', 'Exhibidora refrigerada'], ['DISPLAY', 'Exhibidor'], ['SHELF', 'Estante'], ['OTHER', 'Otro']];
  const eqName = t => (EQT.find(x => x[0] === t) || [t, t])[1];
  const VSTAT = { PLANNED: 'PLANNED', IN_PROGRESS: 'IN_PROGRESS', DONE: 'DONE', MISSED: 'MISSED', CANCELLED: 'CANCELLED' };
  const WD = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const dow = d => G.date.parse(d).getUTCDay();
  const dayLabel = d => `${WD[dow(d)]} ${F.date(d).slice(0, 5)}`;

  /* =================================================================
     Dominio
     ================================================================= */
  const CON = G.con = {};
  CON.point = id => D.get(T.pts, id);
  CON.pointName = p => { p = typeof p === 'string' ? CON.point(p) : p; return p ? G.custName(p.customer_id) : '—'; };
  CON.byCustomer = cid => D.find(T.pts, p => p.customer_id === cid);
  /** RN-CON-24: el visitador solo ve sus puntos */
  CON.visiblePoints = () => { const all = D.all(T.pts); if (G.ctx.role === 'VISITADOR_CONSIGNACION' && !G.can('con.visit.view_all')) return all.filter(p => p.visitor_user_id === G.ctx.userId()); return all; };
  CON.contracts = pid => D.where(T.ctr, c => c.point_id === pid).sort(U.by('valid_from', -1));
  CON.activeContract = (pid, date = G.TODAY) => D.find(T.ctr, c => c.point_id === pid && c.status === 'ACTIVE' && c.valid_from <= date && (!c.valid_to || c.valid_to >= date));
  CON.products = cid => D.where(T.cp, x => x.contract_id === cid);
  CON.cprod = (cid, vid) => D.find(T.cp, x => x.contract_id === cid && x.variant_id === vid && x.active !== false);
  CON.visitCost = p => p.visit_cost != null && p.visit_cost !== '' ? Number(p.visit_cost) : (P('con_default_visit_cost') ?? 15);

  /* ---------- días hábiles (función add_business_days) ---------- */
  CON.holidays = () => new Set(D.all(T.hol).filter(x => !x.establishment_id).map(x => x.holiday_date));
  CON.isBusinessDay = (d, hs) => { hs = hs || CON.holidays(); const w = dow(d); return w !== 0 && w !== 6 && !hs.has(d); };
  CON.addBusinessDays = (d, n) => { const hs = CON.holidays(); let x = d, c = 0; while (c < n) { x = G.date.add(x, 1); if (CON.isBusinessDay(x, hs)) c++; } return x; };
  /** días hábiles en (a, b]; negativo si b es anterior a a */
  CON.businessDaysBetween = (a, b) => { if (a === b) return 0; const hs = CON.holidays(); const s = b > a ? 1 : -1; let x = s > 0 ? a : b; const hi = s > 0 ? b : a; let c = 0; while (x < hi) { x = G.date.add(x, 1); if (CON.isBusinessDay(x, hs)) c++; } return c * s; };
  /** RN-CON-16: día límite = fecha de venta + 9 días hábiles */
  CON.dueDate = sale => CON.addBusinessDays(sale, P('con_invoice_business_days') ?? 9);
  /** RN-CON-16: fecha de venta según con_sale_date_basis */
  CON.saleDate = (prevDate, visitDate, reported) => reported || (P('con_sale_date_basis') === 'VISIT_DATE' ? visitDate : prevDate ? G.date.add(prevDate, 1) : visitDate);
  /** RN-CON-20: semáforo del plazo */
  CON.light = s => {
    if (!s) return { tone: '', label: '—' };
    if (s.status === 'VOIDED') return { tone: '', label: 'Anulada' };
    if (s.status === 'INVOICED') return s.invoiced_on > s.due_date ? { tone: 'bad', label: 'Facturada fuera de plazo', late: true } : { tone: 'ok', label: 'Facturada a tiempo' };
    const left = CON.businessDaysBetween(G.TODAY, s.due_date);
    if (left < 0) return { tone: 'bad', label: `Vencida hace ${-left} día(s) hábil(es)`, code: 'RED' };
    if (left <= (P('con_invoice_alert_business_days') ?? 2)) return { tone: 'warn', label: left === 0 ? 'Vence hoy' : `Faltan ${left} día(s) hábil(es)`, code: 'AMBER' };
    return { tone: 'ok', label: `Faltan ${left} días hábiles`, code: 'GREEN' };
  };
  const lightBadge = s => { const l = CON.light(s); return badge(l.label, l.tone); };

  /* ---------- cálculos puros ---------- */
  /** RN-CON-12: vendido = teórico − contado − devuelto − vencido + sobrante; nunca negativo */
  CON.calcCount = ({ opening = 0, delivered = 0, counted, returned = 0, expired = 0 }) => {
    if (counted === null || counted === undefined || counted === '' || Number(counted) < 0) G.fail('RN-CON-12', 'El conteo debe ser un número igual o mayor que cero.');
    const theo = R(Number(opening) + Number(delivered), 3); const rest = R(theo - Number(returned) - Number(expired), 3);
    if (rest < -0.0005) G.fail('RN-CON-12', `Lo devuelto y retirado (${num(Number(returned) + Number(expired), 0)}) supera el stock teórico (${num(theo, 0)}).`);
    const c = Number(counted);
    const surplus = c > rest ? R(c - rest, 3) : 0;
    const sold = R(Math.max(0, rest - c), 3);
    return { theo, sold, surplus };
  };
  CON.tiers = cid => D.where(T.tier, t => t.contract_id === cid).sort(U.by('from_amount'));
  /** RN-CON-21: tramo alcanzado aplicado a toda la venta del mes (WHOLE) o por tramos (MARGINAL) */
  CON.commission = (contract, amount, tiersOverride) => {
    if (!contract) return { pct: 0, amount: 0, tier: null };
    const tiers = tiersOverride || CON.tiers(contract.id);
    if (!tiers.length) { const pct = contract.compensation_type === 'COMMISSION' ? Number(contract.commission_pct) || 0 : 0; return { pct, amount: R(amount * pct / 100), tier: null }; }
    const ts = tiers.slice().sort(U.by('from_amount'));
    if (P('con_tier_mode') === 'MARGINAL') {
      let tot = 0; ts.forEach((t, i) => { const hi = ts[i + 1] ? ts[i + 1].from_amount : Infinity; const part = Math.max(0, Math.min(amount, hi) - t.from_amount); tot += part * t.pct / 100; });
      return { pct: amount ? R(tot / amount * 100, 2) : 0, amount: R(tot), tier: ts.filter(t => t.from_amount <= amount + 1e-9).pop() || ts[0] };
    }
    const t = ts.filter(x => x.from_amount <= amount + 1e-9).pop() || ts[0];
    return { pct: t.pct, amount: R(amount * t.pct / 100), tier: t };
  };
  /** RN-CON-15: reposición sugerida */
  CON.suggest = ({ soldWindow, windowDays, daysToNext, safety, counted, max }) => {
    const daily = windowDays ? soldWindow / windowDays : 0;
    let qty = Math.max(0, Math.ceil(R(daily * (daysToNext + safety), 6)) - counted);
    if (max != null && max !== '') qty = Math.max(0, Math.min(qty, Number(max) - counted));
    return { daily: R(daily, 3), qty };
  };
  /** KPI-CON-05 / RN-CON-25: margen neto */
  CON.netMargin = ({ sales, commission, visits, visitCost, expiredCost }) => R(sales - commission - visits * visitCost - expiredCost);
  /** saldo vencido del punto (RN-CON-22; usa B2B si está) */
  CON.overdueDays = cid => {
    if (G.b2b && G.b2b.overdueDays) return G.b2b.overdueDays(cid);
    const ds = D.where('sales_documents', d => d.customer_id === cid && d.payment_terms === 'CREDIT' && (d.balance || 0) > 0.009 && d.due_date && d.status !== 'VOIDED');
    return ds.reduce((m, d) => Math.max(m, G.date.diff(G.TODAY, d.due_date)), 0);
  };

  /* ---------- registro de consignaciones (solo inserción, RN-CON-09) ---------- */
  CON.reg = row => D.insert(T.reg, Object.assign({ reversal_of: null, sales_document_id: null, gre_series: null, gre_number: null, reason: null }, row), { silent: true });
  CON.reverseEntry = (id, reason) => {
    const e = D.get(T.reg, id); if (!e) G.fail('RN-CON-09', 'Asiento no encontrado.');
    if (!reason) G.fail('RN-CON-09', 'El reverso exige motivo.');
    if (e.entry_type === 'REVERSAL') G.fail('RN-CON-09', 'Un reverso no se revierte: registra un asiento nuevo.');
    if (D.find(T.reg, x => x.reversal_of === id)) G.fail('RN-CON-09', 'Este asiento ya tiene su reverso.');
    if (!G._seeding) G.period.assertOpen(G.TODAY);
    return CON.reg({ point_id: e.point_id, entry_type: 'REVERSAL', entry_date: G.TODAY, variant_id: e.variant_id, lot_id: e.lot_id, qty: -e.qty, unit_price: e.unit_price, amount: e.amount != null ? -e.amount : null, gre_series: e.gre_series, gre_number: e.gre_number, source_type: 'REVERSAL', source_id: e.id, reversal_of: e.id, reason });
  };

  /* ---------- puntos ---------- */
  CON.savePoint = (d, existing) => {
    const c = D.get('customers', d.customer_id);
    if (!c || c.doc_type !== 'RUC' || !U.rucOk(c.doc_number)) G.fail('RN-CON-01', `${c ? G.custName(c.id) : 'El cliente'} no tiene RUC válido: un punto de consignación recibe factura por lo vendido.`);
    if (c.customer_type !== 'CONSIGNMENT_POINT') G.fail('RN-CON-01', `${G.custName(c.id)} es de tipo ${c.customer_type}; cambia su tipo a punto de consignación (CONSIGNMENT_POINT) en CLI antes de crear el punto.`);
    const f = Number(d.visit_frequency_days) || 7; const mx = P('con_max_visit_interval_days') ?? 7;
    if (f > mx) G.fail('RN-CON-17', `La frecuencia de visita (${f} días) supera el máximo de ${mx} días: no quedaría margen para facturar en 9 días hábiles.`);
    if (!existing && CON.byCustomer(d.customer_id)) G.fail('RN-CON-02', `${G.custName(c.id)} ya es un punto de consignación.`);
    const a = D.find('customer_addresses', x => x.customer_id === c.id && x.is_default);
    if (existing) return D.update(T.pts, existing.id, { supply_establishment_id: d.supply_establishment_id, zone_id: d.zone_id || existing.zone_id, visitor_user_id: d.visitor_user_id || null, visit_frequency_days: f, visit_weekdays: d.visit_weekdays || existing.visit_weekdays, visit_cost: d.visit_cost === '' ? null : d.visit_cost });
    const whId = 'wh-CSG-' + c.id.slice(3);
    if (D.get('warehouses', whId) || D.find(T.pts, p => p.warehouse_id === whId)) G.fail('RN-CON-02', 'El almacén del punto ya existe y no se comparte.');
    D.insert('warehouses', { id: whId, establishment_id: d.supply_establishment_id || 'es-L1', code: 'CSG-' + c.id.slice(3), name: 'Consignación · ' + G.custName(c.id), wh_type: 'CONSIGNMENT', customer_id: c.id, min_temp_c: null, max_temp_c: null, status: 'ACTIVE', allows_sale: false, pick_priority: 999 });
    return D.insert(T.pts, { customer_id: c.id, warehouse_id: whId, supply_establishment_id: d.supply_establishment_id || 'es-L1', zone_id: d.zone_id || (a && a.zone_id) || null, address_id: a ? a.id : null, visitor_user_id: d.visitor_user_id || null, visit_frequency_days: f, visit_weekdays: d.visit_weekdays || [], visit_cost: d.visit_cost === '' || d.visit_cost == null ? null : Number(d.visit_cost), lat: a ? a.lat : null, lng: a ? a.lng : null, status: 'PROSPECT', opened_on: null, closed_on: null, close_reason: null });
  };
  CON.setPointStatus = (p, st, reason) => {
    if (!G.can('con.point.manage')) G.fail('RN-CON-01', 'Tu rol no tiene el permiso con.point.manage.');
    if (st === 'CLOSED') {
      const loans = D.where(T.eq, e => e.point_id === p.id && e.status === 'LOANED');
      if (loans.length) G.fail('RN-CON-23', `El punto tiene ${loans.length} equipo(s) prestado(s) sin devolver (${loans.map(e => e.asset_code).join(', ')}): registra la devolución o la baja con motivo antes de cerrarlo.`);
      const stock = D.where('stock_balances', b => b.warehouse_id === p.warehouse_id && b.qty > 0.0005);
      if (stock.length) G.fail('RN-CON-23', `El punto aún tiene ${stock.length} lote(s) en stock: retíralos en una visita antes de cerrarlo.`);
      if (!reason) G.fail('RN-CON-23', 'Cerrar un punto exige motivo.');
    }
    if (st === 'ACTIVE' && !CON.activeContract(p.id)) G.fail('RN-CON-03', 'Para activar el punto registra y aprueba un contrato vigente (CON-03).');
    return D.update(T.pts, p.id, { status: st, opened_on: st === 'ACTIVE' ? (p.opened_on || G.TODAY) : p.opened_on, closed_on: st === 'CLOSED' ? G.TODAY : null, close_reason: st === 'CLOSED' || st === 'SUSPENDED' ? reason : null });
  };

  /* ---------- contratos ---------- */
  CON.saveContract = (d, existing) => {
    if (!d.point_id) G.fail('RN-CON-03', 'Elige el punto.');
    if (!d.valid_from) G.fail('RN-CON-03', 'Indica el inicio de la vigencia.');
    if (d.valid_to && d.valid_to < d.valid_from) G.fail('RN-CON-03', 'La vigencia termina antes de empezar.');
    if (d.compensation_type === 'COMMISSION') { const mx = P('con_max_commission_pct') ?? 40; const pc = Number(d.commission_pct); if (!(pc >= 0 && pc <= mx)) G.fail('RN-CON-04', `Con comisión, el porcentaje debe estar entre 0 y ${mx} %.`); }
    const st = d.status || (existing ? existing.status : 'DRAFT');
    if (st === 'ACTIVE') {
      const ov = D.find(T.ctr, c => c.point_id === d.point_id && c.status === 'ACTIVE' && (!existing || c.id !== existing.id) && c.valid_from <= (d.valid_to || '9999-12-31') && d.valid_from <= (c.valid_to || '9999-12-31'));
      if (ov) G.fail('RN-CON-03', `Ya hay un contrato activo (${ov.number}, del ${F.date(ov.valid_from)} al ${ov.valid_to ? F.date(ov.valid_to) : 'indefinido'}) que se traslapa con esta vigencia: termina el anterior o cambia las fechas.`);
    }
    const row = { point_id: d.point_id, valid_from: d.valid_from, valid_to: d.valid_to || null, compensation_type: d.compensation_type, commission_pct: d.compensation_type === 'COMMISSION' ? Number(d.commission_pct) : null, settlement_frequency_days: Number(d.settlement_frequency_days) || 7, withdraw_days_before_expiry: d.withdraw_days_before_expiry === '' || d.withdraw_days_before_expiry == null ? (P('con_withdraw_days_before_expiry') ?? 3) : Number(d.withdraw_days_before_expiry), signed_file_url: d.signed_file_url || null, status: st };
    if (existing) return D.update(T.ctr, existing.id, row);
    return D.insert(T.ctr, Object.assign(row, { number: d.number || D.next('CTC', 'CC-2026-', 3), version: d.version || 1, previous_id: d.previous_id || null, approved_by: null, approved_at: null, terminated_reason: null }));
  };
  CON.approveContract = c => {
    if (!G.can('con.contract.approve')) G.fail('RN-CON-03', 'Aprobar contratos exige el permiso con.contract.approve (GERENTE).');
    if (!c.signed_file_url) G.fail('RN-CON-03', 'Adjunta el acta firmada (PDF) antes de aprobar.');
    CON.saveContract(Object.assign({}, c, { status: 'ACTIVE' }), c);
    return D.update(T.ctr, c.id, { approved_by: G.ctx.userId(), approved_at: G.date.now() });
  };
  CON.saveProduct = (d, existing) => {
    const c = D.get(T.ctr, d.contract_id); if (!c) G.fail('RN-CON-05', 'Contrato no encontrado.');
    if (!(Number(d.consignor_price) > 0)) G.fail('RN-CON-04', 'El precio al punto debe ser mayor que cero.');
    if (c.compensation_type === 'MARGIN' && !(Number(d.suggested_retail_price) > Number(d.consignor_price))) G.fail('RN-CON-04', 'En un contrato de margen el precio sugerido al público debe ser mayor que el precio al punto.');
    if (d.max_qty !== '' && d.max_qty != null && Number(d.max_qty) < Number(d.min_qty || 0)) G.fail('RN-CON-10', 'El stock máximo no puede ser menor que el mínimo.');
    if (!existing && CON.cprod(c.id, d.variant_id)) G.fail('RN-CON-05', 'Ese producto ya está en el contrato.');
    const row = { contract_id: c.id, variant_id: d.variant_id, consignor_price: Number(d.consignor_price), suggested_retail_price: d.suggested_retail_price ? Number(d.suggested_retail_price) : null, min_qty: Number(d.min_qty) || 0, max_qty: d.max_qty === '' || d.max_qty == null ? null : Number(d.max_qty), active: d.active !== false };
    return existing ? D.update(T.cp, existing.id, row) : D.insert(T.cp, row);
  };
  CON.saveTier = (cid, from, pct) => {
    if (!G.can('con.contract.approve')) G.fail('RN-CON-21', 'Las escalas las aprueba GERENTE (con.contract.approve).');
    if (D.find(T.tier, t => t.contract_id === cid && Number(t.from_amount) === Number(from))) G.fail('RN-CON-21', `El contrato ya tiene un tramo que empieza en ${F.money(from)}: los tramos no repiten su monto inicial.`);
    if (!(pct >= 0 && pct <= 100)) G.fail('RN-CON-21', 'El porcentaje debe estar entre 0 y 100.');
    return D.insert(T.tier, { contract_id: cid, from_amount: Number(from), pct: Number(pct) });
  };

  /* ---------- equipos en comodato ---------- */
  CON.loanEquipment = d => {
    if (!G.can('con.equipment.manage')) G.fail('RN-CON-23', 'Tu rol no tiene el permiso con.equipment.manage.');
    if (!d.loan_agreement_url) G.fail('RN-CON-23', 'Todo equipo prestado tiene acta de comodato: adjúntala.');
    if (!d.asset_code) G.fail('RN-CON-23', 'Indica el código del activo.');
    return D.insert(T.eq, { point_id: d.point_id, equipment_type: d.equipment_type, asset_code: d.asset_code, serial_number: d.serial_number || null, description: d.description || null, asset_value: Number(d.asset_value) || 0, loan_agreement_url: d.loan_agreement_url, delivered_on: d.delivered_on || G.TODAY, returned_on: null, last_check_on: null, last_temp_c: null, status: 'LOANED', status_reason: null });
  };
  CON.endLoan = (e, st, reason) => {
    if (!G.can('con.equipment.manage')) G.fail('RN-CON-23', 'Tu rol no tiene el permiso con.equipment.manage.');
    if (st !== 'RETURNED' && !reason) G.fail('RN-CON-23', 'La baja, pérdida o daño exige motivo.');
    return D.update(T.eq, e.id, { status: st, returned_on: st === 'RETURNED' ? G.TODAY : null, status_reason: reason || null });
  };

  /* ---------- stock en el punto (vista consignment_point_stock_v) ---------- */
  CON.stock = p => {
    const c = CON.activeContract(p.id);
    return D.where('stock_balances', b => b.warehouse_id === p.warehouse_id && b.qty > 0.0005).map(b => {
      const l = b.lot_id ? D.get('lots', b.lot_id) : null; const cp = c ? CON.cprod(c.id, b.variant_id) : null;
      return { key: b.variant_id + '|' + (b.lot_id || ''), point_id: p.id, variant_id: b.variant_id, lot_id: b.lot_id, lot: l, qty: b.qty, expiry: l ? l.expiry_date : null, days_left: l && l.expiry_date ? G.date.diff(l.expiry_date, G.TODAY) : null, price: cp ? cp.consignor_price : 0, value: R(b.qty * (cp ? cp.consignor_price : 0)), cost: R(b.qty * (b.avg_cost || 0)), recalled: l && l.qc_status === 'RECALLED' };
    }).sort((a, b) => String(a.expiry || '9').localeCompare(String(b.expiry || '9')));
  };
  CON.stockValue = p => R(U.sum(CON.stock(p), s => s.value));
  CON.originWh = (vid, site = 'es-L1') => { const pr = G.productOf(vid) || {}; const sx = site === 'es-L2' ? 'L2' : 'L1'; return pr.storage === 'FROZEN' ? 'wh-CNG-' + sx : pr.storage === 'CHILLED' ? 'wh-CAM-' + sx : 'wh-ALM-' + sx; };

  /* ---------- entregas ---------- */
  CON.checkLine = ({ point, contract, variant_id, lot_id, qty, date, extraQty = 0, overrideReason }) => {
    const cp = contract && CON.cprod(contract.id, variant_id);
    if (!cp) G.fail('RN-CON-05', `${G.variantName(variant_id)} no está permitido en el contrato ${contract ? contract.number : ''} del punto.`);
    if (lot_id) {
      const l = D.get('lots', lot_id);
      if (!l || l.qc_status !== 'RELEASED') G.fail('RN-CON-06', `El lote ${l ? l.code : lot_id} no está liberado (${l ? G.ui.statusLabel(l.qc_status) : '—'}).`);
      const min = P('con_min_shelf_days_on_delivery') ?? 10; const left = G.date.diff(l.expiry_date, date || G.TODAY);
      if (left < min) G.fail('RN-CON-06', `El lote ${l.code} de ${G.variantName(variant_id)} vence el ${F.date(l.expiry_date)}: le quedan ${left} días de vida útil y el mínimo para consignar es ${min}.`);
    }
    const after = R(G.inv.qty(variant_id, point.warehouse_id) + extraQty + Number(qty), 3);
    if (cp.max_qty && after > cp.max_qty + 1e-9) {
      if (!overrideReason) G.fail('RN-CON-10', `Con esta entrega el punto tendría ${num(after)} de ${G.variantName(variant_id)} y el máximo del contrato es ${num(cp.max_qty)}. Solo con el permiso con.delivery.override_max y motivo.`);
      if (!G.can('con.delivery.override_max')) G.fail('RN-CON-10', `Superar el máximo (${num(cp.max_qty)}) exige el permiso con.delivery.override_max (GERENTE).`);
    }
    return cp;
  };
  CON.assertCanDeliver = (p, date) => {
    if (!p || p.status !== 'ACTIVE') G.fail('RN-CON-03', `El punto ${CON.pointName(p)} no está activo: no recibe entregas.`);
    const c = CON.activeContract(p.id, date); if (!c) G.fail('RN-CON-03', `${CON.pointName(p)} no tiene contrato vigente al ${F.date(date)}: sin contrato no se despachan entregas.`);
    const od = CON.overdueDays(p.customer_id); const lim = P('con_block_overdue_days') ?? 15;
    if (od > lim) G.fail('RN-CON-22', `${CON.pointName(p)} tiene deuda vencida hace ${od} días (máximo ${lim}): no recibe entregas nuevas hasta pagar (saldo en B2B).`);
    return c;
  };
  /** arma una entrega en borrador; sin lote reparte por FEFO entre lotes con vida útil suficiente */
  CON.createDelivery = ({ point_id, date = G.TODAY, lines, overrideReason, visit_id }) => {
    const p = CON.point(point_id); const c = CON.assertCanDeliver(p, date);
    if (!lines || !lines.filter(l => Number(l.qty) > 0).length) G.fail('RN-CON-05', 'Agrega al menos un producto con cantidad.');
    const min = P('con_min_shelf_days_on_delivery') ?? 10; const out = []; const added = {};
    for (const ln of lines.filter(l => Number(l.qty) > 0)) {
      const wh = ln.warehouse_id || CON.originWh(ln.variant_id, p.supply_establishment_id);
      if (ln.lot_id) { const cp = CON.checkLine({ point: p, contract: c, variant_id: ln.variant_id, lot_id: ln.lot_id, qty: ln.qty, date, extraQty: added[ln.variant_id] || 0, overrideReason }); out.push({ variant_id: ln.variant_id, lot_id: ln.lot_id, qty: Number(ln.qty), wh, cp }); added[ln.variant_id] = (added[ln.variant_id] || 0) + Number(ln.qty); continue; }
      CON.checkLine({ point: p, contract: c, variant_id: ln.variant_id, lot_id: null, qty: ln.qty, date, extraQty: added[ln.variant_id] || 0, overrideReason });
      let need = Number(ln.qty);
      const cands = G.inv.fefo(ln.variant_id, wh).filter(x => x.lot && G.date.diff(x.lot.expiry_date, date) >= min);
      for (const { b, lot } of cands) { if (need <= 0.0005) break; const take = Math.min(need, R(b.qty - (b.reserved_qty || 0), 3)); if (take <= 0) continue; const cp = CON.checkLine({ point: p, contract: c, variant_id: ln.variant_id, lot_id: lot.id, qty: take, date, extraQty: added[ln.variant_id] || 0, overrideReason }); out.push({ variant_id: ln.variant_id, lot_id: lot.id, qty: take, wh, cp }); added[ln.variant_id] = (added[ln.variant_id] || 0) + take; need = R(need - take, 3); }
      if (need > 0.0005) G.fail('RN-CON-06', `No hay stock suficiente de ${G.variantName(ln.variant_id)} en ${G.whName(wh)} con al menos ${min} días de vida útil: faltan ${num(need)}.`);
    }
    if (!G._seeding) G.period.assertOpen(date);
    const d = D.insert(T.del, { point_id: p.id, contract_id: c.id, number: D.next('CENT', 'EC-', 5), delivery_date: date, from_warehouse_id: out[0].wh, visit_id: visit_id || null, dispatch_guide_id: null, gre_series: null, gre_number: null, gre_transfer_reason: null, status: 'DRAFT', dispatched_at: null, received_by_name: null, received_signature_url: null, override_max_reason: overrideReason || null, void_reason: null, created_by: G.ctx.userId() }, { silent: G._seeding });
    for (const o of out) { const l = D.get('lots', o.lot_id); D.insert(T.dl, { delivery_id: d.id, variant_id: o.variant_id, lot_id: o.lot_id, qty: o.qty, weight_kg: null, unit_price: o.cp.consignor_price, expiry_date: l ? l.expiry_date : null, warehouse_id: o.wh }, { silent: true }); }
    return d;
  };
  CON.lines = did => D.where(T.dl, l => l.delivery_id === did);
  /** solicita la GRE remitente a FAC (respaldo: serie T001 y dispatch_guides) */
  CON.requestGuide = (d, opts = {}) => {
    if (d.status !== 'DRAFT') G.fail('RN-CON-07', 'La guía se solicita para entregas en borrador.');
    if (d.gre_series && d.gre_number) return d;
    const p = CON.point(d.point_id); const reason = P('con_gre_transfer_reason_code') ?? '05';
    const ls = CON.lines(d.id); const addr = p.address_id ? D.get('customer_addresses', p.address_id) : null; const est = D.get('establishments', p.supply_establishment_id) || {};
    const gross = R(U.sum(ls, l => l.qty * ((G.variant(l.variant_id) || {}).nominal_weight_kg || 0.55)), 3) || 1;
    let g;
    if (G.fac && typeof G.fac.issueGuide === 'function') {
      const veh = opts.vehicle_id || (D.find('vehicles', v => v.establishment_id === p.supply_establishment_id && v.ownership === 'OWN') || D.find('vehicles', () => true) || {}).id; const drv = opts.driver_user_id || (D.find('users', u => u.role === 'REPARTIDOR' && u.status !== 'INACTIVE') || {}).id;
      g = G.fac.issueGuide({ reason_code: reason, transfer_reason_code: reason, transport_mode: '02', vehicle_id: veh, driver_user_id: drv, origin_establishment_id: p.supply_establishment_id, establishment_id: p.supply_establishment_id, date: d.delivery_date, recipient_customer_id: p.customer_id, issue_date: d.delivery_date, start_date: d.delivery_date, dest_address: addr ? addr.address_line : '', origin_address: est.address, gross_weight_kg: gross, packages: ls.length, source: { type: 'CONSIGNMENT_DELIVERY', id: d.id }, lines: ls.map(l => ({ variant_id: l.variant_id, lot_id: l.lot_id, qty: l.qty })) });
    } else {
      const n = G.series.next('T001');
      g = D.insert('dispatch_guides', { company_id: 'co-dg', establishment_id: p.supply_establishment_id, brand_id: null, series_id: n.series_id, series: n.series, number: n.number, full_number: n.full, issue_date: d.delivery_date, transfer_reason_code: reason, transfer_reason: 'Consignación', transport_mode: '02', start_date: d.delivery_date, vehicle_id: opts.vehicle_id || null, driver_employee_id: null, origin_ubigeo: '150140', origin_address: est.address || 'Local 1', dest_ubigeo: '150140', dest_address: addr ? addr.address_line : '', recipient_customer_id: p.customer_id, gross_weight_kg: gross, packages: ls.length, order_id: null, transfer_id: null, sales_document_id: null, sunat_status: 'ACCEPTED', status: 'ISSUED', source_type: 'CONSIGNMENT_DELIVERY', source_id: d.id, lines: ls.map(l => ({ variant_id: l.variant_id, lot_id: l.lot_id, qty: l.qty, description: G.variantName(l.variant_id) })) }, { silent: G._seeding });
    }
    D.update(T.del, d.id, { dispatch_guide_id: g.id, gre_series: g.series, gre_number: g.number, gre_transfer_reason: g.transfer_reason_code || reason }, { silent: G._seeding });
    if (!G._seeding) G.events.emit('guide.issued', { guide_id: g.id, series: g.series, number: g.number, transfer_reason_code: reason, source: 'CON', delivery_id: d.id });
    return d;
  };
  /** despacho: GRE obligatoria (RN-CON-07), stock por ALM (RN-CON-08) y asiento en el registro */
  CON.dispatch = (d, opts = {}) => {
    if (!G._seeding && !G.can('con.delivery.dispatch')) G.fail('RN-CON-07', 'Despachar exige el permiso con.delivery.dispatch.');
    if (d.status !== 'DRAFT') G.fail('RN-CON-07', `La entrega ${d.number} ya está ${G.ui.statusLabel(d.status).toLowerCase()}.`);
    const reason = P('con_gre_transfer_reason_code') ?? '05';
    if (!d.gre_series || !d.gre_number) G.fail('RN-CON-07', `La entrega ${d.number} no tiene serie y número de guía de remisión: solicita la GRE (motivo ${reason}, consignación) antes de despachar.`);
    if (d.gre_transfer_reason !== reason) G.fail('RN-CON-07', `La GRE debe tener motivo de traslado ${reason} (consignación); tiene ${d.gre_transfer_reason}.`);
    const p = CON.point(d.point_id); if (!G._seeding) CON.assertCanDeliver(p, d.delivery_date);
    const ls = CON.lines(d.id);
    // verificación previa: todo o nada (misma transacción)
    for (const l of ls) { const b = G.inv._bal(l.warehouse_id || d.from_warehouse_id, l.variant_id, l.lot_id); if (!b || b.qty - l.qty < -0.0005) G.fail('RN-ALM-03', `Stock insuficiente de ${G.variantName(l.variant_id)} (lote ${(D.get('lots', l.lot_id) || {}).code}) en ${G.whName(l.warehouse_id || d.from_warehouse_id)}.`); }
    const at = opts.at || (G._seeding ? d.delivery_date + 'T10:00' : G.date.now());
    const src = { type: 'CONSIGNMENT_DELIVERY', id: d.id };
    for (const l of ls) {
      const out = G.inv.move({ type: 'CONSIGNMENT_OUT', wh: l.warehouse_id || d.from_warehouse_id, variant: l.variant_id, lot: l.lot_id, qty: l.qty, source: src, at, reason: `Consignación ${d.number} · GRE ${d.gre_series}-${d.gre_number}`, allowUnreleased: !!G._seeding });
      G.inv.move({ type: 'TRANSFER_IN', wh: p.warehouse_id, variant: l.variant_id, lot: l.lot_id, qty: l.qty, unitCost: out.unit_cost, source: src, at, reason: 'Entrada al punto en consignación' });
      CON.reg({ point_id: p.id, entry_type: 'DELIVERY', entry_date: d.delivery_date, variant_id: l.variant_id, lot_id: l.lot_id, qty: l.qty, unit_price: l.unit_price, amount: R(l.qty * l.unit_price), gre_series: d.gre_series, gre_number: d.gre_number, source_type: 'CONSIGNMENT_DELIVERY', source_id: d.id, reason: d.override_max_reason ? 'Sobre el máximo: ' + d.override_max_reason : null });
    }
    D.update(T.del, d.id, { status: 'DISPATCHED', dispatched_at: at, received_by_name: opts.received_by || null }, { silent: G._seeding });
    if (!G._seeding) G.events.emit('consignment.delivered', { delivery_id: d.id, number: d.number, point_id: p.id, gre: `${d.gre_series}-${d.gre_number}` });
    return d;
  };
  CON.voidDelivery = (d, reason) => { if (d.status !== 'DRAFT') G.fail('RN-CON-09', 'Una entrega despachada no se anula: corrige con un reverso en el Registro de consignaciones y una devolución en la visita.'); if (!reason) G.fail('RN-CON-09', 'Anular exige motivo.'); return D.update(T.del, d.id, { status: 'VOIDED', void_reason: reason }); };

  /* ---------- visitas ---------- */
  CON.lastDone = (pid, before) => D.where(T.vis, v => v.point_id === pid && v.status === 'DONE' && (!before || v.planned_date < before)).sort(U.by('planned_date', -1))[0] || null;
  CON.nextPlanned = pid => D.where(T.vis, v => v.point_id === pid && ['PLANNED', 'IN_PROGRESS'].includes(v.status)).sort(U.by('planned_date'))[0] || null;
  /** genera la agenda desde la frecuencia del punto (idempotente) */
  CON.planVisits = (from = G.TODAY, days = 7) => {
    let n = 0; const to = G.date.add(from, days - 1);
    for (const p of D.where(T.pts, x => x.status === 'ACTIVE')) {
      const last = CON.lastDone(p.id); let next = last ? G.date.add(last.planned_date, p.visit_frequency_days) : (p.opened_on || from);
      while (next <= to) {
        if (next >= from && !D.find(T.vis, v => v.point_id === p.id && ['PLANNED', 'IN_PROGRESS', 'DONE'].includes(v.status) && Math.abs(G.date.diff(v.planned_date, next)) <= 1)) { D.insert(T.vis, { point_id: p.id, visitor_user_id: p.visitor_user_id, planned_date: next, status: 'PLANNED', started_at: null, finished_at: null, visit_cost: null, offline_uuid: null, notes: 'Generada por frecuencia' }, { silent: true }); n++; }
        next = G.date.add(next, p.visit_frequency_days);
      }
    }
    return n;
  };
  CON.reschedule = (v, date, reason) => { if (!reason) G.fail('RN-CON-17', 'Reprogramar exige motivo.'); if (v.status !== 'PLANNED') G.fail('RN-CON-17', 'Solo se reprograman visitas planificadas.'); return D.update(T.vis, v.id, { planned_date: date, notes: `Reprogramada del ${F.date(v.planned_date)}: ${reason}` }); };
  CON.markMissed = (v, reason) => { if (!reason) G.fail('RN-CON-17', 'Marca el motivo de la visita no cumplida.'); return D.update(T.vis, v.id, { status: 'MISSED', miss_reason: reason }); };
  CON.startVisit = (v, { lat, lng, reason } = {}) => {
    if (!G.can('con.visit.perform')) G.fail('RN-CON-11', 'Realizar visitas exige el permiso con.visit.perform (visitador).');
    if (v.status === 'IN_PROGRESS') return v;
    if (v.status !== 'PLANNED') G.fail('RN-CON-11', 'La visita no está planificada.');
    const p = CON.point(v.point_id);
    const dist = p.lat != null && lat != null ? R(G.geo.km([lat, lng], [p.lat, p.lng]) * 1000, 1) : null;
    const rad = P('con_visit_checkin_radius_m') ?? 150;
    if (dist != null && dist > rad && !reason) G.fail('RN-CON-11', `Estás a ${num(dist)} m del pin del punto (radio ${rad} m): indica el motivo para registrar la llegada.`);
    return D.update(T.vis, v.id, { status: 'IN_PROGRESS', started_at: G.date.now(), checkin_lat: lat, checkin_lng: lng, checkin_distance_m: dist, out_of_range_reason: dist > rad ? reason : null, visitor_user_id: G.ctx.userId() || v.visitor_user_id, offline_uuid: v.offline_uuid || ('off-' + U.token(12)), draft: v.draft || { counts: {}, sugg: {} } });
  };
  /** líneas de conteo: stock teórico por producto y lote (anterior + entregado desde el último conteo) */
  CON.countLines = (v) => {
    const p = CON.point(v.point_id); const prev = CON.lastDone(p.id, v.planned_date === G.TODAY && v.status !== 'DONE' ? '9999' : v.planned_date);
    const lastCnt = {}; if (prev) for (const c of D.where(T.cnt, c => c.visit_id === prev.id)) lastCnt[c.variant_id + '|' + (c.lot_id || '')] = c.counted_qty;
    const since = prev ? prev.planned_date : '0000';
    const delivered = {}; for (const e of D.where(T.reg, e => e.point_id === p.id && e.entry_type === 'DELIVERY' && (e.entry_date > since || (prev && e.entry_date === since && e.source_id && (D.get(T.del, e.source_id) || {}).visit_id === prev.id)))) { const k = e.variant_id + '|' + (e.lot_id || ''); delivered[k] = (delivered[k] || 0) + e.qty; }
    return CON.stock(p).map(s => { const opening = lastCnt[s.key] != null ? lastCnt[s.key] : Math.max(0, R(s.qty - (delivered[s.key] || 0), 3)); let del = R(s.qty - opening, 3); if (del < 0) del = 0; return Object.assign({}, s, { opening: R(s.qty - del, 3), delivered: del, theo: s.qty }); });
  };
  /** RN-CON-13: lotes a retirar (vencen dentro de N días o retirados del mercado) */
  CON.proposals = (v) => {
    const p = CON.point(v.point_id); const c = CON.activeContract(p.id) || {};
    const nd = c.withdraw_days_before_expiry ?? P('con_withdraw_days_before_expiry') ?? 3; const date = v.planned_date;
    return CON.stock(p).filter(s => s.recalled || (s.expiry && G.date.diff(s.expiry, date) <= nd)).map(s => Object.assign({}, s, { propose: s.qty, reason: s.recalled ? 'Lote retirado del mercado (lot.recalled)' : `Vence el ${F.date(s.expiry)} (${G.date.diff(s.expiry, date)} días)` }));
  };
  CON.soldWindow = (pid, vid, date, days) => { const from = G.date.add(date, -days); return R(U.sum(D.where(T.reg, e => e.point_id === pid && e.variant_id === vid && e.entry_type === 'SALE' && e.entry_date > from && e.entry_date <= date), e => -e.qty), 3); };
  /** reposición sugerida por producto para la visita (usa el conteo del borrador) */
  CON.suggestions = (v) => {
    const p = CON.point(v.point_id); const c = CON.activeContract(p.id); if (!c) return [];
    const dr = (v.draft || {}).counts || {}; const lines = CON.countLines(v);
    const win = P('con_rotation_window_days') ?? 28, safety = P('con_safety_days') ?? 2;
    const nxt = D.where(T.vis, x => x.point_id === p.id && x.status === 'PLANNED' && x.planned_date > v.planned_date).sort(U.by('planned_date'))[0];
    const daysToNext = nxt ? G.date.diff(nxt.planned_date, v.planned_date) : p.visit_frequency_days;
    return CON.products(c.id).filter(x => x.active !== false).map(cp => {
      const ls = lines.filter(l => l.variant_id === cp.variant_id);
      let counted = 0, soldNow = 0;
      for (const l of ls) { const d = dr[l.key] || {}; const cc = d.counted != null && d.counted !== '' ? Number(d.counted) : l.theo; counted += cc; try { soldNow += CON.calcCount({ opening: l.opening, delivered: l.delivered, counted: cc, returned: Number(d.returned) || 0, expired: Number(d.expired) || 0 }).sold; } catch (e) { } }
      const sw = R(CON.soldWindow(p.id, cp.variant_id, v.planned_date, win) + (v.status === 'DONE' ? 0 : soldNow), 3);
      const s = CON.suggest({ soldWindow: sw, windowDays: win, daysToNext, safety, counted, max: cp.max_qty });
      const ov = ((v.draft || {}).sugg || {})[cp.variant_id];
      return { variant_id: cp.variant_id, cp, counted: R(counted, 3), soldWindow: sw, daily: s.daily, daysToNext, suggested: s.qty, qty: ov ? ov.qty : s.qty, reason: ov ? ov.reason : '' };
    });
  };
  CON.setDraft = (v, patch) => { const dr = Object.assign({ counts: {}, sugg: {} }, v.draft || {}); for (const [k, val] of Object.entries(patch.counts || {})) dr.counts[k] = Object.assign({}, dr.counts[k] || {}, val); for (const [k, val] of Object.entries(patch.sugg || {})) dr.sugg[k] = val; if (patch.reported_sale_date !== undefined) dr.reported_sale_date = patch.reported_sale_date; return D.update(T.vis, v.id, { draft: dr }, { silent: true }); };
  CON.addPhoto = (v, { kind, equipment_loan_id, temp_c }) => {
    if (v.status !== 'IN_PROGRESS') G.fail('RN-CON-14', 'Registra la llegada antes de tomar fotos.');
    if (kind === 'EQUIPMENT' && (temp_c === '' || temp_c == null || isNaN(temp_c))) G.fail('RN-CON-14', 'La foto del equipo lleva la lectura del termómetro (°C).');
    const n = D.where(T.ph, x => x.visit_id === v.id).length + 1; const p = CON.point(v.point_id);
    return D.insert(T.ph, { visit_id: v.id, kind, equipment_loan_id: equipment_loan_id || null, photo_url: `fotos/visitas/${v.id}/${kind.toLowerCase()}-${n}.jpg`, temp_c: kind === 'EQUIPMENT' ? Number(temp_c) : null, taken_at: G.date.now(), lat: v.checkin_lat ?? p.lat, lng: v.checkin_lng ?? p.lng }, { silent: true });
  };
  /** cierra la visita: conteos, vendido, retiros, devoluciones, sobrantes, stock y registro */
  CON.closeVisit = (v, opts = {}) => {
    if (v.status === 'DONE') return v; // reenvío de la app sin conexión (Idempotency-Key)
    if (v.status !== 'IN_PROGRESS') G.fail('RN-CON-11', 'Marca la llegada con GPS antes de cerrar la visita.');
    const p = CON.point(v.point_id); const c = CON.activeContract(p.id, v.planned_date) || D.where(T.ctr, x => x.point_id === p.id).sort(U.by('valid_from', -1))[0];
    const phs = D.where(T.ph, x => x.visit_id === v.id); const minPh = P('con_min_exhibition_photos') ?? 1;
    if (phs.filter(x => x.kind === 'EXHIBITION').length < minPh) G.fail('RN-CON-14', `Faltan fotos de exhibición: mínimo ${minPh}.`);
    for (const e of D.where(T.eq, e => e.point_id === p.id && e.status === 'LOANED')) if (!phs.find(x => x.kind === 'EQUIPMENT' && x.equipment_loan_id === e.id)) G.fail('RN-CON-14', `Falta la foto de ${eqName(e.equipment_type).toLowerCase()} ${e.asset_code} con su temperatura.`);
    const dr = (v.draft || {}).counts || {}; const lines = CON.countLines(v);
    const prev = CON.lastDone(p.id, v.planned_date);
    const firstDel = D.where(T.reg, e => e.point_id === p.id && e.entry_type === 'DELIVERY').sort(U.by('entry_date'))[0];
    const saleDate = CON.saleDate(prev ? prev.planned_date : (firstDel ? firstDel.entry_date : null), v.planned_date, (v.draft || {}).reported_sale_date || opts.reported_sale_date);
    const calc = [];
    for (const l of lines) {
      const d = dr[l.key] || {};
      if (d.counted === undefined || d.counted === null || d.counted === '') G.fail('RN-CON-12', `Falta contar ${G.variantName(l.variant_id)}${l.lot ? ' · lote ' + l.lot.code : ''}.`);
      const r = CON.calcCount({ opening: l.opening, delivered: l.delivered, counted: Number(d.counted), returned: Number(d.returned) || 0, expired: Number(d.expired) || 0 });
      if (r.surplus > 0 && !d.surplus_reason) G.fail('RN-CON-12', `Se contaron ${num(d.counted)} de ${G.variantName(l.variant_id)} y el teórico era ${num(r.theo)}: registra el motivo del sobrante (${num(r.surplus)}).`);
      if ((Number(d.returned) || 0) > 0 && !d.return_reason) G.fail('RN-CON-13', `Indica el motivo de la devolución de ${G.variantName(l.variant_id)}.`);
      calc.push({ l, d, r });
    }
    if (!G._seeding) G.period.assertOpen(v.planned_date);
    const at = G._seeding ? v.planned_date + 'T11:00' : G.date.now(); const src = { type: 'CONSIGNMENT_VISIT', id: v.id };
    const sugg = {}; if (!G._seeding) for (const s of CON.suggestions(v)) sugg[s.variant_id] = s;
    const seenVar = new Set();
    for (const { l, d, r } of calc) {
      const cp = c ? CON.cprod(c.id, l.variant_id) : null; const price = cp ? cp.consignor_price : l.price;
      const sg = !seenVar.has(l.variant_id) && sugg[l.variant_id]; seenVar.add(l.variant_id);
      const row = D.insert(T.cnt, { visit_id: v.id, point_id: p.id, variant_id: l.variant_id, lot_id: l.lot_id, opening_qty: l.opening, delivered_qty: l.delivered, counted_qty: Number(d.counted), returned_qty: Number(d.returned) || 0, expired_qty: Number(d.expired) || 0, surplus_qty: r.surplus, surplus_reason: d.surplus_reason || null, return_reason: d.return_reason || null, sold_qty: r.sold, sale_date: saleDate, unit_price: price, suggested_qty: sg ? sg.suggested : null, suggested_override_reason: sg && sg.reason ? sg.reason : null, settled: false }, { silent: true });
      const mv = (type, wh, qty, reason, extra = {}) => qty > 0.0005 ? G.inv.move(Object.assign({ type, wh, variant: l.variant_id, lot: l.lot_id, qty, source: src, at, reason, allowUnreleased: true }, extra)) : null;
      if (r.surplus > 0) { mv('ADJUSTMENT', p.warehouse_id, r.surplus, 'Sobrante en conteo: ' + d.surplus_reason); CON.reg({ point_id: p.id, entry_type: 'SURPLUS', entry_date: v.planned_date, variant_id: l.variant_id, lot_id: l.lot_id, qty: r.surplus, unit_price: price, amount: R(r.surplus * price), source_type: 'CONSIGNMENT_VISIT_COUNT', source_id: row.id, reason: d.surplus_reason }); }
      if (r.sold > 0) { mv('SALE', p.warehouse_id, r.sold, 'Vendido por el punto (conteo)'); CON.reg({ point_id: p.id, entry_type: 'SALE', entry_date: saleDate, variant_id: l.variant_id, lot_id: l.lot_id, qty: -r.sold, unit_price: price, amount: R(r.sold * price), source_type: 'CONSIGNMENT_VISIT_COUNT', source_id: row.id }); }
      for (const [q, type, why] of [[Number(d.returned) || 0, 'RETURN', d.return_reason || 'Devuelto en buen estado'], [Number(d.expired) || 0, 'WITHDRAWAL', d.expire_reason || 'Retiro por vencer']]) {
        if (q <= 0) continue;
        const out = mv('TRANSFER_OUT', p.warehouse_id, q, why);
        G.inv.move({ type: 'CONSIGNMENT_RETURN', wh: 'wh-DEV-L1', variant: l.variant_id, lot: l.lot_id, qty: q, unitCost: out ? out.unit_cost : undefined, source: src, at, reason: `${type === 'RETURN' ? 'Devolución' : 'Retiro'} de ${CON.pointName(p)}: ${why}` });
        CON.reg({ point_id: p.id, entry_type: type, entry_date: v.planned_date, variant_id: l.variant_id, lot_id: l.lot_id, qty: -q, unit_price: price, amount: R(q * price), source_type: 'CONSIGNMENT_VISIT_COUNT', source_id: row.id, reason: why });
      }
    }
    const eqPh = phs.filter(x => x.kind === 'EQUIPMENT'); for (const ph of eqPh) D.update(T.eq, ph.equipment_loan_id, { last_check_on: v.planned_date, last_temp_c: ph.temp_c }, { silent: true });
    D.update(T.vis, v.id, { status: 'DONE', finished_at: at, visit_cost: CON.visitCost(p), sale_date: saleDate }, { silent: G._seeding });
    if (!G._seeding) G.events.emit('consignment.visit_closed', { visit_id: v.id, point_id: p.id, sold: R(U.sum(calc, x => x.r.sold), 3) });
    return v;
  };
  CON.visitSold = vid => D.where(T.cnt, c => c.visit_id === vid);

  /* ---------- liquidaciones ---------- */
  CON.unsettled = pid => D.where(T.cnt, c => c.point_id === pid && !c.settled && c.sold_qty > 0.0005);
  CON.monthGross = (pid, month, excludeId) => R(U.sum(D.where(T.st, s => s.point_id === pid && s.status !== 'VOIDED' && s.id !== excludeId && G.date.month(s.first_sale_date) === month), s => s.gross_amount));
  /** RN-CON-18: agrupa los conteos cerrados y no liquidados */
  CON.createSettlement = (pid, opts = {}) => {
    const p = CON.point(pid); const cs = (opts.counts || CON.unsettled(pid));
    if (!cs.length) G.fail('RN-CON-18', `${CON.pointName(p)} no tiene conteos cerrados por liquidar.`);
    const c = D.where(T.ctr, x => x.point_id === pid && x.valid_from <= cs[0].sale_date && (!x.valid_to || x.valid_to >= cs[0].sale_date) && ['ACTIVE', 'EXPIRED', 'TERMINATED'].includes(x.status)).sort(U.by('valid_from', -1))[0] || CON.activeContract(pid);
    if (!c) G.fail('RN-CON-03', 'No hay contrato para la fecha de venta.');
    const first = cs.map(x => x.sale_date).sort()[0]; const lastV = cs.map(x => (D.get(T.vis, x.visit_id) || {}).planned_date).sort().pop();
    const gross = R(U.sum(cs, x => x.sold_qty * x.unit_price));
    const month = G.date.month(first); const cm = CON.commission(c, CON.monthGross(pid, month) + gross);
    const s = D.insert(T.st, { point_id: pid, contract_id: c.id, number: D.next('CLQ', 'LQ-', 5), period_from: first, period_to: lastV || first, first_sale_date: first, due_date: CON.dueDate(first), gross_amount: gross, commission_pct: cm.pct, commission_amount: R(gross * cm.pct / 100), net_amount: R(gross - R(gross * cm.pct / 100)), status: 'DRAFT', approved_by: null, approved_at: null, sales_document_id: null, invoiced_on: null, credit_note_id: null, void_reason: null }, { silent: G._seeding });
    for (const x of cs) { D.insert(T.sl, { settlement_id: s.id, visit_count_id: x.id, variant_id: x.variant_id, lot_id: x.lot_id, sale_date: x.sale_date, qty: x.sold_qty, unit_price: x.unit_price, amount: R(x.sold_qty * x.unit_price) }, { silent: true }); x.settled = true; }
    D.touch();
    return s;
  };
  CON.settlementLines = sid => D.where(T.sl, l => l.settlement_id === sid);
  CON.approveSettlement = s => {
    if (!G._seeding && !G.can('con.settlement.approve')) G.fail('RN-CON-19', 'Aprobar liquidaciones exige con.settlement.approve (ADMINISTRACION, GERENTE).');
    if (s.status !== 'DRAFT') G.fail('RN-CON-19', 'Solo se aprueban liquidaciones en borrador.');
    D.update(T.st, s.id, { status: 'APPROVED', approved_by: G._seeding ? 'us-chuaman' : G.ctx.userId(), approved_at: G._seeding ? s.period_to + 'T17:00' : G.date.now() }, { silent: G._seeding });
    if (!G._seeding) G.events.emit('consignment.settled', { settlement_id: s.id, number: s.number, point_id: s.point_id, net_amount: s.net_amount });
    return s;
  };
  /** emisión de la factura por lo vendido (D-CON-04: precio al punto ya neto de comisión) */
  CON.invoiceSettlement = (s, opts = {}) => {
    if (!G._seeding && !G.can('con.settlement.invoice')) G.fail('RN-CON-19', 'Emitir la factura exige con.settlement.invoice (ADMINISTRACION, CONTADORA).');
    if (s.status !== 'APPROVED') G.fail('RN-CON-19', 'Aprueba la liquidación antes de facturar.');
    const p = CON.point(s.point_id); const ls = CON.settlementLines(s.id); const k = 1 - (s.commission_pct || 0) / 100;
    const byV = U.groupBy(ls, 'variant_id'); const dl = [];
    for (const [vid, arr] of Object.entries(byV)) { const q = R(U.sum(arr, x => x.qty), 3); const up = R(arr[0].unit_price * k, 4); const v = G.variant(vid); dl.push({ variant_id: vid, description: `${v.name} (consignación ${s.number})`, qty: q, uom_code: 'NIU', unit_price: up, igv_affectation: '10', total: R(q * up), unit_cost: v.std_cost, cost: R(q * v.std_cost) }); }
    const diff = R(s.net_amount - U.sum(dl, x => x.total)); if (dl.length && Math.abs(diff) > 0) dl[dl.length - 1].total = R(dl[dl.length - 1].total + diff);
    const byBrand = {}; for (const l of dl) { const b = G.variant(l.variant_id).brand_id; byBrand[b] = (byBrand[b] || 0) + l.total; }
    const brand = Object.entries(byBrand).sort((a, b) => b[1] - a[1])[0][0];
    const term = (D.find('customer_credit_profiles', x => x.customer_id === p.customer_id) || {}).term_days || P('b2b_default_term_days') || 15;
    const date = opts.date || G.TODAY;
    const doc = G.docs.issue({ doc_type: 'INVOICE', brand_id: brand, establishment_id: p.supply_establishment_id, customer_id: p.customer_id, lines: dl, date, payment_terms: 'CREDIT', credit_days: term, accept: opts.accept !== false, silent: G._seeding, seller_id: null });
    doc.consignment_settlement_id = s.id;
    D.update(T.st, s.id, { status: 'INVOICED', sales_document_id: doc.id, invoiced_on: date }, { silent: G._seeding });
    return doc;
  };
  CON.voidSettlement = (s, reason) => {
    if (!reason) G.fail('RN-CON-19', 'Anular exige motivo.');
    if (s.status === 'VOIDED') G.fail('RN-CON-19', 'Ya está anulada.');
    let nc = null;
    if (s.status === 'INVOICED') {
      if (!G.can('con.settlement.invoice')) G.fail('RN-CON-19', 'Anular una liquidación facturada exige con.settlement.invoice para emitir la nota de crédito.');
      const doc = D.get('sales_documents', s.sales_document_id);
      nc = G.docs.issue({ doc_type: 'CREDIT_NOTE', brand_id: doc.brand_id, establishment_id: doc.establishment_id, customer_id: doc.customer_id, related_document_id: doc.id, note_reason_code: '01', note_reason: 'Anulación de la operación: ' + reason, lines: doc.lines.map(l => Object.assign({}, l)), date: G.TODAY, accept: true, series: G.series.for('CREDIT_NOTE', doc.brand_id) });
      doc.balance = 0; D.touch();
    }
    for (const l of CON.settlementLines(s.id)) { const c = D.get(T.cnt, l.visit_count_id); if (c) c.settled = false; }
    return D.update(T.st, s.id, { status: 'VOIDED', void_reason: reason, credit_note_id: nc ? nc.id : null });
  };

  /* ---------- indicadores por punto y mes ---------- */
  CON.monthStats = (pid, from, to) => {
    const p = CON.point(pid); const inR = d => d >= from && d <= to;
    const cnts = D.where(T.cnt, c => c.point_id === pid && inR(c.sale_date || ''));
    const sales = R(U.sum(cnts, c => c.sold_qty * c.unit_price)); const soldU = R(U.sum(cnts, c => c.sold_qty), 3);
    const regs = D.where(T.reg, e => e.point_id === pid && inR(e.entry_date));
    const delU = R(U.sum(regs.filter(e => e.entry_type === 'DELIVERY'), e => e.qty) + U.sum(regs.filter(e => e.entry_type === 'REVERSAL' && (D.get(T.reg, e.reversal_of) || {}).entry_type === 'DELIVERY'), e => e.qty), 3);
    const retU = R(-U.sum(regs.filter(e => e.entry_type === 'RETURN'), e => e.qty), 3), expU = R(-U.sum(regs.filter(e => e.entry_type === 'WITHDRAWAL'), e => e.qty), 3);
    const visCnt = D.where(T.cnt, c => c.point_id === pid && D.get(T.vis, c.visit_id) && inR(D.get(T.vis, c.visit_id).planned_date));
    const expCost = R(U.sum(visCnt, c => (c.expired_qty + c.returned_qty) * ((c.lot_id && (D.get('lots', c.lot_id) || {}).unit_cost) || (G.variant(c.variant_id) || {}).std_cost || 0)));
    const visits = D.where(T.vis, v => v.point_id === pid && v.status === 'DONE' && inR(v.planned_date));
    const planned = D.where(T.vis, v => v.point_id === pid && ['DONE', 'MISSED', 'PLANNED', 'IN_PROGRESS'].includes(v.status) && inR(v.planned_date) && (v.status !== 'PLANNED' || v.planned_date < G.TODAY) );
    const c = CON.activeContract(pid, to) || D.where(T.ctr, x => x.point_id === pid).sort(U.by('valid_from', -1))[0];
    const cm = CON.commission(c, sales);
    const vc = U.sum(visits, v => v.visit_cost != null ? v.visit_cost : CON.visitCost(p));
    const net = R(sales - cm.amount - vc - expCost);
    const tg = D.find(T.tgt, t => t.point_id === pid && t.period === G.date.month(from));
    return { sales, soldU, delU, retU, expU, expCost, visits: visits.length, planned: planned.length, visitCost: vc, commission: cm.amount, pct: cm.pct, tier: cm.tier, net, target: tg ? tg.target_amount : null };
  };
  CON.recommend = st => { if (!st.sales) return ['Sin venta', 'warn']; const m = st.net / st.sales * 100; return m >= 45 ? ['Mantener', 'ok'] : m >= 25 ? ['Renegociar', 'warn'] : ['Cerrar o cambiar surtido', 'bad']; };

  /* ---------- eventos ---------- */
  G.events.on('lot.recalled', pl => {
    const lotId = pl.lot_id || pl.id; if (!lotId) return;
    for (const p of D.all(T.pts)) {
      const b = D.find('stock_balances', x => x.warehouse_id === p.warehouse_id && x.lot_id === lotId && x.qty > 0.0005); if (!b) continue;
      if (!D.find(T.vis, v => v.point_id === p.id && v.status === 'PLANNED' && v.planned_date === G.TODAY && v.urgent)) D.insert(T.vis, { point_id: p.id, visitor_user_id: p.visitor_user_id, planned_date: G.TODAY, status: 'PLANNED', urgent: true, notes: `Visita urgente: retirar el lote ${(D.get('lots', lotId) || {}).code} (${num(b.qty)} u)`, offline_uuid: null });
      G.notify({ user_id: p.visitor_user_id, title: 'Retiro de lote en consignación', body: `${CON.pointName(p)} tiene ${num(b.qty)} u del lote ${(D.get('lots', lotId) || {}).code}: visita urgente hoy.`, tone: 'bad', module: 'CON', ref: p.id });
      G.notify({ role: 'ADMINISTRACION', title: 'Lote retirado en un punto de consignación', body: `${CON.pointName(p)}: ${num(b.qty)} u del lote ${(D.get('lots', lotId) || {}).code}.`, tone: 'bad', module: 'CON' });
    }
  });
  G.events.on('document.accepted', pl => { const s = D.find(T.st, x => x.sales_document_id === pl.document_id); if (s && s.status === 'APPROVED') D.update(T.st, s.id, { status: 'INVOICED', invoiced_on: G.TODAY }, { silent: true }); });

  /* =================================================================
     Interfaz
     ================================================================= */
  const pointOpts = (pred = () => true) => CON.visiblePoints().filter(pred).map(p => [p.id, CON.pointName(p)]);
  const pointSel = (cur, onChange, pred) => { const s = h('select', { class: 'input', attrs: { 'aria-label': 'Punto', id: 'con-point-sel' }, style: 'max-width:320px' }, pointOpts(pred).map(([v, l]) => h('option', { value: v, selected: v === cur }, l))); s.addEventListener('change', () => onChange(s.value)); return s; };
  const pickPoint = params => { const vis = CON.visiblePoints(); return (params.id && vis.find(p => p.id === params.id)) || (CON._lastPoint && vis.find(p => p.id === CON._lastPoint)) || vis[0]; };
  const fileName = s => s ? String(s).split('/').pop() : '—';

  function pointDrawer(p) {
    drawer(CON.pointName(p), bd => {
      const c = CON.activeContract(p.id); const st = CON.monthStats(p.id, G.date.month(G.TODAY), G.TODAY);
      bd.appendChild(h('div', { class: 'row' }, pBadge(p.status), c ? badge(c.compensation_type === 'COMMISSION' ? `Comisión ${num(c.commission_pct, 1)} %` : 'Margen', 'info') : badge('Sin contrato vigente', 'bad'),
        btn('Ficha', () => { G.ui.closeAll(); G.go('CON-02', { id: p.id }); }, { sm: true }), btn('Contrato', () => { G.ui.closeAll(); G.go('CON-03', { id: p.id }); }, { sm: true }), btn('Nueva entrega', () => { G.ui.closeAll(); G.go('CON-06', { point: p.id }); }, { sm: true, kind: 'primary' })));
      bd.appendChild(dl([['Cliente (RUC)', `${G.custName(p.customer_id)} · ${(D.get('customers', p.customer_id) || {}).doc_number}`], ['Almacén', G.whName(p.warehouse_id)], ['Visitador', G.userName(p.visitor_user_id)], ['Frecuencia', `cada ${p.visit_frequency_days} días`], ['Stock valorizado', F.money(CON.stockValue(p))], ['Vendido del mes', F.money(st.sales)], ['Comisión del mes', `${F.money(st.commission)} (${num(st.pct, 1)} %)`], ['Margen neto del mes', F.money(st.net)]]));
      bd.appendChild(h('h3', null, 'Stock en el punto'));
      bd.appendChild(table({ id: 'con-pd-stock', search: false, columns: [{ key: 'variant_id', label: 'Producto', render: r => G.variantName(r.variant_id) }, { key: 'lot', label: 'Lote', render: r => r.lot ? r.lot.code : '—', mono: true }, { key: 'qty', label: 'Cant.', align: 'r', render: r => num(r.qty) }, { key: 'days_left', label: 'Vence en', align: 'r', render: r => r.days_left == null ? '—' : badge(F.days(r.days_left), r.days_left <= 3 ? 'bad' : r.days_left <= 10 ? 'warn' : 'ok') }], rows: CON.stock(p) }));
    }, { code: 'CON-01', wide: true });
  }

  /* ---------- CON-01 Puntos de consignación ---------- */
  function scr01(el) {
    const canM = G.can('con.point.manage');
    const body = page(el, { code: 'CON-01', title: 'Puntos de consignación', sub: 'Tiendas que venden nuestra mercadería sin comprarla: stock valorizado, venta del mes, visitas y semáforo de facturación (9 días hábiles).', actions: canM ? [{ label: 'Nuevo punto', kind: 'primary', icon: '+', onClick: () => newPointForm() }] : [] });
    const pts = CON.visiblePoints(); const m = G.date.month(G.TODAY);
    const rows = pts.filter(p => { if (G.ctx.brand === 'ALL') return true; const c = CON.activeContract(p.id); return !c || CON.products(c.id).some(x => (G.variant(x.variant_id) || {}).brand_id === G.ctx.brand); }).map(p => {
      const st = CON.monthStats(p.id, m, G.TODAY); const last = CON.lastDone(p.id);
      const pend = D.where(T.st, s => s.point_id === p.id && ['DRAFT', 'APPROVED'].includes(s.status)); const worst = pend.map(CON.light).sort((a, b) => ['bad', 'warn', 'ok', ''].indexOf(a.tone) - ['bad', 'warn', 'ok', ''].indexOf(b.tone))[0];
      const unset = CON.unsettled(p.id).length; const c = CON.activeContract(p.id);
      const brands = c ? [...new Set(CON.products(c.id).map(x => (G.variant(x.variant_id) || {}).brand_id))] : [];
      return { p, id: p.id, name: CON.pointName(p), status: p.status, zone: p.zone_id, visitor: p.visitor_user_id, freq: p.visit_frequency_days, value: CON.stockValue(p), sales: st.sales, since: last ? G.date.diff(G.TODAY, last.planned_date) : null, worst, pend: pend.length, unset, brands, overdue: CON.overdueDays(p.customer_id) };
    });
    const red = rows.filter(r => r.worst && r.worst.tone === 'bad').length, amb = rows.filter(r => r.worst && r.worst.tone === 'warn').length;
    body.appendChild(kpis([
      { label: 'Puntos activos', value: rows.filter(r => r.status === 'ACTIVE').length, sub: `${rows.length} registrados` },
      { label: 'Stock valorizado en puntos', value: F.money(U.sum(rows, r => r.value), 0), sub: 'a precio al punto', onClick: () => G.go('CON-17') },
      { label: 'Vendido del mes', value: F.money(U.sum(rows, r => r.sales), 0), sub: 'conteos de ' + G.date.monthName(G.TODAY), tone: 'ok' },
      { label: 'Liquidaciones en rojo / ámbar', value: `${red} / ${amb}`, sub: 'plazo de 9 días hábiles (RN-CON-20)', tone: red ? 'bad' : amb ? 'warn' : 'ok', onClick: () => G.go('CON-13') },
    ]));
    const zonesU = [...new Set(rows.map(r => r.zone).filter(Boolean))];
    body.appendChild(h('div', { class: 'grid side-r' },
      table({ id: 'con01', rows, onRow: r => pointDrawer(r.p), columns: [
        { key: 'name', label: 'Punto' }, { key: 'status', label: 'Estado', render: r => pBadge(r.status) }, { key: 'visitor', label: 'Visitador', render: r => G.userShort(r.visitor), value: r => G.userName(r.visitor) },
        { key: 'freq', label: 'Frec.', align: 'r', render: r => r.freq + ' d' }, { key: 'value', label: 'Stock valorizado', align: 'r', render: r => F.money(r.value) }, { key: 'sales', label: 'Vendido mes', align: 'r', render: r => F.money(r.sales) },
        { key: 'since', label: 'Últ. visita', align: 'r', render: r => r.since == null ? '—' : badge(F.days(r.since), r.since > r.freq ? 'warn' : '') },
        { key: 'worst', label: 'Liquidación', render: r => r.worst ? badge(r.worst.label, r.worst.tone) : (r.unset ? badge(`${r.unset} conteo(s) por liquidar`, 'info') : badge('Al día', 'ok')), value: r => r.worst ? r.worst.tone : '' },
        { key: 'overdue', label: 'Deuda vencida', align: 'r', render: r => r.overdue > 0 ? badge(F.days(r.overdue), r.overdue > (P('con_block_overdue_days') ?? 15) ? 'bad' : 'warn') : '—' },
      ], filters: [{ key: 'zone', label: 'Zona', options: zonesU.map(z => [z, G.zoneName(z)]) }, { key: 'visitor', label: 'Visitador', options: [...new Set(rows.map(r => r.visitor).filter(Boolean))].map(u => [u, G.userName(u)]) }, { key: 'status', label: 'Estado', options: Object.entries(PSTATUS).map(([k, v]) => [k, v[0]]) }] }),
      card('Mapa de puntos', G.ui.map({ height: 300, points: rows.filter(r => r.p.lat).map(r => ({ lat: r.p.lat, lng: r.p.lng, label: r.name.split(' ')[0], tone: r.worst && r.worst.tone === 'bad' ? 'bad' : r.status === 'ACTIVE' ? 'ok' : 'warn', title: `${r.name} · ${F.money(r.value)} en stock`, onClick: () => pointDrawer(r.p) })) }))));
  }
  function newPointForm() {
    drawer('Nuevo punto de consignación', (bd, close) => {
      bd.appendChild(notice('RN-CON-01: el punto es un cliente de tipo CONSIGNMENT_POINT con RUC. RN-CON-02: se le crea su propio almacén CONSIGNMENT.', 'info'));
      bd.appendChild(form({ id: 'con-np', fields: [
        { key: 'customer_id', label: 'Cliente', type: 'select', required: true, options: D.where('customers', c => c.customer_type !== 'PERSON' || c.doc_type === 'RUC').filter(c => !CON.byCustomer(c.id)).map(c => [c.id, `${G.custName(c.id)} · ${c.doc_type} ${c.doc_number || ''} · ${c.customer_type}`]) },
        { key: 'supply_establishment_id', label: 'Local que abastece', type: 'select', required: true, options: G.db.all('establishments').map(e => [e.id, e.name]) },
        { key: 'visitor_user_id', label: 'Visitador', type: 'select', options: D.where('users', u => u.role === 'VISITADOR_CONSIGNACION').map(u => [u.id, u.name]) },
        { key: 'visit_frequency_days', label: 'Frecuencia de visita (días)', type: 'number', required: true, min: 1, help: 'Máximo ' + (P('con_max_visit_interval_days') ?? 7) + ' días (RN-CON-17)' },
        { key: 'visit_cost', label: 'Costo por visita (S/)', type: 'money', help: 'Vacío = ' + F.money(P('con_default_visit_cost') ?? 15) + ' (RN-CON-25)' },
      ], values: { visit_frequency_days: 7, supply_establishment_id: 'es-L1' }, submitLabel: 'Crear punto', onCancel: close, onSubmit: v => { const p = CON.savePoint(v); close(); toast('Punto creado como prospecto con su almacén ' + p.warehouse_id, 'ok'); G.go('CON-02', { id: p.id }); return true; } }));
    }, { code: 'CON-01' });
  }

  /* ---------- CON-02 Ficha del punto ---------- */
  function scr02(el, params) {
    const p = pickPoint(params); const canM = G.can('con.point.manage');
    const body = page(el, { code: 'CON-02', title: 'Ficha del punto', sub: 'Cliente, almacén propio, local que abastece, pin, visitador, frecuencia, costo de visita y estado del punto.', actions: p ? [pointSel(p.id, id => { CON._lastPoint = id; G.go('CON-02', { id }); })] : [] });
    if (!p) { body.appendChild(notice('No tienes puntos asignados (RN-CON-24).', 'warn')); return; }
    CON._lastPoint = p.id;
    const c = D.get('customers', p.customer_id) || {}; const a = p.address_id ? D.get('customer_addresses', p.address_id) : null; const ctr = CON.activeContract(p.id);
    const acts = h('div', { class: 'row' },
      p.status !== 'ACTIVE' && p.status !== 'CLOSED' ? btn('Activar', () => tryDo(() => CON.setPointStatus(p, 'ACTIVE'), 'Punto activo'), { sm: true, kind: 'primary', disabled: !canM }) : null,
      p.status === 'ACTIVE' ? btn('Suspender', () => askReason('Suspender punto', r => CON.setPointStatus(p, 'SUSPENDED', r), 'Punto suspendido'), { sm: true, disabled: !canM }) : null,
      p.status !== 'CLOSED' ? btn('Cerrar punto', () => askReason('Cerrar punto', r => CON.setPointStatus(p, 'CLOSED', r), 'Punto cerrado'), { sm: true, kind: 'danger', disabled: !canM }) : null,
      btn('Editar', () => editPoint(p), { sm: true, disabled: !canM }));
    body.appendChild(h('div', { class: 'grid c2' },
      card('Punto', h('div', { class: 'stack' }, h('div', { class: 'row' }, pBadge(p.status), ctr ? badge('Contrato ' + ctr.number, 'info') : badge('Sin contrato vigente', 'bad')), dl([
        ['Razón social', c.full_name], ['RUC', h('span', { class: 'mono' }, c.doc_number)], ['Contacto', `${a ? a.contact_name : '—'} · ${c.phone || ''}`], ['Correo', c.email],
        ['Dirección', a ? `${a.address_line} (${a.reference})` : '—'], ['Zona', G.zoneName(p.zone_id)], ['Almacén CONSIGNMENT', `${G.whName(p.warehouse_id)} (${p.warehouse_id})`], ['Local que abastece', G.siteName(p.supply_establishment_id)],
        ['Visitador', G.userName(p.visitor_user_id)], ['Frecuencia y días', `cada ${p.visit_frequency_days} días · ${(p.visit_weekdays || []).map(d => WD[d % 7]).join(', ') || '—'}`], ['Costo por visita', F.money(CON.visitCost(p)) + (p.visit_cost == null ? ' (por defecto)' : '')],
        ['Desde', F.date(p.opened_on)], p.closed_on ? ['Cerrado', `${F.date(p.closed_on)} · ${p.close_reason}`] : null, p.status === 'SUSPENDED' ? ['Motivo', p.close_reason] : null]), acts), { actions: [btn('Contrato', () => G.go('CON-03', { id: p.id }), { sm: true })] }),
      card('Pin del mapa', G.ui.map({ height: 260, points: p.lat ? [{ lat: p.lat, lng: p.lng, label: CON.pointName(p).split(' ')[0], tone: 'ok', title: CON.pointName(p) }] : [], highlightZone: p.zone_id }))));
    body.appendChild(tabs([
      { key: 'v', label: 'Visitas', render: pn => pn.appendChild(table({ id: 'con02v', search: false, rows: D.where(T.vis, v => v.point_id === p.id).sort(U.by('planned_date', -1)), columns: [{ key: 'planned_date', label: 'Fecha', render: r => F.date(r.planned_date) }, { key: 'status', label: 'Estado', render: r => status(r.status) }, { key: 'visitor_user_id', label: 'Visitador', render: r => G.userShort(r.visitor_user_id) }, { key: 'sold', label: 'Vendido (u)', align: 'r', render: r => num(U.sum(CON.visitSold(r.id), c => c.sold_qty)) }, { key: 'notes', label: 'Notas', render: r => r.miss_reason || r.notes || '—' }], onRow: r => visitDrawer(r) })) },
      { key: 'e', label: 'Entregas', render: pn => pn.appendChild(deliveriesTable(D.where(T.del, d => d.point_id === p.id), 'con02e')) },
      { key: 'q', label: 'Equipos', render: pn => pn.appendChild(table({ id: 'con02q', search: false, rows: D.where(T.eq, e => e.point_id === p.id), columns: [{ key: 'asset_code', label: 'Código', mono: true }, { key: 'equipment_type', label: 'Tipo', render: r => eqName(r.equipment_type) }, { key: 'status', label: 'Estado', render: r => status(r.status) }, { key: 'last_temp_c', label: 'Últ. temp.', align: 'r', render: r => r.last_temp_c != null ? num(r.last_temp_c, 1) + ' °C' : '—' }] })) },
      { key: 'l', label: 'Liquidaciones', render: pn => pn.appendChild(settlementsTable(D.where(T.st, s => s.point_id === p.id), 'con02l')) },
    ]));
  }
  function editPoint(p) {
    drawer('Editar punto', (bd, close) => bd.appendChild(form({ id: 'con-ep', fields: [
      { key: 'supply_establishment_id', label: 'Local que abastece', type: 'select', required: true, options: G.db.all('establishments').map(e => [e.id, e.name]) },
      { key: 'zone_id', label: 'Zona', type: 'select', options: D.where('delivery_zones', z => !z.province).map(z => [z.id, z.name]) },
      { key: 'visitor_user_id', label: 'Visitador asignado', type: 'select', options: D.where('users', u => u.role === 'VISITADOR_CONSIGNACION').map(u => [u.id, u.name]) },
      { key: 'visit_frequency_days', label: 'Frecuencia (días)', type: 'number', required: true, min: 1 },
      { key: 'visit_cost', label: 'Costo por visita (S/)', type: 'money' },
    ], values: Object.assign({}, p), onCancel: close, onSubmit: v => { CON.savePoint(Object.assign({ customer_id: p.customer_id }, v), p); close(); toast('Punto actualizado', 'ok'); G.refresh(); return true; } })), { code: 'CON-02' });
  }
  function askReason(title, fn, okMsg, extra) {
    modal(title, bd => { bd.appendChild(h('div', { class: 'field' }, h('label', { attrs: { for: 'con-reason' } }, 'Motivo *'), h('textarea', { class: 'input', attrs: { id: 'con-reason' } }))); if (extra) bd.appendChild(extra); }, [{ label: 'Cancelar' }, { label: 'Confirmar', kind: 'primary', onClick: () => { const r = document.getElementById('con-reason').value.trim(); try { fn(r); toast(okMsg, 'ok'); G.refresh(); } catch (e) { err(e); return false; } } }]);
  }

  /* ---------- CON-03 Contrato del punto ---------- */
  function scr03(el, params) {
    const p = pickPoint(params); const canA = G.can('con.contract.approve'); const canM = G.can('con.point.manage');
    const body = page(el, { code: 'CON-03', title: 'Contrato del punto', sub: 'Vigencia, margen o comisión, días de liquidación y de retiro antes del vencimiento, acta firmada, aprobación y versiones.', actions: p ? [pointSel(p.id, id => { CON._lastPoint = id; G.go('CON-03', { id }); }), btn('Nueva versión', () => contractForm(p), { kind: 'primary', disabled: !canM })] : [] });
    if (!p) return body.appendChild(notice('No hay puntos.', 'warn'));
    CON._lastPoint = p.id;
    const cs = CON.contracts(p.id); const act = CON.activeContract(p.id);
    body.appendChild(kpis([
      { label: 'Contrato vigente', value: act ? act.number : 'Ninguno', sub: act ? `del ${F.date(act.valid_from)} al ${act.valid_to ? F.date(act.valid_to) : 'indefinido'}` : 'sin contrato no se despacha (RN-CON-03)', tone: act ? 'ok' : 'bad' },
      { label: 'Compensación', value: act ? (act.compensation_type === 'COMMISSION' ? `Comisión ${num(act.commission_pct, 1)} %` : 'Margen') : '—', sub: act && CON.tiers(act.id).length ? `${CON.tiers(act.id).length} tramos por volumen (CON-15)` : 'sin escalas' },
      { label: 'Liquidación / retiro', value: act ? `${act.settlement_frequency_days} d / ${act.withdraw_days_before_expiry} d` : '—', sub: 'cada cuántos días se liquida · días antes de vencer para retirar' },
      { label: 'Productos permitidos', value: act ? CON.products(act.id).length : 0, sub: 'precio al punto y stock máximo (CON-04)', onClick: () => G.go('CON-04', { id: p.id }) },
    ]));
    if (cs.some(c => c.status === 'DRAFT')) body.appendChild(notice('Hay un contrato en borrador: adjunta el acta firmada y apruébalo (con.contract.approve).', 'warn'));
    body.appendChild(table({ id: 'con03', rows: cs, search: false, onRow: r => contractDrawer(r), columns: [
      { key: 'number', label: 'Número', mono: true }, { key: 'version', label: 'Versión', align: 'r' }, { key: 'valid_from', label: 'Desde', render: r => F.date(r.valid_from) }, { key: 'valid_to', label: 'Hasta', render: r => r.valid_to ? F.date(r.valid_to) : 'Indefinido' },
      { key: 'compensation_type', label: 'Tipo', render: r => r.compensation_type === 'COMMISSION' ? `Comisión ${num(r.commission_pct, 1)} %` : 'Margen' }, { key: 'settlement_frequency_days', label: 'Liquida c/', align: 'r', render: r => r.settlement_frequency_days + ' d' },
      { key: 'signed_file_url', label: 'Acta', render: r => r.signed_file_url ? fileName(r.signed_file_url) : badge('Falta', 'warn') }, { key: 'status', label: 'Estado', render: r => status(r.status) }, { key: 'approved_by', label: 'Aprobó', render: r => r.approved_by ? `${G.userShort(r.approved_by)} · ${F.date(r.approved_at)}` : '—' },
    ], actions: r => [r.status === 'DRAFT' ? btn('Aprobar', () => tryDo(() => CON.approveContract(r), 'Contrato aprobado y vigente'), { sm: true, kind: 'primary', disabled: !canA }) : null, r.status === 'ACTIVE' ? btn('Terminar', () => askReason('Terminar contrato', rs => { if (!rs) G.fail('RN-CON-03', 'Terminar exige motivo.'); D.update(T.ctr, r.id, { status: 'TERMINATED', terminated_reason: rs, valid_to: r.valid_to && r.valid_to < G.TODAY ? r.valid_to : G.TODAY }); }, 'Contrato terminado'), { sm: true, disabled: !canA }) : null] }));
    body.appendChild(notice('D-CON-04 (valor provisional): con comisión, la factura va por el precio al punto ya neto de comisión.', 'info'));
  }
  function contractDrawer(c) {
    drawer('Contrato ' + c.number, bd => {
      bd.appendChild(dl([['Punto', CON.pointName(c.point_id)], ['Vigencia', `${F.date(c.valid_from)} – ${c.valid_to ? F.date(c.valid_to) : 'indefinido'}`], ['Compensación', c.compensation_type === 'COMMISSION' ? `Comisión ${num(c.commission_pct, 1)} %` : 'Margen (precio sugerido > precio al punto)'], ['Liquidación cada', c.settlement_frequency_days + ' días'], ['Retiro antes de vencer', c.withdraw_days_before_expiry + ' días'], ['Acta firmada', c.signed_file_url ? fileName(c.signed_file_url) : '—'], ['Estado', status(c.status)], ['Versión', c.version || 1], ['Aprobado por', c.approved_by ? `${G.userName(c.approved_by)} · ${F.datetime(c.approved_at)}` : '—'], c.terminated_reason ? ['Motivo de término', c.terminated_reason] : null]));
      const tiers = CON.tiers(c.id); if (tiers.length) bd.appendChild(card('Escalas por volumen (' + (P('con_tier_mode') === 'WHOLE' ? 'el tramo alcanzado aplica a toda la venta del mes' : 'por tramos') + ')', table({ id: 'con03t', search: false, rows: tiers, columns: [{ key: 'from_amount', label: 'Desde', render: r => F.money(r.from_amount) }, { key: 'pct', label: '%', align: 'r', render: r => num(r.pct, 1) + ' %' }] })));
      bd.appendChild(h('div', { class: 'row' }, btn('Productos y precios', () => { G.ui.closeAll(); G.go('CON-04', { id: c.point_id, contract: c.id }); }, { sm: true }), c.status === 'DRAFT' ? btn('Editar', () => { G.ui.closeAll(); contractForm(CON.point(c.point_id), c); }, { sm: true }) : null));
    }, { code: 'CON-03' });
  }
  function contractForm(p, existing) {
    const prev = CON.activeContract(p.id);
    drawer(existing ? 'Editar contrato ' + existing.number : 'Nuevo contrato o versión', (bd, close) => {
      bd.appendChild(notice('Se registra en borrador; queda vigente al aprobarse con el acta firmada. Las vigencias activas no se traslapan (RN-CON-03).', 'info'));
      const f = form({ id: 'con-ctr', fields: [
        { key: 'valid_from', label: 'Vigente desde', type: 'date', required: true }, { key: 'valid_to', label: 'Vigente hasta', type: 'date' },
        { key: 'compensation_type', label: 'Compensación', type: 'select', required: true, options: [['COMMISSION', 'Comisión sobre lo vendido'], ['MARGIN', 'Margen (precio al punto y precio sugerido)']] },
        { key: 'commission_pct', label: 'Comisión %', type: 'number', min: 0, help: `Entre 0 y ${P('con_max_commission_pct') ?? 40} % (RN-CON-04)` },
        { key: 'settlement_frequency_days', label: 'Liquidar cada (días)', type: 'number', required: true, min: 1, max: 31 },
        { key: 'withdraw_days_before_expiry', label: 'Retirar N días antes de vencer', type: 'number', min: 0 },
        { key: 'signed_file_url', label: 'Acta firmada (PDF)', type: 'text', placeholder: 'acta-contrato.pdf', help: 'En el sistema final se sube el archivo; aquí escribe su nombre.' },
      ], values: existing ? Object.assign({}, existing) : { valid_from: prev && prev.valid_to ? G.date.add(prev.valid_to, 1) : G.date.add(G.TODAY, 1), compensation_type: prev ? prev.compensation_type : 'COMMISSION', commission_pct: prev ? prev.commission_pct : 20, settlement_frequency_days: 7, withdraw_days_before_expiry: P('con_withdraw_days_before_expiry') ?? 3 },
        onCancel: close, onSubmit: v => { const c = CON.saveContract(Object.assign({}, v, { point_id: p.id, status: existing ? existing.status : 'DRAFT', version: existing ? existing.version : (CON.contracts(p.id).length + 1), previous_id: prev ? prev.id : null }), existing); if (!existing && prev) for (const cp of CON.products(prev.id)) D.insert(T.cp, Object.assign({}, cp, { id: undefined, contract_id: c.id }), { silent: true }); close(); toast('Contrato guardado en borrador' + (prev && !existing ? ' (con los productos de la versión anterior)' : ''), 'ok'); G.refresh(); return true; } });
      bd.appendChild(f);
    }, { code: 'CON-03' });
  }

  /* ---------- CON-04 Productos permitidos y precios ---------- */
  function scr04(el, params) {
    const p = pickPoint(params); const canM = G.can('con.point.manage');
    const body = page(el, { code: 'CON-04', title: 'Productos permitidos y precios', sub: 'Por contrato: presentación, precio al punto, precio sugerido al público, stock mínimo y máximo; margen del punto en soles y %.', actions: p ? [pointSel(p.id, id => { CON._lastPoint = id; G.go('CON-04', { id }); })] : [] });
    if (!p) return;
    CON._lastPoint = p.id;
    const cs = CON.contracts(p.id); const c = (params.contract && cs.find(x => x.id === params.contract)) || CON.activeContract(p.id) || cs[0];
    if (!c) return body.appendChild(notice('El punto no tiene contratos. Regístralo en CON-03.', 'warn'));
    body.appendChild(h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Contrato:'), pills(cs.map(x => [x.id, `${x.number} · ${G.ui.statusLabel(x.status)}`]), c.id, v => G.go('CON-04', { id: p.id, contract: v })), btn('Agregar producto', () => productForm(c), { kind: 'primary', sm: true, disabled: !canM || c.status === 'TERMINATED' })));
    const rows = CON.products(c.id).map(cp => { const v = G.variant(cp.variant_id); const comm = c.compensation_type === 'COMMISSION' ? cp.consignor_price * (c.commission_pct || 0) / 100 : (cp.suggested_retail_price || cp.consignor_price) - cp.consignor_price; const base = c.compensation_type === 'COMMISSION' ? cp.consignor_price : (cp.suggested_retail_price || cp.consignor_price); return Object.assign({}, cp, { v, marginS: R(comm), marginP: base ? R(comm / base * 100, 1) : 0, stock: G.inv.qty(cp.variant_id, p.warehouse_id), ourMargin: R((c.compensation_type === 'COMMISSION' ? cp.consignor_price - comm : cp.consignor_price) / (1 + G.tax.rate()) - v.std_cost) }); });
    body.appendChild(table({ id: 'con04', rows, onRow: r => productForm(c, r), columns: [
      { key: 'variant_id', label: 'Presentación', render: r => `${r.v.name}`, value: r => r.v.name }, { key: 'brand', label: 'Marca', render: r => G.brandName(r.v.brand_id) },
      { key: 'consignor_price', label: 'Precio al punto', align: 'r', render: r => F.money(r.consignor_price) }, { key: 'suggested_retail_price', label: 'Sugerido público', align: 'r', render: r => F.money(r.suggested_retail_price) },
      { key: 'marginS', label: 'Margen punto S/', align: 'r', render: r => F.money(r.marginS) }, { key: 'marginP', label: 'Margen punto %', align: 'r', render: r => num(r.marginP, 1) + ' %' },
      { key: 'ourMargin', label: 'Nuestro margen (sin IGV)', align: 'r', render: r => badge(F.money(r.ourMargin), r.ourMargin > 0 ? 'ok' : 'bad') },
      { key: 'min_qty', label: 'Mín.', align: 'r' }, { key: 'max_qty', label: 'Máx.', align: 'r', render: r => r.max_qty ?? '—' }, { key: 'stock', label: 'En el punto', align: 'r', render: r => badge(num(r.stock), r.max_qty && r.stock > r.max_qty ? 'bad' : r.stock < r.min_qty ? 'warn' : '') },
      { key: 'active', label: 'Activo', render: r => r.active !== false ? badge('Sí', 'ok') : badge('No', '') },
    ] }));
    body.appendChild(notice(c.compensation_type === 'COMMISSION' ? `Contrato de comisión ${num(c.commission_pct, 1)} %: el punto se queda con la comisión sobre el precio al punto. D-CON-01: los congelados exigen equipo prestado con temperatura en cada visita.` : 'Contrato de margen: el punto gana la diferencia entre el precio sugerido y el precio al punto (RN-CON-04: sugerido > precio al punto).', 'info'));
  }
  function productForm(c, existing) {
    const canM = G.can('con.point.manage');
    drawer(existing ? G.variantName(existing.variant_id) : 'Agregar producto al contrato ' + c.number, (bd, close) => bd.appendChild(form({ id: 'con-cp', fields: [
      { key: 'variant_id', label: 'Presentación', type: 'select', required: true, disabled: !!existing, options: D.where('product_variants', v => v.sellable && v.status === 'ACTIVE').map(v => [v.id, `${v.name} · ${G.brandName(v.brand_id)}`]), onChange: (v, vals, api) => { const pr = G.price.of(v, { channel: 'CONSIGNMENT' }); if (pr) { api.set('consignor_price', c.compensation_type === 'COMMISSION' ? R(pr.price / 0.9, 2) : pr.price); api.set('suggested_retail_price', R(pr.price / 0.9, 2)); } } },
      { key: 'consignor_price', label: 'Precio al punto (con IGV)', type: 'money', required: true }, { key: 'suggested_retail_price', label: 'Precio sugerido al público', type: 'money' },
      { key: 'min_qty', label: 'Stock mínimo', type: 'number', min: 0 }, { key: 'max_qty', label: 'Stock máximo', type: 'number', min: 1 }, { key: 'active', label: 'Activo', type: 'checkbox' },
    ], values: existing ? Object.assign({}, existing) : { active: true, min_qty: 2, max_qty: 12 }, submitLabel: canM ? 'Guardar' : false, onCancel: close, onSubmit: v => { CON.saveProduct(Object.assign({ contract_id: c.id }, v), existing); close(); toast('Producto guardado', 'ok'); G.refresh(); return true; } })), { code: 'CON-04' });
  }

  /* ---------- CON-05 Equipos prestados ---------- */
  function scr05(el) {
    const canE = G.can('con.equipment.manage');
    const body = page(el, { code: 'CON-05', title: 'Equipos prestados', sub: 'Congeladoras y exhibidoras en comodato con su acta, última revisión con foto y temperatura, devolución o baja.', actions: [{ label: 'Prestar equipo', kind: 'primary', icon: '+', disabled: !canE, onClick: () => loanForm() }] });
    const vis = new Set(CON.visiblePoints().map(p => p.id));
    const rows = D.where(T.eq, e => vis.has(e.point_id)).map(e => Object.assign({}, e, { since: e.last_check_on ? G.date.diff(G.TODAY, e.last_check_on) : null }));
    const loaned = rows.filter(r => r.status === 'LOANED');
    body.appendChild(kpis([{ label: 'Equipos prestados', value: loaned.length, sub: F.money(U.sum(loaned, r => r.asset_value)) + ' en activos' }, { label: 'Sin revisión en 10 días', value: loaned.filter(r => r.since == null || r.since > 10).length, tone: loaned.some(r => r.since == null || r.since > 10) ? 'warn' : 'ok' }, { label: 'Temperatura fuera de rango', value: loaned.filter(r => r.equipment_type === 'FREEZER' && r.last_temp_c > -15).length, sub: 'congeladoras por encima de −15 °C', tone: loaned.some(r => r.equipment_type === 'FREEZER' && r.last_temp_c > -15) ? 'bad' : 'ok' }, { label: 'Devueltos o de baja', value: rows.length - loaned.length }]));
    body.appendChild(table({ id: 'con05', rows, columns: [
      { key: 'asset_code', label: 'Código', mono: true }, { key: 'equipment_type', label: 'Tipo', render: r => eqName(r.equipment_type) }, { key: 'point_id', label: 'Punto', render: r => CON.pointName(r.point_id) }, { key: 'serial_number', label: 'Serie', mono: true },
      { key: 'asset_value', label: 'Valor', align: 'r', render: r => F.money(r.asset_value) }, { key: 'loan_agreement_url', label: 'Acta de comodato', render: r => fileName(r.loan_agreement_url) }, { key: 'delivered_on', label: 'Entregado', render: r => F.date(r.delivered_on) },
      { key: 'last_check_on', label: 'Última revisión', render: r => r.last_check_on ? `${F.date(r.last_check_on)}${r.last_temp_c != null ? ' · ' + num(r.last_temp_c, 1) + ' °C' : ''}` : '—' }, { key: 'status', label: 'Estado', render: r => status(r.status) },
    ], filters: [{ key: 'status', label: 'Estado', options: [['LOANED', 'Prestado'], ['RETURNED', 'Devuelto'], ['WRITTEN_OFF', 'De baja'], ['DAMAGED', 'Dañado'], ['LOST', 'Perdido']] }],
    onRow: r => drawer(r.asset_code, bd => { bd.appendChild(dl([['Tipo', eqName(r.equipment_type)], ['Punto', CON.pointName(r.point_id)], ['Descripción', r.description], ['Serie', r.serial_number], ['Valor', F.money(r.asset_value)], ['Acta', fileName(r.loan_agreement_url)], ['Entregado', F.date(r.delivered_on)], ['Devuelto', F.date(r.returned_on)], ['Estado', status(r.status)], ['Motivo', r.status_reason]])); const ph = D.where(T.ph, x => x.equipment_loan_id === r.id).sort(U.by('taken_at', -1)); bd.appendChild(h('h3', null, 'Revisiones con foto')); bd.appendChild(ph.length ? h('div', { class: 'timeline' }, ph.slice(0, 8).map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.date(x.taken_at)), h('span', { class: 'dot' }), h('div', null, `${num(x.temp_c, 1)} °C · `, h('span', { class: 'mono small' }, fileName(x.photo_url)))))) : G.ui.empty('Sin revisiones.')); }, { code: 'CON-05' }),
    actions: r => r.status === 'LOANED' ? [btn('Devolver', () => tryDo(() => CON.endLoan(r, 'RETURNED'), 'Equipo devuelto'), { sm: true, disabled: !canE }), btn('Baja', () => askReason('Dar de baja ' + r.asset_code, rs => CON.endLoan(r, 'WRITTEN_OFF', rs), 'Equipo dado de baja'), { sm: true, kind: 'danger', disabled: !canE })] : [] }));
  }
  function loanForm() {
    drawer('Prestar equipo en comodato', (bd, close) => bd.appendChild(form({ id: 'con-eq', fields: [
      { key: 'point_id', label: 'Punto', type: 'select', required: true, options: pointOpts(p => p.status !== 'CLOSED') }, { key: 'equipment_type', label: 'Tipo', type: 'select', required: true, options: EQT },
      { key: 'asset_code', label: 'Código del activo', required: true }, { key: 'serial_number', label: 'Serie' }, { key: 'description', label: 'Descripción' }, { key: 'asset_value', label: 'Valor (S/)', type: 'money' },
      { key: 'delivered_on', label: 'Fecha de entrega', type: 'date', required: true }, { key: 'loan_agreement_url', label: 'Acta de comodato (PDF)', help: 'Obligatoria (RN-CON-23)' },
    ], values: { delivered_on: G.TODAY, equipment_type: 'FREEZER', asset_code: 'EQ-CSG-' + U.pad(D.all(T.eq).length + 1, 3) }, onCancel: close, onSubmit: v => { CON.loanEquipment(v); close(); toast('Equipo prestado con acta de comodato', 'ok'); G.refresh(); return true; } })), { code: 'CON-05' });
  }

  /* ---------- CON-06 Nueva entrega ---------- */
  function deliveriesTable(rows, id) {
    return table({ id, rows: rows.sort(U.by('delivery_date', -1)), onRow: r => deliveryDrawer(r), columns: [
      { key: 'number', label: 'Entrega', mono: true }, { key: 'delivery_date', label: 'Fecha', render: r => F.date(r.delivery_date) }, { key: 'point_id', label: 'Punto', render: r => CON.pointName(r.point_id) },
      { key: 'gre', label: 'GRE', mono: true, render: r => r.gre_series ? `${r.gre_series}-${U.pad(r.gre_number, 8)}` : badge('Sin guía', 'warn'), value: r => r.gre_series ? r.gre_series + r.gre_number : '' },
      { key: 'units', label: 'Unidades', align: 'r', render: r => num(U.sum(CON.lines(r.id), l => l.qty)) }, { key: 'amount', label: 'Valor', align: 'r', render: r => F.money(U.sum(CON.lines(r.id), l => l.qty * l.unit_price)) }, { key: 'status', label: 'Estado', render: r => status(r.status) },
    ], filters: [{ key: 'status', label: 'Estado', options: [['DRAFT', 'Borrador'], ['DISPATCHED', 'Despachada'], ['VOIDED', 'Anulada']] }] });
  }
  function deliveryDrawer(d) {
    drawer('Entrega ' + d.number, (bd, close) => {
      const canD = G.can('con.delivery.dispatch');
      bd.appendChild(h('div', { class: 'row' }, status(d.status),
        d.status === 'DRAFT' && !d.gre_series ? btn('Solicitar GRE a FAC', () => { if (tryDo(() => CON.requestGuide(d), 'GRE emitida con motivo ' + (P('con_gre_transfer_reason_code') ?? '05'))) { close(); deliveryDrawer(D.get(T.del, d.id)); } }, { sm: true, kind: 'accent', disabled: !canD }) : null,
        d.status === 'DRAFT' ? btn('Despachar', () => { if (tryDo(() => CON.dispatch(d), 'Entrega despachada: stock en el punto y asiento en el Registro')) close(); }, { sm: true, kind: 'primary', disabled: !canD }) : null,
        d.status === 'DRAFT' ? btn('Anular', () => askReason('Anular entrega', r => CON.voidDelivery(d, r), 'Entrega anulada'), { sm: true, kind: 'danger' }) : null));
      bd.appendChild(dl([['Punto', CON.pointName(d.point_id)], ['Contrato', (D.get(T.ctr, d.contract_id) || {}).number], ['Fecha', F.date(d.delivery_date)], ['Almacén de origen', G.whName(d.from_warehouse_id)], ['Guía de remisión', d.gre_series ? `${d.gre_series}-${U.pad(d.gre_number, 8)} · motivo ${d.gre_transfer_reason} (consignación)` : 'Pendiente (RN-CON-07)'], ['Despachada', F.datetime(d.dispatched_at)], d.override_max_reason ? ['Sobre el máximo', d.override_max_reason] : null, d.void_reason ? ['Motivo de anulación', d.void_reason] : null, d.visit_id ? ['Visita', F.date((D.get(T.vis, d.visit_id) || {}).planned_date)] : null]));
      bd.appendChild(table({ id: 'con-dd', search: false, rows: CON.lines(d.id), columns: [{ key: 'variant_id', label: 'Producto', render: r => G.variantName(r.variant_id) }, { key: 'lot_id', label: 'Lote', mono: true, render: r => (D.get('lots', r.lot_id) || {}).code }, { key: 'expiry_date', label: 'Vence', render: r => F.date(r.expiry_date) }, { key: 'qty', label: 'Cant.', align: 'r', render: r => num(r.qty) }, { key: 'unit_price', label: 'Precio al punto', align: 'r', render: r => F.money(r.unit_price) }, { key: 'warehouse_id', label: 'Desde', render: r => G.whName(r.warehouse_id || d.from_warehouse_id) }] }));
      if (d.dispatch_guide_id) { const g = D.get('dispatch_guides', d.dispatch_guide_id); if (g) bd.appendChild(card('Guía de remisión remitente', dl([['Serie y número', `${g.series}-${U.pad(g.number, 8)}`], ['Motivo de traslado (cat. 20)', `${g.transfer_reason_code} · consignación`], ['Modalidad', g.transport_mode === '02' ? 'Transporte privado' : 'Público'], ['Partida', g.origin_address], ['Llegada', g.dest_address], ['Destinatario', G.custName(g.recipient_customer_id)], ['Peso bruto', F.kg(g.gross_weight_kg, 3)], ['Bultos', g.packages], ['SUNAT', status(g.sunat_status)]]))); }
    }, { code: 'CON-06', wide: true });
  }
  const delState = { point: null, qty: {}, lot: {}, reason: '' };
  function scr06(el, params) {
    const body = page(el, { code: 'CON-06', title: 'Nueva entrega', sub: 'Arma la entrega con lotes FEFO desde el almacén de origen; valida productos permitidos, vida útil mínima y stock máximo; solicita la GRE y despacha.' });
    const pts = CON.visiblePoints().filter(p => p.status === 'ACTIVE');
    if (params.point && params.point !== delState.point) { delState.point = params.point; delState.qty = {}; delState.lot = {}; }
    if (!delState.point || !pts.find(p => p.id === delState.point)) delState.point = pts[0] && pts[0].id;
    const p = CON.point(delState.point);
    const drafts = D.where(T.del, d => d.status === 'DRAFT');
    body.appendChild(kpis([{ label: 'Borradores', value: drafts.length, sub: `${drafts.filter(d => !d.gre_series).length} sin GRE`, tone: drafts.length ? 'warn' : 'ok' }, { label: 'Despachadas este mes', value: D.where(T.del, d => d.status === 'DISPATCHED' && d.delivery_date >= G.date.month(G.TODAY)).length }, { label: 'Vida útil mínima', value: (P('con_min_shelf_days_on_delivery') ?? 10) + ' días', sub: 'RN-CON-06' }, { label: 'Motivo GRE', value: P('con_gre_transfer_reason_code') ?? '05', sub: 'D-CON-03: a confirmar por la contadora' }]));
    if (p) {
      const c = CON.activeContract(p.id); const od = CON.overdueDays(p.customer_id); const lim = P('con_block_overdue_days') ?? 15;
      const box = h('div', { class: 'stack' });
      box.appendChild(h('div', { class: 'row' }, h('label', { attrs: { for: 'con-point-sel' } }, 'Punto'), pointSel(p.id, id => { delState.point = id; delState.qty = {}; delState.lot = {}; G.refresh(); }, x => x.status === 'ACTIVE'), c ? badge(`Contrato ${c.number}`, 'info') : badge('Sin contrato vigente (RN-CON-03)', 'bad'), od > lim ? badge(`Deuda vencida ${od} días: bloqueado (RN-CON-22)`, 'bad') : null));
      if (c) {
        const rows = CON.products(c.id).filter(x => x.active !== false).map(cp => { const wh = CON.originWh(cp.variant_id, p.supply_establishment_id); const min = P('con_min_shelf_days_on_delivery') ?? 10; const lots = G.inv.fefo(cp.variant_id, wh, { anyQuality: true }).filter(x => x.lot); return { cp, wh, lots, okLots: lots.filter(x => x.lot.qc_status === 'RELEASED' && G.date.diff(x.lot.expiry_date, G.TODAY) >= min), atPoint: G.inv.qty(cp.variant_id, p.warehouse_id) }; });
        const tb = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Producto', 'En el punto', 'Máx.', 'Origen', 'Lote (FEFO)', 'Cantidad'].map((x, i) => h('th', { class: [1, 2, 5].includes(i) ? 'r' : '' }, x)))));
        const tbody = h('tbody');
        for (const r of rows) {
          const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Lote ' + G.variantName(r.cp.variant_id) } }, h('option', { value: '' }, r.okLots.length ? `Automático FEFO (${r.okLots[0].lot.code})` : 'Sin lote apto'), r.lots.map(x => h('option', { value: x.lot.id, selected: delState.lot[r.cp.variant_id] === x.lot.id }, `${x.lot.code} · vence ${F.date(x.lot.expiry_date)} · ${num(x.b.qty - (x.b.reserved_qty || 0))} disp.${x.lot.qc_status !== 'RELEASED' ? ' · ' + G.ui.statusLabel(x.lot.qc_status) : ''}`)));
          sel.addEventListener('change', () => { delState.lot[r.cp.variant_id] = sel.value; });
          const sugg = Math.max(0, (r.cp.max_qty || 0) - r.atPoint);
          const inp = h('input', { class: 'input', type: 'number', min: 0, step: 1, value: delState.qty[r.cp.variant_id] ?? '', placeholder: String(sugg), style: 'width:80px;text-align:right', attrs: { 'aria-label': 'Cantidad ' + G.variantName(r.cp.variant_id) } });
          inp.addEventListener('input', () => { delState.qty[r.cp.variant_id] = inp.value; });
          tbody.appendChild(h('tr', null, h('td', null, G.variantName(r.cp.variant_id)), h('td', { class: 'r' }, num(r.atPoint)), h('td', { class: 'r' }, r.cp.max_qty ?? '—'), h('td', { class: 'small' }, G.whName(r.wh)), h('td', null, sel), h('td', { class: 'r' }, inp)));
        }
        tb.appendChild(tbody);
        box.appendChild(h('div', { class: 'tbl-wrap' }, tb));
        const reason = h('input', { class: 'input', placeholder: 'Solo si superas el máximo (con.delivery.override_max)', value: delState.reason, attrs: { id: 'con-ovr', 'aria-label': 'Motivo para superar el máximo' } }); reason.addEventListener('input', () => { delState.reason = reason.value; });
        box.appendChild(h('div', { class: 'grid c2' }, h('div', { class: 'field' }, h('label', { attrs: { for: 'con-ovr' } }, 'Motivo para superar el stock máximo'), reason), h('div', { class: 'row', style: 'align-items:end;justify-content:flex-end' },
          btn('Completar hasta el máximo', () => { for (const r of rows) delState.qty[r.cp.variant_id] = Math.max(0, (r.cp.max_qty || 0) - r.atPoint) || ''; G.refresh(); }, { sm: true }),
          btn('Crear entrega', () => { const d = tryDo(() => CON.createDelivery({ point_id: p.id, lines: rows.map(r => ({ variant_id: r.cp.variant_id, qty: Number(delState.qty[r.cp.variant_id]) || 0, lot_id: delState.lot[r.cp.variant_id] || null, warehouse_id: r.wh })), overrideReason: delState.reason || null }), 'Entrega creada en borrador: solicita la GRE y despacha'); if (d) { delState.qty = {}; delState.lot = {}; delState.reason = ''; deliveryDrawer(d); } }, { kind: 'primary', disabled: !G.canDo('CON', 'C') }))));
      }
      body.appendChild(card('Armar entrega', box));
    }
    body.appendChild(card('Entregas', deliveriesTable(D.where(T.del, d => CON.visiblePoints().some(p => p.id === d.point_id)), 'con06'), { flush: true }));
  }

  /* ---------- CON-07 Registro de consignaciones ---------- */
  function scr07(el) {
    const canX = G.can('con.register.export');
    const vis = new Set(CON.visiblePoints().map(p => p.id));
    const rows = D.where(T.reg, e => vis.has(e.point_id)).sort((a, b) => b.entry_date.localeCompare(a.entry_date) || String(b.created_at).localeCompare(String(a.created_at)));
    const exportCsv = () => { const head = ['Fecha', 'Punto', 'RUC', 'Tipo', 'Producto', 'Lote', 'Cantidad', 'Precio', 'Importe', 'GRE', 'Origen', 'Motivo']; const lines = [head.join(';')].concat(rows.map(e => [e.entry_date, CON.pointName(e.point_id), (D.get('customers', (CON.point(e.point_id) || {}).customer_id) || {}).doc_number, (ETYPE[e.entry_type] || [e.entry_type])[0], G.variantName(e.variant_id), (D.get('lots', e.lot_id) || {}).code || '', e.qty, e.unit_price ?? '', e.amount ?? '', e.gre_series ? `${e.gre_series}-${e.gre_number}` : '', e.source_type, e.reason || ''].map(x => `"${String(x).replace(/"/g, '""')}"`).join(';'))); try { const a = h('a', { attrs: { href: URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' })), download: `registro-consignaciones-${G.TODAY}.csv` } }); document.body.appendChild(a); a.click(); a.remove(); } catch (e) { } G.audit('EXPORTAR', T.reg, 'CON-07', `${rows.length} asientos`); toast(`Registro exportado: ${rows.length} asientos (Excel/CSV)`, 'ok'); };
    const body = page(el, { code: 'CON-07', title: 'Registro de consignaciones', sub: 'Libro por punto y fecha (solo inserción): entregas con su GRE, ventas informadas, devoluciones, retiros por vencer, sobrantes y reversos. Control para SUNAT.', actions: [btn('Exportar Excel', exportCsv, { disabled: !canX, title: canX ? '' : 'Requiere con.register.export' }), btn('PDF para SUNAT', () => G.require('con.register.export', () => G.print()), { disabled: !canX })] });
    const m = G.date.month(G.TODAY);
    const sum = t => U.sum(rows.filter(e => e.entry_type === t && e.entry_date >= m), e => Math.abs(e.qty));
    body.appendChild(kpis([{ label: 'Entregado en el mes (u)', value: num(sum('DELIVERY')) }, { label: 'Ventas informadas (u)', value: num(sum('SALE')), tone: 'ok' }, { label: 'Devuelto + retirado (u)', value: num(sum('RETURN') + sum('WITHDRAWAL')), tone: 'warn' }, { label: 'Reversos', value: rows.filter(e => e.entry_type === 'REVERSAL').length, sub: 'RN-CON-09: errores se corrigen con reverso' }]));
    body.appendChild(table({ id: 'con07', rows, pageSize: 30, columns: [
      { key: 'entry_date', label: 'Fecha', render: r => F.date(r.entry_date) }, { key: 'point_id', label: 'Punto', render: r => CON.pointName(r.point_id) }, { key: 'entry_type', label: 'Tipo', render: r => eBadge(r.entry_type) },
      { key: 'variant_id', label: 'Producto', render: r => G.variantName(r.variant_id) }, { key: 'lot', label: 'Lote', mono: true, render: r => (D.get('lots', r.lot_id) || {}).code || '—' },
      { key: 'qty', label: 'Cantidad', align: 'r', render: r => h('span', { style: 'color:' + (r.qty < 0 ? 'var(--bad)' : 'var(--ok)') }, (r.qty > 0 ? '+' : '') + num(r.qty)) }, { key: 'amount', label: 'Importe', align: 'r', render: r => F.money(r.amount) },
      { key: 'gre', label: 'GRE', mono: true, render: r => r.gre_series ? `${r.gre_series}-${U.pad(r.gre_number, 8)}` : '—', value: r => r.gre_series ? `${r.gre_series}-${r.gre_number}` : '' }, { key: 'reason', label: 'Motivo', render: r => r.reason || (r.reversal_of ? 'Reverso' : '—') },
    ], filters: [{ key: 'point_id', label: 'Punto', options: pointOpts() }, { key: 'entry_type', label: 'Tipo', options: Object.entries(ETYPE).map(([k, v]) => [k, v[0]]) }, { key: 'month', label: 'Mes', options: [['2026-10-01', 'Octubre 2026'], ['2026-09-01', 'Setiembre 2026']], value: r => G.date.month(r.entry_date) }],
    actions: r => r.entry_type !== 'REVERSAL' && !D.find(T.reg, x => x.reversal_of === r.id) ? [btn('Reverso', () => askReason('Asiento de reverso', rs => CON.reverseEntry(r.id, rs), 'Reverso registrado (el asiento original no se modifica)'), { sm: true, disabled: !G.canDo('CON', 'E') })] : [] }));
  }

  /* ---------- CON-08 Plan de visitas ---------- */
  function scr08(el, params) {
    const wk = params.week || (() => { const d = G.TODAY; const w = dow(d); return G.date.add(d, -(w === 0 ? 6 : w - 1)); })();
    const body = page(el, { code: 'CON-08', title: 'Plan de visitas', sub: 'Agenda semanal por visitador desde la frecuencia de cada punto; reprogramación con motivo y visitas no cumplidas.', actions: [btn('‹ Semana', () => G.go('CON-08', { week: G.date.add(wk, -7) }), { sm: true }), btn('Semana ›', () => G.go('CON-08', { week: G.date.add(wk, 7) }), { sm: true }), btn('Generar plan de la semana', () => { const n = CON.planVisits(wk, 7); toast(n ? `${n} visita(s) planificadas desde la frecuencia` : 'El plan de la semana ya estaba completo', 'ok'); G.refresh(); }, { kind: 'primary', disabled: !G.canDo('CON', 'C') })] });
    const vis = new Set(CON.visiblePoints().map(p => p.id));
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => G.date.add(wk, i));
    const vs = D.where(T.vis, v => vis.has(v.point_id) && v.planned_date >= days[0] && v.planned_date <= days[6]);
    const past = D.where(T.vis, v => vis.has(v.point_id) && v.planned_date >= G.date.month(G.TODAY) && v.planned_date <= G.TODAY);
    const done = past.filter(v => v.status === 'DONE').length, plan = past.filter(v => v.status !== 'CANCELLED' && (v.status !== 'PLANNED' || v.planned_date < G.TODAY)).length;
    const late = D.where(T.vis, v => vis.has(v.point_id) && v.status === 'PLANNED' && v.planned_date < G.TODAY);
    body.appendChild(kpis([{ label: 'Semana', value: `${F.date(days[0]).slice(0, 5)} – ${F.date(days[6]).slice(0, 5)}`, sub: `${vs.length} visitas` }, { label: 'Visitas cumplidas del mes', value: F.pct(plan ? done / plan * 100 : 0, 0), sub: `${done} de ${plan} (KPI-CON-06)`, tone: plan && done / plan < 0.9 ? 'warn' : 'ok' }, { label: 'Atrasadas sin registrar', value: late.length, tone: late.length ? 'bad' : 'ok' }, { label: 'No cumplidas del mes', value: past.filter(v => v.status === 'MISSED').length }]));
    const grid = h('div', { class: 'kanban' }, days.map(d => h('div', { class: 'kan-col' }, h('div', { class: 'row between' }, h('b', null, dayLabel(d)), d === G.TODAY ? badge('Hoy', 'primary') : CON.isBusinessDay(d) ? null : badge('No hábil', '')),
      vs.filter(v => v.planned_date === d).map(v => h('div', { class: 'kan-card', style: 'cursor:pointer', on: { click: () => visitDrawer(v) } }, h('b', null, CON.pointName(v.point_id)), h('div', { class: 'row' }, status(v.status), v.urgent ? badge('Urgente', 'bad') : null), h('span', { class: 'small muted' }, G.userShort(v.visitor_user_id)))))));
    body.appendChild(card('Agenda por día', grid));
    body.appendChild(card('Visitas del mes', table({ id: 'con08', rows: D.where(T.vis, v => vis.has(v.point_id) && v.planned_date >= G.date.month(G.TODAY)).sort(U.by('planned_date')), onRow: r => visitDrawer(r), columns: [{ key: 'planned_date', label: 'Fecha', render: r => dayLabel(r.planned_date) }, { key: 'point_id', label: 'Punto', render: r => CON.pointName(r.point_id) }, { key: 'visitor_user_id', label: 'Visitador', render: r => G.userShort(r.visitor_user_id) }, { key: 'status', label: 'Estado', render: r => r.status === 'PLANNED' && r.planned_date < G.TODAY ? badge('Atrasada', 'bad') : status(r.status) }, { key: 'notes', label: 'Notas', render: r => r.miss_reason || r.notes || '—' }], filters: [{ key: 'status', label: 'Estado', options: Object.keys(VSTAT).map(s => [s, G.ui.statusLabel(s)]) }, { key: 'visitor_user_id', label: 'Visitador', options: D.where('users', u => u.role === 'VISITADOR_CONSIGNACION').map(u => [u.id, u.name]) }] }), { flush: true }));
  }
  function visitDrawer(v) {
    drawer(`Visita · ${CON.pointName(v.point_id)}`, (bd, close) => {
      bd.appendChild(h('div', { class: 'row' }, status(v.status), v.urgent ? badge('Urgente', 'bad') : null,
        v.status === 'PLANNED' ? btn('Abrir en la app', () => { G.ui.closeAll(); CON._appVisit = v.id; G.go('CON-09', { visit: v.id }); }, { sm: true, kind: 'primary' }) : null,
        v.status === 'PLANNED' ? btn('Reprogramar', () => { const inp = h('input', { class: 'input', type: 'date', value: G.date.add(v.planned_date, 1), attrs: { id: 'con-resch' } }); askReason('Reprogramar visita', r => CON.reschedule(v, document.getElementById('con-resch').value, r), 'Visita reprogramada', h('div', { class: 'field' }, h('label', { attrs: { for: 'con-resch' } }, 'Nueva fecha'), inp)); }, { sm: true }) : null,
        v.status === 'PLANNED' ? btn('No cumplida', () => askReason('Visita no cumplida', r => CON.markMissed(v, r), 'Visita marcada como no cumplida'), { sm: true, kind: 'danger' }) : null));
      bd.appendChild(dl([['Fecha', F.date(v.planned_date)], ['Visitador', G.userName(v.visitor_user_id)], ['Llegada', v.started_at ? `${F.datetime(v.started_at)} · a ${num(v.checkin_distance_m)} m del pin` : '—'], v.out_of_range_reason ? ['Motivo fuera de rango', v.out_of_range_reason] : null, ['Cierre', F.datetime(v.finished_at)], ['Fecha de venta', F.date(v.sale_date)], ['Costo de la visita', v.visit_cost != null ? F.money(v.visit_cost) : '—'], ['Notas', v.miss_reason || v.notes]]));
      const cs = CON.visitSold(v.id);
      if (cs.length) bd.appendChild(table({ id: 'con-vd', search: false, rows: cs, columns: [{ key: 'variant_id', label: 'Producto', render: r => G.variantName(r.variant_id) }, { key: 'lot', label: 'Lote', mono: true, render: r => (D.get('lots', r.lot_id) || {}).code }, { key: 'opening_qty', label: 'Ant.', align: 'r' }, { key: 'delivered_qty', label: 'Entr.', align: 'r' }, { key: 'counted_qty', label: 'Contado', align: 'r' }, { key: 'expired_qty', label: 'Retir.', align: 'r' }, { key: 'returned_qty', label: 'Dev.', align: 'r' }, { key: 'surplus_qty', label: 'Sobr.', align: 'r' }, { key: 'sold_qty', label: 'Vendido', align: 'r', render: r => h('b', null, num(r.sold_qty)) }, { key: 'settled', label: 'Liquidado', render: r => r.settled ? badge('Sí', 'ok') : badge('No', 'warn') }] }));
      const ph = D.where(T.ph, x => x.visit_id === v.id); if (ph.length) bd.appendChild(h('div', { class: 'small muted' }, `Fotos: ${ph.map(x => fileName(x.photo_url) + (x.temp_c != null ? ` (${num(x.temp_c, 1)} °C)` : '')).join(', ')}`));
    }, { code: 'CON-08', wide: true });
  }

  /* ---------- App de visitas (CON-09 … CON-12) ---------- */
  function appVisit(params) {
    if (params.visit) CON._appVisit = params.visit;
    const vis = new Set(CON.visiblePoints().map(p => p.id));
    const cur = CON._appVisit && D.get(T.vis, CON._appVisit);
    if (cur && vis.has(cur.point_id)) return cur;
    const mine = D.where(T.vis, v => vis.has(v.point_id) && ['IN_PROGRESS', 'PLANNED'].includes(v.status) && v.planned_date <= G.date.add(G.TODAY, 2)).sort((a, b) => (a.status === 'IN_PROGRESS' ? -1 : 0) - (b.status === 'IN_PROGRESS' ? -1 : 0) || a.planned_date.localeCompare(b.planned_date) || (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
    const v = mine.find(x => x.planned_date === G.TODAY) || mine[0];
    if (v) CON._appVisit = v.id;
    return v || null;
  }
  const STEPS = [['CON-09', 'Conteo'], ['CON-10', 'Retiros'], ['CON-11', 'Fotos'], ['CON-12', 'Reponer']];
  function phone(code, v, inner) {
    const head = h('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:8px 14px;background:var(--primary);color:var(--surface);font-size:.8rem' }, h('b', null, 'Aycha · Visitas'), h('span', { class: 'mono' }, G.date.now().slice(11, 16)));
    const nav = h('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--line);background:var(--surface)' }, STEPS.map(([c, l], i) => h('button', { type: 'button', style: `padding:8px 2px;border:0;background:${c === code ? 'var(--primary-soft, var(--surface-2))' : 'transparent'};font-weight:${c === code ? 700 : 500};color:var(--ink);cursor:pointer;font-size:.8rem`, on: { click: () => G.go(c, { visit: v && v.id }) } }, `${i + 1}. ${l}`)));
    const bd = h('div', { style: 'padding:12px;display:grid;gap:10px;align-content:start' });
    if (v) bd.appendChild(h('div', { class: 'row between' }, h('div', null, h('b', null, CON.pointName(v.point_id)), h('div', { class: 'small muted' }, `${dayLabel(v.planned_date)} · ${G.userShort(v.visitor_user_id)}`)), status(v.status)));
    const r = inner(bd); if (r instanceof Node) bd.appendChild(r);
    return h('div', { class: 'phone' }, h('div', { class: 'phone-screen' }, head, v ? nav : null, bd));
  }
  function visitPicker(v, code) {
    const vis = new Set(CON.visiblePoints().map(p => p.id));
    const list = D.where(T.vis, x => vis.has(x.point_id) && ['IN_PROGRESS', 'PLANNED'].includes(x.status)).sort(U.by('planned_date')).slice(0, 12);
    const s = h('select', { class: 'input', attrs: { 'aria-label': 'Visita', id: 'con-app-visit' } }, list.map(x => h('option', { value: x.id, selected: v && x.id === v.id }, `${dayLabel(x.planned_date)} · ${CON.pointName(x.point_id)}${x.urgent ? ' · urgente' : ''} · ${G.ui.statusLabel(x.status)}`)));
    s.addEventListener('change', () => { CON._appVisit = s.value; G.go(code, { visit: s.value }); });
    return h('div', { class: 'field' }, h('label', { attrs: { for: 'con-app-visit' } }, 'Visita en el teléfono'), s);
  }
  function appSide(v, extra) {
    const side = h('div', { class: 'stack', style: 'gap:16px;min-width:0' });
    side.appendChild(card('Servidor (simulado)', h('div', { class: 'stack' }, visitPicker(v, G.nav.current), v ? dl([['Punto', CON.pointName(v.point_id)], ['Idempotency-Key', h('span', { class: 'mono small' }, v.offline_uuid || 'se genera al llegar')], ['Llegada', v.started_at ? `${F.datetime(v.started_at)} · ${num(v.checkin_distance_m)} m` : 'pendiente'], ['Fotos', D.where(T.ph, x => x.visit_id === v.id).length], ['Radio de llegada', (P('con_visit_checkin_radius_m') ?? 150) + ' m (RN-CON-11)']]) : G.ui.empty('No hay visitas planificadas para ti.'))));
    if (extra) { const r = extra(side); if (r instanceof Node) side.appendChild(r); }
    return side;
  }
  function appPage(el, code, title, sub, params, inner, extra) {
    const body = page(el, { code, title, sub });
    const v = appVisit(params);
    if (!G.can('con.visit.perform')) body.appendChild(notice('Ves la app en modo consulta: registrar visitas exige con.visit.perform (visitador).', 'info'));
    body.appendChild(h('div', { class: 'grid con-app' }, phone(code, v, bd => v ? inner(bd, v) : G.ui.empty('Sin visitas planificadas.')), appSide(v, extra)));
  }
  const qtyInput = (val, onCh, label, ph) => { const i = h('input', { class: 'input', type: 'number', min: 0, step: 1, value: val ?? '', placeholder: ph || '', style: 'width:72px;text-align:right', attrs: { 'aria-label': label } }); i.addEventListener('change', () => onCh(i.value)); return i; };
  function checkinBox(bd, v) {
    const p = CON.point(v.point_id);
    if (v.status !== 'PLANNED') return false;
    bd.appendChild(notice('Marca tu llegada con GPS para empezar. El pin del punto está a 0 m; fuera de 150 m se pide motivo (RN-CON-11).', 'info'));
    const rs = h('input', { class: 'input', placeholder: 'Motivo si estás fuera del radio', attrs: { id: 'con-ck-reason', 'aria-label': 'Motivo fuera de rango' } });
    bd.appendChild(h('div', { class: 'stack' }, btn('Llegué (GPS en el punto)', () => tryDo(() => CON.startVisit(v, { lat: R(p.lat + 0.0003, 6), lng: R(p.lng + 0.0002, 6) }), 'Llegada registrada'), { kind: 'primary' }), rs, btn('Llegué (GPS a 320 m)', () => tryDo(() => CON.startVisit(v, { lat: R(p.lat + 0.0029, 6), lng: p.lng, reason: rs.value.trim() }), 'Llegada registrada con motivo'), { sm: true })));
    return true;
  }
  function scr09(el, params) {
    appPage(el, 'CON-09', 'App · Conteo', 'Llegada con GPS y conteo por producto y lote; el sistema calcula lo vendido = teórico − contado − devuelto − retirado + sobrante (RN-CON-12).', params, (bd, v) => {
      if (checkinBox(bd, v)) return;
      const lines = CON.countLines(v); const dr = (v.draft || {}).counts || {};
      if (!lines.length) bd.appendChild(notice('El punto no tiene stock teórico: no hay nada que contar.', 'info'));
      for (const l of lines) {
        const d = dr[l.key] || {}; let calc = null; try { if (d.counted !== undefined && d.counted !== '') calc = CON.calcCount({ opening: l.opening, delivered: l.delivered, counted: Number(d.counted), returned: Number(d.returned) || 0, expired: Number(d.expired) || 0 }); } catch (e) { calc = { err: e.message }; }
        const dis = v.status !== 'IN_PROGRESS';
        const inp = qtyInput(d.counted, val => { CON.setDraft(v, { counts: { [l.key]: { counted: val === '' ? '' : Number(val) } } }); G.refresh(); }, 'Contado ' + G.variantName(l.variant_id), 'contar'); inp.disabled = dis;
        const surp = calc && calc.surplus > 0 ? (() => { const s = h('input', { class: 'input', placeholder: 'Motivo del sobrante *', value: d.surplus_reason || '', attrs: { 'aria-label': 'Motivo del sobrante' } }); s.addEventListener('change', () => CON.setDraft(v, { counts: { [l.key]: { surplus_reason: s.value } } })); return s; })() : null;
        bd.appendChild(h('div', { class: 'card', style: 'padding:10px;display:grid;gap:6px' },
          h('div', { class: 'row between' }, h('b', { class: 'small' }, G.variantName(l.variant_id)), inp),
          h('div', { class: 'small muted' }, `Lote ${l.lot ? l.lot.code : '—'} · vence ${F.date(l.expiry)} · teórico ${num(l.theo)} (ant. ${num(l.opening)} + entr. ${num(l.delivered)})`),
          calc && !calc.err ? h('div', { class: 'row' }, badge(`Vendido ${num(calc.sold)}`, 'ok'), calc.surplus ? badge(`Sobrante ${num(calc.surplus)}`, 'warn') : null, (Number(d.expired) || 0) ? badge(`Retiro ${num(d.expired)}`, 'bad') : null, (Number(d.returned) || 0) ? badge(`Devuelto ${num(d.returned)}`, 'warn') : null) : calc && calc.err ? h('div', { class: 'small', style: 'color:var(--bad)' }, calc.err) : null, surp));
      }
      if (v.status === 'IN_PROGRESS') bd.appendChild(h('div', { class: 'stack' }, btn('Contar todo igual al teórico', () => { const pt = {}; for (const l of lines) if ((dr[l.key] || {}).counted === undefined || (dr[l.key] || {}).counted === '') pt[l.key] = { counted: l.theo }; CON.setDraft(v, { counts: pt }); G.refresh(); }, { sm: true }), btn('Siguiente: retiros ›', () => G.go('CON-10', { visit: v.id }), { kind: 'primary' })));
    }, side => {
      const v = appVisit(params); if (!v) return;
      const lines = CON.countLines(v); const dr = (v.draft || {}).counts || {};
      const rows = lines.map(l => { const d = dr[l.key] || {}; let c = null; try { if (d.counted !== undefined && d.counted !== '') c = CON.calcCount({ opening: l.opening, delivered: l.delivered, counted: Number(d.counted), returned: Number(d.returned) || 0, expired: Number(d.expired) || 0 }); } catch (e) { } return { l, d, c }; });
      side.appendChild(card('Cálculo de lo vendido', table({ id: 'con09s', search: false, rows, columns: [{ key: 'p', label: 'Producto', render: r => G.variantName(r.l.variant_id) }, { key: 't', label: 'Teórico', align: 'r', render: r => num(r.l.theo) }, { key: 'c', label: 'Contado', align: 'r', render: r => r.d.counted ?? '—' }, { key: 's', label: 'Vendido', align: 'r', render: r => r.c ? h('b', null, num(r.c.sold)) : '—' }, { key: 'i', label: 'Importe', align: 'r', render: r => r.c ? F.money(r.c.sold * r.l.price) : '—' }], footer: ['Total', '', '', num(U.sum(rows, r => r.c ? r.c.sold : 0)), F.money(U.sum(rows, r => r.c ? r.c.sold * r.l.price : 0))] }), { flush: true }));
      const p = CON.point(v.point_id); const prev = CON.lastDone(p.id, v.planned_date);
      side.appendChild(notice(`Fecha de venta (D-CON-05, ${P('con_sale_date_basis')}): ${F.date(CON.saleDate(prev ? prev.planned_date : null, v.planned_date))} · día límite de facturación ${F.date(CON.dueDate(CON.saleDate(prev ? prev.planned_date : null, v.planned_date)))} (9 días hábiles).`, 'info'));
    });
  }
  function scr10(el, params) {
    appPage(el, 'CON-10', 'App · Retiros y devoluciones', 'Propone retirar los lotes que vencen dentro de 3 días o fueron retirados del mercado; registra devueltos en buen estado y vencidos o dañados con motivo y foto (RN-CON-13).', params, (bd, v) => {
      if (checkinBox(bd, v)) return;
      const props = CON.proposals(v); const dr = (v.draft || {}).counts || {};
      bd.appendChild(h('b', null, `Retiros propuestos (${props.length})`));
      if (!props.length) bd.appendChild(G.ui.empty('Ningún lote vence en los próximos días.'));
      for (const s of props) {
        const d = dr[s.key] || {};
        bd.appendChild(h('div', { class: 'card', style: 'padding:10px;display:grid;gap:6px' }, h('b', { class: 'small' }, G.variantName(s.variant_id)), h('div', { class: 'small muted' }, `Lote ${s.lot ? s.lot.code : '—'} · ${s.reason} · en el punto ${num(s.qty)}`),
          h('div', { class: 'row' }, badge(`Proponer retirar ${num(s.propose)}`, 'bad'), v.status === 'IN_PROGRESS' ? btn(d.expired ? `Retirado ${num(d.expired)}` : 'Retirar todo', () => { CON.setDraft(v, { counts: { [s.key]: { expired: s.propose, expire_reason: s.recalled ? 'Retiro de lote (lot.recalled)' : 'Por vencer', counted: d.counted !== undefined && d.counted !== '' ? d.counted : 0 } } }); toast('Retiro anotado: vuelve al almacén de devoluciones', 'ok'); G.refresh(); }, { sm: true, kind: d.expired ? 'ghost' : 'danger' }) : null)));
      }
      bd.appendChild(h('b', null, 'Devoluciones en buen estado o dañados'));
      const lines = CON.countLines(v);
      const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Producto a devolver' } }, lines.map(l => h('option', { value: l.key }, `${G.variantName(l.variant_id)} · ${l.lot ? l.lot.code : ''}`)));
      const q = h('input', { class: 'input', type: 'number', min: 1, placeholder: 'Cant.', attrs: { 'aria-label': 'Cantidad devuelta' } });
      const why = h('select', { class: 'input', attrs: { 'aria-label': 'Motivo' } }, ['Empaque dañado', 'Producto dañado por el punto', 'Baja rotación: devolución en buen estado', 'Cadena de frío rota'].map(x => h('option', null, x)));
      if (v.status === 'IN_PROGRESS' && lines.length) bd.appendChild(h('div', { class: 'stack' }, sel, h('div', { class: 'row' }, q, why), btn('Registrar devolución con foto', () => { const n = Number(q.value); if (!(n > 0)) return toast('RN-CON-13: indica la cantidad devuelta.', 'bad'); const cur = dr[sel.value] || {}; CON.setDraft(v, { counts: { [sel.value]: { returned: (Number(cur.returned) || 0) + n, return_reason: why.value } } }); CON.addPhoto(D.get(T.vis, v.id), { kind: 'OTHER' }); toast('Devolución anotada con foto', 'ok'); G.refresh(); }, { sm: true })));
      const ret = Object.entries(dr).filter(([, d]) => (Number(d.returned) || 0) > 0 || (Number(d.expired) || 0) > 0);
      if (ret.length) bd.appendChild(h('div', { class: 'small' }, ret.map(([k, d]) => h('div', null, `${G.variantName(k.split('|')[0])}: ${d.expired ? 'retiro ' + d.expired : ''} ${d.returned ? 'devuelto ' + d.returned + ' (' + d.return_reason + ')' : ''}`))));
      if (v.status === 'IN_PROGRESS') bd.appendChild(btn('Siguiente: fotos ›', () => G.go('CON-11', { visit: v.id }), { kind: 'primary' }));
    }, side => { const v = appVisit(params); if (!v) return; side.appendChild(notice('Lo retirado y devuelto sale del almacén del punto y entra a «Devoluciones Local 1» (wh-DEV-L1); ALM decide su merma. Si ETQ emite lot.recalled, el lote aparece aquí para retirarlo completo.', 'info')); });
  }
  function scr11(el, params) {
    appPage(el, 'CON-11', 'App · Fotos y equipo', 'Fotos de la exhibición (mínimo configurable) y foto del equipo prestado con su termómetro y lectura de temperatura (RN-CON-14).', params, (bd, v) => {
      if (checkinBox(bd, v)) return;
      const ph = D.where(T.ph, x => x.visit_id === v.id); const ex = ph.filter(x => x.kind === 'EXHIBITION').length; const min = P('con_min_exhibition_photos') ?? 1;
      bd.appendChild(h('div', { class: 'row between' }, h('b', null, 'Exhibición'), badge(`${ex} de ${min} mínimo`, ex >= min ? 'ok' : 'warn')));
      if (v.status === 'IN_PROGRESS') bd.appendChild(btn('Tomar foto de la exhibición', () => tryDo(() => CON.addPhoto(v, { kind: 'EXHIBITION' }), 'Foto guardada'), { kind: 'primary' }));
      for (const e of D.where(T.eq, e => e.point_id === v.point_id && e.status === 'LOANED')) {
        const has = ph.find(x => x.kind === 'EQUIPMENT' && x.equipment_loan_id === e.id);
        const t = h('input', { class: 'input', type: 'number', step: '0.1', placeholder: '°C', style: 'width:80px', attrs: { 'aria-label': 'Temperatura ' + e.asset_code } });
        bd.appendChild(h('div', { class: 'card', style: 'padding:10px;display:grid;gap:6px' }, h('div', { class: 'row between' }, h('b', { class: 'small' }, `${eqName(e.equipment_type)} ${e.asset_code}`), has ? badge(`${num(has.temp_c, 1)} °C`, e.equipment_type === 'FREEZER' && has.temp_c > -15 ? 'bad' : 'ok') : badge('Falta foto', 'warn')),
          v.status === 'IN_PROGRESS' && !has ? h('div', { class: 'row' }, t, btn('Foto con termómetro', () => tryDo(() => CON.addPhoto(v, { kind: 'EQUIPMENT', equipment_loan_id: e.id, temp_c: t.value === '' ? null : Number(t.value) }), 'Foto del equipo guardada'), { sm: true })) : null));
      }
      if (ph.length) bd.appendChild(h('div', { class: 'small muted' }, ph.map(x => h('div', null, `${fileName(x.photo_url)} · ${F.datetime(x.taken_at)}`))));
      if (v.status === 'IN_PROGRESS') bd.appendChild(btn('Siguiente: reposición ›', () => G.go('CON-12', { visit: v.id }), { kind: 'primary' }));
    });
  }
  function scr12(el, params) {
    appPage(el, 'CON-12', 'App · Reposición sugerida', 'Cantidad sugerida por producto según la rotación de 28 días: máx(0, ⌈venta diaria × (días a la próxima visita + 2)⌉ − contado), con tope en el máximo (RN-CON-15). Cierra la visita y genera la entrega del mismo día.', params, (bd, v) => {
      if (checkinBox(bd, v)) return;
      const ss = CON.suggestions(v);
      for (const s of ss) {
        const inp = qtyInput(s.qty, val => { const n = val === '' ? s.suggested : Number(val); CON.setDraft(v, { sugg: { [s.variant_id]: { qty: n, reason: n !== s.suggested ? (((v.draft || {}).sugg || {})[s.variant_id] || {}).reason || 'Ajuste del visitador' : '' } } }); G.refresh(); }, 'Reponer ' + G.variantName(s.variant_id)); inp.disabled = v.status !== 'IN_PROGRESS';
        const rs = s.qty !== s.suggested ? (() => { const r = h('input', { class: 'input', value: s.reason || '', placeholder: 'Motivo del cambio *', attrs: { 'aria-label': 'Motivo del cambio' } }); r.addEventListener('change', () => CON.setDraft(v, { sugg: { [s.variant_id]: { qty: s.qty, reason: r.value } } })); return r; })() : null;
        bd.appendChild(h('div', { class: 'card', style: 'padding:10px;display:grid;gap:6px' }, h('div', { class: 'row between' }, h('b', { class: 'small' }, G.variantName(s.variant_id)), inp), h('div', { class: 'small muted' }, `${num(s.soldWindow)} vendidas en 28 d (${num(s.daily, 2)}/día) · próxima visita en ${s.daysToNext} d · contado ${num(s.counted)} · máx. ${s.cp.max_qty ?? '—'} → sugerido ${s.suggested}`), rs));
      }
      if (v.status === 'IN_PROGRESS') {
        const close = withDelivery => { const vv = D.get(T.vis, v.id); for (const s of ss) if (s.qty !== s.suggested && !s.reason) return toast('RN-CON-15: el cambio a la sugerencia exige motivo.', 'bad'); const ok = tryDo(() => { CON.closeVisit(vv); if (withDelivery) { const lines = ss.filter(s => s.qty > 0).map(s => ({ variant_id: s.variant_id, qty: s.qty })); if (lines.length) { const d = CON.createDelivery({ point_id: vv.point_id, lines, visit_id: vv.id }); CON.requestGuide(d); CON.dispatch(D.get(T.del, d.id)); } } return true; }, withDelivery ? 'Visita cerrada y reposición despachada con GRE' : 'Visita cerrada'); if (ok) G.refresh(); };
        bd.appendChild(h('div', { class: 'stack' }, btn('Cerrar visita y entregar reposición', () => close(true), { kind: 'primary' }), btn('Cerrar visita sin reponer', () => close(false), { sm: true })));
      } else if (v.status === 'DONE') bd.appendChild(notice('Visita cerrada. Lo vendido queda listo para liquidar en CON-13.', 'ok'));
    }, side => { const v = appVisit(params); if (!v) return; const p = CON.point(v.point_id); side.appendChild(notice(`Origen: ${G.siteName(p.supply_establishment_id)}. La entrega del mismo día valida contrato, vida útil (${P('con_min_shelf_days_on_delivery') ?? 10} d), máximo y deuda vencida, y sale con GRE motivo ${P('con_gre_transfer_reason_code') ?? '05'}.`, 'info')); });
  }

  /* ---------- CON-13 / CON-14 Liquidaciones ---------- */
  function settlementsTable(rows, id) {
    return table({ id, rows: rows.sort(U.by('first_sale_date', -1)), onRow: r => G.go('CON-14', { id: r.id }), columns: [
      { key: 'number', label: 'Liquidación', mono: true }, { key: 'point_id', label: 'Punto', render: r => CON.pointName(r.point_id) }, { key: 'first_sale_date', label: 'Fecha de venta', render: r => F.date(r.first_sale_date) }, { key: 'due_date', label: 'Día límite', render: r => F.date(r.due_date) },
      { key: 'gross_amount', label: 'Vendido', align: 'r', render: r => F.money(r.gross_amount) }, { key: 'commission_amount', label: 'Comisión', align: 'r', render: r => `${F.money(r.commission_amount)} (${num(r.commission_pct, 1)} %)` }, { key: 'net_amount', label: 'Neto', align: 'r', render: r => h('b', null, F.money(r.net_amount)) },
      { key: 'status', label: 'Estado', render: r => status(r.status) }, { key: 'light', label: 'Semáforo', render: r => lightBadge(r), value: r => CON.light(r).tone },
    ], filters: [{ key: 'status', label: 'Estado', options: [['DRAFT', 'Borrador'], ['APPROVED', 'Aprobada'], ['INVOICED', 'Facturada'], ['VOIDED', 'Anulada']] }, { key: 'light', label: 'Semáforo', options: [['bad', 'Rojo'], ['warn', 'Ámbar'], ['ok', 'Verde']], value: r => CON.light(r).tone }, { key: 'point_id', label: 'Punto', options: pointOpts() }] });
  }
  function scr13(el) {
    const body = page(el, { code: 'CON-13', title: 'Liquidaciones', sub: 'Bandeja por punto: vendido, comisión, neto, fecha de venta, día límite y semáforo de 9 días hábiles (verde, ámbar, rojo).' });
    const vis = CON.visiblePoints(); const ids = new Set(vis.map(p => p.id));
    const rows = D.where(T.st, s => ids.has(s.point_id)); const open = rows.filter(s => ['DRAFT', 'APPROVED'].includes(s.status));
    const red = open.filter(s => CON.light(s).tone === 'bad'), amb = open.filter(s => CON.light(s).tone === 'warn');
    body.appendChild(kpis([{ label: 'Por facturar', value: F.money(U.sum(open, s => s.net_amount)), sub: `${open.length} liquidaciones` }, { label: 'En rojo', value: red.length, sub: 'pasaron el día límite (RN-CON-20)', tone: red.length ? 'bad' : 'ok' }, { label: 'En ámbar', value: amb.length, sub: `faltan ${P('con_invoice_alert_business_days') ?? 2} días hábiles o menos`, tone: amb.length ? 'warn' : 'ok' }, { label: 'Facturadas fuera de plazo', value: F.pct(G.kpi('KPI-CON-08') ? G.kpi('KPI-CON-08').value : 0, 0), sub: 'KPI-CON-08 del mes' }]));
    const pend = vis.map(p => ({ p, cs: CON.unsettled(p.id) })).filter(x => x.cs.length);
    if (pend.length) body.appendChild(card('Conteos por liquidar', h('div', { class: 'stack' }, pend.map(({ p, cs }) => { const first = cs.map(c => c.sale_date).sort()[0]; const due = CON.dueDate(first); const l = CON.light({ status: 'DRAFT', due_date: due }); return h('div', { class: 'row between' }, h('span', null, h('b', null, CON.pointName(p)), ` · ${cs.length} líneas · ${F.money(U.sum(cs, c => c.sold_qty * c.unit_price))} · venta desde ${F.date(first)} · límite ${F.date(due)} `, badge(l.label, l.tone)), btn('Generar liquidación', () => { const s = tryDo(() => CON.createSettlement(p.id), 'Liquidación generada'); if (s) G.go('CON-14', { id: s.id }); }, { sm: true, kind: 'primary', disabled: !G.canDo('CON', 'C') })); }))));
    body.appendChild(settlementsTable(rows, 'con13'));
    body.appendChild(notice('El rojo notifica a ADMINISTRACION y CONTADORA. Calendario: sábados, domingos y los 16 feriados nacionales de 2026 (D-CON-06).', 'info'));
  }
  function scr14(el, params) {
    const vis = new Set(CON.visiblePoints().map(p => p.id));
    const all = D.where(T.st, s => vis.has(s.point_id)).sort(U.by('first_sale_date', -1));
    const s = (params.id && D.get(T.st, params.id)) || all.find(x => ['DRAFT', 'APPROVED'].includes(x.status)) || all[0];
    const sel = h('select', { class: 'input', style: 'max-width:340px', attrs: { 'aria-label': 'Liquidación' } }, all.map(x => h('option', { value: x.id, selected: s && x.id === s.id }, `${x.number} · ${CON.pointName(x.point_id)} · ${G.ui.statusLabel(x.status)}`))); sel.addEventListener('change', () => G.go('CON-14', { id: sel.value }));
    const body = page(el, { code: 'CON-14', title: 'Detalle de liquidación', sub: 'Líneas por conteo, producto y lote; aprobación; emisión de la factura (FAC) y estado SUNAT; anulación con nota de crédito.', actions: [sel] });
    if (!s) return body.appendChild(G.ui.empty('No hay liquidaciones.'));
    const l = CON.light(s); const doc = s.sales_document_id && D.get('sales_documents', s.sales_document_id); const nc = s.credit_note_id && D.get('sales_documents', s.credit_note_id);
    body.appendChild(h('div', { class: 'row' }, status(s.status), badge(l.label, l.tone),
      s.status === 'DRAFT' ? btn('Aprobar', () => tryDo(() => CON.approveSettlement(s), 'Liquidación aprobada (consignment.settled)'), { kind: 'primary', disabled: !G.can('con.settlement.approve') }) : null,
      s.status === 'APPROVED' ? btn('Emitir factura', () => tryDo(() => CON.invoiceSettlement(s), 'Factura emitida y enlazada'), { kind: 'primary', disabled: !G.can('con.settlement.invoice') }) : null,
      s.status !== 'VOIDED' ? btn(s.status === 'INVOICED' ? 'Anular con nota de crédito' : 'Anular', () => askReason('Anular liquidación', r => CON.voidSettlement(s, r), 'Liquidación anulada; los conteos vuelven a estar por liquidar'), { kind: 'danger' }) : null));
    body.appendChild(kpis([{ label: 'Vendido (precio al punto)', value: F.money(s.gross_amount) }, { label: 'Comisión', value: F.money(s.commission_amount), sub: `${num(s.commission_pct, 1)} % ${(CON.tiers(s.contract_id).length ? '· tramo del mes (RN-CON-21)' : '· del contrato')}` }, { label: 'Neto a facturar', value: F.money(s.net_amount), tone: 'ok', sub: 'D-CON-04: factura por el precio neto de comisión' }, { label: 'Día límite', value: F.date(s.due_date), sub: `venta del ${F.date(s.first_sale_date)} + 9 días hábiles`, tone: l.tone }]));
    body.appendChild(h('div', { class: 'grid side-r' },
      table({ id: 'con14', search: false, rows: CON.settlementLines(s.id), columns: [{ key: 'sale_date', label: 'Venta', render: r => F.date(r.sale_date) }, { key: 'variant_id', label: 'Producto', render: r => G.variantName(r.variant_id) }, { key: 'lot', label: 'Lote', mono: true, render: r => (D.get('lots', r.lot_id) || {}).code }, { key: 'qty', label: 'Cant.', align: 'r', render: r => num(r.qty) }, { key: 'unit_price', label: 'Precio', align: 'r', render: r => F.money(r.unit_price) }, { key: 'amount', label: 'Importe', align: 'r', render: r => F.money(r.amount) }], footer: ['Total', '', '', num(U.sum(CON.settlementLines(s.id), x => x.qty)), '', F.money(s.gross_amount)] }),
      card('Comprobante', dl([['Punto', CON.pointName(s.point_id)], ['Contrato', (D.get(T.ctr, s.contract_id) || {}).number], ['Período', `${F.date(s.period_from)} – ${F.date(s.period_to)}`], ['Aprobada', s.approved_by ? `${G.userShort(s.approved_by)} · ${F.datetime(s.approved_at)}` : '—'], ['Factura', doc ? G.docs.label(doc) : '—'], ['Estado SUNAT', doc ? status(doc.sunat_status) : '—'], ['Facturada el', F.date(s.invoiced_on)], ['Vence (crédito)', doc ? F.date(doc.due_date) : '—'], ['Saldo por cobrar', doc ? F.money(doc.balance) : '—'], nc ? ['Nota de crédito', G.docs.label(nc)] : null, s.void_reason ? ['Motivo de anulación', s.void_reason] : null]))));
  }

  /* ---------- CON-15 Incentivos ---------- */
  function scr15(el, params) {
    const month = params.month || G.date.month(G.TODAY); const to = month === G.date.month(G.TODAY) ? G.TODAY : G.date.add(G.date.addMonths(month, 1), -1);
    const canA = G.can('con.contract.approve');
    const body = page(el, { code: 'CON-15', title: 'Incentivos', sub: 'Escalas de margen por volumen por contrato, metas mensuales por punto y ranking por venta, % vendido y margen neto.', actions: [pills([['2026-09-01', 'Setiembre'], ['2026-10-01', 'Octubre']], month, v => G.go('CON-15', { month: v }))] });
    const pts = CON.visiblePoints().filter(p => p.status !== 'PROSPECT');
    const rows = pts.map(p => { const st = CON.monthStats(p.id, month, to); return { p, name: CON.pointName(p), st, pctSold: st.delU ? R(st.soldU / st.delU * 100, 1) : 0, goal: st.target ? R(st.sales / st.target * 100, 1) : null }; }).sort((a, b) => b.st.sales - a.st.sales);
    body.appendChild(h('div', { class: 'grid side-r' }, table({ id: 'con15', search: false, rows: rows.map((r, i) => Object.assign(r, { rank: i + 1 })), columns: [
      { key: 'rank', label: '#', align: 'r' }, { key: 'name', label: 'Punto' }, { key: 'sales', label: 'Venta', align: 'r', render: r => F.money(r.st.sales), value: r => r.st.sales },
      { key: 'tier', label: 'Tramo alcanzado', render: r => r.st.tier ? badge(`${num(r.st.tier.pct, 1)} % desde ${F.money(r.st.tier.from_amount, 0)}`, 'info') : (r.st.pct ? `${num(r.st.pct, 1)} % fijo` : 'Margen') }, { key: 'comm', label: 'Comisión del mes', align: 'r', render: r => F.money(r.st.commission) },
      { key: 'pctSold', label: '% vendido', align: 'r', render: r => F.pct(r.pctSold, 0) }, { key: 'net', label: 'Margen neto', align: 'r', render: r => F.money(r.st.net), value: r => r.st.net },
      { key: 'goal', label: 'Meta', align: 'r', render: r => r.st.target ? h('span', null, `${F.money(r.st.target, 0)} · `, badge(F.pct(r.goal, 0), r.goal >= 100 ? 'ok' : r.goal >= 70 ? 'warn' : 'bad')) : '—', value: r => r.goal || 0 },
    ] }), card('Venta del mes por punto', chart.hbar({ items: rows.map(r => ({ label: r.name, value: r.st.sales, tone: r.goal >= 100 ? 'ok' : '' })), format: v => F.money(v, 0) }))));
    const grid = h('div', { class: 'grid c3' });
    for (const p of pts) {
      const c = CON.activeContract(p.id); if (!c) continue; const tiers = CON.tiers(c.id); const tg = D.find(T.tgt, t => t.point_id === p.id && t.period === month);
      const from = h('input', { class: 'input', type: 'number', placeholder: 'Desde S/', style: 'width:100px', attrs: { 'aria-label': 'Desde' } }); const pc = h('input', { class: 'input', type: 'number', placeholder: '%', style: 'width:70px', attrs: { 'aria-label': 'Porcentaje' } });
      const tgi = h('input', { class: 'input', type: 'number', value: tg ? tg.target_amount : '', placeholder: 'Meta S/', style: 'width:110px', attrs: { 'aria-label': 'Meta del mes' } });
      grid.appendChild(card(CON.pointName(p), h('div', { class: 'stack' }, h('div', { class: 'small muted' }, `${c.number} · ${c.compensation_type === 'COMMISSION' ? 'comisión ' + num(c.commission_pct, 1) + ' % base' : 'margen'} · modo ${P('con_tier_mode')}`),
        tiers.length ? h('div', { class: 'stack', style: 'gap:4px' }, tiers.map((t, i) => h('div', { class: 'row between small' }, h('span', null, `${F.money(t.from_amount)} – ${tiers[i + 1] ? F.money(tiers[i + 1].from_amount - 0.01) : 'más'}`), badge(num(t.pct, 1) + ' %', 'info')))) : h('div', { class: 'small muted' }, 'Sin escalas: aplica el porcentaje del contrato.'),
        h('div', { class: 'row' }, from, pc, btn('Agregar tramo', () => tryDo(() => CON.saveTier(c.id, Number(from.value), Number(pc.value)), 'Tramo agregado'), { sm: true, disabled: !canA })),
        h('div', { class: 'row' }, tgi, btn('Guardar meta', () => tryDo(() => { const v = Number(tgi.value); if (!(v > 0)) G.fail('KPI-CON-09', 'La meta debe ser mayor que cero.'); if (tg) D.update(T.tgt, tg.id, { target_amount: v }); else D.insert(T.tgt, { point_id: p.id, period: month, target_amount: v }); }, 'Meta guardada'), { sm: true, disabled: !G.can('con.point.manage') })))));
    }
    body.appendChild(grid);
  }

  /* ---------- CON-16 Rentabilidad por punto ---------- */
  function scr16(el, params) {
    const month = params.month || G.date.month(G.TODAY); const to = month === G.date.month(G.TODAY) ? G.TODAY : G.date.add(G.date.addMonths(month, 1), -1);
    const body = page(el, { code: 'CON-16', title: 'Rentabilidad por punto', sub: 'Venta − comisión − costo de visitas − vencidos y retirados a costo, por mes; recomendación de mantener, renegociar o cerrar.', actions: [pills([['2026-09-01', 'Setiembre'], ['2026-10-01', 'Octubre (al ' + F.date(G.TODAY).slice(0, 5) + ')']], month, v => G.go('CON-16', { month: v }))] });
    const rows = CON.visiblePoints().map(p => { const st = CON.monthStats(p.id, month, to); const rec = CON.recommend(st); return { p, name: CON.pointName(p), st, rec, marg: st.sales ? R(st.net / st.sales * 100, 1) : 0 }; });
    const tot = k => U.sum(rows, r => r.st[k]);
    body.appendChild(kpis([{ label: 'Venta en puntos', value: F.money(tot('sales'), 0) }, { label: 'Comisiones', value: F.money(tot('commission'), 0) }, { label: 'Visitas y vencidos', value: F.money(tot('visitCost') + tot('expCost'), 0), sub: `${tot('visits')} visitas · ${F.money(tot('expCost'), 0)} vencidos a costo` }, { label: 'Margen neto', value: F.money(tot('net'), 0), tone: tot('net') > 0 ? 'ok' : 'bad', sub: 'KPI-CON-05' }]));
    body.appendChild(table({ id: 'con16', search: false, rows, onRow: r => pointDrawer(r.p), columns: [
      { key: 'name', label: 'Punto' }, { key: 'sales', label: 'Venta', align: 'r', render: r => F.money(r.st.sales), value: r => r.st.sales }, { key: 'commission', label: 'Comisión', align: 'r', render: r => F.money(r.st.commission) },
      { key: 'visits', label: 'Visitas × costo', align: 'r', render: r => `${r.st.visits} × ${F.money(CON.visitCost(r.p))} = ${F.money(r.st.visitCost)}` }, { key: 'exp', label: 'Vencidos y devueltos a costo', align: 'r', render: r => F.money(r.st.expCost) },
      { key: 'net', label: 'Margen neto', align: 'r', render: r => h('b', null, F.money(r.st.net)), value: r => r.st.net }, { key: 'marg', label: '% s/venta', align: 'r', render: r => F.pct(r.marg, 1) }, { key: 'rec', label: 'Recomendación', render: r => badge(r.rec[0], r.rec[1]), value: r => r.rec[0] },
    ], footer: ['Total', F.money(tot('sales')), F.money(tot('commission')), F.money(tot('visitCost')), F.money(tot('expCost')), F.money(tot('net')), '', ''] }));
    body.appendChild(card('Composición por punto', chart.bar({ labels: rows.map(r => r.name.split(' ').slice(0, 2).join(' ')), series: [{ name: 'Margen neto', values: rows.map(r => r.st.net) }, { name: 'Comisión', values: rows.map(r => r.st.commission) }, { name: 'Visitas + vencidos', values: rows.map(r => r.st.visitCost + r.st.expCost) }], stacked: true, format: v => F.money(v, 0) })));
    body.appendChild(notice('Recomendación: margen neto ≥ 45 % de la venta → mantener; 25–45 % → renegociar comisión o surtido; menos de 25 % → cerrar o cambiar surtido.', 'info'));
  }

  /* ---------- CON-17 Stock en puntos y vencimientos ---------- */
  function scr17(el) {
    const body = page(el, { code: 'CON-17', title: 'Stock en puntos y vencimientos', sub: 'Stock por punto, producto y lote con días para vencer; lotes retirados del mercado (lot.recalled) ubicados en puntos.' });
    const rows = CON.visiblePoints().flatMap(p => CON.stock(p).map(s => Object.assign(s, { point: CON.pointName(p), p })));
    const nd = P('con_withdraw_days_before_expiry') ?? 3;
    const rec = rows.filter(r => r.recalled);
    body.appendChild(kpis([{ label: 'Unidades en puntos', value: num(U.sum(rows, r => r.qty)), sub: F.money(U.sum(rows, r => r.value), 0) + ' a precio al punto' }, { label: `Vencen en ${nd} días o menos`, value: rows.filter(r => r.days_left != null && r.days_left <= nd).length, sub: 'se retiran en la visita (RN-CON-13)', tone: rows.some(r => r.days_left != null && r.days_left <= nd) ? 'bad' : 'ok' }, { label: 'Vencen en 10 días', value: rows.filter(r => r.days_left != null && r.days_left <= 10 && r.days_left > nd).length, tone: 'warn' }, { label: 'Lotes retirados del mercado', value: rec.length, tone: rec.length ? 'bad' : 'ok' }]));
    if (rec.length) body.appendChild(notice(h('div', null, h('b', null, 'Retiro de lote: '), rec.map(r => `${r.point}: ${num(r.qty)} u del lote ${r.lot.code}`).join(' · '), ' — se generó una visita urgente.'), 'bad'));
    body.appendChild(table({ id: 'con17', rows, onRow: r => pointDrawer(r.p), columns: [
      { key: 'point', label: 'Punto' }, { key: 'variant_id', label: 'Producto', render: r => G.variantName(r.variant_id), value: r => G.variantName(r.variant_id) }, { key: 'lot', label: 'Lote', mono: true, render: r => r.lot ? r.lot.code : '—', value: r => r.lot ? r.lot.code : '' },
      { key: 'qty', label: 'Cant.', align: 'r', render: r => num(r.qty) }, { key: 'value', label: 'Valor', align: 'r', render: r => F.money(r.value) }, { key: 'expiry', label: 'Vence', render: r => F.date(r.expiry) },
      { key: 'days_left', label: 'Días', align: 'r', render: r => r.recalled ? badge('Retirado', 'bad') : r.days_left == null ? '—' : badge(String(r.days_left), r.days_left <= nd ? 'bad' : r.days_left <= 10 ? 'warn' : 'ok') },
    ], filters: [{ key: 'point_id', label: 'Punto', options: pointOpts() }, { key: 'risk', label: 'Riesgo', options: [['bad', 'Retirar ya'], ['warn', 'Vence en 10 días'], ['ok', 'Normal']], value: r => r.recalled || (r.days_left != null && r.days_left <= nd) ? 'bad' : r.days_left != null && r.days_left <= 10 ? 'warn' : 'ok' }],
    actions: r => !r.recalled && ['GERENTE', 'CALIDAD'].includes(G.ctx.role) ? [btn('Simular retiro (ETQ)', () => G.ui.confirm({ title: 'Simular lot.recalled', message: `ETQ marca el lote ${r.lot ? r.lot.code : ''} como retirado del mercado. CON ubica el lote en los puntos y crea la visita urgente.`, confirmLabel: 'Emitir lot.recalled', danger: true, onConfirm: () => { D.update('lots', r.lot_id, { qc_status: 'RECALLED', block_reason: 'Retiro de lote (simulado desde CON-17)' }); G.events.emit('lot.recalled', { lot_id: r.lot_id }); toast('Lote retirado: visita urgente creada', 'warn'); G.refresh(); } }), { sm: true, kind: 'danger' })] : [] }));
  }

  /* ---------- registro ---------- */
  const APPROLES = ['VISITADOR_CONSIGNACION', 'ADMINISTRACION', 'SUPERVISORA_VENTAS'];
  G.register({ code: 'CON', name: 'Consignación', phase: 3, group: 'Nuevos canales', screens: [
    { code: 'CON-01', name: 'Puntos de consignación', render: scr01 }, { code: 'CON-02', name: 'Ficha del punto', render: scr02 }, { code: 'CON-03', name: 'Contrato del punto', render: scr03 },
    { code: 'CON-04', name: 'Productos permitidos y precios', render: scr04 }, { code: 'CON-05', name: 'Equipos prestados', render: scr05 }, { code: 'CON-06', name: 'Nueva entrega', render: scr06 },
    { code: 'CON-07', name: 'Registro de consignaciones', render: scr07 }, { code: 'CON-08', name: 'Plan de visitas', render: scr08 },
    { code: 'CON-09', name: 'App · Conteo', render: scr09, roles: APPROLES }, { code: 'CON-10', name: 'App · Retiros y devoluciones', render: scr10, roles: APPROLES }, { code: 'CON-11', name: 'App · Fotos y equipo', render: scr11, roles: APPROLES }, { code: 'CON-12', name: 'App · Reposición sugerida', render: scr12, roles: APPROLES },
    { code: 'CON-13', name: 'Liquidaciones', render: scr13 }, { code: 'CON-14', name: 'Detalle de liquidación', render: scr14 }, { code: 'CON-15', name: 'Incentivos', render: scr15 }, { code: 'CON-16', name: 'Rentabilidad por punto', render: scr16 }, { code: 'CON-17', name: 'Stock en puntos y vencimientos', render: scr17 },
  ] });

  /* ---------- ganchos ---------- */
  G.alertProviders.push(() => {
    if (!G.canSee('CON')) return [];
    const open = D.where(T.st, s => ['DRAFT', 'APPROVED'].includes(s.status)); const red = open.filter(s => CON.light(s).tone === 'bad'); const amb = open.filter(s => CON.light(s).tone === 'warn');
    const out = [];
    if (red.length) out.push({ module: 'CON', title: `${red.length} liquidación(es) de consignación fuera de plazo`, detail: red.map(s => `${s.number} · ${CON.pointName(s.point_id)} · límite ${F.date(s.due_date)}`).join(' · '), tone: 'bad', go: () => G.go('CON-13') });
    if (amb.length) out.push({ module: 'CON', title: `${amb.length} liquidación(es) vencen en 2 días hábiles o menos`, detail: amb.map(s => s.number).join(', '), tone: 'warn', go: () => G.go('CON-13') });
    const late = D.where(T.vis, v => v.status === 'PLANNED' && v.planned_date < G.TODAY); if (late.length) out.push({ module: 'CON', title: `${late.length} visita(s) de consignación atrasadas`, detail: 'Regístralas o márcalas como no cumplidas.', tone: 'warn', go: () => G.go('CON-08') });
    const unp = D.where(T.cnt, c => !c.settled && c.sold_qty > 0); if (unp.length) { const first = unp.map(c => c.sale_date).sort()[0]; const l = CON.light({ status: 'DRAFT', due_date: CON.dueDate(first) }); if (l.tone !== 'ok') out.push({ module: 'CON', title: 'Conteos sin liquidar cerca del día límite', detail: `Venta desde el ${F.date(first)}: límite ${F.date(CON.dueDate(first))}.`, tone: l.tone, go: () => G.go('CON-13') }); }
    return out;
  });
  G.searchProviders.push(q => {
    const out = [];
    for (const p of D.all(T.pts)) if (CON.pointName(p).toLowerCase().includes(q)) out.push({ label: CON.pointName(p), sub: 'Punto de consignación · CON-02', go: () => G.go('CON-02', { id: p.id }) });
    for (const s of D.all(T.st)) if (s.number.toLowerCase().includes(q)) out.push({ label: s.number, sub: `Liquidación · ${CON.pointName(s.point_id)}`, go: () => G.go('CON-14', { id: s.id }) });
    for (const d of D.all(T.del)) if (d.number.toLowerCase().includes(q) || (d.gre_series && `${d.gre_series}-${d.gre_number}`.toLowerCase().includes(q))) out.push({ label: d.number, sub: `Entrega en consignación · ${CON.pointName(d.point_id)}`, go: () => { G.go('CON-06'); deliveryDrawer(d); } });
    return out.slice(0, 8);
  });
  G.scanHandlers.push(code => { const d = D.find(T.del, x => x.number === code || (x.gre_series && `${x.gre_series}-${U.pad(x.gre_number, 8)}` === code)); return d ? () => { G.go('CON-06'); deliveryDrawer(d); } : null; });

  /* ---------- indicadores ---------- */
  const kp = (p, fn) => { const pts = D.all(T.pts).filter(x => x.status !== 'PROSPECT'); return pts.map(x => fn(x, CON.monthStats(x.id, p.from, p.to))); };
  G.kpiCalc['KPI-CON-01'] = p => { const v = kp(p, (x, s) => s.sales); return { value: R(U.sum(v, x => x)), detail: 'Σ de los puntos; por punto en CON-15' }; };
  G.kpiCalc['KPI-CON-02'] = p => { const s = kp(p, (x, s) => s); const n = U.sum(s, x => x.soldU), d = U.sum(s, x => x.delU); return { value: d ? R(n / d * 100, 1) : 0, numerator: n, denominator: d }; };
  G.kpiCalc['KPI-CON-03'] = p => { const days = Math.max(1, G.date.diff(p.to, p.from) + 1); const stock = U.sum(D.all(T.pts), x => U.sum(CON.stock(x), s => s.qty)); const sold = U.sum(kp(p, (x, s) => s.soldU), x => x); const daily = sold / days; return { value: daily ? R(stock / daily, 1) : 0, numerator: R(stock, 0), denominator: R(daily, 2) }; };
  G.kpiCalc['KPI-CON-04'] = p => { const s = kp(p, (x, s) => s); const n = U.sum(s, x => x.retU + x.expU), d = U.sum(s, x => x.delU); return { value: d ? R(n / d * 100, 1) : 0, numerator: n, denominator: d }; };
  G.kpiCalc['KPI-CON-05'] = p => R(U.sum(kp(p, (x, s) => s.net), x => x));
  G.kpiCalc['KPI-CON-06'] = p => { const s = kp(p, (x, s) => s); const n = U.sum(s, x => x.visits), d = U.sum(s, x => x.planned); return { value: d ? R(n / d * 100, 1) : 0, numerator: n, denominator: d }; };
  G.kpiCalc['KPI-CON-07'] = p => { const ss = D.where(T.st, s => s.status === 'INVOICED' && s.invoiced_on >= p.from && s.invoiced_on <= p.to); return { value: ss.length ? R(U.sum(ss, s => CON.businessDaysBetween(s.first_sale_date, s.invoiced_on)) / ss.length, 1) : 0, denominator: ss.length }; };
  G.kpiCalc['KPI-CON-08'] = p => { const ss = D.where(T.st, s => s.status === 'INVOICED' && s.invoiced_on >= p.from && s.invoiced_on <= p.to); const late = ss.filter(s => s.invoiced_on > s.due_date).length; return { value: ss.length ? R(late / ss.length * 100, 1) : 0, numerator: late, denominator: ss.length }; };
  G.kpiCalc['KPI-CON-09'] = p => { const s = kp(p, (x, s) => s).filter(x => x.target); const n = U.sum(s, x => x.sales), d = U.sum(s, x => x.target); return { value: d ? R(n / d * 100, 1) : 0, numerator: R(n), denominator: d }; };

  /* =================================================================
     Datos de ejemplo (orden 60)
     ================================================================= */
  G.seed(60, function seedCON() {
    const r = U.rng(6060);
    // feriados nacionales 2026 (D-CON-06)
    [['2026-01-01', 'Año Nuevo'], ['2026-04-02', 'Jueves Santo'], ['2026-04-03', 'Viernes Santo'], ['2026-05-01', 'Día del Trabajo'], ['2026-06-07', 'Batalla de Arica y Día de la Bandera'], ['2026-06-29', 'San Pedro y San Pablo'], ['2026-07-23', 'Día de la Fuerza Aérea'], ['2026-07-28', 'Fiestas Patrias'], ['2026-07-29', 'Fiestas Patrias'], ['2026-08-06', 'Batalla de Junín'], ['2026-08-30', 'Santa Rosa de Lima'], ['2026-10-08', 'Combate de Angamos'], ['2026-11-01', 'Todos los Santos'], ['2026-12-08', 'Inmaculada Concepción'], ['2026-12-09', 'Batalla de Ayacucho'], ['2026-12-25', 'Navidad']]
      .forEach(([d, n], i) => D.insert(T.hol, { id: 'hol-' + d, holiday_date: d, name: n, scope: 'NATIONAL', establishment_id: null }, { silent: true }));
    // puntos con almacén CONSIGNMENT propio
    const SP = [
      { cu: 'cu-B009', wd: [5], cost: null, opened: '2026-08-01', first: '2026-08-28', visits: ['2026-09-04', '2026-09-11', '2026-09-19', '2026-09-25', '2026-10-02', '2026-10-09'], next: ['2026-10-16'], missed: [['2026-09-18', 'Punto cerrado por inventario; se visitó al día siguiente']],
        ctr: { number: 'CC-2026-001', type: 'COMMISSION', pct: 20, from: '2026-08-01', to: '2026-12-31' }, prev: { number: 'CC-2026-000', from: '2026-06-01', to: '2026-07-31', pct: 22 },
        prods: [['va-DG-CAL-1L', 18, 18, 30], ['va-DG-CAL-500', 14, 14, 20], ['va-M3-CHO-500', 24, 24, 12], ['va-M3-HUA-500', 16, 16, 12], ['va-M4-MAN-500', 15, 15, 10], ['va-M5-MER-AGU', 16, 16, 12]], eq: [['FREEZER', 'EQ-CSG-001', 'CF-220L-88123', 'Congeladora horizontal 220 L', 1450, '2026-08-01', -19.5]], target: 3000 },
      { cu: 'cu-B010', wd: [6], cost: 20, opened: '2026-08-15', first: '2026-08-29', visits: ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26', '2026-10-03'], next: ['2026-10-10', '2026-10-17'], missed: [],
        ctr: { number: 'CC-2026-002', type: 'MARGIN', pct: null, from: '2026-08-15', to: null },
        prods: [['va-M5-CAF-250', 25.6, 32, 15], ['va-M5-ALM-250', 17.6, 22, 15], ['va-M5-NUE-250', 19.2, 24, 12], ['va-M5-MER-AGU', 12.8, 16, 12], ['va-M4-MIE-500', 20, 25, 10], ['va-M3-JAM-250', 15.2, 19, 10]], eq: [['COOLER', 'EQ-CSG-002', 'EX-90-55120', 'Exhibidora refrigerada vertical', 1890, '2026-08-15', 3.8], ['DISPLAY', 'EQ-CSG-003', null, 'Exhibidor de madera para café y frutos secos', 320, '2026-08-15', null, 'RETURNED']], target: 2000 },
      { cu: 'cu-B011', wd: [1], cost: 18, opened: '2026-08-24', first: '2026-08-31', visits: ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'], next: ['2026-10-12'], missed: [],
        ctr: { number: 'CC-2026-003', type: 'COMMISSION', pct: 15, from: '2026-08-24', to: '2027-02-28' }, tiers: [[0, 15], [2000, 18]],
        prods: [['va-M5-INF-MUN', 9, 9, 20], ['va-M5-INF-HLU', 9, 9, 20], ['va-M5-MER-FRE', 15, 15, 12], ['va-M5-MIX-200', 19, 19, 15], ['va-M4-CGA-1L', 17, 17, 20], ['va-M5-CAF-G500', 55, 55, 8]], eq: [['FREEZER', 'EQ-CSG-004', 'CF-150L-77310', 'Congeladora 150 L para caldos', 1180, '2026-08-24', -18.2]], target: 2500 },
    ];
    const lots = {}; // variante → lotes propios de la demo de consignación
    const shelf = vid => (G.productOf(vid) || {}).shelf_life_days || 30;
    const mkLots = vid => {
      if (lots[vid]) return lots[vid];
      const life = shelf(vid); const step = Math.max(7, Math.min(21, Math.floor(life / 2)));
      const arr = []; for (let d = '2026-08-04', i = 1; d <= '2026-10-05'; d = G.date.add(d, step), i++) { const v = G.variant(vid); arr.push({ id: `lo-CN-${v.sku}-${i}`, product_id: v.product_id, variant_id: vid, code: `L${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}-C${U.pad(i, 2)}`, origin: (G.productOf(vid) || {}).origin === 'RESALE' ? 'PURCHASE' : 'PRODUCTION', production_date: d, expiry_date: G.date.add(d, life), qc_status: 'RELEASED', unit_cost: v.std_cost, released_at: d + 'T16:00', released_by: 'Silvia Ramos Tello', need: 0 }); }
      return (lots[vid] = arr);
    };
    const pickLot = (vid, date) => { const min = 10; const c = mkLots(vid).filter(l => !l.special && l.production_date < date && G.date.diff(l.expiry_date, date) >= min); return c[c.length - 1]; };
    // lote de jamón que vence el 12/10 (CA-CON-05)
    const vJ = G.variant('va-M3-JAM-250'); const XL = { id: 'lo-CN-JAM-X', product_id: vJ.product_id, variant_id: vJ.id, code: 'L260912-J09', origin: 'PRODUCTION', production_date: '2026-09-12', expiry_date: '2026-10-12', qc_status: 'RELEASED', unit_cost: vJ.std_cost, released_at: '2026-09-12T16:00', released_by: 'Silvia Ramos Tello', need: 0, special: true };
    mkLots(vJ.id).push(XL);
    // 1) simulación en memoria (entregas, conteos) para saber cuánto recibir por lote
    const sims = [];
    for (const sp of SP) {
      const st = {}; const evs = []; const all = [sp.first].concat(sp.visits);
      // entrega inicial y reposiciones
      const deliver = (date, prodMax, counted) => { const lines = []; for (const [vid, , , mx] of prodMax) { const have = U.sum(Object.entries(st).filter(([k, q]) => k.startsWith(vid + '|') && q > 0), ([, q]) => q); const need = mx - have; if (need < 1) continue; let lot = pickLot(vid, date); if (sp.cu === 'cu-B010' && vid === 'va-M3-JAM-250' && date === '2026-09-26') lot = XL; if (!lot) continue; const q = lot === XL ? Math.min(need, 4) : need; lines.push({ variant_id: vid, lot_id: lot.id, qty: q }); st[vid + '|' + lot.id] = (st[vid + '|' + lot.id] || 0) + q; lot.need += q; } return lines; };
      evs.push({ kind: 'D', date: sp.first, lines: deliver(sp.first, sp.prods) });
      for (let k = 1; k < all.length; k++) {
        const date = all[k]; const counts = [];
        for (const key of Object.keys(st)) { const q = st[key]; if (q <= 0) continue; const [vid, lotId] = key.split('|'); const lot = mkLots(vid).find(l => l.id === lotId); let sold = Math.round(q * (0.35 + r() * 0.4)); if (lotId === XL.id) sold = 1; const left = q - sold; const expired = G.date.diff(lot.expiry_date, date) <= 3 ? left : 0; const returned = !expired && left > 2 && r() < 0.06 ? 1 : 0; counts.push({ key, variant_id: vid, lot_id: lotId, theo: q, sold, expired, returned, counted: left - expired - returned }); st[key] = left - expired - returned; }
        evs.push({ kind: 'V', date, counts });
        const blocked = sp.cu === 'cu-B011' && date >= '2026-10-05';
        if (!blocked) evs.push({ kind: 'D', date, lines: deliver(date, sp.prods) });
      }
      sims.push({ sp, evs });
    }
    // 2) lotes y recepción en el almacén de origen
    for (const arr of Object.values(lots)) for (const l of arr) { if (!l.need) continue; const need = l.need; delete l.need; delete l.special; D.insert('lots', l, { silent: true }); G.inv.move({ type: 'RECEIPT', wh: CON.originWh(l.variant_id), variant: l.variant_id, lot: l.id, qty: need, unitCost: l.unit_cost, source: { type: 'PRODUCTION', id: l.code }, at: l.production_date + 'T17:00', reason: 'Ingreso de lote' }); }
    // 3) maestros: puntos, contratos, productos, equipos, metas
    for (const sp of SP) {
      const c = D.get('customers', sp.cu); const a = D.find('customer_addresses', x => x.customer_id === c.id && x.is_default);
      const whId = 'wh-CSG-' + c.id.slice(3);
      D.insert('warehouses', { id: whId, establishment_id: 'es-L1', code: 'CSG-' + c.id.slice(3), name: 'Consignación · ' + c.trade_name, wh_type: 'CONSIGNMENT', customer_id: c.id, min_temp_c: null, max_temp_c: null, status: 'ACTIVE', allows_sale: false, pick_priority: 999 }, { silent: true });
      const p = D.insert(T.pts, { id: 'cp-' + c.id.slice(3), customer_id: c.id, warehouse_id: whId, supply_establishment_id: 'es-L1', zone_id: a.zone_id, address_id: a.id, visitor_user_id: 'us-mvilla', visit_frequency_days: 7, visit_weekdays: sp.wd, visit_cost: sp.cost, lat: a.lat, lng: a.lng, status: 'ACTIVE', opened_on: sp.opened, closed_on: null, close_reason: null }, { silent: true });
      sp.p = p;
      if (sp.prev) { const pc = D.insert(T.ctr, { id: 'cc-' + sp.prev.number, point_id: p.id, number: sp.prev.number, version: 1, valid_from: sp.prev.from, valid_to: sp.prev.to, compensation_type: 'COMMISSION', commission_pct: sp.prev.pct, settlement_frequency_days: 7, withdraw_days_before_expiry: 3, signed_file_url: `contratos/${sp.prev.number}.pdf`, status: 'EXPIRED', approved_by: 'us-rquispe', approved_at: G.date.add(sp.prev.from, -3) + 'T12:00', terminated_reason: null }, { silent: true }); for (const [vid, pr, srp, mx] of sp.prods.slice(0, 4)) D.insert(T.cp, { contract_id: pc.id, variant_id: vid, consignor_price: pr, suggested_retail_price: srp, min_qty: 2, max_qty: mx, active: true }, { silent: true }); }
      const ct = D.insert(T.ctr, { id: 'cc-' + sp.ctr.number, point_id: p.id, number: sp.ctr.number, version: sp.prev ? 2 : 1, previous_id: sp.prev ? 'cc-' + sp.prev.number : null, valid_from: sp.ctr.from, valid_to: sp.ctr.to, compensation_type: sp.ctr.type, commission_pct: sp.ctr.pct, settlement_frequency_days: 7, withdraw_days_before_expiry: 3, signed_file_url: `contratos/${sp.ctr.number}.pdf`, status: 'ACTIVE', approved_by: 'us-rquispe', approved_at: G.date.add(sp.ctr.from, -2) + 'T12:00', terminated_reason: null }, { silent: true });
      sp.ct = ct;
      for (const [vid, pr, srp, mx] of sp.prods) D.insert(T.cp, { contract_id: ct.id, variant_id: vid, consignor_price: pr, suggested_retail_price: srp, min_qty: Math.max(2, Math.round(mx / 4)), max_qty: mx, active: true }, { silent: true });
      for (const [f, pc] of sp.tiers || []) D.insert(T.tier, { contract_id: ct.id, from_amount: f, pct: pc }, { silent: true });
      for (const [t, code, ser, desc, val, on, temp, stt] of sp.eq) D.insert(T.eq, { point_id: p.id, equipment_type: t, asset_code: code, serial_number: ser, description: desc, asset_value: val, loan_agreement_url: `comodatos/${code}.pdf`, delivered_on: on, returned_on: stt === 'RETURNED' ? '2026-09-12' : null, last_check_on: null, last_temp_c: temp, status: stt || 'LOANED', status_reason: stt === 'RETURNED' ? 'Se reemplazó por la exhibidora refrigerada' : null }, { silent: true });
      for (const per of ['2026-09-01', '2026-10-01']) D.insert(T.tgt, { point_id: p.id, period: per, target_amount: sp.target }, { silent: true });
    }
    // 4) reproducir los eventos con los servicios reales (entregas con GRE, visitas, conteos, liquidaciones)
    for (const { sp, evs } of sims) {
      const p = sp.p; let prevVisit = null;
      for (const ev of evs) {
        if (ev.kind === 'D') {
          if (!ev.lines.length) continue;
          const d = D.insert(T.del, { point_id: p.id, contract_id: sp.ct.id, number: D.next('CENT', 'EC-', 5), delivery_date: ev.date, from_warehouse_id: CON.originWh(ev.lines[0].variant_id), visit_id: prevVisit ? prevVisit.id : null, status: 'DRAFT', override_max_reason: null, created_by: 'us-mvilla' }, { silent: true });
          for (const l of ev.lines) { const lot = D.get('lots', l.lot_id); const cp = CON.cprod(sp.ct.id, l.variant_id); D.insert(T.dl, { delivery_id: d.id, variant_id: l.variant_id, lot_id: l.lot_id, qty: l.qty, weight_kg: null, unit_price: cp.consignor_price, expiry_date: lot.expiry_date, warehouse_id: CON.originWh(l.variant_id) }, { silent: true }); }
          CON.requestGuide(d); CON.dispatch(D.get(T.del, d.id), { received_by: 'Encargado de tienda' });
          continue;
        }
        if (sp.missed) for (const [md, why] of sp.missed) if (md < ev.date && (!prevVisit || md > prevVisit.planned_date)) D.insert(T.vis, { point_id: p.id, visitor_user_id: 'us-mvilla', planned_date: md, status: 'MISSED', miss_reason: why, notes: null }, { silent: true });
        const v = D.insert(T.vis, { point_id: p.id, visitor_user_id: 'us-mvilla', planned_date: ev.date, status: 'IN_PROGRESS', started_at: ev.date + 'T10:05', checkin_lat: R(p.lat + 0.0004, 6), checkin_lng: p.lng, checkin_distance_m: 44.5, offline_uuid: 'off-seed-' + ev.date + p.id, draft: { counts: {}, sugg: {} }, notes: null }, { silent: true });
        const draft = {}; for (const c of ev.counts) draft[c.key] = { counted: c.counted, expired: c.expired, returned: c.returned, return_reason: c.returned ? 'Empaque dañado' : null, expire_reason: 'Por vencer' };
        v.draft.counts = draft;
        D.insert(T.ph, { visit_id: v.id, kind: 'EXHIBITION', photo_url: `fotos/visitas/${v.id}/exhibicion-1.jpg`, temp_c: null, taken_at: ev.date + 'T10:20', lat: p.lat, lng: p.lng }, { silent: true });
        for (const e of D.where(T.eq, e => e.point_id === p.id && (e.status === 'LOANED' || (e.returned_on && e.returned_on > ev.date)))) if (e.status === 'LOANED') D.insert(T.ph, { visit_id: v.id, kind: 'EQUIPMENT', equipment_loan_id: e.id, photo_url: `fotos/visitas/${v.id}/equipo-${e.asset_code}.jpg`, temp_c: R((e.equipment_type === 'FREEZER' ? -19.5 : 3.5) + (r() - 0.5) * 2, 1), taken_at: ev.date + 'T10:25', lat: p.lat, lng: p.lng }, { silent: true });
        CON.closeVisit(v);
        prevVisit = v;
        // liquidación de la visita
        const s = CON.createSettlement(p.id);
        const dueIn = CON.businessDaysBetween(G.TODAY, s.due_date);
        const keepOpen = (sp.cu === 'cu-B011' && ev.date >= '2026-09-28') || (sp.cu === 'cu-B009' && ev.date === '2026-10-09');
        if (keepOpen) { if (sp.cu === 'cu-B011' && ev.date === '2026-09-28') CON.approveSettlement(s); continue; }
        CON.approveSettlement(s);
        const lag = sp.cu === 'cu-B010' && ev.date === '2026-09-12' ? 11 : 2 + Math.floor(r() * 4); // una facturada fuera de plazo
        const inv = CON.addBusinessDays(s.first_sale_date, Math.min(lag, 12));
        CON.invoiceSettlement(D.get(T.st, s.id), { date: inv <= G.TODAY ? inv : G.TODAY });
        void dueIn;
      }
      for (const nd of sp.next) D.insert(T.vis, { point_id: p.id, visitor_user_id: 'us-mvilla', planned_date: nd, status: 'PLANNED', notes: 'Generada por frecuencia', offline_uuid: null }, { silent: true });
    }
    // cobranza de las facturas de consignación: pagadas a su vencimiento, salvo la deuda vencida de Market Orgánico
    for (const s of D.where(T.st, s => s.status === 'INVOICED')) {
      const doc = D.get('sales_documents', s.sales_document_id); if (!doc) continue;
      const p = CON.point(s.point_id);
      const unpaid = p.customer_id === 'cu-B011' || doc.due_date >= G.TODAY;
      if (unpaid) continue;
      G.pay.register({ customer_id: doc.customer_id, payment_method_id: 'pm-TRANSFER', amount: doc.total, reference: 'OP' + (55000000 + Math.floor(r() * 999999)), cash_account_id: 'ca-BCP-CTE', allocations: [{ order_id: null, document_id: doc.id, amount: doc.total }], brand_id: doc.brand_id, establishment_id: doc.establishment_id, at: G.date.add(doc.due_date, -1) + 'T11:00', silent: true });
    }
    // un reverso de ejemplo en el registro (cantidad mal digitada y corregida)
    const e0 = D.find(T.reg, e => e.point_id === 'cp-B009' && e.entry_type === 'DELIVERY' && e.entry_date === '2026-09-11');
    if (e0) { CON.reg({ point_id: e0.point_id, entry_type: 'REVERSAL', entry_date: '2026-09-11', variant_id: e0.variant_id, lot_id: e0.lot_id, qty: -e0.qty, unit_price: e0.unit_price, amount: -e0.amount, gre_series: e0.gre_series, gre_number: e0.gre_number, source_type: 'REVERSAL', source_id: e0.id, reversal_of: e0.id, reason: 'Asiento duplicado al sincronizar la app sin conexión' }); CON.reg(Object.assign({}, e0, { id: undefined, created_at: undefined, reason: 'Asiento correcto tras el reverso' })); }
    // una entrega en borrador sin GRE (RN-CON-07) y un prospecto sin contrato
    const dd = D.insert(T.del, { point_id: 'cp-B009', contract_id: 'cc-CC-2026-001', number: D.next('CENT', 'EC-', 5), delivery_date: G.TODAY, from_warehouse_id: 'wh-CNG-L1', visit_id: null, status: 'DRAFT', override_max_reason: null, created_by: 'us-mtorres' }, { silent: true });
    const lc = G.inv.fefo('va-DG-CAL-1L', 'wh-CNG-L1')[0]; if (lc) D.insert(T.dl, { delivery_id: dd.id, variant_id: 'va-DG-CAL-1L', lot_id: lc.b.lot_id, qty: 4, unit_price: 18, expiry_date: lc.lot.expiry_date, warehouse_id: 'wh-CNG-L1' }, { silent: true });
  }, 'consignación');

  /* =================================================================
     Pruebas de aceptación (CA-CON-01 … 11)
     ================================================================= */
    /* lote con stock suficiente para toda la entrega: en la corrida completa otros módulos siembran varios lotes de caldo y FEFO repartiría la prueba en varios conteos */
  const oneLot = (variant_id, qty, point) => { const wh = CON.originWh(variant_id, point.supply_establishment_id); const min = P('con_min_shelf_days_on_delivery') ?? 10; const c = G.inv.fefo(variant_id, wh).find(x => x.lot && G.date.diff(x.lot.expiry_date, G.TODAY) >= min && (x.b.qty - (x.b.reserved_qty || 0)) >= qty); return c ? c.lot.id : undefined; };
const T_ = (name, fn) => G.tests.push({ module: 'CON', name, fn });
  const eq = (a, b, msg) => { if (Math.abs(Number(a) - Number(b)) > 0.005 && a !== b) throw new Error(`${msg}: se esperaba ${b} y salió ${a}`); };
  const expectRule = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code} y no ocurrió`); };
  const testPoint = (contractOpts = {}) => {
    const cust = D.insert('customers', { doc_type: 'RUC', doc_number: U.rucCheck('2061999888'), full_name: 'BODEGA PRUEBA SAC', trade_name: 'Bodega Prueba', customer_type: 'CONSIGNMENT_POINT', status: 'ACTIVE', phone: '+51999000111' }, { silent: true });
    D.insert('customer_addresses', { customer_id: cust.id, label: 'Local', address_line: 'Av. Prueba 100, Surco', reference: 'Frente al parque', lat: -12.11, lng: -76.99, zone_id: 'dz-SURCO-B', is_default: true, status: 'ACTIVE' }, { silent: true });
    const p = CON.savePoint({ customer_id: cust.id, supply_establishment_id: 'es-L1', visitor_user_id: 'us-mvilla', visit_frequency_days: 7 });
    const c = CON.saveContract(Object.assign({ point_id: p.id, valid_from: '2026-10-01', valid_to: '2026-12-31', compensation_type: 'COMMISSION', commission_pct: 20, settlement_frequency_days: 7, signed_file_url: 'x.pdf', status: 'ACTIVE' }, contractOpts));
    D.update(T.pts, p.id, { status: 'ACTIVE', opened_on: '2026-10-01' }, { silent: true });
    return { p: CON.point(p.id), c, cust };
  };
  T_('CA-CON-01: comisión 20 %, 30 caldos entregados a S/ 18, se cuentan 12 y se retiran 2 → vendido 16, S/ 288,00, comisión S/ 57,60, neto S/ 230,40', async () => {
    const { p, c } = testPoint();
    CON.saveProduct({ contract_id: c.id, variant_id: 'va-DG-CAL-1L', consignor_price: 18, suggested_retail_price: 18, min_qty: 0, max_qty: 40 });
    const d = CON.createDelivery({ point_id: p.id, date: '2026-10-03', lines: [{ variant_id: 'va-DG-CAL-1L', qty: 30, lot_id: oneLot('va-DG-CAL-1L', 30, p) }] }); CON.requestGuide(d); CON.dispatch(D.get(T.del, d.id));
    const v = D.insert(T.vis, { point_id: p.id, visitor_user_id: 'us-mvilla', planned_date: G.TODAY, status: 'PLANNED' });
    CON.startVisit(v, { lat: p.lat, lng: p.lng });
    const lines = CON.countLines(v); eq(U.sum(lines, l => l.theo), 30, 'teórico');
    const key = lines[0].key; CON.setDraft(v, { counts: { [key]: { counted: 12, expired: 2 } } });
    CON.addPhoto(v, { kind: 'EXHIBITION' }); CON.closeVisit(v);
    const cs = CON.visitSold(v.id); eq(U.sum(cs, x => x.sold_qty), 16, 'vendido');
    const s = CON.createSettlement(p.id); eq(s.gross_amount, 288, 'importe'); eq(s.commission_amount, 57.6, 'comisión'); eq(s.net_amount, 230.4, 'neto');
    eq(G.inv.qty('va-DG-CAL-1L', p.warehouse_id), 12, 'stock en el punto tras el conteo');
  });
  T_('CA-CON-02: entrega lista sin serie ni número de GRE → se rechaza con RN-CON-07', async () => {
    const d = D.find(T.del, x => x.status === 'DRAFT' && !x.gre_series); if (!d) throw new Error('No hay entrega en borrador sin GRE en los datos');
    expectRule(() => CON.dispatch(d), 'RN-CON-07');
    CON.requestGuide(d); const d2 = D.get(T.del, d.id); if (!d2.gre_series || d2.gre_transfer_reason !== '05') throw new Error('La GRE no quedó con motivo 05');
  });
  T_('CA-CON-03: venta lun 02/11/2026 → límite vie 13/11/2026; venta mar 01/12/2026 con feriados 08/12 y 09/12 → mié 16/12/2026', async () => {
    eq(CON.dueDate('2026-11-02'), '2026-11-13', 'límite noviembre'); if (CON.dueDate('2026-11-02') !== '2026-11-13') throw new Error('noviembre');
    if (CON.dueDate('2026-12-01') !== '2026-12-16') throw new Error('Diciembre: salió ' + CON.dueDate('2026-12-01'));
    if (dow('2026-11-13') !== 5 || dow('2026-12-16') !== 3) throw new Error('días de la semana');
  });
  T_('CA-CON-04: lote de embutidos que vence en 5 días → se rechaza con RN-CON-06 (mínimo 10 días)', async () => {
    const v = G.variant('va-M3-CHO-500');
    const lot = D.insert('lots', { product_id: v.product_id, variant_id: v.id, code: 'L-TEST-5D', origin: 'PRODUCTION', production_date: G.date.add(G.TODAY, -16), expiry_date: G.date.add(G.TODAY, 5), qc_status: 'RELEASED', unit_cost: v.std_cost }, { silent: true });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-CAM-L1', variant: v.id, lot: lot.id, qty: 10, unitCost: v.std_cost, source: { type: 'TEST', id: 't' } });
    const e = expectRule(() => CON.createDelivery({ point_id: 'cp-B009', lines: [{ variant_id: v.id, qty: 2, lot_id: lot.id }] }), 'RN-CON-06');
    if (!/mínimo para consignar es 10/.test(e.message)) throw new Error('El mensaje no indica el mínimo de 10 días');
  });
  T_('CA-CON-05: punto visitado el 10/10/2026 con un lote que vence el 12/10/2026 → la app propone retirarlo completo', async () => {
    const v = D.find(T.vis, x => x.point_id === 'cp-B010' && x.planned_date === '2026-10-10' && x.status === 'PLANNED'); if (!v) throw new Error('Falta la visita del 10/10 en Bodega Gourmet');
    const pr = CON.proposals(v).find(x => x.lot_id === 'lo-CN-JAM-X'); if (!pr) throw new Error('No se propuso el lote que vence el 12/10');
    const inPoint = G.inv.qty('va-M3-JAM-250', 'wh-CSG-B010'); const lotQty = D.find('stock_balances', b => b.warehouse_id === 'wh-CSG-B010' && b.lot_id === 'lo-CN-JAM-X').qty;
    eq(pr.propose, lotQty, 'propone el lote completo'); if (!(inPoint >= lotQty && lotQty > 0)) throw new Error('El lote no tiene stock en el punto');
  });
  T_('CA-CON-06: 56 vendidas en 28 días, próxima visita en 7 días, 6 contadas y máximo 20 → reposición 12', async () => {
    const s = CON.suggest({ soldWindow: 56, windowDays: P('con_rotation_window_days'), daysToNext: 7, safety: P('con_safety_days'), counted: 6, max: 20 }); eq(s.qty, 12, 'reposición'); eq(s.daily, 2, 'venta diaria');
  });
  T_('CA-CON-07: escala 15 % hasta S/ 1 999,99 y 18 % desde S/ 2 000; venta S/ 2 500 → comisión del mes S/ 450 (18 % sobre todo)', async () => {
    const c = CON.activeContract('cp-B011'); const r = CON.commission(c, 2500); eq(r.pct, 18, 'tramo'); eq(r.amount, 450, 'comisión'); eq(CON.commission(c, 1999.99).pct, 15, 'tramo bajo');
    expectRule(() => CON.saveTier(c.id, 2000, 20), 'RN-CON-21');
  });
  T_('CA-CON-08: venta S/ 2 500, comisión S/ 450, 4 visitas a S/ 15 y vencidos a costo S/ 80 → margen neto S/ 1 910', async () => {
    eq(CON.netMargin({ sales: 2500, commission: 450, visits: 4, visitCost: P('con_default_visit_cost'), expiredCost: 80 }), 1910, 'margen neto');
    eq(CON.visitCost({ visit_cost: null }), 15, 'costo de visita por defecto');
  });
  T_('CA-CON-09: punto con congeladora prestada sin devolver → cerrar se rechaza con RN-CON-23', async () => {
    const p = CON.point('cp-B009'); if (!D.find(T.eq, e => e.point_id === p.id && e.status === 'LOANED')) throw new Error('Falta la congeladora en los datos');
    expectRule(() => CON.setPointStatus(p, 'CLOSED', 'Fin de la relación comercial'), 'RN-CON-23');
  });
  T_('CA-CON-10: conteo de 40 con teórico 35 → sobrante 5 con motivo y vendido 0, nunca −5', async () => {
    const r = CON.calcCount({ opening: 20, delivered: 15, counted: 40 }); eq(r.surplus, 5, 'sobrante'); eq(r.sold, 0, 'vendido'); if (r.sold < 0) throw new Error('vendido negativo');
    const { p, c } = testPoint(); CON.saveProduct({ contract_id: c.id, variant_id: 'va-DG-CAL-1L', consignor_price: 18, suggested_retail_price: 18, max_qty: 40 });
    const d = CON.createDelivery({ point_id: p.id, date: '2026-10-05', lines: [{ variant_id: 'va-DG-CAL-1L', qty: 35, lot_id: oneLot('va-DG-CAL-1L', 35, p) }] }); CON.requestGuide(d); CON.dispatch(D.get(T.del, d.id));
    const v = D.insert(T.vis, { point_id: p.id, visitor_user_id: 'us-mvilla', planned_date: G.TODAY, status: 'PLANNED' }); CON.startVisit(v, { lat: p.lat, lng: p.lng }); CON.addPhoto(v, { kind: 'EXHIBITION' });
    const key = CON.countLines(v)[0].key; CON.setDraft(v, { counts: { [key]: { counted: 40 } } });
    expectRule(() => CON.closeVisit(D.get(T.vis, v.id)), 'RN-CON-12');
    CON.setDraft(v, { counts: { [key]: { surplus_reason: 'Producto mal ubicado en la trastienda' } } }); CON.closeVisit(D.get(T.vis, v.id));
    const cnt = CON.visitSold(v.id)[0]; eq(cnt.surplus_qty, 5, 'sobrante registrado'); eq(cnt.sold_qty, 0, 'vendido registrado');
    if (!D.find(T.reg, e => e.point_id === p.id && e.entry_type === 'SURPLUS' && e.qty === 5)) throw new Error('Falta el asiento SURPLUS en el Registro');
  });
  T_('CA-CON-11: contrato vigente 01/10–31/12/2026 y otro activo desde 01/12/2026 → se rechaza con RN-CON-03', async () => {
    const { p } = testPoint();
    expectRule(() => CON.saveContract({ point_id: p.id, valid_from: '2026-12-01', valid_to: null, compensation_type: 'COMMISSION', commission_pct: 18, settlement_frequency_days: 7, status: 'ACTIVE' }), 'RN-CON-03');
    CON.saveContract({ point_id: p.id, valid_from: '2027-01-01', compensation_type: 'COMMISSION', commission_pct: 18, settlement_frequency_days: 7, status: 'ACTIVE' });
  });
  T_('RN-CON-01/22/24: sin RUC no hay punto; deuda vencida > 15 días bloquea entregas; el visitador ve solo sus puntos', async () => {
    const c = D.insert('customers', { doc_type: 'DNI', doc_number: '45127788', full_name: 'Bodega sin RUC', customer_type: 'CONSIGNMENT_POINT', status: 'ACTIVE' }, { silent: true });
    expectRule(() => CON.savePoint({ customer_id: c.id, supply_establishment_id: 'es-L1', visit_frequency_days: 7 }), 'RN-CON-01');
    expectRule(() => CON.createDelivery({ point_id: 'cp-B011', lines: [{ variant_id: 'va-M5-INF-MUN', qty: 1 }] }), 'RN-CON-22');
    const prev = G.ctx.role; try { G.ctx.role = 'VISITADOR_CONSIGNACION'; D.update(T.pts, 'cp-B010', { visitor_user_id: null }, { silent: true }); if (CON.visiblePoints().some(p => p.id === 'cp-B010')) throw new Error('El visitador ve un punto que no es suyo'); } finally { G.ctx.role = prev; }
  });
})();
