/* =====================================================================
   DEL · Delivery: rutas, app del repartidor, terceros, provincia y costo
   por entrega (Fase 1). Tablas propias: delivery_routes, delivery_stops,
   delivery_events (solo inserción), tracking_links, carrier_rates,
   carrier_invoices, carrier_invoice_lines, province_shipments,
   delivery_costs, delivery_cost_allocations (solo inserción).
   Usa del núcleo: vehicles, sales_orders, cash_accounts (ca-DRV-*),
   payments (G.pay.register), G.orders.transition, G.ui.map y G.geo.
   Respaldos: driver_settlements (CAJ), dispatch_guides (FAC) y
   shipment_parcels (PRE) se leen o escriben con los campos del dueño
   cuando su módulo no está en el build.
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, toast, form, tabs, pills } = G.ui;
  const db = G.db, U = G.util, F = G.fmt;
  const R = (n, d = 2) => U.round(n, d);
  const D = G.del = {};

  /* ------------------------------------------------------------------
     Catálogos y etiquetas
     ------------------------------------------------------------------ */
  D.MODES = [['OWN', 'Propia'], ['RENTED', 'Alquilada'], ['THIRD_PARTY', 'Empresa de delivery']];
  D.modeName = m => (D.MODES.find(x => x[0] === m) || [m, m || '—'])[1];
  D.REASONS = [['CUSTOMER_ABSENT', 'Cliente ausente'], ['WRONG_ADDRESS', 'Dirección errada'], ['REFUSED', 'Rechazo del cliente'], ['DAMAGED', 'Producto dañado'], ['NO_PAYMENT', 'Sin pago'], ['OUT_OF_SLOT', 'Fuera de franja'], ['VEHICLE_ISSUE', 'Problema del vehículo'], ['COLD_CHAIN', 'Cadena de frío'], ['OTHER', 'Otro']];
  D.reasonName = c => (D.REASONS.find(x => x[0] === c) || [c, c || '—'])[1];
  D.INCIDENTS = [['CROSSED_ORDER', 'Pedido cruzado (bolsa de otro pedido)'], ['DAMAGED_PRODUCT', 'Producto dañado'], ['MISSING_ITEM', 'Falta un producto'], ['ADDRESS_ISSUE', 'Problema con la dirección'], ['OTHER', 'Otra incidencia']];
  D.incidentName = c => (D.INCIDENTS.find(x => x[0] === c) || [c, c || '—'])[1];
  D.COST_TYPES = [['FUEL', 'Combustible'], ['MAINTENANCE_PREVENTIVE', 'Mantenimiento preventivo'], ['MAINTENANCE_CORRECTIVE', 'Mantenimiento correctivo'], ['SOAT', 'SOAT'], ['TECH_INSPECTION', 'Revisión técnica'], ['RENT', 'Alquiler del vehículo'], ['TOLL', 'Peaje'], ['PARKING', 'Estacionamiento'], ['FINE', 'Multa'], ['DRIVER_WAGE', 'Sueldo o jornal del repartidor'], ['DRIVER_MEAL', 'Alimentación'], ['DRIVER_TRANSPORT', 'Movilidad'], ['DELIVERY_BONUS', 'Bono por entregas'], ['CARRIER_FEE', 'Empresa de delivery'], ['PROVINCE_FREIGHT', 'Flete a provincia'], ['PACKAGING', 'Empaque'], ['OTHER', 'Otro']];
  D.costName = (t, sub) => sub === 'DEPRECIATION' ? 'Depreciación' : (D.COST_TYPES.find(x => x[0] === t) || [t, t])[1];
  D.VTYPES = [['MOTO', 'Moto'], ['VAN', 'Furgoneta'], ['CAR', 'Auto'], ['TRUCK', 'Camión']];
  D.vtypeName = t => (D.VTYPES.find(x => x[0] === t) || [t, t])[1];
  D.PAYMODES = [['DAILY', 'Jornal por día'], ['PER_DELIVERY', 'Pago por entrega']];
  D.COD_METHODS = [['pm-CASH', 'Efectivo'], ['pm-YAPE', 'Yape (QR de la empresa)'], ['pm-PLIN', 'Plin (QR de la empresa)'], ['pm-CARD', 'POS (tarjeta)']];
  const RST = { PLANNED: ['Planificada', 'info'], LOADING: ['Cargando', 'warn'], IN_ROUTE: ['En ruta', 'info'], RETURNED: ['De vuelta', 'warn'], SETTLED: ['Liquidada', 'ok'], CANCELLED: ['Cancelada', ''] };
  const SST = { PENDING: ['Pendiente', 'warn'], ARRIVED: ['En el lugar', 'info'], DELIVERED: ['Entregado', 'ok'], FAILED: ['No entregado', 'bad'], RESCHEDULED: ['Reprogramado', ''], CANCELLED: ['Cancelado', ''], HANDED_OFF: ['Con motorizado externo', 'info'] };
  const PST = { PREPARED: ['Preparado', 'warn'], HANDED_TO_AGENCY: ['Entregado a la agencia', 'info'], IN_TRANSIT: ['En tránsito', 'info'], DELIVERED: ['Entregado', 'ok'], RETURNED: ['Devuelto', 'bad'], LOST: ['Perdido', 'bad'] };
  const IST = { PENDING: ['Pendiente', 'warn'], RECONCILED: ['Conciliada', 'ok'], OBSERVED: ['Observada', 'bad'] };
  const MST = { MATCHED: ['Coincide', 'ok'], AMOUNT_DIFF: ['Monto distinto', 'warn'], NOT_REGISTERED: ['No registrado', 'bad'], NOT_BILLED: ['No facturado', 'warn'] };
  const BST = { OPEN: ['Abierta', ''], SEALED: ['Por cargar', 'warn'], LOADED: ['Cargada', 'info'], DELIVERED: ['Entregada', 'ok'], RETURNED: ['Devuelta', 'bad'] };
  const LST = { OPEN: ['Abierta', 'warn'], SETTLED: ['Liquidada', 'ok'], WITH_DIFFERENCE: ['Con diferencia', 'bad'], APPROVED: ['Aprobada', 'ok'] };
  const sb = (map, s) => badge((map[s] || [s])[0], (map[s] || [, ''])[1]);
  D.routeBadge = s => sb(RST, s); D.stopBadge = s => sb(SST, s); D.bagBadge = s => sb(BST, s);
  D.STATUS = { route: RST, stop: SST, province: PST, invoice: IST, line: MST, bag: BST, settlement: LST };

  /* ------------------------------------------------------------------
     Utilidades
     ------------------------------------------------------------------ */
  const tsAdd = (iso, min) => { const d = new Date(String(iso).slice(0, 16) + ':00Z'); d.setUTCMinutes(d.getUTCMinutes() + Math.round(min)); return d.toISOString().slice(0, 16); };
  D.tsAdd = tsAdd;
  const hm = iso => iso ? String(iso).slice(11, 16) : '—';
  const minutesBetween = (a, b) => (new Date(String(b).slice(0, 16) + ':00Z') - new Date(String(a).slice(0, 16) + ':00Z')) / 60000;
  D.minutesBetween = minutesBetween;
  const monthEnd = p => G.date.add(G.date.addMonths(p, 1), -1);
  D.monthEnd = monthEnd;
  const order = id => db.get('sales_orders', id);
  const user = id => db.get('users', id);
  const firstName = id => { const u = user(id); return u ? u.name.split(' ')[0] : '—'; };
  D.driverEmployee = uid => { const u = user(uid); return u ? u.employee_id : null; };
  D.driverAccount = uid => uid ? 'ca-DRV-' + String(uid).slice(3) : null;
  D.drivers = () => db.where('users', u => u.role === 'REPARTIDOR' && u.status === 'ACTIVE');
  D.carriers = () => db.where('suppliers', s => s.supplier_type === 'DELIVERY_COMPANY' && s.status === 'ACTIVE');
  D.vehicle = id => db.get('vehicles', id);
  D.vehLabel = id => { const v = D.vehicle(id); return v ? `${v.plate} · ${D.vtypeName(v.vehicle_type)}${v.ownership === 'RENTED' ? ' alquilada' : ''}` : '—'; };
  D.sitePt = est => { const e = db.get('establishments', est); return e && e.lat != null ? [e.lat, e.lng] : [-12.13, -76.99]; };
  D.orderPt = o => {
    const a = o && o.address_id && db.get('customer_addresses', o.address_id);
    if (a && a.lat != null) return [a.lat, a.lng];
    const z = o && o.zone_id && db.get('delivery_zones', o.zone_id);
    if (z && z.lat != null) return [z.lat, z.lng];
    return D.sitePt(o ? o.establishment_id : 'es-L1');
  };
  D.orderKg = o => R(U.sum(o.lines || [], l => { if (l.price_basis === 'KG') return l.weighed_kg ?? l.est_weight_kg ?? l.qty; const v = G.variant(l.variant_id); return (v && v.nominal_weight_kg ? v.nominal_weight_kg : 0.5) * l.qty; }), 3);
  D.orderTotal = o => o ? (o.final_total ?? o.estimated_total ?? 0) : 0;
  D.maskPhone = p => { const s = String(p || ''); return s.length > 6 ? s.slice(0, 4) + ' ' + s.slice(4, 5) + '** *** ' + s.slice(-3) : '—'; };
  D.companyNumber = o => { const ch = db.find('messaging_channels', c => c.kind === 'WHATSAPP' && c.brand_id === (o && o.brand_id)) || db.find('messaging_channels', c => c.kind === 'WHATSAPP'); return ch ? ch.number : '—'; };
  const isActiveStop = s => !['FAILED', 'RESCHEDULED', 'CANCELLED'].includes(s.status);
  D.stopsOf = rid => db.where('delivery_stops', s => s.route_id === rid).sort(U.by('seq'));
  D.activeStops = rid => D.stopsOf(rid).filter(s => s.status !== 'CANCELLED' && s.status !== 'RESCHEDULED');
  D.activeStopOf = oid => db.find('delivery_stops', s => s.order_id === oid && isActiveStop(s));
  D.routeKm = r => (r.odometer_end != null && r.odometer_start != null && r.odometer_end > r.odometer_start) ? R(r.odometer_end - r.odometer_start, 1) : (r.planned_km || 0);
  D.routeLabel = r => r ? `${r.code} · ${F.date(r.route_date)}` : '—';
  D.slotOf = o => o && o.slot_from ? `${o.slot_from}–${o.slot_to}` : '—';
  D.newEventId = () => 'app-' + U.token(10);
  const routeIsDriveable = r => r.mode === 'OWN' || r.mode === 'RENTED';
  /** encuadre del mapa a los puntos (mantiene la proporción del lienzo 640 × alto) */
  D.fit = function (pts, H = 340, W = 640) {
    const ok = pts.filter(p => p && p[0] != null); if (!ok.length) return undefined;
    let la0 = Math.min(...ok.map(p => p[0])), la1 = Math.max(...ok.map(p => p[0])), ln0 = Math.min(...ok.map(p => p[1])), ln1 = Math.max(...ok.map(p => p[1]));
    let latS = Math.max(la1 - la0, 0.025) * 1.3, lngS = Math.max(ln1 - ln0, 0.025) * 1.3; const ratio = W / H;
    if (lngS / latS < ratio) lngS = latS * ratio; else latS = lngS / ratio;
    const cl = (la0 + la1) / 2, cn = (ln0 + ln1) / 2;
    return { latMin: cl - latS / 2, latMax: cl + latS / 2, lngMin: cn - lngS / 2, lngMax: cn + lngS / 2 };
  };
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

  /* ------------------------------------------------------------------
     Bolsas: de PRE si existe (G.pre o shipment_parcels); si no, una por línea
     ------------------------------------------------------------------ */
  D.parcels = function (stop) {
    const o = order(stop.order_id); if (!o) return [];
    let real = null;
    if (G.pre && typeof G.pre.parcelsOf === 'function') { try { real = G.pre.parcelsOf(o.id); } catch (e) { real = null; } }
    if (!real || !real.length) real = db.where('shipment_parcels', p => p.order_id === o.id && p.status !== 'VOIDED');
    if (real && real.length) return real.sort(U.by('parcel_no')).map(p => ({ id: p.id, real: true, label: p.label_code, no: p.parcel_no, count: p.parcel_count, status: p.status === 'OPEN' ? 'SEALED' : p.status, weight_kg: p.weight_kg }));
    return (stop.bags || []).map(b => Object.assign({ real: false }, b));
  };
  D.virtualBags = o => { const n = Math.max(1, (o.lines || []).length); return Array.from({ length: n }, (_, i) => ({ no: i + 1, count: n, label: `${o.number}-${i + 1}/${n}`, status: 'SEALED' })); };
  D.setParcel = function (stop, label, status) {
    const ps = D.parcels(stop); const now = G.date.now();
    for (const p of ps) {
      if (label && p.label.toUpperCase() !== String(label).toUpperCase()) continue;
      if (p.real) {
        if (G.pre && typeof G.pre.setParcelStatus === 'function') G.pre.setParcelStatus(p.id, status, { route_id: stop.route_id, stop_seq: stop.seq });
        else db.update('shipment_parcels', p.id, Object.assign({ status }, status === 'LOADED' ? { loaded_at: now, loaded_by: G.ctx.userId(), route_id: stop.route_id, stop_seq: stop.seq } : {}), { silent: true });
      } else {
        const bags = (stop.bags || []).map(b => b.label.toUpperCase() === p.label.toUpperCase() ? Object.assign({}, b, { status }, status === 'LOADED' ? { loaded_at: now, loaded_by: G.ctx.userName() } : {}) : b);
        stop.bags = bags; db.update('delivery_stops', stop.id, { bags }, { silent: true });
      }
    }
  };
  D.bagsLoaded = stop => D.parcels(stop).every(p => ['LOADED', 'DELIVERED'].includes(p.status));
  /** carga de una bolsa por escaneo (RN-DEL-04). Una bolsa de otro pedido se rechaza como pedido cruzado. */
  D.loadParcel = function (routeId, code) {
    const r = db.get('delivery_routes', routeId); if (!r) G.fail('RN-DEL-04', 'Ruta no encontrada.');
    if (!['PLANNED', 'LOADING'].includes(r.status)) G.fail('RN-DEL-04', `La ruta ${r.code} está ${RST[r.status][0].toLowerCase()}: ya no se cargan bolsas.`);
    const c = String(code || '').trim().toUpperCase();
    for (const s of D.activeStops(routeId)) {
      const p = D.parcels(s).find(x => x.label.toUpperCase() === c);
      if (p) {
        if (['LOADED', 'DELIVERED'].includes(p.status)) return { already: true, stop: s, parcel: p };
        D.setParcel(s, p.label, 'LOADED');
        if (r.status === 'PLANNED') db.update('delivery_routes', r.id, { status: 'LOADING' }, { silent: true });
        const o = order(s.order_id);
        if (D.bagsLoaded(s) && o) G.events.emit('order.loaded', { order_id: o.id, number: o.number, route_id: r.id });
        return { stop: s, parcel: p };
      }
    }
    const other = db.where('delivery_stops', s => isActiveStop(s) && s.route_id !== routeId).find(s => D.parcels(s).some(p => p.label.toUpperCase() === c));
    if (other) { const r2 = db.get('delivery_routes', other.route_id); G.fail('RN-DEL-04', `La bolsa ${c} es del pedido ${(order(other.order_id) || {}).number} de la ruta ${r2 ? r2.code : '—'}: no la cargues en ${r.code} (pedido cruzado).`); }
    G.fail('RN-DEL-04', `La bolsa ${c} no pertenece a ninguna parada de la ruta ${r.code}.`);
  };

  /* ------------------------------------------------------------------
     Rutas y paradas (RN-DEL-01, RN-DEL-02)
     ------------------------------------------------------------------ */
  /** orden sugerido: vecino más cercano desde el local (RN-DEL-02, D-DEL-04) */
  D.nearest = function (start, items, ptOf) {
    const left = items.slice(); const out = []; let cur = start;
    while (left.length) { let bi = 0, bd = 1e9; left.forEach((it, i) => { const d = G.geo.km(cur, ptOf(it)); if (d < bd) { bd = d; bi = i; } }); const it = left.splice(bi, 1)[0]; out.push(it); cur = ptOf(it); }
    return out;
  };
  D.routePoints = function (r, stops) {
    stops = stops || D.activeStops(r.id).filter(s => s.status !== 'FAILED');
    const site = D.sitePt(r.establishment_id);
    return [site, ...stops.map(s => D.orderPt(order(s.order_id))), site];
  };
  D.recomputeKm = function (r) { const km = G.geo.routeKm(D.routePoints(r)); db.update('delivery_routes', r.id, { planned_km: km }, { silent: true }); return km; };
  D.resequence = function (routeId, { manualOrder } = {}) {
    const r = db.get('delivery_routes', routeId);
    const open = D.activeStops(routeId).filter(s => ['PENDING', 'ARRIVED'].includes(s.status));
    const closed = D.activeStops(routeId).filter(s => !['PENDING', 'ARRIVED'].includes(s.status));
    let seqd;
    if (manualOrder) seqd = manualOrder.map(id => open.find(s => s.id === id)).filter(Boolean);
    else { const start = closed.length ? D.orderPt(order(closed[closed.length - 1].order_id)) : D.sitePt(r.establishment_id); seqd = D.nearest(start, open, s => D.orderPt(order(s.order_id))); }
    // primero se liberan los números (no se repite el número de parada en la ruta, RN-DEL-02)
    let n = 0; const all = closed.concat(seqd);
    all.forEach(s => { s.seq = 1000 + (++n); });
    n = 0; all.forEach(s => db.update('delivery_stops', s.id, { seq: ++n }, { silent: true }));
    db.update('delivery_routes', routeId, { sequence_method: manualOrder ? 'MANUAL' : 'NEAREST_NEIGHBOR' }, { silent: true });
    D.recomputeKm(r); D.computeEta(r);
    return all;
  };
  D.computeEta = function (r) {
    let t = r.departed_at || (r.route_date + 'T' + (r.slot_from || '09:00')); let cur = D.sitePt(r.establishment_id);
    for (const s of D.activeStops(r.id)) {
      const pt = D.orderPt(order(s.order_id)); const km = G.geo.km(cur, pt) * 1.35;
      t = tsAdd(t, km / 22 * 60 + (s === D.activeStops(r.id)[0] ? 0 : 7)); cur = pt;
      if (['PENDING', 'ARRIVED'].includes(s.status)) db.update('delivery_stops', s.id, { eta: t, distance_km: R(km, 2) }, { silent: true });
      else if (s.closed_at) t = s.closed_at;
    }
  };
  D.routeCode = function (date, est, slotNo, suffix) {
    const base = `${(db.get('establishments', est) || {}).code || 'L1'}-F${slotNo || 1}-${suffix || 'R'}`;
    let code = base, i = 2; while (db.find('delivery_routes', x => x.route_date === date && x.code === code)) code = base + '-' + (i++);
    return code;
  };
  D.createRoute = function ({ route_date, establishment_id, slot_id, code, order_ids = [], mode = 'OWN' }) {
    const slot = slot_id && db.get('order_time_slots', slot_id);
    const slotNo = slot ? Number(String(slot.id).split('-').pop()) : 1;
    if (code && db.find('delivery_routes', x => x.route_date === route_date && x.code === code)) G.fail('RN-DEL-02', `Ya existe la ruta ${code} el ${F.date(route_date)}.`);
    const r = db.insert('delivery_routes', { code: code || D.routeCode(route_date, establishment_id, slotNo, 'R'), route_date, establishment_id, slot_from: slot ? slot.slot_from : null, slot_to: slot ? slot.slot_to : null, mode, vehicle_id: null, driver_user_id: null, driver_employee_id: null, carrier_supplier_id: null, sequence_method: 'NEAREST_NEIGHBOR', planned_km: 0, odometer_start: null, odometer_end: null, status: 'PLANNED', departed_at: null, returned_at: null, driver_pay_mode: null, driver_pay_rate: null });
    for (const oid of order_ids) D.addStop(r.id, oid, { noSeq: true });
    if (order_ids.length) D.resequence(r.id);
    return r;
  };
  D.addStop = function (routeId, orderId, { noSeq } = {}) {
    const r = db.get('delivery_routes', routeId); const o = order(orderId);
    if (!r || !o) G.fail('RN-DEL-02', 'Ruta o pedido no encontrado.');
    if (!['PLANNED', 'LOADING'].includes(r.status)) G.fail('RN-DEL-02', `La ruta ${r.code} ya salió: no se agregan paradas.`);
    if (!['DELIVERY'].includes(o.fulfillment)) G.fail('RN-DEL-02', `El pedido ${o.number} es ${G.fulfillName(o.fulfillment).toLowerCase()}: no va en una ruta de reparto.`);
    if (['CANCELLED', 'DELIVERED', 'CLOSED', 'DRAFT', 'IN_ROUTE'].includes(o.status)) G.fail('RN-DEL-02', `El pedido ${o.number} está ${G.ui.statusLabel(o.status).toLowerCase()}: no se puede programar.`);
    const act = D.activeStopOf(o.id);
    if (act) { const r2 = db.get('delivery_routes', act.route_id); G.fail('RN-DEL-02', `El pedido ${o.number} ya tiene una parada activa en la ruta ${r2 ? r2.code : '—'}: muévela en lugar de duplicarla.`); }
    const seq = Math.max(0, ...D.stopsOf(routeId).map(s => s.seq)) + 1;
    const total = D.orderTotal(o);
    const cod = ['pm-CASH', 'pm-CARD'].includes(o.payment_method_id) ? Math.max(0, R(total - (o.paid_amount || 0))) : 0;
    const s = db.insert('delivery_stops', { route_id: routeId, order_id: o.id, seq, zone_id: o.zone_id, eta: null, status: 'PENDING', cod_amount: cod, collected_amount: 0, delivery_code: null, pod_distance_m: null, arrived_at: null, closed_at: null, distance_km: null, bags: D.virtualBags(o), kg: D.orderKg(o) }, { silent: true });
    if (!noSeq) D.resequence(routeId);
    return s;
  };
  D.removeStop = function (stopId, reason = 'Quitado de la ruta') {
    const s = db.get('delivery_stops', stopId); const r = db.get('delivery_routes', s.route_id);
    if (!['PLANNED', 'LOADING'].includes(r.status)) G.fail('RN-DEL-02', 'La ruta ya salió: la parada se cierra como no entregada desde la app.');
    D.setParcel(s, null, 'SEALED');
    db.update('delivery_stops', s.id, { status: 'CANCELLED', closed_at: G.date.now(), seq: 900 + s.seq, notes: reason }, { silent: true });
    D.resequence(r.id);
  };
  D.moveStop = function (stopId, toRouteId) {
    const s = db.get('delivery_stops', stopId); const oid = s.order_id;
    D.removeStop(stopId, 'Movido a otra ruta');
    return D.addStop(toRouteId, oid);
  };
  D.reorder = function (routeId, stopId, dir) {
    const open = D.activeStops(routeId).filter(s => ['PENDING', 'ARRIVED'].includes(s.status));
    const i = open.findIndex(s => s.id === stopId); const j = i + dir;
    if (i < 0 || j < 0 || j >= open.length) return;
    const ids = open.map(s => s.id); [ids[i], ids[j]] = [ids[j], ids[i]];
    D.resequence(routeId, { manualOrder: ids });
  };

  /* ------------------------------------------------------------------
     Documentos del vehículo y asignación (RN-DEL-01, RN-DEL-03)
     ------------------------------------------------------------------ */
  D.vehicleDocIssues = function (v, date = G.TODAY) {
    if (!v) return [];
    const out = []; const alert = G.param('del_doc_alert_days') ?? 15;
    for (const [k, name] of [['soat_expires_on', 'SOAT'], ['tech_inspection_expires_on', 'Revisión técnica']]) {
      const d = v[k];
      if (!d) out.push({ level: 'bad', doc: name, msg: `${name} sin registrar` });
      else if (d < date) out.push({ level: 'bad', doc: name, msg: `${name} vencido el ${F.date(d)}` });
      else if (G.date.diff(d, date) <= alert) out.push({ level: 'warn', doc: name, msg: `${name} vence el ${F.date(d)} (en ${F.days(G.date.diff(d, date))})` });
    }
    return out;
  };
  D.assertVehicleDocs = function (v, date) {
    const bad = D.vehicleDocIssues(v, date).filter(x => x.level === 'bad');
    if (bad.length) G.fail('RN-DEL-03', `${v.plate} no puede salir el ${F.date(date)}: ${bad.map(x => x.msg).join(' y ')}. Renueva el documento en DEL-12 o asigna otro vehículo.`);
  };
  D.routeKg = rid => R(U.sum(D.activeStops(rid).filter(s => s.status !== 'FAILED'), s => s.kg ?? D.orderKg(order(s.order_id))), 3);
  /** asigna modalidad, vehículo, repartidor o empresa (RN-DEL-01); con FLO activo valida RN-FLO-11. Devuelve avisos. */
  D.assign = function (routeId, a) {
    const r = db.get('delivery_routes', routeId); if (!r) G.fail('RN-DEL-01', 'Ruta no encontrada.');
    if (!['PLANNED', 'LOADING'].includes(r.status)) G.fail('RN-DEL-01', `La ruta ${r.code} ya salió: no se cambia la asignación.`);
    const mode = a.mode || r.mode; const warns = [];
    const patch = { mode, vehicle_id: null, driver_user_id: null, driver_employee_id: null, carrier_supplier_id: null, driver_pay_mode: null, driver_pay_rate: null };
    if (mode === 'THIRD_PARTY') {
      const sup = a.carrier_supplier_id && db.get('suppliers', a.carrier_supplier_id);
      if (!sup || sup.supplier_type !== 'DELIVERY_COMPANY') G.fail('RN-DEL-01', 'Una ruta de tercero sale con una empresa de delivery: elígela.');
      patch.carrier_supplier_id = sup.id;
      if (!D.rateFor(sup.id, null, r.route_date)) warns.push(`${G.supName(sup.id)} no tiene tarifa vigente al ${F.date(r.route_date)} (DEL-09).`);
    } else {
      const v = a.vehicle_id && D.vehicle(a.vehicle_id); const u = a.driver_user_id && user(a.driver_user_id);
      if (!v || !u) G.fail('RN-DEL-01', 'Una ruta propia o alquilada sale con vehículo y repartidor: completa ambos.');
      if (mode === 'OWN' && v.ownership !== 'OWN') G.fail('RN-DEL-01', `${v.plate} es alquilado: usa la modalidad «Alquilada».`);
      if (mode === 'RENTED' && v.ownership !== 'RENTED') G.fail('RN-DEL-01', `${v.plate} es propio: usa la modalidad «Propia».`);
      if (v.status && v.status !== 'ACTIVE' && !(G.modOn('FLO') && G.flo)) G.fail('RN-DEL-03', `${v.plate} no está activo.`);
      if (G.flo && typeof G.flo.assertVehicleOperable === 'function' && G.modOn('FLO')) G.flo.assertVehicleOperable(v.id, r.route_date);
      else D.assertVehicleDocs(v, r.route_date);
      for (const w of D.vehicleDocIssues(v, r.route_date).filter(x => x.level === 'warn')) warns.push(`RN-DEL-03: ${v.plate} · ${w.msg}.`);
      const kg = D.routeKg(r.id);
      if (v.capacity_kg && kg > v.capacity_kg) warns.push(`La ruta lleva ${F.kg(kg, 1)} y ${v.plate} carga ${F.kg(v.capacity_kg, 0)}: divide la ruta o usa otro vehículo.`);
      Object.assign(patch, { vehicle_id: v.id, driver_user_id: u.id, driver_employee_id: u.employee_id, driver_pay_mode: a.driver_pay_mode || D.defaultPay(u.id).mode, driver_pay_rate: Number(a.driver_pay_rate || D.defaultPay(u.id).rate) });
    }
    db.update('delivery_routes', r.id, patch);
    return { route: r, warnings: warns };
  };
  /** pago del repartidor por defecto: el de su última ruta; si no hay, jornal 80 (moto) o 6 por entrega (alquilada) */
  D.defaultPay = function (uid) {
    const last = db.where('delivery_routes', x => x.driver_user_id === uid && x.driver_pay_mode).sort(U.by('route_date', -1))[0];
    if (last) return { mode: last.driver_pay_mode, rate: last.driver_pay_rate };
    return { mode: 'DAILY', rate: 80 };
  };

  /* ------------------------------------------------------------------
     Salida (RN-DEL-04): bolsas cargadas, pedidos EN RUTA, «va en camino»
     ------------------------------------------------------------------ */
  const code4 = () => String(1000 + Math.floor(Math.random() * 9000));
  D.trackingLink = function (o, { create = true } = {}) {
    let t = db.find('tracking_links', x => x.order_id === o.id && !x.revoked);
    if (!t && create) t = db.insert('tracking_links', { order_id: o.id, token: U.token(22), expires_at: G.date.add(o.delivery_date || G.TODAY, 3) + 'T23:59', revoked: false }, { silent: true });
    return t;
  };
  D.trackingUrl = t => t ? `https://seguimiento.donguando.pe/p/${t.token}` : '—';
  D.depart = function (routeId, { odometer_start, at } = {}) {
    const r = db.get('delivery_routes', routeId); if (!r) G.fail('RN-DEL-04', 'Ruta no encontrada.');
    if (!['PLANNED', 'LOADING'].includes(r.status)) G.fail('RN-DEL-04', `La ruta ${r.code} está ${RST[r.status][0].toLowerCase()}.`);
    if (routeIsDriveable(r) && (!r.vehicle_id || !r.driver_user_id)) G.fail('RN-DEL-01', `Asigna vehículo y repartidor a ${r.code} antes de salir (DEL-02).`);
    if (r.mode === 'THIRD_PARTY' && !r.carrier_supplier_id) G.fail('RN-DEL-01', `Asigna la empresa de delivery a ${r.code} antes de salir (DEL-02).`);
    if (routeIsDriveable(r)) D.assertVehicleDocs(D.vehicle(r.vehicle_id), r.route_date);
    const stops = D.activeStops(r.id).filter(s => s.status === 'PENDING');
    if (!stops.length) G.fail('RN-DEL-04', `La ruta ${r.code} no tiene paradas.`);
    const missing = []; for (const s of stops) for (const p of D.parcels(s)) if (!['LOADED', 'DELIVERED'].includes(p.status)) missing.push(p.label);
    if (missing.length) G.fail('RN-DEL-04', `Faltan cargar por escaneo ${missing.length} bolsa(s): ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}. La ruta sale solo con todas sus bolsas cargadas.`);
    const notReady = stops.map(s => order(s.order_id)).filter(o => !['READY', 'NOT_DELIVERED'].includes(o.status));
    if (notReady.length) G.fail('RN-DEL-04', `${notReady.map(o => o.number).join(', ')} aún no está(n) LISTO(S) (PRE): sácalos de la ruta o espera la preparación.`);
    if (odometer_start != null && r.vehicle_id && G.flo && typeof G.flo.assertOdometer === 'function' && G.modOn('FLO')) G.flo.assertOdometer(r.vehicle_id, Number(odometer_start));
    const when = at || G.date.now();
    const v = r.vehicle_id ? D.vehicle(r.vehicle_id) : null;
    db.update('delivery_routes', r.id, { status: 'IN_ROUTE', departed_at: when, odometer_start: odometer_start != null && odometer_start !== '' ? Number(odometer_start) : (v ? v.odometer_km : null) });
    D.event({ route_id: r.id, event_type: 'DEPARTED', client_event_id: 'srv-dep-' + r.id, lat: D.sitePt(r.establishment_id)[0], lng: D.sitePt(r.establishment_id)[1], occurred_at: when });
    const sent = [];
    for (const s of stops) {
      const o = order(s.order_id);
      if (!s.delivery_code) db.update('delivery_stops', s.id, { delivery_code: code4() }, { silent: true });
      if (r.driver_user_id) o.driver_user_id = r.driver_user_id;
      const before = db.where('messages', m => m.ref === o.id && m.template === 'va_en_camino').length;
      G.orders.transition(o, 'IN_ROUTE', { reason: `Salió en la ruta ${r.code}` });
      const t = D.trackingLink(o);
      // CRM envía la plantilla al recibir order.dispatched; si no está en el build, la envía DEL
      if (db.where('messages', m => m.ref === o.id && m.template === 'va_en_camino').length === before) {
        const ch = db.find('messaging_channels', c => c.kind === 'WHATSAPP' && c.brand_id === o.brand_id);
        const m = G.msg.send({ customer_id: o.customer_id, channel_id: ch ? ch.id : null, kind: 'UTILITY', template: 'va_en_camino', ref: o.id, text: `Hola ${G.custName(o.customer_id).split(' ')[0]}, tu pedido ${o.number} va en camino con ${firstName(r.driver_user_id) !== '—' ? firstName(r.driver_user_id) : G.supName(r.carrier_supplier_id)}. Síguelo aquí: ${D.trackingUrl(t)} · Código de entrega: ${db.get('delivery_stops', s.id).delivery_code}` });
        sent.push(m);
      }
    }
    D.computeEta(db.get('delivery_routes', r.id));
    G.events.emit('route.departed', { route_id: r.id, code: r.code, vehicle_id: r.vehicle_id, driver_user_id: r.driver_user_id });
    return { route: db.get('delivery_routes', r.id), messages: sent };
  };

  /* ------------------------------------------------------------------
     Eventos de la app (solo inserción, idempotentes por client_event_id)
     ------------------------------------------------------------------ */
  D.event = function (e) {
    if (!e.client_event_id) e.client_event_id = D.newEventId();
    const dup = db.find('delivery_events', x => x.client_event_id === e.client_event_id);
    if (dup) return { duplicate: true, event: dup };
    const row = db.insert('delivery_events', Object.assign({ stop_id: null, reason_code: null, lat: null, lng: null, photo_file_id: null, delivery_code: null, signature_file_id: null, amount: null, payment_id: null, receiver_name: null, notes: null, occurred_at: G.date.now() }, e), { silent: true });
    if (e.lat != null && !G._seeding && e.event_type !== 'POSITION') G.events.emit('route.position_reported', { route_id: e.route_id, lat: e.lat, lng: e.lng, at: row.occurred_at, source: e.event_type });
    return { event: row };
  };
  const dupOf = cid => cid && db.find('delivery_events', x => x.client_event_id === cid);
  const assertInRoute = (stop) => {
    const r = stop && db.get('delivery_routes', stop.route_id);
    if (!stop || !r) G.fail('RN-DEL-05', 'Parada no encontrada.');
    if (r.status !== 'IN_ROUTE') G.fail('RN-DEL-05', `La ruta ${r.code} no está EN RUTA (${RST[r.status][0]}): no se registran llegadas, entregas ni cobros.`);
    if (!['PENDING', 'ARRIVED'].includes(stop.status)) G.fail('RN-DEL-05', `La parada ${stop.seq} ya está ${SST[stop.status][0].toLowerCase()}.`);
    return r;
  };
  D.arrive = function (stopId, { lat, lng, client_event_id, at } = {}) {
    if (dupOf(client_event_id)) return { duplicate: true };
    const s = db.get('delivery_stops', stopId); const r = assertInRoute(s);
    const when = at || G.date.now();
    D.event({ route_id: r.id, stop_id: s.id, event_type: 'ARRIVED', lat, lng, client_event_id, occurred_at: when });
    db.update('delivery_stops', s.id, { status: 'ARRIVED', arrived_at: when }, { silent: true });
    return { stop: s };
  };
  D.codPending = s => Math.max(0, R((s.cod_amount || 0) - (s.collected_amount || 0)));
  /** cobro contra entrega en la caja del repartidor (RN-DEL-09, RN-CAJ-02) */
  D.collect = function (stopId, { method, amount, reference, card_last4, client_event_id, lat, lng, at } = {}) {
    if (dupOf(client_event_id)) return { duplicate: true };
    const s = db.get('delivery_stops', stopId); const r = assertInRoute(s); const o = order(s.order_id);
    if (!D.COD_METHODS.some(m => m[0] === method)) G.fail('RN-DEL-09', 'El cobro contra entrega solo usa medios de la empresa: efectivo, QR de Yape o Plin de la empresa o POS.');
    const exp = D.codPending(s);
    if (!(exp > 0)) G.fail('RN-DEL-09', `La parada ${s.seq} no tiene saldo por cobrar.`);
    if (Math.abs(Number(amount) - exp) > 0.009) G.fail('RN-DEL-09', `El monto esperado de la parada es ${F.money(exp)}; registraste ${F.money(amount)}. Si el cliente paga distinto, registra una incidencia.`);
    if (method === 'pm-CARD' && !/^\d{4}$/.test(String(card_last4 || ''))) G.fail('RN-CAJ-02', 'El cobro con POS exige los 4 últimos dígitos de la tarjeta del voucher.');
    if (['pm-YAPE', 'pm-PLIN'].includes(method) && !reference) G.fail('RN-CAJ-02', `${G.pmName(method)} exige el número de operación.`);
    const driver = r.driver_user_id;
    const pay = G.pay.register({ customer_id: o.customer_id, payment_method_id: method, amount: exp, reference: reference || null, cash_account_id: D.driverAccount(driver) || G.pay.accountFor(method, {}), allocations: [{ order_id: o.id, document_id: null, amount: exp }], brand_id: o.brand_id, establishment_id: o.establishment_id, collected_by_user_id: driver, card_last4: card_last4 || null, at });
    D.event({ route_id: r.id, stop_id: s.id, event_type: 'COD_COLLECTED', amount: exp, payment_id: pay.id, lat, lng, client_event_id, notes: G.pmName(method) + (reference ? ' · op. ' + reference : ''), occurred_at: at || G.date.now() });
    db.update('delivery_stops', s.id, { collected_amount: R((s.collected_amount || 0) + exp) }, { silent: true });
    return { payment: pay };
  };
  D.podDistance = (s, lat, lng) => { if (lat == null || lng == null) return null; const p = D.orderPt(order(s.order_id)); return R(G.geo.km(p, [lat, lng]) * 1000, 1); };
  /** entrega con prueba: foto y código de 4 dígitos o firma (RN-DEL-05, RN-DEL-06) */
  D.deliver = function (stopId, { photo, code, signature, receiver, lat, lng, client_event_id, at } = {}) {
    if (dupOf(client_event_id)) return { duplicate: true };
    const s = db.get('delivery_stops', stopId); const r = assertInRoute(s); const o = order(s.order_id);
    if (!photo) G.fail('RN-DEL-06', 'La entrega exige foto: toma la foto del pedido entregado.');
    if (!signature) {
      if (!code) G.fail('RN-DEL-06', 'Ingresa el código de entrega de 4 dígitos que recibió el cliente o pide su firma.');
      if (String(code).trim() !== String(s.delivery_code)) G.fail('RN-DEL-06', `El código ${code} no coincide con el código de entrega del pedido ${o.number}. Pide al cliente el código del mensaje «va en camino» o su firma.`);
    }
    if (D.codPending(s) > 0) G.fail('RN-DEL-09', `Cobra ${F.money(D.codPending(s))} antes de entregar o marca «no entregado» con motivo «sin pago».`);
    const when = at || G.date.now();
    const dist = D.podDistance(s, lat, lng);
    D.event({ route_id: r.id, stop_id: s.id, event_type: 'DELIVERED', lat, lng, photo_file_id: 'foto-' + U.token(8), delivery_code: signature ? null : String(code), signature_file_id: signature ? 'firma-' + U.token(8) : null, receiver_name: receiver || null, client_event_id, occurred_at: when, notes: dist != null ? `A ${F.num(dist, 0)} m del pin` : null });
    db.update('delivery_stops', s.id, { status: 'DELIVERED', closed_at: when, pod_distance_m: dist, arrived_at: s.arrived_at || when }, { silent: true });
    D.setParcel(s, null, 'DELIVERED');
    G.orders.transition(o, 'DELIVERED', { reason: `Entregado en la ruta ${r.code}`, at: when });
    const t = D.trackingLink(o, { create: false });
    if (t) db.update('tracking_links', t.id, { expires_at: tsAdd(when, (G.param('del_tracking_link_hours') ?? 48) * 60) }, { silent: true });
    const max = G.param('del_pod_max_distance_m') ?? 300;
    if (dist != null && dist > max) G.notify({ role: 'COORDINADOR_DELIVERY', title: `Entrega fuera del radio · ${o.number}`, body: `La prueba se tomó a ${F.num(dist, 0)} m del pin (máximo ${max} m, RN-DEL-06).`, ref: s.id, tone: 'warn', module: 'DEL' });
    return { stop: db.get('delivery_stops', s.id), distance_m: dist };
  };
  /** no entregado con motivo y foto (RN-DEL-07): bolsas devueltas, pedido NO ENTREGADO */
  D.fail = function (stopId, { reason, photo, notes, lat, lng, client_event_id, at } = {}) {
    if (dupOf(client_event_id)) return { duplicate: true };
    const s = db.get('delivery_stops', stopId); const r = assertInRoute(s); const o = order(s.order_id);
    if (!D.REASONS.some(x => x[0] === reason)) G.fail('RN-DEL-07', 'Elige el motivo del no entregado.');
    if (!photo) G.fail('RN-DEL-07', 'El no entregado exige foto (fachada, timbre o producto).');
    const when = at || G.date.now();
    D.event({ route_id: r.id, stop_id: s.id, event_type: 'FAILED', reason_code: reason, lat, lng, photo_file_id: 'foto-' + U.token(8), notes: notes || null, client_event_id, occurred_at: when });
    db.update('delivery_stops', s.id, { status: 'FAILED', closed_at: when, fail_reason: reason, bags_returned: false }, { silent: true });
    D.setParcel(s, null, 'RETURNED');
    G.orders.transition(o, 'NOT_DELIVERED', { reason: `${D.reasonName(reason)}${notes ? ' · ' + notes : ''}`, at: when });
    G.notify({ role: 'COORDINADOR_DELIVERY', title: `No entregado · ${o.number}`, body: `${D.reasonName(reason)} en la ruta ${r.code}. Reprograma en DEL-16.`, ref: s.id, tone: 'warn', module: 'DEL' });
    return { stop: db.get('delivery_stops', s.id) };
  };
  D.incident = function (stopId, { type, notes, client_event_id, lat, lng } = {}) {
    if (dupOf(client_event_id)) return { duplicate: true };
    const s = db.get('delivery_stops', stopId); const r = s && db.get('delivery_routes', s.route_id);
    if (!s || !r || !['IN_ROUTE', 'LOADING', 'PLANNED'].includes(r.status)) G.fail('RN-DEL-05', 'Las incidencias se registran en paradas de una ruta abierta.');
    if (!type) G.fail('RN-DEL-05', 'Elige el tipo de incidencia.');
    const ev = D.event({ route_id: r.id, stop_id: s.id, event_type: 'INCIDENT', reason_code: type === 'DAMAGED_PRODUCT' ? 'DAMAGED' : 'OTHER', notes: `${D.incidentName(type)}${notes ? ' · ' + notes : ''}`, incident_type: type, client_event_id, lat, lng });
    G.notify({ role: 'COORDINADOR_DELIVERY', title: `Incidencia · ${D.incidentName(type)}`, body: `Parada ${s.seq} de ${r.code} (${(order(s.order_id) || {}).number}). ${notes || ''}`, ref: s.id, tone: 'warn', module: 'DEL' });
    return ev;
  };
  D.contact = function (stopId, kind) {
    const s = db.get('delivery_stops', stopId); const o = order(s.order_id);
    D.event({ route_id: s.route_id, stop_id: s.id, event_type: kind === 'WHATSAPP' ? 'WHATSAPP' : 'CALL', notes: `Por el número de la empresa ${D.companyNumber(o)}` });
  };
  /** sincronización de la cola de la app: un mismo client_event_id se registra una sola vez (RN-DEL-06, CA-DEL-09) */
  D.syncEvent = function (e) {
    if (dupOf(e.client_event_id)) return { duplicate: true };
    const p = Object.assign({}, e.payload || {}, { client_event_id: e.client_event_id });
    switch (e.type) {
      case 'ARRIVED': return D.arrive(e.stop_id, p);
      case 'DELIVERED': return D.deliver(e.stop_id, p);
      case 'FAILED': return D.fail(e.stop_id, p);
      case 'COD_COLLECTED': return D.collect(e.stop_id, p);
      case 'INCIDENT': return D.incident(e.stop_id, p);
      case 'POSITION': return D.event({ route_id: e.route_id, event_type: 'POSITION', lat: p.lat, lng: p.lng, client_event_id: e.client_event_id, occurred_at: p.at || G.date.now() });
      default: if (D.ext[e.type]) return D.ext[e.type](e.stop_id, p, e); G.fail('RN-DEL-06', 'Tipo de evento desconocido: ' + e.type);
    }
  };
  D.ext = {}; D.stopExtras = []; D.noSignal = o => { const a = o && db.get('customer_addresses', o.address_id); return !!(a && a.call_signal === 'WHATSAPP_ONLY'); };
  D.outbox = []; // cola sin conexión de la app (en memoria, como el almacenamiento local del teléfono)

  /* ------------------------------------------------------------------
     Vuelta, costos automáticos y liquidación (RN-DEL-10)
     ------------------------------------------------------------------ */
  D.returnRoute = function (routeId, { odometer_end, at } = {}) {
    const r = db.get('delivery_routes', routeId);
    if (!r || r.status !== 'IN_ROUTE') G.fail('RN-DEL-05', 'Solo vuelve una ruta EN RUTA.');
    const open = D.activeStops(r.id).filter(s => ['PENDING', 'ARRIVED'].includes(s.status));
    if (open.length) G.fail('RN-DEL-05', `Quedan ${open.length} parada(s) sin cerrar: márcalas entregadas o no entregadas antes de volver.`);
    const when = at || G.date.now();
    let odo = odometer_end !== undefined && odometer_end !== '' && odometer_end != null ? Number(odometer_end) : null;
    if (routeIsDriveable(r)) {
      if (odo == null) odo = R((r.odometer_start || D.vehicle(r.vehicle_id).odometer_km || 0) + (r.planned_km || 0), 1);
      if (r.odometer_start != null && odo < r.odometer_start) G.fail('RN-DEL-13', `El odómetro final (${F.num(odo, 1)}) no puede ser menor que el inicial (${F.num(r.odometer_start, 1)}).`);
      if (G.flo && typeof G.flo.assertOdometer === 'function' && G.modOn('FLO')) G.flo.assertOdometer(r.vehicle_id, odo);
      const v = D.vehicle(r.vehicle_id); if (v && odo > (v.odometer_km || 0)) db.update('vehicles', v.id, { odometer_km: odo }, { silent: true });
    }
    db.update('delivery_routes', r.id, { status: r.mode === 'THIRD_PARTY' ? 'SETTLED' : 'RETURNED', returned_at: when, odometer_end: odo });
    D.event({ route_id: r.id, event_type: 'RETURNED', client_event_id: 'srv-ret-' + r.id, occurred_at: when });
    D.autoCosts(db.get('delivery_routes', r.id));
    G.events.emit('route.returned', { route_id: r.id, code: r.code });
    return db.get('delivery_routes', r.id);
  };
  /** costos automáticos al volver: pago del repartidor (jornal o por entrega) y alquiler diario del vehículo */
  D.autoCosts = function (r) {
    const out = []; if (!routeIsDriveable(r)) return out;
    const delivered = D.activeStops(r.id).filter(s => s.status === 'DELIVERED').length;
    const sameDay = db.where('delivery_costs', c => c.cost_date === r.route_date && c.auto && c.employee_ref === r.driver_employee_id && c.cost_type === 'DRIVER_WAGE' && c.pay_mode === 'DAILY');
    if (r.driver_pay_mode === 'PER_DELIVERY') out.push(D.addCost({ cost_date: r.route_date, cost_type: 'DRIVER_WAGE', amount: R(delivered * (r.driver_pay_rate || 0)), route_id: r.id, notes: `${delivered} entregas × ${F.money(r.driver_pay_rate)}`, auto: true, pay_mode: 'PER_DELIVERY', employee_ref: r.driver_employee_id }, { silent: true }));
    else if (!sameDay.length && r.driver_pay_rate) out.push(D.addCost({ cost_date: r.route_date, cost_type: 'DRIVER_WAGE', amount: R(r.driver_pay_rate), route_id: r.id, notes: 'Jornal del día', auto: true, pay_mode: 'DAILY', employee_ref: r.driver_employee_id }, { silent: true }));
    const v = D.vehicle(r.vehicle_id);
    if (v && v.ownership === 'RENTED' && v.rental_daily_rate && !db.find('delivery_costs', c => c.cost_date === r.route_date && c.cost_type === 'RENT' && (c.vehicle_id === v.id || (c.route_id && (db.get('delivery_routes', c.route_id) || {}).vehicle_id === v.id))))
      out.push(D.addCost({ cost_date: r.route_date, cost_type: 'RENT', amount: v.rental_daily_rate, vehicle_id: v.id, route_id: r.id, supplier_id: v.provider_id, notes: 'Alquiler diario', auto: true }, { silent: true }));
    return out;
  };
  D.settlementOf = rid => db.where('driver_settlements', x => x.route_ref === rid).sort(U.by('created_at', -1))[0] || null;
  D.expectedCash = function (rid) {
    const evs = db.where('delivery_events', e => e.route_id === rid && e.event_type === 'COD_COLLECTED' && e.payment_id);
    let cash = 0, digital = 0; const detail = [];
    for (const e of evs) { const p = db.get('payments', e.payment_id); if (!p || p.status === 'REVERSED') continue; if (p.payment_method_id === 'pm-CASH') cash += p.amount; else digital += p.amount; detail.push(p); }
    const ex = db.where('driver_expenses', x => x.route_id === rid && x.status !== 'VOIDED' && x.paid_with === 'ROUTE_CASH');
    const expenses = R(U.sum(ex, x => x.amount));
    return { cash: R(cash - expenses), gross: R(cash), digital: R(digital), payments: detail, expenses, expense_rows: ex };
  };
  /** liquidación del repartidor al volver (escribe driver_settlements de CAJ; RN-CAJ-10 motivo si hay diferencia) */
  D.settle = function (routeId, { counted_cash, reason } = {}) {
    const r = db.get('delivery_routes', routeId);
    if (!r || r.status !== 'RETURNED') G.fail('RN-DEL-10', 'Se liquida una ruta que ya volvió al local.');
    if (!routeIsDriveable(r)) G.fail('RN-DEL-10', 'Las rutas de terceros no se liquidan con el repartidor.');
    const prev = D.settlementOf(r.id); if (prev && prev.status !== 'OPEN') G.fail('RN-DEL-10', `La ruta ya tiene la liquidación ${prev.number} (${LST[prev.status][0]}).`);
    if (counted_cash === '' || counted_cash == null || isNaN(counted_cash)) G.fail('RN-CAJ-10', 'Registra el efectivo contado.');
    const exp = D.expectedCash(r.id); const diff = R(Number(counted_cash) - exp.cash);
    if (Math.abs(diff) > 0.009 && !reason) G.fail('RN-CAJ-10', `Hay una diferencia de ${F.money(diff)}: escribe el motivo.`);
    const status = Math.abs(diff) > 0.009 ? 'WITH_DIFFERENCE' : 'SETTLED';
    const row = { number: db.next('LQR', 'LQR-', 5), driver_employee_id: r.driver_employee_id, driver_cash_account_id: D.driverAccount(r.driver_user_id), receiving_account_id: r.establishment_id === 'es-L2' ? 'ca-CCH-L2' : 'ca-CAJA-L1', settlement_date: r.route_date, route_ref: r.id, expected_cash: exp.cash, expected_digital: exp.digital, delivered_cash: R(Number(counted_cash)), difference: diff, difference_reason: reason || null, status, received_by: G.ctx.userId(), settled_at: G.date.now(), settled_by: G.ctx.userId() };
    const st = prev ? db.update('driver_settlements', prev.id, row) : db.insert('driver_settlements', row);
    for (const x of exp.expense_rows || []) { x.settled = true; x.settlement_id = st.id; }
    G.events.emit('driver.settled', { settlement_id: st.id, route_ref: r.id, status });
    return st;
  };
  D.approveSettlement = function (stId) {
    const st = db.get('driver_settlements', stId);
    if (!st || st.status !== 'WITH_DIFFERENCE') G.fail('RN-DEL-10', 'Solo se aprueba una liquidación con diferencia.');
    if (!(G.ctx.role === 'GERENTE' || G.canDo('CAJ', 'A') || ['ADMINISTRACION', 'COORDINADOR_DELIVERY'].includes(G.ctx.role))) G.fail('RN-CAJ-10', 'Tu rol no aprueba liquidaciones.');
    if (st.settled_by && st.settled_by === G.ctx.userId()) G.fail('RN-CAJ-10', 'Quien registró la liquidación no la aprueba: pide la aprobación a otra persona.');
    db.update('driver_settlements', st.id, { status: 'APPROVED', approved_by: G.ctx.userId(), approved_at: G.date.now() });
    G.events.emit('driver.settled', { settlement_id: st.id, route_ref: st.route_ref, status: 'APPROVED' });
    return st;
  };
  // RN-DEL-10: la ruta pasa a LIQUIDADA solo con la liquidación liquidada o aprobada (la emita DEL o CAJ)
  G.events.on('driver.settled', p => {
    const st = p.settlement_id && db.get('driver_settlements', p.settlement_id);
    const rid = p.route_ref || (st && st.route_ref); const r = rid && db.get('delivery_routes', rid);
    if (r && r.status === 'RETURNED' && st && ['SETTLED', 'APPROVED'].includes(st.status)) db.update('delivery_routes', r.id, { status: 'SETTLED' });
  });
  // un pedido cancelado o reprogramado sale de su ruta si aún no salió
  const dropOrder = p => { const s = p && p.order_id && D.activeStopOf(p.order_id); if (!s) return; const r = db.get('delivery_routes', s.route_id); if (r && ['PLANNED', 'LOADING'].includes(r.status) && ['PENDING'].includes(s.status)) { try { D.removeStop(s.id, 'Pedido cancelado o reprogramado'); } catch (e) { } } };
  G.events.on('order.cancelled', dropOrder);
  G.events.on('order.rescheduled', dropOrder);
  // FAC emitió la guía: se enlaza al envío a provincia
  G.events.on('guide.issued', p => { const sh = p && p.order_id && db.find('province_shipments', x => x.order_id === p.order_id); if (sh && !sh.dispatch_guide_id && p.guide_id) db.update('province_shipments', sh.id, { dispatch_guide_id: p.guide_id }, { silent: true }); });
  // gasto aprobado en GAS de una categoría de reparto: se copia como costo (RN-GAS-12 / RN-DEL-13)
  G.events.on('expense.approved', p => {
    const ex = p && p.expense_id && db.get('expenses', p.expense_id); if (!ex || db.find('delivery_costs', c => c.expense_id === ex.id)) return;
    const cat = db.get('expense_categories', ex.category_id) || {};
    const t = ex.delivery_cost_type || cat.delivery_cost_type; if (!t) return;
    try { D.addCost({ cost_date: ex.expense_date || ex.issue_date || G.TODAY, cost_type: t, amount: ex.total || ex.amount, vehicle_id: ex.vehicle_id || null, route_id: ex.route_id || null, employee_id: ex.employee_id || null, supplier_id: ex.supplier_id || null, zone_id: ex.zone_id || null, fuel_gallons: ex.fuel_gallons || null, fuel_voucher_no: ex.document_number || null, odometer_km: ex.odometer_km || null, expense_id: ex.id, notes: 'Copiado de GAS ' + (ex.number || '') }, { silent: true }); } catch (e) { console.warn(e.message); }
  });

  /* ------------------------------------------------------------------
     Seguimiento público (RN-DEL-08)
     ------------------------------------------------------------------ */
  D.publicView = function (token, now = G.date.now()) {
    const t = db.find('tracking_links', x => x.token === token);
    if (!t) return { error: 'Enlace no válido.' };
    if (t.revoked) return { error: 'Este enlace fue anulado por la empresa.' };
    if (String(now).slice(0, 16) > String(t.expires_at).slice(0, 16)) return { error: `El enlace venció el ${F.datetime(t.expires_at)} (RN-DEL-08).` };
    const o = order(t.order_id); const s = D.activeStopOf(o.id) || db.where('delivery_stops', x => x.order_id === o.id).sort(U.by('created_at', -1))[0];
    const r = s && db.get('delivery_routes', s.route_id);
    const prev = s && r ? D.activeStops(r.id).filter(x => x.seq < s.seq && ['PENDING', 'ARRIVED'].includes(x.status)).length : null;
    return { number: o.number, status: o.status, brand: G.brandName(o.brand_id), slot: D.slotOf(o), eta: s && s.eta && ['PENDING', 'ARRIVED'].includes(s.status) ? hm(s.eta) : null, delivered_at: o.status === 'DELIVERED' || o.status === 'CLOSED' ? (s && s.closed_at) || o.delivered_at : null, driver: r && r.driver_user_id ? firstName(r.driver_user_id) : (r && r.carrier_supplier_id ? G.supName(r.carrier_supplier_id) : null), stops_before: prev };
  };

  /* ------------------------------------------------------------------
     Empresas de delivery: tarifas y conciliación (RN-DEL-11)
     ------------------------------------------------------------------ */
  D.rateFor = function (supId, zoneId, date) {
    const rs = db.where('carrier_rates', x => x.supplier_id === supId && x.valid_from <= date && (!x.valid_to || x.valid_to >= date) && x.status !== 'VOIDED');
    return rs.find(x => zoneId && x.zone_id === zoneId) || rs.find(x => !x.zone_id) || null;
  };
  D.saveRate = function (row, id) {
    if (!row.supplier_id || !row.rate_basis || !(Number(row.amount) >= 0) || !row.valid_from) G.fail('RN-DEL-11', 'La tarifa lleva empresa, base, monto y vigencia.');
    if (row.valid_to && row.valid_to < row.valid_from) G.fail('RN-DEL-11', 'La vigencia termina antes de empezar.');
    const clash = db.find('carrier_rates', x => x.id !== id && x.status !== 'VOIDED' && x.supplier_id === row.supplier_id && (x.zone_id || null) === (row.zone_id || null) && x.valid_from <= (row.valid_to || '9999-12-31') && (x.valid_to || '9999-12-31') >= row.valid_from);
    if (clash) G.fail('RN-DEL-11', `Se cruza con la tarifa vigente desde ${F.date(clash.valid_from)}: ciérrala (fecha fin) antes de crear la nueva.`);
    const clean = { supplier_id: row.supplier_id, zone_id: row.zone_id || null, rate_basis: row.rate_basis, amount: Number(row.amount), valid_from: row.valid_from, valid_to: row.valid_to || null, status: 'ACTIVE' };
    return id ? db.update('carrier_rates', id, clean) : db.insert('carrier_rates', clean);
  };
  D.carrierStops = function (supId, from, to) {
    const rs = new Map(db.where('delivery_routes', r => r.carrier_supplier_id === supId && r.mode === 'THIRD_PARTY' && r.route_date >= from && r.route_date <= to).map(r => [r.id, r]));
    return db.where('delivery_stops', s => rs.has(s.route_id) && ['DELIVERED', 'FAILED'].includes(s.status)).map(s => ({ s, r: rs.get(s.route_id), o: order(s.order_id) }));
  };
  D.expectedFor = function (supId, x) {
    const rate = D.rateFor(supId, x.s.zone_id, x.r.route_date); if (!rate) return 0;
    if (rate.rate_basis === 'PER_KG') return R(rate.amount * (x.s.kg || D.orderKg(x.o)));
    if (rate.rate_basis === 'PER_DAY') { const same = db.where('delivery_stops', y => y.route_id === x.s.route_id && ['DELIVERED', 'FAILED'].includes(y.status)).length || 1; return R(rate.amount / same, 4); }
    return R(rate.amount);
  };
  /** concilia la factura contra envíos entregados o fallidos × tarifa vigente; lines opcional [{ref, amount}] */
  D.reconcileInvoice = function ({ supplier_id, invoice_number, issue_date, period_from, period_to, amount, lines } = {}) {
    if (!G.can('del.carrier_invoice.reconcile')) G.fail('RN-DEL-11', 'Tu rol no concilia facturas de terceros (del.carrier_invoice.reconcile).');
    if (!supplier_id || !invoice_number || !period_from || !period_to || !(Number(amount) >= 0)) G.fail('RN-DEL-11', 'Completa empresa, número, período e importe de la factura.');
    let inv = db.find('carrier_invoices', x => x.supplier_id === supplier_id && x.invoice_number === invoice_number);
    if (inv && inv.status === 'RECONCILED') G.fail('RN-DEL-11', `La factura ${invoice_number} ya está conciliada.`);
    const ships = D.carrierStops(supplier_id, period_from, period_to);
    const expected = R(U.sum(ships, x => D.expectedFor(supplier_id, x)));
    const diff = R(Number(amount) - expected);
    const tol = G.param('del_carrier_tolerance_pen') ?? 2;
    const status = Math.abs(diff) <= tol ? 'RECONCILED' : 'OBSERVED';
    const head = { supplier_id, invoice_number, issue_date: issue_date || G.TODAY, period_from, period_to, amount: R(Number(amount)), expected_amount: expected, difference: diff, status, reconciled_by: G.ctx.userId(), reconciled_at: G.date.now(), shipments: ships.length };
    inv = inv ? db.update('carrier_invoices', inv.id, head) : db.insert('carrier_invoices', head);
    for (const l of db.where('carrier_invoice_lines', x => x.invoice_id === inv.id)) db.remove('carrier_invoice_lines', l.id);
    const byRef = new Map(ships.map(x => [x.o.number, x]));
    if (lines && lines.length) {
      const seen = new Set();
      for (const l of lines) {
        const x = byRef.get(String(l.ref).trim().toUpperCase());
        if (!x) { db.insert('carrier_invoice_lines', { invoice_id: inv.id, stop_id: null, external_ref: l.ref, billed_amount: R(l.amount), expected_amount: 0, match_status: 'NOT_REGISTERED' }, { silent: true }); continue; }
        seen.add(x.s.id); const ex = D.expectedFor(supplier_id, x);
        db.insert('carrier_invoice_lines', { invoice_id: inv.id, stop_id: x.s.id, external_ref: l.ref, billed_amount: R(l.amount), expected_amount: R(ex), match_status: Math.abs(l.amount - ex) <= 0.009 ? 'MATCHED' : 'AMOUNT_DIFF' }, { silent: true });
      }
      for (const x of ships) if (!seen.has(x.s.id)) db.insert('carrier_invoice_lines', { invoice_id: inv.id, stop_id: x.s.id, external_ref: x.o.number, billed_amount: 0, expected_amount: R(D.expectedFor(supplier_id, x)), match_status: 'NOT_BILLED' }, { silent: true });
    } else {
      for (const x of ships) { const ex = R(D.expectedFor(supplier_id, x)); db.insert('carrier_invoice_lines', { invoice_id: inv.id, stop_id: x.s.id, external_ref: x.o.number, billed_amount: ex, expected_amount: ex, match_status: 'MATCHED' }, { silent: true }); }
      if (Math.abs(diff) > 0.009) db.insert('carrier_invoice_lines', { invoice_id: inv.id, stop_id: null, external_ref: 'Diferencia sin detalle', billed_amount: diff > 0 ? diff : 0, expected_amount: diff < 0 ? -diff : 0, match_status: diff > 0 ? 'NOT_REGISTERED' : 'NOT_BILLED' }, { silent: true });
    }
    return db.get('carrier_invoices', inv.id);
  };

  /* ------------------------------------------------------------------
     Envíos a provincia (RN-DEL-12)
     ------------------------------------------------------------------ */
  D.agencies = () => db.where('suppliers', s => s.supplier_type === 'DELIVERY_COMPANY' && /provincia|cargo|agencia/i.test(s.trade_name + ' ' + s.legal_name));
  D.createShipment = function (d) {
    if (!G.can('del.province.manage')) G.fail('RN-DEL-12', 'Tu rol no registra envíos a provincia (del.province.manage).');
    const o = order(d.order_id); if (!o) G.fail('RN-DEL-12', 'Elige el pedido.');
    if (db.find('province_shipments', x => x.order_id === o.id)) G.fail('RN-DEL-12', `El pedido ${o.number} ya tiene envío a provincia.`);
    if (!d.agency_supplier_id) G.fail('RN-DEL-12', 'Elige la agencia.');
    return db.insert('province_shipments', { order_id: o.id, agency_supplier_id: d.agency_supplier_id, dispatch_guide_id: null, tracking_number: null, packaging: d.packaging || 'THERMAL_BOX', packages: Number(d.packages) || 1, weight_kg: Number(d.weight_kg) || D.orderKg(o), freight_cost: Number(d.freight_cost) || 0, packaging_cost: Number(d.packaging_cost) || 0, charged_to_customer: Number(d.charged_to_customer ?? o.delivery_fee) || 0, destination: d.destination || '', destination_ubigeo: d.destination_ubigeo || null, status: 'PREPARED', handed_at: null, delivered_at: null });
  };
  /** emite la GRE: con FAC en el build usa G.fac.issueGuide; si no, escribe dispatch_guides con la serie T001 */
  D.issueGuide = function (shId) {
    const sh = db.get('province_shipments', shId); const o = order(sh.order_id);
    if (sh.dispatch_guide_id) return db.get('dispatch_guides', sh.dispatch_guide_id);
    G.period.assertOpen(G.TODAY);
    let g = null;
    const a = db.get('customer_addresses', o.address_id) || {}; const est = db.get('establishments', o.establishment_id) || {};
    const data = { establishment_id: o.establishment_id, brand_id: o.brand_id, order_id: o.id, issue_date: G.TODAY, start_date: G.TODAY, transfer_reason_code: '01', transport_mode: '01', carrier_supplier_id: sh.agency_supplier_id, recipient_customer_id: o.customer_id, origin_address: est.address || 'Local 1', dest_address: a.address_line || sh.destination, origin_ubigeo: '150140', dest_ubigeo: sh.destination_ubigeo || a.ubigeo || '040101', gross_weight_kg: sh.weight_kg || D.orderKg(o), packages: sh.packages };
    if (G.fac && typeof G.fac.issueGuide === 'function') { try { g = G.fac.issueGuide(data); } catch (e) { if (e instanceof G.RuleError) throw e; g = null; } }
    if (!g) {
      const n = G.series.next(G.series.for('DISPATCH_GUIDE', o.brand_id) || 'T001');
      g = db.insert('dispatch_guides', Object.assign({ company_id: 'co-dg', series_id: n.series_id, series: n.series, number: n.number, full_number: n.full, status: 'ISSUED', sunat_status: 'ACCEPTED', lines: o.lines.map(l => ({ variant_id: l.variant_id, description: G.variantName(l.variant_id), qty: l.qty })) }, data));
      G.events.emit('guide.issued', { guide_id: g.id, order_id: o.id, full_number: g.full_number });
    }
    db.update('province_shipments', sh.id, { dispatch_guide_id: g.id });
    return g;
  };
  D.handToAgency = function (shId, { tracking_number } = {}) {
    const sh = db.get('province_shipments', shId); const o = order(sh.order_id);
    const tn = tracking_number || sh.tracking_number;
    if (!sh.dispatch_guide_id) G.fail('RN-DEL-12', `El envío del pedido ${o.number} no tiene guía de remisión electrónica: emítela (FAC) antes de entregarlo a la agencia.`);
    if (!tn) G.fail('RN-DEL-12', 'Registra el número de seguimiento que dio la agencia.');
    if (sh.status !== 'PREPARED') G.fail('RN-DEL-12', 'El envío ya fue entregado a la agencia.');
    db.update('province_shipments', sh.id, { tracking_number: tn, status: 'HANDED_TO_AGENCY', handed_at: G.date.now() });
    // flete y empaque se cargan al costo del pedido
    if (sh.freight_cost) D.addCost({ cost_date: G.TODAY, cost_type: 'PROVINCE_FREIGHT', amount: sh.freight_cost, supplier_id: sh.agency_supplier_id, zone_id: 'dz-PROVINCIA', order_id: o.id, notes: `Flete ${o.number}` }, { silent: true });
    if (sh.packaging_cost) D.addCost({ cost_date: G.TODAY, cost_type: 'PACKAGING', amount: sh.packaging_cost, zone_id: 'dz-PROVINCIA', order_id: o.id, notes: `Empaque térmico ${o.number}` }, { silent: true });
    if (G.orders.canTransition(o, 'IN_ROUTE')) G.orders.transition(o, 'IN_ROUTE', { reason: `Entregado a ${G.supName(sh.agency_supplier_id)} · guía de agencia ${tn}` });
    return db.get('province_shipments', sh.id);
  };
  D.shipmentStatus = function (shId, status) {
    const sh = db.get('province_shipments', shId); const o = order(sh.order_id);
    const flow = { HANDED_TO_AGENCY: ['IN_TRANSIT', 'LOST'], IN_TRANSIT: ['DELIVERED', 'RETURNED', 'LOST'] };
    if (!(flow[sh.status] || []).includes(status)) G.fail('RN-DEL-12', `No se pasa de «${PST[sh.status][0]}» a «${PST[status][0]}».`);
    db.update('province_shipments', sh.id, Object.assign({ status }, status === 'DELIVERED' ? { delivered_at: G.date.now() } : {}));
    if (status === 'DELIVERED' && G.orders.canTransition(o, 'DELIVERED')) G.orders.transition(o, 'DELIVERED', { reason: 'Recogido en la agencia de destino' });
    return db.get('province_shipments', sh.id);
  };

  /* ------------------------------------------------------------------
     Costos de reparto (RN-DEL-13)
     ------------------------------------------------------------------ */
  D.addCost = function (c, opts = {}) {
    if (!c.cost_date || !c.cost_type || c.amount === '' || c.amount == null || isNaN(c.amount)) G.fail('RN-DEL-13', 'Todo costo lleva fecha, tipo y monto.');
    if (Number(c.amount) < 0) G.fail('RN-DEL-13', 'El monto no puede ser negativo.');
    if (!c.route_id && !c.vehicle_id && !c.employee_id && !c.supplier_id && !c.zone_id && !c.order_id && !c.employee_ref) G.fail('RN-DEL-13', 'Indica al menos un destino: ruta, vehículo, repartidor, empresa de delivery o zona.');
    let kmpg = null;
    if (c.cost_type === 'FUEL') {
      const veh = c.vehicle_id || (c.route_id && (db.get('delivery_routes', c.route_id) || {}).vehicle_id);
      if (!veh) G.fail('RN-DEL-13', 'El combustible exige el vehículo.');
      if (!(Number(c.fuel_gallons) > 0)) G.fail('RN-DEL-13', 'El combustible exige los galones cargados.');
      if (!c.fuel_voucher_no) G.fail('RN-DEL-13', 'El combustible exige el número de vale o comprobante.');
      c.vehicle_id = veh;
      if (c.odometer_km) {
        const prev = db.where('delivery_costs', x => x.cost_type === 'FUEL' && x.vehicle_id === veh && x.odometer_km && x.cost_date <= c.cost_date && x.status !== 'VOIDED').sort((a, b) => b.odometer_km - a.odometer_km)[0];
        if (prev && Number(c.odometer_km) < prev.odometer_km) G.fail('RN-DEL-13', `El odómetro (${F.num(c.odometer_km, 1)}) es menor que el de la carga anterior (${F.num(prev.odometer_km, 1)}).`);
        if (prev) kmpg = R((Number(c.odometer_km) - prev.odometer_km) / Number(c.fuel_gallons), 1);
      }
    }
    if (!G._seeding && !opts.noPeriod) G.period.assertOpen(c.cost_date);
    const row = db.insert('delivery_costs', Object.assign({ vehicle_id: null, route_id: null, employee_id: null, supplier_id: null, zone_id: null, fuel_gallons: null, fuel_voucher_no: null, odometer_km: null, expense_id: null, notes: null, status: 'ACTIVE', km_per_gal: kmpg, registered_by: G._seeding ? 'Raúl Chávez Ortiz' : G.ctx.userName() }, c, { amount: R(Number(c.amount)), fuel_gallons: c.fuel_gallons ? Number(c.fuel_gallons) : null, odometer_km: c.odometer_km ? Number(c.odometer_km) : null }), { silent: !!opts.silent });
    return row;
  };
  D.voidCost = function (id, reason) {
    if (!reason) G.fail('RN-DEL-13', 'Anular un costo exige motivo.');
    const c = db.get('delivery_costs', id); G.period.assertOpen(c.cost_date);
    return db.update('delivery_costs', id, { status: 'VOIDED', void_reason: reason });
  };
  D.costDest = c => [c.route_id && ('Ruta ' + ((db.get('delivery_routes', c.route_id) || {}).code || '')), c.vehicle_id && ('Vehículo ' + ((D.vehicle(c.vehicle_id) || {}).plate || '')), c.employee_id && ('Repartidor ' + ((db.get('employees', c.employee_id) || {}).full_name || '').split(' ')[0]), c.supplier_id && G.supName(c.supplier_id), c.zone_id && ('Zona ' + G.zoneName(c.zone_id)), c.order_id && ('Pedido ' + ((order(c.order_id) || {}).number || ''))].filter(Boolean).join(' · ') || '—';

  /* ------------------------------------------------------------------
     Reparto del costo por entrega (RN-DEL-14, RN-DEL-15)
     Para cada vehículo y mes, en cada rubro (combustible, mantenimiento,
     alquiler, peajes y cochera, seguros, depreciación, multas) se usan los
     registros de FLO cuando existen y los de DEL si no; el combustible sin
     registros se estima por km (G.geo.routeKm) y rendimiento esperado.
     ------------------------------------------------------------------ */
  D.FUEL_PRICE = { GASOLINE: 17.2, DIESEL: 16.4, GLP: 8.1, GNV: 4.2 };
  D.expectedKmpg = v => { const p = db.find('vehicle_profiles', x => x.vehicle_id === v.id); return (p && p.expected_km_per_gal) || ({ MOTO: 70, VAN: 32, CAR: 40, TRUCK: 18 }[v.vehicle_type] || 40); };
  const rubroDEL = c => c.cost_type === 'FUEL' ? 'FUEL' : /^MAINTENANCE/.test(c.cost_type) ? 'MAINT' : c.cost_type === 'RENT' ? 'RENT' : ['TOLL', 'PARKING'].includes(c.cost_type) ? 'TOLLPARK' : ['SOAT', 'TECH_INSPECTION'].includes(c.cost_type) ? 'INSUR' : c.cost_type === 'FINE' ? 'FINES' : (c.cost_type === 'OTHER' && c.subtype === 'DEPRECIATION') ? 'DEPREC' : null;
  const bucketOf = (type, source) => source === 'FLO' ? 'vehicle' : ['DRIVER_WAGE', 'DRIVER_MEAL', 'DRIVER_TRANSPORT', 'DELIVERY_BONUS'].includes(type) ? 'driver' : type === 'CARRIER_FEE' ? 'carrier' : ['TOLL', 'PARKING'].includes(type) ? 'direct' : ['FUEL', 'MAINTENANCE_PREVENTIVE', 'MAINTENANCE_CORRECTIVE', 'RENT', 'SOAT', 'TECH_INSPECTION', 'FINE'].includes(type) ? 'vehicle' : 'other';
  D.RUBROS = { FUEL: 'Combustible', MAINT: 'Mantenimiento', RENT: 'Alquiler', TOLLPARK: 'Peajes y cochera', INSUR: 'Seguros e impuestos', FINES: 'Multas', DEPREC: 'Depreciación', OTHERV: 'Otros del vehículo' };
  /** costos del período listos para repartir: [{source, type, rubro, bucket, amount, route_id, vehicle_id, employee_id, supplier_id, zone_id, label}] */
  D.costItems = function (period) {
    const from = G.date.month(period), to = monthEnd(from);
    const routes = db.where('delivery_routes', r => r.route_date >= from && r.route_date <= to && r.status !== 'CANCELLED');
    const rmap = new Map(routes.map(r => [r.id, r]));
    const items = [], replaced = [], flo = [];
    const inP = d => d && String(d).slice(0, 10) >= from && String(d).slice(0, 10) <= to;
    // FLO (si hay registros)
    for (const f of db.where('fuel_loads', x => inP(x.loaded_at) && x.status !== 'VOIDED')) flo.push({ source: 'FLO', type: 'FUEL', rubro: 'FUEL', amount: f.amount, vehicle_id: f.vehicle_id, label: `Carga ${F.num(f.gallons, 3)} gal` });
    for (const m of db.where('vehicle_maintenances', x => x.status === 'DONE' && inP(x.done_on))) flo.push({ source: 'FLO', type: m.kind === 'PREVENTIVE' ? 'MAINTENANCE_PREVENTIVE' : 'MAINTENANCE_CORRECTIVE', rubro: 'MAINT', amount: R((m.parts_amount || 0) + (m.labor_amount || 0)), vehicle_id: m.vehicle_id, label: m.description });
    const vcR = { RENT: 'RENT', TOLL: 'TOLLPARK', PARKING: 'TOLLPARK', INSURANCE: 'INSUR', TAX: 'INSUR', DEPRECIATION: 'DEPREC', WASH: 'OTHERV', TIRES: 'OTHERV', OTHER: 'OTHERV' };
    for (const c of db.where('vehicle_costs', x => inP(x.cost_date) && x.status !== 'VOIDED')) flo.push({ source: 'FLO', type: c.cost_type, rubro: vcR[c.cost_type] || 'OTHERV', amount: c.amount, vehicle_id: c.vehicle_id, label: c.notes || c.cost_type });
    for (const f of db.where('traffic_fines', x => inP(x.fine_date) && !x.charged_to_driver && !['VOIDED', 'APPEALED'].includes(x.status))) flo.push({ source: 'FLO', type: 'FINE', rubro: 'FINES', amount: f.paid_amount || R(f.amount - (f.discount_amount || 0)), vehicle_id: f.vehicle_id, label: 'Multa ' + f.ballot_number });
    const floHas = new Set(flo.map(x => x.vehicle_id + '|' + x.rubro));
    items.push(...flo.filter(x => x.amount > 0));
    // DEL
    for (const c of db.where('delivery_costs', x => inP(x.cost_date) && x.status !== 'VOIDED' && !['PROVINCE_FREIGHT', 'PACKAGING'].includes(x.cost_type))) {
      const veh = c.vehicle_id || (c.route_id && (rmap.get(c.route_id) || db.get('delivery_routes', c.route_id) || {}).vehicle_id) || null;
      const rb = rubroDEL(c);
      const it = { source: 'DEL', id: c.id, type: c.cost_type, rubro: rb, amount: c.amount, route_id: c.route_id, vehicle_id: c.vehicle_id || (rb ? veh : null), employee_id: c.employee_id || null, supplier_id: c.supplier_id && c.cost_type === 'CARRIER_FEE' ? c.supplier_id : (c.cost_type === 'CARRIER_FEE' ? c.supplier_id : null), zone_id: c.zone_id, label: D.costName(c.cost_type, c.subtype) + (c.notes ? ' · ' + c.notes : '') };
      if (rb && veh && floHas.has(veh + '|' + rb)) { replaced.push(it); continue; }
      items.push(it);
    }
    // combustible estimado por km cuando el vehículo no tiene cargas ni vales en el mes
    const hasFuel = new Set(items.filter(x => x.rubro === 'FUEL').map(x => x.vehicle_id));
    const estimated = [];
    for (const r of routes) {
      if (!routeIsDriveable(r) || !r.vehicle_id || hasFuel.has(r.vehicle_id)) continue;
      const v = D.vehicle(r.vehicle_id); if (!v) continue;
      const km = D.routeKm(r); if (!(km > 0)) continue;
      const kmpg = D.expectedKmpg(v), price = D.FUEL_PRICE[v.fuel_type] || 17;
      const it = { source: 'EST', type: 'FUEL', rubro: 'FUEL', amount: R(km / kmpg * price, 4), route_id: r.id, vehicle_id: v.id, label: `Estimado ${F.num(km, 1)} km ÷ ${kmpg} km/gal × ${F.money(price)}` };
      items.push(it); estimated.push(it);
    }
    // empresas de delivery: facturas registradas o, si no hay, la tarifa por envío
    const supWithFee = new Set(items.filter(x => x.type === 'CARRIER_FEE' && x.supplier_id).map(x => x.supplier_id));
    for (const r of routes) {
      if (r.mode !== 'THIRD_PARTY' || !r.carrier_supplier_id || supWithFee.has(r.carrier_supplier_id)) continue;
      const ss = db.where('delivery_stops', s => s.route_id === r.id && ['DELIVERED', 'FAILED'].includes(s.status));
      const amt = U.sum(ss, s => D.expectedFor(r.carrier_supplier_id, { s, r, o: order(s.order_id) }));
      if (amt > 0) items.push({ source: 'TARIFA', type: 'CARRIER_FEE', rubro: null, amount: R(amt, 4), route_id: r.id, supplier_id: r.carrier_supplier_id, label: `Tarifa ${G.supName(r.carrier_supplier_id)} × ${ss.length} envíos` });
    }
    for (const it of items) it.bucket = bucketOf(it.type, it.source);
    return { items, replaced, estimated, routes, rmap };
  };
  D.runs = period => { const p = G.date.month(period); const rows = db.where('delivery_cost_allocations', a => a.period === p); return [...new Set(rows.map(a => a.run_no))].sort((a, b) => a - b); };
  D.latestRun = period => { const rs = D.runs(period); return rs.length ? rs[rs.length - 1] : null; };
  D.allocRows = (period, run) => { const p = G.date.month(period); const n = run || D.latestRun(p); return n ? db.where('delivery_cost_allocations', a => a.period === p && a.run_no === n) : []; };
  /** corrida de reparto: crea una nueva corrida de solo inserción (RN-DEL-14) */
  D.allocate = function (period, opts = {}) {
    const p = G.date.month(period);
    if (!G._seeding && !opts.force && G.period.isClosed(p)) G.fail('RN-PLT-05', `El período ${G.date.monthName(p)} está cerrado: no se recalcula el costo por entrega.`);
    const method = opts.method || G.param('del_cost_split_method') || 'EQUAL';
    const { items, replaced, estimated, routes, rmap } = D.costItems(p);
    const stops = db.where('delivery_stops', s => s.status === 'DELIVERED' && rmap.has(s.route_id));
    const info = stops.map(s => { const r = rmap.get(s.route_id); const o = order(s.order_id); return { s, r, o, kg: s.kg ?? D.orderKg(o), acc: { direct: 0, vehicle: 0, driver: 0, carrier: 0, other: 0 } }; });
    const idx = { route: new Map(), vehicle: new Map(), employee: new Map(), supplier: new Map(), zone: new Map() };
    const push = (m, k, x) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(x); };
    for (const x of info) { push(idx.route, x.r.id, x); push(idx.vehicle, x.r.vehicle_id, x); push(idx.employee, x.r.driver_employee_id, x); push(idx.supplier, x.r.carrier_supplier_id, x); push(idx.zone, x.s.zone_id, x); }
    let unassigned = 0;
    for (const it of items) {
      let tg = (it.route_id && idx.route.get(it.route_id)) || (it.vehicle_id && idx.vehicle.get(it.vehicle_id)) || (it.employee_id && idx.employee.get(it.employee_id)) || (it.supplier_id && idx.supplier.get(it.supplier_id)) || (it.zone_id && idx.zone.get(it.zone_id)) || null;
      if (!tg && it.route_id) { const r = rmap.get(it.route_id); tg = (r && r.vehicle_id && idx.vehicle.get(r.vehicle_id)) || (r && r.carrier_supplier_id && idx.supplier.get(r.carrier_supplier_id)) || null; }
      if (!tg) { tg = info; if (it.route_id || it.vehicle_id || it.employee_id || it.supplier_id || it.zone_id) unassigned += it.amount; }
      if (!tg.length) continue;
      const tw = method === 'KG' ? U.sum(tg, x => x.kg) : tg.length;
      for (const x of tg) { const w = method === 'KG' && tw > 0 ? x.kg / tw : 1 / tg.length; x.acc[it.bucket] += it.amount * w; }
    }
    const run_no = (D.latestRun(p) || 0) + 1; const rows = [];
    for (const x of info) {
      const a = x.acc; const total = R(a.direct + a.vehicle + a.driver + a.carrier + a.other, 4); const fee = x.o ? (x.o.delivery_fee || 0) : 0;
      rows.push(db.insert('delivery_cost_allocations', { period: p, run_no, stop_id: x.s.id, route_id: x.r.id, order_id: x.s.order_id, zone_id: x.s.zone_id, mode: x.r.mode, direct_cost: R(a.direct, 4), vehicle_cost: R(a.vehicle, 4), driver_cost: R(a.driver, 4), carrier_cost: R(a.carrier, 4), other_cost: R(a.other, 4), total_cost: total, kg_delivered: R(x.kg, 3), fee_charged: fee, subsidy: R(total - fee, 4), method, run_at: G.date.now(), run_by: G._seeding ? 'Sistema' : G.ctx.userName() }, { silent: true }));
    }
    G.events.emit('delivery_cost.allocated', { period: p, run_no, deliveries: rows.length, total: R(U.sum(rows, r => r.total_cost)) });
    return { run_no, rows, items, replaced, estimated, unassigned: R(unassigned) };
  };
  /** resumen de la última corrida por clave (zona, modalidad, vehículo, repartidor, ruta) */
  D.summary = function (period, keyFn) {
    const rows = D.allocRows(period); const g = new Map();
    const routes = new Map();
    for (const a of rows) {
      const r = routes.get(a.route_id) || db.get('delivery_routes', a.route_id); routes.set(a.route_id, r);
      const k = keyFn(a, r); if (k == null) continue;
      const x = g.get(k) || { key: k, cost: 0, n: 0, kg: 0, fee: 0, subsidy: 0, vehicle: 0, driver: 0, carrier: 0, direct: 0, other: 0, routes: new Set() };
      x.cost += a.total_cost; x.n++; x.kg += a.kg_delivered; x.fee += a.fee_charged; x.subsidy += a.subsidy; x.vehicle += a.vehicle_cost; x.driver += a.driver_cost; x.carrier += a.carrier_cost; x.direct += a.direct_cost; x.other += a.other_cost; x.routes.add(a.route_id);
      g.set(k, x);
    }
    return [...g.values()].map(x => { const km = U.sum([...x.routes].map(id => routes.get(id)).filter(r => r && routeIsDriveable(r)), r => D.routeKm(r)); return Object.assign(x, { km: R(km, 1), cpd: x.n ? R(x.cost / x.n) : 0, cpk: x.kg ? R(x.cost / x.kg) : 0, cpkm: km ? R(x.cost / km) : null }); }).sort((a, b) => b.cost - a.cost);
  };
  /** comparación de una zona: costo propio por entrega frente a la tarifa del tercero (CA-DEL-06) */
  D.compareRow = function ({ own, rented, carrier_rate }) {
    const base = own != null ? own : rented;
    if (base == null || carrier_rate == null) return { diff: null, suggestion: 'SIN_DATOS', text: base == null ? 'Sin entregas propias en el período' : 'Sin tarifa de tercero para la zona' };
    const diff = R(base - carrier_rate);
    if (diff > 0 && diff / base >= 0.1) return { diff, suggestion: 'EVALUAR_TERCERIZAR', text: `Evaluar tercerizar la zona: el reparto propio cuesta ${F.money(diff)} más por entrega` };
    if (diff < 0) return { diff, suggestion: 'MANTENER_PROPIO', text: `Mantener reparto propio: ahorra ${F.money(-diff)} por entrega frente al tercero` };
    return { diff, suggestion: 'SIMILAR', text: 'Costos similares: decidir por servicio y control' };
  };
  D.zoneComparison = function (period) {
    const p = G.date.month(period); const end = monthEnd(p);
    const s = D.summary(p, (a) => a.zone_id + '|' + a.mode);
    const zones = db.where('delivery_zones', z => !z.province);
    const carrier = D.carriers().find(c => !/provincia/i.test(c.trade_name)) || D.carriers()[0];
    return zones.map(z => {
      const get = m => s.find(x => x.key === z.id + '|' + m);
      const own = get('OWN'), ren = get('RENTED'), thr = get('THIRD_PARTY');
      const rate = carrier ? D.rateFor(carrier.id, z.id, end) : null;
      const cr = rate && rate.rate_basis === 'PER_DELIVERY' ? rate.amount : null;
      const cmp = D.compareRow({ own: own ? own.cpd : null, rented: ren ? ren.cpd : null, carrier_rate: cr });
      return { zone: z, own, rented: ren, third: thr, carrier, carrier_rate: cr, ...cmp };
    });
  };

  /* ------------------------------------------------------------------
     Reloj de la demo y línea de tiempo de una ruta (la usa FLO)
     ------------------------------------------------------------------ */
  D.DEMO_NOW = G.TODAY + 'T11:20';
  D.now = () => { const n = G.date.now().slice(0, 16); return n > D.DEMO_NOW ? n : D.DEMO_NOW; };
  /** puntos de paso con hora: salida, paradas cerradas, posición actual (en ruta) y vuelta */
  D.timeline = function (r, now = D.now()) {
    if (!r.departed_at) return [];
    const site = D.sitePt(r.establishment_id); const kp = [{ at: r.departed_at.slice(0, 16), pt: site, kind: 'DEPARTED' }];
    let last = site, lastAt = r.departed_at.slice(0, 16);
    const stops = D.activeStops(r.id);
    for (const s of stops) {
      if (!['DELIVERED', 'FAILED'].includes(s.status) || !s.closed_at) continue;
      const pt = D.orderPt(order(s.order_id));
      const arr = (s.arrived_at || tsAdd(s.closed_at, -4)).slice(0, 16);
      kp.push({ at: arr, pt, kind: 'ARRIVED', seq: s.seq }); kp.push({ at: s.closed_at.slice(0, 16), pt, kind: s.status, seq: s.seq });
      last = pt; lastAt = s.closed_at.slice(0, 16);
    }
    if (r.status === 'IN_ROUTE') {
      const next = stops.find(s => ['PENDING', 'ARRIVED'].includes(s.status));
      if (next && next.status === 'ARRIVED') kp.push({ at: now, pt: D.orderPt(order(next.order_id)), kind: 'NOW' });
      else if (next && now > lastAt) { const to = D.orderPt(order(next.order_id)); const travel = Math.max(6, G.geo.km(last, to) * 1.35 / 22 * 60); const f = Math.min(0.85, minutesBetween(lastAt, now) / travel); kp.push({ at: now, pt: [last[0] + (to[0] - last[0]) * f, last[1] + (to[1] - last[1]) * f], kind: 'NOW' }); }
    } else if (r.returned_at) kp.push({ at: r.returned_at.slice(0, 16), pt: site, kind: 'RETURNED' });
    return kp;
  };
  D.lastPosition = function (r) {
    const ev = db.where('delivery_events', e => e.route_id === r.id && e.lat != null).sort(U.by('occurred_at', -1))[0];
    if (ev) return { lat: ev.lat, lng: ev.lng, at: ev.occurred_at, kind: ev.event_type };
    const kp = D.timeline(r); const l = kp[kp.length - 1]; return l ? { lat: l.pt[0], lng: l.pt[1], at: l.at, kind: l.kind } : null;
  };

  /* ------------------------------------------------------------------
     Datos de ejemplo (orden 28): rutas de setiembre y octubre, hoy en curso
     ------------------------------------------------------------------ */
  G.seed(28, function seedDEL() {
    const r = U.rng(2828);
    const tok = n => { const c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < n; i++) s += c[Math.floor(r() * c.length)]; return s; };
    const ins = (t, row) => db.insert(t, row, { silent: true });
    const users = db.all('users');
    const drv = n => users.find(u => u.role === 'REPARTIDOR' && u.name.startsWith(n));
    const pedro = drv('Pedro'), hugo = drv('Hugo'), julio = drv('Julio');
    if (!pedro || !hugo || !julio) return;
    const sup = n => db.find('suppliers', s => s.trade_name === n);
    const express = sup('Express Lima'), andinos = sup('Andinos Cargo (provincia)');
    const rental = db.find('suppliers', s => s.supplier_type === 'VEHICLE_RENTAL');
    // revisión técnica de las motos (RN-DEL-03 la exige) y estado
    for (const [id, d] of [['ve-MTA-123', 212], ['ve-MTB-456', 148], ['ve-MTC-789', 96]]) { const v = db.get('vehicles', id); if (v && !v.tech_inspection_expires_on) v.tech_inspection_expires_on = G.date.add(G.TODAY, d); }
    const VEH = { P: 've-MTA-123', H: 've-BXR-871', J: 've-MTC-789', CA: 've-MTB-456' };
    const PAY = { P: ['DAILY', 80], H: ['DAILY', 90], J: ['PER_DELIVERY', 6] };
    const DRV = { P: pedro, H: hugo, J: julio, CA: pedro };
    // tarifas de terceros (D-DEL-01: por envío sin zona; La Molina con tarifa propia desde octubre)
    if (express) {
      ins('carrier_rates', { supplier_id: express.id, zone_id: null, rate_basis: 'PER_DELIVERY', amount: 8.5, valid_from: '2026-03-01', valid_to: '2026-07-31', status: 'ACTIVE' });
      ins('carrier_rates', { supplier_id: express.id, zone_id: null, rate_basis: 'PER_DELIVERY', amount: 9, valid_from: '2026-08-01', valid_to: null, status: 'ACTIVE' });
      ins('carrier_rates', { supplier_id: express.id, zone_id: 'dz-LA-MOLINA', rate_basis: 'PER_DELIVERY', amount: 11, valid_from: '2026-10-01', valid_to: null, status: 'ACTIVE' });
    }
    if (andinos) ins('carrier_rates', { supplier_id: andinos.id, zone_id: 'dz-PROVINCIA', rate_basis: 'PER_KG', amount: 3.5, valid_from: '2026-07-01', valid_to: null, status: 'ACTIVE' });

    const slotNo = o => o.slot_id ? Number(String(o.slot_id).split('-').pop()) : 1;
    const orders = db.all('sales_orders');
    const byDay = new Map();
    for (const o of orders) {
      if (o.fulfillment !== 'DELIVERY' || !['DELIVERED', 'CLOSED'].includes(o.status) || !o.delivered_at) continue;
      const d = o.delivered_at.slice(0, 10); if (d >= G.TODAY) continue;
      if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(o);
    }
    const days = [...byDay.keys()].sort();
    const routes = []; // {row, stops:[...], key}
    let expressSept = 0;
    const mkRoute = (d, est, sn, code, mode, who, os, opts = {}) => {
      if (!os.length) return null;
      const slot = db.get('order_time_slots', `ts-${est.slice(3)}-${sn}`) || {};
      const site = D.sitePt(est);
      const seqd = D.nearest(site, os, o => D.orderPt(o));
      const depart = d + 'T' + tsAdd('2000-01-01T' + (slot.slot_from || '09:00'), -25).slice(11, 16);
      const vehicle = who === 'X' ? null : VEH[who]; const dr = who === 'X' ? null : DRV[who];
      const pay = PAY[who === 'CA' ? 'P' : who];
      const row = ins('delivery_routes', { code, route_date: d, establishment_id: est, slot_from: slot.slot_from || null, slot_to: slot.slot_to || null, mode, vehicle_id: vehicle, driver_user_id: dr ? dr.id : null, driver_employee_id: dr ? dr.employee_id : null, carrier_supplier_id: who === 'X' ? express.id : null, sequence_method: 'NEAREST_NEIGHBOR', planned_km: G.geo.routeKm([site, ...seqd.map(o => D.orderPt(o)), site]), odometer_start: null, odometer_end: null, status: opts.status || 'SETTLED', departed_at: depart, returned_at: null, driver_pay_mode: pay ? pay[0] : null, driver_pay_rate: pay ? pay[1] : null, created_at: tsAdd(depart, -90) });
      let t = depart, cur = site; const stops = [];
      seqd.forEach((o, i) => {
        const pt = D.orderPt(o); const km = G.geo.km(cur, pt) * 1.35; t = tsAdd(t, km / 22 * 60 + (i ? 7 : 0) + Math.floor(r() * 5)); cur = pt;
        const pay = (o.payment_ids || []).map(id => db.get('payments', id)).find(p => p && ['pm-CASH', 'pm-CARD'].includes(p.payment_method_id));
        const far = r() < 0.03;
        const s = ins('delivery_stops', { route_id: row.id, order_id: o.id, seq: i + 1, zone_id: o.zone_id, eta: t, status: 'DELIVERED', cod_amount: pay ? pay.amount : 0, collected_amount: pay ? pay.amount : 0, delivery_code: String(1000 + Math.floor(r() * 9000)), pod_distance_m: R(far ? 310 + r() * 320 : 6 + r() * 230, 1), arrived_at: tsAdd(t, -4), closed_at: t, distance_km: R(km, 2), bags: D.virtualBags(o).map(b => Object.assign(b, { status: 'DELIVERED' })), kg: D.orderKg(o), created_at: row.created_at });
        if (dr) o.driver_user_id = dr.id;
        stops.push({ s, o, pay });
      });
      row.returned_at = tsAdd(t, G.geo.km(cur, site) * 1.35 / 22 * 60 + 5);
      const x = { row, stops, who, d, est };
      routes.push(x); return x;
    };
    for (const d of days) {
      const os = byDay.get(d);
      const L1 = os.filter(o => o.establishment_id === 'es-L1'), L2 = os.filter(o => o.establishment_id === 'es-L2');
      const used = new Set();
      // CA-DEL-01: ruta SURCO-B del 12/09 con la moto propia MTB-456, 10 entregas (una gratis y una con S/ 10)
      if (d === '2026-09-12') {
        const pri = z => { const i = ['dz-SURCO-B', 'dz-SURCO-A', 'dz-SAN-BORJA', 'dz-MIRAFLORES', 'dz-BARRANCO', 'dz-SAN-ISIDRO', 'dz-JESUS-MARIA'].indexOf(z); return i < 0 ? 99 : i; };
        const cand = L1.filter(o => o.zone_id !== 'dz-LA-MOLINA').sort((a, b) => pri(a.zone_id) - pri(b.zone_id) || a.number.localeCompare(b.number));
        const pick = cand.slice(0, 10);
        const ensure = (pred, at) => { if (!pick.some(pred)) { const alt = cand.slice(10).find(pred); if (alt) pick[at] = alt; } };
        ensure(o => o.delivery_fee === 0, 9); ensure(o => o.delivery_fee === 10, 8);
        pick.forEach(o => used.add(o.id));
        mkRoute(d, 'es-L1', 1, 'SURCO-B', 'OWN', 'CA', pick);
      }
      const third = L1.filter(o => !used.has(o.id) && (d < '2026-10-01' ? (o.zone_id === 'dz-LA-MOLINA' && expressSept < 40) : ['dz-LA-MOLINA', 'dz-JESUS-MARIA'].includes(o.zone_id)));
      const thirdTake = d < '2026-10-01' ? third.slice(0, 40 - expressSept) : third;
      if (express && thirdTake.length) { thirdTake.forEach(o => used.add(o.id)); if (d < '2026-10-01') expressSept += thirdTake.length; mkRoute(d, 'es-L1', Math.min(...thirdTake.map(slotNo)), D.routeCode(d, 'es-L1', Math.min(...thirdTake.map(slotNo)), 'EXP'), 'THIRD_PARTY', 'X', thirdTake); }
      for (const sn of [1, 2, 3]) {
        const rest = L1.filter(o => !used.has(o.id) && slotNo(o) === sn);
        const p = rest.filter(o => o.driver_user_id === pedro.id && d !== '2026-09-12'), hh = rest.filter(o => !p.includes(o));
        mkRoute(d, 'es-L1', sn, `L1-F${sn}-MOTO1`, 'OWN', 'P', p);
        mkRoute(d, 'es-L1', sn, `L1-F${sn}-FURG1`, 'OWN', 'H', hh);
        mkRoute(d, 'es-L2', sn, `L2-F${sn}-MOTO3`, 'RENTED', 'J', L2.filter(o => slotNo(o) === sn));
      }
    }
    // intentos fallidos del día anterior (RN-DEL-07): el pedido se reprogramó y se entregó al día siguiente
    const FAILS = ['CUSTOMER_ABSENT', 'CUSTOMER_ABSENT', 'WRONG_ADDRESS', 'OUT_OF_SLOT', 'NO_PAYMENT', 'REFUSED'];
    for (const x of routes.slice()) {
      if (x.who === 'X' || x.who === 'CA') continue;
      for (const st of x.stops) {
        if (r() > 0.018) continue;
        const prevDay = G.date.add(x.d, -1);
        const prev = routes.find(y => y.d === prevDay && y.who === x.who && y.est === x.est);
        if (!prev) continue;
        const last = prev.stops[prev.stops.length - 1].s;
        const at = tsAdd(last.closed_at, 12);
        const reason = U.pick(r, FAILS);
        const fs = ins('delivery_stops', { route_id: prev.row.id, order_id: st.o.id, seq: prev.stops.length + 1, zone_id: st.o.zone_id, eta: at, status: 'FAILED', cod_amount: st.s.cod_amount, collected_amount: 0, delivery_code: String(1000 + Math.floor(r() * 9000)), pod_distance_m: null, arrived_at: tsAdd(at, -5), closed_at: at, distance_km: 2.1, bags: D.virtualBags(st.o).map(b => Object.assign(b, { status: 'RETURNED' })), kg: D.orderKg(st.o), fail_reason: reason, bags_returned: true, rescheduled_to: x.d, created_at: prev.row.created_at });
        prev.stops.push({ s: fs, o: st.o, failed: true, reason });
        prev.row.returned_at = tsAdd(at, 25);
      }
    }

    /* --- hoy: rutas en curso, una cargando, una de tercero y pedidos sin asignar --- */
    const today = orders.filter(o => o.delivery_date === G.TODAY && o.fulfillment === 'DELIVERY');
    const todayRoutes = [];
    const mkToday = (who, code, est, list, depart) => {
      const dr = DRV[who]; const site = D.sitePt(est);
      const del = D.nearest(site, list.filter(o => o.status === 'DELIVERED'), o => D.orderPt(o));
      const pend = D.nearest(del.length ? D.orderPt(del[del.length - 1]) : site, list.filter(o => o.status === 'IN_ROUTE'), o => D.orderPt(o));
      const seqd = del.concat(pend); if (!seqd.length) return null;
      const row = ins('delivery_routes', { code, route_date: G.TODAY, establishment_id: est, slot_from: '09:00', slot_to: '20:00', mode: who === 'J' ? 'RENTED' : 'OWN', vehicle_id: VEH[who], driver_user_id: dr.id, driver_employee_id: dr.employee_id, carrier_supplier_id: null, sequence_method: 'NEAREST_NEIGHBOR', planned_km: G.geo.routeKm([site, ...seqd.map(o => D.orderPt(o)), site]), odometer_start: null, odometer_end: null, status: 'IN_ROUTE', departed_at: G.TODAY + 'T' + depart, returned_at: null, driver_pay_mode: PAY[who][0], driver_pay_rate: PAY[who][1], created_at: G.TODAY + 'T07:40' });
      const gap = del.length ? Math.min(28, minutesBetween(row.departed_at, G.TODAY + 'T11:00') / del.length) : 0;
      let t = row.departed_at, cur = site; const stops = [];
      seqd.forEach((o, i) => {
        const pt = D.orderPt(o); const km = G.geo.km(cur, pt) * 1.35; cur = pt;
        const done = o.status === 'DELIVERED';
        t = done ? tsAdd(t, Math.max(8, gap)) : tsAdd(t, km / 22 * 60 + 7);
        const pay = (o.payment_ids || []).map(id => db.get('payments', id)).find(p => p && ['pm-CASH', 'pm-CARD'].includes(p.payment_method_id));
        const cod = ['pm-CASH', 'pm-CARD'].includes(o.payment_method_id) ? (done ? (pay ? pay.amount : 0) : Math.max(0, R(D.orderTotal(o) - (o.paid_amount || 0)))) : 0;
        const s = ins('delivery_stops', { route_id: row.id, order_id: o.id, seq: i + 1, zone_id: o.zone_id, eta: t, status: done ? 'DELIVERED' : 'PENDING', cod_amount: cod, collected_amount: done ? cod : 0, delivery_code: String(1000 + Math.floor(r() * 9000)), pod_distance_m: done ? R(8 + r() * 180, 1) : null, arrived_at: done ? tsAdd(t, -4) : null, closed_at: done ? t : null, distance_km: R(km, 2), bags: D.virtualBags(o).map(b => Object.assign(b, { status: done ? 'DELIVERED' : 'LOADED', loaded_at: G.TODAY + 'T08:10', loaded_by: 'Miguel Torres Ayala' })), kg: D.orderKg(o), created_at: row.created_at });
        o.driver_user_id = dr.id;
        stops.push({ s, o, pay, done });
      });
      const x = { row, stops, who, d: G.TODAY, est, today: true }; routes.push(x); todayRoutes.push(x); return x;
    };
    const inRoute = today.filter(o => ['IN_ROUTE', 'DELIVERED'].includes(o.status) && o.driver_user_id);
    mkToday('P', 'L1-HOY-MOTO1', 'es-L1', inRoute.filter(o => o.driver_user_id === pedro.id), '08:35');
    mkToday('H', 'L1-HOY-FURG1', 'es-L1', inRoute.filter(o => o.driver_user_id === hugo.id), '08:40');
    mkToday('J', 'L2-HOY-MOTO3', 'es-L2', inRoute.filter(o => o.driver_user_id === julio.id), '08:50');
    // ajustes de hoy: una parada en el lugar, un no entregado, una entrega fuera del radio e incidencias
    const tp = todayRoutes.find(x => x.who === 'P'), th = todayRoutes.find(x => x.who === 'H'), tj = todayRoutes.find(x => x.who === 'J');
    if (tp) { const nx = tp.stops.find(x => !x.done); if (nx) { nx.s.status = 'ARRIVED'; nx.s.arrived_at = G.TODAY + 'T11:14'; } }
    if (th) {
      const pend = th.stops.filter(x => !x.done);
      if (pend.length >= 2) { const f = pend[0]; f.s.status = 'FAILED'; f.s.fail_reason = 'CUSTOMER_ABSENT'; f.s.closed_at = G.TODAY + 'T10:52'; f.s.arrived_at = G.TODAY + 'T10:44'; f.s.bags = f.s.bags.map(b => Object.assign(b, { status: 'RETURNED' })); f.s.bags_returned = false; f.failed = true; f.reason = 'CUSTOMER_ABSENT'; f.o.status = 'NOT_DELIVERED'; f.o.history = (f.o.history || []).concat([{ at: G.TODAY + 'T10:52', from: 'IN_ROUTE', to: 'NOT_DELIVERED', user: hugo.name, reason: 'Cliente ausente · nadie abre, teléfono apagado' }]); }
    }
    if (tj) { const dn = tj.stops.find(x => x.done); if (dn) dn.s.pod_distance_m = 420.5; }
    // ruta de la tarde cargando (bolsas a medias) y ruta de tercero planificada
    const ready = today.filter(o => o.status === 'READY');
    const rL1 = ready.filter(o => o.establishment_id === 'es-L1');
    const loadList = rL1.slice(0, 3), expList = rL1.slice(3, 5);
    if (loadList.length) {
      const site = D.sitePt('es-L1'); const seqd = D.nearest(site, loadList, o => D.orderPt(o));
      const row = ins('delivery_routes', { code: 'L1-F2-MOTO1', route_date: G.TODAY, establishment_id: 'es-L1', slot_from: '13:00', slot_to: '17:00', mode: 'OWN', vehicle_id: VEH.P, driver_user_id: pedro.id, driver_employee_id: pedro.employee_id, carrier_supplier_id: null, sequence_method: 'NEAREST_NEIGHBOR', planned_km: G.geo.routeKm([site, ...seqd.map(o => D.orderPt(o)), site]), odometer_start: null, odometer_end: null, status: 'LOADING', departed_at: null, returned_at: null, driver_pay_mode: 'DAILY', driver_pay_rate: 80, created_at: G.TODAY + 'T10:05' });
      let k = 0;
      seqd.forEach((o, i) => { const bags = D.virtualBags(o).map(b => { k++; return Object.assign(b, k % 2 ? { status: 'LOADED', loaded_at: G.TODAY + 'T11:02', loaded_by: 'Miguel Torres Ayala' } : {}); }); ins('delivery_stops', { route_id: row.id, order_id: o.id, seq: i + 1, zone_id: o.zone_id, eta: null, status: 'PENDING', cod_amount: ['pm-CASH', 'pm-CARD'].includes(o.payment_method_id) ? Math.max(0, R(D.orderTotal(o) - (o.paid_amount || 0))) : 0, collected_amount: 0, delivery_code: null, pod_distance_m: null, arrived_at: null, closed_at: null, distance_km: null, bags, kg: D.orderKg(o), created_at: row.created_at }); });
    }
    if (expList.length && express) {
      const site = D.sitePt('es-L1'); const seqd = D.nearest(site, expList, o => D.orderPt(o));
      const row = ins('delivery_routes', { code: 'L1-F3-EXP', route_date: G.TODAY, establishment_id: 'es-L1', slot_from: '17:00', slot_to: '20:00', mode: 'THIRD_PARTY', vehicle_id: null, driver_user_id: null, driver_employee_id: null, carrier_supplier_id: express.id, sequence_method: 'NEAREST_NEIGHBOR', planned_km: G.geo.routeKm([site, ...seqd.map(o => D.orderPt(o)), site]), odometer_start: null, odometer_end: null, status: 'PLANNED', departed_at: null, returned_at: null, created_at: G.TODAY + 'T10:20' });
      seqd.forEach((o, i) => ins('delivery_stops', { route_id: row.id, order_id: o.id, seq: i + 1, zone_id: o.zone_id, eta: null, status: 'PENDING', cod_amount: ['pm-CASH', 'pm-CARD'].includes(o.payment_method_id) ? Math.max(0, R(D.orderTotal(o) - (o.paid_amount || 0))) : 0, collected_amount: 0, delivery_code: null, pod_distance_m: null, arrived_at: null, closed_at: null, distance_km: null, bags: D.virtualBags(o), kg: D.orderKg(o), created_at: row.created_at }));
    }

    /* --- odómetros consistentes por vehículo (terminan en el odómetro actual) --- */
    const byVeh = U.groupBy(routes.filter(x => x.row.vehicle_id), x => x.row.vehicle_id);
    for (const [vid, list] of Object.entries(byVeh)) {
      const v = db.get('vehicles', vid); list.sort((a, b) => a.row.departed_at.localeCompare(b.row.departed_at));
      const km = list.map(x => x.today ? R(x.row.planned_km * 0.45, 1) : R(x.row.planned_km * (0.97 + r() * 0.1) + 1.2, 1));
      let cur = R(v.odometer_km - U.sum(km) - list.length * 0.4, 1);
      list.forEach((x, i) => { x.row.odometer_start = cur; if (!x.today) { x.row.odometer_end = R(cur + km[i], 1); cur = R(x.row.odometer_end + 0.4, 1); } else cur = R(cur + km[i], 1); });
      v.odometer_km = R(cur, 1);
    }

    /* --- eventos de la app (solo inserción), enlaces de seguimiento y liquidaciones --- */
    let nLq = 0; const site0 = est => D.sitePt(est);
    const ev = (row, e) => ins('delivery_events', Object.assign({ route_id: row.id, stop_id: null, reason_code: null, lat: null, lng: null, photo_file_id: null, delivery_code: null, signature_file_id: null, amount: null, payment_id: null, receiver_name: null, notes: null, client_event_id: 'seed-' + tok(12) }, e));
    for (const x of routes) {
      const row = x.row; const sp = site0(row.establishment_id);
      if (row.departed_at) ev(row, { event_type: 'DEPARTED', lat: sp[0], lng: sp[1], occurred_at: row.departed_at });
      for (const st of x.stops) {
        const s = st.s; const pt = D.orderPt(st.o);
        if (s.status === 'PENDING') continue;
        const off = (s.pod_distance_m || 30) / 111000;
        if (row.mode !== 'THIRD_PARTY') ev(row, { stop_id: s.id, event_type: 'ARRIVED', lat: pt[0] + off * 0.7, lng: pt[1] + off * 0.7, occurred_at: s.arrived_at });
        if (s.status === 'DELIVERED') {
          if (st.pay && row.mode !== 'THIRD_PARTY') ev(row, { stop_id: s.id, event_type: 'COD_COLLECTED', amount: st.pay.amount, payment_id: st.pay.id, notes: G.pmName(st.pay.payment_method_id), lat: pt[0] + off * 0.7, lng: pt[1] + off * 0.7, occurred_at: tsAdd(s.closed_at, -1) });
          ev(row, { stop_id: s.id, event_type: 'DELIVERED', lat: pt[0] + off * 0.7, lng: pt[1] + off * 0.7, photo_file_id: 'foto-' + tok(8), delivery_code: r() < 0.9 ? s.delivery_code : null, signature_file_id: r() < 0.1 ? 'firma-' + tok(8) : null, receiver_name: G.custName(st.o.customer_id).split(' ')[0], notes: row.mode === 'THIRD_PARTY' ? 'Registrado por el coordinador (tercero)' : null, occurred_at: s.closed_at });
        }
        if (s.status === 'FAILED') ev(row, { stop_id: s.id, event_type: 'FAILED', reason_code: s.fail_reason, lat: pt[0] + 0.0002, lng: pt[1] + 0.0002, photo_file_id: 'foto-' + tok(8), notes: { CUSTOMER_ABSENT: 'Nadie abre; se dejó aviso', WRONG_ADDRESS: 'El número no existe en la cuadra', OUT_OF_SLOT: 'Llegó fuera de la franja; el cliente ya no estaba', NO_PAYMENT: 'El cliente no tenía efectivo', REFUSED: 'No quiso recibir por el tamaño del cuy' }[s.fail_reason] || null, occurred_at: s.closed_at });
      }
      if (!x.today && row.returned_at) ev(row, { event_type: 'RETURNED', lat: sp[0], lng: sp[1], occurred_at: row.returned_at });
    }
    // posiciones de la app cada 120 s en las rutas en curso (RN-DEL-16)
    for (const x of todayRoutes) {
      const kp = D.timeline(x.row, D.DEMO_NOW);
      for (let i = 1; i < kp.length; i++) {
        const a = kp[i - 1], b = kp[i]; const m = minutesBetween(a.at, b.at);
        for (let t = 0; t < m; t += 2) { const f = m ? t / m : 0; ev(x.row, { event_type: 'POSITION', lat: R(a.pt[0] + (b.pt[0] - a.pt[0]) * f, 6), lng: R(a.pt[1] + (b.pt[1] - a.pt[1]) * f, 6), occurred_at: tsAdd(a.at, t), client_event_id: 'pos-' + x.row.id + '-' + i + '-' + t }); }
      }
    }
    // incidencias de hoy
    if (tp) { const dn = tp.stops.find(x => x.done); if (dn) ev(tp.row, { stop_id: dn.s.id, event_type: 'INCIDENT', reason_code: 'DAMAGED', incident_type: 'DAMAGED_PRODUCT', notes: 'Producto dañado · bolsa del caldo con fuga; el cliente aceptó y se repone mañana', occurred_at: tsAdd(dn.s.closed_at, 2) }); }
    if (th) { const pn = th.stops.find(x => !x.done && !x.failed); if (pn) ev(th.row, { stop_id: pn.s.id, event_type: 'INCIDENT', reason_code: 'OTHER', incident_type: 'CROSSED_ORDER', notes: 'Pedido cruzado · en la caja térmica venía la bolsa 1/2 de otro pedido; se devuelve al local', occurred_at: G.TODAY + 'T10:20' }); }
    // enlaces de seguimiento (48 h después de la entrega)
    for (const x of routes) {
      if (x.d < '2026-10-08') continue;
      for (const st of x.stops) { if (st.failed) continue; const s = st.s; const base = s.closed_at || (G.TODAY + 'T23:59'); ins('tracking_links', { order_id: st.o.id, token: tok(22), expires_at: s.closed_at ? tsAdd(s.closed_at, 48 * 60) : G.date.add(G.TODAY, 2) + 'T23:59', revoked: false, created_at: x.row.departed_at || base }); }
    }
    // liquidaciones del repartidor (CAJ · driver_settlements, una por ruta propia o alquilada)
    const lastOf = who => routes.filter(x => x.who === who && !x.today).sort((a, b) => a.row.departed_at.localeCompare(b.row.departed_at)).pop();
    const LJ = lastOf('J'), LH = lastOf('H');
    for (const x of routes) {
      const row = x.row; if (row.mode === 'THIRD_PARTY' || x.today) continue;
      const cash = R(U.sum(x.stops.filter(st => st.pay && st.pay.payment_method_id === 'pm-CASH' && st.s.status === 'DELIVERED'), st => st.pay.amount));
      const dig = R(U.sum(x.stops.filter(st => st.pay && st.pay.payment_method_id !== 'pm-CASH' && st.s.status === 'DELIVERED'), st => st.pay.amount));
      const isLastJ = x === LJ, isLastH = x === LH;
      if (isLastJ) { row.status = 'RETURNED'; continue; }
      const diffCase = (row.route_date === '2026-09-20' && x.who === 'P' && row.slot_from === '13:00') ? -5 : isLastH ? -10 : 0;
      nLq++;
      const st = diffCase ? (isLastH ? 'WITH_DIFFERENCE' : 'APPROVED') : 'SETTLED';
      if (isLastH) row.status = 'RETURNED';
      ins('driver_settlements', { number: 'LQR-' + U.pad(nLq, 5), driver_employee_id: row.driver_employee_id, driver_cash_account_id: D.driverAccount(row.driver_user_id), receiving_account_id: row.establishment_id === 'es-L2' ? 'ca-CCH-L2' : 'ca-CAJA-L1', settlement_date: row.route_date, route_ref: row.id, expected_cash: cash, expected_digital: dig, delivered_cash: R(cash + diffCase), difference: diffCase, difference_reason: diffCase ? (isLastH ? 'Faltan S/ 10: el repartidor dice que dio vuelto de más en la parada 2' : 'Vuelto mal dado en la parada 3; se descuenta del bono') : null, status: st, received_by: 'us-' + 'jsalas', settled_at: row.returned_at, settled_by: 'us-jsalas', approved_by: st === 'APPROVED' ? 'us-rchavez' : null, approved_at: st === 'APPROVED' ? tsAdd(row.returned_at, 60) : null, created_at: row.returned_at });
    }
    db.seq['DG:LQR'] = nLq;

    /* --- costos de reparto (RN-DEL-13) --- */
    const C = (c) => D.addCost(Object.assign({ created_at: (c.cost_date || G.TODAY) + 'T18:00' }, c), { silent: true });
    const empOf = who => DRV[who === 'CA' ? 'P' : who].employee_id;
    const byDayWho = U.groupBy(routes.filter(x => x.row.mode !== 'THIRD_PARTY' && !x.today), x => x.d + '|' + (x.who === 'CA' ? 'P' : x.who));
    for (const [key, list] of Object.entries(byDayWho)) {
      const [d, who] = key.split('|'); const n = list.length;
      const split = (tot) => list.map((_, i) => i < n - 1 ? R(tot / n) : R(tot - R(tot / n) * (n - 1)));
      if (list[0].who === 'CA') {
        const x = list[0]; const row = x.row;
        C({ cost_date: d, cost_type: 'FUEL', amount: 50, vehicle_id: VEH.CA, route_id: row.id, fuel_gallons: 2.907, fuel_voucher_no: 'V-0912-01', odometer_km: row.odometer_end, notes: 'Grifo Primax Av. Primavera' });
        C({ cost_date: d, cost_type: 'DRIVER_WAGE', amount: 80, route_id: row.id, notes: 'Jornal del día', auto: true, pay_mode: 'DAILY', employee_ref: row.driver_employee_id });
        C({ cost_date: d, cost_type: 'DRIVER_MEAL', amount: 15, route_id: row.id, notes: 'Almuerzo' });
        C({ cost_date: d, cost_type: 'TOLL', amount: 5, route_id: row.id, notes: 'Peaje Vía Expresa Sur' });
        continue;
      }
      if (who === 'J') {
        list.forEach(x => C({ cost_date: d, cost_type: 'DRIVER_WAGE', amount: R(6 * x.stops.filter(s => s.s.status === 'DELIVERED').length), route_id: x.row.id, notes: `${x.stops.filter(s => s.s.status === 'DELIVERED').length} entregas × S/ 6,00`, auto: true, pay_mode: 'PER_DELIVERY', employee_ref: x.row.driver_employee_id }));
        C({ cost_date: d, cost_type: 'RENT', amount: 45, vehicle_id: VEH.J, route_id: list[0].row.id, supplier_id: rental ? rental.id : null, notes: 'Alquiler diario Motos Rápido', auto: true });
        split(12).forEach((a, i) => C({ cost_date: d, cost_type: 'DRIVER_MEAL', amount: a, route_id: list[i].row.id, notes: 'Alimentación' }));
      } else {
        split(PAY[who][1]).forEach((a, i) => C({ cost_date: d, cost_type: 'DRIVER_WAGE', amount: a, route_id: list[i].row.id, notes: n > 1 ? `Jornal ${F.money(PAY[who][1])} ÷ ${n} rutas` : 'Jornal del día', auto: true, pay_mode: 'DAILY', employee_ref: list[i].row.driver_employee_id }));
        split(15).forEach((a, i) => C({ cost_date: d, cost_type: 'DRIVER_MEAL', amount: a, route_id: list[i].row.id, notes: 'Alimentación' }));
        if (who === 'H' && r() < 0.25) C({ cost_date: d, cost_type: 'TOLL', amount: 6.6, route_id: list[0].row.id, notes: 'Peaje Panamericana Sur' });
      }
    }
    // combustible con vale (setiembre, motos y furgoneta propias) y rendimiento por odómetro
    for (const [vid, eff, price, every, gal0] of [[VEH.P, 68, 17.2, 170, 2.6], [VEH.H, 31, 16.4, 330, 9.5]]) {
      const list = (byVeh[vid] || []).filter(x => x.d < '2026-10-01' && x.row.odometer_end);
      let acc = 0, n = 0; const v0 = list[0];
      if (v0) C({ cost_date: G.date.add(v0.d, -1), cost_type: 'FUEL', amount: R(gal0 * price), vehicle_id: vid, fuel_gallons: gal0, fuel_voucher_no: 'V-' + vid.slice(3, 6) + '-0000', odometer_km: R(v0.row.odometer_start - 0.5, 1), notes: 'Tanque lleno (base del mes)' });
      for (const x of list) {
        acc += x.row.odometer_end - x.row.odometer_start + 0.4;
        if (acc >= every) { n++; const g = R(acc / (eff * (0.94 + r() * 0.1)), 3); C({ cost_date: x.d, cost_type: 'FUEL', amount: R(g * price), vehicle_id: vid, fuel_gallons: g, fuel_voucher_no: 'V-' + vid.slice(3, 6) + '-' + U.pad(n, 4), odometer_km: x.row.odometer_end, notes: 'Grifo Repsol Av. Benavides' }); acc = 0; }
      }
    }
    C({ cost_date: '2026-09-08', cost_type: 'MAINTENANCE_CORRECTIVE', amount: 320, vehicle_id: VEH.H, supplier_id: null, notes: 'Cambio de faja y tensor (taller Frenos Lima)' });
    C({ cost_date: '2026-09-18', cost_type: 'MAINTENANCE_PREVENTIVE', amount: 85, vehicle_id: VEH.P, notes: 'Cambio de aceite y filtro' });
    C({ cost_date: '2026-09-01', cost_type: 'PARKING', amount: 120, vehicle_id: VEH.H, notes: 'Cochera mensual de la furgoneta' });
    C({ cost_date: '2026-09-30', cost_type: 'OTHER', subtype: 'DEPRECIATION', amount: 160, vehicle_id: VEH.P, notes: 'Depreciación mensual (hoja de activos)' });
    C({ cost_date: '2026-09-30', cost_type: 'OTHER', subtype: 'DEPRECIATION', amount: 650, vehicle_id: VEH.H, notes: 'Depreciación mensual (hoja de activos)' });
    C({ cost_date: '2026-09-25', cost_type: 'FINE', amount: 108, vehicle_id: VEH.J, notes: 'Papeleta por estacionar en zona rígida' });
    C({ cost_date: '2026-10-02', cost_type: 'FUEL', amount: R(6.5 * 16.4), vehicle_id: VEH.H, fuel_gallons: 6.5, fuel_voucher_no: 'V-BXR-0101', notes: 'Vale de grifo (también registrado en FLO como carga)' });
    C({ cost_date: '2026-10-05', cost_type: 'DELIVERY_BONUS', amount: 50, employee_id: pedro.employee_id, notes: 'Bono por cero reclamos en setiembre' });
    C({ cost_date: '2026-10-03', cost_type: 'DRIVER_TRANSPORT', amount: 30, employee_id: julio.employee_id, notes: 'Movilidad para recoger la moto alquilada' });
    C({ cost_date: '2026-10-07', cost_type: 'PARKING', amount: 36, zone_id: 'dz-MIRAFLORES', notes: 'Estacionamiento tarifado en Miraflores (semana)' });

    /* --- envíos a provincia (RN-DEL-12) --- */
    if (andinos) {
      const maxN = Math.max(0, ...db.all('sales_orders').map(o => Number(String(o.number).replace(/\D/g, '')) || 0));
      const prov = [['cu-PROV1', 'ad-PROV1', 'Arequipa · Cercado', '040101', null], ['cu-0007', 'ad-PRV-CUS', 'Cusco · Wanchaq', '080108', ['Av. de la Cultura 1240, Wanchaq', -13.5226, -71.9673]], ['cu-0019', 'ad-PRV-TRU', 'Trujillo · Víctor Larco', '130111', ['Av. Larco 789, Víctor Larco Herrera', -8.1342, -79.0466]], ['cu-PROV1', 'ad-PROV1', 'Arequipa · Cercado', '040101', null]];
      const spec = [['2026-09-22', 'CLOSED', 'DELIVERED'], ['2026-10-08', 'IN_ROUTE', 'IN_TRANSIT'], [G.TODAY, 'READY', 'PREPARED_GRE'], [G.TODAY, 'READY', 'PREPARED']];
      prov.forEach(([cid, aid, dest, ubi, newAddr], i) => {
        const cust = db.get('customers', cid); if (!cust) return;
        if (newAddr && !db.get('customer_addresses', aid)) ins('customer_addresses', { id: aid, customer_id: cid, label: dest.split(' · ')[0], address_line: newAddr[0], reference: 'Recoge en la agencia Andinos Cargo de la ciudad', ubigeo: ubi, lat: newAddr[1], lng: newAddr[2], zone_id: 'dz-PROVINCIA', is_default: false, status: 'ACTIVE', pin_source: 'MAP' });
        const [d, st, shSt] = spec[i];
        const lines = [['va-DG-CUY-ENT', 4], ['va-DG-CAL-1L', 2]].map(([vid, q], k) => { const v = G.variant(vid); const pr = G.price.of(vid, { brand_id: 'br-DG', channel: 'WHATSAPP' }) || { price: 40, basis: 'UNIT', list_id: 'pl-DG-PUB' }; return { id: `ol-prv${i}-${k}`, variant_id: vid, qty: q, unit_price: pr.price, list_price: pr.price, price_basis: pr.basis, price_list_id: pr.list_id, est_weight_kg: v && v.sale_mode !== 'UNIT' ? R(q * (v.nominal_weight_kg || 1), 3) : null, tolerance_pct: v ? v.weight_tolerance_pct : null, discount_pct: 0, discount_amount: 0, weighed_kg: v && v.sale_mode !== 'UNIT' ? R(q * (v.nominal_weight_kg || 1) * 1.02, 3) : null, weight_source: 'SCALE', final_amount: null, lot_id: null, cut_notes: 'Empacar al vacío para viaje' }; });
        const o = { id: 'so-PRV' + (i + 1), number: 'P-' + U.pad(maxN + i + 1, 6), brand_id: 'br-DG', establishment_id: 'es-L1', channel: 'WHATSAPP', customer_id: cid, address_id: aid, seller_id: users.find(u => u.role === 'VENDEDORA').id, fulfillment: 'PROVINCE_SHIPPING', province_agency: andinos.id, delivery_date: d, slot_id: null, requested_doc_type: 'RECEIPT', billing_customer_id: cid, payment_method_id: 'pm-TRANSFER', status: st, paid_amount: 0, discount_total: 0, discount_status: 'NONE', weight_diff_status: 'WITHIN_TOLERANCE', contact_phone: cust.phone, zone_id: 'dz-PROVINCIA', notes: 'Envío a provincia por agencia, caja térmica con gel', reschedule_count: 0, created_at: G.date.add(d, -1) + 'T16:30', confirmed_at: G.date.add(d, -1) + 'T16:45', history: [{ at: G.date.add(d, -1) + 'T16:30', from: null, to: 'DRAFT', user: 'Ana Torres Lima' }, { at: G.date.add(d, -1) + 'T16:45', from: 'DRAFT', to: 'CONFIRMED', user: 'Ana Torres Lima' }], lines, tenant: 'DG' };
        G.orders.recalc(o);
        if (st === 'CLOSED') { o.delivered_at = G.date.add(d, 2) + 'T15:00'; o.closed_at = o.delivered_at; }
        const pay = ins('payments', { id: 'py-PRV' + (i + 1), number: 'CB-P' + U.pad(i + 1, 5), customer_id: cid, payment_method_id: 'pm-TRANSFER', cash_account_id: 'ca-BCP-CTE', amount: D.orderTotal(o), paid_at: o.confirmed_at, reference: 'OP' + (55120400 + i * 7), status: 'CONFIRMED', brand_id: 'br-DG', establishment_id: 'es-L1', fee_amount: 0, reconciliation_status: 'MATCHED', allocations: [{ order_id: o.id, document_id: null, amount: D.orderTotal(o) }] });
        o.paid_amount = pay.amount; o.payment_ids = [pay.id];
        ins('sales_orders', o);
        const kg = D.orderKg(o); const freight = R(kg * 3.5 + 6);
        const sh = ins('province_shipments', { order_id: o.id, agency_supplier_id: andinos.id, dispatch_guide_id: null, tracking_number: null, packaging: 'THERMAL_BOX', packages: 1, weight_kg: R(kg + 1.2, 3), freight_cost: freight, packaging_cost: 14.5, charged_to_customer: 25, destination: dest, destination_ubigeo: ubi, status: 'PREPARED', handed_at: null, delivered_at: null, created_at: o.created_at });
        if (shSt !== 'PREPARED') {
          const n = G.series.next('T001');
          const g = ins('dispatch_guides', { company_id: 'co-dg', establishment_id: 'es-L1', brand_id: 'br-DG', series_id: n.series_id, series: n.series, number: n.number, full_number: n.full, issue_date: d, transfer_reason_code: '01', transport_mode: '01', start_date: d, carrier_supplier_id: andinos.id, recipient_customer_id: cid, origin_ubigeo: '150140', origin_address: 'Local 1 Surco', dest_ubigeo: ubi, dest_address: dest, gross_weight_kg: sh.weight_kg, packages: 1, order_id: o.id, status: 'ISSUED', sunat_status: 'ACCEPTED', created_at: d + 'T17:00' });
          sh.dispatch_guide_id = g.id;
        }
        if (['DELIVERED', 'IN_TRANSIT'].includes(shSt)) { sh.status = shSt; sh.tracking_number = 'AC-' + (771200 + i * 37); sh.handed_at = d + 'T17:40'; if (shSt === 'DELIVERED') sh.delivered_at = G.date.add(d, 2) + 'T15:00'; C({ cost_date: d, cost_type: 'PROVINCE_FREIGHT', amount: freight, supplier_id: andinos.id, zone_id: 'dz-PROVINCIA', order_id: o.id, notes: 'Flete ' + o.number }); C({ cost_date: d, cost_type: 'PACKAGING', amount: 14.5, zone_id: 'dz-PROVINCIA', order_id: o.id, notes: 'Caja térmica y gel ' + o.number }); }
      });
      db.seq['DG:PED'] = Math.max(db.seq['DG:PED'] || 0, maxN + prov.length);
    }

    /* --- factura de la empresa de delivery de setiembre (CA-DEL-05: 40 envíos × S/ 9 = S/ 360; factura S/ 378) --- */
    if (express) {
      const ships = D.carrierStops(express.id, '2026-09-01', '2026-09-30');
      const inv = ins('carrier_invoices', { supplier_id: express.id, invoice_number: 'F001-000231', issue_date: '2026-10-03', period_from: '2026-09-01', period_to: '2026-09-30', amount: 378, expected_amount: R(ships.length * 9), difference: R(378 - ships.length * 9), status: Math.abs(378 - ships.length * 9) <= 2 ? 'RECONCILED' : 'OBSERVED', reconciled_by: 'us-rchavez', reconciled_at: '2026-10-04T10:15', shipments: ships.length, created_at: '2026-10-04T10:15' });
      for (const x of ships) ins('carrier_invoice_lines', { invoice_id: inv.id, stop_id: x.s.id, external_ref: x.o.number, billed_amount: 9, expected_amount: 9, match_status: 'MATCHED' });
      for (const ref of ['EXP-88412', 'EXP-88419']) ins('carrier_invoice_lines', { invoice_id: inv.id, stop_id: null, external_ref: ref, billed_amount: 9, expected_amount: 0, match_status: 'NOT_REGISTERED' });
    }

    /* --- corridas de costo por entrega: setiembre (cierre) y octubre a la fecha --- */
    D.allocate('2026-09-01');
    D.allocate('2026-10-01');
  }, 'DEL · rutas, entregas y costos');

  /* ==================================================================
     Interfaz
     ================================================================== */
  const S = D.ui = { date: G.TODAY, est: 'ALL', month: G.date.month(G.TODAY), sel: new Set(), route: null, appDriver: null, offline: false, pos: 'PIN', photo: false, sign: false };
  const OFFICE = G.ROLES.map(x => x[0]).filter(x => !['REPARTIDOR', 'CLIENTE_B2B'].includes(x));
  const APP_ROLES = ['REPARTIDOR', 'COORDINADOR_DELIVERY'];
  const dateInput = (value, onChange, label = 'Fecha') => h('input', { class: 'input', type: 'date', value, attrs: { 'aria-label': label }, style: 'width:auto', on: { change: e => onChange(e.target.value) } });
  const estPills = () => pills([['ALL', 'Ambos locales'], ['es-L1', 'Local 1 Surco'], ['es-L2', 'Local 2 Lurín']], S.est, v => { S.est = v; G.refresh(); });
  const monthSelect = () => h('select', { class: 'input', style: 'width:auto', attrs: { 'aria-label': 'Mes' }, on: { change: e => { S.month = e.target.value; G.refresh(); } } }, ['2026-09-01', '2026-10-01'].map(m => h('option', { value: m, selected: S.month === m }, (m === '2026-09-01' ? 'Setiembre 2026' : 'Octubre 2026 (a la fecha)'))));
  const tryDo = (fn, okMsg) => { try { const r = fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); return null; } };
  const routesOf = (date, est = S.est) => db.where('delivery_routes', r => r.route_date === date && r.status !== 'CANCELLED' && (est === 'ALL' || r.establishment_id === est) && G.scope.ok(r, { brand: '_' })).sort((a, b) => (a.slot_from || '').localeCompare(b.slot_from || '') || a.code.localeCompare(b.code));
  const assignedText = r => r.mode === 'THIRD_PARTY' ? (r.carrier_supplier_id ? G.supName(r.carrier_supplier_id) : 'Sin empresa') : (r.vehicle_id ? `${(D.vehicle(r.vehicle_id) || {}).plate} · ${G.userShort(r.driver_user_id)}` : 'Sin asignar');
  const bagCount = rid => { let n = 0, l = 0; for (const s of D.activeStops(rid)) for (const p of D.parcels(s)) { n++; if (['LOADED', 'DELIVERED'].includes(p.status)) l++; } return { n, l }; };
  const TONES = ['', 'info', 'ok', 'warn'];
  const custLine = o => { const a = db.get('customer_addresses', o.address_id) || {}; return [h('div', null, h('b', null, G.custName(o.customer_id))), h('div', { class: 'small muted' }, a.address_line || '—'), a.reference ? h('div', { class: 'small muted' }, 'Ref.: ' + a.reference) : null]; };
  const orderLink = o => h('a', { href: '#', class: 'mono', on: { click: e => { e.preventDefault(); e.stopPropagation(); orderDrawer(o); } } }, o.number);
  function orderDrawer(o) {
    drawer(`Pedido ${o.number}`, body => {
      const s = D.activeStopOf(o.id); const r = s && db.get('delivery_routes', s.route_id);
      body.appendChild(dl([['Cliente', G.custName(o.customer_id)], ['Marca', G.brandName(o.brand_id)], ['Estado', G.ui.status(o.status)], ['Entrega', `${F.date(o.delivery_date)} · ${D.slotOf(o)}`], ['Zona', G.zoneName(o.zone_id)], ['Peso', F.kg(D.orderKg(o), 3)], ['Total', F.money(D.orderTotal(o))], ['Pagado', F.money(o.paid_amount || 0)], ['Forma de pago', G.pmName(o.payment_method_id)], ['Ruta', r ? `${r.code} · parada ${s.seq}` : 'Sin ruta']]));
      body.appendChild(card('Líneas', h('div', { class: 'stack small' }, (o.lines || []).map(l => h('div', { class: 'row between' }, h('span', null, `${l.qty} × ${G.variantName(l.variant_id)}`), h('span', { class: 'mono' }, l.weighed_kg ? F.kg(l.weighed_kg, 3) : l.est_weight_kg ? '≈ ' + F.kg(l.est_weight_kg, 3) : ''))))));
      body.appendChild(card('Historial', h('div', { class: 'timeline' }, (o.history || []).map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.datetime(x.at)), h('span', { class: 'dot' }), h('div', null, `${x.from ? G.ui.statusLabel(x.from) + ' → ' : ''}${G.ui.statusLabel(x.to)}`, h('div', { class: 'small muted' }, `${x.user || ''}${x.reason ? ' · ' + x.reason : ''}`)))))));
    });
  }
  function routeMap(rs, opts = {}) {
    const pts = [], lines = [];
    rs.forEach((r, i) => {
      const tone = TONES[i % TONES.length];
      const stops = D.activeStops(r.id);
      lines.push({ points: D.routePoints(r, stops.filter(s => s.status !== 'FAILED')), tone });
      for (const s of stops) { const o = order(s.order_id); const p = D.orderPt(o); pts.push({ lat: p[0], lng: p[1], label: s.seq, tone: s.status === 'DELIVERED' ? 'ok' : s.status === 'FAILED' ? 'bad' : (tone || ''), title: `${r.code} · parada ${s.seq} · ${o.number} · ${G.custName(o.customer_id)} · ${SST[s.status][0]}`, onClick: () => orderDrawer(o) }); }
    });
    const all = pts.concat(opts.extra || []);
    const H = opts.height || 340;
    return G.ui.map(Object.assign({ points: all, routes: lines, height: H, legend: opts.legend, bounds: D.fit(all.map(p => [p.lat, p.lng]).concat(lines.flatMap(l => l.points)), H) }, opts.map || {}));
  }

  /* ---------- DEL-01 Planificador de rutas ---------- */
  function scr01(el) {
    const canPlan = G.can('del.route.plan');
    const body = page(el, { code: 'DEL-01', title: 'Planificador de rutas', sub: 'Pedidos del día por zona y franja: arma rutas con orden sugerido (vecino más cercano), mueve pedidos entre rutas y controla kg y paradas.', actions: [dateInput(S.date, v => { S.date = v; S.sel.clear(); G.refresh(); }), btn('Sugerir rutas por zona', () => G.require('del.route.plan', () => tryDo(() => suggestRoutes(S.date), n => `${n} ruta(s) creadas con orden sugerido`)), { kind: 'primary', disabled: !canPlan })] });
    const os = db.where('sales_orders', o => o.delivery_date === S.date && o.fulfillment === 'DELIVERY' && !['CANCELLED', 'DRAFT'].includes(o.status) && (S.est === 'ALL' || o.establishment_id === S.est) && G.scope.ok(o));
    const routed = new Set(db.where('delivery_stops', s => isActiveStop(s)).map(s => s.order_id));
    const free = os.filter(o => !routed.has(o.id) && !['DELIVERED', 'CLOSED', 'IN_ROUTE'].includes(o.status));
    const rs = routesOf(S.date);
    const readyFree = free.filter(o => ['READY', 'NOT_DELIVERED'].includes(o.status));
    body.appendChild(h('div', { class: 'row between' }, estPills(), h('span', { class: 'small muted' }, 'D-DEL-04: orden por vecino más cercano; el motor de ruteo externo sigue como decisión abierta.')));
    body.appendChild(kpis([
      { label: 'Pedidos de delivery del día', value: os.length, sub: `${os.filter(o => routed.has(o.id)).length} ya en ruta` },
      { label: 'Listos sin ruta', value: readyFree.length, sub: 'pueden salir hoy', tone: readyFree.length ? 'warn' : 'ok' },
      { label: 'Por preparar sin ruta', value: free.length - readyFree.length, sub: 'confirmados o en preparación (PRE)' },
      { label: 'Rutas', value: rs.length, sub: `${F.kg(U.sum(rs, r => D.routeKg(r.id)), 1)} · ${U.sum(rs, r => D.activeStops(r.id).length)} paradas` },
    ]));
    const extra = free.map(o => { const p = D.orderPt(o); return { lat: p[0], lng: p[1], label: S.sel.has(o.id) ? '✓' : '', tone: ['READY', 'NOT_DELIVERED'].includes(o.status) ? 'warn' : 'muted', title: `${o.number} · ${G.zoneName(o.zone_id)} · ${G.ui.statusLabel(o.status)} (sin ruta)`, onClick: () => { S.sel.has(o.id) ? S.sel.delete(o.id) : S.sel.add(o.id); G.refresh(); } }; });
    const left = h('div', { class: 'stack' },
      card('Mapa del día', routeMap(rs, { extra, legend: 'Números: parada de cada ruta · ámbar: listo sin ruta · gris: por preparar · toca un pin sin ruta para seleccionarlo' }), { flush: false }),
      table({ id: 'del01-free', columns: [
        { key: 'sel', label: '', sort: false, render: o => h('input', { type: 'checkbox', checked: S.sel.has(o.id), attrs: { 'aria-label': 'Seleccionar ' + o.number }, on: { click: e => e.stopPropagation(), change: e => { e.target.checked ? S.sel.add(o.id) : S.sel.delete(o.id); G.refresh(); } } }) },
        { key: 'number', label: 'Pedido', mono: true },
        { key: 'zone', label: 'Zona', value: o => G.zoneName(o.zone_id) },
        { key: 'slot', label: 'Franja', value: o => D.slotOf(o) },
        { key: 'kg', label: 'Kg', align: 'r', value: o => D.orderKg(o), render: o => F.num(D.orderKg(o), 1) },
        { key: 'status', label: 'Estado', value: o => o.status, render: o => G.ui.status(o.status) },
        { key: 'cust', label: 'Cliente', value: o => G.custName(o.customer_id) },
      ], rows: free, onRow: o => orderDrawer(o), filters: [{ key: 'zone_id', label: 'Zona', options: G.ui.opts('delivery_zones', z => z.name, z => !z.province) }, { key: 'status', label: 'Estado', options: [['READY', 'Listo'], ['CONFIRMED', 'Confirmado'], ['IN_PREPARATION', 'En preparación'], ['WEIGHED', 'Pesado'], ['NOT_DELIVERED', 'No entregado']] }],
        toolbar: [btn(`Crear ruta con ${S.sel.size} seleccionado(s)`, () => G.require('del.route.plan', () => newRouteDialog()), { kind: 'primary', sm: true, disabled: !S.sel.size || !canPlan }), S.sel.size ? btn('Limpiar selección', () => { S.sel.clear(); G.refresh(); }, { sm: true, kind: 'ghost' }) : null], empty: 'Todos los pedidos del día tienen ruta.' }));
    const right = h('div', { class: 'stack' }, rs.length ? rs.map((r, i) => routeCard(r, i, rs)) : notice('Aún no hay rutas para esta fecha. Selecciona pedidos y crea una ruta, o usa «Sugerir rutas por zona».', 'info'));
    body.appendChild(h('div', { class: 'grid side-r' }, left, right));
  }
  function routeCard(r, i, rs) {
    const stops = D.activeStops(r.id); const kg = D.routeKg(r.id); const v = r.vehicle_id && D.vehicle(r.vehicle_id); const cap = v ? v.capacity_kg : null; const b = bagCount(r.id);
    const editable = ['PLANNED', 'LOADING'].includes(r.status) && G.can('del.route.plan');
    return card(h('span', null, h('span', { class: 'mono' }, r.code), ' ', D.routeBadge(r.status)), h('div', { class: 'stack small' },
      h('div', { class: 'row between' }, h('span', null, `${r.slot_from || '—'}–${r.slot_to || '—'} · ${D.modeName(r.mode)}`), h('span', { class: 'muted' }, assignedText(r))),
      h('div', { class: 'row between' }, h('span', null, `${plural(stops.length, 'parada', 'paradas')} · ${F.kg(kg, 1)}${cap ? ' de ' + F.kg(cap, 0) : ''} · ${F.num(r.planned_km, 1)} km`), h('span', { class: 'muted' }, `bolsas ${b.l}/${b.n}`)),
      cap ? G.ui.progress(kg / cap * 100, kg > cap ? 'bad' : kg > cap * 0.85 ? 'warn' : 'ok') : null,
      h('div', { class: 'stack', style: 'gap:4px' }, stops.slice(0, 8).map(s => { const o = order(s.order_id); return h('div', { class: 'row between', style: 'gap:6px' }, h('span', null, h('b', { class: 'mono' }, s.seq + '. '), orderLink(o), ' ', h('span', { class: 'muted' }, G.zoneName(o.zone_id))), editable && s.status === 'PENDING' ? h('select', { class: 'input', style: 'width:auto;max-width:130px;padding:2px 6px', attrs: { 'aria-label': 'Mover ' + o.number }, on: { change: e => { const v = e.target.value; if (v === '_') tryDo(() => D.removeStop(s.id), 'Pedido quitado de la ruta'); else if (v) tryDo(() => D.moveStop(s.id, v), 'Pedido movido'); } } }, h('option', { value: '' }, 'Mover…'), rs.filter(x => x.id !== r.id && ['PLANNED', 'LOADING'].includes(x.status)).map(x => h('option', { value: x.id }, 'a ' + x.code)), h('option', { value: '_' }, 'Quitar de la ruta')) : D.stopBadge(s.status)); }), stops.length > 8 ? h('span', { class: 'muted' }, `y ${stops.length - 8} más…`) : null)),
      { actions: [editable && S.sel.size ? btn(`Agregar ${S.sel.size}`, () => tryDo(() => { for (const id of [...S.sel]) D.addStop(r.id, id, { noSeq: true }); D.resequence(r.id); S.sel.clear(); }, 'Pedidos agregados con orden sugerido'), { sm: true, kind: 'primary' }) : null, btn('Hoja', () => { S.route = r.id; S.date = r.route_date; G.go('DEL-03', { id: r.id }); }, { sm: true }), btn('Asignar', () => { S.date = r.route_date; G.go('DEL-02', { id: r.id }); }, { sm: true })].filter(Boolean) });
  }
  function newRouteDialog() {
    const ids = [...S.sel]; const o0 = order(ids[0]);
    modal('Nueva ruta', b => {
      b.appendChild(h('p', { class: 'small muted' }, `${ids.length} pedido(s) · ${F.kg(U.sum(ids, id => D.orderKg(order(id))), 1)}. El orden de paradas sale del vecino más cercano desde el local (RN-DEL-02).`));
      b.appendChild(form({ id: 'del-newroute', fields: [
        { key: 'establishment_id', label: 'Local de salida', type: 'select', required: true, options: [['es-L1', 'Local 1 Surco'], ['es-L2', 'Local 2 Lurín']] },
        { key: 'slot_id', label: 'Franja', type: 'select', required: true, options: v => G.ui.opts('order_time_slots', s => s.name, s => s.establishment_id === (v.establishment_id || 'es-L1')) },
        { key: 'code', label: 'Código (opcional)', placeholder: 'SURCO-B' },
      ], values: { establishment_id: o0.establishment_id, slot_id: o0.slot_id }, submitLabel: 'Crear ruta', onSubmit: v => {
        const slot = db.get('order_time_slots', v.slot_id); if (slot && slot.establishment_id !== v.establishment_id) v.slot_id = `ts-${v.establishment_id.slice(3)}-${String(v.slot_id).split('-').pop()}`;
        const rt = D.createRoute({ route_date: S.date, establishment_id: v.establishment_id, slot_id: v.slot_id, code: v.code ? v.code.trim().toUpperCase() : null, order_ids: ids });
        S.sel.clear(); G.ui.closeAll(); toast(`Ruta ${rt.code} creada con ${ids.length} parada(s)`, 'ok'); G.refresh(); return true;
      } }));
    });
  }
  function suggestRoutes(date) {
    const routed = new Set(db.where('delivery_stops', s => isActiveStop(s)).map(s => s.order_id));
    const free = db.where('sales_orders', o => o.delivery_date === date && o.fulfillment === 'DELIVERY' && ['READY', 'CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'NOT_DELIVERED'].includes(o.status) && !routed.has(o.id) && (S.est === 'ALL' || o.establishment_id === S.est));
    const groups = U.groupBy(free, o => o.establishment_id + '|' + (o.slot_id || 'x'));
    let n = 0;
    for (const [k, list] of Object.entries(groups)) {
      const [est, slot] = k.split('|');
      // bloques de hasta 10 paradas por cercanía de zona
      const sorted = D.nearest(D.sitePt(est), list, o => D.orderPt(o));
      for (let i = 0; i < sorted.length; i += 10) { D.createRoute({ route_date: date, establishment_id: est, slot_id: slot === 'x' ? null : slot, order_ids: sorted.slice(i, i + 10).map(o => o.id) }); n++; }
    }
    if (!n) G.fail('RN-DEL-02', 'No hay pedidos sin ruta para esta fecha.');
    return n;
  }

  /* ---------- DEL-02 Asignación ---------- */
  function scr02(el, params) {
    const body = page(el, { code: 'DEL-02', title: 'Asignación', sub: 'Por ruta: modalidad propia, alquilada o tercero; vehículo y repartidor o empresa de delivery. Avisa documentos vencidos y capacidad, carga las bolsas por escaneo y da la salida.', actions: [dateInput(S.date, v => { S.date = v; G.refresh(); })] });
    const rs = routesOf(S.date);
    body.appendChild(estPills());
    const alerts = [];
    for (const v of db.where('vehicles', v => v.status !== 'RETIRED')) for (const w of D.vehicleDocIssues(v, S.date)) alerts.push(h('div', null, h('b', null, v.plate + ': '), w.msg + (w.level === 'bad' ? ' · no puede salir (RN-DEL-03)' : ' · aviso previo (del_doc_alert_days)')));
    if (alerts.length) body.appendChild(notice(alerts, alerts.some(a => /no puede salir/.test(a.textContent)) ? 'bad' : 'warn'));
    body.appendChild(kpis([
      { label: 'Rutas del día', value: rs.length, sub: `${rs.filter(r => r.status === 'IN_ROUTE').length} en ruta · ${rs.filter(r => ['PLANNED', 'LOADING'].includes(r.status)).length} por salir` },
      { label: 'Sin asignar', value: rs.filter(r => r.mode !== 'THIRD_PARTY' ? !r.vehicle_id : !r.carrier_supplier_id).length, tone: rs.some(r => ['PLANNED', 'LOADING'].includes(r.status) && (r.mode !== 'THIRD_PARTY' ? !r.vehicle_id : !r.carrier_supplier_id)) ? 'warn' : 'ok', sub: 'RN-DEL-01' },
      { label: 'Propias y alquiladas', value: rs.filter(r => r.mode !== 'THIRD_PARTY').length, sub: `${rs.filter(r => r.mode === 'RENTED').length} alquiladas` },
      { label: 'Terceros', value: rs.filter(r => r.mode === 'THIRD_PARTY').length, sub: 'empresa de delivery' },
    ]));
    body.appendChild(table({ id: 'del02', columns: [
      { key: 'code', label: 'Ruta', mono: true },
      { key: 'slot', label: 'Franja', value: r => `${r.slot_from || '—'}–${r.slot_to || '—'}` },
      { key: 'status', label: 'Estado', value: r => r.status, render: r => D.routeBadge(r.status) },
      { key: 'mode', label: 'Modalidad', value: r => D.modeName(r.mode) },
      { key: 'assigned', label: 'Asignada a', value: r => assignedText(r) },
      { key: 'stops', label: 'Paradas', align: 'r', value: r => D.activeStops(r.id).length },
      { key: 'kg', label: 'Kg / capacidad', align: 'r', value: r => D.routeKg(r.id), render: r => { const v = r.vehicle_id && D.vehicle(r.vehicle_id); const kg = D.routeKg(r.id); return h('span', { class: v && kg > v.capacity_kg ? 'badge bad' : '' }, `${F.num(kg, 1)}${v ? ' / ' + F.num(v.capacity_kg, 0) : ''}`); } },
      { key: 'bags', label: 'Bolsas', align: 'r', value: r => { const b = bagCount(r.id); return `${b.l}/${b.n}`; } },
      { key: 'docs', label: 'Documentos', value: r => { const v = r.vehicle_id && D.vehicle(r.vehicle_id); return v ? D.vehicleDocIssues(v, r.route_date).map(x => x.msg).join(', ') || 'Vigentes' : '—'; }, render: r => { const v = r.vehicle_id && D.vehicle(r.vehicle_id); if (!v) return '—'; const is = D.vehicleDocIssues(v, r.route_date); return is.length ? badge(is[0].msg, is.some(x => x.level === 'bad') ? 'bad' : 'warn') : badge('Vigentes', 'ok'); } },
    ], rows: rs, onRow: r => assignDrawer(r), empty: 'No hay rutas para esta fecha: créalas en DEL-01.' }));
    if (params && params.id && db.get('delivery_routes', params.id)) setTimeout(() => assignDrawer(db.get('delivery_routes', params.id)), 0);
  }
  function assignDrawer(r) {
    drawer(`Ruta ${r.code}`, (bd, close) => {
      const redraw = () => { close(); G.refresh(); assignDrawer(db.get('delivery_routes', r.id)); };
      r = db.get('delivery_routes', r.id);
      bd.appendChild(dl([['Fecha', F.date(r.route_date)], ['Local', G.siteName(r.establishment_id)], ['Franja', `${r.slot_from || '—'}–${r.slot_to || '—'}`], ['Estado', D.routeBadge(r.status)], ['Paradas', D.activeStops(r.id).length], ['Peso', F.kg(D.routeKg(r.id), 1)], ['Km planificados', F.num(r.planned_km, 1)]]));
      const editable = ['PLANNED', 'LOADING'].includes(r.status);
      if (editable) {
        const vehOpts = db.where('vehicles', v => v.status !== 'RETIRED').map(v => [v.id, `${v.plate} · ${D.vtypeName(v.vehicle_type)} ${v.ownership === 'RENTED' ? '(alquilada)' : '(propia)'} · ${F.num(v.capacity_kg, 0)} kg${v.refrigerated ? ' · refrigerada' : ''}`]);
        bd.appendChild(card('Asignación (RN-DEL-01)', form({ id: 'del-assign', fields: [
          { key: 'mode', label: 'Modalidad', type: 'select', required: true, options: D.MODES },
          { key: 'vehicle_id', label: 'Vehículo (propia o alquilada)', type: 'select', options: vehOpts },
          { key: 'driver_user_id', label: 'Repartidor', type: 'select', options: D.drivers().map(u => [u.id, u.name]), onChange: (v, vals, api) => { const p = D.defaultPay(v); api.set('driver_pay_mode', p.mode); api.set('driver_pay_rate', p.rate); } },
          { key: 'driver_pay_mode', label: 'Pago del repartidor', type: 'select', options: D.PAYMODES },
          { key: 'driver_pay_rate', label: 'Monto (S/ por día o por entrega)', type: 'money', min: 0 },
          { key: 'carrier_supplier_id', label: 'Empresa de delivery (tercero)', type: 'select', options: D.carriers().map(s => [s.id, s.trade_name]) },
        ], values: { mode: r.mode, vehicle_id: r.vehicle_id, driver_user_id: r.driver_user_id, carrier_supplier_id: r.carrier_supplier_id, driver_pay_mode: r.driver_pay_mode || 'DAILY', driver_pay_rate: r.driver_pay_rate ?? 80 }, submitLabel: 'Guardar asignación', onSubmit: v => {
          if (!G.can('del.route.plan')) return 'Tu rol no planifica rutas (del.route.plan).';
          const res = D.assign(r.id, v); toast(`Ruta ${r.code} asignada`, 'ok'); if (res.warnings.length) setTimeout(() => toast(res.warnings.join(' '), 'warn'), 50); redraw(); return true;
        } })));
      }
      const loadBox = h('div', { class: 'stack' });
      if (editable) {
        const inp = h('input', { class: 'input', placeholder: 'Escanea o escribe la etiqueta: P-000123-1/2', attrs: { 'aria-label': 'Etiqueta de la bolsa' } });
        const go = () => { try { const res = D.loadParcel(r.id, inp.value); toast(res.already ? `La bolsa ${res.parcel.label} ya estaba cargada` : `Bolsa ${res.parcel.label} cargada · parada ${res.stop.seq}`, res.already ? 'warn' : 'ok'); redraw(); } catch (e) { toast(e.message, 'bad'); } };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        loadBox.appendChild(h('div', { class: 'row' }, inp, btn('Cargar', go, { kind: 'primary', sm: true }), btn('Cargar todas (simular escaneos)', () => { try { for (const s of D.activeStops(r.id)) for (const p of D.parcels(s)) if (!['LOADED', 'DELIVERED'].includes(p.status)) D.loadParcel(r.id, p.label); toast('Todas las bolsas cargadas por escaneo', 'ok'); redraw(); } catch (e) { toast(e.message, 'bad'); } }, { sm: true })));
      }
      loadBox.appendChild(h('div', { class: 'stack small', style: 'gap:4px' }, D.activeStops(r.id).map(s => h('div', { class: 'row between' }, h('span', null, h('b', { class: 'mono' }, s.seq + '. '), (order(s.order_id) || {}).number), h('span', { class: 'row', style: 'gap:4px' }, D.parcels(s).map(p => h('span', { class: 'row', style: 'gap:2px' }, h('span', { class: 'mono small' }, p.label.split('-').pop()), D.bagBadge(p.status))))))));
      bd.appendChild(card(`Carga de bolsas por escaneo (RN-DEL-04) · ${bagCount(r.id).l}/${bagCount(r.id).n}`, loadBox));
      if (editable) {
        const odo = h('input', { class: 'input', type: 'number', placeholder: 'Odómetro de salida', value: r.vehicle_id ? (D.vehicle(r.vehicle_id) || {}).odometer_km : '', attrs: { 'aria-label': 'Odómetro de salida' }, style: 'width:180px' });
        bd.appendChild(card('Salida', h('div', { class: 'stack' }, h('p', { class: 'small muted' }, 'Sale con vehículo y repartidor (o empresa), documentos vigentes y todas las bolsas cargadas. Los pedidos pasan a EN RUTA y el cliente recibe «va en camino» con su enlace y código de entrega.'), h('div', { class: 'row' }, r.mode !== 'THIRD_PARTY' ? odo : null, btn('Salir a ruta', () => { try { const res = D.depart(r.id, { odometer_start: r.mode !== 'THIRD_PARTY' ? odo.value : null }); toast(`Ruta ${r.code} en ruta · ${res.messages.length} mensaje(s) «va en camino»`, 'ok'); redraw(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'accent' })))));
      } else if (r.status === 'IN_ROUTE' && r.mode === 'THIRD_PARTY') {
        bd.appendChild(card('Cierre de envíos del tercero', h('div', { class: 'stack' }, D.activeStops(r.id).filter(s => ['PENDING', 'ARRIVED'].includes(s.status)).map(s => h('div', { class: 'row between' }, h('span', null, (order(s.order_id) || {}).number), h('span', { class: 'row' }, btn('Entregado', () => { try { D.deliver(s.id, { photo: true, signature: true, receiver: 'Confirmado por ' + G.supName(r.carrier_supplier_id) }); toast('Entrega registrada', 'ok'); redraw(); } catch (e) { toast(e.message, 'bad'); } }, { sm: true }), btn('No entregado', () => { try { D.fail(s.id, { reason: 'CUSTOMER_ABSENT', photo: true, notes: 'Informado por la empresa de delivery' }); redraw(); } catch (e) { toast(e.message, 'bad'); } }, { sm: true, kind: 'danger' })))), btn('Cerrar ruta del tercero', () => { try { D.returnRoute(r.id); toast('Ruta cerrada', 'ok'); redraw(); } catch (e) { toast(e.message, 'bad'); } }, { sm: true }))));
      }
      bd.appendChild(btn('Ver hoja de ruta (DEL-03)', () => { close(); G.go('DEL-03', { id: r.id }); }, { sm: true }));
    }, { wide: true, code: 'DEL-02' });
  }

  /* ---------- DEL-03 Hoja de ruta ---------- */
  function scr03(el, params) {
    const rs = routesOf(S.date, 'ALL');
    if (params && params.id) S.route = params.id;
    let r = S.route && db.get('delivery_routes', S.route);
    if (!r || (r.route_date !== S.date && !(params && params.id))) r = rs.find(x => x.status === 'IN_ROUTE') || rs[0];
    const sel = h('select', { class: 'input', style: 'width:auto', attrs: { 'aria-label': 'Ruta' }, on: { change: e => { S.route = e.target.value; G.refresh(); } } }, rs.map(x => h('option', { value: x.id, selected: r && x.id === r.id }, `${x.code} · ${RST[x.status][0]}`)));
    const body = page(el, { code: 'DEL-03', title: 'Hoja de ruta', sub: 'Paradas en orden sugerido (editable) con dirección, referencia, franja, bolsas, monto a cobrar y teléfono enmascarado.', actions: [dateInput(S.date, v => { S.date = v; S.route = null; G.refresh(); }), sel, btn('Imprimir', () => G.print())] });
    if (!r) { body.appendChild(notice('No hay rutas en esta fecha.', 'info')); return; }
    const stops = D.activeStops(r.id); const editable = ['PLANNED', 'LOADING'].includes(r.status) && G.can('del.route.plan');
    const openStops = stops.filter(s => ['PENDING', 'ARRIVED'].includes(s.status));
    body.appendChild(kpis([
      { label: 'Ruta', value: r.code, sub: `${F.date(r.route_date)} · ${r.slot_from || '—'}–${r.slot_to || '—'}` },
      { label: 'Asignada a', value: assignedText(r), sub: D.modeName(r.mode) },
      { label: 'Paradas', value: stops.length, sub: `${stops.filter(s => s.status === 'DELIVERED').length} entregadas · ${openStops.length} pendientes` },
      { label: 'A cobrar', value: F.money(U.sum(stops, s => D.codPending(s))), sub: `${plural(stops.filter(s => D.codPending(s) > 0).length, 'parada', 'paradas')} contra entrega` },
      { label: 'Recorrido', value: F.num(D.routeKm(r), 1) + ' km', sub: `${F.kg(D.routeKg(r.id), 1)} · orden ${r.sequence_method === 'MANUAL' ? 'manual' : 'sugerido'}` },
    ]));
    body.appendChild(h('div', { class: 'grid c2' }, card('Recorrido', routeMap([r], { height: 300, legend: 'Línea: orden de paradas desde el local y de vuelta' })), card('Datos de la ruta', h('div', { class: 'stack' }, dl([['Estado', D.routeBadge(r.status)], ['Vehículo', r.vehicle_id ? D.vehLabel(r.vehicle_id) : '—'], ['Repartidor', G.userName(r.driver_user_id)], ['Empresa', r.carrier_supplier_id ? G.supName(r.carrier_supplier_id) : '—'], ['Salida', F.datetime(r.departed_at)], ['Vuelta', F.datetime(r.returned_at)], ['Odómetro', r.odometer_start != null ? `${F.num(r.odometer_start, 1)} → ${r.odometer_end != null ? F.num(r.odometer_end, 1) : '…'}` : '—']]), editable ? h('div', { class: 'row' }, btn('Re-sugerir orden (vecino más cercano)', () => tryDo(() => D.resequence(r.id), 'Orden sugerido aplicado'), { sm: true }), btn('Asignar y cargar', () => G.go('DEL-02', { id: r.id }), { sm: true, kind: 'primary' })) : null))));
    const rows = stops.map(s => ({ s, o: order(s.order_id) }));
    body.appendChild(table({ id: 'del03', pageSize: 40, columns: [
      { key: 'seq', label: '#', align: 'c', value: x => x.s.seq, render: x => h('b', { class: 'mono' }, x.s.seq) },
      { key: 'num', label: 'Pedido', value: x => x.o.number, render: x => orderLink(x.o) },
      { key: 'addr', label: 'Cliente y dirección', value: x => G.custName(x.o.customer_id), render: x => h('div', null, custLine(x.o)) },
      { key: 'slot', label: 'Franja / ETA', value: x => D.slotOf(x.o), render: x => h('div', null, D.slotOf(x.o), h('div', { class: 'small muted' }, x.s.closed_at ? 'Cerrada ' + hm(x.s.closed_at) : x.s.eta ? 'ETA ' + hm(x.s.eta) : '')) },
      { key: 'bags', label: 'Bolsas', value: x => D.parcels(x.s).length, render: x => h('div', { class: 'stack', style: 'gap:2px' }, D.parcels(x.s).map(p => h('span', { class: 'small' }, h('span', { class: 'mono' }, p.label), ' ', D.bagBadge(p.status)))) },
      { key: 'cod', label: 'Cobrar', align: 'r', value: x => D.codPending(x.s), render: x => D.codPending(x.s) > 0 ? h('b', null, F.money(D.codPending(x.s))) : h('span', { class: 'muted' }, x.s.cod_amount ? 'Cobrado' : 'Pagado') },
      { key: 'tel', label: 'Teléfono', value: x => D.maskPhone(x.o.contact_phone), mono: true },
      { key: 'st', label: 'Estado', value: x => x.s.status, render: x => D.stopBadge(x.s.status) },
    ], rows, onRow: x => orderDrawer(x.o), actions: x => editable && ['PENDING'].includes(x.s.status) ? [btn('↑', () => tryDo(() => D.reorder(r.id, x.s.id, -1)), { sm: true, title: 'Subir' }), btn('↓', () => tryDo(() => D.reorder(r.id, x.s.id, 1)), { sm: true, title: 'Bajar' }), btn('Quitar', () => tryDo(() => D.removeStop(x.s.id), 'Parada quitada'), { sm: true, kind: 'ghost' })] : [], search: false }));
    body.appendChild(h('p', { class: 'small muted' }, 'El teléfono va enmascarado: el repartidor llama o escribe por el número de la empresa desde la app (DEL-05).'));
  }

  /* ---------- App del repartidor (marco de teléfono) ---------- */
  const appDriver = () => G.ctx.role === 'REPARTIDOR' ? G.ctx.userId() : (S.appDriver || (D.drivers()[0] || {}).id);
  const myRoutes = uid => db.where('delivery_routes', r => r.driver_user_id === uid && r.route_date === G.TODAY && r.status !== 'CANCELLED').sort((a, b) => (a.departed_at || 'z').localeCompare(b.departed_at || 'z'));
  function appShell(el, code, title, sub, build, side) {
    const body = page(el, { code, title, sub, actions: G.ctx.role !== 'REPARTIDOR' ? [h('select', { class: 'input', style: 'width:auto', attrs: { 'aria-label': 'Repartidor' }, on: { change: e => { S.appDriver = e.target.value; G.refresh(); } } }, D.drivers().map(u => h('option', { value: u.id, selected: u.id === appDriver() }, 'Ver como ' + u.name)))] : [] });
    const uid = appDriver();
    const net = h('label', { style: 'display:inline-flex;gap:6px;align-items:center;cursor:pointer;font-weight:700' }, h('input', { type: 'checkbox', checked: S.offline, attrs: { 'aria-label': 'Sin conexión' }, on: { change: e => { S.offline = e.target.checked; G.refresh(); } } }), S.offline ? 'Sin conexión' : 'En línea');
    const bar = h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 14px;background:var(--side);color:var(--side-ink);font-size:.82rem;position:sticky;top:0;z-index:2' }, h('span', null, `${G.userShort(uid)} · ${hm(D.now())}`), h('span', null, D.outbox.filter(x => !x.synced).length ? `${D.outbox.filter(x => !x.synced).length} por enviar · ` : '', net));
    const nav = h('div', { style: 'display:grid;grid-template-columns:repeat(5,1fr);border-top:1px solid var(--line);background:var(--surface);position:sticky;bottom:0' }, [['DEL-04', 'Rutas'], ['DEL-05', 'Parada'], ['DEL-17', 'Gastos'], ['DEL-21', 'Mensajes'], ['DEL-06', 'Liquidar']].map(([c, l]) => h('button', { class: 'btn ghost', style: 'border-radius:0;justify-content:center;min-height:48px;padding:0 2px;font-size:.78rem;' + (c === code ? 'color:var(--primary);font-weight:800' : ''), on: { click: () => G.go(c) } }, l)));
    const scr = h('div', { class: 'phone-screen' }, bar, h('div', { style: 'padding:12px;display:grid;gap:12px;align-content:start;flex:1' }, build(uid)), nav);
    const phone = h('div', { class: 'phone' }, scr);
    body.appendChild(h('div', { class: 'grid c2', style: 'align-items:start' }, phone, h('div', { class: 'stack' }, side ? side(uid) : null, outboxCard())));
  }
  const tile = (...kids) => h('div', { style: 'background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px;display:grid;gap:8px' }, ...kids);
  const big = (label, fn, kind = 'primary', disabled) => btn(label, fn, { kind, disabled });
  function outboxCard() {
    const pend = D.outbox.filter(x => !x.synced);
    return card('Cola sin conexión (RN-DEL-06)', h('div', { class: 'stack small' },
      h('p', { class: 'muted' }, 'Sin señal, la app guarda cada evento con un id del teléfono (client_event_id) y lo sube al recuperar la conexión. Un reenvío no se duplica.'),
      D.outbox.length ? h('div', { class: 'stack', style: 'gap:4px' }, D.outbox.slice(-8).reverse().map(x => h('div', { class: 'row between' }, h('span', null, `${x.label}`, h('span', { class: 'mono muted' }, ' ' + x.client_event_id)), badge(x.result || (x.synced ? 'Enviado' : 'Pendiente'), x.result === 'Duplicado ignorado' ? '' : x.error ? 'bad' : x.synced ? 'ok' : 'warn')))) : h('p', { class: 'muted' }, 'Cola vacía.'),
      h('div', { class: 'row' }, btn(`Sincronizar (${pend.length})`, () => syncOutbox(), { sm: true, kind: 'primary', disabled: !pend.length || S.offline }), btn('Reenviar lo último (prueba de duplicado)', () => { const last = D.outbox.filter(x => x.synced).slice(-1)[0]; if (!last) return toast('Aún no hay eventos enviados.', 'warn'); const res = D.syncEvent(last); D.outbox.push(Object.assign({}, last, { label: last.label + ' (reenvío)', result: res && res.duplicate ? 'Duplicado ignorado' : 'Registrado' })); toast(res && res.duplicate ? 'El evento ya estaba registrado: no se duplicó (CA-DEL-09)' : 'Registrado', 'ok'); G.refresh(); }, { sm: true }))));
  }
  function syncOutbox() {
    let ok = 0, bad = 0;
    for (const x of D.outbox.filter(y => !y.synced)) { try { const res = D.syncEvent(x); x.synced = true; x.result = res && res.duplicate ? 'Duplicado ignorado' : 'Enviado'; ok++; } catch (e) { x.synced = true; x.error = e.message; x.result = 'Rechazado'; bad++; toast(e.message, 'bad'); } }
    if (ok) toast(`${ok} evento(s) sincronizado(s)`, 'ok'); G.refresh();
  }
  /** acción de la app: en línea se registra; sin conexión se encola con su id del teléfono */
  function appAction(type, stop, payload, label) {
    const cid = D.newEventId();
    if (S.offline) { D.outbox.push({ client_event_id: cid, type, stop_id: stop.id, route_id: stop.route_id, payload, label, synced: false }); toast('Sin conexión: guardado en el teléfono, se enviará al sincronizar.', 'warn'); G.refresh(); return true; }
    try { const res = D.syncEvent({ client_event_id: cid, type, stop_id: stop.id, route_id: stop.route_id, payload }); D.outbox.push({ client_event_id: cid, type, stop_id: stop.id, route_id: stop.route_id, payload, label, synced: true, result: res && res.duplicate ? 'Duplicado ignorado' : 'Enviado' }); return res; } catch (e) { toast(e.message, 'bad'); return false; }
  }
  const posFor = (stop) => { const p = D.orderPt(order(stop.order_id)); const off = { PIN: 0.00012, M111: 0.001, M450: 0.00405 }[S.pos] || 0; return { lat: R(p[0] + off, 6), lng: p[1] }; };

  /* ---------- DEL-04 App: mis rutas ---------- */
  function scr04(el) {
    appShell(el, 'DEL-04', 'App: mis rutas', 'Rutas del día del repartidor con avance y paradas pendientes; funciona sin conexión (cola con id del teléfono).', uid => {
      const rs = myRoutes(uid);
      if (!rs.length) return [tile(h('b', null, 'Sin rutas hoy'), h('span', { class: 'small muted' }, 'El coordinador aún no te asignó rutas para hoy.'))];
      return rs.map(r => {
        const st = D.activeStops(r.id); const done = st.filter(s => ['DELIVERED', 'FAILED'].includes(s.status)).length; const b = bagCount(r.id);
        const odo = h('input', { class: 'input', type: 'number', placeholder: 'Odómetro', value: (D.vehicle(r.vehicle_id) || {}).odometer_km, attrs: { 'aria-label': 'Odómetro de salida' } });
        const scan = h('input', { class: 'input', placeholder: 'Escanear bolsa', attrs: { 'aria-label': 'Etiqueta de bolsa' } });
        return tile(
          h('div', { class: 'row between' }, h('b', { class: 'mono' }, r.code), D.routeBadge(r.status)),
          h('span', { class: 'small muted' }, `${D.vehLabel(r.vehicle_id)} · ${r.slot_from || ''}–${r.slot_to || ''} · ${F.num(r.planned_km, 1)} km`),
          G.ui.progress(st.length ? done / st.length * 100 : 0, 'ok'), h('span', { class: 'small' }, `${done} de ${st.length} paradas cerradas · ${F.money(U.sum(st, s => D.codPending(s)))} por cobrar`),
          ['PLANNED', 'LOADING'].includes(r.status) ? h('div', { class: 'stack' }, h('span', { class: 'small' }, `Bolsas cargadas ${b.l} de ${b.n} (RN-DEL-04)`), h('div', { class: 'row' }, scan, btn('Cargar', () => tryDo(() => D.loadParcel(r.id, scan.value), x => x.already ? 'Ya estaba cargada' : `Bolsa ${x.parcel.label} cargada`), { sm: true })), h('div', { class: 'row' }, odo, btn('Salir', () => tryDo(() => D.depart(r.id, { odometer_start: odo.value }), 'Saliste a ruta: los clientes recibieron «va en camino»'), { kind: 'accent' }))) : null,
          r.status === 'IN_ROUTE' ? h('div', { class: 'stack', style: 'gap:6px' }, st.filter(s => ['PENDING', 'ARRIVED'].includes(s.status)).map(s => { const o = order(s.order_id); const queued = D.outbox.some(x => !x.synced && x.stop_id === s.id); return h('button', { class: 'btn', style: 'justify-content:space-between;min-height:52px;text-align:left', on: { click: () => G.go('DEL-05', { stop: s.id }) } }, h('span', null, h('b', null, `${s.seq}. ${G.custName(o.customer_id).split(' ').slice(0, 2).join(' ')}`), h('br'), h('span', { class: 'small muted' }, `${G.zoneName(o.zone_id)} · ETA ${hm(s.eta)}${D.codPending(s) ? ' · cobrar ' + F.money(D.codPending(s)) : ''}`)), queued ? badge('Por enviar', 'warn') : D.stopBadge(s.status)); })) : null,
          r.status === 'IN_ROUTE' && !st.some(s => ['PENDING', 'ARRIVED'].includes(s.status)) ? btn('Volver al local y liquidar', () => G.go('DEL-06'), { kind: 'primary' }) : null,
          ['RETURNED', 'SETTLED'].includes(r.status) ? h('span', { class: 'small muted' }, r.status === 'SETTLED' ? 'Ruta liquidada.' : 'Ruta de vuelta: liquida tu caja en DEL-06.') : null);
      });
    }, uid => card('Resumen del día', dl([['Repartidor', G.userName(uid)], ['Caja', (db.get('cash_accounts', D.driverAccount(uid)) || {}).name || '—'], ['Rutas', myRoutes(uid).length], ['Entregas', U.sum(myRoutes(uid), r => D.activeStops(r.id).filter(s => s.status === 'DELIVERED').length)], ['Por cobrar', F.money(U.sum(myRoutes(uid), r => U.sum(D.activeStops(r.id), s => D.codPending(s))))]])));
  }

  /* ---------- DEL-05 App: parada ---------- */
  function scr05(el, params) {
    appShell(el, 'DEL-05', 'App: parada', 'Navegación, «Llegué», llamar o WhatsApp por el número de la empresa, cobro contra entrega, prueba de entrega con foto y código o firma, no entregado e incidencias.', uid => {
      let s = params && params.stop && db.get('delivery_stops', params.stop);
      if (!s) { const r = myRoutes(uid).find(x => x.status === 'IN_ROUTE'); s = r && D.activeStops(r.id).find(x => ['PENDING', 'ARRIVED'].includes(x.status)); }
      if (!s) return [tile(h('b', null, 'Sin paradas pendientes'), h('span', { class: 'small muted' }, 'No tienes una ruta en curso con paradas abiertas.'), btn('Mis rutas', () => G.go('DEL-04')))];
      const r = db.get('delivery_routes', s.route_id); const o = order(s.order_id); const a = db.get('customer_addresses', o.address_id) || {};
      const open = ['PENDING', 'ARRIVED'].includes(s.status);
      const out = [];
      out.push(tile(h('div', { class: 'row between' }, h('b', null, `Parada ${s.seq} · ${o.number}`), D.stopBadge(s.status)), h('div', null, h('b', null, G.custName(o.customer_id).split(' ')[0]), ' · ', G.brandName(o.brand_id)), h('div', { class: 'small' }, a.address_line || '—'), a.reference ? h('div', { class: 'small muted' }, 'Ref.: ' + a.reference) : null, h('div', { class: 'small' }, `Franja ${D.slotOf(o)} · ETA ${hm(s.eta)}`), h('div', { class: 'row', style: 'gap:4px' }, D.parcels(s).map(p => h('span', { class: 'small' }, h('span', { class: 'mono' }, p.label), ' ', D.bagBadge(p.status)))), o.notes ? h('div', { class: 'small muted' }, 'Nota: ' + o.notes) : null));
      out.push(G.ui.map({ points: [{ lat: D.orderPt(o)[0], lng: D.orderPt(o)[1], label: s.seq, tone: 'warn', title: 'Destino' }], routes: [{ points: [D.lastPosition(r) ? [D.lastPosition(r).lat, D.lastPosition(r).lng] : D.sitePt(r.establishment_id), D.orderPt(o)], tone: 'info' }], height: 180, highlightZone: o.zone_id, bounds: D.fit([D.lastPosition(r) ? [D.lastPosition(r).lat, D.lastPosition(r).lng] : D.sitePt(r.establishment_id), D.orderPt(o)], 180) }));
      if (!open) { out.push(...D.stopExtras.flatMap(f => f(s, o, r, open) || [])); out.push(tile(h('span', null, `Parada cerrada a las ${hm(s.closed_at)}${s.pod_distance_m != null ? ` · prueba a ${F.num(s.pod_distance_m, 0)} m del pin` : ''}.`), btn('Volver a mis rutas', () => G.go('DEL-04')))); return out; }
      out.push(h('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px' }, big('Llegué', () => { if (appAction('ARRIVED', s, posFor(s), `Llegada parada ${s.seq}`)) { toast('Llegada registrada', 'ok'); G.refresh(); } }, s.status === 'ARRIVED' ? '' : 'primary', s.status === 'ARRIVED'), btn('Llamar', () => { if (D.noSignal(o)) return toast('Esta zona no tiene señal de llamada: escribe por WhatsApp.', 'warn'); D.contact(s.id, 'CALL'); toast(`Llamando por el número de la empresa ${D.companyNumber(o)} (el cliente no ve tu número)`, 'info'); }, { disabled: D.noSignal(o), title: D.noSignal(o) ? 'Zona sin señal de llamada: solo WhatsApp' : '' }), btn('WhatsApp', () => { D.contact(s.id, 'WHATSAPP'); toast(`Chat abierto desde ${D.companyNumber(o)}`, 'info'); })));
      out.push(h('div', { class: 'small muted' }, 'Posición simulada: ', pills([['PIN', 'En el pin'], ['M111', 'A 111 m'], ['M450', 'A 450 m']], S.pos, v => { S.pos = v; G.refresh(); })));
      out.push(...D.stopExtras.flatMap(f => f(s, o, r, open) || []));
      const pend = D.codPending(s);
      if (pend > 0) {
        const m = h('select', { class: 'input', attrs: { 'aria-label': 'Medio de cobro' } }, D.COD_METHODS.map(([v, l]) => h('option', { value: v }, l)));
        const ref = h('input', { class: 'input', placeholder: 'N.° de operación (Yape/Plin) o 4 últimos dígitos (POS)', attrs: { 'aria-label': 'Referencia' } });
        out.push(tile(h('b', null, `Cobrar ${F.money(pend)} (RN-DEL-09)`), h('span', { class: 'small muted' }, `Va a tu caja ${(db.get('cash_accounts', D.driverAccount(r.driver_user_id)) || {}).code || ''}. Solo medios de la empresa.`), m, ref, big('Registrar cobro', () => { const meth = m.value; const p = { method: meth, amount: pend, reference: ['pm-YAPE', 'pm-PLIN'].includes(meth) ? ref.value.trim() : null, card_last4: meth === 'pm-CARD' ? ref.value.trim() : null }; if (appAction('COD_COLLECTED', s, p, `Cobro ${F.money(pend)} parada ${s.seq}`)) { toast('Cobro registrado en tu caja', 'ok'); G.refresh(); } })));
      }
      const code = h('input', { class: 'input', inputmode: 'numeric', maxlength: 4, placeholder: 'Código de 4 dígitos', attrs: { 'aria-label': 'Código de entrega' } });
      const recv = h('input', { class: 'input', placeholder: 'Quién recibe (opcional)', attrs: { 'aria-label': 'Quién recibe' } });
      const sig = h('canvas', { width: 300, height: 90, style: 'width:100%;max-width:300px;height:90px;border:1px dashed var(--line);border-radius:8px;background:var(--surface-2);touch-action:none;display:' + (S.sign ? 'block' : 'none'), attrs: { 'aria-label': 'Firma del cliente' } });
      let signed = false;
      (function () { const c = sig.getContext && sig.getContext('2d'); if (!c) return; let on = false; const p = e => { const b = sig.getBoundingClientRect(); return [(e.clientX - b.left) / b.width * 300, (e.clientY - b.top) / b.height * 90]; }; sig.addEventListener('pointerdown', e => { on = true; c.beginPath(); c.moveTo(...p(e)); }); sig.addEventListener('pointermove', e => { if (on) { c.lineTo(...p(e)); c.strokeStyle = '#922242'; c.lineWidth = 2; c.stroke(); signed = true; } }); sig.addEventListener('pointerup', () => { on = false; }); })();
      out.push(tile(h('b', null, 'Prueba de entrega (RN-DEL-06)'),
        h('div', { class: 'row' }, btn(S.photo ? 'Foto tomada ✓' : 'Tomar foto', () => { S.photo = !S.photo; G.refresh(); }, { kind: S.photo ? 'ok' : '' }), btn(S.sign ? 'Usar código' : 'Pedir firma', () => { S.sign = !S.sign; G.refresh(); })),
        S.photo ? h('div', { style: 'height:70px;border-radius:8px;background:repeating-linear-gradient(45deg,var(--surface-2),var(--surface-2) 8px,var(--line) 8px,var(--line) 16px);display:grid;place-items:center;font-size:.8rem' }, 'Foto del pedido entregado (simulada)') : null,
        S.sign ? h('span', { class: 'small muted' }, 'Firma aquí con el dedo (D-DEL-06: firma si el cliente no tiene el código)') : code, sig, recv,
        big('Entregado', () => { const p = Object.assign({ photo: S.photo, code: S.sign ? null : code.value.trim(), signature: S.sign ? (signed || true) : null, receiver: recv.value.trim() || null }, posFor(s)); if (!S.offline) { try { if (!p.photo) G.fail('RN-DEL-06', 'La entrega exige foto: toma la foto del pedido entregado.'); } catch (e) { return toast(e.message, 'bad'); } } const res = appAction('DELIVERED', s, p, `Entrega parada ${s.seq}`); if (res) { S.photo = false; S.sign = false; const st = db.get('delivery_stops', s.id); toast(st.status === 'DELIVERED' ? `Entregado${st.pod_distance_m != null ? ' a ' + F.num(st.pod_distance_m, 0) + ' m del pin' : ''}` : 'Guardado para enviar', 'ok'); const next = D.activeStops(r.id).find(x => ['PENDING', 'ARRIVED'].includes(x.status) && x.id !== s.id); G.go(next ? 'DEL-05' : 'DEL-04', next ? { stop: next.id } : {}); } }, 'accent')));
      const reason = h('select', { class: 'input', attrs: { 'aria-label': 'Motivo' } }, D.REASONS.map(([v, l]) => h('option', { value: v }, l)));
      const notes = h('input', { class: 'input', placeholder: 'Detalle (opcional)', attrs: { 'aria-label': 'Detalle' } });
      out.push(tile(h('b', null, 'No entregado (RN-DEL-07)'), reason, notes, h('span', { class: 'small muted' }, 'Exige foto (usa «Tomar foto» arriba). Las bolsas vuelven al local y el pedido queda para reprogramar.'), big('Marcar no entregado', () => { const p = Object.assign({ reason: reason.value, photo: S.photo, notes: notes.value.trim() }, posFor(s)); if (appAction('FAILED', s, p, `No entregado parada ${s.seq}`)) { S.photo = false; toast('No entregado registrado', 'warn'); G.go('DEL-04'); } }, 'danger')));
      const itype = h('select', { class: 'input', attrs: { 'aria-label': 'Incidencia' } }, D.INCIDENTS.map(([v, l]) => h('option', { value: v }, l)));
      const inote = h('input', { class: 'input', placeholder: 'Qué pasó', attrs: { 'aria-label': 'Detalle de la incidencia' } });
      out.push(tile(h('b', null, 'Incidencia'), itype, inote, btn('Reportar al coordinador', () => { if (appAction('INCIDENT', s, { type: itype.value, notes: inote.value.trim() }, `Incidencia parada ${s.seq}`)) { toast('Incidencia enviada al coordinador', 'ok'); G.refresh(); } })));
      return out;
    }, uid => { const r = myRoutes(uid).find(x => x.status === 'IN_ROUTE'); return r ? card('Eventos de la ruta (solo inserción)', h('div', { class: 'timeline' }, db.where('delivery_events', e => e.route_id === r.id && e.event_type !== 'POSITION').sort(U.by('occurred_at', -1)).slice(0, 10).map(e => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, hm(e.occurred_at)), h('span', { class: 'dot' }), h('div', { class: 'small' }, { DEPARTED: 'Salida', ARRIVED: 'Llegada', DELIVERED: 'Entregado', FAILED: 'No entregado', INCIDENT: 'Incidencia', COD_COLLECTED: 'Cobro', CALL: 'Llamada', WHATSAPP: 'WhatsApp', RETURNED: 'Vuelta' }[e.event_type] || e.event_type, e.stop_id ? ` · parada ${(db.get('delivery_stops', e.stop_id) || {}).seq}` : '', e.amount ? ' · ' + F.money(e.amount) : '', e.notes ? h('div', { class: 'muted' }, e.notes) : null))))) : null; });
  }

  /* ---------- DEL-06 App: liquidación ---------- */
  function scr06(el) {
    appShell(el, 'DEL-06', 'App: liquidación', 'Al volver: efectivo y cobros digitales esperados, efectivo contado y diferencia; se envía a caja (driver_settlements). La ruta queda LIQUIDADA con la liquidación conforme o aprobada (RN-DEL-10).', uid => {
      const rs = myRoutes(uid).filter(r => r.mode !== 'THIRD_PARTY');
      const out = [];
      for (const r of rs.filter(x => x.status === 'IN_ROUTE')) {
        const open = D.activeStops(r.id).filter(s => ['PENDING', 'ARRIVED'].includes(s.status)).length;
        const odo = h('input', { class: 'input', type: 'number', placeholder: 'Odómetro de llegada', value: r.odometer_start != null ? R(r.odometer_start + (r.planned_km || 0), 1) : '', attrs: { 'aria-label': 'Odómetro de llegada' } });
        out.push(tile(h('div', { class: 'row between' }, h('b', { class: 'mono' }, r.code), D.routeBadge(r.status)), h('span', { class: 'small' }, open ? `Quedan ${open} parada(s) abiertas: ciérralas antes de volver.` : 'Todas las paradas cerradas.'), odo, big('Llegué al local', () => tryDo(() => D.returnRoute(r.id, { odometer_end: odo.value }), 'Vuelta registrada: liquida tu caja'), 'primary', !!open)));
      }
      for (const r of rs.filter(x => ['RETURNED', 'SETTLED'].includes(x.status))) {
        const exp = D.expectedCash(r.id); const st = D.settlementOf(r.id);
        if (r.status === 'RETURNED' && (!st || st.status === 'OPEN')) {
          const cnt = h('input', { class: 'input', type: 'number', step: '0.01', placeholder: 'Efectivo contado', attrs: { 'aria-label': 'Efectivo contado' } });
          const why = h('input', { class: 'input', placeholder: 'Motivo si hay diferencia (RN-CAJ-10)', attrs: { 'aria-label': 'Motivo de la diferencia' } });
          const diff = h('b', null, '—');
          cnt.addEventListener('input', () => { const d = R(Number(cnt.value || 0) - exp.cash); diff.textContent = F.money(d); diff.style.color = Math.abs(d) > 0.009 ? 'var(--bad)' : 'var(--ok)'; });
          out.push(tile(h('div', { class: 'row between' }, h('b', { class: 'mono' }, r.code), D.routeBadge(r.status)), dl([['Cobrado en efectivo', F.money(exp.gross)], ['Gastos de ruta (combustible, comida, peajes…)', '− ' + F.money(exp.expenses)], ['Efectivo a entregar', F.money(exp.cash)], ['Digital (Yape, Plin, POS)', F.money(exp.digital)], ['Cobros', exp.payments.length]]), cnt, h('div', { class: 'row between small' }, h('span', null, 'Diferencia'), diff), why, big('Enviar liquidación', () => tryDo(() => D.settle(r.id, { counted_cash: cnt.value === '' ? null : Number(cnt.value), reason: why.value.trim() }), x => x.status === 'SETTLED' ? 'Liquidación conforme: ruta LIQUIDADA' : 'Liquidación con diferencia: queda para aprobación'))));
        } else out.push(tile(h('div', { class: 'row between' }, h('b', { class: 'mono' }, r.code), D.routeBadge(r.status)), st ? dl([['Liquidación', st.number], ['Esperado', F.money(st.expected_cash)], ['Entregado', F.money(st.delivered_cash)], ['Diferencia', F.money(st.difference)], ['Estado', sb(LST, st.status)]]) : h('span', { class: 'small muted' }, 'Sin liquidación.')));
      }
      if (!out.length) out.push(tile(h('b', null, 'Nada por liquidar'), h('span', { class: 'small muted' }, 'Cuando vuelvas al local, registra la llegada y liquida tu caja aquí.')));
      return out;
    }, () => {
      const pend = db.where('driver_settlements', x => x.status === 'WITH_DIFFERENCE').sort(U.by('settlement_date', -1));
      return card('Liquidaciones con diferencia por aprobar', pend.length ? h('div', { class: 'stack small' }, pend.map(st => { const r = db.get('delivery_routes', st.route_ref); return h('div', { class: 'stack', style: 'gap:4px;border-bottom:1px solid var(--line);padding-bottom:8px' }, h('div', { class: 'row between' }, h('b', null, `${st.number} · ${r ? r.code : ''}`), sb(LST, st.status)), h('span', null, `${F.date(st.settlement_date)} · ${(db.get('employees', st.driver_employee_id) || {}).full_name || ''} · diferencia ${F.money(st.difference)}`), h('span', { class: 'muted' }, st.difference_reason || ''), G.ctx.role !== 'REPARTIDOR' ? btn('Aprobar', () => tryDo(() => D.approveSettlement(st.id), 'Liquidación aprobada: ruta LIQUIDADA'), { sm: true, kind: 'primary' }) : null); })) : h('p', { class: 'small muted' }, 'No hay liquidaciones con diferencia.'));
    });
  }

  /* ---------- DEL-07 Seguimiento en mapa ---------- */
  function scr07(el) {
    const body = page(el, { code: 'DEL-07', title: 'Seguimiento en mapa', sub: 'Rutas en curso con la última posición (por evento y cada 2 min con la app abierta), paradas hechas, atrasadas y entregas fuera del radio.', actions: [estPills()] });
    if (!G.can('del.tracking.view') && G.ctx.role !== 'AUDITOR') { body.appendChild(notice('Tu rol no ve el mapa de seguimiento (del.tracking.view).', 'warn')); return; }
    const now = D.now(); const max = G.param('del_pod_max_distance_m') ?? 300;
    const rs = routesOf(G.TODAY).filter(r => ['IN_ROUTE', 'RETURNED', 'SETTLED'].includes(r.status) && r.departed_at);
    const live = rs.filter(r => r.status === 'IN_ROUTE');
    const lateOf = r => D.activeStops(r.id).filter(s => ['PENDING', 'ARRIVED'].includes(s.status) && ((s.eta && order(s.order_id).slot_to && hm(s.eta) > order(s.order_id).slot_to) || (order(s.order_id).slot_to && hm(now) > order(s.order_id).slot_to)));
    const farOf = r => D.activeStops(r.id).filter(s => s.status === 'DELIVERED' && s.pod_distance_m > max);
    const pts = [], lines = [];
    live.forEach((r, i) => {
      const kp = D.timeline(r); lines.push({ points: kp.map(k => k.pt), tone: TONES[(i + 1) % TONES.length] });
      const late = new Set(lateOf(r).map(s => s.id)), far = new Set(farOf(r).map(s => s.id));
      for (const s of D.activeStops(r.id)) { const o = order(s.order_id); const p = D.orderPt(o); pts.push({ lat: p[0], lng: p[1], label: s.seq, tone: far.has(s.id) ? 'warn' : s.status === 'DELIVERED' ? 'ok' : s.status === 'FAILED' ? 'bad' : late.has(s.id) ? 'bad' : 'muted', title: `${r.code} · ${s.seq} · ${o.number} · ${SST[s.status][0]}${far.has(s.id) ? ` · prueba a ${F.num(s.pod_distance_m, 0)} m del pin` : ''}${late.has(s.id) ? ' · atrasada' : ''}`, onClick: () => orderDrawer(o) }); }
      const lp = D.lastPosition(r); if (lp) pts.push({ lat: lp.lat, lng: lp.lng, label: (D.vehicle(r.vehicle_id) || {}).plate ? (D.vehicle(r.vehicle_id).plate.slice(0, 3)) : 'T', tone: 'info', r: 11, title: `${r.code} · ${assignedText(r)} · última posición ${hm(lp.at)}` });
    });
    const incidents = db.where('delivery_events', e => e.event_type === 'INCIDENT' && String(e.occurred_at).slice(0, 10) === G.TODAY).sort(U.by('occurred_at', -1));
    body.appendChild(kpis([
      { label: 'Rutas en curso', value: live.length, sub: `${rs.length - live.length} ya volvieron` },
      { label: 'Entregadas hoy', value: U.sum(rs, r => D.activeStops(r.id).filter(s => s.status === 'DELIVERED').length), sub: `${U.sum(live, r => D.activeStops(r.id).filter(s => ['PENDING', 'ARRIVED'].includes(s.status)).length)} pendientes`, tone: 'ok' },
      { label: 'Atrasadas', value: U.sum(live, r => lateOf(r).length), sub: 'ETA u hora actual fuera de la franja', tone: U.sum(live, r => lateOf(r).length) ? 'bad' : 'ok' },
      { label: 'Fuera del radio', value: U.sum(rs, r => farOf(r).length), sub: `prueba a más de ${max} m del pin (RN-DEL-06)`, tone: U.sum(rs, r => farOf(r).length) ? 'warn' : 'ok' },
      { label: 'Incidencias hoy', value: incidents.length, tone: incidents.length ? 'warn' : 'ok' },
    ]));
    body.appendChild(h('div', { class: 'grid side-r' }, card(`Mapa · ${hm(now)}`, G.ui.map({ points: pts, routes: lines, height: 380, bounds: D.fit(pts.map(p => [p.lat, p.lng]).concat(lines.flatMap(l => l.points)), 380), legend: 'Círculo grande: última posición · verde: entregada · rojo: no entregada o atrasada · ámbar: fuera del radio · gris: pendiente' })),
      card('Incidencias de hoy', incidents.length ? h('div', { class: 'stack small' }, incidents.map(e => { const s = db.get('delivery_stops', e.stop_id); const r = db.get('delivery_routes', e.route_id); return h('div', { style: 'border-bottom:1px solid var(--line);padding-bottom:6px' }, h('div', { class: 'row between' }, h('b', null, D.incidentName(e.incident_type) || 'Incidencia'), h('span', { class: 'mono muted' }, hm(e.occurred_at))), h('div', null, `${r ? r.code : ''} · parada ${s ? s.seq : ''} · ${s ? (order(s.order_id) || {}).number : ''}`), h('div', { class: 'muted' }, e.notes || '')); })) : h('p', { class: 'small muted' }, 'Sin incidencias.'))));
    body.appendChild(table({ id: 'del07', columns: [
      { key: 'code', label: 'Ruta', mono: true },
      { key: 'who', label: 'Repartidor / vehículo', value: r => assignedText(r) },
      { key: 'st', label: 'Estado', value: r => r.status, render: r => D.routeBadge(r.status) },
      { key: 'prog', label: 'Avance', value: r => { const st = D.activeStops(r.id); return st.filter(s => ['DELIVERED', 'FAILED'].includes(s.status)).length / (st.length || 1); }, render: r => { const st = D.activeStops(r.id); const d = st.filter(s => ['DELIVERED', 'FAILED'].includes(s.status)).length; return h('div', { style: 'min-width:110px' }, G.ui.progress(d / (st.length || 1) * 100, 'ok'), h('span', { class: 'small' }, `${d}/${st.length}`)); } },
      { key: 'last', label: 'Última posición', value: r => (D.lastPosition(r) || {}).at || '', render: r => { const lp = D.lastPosition(r); if (!lp) return '—'; const m = Math.round(minutesBetween(lp.at, now)); return h('span', { class: m > 10 && r.status === 'IN_ROUTE' ? 'badge warn' : '' }, `${hm(lp.at)} (hace ${m} min)`); } },
      { key: 'next', label: 'Próxima parada', value: r => { const s = D.activeStops(r.id).find(x => ['PENDING', 'ARRIVED'].includes(x.status)); return s ? `${s.seq} · ETA ${hm(s.eta)}` : '—'; } },
      { key: 'late', label: 'Atrasadas', align: 'r', value: r => r.status === 'IN_ROUTE' ? lateOf(r).length : 0 },
      { key: 'far', label: 'Fuera de radio', align: 'r', value: r => farOf(r).length },
    ], rows: rs, onRow: r => G.go('DEL-03', { id: r.id }), empty: 'No hay rutas en curso hoy.' }));
  }

  /* ---------- DEL-08 Enlace de seguimiento ---------- */
  function scr08(el, params) {
    const body = page(el, { code: 'DEL-08', title: 'Enlace de seguimiento', sub: 'Página pública por pedido con token aleatorio: estado, hora estimada y nombre de pila del repartidor; sin datos de otros clientes. Vence 48 h después de la entrega (RN-DEL-08).' });
    const links = db.where('tracking_links', t => { const o = order(t.order_id); return o && G.scope.ok(o); }).sort(U.by('created_at', -1));
    const now = D.now();
    const stOf = t => t.revoked ? 'REVOKED' : String(now) > String(t.expires_at).slice(0, 16) ? 'EXPIRED' : 'ACTIVE';
    let cur = (params && params.token && links.find(t => t.token === params.token)) || (S.token && links.find(t => t.token === S.token)) || links.find(t => stOf(t) === 'ACTIVE' && order(t.order_id).status === 'IN_ROUTE') || links[0];
    const [mode, setMode] = [S.trkMode || 'NOW', v => { S.trkMode = v; G.refresh(); }];
    const left = table({ id: 'del08', columns: [
      { key: 'num', label: 'Pedido', value: t => order(t.order_id).number, mono: true },
      { key: 'cust', label: 'Cliente', value: t => G.custName(order(t.order_id).customer_id) },
      { key: 'ost', label: 'Pedido', value: t => order(t.order_id).status, render: t => G.ui.status(order(t.order_id).status) },
      { key: 'exp', label: 'Vence', value: t => t.expires_at, render: t => F.datetime(t.expires_at) },
      { key: 'st', label: 'Enlace', value: t => stOf(t), render: t => ({ ACTIVE: badge('Vigente', 'ok'), EXPIRED: badge('Vencido', ''), REVOKED: badge('Anulado', 'bad') })[stOf(t)] },
    ], rows: links, onRow: t => { S.token = t.token; G.refresh(); }, actions: t => !t.revoked && G.can('del.route.plan') ? [btn('Anular', () => tryDo(() => db.update('tracking_links', t.id, { revoked: true }), 'Enlace anulado'), { sm: true, kind: 'ghost' })] : [], filters: [{ key: 'st', label: 'Enlace', options: [['ACTIVE', 'Vigente'], ['EXPIRED', 'Vencido'], ['REVOKED', 'Anulado']], value: t => stOf(t) }] });
    let preview;
    if (!cur) preview = notice('Aún no hay enlaces: se crean al salir la ruta.', 'info');
    else {
      const o = order(cur.order_id);
      const at = mode === 'NOW' ? now : tsAdd(String(cur.expires_at).slice(0, 16), 60);
      const v = D.publicView(cur.token, at);
      const steps = ['CONFIRMED', 'READY', 'IN_ROUTE', 'DELIVERED'];
      const idx = v.status ? Math.max(steps.indexOf(v.status === 'CLOSED' ? 'DELIVERED' : ['IN_PREPARATION', 'WEIGHED'].includes(v.status) ? 'CONFIRMED' : v.status), 0) : 0;
      preview = h('div', { class: 'stack' },
        h('div', { class: 'row' }, pills([['NOW', 'Ver ahora'], ['LATER', 'Ver 1 h después del vencimiento']], mode, setMode)),
        h('div', { class: 'phone', style: 'width:340px' }, h('div', { class: 'phone-screen', style: 'height:auto;min-height:420px' },
          h('div', { style: 'padding:10px 14px;background:var(--side);color:var(--side-ink);font-size:.78rem' }, D.trackingUrl(cur)),
          h('div', { style: 'padding:16px;display:grid;gap:12px' },
            h('b', { style: 'font-size:1.15rem' }, `${v.brand || G.brandName(o.brand_id)} · Seguimiento de tu pedido`),
            v.error ? notice(v.error, 'warn') : [
              h('div', { class: 'steps' }, steps.map((x, i) => h('div', { class: 'step' + (i < idx ? ' done' : i === idx ? ' cur' : '') }, { CONFIRMED: 'Confirmado', READY: 'Listo', IN_ROUTE: 'En camino', DELIVERED: 'Entregado' }[x]))),
              dl([['Pedido', v.number], ['Franja', v.slot], v.eta ? ['Llega aprox.', v.eta] : null, v.delivered_at ? ['Entregado', F.datetime(v.delivered_at)] : null, v.driver ? ['Te lo lleva', v.driver] : null, v.stops_before != null && v.status === 'IN_ROUTE' ? ['Entregas antes de la tuya', v.stops_before] : null]),
              h('p', { class: 'small muted' }, 'Ten a la mano tu código de entrega de 4 dígitos del mensaje de WhatsApp.')]))));
    }
    body.appendChild(h('div', { class: 'grid c2', style: 'align-items:start' }, left, card('Vista pública', preview)));
  }

  /* ---------- DEL-09 Empresas de delivery y tarifas ---------- */
  function scr09(el) {
    const can = G.can('del.carrier.manage');
    const body = page(el, { code: 'DEL-09', title: 'Empresas de delivery y tarifas', sub: 'Proveedores de tipo empresa de delivery con tarifas por envío, zona, día o kg y su vigencia (D-DEL-01: por envío sin zona mientras no se conozcan otras).', actions: [btn('Nueva tarifa', () => G.require('del.carrier.manage', () => rateForm()), { kind: 'primary', icon: '+', disabled: !can })] });
    const cs = D.carriers(); const m = G.date.month(G.TODAY);
    body.appendChild(h('div', { class: 'grid c3' }, cs.map(c => { const ships = D.carrierStops(c.id, m, G.TODAY); const rate = D.rateFor(c.id, null, G.TODAY) || D.rateFor(c.id, 'dz-PROVINCIA', G.TODAY); return card(c.trade_name, dl([['RUC', c.doc_number], ['Pago', c.payment_terms_days ? `${c.payment_terms_days} días` : 'Contado'], ['Tarifa vigente', rate ? `${F.money(rate.amount)} ${{ PER_DELIVERY: 'por envío', PER_DAY: 'por día', PER_KG: 'por kg' }[rate.rate_basis]}` : 'Sin tarifa'], ['Envíos del mes', ships.length], ['Esperado del mes', F.money(U.sum(ships, x => D.expectedFor(c.id, x)))]])); })));
    body.appendChild(table({ id: 'del09', columns: [
      { key: 'sup', label: 'Empresa', value: x => G.supName(x.supplier_id) },
      { key: 'zone', label: 'Zona', value: x => x.zone_id ? G.zoneName(x.zone_id) : 'Todas' },
      { key: 'basis', label: 'Base', value: x => ({ PER_DELIVERY: 'Por envío', PER_DAY: 'Por día', PER_KG: 'Por kg' })[x.rate_basis] },
      { key: 'amount', label: 'Monto', align: 'r', value: x => x.amount, render: x => F.money(x.amount) },
      { key: 'from', label: 'Desde', value: x => x.valid_from, render: x => F.date(x.valid_from) },
      { key: 'to', label: 'Hasta', value: x => x.valid_to || '', render: x => x.valid_to ? F.date(x.valid_to) : 'Vigente' },
      { key: 'st', label: 'Estado', value: x => (x.valid_from <= G.TODAY && (!x.valid_to || x.valid_to >= G.TODAY)) ? 'Vigente' : x.valid_from > G.TODAY ? 'Futura' : 'Vencida', render: x => (x.valid_from <= G.TODAY && (!x.valid_to || x.valid_to >= G.TODAY)) ? badge('Vigente', 'ok') : badge(x.valid_from > G.TODAY ? 'Futura' : 'Vencida', '') },
    ], rows: db.where('carrier_rates', x => x.status !== 'VOIDED').sort(U.by('valid_from', -1)), onRow: x => can && rateForm(x), actions: x => can && !x.valid_to ? [btn('Cerrar vigencia', () => tryDo(() => db.update('carrier_rates', x.id, { valid_to: G.TODAY }), 'Vigencia cerrada hoy'), { sm: true, kind: 'ghost' })] : [], filters: [{ key: 'supplier_id', label: 'Empresa', options: cs.map(c => [c.id, c.trade_name]) }] }));
  }
  function rateForm(x) {
    drawer(x ? 'Editar tarifa' : 'Nueva tarifa', (bd, close) => bd.appendChild(form({ id: 'del-rate', fields: [
      { key: 'supplier_id', label: 'Empresa de delivery', type: 'select', required: true, options: D.carriers().map(c => [c.id, c.trade_name]) },
      { key: 'zone_id', label: 'Zona (vacío = todas)', type: 'select', options: G.ui.opts('delivery_zones', z => z.name) },
      { key: 'rate_basis', label: 'Base', type: 'select', required: true, options: [['PER_DELIVERY', 'Por envío'], ['PER_DAY', 'Por día'], ['PER_KG', 'Por kg']] },
      { key: 'amount', label: 'Monto (S/)', type: 'money', required: true, min: 0 },
      { key: 'valid_from', label: 'Vigente desde', type: 'date', required: true },
      { key: 'valid_to', label: 'Hasta (opcional)', type: 'date' },
    ], values: x ? Object.assign({}, x) : { valid_from: G.TODAY, rate_basis: 'PER_DELIVERY' }, onCancel: close, onSubmit: v => { D.saveRate(v, x && x.id); close(); toast('Tarifa guardada', 'ok'); G.refresh(); return true; } })), { code: 'DEL-09' });
  }

  /* ---------- DEL-10 Conciliación de terceros ---------- */
  function scr10(el) {
    const can = G.can('del.carrier_invoice.reconcile');
    const body = page(el, { code: 'DEL-10', title: 'Conciliación de terceros', sub: 'Factura de la empresa de delivery contra sus envíos entregados o fallidos × tarifa vigente: líneas no registradas, no facturadas y con diferencia (RN-DEL-11).', actions: [btn('Registrar factura', () => G.require('del.carrier_invoice.reconcile', () => invoiceForm()), { kind: 'primary', icon: '+', disabled: !can })] });
    const invs = db.all('carrier_invoices').sort(U.by('issue_date', -1));
    body.appendChild(kpis([
      { label: 'Facturas', value: invs.length, sub: `${invs.filter(i => i.status === 'OBSERVED').length} observadas` },
      { label: 'Facturado', value: F.money(U.sum(invs, i => i.amount)) },
      { label: 'Esperado', value: F.money(U.sum(invs, i => i.expected_amount || 0)) },
      { label: 'Diferencia absoluta', value: F.money(U.sum(invs, i => Math.abs(i.difference || 0))), sub: `tolerancia ${F.money(G.param('del_carrier_tolerance_pen') ?? 2)} (del_carrier_tolerance_pen)`, tone: invs.some(i => i.status === 'OBSERVED') ? 'bad' : 'ok' },
    ]));
    body.appendChild(table({ id: 'del10', columns: [
      { key: 'sup', label: 'Empresa', value: i => G.supName(i.supplier_id) },
      { key: 'invoice_number', label: 'Factura', mono: true },
      { key: 'issue', label: 'Emisión', value: i => i.issue_date, render: i => F.date(i.issue_date) },
      { key: 'per', label: 'Período', value: i => i.period_from, render: i => `${F.date(i.period_from)} – ${F.date(i.period_to)}` },
      { key: 'ships', label: 'Envíos', align: 'r', value: i => i.shipments ?? '' },
      { key: 'amount', label: 'Facturado', align: 'r', value: i => i.amount, render: i => F.money(i.amount) },
      { key: 'exp', label: 'Esperado', align: 'r', value: i => i.expected_amount, render: i => F.money(i.expected_amount) },
      { key: 'diff', label: 'Diferencia', align: 'r', value: i => i.difference, render: i => h('b', { style: Math.abs(i.difference) > 0.009 ? 'color:var(--bad)' : '' }, F.money(i.difference)) },
      { key: 'st', label: 'Estado', value: i => i.status, render: i => sb(IST, i.status) },
    ], rows: invs, onRow: i => invoiceDrawer(i), empty: 'Sin facturas registradas.' }));
  }
  function invoiceForm() {
    drawer('Registrar factura de tercero', (bd, close) => {
      bd.appendChild(notice('Opcional: pega el detalle de la factura, una línea por envío con «pedido o guía;monto» (P-000123;9.00). Sin detalle se compara solo el total.', 'info'));
      bd.appendChild(form({ id: 'del-inv', fields: [
        { key: 'supplier_id', label: 'Empresa', type: 'select', required: true, options: D.carriers().map(c => [c.id, c.trade_name]) },
        { key: 'invoice_number', label: 'N.° de factura', required: true, placeholder: 'F001-000245' },
        { key: 'issue_date', label: 'Emisión', type: 'date', required: true },
        { key: 'period_from', label: 'Período desde', type: 'date', required: true },
        { key: 'period_to', label: 'Período hasta', type: 'date', required: true },
        { key: 'amount', label: 'Importe facturado (S/)', type: 'money', required: true, min: 0 },
        { key: 'detail', label: 'Detalle (opcional)', type: 'textarea' },
      ], values: { issue_date: G.TODAY, period_from: G.date.month(G.TODAY), period_to: G.TODAY }, onCancel: close, onSubmit: v => {
        const lines = String(v.detail || '').split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => { const [ref, amt] = l.split(/[;,\t]/); return { ref: ref.trim(), amount: Number(String(amt || '0').replace(',', '.')) }; });
        const inv = D.reconcileInvoice(Object.assign({}, v, { amount: Number(v.amount), lines }));
        close(); toast(inv.status === 'RECONCILED' ? `Factura conciliada (diferencia ${F.money(inv.difference)})` : `Factura observada: diferencia ${F.money(inv.difference)} (RN-DEL-11)`, inv.status === 'RECONCILED' ? 'ok' : 'warn'); G.refresh(); invoiceDrawer(inv); return true;
      } }));
    }, { code: 'DEL-10' });
  }
  function invoiceDrawer(inv) {
    drawer(`Factura ${inv.invoice_number}`, bd => {
      bd.appendChild(dl([['Empresa', G.supName(inv.supplier_id)], ['Período', `${F.date(inv.period_from)} – ${F.date(inv.period_to)}`], ['Facturado', F.money(inv.amount)], ['Esperado', F.money(inv.expected_amount)], ['Diferencia', F.money(inv.difference)], ['Estado', sb(IST, inv.status)], ['Conciliada por', `${G.userName(inv.reconciled_by)} · ${F.datetime(inv.reconciled_at)}`]]));
      const ls = db.where('carrier_invoice_lines', l => l.invoice_id === inv.id);
      const cnt = U.groupBy(ls, 'match_status');
      bd.appendChild(h('div', { class: 'row' }, Object.keys(MST).map(k => h('span', null, sb(MST, k), ' ', (cnt[k] || []).length))));
      bd.appendChild(table({ id: 'del10-l-' + inv.id, pageSize: 15, columns: [
        { key: 'external_ref', label: 'Referencia', mono: true },
        { key: 'zone', label: 'Zona', value: l => { const s = l.stop_id && db.get('delivery_stops', l.stop_id); return s ? G.zoneName(s.zone_id) : '—'; } },
        { key: 'billed', label: 'Facturado', align: 'r', value: l => l.billed_amount, render: l => F.money(l.billed_amount) },
        { key: 'exp', label: 'Esperado', align: 'r', value: l => l.expected_amount, render: l => F.money(l.expected_amount) },
        { key: 'm', label: 'Resultado', value: l => l.match_status, render: l => sb(MST, l.match_status) },
      ], rows: ls.sort((a, b) => (a.match_status === 'MATCHED') - (b.match_status === 'MATCHED')), filters: [{ key: 'match_status', label: 'Resultado', options: Object.entries(MST).map(([k, v]) => [k, v[0]]) }] }));
    }, { wide: true, code: 'DEL-10' });
  }

  /* ---------- DEL-11 Envíos a provincia ---------- */
  function scr11(el) {
    const can = G.can('del.province.manage');
    const body = page(el, { code: 'DEL-11', title: 'Envíos a provincia', sub: 'Agencia, destino, embalaje térmico, guía de remisión electrónica (FAC), número de seguimiento, flete y empaque cargados al costo del pedido (RN-DEL-12).', actions: [btn('Nuevo envío', () => G.require('del.province.manage', () => shipmentForm()), { kind: 'primary', icon: '+', disabled: !can })] });
    const sh = db.where('province_shipments', x => G.scope.ok(order(x.order_id) || {})).sort(U.by('created_at', -1));
    body.appendChild(kpis([
      { label: 'Envíos', value: sh.length, sub: `${sh.filter(x => x.status === 'PREPARED').length} por entregar a la agencia` },
      { label: 'En tránsito', value: sh.filter(x => ['HANDED_TO_AGENCY', 'IN_TRANSIT'].includes(x.status)).length },
      { label: 'Costo por envío', value: F.money(sh.length ? U.sum(sh, x => x.freight_cost + x.packaging_cost) / sh.length : 0), sub: 'flete + empaque (KPI-DEL-16)' },
      { label: 'Cobrado al cliente', value: F.money(U.sum(sh, x => x.charged_to_customer)), sub: `subsidio ${F.money(U.sum(sh, x => x.freight_cost + x.packaging_cost - x.charged_to_customer))}` },
    ]));
    body.appendChild(table({ id: 'del11', columns: [
      { key: 'num', label: 'Pedido', value: x => order(x.order_id).number, render: x => orderLink(order(x.order_id)) },
      { key: 'cust', label: 'Cliente', value: x => G.custName(order(x.order_id).customer_id) },
      { key: 'dest', label: 'Destino', value: x => x.destination },
      { key: 'ag', label: 'Agencia', value: x => G.supName(x.agency_supplier_id) },
      { key: 'gre', label: 'GRE', value: x => x.dispatch_guide_id ? (db.get('dispatch_guides', x.dispatch_guide_id) || {}).full_number : '', render: x => x.dispatch_guide_id ? h('span', { class: 'mono' }, (db.get('dispatch_guides', x.dispatch_guide_id) || {}).full_number) : badge('Sin GRE', 'warn') },
      { key: 'tracking_number', label: 'Seguimiento', mono: true },
      { key: 'cost', label: 'Flete + empaque', align: 'r', value: x => x.freight_cost + x.packaging_cost, render: x => F.money(x.freight_cost + x.packaging_cost) },
      { key: 'st', label: 'Estado', value: x => x.status, render: x => sb(PST, x.status) },
    ], rows: sh, onRow: x => shipmentDrawer(x), filters: [{ key: 'status', label: 'Estado', options: Object.entries(PST).map(([k, v]) => [k, v[0]]) }], empty: 'Sin envíos a provincia.' }));
  }
  function shipmentForm() {
    const cands = db.where('sales_orders', o => o.fulfillment === 'PROVINCE_SHIPPING' && !['CANCELLED', 'DRAFT'].includes(o.status) && !db.find('province_shipments', x => x.order_id === o.id));
    drawer('Nuevo envío a provincia', (bd, close) => {
      if (!cands.length) bd.appendChild(notice('No hay pedidos de envío a provincia sin envío registrado. Los pedidos se crean en PED con entrega «Envío a provincia».', 'info'));
      bd.appendChild(form({ id: 'del-ship', fields: [
        { key: 'order_id', label: 'Pedido', type: 'select', required: true, options: cands.map(o => [o.id, `${o.number} · ${G.custName(o.customer_id)}`]), onChange: (v, vals, api) => { const o = order(v); if (o) { api.set('weight_kg', R(D.orderKg(o) + 1.2, 3)); api.set('freight_cost', R(D.orderKg(o) * 3.5 + 6)); api.set('charged_to_customer', o.delivery_fee); } } },
        { key: 'agency_supplier_id', label: 'Agencia', type: 'select', required: true, options: D.agencies().map(s => [s.id, s.trade_name]) },
        { key: 'destination', label: 'Destino', required: true, placeholder: 'Arequipa · Cercado' },
        { key: 'packaging', label: 'Embalaje', type: 'select', required: true, options: [['THERMAL_BOX', 'Caja térmica'], ['COOLER', 'Cooler'], ['STYROFOAM', 'Tecnopor'], ['BOX', 'Caja']] },
        { key: 'packages', label: 'Bultos', type: 'number', min: 1 },
        { key: 'weight_kg', label: 'Peso bruto (kg)', type: 'number', min: 0 },
        { key: 'freight_cost', label: 'Flete (S/)', type: 'money', min: 0 },
        { key: 'packaging_cost', label: 'Empaque (S/)', type: 'money', min: 0 },
        { key: 'charged_to_customer', label: 'Cobrado al cliente (S/)', type: 'money', min: 0 },
      ], values: { packaging: 'THERMAL_BOX', packages: 1, packaging_cost: 14.5 }, onCancel: close, onSubmit: v => { const sh = D.createShipment(v); close(); toast('Envío registrado', 'ok'); G.refresh(); shipmentDrawer(sh); return true; } }));
    }, { code: 'DEL-11' });
  }
  function shipmentDrawer(sh) {
    drawer(`Envío · ${order(sh.order_id).number}`, (bd, close) => {
      sh = db.get('province_shipments', sh.id); const o = order(sh.order_id); const g = sh.dispatch_guide_id && db.get('dispatch_guides', sh.dispatch_guide_id);
      const redraw = () => { close(); G.refresh(); shipmentDrawer(sh); };
      bd.appendChild(dl([['Cliente', G.custName(o.customer_id)], ['Destino', sh.destination], ['Agencia', G.supName(sh.agency_supplier_id)], ['Embalaje', { THERMAL_BOX: 'Caja térmica', COOLER: 'Cooler', STYROFOAM: 'Tecnopor', BOX: 'Caja' }[sh.packaging]], ['Bultos y peso', `${sh.packages} · ${F.kg(sh.weight_kg, 3)}`], ['GRE', g ? g.full_number : 'Sin emitir'], ['Seguimiento', sh.tracking_number || '—'], ['Flete', F.money(sh.freight_cost)], ['Empaque', F.money(sh.packaging_cost)], ['Cobrado al cliente', F.money(sh.charged_to_customer)], ['Estado', sb(PST, sh.status)]]));
      const can = G.can('del.province.manage');
      const acts = h('div', { class: 'stack' });
      if (sh.status === 'PREPARED') {
        if (!g) acts.appendChild(btn('Emitir guía de remisión (FAC)', () => { try { const gg = D.issueGuide(sh.id); toast(`GRE ${gg.full_number} emitida`, 'ok'); redraw(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'primary', disabled: !can }));
        const tn = h('input', { class: 'input', placeholder: 'N.° de seguimiento de la agencia', attrs: { 'aria-label': 'Número de seguimiento' } });
        acts.appendChild(h('div', { class: 'row' }, tn, btn('Entregar a la agencia', () => { try { D.handToAgency(sh.id, { tracking_number: tn.value.trim() }); toast('Entregado a la agencia: flete y empaque cargados al pedido', 'ok'); redraw(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'accent', disabled: !can })));
      }
      if (sh.status === 'HANDED_TO_AGENCY') acts.appendChild(btn('Marcar en tránsito', () => { try { D.shipmentStatus(sh.id, 'IN_TRANSIT'); redraw(); } catch (e) { toast(e.message, 'bad'); } }, { disabled: !can }));
      if (sh.status === 'IN_TRANSIT') acts.appendChild(h('div', { class: 'row' }, btn('Recogido por el cliente', () => { try { D.shipmentStatus(sh.id, 'DELIVERED'); redraw(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'primary', disabled: !can }), btn('Devuelto', () => { try { D.shipmentStatus(sh.id, 'RETURNED'); redraw(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'danger', disabled: !can })));
      bd.appendChild(acts);
    }, { code: 'DEL-11' });
  }

  /* ---------- DEL-12 Vehículos ---------- */
  function scr12(el) {
    const can = G.can('del.vehicle.manage');
    const docSem = v => { const is = D.vehicleDocIssues(v); return is.length ? badge(is.map(x => x.msg).join(' · '), is.some(x => x.level === 'bad') ? 'bad' : 'warn') : badge('Vigentes', 'ok'); };
    G.ui.crud(el, {
      code: 'DEL-12', title: 'Vehículos', sub: `Propios y alquilados: placa, tipo, capacidad, refrigerado, SOAT y revisión técnica con aviso a ${G.param('del_doc_alert_days') ?? 15} días, odómetro y tarifa de alquiler (D-DEL-02).`, table: 'vehicles', canCreate: can, canEdit: can, createLabel: 'Nuevo vehículo',
      rows: () => db.where('vehicles', v => G.scope.ok(v)),
      kpis: () => { const vs = db.where('vehicles', v => G.scope.ok(v)); const iss = vs.filter(v => D.vehicleDocIssues(v).length); return [{ label: 'Vehículos', value: vs.length, sub: `${vs.filter(v => v.ownership === 'OWN').length} propios · ${vs.filter(v => v.ownership === 'RENTED').length} alquilados` }, { label: 'Refrigerados', value: vs.filter(v => v.refrigerated).length }, { label: 'Con aviso de documentos', value: iss.length, tone: iss.length ? 'warn' : 'ok', sub: 'SOAT o revisión técnica' }, { label: 'Rutas del mes', value: db.where('delivery_routes', r => r.vehicle_id && r.route_date >= G.date.month(G.TODAY)).length }]; },
      columns: [
        { key: 'plate', label: 'Placa', mono: true },
        { key: 'vehicle_type', label: 'Tipo', value: v => D.vtypeName(v.vehicle_type) },
        { key: 'ownership', label: 'Modalidad', value: v => v.ownership === 'OWN' ? 'Propio' : 'Alquilado' },
        { key: 'establishment_id', label: 'Local', value: v => G.siteName(v.establishment_id) },
        { key: 'capacity_kg', label: 'Capacidad', align: 'r', render: v => F.kg(v.capacity_kg, 0) },
        { key: 'refrigerated', label: 'Frío', value: v => v.refrigerated ? 'Sí' : 'No' },
        { key: 'odometer_km', label: 'Odómetro', align: 'r', render: v => F.num(v.odometer_km, 1) + ' km' },
        { key: 'docs', label: 'Documentos', value: v => D.vehicleDocIssues(v).map(x => x.msg).join(' '), render: docSem },
      ],
      fields: [
        { key: 'plate', label: 'Placa', required: true }, { key: 'vehicle_type', label: 'Tipo', type: 'select', required: true, options: D.VTYPES },
        { key: 'ownership', label: 'Modalidad', type: 'select', required: true, options: [['OWN', 'Propio'], ['RENTED', 'Alquilado']] }, { key: 'provider_id', label: 'Proveedor del alquiler', type: 'select', options: G.ui.opts('suppliers', s => s.trade_name, s => s.supplier_type === 'VEHICLE_RENTAL') },
        { key: 'establishment_id', label: 'Local', type: 'select', required: true, options: [['es-L1', 'Local 1 Surco'], ['es-L2', 'Local 2 Lurín']] }, { key: 'capacity_kg', label: 'Capacidad (kg)', type: 'number', required: true, min: 1 },
        { key: 'refrigerated', label: 'Refrigerado', type: 'checkbox' }, { key: 'fuel_type', label: 'Combustible', type: 'select', options: [['GASOLINE', 'Gasolina'], ['DIESEL', 'Diésel'], ['GLP', 'GLP'], ['GNV', 'GNV']] },
        { key: 'soat_policy_no', label: 'N.° póliza SOAT' }, { key: 'soat_expires_on', label: 'SOAT vence', type: 'date', required: true },
        { key: 'tech_inspection_expires_on', label: 'Revisión técnica vence', type: 'date', required: true }, { key: 'odometer_km', label: 'Odómetro (km)', type: 'number', min: 0 },
        { key: 'rental_daily_rate', label: 'Alquiler diario (S/)', type: 'money', min: 0 },
      ],
      defaults: () => ({ status: 'ACTIVE', vehicle_type: 'MOTO', ownership: 'OWN', establishment_id: 'es-L1', capacity_kg: 60, fuel_type: 'GASOLINE', odometer_km: 0 }),
      beforeSave: (v, row) => { if (db.find('vehicles', x => x.plate === String(v.plate).toUpperCase() && (!row || x.id !== row.id))) return 'Ya existe un vehículo con esa placa.'; v.plate = String(v.plate).toUpperCase(); if (v.ownership === 'RENTED' && !(Number(v.rental_daily_rate) > 0)) return { rental_daily_rate: 'El vehículo alquilado lleva su tarifa diaria.' }; if (row && Number(v.odometer_km) < (row.odometer_km || 0)) return { odometer_km: `El odómetro no baja (último ${F.num(row.odometer_km, 1)} km).` }; },
      detail: (v) => { const rs = db.where('delivery_routes', r => r.vehicle_id === v.id).sort(U.by('route_date', -1)); return h('div', { class: 'stack' }, dl([['Placa', v.plate], ['Tipo', D.vtypeName(v.vehicle_type)], ['Modalidad', v.ownership === 'OWN' ? 'Propio' : `Alquilado a ${G.supName(v.provider_id)} · ${F.money(v.rental_daily_rate)} por día`], ['Capacidad', F.kg(v.capacity_kg, 0)], ['Refrigerado', v.refrigerated ? 'Sí' : 'No'], ['Combustible', v.fuel_type], ['SOAT', `${v.soat_policy_no || ''} · vence ${F.date(v.soat_expires_on)}`], ['Revisión técnica', F.date(v.tech_inspection_expires_on)], ['Odómetro', F.num(v.odometer_km, 1) + ' km'], ['Documentos', docSem(v)]]), card('Últimas rutas', h('div', { class: 'stack small' }, rs.slice(0, 8).map(r => h('div', { class: 'row between' }, h('span', { class: 'mono' }, `${F.date(r.route_date)} · ${r.code}`), h('span', null, `${F.num(D.routeKm(r), 1)} km · ${D.activeStops(r.id).filter(s => s.status === 'DELIVERED').length} entregas`)))))); },
    });
  }

  /* ---------- DEL-13 Costos de reparto ---------- */
  function scr13(el) {
    const can = G.can('del.cost.manage');
    const body = page(el, { code: 'DEL-13', title: 'Costos de reparto', sub: 'Combustible con vale, galones y odómetro; mantenimiento, SOAT, alquiler, peajes, estacionamiento, multas; sueldo, jornal, alimentación, movilidad y bono. Cada costo lleva al menos un destino (RN-DEL-13).', actions: [monthSelect(), btn('Registrar costo', () => G.require('del.cost.manage', () => costForm()), { kind: 'primary', icon: '+', disabled: !can })] });
    const end = monthEnd(S.month);
    const cs = db.where('delivery_costs', c => c.cost_date >= S.month && c.cost_date <= end).sort(U.by('cost_date', -1));
    const act = cs.filter(c => c.status !== 'VOIDED');
    const fuel = act.filter(c => c.cost_type === 'FUEL' && c.km_per_gal);
    body.appendChild(kpis([
      { label: 'Costos del mes', value: F.money(U.sum(act, c => c.amount)), sub: `${act.length} registros` },
      { label: 'Vehículo', value: F.money(U.sum(act.filter(c => bucketOf(c.cost_type) === 'vehicle'), c => c.amount)), sub: 'combustible, mantenimiento, alquiler…' },
      { label: 'Repartidores', value: F.money(U.sum(act.filter(c => bucketOf(c.cost_type) === 'driver'), c => c.amount)), sub: 'jornal, alimentación, bonos' },
      { label: 'Rendimiento con vales', value: fuel.length ? F.num(U.sum(fuel, c => c.km_per_gal) / fuel.length, 1) + ' km/gal' : '—', sub: 'odómetro entre cargas (KPI-DEL-10)' },
    ]));
    body.appendChild(table({ id: 'del13', columns: [
      { key: 'cost_date', label: 'Fecha', render: c => F.date(c.cost_date) },
      { key: 'type', label: 'Tipo', value: c => D.costName(c.cost_type, c.subtype) },
      { key: 'amount', label: 'Monto', align: 'r', render: c => h('span', { style: c.status === 'VOIDED' ? 'text-decoration:line-through' : '' }, F.money(c.amount)) },
      { key: 'dest', label: 'Destino', value: c => D.costDest(c) },
      { key: 'fuel', label: 'Galones · km/gal', value: c => c.fuel_gallons ? `${F.num(c.fuel_gallons, 3)} gal${c.km_per_gal ? ' · ' + F.num(c.km_per_gal, 1) + ' km/gal' : ''}` : '' },
      { key: 'src', label: 'Origen', value: c => c.expense_id ? 'GAS' : c.auto ? 'Automático' : c.order_id ? 'Provincia' : 'Manual' },
      { key: 'notes', label: 'Nota' },
      { key: 'st', label: '', value: c => c.status, render: c => c.status === 'VOIDED' ? badge('Anulado', 'bad') : '' },
    ], rows: cs, filters: [{ key: 'cost_type', label: 'Tipo', options: D.COST_TYPES }, { key: 'veh', label: 'Vehículo', options: db.all('vehicles').map(v => [v.id, v.plate]), value: c => c.vehicle_id || (c.route_id && (db.get('delivery_routes', c.route_id) || {}).vehicle_id) || '' }], actions: c => can && c.status !== 'VOIDED' ? [btn('Anular', () => modal('Anular costo', b => { const i = h('input', { class: 'input', placeholder: 'Motivo', attrs: { 'aria-label': 'Motivo' } }); b.append(h('p', null, `${D.costName(c.cost_type, c.subtype)} · ${F.money(c.amount)}`), i); b._i = i; }, [{ label: 'Cancelar' }, { label: 'Anular', kind: 'danger', onClick: () => { const i = document.querySelector('.modal input'); try { D.voidCost(c.id, i.value.trim()); toast('Costo anulado', 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); return false; } } }]), { sm: true, kind: 'ghost' })] : [] }));
  }
  function costForm() {
    drawer('Registrar costo de reparto', (bd, close) => {
      const info = h('div', { class: 'small muted' }, '');
      bd.appendChild(form({ id: 'del-cost', fields: [
        { key: 'cost_date', label: 'Fecha', type: 'date', required: true },
        { key: 'cost_type', label: 'Tipo', type: 'select', required: true, options: D.COST_TYPES.filter(x => !['PROVINCE_FREIGHT', 'PACKAGING'].includes(x[0])) },
        { key: 'amount', label: 'Monto (S/)', type: 'money', required: true, min: 0 },
        { key: 'route_id', label: 'Ruta', type: 'select', options: db.where('delivery_routes', r => r.route_date >= G.date.add(G.TODAY, -15)).sort(U.by('route_date', -1)).map(r => [r.id, `${F.date(r.route_date)} · ${r.code}`]) },
        { key: 'vehicle_id', label: 'Vehículo', type: 'select', options: db.all('vehicles').map(v => [v.id, v.plate]) },
        { key: 'employee_id', label: 'Repartidor', type: 'select', options: D.drivers().map(u => [u.employee_id, u.name]) },
        { key: 'supplier_id', label: 'Empresa de delivery o proveedor', type: 'select', options: db.where('suppliers', s => ['DELIVERY_COMPANY', 'VEHICLE_RENTAL', 'SERVICES'].includes(s.supplier_type)).map(s => [s.id, s.trade_name]) },
        { key: 'zone_id', label: 'Zona', type: 'select', options: G.ui.opts('delivery_zones', z => z.name) },
        { key: 'fuel_gallons', label: 'Galones (combustible)', type: 'number', min: 0 },
        { key: 'fuel_voucher_no', label: 'Vale o comprobante (combustible)' },
        { key: 'odometer_km', label: 'Odómetro (km)', type: 'number', min: 0, onChange: (val, vals) => { const prev = vals.vehicle_id && db.where('delivery_costs', x => x.cost_type === 'FUEL' && x.vehicle_id === vals.vehicle_id && x.odometer_km).sort((a, b) => b.odometer_km - a.odometer_km)[0]; info.textContent = prev && vals.fuel_gallons ? `Rendimiento: ${F.num((val - prev.odometer_km) / vals.fuel_gallons, 1)} km/gal desde la carga del ${F.date(prev.cost_date)} (${F.num(prev.odometer_km, 1)} km)` : ''; } },
        { key: 'notes', label: 'Nota', type: 'textarea' },
      ], values: { cost_date: G.TODAY, cost_type: 'FUEL' }, onCancel: close, onSubmit: v => { const c = D.addCost(v); close(); toast(`Costo registrado${c.km_per_gal ? ' · ' + F.num(c.km_per_gal, 1) + ' km/gal' : ''}`, 'ok'); G.refresh(); return true; } }));
      bd.appendChild(info);
    }, { code: 'DEL-13' });
  }

  /* ---------- DEL-14 Costo por entrega ---------- */
  function scr14(el) {
    const canView = G.can('del.cost.view') || G.ctx.role === 'AUDITOR';
    const body = page(el, { code: 'DEL-14', title: 'Costo por entrega', sub: 'Por mes, zona, modalidad, vehículo, repartidor y ruta: costo total, entregas, costo por entrega, por kg y por km, y subsidio del delivery gratis. Cada recálculo crea una corrida nueva (RN-DEL-14).', actions: [monthSelect(), btn('Recalcular (nueva corrida)', () => G.require('del.cost.manage', () => tryDo(() => D.allocate(S.month), x => `Corrida ${x.run_no} creada: ${x.rows.length} entregas`)), { kind: 'primary', disabled: !G.can('del.cost.manage') })] });
    if (!canView) { body.appendChild(notice('Tu rol no ve el costo por entrega (del.cost.view).', 'warn')); return; }
    const run = D.latestRun(S.month); const rows = D.allocRows(S.month);
    if (!run) { body.appendChild(notice('Aún no hay corrida para este mes: usa «Recalcular».', 'info')); return; }
    const tot = U.sum(rows, a => a.total_cost), n = rows.length, kg = U.sum(rows, a => a.kg_delivered);
    const drv = new Map(); for (const a of rows) { if (!drv.has(a.route_id)) drv.set(a.route_id, db.get('delivery_routes', a.route_id)); }
    const km = U.sum([...drv.values()].filter(r => r && routeIsDriveable(r)), r => D.routeKm(r));
    const ownCost = U.sum(rows.filter(a => a.mode !== 'THIRD_PARTY'), a => a.total_cost);
    const meta = rows[0] || {};
    body.appendChild(h('div', { class: 'row between' }, h('span', { class: 'small muted' }, `Corrida ${run} de ${D.runs(S.month).length} · ${F.datetime(meta.run_at)} · ${meta.run_by || ''} · reparto ${meta.method === 'KG' ? 'por kg' : 'por entrega'} (del_cost_split_method, D-DEL-05)`), h('span', { class: 'small muted' }, 'RN-DEL-15: subsidio = costo − delivery cobrado; gratis desde 3 unidades o 3 kg (RN-PED-09).')));
    body.appendChild(kpis([
      { label: 'Costo total', value: F.money(tot, 0), sub: `${F.num(n)} entregas` },
      { label: 'Costo por entrega', value: F.money(n ? tot / n : 0), sub: 'KPI-DEL-04', tone: 'info' },
      { label: 'Costo por kg', value: F.money(kg ? tot / kg : 0), sub: `${F.kg(kg, 0)} entregados` },
      { label: 'Costo por km', value: km ? F.money(ownCost / km) : '—', sub: `${F.num(km, 0)} km propios y alquilados` },
      { label: 'Subsidio de delivery', value: F.money(U.sum(rows, a => a.subsidy), 0), sub: `cobrado ${F.money(U.sum(rows, a => a.fee_charged), 0)}`, tone: 'warn' },
    ]));
    const ci = D.costItems(S.month);
    const grp = (label, fn, nameFn) => ({ key: label, label, render: p => { const s = D.summary(S.month, fn); p.appendChild(table({ id: 'del14-' + label, pageSize: 15, columns: [
      { key: 'key', label, value: x => nameFn(x.key) },
      { key: 'n', label: 'Entregas', align: 'r' },
      { key: 'cost', label: 'Costo', align: 'r', render: x => F.money(x.cost) },
      { key: 'veh', label: 'Vehículo', align: 'r', value: x => x.vehicle, render: x => F.money(x.vehicle) },
      { key: 'drv', label: 'Repartidor', align: 'r', value: x => x.driver, render: x => F.money(x.driver) },
      { key: 'car', label: 'Tercero', align: 'r', value: x => x.carrier, render: x => F.money(x.carrier) },
      { key: 'cpd', label: 'Por entrega', align: 'r', render: x => h('b', null, F.money(x.cpd)) },
      { key: 'cpk', label: 'Por kg', align: 'r', render: x => F.money(x.cpk) },
      { key: 'cpkm', label: 'Por km', align: 'r', render: x => x.cpkm != null ? F.money(x.cpkm) : '—' },
      { key: 'subsidy', label: 'Subsidio', align: 'r', render: x => F.money(x.subsidy) },
    ], rows: s, search: false })); } });
    body.appendChild(h('div', { style: 'min-width:0' }, tabs([
      grp('Zona', a => a.zone_id, k => G.zoneName(k)),
      grp('Modalidad', a => a.mode, k => D.modeName(k)),
      grp('Vehículo', (a, r) => r && (r.vehicle_id || ('sup:' + r.carrier_supplier_id)), k => String(k).startsWith('sup:') ? G.supName(k.slice(4)) + ' (tercero)' : D.vehLabel(k)),
      grp('Repartidor', (a, r) => r && (r.driver_user_id || ('sup:' + r.carrier_supplier_id)), k => String(k).startsWith('sup:') ? G.supName(k.slice(4)) : G.userName(k)),
      grp('Ruta', (a, r) => r && r.id, k => { const r = db.get('delivery_routes', k); return r ? `${F.date(r.route_date)} · ${r.code}` : k; }),
      { key: 'items', label: 'Partidas repartidas', render: p => { p.appendChild(notice(`Origen de cada partida: DEL (DEL-13), FLO (cargas, mantenimiento y otros costos reales del vehículo), EST (combustible estimado por km cuando el vehículo no tiene cargas ni vales en el mes) y TARIFA (tercero sin factura registrada). ${ci.replaced.length} registro(s) de DEL no se cuentan porque FLO tiene el mismo rubro del vehículo en el mes (sin doble conteo).`, 'info')); p.appendChild(table({ id: 'del14-items', pageSize: 15, columns: [{ key: 'source', label: 'Origen', render: x => badge(x.source, { DEL: '', FLO: 'info', EST: 'warn', TARIFA: 'primary', 'DEL (reemplazado)': 'bad' }[x.source] || '') }, { key: 'label', label: 'Partida' }, { key: 'bucket', label: 'Grupo', value: x => ({ vehicle: 'Vehículo', driver: 'Repartidor', carrier: 'Tercero', direct: 'Directo', other: 'Otro' })[x.bucket] || '—' }, { key: 'dest', label: 'Destino', value: x => [x.route_id && (db.get('delivery_routes', x.route_id) || {}).code, x.vehicle_id && (D.vehicle(x.vehicle_id) || {}).plate, x.supplier_id && G.supName(x.supplier_id), x.zone_id && G.zoneName(x.zone_id), x.employee_id && 'repartidor'].filter(Boolean).join(' · ') || 'Todas' }, { key: 'amount', label: 'Monto', align: 'r', render: x => F.money(x.amount) }], rows: ci.items.concat(ci.replaced.map(x => Object.assign({}, x, { source: 'DEL (reemplazado)' }))), filters: [{ key: 'source', label: 'Origen', options: [['DEL', 'DEL'], ['FLO', 'FLO'], ['EST', 'Estimado'], ['TARIFA', 'Tarifa'], ['DEL (reemplazado)', 'Reemplazado por FLO']] }] })); } },
    ])));
    const z = D.summary(S.month, a => a.zone_id).filter(x => x.n >= 3);
    body.appendChild(card('Costo por entrega por zona', G.ui.chart.bar({ labels: z.map(x => (db.get('delivery_zones', x.key) || {}).code || x.key), series: [{ name: 'Costo por entrega', values: z.map(x => x.cpd) }, { name: 'Delivery cobrado promedio', values: z.map(x => R(x.fee / x.n)) }], format: v => F.money(v) })));
  }

  /* ---------- DEL-15 Comparativo por zona ---------- */
  function scr15(el) {
    const body = page(el, { code: 'DEL-15', title: 'Comparativo por zona', sub: 'Costo por entrega propio frente a alquilado y tercero por zona, con la tarifa vigente del tercero y la sugerencia de tercerizar o no.', actions: [monthSelect()] });
    if (!(G.can('del.cost.view') || G.ctx.role === 'AUDITOR')) { body.appendChild(notice('Tu rol no ve el costo por entrega (del.cost.view).', 'warn')); return; }
    const rows = D.zoneComparison(S.month);
    const sug = rows.filter(x => x.suggestion === 'EVALUAR_TERCERIZAR');
    body.appendChild(kpis([
      { label: 'Zonas comparadas', value: rows.filter(x => x.diff != null).length, sub: `de ${rows.length}` },
      { label: 'Evaluar tercerizar', value: sug.length, tone: sug.length ? 'warn' : 'ok', sub: sug.map(x => x.zone.code).join(', ') || 'ninguna' },
      { label: 'Mantener propio', value: rows.filter(x => x.suggestion === 'MANTENER_PROPIO').length, tone: 'ok' },
      { label: 'Tarifa base del tercero', value: rows.find(x => x.carrier_rate) ? F.money(rows.find(x => x.carrier_rate).carrier_rate) : '—', sub: rows[0] && rows[0].carrier ? rows[0].carrier.trade_name : '' },
    ]));
    body.appendChild(table({ id: 'del15', pageSize: 20, columns: [
      { key: 'z', label: 'Zona', value: x => x.zone.name },
      { key: 'own', label: 'Propia', align: 'r', value: x => x.own ? x.own.cpd : null, render: x => x.own ? h('span', null, F.money(x.own.cpd), h('div', { class: 'small muted' }, `${x.own.n} entregas`)) : '—' },
      { key: 'ren', label: 'Alquilada', align: 'r', value: x => x.rented ? x.rented.cpd : null, render: x => x.rented ? h('span', null, F.money(x.rented.cpd), h('div', { class: 'small muted' }, `${x.rented.n} entregas`)) : '—' },
      { key: 'thr', label: 'Tercero (real)', align: 'r', value: x => x.third ? x.third.cpd : null, render: x => x.third ? h('span', null, F.money(x.third.cpd), h('div', { class: 'small muted' }, `${x.third.n} entregas`)) : '—' },
      { key: 'rate', label: 'Tarifa del tercero', align: 'r', value: x => x.carrier_rate, render: x => x.carrier_rate != null ? F.money(x.carrier_rate) : '—' },
      { key: 'diff', label: 'Diferencia por entrega', align: 'r', value: x => x.diff, render: x => x.diff != null ? h('b', { style: x.diff > 0 ? 'color:var(--bad)' : 'color:var(--ok)' }, F.money(x.diff)) : '—' },
      { key: 'sg', label: 'Sugerencia', value: x => x.text, render: x => h('div', null, badge({ EVALUAR_TERCERIZAR: 'Evaluar tercerizar', MANTENER_PROPIO: 'Mantener propio', SIMILAR: 'Similar', SIN_DATOS: 'Sin datos' }[x.suggestion], { EVALUAR_TERCERIZAR: 'warn', MANTENER_PROPIO: 'ok', SIMILAR: 'info', SIN_DATOS: '' }[x.suggestion]), h('div', { class: 'small muted' }, x.text)) },
    ], rows, search: false }));
    const ok = rows.filter(x => x.own || x.rented);
    body.appendChild(card('Propio o alquilado frente a la tarifa del tercero', G.ui.chart.bar({ labels: ok.map(x => x.zone.code), series: [{ name: 'Propia o alquilada', values: ok.map(x => (x.own || x.rented).cpd) }, { name: 'Tarifa del tercero', values: ok.map(x => x.carrier_rate || 0) }], format: v => F.money(v) })));
  }

  /* ---------- DEL-16 No entregados ---------- */
  function scr16(el) {
    const body = page(el, { code: 'DEL-16', title: 'No entregados', sub: 'Paradas fallidas con motivo y foto, reprogramación del pedido (PED-08, RN-PED-14) y bolsas devueltas al almacén (ALM las reingresa con movimiento RETURN).' });
    const fs = db.where('delivery_stops', s => s.status === 'FAILED').map(s => ({ s, o: order(s.order_id), r: db.get('delivery_routes', s.route_id) })).filter(x => x.o && G.scope.ok(x.o)).sort((a, b) => String(b.s.closed_at).localeCompare(String(a.s.closed_at)));
    const pending = fs.filter(x => x.o.status === 'NOT_DELIVERED');
    const by = U.groupBy(fs, x => x.s.fail_reason);
    body.appendChild(kpis([
      { label: 'Por reprogramar', value: pending.length, tone: pending.length ? 'bad' : 'ok', sub: 'pedidos en NO ENTREGADO' },
      { label: 'Bolsas por recibir', value: fs.filter(x => !x.s.bags_returned).length, tone: fs.some(x => !x.s.bags_returned) ? 'warn' : 'ok', sub: 'devueltas al almacén' },
      { label: 'No entregados del mes', value: fs.filter(x => String(x.s.closed_at) >= G.date.month(G.TODAY)).length, sub: `KPI-DEL-03: ${F.pct((G.kpi('KPI-DEL-03') || {}).value)}` },
      { label: 'Motivo principal', value: Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => D.reasonName(k))[0] || '—' },
    ]));
    body.appendChild(card('No entregados por motivo', G.ui.chart.hbar({ items: Object.entries(by).map(([k, v]) => ({ label: D.reasonName(k), value: v.length, tone: 'bad' })).sort((a, b) => b.value - a.value), format: v => F.num(v) })));
    body.appendChild(table({ id: 'del16', columns: [
      { key: 'when', label: 'Fecha', value: x => x.s.closed_at, render: x => F.datetime(x.s.closed_at) },
      { key: 'num', label: 'Pedido', value: x => x.o.number, render: x => orderLink(x.o) },
      { key: 'cust', label: 'Cliente', value: x => G.custName(x.o.customer_id) },
      { key: 'route', label: 'Ruta', value: x => x.r ? x.r.code : '' },
      { key: 'reason', label: 'Motivo', value: x => D.reasonName(x.s.fail_reason) },
      { key: 'ev', label: 'Detalle', value: x => { const e = db.find('delivery_events', e => e.stop_id === x.s.id && e.event_type === 'FAILED'); return e ? (e.notes || '') + (e.photo_file_id ? ' · con foto' : '') : ''; } },
      { key: 'bags', label: 'Bolsas', value: x => x.s.bags_returned ? 'Recibidas' : 'Por recibir', render: x => x.s.bags_returned ? badge('Recibidas en almacén', 'ok') : badge('Por recibir', 'warn') },
      { key: 'ost', label: 'Pedido', value: x => x.o.status, render: x => h('div', null, G.ui.status(x.o.status), x.s.rescheduled_to ? h('div', { class: 'small muted' }, 'Reprogramado al ' + F.date(x.s.rescheduled_to)) : null) },
    ], rows: fs, filters: [{ key: 'reason', label: 'Motivo', options: D.REASONS, value: x => x.s.fail_reason }, { key: 'pend', label: 'Situación', options: [['1', 'Por reprogramar'], ['0', 'Resueltos']], value: x => x.o.status === 'NOT_DELIVERED' ? '1' : '0' }],
      actions: x => [!x.s.bags_returned ? btn('Bolsas recibidas', () => tryDo(() => { db.update('delivery_stops', x.s.id, { bags_returned: true, bags_received_at: G.date.now(), bags_received_by: G.ctx.userName() }); }, 'Bolsas recibidas en el almacén'), { sm: true }) : null, x.o.status === 'NOT_DELIVERED' && (G.canDo('PED', 'E') || G.can('del.route.plan')) ? btn('Reprogramar', () => rescheduleDialog(x), { sm: true, kind: 'primary' }) : null].filter(Boolean) }));
  }
  /** reprogramación: usa PED si está en el build (G.ped.reschedule); si no, vuelve el pedido a CONFIRMADO con nueva fecha */
  D.reschedule = function (orderId, { date, slot_id, reason }) {
    const o = order(orderId);
    if (!date || !slot_id) G.fail('RN-PED-14', 'Elige la nueva fecha y franja.');
    if (date < G.TODAY) G.fail('RN-PED-14', 'La nueva fecha no puede ser anterior a hoy.');
    if (G.ped && typeof G.ped.reschedule === 'function') return G.ped.reschedule(o.id, { date, slot_id, reason });
    const slot = db.get('order_time_slots', slot_id);
    G.orders.transition(o, 'CONFIRMED', { reason: `Reprogramado al ${F.date(date)} ${slot ? slot.name : ''} · ${reason || 'no entregado'}` });
    db.update('sales_orders', o.id, { delivery_date: date, slot_id, slot_from: slot ? slot.slot_from : o.slot_from, slot_to: slot ? slot.slot_to : o.slot_to, reschedule_count: (o.reschedule_count || 0) + 1 });
    const fs = db.where('delivery_stops', s => s.order_id === o.id && s.status === 'FAILED').sort(U.by('closed_at', -1))[0];
    if (fs) db.update('delivery_stops', fs.id, { rescheduled_to: date }, { silent: true });
    G.events.emit('order.rescheduled', { order_id: o.id, number: o.number, date, slot_id });
    return o;
  };
  function rescheduleDialog(x) {
    drawer(`Reprogramar ${x.o.number}`, (bd, close) => bd.appendChild(form({ id: 'del-resch', fields: [
      { key: 'date', label: 'Nueva fecha', type: 'date', required: true },
      { key: 'slot_id', label: 'Franja', type: 'select', required: true, options: G.ui.opts('order_time_slots', s => s.name, s => s.establishment_id === x.o.establishment_id) },
      { key: 'reason', label: 'Acuerdo con el cliente', type: 'textarea', required: true },
    ], values: { date: G.date.add(G.TODAY, 1), reason: D.reasonName(x.s.fail_reason) + ': ' }, onCancel: close, onSubmit: v => { D.reschedule(x.o.id, v); close(); toast('Pedido reprogramado: vuelve al planificador de esa fecha', 'ok'); G.refresh(); return true; } })), { code: 'DEL-16' });
  }

  /* ==================================================================
     Registro del módulo
     ================================================================== */
  const SP = G.SPEC.DEL;
  const nm = c => (SP.screens.find(x => x[0] === c) || [c, c])[1];
  G.register({ code: 'DEL', name: 'Delivery', phase: 1, group: 'Almacén y reparto', screens: [
    { code: 'DEL-01', name: nm('DEL-01'), roles: OFFICE, render: scr01 },
    { code: 'DEL-02', name: nm('DEL-02'), roles: OFFICE, render: scr02 },
    { code: 'DEL-03', name: nm('DEL-03'), roles: OFFICE, render: scr03 },
    { code: 'DEL-04', name: nm('DEL-04'), roles: APP_ROLES, render: scr04 },
    { code: 'DEL-05', name: nm('DEL-05'), roles: APP_ROLES, render: scr05 },
    { code: 'DEL-06', name: nm('DEL-06'), roles: APP_ROLES.concat(['ADMINISTRACION', 'CAJERO']), render: scr06 },
    { code: 'DEL-07', name: nm('DEL-07'), roles: OFFICE, render: scr07 },
    { code: 'DEL-08', name: nm('DEL-08'), roles: OFFICE, render: scr08 },
    { code: 'DEL-09', name: nm('DEL-09'), roles: OFFICE, render: scr09 },
    { code: 'DEL-10', name: nm('DEL-10'), roles: OFFICE, render: scr10 },
    { code: 'DEL-11', name: nm('DEL-11'), roles: OFFICE, render: scr11 },
    { code: 'DEL-12', name: nm('DEL-12'), roles: OFFICE, render: scr12 },
    { code: 'DEL-13', name: nm('DEL-13'), roles: OFFICE, render: scr13 },
    { code: 'DEL-14', name: nm('DEL-14'), roles: OFFICE, render: scr14 },
    { code: 'DEL-15', name: nm('DEL-15'), roles: OFFICE, render: scr15 },
    { code: 'DEL-16', name: nm('DEL-16'), roles: OFFICE, render: scr16 },
  ] });

  /* ---------- búsqueda, escaneo y alertas ---------- */
  G.searchProviders.push(q => {
    const s = q.toLowerCase(); const out = [];
    for (const r of db.where('delivery_routes', r => r.route_date >= G.date.add(G.TODAY, -7) && r.code.toLowerCase().includes(s)).slice(0, 6)) out.push({ label: `Ruta ${r.code}`, sub: `${F.date(r.route_date)} · ${RST[r.status][0]} · ${assignedText(r)}`, go: () => { S.date = r.route_date; G.go('DEL-03', { id: r.id }); } });
    for (const v of db.where('vehicles', v => v.plate.toLowerCase().includes(s)).slice(0, 3)) out.push({ label: `Vehículo ${v.plate}`, sub: D.vehLabel(v.id), go: () => G.go('DEL-12') });
    for (const sh of db.where('province_shipments', x => (x.tracking_number || '').toLowerCase().includes(s)).slice(0, 3)) out.push({ label: `Envío ${sh.tracking_number}`, sub: sh.destination, go: () => G.go('DEL-11') });
    return out;
  });
  G.scanHandlers.push(code => {
    const st = db.where('delivery_stops', s => isActiveStop(s) && ['PENDING', 'ARRIVED'].includes(s.status)).find(s => D.parcels(s).some(p => p.label.toUpperCase() === code));
    if (st) return () => { const r = db.get('delivery_routes', st.route_id); S.date = r.route_date; if (['PLANNED', 'LOADING'].includes(r.status)) G.go('DEL-02', { id: r.id }); else G.go('DEL-03', { id: r.id }); };
    const r = db.find('delivery_routes', x => x.code === code && x.route_date === G.TODAY);
    return r ? () => G.go('DEL-03', { id: r.id }) : null;
  });
  G.alertProviders.push(() => {
    const out = []; const days = G.param('del_doc_alert_days') ?? 15;
    const vs = db.where('vehicles', v => v.status !== 'RETIRED').map(v => ({ v, is: D.vehicleDocIssues(v) })).filter(x => x.is.length);
    if (vs.length) out.push({ module: 'DEL', title: `${vs.length} vehículo(s) con SOAT o revisión técnica por vencer o vencidos`, detail: vs.map(x => `${x.v.plate}: ${x.is.map(i => i.msg).join(', ')}`).join(' · ') + ` (aviso a ${days} días, RN-DEL-03)`, tone: vs.some(x => x.is.some(i => i.level === 'bad')) ? 'bad' : 'warn', go: () => G.go('DEL-12') });
    const ret = db.where('delivery_routes', r => r.status === 'RETURNED');
    if (ret.length) out.push({ module: 'DEL', title: `${ret.length} ruta(s) de vuelta sin liquidar`, detail: ret.map(r => r.code + ' ' + F.date(r.route_date)).join(', ') + ' · RN-DEL-10', tone: 'warn', go: () => G.go('DEL-06') });
    const inv = db.where('carrier_invoices', i => i.status === 'OBSERVED');
    if (inv.length) out.push({ module: 'DEL', title: `${inv.length} factura(s) de terceros observada(s)`, detail: inv.map(i => `${i.invoice_number}: diferencia ${F.money(i.difference)}`).join(' · '), tone: 'warn', go: () => G.go('DEL-10') });
    const nd = db.where('sales_orders', o => o.status === 'NOT_DELIVERED');
    if (nd.length) out.push({ module: 'DEL', title: `${nd.length} pedido(s) no entregado(s) por reprogramar`, detail: nd.map(o => o.number).join(', '), tone: 'bad', go: () => G.go('DEL-16') });
    return out;
  });

  /* ---------- indicadores (TAB) ---------- */
  const inRange = (d, p) => d && String(d).slice(0, 10) >= p.from && String(d).slice(0, 10) <= p.to;
  const stopsIn = (p, pred = () => true) => { const rs = new Map(db.where('delivery_routes', r => r.route_date >= p.from && r.route_date <= p.to && (!p.site || r.establishment_id === p.site)).map(r => [r.id, r])); return db.where('delivery_stops', s => rs.has(s.route_id) && pred(s, rs.get(s.route_id))).filter(s => !p.brand || (order(s.order_id) || {}).brand_id === p.brand); };
  const allocIn = p => { const out = []; for (let m = G.date.month(p.from); m <= p.to; m = G.date.addMonths(m, 1)) out.push(...D.allocRows(m)); const rs = new Map(); return out.filter(a => { const r = rs.get(a.route_id) || db.get('delivery_routes', a.route_id); rs.set(a.route_id, r); return r && r.route_date >= p.from && r.route_date <= p.to && (!p.site || r.establishment_id === p.site); }); };
  const K = G.kpiCalc;
  K['KPI-DEL-01'] = p => stopsIn(p, s => s.status === 'DELIVERED').length;
  K['KPI-DEL-02'] = p => { const ss = stopsIn(p, s => s.status === 'DELIVERED' && s.closed_at); const ok = ss.filter(s => { const o = order(s.order_id); return !o || !o.slot_to || hm(s.closed_at) <= o.slot_to; }).length; return { value: ss.length ? R(ok / ss.length * 100, 1) : 0, numerator: ok, denominator: ss.length }; };
  K['KPI-DEL-03'] = p => { const ss = stopsIn(p, s => ['DELIVERED', 'FAILED'].includes(s.status)); const f = ss.filter(s => s.status === 'FAILED').length; return { value: ss.length ? R(f / ss.length * 100, 1) : 0, numerator: f, denominator: ss.length }; };
  K['KPI-DEL-04'] = p => { const a = allocIn(p); return { value: a.length ? R(U.sum(a, x => x.total_cost) / a.length) : 0, numerator: R(U.sum(a, x => x.total_cost)), denominator: a.length }; };
  K['KPI-DEL-05'] = p => { const a = allocIn(p); const kg = U.sum(a, x => x.kg_delivered); return { value: kg ? R(U.sum(a, x => x.total_cost) / kg) : 0, numerator: R(U.sum(a, x => x.total_cost)), denominator: R(kg, 1) }; };
  K['KPI-DEL-06'] = p => { const a = allocIn(p).filter(x => x.mode !== 'THIRD_PARTY'); const rs = [...new Set(a.map(x => x.route_id))].map(id => db.get('delivery_routes', id)); const km = U.sum(rs, r => D.routeKm(r)); return { value: km ? R(U.sum(a, x => x.total_cost) / km) : 0, numerator: R(U.sum(a, x => x.total_cost)), denominator: R(km, 1) }; };
  K['KPI-DEL-07'] = p => { const a = allocIn(p); const by = U.groupBy(a, x => x.mode); const own = by.OWN || [], thr = by.THIRD_PARTY || []; return { value: own.length ? R(U.sum(own, x => x.total_cost) / own.length) : 0, numerator: R(U.sum(own, x => x.total_cost)), denominator: own.length, detail: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, R(U.sum(v, x => x.total_cost) / v.length)])), third: thr.length ? R(U.sum(thr, x => x.total_cost) / thr.length) : null }; };
  K['KPI-DEL-08'] = p => R(U.sum(allocIn(p), x => x.subsidy));
  K['KPI-DEL-09'] = p => { const rs = db.where('delivery_routes', r => r.route_date >= p.from && r.route_date <= p.to && routeIsDriveable(r) && r.odometer_end != null && (!p.site || r.establishment_id === p.site)); const km = U.sum(rs, r => D.routeKm(r)); const n = U.sum(rs, r => D.activeStops(r.id).filter(s => s.status === 'DELIVERED').length); return { value: n ? R(km / n, 2) : 0, numerator: R(km, 1), denominator: n }; };
  K['KPI-DEL-10'] = p => { const f = db.where('delivery_costs', c => c.cost_type === 'FUEL' && c.km_per_gal && c.status !== 'VOIDED' && inRange(c.cost_date, p)); const pairs = f.map(c => ({ km: c.km_per_gal * c.fuel_gallons, gal: c.fuel_gallons })); const gal = U.sum(pairs, x => x.gal); return { value: gal ? R(U.sum(pairs, x => x.km) / gal, 1) : 0, numerator: R(U.sum(pairs, x => x.km), 1), denominator: R(gal, 3) }; };
  K['KPI-DEL-11'] = p => { const vs = db.where('vehicles', v => v.status !== 'RETIRED' && (!p.site || v.establishment_id === p.site)); let wd = 0; for (let d = p.from; d <= p.to; d = G.date.add(d, 1)) if (G.date.parse(d).getUTCDay() !== 0) wd++; const used = new Set(db.where('delivery_routes', r => r.vehicle_id && r.route_date >= p.from && r.route_date <= p.to).map(r => r.vehicle_id + '|' + r.route_date)).size; const den = wd * vs.length; return { value: den ? R(used / den * 100, 1) : 0, numerator: used, denominator: den }; };
  K['KPI-DEL-12'] = p => R(U.sum(db.where('carrier_invoices', i => inRange(i.issue_date, p)), i => Math.abs(i.difference || 0)));
  K['KPI-DEL-13'] = p => R(U.sum(db.where('driver_settlements', x => inRange(x.settlement_date, p)), x => Math.abs(x.difference || 0)));
  K['KPI-DEL-14'] = p => { const ss = stopsIn(p, s => s.status === 'DELIVERED' && s.pod_distance_m != null); const max = G.param('del_pod_max_distance_m') ?? 300; const f = ss.filter(s => s.pod_distance_m > max).length; return { value: ss.length ? R(f / ss.length * 100, 1) : 0, numerator: f, denominator: ss.length }; };
  K['KPI-DEL-15'] = p => { const it = []; for (let m = G.date.month(p.from); m <= p.to; m = G.date.addMonths(m, 1)) it.push(...D.costItems(m).items.filter(x => x.rubro === 'MAINT')); const by = U.groupBy(it, x => x.vehicle_id); return { value: R(U.sum(it, x => x.amount)), by_vehicle: Object.fromEntries(Object.entries(by).map(([k, v]) => [(D.vehicle(k) || {}).plate || k, R(U.sum(v, x => x.amount))])) }; };
  K['KPI-DEL-16'] = p => { const sh = db.where('province_shipments', x => inRange(x.handed_at || x.created_at, p)); return { value: sh.length ? R(U.sum(sh, x => x.freight_cost + x.packaging_cost) / sh.length) : 0, numerator: R(U.sum(sh, x => x.freight_cost + x.packaging_cost)), denominator: sh.length }; };

  /* ==================================================================
     Pruebas funcionales: una por criterio CA-DEL-*
     ================================================================== */
  const T = (name, fn) => G.tests.push({ module: 'DEL', name, fn });
  const near = (a, b, e = 0.005) => Math.abs(a - b) <= e;
  /** pedido LISTO sin ruta para las pruebas (si no queda, se avanza uno confirmado de hoy por el flujo normal) */
  const readyOrder = (est) => {
    let o = db.find('sales_orders', o => o.status === 'READY' && o.fulfillment === 'DELIVERY' && !D.activeStopOf(o.id) && (!est || o.establishment_id === est));
    if (o) return o;
    o = db.find('sales_orders', o => ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED'].includes(o.status) && o.fulfillment === 'DELIVERY' && o.address_id && !D.activeStopOf(o.id) && o.weight_diff_status !== 'NOTICE_REQUIRED' && (!est || o.establishment_id === est));
    if (!o) return null;
    if (o.status === 'CONFIRMED') G.orders.transition(o, 'IN_PREPARATION');
    G.orders.transition(o, 'READY');
    return o;
  };
  const caRoute = () => db.find('delivery_routes', r => r.code === 'SURCO-B' && r.route_date === '2026-09-12');
  const routeCpd = (period, rid, run) => { const rows = D.allocRows(period, run).filter(a => a.route_id === rid); return { n: rows.length, cpd: rows.length ? R(U.sum(rows, a => a.total_cost) / rows.length, 2) : null, rows }; };
  T('CA-DEL-01: ruta SURCO-B del 12/09 con moto propia, 10 entregas y S/ 150 de costos → S/ 15,00 por entrega', async () => {
    const r = caRoute(); if (!r) throw new Error('No se sembró la ruta SURCO-B del 12/09');
    const v = D.vehicle(r.vehicle_id); if (r.mode !== 'OWN' || v.vehicle_type !== 'MOTO') throw new Error('La ruta no es de moto propia');
    const costs = db.where('delivery_costs', c => c.route_id === r.id);
    const sum = t => U.sum(costs.filter(c => c.cost_type === t), c => c.amount);
    if (sum('FUEL') !== 50 || sum('DRIVER_WAGE') !== 80 || sum('DRIVER_MEAL') !== 15 || sum('TOLL') !== 5) throw new Error('Costos de la ruta distintos a 50/80/15/5');
    const ri = isolateCaRoute(r);
    if (ri.mode !== 'OWN' || D.vehicle(ri.vehicle_id).vehicle_type !== 'MOTO') throw new Error('La ruta aislada no es de moto propia');
    const res = D.allocate('2026-09-01');
    const x = routeCpd('2026-09-01', r.id, res.run_no);
    if (x.n !== 10) throw new Error('Entregas de la ruta: ' + x.n);
    if (!near(x.cpd, 15)) throw new Error('Costo por entrega ' + x.cpd + ' (esperado 15,00)');
  });
  T('CA-DEL-02: moto con SOAT vencido el 10/10 no sale en la ruta del 12/10 (RN-DEL-03)', async () => {
    const o = readyOrder();
    if (!o) throw new Error('Sin pedido listo libre');
    const rt = D.createRoute({ route_date: '2026-10-12', establishment_id: o.establishment_id, slot_id: o.slot_id, code: 'PRUEBA-SOAT', order_ids: [o.id] });
    D.assign(rt.id, { mode: 'OWN', vehicle_id: 've-MTA-123', driver_user_id: D.drivers()[0].id });
    db.update('vehicles', 've-MTA-123', { soat_expires_on: '2026-10-10' });
    try { D.depart(rt.id); } catch (e) { if (!/^RN-DEL-03/.test(e.message)) throw new Error('Rechazo con otra regla: ' + e.message); return; }
    throw new Error('La ruta salió con el SOAT vencido');
  });
  T('CA-DEL-03: con una bolsa sin cargar no sale (RN-DEL-04); al cargarla sale y el cliente recibe «va en camino» con su enlace', async () => {
    const o = readyOrder('es-L1');
    if (!o) throw new Error('Sin pedido listo libre');
    const rt = D.createRoute({ route_date: G.TODAY, establishment_id: 'es-L1', slot_id: o.slot_id, code: 'PRUEBA-BOLSAS', order_ids: [o.id] });
    D.assign(rt.id, { mode: 'OWN', vehicle_id: 've-MTA-123', driver_user_id: D.drivers()[0].id });
    const s = D.activeStops(rt.id)[0]; const ps = D.parcels(s);
    ps.slice(0, -1).forEach(p => D.loadParcel(rt.id, p.label));
    let blocked = false; try { D.depart(rt.id); } catch (e) { if (!/^RN-DEL-04/.test(e.message)) throw new Error('Otra regla: ' + e.message); blocked = true; }
    if (!blocked) throw new Error('Salió con una bolsa sin cargar');
    D.loadParcel(rt.id, ps[ps.length - 1].label);
    D.depart(rt.id, { odometer_start: D.vehicle('ve-MTA-123').odometer_km });
    if (db.get('sales_orders', o.id).status !== 'IN_ROUTE') throw new Error('El pedido no pasó a EN RUTA');
    const t = db.find('tracking_links', x => x.order_id === o.id); if (!t) throw new Error('Sin enlace de seguimiento');
    const m = db.find('messages', x => x.ref === o.id && x.template === 'va_en_camino'); if (!m || !m.text.includes(t.token)) throw new Error('El mensaje «va en camino» no lleva el enlace');
  });
  /** ruta en camino con una parada pendiente (la primera ruta EN RUTA puede tener todas sus paradas ya atendidas) */
  const pendingStop = () => { for (const r of db.where('delivery_routes', x => x.status === 'IN_ROUTE')) { const s = D.activeStops(r.id).find(x => x.status === 'PENDING'); if (s) return { r, s }; } return { r: null, s: null }; };
  /** precondición de CA-DEL-01/10: en setiembre la moto y el repartidor de la ruta del criterio solo cargan los S/ 150 de la ruta.
      En el build completo otros módulos imputan gastos del mes a esa moto o a ese repartidor (GAS en delivery_costs; FLO en
      fuel_loads, vehicle_maintenances, vehicle_costs y traffic_fines, que D.costItems lee): se anulan con motivo para reproducir
      el escenario del criterio. En el build aislado no hay nada que anular. */
  const isolateCaRoute = r => {
    const inSep = d => String(d || '').slice(0, 7) === '2026-09';
    const why = 'Prueba CA-DEL: escenario del criterio (solo los costos de la ruta)';
    for (const c of db.where('delivery_costs', c => c.status !== 'VOIDED' && c.route_id !== r.id && inSep(c.cost_date) && ((c.vehicle_id && c.vehicle_id === r.vehicle_id) || (!c.vehicle_id && c.employee_id && c.employee_id === r.driver_employee_id)))) D.voidCost(c.id, why);
    const flo = [['fuel_loads', 'loaded_at', 'VOIDED'], ['vehicle_costs', 'cost_date', 'VOIDED'], ['traffic_fines', 'fine_date', 'VOIDED'], ['vehicle_maintenances', 'done_on', 'CANCELLED']];
    for (const [t, f, st] of flo) for (const x of db.where(t, x => x.vehicle_id === r.vehicle_id && inSep(x[f]) && x.status !== st)) db.update(t, x.id, { status: st, void_reason: why }, { silent: true });
    return r;
  };
  T('CA-DEL-04: entrega sin foto o con código 4821 (correcto 4812) se rechaza; con foto y código a 111 m queda entregada', async () => {
    const { r, s } = pendingStop(); if (!s) throw new Error('Sin parada pendiente');
    db.update('delivery_stops', s.id, { delivery_code: '4812', cod_amount: 0, collected_amount: 0 });
    const pin = D.orderPt(order(s.order_id));
    const at = { lat: pin[0] + 0.001, lng: pin[1] };
    try { D.deliver(s.id, Object.assign({ photo: false, code: '4812' }, at)); throw new Error('aceptó sin foto'); } catch (e) { if (!/^RN-DEL-06/.test(e.message)) throw e; }
    try { D.deliver(s.id, Object.assign({ photo: true, code: '4821' }, at)); throw new Error('aceptó el código 4821'); } catch (e) { if (!/^RN-DEL-06/.test(e.message)) throw e; }
    const res = D.deliver(s.id, Object.assign({ photo: true, code: '4812' }, at));
    const st = db.get('delivery_stops', s.id);
    if (st.status !== 'DELIVERED') throw new Error('La parada no quedó entregada');
    if (Math.round(res.distance_m) !== 111) throw new Error('Distancia ' + res.distance_m + ' m (esperado 111)');
    if (!D.parcels(st).every(p => p.status === 'DELIVERED')) throw new Error('Las bolsas no quedaron entregadas');
    if (order(s.order_id).status !== 'DELIVERED') throw new Error('El pedido no quedó ENTREGADO');
  });
  T('CA-DEL-05: empresa a S/ 9 por envío con 40 envíos en setiembre y factura de S/ 378 → esperado S/ 360, observada por S/ 18', async () => {
    const sup = D.carriers().find(c => c.trade_name === 'Express Lima');
    const n = D.carrierStops(sup.id, '2026-09-01', '2026-09-30').length; if (n !== 40) throw new Error('Envíos registrados: ' + n);
    const inv = D.reconcileInvoice({ supplier_id: sup.id, invoice_number: 'F001-PRUEBA', issue_date: '2026-10-05', period_from: '2026-09-01', period_to: '2026-09-30', amount: 378 });
    if (inv.expected_amount !== 360) throw new Error('Esperado ' + inv.expected_amount);
    if (inv.status !== 'OBSERVED' || inv.difference !== 18) throw new Error(`Estado ${inv.status} diferencia ${inv.difference}`);
  });
  T('CA-DEL-06: zona Surco con S/ 12,40 propio y tarifa de tercero S/ 9,00 → diferencia S/ 3,40 y sugerencia de tercerizar', async () => {
    const c = D.compareRow({ own: 12.40, carrier_rate: 9.00 });
    if (c.diff !== 3.4 || c.suggestion !== 'EVALUAR_TERCERIZAR') throw new Error(JSON.stringify(c));
    const rows = D.zoneComparison('2026-09-01'); const sur = rows.find(x => x.zone.id === 'dz-SURCO-A');
    if (!sur || sur.carrier_rate !== 9) throw new Error('La tarifa del tercero para Surco no sale en el comparativo');
  });
  T('CA-DEL-07: en la ruta del CA-DEL-01 una entrega gratis tiene S/ 15,00 de subsidio y una con S/ 10 cobrado, S/ 5,00', async () => {
    const r = caRoute(); const rows = D.allocRows('2026-09-01').filter(a => a.route_id === r.id);
    const free = rows.find(a => a.fee_charged === 0), paid = rows.find(a => a.fee_charged === 10);
    if (!free || !paid) throw new Error('La ruta no tiene una entrega gratis y una con S/ 10');
    if (!near(free.subsidy, 15) || !near(paid.subsidy, 5)) throw new Error(`Subsidios ${free.subsidy} y ${paid.subsidy}`);
  });
  T('CA-DEL-08: envío a Arequipa sin GRE no pasa a «entregado a la agencia» (RN-DEL-12)', async () => {
    const sh = db.find('province_shipments', x => x.status === 'PREPARED' && !x.dispatch_guide_id && /Arequipa/.test(x.destination));
    if (!sh) throw new Error('No hay envío a Arequipa sin GRE');
    try { D.handToAgency(sh.id, { tracking_number: 'AC-123' }); } catch (e) { if (!/^RN-DEL-12/.test(e.message)) throw e; return; }
    throw new Error('Pasó a la agencia sin GRE');
  });
  T('CA-DEL-09: la app sincroniza dos veces el mismo evento de entrega y queda registrado una sola vez', async () => {
    const { r, s } = pendingStop(); if (!s) throw new Error('Sin parada pendiente');
    db.update('delivery_stops', s.id, { cod_amount: 0 });
    const ev = { client_event_id: 'tel-A1-000123', type: 'DELIVERED', stop_id: s.id, route_id: r.id, payload: { photo: true, code: s.delivery_code } };
    D.syncEvent(ev); const second = D.syncEvent(ev);
    const n = db.where('delivery_events', e => e.client_event_id === 'tel-A1-000123').length;
    if (n !== 1 || !second.duplicate) throw new Error('Eventos registrados: ' + n);
  });
  T('CA-DEL-10: reparación de la moto de S/ 20 el 30/09 → corrida 2 de setiembre y S/ 17,00 por entrega', async () => {
    const r = caRoute(); const before = D.latestRun('2026-09-01');
    if (before !== 1) throw new Error('Se esperaba la corrida 1 sembrada; hay ' + before);
    const ri = isolateCaRoute(r);
    D.addCost({ cost_date: '2026-09-30', cost_type: 'MAINTENANCE_CORRECTIVE', amount: 20, vehicle_id: ri.vehicle_id, notes: 'Reparación' });
    const res = D.allocate('2026-09-01');
    if (res.run_no !== 2) throw new Error('Corrida ' + res.run_no);
    const x = routeCpd('2026-09-01', r.id, 2); if (!near(x.cpd, 17)) throw new Error('Costo por entrega ' + x.cpd);
    if (!near(routeCpd('2026-09-01', r.id, 1).cpd, 15)) throw new Error('La corrida 1 cambió (debe ser de solo inserción)');
  });
  D.x = { S, appShell, tile, big, appAction, tryDo, myRoutes, appDriver, routeMap, hm, order, user, orderLink, orderDrawer, dateInput, estPills, bagCount, assignedText, routesOf, posFor, plural, R, tsAdd, APP_ROLES };
})();
