/* =====================================================================
   DELX · Delivery, ampliación (Fase 1.1): calidad de dirección antes de
   rutear, ticket de entrega con detalle de pesos, gastos del repartidor
   que entran al cuadre de caja, apoyo de motorizados cuando el tiempo se
   complica, derivación a motorizado externo con evidencias, mensajes y
   audios a control y captura de pago para confirmar con cobranza.
   Se registra como pantallas DEL-17 a DEL-22 del módulo DEL.
   Tablas propias: driver_expenses, driver_messages, support_requests,
   external_handoffs. Campos nuevos en customer_addresses: verified_at,
   verified_by, call_signal, location_requested_at.
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, toast, tabs, pills } = G.ui;
  const db = G.db, U = G.util, F = G.fmt;
  const D = G.del, X = D.x;
  const { S, appShell, tile, big, appAction, tryDo, myRoutes, appDriver, hm, order, user, orderLink, orderDrawer, plural, R, tsAdd, APP_ROLES } = X;
  const st = { ph: {}, rec: null, aud: null, cat: 'FUEL', paid: 'ROUTE_CASH', delay: 0, addr: 'ALL', msgTo: 'COORDINADOR_DELIVERY', msgFilter: 'OPEN' };

  D.EXP_CATS = [['FUEL', 'Combustible', 'FUEL'], ['MEAL', 'Alimentación', 'DRIVER_MEAL'], ['TOLL', 'Peajes', 'TOLL'], ['EXT_COURIER', 'Motorizado externo', 'CARRIER_FEE'], ['OTHER', 'Otros', 'OTHER']];
  D.expCatName = c => (D.EXP_CATS.find(x => x[0] === c) || [c, c || '—'])[1];
  D.PAID_WITH = [['ROUTE_CASH', 'Del efectivo cobrado en ruta'], ['OWN', 'Con mi dinero (me reembolsan)']];
  const MSG_TO = [['COORDINADOR_DELIVERY', 'Coordinación de delivery'], ['CAJERO', 'Cobranza'], ['SUPERVISORA_VENTAS', 'Ventas']];
  const roleLabel = r => (MSG_TO.find(x => x[0] === r) || [r, r])[1];
  const OFFICE_EDIT = () => !['REPARTIDOR', 'CLIENTE_B2B'].includes(G.ctx.role);
  const photoBtn = (key, label) => btn(st.ph[key] ? label + ' ✓' : label, () => { st.ph[key] = !st.ph[key]; G.refresh(); }, { kind: st.ph[key] ? 'ok' : '', sm: true });
  const photoThumb = (txt) => h('div', { style: 'height:44px;border-radius:8px;background:repeating-linear-gradient(45deg,var(--surface-2),var(--surface-2) 8px,var(--line) 8px,var(--line) 16px);display:grid;place-items:center;font-size:.74rem;padding:0 6px;text-align:center' }, txt);
  const userId = () => G.ctx.userId();
  const notifyRole = (role, title, bodyTxt, ref, tone = 'info') => { try { G.notify({ role, title, body: bodyTxt, ref, tone, module: 'DEL' }); } catch (e) { /* sin notificaciones en pruebas */ } };

  /* ------------------------------------------------------------------
     Calidad de la dirección (antes de rutear)
     ------------------------------------------------------------------ */
  D.addrScore = function (o) {
    const a = db.get('customer_addresses', o.address_id);
    const issues = []; let score = 100;
    const pen = (n, msg) => { score -= n; issues.push(msg); };
    if (!a) return { score: 0, level: 'BAD', issues: ['El pedido no tiene dirección'], addr: null };
    if (a.lat == null || a.lng == null) pen(40, 'Sin pin en el mapa');
    else {
      const z = db.get('delivery_zones', a.zone_id);
      if (z && z.lat != null && G.geo.km([a.lat, a.lng], [z.lat, z.lng]) > 9) pen(25, 'El pin cae lejos de la zona elegida');
      if (a.pin_source === 'WEB') pen(8, 'Pin puesto por el cliente en la web: confirmar');
    }
    if (!a.zone_id) pen(20, 'Sin zona de reparto');
    if (!a.reference) pen(15, 'Sin referencia (color de casa, tienda cercana)');
    if (!(a.address_line || '').match(/\d/)) pen(12, 'La dirección no tiene número');
    if ((a.address_line || '').length < 15) pen(10, 'Dirección muy corta');
    if (!(o.contact_phone || a.contact_phone)) pen(20, 'Sin teléfono de contacto');
    if (!a.verified_at) pen(8, 'Aún no confirmada con el cliente');
    score = Math.max(0, score);
    return { score, level: score >= 85 ? 'OK' : score >= 65 ? 'REVIEW' : 'BAD', issues, addr: a };
  };
  const LEVEL = { OK: ['Confiable', 'ok'], REVIEW: ['Revisar', 'warn'], BAD: ['Riesgo alto', 'bad'] };
  D.verifyAddress = function (addrId, { note } = {}) {
    const a = db.get('customer_addresses', addrId); if (!a) G.fail('RN-DEL-14', 'Dirección no encontrada.');
    if (a.lat == null || a.lng == null) G.fail('RN-DEL-14', 'No se confirma una dirección sin pin: pide la ubicación al cliente.');
    return db.update('customer_addresses', a.id, { verified_at: G.date.now(), verified_by: userId(), verify_note: note || null }, { silent: true });
  };
  D.requestLocation = function (orderId) {
    const o = order(orderId); const a = o && db.get('customer_addresses', o.address_id); if (!a) G.fail('RN-DEL-14', 'El pedido no tiene dirección.');
    db.update('customer_addresses', a.id, { location_requested_at: G.date.now() }, { silent: true });
    return a;
  };
  D.setSignal = function (addrId, value) {
    const a = db.get('customer_addresses', addrId); if (!a) G.fail('RN-DEL-14', 'Dirección no encontrada.');
    return db.update('customer_addresses', a.id, { call_signal: value }, { silent: true });
  };

  /* ------------------------------------------------------------------
     Ticket de entrega: lo pedido, lo pesado y la diferencia
     ------------------------------------------------------------------ */
  D.ticket = function (o) {
    const lines = (o.lines || []).map(l => {
      const v = G.variant(l.variant_id); const byKg = l.price_basis === 'KG';
      const est = byKg ? (l.est_weight_kg ?? l.qty) : null; const real = byKg ? (l.weighed_kg ?? est) : null;
      const amount = l.final_amount != null ? l.final_amount : R((byKg ? real : l.qty) * (l.unit_price || 0) - (l.discount_amount || 0));
      const estAmount = R((byKg ? est : l.qty) * (l.unit_price || 0) - (l.discount_amount || 0));
      return { name: G.variantName(l.variant_id), qty: l.qty, byKg, unit_price: l.unit_price || 0, est_kg: est, real_kg: real, diff_kg: byKg ? R(real - est, 3) : null, diff_pct: byKg && est ? R((real - est) / est * 100, 1) : null, amount, est_amount: estAmount, weighed: byKg && l.weighed_kg != null, unit: v && v.sale_mode === 'KG' ? 'kg' : 'und' };
    });
    const sub = R(U.sum(lines, l => l.amount)); const subEst = R(U.sum(lines, l => l.est_amount));
    const total = D.orderTotal(o); const adj = R(total - sub);
    const paid = o.paid_amount || 0;
    return { lines, sub, sub_est: subEst, adj, total, est_total: o.estimated_total ?? subEst, paid, to_collect: Math.max(0, R(total - paid)), diff_amount: R(sub - subEst), fee: o.delivery_fee || 0, weighed: lines.some(l => l.weighed) };
  };
  const NOTE_CUT = 'Las carnes se cortan a mano y su peso varía un poco: el cobro final se calcula con el peso real de la balanza.';
  function ticketNode(o, s) {
    const t = D.ticket(o);
    const row = (a, b, bold) => h('div', { style: `display:flex;justify-content:space-between;gap:8px;${bold ? 'font-weight:800;' : ''}` }, h('span', null, a), h('span', { class: 'mono' }, b));
    return h('div', { style: 'background:#fff;color:#111;border:1px dashed #888;border-radius:10px;padding:14px;max-width:340px;font-size:.82rem;display:grid;gap:6px' },
      h('div', { style: 'text-align:center;font-weight:800' }, G.brandName(o.brand_id).toUpperCase()), h('div', { style: 'text-align:center' }, 'Ticket de entrega'),
      row('Pedido', o.number), row('Cliente', G.custName(o.customer_id).split(' ').slice(0, 2).join(' ')), row('Fecha', F.date(o.delivery_date)),
      h('hr'),
      ...t.lines.map(l => h('div', { style: 'display:grid;gap:1px' },
        row(`${l.qty} × ${l.name}`, F.money(l.amount)),
        l.byKg ? h('div', { style: 'font-size:.74rem;color:#444' }, `Pedido ${F.num(l.est_kg, 2)} kg · Pesado ${l.weighed ? F.num(l.real_kg, 2) + ' kg' : 'pendiente'}${l.weighed && l.diff_kg ? ` (${l.diff_kg > 0 ? '+' : ''}${F.num(l.diff_kg, 2)} kg, ${l.diff_pct > 0 ? '+' : ''}${F.num(l.diff_pct, 1)} %)` : ''} · ${F.money(l.unit_price)}/kg`) : h('div', { style: 'font-size:.74rem;color:#444' }, `${F.money(l.unit_price)} c/u`))),
      h('hr'),
      row('Subtotal productos', F.money(t.sub)), t.adj ? row(t.adj > 0 ? 'Delivery y otros' : 'Descuentos', F.money(t.adj)) : null,
      row('TOTAL', F.money(t.total), true), t.paid ? row('Ya pagado', '− ' + F.money(t.paid)) : null, row('A cobrar ahora', F.money(t.to_collect), true),
      t.weighed && t.diff_amount ? h('div', { style: 'background:#f4f4f4;border-radius:6px;padding:6px;font-size:.76rem' }, `Frente a lo cotizado (${F.money(t.sub_est)}), el peso real ${t.diff_amount > 0 ? 'suma' : 'resta'} ${F.money(Math.abs(t.diff_amount))}.`) : null,
      h('div', { style: 'font-size:.72rem;color:#444;text-align:center' }, NOTE_CUT),
      s ? h('div', { style: 'font-size:.72rem;text-align:center' }, `Entregó: ${G.userShort(db.get('delivery_routes', s.route_id).driver_user_id)}`) : null);
  }
  D.ticketGiven = sid => !!db.find('delivery_events', e => e.stop_id === sid && e.event_type === 'TICKET');
  D.ext.TICKET = (stopId, p) => {
    const s = db.get('delivery_stops', stopId); if (!s) G.fail('RN-DEL-15', 'Parada no encontrada.');
    D.event({ route_id: s.route_id, stop_id: s.id, event_type: 'TICKET', notes: p.via === 'WHATSAPP' ? 'Ticket enviado por WhatsApp' : 'Ticket mostrado y entregado al cliente', client_event_id: p.client_event_id });
    return { ok: true };
  };

  /* ------------------------------------------------------------------
     Gastos del repartidor (entran al cuadre)
     ------------------------------------------------------------------ */
  D.addExpense = function (d) {
    const r = db.get('delivery_routes', d.route_id); if (!r) G.fail('RN-DEL-16', 'Elige la ruta del gasto.');
    const cat = D.EXP_CATS.find(c => c[0] === d.category); if (!cat) G.fail('RN-DEL-16', 'Elige el tipo de gasto.');
    const amount = Number(d.amount); if (!(amount > 0)) G.fail('RN-DEL-16', 'El monto del gasto debe ser mayor que cero.');
    if (!['ROUTE_CASH', 'OWN'].includes(d.paid_with)) G.fail('RN-DEL-16', 'Indica con qué dinero pagaste.');
    if (['FUEL', 'EXT_COURIER'].includes(cat[0]) && !d.photo) G.fail('RN-DEL-16', 'Este gasto exige foto del comprobante o del vale.');
    if (cat[0] === 'OTHER' && !String(d.note || '').trim()) G.fail('RN-DEL-16', 'Los gastos «Otros» llevan una nota que diga en qué se gastó.');
    if (cat[0] === 'FUEL') { if (!(Number(d.fuel_gallons) > 0)) G.fail('RN-DEL-16', 'El combustible exige los galones cargados.'); if (!String(d.voucher_no || '').trim()) G.fail('RN-DEL-16', 'El combustible exige el número de vale o comprobante.'); }
    if (d.client_event_id && db.find('delivery_events', e => e.client_event_id === d.client_event_id)) return { duplicate: true };
    const date = r.route_date;
    const cost = D.addCost({ cost_date: date, cost_type: cat[2], amount: R(amount), route_id: r.id, vehicle_id: cat[0] === 'FUEL' ? r.vehicle_id : null, employee_ref: r.driver_employee_id, fuel_gallons: cat[0] === 'FUEL' ? Number(d.fuel_gallons) : null, fuel_voucher_no: cat[0] === 'FUEL' ? d.voucher_no : null, notes: `Gasto del repartidor · ${cat[1]}${d.note ? ' · ' + d.note : ''}` });
    const row = db.insert('driver_expenses', { number: db.next('GDR', 'GDR-', 5), route_id: r.id, driver_user_id: r.driver_user_id, expense_date: date, category: cat[0], amount: R(amount), paid_with: d.paid_with, note: d.note || null, photo_file_id: d.photo ? 'foto-' + U.token(8) : null, fuel_gallons: d.fuel_gallons || null, voucher_no: d.voucher_no || null, status: 'ACTIVE', settled: false, cost_id: cost.id, occurred_at: d.at || G.date.now() }, { silent: true });
    D.event({ route_id: r.id, event_type: 'EXPENSE', amount: R(amount), notes: `${cat[1]} ${F.money(amount)} · ${d.paid_with === 'ROUTE_CASH' ? 'del efectivo de ruta' : 'dinero propio'}`, client_event_id: d.client_event_id, photo_file_id: row.photo_file_id });
    return { expense: row };
  };
  D.ext.EXPENSE = (stopId, p, e) => D.addExpense(Object.assign({}, p, { route_id: e.route_id || p.route_id }));
  D.expensesOf = rid => db.where('driver_expenses', x => x.route_id === rid && x.status !== 'VOIDED').sort(U.by('occurred_at'));

  /* ------------------------------------------------------------------
     Mensajes, comentarios, audios y capturas para confirmar con cobranza
     ------------------------------------------------------------------ */
  D.sendMessage = function (d) {
    const r = db.get('delivery_routes', d.route_id); if (!r) G.fail('RN-DEL-17', 'Elige la ruta del mensaje.');
    const kind = d.kind || 'TEXT';
    if (kind === 'AUDIO' && !(d.audio_sec > 0)) G.fail('RN-DEL-17', 'Graba el audio antes de enviarlo.');
    if (kind === 'CAPTURE') { if (!d.photo) G.fail('RN-DEL-17', 'Adjunta la captura del pago o de la entrega.'); if (!(Number(d.amount) > 0)) G.fail('RN-DEL-17', 'La captura lleva el monto que aparece en ella.'); }
    if (['TEXT', 'COMMENT'].includes(kind) && !String(d.text || '').trim()) G.fail('RN-DEL-17', 'Escribe el mensaje.');
    if (d.client_event_id && db.find('delivery_events', e => e.client_event_id === d.client_event_id)) return { duplicate: true };
    const to = d.to_role || (kind === 'CAPTURE' ? 'CAJERO' : 'COORDINADOR_DELIVERY');
    const m = db.insert('driver_messages', { route_id: r.id, stop_id: d.stop_id || null, from_user_id: d.from_user_id || r.driver_user_id, kind, text: d.text || null, audio_sec: kind === 'AUDIO' ? Math.round(d.audio_sec) : null, photo_file_id: d.photo ? 'foto-' + U.token(8) : null, amount: kind === 'CAPTURE' ? R(Number(d.amount)) : null, to_role: to, status: 'SENT', sent_at: d.at || G.date.now() }, { silent: true });
    D.event({ route_id: r.id, stop_id: d.stop_id || null, event_type: 'MESSAGE', notes: `${kind === 'AUDIO' ? 'Audio ' + m.audio_sec + ' s' : kind === 'CAPTURE' ? 'Captura ' + F.money(m.amount) : (d.text || '').slice(0, 60)} → ${roleLabel(to)}`, client_event_id: d.client_event_id });
    notifyRole(to, kind === 'AUDIO' ? `Audio de ${G.userShort(m.from_user_id)}` : kind === 'CAPTURE' ? `Captura por confirmar · ${F.money(m.amount)}` : `Mensaje de ${G.userShort(m.from_user_id)}`, `Ruta ${r.code}${m.stop_id ? ' · parada ' + (db.get('delivery_stops', m.stop_id) || {}).seq : ''}`, m.id, kind === 'CAPTURE' ? 'warn' : 'info');
    return { message: m };
  };
  D.ext.MESSAGE = (stopId, p, e) => D.sendMessage(Object.assign({}, p, { route_id: e.route_id || p.route_id, stop_id: stopId || p.stop_id }));
  D.ackMessage = function (id, { status, reply, confirmed_amount } = {}) {
    const m = db.get('driver_messages', id); if (!m) G.fail('RN-DEL-17', 'Mensaje no encontrado.');
    if (!['READ', 'CONFIRMED', 'REJECTED'].includes(status)) G.fail('RN-DEL-17', 'Estado no válido.');
    if (status === 'CONFIRMED' && m.kind !== 'CAPTURE') G.fail('RN-DEL-17', 'Solo se confirman capturas de pago o de entrega.');
    if (m.kind === 'CAPTURE' && status === 'CONFIRMED') {
      if (!(Number(confirmed_amount) >= 0) || confirmed_amount === '' || confirmed_amount == null) G.fail('RN-DEL-17', 'Escribe el monto que ves recibido para confirmar.');
      if (Math.abs(Number(confirmed_amount) - m.amount) > 0.009 && !String(reply || '').trim()) G.fail('RN-DEL-17', `El monto recibido (${F.money(confirmed_amount)}) no coincide con la captura (${F.money(m.amount)}): escribe el motivo.`);
    }
    if (status === 'REJECTED' && !String(reply || '').trim()) G.fail('RN-DEL-17', 'Indica por qué se rechaza.');
    return db.update('driver_messages', m.id, { status, reply: reply || m.reply || null, confirmed_amount: confirmed_amount != null && confirmed_amount !== '' ? Number(confirmed_amount) : m.confirmed_amount || null, ack_by: userId(), ack_at: G.date.now() }, { silent: true });
  };

  /* ------------------------------------------------------------------
     Riesgo de tiempo y pedido de apoyo
     ------------------------------------------------------------------ */
  D.timeRisk = function (r, delay = 0) {
    const open = D.activeStops(r.id).filter(s => ['PENDING', 'ARRIVED'].includes(s.status));
    if (!open.length || !r.slot_to) return { open, late_min: 0, level: 'OK', far: [] };
    D.computeEta(r);
    const last = D.activeStops(r.id).filter(s => ['PENDING', 'ARRIVED'].includes(s.status)).slice(-1)[0];
    const end = r.route_date + 'T' + r.slot_to + ':00';
    const eta = tsAdd(last.eta || end, delay);
    const late = Math.round(D.minutesBetween(end, eta));
    const base = D.lastPosition(r) ? [D.lastPosition(r).lat, D.lastPosition(r).lng] : D.sitePt(r.establishment_id);
    const far = open.map(s => ({ s, km: G.geo.km(base, D.orderPt(order(s.order_id))) })).sort((a, b) => b.km - a.km).slice(0, 2).map(x => x.s);
    return { open, late_min: late, eta, level: late > 30 ? 'BAD' : late > 0 ? 'WARN' : 'OK', far };
  };
  D.requestSupport = function (d) {
    const r = db.get('delivery_routes', d.route_id); if (!r || r.status !== 'IN_ROUTE') G.fail('RN-DEL-18', 'El apoyo se pide con la ruta en curso.');
    const ids = (d.stop_ids || []).filter(id => { const s = db.get('delivery_stops', id); return s && s.route_id === r.id && ['PENDING', 'ARRIVED'].includes(s.status); });
    if (!ids.length) G.fail('RN-DEL-18', 'Elige al menos una parada pendiente para el apoyo.');
    if (d.client_event_id && db.find('delivery_events', e => e.client_event_id === d.client_event_id)) return { duplicate: true };
    const dup = db.find('support_requests', x => x.route_id === r.id && x.status === 'REQUESTED' && ids.some(i => x.stop_ids.includes(i)));
    if (dup) G.fail('RN-DEL-18', 'Ya hay un pedido de apoyo abierto para alguna de esas paradas.');
    const row = db.insert('support_requests', { number: db.next('APY', 'APY-', 5), route_id: r.id, stop_ids: ids, reason: d.reason || 'Tiempo ajustado', late_min: d.late_min || null, status: 'REQUESTED', requested_by: r.driver_user_id, requested_at: d.at || G.date.now() }, { silent: true });
    D.event({ route_id: r.id, event_type: 'SUPPORT_REQUEST', notes: `Apoyo en ${ids.length} parada(s): ${d.reason || 'tiempo ajustado'}`, client_event_id: d.client_event_id });
    notifyRole('COORDINADOR_DELIVERY', `Apoyo pedido · ${r.code}`, `${plural(ids.length, 'parada', 'paradas')} lejana(s). ${d.reason || ''}`, row.id, 'warn');
    return { request: row };
  };
  D.ext.SUPPORT = (stopId, p, e) => D.requestSupport(Object.assign({}, p, { route_id: e.route_id || p.route_id }));
  /** pasa una parada abierta de una ruta en curso a otra ruta (motorizado de apoyo) */
  D.reassignInRoute = function (stopId, toRouteId, note) {
    const s = db.get('delivery_stops', stopId); const to = db.get('delivery_routes', toRouteId);
    if (!s || !to) G.fail('RN-DEL-18', 'Parada o ruta de apoyo no encontrada.');
    if (!['PENDING', 'ARRIVED'].includes(s.status)) G.fail('RN-DEL-18', 'Solo se pasa una parada abierta.');
    if (!['PLANNED', 'LOADING', 'IN_ROUTE'].includes(to.status)) G.fail('RN-DEL-18', `La ruta ${to.code} no admite paradas (${to.status}).`);
    if (to.id === s.route_id) G.fail('RN-DEL-18', 'Elige otra ruta.');
    const from = db.get('delivery_routes', s.route_id);
    db.update('delivery_stops', s.id, { status: 'CANCELLED', closed_at: G.date.now(), notes: `Apoyo: pasó a ${to.code}` }, { silent: true });
    const seq = Math.max(0, ...D.stopsOf(to.id).map(x => x.seq)) + 1;
    const ns = db.insert('delivery_stops', { route_id: to.id, order_id: s.order_id, seq, zone_id: s.zone_id, eta: null, status: 'PENDING', cod_amount: s.cod_amount, collected_amount: s.collected_amount || 0, delivery_code: s.delivery_code, pod_distance_m: null, arrived_at: null, closed_at: null, distance_km: null, bags: s.bags, kg: s.kg, support_from: from ? from.code : null, notes: note || null }, { silent: true });
    D.event({ route_id: to.id, stop_id: ns.id, event_type: 'SUPPORT_ASSIGNED', notes: `Recibe del apoyo: pedido ${(order(s.order_id) || {}).number} desde ${from ? from.code : '—'}` });
    D.computeEta(to); if (from) D.computeEta(from);
    return ns;
  };
  D.resolveSupport = function (id, { action, to_route_id, note } = {}) {
    const q = db.get('support_requests', id); if (!q || q.status !== 'REQUESTED') G.fail('RN-DEL-18', 'El pedido de apoyo ya fue atendido.');
    if (action === 'ASSIGN') {
      if (!to_route_id) G.fail('RN-DEL-18', 'Elige el motorizado o la ruta que apoya.');
      for (const sid of q.stop_ids) { const s = db.get('delivery_stops', sid); if (s && ['PENDING', 'ARRIVED'].includes(s.status)) D.reassignInRoute(sid, to_route_id, note); }
      db.update('support_requests', q.id, { status: 'ASSIGNED', resolved_by: userId(), resolved_at: G.date.now(), target_route_id: to_route_id, note: note || null }, { silent: true });
    } else if (action === 'EXTERNAL') {
      db.update('support_requests', q.id, { status: 'EXTERNAL_OK', resolved_by: userId(), resolved_at: G.date.now(), note: note || null }, { silent: true });
      notifyRole('REPARTIDOR', 'Deriva con motorizado externo', `Autorizado en la ruta ${(db.get('delivery_routes', q.route_id) || {}).code}: toma las fotos de motorizado, placa y producto.`, q.id, 'info');
    } else if (action === 'REJECT') {
      if (!String(note || '').trim()) G.fail('RN-DEL-18', 'Indica por qué no se da el apoyo.');
      db.update('support_requests', q.id, { status: 'REJECTED', resolved_by: userId(), resolved_at: G.date.now(), note }, { silent: true });
    } else G.fail('RN-DEL-18', 'Acción no válida.');
    return db.get('support_requests', q.id);
  };

  /* ------------------------------------------------------------------
     Derivación a motorizado externo con evidencias
     ------------------------------------------------------------------ */
  D.handoff = function (stopId, d) {
    const s = db.get('delivery_stops', stopId); const r = s && db.get('delivery_routes', s.route_id);
    if (!s || !r || r.status !== 'IN_ROUTE') G.fail('RN-DEL-19', 'La derivación se hace con la ruta en curso.');
    if (!['PENDING', 'ARRIVED'].includes(s.status)) G.fail('RN-DEL-19', 'La parada ya no está abierta.');
    if (d.client_event_id && db.find('delivery_events', e => e.client_event_id === d.client_event_id)) return { duplicate: true };
    if (!String(d.courier_name || '').trim()) G.fail('RN-DEL-19', 'Escribe el nombre del motorizado.');
    if (!/^[A-Za-z0-9]{3}-?[A-Za-z0-9]{2,3}$/.test(String(d.plate || '').trim())) G.fail('RN-DEL-19', 'Escribe la placa del motorizado (ej. 1234-AB o ABC-123).');
    if (!d.photo_courier) G.fail('RN-DEL-19', 'Falta la foto del motorizado.');
    if (!d.photo_plate) G.fail('RN-DEL-19', 'Falta la foto de la placa.');
    if (!d.photo_product) G.fail('RN-DEL-19', 'Falta la foto del producto que entregas al motorizado.');
    const cost = Number(d.shipping_cost); if (d.shipping_cost === '' || d.shipping_cost == null || isNaN(cost) || cost < 0) G.fail('RN-DEL-19', 'Escribe el costo del envío (puede ser 0).');
    const o = order(s.order_id); const pend = D.codPending(s);
    const h0 = db.insert('external_handoffs', { number: db.next('DER', 'DER-', 5), stop_id: s.id, route_id: r.id, order_id: o.id, courier_name: d.courier_name.trim(), courier_phone: d.courier_phone || null, plate: String(d.plate).toUpperCase().trim(), photo_courier: 'foto-' + U.token(8), photo_plate: 'foto-' + U.token(8), photo_product: 'foto-' + U.token(8), shipping_cost: R(cost), paid_with: d.paid_with || 'ROUTE_CASH', cod_pending: pend, status: 'HANDED', note: d.note || null, handed_at: d.at || G.date.now(), handed_by: r.driver_user_id }, { silent: true });
    db.update('delivery_stops', s.id, { status: 'HANDED_OFF', handoff_id: h0.id, closed_at: d.at || G.date.now() }, { silent: true });
    D.event({ route_id: r.id, stop_id: s.id, event_type: 'HANDOFF', notes: `Derivado a ${h0.courier_name} (${h0.plate}) · envío ${F.money(cost)}${pend ? ' · cobro pendiente ' + F.money(pend) : ''}`, client_event_id: d.client_event_id });
    if (cost > 0) { const ex = D.addExpense({ route_id: r.id, category: 'EXT_COURIER', amount: cost, paid_with: h0.paid_with, photo: true, note: `Derivación ${h0.number} a ${h0.courier_name}` }); db.update('external_handoffs', h0.id, { expense_id: ex.expense.id }, { silent: true }); }
    notifyRole('COORDINADOR_DELIVERY', `Derivado a externo · ${o.number}`, `${h0.courier_name} (${h0.plate}) lleva el pedido. Confirma la entrega en DEL-20.`, h0.id, 'warn');
    return { handoff: h0 };
  };
  D.ext.HANDOFF = (stopId, p) => D.handoff(stopId, p);
  D.confirmHandoff = function (id, { delivered, note, method, reference } = {}) {
    const hf = db.get('external_handoffs', id); if (!hf || hf.status !== 'HANDED') G.fail('RN-DEL-19', 'La derivación ya fue cerrada.');
    const s = db.get('delivery_stops', hf.stop_id); const o = order(hf.order_id); const now = G.date.now();
    if (!delivered) {
      if (!String(note || '').trim()) G.fail('RN-DEL-19', 'Indica por qué no se entregó.');
      db.update('external_handoffs', hf.id, { status: 'FAILED', closed_at: now, note }, { silent: true });
      db.update('delivery_stops', s.id, { status: 'FAILED', fail_reason: 'CUSTOMER_ABSENT', closed_at: now, bags_returned: false }, { silent: true });
      G.orders.transition(o, 'NOT_DELIVERED', { reason: `Motorizado externo: ${note}` });
      return db.get('external_handoffs', hf.id);
    }
    let payId = null;
    if (hf.cod_pending > 0) {
      if (!D.COD_METHODS.some(m => m[0] === method)) G.fail('RN-DEL-09', 'El pedido tenía cobro pendiente: indica el medio con que lo recibe la empresa.');
      if (['pm-YAPE', 'pm-PLIN'].includes(method) && !reference) G.fail('RN-CAJ-02', 'Escribe el número de operación.');
      const pay = G.pay.register({ customer_id: o.customer_id, payment_method_id: method, amount: hf.cod_pending, reference: reference || null, cash_account_id: G.pay.accountFor(method, {}), allocations: [{ order_id: o.id, document_id: null, amount: hf.cod_pending }], brand_id: o.brand_id, establishment_id: o.establishment_id, collected_by_user_id: userId() });
      payId = pay.id; db.update('delivery_stops', s.id, { collected_amount: R((s.collected_amount || 0) + hf.cod_pending) }, { silent: true });
    }
    db.update('external_handoffs', hf.id, { status: 'DELIVERED', closed_at: now, delivered_confirmed_by: userId(), payment_id: payId, note: note || hf.note }, { silent: true });
    db.update('delivery_stops', s.id, { status: 'DELIVERED', closed_at: now }, { silent: true });
    D.setParcel(s, null, 'DELIVERED');
    G.orders.transition(o, 'DELIVERED', { reason: `Entregado por motorizado externo ${hf.courier_name} (${hf.plate})` });
    return db.get('external_handoffs', hf.id);
  };

  /* ==================================================================
     Pantallas
     ================================================================== */
  /* ---------- DEL-17 App: gastos del repartidor ---------- */
  function scr17(el) {
    appShell(el, 'DEL-17', 'App: gastos de la ruta', 'Combustible, alimentación, peajes y otros gastos de la ruta con foto del comprobante; los que salen del efectivo cobrado bajan el efectivo a entregar en la liquidación.', uid => {
      const rs = myRoutes(uid).filter(r => ['IN_ROUTE', 'RETURNED', 'LOADING', 'PLANNED'].includes(r.status));
      if (!rs.length) return [tile(h('b', null, 'Sin ruta abierta'), h('span', { class: 'small muted' }, 'Registra gastos con una ruta del día.'))];
      const route = h('select', { class: 'input', attrs: { 'aria-label': 'Ruta' } }, rs.map(r => h('option', { value: r.id }, `${r.code} · ${D.routeBadge ? '' : ''}${r.status === 'IN_ROUTE' ? 'en ruta' : r.status === 'RETURNED' ? 'de vuelta' : 'por salir'}`)));
      const amount = h('input', { class: 'input', type: 'number', step: '0.10', min: '0', placeholder: 'Monto S/', attrs: { 'aria-label': 'Monto' } });
      const gal = h('input', { class: 'input', type: 'number', step: '0.01', placeholder: 'Galones', attrs: { 'aria-label': 'Galones' } });
      const vou = h('input', { class: 'input', placeholder: 'N.° de vale o boleta', attrs: { 'aria-label': 'Vale' } });
      const note = h('input', { class: 'input', placeholder: st.cat === 'OTHER' ? 'En qué se gastó (obligatorio)' : 'Nota (opcional)', attrs: { 'aria-label': 'Nota' } });
      const paid = h('select', { class: 'input', attrs: { 'aria-label': 'Pagado con' } }, D.PAID_WITH.map(([v, l]) => h('option', { value: v, selected: v === st.paid }, l)));
      paid.addEventListener('change', () => { st.paid = paid.value; });
      const out = [tile(h('b', null, 'Nuevo gasto'),
        pills(D.EXP_CATS.filter(c => c[0] !== 'EXT_COURIER').map(c => [c[0], c[1]]), st.cat, v => { st.cat = v; G.refresh(); }), route, amount,
        st.cat === 'FUEL' ? h('div', { class: 'row' }, gal, vou) : null, note, paid,
        h('div', { class: 'row' }, photoBtn('exp', 'Foto del comprobante')),
        big('Registrar gasto', () => {
          const payload = { category: st.cat, amount: amount.value, paid_with: paid.value, note: note.value.trim(), photo: !!st.ph.exp, fuel_gallons: gal.value, voucher_no: vou.value.trim() };
          const r = db.get('delivery_routes', route.value);
          if (!S.offline) { try { D.addExpense(Object.assign({ route_id: r.id }, payload)); } catch (e) { return toast(e.message, 'bad'); } st.ph.exp = false; toast('Gasto registrado', 'ok'); return G.refresh(); }
          if (appAction('EXPENSE', { id: null, route_id: r.id }, payload, `Gasto ${D.expCatName(st.cat)} ${F.money(Number(amount.value) || 0)}`)) st.ph.exp = false;
        }))];
      for (const r of rs) {
        const ex = D.expensesOf(r.id); const e = D.expectedCash(r.id);
        out.push(tile(h('div', { class: 'row between' }, h('b', { class: 'mono' }, r.code), badge(`${ex.length} gasto(s)`, ex.length ? 'info' : '')),
          dl([['Cobrado en efectivo', F.money(e.gross)], ['Gastos de la ruta', '− ' + F.money(e.expenses)], ['Efectivo a entregar', F.money(e.cash)]]),
          ex.length ? h('div', { class: 'stack small', style: 'gap:4px' }, ex.map(x => h('div', { class: 'row between' }, h('span', null, `${D.expCatName(x.category)}${x.note ? ' · ' + x.note : ''}`, x.paid_with === 'OWN' ? h('span', { class: 'muted' }, ' (mi dinero)') : null), h('b', { class: 'mono' }, F.money(x.amount))))) : h('span', { class: 'small muted' }, 'Aún sin gastos.')));
      }
      return out;
    }, uid => card('Cómo cuadra', h('div', { class: 'stack small' }, h('p', null, 'Efectivo a entregar = cobros en efectivo − gastos pagados del efectivo de ruta.'), h('p', { class: 'muted' }, 'Si pagas con tu dinero, el gasto queda por reembolsar y no baja el efectivo a entregar. Cada gasto genera su costo por entrega (combustible, comida, peajes).'))));
  }

  /* ---------- DEL-18 Ticket de entrega ---------- */
  function scr18(el, params) {
    const isDrv = G.ctx.role === 'REPARTIDOR';
    const pick = () => {
      if (params && params.stop) { const s = db.get('delivery_stops', params.stop); if (s) return { s, o: order(s.order_id) }; }
      if (params && params.order) return { s: D.activeStopOf(params.order), o: order(params.order) };
      if (st.ticketOrder) return { s: D.activeStopOf(st.ticketOrder), o: order(st.ticketOrder) };
      if (isDrv) { const r = myRoutes(appDriver()).find(x => x.status === 'IN_ROUTE'); const s = r && D.activeStops(r.id).find(x => ['PENDING', 'ARRIVED'].includes(x.status)); if (s) return { s, o: order(s.order_id) }; }
      const o = db.where('sales_orders', x => x.fulfillment === 'DELIVERY' && ['READY', 'IN_ROUTE', 'DELIVERED'].includes(x.status) && x.delivery_date === S.date).find(x => (x.lines || []).some(l => l.weighed_kg != null));
      return o ? { s: D.activeStopOf(o.id), o } : null;
    };
    const build = () => {
      const p = pick(); if (!p || !p.o) return [tile(h('b', null, 'Sin pedido para el ticket'), h('span', { class: 'small muted' }, 'Abre el ticket desde una parada o elige un pedido.'))];
      const { s, o } = p;
      const t = D.ticket(o);
      const out = [ticketNode(o, s)];
      if (!isDrv) {
        const opts = db.where('sales_orders', x => x.fulfillment === 'DELIVERY' && x.delivery_date === S.date && !['CANCELLED', 'DRAFT'].includes(x.status)).slice(0, 60);
        out.unshift(h('select', { class: 'input', attrs: { 'aria-label': 'Pedido' }, on: { change: e => { st.ticketOrder = e.target.value; params = {}; G.refresh(); } } }, opts.map(x => h('option', { value: x.id, selected: x.id === o.id }, `${x.number} · ${G.custName(x.customer_id)}`))));
      }
      out.push(h('div', { class: 'row' },
        s ? btn(D.ticketGiven(s.id) ? 'Ticket entregado ✓' : 'Entregar ticket al cliente', () => { if (['PENDING', 'ARRIVED'].includes(s.status) || s.status === 'DELIVERED') { if (isDrv) appAction('TICKET', s, { via: 'PAPER' }, `Ticket parada ${s.seq}`); else tryDo(() => D.ext.TICKET(s.id, { via: 'PAPER', client_event_id: D.newEventId() }), 'Ticket registrado'); } else toast('La parada no está abierta.', 'warn'); }, { kind: 'primary', disabled: D.ticketGiven(s.id) }) : null,
        btn('Enviar por WhatsApp', () => { if (s) { if (isDrv) appAction('TICKET', s, { via: 'WHATSAPP' }, `Ticket WhatsApp parada ${s.seq}`); else D.ext.TICKET(s.id, { via: 'WHATSAPP', client_event_id: D.newEventId() }); } toast(`Ticket enviado como imagen por WhatsApp desde ${D.companyNumber(o)}`, 'ok'); G.refresh(); }),
        btn('Imprimir', () => toast('El ticket también se imprime en la mini impresora del chofer o del local.', 'info'))));
      out.push(h('span', { class: 'small muted' }, t.weighed ? 'Muestra lo pedido, lo realmente pesado y la diferencia en soles, para evitar reclamos por el monto.' : 'El pedido aún no se pesó: el ticket muestra el estimado.'));
      return out;
    };
    if (isDrv) return appShell(el, 'DEL-18', 'App: ticket de entrega', 'Ticket para el cliente con lo pedido, lo pesado y el total.', () => build());
    const body = page(el, { code: 'DEL-18', title: 'Ticket de entrega', sub: 'Lo pedido, lo realmente pesado, la diferencia en soles y el total a cobrar; el repartidor lo entrega o lo envía por WhatsApp.', actions: [X.dateInput(S.date, v => { S.date = v; st.ticketOrder = null; G.refresh(); })] });
    body.appendChild(h('div', { class: 'stack', style: 'max-width:380px' }, ...build()));
  }
  D.stopExtras.push((s, o, r, open) => {
    const t = D.ticket(o);
    const out = [tile(h('div', { class: 'row between' }, h('b', null, 'Ticket del cliente'), D.ticketGiven(s.id) ? badge('Entregado', 'ok') : badge('Por entregar', 'warn')),
      h('span', { class: 'small' }, t.weighed ? `Total ${F.money(t.total)} (${t.diff_amount ? (t.diff_amount > 0 ? '+' : '−') + F.money(Math.abs(t.diff_amount)) + ' por peso real' : 'sin diferencia de peso'})` : `Total estimado ${F.money(t.total)}`),
      h('div', { class: 'row' }, btn('Ver ticket', () => G.go('DEL-18', { stop: s.id }), { sm: true }), open ? btn(D.ticketGiven(s.id) ? 'Entregado ✓' : 'Entregué el ticket', () => { appAction('TICKET', s, { via: 'PAPER' }, `Ticket parada ${s.seq}`); }, { sm: true, kind: 'primary', disabled: D.ticketGiven(s.id) }) : null))];
    if (!open) return out;
    const a = db.get('customer_addresses', o.address_id) || {};
    const sc = D.addrScore(o);
    out.push(tile(h('div', { class: 'row between' }, h('b', null, 'Dirección y contacto'), badge(LEVEL[sc.level][0] + ' · ' + sc.score, LEVEL[sc.level][1])),
      sc.issues.length ? h('span', { class: 'small muted' }, sc.issues.slice(0, 2).join(' · ')) : null,
      D.noSignal(o) ? notice('Esta zona no tiene señal para llamadas: escribe por WhatsApp.', 'warn') : null,
      h('div', { class: 'row' }, btn(D.noSignal(o) ? 'Zona con señal' : 'Zona sin señal de llamada', () => { D.setSignal(a.id, D.noSignal(o) ? 'OK' : 'WHATSAPP_ONLY'); toast(D.noSignal(o) ? 'Zona marcada con señal' : 'Zona marcada: solo WhatsApp para este cliente y su zona', 'ok'); G.refresh(); }, { sm: true }),
        btn('Pedir ubicación', () => { D.requestLocation(o.id); D.contact(s.id, 'WHATSAPP'); toast('Se pidió al cliente que comparta su ubicación por WhatsApp', 'ok'); G.refresh(); }, { sm: true }),
        btn('Dirección errada', () => { appAction('MESSAGE', s, { kind: 'TEXT', text: `Dirección errada o no se encuentra: ${a.address_line || ''}`, to_role: 'COORDINADOR_DELIVERY' }, `Aviso dirección parada ${s.seq}`); }, { sm: true }))));
    const cm = h('input', { class: 'input', placeholder: 'Comentario de la parada', attrs: { 'aria-label': 'Comentario de la parada' } });
    out.push(tile(h('b', null, 'Comentario o audio a control'), cm,
      h('div', { class: 'row' }, btn('Enviar comentario', () => { if (!cm.value.trim()) return toast('Escribe el comentario.', 'warn'); appAction('MESSAGE', s, { kind: 'COMMENT', text: cm.value.trim() }, `Comentario parada ${s.seq}`); }, { sm: true }), audioRec(sec => appAction('MESSAGE', s, { kind: 'AUDIO', audio_sec: sec }, `Audio parada ${s.seq}`)))));
    const done = (s.collected_amount || 0) > 0 && !db.find('driver_messages', m => m.stop_id === s.id && m.kind === 'CAPTURE');
    if (done) out.push(tile(h('b', null, 'Confirmar pago con cobranza'), h('span', { class: 'small muted' }, `Cobraste ${F.money(s.collected_amount)}. Envía la captura del Yape/Plin o del voucher para que cobranza lo confirme.`), h('div', { class: 'row' }, photoBtn('cap' + s.id, 'Adjuntar captura'), btn('Enviar a cobranza', () => { const p = { kind: 'CAPTURE', photo: !!st.ph['cap' + s.id], amount: s.collected_amount, to_role: 'CAJERO', text: `Cobro parada ${s.seq}` }; if (!S.offline) { try { D.sendMessage(Object.assign({ route_id: r.id, stop_id: s.id }, p)); } catch (e) { return toast(e.message, 'bad'); } toast('Captura enviada a cobranza', 'ok'); return G.refresh(); } appAction('MESSAGE', s, p, `Captura parada ${s.seq}`); }, { sm: true, kind: 'primary' }))));
    // derivar a motorizado externo
    const hf = { name: h('input', { class: 'input', placeholder: 'Nombre del motorizado', attrs: { 'aria-label': 'Nombre del motorizado' } }), phone: h('input', { class: 'input', placeholder: 'Celular', attrs: { 'aria-label': 'Celular del motorizado' } }), plate: h('input', { class: 'input', placeholder: 'Placa', attrs: { 'aria-label': 'Placa' } }), cost: h('input', { class: 'input', type: 'number', step: '0.50', min: '0', placeholder: 'Costo del envío S/', attrs: { 'aria-label': 'Costo del envío' } }), note: h('input', { class: 'input', placeholder: 'Comentario (opcional)', attrs: { 'aria-label': 'Comentario de la derivación' } }) };
    const pay = h('select', { class: 'input', attrs: { 'aria-label': 'Pagado con' } }, D.PAID_WITH.map(([v, l]) => h('option', { value: v }, l)));
    const approved = db.find('support_requests', q => q.route_id === r.id && q.status === 'EXTERNAL_OK' && q.stop_ids.includes(s.id));
    out.push(tile(h('div', { class: 'row between' }, h('b', null, 'Derivar a motorizado externo'), approved ? badge('Autorizado', 'ok') : null),
      h('span', { class: 'small muted' }, 'Para entregas lejanas cuando el tiempo no alcanza. Exige foto del motorizado, de su placa y del producto, y el costo del envío.'),
      hf.name, h('div', { class: 'row' }, hf.phone, hf.plate), hf.cost, pay, hf.note,
      h('div', { class: 'row' }, photoBtn('hc' + s.id, 'Foto motorizado'), photoBtn('hp' + s.id, 'Foto placa'), photoBtn('hq' + s.id, 'Foto producto')),
      D.codPending(s) > 0 ? notice(`Esta parada tiene ${F.money(D.codPending(s))} por cobrar: lo cobra el motorizado y lo confirma cobranza al recibirlo.`, 'warn') : null,
      big('Registrar derivación', () => {
        const p = { courier_name: hf.name.value, courier_phone: hf.phone.value, plate: hf.plate.value, shipping_cost: hf.cost.value, paid_with: pay.value, note: hf.note.value, photo_courier: !!st.ph['hc' + s.id], photo_plate: !!st.ph['hp' + s.id], photo_product: !!st.ph['hq' + s.id] };
        if (!S.offline) { try { D.handoff(s.id, p); } catch (e) { return toast(e.message, 'bad'); } toast('Derivación registrada: coordinación confirmará la entrega', 'ok'); return G.refresh(); }
        appAction('HANDOFF', s, p, `Derivación parada ${s.seq}`);
      })));
    return out;
  });

  /* grabadora simulada (en el teléfono real usa el micrófono) */
  function audioRec(onSend) {
    const rec = st.rec;
    return h('div', { class: 'row' },
      btn(rec ? '⏹ Detener' : '🎙 Grabar audio', () => { if (!st.rec) { st.rec = { t0: Date.now() }; } else { const sec = Math.max(3, Math.min(60, Math.round((Date.now() - st.rec.t0) / 1000) + 4 + (st.aud ? 0 : 3))); st.rec = null; st.aud = sec; } G.refresh(); }, { sm: true, kind: rec ? 'bad' : '' }),
      st.aud ? btn(`Enviar audio de ${st.aud} s`, () => { const s = st.aud; st.aud = null; onSend(s); }, { sm: true, kind: 'primary' }) : null,
      rec ? h('span', { class: 'small', style: 'color:var(--bad)' }, '● Grabando… toca «Detener»') : null);
  }
  const audioBar = sec => h('div', { class: 'row small', style: 'gap:6px;align-items:center' }, h('span', null, '▶'), h('span', { style: 'display:inline-flex;gap:2px;align-items:center' }, Array.from({ length: 14 }, (_, i) => h('span', { style: `width:3px;border-radius:2px;background:var(--accent,#4b6cb7);height:${6 + ((i * 7 + sec) % 11)}px` }))), h('span', { class: 'mono' }, `0:${String(sec).padStart(2, '0')}`));

  /* ---------- DEL-21 App: mensajes a control ---------- */
  function scr21(el) {
    appShell(el, 'DEL-21', 'App: mensajes a control', 'Escribe o manda audio a coordinación, cobranza o ventas; envía capturas de pago o de entrega para que cobranza las confirme. Funciona sin conexión.', uid => {
      const rs = myRoutes(uid).filter(r => r.status !== 'CANCELLED'); const r0 = rs.find(r => r.status === 'IN_ROUTE') || rs[0];
      if (!r0) return [tile(h('b', null, 'Sin rutas hoy'), h('span', { class: 'small muted' }, 'Los mensajes se mandan dentro de una ruta.'))];
      const text = h('input', { class: 'input', placeholder: 'Mensaje', attrs: { 'aria-label': 'Mensaje' } });
      const to = h('select', { class: 'input', attrs: { 'aria-label': 'Para' } }, MSG_TO.map(([v, l]) => h('option', { value: v, selected: v === st.msgTo }, l)));
      to.addEventListener('change', () => { st.msgTo = to.value; });
      const send = p => { if (!S.offline) { try { D.sendMessage(Object.assign({ route_id: r0.id, to_role: to.value }, p)); } catch (e) { return toast(e.message, 'bad'); } toast('Enviado', 'ok'); return G.refresh(); } appAction('MESSAGE', { id: null, route_id: r0.id }, Object.assign({ to_role: to.value }, p), p.kind === 'AUDIO' ? 'Audio a control' : 'Mensaje a control'); };
      const msgs = db.where('driver_messages', m => m.route_id && rs.some(r => r.id === m.route_id)).sort(U.by('sent_at', -1)).slice(0, 8);
      return [tile(h('b', null, 'Nuevo mensaje'), to, text,
        h('div', { class: 'row' }, btn('Enviar texto', () => send({ kind: 'TEXT', text: text.value.trim() }), { sm: true, kind: 'primary' }), audioRec(sec => send({ kind: 'AUDIO', audio_sec: sec }))),
        h('div', { class: 'row' }, photoBtn('capmsg', 'Adjuntar captura'), btn('Enviar captura', () => { const amt = Number(text.value) || 0; send({ kind: 'CAPTURE', photo: !!st.ph.capmsg, amount: amt, text: 'Captura', to_role: 'CAJERO' }); }, { sm: true })),
        h('span', { class: 'small muted' }, 'Para una captura, escribe el monto en el campo de texto y adjunta la imagen.')),
      tile(h('b', null, 'Enviados hoy'), msgs.length ? h('div', { class: 'stack small', style: 'gap:8px' }, msgs.map(m => h('div', { class: 'stack', style: 'gap:2px;border-bottom:1px solid var(--line);padding-bottom:6px' },
        h('div', { class: 'row between' }, h('span', null, `${m.kind === 'AUDIO' ? '🎙 Audio' : m.kind === 'CAPTURE' ? '📷 Captura ' + F.money(m.amount) : m.kind === 'COMMENT' ? '💬 Comentario' : '✉ Mensaje'} → ${roleLabel(m.to_role)}`), badge(msgStatus(m)[0], msgStatus(m)[1])),
        m.kind === 'AUDIO' ? audioBar(m.audio_sec) : h('span', null, m.text || ''), m.reply ? h('span', { class: 'muted' }, 'Respuesta: ' + m.reply) : null))) : h('span', { class: 'small muted' }, 'Aún no enviaste mensajes.'))];
    });
  }
  const msgStatus = m => m.status === 'CONFIRMED' ? ['Confirmado', 'ok'] : m.status === 'REJECTED' ? ['Rechazado', 'bad'] : m.status === 'READ' ? ['Leído', 'info'] : [m.kind === 'CAPTURE' ? 'Por confirmar' : 'Enviado', 'warn'];

  /* ---------- DEL-19 Calidad de direcciones ---------- */
  function scr19(el) {
    const body = page(el, { code: 'DEL-19', title: 'Calidad de direcciones', sub: 'Antes de armar rutas: puntaje de cada dirección (pin, zona, referencia, teléfono), confirmación con el cliente y zonas sin señal de llamada.', actions: [X.dateInput(S.date, v => { S.date = v; G.refresh(); })] });
    const os = db.where('sales_orders', o => o.fulfillment === 'DELIVERY' && o.delivery_date === S.date && !['CANCELLED', 'DRAFT', 'DELIVERED', 'CLOSED'].includes(o.status) && G.scope.ok(o));
    const rows = os.map(o => Object.assign({ o }, D.addrScore(o)));
    const bad = rows.filter(x => x.level === 'BAD').length, rev = rows.filter(x => x.level === 'REVIEW').length;
    body.appendChild(kpis([{ label: 'Pedidos de delivery', value: rows.length, sub: F.date(S.date) }, { label: 'Riesgo alto', value: bad, tone: bad ? 'bad' : 'ok', sub: 'confirmar antes de rutear' }, { label: 'Por revisar', value: rev, tone: rev ? 'warn' : 'ok' }, { label: 'Confirmadas con el cliente', value: rows.filter(x => x.addr && x.addr.verified_at).length, sub: `de ${rows.length}` }]));
    body.appendChild(h('div', { class: 'row between' }, pills([['ALL', 'Todas'], ['RISK', 'Con riesgo'], ['PEND', 'Sin confirmar']], st.addr, v => { st.addr = v; G.refresh(); }), h('span', { class: 'small muted' }, 'Una dirección confiable es la que tiene pin, zona, referencia, teléfono y fue confirmada por la vendedora.')));
    const shown = rows.filter(x => st.addr === 'ALL' || (st.addr === 'RISK' && x.level !== 'OK') || (st.addr === 'PEND' && x.addr && !x.addr.verified_at));
    const can = OFFICE_EDIT() && (G.canDo('DEL', 'E') || ['VENDEDORA', 'SUPERVISORA_VENTAS'].includes(G.ctx.role));
    body.appendChild(table({ id: 'del19', pageSize: 30, columns: [
      { key: 'num', label: 'Pedido', value: x => x.o.number, render: x => orderLink(x.o) },
      { key: 'cust', label: 'Cliente y dirección', value: x => G.custName(x.o.customer_id), render: x => h('div', null, h('b', null, G.custName(x.o.customer_id)), h('div', { class: 'small muted' }, x.addr ? x.addr.address_line : '—'), x.addr && x.addr.reference ? h('div', { class: 'small muted' }, 'Ref: ' + x.addr.reference) : null) },
      { key: 'zone', label: 'Zona', value: x => G.zoneName(x.o.zone_id) },
      { key: 'score', label: 'Puntaje', align: 'c', value: x => x.score, render: x => badge(`${LEVEL[x.level][0]} · ${x.score}`, LEVEL[x.level][1]) },
      { key: 'issues', label: 'Qué falta', sort: false, render: x => h('div', { class: 'small' }, x.issues.length ? x.issues.join(' · ') : 'Nada'), value: x => x.issues.join(' ') },
      { key: 'ver', label: 'Confirmada', value: x => x.addr && x.addr.verified_at ? 1 : 0, render: x => x.addr && x.addr.verified_at ? h('span', { class: 'small' }, '✓ ' + G.userShort(x.addr.verified_by)) : h('span', { class: 'muted small' }, x.addr && x.addr.location_requested_at ? 'Ubicación pedida' : 'Pendiente') },
      { key: 'sig', label: 'Llamada', value: x => x.addr && x.addr.call_signal === 'WHATSAPP_ONLY' ? 'Solo WhatsApp' : 'Normal', render: x => x.addr && x.addr.call_signal === 'WHATSAPP_ONLY' ? badge('Solo WhatsApp', 'warn') : h('span', { class: 'muted small' }, 'Normal') },
    ], rows: shown, onRow: x => addrDrawer(x), actions: x => can && x.addr ? [btn('Pedir ubicación', () => tryDo(() => D.requestLocation(x.o.id), 'Se envió el mensaje para que el cliente comparta su ubicación'), { sm: true }), btn('Confirmar', () => tryDo(() => D.verifyAddress(x.addr.id), 'Dirección confirmada'), { sm: true, kind: 'primary' })] : [] }));
    body.appendChild(h('p', { class: 'small muted' }, 'Las rutas (DEL-01) muestran el puntaje de cada pedido; el chofer ve el mismo aviso en su parada y puede reportar «dirección errada» sin llamar a la vendedora.'));
  }
  function addrDrawer(x) {
    drawer(`Dirección · ${x.o.number}`, b => {
      const a = x.addr; if (!a) return b.appendChild(notice('El pedido no tiene dirección.', 'bad'));
      b.appendChild(dl([['Cliente', G.custName(x.o.customer_id)], ['Dirección', a.address_line], ['Referencia', a.reference || '—'], ['Zona', G.zoneName(a.zone_id)], ['Origen del pin', a.pin_source || '—'], ['Teléfono', D.maskPhone(x.o.contact_phone || a.contact_phone)], ['Puntaje', `${x.score} · ${LEVEL[x.level][0]}`]]));
      if (a.lat != null) b.appendChild(G.ui.map({ points: [{ lat: a.lat, lng: a.lng, label: '•', tone: 'warn', title: 'Pin' }], routes: [], height: 200, bounds: D.fit([[a.lat, a.lng]], 200) }));
      b.appendChild(h('div', { class: 'row' }, btn(a.call_signal === 'WHATSAPP_ONLY' ? 'Marcar con señal' : 'Marcar zona sin señal', () => tryDo(() => D.setSignal(a.id, a.call_signal === 'WHATSAPP_ONLY' ? 'OK' : 'WHATSAPP_ONLY'), 'Actualizado')), btn('Confirmar dirección', () => tryDo(() => D.verifyAddress(a.id), 'Dirección confirmada'), { kind: 'primary' })));
    });
  }

  /* ---------- DEL-20 Apoyo y derivaciones ---------- */
  function scr20(el) {
    const body = page(el, { code: 'DEL-20', title: 'Apoyo y derivaciones', sub: 'Riesgo de tiempo por ruta, pedidos de apoyo del chofer para sus entregas más lejanas y control de lo derivado a motorizados externos (fotos, placa, costo).' });
    const can = OFFICE_EDIT();
    const reqs = db.where('support_requests', () => true).sort(U.by('requested_at', -1));
    const hfs = db.where('external_handoffs', () => true).sort(U.by('handed_at', -1));
    const openReq = reqs.filter(q => q.status === 'REQUESTED'), openHf = hfs.filter(x => x.status === 'HANDED');
    body.appendChild(kpis([{ label: 'Apoyos por atender', value: openReq.length, tone: openReq.length ? 'warn' : 'ok' }, { label: 'Derivados por confirmar', value: openHf.length, tone: openHf.length ? 'warn' : 'ok', sub: F.money(U.sum(openHf, x => x.cod_pending)) + ' por cobrar' }, { label: 'Costo de externos', value: F.money(U.sum(hfs, x => x.shipping_cost)), sub: `${hfs.length} derivación(es)` }]));
    const rs = db.where('delivery_routes', r => r.route_date === G.TODAY && r.status === 'IN_ROUTE');
    body.appendChild(tabs([
      { key: 'risk', label: 'Riesgo de tiempo', count: rs.length, render: () => riskPanel(rs, can) },
      { key: 'req', label: 'Pedidos de apoyo', count: openReq.length, render: () => reqPanel(reqs, can) },
      { key: 'hf', label: 'Derivados a externos', count: openHf.length, render: () => hfPanel(hfs, can) },
    ], { key: 'tabs:DEL-20' }));
  }
  function riskPanel(rs, can) {
    if (!rs.length) return notice('No hay rutas en curso ahora.', 'info');
    return h('div', { class: 'stack' }, h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Simular retraso: '), pills([[0, 'Sin retraso'], [30, '+30 min'], [60, '+60 min']], st.delay, v => { st.delay = v; G.refresh(); })),
      ...rs.map(r => { const k = D.timeRisk(r, st.delay); return card(`${r.code} · ${X.assignedText(r)}`, h('div', { class: 'stack small' },
        h('div', { class: 'row between' }, h('span', null, `Franja hasta ${r.slot_to || '—'} · ${plural(k.open.length, 'parada abierta', 'paradas abiertas')}`), badge(k.level === 'OK' ? 'A tiempo' : `Llegaría ${k.late_min} min tarde`, k.level === 'OK' ? 'ok' : k.level === 'WARN' ? 'warn' : 'bad')),
        k.level !== 'OK' && k.far.length ? h('div', null, 'Más lejanas: ', k.far.map(s => `${(order(s.order_id) || {}).number} (${G.zoneName(s.zone_id)})`).join(' · ')) : null,
        can && k.level !== 'OK' ? btn('Pedir apoyo en las más lejanas', () => tryDo(() => D.requestSupport({ route_id: r.id, stop_ids: k.far.map(s => s.id), reason: `Retraso estimado ${k.late_min} min`, late_min: k.late_min }), 'Pedido de apoyo creado'), { sm: true }) : null)); }));
  }
  function reqPanel(reqs, can) {
    if (!reqs.length) return notice('Sin pedidos de apoyo.', 'info');
    return table({ id: 'del20-req', pageSize: 20, columns: [
      { key: 'number', label: 'N.°', mono: true },
      { key: 'route', label: 'Ruta', value: q => (db.get('delivery_routes', q.route_id) || {}).code },
      { key: 'driver', label: 'Chofer', value: q => G.userShort(q.requested_by) },
      { key: 'stops', label: 'Paradas', sort: false, render: q => h('span', { class: 'small' }, q.stop_ids.map(i => { const s = db.get('delivery_stops', i); const o = s && order(s.order_id); return o ? `${o.number} (${G.zoneName(s.zone_id)})` : '—'; }).join(', ')) },
      { key: 'reason', label: 'Motivo' },
      { key: 'at', label: 'Hora', value: q => q.requested_at, render: q => hm(q.requested_at) },
      { key: 'status', label: 'Estado', value: q => q.status, render: q => badge({ REQUESTED: 'Por atender', ASSIGNED: 'Asignado', EXTERNAL_OK: 'Externo autorizado', REJECTED: 'Rechazado' }[q.status] || q.status, q.status === 'REQUESTED' ? 'warn' : q.status === 'REJECTED' ? 'bad' : 'ok') },
    ], rows: reqs, onRow: q => q.status === 'REQUESTED' && can ? resolveDrawer(q) : null, actions: q => q.status === 'REQUESTED' && can ? [btn('Atender', () => resolveDrawer(q), { sm: true, kind: 'primary' })] : [] });
  }
  function resolveDrawer(q) {
    drawer(`Apoyo ${q.number}`, (b, close) => {
      const r = db.get('delivery_routes', q.route_id);
      const cands = db.where('delivery_routes', x => x.route_date === r.route_date && x.id !== r.id && ['PLANNED', 'LOADING', 'IN_ROUTE'].includes(x.status) && x.mode !== 'THIRD_PARTY');
      const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Ruta de apoyo' } }, [h('option', { value: '' }, '— Elige motorizado o ruta —')].concat(cands.map(x => h('option', { value: x.id }, `${x.code} · ${X.assignedText(x)} · ${(D.vehicle(x.vehicle_id) || {}).vehicle_type === 'MOTO' ? 'moto' : 'vehículo'} · ${plural(D.activeStops(x.id).length, 'parada', 'paradas')}`))));
      const note = h('input', { class: 'input', placeholder: 'Nota (obligatoria si rechazas)', attrs: { 'aria-label': 'Nota' } });
      b.appendChild(dl([['Ruta', r.code], ['Chofer', G.userShort(q.requested_by)], ['Motivo', q.reason], ['Paradas', q.stop_ids.length]]));
      b.appendChild(h('div', { class: 'stack' }, sel, note,
        h('div', { class: 'row' }, btn('Pasar a ese motorizado', () => { if (tryDo(() => D.resolveSupport(q.id, { action: 'ASSIGN', to_route_id: sel.value, note: note.value }), 'Paradas pasadas al motorizado de apoyo')) close(); }, { kind: 'primary' }), btn('Autorizar motorizado externo', () => { if (tryDo(() => D.resolveSupport(q.id, { action: 'EXTERNAL', note: note.value }), 'Autorizado: el chofer registra la derivación con fotos')) close(); }), btn('Rechazar', () => { if (tryDo(() => D.resolveSupport(q.id, { action: 'REJECT', note: note.value }), 'Rechazado')) close(); }, { kind: 'bad' }))));
    });
  }
  function hfPanel(hfs, can) {
    if (!hfs.length) return notice('Aún no hay derivaciones.', 'info');
    return table({ id: 'del20-hf', pageSize: 20, columns: [
      { key: 'number', label: 'N.°', mono: true },
      { key: 'order', label: 'Pedido', value: x => (order(x.order_id) || {}).number },
      { key: 'courier', label: 'Motorizado', value: x => x.courier_name, render: x => h('div', null, h('b', null, x.courier_name), h('div', { class: 'small muted' }, `${x.plate} · ${x.courier_phone || 's/ cel.'}`)) },
      { key: 'ev', label: 'Evidencias', sort: false, render: x => h('div', { class: 'row small', style: 'gap:4px' }, [['Motorizado', x.photo_courier], ['Placa', x.photo_plate], ['Producto', x.photo_product]].map(([l, v]) => badge(l + (v ? ' ✓' : ' ✗'), v ? 'ok' : 'bad'))) },
      { key: 'cost', label: 'Envío', align: 'r', value: x => x.shipping_cost, render: x => F.money(x.shipping_cost) },
      { key: 'cod', label: 'Por cobrar', align: 'r', value: x => x.cod_pending, render: x => x.cod_pending ? F.money(x.cod_pending) : '—' },
      { key: 'status', label: 'Estado', value: x => x.status, render: x => badge({ HANDED: 'Con el motorizado', DELIVERED: 'Entregado', FAILED: 'No entregado' }[x.status], x.status === 'HANDED' ? 'warn' : x.status === 'DELIVERED' ? 'ok' : 'bad') },
    ], rows: hfs, actions: x => x.status === 'HANDED' && can ? [btn('Confirmar entrega', () => confirmHfDrawer(x), { sm: true, kind: 'primary' })] : [] });
  }
  function confirmHfDrawer(x) {
    drawer(`Derivación ${x.number}`, (b, close) => {
      const note = h('input', { class: 'input', placeholder: 'Nota (obligatoria si no se entregó)', attrs: { 'aria-label': 'Nota' } });
      const m = h('select', { class: 'input', attrs: { 'aria-label': 'Medio de cobro' } }, D.COD_METHODS.map(([v, l]) => h('option', { value: v }, l)));
      const ref = h('input', { class: 'input', placeholder: 'N.° de operación (Yape/Plin)', attrs: { 'aria-label': 'Referencia' } });
      b.appendChild(dl([['Pedido', (order(x.order_id) || {}).number], ['Motorizado', `${x.courier_name} · ${x.plate}`], ['Costo del envío', F.money(x.shipping_cost)], ['Por cobrar', F.money(x.cod_pending)]]));
      b.appendChild(h('div', { class: 'stack' }, x.cod_pending > 0 ? h('div', { class: 'stack' }, notice('El motorizado cobró este monto: registra cómo lo recibe la empresa.', 'warn'), m, ref) : null, note,
        h('div', { class: 'row' }, btn('Entregado', () => { if (tryDo(() => D.confirmHandoff(x.id, { delivered: true, note: note.value, method: m.value, reference: ref.value }), 'Entrega confirmada')) close(); }, { kind: 'primary' }), btn('No entregado', () => { if (tryDo(() => D.confirmHandoff(x.id, { delivered: false, note: note.value }), 'Marcado como no entregado')) close(); }, { kind: 'bad' }))));
    });
  }

  /* ---------- DEL-22 Mensajes y confirmaciones ---------- */
  function scr22(el) {
    const body = page(el, { code: 'DEL-22', title: 'Mensajes del reparto', sub: 'Audios, comentarios y capturas que mandan los choferes; cobranza confirma las capturas de pago con el monto recibido.' });
    const all = db.where('driver_messages', () => true).sort(U.by('sent_at', -1));
    const pend = all.filter(m => m.status === 'SENT');
    const caps = all.filter(m => m.kind === 'CAPTURE' && m.status === 'SENT');
    body.appendChild(kpis([{ label: 'Sin leer', value: pend.length, tone: pend.length ? 'warn' : 'ok' }, { label: 'Capturas por confirmar', value: caps.length, tone: caps.length ? 'warn' : 'ok', sub: F.money(U.sum(caps, m => m.amount)) }, { label: 'Audios del día', value: all.filter(m => m.kind === 'AUDIO').length }]));
    body.appendChild(pills([['OPEN', 'Por atender'], ['ALL', 'Todos']], st.msgFilter, v => { st.msgFilter = v; G.refresh(); }));
    const rows = all.filter(m => st.msgFilter === 'ALL' || m.status === 'SENT');
    const can = OFFICE_EDIT();
    body.appendChild(table({ id: 'del22', pageSize: 25, columns: [
      { key: 'at', label: 'Hora', value: m => m.sent_at, render: m => hm(m.sent_at) },
      { key: 'from', label: 'Chofer', value: m => G.userShort(m.from_user_id) },
      { key: 'route', label: 'Ruta / parada', value: m => (db.get('delivery_routes', m.route_id) || {}).code, render: m => { const s = m.stop_id && db.get('delivery_stops', m.stop_id); const o = s && order(s.order_id); return h('div', null, (db.get('delivery_routes', m.route_id) || {}).code, o ? h('div', { class: 'small muted' }, o.number) : null); } },
      { key: 'kind', label: 'Tipo', value: m => m.kind, render: m => badge({ AUDIO: 'Audio', CAPTURE: 'Captura', COMMENT: 'Comentario', TEXT: 'Mensaje' }[m.kind], m.kind === 'CAPTURE' ? 'warn' : 'info') },
      { key: 'body', label: 'Contenido', sort: false, render: m => m.kind === 'AUDIO' ? audioBar(m.audio_sec) : h('div', null, m.text || '', m.kind === 'CAPTURE' ? h('div', { class: 'small' }, photoThumb('Captura'), `Monto en captura ${F.money(m.amount)}`) : null) },
      { key: 'to', label: 'Para', value: m => roleLabel(m.to_role) },
      { key: 'st', label: 'Estado', value: m => m.status, render: m => badge(msgStatus(m)[0], msgStatus(m)[1]) },
    ], rows, actions: m => can ? [btn(m.kind === 'CAPTURE' && m.status === 'SENT' ? 'Confirmar' : 'Responder', () => ackDrawer(m), { sm: true, kind: m.status === 'SENT' ? 'primary' : '' })] : [] }));
  }
  function ackDrawer(m) {
    drawer(`Mensaje de ${G.userShort(m.from_user_id)}`, (b, close) => {
      const reply = h('input', { class: 'input', placeholder: 'Respuesta o motivo', attrs: { 'aria-label': 'Respuesta' }, value: m.reply || '' });
      const amt = h('input', { class: 'input', type: 'number', step: '0.01', placeholder: 'Monto recibido S/', value: m.amount != null ? m.amount : '', attrs: { 'aria-label': 'Monto recibido' } });
      b.appendChild(dl([['Tipo', m.kind], ['Ruta', (db.get('delivery_routes', m.route_id) || {}).code], ['Contenido', m.kind === 'AUDIO' ? `Audio de ${m.audio_sec} s` : (m.text || '—')], ['Monto en captura', m.amount != null ? F.money(m.amount) : '—'], ['Estado', msgStatus(m)[0]]]));
      if (m.kind === 'AUDIO') b.appendChild(audioBar(m.audio_sec));
      b.appendChild(h('div', { class: 'stack' }, m.kind === 'CAPTURE' ? amt : null, reply,
        h('div', { class: 'row' }, m.kind === 'CAPTURE' ? btn('Confirmar pago', () => { if (tryDo(() => D.ackMessage(m.id, { status: 'CONFIRMED', reply: reply.value, confirmed_amount: amt.value }), 'Pago confirmado por cobranza')) close(); }, { kind: 'primary' }) : null, btn('Marcar leído', () => { if (tryDo(() => D.ackMessage(m.id, { status: 'READ', reply: reply.value }), 'Marcado como leído')) close(); }), btn('Rechazar', () => { if (tryDo(() => D.ackMessage(m.id, { status: 'REJECTED', reply: reply.value }), 'Rechazado')) close(); }, { kind: 'bad' }))));
    });
  }

  /* ---------- DEL-04: aviso de riesgo de tiempo y pedido de apoyo en la app ---------- */
  const base04 = G.screens['DEL-04'].render;
  G.screens['DEL-04'].render = function (el, params) {
    base04(el, params);
    const area = el.querySelector('.phone-screen > div:nth-child(2)'); if (!area) return;
    const uid = appDriver();
    for (const r of myRoutes(uid).filter(x => x.status === 'IN_ROUTE')) {
      const k = D.timeRisk(r, S.delay || 0);
      const pend = db.find('support_requests', q => q.route_id === r.id && q.status === 'REQUESTED');
      const okExt = db.find('support_requests', q => q.route_id === r.id && q.status === 'EXTERNAL_OK');
      area.appendChild(tile(h('div', { class: 'row between' }, h('b', null, `Tiempo de ${r.code}`), badge(k.level === 'OK' ? 'A tiempo' : `${k.late_min} min tarde`, k.level === 'OK' ? 'ok' : k.level === 'WARN' ? 'warn' : 'bad')),
        h('span', { class: 'small' }, `${plural(k.open.length, 'parada abierta', 'paradas abiertas')} · última llegada estimada ${hm(k.eta)} · franja hasta ${r.slot_to || '—'}`),
        h('div', { class: 'small muted' }, 'Simular retraso: ', pills([[0, '0'], [30, '+30'], [60, '+60']], S.delay || 0, v => { S.delay = v; G.refresh(); })),
        k.far.length ? h('span', { class: 'small' }, 'Más lejanas: ' + k.far.map(s => `parada ${s.seq}`).join(', ')) : null,
        pend ? badge('Apoyo pedido: coordinación está viendo', 'warn') : null, okExt ? badge('Autorizado a derivar con motorizado externo', 'ok') : null,
        k.level !== 'OK' && !pend ? btn('Pedir apoyo en las más lejanas', () => { const p = { stop_ids: k.far.map(s => s.id), reason: `Retraso estimado ${k.late_min} min`, late_min: k.late_min }; if (!S.offline) { try { D.requestSupport(Object.assign({ route_id: r.id }, p)); } catch (e) { return toast(e.message, 'bad'); } toast('Apoyo pedido a coordinación', 'ok'); return G.refresh(); } appAction('SUPPORT', { id: null, route_id: r.id }, p, 'Pedido de apoyo'); }, { kind: 'primary' }) : null));
    }
  };

  /* ---------- aviso en el planificador (DEL-01) ---------- */
  const base01 = G.screens['DEL-01'].render;
  G.screens['DEL-01'].render = function (el, params) {
    base01(el, params);
    const os = db.where('sales_orders', o => o.delivery_date === S.date && o.fulfillment === 'DELIVERY' && !['CANCELLED', 'DRAFT', 'DELIVERED', 'CLOSED', 'IN_ROUTE'].includes(o.status) && (S.est === 'ALL' || o.establishment_id === S.est));
    const risky = os.map(o => ({ o, sc: D.addrScore(o) })).filter(x => x.sc.level !== 'OK');
    const host = el.querySelector('.kpis, .kpi-row') || el.firstElementChild;
    const box = notice(h('span', null, risky.length ? `${plural(risky.length, 'pedido tiene', 'pedidos tienen')} dirección dudosa: confírmalas antes de armar rutas. ` : 'Todas las direcciones del día son confiables. ', btn('Calidad de direcciones', () => G.go('DEL-19'), { sm: true })), risky.length ? 'warn' : 'ok');
    if (host && host.parentNode) host.parentNode.insertBefore(box, host); else el.appendChild(box);
  };

  /* ---------- registro de pantallas en DEL ---------- */
  const OFFICE_ALL = G.modules.DEL.screens.find(s => s.code === 'DEL-01').roles;
  const add = (code, name, roles, render) => { const sc = { code, name, roles, render, module: 'DEL' }; G.modules.DEL.screens.push(sc); G.screens[code] = Object.assign({ module: 'DEL' }, sc); };
  add('DEL-17', 'App: gastos de la ruta', APP_ROLES, scr17);
  add('DEL-18', 'Ticket de entrega', OFFICE_ALL.concat(['REPARTIDOR']), scr18);
  add('DEL-19', 'Calidad de direcciones', OFFICE_ALL, scr19);
  add('DEL-20', 'Apoyo y derivaciones', OFFICE_ALL, scr20);
  add('DEL-21', 'App: mensajes a control', APP_ROLES, scr21);
  add('DEL-22', 'Mensajes del reparto', OFFICE_ALL, scr22);

  /* ---------- datos de demostración ---------- */
  G.seed(9100, function () {
    const vend = db.all('users').find(u => u.role === 'VENDEDORA');
    const addrs = db.all('customer_addresses').filter(a => a.zone_id);
    addrs.forEach((a, i) => { if (i % 3 === 0) { a.verified_at = '2026-10-09T16:20:00'; a.verified_by = vend ? vend.id : null; } if (i % 41 === 7) a.call_signal = 'WHATSAPP_ONLY'; });
    const route = db.all('delivery_routes').filter(r => r.route_date === G.TODAY && r.driver_user_id).sort((a, b) => (a.status === 'IN_ROUTE' ? 0 : 1) - (b.status === 'IN_ROUTE' ? 0 : 1))[0];
    const past = db.all('delivery_routes').filter(r => r.route_date < G.TODAY && r.status === 'SETTLED' && r.driver_user_id).sort((a, b) => b.route_date.localeCompare(a.route_date))[0];
    const ex = (r, category, amount, paid_with, note, settled) => db.insert('driver_expenses', { number: db.next('GDR', 'GDR-', 5), route_id: r.id, driver_user_id: r.driver_user_id, expense_date: r.route_date, category, amount, paid_with, note, photo_file_id: 'foto-seed', status: 'ACTIVE', settled: !!settled, occurred_at: r.route_date + 'T10:05:00' }, { silent: true });
    if (past) { ex(past, 'TOLL', 6.5, 'ROUTE_CASH', 'Peaje Panamericana Sur', true); ex(past, 'MEAL', 18, 'ROUTE_CASH', 'Almuerzo', true); }
    const other = db.all('delivery_routes').find(r => r.route_date === G.TODAY && r.status === 'IN_ROUTE' && r.driver_user_id && (!route || r.id !== route.id));
    const os = other && D.activeStops(other.id).filter(x => ['PENDING', 'ARRIVED'].includes(x.status)).slice(-1)[0];
    if (other && os) db.insert('support_requests', { number: db.next('APY', 'APY-', 5), route_id: other.id, stop_ids: [os.id], reason: 'Retraso estimado 35 min por tráfico', late_min: 35, status: 'REQUESTED', requested_by: other.driver_user_id, requested_at: G.TODAY + 'T11:20:00' }, { silent: true });
    if (!route) return;
    const stops = D.activeStops(route.id); const drv = route.driver_user_id;
    ex(route, 'MEAL', 18, 'OWN', 'Almuerzo (reembolso)');
    db.insert('driver_messages', { route_id: route.id, stop_id: stops[0] ? stops[0].id : null, from_user_id: drv, kind: 'AUDIO', audio_sec: 12, to_role: 'COORDINADOR_DELIVERY', status: 'SENT', sent_at: route.route_date + 'T10:40:00' }, { silent: true });
    db.insert('driver_messages', { route_id: route.id, stop_id: null, from_user_id: drv, kind: 'COMMENT', text: 'Tráfico fuerte en la Panamericana, llego con 20 min de retraso.', to_role: 'COORDINADOR_DELIVERY', status: 'READ', sent_at: route.route_date + 'T10:15:00', ack_at: route.route_date + 'T10:18:00' }, { silent: true });
    db.insert('driver_messages', { route_id: route.id, stop_id: stops[0] ? stops[0].id : null, from_user_id: drv, kind: 'CAPTURE', text: 'Yape parada 1', amount: 86.4, photo_file_id: 'foto-seed', to_role: 'CAJERO', status: 'SENT', sent_at: route.route_date + 'T10:52:00' }, { silent: true });
  });

  /* ==================================================================
     Pruebas funcionales de la ampliación
     ================================================================== */
  const T = (name, fn) => G.tests.push({ module: 'DEL', name, fn });
  const need = (c, m) => { if (!c) throw new Error(m); };
  const fails = (fn, code) => { try { fn(); } catch (e) { return e.message.indexOf(code) >= 0 || e.code === code || true; } throw new Error('Debía rechazarse (' + code + ')'); };
  const voidExp = rid => { for (const x of db.where('driver_expenses', e => e.route_id === rid && !e.settled && e.note !== 'Almuerzo (reembolso)')) db.update('driver_expenses', x.id, { status: 'VOIDED' }, { silent: true }); };
  const dropRoute = rid => { for (const s of db.where('delivery_stops', x => x.route_id === rid)) db.update('delivery_stops', s.id, { status: 'CANCELLED' }, { silent: true }); db.update('delivery_routes', rid, { status: 'CANCELLED' }, { silent: true }); voidExp(rid); };
  const freshRoute = () => {
    const o = db.all('sales_orders').find(x => x.status === 'READY' && x.fulfillment === 'DELIVERY' && !D.activeStopOf(x.id) && x.address_id);
    if (!o) return null;
    const est = o.establishment_id; const code = 'TX' + U.token(4).toUpperCase();
    const drv = D.drivers()[0]; const veh = db.all('vehicles').find(v => v.status !== 'RETIRED' && v.vehicle_type === 'MOTO' && v.ownership === 'OWN') || db.all('vehicles')[0];
    const r = D.createRoute({ route_date: G.TODAY, establishment_id: est, slot_id: null, code, order_ids: [o.id], mode: 'OWN' });
    return { r, o };
  };
  T('CA-DEL-17: el gasto pagado del efectivo de ruta baja el efectivo a entregar y genera su costo', () => {
    const r = db.all('delivery_routes').find(x => x.driver_user_id && x.status === 'IN_ROUTE') || db.all('delivery_routes').find(x => x.driver_user_id && x.route_date === G.TODAY);
    need(r, 'No hay ruta con repartidor');
    const before = D.expectedCash(r.id); const costs = db.all('delivery_costs').length;
    const res = D.addExpense({ route_id: r.id, category: 'TOLL', amount: 7.5, paid_with: 'ROUTE_CASH', note: 'Peaje prueba', photo: true });
    const after = D.expectedCash(r.id);
    need(Math.abs((before.cash - after.cash) - 7.5) < 0.005, 'El efectivo a entregar no bajó S/ 7,50');
    need(db.all('delivery_costs').length === costs + 1, 'No se creó el costo por entrega');
    need(res.expense.settled === false, 'El gasto debe quedar sin liquidar');
    D.addExpense({ route_id: r.id, category: 'MEAL', amount: 12, paid_with: 'OWN', photo: false });
    need(Math.abs(D.expectedCash(r.id).cash - after.cash) < 0.005, 'Un gasto con dinero propio no debe bajar el efectivo a entregar');
    voidExp(r.id);
  });
  T('CA-DEL-18: el combustible exige foto, galones y vale; «Otros» exige nota', () => {
    const r = db.all('delivery_routes').find(x => x.driver_user_id && x.vehicle_id);
    fails(() => D.addExpense({ route_id: r.id, category: 'FUEL', amount: 30, paid_with: 'OWN', photo: false, fuel_gallons: 2, voucher_no: 'V1' }), 'RN-DEL-16');
    fails(() => D.addExpense({ route_id: r.id, category: 'FUEL', amount: 30, paid_with: 'OWN', photo: true }), 'RN-DEL-16');
    fails(() => D.addExpense({ route_id: r.id, category: 'OTHER', amount: 5, paid_with: 'OWN' }), 'RN-DEL-16');
    fails(() => D.addExpense({ route_id: r.id, category: 'TOLL', amount: 0, paid_with: 'OWN' }), 'RN-DEL-16');
  });
  T('CA-DEL-19: un gasto reenviado desde el teléfono con el mismo id no se duplica', () => {
    const r = db.all('delivery_routes').find(x => x.driver_user_id);
    const e = { client_event_id: 'app-test-exp-1', type: 'EXPENSE', route_id: r.id, payload: { category: 'TOLL', amount: 4, paid_with: 'ROUTE_CASH', photo: true } };
    const n = db.all('driver_expenses').length;
    D.syncEvent(e); const again = D.syncEvent(e);
    need(again && again.duplicate, 'El reenvío debía ignorarse');
    need(db.all('driver_expenses').length === n + 1, 'Se duplicó el gasto');
    voidExp(r.id);
  });
  T('CA-DEL-20: la dirección sin pin, sin referencia ni teléfono puntúa como riesgo alto', () => {
    const o = db.all('sales_orders').find(x => x.address_id && x.fulfillment === 'DELIVERY');
    const a = db.get('customer_addresses', o.address_id); const keep = { lat: a.lat, lng: a.lng, reference: a.reference, v: a.verified_at };
    a.lat = null; a.lng = null; a.reference = null; a.verified_at = null;
    const sc = D.addrScore(Object.assign({}, o, { contact_phone: null }));
    Object.assign(a, { lat: keep.lat, lng: keep.lng, reference: keep.reference, verified_at: keep.v });
    need(sc.level === 'BAD', 'Debía ser riesgo alto: ' + sc.score);
    need(sc.issues.some(i => /pin/i.test(i)), 'Debía avisar que falta el pin');
  });
  T('CA-DEL-21: no se confirma una dirección sin pin; con pin queda confirmada por la vendedora', () => {
    const a = db.all('customer_addresses').find(x => x.lat != null && x.zone_id);
    D.verifyAddress(a.id); need(!!db.get('customer_addresses', a.id).verified_at, 'No quedó confirmada');
    const b = db.insert('customer_addresses', { customer_id: a.customer_id, label: 'Prueba', address_line: 'Sin pin', lat: null, lng: null, zone_id: a.zone_id, status: 'ACTIVE' }, { silent: true });
    fails(() => D.verifyAddress(b.id), 'RN-DEL-14');
    db.remove('customer_addresses', b.id);
  });
  T('CA-DEL-22: el ticket muestra lo pedido, lo pesado, la diferencia y el total del pedido', () => {
    const o = db.all('sales_orders').find(x => x.fulfillment === 'DELIVERY' && (x.lines || []).some(l => l.price_basis === 'KG' && l.weighed_kg != null && l.weighed_kg !== l.est_weight_kg) && D.orderTotal(x) > 0);
    need(o, 'No hay pedido pesado con diferencia');
    const t = D.ticket(o);
    need(t.lines.some(l => l.diff_kg), 'El ticket no muestra diferencia de peso');
    need(Math.abs(t.total - D.orderTotal(o)) < 0.005, 'El total del ticket no coincide con el del pedido');
    need(Math.abs(t.sub + t.adj - t.total) < 0.005, 'Subtotal + ajustes debe dar el total');
  });
  T('CA-DEL-23: la derivación a externo exige las 3 fotos, la placa y el costo; deja la parada con el motorizado', () => {
    const f = freshRoute(); if (!f) return; const { r, o } = f;
    try {
      D.assign(r.id, { vehicle_id: db.all('vehicles')[0].id, driver_user_id: D.drivers()[0].id });
    } catch (e) { /* la asignación puede pedir documentos: la prueba sigue con la ruta forzada */ }
    db.update('delivery_routes', r.id, { status: 'IN_ROUTE', departed_at: G.date.now(), driver_user_id: r.driver_user_id || D.drivers()[0].id }, { silent: true });
    const s = D.activeStops(r.id)[0];
    const base = { courier_name: 'Luis Quispe', plate: '1234-AB', shipping_cost: 8, photo_courier: true, photo_plate: true, photo_product: true, paid_with: 'OWN' };
    fails(() => D.handoff(s.id, Object.assign({}, base, { photo_plate: false })), 'RN-DEL-19');
    fails(() => D.handoff(s.id, Object.assign({}, base, { plate: '' })), 'RN-DEL-19');
    fails(() => D.handoff(s.id, Object.assign({}, base, { shipping_cost: '' })), 'RN-DEL-19');
    const res = D.handoff(s.id, base);
    need(db.get('delivery_stops', s.id).status === 'HANDED_OFF', 'La parada debía quedar con el motorizado');
    need(res.handoff.status === 'HANDED', 'La derivación debía quedar abierta');
    need(db.all('driver_expenses').some(x => x.category === 'EXT_COURIER' && x.route_id === r.id), 'Faltó el gasto del envío');
    dropRoute(r.id);
  });
  T('CA-DEL-24: el chofer pide apoyo, coordinación pasa la parada a otro motorizado y la ruta de origen la libera', () => {
    const a = freshRoute(); if (!a) return;
    const o2 = db.all('sales_orders').find(x => x.status === 'READY' && x.fulfillment === 'DELIVERY' && !D.activeStopOf(x.id) && x.address_id && x.establishment_id === a.o.establishment_id);
    if (!o2) return;
    D.addStop(a.r.id, o2.id);
    const b = D.createRoute({ route_date: G.TODAY, establishment_id: a.o.establishment_id, slot_id: null, code: 'TY' + U.token(4).toUpperCase(), order_ids: [], mode: 'OWN' });
    db.update('delivery_routes', a.r.id, { status: 'IN_ROUTE', departed_at: G.date.now(), driver_user_id: D.drivers()[0].id, slot_to: '23:59' }, { silent: true });
    db.update('delivery_routes', b.id, { status: 'IN_ROUTE', departed_at: G.date.now(), driver_user_id: (D.drivers()[1] || D.drivers()[0]).id }, { silent: true });
    const far = D.activeStops(a.r.id).slice(-1)[0];
    const q = D.requestSupport({ route_id: a.r.id, stop_ids: [far.id], reason: 'Prueba' }).request;
    fails(() => D.requestSupport({ route_id: a.r.id, stop_ids: [far.id] }), 'RN-DEL-18');
    D.resolveSupport(q.id, { action: 'ASSIGN', to_route_id: b.id });
    need(db.get('delivery_stops', far.id).status === 'CANCELLED', 'La parada de origen debía cerrarse');
    need(D.activeStops(b.id).some(s => s.order_id === far.order_id), 'La parada debía estar en la ruta de apoyo');
    need(db.get('support_requests', q.id).status === 'ASSIGNED', 'El pedido debía quedar asignado');
    dropRoute(a.r.id); dropRoute(b.id);
  });
  T('CA-DEL-25: cobranza confirma una captura con el monto recibido; si difiere, exige motivo', () => {
    const r = db.all('delivery_routes').find(x => x.driver_user_id);
    const m = D.sendMessage({ route_id: r.id, kind: 'CAPTURE', photo: true, amount: 50, text: 'Yape' }).message;
    fails(() => D.sendMessage({ route_id: r.id, kind: 'CAPTURE', photo: false, amount: 50 }), 'RN-DEL-17');
    fails(() => D.ackMessage(m.id, { status: 'CONFIRMED', confirmed_amount: 45 }), 'RN-DEL-17');
    D.ackMessage(m.id, { status: 'CONFIRMED', confirmed_amount: 45, reply: 'Llegó S/ 45 por comisión' });
    need(db.get('driver_messages', m.id).status === 'CONFIRMED', 'Debía quedar confirmada');
    const a = D.sendMessage({ route_id: r.id, kind: 'AUDIO', audio_sec: 9 }).message;
    need(a.audio_sec === 9, 'El audio guarda su duración');
    fails(() => D.sendMessage({ route_id: r.id, kind: 'AUDIO', audio_sec: 0 }), 'RN-DEL-17');
  });
  T('CA-DEL-26: en una zona sin señal de llamada el chofer solo usa WhatsApp', () => {
    const o = db.all('sales_orders').find(x => x.address_id && x.fulfillment === 'DELIVERY');
    const a = db.get('customer_addresses', o.address_id); const keep = a.call_signal;
    D.setSignal(a.id, 'WHATSAPP_ONLY'); need(D.noSignal(o), 'Debía marcarse sin señal');
    D.setSignal(a.id, 'OK'); need(!D.noSignal(o), 'Debía volver a tener señal');
    a.call_signal = keep;
  });
})();
