/* =====================================================================
   PRE · Preparación con escaneo, bolsas numeradas y carga verificada (Fase 1)
   Problema real: al separar se cruzaban pedidos (un cuy iba donde pidieron
   pollo, la bolsa 2 de un cliente llegaba a otro). PRE arma olas por franja
   o ruta, obliga a escanear cada paquete contra su pedido, registra el peso
   real (precio final en PED), numera las bolsas «n de N» con ruta y parada,
   exige verificación con foto por otra persona y carga el vehículo por
   escaneo en orden inverso de paradas. Los errores que escapan se registran
   con tipo y responsable.
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, toast, form, tabs, pills } = G.ui;
  const U = G.util;
  const R = (n, d = 2) => U.round(n, d);
  const P = G.pre = G.pre || {};
  const ins = (t, r, silent = true) => G.db.insert(t, r, { silent });
  const now = () => G.date.now();
  const me = () => G.ctx.userId();

  /* ------------------------------------------------------------------
     Utilidades
     ------------------------------------------------------------------ */
  const ACTIVE_TASK = ['PENDING', 'PICKING', 'PICKED', 'PACKED', 'VERIFIED', 'LOADED'];
  const TASK_ST = { PENDING: ['Pendiente', 'warn'], PICKING: ['Armando', 'info'], PICKED: ['Armado', 'info'], PACKED: ['Embolsado', 'info'], VERIFIED: ['Verificado', 'ok'], LOADED: ['Cargado', 'ok'], CANCELLED: ['Cancelado', ''] };
  const tBadge = s => badge((TASK_ST[s] || [s])[0], (TASK_ST[s] || [, ''])[1]);
  const WAVE_ST = { DRAFT: ['Borrador', ''], RELEASED: ['Liberada', 'info'], PICKING: ['Armando', 'info'], PACKED: ['Embolsada', 'info'], LOADED: ['Cargada', 'ok'], CLOSED: ['Cerrada', ''], CANCELLED: ['Cancelada', ''] };
  const wBadge = s => badge((WAVE_ST[s] || [s])[0], (WAVE_ST[s] || [, ''])[1]);
  const RESULTS = { OK: 'Correcto', WRONG_PRODUCT: 'Producto equivocado', WRONG_ORDER: 'Pedido cruzado', WRONG_ROUTE: 'Ruta equivocada', LOT_NOT_RELEASED: 'Lote no liberado', NOT_FEFO: 'Fuera de FEFO', EXCESS: 'Exceso', DUPLICATE: 'Etiqueta repetida', LOAD_ORDER: 'Fuera de orden de carga', UNKNOWN: 'Código desconocido' };
  const ERR_TYPES = [['WRONG_PRODUCT', 'Producto equivocado'], ['WRONG_CUT', 'Corte equivocado'], ['MISSING_ITEM', 'Faltante'], ['EXTRA_ITEM', 'Sobrante'], ['WRONG_QTY', 'Cantidad'], ['WRONG_WEIGHT', 'Peso'], ['CROSSED_CUSTOMER', 'Pedido cruzado (cliente)'], ['EXPIRED_LOT', 'Lote vencido'], ['DAMAGED_PACKAGE', 'Empaque'], ['LABEL_ERROR', 'Etiqueta'], ['OTHER', 'Otro']];
  const STAGES = [['PICKING_SCAN', 'Armado (escaneo)'], ['VERIFICATION', 'Verificación'], ['LOADING', 'Carga'], ['DELIVERY', 'Entrega'], ['CUSTOMER_CLAIM', 'Reclamo del cliente']];
  const PARCEL_TYPES = [['BAG', 'Bolsa'], ['THERMAL_BOX', 'Caja térmica'], ['BOX', 'Caja'], ['COOLER', 'Cooler']];
  const optName = (list, v) => (list.find(x => x[0] === v) || [v, v])[1];
  const orderOf = t => G.db.get('sales_orders', t.order_id);
  const shortNo = o => String(Number(String(o.number || '').replace(/\D/g, '')) || o.number);
  const linesOf = taskId => G.db.where('picking_task_lines', l => l.task_id === taskId);
  const scansOf = taskId => G.db.where('picking_scans', s => s.task_id === taskId);
  const unitTxt = (q, v) => v && v.sale_mode === 'KG' ? G.fmt.kg(q, 3) : G.fmt.num(q, 0) + ' u';
  const isWeighted = v => v && v.sale_mode !== 'UNIT';
  const lotOf = id => id ? G.db.get('lots', id) : null;
  const mask = p => p ? String(p).slice(0, 6) + '•••' + String(p).slice(-3) : '—';
  const hm = s => { const [a, b] = String(s || '00:00').split(':').map(Number); return a * 60 + (b || 0); };
  const tryDo = (fn, okMsg) => { try { const r = fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok'); G.refresh(); return r || true; } catch (e) { toast(e.message, 'bad'); if (!(e instanceof G.RuleError)) console.error(e); return null; } };

  /* ------------------------------------------------------------------
     Rutas y paradas (DEL si está; si no, D-PRE-04: ruta por zona y franja)
     ------------------------------------------------------------------ */
  const zoneCode = o => o.fulfillment === 'PICKUP' || o.fulfillment === 'COUNTER' ? 'RECOJO-' + String(o.pickup_establishment_id || o.establishment_id).slice(3) : o.fulfillment === 'PROVINCE_SHIPPING' ? 'PROVINCIA' : ((G.db.get('delivery_zones', o.zone_id) || {}).code || 'SIN-ZONA');
  const keyOf = (o, code) => `${o.delivery_date}|${o.slot_from || ''}|${code}`;
  function delStop(o) {
    if (G.del && typeof G.del.stopOf === 'function') { try { const s = G.del.stopOf(o.id); if (s) return s; } catch (e) { } }
    const st = G.db.find('delivery_stops', s => s.order_id === o.id && !['CANCELLED', 'RESCHEDULED', 'FAILED'].includes(s.status));
    if (!st) return null; const r = G.db.get('delivery_routes', st.route_id);
    return r ? { route_id: r.id, route_code: r.code, stop_seq: st.seq, route_key: 'DEL:' + r.id } : null;
  }
  /** fija la ruta y la parada del pedido (DEL o prueba) */
  P.assignStop = function (orderId, { route_code, route_id = null, stop_seq }) {
    const t = P.taskOf(orderId); const o = G.db.get('sales_orders', orderId);
    if (!t) G.fail('RN-PRE-01', 'El pedido no tiene tarea de preparación.');
    Object.assign(t, { route_code, route_id, stop_seq, route_key: route_id ? 'DEL:' + route_id : keyOf(o, route_code) });
    for (const pc of G.db.where('shipment_parcels', p => p.task_id === t.id)) Object.assign(pc, { route_code, route_id, stop_seq: stop_seq, route_key: t.route_key });
    G.db.touch(); return t;
  };
  /** asigna ruta y parada a las tareas de la ola sin ruta: vecino más cercano desde el local */
  function assignRoutes(wave) {
    const tasks = G.db.where('picking_tasks', t => t.wave_id === wave.id && t.status !== 'CANCELLED');
    const free = [];
    for (const t of tasks) { const o = orderOf(t); const d = delStop(o); if (d) Object.assign(t, d); else if (!t.route_key) free.push(t); }
    const site = G.db.get('establishments', wave.establishment_id) || {};
    for (const [code, ts] of Object.entries(U.groupBy(free, t => zoneCode(orderOf(t))))) {
      const o0 = orderOf(ts[0]); const rk = keyOf(o0, code);
      let seq = Math.max(0, ...G.db.where('picking_tasks', t => t.route_key === rk && t.stop_seq).map(t => t.stop_seq));
      let cur = { lat: site.lat, lng: site.lng }; const left = ts.slice();
      while (left.length) {
        left.sort((a, b) => dist(cur, addrOf(a)) - dist(cur, addrOf(b)));
        const t = left.shift(); seq++; Object.assign(t, { route_code: code, route_id: null, stop_seq: seq, route_key: rk });
        const ad = addrOf(t); if (ad.lat != null) cur = ad;
      }
    }
    G.db.touch();
  }
  const addrOf = t => { const o = orderOf(t); const a = o && o.address_id ? G.db.get('customer_addresses', o.address_id) : null; return a || {}; };
  const dist = (a, b) => a.lat == null || b.lat == null ? 999 : G.geo && G.geo.km ? G.geo.km(a, b) : Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111;
  const routeLabel = rk => { if (!rk) return '—'; if (rk.startsWith('DEL:')) { const r = G.db.get('delivery_routes', rk.slice(4)); return r ? r.code : rk; } const [d, s, c] = rk.split('|'); return `${c} · ${s}${d !== G.TODAY ? ' · ' + G.fmt.date(d) : ''}`; };
  P.routeLabel = routeLabel;

  /* ------------------------------------------------------------------
     Tareas y olas (RN-PRE-01, RN-PRE-02)
     ------------------------------------------------------------------ */
  P.taskOf = orderId => G.db.find('picking_tasks', t => t.order_id === orderId && t.status !== 'CANCELLED') || null;
  P.ensureTask = function (o) {
    if (!['CONFIRMED', 'IN_PREPARATION'].includes(o.status)) G.fail('RN-PRE-01', `El pedido ${o.number} está ${G.ui.statusLabel(o.status).toLowerCase()}: solo entra a preparación un pedido confirmado o en preparación.`);
    const ex = P.taskOf(o.id); if (ex) return ex;
    const t = ins('picking_tasks', { wave_id: null, order_id: o.id, order_number: o.number, establishment_id: o.establishment_id, brand_id: o.brand_id, delivery_date: o.delivery_date, slot_from: o.slot_from, slot_to: o.slot_to, preparer_user_id: null, status: 'PENDING', parcel_count: null, parcel_type: null, photo_file_id: null, verified_by: null, started_at: null, finished_at: null, route_code: null, route_id: null, stop_seq: null, route_key: null, stock_moved: false });
    for (const l of o.lines) { const v = G.variant(l.variant_id); ins('picking_task_lines', { task_id: t.id, order_line_id: l.id, variant_id: l.variant_id, qty_required: l.qty, qty_picked: 0, est_weight_kg: l.est_weight_kg, weighed_kg: null, status: 'PENDING', short_reason: null, short_approved_by: null, cut_notes: l.cut_notes || null, weighted: isWeighted(v) }); }
    return t;
  };
  P.createWave = function ({ site, date, slot_from, slot_to, order_ids, route_code }) {
    if (!G.can('pre.wave.manage')) G.fail('RN-PRE-02', `Tu rol (${G.roleName()}) no tiene el permiso pre.wave.manage.`);
    if (!(order_ids || []).length) G.fail('RN-PRE-02', 'Elige al menos un pedido para la ola.');
    const tasks = [];
    for (const id of order_ids) {
      const o = G.db.get('sales_orders', id);
      const t = P.ensureTask(o);
      if (t.wave_id) { const w0 = G.db.get('picking_waves', t.wave_id); if (w0 && !['CANCELLED', 'CLOSED'].includes(w0.status)) G.fail('RN-PRE-01', `El pedido ${o.number} ya tiene una tarea activa en la ola ${w0.number}.`); }
      tasks.push(t);
    }
    const s = site || tasks[0].establishment_id;
    const w = ins('picking_waves', { number: G.db.next('OLA', 'OLA-', 4), establishment_id: s, warehouse_id: s === 'es-L2' ? 'wh-CAM-L2' : 'wh-CAM-L1', wave_date: date || tasks[0].delivery_date, slot_from: slot_from || tasks[0].slot_from, slot_to: slot_to || tasks[0].slot_to, route_id: null, route_code: route_code || null, status: 'DRAFT', released_at: null, closed_at: null, created_by: me() }, false);
    for (const t of tasks) t.wave_id = w.id;
    G.db.touch();
    return w;
  };
  /** libera la ola: emite wave.released y los pedidos pasan a EN PREPARACIÓN */
  P.releaseWave = function (waveId) {
    const w = G.db.get('picking_waves', waveId);
    if (!G.can('pre.wave.manage')) G.fail('RN-PRE-02', `Tu rol (${G.roleName()}) no tiene el permiso pre.wave.manage.`);
    if (w.status !== 'DRAFT') G.fail('RN-PRE-02', `La ola ${w.number} ya está ${optName(Object.entries(WAVE_ST).map(([k, v]) => [k, v[0]]), w.status).toLowerCase()}.`);
    const tasks = G.db.where('picking_tasks', t => t.wave_id === w.id && t.status !== 'CANCELLED');
    for (const t of tasks) { const o = orderOf(t); if (!['CONFIRMED', 'IN_PREPARATION'].includes(o.status)) G.fail('RN-PRE-01', `El pedido ${o.number} está ${G.ui.statusLabel(o.status).toLowerCase()}: sácalo de la ola.`); }
    Object.assign(w, { status: 'RELEASED', released_at: now(), released_by: me() });
    assignRoutes(w);
    G.events.emit('wave.released', { wave_id: w.id, number: w.number, order_ids: tasks.map(t => t.order_id) });
    for (const t of tasks) { const o = orderOf(t); if (o.status === 'CONFIRMED') G.orders.transition(o, 'IN_PREPARATION', { reason: `Ola ${w.number} liberada` }); }
    G.db.update('picking_waves', w.id, { status: 'RELEASED' });
    return w;
  };
  P.cancelWave = function (waveId, reason) {
    const w = G.db.get('picking_waves', waveId);
    if (w.status !== 'DRAFT') G.fail('RN-PRE-02', 'Solo se cancela una ola en borrador.');
    for (const t of G.db.where('picking_tasks', t => t.wave_id === w.id)) t.wave_id = null;
    G.db.update('picking_waves', w.id, { status: 'CANCELLED', cancel_reason: reason || null });
  };
  /** almacenes de la ola: los de venta del local */
  const waveWhs = site => G.inv.saleWarehouses(site).map(w => w.id);
  /** lote FEFO para el pedido: considera su propia reserva y lo ya escaneado sin descontar */
  function lotAvailFor(task, o) {
    const own = {}; for (const r of o.reservations || []) own[r.balance_id] = (own[r.balance_id] || 0) + r.qty;
    const picked = {}; if (!task.stock_moved) for (const s of scansOf(task.id)) if (s.result === 'OK' && s.lot_id && s.scan_type === 'PICK') picked[s.lot_id] = (picked[s.lot_id] || 0) + (s.qty || 1);
    return (variant) => {
      const whs = waveWhs(o.establishment_id); const minDays = G.param('alm_min_days_left_on_delivery') ?? 1;
      const by = {};
      for (const b of G.db.where('stock_balances', b => b.variant_id === variant && whs.includes(b.warehouse_id) && b.lot_id && b.qty > 0.0005)) {
        const lot = lotOf(b.lot_id); if (!lot || !G.inv.lotUsable(lot.id)) continue;
        if (lot.expiry_date && G.date.diff(lot.expiry_date, o.delivery_date || G.TODAY) < minDays) continue;
        const e = by[lot.id] || (by[lot.id] = { lot, avail: 0, whs: [] });
        e.avail += b.qty - (b.reserved_qty || 0) + (own[b.id] || 0); e.whs.push(b.warehouse_id);
      }
      return Object.values(by).map(e => Object.assign(e, { avail: R(e.avail - (picked[e.lot.id] || 0), 3) })).filter(e => e.avail > 0.0005).sort((a, b) => String(a.lot.expiry_date).localeCompare(String(b.lot.expiry_date)));
    };
  }
  P.suggestLot = function (taskId, variant) { const t = G.db.get('picking_tasks', taskId); const c = lotAvailFor(t, orderOf(t))(variant); return c[0] || null; };

  /* ------------------------------------------------------------------
     Escaneo de armado (RN-PRE-03 a RN-PRE-06, RN-PRE-10)
     ------------------------------------------------------------------ */
  const ean13 = s12 => { let sum = 0; for (let i = 0; i < 12; i++) sum += Number(s12[i]) * (i % 2 ? 3 : 1); return s12 + ((10 - sum % 10) % 10); };
  /** etiqueta de balanza EAN-13 de prefijo 2: PLU de 5 dígitos y peso en gramos (D-PRE-01) */
  P.scaleLabel = (variantId, kg) => { const v = G.variant(variantId); return ean13('2' + String(v.scale_plu || '0').padStart(5, '0').slice(-5) + String(Math.round(kg * 1000)).padStart(5, '0').slice(-5) + '0'); };
  P.parseCode = function (raw) {
    const c = String(raw || '').trim().toUpperCase();
    if (!c) return { kind: 'UNKNOWN', code: c };
    if (/^2\d{12}$/.test(c)) { const plu = String(Number(c.slice(1, 6))); const v = G.db.find('product_variants', x => x.scale_plu && String(Number(x.scale_plu)) === plu); return v ? { kind: 'SCALE', code: c, variant: v.id, weight: R(Number(c.slice(6, 11)) / 1000, 3) } : { kind: 'UNKNOWN', code: c }; }
    const lot = G.db.find('lots', l => l.code.toUpperCase() === c); if (lot) return { kind: 'LOT', code: c, variant: lot.variant_id, lot: lot.id };
    const v = G.db.find('product_variants', x => String(x.sku).toUpperCase() === c || String(x.barcode || '') === c); if (v) return { kind: 'SKU', code: c, variant: v.id };
    return { kind: 'UNKNOWN', code: c };
  };
  const lineDone = (l, v) => {
    if (l.status === 'SHORT_APPROVED') return true;
    if (v.sale_mode === 'KG') return (l.weighed_kg || 0) >= l.qty_required * (1 - (G.param('pre_kg_fill_tolerance_pct') ?? 10) / 100) - 0.0005;
    return l.qty_picked >= l.qty_required - 0.0005;
  };
  /**
   * Lectura de un paquete contra el pedido. Siempre queda en picking_scans (solo inserción).
   * scan(taskId, {code, lot_code, weight_kg}) → {result, ok, message, scan, line, over}
   */
  P.scan = function (taskId, { code, lot_code, weight_kg, override_by, override_of, device } = {}) {
    const t = G.db.get('picking_tasks', taskId); if (!t) G.fail('RN-PRE-01', 'Tarea no encontrada.');
    if (!G.can('pre.task.pick')) G.fail('RN-PRE-03', `Tu rol (${G.roleName()}) no tiene el permiso pre.task.pick.`);
    const o = orderOf(t);
    const w = t.wave_id && G.db.get('picking_waves', t.wave_id);
    if (!w || w.status === 'DRAFT') G.fail('RN-PRE-02', `El pedido ${o.number} todavía no está en una ola liberada.`);
    if (!['PENDING', 'PICKING'].includes(t.status)) G.fail('RN-PRE-09', `La tarea del pedido ${o.number} ya está ${(TASK_ST[t.status] || [t.status])[0].toLowerCase()}: no admite más paquetes.`);
    if (!['CONFIRMED', 'IN_PREPARATION', 'WEIGHED'].includes(o.status)) G.fail('RN-PRE-01', `El pedido ${o.number} está ${G.ui.statusLabel(o.status).toLowerCase()}.`);
    const pc = P.parseCode(code);
    let lot = pc.lot ? lotOf(pc.lot) : null;
    if (!lot && lot_code) { lot = G.db.find('lots', l => l.code.toUpperCase() === String(lot_code).trim().toUpperCase()) || lotOf(lot_code); }
    const v = pc.variant ? G.variant(pc.variant) : null;
    const weight = pc.weight != null ? pc.weight : (weight_kg !== undefined && weight_kg !== '' && weight_kg !== null ? R(Number(weight_kg), 3) : null);
    const rec = (result, error_code, message, extra = {}) => {
      const s = ins('picking_scans', Object.assign({ task_id: t.id, task_line_id: null, parcel_id: null, route_id: null, scan_type: 'PICK', barcode: pc.code || String(code || ''), variant_id: v ? v.id : null, lot_id: lot ? lot.id : null, weight_kg: weight, qty: null, result, error_code, message, override_by: override_by || null, override_of: override_of || null, device_id: device || 'CEL-PRE', scanned_at: now(), user_id: me(), order_id: o.id, wave_id: t.wave_id }, extra));
      return { result, ok: result === 'OK', message: error_code ? `${error_code}: ${message}` : message, scan: s };
    };
    if (pc.kind === 'UNKNOWN') return rec('UNKNOWN', 'RN-PRE-06', `Código desconocido «${pc.code}»: no es un lote, SKU, código de barras ni etiqueta de balanza.`);
    if (pc.kind === 'SCALE' && G.db.find('picking_scans', s => s.barcode === pc.code && s.result === 'OK' && s.scan_type === 'PICK')) return rec('DUPLICATE', 'RN-PRE-06', `La etiqueta de balanza ${pc.code} ya se leyó: cada paquete pesado tiene su propia etiqueta.`);
    const lines = linesOf(t.id);
    const mine = lines.filter(l => l.variant_id === v.id);
    if (!mine.length) {
      const other = G.db.where('picking_tasks', x => x.wave_id === t.wave_id && x.id !== t.id && x.status !== 'CANCELLED').find(x => linesOf(x.id).some(l => l.variant_id === v.id));
      const brandNote = v.brand_id !== o.brand_id ? ` Es de ${G.brandName(v.brand_id)} y el pedido es de ${G.brandName(o.brand_id)}.` : '';
      if (other) return rec('WRONG_ORDER', 'RN-PRE-03', `Pedido cruzado: ${v.name} es del pedido ${other.order_number}${(orderOf(other) || {}).customer_id ? ' (' + G.custName(orderOf(other).customer_id) + ')' : ''}, no del ${o.number}. No lo pongas en esta bolsa.${brandNote}`);
      return rec('WRONG_PRODUCT', 'RN-PRE-03', `Producto equivocado: ${v.name} no está en el pedido ${o.number}.${brandNote}`);
    }
    const p = G.productOf(v.id) || {};
    if (lot && lot.variant_id !== v.id) return rec('WRONG_PRODUCT', 'RN-ALM-08', `El lote ${lot.code} es de ${G.variantName(lot.variant_id)}, no de ${v.name}.`);
    if (p.requires_lot && !lot) return rec('LOT_NOT_RELEASED', 'RN-PRE-04', `${v.name} se controla por lote: escanea la etiqueta del lote o indícalo.`);
    if (lot && !G.inv.lotUsable(lot.id)) { const exp = lot.expiry_date && lot.expiry_date < G.TODAY; return rec('LOT_NOT_RELEASED', 'RN-PRE-04', `El lote ${lot.code} está ${exp ? 'vencido' : G.ui.statusLabel(lot.qc_status).toLowerCase()}: solo se prepara con lotes liberados. Sepáralo y avisa al almacén.`); }
    const line = mine.find(l => !lineDone(l, v)) || mine[0];
    if (lineDone(line, v)) return rec('EXCESS', 'RN-PRE-06', `Exceso: la línea de ${v.name} ya está completa (${unitTxt(v.sale_mode === 'KG' ? line.weighed_kg : line.qty_picked, v)} de ${unitTxt(line.qty_required, v)}).`, { task_line_id: line.id });
    if (lot && !override_by) {
      const cands = lotAvailFor(t, o)(v.id);
      const better = cands.find(c => c.lot.id !== lot.id && String(c.lot.expiry_date) < String(lot.expiry_date));
      if (better) return rec('NOT_FEFO', 'RN-PRE-05', `FEFO: hay ${G.fmt.num(better.avail, v.sale_mode === 'KG' ? 3 : 0)} disponibles del lote ${better.lot.code} que vence el ${G.fmt.date(better.lot.expiry_date)}, antes que ${lot.code} (${G.fmt.date(lot.expiry_date)}). Toma ese lote o pide autorización a la supervisora.`, { task_line_id: line.id, suggested_lot_id: better.lot.id });
    }
    if (isWeighted(v) && !(weight > 0)) G.fail('RN-PRE-10', `${v.name} se vende por peso: lee la etiqueta de balanza o digita el peso del paquete.`);
    // OK
    const addQty = v.sale_mode === 'KG' ? weight : 1;
    line.qty_picked = R((line.qty_picked || 0) + addQty, 3);
    if (isWeighted(v)) line.weighed_kg = R((line.weighed_kg || 0) + weight, 3);
    line.status = lineDone(line, v) ? 'DONE' : 'PARTIAL';
    if (!t.started_at) t.started_at = now();
    if (!t.preparer_user_id) t.preparer_user_id = me();
    if (t.status === 'PENDING') t.status = 'PICKING';
    if (w.status === 'RELEASED') w.status = 'PICKING';
    const ol = o.lines.find(x => x.id === line.order_line_id);
    if (ol && lot && !ol.lot_id) ol.lot_id = lot.id;
    const res = rec('OK', null, `${v.name}${weight ? ' · ' + G.fmt.kg(weight, 3) : ''}${lot ? ' · lote ' + lot.code : ''} → pedido ${o.number}`, { task_line_id: line.id, qty: addQty });
    if (line.status === 'DONE' && isWeighted(v) && ol && ol.price_basis === 'KG') {
      const wr = G.orders.weigh(o, ol.id, line.weighed_kg, pc.kind === 'SCALE' ? 'SCALE' : 'MANUAL');
      res.over = wr.over; res.diff_pct = wr.diff_pct;
      if (wr.over) res.message += ` · Diferencia de peso ${wr.diff_pct > 0 ? '+' : ''}${G.fmt.num(wr.diff_pct, 1)} %: supera la tolerancia; avisa al cliente (RN-PED-05).`;
    }
    res.line = line;
    G.db.touch();
    if (lines.every(l => lineDone(l, G.variant(l.variant_id)))) { P.finishPicking(t.id); res.finished = true; }
    return res;
  };
  /** autorización de la supervisora para un lote fuera de FEFO (pre.fefo.override) */
  P.authorizeFefo = function (scanId, reason) {
    const s = G.db.get('picking_scans', scanId);
    if (!s || s.result !== 'NOT_FEFO') G.fail('RN-PRE-05', 'La lectura no está bloqueada por FEFO.');
    if (!G.can('pre.fefo.override')) G.fail('RN-PRE-05', `Autoriza una supervisora de almacén con el permiso pre.fefo.override; tu rol (${G.roleName()}) no lo tiene.`);
    if (G.db.find('picking_scans', x => x.override_of === s.id)) G.fail('RN-PRE-05', 'Esta lectura ya fue resuelta.');
    const r = P.scan(s.task_id, { code: s.barcode, lot_code: s.lot_id, weight_kg: s.weight_kg, override_by: me(), override_of: s.id });
    if (r.scan) r.scan.override_reason = reason || 'Autorizado por la supervisora';
    return r;
  };
  P.denyFefo = function (scanId, reason) {
    const s = G.db.get('picking_scans', scanId);
    if (!G.can('pre.fefo.override')) G.fail('RN-PRE-05', `Tu rol (${G.roleName()}) no tiene el permiso pre.fefo.override.`);
    return ins('picking_scans', { task_id: s.task_id, task_line_id: s.task_line_id, scan_type: 'PICK', barcode: s.barcode, variant_id: s.variant_id, lot_id: s.lot_id, weight_kg: s.weight_kg, result: 'NOT_FEFO', error_code: 'OVERRIDE_DENIED', message: 'La supervisora pidió tomar el lote que vence antes' + (reason ? ': ' + reason : ''), override_by: me(), override_of: s.id, scanned_at: now(), user_id: me(), order_id: s.order_id, wave_id: s.wave_id, device_id: 'WEB' });
  };
  P.pendingFefo = () => { const done = new Set(G.db.where('picking_scans', x => x.override_of).map(x => x.override_of)); return G.db.where('picking_scans', s => s.result === 'NOT_FEFO' && !s.override_of && !done.has(s.id)); };
  /** demostración: arma la tarea con los lotes FEFO y el peso nominal */
  P.autoPick = function (taskId, { weights } = {}) {
    const t = G.db.get('picking_tasks', taskId); const out = [];
    for (const l of linesOf(t.id)) {
      const v = G.variant(l.variant_id); let guard = 0;
      while (!lineDone(l, v) && guard++ < 60) {
        const c = P.suggestLot(t.id, v.id);
        const unitKg = v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? R((l.est_weight_kg || v.nominal_weight_kg * l.qty_required) / l.qty_required, 3) : v.sale_mode === 'KG' ? R(l.qty_required - (l.weighed_kg || 0), 3) : null;
        const wgt = weights && weights[l.variant_id] ? weights[l.variant_id].shift() : unitKg;
        const r = P.scan(t.id, { code: c ? c.lot.code : v.sku, weight_kg: wgt });
        out.push(r); if (!r.ok) break;
        if (G.db.get('picking_tasks', t.id).status !== 'PICKING') break;
      }
    }
    return out;
  };
  /** faltante: lo pide quien arma y lo aprueba la supervisora (RN-PRE-12) */
  P.requestShort = function (lineId, reason) {
    const l = G.db.get('picking_task_lines', lineId);
    if (!reason) G.fail('RN-PRE-12', 'El faltante exige motivo.');
    if (l.status === 'DONE') G.fail('RN-PRE-12', 'La línea ya está completa.');
    Object.assign(l, { short_reason: reason, short_requested_by: me(), short_requested_at: now() }); G.db.touch();
    G.notify({ role: 'ALMACENERO', title: `Faltante por aprobar · ${G.db.get('picking_tasks', l.task_id).order_number}`, body: `${G.variantName(l.variant_id)}: ${reason}`, tone: 'warn', module: 'PRE', ref: l.task_id });
    return l;
  };
  P.approveShort = function (lineId) {
    const l = G.db.get('picking_task_lines', lineId); const t = G.db.get('picking_tasks', l.task_id); const o = orderOf(t);
    if (!l.short_reason) G.fail('RN-PRE-12', 'Primero se registra el faltante con su motivo.');
    if (!G.can('pre.short.approve')) G.fail('RN-PRE-12', `Aprueba el faltante una supervisora con pre.short.approve; tu rol (${G.roleName()}) no lo tiene.`);
    if (t.preparer_user_id === me() || l.short_requested_by === me()) G.fail('RN-PRE-12', 'Un faltante no lo aprueba quien prepara el pedido.');
    Object.assign(l, { status: 'SHORT_APPROVED', short_approved_by: me(), short_approved_at: now(), short_qty: R(l.qty_required - l.qty_picked, 3) });
    const v = G.variant(l.variant_id); const ol = o.lines.find(x => x.id === l.order_line_id);
    if (ol && ol.price_basis === 'KG' && isWeighted(v)) G.orders.weigh(o, ol.id, l.weighed_kg || 0.001, 'MANUAL');
    const seller = o.seller_id;
    G.notify(seller ? { user_id: seller, title: `Faltante en ${o.number}`, body: `${v.name}: faltan ${unitTxt(l.short_qty, v)} (${l.short_reason}). Coordina con ${G.custName(o.customer_id)}.`, tone: 'warn', module: 'PRE', ref: o.id } : { role: 'SUPERVISORA_VENTAS', title: `Faltante en ${o.number} (pedido web)`, body: `${v.name}: faltan ${unitTxt(l.short_qty, v)}. Coordina con el cliente.`, tone: 'warn', module: 'PRE', ref: o.id });
    G.db.touch();
    if (linesOf(t.id).every(x => lineDone(x, G.variant(x.variant_id))) && t.status === 'PICKING') P.finishPicking(t.id);
    return l;
  };
  /** armado completo: descuenta stock desde las reservas (G.inv.move SALE fromReserved) y el pedido pasa a PESADO */
  P.finishPicking = function (taskId) {
    const t = G.db.get('picking_tasks', taskId); const o = orderOf(t);
    const lines = linesOf(t.id);
    if (!lines.every(l => lineDone(l, G.variant(l.variant_id)))) G.fail('RN-PRE-09', 'Hay líneas incompletas sin faltante aprobado.');
    t.status = 'PICKED'; t.picked_at = now();
    if (!t.stock_moved) {
      try { consumeStock(t, o); } catch (e) { t.stock_error = e.message; console.warn('PRE: no se pudo descontar stock de ' + o.number + ': ' + e.message); }
    }
    if (o.status === 'IN_PREPARATION' && o.lines.some(l => l.price_basis === 'KG') && o.lines.filter(l => l.price_basis === 'KG').every(l => l.weighed_kg != null) && G.orders.canTransition(o, 'WEIGHED')) G.orders.transition(o, 'WEIGHED', { reason: 'Armado y pesado en preparación' });
    G.db.touch();
    return t;
  };
  function consumeStock(t, o) {
    const res = (o.reservations || []).map(r => Object.assign({}, r));
    const outs = [];
    const whs = waveWhs(o.establishment_id);
    for (const l of linesOf(t.id)) {
      const ok = scansOf(t.id).filter(s => s.task_line_id === l.id && s.result === 'OK');
      const v = G.variant(l.variant_id);
      for (const [lotId, ss] of Object.entries(U.groupBy(ok, s => s.lot_id || ''))) {
        let q = R(U.sum(ss, s => s.qty || 1), 3); const wTot = isWeighted(v) ? R(U.sum(ss, s => s.weight_kg || 0), 3) : null; const q0 = q;
        const take = (wh, qty, fromReserved) => { const w = wTot != null ? R(wTot * qty / q0, 3) : null; const r = G.inv.move({ type: 'SALE', wh, variant: l.variant_id, lot: lotId || null, qty, weight: w, fromReserved, source: { type: 'SALES_ORDER', id: o.id }, reason: `Preparación ${o.number}` }); outs.push({ wh, variant_id: l.variant_id, lot_id: lotId || null, qty, weight_kg: w, move_ids: r.moves.map(m => m.id) }); };
        for (const rs of res.filter(r => r.line_id === l.order_line_id && (r.lot_id || '') === lotId && r.qty > 0.0005)) { if (q <= 0.0005) break; const x = Math.min(q, rs.qty); take(rs.wh, R(x, 3), true); rs.qty = R(rs.qty - x, 3); q = R(q - x, 3); }
        if (q > 0.0005) {
          for (const b of G.db.where('stock_balances', b => b.variant_id === l.variant_id && (b.lot_id || '') === lotId && whs.includes(b.warehouse_id) && b.qty > 0.0005).sort((a, c) => (G.db.get('warehouses', a.warehouse_id).pick_priority) - (G.db.get('warehouses', c.warehouse_id).pick_priority))) {
            if (q <= 0.0005) break; const x = Math.min(q, b.qty); take(b.warehouse_id, R(x, 3), false); q = R(q - x, 3);
          }
          if (q > 0.0005) G.fail('RN-ALM-03', `No hay saldo del lote ${(lotOf(lotId) || {}).code || ''} para descontar ${q}.`);
        }
      }
    }
    // reservas no usadas (otro lote, faltante): se liberan
    for (const rs of res) if (rs.qty > 0.0005) { const b = G.db.get('stock_balances', rs.balance_id); if (b) b.reserved_qty = Math.max(0, R((b.reserved_qty || 0) - rs.qty, 3)); }
    o.reservations = [];
    o.stock_out = (o.stock_out || []).concat(outs); o.stock_out_done = true;
    if (G.alm && G.alm.syncReservations) G.alm.syncReservations(o, 'CONSUMED', 'Preparado en PRE');
    t.stock_moved = true;
  }

  /* ------------------------------------------------------------------
     Bolsas numeradas, verificación y carga (RN-PRE-07 a RN-PRE-09, RN-PRE-13)
     ------------------------------------------------------------------ */
  /** bolsas sugeridas: 1 por cada 6 kg o 4 unidades; caja térmica para congelados y provincia (D-PRE-03) */
  P.suggestParcels = function (taskOrOrder) {
    const o = taskOrOrder.order_id ? orderOf(taskOrOrder) : taskOrOrder;
    const frozen = o.lines.some(l => (G.productOf(l.variant_id) || {}).storage === 'FROZEN');
    const kg = U.sum(o.lines, l => l.weighed_kg ?? l.est_weight_kg ?? (l.qty * 0.5)); const units = U.sum(o.lines, l => G.variant(l.variant_id).sale_mode === 'KG' ? 1 : l.qty);
    const n = Math.max(1, Math.min(20, Math.ceil(Math.max(kg / 6, units / 4))));
    return { count: n, type: frozen || o.fulfillment === 'PROVINCE_SHIPPING' ? 'THERMAL_BOX' : 'BAG' };
  };
  P.caption = function (pc) {
    const o = G.db.get('sales_orders', pc.order_id);
    const kind = pc.parcel_type === 'BAG' ? 'bolsa' : pc.parcel_type === 'THERMAL_BOX' ? 'caja térmica' : pc.parcel_type === 'COOLER' ? 'cooler' : 'caja';
    return `Pedido ${shortNo(o)} · ${kind} ${pc.parcel_no} de ${pc.parcel_count} · Ruta ${pc.route_code || '—'} · parada ${pc.stop_seq ?? '—'}`;
  };
  P.pack = function (taskId, { count, type = 'BAG' } = {}) {
    const t = G.db.get('picking_tasks', taskId); const o = orderOf(t);
    if (!G.can('pre.task.pick')) G.fail('RN-PRE-07', `Tu rol (${G.roleName()}) no tiene el permiso pre.task.pick.`);
    if (t.status === 'PICKING' || t.status === 'PENDING') G.fail('RN-PRE-09', `El pedido ${o.number} tiene líneas incompletas sin faltante aprobado: termina el armado antes de embolsar.`);
    if (!['PICKED', 'PACKED'].includes(t.status)) G.fail('RN-PRE-07', `La tarea ya está ${(TASK_ST[t.status] || [t.status])[0].toLowerCase()}: las etiquetas no cambian.`);
    const n = Number(count) || P.suggestParcels(t).count;
    if (!(n >= 1 && n <= 20)) G.fail('RN-PRE-07', 'El número de bolsas va de 1 a 20.');
    if (!t.route_key) { const d = delStop(o); if (d) Object.assign(t, d); else { const code = zoneCode(o); const rk = keyOf(o, code); const seq = Math.max(0, ...G.db.where('picking_tasks', x => x.route_key === rk && x.stop_seq).map(x => x.stop_seq)) + 1; Object.assign(t, { route_code: code, route_key: rk, stop_seq: seq }); } }
    for (const old of G.db.where('shipment_parcels', p => p.task_id === t.id)) G.db.remove('shipment_parcels', old.id);
    const digits = String(o.number).replace(/\D/g, '');
    const kgTot = U.sum(o.lines, l => l.weighed_kg ?? l.est_weight_kg ?? 0);
    const out = [];
    for (let i = 1; i <= n; i++) {
      let code = `BOL-${digits}-${i}`;
      if (G.db.find('shipment_parcels', p => p.label_code === code && p.order_id !== o.id)) code = `BOL-${digits}-${String(o.id).slice(-4).toUpperCase()}-${i}`;
      const pc = ins('shipment_parcels', { task_id: t.id, order_id: o.id, parcel_no: i, parcel_count: n, parcel_type: type, label_code: code, route_id: t.route_id || null, route_code: t.route_code, route_key: t.route_key, stop_seq: t.stop_seq, weight_kg: kgTot ? R(kgTot / n, 3) : null, status: 'SEALED', loaded_at: null, loaded_by: null });
      pc.caption = P.caption(pc); out.push(pc);
    }
    Object.assign(t, { parcel_count: n, parcel_type: type, status: 'PACKED', packed_at: now() });
    G.db.touch();
    return out;
  };
  P.verify = function (taskId, { photo, parcel_count } = {}) {
    const t = G.db.get('picking_tasks', taskId); const o = orderOf(t);
    if (!G.can('pre.task.verify')) G.fail('RN-PRE-13', `Tu rol (${G.roleName()}) no tiene el permiso pre.task.verify.`);
    if (['PENDING', 'PICKING'].includes(t.status)) G.fail('RN-PRE-09', `El pedido ${o.number} tiene líneas incompletas sin faltante aprobado.`);
    if (t.status === 'PICKED' || !t.parcel_count) G.fail('RN-PRE-09', `Embolsa y etiqueta el pedido ${o.number} antes de verificarlo (falta el número de bolsas).`);
    if (t.status !== 'PACKED') G.fail('RN-PRE-09', `La tarea ya está ${(TASK_ST[t.status] || [t.status])[0].toLowerCase()}.`);
    if (!photo) G.fail('RN-PRE-09', `Toma la foto del pedido ${o.number} armado: VERIFICADO exige foto.`);
    if (parcel_count != null && Number(parcel_count) !== t.parcel_count) G.fail('RN-PRE-09', `Contaste ${parcel_count} bolsas y el pedido tiene ${t.parcel_count} etiquetas: revisa antes de verificar.`);
    if (G.param('pre_verify_by_other') !== false && t.preparer_user_id && t.preparer_user_id === me()) G.fail('RN-PRE-13', `Verifica una persona distinta de quien armó el pedido (${G.userName(t.preparer_user_id)}).`);
    if (o.weight_diff_status === 'NOTICE_REQUIRED') G.fail('RN-PED-05', `La diferencia de peso de ${o.number} supera la tolerancia: avisa al cliente antes de pasarlo a LISTO.`);
    Object.assign(t, { status: 'VERIFIED', verified_by: me(), verified_at: now(), finished_at: now(), photo_file_id: typeof photo === 'string' ? photo : 'foto-' + o.number + '.jpg' });
    if (['IN_PREPARATION', 'WEIGHED'].includes(o.status)) G.orders.transition(o, 'READY', { reason: `Verificado por ${G.ctx.userName()}` });
    G.db.touch();
    return t;
  };
  /** aviso de diferencia de peso (PED-07; si PED no está, se registra el aviso y se envía la plantilla de utilidad) */
  P.notifyWeight = function (orderId) {
    const o = G.db.get('sales_orders', orderId);
    if (G.ped && typeof G.ped.notifyWeightDiff === 'function') return G.ped.notifyWeightDiff(o);
    G.msg.send({ customer_id: o.customer_id, kind: 'UTILITY', template: 'diferencia_de_peso', text: `Hola, tu pedido ${o.number} pesó distinto a lo estimado. Nuevo total: ${G.fmt.money(o.final_total)}.`, ref: o.id, inServiceWindow: true });
    o.weight_diff_status = 'NOTICE_SENT'; G.db.update('sales_orders', o.id, { weight_diff_status: 'NOTICE_SENT' }, { silent: true });
    return o;
  };
  /** escaneo de carga: ruta correcta y orden inverso de paradas (RN-PRE-08) */
  P.loadScan = function (routeKey, raw) {
    if (!G.can('pre.load.scan')) G.fail('RN-PRE-08', `Tu rol (${G.roleName()}) no tiene el permiso pre.load.scan.`);
    const code = String(raw || '').trim().toUpperCase();
    const pc = G.db.find('shipment_parcels', p => p.label_code === code);
    const rec = (result, error_code, message) => { const s = ins('picking_scans', { task_id: pc ? pc.task_id : null, parcel_id: pc ? pc.id : null, route_id: pc ? pc.route_id : null, route_key: routeKey, scan_type: 'LOAD', barcode: code, result, error_code, message, scanned_at: now(), user_id: me(), order_id: pc ? pc.order_id : null, device_id: 'CEL-CARGA' }); return { result, ok: result === 'OK', message: error_code ? `${error_code}: ${message}` : message, scan: s, parcel: pc }; };
    if (!pc) return rec('UNKNOWN', 'RN-PRE-06', `La etiqueta ${code} no existe.`);
    const t = G.db.get('picking_tasks', pc.task_id);
    if (pc.route_key !== routeKey) return rec('WRONG_ROUTE', 'RN-PRE-08', `${P.caption(pc)}: pertenece a la ruta ${routeLabel(pc.route_key)}, no a ${routeLabel(routeKey)}. No la subas a este vehículo.`);
    if (pc.status === 'LOADED') return rec('DUPLICATE', 'RN-PRE-08', `${P.caption(pc)} ya está cargada.`);
    if (!['VERIFIED', 'LOADED'].includes(t.status)) return rec('LOAD_ORDER', 'RN-PRE-09', `El pedido ${t.order_number} no está verificado: no se carga.`);
    if (G.param('pre_load_order_strict') !== false) {
      const later = G.db.where('shipment_parcels', p => p.route_key === routeKey && p.status !== 'LOADED' && p.stop_seq > pc.stop_seq && (G.db.get('picking_tasks', p.task_id) || {}).status !== 'CANCELLED');
      if (later.length) { const stops = [...new Set(later.map(p => p.stop_seq))].sort((a, b) => b - a); return rec('LOAD_ORDER', 'RN-PRE-08', `Orden de carga: faltan ${later.length} bolsa(s) de la${stops.length > 1 ? 's' : ''} parada${stops.length > 1 ? 's' : ''} ${stops.join(', ')} (se cargan primero; la última parada va al fondo).`); }
    }
    Object.assign(pc, { status: 'LOADED', loaded_at: now(), loaded_by: me() });
    const res = rec('OK', null, `${P.caption(pc)} cargada.`);
    const all = G.db.where('shipment_parcels', p => p.task_id === t.id);
    if (all.every(p => p.status === 'LOADED')) {
      Object.assign(t, { status: 'LOADED', loaded_at: now() });
      G.events.emit('order.loaded', { order_id: t.order_id, number: t.order_number, route_key: routeKey, route_id: pc.route_id, parcels: all.length });
      const w = G.db.get('picking_waves', t.wave_id);
      if (w && G.db.where('picking_tasks', x => x.wave_id === w.id && x.status !== 'CANCELLED').every(x => x.status === 'LOADED')) w.status = 'LOADED';
      res.taskLoaded = true;
    }
    G.db.touch();
    return res;
  };
  P.parcelsOf = orderId => G.db.where('shipment_parcels', p => p.order_id === orderId).sort(U.by('parcel_no'));
  P.parcelCount = orderId => { const t = P.taskOf(orderId); return t && t.parcel_count ? t.parcel_count : P.parcelsOf(orderId).length; };
  P.routeLoad = function (routeKeyOrId) { const k = String(routeKeyOrId).startsWith('DEL:') || String(routeKeyOrId).includes('|') ? routeKeyOrId : 'DEL:' + routeKeyOrId; const ps = G.db.where('shipment_parcels', p => p.route_key === k); return { total: ps.length, loaded: ps.filter(p => p.status === 'LOADED').length, pending: ps.filter(p => p.status !== 'LOADED') }; };
  P.isLoaded = orderId => { const ps = P.parcelsOf(orderId); return ps.length > 0 && ps.every(p => p.status === 'LOADED'); };

  /* ------------------------------------------------------------------
     Errores de armado (RN-PRE-11)
     ------------------------------------------------------------------ */
  P.recordError = function (d) {
    if (!G.can('pre.error.manage') && !G.can('pre.task.verify')) G.fail('RN-PRE-11', `Tu rol (${G.roleName()}) no tiene el permiso pre.error.manage.`);
    if (!d.order_id) G.fail('RN-PRE-11', 'Indica el pedido.');
    if (!d.error_type || !d.detected_at_stage) G.fail('RN-PRE-11', 'Indica el tipo de error y la etapa en que se detectó.');
    if (!d.description) G.fail('RN-PRE-11', 'Describe el error.');
    if (['DELIVERY', 'CUSTOMER_CLAIM'].includes(d.detected_at_stage) && !d.responsible_employee_id) G.fail('RN-PRE-11', 'El error llegó al cliente: indica el responsable.');
    const t = P.taskOf(d.order_id) || G.db.find('picking_tasks', x => x.order_id === d.order_id);
    const e = ins('packing_errors', { order_id: d.order_id, task_id: t ? t.id : null, error_type: d.error_type, detected_at_stage: d.detected_at_stage, responsible_employee_id: d.responsible_employee_id || null, detected_by: me(), description: d.description, cost_amount: Number(d.cost_amount) || 0, corrective_action: d.corrective_action || null, status: 'OPEN', detected_at: d.detected_at || now(), establishment_id: (G.db.get('sales_orders', d.order_id) || {}).establishment_id }, false);
    G.events.emit('packing_error.recorded', { error_id: e.id, order_id: e.order_id, type: e.error_type, stage: e.detected_at_stage });
    return e;
  };
  P.closeError = function (id, action) {
    const e = G.db.get('packing_errors', id);
    if (!G.can('pre.error.manage')) G.fail('RN-PRE-11', `Tu rol (${G.roleName()}) no tiene el permiso pre.error.manage.`);
    if (!(action || e.corrective_action)) G.fail('RN-PRE-11', 'Cerrar un error exige la acción correctiva.');
    if (['DELIVERY', 'CUSTOMER_CLAIM'].includes(e.detected_at_stage) && !e.responsible_employee_id) G.fail('RN-PRE-11', 'Indica el responsable antes de cerrar.');
    G.db.update('packing_errors', id, { corrective_action: action || e.corrective_action, status: 'CLOSED', closed_at: now(), closed_by: me() });
    return e;
  };

  /* ------------------------------------------------------------------
     Eventos que consume PRE
     ------------------------------------------------------------------ */
  G.events.on('order.confirmed', p => { const o = G.db.get('sales_orders', p.order_id); if (o && ['CONFIRMED', 'IN_PREPARATION'].includes(o.status) && !['COUNTER'].includes(o.fulfillment)) P.ensureTask(o); });
  G.events.on('order.cancelled', p => {
    const t = P.taskOf(p.order_id); if (!t) return;
    t.status = 'CANCELLED'; t.cancelled_at = now();
    for (const pc of G.db.where('shipment_parcels', x => x.task_id === t.id)) pc.status = 'RETURNED';
    if (t.stock_moved && !(G.alm && G.alm.returnOrderStock)) { const o = G.db.get('sales_orders', p.order_id); for (const s of o.stock_out || []) G.inv.move({ type: 'RETURN', wh: s.wh, variant: s.variant_id, lot: s.lot_id, qty: s.qty, weight: s.weight_kg, source: { type: 'SALES_ORDER', id: o.id }, reason: 'Pedido cancelado tras preparar' }); o.stock_out = []; }
    G.db.touch();
  });
  G.events.on('lot.blocked', p => { const ts = new Set(G.db.where('picking_scans', s => s.lot_id === p.lot_id && s.result === 'OK' && s.scan_type === 'PICK').map(s => s.task_id)); const act = [...ts].map(id => G.db.get('picking_tasks', id)).filter(t => t && ['PICKING', 'PICKED', 'PACKED'].includes(t.status)); if (act.length) G.notify({ role: 'ALMACENERO', title: `Lote ${p.code} bloqueado con pedidos en armado`, body: 'Revisa y cambia el lote en: ' + act.map(t => t.order_number).join(', '), tone: 'bad', module: 'PRE' }); });
  G.events.on('lot.recalled', p => { const ts = G.db.where('picking_scans', s => s.lot_id === p.lot_id && s.result === 'OK'); if (ts.length) G.notify({ role: 'ALMACENERO', title: `Lote ${p.code} retirado`, body: `${new Set(ts.map(s => s.order_id)).size} pedido(s) lo llevan.`, tone: 'bad', module: 'PRE' }); });

  /* ------------------------------------------------------------------
     Datos de ejemplo (orden 27): olas de hoy en todos los estados e
     historial de octubre para los indicadores
     ------------------------------------------------------------------ */
  G.seed(27, function seedPRE() {
    const r = U.rng(2727);
    const s = (t, row) => G.db.insert(t, row, { silent: true });
    const preps = ['us-smamani', 'us-whuanca'];
    const verif = { 'us-smamani': 'us-whuanca', 'us-whuanca': 'us-mtorres' };
    const at = (d, min) => { const m = Math.max(0, Math.min(23 * 60 + 59, min)); return `${d}T${U.pad(Math.floor(m / 60), 2)}:${U.pad(m % 60, 2)}`; };
    G.db.seq['DG:OLA'] = 0;
    const mkTask = (o, st, wave, opts = {}) => {
      const t = s('picking_tasks', { wave_id: wave ? wave.id : null, order_id: o.id, order_number: o.number, establishment_id: o.establishment_id, brand_id: o.brand_id, delivery_date: o.delivery_date, slot_from: o.slot_from, slot_to: o.slot_to, preparer_user_id: null, status: st, parcel_count: null, parcel_type: null, photo_file_id: null, verified_by: null, started_at: null, finished_at: null, route_code: null, route_id: null, stop_seq: null, route_key: null, stock_moved: false });
      return t;
    };
    const mkLines = (t, o, mode) => {
      for (const l of o.lines) {
        const v = G.variant(l.variant_id);
        s('picking_task_lines', { task_id: t.id, order_line_id: l.id, variant_id: l.variant_id, qty_required: l.qty, qty_picked: mode === 'done' ? (v.sale_mode === 'KG' ? (l.weighed_kg ?? l.qty) : l.qty) : 0, est_weight_kg: l.est_weight_kg, weighed_kg: mode === 'done' && isWeighted(v) ? (l.weighed_kg ?? l.est_weight_kg) : null, status: mode === 'done' ? 'DONE' : 'PENDING', short_reason: null, short_approved_by: null, cut_notes: l.cut_notes || null, weighted: isWeighted(v) });
      }
    };
    const okScans = (t, o, when, perUnit) => {
      let k = 0;
      for (const l of linesOf(t.id)) {
        const v = G.variant(l.variant_id); const ol = o.lines.find(x => x.id === l.order_line_id);
        const rs = (o.reservations || []).find(x => x.line_id === l.order_line_id);
        let lotId = rs ? rs.lot_id : (G.db.find('lots', x => x.variant_id === v.id && x.qc_status === 'RELEASED') || {}).id || null;
        const n = perUnit && v.sale_mode !== 'KG' ? Math.round(l.qty_required) : 1;
        for (let i = 0; i < n; i++) {
          const wgt = isWeighted(v) ? R((l.weighed_kg || l.est_weight_kg || 0) / n, 3) : null;
          const code = r() < 0.4 && isWeighted(v) && v.scale_plu ? P.scaleLabel(v.id, wgt) + (i ? '' : '') : ((lotOf(lotId) || {}).code || v.sku);
          s('picking_scans', { task_id: t.id, task_line_id: l.id, scan_type: 'PICK', barcode: code, variant_id: v.id, lot_id: lotId, weight_kg: wgt, qty: v.sale_mode === 'KG' ? wgt || l.qty_required : 1, result: 'OK', error_code: null, message: null, override_by: null, device_id: 'CEL-PRE', scanned_at: at(when.slice(0, 10), hm(when.slice(11)) + (++k)), user_id: t.preparer_user_id, order_id: o.id, wave_id: t.wave_id });
        }
        if (ol && lotId && !ol.lot_id) ol.lot_id = lotId;
      }
    };
    const consume = (t, o) => { if ((o.reservations || []).length) { try { consumeStock(t, o); } catch (e) { t.stock_error = e.message; } } else t.stock_moved = true; };
    const mkParcels = (t, o, status, loadedAt) => {
      const sp = P.suggestParcels(o); const digits = String(o.number).replace(/\D/g, '');
      for (let i = 1; i <= sp.count; i++) s('shipment_parcels', { task_id: t.id, order_id: o.id, parcel_no: i, parcel_count: sp.count, parcel_type: sp.type, label_code: `BOL-${digits}-${i}`, route_id: null, route_code: t.route_code, route_key: t.route_key, stop_seq: t.stop_seq, weight_kg: null, status, loaded_at: status === 'LOADED' ? loadedAt : null, loaded_by: status === 'LOADED' ? t.preparer_user_id : null });
      t.parcel_count = sp.count; t.parcel_type = sp.type;
    };
    /* --- hoy --- */
    const today = G.db.where('sales_orders', o => o.delivery_date === G.TODAY && ['IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE'].includes(o.status) && o.fulfillment !== 'COUNTER');
    const groups = U.groupBy(today, o => o.establishment_id + '|' + o.slot_from);
    const keys = Object.keys(groups).sort((a, b) => a.split('|')[1].localeCompare(b.split('|')[1]));
    let pi = 0, nT = 0;
    for (const k of keys) {
      const os = groups[k]; const [site, slot] = k.split('|');
      const allRoute = os.every(o => o.status === 'IN_ROUTE');
      const w = s('picking_waves', { number: G.db.next('OLA', 'OLA-', 4), establishment_id: site, warehouse_id: site === 'es-L2' ? 'wh-CAM-L2' : 'wh-CAM-L1', wave_date: G.TODAY, slot_from: slot, slot_to: os[0].slot_to, route_id: null, route_code: null, status: allRoute ? 'LOADED' : 'PICKING', released_at: at(G.TODAY, hm(slot) - 200), released_by: 'us-mtorres', created_by: 'us-mtorres', closed_at: null });
      const ts = [];
      for (const o of os) {
        const st = { IN_ROUTE: 'LOADED', READY: 'VERIFIED', WEIGHED: (nT++ % 2 ? 'PACKED' : 'PICKED'), IN_PREPARATION: 'PICKING' }[o.status];
        const t = mkTask(o, st, w); ts.push([t, o]);
        t.preparer_user_id = preps[pi++ % 2];
        t.started_at = at(G.TODAY, hm(slot) - 180 + U.int(r, 0, 40));
      }
      assignRoutes(w);
      for (const [t, o] of ts) {
        const st = t.status;
        if (st === 'PICKING') {
          mkLines(t, o, 'pending');
          const l0 = linesOf(t.id)[0]; const v0 = G.variant(l0.variant_id);
          const rs = (o.reservations || []).find(x => x.line_id === l0.order_line_id);
          if (v0.sale_mode === 'UNIT_VARIABLE_WEIGHT' && l0.qty_required >= 2) {
            const wgt = R((l0.est_weight_kg / l0.qty_required) * (0.95 + r() * 0.1), 3);
            s('picking_scans', { task_id: t.id, task_line_id: l0.id, scan_type: 'PICK', barcode: rs ? lotOf(rs.lot_id).code : v0.sku, variant_id: v0.id, lot_id: rs ? rs.lot_id : null, weight_kg: wgt, qty: 1, result: 'OK', device_id: 'CEL-PRE', scanned_at: at(G.TODAY, hm(t.started_at.slice(11)) + 3), user_id: t.preparer_user_id, order_id: o.id, wave_id: w.id });
            Object.assign(l0, { qty_picked: 1, weighed_kg: wgt, status: 'PARTIAL' });
          }
        } else {
          mkLines(t, o, 'done');
          okScans(t, o, at(G.TODAY, hm(t.started_at.slice(11))), true);
          t.picked_at = at(G.TODAY, hm(t.started_at.slice(11)) + 12);
          consume(t, o);
          if (['PACKED', 'VERIFIED', 'LOADED'].includes(st)) { mkParcels(t, o, st === 'LOADED' ? 'LOADED' : 'SEALED', at(G.TODAY, hm(slot) - 25)); t.packed_at = at(G.TODAY, hm(t.started_at.slice(11)) + 16); }
          if (['VERIFIED', 'LOADED'].includes(st)) { t.verified_by = verif[t.preparer_user_id]; t.photo_file_id = `foto-${o.number}.jpg`; t.finished_at = at(G.TODAY, hm(t.started_at.slice(11)) + 22 + U.int(r, 0, 20)); t.verified_at = t.finished_at; }
          if (st === 'LOADED') t.loaded_at = at(G.TODAY, hm(slot) - 20);
        }
      }
    }
    // lecturas bloqueadas de hoy: pedido cruzado, producto de otra marca y lote en cuarentena (con una autorización FEFO pendiente)
    const picking = G.db.where('picking_tasks', t => t.status === 'PICKING');
    const blockers = [];
    for (const t of picking) {
      const o = orderOf(t);
      const other = G.db.find('picking_tasks', x => x.wave_id === t.wave_id && x.id !== t.id && linesOf(x.id).some(l => !linesOf(t.id).some(m => m.variant_id === l.variant_id)));
      if (other) { const l = linesOf(other.id).find(l => !linesOf(t.id).some(m => m.variant_id === l.variant_id)); const v = G.variant(l.variant_id); blockers.push({ task_id: t.id, scan_type: 'PICK', barcode: v.sku, variant_id: v.id, lot_id: null, result: 'WRONG_ORDER', error_code: 'RN-PRE-03', message: `Pedido cruzado: ${v.name} es del pedido ${other.order_number}, no del ${o.number}.`, user_id: t.preparer_user_id, order_id: o.id, wave_id: t.wave_id }); }
      blockers.push({ task_id: t.id, scan_type: 'PICK', barcode: 'L261010-Q01', variant_id: 'va-DG-CUY-ENT', lot_id: 'lo-Q001', result: linesOf(t.id).some(l => l.variant_id === 'va-DG-CUY-ENT') ? 'LOT_NOT_RELEASED' : 'WRONG_PRODUCT', error_code: 'RN-PRE-04', message: 'El lote L261010-Q01 está en cuarentena: solo se prepara con lotes liberados.', user_id: t.preparer_user_id, order_id: o.id, wave_id: t.wave_id });
    }
    // FEFO pendiente: el pedido en armado con cuy (o el primero) leyó el lote que vence después
    const tf = picking.find(t => linesOf(t.id).some(l => G.db.where('lots', x => x.variant_id === l.variant_id && x.qc_status === 'RELEASED').length >= 2)) || null;
    if (tf) {
      const l = linesOf(tf.id).find(l => G.db.where('lots', x => x.variant_id === l.variant_id && x.qc_status === 'RELEASED').length >= 2);
      const lots = G.db.where('lots', x => x.variant_id === l.variant_id && x.qc_status === 'RELEASED').sort(U.by('expiry_date'));
      const late = lots[lots.length - 1], early = lots[0]; const v = G.variant(l.variant_id);
      blockers.push({ task_id: tf.id, task_line_id: l.id, scan_type: 'PICK', barcode: late.code, variant_id: v.id, lot_id: late.id, weight_kg: v.nominal_weight_kg || (v.sale_mode === 'KG' ? 1 : null), result: 'NOT_FEFO', error_code: 'RN-PRE-05', message: `FEFO: el lote ${early.code} vence el ${G.fmt.date(early.expiry_date)}, antes que ${late.code}.`, suggested_lot_id: early.id, user_id: tf.preparer_user_id, order_id: tf.order_id, wave_id: tf.wave_id });
    }
    blockers.forEach((b, i) => s('picking_scans', Object.assign({ device_id: 'CEL-PRE', weight_kg: null, scanned_at: at(G.TODAY, hm('11:20') + i * 4) }, b)));
    // pedidos CONFIRMADOS: tarea pendiente sin ola (se planifican en PRE-01)
    for (const o of G.db.where('sales_orders', o => o.status === 'CONFIRMED' && o.delivery_date >= G.TODAY && o.fulfillment !== 'COUNTER')) { const t = mkTask(o, 'PENDING', null); mkLines(t, o, 'pending'); }
    /* --- historial de octubre (1 al 9): tareas cargadas con tiempos, lecturas y errores --- */
    const hist = G.db.where('sales_orders', o => o.delivery_date >= '2026-10-01' && o.delivery_date < G.TODAY && ['DELIVERED', 'CLOSED', 'IN_ROUTE'].includes(o.status));
    const histWaves = {};
    for (const o of hist) {
      const wk = o.delivery_date + '|' + o.establishment_id + '|' + o.slot_from;
      const w = histWaves[wk] || (histWaves[wk] = s('picking_waves', { number: G.db.next('OLA', 'OLA-', 4), establishment_id: o.establishment_id, warehouse_id: o.establishment_id === 'es-L2' ? 'wh-CAM-L2' : 'wh-CAM-L1', wave_date: o.delivery_date, slot_from: o.slot_from, slot_to: o.slot_to, status: 'CLOSED', released_at: at(o.delivery_date, hm(o.slot_from) - 210), released_by: 'us-mtorres', closed_at: at(o.delivery_date, hm(o.slot_from)), created_by: 'us-mtorres' }));
      const t = mkTask(o, 'LOADED', w);
      t.preparer_user_id = preps[U.int(r, 0, 1)];
      const start = hm(o.slot_from) - 170 + U.int(r, 0, 70);
      const dur = 10 + U.int(r, 0, 26) + o.lines.length * 4;
      t.started_at = at(o.delivery_date, start); t.picked_at = at(o.delivery_date, start + dur - 6); t.finished_at = at(o.delivery_date, start + dur); t.verified_at = t.finished_at; t.verified_by = verif[t.preparer_user_id]; t.photo_file_id = `foto-${o.number}.jpg`; t.loaded_at = at(o.delivery_date, hm(o.slot_from) - 15); t.stock_moved = true;
      t.route_code = zoneCode(o); t.route_key = keyOf(o, t.route_code); t.stop_seq = 1 + U.int(r, 0, 8);
      mkLines(t, o, 'done');
      okScans(t, o, t.started_at, false);
      if (r() < 0.07) { const v = G.variant(U.pick(r, ['va-DG-CON-ENT', 'va-DG-POL-ENT', 'va-M3-CHO-500', 'va-DG-CAL-1L'])); s('picking_scans', { task_id: t.id, scan_type: 'PICK', barcode: v.sku, variant_id: v.id, result: U.pick(r, ['WRONG_ORDER', 'WRONG_PRODUCT', 'NOT_FEFO', 'EXCESS', 'DUPLICATE']), error_code: 'RN-PRE-03', message: 'Lectura bloqueada', device_id: 'CEL-PRE', scanned_at: at(o.delivery_date, start + 2), user_id: t.preparer_user_id, order_id: o.id, wave_id: w.id }); }
      mkParcels(t, o, o.status === 'IN_ROUTE' ? 'LOADED' : 'DELIVERED', t.loaded_at);
    }
    // errores de armado (RN-PRE-11)
    const emp = uid => (G.db.get('users', uid) || {}).employee_id;
    const del = hist.filter(o => o.status !== 'IN_ROUTE');
    const E = [
      ['CROSSED_CUSTOMER', 'DELIVERY', 'us-whuanca', 'La bolsa 2 de 2 del pedido se entregó a la vecina de la misma ruta', 18, 'Carga por escaneo obligatoria y etiqueta con parada', 'CLOSED'],
      ['WRONG_PRODUCT', 'CUSTOMER_CLAIM', 'us-smamani', 'Pidió cuy entero y recibió cuy en mitades', 42, 'Escanear cada paquete contra el pedido', 'CLOSED'],
      ['WRONG_WEIGHT', 'CUSTOMER_CLAIM', 'us-whuanca', 'Pechuga con 180 g menos que lo cobrado', 5.04, 'Pesar en la balanza etiquetadora, no digitar', 'CLOSED'],
      ['MISSING_ITEM', 'DELIVERY', 'us-smamani', 'Faltó el caldo de huesos 1 L en la bolsa', 18, null, 'OPEN'],
      ['DAMAGED_PACKAGE', 'VERIFICATION', 'us-whuanca', 'Bolsa al vacío rota detectada en la verificación', 0, 'Se reempacó antes de cargar', 'CLOSED'],
      ['WRONG_CUT', 'VERIFICATION', 'us-smamani', 'Cliente pidió cortes gruesos para parrilla y se cortó delgado', 0, null, 'OPEN'],
      ['LABEL_ERROR', 'LOADING', 'us-whuanca', 'Etiqueta con parada equivocada; el escaneo de carga lo bloqueó', 0, 'Reimprimir etiquetas al cambiar la ruta', 'CLOSED'],
      ['EXPIRED_LOT', 'PICKING_SCAN', 'us-smamani', 'Se tomó jamón del lote L260915-J07 por vencer; el escaneo lo bloqueó por FEFO', 0, null, 'OPEN'],
    ];
    E.forEach(([type, stage, who, desc, cost, act, st], i) => { const o = del[Math.floor((i + 1) * del.length / (E.length + 2))]; if (!o) return; const t = G.db.find('picking_tasks', x => x.order_id === o.id); s('packing_errors', { order_id: o.id, task_id: t ? t.id : null, error_type: type, detected_at_stage: stage, responsible_employee_id: ['DELIVERY', 'CUSTOMER_CLAIM'].includes(stage) || st === 'CLOSED' ? emp(who) : null, detected_by: stage === 'DELIVERY' ? 'us-rchavez' : stage === 'CUSTOMER_CLAIM' ? 'us-pleon' : 'us-mtorres', description: desc, cost_amount: cost, corrective_action: act, status: st, detected_at: at(o.delivery_date, hm(o.slot_from) + 60), establishment_id: o.establishment_id, closed_at: st === 'CLOSED' ? at(o.delivery_date, hm(o.slot_from) + 300) : null }); });
  }, 'preparacion');

  /* ------------------------------------------------------------------
     Indicadores (TAB)
     ------------------------------------------------------------------ */
  const inP = (d, p) => { const x = String(d || '').slice(0, 10); return x >= (p.from || '0000') && x <= (p.to || '9999'); };
  const tOk = (t, p) => (!p.site || t.establishment_id === p.site) && (!p.brand || t.brand_id === p.brand);
  const mins = (a, b) => { const x = new Date(a.length === 16 ? a + ':00' : a), y = new Date(b.length === 16 ? b + ':00' : b); return (x - y) / 60000; };
  G.kpiCalc['KPI-PRE-01'] = p => { const ts = G.db.where('picking_tasks', t => ['VERIFIED', 'LOADED'].includes(t.status) && t.started_at && t.finished_at && inP(t.finished_at, p) && tOk(t, p)); const hrs = U.sum(ts, t => Math.max(0, mins(t.finished_at, t.started_at)) / 60); return { value: hrs ? R(ts.length / hrs, 1) : 0, numerator: ts.length, denominator: R(hrs, 2) }; };
  G.kpiCalc['KPI-PRE-02'] = p => { const xs = G.db.where('picking_tasks', t => t.finished_at && inP(t.finished_at, p) && tOk(t, p)).map(t => { const o = orderOf(t); return o && o.confirmed_at ? mins(t.finished_at, o.confirmed_at) : null; }).filter(x => x !== null && x >= 0).sort((a, b) => a - b); if (!xs.length) return 0; const m = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2; return R(m, 0); };
  /** pedidos con error de armado que llegó al cliente / pedidos entregados × 100 */
  P.errorRate = (errors, delivered) => delivered ? R(errors / delivered * 100, 2) : 0;
  G.kpiCalc['KPI-PRE-03'] = p => { const del = G.sales.orders(Object.assign({}, p, { statuses: ['DELIVERED', 'CLOSED'] })); const ids = new Set(del.map(o => o.id)); const errOrders = new Set(G.db.where('packing_errors', e => ['DELIVERY', 'CUSTOMER_CLAIM'].includes(e.detected_at_stage) && ids.has(e.order_id)).map(e => e.order_id)); return { value: P.errorRate(errOrders.size, del.length), numerator: errOrders.size, denominator: del.length }; };
  G.kpiCalc['KPI-PRE-04'] = p => { const ts = new Set(G.db.where('picking_tasks', t => inP(t.delivery_date, p) && tOk(t, p)).map(t => t.id)); const ls = G.db.where('picking_task_lines', l => ts.has(l.task_id) && ['DONE', 'SHORT_APPROVED'].includes(l.status)); const scanned = new Set(G.db.where('picking_scans', s => s.result === 'OK' && s.task_line_id && ts.has(s.task_id)).map(s => s.task_line_id)); const ok = ls.filter(l => l.status === 'DONE' && scanned.has(l.id)).length; return { value: ls.length ? R(ok / ls.length * 100, 1) : 0, numerator: ok, denominator: ls.length }; };
  G.kpiCalc['KPI-PRE-05'] = p => G.db.where('picking_scans', s => s.result !== 'OK' && !s.override_of && inP(s.scanned_at, p) && (!p.site || (G.db.get('picking_tasks', s.task_id) || {}).establishment_id === p.site)).length;
  G.kpiCalc['KPI-PRE-06'] = p => { const ls = []; for (const o of G.db.where('sales_orders', o => inP(o.delivery_date, p) && (!p.brand || o.brand_id === p.brand) && (!p.site || o.establishment_id === p.site))) for (const l of o.lines) if (l.price_basis === 'KG' && l.weighed_kg != null && l.est_weight_kg) ls.push(l); const est = U.sum(ls, l => l.est_weight_kg); return { value: est ? R(U.sum(ls, l => Math.abs(l.weighed_kg - l.est_weight_kg)) / est * 100, 2) : 0, numerator: R(U.sum(ls, l => Math.abs(l.weighed_kg - l.est_weight_kg)), 3), denominator: R(est, 3) }; };
  P.onTime = t => { if (!t.finished_at || !t.slot_from) return null; const lead = G.param('pre_ready_lead_minutes') ?? 60; const due = `${t.delivery_date}T${U.pad(Math.floor((hm(t.slot_from) - lead) / 60), 2)}:${U.pad((hm(t.slot_from) - lead) % 60, 2)}`; return t.finished_at <= due; };
  G.kpiCalc['KPI-PRE-07'] = p => { const ts = G.db.where('picking_tasks', t => ['VERIFIED', 'LOADED'].includes(t.status) && t.finished_at && inP(t.delivery_date, p) && tOk(t, p)); const ok = ts.filter(t => P.onTime(t)).length; return { value: ts.length ? R(ok / ts.length * 100, 1) : 0, numerator: ok, denominator: ts.length }; };

  /* ------------------------------------------------------------------
     Alertas, búsqueda y escaneo
     ------------------------------------------------------------------ */
  const nowHM = () => hm(G.date.now().slice(11, 16));
  P.late = () => G.db.where('picking_tasks', t => t.delivery_date === G.TODAY && ['PENDING', 'PICKING', 'PICKED', 'PACKED'].includes(t.status) && t.slot_from && nowHM() > hm(t.slot_from) - (G.param('pre_ready_lead_minutes') ?? 60));
  G.alertProviders.push(() => {
    const out = [];
    const f = P.pendingFefo(); if (f.length) out.push({ module: 'PRE', title: `${f.length} lectura(s) bloqueadas por FEFO por autorizar`, detail: f.slice(0, 3).map(s => `${(G.db.get('picking_tasks', s.task_id) || {}).order_number}: ${s.barcode}`).join(' · '), tone: 'warn', go: () => G.go('PRE-12') });
    const sh = G.db.where('picking_task_lines', l => l.short_reason && l.status !== 'SHORT_APPROVED' && l.status !== 'DONE'); if (sh.length) out.push({ module: 'PRE', title: `${sh.length} faltante(s) por aprobar`, detail: 'La vendedora recibe el aviso al aprobarse (RN-PRE-12).', tone: 'warn', go: () => G.go('PRE-09') });
    const late = P.late(); if (late.length) out.push({ module: 'PRE', title: `${late.length} pedido(s) atrasados respecto de su franja`, detail: late.slice(0, 4).map(t => `${t.order_number} (${t.slot_from})`).join(', '), tone: 'bad', go: () => G.go('PRE-11') });
    const pk = G.db.where('picking_tasks', t => t.status === 'PACKED' && t.delivery_date === G.TODAY); if (pk.length) out.push({ module: 'PRE', title: `${pk.length} pedido(s) embolsados por verificar`, detail: 'Verifica otra persona con foto (RN-PRE-13).', tone: 'info', go: () => G.go('PRE-07') });
    const er = G.db.where('packing_errors', e => e.status === 'OPEN'); if (er.length) out.push({ module: 'PRE', title: `${er.length} error(es) de armado abiertos`, detail: 'Ciérralos con su acción correctiva (RN-PRE-11).', tone: 'info', go: () => G.go('PRE-10') });
    return out;
  });
  G.searchProviders.push(q => {
    const s = q.toLowerCase(); const out = [];
    for (const w of G.db.where('picking_waves', w => w.number.toLowerCase().includes(s)).slice(0, 3)) out.push({ label: `Ola ${w.number}`, sub: `${G.siteName(w.establishment_id)} · ${G.fmt.date(w.wave_date)} ${w.slot_from}`, go: () => G.go('PRE-02', { wave: w.id }) });
    for (const p of G.db.where('shipment_parcels', p => p.label_code.toLowerCase().includes(s)).slice(0, 3)) out.push({ label: `Bolsa ${p.label_code}`, sub: P.caption(p), go: () => G.go('PRE-06', { task: p.task_id }) });
    return out;
  });
  G.scanHandlers.push(code => {
    const pc = G.db.find('shipment_parcels', p => p.label_code === code); if (pc) return () => G.go('PRE-06', { task: pc.task_id });
    const w = G.db.find('picking_waves', x => x.number === code); if (w) return () => G.go('PRE-02', { wave: w.id });
    return null;
  });

  /* ------------------------------------------------------------------
     Pantallas
     ------------------------------------------------------------------ */
  let audio = null;
  const beep = ok => { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = ok ? 1320 : 220; o.type = ok ? 'sine' : 'square'; g.gain.value = 0.06; o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.08 : 0.35)); } catch (e) { } };
  const todayTasks = (pred = () => true) => G.scope.filter(G.db.where('picking_tasks', t => t.delivery_date === G.TODAY && t.status !== 'CANCELLED' && pred(t)));
  const taskOpts = (pred) => todayTasks(pred).sort((a, b) => String(a.slot_from).localeCompare(String(b.slot_from)) || a.order_number.localeCompare(b.order_number)).map(t => [t.id, `${t.order_number} · ${G.custName(orderOf(t).customer_id)} · ${t.slot_from} · ${(TASK_ST[t.status] || [t.status])[0]}`]);
  const progressOf = t => { const ls = linesOf(t.id); if (!ls.length) return 0; return R(U.sum(ls, l => { const v = G.variant(l.variant_id); if (l.status === 'SHORT_APPROVED' || l.status === 'DONE') return 1; return v.sale_mode === 'KG' ? Math.min(1, (l.weighed_kg || 0) / l.qty_required) : Math.min(1, l.qty_picked / l.qty_required); }) / ls.length * 100, 0); };
  const taskSelect = (cur, pred, go) => { const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Pedido' } }, taskOpts(pred).map(([v, l]) => h('option', { value: v, selected: v === cur }, l))); sel.addEventListener('change', () => go(sel.value)); return sel; };
  const orderHead = (t, o) => dl([['Pedido', `${o.number} · ${G.brandName(o.brand_id)}`], ['Cliente', G.custName(o.customer_id)], ['Teléfono', mask(o.contact_phone)], ['Entrega', `${G.fmt.date(o.delivery_date)} · ${o.slot_from || ''}–${o.slot_to || ''} · ${G.fulfillName(o.fulfillment)}`], ['Ruta y parada', t.route_key ? `${routeLabel(t.route_key)} · parada ${t.stop_seq}` : 'Se asigna al liberar la ola'], ['Notas de preparación', o.notes]]);

  /* ---------- PRE-01 Planificador de olas ---------- */
  function pre01(el, params = {}) {
    const can = G.can('pre.wave.manage');
    const body = page(el, { code: 'PRE-01', title: 'Planificador de olas', sub: 'Pedidos confirmados por fecha, franja, zona y ruta. Crea la ola y libérala: los pedidos pasan a EN PREPARACIÓN y se emite wave.released (D-PRE-04: por ruta si DEL ya la armó; si no, por franja).' });
    const date = params.date || G.TODAY;
    body.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap' }, pills([[G.TODAY, 'Hoy ' + G.fmt.date(G.TODAY)], [G.date.add(G.TODAY, 1), 'Mañana ' + G.fmt.date(G.date.add(G.TODAY, 1))]], date, v => G.go('PRE-01', { date: v }))));
    const conf = G.scope.filter(G.db.where('sales_orders', o => o.delivery_date === date && ['CONFIRMED', 'IN_PREPARATION'].includes(o.status) && o.fulfillment !== 'COUNTER'));
    const free = conf.filter(o => { const t = P.taskOf(o.id); if (!t) return true; if (!t.wave_id) return true; const w = G.db.get('picking_waves', t.wave_id); return !w || w.status === 'CANCELLED'; });
    const waves = G.scope.filter(G.db.where('picking_waves', w => w.wave_date === date), { brand: '_' });
    body.appendChild(kpis([
      { label: 'Confirmados sin ola', value: free.length, tone: free.length ? 'warn' : 'ok', sub: 'Por planificar' },
      { label: 'Olas del día', value: waves.filter(w => w.status !== 'CANCELLED').length, sub: `${waves.filter(w => w.status === 'DRAFT').length} en borrador` },
      { label: 'Pedidos en preparación', value: G.scope.filter(G.db.where('sales_orders', o => o.delivery_date === date && ['IN_PREPARATION', 'WEIGHED'].includes(o.status))).length },
      { label: 'Listos o en ruta', value: G.scope.filter(G.db.where('sales_orders', o => o.delivery_date === date && ['READY', 'IN_ROUTE'].includes(o.status))).length, tone: 'ok' },
    ]));
    const groups = U.groupBy(free, o => `${o.establishment_id}|${o.slot_from || '—'}|${o.slot_to || ''}`);
    const gwrap = h('div', { class: 'grid c2' });
    if (!free.length) gwrap.appendChild(card('Pedidos confirmados', G.ui.empty('No hay pedidos confirmados sin ola para esta fecha.')));
    for (const [k, os] of Object.entries(groups).sort()) {
      const [site, sf, st] = k.split('|');
      const sel = new Set(os.map(o => o.id));
      const list = h('div', { class: 'stack', style: 'gap:2px' }, os.sort((a, b) => zoneCode(a).localeCompare(zoneCode(b))).map(o => { const cb = h('input', { type: 'checkbox', checked: true, attrs: { 'aria-label': 'Incluir ' + o.number } }); cb.addEventListener('change', () => cb.checked ? sel.add(o.id) : sel.delete(o.id)); return h('label', { class: 'between small', style: 'gap:8px;padding:5px 0;border-bottom:1px solid var(--line);cursor:pointer' }, h('span', { class: 'row', style: 'gap:8px;min-width:0' }, cb, h('span', { style: 'min-width:0' }, h('b', { class: 'mono' }, o.number), ` · ${G.custName(o.customer_id)}`)), h('span', { class: 'row', style: 'gap:6px' }, badge(zoneCode(o), 'info'), h('span', { class: 'muted' }, `${o.lines.length} lín. · ${G.fmt.kg(o.est_kg, 1)}`))); }));
      gwrap.appendChild(card(`${G.siteName(site)} · franja ${sf}–${st} · ${os.length} pedidos`, list, { actions: can ? [btn('Crear ola', () => { const w = tryDo(() => P.createWave({ site, date, slot_from: sf, slot_to: st, order_ids: [...sel] }), w => `Ola ${w.number} creada en borrador con ${sel.size} pedidos`); }, { sm: true }), btn('Crear y liberar', () => tryDo(() => { const w = P.createWave({ site, date, slot_from: sf, slot_to: st, order_ids: [...sel] }); P.releaseWave(w.id); return w; }, w => `Ola ${w.number} liberada: ${sel.size} pedidos en preparación`), { sm: true, kind: 'primary' })] : [] }));
    }
    body.appendChild(gwrap);
    const rows = waves.map(w => { const ts = G.db.where('picking_tasks', t => t.wave_id === w.id && t.status !== 'CANCELLED'); return Object.assign({}, w, { _ref: w, n: ts.length, prog: ts.length ? R(U.sum(ts, progressOf) / ts.length, 0) : 0, verified: ts.filter(t => ['VERIFIED', 'LOADED'].includes(t.status)).length }); });
    body.appendChild(card('Olas', table({ id: 'pre01', rows, sort: 'slot_from', search: false, columns: [{ key: 'number', label: 'Ola', mono: true }, { key: 'establishment_id', label: 'Local', value: w => G.siteName(w.establishment_id) }, { key: 'slot_from', label: 'Franja', render: w => `${w.slot_from}–${w.slot_to}` }, { key: 'warehouse_id', label: 'Almacén', value: w => (G.db.get('warehouses', w.warehouse_id) || {}).code }, { key: 'n', label: 'Pedidos', align: 'r' }, { key: 'prog', label: 'Avance', render: w => h('div', { style: 'min-width:110px' }, G.ui.progress(w.prog, w.prog >= 100 ? 'ok' : ''), h('span', { class: 'small muted' }, `${w.prog} % · ${w.verified}/${w.n} verificados`)) }, { key: 'status', label: 'Estado', render: w => wBadge(w.status) }], actions: w => [w.status === 'DRAFT' && can ? btn('Liberar', () => tryDo(() => P.releaseWave(w.id), `Ola ${w.number} liberada: se emitió wave.released`), { sm: true, kind: 'primary' }) : null, w.status === 'DRAFT' && can ? btn('Cancelar', () => tryDo(() => P.cancelWave(w.id, 'Replanificación'), 'Ola cancelada'), { sm: true, kind: 'ghost' }) : null, w.status !== 'DRAFT' ? btn('Lista', () => G.go('PRE-02', { wave: w.id }), { sm: true }) : null].filter(Boolean), onRow: w => G.go('PRE-02', { wave: w.id }), empty: 'Sin olas para esta fecha.' }), { flush: true }));
  }

  /* ---------- PRE-02 Lista consolidada ---------- */
  const waveOpts = () => G.scope.filter(G.db.where('picking_waves', w => !['CANCELLED'].includes(w.status) && w.wave_date >= G.date.add(G.TODAY, -1)), { brand: '_' }).sort(U.by('number', -1)).map(w => [w.id, `${w.number} · ${G.siteName(w.establishment_id)} · ${G.fmt.date(w.wave_date)} ${w.slot_from}–${w.slot_to} · ${WAVE_ST[w.status][0]}`]);
  const defaultWave = () => { const ws = G.db.where('picking_waves', w => w.wave_date === G.TODAY && ['RELEASED', 'PICKING'].includes(w.status)); return (ws[0] || G.db.where('picking_waves', w => w.wave_date === G.TODAY).slice(-1)[0] || {}).id; };
  P.consolidated = function (waveId) {
    const w = G.db.get('picking_waves', waveId); const ts = G.db.where('picking_tasks', t => t.wave_id === waveId && t.status !== 'CANCELLED');
    const by = {};
    for (const t of ts) for (const l of linesOf(t.id)) { const e = by[l.variant_id] || (by[l.variant_id] = { variant_id: l.variant_id, qty: 0, kg: 0, picked: 0, orders: new Set(), cuts: new Set() }); e.qty += l.qty_required; e.kg += l.est_weight_kg || 0; e.picked += l.status === 'DONE' || l.status === 'SHORT_APPROVED' ? l.qty_required : l.qty_picked; e.orders.add(t.order_number); if (l.cut_notes) e.cuts.add(l.cut_notes); }
    const whs = waveWhs(w.establishment_id);
    return Object.values(by).map(e => { const v = G.variant(e.variant_id); const c = (G.alm && G.alm.fefoCandidates ? G.alm.fefoCandidates(e.variant_id, w.establishment_id, { deliveryDate: w.wave_date, ignoreReserved: true }) : G.inv.fefo(e.variant_id).filter(x => whs.includes(x.b.warehouse_id)).map(x => Object.assign(x, { wh: G.db.get('warehouses', x.b.warehouse_id) })))[0]; return Object.assign(e, { v, sku: v.sku, name: v.name, qty: R(e.qty, 3), kg: R(e.kg, 3), lot: c ? c.lot : null, wh: c ? c.wh || G.db.get('warehouses', c.b.warehouse_id) : null, stock: R(U.sum(G.db.where('stock_balances', b => b.variant_id === e.variant_id && whs.includes(b.warehouse_id) && G.inv.lotUsable(b.lot_id)), b => b.qty), 3), n: e.orders.size }); }).sort((a, b) => String(a.wh ? a.wh.code : 'ZZ').localeCompare(String(b.wh ? b.wh.code : 'ZZ')) || a.name.localeCompare(b.name));
  };
  function pre02(el, params = {}) {
    const wid = params.wave || defaultWave();
    const body = page(el, { code: 'PRE-02', title: 'Lista consolidada', sub: 'Por producto y corte: cantidad, kg estimados, lote sugerido por FEFO entre los lotes liberados y su ubicación (cámara o congeladora), para sacar todo de una vez.', actions: [{ label: 'Imprimir', onClick: () => G.print() }] });
    const opts = waveOpts();
    if (!opts.length || !wid) { body.appendChild(G.ui.empty('No hay olas. Créalas en PRE-01.')); return; }
    const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Ola' } }, opts.map(([v, l]) => h('option', { value: v, selected: v === wid }, l))); sel.addEventListener('change', () => G.go('PRE-02', { wave: sel.value }));
    body.appendChild(sel);
    const w = G.db.get('picking_waves', wid); const rows = P.consolidated(wid);
    body.appendChild(kpis([{ label: 'Pedidos', value: G.db.where('picking_tasks', t => t.wave_id === wid && t.status !== 'CANCELLED').length }, { label: 'Productos distintos', value: rows.length }, { label: 'Kg estimados', value: G.fmt.kg(U.sum(rows, r => r.kg), 1) }, { label: 'Sin stock suficiente', value: rows.filter(r => r.stock < r.qty - r.picked).length, tone: rows.some(r => r.stock < r.qty - r.picked) ? 'bad' : 'ok' }]));
    body.appendChild(table({ id: 'pre02', rows, search: true, columns: [{ key: 'wh', label: 'Ubicación', value: r => r.wh ? r.wh.code : '—', render: r => r.wh ? badge(r.wh.code, r.wh.wh_type === 'FREEZER' ? 'info' : '') : badge('Sin stock', 'bad') }, { key: 'sku', label: 'SKU', mono: true }, { key: 'name', label: 'Producto' }, { key: 'cuts', label: 'Cortes y notas', value: r => [...r.cuts].join(' · ') }, { key: 'qty', label: 'Cantidad', align: 'r', render: r => unitTxt(r.qty, r.v) }, { key: 'kg', label: 'Kg estimados', align: 'r', render: r => r.kg ? G.fmt.num(r.kg, 3) : '—' }, { key: 'picked', label: 'Armado', align: 'r', render: r => h('span', null, G.fmt.num(r.picked, r.v.sale_mode === 'KG' ? 3 : 0), ' ', r.picked >= r.qty - 0.0005 ? badge('Completo', 'ok') : null) }, { key: 'lot', label: 'Lote FEFO', mono: true, value: r => r.lot ? r.lot.code : '—' }, { key: 'exp', label: 'Vence', value: r => r.lot ? r.lot.expiry_date : '', render: r => r.lot ? G.fmt.date(r.lot.expiry_date) : '—' }, { key: 'stock', label: 'Stock liberado', align: 'r', render: r => h('span', { style: r.stock < r.qty - r.picked ? 'color:var(--bad);font-weight:700' : '' }, G.fmt.num(r.stock, 3)) }, { key: 'n', label: 'Pedidos', align: 'r', render: r => h('span', { title: [...r.orders].join(', ') }, r.n) }], onRow: r => drawer(`${r.name} en ${w.number}`, bd => { bd.appendChild(dl([['Cantidad total', unitTxt(r.qty, r.v)], ['Kg estimados', G.fmt.kg(r.kg, 3)], ['Lote sugerido', r.lot ? `${r.lot.code} · vence ${G.fmt.date(r.lot.expiry_date)}` : 'Sin lote liberado'], ['Ubicación', r.wh ? r.wh.name : '—']])); bd.appendChild(card('Pedidos', h('div', { class: 'stack', style: 'gap:4px' }, G.db.where('picking_tasks', t => t.wave_id === wid && linesOf(t.id).some(l => l.variant_id === r.variant_id)).map(t => { const l = linesOf(t.id).find(l => l.variant_id === r.variant_id); return h('div', { class: 'between small' }, h('a', { href: '#', on: { click: e => { e.preventDefault(); G.go('PRE-03', { task: t.id }); } } }, `${t.order_number} · parada ${t.stop_seq || '—'}`), h('span', null, unitTxt(l.qty_required, r.v), l.cut_notes ? ' · ' + l.cut_notes : '')); })))); }, { code: 'PRE-02' }) }));
  }

  /* ---------- PRE-03 Lista por pedido ---------- */
  function pre03(el, params = {}) {
    const ts = todayTasks(t => !!t.wave_id);
    const tid = params.task || (ts.find(t => ['PENDING', 'PICKING'].includes(t.status)) || ts[0] || {}).id;
    const body = page(el, { code: 'PRE-03', title: 'Lista por pedido', sub: 'Ticket de preparación del pedido: líneas, cortes, notas, número de bolsas sugerido y parada. Se imprime y va con la bandeja del pedido.', actions: [{ label: 'Imprimir ticket', onClick: () => G.print() }, tid ? { label: 'Armar con escaneo', kind: 'primary', onClick: () => G.go('PRE-04', { task: tid }) } : null].filter(Boolean) });
    if (!tid) { body.appendChild(G.ui.empty('No hay pedidos en olas hoy.')); return; }
    body.appendChild(taskSelect(tid, t => !!t.wave_id, v => G.go('PRE-03', { task: v })));
    const t = G.db.get('picking_tasks', tid); const o = orderOf(t); const sp = P.suggestParcels(t); const w = G.db.get('picking_waves', t.wave_id) || {};
    const lines = linesOf(t.id);
    const tk = h('div', { class: 'ticket', style: 'max-width:420px' },
      `${G.brandFull(o.brand_id).toUpperCase()}\nTICKET DE PREPARACIÓN\n${'='.repeat(36)}\nPedido  ${o.number}   Ola ${w.number || '—'}\nCliente ${G.custName(o.customer_id)}\nEntrega ${G.fmt.date(o.delivery_date)} ${o.slot_from}–${o.slot_to}\nRuta    ${t.route_code || 'por asignar'}  Parada ${t.stop_seq || '—'}\n${'-'.repeat(36)}\n`,
      lines.map(l => { const v = G.variant(l.variant_id); return `[ ] ${v.sku}\n    ${v.name}\n    ${unitTxt(l.qty_required, v)}${l.est_weight_kg ? '  ~' + G.fmt.num(l.est_weight_kg, 3) + ' kg' : ''}${l.cut_notes ? '\n    Corte: ' + l.cut_notes : ''}\n`; }).join(''),
      `${'-'.repeat(36)}\nNotas: ${o.notes || '—'}\nBolsas sugeridas: ${sp.count} ${sp.type === 'BAG' ? 'bolsa(s)' : 'caja(s) térmica(s)'}\nEscanea cada paquete. No mezcles pedidos.\n`);
    const side = h('div', { class: 'stack', style: 'gap:14px' }, card('Pedido', [orderHead(t, o), h('div', { class: 'row', style: 'margin-top:8px;gap:8px' }, tBadge(t.status), G.ui.status(o.status))]), card('Líneas', table({ id: 'pre03-l', rows: lines, search: false, columns: [{ key: 'variant_id', label: 'Producto', value: l => G.variantName(l.variant_id) }, { key: 'qty_required', label: 'Pedido', align: 'r', render: l => unitTxt(l.qty_required, G.variant(l.variant_id)) }, { key: 'est_weight_kg', label: 'Kg est.', align: 'r', render: l => l.est_weight_kg ? G.fmt.num(l.est_weight_kg, 3) : '—' }, { key: 'qty_picked', label: 'Armado', align: 'r', render: l => unitTxt(l.qty_picked, G.variant(l.variant_id)) }, { key: 'weighed_kg', label: 'Kg real', align: 'r', render: l => l.weighed_kg ? G.fmt.num(l.weighed_kg, 3) : '—' }, { key: 'lot', label: 'Lote sugerido', mono: true, value: l => (P.suggestLot(t.id, l.variant_id) || { lot: {} }).lot.code || '—' }, { key: 'status', label: 'Estado', render: l => badge({ PENDING: 'Pendiente', PARTIAL: 'Parcial', DONE: 'Completa', SHORT_APPROVED: 'Faltante aprobado' }[l.status], l.status === 'DONE' ? 'ok' : l.status === 'PARTIAL' ? 'info' : l.status === 'SHORT_APPROVED' ? 'warn' : '') }] }), { flush: true }));
    body.appendChild(h('div', { class: 'grid side-r' }, side, h('div', { class: 'stack', style: 'gap:10px;align-items:start' }, tk, G.ui.qr(o.number, 110))));
  }

  /* ---------- PRE-04 Armado con escaneo (app del preparador) ---------- */
  const lastRes = {};
  function pre04(el, params = {}) {
    const avail = todayTasks(t => !!t.wave_id && ['PENDING', 'PICKING', 'PICKED'].includes(t.status) && (G.db.get('picking_waves', t.wave_id) || {}).status !== 'DRAFT');
    const tid = params.task || (avail.find(t => t.status === 'PICKING') || avail[0] || {}).id;
    const body = page(el, { code: 'PRE-04', title: 'Armado con escaneo', sub: 'App del preparador: escanea cada paquete contra el pedido. Verde si corresponde; rojo con sonido y motivo si es de otro pedido, otra marca, lote no liberado, fuera de FEFO, exceso o etiqueta repetida.' });
    if (!tid) { body.appendChild(notice('No hay pedidos por armar en olas liberadas. Libera una ola en PRE-01.', 'info')); return; }
    const t = G.db.get('picking_tasks', tid); const o = orderOf(t); const lines = linesOf(t.id);
    const res = lastRes[tid];
    const phone = h('div', { class: 'phone' }, h('div', { class: 'phone-screen' },
      h('div', { class: 'pre-bar' }, h('b', null, 'Aycha · Preparación'), h('span', null, G.userShort(me()))),
      h('div', { class: 'pre-body' },
        taskSelect(tid, x => !!x.wave_id && ['PENDING', 'PICKING', 'PICKED'].includes(x.status) && (G.db.get('picking_waves', x.wave_id) || {}).status !== 'DRAFT', v => G.go('PRE-04', { task: v })),
        h('div', { class: 'pre-tile' }, h('div', { class: 'between' }, h('b', { style: 'font-size:1.1rem' }, o.number), tBadge(t.status)), h('div', { class: 'small muted' }, `${G.custName(o.customer_id)} · ${G.brandName(o.brand_id)} · ${t.route_code || ''} parada ${t.stop_seq || '—'}`), o.notes && o.notes !== 'Sin indicaciones' ? h('div', { class: 'small' }, h('b', null, 'Nota: '), o.notes) : null, G.ui.progress(progressOf(t), progressOf(t) >= 100 ? 'ok' : '')),
        h('div', { class: 'pre-result ' + (res ? (res.ok ? 'ok' : 'bad') : 'idle'), attrs: { role: 'status', 'aria-live': 'polite' } }, h('span', { class: 'big' }, res ? (res.ok ? 'CORRECTO' : RESULTS[res.result] || 'BLOQUEADO') : 'Escanea un paquete'), res ? h('span', { class: 'why' }, res.message) : h('span', { class: 'why' }, 'Etiqueta del lote, SKU, código de barras o etiqueta de balanza (prefijo 2).')),
        (() => {
          const code = h('input', { class: 'input', placeholder: 'Código', attrs: { id: 'pre-scan-code', 'aria-label': 'Código escaneado', autocomplete: 'off' } });
          const lot = h('input', { class: 'input', placeholder: 'Lote (si el código no lo trae)', attrs: { id: 'pre-scan-lot', 'aria-label': 'Lote' } });
          const kg = h('input', { class: 'input', type: 'number', placeholder: 'Peso kg', attrs: { id: 'pre-scan-kg', step: '0.001', 'aria-label': 'Peso en kg' } });
          const go = () => { if (!code.value.trim()) return; try { const r = P.scan(tid, { code: code.value, lot_code: lot.value || null, weight_kg: kg.value }); lastRes[tid] = r; beep(r.ok); if (r.ok && r.over) toast(r.message, 'warn'); if (r.finished) toast(`Pedido ${o.number} armado: pasa a bolsas y etiquetas`, 'ok'); } catch (e) { lastRes[tid] = { ok: false, result: 'ERROR', message: e.message }; beep(false); } G.refresh(); };
          code.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
          return h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'pre-scan' }, code, btn('Leer', go, { kind: 'primary' })), h('div', { class: 'pre-scan' }, lot, kg));
        })(),
        h('div', { class: 'pre-tile' }, lines.map(l => { const v = G.variant(l.variant_id); const done = l.status === 'DONE' || l.status === 'SHORT_APPROVED'; return h('div', { class: 'pre-line' + (done ? ' done' : '') }, h('div', { style: 'min-width:0' }, h('b', null, v.name), h('div', { class: 'small muted' }, `${v.sku}${l.cut_notes ? ' · ' + l.cut_notes : ''}`)), h('div', { style: 'text-align:right' }, h('b', { class: 'num' }, v.sale_mode === 'KG' ? `${G.fmt.num(l.weighed_kg || 0, 3)} / ${G.fmt.num(l.qty_required, 3)} kg` : `${G.fmt.num(l.qty_picked, 0)} / ${G.fmt.num(l.qty_required, 0)}`), isWeighted(v) && v.sale_mode !== 'KG' ? h('div', { class: 'small muted' }, `${G.fmt.num(l.weighed_kg || 0, 3)} kg`) : null, l.status === 'SHORT_APPROVED' ? badge('Faltante aprobado', 'warn') : l.short_reason ? badge('Faltante pedido', 'warn') : null)); })),
        h('div', { class: 'row', style: 'flex-wrap:wrap' },
          t.status === 'PICKED' ? btn('Bolsas y etiquetas', () => G.go('PRE-06', { task: tid }), { kind: 'primary' }) : null,
          ['PENDING', 'PICKING'].includes(t.status) ? btn('Pedir faltante', () => shortForm(t), {}) : null,
          btn('Ticket', () => G.go('PRE-03', { task: tid }), { kind: 'ghost' })),
        (() => { const ls = scansOf(tid).filter(s => s.scan_type === 'PICK').sort(U.by('scanned_at', -1)).slice(0, 6); return card('Últimas lecturas', ls.length ? h('div', { class: 'stack', style: 'gap:4px' }, ls.map(s => h('div', { class: 'between small', style: 'gap:6px' }, h('span', { class: 'mono', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0' }, s.barcode), badge(RESULTS[s.result], s.result === 'OK' ? 'ok' : 'bad')))) : G.ui.empty('Sin lecturas aún.')); })())));
    // panel de demostración con códigos de prueba
    const chip = (label, code, tone, extra = {}) => h('button', { class: 'pre-chip ' + (tone || ''), title: extra.title || label, on: { click: () => { document.getElementById('pre-scan-code').value = code; document.getElementById('pre-scan-lot').value = extra.lot || ''; document.getElementById('pre-scan-kg').value = extra.kg ?? ''; document.getElementById('pre-scan-code').focus(); } } }, label);
    const good = [], badC = [];
    for (const l of lines) {
      const v = G.variant(l.variant_id); const s = P.suggestLot(t.id, v.id);
      const unitKg = v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? R((l.est_weight_kg / l.qty_required) * 0.97, 3) : v.sale_mode === 'KG' ? R(l.qty_required - (l.weighed_kg || 0), 3) : null;
      if (s) good.push(chip(`${s.lot.code}${unitKg ? ' · ' + G.fmt.num(unitKg, 3) + ' kg' : ''}`, s.lot.code, 'ok', { kg: unitKg ?? '', title: `${v.name} del lote FEFO` }));
      if (s && v.scale_plu && unitKg) good.push(chip(`Balanza ${P.scaleLabel(v.id, unitKg)}`, P.scaleLabel(v.id, unitKg), 'ok', { lot: s.lot.code, title: `Etiqueta de balanza de ${v.name}` }));
      const later = G.db.where('lots', x => x.variant_id === v.id && x.qc_status === 'RELEASED' && s && x.expiry_date > s.lot.expiry_date && G.inv.qty(v.id, null) > 0).sort(U.by('expiry_date', -1))[0];
      if (later) badC.push(chip(`${later.code} (vence después)`, later.code, 'bad', { kg: unitKg ?? '', title: 'Bloquea por FEFO' }));
    }
    const other = G.db.where('picking_tasks', x => x.wave_id === t.wave_id && x.id !== t.id && x.status !== 'CANCELLED').map(x => linesOf(x.id).find(l => !lines.some(m => m.variant_id === l.variant_id))).find(Boolean);
    if (other) { const v = G.variant(other.variant_id); badC.push(chip(`${v.sku} (de otro pedido)`, v.sku, 'bad', { kg: v.nominal_weight_kg || 1, title: 'Pedido cruzado' })); }
    const ob = G.db.find('product_variants', v => v.brand_id !== o.brand_id && v.sellable); if (ob) badC.push(chip(`${ob.sku} (otra marca)`, ob.sku, 'bad', { kg: 1 }));
    badC.push(chip('L261010-Q01 (cuarentena)', 'L261010-Q01', 'bad', { kg: 0.9 }));
    badC.push(chip('L261006-C02 (bloqueado)', 'L261006-C02', 'bad', { kg: 1 }));
    badC.push(chip('Código desconocido', '9999999', 'bad'));
    const scaleUsed = G.db.find('picking_scans', s => /^2\d{12}$/.test(s.barcode) && s.result === 'OK'); if (scaleUsed) badC.push(chip('Etiqueta ya leída', scaleUsed.barcode, 'bad', { lot: (lotOf(scaleUsed.lot_id) || {}).code }));
    const side = h('div', { class: 'stack', style: 'gap:14px' },
      card('Códigos de prueba (toca uno y luego «Leer»)', [h('div', { class: 'small muted', style: 'margin-bottom:6px' }, 'Paquetes correctos (lote FEFO del pedido):'), h('div', { class: 'pre-chips' }, good.length ? good : h('span', { class: 'small muted' }, 'Pedido completo.')), h('div', { class: 'small muted', style: 'margin:10px 0 6px' }, 'Paquetes que el sistema bloquea:'), h('div', { class: 'pre-chips' }, badC)]),
      card('Pedido', orderHead(t, o)),
      card('Reglas que aplica el escaneo', h('div', { class: 'stack small', style: 'gap:4px' }, h('div', null, h('b', null, 'RN-PRE-03 '), 'producto de otro pedido de la ola: pedido cruzado; si no está en la ola: producto equivocado.'), h('div', null, h('b', null, 'RN-PRE-04 '), 'solo lotes liberados; sin lote no se acepta.'), h('div', null, h('b', null, 'RN-PRE-05 '), 'FEFO: otro lote liberado que vence antes bloquea; la supervisora autoriza en PRE-12.'), h('div', null, h('b', null, 'RN-PRE-06 '), 'exceso, etiqueta de balanza repetida y código desconocido.'), h('div', null, h('b', null, 'RN-PRE-10 '), 'por kg o peso variable: peso en cada lectura; al completar la línea PED recibe el peso real.'))),
      can04() ? h('div', null, btn('Armar todo con los códigos correctos (demostración)', () => { const r = tryDo(() => P.autoPick(tid)); if (r) { lastRes[tid] = r[r.length - 1]; G.refresh(); } }, { kind: 'ghost', sm: true })) : null);
    body.appendChild(h('div', { class: 'pre-sim' }, phone, side));
  }
  const can04 = () => G.can('pre.task.pick');
  function shortForm(t) {
    const ls = linesOf(t.id).filter(l => !['DONE', 'SHORT_APPROVED'].includes(l.status));
    modal('Pedir faltante', bd => bd.appendChild(form({ id: 'pre-short', submitLabel: 'Enviar a la supervisora', values: { line: ls[0] && ls[0].id }, fields: [{ key: 'line', label: 'Línea', type: 'select', required: true, options: ls.map(l => [l.id, `${G.variantName(l.variant_id)} · ${G.fmt.num(l.qty_picked, 3)} de ${G.fmt.num(l.qty_required, 3)}`]) }, { key: 'reason', label: 'Motivo', type: 'select', required: true, options: [['Sin stock en la cámara', 'Sin stock en la cámara'], ['Lote bloqueado o vencido', 'Lote bloqueado o vencido'], ['Peso insuficiente del producto disponible', 'Peso insuficiente del producto disponible'], ['Producto dañado', 'Producto dañado']] }], onSubmit: v => { try { P.requestShort(v.line, v.reason); G.ui.closeAll(); toast('Faltante enviado: la supervisora lo aprueba en PRE-09', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })));
  }

  /* ---------- PRE-05 Pesado ---------- */
  function pre05(el) {
    const body = page(el, { code: 'PRE-05', title: 'Pesado', sub: 'Peso de la etiqueta de balanza o digitado por línea; diferencia frente al estimado y aviso cuando supera la tolerancia (PED-07). El peso real define el precio final.' });
    const ts = todayTasks(t => !!t.wave_id);
    const rows = [];
    for (const t of ts) { const o = orderOf(t); for (const l of linesOf(t.id)) { const v = G.variant(l.variant_id); if (!isWeighted(v)) continue; const ol = o.lines.find(x => x.id === l.order_line_id) || {}; const diff = l.weighed_kg != null && l.est_weight_kg ? R((l.weighed_kg - l.est_weight_kg) / l.est_weight_kg * 100, 1) : null; const tol = ol.tolerance_pct ?? v.weight_tolerance_pct ?? 10; rows.push({ id: l.id, t, o, l, v, ol, number: o.number, name: v.name, est: l.est_weight_kg, real: l.weighed_kg, diff, tol, over: diff !== null && Math.abs(diff) > tol + 1e-9, brand_id: o.brand_id, establishment_id: o.establishment_id, source: ol.weight_source }); } }
    const k6 = G.kpi('KPI-PRE-06', { from: G.TODAY, to: G.TODAY }) || {};
    const notice_ = G.scope.filter(G.db.where('sales_orders', o => o.weight_diff_status === 'NOTICE_REQUIRED' && ['IN_PREPARATION', 'WEIGHED'].includes(o.status)));
    body.appendChild(kpis([{ label: 'Líneas por peso hoy', value: rows.length, sub: `${rows.filter(r => r.real != null).length} pesadas` }, { label: 'Fuera de tolerancia', value: rows.filter(r => r.over).length, tone: rows.some(r => r.over) ? 'warn' : 'ok' }, { label: 'Pedidos con aviso pendiente', value: notice_.length, tone: notice_.length ? 'bad' : 'ok', sub: 'RN-PED-05 bloquea LISTO' }, { label: 'Desviación de peso hoy', value: G.fmt.pct(k6.value, 2), sub: 'KPI-PRE-06' }]));
    if (notice_.length) body.appendChild(card('Avisar al cliente antes de pasar a LISTO', h('div', { class: 'stack', style: 'gap:6px' }, notice_.map(o => h('div', { class: 'between', style: 'gap:8px;flex-wrap:wrap' }, h('span', null, h('b', { class: 'mono' }, o.number), ` · ${G.custName(o.customer_id)} · estimado ${G.fmt.money(o.estimated_total)} → final ${G.fmt.money(o.final_total)}`), btn('Avisar por WhatsApp', () => tryDo(() => P.notifyWeight(o.id), 'Aviso de diferencia enviado (plantilla de utilidad)'), { sm: true, kind: 'primary' }))))));
    body.appendChild(table({ id: 'pre05', rows, sort: 'number', columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'name', label: 'Producto' }, { key: 'units', label: 'Unidades', align: 'r', value: r => r.v.sale_mode === 'KG' ? '—' : `${G.fmt.num(r.l.qty_picked, 0)}/${G.fmt.num(r.l.qty_required, 0)}` }, { key: 'est', label: 'Estimado', align: 'r', render: r => G.fmt.kg(r.est, 3) }, { key: 'real', label: 'Real', align: 'r', render: r => r.real != null ? h('b', null, G.fmt.kg(r.real, 3)) : '—' }, { key: 'diff', label: 'Diferencia', align: 'r', render: r => r.diff === null ? '—' : badge(`${r.diff > 0 ? '+' : ''}${G.fmt.num(r.diff, 1)} %`, r.over ? 'bad' : 'ok') }, { key: 'tol', label: 'Tolerancia', align: 'r', render: r => `±${r.tol} %` }, { key: 'source', label: 'Origen', value: r => r.source === 'SCALE' ? 'Balanza' : r.source === 'MANUAL' ? 'Digitado' : '—' }, { key: 'amt', label: 'Importe final', align: 'r', render: r => r.ol.final_amount != null ? G.fmt.money(r.ol.final_amount) : '—' }], filters: [{ key: 'over', label: 'Tolerancia', options: [['true', 'Fuera'], ['false', 'Dentro']] }], actions: r => r.l.status === 'DONE' && G.can('pre.task.pick') ? [btn('Corregir peso', () => modal(`Corregir peso · ${r.number}`, bd => bd.appendChild(form({ id: 'pre05-w', values: { kg: r.real }, submitLabel: 'Registrar', fields: [{ key: 'kg', label: 'Peso real (kg)', type: 'number', required: true, min: 0.001 }, { key: 'src', label: 'Origen', type: 'select', options: [['SCALE', 'Etiqueta de balanza'], ['MANUAL', 'Digitado']] }], onSubmit: v => { try { const wr = G.orders.weigh(r.o, r.ol.id, v.kg, v.src || 'MANUAL'); r.l.weighed_kg = R(v.kg, 3); G.db.touch(); G.ui.closeAll(); toast(wr.over ? `Diferencia ${wr.diff_pct} %: supera la tolerancia; avisa al cliente` : `Peso registrado (${wr.diff_pct} %)`, wr.over ? 'warn' : 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))), { sm: true, kind: 'ghost' })] : [], onRow: r => G.go('PRE-04', { task: r.t.id }) }));
  }

  /* ---------- PRE-06 Bolsas y etiquetas ---------- */
  function labelCard(pc) {
    const o = G.db.get('sales_orders', pc.order_id);
    return h('div', { class: 'label-card' }, h('div', { style: 'min-width:0;display:grid;gap:3px' }, h('div', { style: 'font-size:11px' }, G.brandFull(o.brand_id)), h('div', { class: 'num' }, `${pc.parcel_no}/${pc.parcel_count}`), h('div', { class: 'cap' }, P.caption(pc)), h('div', null, G.custName(o.customer_id)), h('div', { style: 'font-family:monospace;font-size:11px' }, pc.label_code), pc.status === 'LOADED' ? h('div', { style: 'font-size:11px;font-weight:700' }, 'CARGADA ' + (pc.loaded_at || '').slice(11, 16)) : null), G.ui.qr(pc.label_code, 84));
  }
  function pre06(el, params = {}) {
    const ts = todayTasks(t => ['PICKED', 'PACKED', 'VERIFIED', 'LOADED'].includes(t.status));
    const tid = params.task || (ts.find(t => t.status === 'PICKED') || ts.find(t => t.status === 'PACKED') || ts[0] || {}).id;
    const body = page(el, { code: 'PRE-06', title: 'Bolsas y etiquetas', sub: 'Número de bolsas o cajas térmicas e impresión de etiquetas «Pedido · bolsa n de N · ruta · parada» con un código único que se escanea al cargar (RN-PRE-07). Usa la bolsa de despacho numerada EM-BOL-NUM.', actions: [{ label: 'Imprimir etiquetas', onClick: () => G.print() }] });
    body.appendChild(kpis([{ label: 'Por embolsar', value: ts.filter(t => t.status === 'PICKED').length, tone: 'warn' }, { label: 'Embolsados', value: ts.filter(t => t.status === 'PACKED').length }, { label: 'Bolsas hoy', value: G.db.where('shipment_parcels', p => ts.some(t => t.id === p.task_id)).length }, { label: 'Stock de bolsas numeradas', value: G.fmt.num(G.inv.qty('va-EM-BOL-NUM'), 0), sub: 'EM-BOL-NUM' }]));
    if (!tid) { body.appendChild(G.ui.empty('Ningún pedido armado hoy.')); return; }
    body.appendChild(taskSelect(tid, t => ['PICKED', 'PACKED', 'VERIFIED', 'LOADED'].includes(t.status), v => G.go('PRE-06', { task: v })));
    const t = G.db.get('picking_tasks', tid); const o = orderOf(t); const sp = P.suggestParcels(t);
    const parcels = G.db.where('shipment_parcels', p => p.task_id === t.id).sort(U.by('parcel_no'));
    const left = card('Embolsar', ['PICKED', 'PACKED'].includes(t.status) ? form({ id: 'pre06', values: { count: t.parcel_count || sp.count, type: t.parcel_type || sp.type }, submitLabel: parcels.length ? 'Regenerar etiquetas' : 'Generar etiquetas', fields: [{ key: 'count', label: `Número de bolsas (sugerido ${sp.count})`, type: 'number', min: 1, max: 20, required: true }, { key: 'type', label: `Tipo (D-PRE-03: sugerido ${optName(PARCEL_TYPES, sp.type).toLowerCase()})`, type: 'select', options: PARCEL_TYPES }], onSubmit: v => { try { const ps = P.pack(t.id, { count: v.count, type: v.type }); toast(`${ps.length} etiqueta(s) generadas: ${ps[0].caption}`, 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }) : [notice(`La tarea está ${(TASK_ST[t.status] || [t.status])[0].toLowerCase()}: las etiquetas ya no cambian.`, 'info')]);
    const right = h('div', { class: 'stack', style: 'gap:12px' }, card('Pedido', [orderHead(t, o), h('div', { class: 'row', style: 'margin-top:8px' }, tBadge(t.status), t.status === 'PACKED' ? btn('Verificar', () => G.go('PRE-07', { task: t.id }), { sm: true, kind: 'primary' }) : null)]));
    body.appendChild(h('div', { class: 'grid c2' }, left, right));
    body.appendChild(card(`Etiquetas (${parcels.length})`, parcels.length ? h('div', { class: 'pre-labels' }, parcels.map(labelCard)) : G.ui.empty('Genera las etiquetas para imprimirlas.')));
  }

  /* ---------- PRE-07 Verificación ---------- */
  const photoState = {};
  function pre07(el, params = {}) {
    const ts = todayTasks(t => ['PACKED', 'VERIFIED'].includes(t.status));
    const tid = params.task || (ts.find(t => t.status === 'PACKED') || ts[0] || {}).id;
    const body = page(el, { code: 'PRE-07', title: 'Verificación', sub: 'Otra persona revisa el pedido armado contra la lista, cuenta las bolsas y toma la foto obligatoria; marca VERIFICADO y el pedido pasa a LISTO (RN-PRE-09, RN-PRE-13).' });
    body.appendChild(kpis([{ label: 'Por verificar', value: ts.filter(t => t.status === 'PACKED').length, tone: ts.some(t => t.status === 'PACKED') ? 'warn' : 'ok' }, { label: 'Verificados hoy', value: todayTasks(t => ['VERIFIED', 'LOADED'].includes(t.status)).length, tone: 'ok' }, { label: 'Verifica otra persona', value: G.param('pre_verify_by_other') !== false ? 'Sí' : 'No', sub: 'pre_verify_by_other' }, { label: 'Listos a tiempo', value: G.fmt.pct((G.kpi('KPI-PRE-07', { from: G.TODAY, to: G.TODAY }) || {}).value), sub: 'KPI-PRE-07 hoy' }]));
    if (!tid) { body.appendChild(G.ui.empty('No hay pedidos embolsados por verificar.')); return; }
    body.appendChild(taskSelect(tid, t => ['PACKED', 'VERIFIED'].includes(t.status), v => G.go('PRE-07', { task: v })));
    const t = G.db.get('picking_tasks', tid); const o = orderOf(t); const lines = linesOf(t.id);
    const checks = h('div', { class: 'stack', style: 'gap:4px' }, lines.map(l => { const v = G.variant(l.variant_id); return h('label', { class: 'check between', style: 'padding:6px 0;border-bottom:1px solid var(--line);gap:8px' }, h('span', { class: 'row', style: 'gap:8px' }, h('input', { type: 'checkbox', checked: t.status === 'VERIFIED' }), `${v.name}${l.cut_notes ? ' · ' + l.cut_notes : ''}`), h('b', null, v.sale_mode === 'KG' ? G.fmt.kg(l.weighed_kg, 3) : `${G.fmt.num(l.qty_picked, 0)} u${l.weighed_kg ? ' · ' + G.fmt.kg(l.weighed_kg, 3) : ''}`)); }));
    const ph = photoState[tid] || t.photo_file_id;
    const photo = h('div', { class: 'pre-photo' + (ph ? ' taken' : '') }, ph ? `Foto tomada: ${ph}` : 'Sin foto del pedido armado');
    const cnt = h('input', { class: 'input', type: 'number', value: t.parcel_count || '', attrs: { 'aria-label': 'Bolsas contadas', min: 1 } });
    const left = card(`Revisar ${o.number}`, [orderHead(t, o), h('div', { style: 'margin-top:10px' }, checks), h('div', { class: 'field', style: 'margin-top:10px' }, h('label', null, `Bolsas contadas (etiquetas: ${t.parcel_count || 0})`), cnt)]);
    const right = card('Foto y verificación', [photo, h('div', { class: 'row', style: 'margin-top:10px;flex-wrap:wrap' },
      t.status === 'PACKED' ? btn(ph ? 'Tomar otra foto' : 'Tomar foto', () => { photoState[tid] = `foto-${o.number}-${String(Date.now()).slice(-5)}.jpg`; G.refresh(); }, {}) : null,
      t.status === 'PACKED' ? btn('Marcar verificado', () => tryDo(() => P.verify(tid, { photo: photoState[tid], parcel_count: cnt.value === '' ? null : Number(cnt.value) }), `Pedido ${o.number} verificado: pasa a LISTO`), { kind: 'primary' }) : tBadge(t.status),
      btn('Registrar error de armado', () => errorForm({ order_id: o.id, detected_at_stage: 'VERIFICATION', responsible: t.preparer_user_id }), { kind: 'ghost' })),
      dl([['Armó', G.userName(t.preparer_user_id)], ['Verifica', t.verified_by ? G.userName(t.verified_by) : G.ctx.userName() + ' (tú)'], ['Estado del pedido', G.ui.status(o.status)], ['Diferencia de peso', o.weight_diff_status === 'NOTICE_REQUIRED' ? badge('Aviso requerido (RN-PED-05)', 'bad') : G.ui.statusLabel(o.weight_diff_status)]]),
      t.preparer_user_id === me() && t.status === 'PACKED' ? notice(`RN-PRE-13: tú armaste este pedido; lo verifica otra persona.`, 'warn') : null]);
    body.appendChild(h('div', { class: 'grid c2' }, left, right));
    const parcels = G.db.where('shipment_parcels', p => p.task_id === t.id).sort(U.by('parcel_no'));
    if (parcels.length) body.appendChild(card('Etiquetas del pedido', h('div', { class: 'pre-labels' }, parcels.map(labelCard))));
  }

  /* ---------- PRE-08 Carga del vehículo ---------- */
  const loadRes = {};
  function pre08(el, params = {}) {
    const ps = G.db.where('shipment_parcels', p => p.route_key && String(p.route_key).startsWith(G.TODAY) || (p.route_key || '').startsWith('DEL:'));
    const keys = [...new Set(ps.map(p => p.route_key))].filter(k => G.scope.ok({ establishment_id: (G.db.get('picking_tasks', ps.find(p => p.route_key === k).task_id) || {}).establishment_id }));
    const rk = params.route && keys.includes(params.route) ? params.route : (keys.find(k => ps.some(p => p.route_key === k && p.status !== 'LOADED')) || keys[0]);
    const body = page(el, { code: 'PRE-08', title: 'Carga del vehículo', sub: 'Escaneo de cada bolsa al subirla: ruta correcta y orden inverso de paradas (la última parada va al fondo). Al cargar todas sus bolsas, el pedido queda CARGADO y DEL puede salir (RN-PRE-08).' });
    if (!rk) { body.appendChild(G.ui.empty('No hay bolsas etiquetadas para cargar hoy.')); return; }
    const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Ruta' } }, keys.map(k => { const L = P.routeLoad(k); return h('option', { value: k, selected: k === rk }, `${routeLabel(k)} · ${L.loaded}/${L.total} bolsas`); })); sel.addEventListener('change', () => G.go('PRE-08', { route: sel.value }));
    const L = P.routeLoad(rk);
    const mine = ps.filter(p => p.route_key === rk).sort((a, b) => b.stop_seq - a.stop_seq || a.parcel_no - b.parcel_no);
    const next = mine.find(p => p.status !== 'LOADED' && ['VERIFIED', 'LOADED'].includes((G.db.get('picking_tasks', p.task_id) || {}).status));
    body.appendChild(kpis([{ label: 'Bolsas cargadas', value: `${L.loaded} de ${L.total}`, tone: L.loaded === L.total ? 'ok' : 'warn' }, { label: 'Pedidos en la ruta', value: new Set(mine.map(p => p.order_id)).size }, { label: 'Siguiente a cargar', value: next ? `Parada ${next.stop_seq}` : '—', sub: next ? next.label_code : 'Todo cargado o falta verificar' }, { label: 'Orden estricto', value: G.param('pre_load_order_strict') !== false ? 'Sí' : 'No', sub: 'pre_load_order_strict' }]));
    const r = loadRes[rk];
    const inp = h('input', { class: 'input', placeholder: 'Escanea la etiqueta de la bolsa (BOL-…)', attrs: { id: 'pre-load-code', 'aria-label': 'Etiqueta de la bolsa', autocomplete: 'off' } });
    const go = () => { if (!inp.value.trim()) return; try { const x = P.loadScan(rk, inp.value); loadRes[rk] = x; beep(x.ok); if (x.taskLoaded) toast(`Pedido ${x.parcel ? G.db.get('sales_orders', x.parcel.order_id).number : ''} cargado completo`, 'ok'); } catch (e) { loadRes[rk] = { ok: false, result: 'ERROR', message: e.message }; beep(false); } G.refresh(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    const chips = [];
    if (next) chips.push(h('button', { class: 'pre-chip ok', on: { click: () => { inp.value = next.label_code; } } }, `${next.label_code} (siguiente)`));
    const early = mine.find(p => p.status !== 'LOADED' && next && p.stop_seq < next.stop_seq); if (early) chips.push(h('button', { class: 'pre-chip bad', on: { click: () => { inp.value = early.label_code; } } }, `${early.label_code} (parada ${early.stop_seq}, antes de tiempo)`));
    const otherR = ps.find(p => p.route_key !== rk && p.status !== 'LOADED'); if (otherR) chips.push(h('button', { class: 'pre-chip bad', on: { click: () => { inp.value = otherR.label_code; } } }, `${otherR.label_code} (otra ruta)`));
    body.appendChild(h('div', { class: 'grid c2' },
      card('Escanear al subir', [sel, h('div', { style: 'height:8px' }), h('div', { class: 'pre-scan' }, inp, btn('Cargar', go, { kind: 'primary' })), h('div', { class: 'pre-result ' + (r ? (r.ok ? 'ok' : 'bad') : 'idle'), style: 'margin-top:10px' }, h('span', { class: 'big' }, r ? (r.ok ? 'CARGADA' : RESULTS[r.result] || 'BLOQUEADA') : 'Esperando lectura'), r ? h('span', { class: 'why' }, r.message) : null), h('div', { class: 'small muted', style: 'margin:10px 0 6px' }, 'Códigos de prueba:'), h('div', { class: 'pre-chips' }, chips)]),
      card('Orden de carga (última parada primero)', h('div', { class: 'stack', style: 'gap:4px' }, mine.map(p => { const t = G.db.get('picking_tasks', p.task_id); return h('div', { class: 'between small', style: 'gap:8px;padding:5px 0;border-bottom:1px solid var(--line)' }, h('span', { style: 'min-width:0' }, h('b', null, `Parada ${p.stop_seq}`), ` · ${G.db.get('sales_orders', p.order_id).number} · ${p.parcel_no}/${p.parcel_count}`), h('span', { class: 'row', style: 'gap:6px' }, ['VERIFIED', 'LOADED'].includes(t.status) ? null : badge('Sin verificar', 'warn'), badge(p.status === 'LOADED' ? 'Cargada' : 'Por cargar', p.status === 'LOADED' ? 'ok' : ''))); })))));
    const log = G.db.where('picking_scans', s => s.scan_type === 'LOAD' && s.route_key === rk).sort(U.by('scanned_at', -1));
    if (log.length) body.appendChild(card('Lecturas de carga', table({ id: 'pre08-log', rows: log, search: false, pageSize: 10, columns: [{ key: 'scanned_at', label: 'Hora', render: s => G.fmt.datetime(s.scanned_at) }, { key: 'barcode', label: 'Etiqueta', mono: true }, { key: 'result', label: 'Resultado', render: s => badge(RESULTS[s.result], s.result === 'OK' ? 'ok' : 'bad') }, { key: 'message', label: 'Detalle' }, { key: 'user_id', label: 'Usuario', value: s => G.userShort(s.user_id) }] }), { flush: true }));
  }

  /* ---------- PRE-09 Faltantes ---------- */
  function pre09(el) {
    const body = page(el, { code: 'PRE-09', title: 'Faltantes', sub: 'Líneas sin stock o incompletas: motivo y aprobación de la supervisora (nunca quien prepara); la vendedora recibe el aviso para hablar con el cliente (RN-PRE-12).' });
    const rows = [];
    for (const l of G.db.where('picking_task_lines', l => l.short_reason || (l.status !== 'DONE' && l.status !== 'SHORT_APPROVED'))) { const t = G.db.get('picking_tasks', l.task_id); if (!t || t.status === 'CANCELLED' || t.delivery_date < G.TODAY || !t.wave_id && !l.short_reason) continue; const o = orderOf(t); if (!G.scope.ok(o)) continue; rows.push({ id: l.id, l, t, o, v: G.variant(l.variant_id), number: o.number, state: l.status === 'SHORT_APPROVED' ? 'APPROVED' : l.short_reason ? 'REQUESTED' : 'INCOMPLETE' }); }
    const stockShort = G.scope.filter(G.db.where('sales_orders', o => o.stock_short && o.stock_short.length && ['CONFIRMED', 'IN_PREPARATION'].includes(o.status)));
    body.appendChild(kpis([{ label: 'Por aprobar', value: rows.filter(r => r.state === 'REQUESTED').length, tone: 'warn' }, { label: 'Aprobados hoy', value: rows.filter(r => r.state === 'APPROVED').length }, { label: 'Líneas incompletas en armado', value: rows.filter(r => r.state === 'INCOMPLETE').length }, { label: 'Pedidos sin stock reservado', value: stockShort.length, tone: stockShort.length ? 'bad' : 'ok', sub: 'Desde ALM (reserva FEFO)' }]));
    body.appendChild(table({ id: 'pre09', rows, sort: 'state', columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'cust', label: 'Cliente', value: r => G.custName(r.o.customer_id) }, { key: 'prod', label: 'Producto', value: r => r.v.name }, { key: 'req', label: 'Pedido', align: 'r', render: r => unitTxt(r.l.qty_required, r.v) }, { key: 'pick', label: 'Armado', align: 'r', render: r => unitTxt(r.v.sale_mode === 'KG' ? r.l.weighed_kg || 0 : r.l.qty_picked, r.v) }, { key: 'short_reason', label: 'Motivo', value: r => r.l.short_reason || '—' }, { key: 'who', label: 'Preparó', value: r => G.userShort(r.t.preparer_user_id) }, { key: 'state', label: 'Estado', render: r => badge({ REQUESTED: 'Por aprobar', APPROVED: 'Aprobado', INCOMPLETE: 'En armado' }[r.state], r.state === 'REQUESTED' ? 'warn' : r.state === 'APPROVED' ? 'ok' : 'info') }], filters: [{ key: 'state', label: 'Estado', options: [['REQUESTED', 'Por aprobar'], ['APPROVED', 'Aprobado'], ['INCOMPLETE', 'En armado']] }], actions: r => [r.state === 'REQUESTED' ? btn('Aprobar', () => tryDo(() => P.approveShort(r.l.id), 'Faltante aprobado: se avisó a la vendedora'), { sm: true, kind: 'primary' }) : null, r.state === 'INCOMPLETE' ? btn('Pedir faltante', () => shortForm(r.t), { sm: true }) : null].filter(Boolean), onRow: r => G.go('PRE-04', { task: r.t.id }), empty: 'Sin faltantes.' }));
    if (stockShort.length) body.appendChild(card('Pedidos confirmados sin stock reservado', h('div', { class: 'stack', style: 'gap:4px' }, stockShort.map(o => h('div', { class: 'between small' }, h('span', null, `${o.number} · ${G.custName(o.customer_id)}`), h('span', null, o.stock_short.map(s => `${G.variantName(s.variant_id)}: ${G.fmt.num(s.qty, 3)}`).join(' · ')))))));
  }

  /* ---------- PRE-10 Errores de armado ---------- */
  function errorForm(def = {}) {
    drawer('Registrar error de armado', (bd, close) => bd.appendChild(form({
      id: 'pre10', values: { order_id: def.order_id || '', detected_at_stage: def.detected_at_stage || 'DELIVERY', error_type: 'WRONG_PRODUCT', responsible_employee_id: def.responsible ? (G.db.get('users', def.responsible) || {}).employee_id : '', cost_amount: 0 },
      fields: [{ key: 'order_id', label: 'Pedido', type: 'select', required: true, options: G.db.where('picking_tasks', t => t.delivery_date >= G.date.add(G.TODAY, -10) && t.status !== 'CANCELLED').sort(U.by('order_number', -1)).map(t => [t.order_id, `${t.order_number} · ${G.custName(orderOf(t).customer_id)}`]) }, { key: 'error_type', label: 'Tipo', type: 'select', required: true, options: ERR_TYPES }, { key: 'detected_at_stage', label: 'Etapa en que se detectó', type: 'select', required: true, options: STAGES }, { key: 'responsible_employee_id', label: 'Responsable (obligatorio si llegó al cliente)', type: 'select', options: G.db.where('users', u => ['PREPARADOR', 'ALMACENERO', 'REPARTIDOR'].includes(u.role)).map(u => [u.employee_id, `${u.name} · ${G.roleName(u.role)}`]) }, { key: 'cost_amount', label: 'Costo (S/)', type: 'money', min: 0 }, { key: 'description', label: 'Qué pasó', type: 'textarea', required: true }, { key: 'corrective_action', label: 'Acción correctiva', type: 'textarea' }],
      onCancel: close,
      onSubmit: v => { try { const e = P.recordError(v); close(); toast(`Error registrado en ${G.db.get('sales_orders', e.order_id).number}`, 'ok'); G.refresh(); return true; } catch (e) { return e.message; } },
    })), { code: 'PRE-10' });
  }
  function pre10(el) {
    const body = page(el, { code: 'PRE-10', title: 'Errores de armado', sub: 'Registro con tipo, etapa en que se detectó, responsable, costo y acción correctiva. Los que llegaron al cliente cuentan para el indicador de pedidos con error (RN-PRE-11).', actions: [G.can('pre.error.manage') ? { label: 'Registrar error', kind: 'primary', icon: '+', onClick: () => errorForm() } : null].filter(Boolean) });
    const rows = G.scope.filter(G.db.all('packing_errors').map(e => Object.assign({}, e, { _ref: e, o: G.db.get('sales_orders', e.order_id) })), { brand: '_' });
    const k3 = G.kpi('KPI-PRE-03') || {};
    const k5 = G.kpi('KPI-PRE-05');
    body.appendChild(kpis([{ label: 'Pedidos con error que llegó al cliente', value: G.fmt.pct(k3.value, 2), sub: `${k3.numerator || 0} de ${k3.denominator || 0} entregados · KPI-PRE-03` }, { label: 'Abiertos', value: rows.filter(e => e.status === 'OPEN').length, tone: rows.some(e => e.status === 'OPEN') ? 'warn' : 'ok' }, { label: 'Costo de errores del mes', value: G.fmt.money(U.sum(rows.filter(e => String(e.detected_at).slice(0, 7) === G.TODAY.slice(0, 7)), e => e.cost_amount)) }, { label: 'Errores bloqueados por escaneo', value: k5 ? k5.value : 0, sub: 'KPI-PRE-05 del mes' }]));
    const byType = ERR_TYPES.map(([k, l]) => ({ label: l, value: rows.filter(e => e.error_type === k).length })).filter(x => x.value);
    if (byType.length) body.appendChild(card('Por tipo', G.ui.chart.hbar({ items: byType, format: v => G.fmt.num(v) })));
    body.appendChild(table({ id: 'pre10', rows, sort: 'detected_at', dir: -1, columns: [{ key: 'detected_at', label: 'Fecha', render: e => G.fmt.datetime(e.detected_at) }, { key: 'order', label: 'Pedido', mono: true, value: e => e.o ? e.o.number : '—' }, { key: 'error_type', label: 'Tipo', value: e => optName(ERR_TYPES, e.error_type) }, { key: 'detected_at_stage', label: 'Etapa', render: e => badge(optName(STAGES, e.detected_at_stage), ['DELIVERY', 'CUSTOMER_CLAIM'].includes(e.detected_at_stage) ? 'bad' : 'info') }, { key: 'resp', label: 'Responsable', value: e => (G.db.get('employees', e.responsible_employee_id) || {}).full_name || '—' }, { key: 'cost_amount', label: 'Costo', align: 'r', render: e => G.fmt.money(e.cost_amount) }, { key: 'description', label: 'Qué pasó' }, { key: 'status', label: 'Estado', render: e => G.ui.status(e.status) }], filters: [{ key: 'status', label: 'Estado', options: [['OPEN', 'Abierto'], ['CLOSED', 'Cerrado']] }, { key: 'detected_at_stage', label: 'Etapa', options: STAGES }, { key: 'error_type', label: 'Tipo', options: ERR_TYPES }], onRow: e => drawer(`Error de armado · ${e.o ? e.o.number : ''}`, (bd, close) => { if (e.status === 'OPEN' && G.can('pre.error.manage')) bd.appendChild(card('Cerrar con acción correctiva', form({ id: 'pre10-c', values: { action: e.corrective_action || '' }, submitLabel: 'Cerrar error', fields: [{ key: 'action', label: 'Acción correctiva', type: 'textarea' }], onSubmit: v => { try { P.closeError(e.id, v.action); close(); toast('Error cerrado', 'ok'); G.refresh(); return true; } catch (x) { return x.message; } } }))); bd.appendChild(dl([['Pedido', e.o ? `${e.o.number} · ${G.custName(e.o.customer_id)}` : '—'], ['Tipo', optName(ERR_TYPES, e.error_type)], ['Etapa', optName(STAGES, e.detected_at_stage)], ['Responsable', (G.db.get('employees', e.responsible_employee_id) || {}).full_name], ['Detectó', G.userName(e.detected_by)], ['Costo', G.fmt.money(e.cost_amount)], ['Descripción', e.description], ['Acción correctiva', e.corrective_action], ['Estado', G.ui.status(e.status)]])); }, { code: 'PRE-10' }) }));
  }

  /* ---------- PRE-11 Tablero de preparación ---------- */
  function pre11(el) {
    const body = page(el, { code: 'PRE-11', title: 'Tablero de preparación', sub: 'Olas del día, avance por pedido y preparador, y pedidos atrasados respecto de su franja (deben estar listos pre_ready_lead_minutes antes del inicio).' });
    const ts = todayTasks();
    const late = G.scope.filter(P.late());
    const k1 = G.kpi('KPI-PRE-01') || {}, k2 = G.kpi('KPI-PRE-02'), k4 = G.kpi('KPI-PRE-04') || {}, k7 = G.kpi('KPI-PRE-07') || {};
    body.appendChild(kpis([{ label: 'Pedidos de hoy en preparación', value: ts.length, sub: `${ts.filter(t => ['VERIFIED', 'LOADED'].includes(t.status)).length} verificados` }, { label: 'Atrasados', value: late.length, tone: late.length ? 'bad' : 'ok', sub: `Listos ${G.param('pre_ready_lead_minutes')} min antes de la franja` }, { label: 'Pedidos por hora-persona', value: G.fmt.num(k1.value, 1), sub: 'KPI-PRE-01 del mes' }, { label: 'Confirmado a listo (mediana)', value: k2 ? `${G.fmt.num(k2.value)} min` : '—', sub: 'KPI-PRE-02' }, { label: 'Líneas verificadas por escaneo', value: G.fmt.pct(k4.value), sub: 'KPI-PRE-04' }, { label: 'Listos a tiempo', value: G.fmt.pct(k7.value), sub: 'KPI-PRE-07' }]));
    const order = ['PENDING', 'PICKING', 'PICKED', 'PACKED', 'VERIFIED', 'LOADED'];
    body.appendChild(h('div', { class: 'kanban' }, order.map(st => h('div', { class: 'kan-col' }, h('div', { class: 'between' }, h('b', null, TASK_ST[st][0]), badge(ts.filter(t => t.status === st).length, '')), ts.filter(t => t.status === st).sort((a, b) => String(a.slot_from).localeCompare(b.slot_from)).slice(0, 12).map(t => { const o = orderOf(t); const isLate = late.includes(t); return h('div', { class: 'kan-card', style: isLate ? 'border-color:var(--bad)' : '', on: { click: () => G.go(st === 'PACKED' ? 'PRE-07' : st === 'PICKED' ? 'PRE-06' : st === 'VERIFIED' ? 'PRE-08' : 'PRE-04', { task: t.id }) } }, h('div', { class: 'between' }, h('b', { class: 'mono' }, o.number), isLate ? badge('Atrasado', 'bad') : h('span', { class: 'small muted' }, t.slot_from)), h('div', { class: 'small' }, G.custName(o.customer_id)), h('div', { class: 'small muted' }, `${t.route_code || 'sin ruta'} · ${G.userShort(t.preparer_user_id)}`), G.ui.progress(progressOf(t), progressOf(t) >= 100 ? 'ok' : '')); })))));
    const waves = G.scope.filter(G.db.where('picking_waves', w => w.wave_date === G.TODAY && w.status !== 'CANCELLED'), { brand: '_' });
    const g = h('div', { class: 'grid c2' });
    g.appendChild(card('Olas del día', waves.length ? h('div', { class: 'stack', style: 'gap:8px' }, waves.map(w => { const wt = ts.filter(t => t.wave_id === w.id); const pr = wt.length ? R(U.sum(wt, progressOf) / wt.length, 0) : 0; return h('div', { style: 'cursor:pointer', on: { click: () => G.go('PRE-02', { wave: w.id }) } }, h('div', { class: 'between small' }, h('b', null, `${w.number} · ${G.siteName(w.establishment_id)} · ${w.slot_from}–${w.slot_to}`), wBadge(w.status)), G.ui.progress(pr, pr >= 100 ? 'ok' : ''), h('div', { class: 'small muted' }, `${pr} % · ${wt.length} pedidos`)); })) : G.ui.empty('Sin olas hoy.')));
    const byP = U.groupBy(ts.filter(t => t.preparer_user_id), 'preparer_user_id');
    g.appendChild(card('Por preparador (hoy)', table({ id: 'pre11-p', rows: Object.entries(byP).map(([u, xs]) => { const sc = G.db.where('picking_scans', s => s.user_id === u && String(s.scanned_at).startsWith(G.TODAY) && s.scan_type === 'PICK'); return { id: u, name: G.userName(u), n: xs.length, done: xs.filter(t => ['VERIFIED', 'LOADED'].includes(t.status)).length, ok: sc.filter(s => s.result === 'OK').length, bad: sc.filter(s => s.result !== 'OK').length }; }), search: false, columns: [{ key: 'name', label: 'Preparador' }, { key: 'n', label: 'Pedidos', align: 'r' }, { key: 'done', label: 'Verificados', align: 'r' }, { key: 'ok', label: 'Lecturas OK', align: 'r' }, { key: 'bad', label: 'Bloqueadas', align: 'r', render: r => r.bad ? badge(r.bad, 'warn') : '0' }] }), { flush: true }));
    body.appendChild(g);
    if (late.length) body.appendChild(card('Pedidos atrasados', table({ id: 'pre11-l', rows: late, search: false, columns: [{ key: 'order_number', label: 'Pedido', mono: true }, { key: 'slot_from', label: 'Franja', render: t => `${t.slot_from}–${t.slot_to}` }, { key: 'status', label: 'Estado', render: t => tBadge(t.status) }, { key: 'prog', label: 'Avance', value: progressOf, render: t => `${progressOf(t)} %` }, { key: 'route_code', label: 'Ruta' }, { key: 'preparer_user_id', label: 'Preparador', value: t => G.userShort(t.preparer_user_id) }], onRow: t => G.go('PRE-04', { task: t.id }) }), { flush: true }));
    const blocked = G.db.where('picking_scans', s => s.result !== 'OK' && String(s.scanned_at).startsWith(G.TODAY));
    if (blocked.length) body.appendChild(card('Errores bloqueados por escaneo hoy (KPI-PRE-05)', G.ui.chart.hbar({ items: Object.entries(U.groupBy(blocked, 'result')).map(([k, v]) => ({ label: RESULTS[k] || k, value: v.length, tone: 'warn' })), format: v => G.fmt.num(v) })));
  }

  /* ---------- PRE-12 Autorizaciones FEFO ---------- */
  function pre12(el) {
    const body = page(el, { code: 'PRE-12', title: 'Autorizaciones FEFO', sub: 'Bandeja de lecturas bloqueadas por FEFO: la supervisora (pre.fefo.override) autoriza el lote leído, que queda registrado, o pide tomar el lote que vence antes (RN-PRE-05).' });
    const pend = P.pendingFefo().filter(s => G.scope.ok(G.db.get('picking_tasks', s.task_id) || {}, { brand: 'brand_id' }));
    const done = G.db.where('picking_scans', s => s.override_of).sort(U.by('scanned_at', -1));
    body.appendChild(kpis([{ label: 'Por resolver', value: pend.length, tone: pend.length ? 'warn' : 'ok' }, { label: 'Autorizadas', value: done.filter(s => s.result === 'OK').length }, { label: 'Rechazadas', value: done.filter(s => s.error_code === 'OVERRIDE_DENIED').length }, { label: 'Puede autorizar', value: G.can('pre.fefo.override') ? 'Sí' : 'No', sub: G.roleName() }]));
    body.appendChild(card('Pendientes', table({ id: 'pre12', rows: pend, search: false, columns: [{ key: 'scanned_at', label: 'Hora', render: s => G.fmt.datetime(s.scanned_at) }, { key: 'order', label: 'Pedido', mono: true, value: s => (G.db.get('picking_tasks', s.task_id) || {}).order_number }, { key: 'variant_id', label: 'Producto', value: s => G.variantName(s.variant_id) }, { key: 'lot_id', label: 'Lote leído', mono: true, render: s => { const l = lotOf(s.lot_id); return l ? `${l.code} · ${G.fmt.date(l.expiry_date)}` : '—'; } }, { key: 'sug', label: 'Lote que vence antes', mono: true, render: s => { const l = lotOf(s.suggested_lot_id); return l ? `${l.code} · ${G.fmt.date(l.expiry_date)}` : '—'; } }, { key: 'user_id', label: 'Preparador', value: s => G.userShort(s.user_id) }], actions: s => G.can('pre.fefo.override') ? [btn('Autorizar', () => modal('Autorizar lote fuera de FEFO', bd => bd.appendChild(form({ id: 'pre12-a', submitLabel: 'Autorizar', fields: [{ key: 'reason', label: 'Motivo', type: 'select', options: [['Lote anterior reservado para otro pedido', 'Lote anterior reservado para otro pedido'], ['Lote anterior en otra cámara', 'Lote anterior en otra cámara'], ['Pedido de restaurante con vida útil mayor', 'Pedido de restaurante con vida útil mayor']] }], onSubmit: v => { try { const r = P.authorizeFefo(s.id, v.reason); G.ui.closeAll(); toast(r.ok ? 'Autorizado: el paquete cuenta para el pedido' : r.message, r.ok ? 'ok' : 'warn'); G.refresh(); return true; } catch (e) { return e.message; } } }))), { sm: true, kind: 'primary' }), btn('Pedir otro lote', () => tryDo(() => P.denyFefo(s.id, 'Toma el lote que vence antes'), 'Se pidió al preparador tomar el lote que vence antes'), { sm: true, kind: 'ghost' })] : [], empty: 'Sin lecturas bloqueadas por FEFO.' }), { flush: true }));
    body.appendChild(card('Historial', table({ id: 'pre12-h', rows: done, search: false, pageSize: 10, columns: [{ key: 'scanned_at', label: 'Hora', render: s => G.fmt.datetime(s.scanned_at) }, { key: 'order', label: 'Pedido', mono: true, value: s => (G.db.get('picking_tasks', s.task_id) || {}).order_number }, { key: 'lot', label: 'Lote', mono: true, value: s => (lotOf(s.lot_id) || {}).code }, { key: 'result', label: 'Decisión', render: s => s.result === 'OK' ? badge('Autorizado', 'ok') : badge('Otro lote', 'warn') }, { key: 'override_by', label: 'Supervisora', value: s => G.userShort(s.override_by) }, { key: 'override_reason', label: 'Motivo', value: s => s.override_reason || s.message }], empty: 'Sin decisiones.' }), { flush: true }));
  }

  /* ------------------------------------------------------------------
     Registro
     ------------------------------------------------------------------ */
  const OPS = ['PREPARADOR', 'ALMACENERO', 'COORDINADOR_DELIVERY', 'SUPERVISORA_VENTAS', 'REPARTIDOR'];
  G.register({
    code: 'PRE', name: 'Preparación de pedidos', phase: 1, group: 'Operación y despacho',
    screens: [
      { code: 'PRE-01', name: 'Planificador de olas', render: pre01 },
      { code: 'PRE-02', name: 'Lista consolidada', render: pre02 },
      { code: 'PRE-03', name: 'Lista por pedido', render: pre03 },
      { code: 'PRE-04', name: 'Armado con escaneo', render: pre04, roles: ['PREPARADOR', 'ALMACENERO'] },
      { code: 'PRE-05', name: 'Pesado', render: pre05 },
      { code: 'PRE-06', name: 'Bolsas y etiquetas', render: pre06 },
      { code: 'PRE-07', name: 'Verificación', render: pre07, roles: ['PREPARADOR', 'ALMACENERO'] },
      { code: 'PRE-08', name: 'Carga del vehículo', render: pre08, roles: ['PREPARADOR', 'ALMACENERO', 'REPARTIDOR', 'COORDINADOR_DELIVERY'] },
      { code: 'PRE-09', name: 'Faltantes', render: pre09 },
      { code: 'PRE-10', name: 'Errores de armado', render: pre10 },
      { code: 'PRE-11', name: 'Tablero de preparación', render: pre11 },
      { code: 'PRE-12', name: 'Autorizaciones FEFO', render: pre12, roles: OPS },
    ],
  });

  /* ------------------------------------------------------------------
     Pruebas funcionales (CA-PRE-01 … CA-PRE-09)
     ------------------------------------------------------------------ */
  const T = (name, fn) => G.tests.push({ module: 'PRE', name, fn });
  const asRole = async (role, fn) => { const prev = G.ctx.role; G.ctx.role = role; try { return await fn(); } finally { G.ctx.role = prev; } };
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code} y la acción pasó.`); };
  /** pedido confirmado de prueba con número fijo (1045, 1046, 1047) en el Local 1, franja 17:00 */
  const mk = (num, lines, cust = 'cu-0002') => {
    const o = G.orders.create({ customer_id: cust, brand_id: 'br-DG', channel: 'WHATSAPP', delivery_date: G.TODAY, slot_id: 'ts-L1-3', payment_method_id: 'pm-YAPE', notes: 'Prueba de preparación', lines, establishment_id: 'es-L1' });
    o.number = 'P-00' + num; G.orders.transition(o, 'CONFIRMED');
    const t = P.taskOf(o.id); if (t) t.order_number = o.number;
    return o;
  };
  const waveOf = async (os) => { const w = await asRole('ALMACENERO', async () => { const w = P.createWave({ site: 'es-L1', date: G.TODAY, order_ids: os.map(o => o.id) }); P.releaseWave(w.id); return w; }); return w; };
  const taskId = o => P.taskOf(o.id).id;
  T('CA-PRE-01: en el pedido 1045 (2 cuyes), un conejo que no está en la ola se bloquea como producto equivocado (RN-PRE-03)', async () => {
    const o = mk('1045', [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }]); await waveOf([o]);
    const r = await asRole('PREPARADOR', async () => P.scan(taskId(o), { code: 'DG-CON-ENT', weight_kg: 1.6 }));
    if (r.result !== 'WRONG_PRODUCT' || !r.message.startsWith('RN-PRE-03')) throw new Error('Resultado: ' + r.result + ' · ' + r.message);
    if (linesOf(taskId(o))[0].qty_picked !== 0) throw new Error('El paquete contó para el pedido');
    if (!G.db.find('picking_scans', s => s.id === r.scan.id && s.result === 'WRONG_PRODUCT')) throw new Error('La lectura no quedó registrada');
  });
  T('CA-PRE-02: con 1045 (cuyes) y 1046 (pollo) en la misma ola, el pollo leído en el 1045 se bloquea como pedido cruzado', async () => {
    const a = mk('1045', [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }]); const b = mk('1046', [{ variant_id: 'va-DG-POL-ENT', qty: 1 }], 'cu-0003');
    await waveOf([a, b]);
    const r = await asRole('PREPARADOR', async () => P.scan(taskId(a), { code: 'DG-POL-ENT', weight_kg: 2.2 }));
    if (r.result !== 'WRONG_ORDER') throw new Error('Resultado: ' + r.result + ' · ' + r.message);
    if (!r.message.includes('P-001046')) throw new Error('El mensaje no dice a qué pedido pertenece: ' + r.message);
  });
  T('CA-PRE-03: un cuy del lote en cuarentena se bloquea con RN-PRE-04', async () => {
    const o = mk('1045', [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }]); await waveOf([o]);
    const r = await asRole('PREPARADOR', async () => P.scan(taskId(o), { code: 'L261010-Q01', weight_kg: 0.9 }));
    if (r.result !== 'LOT_NOT_RELEASED' || !r.message.startsWith('RN-PRE-04')) throw new Error('Resultado: ' + r.result + ' · ' + r.message);
  });
  T('CA-PRE-04: el lote L-CUY-A (vence 20/10) se bloquea por FEFO si L-CUY-B (15/10) tiene 4 disponibles; con autorización de la supervisora pasa', async () => {
    for (const l of G.db.where('lots', l => l.variant_id === 'va-DG-CUY-ENT' && l.qc_status === 'RELEASED')) l.qc_status = 'BLOCKED';
    const mkLot = (code, exp, q) => { const lot = G.db.insert('lots', { product_id: 'pr-CUY-ENT', variant_id: 'va-DG-CUY-ENT', code, origin: 'PRODUCTION', production_date: G.TODAY, expiry_date: exp, qc_status: 'RELEASED', unit_cost: 26.5 }); G.inv.move({ type: 'RECEIPT', wh: 'wh-CAM-L1', variant: 'va-DG-CUY-ENT', lot: lot.id, qty: q, weight: q * 0.9, unitCost: 26.5, source: { type: 'TEST' } }); return lot; };
    const A_ = mkLot('L-CUY-A', '2026-10-20', 10); const B_ = mkLot('L-CUY-B', '2026-10-15', 4);
    const o = mk('1045', [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }]); o.reservations = []; await waveOf([o]);
    const r = await asRole('PREPARADOR', async () => P.scan(taskId(o), { code: 'L-CUY-A', weight_kg: 0.9 }));
    if (r.result !== 'NOT_FEFO' || r.scan.suggested_lot_id !== B_.id) throw new Error('No bloqueó por FEFO: ' + r.result + ' · ' + r.message);
    await asRole('PREPARADOR', async () => expectFail(() => P.authorizeFefo(r.scan.id), 'RN-PRE-05'));
    const ok = await asRole('ALMACENERO', async () => P.authorizeFefo(r.scan.id, 'Prueba'));
    if (!ok.ok || !ok.scan.override_by || ok.scan.lot_id !== A_.id) throw new Error('La autorización no dejó pasar el paquete: ' + ok.message);
    if (linesOf(taskId(o))[0].qty_picked !== 1) throw new Error('El paquete autorizado no contó');
    if (P.pendingFefo().some(s => s.id === r.scan.id)) throw new Error('La lectura sigue pendiente en PRE-12');
  });
  const prepare = async (o, { verify = true } = {}) => {
    await asRole('PREPARADOR', async () => { P.autoPick(taskId(o)); P.pack(taskId(o), { count: 3, type: 'BAG' }); });
    if (verify) await asRole('ALMACENERO', async () => P.verify(taskId(o), { photo: 'foto.jpg' }));
  };
  T('CA-PRE-05: el pedido 1045 en la parada 4 de SURCO-B con 3 bolsas imprime «Pedido 1045 · bolsa 2 de 3 · Ruta SURCO-B · parada 4»', async () => {
    const o = mk('1045', [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }]); await waveOf([o]);
    P.assignStop(o.id, { route_code: 'SURCO-B', stop_seq: 4 });
    await prepare(o, { verify: false });
    const pcs = P.parcelsOf(o.id);
    if (pcs.length !== 3) throw new Error('No hay 3 bolsas');
    const cap = P.caption(pcs[1]);
    if (cap !== 'Pedido 1045 · bolsa 2 de 3 · Ruta SURCO-B · parada 4') throw new Error('Etiqueta: ' + cap);
  });
  T('CA-PRE-06: en SURCO-B, la bolsa del 1045 (parada 4) antes que la del 1047 (parada 5) se bloquea; cargando primero el 1047 todas quedan cargadas', async () => {
    const a = mk('1045', [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }]); const b = mk('1047', [{ variant_id: 'va-DG-CAL-1L', qty: 2 }], 'cu-0004');
    await waveOf([a, b]);
    P.assignStop(a.id, { route_code: 'SURCO-B', stop_seq: 4 }); P.assignStop(b.id, { route_code: 'SURCO-B', stop_seq: 5 });
    await prepare(a); await prepare(b);
    const rk = P.taskOf(a.id).route_key;
    const pa = P.parcelsOf(a.id), pb = P.parcelsOf(b.id);
    const r1 = await asRole('REPARTIDOR', async () => P.loadScan(rk, pa[0].label_code));
    if (r1.result !== 'LOAD_ORDER') throw new Error('No bloqueó la carga fuera de orden: ' + r1.result);
    await asRole('REPARTIDOR', async () => { for (const p of pb) { const x = P.loadScan(rk, p.label_code); if (!x.ok) throw new Error(x.message); } for (const p of pa) { const x = P.loadScan(rk, p.label_code); if (!x.ok) throw new Error(x.message); } });
    if (![...pa, ...pb].every(p => p.status === 'LOADED')) throw new Error('Quedaron bolsas sin cargar');
    if (P.taskOf(a.id).status !== 'LOADED' || P.taskOf(b.id).status !== 'LOADED') throw new Error('Las tareas no quedaron CARGADAS');
    if (!G.db.find('domain_events', e => e.name === 'order.loaded' && e.payload.order_id === a.id)) throw new Error('No se emitió order.loaded');
  });
  T('CA-PRE-07: verificar el 1045 sin foto se rechaza con RN-PRE-09; quien lo armó, con RN-PRE-13; otra persona con foto pasa', async () => {
    const o = mk('1045', [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }]); await waveOf([o]);
    await prepare(o, { verify: false });
    await asRole('ALMACENERO', async () => expectFail(() => P.verify(taskId(o), {}), 'RN-PRE-09'));
    await asRole('PREPARADOR', async () => expectFail(() => P.verify(taskId(o), { photo: 'foto.jpg' }), 'RN-PRE-13'));
    await asRole('ALMACENERO', async () => P.verify(taskId(o), { photo: 'foto.jpg' }));
    if (P.taskOf(o.id).status !== 'VERIFIED') throw new Error('No quedó verificado');
    if (G.db.get('sales_orders', o.id).status !== 'READY') throw new Error('El pedido no pasó a LISTO: ' + o.status);
  });
  T('CA-PRE-08: 1000 pedidos entregados en el período y 12 errores en entrega o reclamo dan 1,2 % de pedidos con error de armado', async () => {
    const p = { from: '2026-09-01', to: '2026-10-09' };
    const del = G.sales.orders(Object.assign({ statuses: ['DELIVERED', 'CLOSED'] }, p));
    const need = 1000 - del.length;
    if (need < 0) for (const o of del.slice(0, -need)) o.status = 'CANCELLED';
    const del2 = G.sales.orders(Object.assign({ statuses: ['DELIVERED', 'CLOSED'] }, p));
    if (del2.length !== 1000) throw new Error('No se pudo fijar 1000 entregados: ' + del2.length);
    for (const e of G.db.all('packing_errors')) e.detected_at_stage = 'VERIFICATION';
    await asRole('ALMACENERO', async () => { for (let i = 0; i < 12; i++) P.recordError({ order_id: del2[i * 50].id, error_type: 'WRONG_PRODUCT', detected_at_stage: i % 2 ? 'DELIVERY' : 'CUSTOMER_CLAIM', responsible_employee_id: G.db.get('users', 'us-smamani').employee_id, description: 'Prueba de indicador' }); });
    const k = G.kpi('KPI-PRE-03', p);
    if (!k || k.value !== 1.2 || k.numerator !== 12 || k.denominator !== 1000) throw new Error('Indicador: ' + JSON.stringify(k));
  });
  T('CA-PRE-09: 1045 con 2 cuyes (1,800 kg estimados): paquetes de 0,86 y 0,86 kg completan la línea con 1,72 kg y PED recibe el peso', async () => {
    const o = mk('1045', [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }]); await waveOf([o]);
    const ol = o.lines[0];
    if (ol.est_weight_kg !== 1.8) throw new Error('Estimado: ' + ol.est_weight_kg);
    await asRole('PREPARADOR', async () => { const lot = P.suggestLot(taskId(o), 'va-DG-CUY-ENT').lot; const r1 = P.scan(taskId(o), { code: lot.code, weight_kg: 0.86 }); if (!r1.ok) throw new Error(r1.message); const lot2 = P.suggestLot(taskId(o), 'va-DG-CUY-ENT').lot; const r2 = P.scan(taskId(o), { code: lot2.code, weight_kg: 0.86 }); if (!r2.ok) throw new Error(r2.message); });
    const l = linesOf(taskId(o))[0];
    if (l.status !== 'DONE' || l.weighed_kg !== 1.72) throw new Error(`Línea ${l.status} con ${l.weighed_kg} kg`);
    const o2 = G.db.get('sales_orders', o.id);
    if (o2.lines[0].weighed_kg !== 1.72 || o2.lines[0].final_amount !== R(1.72 * 42)) throw new Error('PED no recibió el peso: ' + o2.lines[0].weighed_kg + ' · ' + o2.lines[0].final_amount);
    if (!G.db.find('domain_events', e => e.name === 'order.weighed' && e.payload.order_id === o.id)) throw new Error('No se emitió order.weighed');
    if (o2.status !== 'WEIGHED') throw new Error('El pedido no pasó a PESADO: ' + o2.status);
  });
})();
