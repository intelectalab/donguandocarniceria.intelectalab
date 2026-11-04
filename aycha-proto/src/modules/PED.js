/* =====================================================================
   PED · Pedidos de todos los canales (PED-01 … PED-14)
   «Que ningún pedido se pierda ni se confunda»: el pedido nace en
   borrador desde cualquier canal y no se confirma sin sus datos
   obligatorios (RN-PED-01). Amplía G.orders con franjas con cupo y hora
   de corte, descuentos con límite por rol y aprobación, reprogramación,
   cancelación y no entrega con motivo, provincia con agencia, aviso de
   diferencia de peso, saldo del pedido y resumen para WhatsApp.
   Expone G.ped (CRM, WEB, B2B, CON y POS lo usan: G.ped.confirm(id)…).
   ===================================================================== */
(function () {
  const { h, btn, badge, status, page, card, table, kpis, dl, notice, drawer, modal, toast, tabs, pills, chart, confirm, empty } = G.ui;
  const U = G.util, F = G.fmt, D = G.db;
  const R = (n, d = 2) => U.round(n, d);
  const money = v => F.money(v).replace('S/ ', 'S/\u00a0');
  const kg3 = v => v === null || v === undefined || v === '' ? '—' : F.num(v, 3) + ' kg';
  const ins = (t, r) => D.insert(t, r, { silent: true });
  const order = id => (id && typeof id === 'object') ? id : D.get('sales_orders', id);
  const ACTIVE_ST = ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED', 'NOT_DELIVERED', 'CLOSED'];
  const OPEN_ST = ['DRAFT', 'CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE', 'NOT_DELIVERED'];
  const FLOW = ['DRAFT', 'CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED', 'CLOSED'];
  const PREPAID = ['pm-YAPE', 'pm-PLIN', 'pm-TRANSFER', 'pm-MP'];
  const RESCHEDULABLE = ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'NOT_DELIVERED'];
  const MISSING_LABEL = {
    CLIENTE: 'Cliente', CELULAR: 'Celular del cliente o de contacto', RUC_VALIDO: 'Cliente de facturación con RUC válido', DOCUMENTO_CLIENTE: 'Documento del cliente (boleta sobre el monto límite)',
    DIRECCION_CON_PIN: 'Dirección con pin y referencia', LOCAL_DE_RECOJO: 'Local de recojo', AGENCIA: 'Agencia de envío a provincia', FRANJA: 'Fecha y franja de entrega',
    PRODUCTOS: 'Al menos un producto', PESO_ESTIMADO: 'Peso estimado en productos por peso', FORMA_DE_PAGO: 'Forma de pago', NOTAS_DE_PREPARACION: 'Notas de preparación (o «Sin indicaciones»)',
  };
  const DSTAT = { NONE: ['Sin descuento', ''], APPLIED: ['Dentro del límite', 'ok'], PENDING_APPROVAL: ['Por aprobar', 'warn'], APPROVED: ['Aprobado', 'ok'], REJECTED: ['Rechazado', 'bad'] };
  const WSTAT = { NONE: ['Sin pesar', ''], WITHIN_TOLERANCE: ['Dentro de tolerancia', 'ok'], NOTICE_REQUIRED: ['Aviso requerido', 'warn'], NOTICE_SENT: ['Aviso enviado', 'info'], CUSTOMER_REJECTED: ['Cliente rechazó: volver a pesar', 'bad'] };
  const BMODE = { CUSTOMER_CREDIT: 'Saldo a favor del cliente', REFUND: 'Devolución', COLLECT_ON_DELIVERY: 'Cobro contra entrega', PAYMENT_LINK: 'Enlace de pago', WAIVE: 'Condonado' };
  const dBadge = s => badge(...(DSTAT[s || 'NONE'] || [s, '']));
  const wBadge = s => badge(...(WSTAT[s || 'NONE'] || [s, '']));
  const total = o => o.final_total ?? o.estimated_total ?? 0;
  const nowHM = () => G.date.now().slice(11, 16);
  const weekdayOf = d => G.date.parse(d).getUTCDay();
  const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const dayLabel = d => `${DOW[weekdayOf(d)]} ${F.date(d).slice(0, 5)}`;
  const slotText = o => o.slot_from ? `${o.slot_from}–${o.slot_to}` : '—';
  const isRule = e => e && (e instanceof G.RuleError || /^RN-/.test(String(e.message || '')));
  function act(fn, okMsg, after) {
    try { const r = fn(); if (okMsg) toast(okMsg, 'ok'); if (after) after(r); else G.refresh(); return r; }
    catch (e) { if (!isRule(e)) console.error(e); toast(e.message, 'bad'); return null; }
  }
  const sel = (options, value, onChange, attrs = {}) => {
    const s = h('select', Object.assign({ class: 'input' }, attrs), options.map(([v, l]) => h('option', { value: v ?? '', selected: String(v ?? '') === String(value ?? '') }, l)));
    s.addEventListener('change', () => onChange(s.value)); return s;
  };
  const inp = (type, value, onInput, attrs = {}) => {
    const i = h('input', Object.assign({ class: 'input', type, value: value ?? '' }, attrs));
    i.addEventListener('input', () => onInput(type === 'number' ? (i.value === '' ? null : Number(i.value)) : i.value, i)); return i;
  };
  const fld = (label, input, help, span) => h('div', { class: 'field' + (span ? ' span2' : '') }, h('label', null, label), input, help ? h('div', { class: 'help' }, help) : null);
  const minusMin = (hm, m) => { const [a, b] = String(hm || '00:00').split(':').map(Number); const t = Math.max(0, a * 60 + b - (m || 0)); return U.pad(Math.floor(t / 60), 2) + ':' + U.pad(t % 60, 2); };

  /* =====================================================================
     Franjas con cupo y hora de corte (RN-PED-06)
     ===================================================================== */
  const slotCut = s => s.cutoff || minusMin(s.slot_from, s.cutoff_minutes ?? 120);
  const slotName = s => s ? `${s.slot_from}–${s.slot_to}${s.zone_id ? ' · ' + G.zoneName(s.zone_id).split(' (')[0] : ''}` : '—';
  function slotsFor(est, zone, date) {
    return D.where('order_time_slots', s => s.status === 'ACTIVE' && (!est || s.establishment_id === est) && (!s.zone_id || s.zone_id === zone) && (!date || !s.weekdays || s.weekdays.includes(weekdayOf(date))))
      .sort((a, b) => a.slot_from.localeCompare(b.slot_from) || String(a.zone_id || '').localeCompare(String(b.zone_id || '')));
  }
  function usageMap() { const m = new Map(); for (const o of D.all('sales_orders')) if (o.slot_id && o.delivery_date && ACTIVE_ST.includes(o.status)) { const k = o.slot_id + '|' + o.delivery_date; m.set(k, (m.get(k) || 0) + 1); } return m; }
  function slotUse(slot_id, date, exceptId) { let n = 0; for (const o of D.all('sales_orders')) if (o.slot_id === slot_id && o.delivery_date === date && ACTIVE_ST.includes(o.status) && o.id !== exceptId) n++; return n; }
  function slotCutPassed(s, date) { return date < G.TODAY || (date === G.TODAY && nowHM() > slotCut(s)); }
  /** valida cupo, zona y (estricto) hora de corte de la franja del pedido */
  function checkSlot(o, { override, strict } = {}) {
    if (!o.slot_id || !o.delivery_date || o.fulfillment === 'COUNTER') return;
    const s = D.get('order_time_slots', o.slot_id);
    if (!s) G.fail('RN-PED-06', 'La franja elegida no existe: elige otra.');
    const ov = !!override && G.can('ped.slot.override');
    if (s.zone_id && o.zone_id && s.zone_id !== o.zone_id && !ov) G.fail('RN-PED-06', `La franja ${slotName(s)} es solo para la zona ${G.zoneName(s.zone_id)}; el pin del pedido está en ${G.zoneName(o.zone_id)}.`);
    const used = slotUse(s.id, o.delivery_date, o.id);
    if (used >= s.capacity && !ov) G.fail('RN-PED-06', `La franja ${slotName(s)} del ${F.date(o.delivery_date)} está llena (${used} de ${s.capacity}). Elige otra franja o pide a la supervisora que la habilite (ped.slot.override).`);
    if (strict && slotCutPassed(s, o.delivery_date) && !ov) G.fail('RN-PED-06', `La franja ${slotName(s)} del ${F.date(o.delivery_date)} cerró a las ${slotCut(s)} (hora de corte). Elige otra franja o fecha, o pide a la supervisora que la habilite (ped.slot.override).`);
    return { used, capacity: s.capacity };
  }

  /* =====================================================================
     Descuentos con límite por rol y marca (RN-PED-11, D-PED-04)
     ===================================================================== */
  function discountLimit(role = G.ctx.role, brand) {
    if (role === 'GERENTE') return null;
    const rows = D.where('discount_limits', l => l.role === role && l.status !== 'INACTIVE');
    const r = rows.find(l => l.brand_id && l.brand_id === brand) || rows.find(l => !l.brand_id);
    return r ? { max_pct: r.max_pct, max_amount: r.max_amount, id: r.id } : { max_pct: 0, max_amount: 0 };
  }
  const limitText = l => l ? `${F.num(l.max_pct, 0)} % o ${money(l.max_amount)}` : 'sin límite';
  const overLimit = (l, pct, amount) => !!l && (pct > l.max_pct + 1e-9 || amount > l.max_amount + 1e-9);
  function discountBase(o) { const keep = o.order_discount; o.order_discount = 0; G.orders.recalc(o); const base = R(U.sum(o.lines || [], l => l.est_amount)); o.order_discount = keep; G.orders.recalc(o); return base; }
  function setDiscount(o, pct, reason) {
    o = order(o);
    if (o.status && o.status !== 'DRAFT') G.fail('RN-PED-07', 'El descuento se cambia solo en borrador: vuelve el pedido a borrador antes de prepararlo.');
    pct = Number(pct) || 0;
    if (pct < 0 || pct > 100) G.fail('RN-PED-11', 'El descuento debe estar entre 0 y 100 %.');
    const base = discountBase(o);
    const amount = R(base * pct / 100);
    const lim = discountLimit(G.ctx.role, o.brand_id);
    const over = pct > 0 && overLimit(lim, pct, amount);
    if (over && !reason) G.fail('RN-PED-11', `El descuento de ${F.num(pct, 1)} % (${money(amount)}) supera tu límite (${limitText(lim)}): escribe el motivo para pedir aprobación.`);
    o.order_discount = amount; o.order_discount_pct = pct; o.discount_reason = reason || null;
    G.orders.recalc(o);
    if (o.id) for (const a of D.where('order_discount_approvals', a => a.order_id === o.id && a.status === 'PENDING')) Object.assign(a, { status: 'REJECTED', decided_at: G.date.now(), decision_note: 'Reemplazada por una nueva solicitud' });
    if (!pct) o.discount_status = 'NONE';
    else if (over) {
      o.discount_status = 'PENDING_APPROVAL';
      if (o.id) {
        D.insert('order_discount_approvals', { order_id: o.id, order_number: o.number, brand_id: o.brand_id, establishment_id: o.establishment_id, requested_by: G.ctx.userId(), requested_by_name: G.ctx.userName(), requested_role: G.ctx.role, requested_pct: pct, requested_amount: amount, order_base: base, reason, status: 'PENDING', requested_at: G.date.now() });
        G.notify({ role: 'SUPERVISORA_VENTAS', title: `Descuento por aprobar · ${o.number}`, body: `${G.ctx.userName()} pide ${F.num(pct, 1)} % (${money(amount)}): ${reason}`, ref: o.id, tone: 'warn', module: 'PED' });
      }
    } else o.discount_status = 'APPLIED';
    if (o.id) D.update('sales_orders', o.id, { order_discount: o.order_discount, discount_status: o.discount_status });
    return { over, amount, limit: lim };
  }
  function decideDiscount(approvalId, approve, note) {
    const a = D.get('order_discount_approvals', approvalId); if (!a) G.fail('RN-PED-11', 'Solicitud no encontrada.');
    if (a.status !== 'PENDING') G.fail('RN-PED-11', 'La solicitud ya fue resuelta.');
    if (!G.can('ped.discount.approve')) G.fail('RN-PED-11', `Tu rol (${G.roleName()}) no puede aprobar descuentos (permiso ped.discount.approve).`);
    if (a.requested_by === G.ctx.userId()) G.fail('RN-PED-11', 'Quien pide el descuento no lo aprueba: debe resolverlo otra persona.');
    const o = order(a.order_id);
    const myLim = discountLimit(G.ctx.role, a.brand_id);
    if (approve && myLim && myLim.max_pct > 0 && overLimit(myLim, a.requested_pct, a.requested_amount) && G.ctx.role !== 'SUPERVISORA_VENTAS') G.fail('RN-PED-11', `El descuento supera también tu límite (${limitText(myLim)}): lo aprueba gerencia.`);
    if (approve && G.ctx.role === 'SUPERVISORA_VENTAS' && myLim && overLimit(myLim, a.requested_pct, a.requested_amount)) G.fail('RN-PED-11', `El descuento supera también tu límite (${limitText(myLim)}): lo aprueba gerencia.`);
    Object.assign(a, { status: approve ? 'APPROVED' : 'REJECTED', decided_by: G.ctx.userId(), decided_by_name: G.ctx.userName(), decided_at: G.date.now(), decision_note: note || null });
    D.update('order_discount_approvals', a.id, { status: a.status });
    if (o) {
      if (approve) o.discount_status = 'APPROVED';
      else { o.order_discount = 0; o.order_discount_pct = 0; o.discount_status = 'REJECTED'; G.orders.recalc(o); }
      D.update('sales_orders', o.id, { discount_status: o.discount_status });
      if (o.seller_id) G.notify({ user_id: o.seller_id, title: `Descuento ${approve ? 'aprobado' : 'rechazado'} · ${o.number}`, body: note || '', ref: o.id, tone: approve ? 'ok' : 'bad', module: 'PED' });
    }
    return a;
  }

  /* =====================================================================
     Confirmación: datos obligatorios, descuento, franja, provincia, stock
     ===================================================================== */
  function saleAvail(est) {
    const whs = new Set(G.inv.saleWarehouses(est).map(w => w.id));
    const m = new Map();
    for (const b of D.all('stock_balances')) if (whs.has(b.warehouse_id) && G.inv.lotUsable(b.lot_id)) m.set(b.variant_id, (m.get(b.variant_id) || 0) + b.qty - (b.reserved_qty || 0));
    return m;
  }
  function stockShort(o) {
    const av = saleAvail(o.establishment_id); const need = new Map();
    for (const l of o.lines || []) need.set(l.variant_id, (need.get(l.variant_id) || 0) + Number(l.qty || 0));
    const out = []; for (const [v, q] of need) { const a = Math.max(0, av.get(v) || 0); if (q > a + 0.0005) out.push({ variant_id: v, qty: R(q - a, 3), available: R(a, 3) }); }
    return out;
  }
  function preChecks(o, opts = {}, strict) {
    if (o.discount_status === 'PENDING_APPROVAL') G.fail('RN-PED-11', `El descuento de ${money(o.order_discount)} está pendiente de aprobación: no se confirma hasta que lo apruebe otra persona con ped.discount.approve.`);
    if (o.fulfillment === 'PROVINCE_SHIPPING' && !PREPAID.includes(o.payment_method_id)) G.fail('RN-PED-08', `Un envío a provincia se paga por adelantado (Yape, Plin, transferencia o Mercado Pago); «${G.pmName(o.payment_method_id)}» no se acepta contra entrega.`);
    if (o.fulfillment === 'PROVINCE_SHIPPING') { const a = D.get('customer_addresses', o.address_id); if (!a || a.lat == null) G.fail('RN-PED-08', 'El envío a provincia exige la dirección de destino con pin.'); }
    checkSlot(o, { override: opts.override, strict });
  }
  function confirmOrder(o, opts = {}) {
    o = order(o); if (!o) G.fail('RN-PED-03', 'Pedido no encontrado.');
    if (o.status !== 'DRAFT') G.fail('RN-PED-03', `El pedido ${o.number} ya está ${G.ui.statusLabel(o.status).toLowerCase()}.`);
    const m = G.orders.missing(o);
    if (m.length) G.fail('RN-PED-01', `No se puede confirmar ${o.number}: faltan ${m.join(', ')}.`, { missing: m });
    preChecks(o, opts, true);
    let short = [];
    if (o.fulfillment !== 'COUNTER') {
      short = stockShort(o);
      if (short.length && !(opts.withoutStock && G.can('ped.order.confirm_without_stock'))) G.fail('RN-PED-17', `No hay stock disponible por FEFO en ${G.siteName(o.establishment_id)}: ${short.map(s => `${G.variantName(s.variant_id)} (faltan ${F.num(s.qty, 3)})`).join(', ')}. Se confirma solo con el permiso ped.order.confirm_without_stock y queda marcado para producción o compra.`);
    }
    G.orders.transition(o, 'CONFIRMED', { reason: opts.reason || null, _pedChecked: true, override: opts.override });
    if (short.length) { o.needs_production = true; G.notify({ role: 'JEFE_PRODUCCION', title: `Pedido sin stock · ${o.number}`, body: short.map(s => `${G.variantName(s.variant_id)}: ${F.num(s.qty, 3)}`).join(', '), ref: o.id, tone: 'warn', module: 'PED' }); D.touch(); }
    return o;
  }

  /* ---------- ampliación de G.orders.transition: franjas, descuentos, provincia, historial y reservas ---------- */
  const coreTransition = G.orders.transition;
  G.orders.transition = function (o, to, opts = {}) {
    if (typeof o === 'string') o = D.get('sales_orders', o);
    if (!o) G.fail('RN-PED-03', 'Pedido no encontrado.');
    const from = o.status;
    if (!G._seeding) {
      if (to === 'CONFIRMED' && from === 'DRAFT' && !opts._pedChecked && o.fulfillment !== 'COUNTER' && !G.orders.missing(o).length) preChecks(o, opts, false);
      if (to === 'READY') {
        if (o.weight_diff_status === 'CUSTOMER_REJECTED') G.fail('RN-PED-05', 'El cliente rechazó la diferencia de peso: vuelve a pesar o ajusta el pedido antes de pasar a LISTO.');
        if (o.weight_diff_status === 'NOTICE_SENT' && G.param('ped_weight_notice_wait_response') === true) { const n = D.where('order_weight_notices', x => x.order_id === o.id).sort(U.by('sent_at', -1))[0]; if (!n || n.customer_response !== 'ACCEPTED') G.fail('RN-PED-05', 'Se espera la respuesta del cliente al aviso de peso (ped_weight_notice_wait_response = sí).'); }
      }
      if (to === 'IN_ROUTE' && o.fulfillment === 'PROVINCE_SHIPPING' && (!o.dispatch_guide_number || !o.tracking_number)) G.fail('RN-PED-08', 'Un envío a provincia se despacha con guía de remisión (RN-FAC-11) y número de seguimiento de la agencia.');
    }
    const r = coreTransition(o, to, opts);
    if (!G._seeding) {
      const last = (o.history || [])[o.history.length - 1] || {};
      ins('sales_order_status_history', { order_id: o.id, order_number: o.number, from_status: from, to_status: to, reason: opts.reason || null, changed_at: last.at || G.date.now(), changed_by: G.ctx.userId(), changed_by_name: G.ctx.userName() });
      if (to === 'CONFIRMED' && from === 'DRAFT' && o.fulfillment !== 'COUNTER' && !(o.reservations || []).length) { G.inv.reserve(o); if (o.stock_short) o.needs_production = true; }
      if (to === 'DRAFT') G.inv.release(o);
    }
    return r;
  };

  /* =====================================================================
     Líneas (RN-PED-02, RN-PED-07) y pesaje (RN-PED-04, RN-PED-05)
     ===================================================================== */
  function assertEditable(o) { if (!['DRAFT', 'CONFIRMED'].includes(o.status)) G.fail('RN-PED-07', `El pedido ${o.number} está ${G.ui.statusLabel(o.status).toLowerCase()}: desde EN PREPARACIÓN las líneas no cambian de producto, cantidad, precio ni descuento; solo se registra el peso real. Para cambiarlo, cancélalo con motivo.`); }
  function rereserve(o) { if (o.status === 'CONFIRMED') { G.inv.release(o); G.inv.reserve(o); } }
  function addLine(o, data) { o = order(o); assertEditable(o); const l = G.orders.addLine(o, data); rereserve(o); D.update('sales_orders', o.id, { estimated_total: o.estimated_total }); return l; }
  function updateLine(o, lineId, patch) {
    o = order(o); assertEditable(o);
    const l = o.lines.find(x => x.id === lineId); if (!l) G.fail('RN-PED-07', 'Línea no encontrada.');
    if (patch.unit_price !== undefined && patch.unit_price !== l.unit_price) G.fail('RN-PED-10', 'El precio de la línea es el de la lista vigente y no se edita: registra la rebaja como descuento.');
    if (patch.variant_id && patch.variant_id !== l.variant_id) G.fail('RN-PED-07', 'Para cambiar el producto, quita la línea y agrega otra del catálogo.');
    const v = G.variant(l.variant_id);
    if (patch.qty !== undefined) { const q = Number(patch.qty); if (!(q > 0)) G.fail('RN-PED-07', 'La cantidad debe ser mayor que cero.'); l.qty = q; if (v.sale_mode === 'UNIT_VARIABLE_WEIGHT' && patch.est_weight_kg === undefined) l.est_weight_kg = R(q * v.nominal_weight_kg, 3); if (v.sale_mode === 'KG') l.est_weight_kg = q; }
    if (patch.est_weight_kg !== undefined) l.est_weight_kg = Number(patch.est_weight_kg) || null;
    if (patch.cut_notes !== undefined) l.cut_notes = patch.cut_notes;
    G.orders.recalc(o); rereserve(o);
    D.update('sales_orders', o.id, { estimated_total: o.estimated_total });
    return l;
  }
  function removeLine(o, lineId) { o = order(o); assertEditable(o); o.lines = o.lines.filter(l => l.id !== lineId); G.orders.recalc(o); rereserve(o); D.update('sales_orders', o.id, { estimated_total: o.estimated_total }); }
  function weigh(o, lineId, kgv, source = 'SCALE') {
    o = order(o);
    if (!['IN_PREPARATION', 'WEIGHED', 'CONFIRMED'].includes(o.status)) G.fail('RN-PED-04', `El peso real se registra en preparación (el pedido está ${G.ui.statusLabel(o.status).toLowerCase()}).`);
    if (!(Number(kgv) > 0)) G.fail('RN-PED-04', 'El peso real debe ser mayor que cero.');
    if (o.status === 'CONFIRMED') G.orders.transition(o, 'IN_PREPARATION', { reason: 'Pesaje' });
    const r = G.orders.weigh(o, lineId, kgv, source);
    if (o.status === 'IN_PREPARATION' && o.final_total != null) G.orders.transition(o, 'WEIGHED', { reason: 'Todas las líneas por kg pesadas' });
    D.update('sales_orders', o.id, { final_total: o.final_total, weight_diff_status: o.weight_diff_status }, { silent: true });
    return r;
  }
  /** diferencia de peso total del pedido en líneas por kg pesadas */
  function weightDiff(o) {
    const ls = (o.lines || []).filter(l => l.price_basis === 'KG' && l.weighed_kg != null && l.est_weight_kg);
    const e = U.sum(ls, l => l.est_weight_kg), w = U.sum(ls, l => l.weighed_kg);
    return { est: R(e, 3), real: R(w, 3), pct: e ? R((w - e) / e * 100, 1) : 0 };
  }

  /* =====================================================================
     Mensajes al cliente: resumen (RN-PED-12) y aviso de peso (RN-PED-05)
     ===================================================================== */
  function waChannel(o) { const chs = D.where('messaging_channels', c => c.kind === 'WHATSAPP'); return (chs.find(c => c.number === o.origin_wa_number) || chs.find(c => c.brand_id === o.brand_id) || chs[0] || {}).id || null; }
  const utilityCount = o => D.where('messages', m => m.ref === o.id && m.kind === 'UTILITY').length;
  function sendWa(o, text, template, inServiceWindow) {
    const kind = inServiceWindow ? 'SESSION' : 'UTILITY';
    if (kind === 'UTILITY' && utilityCount(o) >= 2 && !G.can('crm.template.send_extra')) G.fail('RN-CRM-07', `El pedido ${o.number} ya usó 2 plantillas de utilidad: una tercera exige el permiso crm.template.send_extra. Escríbele dentro de la ventana de 24 h o llámalo.`);
    return G.msg.send({ customer_id: o.customer_id, channel_id: waChannel(o), kind, template: kind === 'UTILITY' ? template : null, text, ref: o.id, inServiceWindow: !!inServiceWindow });
  }
  function summary(o) {
    o = order(o);
    const c = D.get('customers', o.customer_id) || {};
    const first = (c.trade_name || c.full_name || '').split(' ')[0];
    const lines = (o.lines || []).map(l => { const v = G.variant(l.variant_id) || {}; const w = l.price_basis === 'KG' ? (v.sale_mode === 'KG' ? ` (${F.num(l.est_weight_kg, 3)} kg)` : ` (≈ ${F.num(l.est_weight_kg, 3)} kg)`) : ''; return `• ${v.sale_mode === 'KG' ? '' : F.num(l.qty, 0) + ' × '}${v.name}${w}${l.cut_notes ? ' · corte: ' + l.cut_notes : ''} — ${money(l.est_amount)}`; });
    const byKg = (o.lines || []).some(l => l.price_basis === 'KG');
    const a = D.get('customer_addresses', o.address_id);
    const where = o.fulfillment === 'PICKUP' ? `Recojo en ${G.siteName(o.pickup_establishment_id)} · ${(D.get('establishments', o.pickup_establishment_id) || {}).address || ''}`
      : o.fulfillment === 'PROVINCE_SHIPPING' ? `Envío a provincia por ${G.supName(o.province_agency)} · ${a ? a.address_line : '—'}${a && a.reference ? ' · Ref.: ' + a.reference : ''}`
        : `Entrega: ${a ? a.address_line : '—'}${a && a.reference ? ' · Ref.: ' + a.reference : ''}`;
    const when = o.fulfillment === 'PROVINCE_SHIPPING' ? `Despacho: ${dayLabel(o.delivery_date || G.TODAY)}` : `Fecha: ${o.delivery_date ? dayLabel(o.delivery_date) : '—'} · franja ${slotText(o)}`;
    const doc = o.requested_doc_type === 'INVOICE' ? `Factura a ${G.custName(o.billing_customer_id)} (RUC ${(D.get('customers', o.billing_customer_id) || {}).doc_number || '—'})` : 'Boleta';
    return [`*${G.brandName(o.brand_id)}* · Pedido ${o.number}`, `Hola ${first || ''}, este es el resumen de tu pedido:`, ...lines,
      o.fulfillment === 'DELIVERY' || o.fulfillment === 'PROVINCE_SHIPPING' ? `${o.fulfillment === 'DELIVERY' ? 'Delivery' : 'Envío'}${o.zone_id ? ' (' + G.zoneName(o.zone_id).split(' (')[0] + ')' : ''}: ${o.delivery_fee ? money(o.delivery_fee) : 'gratis'}` : null,
      o.order_discount ? `Descuento: −${money(o.order_discount)}` : null,
      `Total estimado: ${money(o.estimated_total)}`,
      byKg ? `Los productos por peso se cobran con el peso real; si la diferencia supera el ${F.num(G.param('ped_weight_tolerance_pct') ?? 10, 0)} % te avisamos antes de enviarlo.` : null,
      where, when, `Pago: ${G.pmName(o.payment_method_id)} · Comprobante: ${doc}`, 'Responde «Confirmo» para preparar tu pedido.'].filter(Boolean).join('\n');
  }
  function sendSummary(o, { channel = 'WHATSAPP', inServiceWindow = true } = {}) {
    o = order(o);
    if (!(o.lines || []).length) G.fail('RN-PED-12', 'El resumen necesita al menos un producto.');
    const text = summary(o);
    let m = null;
    if (channel === 'WHATSAPP') m = sendWa(o, text, 'confirmacion_pedido', inServiceWindow);
    o.summary_sent_at = G.date.now(); o.summary_channel = channel;
    D.update('sales_orders', o.id, { summary_sent_at: o.summary_sent_at, summary_channel: channel });
    return m;
  }
  function customerConfirmed(o, channel = 'WHATSAPP') {
    o = order(o); o.customer_confirmed_at = G.date.now(); o.confirmation_channel = channel;
    D.update('sales_orders', o.id, { customer_confirmed_at: o.customer_confirmed_at, confirmation_channel: channel });
    return o;
  }
  function suggestedNotice(o) {
    const wd = weightDiff(o); const c = D.get('customers', o.customer_id) || {};
    const ls = (o.lines || []).filter(l => l.price_basis === 'KG' && l.weighed_kg != null).map(l => `• ${G.variantName(l.variant_id)}: pediste ≈ ${F.num(l.est_weight_kg, 3)} kg y pesó ${F.num(l.weighed_kg, 3)} kg`);
    return [`Hola ${(c.full_name || c.trade_name || '').split(' ')[0]}, tu pedido ${o.number} de ${G.brandName(o.brand_id)} ya está pesado:`, ...ls,
      `El total pasa de ${money(o.estimated_total)} (estimado) a ${money(o.final_total)} (peso real, ${wd.pct > 0 ? '+' : ''}${F.num(wd.pct, 1)} %).`,
      (o.paid_amount || 0) > 0 ? (o.paid_amount > o.final_total ? `Te queda un saldo a favor de ${money(o.paid_amount - o.final_total)} para tu próxima compra.` : `La diferencia de ${money(o.final_total - o.paid_amount)} se cobra contra entrega.`) : 'Se cobra el total final al entregar.',
      '¿Lo enviamos así? Si prefieres, ajustamos el peso.'].join('\n');
  }
  function weightNotice(o, { channel = 'WHATSAPP', inServiceWindow = true, message } = {}) {
    o = order(o);
    if (!['NOTICE_REQUIRED', 'CUSTOMER_REJECTED', 'NOTICE_SENT'].includes(o.weight_diff_status)) G.fail('RN-PED-05', 'Este pedido no tiene una diferencia de peso sobre la tolerancia que avisar.');
    if (o.final_total == null) G.fail('RN-PED-04', 'Pesa todas las líneas por kg antes de avisar el total final.');
    const text = message || suggestedNotice(o);
    let msg = null;
    if (channel === 'WHATSAPP') msg = sendWa(o, text, 'aviso_diferencia_peso', inServiceWindow);
    const wd = weightDiff(o);
    const n = D.insert('order_weight_notices', { order_id: o.id, order_number: o.number, brand_id: o.brand_id, establishment_id: o.establishment_id, estimated_total: o.estimated_total, final_total: o.final_total, diff_pct: wd.pct, message: text, channel, sent_at: G.date.now(), sent_by: G.ctx.userId(), customer_response: 'PENDING', responded_at: null, message_id: msg ? msg.id : null, cost: msg ? msg.cost : 0 });
    o.weight_diff_status = 'NOTICE_SENT';
    D.update('sales_orders', o.id, { weight_diff_status: 'NOTICE_SENT' });
    return n;
  }
  function noticeResponse(noticeId, resp) {
    const n = D.get('order_weight_notices', noticeId); if (!n) G.fail('RN-PED-05', 'Aviso no encontrado.');
    n.customer_response = resp; n.responded_at = G.date.now(); D.update('order_weight_notices', n.id, { customer_response: resp });
    const o = order(n.order_id);
    if (o && resp === 'REJECTED') { o.weight_diff_status = 'CUSTOMER_REJECTED'; D.update('sales_orders', o.id, { weight_diff_status: o.weight_diff_status }); }
    return n;
  }

  /* =====================================================================
     Reprogramación (RN-PED-14), cancelación y no entrega (RN-PED-13)
     ===================================================================== */
  const reasonsFor = kind => D.where('order_cancel_reasons', r => r.status === 'ACTIVE' && (r.applies_to === kind || r.applies_to === 'BOTH'));
  function reschedule(o, { date, slot_id, reason, fee = 0, override } = {}) {
    o = order(o);
    if (!RESCHEDULABLE.includes(o.status)) G.fail('RN-PED-14', `Solo se reprograma un pedido confirmado o no entregado (este está ${G.ui.statusLabel(o.status).toLowerCase()}).`);
    if (!G.can('ped.order.reschedule')) G.fail('RN-PED-14', `Tu rol (${G.roleName()}) no puede reprogramar pedidos (ped.order.reschedule).`);
    if (!reason || !String(reason).trim()) G.fail('RN-PED-14', 'La reprogramación exige un motivo.');
    const max = G.param('ped_max_reschedules') ?? 2;
    if ((o.reschedule_count || 0) >= max && !['SUPERVISORA_VENTAS', 'GERENTE'].includes(G.ctx.role)) G.fail('RN-PED-14', `El pedido ya se reprogramó ${o.reschedule_count} veces: desde la ${max + 1}.ª lo hace la supervisora.`);
    if (!date || date < G.TODAY) G.fail('RN-PED-14', 'Elige una fecha de hoy en adelante.');
    if (o.fulfillment !== 'PROVINCE_SHIPPING' && !slot_id) G.fail('RN-PED-14', 'Elige la nueva franja.');
    if (date === o.delivery_date && slot_id === o.slot_id) G.fail('RN-PED-14', 'La nueva fecha y franja son iguales a las actuales.');
    checkSlot(Object.assign({}, o, { delivery_date: date, slot_id }), { override, strict: true });
    const s = D.get('order_time_slots', slot_id);
    D.insert('order_reschedules', { order_id: o.id, order_number: o.number, brand_id: o.brand_id, establishment_id: o.establishment_id, old_date: o.delivery_date, old_slot_id: o.slot_id, old_slot_from: o.slot_from, new_date: date, new_slot_id: slot_id || null, new_slot_from: s ? s.slot_from : null, reason, fee_charged: Number(fee) || 0, from_status: o.status, rescheduled_by: G.ctx.userId(), rescheduled_by_name: G.ctx.userName(), at: G.date.now() });
    o.delivery_date = date; o.slot_id = slot_id || null; o.slot_from = s ? s.slot_from : null; o.slot_to = s ? s.slot_to : null;
    o.reschedule_count = (o.reschedule_count || 0) + 1; o.reschedule_fee_total = R((o.reschedule_fee_total || 0) + (Number(fee) || 0));
    if (o.status === 'NOT_DELIVERED') G.orders.transition(o, 'CONFIRMED', { reason: 'Reprogramado: ' + reason });
    D.update('sales_orders', o.id, { delivery_date: date, slot_id: o.slot_id, reschedule_count: o.reschedule_count });
    G.events.emit('order.rescheduled', { order_id: o.id, number: o.number, date, slot_id });
    return o;
  }
  function reasonCheck(kind, code, note) {
    const r = D.find('order_cancel_reasons', x => x.code === code && x.status === 'ACTIVE' && (x.applies_to === kind || x.applies_to === 'BOTH'));
    if (!r) G.fail('RN-PED-13', `Elige un motivo del catálogo de ${kind === 'CANCEL' ? 'cancelación' : 'no entrega'}.`);
    if (r.requires_note && !String(note || '').trim()) G.fail('RN-PED-13', `El motivo «${r.name}» exige una nota.`);
    return r;
  }
  function cancelOrder(o, { reason_code, note } = {}) {
    o = order(o);
    if (!['DRAFT', 'CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'NOT_DELIVERED'].includes(o.status)) G.fail('RN-PED-03', `No se puede cancelar un pedido ${G.ui.statusLabel(o.status).toLowerCase()}.`);
    if (o.status !== 'DRAFT' && !G.can('ped.order.cancel')) G.fail('RN-PED-13', `Cancelar un pedido confirmado exige el permiso ped.order.cancel (supervisora). Tu rol: ${G.roleName()}.`);
    const r = reasonCheck('CANCEL', reason_code, note);
    const nRes = (o.reservations || []).length;
    G.orders.transition(o, 'CANCELLED', { reason: r.name + (note ? ' · ' + note : '') });
    o.cancel_reason_code = r.code; o.cancel_note = note || null; o.cancel_counts_as_loss = !!r.counts_as_loss;
    for (const a of D.where('order_discount_approvals', a => a.order_id === o.id && a.status === 'PENDING')) Object.assign(a, { status: 'REJECTED', decided_at: G.date.now(), decision_note: 'Pedido cancelado' });
    D.update('sales_orders', o.id, { cancel_reason_code: r.code });
    return { order: o, releasedReservations: nRes };
  }
  function notDelivered(o, { reason_code, note } = {}) {
    o = order(o);
    if (o.status !== 'IN_ROUTE') G.fail('RN-PED-03', `Solo un pedido EN RUTA se registra como no entregado (este está ${G.ui.statusLabel(o.status).toLowerCase()}).`);
    const r = reasonCheck('NOT_DELIVERED', reason_code, note);
    G.orders.transition(o, 'NOT_DELIVERED', { reason: r.name + (note ? ' · ' + note : '') });
    o.not_delivered_reason_code = r.code; o.not_delivered_note = note || null; o.not_delivered_at = G.date.now();
    D.update('sales_orders', o.id, { not_delivered_reason_code: r.code });
    return o;
  }
  /** RN-PED-18: borradores sin actividad por ped_draft_expiry_hours se cancelan solos */
  function lastActivity(o) { let t = o.created_at || ''; for (const x of o.history || []) if (x.at > t) t = x.at; if (o.updated_at && o.updated_at > t) t = o.updated_at; return t; }
  const hoursSince = (iso, now = G.date.now()) => (Date.parse(now) - Date.parse(String(iso).length === 16 ? iso + ':00' : iso)) / 3.6e6;
  function expiringDrafts(now) { const hrs = G.param('ped_draft_expiry_hours') ?? 48; return D.where('sales_orders', o => o.status === 'DRAFT' && hoursSince(lastActivity(o), now) >= hrs); }
  function expireDrafts(now) {
    const list = expiringDrafts(now);
    for (const o of list) { G.orders.transition(o, 'CANCELLED', { reason: 'Borrador vencido', user: 'Sistema (RN-PED-18)' }); o.cancel_reason_code = 'BORRADOR_VENCIDO'; D.update('sales_orders', o.id, { cancel_reason_code: 'BORRADOR_VENCIDO' }, { silent: true }); }
    return list;
  }

  /* =====================================================================
     Saldo del pedido (RN-PED-15, RN-PED-19, D-PED-05)
     ===================================================================== */
  const balOf = o => o.status === 'CANCELLED' ? R(o.paid_amount || 0) : G.orders.balance(o);
  const customerCredit = cid => R(U.sum(D.where('customer_balance_movements', m => m.customer_id === cid), m => m.amount));
  function resolveBalance(o, mode, { note } = {}) {
    o = order(o);
    const bal = balOf(o);
    if (Math.abs(bal) < 0.005) G.fail('RN-PED-19', `El pedido ${o.number} no tiene saldo: lo pagado coincide con el total.`);
    if (bal > 0 && !['CUSTOMER_CREDIT', 'REFUND'].includes(mode)) G.fail('RN-PED-19', 'El cliente pagó de más: queda como saldo a favor o se le devuelve.');
    if (bal < 0 && !['COLLECT_ON_DELIVERY', 'PAYMENT_LINK', 'WAIVE'].includes(mode)) G.fail('RN-PED-19', 'El cliente pagó de menos: cobro contra entrega, enlace de pago o condonación con permiso.');
    if (mode === 'REFUND' && !G.can('caj.balance.refund')) G.fail('RN-PED-19', `Devolver dinero exige el permiso caj.balance.refund (tu rol: ${G.roleName()}). Déjalo como saldo a favor.`);
    if (mode === 'WAIVE') { const max = G.param('ped_max_waive_amount') ?? 1; if (!G.can('ped.balance.waive')) G.fail('RN-PED-15', 'Condonar un saldo exige el permiso ped.balance.waive.'); if (Math.abs(bal) > max + 1e-9) G.fail('RN-PED-15', `Solo se condona un saldo de hasta ${money(max)} (ped_max_waive_amount); este es ${money(Math.abs(bal))}.`); }
    if (mode === 'COLLECT_ON_DELIVERY' && ['DELIVERED', 'CLOSED'].includes(o.status)) G.fail('RN-PED-19', 'El pedido ya se entregó: usa enlace de pago.');
    if (mode === 'CUSTOMER_CREDIT' && (o.customer_id === 'cu-VARIOS' || !o.customer_id)) G.fail('RN-PED-19', 'Para dejar saldo a favor el cliente debe estar identificado.');
    Object.assign(o, { balance_mode: mode, balance_amount: bal, balance_note: note || null, balance_decided_by: G.ctx.userId(), balance_decided_by_name: G.ctx.userName(), balance_decided_at: G.date.now() });
    if (mode === 'CUSTOMER_CREDIT') D.insert('customer_balance_movements', { customer_id: o.customer_id, movement_type: o.final_total != null && o.final_total < o.estimated_total ? 'WEIGHT_DIFFERENCE' : 'OVERPAYMENT', amount: bal, order_id: o.id, payment_id: (o.payment_ids || [])[0] || null, document_id: null, reason: note || `Saldo a favor del pedido ${o.number}`, brand_id: o.brand_id, at: G.date.now() });
    if (mode === 'REFUND') { o.refund_status = 'PENDING'; G.notify({ role: 'ADMINISTRACION', title: `Devolver ${money(bal)} · ${o.number}`, body: `${G.custName(o.customer_id)} · ${G.pmName(o.payment_method_id)}`, ref: o.id, tone: 'warn', module: 'PED' }); }
    if (mode === 'PAYMENT_LINK' && o.contact_phone) { try { sendWa(o, `Hola, tu pedido ${o.number} tiene un saldo de ${money(-bal)}. Puedes pagarlo aquí: https://pagar.donguando.pe/${o.number}`, 'enlace_pago', true); } catch (e) { /* aviso opcional */ } }
    D.update('sales_orders', o.id, { balance_mode: mode, balance_amount: bal });
    return o;
  }
  function closeOrder(o) {
    o = order(o);
    if (o.status !== 'DELIVERED') G.fail('RN-PED-03', 'Solo se cierra un pedido entregado.');
    const bal = balOf(o);
    if (Math.abs(bal) >= 0.005 && !o.balance_mode) G.fail('RN-PED-15', `El pedido tiene un saldo de ${money(bal)} sin decidir: regístralo en PED-12 (saldo a favor, devolución, cobro o condonación).`);
    if (bal <= -0.005 && ['COLLECT_ON_DELIVERY', 'PAYMENT_LINK'].includes(o.balance_mode)) G.fail('RN-PED-15', `Falta cobrar ${money(-bal)} (${BMODE[o.balance_mode]}): registra el cobro antes de cerrar.`);
    return G.orders.transition(o, 'CLOSED', { reason: o.balance_mode ? BMODE[o.balance_mode] : 'Pagado' });
  }

  /* =====================================================================
     Provincia (RN-PED-08)
     ===================================================================== */
  const agencies = () => D.where('suppliers', s => s.supplier_type === 'DELIVERY_COMPANY' && s.status === 'ACTIVE');
  function setProvince(o, d) {
    o = order(o);
    if (['DELIVERED', 'CLOSED', 'CANCELLED'].includes(o.status)) G.fail('RN-PED-08', 'El envío ya terminó.');
    for (const k of ['province_agency', 'province_destination', 'thermal_packaging', 'tracking_number', 'province_notes']) if (d[k] !== undefined) o[k] = d[k];
    D.update('sales_orders', o.id, { province_agency: o.province_agency, tracking_number: o.tracking_number || null });
    return o;
  }
  function issueGuide(o) {
    o = order(o);
    if (o.dispatch_guide_number) G.fail('RN-FAC-11', `El pedido ya tiene la guía ${o.dispatch_guide_number}.`);
    if (!['READY', 'WEIGHED', 'IN_PREPARATION'].includes(o.status)) G.fail('RN-FAC-11', 'La guía se emite con el pedido preparado (LISTO).');
    if (G.fac && typeof G.fac.issueGuide === 'function') { try { const g = G.fac.issueGuide({ order_id: o.id }); if (g && (g.full_number || g.number)) { o.dispatch_guide_number = g.full_number || g.number; D.touch(); return g; } } catch (e) { if (isRule(e)) throw e; } }
    G.period.assertOpen(G.TODAY);
    const n = G.series.next(o.establishment_id === 'es-L2' ? 'T002' : 'T001');
    const a = D.get('customer_addresses', o.address_id) || {};
    const g = D.insert('dispatch_guides', { series: n.series, number: n.number, full_number: n.full, guide_type: 'SENDER', order_id: o.id, brand_id: o.brand_id, establishment_id: o.establishment_id, issue_date: G.TODAY, transfer_reason: '01', transfer_reason_name: 'Venta', carrier_supplier_id: o.province_agency, destination_address: a.address_line || o.province_destination, total_weight_kg: R(U.sum(o.lines, l => l.weighed_kg ?? l.est_weight_kg ?? 0), 3), status: 'ISSUED', sunat_status: 'ACCEPTED' });
    o.dispatch_guide_number = n.full; D.update('sales_orders', o.id, { dispatch_guide_number: n.full });
    return g;
  }

  /* =====================================================================
     Guardar borrador desde PED-02 (crear o editar)
     ===================================================================== */
  function saveDraft(st, id) {
    const notes = st.no_notes ? 'Sin indicaciones' : (st.notes || null);
    const addr = ['DELIVERY', 'PROVINCE_SHIPPING'].includes(st.fulfillment) ? st.address_id : null;
    const a = addr ? D.get('customer_addresses', addr) : null;
    const zone = a ? a.zone_id : null;
    const est = st.fulfillment === 'PICKUP' ? st.pickup_establishment_id : st.fulfillment === 'PROVINCE_SHIPPING' ? 'es-L1' : (zone ? (D.get('delivery_zones', zone) || {}).establishment_id : null) || 'es-L1';
    const lines = st.lines.map(l => ({ variant_id: l.variant_id, qty: l.qty, est_weight_kg: l.est_weight_kg, cut_notes: l.cut_notes || null }));
    const fields = { brand_id: st.brand_id, channel: st.channel, customer_id: st.customer_id || null, fulfillment: st.fulfillment, address_id: addr, delivery_date: st.delivery_date || null, slot_id: st.fulfillment === 'PROVINCE_SHIPPING' ? null : (st.slot_id || null), payment_method_id: st.payment_method_id || null, requested_doc_type: st.requested_doc_type, billing_customer_id: st.requested_doc_type === 'INVOICE' ? (st.billing_customer_id || st.customer_id) : st.customer_id, notes, contact_phone: st.contact_phone || null, pickup_establishment_id: st.fulfillment === 'PICKUP' ? st.pickup_establishment_id : null, establishment_id: est, origin_wa_number: st.origin_wa_number || null, origin_ad_code: st.origin_ad_code || null };
    const prov = { province_agency: st.fulfillment === 'PROVINCE_SHIPPING' ? st.province_agency || null : null, province_destination: st.fulfillment === 'PROVINCE_SHIPPING' ? st.province_destination || null : null, thermal_packaging: st.fulfillment === 'PROVINCE_SHIPPING' ? !!st.thermal_packaging : false };
    let o;
    if (!id) {
      o = G.orders.create(Object.assign({}, fields, { lines, extra: prov }));
      o.address_id = addr; o.zone_id = zone; o.contact_phone = st.contact_phone || o.contact_phone; G.orders.recalc(o);
    } else {
      o = order(id); if (o.status !== 'DRAFT') G.fail('RN-PED-07', 'Solo se edita un borrador.');
      const tmp = Object.assign({}, fields, { status: 'DRAFT', lines: [] });
      for (const l of lines) G.orders.addLine(tmp, l, { noRecalc: true });
      Object.assign(o, fields, prov, { lines: tmp.lines, zone_id: zone });
      const s = D.get('order_time_slots', o.slot_id); o.slot_from = s ? s.slot_from : null; o.slot_to = s ? s.slot_to : null;
      G.orders.recalc(o);
      D.update('sales_orders', o.id, { customer_id: o.customer_id, estimated_total: o.estimated_total });
    }
    if ((Number(st.discount_pct) || 0) !== (o.order_discount_pct || 0) || (st.discount_pct && o.discount_status === 'REJECTED' && st.discount_reason !== o.discount_reason)) setDiscount(o, st.discount_pct, st.discount_reason);
    else G.orders.recalc(o);
    D.touch();
    return o;
  }

  /* ---------- vista v_orders_incomplete ---------- */
  function incomplete() { return D.where('sales_orders', o => !['CANCELLED', 'CLOSED'].includes(o.status) && G.orders.missing(o).length > 0); }
  function deliveryFee(o) { const c = Object.assign({}, o, { lines: (o.lines || []).map(l => Object.assign({}, l)) }); G.orders.recalc(c); return c.delivery_fee; }

  G.ped = { confirm: confirmOrder, saveDraft, setDiscount, decideDiscount, discountLimit, checkSlot, slotsFor, slotUse, slotCut, reschedule, cancel: cancelOrder, notDelivered, weigh, weightDiff, weightNotice, noticeResponse, summary, sendSummary, customerConfirmed, resolveBalance, close: closeOrder, balance: balOf, customerCredit, expireDrafts, expiringDrafts, incomplete, addLine, updateLine, removeLine, setProvince, issueGuide, deliveryFee, stockShort, MISSING_LABEL };

  /* ---------- eventos consumidos ---------- */
  G.events.on('order.delivered', p => {
    const o = order(p.order_id); if (!o || o.channel === 'COUNTER' || o.balance_mode) return;
    const bal = balOf(o);
    if (bal > 0.005 && o.customer_id && o.customer_id !== 'cu-VARIOS') { try { resolveBalance(o, 'CUSTOMER_CREDIT', { note: `D-PED-05: saldo a favor de ${money(bal)} para la próxima compra (pedido ${o.number})` }); } catch (e) { console.error(e); } }
  });
  G.events.on('wave.released', p => { for (const id of (p && p.order_ids) || []) { const o = order(id); if (o && o.status === 'CONFIRMED') { try { G.orders.transition(o, 'IN_PREPARATION', { reason: 'Ola liberada' }); } catch (e) { console.error(e); } } } });

  /* =====================================================================
     Ganchos globales: búsqueda, escáner, alertas, indicadores
     ===================================================================== */
  G.searchProviders.push(q => {
    const s = String(q || '').trim().toLowerCase(); if (s.length < 3) return [];
    const cn = new Map(D.all('customers').map(c => [c.id, (c.trade_name || c.full_name || '')]));
    const out = [];
    for (const o of D.all('sales_orders')) {
      const name = cn.get(o.customer_id) || '';
      if (o.number.toLowerCase().includes(s) || (o.contact_phone || '').includes(s) || name.toLowerCase().includes(s)) {
        out.push({ label: `${o.number} · ${name}`, sub: `Pedido ${G.ui.statusLabel(o.status).toLowerCase()} · ${G.brandName(o.brand_id)} · entrega ${F.date(o.delivery_date)} · ${money(total(o))}`, go: () => G.go('PED-03', { id: o.id }) });
        if (out.length >= 8) break;
      }
    }
    return out;
  });
  G.scanHandlers.push(code => { if (!/^P-\d{3,}$/.test(code)) return null; const o = D.find('sales_orders', x => x.number === code); return o ? () => G.go('PED-03', { id: o.id }) : null; });
  G.alertProviders.push(() => {
    const out = [];
    const exp = expiringDrafts(); if (exp.length) out.push({ module: 'PED', title: `${exp.length} borrador(es) vencido(s) por cancelar`, detail: `Sin actividad por ${G.param('ped_draft_expiry_hours') ?? 48} h (RN-PED-18).`, tone: 'warn', go: () => G.go('PED-01') });
    const nr = D.where('sales_orders', o => o.weight_diff_status === 'NOTICE_REQUIRED' && OPEN_ST.includes(o.status)); if (nr.length) out.push({ module: 'PED', title: `${nr.length} pedido(s) con aviso de peso pendiente`, detail: 'No pasan a LISTO hasta avisar al cliente (RN-PED-05).', tone: 'warn', go: () => G.go('PED-07') });
    const da = D.where('order_discount_approvals', a => a.status === 'PENDING'); if (da.length) out.push({ module: 'PED', title: `${da.length} descuento(s) por aprobar`, detail: 'Sobre el límite del rol (RN-PED-11).', tone: 'info', go: () => G.go('PED-10') });
    return out;
  });
  const inP = (o, p) => { const d = (o.created_at || '').slice(0, 10); return d >= (p.from || '0000') && d <= (p.to || '9999') && (!p.brand || o.brand_id === p.brand) && (!p.site || o.establishment_id === p.site); };
  const confirmedIn = p => D.where('sales_orders', o => o.confirmed_at && inP(o, p) && o.status !== 'DRAFT');
  G.kpiCalc['KPI-PED-01'] = p => G.sales.total(G.sales.orders(p));
  G.kpiCalc['KPI-PED-02'] = p => { const os = G.sales.orders(p); return os.length ? R(G.sales.total(os) / os.length) : 0; };
  G.kpiCalc['KPI-PED-03'] = p => { const os = confirmedIn(p); const bad = os.filter(o => G.orders.missing(o).length).length; return { value: os.length ? R(bad / os.length * 100, 1) : 0, numerator: bad, denominator: os.length }; };
  G.kpiCalc['KPI-PED-04'] = p => { let e = 0, w = 0; for (const o of D.where('sales_orders', o => inP(o, p) && o.status !== 'CANCELLED')) for (const l of o.lines || []) if (l.price_basis === 'KG' && l.weighed_kg != null && l.est_weight_kg) { e += l.est_weight_kg; w += l.weighed_kg; } return { value: e ? R((w - e) / e * 100, 2) : 0, numerator: R(w - e, 3), denominator: R(e, 3) }; };
  G.kpiCalc['KPI-PED-05'] = p => { const os = confirmedIn(p); const c = os.filter(o => o.status === 'CANCELLED').length; return { value: os.length ? R(c / os.length * 100, 1) : 0, numerator: c, denominator: os.length }; };
  G.kpiCalc['KPI-PED-06'] = p => { const os = confirmedIn(p); const c = os.filter(o => (o.reschedule_count || 0) > 0).length; return { value: os.length ? R(c / os.length * 100, 1) : 0, numerator: c, denominator: os.length }; };
  G.kpiCalc['KPI-PED-07'] = p => { const os = D.where('sales_orders', o => inP(o, p) && ACTIVE_ST.includes(o.status)); const disc = U.sum(os, o => o.discount_total || 0); const gross = U.sum(os, o => (o.estimated_total || 0) - (o.delivery_fee || 0) + (o.discount_total || 0)); return { value: gross ? R(disc / gross * 100, 2) : 0, numerator: R(disc), denominator: R(gross) }; };
  G.kpiCalc['KPI-PED-08'] = p => { const os = confirmedIn(p).filter(o => o.status !== 'CANCELLED'); const days = new Set(os.map(o => o.created_at.slice(0, 10))).size; return { value: days ? R(os.length / days, 1) : 0, numerator: os.length, denominator: days }; };
  G.kpiCalc['KPI-PED-09'] = p => { const os = D.where('sales_orders', o => inP(o, p) && o.weight_diff_status && o.weight_diff_status !== 'NONE'); const n = os.filter(o => ['NOTICE_REQUIRED', 'NOTICE_SENT', 'CUSTOMER_REJECTED'].includes(o.weight_diff_status)).length; return { value: os.length ? R(n / os.length * 100, 1) : 0, numerator: n, denominator: os.length }; };
  G.kpiCalc['KPI-PED-10'] = p => { const m = confirmedIn(p).map(o => (Date.parse(o.confirmed_at) - Date.parse(o.created_at)) / 60000).filter(x => x >= 0 && isFinite(x)).sort((a, b) => a - b); if (!m.length) return 0; const k = Math.floor(m.length / 2); return R(m.length % 2 ? m[k] : (m[k - 1] + m[k]) / 2, 1); };

  /* =====================================================================
     Interfaz
     ===================================================================== */
  function visibleOrders(pred) {
    const all = D.where('sales_orders', o => G.scope.ok(o) && (!pred || pred(o)));
    if (G.can('ped.order.view_all') || !['VENDEDORA'].includes(G.ctx.role)) return all;
    const me = G.ctx.userId(); return all.filter(o => o.seller_id === me || !o.seller_id);
  }
  const custCell = o => h('div', { style: 'min-width:0' }, h('div', null, G.custName(o.customer_id)), h('div', { class: 'muted small mono' }, o.contact_phone || ''));
  function flags(o, use) {
    const out = [];
    if (o.status === 'DRAFT') { const m = G.orders.missing(o); if (m.length) out.push(badge(`Faltan ${m.length}`, 'warn')); }
    if (o.weight_diff_status === 'NOTICE_REQUIRED') out.push(badge('Aviso de peso', 'warn'));
    if (o.weight_diff_status === 'CUSTOMER_REJECTED') out.push(badge('Peso rechazado', 'bad'));
    if (o.discount_status === 'PENDING_APPROVAL') out.push(badge('Descuento por aprobar', 'info'));
    if (o.needs_production) out.push(badge('Sin stock', 'bad'));
    if (use && o.slot_id && o.delivery_date >= G.TODAY) { const s = D.get('order_time_slots', o.slot_id); if (s && (use.get(o.slot_id + '|' + o.delivery_date) || 0) >= s.capacity) out.push(badge('Franja llena', 'bad')); }
    if (o.reschedule_count) out.push(badge(`Reprog. ${o.reschedule_count}`, ''));
    return out.length ? h('div', { class: 'row', style: 'gap:4px' }, out) : '';
  }
  /** buscador de pedidos por número, celular o cliente */
  function orderPicker(onPick, pred, placeholder) {
    const box = h('div', { class: 'stack', style: 'gap:6px' });
    const res = h('div', { class: 'row', style: 'gap:6px' });
    const i = inp('search', '', v => draw(v), { placeholder: placeholder || 'Número de pedido, celular o cliente', attrs: { 'aria-label': 'Buscar pedido' } });
    function draw(q) {
      G.ui.clear(res); const s = String(q || '').trim().toLowerCase(); if (s.length < 2) return;
      const rows = visibleOrders(o => (!pred || pred(o)) && (o.number.toLowerCase().includes(s) || (o.contact_phone || '').includes(s) || G.custName(o.customer_id).toLowerCase().includes(s))).slice(0, 8);
      if (!rows.length) res.appendChild(h('span', { class: 'muted small' }, 'Sin coincidencias.'));
      for (const o of rows) res.appendChild(btn(`${o.number} · ${G.custName(o.customer_id)} · ${G.ui.statusLabel(o.status)}`, () => onPick(o), { sm: true }));
    }
    box.append(i, res); return box;
  }
  function stepsNode(o) {
    const idx = FLOW.indexOf(o.status);
    return h('div', { class: 'steps' }, FLOW.map((s, i) => h('div', { class: 'step' + (i < idx ? ' done' : i === idx ? ' cur' : '') }, h('span', { class: 'n' }, i + 1), G.ui.statusLabel(s))),
      o.status === 'CANCELLED' ? h('div', { class: 'step cur' }, 'Cancelado') : null, o.status === 'NOT_DELIVERED' ? h('div', { class: 'step cur' }, 'No entregado') : null);
  }
  function tryConfirm(o, opts = {}, after) {
    try { confirmOrder(o, opts); toast(`Pedido ${o.number} confirmado y stock reservado por FEFO`, 'ok'); if (after) after(); else G.refresh(); }
    catch (e) {
      if (e.code === 'RN-PED-06' && G.can('ped.slot.override') && !opts.override) return confirm({ title: 'Franja llena o con hora de corte vencida', message: e.message + ' Tienes el permiso ped.slot.override: ¿confirmar fuera de cupo?', confirmLabel: 'Confirmar fuera de cupo', onConfirm: () => tryConfirm(o, Object.assign({}, opts, { override: true }), after) });
      if (e.code === 'RN-PED-17' && G.can('ped.order.confirm_without_stock') && !opts.withoutStock) return confirm({ title: 'Sin stock disponible', message: e.message + ' ¿Confirmar y marcar para producción o compra?', confirmLabel: 'Confirmar sin stock', onConfirm: () => tryConfirm(o, Object.assign({}, opts, { withoutStock: true }), after) });
      if (!isRule(e)) console.error(e);
      toast(e.message, 'bad');
    }
  }
  function missingList(codes) {
    if (!codes.length) return notice('Tiene todos los datos obligatorios (RN-PED-01).', 'ok');
    return h('div', { class: 'stack', style: 'gap:4px' }, codes.map(c => h('div', { class: 'row', style: 'gap:8px' }, badge(c, 'warn'), h('span', { class: 'small' }, MISSING_LABEL[c] || c))));
  }

  /* ---------- PED-01 Pedidos ---------- */
  const listState = { scope: 'TODAY', status: '' };
  function renderList(el) {
    const body = page(el, { code: 'PED-01', title: 'Pedidos', sub: 'Todos los canales en una lista: borradores con datos faltantes, avisos de peso, descuentos por aprobar y franjas llenas a la vista.', actions: [
      G.canDo('PED', 'C') ? { label: 'Nuevo pedido', kind: 'primary', icon: '+', onClick: () => G.go('PED-02') } : null,
      { label: 'Tablero del día', onClick: () => G.go('PED-14') },
    ].filter(Boolean) });
    const exp = expiringDrafts();
    if (exp.length) body.appendChild(notice([h('b', null, `${exp.length} borrador(es) sin actividad por ${G.param('ped_draft_expiry_hours') ?? 48} h o más: `), exp.map(o => o.number).join(', '), '. RN-PED-18 los cancela con el motivo «Borrador vencido». ', G.canDo('PED', 'E') ? btn('Vencer borradores ahora', () => act(() => expireDrafts(), `${exp.length} borrador(es) cancelado(s) por vencimiento`), { sm: true }) : null], 'warn'));
    const tomorrow = G.date.add(G.TODAY, 1);
    const scopes = { TODAY: o => o.delivery_date === G.TODAY, TOMORROW: o => o.delivery_date === tomorrow, OPEN: o => OPEN_ST.includes(o.status), MONTH: o => (o.created_at || '').slice(0, 7) === G.TODAY.slice(0, 7), INCOMPLETE: o => !['CANCELLED', 'CLOSED'].includes(o.status) && G.orders.missing(o).length > 0, ALL: () => true };
    const base = visibleOrders(scopes[listState.scope]);
    const counts = U.groupBy(base, 'status');
    body.appendChild(h('div', { class: 'row between' }, pills([['TODAY', 'Entrega hoy'], ['TOMORROW', 'Mañana'], ['OPEN', 'Abiertos'], ['MONTH', 'Este mes'], ['INCOMPLETE', 'Incompletos'], ['ALL', 'Todos']], listState.scope, v => { listState.scope = v; listState.status = ''; G.refresh(); }),
      h('span', { class: 'muted small' }, listState.scope === 'INCOMPLETE' ? 'Vista v_orders_incomplete: pedidos abiertos a los que les falta algún dato obligatorio.' : `${base.length} pedidos`)));
    body.appendChild(kpis(G.ORDER_STATUS.map(s => ({ label: G.ui.statusLabel(s), value: F.num((counts[s] || []).length), tone: listState.status === s ? 'info' : s === 'DRAFT' && (counts[s] || []).length ? 'warn' : s === 'NOT_DELIVERED' && (counts[s] || []).length ? 'bad' : '', onClick: () => { listState.status = listState.status === s ? '' : s; G.refresh(); } }))));
    const rows = listState.status ? base.filter(o => o.status === listState.status) : base;
    const use = usageMap();
    const users = U.groupBy(D.all('users'), 'id');
    const cols = [
      { key: 'number', label: 'Pedido', mono: true, render: o => h('span', { style: 'white-space:nowrap' }, o.number) },
      { key: 'created_at', label: 'Creado', render: o => h('span', { class: 'small' }, F.datetime(o.created_at)) },
      { key: 'customer', label: 'Cliente', value: o => G.custName(o.customer_id) + ' ' + (o.contact_phone || ''), render: custCell },
      { key: 'brand_id', label: 'Marca', value: o => G.brandName(o.brand_id) },
      { key: 'channel', label: 'Canal', value: o => G.channelName(o.channel) },
      { key: 'delivery_date', label: 'Entrega', value: o => (o.delivery_date || '') + ' ' + (o.slot_from || ''), render: o => h('div', null, h('div', null, F.date(o.delivery_date)), h('div', { class: 'muted small' }, o.fulfillment === 'DELIVERY' ? slotText(o) : G.fulfillName(o.fulfillment))) },
      { key: 'zone_id', label: 'Zona', value: o => o.zone_id ? G.zoneName(o.zone_id).split(' (')[0] : (o.fulfillment === 'PICKUP' ? 'Recojo' : '—') },
      { key: 'seller_id', label: 'Vendedora', value: o => o.seller_id ? ((users[o.seller_id] || [{}])[0].name || '').split(' ').slice(0, 2).join(' ') : (o.channel === 'WEB' ? 'Tienda web' : '—') },
      { key: 'total', label: 'Total', align: 'r', value: o => total(o), render: o => h('span', { class: 'num' }, money(total(o)), o.final_total == null && (o.lines || []).some(l => l.price_basis === 'KG') ? h('span', { class: 'muted small' }, ' est.') : null) },
      { key: 'status', label: 'Estado', render: o => status(o.status) },
      listState.scope === 'INCOMPLETE' ? { key: 'missing', label: 'Datos que faltan', value: o => G.orders.missing(o).join(', '), render: o => h('div', { class: 'row', style: 'gap:4px' }, G.orders.missing(o).map(c => badge(c, 'warn'))) } : { key: 'flags', label: 'Alertas', sort: false, value: () => '', render: o => flags(o, use) },
    ];
    const opt = (arr, fn) => [...new Set(arr.map(fn).filter(Boolean))].map(v => [v, v]);
    body.appendChild(table({ id: 'ped01', columns: cols, rows: rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), onRow: o => G.go('PED-03', { id: o.id }), pageSize: 25,
      filters: [
        { key: 'brand_id', label: 'Marca', options: G.scope.brands().map(b => [b.id, G.brandName(b.id)]) },
        { key: 'channel', label: 'Canal', options: G.CHANNELS },
        { key: 'zone_id', label: 'Zona', options: D.all('delivery_zones').map(z => [z.id, z.name.split(' (')[0]]) },
        { key: 'seller_id', label: 'Vendedora', options: D.where('users', u => u.role === 'VENDEDORA').map(u => [u.id, u.name.split(' ').slice(0, 2).join(' ')]) },
        { key: 'establishment_id', label: 'Local', options: [['es-L1', 'Local 1'], ['es-L2', 'Local 2']] },
        { key: 'slot', label: 'Franja', options: opt(rows, o => o.slot_from ? slotText(o) : null), value: o => o.slot_from ? slotText(o) : '' },
      ] }));
  }

  /* ---------- PED-04 Selector de productos (también dentro de PED-02) ---------- */
  function pickerNode({ brand_id, channel, customer_id, establishment_id, onAdd, compact }) {
    const wrap = h('div', { class: 'stack', style: 'grid-template-columns:minmax(0,1fr)' });
    const av = saleAvail(establishment_id || 'es-L1');
    const vs = D.where('product_variants', v => v.brand_id === brand_id && v.status === 'ACTIVE' && v.sellable);
    let q = '';
    const listBox = h('div');
    const search = inp('search', '', v => { q = v; draw(); }, { placeholder: 'Nombre, SKU o código de barras', attrs: { 'aria-label': 'Buscar producto' } });
    wrap.append(notice(`Solo productos activos de ${G.brandName(brand_id)} con el precio vigente del canal ${G.channelName(channel)}. No existe el producto libre (RN-PED-02); D-PED-01: un pedido por marca.`, 'info'), search, listBox);
    function draw() {
      G.ui.clear(listBox);
      const s = q.trim().toLowerCase();
      const rows = vs.filter(v => !s || v.name.toLowerCase().includes(s) || v.sku.toLowerCase().includes(s) || String(v.barcode || '').includes(s) || (G.productOf(v.id) || {}).name.toLowerCase().includes(s));
      if (!rows.length) { listBox.appendChild(empty(s ? `Ningún producto de ${G.brandName(brand_id)} coincide con «${q}».` : 'La marca no tiene productos activos.')); return; }
      listBox.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Producto', 'Modo', 'Precio', 'Disponible', ''].map((x, i) => h('th', { class: i >= 2 && i <= 3 ? 'r' : '' }, x)))),
        h('tbody', null, rows.map(v => {
          const pr = G.price.of(v.id, { brand_id, channel, customer_id });
          const a = R(Math.max(0, av.get(v.id) || 0), 3);
          const unit = v.sale_mode === 'KG' ? 'kg' : 'u';
          const qty = inp('number', v.sale_mode === 'KG' ? 1 : 1, () => { }, { step: v.qty_step || 1, min: v.min_order_qty || 0.25, style: 'width:76px', attrs: { 'aria-label': 'Cantidad ' + v.name } });
          return h('tr', null,
            h('td', null, h('div', null, v.name), h('div', { class: 'muted small mono' }, `${v.sku} · ${v.barcode || ''}`)),
            h('td', null, h('span', { class: 'small' }, G.saleModeName(v.sale_mode)), v.nominal_weight_kg ? h('div', { class: 'muted small' }, `≈ ${F.num(v.nominal_weight_kg, 3)} kg/u · tol. ${v.weight_tolerance_pct ?? 10} %`) : null),
            h('td', { class: 'r num' }, pr ? `${money(pr.price)}${pr.basis === 'KG' ? '/kg' : ''}` : h('span', { class: 'muted small' }, 'Sin precio')),
            h('td', { class: 'r num' }, a > 0 ? `${F.num(a, v.sale_mode === 'KG' ? 2 : 0)} ${unit}` : badge('Sin stock', 'bad')),
            h('td', { class: 'r' }, onAdd ? h('div', { class: 'row', style: 'gap:6px;justify-content:flex-end;flex-wrap:nowrap' }, qty, btn('Agregar', () => { const n = Number(qty.value); if (!(n > 0)) return toast('Indica la cantidad.', 'warn'); if (!pr) return toast(`RN-CAT-05: ${v.name} no tiene precio vigente en el canal ${G.channelName(channel)}.`, 'bad'); onAdd(v, n); }, { sm: true, kind: 'primary', disabled: !pr })) : ''));
        })))));
    }
    draw();
    return wrap;
  }
  const pick4 = { brand: null, channel: 'WHATSAPP', target: '' };
  function renderPicker(el) {
    const body = page(el, { code: 'PED-04', title: 'Selector de productos', sub: 'Busca por nombre, SKU o código de barras dentro de la marca del pedido: corte, modo de venta, precio vigente del canal y stock disponible.' });
    const brands = G.scope.brands();
    if (!pick4.brand || !brands.find(b => b.id === pick4.brand)) pick4.brand = G.ctx.brand !== 'ALL' ? G.ctx.brand : brands[0].id;
    const drafts = visibleOrders(o => o.status === 'DRAFT' && o.brand_id === pick4.brand);
    const target = drafts.find(o => o.id === pick4.target);
    body.appendChild(card(null, h('div', { class: 'form-grid' },
      fld('Marca', sel(brands.map(b => [b.id, G.brandName(b.id)]), pick4.brand, v => { pick4.brand = v; pick4.target = ''; G.refresh(); })),
      fld('Canal (lista de precios)', sel(G.CHANNELS.filter(c => !['CONSIGNMENT', 'OTHER'].includes(c[0])), pick4.channel, v => { pick4.channel = v; G.refresh(); })),
      fld('Agregar al borrador', sel([['', 'Solo consultar precio y stock'], ...drafts.slice(0, 60).map(o => [o.id, `${o.number} · ${G.custName(o.customer_id)}`])], pick4.target, v => { pick4.target = v; G.refresh(); }), 'Borradores de la marca elegida', true))));
    if (target) body.appendChild(notice([h('b', null, `${target.number}: `), `${target.lines.length} línea(s) · total estimado ${money(target.estimated_total)} · canal ${G.channelName(target.channel)}. `, btn('Abrir en PED-02', () => G.go('PED-02', { id: target.id }), { sm: true })], 'info'));
    body.appendChild(card(`Catálogo de ${G.brandName(pick4.brand)}`, pickerNode({ brand_id: pick4.brand, channel: target ? target.channel : pick4.channel, customer_id: target ? target.customer_id : null, establishment_id: target ? target.establishment_id : 'es-L1', onAdd: target ? (v, n) => act(() => addLine(target, { variant_id: v.id, qty: n }), `${v.name} agregado a ${target.number}`) : null })));
  }

  /* ---------- PED-02 Nuevo pedido ---------- */
  function stateFrom(o) {
    return { customer_id: o.customer_id, contact_phone: o.contact_phone, brand_id: o.brand_id, channel: o.channel, origin_wa_number: o.origin_wa_number, origin_ad_code: o.origin_ad_code, fulfillment: o.fulfillment === 'COUNTER' ? 'PICKUP' : o.fulfillment, address_id: o.address_id, pickup_establishment_id: o.pickup_establishment_id || 'es-L1', province_agency: o.province_agency, province_destination: o.province_destination, thermal_packaging: !!o.thermal_packaging, delivery_date: o.delivery_date, slot_id: o.slot_id,
      lines: (o.lines || []).map(l => ({ variant_id: l.variant_id, qty: l.qty, est_weight_kg: l.est_weight_kg, cut_notes: l.cut_notes, estEdited: true })), discount_pct: o.order_discount_pct || 0, discount_reason: o.discount_reason || '', payment_method_id: o.payment_method_id, requested_doc_type: o.requested_doc_type || 'RECEIPT', billing_customer_id: o.billing_customer_id, notes: o.notes === 'Sin indicaciones' ? '' : (o.notes || ''), no_notes: o.notes === 'Sin indicaciones' };
  }
  function renderNew(el, params) {
    const editing = params.id ? order(params.id) : null;
    if (editing && editing.status !== 'DRAFT') {
      const b = page(el, { code: 'PED-02', title: 'Nuevo pedido', sub: 'Formulario de una pantalla para crear o corregir borradores.' });
      b.appendChild(notice(`RN-PED-07: el pedido ${editing.number} está ${G.ui.statusLabel(editing.status).toLowerCase()} y ya no se edita aquí. Para cambiarlo, vuélvelo a borrador antes de preparar o cancélalo con motivo.`, 'warn'));
      b.appendChild(btn('Ver detalle (PED-03)', () => G.go('PED-03', { id: editing.id }), { kind: 'primary' }));
      return;
    }
    const brands = G.scope.brands();
    const st = editing ? stateFrom(editing) : {
      customer_id: params.customer_id || null, contact_phone: '', brand_id: G.ctx.brand !== 'ALL' ? G.ctx.brand : brands[0].id, channel: params.channel || 'WHATSAPP', origin_wa_number: null, origin_ad_code: null, fulfillment: 'DELIVERY', address_id: null, pickup_establishment_id: 'es-L1', province_agency: null, province_destination: '', thermal_packaging: true,
      delivery_date: G.TODAY, slot_id: null, lines: [], discount_pct: 0, discount_reason: '', payment_method_id: null, requested_doc_type: G.param('pos_receipt_default_doc') === 'INVOICE' ? 'INVOICE' : 'RECEIPT', billing_customer_id: null, notes: '', no_notes: false,
    };
    if (!editing && st.customer_id) { const c = D.get('customers', st.customer_id); if (c) { st.contact_phone = c.phone; const a = D.find('customer_addresses', a => a.customer_id === c.id && a.is_default && a.status === 'ACTIVE'); st.address_id = a ? a.id : null; } }
    if (!editing && !slotsFor(null, null, G.TODAY).some(s => !slotCutPassed(s, G.TODAY))) st.delivery_date = G.date.add(G.TODAY, 1);
    const body = page(el, { code: 'PED-02', title: editing ? `Editar borrador ${editing.number}` : 'Nuevo pedido', sub: 'Una sola pantalla pensada para el celular: cliente, entrega, franja, productos, pago y comprobante. El panel «Datos que faltan» se actualiza en vivo (RN-PED-01).' });
    const left = h('div', { class: 'stack', style: 'gap:14px;min-width:0' });
    const right = h('div', { class: 'stack ped-side', style: 'gap:14px;min-width:0' });
    body.appendChild(h('div', { class: 'grid side-r' }, left, right));
    const custBox = h('div', { class: 'stack' }), originBox = h('div'), deliveryBox = h('div', { class: 'stack' }), slotBox = h('div', { class: 'stack' }), linesBox = h('div', { class: 'stack' }), payBox = h('div', { class: 'stack' }), sumBox = h('div', { class: 'stack' }), missBox = h('div', { class: 'stack' });
    const prev = () => {
      const a = ['DELIVERY', 'PROVINCE_SHIPPING'].includes(st.fulfillment) && st.address_id ? D.get('customer_addresses', st.address_id) : null;
      const zone = a ? a.zone_id : null;
      const est = st.fulfillment === 'PICKUP' ? st.pickup_establishment_id : st.fulfillment === 'PROVINCE_SHIPPING' ? 'es-L1' : (zone ? (D.get('delivery_zones', zone) || {}).establishment_id : null) || 'es-L1';
      const o = { id: editing ? editing.id : null, number: editing ? editing.number : '(nuevo)', status: 'DRAFT', brand_id: st.brand_id, channel: st.channel, customer_id: st.customer_id, fulfillment: st.fulfillment, address_id: a ? a.id : null, zone_id: zone, establishment_id: est, pickup_establishment_id: st.fulfillment === 'PICKUP' ? st.pickup_establishment_id : null, province_agency: st.fulfillment === 'PROVINCE_SHIPPING' ? st.province_agency : null, delivery_date: st.delivery_date, slot_id: st.fulfillment === 'PROVINCE_SHIPPING' ? null : st.slot_id, payment_method_id: st.payment_method_id, requested_doc_type: st.requested_doc_type, billing_customer_id: st.requested_doc_type === 'INVOICE' ? st.billing_customer_id : st.customer_id, contact_phone: st.contact_phone, notes: st.no_notes ? 'Sin indicaciones' : (st.notes || ''), lines: [], order_discount: 0 };
      const errors = [];
      for (const l of st.lines) { try { G.orders.addLine(o, { variant_id: l.variant_id, qty: l.qty, est_weight_kg: l.est_weight_kg, cut_notes: l.cut_notes }, { noRecalc: true }); } catch (e) { errors.push(e.message); } }
      G.orders.recalc(o);
      const base = R(U.sum(o.lines, l => l.est_amount)); const pct = Number(st.discount_pct) || 0;
      o.order_discount = R(base * pct / 100); G.orders.recalc(o);
      return { o, errors, base, pct };
    };
    /* --- cliente --- */
    function drawCustomer() {
      G.ui.clear(custBox);
      const c = st.customer_id && D.get('customers', st.customer_id);
      if (c) {
        const credit = customerCredit(c.id);
        custBox.append(h('div', { class: 'row between' }, h('div', { style: 'min-width:0' }, h('b', null, c.trade_name || c.full_name), h('div', { class: 'muted small' }, `${c.doc_type !== 'NONE' ? c.doc_type + ' ' + c.doc_number + ' · ' : ''}${c.phone || 'sin celular'} · ${c.orders_count || 0} pedidos`)), btn('Cambiar', () => { st.customer_id = null; st.address_id = null; drawCustomer(); drawDelivery(); refresh(); }, { sm: true, kind: 'ghost' })),
          c.status === 'BLOCKED' ? notice(`Cliente bloqueado: ${c.blocked_reason || 'ver CLI'}. Solo con pago adelantado.`, 'bad') : null,
          credit > 0 ? notice(`Tiene ${money(credit)} de saldo a favor (CAJ): aplícalo al cobrar.`, 'info') : null,
          h('div', { class: 'form-grid' }, fld('Celular de contacto', inp('tel', st.contact_phone, v => { st.contact_phone = v; refresh(); }, { placeholder: '+51 9…' }), 'Si recibe otra persona, cambia el número.')));
        return;
      }
      const res = h('div', { class: 'stack', style: 'gap:4px' });
      const q = inp('search', '', v => find(v), { placeholder: 'Celular (9 dígitos), nombre o documento', attrs: { 'aria-label': 'Buscar cliente' }, inputmode: 'search' });
      function find(v) {
        G.ui.clear(res); const s = String(v || '').replace(/\s/g, '').toLowerCase(); if (s.length < 3) return;
        const hits = D.where('customers', x => x.status !== 'INACTIVE' && x.id !== 'cu-VARIOS' && ((x.phone || '').replace(/\s/g, '').includes(s) || (x.full_name || '').toLowerCase().includes(s) || (x.trade_name || '').toLowerCase().includes(s) || (x.doc_number || '').includes(s))).slice(0, 6);
        if (!hits.length) res.appendChild(h('span', { class: 'muted small' }, 'No hay clientes con ese dato. Créalo abajo.'));
        for (const x of hits) res.appendChild(btn(`${x.trade_name || x.full_name} · ${x.phone || '—'}`, () => choose(x), { sm: true }));
      }
      const nn = { name: '', phone: '+51', doc_type: 'DNI', doc: '' };
      const newErr = h('div', { class: 'err small', style: 'color:var(--bad)' });
      const newBox = h('div', { class: 'form-grid' },
        fld('Nombre completo', inp('text', '', v => { nn.name = v; })), fld('Celular', inp('tel', nn.phone, v => { nn.phone = v.replace(/\s/g, ''); })),
        fld('Documento', sel([['DNI', 'DNI'], ['RUC', 'RUC'], ['NONE', 'Sin documento']], nn.doc_type, v => { nn.doc_type = v; })), fld('Número', inp('text', '', v => { nn.doc = v.trim(); })),
        h('div', { class: 'span2 row' }, btn('Crear cliente', () => {
          newErr.textContent = '';
          if (nn.name.trim().length < 3) return (newErr.textContent = 'Escribe el nombre.');
          if (!U.phoneOk(nn.phone)) return (newErr.textContent = 'RN-CLI: el celular debe tener el formato +51 seguido de 9 dígitos.');
          if (nn.doc_type === 'DNI' && !U.dniOk(nn.doc)) return (newErr.textContent = 'El DNI tiene 8 dígitos.');
          if (nn.doc_type === 'RUC' && !U.rucOk(nn.doc)) return (newErr.textContent = 'RUC no válido (dígito verificador SUNAT).');
          if (D.find('customers', x => x.phone === nn.phone)) return (newErr.textContent = 'Ya existe un cliente con ese celular: búscalo arriba.');
          const row = { doc_type: nn.doc_type, doc_number: nn.doc_type === 'NONE' ? null : nn.doc, full_name: nn.name.trim(), phone: nn.phone, customer_type: nn.doc_type === 'RUC' ? 'BUSINESS' : 'PERSON', source_channel: st.channel, marketing_opt_in: false, status: 'ACTIVE', orders_count: 0 };
          const x = G.cli && typeof G.cli.create === 'function' ? G.cli.create(row) : D.insert('customers', row);
          toast('Cliente creado', 'ok'); choose(x);
        }, { sm: true, kind: 'primary' }), newErr));
      function choose(x) { st.customer_id = x.id; st.contact_phone = x.phone || ''; const a = D.find('customer_addresses', a => a.customer_id === x.id && a.is_default && a.status === 'ACTIVE'); st.address_id = a && a.zone_id !== 'dz-PROVINCIA' ? a.id : (a && st.fulfillment === 'PROVINCE_SHIPPING' ? a.id : null); if (a && a.zone_id === 'dz-PROVINCIA') { st.fulfillment = 'PROVINCE_SHIPPING'; st.address_id = a.id; } st.requested_doc_type = x.doc_type === 'RUC' ? 'INVOICE' : 'RECEIPT'; st.billing_customer_id = x.doc_type === 'RUC' ? x.id : null; drawCustomer(); drawDelivery(); drawPay(); refresh(); }
      custBox.append(q, res, h('details', null, h('summary', { class: 'small', style: 'cursor:pointer' }, 'Cliente nuevo'), newBox));
    }
    /* --- marca, canal y origen (RN-PED-16) --- */
    function drawOrigin() {
      G.ui.clear(originBox);
      const was = st.brand_id;
      const wa = D.where('messaging_channels', c => c.kind === 'WHATSAPP' && c.brand_id === st.brand_id);
      const ads = D.where('ad_ads', a => a.brand_id === st.brand_id && a.status === 'ACTIVE');
      originBox.appendChild(h('div', { class: 'form-grid' },
        fld('Marca', sel(brands.map(b => [b.id, G.brandName(b.id)]), st.brand_id, v => {
          st.brand_id = v;
          const other = st.lines.filter(l => (G.variant(l.variant_id) || {}).brand_id !== v);
          if (other.length) { st.lines = st.lines.filter(l => !other.includes(l)); toast(`RN-PED-02: se quitaron ${other.length} producto(s) de ${G.brandName(was)}. D-PED-01: un pedido por marca; crea otro pedido con la misma dirección.`, 'warn'); }
          st.origin_wa_number = null; st.origin_ad_code = null; drawOrigin(); drawLines(); refresh();
        })),
        fld('Canal', sel(G.CHANNELS.filter(c => !['COUNTER', 'CONSIGNMENT', 'OTHER'].includes(c[0])), st.channel, v => { st.channel = v; drawOrigin(); drawPay(); drawLines(); refresh(); })),
        st.channel === 'WHATSAPP' ? fld('Número de WhatsApp de origen', sel([['', '—'], ...wa.map(c => [c.number, `${c.display_name} · ${c.number}`])], st.origin_wa_number, v => { st.origin_wa_number = v || null; })) : null,
        ['WHATSAPP', 'WEB', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM'].includes(st.channel) ? fld('Código de anuncio', sel([['', 'Sin anuncio'], ...ads.map(a => [a.code, `${a.code} · ${a.name}`])], st.origin_ad_code, v => { st.origin_ad_code = v || null; }), 'RN-PED-16: desde CRM o la web se llena solo.') : null));
    }
    /* --- entrega --- */
    function drawDelivery() {
      G.ui.clear(deliveryBox);
      deliveryBox.appendChild(pills([['DELIVERY', 'Delivery'], ['PICKUP', 'Recojo en local'], ['PROVINCE_SHIPPING', 'Envío a provincia']], st.fulfillment, v => { st.fulfillment = v; if (v !== 'DELIVERY' && v !== 'PROVINCE_SHIPPING') st.address_id = null; if (v === 'PROVINCE_SHIPPING') { st.slot_id = null; const a = st.customer_id && D.find('customer_addresses', a => a.customer_id === st.customer_id && a.zone_id === 'dz-PROVINCIA' && a.status === 'ACTIVE'); st.address_id = a ? a.id : null; } if (v === 'DELIVERY' && st.customer_id) { const a = D.find('customer_addresses', a => a.customer_id === st.customer_id && a.is_default && a.zone_id !== 'dz-PROVINCIA' && a.status === 'ACTIVE'); st.address_id = a ? a.id : null; } drawDelivery(); drawSlots(); drawPay(); refresh(); }));
      if (st.fulfillment === 'PICKUP') {
        deliveryBox.appendChild(h('div', { class: 'form-grid' }, fld('Local de recojo', sel(D.where('establishments', e => e.status === 'ACTIVE').map(e => [e.id, `${e.short} · ${e.address}`]), st.pickup_establishment_id, v => { st.pickup_establishment_id = v; st.slot_id = null; drawSlots(); refresh(); }), 'El cliente recoge en la franja elegida; POS-12 lo entrega.', true)));
        return;
      }
      const prov = st.fulfillment === 'PROVINCE_SHIPPING';
      const addrs = st.customer_id ? D.where('customer_addresses', a => a.customer_id === st.customer_id && a.status === 'ACTIVE' && (prov ? a.zone_id === 'dz-PROVINCIA' : a.zone_id !== 'dz-PROVINCIA')) : [];
      if (!st.customer_id) deliveryBox.appendChild(h('div', { class: 'muted small' }, 'Elige el cliente para ver sus direcciones.'));
      else {
        deliveryBox.appendChild(fld(prov ? 'Dirección de destino' : 'Dirección', sel([['', addrs.length ? 'Elige una dirección' : 'Sin direcciones: registra una'], ...addrs.map(a => [a.id, `${a.label} · ${a.address_line}${a.zone_id ? ' · ' + G.zoneName(a.zone_id).split(' (')[0] : ''}`])], st.address_id, v => { st.address_id = v || null; st.slot_id = null; drawDelivery(); drawSlots(); refresh(); })));
        const a = st.address_id && D.get('customer_addresses', st.address_id);
        if (a) {
          const z = D.get('delivery_zones', a.zone_id);
          deliveryBox.appendChild(dl([['Referencia', a.reference || h('span', { style: 'color:var(--bad)' }, 'Falta la referencia (RN-PED-01)')], ['Pin', a.lat != null ? `${F.num(a.lat, 5)}, ${F.num(a.lng, 5)} (${a.pin_source || 'mapa'})` : h('span', { style: 'color:var(--bad)' }, 'Sin pin')], ['Zona', z ? `${z.name} · local ${G.siteName(z.establishment_id)}` : 'Fuera de cobertura'], ['Delivery', z ? (prov ? `${money(z.delivery_fee)} (agencia)` : `${money(z.delivery_fee)} · gratis desde ${z.free_from_units} u o ${z.free_from_kg} kg (RN-PED-09)`) : '—']]));
          if (!prov && a.lat != null) deliveryBox.appendChild(G.ui.map({ height: 200, points: [{ lat: a.lat, lng: a.lng, tone: 'bad', title: a.address_line }], highlightZone: a.zone_id }));
        }
        const na = { line: '', ref: '', label: prov ? 'Provincia' : 'Casa', lat: null, lng: null, zone: null };
        const pinInfo = h('div', { class: 'small muted' }, prov ? 'Pega las coordenadas del destino (Google Maps).' : 'Toca el mapa para poner el pin.');
        const nForm = h('div', { class: 'stack' },
          h('div', { class: 'form-grid' }, fld('Dirección', inp('text', '', v => { na.line = v; }, { placeholder: prov ? 'Calle, número, ciudad' : 'Av./Calle, número, distrito' })), fld('Referencia', inp('text', '', v => { na.ref = v; }, { placeholder: 'Frente a…, portón…' })),
            prov ? fld('Latitud', inp('number', '', v => { na.lat = v; }, { step: 'any' })) : null, prov ? fld('Longitud', inp('number', '', v => { na.lng = v; }, { step: 'any' })) : null),
          prov ? null : G.ui.map({ height: 220, onPick: (lat, lng, z) => { na.lat = lat; na.lng = lng; na.zone = z; pinInfo.textContent = z ? `Pin en ${z.name} · delivery ${money(z.delivery_fee)}` : 'Pin fuera de las zonas de reparto: no hay cobertura.'; } }),
          pinInfo,
          btn('Guardar dirección', () => {
            if (na.line.trim().length < 5) return toast('Escribe la dirección.', 'warn');
            if (!na.ref.trim()) return toast('RN-PED-01: la dirección lleva referencia.', 'warn');
            if (na.lat == null || na.lng == null) return toast('RN-PED-01: falta el pin de la dirección.', 'warn');
            if (!prov && !na.zone) return toast('RN-CLI: el pin está fuera de las zonas de reparto.', 'bad');
            const row = { customer_id: st.customer_id, label: na.label, address_line: na.line.trim(), reference: na.ref.trim(), lat: Number(na.lat), lng: Number(na.lng), zone_id: prov ? 'dz-PROVINCIA' : na.zone.id, contact_name: G.custName(st.customer_id), contact_phone: st.contact_phone, is_default: !addrs.length, status: 'ACTIVE', pin_source: prov ? 'COORDINATES' : 'MAP' };
            const x = G.cli && typeof G.cli.addAddress === 'function' ? G.cli.addAddress(row) : D.insert('customer_addresses', row);
            st.address_id = x.id; st.slot_id = null; toast('Dirección guardada con pin', 'ok'); drawDelivery(); drawSlots(); refresh();
          }, { sm: true, kind: 'primary' }));
        deliveryBox.appendChild(h('details', null, h('summary', { class: 'small', style: 'cursor:pointer' }, 'Nueva dirección con pin'), nForm));
      }
      if (prov) deliveryBox.appendChild(h('div', { class: 'form-grid' },
        fld('Agencia', sel([['', 'Elige la agencia'], ...agencies().map(s => [s.id, s.trade_name || s.legal_name])], st.province_agency, v => { st.province_agency = v || null; refresh(); })),
        fld('Destino (ciudad)', inp('text', st.province_destination, v => { st.province_destination = v; }, { placeholder: 'Arequipa, Cusco…' })),
        h('label', { class: 'check span2' }, (() => { const c = h('input', { type: 'checkbox', checked: !!st.thermal_packaging }); c.addEventListener('change', () => { st.thermal_packaging = c.checked; }); return c; })(), h('span', null, 'Embalaje térmico (caja isotérmica y gel refrigerante)')),
        h('div', { class: 'span2' }, notice('RN-PED-08: el envío a provincia se paga por adelantado (no contra entrega) y se despacha con guía de remisión y número de seguimiento.', 'info'))));
    }
    /* --- fecha y franja --- */
    function drawSlots() {
      G.ui.clear(slotBox);
      const dateIn = inp('date', st.delivery_date, v => { st.delivery_date = v; st.slot_id = null; drawSlots(); refresh(); }, { min: G.TODAY });
      slotBox.appendChild(h('div', { class: 'form-grid' }, fld(st.fulfillment === 'PROVINCE_SHIPPING' ? 'Fecha de despacho' : 'Fecha de entrega', dateIn)));
      if (st.fulfillment === 'PROVINCE_SHIPPING') { slotBox.appendChild(h('div', { class: 'muted small' }, 'El envío a provincia no usa franja: sale con la agencia en la fecha de despacho.')); return; }
      const p = prev().o;
      if (st.fulfillment === 'DELIVERY' && !p.zone_id) { slotBox.appendChild(h('div', { class: 'muted small' }, 'Elige la dirección con pin: las franjas dependen del local y la zona.')); return; }
      if (!st.delivery_date) return;
      const slots = slotsFor(p.establishment_id, p.zone_id, st.delivery_date);
      if (!slots.length) { slotBox.appendChild(empty('No hay franjas para ese día.')); return; }
      const use = usageMap();
      slotBox.appendChild(h('div', { class: 'ped-slots' }, slots.map(s => {
        const used = (use.get(s.id + '|' + st.delivery_date) || 0) - (editing && editing.slot_id === s.id && editing.delivery_date === st.delivery_date && ACTIVE_ST.includes(editing.status) ? 1 : 0);
        const full = used >= s.capacity, cut = slotCutPassed(s, st.delivery_date);
        const b = h('button', { type: 'button', class: 'ped-slot' + (st.slot_id === s.id ? ' on' : '') + (full || cut ? ' off' : ''), on: { click: () => { st.slot_id = s.id; drawSlots(); refresh(); } } },
          h('b', null, `${s.slot_from}–${s.slot_to}`), s.zone_id ? h('span', { class: 'small' }, G.zoneName(s.zone_id).split(' (')[0]) : null,
          h('span', { class: 'small' }, full ? `Llena ${used}/${s.capacity}` : `${used}/${s.capacity} · corte ${slotCut(s)}`), cut ? h('span', { class: 'small' }, 'Cerró por hora de corte') : null);
        return b;
      })), h('div', { class: 'muted small' }, 'D-PED-02: 3 franjas por día con 40 pedidos (valor provisional). Una franja llena o vencida no se confirma salvo con ped.slot.override (RN-PED-06).'));
    }
    /* --- productos --- */
    function drawLines() {
      G.ui.clear(linesBox);
      const p = prev();
      if (p.errors.length) linesBox.appendChild(notice(p.errors.join(' '), 'bad'));
      if (!st.lines.length) linesBox.appendChild(empty('Sin productos. Agrégalos del catálogo de la marca (PED-04): no existe el producto libre (RN-PED-02).'));
      else linesBox.appendChild(h('div', { class: 'stack', style: 'gap:8px' }, st.lines.map((l, i) => {
        const v = G.variant(l.variant_id) || {}; const pl = p.o.lines.find(x => x.variant_id === l.variant_id && x.qty === l.qty) || p.o.lines[i] || {};
        const kgIn = v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? inp('number', l.est_weight_kg, val => { l.est_weight_kg = val; l.estEdited = true; refresh(); }, { step: 0.001, min: 0, style: 'width:96px', attrs: { 'aria-label': 'Peso estimado' } }) : null;
        const qIn = inp('number', l.qty, val => { l.qty = val; if (v.sale_mode === 'UNIT_VARIABLE_WEIGHT' && !l.estEdited) { l.est_weight_kg = R((val || 0) * v.nominal_weight_kg, 3); if (kgIn) kgIn.value = l.est_weight_kg; } if (v.sale_mode === 'KG') l.est_weight_kg = val; refresh(); }, { step: v.qty_step || 1, min: v.min_order_qty || 0, style: 'width:80px', attrs: { 'aria-label': 'Cantidad' } });
        return h('div', { class: 'ped-line' },
          h('div', { style: 'min-width:0' }, h('b', null, v.name), h('div', { class: 'muted small' }, `${G.saleModeName(v.sale_mode)} · ${pl.unit_price != null ? money(pl.unit_price) + (pl.price_basis === 'KG' ? '/kg' : '') : 'sin precio'}${v.nominal_weight_kg ? ` · ≈ ${F.num(v.nominal_weight_kg, 3)} kg/u` : ''}`)),
          h('div', { class: 'row', style: 'gap:8px' }, h('label', { class: 'small muted' }, v.sale_mode === 'KG' ? 'kg' : 'Cant.'), qIn, kgIn ? h('label', { class: 'small muted' }, 'kg est.') : null, kgIn,
            inp('text', l.cut_notes, val => { l.cut_notes = val; }, { placeholder: 'Corte (entero, en presas…)', style: 'width:180px;max-width:100%', attrs: { 'aria-label': 'Corte' } }),
            h('span', { class: 'num', style: 'margin-left:auto' }, money(pl.est_amount)), btn('Quitar', () => { st.lines.splice(i, 1); drawLines(); refresh(); }, { sm: true, kind: 'ghost' })));
      })));
      linesBox.appendChild(h('div', { class: 'row' }, btn('Agregar productos (PED-04)', () => drawer(`Catálogo de ${G.brandName(st.brand_id)}`, (bd, close) => pickerNode({ brand_id: st.brand_id, channel: st.channel, customer_id: st.customer_id, establishment_id: prev().o.establishment_id, onAdd: (v, n) => {
        const ex = st.lines.find(x => x.variant_id === v.id); if (ex) { ex.qty = R(ex.qty + n, 3); if (v.sale_mode === 'UNIT_VARIABLE_WEIGHT' && !ex.estEdited) ex.est_weight_kg = R(ex.qty * v.nominal_weight_kg, 3); if (v.sale_mode === 'KG') ex.est_weight_kg = ex.qty; }
        else st.lines.push({ variant_id: v.id, qty: n, est_weight_kg: v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? R(n * v.nominal_weight_kg, 3) : v.sale_mode === 'KG' ? n : null, cut_notes: '' });
        toast(`${v.name} agregado`, 'ok'); drawLines(); drawSlots(); refresh();
      } }), { wide: true, code: 'PED-04' }), { kind: 'primary', icon: '+' })));
      // descuento
      const lim = discountLimit(G.ctx.role, st.brand_id);
      linesBox.appendChild(h('div', { class: 'form-grid' },
        fld('Descuento del pedido (%)', inp('number', st.discount_pct || '', v => { st.discount_pct = v || 0; refresh(); }, { min: 0, max: 100, step: 0.5 }), `RN-PED-11 · tu límite (${G.roleName()}): ${limitText(lim)}. Por encima queda por aprobar.`),
        fld('Motivo del descuento', inp('text', st.discount_reason, v => { st.discount_reason = v; }, { placeholder: 'Cliente frecuente, reclamo anterior…' }))));
    }
    /* --- pago, comprobante y notas --- */
    function drawPay() {
      G.ui.clear(payBox);
      const pms = D.where('payment_methods', p => p.status === 'ACTIVE' && (st.channel === 'B2B' || p.id !== 'pm-CREDIT') && (st.fulfillment !== 'PROVINCE_SHIPPING' || PREPAID.includes(p.id)));
      const bc = st.billing_customer_id && D.get('customers', st.billing_customer_id);
      const ruc = { v: bc ? bc.doc_number : '', name: bc ? bc.full_name : '' };
      const rucMsg = h('div', { class: 'small' });
      payBox.appendChild(h('div', { class: 'form-grid' },
        fld('Forma de pago', sel([['', 'Elige'], ...pms.map(p => [p.id, p.name + (p.allowed_on_delivery && !PREPAID.includes(p.id) ? ' (contra entrega)' : '')])], st.payment_method_id, v => { st.payment_method_id = v || null; refresh(); }), st.fulfillment === 'PROVINCE_SHIPPING' ? 'RN-PED-08: solo pago adelantado.' : null),
        fld('Comprobante', pills([['RECEIPT', 'Boleta'], ['INVOICE', 'Factura']], st.requested_doc_type, v => { st.requested_doc_type = v; if (v === 'INVOICE' && !st.billing_customer_id) { const c = D.get('customers', st.customer_id); if (c && c.doc_type === 'RUC') st.billing_customer_id = c.id; } drawPay(); refresh(); })),
        st.requested_doc_type === 'INVOICE' ? fld('RUC de facturación', inp('text', ruc.v, v => { ruc.v = v.trim(); }, { placeholder: '20…', inputmode: 'numeric' })) : null,
        st.requested_doc_type === 'INVOICE' ? fld('Razón social', inp('text', ruc.name, v => { ruc.name = v; }, { placeholder: 'Si el RUC es nuevo' })) : null,
        st.requested_doc_type === 'INVOICE' ? h('div', { class: 'span2 row' }, btn('Usar este RUC', () => {
          if (!U.rucOk(ruc.v)) { rucMsg.textContent = 'RN-PED-01: RUC no válido (dígito verificador SUNAT).'; rucMsg.style.color = 'var(--bad)'; return; }
          let c = D.find('customers', x => x.doc_type === 'RUC' && x.doc_number === ruc.v);
          if (!c) { if (ruc.name.trim().length < 3) { rucMsg.textContent = 'RUC nuevo: escribe la razón social.'; rucMsg.style.color = 'var(--bad)'; return; } c = D.insert('customers', { doc_type: 'RUC', doc_number: ruc.v, full_name: ruc.name.trim().toUpperCase(), customer_type: 'BUSINESS', status: 'ACTIVE', source_channel: st.channel, doc_validation_source: 'SUNAT', doc_validated_at: G.date.now() }); }
          st.billing_customer_id = c.id; toast(`Factura a ${c.full_name}`, 'ok'); drawPay(); refresh();
        }, { sm: true }), bc ? h('span', { class: 'small' }, `Factura a ${bc.full_name} · RUC ${bc.doc_number} ${U.rucOk(bc.doc_number) ? '(válido)' : '(no válido)'}`) : null, rucMsg) : null,
        fld('Notas de preparación', (() => { const t = h('textarea', { class: 'input', placeholder: 'Corte, limpieza, empaque, indicaciones para el repartidor…', rows: 2 }, st.notes || ''); t.addEventListener('input', () => { st.notes = t.value; refresh(); }); t.disabled = st.no_notes; return t; })(), null, true),
        h('label', { class: 'check span2' }, (() => { const c = h('input', { type: 'checkbox', checked: !!st.no_notes }); c.addEventListener('change', () => { st.no_notes = c.checked; drawPay(); refresh(); }); return c; })(), h('span', null, 'Sin indicaciones'))));
    }
    /* --- resumen en vivo --- */
    function refresh() {
      const p = prev(); const o = p.o;
      G.ui.clear(sumBox); G.ui.clear(missBox);
      const lim = discountLimit(G.ctx.role, st.brand_id);
      const over = p.pct > 0 && overLimit(lim, p.pct, o.order_discount);
      sumBox.appendChild(dl([['Marca', G.brandName(st.brand_id)], ['Productos', `${o.lines.length} línea(s) · ${F.num(o.units, 0)} u · ${F.num(o.est_kg, 3)} kg est.`], ['Subtotal', money(p.base)], ['Descuento', o.order_discount ? `−${money(o.order_discount)} (${F.num(p.pct, 1)} %)` : '—'], ['Delivery', ['DELIVERY', 'PROVINCE_SHIPPING'].includes(o.fulfillment) ? (o.zone_id ? (o.delivery_fee ? money(o.delivery_fee) : 'Gratis (RN-PED-09)') : '—') : 'No aplica'], ['Total estimado', h('b', { class: 'num' }, money(o.estimated_total))]]));
      if (o.lines.some(l => l.price_basis === 'KG')) sumBox.appendChild(h('div', { class: 'muted small' }, 'Por peso: se cobra con el peso real (RN-PED-04).'));
      const missing = G.orders.missing(o);
      missBox.appendChild(missingList(missing));
      const blocks = [];
      if (over) blocks.push(`RN-PED-11: ${F.num(p.pct, 1)} % (${money(o.order_discount)}) supera tu límite (${limitText(lim)}): quedará por aprobar.${st.discount_reason ? '' : ' Escribe el motivo.'}`);
      try { checkSlot(o, { strict: true }); } catch (e) { blocks.push(e.message); }
      if (o.fulfillment === 'PROVINCE_SHIPPING' && o.payment_method_id && !PREPAID.includes(o.payment_method_id)) blocks.push('RN-PED-08: provincia solo con pago adelantado.');
      if (o.lines.length) { const sh = stockShort(o); if (sh.length) blocks.push(`RN-PED-17: sin stock disponible de ${sh.map(s => G.variantName(s.variant_id)).join(', ')}.`); }
      if (blocks.length) missBox.appendChild(h('div', { class: 'stack', style: 'gap:6px' }, blocks.map(b => notice(b, 'warn'))));
    }
    function save(andConfirm) {
      try {
        if (!st.customer_id && !st.lines.length) return toast('Elige al menos el cliente o un producto para guardar el borrador.', 'warn');
        const o = saveDraft(st, editing ? editing.id : null);
        if (andConfirm) tryConfirm(o, {}, () => G.go('PED-03', { id: o.id }));
        else { toast(`Borrador ${o.number} guardado`, 'ok'); G.go('PED-03', { id: o.id }); }
        if (andConfirm && o.status === 'DRAFT') { /* confirmación rechazada: queda el borrador */ G.nav.params = { id: o.id }; }
      } catch (e) { if (!isRule(e)) console.error(e); toast(e.message, 'bad'); }
    }
    left.append(card('1. Cliente', custBox), card('2. Marca, canal y origen', originBox), card('3. Entrega', deliveryBox), card('4. Fecha y franja', slotBox), card('5. Productos y descuento', linesBox), card('6. Pago, comprobante y notas', payBox));
    right.append(card('Resumen', sumBox), card('Datos que faltan (RN-PED-01)', missBox),
      h('div', { class: 'stack' }, btn('Guardar y confirmar', () => save(true), { kind: 'primary', disabled: !G.can('ped.order.confirm') }), btn('Guardar borrador', () => save(false)), editing ? btn('Volver al detalle', () => G.go('PED-03', { id: editing.id }), { kind: 'ghost' }) : null));
    drawCustomer(); drawOrigin(); drawDelivery(); drawSlots(); drawLines(); drawPay(); refresh();
  }

  /* ---------- PED-03 Detalle del pedido ---------- */
  function defaultOrder() {
    const os = visibleOrders(o => o.delivery_date === G.TODAY || o.created_at.slice(0, 10) === G.TODAY);
    return os.find(o => o.weight_diff_status === 'NOTICE_REQUIRED') || os.find(o => o.status === 'WEIGHED') || os.find(o => o.status === 'CONFIRMED') || os[0] || visibleOrders()[0];
  }
  function weighDrawer(o) {
    drawer(`Registrar peso real · ${o.number}`, (bd, close) => {
      bd.appendChild(notice(`RN-PED-04: importe = peso real × precio por kg. RN-PED-05: si la diferencia supera la tolerancia de la línea (${G.param('ped_weight_tolerance_pct') ?? 10} % por defecto) el pedido queda «aviso requerido».`, 'info'));
      for (const l of o.lines.filter(x => x.price_basis === 'KG')) {
        const v = G.variant(l.variant_id);
        const out = h('span', { class: 'small' });
        const i = inp('number', l.weighed_kg ?? '', val => { if (val > 0) { const d = (val - l.est_weight_kg) / l.est_weight_kg * 100; const tol = l.tolerance_pct ?? G.param('ped_weight_tolerance_pct') ?? 10; out.textContent = `${d > 0 ? '+' : ''}${F.num(d, 1)} % · ${money(R(val * l.unit_price * (1 - (l.discount_pct || 0) / 100)))} · ${Math.abs(d) > tol ? 'sobre la tolerancia: aviso requerido' : 'dentro de la tolerancia'}`; out.style.color = Math.abs(d) > tol ? 'var(--warn)' : 'var(--ok)'; } }, { step: 0.001, min: 0, style: 'width:120px' });
        bd.appendChild(card(v.name, h('div', { class: 'stack' }, h('div', { class: 'muted small' }, `${F.num(l.qty, 0)} ${v.sale_mode === 'KG' ? 'kg pedidos' : 'u'} · estimado ${kg3(l.est_weight_kg)} · ${money(l.unit_price)}/kg · tolerancia ${l.tolerance_pct ?? G.param('ped_weight_tolerance_pct') ?? 10} %`), h('div', { class: 'row' }, i, h('span', null, 'kg'), btn('Registrar', () => act(() => weigh(o, l.id, i.value, 'MANUAL'), 'Peso registrado', r => { close(); G.refresh(); }), { sm: true, kind: 'primary' })), out)));
      }
    });
  }
  function payDrawer(o) {
    drawer(`Registrar pago · ${o.number}`, (bd, close) => {
      const bal = balOf(o);
      bd.appendChild(dl([['Total', money(total(o))], ['Pagado', money(o.paid_amount || 0)], ['Saldo', money(-bal)]]));
      bd.appendChild(G.ui.form({ id: 'pedpay', fields: [
        { key: 'pm', label: 'Medio', type: 'select', required: true, options: D.where('payment_methods', p => p.status === 'ACTIVE' && p.id !== 'pm-CREDIT').map(p => [p.id, p.name]) },
        { key: 'amount', label: 'Monto', type: 'money', required: true, min: 0.01 },
        { key: 'reference', label: 'Número de operación', type: 'text', help: 'RN-CAJ-02: obligatorio para Yape, Plin, transferencia y tarjeta.' },
        { key: 'last4', label: 'Tarjeta: 4 últimos dígitos', type: 'text' },
      ], values: { pm: o.payment_method_id || 'pm-YAPE', amount: R(Math.max(0, -bal)) }, submitLabel: 'Registrar pago', onSubmit: v => {
        if (v.pm === 'pm-CARD' && !/^\d{4}$/.test(v.last4 || '')) return { last4: 'Indica los 4 últimos dígitos.' };
        if (v.pm === 'pm-CARD' && !v.reference) return { reference: 'Indica el número de operación del POS.' };
        G.pay.register({ customer_id: o.customer_id, payment_method_id: v.pm, amount: v.amount, reference: v.reference, allocations: [{ order_id: o.id, document_id: (D.find('sales_documents', d => d.order_id === o.id && d.doc_type !== 'CREDIT_NOTE') || {}).id || null, amount: v.amount }], brand_id: o.brand_id, establishment_id: o.establishment_id, card_last4: v.last4 || null });
        toast('Pago registrado', 'ok'); close(); G.refresh(); return true;
      } }));
    });
  }
  function renderDetail(el, params) {
    const o = params.id ? order(params.id) : defaultOrder();
    if (!o) { const b = page(el, { code: 'PED-03', title: 'Detalle del pedido', sub: 'Datos, líneas, totales, pagos, comprobantes e historial.' }); b.appendChild(empty('No hay pedidos en tu alcance.')); return; }
    const e = G.canDo('PED', 'E');
    const acts = [];
    if (o.status === 'DRAFT' && e) acts.push({ label: 'Editar', onClick: () => G.go('PED-02', { id: o.id }) }, { label: 'Confirmar', kind: 'primary', onClick: () => tryConfirm(o), disabled: !G.can('ped.order.confirm') });
    if (['DRAFT', 'CONFIRMED'].includes(o.status)) acts.push({ label: 'Resumen al cliente', onClick: () => G.go('PED-05', { id: o.id }) });
    if (o.status === 'CONFIRMED' && e) acts.push({ label: 'Volver a borrador', onClick: () => act(() => G.orders.transition(o, 'DRAFT', { reason: 'Corrección antes de preparar' }), 'Pedido vuelto a borrador; reservas liberadas') }, { label: 'Pasar a preparación', onClick: () => act(() => G.orders.transition(o, 'IN_PREPARATION', { reason: 'Manual' }), 'En preparación') });
    if (['IN_PREPARATION', 'WEIGHED'].includes(o.status) && o.lines.some(l => l.price_basis === 'KG') && e) acts.push({ label: 'Registrar peso', onClick: () => weighDrawer(o) });
    if (['IN_PREPARATION', 'WEIGHED'].includes(o.status) && e) acts.push({ label: 'Pasar a LISTO', kind: 'primary', onClick: () => act(() => G.orders.transition(o, 'READY'), 'Pedido listo') });
    if (o.weight_diff_status === 'NOTICE_REQUIRED') acts.push({ label: 'Avisar diferencia de peso', kind: 'accent', onClick: () => G.go('PED-07', { id: o.id }) });
    if (o.status === 'READY' && e && ['DELIVERY', 'PROVINCE_SHIPPING'].includes(o.fulfillment)) acts.push({ label: 'Despachar', onClick: () => act(() => G.orders.transition(o, 'IN_ROUTE', { reason: 'Despacho' }), 'Pedido en ruta') });
    if (o.status === 'READY' && o.fulfillment === 'PICKUP') acts.push({ label: 'Entregar en mostrador (POS-12)', onClick: () => G.screens['POS-12'] ? G.go('POS-12', { id: o.id }) : act(() => G.orders.transition(o, 'DELIVERED', { reason: 'Recojo' }), 'Entregado') });
    if (o.status === 'IN_ROUTE' && e) acts.push({ label: 'Entregado', kind: 'primary', onClick: () => act(() => G.orders.transition(o, 'DELIVERED', { reason: 'Entrega registrada' }), 'Pedido entregado') }, { label: 'No entregado', kind: 'danger', onClick: () => G.go('PED-09', { id: o.id }) });
    if (RESCHEDULABLE.includes(o.status) && e) acts.push({ label: 'Reprogramar', onClick: () => G.go('PED-08', { id: o.id }) });
    if (['DRAFT', 'CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'NOT_DELIVERED'].includes(o.status) && e) acts.push({ label: 'Cancelar', kind: 'danger', onClick: () => G.go('PED-09', { id: o.id }) });
    if (!['CANCELLED', 'CLOSED', 'DRAFT'].includes(o.status) && balOf(o) < -0.005 && G.canSee('CAJ')) acts.push({ label: 'Registrar pago', onClick: () => payDrawer(o) });
    if (['DELIVERED', 'CLOSED', 'CANCELLED'].includes(o.status) && Math.abs(balOf(o)) >= 0.005) acts.push({ label: 'Saldo (PED-12)', onClick: () => G.go('PED-12', { id: o.id }) });
    if (o.status === 'DELIVERED' && e) acts.push({ label: 'Cerrar', kind: 'primary', onClick: () => act(() => closeOrder(o), 'Pedido cerrado') });
    const body = page(el, { code: 'PED-03', title: `Pedido ${o.number}`, sub: `${G.custName(o.customer_id)} · ${G.brandFull(o.brand_id)} · ${G.channelName(o.channel)} · ${G.fulfillName(o.fulfillment)}`, actions: acts });
    if (!params.id) body.appendChild(card('Abrir otro pedido', orderPicker(x => G.go('PED-03', { id: x.id }))));
    body.appendChild(h('div', { class: 'row between' }, stepsNode(o), h('div', { class: 'row' }, status(o.status), dBadge(o.discount_status), o.lines.some(l => l.price_basis === 'KG') ? wBadge(o.weight_diff_status) : null)));
    const missing = G.orders.missing(o);
    if (o.status === 'DRAFT' && missing.length) body.appendChild(notice([h('b', null, 'RN-PED-01 · Faltan para confirmar: '), missing.map(c => MISSING_LABEL[c] || c).join(' · ')], 'warn'));
    if (o.status !== 'DRAFT' && !['CANCELLED', 'CLOSED'].includes(o.status) && missing.length) body.appendChild(notice(`Importado o creado antes de la regla: le falta ${missing.join(', ')} (vista de incompletos).`, 'warn'));
    if (o.needs_production) body.appendChild(notice(`RN-PED-17: confirmado sin stock disponible; marcado para producción o compra (${(o.stock_short || []).map(s => `${G.variantName(s.variant_id)} ${F.num(s.qty, 3)}`).join(', ')}).`, 'bad'));
    if (o.weight_diff_status === 'NOTICE_REQUIRED') body.appendChild(notice('RN-PED-05: la diferencia de peso supera la tolerancia. El pedido no pasa a LISTO hasta registrar el aviso al cliente (PED-07).', 'warn'));
    if (o.status === 'CANCELLED') body.appendChild(notice(`Cancelado el ${F.datetime(o.cancelled_at)}: ${o.cancel_reason || '—'}`, 'bad'));
    if (o.status === 'NOT_DELIVERED') body.appendChild(notice(`No entregado: ${(o.history.slice().reverse().find(x => x.to === 'NOT_DELIVERED') || {}).reason || '—'}. Reprograma (PED-08) o cancela con motivo (PED-09).`, 'bad'));
    const a = D.get('customer_addresses', o.address_id);
    const c = D.get('customers', o.customer_id) || {};
    const s = D.get('order_time_slots', o.slot_id);
    body.appendChild(h('div', { class: 'grid c2' },
      card('Cliente y entrega', dl([['Cliente', `${c.trade_name || c.full_name || '—'}${c.doc_number ? ' · ' + c.doc_type + ' ' + c.doc_number : ''}`], ['Celular de contacto', o.contact_phone || '—'],
        ['Entrega', G.fulfillName(o.fulfillment)], o.fulfillment === 'PICKUP' ? ['Local de recojo', G.siteName(o.pickup_establishment_id)] : ['Dirección', a ? `${a.address_line} · Ref.: ${a.reference || '—'}` : '—'],
        ['Zona y local', `${o.zone_id ? G.zoneName(o.zone_id) : '—'} · ${G.siteName(o.establishment_id)}`], ['Fecha y franja', `${F.date(o.delivery_date)} · ${s ? slotName(s) : slotText(o)}`],
        ['Comprobante', `${G.docTypeName(o.requested_doc_type)}${o.requested_doc_type === 'INVOICE' ? ' · ' + G.custName(o.billing_customer_id) : ''}`], ['Forma de pago', G.pmName(o.payment_method_id)], ['Notas de preparación', o.notes || '—'],
        o.fulfillment === 'PROVINCE_SHIPPING' ? ['Provincia', `${G.supName(o.province_agency)} · ${o.province_destination || '—'} · ${o.thermal_packaging ? 'embalaje térmico' : 'sin embalaje térmico'} · guía ${o.dispatch_guide_number || '—'} · seguimiento ${o.tracking_number || '—'}`] : null])),
      card('Origen y venta (RN-PED-16)', dl([['Canal', G.channelName(o.channel)], ['Vendedora', o.seller_id ? G.userName(o.seller_id) : (o.channel === 'WEB' ? 'Tienda web' : '—')], ['WhatsApp de origen', o.origin_wa_number || '—'], ['Anuncio', o.origin_ad_code || '—'], ['UTM', o.origin_utm ? `${o.origin_utm.source} / ${o.origin_utm.medium} / ${o.origin_utm.campaign}` : '—'], ['Referencia externa', o.external_ref || '—'],
        ['Creado', F.datetime(o.created_at)], ['Confirmado', F.datetime(o.confirmed_at)], ['Confirmó el cliente', o.customer_confirmed_at ? `${F.datetime(o.customer_confirmed_at)} · ${o.confirmation_channel || ''}` : 'Pendiente (PED-05)'], ['Repartidor', o.driver_user_id ? G.userName(o.driver_user_id) : '—']]))));
    // líneas
    const wd = weightDiff(o);
    body.appendChild(card('Productos', table({ id: 'ped03l:' + o.id, search: false, columns: [
      { key: 'p', label: 'Producto', value: l => G.variantName(l.variant_id), render: l => h('div', null, h('div', null, G.variantName(l.variant_id)), l.cut_notes ? h('div', { class: 'muted small' }, 'Corte: ' + l.cut_notes) : null) },
      { key: 'qty', label: 'Cant.', align: 'r', render: l => F.num(l.qty, l.price_basis === 'KG' && (G.variant(l.variant_id) || {}).sale_mode === 'KG' ? 3 : 0) },
      { key: 'unit_price', label: 'Precio', align: 'r', render: l => money(l.unit_price) + (l.price_basis === 'KG' ? '/kg' : '') },
      { key: 'est', label: 'Peso est.', align: 'r', render: l => l.price_basis === 'KG' ? kg3(l.est_weight_kg) : '—' },
      { key: 'real', label: 'Peso real', align: 'r', render: l => l.price_basis === 'KG' ? (l.weighed_kg != null ? kg3(l.weighed_kg) : badge('Sin pesar', '')) : '—' },
      { key: 'dif', label: 'Dif.', align: 'r', render: l => { if (l.price_basis !== 'KG' || l.weighed_kg == null) return '—'; const d = (l.weighed_kg - l.est_weight_kg) / l.est_weight_kg * 100; const tol = l.tolerance_pct ?? G.param('ped_weight_tolerance_pct') ?? 10; return h('span', { style: Math.abs(d) > tol ? 'color:var(--warn);font-weight:700' : '' }, `${d > 0 ? '+' : ''}${F.num(d, 1)} %`); } },
      { key: 'disc', label: 'Desc.', align: 'r', render: l => l.discount_pct ? F.pct(l.discount_pct) : '—' },
      { key: 'est_amount', label: 'Importe est.', align: 'r', render: l => money(l.est_amount) },
      { key: 'final_amount', label: 'Importe final', align: 'r', render: l => l.final_amount != null ? money(l.final_amount) : '—' },
    ], rows: o.lines, footer: ['Total', '', '', wd.est ? kg3(wd.est) : '', wd.real ? kg3(wd.real) : '', wd.est ? `${wd.pct > 0 ? '+' : ''}${F.num(wd.pct, 1)} %` : '', '', money(o.estimated_total), o.final_total != null ? money(o.final_total) : '—'].map((v, i) => i >= 1 ? { v, align: 'r' } : v) }), { flush: true }));
    const pays = D.where('payments', p => (p.allocations || []).some(x => x.order_id === o.id));
    const docs = D.where('sales_documents', d => d.order_id === o.id);
    const bal = balOf(o);
    body.appendChild(h('div', { class: 'grid c2' },
      card('Totales', dl([['Subtotal', money(R(U.sum(o.lines, l => l.est_amount)))], ['Descuento del pedido', o.order_discount ? h('span', null, `−${money(o.order_discount)} (${F.num(o.order_discount_pct || 0, 1)} %) `, dBadge(o.discount_status)) : '—'], ['Delivery', money(o.delivery_fee || 0)], ['Total estimado', money(o.estimated_total)], ['Total final', o.final_total != null ? h('b', null, money(o.final_total)) : 'Hasta pesar todas las líneas por kg'], ['Pagado', money(o.paid_amount || 0)],
        ['Saldo', h('span', { style: Math.abs(bal) >= 0.005 ? 'font-weight:700;color:' + (bal > 0 ? 'var(--ok)' : 'var(--bad)') : '' }, Math.abs(bal) < 0.005 ? 'Sin saldo' : bal > 0 ? `A favor del cliente ${money(bal)}` : `Por cobrar ${money(-bal)}`)], o.balance_mode ? ['Decisión del saldo', `${BMODE[o.balance_mode]} · ${o.balance_decided_by_name || ''} ${F.datetime(o.balance_decided_at)}`] : null])),
      card('Pagos, comprobantes y guía', h('div', { class: 'stack' },
        pays.length ? h('div', { class: 'stack', style: 'gap:4px' }, pays.map(p => h('div', { class: 'row between' }, h('span', { class: 'small' }, `${p.number} · ${G.pmName(p.payment_method_id)}${p.reference ? ' · op. ' + p.reference : ''}${p.card_last4 ? ' · ****' + p.card_last4 : ''} · ${F.datetime(p.paid_at)}`), h('b', { class: 'num' }, money((p.allocations.find(x => x.order_id === o.id) || {}).amount))))) : h('div', { class: 'muted small' }, 'Sin pagos aplicados.'),
        docs.length ? h('div', { class: 'stack', style: 'gap:4px' }, docs.map(d => h('div', { class: 'row between' }, h('span', { class: 'small' }, `${G.docs.label(d)} · ${F.date(d.issue_date)} `, status(d.sunat_status)), h('b', { class: 'num' }, money(d.total))))) : h('div', { class: 'muted small' }, 'Sin comprobante (FAC lo emite al entregar).'),
        o.dispatch_guide_number ? h('div', { class: 'small' }, `Guía de remisión ${o.dispatch_guide_number}`) : null,
        o.status === 'DELIVERED' && !docs.length && G.canDo('FAC', 'C') ? btn('Emitir comprobante', () => act(() => G.docs.fromOrder(o, { accept: true }), 'Comprobante emitido'), { sm: true }) : null))));
    // historial, reprogramaciones y avisos
    const resch = D.where('order_reschedules', r => r.order_id === o.id);
    const notices = D.where('order_weight_notices', n => n.order_id === o.id);
    const msgs = D.where('messages', m => m.ref === o.id);
    const appr = D.where('order_discount_approvals', x => x.order_id === o.id);
    body.appendChild(h('div', { class: 'grid c2' },
      card('Historial de estados (RN-PED-03)', h('div', { class: 'timeline' }, (o.history || []).map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.datetime(x.at)), h('span', { class: 'dot' }), h('div', null, h('b', null, x.from ? `${G.ui.statusLabel(x.from)} → ${G.ui.statusLabel(x.to)}` : `Creado en ${G.ui.statusLabel(x.to).toLowerCase()}`), h('div', { class: 'muted small' }, `${x.user || ''}${x.reason ? ' · ' + x.reason : ''}`)))))),
      card('Reprogramaciones, descuentos y avisos al cliente', h('div', { class: 'stack' },
        h('div', { class: 'small' }, `Reprogramado ${o.reschedule_count || 0} de ${G.param('ped_max_reschedules') ?? 2} veces que puede la vendedora (RN-PED-14).`),
        resch.map(r => h('div', { class: 'small' }, `${F.datetime(r.at)} · ${F.date(r.old_date)} ${r.old_slot_from || ''} → ${F.date(r.new_date)} ${r.new_slot_from || ''} · ${r.reason} · ${r.rescheduled_by_name || ''}`)),
        appr.map(x => h('div', { class: 'small' }, `Descuento ${F.num(x.requested_pct, 1)} % (${money(x.requested_amount)}) pedido por ${x.requested_by_name}: `, status(x.status), x.decided_by_name ? ` · ${x.decided_by_name}` : '')),
        notices.map(n => h('div', { class: 'small' }, `Aviso de peso ${F.datetime(n.sent_at)} por ${n.channel === 'PHONE' ? 'teléfono' : 'WhatsApp'} · ${n.diff_pct > 0 ? '+' : ''}${F.num(n.diff_pct, 1)} % · respuesta: ${{ PENDING: 'pendiente', ACCEPTED: 'aceptó', REJECTED: 'rechazó', NO_RESPONSE: 'sin respuesta' }[n.customer_response]}`)),
        msgs.length ? h('div', { class: 'chat' }, msgs.map(m => h('div', { class: 'msg out' }, m.text, h('span', { class: 'meta' }, `${F.datetime(m.sent_at)} · ${m.kind === 'UTILITY' ? 'plantilla de utilidad ' + money(m.cost) : 'mensaje de sesión (gratis)'}`)))) : h('div', { class: 'muted small' }, 'Sin mensajes enviados desde el pedido.')))));
  }

  /* ---------- PED-05 Confirmación con el cliente ---------- */
  function renderConfirm(el, params) {
    const body = page(el, { code: 'PED-05', title: 'Confirmación con el cliente', sub: 'Resumen listo para WhatsApp en un solo mensaje (RN-PED-12) o para leer por teléfono; registra cuándo y por qué canal confirmó el cliente.' });
    const pend = visibleOrders(o => ['DRAFT', 'CONFIRMED'].includes(o.status) && !o.customer_confirmed_at && (o.delivery_date || G.TODAY) >= G.TODAY && (o.lines || []).length);
    const o = params.id ? order(params.id) : pend[0];
    body.appendChild(kpis([{ label: 'Por confirmar con el cliente', value: F.num(pend.length), tone: pend.length ? 'warn' : 'ok' }, { label: 'Resúmenes enviados hoy', value: F.num(visibleOrders(x => (x.summary_sent_at || '').slice(0, 10) === G.TODAY).length) }, { label: 'Costo de una plantilla de utilidad', value: money(G.msg.cost('UTILITY')), sub: 'Gratis dentro de la ventana de 24 h' }]));
    const grid = h('div', { class: 'grid side-r' });
    const main = h('div', { class: 'stack', style: 'min-width:0' });
    const side = h('div', { class: 'stack', style: 'min-width:0' });
    grid.append(main, side); body.appendChild(grid);
    side.appendChild(card('Pendientes', h('div', { class: 'stack', style: 'gap:6px' }, pend.slice(0, 12).map(x => btn(`${x.number} · ${G.custName(x.customer_id)} · ${G.ui.statusLabel(x.status)}`, () => G.go('PED-05', { id: x.id }), { sm: true, kind: o && x.id === o.id ? 'primary' : '' })), pend.length > 12 ? h('span', { class: 'muted small' }, `y ${pend.length - 12} más`) : null, orderPicker(x => G.go('PED-05', { id: x.id }), x => ['DRAFT', 'CONFIRMED'].includes(x.status)))));
    if (!o) { main.appendChild(empty('No hay pedidos por confirmar con el cliente.')); return; }
    const text = summary(o);
    const used = utilityCount(o);
    let win = o.channel === 'WHATSAPP' && (o.created_at || '').slice(0, 10) >= G.date.add(G.TODAY, -1);
    const winBox = h('label', { class: 'check' }, (() => { const c = h('input', { type: 'checkbox', checked: win }); c.addEventListener('change', () => { win = c.checked; costEl.textContent = `Costo: ${money(G.msg.cost(win ? 'SESSION' : 'UTILITY', { inServiceWindow: win }))}`; }); return c; })(), h('span', null, 'El cliente escribió en las últimas 24 h (ventana de servicio: mensaje gratis)'));
    const costEl = h('span', { class: 'small muted' }, `Costo: ${money(G.msg.cost(win ? 'SESSION' : 'UTILITY', { inServiceWindow: win }))}`);
    main.appendChild(card(`Resumen de ${o.number}`, h('div', { class: 'stack' },
      h('div', { class: 'row' }, status(o.status), o.summary_sent_at ? badge(`Enviado ${F.datetime(o.summary_sent_at)}`, 'info') : badge('Sin enviar', ''), o.customer_confirmed_at ? badge(`Cliente confirmó ${F.datetime(o.customer_confirmed_at)} · ${o.confirmation_channel}`, 'ok') : badge('Cliente sin confirmar', 'warn')),
      h('div', { class: 'chat' }, h('div', { class: 'msg out' }, text, h('span', { class: 'meta' }, `Para ${o.contact_phone || '—'} · ${G.brandName(o.brand_id)} · un solo mensaje (RN-PED-12)`))),
      winBox, h('div', { class: 'row' }, costEl, h('span', { class: 'small muted' }, `Plantillas de utilidad usadas en este pedido: ${used} de 2 (RN-CRM-07)`)),
      h('div', { class: 'row' },
        btn('Enviar por WhatsApp', () => act(() => sendSummary(o, { channel: 'WHATSAPP', inServiceWindow: win }), 'Resumen enviado por WhatsApp'), { kind: 'primary', disabled: !o.contact_phone }),
        btn('Copiar texto', () => { try { navigator.clipboard.writeText(text); toast('Texto copiado', 'ok'); } catch (e) { toast('No se pudo copiar en este navegador.', 'warn'); } }),
        btn('Lo leí por teléfono', () => act(() => sendSummary(o, { channel: 'PHONE' }), 'Lectura por teléfono registrada'))))));
    main.appendChild(card('Registrar la confirmación del cliente', h('div', { class: 'row' },
      ['WHATSAPP', 'PHONE', 'WEB'].map(ch => btn(`Confirmó por ${{ WHATSAPP: 'WhatsApp', PHONE: 'teléfono', WEB: 'la web' }[ch]}`, () => act(() => customerConfirmed(o, ch), 'Confirmación del cliente registrada'), { sm: true })),
      o.status === 'DRAFT' ? btn('Confirmar el pedido', () => tryConfirm(o), { kind: 'primary', sm: true }) : null, btn('Ver pedido', () => G.go('PED-03', { id: o.id }), { sm: true, kind: 'ghost' }))));
  }

  /* ---------- PED-06 Franjas de entrega ---------- */
  const slot6 = { site: 'es-L1' };
  function slotForm(s, close) {
    return G.ui.form({ id: 'ped06', fields: [
      { key: 'establishment_id', label: 'Local', type: 'select', required: true, options: [['es-L1', 'Local 1'], ['es-L2', 'Local 2']] },
      { key: 'zone_id', label: 'Zona (vacío = todas las del local)', type: 'select', options: D.where('delivery_zones', z => !z.province).map(z => [z.id, z.name]) },
      { key: 'slot_from', label: 'Desde', type: 'text', required: true, placeholder: '09:00' }, { key: 'slot_to', label: 'Hasta', type: 'text', required: true, placeholder: '13:00' },
      { key: 'cutoff', label: 'Hora de corte', type: 'text', required: true, placeholder: '07:30' }, { key: 'capacity', label: 'Cupo (pedidos)', type: 'number', required: true, min: 1 },
      { key: 'status', label: 'Estado', type: 'select', required: true, options: [['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva']] },
    ], values: s ? Object.assign({}, s) : { establishment_id: slot6.site, capacity: 40, status: 'ACTIVE', cutoff: '07:30' }, submitLabel: s ? 'Guardar' : 'Crear franja', onCancel: close, onSubmit: v => {
      const re = /^\d{2}:\d{2}$/;
      if (!re.test(v.slot_from) || !re.test(v.slot_to) || !re.test(v.cutoff)) return 'Usa el formato HH:MM.';
      if (v.slot_to <= v.slot_from) return 'La hora final debe ser mayor que la inicial.';
      if (v.cutoff > v.slot_from) return 'La hora de corte debe ser antes del inicio de la franja.';
      const row = { establishment_id: v.establishment_id, zone_id: v.zone_id || null, name: `${v.slot_from}–${v.slot_to}`, slot_from: v.slot_from, slot_to: v.slot_to, cutoff: v.cutoff, cutoff_minutes: (Number(v.slot_from.slice(0, 2)) * 60 + Number(v.slot_from.slice(3))) - (Number(v.cutoff.slice(0, 2)) * 60 + Number(v.cutoff.slice(3))), capacity: Number(v.capacity), status: v.status, weekdays: s ? s.weekdays : [1, 2, 3, 4, 5, 6, 0] };
      if (s) { const used = slotUse(s.id, G.TODAY); if (row.capacity < used) return `Hoy ya hay ${used} pedidos en la franja: el cupo no puede ser menor.`; D.update('order_time_slots', s.id, row); } else D.insert('order_time_slots', row);
      toast('Franja guardada', 'ok'); close(); G.refresh(); return true;
    } });
  }
  function renderSlots(el) {
    const canEdit = G.canDo('PED', 'A') || G.canDo('PED', 'E') && G.ctx.role !== 'VENDEDORA';
    const body = page(el, { code: 'PED-06', title: 'Franjas de entrega', sub: 'Calendario por local y zona con cupo, ocupación y hora de corte (RN-PED-06).', actions: canEdit ? [{ label: 'Nueva franja', icon: '+', kind: 'primary', onClick: () => drawer('Nueva franja', (bd, close) => slotForm(null, close)) }] : [] });
    body.appendChild(h('div', { class: 'row between' }, pills([['es-L1', 'Local 1 · Surco'], ['es-L2', 'Local 2 · Lurín']], slot6.site, v => { slot6.site = v; G.refresh(); }), h('span', { class: 'muted small' }, `Hora actual ${nowHM()} · D-PED-02: 3 franjas de 40 pedidos (provisional)`)));
    const days = Array.from({ length: 7 }, (_, i) => G.date.add(G.TODAY, i));
    const slots = D.where('order_time_slots', s => s.establishment_id === slot6.site).sort((a, b) => a.slot_from.localeCompare(b.slot_from) || String(a.zone_id || '').localeCompare(String(b.zone_id || '')));
    const use = usageMap();
    const todayUse = U.sum(slots.filter(s => s.status === 'ACTIVE'), s => use.get(s.id + '|' + G.TODAY) || 0), todayCap = U.sum(slots.filter(s => s.status === 'ACTIVE' && (!s.weekdays || s.weekdays.includes(weekdayOf(G.TODAY)))), s => s.capacity);
    const fullToday = slots.filter(s => (use.get(s.id + '|' + G.TODAY) || 0) >= s.capacity).length;
    body.appendChild(kpis([{ label: 'Ocupación de hoy', value: F.pct(todayCap ? todayUse / todayCap * 100 : 0), sub: `${todayUse} de ${todayCap} pedidos` }, { label: 'Franjas llenas hoy', value: F.num(fullToday), tone: fullToday ? 'bad' : 'ok' }, { label: 'Franjas abiertas ahora', value: F.num(slots.filter(s => s.status === 'ACTIVE' && !slotCutPassed(s, G.TODAY)).length), sub: 'Antes de su hora de corte' }, { label: 'Pedidos mañana', value: F.num(U.sum(slots, s => use.get(s.id + '|' + days[1]) || 0)) }]));
    const tbl = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Franja'), h('th', null, 'Corte'), days.map(d => h('th', { class: 'c' }, dayLabel(d))))),
      h('tbody', null, slots.map(s => h('tr', null, h('td', null, h('b', null, `${s.slot_from}–${s.slot_to}`), h('div', { class: 'muted small' }, s.zone_id ? G.zoneName(s.zone_id) : 'Todas las zonas'), s.status !== 'ACTIVE' ? badge('Inactiva', '') : null), h('td', { class: 'mono' }, slotCut(s)),
        days.map(d => {
          const n = use.get(s.id + '|' + d) || 0; const pct = n / s.capacity * 100; const cut = slotCutPassed(s, d);
          const off = s.weekdays && !s.weekdays.includes(weekdayOf(d));
          return h('td', { class: 'c', style: 'min-width:92px;cursor:pointer', on: { click: () => slotOrders(s, d) } }, off ? h('span', { class: 'muted small' }, 'No opera') : [h('div', { class: 'num', style: n >= s.capacity ? 'color:var(--bad);font-weight:700' : '' }, `${n}/${s.capacity}`), G.ui.progress(pct, n >= s.capacity ? 'bad' : pct >= 80 ? 'warn' : 'ok'), h('div', { class: 'small muted' }, n >= s.capacity ? 'Llena' : cut ? 'Cerrada (corte)' : 'Abierta')]);
        })))));
    body.appendChild(card('Calendario de la semana', h('div', { class: 'tbl-wrap' }, tbl), { flush: true }));
    body.appendChild(table({ id: 'ped06cfg', search: false, columns: [
      { key: 'name', label: 'Franja', render: s => `${s.slot_from}–${s.slot_to}` }, { key: 'zone_id', label: 'Zona', value: s => s.zone_id ? G.zoneName(s.zone_id) : 'Todas' },
      { key: 'cutoff', label: 'Hora de corte', value: s => slotCut(s) }, { key: 'capacity', label: 'Cupo', align: 'r' },
      { key: 'today', label: 'Hoy', align: 'r', value: s => use.get(s.id + '|' + G.TODAY) || 0 }, { key: 'status', label: 'Estado', render: s => status(s.status) },
    ], rows: slots, onRow: canEdit ? s => drawer(`Franja ${s.slot_from}–${s.slot_to}`, (bd, close) => slotForm(s, close)) : null }));
  }
  function slotOrders(s, d) {
    const os = visibleOrders(o => o.slot_id === s.id && o.delivery_date === d && o.status !== 'CANCELLED');
    drawer(`${slotName(s)} · ${dayLabel(d)}`, bd => {
      bd.appendChild(dl([['Cupo', `${os.filter(o => ACTIVE_ST.includes(o.status)).length} de ${s.capacity}`], ['Hora de corte', slotCut(s)], ['Borradores (no ocupan cupo)', os.filter(o => o.status === 'DRAFT').length]]));
      bd.appendChild(table({ id: 'ped06o', columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'c', label: 'Cliente', value: o => G.custName(o.customer_id) }, { key: 'z', label: 'Zona', value: o => o.zone_id ? G.zoneName(o.zone_id).split(' (')[0] : 'Recojo' }, { key: 'status', label: 'Estado', render: o => status(o.status) }], rows: os, onRow: o => G.go('PED-03', { id: o.id }) }));
    });
  }

  /* ---------- PED-07 Diferencia de peso ---------- */
  function renderWeight(el, params) {
    const body = page(el, { code: 'PED-07', title: 'Diferencia de peso', sub: 'Pedidos pesados con diferencia sobre la tolerancia: estimado frente a real, mensaje sugerido, registro de envío y respuesta del cliente (RN-PED-05).' });
    const rows = visibleOrders(o => ['NOTICE_REQUIRED', 'NOTICE_SENT', 'CUSTOMER_REJECTED'].includes(o.weight_diff_status) && (o.created_at.slice(0, 10) >= G.date.add(G.TODAY, -10) || OPEN_ST.includes(o.status)));
    const weighed = visibleOrders(o => o.created_at.slice(0, 7) === G.TODAY.slice(0, 7) && o.weight_diff_status && o.weight_diff_status !== 'NONE');
    const k9 = G.kpi('KPI-PED-09') || {};
    body.appendChild(kpis([{ label: 'Aviso requerido', value: F.num(rows.filter(o => o.weight_diff_status === 'NOTICE_REQUIRED').length), tone: 'warn', sub: 'No pasan a LISTO' }, { label: 'Aviso enviado', value: F.num(rows.filter(o => o.weight_diff_status === 'NOTICE_SENT').length) }, { label: 'Cliente rechazó', value: F.num(rows.filter(o => o.weight_diff_status === 'CUSTOMER_REJECTED').length), tone: 'bad' }, { label: 'KPI-PED-09 · avisos de peso', value: F.pct(k9.value), sub: `${k9.numerator ?? 0} de ${k9.denominator ?? weighed.length} pedidos pesados del mes` }]));
    body.appendChild(notice(`D-PED-03: basta con avisar (ped_weight_notice_wait_response = ${G.param('ped_weight_notice_wait_response') ? 'sí' : 'no'}). Dentro de la ventana de servicio del chat el aviso es gratis; fuera de ella sale como plantilla de utilidad (${money(G.msg.cost('UTILITY'))}) y una tercera exige crm.template.send_extra (RN-CRM-07).`, 'info'));
    const open = o => drawer(`Aviso de peso · ${o.number}`, (bd, close) => noticeBody(o, bd, close), { wide: true, code: 'PED-07' });
    body.appendChild(table({ id: 'ped07', columns: [
      { key: 'number', label: 'Pedido', mono: true }, { key: 'c', label: 'Cliente', value: o => G.custName(o.customer_id), render: custCell },
      { key: 'brand', label: 'Marca', value: o => G.brandName(o.brand_id) },
      { key: 'est', label: 'Kg est.', align: 'r', value: o => weightDiff(o).est, render: o => kg3(weightDiff(o).est) }, { key: 'real', label: 'Kg real', align: 'r', value: o => weightDiff(o).real, render: o => kg3(weightDiff(o).real) },
      { key: 'pct', label: 'Dif.', align: 'r', value: o => weightDiff(o).pct, render: o => h('b', { style: 'color:var(--warn)' }, `${weightDiff(o).pct > 0 ? '+' : ''}${F.num(weightDiff(o).pct, 1)} %`) },
      { key: 'estimated_total', label: 'Total est.', align: 'r', render: o => money(o.estimated_total) }, { key: 'final_total', label: 'Total final', align: 'r', render: o => money(o.final_total) },
      { key: 'w', label: 'Aviso', value: o => o.weight_diff_status, render: o => wBadge(o.weight_diff_status) }, { key: 'status', label: 'Pedido', render: o => status(o.status) },
    ], rows: rows.sort((a, b) => (a.weight_diff_status === 'NOTICE_REQUIRED' ? 0 : 1) - (b.weight_diff_status === 'NOTICE_REQUIRED' ? 0 : 1)), onRow: open, filters: [{ key: 'weight_diff_status', label: 'Aviso', options: [['NOTICE_REQUIRED', 'Aviso requerido'], ['NOTICE_SENT', 'Aviso enviado'], ['CUSTOMER_REJECTED', 'Cliente rechazó']] }] }));
    if (params.id) { const o = order(params.id); if (o) setTimeout(() => open(o), 0); }
  }
  function noticeBody(o, bd, close) {
    bd.appendChild(table({ id: 'ped07l', search: false, columns: [{ key: 'p', label: 'Producto', value: l => G.variantName(l.variant_id) }, { key: 'e', label: 'Est.', align: 'r', render: l => kg3(l.est_weight_kg) }, { key: 'r', label: 'Real', align: 'r', render: l => kg3(l.weighed_kg) }, { key: 'd', label: 'Dif.', align: 'r', render: l => l.weighed_kg != null ? `${F.num((l.weighed_kg - l.est_weight_kg) / l.est_weight_kg * 100, 1)} %` : '—' }, { key: 't', label: 'Tol.', align: 'r', render: l => `${l.tolerance_pct ?? 10} %` }, { key: 'f', label: 'Importe final', align: 'r', render: l => money(l.final_amount) }], rows: o.lines.filter(l => l.price_basis === 'KG') }));
    const ta = h('textarea', { class: 'input', rows: 7 }, suggestedNotice(o));
    let ch = 'WA_WINDOW';
    const used = utilityCount(o);
    bd.appendChild(card('Mensaje sugerido', h('div', { class: 'stack' }, ta,
      pills([['WA_WINDOW', 'WhatsApp en ventana (gratis)'], ['WA_TEMPLATE', `Plantilla de utilidad (${money(G.msg.cost('UTILITY'))})`], ['PHONE', 'Por teléfono']], ch, v => { ch = v; [...bd.querySelectorAll('.pill-tabs button')].forEach(b => b.classList.toggle('active', b.textContent.startsWith({ WA_WINDOW: 'WhatsApp', WA_TEMPLATE: 'Plantilla', PHONE: 'Por tel' }[v]))); }),
      h('div', { class: 'muted small' }, `Plantillas de utilidad usadas en este pedido: ${used} de 2.`),
      h('div', { class: 'row' }, btn('Registrar envío del aviso', () => act(() => weightNotice(o, { channel: ch === 'PHONE' ? 'PHONE' : 'WHATSAPP', inServiceWindow: ch === 'WA_WINDOW', message: ta.value }), 'Aviso registrado: el pedido ya puede pasar a LISTO', () => { close(); G.refresh(); }), { kind: 'primary', disabled: !['NOTICE_REQUIRED', 'CUSTOMER_REJECTED'].includes(o.weight_diff_status) }),
        ['NOTICE_SENT', 'WITHIN_TOLERANCE'].includes(o.weight_diff_status) && ['IN_PREPARATION', 'WEIGHED'].includes(o.status) ? btn('Pasar a LISTO', () => act(() => G.orders.transition(o, 'READY'), 'Pedido listo', () => { close(); G.refresh(); }), { kind: 'accent' }) : null,
        o.weight_diff_status === 'CUSTOMER_REJECTED' ? btn('Volver a pesar', () => { close(); weighDrawer(o); }) : null))));
    const ns = D.where('order_weight_notices', n => n.order_id === o.id).sort(U.by('sent_at', -1));
    bd.appendChild(card('Avisos registrados', ns.length ? h('div', { class: 'stack' }, ns.map(n => h('div', { class: 'stack', style: 'gap:4px;border-bottom:1px solid var(--line);padding-bottom:8px' },
      h('div', { class: 'row between' }, h('span', { class: 'small' }, `${F.datetime(n.sent_at)} · ${n.channel === 'PHONE' ? 'Teléfono' : 'WhatsApp'} · ${money(n.estimated_total)} → ${money(n.final_total)} (${F.num(n.diff_pct, 1)} %)${n.cost ? ' · ' + money(n.cost) : ''}`), badge({ PENDING: 'Sin respuesta aún', ACCEPTED: 'Aceptó', REJECTED: 'Rechazó', NO_RESPONSE: 'No respondió' }[n.customer_response], { ACCEPTED: 'ok', REJECTED: 'bad', PENDING: 'warn' }[n.customer_response] || '')),
      n.customer_response === 'PENDING' ? h('div', { class: 'row' }, btn('Aceptó', () => act(() => noticeResponse(n.id, 'ACCEPTED'), 'Respuesta registrada', () => { close(); G.refresh(); }), { sm: true }), btn('Rechazó', () => act(() => noticeResponse(n.id, 'REJECTED'), 'El pedido vuelve a pesarse o se ajusta', () => { close(); G.refresh(); }), { sm: true, kind: 'danger' }), btn('No respondió', () => act(() => noticeResponse(n.id, 'NO_RESPONSE'), 'Respuesta registrada', () => { close(); G.refresh(); }), { sm: true, kind: 'ghost' })) : null))) : empty('Sin avisos todavía.')));
  }

  /* ---------- PED-08 Reprogramar ---------- */
  function renderReschedule(el, params) {
    const body = page(el, { code: 'PED-08', title: 'Reprogramar', sub: 'Nueva fecha y franja con motivo; muestra cuántas veces se reprogramó (RN-PED-14).' });
    const o = params.id ? order(params.id) : visibleOrders(x => x.status === 'NOT_DELIVERED')[0];
    const recent = visibleOrders(x => x.status === 'NOT_DELIVERED');
    body.appendChild(card('Pedido a reprogramar', h('div', { class: 'stack' }, recent.length ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'No entregados:'), recent.slice(0, 6).map(x => btn(`${x.number} · ${G.custName(x.customer_id)}`, () => G.go('PED-08', { id: x.id }), { sm: true, kind: o && o.id === x.id ? 'primary' : '' }))) : null, orderPicker(x => G.go('PED-08', { id: x.id }), x => RESCHEDULABLE.includes(x.status)))));
    if (o) {
      const max = G.param('ped_max_reschedules') ?? 2;
      const n = o.reschedule_count || 0;
      body.appendChild(h('div', { class: 'grid c2' },
        card(`${o.number} · ${G.custName(o.customer_id)}`, h('div', { class: 'stack' }, dl([['Estado', status(o.status)], ['Entrega actual', `${F.date(o.delivery_date)} · ${slotText(o)}`], ['Zona', o.zone_id ? G.zoneName(o.zone_id) : G.fulfillName(o.fulfillment)], ['Reprogramaciones', h('span', null, `${n} de ${max} `, n >= max ? badge('Desde ahora la supervisora', 'warn') : null)]]), !RESCHEDULABLE.includes(o.status) ? notice(`RN-PED-14: un pedido ${G.ui.statusLabel(o.status).toLowerCase()} no se reprograma.`, 'warn') : null)),
        RESCHEDULABLE.includes(o.status) ? card('Nueva fecha y franja', rescheduleForm(o)) : card('Historial', empty('—'))));
    } else body.appendChild(empty('Elige un pedido confirmado o no entregado.'));
    const rs = D.where('order_reschedules', r => G.scope.ok(r)).sort(U.by('at', -1));
    body.appendChild(card('Reprogramaciones recientes', table({ id: 'ped08', columns: [{ key: 'at', label: 'Fecha', render: r => F.datetime(r.at) }, { key: 'order_number', label: 'Pedido', mono: true }, { key: 'old', label: 'Antes', value: r => `${F.date(r.old_date)} ${r.old_slot_from || ''}` }, { key: 'new', label: 'Después', value: r => `${F.date(r.new_date)} ${r.new_slot_from || ''}` }, { key: 'reason', label: 'Motivo' }, { key: 'fee_charged', label: 'Cobro', align: 'r', render: r => r.fee_charged ? money(r.fee_charged) : '—' }, { key: 'rescheduled_by_name', label: 'Por' }], rows: rs, onRow: r => G.go('PED-03', { id: r.order_id }) }), { flush: true }));
  }
  function rescheduleForm(o) {
    const st = { date: o.delivery_date && o.delivery_date > G.TODAY ? o.delivery_date : G.date.add(G.TODAY, 1), slot_id: null, reason: o.status === 'NOT_DELIVERED' ? 'Cliente ausente' : '', fee: 0 };
    const box = h('div', { class: 'stack' });
    const slotSel = h('div');
    const msg = h('div', { class: 'err small', style: 'color:var(--bad)' });
    function drawSlots() {
      G.ui.clear(slotSel); if (o.fulfillment === 'PROVINCE_SHIPPING') return;
      const use = usageMap();
      const ss = slotsFor(o.establishment_id, o.zone_id, st.date);
      if (!st.slot_id || !ss.find(s => s.id === st.slot_id)) st.slot_id = (ss.find(s => s.id === o.slot_id && (use.get(s.id + '|' + st.date) || 0) < s.capacity) || ss.find(s => (use.get(s.id + '|' + st.date) || 0) < s.capacity && !slotCutPassed(s, st.date)) || {}).id || null;
      slotSel.appendChild(fld('Franja', sel([['', 'Elige'], ...ss.map(s => { const n = use.get(s.id + '|' + st.date) || 0; return [s.id, `${slotName(s)} · ${n}/${s.capacity}${n >= s.capacity ? ' (llena)' : slotCutPassed(s, st.date) ? ' (cerrada)' : ''}`]; })], st.slot_id, v => { st.slot_id = v || null; })));
    }
    const reasons = ['Cliente ausente', 'Cliente pidió otro día', 'Dirección por confirmar', 'Falta de stock del corte', 'Ruta saturada', 'Lluvia o tránsito'];
    box.append(h('div', { class: 'form-grid' }, fld('Nueva fecha', inp('date', st.date, v => { st.date = v; drawSlots(); }, { min: G.TODAY })), slotSel,
      fld('Motivo', (() => { const i = inp('text', st.reason, v => { st.reason = v; }, { attrs: { list: 'ped08r' } }); return h('div', null, i, h('datalist', { id: 'ped08r' }, reasons.map(r => h('option', { value: r })))); })()),
      fld('Cobro por reprogramar (S/)', inp('number', 0, v => { st.fee = v || 0; }, { min: 0, step: 0.5 }), 'Solo si la política lo indica.')),
      msg, h('div', { class: 'row' }, btn('Reprogramar', () => { msg.textContent = ''; try { reschedule(o, { date: st.date, slot_id: st.slot_id, reason: st.reason, fee: st.fee }); toast(`Pedido ${o.number} reprogramado al ${F.date(st.date)}`, 'ok'); G.refresh(); } catch (e) { if (e.code === 'RN-PED-06' && G.can('ped.slot.override')) confirm({ title: 'Franja llena o cerrada', message: e.message + ' ¿Reprogramar fuera de cupo?', confirmLabel: 'Reprogramar igual', onConfirm: () => act(() => reschedule(o, { date: st.date, slot_id: st.slot_id, reason: st.reason, fee: st.fee, override: true }), 'Pedido reprogramado') }); else msg.textContent = e.message; } }, { kind: 'primary', disabled: !G.can('ped.order.reschedule') })));
    drawSlots();
    return box;
  }

  /* ---------- PED-09 Cancelar o registrar no entrega ---------- */
  function renderCancel(el, params) {
    const body = page(el, { code: 'PED-09', title: 'Cancelar o registrar no entrega', sub: 'Motivo del catálogo y nota cuando el motivo la exige; al cancelar se liberan las reservas de stock (RN-PED-13).' });
    const o = params.id ? order(params.id) : null;
    body.appendChild(card('Pedido', orderPicker(x => G.go('PED-09', { id: x.id }), x => ['DRAFT', 'CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE', 'NOT_DELIVERED'].includes(x.status))));
    if (o) {
      const mode = o.status === 'IN_ROUTE' ? 'NOT_DELIVERED' : 'CANCEL';
      const can = mode === 'NOT_DELIVERED' || ['DRAFT', 'CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'NOT_DELIVERED'].includes(o.status);
      const rs = reasonsFor(mode);
      const st = { code: rs[0] ? rs[0].code : '', note: '' };
      const msg = h('div', { class: 'err small', style: 'color:var(--bad)' });
      const help = h('div', { class: 'help' });
      const setHelp = () => { const r = rs.find(x => x.code === st.code); help.textContent = r && r.requires_note ? 'Este motivo exige nota.' : ''; };
      body.appendChild(h('div', { class: 'grid c2' },
        card(`${o.number} · ${G.custName(o.customer_id)}`, dl([['Estado', status(o.status)], ['Entrega', `${F.date(o.delivery_date)} · ${slotText(o)}`], ['Total', money(total(o))], ['Pagado', money(o.paid_amount || 0)], ['Reservas de stock', `${(o.reservations || []).length} lote(s) reservados (se liberan al cancelar)`]])),
        card(mode === 'CANCEL' ? 'Cancelar el pedido' : 'Registrar no entrega', !can ? notice(`No aplica a un pedido ${G.ui.statusLabel(o.status).toLowerCase()}.`, 'warn') : h('div', { class: 'stack' },
          mode === 'CANCEL' && o.status !== 'DRAFT' && !G.can('ped.order.cancel') ? notice('Cancelar un pedido confirmado exige el permiso ped.order.cancel (supervisora).', 'warn') : null,
          h('div', { class: 'form-grid' }, fld('Motivo', sel(rs.map(r => [r.code, r.name + (r.requires_note ? ' (exige nota)' : '')]), st.code, v => { st.code = v; setHelp(); }), null, true), fld('Nota', (() => { const t = h('textarea', { class: 'input', rows: 2 }); t.addEventListener('input', () => { st.note = t.value; }); return t; })(), null, true), help),
          (o.paid_amount || 0) > 0 && mode === 'CANCEL' ? notice(`El cliente pagó ${money(o.paid_amount)}: al cancelar decide el saldo en PED-12 (saldo a favor o devolución).`, 'info') : null,
          msg, btn(mode === 'CANCEL' ? 'Cancelar pedido' : 'Registrar no entrega', () => { msg.textContent = ''; try { if (mode === 'CANCEL') { const r = cancelOrder(o, { reason_code: st.code, note: st.note }); toast(`Pedido cancelado; ${r.releasedReservations} reserva(s) liberada(s)`, 'ok'); } else { notDelivered(o, { reason_code: st.code, note: st.note }); toast('No entrega registrada: reprográmalo o cancélalo', 'ok'); } G.go('PED-03', { id: o.id }); } catch (e) { msg.textContent = e.message; } }, { kind: 'danger' })))));
      setHelp();
    }
    const done = visibleOrders(x => (x.status === 'CANCELLED' || x.status === 'NOT_DELIVERED' || x.not_delivered_reason_code) && (x.cancelled_at || x.not_delivered_at || x.created_at).slice(0, 7) === G.TODAY.slice(0, 7));
    const byReason = U.groupBy(done.filter(x => x.status === 'CANCELLED'), x => x.cancel_reason ? x.cancel_reason.split(' · ')[0] : 'Sin motivo');
    const k5 = G.kpi('KPI-PED-05') || {};
    body.appendChild(h('div', { class: 'grid c2' },
      card(`Cancelaciones del mes por motivo · KPI-PED-05 ${F.pct(k5.value)}`, Object.keys(byReason).length ? chart.hbar({ items: Object.entries(byReason).map(([k, v]) => ({ label: k, value: v.length })).sort((a, b) => b.value - a.value), format: v => F.num(v) }) : empty('Sin cancelaciones.')),
      card('Últimas cancelaciones y no entregas', table({ id: 'ped09', search: false, pageSize: 8, columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'status', label: 'Estado', render: x => status(x.status) }, { key: 'r', label: 'Motivo', value: x => x.status === 'CANCELLED' ? x.cancel_reason : (x.history.slice().reverse().find(y => y.to === 'NOT_DELIVERED') || {}).reason }], rows: done.sort((a, b) => String(b.cancelled_at || b.not_delivered_at || '').localeCompare(String(a.cancelled_at || a.not_delivered_at || ''))), onRow: x => G.go('PED-03', { id: x.id }) }), { flush: true })));
  }

  /* ---------- PED-10 Aprobación de descuentos ---------- */
  function renderDiscounts(el) {
    const body = page(el, { code: 'PED-10', title: 'Aprobación de descuentos', sub: 'Solicitudes sobre el límite del rol: pedido, vendedora, porcentaje, monto y motivo. Quien pide no aprueba (RN-PED-11).' });
    const rows = D.where('order_discount_approvals', a => G.scope.ok(a)).sort((a, b) => (a.status === 'PENDING' ? 0 : 1) - (b.status === 'PENDING' ? 0 : 1) || String(b.requested_at).localeCompare(String(a.requested_at)));
    const k7 = G.kpi('KPI-PED-07') || {};
    body.appendChild(kpis([{ label: 'Por aprobar', value: F.num(rows.filter(a => a.status === 'PENDING').length), tone: 'warn' }, { label: 'Monto por aprobar', value: money(U.sum(rows.filter(a => a.status === 'PENDING'), a => a.requested_amount)) }, { label: 'Aprobadas del mes', value: F.num(rows.filter(a => a.status === 'APPROVED' && (a.decided_at || '').slice(0, 7) === G.TODAY.slice(0, 7)).length), tone: 'ok' }, { label: 'KPI-PED-07 · descuentos/ventas', value: F.pct(k7.value, 2), sub: `${money(k7.numerator)} de ${money(k7.denominator)}` }]));
    if (!G.can('ped.discount.approve')) body.appendChild(notice(`Tu rol (${G.roleName()}) ve las solicitudes pero no aprueba (ped.discount.approve: supervisora y gerencia).`, 'info'));
    const decide = (a, ok) => modal(ok ? 'Aprobar descuento' : 'Rechazar descuento', bd => { bd.appendChild(dl([['Pedido', a.order_number], ['Pide', a.requested_by_name], ['Descuento', `${F.num(a.requested_pct, 1)} % · ${money(a.requested_amount)}`], ['Motivo', a.reason]])); const t = h('textarea', { class: 'input', rows: 2, placeholder: 'Nota de la decisión', id: 'ped10note' }); bd.appendChild(t); }, [{ label: 'Cancelar' }, { label: ok ? 'Aprobar' : 'Rechazar', kind: ok ? 'primary' : 'danger', onClick: () => { const n = document.getElementById('ped10note').value; act(() => decideDiscount(a.id, ok, n), ok ? 'Descuento aprobado: el pedido ya se puede confirmar' : 'Descuento rechazado y quitado del pedido'); } }]);
    body.appendChild(table({ id: 'ped10', columns: [
      { key: 'requested_at', label: 'Pedido el', render: a => F.datetime(a.requested_at) }, { key: 'order_number', label: 'Pedido', mono: true },
      { key: 'brand', label: 'Marca', value: a => G.brandName(a.brand_id) }, { key: 'requested_by_name', label: 'Vendedora' },
      { key: 'requested_pct', label: '%', align: 'r', render: a => F.pct(a.requested_pct) }, { key: 'requested_amount', label: 'Monto', align: 'r', render: a => money(a.requested_amount) },
      { key: 'lim', label: 'Límite del rol', value: a => limitText(discountLimit(a.requested_role || 'VENDEDORA', a.brand_id)) }, { key: 'reason', label: 'Motivo' },
      { key: 'status', label: 'Estado', render: a => status(a.status) }, { key: 'decided_by_name', label: 'Resolvió', value: a => a.decided_by_name ? `${a.decided_by_name} · ${F.datetime(a.decided_at)}` : '—' },
    ], rows, onRow: a => G.go('PED-03', { id: a.order_id }), filters: [{ key: 'status', label: 'Estado', options: [['PENDING', 'Pendiente'], ['APPROVED', 'Aprobado'], ['REJECTED', 'Rechazado']] }],
    actions: a => a.status === 'PENDING' && G.can('ped.discount.approve') ? [btn('Aprobar', () => decide(a, true), { sm: true, kind: 'primary', disabled: a.requested_by === G.ctx.userId(), title: a.requested_by === G.ctx.userId() ? 'Quien pide no aprueba' : '' }), btn('Rechazar', () => decide(a, false), { sm: true, kind: 'danger', disabled: a.requested_by === G.ctx.userId() })] : [] }));
  }

  /* ---------- PED-11 Pedidos de provincia ---------- */
  function renderProvince(el) {
    const body = page(el, { code: 'PED-11', title: 'Pedidos de provincia', sub: 'Envíos por agencia: destino, embalaje térmico, guía de remisión y número de seguimiento (RN-PED-08).', actions: G.canDo('PED', 'C') ? [{ label: 'Nuevo envío a provincia', kind: 'primary', icon: '+', onClick: () => G.go('PED-02', { customer_id: 'cu-PROV1' }) }] : [] });
    const rows = visibleOrders(o => o.fulfillment === 'PROVINCE_SHIPPING');
    body.appendChild(kpis([{ label: 'Por despachar', value: F.num(rows.filter(o => ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY'].includes(o.status)).length) }, { label: 'Sin guía o seguimiento', value: F.num(rows.filter(o => o.status === 'READY' && (!o.dispatch_guide_number || !o.tracking_number)).length), tone: 'warn' }, { label: 'En camino', value: F.num(rows.filter(o => o.status === 'IN_ROUTE').length), tone: 'info' }, { label: 'Entregados', value: F.num(rows.filter(o => ['DELIVERED', 'CLOSED'].includes(o.status)).length), tone: 'ok' }]));
    const open = o => drawer(`Envío ${o.number}`, (bd, close) => {
      bd.appendChild(dl([['Cliente', G.custName(o.customer_id)], ['Destino', `${o.province_destination || '—'} · ${(D.get('customer_addresses', o.address_id) || {}).address_line || '—'}`], ['Estado', status(o.status)], ['Pago', `${G.pmName(o.payment_method_id)} · pagado ${money(o.paid_amount || 0)} de ${money(total(o))}`], ['Guía', o.dispatch_guide_number || '—'], ['Seguimiento', o.tracking_number || '—']]));
      bd.appendChild(G.ui.form({ id: 'ped11', fields: [
        { key: 'province_agency', label: 'Agencia', type: 'select', required: true, options: agencies().map(s => [s.id, s.trade_name || s.legal_name]) },
        { key: 'province_destination', label: 'Destino (ciudad)', type: 'text', required: true },
        { key: 'thermal_packaging', label: 'Embalaje térmico (caja isotérmica y gel)', type: 'checkbox' },
        { key: 'tracking_number', label: 'Número de seguimiento de la agencia', type: 'text' },
      ], values: o, submitLabel: 'Guardar', onSubmit: v => { setProvince(o, v); toast('Datos del envío guardados', 'ok'); close(); G.refresh(); return true; } }));
      bd.appendChild(h('div', { class: 'row' },
        !o.dispatch_guide_number ? btn('Emitir guía de remisión (RN-FAC-11)', () => act(() => issueGuide(o), 'Guía emitida', () => { close(); G.refresh(); }), { disabled: !['READY', 'WEIGHED', 'IN_PREPARATION'].includes(o.status) }) : null,
        o.status === 'READY' ? btn('Despachar', () => act(() => G.orders.transition(o, 'IN_ROUTE', { reason: 'Entregado a la agencia' }), 'Envío despachado', () => { close(); G.refresh(); }), { kind: 'primary' }) : null,
        o.status === 'IN_ROUTE' ? btn('Entregado al cliente', () => act(() => G.orders.transition(o, 'DELIVERED', { reason: 'Agencia confirmó la entrega' }), 'Entrega registrada', () => { close(); G.refresh(); }), { kind: 'primary' }) : null,
        btn('Ver pedido', () => { close(); G.go('PED-03', { id: o.id }); }, { kind: 'ghost' })));
    }, { code: 'PED-11' });
    body.appendChild(table({ id: 'ped11', columns: [
      { key: 'number', label: 'Pedido', mono: true }, { key: 'c', label: 'Cliente', value: o => G.custName(o.customer_id) }, { key: 'province_destination', label: 'Destino' },
      { key: 'ag', label: 'Agencia', value: o => G.supName(o.province_agency) }, { key: 'thermal_packaging', label: 'Térmico', render: o => o.thermal_packaging ? badge('Sí', 'ok') : badge('No', '') },
      { key: 'delivery_date', label: 'Despacho', render: o => F.date(o.delivery_date) }, { key: 'dispatch_guide_number', label: 'Guía', mono: true }, { key: 'tracking_number', label: 'Seguimiento', mono: true },
      { key: 'total', label: 'Total', align: 'r', value: o => total(o), render: o => money(total(o)) }, { key: 'status', label: 'Estado', render: o => status(o.status) },
    ], rows: rows.sort((a, b) => String(b.delivery_date).localeCompare(String(a.delivery_date))), onRow: open }));
  }

  /* ---------- PED-12 Saldo del pedido ---------- */
  const bal12 = { view: 'PENDING' };
  function renderBalance(el, params) {
    const body = page(el, { code: 'PED-12', title: 'Saldo del pedido', sub: 'Total final frente a pagado: saldo a favor, devolución o cobro contra entrega, con la decisión registrada (RN-PED-19, RN-PED-15).' });
    const all = visibleOrders(o => ['WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED', 'CLOSED', 'CANCELLED'].includes(o.status) && (o.status !== 'CANCELLED' || (o.paid_amount || 0) > 0) && ((o.paid_amount || 0) > 0 || ['DELIVERED', 'CLOSED'].includes(o.status)) && (o.created_at || '').slice(0, 7) === G.TODAY.slice(0, 7) && Math.abs(balOf(o)) >= 0.005);
    const pending = all.filter(o => !o.balance_mode);
    const credits = D.where('customer_balance_movements', m => true);
    body.appendChild(kpis([{ label: 'Sin decisión', value: F.num(pending.length), tone: pending.length ? 'warn' : 'ok' }, { label: 'A favor de clientes (pendiente)', value: money(U.sum(pending.filter(o => balOf(o) > 0), balOf)) }, { label: 'Por cobrar (pendiente)', value: money(-U.sum(pending.filter(o => balOf(o) < 0), balOf)), tone: 'bad' }, { label: 'Saldo a favor vigente (CAJ)', value: money(U.sum(credits, m => m.amount)), sub: `${new Set(credits.map(m => m.customer_id)).size} clientes · D-PED-05` }]));
    body.appendChild(pills([['PENDING', 'Sin decisión'], ['DECIDED', 'Decididos'], ['ALL', 'Todos']], bal12.view, v => { bal12.view = v; G.refresh(); }));
    const rows = bal12.view === 'PENDING' ? pending : bal12.view === 'DECIDED' ? all.filter(o => o.balance_mode) : all;
    const open = o => drawer(`Saldo de ${o.number}`, (bd, close) => {
      const bal = balOf(o);
      bd.appendChild(dl([['Cliente', G.custName(o.customer_id)], ['Estado', status(o.status)], ['Total estimado', money(o.estimated_total)], ['Total final', o.status === 'CANCELLED' ? 'Cancelado (S/ 0,00)' : money(o.final_total)], ['Pagado', money(o.paid_amount || 0)], ['Saldo', h('b', { style: 'color:' + (bal > 0 ? 'var(--ok)' : 'var(--bad)') }, bal > 0 ? `A favor del cliente ${money(bal)}` : `Por cobrar ${money(-bal)}`)], o.balance_mode ? ['Decisión', `${BMODE[o.balance_mode]} · ${o.balance_decided_by_name || ''} ${F.datetime(o.balance_decided_at)}`] : null, ['Saldo a favor del cliente (CAJ)', money(customerCredit(o.customer_id))]]));
      if (o.balance_mode) { bd.appendChild(notice('La decisión ya está registrada.', 'ok')); if (o.status === 'DELIVERED') bd.appendChild(btn('Cerrar pedido', () => act(() => closeOrder(o), 'Pedido cerrado', () => { close(); G.refresh(); }), { kind: 'primary' })); return; }
      const opts = bal > 0 ? [['CUSTOMER_CREDIT', 'Saldo a favor para la próxima compra (D-PED-05)'], ['REFUND', 'Devolución (caj.balance.refund)']] : [['COLLECT_ON_DELIVERY', 'Cobro contra entrega'], ['PAYMENT_LINK', 'Enlace de pago por WhatsApp'], ['WAIVE', `Condonar (hasta ${money(G.param('ped_max_waive_amount') ?? 1)}, ped.balance.waive)`]].filter(x => !(x[0] === 'COLLECT_ON_DELIVERY' && ['DELIVERED', 'CLOSED'].includes(o.status)));
      bd.appendChild(G.ui.form({ id: 'ped12', fields: [{ key: 'mode', label: 'Decisión', type: 'select', required: true, options: opts }, { key: 'note', label: 'Nota', type: 'textarea' }], values: {}, submitLabel: 'Registrar decisión', onSubmit: v => { resolveBalance(o, v.mode, { note: v.note }); toast('Decisión del saldo registrada', 'ok'); close(); G.refresh(); return true; } }));
    }, { code: 'PED-12' });
    body.appendChild(table({ id: 'ped12', columns: [
      { key: 'number', label: 'Pedido', mono: true }, { key: 'c', label: 'Cliente', value: o => G.custName(o.customer_id) }, { key: 'status', label: 'Estado', render: o => status(o.status) },
      { key: 'pm', label: 'Pago', value: o => G.pmName(o.payment_method_id) }, { key: 't', label: 'Total final', align: 'r', value: o => o.status === 'CANCELLED' ? 0 : total(o), render: o => o.status === 'CANCELLED' ? money(0) : money(total(o)) },
      { key: 'paid_amount', label: 'Pagado', align: 'r', render: o => money(o.paid_amount || 0) }, { key: 'bal', label: 'Saldo', align: 'r', value: o => balOf(o), render: o => { const b = balOf(o); return h('b', { class: 'num', style: 'color:' + (b > 0 ? 'var(--ok)' : 'var(--bad)') }, (b > 0 ? '+' : '') + money(b)); } },
      { key: 'balance_mode', label: 'Decisión', render: o => o.balance_mode ? badge(BMODE[o.balance_mode], 'ok') : badge('Sin decidir', 'warn') },
    ], rows, onRow: open }));
    if (params.id) { const o = order(params.id); if (o) setTimeout(() => open(o), 0); }
  }

  /* ---------- PED-13 Motivos y límites ---------- */
  function renderReasons(el) {
    const canEdit = G.canDo('PED', 'A');
    const body = page(el, { code: 'PED-13', title: 'Motivos y límites', sub: 'Catálogo de motivos de cancelación y no entrega; límites de descuento por rol y marca; parámetros del módulo.' });
    if (!canEdit) body.appendChild(notice(`Tu rol (${G.roleName()}) solo consulta esta configuración.`, 'info'));
    body.appendChild(h('div', { style: 'min-width:0' }, tabs([
      { key: 'r', label: 'Motivos', render: p => {
        const edit = r => drawer(r ? `Motivo ${r.code}` : 'Nuevo motivo', (bd, close) => G.ui.form({ id: 'ped13r', fields: [{ key: 'code', label: 'Código', type: 'text', required: true, disabled: !!r }, { key: 'name', label: 'Nombre', type: 'text', required: true }, { key: 'applies_to', label: 'Aplica a', type: 'select', required: true, options: [['CANCEL', 'Cancelación'], ['NOT_DELIVERED', 'No entrega'], ['BOTH', 'Ambos']] }, { key: 'requires_note', label: 'Exige nota', type: 'checkbox' }, { key: 'counts_as_loss', label: 'Cuenta como pérdida', type: 'checkbox' }, { key: 'status', label: 'Estado', type: 'select', required: true, options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']] }], values: r || { applies_to: 'CANCEL', status: 'ACTIVE' }, onCancel: close, onSubmit: v => { const code = (r ? r.code : v.code).toUpperCase().replace(/[^A-Z0-9_]/g, '_'); if (!r && D.find('order_cancel_reasons', x => x.code === code)) return { code: 'El código ya existe.' }; const row = { code, name: v.name, applies_to: v.applies_to, requires_note: !!v.requires_note, counts_as_loss: !!v.counts_as_loss, status: v.status }; if (r) D.update('order_cancel_reasons', r.id, row); else D.insert('order_cancel_reasons', row); toast('Motivo guardado', 'ok'); close(); G.refresh(); return true; } }));
        const used = U.groupBy(D.where('sales_orders', o => o.cancel_reason_code || o.not_delivered_reason_code), o => o.cancel_reason_code || o.not_delivered_reason_code);
        if (canEdit) p.appendChild(h('div', { class: 'row', style: 'margin:10px 0' }, btn('Nuevo motivo', () => edit(null), { kind: 'primary', icon: '+', sm: true })));
        p.appendChild(table({ id: 'ped13r', columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Motivo' }, { key: 'applies_to', label: 'Aplica a', value: r => ({ CANCEL: 'Cancelación', NOT_DELIVERED: 'No entrega', BOTH: 'Ambos' }[r.applies_to]) }, { key: 'requires_note', label: 'Exige nota', render: r => r.requires_note ? badge('Sí', 'warn') : 'No' }, { key: 'counts_as_loss', label: 'Pérdida', render: r => r.counts_as_loss ? badge('Sí', 'bad') : 'No' }, { key: 'u', label: 'Usos', align: 'r', value: r => (used[r.code] || []).length }, { key: 'status', label: 'Estado', render: r => status(r.status) }], rows: D.all('order_cancel_reasons'), onRow: canEdit ? edit : null }));
      } },
      { key: 'l', label: 'Límites de descuento', render: p => {
        const edit = l => drawer(l ? 'Editar límite' : 'Nuevo límite', (bd, close) => G.ui.form({ id: 'ped13l', fields: [{ key: 'role', label: 'Rol', type: 'select', required: true, options: G.ROLES.filter(r => ['VENDEDORA', 'SUPERVISORA_VENTAS', 'CAJERO', 'ADMINISTRACION'].includes(r[0])) }, { key: 'brand_id', label: 'Marca (vacío = todas)', type: 'select', options: D.all('brands').map(b => [b.id, G.brandName(b.id)]) }, { key: 'max_pct', label: 'Máximo %', type: 'number', required: true, min: 0, max: 100 }, { key: 'max_amount', label: 'Máximo S/', type: 'money', required: true, min: 0 }], values: l || { max_pct: 5, max_amount: 20 }, onCancel: close, onSubmit: v => { const dup = D.find('discount_limits', x => x.role === v.role && (x.brand_id || '') === (v.brand_id || '') && (!l || x.id !== l.id)); if (dup) return 'Ya existe un límite para ese rol y marca.'; const row = { role: v.role, role_id: v.role, brand_id: v.brand_id || null, max_pct: Number(v.max_pct), max_amount: Number(v.max_amount), status: 'ACTIVE' }; if (l) D.update('discount_limits', l.id, row); else D.insert('discount_limits', row); toast('Límite guardado', 'ok'); close(); G.refresh(); return true; } }));
        p.appendChild(notice('D-PED-04 (provisional): VENDEDORA 5 % o S/ 20; SUPERVISORA_VENTAS 15 % o S/ 100; GERENTE sin límite. Sobre el límite, el descuento queda por aprobar.', 'info'));
        if (canEdit) p.appendChild(h('div', { class: 'row', style: 'margin:10px 0' }, btn('Nuevo límite', () => edit(null), { kind: 'primary', icon: '+', sm: true })));
        p.appendChild(table({ id: 'ped13l', search: false, columns: [{ key: 'role', label: 'Rol', value: l => G.roleName(l.role) }, { key: 'brand_id', label: 'Marca', value: l => l.brand_id ? G.brandName(l.brand_id) : 'Todas' }, { key: 'max_pct', label: 'Máximo %', align: 'r', render: l => F.pct(l.max_pct, 0) }, { key: 'max_amount', label: 'Máximo S/', align: 'r', render: l => money(l.max_amount) }], rows: D.all('discount_limits').concat([{ id: 'x-ger', role: 'GERENTE', brand_id: null, max_pct: null, max_amount: null }]), onRow: canEdit ? l => l.id !== 'x-ger' && edit(l) : null }));
      } },
      { key: 'p', label: 'Parámetros', render: p => {
        const keys = Object.values(G.PARAM_DEFS).filter(d => d.module === 'PED');
        p.appendChild(table({ id: 'ped13p', search: false, columns: [{ key: 'key', label: 'Clave', mono: true }, { key: 'v', label: 'Valor vigente', value: d => String(G.param(d.key)) }, { key: 'default', label: 'Por defecto', value: d => String(d.default) }, { key: 'desc', label: 'Para qué' }], rows: keys, onRow: canEdit ? d => drawer(`Parámetro ${d.key}`, (bd, close) => G.ui.form({ id: 'ped13pp', fields: [{ key: 'value', label: 'Valor', type: typeof d.default === 'boolean' ? 'select' : 'number', options: [['true', 'Sí'], ['false', 'No']], required: true }, { key: 'reason', label: 'Motivo del cambio', type: 'text', required: true }], values: { value: String(G.param(d.key)) }, onCancel: close, onSubmit: v => { G.setParam(d.key, typeof d.default === 'boolean' ? v.value === 'true' : Number(v.value), v.reason); toast('Parámetro actualizado', 'ok'); close(); G.refresh(); return true; } })) : null }));
      } },
    ])));
  }

  /* ---------- PED-14 Tablero del día ---------- */
  function renderBoard(el) {
    const body = page(el, { code: 'PED-14', title: 'Tablero del día', sub: `Pedidos de hoy (${dayLabel(G.TODAY)}) por franja y estado, confirmados sin preparar a la hora de corte y pedidos en ruta.`, actions: [{ label: 'Ver lista', onClick: () => { listState.scope = 'TODAY'; G.go('PED-01'); } }] });
    const os = visibleOrders(o => o.delivery_date === G.TODAY && o.status !== 'CANCELLED');
    const cnt = s => os.filter(o => o.status === s).length;
    const late = os.filter(o => o.status === 'CONFIRMED' && o.slot_id && (() => { const s = D.get('order_time_slots', o.slot_id); return s && nowHM() > slotCut(s); })());
    const delivered = os.filter(o => ['DELIVERED', 'CLOSED'].includes(o.status)).length;
    body.appendChild(kpis([{ label: 'Pedidos para hoy', value: F.num(os.length), sub: money(U.sum(os, total)) }, { label: 'Borradores', value: F.num(cnt('DRAFT')), tone: cnt('DRAFT') ? 'warn' : '' }, { label: 'Sin preparar a la hora de corte', value: F.num(late.length), tone: late.length ? 'bad' : 'ok' }, { label: 'En preparación / pesados', value: F.num(cnt('IN_PREPARATION') + cnt('WEIGHED')), tone: 'info' }, { label: 'Listos', value: F.num(cnt('READY')) }, { label: 'En ruta', value: F.num(cnt('IN_ROUTE')), tone: 'info' }, { label: 'Entregados', value: F.pct(os.length ? delivered / os.length * 100 : 0), sub: `${delivered} de ${os.length}`, tone: 'ok' }, { label: 'No entregados', value: F.num(cnt('NOT_DELIVERED')), tone: cnt('NOT_DELIVERED') ? 'bad' : '' }]));
    const ST = ['DRAFT', 'CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED', 'NOT_DELIVERED', 'CLOSED'];
    const groups = U.groupBy(os, o => o.fulfillment === 'PROVINCE_SHIPPING' ? 'Provincia' : o.slot_from ? `${o.slot_from}–${o.slot_to}` : 'Sin franja');
    const keys = Object.keys(groups).sort();
    body.appendChild(card('Por franja y estado', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Franja'), ST.map(s => h('th', { class: 'r' }, G.ui.statusLabel(s))), h('th', { class: 'r' }, 'Total'))),
      h('tbody', null, keys.map(k => h('tr', null, h('td', null, h('b', null, k)), ST.map(s => { const n = groups[k].filter(o => o.status === s).length; return h('td', { class: 'r num', style: n && ['DRAFT', 'NOT_DELIVERED'].includes(s) ? 'color:var(--bad);font-weight:700' : '' }, n || '·'); }), h('td', { class: 'r num' }, h('b', null, groups[k].length))))))), { flush: true }));
    if (keys.length) body.appendChild(chart.bar({ labels: keys, series: ['CONFIRMED', 'IN_PREPARATION', 'READY', 'IN_ROUTE', 'DELIVERED'].map(s => ({ name: G.ui.statusLabel(s), values: keys.map(k => groups[k].filter(o => o.status === s || (s === 'IN_PREPARATION' && o.status === 'WEIGHED') || (s === 'DELIVERED' && o.status === 'CLOSED')).length) })), stacked: true, height: 200 }));
    const lateTbl = table({ id: 'ped14late', search: false, pageSize: 8, empty: 'Ningún pedido confirmado quedó sin preparar a la hora de corte.', columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'c', label: 'Cliente', value: o => G.custName(o.customer_id) }, { key: 's', label: 'Franja', value: o => slotText(o) }, { key: 'cut', label: 'Corte', value: o => slotCut(D.get('order_time_slots', o.slot_id)) }], rows: late, onRow: o => G.go('PED-03', { id: o.id }), actions: o => G.canDo('PED', 'E') ? [btn('A preparación', () => act(() => G.orders.transition(o, 'IN_PREPARATION', { reason: 'Atrasado a la hora de corte' }), 'En preparación'), { sm: true })] : [] });
    const route = os.filter(o => o.status === 'IN_ROUTE');
    const routeTbl = table({ id: 'ped14route', search: false, pageSize: 8, empty: 'Sin pedidos en ruta.', columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'z', label: 'Zona', value: o => o.zone_id ? G.zoneName(o.zone_id).split(' (')[0] : '—' }, { key: 'd', label: 'Repartidor', value: o => G.userShort(o.driver_user_id) }, { key: 's', label: 'Franja', value: o => slotText(o) }, { key: 't', label: 'Por cobrar', align: 'r', value: o => Math.max(0, -balOf(o)), render: o => money(Math.max(0, -balOf(o))) }], rows: route, onRow: o => G.go('PED-03', { id: o.id }) });
    body.appendChild(h('div', { class: 'grid c2' }, card(`Confirmados sin preparar a la hora de corte (${late.length})`, lateTbl, { flush: true }), card(`En ruta (${route.length})`, routeTbl, { flush: true })));
    const tone = { DRAFT: 'muted', CONFIRMED: 'warn', IN_PREPARATION: 'info', WEIGHED: 'info', READY: 'info', IN_ROUTE: 'info', DELIVERED: 'ok', CLOSED: 'ok', NOT_DELIVERED: 'bad' };
    const pts = os.filter(o => o.address_id && o.fulfillment === 'DELIVERY').map(o => { const a = D.get('customer_addresses', o.address_id); return a && a.lat != null ? { lat: a.lat, lng: a.lng, tone: tone[o.status] || '', title: `${o.number} · ${G.ui.statusLabel(o.status)} · ${slotText(o)}`, onClick: () => G.go('PED-03', { id: o.id }) } : null; }).filter(Boolean);
    body.appendChild(card('Mapa de entregas de hoy', G.ui.map({ points: pts, height: 320, legend: 'Ámbar: confirmado · azul: en preparación, listo o en ruta · verde: entregado · rojo: no entregado. Toca un pin para abrir el pedido.' })));
  }

  /* =====================================================================
     Registro
     ===================================================================== */
  const SN = Object.fromEntries(G.SPEC.PED.screens.map(s => [s[0], s[1]]));
  G.register({ code: 'PED', name: 'Pedidos', phase: 1, group: 'Ventas y canales', screens: [
    { code: 'PED-01', name: SN['PED-01'], render: renderList },
    { code: 'PED-02', name: SN['PED-02'], render: renderNew },
    { code: 'PED-03', name: SN['PED-03'], render: renderDetail },
    { code: 'PED-04', name: SN['PED-04'], render: renderPicker },
    { code: 'PED-05', name: SN['PED-05'], render: renderConfirm },
    { code: 'PED-06', name: SN['PED-06'], render: renderSlots },
    { code: 'PED-07', name: SN['PED-07'], render: renderWeight },
    { code: 'PED-08', name: SN['PED-08'], render: renderReschedule },
    { code: 'PED-09', name: SN['PED-09'], render: renderCancel },
    { code: 'PED-10', name: SN['PED-10'], render: renderDiscounts },
    { code: 'PED-11', name: SN['PED-11'], render: renderProvince },
    { code: 'PED-12', name: SN['PED-12'], render: renderBalance },
    { code: 'PED-13', name: SN['PED-13'], render: renderReasons },
    { code: 'PED-14', name: SN['PED-14'], render: renderBoard },
  ] });

  /* =====================================================================
     Datos de ejemplo (orden 22)
     ===================================================================== */
  G.seed(22, function seedPED() {
    const r = U.rng(220022);
    // correlativos: el núcleo siembra números explícitos sin avanzar la secuencia
    const maxOf = (t, f, pre) => Math.max(0, ...D.all(t).map(x => Number(String(x[f] || '').replace(pre, '')) || 0));
    D.seq['DG:PED'] = Math.max(D.seq['DG:PED'] || 0, maxOf('sales_orders', 'number', 'P-'));
    D.seq['DG:CB'] = Math.max(D.seq['DG:CB'] || 0, maxOf('payments', 'number', 'CB-'));
    // franjas: la franja de Surco B 10:00–13:00 (CA-PED-06) y minutos de corte de las del núcleo
    for (const s of D.all('order_time_slots')) if (s.cutoff_minutes == null) s.cutoff_minutes = (Number(s.slot_from.slice(0, 2)) * 60 + Number(s.slot_from.slice(3))) - (Number(s.cutoff.slice(0, 2)) * 60 + Number(s.cutoff.slice(3)));
    ins('order_time_slots', { id: 'ts-SURCO-B-1013', establishment_id: 'es-L1', zone_id: 'dz-SURCO-B', name: '10:00–13:00', slot_from: '10:00', slot_to: '13:00', cutoff: '08:30', cutoff_minutes: 90, capacity: 40, weekdays: [1, 2, 3, 4, 5, 6, 0], status: 'ACTIVE' });
    // motivos de cancelación y no entrega
    [['CLIENTE_DESISTIO', 'Cliente desistió', 'CANCEL', false, false], ['SIN_STOCK', 'Sin stock del corte pedido', 'CANCEL', false, false], ['FUERA_COBERTURA', 'Dirección fuera de cobertura', 'CANCEL', false, false], ['DUPLICADO', 'Pedido duplicado', 'CANCEL', true, false], ['PAGO_NO_CONFIRMADO', 'Pago no confirmado', 'CANCEL', false, false], ['BORRADOR_VENCIDO', 'Borrador vencido', 'CANCEL', false, false],
      ['CLIENTE_AUSENTE', 'Cliente ausente', 'NOT_DELIVERED', false, false], ['DIRECCION_ERRADA', 'Dirección errada o incompleta', 'NOT_DELIVERED', true, false], ['RECHAZO_PRODUCTO', 'Cliente rechazó el producto', 'BOTH', true, true], ['SIN_DINERO', 'Cliente sin dinero para pagar', 'NOT_DELIVERED', false, false], ['ACCIDENTE_RUTA', 'Incidente en ruta', 'NOT_DELIVERED', true, true], ['OTRO', 'Otro', 'BOTH', true, false]]
      .forEach(([code, name, ap, note, loss]) => ins('order_cancel_reasons', { id: 'ocr-' + code, code, name, applies_to: ap, requires_note: note, counts_as_loss: loss, status: 'ACTIVE' }));
    // límites de descuento (D-PED-04)
    [['VENDEDORA', null, 5, 20], ['SUPERVISORA_VENTAS', null, 15, 100], ['CAJERO', null, 3, 10], ['VENDEDORA', 'br-M5', 8, 20]].forEach(([role, b, p, a], i) => ins('discount_limits', { id: 'dl-' + (i + 1), role, role_id: role, brand_id: b, max_pct: p, max_amount: a, status: 'ACTIVE' }));
    const all = D.all('sales_orders');
    const today = all.filter(o => o.created_at.slice(0, 10) === G.TODAY);
    const tomorrow = G.date.add(G.TODAY, 1);
    // historial en tabla para los pedidos con historial
    for (const o of all) if (o.history && o.history.length) for (let i = 1; i < o.history.length; i++) { const x = o.history[i]; ins('sales_order_status_history', { order_id: o.id, order_number: o.number, from_status: x.from, to_status: x.to, reason: x.reason || null, changed_at: x.at, changed_by: o.seller_id, changed_by_name: x.user }); }
    // franja Surco B 10:00–13:00: los pedidos de mañana en Surco B de la mañana pasan a ella
    for (const o of all.filter(o => o.delivery_date === tomorrow && o.zone_id === 'dz-SURCO-B' && o.slot_id === 'ts-L1-1' && o.fulfillment === 'DELIVERY')) { o.slot_id = 'ts-SURCO-B-1013'; o.slot_from = '10:00'; o.slot_to = '13:00'; }
    // clientes sin confirmar el resumen
    all.filter(o => o.status === 'CONFIRMED' && o.delivery_date >= G.TODAY && o.channel !== 'WEB').slice(0, 7).forEach(o => { o.customer_confirmed_at = null; o.confirmation_channel = null; });
    // descuentos: 3 por aprobar en borradores de hoy, 1 dentro del límite y 2 resueltos
    const drafts = today.filter(o => o.status === 'DRAFT' && o.lines.length && o.seller_id);
    const sellerName = id => (D.get('users', id) || {}).name;
    const mkDisc = (o, pct, reason, st, decider, at) => { o.order_discount = 0; G.orders.recalc(o); const base = R(U.sum(o.lines, l => l.est_amount)); o.order_discount = R(base * pct / 100); o.order_discount_pct = pct; o.discount_reason = reason; G.orders.recalc(o); o.discount_status = st === 'PENDING' ? 'PENDING_APPROVAL' : st; ins('order_discount_approvals', { order_id: o.id, order_number: o.number, brand_id: o.brand_id, establishment_id: o.establishment_id, requested_by: o.seller_id, requested_by_name: sellerName(o.seller_id), requested_role: 'VENDEDORA', requested_pct: pct, requested_amount: o.order_discount, order_base: base, reason, status: st, requested_at: at || o.created_at, decided_by: decider ? 'us-pleon' : null, decided_by_name: decider ? 'Patricia León Vera' : null, decided_at: decider ? G.date.add((at || o.created_at).slice(0, 10), 0) + 'T' + U.pad(9 + Math.floor(r() * 8), 2) + ':15' : null, decision_note: decider ? (st === 'APPROVED' ? 'Cliente frecuente: aprobado' : 'Fuera de política') : null }); };
    [[10, 'Cliente frecuente: 3 pedidos este mes'], [12, 'Compensación por demora del pedido anterior'], [8, 'Pedido para evento (volumen)']].forEach(([p, why], i) => { if (drafts[i]) mkDisc(drafts[i], p, why, 'PENDING'); });
    if (drafts[3]) { const o = drafts[3]; o.order_discount = 0; G.orders.recalc(o); o.order_discount_pct = 3; o.order_discount = R(U.sum(o.lines, l => l.est_amount) * 0.03); o.discount_reason = 'Redondeo'; G.orders.recalc(o); o.discount_status = 'APPLIED'; }
    const oct = all.filter(o => o.created_at >= '2026-10-02' && o.created_at < '2026-10-09' && o.status === 'CLOSED' && o.seller_id);
    if (oct[3]) mkDisc(oct[3], 10, 'Reclamo por demora', 'APPROVED', true, oct[3].created_at);
    if (oct[11]) mkDisc(oct[11], 20, 'Cliente pide precio mayorista', 'REJECTED', true, oct[11].created_at);
    if (oct[11]) { oct[11].order_discount = 0; oct[11].order_discount_pct = 0; G.orders.recalc(oct[11]); }
    // avisos de peso enviados (octubre)
    for (const o of all.filter(o => o.weight_diff_status === 'NOTICE_SENT' && o.created_at >= '2026-10-01')) {
      const wd = weightDiff(o);
      ins('order_weight_notices', { order_id: o.id, order_number: o.number, brand_id: o.brand_id, establishment_id: o.establishment_id, estimated_total: o.estimated_total, final_total: o.final_total, diff_pct: wd.pct, message: `Hola, tu pedido ${o.number} pesó ${F.num(wd.real, 3)} kg (estimado ${F.num(wd.est, 3)} kg). El total pasa a ${F.money(o.final_total)}.`, channel: r() < 0.8 ? 'WHATSAPP' : 'PHONE', sent_at: (o.confirmed_at || o.created_at).slice(0, 10) + 'T' + U.pad(10 + Math.floor(r() * 6), 2) + ':' + U.pad(Math.floor(r() * 60), 2), sent_by: o.seller_id, customer_response: r() < 0.85 ? 'ACCEPTED' : 'NO_RESPONSE', responded_at: null, cost: 0 });
    }
    // reprogramaciones de octubre
    const rs = all.filter(o => o.created_at >= '2026-10-01' && o.created_at < '2026-10-10' && ['CLOSED', 'DELIVERED'].includes(o.status) && o.fulfillment === 'DELIVERY');
    const RR = ['Cliente pidió otro día', 'Cliente ausente', 'Ruta saturada', 'Falta de stock del corte'];
    for (let i = 0; i < 9 && i * 7 < rs.length; i++) { const o = rs[i * 7]; const old = G.date.add(o.delivery_date, -1); ins('order_reschedules', { order_id: o.id, order_number: o.number, brand_id: o.brand_id, establishment_id: o.establishment_id, old_date: old, old_slot_from: o.slot_from, new_date: o.delivery_date, new_slot_from: o.slot_from, new_slot_id: o.slot_id, reason: RR[i % RR.length], fee_charged: 0, from_status: 'CONFIRMED', rescheduled_by: o.seller_id, rescheduled_by_name: sellerName(o.seller_id) || 'Tienda web', at: old + 'T16:20' }); o.reschedule_count = 1; }
    // un pedido de hoy no entregado (cliente ausente)
    const ir = today.find(o => o.status === 'IN_ROUTE' && o.fulfillment === 'DELIVERY' && o.delivery_date === G.TODAY);
    if (ir) { const at = G.TODAY + 'T' + (ir.slot_from || '10:00').slice(0, 2) + ':40'; ir.history.push({ at, from: 'IN_ROUTE', to: 'NOT_DELIVERED', user: G.userName(ir.driver_user_id), reason: 'Cliente ausente · tocó el timbre y llamó 2 veces' }); ir.status = 'NOT_DELIVERED'; ir.not_delivered_reason_code = 'CLIENTE_AUSENTE'; ir.not_delivered_at = at; ins('sales_order_status_history', { order_id: ir.id, order_number: ir.number, from_status: 'IN_ROUTE', to_status: 'NOT_DELIVERED', reason: 'Cliente ausente', changed_at: at, changed_by: ir.driver_user_id, changed_by_name: G.userName(ir.driver_user_id) }); }
    // saldos: decisiones ya registradas en pedidos entregados de octubre
    for (const o of all.filter(o => ['DELIVERED', 'CLOSED'].includes(o.status) && o.created_at >= '2026-10-01' && o.created_at < G.TODAY)) {
      const bal = G.orders.balance(o); if (Math.abs(bal) < 0.005) continue;
      if (bal > 0) { o.balance_mode = 'CUSTOMER_CREDIT'; o.balance_amount = bal; o.balance_decided_at = o.delivered_at; o.balance_decided_by_name = 'Sistema (D-PED-05)'; ins('customer_balance_movements', { customer_id: o.customer_id, movement_type: o.final_total != null && o.final_total < o.estimated_total ? 'WEIGHT_DIFFERENCE' : 'OVERPAYMENT', amount: bal, order_id: o.id, payment_id: (o.payment_ids || [])[0] || null, reason: `Saldo a favor del pedido ${o.number}`, brand_id: o.brand_id, at: o.delivered_at }); }
      else if (o.status === 'CLOSED') { o.balance_mode = 'COLLECT_ON_DELIVERY'; o.balance_amount = bal; o.balance_decided_at = o.delivered_at; o.balance_decided_by_name = sellerName(o.seller_id) || 'Tienda web'; }
    }
    // provincia: clientes con dirección de destino y pedidos por agencia
    let olva = D.find('suppliers', s => s.trade_name === 'Olva Courier');
    if (!olva) olva = ins('suppliers', { id: 'su-OLVA', doc_type: 'RUC', doc_number: U.rucCheck('2010012345'), legal_name: 'OLVA COURIER SAC', trade_name: 'Olva Courier', supplier_type: 'DELIVERY_COMPANY', phone: '+5117140909', email: 'empresas@olva.pe', status: 'ACTIVE', payment_terms_days: 0, sunat_status: 'ACTIVE', rating: 4, default_cost_center_id: 'cc-DEL' });
    const andinos = D.find('suppliers', s => s.supplier_type === 'DELIVERY_COMPANY' && /provincia/i.test(s.trade_name || '')) || olva;
    [['cu-PROV2', 'Rocío Huamaní Quispe', '45677120', '+51984223311', 'Cusco', 'Av. El Sol 820, Cusco', 'Frente a Coricancha, tienda de artesanías', -13.5205, -71.9790], ['cu-PROV3', 'Gonzalo Arteaga Ruiz', '41902255', '+51949556677', 'Trujillo', 'Jr. Pizarro 455, Trujillo', 'Altura de la Plaza de Armas, 2.º piso', -8.1116, -79.0287]]
      .forEach(([id, n, dni, ph, city, line, ref, lat, lng]) => { ins('customers', { id, doc_type: 'DNI', doc_number: dni, full_name: n, phone: ph, email: null, customer_type: 'PERSON', source_channel: 'WHATSAPP', marketing_opt_in: true, status: 'ACTIVE', orders_count: 1 }); ins('customer_addresses', { id: 'ad-' + id.slice(3), customer_id: id, label: city, address_line: line, reference: ref, ubigeo: null, lat, lng, zone_id: 'dz-PROVINCIA', contact_name: n, contact_phone: ph, is_default: true, status: 'ACTIVE', pin_source: 'COORDINATES' }); });
    const mk = (d, at, chain) => {
      const o = G.orders.create(d); o.created_at = at; o.history = [{ at, from: null, to: 'DRAFT', user: sellerName(d.seller_id) }];
      let t = at; for (const s of chain) { const nt = t.slice(0, 11) + U.pad(Math.min(20, Number(t.slice(11, 13)) + 1), 2) + t.slice(13); o.history.push({ at: nt, from: o.status, to: s, user: sellerName(d.seller_id) }); if (s === 'CONFIRMED') { o.confirmed_at = nt; o.customer_confirmed_at = nt; o.confirmation_channel = 'WHATSAPP'; } if (s === 'DELIVERED') o.delivered_at = nt; if (s === 'CLOSED') o.closed_at = nt; o.status = s; t = nt; }
      return o;
    };
    const pay = (o, pm, amount, at) => { const p = G.pay.register({ customer_id: o.customer_id, payment_method_id: pm, amount, reference: 'OP' + (40000000 + Math.floor(r() * 9999999)), allocations: [{ order_id: o.id, document_id: null, amount }], brand_id: o.brand_id, establishment_id: o.establishment_id, at, silent: true }); return p; };
    const sel1 = 'us-atorres';
    const p1 = mk({ customer_id: 'cu-PROV1', brand_id: 'br-DG', channel: 'WHATSAPP', fulfillment: 'PROVINCE_SHIPPING', address_id: 'ad-PROV1', delivery_date: G.TODAY, payment_method_id: 'pm-TRANSFER', notes: 'Congelar 24 h antes del despacho', seller_id: sel1, origin_wa_number: '+51987650101', lines: [{ variant_id: 'va-DG-CUY-CNG', qty: 6 }, { variant_id: 'va-DG-CAL-1L', qty: 4 }], extra: { province_agency: andinos.id, province_destination: 'Arequipa', thermal_packaging: true } }, '2026-10-09T10:12', ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY']);
    p1.lines.forEach(l => { if (l.price_basis === 'KG') { l.weighed_kg = R(l.est_weight_kg * 1.03, 3); l.weight_source = 'SCALE'; } }); G.orders.recalc(p1); p1.weight_diff_status = 'WITHIN_TOLERANCE'; pay(p1, 'pm-TRANSFER', p1.estimated_total, '2026-10-09T10:40');
    const p2 = mk({ customer_id: 'cu-PROV2', brand_id: 'br-DG', channel: 'WHATSAPP', fulfillment: 'PROVINCE_SHIPPING', address_id: 'ad-PROV2', delivery_date: tomorrow, payment_method_id: 'pm-YAPE', notes: 'Sin indicaciones', seller_id: 'us-bramos', origin_wa_number: '+51987650102', lines: [{ variant_id: 'va-DG-CUY-CNG', qty: 4 }, { variant_id: 'va-DG-CHO-500', qty: 3 }], extra: { province_agency: olva.id, province_destination: 'Cusco', thermal_packaging: true } }, G.TODAY + 'T09:05', ['CONFIRMED']);
    pay(p2, 'pm-YAPE', p2.estimated_total, G.TODAY + 'T09:20');
    const p3 = mk({ customer_id: 'cu-PROV3', brand_id: 'br-DG', channel: 'PHONE', fulfillment: 'PROVINCE_SHIPPING', address_id: 'ad-PROV3', delivery_date: '2026-10-08', payment_method_id: 'pm-TRANSFER', notes: 'Embalar por separado el caldo', seller_id: sel1, lines: [{ variant_id: 'va-DG-CUY-CNG', qty: 5 }, { variant_id: 'va-DG-CAL-500', qty: 6 }], extra: { province_agency: andinos.id, province_destination: 'Trujillo', thermal_packaging: true, tracking_number: 'AC-77812345', dispatch_guide_number: 'T001-00000003' } }, '2026-10-07T15:30', ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE']);
    p3.lines.forEach(l => { if (l.price_basis === 'KG') { l.weighed_kg = R(l.est_weight_kg * 0.98, 3); l.weight_source = 'SCALE'; } }); G.orders.recalc(p3); p3.weight_diff_status = 'WITHIN_TOLERANCE'; pay(p3, 'pm-TRANSFER', p3.estimated_total, '2026-10-07T16:10');
    const p4 = mk({ customer_id: 'cu-PROV1', brand_id: 'br-DG', channel: 'WHATSAPP', fulfillment: 'PROVINCE_SHIPPING', address_id: 'ad-PROV1', delivery_date: '2026-10-03', payment_method_id: 'pm-YAPE', notes: 'Sin indicaciones', seller_id: sel1, lines: [{ variant_id: 'va-DG-CUY-CNG', qty: 8 }], extra: { province_agency: andinos.id, province_destination: 'Arequipa', thermal_packaging: true, tracking_number: 'AC-77790012', dispatch_guide_number: 'T001-00000001' } }, '2026-10-02T11:00', ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED', 'CLOSED']);
    p4.lines.forEach(l => { l.weighed_kg = R(l.est_weight_kg * 1.01, 3); l.weight_source = 'SCALE'; }); G.orders.recalc(p4); p4.weight_diff_status = 'WITHIN_TOLERANCE'; pay(p4, 'pm-YAPE', p4.final_total, '2026-10-02T11:30');
    if (D.seq['DG:T001'] === undefined) { const t = D.find('document_series', s => s.series === 'T001'); if (t && t.next_number < 4) t.next_number = 4; }
    // importados con datos faltantes (vista de incompletos, CA-PED-11) y borradores viejos (RN-PED-18)
    const pers = D.where('customers', c => c.customer_type === 'PERSON' && c.id.startsWith('cu-0'));
    [['cu-0031', 'va-DG-CUY-ENT', 2], ['cu-0047', 'va-DG-CON-ENT', 1], ['cu-0102', 'va-DG-POL-ENT', 1]].forEach(([cid, v, q], i) => {
      const c = D.get('customers', cid) || pers[i];
      const o = G.orders.create({ customer_id: c.id, brand_id: 'br-DG', channel: 'PHONE', fulfillment: 'DELIVERY', seller_id: 'us-pleon', lines: [{ variant_id: v, qty: q }], external_ref: 'IMP-PLANILLA-' + (i + 1), extra: { imported: true, import_batch: 'Planilla de pedidos de papel 10/10' } });
      o.created_at = G.TODAY + 'T07:5' + i; o.history[0].at = o.created_at; o.history[0].user = 'Importación (planilla)'; o.address_id = i === 0 ? null : o.address_id; o.notes = i === 2 ? 'Sin indicaciones' : null; G.orders.recalc(o);
    });
    [['cu-0012', '2026-10-07T11:20', 'va-DG-PAT-ENT'], ['cu-0088', '2026-10-08T08:05', 'va-DG-GAL-ENT']].forEach(([cid, at, v]) => {
      const o = G.orders.create({ customer_id: cid, brand_id: 'br-DG', channel: 'WHATSAPP', fulfillment: 'DELIVERY', seller_id: 'us-bramos', lines: [{ variant_id: v, qty: 1 }], notes: 'Sin indicaciones' });
      o.created_at = at; o.history[0].at = at; o.history[0].user = 'Betty Ramos Cruz';
    });
  }, 'pedidos');

  /* =====================================================================
     Pruebas de aceptación (CA-PED-01 … CA-PED-11)
     ===================================================================== */
  const T = (name, fn) => G.tests.push({ module: 'PED', name, fn });
  const tomorrowT = () => G.date.add(G.TODAY, 1);
  const pickupCuy = (n = 2, extra = {}) => G.orders.create(Object.assign({ customer_id: 'cu-0001', brand_id: 'br-DG', channel: 'WHATSAPP', fulfillment: 'PICKUP', establishment_id: 'es-L1', delivery_date: tomorrowT(), slot_id: 'ts-L1-1', payment_method_id: 'pm-YAPE', notes: 'Sin indicaciones', lines: [{ variant_id: 'va-DG-CUY-ENT', qty: n }] }, extra));
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (!String(e.message).startsWith(code)) throw new Error(`Se esperaba ${code} y salió: ${e.message}`); return e; } throw new Error(`Se esperaba el rechazo ${code}`); };
  const near = (a, b, msg) => { if (Math.abs(a - b) > 0.005) throw new Error(`${msg}: ${a} ≠ ${b}`); };
  T('CA-PED-01: borrador de WhatsApp sin dirección, franja ni pago se rechaza con RN-PED-01 y lista lo que falta', async () => {
    const o = G.orders.create({ customer_id: 'cu-0005', brand_id: 'br-DG', channel: 'WHATSAPP', fulfillment: 'DELIVERY', notes: 'Sin indicaciones', lines: [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }] });
    o.address_id = null; o.slot_id = null; o.payment_method_id = null; o.delivery_date = null; G.orders.recalc(o);
    const e = expectFail(() => G.ped.confirm(o), 'RN-PED-01');
    for (const c of ['DIRECCION_CON_PIN', 'FRANJA', 'FORMA_DE_PAGO']) if (!e.message.includes(c)) throw new Error('El mensaje no lista ' + c + ': ' + e.message);
    if (o.status !== 'DRAFT') throw new Error('El pedido no debe confirmarse');
  });
  T('CA-PED-02: 2 cuyes (0,900 kg, S/ 42/kg) estimado S/ 75,60; pesa 1,960 kg → S/ 82,32 y pasa a LISTO sin aviso', async () => {
    const o = pickupCuy(2);
    near(o.estimated_total, 75.60, 'Total estimado');
    G.ped.confirm(o); G.orders.transition(o, 'IN_PREPARATION');
    const r = G.ped.weigh(o, o.lines[0].id, 1.960, 'SCALE');
    near(o.final_total, 82.32, 'Total final'); if (r.over) throw new Error('8,9 % está dentro de la tolerancia');
    if (Math.abs(r.diff_pct - 8.9) > 0.05) throw new Error('Diferencia esperada 8,9 %: ' + r.diff_pct);
    G.orders.transition(o, 'READY'); if (o.status !== 'READY') throw new Error('Debe pasar a LISTO');
  });
  T('CA-PED-03: con 2,100 kg (16,7 %) queda «aviso requerido», no pasa a LISTO y tras el aviso por WhatsApp sí', async () => {
    const o = pickupCuy(2); G.ped.confirm(o); G.orders.transition(o, 'IN_PREPARATION');
    const r = G.ped.weigh(o, o.lines[0].id, 2.100, 'SCALE');
    if (!r.over || o.weight_diff_status !== 'NOTICE_REQUIRED') throw new Error('Debe quedar aviso requerido');
    if (Math.abs(r.diff_pct - 16.7) > 0.05) throw new Error('Diferencia esperada 16,7 %: ' + r.diff_pct);
    expectFail(() => G.orders.transition(o, 'READY'), 'RN-PED-05');
    G.ped.weightNotice(o, { channel: 'WHATSAPP', inServiceWindow: true });
    G.orders.transition(o, 'READY'); if (o.status !== 'READY') throw new Error('Tras el aviso debe pasar a LISTO');
    if (!D.find('order_weight_notices', n => n.order_id === o.id)) throw new Error('Falta el registro del aviso');
  });
  T('CA-PED-04: pagó S/ 90,00 por Yape, total final S/ 82,32 → saldo a favor S/ 7,68 y se cierra', async () => {
    const o = pickupCuy(2); G.ped.confirm(o);
    G.pay.register({ customer_id: o.customer_id, payment_method_id: 'pm-YAPE', amount: 90, reference: 'OP55112233', allocations: [{ order_id: o.id, amount: 90 }], brand_id: o.brand_id, establishment_id: o.establishment_id });
    G.orders.transition(o, 'IN_PREPARATION'); G.ped.weigh(o, o.lines[0].id, 1.960); G.orders.transition(o, 'READY'); G.orders.transition(o, 'DELIVERED');
    near(G.ped.balance(o), 7.68, 'Saldo');
    const m = D.find('customer_balance_movements', x => x.order_id === o.id);
    if (!m) throw new Error('No se registró el saldo a favor'); near(m.amount, 7.68, 'Saldo a favor');
    G.ped.close(o); if (o.status !== 'CLOSED') throw new Error('Debe cerrarse');
  });
  T('CA-PED-05: vendedora con límite 5 % aplica 10 % a S/ 200 → por aprobar; ella no aprueba; la supervisora sí y se confirma', async () => {
    const prev = G.ctx.role;
    try {
      G.ctx.role = 'VENDEDORA';
      const o = G.orders.create({ customer_id: 'cu-0001', brand_id: 'br-DG', channel: 'WHATSAPP', fulfillment: 'PICKUP', establishment_id: 'es-L1', delivery_date: tomorrowT(), slot_id: 'ts-L1-2', payment_method_id: 'pm-YAPE', notes: 'Sin indicaciones', lines: [{ variant_id: 'va-DG-CHO-500', qty: 5 }, { variant_id: 'va-DG-CAL-500', qty: 5 }] });
      near(o.estimated_total, 200, 'Pedido de S/ 200');
      const r = G.ped.setDiscount(o, 10, 'Cliente frecuente');
      if (!r.over || o.discount_status !== 'PENDING_APPROVAL') throw new Error('Debe quedar pendiente de aprobación'); near(o.order_discount, 20, 'Descuento');
      expectFail(() => G.ped.confirm(o), 'RN-PED-11');
      const a = D.find('order_discount_approvals', x => x.order_id === o.id && x.status === 'PENDING');
      expectFail(() => G.ped.decideDiscount(a.id, true), 'RN-PED-11');
      G.ctx.role = 'SUPERVISORA_VENTAS';
      G.ped.decideDiscount(a.id, true, 'Aprobado');
      G.ped.confirm(o); if (o.status !== 'CONFIRMED') throw new Error('Debe confirmarse tras la aprobación');
      near(o.estimated_total, 180, 'Total con descuento');
    } finally { G.ctx.role = prev; }
  });
  T('CA-PED-06: franja Surco-B 10:00–13:00 con cupo 40 y 40 confirmados → el pedido 41 se rechaza con RN-PED-06', async () => {
    const d = tomorrowT(); const slot = D.get('order_time_slots', 'ts-SURCO-B-1013');
    if (!slot || slot.capacity !== 40 || slot.slot_from !== '10:00') throw new Error('Falta la franja Surco-B 10:00–13:00 de 40');
    const addrs = D.where('customer_addresses', a => a.zone_id === 'dz-SURCO-B' && a.customer_id.startsWith('cu-0'));
    let i = 0;
    while (G.ped.slotUse(slot.id, d) < 40) { const a = addrs[i++ % addrs.length]; const o = G.orders.create({ customer_id: a.customer_id, brand_id: 'br-DG', address_id: a.id, delivery_date: d, slot_id: slot.id, payment_method_id: 'pm-YAPE', notes: 'Sin indicaciones', lines: [{ variant_id: 'va-DG-CAL-1L', qty: 1 }] }); o.status = 'CONFIRMED'; }
    if (G.ped.slotUse(slot.id, d) !== 40) throw new Error('Deben quedar 40 confirmados');
    const a = addrs[0];
    const o41 = G.orders.create({ customer_id: a.customer_id, brand_id: 'br-DG', address_id: a.id, delivery_date: d, slot_id: slot.id, payment_method_id: 'pm-YAPE', notes: 'Sin indicaciones', lines: [{ variant_id: 'va-DG-CAL-1L', qty: 1 }] });
    const e = expectFail(() => G.ped.confirm(o41), 'RN-PED-06');
    if (!/40 de 40/.test(e.message)) throw new Error('El mensaje debe indicar 40 de 40: ' + e.message);
  });
  T('CA-PED-07: 3 cuyes en Surco-B → delivery S/ 0; 2 cuyes → S/ 10', async () => {
    const a = D.find('customer_addresses', x => x.zone_id === 'dz-SURCO-B' && x.customer_id.startsWith('cu-0'));
    const o3 = G.orders.create({ customer_id: a.customer_id, brand_id: 'br-DG', address_id: a.id, lines: [{ variant_id: 'va-DG-CUY-ENT', qty: 3 }] });
    const o2 = G.orders.create({ customer_id: a.customer_id, brand_id: 'br-DG', address_id: a.id, lines: [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }] });
    if (o3.zone_id !== 'dz-SURCO-B') throw new Error('La zona debe ser Surco-B');
    near(o3.delivery_fee, 0, 'Delivery con 3 cuyes'); near(o2.delivery_fee, 10, 'Delivery con 2 cuyes');
    near(G.ped.deliveryFee(o2), 10, 'deliveryFee');
  });
  T('CA-PED-08: EN RUTA → NO ENTREGADO por «Cliente ausente» → reprogramado al día siguiente vuelve a CONFIRMADO con 1 reprogramación y 3 cambios', async () => {
    const a = D.find('customer_addresses', x => x.zone_id === 'dz-SURCO-A' && x.customer_id.startsWith('cu-0'));
    const o = G.orders.create({ customer_id: a.customer_id, brand_id: 'br-DG', address_id: a.id, delivery_date: G.TODAY, slot_id: 'ts-L1-3', payment_method_id: 'pm-CASH', notes: 'Sin indicaciones', lines: [{ variant_id: 'va-DG-CAL-1L', qty: 2 }] });
    G.orders.transition(o, 'CONFIRMED'); G.orders.transition(o, 'IN_PREPARATION'); G.orders.transition(o, 'READY'); G.orders.transition(o, 'IN_ROUTE');
    G.ped.notDelivered(o, { reason_code: 'CLIENTE_AUSENTE' });
    G.ped.reschedule(o, { date: tomorrowT(), slot_id: 'ts-L1-1', reason: 'Cliente ausente' });
    if (o.status !== 'CONFIRMED') throw new Error('Debe volver a CONFIRMADO');
    if (o.reschedule_count !== 1) throw new Error('El contador debe ser 1');
    const last3 = o.history.slice(-3).map(x => x.to).join(',');
    if (last3 !== 'IN_ROUTE,NOT_DELIVERED,CONFIRMED') throw new Error('Historial: ' + last3);
    if (!D.find('order_reschedules', r => r.order_id === o.id)) throw new Error('Falta la reprogramación');
  });
  T('CA-PED-09: en EN PREPARACIÓN cambiar la cantidad se rechaza con RN-PED-07; registrar el peso real sí', async () => {
    const o = pickupCuy(2); G.ped.confirm(o); G.orders.transition(o, 'IN_PREPARATION');
    expectFail(() => G.ped.updateLine(o, o.lines[0].id, { qty: 3 }), 'RN-PED-07');
    expectFail(() => G.ped.addLine(o, { variant_id: 'va-DG-CAL-1L', qty: 1 }), 'RN-PED-07');
    G.ped.weigh(o, o.lines[0].id, 1.85); if (o.lines[0].weighed_kg !== 1.85) throw new Error('El peso real debe registrarse');
  });
  T('CA-PED-10: en un pedido de Don Guando no se agrega la mermelada de la marca gourmet (RN-PED-02)', async () => {
    const o = pickupCuy(1);
    expectFail(() => G.ped.addLine(o, { variant_id: 'va-M5-MER-AGU', qty: 1 }), 'RN-PED-02');
  });
  T('CA-PED-11: KPI-PED-03 de setiembre vale 0 % y los importados con datos faltantes están en la vista de incompletos', async () => {
    const k = G.kpi('KPI-PED-03', { from: '2026-09-01', to: '2026-09-30', brand: null, site: null });
    if (!k || k.value !== 0) throw new Error('KPI-PED-03 debe ser 0 %: ' + JSON.stringify(k));
    if (!(k.denominator >= 900)) throw new Error('Se esperaban ~1000 pedidos confirmados: ' + k.denominator);
    const inc = G.ped.incomplete();
    if (!inc.some(o => o.imported)) throw new Error('Los importados con datos faltantes deben aparecer en la vista de incompletos');
    if (inc.some(o => o.status !== 'DRAFT' && !o.imported)) throw new Error('Ningún pedido confirmado debe tener datos faltantes');
  });
})();
