/* =====================================================================
   ALM · Almacenes, lotes, FEFO y movimientos de inventario (Fase 1)
   Un solo stock por lote y vencimiento. Recepción con control de calidad
   mínimo (el lote nace en cuarentena), liberación y bloqueo con historial,
   reservas FEFO por pedido, transferencias entre locales con guía de
   remisión, conteos ciegos con aprobación, mermas con motivo y alertas de
   vencimiento y de temperatura de cámaras. Toda escritura de stock pasa por
   G.inv.move (RN-ALM-01).
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, toast, confirm, form, tabs, pills } = G.ui;
  const U = G.util;
  const R = (n, d = 2) => U.round(n, d);
  const A = G.alm = G.alm || {};
  const ins = (t, r, silent) => G.db.insert(t, r, { silent: !!silent });

  /* ------------------------------------------------------------------
     RN-ALM-01: única puerta de inventario. stock_movements y stock_balances
     solo se escriben desde G.inv.move (alm_inventory_move en la BD).
     ------------------------------------------------------------------ */
  let gate = 0;
  const coreMove = G.inv.move;
  G.inv.move = function (o) { gate++; try { return coreMove.call(G.inv, o); } finally { gate--; } };
  const GUARDED = new Set(['stock_balances', 'stock_movements']);
  const guardMsg = t => `${t} solo se escribe con la acción única de inventario (alm_inventory_move / G.inv.move): registra una recepción, transferencia, conteo o merma. El kardex es de solo inserción y se corrige con reversos.`;
  const dbIns = G.db.insert, dbUpd = G.db.update, dbRem = G.db.remove;
  G.db.insert = function (name, row, opts) { if (GUARDED.has(name) && !gate && !G._seeding) G.fail('RN-ALM-01', guardMsg(name)); return dbIns.call(this, name, row, opts); };
  G.db.update = function (name, id, patch, opts) { if (GUARDED.has(name) && !gate && !G._seeding) G.fail('RN-ALM-01', guardMsg(name)); return dbUpd.call(this, name, id, patch, opts); };
  G.db.remove = function (name, id) { if (GUARDED.has(name) && !G._seeding) G.fail('RN-ALM-01', guardMsg(name)); return dbRem.call(this, name, id); };

  /* ------------------------------------------------------------------
     Utilidades
     ------------------------------------------------------------------ */
  const lotOf = id => id ? G.db.get('lots', id) : null;
  const whOf = id => G.db.get('warehouses', id);
  const daysLeft = lot => lot && lot.expiry_date ? G.date.diff(lot.expiry_date, G.TODAY) : null;
  const unitOf = v => v && v.sale_mode === 'KG' ? 'kg' : 'u';
  const qtyTxt = (q, v) => q === null || q === undefined ? '—' : G.fmt.num(q, v && v.sale_mode === 'KG' ? 3 : (Math.abs(q % 1) > 0.0005 ? 3 : 0)) + ' ' + unitOf(v);
  const canCost = () => G.can('alm.stock.view_cost');
  const money = v => canCost() ? G.fmt.money(v) : '•••';
  const prodOf = vid => G.productOf(vid) || {};
  const WH_TYPES = [['MAIN', 'Almacén principal'], ['COLD_ROOM', 'Cámara de frío'], ['FREEZER', 'Congeladora'], ['STORE', 'Mostrador'], ['PRODUCTION', 'Producción'], ['QUARANTINE', 'Cuarentena'], ['TRANSIT', 'Tránsito'], ['VEHICLE', 'Vehículo'], ['RETURNS', 'Devoluciones'], ['CONSIGNMENT', 'Consignación']];
  const whTypeName = t => (WH_TYPES.find(x => x[0] === t) || [t, t])[1];
  const MOVE_TYPES = [['RECEIPT', 'Recepción'], ['SALE', 'Venta'], ['RETURN', 'Devolución'], ['TRANSFER_OUT', 'Salida por traslado'], ['TRANSFER_IN', 'Ingreso por traslado'], ['PRODUCTION_IN', 'Ingreso de producción'], ['PRODUCTION_OUT', 'Consumo de producción'], ['ADJUSTMENT', 'Ajuste por conteo'], ['WASTE', 'Merma'], ['CONSIGNMENT_OUT', 'Salida a consignación'], ['CONSIGNMENT_RETURN', 'Retorno de consignación'], ['REVERSAL', 'Reverso']];
  const moveName = t => (MOVE_TYPES.find(x => x[0] === t) || [t, t])[1];
  const LOT_STATUS = [['QUARANTINE', 'Cuarentena'], ['RELEASED', 'Liberado'], ['BLOCKED', 'Bloqueado'], ['REJECTED', 'Rechazado'], ['RECALLED', 'Retirado']];
  const SOURCE_TYPES = [['PURCHASE', 'Compra'], ['FARM', 'Granja Don Guando'], ['PRODUCTION', 'Producción'], ['CUSTOMER_RETURN', 'Devolución de cliente'], ['OTHER', 'Otro']];
  const srcName = t => (SOURCE_TYPES.find(x => x[0] === t) || [t, t])[1];
  const APPEAR = [['OK', 'Conforme'], ['OBSERVED', 'Observado'], ['REJECTED', 'Rechazado']];
  const QC = [['PENDING', 'Sin controlar'], ['PASS', 'Aprobada'], ['FAIL', 'Rechazada']];
  const now = () => G.date.now();
  const me = () => G.ctx.userId();
  const meName = () => G.ctx.userName();
  const variantOpts = (pred = () => true) => G.db.all('product_variants').filter(v => v.status === 'ACTIVE' && pred(v)).map(v => [v.id, `${v.sku} · ${v.name}`]);
  const whOpts = (pred = () => true) => G.db.all('warehouses').filter(w => w.status === 'ACTIVE' && pred(w)).map(w => [w.id, `${w.code} · ${w.name}`]);
  const lotBadge = lot => {
    if (!lot) return badge('Sin lote', '');
    const d = daysLeft(lot);
    return h('span', { class: 'row', style: 'gap:4px;flex-wrap:wrap' }, G.ui.status(lot.qc_status), d === null ? null : d < 0 ? badge('Vencido', 'bad') : d <= 3 ? badge(`Vence en ${G.fmt.days(d)}`, 'bad') : d <= 7 ? badge(`Vence en ${G.fmt.days(d)}`, 'warn') : null);
  };
  const siteOfWh = id => (whOf(id) || {}).establishment_id;
  const balRow = b => { const v = G.variant(b.variant_id) || {}; return Object.assign({}, b, { brand_id: v.brand_id, establishment_id: siteOfWh(b.warehouse_id) }); };
  const transitWh = () => whOf('wh-TRA') || G.db.find('warehouses', w => w.wh_type === 'TRANSIT');
  const devWhFor = site => site === 'es-L2' ? 'wh-CAM-L2' : 'wh-DEV-L1';

  /* ------------------------------------------------------------------
     Reservas FEFO (RN-ALM-04, RN-ALM-09)
     ------------------------------------------------------------------ */
  /** candidatos FEFO del local: lotes liberados con disponible y vida suficiente a la fecha de entrega */
  A.fefoCandidates = function (variant, site, { deliveryDate = G.TODAY, ignoreReserved = false } = {}) {
    const minDays = G.param('alm_min_days_left_on_delivery') ?? 1;
    const whs = G.inv.saleWarehouses(site);
    const out = [];
    for (const w of whs) for (const { b, lot } of G.inv.fefo(variant, w.id, { ignoreReserved })) {
      if (lot && lot.expiry_date && G.date.diff(lot.expiry_date, deliveryDate) < minDays) continue;
      out.push({ b, lot, wh: w, avail: R(b.qty - (ignoreReserved ? 0 : (b.reserved_qty || 0)), 3) });
    }
    return out.sort((a, c) => String(a.lot ? a.lot.expiry_date : '9999').localeCompare(String(c.lot ? c.lot.expiry_date : '9999')) || (a.wh.pick_priority - c.wh.pick_priority));
  };
  /** reserva el pedido por FEFO en los almacenes de venta de su local; devuelve faltantes */
  A.reserve = function (order) {
    if ((order.reservations || []).length) G.inv.release(order);
    const short = []; order.reservations = [];
    for (const l of order.lines || []) {
      let need = l.qty;
      for (const c of A.fefoCandidates(l.variant_id, order.establishment_id, { deliveryDate: order.delivery_date || G.TODAY })) {
        if (need <= 0.0005) break;
        const take = Math.min(need, c.b.qty - (c.b.reserved_qty || 0)); if (take <= 0.0005) continue;
        c.b.reserved_qty = R((c.b.reserved_qty || 0) + take, 3);
        order.reservations.push({ line_id: l.id, balance_id: c.b.id, wh: c.b.warehouse_id, lot_id: c.b.lot_id, qty: R(take, 3) });
        need = R(need - take, 3);
      }
      if (need > 0.0005) short.push({ variant_id: l.variant_id, qty: need });
    }
    order.stock_short = short.length ? short : null;
    G.db.touch(); A.syncReservations(order, 'RELEASED', 'Reserva recalculada');
    return short;
  };
  /** registra en stock_reservations las reservas vigentes del pedido (las anteriores se cierran) */
  A.syncReservations = function (order, endStatus = 'RELEASED', reason) {
    for (const r of G.db.where('stock_reservations', r => r.order_id === order.id && r.status === 'ACTIVE')) { r.status = endStatus; r.released_reason = reason || null; r.closed_at = now(); }
    for (const rs of order.reservations || []) {
      const l = (order.lines || []).find(x => x.id === rs.line_id) || {};
      const v = G.variant(l.variant_id) || {};
      ins('stock_reservations', { order_id: order.id, order_number: order.number, order_line_id: rs.line_id, balance_id: rs.balance_id, warehouse_id: rs.wh, variant_id: l.variant_id, lot_id: rs.lot_id, qty: rs.qty, weight_kg: v.sale_mode === 'KG' ? rs.qty : v.nominal_weight_kg ? R(rs.qty * v.nominal_weight_kg, 3) : null, status: 'ACTIVE', released_reason: null, brand_id: order.brand_id, establishment_id: order.establishment_id, delivery_date: order.delivery_date, reserved_at: order.confirmed_at || now() }, true);
    }
    G.db.touch();
  };
  /** libera a mano una reserva (permiso alm.reservation.release) */
  A.releaseReservation = function (orderId, balanceId, lineId, reason) {
    if (!G.can('alm.reservation.release')) G.fail('RN-ALM-09', `Tu rol (${G.roleName()}) no tiene el permiso alm.reservation.release para liberar reservas.`);
    if (!reason) G.fail('RN-ALM-09', 'Liberar una reserva a mano exige motivo.');
    const o = G.db.get('sales_orders', orderId); if (!o) G.fail('RN-ALM-09', 'Pedido no encontrado.');
    const i = (o.reservations || []).findIndex(r => r.balance_id === balanceId && r.line_id === lineId); if (i < 0) G.fail('RN-ALM-09', 'La reserva ya no está activa.');
    const rs = o.reservations[i]; const b = G.db.get('stock_balances', rs.balance_id);
    if (b) b.reserved_qty = Math.max(0, R((b.reserved_qty || 0) - rs.qty, 3));
    o.reservations.splice(i, 1);
    const row = G.db.find('stock_reservations', r => r.order_id === o.id && r.balance_id === balanceId && r.order_line_id === lineId && r.status === 'ACTIVE');
    if (row) Object.assign(row, { status: 'RELEASED', released_reason: reason, closed_at: now(), released_by: me() });
    const l = o.lines.find(x => x.id === lineId);
    o.stock_short = (o.stock_short || []).concat([{ variant_id: l ? l.variant_id : null, qty: rs.qty }]);
    G.db.touch(); G.audit('LIBERAR_RESERVA', 'sales_orders', o.id, `${o.number}: ${rs.qty} · ${reason}`);
    return rs;
  };
  /** venta del mostrador sobre el disponible (RN-ALM-09: lo reservado no se vende) */
  A.availableIn = (variant, wh, lot) => R(U.sum(G.db.where('stock_balances', b => b.variant_id === variant && b.warehouse_id === wh && (!lot || b.lot_id === lot)), b => b.qty - (b.reserved_qty || 0)), 3);
  A.counterSale = function ({ wh, variant, lot, qty, source }) {
    const w = whOf(wh); if (!w || !w.allows_sale) G.fail('RN-ALM-02', `${w ? w.name : 'El almacén'} no permite vender.`);
    const avail = A.availableIn(variant, wh, lot);
    const phys = R(U.sum(G.db.where('stock_balances', b => b.variant_id === variant && b.warehouse_id === wh && (!lot || b.lot_id === lot)), b => b.qty), 3);
    if (qty > avail + 0.0005) G.fail('RN-ALM-09', `Solo hay ${G.fmt.num(avail, 3)} disponibles de ${G.variantName(variant)} en ${w.name}: de ${G.fmt.num(phys, 3)} en saldo, ${G.fmt.num(phys - avail, 3)} están reservados para pedidos confirmados.`);
    return G.inv.move({ type: 'SALE', wh, variant, lot, qty, source: source || { type: 'COUNTER', id: null }, reason: 'Venta del mostrador' });
  };
  /** consume las reservas del pedido con salida SALE (al despachar) */
  A.consume = function (order, reason = 'Despacho del pedido') {
    if (order.stock_out_done) return [];
    const outs = [];
    for (const rs of (order.reservations || []).slice()) {
      const l = order.lines.find(x => x.id === rs.line_id); if (!l) continue;
      const v = G.variant(l.variant_id);
      const w = l.weighed_kg != null && l.qty ? R(l.weighed_kg * rs.qty / l.qty, 3) : (v.sale_mode === 'KG' ? rs.qty : null);
      const r = G.inv.move({ type: 'SALE', wh: rs.wh, variant: l.variant_id, lot: rs.lot_id, qty: rs.qty, weight: w, fromReserved: true, source: { type: 'SALES_ORDER', id: order.id }, reason: `${reason} ${order.number}`, allowUnreleased: false });
      outs.push({ wh: rs.wh, variant_id: l.variant_id, lot_id: rs.lot_id, qty: rs.qty, weight_kg: w, move_ids: r.moves.map(m => m.id) });
      if (!l.lot_id && rs.lot_id) l.lot_id = rs.lot_id;
    }
    order.stock_out = (order.stock_out || []).concat(outs); order.stock_out_done = true;
    order.reservations = []; A.syncReservations(order, 'CONSUMED', reason); G.db.touch();
    return outs;
  };
  /** reingreso de lo despachado (pedido no entregado o cancelado tras preparar) */
  A.returnOrderStock = function (order, reason) {
    const outs = order.stock_out || []; if (!outs.length) return [];
    const to = devWhFor(order.establishment_id); const moves = [];
    for (const s of outs) { const r = G.inv.move({ type: 'RETURN', wh: to, variant: s.variant_id, lot: s.lot_id, qty: s.qty, weight: s.weight_kg, source: { type: 'SALES_ORDER', id: order.id }, reason: `${reason} ${order.number}` }); moves.push(...r.moves); }
    order.stock_out = []; order.stock_out_done = false; G.db.touch();
    return moves;
  };

  /* ------------------------------------------------------------------
     Recepción con control de calidad mínimo (RN-ALM-05, RN-ALM-06)
     ------------------------------------------------------------------ */
  A.checkReceiptLine = function (l) {
    const v = G.variant(l.variant_id); if (!v) return 'RN-ALM-05: elige el producto de la línea.';
    const p = prodOf(v.id);
    if (!(Number(l.qty) > 0)) return 'RN-ALM-05: la cantidad debe ser mayor que cero.';
    if (!l.qc_result || l.qc_result === 'PENDING') return `RN-ALM-05: la línea de ${v.name} no está controlada (elige aprobada o rechazada).`;
    if (l.qc_result === 'FAIL') return l.qc_notes ? null : `RN-ALM-06: la línea rechazada de ${v.name} exige una nota con el motivo.`;
    const t = l.product_temp_c === '' || l.product_temp_c === null || l.product_temp_c === undefined ? null : Number(l.product_temp_c);
    if (p.storage === 'CHILLED') { const mx = G.param('alm_max_temp_chilled_c') ?? 4; if (t === null) return `RN-ALM-06: registra la temperatura de ${v.name} (refrigerado, máximo ${mx} °C).`; if (t > mx) return `RN-ALM-06: ${v.name} llegó a ${G.fmt.num(t, 1)} °C y el máximo para refrigerados es ${mx} °C: marca la línea como rechazada con nota.`; }
    if (p.storage === 'FROZEN') { const mx = G.param('alm_max_temp_frozen_c') ?? -18; if (t === null) return `RN-ALM-06: registra la temperatura de ${v.name} (congelado, máximo ${mx} °C).`; if (t > mx) return `RN-ALM-06: ${v.name} llegó a ${G.fmt.num(t, 1)} °C y el máximo para congelados es ${mx} °C: marca la línea como rechazada con nota.`; }
    if (l.appearance === 'REJECTED') return `RN-ALM-06: ${v.name} tiene aspecto rechazado: no se puede aprobar.`;
    if (v.sale_mode !== 'UNIT' && !(Number(l.weight_kg) > 0)) return `RN-ALM-05: registra el peso recibido de ${v.name}.`;
    return null;
  };
  A.createReceipt = function (d) {
    if (!G.can('alm.receipt.create')) G.fail('RN-ALM-05', `Tu rol (${G.roleName()}) no tiene el permiso alm.receipt.create.`);
    if (!d.warehouse_id) G.fail('RN-ALM-05', 'Elige el almacén de recepción.');
    if (!(d.lines || []).length) G.fail('RN-ALM-05', 'La recepción necesita al menos una línea.');
    const rc = ins('stock_receipts', { number: G.db.next('REC', 'REC-', 4), warehouse_id: d.warehouse_id, establishment_id: siteOfWh(d.warehouse_id), source_type: d.source_type || 'PURCHASE', supplier_id: d.supplier_id || (d.source_type === 'FARM' ? 'su-GRANJA' : null), supplier_doc: d.supplier_doc || null, received_at: d.received_at || now(), vehicle_temp_c: d.vehicle_temp_c === '' || d.vehicle_temp_c == null ? null : Number(d.vehicle_temp_c), status: 'DRAFT', received_by: me(), notes: d.notes || null });
    for (const l of d.lines) {
      const v = G.variant(l.variant_id); const p = prodOf(l.variant_id);
      ins('stock_receipt_lines', { receipt_id: rc.id, variant_id: l.variant_id, lot_id: null, qty: Number(l.qty), weight_kg: l.weight_kg ? Number(l.weight_kg) : (v && v.sale_mode === 'KG' ? Number(l.qty) : null), unit_cost: l.unit_cost != null && l.unit_cost !== '' ? Number(l.unit_cost) : (v ? v.std_cost : 0), production_date: l.production_date || G.date.today(), expiry_date: l.expiry_date || G.date.add(l.production_date || G.TODAY, p.shelf_life_days || 7), product_temp_c: l.product_temp_c === '' || l.product_temp_c == null ? null : Number(l.product_temp_c), appearance: l.appearance || 'OK', qc_result: l.qc_result || 'PENDING', qc_notes: l.qc_notes || null }, true);
    }
    return rc;
  };
  /** confirma: cada línea aprobada crea su lote en CUARENTENA y entra al stock (RN-ALM-05) */
  A.confirmReceipt = function (id) {
    const rc = G.db.get('stock_receipts', id); if (!rc) G.fail('RN-ALM-05', 'Recepción no encontrada.');
    if (rc.status !== 'DRAFT') G.fail('RN-ALM-05', `La recepción ${rc.number} ya está ${G.ui.statusLabel(rc.status).toLowerCase()}.`);
    if (!G.can('alm.receipt.create')) G.fail('RN-ALM-05', `Tu rol (${G.roleName()}) no tiene el permiso alm.receipt.create.`);
    G.period.assertOpen(String(rc.received_at).slice(0, 10));
    const lines = G.db.where('stock_receipt_lines', l => l.receipt_id === rc.id);
    for (const l of lines) { const e = A.checkReceiptLine(l); if (e) G.fail(e.slice(0, 9), e.slice(11)); }
    let n = 0;
    for (const l of lines) {
      if (l.qc_result !== 'PASS') continue;
      const v = G.variant(l.variant_id); const p = prodOf(l.variant_id);
      let lotId = null;
      if (p.requires_lot) {
        const pd = l.production_date || String(rc.received_at).slice(0, 10);
        const lot = ins('lots', { product_id: p.id, variant_id: v.id, code: `L${pd.slice(2, 4)}${pd.slice(5, 7)}${pd.slice(8, 10)}-R${U.pad(G.db.all('lots').length + 1, 3)}`, origin: rc.source_type === 'FARM' ? 'FARM' : rc.source_type === 'CUSTOMER_RETURN' ? 'RETURN' : rc.source_type === 'PRODUCTION' ? 'PRODUCTION' : 'PURCHASE', supplier_id: rc.supplier_id, production_date: pd, expiry_date: l.expiry_date, qc_status: 'QUARANTINE', unit_cost: l.unit_cost, received_weight_kg: l.weight_kg, receipt_id: rc.id, released_at: null, released_by: null, block_reason: null });
        ins('lot_status_changes', { lot_id: lot.id, from_status: 'NEW', to_status: 'QUARANTINE', reason: `Recepción ${rc.number} (${srcName(rc.source_type)})`, changed_at: now(), changed_by: me() }, true);
        lotId = lot.id; l.lot_id = lot.id;
      }
      G.inv.move({ type: 'RECEIPT', wh: rc.warehouse_id, variant: v.id, lot: lotId, qty: l.qty, weight: l.weight_kg, unitCost: l.unit_cost, source: { type: 'STOCK_RECEIPT', id: rc.id }, reason: `Recepción ${rc.number}`, allowUnreleased: true });
      n++;
    }
    G.db.update('stock_receipts', rc.id, { status: 'CONFIRMED', confirmed_at: now(), confirmed_by: me() });
    return { receipt: rc, lots: lines.filter(l => l.lot_id).map(l => l.lot_id), accepted: n };
  };
  A.voidReceipt = function (id, reason) {
    const rc = G.db.get('stock_receipts', id);
    if (rc.status !== 'DRAFT') G.fail('RN-ALM-05', 'Solo se anula una recepción en borrador; una confirmada se corrige con merma o reverso.');
    if (!reason) G.fail('RN-ALM-05', 'Anular exige motivo.');
    G.db.update('stock_receipts', id, { status: 'VOIDED', void_reason: reason });
  };

  /* ------------------------------------------------------------------
     Estado del lote (RN-ALM-07) · emite lot.released / lot.blocked / lot.recalled
     ------------------------------------------------------------------ */
  const LOT_FLOW = { QUARANTINE: ['RELEASED', 'BLOCKED', 'REJECTED'], RELEASED: ['BLOCKED', 'RECALLED'], BLOCKED: ['RELEASED', 'REJECTED', 'RECALLED'], REJECTED: [], RECALLED: [] };
  A.LOT_FLOW = LOT_FLOW;
  A.setLotStatus = function (lotId, to, reason, opts = {}) {
    const lot = lotOf(lotId); if (!lot) G.fail('RN-ALM-07', 'Lote no encontrado.');
    const from = lot.qc_status;
    if (!(LOT_FLOW[from] || []).includes(to)) G.fail('RN-ALM-07', `El lote ${lot.code} está ${G.ui.statusLabel(from).toLowerCase()}: no puede pasar a ${G.ui.statusLabel(to).toLowerCase()}${['REJECTED', 'RECALLED'].includes(from) ? ' (un lote rechazado o retirado ya no cambia)' : ''}.`);
    if (to === 'RELEASED' && !G.can('alm.lot.release')) G.fail('RN-ALM-07', `Tu rol (${G.roleName()}) no tiene el permiso alm.lot.release (D-ALM-01: en la fase 1 libera el almacenero responsable).`);
    if (to !== 'RELEASED' && !G.can('alm.lot.block')) G.fail('RN-ALM-07', `Tu rol (${G.roleName()}) no tiene el permiso alm.lot.block.`);
    if (to !== 'RELEASED' && !reason) G.fail('RN-ALM-07', `${G.ui.statusLabel(to)} un lote exige motivo.`);
    if (to === 'RELEASED' && daysLeft(lot) !== null && daysLeft(lot) < 0) G.fail('RN-ALM-04', `El lote ${lot.code} venció el ${G.fmt.date(lot.expiry_date)}: no se libera; regístralo como merma por vencido.`);
    const patch = { qc_status: to };
    if (to === 'RELEASED') Object.assign(patch, { released_at: now(), released_by: meName(), block_reason: null });
    else patch.block_reason = reason;
    G.db.update('lots', lot.id, patch);
    ins('lot_status_changes', { lot_id: lot.id, from_status: from, to_status: to, reason: reason || 'Liberación tras control de calidad', changed_at: now(), changed_by: me() }, true);
    // mover desde cuarentena al almacén de destino (mismo local, sin guía)
    if (to === 'RELEASED' && opts.moveTo) {
      for (const b of G.db.where('stock_balances', b => b.lot_id === lot.id && b.qty > 0 && (whOf(b.warehouse_id) || {}).wh_type === 'QUARANTINE')) {
        G.inv.transfer({ from: b.warehouse_id, to: opts.moveTo, variant: b.variant_id, lot: lot.id, qty: b.qty, weight: b.weight_kg || null, source: { type: 'LOT_RELEASE', id: lot.id }, reason: `Liberación del lote ${lot.code}` });
      }
    }
    // pedidos con reservas en un lote que deja de estar liberado: se vuelven a reservar por FEFO
    const rer = [];
    if (to !== 'RELEASED') for (const o of G.db.where('sales_orders', o => (o.reservations || []).some(r => r.lot_id === lot.id) && ['CONFIRMED', 'IN_PREPARATION'].includes(o.status))) { A.reserve(o); rer.push(o.number); }
    G.events.emit(to === 'RELEASED' ? 'lot.released' : to === 'RECALLED' ? 'lot.recalled' : 'lot.blocked', { lot_id: lot.id, code: lot.code, from, to, reason });
    return { lot, rereserved: rer };
  };

  /* ------------------------------------------------------------------
     Transferencias (RN-ALM-10, RN-ALM-11)
     ------------------------------------------------------------------ */
  A.createTransfer = function ({ from, to, lines, notes }) {
    if (!G.can('alm.transfer.create')) G.fail('RN-ALM-10', `Tu rol (${G.roleName()}) no tiene el permiso alm.transfer.create.`);
    if (!from || !to || from === to) G.fail('RN-ALM-10', 'Elige un almacén de origen y otro de destino.');
    if (!(lines || []).length) G.fail('RN-ALM-10', 'Agrega al menos una línea.');
    const fs = siteOfWh(from), ts = siteOfWh(to);
    const tr = ins('stock_transfers', { number: G.db.next('TRA', 'TR-', 4), from_warehouse_id: from, to_warehouse_id: to, from_site: fs, to_site: ts, establishment_id: fs, status: 'DRAFT', requires_guide: fs !== ts, guide_number: null, guide_series: null, notes: notes || null, requested_by: me(), requested_at: now() });
    for (const l of lines) {
      const v = G.variant(l.variant_id); if (!v) G.fail('RN-ALM-08', 'Producto no encontrado.');
      if (l.lot_id) { const lot = lotOf(l.lot_id); if (!lot || lot.variant_id !== v.id) G.fail('RN-ALM-08', `El lote ${lot ? lot.code : ''} no es de ${v.name}.`); }
      ins('stock_transfer_lines', { transfer_id: tr.id, variant_id: v.id, lot_id: l.lot_id || null, qty: Number(l.qty), weight_kg: l.weight_kg ? Number(l.weight_kg) : (v.sale_mode === 'KG' ? Number(l.qty) : v.nominal_weight_kg ? R(Number(l.qty) * v.nominal_weight_kg, 3) : null), received_qty: null, received_weight_kg: null, difference_reason: null, moved: [] }, true);
    }
    return tr;
  };
  /** guía de remisión (FAC si está; si no, número de la serie T001/T002) · motivo 04 traslado entre establecimientos */
  A.issueGuide = function (id) {
    const tr = G.db.get('stock_transfers', id);
    if (!tr.requires_guide) G.fail('RN-ALM-10', 'Entre ubicaciones del mismo local no se emite guía.');
    if (tr.guide_number) return tr.guide_number;
    if (tr.status !== 'DRAFT') G.fail('RN-ALM-10', 'La guía se emite antes del despacho.');
    let full = null;
    if (G.fac && typeof G.fac.issueTransferGuide === 'function') { try { const g = G.fac.issueTransferGuide({ transfer: tr, lines: G.db.where('stock_transfer_lines', l => l.transfer_id === tr.id), reason_code: '04' }); full = g && (g.full_number || g.full); } catch (e) { if (e instanceof G.RuleError) throw e; } }
    if (!full) { const s = G.series.next(tr.from_site === 'es-L2' ? 'T002' : 'T001'); full = s.full; }
    G.db.update('stock_transfers', tr.id, { guide_number: full, guide_series: full.slice(0, 4), guide_reason_code: '04', guide_issued_at: now() });
    G.events.emit('guide.issued', { transfer_id: tr.id, full_number: full, reason_code: '04', source: 'ALM' });
    return full;
  };
  A.dispatchTransfer = function (id) {
    const tr = G.db.get('stock_transfers', id);
    if (!G.can('alm.transfer.create')) G.fail('RN-ALM-10', `Tu rol (${G.roleName()}) no tiene el permiso alm.transfer.create.`);
    if (tr.status !== 'DRAFT') G.fail('RN-ALM-10', `La transferencia ${tr.number} ya fue despachada.`);
    if (tr.requires_guide && !tr.guide_number) G.fail('RN-ALM-10', `${tr.number} va de ${G.siteName(tr.from_site)} a ${G.siteName(tr.to_site)}: emite la guía de remisión (motivo 04, traslado entre establecimientos) antes de despachar.`);
    const lines = G.db.where('stock_transfer_lines', l => l.transfer_id === tr.id);
    const dest = tr.requires_guide ? transitWh().id : tr.to_warehouse_id;
    for (const l of lines) {
      const out = G.inv.move({ type: 'TRANSFER_OUT', wh: tr.from_warehouse_id, variant: l.variant_id, lot: l.lot_id, qty: l.qty, weight: l.weight_kg, source: { type: 'STOCK_TRANSFER', id: tr.id }, reason: `Traslado ${tr.number}${tr.guide_number ? ' · GRE ' + tr.guide_number : ''}` });
      l.moved = [];
      for (const m of out.moves) {
        G.inv.move({ type: 'TRANSFER_IN', wh: dest, variant: l.variant_id, lot: m.lot_id, qty: Math.abs(m.qty), weight: m.weight_kg != null ? Math.abs(m.weight_kg) : null, unitCost: m.unit_cost, source: { type: 'STOCK_TRANSFER', id: tr.id }, reason: `Traslado ${tr.number}`, allowUnreleased: true });
        l.moved.push({ lot_id: m.lot_id, qty: Math.abs(m.qty), weight_kg: m.weight_kg != null ? Math.abs(m.weight_kg) : null, unit_cost: m.unit_cost });
      }
    }
    const st = tr.requires_guide ? 'DISPATCHED' : 'RECEIVED';
    G.db.update('stock_transfers', tr.id, { status: st, dispatched_at: now(), dispatched_by: me(), received_at: tr.requires_guide ? null : now() });
    if (!tr.requires_guide) for (const l of lines) { l.received_qty = l.qty; l.received_weight_kg = l.weight_kg; }
    return tr;
  };
  /** recibe lo llegado por línea; la diferencia exige motivo y queda como merma (RN-ALM-11) */
  A.receiveTransfer = function (id, recv = []) {
    const tr = G.db.get('stock_transfers', id);
    if (!G.can('alm.transfer.receive')) G.fail('RN-ALM-11', `Tu rol (${G.roleName()}) no tiene el permiso alm.transfer.receive.`);
    if (tr.status !== 'DISPATCHED') G.fail('RN-ALM-11', `La transferencia ${tr.number} no está en tránsito.`);
    const lines = G.db.where('stock_transfer_lines', l => l.transfer_id === tr.id);
    const tw = transitWh().id; let diff = false;
    for (const l of lines) {
      const r = recv.find(x => x.line_id === l.id) || { received_qty: l.qty };
      const got = Number(r.received_qty);
      if (!(got >= 0)) G.fail('RN-ALM-11', 'Registra la cantidad recibida de cada línea.');
      if (Math.abs(got - l.qty) > 0.0005 && !r.difference_reason) G.fail('RN-ALM-11', `${G.variantName(l.variant_id)}: se enviaron ${G.fmt.num(l.qty, 3)} y llegaron ${G.fmt.num(got, 3)}. Registra el motivo de la diferencia.`);
      if (got > l.qty + 0.0005) G.fail('RN-ALM-11', `${G.variantName(l.variant_id)}: no se recibe más de lo enviado (${G.fmt.num(l.qty, 3)}).`);
      let left = got;
      for (const part of l.moved || []) {
        const take = Math.min(left, part.qty); const lost = R(part.qty - take, 3);
        const wTake = part.weight_kg != null ? R(part.weight_kg * take / part.qty, 3) : null;
        if (take > 0.0005) G.inv.transfer({ from: tw, to: tr.to_warehouse_id, variant: l.variant_id, lot: part.lot_id, qty: take, weight: wTake, source: { type: 'STOCK_TRANSFER', id: tr.id }, reason: `Recepción ${tr.number}` });
        if (lost > 0.0005) {
          const wl = part.weight_kg != null ? R(part.weight_kg - (wTake || 0), 3) : null;
          const mv = G.inv.move({ type: 'WASTE', wh: tw, variant: l.variant_id, lot: part.lot_id, qty: lost, weight: wl, source: { type: 'STOCK_TRANSFER', id: tr.id }, reason: `Diferencia en traslado ${tr.number}: ${r.difference_reason}`, allowUnreleased: true });
          const reason = G.db.find('waste_reasons', x => x.code === 'TRAN');
          ins('stock_waste_records', { number: G.db.next('MER', 'MER-', 4), warehouse_id: tw, establishment_id: tr.to_site, variant_id: l.variant_id, lot_id: part.lot_id, reason_id: reason ? reason.id : null, qty: lost, weight_kg: wl, estimated_cost: R(mv.total_cost), photo_url: null, notes: `Diferencia de la transferencia ${tr.number}: ${r.difference_reason}`, status: 'APPROVED', approved_by: me(), approved_at: now(), requested_by: me(), requested_at: now(), source_transfer_id: tr.id }, true);
          diff = true;
        }
        left = R(left - take, 3);
      }
      l.received_qty = got; l.received_weight_kg = r.received_weight_kg != null && r.received_weight_kg !== '' ? Number(r.received_weight_kg) : (l.weight_kg && l.qty ? R(l.weight_kg * got / l.qty, 3) : null); l.difference_reason = r.difference_reason || null;
    }
    G.db.update('stock_transfers', tr.id, { status: diff ? 'RECEIVED_WITH_DIFF' : 'RECEIVED', received_at: now(), received_by: me() });
    return tr;
  };
  A.cancelTransfer = function (id, reason) {
    const tr = G.db.get('stock_transfers', id);
    if (tr.status !== 'DRAFT') G.fail('RN-ALM-10', 'Solo se cancela una transferencia sin despachar.');
    if (!reason) G.fail('RN-ALM-10', 'Cancelar exige motivo.');
    G.db.update('stock_transfers', id, { status: 'CANCELLED', notes: (tr.notes ? tr.notes + ' · ' : '') + 'Cancelada: ' + reason });
  };

  /* ------------------------------------------------------------------
     Conteos ciegos (RN-ALM-12)
     ------------------------------------------------------------------ */
  A.createCount = function ({ warehouse_id, count_type = 'CYCLE', blind = true, variant_ids, notes }) {
    const w = whOf(warehouse_id); if (!w) G.fail('RN-ALM-12', 'Elige el almacén a contar.');
    const bals = G.db.where('stock_balances', b => b.warehouse_id === warehouse_id && Math.abs(b.qty) > 0.0005 && (!variant_ids || !variant_ids.length || variant_ids.includes(b.variant_id)));
    if (!bals.length) G.fail('RN-ALM-12', `${w.name} no tiene saldos para contar.`);
    const c = ins('stock_counts', { number: G.db.next('CNT', 'CNT-', 4), warehouse_id, establishment_id: w.establishment_id, count_type, status: 'OPEN', blind: !!blind, counted_at: null, counted_by: null, approved_by: null, created_by: me(), notes: notes || null });
    for (const b of bals) ins('stock_count_lines', { count_id: c.id, variant_id: b.variant_id, lot_id: b.lot_id, system_qty: b.qty, counted_qty: null, system_weight_kg: b.weight_kg || null, counted_weight_kg: null }, true);
    return c;
  };
  A.setCounted = function (lineId, qty, weight) {
    const l = G.db.get('stock_count_lines', lineId); const c = G.db.get('stock_counts', l.count_id);
    if (c.status !== 'OPEN') G.fail('RN-ALM-12', `El conteo ${c.number} ya no está abierto.`);
    l.counted_qty = qty === '' || qty === null ? null : Number(qty); if (weight !== undefined) l.counted_weight_kg = weight === '' || weight === null ? null : Number(weight);
    l.counted_by = me(); G.db.touch();
  };
  A.closeCount = function (id) {
    const c = G.db.get('stock_counts', id);
    if (c.status !== 'OPEN') G.fail('RN-ALM-12', `El conteo ${c.number} ya está ${G.ui.statusLabel(c.status).toLowerCase()}.`);
    const miss = G.db.where('stock_count_lines', l => l.count_id === id && (l.counted_qty === null || l.counted_qty === undefined));
    if (miss.length) G.fail('RN-ALM-12', `Faltan ${miss.length} línea(s) por contar; si no hay producto, registra 0.`);
    G.db.update('stock_counts', id, { status: 'COUNTED', counted_at: now(), counted_by: me() });
    return c;
  };
  A.approveCount = function (id) {
    const c = G.db.get('stock_counts', id);
    if (c.status !== 'COUNTED') G.fail('RN-ALM-12', `El conteo ${c.number} debe estar contado y cerrado para aprobarse.`);
    if (c.counted_by && c.counted_by === me()) G.fail('RN-ALM-12', `Aprueba una persona distinta de quien contó (${G.userName(c.counted_by)}).`);
    if (!G.can('alm.count.approve')) G.fail('RN-ALM-12', `Tu rol (${G.roleName()}) no tiene el permiso alm.count.approve.`);
    const adj = [];
    for (const l of G.db.where('stock_count_lines', l => l.count_id === id)) {
      const d = R(l.counted_qty - l.system_qty, 3); l.diff_qty = d;
      if (Math.abs(d) < 0.0005) continue;
      const wd = l.counted_weight_kg != null && l.system_weight_kg != null ? R(l.counted_weight_kg - l.system_weight_kg, 3) : null;
      const r = G.inv.move({ type: 'ADJUSTMENT', wh: c.warehouse_id, variant: l.variant_id, lot: l.lot_id, qty: d, weight: wd, source: { type: 'STOCK_COUNT', id: c.id }, reason: `Ajuste del conteo ${c.number}`, allowUnreleased: true });
      l.adjust_move_id = r.moves[0] && r.moves[0].id; adj.push({ line: l, qty: d, cost: r.total_cost });
    }
    G.db.update('stock_counts', id, { status: 'APPROVED', approved_by: me(), approved_at: now() });
    return adj;
  };

  /* ------------------------------------------------------------------
     Mermas (RN-ALM-13, RN-ALM-14)
     ------------------------------------------------------------------ */
  A.wasteCost = (wh, variant, lot, qty) => { const b = G.inv._bal(wh, variant, lot); const unit = b && b.avg_cost ? b.avg_cost : G.inv.avg(variant, wh); return R(Number(qty || 0) * unit); };
  A.createWaste = function (d) {
    const reason = G.db.get('waste_reasons', d.reason_id); if (!reason) G.fail('RN-ALM-13', 'Elige el motivo de la merma.');
    const v = G.variant(d.variant_id); if (!v) G.fail('RN-ALM-13', 'Elige el producto.');
    const p = prodOf(v.id);
    if (p.requires_lot && !d.lot_id) G.fail('RN-ALM-08', `${v.name} se controla por lote: indica el lote.`);
    if (d.lot_id && lotOf(d.lot_id).variant_id !== v.id) G.fail('RN-ALM-08', 'El lote no es de ese producto.');
    if (!(Number(d.qty) > 0)) G.fail('RN-ALM-13', 'La cantidad debe ser mayor que cero.');
    if (reason.requires_photo && !d.photo_url) G.fail('RN-ALM-14', `El motivo «${reason.name}» exige foto: adjúntala antes de registrar.`);
    const bal = G.inv._bal(d.warehouse_id, v.id, d.lot_id || null);
    if (!bal || bal.qty + 0.0005 < Number(d.qty)) G.fail('RN-ALM-03', `En ${G.whName(d.warehouse_id)} hay ${G.fmt.num(bal ? bal.qty : 0, 3)} de ${v.name}${d.lot_id ? ' (lote ' + lotOf(d.lot_id).code + ')' : ''}: no se puede mermar ${d.qty}.`);
    return ins('stock_waste_records', { number: G.db.next('MER', 'MER-', 4), warehouse_id: d.warehouse_id, establishment_id: siteOfWh(d.warehouse_id), variant_id: v.id, lot_id: d.lot_id || null, reason_id: reason.id, qty: Number(d.qty), weight_kg: d.weight_kg ? Number(d.weight_kg) : (v.sale_mode === 'KG' ? Number(d.qty) : null), estimated_cost: A.wasteCost(d.warehouse_id, v.id, d.lot_id || null, d.qty), photo_url: d.photo_url || null, notes: d.notes || null, status: 'PENDING', approved_by: null, requested_by: me(), requested_at: now() });
  };
  A.wasteNeedsOther = w => { const r = G.db.get('waste_reasons', w.reason_id) || {}; return (w.estimated_cost || 0) > (r.approval_above_pen ?? 100); };
  A.approveWaste = function (id) {
    const w = G.db.get('stock_waste_records', id);
    if (w.status !== 'PENDING') G.fail('RN-ALM-13', `La merma ${w.number} ya está ${G.ui.statusLabel(w.status).toLowerCase()}.`);
    const r = G.db.get('waste_reasons', w.reason_id) || {};
    if (A.wasteNeedsOther(w)) {
      if (w.requested_by === me()) G.fail('RN-ALM-13', `La merma ${w.number} cuesta ${G.fmt.money(w.estimated_cost)} y supera el umbral del motivo (${G.fmt.money(r.approval_above_pen ?? 100)}): la aprueba otra persona.`);
      if (!G.can('alm.waste.approve')) G.fail('RN-ALM-13', `La merma supera el umbral de ${G.fmt.money(r.approval_above_pen ?? 100)}: se necesita el permiso alm.waste.approve.`);
    } else if (!G.canDo('ALM', 'E')) G.fail('RN-ALM-13', `Tu rol (${G.roleName()}) no puede aprobar mermas.`);
    const mv = G.inv.move({ type: 'WASTE', wh: w.warehouse_id, variant: w.variant_id, lot: w.lot_id, qty: w.qty, weight: w.weight_kg, source: { type: 'STOCK_WASTE', id: w.id }, reason: `Merma ${w.number}: ${r.name}`, allowUnreleased: true });
    G.db.update('stock_waste_records', id, { status: 'APPROVED', approved_by: me(), approved_at: now(), actual_cost: R(mv.total_cost), move_id: mv.moves[0] && mv.moves[0].id });
    return w;
  };
  A.rejectWaste = function (id, reason) {
    const w = G.db.get('stock_waste_records', id);
    if (w.status !== 'PENDING') G.fail('RN-ALM-13', 'Solo se rechaza una merma pendiente.');
    if (!reason) G.fail('RN-ALM-13', 'Rechazar exige motivo.');
    G.db.update('stock_waste_records', id, { status: 'REJECTED', approved_by: me(), approved_at: now(), reject_reason: reason });
  };

  /* ------------------------------------------------------------------
     Temperatura de cámaras y alertas de vencimiento (RN-ALM-15)
     ------------------------------------------------------------------ */
  A.tempOut = (w, t) => t !== null && t !== undefined && ((w.max_temp_c !== null && w.max_temp_c !== undefined && t > w.max_temp_c) || (w.min_temp_c !== null && w.min_temp_c !== undefined && t < w.min_temp_c - 4));
  A.addTemp = function (whId, temp, source = 'MANUAL', at) {
    const w = whOf(whId); if (!w) G.fail('RN-ALM-01', 'Almacén no encontrado.');
    if (temp === '' || temp === null || isNaN(Number(temp))) G.fail('RN-ALM-06', 'Registra la temperatura en °C.');
    const out = A.tempOut(w, Number(temp));
    const r = ins('warehouse_temp_readings', { warehouse_id: whId, establishment_id: w.establishment_id, temp_c: Number(temp), read_at: at || now(), source, user: meName(), out_of_range: out }, true);
    if (out && !G._seeding) { G.notify({ role: 'ALMACENERO', title: `Temperatura fuera de rango en ${w.name}`, body: `${G.fmt.num(temp, 1)} °C (rango ${w.min_temp_c} a ${w.max_temp_c} °C). Revisa la cámara y los lotes.`, tone: 'bad', module: 'ALM', ref: whId }); }
    return r;
  };
  A.lastTemp = whId => G.db.where('warehouse_temp_readings', r => r.warehouse_id === whId).sort(U.by('read_at', -1))[0] || null;
  A.lotStock = lotId => G.db.where('stock_balances', b => b.lot_id === lotId);
  /** lotes con stock que vencen en ≤ N días (RN-ALM-15): bucket EXPIRED, D3, D7 */
  A.expiring = function (days = G.param('alm_expiry_alert_days') ?? 7) {
    const byLot = U.groupBy(G.db.where('stock_balances', b => b.lot_id && b.qty > 0.0005), 'lot_id');
    const out = [];
    for (const [lid, bs] of Object.entries(byLot)) {
      const lot = lotOf(lid); if (!lot || !lot.expiry_date || ['REJECTED', 'RECALLED'].includes(lot.qc_status)) continue;
      const d = daysLeft(lot); if (d > days) continue;
      const v = G.variant(lot.variant_id) || {};
      const qty = R(U.sum(bs, b => b.qty), 3); const value = R(U.sum(bs, b => b.qty * (b.avg_cost || 0)));
      const reserved = R(U.sum(bs, b => b.reserved_qty || 0), 3);
      out.push({ id: lid, lot, variant: v, brand_id: v.brand_id, establishment_id: siteOfWh(bs[0].warehouse_id), days: d, bucket: d < 0 ? 'EXPIRED' : d <= 3 ? 'D3' : 'D7', qty, reserved, value, whs: bs.map(b => b.warehouse_id), action: d < 0 ? 'Merma por vencido' : d <= 1 ? 'Vender hoy o promoción' : d <= 3 ? 'Promoción y vender primero' : 'Vender primero (FEFO)' });
    }
    return out.sort((a, b) => a.days - b.days);
  };
  A.inventoryValue = (pred = () => true) => R(U.sum(G.db.where('stock_balances', b => b.qty > 0 && pred(b)), b => b.qty * (b.avg_cost || 0)));

  /* ------------------------------------------------------------------
     Eventos que consume ALM
     ------------------------------------------------------------------ */
  G.events.on('order.confirmed', p => {
    // la reserva se hace después de los demás suscriptores: si PED ya reservó, solo se registra
    Promise.resolve().then(() => {
      const o = G.db.get('sales_orders', p.order_id); if (!o || o.status === 'CANCELLED') return;
      if (G.param('alm_reserve_on_confirm') === false) return;
      if (!(o.reservations || []).length) A.reserve(o); else A.syncReservations(o);
    });
  });
  G.events.on('order.cancelled', p => {
    const o = G.db.get('sales_orders', p.order_id); if (!o) return;
    A.syncReservations(o, 'RELEASED', 'Pedido cancelado');
    if ((o.stock_out || []).length) A.returnOrderStock(o, 'Pedido cancelado');
  });
  G.events.on('order.dispatched', p => { const o = G.db.get('sales_orders', p.order_id); if (o && (o.reservations || []).length && !o.stock_out_done) A.consume(o, 'Despacho del pedido'); });
  G.events.on('order.not_delivered', p => { const o = G.db.get('sales_orders', p.order_id); if (o) A.returnOrderStock(o, 'Bolsas devueltas del pedido no entregado'); });

  /* ------------------------------------------------------------------
     Datos de ejemplo (orden 26)
     ------------------------------------------------------------------ */
  G.seed(26, function seedALM() {
    const r = U.rng(2626);
    const s = (t, row) => G.db.insert(t, row, { silent: true });
    // jerarquía y almacenes adicionales (A(): parent_id, vehicle_id)
    const parent = { 'wh-CAM-L1': 'wh-ALM-L1', 'wh-CNG-L1': 'wh-ALM-L1', 'wh-MOS-L1': 'wh-ALM-L1', 'wh-CUA-L1': 'wh-ALM-L1', 'wh-DEV-L1': 'wh-ALM-L1', 'wh-CAM-L2': 'wh-ALM-L2', 'wh-CNG-L2': 'wh-ALM-L2', 'wh-PRD-L2': 'wh-ALM-L2' };
    for (const w of G.db.all('warehouses')) { w.parent_id = parent[w.id] || null; w.vehicle_id = null; }
    s('warehouses', { id: 'wh-TRA', establishment_id: null, code: 'TRA', name: 'Tránsito entre locales', wh_type: 'TRANSIT', min_temp_c: 0, max_temp_c: 4, status: 'ACTIVE', allows_sale: false, pick_priority: 999, parent_id: null, vehicle_id: null });
    for (const v of G.db.where('vehicles', v => v.ownership === 'OWN')) s('warehouses', { id: 'wh-VEH-' + v.plate, establishment_id: v.establishment_id, code: 'VEH-' + v.plate, name: `Vehículo ${v.plate} (${v.vehicle_type === 'VAN' ? 'furgoneta refrigerada' : 'moto'})`, wh_type: 'VEHICLE', min_temp_c: v.refrigerated ? 0 : null, max_temp_c: v.refrigerated ? 4 : null, status: 'ACTIVE', allows_sale: false, pick_priority: 999, parent_id: null, vehicle_id: v.id });
    // motivos de merma (D-ALM-04: umbral S/ 100)
    [['VENC', 'Vencido', false, 100, true], ['FRIO', 'Cadena de frío', true, 100, false], ['DANO', 'Daño de empaque o producto', true, 100, false], ['DEVO', 'Devolución no apta', false, 100, false], ['MUES', 'Muestra o degustación', false, 50, false], ['DESH', 'Deshidratación (merma natural)', false, 150, false], ['CORT', 'Merma de corte', false, 100, false], ['TRAN', 'Diferencia en traslado', false, 100, false]]
      .forEach(([code, name, photo, above, exp]) => s('waste_reasons', { id: 'wr-' + code, code, name, requires_photo: photo, approval_above_pen: above, counts_as_expired: exp, status: 'ACTIVE' }));
    // historial de lotes existentes
    for (const lot of G.db.all('lots')) {
      s('lot_status_changes', { lot_id: lot.id, from_status: 'NEW', to_status: 'QUARANTINE', reason: lot.origin === 'FARM' ? 'Recepción de la granja' : lot.origin === 'PURCHASE' ? 'Recepción de compra' : 'Ingreso de producción', changed_at: (lot.production_date || G.TODAY) + 'T15:00', changed_by: 'us-mtorres' });
      if (lot.released_at) s('lot_status_changes', { lot_id: lot.id, from_status: 'QUARANTINE', to_status: 'RELEASED', reason: 'Control de calidad conforme', changed_at: lot.released_at, changed_by: 'us-sramos' });
      if (lot.id === 'lo-B001') { s('lot_status_changes', { lot_id: lot.id, from_status: 'QUARANTINE', to_status: 'RELEASED', reason: 'Control de calidad conforme', changed_at: '2026-10-06T16:00', changed_by: 'us-sramos' }); s('lot_status_changes', { lot_id: lot.id, from_status: 'RELEASED', to_status: 'BLOCKED', reason: lot.block_reason, changed_at: '2026-10-07T08:20', changed_by: 'us-mtorres' }); }
    }
    // un lote vencido con stock (para ALM-11 y la merma por vencido)
    const vh = G.variant('va-M3-HUA-500');
    const lv = s('lots', { id: 'lo-V001', product_id: vh.product_id, variant_id: vh.id, code: 'L260917-H03', origin: 'PRODUCTION', production_date: '2026-09-17', expiry_date: '2026-10-08', qc_status: 'RELEASED', unit_cost: 7.6, released_at: '2026-09-17T17:00', released_by: 'Silvia Ramos Tello' });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-CAM-L1', variant: vh.id, lot: lv.id, qty: 4, unitCost: 7.6, source: { type: 'PRODUCTION', id: 'OP01-0028' }, at: '2026-09-17T17:30', reason: 'Producción' });
    s('lot_status_changes', { lot_id: lv.id, from_status: 'NEW', to_status: 'QUARANTINE', reason: 'Ingreso de producción', changed_at: '2026-09-17T15:00', changed_by: 'us-mtorres' });
    s('lot_status_changes', { lot_id: lv.id, from_status: 'QUARANTINE', to_status: 'RELEASED', reason: 'Control de calidad conforme', changed_at: '2026-09-17T17:00', changed_by: 'us-sramos' });
    // recepciones
    const rec =(num, wh, src, sup, doc, at, vt, st, lines) => {
      const rc = s('stock_receipts', { number: num, warehouse_id: wh, establishment_id: siteOfWh(wh), source_type: src, supplier_id: sup, supplier_doc: doc, received_at: at, vehicle_temp_c: vt, status: st, received_by: siteOfWh(wh) === 'es-L2' ? 'us-irojas' : 'us-mtorres', confirmed_at: st === 'CONFIRMED' ? at : null, confirmed_by: st === 'CONFIRMED' ? 'us-mtorres' : null });
      for (const l of lines) s('stock_receipt_lines', Object.assign({ receipt_id: rc.id, lot_id: null, weight_kg: null, unit_cost: (G.variant(l.variant_id) || {}).std_cost, expiry_date: null, product_temp_c: null, appearance: 'OK', qc_result: 'PASS', qc_notes: null }, l));
      return rc;
    };
    G.db.seq['DG:REC'] = 0;
    const nxt = (k, p) => G.db.next(k, p, 4);
    const avicola = 'su-' + U.rucCheck('2060233817').slice(-8), porc = 'su-' + U.rucCheck('2051290011').slice(-8);
    const pol = G.db.find('lots', l => l.variant_id === 'va-DG-POL-ENT');
    rec(nxt('REC', 'REC-'), 'wh-CAM-L1', 'PURCHASE', avicola, 'F001-00018231', '2026-10-05T07:40', 3.1, 'CONFIRMED', [{ variant_id: 'va-DG-POL-ENT', lot_id: pol && pol.id, qty: 24, weight_kg: 52.8, expiry_date: pol && pol.expiry_date, product_temp_c: 2.8, appearance: 'OK', qc_result: 'PASS' }, { variant_id: 'va-DG-POL-PEC', qty: 8, weight_kg: 8, product_temp_c: 6.4, appearance: 'OBSERVED', qc_result: 'FAIL', qc_notes: 'Llegó a 6,4 °C (máx. 4 °C). Se devolvió al proveedor.' }]);
    rec(nxt('REC', 'REC-'), 'wh-CAM-L1', 'PURCHASE', 'su-' + U.rucCheck('2048871205').slice(-8), 'F002-00004410', '2026-10-07T08:10', 2.5, 'CONFIRMED', [{ variant_id: 'va-DG-COR-PIE', qty: 18, weight_kg: 18, product_temp_c: 2.1, appearance: 'OBSERVED', qc_result: 'PASS', qc_notes: 'Empaque con leve escarcha; producto conforme' }]);
    rec(nxt('REC', 'REC-'), 'wh-CUA-L1', 'FARM', 'su-GRANJA', 'GRJ-REC-0012', G.TODAY + 'T07:10', 3.2, 'CONFIRMED', [{ variant_id: 'va-DG-CUY-ENT', lot_id: 'lo-Q001', qty: 40, weight_kg: 36.4, expiry_date: G.date.add(G.TODAY, 7), product_temp_c: 3.5, appearance: 'OK', qc_result: 'PASS', unit_cost: 26.5 }]);
    G.db.get('lots', 'lo-Q001').receipt_id = G.db.find('stock_receipts', x => x.supplier_doc === 'GRJ-REC-0012').id;
    G.db.get('lots', 'lo-Q001').received_weight_kg = 36.4;
    rec(nxt('REC', 'REC-'), 'wh-CAM-L2', 'PURCHASE', porc, 'F001-00007720', G.TODAY + 'T08:30', 3.8, 'DRAFT', [{ variant_id: 'va-MP-CER-MR', qty: 64, weight_kg: 64, expiry_date: G.date.add(G.TODAY, 5), product_temp_c: 3.6, appearance: 'OK', qc_result: 'PENDING' }]);
    rec(nxt('REC', 'REC-'), 'wh-ALM-L1', 'PURCHASE', 'su-' + U.rucCheck('2050011873').slice(-8), 'F001-00031200', '2026-10-02T10:00', null, 'CONFIRMED', [{ variant_id: 'va-EM-BOL-NUM', qty: 500, product_temp_c: null, appearance: 'OK', qc_result: 'PASS', unit_cost: 0.6 }]);
    // transferencias L1 → L2 para los pedidos del Local 2 (con GRE T001) y otra en tránsito
    G.db.seq['DG:TRA'] = 0;
    const l2need = {};
    for (const o of G.db.where('sales_orders', o => o.establishment_id === 'es-L2' && ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY'].includes(o.status))) for (const l of o.lines) l2need[l.variant_id] = (l2need[l.variant_id] || 0) + l.qty;
    const dstFor = vid => { const st = prodOf(vid).storage; return st === 'FROZEN' ? 'wh-CNG-L2' : st === 'CHILLED' ? 'wh-CAM-L2' : 'wh-ALM-L2'; };
    const mkTr = (at, to, items, status, guide) => {
      const tr = s('stock_transfers', { number: nxt('TRA', 'TR-'), from_warehouse_id: 'wh-CAM-L1', to_warehouse_id: to, from_site: 'es-L1', to_site: 'es-L2', establishment_id: 'es-L1', status: 'DRAFT', requires_guide: true, guide_number: null, notes: 'Reposición del Local 2', requested_by: 'us-mtorres', requested_at: at });
      for (const [vid, q] of items) { const v = G.variant(vid); s('stock_transfer_lines', { transfer_id: tr.id, variant_id: vid, lot_id: null, qty: q, weight_kg: v.sale_mode === 'KG' ? q : v.nominal_weight_kg ? R(q * v.nominal_weight_kg, 3) : null, received_qty: null, received_weight_kg: null, difference_reason: null, moved: [] }); }
      if (guide) { const g = G.series.next('T001'); Object.assign(tr, { guide_number: g.full, guide_series: 'T001', guide_reason_code: '04', guide_issued_at: at }); }
      return tr;
    };
    const fromWh = vid => { const st = prodOf(vid).storage; return st === 'FROZEN' ? 'wh-CNG-L1' : st === 'CHILLED' ? 'wh-CAM-L1' : 'wh-ALM-L1'; };
    const doTr = (tr, receive, at, diff) => {
      for (const l of G.db.where('stock_transfer_lines', x => x.transfer_id === tr.id)) {
        const src = fromWh(l.variant_id); tr.from_warehouse_id = src;
        const avail = G.inv.qty(l.variant_id, src, { available: true, releasedOnly: true });
        if (avail < l.qty) l.qty = Math.max(1, Math.floor(avail * 0.5));
        const out = G.inv.move({ type: 'TRANSFER_OUT', wh: src, variant: l.variant_id, qty: l.qty, weight: l.weight_kg, source: { type: 'STOCK_TRANSFER', id: tr.id }, reason: `Traslado ${tr.number} · GRE ${tr.guide_number}`, at });
        l.moved = [];
        for (const m of out.moves) { G.inv.move({ type: 'TRANSFER_IN', wh: 'wh-TRA', variant: l.variant_id, lot: m.lot_id, qty: Math.abs(m.qty), weight: m.weight_kg != null ? Math.abs(m.weight_kg) : null, unitCost: m.unit_cost, source: { type: 'STOCK_TRANSFER', id: tr.id }, reason: `Traslado ${tr.number}`, at, allowUnreleased: true }); l.moved.push({ lot_id: m.lot_id, qty: Math.abs(m.qty), weight_kg: m.weight_kg != null ? Math.abs(m.weight_kg) : null }); }
        if (receive) {
          for (const part of l.moved) G.inv.transfer({ from: 'wh-TRA', to: dstFor(l.variant_id), variant: l.variant_id, lot: part.lot_id, qty: part.qty, weight: part.weight_kg, source: { type: 'STOCK_TRANSFER', id: tr.id }, reason: `Recepción ${tr.number}`, at: G.date.add(at.slice(0, 10), 0) + 'T' + String(Number(at.slice(11, 13)) + 2).padStart(2, '0') + at.slice(13) });
          l.received_qty = l.qty; l.received_weight_kg = l.weight_kg;
        }
      }
      Object.assign(tr, { status: receive ? (diff ? 'RECEIVED_WITH_DIFF' : 'RECEIVED') : 'DISPATCHED', dispatched_at: at, dispatched_by: 'us-mtorres', received_at: receive ? at.slice(0, 11) + String(Number(at.slice(11, 13)) + 2).padStart(2, '0') + at.slice(13) : null, received_by: receive ? 'us-irojas' : null });
    };
    const items = Object.entries(l2need).map(([vid, q]) => [vid, Math.max(Math.ceil(q * 2), prodOf(vid).storage === 'AMBIENT' ? 6 : 6)]).filter(([vid]) => G.inv.qty(vid, fromWh(vid), { available: true, releasedOnly: true }) > 2);
    // separar por destino (una guía por traslado)
    const byDst = U.groupBy(items, ([vid]) => dstFor(vid));
    for (const [dst, its] of Object.entries(byDst)) { const tr = mkTr('2026-10-10T05:30', dst, its, 'DRAFT', true); tr.to_warehouse_id = dst; doTr(tr, true, '2026-10-10T05:40'); }
    const t2 = mkTr('2026-10-09T15:00', 'wh-CAM-L2', [['va-DG-CON-ENT', 8], ['va-DG-POL-ENT', 6], ['va-DG-PAT-ENT', 4]], 'DRAFT', true); doTr(t2, true, '2026-10-09T15:10');
    const t3 = mkTr(G.TODAY + 'T09:20', 'wh-CAM-L2', [['va-DG-CUY-ENT', 10], ['va-M3-CHO-500', 12]], 'DRAFT', true); doTr(t3, false, G.TODAY + 'T09:30');
    mkTr(G.TODAY + 'T10:05', 'wh-CNG-L2', [['va-DG-CAL-1L', 20]], 'DRAFT', false);
    const t5 = s('stock_transfers', { number: nxt('TRA', 'TR-'), from_warehouse_id: 'wh-CAM-L1', to_warehouse_id: 'wh-MOS-L1', from_site: 'es-L1', to_site: 'es-L1', establishment_id: 'es-L1', status: 'DRAFT', requires_guide: false, notes: 'Reponer exhibidora del mostrador', requested_by: 'us-mtorres', requested_at: G.TODAY + 'T07:30' });
    for (const [vid, q] of [['va-DG-CUY-ENT', 6], ['va-DG-CHO-500', 8]]) { const v = G.variant(vid); s('stock_transfer_lines', { transfer_id: t5.id, variant_id: vid, lot_id: null, qty: q, weight_kg: v.nominal_weight_kg ? R(q * v.nominal_weight_kg, 3) : null, moved: [] }); }
    G.inv.transfer({ from: 'wh-CAM-L1', to: 'wh-MOS-L1', variant: 'va-DG-CUY-ENT', qty: 6, weight: 5.4, source: { type: 'STOCK_TRANSFER', id: t5.id }, at: G.TODAY + 'T07:35', reason: 'Reposición del mostrador' });
    G.inv.transfer({ from: 'wh-CAM-L1', to: 'wh-MOS-L1', variant: 'va-DG-CHO-500', qty: 8, source: { type: 'STOCK_TRANSFER', id: t5.id }, at: G.TODAY + 'T07:35', reason: 'Reposición del mostrador' });
    Object.assign(t5, { status: 'RECEIVED', dispatched_at: G.TODAY + 'T07:35', received_at: G.TODAY + 'T07:35', dispatched_by: 'us-mtorres', received_by: 'us-mtorres' });
    for (const l of G.db.where('stock_transfer_lines', x => x.transfer_id === t5.id)) { l.received_qty = l.qty; l.received_weight_kg = l.weight_kg; }
    // reservas del Local 2 que quedaron sin stock: se vuelven a reservar ahora que llegó la reposición
    for (const o of G.db.where('sales_orders', o => ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY'].includes(o.status) && o.stock_short)) A.reserve(o);
    for (const o of G.db.where('sales_orders', o => (o.reservations || []).length)) if (!G.db.find('stock_reservations', x => x.order_id === o.id)) A.syncReservations(o);
    // conteos
    G.db.seq['DG:CNT'] = 0;
    const mkCount = (wh, type, st, at, by, appr, diffs) => {
      const c = s('stock_counts', { number: nxt('CNT', 'CNT-'), warehouse_id: wh, establishment_id: siteOfWh(wh), count_type: type, status: st, blind: true, counted_at: st !== 'OPEN' ? at : null, counted_by: st !== 'OPEN' ? by : null, approved_by: st === 'APPROVED' ? appr : null, approved_at: st === 'APPROVED' ? at.slice(0, 11) + '18:00' : null, created_by: by });
      const bals = G.db.where('stock_balances', b => b.warehouse_id === wh && b.qty > 0).slice(0, 10);
      bals.forEach((b, i) => {
        const d = diffs[i] || 0;
        const ln = s('stock_count_lines', { count_id: c.id, variant_id: b.variant_id, lot_id: b.lot_id, system_qty: b.qty, counted_qty: st === 'OPEN' ? (i < 4 ? b.qty + d : null) : b.qty + d, system_weight_kg: b.weight_kg || null, counted_weight_kg: null, counted_by: by });
        if (st === 'APPROVED' && d) { const mv = G.inv.move({ type: 'ADJUSTMENT', wh, variant: b.variant_id, lot: b.lot_id, qty: d, source: { type: 'STOCK_COUNT', id: c.id }, reason: `Ajuste del conteo ${c.number}`, at: at.slice(0, 11) + '18:00', allowUnreleased: true }); ln.diff_qty = d; ln.adjust_move_id = mv.moves[0].id; }
      });
      return c;
    };
    mkCount('wh-CNG-L1', 'CYCLE', 'APPROVED', '2026-10-03T16:30', 'us-mtorres', 'us-chuaman', [0, -1, 0, 0, 0, 0]);
    mkCount('wh-ALM-L1', 'CYCLE', 'APPROVED', '2026-10-06T17:00', 'us-mtorres', 'us-chuaman', [0, 0, -2, 0, 0, 1, 0, 0]);
    mkCount('wh-CAM-L2', 'SPOT', 'COUNTED', G.TODAY + 'T08:15', 'us-irojas', null, [0, -1, 0, 0]);
    mkCount('wh-MOS-L1', 'SPOT', 'OPEN', G.TODAY + 'T09:00', 'us-mtorres', null, [0, 0, -1, 0]);
    // mermas
    G.db.seq['DG:MER'] = 0;
    const mkWaste = (wh, vid, q, reasonCode, st, at, by, appr, notes, photo) => {
      const b = G.db.where('stock_balances', x => x.warehouse_id === wh && x.variant_id === vid && x.qty >= q).sort((a, c) => String((lotOf(a.lot_id) || {}).expiry_date).localeCompare(String((lotOf(c.lot_id) || {}).expiry_date)))[0]; if (!b) return null;
      const v = G.variant(vid);
      const w = s('stock_waste_records', { number: nxt('MER', 'MER-'), warehouse_id: wh, establishment_id: siteOfWh(wh), variant_id: vid, lot_id: b.lot_id, reason_id: 'wr-' + reasonCode, qty: q, weight_kg: v.sale_mode === 'KG' ? q : v.nominal_weight_kg ? R(q * v.nominal_weight_kg, 3) : null, estimated_cost: R(q * (b.avg_cost || v.std_cost)), photo_url: photo || null, notes, status: st, approved_by: st !== 'PENDING' ? appr : null, approved_at: st !== 'PENDING' ? at : null, requested_by: by, requested_at: at });
      if (st === 'APPROVED') { const mv = G.inv.move({ type: 'WASTE', wh, variant: vid, lot: b.lot_id, qty: q, weight: w.weight_kg, source: { type: 'STOCK_WASTE', id: w.id }, reason: `Merma ${w.number}`, at, allowUnreleased: true }); w.actual_cost = R(mv.total_cost); w.move_id = mv.moves[0].id; }
      if (st === 'REJECTED') w.reject_reason = 'El producto se reacondicionó y se vendió al mostrador';
      return w;
    };
    mkWaste('wh-CAM-L1', 'va-DG-POL-PEC', 1.5, 'VENC', 'APPROVED', '2026-10-03T19:00', 'us-mtorres', 'us-mtorres', 'Pechuga vencida en la cámara', null);
    mkWaste('wh-CAM-L1', 'va-DG-CUY-ENT', 2, 'DANO', 'APPROVED', '2026-10-05T11:20', 'us-mtorres', 'us-mtorres', 'Empaque al vacío roto al descargar', 'foto-merma-0002.jpg');
    mkWaste('wh-CNG-L1', 'va-DG-CAL-1L', 3, 'DANO', 'APPROVED', '2026-10-07T09:10', 'us-mtorres', 'us-mtorres', 'Envases rajados por congelamiento', 'foto-merma-0003.jpg');
    mkWaste('wh-MOS-L1', 'va-DG-CHO-500', 1, 'MUES', 'APPROVED', '2026-10-08T12:00', 'us-jsalas', 'us-mtorres', 'Degustación en el mostrador', null);
    mkWaste('wh-CAM-L1', 'va-M2-LOM-KG', 2.4, 'FRIO', 'PENDING', G.TODAY + 'T08:40', 'us-mtorres', null, 'Bandeja expuesta fuera de la cámara durante la descarga', 'foto-merma-0005.jpg');
    mkWaste('wh-CAM-L1', 'va-DG-CON-ENT', 1, 'DESH', 'PENDING', G.TODAY + 'T09:05', 'us-mtorres', null, 'Conejo con pérdida de peso y color', null);
    mkWaste('wh-CAM-L1', 'va-DG-PAT-ENT', 1, 'DANO', 'REJECTED', '2026-10-09T10:00', 'us-mtorres', 'us-chuaman', 'Golpe en la pechuga', 'foto-merma-0007.jpg');
    // temperaturas de cámaras y congeladoras (cada 2 h) con un evento fuera de rango en la cámara del Local 2
    const cold = G.db.where('warehouses', w => ['COLD_ROOM', 'FREEZER', 'STORE', 'QUARANTINE'].includes(w.wh_type));
    for (const w of cold) for (const day of ['2026-10-09', G.TODAY]) for (const hh of [6, 8, 10, 12, 14, 16, 18, 20]) {
      if (day === G.TODAY && hh > 10) continue;
      const base = w.wh_type === 'FREEZER' ? -19.5 : 2.4;
      let t = R(base + (r() - 0.5) * 1.6, 1);
      if (w.id === 'wh-CAM-L2' && day === G.TODAY && hh === 10) t = 6.2;
      if (w.id === 'wh-CNG-L1' && day === '2026-10-09' && hh === 14) t = -15.8;
      A.addTemp(w.id, t, 'SENSOR', `${day}T${U.pad(hh, 2)}:00`);
    }
  }, 'almacenes');

  /* ------------------------------------------------------------------
     Indicadores (TAB)
     ------------------------------------------------------------------ */
  const inP = (d, p) => { const x = String(d || '').slice(0, 10); return x >= (p.from || '0000') && x <= (p.to || '9999'); };
  const whIn = (wid, p) => { const w = whOf(wid) || {}; return !p.site || w.establishment_id === p.site; };
  const brandOk = (vid, p) => !p.brand || (G.variant(vid) || {}).brand_id === p.brand;
  /** costo de ventas del período: comprobantes emitidos (costo estándar) + salidas SALE del kardex sin comprobante */
  A.cogs = function (p) {
    const docs = G.db.where('sales_documents', d => ['INVOICE', 'RECEIPT'].includes(d.doc_type) && d.status !== 'VOIDED' && inP(d.issue_date, p) && (!p.brand || d.brand_id === p.brand) && (!p.site || d.establishment_id === p.site));
    return R(U.sum(docs, d => d.cost || 0));
  };
  const days = p => Math.max(1, G.date.diff(p.to || G.TODAY, p.from || G.date.month(G.TODAY)) + 1);
  G.kpiCalc['KPI-ALM-01'] = p => { const val = A.inventoryValue(b => whIn(b.warehouse_id, p) && brandOk(b.variant_id, p) && (whOf(b.warehouse_id) || {}).wh_type !== 'TRANSIT'); const c = A.cogs(p); return { value: c ? R(val / c * days(p), 1) : 0, numerator: val, denominator: c }; };
  G.kpiCalc['KPI-ALM-02'] = p => { const w = R(-U.sum(G.db.where('stock_movements', m => m.movement_type === 'WASTE' && inP(m.moved_at, p) && whIn(m.warehouse_id, p) && brandOk(m.variant_id, p)), m => m.total_cost)); const c = A.cogs(p); return { value: c ? R(w / c * 100, 2) : 0, numerator: w, denominator: c }; };
  G.kpiCalc['KPI-ALM-03'] = p => { const exp = new Set(G.db.where('waste_reasons', r => r.counts_as_expired).map(r => r.id)); return R(U.sum(G.db.where('stock_waste_records', w => w.status === 'APPROVED' && exp.has(w.reason_id) && inP(w.approved_at || w.requested_at, p) && whIn(w.warehouse_id, p) && brandOk(w.variant_id, p)), w => w.actual_cost ?? w.estimated_cost)); };
  G.kpiCalc['KPI-ALM-04'] = p => { const e = A.expiring(7).filter(x => x.days >= 0 && (!p.brand || x.brand_id === p.brand) && (!p.site || x.establishment_id === p.site)); return { value: R(U.sum(e, x => x.value)), numerator: R(U.sum(e.filter(x => x.days <= 3), x => x.value)), denominator: R(U.sum(e, x => x.value)), detail: 'numerador: vence en 3 días; valor: vence en 7 días' }; };
  G.kpiCalc['KPI-ALM-05'] = p => { const cs = new Set(G.db.where('stock_counts', c => ['COUNTED', 'APPROVED'].includes(c.status) && inP(c.counted_at, p) && whIn(c.warehouse_id, p)).map(c => c.id)); const ls = G.db.where('stock_count_lines', l => cs.has(l.count_id) && l.counted_qty != null); const ok = ls.filter(l => Math.abs(l.counted_qty - l.system_qty) < 0.0005).length; return { value: ls.length ? R(ok / ls.length * 100, 1) : 0, numerator: ok, denominator: ls.length }; };
  G.kpiCalc['KPI-ALM-06'] = p => { const rs = new Set(G.db.where('stock_receipts', r => r.status === 'CONFIRMED' && inP(r.received_at, p) && whIn(r.warehouse_id, p)).map(r => r.id)); const ls = G.db.where('stock_receipt_lines', l => rs.has(l.receipt_id)); const bad = ls.filter(l => l.appearance !== 'OK' || l.qc_result === 'FAIL').length; return { value: ls.length ? R(bad / ls.length * 100, 1) : 0, numerator: bad, denominator: ls.length }; };
  G.kpiCalc['KPI-ALM-07'] = p => { const os = G.db.where('sales_orders', o => o.confirmed_at && inP(o.confirmed_at, p) && o.status !== 'DRAFT' && (!p.brand || o.brand_id === p.brand) && (!p.site || o.establishment_id === p.site) && o.created_at >= '2026-10-10'); const sh = os.filter(o => o.stock_short && o.stock_short.length).length; return { value: os.length ? R(sh / os.length * 100, 1) : 0, numerator: sh, denominator: os.length }; };
  G.kpiCalc['KPI-ALM-08'] = p => A.inventoryValue(b => whIn(b.warehouse_id, p) && brandOk(b.variant_id, p));

  /* ------------------------------------------------------------------
     Alertas, búsqueda y escaneo
     ------------------------------------------------------------------ */
  G.alertProviders.push(() => {
    const out = [];
    const e = A.expiring();
    const exp = e.filter(x => x.days < 0), d3 = e.filter(x => x.days >= 0 && x.days <= 3);
    if (exp.length) out.push({ module: 'ALM', title: `${exp.length} lote(s) vencidos con stock`, detail: `${exp.slice(0, 3).map(x => x.lot.code).join(', ')} · ${G.fmt.money(U.sum(exp, x => x.value))}. Regístralos como merma por vencido.`, tone: 'bad', go: () => G.go('ALM-11') });
    if (d3.length) out.push({ module: 'ALM', title: `${d3.length} lote(s) vencen en 3 días o menos`, detail: `${d3.slice(0, 3).map(x => x.lot.code).join(', ')} · ${G.fmt.money(U.sum(d3, x => x.value))} (RN-ALM-15)`, tone: 'warn', go: () => G.go('ALM-11') });
    const temps = G.db.where('warehouses', w => w.status === 'ACTIVE' && w.max_temp_c !== null && w.max_temp_c !== undefined).map(w => ({ w, t: A.lastTemp(w.id) })).filter(x => x.t && x.t.out_of_range);
    if (temps.length) out.push({ module: 'ALM', title: `Temperatura fuera de rango: ${temps.map(x => x.w.code).join(', ')}`, detail: temps.map(x => `${x.w.name} ${G.fmt.num(x.t.temp_c, 1)} °C (máx. ${x.w.max_temp_c} °C)`).join(' · '), tone: 'bad', go: () => G.go('ALM-11', { tab: 'temp' }) });
    const q = G.db.where('lots', l => l.qc_status === 'QUARANTINE' && A.lotStock(l.id).some(b => b.qty > 0));
    if (q.length) out.push({ module: 'ALM', title: `${q.length} lote(s) en cuarentena por liberar`, detail: q.slice(0, 3).map(l => l.code).join(', ') + ' · no se venden hasta liberarlos (RN-ALM-02)', tone: 'info', go: () => G.go('ALM-06') });
    const wp = G.db.where('stock_waste_records', w => w.status === 'PENDING');
    if (wp.length) out.push({ module: 'ALM', title: `${wp.length} merma(s) por aprobar`, detail: G.fmt.money(U.sum(wp, w => w.estimated_cost)) + ' estimados', tone: 'warn', go: () => G.go('ALM-09') });
    const cp = G.db.where('stock_counts', c => c.status === 'COUNTED');
    if (cp.length) out.push({ module: 'ALM', title: `${cp.length} conteo(s) por aprobar`, detail: cp.map(c => c.number).join(', '), tone: 'info', go: () => G.go('ALM-08') });
    return out;
  });
  G.searchProviders.push(q => {
    const s = q.toLowerCase(); const out = [];
    for (const l of G.db.where('lots', l => l.code.toLowerCase().includes(s)).slice(0, 5)) out.push({ label: `Lote ${l.code}`, sub: `${G.variantName(l.variant_id)} · ${G.ui.statusLabel(l.qc_status)} · vence ${G.fmt.date(l.expiry_date)}`, go: () => G.go('ALM-05', { lot: l.id }) });
    for (const t of G.db.where('stock_transfers', t => t.number.toLowerCase().includes(s) || String(t.guide_number || '').toLowerCase().includes(s)).slice(0, 3)) out.push({ label: `Transferencia ${t.number}`, sub: `${G.whName(t.from_warehouse_id)} → ${G.whName(t.to_warehouse_id)} · ${G.ui.statusLabel(t.status)}`, go: () => G.go('ALM-07', { id: t.id }) });
    for (const t of G.db.where('stock_receipts', t => t.number.toLowerCase().includes(s)).slice(0, 3)) out.push({ label: `Recepción ${t.number}`, sub: `${G.supName(t.supplier_id)} · ${G.ui.statusLabel(t.status)}`, go: () => G.go('ALM-04', { id: t.id }) });
    return out;
  });
  G.scanHandlers.push(code => {
    const lot = G.db.find('lots', l => l.code.toUpperCase() === code); if (lot) return () => G.go('ALM-05', { lot: lot.id });
    const tr = G.db.find('stock_transfers', t => t.number === code || String(t.guide_number || '').toUpperCase() === code); if (tr) return () => G.go('ALM-07', { id: tr.id });
    const rc = G.db.find('stock_receipts', t => t.number === code); if (rc) return () => G.go('ALM-04', { id: rc.id });
    const ct = G.db.find('stock_counts', t => t.number === code); if (ct) return () => G.go('ALM-08', { id: ct.id });
    const ws = G.db.find('stock_waste_records', t => t.number === code); if (ws) return () => G.go('ALM-09', { id: ws.id });
    return null;
  });

  /* ------------------------------------------------------------------
     Componentes de pantalla
     ------------------------------------------------------------------ */
  const tryDo = (fn, okMsg) => { try { const r = fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); if (!(e instanceof G.RuleError)) console.error(e); return null; } };
  const brandOpts = () => G.scope.brands().map(b => [b.id, b.name.split(' · ')[0]]);
  const siteOpts = () => G.scope.sites().map(e => [e.id, e.short]);
  const lineOpts = () => [...new Set(G.db.all('products').map(p => p.line))].sort().map(l => [l, l === 'OTROS' ? 'Insumos y empaques' : l.charAt(0) + l.slice(1).toLowerCase().replace('_', ' ')]);
  /** editor simple de líneas (tabla con campos) */
  function lineEditor(cols, rows, { onChange, addLabel = 'Agregar línea', blank = () => ({}), fixed = false } = {}) {
    const box = h('div', { class: 'stack', style: 'gap:8px' });
    function draw() {
      G.ui.clear(box);
      const tb = h('tbody');
      rows.forEach((r, i) => {
        tb.appendChild(h('tr', null, cols.map(c => {
          let inp;
          if (c.type === 'select') { const opts = typeof c.options === 'function' ? c.options(r) : c.options; inp = h('select', { class: 'input', attrs: { 'aria-label': c.label } }, c.blank ? h('option', { value: '' }, c.blank) : null, opts.map(([v, l]) => h('option', { value: v, selected: String(r[c.key] ?? '') === String(v) }, l))); if (r[c.key] === undefined && opts.length && !c.blank) r[c.key] = opts[0][0]; }
          else if (c.type === 'calc') return h('td', { class: c.align || '' }, c.render(r));
          else inp = h('input', { class: 'input', type: c.type || 'text', value: r[c.key] ?? '', attrs: { step: c.type === 'number' ? 'any' : null, 'aria-label': c.label, placeholder: c.placeholder || '' }, style: { minWidth: c.min || '70px' } });
          inp.addEventListener('change', () => { r[c.key] = c.type === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value; if (c.onChange) c.onChange(r); draw(); onChange && onChange(rows); });
          return h('td', null, inp);
        }), fixed ? null : h('td', null, btn('Quitar', () => { rows.splice(i, 1); draw(); onChange && onChange(rows); }, { sm: true, kind: 'ghost' }))));
      });
      box.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, cols.map(c => h('th', { class: c.align || '' }, c.label)), fixed ? null : h('th'))), tb)));
      if (!fixed) box.appendChild(h('div', null, btn(addLabel, () => { rows.push(blank()); draw(); onChange && onChange(rows); }, { sm: true, icon: '+' })));
    }
    draw();
    return box;
  }
  const lotsFor = (variant, wh, { any = false } = {}) => G.db.where('stock_balances', b => b.variant_id === variant && (!wh || b.warehouse_id === wh) && b.qty > 0 && b.lot_id && (any || G.inv.lotUsable(b.lot_id))).map(b => { const l = lotOf(b.lot_id); return [l.id, `${l.code} · vence ${G.fmt.date(l.expiry_date)} · ${G.fmt.num(b.qty - (b.reserved_qty || 0), 3)} disp.`]; });

  /* ---------- ALM-01 Almacenes y ubicaciones ---------- */
  function alm01(el) {
    const canM = G.can('alm.warehouse.manage');
    const body = page(el, { code: 'ALM-01', title: 'Almacenes y ubicaciones', sub: 'Árbol por local con cámaras, congeladoras, mostrador, cuarentena, tránsito y vehículos: tipo, rango de temperatura, si vende y prioridad de salida.', actions: [canM ? { label: 'Nuevo almacén', kind: 'primary', icon: '+', onClick: () => editWh(null) } : null, { label: 'Registrar temperatura', onClick: () => tempForm() }].filter(Boolean) });
    const whs = G.db.where('warehouses', w => w.status === 'ACTIVE');
    const valByWh = {}; for (const b of G.db.where('stock_balances', b => b.qty > 0)) valByWh[b.warehouse_id] = (valByWh[b.warehouse_id] || 0) + b.qty * (b.avg_cost || 0);
    const lotsByWh = {}; for (const b of G.db.where('stock_balances', b => b.qty > 0 && b.lot_id)) (lotsByWh[b.warehouse_id] = lotsByWh[b.warehouse_id] || new Set()).add(b.lot_id);
    const outs = whs.filter(w => { const t = A.lastTemp(w.id); return t && t.out_of_range; });
    body.appendChild(kpis([
      { label: 'Ubicaciones activas', value: whs.length, sub: `${whs.filter(w => w.allows_sale).length} venden` },
      { label: 'Cámaras y congeladoras', value: whs.filter(w => ['COLD_ROOM', 'FREEZER'].includes(w.wh_type)).length, sub: '2 almacenes principales' },
      { label: 'Fuera de rango', value: outs.length, tone: outs.length ? 'bad' : 'ok', sub: outs.map(w => w.code).join(', ') || 'Todas en rango' },
      { label: 'Valor en almacenes', value: money(U.sum(Object.values(valByWh), x => x)), sub: 'Saldo × costo promedio' },
    ]));
    const node = w => {
      const t = A.lastTemp(w.id);
      return h('div', { class: 'between', style: 'padding:8px 0;border-bottom:1px solid var(--line);gap:10px;flex-wrap:wrap;cursor:pointer;padding-left:' + (w.parent_id ? '22px' : '0'), on: { click: () => openWh(w) } },
        h('div', { style: 'min-width:0' }, h('b', null, (w.parent_id ? '└ ' : '') + w.name), h('div', { class: 'small muted' }, `${w.code} · ${whTypeName(w.wh_type)}${w.min_temp_c !== null && w.min_temp_c !== undefined ? ` · ${w.min_temp_c} a ${w.max_temp_c} °C` : ''} · prioridad ${w.pick_priority}`)),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, w.allows_sale ? badge('Vende', 'ok') : badge('No vende', ''), t ? badge(`${G.fmt.num(t.temp_c, 1)} °C`, t.out_of_range ? 'bad' : 'info') : null, badge(`${(lotsByWh[w.id] || new Set()).size} lotes`, ''), h('span', { class: 'small num' }, money(valByWh[w.id] || 0))));
    };
    const grid = h('div', { class: 'grid c2' });
    for (const site of G.scope.sites()) {
      if (G.ctx.site !== 'ALL' && G.ctx.site !== site.id) continue;
      const mine = whs.filter(w => w.establishment_id === site.id);
      const roots = mine.filter(w => !w.parent_id && w.wh_type !== 'VEHICLE');
      const list = [];
      for (const r0 of roots.sort(U.by('pick_priority'))) { list.push(node(r0)); for (const c of mine.filter(w => w.parent_id === r0.id).sort(U.by('pick_priority'))) list.push(node(c)); }
      const veh = mine.filter(w => w.wh_type === 'VEHICLE');
      if (veh.length) { list.push(h('div', { class: 'small muted', style: 'margin-top:10px' }, 'Vehículos propios (D-ALM-03: un almacén por vehículo propio)')); veh.forEach(v => list.push(node(v))); }
      grid.appendChild(card(site.name, list));
    }
    const tra = whs.filter(w => !w.establishment_id);
    if (tra.length) grid.appendChild(card('Entre locales', tra.map(node)));
    body.appendChild(grid);
    function openWh(w) {
      drawer(w.name, (bd) => {
        const acts = h('div', { class: 'row' }, canM ? btn('Editar', () => { G.ui.closeAll(); editWh(w); }, { sm: true, kind: 'primary' }) : null, btn('Registrar temperatura', () => tempForm(w.id), { sm: true }), btn('Ver stock', () => G.go('ALM-02', { wh: w.id }), { sm: true }), btn('Contar', () => G.go('ALM-08', { wh: w.id }), { sm: true }));
        bd.appendChild(acts);
        bd.appendChild(dl([['Código', w.code], ['Tipo', whTypeName(w.wh_type)], ['Local', w.establishment_id ? G.siteName(w.establishment_id) : 'Entre locales'], ['Dentro de', w.parent_id ? G.whName(w.parent_id) : '—'], ['Vehículo', w.vehicle_id ? (G.db.get('vehicles', w.vehicle_id) || {}).plate : '—'], ['Rango de temperatura', w.min_temp_c !== null && w.min_temp_c !== undefined ? `${w.min_temp_c} a ${w.max_temp_c} °C` : 'Ambiente'], ['Vende', w.allows_sale ? 'Sí' : 'No'], ['Prioridad de salida', w.pick_priority], ['Valor del stock', money(valByWh[w.id] || 0)]]));
        const temps = G.db.where('warehouse_temp_readings', r => r.warehouse_id === w.id).sort(U.by('read_at', -1));
        if (temps.length) {
          const last = temps.slice(0, 16).reverse();
          bd.appendChild(card('Temperatura (últimas lecturas)', G.ui.chart.line({ labels: last.map(r => r.read_at.slice(5, 16).replace('T', ' ')), series: [{ name: '°C', values: last.map(r => r.temp_c) }], ref: w.max_temp_c ?? undefined, height: 180, area: false, min: Math.min(...last.map(r => r.temp_c), w.min_temp_c ?? 0) - 2, max: Math.max(...last.map(r => r.temp_c), w.max_temp_c ?? 0) + 2 })));
          bd.appendChild(table({ id: 'alm01-temps', columns: [{ key: 'read_at', label: 'Lectura', render: r => G.fmt.datetime(r.read_at) }, { key: 'temp_c', label: '°C', align: 'r', render: r => h('span', { style: r.out_of_range ? 'color:var(--bad);font-weight:700' : '' }, G.fmt.num(r.temp_c, 1)) }, { key: 'source', label: 'Origen', render: r => r.source === 'SENSOR' ? 'Sensor' : 'Manual · ' + r.user }], rows: temps, search: false, pageSize: 8 }));
        }
      }, { code: 'ALM-01', wide: true });
    }
    function editWh(w) {
      drawer(w ? 'Editar ' + w.name : 'Nuevo almacén o ubicación', (bd, close) => bd.appendChild(form({
        id: 'alm01', values: w ? Object.assign({}, w) : { wh_type: 'COLD_ROOM', establishment_id: 'es-L1', allows_sale: true, pick_priority: 50, min_temp_c: 0, max_temp_c: 4 },
        fields: [{ key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'establishment_id', label: 'Local', type: 'select', options: G.db.all('establishments').map(e => [e.id, e.short]) }, { key: 'wh_type', label: 'Tipo', type: 'select', options: WH_TYPES, required: true }, { key: 'parent_id', label: 'Dentro de', type: 'select', options: whOpts(x => x.wh_type === 'MAIN') }, { key: 'vehicle_id', label: 'Vehículo (si es vehículo)', type: 'select', options: G.db.where('vehicles', v => v.ownership === 'OWN').map(v => [v.id, v.plate]) }, { key: 'min_temp_c', label: 'Temperatura mínima °C', type: 'number' }, { key: 'max_temp_c', label: 'Temperatura máxima °C', type: 'number' }, { key: 'pick_priority', label: 'Prioridad de salida (menor sale primero)', type: 'number', min: 1 }, { key: 'allows_sale', label: 'Permite vender desde aquí (RN-ALM-02)', type: 'checkbox' }],
        onCancel: close,
        onSubmit: v => {
          if (!G.can('alm.warehouse.manage')) return `Tu rol (${G.roleName()}) no tiene el permiso alm.warehouse.manage.`;
          if (G.db.find('warehouses', x => x.code === v.code && (!w || x.id !== w.id))) return { code: 'Ya existe un almacén con ese código.' };
          if (['QUARANTINE', 'TRANSIT', 'VEHICLE', 'RETURNS', 'PRODUCTION'].includes(v.wh_type) && v.allows_sale) return { allows_sale: `Un almacén de tipo ${whTypeName(v.wh_type).toLowerCase()} no vende (RN-ALM-02).` };
          const row = { code: v.code, name: v.name, establishment_id: v.establishment_id || null, wh_type: v.wh_type, parent_id: v.parent_id || null, vehicle_id: v.vehicle_id || null, min_temp_c: v.min_temp_c === '' ? null : v.min_temp_c, max_temp_c: v.max_temp_c === '' ? null : v.max_temp_c, pick_priority: Number(v.pick_priority) || 50, allows_sale: !!v.allows_sale, status: 'ACTIVE' };
          if (w) G.db.update('warehouses', w.id, row); else G.db.insert('warehouses', Object.assign({ id: 'wh-' + v.code }, row));
          close(); toast(w ? 'Almacén actualizado' : 'Almacén creado', 'ok'); G.refresh(); return true;
        },
      })), { code: 'ALM-01' });
    }
  }
  function tempForm(whId) {
    modal('Registrar temperatura', bd => bd.appendChild(form({ id: 'alm-temp', values: { warehouse_id: whId || 'wh-CAM-L1' }, submitLabel: 'Registrar', fields: [{ key: 'warehouse_id', label: 'Cámara o congeladora', type: 'select', required: true, options: whOpts(w => w.max_temp_c !== null && w.max_temp_c !== undefined) }, { key: 'temp_c', label: 'Temperatura medida (°C)', type: 'number', required: true }], onSubmit: v => { try { const r = A.addTemp(v.warehouse_id, v.temp_c, 'MANUAL'); G.ui.closeAll(); toast(r.out_of_range ? `Fuera de rango: ${G.fmt.num(r.temp_c, 1)} °C en ${G.whName(r.warehouse_id)}. Se avisó al almacén.` : 'Temperatura registrada', r.out_of_range ? 'warn' : 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })));
  }

  /* ---------- ALM-02 Stock ---------- */
  function alm02(el, params = {}) {
    const body = page(el, { code: 'ALM-02', title: 'Stock', sub: 'Saldo por almacén, variante y lote con disponible (saldo − reservado), peso, costo promedio y vencimiento. Filtra por marca, línea, almacén y estado del lote.', actions: [{ label: 'Kardex', onClick: () => G.go('ALM-03') }, G.can('alm.transfer.create') ? { label: 'Nueva transferencia', onClick: () => G.go('ALM-07', { new: 1 }) } : null].filter(Boolean) });
    const rows = G.scope.filter(G.db.where('stock_balances', b => Math.abs(b.qty) > 0.0005 || (b.reserved_qty || 0) > 0).map(balRow)).map(b => { const v = G.variant(b.variant_id) || {}; const lot = lotOf(b.lot_id); return Object.assign(b, { sku: v.sku, vname: v.name, line: v.line, lot, lot_code: lot ? lot.code : '', expiry: lot ? lot.expiry_date : '', qc: lot ? lot.qc_status : 'NONE', avail: R(b.qty - (b.reserved_qty || 0), 3), value: R(b.qty * (b.avg_cost || 0)), v }); });
    const exp7 = rows.filter(r => r.lot && daysLeft(r.lot) !== null && daysLeft(r.lot) <= 7 && daysLeft(r.lot) >= 0);
    body.appendChild(kpis([
      { label: 'Valor del inventario', value: money(U.sum(rows, r => r.value)), sub: `${rows.length} saldos · KPI-ALM-08` },
      { label: 'Reservado para pedidos', value: G.fmt.num(U.sum(rows, r => r.reserved_qty || 0), 0), sub: 'unidades o kg', onClick: () => G.go('ALM-10') },
      { label: 'Vence en 7 días', value: money(U.sum(exp7, r => r.value)), tone: exp7.length ? 'warn' : 'ok', sub: `${new Set(exp7.map(r => r.lot_id)).size} lotes`, onClick: () => G.go('ALM-11') },
      { label: 'En cuarentena o bloqueado', value: G.fmt.num(U.sum(rows.filter(r => ['QUARANTINE', 'BLOCKED'].includes(r.qc)), r => r.qty), 0), tone: 'info', sub: 'No se venden (RN-ALM-02)', onClick: () => G.go('ALM-06') },
    ]));
    const st = G.ui._tblState && G.ui._tblState['alm02'];
    G.ui._tblState = G.ui._tblState || {};
    if (params.wh) { G.ui._tblState['alm02'] = Object.assign(st || { q: '', page: 0, f: {} }, { f: Object.assign((st || {}).f || {}, { warehouse_id: params.wh }) }); }
    body.appendChild(table({
      id: 'alm02', rows, sort: 'expiry',
      columns: [
        { key: 'warehouse_id', label: 'Almacén', render: r => (whOf(r.warehouse_id) || {}).code, value: r => (whOf(r.warehouse_id) || {}).code },
        { key: 'sku', label: 'SKU', mono: true },
        { key: 'vname', label: 'Producto' },
        { key: 'brand_id', label: 'Marca', render: r => G.brandName(r.brand_id) },
        { key: 'lot_code', label: 'Lote', mono: true },
        { key: 'expiry', label: 'Vence', render: r => r.lot ? h('span', null, G.fmt.date(r.expiry), ' ', daysLeft(r.lot) <= 7 ? badge(daysLeft(r.lot) < 0 ? 'vencido' : G.fmt.days(daysLeft(r.lot)), daysLeft(r.lot) <= 3 ? 'bad' : 'warn') : null) : '—' },
        { key: 'qc', label: 'Estado', render: r => r.lot ? G.ui.status(r.qc) : '—' },
        { key: 'qty', label: 'Saldo', align: 'r', render: r => qtyTxt(r.qty, r.v) },
        { key: 'reserved_qty', label: 'Reservado', align: 'r', render: r => r.reserved_qty ? qtyTxt(r.reserved_qty, r.v) : '—' },
        { key: 'avail', label: 'Disponible', align: 'r', render: r => h('b', null, qtyTxt(r.avail, r.v)) },
        { key: 'weight_kg', label: 'Peso', align: 'r', render: r => r.v.sale_mode === 'UNIT' ? '—' : G.fmt.kg(r.weight_kg, 3) },
        { key: 'avg_cost', label: 'Costo prom.', align: 'r', render: r => money(r.avg_cost) },
        { key: 'value', label: 'Valor', align: 'r', render: r => money(r.value) },
      ],
      filters: [
        { key: 'brand_id', label: 'Marca', options: brandOpts() },
        { key: 'line', label: 'Línea', options: lineOpts() },
        { key: 'warehouse_id', label: 'Almacén', options: whOpts() },
        { key: 'qc', label: 'Estado del lote', options: LOT_STATUS.concat([['NONE', 'Sin lote']]) },
      ],
      footer: ['', '', '', '', '', '', 'Total', '', '', '', '', '', { v: money(U.sum(rows, r => r.value)), align: 'r' }],
      onRow: r => openBalance(r),
    }));
  }
  function openBalance(r) {
    drawer(`${r.vname}${r.lot ? ' · ' + r.lot.code : ''}`, bd => {
      const acts = h('div', { class: 'row', style: 'flex-wrap:wrap' },
        r.lot ? btn('Ficha del lote', () => G.go('ALM-05', { lot: r.lot_id }), { sm: true }) : null,
        G.can('alm.transfer.create') ? btn('Transferir', () => G.go('ALM-07', { new: 1, from: r.warehouse_id, variant: r.variant_id, lot: r.lot_id }), { sm: true }) : null,
        G.canDo('ALM', 'C') ? btn('Registrar merma', () => G.go('ALM-09', { new: 1, wh: r.warehouse_id, variant: r.variant_id, lot: r.lot_id }), { sm: true }) : null,
        r.lot && G.can('alm.lot.block') && r.lot.qc_status === 'RELEASED' ? btn('Bloquear lote', () => G.go('ALM-06', { lot: r.lot_id }), { sm: true, kind: 'danger' }) : null);
      bd.appendChild(acts);
      bd.appendChild(dl([['Almacén', G.whName(r.warehouse_id)], ['Producto', `${r.sku} · ${r.vname}`], ['Modo de venta', G.saleModeName(r.v.sale_mode)], ['Lote', r.lot ? r.lot.code : 'Sin lote'], ['Vencimiento', r.lot ? G.fmt.date(r.lot.expiry_date) : '—'], ['Estado', r.lot ? G.ui.status(r.qc) : '—'], ['Saldo', qtyTxt(r.qty, r.v)], ['Reservado', qtyTxt(r.reserved_qty || 0, r.v)], ['Disponible', qtyTxt(r.avail, r.v)], ['Peso', G.fmt.kg(r.weight_kg, 3)], ['Costo promedio', money(r.avg_cost)], ['Valor', money(r.value)]]));
      const res = G.db.where('sales_orders', o => (o.reservations || []).some(x => x.balance_id === r.id));
      if (res.length) bd.appendChild(card('Reservado para', h('div', { class: 'stack', style: 'gap:4px' }, res.map(o => h('div', { class: 'between small' }, h('span', null, `${o.number} · ${G.custName(o.customer_id)} · entrega ${G.fmt.date(o.delivery_date)}`), h('b', null, qtyTxt(U.sum(o.reservations.filter(x => x.balance_id === r.id), x => x.qty), r.v)))))));
      const mv = G.db.where('stock_movements', m => m.warehouse_id === r.warehouse_id && m.variant_id === r.variant_id && (m.lot_id || null) === (r.lot_id || null)).sort(U.by('moved_at', -1));
      bd.appendChild(card('Kardex de este saldo', kardexTable(mv, 'alm02-k', 10)));
    }, { code: 'ALM-02', wide: true });
  }

  /* ---------- ALM-03 Kardex ---------- */
  const srcLabel = m => {
    const t = m.source_type, id = m.source_id;
    const map = { SALES_ORDER: () => { const o = G.db.get('sales_orders', id); return o ? 'Pedido ' + o.number : 'Pedido'; }, STOCK_RECEIPT: () => 'Recepción ' + ((G.db.get('stock_receipts', id) || {}).number || ''), STOCK_TRANSFER: () => 'Transferencia ' + ((G.db.get('stock_transfers', id) || {}).number || ''), STOCK_COUNT: () => 'Conteo ' + ((G.db.get('stock_counts', id) || {}).number || ''), STOCK_WASTE: () => 'Merma ' + ((G.db.get('stock_waste_records', id) || {}).number || ''), INITIAL_LOAD: () => 'Carga inicial', FARM_RECEIPT: () => 'Granja ' + (id || ''), PRODUCTION: () => 'Producción ' + (id || ''), COUNTER: () => 'Mostrador', PICKING_TASK: () => 'Preparación', LOT_RELEASE: () => 'Liberación de lote', REVERSAL: () => 'Reverso', MANUAL: () => 'Manual' };
    return (map[t] || (() => t))();
  };
  function kardexTable(rows, id, pageSize = 25, filters) {
    return table({
      id, rows, sort: 'moved_at', dir: -1, pageSize, filters,
      columns: [
        { key: 'moved_at', label: 'Fecha', render: m => G.fmt.datetime(m.moved_at) },
        { key: 'movement_type', label: 'Tipo', render: m => badge(moveName(m.movement_type), m.qty < 0 ? 'warn' : 'ok'), value: m => moveName(m.movement_type) },
        { key: 'source_type', label: 'Origen', value: m => srcLabel(m) },
        { key: 'warehouse_id', label: 'Almacén', value: m => (whOf(m.warehouse_id) || {}).code },
        { key: 'variant_id', label: 'Producto', value: m => G.variantName(m.variant_id) },
        { key: 'lot_id', label: 'Lote', mono: true, value: m => (lotOf(m.lot_id) || {}).code || '—' },
        { key: 'qty', label: 'Cantidad', align: 'r', render: m => h('span', { style: m.qty < 0 ? 'color:var(--bad)' : 'color:var(--ok)' }, (m.qty > 0 ? '+' : '') + G.fmt.num(m.qty, 3)) },
        { key: 'weight_kg', label: 'Peso', align: 'r', render: m => m.weight_kg == null ? '—' : G.fmt.num(m.weight_kg, 3) },
        { key: 'unit_cost', label: 'Costo u.', align: 'r', render: m => money(m.unit_cost) },
        { key: 'total_cost', label: 'Costo total', align: 'r', render: m => money(m.total_cost) },
        { key: 'bal_qty', label: 'Saldo', align: 'r', render: m => G.fmt.num(m.bal_qty, 3) },
        { key: 'user', label: 'Usuario' },
      ],
      onRow: m => openMove(m),
    });
  }
  function openMove(m) {
    drawer(`${moveName(m.movement_type)} · ${G.variantName(m.variant_id)}`, bd => {
      const rev = G.db.find('stock_movements', x => x.reversal_of === m.id);
      const canRev = ['ADJUSTMENT', 'WASTE', 'RECEIPT'].includes(m.movement_type) && !rev && !m.reversal_of && (G.ctx.role === 'GERENTE' || G.ctx.role === 'ADMINISTRACION');
      if (canRev) bd.appendChild(h('div', { class: 'row' }, btn('Reversar movimiento', () => {
        modal('Reversar movimiento', b2 => b2.appendChild(form({ id: 'alm-rev', submitLabel: 'Reversar', fields: [{ key: 'reason', label: 'Motivo del reverso', type: 'textarea', required: true }], onSubmit: v => { try { G.inv.move({ type: 'REVERSAL', wh: m.warehouse_id, variant: m.variant_id, lot: m.lot_id, qty: -m.qty, weight: m.weight_kg != null ? -m.weight_kg : null, unitCost: m.unit_cost, source: { type: 'REVERSAL', id: m.id }, reason: v.reason, reversal_of: m.id, allowUnreleased: true }); G.ui.closeAll(); toast('Movimiento reversado: el kardex conserva ambos registros (RN-ALM-01)', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })));
      }, { sm: true, kind: 'danger' })));
      bd.appendChild(dl([['Fecha', G.fmt.datetime(m.moved_at)], ['Tipo', moveName(m.movement_type)], ['Origen', srcLabel(m)], ['Almacén', G.whName(m.warehouse_id)], ['Producto', G.variantName(m.variant_id)], ['Lote', (lotOf(m.lot_id) || {}).code || '—'], ['Cantidad', G.fmt.num(m.qty, 3)], ['Peso', m.weight_kg == null ? '—' : G.fmt.kg(m.weight_kg, 3)], ['Costo unitario', money(m.unit_cost)], ['Costo total', money(m.total_cost)], ['Saldo después', G.fmt.num(m.bal_qty, 3)], ['Motivo', m.reason], ['Usuario', m.user], ['Reverso de', m.reversal_of ? 'Movimiento ' + m.reversal_of : '—'], ['Reversado por', rev ? G.fmt.datetime(rev.moved_at) + ' · ' + rev.user : '—']]));
      if (m.source_type === 'SALES_ORDER' && m.source_id) bd.appendChild(btn('Abrir el pedido', () => G.screens['PED-03'] ? G.go('PED-03', { id: m.source_id }) : toast('El pedido se abre en PED (no incluido en esta vista).', 'info'), { sm: true }));
    }, { code: 'ALM-03' });
  }
  function alm03(el) {
    const body = page(el, { code: 'ALM-03', title: 'Kardex', sub: 'Movimientos de solo inserción por variante, lote o almacén, con origen (pedido, recepción, transferencia, conteo, merma), cantidad, peso, costo y usuario. Se corrige con reversos.' });
    const rows = G.db.where('stock_movements', m => G.scope.ok({ brand_id: (G.variant(m.variant_id) || {}).brand_id, establishment_id: siteOfWh(m.warehouse_id) }));
    const today = rows.filter(m => String(m.moved_at).slice(0, 10) === G.TODAY);
    body.appendChild(kpis([
      { label: 'Movimientos', value: G.fmt.num(rows.length), sub: 'Kardex completo' },
      { label: 'Hoy', value: G.fmt.num(today.length), sub: `${today.filter(m => m.qty > 0).length} ingresos · ${today.filter(m => m.qty < 0).length} salidas` },
      { label: 'Mermas del mes', value: money(-U.sum(rows.filter(m => m.movement_type === 'WASTE' && m.moved_at >= G.date.month(G.TODAY)), m => m.total_cost)), tone: 'warn' },
      { label: 'Ajustes del mes', value: money(U.sum(rows.filter(m => m.movement_type === 'ADJUSTMENT' && m.moved_at >= G.date.month(G.TODAY)), m => m.total_cost)), sub: 'Conteos aprobados' },
    ]));
    body.appendChild(notice('RN-ALM-01: stock_movements y stock_balances solo se escriben con la acción única de inventario. Un intento directo se rechaza; un error se corrige con un reverso que queda en el kardex.', 'info'));
    body.appendChild(kardexTable(rows, 'alm03', 25, [{ key: 'movement_type', label: 'Tipo', options: MOVE_TYPES }, { key: 'warehouse_id', label: 'Almacén', options: whOpts() }, { key: 'source_type', label: 'Origen', options: [['SALES_ORDER', 'Pedido'], ['STOCK_RECEIPT', 'Recepción'], ['STOCK_TRANSFER', 'Transferencia'], ['STOCK_COUNT', 'Conteo'], ['STOCK_WASTE', 'Merma'], ['INITIAL_LOAD', 'Carga inicial'], ['PRODUCTION', 'Producción']], value: m => m.source_type }, { key: 'brand', label: 'Marca', options: brandOpts(), value: m => (G.variant(m.variant_id) || {}).brand_id }]));
  }

  /* ---------- ALM-04 Recepción ---------- */
  function alm04(el, params = {}) {
    const can = G.can('alm.receipt.create');
    const body = page(el, { code: 'ALM-04', title: 'Recepción', sub: 'Recepción con control de calidad mínimo: temperatura del vehículo y del producto, peso, aspecto y resultado. Cada línea aprobada crea su lote en cuarentena (RN-ALM-05, RN-ALM-06).', actions: [can ? { label: 'Nueva recepción', kind: 'primary', icon: '+', onClick: () => newReceipt() } : null].filter(Boolean) });
    const rows = G.scope.filter(G.db.all('stock_receipts').map(r => Object.assign({}, r, { _ref: r })), { brand: '_', site: 'establishment_id' });
    const lines = G.db.all('stock_receipt_lines'); const byR = U.groupBy(lines, 'receipt_id');
    const k6 = G.kpi('KPI-ALM-06') || {};
    body.appendChild(kpis([
      { label: 'Recepciones del mes', value: rows.filter(r => r.received_at >= G.date.month(G.TODAY)).length },
      { label: 'Por confirmar', value: rows.filter(r => r.status === 'DRAFT').length, tone: rows.some(r => r.status === 'DRAFT') ? 'warn' : '' },
      { label: 'Líneas observadas o rechazadas', value: G.fmt.pct(k6.value), sub: `${k6.numerator || 0} de ${k6.denominator || 0} · KPI-ALM-06` },
      { label: 'Límites de temperatura', value: `${G.param('alm_max_temp_chilled_c')} / ${G.param('alm_max_temp_frozen_c')} °C`, sub: 'Refrigerado / congelado (D-ALM-02)' },
    ]));
    body.appendChild(table({
      id: 'alm04', rows, sort: 'received_at', dir: -1,
      columns: [
        { key: 'number', label: 'Número', mono: true },
        { key: 'received_at', label: 'Recibido', render: r => G.fmt.datetime(r.received_at) },
        { key: 'source_type', label: 'Origen', value: r => srcName(r.source_type) },
        { key: 'supplier_id', label: 'Proveedor', value: r => G.supName(r.supplier_id) },
        { key: 'supplier_doc', label: 'Comprobante', mono: true },
        { key: 'warehouse_id', label: 'Almacén', value: r => (whOf(r.warehouse_id) || {}).code },
        { key: 'vehicle_temp_c', label: 'T° vehículo', align: 'r', render: r => r.vehicle_temp_c == null ? '—' : G.fmt.num(r.vehicle_temp_c, 1) + ' °C' },
        { key: 'lines', label: 'Líneas', align: 'r', value: r => (byR[r.id] || []).length, render: r => { const ls = byR[r.id] || []; const bad = ls.filter(l => l.qc_result === 'FAIL').length; return h('span', null, ls.length, bad ? badge(`${bad} rechazada`, 'bad') : null); } },
        { key: 'status', label: 'Estado', render: r => G.ui.status(r.status) },
      ],
      filters: [{ key: 'status', label: 'Estado', options: [['DRAFT', 'Borrador'], ['CONFIRMED', 'Confirmada'], ['VOIDED', 'Anulada']] }, { key: 'source_type', label: 'Origen', options: SOURCE_TYPES }],
      onRow: r => openReceipt(r._ref),
    }));
    if (params.id) { const rc = G.db.get('stock_receipts', params.id); if (rc) setTimeout(() => openReceipt(rc), 0); }
    if (params.new) setTimeout(() => newReceipt(), 0);
  }
  function openReceipt(rc) {
    drawer(`Recepción ${rc.number}`, (bd, close) => {
      const ls = G.db.where('stock_receipt_lines', l => l.receipt_id === rc.id);
      if (rc.status === 'DRAFT' && G.can('alm.receipt.create')) {
        bd.appendChild(h('div', { class: 'row' }, btn('Confirmar recepción', () => { const r = tryDo(() => A.confirmReceipt(rc.id), x => `Recepción confirmada: ${x.accepted} línea(s) entraron en cuarentena`); if (r) close(); }, { kind: 'primary', sm: true }), btn('Anular', () => modal('Anular recepción', b2 => b2.appendChild(form({ id: 'alm04-void', submitLabel: 'Anular', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], onSubmit: v => { try { A.voidReceipt(rc.id, v.reason); G.ui.closeAll(); toast('Recepción anulada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))), { sm: true, kind: 'danger' })));
      }
      bd.appendChild(dl([['Origen', srcName(rc.source_type)], ['Proveedor', G.supName(rc.supplier_id)], ['Comprobante del proveedor', rc.supplier_doc], ['Almacén', G.whName(rc.warehouse_id)], ['Recibido', G.fmt.datetime(rc.received_at) + ' · ' + G.userName(rc.received_by)], ['Temperatura del vehículo', rc.vehicle_temp_c == null ? '—' : G.fmt.num(rc.vehicle_temp_c, 1) + ' °C'], ['Estado', G.ui.status(rc.status)], ['Motivo de anulación', rc.void_reason]]));
      bd.appendChild(card('Líneas y control', table({
        id: 'alm04-l-' + rc.id, rows: ls, search: false,
        columns: [
          { key: 'variant_id', label: 'Producto', value: l => G.variantName(l.variant_id) },
          { key: 'qty', label: 'Cantidad', align: 'r', render: l => qtyTxt(l.qty, G.variant(l.variant_id)) },
          { key: 'weight_kg', label: 'Peso', align: 'r', render: l => l.weight_kg ? G.fmt.kg(l.weight_kg, 3) : '—' },
          { key: 'product_temp_c', label: 'T° producto', align: 'r', render: l => l.product_temp_c == null ? '—' : G.fmt.num(l.product_temp_c, 1) + ' °C' },
          { key: 'appearance', label: 'Aspecto', render: l => badge((APPEAR.find(a => a[0] === l.appearance) || [, l.appearance])[1], l.appearance === 'OK' ? 'ok' : l.appearance === 'OBSERVED' ? 'warn' : 'bad') },
          { key: 'qc_result', label: 'Resultado', render: l => badge((QC.find(a => a[0] === l.qc_result) || [, l.qc_result])[1], l.qc_result === 'PASS' ? 'ok' : l.qc_result === 'FAIL' ? 'bad' : 'warn') },
          { key: 'expiry_date', label: 'Vence', render: l => G.fmt.date(l.expiry_date) },
          { key: 'lot_id', label: 'Lote creado', render: l => l.lot_id ? h('a', { href: '#', on: { click: e => { e.preventDefault(); G.go('ALM-05', { lot: l.lot_id }); } } }, lotOf(l.lot_id).code) : '—' },
          { key: 'qc_notes', label: 'Nota' },
        ],
      })));
      if (rc.status === 'DRAFT') { const errs = ls.map(A.checkReceiptLine).filter(Boolean); if (errs.length) bd.appendChild(notice(h('div', null, h('b', null, 'Antes de confirmar: '), errs.join(' · ')), 'warn')); }
    }, { code: 'ALM-04', wide: true });
  }
  function newReceipt() {
    drawer('Nueva recepción', (bd, close) => {
      const head = { source_type: 'FARM', supplier_id: 'su-GRANJA', warehouse_id: 'wh-CUA-L1', vehicle_temp_c: '', supplier_doc: '' };
      const rows = [{ variant_id: 'va-DG-CUY-ENT', qty: 40, weight_kg: 36.4, product_temp_c: 3.5, appearance: 'OK', qc_result: 'PASS', qc_notes: '' }];
      const f = form({ id: 'alm04-new', values: head, submitLabel: false, fields: [{ key: 'source_type', label: 'Origen', type: 'select', options: SOURCE_TYPES, required: true, onChange: (v, vals, api) => { if (v === 'FARM') api.set('supplier_id', 'su-GRANJA'); } }, { key: 'supplier_id', label: 'Proveedor o granja', type: 'select', options: G.db.where('suppliers', s => ['RELATED_FARM', 'PRODUCER', 'SLAUGHTERHOUSE', 'PACKAGING', 'INPUTS'].includes(s.supplier_type)).map(s => [s.id, s.trade_name || s.legal_name]) }, { key: 'supplier_doc', label: 'Comprobante o guía del proveedor' }, { key: 'warehouse_id', label: 'Almacén de recepción', type: 'select', required: true, options: whOpts(w => ['QUARANTINE', 'COLD_ROOM', 'FREEZER', 'MAIN'].includes(w.wh_type)) }, { key: 'vehicle_temp_c', label: 'Temperatura del vehículo (°C)', type: 'number' }] });
      bd.appendChild(f);
      const live = h('div');
      const check = () => { G.ui.clear(live); const errs = rows.map(A.checkReceiptLine).filter(Boolean); live.appendChild(errs.length ? notice(h('div', null, errs.map(e => h('div', null, e))), 'warn') : notice('Todas las líneas están controladas. Al confirmar, las aprobadas crean su lote en CUARENTENA.', 'ok')); };
      bd.appendChild(card('Líneas con control de calidad', [lineEditor([
        { key: 'variant_id', label: 'Producto', type: 'select', options: variantOpts(v => v.sale_mode !== undefined), min: '220px' },
        { key: 'qty', label: 'Cantidad', type: 'number' },
        { key: 'weight_kg', label: 'Peso kg', type: 'number' },
        { key: 'expiry_date', label: 'Vence', type: 'date', min: '130px', placeholder: 'según vida útil' },
        { key: 'product_temp_c', label: 'T° producto', type: 'number' },
        { key: 'appearance', label: 'Aspecto', type: 'select', options: APPEAR },
        { key: 'qc_result', label: 'Resultado', type: 'select', options: QC },
        { key: 'qc_notes', label: 'Nota', min: '160px' },
        { key: '_chk', label: 'Control', type: 'calc', render: r => { const e = A.checkReceiptLine(r); return e ? badge(e.slice(0, 9), 'bad') : badge('OK', 'ok'); } },
      ], rows, { onChange: check, blank: () => ({ appearance: 'OK', qc_result: 'PENDING' }) }), live], { flush: false }));
      check();
      bd.appendChild(h('div', { class: 'form-actions' }, btn('Cancelar', close), btn('Guardar borrador', () => save(false)), btn('Guardar y confirmar', () => save(true), { kind: 'primary' })));
      function save(confirmNow) {
        try {
          const v = f.api.values;
          const rc = A.createReceipt({ source_type: v.source_type, supplier_id: v.supplier_id, supplier_doc: v.supplier_doc, warehouse_id: v.warehouse_id, vehicle_temp_c: v.vehicle_temp_c, lines: rows });
          if (confirmNow) { try { const r = A.confirmReceipt(rc.id); toast(`Recepción ${rc.number} confirmada: ${r.lots.length} lote(s) en cuarentena`, 'ok'); } catch (e) { toast(`Borrador ${rc.number} guardado, pero no se confirmó. ${e.message}`, 'bad'); } }
          else toast(`Borrador ${rc.number} guardado`, 'ok');
          close(); G.refresh();
        } catch (e) { toast(e.message, 'bad'); }
      }
    }, { code: 'ALM-04', wide: true });
  }

  /* ---------- ALM-05 Lotes ---------- */
  function lotUsage(lotId) {
    const ids = new Set();
    for (const m of G.db.where('stock_movements', m => m.lot_id === lotId && m.source_type === 'SALES_ORDER')) ids.add(m.source_id);
    for (const o of G.db.where('sales_orders', o => (o.reservations || []).some(r => r.lot_id === lotId) || (o.lines || []).some(l => l.lot_id === lotId))) ids.add(o.id);
    for (const s of G.db.where('picking_scans', s => s.lot_id === lotId && s.result === 'OK')) { const t = G.db.get('picking_tasks', s.task_id); if (t) ids.add(t.order_id); }
    return [...ids].map(id => G.db.get('sales_orders', id)).filter(Boolean);
  }
  function alm05(el, params = {}) {
    const body = page(el, { code: 'ALM-05', title: 'Lotes', sub: 'Lotes con estado de calidad, vencimiento, stock por almacén y pedidos que lo usaron. Un lote en cuarentena, bloqueado, rechazado o retirado no se vende.' });
    const stockBy = U.groupBy(G.db.where('stock_balances', b => b.lot_id && Math.abs(b.qty) > 0.0005), 'lot_id');
    const rows = G.db.all('lots').map(l => { const v = G.variant(l.variant_id) || {}; const bs = stockBy[l.id] || []; return Object.assign({}, l, { brand_id: v.brand_id, vname: v.name, line: v.line, stock: R(U.sum(bs, b => b.qty), 3), reserved: R(U.sum(bs, b => b.reserved_qty || 0), 3), value: R(U.sum(bs, b => b.qty * (b.avg_cost || 0))), whs: bs.map(b => (whOf(b.warehouse_id) || {}).code).join(', '), days: daysLeft(l), v, _ref: l }); }).filter(r => G.scope.ok(r, { site: '_' }));
    const c = s => rows.filter(r => r.qc_status === s).length;
    body.appendChild(kpis([
      { label: 'Lotes con stock', value: rows.filter(r => r.stock > 0).length, sub: `${rows.length} en total` },
      { label: 'En cuarentena', value: c('QUARANTINE'), tone: c('QUARANTINE') ? 'warn' : '', onClick: () => G.go('ALM-06') },
      { label: 'Bloqueados', value: c('BLOCKED'), tone: c('BLOCKED') ? 'bad' : '' },
      { label: 'Vencen en 7 días (con stock)', value: rows.filter(r => r.stock > 0 && r.days !== null && r.days <= 7).length, tone: 'warn', onClick: () => G.go('ALM-11') },
    ]));
    body.appendChild(table({
      id: 'alm05', rows, sort: 'expiry_date',
      columns: [
        { key: 'code', label: 'Lote', mono: true },
        { key: 'vname', label: 'Producto' },
        { key: 'brand_id', label: 'Marca', render: r => G.brandName(r.brand_id) },
        { key: 'origin', label: 'Origen', value: r => ({ FARM: 'Granja', PURCHASE: 'Compra', PRODUCTION: 'Producción', CUTTING: 'Despiece', RETURN: 'Devolución' }[r.origin] || r.origin) },
        { key: 'production_date', label: 'Producción', render: r => G.fmt.date(r.production_date) },
        { key: 'expiry_date', label: 'Vence', render: r => h('span', null, G.fmt.date(r.expiry_date), ' ', r.stock > 0 && r.days !== null && r.days <= 7 ? badge(r.days < 0 ? 'vencido' : G.fmt.days(r.days), r.days <= 3 ? 'bad' : 'warn') : null) },
        { key: 'qc_status', label: 'Estado', render: r => G.ui.status(r.qc_status) },
        { key: 'stock', label: 'Stock', align: 'r', render: r => qtyTxt(r.stock, r.v) },
        { key: 'whs', label: 'Almacenes' },
        { key: 'value', label: 'Valor', align: 'r', render: r => money(r.value) },
      ],
      filters: [{ key: 'qc_status', label: 'Estado', options: LOT_STATUS }, { key: 'brand_id', label: 'Marca', options: brandOpts() }, { key: 'line', label: 'Línea', options: lineOpts() }, { key: 'has', label: 'Stock', options: [['1', 'Con stock'], ['0', 'Sin stock']], value: r => r.stock > 0 ? '1' : '0' }],
      onRow: r => openLot(r._ref),
    }));
    if (params.lot) { const l = lotOf(params.lot); if (l) setTimeout(() => openLot(l), 0); }
  }
  function openLot(lot) {
    drawer(`Lote ${lot.code}`, bd => {
      const v = G.variant(lot.variant_id);
      bd.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap' }, lotBadge(lot), (LOT_FLOW[lot.qc_status] || []).length && (G.can('alm.lot.release') || G.can('alm.lot.block')) ? btn('Liberar o bloquear', () => G.go('ALM-06', { lot: lot.id }), { sm: true, kind: 'primary' }) : null));
      bd.appendChild(dl([['Producto', `${v.sku} · ${v.name}`], ['Marca', G.brandName(v.brand_id)], ['Origen', lot.origin], ['Proveedor', G.supName(lot.supplier_id)], ['Producción', G.fmt.date(lot.production_date)], ['Vencimiento', G.fmt.date(lot.expiry_date) + (daysLeft(lot) !== null ? ` (${daysLeft(lot) < 0 ? 'vencido' : 'faltan ' + G.fmt.days(daysLeft(lot))})` : '')], ['Costo unitario', money(lot.unit_cost)], ['Peso recibido', lot.received_weight_kg ? G.fmt.kg(lot.received_weight_kg, 3) : '—'], ['Liberado', lot.released_at ? G.fmt.datetime(lot.released_at) + ' · ' + (lot.released_by || '') : '—'], ['Motivo de bloqueo', lot.block_reason], ['Recepción', lot.receipt_id ? (G.db.get('stock_receipts', lot.receipt_id) || {}).number : '—']]));
      const bs = A.lotStock(lot.id).filter(b => Math.abs(b.qty) > 0.0005);
      bd.appendChild(card('Stock por almacén', bs.length ? h('div', { class: 'stack', style: 'gap:4px' }, bs.map(b => h('div', { class: 'between small' }, h('span', null, G.whName(b.warehouse_id)), h('span', null, `${qtyTxt(b.qty, v)} · reservado ${qtyTxt(b.reserved_qty || 0, v)}${b.weight_kg ? ' · ' + G.fmt.kg(b.weight_kg, 3) : ''}`)))) : G.ui.empty('Sin stock.')));
      const os = lotUsage(lot.id);
      bd.appendChild(card(`Pedidos que lo usaron o reservaron (${os.length})`, os.length ? h('div', { class: 'stack', style: 'gap:4px' }, os.slice(0, 40).map(o => h('div', { class: 'between small' }, h('span', null, `${o.number} · ${G.custName(o.customer_id)}`), G.ui.status(o.status)))) : G.ui.empty('Ningún pedido aún.')));
      const hist = G.db.where('lot_status_changes', x => x.lot_id === lot.id).sort(U.by('changed_at'));
      bd.appendChild(card('Historial de estado (RN-ALM-07)', h('div', { class: 'timeline' }, hist.map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, G.fmt.datetime(x.changed_at)), h('span', { class: 'dot' }), h('div', null, h('b', null, `${x.from_status === 'NEW' ? 'Creado' : G.ui.statusLabel(x.from_status)} → ${G.ui.statusLabel(x.to_status)}`), h('div', { class: 'small muted' }, `${x.reason} · ${G.userName(x.changed_by)}`)))))));
      const mv = G.db.where('stock_movements', m => m.lot_id === lot.id);
      bd.appendChild(card('Kardex del lote', kardexTable(mv, 'alm05-k', 8)));
    }, { code: 'ALM-05', wide: true });
  }

  /* ---------- ALM-06 Liberar o bloquear lote ---------- */
  function alm06(el, params = {}) {
    const body = page(el, { code: 'ALM-06', title: 'Liberar o bloquear lote', sub: 'Cambio de estado del lote con motivo e historial. Liberar requiere alm.lot.release (D-ALM-01: el almacenero en la fase 1); bloquear, rechazar o retirar, alm.lot.block.' });
    const pend = G.db.where('lots', l => l.qc_status === 'QUARANTINE' && A.lotStock(l.id).some(b => b.qty > 0));
    const sel = params.lot || (pend[0] && pend[0].id) || 'lo-Q001';
    const lot = lotOf(sel);
    const grid = h('div', { class: 'grid side-r' });
    const left = h('div', { class: 'stack', style: 'gap:14px' });
    const lotSel = h('select', { class: 'input', attrs: { 'aria-label': 'Lote' } }, G.db.all('lots').filter(l => !['REJECTED', 'RECALLED'].includes(l.qc_status) || l.id === sel).sort((a, b) => (a.qc_status === 'QUARANTINE' ? 0 : 1) - (b.qc_status === 'QUARANTINE' ? 0 : 1) || a.code.localeCompare(b.code)).map(l => h('option', { value: l.id, selected: l.id === sel }, `${l.code} · ${G.variantName(l.variant_id)} · ${G.ui.statusLabel(l.qc_status)}`)));
    lotSel.addEventListener('change', () => G.go('ALM-06', { lot: lotSel.value }));
    left.appendChild(card('Lote', [lotSel, lot ? h('div', { style: 'margin-top:10px' }, lotBadge(lot), dl([['Producto', G.variantName(lot.variant_id)], ['Vence', G.fmt.date(lot.expiry_date)], ['Stock', A.lotStock(lot.id).filter(b => b.qty > 0).map(b => `${(whOf(b.warehouse_id) || {}).code}: ${G.fmt.num(b.qty, 3)}`).join(' · ') || 'Sin stock'], ['Motivo actual', lot.block_reason]])) : null]));
    if (lot) {
      const opts = (LOT_FLOW[lot.qc_status] || []).map(s => [s, { RELEASED: 'Liberar', BLOCKED: 'Bloquear', REJECTED: 'Rechazar', RECALLED: 'Retirar (recall)' }[s]]);
      if (!opts.length) left.appendChild(notice(`RN-ALM-07: el lote está ${G.ui.statusLabel(lot.qc_status).toLowerCase()} y ya no cambia de estado.`, 'warn'));
      else {
        const inQ = A.lotStock(lot.id).some(b => b.qty > 0 && (whOf(b.warehouse_id) || {}).wh_type === 'QUARANTINE');
        const p = prodOf(lot.variant_id);
        const dest = p.storage === 'FROZEN' ? 'wh-CNG-L1' : p.storage === 'CHILLED' ? 'wh-CAM-L1' : 'wh-ALM-L1';
        left.appendChild(card('Cambiar estado', form({
          id: 'alm06', values: { to: opts[0][0], move_to: inQ ? dest : '' }, submitLabel: 'Aplicar',
          fields: [{ key: 'to', label: 'Acción', type: 'select', options: opts, required: true }, { key: 'reason', label: 'Motivo (obligatorio para bloquear, rechazar o retirar)', type: 'textarea' }, inQ ? { key: 'move_to', label: 'Al liberar, mover desde cuarentena a', type: 'select', options: whOpts(w => w.establishment_id === siteOfWh(A.lotStock(lot.id).find(b => b.qty > 0).warehouse_id) && w.allows_sale) } : null].filter(Boolean),
          onSubmit: v => { try { const r = A.setLotStatus(lot.id, v.to, v.reason, { moveTo: v.to === 'RELEASED' ? v.move_to : null }); toast(`Lote ${lot.code}: ${G.ui.statusLabel(v.to).toLowerCase()}${r.rereserved.length ? ` · ${r.rereserved.length} pedido(s) se reservaron de otro lote` : ''}`, 'ok'); G.refresh(); return true; } catch (e) { return e.message; } },
        })));
      }
    }
    const right = h('div', { class: 'stack', style: 'gap:14px' });
    right.appendChild(card(`Pendientes de liberar (${pend.length})`, pend.length ? h('div', { class: 'stack', style: 'gap:6px' }, pend.map(l => h('div', { class: 'between', style: 'gap:8px' }, h('div', null, h('b', { class: 'mono' }, l.code), h('div', { class: 'small muted' }, `${G.variantName(l.variant_id)} · ${G.supName(l.supplier_id)}`)), btn('Abrir', () => G.go('ALM-06', { lot: l.id }), { sm: true })))) : G.ui.empty('No hay lotes en cuarentena.')));
    grid.append(left, right);
    body.appendChild(grid);
    const hist = G.db.all('lot_status_changes').filter(x => x.from_status !== 'NEW' || x.lot_id === sel);
    body.appendChild(card('Historial de cambios de estado', table({ id: 'alm06-h', rows: hist, sort: 'changed_at', dir: -1, pageSize: 12, columns: [{ key: 'changed_at', label: 'Fecha', render: x => G.fmt.datetime(x.changed_at) }, { key: 'lot_id', label: 'Lote', mono: true, value: x => (lotOf(x.lot_id) || {}).code }, { key: 'prod', label: 'Producto', value: x => G.variantName((lotOf(x.lot_id) || {}).variant_id) }, { key: 'from_status', label: 'De', render: x => x.from_status === 'NEW' ? 'Creado' : G.ui.status(x.from_status) }, { key: 'to_status', label: 'A', render: x => G.ui.status(x.to_status) }, { key: 'reason', label: 'Motivo' }, { key: 'changed_by', label: 'Usuario', value: x => G.userName(x.changed_by) }], filters: [{ key: 'to_status', label: 'Estado', options: LOT_STATUS }], onRow: x => G.go('ALM-06', { lot: x.lot_id }) }), { flush: true }));
  }

  /* ---------- ALM-07 Transferencias ---------- */
  function alm07(el, params = {}) {
    const body = page(el, { code: 'ALM-07', title: 'Transferencias', sub: 'Solicitud entre almacenes o locales, despacho con guía de remisión T001/T002 cuando cambia de local (RN-ALM-10) y recepción con lo recibido y la diferencia con motivo (RN-ALM-11).', actions: [G.can('alm.transfer.create') ? { label: 'Nueva transferencia', kind: 'primary', icon: '+', onClick: () => newTransfer() } : null].filter(Boolean) });
    const ls = U.groupBy(G.db.all('stock_transfer_lines'), 'transfer_id');
    const rows = G.db.all('stock_transfers').filter(t => G.ctx.site === 'ALL' || t.from_site === G.ctx.site || t.to_site === G.ctx.site).map(t => Object.assign({}, t, { _ref: t, n: (ls[t.id] || []).length }));
    body.appendChild(kpis([
      { label: 'Por despachar', value: rows.filter(t => t.status === 'DRAFT').length, tone: 'info' },
      { label: 'En tránsito', value: rows.filter(t => t.status === 'DISPATCHED').length, tone: rows.some(t => t.status === 'DISPATCHED') ? 'warn' : '', onClick: () => G.go('ALM-12') },
      { label: 'Recibidas con diferencia', value: rows.filter(t => t.status === 'RECEIVED_WITH_DIFF').length },
      { label: 'Guías emitidas (T001/T002)', value: rows.filter(t => t.guide_number).length, sub: G.fac ? 'Con FAC' : 'Numeradas con la serie (FAC no incluido)' },
    ]));
    body.appendChild(table({
      id: 'alm07', rows, sort: 'requested_at', dir: -1,
      columns: [
        { key: 'number', label: 'Número', mono: true },
        { key: 'requested_at', label: 'Solicitada', render: t => G.fmt.datetime(t.requested_at) },
        { key: 'from_warehouse_id', label: 'Origen', value: t => G.whName(t.from_warehouse_id) },
        { key: 'to_warehouse_id', label: 'Destino', value: t => G.whName(t.to_warehouse_id) },
        { key: 'requires_guide', label: 'Entre locales', render: t => t.requires_guide ? badge('Sí · GRE', 'info') : 'No' },
        { key: 'guide_number', label: 'Guía', mono: true },
        { key: 'n', label: 'Líneas', align: 'r' },
        { key: 'status', label: 'Estado', render: t => G.ui.status(t.status === 'RECEIVED_WITH_DIFF' ? 'DIFFERENCE' : t.status === 'RECEIVED' ? 'DELIVERED' : t.status === 'DISPATCHED' ? 'IN_TRANSIT' : t.status) },
      ],
      filters: [{ key: 'status', label: 'Estado', options: [['DRAFT', 'Borrador'], ['DISPATCHED', 'En tránsito'], ['RECEIVED', 'Recibida'], ['RECEIVED_WITH_DIFF', 'Recibida con diferencia'], ['CANCELLED', 'Cancelada']] }],
      onRow: t => openTransfer(t._ref),
    }));
    if (params.id) { const t = G.db.get('stock_transfers', params.id); if (t) setTimeout(() => openTransfer(t), 0); }
    if (params.new) setTimeout(() => newTransfer(params), 0);
  }
  function openTransfer(tr) {
    drawer(`Transferencia ${tr.number}`, (bd, close) => {
      const ls = G.db.where('stock_transfer_lines', l => l.transfer_id === tr.id);
      const acts = h('div', { class: 'row', style: 'flex-wrap:wrap' });
      if (tr.status === 'DRAFT' && G.can('alm.transfer.create')) {
        if (tr.requires_guide && !tr.guide_number) acts.appendChild(btn('Emitir guía de remisión', () => tryDo(() => A.issueGuide(tr.id), g => `Guía ${g} emitida (motivo 04)`) && (close(), openTransfer(tr)), { sm: true, kind: 'accent' }));
        acts.appendChild(btn('Despachar', () => { if (tryDo(() => A.dispatchTransfer(tr.id), t => t.status === 'RECEIVED' ? 'Traslado interno registrado' : 'Transferencia despachada: queda en tránsito')) { close(); openTransfer(tr); } }, { sm: true, kind: 'primary' }));
        acts.appendChild(btn('Cancelar', () => modal('Cancelar transferencia', b2 => b2.appendChild(form({ id: 'alm07-c', submitLabel: 'Cancelar transferencia', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], onSubmit: v => { try { A.cancelTransfer(tr.id, v.reason); G.ui.closeAll(); toast('Transferencia cancelada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))), { sm: true, kind: 'danger' }));
      }
      if (tr.status === 'DISPATCHED' && G.can('alm.transfer.receive')) acts.appendChild(btn('Recibir', () => receiveForm(tr), { sm: true, kind: 'primary' }));
      if (acts.children.length) bd.appendChild(acts);
      if (tr.status === 'DRAFT' && tr.requires_guide && !tr.guide_number) bd.appendChild(notice('RN-ALM-10: va de un local a otro; sale solo con la guía de remisión emitida (RN-FAC-11, motivo 04).', 'warn'));
      const steps = [['DRAFT', 'Solicitada'], ['GUIDE', 'Guía'], ['DISPATCHED', 'En tránsito'], ['RECEIVED', 'Recibida']].filter(s => tr.requires_guide || !['GUIDE', 'DISPATCHED'].includes(s[0]));
      const cur = tr.status === 'DRAFT' ? (tr.guide_number ? 2 : 1) : tr.status === 'DISPATCHED' ? 3 : 4;
      bd.appendChild(h('div', { class: 'steps' }, steps.map((s, i) => h('div', { class: 'step ' + (i + 1 < cur ? 'done' : i + 1 === cur ? 'cur' : '') }, h('span', { class: 'n' }, i + 1), s[1]))));
      bd.appendChild(dl([['Origen', G.whName(tr.from_warehouse_id) + ' · ' + G.siteName(tr.from_site)], ['Destino', G.whName(tr.to_warehouse_id) + ' · ' + G.siteName(tr.to_site)], ['Guía de remisión', tr.guide_number ? `${tr.guide_number} (motivo 04, traslado entre establecimientos)` : tr.requires_guide ? 'Pendiente' : 'No requiere (mismo local)'], ['Solicitada', G.fmt.datetime(tr.requested_at) + ' · ' + G.userName(tr.requested_by)], ['Despachada', tr.dispatched_at ? G.fmt.datetime(tr.dispatched_at) + ' · ' + G.userName(tr.dispatched_by) : '—'], ['Recibida', tr.received_at ? G.fmt.datetime(tr.received_at) + ' · ' + G.userName(tr.received_by) : '—'], ['Notas', tr.notes]]));
      bd.appendChild(card('Líneas', table({ id: 'alm07-l-' + tr.id, rows: ls, search: false, columns: [{ key: 'variant_id', label: 'Producto', value: l => G.variantName(l.variant_id) }, { key: 'lot', label: 'Lote(s)', render: l => (l.moved && l.moved.length ? l.moved.map(m => (lotOf(m.lot_id) || {}).code) : [l.lot_id ? lotOf(l.lot_id).code : 'FEFO al despachar']).join(', ') }, { key: 'qty', label: 'Enviado', align: 'r', render: l => qtyTxt(l.qty, G.variant(l.variant_id)) }, { key: 'weight_kg', label: 'Peso', align: 'r', render: l => l.weight_kg ? G.fmt.kg(l.weight_kg, 3) : '—' }, { key: 'received_qty', label: 'Recibido', align: 'r', render: l => l.received_qty == null ? '—' : qtyTxt(l.received_qty, G.variant(l.variant_id)) }, { key: 'diff', label: 'Diferencia', align: 'r', render: l => l.received_qty == null ? '—' : h('span', { style: l.received_qty < l.qty ? 'color:var(--bad)' : '' }, G.fmt.num(l.received_qty - l.qty, 3)) }, { key: 'difference_reason', label: 'Motivo' }] })));
    }, { code: 'ALM-07', wide: true });
  }
  function receiveForm(tr) {
    const ls = G.db.where('stock_transfer_lines', l => l.transfer_id === tr.id);
    const rows = ls.map(l => ({ line_id: l.id, name: G.variantName(l.variant_id), sent: l.qty, received_qty: l.qty, difference_reason: '' }));
    drawer(`Recibir ${tr.number}`, (bd, close) => {
      bd.appendChild(notice('RN-ALM-11: registra lo recibido por línea. Si difiere de lo enviado, el motivo es obligatorio y la diferencia queda como merma «Diferencia en traslado».', 'info'));
      bd.appendChild(lineEditor([{ key: 'name', label: 'Producto', type: 'calc', render: r => r.name }, { key: 'sent', label: 'Enviado', type: 'calc', align: 'r', render: r => G.fmt.num(r.sent, 3) }, { key: 'received_qty', label: 'Recibido', type: 'number' }, { key: 'difference_reason', label: 'Motivo de la diferencia', min: '200px' }], rows, { fixed: true }));
      bd.appendChild(h('div', { class: 'form-actions' }, btn('Cancelar', close), btn('Confirmar recepción', () => { if (tryDo(() => A.receiveTransfer(tr.id, rows), t => t.status === 'RECEIVED' ? 'Transferencia recibida completa' : 'Recibida con diferencia: se registró la merma')) G.ui.closeAll(); }, { kind: 'primary' })));
    }, { code: 'ALM-07', wide: true });
  }
  function newTransfer(p = {}) {
    drawer('Nueva transferencia', (bd, close) => {
      const head = { from: p.from || 'wh-CAM-L1', to: 'wh-CAM-L2', notes: '' };
      const rows = [{ variant_id: p.variant || 'va-M3-CHO-1K', lot_id: p.lot || '', qty: p.variant ? 1 : 20 }];
      const info = h('div');
      const upd = () => { G.ui.clear(info); const fs = siteOfWh(head.from), ts = siteOfWh(head.to); info.appendChild(fs !== ts ? notice(`Cambia de local (${G.siteName(fs)} → ${G.siteName(ts)}): se emitirá guía de remisión ${fs === 'es-L2' ? 'T002' : 'T001'} antes de despachar (RN-ALM-10).`, 'info') : notice('Mismo local: no requiere guía; se registra como traslado interno.', 'ok')); };
      const f = form({ id: 'alm07-new', values: head, submitLabel: false, fields: [{ key: 'from', label: 'Desde', type: 'select', required: true, options: whOpts(w => !['TRANSIT'].includes(w.wh_type)), onChange: (v) => { head.from = v; upd(); } }, { key: 'to', label: 'Hacia', type: 'select', required: true, options: whOpts(w => !['TRANSIT'].includes(w.wh_type)), onChange: v => { head.to = v; upd(); } }, { key: 'notes', label: 'Notas', span: 2 }] });
      bd.append(f, info); upd();
      bd.appendChild(card('Líneas', lineEditor([{ key: 'variant_id', label: 'Producto', type: 'select', options: variantOpts(), min: '220px' }, { key: 'lot_id', label: 'Lote', type: 'select', blank: 'FEFO automático', options: r => lotsFor(r.variant_id, head.from), min: '220px' }, { key: 'qty', label: 'Cantidad', type: 'number' }, { key: '_d', label: 'Disponible', type: 'calc', align: 'r', render: r => G.fmt.num(G.inv.qty(r.variant_id, head.from, { available: true, releasedOnly: true }), 3) }], rows, { blank: () => ({ qty: 1 }) })));
      bd.appendChild(h('div', { class: 'form-actions' }, btn('Cancelar', close), btn('Crear', () => { const t = tryDo(() => A.createTransfer({ from: f.api.values.from, to: f.api.values.to, notes: f.api.values.notes, lines: rows.map(r => ({ variant_id: r.variant_id, lot_id: r.lot_id || null, qty: Number(r.qty) })) }), t => `Transferencia ${t.number} creada`); if (t) { close(); openTransfer(t); } }, { kind: 'primary' })));
    }, { code: 'ALM-07', wide: true });
  }

  /* ---------- ALM-08 Conteos ---------- */
  function alm08(el, params = {}) {
    const body = page(el, { code: 'ALM-08', title: 'Conteos', sub: 'Conteo ciego por almacén o ubicación desde el celular con lector: compara con el sistema y la aprobación (otra persona, alm.count.approve) genera los ajustes (RN-ALM-12).', actions: [G.canDo('ALM', 'C') ? { label: 'Nuevo conteo', kind: 'primary', icon: '+', onClick: () => newCount(params.wh) } : null].filter(Boolean) });
    const ls = U.groupBy(G.db.all('stock_count_lines'), 'count_id');
    const rows = G.scope.filter(G.db.all('stock_counts').map(c => { const l = ls[c.id] || []; const counted = l.filter(x => x.counted_qty != null); return Object.assign({}, c, { _ref: c, n: l.length, counted: counted.length, diffs: counted.filter(x => Math.abs(x.counted_qty - x.system_qty) > 0.0005).length }); }), { brand: '_' });
    const k5 = G.kpi('KPI-ALM-05') || {};
    body.appendChild(kpis([
      { label: 'Abiertos', value: rows.filter(c => c.status === 'OPEN').length, tone: 'info' },
      { label: 'Por aprobar', value: rows.filter(c => c.status === 'COUNTED').length, tone: rows.some(c => c.status === 'COUNTED') ? 'warn' : '' },
      { label: 'Exactitud del conteo', value: G.fmt.pct(k5.value), sub: `${k5.numerator || 0} de ${k5.denominator || 0} líneas sin diferencia · KPI-ALM-05` },
      { label: 'Ajustes del mes', value: money(U.sum(G.db.where('stock_movements', m => m.movement_type === 'ADJUSTMENT' && m.moved_at >= G.date.month(G.TODAY)), m => m.total_cost)) },
    ]));
    body.appendChild(table({ id: 'alm08', rows, sort: 'created_at', dir: -1, columns: [{ key: 'number', label: 'Número', mono: true }, { key: 'warehouse_id', label: 'Almacén', value: c => G.whName(c.warehouse_id) }, { key: 'count_type', label: 'Tipo', value: c => ({ FULL: 'Total', CYCLE: 'Cíclico', SPOT: 'Puntual' }[c.count_type]) }, { key: 'blind', label: 'Ciego', render: c => c.blind ? 'Sí' : 'No' }, { key: 'counted', label: 'Avance', render: c => h('span', { class: 'small' }, `${c.counted}/${c.n}`) }, { key: 'diffs', label: 'Con diferencia', align: 'r' }, { key: 'counted_by', label: 'Contó', value: c => G.userShort(c.counted_by || c.created_by) }, { key: 'approved_by', label: 'Aprobó', value: c => c.approved_by ? G.userShort(c.approved_by) : '—' }, { key: 'status', label: 'Estado', render: c => G.ui.status(c.status === 'COUNTED' ? 'PENDING_APPROVAL' : c.status) }], filters: [{ key: 'status', label: 'Estado', options: [['OPEN', 'Abierto'], ['COUNTED', 'Por aprobar'], ['APPROVED', 'Aprobado']] }], onRow: c => openCount(c._ref) }));
    if (params.id) { const c = G.db.get('stock_counts', params.id); if (c) setTimeout(() => openCount(c), 0); }
    else if (params.wh) setTimeout(() => newCount(params.wh), 0);
  }
  function newCount(wh) {
    modal('Nuevo conteo', bd => bd.appendChild(form({ id: 'alm08-new', values: { warehouse_id: wh || 'wh-CAM-L1', count_type: 'CYCLE', blind: true }, submitLabel: 'Crear conteo', fields: [{ key: 'warehouse_id', label: 'Almacén o ubicación', type: 'select', required: true, options: whOpts(w => w.wh_type !== 'TRANSIT') }, { key: 'count_type', label: 'Tipo', type: 'select', options: [['FULL', 'Total'], ['CYCLE', 'Cíclico'], ['SPOT', 'Puntual']] }, { key: 'blind', label: 'Conteo ciego (no muestra el saldo del sistema)', type: 'checkbox' }], onSubmit: v => { try { const c = A.createCount(v); G.ui.closeAll(); toast(`Conteo ${c.number} creado con ${G.db.where('stock_count_lines', l => l.count_id === c.id).length} líneas`, 'ok'); G.refresh(); openCount(c); return true; } catch (e) { return e.message; } } })));
  }
  function openCount(c) {
    drawer(`Conteo ${c.number} · ${G.whName(c.warehouse_id)}`, (bd, close) => {
      const ls = G.db.where('stock_count_lines', l => l.count_id === c.id);
      const showSys = !c.blind || c.status !== 'OPEN';
      const acts = h('div', { class: 'row', style: 'flex-wrap:wrap' });
      if (c.status === 'OPEN') acts.appendChild(btn('Cerrar conteo', () => { if (tryDo(() => A.closeCount(c.id), 'Conteo cerrado: pasa a aprobación')) { close(); openCount(c); } }, { sm: true, kind: 'primary' }));
      if (c.status === 'COUNTED') acts.appendChild(btn('Aprobar y ajustar', () => { const r = tryDo(() => A.approveCount(c.id), a => `Conteo aprobado: ${a.length} ajuste(s) registrados`); if (r) { close(); openCount(c); } }, { sm: true, kind: 'primary' }));
      if (acts.children.length) bd.appendChild(acts);
      if (c.status === 'COUNTED') bd.appendChild(notice(`RN-ALM-12: lo aprueba una persona distinta de quien contó (${G.userName(c.counted_by)}) con el permiso alm.count.approve.`, 'info'));
      if (c.status === 'OPEN') {
        const scan = h('input', { class: 'input', placeholder: 'Escanea o escribe el lote o SKU para ubicar la línea', attrs: { 'aria-label': 'Escanear' } });
        scan.addEventListener('change', () => { const q = scan.value.trim().toUpperCase(); const l = ls.find(x => ((lotOf(x.lot_id) || {}).code || '').toUpperCase() === q || (G.variant(x.variant_id) || {}).sku === q); if (!l) { toast('No hay una línea con ese código en este conteo', 'warn'); return; } const inp = bd.querySelector(`[data-line="${l.id}"]`); if (inp) { inp.focus(); inp.scrollIntoView({ block: 'center' }); } scan.value = ''; });
        bd.appendChild(scan);
      }
      const tb = h('tbody');
      for (const l of ls) {
        const v = G.variant(l.variant_id); const d = l.counted_qty != null ? R(l.counted_qty - l.system_qty, 3) : null;
        const inp = c.status === 'OPEN' ? h('input', { class: 'input', type: 'number', value: l.counted_qty ?? '', attrs: { step: 'any', 'data-line': l.id, 'aria-label': 'Contado' }, style: 'width:100px' }) : null;
        if (inp) inp.addEventListener('change', () => { try { A.setCounted(l.id, inp.value); } catch (e) { toast(e.message, 'bad'); } });
        tb.appendChild(h('tr', null, h('td', null, v.sku), h('td', null, v.name), h('td', { class: 'mono' }, (lotOf(l.lot_id) || {}).code || '—'), h('td', { class: 'r' }, showSys ? qtyTxt(l.system_qty, v) : '••••'), h('td', { class: 'r' }, inp || qtyTxt(l.counted_qty, v)), h('td', { class: 'r' }, showSys && d !== null ? h('span', { style: d ? 'color:var(--bad);font-weight:700' : 'color:var(--ok)' }, (d > 0 ? '+' : '') + G.fmt.num(d, 3)) : '—')));
      }
      bd.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['SKU', 'Producto', 'Lote', 'Sistema', 'Contado', 'Diferencia'].map((x, i) => h('th', { class: i >= 3 ? 'r' : '' }, x)))), tb)));
      bd.appendChild(dl([['Tipo', { FULL: 'Total', CYCLE: 'Cíclico', SPOT: 'Puntual' }[c.count_type]], ['Ciego', c.blind ? 'Sí (el saldo del sistema se muestra al cerrar)' : 'No'], ['Contó', c.counted_by ? G.userName(c.counted_by) + ' · ' + G.fmt.datetime(c.counted_at) : '—'], ['Aprobó', c.approved_by ? G.userName(c.approved_by) + ' · ' + G.fmt.datetime(c.approved_at) : '—'], ['Estado', G.ui.status(c.status === 'COUNTED' ? 'PENDING_APPROVAL' : c.status)]]));
    }, { code: 'ALM-08', wide: true });
  }

  /* ---------- ALM-09 Mermas ---------- */
  function alm09(el, params = {}) {
    const body = page(el, { code: 'ALM-09', title: 'Mermas', sub: 'Registro con motivo, cantidad, peso, foto y costo estimado. Descuenta stock solo al aprobarse; sobre el umbral del motivo la aprueba otra persona (RN-ALM-13, RN-ALM-14, D-ALM-04: S/ 100).', actions: [G.canDo('ALM', 'C') ? { label: 'Registrar merma', kind: 'primary', icon: '+', onClick: () => newWaste() } : null].filter(Boolean) });
    const rows = G.scope.filter(G.db.all('stock_waste_records').map(w => Object.assign({}, w, { _ref: w, brand_id: (G.variant(w.variant_id) || {}).brand_id })));
    const mon = rows.filter(w => w.status === 'APPROVED' && String(w.approved_at || '').slice(0, 7) === G.TODAY.slice(0, 7));
    const k2 = G.kpi('KPI-ALM-02') || {};
    body.appendChild(kpis([
      { label: 'Por aprobar', value: rows.filter(w => w.status === 'PENDING').length, sub: G.fmt.money(U.sum(rows.filter(w => w.status === 'PENDING'), w => w.estimated_cost)), tone: 'warn' },
      { label: 'Mermas del mes', value: money(U.sum(mon, w => w.actual_cost ?? w.estimated_cost)), sub: `${mon.length} registros` },
      { label: 'Mermas / costo de ventas', value: G.fmt.pct(k2.value, 2), sub: 'KPI-ALM-02' },
      { label: 'Vencidos del mes', value: money(G.kpi('KPI-ALM-03') ? G.kpi('KPI-ALM-03').value : 0), sub: 'KPI-ALM-03' },
    ]));
    const reasons = G.db.all('waste_reasons');
    if (mon.length) body.appendChild(card('Mermas del mes por motivo', G.ui.chart.hbar({ items: reasons.map(r => ({ label: r.name, value: U.sum(mon.filter(w => w.reason_id === r.id), w => w.actual_cost ?? w.estimated_cost) })).filter(x => x.value > 0), format: v => G.fmt.money(v) })));
    body.appendChild(table({ id: 'alm09', rows, sort: 'requested_at', dir: -1, columns: [{ key: 'number', label: 'Número', mono: true }, { key: 'requested_at', label: 'Fecha', render: w => G.fmt.datetime(w.requested_at) }, { key: 'warehouse_id', label: 'Almacén', value: w => (whOf(w.warehouse_id) || {}).code }, { key: 'variant_id', label: 'Producto', value: w => G.variantName(w.variant_id) }, { key: 'lot_id', label: 'Lote', mono: true, value: w => (lotOf(w.lot_id) || {}).code || '—' }, { key: 'reason_id', label: 'Motivo', value: w => (G.db.get('waste_reasons', w.reason_id) || {}).name }, { key: 'qty', label: 'Cantidad', align: 'r', render: w => qtyTxt(w.qty, G.variant(w.variant_id)) }, { key: 'estimated_cost', label: 'Costo', align: 'r', render: w => money(w.actual_cost ?? w.estimated_cost) }, { key: 'photo_url', label: 'Foto', render: w => w.photo_url ? badge('Sí', 'ok') : '—' }, { key: 'requested_by', label: 'Registró', value: w => G.userShort(w.requested_by) }, { key: 'status', label: 'Estado', render: w => G.ui.status(w.status) }], filters: [{ key: 'status', label: 'Estado', options: [['PENDING', 'Pendiente'], ['APPROVED', 'Aprobada'], ['REJECTED', 'Rechazada']] }, { key: 'reason_id', label: 'Motivo', options: reasons.map(r => [r.id, r.name]) }], onRow: w => openWaste(w._ref) }));
    if (params.id) { const w = G.db.get('stock_waste_records', params.id); if (w) setTimeout(() => openWaste(w), 0); }
    if (params.new) setTimeout(() => newWaste(params), 0);
  }
  function openWaste(w) {
    drawer(`Merma ${w.number}`, (bd, close) => {
      const r = G.db.get('waste_reasons', w.reason_id) || {};
      if (w.status === 'PENDING') {
        const other = A.wasteNeedsOther(w);
        bd.appendChild(notice(other ? `Cuesta ${G.fmt.money(w.estimated_cost)} y supera el umbral del motivo (${G.fmt.money(r.approval_above_pen)}): la aprueba otra persona con alm.waste.approve (RN-ALM-13).` : `Bajo el umbral del motivo (${G.fmt.money(r.approval_above_pen)}): puede aprobarla el almacén.`, other ? 'warn' : 'info'));
        bd.appendChild(h('div', { class: 'row' }, btn('Aprobar y descontar', () => { if (tryDo(() => A.approveWaste(w.id), 'Merma aprobada: se descontó el stock')) close(); }, { sm: true, kind: 'primary' }), btn('Rechazar', () => modal('Rechazar merma', b2 => b2.appendChild(form({ id: 'alm09-rej', submitLabel: 'Rechazar', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], onSubmit: v => { try { A.rejectWaste(w.id, v.reason); G.ui.closeAll(); toast('Merma rechazada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))), { sm: true, kind: 'danger' })));
      }
      bd.appendChild(dl([['Almacén', G.whName(w.warehouse_id)], ['Producto', G.variantName(w.variant_id)], ['Lote', (lotOf(w.lot_id) || {}).code], ['Motivo', `${r.name}${r.requires_photo ? ' (exige foto)' : ''}${r.counts_as_expired ? ' · cuenta como vencido' : ''}`], ['Cantidad', qtyTxt(w.qty, G.variant(w.variant_id))], ['Peso', w.weight_kg ? G.fmt.kg(w.weight_kg, 3) : '—'], ['Costo estimado', money(w.estimated_cost)], ['Costo real', w.actual_cost != null ? money(w.actual_cost) : '—'], ['Foto', w.photo_url || '—'], ['Notas', w.notes], ['Registró', G.userName(w.requested_by) + ' · ' + G.fmt.datetime(w.requested_at)], ['Aprobó / rechazó', w.approved_by ? G.userName(w.approved_by) + ' · ' + G.fmt.datetime(w.approved_at) : '—'], ['Motivo de rechazo', w.reject_reason], ['Estado', G.ui.status(w.status)]]));
    }, { code: 'ALM-09' });
  }
  function newWaste(p = {}) {
    drawer('Registrar merma', (bd, close) => {
      const vals = { warehouse_id: p.wh || 'wh-CAM-L1', variant_id: p.variant || 'va-DG-CUY-ENT', lot_id: p.lot || '', reason_id: 'wr-DANO', qty: 1, photo: false };
      const est = h('div');
      const upd = v => { G.ui.clear(est); const r = G.db.get('waste_reasons', v.reason_id) || {}; const c = A.wasteCost(v.warehouse_id, v.variant_id, v.lot_id || null, v.qty); est.appendChild(notice(h('div', null, `Costo estimado: `, h('b', null, G.fmt.money(c)), ` · umbral del motivo ${G.fmt.money(r.approval_above_pen ?? 100)}: `, c > (r.approval_above_pen ?? 100) ? 'la aprueba otra persona.' : 'la puede aprobar el almacén.', r.requires_photo ? h('div', null, h('b', null, 'RN-ALM-14: '), `«${r.name}» exige foto.`) : null), c > (r.approval_above_pen ?? 100) ? 'warn' : 'info')); };
      const f = form({
        id: 'alm09-new', values: vals, submitLabel: 'Registrar merma', onCancel: close,
        fields: [
          { key: 'warehouse_id', label: 'Almacén', type: 'select', required: true, options: whOpts(), onChange: (x, v) => upd(v) },
          { key: 'variant_id', label: 'Producto', type: 'select', required: true, options: variantOpts(), onChange: (x, v, api) => { api.set('lot_id', ''); upd(v); } },
          { key: 'lot_id', label: 'Lote', type: 'select', options: v => lotsFor(v.variant_id || vals.variant_id, v.warehouse_id || vals.warehouse_id, { any: true }), onChange: (x, v) => upd(v), help: 'Incluye lotes vencidos o bloqueados (se pueden mermar).' },
          { key: 'reason_id', label: 'Motivo', type: 'select', required: true, options: G.db.where('waste_reasons', r => r.status === 'ACTIVE').map(r => [r.id, r.name + (r.requires_photo ? ' (foto obligatoria)' : '')]), onChange: (x, v) => upd(v) },
          { key: 'qty', label: 'Cantidad', type: 'number', required: true, min: 0.001, onChange: (x, v) => upd(v) },
          { key: 'weight_kg', label: 'Peso (kg)', type: 'number' },
          { key: 'photo', label: 'Foto tomada con el celular', type: 'checkbox' },
          { key: 'notes', label: 'Notas', type: 'textarea' },
        ],
        onSubmit: v => { try { const w = A.createWaste(Object.assign({}, v, { photo_url: v.photo ? `foto-merma-${Date.now().toString(36)}.jpg` : null })); close(); toast(`Merma ${w.number} registrada: queda pendiente de aprobación`, 'ok'); G.refresh(); return true; } catch (e) { return e.message; } },
      });
      bd.append(f, est); upd(vals);
    }, { code: 'ALM-09' });
  }

  /* ---------- ALM-10 Reservas ---------- */
  function alm10(el) {
    const body = page(el, { code: 'ALM-10', title: 'Reservas', sub: 'Reservas activas por pedido, lote y almacén (las deja la confirmación del pedido por FEFO). El mostrador y otros pedidos solo usan el disponible (RN-ALM-09). Liberación manual con motivo y permiso.' });
    const rows = [];
    for (const o of G.scope.filter(G.db.where('sales_orders', o => (o.reservations || []).length))) for (const rs of o.reservations) { const l = o.lines.find(x => x.id === rs.line_id) || {}; const v = G.variant(l.variant_id) || {}; const lot = lotOf(rs.lot_id); rows.push({ id: o.id + rs.balance_id + rs.line_id, o, rs, v, lot, number: o.number, status: o.status, delivery_date: o.delivery_date, wh: rs.wh, sku: v.sku, qty: rs.qty, lot_code: lot ? lot.code : '', brand_id: o.brand_id, establishment_id: o.establishment_id, value: R(rs.qty * ((G.db.get('stock_balances', rs.balance_id) || {}).avg_cost || 0)) }); }
    const shorts = G.scope.filter(G.db.where('sales_orders', o => o.stock_short && o.stock_short.length && ['CONFIRMED', 'IN_PREPARATION'].includes(o.status)));
    const k7 = G.kpi('KPI-ALM-07') || {};
    body.appendChild(kpis([
      { label: 'Pedidos con reserva', value: new Set(rows.map(r => r.o.id)).size },
      { label: 'Líneas reservadas', value: rows.length, sub: money(U.sum(rows, r => r.value)) + ' a costo' },
      { label: 'Pedidos con faltante', value: shorts.length, tone: shorts.length ? 'warn' : 'ok', sub: shorts.slice(0, 3).map(o => o.number).join(', ') },
      { label: 'Quiebres de stock (hoy)', value: G.fmt.pct(k7.value), sub: 'KPI-ALM-07' },
    ]));
    body.appendChild(table({
      id: 'alm10', rows, sort: 'delivery_date',
      columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'cust', label: 'Cliente', value: r => G.custName(r.o.customer_id) }, { key: 'status', label: 'Estado', render: r => G.ui.status(r.status) }, { key: 'delivery_date', label: 'Entrega', render: r => G.fmt.date(r.delivery_date) + ' ' + (r.o.slot_from || '') }, { key: 'wh', label: 'Almacén', value: r => (whOf(r.wh) || {}).code }, { key: 'sku', label: 'SKU', mono: true }, { key: 'pname', label: 'Producto', value: r => r.v.name }, { key: 'lot_code', label: 'Lote', mono: true }, { key: 'exp', label: 'Vence', value: r => r.lot ? r.lot.expiry_date : '', render: r => r.lot ? G.fmt.date(r.lot.expiry_date) : '—' }, { key: 'qty', label: 'Reservado', align: 'r', render: r => qtyTxt(r.qty, r.v) }],
      filters: [{ key: 'status', label: 'Estado', options: ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY'].map(s => [s, G.ui.statusLabel(s)]) }, { key: 'wh', label: 'Almacén', options: whOpts(w => w.allows_sale) }, { key: 'brand_id', label: 'Marca', options: brandOpts() }],
      actions: r => G.can('alm.reservation.release') ? [btn('Liberar', () => modal(`Liberar reserva de ${r.number}`, b2 => b2.appendChild(form({ id: 'alm10-rel', submitLabel: 'Liberar', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], onSubmit: v => { try { A.releaseReservation(r.o.id, r.rs.balance_id, r.rs.line_id, v.reason); G.ui.closeAll(); toast(`Reserva liberada: ${r.number} queda con faltante de ${qtyTxt(r.qty, r.v)}`, 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))), { sm: true, kind: 'ghost' })] : [],
      onRow: r => drawer(`Reservas de ${r.number}`, bd => { bd.appendChild(dl([['Cliente', G.custName(r.o.customer_id)], ['Marca', G.brandName(r.o.brand_id)], ['Local', G.siteName(r.o.establishment_id)], ['Entrega', G.fmt.date(r.o.delivery_date) + ' ' + (r.o.slot_from || '') + '–' + (r.o.slot_to || '')], ['Estado', G.ui.status(r.o.status)], ['Faltante', (r.o.stock_short || []).map(s => `${G.variantName(s.variant_id)}: ${G.fmt.num(s.qty, 3)}`).join(' · ') || 'Ninguno']])); bd.appendChild(card('Líneas reservadas', h('div', { class: 'stack', style: 'gap:4px' }, r.o.reservations.map(x => { const l = r.o.lines.find(y => y.id === x.line_id) || {}; return h('div', { class: 'between small' }, h('span', null, `${G.variantName(l.variant_id)} · ${(lotOf(x.lot_id) || {}).code || 'sin lote'} · ${(whOf(x.wh) || {}).code}`), h('b', null, G.fmt.num(x.qty, 3))); })))); const hist = G.db.where('stock_reservations', x => x.order_id === r.o.id).sort(U.by('created_at', -1)); if (hist.length) bd.appendChild(card('Historial (stock_reservations)', table({ id: 'alm10-h', rows: hist, search: false, pageSize: 8, columns: [{ key: 'variant_id', label: 'Producto', value: x => G.variantName(x.variant_id) }, { key: 'lot_id', label: 'Lote', value: x => (lotOf(x.lot_id) || {}).code || '—' }, { key: 'qty', label: 'Cant.', align: 'r' }, { key: 'status', label: 'Estado', render: x => G.ui.status(x.status === 'CONSUMED' ? 'COMPLETED' : x.status) }, { key: 'released_reason', label: 'Motivo' }] }))); }, { code: 'ALM-10', wide: true }),
    }));
    if (shorts.length) body.appendChild(card('Pedidos con faltante de stock', table({ id: 'alm10-s', rows: shorts, search: false, columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'establishment_id', label: 'Local', value: o => G.siteName(o.establishment_id) }, { key: 'delivery_date', label: 'Entrega', render: o => G.fmt.date(o.delivery_date) }, { key: 'short', label: 'Faltante', value: o => o.stock_short.map(s => `${G.variantName(s.variant_id)}: ${G.fmt.num(s.qty, 3)}`).join(' · ') }], actions: o => [btn('Reintentar reserva', () => tryDo(() => A.reserve(o), sh => sh.length ? `Sigue faltando stock en ${sh.length} línea(s)` : 'Reserva completa'), { sm: true })] }), { flush: true }));
  }

  /* ---------- ALM-11 Alertas de vencimiento (y temperatura de cámaras) ---------- */
  function alm11(el, params = {}) {
    const body = page(el, { code: 'ALM-11', title: 'Alertas de vencimiento', sub: 'Lotes con stock que vencen en 3 y 7 días y vencidos, con valor en soles y acción sugerida (vender primero, promoción, merma). Incluye la temperatura de cámaras y congeladoras (RN-ALM-15).', actions: [{ label: 'Generar alerta del día', onClick: () => { const e = A.expiring(); G.events.emit('stock.expiring', { lots: e.map(x => x.lot.code), value: R(U.sum(e, x => x.value)) }); G.notify({ role: 'SUPERVISORA_VENTAS', title: `${e.filter(x => x.days >= 0).length} lotes por vencer`, body: 'Ofrécelos primero o con promoción: ' + e.filter(x => x.days >= 0).slice(0, 5).map(x => `${x.variant.name} (${G.fmt.date(x.lot.expiry_date)})`).join(', '), tone: 'warn', module: 'ALM' }); G.notify({ role: 'ALMACENERO', title: 'Alerta diaria de vencimientos', body: `${e.length} lotes con stock vencen en 7 días o menos`, tone: 'warn', module: 'ALM' }); toast('Alerta stock.expiring emitida a almacén y ventas', 'ok'); } }] });
    const e = G.scope.filter(A.expiring());
    const sumB = b => U.sum(e.filter(x => x.bucket === b), x => x.value);
    body.appendChild(kpis([
      { label: 'Vencidos con stock', value: money(sumB('EXPIRED')), tone: e.some(x => x.bucket === 'EXPIRED') ? 'bad' : 'ok', sub: `${e.filter(x => x.bucket === 'EXPIRED').length} lotes` },
      { label: 'Vencen en 3 días', value: money(sumB('D3')), tone: 'bad', sub: `${e.filter(x => x.bucket === 'D3').length} lotes · KPI-ALM-04` },
      { label: 'Vencen en 4 a 7 días', value: money(sumB('D7')), tone: 'warn', sub: `${e.filter(x => x.bucket === 'D7').length} lotes` },
      { label: 'Ventana de alerta', value: G.fmt.days(G.param('alm_expiry_alert_days')), sub: 'alm_expiry_alert_days' },
    ]));
    if (params.tab) { G.ui._tabState = G.ui._tabState || {}; G.ui._tabState['tabs:ALM-11'] = params.tab; }
    const t = tabs([
      {
        key: 'exp', label: 'Vencimiento', count: e.length, render: p => p.appendChild(table({
          id: 'alm11', rows: e, sort: 'days', search: true,
          columns: [{ key: 'code', label: 'Lote', mono: true, value: x => x.lot.code }, { key: 'pname', label: 'Producto', value: x => x.variant.name }, { key: 'brand_id', label: 'Marca', render: x => G.brandName(x.brand_id) }, { key: 'exp', label: 'Vence', value: x => x.lot.expiry_date, render: x => G.fmt.date(x.lot.expiry_date) }, { key: 'days', label: 'Días', align: 'r', render: x => badge(x.days < 0 ? `vencido hace ${G.fmt.days(-x.days)}` : G.fmt.days(x.days), x.days <= 3 ? 'bad' : 'warn') }, { key: 'qc', label: 'Estado', render: x => G.ui.status(x.lot.qc_status) }, { key: 'qty', label: 'Stock', align: 'r', render: x => qtyTxt(x.qty, x.variant) }, { key: 'reserved', label: 'Reservado', align: 'r', render: x => x.reserved ? qtyTxt(x.reserved, x.variant) : '—' }, { key: 'whs', label: 'Almacenes', value: x => x.whs.map(w => (whOf(w) || {}).code).join(', ') }, { key: 'value', label: 'Valor', align: 'r', render: x => money(x.value) }, { key: 'action', label: 'Acción sugerida', render: x => badge(x.action, x.days < 0 ? 'bad' : x.days <= 3 ? 'warn' : 'info') }],
          filters: [{ key: 'bucket', label: 'Ventana', options: [['EXPIRED', 'Vencidos'], ['D3', '3 días'], ['D7', '4 a 7 días']] }, { key: 'brand_id', label: 'Marca', options: brandOpts() }],
          actions: x => [x.days < 0 || x.lot.qc_status !== 'RELEASED' ? btn('Merma', () => G.go('ALM-09', { new: 1, wh: x.whs[0], variant: x.variant.id, lot: x.lot.id }), { sm: true, kind: 'danger' }) : btn('Promoción', () => { G.notify({ role: 'MARKETING', title: `Promoción sugerida: ${x.variant.name}`, body: `Lote ${x.lot.code} vence el ${G.fmt.date(x.lot.expiry_date)} · ${qtyTxt(x.qty - x.reserved, x.variant)} libres · ${G.fmt.money(x.value)}`, tone: 'warn', module: 'ALM' }); G.notify({ role: 'VENDEDORA', title: `Vender primero: ${x.variant.name}`, body: `Lote ${x.lot.code} vence el ${G.fmt.date(x.lot.expiry_date)}.`, tone: 'info', module: 'ALM' }); toast('Aviso enviado a marketing y ventas', 'ok'); }, { sm: true })],
          onRow: x => openLot(x.lot),
        })),
      },
      {
        key: 'temp', label: 'Temperatura de cámaras', render: p => {
          const cold = G.scope.filter(G.db.where('warehouses', w => w.status === 'ACTIVE' && w.max_temp_c !== null && w.max_temp_c !== undefined), { brand: '_' });
          const g = h('div', { class: 'grid c3' });
          for (const w of cold) {
            const rs = G.db.where('warehouse_temp_readings', r => r.warehouse_id === w.id).sort(U.by('read_at', -1)); const last = rs[0];
            const outs = rs.filter(r => r.out_of_range && r.read_at >= G.date.add(G.TODAY, -1));
            g.appendChild(h('section', { class: 'card', style: last && last.out_of_range ? 'border-color:var(--bad)' : '' }, h('div', { class: 'card-body stack', style: 'gap:6px' },
              h('div', { class: 'between' }, h('b', null, w.name), last ? badge(`${G.fmt.num(last.temp_c, 1)} °C`, last.out_of_range ? 'bad' : 'ok') : badge('Sin lecturas', 'warn')),
              h('div', { class: 'small muted' }, `${w.code} · rango ${w.min_temp_c} a ${w.max_temp_c} °C · última ${last ? G.fmt.datetime(last.read_at) : '—'}`),
              outs.length ? h('div', { class: 'small', style: 'color:var(--bad)' }, `${outs.length} lectura(s) fuera de rango en 24 h`) : h('div', { class: 'small', style: 'color:var(--ok)' }, 'En rango las últimas 24 h'),
              h('div', { class: 'row' }, btn('Registrar', () => tempForm(w.id), { sm: true }), outs.length ? btn('Bloquear lotes', () => G.go('ALM-02', { wh: w.id }), { sm: true, kind: 'ghost' }) : null))));
          }
          p.appendChild(g);
          const outsAll = G.db.where('warehouse_temp_readings', r => r.out_of_range).sort(U.by('read_at', -1));
          p.appendChild(card('Lecturas fuera de rango', table({ id: 'alm11-t', rows: outsAll, search: false, pageSize: 10, columns: [{ key: 'read_at', label: 'Lectura', render: r => G.fmt.datetime(r.read_at) }, { key: 'warehouse_id', label: 'Ubicación', value: r => G.whName(r.warehouse_id) }, { key: 'temp_c', label: '°C', align: 'r', render: r => h('b', { style: 'color:var(--bad)' }, G.fmt.num(r.temp_c, 1)) }, { key: 'source', label: 'Origen', value: r => r.source === 'SENSOR' ? 'Sensor' : 'Manual' }] }), { flush: true }));
        },
      },
    ], { active: params.tab || 'exp' });
    body.appendChild(t);
  }

  /* ---------- ALM-12 Stock en tránsito ---------- */
  function alm12(el) {
    const body = page(el, { code: 'ALM-12', title: 'Stock en tránsito', sub: 'Transferencias despachadas sin recibir, con su antigüedad y lo que viaja en el almacén de tránsito entre locales.' });
    const trs = G.db.where('stock_transfers', t => t.status === 'DISPATCHED');
    const nowIso = G.date.now();
    const ageH = t => { const a = new Date(t.dispatched_at + (t.dispatched_at.length === 16 ? ':00' : '')), b = new Date(nowIso); return Math.max(0, R((b - a) / 3600000, 1)); };
    const tw = transitWh();
    const bal = tw ? G.db.where('stock_balances', b => b.warehouse_id === tw.id && b.qty > 0.0005) : [];
    body.appendChild(kpis([
      { label: 'Transferencias en tránsito', value: trs.length, tone: trs.length ? 'warn' : 'ok' },
      { label: 'Valor en tránsito', value: money(U.sum(bal, b => b.qty * (b.avg_cost || 0))) },
      { label: 'Más antigua', value: trs.length ? `${G.fmt.num(Math.max(...trs.map(ageH)), 1)} h` : '—', tone: trs.some(t => ageH(t) > 24) ? 'bad' : '' },
      { label: 'Lotes en tránsito', value: new Set(bal.map(b => b.lot_id)).size },
    ]));
    body.appendChild(table({ id: 'alm12', rows: trs, search: false, columns: [{ key: 'number', label: 'Número', mono: true }, { key: 'guide_number', label: 'Guía', mono: true }, { key: 'from_warehouse_id', label: 'Origen', value: t => G.whName(t.from_warehouse_id) }, { key: 'to_warehouse_id', label: 'Destino', value: t => G.whName(t.to_warehouse_id) }, { key: 'dispatched_at', label: 'Despachada', render: t => G.fmt.datetime(t.dispatched_at) }, { key: 'age', label: 'Antigüedad', align: 'r', value: ageH, render: t => badge(`${G.fmt.num(ageH(t), 1)} h`, ageH(t) > 24 ? 'bad' : ageH(t) > 6 ? 'warn' : 'info') }, { key: 'lines', label: 'Contenido', value: t => G.db.where('stock_transfer_lines', l => l.transfer_id === t.id).map(l => `${G.variantName(l.variant_id)} × ${G.fmt.num(l.qty, 3)}`).join(' · ') }], actions: t => G.can('alm.transfer.receive') ? [btn('Recibir', () => receiveForm(t), { sm: true, kind: 'primary' })] : [], onRow: t => openTransfer(t), empty: 'No hay transferencias en tránsito.' }));
    body.appendChild(card('Saldo del almacén de tránsito', table({ id: 'alm12-b', rows: bal, search: false, columns: [{ key: 'variant_id', label: 'Producto', value: b => G.variantName(b.variant_id) }, { key: 'lot_id', label: 'Lote', mono: true, value: b => (lotOf(b.lot_id) || {}).code || '—' }, { key: 'qty', label: 'Cantidad', align: 'r', render: b => qtyTxt(b.qty, G.variant(b.variant_id)) }, { key: 'weight_kg', label: 'Peso', align: 'r', render: b => b.weight_kg ? G.fmt.kg(b.weight_kg, 3) : '—' }, { key: 'value', label: 'Valor', align: 'r', value: b => b.qty * (b.avg_cost || 0), render: b => money(b.qty * (b.avg_cost || 0)) }], empty: 'Nada en tránsito.' }), { flush: true }));
  }

  /* ---------- ALM-13 Motivos de merma ---------- */
  function alm13(el) {
    G.ui.crud(el, {
      code: 'ALM-13', title: 'Motivos de merma', sub: 'Catálogo de motivos con foto obligatoria, umbral de aprobación en soles y si cuenta como vencido (KPI-ALM-03).', table: 'waste_reasons', createLabel: 'Nuevo motivo',
      kpis: () => { const rs = G.db.all('waste_reasons'); return [{ label: 'Motivos activos', value: rs.filter(r => r.status === 'ACTIVE').length }, { label: 'Con foto obligatoria', value: rs.filter(r => r.requires_photo).length, sub: 'RN-ALM-14' }, { label: 'Umbral por defecto', value: G.fmt.money(100), sub: 'D-ALM-04' }]; },
      columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Motivo' }, { key: 'requires_photo', label: 'Foto obligatoria', render: r => r.requires_photo ? badge('Sí', 'warn') : 'No' }, { key: 'approval_above_pen', label: 'Aprobación de otra persona sobre', align: 'r', render: r => G.fmt.money(r.approval_above_pen) }, { key: 'counts_as_expired', label: 'Cuenta como vencido', render: r => r.counts_as_expired ? badge('Sí', 'bad') : 'No' }, { key: 'uses', label: 'Usos', align: 'r', value: r => G.db.where('stock_waste_records', w => w.reason_id === r.id).length }, { key: 'status', label: 'Estado', render: r => G.ui.status(r.status) }],
      fields: [{ key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'approval_above_pen', label: 'Umbral de aprobación (S/)', type: 'money', min: 0, required: true }, { key: 'requires_photo', label: 'Exige foto', type: 'checkbox' }, { key: 'counts_as_expired', label: 'Cuenta como vencido', type: 'checkbox' }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']] }],
      defaults: () => ({ status: 'ACTIVE', approval_above_pen: 100, requires_photo: false, counts_as_expired: false }),
      beforeSave: (v, r) => { if (G.db.find('waste_reasons', x => x.code === v.code && (!r || x.id !== r.id))) return { code: 'Ya existe un motivo con ese código.' }; if (!G.canDo('ALM', 'E')) return 'Tu rol no puede editar el catálogo.'; },
    });
  }

  /* ------------------------------------------------------------------
     Registro
     ------------------------------------------------------------------ */
  G.register({
    code: 'ALM', name: 'Almacenes y lotes', phase: 1, group: 'Operación y despacho',
    screens: [
      { code: 'ALM-01', name: 'Almacenes y ubicaciones', render: alm01 },
      { code: 'ALM-02', name: 'Stock', render: alm02 },
      { code: 'ALM-03', name: 'Kardex', render: alm03 },
      { code: 'ALM-04', name: 'Recepción', render: alm04 },
      { code: 'ALM-05', name: 'Lotes', render: alm05 },
      { code: 'ALM-06', name: 'Liberar o bloquear lote', render: alm06 },
      { code: 'ALM-07', name: 'Transferencias', render: alm07 },
      { code: 'ALM-08', name: 'Conteos', render: alm08 },
      { code: 'ALM-09', name: 'Mermas', render: alm09 },
      { code: 'ALM-10', name: 'Reservas', render: alm10 },
      { code: 'ALM-11', name: 'Alertas de vencimiento', render: alm11 },
      { code: 'ALM-12', name: 'Stock en tránsito', render: alm12 },
      { code: 'ALM-13', name: 'Motivos de merma', render: alm13 },
    ],
  });

  /* ------------------------------------------------------------------
     Pruebas funcionales (CA-ALM-01 … CA-ALM-08)
     ------------------------------------------------------------------ */
  const T = (name, fn) => G.tests.push({ module: 'ALM', name, fn });
  const asRole = async (role, fn) => { const prev = G.ctx.role; G.ctx.role = role; try { return await fn(); } finally { G.ctx.role = prev; } };
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code} y la acción pasó.`); };
  T('CA-ALM-01: 40 cuyes de la granja a 3,5 °C con aspecto OK crean un lote en CUARENTENA que no se vende hasta liberarlo', async () => {
    const rc = A.createReceipt({ source_type: 'FARM', warehouse_id: 'wh-CUA-L1', vehicle_temp_c: 3.2, lines: [{ variant_id: 'va-DG-CUY-ENT', qty: 40, weight_kg: 36.0, product_temp_c: 3.5, appearance: 'OK', qc_result: 'PASS' }] });
    const r = A.confirmReceipt(rc.id);
    const lot = lotOf(r.lots[0]);
    if (!lot || lot.qc_status !== 'QUARANTINE') throw new Error('El lote no nació en cuarentena');
    if (G.inv.qty('va-DG-CUY-ENT', 'wh-CUA-L1') < 40 || U.sum(A.lotStock(lot.id), b => b.qty) !== 40) throw new Error('El lote no tiene 40 unidades');
    expectFail(() => G.inv.move({ type: 'SALE', wh: 'wh-CUA-L1', variant: 'va-DG-CUY-ENT', lot: lot.id, qty: 1 }), 'RN-ALM-02');
    if (A.fefoCandidates('va-DG-CUY-ENT', 'es-L1').some(c => c.lot && c.lot.id === lot.id)) throw new Error('El lote en cuarentena aparece como candidato de venta');
    A.setLotStatus(lot.id, 'RELEASED', 'Conforme', { moveTo: 'wh-CAM-L1' });
    if (!G.inv.lotUsable(lot.id) || G.inv.qty('va-DG-CUY-ENT', 'wh-CAM-L1', { releasedOnly: true }) < 40) throw new Error('Tras liberar no quedó disponible en la cámara');
  });
  T('CA-ALM-02: pollo refrigerado recibido a 7 °C marcado aprobado se rechaza con RN-ALM-06', async () => {
    const rc = A.createReceipt({ source_type: 'PURCHASE', supplier_id: G.db.find('suppliers', s => s.trade_name === 'Avícola Los Andes').id, warehouse_id: 'wh-CAM-L1', vehicle_temp_c: 5, lines: [{ variant_id: 'va-DG-POL-ENT', qty: 10, weight_kg: 22, product_temp_c: 7, appearance: 'OK', qc_result: 'PASS' }] });
    expectFail(() => A.confirmReceipt(rc.id), 'RN-ALM-06');
    if (G.db.get('stock_receipts', rc.id).status !== 'DRAFT') throw new Error('La recepción no debió confirmarse');
  });
  T('CA-ALM-03: con conejo A (vence 20/10) y B (25/10), un pedido para el 15/10 reserva primero del lote A', async () => {
    for (const l of G.db.where('lots', l => l.variant_id === 'va-DG-CON-ENT')) l.qc_status = 'BLOCKED';
    const mk = (code, exp) => { const lot = G.db.insert('lots', { product_id: 'pr-CON-ENT', variant_id: 'va-DG-CON-ENT', code, origin: 'PRODUCTION', production_date: G.TODAY, expiry_date: exp, qc_status: 'RELEASED', unit_cost: 19.5 }); G.inv.move({ type: 'RECEIPT', wh: 'wh-CAM-L1', variant: 'va-DG-CON-ENT', lot: lot.id, qty: 10, weight: 16, unitCost: 19.5, source: { type: 'TEST' } }); return lot; };
    const B = mk('L-CON-B', '2026-10-25'); const Aa = mk('L-CON-A', '2026-10-20');
    const o = G.orders.create({ customer_id: 'cu-0001', brand_id: 'br-DG', delivery_date: '2026-10-15', slot_id: 'ts-L1-1', payment_method_id: 'pm-YAPE', notes: 'Prueba FEFO', lines: [{ variant_id: 'va-DG-CON-ENT', qty: 2 }], establishment_id: 'es-L1' });
    A.reserve(o);
    if (!o.reservations.length || o.reservations[0].lot_id !== Aa.id) throw new Error('No reservó del lote A: ' + JSON.stringify(o.reservations.map(r => (lotOf(r.lot_id) || {}).code)));
    if (o.reservations.some(r => r.lot_id === B.id)) throw new Error('Tomó del lote B');
  });
  T('CA-ALM-04: con 3 cuyes del lote y 2 reservados, el mostrador no puede vender 2 (RN-ALM-09)', async () => {
    const lot = G.db.insert('lots', { product_id: 'pr-CUY-ENT', variant_id: 'va-DG-CUY-ENT', code: 'L-CUY-MOS', origin: 'PRODUCTION', production_date: G.TODAY, expiry_date: G.date.add(G.TODAY, 6), qc_status: 'RELEASED', unit_cost: 26.5 });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-MOS-L1', variant: 'va-DG-CUY-ENT', lot: lot.id, qty: 3, weight: 2.7, unitCost: 26.5, source: { type: 'TEST' } });
    const b = G.inv._bal('wh-MOS-L1', 'va-DG-CUY-ENT', lot.id); b.reserved_qty = 2;
    expectFail(() => A.counterSale({ wh: 'wh-MOS-L1', variant: 'va-DG-CUY-ENT', lot: lot.id, qty: 2 }), 'RN-ALM-09');
    A.counterSale({ wh: 'wh-MOS-L1', variant: 'va-DG-CUY-ENT', lot: lot.id, qty: 1 });
    if (b.qty !== 2) throw new Error('La venta de 1 sobre el disponible no descontó');
  });
  T('CA-ALM-05: 20 kg de chorizo del local 1 al 2 sin guía se rechazan con RN-ALM-10; con la GRE emitida salen', async () => {
    const tr = A.createTransfer({ from: 'wh-CAM-L1', to: 'wh-CAM-L2', lines: [{ variant_id: 'va-M3-CHO-1K', qty: 20 }] });
    if (!tr.requires_guide) throw new Error('No marcó que requiere guía');
    expectFail(() => A.dispatchTransfer(tr.id), 'RN-ALM-10');
    const g = A.issueGuide(tr.id);
    if (!/^T001-\d{8}$/.test(g)) throw new Error('Guía con formato inesperado: ' + g);
    A.dispatchTransfer(tr.id);
    if (G.db.get('stock_transfers', tr.id).status !== 'DISPATCHED') throw new Error('No quedó en tránsito');
    if (G.inv.qty('va-M3-CHO-1K', 'wh-TRA') < 20) throw new Error('El stock no está en el almacén de tránsito');
    A.receiveTransfer(tr.id, [{ line_id: G.db.find('stock_transfer_lines', l => l.transfer_id === tr.id).id, received_qty: 20 }]);
    if (G.inv.qty('va-M3-CHO-1K', 'wh-CAM-L2') < 20) throw new Error('No llegó al Local 2');
  });
  T('CA-ALM-06: conteo de la cámara 1 con 38 cuyes frente a 40: la misma persona no aprueba (RN-ALM-12); administración ajusta −2', async () => {
    const lot = G.db.insert('lots', { product_id: 'pr-CUY-ENT', variant_id: 'va-DG-CUY-ENT', code: 'L-CUY-CNT', origin: 'PRODUCTION', production_date: G.TODAY, expiry_date: G.date.add(G.TODAY, 6), qc_status: 'RELEASED', unit_cost: 26.5 });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-CAM-L1', variant: 'va-DG-CUY-ENT', lot: lot.id, qty: 40, weight: 36, unitCost: 26.5, source: { type: 'TEST' } });
    const c = A.createCount({ warehouse_id: 'wh-CAM-L1', count_type: 'SPOT', variant_ids: ['va-DG-CUY-ENT'] });
    await asRole('ALMACENERO', async () => {
      for (const l of G.db.where('stock_count_lines', l => l.count_id === c.id)) A.setCounted(l.id, l.lot_id === lot.id ? 38 : l.system_qty);
      A.closeCount(c.id);
      expectFail(() => A.approveCount(c.id), 'RN-ALM-12');
    });
    const adj = await asRole('ADMINISTRACION', async () => A.approveCount(c.id));
    if (adj.length !== 1 || adj[0].qty !== -2) throw new Error('El ajuste no fue −2: ' + JSON.stringify(adj.map(a => a.qty)));
    if (G.inv._bal('wh-CAM-L1', 'va-DG-CUY-ENT', lot.id).qty !== 38) throw new Error('El saldo no quedó en 38');
  });
  T('CA-ALM-07: una merma por «Cadena de frío» sin foto se rechaza con RN-ALM-14', async () => {
    const b = G.db.find('stock_balances', b => b.warehouse_id === 'wh-CAM-L1' && b.variant_id === 'va-DG-CUY-ENT' && b.qty > 2);
    expectFail(() => A.createWaste({ warehouse_id: 'wh-CAM-L1', variant_id: 'va-DG-CUY-ENT', lot_id: b.lot_id, reason_id: 'wr-FRIO', qty: 1 }), 'RN-ALM-14');
    const w = A.createWaste({ warehouse_id: 'wh-CAM-L1', variant_id: 'va-DG-CUY-ENT', lot_id: b.lot_id, reason_id: 'wr-FRIO', qty: 1, photo_url: 'foto.jpg' });
    if (w.status !== 'PENDING') throw new Error('Con foto debía quedar pendiente');
  });
  T('CA-ALM-08: insertar directamente en stock_balances se rechaza con RN-ALM-01', async () => {
    expectFail(() => G.db.insert('stock_balances', { warehouse_id: 'wh-CAM-L1', variant_id: 'va-DG-CUY-ENT', lot_id: null, qty: 999 }), 'RN-ALM-01');
    expectFail(() => G.db.insert('stock_movements', { warehouse_id: 'wh-CAM-L1', variant_id: 'va-DG-CUY-ENT', qty: 1 }), 'RN-ALM-01');
    const b = G.db.find('stock_balances', b => b.qty > 0);
    expectFail(() => G.db.update('stock_balances', b.id, { qty: 0 }), 'RN-ALM-01');
    if (!G.db.find('stock_balances', x => x.id === b.id && x.qty > 0)) throw new Error('El saldo cambió');
  });
})();
