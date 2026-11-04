/* =====================================================================
   Servicios de dominio compartidos (núcleo de Aycha)
   Parámetros, módulos activables, períodos, series, impuestos, inventario
   (única puerta), precios, pedidos, comprobantes, cobros, eventos,
   mensajería, indicadores y alcance por marca y local.
   ===================================================================== */
(function () {
  const U = G.util;
  const R = (n, d = 2) => U.round(n, d);
  /** Error de regla de negocio: el mensaje empieza con el código (RN-…) */
  G.RuleError = class extends Error { constructor(code, msg, data) { super(`${code}: ${msg}`); this.code = code; this.data = data; } };
  G.fail = (code, msg, data) => { throw new G.RuleError(code, msg, data); };

  /* ---------- permisos especiales desde las especificaciones ---------- */
  G.PERM_INFO = {};
  for (const [m, spec] of Object.entries(G.SPEC)) for (const [perm, desc, roles] of spec.perms) {
    G.PERM_INFO[perm] = { module: m, desc, roles };
    for (const role of roles) (G.PERMS[role] = G.PERMS[role] || []).push(perm);
  }
  G.PERMS.GERENTE = '*';

  /* ---------- parámetros (PLT-10) ---------- */
  const parseDefault = v => {
    const s = String(v ?? '').trim();
    if (/^(sí|si)$/i.test(s) || s === 'true') return true;
    if (/^no$/i.test(s) || s === 'false') return false;
    if (/^vac[ií]o$/i.test(s) || s === '') return null;
    if (/^-?\d[\d ]*([.,]\d+)?$/.test(s)) return Number(s.replace(/ /g, '').replace(',', '.'));
    try { return JSON.parse(s); } catch (e) { return s; }
  };
  G.PARAM_DEFS = {};
  for (const [m, spec] of Object.entries(G.SPEC)) for (const [rawKey, def, desc] of spec.params) {
    for (const key of rawKey.replace(/\s*\((plataforma|tenant)\)/g, '').split(/\s*\/\s*/)) {
      const scope = /\(plataforma\)/.test(rawKey) ? 'PLATFORM' : 'TENANT';
      const parts = String(def).split(/\s*\/\s*/);
      const value = rawKey.includes('/') ? parseDefault(parts[rawKey.split('/').findIndex(k => k.includes(key))] ?? def) : parseDefault(def);
      G.PARAM_DEFS[key.trim()] = { key: key.trim(), module: m, default: value, raw: def, desc, scope };
    }
  }
  /** Valor vigente: el más específico (marca o local) gana al de la empresa; si no hay, el valor por defecto de la especificación */
  G.param = function (key, scope) {
    const rows = G.db.where('parameters', p => p.key === key && !p.voided);
    const pick = (sc, id) => rows.filter(p => p.scope === sc && (!id || p.scope_id === id)).sort(U.by('created_at', -1))[0];
    const hit = (scope && scope.brand && pick('BRAND', scope.brand)) || (scope && scope.site && pick('ESTABLISHMENT', scope.site)) || pick('TENANT');
    if (hit) return hit.value;
    const d = G.PARAM_DEFS[key];
    return d ? U.clone(d.default) : undefined;
  };
  G.setParam = function (key, value, reason, scope = {}) {
    if (!reason) G.fail('RN-PLT-06', 'Cambiar un parámetro exige motivo.');
    const sc = scope.brand ? 'BRAND' : scope.site ? 'ESTABLISHMENT' : 'TENANT';
    const scope_id = scope.brand || scope.site || null;
    const before = G.param(key, scope);
    const prev = G.db.find('parameters', p => p.key === key && p.scope === sc && (p.scope_id || null) === scope_id && !p.voided);
    if (prev) G.db.update('parameters', prev.id, { value, reason }, { silent: true });
    else G.db.insert('parameters', { key, scope: sc, scope_id, value, reason, description: (G.PARAM_DEFS[key] || {}).desc }, { silent: true });
    G.db.insert('parameter_history', { key, scope: sc, scope_id, old_value: before, new_value: value, reason, changed_by: G.ctx.userName(), changed_at: G.date.now() }, { silent: true });
    G.audit('PARAMETRO', 'parameters', key, `${key}: ${JSON.stringify(before)} → ${JSON.stringify(value)} · ${reason}`);
    return value;
  };

  /* ---------- módulos activables (RN-PLT-07) ---------- */
  G.modOn = function (code) { const t = G.db.find('tenant_modules', x => x.module_code === code); return t ? !!t.enabled : !!G.SPEC[code] && G.ctx.tenant === 'DG'; };
  G.assertMod = function (code) { if (!G.modOn(code)) G.fail('RN-PLT-07', `El módulo ${code} está desactivado para esta empresa (la API responde 403). Actívalo en PLT-12.`); };
  G.setModule = function (code, enabled, reason) {
    const t = G.db.find('tenant_modules', x => x.module_code === code);
    if (!reason) G.fail('RN-PLT-07', 'Activar o desactivar un módulo exige motivo.');
    if (t) G.db.update('tenant_modules', t.id, { enabled, reason, changed_at: G.date.now(), changed_by: G.ctx.userName() });
    else G.db.insert('tenant_modules', { module_code: code, phase: (G.SPEC[code] || {}).phase, enabled, reason, changed_at: G.date.now(), changed_by: G.ctx.userName() });
    G.events.emit(enabled ? 'module.enabled' : 'module.disabled', { module: code });
  };

  /* ---------- nombres y etiquetas ---------- */
  const nm = (t, id, f = 'name') => { const r = G.db.get(t, id); return r ? r[f] : '—'; };
  G.brandName = id => id ? nm('brands', id).split(' · ')[0] : 'Todas';
  G.brandFull = id => nm('brands', id);
  G.siteName = id => id ? (G.db.get('establishments', id) || {}).short || nm('establishments', id) : '—';
  G.whName = id => nm('warehouses', id);
  G.userName = id => id ? nm('users', id) : '—';
  G.userShort = id => { const n = id ? nm('users', id) : '—'; return n === '—' ? n : n.split(' ').slice(0, 2).join(' '); };
  G.custName = id => { const c = G.db.get('customers', id); return c ? (c.trade_name || c.full_name) : '—'; };
  G.supName = id => { const s = G.db.get('suppliers', id); return s ? (s.trade_name || s.legal_name) : '—'; };
  G.variant = id => G.db.get('product_variants', id);
  G.variantName = id => nm('product_variants', id);
  G.productOf = vid => { const v = G.variant(vid); return v ? G.db.get('products', v.product_id) : null; };
  G.pmName = id => nm('payment_methods', id);
  G.zoneName = id => nm('delivery_zones', id);
  G.ccName = id => { const c = G.db.get('cost_centers', id); return c ? `${c.code} · ${c.name}` : '—'; };
  G.CHANNELS = [['WHATSAPP', 'WhatsApp'], ['WEB', 'Web (WooCommerce)'], ['TIKTOK', 'TikTok'], ['FACEBOOK', 'Facebook'], ['INSTAGRAM', 'Instagram'], ['PHONE', 'Teléfono'], ['COUNTER', 'Mostrador'], ['B2B', 'Empresas (B2B)'], ['CONSIGNMENT', 'Consignación'], ['OTHER', 'Otro']];
  G.channelName = c => (G.CHANNELS.find(x => x[0] === c) || [c, c])[1];
  G.FULFILL = [['DELIVERY', 'Delivery'], ['PICKUP', 'Recojo en local'], ['COUNTER', 'Mostrador'], ['PROVINCE_SHIPPING', 'Envío a provincia']];
  G.fulfillName = c => (G.FULFILL.find(x => x[0] === c) || [c, c])[1];
  G.DOC_TYPES = [['INVOICE', 'Factura'], ['RECEIPT', 'Boleta'], ['CREDIT_NOTE', 'Nota de crédito'], ['DEBIT_NOTE', 'Nota de débito'], ['INTERNAL_NOTE', 'Nota interna'], ['NONE', 'Sin comprobante'], ['DISPATCH_GUIDE', 'Guía de remisión']];
  G.docTypeName = c => (G.DOC_TYPES.find(x => x[0] === c) || [c, c])[1];
  G.SALE_MODES = [['UNIT', 'Por unidad'], ['KG', 'Por kg'], ['UNIT_VARIABLE_WEIGHT', 'Unidad con peso variable']];
  G.saleModeName = c => (G.SALE_MODES.find(x => x[0] === c) || [c, c])[1];
  G.ORDER_STATUS = ['DRAFT', 'CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED', 'NOT_DELIVERED', 'CANCELLED', 'CLOSED'];

  /* ---------- alcance por marca y local (selector superior + alcance del usuario) ---------- */
  G.scope = {
    user() { const s = G.ctx.session; return s ? G.db.get('users', s.user_id) : null; },
    brands() { const u = G.scope.user(); const all = G.db.where('brands', b => b.status !== 'SEPARATED' || true); return u && u.brands && u.brands.length ? all.filter(b => u.brands.includes(b.id)) : all; },
    sites() { const u = G.scope.user(); const all = G.db.all('establishments'); return u && u.sites && u.sites.length ? all.filter(e => u.sites.includes(e.id)) : all; },
    /** ¿la fila entra en el filtro activo de marca y local? */
    ok(row, { brand = 'brand_id', site = 'establishment_id' } = {}) {
      if (!row) return false;
      const bs = G.scope.brands().map(b => b.id), ss = G.scope.sites().map(e => e.id);
      const b = row[brand], s = row[site];
      if (b && !bs.includes(b)) return false;
      if (s && !ss.includes(s)) return false;
      if (G.ctx.brand !== 'ALL' && b && b !== G.ctx.brand) return false;
      if (G.ctx.site !== 'ALL' && s && s !== G.ctx.site) return false;
      return true;
    },
    filter(rows, opts) { return rows.filter(r => G.scope.ok(r, opts)); },
  };

  /* ---------- períodos (RN-PLT-05) ---------- */
  G.period = {
    of(date) { return G.db.find('accounting_periods', p => p.period === G.date.month(date)); },
    isClosed(date) { const p = G.period.of(date); return !!p && p.status === 'CLOSED'; },
    assertOpen(date) { if (G.period.isClosed(date)) G.fail('RN-PLT-05', `El período ${G.date.monthName(date)} está cerrado: no se registran documentos con esa fecha. Reábrelo con motivo en PLT-09.`); },
  };

  /* ---------- series y numeración sin saltos (RN-PLT-03) ---------- */
  G.series = {
    next(seriesCode) {
      const s = G.db.find('document_series', x => x.series === seriesCode);
      if (!s) G.fail('RN-PLT-03', `No existe la serie ${seriesCode}.`);
      if (s.status !== 'ACTIVE') G.fail('RN-PLT-03', `La serie ${seriesCode} está inactiva.`);
      const number = s.next_number; s.next_number += 1; G.db.touch();
      return { series: s.series, number, full: `${s.series}-${U.pad(number, 8)}`, series_id: s.id };
    },
    /** serie electrónica de la marca para el tipo de comprobante (mostrador usa B010 para boletas) */
    for(docType, brand_id, opts = {}) {
      if (opts.counter && docType === 'RECEIPT') return 'B010';
      const s = G.db.find('document_series', x => x.doc_type === docType && x.brand_id === brand_id && x.status === 'ACTIVE' && (!opts.appliesTo || x.applies_to === opts.appliesTo));
      if (s) return s.series;
      const g = G.db.find('document_series', x => x.doc_type === docType && x.status === 'ACTIVE');
      return g ? g.series : null;
    },
  };

  /* ---------- impuestos (IGV 18 %; catálogo 07: 10 gravado, 20 exonerado, 30 inafecto) ---------- */
  G.tax = {
    rate: () => (G.param('fac_igv_rate') ?? 18) / 100,
    split(amount, includesIgv = true, affectation = '10') {
      const t = Number(amount) || 0;
      if (affectation !== '10') return { base: R(t), igv: 0, total: R(t) };
      const rt = G.tax.rate();
      if (includesIgv) { const base = R(t / (1 + rt)); return { base, igv: R(t - base), total: R(t) }; }
      const igv = R(t * rt); return { base: R(t), igv, total: R(t + igv) };
    },
  };

  /* ---------- eventos de dominio (02-mapa §3) ---------- */
  G.events = {
    subs: {},
    on(name, fn) { (this.subs[name] = this.subs[name] || []).push(fn); },
    emit(name, payload = {}) {
      if (G._seeding) return; // durante la siembra no se disparan suscriptores (datos deterministas)
      G.db.insert('domain_events', { name, payload: JSON.parse(JSON.stringify(payload, (k, v) => (k === 'lines' || k === 'history') ? undefined : v)), at: G.date.now(), user: G.ctx.userName(), status: 'DISPATCHED' }, { silent: true });
      for (const fn of (this.subs[name] || [])) { try { fn(payload); } catch (e) { if (e instanceof G.RuleError) throw e; console.error('Error en suscriptor de ' + name, e); } }
    },
  };
  /** notificación interna (INT): a un usuario o a todos los de un rol */
  G.notify = function ({ user_id, role, title, body, ref, tone = 'info', module }) {
    const targets = user_id ? [user_id] : G.db.where('users', u => u.role === role && u.status === 'ACTIVE').map(u => u.id);
    for (const uid of targets) G.db.insert('notifications', { user_id: uid, title, body, ref, tone, module, read_at: null, at: G.date.now() }, { silent: true });
  };

  /* ---------- inventario: única puerta (RN-ALM-01) ---------- */
  const balKey = (wh, v, lot) => `${wh}|${v}|${lot || ''}`;
  G.inv = {
    _bal(wh, variant, lot) { return G.db.find('stock_balances', b => b.warehouse_id === wh && b.variant_id === variant && (b.lot_id || null) === (lot || null)); },
    /** saldo físico (qty) o disponible (qty − reservado) por variante; wh opcional; lots: solo liberados */
    qty(variant, wh, opts = {}) {
      return R(U.sum(G.db.where('stock_balances', b => b.variant_id === variant && (!wh || b.warehouse_id === wh) && (!opts.releasedOnly || G.inv.lotUsable(b.lot_id))), b => opts.available ? b.qty - (b.reserved_qty || 0) : b.qty), 3);
    },
    weight(variant, wh) { return R(U.sum(G.db.where('stock_balances', b => b.variant_id === variant && (!wh || b.warehouse_id === wh)), b => b.weight_kg || 0), 3); },
    avg(variant, wh) { const bs = G.db.where('stock_balances', b => b.variant_id === variant && (!wh || b.warehouse_id === wh) && b.qty > 0); const q = U.sum(bs, b => b.qty); return q ? R(U.sum(bs, b => b.qty * b.avg_cost) / q, 4) : (G.variant(variant) || {}).std_cost || 0; },
    lotUsable(lotId) { if (!lotId) return true; const l = G.db.get('lots', lotId); return !!l && l.qc_status === 'RELEASED' && (!l.expiry_date || l.expiry_date >= G.TODAY); },
    /** lotes con saldo en FEFO (vence primero, sale primero) */
    fefo(variant, wh, opts = {}) {
      return G.db.where('stock_balances', b => b.variant_id === variant && (!wh || b.warehouse_id === wh) && b.qty - (opts.ignoreReserved ? 0 : (b.reserved_qty || 0)) > 0.0005 && (opts.anyQuality || G.inv.lotUsable(b.lot_id)))
        .map(b => ({ b, lot: b.lot_id ? G.db.get('lots', b.lot_id) : null }))
        .sort((a, c) => String(a.lot ? a.lot.expiry_date : '9999').localeCompare(String(c.lot ? c.lot.expiry_date : '9999')) || String(a.b.warehouse_id).localeCompare(c.b.warehouse_id));
    },
    /**
     * Movimiento de stock (kardex de solo inserción + saldo).
     * move({type:'RECEIPT'|'SALE'|'RETURN'|'TRANSFER_OUT'|'TRANSFER_IN'|'PRODUCTION_IN'|'PRODUCTION_OUT'|'ADJUSTMENT'|'WASTE'|'CONSIGNMENT_OUT'|'CONSIGNMENT_RETURN'|'REVERSAL',
     *       wh, variant, lot, qty (positivo; el signo lo pone el tipo; ADJUSTMENT acepta ±), weight, unitCost, source:{type,id}, at, reason, allowNegative, allowUnreleased})
     * Sin lote en una salida de un producto con lote: reparte por FEFO entre lotes liberados.
     * Devuelve { moves:[…], total_cost, unit_cost }.
     */
    move(o) {
      const IN = ['RECEIPT', 'RETURN', 'TRANSFER_IN', 'PRODUCTION_IN', 'CONSIGNMENT_RETURN'];
      const OUT = ['SALE', 'TRANSFER_OUT', 'PRODUCTION_OUT', 'WASTE', 'CONSIGNMENT_OUT'];
      if (![...IN, ...OUT, 'ADJUSTMENT', 'REVERSAL'].includes(o.type)) G.fail('RN-ALM-01', 'Tipo de movimiento no válido: ' + o.type);
      const v = G.variant(o.variant); if (!v) G.fail('RN-ALM-01', 'Producto no encontrado.');
      const wh = G.db.get('warehouses', o.wh); if (!wh) G.fail('RN-ALM-01', 'Almacén no encontrado.');
      const at = o.at || G.date.now();
      if (!G._seeding) G.period.assertOpen(at.slice(0, 10));
      const p = G.db.get('products', v.product_id);
      let sign = IN.includes(o.type) ? 1 : OUT.includes(o.type) ? -1 : Math.sign(o.qty) || 1;
      const qty = Math.abs(Number(o.qty));
      if (!(qty > 0)) G.fail('RN-ALM-01', 'La cantidad debe ser mayor que cero.');
      // salida sin lote de un producto con lote: FEFO
      if (sign < 0 && !o.lot && p.requires_lot) {
        const parts = G.inv.fefo(o.variant, o.wh, { ignoreReserved: !!o.fromReserved, anyQuality: !!o.allowUnreleased });
        let left = qty; const res = { moves: [], total_cost: 0 };
        for (const { b } of parts) { if (left <= 0.0005) break; const take = Math.min(left, b.qty - (o.fromReserved ? 0 : (b.reserved_qty || 0))); if (take <= 0) continue; const w = o.weight ? R(o.weight * take / qty, 3) : null; const r1 = G.inv.move(Object.assign({}, o, { lot: b.lot_id, qty: sign < 0 && o.type === 'ADJUSTMENT' ? -take : take, weight: w })); res.moves.push(...r1.moves); res.total_cost += r1.total_cost; left = R(left - take, 3); }
        if (left > 0.0005 && !o.allowNegative) G.fail('RN-ALM-03', `Stock insuficiente de ${v.name} en ${wh.name}: faltan ${G.fmt.num(left, 3)} ${v.sale_mode === 'UNIT' ? 'u' : v.sale_mode === 'KG' ? 'kg' : 'u'} en lotes liberados.`);
        if (left > 0.0005) { const r1 = G.inv.move(Object.assign({}, o, { lot: null, qty: left, allowNegative: true })); res.moves.push(...r1.moves); res.total_cost += r1.total_cost; }
        res.total_cost = R(res.total_cost); res.unit_cost = R(res.total_cost / qty, 4); return res;
      }
      if (o.lot && sign < 0 && !o.allowUnreleased && !G.inv.lotUsable(o.lot)) { const l = G.db.get('lots', o.lot); G.fail('RN-ALM-02', `El lote ${l ? l.code : o.lot} no está liberado o está vencido (${l ? G.ui.statusLabel(l.qc_status) : '—'}): no se puede despachar.`); }
      let bal = G.inv._bal(o.wh, o.variant, o.lot);
      if (!bal) bal = G.db.insert('stock_balances', { warehouse_id: o.wh, variant_id: o.variant, lot_id: o.lot || null, qty: 0, weight_kg: 0, reserved_qty: 0, avg_cost: 0 }, { silent: true });
      if (sign < 0 && bal.qty - qty < -0.0005 && !o.allowNegative && !(G.param('alm_allow_negative_stock') === true)) G.fail('RN-ALM-03', `Stock insuficiente de ${v.name} en ${wh.name}: hay ${G.fmt.num(bal.qty, 3)} y se piden ${G.fmt.num(qty, 3)}.`);
      const unit = sign > 0 ? (o.unitCost != null ? Number(o.unitCost) : (bal.avg_cost || v.std_cost || 0)) : (bal.avg_cost || v.std_cost || 0);
      if (sign > 0) { const newQ = bal.qty + qty; bal.avg_cost = newQ > 0 ? R((bal.qty * bal.avg_cost + qty * unit) / newQ, 6) : unit; }
      bal.qty = R(bal.qty + sign * qty, 3);
      if (o.weight != null) bal.weight_kg = R((bal.weight_kg || 0) + sign * Math.abs(o.weight), 3);
      else if (v.sale_mode === 'KG') bal.weight_kg = bal.qty;
      if (sign < 0 && o.fromReserved) bal.reserved_qty = Math.max(0, R((bal.reserved_qty || 0) - qty, 3));
      const mv = G.db.insert('stock_movements', { warehouse_id: o.wh, variant_id: o.variant, lot_id: o.lot || null, movement_type: o.type, qty: R(sign * qty, 3), weight_kg: o.weight != null ? R(sign * Math.abs(o.weight), 3) : null, unit_cost: R(unit, 6), total_cost: R(sign * qty * unit), source_type: (o.source || {}).type || 'MANUAL', source_id: (o.source || {}).id || null, moved_at: at, reason: o.reason || null, user: G.ctx.userName(), bal_qty: bal.qty, reversal_of: o.reversal_of || null }, { silent: true });
      G.db.touch();
      if (!G._seeding) G.events.emit('stock.moved', { movement_id: mv.id, type: o.type, variant: o.variant, wh: o.wh, qty: mv.qty, total_cost: mv.total_cost });
      return { moves: [mv], total_cost: Math.abs(mv.total_cost), unit_cost: unit };
    },
    transfer({ from, to, variant, lot, qty, weight, source, at, reason }) {
      const out = G.inv.move({ type: 'TRANSFER_OUT', wh: from, variant, lot, qty, weight, source, at, reason });
      for (const m of out.moves) G.inv.move({ type: 'TRANSFER_IN', wh: to, variant, lot: m.lot_id, qty: Math.abs(m.qty), weight: m.weight_kg != null ? Math.abs(m.weight_kg) : null, unitCost: m.unit_cost, source, at, reason });
      return out;
    },
    /** almacenes de venta del local por prioridad */
    saleWarehouses(site) { return G.db.where('warehouses', w => w.establishment_id === site && w.allows_sale && w.status === 'ACTIVE').sort(U.by('pick_priority')); },
    /** reserva por FEFO para un pedido confirmado (RN-ALM-09 / RN-PED-17). Devuelve los faltantes. */
    reserve(order, opts = {}) {
      const short = []; order.reservations = [];
      for (const l of order.lines) {
        let need = l.qty;
        for (const w of G.inv.saleWarehouses(order.establishment_id)) {
          for (const { b } of G.inv.fefo(l.variant_id, w.id)) { if (need <= 0.0005) break; const take = Math.min(need, b.qty - (b.reserved_qty || 0)); if (take <= 0) continue; b.reserved_qty = R((b.reserved_qty || 0) + take, 3); order.reservations.push({ line_id: l.id, balance_id: b.id, wh: b.warehouse_id, lot_id: b.lot_id, qty: R(take, 3) }); need = R(need - take, 3); }
        }
        if (need > 0.0005) short.push({ variant_id: l.variant_id, qty: need });
      }
      order.stock_short = short.length ? short : null; G.db.touch();
      return short;
    },
    release(order) {
      for (const rs of order.reservations || []) { const b = G.db.get('stock_balances', rs.balance_id); if (b) b.reserved_qty = Math.max(0, R((b.reserved_qty || 0) - rs.qty, 3)); }
      order.reservations = []; G.db.touch();
    },
  };

  /* ---------- precios por marca y canal (RN-CAT-05) ---------- */
  G.price = {
    listFor(brand_id, channel, customer_id) {
      const c = customer_id && G.db.get('customers', customer_id);
      if (c && c.price_list_id) return c.price_list_id;
      const l = G.db.find('price_lists', p => p.brand_id === brand_id && p.status === 'ACTIVE' && (p.channels || []).includes(channel));
      return l ? l.id : null;
    },
    /** {price, basis, list_id} vigente o null */
    of(variant_id, { brand_id, channel = 'WHATSAPP', customer_id, date = G.TODAY } = {}) {
      const v = G.variant(variant_id); if (!v) return null;
      const special = customer_id && G.db.find('customer_prices', p => p.customer_id === customer_id && p.variant_id === variant_id && p.valid_from <= date && (!p.valid_to || p.valid_to >= date) && p.status !== 'REJECTED');
      if (special) return { price: special.price, basis: special.basis || (v.sale_mode === 'UNIT' ? 'UNIT' : 'KG'), list_id: 'CUSTOMER' };
      const list = G.price.listFor(brand_id || v.brand_id, channel, customer_id);
      const l = G.db.where('price_list_items', x => x.list_id === list && x.variant_id === variant_id && x.valid_from <= date && (!x.valid_to || x.valid_to >= date)).sort(U.by('valid_from', -1))[0];
      return l ? { price: l.price, basis: l.basis, list_id: list } : null;
    },
  };

  /* ---------- pedidos (servicio común: PED, CRM, WEB, POS, B2B, CON, API) ---------- */
  G.orders = {
    /** recalcula importes: estimado (peso estimado) y final (peso real) · RN-PED-04, delivery RN-PED-09 */
    recalc(o) {
      let est = 0, fin = 0, allWeighed = true, units = 0, kg = 0, disc = 0;
      for (const l of o.lines || []) {
        const basisQty = l.price_basis === 'KG' ? (l.est_weight_kg ?? l.qty) : l.qty;
        const gross = basisQty * l.unit_price;
        l.discount_amount = R(gross * (l.discount_pct || 0) / 100);
        l.est_amount = R(gross - l.discount_amount);
        est += l.est_amount; disc += l.discount_amount;
        if (l.price_basis === 'KG') { kg += basisQty; const v = G.variant(l.variant_id); if (v && v.sale_mode === 'UNIT_VARIABLE_WEIGHT') units += l.qty; if (l.weighed_kg != null) { const g2 = l.weighed_kg * l.unit_price; l.final_amount = R(g2 - g2 * (l.discount_pct || 0) / 100); } else { l.final_amount = null; allWeighed = false; } }
        else { units += l.qty; l.final_amount = l.est_amount; }
        fin += l.final_amount ?? 0;
      }
      o.delivery_fee = G.orders.deliveryFee(o, { units, kg, amount: est });
      o.discount_total = R(disc + (o.order_discount || 0));
      o.estimated_total = R(est + o.delivery_fee - (o.order_discount || 0));
      o.final_total = allWeighed && (o.lines || []).length ? R(fin + o.delivery_fee - (o.order_discount || 0)) : null;
      o.units = units; o.est_kg = R(kg, 3);
      return o;
    },
    deliveryFee(o, { units, kg, amount }) {
      if (!['DELIVERY', 'PROVINCE_SHIPPING'].includes(o.fulfillment)) return 0;
      const z = o.zone_id && G.db.get('delivery_zones', o.zone_id); if (!z) return 0;
      if (o.fee_override != null) return o.fee_override;
      if ((z.free_from_units && units >= z.free_from_units) || (z.free_from_kg && kg >= z.free_from_kg) || (z.free_from_amount && amount >= z.free_from_amount)) return 0;
      return z.delivery_fee;
    },
    /** datos obligatorios que faltan (RN-PED-01): devuelve códigos */
    missing(o) {
      const m = []; const counter = o.fulfillment === 'COUNTER' || o.channel === 'COUNTER';
      const c = o.customer_id && G.db.get('customers', o.customer_id);
      if (!c) m.push('CLIENTE');
      if (!counter && !(o.contact_phone || (c && c.phone))) m.push('CELULAR');
      if (o.requested_doc_type === 'INVOICE') { const bc = G.db.get('customers', o.billing_customer_id || o.customer_id); if (!bc || bc.doc_type !== 'RUC' || !U.rucOk(bc.doc_number)) m.push('RUC_VALIDO'); }
      if (o.requested_doc_type === 'RECEIPT' && (o.estimated_total || 0) > (G.param('fac_receipt_id_required_above') ?? 700)) { const bc = G.db.get('customers', o.billing_customer_id || o.customer_id); if (!bc || !bc.doc_number) m.push('DOCUMENTO_CLIENTE'); }
      if (['DELIVERY', 'PROVINCE_SHIPPING'].includes(o.fulfillment)) { const a = o.address_id && G.db.get('customer_addresses', o.address_id); if (!a || a.lat == null || !a.reference) m.push('DIRECCION_CON_PIN'); }
      if (o.fulfillment === 'PICKUP' && !o.pickup_establishment_id) m.push('LOCAL_DE_RECOJO');
      if (o.fulfillment === 'PROVINCE_SHIPPING' && !o.province_agency) m.push('AGENCIA');
      if (!counter && (!o.delivery_date || (o.fulfillment !== 'PROVINCE_SHIPPING' && !o.slot_id))) m.push('FRANJA');
      if (!(o.lines || []).length) m.push('PRODUCTOS');
      if ((o.lines || []).some(l => l.price_basis === 'KG' && !(l.est_weight_kg > 0))) m.push('PESO_ESTIMADO');
      if (!o.payment_method_id) m.push('FORMA_DE_PAGO');
      if (!counter && !o.notes) m.push('NOTAS_DE_PREPARACION');
      return m;
    },
    TRANSITIONS: { DRAFT: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['DRAFT', 'IN_PREPARATION', 'CANCELLED', 'DELIVERED'], IN_PREPARATION: ['WEIGHED', 'READY', 'CANCELLED'], WEIGHED: ['READY', 'IN_PREPARATION', 'CANCELLED'], READY: ['IN_ROUTE', 'CANCELLED', 'DELIVERED'], IN_ROUTE: ['DELIVERED', 'NOT_DELIVERED'], NOT_DELIVERED: ['CONFIRMED', 'IN_ROUTE', 'CANCELLED'], DELIVERED: ['CLOSED'], CANCELLED: [], CLOSED: [] },
    canTransition(o, to) {
      if (!(G.orders.TRANSITIONS[o.status] || []).includes(to)) return false;
      if (o.status === 'CONFIRMED' && to === 'DELIVERED') return o.fulfillment === 'COUNTER';
      if (o.status === 'READY' && to === 'DELIVERED') return ['PICKUP', 'COUNTER'].includes(o.fulfillment);
      return true;
    },
    /** cambia el estado con historial (RN-PED-03) y emite el evento correspondiente */
    transition(o, to, { reason, user, at, silent } = {}) {
      if (typeof o === 'string') o = G.db.get('sales_orders', o);
      if (!G.orders.canTransition(o, to)) G.fail('RN-PED-03', `No se puede pasar el pedido ${o.number} de «${G.ui.statusLabel(o.status)}» a «${G.ui.statusLabel(to)}».`);
      if (to === 'CONFIRMED' && o.status === 'DRAFT') { const m = G.orders.missing(o); if (m.length) G.fail('RN-PED-01', `No se puede confirmar: faltan ${m.join(', ')}.`, { missing: m }); }
      if (to === 'READY' && ['NOTICE_REQUIRED'].includes(o.weight_diff_status)) G.fail('RN-PED-05', 'La diferencia de peso supera la tolerancia: registra el aviso al cliente antes de pasar a LISTO.');
      const from = o.status; const when = at || G.date.now();
      o.history = o.history || [];
      o.history.push({ at: when, from, to, user: user || G.ctx.userName(), reason: reason || null });
      o.status = to;
      if (to === 'CONFIRMED' && !o.confirmed_at) o.confirmed_at = when;
      if (to === 'DELIVERED') o.delivered_at = when;
      if (to === 'CLOSED') o.closed_at = when;
      if (to === 'CANCELLED') { o.cancelled_at = when; o.cancel_reason = reason || o.cancel_reason; G.inv.release(o); }
      G.db.update('sales_orders', o.id, { status: to }, { silent: !!silent });
      const ev = { CONFIRMED: 'order.confirmed', IN_PREPARATION: 'order.in_preparation', WEIGHED: 'order.weighed', READY: 'order.ready', IN_ROUTE: 'order.dispatched', DELIVERED: 'order.delivered', NOT_DELIVERED: 'order.not_delivered', CANCELLED: 'order.cancelled', CLOSED: 'order.closed' }[to];
      if (ev) G.events.emit(ev, { order_id: o.id, number: o.number, from, to });
      return o;
    },
    /** crea un borrador desde cualquier canal. lines: [{variant_id, qty, est_weight_kg?, cut_notes?, discount_pct?}] */
    create(d) {
      const v0 = (d.lines || [])[0] && G.variant(d.lines[0].variant_id);
      const brand_id = d.brand_id || (v0 && v0.brand_id) || 'br-DG';
      const cust = d.customer_id && G.db.get('customers', d.customer_id);
      const addr = d.address_id ? G.db.get('customer_addresses', d.address_id) : (cust && d.fulfillment !== 'COUNTER' && d.fulfillment !== 'PICKUP' ? G.db.find('customer_addresses', a => a.customer_id === cust.id && a.is_default && a.status === 'ACTIVE') : null);
      const zone = addr && addr.zone_id ? G.db.get('delivery_zones', addr.zone_id) : null;
      const channel = d.channel || 'WHATSAPP';
      const o = Object.assign({
        number: G.db.next('PED', 'P-', 6), brand_id, establishment_id: d.establishment_id || (zone ? zone.establishment_id : (G.ctx.site !== 'ALL' ? G.ctx.site : 'es-L1')), channel, customer_id: d.customer_id || null,
        address_id: addr ? addr.id : null, seller_id: d.seller_id !== undefined ? d.seller_id : G.ctx.userId(), fulfillment: d.fulfillment || 'DELIVERY', delivery_date: d.delivery_date || null, slot_id: d.slot_id || null,
        requested_doc_type: d.requested_doc_type || (cust && cust.doc_type === 'RUC' ? 'INVOICE' : 'RECEIPT'), billing_customer_id: d.billing_customer_id || d.customer_id || null, payment_method_id: d.payment_method_id || null,
        status: 'DRAFT', paid_amount: 0, discount_status: 'NONE', weight_diff_status: 'NONE', contact_phone: d.contact_phone || (cust && cust.phone) || null, zone_id: zone ? zone.id : (d.zone_id || null),
        pickup_establishment_id: d.pickup_establishment_id || (d.fulfillment === 'PICKUP' ? (d.establishment_id || 'es-L1') : null), notes: d.notes || null, reschedule_count: 0,
        origin_wa_number: d.origin_wa_number || null, origin_ad_code: d.origin_ad_code || null, origin_utm: d.origin_utm || null, origin_ref: d.origin_ref || null, external_ref: d.external_ref || null,
        history: [{ at: G.date.now(), from: null, to: 'DRAFT', user: G.ctx.userName() }], lines: [],
      }, d.extra || {});
      if (o.slot_id) { const s = G.db.get('order_time_slots', o.slot_id); if (s) { o.slot_from = s.slot_from; o.slot_to = s.slot_to; } }
      for (const ln of d.lines || []) G.orders.addLine(o, ln, { noRecalc: true });
      G.orders.recalc(o);
      const saved = G.db.insert('sales_orders', o);
      G.events.emit('order.created', { order_id: saved.id, number: saved.number, channel });
      return saved;
    },
    /** agrega una línea con precio de lista (RN-PED-02 y RN-PED-10) */
    addLine(o, { variant_id, qty, est_weight_kg, cut_notes, discount_pct = 0 }, opts = {}) {
      if (o.status && !['DRAFT', 'CONFIRMED'].includes(o.status)) G.fail('RN-PED-07', 'Desde EN PREPARACIÓN las líneas no cambian; solo se registra el peso real.');
      const v = G.variant(variant_id);
      if (!v || v.status !== 'ACTIVE' || !v.sellable) G.fail('RN-PED-02', 'Solo se venden presentaciones activas del catálogo.');
      if (v.brand_id !== o.brand_id) G.fail('RN-PED-02', `${v.name} es de ${G.brandName(v.brand_id)} y el pedido es de ${G.brandName(o.brand_id)}: crea un pedido por marca.`);
      const pr = G.price.of(variant_id, { brand_id: o.brand_id, channel: o.channel, customer_id: o.customer_id });
      if (!pr) G.fail('RN-CAT-05', `${v.name} no tiene precio vigente en la lista del canal ${G.channelName(o.channel)}.`);
      const q = Number(qty) || 1;
      const line = { id: U.uid('ol'), variant_id, qty: q, unit_price: pr.price, list_price: pr.price, price_basis: pr.basis, price_list_id: pr.list_id, est_weight_kg: est_weight_kg != null ? Number(est_weight_kg) : (v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? R(q * v.nominal_weight_kg, 3) : v.sale_mode === 'KG' ? q : null), tolerance_pct: v.weight_tolerance_pct ?? null, discount_pct: Number(discount_pct) || 0, weighed_kg: null, final_amount: null, lot_id: null, cut_notes: cut_notes || null };
      o.lines = o.lines || []; o.lines.push(line);
      if (!opts.noRecalc) G.orders.recalc(o);
      return line;
    },
    /** registra el peso real de una línea (PRE o POS) y marca si hace falta aviso (RN-PED-05) */
    weigh(o, line_id, kg, source = 'SCALE') {
      if (typeof o === 'string') o = G.db.get('sales_orders', o);
      const l = o.lines.find(x => x.id === line_id); if (!l) G.fail('RN-PED-04', 'Línea no encontrada.');
      if (l.price_basis !== 'KG') G.fail('RN-PED-04', 'Esta línea se cobra por unidad: no lleva peso.');
      l.weighed_kg = R(Number(kg), 3); l.weight_source = source;
      G.orders.recalc(o);
      const tol = l.tolerance_pct ?? G.param('ped_weight_tolerance_pct') ?? 10;
      const over = o.lines.some(x => x.price_basis === 'KG' && x.weighed_kg != null && Math.abs(x.weighed_kg - x.est_weight_kg) / x.est_weight_kg * 100 > (x.tolerance_pct ?? tol) + 1e-9);
      o.weight_diff_status = over ? 'NOTICE_REQUIRED' : 'WITHIN_TOLERANCE';
      G.db.update('sales_orders', o.id, { weight_diff_status: o.weight_diff_status }, { silent: true });
      if (o.final_total != null) G.events.emit('order.weighed', { order_id: o.id, number: o.number, over });
      return { over, diff_pct: l.est_weight_kg ? R((l.weighed_kg - l.est_weight_kg) / l.est_weight_kg * 100, 1) : 0, final_total: o.final_total };
    },
    balance(o) { const total = o.final_total ?? o.estimated_total; return R((o.paid_amount || 0) - total); },
    label(o) { return `${o.number} · ${G.custName(o.customer_id)}`; },
  };

  /* ---------- comprobantes (FAC; envío al OSE simulado) ---------- */
  G.docs = {
    /** tipo de comprobante: factura con RUC válido; boleta en los demás casos (RN-FAC-01) */
    typeFor(customer, requested) { if (requested === 'INVOICE' && customer && customer.doc_type === 'RUC' && U.rucOk(customer.doc_number)) return 'INVOICE'; return 'RECEIPT'; },
    /** emite comprobante desde las líneas finales del pedido */
    fromOrder(o, opts = {}) {
      const cust = G.db.get('customers', o.billing_customer_id || o.customer_id);
      const type = G.docs.typeFor(cust, o.requested_doc_type);
      const lines = o.lines.map(l => { const v = G.variant(l.variant_id); const amt = l.final_amount ?? l.est_amount; return { variant_id: l.variant_id, description: v.name + (l.price_basis === 'KG' ? ` · ${G.fmt.num(l.weighed_kg ?? l.est_weight_kg, 3)} kg` : ''), qty: l.price_basis === 'KG' ? (l.weighed_kg ?? l.est_weight_kg) : l.qty, uom_code: l.price_basis === 'KG' ? 'KGM' : 'NIU', unit_price: l.unit_price, igv_affectation: '10', total: amt, lot_id: l.lot_id, unit_cost: v.std_cost, cost: R((l.price_basis === 'KG' ? (l.weighed_kg ?? l.est_weight_kg) : l.qty) * v.std_cost) }; });
      if (o.delivery_fee > 0) lines.push({ variant_id: null, description: 'Servicio de delivery', qty: 1, uom_code: 'ZZ', unit_price: o.delivery_fee, igv_affectation: '10', total: o.delivery_fee, cost: 0 });
      return G.docs.issue({ doc_type: type, brand_id: o.brand_id, establishment_id: o.establishment_id, customer_id: cust ? cust.id : o.customer_id, order_id: o.id, lines, date: opts.date, seller_id: o.seller_id, counter: o.channel === 'COUNTER', silent: opts.silent, accept: opts.accept, payment_terms: o.payment_method_id === 'pm-CREDIT' ? 'CREDIT' : 'CASH' });
    },
    /** emite un comprobante: lines [{description, qty, unit_price, total (con IGV), igv_affectation, variant_id}] */
    issue(d) {
      const date = d.date || G.TODAY;
      if (!G._seeding) G.period.assertOpen(date);
      const series = d.series || G.series.for(d.doc_type, d.brand_id, { counter: d.counter, appliesTo: d.applies_to });
      const n = G.series.next(series);
      const cust = G.db.get('customers', d.customer_id) || {};
      const ls = d.lines.map(l => { const t = G.tax.split(l.total, true, l.igv_affectation || '10'); return Object.assign({}, l, { subtotal: t.base, igv: t.igv, total: t.total }); });
      const tot = { subtotal: R(U.sum(ls, l => l.subtotal)), igv: R(U.sum(ls, l => l.igv)), total: R(U.sum(ls, l => l.total)) };
      const doc = G.db.insert('sales_documents', {
        company_id: 'co-dg', establishment_id: d.establishment_id || 'es-L1', brand_id: d.brand_id, series_id: n.series_id, doc_type: d.doc_type, series: n.series, number: n.number, full_number: n.full, issue_date: date,
        customer_id: d.customer_id, customer_doc_type: cust.doc_type, customer_doc_number: cust.doc_number, customer_name: cust.full_name, order_id: d.order_id || null, related_document_id: d.related_document_id || null,
        currency: 'PEN', subtotal: tot.subtotal, igv: tot.igv, total: tot.total, cost: R(U.sum(ls, l => l.cost || 0)), lines: ls, payment_terms: d.payment_terms || 'CASH', due_date: d.payment_terms === 'CREDIT' ? G.date.add(date, d.credit_days || 15) : null,
        sunat_status: d.accept ? 'ACCEPTED' : 'PENDING', status: 'ISSUED', seller_id: d.seller_id || null, note_reason_code: d.note_reason_code || null, note_reason: d.note_reason || null, send_attempts: d.accept ? 1 : 0, sent_at: d.accept ? date + 'T21:00' : null, balance: d.payment_terms === 'CREDIT' ? tot.total : 0,
        xml_hash: d.accept ? U.token(28) : null, tenant: G.ctx.tenant,
      }, { silent: !!d.silent });
      if (!G._seeding) G.events.emit('document.issued', { document_id: doc.id, full_number: doc.full_number, order_id: doc.order_id });
      if (d.accept && !G._seeding) G.events.emit('document.accepted', { document_id: doc.id });
      return doc;
    },
    label(doc) { return doc ? `${G.docTypeName(doc.doc_type)} ${doc.series}-${U.pad(doc.number, 8)}` : '—'; },
  };

  /* ---------- cobros (CAJ) ---------- */
  G.pay = {
    accountFor(pm, { driver_user_id, site } = {}) { return { 'pm-MP': 'ca-MP', 'pm-YAPE': 'ca-YAPE', 'pm-PLIN': 'ca-PLIN', 'pm-TRANSFER': 'ca-BCP-CTE', 'pm-CARD': 'ca-POS-VISA', 'pm-CASH': driver_user_id ? 'ca-DRV-' + driver_user_id.slice(3) : 'ca-CAJA-L1', 'pm-CREDIT': null }[pm]; },
    /** registra un cobro y lo aplica a pedidos o comprobantes (RN-CAJ-02: referencia obligatoria si el medio la exige) */
    register({ customer_id, payment_method_id, amount, reference, cash_account_id, allocations = [], brand_id, establishment_id, at, collected_by_user_id, card_last4, silent }) {
      const pm = G.db.get('payment_methods', payment_method_id); if (!pm) G.fail('RN-CAJ-01', 'Elige el medio de pago.');
      if (!(Number(amount) > 0)) G.fail('RN-CAJ-01', 'El monto debe ser mayor que cero.');
      if (pm.requires_reference && !reference && payment_method_id !== 'pm-CARD') G.fail('RN-CAJ-02', `${pm.name} exige el número de operación.`);
      if (!G._seeding) G.period.assertOpen((at || G.TODAY).slice(0, 10));
      const acc = cash_account_id || G.pay.accountFor(payment_method_id, { driver_user_id: collected_by_user_id });
      const ca = G.db.get('cash_accounts', acc) || {};
      const p = G.db.insert('payments', { number: G.db.next('CB', 'CB-', 6), customer_id, payment_method_id, cash_account_id: acc, amount: R(amount), paid_at: at || G.date.now(), reference: reference || null, status: 'CONFIRMED', brand_id, establishment_id, fee_amount: R(amount * (ca.fee_pct || 0) / 100 + (ca.fee_fixed || 0)), reconciliation_status: ['pm-CASH', 'pm-CREDIT'].includes(payment_method_id) ? 'NOT_APPLICABLE' : 'PENDING', received_by: G.ctx.userId(), collected_by_user_id: collected_by_user_id || null, card_last4: card_last4 || null, allocations }, { silent: !!silent });
      for (const a of allocations) {
        if (a.order_id) { const o = G.db.get('sales_orders', a.order_id); if (o) { o.paid_amount = R((o.paid_amount || 0) + a.amount); (o.payment_ids = o.payment_ids || []).push(p.id); } }
        if (a.document_id) { const doc = G.db.get('sales_documents', a.document_id); if (doc && doc.balance) doc.balance = Math.max(0, R(doc.balance - a.amount)); }
      }
      G.db.touch();
      if (!G._seeding) G.events.emit('payment.confirmed', { payment_id: p.id, amount: p.amount, allocations });
      return p;
    },
  };

  /* ---------- mensajería (CRM): ventanas y costo de WhatsApp (tarifas Perú 01/10/2026) ---------- */
  G.msg = {
    RATES: { MARKETING: 0.2339, UTILITY: 0.0998, AUTHENTICATION: 0.0998, SERVICE: 0 },
    /** costo de un mensaje: plantilla de utilidad dentro de la ventana de servicio = 0; fuera, tarifa; marketing siempre cobra salvo ventana de anuncio (72 h) */
    cost(kind, { inServiceWindow = false, inAdWindow = false } = {}) {
      if (kind === 'SESSION') return 0;
      if (inAdWindow) return 0;
      if (kind === 'UTILITY' && inServiceWindow) return 0;
      const key = { MARKETING: 'crm_wa_rate_marketing', UTILITY: 'crm_wa_rate_utility', AUTHENTICATION: 'crm_wa_rate_utility' }[kind];
      return G.param(key) ?? G.msg.RATES[kind] ?? 0;
    },
    /** escribe un mensaje saliente en `messages` (no se borran) */
    send({ conversation_id, customer_id, channel_id, kind = 'SESSION', template, text, ref, inServiceWindow, inAdWindow }) {
      const cost = G.msg.cost(kind === 'SESSION' ? 'SESSION' : kind, { inServiceWindow, inAdWindow });
      const m = G.db.insert('messages', { conversation_id: conversation_id || null, customer_id, channel_id: channel_id || null, direction: 'OUT', kind, template: template || null, text, ref: ref || null, sent_at: G.date.now(), sender_user_id: G.ctx.userId(), status: 'SENT', cost }, { silent: true });
      G.events.emit('message.sent', { message_id: m.id, kind, cost, ref });
      return m;
    },
  };

  /* ---------- indicadores (TAB): cada módulo registra su cálculo ---------- */
  /** G.kpiCalc['KPI-PED-01'] = ({from, to, brand, site}) => número (o {value, numerator, denominator}) */
  G.kpiCalc = {};
  G.kpi = function (code, opts = {}) {
    const f = G.kpiCalc[code]; if (!f) return null;
    const p = Object.assign({ from: G.date.month(G.TODAY), to: G.TODAY, brand: G.ctx.brand !== 'ALL' ? G.ctx.brand : null, site: G.ctx.site !== 'ALL' ? G.ctx.site : null }, opts);
    try { const v = f(p); return v && typeof v === 'object' ? v : { value: v }; } catch (e) { console.error('KPI ' + code, e); return null; }
  };
  /** ventas cobradas/entregadas por período (apoyo de varios KPI) */
  G.sales = {
    orders({ from, to, brand, site, statuses = ['DELIVERED', 'CLOSED'] } = {}) { return G.db.where('sales_orders', o => statuses.includes(o.status) && (o.delivered_at || o.created_at).slice(0, 10) >= (from || '0000') && (o.delivered_at || o.created_at).slice(0, 10) <= (to || '9999') && (!brand || o.brand_id === brand) && (!site || o.establishment_id === site)); },
    total(os) { return R(U.sum(os, o => o.final_total ?? o.estimated_total)); },
  };
  // indicadores base que calcula el núcleo
  G.kpiCalc['KPI-PED-01'] = p => G.sales.total(G.sales.orders(p));
  G.kpiCalc['KPI-PED-02'] = p => { const os = G.sales.orders(p); return os.length ? R(G.sales.total(os) / os.length) : 0; };

  /* ---------- alertas globales ---------- */
  G.alerts = function () {
    const out = [];
    for (const p of G.alertProviders) { try { out.push(...(p() || [])); } catch (e) { console.error(e); } }
    return out;
  };
  G.alertProviders.push(() => {
    const o = G.db.where('sales_orders', x => x.status === 'DRAFT' && x.created_at.slice(0, 10) === G.TODAY);
    return o.length ? [{ module: 'PED', title: `${o.length} pedidos en borrador hoy`, detail: 'Les faltan datos obligatorios para confirmarse (RN-PED-01).', tone: 'warn', go: () => G.screens['PED-01'] && G.go('PED-01') }] : [];
  });
  G.alertProviders.push(() => {
    const l = G.db.where('lots', x => x.qc_status === 'RELEASED' && x.expiry_date && G.date.diff(x.expiry_date, G.TODAY) <= 2 && G.date.diff(x.expiry_date, G.TODAY) >= 0 && G.inv.qty(x.variant_id) > 0 && G.db.find('stock_balances', b => b.lot_id === x.id && b.qty > 0));
    return l.length ? [{ module: 'ALM', title: `${l.length} lote(s) vencen en 2 días o menos`, detail: l.slice(0, 3).map(x => x.code).join(', '), tone: 'warn', go: () => G.screens['ALM-03'] && G.go('ALM-03') }] : [];
  });
})();
