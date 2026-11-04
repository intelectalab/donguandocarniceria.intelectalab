/* =====================================================================
   WEB · Tienda WooCommerce y pasarela Mercado Pago (WEB-01 … WEB-08)
   Tiendas por marca (D-WEB-01: donguando.com con las marcas como
   categorías), mapeo SKU ↔ variante, stock publicado por lotes usables
   con margen de seguridad (RN-WEB-05), corridas de catálogo, precios,
   stock y pedidos con resultado por SKU, bandeja de pedidos externos
   idempotente por (tienda, pedido externo) (RN-WEB-02), errores con
   reintento (RN-WEB-04), transacciones de Mercado Pago verificadas con
   la API (RN-WEB-06), contracargos y reembolsos (RN-WEB-09) y
   conciliación con la liquidación de Mercado Pago.
   Webhooks: entran por INT (firma, crudo, deduplicación: RN-WEB-01).
   Expone G.web.
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs, pills } = G.ui;
  const U = G.util, F = G.fmt, D = G.db;
  const R = (n, d = 2) => U.round(n, d);
  const money = v => F.money(v);
  const T = { S: 'web_stores', M: 'web_product_mappings', I: 'web_order_inbox', Y: 'web_sync_runs', X: 'gateway_transactions' };

  /* ---------- tiempo (texto ISO sin zona, hora de Lima) ---------- */
  const toMs = s => { const x = String(s || ''); return Date.parse((x.length <= 10 ? x.slice(0, 10) + 'T00:00:00' : x.length <= 16 ? x.slice(0, 16) + ':00' : x.slice(0, 19)) + 'Z'); };
  const addMin = (s, n) => new Date(toMs(s) + n * 60000).toISOString().slice(0, 19);
  const hoursBetween = (a, b) => (toMs(a) - toMs(b)) / 3600000;
  const day = s => String(s || '').slice(0, 10);
  const nowS = () => G.date.now();
  const sec = s => { const x = String(s || ''); return x.length === 16 ? x + ':00' : x.slice(0, 19); };

  /* ---------- catálogos ---------- */
  const STORE_ST = { ACTIVE: ['Activa', 'ok'], TESTING: ['En prueba', 'info'], PENDING: ['Por configurar', 'warn'], DISABLED: ['Desactivada', ''] };
  const INBOX_ST = { RECEIVED: ['Recibido', 'info'], PROCESSED: ['Procesado', 'ok'], ERROR: ['Error', 'bad'], IGNORED: ['Ignorado', ''] };
  const MAP_ST = { LINKED: ['Vinculado', 'ok'], UNLINKED: ['Sin vínculo', 'warn'], ERROR: ['Error', 'bad'] };
  const TX_ST = { approved: ['Aprobada', 'ok'], pending: ['Pendiente', 'warn'], in_process: ['En revisión', 'warn'], rejected: ['Rechazada', 'bad'], cancelled: ['Cancelada', ''], expired: ['Vencida', ''], refunded: ['Reembolsada', 'bad'], charged_back: ['Contracargo', 'bad'] };
  const EV_ST = { PROCESSED: ['Procesado', 'ok'], REJECTED: ['Rechazado', 'bad'], FAILED: ['Fallido', 'bad'], IGNORED: ['Ignorado', ''], RECEIVED: ['Recibido', 'info'] };
  const KIND = { CATALOG: 'Catálogo', PRICES: 'Precios', STOCK: 'Stock', ORDERS: 'Pedidos' };
  const TRIG = { SCHEDULE: 'Programada', MANUAL: 'Manual', SALE: 'Tras una venta' };
  const ERR = { SKU_NOT_MAPPED: 'SKU sin mapeo', VARIANT_INACTIVE: 'Producto inactivo', PHONE_INVALID: 'Celular inválido', ADDRESS_NO_PIN: 'Dirección sin pin', PRICE_MISSING: 'Sin precio web', INVALID_PAYLOAD: 'Datos incompletos', PROCESSING_ERROR: 'Error al crear el pedido' };
  const MP_DETAIL = { accredited: 'acreditado', pending_waiting_payment: 'esperando el pago en PagoEfectivo', pending_contingency: 'en revisión por Mercado Pago', cc_rejected_insufficient_amount: 'fondos insuficientes', cc_rejected_bad_filled_security_code: 'código de seguridad incorrecto', cc_rejected_call_for_authorize: 'el banco pide autorizar la compra', cc_rejected_other_reason: 'rechazado por el banco', cardholder_dispute: 'desconocimiento del tarjetahabiente', refunded_by_seller: 'reembolso hecho por la tienda', expired_by_aycha: 'venció sin aprobación' };
  const PM_WOO = { 'woo-mercado-pago-basic': 'pm-MP', 'woo-mercado-pago-custom': 'pm-MP', 'woo-mercado-pago-pse': 'pm-MP', yape_manual: 'pm-YAPE', bacs: 'pm-TRANSFER' };
  const sb = (map, s) => badge((map[s] || [s])[0], (map[s] || [, ''])[1]);
  const txLabel = s => (TX_ST[s] || [s])[0];
  const wrap = fn => { try { return fn(); } catch (e) { toast(e.message, 'bad'); console.warn(e); return null; } };
  const pre = s => h('pre', { class: 'mono small', style: 'white-space:pre-wrap;word-break:break-all;background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:8px;max-height:280px;overflow:auto;margin:0;max-width:100%' }, s);
  const sel = (options, value, onChange, label) => { const s = h('select', { class: 'input', attrs: { 'aria-label': label || 'Elegir' } }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l))); s.addEventListener('change', () => onChange(s.value)); return s; };
  const timeline = items => h('div', { class: 'timeline' }, items.map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.datetime(x.at)), h('span', { class: 'dot' }), h('div', null, h('b', null, x.title), x.detail ? h('div', { class: 'small muted' }, x.detail) : null))));
  const perm = (p) => { if (!G.can(p)) G.fail(PERM_RN[p] || 'RN-WEB-10', `Tu rol (${G.roleName()}) no tiene el permiso ${p}.`); };
  const PERM_RN = { 'web.store.manage': 'RN-WEB-10', 'web.mapping.manage': 'RN-WEB-03', 'web.sync.run': 'RN-WEB-05', 'web.inbox.resolve': 'RN-WEB-04' };
  const go = (code, params) => { if (G.screens[code]) G.go(code, params); else toast(`La pantalla ${code} no está en este prototipo.`, 'info'); };
  const st = { store: 'ws-DG', tab: null, inbox: null };

  /* =====================================================================
     Tiendas y mapeo
     ===================================================================== */
  const store = id => D.get(T.S, id);
  const stores = () => D.all(T.S);
  const mainStore = () => store('ws-DG') || stores()[0];
  const storeName = id => (store(id) || {}).name || '—';
  const mapsOf = sid => D.where(T.M, m => m.store_id === sid);
  const mapBySku = (sid, sku) => { const k = String(sku || '').trim().toUpperCase(); return D.find(T.M, m => m.store_id === sid && String(m.sku).toUpperCase() === k); };
  const mapByVariant = (sid, vid) => D.find(T.M, m => m.store_id === sid && m.variant_id === vid && m.status !== 'UNLINKED');
  const variantOk = v => !!v && v.status === 'ACTIVE' && !!v.sellable;
  const publishable = v => { if (!v) return false; const p = G.productOf(v.id); return v.web_publishable !== false && !!p && !!p.web_publishable && p.status !== 'INACTIVE'; };
  const inboxOf = (sid, ext) => D.find(T.I, i => i.store_id === sid && i.external_order_id === String(ext));
  const txsOfInbox = ib => D.where(T.X, x => x.store_id === ib.store_id && x.external_reference === ib.external_order_id);

  /** lista de precios de la tienda para la marca de la variante (RN-WEB-08 / RN-CAT-05) */
  function listOf(s, brand) { return (s.price_lists && s.price_lists[brand]) || (brand === s.brand_id ? s.price_list_id : null) || (G.price.listFor ? G.price.listFor(brand, 'WEB') : `pl-${brand.slice(3)}-PUB`); }
  function priceIn(s, vid, date = G.TODAY) {
    const v = G.variant(vid); if (!v) return null;
    const list = listOf(s, v.brand_id);
    const it = D.where('price_list_items', x => x.list_id === list && x.variant_id === vid && x.valid_from <= date && (!x.valid_to || x.valid_to >= date)).sort(U.by('valid_from', -1))[0];
    if (!it) return null;
    const woo = v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? R(it.price * (v.nominal_weight_kg || 1)) : it.price;
    return { price: it.price, basis: it.basis, list_id: list, woo };
  }
  const wooUnit = v => v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? `unidad de ~${F.num(v.nominal_weight_kg, 2)} kg` : v.sale_mode === 'KG' ? 'kg' : 'unidad';

  /* ---------- stock publicado (RN-WEB-05, vista v_web_stock) ---------- */
  function balIndex() { const m = new Map(); for (const b of D.all('stock_balances')) { if (!m.has(b.variant_id)) m.set(b.variant_id, []); m.get(b.variant_id).push(b); } return m; }
  function publishedStock(sOrId, vid, ix) {
    const s = typeof sOrId === 'string' ? store(sOrId) : sOrId;
    const whs = new Set((s && s.warehouse_ids) || []);
    const bals = ((ix || balIndex()).get(vid) || []).filter(b => whs.has(b.warehouse_id));
    const lots = []; let total = 0, reserved = 0, unusable = 0, avail = 0;
    for (const b of bals) {
      if (!((b.qty || 0) > 0.0005) && !((b.reserved_qty || 0) > 0)) continue;
      const l = b.lot_id ? D.get('lots', b.lot_id) : null;
      const usable = G.inv.lotUsable(b.lot_id);
      const why = usable ? null : !l ? 'Lote no encontrado' : l.qc_status !== 'RELEASED' ? G.ui.statusLabel(l.qc_status) : `Vencido el ${F.date(l.expiry_date)}`;
      const free = Math.max(0, R((b.qty || 0) - (b.reserved_qty || 0), 3));
      total += b.qty || 0;
      if (usable) { reserved += b.reserved_qty || 0; avail += free; } else unusable += b.qty || 0;
      lots.push({ wh: b.warehouse_id, lot_id: b.lot_id, lot: l ? l.code : 'Sin lote', expiry: l ? l.expiry_date : null, qc: l ? l.qc_status : null, qty: R(b.qty || 0, 3), reserved: R(b.reserved_qty || 0, 3), free, usable, why });
    }
    const margin = Number((s && s.safety_margin_pct) || 0);
    const raw = R(avail * (1 - margin / 100), 4);
    return { total: R(total, 3), reserved: R(reserved, 3), unusable: R(unusable, 3), available: R(avail, 3), margin, raw, published: Math.max(0, Math.floor(raw + 1e-9)), lots };
  }
  const stockFormula = x => `${F.num(x.available, x.available % 1 ? 3 : 0)} × ${F.num(1 - x.margin / 100, 2)} = ${F.num(x.raw, 2)} → ${x.published}`;

  /** fija lo «último enviado» de los mapeos sembrados con el stock vigente (los saldos se terminan de sembrar después de WEB) */
  function finalize() {
    let ix = null;
    for (const m of D.all(T.M)) if (m.last_stock_sent === undefined) { ix = ix || balIndex(); const s = store(m.store_id); const pub = m.variant_id && s && m.publish ? publishedStock(s, m.variant_id, ix).published : null; m.last_stock_sent = pub == null ? null : Math.max(0, pub + (m.seed_stock_offset || 0)); }
  }
  /** estado frente a lo vigente: precio y stock que corresponden y problemas (KPI-WEB-04) */
  function mapState(m, ix) {
    const s = store(m.store_id); const v = m.variant_id && G.variant(m.variant_id);
    const out = { price: null, stock: null, issues: [] };
    if (m.status === 'ERROR') out.issues.push('ERROR');
    if (m.status === 'UNLINKED' || !v || !s) return out;
    const wp = priceIn(s, v.id); out.price = wp ? wp.woo : null;
    out.stock = publishedStock(s, v.id, ix).published;
    if (!variantOk(v)) out.issues.push('VARIANT_INACTIVE');
    if (m.publish) {
      if (out.price == null) out.issues.push('PRICE_MISSING');
      else if (m.last_price_sent == null || Math.abs(m.last_price_sent - out.price) > 0.004) out.issues.push('PRICE');
      if (s.sync_stock && m.last_stock_sent !== out.stock) out.issues.push('STOCK');
    }
    return out;
  }
  const activeMaps = sid => D.where(T.M, m => (!sid || m.store_id === sid) && m.publish && ['LINKED', 'ERROR'].includes(m.status) && (store(m.store_id) || {}).status === 'ACTIVE');

  function saveStore(vals, existing) {
    perm('web.store.manage');
    const url = String(vals.url || '').trim().toLowerCase().replace(/\/+$/, '');
    if (!String(vals.name || '').trim()) G.fail('RN-WEB-10', 'Escribe el nombre de la tienda.');
    if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/.test(url)) G.fail('RN-WEB-01', `La URL «${vals.url}» no es válida: la tienda se conecta solo por HTTPS (por ejemplo https://www.donguando.com).`);
    if (D.find(T.S, s => s.url === url && (!existing || s.id !== existing.id))) G.fail('RN-WEB-02', `Ya existe una tienda con la URL ${url}.`);
    const brands = Object.keys(vals).filter(k => k.startsWith('cat_') && vals[k]).map(k => k.slice(4));
    if (!brands.includes(vals.brand_id)) brands.unshift(vals.brand_id);
    const pl = D.get('price_lists', vals.price_list_id);
    if (!pl || pl.brand_id !== vals.brand_id || !(pl.channels || []).includes('WEB')) G.fail('RN-WEB-08', `La lista ${pl ? pl.code || pl.id : '—'} no es de ${G.brandName(vals.brand_id)} para el canal web (RN-CAT-05): elige una lista pública con canal WEB.`);
    const whs = Object.keys(vals).filter(k => k.startsWith('wh_') && vals[k]).map(k => k.slice(3));
    if (!whs.length) G.fail('RN-WEB-05', 'Elige al menos un almacén de stock para la tienda.');
    const bad = whs.map(id => D.get('warehouses', id)).filter(w => !w || w.establishment_id !== vals.establishment_id || !w.allows_sale);
    if (bad.length) G.fail('RN-WEB-05', `${bad.map(w => w ? w.name : '—').join(', ')} no es un almacén de venta de ${G.siteName(vals.establishment_id)}: el stock publicado sale solo de los almacenes de venta del local de la tienda.`);
    const margin = Number(vals.safety_margin_pct);
    if (!(margin >= 0 && margin <= 50)) G.fail('RN-WEB-05', 'El margen de seguridad va de 0 % a 50 %.');
    const seller = vals.default_seller_id ? D.get('users', vals.default_seller_id) : null;
    if (seller && !(seller.brands || []).includes(vals.brand_id)) G.fail('RN-WEB-07', `${seller.name} no atiende ${G.brandName(vals.brand_id)}: elige una vendedora de la marca.`);
    const row = { name: String(vals.name).trim(), url, platform: 'WOOCOMMERCE', brand_id: vals.brand_id, brands, price_list_id: vals.price_list_id, price_lists: Object.fromEntries(brands.map(b => [b, b === vals.brand_id ? vals.price_list_id : `pl-${b.slice(3)}-PUB`])), establishment_id: vals.establishment_id, warehouse_ids: whs, safety_margin_pct: margin, default_seller_id: vals.default_seller_id || null, sync_catalog: !!vals.sync_catalog, sync_prices: !!vals.sync_prices, sync_stock: !!vals.sync_stock, sync_orders: !!vals.sync_orders, connector_id: vals.connector_id || null, payment_connector_id: vals.payment_connector_id || null, split_mixed_cart: true };
    const hist = { at: nowS(), user: G.ctx.userName(), detail: existing ? 'Configuración editada' : 'Tienda creada' };
    if (existing) { D.update(T.S, existing.id, Object.assign(row, { history: (existing.history || []).concat([hist]) })); return store(existing.id); }
    const ep = row.connector_id && D.find('webhook_endpoints', e => e.connector_id === row.connector_id);
    const mep = row.payment_connector_id && D.find('webhook_endpoints', e => e.connector_id === row.payment_connector_id);
    return D.insert(T.S, Object.assign(row, { code: url.replace(/^https:\/\/(www\.)?/, '').split('.')[0].toUpperCase().slice(0, 8), status: 'PENDING', webhook_endpoint_id: ep ? ep.id : null, payment_endpoint_id: mep ? mep.id : null, last_test_at: null, last_test_ok: null, created_by: G.ctx.userName(), history: [hist] }));
  }
  /** prueba de conexión: credenciales en INT (RN-WEB-10) y llamada al adaptador */
  function testStore(id) {
    perm('web.store.manage');
    const s = store(id); let ok = true, msg;
    const creds = s.connector_id ? D.where('integration_credentials', c => c.connector_id === s.connector_id && c.status === 'ACTIVE').map(c => c.name) : [];
    if (!s.connector_id) { ok = false; msg = 'RN-WEB-10: la tienda no tiene conector de WooCommerce en INT; créalo y carga consumer_key y consumer_secret en INT-03.'; }
    else if (G.int && !(creds.includes('consumer_key') || creds.includes('consumer_secret'))) { ok = false; msg = 'RN-WEB-10: faltan las credenciales de WooCommerce (consumer_key y consumer_secret) en INT-03; se cargan cifradas y nunca vuelven al navegador.'; }
    else if (G.int && G.int.testConnection) { try { const r = G.int.testConnection(s.connector_id); ok = r.ok; msg = r.msg; } catch (e) { ok = false; msg = e.message; } }
    else msg = 'Conexión correcta (sin INT en este prototipo: prueba local).';
    D.update(T.S, id, { last_test_at: nowS(), last_test_ok: ok, last_test_msg: msg, history: (s.history || []).concat([{ at: nowS(), user: G.ctx.userName(), detail: `Prueba de conexión: ${ok ? 'correcta' : 'fallida'}` }]) }, { silent: true });
    return { ok, msg };
  }
  function setStoreStatus(id, status, reason) {
    perm('web.store.manage');
    const s = store(id);
    if (!reason || reason.trim().length < 10) G.fail('RN-WEB-10', 'Escribe un motivo de al menos 10 caracteres.');
    if (status === 'ACTIVE' && !s.last_test_ok) G.fail('RN-WEB-10', `Prueba la conexión de ${s.name} con resultado correcto antes de activarla.`);
    D.update(T.S, id, { status, history: (s.history || []).concat([{ at: nowS(), user: G.ctx.userName(), detail: `Estado → ${STORE_ST[status][0]}: ${reason}` }]) });
    return store(id);
  }

  /** vincula un SKU de la web con una variante del catálogo (RN-WEB-03) */
  function mapSku(sid, sku, vid, { reason } = {}) {
    perm('web.mapping.manage');
    const s = store(sid); const v = G.variant(vid); const k = String(sku || '').trim().toUpperCase();
    if (!k) G.fail('RN-WEB-03', 'Escribe el SKU de la web.');
    if (!v) G.fail('RN-WEB-03', 'Elige la variante del catálogo.');
    if (!variantOk(v)) G.fail('RN-WEB-03', `${v.name} está inactiva o no se vende (VARIANT_INACTIVE): elige una variante activa.`);
    if (!(s.brands || []).includes(v.brand_id)) G.fail('RN-WEB-03', `${v.name} es de ${G.brandName(v.brand_id)}, que no se vende en ${s.name}.`);
    const other = D.find(T.M, m => m.store_id === sid && m.variant_id === vid && m.status !== 'UNLINKED' && String(m.sku).toUpperCase() !== k);
    const at = nowS(); const ex = mapBySku(sid, k);
    const hist = { at, user: G.ctx.userName(), detail: `Vinculado a ${v.sku} · ${v.name}${other ? ` (la variante también responde al SKU ${other.sku})` : ''}${reason ? ' · ' + reason : ''}` };
    if (ex) { D.update(T.M, ex.id, { variant_id: vid, brand_id: v.brand_id, status: ex.remote_missing ? 'ERROR' : 'LINKED', publish: publishable(v), linked_at: at, linked_by: G.ctx.userName(), history: (ex.history || []).concat([hist]) }); return D.get(T.M, ex.id); }
    return D.insert(T.M, { store_id: sid, sku: k, variant_id: vid, brand_id: v.brand_id, woo_product_id: nextWooId(), woo_variation_id: 0, woo_name: v.name, status: 'LINKED', publish: publishable(v), web_status: 'publish', last_price_sent: null, last_stock_sent: null, linked_at: at, linked_by: G.ctx.userName(), history: [hist] });
  }
  function unlink(mid, reason) {
    perm('web.mapping.manage');
    if (!reason || reason.trim().length < 10) G.fail('RN-WEB-03', 'Desvincular exige un motivo de al menos 10 caracteres.');
    const m = D.get(T.M, mid);
    D.update(T.M, mid, { status: 'UNLINKED', previous_variant_id: m.variant_id, variant_id: null, publish: false, history: (m.history || []).concat([{ at: nowS(), user: G.ctx.userName(), detail: `Desvinculado de ${G.variantName(m.variant_id)}: ${reason}` }]) });
    return D.get(T.M, mid);
  }
  const nextWooId = () => 1 + Math.max(3300, ...D.all(T.M).map(m => m.woo_product_id || 0));
  /** crea el producto en WooCommerce (por el outbox de INT) y deja el mapeo vinculado */
  function createInWeb(sid, vid) {
    perm('web.mapping.manage');
    const s = store(sid); const v = G.variant(vid);
    if (!variantOk(v) || !publishable(v)) G.fail('RN-WEB-03', `${v ? v.name : 'La variante'} no está activa o no es publicable (web_publishable en CAT).`);
    const wp = priceIn(s, vid); if (!wp) G.fail('RN-WEB-08', `${v.name} no tiene precio vigente en la lista ${listOf(s, v.brand_id)} (RN-CAT-05): sin precio no se publica.`);
    const id = nextWooId(); const ix = balIndex(); const pub = publishedStock(s, vid, ix).published;
    const sent = pushOutbox(s, 'catalog.create', { sku: v.sku, name: v.name, price: wp.woo, stock: pub }, v.sku);
    if (sent && sent.status !== 'SENT') G.fail('RN-WEB-05', `WooCommerce no respondió (${sent.last_error}); el producto queda por crear y el outbox lo reintenta.`);
    const ex = D.find(T.M, m => m.store_id === sid && (m.variant_id === vid || String(m.sku).toUpperCase() === v.sku));
    const patch = { store_id: sid, sku: v.sku, variant_id: vid, brand_id: v.brand_id, woo_product_id: id, woo_variation_id: 0, woo_name: v.name, status: 'LINKED', remote_missing: false, last_error: null, publish: true, web_status: 'publish', last_price_sent: wp.woo, last_price_at: nowS(), last_stock_sent: pub, last_stock_at: nowS(), linked_at: nowS(), linked_by: G.ctx.userName() };
    const hist = { at: nowS(), user: G.ctx.userName(), detail: `Creado en WooCommerce como producto ${id} · ${money(wp.woo)} · stock ${pub}` };
    if (ex) { D.update(T.M, ex.id, Object.assign(patch, { history: (ex.history || []).concat([hist]) })); return D.get(T.M, ex.id); }
    return D.insert(T.M, Object.assign(patch, { history: [hist] }));
  }
  function setPublish(mid, on) {
    perm('web.mapping.manage');
    const m = D.get(T.M, mid); const v = G.variant(m.variant_id);
    if (on && (!variantOk(v) || !publishable(v))) G.fail('RN-WEB-03', `${v ? v.name : 'La variante'} no está activa o tiene web_publishable apagado en CAT: actívala allí antes de publicarla.`);
    D.update(T.M, mid, { publish: !!on, web_status: on ? 'publish' : 'draft', history: (m.history || []).concat([{ at: nowS(), user: G.ctx.userName(), detail: on ? 'Publicado en la web' : 'Retirado de la web (borrador en WooCommerce)' }]) });
    return D.get(T.M, mid);
  }

  /* ---------- envío al proveedor por el outbox de INT ---------- */
  function pushOutbox(s, event, payload, ref) {
    if (!G.int || !G.int.enqueue || !s.connector_id) return null;
    const m = G.int.enqueue({ connector: s.connector_id, module: 'WEB', kind: 'SYNC', event, payload, ref });
    return m ? G.int.dispatch(m.id) : null;
  }

  /* =====================================================================
     Bandeja de pedidos web (RN-WEB-02, -03, -04, -07, -08)
     ===================================================================== */
  const WOO_REMOTE = new Map(); // pedidos en WooCommerce (adaptador falso de la consulta de respaldo)
  const metaOf = p => Object.fromEntries((p.meta_data || []).map(m => [m.key, m.value]));
  const normPhone = raw => { if (raw == null || raw === '') return null; if (G.cli && G.cli.normalizePhone) return G.cli.normalizePhone(raw); const d = String(raw).replace(/\D/g, ''); return d.length === 9 ? '+51' + d : d.startsWith('51') && d.length === 11 ? '+' + d : '+' + d; };
  const phoneValid = p => !!p && /^\+519\d{8}$/.test(p);
  const werr = (code, msg, extra) => { const e = new Error(msg); e.webCode = code; Object.assign(e, extra || {}); return e; };
  const utmOf = meta => { const src = meta._wc_order_attribution_utm_source; if (!src) return null; return { source: src, medium: meta._wc_order_attribution_utm_medium || null, campaign: meta._wc_order_attribution_utm_campaign || null, content: meta._wc_order_attribution_utm_content || null }; };

  /** web_register_order: un pedido externo entra una sola vez por tienda */
  function registerOrder(sid, payload, { source = 'WEBHOOK', event_id, at } = {}) {
    G.assertMod('WEB');
    const s = store(sid); if (!s) G.fail('RN-WEB-02', 'Tienda no encontrada.');
    if (!payload || payload.id == null) throw werr('INVALID_PAYLOAD', 'RN-WEB-02: el webhook no trae el número del pedido de WooCommerce.');
    const ext = String(payload.number || payload.id);
    const when = at || nowS();
    WOO_REMOTE.set(s.id + ':' + ext, payload);
    const ex = inboxOf(s.id, ext);
    if (ex) {
      if (source === 'POLL') D.update(T.I, ex.id, { last_polled_at: when, poll_hits: (ex.poll_hits || 0) + 1 }, { silent: true });
      else D.update(T.I, ex.id, { duplicates: (ex.duplicates || 0) + 1, last_duplicate_at: when, history: (ex.history || []).concat([{ at: when, action: 'DUPLICATE', user: 'WooCommerce', detail: `Reenvío del pedido #${ext} (${source === 'WEBHOOK' ? 'webhook' : source.toLowerCase()}): se devuelve el mismo registro (RN-WEB-02)${payload.status && payload.status !== (ex.payload || {}).status ? ` · WooCommerce informa estado «${payload.status}»` : ''}` }]) }, { silent: true });
      return { inbox: D.get(T.I, ex.id), duplicate: true };
    }
    const ib = D.insert(T.I, { store_id: s.id, external_order_id: ext, received_at: when, source, status: 'RECEIVED', payload: U.clone(payload), total: Number(payload.total) || 0, customer_name: [((payload.billing || {}).first_name || ''), ((payload.billing || {}).last_name || '')].join(' ').trim(), order_ids: [], attempts: 0, auto_attempts: 0, manual_only: false, duplicates: 0, ever_error: false, webhook_event_ids: event_id ? [event_id] : [], history: [{ at: when, action: 'RECEIVED', user: source === 'POLL' ? 'Consulta de respaldo' : 'WooCommerce', detail: source === 'POLL' ? `Recuperado por la consulta de respaldo (web_order_poll_minutes ${G.param('web_order_poll_minutes') ?? 15})` : 'Recibido por webhook firmado' }] }, { silent: true });
    processInbox(ib.id, { auto: true, at: when });
    return { inbox: D.get(T.I, ib.id), duplicate: false };
  }

  function processInbox(id, { auto = false, at, by } = {}) {
    const ib = D.get(T.I, id); if (!ib) G.fail('RN-WEB-02', 'Pedido web no encontrado en la bandeja.');
    if (ib.status === 'PROCESSED') return ib; // RN-WEB-02: un procesado no crea otro pedido
    if (ib.status === 'IGNORED') G.fail('RN-WEB-04', `El pedido web #${ib.external_order_id} está ignorado: no se reprocesa.`);
    const s = store(ib.store_id); const when = at || nowS(); const who = by || (auto ? 'Sistema' : G.ctx.userName());
    const max = G.param('web_order_retry_max') ?? 5;
    const patch = { attempts: (ib.attempts || 0) + 1, last_attempt_at: when };
    if (auto) patch.auto_attempts = (ib.auto_attempts || 0) + 1;
    let res;
    try { res = build(s, ib, when); }
    catch (e) {
      const code = e.webCode || 'PROCESSING_ERROR';
      const first = ib.status !== 'ERROR' || ib.error_code !== code;
      Object.assign(patch, { status: 'ERROR', error_code: code, error_detail: e.message, error_skus: e.skus || null, ever_error: true, manual_only: (patch.auto_attempts ?? ib.auto_attempts ?? 0) >= max });
      patch.history = (ib.history || []).concat([{ at: when, action: 'ERROR', user: who, detail: `${code} · ${e.message}` }]);
      D.update(T.I, id, patch, { silent: true });
      if (!G._seeding && first) G.notify({ role: 'SUPERVISORA_VENTAS', title: `Pedido web #${ib.external_order_id} con error`, body: `${ERR[code] || code}: ${e.message}`, ref: { screen: 'WEB-05', params: { id } }, tone: 'bad', module: 'WEB' });
      if (!G._seeding && patch.manual_only && !ib.manual_only) G.notify({ role: 'SUPERVISORA_VENTAS', title: `Pedido web #${ib.external_order_id} agotó los reintentos`, body: `RN-WEB-04: ${max} intentos automáticos sin éxito; desde ahora solo se reprocesa a mano en WEB-05.`, ref: { screen: 'WEB-05', params: { id } }, tone: 'bad', module: 'WEB' });
      return D.get(T.I, id);
    }
    if (res.ignored) { D.update(T.I, id, Object.assign(patch, { status: 'IGNORED', ignore_reason: res.ignored, history: (ib.history || []).concat([{ at: when, action: 'IGNORED', user: who, detail: res.ignored }]) }), { silent: true }); return D.get(T.I, id); }
    const hist = [{ at: when, action: 'PROCESSED', user: who, detail: `Pedido${res.orders.length > 1 ? 's' : ''} ${res.orders.map(o => o.number).join(', ')} creado${res.orders.length > 1 ? 's' : ''} en borrador${res.orders.length > 1 ? ` (D-WEB-01: un pedido por marca: ${res.orders.map(o => G.brandName(o.brand_id)).join(' + ')})` : ''}` }];
    if (res.priceNotes.length) hist.push({ at: when, action: 'PRICE', user: 'Sistema', detail: `RN-WEB-08: ${res.priceNotes.join('; ')}` });
    if (res.link) hist.push({ at: when, action: 'LINK', user: 'Sistema', detail: `D-WEB-02: la dirección llegó sin pin; enlace de ubicación enviado por WhatsApp (${res.link})` });
    D.update(T.I, id, Object.assign(patch, { status: 'PROCESSED', processed_at: when, error_code: null, error_detail: null, error_skus: null, manual_only: false, order_ids: res.orders.map(o => o.id), customer_id: res.customer.id, address_id: res.address ? res.address.id : null, warning_code: res.noPin ? 'ADDRESS_NO_PIN' : null, missing: res.missing, history: (ib.history || []).concat(hist) }), { silent: true });
    if (!G._seeding && res.noPin && s.default_seller_id) G.notify({ user_id: s.default_seller_id, title: `Pedido web #${ib.external_order_id} sin pin`, body: `RN-WEB-07: completa la ubicación de ${G.custName(res.customer.id)} (enlace CLI-07 enviado) para confirmar ${res.orders.map(o => o.number).join(', ')}.`, ref: { screen: 'WEB-05', params: { id } }, tone: 'warn', module: 'WEB' });
    settleInbox(id, { at: when });
    return D.get(T.I, id);
  }

  function customerFor(p, phone) {
    const b = p.billing || {}; const meta = metaOf(p);
    let c = G.cli && G.cli.findByPhone ? G.cli.findByPhone(phone) : D.find('customers', x => x.phone === phone);
    if (c) return c;
    const doc = String(meta._billing_dni || meta._billing_ruc || '').trim();
    const doc_type = /^\d{8}$/.test(doc) ? 'DNI' : /^\d{11}$/.test(doc) ? 'RUC' : 'NONE';
    const d = { full_name: `${b.first_name || ''} ${b.last_name || ''}`.trim() || 'Cliente web', phone, email: b.email || null, doc_type, doc_number: doc_type === 'NONE' ? null : doc, customer_type: doc_type === 'RUC' ? 'BUSINESS' : 'PERSON', source_channel: 'WEB', marketing_opt_in: meta._marketing_opt_in === 'yes', seller_user_id: null };
    if (G.cli && G.cli.create) { try { return G.cli.create(d, { system: true, silent: G._seeding }).customer; } catch (e) { const same = doc_type !== 'NONE' && D.find('customers', x => x.doc_type === doc_type && x.doc_number === doc); if (same) return same; throw werr('PROCESSING_ERROR', e.message); } }
    return D.insert('customers', Object.assign(d, { status: 'ACTIVE', orders_count: 0, segment_brands: [] }), { silent: G._seeding });
  }
  function addressFor(cu, p) {
    const sh = p.shipping || {}; const line = String(sh.address_1 || '').trim(); if (!line) return { address: null };
    const ref = String(sh.address_2 || '').trim(); const district = String(sh.city || '').trim(); const meta = metaOf(p);
    const lat = meta._shipping_lat != null && meta._shipping_lat !== '' ? Number(meta._shipping_lat) : null, lng = meta._shipping_lng != null && meta._shipping_lng !== '' ? Number(meta._shipping_lng) : null;
    const norm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    const ex = D.find('customer_addresses', a => a.customer_id === cu.id && a.status !== 'INACTIVE' && norm(a.address_line) === norm(line));
    if (ex) return { address: ex, existing: true };
    const zone = G.cli && G.cli.zoneFor ? G.cli.zoneFor(lat, lng, district) : D.find('delivery_zones', z => (z.districts || []).some(d0 => norm(d0) === norm(district)));
    const hasDef = D.find('customer_addresses', a => a.customer_id === cu.id && a.is_default);
    // RN-WEB-07 / D-WEB-02: sin pin no se pasa por CLI (que exige pin); se guarda con los mismos campos y la vendedora lo completa con el enlace (CLI-07)
    const a = D.insert('customer_addresses', { customer_id: cu.id, label: 'Web', address_line: line, district, reference: ref || null, ubigeo: '1501', lat, lng, zone_id: zone ? zone.id : null, zone_by: zone ? (lat != null ? 'POLYGON' : 'DISTRICT') : null, out_of_coverage: !zone, contact_name: `${sh.first_name || ''} ${sh.last_name || ''}`.trim() || G.custName(cu.id), contact_phone: cu.phone, is_default: !hasDef, status: 'ACTIVE', pin_source: lat != null ? 'WEB_CHECKOUT' : 'PENDING_LINK', geocode_confidence: lat != null ? 1 : null }, { silent: true });
    return { address: a, created: true };
  }
  function translate(s, p) {
    const errs = [], lines = [];
    for (const li of p.line_items || []) {
      const sku = String(li.sku || '').trim().toUpperCase();
      const m = sku && mapBySku(s.id, sku);
      if (!m || m.status === 'UNLINKED' || !m.variant_id) { errs.push(['SKU_NOT_MAPPED', `«${sku || 'sin SKU'}» (${li.name || 'línea ' + li.id})`, sku]); continue; }
      const v = G.variant(m.variant_id);
      if (!variantOk(v)) { errs.push(['VARIANT_INACTIVE', `«${sku}» → ${v ? v.name : m.variant_id}`, sku]); continue; }
      if (!G.price.of(v.id, { brand_id: v.brand_id, channel: 'WEB' })) { errs.push(['PRICE_MISSING', `«${sku}» → ${v.name}`, sku]); continue; }
      lines.push({ li, v, m, qty: Number(li.quantity) || 1, web_total: li.total != null && li.total !== '' ? Number(li.total) : null });
    }
    return { errs, lines };
  }
  function build(s, ib, when) {
    const p = ib.payload || {}; const ov = ib.overrides || {};
    if (['cancelled', 'failed', 'refunded', 'trash'].includes(p.status)) return { ignored: `WooCommerce informa el pedido como «${p.status}»: no se crea pedido.` };
    if (!(p.line_items || []).length) throw werr('INVALID_PAYLOAD', 'RN-WEB-03: el pedido web llegó sin productos.');
    const raw = ov.phone || (p.billing || {}).phone || (p.shipping || {}).phone;
    const phone = normPhone(raw);
    if (!phoneValid(phone)) throw werr('PHONE_INVALID', `RN-WEB-07: el celular «${raw || 'vacío'}» no es válido (9 dígitos que empiezan con 9). Confírmalo con el cliente${(p.billing || {}).email ? ' (' + p.billing.email + ')' : ''}, corrígelo y reprocesa.`);
    const { errs, lines } = translate(s, p);
    if (errs.length) {
      const code = errs[0][0]; const same = errs.filter(e => e[0] === code);
      const msg = code === 'SKU_NOT_MAPPED' ? `RN-WEB-03: ${same.map(e => e[1]).join(', ')} sin mapeo en ${s.name}. Vincúlalo a una variante del catálogo (WEB-02) y reprocesa; nunca se crea un producto libre.`
        : code === 'VARIANT_INACTIVE' ? `RN-WEB-03: ${same.map(e => e[1]).join(', ')} está inactiva en el catálogo. Vincula el SKU a otra variante activa o reactívala en CAT y reprocesa.`
          : `RN-WEB-08: ${same.map(e => e[1]).join(', ')} no tiene precio vigente en la lista web (RN-CAT-05).`;
      throw werr(code, msg, { skus: same.map(e => e[2]) });
    }
    const cu = customerFor(p, phone);
    const meta = metaOf(p);
    const pickup = (p.shipping_lines || []).some(x => x.method_id === 'local_pickup');
    const adr = pickup ? { address: null } : addressFor(cu, p);
    const zone = adr.address && adr.address.zone_id ? D.get('delivery_zones', adr.address.zone_id) : null;
    const est = zone ? zone.establishment_id : s.establishment_id;
    const slot = meta._delivery_slot ? D.find('order_time_slots', x => x.establishment_id === est && !x.zone_id && x.name === meta._delivery_slot) : null;
    const utm = utmOf(meta);
    const ad = utm && utm.content && D.find('ad_ads', a => a.code === utm.content) ? utm.content : null;
    const pm = PM_WOO[p.payment_method] || (p.payment_method ? 'pm-MP' : null);
    const groups = U.groupBy(lines, x => x.v.brand_id); // D-WEB-01: un pedido por marca con el mismo pago
    const brands = Object.keys(groups).sort((a, b) => a === s.brand_id ? -1 : b === s.brand_id ? 1 : a.localeCompare(b));
    const orders = [], priceNotes = [];
    brands.forEach((b, k) => {
      const o = G.orders.create({ customer_id: cu.id, brand_id: b, channel: 'WEB', fulfillment: pickup ? 'PICKUP' : 'DELIVERY', address_id: adr.address ? adr.address.id : null, delivery_date: meta._delivery_date || null, slot_id: slot ? slot.id : null, payment_method_id: pm, requested_doc_type: meta._billing_document === 'factura' ? 'INVOICE' : 'RECEIPT', notes: String(p.customer_note || '').trim() || 'Pedido web sin indicaciones', contact_phone: phone,
        lines: groups[b].map(x => ({ variant_id: x.v.id, qty: x.qty })), origin_utm: utm, origin_ad_code: ad, external_ref: brands.length > 1 ? `WC-${ib.external_order_id}/${k + 1}` : `WC-${ib.external_order_id}`, seller_id: s.default_seller_id || null, establishment_id: zone ? undefined : s.establishment_id, pickup_establishment_id: pickup ? s.establishment_id : undefined,
        extra: Object.assign({ web_store_id: s.id, web_inbox_id: ib.id }, k > 0 && !pickup ? { fee_override: 0, shared_delivery_with: `WC-${ib.external_order_id}/1` } : {}) });
      // RN-WEB-08: se respeta lo cobrado en la web; la diferencia con la lista queda como descuento «precio web»
      let diffSum = 0;
      for (const l of o.lines) {
        const x = groups[b].find(g => g.v.id === l.variant_id); if (!x || x.web_total == null || !(x.web_total >= 0)) continue;
        const diff = R(l.est_amount - x.web_total); if (Math.abs(diff) < 0.01) continue;
        const basisQty = l.price_basis === 'KG' ? (l.est_weight_kg ?? l.qty) : l.qty; const gross = basisQty * l.unit_price;
        if (diff > 0) { l.discount_pct = R(diff / gross * 100, 6); l.discount_reason = 'precio web'; }
        else { l.unit_price = R(x.web_total / basisQty, 4); l.price_note = 'precio web mayor que la lista'; }
        diffSum = R(diffSum + diff);
        priceNotes.push(`${x.v.sku}: lista ${money(l.est_amount + (diff > 0 ? 0 : 0))} → cobrado ${money(x.web_total)} (${diff > 0 ? 'descuento' : 'recargo'} ${money(Math.abs(diff))})`);
      }
      if (diffSum) { G.orders.recalc(o); D.update('sales_orders', o.id, { lines: o.lines, discount_status: diffSum > 0 ? 'APPROVED' : o.discount_status, discount_reason: 'precio web', web_price_diff: diffSum }, { silent: true }); }
      if (o.history && o.history[0]) { o.history[0].user = 'Tienda web · ' + s.name; if (when) o.history[0].at = when; }
      if (when && G._seeding) o.created_at = when;
      orders.push(o);
    });
    const missing = [...new Set(orders.flatMap(o => G.orders.missing(o)))];
    const noPin = missing.includes('DIRECCION_CON_PIN');
    let link = null;
    if (noPin) link = sendLocationLink(cu, when);
    return { orders, customer: cu, address: adr.address, missing, noPin, link, priceNotes };
  }
  /** D-WEB-02: enlace de ubicación (CLI-07) después del pedido */
  function sendLocationLink(cu, when) {
    if (!G._seeding && G.cli && G.cli.createLink) { try { const l = G.cli.createLink(cu.id, { send: true }); return l.url; } catch (e) { return null; } }
    if (G._seeding && D.t.customer_location_links !== undefined) { const token = 'w' + String(cu.id).replace(/\D/g, '').padStart(5, '0') + 'x'; const l = D.insert('customer_location_links', { customer_id: cu.id, token, url: `https://donguando.aycha.pe/u/${token}`, expires_at: addMin(when, 24 * 60), status: 'PENDING', created_by: 'Tienda web', sent_via: 'WHATSAPP', phone: cu.phone, created_at: when }, { silent: true }); return l.url; }
    return null;
  }
  /** cobros aprobados que esperaban el pedido y confirmación cuando hay pago aprobado */
  function settleInbox(id, { at } = {}) {
    const ib = D.get(T.I, id); if (!ib || ib.status !== 'PROCESSED') return;
    for (const tx of txsOfInbox(ib)) {
      if (!tx.inbox_id) D.update(T.X, tx.id, { inbox_id: ib.id }, { silent: true });
      if (tx.status === 'approved' && !tx.payment_id) { try { confirmPayment(tx.id, tx.amount, { auto: true, at }); } catch (e) { addTxHist(tx.id, at, 'WAITING', e.message); } }
    }
  }
  function tryConfirm(o, { at } = {}) {
    if (!o || o.status !== 'DRAFT') return { ok: false };
    const miss = G.orders.missing(o); if (miss.length) return { ok: false, missing: miss };
    try {
      if (G.ped && G.ped.confirm) G.ped.confirm(o, { reason: 'Pago web aprobado por Mercado Pago' }); else G.orders.transition(o, 'CONFIRMED', { reason: 'Pago web aprobado por Mercado Pago' });
      if (G._seeding) { if (at) { o.confirmed_at = at; const hh = (o.history || [])[o.history.length - 1]; if (hh) hh.at = at; } o.confirmation_channel = 'WEB'; o.customer_confirmed_at = o.confirmed_at; if (!(o.reservations || []).length) G.inv.reserve(o, { silent: true }); }
      else { o.confirmation_channel = 'WEB'; o.customer_confirmed_at = o.confirmed_at; D.touch(); }
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  function reprocess(id, { manual = true } = {}) {
    const ib = D.get(T.I, id);
    if (manual) perm('web.inbox.resolve');
    else if (ib.manual_only) G.fail('RN-WEB-04', `El pedido web #${ib.external_order_id} agotó los ${G.param('web_order_retry_max') ?? 5} reintentos automáticos: solo se reprocesa a mano.`);
    if (ib.status !== 'ERROR' && ib.status !== 'RECEIVED') G.fail('RN-WEB-02', `El pedido web #${ib.external_order_id} ya está ${INBOX_ST[ib.status][0].toLowerCase()}: no se crea otro pedido.`);
    return processInbox(id, { auto: !manual });
  }
  function ignore(id, reason) {
    perm('web.inbox.resolve');
    const ib = D.get(T.I, id);
    if (!['ERROR', 'RECEIVED'].includes(ib.status)) G.fail('RN-WEB-04', 'Solo se ignora un pedido web recibido o con error.');
    if (!reason || reason.trim().length < 10) G.fail('RN-WEB-04', 'Ignorar un pedido web exige un motivo de al menos 10 caracteres.');
    D.update(T.I, id, { status: 'IGNORED', ignore_reason: reason, history: (ib.history || []).concat([{ at: nowS(), action: 'IGNORED', user: G.ctx.userName(), detail: reason }]) });
    return D.get(T.I, id);
  }
  /** corrige el celular que llegó mal (se guarda como corrección; el crudo no cambia) */
  function fixPhone(id, phone) {
    perm('web.inbox.resolve');
    const p = normPhone(phone);
    if (!phoneValid(p)) G.fail('RN-WEB-07', `El celular «${phone}» no es válido: son 9 dígitos que empiezan con 9.`);
    const ib = D.get(T.I, id);
    D.update(T.I, id, { overrides: Object.assign({}, ib.overrides || {}, { phone: p }), history: (ib.history || []).concat([{ at: nowS(), action: 'FIX', user: G.ctx.userName(), detail: `Celular corregido a ${p}` }]) });
    return reprocess(id);
  }
  /** completa el pin de la dirección web y confirma si ya está pagado (RN-WEB-07) */
  function resolvePin(id, { lat, lng, reference }) {
    perm('web.inbox.resolve');
    const ib = D.get(T.I, id); const a = ib.address_id && D.get('customer_addresses', ib.address_id);
    if (!a) G.fail('RN-WEB-07', 'El pedido web no tiene dirección de entrega.');
    if (lat == null || lng == null) G.fail('RN-CLI-02', 'Marca el pin en el mapa.');
    const ref = String(reference || a.reference || '').trim();
    if (ref.length < (G.param('cli_min_reference_chars') ?? 10)) G.fail('RN-CLI-02', `La referencia «${ref}» es muy corta: escribe al menos ${G.param('cli_min_reference_chars') ?? 10} caracteres (por ejemplo «Frente al parque»).`);
    const zone = G.cli && G.cli.zoneFor ? G.cli.zoneFor(lat, lng, a.district) : G.geo.zoneAt(lat, lng);
    D.update('customer_addresses', a.id, { lat: R(lat, 6), lng: R(lng, 6), reference: ref, zone_id: zone ? zone.id : a.zone_id, zone_by: 'POLYGON', out_of_coverage: !zone, pin_source: 'MAP', geocode_confidence: 1 });
    const res = [];
    for (const oid of ib.order_ids || []) {
      const o = D.get('sales_orders', oid); if (!o || o.status !== 'DRAFT') continue;
      o.zone_id = zone ? zone.id : o.zone_id; G.orders.recalc(o); D.update('sales_orders', o.id, { zone_id: o.zone_id, delivery_fee: o.delivery_fee }, { silent: true });
      const paid = D.find(T.X, x => x.payment_id && (x.order_ids || []).includes(o.id) && x.status === 'approved') || ((o.payment_ids || []).length && o.payment_method_id === 'pm-MP');
      const c = paid ? tryConfirm(o) : { ok: false, missing: G.orders.missing(o) };
      res.push(`${o.number}: ${c.ok ? 'confirmado' : c.error || (c.missing && c.missing.length ? 'falta ' + c.missing.join(', ') : 'en borrador hasta el pago aprobado (RN-WEB-06)')}`);
    }
    D.update(T.I, id, { warning_code: null, missing: [...new Set((ib.order_ids || []).flatMap(oid => { const o = D.get('sales_orders', oid); return o && o.status === 'DRAFT' ? G.orders.missing(o) : []; }))], history: (ib.history || []).concat([{ at: nowS(), action: 'PIN', user: G.ctx.userName(), detail: `Pin marcado en ${zone ? zone.name : 'fuera de cobertura'} · ${res.join('; ')}` }]) });
    return res;
  }

  /* ---------- webhooks entrantes (por INT: firma, crudo y deduplicación, RN-WEB-01) ---------- */
  let incoming = null;
  function fbSign(raw) { let x = 0; for (let i = 0; i < raw.length; i++) x = (x * 31 + raw.charCodeAt(i)) >>> 0; return 'sha256=fb' + x.toString(16); }
  function receiveRaw({ endpoint_id, raw, signature, event_id, at }) {
    if (G.int && G.int.receiveWebhook && endpoint_id) return G.int.receiveWebhook({ endpoint_id, body: raw, signature, event_id, at });
    // respaldo sin INT: misma tabla y mismas reglas mínimas
    if (signature !== fbSign(raw)) { const ev = D.insert('webhook_events', { endpoint_id: endpoint_id || 'local', owner_module: 'WEB', event_key: event_id, body: raw, signature, received_at: at || nowS(), status: 'REJECTED', http_status: 401, duplicates: 0, attempts: 0, last_error: 'RN-WEB-01: firma ausente o inválida; no se procesa.' }, { silent: true }); return { http: 401, status: 'REJECTED', event: ev }; }
    const dup = D.find('webhook_events', e => e.event_key === event_id && e.status !== 'REJECTED');
    if (dup) { D.update('webhook_events', dup.id, { duplicates: (dup.duplicates || 0) + 1, last_duplicate_at: at || nowS() }, { silent: true }); return { http: 200, status: dup.status, event: dup, duplicate: true }; }
    const ev = D.insert('webhook_events', { endpoint_id: endpoint_id || 'local', owner_module: 'WEB', event_key: event_id, body: raw, signature, received_at: at || nowS(), status: 'PROCESSED', http_status: 200, duplicates: 0, attempts: 1 }, { silent: true });
    return { http: 200, status: 'PROCESSED', event: ev, fallback: true };
  }
  const signFor = (endpoint_id, raw, valid) => valid === false ? 'sha256=' + '0'.repeat(64) : typeof valid === 'string' ? valid : (G.int && G.int.sign && endpoint_id ? G.int.sign(endpoint_id, raw) : fbSign(raw));
  /** llega un webhook de WooCommerce (order.created / order.updated) */
  function receiveWoo(payload, { store_id, delivery_id, valid = true, at } = {}) {
    const s = store(store_id) || mainStore();
    const raw = JSON.stringify(payload); const key = `woo:${s.code}:${payload.id}:${delivery_id || 'd1'}`;
    WOO_REMOTE.set(s.id + ':' + String(payload.number || payload.id), payload);
    incoming = { store_id: s.id, key };
    let res;
    try { res = receiveRaw({ endpoint_id: s.webhook_endpoint_id, raw, signature: signFor(s.webhook_endpoint_id, raw, valid), event_id: key, at }); }
    finally { incoming = null; }
    if (res.fallback) registerOrder(s.id, payload, { source: 'WEBHOOK', event_id: res.event.id, at });
    const ib = inboxOf(s.id, String(payload.number || payload.id));
    if (ib && res.event && res.http === 200 && !res.duplicate) {
      if (!(ib.webhook_event_ids || []).includes(res.event.id)) D.update(T.I, ib.id, { webhook_event_ids: (ib.webhook_event_ids || []).concat([res.event.id]) }, { silent: true });
      D.update('webhook_events', res.event.id, { result: `Bandeja #${ib.external_order_id}: ${INBOX_ST[ib.status][0]}${ib.order_ids.length ? ' · ' + ib.order_ids.map(i => (D.get('sales_orders', i) || {}).number).join(', ') : ''}${ib.error_code ? ' · ' + ib.error_code : ''}` }, { silent: true });
    }
    return { http: res.http, status: res.status, duplicate: !!res.duplicate, rejected: res.http === 401, event: res.event, inbox: ib ? D.get(T.I, ib.id) : null };
  }
  /** procesador que llama INT al recibir un webhook de WooCommerce */
  function importWooOrder(b) {
    const sid = incoming ? incoming.store_id : (mainStore() || {}).id;
    const r = registerOrder(sid, b, { source: 'WEBHOOK' });
    const ib = r.inbox;
    return { number: ib.order_ids.length ? ib.order_ids.map(i => (D.get('sales_orders', i) || {}).number).join(', ') : `#${ib.external_order_id} (bandeja: ${INBOX_ST[ib.status][0].toLowerCase()})`, inbox_id: ib.id };
  }
  function remoteOrders(sid) {
    const out = new Map();
    for (const i of D.where(T.I, x => x.store_id === sid)) out.set(i.external_order_id, i.payload);
    for (const [k, p] of WOO_REMOTE) if (k.startsWith(sid + ':')) out.set(k.slice(sid.length + 1), p);
    return [...out.values()];
  }

  /* =====================================================================
     Mercado Pago (RN-WEB-06, RN-WEB-09) y conciliación
     ===================================================================== */
  const MP_API = new Map(); // pagos del lado de Mercado Pago (adaptador falso de GET /v1/payments/{id})
  function mpGet(id) { const r = MP_API.get(String(id)); if (r) return r; const tx = D.find(T.X, x => x.provider === 'MERCADOPAGO' && x.external_payment_id === String(id)); return tx ? tx.raw : null; }
  const feePct = () => Number((D.get('cash_accounts', 'ca-MP') || {}).fee_pct ?? 3.99);
  const releaseDays = type => type && type !== 'credit_card' ? 2 : Number((D.get('cash_accounts', 'ca-MP') || {}).settlement_days ?? 14);
  function mpFees(amount, status) { if (!['approved', 'refunded', 'charged_back'].includes(status)) return { fee: 0, igv: 0, net: 0 }; const fee = R(amount * feePct() / 100); const igv = R(fee * (G.tax ? G.tax.rate() : 0.18)); return { fee, igv, net: R(amount - fee - igv) }; }
  function addTxHist(id, at, status, detail) { const tx = D.get(T.X, id); if (!tx) return; D.update(T.X, id, { history: (tx.history || []).concat([{ at: at || nowS(), status, detail }]) }, { silent: true }); }
  const ordersOfTx = tx => { const ib = tx.inbox_id ? D.get(T.I, tx.inbox_id) : D.find(T.I, i => i.store_id === tx.store_id && i.external_order_id === tx.external_reference); return ((ib && ib.order_ids) || tx.order_ids || []).map(id => D.get('sales_orders', id)).filter(Boolean); };
  /** pago remoto simulado: lo que Mercado Pago tiene de su lado */
  function mpRemote({ id, external_reference, amount, status = 'approved', method = 'visa', at, detail, payer_email }) {
    const when = sec(at || nowS());
    const types = { visa: 'credit_card', master: 'credit_card', amex: 'credit_card', debvisa: 'debit_card', yape: 'digital_wallet', pagoefectivo_atm: 'ticket' };
    const det = detail || { approved: 'accredited', pending: method === 'pagoefectivo_atm' ? 'pending_waiting_payment' : 'pending_contingency', in_process: 'pending_contingency', rejected: 'cc_rejected_other_reason', refunded: 'refunded_by_seller', charged_back: 'cardholder_dispute' }[status];
    const f = mpFees(Number(amount), status === 'approved' ? 'approved' : status);
    const r = { id: String(id), status, status_detail: det, transaction_amount: R(Number(amount)), currency_id: 'PEN', external_reference: String(external_reference), payment_method_id: method, payment_type_id: types[method] || 'credit_card', installments: 1, card: types[method] && types[method].includes('card') ? { last_four_digits: String(1000 + (Number(String(id).slice(-4)) % 8999)) } : null, payer: { email: payer_email || null }, date_created: when, date_approved: status === 'approved' ? when : null, money_release_date: status === 'approved' ? G.date.add(day(when), releaseDays(types[method] || 'credit_card')) : null, fee_details: f.fee ? [{ type: 'mercadopago_fee', amount: R(f.fee + f.igv) }] : [] };
    const prev = MP_API.get(String(id)) || mpGet(id);
    if (prev && prev.date_approved && !r.date_approved) { r.date_approved = prev.date_approved; r.money_release_date = prev.money_release_date; r.fee_details = prev.fee_details; r.date_created = prev.date_created; }
    if (prev) r.date_created = prev.date_created;
    MP_API.set(String(id), r);
    return r;
  }
  /** llega la notificación de Mercado Pago (solo trae el id: se verifica con la API) */
  function receiveMP(paymentId, { store_id, valid = true, at, notification_id } = {}) {
    const s = store(store_id) || mainStore();
    const r = mpGet(paymentId);
    const body = { id: notification_id || `${paymentId}-${r ? r.status : 'x'}`, type: 'payment', action: 'payment.updated', live_mode: s.status === 'ACTIVE', date_created: sec(at || nowS()), data: { id: String(paymentId) } };
    const raw = JSON.stringify(body);
    const res = receiveRaw({ endpoint_id: s.payment_endpoint_id, raw, signature: signFor(s.payment_endpoint_id, raw, valid), event_id: 'mp:' + body.id, at });
    if (res.http === 401) return { rejected: true, http: 401, event: res.event };
    if (res.duplicate) return { duplicate: true, http: 200, event: res.event, tx: D.find(T.X, x => x.external_payment_id === String(paymentId)) };
    const out = processMP(paymentId, { store_id: s.id, event_id: res.event && res.event.id, at });
    if (res.event) D.update('webhook_events', res.event.id, { status: 'PROCESSED', result: out.detail, last_error: null }, { silent: true });
    return Object.assign({ http: 200, event: res.event }, out);
  }
  function simulateMP(o) { const id = o.id || String(1330000000 + D.all(T.X).length * 37 + (Number(String(o.external_reference).replace(/\D/g, '')) % 997)); mpRemote(Object.assign({}, o, { id })); return receiveMP(id, { store_id: o.store_id, valid: o.valid, at: o.at }); }
  /** procesa el pago: lo consulta a la API, guarda la transacción (única por proveedor y pago) y aplica el efecto */
  function processMP(paymentId, { store_id, event_id, at } = {}) {
    const r = mpGet(paymentId); if (!r) G.fail('RN-WEB-06', `Mercado Pago no devolvió el pago ${paymentId}: no se registra nada.`);
    const when = at || nowS();
    const s = store(store_id) || mainStore();
    const fee = (r.fee_details || []).reduce((a, x) => a + Number(x.amount || 0), 0);
    const igv = fee ? R(fee - fee / (1 + (G.tax ? G.tax.rate() : 0.18))) : 0;
    const base = { status: r.status, status_detail: r.status_detail, amount: R(r.transaction_amount), fee_amount: R(fee - igv), fee_igv: igv, net_amount: fee ? R(r.transaction_amount - fee) : 0, date_approved: r.date_approved || null, money_release_date: r.money_release_date || null, raw: U.clone(r), verified_at: when };
    const ib = D.find(T.I, i => i.store_id === s.id && i.external_order_id === String(r.external_reference));
    let tx = D.find(T.X, x => x.provider === 'MERCADOPAGO' && x.external_payment_id === String(r.id));
    const prev = tx ? tx.status : null;
    if (!tx) tx = D.insert(T.X, Object.assign({ provider: 'MERCADOPAGO', external_payment_id: String(r.id), store_id: s.id, external_reference: String(r.external_reference || ''), inbox_id: ib ? ib.id : null, order_ids: ib ? ib.order_ids.slice() : [], payment_method: r.payment_method_id, payment_type: r.payment_type_id, installments: r.installments || 1, card_last4: (r.card || {}).last_four_digits || null, payer_email: (r.payer || {}).email || null, date_created: r.date_created || when, payment_id: null, webhook_event_ids: [], history: [] }, base), { silent: true });
    else D.update(T.X, tx.id, Object.assign(base, ib && !tx.inbox_id ? { inbox_id: ib.id, order_ids: ib.order_ids.slice() } : {}), { silent: true });
    if (event_id) D.update(T.X, tx.id, { webhook_event_ids: (D.get(T.X, tx.id).webhook_event_ids || []).concat([event_id]) }, { silent: true });
    addTxHist(tx.id, when, r.status, `${prev && prev !== r.status ? txLabel(prev) + ' → ' : ''}${txLabel(r.status)} · ${MP_DETAIL[r.status_detail] || r.status_detail || ''} · verificado con la API de Mercado Pago`);
    let detail = `Pago ${r.id} ${txLabel(r.status).toLowerCase()}`;
    if (r.status === 'approved' && !D.get(T.X, tx.id).payment_id) {
      try { const p = confirmPayment(tx.id, base.amount, { auto: true, at: when }); detail = `Aprobado y verificado · cobro ${p.number} de ${money(p.amount)}`; }
      catch (e) { detail = `Aprobado · ${e.message}`; addTxHist(tx.id, when, 'WAITING', e.message); }
    } else if (r.status === 'rejected' && prev !== 'rejected') {
      detail = `Rechazado (${MP_DETAIL[r.status_detail] || r.status_detail}): el pedido sigue en borrador y se avisó al cliente`;
      notifyRejected(D.get(T.X, tx.id), ib, when);
    } else if (['pending', 'in_process'].includes(r.status)) detail = `Pendiente (${MP_DETAIL[r.status_detail] || r.status_detail}): no confirma el pedido para preparar (RN-WEB-06)`;
    else if (['refunded', 'charged_back'].includes(r.status) && prev !== r.status) detail = `${txLabel(r.status)}: ${reverseTx(tx.id, { at: when })}`;
    return { tx: D.get(T.X, tx.id), detail };
  }
  function notifyRejected(tx, ib, when) {
    const cu = ib && ib.customer_id ? D.get('customers', ib.customer_id) : (tx.payer_email ? D.find('customers', c => c.email === tx.payer_email) : null);
    if (cu && G.msg && !G._seeding) { try { G.msg.send({ customer_id: cu.id, kind: 'UTILITY', template: 'pago_web_rechazado', text: `Hola ${String(cu.full_name || '').split(' ')[0]}, Mercado Pago rechazó el pago de tu pedido web #${tx.external_reference} (${MP_DETAIL[tx.status_detail] || 'rechazado'}). Puedes pagar de nuevo desde «Mis pedidos» en donguando.com o escribirnos por aquí.`, ref: tx.id, inServiceWindow: false }); } catch (e) { } }
    D.update(T.X, tx.id, { customer_notified_at: when }, { silent: true });
    const s = store(tx.store_id);
    if (!G._seeding && s && s.default_seller_id) G.notify({ user_id: s.default_seller_id, title: `Pago web rechazado · #${tx.external_reference}`, body: `RN-WEB-06: ${money(tx.amount)} rechazado (${MP_DETAIL[tx.status_detail] || tx.status_detail}). El pedido queda en borrador.`, ref: { screen: 'WEB-06', params: { id: tx.id } }, tone: 'warn', module: 'WEB' });
  }
  /** RN-WEB-06: un pago web se confirma solo con transacción aprobada, verificada y por el mismo monto */
  function confirmPayment(txId, amount, { auto = false, at } = {}) {
    const tx = D.get(T.X, txId); if (!tx) G.fail('RN-WEB-06', 'Transacción de Mercado Pago no encontrada.');
    if (tx.status !== 'approved') G.fail('RN-WEB-06', `La transacción ${tx.external_payment_id} de Mercado Pago está «${txLabel(tx.status)}»: solo un pago aprobado confirma el cobro y el pedido.`);
    const r = mpGet(tx.external_payment_id);
    if (!r || r.status !== 'approved' || Math.abs(R(r.transaction_amount) - tx.amount) > 0.004) G.fail('RN-WEB-06', `La verificación con la API de Mercado Pago no coincide para ${tx.external_payment_id} (estado ${r ? r.status : '—'}, monto ${money(r ? r.transaction_amount : 0)}).`);
    const a = R(Number(amount));
    if (Math.abs(a - tx.amount) > 0.004) G.fail('RN-WEB-06', `El cobro de ${money(a)} no coincide con el pago aprobado de ${money(tx.amount)} en Mercado Pago (${tx.external_payment_id}): registra el mismo monto.`);
    const prevP = tx.payment_id && D.get('payments', tx.payment_id);
    if (prevP && prevP.status === 'CONFIRMED') G.fail('RN-WEB-02', `La transacción ${tx.external_payment_id} ya tiene el cobro ${prevP.number}: no se registra dos veces.`);
    const orders = ordersOfTx(tx).filter(o => o.status !== 'CANCELLED');
    if (!orders.length) { const ib = D.find(T.I, i => i.store_id === tx.store_id && i.external_order_id === tx.external_reference); G.fail('RN-WEB-06', `El pedido web #${tx.external_reference} aún no está creado${ib ? ` (bandeja: ${INBOX_ST[ib.status][0].toLowerCase()}${ib.error_code ? ', ' + ib.error_code : ''})` : ' (no llegó a la bandeja)'}: el cobro se registra apenas se cree.`); }
    if (!auto && !(G.canDo('CAJ', 'C') || G.canDo('WEB', 'E'))) G.fail('RN-WEB-06', `Tu rol (${G.roleName()}) no registra cobros.`);
    const tot = U.sum(orders, o => o.estimated_total) || 1; let left = a;
    const allocations = orders.map((o, k) => { const amt = k === orders.length - 1 ? R(left) : R(a * o.estimated_total / tot); left = R(left - amt); return { order_id: o.id, document_id: null, amount: amt }; });
    const when = at || nowS();
    const p = G.pay.register({ customer_id: orders[0].customer_id, payment_method_id: 'pm-MP', amount: a, reference: 'MP-' + tx.external_payment_id, cash_account_id: 'ca-MP', allocations, brand_id: orders[0].brand_id, establishment_id: orders[0].establishment_id, at: when, silent: G._seeding });
    D.update('payments', p.id, { gateway_transaction_id: tx.id, fee_amount: tx.fee_amount, fee_igv: tx.fee_igv, received_by: auto ? null : G.ctx.userId() }, { silent: true });
    D.update(T.X, tx.id, { payment_id: p.id, order_ids: orders.map(o => o.id), registered_at: when }, { silent: true });
    addTxHist(tx.id, when, 'PAYMENT', `Cobro ${p.number} de ${money(a)} en Mercado Pago (comisión ${money(tx.fee_amount)} + IGV ${money(tx.fee_igv)}) aplicado a ${orders.map(o => o.number).join(', ')}`);
    const notes = orders.map(o => { const c = tryConfirm(o, { at: when }); return `${o.number}: ${c.ok ? 'confirmado' : c.error || (c.missing && c.missing.length ? 'en borrador, falta ' + c.missing.join(', ') : G.ui.statusLabel(o.status).toLowerCase())}`; });
    const ib = tx.inbox_id && D.get(T.I, tx.inbox_id);
    if (ib) D.update(T.I, ib.id, { history: (ib.history || []).concat([{ at: when, action: 'PAYMENT', user: 'Mercado Pago', detail: `Pago aprobado ${tx.external_payment_id} · ${p.number} · ${notes.join('; ')}` }]), missing: [...new Set(orders.flatMap(o => o.status === 'DRAFT' ? G.orders.missing(o) : []))] }, { silent: true });
    return D.get('payments', p.id);
  }
  /** RN-WEB-09: reembolso o contracargo revierte el cobro, avisa a administración y prepara la nota de crédito */
  function reverseTx(txId, { at, reason } = {}) {
    const tx = D.get(T.X, txId); const kind = tx.status === 'charged_back' ? 'Contracargo' : 'Reembolso'; const when = at || nowS();
    const why = reason || `${kind} de Mercado Pago ${tx.external_payment_id} (${MP_DETAIL[tx.status_detail] || tx.status_detail || tx.status})`;
    let res = 'no había cobro registrado que revertir';
    const p = tx.payment_id && D.get('payments', tx.payment_id);
    if (p && p.status === 'CONFIRMED') {
      try {
        if (G.caj && G.caj.reverse && !G._seeding) G.caj.reverse(p.id, why);
        else { D.update('payments', p.id, { status: 'REVERSED', reversal_reason: why, reversed_at: when, reversed_by: 'Mercado Pago', reconciliation_status: p.reconciliation_status === 'PENDING' ? 'NOT_APPLICABLE' : p.reconciliation_status }, { silent: true }); for (const al of p.allocations || []) { const o = D.get('sales_orders', al.order_id); if (o) o.paid_amount = R((o.paid_amount || 0) - al.amount); } if (!G._seeding) G.events.emit('payment.reversed', { payment_id: p.id, amount: p.amount, reason: why }); }
        res = `cobro ${p.number} revertido`;
      } catch (e) { res = `el cobro ${p.number} no se pudo revertir (${e.message}); registra el ajuste en CAJ`; D.update(T.X, txId, { reverse_error: e.message }, { silent: true }); }
    } else if (p && p.status === 'REVERSED') res = `cobro ${p.number} ya revertido`;
    const orders = ordersOfTx(tx); const oids = new Set(orders.map(o => o.id));
    const docs = D.where('sales_documents', d => oids.has(d.order_id) && ['INVOICE', 'RECEIPT'].includes(d.doc_type) && d.status !== 'VOIDED' && d.sunat_status !== 'REJECTED');
    const cn = docs.map(d => ({ document_id: d.id, full_number: d.full_number, amount: R(Math.min(d.total, tx.amount)), status: 'PREPARED', reason: why }));
    D.update(T.X, txId, { reversed_at: when, reverse_result: res, credit_notes: cn.length ? cn : null }, { silent: true });
    addTxHist(txId, when, 'REVERSED', `RN-WEB-09: ${res}${cn.length ? `; nota de crédito preparada sobre ${cn.map(c => c.full_number).join(', ')}` : ''}`);
    if (!G._seeding) G.notify({ role: 'ADMINISTRACION', title: `${kind} de Mercado Pago · ${money(tx.amount)}`, body: `RN-WEB-09: ${res}${cn.length ? `; nota de crédito preparada sobre ${cn.map(c => c.full_number).join(', ')}` : ''}. Pedido web #${tx.external_reference}.`, ref: { screen: 'WEB-06', params: { id: txId } }, tone: 'bad', module: 'WEB' });
    return res + (cn.length ? `; nota de crédito preparada (${cn.map(c => c.full_number).join(', ')})` : '');
  }
  function issueCreditNote(txId, docId) {
    if (!(G.canDo('FAC', 'C') || G.ctx.role === 'GERENTE')) G.fail('RN-WEB-09', `Tu rol (${G.roleName()}) no emite notas de crédito: pásalo a administración o a la contadora.`);
    const tx = D.get(T.X, txId); const c = (tx.credit_notes || []).find(x => x.document_id === docId);
    if (!c || c.status !== 'PREPARED') G.fail('RN-WEB-09', 'La nota de crédito ya se emitió o no está preparada.');
    const d = D.get('sales_documents', docId);
    const nc = G.docs.issue({ doc_type: 'CREDIT_NOTE', applies_to: d.doc_type, brand_id: d.brand_id, establishment_id: d.establishment_id, customer_id: d.customer_id, order_id: d.order_id, related_document_id: d.id, note_reason_code: '01', note_reason: c.reason, lines: [{ description: `Anulación de la operación · ${c.reason}`, qty: 1, uom_code: 'ZZ', unit_price: c.amount, total: c.amount, igv_affectation: '10' }] });
    D.update(T.X, txId, { credit_notes: tx.credit_notes.map(x => x.document_id === docId ? Object.assign({}, x, { status: 'ISSUED', credit_document_id: nc.id, credit_full_number: nc.full_number }) : x) });
    addTxHist(txId, nowS(), 'CREDIT_NOTE', `Nota de crédito ${nc.full_number} emitida sobre ${d.full_number} por ${money(c.amount)}`);
    return nc;
  }
  /** pagos pendientes vencidos (web_mp_pending_expire_hours) */
  function expirePending(at = nowS()) {
    const hrs = G.param('web_mp_pending_expire_hours') ?? 48; const out = [];
    for (const tx of D.where(T.X, x => ['pending', 'in_process'].includes(x.status) && hoursBetween(at, x.date_created) >= hrs)) {
      D.update(T.X, tx.id, { status: 'expired', status_detail: 'expired_by_aycha', expired_at: at, history: (tx.history || []).concat([{ at, status: 'expired', detail: `Vencido: ${hrs} h sin aprobación (web_mp_pending_expire_hours); el pedido no se prepara` }]) }, { silent: true });
      out.push(D.get(T.X, tx.id));
    }
    return out;
  }
  /** situación de conciliación de una transacción aprobada */
  function recState(tx) {
    if (!['approved'].includes(tx.status)) return { key: 'NA', label: 'No aplica', tone: '' };
    const p = tx.payment_id && D.get('payments', tx.payment_id);
    if (!p) return { key: 'NO_PAYMENT', label: 'Sin cobro', tone: 'warn' };
    if (p.reconciliation_status === 'MATCHED') { const b = p.settlement_batch_id && D.get('settlement_batches', p.settlement_batch_id); return { key: 'MATCHED', label: 'Conciliado', tone: 'ok', ref: b ? b.reference : tx.settlement_ref }; }
    if (p.reconciliation_status === 'DIFFERENCE') return { key: 'DIFF', label: 'Con diferencia', tone: 'bad' };
    if (tx.money_release_date && tx.money_release_date > G.TODAY) return { key: 'TO_RELEASE', label: 'Por liberar', tone: 'info' };
    if (p.settlement_batch_id) return { key: 'IN_BATCH', label: 'En liquidación abierta', tone: 'info' };
    return { key: 'RELEASED', label: 'Liberado, por conciliar', tone: 'warn' };
  }
  function releasedUnreconciled(upTo = G.TODAY) { return D.where(T.X, x => x.status === 'approved' && x.payment_id && x.money_release_date && x.money_release_date <= upTo).filter(x => recState(x).key === 'RELEASED'); }
  /** concilia lo liberado con la liquidación de Mercado Pago (abono en CAJ) */
  function reconcile({ reference, deposit_date = G.TODAY, tx_ids, bank = 'ca-BCP-CTE', net_received } = {}) {
    if (!(G.canDo('CAJ', 'E') || G.canDo('CAJ', 'C'))) G.fail('RN-CAJ-12', `Tu rol (${G.roleName()}) no concilia cobros (CAJ).`);
    const txs = tx_ids ? tx_ids.map(id => D.get(T.X, id)).filter(x => x && recState(x).key === 'RELEASED') : releasedUnreconciled(deposit_date);
    if (!txs.length) G.fail('RN-CAJ-13', 'No hay pagos de Mercado Pago liberados y sin conciliar a esa fecha.');
    if (!String(reference || '').trim()) G.fail('RN-CAJ-13', 'Escribe la referencia de la liquidación de Mercado Pago (por ejemplo LIQ-MP-20261010).');
    const gross = R(U.sum(txs, x => x.amount)), fee = R(U.sum(txs, x => x.fee_amount)), igv = R(U.sum(txs, x => x.fee_igv)), net = R(gross - fee - igv);
    if (net_received != null && net_received !== '' && Math.abs(Number(net_received) - net) > 0.009) G.fail('RN-CAJ-12', `El neto recibido de ${money(net_received)} no cuadra con lo liberado: bruto ${money(gross)} − comisión ${money(fee)} − IGV ${money(igv)} = ${money(net)} (diferencia ${money(R(Number(net_received) - net))}). Revisa los pagos incluidos.`);
    let batch = null;
    if (G.caj && G.caj.createBatch) { batch = G.caj.createBatch({ source_account_id: 'ca-MP', bank_account_id: bank, deposit_date, reference: reference.trim(), gross_amount: gross, fee_amount: fee, fee_igv: igv, net_amount: net, payment_ids: txs.map(x => x.payment_id) }); batch = G.caj.closeBatch(batch.id); }
    else for (const x of txs) D.update('payments', x.payment_id, { reconciliation_status: 'MATCHED', matched_at: nowS() }, { silent: true });
    for (const x of txs) { D.update(T.X, x.id, { settlement_ref: reference.trim(), reconciled_at: nowS() }, { silent: true }); addTxHist(x.id, nowS(), 'MATCHED', `Conciliado con la liquidación ${reference.trim()}`); }
    return { batch, count: txs.length, gross, fee, igv, net };
  }

  /* =====================================================================
     Sincronización (catálogo, precios, stock y pedidos)
     ===================================================================== */
  function runSync(sid, kind, { trigger = 'MANUAL', skus, at } = {}) {
    if (trigger === 'MANUAL') perm('web.sync.run');
    G.assertMod('WEB'); finalize();
    const s = store(sid); if (!s) G.fail('RN-WEB-05', 'Tienda no encontrada.');
    if (!['ACTIVE', 'TESTING'].includes(s.status)) G.fail('RN-WEB-05', `La tienda ${s.name} está «${STORE_ST[s.status][0]}»: prueba la conexión y actívala en WEB-01.`);
    const flag = { CATALOG: 'sync_catalog', PRICES: 'sync_prices', STOCK: 'sync_stock', ORDERS: 'sync_orders' }[kind];
    if (!s[flag]) G.fail('RN-WEB-05', `${s.name} no sincroniza ${KIND[kind].toLowerCase()} (configúralo en WEB-01).`);
    const started = at || nowS(); const items = [];
    const c = G.int && s.connector_id ? D.get('integration_connectors', s.connector_id) : null;
    const down = !!(c && (c.simulate_down || c.status === 'DISABLED'));
    let detail = '';
    if (kind === 'ORDERS') {
      if (down) items.push({ sku: '—', result: 'ERROR', detail: 'HTTP 503: WooCommerce no respondió a la consulta de pedidos' });
      else {
        const since = addMin(started, -24 * 60);
        for (const p of remoteOrders(s.id).filter(p => sec(p.date_created || '') >= since)) {
          const ext = String(p.number || p.id); const was = inboxOf(s.id, ext);
          const r = registerOrder(s.id, p, { source: 'POLL', at: started });
          items.push({ sku: '#' + ext, result: 'OK', detail: was ? `Ya estaba en la bandeja (${INBOX_ST[was.status][0].toLowerCase()}): mismo registro, sin duplicar` : `Recuperado por la consulta de respaldo: ${INBOX_ST[r.inbox.status][0].toLowerCase()}${r.inbox.order_ids.length ? ' · ' + r.inbox.order_ids.map(i => (D.get('sales_orders', i) || {}).number).join(', ') : ''}`, isNew: !was });
        }
        for (const ib of D.where(T.I, i => i.store_id === s.id && i.status === 'ERROR' && !i.manual_only)) {
          const r = processInbox(ib.id, { auto: true, at: started });
          items.push({ sku: '#' + ib.external_order_id, result: r.status === 'PROCESSED' ? 'OK' : 'ERROR', detail: r.status === 'PROCESSED' ? 'Reintento automático: procesado' : `Reintento automático ${r.auto_attempts} de ${G.param('web_order_retry_max') ?? 5}: ${r.error_code}${r.manual_only ? ' · queda solo para reproceso manual (RN-WEB-04)' : ''}` });
        }
        for (const tx of expirePending(started)) items.push({ sku: 'MP ' + tx.external_payment_id, result: 'OK', detail: `Pago pendiente vencido (${G.param('web_mp_pending_expire_hours') ?? 48} h) del pedido web #${tx.external_reference}` });
      }
      const nNew = items.filter(i => i.isNew).length;
      detail = down ? 'WooCommerce no respondió' : `${items.filter(i => i.sku.startsWith('#')).length} pedido(s) revisados · ${nNew} recuperado(s)`;
    } else {
      const ix = balIndex();
      const maps = mapsOf(s.id).filter(m => !skus || skus.includes(m.variant_id) || skus.includes(m.sku));
      for (const m of maps) {
        const v = m.variant_id && G.variant(m.variant_id);
        if (kind === 'CATALOG') {
          if (m.status === 'UNLINKED' || !v) { items.push({ sku: m.sku, result: 'SKIPPED', detail: 'SKU de la web sin vínculo con el catálogo (WEB-02)' }); continue; }
          if (m.remote_missing) { items.push({ sku: m.sku, variant_id: v.id, mapping_id: m.id, result: 'ERROR', detail: `woocommerce_rest_product_invalid_id: el producto ${m.woo_product_id} ya no existe en WooCommerce; usa «Crear en la web»` }); continue; }
          const target = m.publish && variantOk(v) && publishable(v) ? 'publish' : 'draft';
          if (trigger !== 'MANUAL' && m.web_status === target) continue;
          items.push({ sku: m.sku, variant_id: v.id, mapping_id: m.id, result: 'OK', old: m.web_status || '—', new: target, detail: `${v.name} · ${target === 'publish' ? 'publicado' : 'borrador (no visible)'}` });
        } else {
          if (m.status === 'UNLINKED' || !v || !m.publish) continue;
          if (m.remote_missing) { items.push({ sku: m.sku, variant_id: v.id, mapping_id: m.id, result: 'ERROR', detail: `woocommerce_rest_product_invalid_id: el producto ${m.woo_product_id} ya no existe en WooCommerce` }); continue; }
          if (kind === 'PRICES') {
            const wp = priceIn(s, v.id);
            if (!wp) { items.push({ sku: m.sku, variant_id: v.id, mapping_id: m.id, result: 'ERROR', detail: `RN-CAT-05: sin precio vigente en ${listOf(s, v.brand_id)}` }); continue; }
            if (trigger !== 'MANUAL' && m.last_price_sent === wp.woo) continue;
            items.push({ sku: m.sku, variant_id: v.id, mapping_id: m.id, result: 'OK', old: m.last_price_sent, new: wp.woo, detail: `${money(wp.woo)} por ${wooUnit(v)}${v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? ` (${money(wp.price)}/kg)` : ''}` });
          } else {
            const ps = publishedStock(s, v.id, ix);
            if (trigger !== 'MANUAL' && m.last_stock_sent === ps.published) continue;
            items.push({ sku: m.sku, variant_id: v.id, mapping_id: m.id, result: 'OK', old: m.last_stock_sent, new: ps.published, detail: stockFormula(ps) });
          }
        }
      }
      const okItems = items.filter(i => i.result === 'OK');
      let sent = null;
      if (down) for (const i of okItems) { i.result = 'ERROR'; i.detail = 'HTTP 503 Service Unavailable: WooCommerce no respondió; se reintenta en la próxima corrida'; }
      else if (okItems.length) { sent = pushOutbox(s, kind.toLowerCase() + '.sync', { store: s.code, items: okItems.map(i => ({ sku: i.sku, value: i.new })) }, `${KIND[kind]} ${s.code}`); if (sent && sent.status !== 'SENT') for (const i of okItems) { i.result = 'ERROR'; i.detail = sent.last_error || 'El outbox no pudo enviar'; } }
      const when = started;
      for (const i of items) {
        const m = i.mapping_id && D.get(T.M, i.mapping_id); if (!m) continue;
        if (i.result === 'OK') {
          const patch = kind === 'PRICES' ? { last_price_sent: i.new, last_price_at: when } : kind === 'STOCK' ? { last_stock_sent: i.new, last_stock_at: when } : { web_status: i.new, last_catalog_at: when };
          if (m.status === 'ERROR' && !m.remote_missing) Object.assign(patch, { status: 'LINKED', last_error: null });
          D.update(T.M, m.id, patch, { silent: true });
        } else if (i.result === 'ERROR' && !down) D.update(T.M, m.id, { status: 'ERROR', last_error: i.detail, last_error_at: when }, { silent: true });
      }
      const nOk = items.filter(i => i.result === 'OK').length, nErr = items.filter(i => i.result === 'ERROR').length;
      detail = down ? 'WooCommerce no respondió (HTTP 503)' : !items.length ? 'Sin cambios que enviar' : `${nOk} SKU enviados${nErr ? ` · ${nErr} con error` : ''}${sent ? ` · outbox ${sent.number}` : ''}`;
    }
    const nOk = items.filter(i => i.result === 'OK').length, nErr = items.filter(i => i.result === 'ERROR').length;
    const status = down || (nErr && !nOk) ? 'FAILED' : nErr ? 'PARTIAL' : 'COMPLETED';
    if (trigger === 'SALE' && !items.length) return null;
    return D.insert(T.Y, { number: D.next('WSY', 'WS-', 6), store_id: s.id, kind, trigger, started_at: started, finished_at: addMin(started, 0.05 + items.length * 0.01), status, items_ok: nOk, items_failed: nErr, items, detail, triggered_by: trigger === 'MANUAL' ? G.ctx.userName() : trigger === 'SALE' ? 'Venta registrada' : 'Programador de tareas' }, { silent: true });
  }
  /** «después de cada venta» (RN-WEB-05): reserva al confirmar y salida por venta */
  function stockAfterSale(vids) {
    if (G._seeding || !vids.length) return;
    for (const s of stores().filter(x => x.status === 'ACTIVE' && x.sync_stock)) {
      if (!mapsOf(s.id).some(m => m.status === 'LINKED' && m.publish && vids.includes(m.variant_id))) continue;
      try { runSync(s.id, 'STOCK', { trigger: 'SALE', skus: vids }); } catch (e) { console.warn(e); }
    }
  }
  G.events.on('stock.moved', p => { try { if (p && p.type === 'SALE') stockAfterSale([p.variant]); } catch (e) { console.warn(e); } });
  G.events.on('order.confirmed', p => { try { const o = p && D.get('sales_orders', p.order_id); if (o) stockAfterSale([...new Set((o.lines || []).map(l => l.variant_id))]); } catch (e) { console.warn(e); } });
  G.events.on('order.cancelled', p => { try { const o = p && D.get('sales_orders', p.order_id); if (o) stockAfterSale([...new Set((o.lines || []).map(l => l.variant_id))]); } catch (e) { console.warn(e); } });

  /* =====================================================================
     Indicadores (TAB)
     ===================================================================== */
  const inP = (d, p) => { const x = day(d); return x >= (p.from || '0000') && x <= (p.to || '9999'); };
  const okScope = (row, p) => !p.brand || (row.brands || []).includes(p.brand) || row.brand_id === p.brand;
  G.kpiCalc['KPI-WEB-01'] = p => { const rs = D.where(T.I, i => inP(i.received_at, p) && i.status !== 'IGNORED' && (!p.brand || okScope(store(i.store_id) || {}, p))); const ok = rs.filter(i => i.status === 'PROCESSED' && !i.ever_error).length; return { value: rs.length ? R(ok / rs.length * 100, 1) : 0, numerator: ok, denominator: rs.length }; };
  G.kpiCalc['KPI-WEB-02'] = p => { const n = D.where(T.I, i => i.status === 'ERROR' && day(i.received_at) <= (p.to || G.TODAY)).length; return { value: n, numerator: n, denominator: null }; };
  G.kpiCalc['KPI-WEB-03'] = p => { const xs = D.where(T.X, x => inP(x.date_created, p)); const ok = xs.filter(x => x.date_approved).length; return { value: xs.length ? R(ok / xs.length * 100, 1) : 0, numerator: ok, denominator: xs.length }; };
  G.kpiCalc['KPI-WEB-04'] = p => { finalize(); const ix = balIndex(); const ms = activeMaps().filter(m => !p.brand || m.brand_id === p.brand); const bad = ms.filter(m => mapState(m, ix).issues.length).length; return { value: ms.length ? R(bad / ms.length * 100, 1) : 0, numerator: bad, denominator: ms.length }; };

  /* =====================================================================
     Pantallas
     ===================================================================== */
  const storePills = (onChange) => { const ss = stores(); if (!store(st.store)) st.store = (mainStore() || {}).id; return h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Tienda'), pills(ss.map(s => [s.id, s.name]), st.store, v => { st.store = v; onChange ? onChange(v) : G.refresh(); })); };
  const orderLinks = ids => (ids || []).length ? h('span', { class: 'row', style: 'gap:6px' }, ids.map(id => { const o = D.get('sales_orders', id); return o ? h('a', { href: '#', class: 'mono small', on: { click: e => { e.preventDefault(); e.stopPropagation(); go('PED-03', { id: o.id }); } } }, o.number) : null; })) : '—';
  const nw = t => h('span', { style: 'white-space:nowrap' }, t);
  const yesNo = v => v ? badge('Sí', 'ok') : badge('No', '');
  const reasonModal = (title, label, onOk) => modal(title, (bd, close) => bd.appendChild(form({ id: 'webreason', fields: [{ key: 'reason', label, type: 'textarea', required: true, help: 'Mínimo 10 caracteres. Queda en el historial.' }], submitLabel: 'Confirmar', onCancel: close, onSubmit: v => { try { onOk(v.reason); close(); G.refresh(); return true; } catch (e) { return e.message; } } })));

  /* ---------- WEB-01 Tiendas ---------- */
  function web01(el) {
    finalize();
    const canM = G.can('web.store.manage');
    const body = page(el, { code: 'WEB-01', title: 'Tiendas', sub: 'Cada tienda WooCommerce con su marca, lista de precios, local, almacenes de stock, margen de seguridad, vendedora por defecto y lo que sincroniza. Las credenciales viven cifradas en INT y nunca vuelven al navegador (RN-WEB-10).', actions: [{ label: 'Nueva tienda', kind: 'primary', icon: '+', disabled: !canM, title: canM ? null : 'Requiere web.store.manage', onClick: () => storeForm(null) }] });
    body.appendChild(notice('D-WEB-01 (valor provisional): una tienda, donguando.com, con las cinco marcas como categorías. El pedido toma la marca de sus productos y un carrito con varias marcas se divide en un pedido por marca con el mismo pago.', 'info'));
    const ss = stores();
    const lastStock = D.where(T.Y, r => r.kind === 'STOCK').sort(U.by('started_at', -1))[0];
    body.appendChild(kpis([
      { label: 'Tiendas activas', value: `${ss.filter(s => s.status === 'ACTIVE').length} de ${ss.length}` },
      { label: 'Pedidos web hoy', value: F.num(D.where(T.I, i => day(i.received_at) === G.TODAY).length), sub: 'recibidos en la bandeja', onClick: () => G.go('WEB-04') },
      { label: 'SKU publicados', value: F.num(activeMaps().length), sub: 'mapeos vinculados y visibles', onClick: () => G.go('WEB-02') },
      { label: 'Último envío de stock', value: lastStock ? F.datetime(lastStock.started_at).slice(11) : '—', sub: lastStock ? `${F.date(lastStock.started_at)} · ${G.ui.statusLabel(lastStock.status)} · cada ${G.param('web_stock_sync_minutes') ?? 10} min` : 'sin corridas', tone: lastStock && lastStock.status === 'FAILED' ? 'bad' : '', onClick: () => G.go('WEB-03') },
    ]));
    body.appendChild(table({ id: 'web01', rows: ss, onRow: s => storeDrawer(s.id), search: false,
      columns: [
        { key: 'name', label: 'Tienda', render: s => h('div', null, h('b', null, s.name), h('div', { class: 'small muted mono' }, s.url)) },
        { key: 'brand_id', label: 'Marca · categorías', render: s => h('div', { class: 'small' }, h('b', null, G.brandName(s.brand_id)), (s.brands || []).length > 1 ? h('div', { class: 'muted' }, (s.brands || []).filter(b => b !== s.brand_id).map(G.brandName).join(', ')) : null) },
        { key: 'price_list_id', label: 'Lista de precios', mono: true },
        { key: 'establishment_id', label: 'Local · almacenes', render: s => h('div', { class: 'small' }, G.siteName(s.establishment_id), h('div', { class: 'muted' }, (s.warehouse_ids || []).map(G.whName).join(', '))) },
        { key: 'safety_margin_pct', label: 'Margen', align: 'r', render: s => F.pct(s.safety_margin_pct, 0) },
        { key: 'default_seller_id', label: 'Vendedora', value: s => G.userShort(s.default_seller_id) },
        { key: 'sync', label: 'Sincroniza', sort: false, render: s => h('div', { class: 'row', style: 'gap:4px' }, [['sync_catalog', 'Catálogo'], ['sync_prices', 'Precios'], ['sync_stock', 'Stock'], ['sync_orders', 'Pedidos']].map(([k, l]) => badge(l, s[k] ? 'ok' : ''))) },
        { key: 'last_test_at', label: 'Conexión', render: s => s.last_test_at ? h('div', { class: 'small' }, badge(s.last_test_ok ? 'Correcta' : 'Fallida', s.last_test_ok ? 'ok' : 'bad'), h('div', { class: 'muted' }, F.datetime(s.last_test_at))) : badge('Sin probar', 'warn') },
        { key: 'status', label: 'Estado', render: s => sb(STORE_ST, s.status) },
      ] }));
  }
  function storeDrawer(id) {
    const s = store(id); const canM = G.can('web.store.manage');
    drawer(s.name, (bd, close) => {
      const acts = h('div', { class: 'row' },
        btn('Probar conexión', () => G.require('web.store.manage', () => wrap(() => { const r = testStore(s.id); toast(r.msg, r.ok ? 'ok' : 'bad'); close(); storeDrawer(s.id); G.refresh(); })), { kind: 'primary', sm: true }),
        btn('Editar', () => G.require('web.store.manage', () => { close(); storeForm(s); }), { sm: true }),
        s.status !== 'ACTIVE' ? btn('Activar', () => G.require('web.store.manage', () => reasonModal(`Activar ${s.name}`, 'Motivo', reason => { setStoreStatus(s.id, 'ACTIVE', reason); toast('Tienda activa', 'ok'); close(); })), { sm: true }) : btn('Desactivar', () => G.require('web.store.manage', () => reasonModal(`Desactivar ${s.name}`, 'Motivo', reason => { setStoreStatus(s.id, 'DISABLED', reason); toast('Tienda desactivada: no se sincroniza ni recibe pedidos', 'warn'); close(); })), { sm: true, kind: 'danger' }),
        btn('Mapeo', () => { st.store = s.id; close(); G.go('WEB-02'); }, { sm: true }), btn('Stock publicado', () => { st.store = s.id; close(); G.go('WEB-08'); }, { sm: true }));
      bd.appendChild(acts);
      if (!canM) bd.appendChild(notice('Solo el administrador del sistema configura tiendas y credenciales (web.store.manage).', 'info'));
      if (s.last_test_at && !s.last_test_ok) bd.appendChild(notice(s.last_test_msg, 'bad'));
      bd.appendChild(card('Configuración', dl([['URL', h('span', { class: 'mono' }, s.url)], ['Plataforma', `WooCommerce${s.theme ? ' · tema ' + s.theme : ''}`], ['Marca', G.brandFull(s.brand_id)], ['Categorías (D-WEB-01)', (s.brands || []).map(G.brandName).join(', ')], ['Listas de precios', Object.entries(s.price_lists || { [s.brand_id]: s.price_list_id }).map(([b, l]) => `${G.brandName(b)}: ${l}`).join(' · ')], ['Local', G.siteName(s.establishment_id)], ['Almacenes de stock', (s.warehouse_ids || []).map(G.whName).join(', ')], ['Margen de seguridad', F.pct(s.safety_margin_pct, 0) + ' (RN-WEB-05)'], ['Vendedora por defecto', G.userName(s.default_seller_id)], ['Stock cada', `${G.param('web_stock_sync_minutes') ?? 10} min y tras cada venta`], ['Consulta de respaldo', `cada ${G.param('web_order_poll_minutes') ?? 15} min`], ['Estado', sb(STORE_ST, s.status)]])));
      const cr = s.connector_id ? D.where('integration_credentials', c => (c.connector_id === s.connector_id || c.connector_id === s.payment_connector_id) && c.status === 'ACTIVE') : [];
      bd.appendChild(card('Conectores y credenciales (INT)', h('div', { class: 'stack' },
        dl([['WooCommerce', s.connector_id ? (D.get('integration_connectors', s.connector_id) || {}).name || s.connector_id : '—'], ['Mercado Pago', s.payment_connector_id ? (D.get('integration_connectors', s.payment_connector_id) || {}).name || s.payment_connector_id : '—'], ['Webhook de pedidos', s.webhook_endpoint_id ? maskUrl(s.webhook_endpoint_id) : '—'], ['Webhook de pagos', s.payment_endpoint_id ? maskUrl(s.payment_endpoint_id) : '—']]),
        cr.length ? table({ id: 'web01cr', search: false, rows: cr, columns: [{ key: 'connector_id', label: 'Conector', value: c => (D.get('integration_connectors', c.connector_id) || {}).code || c.connector_id }, { key: 'name', label: 'Credencial', mono: true }, { key: 'v', label: 'Valor', render: c => h('span', { class: 'mono' }, '••••' + (c.last4 || '????')) }, { key: 'version', label: 'Versión', render: c => 'v' + c.version }] }) : h('p', { class: 'muted small' }, 'Sin credenciales cargadas.'),
        h('p', { class: 'small muted' }, 'RN-WEB-10: el valor se guarda cifrado en INT; aquí solo se ven los 4 últimos caracteres. Cárgalas o rótalas en INT-03.'),
        G.screens['INT-03'] ? btn('Ir a credenciales (INT-03)', () => { close(); G.go('INT-03', { connector: s.connector_id }); }, { sm: true }) : null)));
      if (s.last_test_at) bd.appendChild(card('Última prueba de conexión', h('p', { class: 'small' }, `${F.datetime(s.last_test_at)} · ${s.last_test_msg || ''}`)));
      bd.appendChild(card('Historial', timeline((s.history || []).slice().reverse().map(x => ({ at: x.at, title: x.detail, detail: x.user })))));
    }, { wide: true, code: 'WEB-01' });
  }
  const maskUrl = epId => { const e = D.get('webhook_endpoints', epId); if (!e) return epId; return h('span', { class: 'mono small' }, String(e.url || '').replace(/[^/]{24,}$/, t => '••••' + t.slice(-4))); };
  function storeForm(s) {
    if (!G.can('web.store.manage')) { toast(`Tu rol (${G.roleName()}) no tiene el permiso web.store.manage.`, 'warn'); return; }
    const sellers = D.where('users', u => u.role === 'VENDEDORA' && u.status === 'ACTIVE');
    const whs = D.where('warehouses', w => w.allows_sale && w.status === 'ACTIVE');
    const conns = kind => D.where('integration_connectors', c => c.kind === kind).map(c => [c.id, c.name]);
    const vals = s ? Object.assign({}, s, Object.fromEntries((s.brands || []).map(b => ['cat_' + b, true])), Object.fromEntries((s.warehouse_ids || []).map(w => ['wh_' + w, true]))) : { brand_id: 'br-DG', price_list_id: 'pl-DG-PUB', establishment_id: 'es-L1', safety_margin_pct: 10, sync_catalog: true, sync_prices: true, sync_stock: true, sync_orders: true, 'wh_wh-CAM-L1': true };
    drawer(s ? `Editar ${s.name}` : 'Nueva tienda', (bd, close) => {
      bd.appendChild(form({ id: 'webstore', values: vals, submitLabel: s ? 'Guardar' : 'Crear tienda', onCancel: close,
        fields: [
          { key: 'name', label: 'Nombre', required: true, placeholder: 'donguando.com' },
          { key: 'url', label: 'URL (HTTPS)', required: true, placeholder: 'https://www.donguando.com' },
          { key: 'brand_id', label: 'Marca', type: 'select', required: true, options: D.all('brands').map(b => [b.id, b.name]) },
          { key: 'price_list_id', label: 'Lista de precios (canal web)', type: 'select', required: true, options: D.where('price_lists', l => (l.channels || []).includes('WEB')).map(l => [l.id, `${l.code || l.id} · ${G.brandName(l.brand_id)}`]), help: 'RN-WEB-08: el precio que se envía a la web es el de esta lista (RN-CAT-05).' },
          ...D.all('brands').map(b => ({ key: 'cat_' + b.id, label: `Categoría ${G.brandName(b.id)}`, type: 'checkbox' })),
          { key: 'establishment_id', label: 'Local', type: 'select', required: true, options: D.all('establishments').map(e => [e.id, e.name]) },
          ...whs.map(w => ({ key: 'wh_' + w.id, label: `Stock de ${w.name}`, type: 'checkbox' })),
          { key: 'safety_margin_pct', label: 'Margen de seguridad (%)', type: 'number', min: 0, max: 50, required: true, help: 'Stock publicado = disponible × (1 − margen), hacia abajo (RN-WEB-05).' },
          { key: 'default_seller_id', label: 'Vendedora por defecto', type: 'select', options: sellers.map(u => [u.id, `${u.name} (${(u.brands || []).map(G.brandName).join(', ')})`]) },
          { key: 'connector_id', label: 'Conector WooCommerce (INT)', type: 'select', options: conns('COMMERCE') },
          { key: 'payment_connector_id', label: 'Conector Mercado Pago (INT)', type: 'select', options: conns('PAYMENTS') },
          { key: 'sync_catalog', label: 'Sincroniza catálogo', type: 'checkbox' }, { key: 'sync_prices', label: 'Sincroniza precios', type: 'checkbox' },
          { key: 'sync_stock', label: 'Sincroniza stock', type: 'checkbox' }, { key: 'sync_orders', label: 'Recibe pedidos', type: 'checkbox' },
        ],
        onSubmit: v => { try { const x = saveStore(v, s); toast(s ? 'Tienda actualizada' : 'Tienda creada: prueba la conexión para activarla', 'ok'); close(); G.refresh(); storeDrawer(x.id); return true; } catch (e) { return e.message; } } }));
    }, { wide: true, code: 'WEB-01' });
  }

  /* ---------- WEB-02 Mapeo de productos ---------- */
  function web02(el) {
    finalize();
    const canM = G.can('web.mapping.manage');
    const body = page(el, { code: 'WEB-02', title: 'Mapeo de productos', sub: 'Variantes del catálogo frente a productos y variaciones de WooCommerce por SKU. Un pedido web solo se traduce por SKU mapeado (RN-WEB-03); aquí se vincula, desvincula, crea en la web y se ve el último precio y stock enviados.', actions: [{ label: 'Vincular SKU', kind: 'primary', icon: '+', disabled: !canM, onClick: () => linkForm(st.store, null) }] });
    body.appendChild(storePills());
    const s = store(st.store); if (!s) { body.appendChild(G.ui.empty('No hay tiendas.')); return; }
    const ix = balIndex(); const ms = mapsOf(s.id); const stt = new Map(ms.map(m => [m.id, mapState(m, ix)]));
    const linkedV = new Set(ms.filter(m => m.status !== 'UNLINKED').map(m => m.variant_id));
    const missing = D.where('product_variants', v => (s.brands || []).includes(v.brand_id) && variantOk(v) && publishable(v) && !linkedV.has(v.id));
    const k4 = G.kpi('KPI-WEB-04') || { value: 0, numerator: 0, denominator: 0 };
    body.appendChild(kpis([
      { label: 'Vinculados', value: F.num(ms.filter(m => m.status === 'LINKED').length), sub: `${ms.filter(m => m.status === 'LINKED' && m.publish).length} publicados` },
      { label: 'SKU de la web sin vínculo', value: F.num(ms.filter(m => m.status === 'UNLINKED').length), tone: ms.some(m => m.status === 'UNLINKED') ? 'warn' : 'ok', sub: 'llegan a la bandeja como SKU_NOT_MAPPED' },
      { label: 'Publicables sin producto web', value: F.num(missing.length), sub: 'crear en la web' },
      { label: 'Con error', value: F.num(ms.filter(m => m.status === 'ERROR').length), tone: ms.some(m => m.status === 'ERROR') ? 'bad' : 'ok' },
      { label: 'SKU desincronizados', value: F.pct(k4.value), sub: `KPI-WEB-04 · ${k4.numerator} de ${k4.denominator}`, tone: k4.value > 5 ? 'warn' : 'ok' },
    ]));
    const issueTxt = { ERROR: 'Error', VARIANT_INACTIVE: 'Variante inactiva', PRICE_MISSING: 'Sin precio', PRICE: 'Precio por enviar', STOCK: 'Stock por enviar' };
    body.appendChild(table({ id: 'web02', rows: ms, onRow: m => mapDrawer(m.id), pageSize: 30, sort: 'sku',
      columns: [
        { key: 'sku', label: 'SKU web', render: m => h('div', { style: 'white-space:nowrap' }, h('b', { class: 'mono' }, m.sku), h('div', { class: 'small muted mono' }, `#${m.woo_product_id || '—'}${m.woo_variation_id ? '/' + m.woo_variation_id : ''}`)) },
        { key: 'variant_id', label: 'Variante del catálogo', value: m => m.variant_id ? G.variantName(m.variant_id) : '', render: m => { const v = m.variant_id && G.variant(m.variant_id); return v ? h('div', null, v.name, h('div', { class: 'small muted mono' }, v.sku !== m.sku ? 'SKU catálogo ' + v.sku : G.saleModeName(v.sale_mode))) : h('span', { class: 'muted' }, m.woo_name ? `«${m.woo_name}» sin vínculo` : 'Sin vínculo'); } },
        { key: 'brand_id', label: 'Marca', value: m => G.brandName(m.brand_id) },
        { key: 'publish', label: 'Publicado', render: m => yesNo(m.publish) },
        { key: 'price', label: 'Precio enviado / vigente', align: 'r', sort: false, render: m => { const x = stt.get(m.id); return m.status === 'UNLINKED' ? '—' : h('span', { class: x.issues.includes('PRICE') ? 'num' : 'num muted' }, `${money(m.last_price_sent)} / `, h('b', { style: x.issues.includes('PRICE') ? 'color:var(--warn)' : '' }, money(x.price))); } },
        { key: 'stock', label: 'Stock enviado / publicado', align: 'r', sort: false, render: m => { const x = stt.get(m.id); return m.status === 'UNLINKED' || x.stock == null ? '—' : h('span', null, `${F.num(m.last_stock_sent)} / `, h('b', { style: x.issues.includes('STOCK') ? 'color:var(--warn)' : '' }, F.num(x.stock))); } },
        { key: 'status', label: 'Estado', render: m => { const x = stt.get(m.id); return h('div', { class: 'row', style: 'gap:4px' }, sb(MAP_ST, m.status), x.issues.filter(i => i !== 'ERROR').map(i => badge(issueTxt[i], i === 'VARIANT_INACTIVE' || i === 'PRICE_MISSING' ? 'bad' : 'warn'))); } },
      ],
      filters: [{ key: 'brand_id', label: 'Marca', options: (s.brands || []).map(b => [b, G.brandName(b)]) }, { key: 'status', label: 'Estado', options: Object.entries(MAP_ST).map(([k, v]) => [k, v[0]]) }, { key: 'issue', label: 'Problema', value: m => stt.get(m.id).issues.join(',') ? 'SI' : 'NO', options: [['SI', 'Desincronizado o con error'], ['NO', 'Al día']] }],
      actions: m => {
        const a = [];
        if (m.status === 'UNLINKED') a.push(btn('Vincular', () => linkForm(s.id, m), { sm: true, kind: 'primary', disabled: !canM }));
        else a.push(btn('Desvincular', () => G.require('web.mapping.manage', () => reasonModal(`Desvincular ${m.sku}`, 'Motivo', reason => { unlink(m.id, reason); toast(`${m.sku} desvinculado: sus pedidos web quedarán en error hasta volver a vincularlo`, 'warn'); })), { sm: true, disabled: !canM }));
        if (m.remote_missing && m.variant_id) a.push(btn('Crear en la web', () => G.require('web.mapping.manage', () => wrap(() => { const x = createInWeb(s.id, m.variant_id); toast(`Producto ${x.woo_product_id} creado en WooCommerce`, 'ok'); G.refresh(); })), { sm: true }));
        return a;
      } }));
    body.appendChild(card(`Variantes publicables sin producto en ${s.name}`, missing.length ? table({ id: 'web02miss', search: false, rows: missing, columns: [{ key: 'sku', label: 'SKU', mono: true }, { key: 'name', label: 'Variante' }, { key: 'brand_id', label: 'Marca', value: v => G.brandName(v.brand_id) }, { key: 'sale_mode', label: 'Modo', value: v => G.saleModeName(v.sale_mode) }, { key: 'p', label: 'Precio web', align: 'r', render: v => { const wp = priceIn(s, v.id); return wp ? `${money(wp.woo)} / ${wooUnit(v)}` : h('span', { style: 'color:var(--bad)' }, 'Sin precio (RN-CAT-05)'); } }, { key: 'st', label: 'Stock a publicar', align: 'r', render: v => F.num(publishedStock(s, v.id, ix).published) }],
      actions: v => [btn('Crear en la web', () => G.require('web.mapping.manage', () => wrap(() => { const x = createInWeb(s.id, v.id); toast(`${v.name} creado en WooCommerce (producto ${x.woo_product_id})`, 'ok'); G.refresh(); })), { sm: true, kind: 'primary', disabled: !canM })] }) : h('p', { class: 'muted' }, 'Todas las variantes activas y publicables tienen su producto en la web.'), { flush: !!missing.length }));
  }
  function linkForm(sid, m, after) {
    if (!G.can('web.mapping.manage')) { toast(`Tu rol (${G.roleName()}) no tiene el permiso web.mapping.manage.`, 'warn'); return; }
    const s = store(sid);
    const vs = D.where('product_variants', v => (s.brands || []).includes(v.brand_id) && variantOk(v) && v.product_id && (G.productOf(v.id) || {}).product_type === 'GOODS');
    modal(m ? `Vincular ${m.sku}` : 'Vincular SKU de la web', (bd, close) => {
      if (m && m.woo_name) bd.appendChild(notice(`En WooCommerce: «${m.woo_name}» (producto ${m.woo_product_id}).`, 'info'));
      bd.appendChild(form({ id: 'weblink', values: { sku: m ? m.sku : '', variant_id: m && m.previous_variant_id ? m.previous_variant_id : '' }, submitLabel: 'Vincular', onCancel: close,
        fields: [{ key: 'sku', label: 'SKU en WooCommerce', required: true, disabled: !!m }, { key: 'variant_id', label: 'Variante del catálogo', type: 'select', required: true, options: vs.map(v => [v.id, `${v.sku} · ${v.name} · ${G.brandName(v.brand_id)}`]) }, { key: 'reason', label: 'Nota', type: 'text', help: 'Por ejemplo: «XL se vende como cuy entero con peso real»' }],
        onSubmit: v => { try { const x = mapSku(sid, m ? m.sku : v.sku, v.variant_id, { reason: v.reason }); toast(`${x.sku} vinculado a ${G.variantName(x.variant_id)}`, 'ok'); close(); if (after) after(x); else G.refresh(); return true; } catch (e) { return e.message; } } }));
    });
  }
  function mapDrawer(id) {
    const m = D.get(T.M, id); const s = store(m.store_id); const v = m.variant_id && G.variant(m.variant_id);
    const x = mapState(m, balIndex());
    drawer(`SKU ${m.sku}`, (bd) => {
      if (m.last_error) bd.appendChild(notice(m.last_error, 'bad'));
      if (v && !variantOk(v)) bd.appendChild(notice(`RN-WEB-03: ${v.name} está inactiva: los pedidos web con este SKU quedan en ERROR VARIANT_INACTIVE.`, 'bad'));
      const canM = G.can('web.mapping.manage');
      bd.appendChild(h('div', { class: 'row' },
        m.status === 'UNLINKED' ? btn('Vincular', () => linkForm(s.id, m), { kind: 'primary', sm: true, disabled: !canM }) : null,
        m.variant_id ? btn(m.publish ? 'Retirar de la web' : 'Publicar', () => G.require('web.mapping.manage', () => wrap(() => { setPublish(m.id, !m.publish); toast(m.publish ? 'Retirado: queda como borrador en WooCommerce' : 'Publicado', 'ok'); G.ui.closeAll(); G.refresh(); mapDrawer(id); })), { sm: true, disabled: !canM }) : null,
        m.variant_id ? btn('Enviar precio y stock', () => G.require('web.sync.run', () => wrap(() => { const a = runSync(s.id, 'PRICES', { skus: [m.variant_id] }); const b = runSync(s.id, 'STOCK', { skus: [m.variant_id] }); toast(`${a.number} y ${b.number}: ${a.detail}; ${b.detail}`, a.status === 'COMPLETED' && b.status === 'COMPLETED' ? 'ok' : 'warn'); G.ui.closeAll(); G.refresh(); mapDrawer(id); })), { sm: true }) : null));
      bd.appendChild(card('Vínculo', dl([['Tienda', s.name], ['SKU web', h('span', { class: 'mono' }, m.sku)], ['Producto WooCommerce', `${m.woo_product_id || '—'}${m.woo_variation_id ? ' · variación ' + m.woo_variation_id : ''}${m.woo_name ? ' · «' + m.woo_name + '»' : ''}`], ['Variante', v ? `${v.sku} · ${v.name}` : '—'], ['Modo de venta', v ? `${G.saleModeName(v.sale_mode)} · se vende por ${wooUnit(v)}` : '—'], ['Publicado', m.publish ? 'Sí' : 'No'], ['Estado en la web', m.web_status === 'draft' ? 'Borrador' : 'Publicado'], ['Estado', sb(MAP_ST, m.status)]])));
      if (v) { const wp = priceIn(s, v.id); const ps = publishedStock(s, v.id); bd.appendChild(card('Enviado frente a vigente', dl([['Precio enviado', `${money(m.last_price_sent)} · ${F.datetime(m.last_price_at)}`], ['Precio vigente', wp ? `${money(wp.woo)} por ${wooUnit(v)} (lista ${wp.list_id}${v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? `, ${money(wp.price)}/kg × ${F.num(v.nominal_weight_kg, 3)} kg` : ''})` : 'Sin precio (RN-CAT-05)'], ['Stock enviado', `${F.num(m.last_stock_sent)} · ${F.datetime(m.last_stock_at)}`], ['Stock publicado ahora', `${ps.published} (${stockFormula(ps)})`], ['Situación', x.issues.length ? x.issues.join(', ') : 'Al día']]))); }
      bd.appendChild(card('Historial', timeline((m.history || []).slice().reverse().map(y => ({ at: y.at, title: y.detail, detail: y.user })))));
    }, { wide: true, code: 'WEB-02' });
  }

  /* ---------- WEB-03 Sincronización ---------- */
  function web03(el) {
    finalize();
    const can = G.can('web.sync.run');
    const s = store(st.store) || mainStore();
    const run = kind => G.require('web.sync.run', () => wrap(() => { const r = runSync(s.id, kind); toast(`${r.number} · ${KIND[kind]}: ${r.detail}`, r.status === 'COMPLETED' ? 'ok' : r.status === 'PARTIAL' ? 'warn' : 'bad'); G.refresh(); runDrawer(r.id); }));
    const body = page(el, { code: 'WEB-03', title: 'Sincronización', sub: `Corridas de catálogo, precios, stock y pedidos con su resultado por SKU. El stock se envía cada ${G.param('web_stock_sync_minutes') ?? 10} min y después de cada venta; la consulta de respaldo de pedidos corre cada ${G.param('web_order_poll_minutes') ?? 15} min.`, actions: Object.keys(KIND).map(k => ({ label: 'Correr ' + KIND[k].toLowerCase(), kind: k === 'STOCK' ? 'primary' : '', disabled: !can, title: can ? null : 'Requiere web.sync.run', onClick: () => run(k) })) });
    body.appendChild(storePills());
    const rs = D.where(T.Y, r => r.store_id === s.id);
    const last = k => rs.filter(r => r.kind === k).sort(U.by('started_at', -1))[0];
    const ls = last('STOCK'), lo = last('ORDERS');
    const since24 = addMin(nowS(), -24 * 60);
    const err24 = U.sum(rs.filter(r => r.started_at >= since24), r => r.items_failed);
    const k4 = G.kpi('KPI-WEB-04') || { value: 0, numerator: 0, denominator: 0 };
    body.appendChild(kpis([
      { label: 'Último stock', value: ls ? F.datetime(ls.started_at).slice(11) : '—', sub: ls ? `${G.ui.statusLabel(ls.status)} · próxima ${F.datetime(addMin(ls.started_at, G.param('web_stock_sync_minutes') ?? 10)).slice(11)}` : '', tone: ls && ls.status === 'FAILED' ? 'bad' : '' },
      { label: 'Última consulta de pedidos', value: lo ? F.datetime(lo.started_at).slice(11) : '—', sub: lo ? lo.detail : '' },
      { label: 'Ítems con error (24 h)', value: F.num(err24), tone: err24 ? 'warn' : 'ok' },
      { label: 'Corridas fallidas (7 días)', value: F.num(rs.filter(r => r.status === 'FAILED' && day(r.started_at) >= G.date.add(G.TODAY, -6)).length) },
      { label: 'SKU desincronizados', value: F.pct(k4.value), sub: `KPI-WEB-04 · ${k4.numerator} de ${k4.denominator}`, onClick: () => G.go('WEB-02') },
    ]));
    const byDay = U.groupBy(rs.filter(r => r.kind !== 'ORDERS' && day(r.started_at) >= G.date.add(G.TODAY, -6)), r => day(r.started_at));
    const days = []; for (let i = 6; i >= 0; i--) days.push(G.date.add(G.TODAY, -i));
    const todayR = rs.filter(r => day(r.started_at) === G.TODAY);
    body.appendChild(h('div', { class: 'grid c2' },
      card('SKU enviados por día (catálogo, precios y stock)', G.ui.chart.bar({ labels: days.map(d => F.date(d).slice(0, 5)), stacked: true, height: 200, series: [{ name: 'Correctos', values: days.map(d => U.sum(byDay[d] || [], r => r.items_ok)) }, { name: 'Con error', values: days.map(d => U.sum(byDay[d] || [], r => r.items_failed)) }] })),
      card('Corridas de hoy por tipo', G.ui.chart.hbar({ items: Object.keys(KIND).map(k => ({ label: `${KIND[k]} · ${todayR.filter(r => r.kind === k && r.status !== 'COMPLETED').length} con error`, value: todayR.filter(r => r.kind === k).length, tone: todayR.some(r => r.kind === k && r.status === 'FAILED') ? 'warn' : '' })), format: v => F.num(v) }))));
    body.appendChild(table({ id: 'web03', rows: rs, sort: 'started_at', dir: -1, onRow: r => runDrawer(r.id), pageSize: 25,
      columns: [
        { key: 'number', label: 'Corrida', mono: true },
        { key: 'kind', label: 'Tipo', value: r => KIND[r.kind] },
        { key: 'trigger', label: 'Origen', value: r => TRIG[r.trigger] },
        { key: 'started_at', label: 'Inicio', render: r => F.datetime(r.started_at) },
        { key: 'items_ok', label: 'Correctos', align: 'r' },
        { key: 'items_failed', label: 'Con error', align: 'r', render: r => r.items_failed ? h('b', { style: 'color:var(--bad)' }, String(r.items_failed)) : '0' },
        { key: 'detail', label: 'Resultado', render: r => h('span', { class: 'small' }, r.detail) },
        { key: 'status', label: 'Estado', render: r => G.ui.status(r.status) },
      ],
      filters: [{ key: 'kind', label: 'Tipo', options: Object.entries(KIND) }, { key: 'status', label: 'Estado', options: [['COMPLETED', 'Completado'], ['PARTIAL', 'Parcial'], ['FAILED', 'Fallida']] }, { key: 'trigger', label: 'Origen', options: Object.entries(TRIG) }, { key: 'day', label: 'Día', value: r => day(r.started_at), options: days.slice().reverse().map(d => [d, F.date(d)]) }] }));
  }
  function runDrawer(id) {
    const r = D.get(T.Y, id);
    drawer(`Corrida ${r.number}`, (bd, close) => {
      const errs = (r.items || []).filter(i => i.result === 'ERROR' && i.variant_id);
      if (errs.length && r.kind !== 'ORDERS') bd.appendChild(h('div', { class: 'row' }, btn(`Reintentar ${errs.length} ítem(s) con error`, () => G.require('web.sync.run', () => wrap(() => { const x = runSync(r.store_id, r.kind, { skus: errs.map(i => i.variant_id) }); toast(`${x.number}: ${x.detail}`, x.status === 'COMPLETED' ? 'ok' : 'warn'); close(); G.refresh(); runDrawer(x.id); })), { kind: 'primary', sm: true })));
      bd.appendChild(card('Resumen', dl([['Tienda', storeName(r.store_id)], ['Tipo', KIND[r.kind]], ['Origen', `${TRIG[r.trigger]} · ${r.triggered_by}`], ['Inicio', F.datetime(r.started_at)], ['Fin', F.datetime(r.finished_at)], ['Resultado', r.detail], ['Estado', G.ui.status(r.status)]])));
      bd.appendChild(card('Resultado por ítem', table({ id: 'web03it', rows: r.items || [], pageSize: 20, empty: 'Sin cambios que enviar en esta corrida.', columns: [{ key: 'sku', label: 'SKU / pedido', mono: true }, { key: 'old', label: 'Antes', align: 'r', render: i => i.old == null ? '—' : r.kind === 'PRICES' ? money(i.old) : String(i.old) }, { key: 'new', label: 'Enviado', align: 'r', render: i => i.new == null ? '—' : r.kind === 'PRICES' ? money(i.new) : String(i.new) }, { key: 'detail', label: 'Detalle', render: i => h('span', { class: 'small' }, i.detail || '') }, { key: 'result', label: 'Resultado', render: i => badge({ OK: 'Correcto', ERROR: 'Error', SKIPPED: 'Omitido' }[i.result], { OK: 'ok', ERROR: 'bad', SKIPPED: '' }[i.result]) }], filters: [{ key: 'result', label: 'Resultado', options: [['OK', 'Correcto'], ['ERROR', 'Error'], ['SKIPPED', 'Omitido']] }] }), { flush: true }));
    }, { wide: true, code: 'WEB-03' });
  }

  /* ---------- WEB-04 Bandeja de pedidos web ---------- */
  function txOfInboxBadge(ib) { const xs = txsOfInbox(ib); if (!xs.length) return h('span', { class: 'small muted' }, `${(ib.payload || {}).payment_method_title || '—'} · sin transacción`); const x = xs.sort(U.by('date_created', -1))[0]; return h('span', null, sb(TX_ST, x.status), xs.length > 1 ? h('span', { class: 'small muted' }, ` +${xs.length - 1}`) : null); }
  function web04(el) {
    const canR = G.can('web.inbox.resolve');
    const body = page(el, { code: 'WEB-04', title: 'Bandeja de pedidos web', sub: 'Pedidos de WooCommerce recibidos por webhook o por la consulta de respaldo: entran una sola vez por tienda y número (RN-WEB-02) y quedan recibidos, procesados, con error o ignorados, con el pedido creado y el pago de la pasarela.', actions: [
      { label: 'Simular webhook de WooCommerce', kind: 'primary', onClick: () => simWooModal() },
      { label: 'Consulta de respaldo', onClick: () => G.require('web.sync.run', () => wrap(() => { const r = runSync(st.store || 'ws-DG', 'ORDERS'); toast(`${r.number}: ${r.detail}`, r.status === 'COMPLETED' ? 'ok' : 'warn'); G.refresh(); })) },
    ] });
    const rows = D.all(T.I).filter(i => (G.ctx.brand === 'ALL' || ((store(i.store_id) || {}).brands || []).includes(G.ctx.brand)));
    const k1 = G.kpi('KPI-WEB-01') || {}; const k2 = G.kpi('KPI-WEB-02') || {};
    const today = rows.filter(i => day(i.received_at) === G.TODAY);
    const obs = rows.filter(i => i.status === 'PROCESSED' && i.warning_code);
    body.appendChild(kpis([
      { label: 'Recibidos hoy', value: F.num(today.length), sub: `${today.filter(i => i.status === 'PROCESSED').length} procesados` },
      { label: 'Sin intervención (mes)', value: F.pct(k1.value), sub: `KPI-WEB-01 · ${k1.numerator} de ${k1.denominator}`, tone: k1.value >= 90 ? 'ok' : 'warn' },
      { label: 'Con error abiertos', value: F.num(k2.value), sub: 'KPI-WEB-02 · meta 0', tone: k2.value ? 'bad' : 'ok', onClick: () => G.go('WEB-05') },
      { label: 'Sin pin por completar', value: F.num(obs.length), sub: 'RN-WEB-07 · enlace CLI-07', tone: obs.length ? 'warn' : 'ok', onClick: () => G.go('WEB-05') },
      { label: 'Reenvíos absorbidos (mes)', value: F.num(U.sum(rows.filter(i => i.received_at >= G.date.month(G.TODAY)), i => i.duplicates || 0)), sub: 'sin duplicar pedidos' },
    ]));
    if (k2.value) body.appendChild(notice(`RN-WEB-04: ${k2.value} pedido(s) web con error esperan corrección. Se reintentan solos hasta ${G.param('web_order_retry_max') ?? 5} veces; después, solo a mano.`, 'bad'));
    const dates = []; for (let i = 0; i < 10; i++) dates.push(G.date.add(G.TODAY, -i));
    body.appendChild(table({ id: 'web04', rows, sort: 'received_at', dir: -1, onRow: i => inboxDrawer(i.id), pageSize: 25, searchText: i => `${i.external_order_id} WC-${i.external_order_id} ${G.custName(i.customer_id)} ${i.customer_name}`,
      columns: [
        { key: 'received_at', label: 'Recibido', render: i => F.datetime(i.received_at) },
        { key: 'external_order_id', label: 'Pedido web', render: i => h('b', { class: 'mono' }, '#' + i.external_order_id) },
        { key: 'store_id', label: 'Tienda', value: i => storeName(i.store_id) },
        { key: 'customer', label: 'Cliente', value: i => i.customer_id ? G.custName(i.customer_id) : i.customer_name },
        { key: 'total', label: 'Total web', align: 'r', render: i => nw(money(i.total)) },
        { key: 'order_ids', label: 'Pedido(s)', sort: false, render: i => orderLinks(i.order_ids) },
        { key: 'pay', label: 'Pago', sort: false, render: i => txOfInboxBadge(i) },
        { key: 'source', label: 'Origen', value: i => i.source === 'POLL' ? 'Respaldo' : 'Webhook', render: i => h('span', { class: 'small' }, i.source === 'POLL' ? 'Respaldo' : 'Webhook', i.duplicates ? h('span', { class: 'muted' }, ` · ${i.duplicates} reenvío(s)`) : null) },
        { key: 'status', label: 'Estado', render: i => h('div', { class: 'row', style: 'gap:4px' }, sb(INBOX_ST, i.status), i.error_code ? badge(ERR[i.error_code] || i.error_code, 'bad') : null, i.warning_code ? badge(ERR[i.warning_code], 'warn') : null) },
      ],
      filters: [{ key: 'status', label: 'Estado', options: Object.entries(INBOX_ST).map(([k, v]) => [k, v[0]]) }, { key: 'error_code', label: 'Error', options: Object.entries(ERR).filter(([k]) => k !== 'ADDRESS_NO_PIN').map(([k, v]) => [k, v]) }, { key: 'store_id', label: 'Tienda', options: stores().map(s => [s.id, s.name]) }, { key: 'day', label: 'Día', value: i => day(i.received_at), options: dates.map(d => [d, F.date(d)]) }],
      actions: i => i.status === 'ERROR' || i.warning_code ? [btn('Resolver', () => G.go('WEB-05', { id: i.id }), { sm: true, kind: i.status === 'ERROR' ? 'primary' : '', disabled: !canR && i.status === 'ERROR' })] : [] }));
  }
  function inboxDrawer(id) {
    const ib = D.get(T.I, id); const p = ib.payload || {}; const s = store(ib.store_id);
    drawer(`Pedido web #${ib.external_order_id}`, (bd, close) => {
      const canR = G.can('web.inbox.resolve');
      if (ib.status === 'ERROR') bd.appendChild(notice(h('div', null, h('b', null, `${ib.error_code} · ${ERR[ib.error_code] || ''}`), h('div', null, ib.error_detail), h('div', { class: 'small' }, `Intentos automáticos ${ib.auto_attempts || 0} de ${G.param('web_order_retry_max') ?? 5}${ib.manual_only ? ' · solo reproceso manual (RN-WEB-04)' : ''}`)), 'bad'));
      if (ib.status === 'IGNORED') bd.appendChild(notice(`Ignorado: ${ib.ignore_reason}`, 'info'));
      if (ib.warning_code) bd.appendChild(notice(`RN-WEB-07: dirección sin pin; el pedido sigue en borrador hasta que la vendedora complete la ubicación (enlace CLI-07). Falta: ${(ib.missing || []).join(', ')}.`, 'warn'));
      bd.appendChild(h('div', { class: 'row' },
        ib.status === 'ERROR' ? btn('Resolver', () => { close(); G.go('WEB-05', { id: ib.id }); }, { kind: 'primary', sm: true }) : null,
        ib.status === 'ERROR' ? btn('Reprocesar', () => G.require('web.inbox.resolve', () => wrap(() => { const r = reprocess(ib.id); toast(r.status === 'PROCESSED' ? `Procesado: ${r.order_ids.map(x => (D.get('sales_orders', x) || {}).number).join(', ')}` : `Sigue en error: ${r.error_code}`, r.status === 'PROCESSED' ? 'ok' : 'bad'); close(); G.refresh(); inboxDrawer(ib.id); })), { sm: true, disabled: !canR }) : null,
        ['ERROR', 'RECEIVED'].includes(ib.status) ? btn('Ignorar', () => G.require('web.inbox.resolve', () => reasonModal(`Ignorar #${ib.external_order_id}`, 'Motivo', reason => { ignore(ib.id, reason); toast('Pedido web ignorado', 'info'); close(); })), { sm: true, disabled: !canR }) : null,
        ib.warning_code ? btn('Completar pin', () => { close(); G.go('WEB-05', { id: ib.id }); }, { sm: true }) : null,
        btn('Reenviar webhook (prueba)', () => wrap(() => { const r = receiveWoo(p, { store_id: s.id, delivery_id: 'reenvio-' + ((ib.duplicates || 0) + 2) }); toast(r.duplicate ? 'Reenvío deduplicado por INT: mismo registro (RN-WEB-01)' : `Mismo pedido web: se devolvió el registro existente (RN-WEB-02) · reenvíos ${r.inbox.duplicates}`, 'info'); close(); G.refresh(); inboxDrawer(ib.id); }), { sm: true })));
      bd.appendChild(card('Datos', dl([['Tienda', s.name], ['Número externo', '#' + ib.external_order_id], ['Recibido', `${F.datetime(ib.received_at)} · ${ib.source === 'POLL' ? 'consulta de respaldo' : 'webhook'}`], ['Estado', sb(INBOX_ST, ib.status)], ['Cliente', ib.customer_id ? G.custName(ib.customer_id) : `${ib.customer_name} (aún sin ficha)`], ['Celular', (p.billing || {}).phone + ((ib.overrides || {}).phone ? ` → corregido ${(ib.overrides || {}).phone}` : '')], ['Correo', (p.billing || {}).email], ['Dirección', p.shipping ? `${p.shipping.address_1 || ''} · ${p.shipping.address_2 || ''} · ${p.shipping.city || ''}` : '—'], ['Entrega', `${metaOf(p)._delivery_date ? F.date(metaOf(p)._delivery_date) : 'sin fecha'} · ${metaOf(p)._delivery_slot || 'sin franja'}`], ['Pago', p.payment_method_title || p.payment_method], ['UTM', (() => { const u = utmOf(metaOf(p)); return u ? `${u.source} / ${u.medium || '—'} / ${u.campaign || '—'}${u.content ? ' · anuncio ' + u.content : ''}` : 'Sin UTM'; })()], ['Total web', money(ib.total)], ['Pedido(s) creado(s)', orderLinks(ib.order_ids)], ['Intentos', `${ib.attempts || 0} (automáticos ${ib.auto_attempts || 0})`], ['Reenvíos absorbidos', String(ib.duplicates || 0)]])));
      bd.appendChild(card('Líneas', table({ id: 'web04ln', search: false, rows: p.line_items || [], columns: [{ key: 'sku', label: 'SKU', mono: true }, { key: 'name', label: 'Producto web' }, { key: 'quantity', label: 'Cant.', align: 'r' }, { key: 'total', label: 'Total', align: 'r', render: li => money(Number(li.total)) }, { key: 'map', label: 'Mapeo', render: li => { const m = mapBySku(s.id, li.sku); const v = m && m.variant_id && G.variant(m.variant_id); return !m || !m.variant_id ? badge('Sin mapeo', 'bad') : !variantOk(v) ? badge('Inactiva', 'bad') : h('span', { class: 'small' }, v.name); } }] }), { flush: true }));
      const xs = txsOfInbox(ib);
      if (xs.length) bd.appendChild(card('Pagos de Mercado Pago', table({ id: 'web04tx', search: false, rows: xs, onRow: x => txDrawer(x.id), columns: [{ key: 'external_payment_id', label: 'Pago', mono: true }, { key: 'date_created', label: 'Fecha', render: x => F.datetime(x.date_created) }, { key: 'amount', label: 'Monto', align: 'r', render: x => money(x.amount) }, { key: 'status', label: 'Estado', render: x => sb(TX_ST, x.status) }, { key: 'payment_id', label: 'Cobro', render: x => (D.get('payments', x.payment_id) || {}).number || '—' }] }), { flush: true }));
      bd.appendChild(card('Historial', timeline((ib.history || []).slice().reverse().map(x => ({ at: x.at, title: x.detail, detail: `${x.user} · ${x.action}` })))));
      bd.appendChild(card('Cuerpo recibido (crudo)', pre(JSON.stringify(p, null, 2))));
    }, { wide: true, code: 'WEB-04' });
  }
  function nextExt() { return 1 + Math.max(52611, ...D.all(T.I).map(i => Number(i.external_order_id) || 0).filter(n => n < 99000)); }
  function samplePayload(kind, n) {
    const cu = D.get('customers', 'cu-0007') || D.where('customers', c => c.customer_type === 'PERSON' && c.phone)[6];
    const a = D.find('customer_addresses', x => x.customer_id === cu.id && x.is_default) || {};
    const [fn, ...ln] = String(cu.full_name).split(' ');
    const li = (sku, q, k) => { const m = mapBySku('ws-DG', sku); const v = m && m.variant_id ? G.variant(m.variant_id) : null; const wp = v ? priceIn(mainStore(), v.id) : null; return { id: n * 10 + k, name: v ? v.name : sku, sku, product_id: m ? m.woo_product_id : 3201, variation_id: 0, quantity: q, price: (wp ? wp.woo : 50).toFixed(2), total: ((wp ? wp.woo : 50) * q).toFixed(2) }; };
    const lines = kind === 'sku' ? [li('DG-CUY-ENT-XL', 2, 0), li('DG-CAL-1L', 1, 1)] : kind === 'mixed' ? [li('DG-CUY-ENT', 2, 0), li('M5-MER-AGU', 1, 1)] : [li('DG-CUY-ENT', 2, 0), li('DG-CAL-1L', 1, 1)];
    const total = R(U.sum(lines, l => Number(l.total)));
    return { id: n, number: String(n), status: 'processing', currency: 'PEN', date_created: sec(nowS()), total: total.toFixed(2), shipping_total: '0.00', customer_note: 'Tocar el timbre del 2.º piso',
      billing: { first_name: fn, last_name: ln.join(' '), email: cu.email || `cliente${n}@correo.pe`, phone: kind === 'phone' ? '98765432' : String(cu.phone).replace('+51', '').replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') },
      shipping: { first_name: fn, last_name: ln.join(' '), address_1: kind === 'nopin' ? 'Jr. Las Gardenias 455, dpto. 302' : (a.address_line || 'Av. Caminos del Inca 1200'), address_2: kind === 'nopin' ? 'Frente a la bodega La Esquina' : (a.reference || 'Puerta verde'), city: kind === 'nopin' ? 'Santiago de Surco' : (a.district || 'Santiago de Surco') },
      payment_method: 'woo-mercado-pago-basic', payment_method_title: 'Mercado Pago', line_items: lines, shipping_lines: [{ method_id: 'flat_rate', total: '0.00' }],
      meta_data: [{ key: '_delivery_date', value: G.date.add(G.TODAY, 1) }, { key: '_delivery_slot', value: '13:00–17:00' }, { key: '_billing_document', value: 'boleta' }, { key: '_wc_order_attribution_utm_source', value: 'meta' }, { key: '_wc_order_attribution_utm_medium', value: 'cpc' }, { key: '_wc_order_attribution_utm_campaign', value: 'DGMCT1' }] };
  }
  function simWooModal() {
    const n = nextExt();
    const tpl = { normal: 'Pedido completo (cliente con pin)', sku: 'SKU sin mapeo (DG-CUY-ENT-XL)', phone: 'Celular inválido', nopin: 'Dirección nueva sin pin', mixed: 'Carrito con dos marcas (D-WEB-01)' };
    modal('Simular webhook de WooCommerce', (bd, close) => {
      bd.appendChild(h('p', { class: 'small muted' }, 'Simula la llamada de WooCommerce a Aycha (adaptador falso): el cuerpo se firma con el secreto del endpoint (HMAC-SHA256) y entra por INT, que guarda el crudo y deduplica por la clave de entrega (RN-WEB-01).'));
      bd.appendChild(form({ id: 'websimwoo', values: { tpl: 'normal', json: JSON.stringify(samplePayload('normal', n), null, 2), delivery: `entrega-${n}-1`, valid: true, store_id: 'ws-DG' }, submitLabel: 'Enviar webhook', onCancel: close,
        fields: [
          { key: 'tpl', label: 'Plantilla', type: 'select', required: true, options: Object.entries(tpl), onChange: (v, vals, api) => api.set('json', JSON.stringify(samplePayload(v, n), null, 2)) },
          { key: 'store_id', label: 'Tienda', type: 'select', required: true, options: stores().filter(s => s.webhook_endpoint_id || !G.int).map(s => [s.id, s.name]) },
          { key: 'delivery', label: 'Id. de entrega (X-WC-Webhook-Delivery-ID)', required: true, help: 'Repite el mismo id. para simular un reenvío idéntico.' },
          { key: 'valid', label: 'Firma válida', type: 'checkbox' },
          { key: 'json', label: 'Cuerpo JSON (order.created)', type: 'textarea', required: true, span: 2 },
        ],
        onSubmit: v => {
          let pl; try { pl = JSON.parse(v.json); } catch (e) { return 'El JSON no es válido: ' + e.message; }
          try {
            const r = receiveWoo(pl, { store_id: v.store_id, delivery_id: v.delivery, valid: !!v.valid });
            if (r.rejected) toast('HTTP 401 · RN-WEB-01: firma inválida; el evento crudo se guardó y no se procesó.', 'bad');
            else if (r.duplicate) toast(`HTTP 200 · webhook repetido: INT no lo procesa dos veces; bandeja #${pl.number || pl.id} sin cambios (RN-WEB-01).`, 'info');
            else if (r.inbox) toast(`HTTP 200 · #${r.inbox.external_order_id}: ${INBOX_ST[r.inbox.status][0]}${r.inbox.error_code ? ' · ' + r.inbox.error_code : ''}${r.inbox.order_ids.length ? ' · ' + r.inbox.order_ids.map(x => (D.get('sales_orders', x) || {}).number).join(', ') : ''}`, r.inbox.status === 'PROCESSED' ? 'ok' : r.inbox.status === 'ERROR' ? 'bad' : 'info');
            else toast(`HTTP ${r.http} · ${r.status}`, 'info');
            close(); G.refresh(); if (r.inbox) inboxDrawer(r.inbox.id); return true;
          } catch (e) { return e.message; }
        } }));
    }, [], { wide: true });
  }

  /* ---------- WEB-05 Resolver error ---------- */
  function web05(el, params = {}) {
    const canR = G.can('web.inbox.resolve');
    const open = D.where(T.I, i => i.status === 'ERROR' || (i.status === 'PROCESSED' && i.warning_code)).sort((a, b) => (a.status === 'ERROR' ? 0 : 1) - (b.status === 'ERROR' ? 0 : 1) || String(b.received_at).localeCompare(a.received_at));
    const ib = params.id ? D.get(T.I, params.id) : open[0];
    const body = page(el, { code: 'WEB-05', title: ib ? `Resolver pedido web #${ib.external_order_id}` : 'Resolver error', sub: 'Detalle del error (SKU sin mapeo, dirección sin pin, celular inválido, producto inactivo) con la acción para corregir y reprocesar. Un pedido corregido crea su pedido una sola vez (RN-WEB-02).', actions: [{ label: 'Bandeja', onClick: () => G.go('WEB-04') }] });
    if (!canR) body.appendChild(notice('Solo la supervisora de ventas corrige y reprocesa pedidos web con error (web.inbox.resolve). Puedes ver el detalle.', 'info'));
    body.appendChild(card(`Pendientes de resolver (${open.length})`, open.length ? table({ id: 'web05', search: false, rows: open, pageSize: 8, onRow: i => G.go('WEB-05', { id: i.id }),
      columns: [{ key: 'external_order_id', label: 'Pedido web', render: i => h('b', { class: 'mono', style: ib && i.id === ib.id ? 'color:var(--primary)' : '' }, '#' + i.external_order_id) }, { key: 'received_at', label: 'Recibido', render: i => F.datetime(i.received_at) }, { key: 'customer_name', label: 'Cliente', value: i => i.customer_id ? G.custName(i.customer_id) : i.customer_name }, { key: 'code', label: 'Motivo', render: i => badge(ERR[i.error_code || i.warning_code] || i.error_code, i.status === 'ERROR' ? 'bad' : 'warn') }, { key: 'auto_attempts', label: 'Reintentos', align: 'r', render: i => i.status === 'ERROR' ? `${i.auto_attempts || 0} de ${G.param('web_order_retry_max') ?? 5}` : '—' }] }) : G.ui.empty('Sin pedidos web con error ni pines pendientes.'), { flush: !!open.length }));
    if (!ib) return;
    const s = store(ib.store_id); const p = ib.payload || {};
    const grid = h('div', { class: 'grid c2' });
    const code = ib.status === 'ERROR' ? ib.error_code : ib.warning_code;
    const det = h('div', { class: 'stack' });
    det.appendChild(notice(h('div', null, h('b', null, `${code || INBOX_ST[ib.status][0]} · ${ERR[code] || ''}`), h('div', null, ib.status === 'ERROR' ? ib.error_detail : ib.warning_code ? `RN-WEB-07: la dirección «${(p.shipping || {}).address_1 || ''}» llegó sin pin (D-WEB-02: el checkout no lo pide). El pedido sigue en borrador hasta completar la ubicación.` : `El pedido está ${INBOX_ST[ib.status][0].toLowerCase()}.`)), ib.status === 'ERROR' ? 'bad' : ib.warning_code ? 'warn' : 'ok'));
    if (ib.status === 'ERROR') {
      const max = G.param('web_order_retry_max') ?? 5;
      det.appendChild(h('div', null, h('div', { class: 'small muted' }, `Reintentos automáticos ${ib.auto_attempts || 0} de ${max}${ib.manual_only ? ' · agotados: solo reproceso manual (RN-WEB-04)' : ''}`), G.ui.progress((ib.auto_attempts || 0) / max * 100, ib.manual_only ? 'bad' : 'warn')));
    }
    det.appendChild(dl([['Tienda', s.name], ['Cliente', ib.customer_id ? G.custName(ib.customer_id) : ib.customer_name], ['Celular recibido', (p.billing || {}).phone], ['Correo', (p.billing || {}).email], ['Total web', money(ib.total)], ['Pago', txOfInboxBadge(ib)], ['Pedido(s)', orderLinks(ib.order_ids)]]));
    grid.appendChild(card('Detalle', det));
    const fix = h('div', { class: 'stack' });
    const after = r => { toast(r.status === 'PROCESSED' ? `Procesado: ${r.order_ids.map(x => (D.get('sales_orders', x) || {}).number).join(', ')} creado(s)` : `Sigue en error: ${r.error_code} · ${r.error_detail}`, r.status === 'PROCESSED' ? 'ok' : 'bad'); G.go('WEB-05', { id: ib.id }); };
    if (ib.status === 'ERROR' && ['SKU_NOT_MAPPED', 'VARIANT_INACTIVE'].includes(code)) {
      const vs = D.where('product_variants', v => (s.brands || []).includes(v.brand_id) && variantOk(v) && (G.productOf(v.id) || {}).product_type === 'GOODS');
      for (const sku of ib.error_skus || []) {
        const li = (p.line_items || []).find(x => String(x.sku).toUpperCase() === sku) || {};
        const m = mapBySku(s.id, sku);
        const guess = vs.find(v => sku.startsWith(v.sku)) || vs[0];
        fix.appendChild(h('div', { class: 'stack', style: 'gap:6px' }, h('b', { class: 'mono' }, sku), h('div', { class: 'small muted' }, `«${li.name || m && m.woo_name || ''}» · ${li.quantity || 1} × ${money(Number(li.price || 0))}${m && m.variant_id ? ` · hoy vinculado a ${G.variantName(m.variant_id)} (inactiva)` : ''}`),
          form({ id: 'web05map-' + sku, values: { variant_id: guess ? guess.id : '' }, submitLabel: 'Vincular y reprocesar', fields: [{ key: 'variant_id', label: 'Variante activa del catálogo', type: 'select', required: true, options: vs.map(v => [v.id, `${v.sku} · ${v.name}`]) }],
            onSubmit: v => { if (!canR && !G.can('web.mapping.manage')) return `Tu rol (${G.roleName()}) no puede vincular SKU ni reprocesar.`; try { if (m && m.variant_id && m.variant_id !== v.variant_id) { D.update(T.M, m.id, { variant_id: null, status: 'UNLINKED' }, { silent: true }); } mapSku(s.id, sku, v.variant_id, { reason: `Corrección del pedido web #${ib.external_order_id}` }); const r = reprocess(ib.id); after(r); return true; } catch (e) { return e.message; } } })));
      }
      if (G.screens['CAT-02'] && code === 'VARIANT_INACTIVE') fix.appendChild(btn('Revisar la variante en CAT', () => G.go('CAT-02'), { sm: true }));
    } else if (ib.status === 'ERROR' && code === 'PHONE_INVALID') {
      fix.appendChild(form({ id: 'web05ph', values: { phone: '' }, submitLabel: 'Corregir y reprocesar', fields: [{ key: 'phone', label: 'Celular correcto', required: true, placeholder: '987 654 321', help: `Recibido: «${(p.billing || {}).phone}». Se guarda como corrección; el cuerpo crudo no cambia.` }], onSubmit: v => { try { const r = fixPhone(ib.id, v.phone); after(r); return true; } catch (e) { return e.message; } } }));
    } else if (ib.warning_code === 'ADDRESS_NO_PIN') {
      const a = ib.address_id && D.get('customer_addresses', ib.address_id);
      const pk = { lat: null, lng: null };
      const zoneTxt = h('div', { class: 'small muted' }, 'Haz clic en el mapa donde se entrega.');
      const mapBox = h('div');
      const ref = h('input', { class: 'input', value: (a && a.reference) || '', placeholder: 'Referencia (mínimo 10 caracteres)', attrs: { 'aria-label': 'Referencia' } });
      const draw = () => G.ui.clear(mapBox).appendChild(G.ui.map({ height: 260, pick: pk.lat != null ? pk : null, highlightZone: pk.lat != null ? ((G.geo.zoneAt(pk.lat, pk.lng) || {}).id) : null, onPick: (lat, lng, z) => { pk.lat = lat; pk.lng = lng; zoneTxt.textContent = z ? `Zona ${z.name} · delivery ${money(z.delivery_fee)}` : 'Fuera de las zonas de reparto'; draw(); } }));
      draw();
      fix.appendChild(dl([['Dirección', a ? `${a.address_line} · ${a.district || ''}` : '—'], ['Enlace de ubicación', (() => { const l = D.where('customer_location_links', l => l.customer_id === ib.customer_id).sort(U.by('created_at', -1))[0]; return l ? `${l.status === 'USED' ? 'Usado' : 'Enviado'} · vence ${F.datetime(l.expires_at)}` : 'No enviado'; })()]]));
      fix.appendChild(mapBox); fix.appendChild(zoneTxt); fix.appendChild(ref);
      fix.appendChild(h('div', { class: 'row' },
        btn('Guardar pin y confirmar', () => G.require('web.inbox.resolve', () => wrap(() => { const r = resolvePin(ib.id, { lat: pk.lat, lng: pk.lng, reference: ref.value }); toast(`Pin guardado · ${r.join('; ')}`, 'ok'); G.go('WEB-05', { id: ib.id }); })), { kind: 'primary' }),
        G.cli && G.cli.createLink ? btn('Reenviar enlace (CLI-07)', () => wrap(() => { const l = G.cli.createLink(ib.customer_id, { send: true }); toast(`Enlace enviado por WhatsApp: ${l.url}`, 'ok'); G.refresh(); })) : null));
    } else if (ib.status === 'ERROR') {
      fix.appendChild(h('p', null, 'Corrige el dato en su módulo (CAT para precios, CLI para clientes) y reprocesa.'));
      fix.appendChild(btn('Reprocesar', () => G.require('web.inbox.resolve', () => wrap(() => after(reprocess(ib.id)))), { kind: 'primary' }));
    } else fix.appendChild(h('p', { class: 'muted' }, 'Este pedido web no tiene nada pendiente.'));
    if (ib.status === 'ERROR') fix.appendChild(h('div', { class: 'row' }, btn('Reprocesar sin cambios', () => G.require('web.inbox.resolve', () => wrap(() => after(reprocess(ib.id)))), { sm: true }), btn('Ignorar', () => G.require('web.inbox.resolve', () => reasonModal(`Ignorar #${ib.external_order_id}`, 'Motivo', reason => { ignore(ib.id, reason); toast('Pedido web ignorado', 'info'); })), { sm: true }), btn('Ver en la bandeja', () => inboxDrawer(ib.id), { sm: true })));
    grid.appendChild(card('Corregir', fix));
    body.appendChild(grid);
    body.appendChild(card('Historial', timeline((ib.history || []).slice().reverse().map(x => ({ at: x.at, title: x.detail, detail: `${x.user} · ${x.action}` })))));
  }

  /* ---------- WEB-06 Pagos de la pasarela ---------- */
  function web06(el, params = {}) {
    const body = page(el, { code: 'WEB-06', title: 'Pagos de la pasarela', sub: 'Transacciones de Mercado Pago con estado, monto, comisión, neto, fecha de liberación, pedido y cobro creado. Un pago web se confirma solo aprobado, verificado con la API y por el mismo monto (RN-WEB-06).', actions: [
      { label: 'Simular notificación de Mercado Pago', kind: 'primary', onClick: () => simMpModal() },
      { label: 'Vencer pendientes', onClick: () => wrap(() => { const x = expirePending(); toast(x.length ? `${x.length} pago(s) pendiente(s) vencido(s)` : `Ningún pendiente supera ${G.param('web_mp_pending_expire_hours') ?? 48} h`, 'info'); G.refresh(); }) },
    ] });
    const xs = D.all(T.X).filter(x => G.ctx.brand === 'ALL' || ordersOfTx(x).some(o => o.brand_id === G.ctx.brand) || !(x.order_ids || []).length);
    const m0 = G.date.month(G.TODAY);
    const mx = xs.filter(x => x.date_created >= m0);
    const k3 = G.kpi('KPI-WEB-03') || {};
    const appr = mx.filter(x => x.date_approved);
    const toRel = xs.filter(x => recState(x).key === 'TO_RELEASE');
    const rel = releasedUnreconciled();
    body.appendChild(kpis([
      { label: 'Pagos aprobados', value: F.pct(k3.value), sub: `KPI-WEB-03 · ${k3.numerator} de ${k3.denominator} en el mes`, tone: k3.value >= 85 ? 'ok' : 'warn' },
      { label: 'Aprobado en el mes', value: money(U.sum(appr, x => x.amount)), sub: `comisión ${money(U.sum(appr, x => x.fee_amount))} + IGV ${money(U.sum(appr, x => x.fee_igv))}` },
      { label: 'Por liberar', value: money(U.sum(toRel, x => x.net_amount)), sub: `${toRel.length} pago(s) · D-WEB-03 money_release_date` },
      { label: 'Liberado sin conciliar', value: money(U.sum(rel, x => x.net_amount)), sub: `${rel.length} pago(s)`, tone: rel.length ? 'warn' : 'ok', onClick: () => { G.ui._tabState = G.ui._tabState || {}; G.ui._tabState['web06'] = 'rec'; G.refresh(); } },
      { label: 'Pendientes · rechazados', value: `${xs.filter(x => ['pending', 'in_process'].includes(x.status)).length} · ${mx.filter(x => x.status === 'rejected').length}`, sub: 'rechazados en el mes' },
      { label: 'Contracargos y reembolsos', value: F.num(xs.filter(x => ['charged_back', 'refunded'].includes(x.status)).length), tone: xs.some(x => ['charged_back', 'refunded'].includes(x.status) && (x.credit_notes || []).some(c => c.status === 'PREPARED')) ? 'bad' : '', sub: 'RN-WEB-09' },
    ]));
    const tb = body.appendChild(tabs([
      { key: 'tx', label: 'Transacciones', count: xs.length, render: pn => pn.appendChild(table({ id: 'web06', rows: xs, sort: 'date_created', dir: -1, onRow: x => txDrawer(x.id), pageSize: 25, searchText: x => `${x.external_payment_id} ${x.external_reference} WC-${x.external_reference} ${x.payer_email || ''}`,
        columns: [
          { key: 'date_created', label: 'Fecha', render: x => nw(F.datetime(x.date_created)) },
          { key: 'external_payment_id', label: 'Pago MP', mono: true },
          { key: 'external_reference', label: 'Pedido web', render: x => h('span', { class: 'mono' }, '#' + x.external_reference) },
          { key: 'orders', label: 'Pedido(s)', sort: false, render: x => orderLinks((x.order_ids || []).length ? x.order_ids : ordersOfTx(x).map(o => o.id)) },
          { key: 'payment_method', label: 'Medio', value: x => `${x.payment_method}${x.card_last4 ? ' ••' + x.card_last4 : ''}` },
          { key: 'amount', label: 'Monto', align: 'r', render: x => nw(money(x.amount)) },
          { key: 'fee', label: 'Comisión + IGV', align: 'r', value: x => R((x.fee_amount || 0) + (x.fee_igv || 0)), render: x => x.fee_amount ? nw(money(x.fee_amount + x.fee_igv)) : '—' },
          { key: 'net_amount', label: 'Neto', align: 'r', render: x => x.net_amount ? nw(money(x.net_amount)) : '—' },
          { key: 'money_release_date', label: 'Liberación', render: x => F.date(x.money_release_date) },
          { key: 'payment_id', label: 'Cobro', render: x => { const p = x.payment_id && D.get('payments', x.payment_id); return p ? h('span', null, h('span', { class: 'mono small' }, p.number + ' '), G.ui.status(p.status)) : '—'; } },
          { key: 'rec', label: 'Conciliación', value: x => recState(x).label, render: x => { const r = recState(x); return r.key === 'NA' ? '—' : badge(r.label, r.tone); } },
          { key: 'status', label: 'Estado', render: x => sb(TX_ST, x.status) },
        ],
        filters: [{ key: 'status', label: 'Estado', options: Object.entries(TX_ST).map(([k, v]) => [k, v[0]]) }, { key: 'rec', label: 'Conciliación', value: x => recState(x).key, options: [['TO_RELEASE', 'Por liberar'], ['RELEASED', 'Liberado, por conciliar'], ['IN_BATCH', 'En liquidación abierta'], ['MATCHED', 'Conciliado'], ['NO_PAYMENT', 'Sin cobro']] }, { key: 'payment_method', label: 'Medio', options: [...new Set(xs.map(x => x.payment_method))].map(m => [m, m]) }] })) },
      { key: 'rec', label: 'Conciliación', render: pn => recPanel(pn) },
    ], { key: 'web06' }));
    tb.style.minWidth = '0';
    if (params.id) setTimeout(() => txDrawer(params.id), 0);
  }
  function recPanel(pn) {
    const ap = D.where(T.X, x => x.status === 'approved' && x.payment_id);
    const g = U.groupBy(ap, x => x.money_release_date || '—');
    const rows = Object.entries(g).map(([d, list]) => ({ id: d, date: d, list, n: list.length, gross: R(U.sum(list, x => x.amount)), fee: R(U.sum(list, x => x.fee_amount + x.fee_igv)), net: R(U.sum(list, x => x.net_amount)), matched: list.filter(x => recState(x).key === 'MATCHED').length, open: list.filter(x => recState(x).key === 'RELEASED').length }));
    const rel = releasedUnreconciled();
    pn.appendChild(notice(`D-WEB-03 (valor provisional): cada pago se libera en su money_release_date (${releaseDays()} días con tarjeta de crédito; ${releaseDays('debit_card')} con débito y Yape) y se concilia a diario contra la liquidación de Mercado Pago. ${rel.length ? `Hay ${rel.length} pago(s) liberados por ${money(U.sum(rel, x => x.net_amount))} netos sin conciliar.` : 'No hay liberados pendientes.'}`, rel.length ? 'warn' : 'info'));
    pn.appendChild(h('div', { class: 'row', style: 'margin:10px 0' }, btn('Conciliar con liquidación', () => recModal(), { kind: 'primary', disabled: !rel.length })));
    pn.appendChild(table({ id: 'web06rec', rows, sort: 'date', dir: -1, search: false, pageSize: 20,
      columns: [{ key: 'date', label: 'Liberación', render: r => F.date(r.date) }, { key: 'n', label: 'Pagos', align: 'r' }, { key: 'gross', label: 'Bruto', align: 'r', render: r => money(r.gross) }, { key: 'fee', label: 'Comisión + IGV', align: 'r', render: r => money(r.fee) }, { key: 'net', label: 'Neto', align: 'r', render: r => money(r.net) }, { key: 'matched', label: 'Conciliados', align: 'r' }, { key: 'st', label: 'Situación', render: r => r.date > G.TODAY ? badge('Por liberar', 'info') : r.open ? badge(`${r.open} por conciliar`, 'warn') : r.matched === r.n ? badge('Conciliado', 'ok') : badge('En liquidación', 'info') }],
      footer: ['Total', { v: F.num(U.sum(rows, r => r.n)), align: 'r' }, { v: money(U.sum(rows, r => r.gross)), align: 'r' }, { v: money(U.sum(rows, r => r.fee)), align: 'r' }, { v: money(U.sum(rows, r => r.net)), align: 'r' }, '', ''] }));
  }
  function recModal() {
    const rel = releasedUnreconciled();
    const gross = R(U.sum(rel, x => x.amount)), fee = R(U.sum(rel, x => x.fee_amount)), igv = R(U.sum(rel, x => x.fee_igv));
    modal('Conciliar con la liquidación de Mercado Pago', (bd, close) => {
      bd.appendChild(dl([['Pagos liberados', String(rel.length)], ['Bruto', money(gross)], ['Comisión', money(fee)], ['IGV de la comisión', money(igv)], ['Neto esperado', money(R(gross - fee - igv))]]));
      bd.appendChild(form({ id: 'webrec', values: { reference: `LIQ-MP-${G.TODAY.replace(/-/g, '')}-W`, deposit_date: G.TODAY, net_received: R(gross - fee - igv), bank: 'ca-BCP-CTE' }, submitLabel: 'Conciliar', onCancel: close,
        fields: [{ key: 'reference', label: 'Referencia de la liquidación', required: true }, { key: 'deposit_date', label: 'Fecha del abono', type: 'date', required: true }, { key: 'bank', label: 'Cuenta de destino', type: 'select', required: true, options: D.where('cash_accounts', a => a.account_type === 'BANK').map(a => [a.id, a.name]) }, { key: 'net_received', label: 'Neto recibido en el banco', type: 'money', required: true, help: 'Debe cuadrar con bruto − comisión − IGV (RN-CAJ-12).' }],
        onSubmit: v => { try { const r = reconcile({ reference: v.reference, deposit_date: v.deposit_date, bank: v.bank, net_received: v.net_received }); toast(`${r.count} pago(s) conciliados · neto ${money(r.net)}${r.batch ? ' · abono ' + r.batch.reference : ''}`, 'ok'); close(); G.refresh(); return true; } catch (e) { return e.message; } } }));
    });
  }
  function txDrawer(id) {
    const x = D.get(T.X, id); if (!x) return;
    const p = x.payment_id && D.get('payments', x.payment_id); const r = recState(x);
    drawer(`Pago Mercado Pago ${x.external_payment_id}`, (bd, close) => {
      const reopen = () => { close(); G.refresh(); txDrawer(id); };
      if (x.status === 'approved' && !x.payment_id) bd.appendChild(notice(`Aprobado sin cobro: ${((x.history || []).filter(y => y.status === 'WAITING').slice(-1)[0] || {}).detail || 'el pedido web aún no está creado.'}`, 'warn'));
      if (['pending', 'in_process'].includes(x.status)) bd.appendChild(notice(`RN-WEB-06: pendiente; el pedido no se confirma para preparar. Vence a las ${G.param('web_mp_pending_expire_hours') ?? 48} h (${F.datetime(addMin(x.date_created, (G.param('web_mp_pending_expire_hours') ?? 48) * 60))}).`, 'warn'));
      if (x.status === 'rejected') bd.appendChild(notice(`Rechazado: ${MP_DETAIL[x.status_detail] || x.status_detail}. El pedido sigue en borrador${x.customer_notified_at ? '; se avisó al cliente el ' + F.datetime(x.customer_notified_at) : ''}.`, 'bad'));
      if (x.reverse_result) bd.appendChild(notice(`RN-WEB-09 · ${txLabel(x.status)}: ${x.reverse_result}.`, 'bad'));
      bd.appendChild(h('div', { class: 'row' },
        btn('Verificar con la API', () => wrap(() => { const o = processMP(x.external_payment_id, { store_id: x.store_id }); toast(o.detail, 'info'); reopen(); }), { sm: true }),
        x.status === 'approved' && !x.payment_id ? btn('Registrar cobro', () => modal('Registrar cobro de Mercado Pago', (b2, c2) => b2.appendChild(form({ id: 'webpay', values: { amount: x.amount }, submitLabel: 'Registrar', onCancel: c2, fields: [{ key: 'amount', label: 'Monto del cobro', type: 'money', required: true, help: `RN-WEB-06: debe ser igual al aprobado (${money(x.amount)}).` }], onSubmit: v => { try { const pp = confirmPayment(x.id, v.amount); toast(`Cobro ${pp.number} registrado`, 'ok'); c2(); reopen(); return true; } catch (e) { return e.message; } } }))), { kind: 'primary', sm: true }) : null,
        x.status === 'approved' ? btn('Simular contracargo', () => reasonModal('Simular contracargo', 'Motivo del banco emisor', reason => { mpRemote({ id: x.external_payment_id, external_reference: x.external_reference, amount: x.amount, status: 'charged_back', method: x.payment_method, detail: 'cardholder_dispute' }); const o = receiveMP(x.external_payment_id, { store_id: x.store_id }); D.update(T.X, x.id, { chargeback_reason: reason }, { silent: true }); toast(o.detail || 'Contracargo registrado', 'bad'); setTimeout(() => txDrawer(id), 0); }), { sm: true, kind: 'danger' }) : null,
        x.status === 'approved' ? btn('Simular reembolso', () => reasonModal('Simular reembolso', 'Motivo del reembolso', reason => { mpRemote({ id: x.external_payment_id, external_reference: x.external_reference, amount: x.amount, status: 'refunded', method: x.payment_method }); const o = receiveMP(x.external_payment_id, { store_id: x.store_id }); D.update(T.X, x.id, { refund_reason: reason }, { silent: true }); toast(o.detail || 'Reembolso registrado', 'warn'); setTimeout(() => txDrawer(id), 0); }), { sm: true }) : null,
        ['pending', 'in_process'].includes(x.status) ? btn('Simular aprobación', () => wrap(() => { mpRemote({ id: x.external_payment_id, external_reference: x.external_reference, amount: x.amount, status: 'approved', method: x.payment_method }); const o = receiveMP(x.external_payment_id, { store_id: x.store_id }); toast(o.detail, 'ok'); reopen(); }), { sm: true }) : null));
      bd.appendChild(card('Transacción', dl([['Proveedor', 'Mercado Pago'], ['Pago', h('span', { class: 'mono' }, x.external_payment_id)], ['Tienda', storeName(x.store_id)], ['Pedido web', '#' + x.external_reference], ['Pedido(s)', orderLinks((x.order_ids || []).length ? x.order_ids : ordersOfTx(x).map(o => o.id))], ['Estado', h('span', null, sb(TX_ST, x.status), ' ', h('span', { class: 'small muted' }, MP_DETAIL[x.status_detail] || x.status_detail || ''))], ['Medio', `${x.payment_method} · ${x.payment_type}${x.card_last4 ? ' · ••' + x.card_last4 : ''}${x.installments > 1 ? ` · ${x.installments} cuotas` : ''}`], ['Pagador', x.payer_email], ['Creado', F.datetime(x.date_created)], ['Aprobado', F.datetime(x.date_approved)], ['Monto', money(x.amount)], ['Comisión', `${money(x.fee_amount)} + IGV ${money(x.fee_igv)}`], ['Neto', money(x.net_amount)], ['Liberación (D-WEB-03)', F.date(x.money_release_date)], ['Verificado con la API', F.datetime(x.verified_at)], ['Cobro', p ? `${p.number} · ${money(p.amount)} · ${G.ui.statusLabel(p.status)}` : '—'], ['Conciliación', r.key === 'NA' ? '—' : `${r.label}${r.ref ? ' · ' + r.ref : ''}`]])));
      if ((x.credit_notes || []).length) bd.appendChild(card('Notas de crédito (RN-WEB-09)', table({ id: 'web06cn', search: false, rows: x.credit_notes.map(c => Object.assign({ id: c.document_id }, c)), columns: [{ key: 'full_number', label: 'Sobre', mono: true }, { key: 'amount', label: 'Monto', align: 'r', render: c => money(c.amount) }, { key: 'reason', label: 'Motivo', render: c => h('span', { class: 'small' }, c.reason) }, { key: 'status', label: 'Estado', render: c => c.status === 'ISSUED' ? badge('Emitida ' + c.credit_full_number, 'ok') : badge('Preparada', 'warn') }], actions: c => c.status === 'PREPARED' ? [btn('Emitir', () => wrap(() => { const nc = issueCreditNote(x.id, c.document_id); toast(`Nota de crédito ${nc.full_number} emitida`, 'ok'); reopen(); }), { sm: true, kind: 'primary' })] : [] }), { flush: true }));
      bd.appendChild(card('Historial', timeline((x.history || []).slice().reverse().map(y => ({ at: y.at, title: `${TX_ST[y.status] ? TX_ST[y.status][0] : { PAYMENT: 'Cobro', WAITING: 'En espera', REVERSED: 'Reverso', MATCHED: 'Conciliado', CREDIT_NOTE: 'Nota de crédito' }[y.status] || y.status}`, detail: y.detail })))));
      bd.appendChild(card('Respuesta de la API (GET /v1/payments)', pre(JSON.stringify(x.raw || {}, null, 2))));
    }, { wide: true, code: 'WEB-06' });
  }
  function simMpModal() {
    const paidRef = new Set(D.where(T.X, x => x.status === 'approved').map(x => x.store_id + ':' + x.external_reference));
    const recent = D.where(T.I, i => i.status !== 'IGNORED').sort((a, b) => (paidRef.has(a.store_id + ':' + a.external_order_id) ? 1 : 0) - (paidRef.has(b.store_id + ':' + b.external_order_id) ? 1 : 0) || String(b.received_at).localeCompare(a.received_at)).slice(0, 25);
    modal('Simular notificación de Mercado Pago', (bd, close) => {
      bd.appendChild(h('p', { class: 'small muted' }, 'Mercado Pago avisa solo el id. del pago; Aycha lo consulta con la API (adaptador falso) y aplica el efecto según el estado verificado.'));
      bd.appendChild(form({ id: 'websimmp', values: { ref: recent[0] ? recent[0].external_order_id : '', amount: recent[0] ? recent[0].total : 150, status: 'approved', method: 'visa', valid: true }, submitLabel: 'Enviar notificación', onCancel: close,
        fields: [
          { key: 'ref', label: 'Pedido web (external_reference)', type: 'select', required: true, options: recent.map(i => [i.external_order_id, `#${i.external_order_id} · ${money(i.total)} · ${INBOX_ST[i.status][0]}${paidRef.has(i.store_id + ':' + i.external_order_id) ? ' · ya pagado' : ''}`]), onChange: (v, vals, api) => { const i = recent.find(x => x.external_order_id === v); if (i) api.set('amount', i.total); } },
          { key: 'amount', label: 'Monto (S/)', type: 'money', required: true },
          { key: 'status', label: 'Estado', type: 'select', required: true, options: [['approved', 'Aprobado'], ['pending', 'Pendiente'], ['rejected', 'Rechazado']] },
          { key: 'method', label: 'Medio', type: 'select', required: true, options: [['visa', 'Visa'], ['master', 'Mastercard'], ['debvisa', 'Visa débito'], ['yape', 'Yape'], ['pagoefectivo_atm', 'PagoEfectivo']] },
          { key: 'valid', label: 'Firma válida', type: 'checkbox' },
        ],
        onSubmit: v => { try { const r = simulateMP({ external_reference: v.ref, amount: v.amount, status: v.status, method: v.method, valid: !!v.valid, store_id: (D.find(T.I, i => i.external_order_id === v.ref) || {}).store_id }); if (r.rejected) toast('HTTP 401 · RN-WEB-01: firma inválida; no se procesó.', 'bad'); else toast(r.detail, v.status === 'approved' ? 'ok' : 'warn'); close(); G.refresh(); if (r.tx) txDrawer(r.tx.id); return true; } catch (e) { return e.message; } } }));
    }, [], { wide: true });
  }

  /* ---------- WEB-07 Eventos de webhook ---------- */
  const webEndpoints = () => new Set([...stores().flatMap(s => [s.webhook_endpoint_id, s.payment_endpoint_id]).filter(Boolean), 'local']);
  function web07(el) {
    const eps = webEndpoints();
    const evs = D.where('webhook_events', e => eps.has(e.endpoint_id) || e.owner_module === 'WEB');
    const body = page(el, { code: 'WEB-07', title: 'Eventos de webhook', sub: 'Eventos crudos de WooCommerce y Mercado Pago recibidos por INT: firma HMAC, deduplicación y resultado del procesamiento. El crudo se guarda antes de procesar y un evento repetido no se procesa dos veces (RN-WEB-01).', actions: [{ label: 'Simular WooCommerce', onClick: () => simWooModal() }, { label: 'Simular Mercado Pago', onClick: () => simMpModal() }] });
    if (!G.int) body.appendChild(notice('INT no está en este prototipo: los eventos se guardan con la verificación local de respaldo.', 'warn'));
    const d7 = G.date.add(G.TODAY, -6);
    const last7 = evs.filter(e => day(e.received_at) >= d7);
    const dups = U.sum(last7, e => e.duplicates || 0);
    body.appendChild(kpis([
      { label: 'Recibidos (7 días)', value: F.num(last7.length + dups), sub: `${F.num(last7.length)} únicos` },
      { label: 'Rechazados por firma', value: F.num(evs.filter(e => e.status === 'REJECTED').length), tone: evs.some(e => e.status === 'REJECTED') ? 'warn' : 'ok', sub: 'HTTP 401' },
      { label: 'Duplicados absorbidos', value: F.pct(last7.length + dups ? dups / (last7.length + dups) * 100 : 0), sub: `${dups} reenvíos sin reprocesar` },
      { label: 'Fallidos', value: F.num(evs.filter(e => e.status === 'FAILED').length), tone: evs.some(e => e.status === 'FAILED') ? 'bad' : 'ok' },
    ]));
    const prov = e => { const ep = D.get('webhook_endpoints', e.endpoint_id); return ep ? (/mercado/i.test(ep.name) ? 'Mercado Pago' : 'WooCommerce') : (String(e.event_key).startsWith('mp:') ? 'Mercado Pago' : 'WooCommerce'); };
    const sigOk = e => e.status !== 'REJECTED';
    body.appendChild(table({ id: 'web07', rows: evs, sort: 'received_at', dir: -1, onRow: e => evDrawer(e.id), pageSize: 25,
      columns: [
        { key: 'received_at', label: 'Recibido', render: e => F.datetime(e.received_at) },
        { key: 'prov', label: 'Proveedor', value: prov },
        { key: 'event_key', label: 'Clave de deduplicación', render: e => h('span', { class: 'mono small' }, String(e.event_key).slice(0, 34)) },
        { key: 'sig', label: 'Firma', value: e => sigOk(e) ? 'Válida' : 'Inválida', render: e => badge(sigOk(e) ? 'Válida' : 'Inválida', sigOk(e) ? 'ok' : 'bad') },
        { key: 'duplicates', label: 'Reenvíos', align: 'r', render: e => e.duplicates ? h('b', null, String(e.duplicates)) : '0' },
        { key: 'attempts', label: 'Intentos', align: 'r' },
        { key: 'result', label: 'Resultado', render: e => h('span', { class: 'small' }, e.result || e.last_error || '—') },
        { key: 'status', label: 'Estado', render: e => sb(EV_ST, e.status) },
      ],
      filters: [{ key: 'prov', label: 'Proveedor', value: prov, options: [['WooCommerce', 'WooCommerce'], ['Mercado Pago', 'Mercado Pago']] }, { key: 'status', label: 'Estado', options: [['PROCESSED', 'Procesado'], ['REJECTED', 'Rechazado'], ['FAILED', 'Fallido'], ['IGNORED', 'Ignorado'], ['RECEIVED', 'Recibido']] }, { key: 'dup', label: 'Reenvíos', value: e => e.duplicates ? 'SI' : 'NO', options: [['SI', 'Con reenvíos'], ['NO', 'Sin reenvíos']] }] }));
  }
  function evDrawer(id) {
    const e = D.get('webhook_events', id);
    drawer('Evento de webhook', (bd, close) => {
      let body = {}; try { body = JSON.parse(e.body); } catch (x) { }
      const ib = D.find(T.I, i => (i.webhook_event_ids || []).includes(e.id)) || (body.number ? D.find(T.I, i => i.external_order_id === String(body.number)) : null);
      const tx = D.find(T.X, x => (x.webhook_event_ids || []).includes(e.id)) || (body.data && body.data.id ? D.find(T.X, x => x.external_payment_id === String(body.data.id)) : null);
      const ep = D.get('webhook_endpoints', e.endpoint_id);
      let expected = null; if (G.int && G.int.sign && ep) { try { expected = G.int.sign(ep.id, e.body); } catch (x) { } }
      if (e.status === 'REJECTED') bd.appendChild(notice(e.last_error || 'RN-WEB-01: firma inválida.', 'bad'));
      if (e.status === 'FAILED') bd.appendChild(notice(`Fallido tras ${e.attempts} intentos: ${e.last_error}`, 'bad'));
      bd.appendChild(h('div', { class: 'row' }, ib ? btn(`Bandeja #${ib.external_order_id}`, () => { close(); inboxDrawer(ib.id); }, { sm: true }) : null, tx ? btn(`Pago ${tx.external_payment_id}`, () => { close(); txDrawer(tx.id); }, { sm: true }) : null,
        e.status === 'FAILED' && G.int && G.int.reprocess ? btn('Reprocesar', () => wrap(() => { G.int.reprocess(e.id); toast('Webhook reprocesado', 'ok'); close(); G.refresh(); }), { sm: true, kind: 'primary' }) : null));
      bd.appendChild(card('Recepción', dl([['Endpoint', ep ? ep.name : e.endpoint_id], ['Esquema de firma', ep ? ep.signature_scheme : 'Local'], ['Recibido', F.datetime(e.received_at)], ['Respuesta', `HTTP ${e.http_status}${e.ack_ms ? ' en ' + e.ack_ms + ' ms' : ''}`], ['Clave', h('span', { class: 'mono small' }, e.event_key)], ['Firma recibida', h('span', { class: 'mono small', style: 'word-break:break-all' }, e.signature || '—')], ['Firma esperada', expected ? h('span', { class: 'mono small', style: 'word-break:break-all' }, expected === e.signature ? 'Coincide' : expected.slice(0, 18) + '… (no coincide)') : '—'], ['Reenvíos', `${e.duplicates || 0}${e.last_duplicate_at ? ' · último ' + F.datetime(e.last_duplicate_at) : ''}`], ['Intentos', String(e.attempts || 0)], ['Procesado', F.datetime(e.processed_at)], ['Resultado', e.result || e.last_error || '—'], ['Estado', sb(EV_ST, e.status)]])));
      if (e.headers) bd.appendChild(card('Cabeceras', pre(JSON.stringify(e.headers, null, 2))));
      bd.appendChild(card('Cuerpo crudo', pre(JSON.stringify(body, null, 2))));
    }, { wide: true, code: 'WEB-07' });
  }

  /* ---------- WEB-08 Stock publicado ---------- */
  function web08(el) {
    finalize();
    const s = store(st.store) || mainStore();
    const body = page(el, { code: 'WEB-08', title: 'Stock publicado', sub: 'Por SKU: disponible en los almacenes de la tienda (lotes liberados y no vencidos), reservado, margen de seguridad y cantidad publicada en la web (RN-WEB-05).', actions: [{ label: 'Enviar stock ahora', kind: 'primary', disabled: !G.can('web.sync.run'), onClick: () => G.require('web.sync.run', () => wrap(() => { const r = runSync(s.id, 'STOCK'); toast(`${r.number}: ${r.detail}`, r.status === 'COMPLETED' ? 'ok' : 'warn'); G.refresh(); })) }] });
    body.appendChild(storePills());
    body.appendChild(notice(`RN-WEB-05 · publicado = (saldo − reservado) de lotes liberados y no vencidos en ${(s.warehouse_ids || []).map(G.whName).join(', ')} × (1 − ${F.pct(s.safety_margin_pct, 0)}), redondeado hacia abajo. Se envía cada ${G.param('web_stock_sync_minutes') ?? 10} min y después de cada venta.`, 'info'));
    const ix = balIndex();
    const rows = mapsOf(s.id).filter(m => m.variant_id && m.status !== 'UNLINKED').map(m => { const v = G.variant(m.variant_id); const x = publishedStock(s, m.variant_id, ix); return Object.assign({ id: m.id, m, v, sku: m.sku, name: v ? v.name : '', brand_id: m.brand_id, upd: m.publish && m.last_stock_sent !== x.published }, x); });
    body.appendChild(kpis([
      { label: 'SKU publicados', value: F.num(rows.filter(r => r.m.publish).length) },
      { label: 'Agotados en la web', value: F.num(rows.filter(r => r.m.publish && r.published === 0).length), tone: rows.some(r => r.m.publish && r.published === 0) ? 'warn' : 'ok', sub: 'publicado 0' },
      { label: 'En lotes no usables', value: F.num(U.sum(rows, r => r.unusable), 0), sub: 'vencidos, en cuarentena o bloqueados: no suman', tone: rows.some(r => r.unusable > 0) ? 'warn' : '' },
      { label: 'Por enviar', value: F.num(rows.filter(r => r.upd).length), sub: 'publicado ≠ último enviado', tone: rows.some(r => r.upd) ? 'warn' : 'ok' },
    ]));
    body.appendChild(table({ id: 'web08', rows, sort: 'sku', onRow: r => stockDrawer(s, r.m.id), pageSize: 30,
      columns: [
        { key: 'sku', label: 'SKU', render: r => h('span', { class: 'mono', style: 'white-space:nowrap' }, r.sku) },
        { key: 'name', label: 'Producto', render: r => h('div', null, r.name, r.v && !variantOk(r.v) ? h('div', null, badge('Inactiva', 'bad')) : null) },
        { key: 'total', label: 'Saldo', align: 'r', render: r => F.num(r.total, r.total % 1 ? 3 : 0) },
        { key: 'unusable', label: 'No usable', align: 'r', render: r => r.unusable ? h('b', { style: 'color:var(--warn)' }, F.num(r.unusable, r.unusable % 1 ? 3 : 0)) : '0' },
        { key: 'reserved', label: 'Reservado', align: 'r', render: r => F.num(r.reserved, r.reserved % 1 ? 3 : 0) },
        { key: 'available', label: 'Disponible', align: 'r', render: r => F.num(r.available, r.available % 1 ? 3 : 0) },
        { key: 'margin', label: 'Margen', align: 'r', render: r => F.pct(r.margin, 0) },
        { key: 'published', label: 'Publicado', align: 'r', render: r => h('div', null, h('b', null, String(r.m.publish ? r.published : 0)), h('div', { class: 'small muted' }, r.m.publish ? stockFormula(r) : 'no publicado')) },
        { key: 'sent', label: 'Último enviado', align: 'r', value: r => r.m.last_stock_sent, render: r => h('div', null, F.num(r.m.last_stock_sent), h('div', { class: 'small muted' }, F.datetime(r.m.last_stock_at).slice(11) || '')) },
        { key: 'upd', label: 'Situación', value: r => r.upd ? 'Por enviar' : 'Al día', render: r => !r.m.publish ? badge('No publicado', '') : r.upd ? badge('Por enviar', 'warn') : badge('Al día', 'ok') },
      ],
      filters: [{ key: 'brand_id', label: 'Marca', options: (s.brands || []).map(b => [b, G.brandName(b)]) }, { key: 'upd', label: 'Situación', value: r => r.upd ? 'P' : 'A', options: [['P', 'Por enviar'], ['A', 'Al día']] }, { key: 'zero', label: 'Publicado', value: r => r.published === 0 ? 'Z' : 'S', options: [['Z', 'Agotado'], ['S', 'Con stock']] }],
      actions: r => r.upd ? [btn('Enviar', () => G.require('web.sync.run', () => wrap(() => { const x = runSync(s.id, 'STOCK', { skus: [r.m.variant_id] }); toast(`${x.number}: ${x.detail}`, x.status === 'COMPLETED' ? 'ok' : 'warn'); G.refresh(); })), { sm: true })] : [] }));
  }
  function stockDrawer(s, mid) {
    const m = D.get(T.M, mid); const x = publishedStock(s, m.variant_id);
    drawer(`Stock publicado · ${m.sku}`, bd => {
      bd.appendChild(card('Cálculo (RN-WEB-05)', dl([['Variante', G.variantName(m.variant_id)], ['Saldo en almacenes de la tienda', F.num(x.total, 3)], ['En lotes no usables', F.num(x.unusable, 3)], ['Reservado (lotes usables)', F.num(x.reserved, 3)], ['Disponible', F.num(x.available, 3)], ['Margen de seguridad', F.pct(x.margin, 0)], ['Publicado', `${x.published} (${stockFormula(x)})`], ['Último enviado', `${F.num(m.last_stock_sent)} · ${F.datetime(m.last_stock_at)}`]])));
      bd.appendChild(card('Por lote y almacén', table({ id: 'web08lot', search: false, rows: x.lots.map((l, i) => Object.assign({ id: i }, l)), empty: 'Sin saldo en los almacenes de la tienda.', columns: [{ key: 'wh', label: 'Almacén', value: l => G.whName(l.wh) }, { key: 'lot', label: 'Lote', mono: true }, { key: 'expiry', label: 'Vence', render: l => F.date(l.expiry) }, { key: 'qty', label: 'Saldo', align: 'r', render: l => F.num(l.qty, l.qty % 1 ? 3 : 0) }, { key: 'reserved', label: 'Reservado', align: 'r', render: l => F.num(l.reserved, l.reserved % 1 ? 3 : 0) }, { key: 'free', label: 'Suma', align: 'r', render: l => l.usable ? F.num(l.free, l.free % 1 ? 3 : 0) : '0' }, { key: 'usable', label: 'Usable', render: l => l.usable ? badge('Sí', 'ok') : badge(l.why, 'bad') }] }), { flush: true }));
    }, { wide: true, code: 'WEB-08' });
  }

  /* =====================================================================
     Registro, búsqueda, escáner y alertas
     ===================================================================== */
  G.register({
    code: 'WEB', name: 'Tienda web y Mercado Pago', phase: 1, group: 'Ventas y canales',
    screens: [
      { code: 'WEB-01', name: 'Tiendas', render: web01 },
      { code: 'WEB-02', name: 'Mapeo de productos', render: web02 },
      { code: 'WEB-03', name: 'Sincronización', render: web03 },
      { code: 'WEB-04', name: 'Bandeja de pedidos web', render: web04 },
      { code: 'WEB-05', name: 'Resolver error', render: web05 },
      { code: 'WEB-06', name: 'Pagos de la pasarela', render: web06 },
      { code: 'WEB-07', name: 'Eventos de webhook', render: web07 },
      { code: 'WEB-08', name: 'Stock publicado', render: web08 },
    ],
  });

  G.web = { publishedStock, priceIn, mapState, finalize, saveStore, testStore, setStoreStatus, mapSku, unlink, createInWeb, setPublish, registerOrder, processInbox, reprocess, ignore, fixPhone, resolvePin, receiveWoo, importWooOrder, receiveMP, simulateMP, mpRemote, processMP, confirmPayment, reverseTx, issueCreditNote, expirePending, recState, reconcile, releasedUnreconciled, runSync, remoteOrders, samplePayload, store, stores, inboxOf, openInbox: inboxDrawer, openTx: txDrawer };

  const extOf = q => { const m = /^(?:#|WC-?|WEB-?)?\s*(\d{3,6})(?:\/\d)?$/i.exec(String(q || '').trim()); return m ? m[1] : null; };
  G.searchProviders.push(q => {
    const out = []; const ext = extOf(q);
    if (ext) for (const i of D.where(T.I, x => x.external_order_id === ext || x.external_order_id.startsWith(ext)).slice(0, 5)) out.push({ label: `Pedido web #${i.external_order_id} · ${INBOX_ST[i.status][0]}`, sub: `${storeName(i.store_id)} · ${i.customer_id ? G.custName(i.customer_id) : i.customer_name} · ${money(i.total)}${i.order_ids.length ? ' · ' + i.order_ids.map(x => (D.get('sales_orders', x) || {}).number).join(', ') : ''}`, go: () => { G.go('WEB-04'); inboxDrawer(i.id); } });
    const s = String(q || '').trim(); if (/^\d{8,12}$/.test(s)) for (const x of D.where(T.X, x => x.external_payment_id.includes(s)).slice(0, 4)) out.push({ label: `Pago Mercado Pago ${x.external_payment_id} · ${txLabel(x.status)}`, sub: `#${x.external_reference} · ${money(x.amount)}`, go: () => { G.go('WEB-06'); txDrawer(x.id); } });
    return out;
  });
  G.scanHandlers.push(code => { const ext = /^(WC|WEB)-?\d{3,6}/.test(code) ? extOf(code) : null; const i = ext && D.find(T.I, x => x.external_order_id === ext); return i ? () => { G.go('WEB-04'); inboxDrawer(i.id); } : null; });
  G.alertProviders.push(() => {
    const out = [];
    const err = D.where(T.I, i => i.status === 'ERROR');
    if (err.length) out.push({ module: 'WEB', title: `${err.length} pedido(s) web con error`, detail: `${err.map(i => `#${i.external_order_id} ${i.error_code}`).slice(0, 3).join(', ')} · RN-WEB-04`, tone: 'bad', go: () => G.go('WEB-05') });
    const pin = D.where(T.I, i => i.status === 'PROCESSED' && i.warning_code === 'ADDRESS_NO_PIN');
    if (pin.length) out.push({ module: 'WEB', title: `${pin.length} pedido(s) web sin pin`, detail: 'RN-WEB-07: completa la ubicación para confirmarlos.', tone: 'warn', go: () => G.go('WEB-05', { id: pin[0].id }) });
    const wait = D.where(T.X, x => x.status === 'approved' && !x.payment_id);
    if (wait.length) out.push({ module: 'WEB', title: `${wait.length} pago(s) de Mercado Pago aprobado(s) sin pedido`, detail: wait.map(x => `#${x.external_reference} ${money(x.amount)}`).join(', '), tone: 'warn', go: () => G.go('WEB-06') });
    const cn = D.where(T.X, x => (x.credit_notes || []).some(c => c.status === 'PREPARED'));
    if (cn.length) out.push({ module: 'WEB', title: `${cn.length} contracargo(s) o reembolso(s) con nota de crédito por emitir`, detail: 'RN-WEB-09', tone: 'bad', go: () => G.go('WEB-06', { id: cn[0].id }) });
    const ls = D.where(T.Y, r => r.kind === 'STOCK').sort(U.by('started_at', -1))[0];
    if (ls && ls.status === 'FAILED') out.push({ module: 'WEB', title: 'El último envío de stock a la web falló', detail: ls.detail, tone: 'bad', go: () => G.go('WEB-03') });
    return out;
  });

  /* =====================================================================
     Datos de ejemplo (orden 22)
     ===================================================================== */
  G.seed(22, function seedWEB() {
    const ins = (t, row) => D.insert(t, row, { silent: true });
    const r = U.rng(220022);
    MP_API.clear(); WOO_REMOTE.clear();
    D.ensure(T.S); D.ensure(T.M); D.ensure(T.I); D.ensure(T.Y); D.ensure(T.X);
    const users = D.all('users');
    const sellers = users.filter(u => u.role === 'VENDEDORA' && u.status === 'ACTIVE');
    const dgSeller = sellers.find(u => (u.brands || []).includes('br-DG')) || sellers[0] || {};
    const m5Seller = sellers.find(u => (u.brands || []).includes('br-M5') && !(u.brands || []).includes('br-DG')) || dgSeller;
    const admin = (users.find(u => u.role === 'ADMIN_SISTEMA') || {}).name || 'Administrador del sistema';
    const mkt = (users.find(u => u.role === 'MARKETING') || {}).name || 'Marketing';
    const sup = (users.find(u => u.role === 'SUPERVISORA_VENTAS') || {}).name || 'Supervisora de ventas';
    const BR = ['br-DG', 'br-M2', 'br-M3', 'br-M4', 'br-M5'];
    const hasC = id => !!D.get('integration_connectors', id);
    const hasE = id => !!D.get('webhook_endpoints', id);
    const lists = Object.fromEntries(BR.map(b => [b, `pl-${b.slice(3)}-PUB`]));
    ins(T.S, { id: 'ws-DG', code: 'DGCOM', name: 'donguando.com', url: 'https://www.donguando.com', platform: 'WOOCOMMERCE', theme: 'WoodMart', brand_id: 'br-DG', brands: BR, price_list_id: 'pl-DG-PUB', price_lists: lists, establishment_id: 'es-L1', warehouse_ids: ['wh-CAM-L1', 'wh-CNG-L1', 'wh-ALM-L1'], safety_margin_pct: 10, default_seller_id: dgSeller.id || null, sync_catalog: true, sync_prices: true, sync_stock: true, sync_orders: true, connector_id: hasC('ic-WOO-DG') ? 'ic-WOO-DG' : null, payment_connector_id: hasC('ic-MP-DG') ? 'ic-MP-DG' : null, webhook_endpoint_id: hasE('we-WOO-DG') ? 'we-WOO-DG' : null, payment_endpoint_id: hasE('we-MP-DG') ? 'we-MP-DG' : null, status: 'ACTIVE', split_mixed_cart: true, last_test_at: G.TODAY + 'T07:55:12', last_test_ok: true, last_test_msg: 'Conexión correcta con WooCommerceRestAdapter en 212 ms.', created_by: admin, created_at: '2026-08-20T10:00:00', history: [{ at: '2026-08-20T10:00:00', user: admin, detail: 'Tienda creada' }, { at: '2026-08-21T16:40:00', user: admin, detail: 'Prueba de conexión: correcta' }, { at: '2026-08-21T16:45:00', user: admin, detail: 'Estado → Activa: salida en vivo de la integración con donguando.com' }, { at: '2026-09-15T11:00:00', user: admin, detail: 'Configuración editada: margen de seguridad de 5 % a 10 % por quiebres en fin de semana' }, { at: G.TODAY + 'T07:55:12', user: admin, detail: 'Prueba de conexión: correcta' }] });
    ins(T.S, { id: 'ws-STG', code: 'STAGING', name: 'staging.donguando.com', url: 'https://staging.donguando.com', platform: 'WOOCOMMERCE', theme: 'WoodMart', brand_id: 'br-DG', brands: ['br-DG'], price_list_id: 'pl-DG-PUB', price_lists: { 'br-DG': 'pl-DG-PUB' }, establishment_id: 'es-L1', warehouse_ids: ['wh-CAM-L1'], safety_margin_pct: 10, default_seller_id: dgSeller.id || null, sync_catalog: true, sync_prices: true, sync_stock: false, sync_orders: true, connector_id: hasC('ic-WOO-SBX') ? 'ic-WOO-SBX' : null, payment_connector_id: hasC('ic-MP-SBX') ? 'ic-MP-SBX' : null, webhook_endpoint_id: hasE('we-WOO-SBX') ? 'we-WOO-SBX' : null, payment_endpoint_id: hasE('we-MP-SBX') ? 'we-MP-SBX' : null, status: 'TESTING', split_mixed_cart: true, last_test_at: '2026-10-08T15:10:00', last_test_ok: true, last_test_msg: 'Conexión correcta con FakeCommerceProvider (adaptador falso, sin internet).', created_by: admin, created_at: '2026-08-12T09:00:00', history: [{ at: '2026-08-12T09:00:00', user: admin, detail: 'Tienda de pruebas creada con adaptador falso' }] });
    ins(T.S, { id: 'ws-M5', code: 'GOURMET', name: 'gourmet.donguando.com', url: 'https://gourmet.donguando.com', platform: 'WOOCOMMERCE', theme: 'WoodMart', brand_id: 'br-M5', brands: ['br-M5'], price_list_id: 'pl-M5-PUB', price_lists: { 'br-M5': 'pl-M5-PUB' }, establishment_id: 'es-L1', warehouse_ids: ['wh-CAM-L1', 'wh-ALM-L1'], safety_margin_pct: 15, default_seller_id: m5Seller.id || null, sync_catalog: true, sync_prices: true, sync_stock: true, sync_orders: true, connector_id: null, payment_connector_id: null, webhook_endpoint_id: null, payment_endpoint_id: null, status: 'PENDING', split_mixed_cart: false, last_test_at: null, last_test_ok: null, created_by: mkt, created_at: '2026-10-03T12:00:00', history: [{ at: '2026-10-03T12:00:00', user: mkt, detail: 'Tienda creada por configurar: evaluación de una tienda propia para la Marca 5 (D-WEB-01 sigue con una sola tienda)' }] });

    /* mapeos */
    const pubs = D.where('product_variants', v => BR.includes(v.brand_id) && variantOk(v) && publishable(v) && (G.productOf(v.id) || {}).product_type === 'GOODS');
    const leaveOut = pubs[pubs.length - 1];
    const prodIdx = new Map(); let pid = 3000, vidn = 4000;
    const varCount = U.groupBy(pubs, v => v.product_id);
    const mDG = ws => pubs.filter(v => ws.brands.includes(v.brand_id));
    const S = store('ws-DG');
    mDG(S).forEach((v, k) => {
      if (v === leaveOut) return;
      if (!prodIdx.has(v.product_id)) prodIdx.set(v.product_id, ++pid);
      const wp = priceIn(S, v.id);
      const desyncP = k === 3 || k === 9; const err = k === 14;
      ins(T.M, { store_id: 'ws-DG', sku: v.sku, variant_id: v.id, brand_id: v.brand_id, woo_product_id: prodIdx.get(v.product_id), woo_variation_id: varCount[v.product_id].length > 1 ? ++vidn : 0, woo_name: v.name, status: err ? 'ERROR' : 'LINKED', remote_missing: err, last_error: err ? `woocommerce_rest_product_invalid_id: el producto ${prodIdx.get(v.product_id)} ya no existe en WooCommerce (borrado en el panel de WordPress el 09/10)` : null, last_error_at: err ? G.date.add(G.TODAY, -1) + 'T06:00:04' : null, publish: true, web_status: 'publish', last_price_sent: wp ? (desyncP ? R(wp.woo - (k === 3 ? 2 : 3.5)) : wp.woo) : null, last_price_at: desyncP ? G.date.add(G.TODAY, -1) + 'T06:00:03' : G.TODAY + 'T06:00:03', last_stock_at: G.TODAY + 'T11:50:02', seed_stock_offset: k === 5 ? 4 : k === 11 ? -2 : 0, linked_at: '2026-08-21T15:00:00', linked_by: mkt, history: [{ at: '2026-08-21T15:00:00', user: mkt, detail: `Vinculado a ${v.sku} · ${v.name} (importación inicial)` }] });
    });
    const pate = G.variant('va-DG-PATE-180');
    if (pate) ins(T.M, { store_id: 'ws-DG', sku: pate.sku, variant_id: pate.id, brand_id: pate.brand_id, woo_product_id: ++pid, woo_variation_id: 0, woo_name: pate.name, status: 'LINKED', publish: false, web_status: 'draft', last_price_sent: 16.9, last_price_at: '2026-10-05T06:00:03', last_stock_sent: 0, last_stock_at: '2026-10-05T06:10:00', linked_at: '2026-08-21T15:00:00', linked_by: mkt, history: [{ at: '2026-08-21T15:00:00', user: mkt, detail: `Vinculado a ${pate.sku} · ${pate.name}` }, { at: '2026-10-05T06:00:03', user: 'Sistema', detail: 'Variante desactivada en CAT: el producto pasó a borrador en WooCommerce' }] });
    ins(T.M, { store_id: 'ws-DG', sku: 'DG-CUY-ENT-XL', variant_id: null, brand_id: 'br-DG', woo_product_id: 3201, woo_variation_id: 0, woo_name: 'Cuy entero XL (aprox. 1,2 kg)', status: 'UNLINKED', publish: false, web_status: 'publish', last_price_sent: null, last_stock_sent: null, history: [{ at: '2026-10-08T17:30:00', user: 'WooCommerce', detail: 'Producto creado directamente en WordPress por marketing; sin SKU equivalente en el catálogo' }] });
    ins(T.M, { store_id: 'ws-DG', sku: 'DG-PACK-PARRI', variant_id: null, brand_id: 'br-DG', woo_product_id: 3202, woo_variation_id: 0, woo_name: 'Pack parrillero familiar', status: 'UNLINKED', publish: false, web_status: 'publish', last_price_sent: null, last_stock_sent: null, history: [{ at: '2026-10-06T10:00:00', user: 'WooCommerce', detail: 'Combo armado en WordPress; falta crearlo como combo en CAT' }] });
    pubs.filter(v => v.brand_id === 'br-DG').slice(0, 6).forEach((v, k) => { const wp = priceIn(store('ws-STG'), v.id); ins(T.M, { store_id: 'ws-STG', sku: v.sku, variant_id: v.id, brand_id: v.brand_id, woo_product_id: 9100 + k, woo_variation_id: 0, woo_name: v.name, status: 'LINKED', publish: true, web_status: 'publish', last_price_sent: wp ? wp.woo : null, last_price_at: '2026-10-08T15:20:00', last_stock_sent: null, linked_at: '2026-08-12T10:00:00', linked_by: admin, history: [{ at: '2026-08-12T10:00:00', user: admin, detail: 'Vinculado para pruebas' }] }); });
    const mByV = new Map(D.where(T.M, m => m.store_id === 'ws-DG' && m.variant_id).map(m => [m.variant_id, m]));

    /* bandeja: un registro por pedido web del núcleo, con su cuerpo de WooCommerce */
    const intWoo = new Map(D.where('webhook_events', e => e.endpoint_id === 'we-WOO-DG').map(e => [String(e.event_key), e]));
    const intMp = new Map(); for (const e of D.where('webhook_events', e => e.endpoint_id === 'we-MP-DG' && e.status === 'PROCESSED')) { const m = /Cobro (CB-\d+)/.exec(e.result || ''); if (m) intMp.set(m[1], e); }
    const fmtPhone = (ph, k) => { const d = String(ph || '').replace('+51', ''); return k % 3 === 0 ? d : k % 3 === 1 ? d.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : '+51 ' + d; };
    const pmWoo = { 'pm-MP': ['woo-mercado-pago-basic', 'Mercado Pago (tarjetas, Yape y PagoEfectivo)'], 'pm-YAPE': ['yape_manual', 'Yape (envía tu constancia)'], 'pm-CARD': ['woo-mercado-pago-custom', 'Tarjeta de crédito o débito'] };
    function payloadFor(o, n, at, k, extra = {}) {
      const cu = D.get('customers', o.customer_id) || {}; const a = o.address_id ? D.get('customer_addresses', o.address_id) : null; const slot = o.slot_id && D.get('order_time_slots', o.slot_id);
      const [fn, ...ln] = String(cu.full_name || 'Cliente').split(' ');
      const pmw = pmWoo[o.payment_method_id] || pmWoo['pm-MP'];
      const meta = [{ key: '_delivery_date', value: o.delivery_date }, { key: '_delivery_slot', value: slot ? slot.name : null }, { key: '_billing_document', value: o.requested_doc_type === 'INVOICE' ? 'factura' : 'boleta' }];
      if (o.origin_utm) meta.push({ key: '_wc_order_attribution_utm_source', value: o.origin_utm.source }, { key: '_wc_order_attribution_utm_medium', value: o.origin_utm.medium }, { key: '_wc_order_attribution_utm_campaign', value: o.origin_utm.campaign }, { key: '_wc_order_attribution_utm_content', value: o.origin_ad_code });
      return Object.assign({ id: n, number: String(n), status: o.status === 'CANCELLED' ? 'cancelled' : o.status === 'CLOSED' || o.status === 'DELIVERED' ? 'completed' : 'processing', currency: 'PEN', date_created: sec(at), total: String((o.estimated_total || 0).toFixed(2)), shipping_total: String((o.delivery_fee || 0).toFixed(2)), customer_note: o.notes === 'Sin indicaciones' ? '' : o.notes,
        billing: { first_name: fn, last_name: ln.join(' '), email: cu.email || null, phone: fmtPhone(cu.phone, k) }, shipping: a ? { first_name: fn, last_name: ln.join(' '), address_1: a.address_line, address_2: a.reference, city: a.district || (a.address_line || '').split(', ').pop() } : {},
        payment_method: pmw[0], payment_method_title: pmw[1], shipping_lines: [{ method_id: o.fulfillment === 'PICKUP' ? 'local_pickup' : 'flat_rate', total: String((o.delivery_fee || 0).toFixed(2)) }],
        line_items: (o.lines || []).map((l, j) => { const v = G.variant(l.variant_id) || {}; const m = mByV.get(l.variant_id) || {}; return { id: n * 10 + j, name: v.name, sku: v.sku, product_id: m.woo_product_id || null, variation_id: m.woo_variation_id || 0, quantity: l.qty, price: (l.est_amount / (l.qty || 1)).toFixed(2), total: (l.est_amount || 0).toFixed(2) }; }), meta_data: meta }, extra);
    }
    const webOrders = D.where('sales_orders', o => o.channel === 'WEB' && /^WC-\d+$/.test(o.external_ref || '')).sort(U.by('created_at'));
    const ibByOrder = new Map();
    webOrders.forEach((o, k) => {
      const n = Number(o.external_ref.slice(3)); const at = sec(o.created_at); const ev = intWoo.get(String(n));
      const errCase = r() < 0.07; const poll = !errCase && r() < 0.02;
      const delay = errCase ? 12 + Math.floor(r() * 40) : 0;
      const recv = addMin(at, -delay - 0.05);
      const code = errCase ? (r() < 0.6 ? 'SKU_NOT_MAPPED' : 'PHONE_INVALID') : null;
      const sku0 = ((o.lines || [])[0] || {}).variant_id ? (G.variant(o.lines[0].variant_id) || {}).sku : '';
      const hist = [{ at: recv, action: 'RECEIVED', user: poll ? 'Consulta de respaldo' : 'WooCommerce', detail: poll ? 'Recuperado por la consulta de respaldo: el webhook no llegó' : 'Recibido por webhook firmado' }];
      if (errCase) hist.push({ at: addMin(recv, 0.05), action: 'ERROR', user: 'Sistema', detail: code === 'SKU_NOT_MAPPED' ? `SKU_NOT_MAPPED · RN-WEB-03: «${sku0}-W» sin mapeo en donguando.com` : 'PHONE_INVALID · RN-WEB-07: el celular llegó con 8 dígitos' }, { at: addMin(at, -0.5), action: 'FIX', user: sup, detail: code === 'SKU_NOT_MAPPED' ? `SKU corregido en WooCommerce a ${sku0}` : 'Celular confirmado con el cliente por correo y corregido' });
      hist.push({ at, action: 'PROCESSED', user: errCase ? sup : 'Sistema', detail: `Pedido ${o.number} creado en borrador` });
      const ib = ins(T.I, { store_id: 'ws-DG', external_order_id: String(n), received_at: recv, source: poll ? 'POLL' : 'WEBHOOK', status: 'PROCESSED', payload: payloadFor(o, n, recv, k), total: o.estimated_total, customer_name: G.custName(o.customer_id), customer_id: o.customer_id, address_id: o.address_id, order_ids: [o.id], attempts: errCase ? 2 : 1, auto_attempts: errCase ? 1 + Math.floor(r() * 2) : 1, manual_only: false, duplicates: ev ? ev.duplicates || 0 : (r() < 0.08 ? 1 : 0), ever_error: errCase, processed_at: at, webhook_event_ids: ev ? [ev.id] : [], history: hist, created_at: recv });
      o.web_store_id = 'ws-DG'; o.web_inbox_id = ib.id; ibByOrder.set(o.id, ib);
    });

    /* transacciones de Mercado Pago de los cobros web */
    const used = new Set(); const mpId = () => { let x; do { x = String(1318000000 + Math.floor(r() * 9999999)); } while (used.has(x)); used.add(x); return x; };
    const METH = [['visa', 'credit_card', 45], ['master', 'credit_card', 22], ['debvisa', 'debit_card', 13], ['yape', 'digital_wallet', 15], ['amex', 'credit_card', 5]];
    const pickM = () => { let t = r() * 100; for (const m of METH) { t -= m[2]; if (t <= 0) return m; } return METH[0]; };
    const mkTx = (o) => { const raw = mpRemoteSeed(o); MP_API.set(raw.id, raw); const f = (raw.fee_details || []).reduce((a, x) => a + x.amount, 0); const igv = f ? R(f - f / 1.18) : 0; return ins(T.X, { provider: 'MERCADOPAGO', external_payment_id: raw.id, store_id: o.store_id || 'ws-DG', external_reference: String(raw.external_reference), inbox_id: o.inbox_id || null, order_ids: o.order_ids || [], payment_method: raw.payment_method_id, payment_type: raw.payment_type_id, installments: raw.installments, card_last4: (raw.card || {}).last_four_digits || null, payer_email: (raw.payer || {}).email || null, date_created: raw.date_created, date_approved: raw.date_approved, money_release_date: raw.money_release_date, status: raw.status, status_detail: raw.status_detail, amount: raw.transaction_amount, fee_amount: R(f - igv), fee_igv: igv, net_amount: f ? R(raw.transaction_amount - f) : 0, payment_id: o.payment_id || null, verified_at: raw.date_created ? addMin(raw.date_created, 0.1) : null, registered_at: o.payment_id ? addMin(raw.date_created, 0.1) : null, webhook_event_ids: o.event_ids || [], history: o.history || [], raw, created_at: raw.date_created }); };
    function mpRemoteSeed({ id, ref, amount, status, detail, at, email, approvedAt }) {
      const m = pickM(); const isCard = m[1].includes('card');
      const f = ['approved', 'refunded', 'charged_back'].includes(status) ? R(amount * feePct() / 100) : 0; const igv = R(f * 0.18);
      const appr = status === 'approved' || status === 'refunded' || status === 'charged_back' ? (approvedAt || at) : null;
      return { id, status, status_detail: detail, transaction_amount: R(amount), currency_id: 'PEN', external_reference: String(ref), payment_method_id: status === 'pending' ? 'pagoefectivo_atm' : m[0], payment_type_id: status === 'pending' ? 'ticket' : m[1], installments: isCard && m[1] === 'credit_card' && r() < 0.18 ? 3 : 1, card: isCard ? { last_four_digits: String(1000 + Math.floor(r() * 8999)) } : null, payer: { email: email || null }, date_created: sec(at), date_approved: appr ? sec(appr) : null, money_release_date: appr ? G.date.add(day(appr), releaseDays(status === 'pending' ? 'ticket' : m[1])) : null, fee_details: f ? [{ type: 'mercadopago_fee', amount: R(f + igv) }] : [] };
    }
    const ordWeb = new Map(webOrders.map(o => [o.id, o]));
    for (const p of D.where('payments', p => p.payment_method_id === 'pm-MP' && p.status === 'CONFIRMED')) {
      const al = (p.allocations || [])[0]; const o = al && ordWeb.get(al.order_id); if (!o) continue;
      const ib = ibByOrder.get(o.id); const cu = D.get('customers', o.customer_id) || {};
      const ev = intMp.get(p.number); let id = null; try { id = ev ? String(JSON.parse(ev.body).data.id) : null; } catch (e) { } if (!id || used.has(id)) id = mpId(); else used.add(id);
      const at = sec(p.paid_at);
      if (r() < 0.05) mkTx({ id: mpId(), ref: ib.external_order_id, amount: p.amount, status: 'rejected', detail: U.pick(r, ['cc_rejected_insufficient_amount', 'cc_rejected_bad_filled_security_code', 'cc_rejected_call_for_authorize']), at: addMin(at, -6), email: cu.email, inbox_id: ib.id, order_ids: [o.id], history: [{ at: addMin(at, -6), status: 'rejected', detail: 'Rechazado · verificado con la API de Mercado Pago' }] });
      const tx = mkTx({ id, ref: ib.external_order_id, amount: p.amount, status: 'approved', detail: 'accredited', at: addMin(at, -0.3), approvedAt: at, email: cu.email, inbox_id: ib.id, order_ids: [o.id], payment_id: p.id, event_ids: ev ? [ev.id] : [], history: [{ at, status: 'approved', detail: 'Aprobado · acreditado · verificado con la API de Mercado Pago' }, { at: addMin(at, 0.1), status: 'PAYMENT', detail: `Cobro ${p.number} de ${money(p.amount)} aplicado a ${o.number}` }] });
      p.gateway_transaction_id = tx.id; p.fee_amount = tx.fee_amount; p.fee_igv = tx.fee_igv; p.reference = p.reference && /^MP/.test(p.reference) ? 'MP-' + id : p.reference;
    }
    // contracargo (setiembre, con boleta) y reembolso (octubre)
    const withDoc = id => D.find('sales_documents', d => d.order_id === id && ['INVOICE', 'RECEIPT'].includes(d.doc_type));
    const apprTx = D.where(T.X, x => x.status === 'approved' && x.payment_id);
    const cb = apprTx.find(x => x.date_created < '2026-09-25' && x.date_created > '2026-09-18' && withDoc(x.order_ids[0]));
    const rf = apprTx.find(x => x.date_created >= '2026-10-03' && x.date_created < '2026-10-07' && withDoc(x.order_ids[0]) && x !== cb);
    for (const [x, stt, when, why] of [[cb, 'charged_back', '2026-10-08T15:22:00', 'cardholder_dispute'], [rf, 'refunded', '2026-10-09T12:10:00', 'refunded_by_seller']]) {
      if (!x) continue;
      const p = D.get('payments', x.payment_id); const d = withDoc(x.order_ids[0]); const kind = stt === 'charged_back' ? 'Contracargo' : 'Reembolso';
      const reason = stt === 'charged_back' ? `Contracargo de Mercado Pago ${x.external_payment_id} (desconocimiento del tarjetahabiente)` : `Reembolso de Mercado Pago ${x.external_payment_id}: el pedido llegó con la cadena de frío rota`;
      Object.assign(x.raw, { status: stt, status_detail: why }); MP_API.set(x.external_payment_id, x.raw);
      Object.assign(x, { status: stt, status_detail: why, reversed_at: when, reverse_result: `cobro ${p.number} revertido`, credit_notes: [{ document_id: d.id, full_number: d.full_number, amount: R(Math.min(d.total, x.amount)), status: 'PREPARED', reason }], history: x.history.concat([{ at: when, status: stt, detail: `Aprobada → ${kind} · ${MP_DETAIL[why]} · verificado con la API de Mercado Pago` }, { at: when, status: 'REVERSED', detail: `RN-WEB-09: cobro ${p.number} revertido; nota de crédito preparada sobre ${d.full_number}` }]) });
      Object.assign(p, { status: 'REVERSED', reversal_reason: reason, reversed_at: when, reversed_by: 'Mercado Pago', reconciliation_status: 'NOT_APPLICABLE' });
      const o = D.get('sales_orders', x.order_ids[0]); if (o) o.paid_amount = R((o.paid_amount || 0) - p.amount);
    }

    /* casos abiertos de la bandeja */
    const persons = D.where('customers', c => c.customer_type === 'PERSON' && c.status === 'ACTIVE' && /^cu-0/.test(c.id) && c.phone);
    const withPin = persons.filter(c => D.find('customer_addresses', a => a.customer_id === c.id && a.is_default && a.lat != null && a.reference && (D.get('delivery_zones', a.zone_id) || {}).establishment_id === 'es-L1'));
    const cust = k => withPin[(37 + k * 53) % withPin.length];
    const lineOf = (sku, q, k, n) => { const m = D.find(T.M, x => x.store_id === 'ws-DG' && x.sku === sku); const v = m && m.variant_id ? G.variant(m.variant_id) : null; const wp = v ? priceIn(S, v.id) : null; const price = wp ? wp.woo : sku === 'DG-CUY-ENT-XL' ? 52.9 : sku === 'DG-PACK-PARRI' ? 119 : 30; return { id: n * 10 + k, name: v ? v.name : (m || {}).woo_name || sku, sku, product_id: m ? m.woo_product_id : null, variation_id: 0, quantity: q, price: price.toFixed(2), total: R(price * q).toFixed(2) }; };
    const mkPayload = (n, c, at, lines, o = {}) => { const a = D.find('customer_addresses', x => x.customer_id === c.id && x.is_default) || {}; const [fn, ...ln] = String(c.full_name).split(' '); const total = R(U.sum(lines, l => Number(l.total))); return { id: n, number: String(n), status: o.status || 'processing', currency: 'PEN', date_created: at, total: total.toFixed(2), shipping_total: '0.00', customer_note: o.note || '', billing: { first_name: fn, last_name: ln.join(' '), email: c.email || `${fn.toLowerCase()}${n}@gmail.com`, phone: o.phone || fmtPhone(c.phone, n) }, shipping: o.shipping || { first_name: fn, last_name: ln.join(' '), address_1: a.address_line, address_2: a.reference, city: a.district || String(a.address_line || '').split(', ').pop() }, payment_method: o.pm || 'woo-mercado-pago-basic', payment_method_title: o.pm === 'yape_manual' ? 'Yape (envía tu constancia)' : 'Mercado Pago', shipping_lines: [{ method_id: 'flat_rate', total: '0.00' }], line_items: lines, meta_data: [{ key: '_delivery_date', value: o.date || G.date.add(G.TODAY, 1) }, { key: '_delivery_slot', value: o.slot || '13:00–17:00' }, { key: '_billing_document', value: 'boleta' }].concat(o.utm ? [{ key: '_wc_order_attribution_utm_source', value: o.utm[0] }, { key: '_wc_order_attribution_utm_medium', value: 'cpc' }, { key: '_wc_order_attribution_utm_campaign', value: o.utm[1] }] : []) }; };
    const intEv = (ep, key, body, at, dups = 0) => { if (!G.int || !G.int.sign || !hasE(ep)) return null; const raw = JSON.stringify(body); const e = D.get('webhook_endpoints', ep); const sig = G.int.sign(ep, raw); return ins('webhook_events', { endpoint_id: ep, connector_id: e.connector_id, owner_module: 'WEB', event_key: key, headers: { 'content-type': 'application/json', 'x-signature': sig, 'user-agent': ep.includes('MP') ? 'MercadoPago WebHook v1.0' : 'WooCommerce/9.3 Hookshot' }, body: raw, signature: sig, received_at: at, status: 'PROCESSED', http_status: 200, duplicates: dups, attempts: 1, processed_at: addMin(at, 0.02), ack_ms: 48 + (raw.length % 90), result: null, last_error: null, created_at: at }); };
    const openCase = (n, c, at, lines, o = {}) => {
      const pl = mkPayload(n, c, at, lines, o);
      const ev = intEv('we-WOO-DG', `woo:DGCOM:${n}:d1`, pl, at, o.dups || 0);
      const res = registerOrder(o.store || 'ws-DG', pl, { source: o.source || 'WEBHOOK', event_id: ev ? ev.id : null, at });
      const ib = res.inbox;
      if (o.auto != null) D.update(T.I, ib.id, { auto_attempts: o.auto, attempts: o.auto, manual_only: o.auto >= (G.param('web_order_retry_max') ?? 5), duplicates: o.dups || 0, history: ib.history.concat(o.auto > 1 ? [{ at: addMin(at, 15 * (o.auto - 1)), action: 'ERROR', user: 'Sistema', detail: `${ib.error_code} · reintento automático ${o.auto} de ${G.param('web_order_retry_max') ?? 5} sin éxito${o.auto >= 5 ? ' · solo reproceso manual (RN-WEB-04)' : ''}` }] : []) }, { silent: true });
      else if (o.dups) D.update(T.I, ib.id, { duplicates: o.dups }, { silent: true });
      if (ev) D.update('webhook_events', ev.id, { result: `Bandeja #${n}: ${INBOX_ST[D.get(T.I, ib.id).status][0]}${ib.error_code ? ' · ' + ib.error_code : ''}${ib.order_ids.length ? ' · ' + ib.order_ids.map(i => (D.get('sales_orders', i) || {}).number).join(', ') : ''}` }, { silent: true });
      return D.get(T.I, ib.id);
    };
    const payMP = (ib, n, at, status, detail, amount, extraHist) => {
      const id = mpId(); const raw = mpRemoteSeed({ id, ref: n, amount: amount != null ? amount : ib ? ib.total : 0, status, detail, at, email: ib ? (ib.payload.billing || {}).email : null });
      MP_API.set(id, raw);
      const ev = intEv('we-MP-DG', `mp:${id}-${status}`, { id: `${id}-${status}`, type: 'payment', action: 'payment.created', live_mode: true, date_created: at, data: { id } }, addMin(at, 0.1), status === 'approved' && r() < 0.5 ? 1 : 0);
      const out = processMP(id, { store_id: 'ws-DG', event_id: ev ? ev.id : null, at: addMin(at, 0.1) });
      if (ev) D.update('webhook_events', ev.id, { result: out.detail }, { silent: true });
      return out.tx;
    };
    const t = (d, hm) => `${d}T${hm}:00`;
    const yest = G.date.add(G.TODAY, -1), y2 = G.date.add(G.TODAY, -2), y3 = G.date.add(G.TODAY, -3);
    // D: SKU sin mapeo (combo de WordPress), agotó reintentos; su pago pendiente venció
    const iD = openCase(52590, cust(1), t(y2, '11:20'), [lineOf('DG-PACK-PARRI', 1, 0, 52590)], { auto: 5, utm: ['google', 'DGGSR1'] });
    const xD = payMP(iD, 52590, t(y2, '11:21'), 'pending', 'pending_waiting_payment');
    if (xD) D.update(T.X, xD.id, { status: 'expired', status_detail: 'expired_by_aycha', expired_at: addMin(t(y2, '11:21'), 48 * 60), history: xD.history.concat([{ at: addMin(t(y2, '11:21'), 48 * 60), status: 'expired', detail: 'Vencido: 48 h sin aprobación (web_mp_pending_expire_hours); el pedido no se prepara' }]) }, { silent: true });
    // C: producto inactivo (paté), pagado por Yape; agotó reintentos
    openCase(52596, cust(2), t(yest, '18:20'), [lineOf(pate ? pate.sku : 'DG-PATE-180', 2, 0, 52596), lineOf('DG-CUY-ENT', 1, 1, 52596)], { auto: 5, pm: 'yape_manual', note: 'Para regalo, sin boleta en la bolsa' });
    // E: cancelado en WooCommerce antes de pagar → ignorado
    openCase(52598, cust(3), t(yest, '20:45'), [lineOf('DG-CON-ENT', 1, 0, 52598)], { status: 'cancelled' });
    // A: SKU sin mapeo, pago aprobado esperando el pedido (3 reintentos, 2 reenvíos del webhook)
    const iA = openCase(52604, cust(4), t(G.TODAY, '09:42'), [lineOf('DG-CUY-ENT-XL', 2, 0, 52604), lineOf('DG-CAL-1L', 1, 1, 52604)], { auto: 3, dups: 2, utm: ['meta', 'DGMCT1'] });
    payMP(iA, 52604, t(G.TODAY, '09:43'), 'approved', 'accredited');
    // E2: procesado, pago rechazado → pedido en borrador y cliente avisado
    const iE2 = openCase(52605, cust(5), t(G.TODAY, '09:58'), [lineOf('DG-CUY-ENT', 3, 0, 52605)], {});
    payMP(iE2, 52605, t(G.TODAY, '09:59'), 'rejected', 'cc_rejected_call_for_authorize');
    // B: celular inválido, pago pendiente en PagoEfectivo
    const iB = openCase(52606, cust(6), t(G.TODAY, '10:05'), [lineOf('DG-POL-ENT', 1, 0, 52606), lineOf('DG-CAL-1L', 2, 1, 52606)], { auto: 2, phone: '98765432' });
    payMP(iB, 52606, t(G.TODAY, '10:06'), 'pending', 'pending_waiting_payment');
    // H: dirección nueva sin pin (D-WEB-02), pagado: queda en borrador hasta el pin
    const cH = cust(7);
    const iH = openCase(52607, cH, t(G.TODAY, '10:31'), [lineOf('DG-CUY-ENT', 2, 0, 52607), lineOf('DG-CHO-500', 1, 1, 52607)], { shipping: { first_name: cH.full_name.split(' ')[0], last_name: '', address_1: 'Jr. Las Gardenias 455, dpto. 302', address_2: 'Frente a la bodega La Esquina', city: 'Santiago de Surco' }, utm: ['google', 'DGGPM1'] });
    payMP(iH, 52607, t(G.TODAY, '10:32'), 'approved', 'accredited');
    // H2: carrito con dos marcas (D-WEB-01) pagado y confirmado
    const iH2 = openCase(52609, cust(8), t(G.TODAY, '10:48'), [lineOf('DG-CUY-ENT', 2, 0, 52609), lineOf('M5-MER-AGU', 2, 1, 52609)], { note: 'Mermeladas para regalo', utm: ['meta', 'M5MCT2'] });
    payMP(iH2, 52609, t(G.TODAY, '10:49'), 'approved', 'accredited');
    // pedido que el webhook no trajo: el pago llegó y la consulta de respaldo lo recuperará
    const cM = cust(9); const plM = mkPayload(52611, cM, t(G.TODAY, '11:12'), [lineOf('DG-CON-ENT', 1, 0, 52611), lineOf('DG-CAL-1L', 1, 1, 52611)], {});
    WOO_REMOTE.set('ws-DG:52611', plM);
    const idM = mpId(); const rawM = mpRemoteSeed({ id: idM, ref: 52611, amount: Number(plM.total), status: 'approved', detail: 'accredited', at: t(G.TODAY, '11:13'), email: plM.billing.email }); MP_API.set(idM, rawM);
    const evM = intEv('we-MP-DG', `mp:${idM}-approved`, { id: `${idM}-approved`, type: 'payment', action: 'payment.created', live_mode: true, date_created: t(G.TODAY, '11:13'), data: { id: idM } }, t(G.TODAY, '11:13'));
    const outM = processMP(idM, { store_id: 'ws-DG', event_id: evM ? evM.id : null, at: t(G.TODAY, '11:13') });
    if (evM) D.update('webhook_events', evM.id, { result: outM.detail }, { silent: true });
    // staging: pedido de prueba ignorado
    const iF = registerOrder('ws-STG', mkPayload(1043, cust(10), t(y3, '16:05'), [lineOf('DG-CUY-ENT', 1, 0, 1043)], {}), { at: t(y3, '16:05') }).inbox;
    if (iF.status === 'PROCESSED') { for (const oid of iF.order_ids) { const o = D.get('sales_orders', oid); if (o) Object.assign(o, { status: 'CANCELLED', cancel_reason: 'Pedido de prueba de staging', cancelled_at: t(y3, '16:20') }); } D.update(T.I, iF.id, { history: iF.history.concat([{ at: t(y3, '16:20'), action: 'NOTE', user: mkt, detail: 'Pedido de prueba del checkout en staging: el borrador se canceló' }]) }, { silent: true }); }

    /* corridas de sincronización */
    const RUN = (sid, kind, trig, at, items, status, detail, by) => ins(T.Y, { number: D.next('WSY', 'WS-', 6), store_id: sid, kind, trigger: trig, started_at: at, finished_at: addMin(at, 0.05 + items.length * 0.01), status: status || (items.some(i => i.result === 'ERROR') ? (items.some(i => i.result === 'OK') ? 'PARTIAL' : 'FAILED') : 'COMPLETED'), items_ok: items.filter(i => i.result === 'OK').length, items_failed: items.filter(i => i.result === 'ERROR').length, items, detail, triggered_by: by || (trig === 'SCHEDULE' ? 'Programador de tareas' : trig === 'SALE' ? 'Venta registrada' : mkt), created_at: at });
    const dgMaps = D.where(T.M, m => m.store_id === 'ws-DG' && m.variant_id && m.publish);
    const errMap = D.find(T.M, m => m.store_id === 'ws-DG' && m.remote_missing);
    for (let i = 6; i >= 0; i--) {
      const d = G.date.add(G.TODAY, -i);
      const pi = dgMaps.slice(0, 2 + Math.floor(r() * 3)).map(m => { const wp = priceIn(S, m.variant_id); return { sku: m.sku, variant_id: m.variant_id, result: 'OK', old: wp ? R(wp.woo - 1) : null, new: wp ? wp.woo : null, detail: 'Precio vigente de la lista' }; });
      if (errMap && i <= 1) pi.push({ sku: errMap.sku, variant_id: errMap.variant_id, result: 'ERROR', detail: errMap.last_error });
      RUN('ws-DG', 'PRICES', 'SCHEDULE', d + 'T06:00:00', pi, null, pi.length ? `${pi.filter(x => x.result === 'OK').length} SKU enviados${pi.some(x => x.result === 'ERROR') ? ' · 1 con error' : ''}` : 'Sin cambios que enviar');
      if (i > 0) RUN('ws-DG', 'CATALOG', 'SCHEDULE', d + 'T22:00:00', i === 5 && pate ? [{ sku: pate.sku, variant_id: pate.id, result: 'OK', old: 'publish', new: 'draft', detail: `${pate.name} · borrador (variante inactiva en CAT)` }] : [], null, i === 5 ? '1 SKU enviado' : 'Sin cambios que enviar');
      const hours = i === 0 ? null : [8, 10, 12, 14, 16, 18, 20];
      if (hours) for (const hh of hours) { const its = []; const nn = Math.floor(r() * 4); for (let j = 0; j < nn; j++) { const m = U.pick(r, dgMaps); const nv = 2 + Math.floor(r() * 30); its.push({ sku: m.sku, variant_id: m.variant_id, result: 'OK', old: nv + 1 + Math.floor(r() * 3), new: nv, detail: 'Venta y reserva del período' }); } RUN('ws-DG', 'STOCK', 'SCHEDULE', `${d}T${U.pad(hh, 2)}:00:00`, its, null, its.length ? `${its.length} SKU enviados` : 'Sin cambios que enviar'); }
      if (i === 2) RUN('ws-DG', 'STOCK', 'SCHEDULE', `${d}T19:10:00`, [], 'FAILED', 'WooCommerce no respondió (HTTP 503)');
      if (i > 0) for (const hh of [9, 13, 17]) RUN('ws-DG', 'ORDERS', 'SCHEDULE', `${d}T${U.pad(hh, 2)}:15:00`, hh === 13 && i === 4 ? [{ sku: '#' + (52200 + i), result: 'OK', detail: 'Recuperado por la consulta de respaldo: procesado', isNew: true }] : [], null, hh === 13 && i === 4 ? '1 pedido(s) revisados · 1 recuperado(s)' : '0 pedido(s) revisados · 0 recuperado(s)');
    }
    // hoy: stock cada 10 minutos y respaldo de pedidos cada 15
    for (let mm = 6 * 60; mm <= 11 * 60 + 50; mm += 10) {
      const at = `${G.TODAY}T${U.pad(Math.floor(mm / 60), 2)}:${U.pad(mm % 60, 2)}:00`;
      if (mm === 9 * 60 + 40) { RUN('ws-DG', 'STOCK', 'SCHEDULE', at, dgMaps.slice(0, 2).map(m => ({ sku: m.sku, variant_id: m.variant_id, result: 'ERROR', detail: 'HTTP 503 Service Unavailable: WooCommerce no respondió; se reintenta en la próxima corrida' })), 'FAILED', 'WooCommerce no respondió (HTTP 503)'); continue; }
      const its = []; const nn = mm < 8 * 60 ? 0 : Math.floor(r() * 3);
      for (let j = 0; j < nn; j++) { const m = U.pick(r, dgMaps); const nv = 3 + Math.floor(r() * 25); its.push({ sku: m.sku, variant_id: m.variant_id, result: 'OK', old: nv + 1, new: nv, detail: 'Reserva de pedidos confirmados' }); }
      if (errMap && mm === 6 * 60) its.push({ sku: errMap.sku, variant_id: errMap.variant_id, result: 'ERROR', detail: errMap.last_error });
      RUN('ws-DG', 'STOCK', 'SCHEDULE', at, its, null, its.length ? `${its.filter(x => x.result === 'OK').length} SKU enviados${its.some(x => x.result === 'ERROR') ? ' · 1 con error' : ''}` : 'Sin cambios que enviar');
    }
    for (let mm = 6 * 60; mm <= 11 * 60; mm += 15) {
      const at = `${G.TODAY}T${U.pad(Math.floor(mm / 60), 2)}:${U.pad(mm % 60, 2)}:00`;
      const recent = D.where(T.I, i => i.store_id === 'ws-DG' && i.received_at <= at && i.received_at >= addMin(at, -24 * 60));
      const its = recent.slice(-4).map(i => ({ sku: '#' + i.external_order_id, result: 'OK', detail: `Ya estaba en la bandeja (${INBOX_ST[i.status][0].toLowerCase()}): mismo registro, sin duplicar` }));
      const errs = D.where(T.I, i => i.status === 'ERROR' && day(i.received_at) === G.TODAY && i.received_at <= at && Math.floor(hoursBetween(at, i.received_at) * 4) < (i.auto_attempts || 1) - 1).map(i => ({ sku: '#' + i.external_order_id, result: 'ERROR', detail: `Reintento automático: ${i.error_code}` }));
      RUN('ws-DG', 'ORDERS', 'SCHEDULE', at, its.concat(errs), null, `${its.length} pedido(s) revisados · 0 recuperado(s)`);
    }
    RUN('ws-DG', 'STOCK', 'MANUAL', G.TODAY + 'T08:32:00', dgMaps.slice(0, 5).map(m => ({ sku: m.sku, variant_id: m.variant_id, result: 'OK', old: null, new: null, detail: 'Envío completo a pedido de marketing' })), null, '5 SKU enviados', mkt);
    RUN('ws-STG', 'CATALOG', 'MANUAL', '2026-10-08T15:20:00', D.where(T.M, m => m.store_id === 'ws-STG').map(m => ({ sku: m.sku, variant_id: m.variant_id, result: 'OK', old: 'draft', new: 'publish', detail: G.variantName(m.variant_id) })), null, '6 SKU enviados', admin);
  }, 'WEB tienda y pasarela');

  /* =====================================================================
     Pruebas por criterio (CA-WEB-01 … CA-WEB-05)
     ===================================================================== */
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (!String(e.message).startsWith(code)) throw new Error(`Se esperaba ${code} y salió: ${e.message}`); return e; } throw new Error(`Se esperaba ${code} y no falló`); };
  const testPayload = (n, skus) => { const p = samplePayload('normal', n); if (skus) p.line_items = skus.map((s, k) => Object.assign({}, p.line_items[0], { id: n * 10 + k, sku: s, name: s })); p.total = R(U.sum(p.line_items, l => Number(l.total))).toFixed(2); return p; };
  function testStoreWith(wh, margin) {
    if (!D.get('warehouses', wh)) D.insert('warehouses', { id: wh, establishment_id: 'es-L1', code: wh.slice(3), name: 'Almacén de prueba web', wh_type: 'COLD_ROOM', allows_sale: true, status: 'ACTIVE', pick_priority: 99 }, { silent: true });
    return D.insert(T.S, { code: 'TEST' + wh.slice(-2), name: 'Tienda de prueba', url: 'https://prueba.donguando.com', brand_id: 'br-DG', brands: ['br-DG'], price_list_id: 'pl-DG-PUB', establishment_id: 'es-L1', warehouse_ids: [wh], safety_margin_pct: margin, status: 'ACTIVE', sync_stock: true, sync_prices: true, sync_catalog: true, sync_orders: true, history: [] }, { silent: true });
  }
  G.tests.push({ module: 'WEB', name: 'CA-WEB-01: el pedido web 5521 reenviado 3 veces por WooCommerce y la consulta de respaldo → un solo registro en la bandeja y un solo pedido en PED', fn: async () => {
    const p = testPayload(5521);
    const r1 = receiveWoo(p, { store_id: 'ws-DG', delivery_id: 'entrega-5521-1' });
    if (!r1.inbox || r1.inbox.status !== 'PROCESSED') throw new Error('El primer webhook no procesó: ' + (r1.inbox ? r1.inbox.error_detail : r1.status));
    const r2 = receiveWoo(p, { store_id: 'ws-DG', delivery_id: 'entrega-5521-1' });
    const r3 = receiveWoo(p, { store_id: 'ws-DG', delivery_id: 'entrega-5521-2' });
    const r4 = receiveWoo(Object.assign({}, p, { date_modified: nowS() }), { store_id: 'ws-DG', delivery_id: 'entrega-5521-3' });
    if (G.int && !r2.duplicate) throw new Error('INT no marcó como duplicado el reenvío idéntico (RN-WEB-01)');
    const run = runSync('ws-DG', 'ORDERS', { trigger: 'SCHEDULE' });
    if (!run.items.some(i => i.sku === '#5521' && !i.isNew)) throw new Error('La consulta de respaldo no vio el pedido 5521');
    const rows = D.where(T.I, i => i.store_id === 'ws-DG' && i.external_order_id === '5521');
    const ords = D.where('sales_orders', o => o.external_ref === 'WC-5521');
    if (rows.length !== 1) throw new Error(`Hay ${rows.length} registros en la bandeja`);
    if (ords.length !== 1) throw new Error(`Hay ${ords.length} pedidos en PED`);
    if (ords[0].channel !== 'WEB' || !ords[0].origin_utm || ords[0].origin_utm.campaign !== 'DGMCT1') throw new Error('El pedido no quedó con canal WEB y UTM');
    if ([r3, r4].some(x => x.inbox.id !== rows[0].id)) throw new Error('Un reenvío devolvió otro registro');
    if ((rows[0].duplicates || 0) < 2) throw new Error('No se contaron los reenvíos absorbidos');
  } });
  G.tests.push({ module: 'WEB', name: 'CA-WEB-02: SKU «DG-CUY-ENT-XL» sin mapeo → ERROR SKU_NOT_MAPPED; al mapearlo y reprocesar se crea el pedido', fn: async () => {
    const m0 = mapBySku('ws-DG', 'DG-CUY-ENT-XL'); if (m0 && m0.variant_id) throw new Error('El SKU ya estaba mapeado en los datos de ejemplo');
    const r = receiveWoo(testPayload(5522, ['DG-CUY-ENT-XL']), { store_id: 'ws-DG', delivery_id: 'entrega-5522-1' });
    const ib = r.inbox;
    if (ib.status !== 'ERROR' || ib.error_code !== 'SKU_NOT_MAPPED') throw new Error(`Estado ${ib.status} ${ib.error_code}`);
    if (!/^RN-WEB-03/.test(ib.error_detail)) throw new Error('El detalle no cita RN-WEB-03');
    if (D.find('sales_orders', o => o.external_ref === 'WC-5522')) throw new Error('Se creó un pedido con un SKU sin mapeo');
    mapSku('ws-DG', 'DG-CUY-ENT-XL', 'va-DG-CUY-ENT', { reason: 'Prueba CA-WEB-02' });
    const x = reprocess(ib.id);
    if (x.status !== 'PROCESSED' || x.order_ids.length !== 1) throw new Error('No se creó el pedido al reprocesar: ' + x.error_detail);
    const o = D.get('sales_orders', x.order_ids[0]);
    if (o.lines[0].variant_id !== 'va-DG-CUY-ENT' || o.channel !== 'WEB') throw new Error('El pedido no tradujo el SKU a la variante mapeada');
    expectFail(() => reprocess(ib.id), 'RN-WEB-02');
    if (D.where('sales_orders', y => y.external_ref === 'WC-5522').length !== 1) throw new Error('Se duplicó el pedido');
  } });
  G.tests.push({ module: 'WEB', name: 'CA-WEB-03: 10 cuyes enteros en el almacén de la tienda, 3 reservados y margen 10 % → stock publicado 6 (7 × 0,9 = 6,3)', fn: async () => {
    const s = testStoreWith('wh-WEBT3', 10);
    const lot = D.insert('lots', { product_id: 'pr-CUY-ENT', variant_id: 'va-DG-CUY-ENT', code: 'L-WEB-CA3', origin: 'PRODUCED', production_date: G.TODAY, expiry_date: G.date.add(G.TODAY, 5), qc_status: 'RELEASED', unit_cost: 26.5 }, { silent: true });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-WEBT3', variant: 'va-DG-CUY-ENT', lot: lot.id, qty: 10, weight: 9, unitCost: 26.5, source: { type: 'TEST', id: 'CA-WEB-03' }, reason: 'Prueba CA-WEB-03' });
    const b = D.find('stock_balances', x => x.warehouse_id === 'wh-WEBT3' && x.lot_id === lot.id); b.reserved_qty = 3;
    const x = publishedStock(s.id, 'va-DG-CUY-ENT');
    if (x.available !== 7) throw new Error('Disponible ' + x.available);
    if (Math.abs(x.raw - 6.3) > 1e-9) throw new Error('Cálculo ' + x.raw);
    if (x.published !== 6) throw new Error('Publicado ' + x.published);
    D.insert(T.M, { store_id: s.id, sku: 'DG-CUY-ENT', variant_id: 'va-DG-CUY-ENT', brand_id: 'br-DG', woo_product_id: 9999, status: 'LINKED', publish: true, last_stock_sent: 0, history: [] }, { silent: true });
    const run = runSync(s.id, 'STOCK', { trigger: 'SCHEDULE' });
    const it = run.items.find(i => i.sku === 'DG-CUY-ENT');
    if (!it || it.new !== 6) throw new Error('La corrida no envió 6');
  } });
  G.tests.push({ module: 'WEB', name: 'CA-WEB-04: pago de Mercado Pago de S/ 150,00 aprobado por webhook → cobro de S/ 150,00 confirmado; S/ 140,00 o pago pendiente → RN-WEB-06', fn: async () => {
    const p = testPayload(5524); p.line_items = [Object.assign({}, p.line_items[0], { quantity: 1 })]; p.total = '150.00';
    const ib = receiveWoo(p, { store_id: 'ws-DG', delivery_id: 'entrega-5524-1' }).inbox;
    if (ib.status !== 'PROCESSED') throw new Error('El pedido 5524 no se procesó: ' + ib.error_detail);
    const o = D.get('sales_orders', ib.order_ids[0]);
    if (o.status !== 'DRAFT') throw new Error('El pedido debía quedar en borrador hasta el pago');
    const r = simulateMP({ id: '1399000150', external_reference: '5524', amount: 150, status: 'approved', store_id: 'ws-DG' });
    const tx = r.tx;
    if (tx.status !== 'approved' || !tx.payment_id) throw new Error('El pago aprobado no generó el cobro: ' + r.detail);
    const pay = D.get('payments', tx.payment_id);
    if (pay.amount !== 150 || pay.status !== 'CONFIRMED' || pay.payment_method_id !== 'pm-MP') throw new Error('Cobro ' + pay.amount + ' ' + pay.status);
    if (Math.abs(pay.fee_amount - tx.fee_amount) > 0.001 || !(tx.fee_amount > 0)) throw new Error('El cobro no llevó la comisión de Mercado Pago');
    if (D.get('sales_orders', o.id).status !== 'CONFIRMED') throw new Error('El pedido no se confirmó con el pago aprobado: ' + JSON.stringify(G.orders.missing(o)));
    // un segundo pago aprobado de S/ 150 sin pedido creado: el cobro por S/ 140 se rechaza
    const r2 = simulateMP({ id: '1399000151', external_reference: '5525', amount: 150, status: 'approved', store_id: 'ws-DG' });
    if (r2.tx.payment_id) throw new Error('Se registró un cobro sin pedido');
    expectFail(() => confirmPayment(r2.tx.id, 140), 'RN-WEB-06');
    const r3 = simulateMP({ id: '1399000152', external_reference: '5524', amount: 150, status: 'pending', method: 'pagoefectivo_atm', store_id: 'ws-DG' });
    if (r3.tx.payment_id) throw new Error('Un pago pendiente generó cobro');
    expectFail(() => confirmPayment(r3.tx.id, 150), 'RN-WEB-06');
    expectFail(() => confirmPayment(tx.id, 150), 'RN-WEB-02');
    const dup = receiveMP('1399000150', { store_id: 'ws-DG' });
    if (G.int && !dup.duplicate) throw new Error('La notificación repetida se procesó de nuevo');
    if (D.where('payments', x => x.reference === 'MP-1399000150').length !== 1) throw new Error('Se duplicó el cobro');
  } });
  G.tests.push({ module: 'WEB', name: 'CA-WEB-05: un lote vencido de conejo en el almacén de la tienda no suma al stock publicado', fn: async () => {
    const s = testStoreWith('wh-WEBT5', 0);
    const ok = D.insert('lots', { product_id: 'pr-CON-ENT', variant_id: 'va-DG-CON-ENT', code: 'L-WEB-CA5A', origin: 'PRODUCED', production_date: G.TODAY, expiry_date: G.date.add(G.TODAY, 4), qc_status: 'RELEASED', unit_cost: 30 }, { silent: true });
    const old = D.insert('lots', { product_id: 'pr-CON-ENT', variant_id: 'va-DG-CON-ENT', code: 'L-WEB-CA5V', origin: 'PRODUCED', production_date: G.date.add(G.TODAY, -12), expiry_date: G.date.add(G.TODAY, -1), qc_status: 'RELEASED', unit_cost: 30 }, { silent: true });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-WEBT5', variant: 'va-DG-CON-ENT', lot: ok.id, qty: 5, unitCost: 30, source: { type: 'TEST', id: 'CA-WEB-05' } });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-WEBT5', variant: 'va-DG-CON-ENT', lot: old.id, qty: 4, unitCost: 30, source: { type: 'TEST', id: 'CA-WEB-05' } });
    const x = publishedStock(s.id, 'va-DG-CON-ENT');
    if (x.total !== 9) throw new Error('Saldo ' + x.total);
    if (x.unusable !== 4) throw new Error('No usable ' + x.unusable);
    if (x.published !== 5) throw new Error('Publicado ' + x.published + ' (el lote vencido sumó)');
    const lv = x.lots.find(l => l.lot_id === old.id);
    if (!lv || lv.usable || !/Vencido/.test(lv.why)) throw new Error('El lote vencido no se marcó como no usable');
  } });
})();
