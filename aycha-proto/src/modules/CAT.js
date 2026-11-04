/* =====================================================================
   CAT · Catálogo, cortes, peso variable y listas de precio (CAT-01 … CAT-12)
   Todo lo que Don Guando vende existe una sola vez: producto por marca,
   variante (corte) con SKU, modo de venta y tolerancia; listas de precio
   por marca, canal y tipo de cliente con vigencias sin superponerse.
   Expone G.cat (priceFor, parseScaleBarcode, ean13CheckOk, checkQty,
   explodeCombo, sanitaryState…) y aplica RN-CAT-05 en G.price.of.
   ===================================================================== */
(function () {
  const { h, btn, badge, status, page, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs, pills, confirm } = G.ui;
  const U = G.util, F = G.fmt, D = G.db;
  const R = (n, d = 2) => U.round(n, d);

  /* ---------- catálogos de apoyo ---------- */
  const LINES = [['CUY', 'Cuy'], ['CONEJO', 'Conejo'], ['AVES', 'Aves de corral'], ['CORDERO', 'Cordero'], ['CERDO', 'Cerdo'], ['RES', 'Res'], ['CALDOS', 'Caldos'], ['EMBUTIDOS', 'Embutidos'], ['MANTECA', 'Mantecas'], ['ABARROTES', 'Despensa'], ['CAFE', 'Café'], ['FRUTOS_SECOS', 'Frutos secos'], ['MERMELADAS', 'Mermeladas'], ['INFUSIONES', 'Infusiones'], ['COMBOS', 'Combos'], ['OTROS', 'Insumos y empaques']];
  const PTYPES = [['GOODS', 'Bien (producto de venta)'], ['SERVICE', 'Servicio'], ['COMBO', 'Combo'], ['INPUT', 'Insumo'], ['PACKAGING', 'Empaque']];
  const STORAGE = [['CHILLED', 'Refrigerado'], ['FROZEN', 'Congelado'], ['AMBIENT', 'Ambiente']];
  const ORIGIN = [['PRODUCED', 'Producido'], ['RESALE', 'Reventa'], ['RAW_MATERIAL', 'Materia prima']];
  const IGV = [['10', '10 · Gravado'], ['20', '20 · Exonerado'], ['30', '30 · Inafecto']];
  const AUTH = [['SENASA', 'SENASA'], ['DIGESA', 'DIGESA'], ['NONE', 'No requiere']];
  const CUST_TYPES = [['PERSON', 'Persona'], ['RESTAURANT', 'Restaurante'], ['BUSINESS', 'Negocio'], ['CONSIGNMENT_POINT', 'Punto de consignación'], ['RELATED', 'Parte relacionada'], ['OTHER', 'Otro']];
  const SALE_CHANNELS = ['WHATSAPP', 'WEB', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM', 'PHONE', 'COUNTER', 'B2B', 'CONSIGNMENT'];
  const SUNAT_CODES = { CUY: '50112000', CONEJO: '50112000', AVES: '50112000', CORDERO: '50112000', CERDO: '50112000', RES: '50112000', CALDOS: '50192100', EMBUTIDOS: '50112004', MANTECA: '50151500', ABARROTES: '50192400', CAFE: '50201706', FRUTOS_SECOS: '50101716', MERMELADAS: '50192401', INFUSIONES: '50201712', COMBOS: '50112000' };
  const lab = (arr, v) => (arr.find(x => x[0] === v) || [v, v ?? '—'])[1];
  const lineName = l => lab(LINES, l);
  const SYNC = { SYNCED: ['Sincronizado', 'ok'], PENDING: ['Pendiente de envío', 'warn'], ERROR: ['Error de envío', 'bad'], NOT_PUBLISHED: ['No publicado', ''], REMOVED: ['Retirado de la web', 'bad'] };
  const syncBadge = s => badge((SYNC[s] || [s || '—'])[0], (SYNC[s] || [, ''])[1]);
  const prod = id => D.get('products', id);
  const vari = id => D.get('product_variants', id);
  const brandBadge = id => { const b = D.get('brands', id); return b ? h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, h('span', { class: 'brand-dot', style: { background: b.primary_color } }), G.brandName(id)) : '—'; };
  const canManage = () => G.can('cat.product.manage') && G.canDo('CAT', 'E');
  const canPrice = () => G.can('cat.price.manage') && G.canDo('CAT', 'E');
  const canWeb = () => G.can('cat.product.publish_web') && G.canDo('CAT', 'E');
  const canSanitary = () => G.can('cat.sanitary.manage') && G.canDo('CAT', 'E');
  const need = (perm, rule) => { if (!G.can(perm)) G.fail(rule, `Tu rol (${G.roleName()}) no tiene el permiso ${perm}.`); };
  const emit = (ev, p) => { if (!G._seeding) G.events.emit(ev, p); };
  const isSaleType = p => p && ['GOODS', 'COMBO', 'SERVICE'].includes(p.product_type);
  const uomOf = mode => mode === 'UNIT' ? 'um-NIU' : 'um-KGM';
  const qtyUnit = v => v && v.sale_mode === 'KG' ? 'kg' : 'u';

  /* =====================================================================
     Precio vigente (RN-CAT-05)
     ===================================================================== */
  const specificity = l => (l.brand_id ? 1 : 0) + ((l.channels || []).length ? 1 : 0) + ((l.customer_types || []).length ? 1 : 0);
  /** ¿la lista aplica al caso? → {ok, why} */
  function listApplies(l, { brand_id, channel, customer_type, date }) {
    if (l.status !== 'ACTIVE') return { ok: false, why: l.status === 'DRAFT' ? 'En borrador' : 'Inactiva' };
    if (l.valid_from && l.valid_from > date) return { ok: false, why: `Vigente desde ${F.date(l.valid_from)}` };
    if (l.valid_to && l.valid_to < date) return { ok: false, why: `Venció el ${F.date(l.valid_to)}` };
    if (l.brand_id && brand_id && l.brand_id !== brand_id) return { ok: false, why: 'Otra marca' };
    if ((l.channels || []).length && !l.channels.includes(channel)) return { ok: false, why: `No incluye el canal ${G.channelName(channel)}` };
    if ((l.customer_types || []).length && !l.customer_types.includes(customer_type)) return { ok: false, why: `Solo para ${l.customer_types.map(t => lab(CUST_TYPES, t)).join(', ')}` };
    return { ok: true, why: 'Coincide en marca, canal y tipo de cliente' };
  }
  /** tramo de precio de la variante en la lista: vigente en la fecha y con la cantidad mínima más alta ≤ cantidad pedida */
  function itemFor(list_id, variant_id, date, qty) {
    return D.where('price_list_items', x => x.list_id === list_id && x.variant_id === variant_id && x.valid_from <= date && (!x.valid_to || x.valid_to >= date) && (Number(x.min_qty) || 0) <= (Number(qty) || 0) + 1e-9)
      .sort((a, b) => (Number(b.min_qty) || 0) - (Number(a.min_qty) || 0) || String(b.valid_from).localeCompare(String(a.valid_from)))[0] || null;
  }
  /**
   * Precio que el sistema elige y por qué.
   * priceFor(variant_id, {brand_id, channel, customer_id, customer_type, date, qty}) →
   *   {price, basis, list_id, list, item, min_qty, reason, trace:[{list, ok, why, item}]} | null (sin precio: no se vende en ese canal)
   */
  function priceFor(variant_id, o = {}) {
    const v = vari(variant_id); if (!v) return null;
    const date = o.date || G.TODAY;
    const channel = o.channel || 'WHATSAPP';
    const c = o.customer_id ? D.get('customers', o.customer_id) : null;
    const customer_type = o.customer_type || (c && c.customer_type) || 'PERSON';
    const brand_id = o.brand_id || v.brand_id;
    const qty = o.qty != null && o.qty !== '' ? Number(o.qty) : 0;
    const lists = D.where('price_lists', l => !l.brand_id || l.brand_id === brand_id);
    const assigned = c && c.price_list_id ? c.price_list_id : null;
    const ordered = lists.slice().sort((a, b) => (a.id === assigned ? -1 : 0) - (b.id === assigned ? -1 : 0) || (Number(a.priority ?? 100) - Number(b.priority ?? 100)) || (specificity(b) - specificity(a)) || String(a.code).localeCompare(String(b.code)));
    const trace = []; let chosen = null;
    for (const l of ordered) {
      const ap = l.id === assigned ? { ok: true, why: 'Lista asignada al cliente' } : listApplies(l, { brand_id, channel, customer_type, date });
      const it = ap.ok ? itemFor(l.id, variant_id, date, qty) : null;
      const why = ap.ok && !it ? 'Aplica, pero no tiene precio vigente de esta variante' : ap.why;
      const t = { list: l, ok: ap.ok && !!it, why, item: it, chosen: false };
      trace.push(t);
      if (!chosen && t.ok) { chosen = t; t.chosen = true; }
    }
    if (!chosen) return null;
    const l = chosen.list, it = chosen.item;
    return { price: it.price, basis: it.basis || (v.sale_mode === 'UNIT' ? 'UNIT' : 'KG'), list_id: l.id, list: l, item: it, min_qty: Number(it.min_qty) || 0, trace,
      reason: `Lista «${l.name}» (prioridad ${l.priority ?? 100}${specificity(l) ? ', ' + specificity(l) + ' criterio(s) específico(s)' : ''})` + (Number(it.min_qty) ? `, tramo desde ${F.num(it.min_qty, 2)} ${qtyUnit(v)}` : '') };
  }
  // RN-CAT-05 en el servicio común de precios (PED, POS, WEB, CRM). Los precios especiales B2B (customer_prices) siguen en el núcleo.
  const corePriceOf = G.price.of;
  G.price.of = function (variant_id, o = {}) {
    const date = o.date || G.TODAY;
    if (o.customer_id && D.find('customer_prices', p => p.customer_id === o.customer_id && p.variant_id === variant_id && p.valid_from <= date && (!p.valid_to || p.valid_to >= date) && p.status !== 'REJECTED')) return corePriceOf(variant_id, o);
    const r = priceFor(variant_id, Object.assign({}, o, { date }));
    return r ? { price: r.price, basis: r.basis, list_id: r.list_id } : null;
  };

  /* ---------- cantidad mínima y múltiplo (RN-CAT-07) ---------- */
  function checkQty(variant_id, qty) {
    const v = vari(variant_id); if (!v) G.fail('RN-CAT-07', 'Variante no encontrada.');
    const q = Number(qty);
    if (!(q > 0)) G.fail('RN-CAT-07', 'La cantidad debe ser mayor que cero.');
    if (v.min_order_qty && q + 1e-9 < Number(v.min_order_qty)) G.fail('RN-CAT-07', `${v.name}: la cantidad mínima es ${F.num(v.min_order_qty, 2)} ${qtyUnit(v)}.`);
    if (v.qty_step && Number(v.qty_step) > 0) { const k = q / Number(v.qty_step); if (Math.abs(k - Math.round(k)) > 1e-6) G.fail('RN-CAT-07', `${v.name} se pide en múltiplos de ${F.num(v.qty_step, 2)} ${qtyUnit(v)}: ${F.num(q, 3)} no es múltiplo.`); }
    return true;
  }
  /** RN-CAT-10: ¿el producto admite descuento? */
  const allowsDiscount = variant_id => { const p = G.productOf(variant_id); return !p || p.allow_discount !== false; };
  /** RN-CAT-02: peso estimado de una cantidad pedida */
  function estimateKg(variant_id, qty) { const v = vari(variant_id); if (!v) return null; if (v.sale_mode === 'UNIT_VARIABLE_WEIGHT') return R(Number(qty) * Number(v.nominal_weight_kg), 3); if (v.sale_mode === 'KG') return R(Number(qty), 3); return null; }

  /* =====================================================================
     Etiquetas de balanza EAN-13 prefijo 2 (RN-CAT-12)
     ===================================================================== */
  const layout = () => Object.assign({ prefix: '2', plu_start: 3, plu_len: 5, value_start: 8, value_len: 5, value_type: 'WEIGHT_G' }, G.param('cat_scale_barcode_layout') || {});
  function ean13Digit(d12) { let s = 0; for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 === 0 ? 1 : 3); return (10 - (s % 10)) % 10; }
  const ean13CheckOk = code => /^\d{13}$/.test(String(code || '')) && ean13Digit(String(code).slice(0, 12)) === Number(String(code)[12]);
  /** lee una etiqueta de balanza → {ok, plu, variant, weight_kg, amount, error} (nunca lanza) */
  function parseScaleBarcode(code, lay) {
    const L = Object.assign(layout(), lay || {});
    const c = String(code || '').replace(/\s/g, '');
    const bad = error => ({ ok: false, valid: false, plu: null, variant: null, weight_kg: null, amount: null, error });
    if (!/^\d{13}$/.test(c)) return bad('RN-CAT-12: la etiqueta de balanza debe tener 13 dígitos.');
    if (!c.startsWith(String(L.prefix))) return bad(`RN-CAT-12: la etiqueta no empieza con el prefijo ${L.prefix} de balanza.`);
    if (!ean13CheckOk(c)) return bad(`RN-CAT-12: dígito de control EAN-13 inválido (esperado ${ean13Digit(c.slice(0, 12))}, leído ${c[12]}).`);
    const plu = c.substr(L.plu_start - 1, L.plu_len);
    const raw = Number(c.substr(L.value_start - 1, L.value_len));
    const v = D.find('product_variants', x => x.status === 'ACTIVE' && x.scale_plu && String(x.scale_plu).padStart(L.plu_len, '0') === plu);
    return { ok: true, valid: true, plu, variant: v ? v.id : null, variant_name: v ? v.name : null, weight_kg: L.value_type === 'WEIGHT_G' ? R(raw / 1000, 3) : null, amount: L.value_type === 'PRICE_CENTS' ? R(raw / 100, 2) : null, value_type: L.value_type, error: null };
  }
  /** arma una etiqueta: PLU + peso (kg) o importe (S/) según el formato */
  function buildScaleBarcode(plu, value, lay) {
    const L = Object.assign(layout(), lay || {});
    const a = Array(12).fill('0');
    String(L.prefix).split('').forEach((ch, i) => { a[i] = ch; });
    String(plu).padStart(L.plu_len, '0').slice(-L.plu_len).split('').forEach((ch, i) => { a[L.plu_start - 1 + i] = ch; });
    const n = L.value_type === 'WEIGHT_G' ? Math.round(Number(value) * 1000) : Math.round(Number(value) * 100);
    String(n).padStart(L.value_len, '0').slice(-L.value_len).split('').forEach((ch, i) => { a[L.value_start - 1 + i] = ch; });
    const d12 = a.join('');
    return d12 + ean13Digit(d12);
  }
  /** barras EAN-13 en SVG */
  function ean13Svg(code, w = 220, hgt = 70) {
    const Lc = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
    const Rc = Lc.map(s => s.replace(/./g, ch => ch === '0' ? '1' : '0'));
    const Gc = Rc.map(s => s.split('').reverse().join(''));
    const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
    const d = String(code).split('').map(Number); const par = PAR[d[0]];
    let bits = '101'; for (let i = 1; i <= 6; i++) bits += (par[i - 1] === 'L' ? Lc : Gc)[d[i]]; bits += '01010'; for (let i = 7; i <= 12; i++) bits += Rc[d[i]]; bits += '101';
    const svg = G.ui.svg('svg', { viewBox: `0 0 ${bits.length + 14} 60`, width: w, height: hgt, role: 'img', 'aria-label': 'Código de barras ' + code });
    svg.appendChild(G.ui.svg('rect', { x: 0, y: 0, width: bits.length + 14, height: 60, fill: '#ffffff' }));
    let path = ''; for (let i = 0; i < bits.length; i++) if (bits[i] === '1') path += `M${i + 7},2h1v${[0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94].includes(i) ? 50 : 44}h-1z`;
    svg.appendChild(G.ui.svg('path', { d: path, fill: '#111111' }));
    svg.appendChild(G.ui.svg('text', { x: (bits.length + 14) / 2, y: 58, 'text-anchor': 'middle', 'font-size': 7, fill: '#111111', 'font-family': 'monospace' }, code));
    return svg;
  }

  /* =====================================================================
     Registro sanitario (RN-CAT-09)
     ===================================================================== */
  function sanitaryState(p) {
    if (!p) return { code: 'NA', label: '—', tone: '', days: null };
    if (!p.sanitary_authority || p.sanitary_authority === 'NONE') return { code: 'NA', label: 'No requiere', tone: '', days: null };
    if (!p.sanitary_registry || !p.sanitary_registry_expires) return { code: 'MISSING', label: 'Sin registro', tone: 'bad', days: null };
    const days = G.date.diff(p.sanitary_registry_expires, G.TODAY);
    const alert = p.sanitary_alert_days ?? G.param('cat_sanitary_alert_days') ?? 90;
    if (days <= 0) return { code: 'EXPIRED', label: days === 0 ? 'Vence hoy' : `Vencido hace ${F.days(-days)}`, tone: 'bad', days };
    if (days <= 30) return { code: 'RED', label: `Vence en ${F.days(days)}`, tone: 'bad', days };
    if (days <= alert) return { code: 'AMBER', label: `Vence en ${F.days(days)}`, tone: 'warn', days };
    return { code: 'OK', label: 'Vigente', tone: 'ok', days };
  }
  const sanBadge = p => { const s = sanitaryState(p); return s.code === 'NA' ? h('span', { class: 'muted small' }, 'No requiere') : badge(s.label, s.tone); };

  /* =====================================================================
     Ventas, movimientos y stock por variante (para RN-CAT-11, RN-CAT-13 y KPI)
     ===================================================================== */
  function soldVariants() { const s = new Set(); for (const o of D.all('sales_orders')) for (const l of o.lines || []) s.add(l.variant_id); return s; }
  const variantHasMoves = vid => !!D.find('stock_movements', m => m.variant_id === vid) || soldVariants().has(vid) || !!D.find('sales_documents', d => (d.lines || []).some(l => l.variant_id === vid));
  const productHasSales = pid => { const s = soldVariants(); return D.where('product_variants', v => v.product_id === pid).some(v => s.has(v.id)); };
  /** stock publicable: disponible, en almacenes de venta y en lotes liberados */
  function publishableStock(vid) {
    const p = G.productOf(vid);
    if (p && p.product_type === 'COMBO') return comboStock(vid);
    const whs = new Set(D.where('warehouses', w => w.allows_sale && w.status === 'ACTIVE').map(w => w.id));
    return R(U.sum(D.where('stock_balances', b => b.variant_id === vid && whs.has(b.warehouse_id) && G.inv.lotUsable(b.lot_id)), b => b.qty - (b.reserved_qty || 0)), 3);
  }

  /* =====================================================================
     Combos (RN-CAT-08)
     ===================================================================== */
  const comps = comboVid => D.where('combo_components', c => c.combo_variant_id === comboVid);
  function assertComponent(comboVid, compVid) {
    const cv = vari(compVid); const cp = cv && prod(cv.product_id);
    if (!cv) G.fail('RN-CAT-08', 'Elige la variante del componente.');
    if (compVid === comboVid || (cp && cp.product_type === 'COMBO')) G.fail('RN-CAT-08', `Un combo no contiene otro combo: «${cv.name}» es un combo.`);
    if (cv.status !== 'ACTIVE' || !cv.sellable) G.fail('RN-CAT-08', `«${cv.name}» no es una variante vendible activa: no puede ser componente.`);
  }
  function addComboComponent(comboVid, { component_variant_id, qty, est_weight_kg, price_share_pct }) {
    G.assertMod('CAT'); need('cat.product.manage', 'RN-CAT-08');
    assertComponent(comboVid, component_variant_id);
    if (!(Number(qty) > 0)) G.fail('RN-CAT-08', 'La cantidad del componente debe ser mayor que cero.');
    if (!(Number(price_share_pct) > 0 && Number(price_share_pct) <= 100)) G.fail('RN-CAT-08', 'El porcentaje del precio va de 0,01 a 100.');
    if (comps(comboVid).some(c => c.component_variant_id === component_variant_id)) G.fail('RN-CAT-08', 'Ese componente ya está en el combo: edita su cantidad.');
    const cv = vari(component_variant_id);
    const row = D.insert('combo_components', { combo_variant_id: comboVid, component_variant_id, qty: Number(qty), est_weight_kg: est_weight_kg ? Number(est_weight_kg) : (cv.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? R(Number(qty) * cv.nominal_weight_kg, 3) : cv.sale_mode === 'KG' ? Number(qty) : null), price_share_pct: Number(price_share_pct) });
    emit('product.changed', { variant_id: comboVid, change: 'combo' });
    return row;
  }
  function comboCheck(comboVid) {
    const cs = comps(comboVid); const sum = R(U.sum(cs, c => c.price_share_pct), 3);
    const problems = [];
    if (!cs.length) problems.push('RN-CAT-08: el combo no tiene componentes.');
    if (Math.abs(sum - 100) > 0.001) problems.push(`RN-CAT-08: el reparto del precio suma ${F.num(sum, 2)} % y debe sumar 100 %.`);
    for (const c of cs) { try { assertComponent(comboVid, c.component_variant_id); } catch (e) { problems.push(e.message); } }
    return { ok: !problems.length, sum, problems };
  }
  function comboStock(comboVid) { const cs = comps(comboVid); if (!cs.length) return 0; return Math.max(0, Math.min(...cs.map(c => Math.floor(publishableStockRaw(c.component_variant_id) / c.qty + 1e-9)))); }
  function publishableStockRaw(vid) { const whs = new Set(D.where('warehouses', w => w.allows_sale && w.status === 'ACTIVE').map(w => w.id)); return U.sum(D.where('stock_balances', b => b.variant_id === vid && whs.has(b.warehouse_id) && G.inv.lotUsable(b.lot_id)), b => b.qty - (b.reserved_qty || 0)); }
  /** stock y comprobante salen por componente: reparte cantidad e importe */
  function explodeCombo(comboVid, qty = 1, total) {
    const ch = comboCheck(comboVid); if (!ch.ok) G.fail('RN-CAT-08', ch.problems.join(' '));
    const pr = total != null ? Number(total) : ((priceFor(comboVid) || {}).price || 0) * qty;
    return comps(comboVid).map(c => ({ variant_id: c.component_variant_id, qty: R(c.qty * qty, 3), est_weight_kg: c.est_weight_kg ? R(c.est_weight_kg * qty, 3) : null, price_share_pct: c.price_share_pct, amount: R(pr * c.price_share_pct / 100) }));
  }

  /* =====================================================================
     Guardar producto y variante (RN-CAT-01, 02, 03, 04, 09, 11, 13)
     ===================================================================== */
  function saveProduct(vals, existing) {
    G.assertMod('CAT'); need('cat.product.manage', 'RN-CAT-01');
    const code = String(vals.code || '').trim().toUpperCase();
    if (!code) G.fail('RN-CAT-01', 'El código del producto es obligatorio.');
    if (D.find('products', p => p.code === code && (!existing || p.id !== existing.id))) G.fail('RN-CAT-01', `El código ${code} ya existe en la empresa: los códigos son únicos.`);
    if (!vals.brand_id) G.fail('RN-CAT-01', 'Elige la marca: un producto pertenece a una sola marca.');
    if (existing && existing.brand_id !== vals.brand_id && productHasSales(existing.id)) G.fail('RN-CAT-01', 'El producto ya tiene ventas con su marca: para venderlo en otra marca crea otro producto («Copiar a otra marca»).');
    const auth = vals.sanitary_authority || 'NONE';
    const st = vals.status || 'ACTIVE';
    if (auth === 'DIGESA' && st === 'ACTIVE' && (!vals.sanitary_registry || !vals.sanitary_registry_expires)) G.fail('RN-CAT-09', 'Un producto DIGESA activo necesita número de registro sanitario y fecha de vencimiento.');
    if (existing && existing.igv_affectation !== vals.igv_affectation && productHasSales(existing.id)) {
      if (!G.can('cat.product.tax_change')) G.fail('RN-CAT-13', `Cambiar la afectación del IGV de un producto con ventas exige el permiso cat.product.tax_change (${G.roleName()} no lo tiene).`);
      if (!vals.tax_change_reason) G.fail('RN-CAT-13', 'Escribe el motivo del cambio de afectación del IGV (queda en la auditoría).');
      G.audit('CAMBIO_IGV', 'products', existing.id, `${existing.code}: afectación ${existing.igv_affectation} → ${vals.igv_affectation} · ${vals.tax_change_reason}`, { igv_affectation: existing.igv_affectation }, { igv_affectation: vals.igv_affectation });
    }
    const cat = D.get('product_categories', vals.category_id);
    const row = { code, name: vals.name, brand_id: vals.brand_id, category_id: vals.category_id, line: vals.product_type === 'COMBO' ? 'COMBOS' : (cat ? cat.line : (existing && existing.line) || 'OTROS'), product_type: vals.product_type || 'GOODS', origin: vals.origin || 'PRODUCED', storage: vals.storage || 'CHILLED',
      shelf_life_days: Number(vals.shelf_life_days) || null, requires_lot: !!vals.requires_lot, igv_affectation: vals.igv_affectation || '10', sunat_product_code: vals.sunat_product_code || null, allow_discount: vals.allow_discount !== false,
      sanitary_authority: auth, sanitary_registry: vals.sanitary_registry || null, sanitary_registry_expires: vals.sanitary_registry_expires || null, status: st };
    const sanExpired = sanitaryState(row).code === 'EXPIRED';
    let p;
    if (existing) {
      if (sanExpired && existing.web_publishable) row.web_publishable = false;
      p = D.update('products', existing.id, row);
      if (st !== 'ACTIVE') for (const v of D.where('product_variants', v => v.product_id === p.id && v.status === 'ACTIVE')) D.update('product_variants', v.id, { status: 'INACTIVE' });
      if (existing.brand_id !== p.brand_id) for (const v of D.where('product_variants', v => v.product_id === p.id)) D.update('product_variants', v.id, { brand_id: p.brand_id }, { silent: true });
    } else p = D.insert('products', Object.assign(row, { web_publishable: false, web_sync_status: 'NOT_PUBLISHED', sanitary_alert_days: null }));
    if (p.web_publishable && p.web_sync_status === 'SYNCED') D.update('products', p.id, { web_sync_status: 'PENDING' }, { silent: true });
    emit('product.changed', { product_id: p.id, code: p.code });
    return p;
  }
  function saveVariant(vals, existing) {
    G.assertMod('CAT'); need('cat.product.manage', 'RN-CAT-01');
    const p = prod(vals.product_id); if (!p) G.fail('RN-CAT-01', 'Elige el producto de la variante.');
    const sku = String(vals.sku || '').trim().toUpperCase();
    if (!sku) G.fail('RN-CAT-01', 'El SKU es obligatorio.');
    if (D.find('product_variants', v => v.sku === sku && (!existing || v.id !== existing.id))) G.fail('RN-CAT-01', `El SKU ${sku} ya existe en la empresa: cada corte tiene su propio SKU.`);
    const mode = vals.sale_mode || 'UNIT';
    const num = x => x === '' || x === null || x === undefined ? null : Number(x);
    const nom = num(vals.nominal_weight_kg), mn = num(vals.min_weight_kg), mx = num(vals.max_weight_kg);
    if (mode === 'UNIT_VARIABLE_WEIGHT' && !(nom > 0)) G.fail('RN-CAT-02', 'Una variante de peso variable exige el peso nominal por unidad (se pide por unidad y se cobra por kg).');
    if (mn != null && mx != null && mn > mx) G.fail('RN-CAT-03', `El peso mínimo (${F.num(mn, 3)} kg) supera al máximo (${F.num(mx, 3)} kg).`);
    if (nom != null && mn != null && nom < mn) G.fail('RN-CAT-03', `El peso nominal (${F.num(nom, 3)} kg) es menor que el mínimo (${F.num(mn, 3)} kg).`);
    if (nom != null && mx != null && nom > mx) G.fail('RN-CAT-03', `El peso nominal (${F.num(nom, 3)} kg) es mayor que el máximo (${F.num(mx, 3)} kg).`);
    const plu = vals.scale_plu ? String(vals.scale_plu).trim() : null;
    const st = vals.status || 'ACTIVE';
    if (plu && !/^\d{5}$/.test(plu)) G.fail('RN-CAT-04', 'El PLU de balanza tiene 5 dígitos.');
    if (plu && st === 'ACTIVE') { const o = D.find('product_variants', v => v.status === 'ACTIVE' && String(v.scale_plu || '') === plu && (!existing || v.id !== existing.id)); if (o) G.fail('RN-CAT-04', `El PLU ${plu} ya lo usa ${o.name} (${o.sku}): una etiqueta debe identificar un solo producto.`); }
    const bc = vals.barcode ? String(vals.barcode).trim() : null;
    if (bc && D.find('product_variants', v => v.barcode === bc && (!existing || v.id !== existing.id))) G.fail('RN-CAT-01', `El código de barras ${bc} ya está asignado a otra variante.`);
    if (num(vals.min_order_qty) != null && num(vals.min_order_qty) < 0) G.fail('RN-CAT-07', 'La cantidad mínima no puede ser negativa.');
    if (num(vals.qty_step) != null && num(vals.qty_step) < 0) G.fail('RN-CAT-07', 'El múltiplo no puede ser negativo.');
    if (vals.web_publishable && sanitaryState(p).code === 'EXPIRED') G.fail('RN-CAT-09', `${p.name} tiene el registro sanitario vencido: no se publica en la web.`);
    const row = { product_id: p.id, brand_id: p.brand_id, sku, name: vals.name, cut_type_id: vals.cut_type_id || null, uom_id: uomOf(mode), sale_mode: mode, nominal_weight_kg: mode === 'UNIT' ? null : nom, min_weight_kg: mode === 'UNIT' ? null : mn, max_weight_kg: mode === 'UNIT' ? null : mx,
      weight_tolerance_pct: mode === 'UNIT' ? null : num(vals.weight_tolerance_pct), barcode: bc, scale_plu: plu, min_order_qty: num(vals.min_order_qty), qty_step: num(vals.qty_step), web_publishable: !!vals.web_publishable, status: st,
      std_cost: num(vals.std_cost) ?? (existing ? existing.std_cost : 0), sellable: isSaleType(p), line: p.line };
    const v = existing ? D.update('product_variants', existing.id, row) : D.insert('product_variants', row);
    emit('product.changed', { variant_id: v.id, sku: v.sku });
    return v;
  }
  /** RN-CAT-11: con movimientos no se borra, se inactiva */
  function removeVariant(vid) {
    need('cat.product.manage', 'RN-CAT-11');
    const v = vari(vid);
    if (variantHasMoves(vid)) G.fail('RN-CAT-11', `${v.name} tiene movimientos o ventas: no se borra. Usa «Inactivar»; deja de aparecer en PED, POS y la web en la siguiente sincronización.`);
    for (const it of D.where('price_list_items', x => x.variant_id === vid)) D.remove('price_list_items', it.id);
    D.remove('product_variants', vid);
    emit('product.changed', { variant_id: vid, change: 'deleted' });
  }
  function setVariantStatus(vid, st) {
    need('cat.product.manage', 'RN-CAT-11');
    const v = vari(vid);
    if (st === 'ACTIVE') { const p = prod(v.product_id); if (p.status !== 'ACTIVE') G.fail('RN-CAT-11', 'Activa primero el producto.'); if (v.scale_plu && D.find('product_variants', x => x.id !== vid && x.status === 'ACTIVE' && String(x.scale_plu || '') === String(v.scale_plu))) G.fail('RN-CAT-04', `El PLU ${v.scale_plu} ya está en otra variante activa.`); }
    D.update('product_variants', vid, { status: st });
    emit('product.changed', { variant_id: vid, status: st });
  }

  /* =====================================================================
     Listas y precios (RN-CAT-05, RN-CAT-06)
     ===================================================================== */
  function saveList(vals, existing) {
    G.assertMod('CAT'); need('cat.price.manage', 'RN-CAT-05');
    const code = String(vals.code || '').trim().toUpperCase();
    if (!code || !vals.name) G.fail('RN-CAT-05', 'La lista necesita código y nombre.');
    if (D.find('price_lists', l => l.code === code && (!existing || l.id !== existing.id))) G.fail('RN-CAT-05', `Ya existe una lista con el código ${code}.`);
    if (!vals.valid_from) G.fail('RN-CAT-05', 'Indica la fecha de inicio de la vigencia.');
    if (vals.valid_to && vals.valid_to < vals.valid_from) G.fail('RN-CAT-05', 'La vigencia termina antes de empezar.');
    const row = { code, name: vals.name, brand_id: vals.brand_id || null, channels: vals.channels || [], customer_types: vals.customer_types || [], includes_igv: vals.includes_igv !== false, currency: 'PEN', priority: Number(vals.priority ?? 100), valid_from: vals.valid_from, valid_to: vals.valid_to || null, status: vals.status || 'ACTIVE' };
    const l = existing ? D.update('price_lists', existing.id, row) : D.insert('price_lists', row);
    emit('price.changed', { list_id: l.id });
    return l;
  }
  const overlaps = (a1, a2, b1, b2) => a1 <= (b2 || '9999-12-31') && b1 <= (a2 || '9999-12-31');
  /**
   * Carga un precio. Sin closePrevious, una vigencia superpuesta se rechaza (RN-CAT-06).
   * Con closePrevious, la vigencia abierta anterior se cierra el día previo.
   */
  function addPrice({ list_id, variant_id, price, basis, min_qty = 0, valid_from, valid_to, closePrevious, reason }) {
    G.assertMod('CAT'); need('cat.price.manage', 'RN-CAT-06');
    const l = D.get('price_lists', list_id); if (!l) G.fail('RN-CAT-06', 'Elige la lista.');
    const v = vari(variant_id); if (!v) G.fail('RN-CAT-06', 'Elige la variante.');
    if (l.brand_id && v.brand_id !== l.brand_id) G.fail('RN-CAT-01', `${v.name} es de ${G.brandName(v.brand_id)} y la lista es de ${G.brandName(l.brand_id)}.`);
    if (!(Number(price) > 0)) G.fail('RN-CAT-06', 'El precio debe ser mayor que cero.');
    if (!valid_from) G.fail('RN-CAT-06', 'Indica desde cuándo rige el precio.');
    if (valid_to && valid_to < valid_from) G.fail('RN-CAT-06', 'La vigencia termina antes de empezar.');
    const mq = Number(min_qty) || 0;
    const same = D.where('price_list_items', x => x.list_id === list_id && x.variant_id === variant_id && (Number(x.min_qty) || 0) === mq && overlaps(x.valid_from, x.valid_to, valid_from, valid_to));
    if (same.length) {
      const closable = closePrevious && same.every(x => x.valid_from < valid_from);
      if (!closable) {
        const x = same[0];
        G.fail('RN-CAT-06', `Ya hay un precio de ${v.name} en «${l.name}» vigente del ${F.date(x.valid_from)} ${x.valid_to ? 'al ' + F.date(x.valid_to) : 'sin fecha de fin'} (${F.money(x.price)}). Cierra esa vigencia antes de abrir otra desde el ${F.date(valid_from)}.`);
      }
      for (const x of same) D.update('price_list_items', x.id, { valid_to: G.date.add(valid_from, -1), closed_by: G.ctx.userName(), closed_reason: reason || 'Cambio de precio' });
    }
    const it = D.insert('price_list_items', { list_id, variant_id, price: R(price, 4), basis: basis || (v.sale_mode === 'UNIT' ? 'UNIT' : 'KG'), min_qty: mq, valid_from, valid_to: valid_to || null, created_by: G.ctx.userName(), reason: reason || null, previous_price: same.length ? same[0].price : null });
    emit('price.changed', { list_id, variant_id, price: it.price, valid_from });
    return it;
  }
  function closePrice(item_id, date, reason) {
    need('cat.price.manage', 'RN-CAT-06');
    const it = D.get('price_list_items', item_id);
    if (date < it.valid_from) G.fail('RN-CAT-06', 'La fecha de cierre es anterior al inicio de la vigencia.');
    D.update('price_list_items', item_id, { valid_to: date, closed_by: G.ctx.userName(), closed_reason: reason || 'Cierre de vigencia' });
    emit('price.changed', { list_id: it.list_id, variant_id: it.variant_id });
  }
  function copyList(srcId, { code, name, pct = 0, valid_from, brand_id, channels, customer_types, priority }) {
    need('cat.price.manage', 'RN-CAT-05');
    const s = D.get('price_lists', srcId);
    const l = saveList({ code, name, brand_id: brand_id !== undefined ? brand_id : s.brand_id, channels: channels || s.channels, customer_types: customer_types || s.customer_types, includes_igv: s.includes_igv, priority: priority ?? s.priority, valid_from: valid_from || G.TODAY, status: 'DRAFT' });
    let n = 0;
    for (const it of D.where('price_list_items', x => x.list_id === srcId && x.valid_from <= (valid_from || G.TODAY) && (!x.valid_to || x.valid_to >= (valid_from || G.TODAY)))) {
      D.insert('price_list_items', { list_id: l.id, variant_id: it.variant_id, price: R(it.price * (1 + Number(pct) / 100), 2), basis: it.basis, min_qty: it.min_qty || 0, valid_from: valid_from || G.TODAY, valid_to: null, created_by: G.ctx.userName(), reason: `Copia de ${s.code}${pct ? ` (${pct > 0 ? '+' : ''}${pct} %)` : ''}` }, { silent: true }); n++;
    }
    G.audit('COPIAR', 'price_lists', l.id, `${s.code} → ${l.code}: ${n} precios`);
    return { list: l, items: n };
  }
  /** programa una nueva vigencia: cierra cada precio vigente el día anterior y abre el nuevo con el ajuste */
  function scheduleList(listId, { valid_from, pct, reason }) {
    need('cat.price.manage', 'RN-CAT-06');
    if (!valid_from || valid_from <= G.TODAY) G.fail('RN-CAT-06', 'La nueva vigencia se programa desde mañana en adelante.');
    if (!reason) G.fail('RN-CAT-06', 'Escribe el motivo del cambio de precios.');
    const cur = D.where('price_list_items', x => x.list_id === listId && x.valid_from < valid_from && (!x.valid_to || x.valid_to >= valid_from));
    let n = 0;
    for (const it of cur) { addPrice({ list_id: listId, variant_id: it.variant_id, price: R(it.price * (1 + Number(pct) / 100), 2), basis: it.basis, min_qty: it.min_qty || 0, valid_from, closePrevious: true, reason }); n++; }
    return n;
  }
  /** importación CSV: «sku;precio;desde;cant_min» → filas validadas con el precio actual */
  function previewCsv(listId, text) {
    const l = D.get('price_lists', listId);
    const out = [];
    String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach((ln, i) => {
      if (i === 0 && /sku/i.test(ln)) return;
      const [sku, p, from, mq] = ln.split(/[;,\t]/).map(s => (s || '').trim());
      const v = D.find('product_variants', x => x.sku === String(sku).toUpperCase());
      const price = Number(String(p || '').replace(',', '.'));
      const row = { line: i + 1, sku, variant: v, price, valid_from: from || G.date.add(G.TODAY, 1), min_qty: Number(mq) || 0, error: null };
      if (!v) row.error = 'SKU no existe';
      else if (l.brand_id && v.brand_id !== l.brand_id) row.error = `Es de ${G.brandName(v.brand_id)}`;
      else if (!(price > 0)) row.error = 'Precio no válido';
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(row.valid_from)) row.error = 'Fecha no válida (AAAA-MM-DD)';
      if (v) { const cur = itemFor(listId, v.id, G.TODAY, row.min_qty); row.current = cur ? cur.price : null; row.diff_pct = cur ? R((price - cur.price) / cur.price * 100, 1) : null;
        const fut = D.find('price_list_items', x => x.list_id === listId && x.variant_id === v.id && (Number(x.min_qty) || 0) === row.min_qty && x.valid_from >= row.valid_from);
        if (!row.error && fut) row.error = `RN-CAT-06: ya hay un precio desde ${F.date(fut.valid_from)}`; }
      out.push(row);
    });
    return out;
  }
  function importCsv(listId, rows, reason) {
    let n = 0;
    for (const r of rows.filter(x => !x.error)) { addPrice({ list_id: listId, variant_id: r.variant.id, price: r.price, min_qty: r.min_qty, valid_from: r.valid_from, closePrevious: true, reason: reason || 'Importación CSV' }); n++; }
    return n;
  }

  /* =====================================================================
     Filas del catálogo (CAT-01) y KPI
     ===================================================================== */
  /** productos visibles: alcance de marca, tipo SALE (venta y combos), INPUT (insumos y empaques) o ALL */
  function productRows(kind = 'SALE') {
    return G.scope.filter(D.all('products')).filter(p => kind === 'ALL' ? true : kind === 'SALE' ? isSaleType(p) : !isSaleType(p));
  }
  function coverage({ brand, channel = 'WHATSAPP', date = G.TODAY } = {}) {
    const vs = D.where('product_variants', v => v.status === 'ACTIVE' && v.sellable && (!brand || v.brand_id === brand) && (prod(v.product_id) || {}).status === 'ACTIVE');
    const ok = vs.filter(v => priceFor(v.id, { channel, date }));
    return { value: vs.length ? R(ok.length / vs.length * 100, 1) : 0, numerator: ok.length, denominator: vs.length, missing: vs.filter(v => !ok.includes(v)) };
  }
  const webVariants = brand => D.where('product_variants', v => v.status === 'ACTIVE' && v.web_publishable && v.sellable && (!brand || v.brand_id === brand) && (prod(v.product_id) || {}).web_publishable && (prod(v.product_id) || {}).status === 'ACTIVE');
  G.kpiCalc['KPI-CAT-01'] = p => coverage({ brand: p.brand, channel: p.channel || 'WHATSAPP', date: p.to || G.TODAY });
  G.kpiCalc['KPI-CAT-02'] = p => { const vs = webVariants(p.brand); const z = vs.filter(v => publishableStock(v.id) <= 0); return { value: vs.length ? R(z.length / vs.length * 100, 1) : 0, numerator: z.length, denominator: vs.length }; };
  G.kpiCalc['KPI-CAT-03'] = p => { const alert = G.param('cat_sanitary_alert_days') ?? 90; return D.where('products', x => x.status === 'ACTIVE' && (!p.brand || x.brand_id === p.brand) && x.sanitary_registry_expires && x.sanitary_authority !== 'NONE' && G.date.diff(x.sanitary_registry_expires, p.to || G.TODAY) >= 0 && G.date.diff(x.sanitary_registry_expires, p.to || G.TODAY) <= alert).length; };
  G.kpiCalc['KPI-CAT-04'] = p => { let amt = 0, kg = 0; for (const o of G.sales.orders(p)) for (const l of o.lines || []) if (l.price_basis === 'KG' && l.weighed_kg > 0) { amt += l.final_amount ?? l.est_amount; kg += l.weighed_kg; } return { value: kg ? R(amt / kg) : 0, numerator: R(amt), denominator: R(kg, 3) }; };

  G.cat = { priceFor, listApplies, checkQty, allowsDiscount, estimateKg, parseScaleBarcode, buildScaleBarcode, ean13CheckOk, ean13Digit, sanitaryState, explodeCombo, comboCheck, comboStock, addComboComponent, saveProduct, saveVariant, removeVariant, setVariantStatus, saveList, addPrice, closePrice, copyList, scheduleList, previewCsv, importCsv, productRows, coverage, publishableStock, layout };

  /* =====================================================================
     Interfaz
     ===================================================================== */
  const priceLabel = (vid, channel = 'WHATSAPP') => { const p = priceFor(vid, { channel }); return p ? `${F.money(p.price)}${p.basis === 'KG' ? '/kg' : ''}`.replace(/ /g, '\u00a0') : null; };
  const modeBadge = m => badge(G.saleModeName(m), m === 'UNIT_VARIABLE_WEIGHT' ? 'accent' : m === 'KG' ? 'info' : '');
  const cutName = id => { const c = D.get('cut_types', id); return c ? c.name : '—'; };
  const blockedLots = pid => D.where('lots', l => l.product_id === pid && ['BLOCKED', 'RECALLED'].includes(l.qc_status) && D.find('stock_balances', b => b.lot_id === l.id && b.qty > 0));
  const brandOpts = () => G.scope.brands().map(b => [b.id, b.name]);
  const catOpts = () => D.all('product_categories').map(c => [c.id, c.name]);
  const variantOpts = (pred = () => true) => G.scope.filter(D.all('product_variants')).filter(v => v.status === 'ACTIVE' && pred(v)).map(v => [v.id, `${v.sku} · ${v.name}`]);

  /* ---------- CAT-01 Productos ---------- */
  function renderProducts(el) {
    const st = renderProducts.st = renderProducts.st || { kind: 'SALE' };
    const body = page(el, { code: 'CAT-01', title: 'Productos', sub: 'Lo que vende cada marca, una sola vez: variantes, precio vigente del canal WhatsApp y alertas de registro sanitario y lotes bloqueados.',
      actions: [canManage() ? { label: 'Nuevo producto', kind: 'primary', icon: '+', onClick: () => editProduct(null) } : null, { label: 'Simulador de precio', onClick: () => G.go('CAT-07') }].filter(Boolean) });
    const rows = productRows(st.kind);
    const vByP = U.groupBy(D.all('product_variants'), 'product_id');
    const cov = coverage({ brand: G.ctx.brand !== 'ALL' ? G.ctx.brand : null });
    const san = rows.map(sanitaryState);
    body.appendChild(kpis([
      { label: 'Productos activos', value: F.num(rows.filter(p => p.status === 'ACTIVE').length), sub: `${F.num(rows.length)} en la vista` },
      { label: 'Variantes vendibles', value: F.num(cov.denominator), sub: 'Activas, con SKU' },
      { label: 'Cobertura de precios WhatsApp', value: F.pct(cov.value), sub: `${cov.numerator} de ${cov.denominator} con precio vigente · KPI-CAT-01`, tone: cov.value < 100 ? 'warn' : 'ok', onClick: () => G.go('CAT-06') },
      { label: 'Registros por vencer o vencidos', value: F.num(san.filter(s => ['AMBER', 'RED', 'EXPIRED'].includes(s.code)).length), sub: `Aviso a ${G.param('cat_sanitary_alert_days')} días`, tone: san.some(s => ['RED', 'EXPIRED'].includes(s.code)) ? 'bad' : 'warn', onClick: () => G.go('CAT-10') },
    ]));
    body.appendChild(pills([['SALE', 'Productos de venta'], ['INPUT', 'Insumos, materia prima y empaques'], ['ALL', 'Todos']], st.kind, v => { st.kind = v; G.refresh(); }));
    if (cov.missing.length) body.appendChild(notice([h('b', null, `RN-CAT-05: ${cov.missing.length} variante(s) activas sin precio vigente en WhatsApp no se pueden vender en ese canal. `), cov.missing.slice(0, 4).map(v => v.name).join(', ')], 'warn'));
    const lines = [...new Set(rows.map(p => p.line))];
    body.appendChild(table({
      id: 'cat01', rows, onRow: p => G.go('CAT-02', { id: p.id }), searchPlaceholder: 'Buscar por nombre, código o SKU…',
      searchText: p => (vByP[p.id] || []).map(v => v.sku + ' ' + v.name).join(' '),
      filters: [
        G.ctx.brand === 'ALL' ? { key: 'brand_id', label: 'Marca', options: brandOpts() } : null,
        { key: 'line', label: 'Línea', options: LINES.filter(l => lines.includes(l[0])) },
        { key: 'category_id', label: 'Categoría', options: catOpts().filter(c => rows.some(p => p.category_id === c[0])) },
        { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']] },
        { key: 'storage', label: 'Almacenamiento', options: STORAGE },
        { key: 'web', label: 'Web', options: [['1', 'Publicado'], ['0', 'No publicado']], value: p => p.web_publishable ? '1' : '0' },
      ].filter(Boolean),
      columns: [
        { key: 'code', label: 'Código', mono: true },
        { key: 'name', label: 'Producto', render: p => h('div', null, h('div', null, p.name), h('div', { class: 'small muted' }, `${lineName(p.line)} · ${lab(STORAGE, p.storage)}`)) },
        { key: 'brand_id', label: 'Marca', render: p => brandBadge(p.brand_id), value: p => G.brandName(p.brand_id) },
        { key: 'nv', label: 'Variantes', align: 'r', value: p => (vByP[p.id] || []).filter(v => v.status === 'ACTIVE').length },
        { key: 'price', label: 'Precio WhatsApp', align: 'r', sort: false, render: p => { if (!isSaleType(p)) return h('span', { class: 'muted small' }, 'No se vende'); const vs = (vByP[p.id] || []).filter(v => v.status === 'ACTIVE'); const ps = vs.map(v => priceFor(v.id, { channel: 'WHATSAPP' })).filter(Boolean); if (!ps.length) return badge('Sin precio · RN-CAT-05', 'bad'); const mn = Math.min(...ps.map(x => x.price)), mx = Math.max(...ps.map(x => x.price)); return h('span', { class: 'num' }, (mn === mx ? F.money(mn) : `${F.money(mn)} – ${F.money(mx)}`) + (ps[0].basis === 'KG' ? '/kg' : '')); } },
        { key: 'san', label: 'Registro sanitario', render: p => { const bl = blockedLots(p.id); return h('div', { class: 'row', style: 'gap:4px' }, sanBadge(p), bl.length ? badge(`${bl.length} lote bloqueado`, 'bad') : null); }, value: p => sanitaryState(p).code },
        { key: 'web_publishable', label: 'Web', render: p => p.web_publishable ? badge('Publicado', 'ok') : h('span', { class: 'muted small' }, 'No') },
        { key: 'status', label: 'Estado', render: p => status(p.status) },
      ],
    }));
  }

  /* ---------- formularios de producto y variante ---------- */
  function editProduct(p, opts = {}) {
    if (!canManage()) return G.require('cat.product.manage', () => { });
    drawer(p ? `Editar ${p.name}` : (opts.copyFrom ? 'Copiar producto a otra marca' : 'Nuevo producto'), (bd, close) => {
      const sales = p && productHasSales(p.id);
      const base = p ? Object.assign({}, p) : opts.copyFrom ? Object.assign({}, opts.copyFrom, { code: opts.copyFrom.code + '-' + 'M', brand_id: '', status: 'ACTIVE' }) : { product_type: 'GOODS', origin: 'PRODUCED', storage: 'CHILLED', igv_affectation: '10', requires_lot: true, allow_discount: true, status: 'ACTIVE', sanitary_authority: 'SENASA', brand_id: G.ctx.brand !== 'ALL' ? G.ctx.brand : 'br-DG' };
      if (sales) bd.appendChild(notice('Este producto tiene ventas: la marca no se cambia (RN-CAT-01) y cambiar la afectación del IGV exige el permiso cat.product.tax_change y motivo (RN-CAT-13).', 'info'));
      bd.appendChild(form({ id: 'catp', values: base, submitLabel: p ? 'Guardar cambios' : 'Crear producto', onCancel: close,
        fields: [
          { key: 'code', label: 'Código (único)', required: true },
          { key: 'name', label: 'Nombre', required: true },
          { key: 'brand_id', label: 'Marca', type: 'select', options: brandOpts(), required: true, disabled: !!sales },
          { key: 'category_id', label: 'Categoría', type: 'select', options: catOpts(), required: true },
          { key: 'product_type', label: 'Tipo', type: 'select', options: PTYPES, required: true },
          { key: 'origin', label: 'Origen', type: 'select', options: ORIGIN, required: true },
          { key: 'storage', label: 'Almacenamiento', type: 'select', options: STORAGE, required: true },
          { key: 'shelf_life_days', label: 'Vida útil (días)', type: 'number', min: 0 },
          { key: 'igv_affectation', label: 'Afectación del IGV (catálogo 07)', type: 'select', options: IGV, required: true },
          { key: 'tax_change_reason', label: 'Motivo del cambio de IGV (RN-CAT-13)', hidden: !sales },
          { key: 'sunat_product_code', label: 'Código de producto SUNAT', help: 'Catálogo UNSPSC que viaja en el comprobante' },
          { key: 'sanitary_authority', label: 'Autoridad sanitaria', type: 'select', options: AUTH, required: true },
          { key: 'sanitary_registry', label: 'Número de registro sanitario' },
          { key: 'sanitary_registry_expires', label: 'Vencimiento del registro', type: 'date' },
          { key: 'requires_lot', label: 'Controla lote', type: 'checkbox' },
          { key: 'allow_discount', label: 'Admite descuento (RN-CAT-10)', type: 'checkbox' },
          { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']], required: true },
        ],
        onSubmit: vals => { const r = saveProduct(vals, p); close(); toast(p ? 'Producto actualizado' : 'Producto creado', 'ok'); if (!p) G.go('CAT-02', { id: r.id }); else G.refresh(); return true; },
      }));
    }, { code: 'CAT-02' });
  }
  function editVariant(v, defaults = {}) {
    if (!canManage()) return G.require('cat.product.manage', () => { });
    drawer(v ? `Editar ${v.sku}` : 'Nueva variante o corte', (bd, close) => {
      const vals0 = v ? Object.assign({}, v) : Object.assign({ sale_mode: 'UNIT_VARIABLE_WEIGHT', status: 'ACTIVE', weight_tolerance_pct: 10, min_order_qty: 1, qty_step: 1 }, defaults);
      const live = h('div', { class: 'notice info' });
      const upd = vals => {
        const p = prod(vals.product_id);
        const nom = Number(vals.nominal_weight_kg) || 0;
        const pr = v ? priceFor(v.id) : null;
        const lines = [];
        if (vals.sale_mode === 'UNIT_VARIABLE_WEIGHT') lines.push(`Se pide por unidad y se cobra por kg (RN-CAT-02). 2 u × ${F.num(nom, 3)} kg = ${F.num(2 * nom, 3)} kg estimados${pr ? ` × ${F.money(pr.price)}/kg = ${F.money(R(2 * nom * pr.price))}` : ''}.`);
        else if (vals.sale_mode === 'KG') lines.push('Se pide y se cobra por kg.'); else lines.push('Precio fijo por unidad.');
        if (vals.sale_mode !== 'UNIT' && nom) { const tol = Number(vals.weight_tolerance_pct || G.param('ped_weight_tolerance_pct') || 10); lines.push(`Tolerancia ${F.num(tol, 1)} %: de ${F.num(nom * (1 - tol / 100), 3)} a ${F.num(nom * (1 + tol / 100), 3)} kg por unidad sin aviso al cliente.`); }
        if (p) lines.push(`Marca: ${G.brandName(p.brand_id)} · Línea: ${lineName(p.line)}`);
        G.ui.clear(live).append(h('div', null, lines.map(x => h('div', null, x))));
      };
      bd.appendChild(live);
      const f = form({ id: 'catv', values: vals0, submitLabel: v ? 'Guardar cambios' : 'Crear variante', onCancel: close,
        fields: [
          { key: 'product_id', label: 'Producto', type: 'select', options: G.scope.filter(D.all('products')).map(p => [p.id, `${p.code} · ${p.name} (${G.brandName(p.brand_id)})`]), required: true, disabled: !!v, onChange: (x, vals) => upd(vals) },
          { key: 'sku', label: 'SKU (único)', required: true },
          { key: 'name', label: 'Nombre de la presentación', required: true },
          { key: 'cut_type_id', label: 'Tipo de corte', type: 'select', options: (vals) => { const p = prod(vals.product_id); return D.all('cut_types').filter(c => c.status === 'ACTIVE' && (!p || !(c.applies_to_lines || []).length || c.applies_to_lines.includes(p.line))).map(c => [c.id, c.name]); } },
          { key: 'sale_mode', label: 'Modo de venta', type: 'select', options: G.SALE_MODES, required: true, onChange: (x, vals) => upd(vals) },
          { key: 'nominal_weight_kg', label: 'Peso nominal por unidad (kg)', type: 'number', step: 0.001, min: 0, onChange: (x, vals) => upd(vals) },
          { key: 'min_weight_kg', label: 'Peso mínimo (kg)', type: 'number', step: 0.001, min: 0 },
          { key: 'max_weight_kg', label: 'Peso máximo (kg)', type: 'number', step: 0.001, min: 0 },
          { key: 'weight_tolerance_pct', label: 'Tolerancia de peso (%)', type: 'number', step: 0.1, min: 0, help: 'Vacío = parámetro ped_weight_tolerance_pct (10 %)', onChange: (x, vals) => upd(vals) },
          { key: 'barcode', label: 'Código de barras' },
          { key: 'scale_plu', label: 'PLU de balanza (5 dígitos)' },
          { key: 'min_order_qty', label: 'Cantidad mínima de pedido', type: 'number', step: 0.001, min: 0 },
          { key: 'qty_step', label: 'Múltiplo de pedido', type: 'number', step: 0.001, min: 0, help: 'Ej.: 0,25 kg para frutos secos a granel (RN-CAT-07)' },
          { key: 'std_cost', label: 'Costo estándar (S/)', type: 'money', step: 0.01, min: 0 },
          { key: 'web_publishable', label: 'Publicar en la web', type: 'checkbox' },
          { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva']], required: true },
        ],
        onSubmit: vals => { saveVariant(vals, v); close(); toast(v ? 'Variante actualizada' : 'Variante creada', 'ok'); G.refresh(); return true; },
      });
      bd.appendChild(f); upd(f.api.values);
    }, { code: 'CAT-03' });
  }

  /* ---------- CAT-02 Ficha del producto ---------- */
  function renderProduct(el, params) {
    const p = prod(params.id) || productRows('SALE')[0] || D.all('products')[0];
    const vs = D.where('product_variants', v => v.product_id === p.id);
    const sales = productHasSales(p.id);
    const sel = h('select', { class: 'input', style: 'max-width:300px', attrs: { 'aria-label': 'Producto' }, on: { change: e => G.go('CAT-02', { id: e.target.value }) } }, productRows('ALL').map(x => h('option', { value: x.id, selected: x.id === p.id }, `${x.code} · ${x.name}`)));
    const body = page(el, { code: 'CAT-02', title: `Ficha del producto · ${p.name}`, sub: 'Marca, tipo, origen, conservación, lote, IGV, código SUNAT, registro sanitario y si admite descuento. Sus variantes, precios por lista e historial.',
      actions: [sel, canManage() ? { label: 'Editar', kind: 'primary', onClick: () => editProduct(p) } : null].filter(Boolean) });
    const tools = [canManage() ? { label: 'Nueva variante', onClick: () => editVariant(null, { product_id: p.id }) } : null,
        canManage() ? { label: 'Copiar a otra marca', onClick: () => editProduct(null, { copyFrom: p }) } : null,
        canManage() && p.status === 'ACTIVE' ? { label: 'Inactivar', kind: 'danger', onClick: () => confirm({ title: 'Inactivar producto', message: `${p.name} y sus variantes dejan de venderse en PED, POS y la web (RN-CAT-11). ¿Continuar?`, danger: true, confirmLabel: 'Inactivar', onConfirm: () => { try { saveProduct(Object.assign({}, p, { status: 'INACTIVE' }), p); toast('Producto inactivado', 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } } }) } : null,
        canManage() && p.status !== 'ACTIVE' ? { label: 'Activar', onClick: () => { try { saveProduct(Object.assign({}, p, { status: 'ACTIVE' }), p); toast('Producto activado', 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } } } : null].filter(Boolean);
    if (tools.length) body.appendChild(h('div', { class: 'row' }, tools.map(a => btn(a.label, a.onClick, { kind: a.kind, sm: true }))));
    const sn = sanitaryState(p);
    if (['EXPIRED', 'MISSING'].includes(sn.code) && p.status === 'ACTIVE') body.appendChild(notice(`RN-CAT-09: ${p.name} ${sn.code === 'EXPIRED' ? 'tiene el registro sanitario vencido' : 'no tiene registro sanitario'}: no se publica en la web y PED muestra la alerta en el pedido.`, 'bad'));
    const bl = blockedLots(p.id);
    if (bl.length) body.appendChild(notice(`Lote(s) bloqueado(s) por ALM o calidad: ${bl.map(l => `${l.code} (${l.block_reason || G.ui.statusLabel(l.qc_status)})`).join('; ')}. El producto sigue activo; el lote no se despacha.`, 'warn'));
    body.appendChild(h('div', { class: 'grid c2' },
      card('Datos del producto', dl([
        ['Código', h('span', { class: 'mono' }, p.code)], ['Marca', brandBadge(p.brand_id)], ['Categoría', (D.get('product_categories', p.category_id) || {}).name], ['Línea', lineName(p.line)],
        ['Tipo', lab(PTYPES, p.product_type)], ['Origen', lab(ORIGIN, p.origin)], ['Almacenamiento', lab(STORAGE, p.storage)], ['Vida útil', p.shelf_life_days ? F.days(p.shelf_life_days) : '—'],
        ['Control por lote', p.requires_lot ? 'Sí' : 'No'], ['Afectación del IGV', lab(IGV, p.igv_affectation)], ['Código SUNAT', p.sunat_product_code], ['Admite descuento', p.allow_discount === false ? badge('No (RN-CAT-10)', 'warn') : 'Sí'],
        ['Estado', status(p.status)], ['Con ventas', sales ? 'Sí' : 'No'],
      ])),
      card('Registro sanitario y web', dl([
        ['Autoridad', lab(AUTH, p.sanitary_authority)], ['Número', p.sanitary_registry], ['Vencimiento', F.date(p.sanitary_registry_expires)], ['Semáforo', sanBadge(p)], ['Certificado', p.sanitary_certificate || '—'],
        ['Publicado en la web', p.web_publishable ? 'Sí' : 'No'], ['Título web', p.web_title], ['Sincronización', syncBadge(p.web_sync_status)],
      ]), { actions: [btn('Registros', () => G.go('CAT-10'), { sm: true }), btn('Publicación', () => G.go('CAT-09'), { sm: true })] })));
    const lists = D.where('price_lists', l => (!l.brand_id || l.brand_id === p.brand_id));
    body.appendChild(h('div', { style: 'min-width:0' }, tabs([
      { key: 'v', label: 'Variantes y cortes', count: vs.length, render: pn => pn.appendChild(variantTable(vs, { compact: true })) },
      { key: 'p', label: 'Precios por lista', render: pn => {
        const rows = []; for (const v of vs) for (const l of lists) { const it = itemFor(l.id, v.id, G.TODAY, 0); if (it) rows.push({ v, l, it }); }
        pn.appendChild(table({ id: 'cat02p', rows, search: false, columns: [
          { key: 'sku', label: 'SKU', mono: true, value: r => r.v.sku }, { key: 'v', label: 'Variante', value: r => r.v.name }, { key: 'l', label: 'Lista', value: r => r.l.name },
          { key: 'pr', label: 'Prioridad', align: 'r', value: r => r.l.priority ?? 100 }, { key: 'price', label: 'Precio', align: 'r', value: r => r.it.price, render: r => F.money(r.it.price) + (r.it.basis === 'KG' ? '/kg' : '') },
          { key: 'from', label: 'Desde', value: r => F.date(r.it.valid_from) }, { key: 'to', label: 'Hasta', value: r => F.date(r.it.valid_to) }],
          onRow: r => G.go('CAT-06', { list: r.l.id }) }));
      } },
      p.product_type === 'COMBO' ? { key: 'c', label: 'Componentes del combo', render: pn => { for (const v of vs) pn.appendChild(comboCard(v)); } } : null,
      { key: 'h', label: 'Historial', render: pn => {
        const ids = new Set([p.id, ...vs.map(v => v.id)]);
        const au = (D.t.audit || []).filter(a => a.tenant === G.ctx.tenant && ids.has(a.entity_id)).slice().reverse();
        pn.appendChild(au.length ? h('div', { class: 'timeline' }, au.slice(0, 30).map(a => h('div', { class: 'tl-item' }, h('div', { class: 'small muted' }, `${F.datetime(a.at)} · ${a.user}`), h('div', null, `${a.action} · ${a.detail}`)))) : G.ui.empty('Sin cambios registrados en esta sesión. Los cambios de precio están en CAT-12.'));
      } },
    ].filter(Boolean))));
  }

  /* ---------- CAT-03 Variantes y cortes ---------- */
  function variantTable(rows, o = {}) {
    return table({ id: o.compact ? 'cat03c' : 'cat03', rows, searchPlaceholder: 'Buscar SKU, nombre, código de barras o PLU…', search: !o.compact,
      onRow: v => openVariant(v),
      filters: o.compact ? [] : [G.ctx.brand === 'ALL' ? { key: 'brand_id', label: 'Marca', options: brandOpts() } : null, { key: 'sale_mode', label: 'Modo', options: G.SALE_MODES }, { key: 'cut_type_id', label: 'Corte', options: D.all('cut_types').map(c => [c.id, c.name]) }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva']] }].filter(Boolean),
      columns: [
        { key: 'sku', label: 'SKU', mono: true },
        { key: 'name', label: 'Presentación', render: v => h('div', null, h('div', null, v.name), h('div', { class: 'small muted' }, cutName(v.cut_type_id))) },
        o.compact ? null : { key: 'brand_id', label: 'Marca', render: v => brandBadge(v.brand_id), value: v => G.brandName(v.brand_id) },
        { key: 'sale_mode', label: 'Modo de venta', render: v => modeBadge(v.sale_mode), value: v => G.saleModeName(v.sale_mode) },
        { key: 'nominal_weight_kg', label: 'Nominal · mín–máx', align: 'r', render: v => v.sale_mode === 'UNIT' ? '—' : v.nominal_weight_kg ? `${F.num(v.nominal_weight_kg, 3)} · ${F.num(v.min_weight_kg, 3)}–${F.num(v.max_weight_kg, 3)} kg` : 'Por kg' },
        { key: 'weight_tolerance_pct', label: 'Tol.', align: 'r', render: v => v.sale_mode === 'UNIT' ? '—' : F.pct(v.weight_tolerance_pct ?? G.param('ped_weight_tolerance_pct'), 0) },
        { key: 'scale_plu', label: 'PLU', mono: true },
        { key: 'barcode', label: 'Cód. barras', mono: true },
        { key: 'moq', label: 'Mín. · múltiplo', align: 'r', value: v => v.min_order_qty, render: v => `${F.num(v.min_order_qty, v.sale_mode === 'KG' ? 2 : 0)} · ${F.num(v.qty_step, v.sale_mode === 'KG' ? 2 : 0)}` },
        { key: 'pw', label: 'Precio WA', align: 'r', sort: false, render: v => v.sellable ? (priceLabel(v.id) || badge('Sin precio', 'bad')) : h('span', { class: 'muted small' }, 'Insumo') },
        { key: 'status', label: 'Estado', render: v => status(v.status) },
      ].filter(Boolean) });
  }
  function openVariant(v) {
    drawer(`${v.sku} · ${v.name}`, (bd, close) => {
      const actions = h('div', { class: 'row' });
      if (canManage()) {
        actions.appendChild(btn('Editar', () => { close(); editVariant(v); }, { kind: 'primary', sm: true }));
        actions.appendChild(btn(v.status === 'ACTIVE' ? 'Inactivar' : 'Activar', () => { try { setVariantStatus(v.id, v.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'); close(); toast('Estado actualizado', 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { sm: true }));
        actions.appendChild(btn('Borrar', () => { try { removeVariant(v.id); close(); toast('Variante borrada', 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { sm: true, kind: 'danger' }));
      }
      bd.appendChild(actions);
      const p = prod(v.product_id);
      bd.appendChild(dl([['Producto', p ? p.name : '—'], ['Marca', G.brandName(v.brand_id)], ['Corte', cutName(v.cut_type_id)], ['Unidad', v.uom_id === 'um-NIU' ? 'Unidad (NIU)' : 'Kilogramo (KGM)'], ['Modo de venta', G.saleModeName(v.sale_mode)],
        ['Peso nominal', v.nominal_weight_kg ? F.kg(v.nominal_weight_kg, 3) : '—'], ['Peso mínimo / máximo', v.min_weight_kg ? `${F.kg(v.min_weight_kg, 3)} / ${F.kg(v.max_weight_kg, 3)}` : '—'], ['Tolerancia', v.sale_mode === 'UNIT' ? '—' : F.pct(v.weight_tolerance_pct ?? G.param('ped_weight_tolerance_pct'), 1)],
        ['Código de barras', v.barcode], ['PLU de balanza', v.scale_plu], ['Cantidad mínima', F.num(v.min_order_qty, 3)], ['Múltiplo', F.num(v.qty_step, 3)], ['Costo estándar', F.money(v.std_cost)],
        ['Stock publicable', `${F.num(publishableStock(v.id), 3)} ${qtyUnit(v)}`], ['Web', v.web_publishable ? 'Sí' : 'No'], ['Estado', status(v.status)], ['Con movimientos', variantHasMoves(v.id) ? 'Sí (no se borra, RN-CAT-11)' : 'No']]));
      const ps = D.where('price_lists', l => !l.brand_id || l.brand_id === v.brand_id).map(l => ({ l, it: itemFor(l.id, v.id, G.TODAY, 0) })).filter(x => x.it);
      bd.appendChild(card('Precios vigentes', ps.length ? h('div', { class: 'stack', style: 'gap:4px' }, ps.map(x => h('div', { class: 'row between' }, h('span', { class: 'small' }, x.l.name), h('b', { class: 'num' }, F.money(x.it.price) + (x.it.basis === 'KG' ? '/kg' : ''))))) : notice('RN-CAT-05: sin precio vigente, no se vende.', 'warn')));
      if (v.scale_plu) { const code = buildScaleBarcode(v.scale_plu, v.nominal_weight_kg || 1); bd.appendChild(card('Etiqueta de balanza de ejemplo', h('div', { class: 'stack' }, ean13Svg(code), h('div', { class: 'small muted' }, `PLU ${v.scale_plu} con ${F.num(v.nominal_weight_kg || 1, 3)} kg`)))); }
    }, { code: 'CAT-03' });
  }
  function renderVariants(el, params) {
    const body = page(el, { code: 'CAT-03', title: 'Variantes y cortes', sub: 'Un SKU por corte o presentación, con su modo de venta (unidad, kg o unidad con peso variable), pesos nominal, mínimo y máximo, tolerancia, código de barras, PLU, mínimo y múltiplo de pedido.',
      actions: canManage() ? [{ label: 'Nueva variante', kind: 'primary', icon: '+', onClick: () => editVariant(null, params.product_id ? { product_id: params.product_id } : {}) }] : [] });
    const all = G.scope.filter(D.all('product_variants')).filter(v => !params.product_id || v.product_id === params.product_id);
    const sell = all.filter(v => v.sellable);
    body.appendChild(kpis([
      { label: 'Peso variable (por unidad)', value: F.num(sell.filter(v => v.sale_mode === 'UNIT_VARIABLE_WEIGHT' && v.status === 'ACTIVE').length), sub: 'Se piden por unidad, se cobran por kg' },
      { label: 'Por kg', value: F.num(sell.filter(v => v.sale_mode === 'KG' && v.status === 'ACTIVE').length) },
      { label: 'Por unidad (precio fijo)', value: F.num(sell.filter(v => v.sale_mode === 'UNIT' && v.status === 'ACTIVE').length) },
      { label: 'Con PLU de balanza', value: F.num(all.filter(v => v.scale_plu && v.status === 'ACTIVE').length), sub: 'Únicos entre activas (RN-CAT-04)' },
    ]));
    if (params.product_id) body.appendChild(notice(['Mostrando las variantes de ', h('b', null, (prod(params.product_id) || {}).name), '. ', h('a', { class: 'linklike', href: '#', on: { click: e => { e.preventDefault(); G.go('CAT-03'); } } }, 'Ver todas')], 'info'));
    body.appendChild(variantTable(all));
  }

  /* ---------- CAT-04 Tipos de corte ---------- */
  function renderCuts(el) {
    const body = page(el, { code: 'CAT-04', title: 'Tipos de corte', sub: 'Catálogo editable de cortes y presentaciones con las líneas a las que aplican. Al crear una variante solo se ofrecen los cortes de su línea.',
      actions: canManage() ? [{ label: 'Nuevo corte', kind: 'primary', icon: '+', onClick: () => editCut(null) }] : [] });
    const used = U.groupBy(D.all('product_variants').filter(v => v.cut_type_id), 'cut_type_id');
    body.appendChild(table({ id: 'cat04', rows: D.all('cut_types').slice().sort(U.by('sort_order')), onRow: c => editCut(c),
      columns: [
        { key: 'sort_order', label: '#', align: 'r' }, { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Corte' },
        { key: 'lines', label: 'Aplica a', sort: false, render: c => h('div', { class: 'row', style: 'gap:4px' }, (c.applies_to_lines || []).map(l => badge(lineName(l), ''))), value: c => (c.applies_to_lines || []).map(lineName).join(' ') },
        { key: 'n', label: 'Variantes', align: 'r', value: c => (used[c.id] || []).length },
        { key: 'status', label: 'Estado', render: c => status(c.status) },
      ] }));
  }
  function editCut(c) {
    if (!canManage()) { toast(`Tu rol (${G.roleName()}) solo consulta los cortes (cat.product.manage).`, 'warn'); return; }
    drawer(c ? `Editar corte ${c.name}` : 'Nuevo tipo de corte', (bd, close) => {
      const v0 = c ? Object.assign({}, c) : { status: 'ACTIVE', sort_order: (D.all('cut_types').length + 1) * 10 };
      for (const [l] of LINES) v0['line_' + l] = !!(c && (c.applies_to_lines || []).includes(l));
      bd.appendChild(form({ id: 'catc', values: v0, submitLabel: c ? 'Guardar' : 'Crear corte', onCancel: close,
        fields: [{ key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'sort_order', label: 'Orden', type: 'number' }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']], required: true },
          ...LINES.filter(l => l[0] !== 'OTROS').map(([l, n]) => ({ key: 'line_' + l, label: n, type: 'checkbox' }))],
        onSubmit: vals => {
          const code = String(vals.code).trim().toUpperCase();
          if (D.find('cut_types', x => x.code === code && (!c || x.id !== c.id))) return `Ya existe el corte ${code}.`;
          const lines = LINES.map(x => x[0]).filter(l => vals['line_' + l]);
          if (!lines.length) return 'Marca al menos una línea a la que aplica.';
          if (c && vals.status === 'INACTIVE' && D.find('product_variants', v => v.cut_type_id === c.id && v.status === 'ACTIVE')) return 'Hay variantes activas con este corte: cámbialas antes de inactivarlo.';
          const row = { code, name: vals.name, sort_order: Number(vals.sort_order) || 0, status: vals.status, applies_to_lines: lines };
          if (c) D.update('cut_types', c.id, row); else D.insert('cut_types', row);
          close(); toast('Corte guardado', 'ok'); G.refresh(); return true;
        } }));
    }, { code: 'CAT-04' });
  }

  /* ---------- CAT-05 Listas de precio ---------- */
  function renderLists(el) {
    const body = page(el, { code: 'CAT-05', title: 'Listas de precio', sub: 'Por marca, canal y tipo de cliente, con vigencia y prioridad (menor número gana). Copia una lista, programa una nueva vigencia o mira cuál aplica a un caso.',
      actions: [canPrice() ? { label: 'Nueva lista', kind: 'primary', icon: '+', onClick: () => editList(null) } : null, { label: '¿Qué lista aplica?', onClick: () => G.go('CAT-07') }].filter(Boolean) });
    const rows = G.scope.filter(D.all('price_lists'));
    const cnt = U.groupBy(D.where('price_list_items', x => x.valid_from <= G.TODAY && (!x.valid_to || x.valid_to >= G.TODAY)), 'list_id');
    body.appendChild(kpis([
      { label: 'Listas activas', value: F.num(rows.filter(l => l.status === 'ACTIVE').length) },
      { label: 'Programadas o en borrador', value: F.num(rows.filter(l => l.status === 'DRAFT' || l.valid_from > G.TODAY).length) },
      { label: 'Precios vigentes', value: F.num(U.sum(rows, l => (cnt[l.id] || []).length)) },
      { label: 'Cambios programados', value: F.num(D.where('price_list_items', x => x.valid_from > G.TODAY && rows.some(l => l.id === x.list_id)).length), sub: 'Precios con vigencia futura' },
    ]));
    body.appendChild(notice('D-CAT-03 (valor provisional): una lista por canal, inicialmente con los mismos precios en la web y en WhatsApp.', 'info'));
    body.appendChild(table({ id: 'cat05', rows, onRow: l => openList(l),
      filters: [G.ctx.brand === 'ALL' ? { key: 'brand_id', label: 'Marca', options: brandOpts() } : null, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activa'], ['DRAFT', 'Borrador'], ['INACTIVE', 'Inactiva']] }].filter(Boolean),
      columns: [
        { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Lista' },
        { key: 'brand_id', label: 'Marca', render: l => l.brand_id ? brandBadge(l.brand_id) : 'Todas', value: l => G.brandName(l.brand_id) },
        { key: 'channels', label: 'Canales', sort: false, value: l => (l.channels || []).length ? l.channels.map(G.channelName).join(', ') : 'Cualquiera' },
        { key: 'customer_types', label: 'Tipo de cliente', sort: false, value: l => (l.customer_types || []).length ? l.customer_types.map(t => lab(CUST_TYPES, t)).join(', ') : 'Cualquiera' },
        { key: 'priority', label: 'Prioridad', align: 'r', value: l => l.priority ?? 100 },
        { key: 'includes_igv', label: 'IGV', value: l => l.includes_igv !== false ? 'Incluido' : 'Sin IGV' },
        { key: 'valid_from', label: 'Vigencia', value: l => `${F.date(l.valid_from)} – ${l.valid_to ? F.date(l.valid_to) : 'sin fin'}` },
        { key: 'n', label: 'Precios', align: 'r', value: l => (cnt[l.id] || []).length },
        { key: 'status', label: 'Estado', render: l => status(l.status) },
      ] }));
  }
  function listFields(isNew) {
    return [
      { key: 'code', label: 'Código (único)', required: true }, { key: 'name', label: 'Nombre', required: true },
      { key: 'brand_id', label: 'Marca', type: 'select', options: brandOpts() }, { key: 'priority', label: 'Prioridad (menor gana)', type: 'number', min: 0, required: true },
      { key: 'valid_from', label: 'Vigente desde', type: 'date', required: true }, { key: 'valid_to', label: 'Vigente hasta', type: 'date' },
      { key: 'includes_igv', label: 'Los precios incluyen IGV', type: 'checkbox' }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activa'], ['DRAFT', 'Borrador'], ['INACTIVE', 'Inactiva']], required: true },
      ...SALE_CHANNELS.map(c => ({ key: 'ch_' + c, label: 'Canal ' + G.channelName(c), type: 'checkbox' })),
      ...CUST_TYPES.map(([t, n]) => ({ key: 'ct_' + t, label: 'Cliente ' + n.toLowerCase(), type: 'checkbox' })),
    ];
  }
  function editList(l) {
    if (!canPrice()) return G.require('cat.price.manage', () => { });
    drawer(l ? `Editar ${l.name}` : 'Nueva lista de precio', (bd, close) => {
      const v0 = l ? Object.assign({}, l) : { priority: 100, includes_igv: true, status: 'DRAFT', valid_from: G.date.add(G.TODAY, 1), brand_id: G.ctx.brand !== 'ALL' ? G.ctx.brand : 'br-DG' };
      for (const c of SALE_CHANNELS) v0['ch_' + c] = !!(l && (l.channels || []).includes(c));
      for (const [t] of CUST_TYPES) v0['ct_' + t] = !!(l && (l.customer_types || []).includes(t));
      bd.appendChild(notice('Canales o tipos de cliente sin marcar = cualquiera. Entre listas que aplican gana la de menor prioridad y, a igual prioridad, la más específica (RN-CAT-05).', 'info'));
      bd.appendChild(form({ id: 'catl', values: v0, submitLabel: l ? 'Guardar' : 'Crear lista', onCancel: close, fields: listFields(!l),
        onSubmit: vals => { const x = saveList(Object.assign({}, vals, { channels: SALE_CHANNELS.filter(c => vals['ch_' + c]), customer_types: CUST_TYPES.map(t => t[0]).filter(t => vals['ct_' + t]) }), l); close(); toast('Lista guardada', 'ok'); if (!l) G.go('CAT-06', { list: x.id }); else G.refresh(); return true; } }));
    }, { code: 'CAT-05' });
  }
  function openList(l) {
    drawer(l.name, (bd, close) => {
      const acts = h('div', { class: 'row' }, btn('Ver precios', () => { close(); G.go('CAT-06', { list: l.id }); }, { kind: 'primary', sm: true }));
      if (canPrice()) {
        acts.append(btn('Editar', () => { close(); editList(l); }, { sm: true }), btn('Copiar lista', () => { close(); copyDialog(l); }, { sm: true }), btn('Programar nueva vigencia', () => { close(); scheduleDialog(l); }, { sm: true }));
        if (l.status !== 'ACTIVE') acts.append(btn('Activar', () => { saveList(Object.assign({}, l), l); D.update('price_lists', l.id, { status: 'ACTIVE' }); close(); toast('Lista activada', 'ok'); G.refresh(); }, { sm: true }));
        else acts.append(btn('Inactivar', () => { D.update('price_lists', l.id, { status: 'INACTIVE' }); emit('price.changed', { list_id: l.id }); close(); toast('Lista inactivada', 'ok'); G.refresh(); }, { sm: true, kind: 'danger' }));
      }
      bd.appendChild(acts);
      bd.appendChild(dl([['Código', l.code], ['Marca', l.brand_id ? G.brandFull(l.brand_id) : 'Todas'], ['Canales', (l.channels || []).length ? l.channels.map(G.channelName).join(', ') : 'Cualquiera'], ['Tipo de cliente', (l.customer_types || []).length ? l.customer_types.map(t => lab(CUST_TYPES, t)).join(', ') : 'Cualquiera'],
        ['Prioridad', l.priority ?? 100], ['IGV', l.includes_igv !== false ? 'Incluido' : 'Sin IGV'], ['Vigencia', `${F.date(l.valid_from)} – ${l.valid_to ? F.date(l.valid_to) : 'sin fin'}`], ['Estado', status(l.status)]]));
      const items = D.where('price_list_items', x => x.list_id === l.id);
      bd.appendChild(dl([['Precios vigentes hoy', items.filter(x => x.valid_from <= G.TODAY && (!x.valid_to || x.valid_to >= G.TODAY)).length], ['Programados', items.filter(x => x.valid_from > G.TODAY).length], ['Históricos', items.filter(x => x.valid_to && x.valid_to < G.TODAY).length]]));
    }, { code: 'CAT-05' });
  }
  function copyDialog(l) {
    drawer(`Copiar ${l.code}`, (bd, close) => {
      bd.appendChild(form({ id: 'catcp', values: { code: l.code + '-COPIA', name: l.name + ' (copia)', pct: 0, valid_from: G.date.add(G.TODAY, 1), priority: l.priority ?? 100 }, submitLabel: 'Copiar', onCancel: close,
        fields: [{ key: 'code', label: 'Código nuevo', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'pct', label: 'Ajuste de precios (%)', type: 'number', step: 0.1 }, { key: 'valid_from', label: 'Vigente desde', type: 'date', required: true }, { key: 'priority', label: 'Prioridad', type: 'number' }],
        onSubmit: vals => { const r = copyList(l.id, vals); close(); toast(`Lista ${r.list.code} creada en borrador con ${r.items} precios`, 'ok'); G.go('CAT-06', { list: r.list.id }); return true; } }));
    }, { code: 'CAT-05' });
  }
  function scheduleDialog(l) {
    drawer(`Programar nueva vigencia · ${l.name}`, (bd, close) => {
      bd.appendChild(notice('Cada precio vigente se cierra el día anterior y se abre otro con el ajuste, sin superponer vigencias (RN-CAT-06).', 'info'));
      bd.appendChild(form({ id: 'catsch', values: { valid_from: G.date.addMonths(G.TODAY, 1), pct: 5 }, submitLabel: 'Programar', onCancel: close,
        fields: [{ key: 'valid_from', label: 'Nueva vigencia desde', type: 'date', required: true }, { key: 'pct', label: 'Ajuste (%)', type: 'number', step: 0.1, required: true }, { key: 'reason', label: 'Motivo', required: true, span: 2 }],
        onSubmit: vals => { const n = scheduleList(l.id, vals); close(); toast(`${n} precios programados desde el ${F.date(vals.valid_from)}`, 'ok'); G.go('CAT-06', { list: l.id }); return true; } }));
    }, { code: 'CAT-05' });
  }

  /* ---------- CAT-06 Precios de la lista ---------- */
  function renderListItems(el, params) {
    const lists = G.scope.filter(D.all('price_lists'));
    const st = renderListItems.st = renderListItems.st || { when: 'NOW' };
    const l = D.get('price_lists', params.list) || lists.find(x => x.id === 'pl-DG-WA') || lists[0];
    const sel = h('select', { class: 'input', style: 'max-width:320px', attrs: { 'aria-label': 'Lista' }, on: { change: e => G.go('CAT-06', { list: e.target.value }) } }, lists.map(x => h('option', { value: x.id, selected: x.id === l.id }, x.name)));
    const body = page(el, { code: 'CAT-06', title: `Precios de la lista · ${l.name}`, sub: 'Grilla variante × precio con base (unidad o kg), cantidad mínima y vigencia propia. Los cambios cierran la vigencia anterior; la importación CSV muestra la diferencia antes de aplicar.',
      actions: [sel, canPrice() ? { label: 'Agregar precio', kind: 'primary', icon: '+', onClick: () => priceDialog(l, null) } : null, canPrice() ? { label: 'Importar CSV', onClick: () => csvDialog(l) } : null].filter(Boolean) });
    const items = D.where('price_list_items', x => x.list_id === l.id);
    const cur = items.filter(x => x.valid_from <= G.TODAY && (!x.valid_to || x.valid_to >= G.TODAY));
    const brandVs = D.where('product_variants', v => v.sellable && v.status === 'ACTIVE' && (!l.brand_id || v.brand_id === l.brand_id));
    const missing = brandVs.filter(v => !cur.some(x => x.variant_id === v.id));
    body.appendChild(kpis([
      { label: 'Vigentes hoy', value: F.num(cur.length) }, { label: 'Programados', value: F.num(items.filter(x => x.valid_from > G.TODAY).length) },
      { label: 'Históricos', value: F.num(items.filter(x => x.valid_to && x.valid_to < G.TODAY).length) },
      { label: 'Variantes sin precio en la lista', value: F.num(missing.length), tone: missing.length ? 'warn' : 'ok', sub: missing.slice(0, 2).map(v => v.sku).join(', ') },
    ]));
    if (l.status !== 'ACTIVE') body.appendChild(notice(`La lista está ${G.ui.statusLabel(l.status).toLowerCase()}: no se usa para vender hasta activarla en CAT-05.`, 'warn'));
    body.appendChild(pills([['NOW', 'Vigentes'], ['FUTURE', 'Programados'], ['PAST', 'Históricos'], ['ALL', 'Todos']], st.when, v => { st.when = v; G.refresh(); }));
    const rows = items.filter(x => st.when === 'ALL' ? true : st.when === 'NOW' ? cur.includes(x) : st.when === 'FUTURE' ? x.valid_from > G.TODAY : x.valid_to && x.valid_to < G.TODAY);
    body.appendChild(table({ id: 'cat06', rows, sort: 'sku',
      columns: [
        { key: 'sku', label: 'SKU', value: x => (vari(x.variant_id) || {}).sku, render: x => h('span', { class: 'mono nowrap' }, (vari(x.variant_id) || {}).sku) },
        { key: 'v', label: 'Variante', value: x => G.variantName(x.variant_id) },
        { key: 'basis', label: 'Base', value: x => x.basis === 'KG' ? 'Por kg' : 'Por unidad' },
        { key: 'min_qty', label: 'Cant. mín.', align: 'r', value: x => Number(x.min_qty) || 0, render: x => Number(x.min_qty) ? F.num(x.min_qty, 2) : '—' },
        { key: 'price', label: 'Precio', align: 'r', render: x => h('b', { class: 'num nowrap' }, F.money(x.price)) },
        { key: 'previous_price', label: 'Anterior', align: 'r', render: x => x.previous_price ? h('span', { class: 'nowrap' }, F.money(x.previous_price)) : '—' },
        { key: 'valid_from', label: 'Desde', render: x => F.date(x.valid_from) },
        { key: 'valid_to', label: 'Hasta', render: x => x.valid_to ? F.date(x.valid_to) : h('span', { class: 'muted' }, 'Sin fin') },
        { key: 'created_by', label: 'Cargó' },
      ],
      actions: x => canPrice() && (!x.valid_to || x.valid_to >= G.TODAY) ? [btn('Cambiar precio', () => priceDialog(l, x), { sm: true }), !x.valid_to ? btn('Cerrar', () => closeDialog(x), { sm: true, kind: 'ghost' }) : null].filter(Boolean) : [] }));
  }
  function priceDialog(l, it) {
    drawer(it ? `Cambiar precio · ${G.variantName(it.variant_id)}` : `Agregar precio · ${l.name}`, (bd, close) => {
      if (it) bd.appendChild(notice(`Precio actual ${F.money(it.price)} desde el ${F.date(it.valid_from)}. El nuevo cierra esa vigencia el día anterior (RN-CAT-06).`, 'info'));
      const v0 = it ? { variant_id: it.variant_id, price: it.price, min_qty: it.min_qty || 0, valid_from: G.date.add(G.TODAY, 1), close: true } : { valid_from: G.TODAY, min_qty: 0, close: false };
      bd.appendChild(form({ id: 'catpr', values: v0, submitLabel: 'Guardar precio', onCancel: close,
        fields: [{ key: 'variant_id', label: 'Variante', type: 'select', options: variantOpts(v => v.sellable && (!l.brand_id || v.brand_id === l.brand_id)), required: true, disabled: !!it },
          { key: 'price', label: 'Precio (S/, con IGV)', type: 'money', step: 0.01, min: 0.01, required: true }, { key: 'min_qty', label: 'Cantidad mínima del tramo', type: 'number', step: 0.001, min: 0 },
          { key: 'valid_from', label: 'Vigente desde', type: 'date', required: true }, { key: 'valid_to', label: 'Vigente hasta', type: 'date' },
          { key: 'close', label: 'Cerrar la vigencia anterior', type: 'checkbox', help: 'Sin esta marca, un precio superpuesto se rechaza (RN-CAT-06)' }, { key: 'reason', label: 'Motivo', span: 2 }],
        onSubmit: vals => { addPrice({ list_id: l.id, variant_id: it ? it.variant_id : vals.variant_id, price: vals.price, min_qty: vals.min_qty, valid_from: vals.valid_from, valid_to: vals.valid_to || null, closePrevious: !!vals.close, reason: vals.reason }); close(); toast('Precio guardado', 'ok'); G.refresh(); return true; } }));
    }, { code: 'CAT-06' });
  }
  function closeDialog(it) {
    drawer(`Cerrar vigencia · ${G.variantName(it.variant_id)}`, (bd, close) => {
      bd.appendChild(form({ id: 'catcl', values: { date: G.TODAY }, submitLabel: 'Cerrar vigencia', onCancel: close,
        fields: [{ key: 'date', label: 'Último día vigente', type: 'date', required: true }, { key: 'reason', label: 'Motivo', required: true }],
        onSubmit: vals => { closePrice(it.id, vals.date, vals.reason); close(); toast('Vigencia cerrada', 'ok'); G.refresh(); return true; } }));
    }, { code: 'CAT-06' });
  }
  function csvDialog(l) {
    drawer(`Importar precios · ${l.name}`, (bd, close) => {
      const vs = D.where('product_variants', v => v.sellable && v.status === 'ACTIVE' && (!l.brand_id || v.brand_id === l.brand_id)).slice(0, 3);
      const sample = ['sku;precio;desde;cant_min', ...vs.map((v, i) => `${v.sku};${R((itemFor(l.id, v.id, G.TODAY, 0) || { price: 10 }).price * 1.05, 2)};${G.date.add(G.TODAY, 7)};0`), 'NO-EXISTE;12;' + G.date.add(G.TODAY, 7) + ';0'].join('\n');
      const ta = h('textarea', { class: 'input', style: 'min-height:120px;font-family:var(--mono, monospace)' }, sample);
      const out = h('div');
      let rows = [];
      const prev = () => {
        rows = previewCsv(l.id, ta.value);
        G.ui.clear(out).appendChild(table({ id: 'catcsv', rows, search: false, pageSize: 50, columns: [
          { key: 'line', label: 'Fila', align: 'r' }, { key: 'sku', label: 'SKU', mono: true }, { key: 'v', label: 'Variante', value: r => r.variant ? r.variant.name : '—' },
          { key: 'current', label: 'Actual', align: 'r', render: r => r.current != null ? F.money(r.current) : '—' }, { key: 'price', label: 'Nuevo', align: 'r', render: r => F.money(r.price) },
          { key: 'diff_pct', label: 'Cambio', align: 'r', render: r => r.diff_pct != null ? badge((r.diff_pct > 0 ? '+' : '') + F.num(r.diff_pct, 1) + ' %', Math.abs(r.diff_pct) > 15 ? 'warn' : '') : 'Nuevo' },
          { key: 'valid_from', label: 'Desde', render: r => F.date(r.valid_from) }, { key: 'error', label: 'Validación', render: r => r.error ? badge(r.error, 'bad') : badge('Lista para cargar', 'ok') }] }));
        out.appendChild(h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'small muted' }, `${rows.filter(r => !r.error).length} filas válidas, ${rows.filter(r => r.error).length} con error (se omiten).`),
          btn('Aplicar cambios', () => { try { const n = importCsv(l.id, rows, 'Importación CSV'); close(); toast(`${n} precios cargados`, 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'primary', disabled: !rows.some(r => !r.error) })));
      };
      bd.append(h('p', { class: 'small muted' }, 'Columnas: sku; precio con IGV; desde (AAAA-MM-DD); cantidad mínima. El archivo pasa por INT (archivos) en el sistema final.'), ta, h('div', { class: 'row', style: 'margin:8px 0' }, btn('Validar y previsualizar', prev, { kind: 'accent' })), out);
      prev();
    }, { code: 'CAT-06', wide: true });
  }

  /* ---------- CAT-07 Simulador de precio ---------- */
  const kpisList = list => [...kpis(list).children];
  function renderSimulator(el, params) {
    const st = renderSimulator.st = renderSimulator.st || { variant_id: 'va-DG-CON-DES', channel: 'WHATSAPP', customer_type: 'RESTAURANT', date: G.TODAY, qty: 2 };
    const body = page(el, { code: 'CAT-07', title: 'Simulador de precio', sub: 'Dado canal, marca, tipo de cliente, fecha y cantidad, muestra la lista y el precio que el sistema elegiría y por qué (RN-CAT-05).' });
    const res = h('div', { class: 'stack' }), traceBox = h('div', { style: 'min-width:0' });
    const run = vals => {
      Object.assign(st, vals);
      const v = vari(st.variant_id);
      G.ui.clear(res); G.ui.clear(traceBox);
      if (!v) return;
      const r = priceFor(v.id, { channel: st.channel, customer_type: st.customer_type, date: st.date, qty: Number(st.qty) || 0 });
      const all = priceFor(v.id, { channel: st.channel, customer_type: st.customer_type, date: st.date, qty: Number(st.qty) || 0 }) || { trace: [] };
      if (r) {
        const kg = estimateKg(v.id, st.qty);
        const basisQ = r.basis === 'KG' ? (kg ?? Number(st.qty)) : Number(st.qty);
        let qtyMsg = null; try { checkQty(v.id, st.qty); } catch (e) { qtyMsg = e.message; }
        res.appendChild(h('div', { class: 'grid c2' }, ...kpisList([
          { label: 'Precio elegido', value: F.money(r.price) + (r.basis === 'KG' ? '/kg' : ''), tone: 'ok', sub: r.list.name },
          { label: r.basis === 'KG' ? 'Peso estimado' : 'Cantidad', value: r.basis === 'KG' ? F.kg(basisQ, 3) : F.num(basisQ, 0) + ' u', sub: v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? `${F.num(st.qty, 0)} u × ${F.num(v.nominal_weight_kg, 3)} kg nominal` : '' },
          { label: 'Importe estimado', value: F.money(R(basisQ * r.price)), sub: r.basis === 'KG' ? 'Se cobra con el peso real' : '' },
          { label: 'Admite descuento', value: allowsDiscount(v.id) ? 'Sí' : 'No', sub: 'RN-CAT-10', tone: allowsDiscount(v.id) ? '' : 'warn' },
        ])));
        res.appendChild(notice([h('b', null, 'Por qué: '), r.reason + '.'], 'ok'));
        if (qtyMsg) res.appendChild(notice(qtyMsg, 'warn'));
      } else res.appendChild(notice(`RN-CAT-05: ${v.name} no tiene precio vigente para ${G.channelName(st.channel)} · ${lab(CUST_TYPES, st.customer_type)} el ${F.date(st.date)}: no se puede vender en ese canal.`, 'bad'));
      const trace = (r || all).trace.length ? (r || all).trace : D.where('price_lists', l => !l.brand_id || l.brand_id === v.brand_id).map(l => ({ list: l, ok: false, why: listApplies(l, { brand_id: v.brand_id, channel: st.channel, customer_type: st.customer_type, date: st.date }).why, item: null }));
      traceBox.appendChild(card('Listas evaluadas en orden', table({ id: 'cat07', rows: trace, search: false, columns: [
        { key: 'l', label: 'Lista', value: t => t.list.name, render: t => h('span', null, t.chosen ? badge('Elegida', 'ok') : null, ' ', t.list.name) },
        { key: 'p', label: 'Prioridad', align: 'r', value: t => t.list.priority ?? 100 }, { key: 's', label: 'Criterios', align: 'r', value: t => specificity(t.list) },
        { key: 'why', label: 'Resultado', render: t => h('span', { class: t.ok ? '' : 'muted' }, t.why) },
        { key: 'price', label: 'Precio', align: 'r', render: t => t.item ? F.money(t.item.price) + (Number(t.item.min_qty) ? ` (desde ${F.num(t.item.min_qty, 2)})` : '') : '—' }] }), { flush: true }));
    };
    body.appendChild(h('div', { class: 'grid c2' },
      card('Caso', form({ id: 'cat07f', values: st, submitLabel: 'Calcular',
        fields: [
          { key: 'variant_id', label: 'Variante', type: 'select', options: variantOpts(v => v.sellable), required: true, span: 2 },
          { key: 'channel', label: 'Canal', type: 'select', options: SALE_CHANNELS.map(c => [c, G.channelName(c)]), required: true },
          { key: 'customer_type', label: 'Tipo de cliente', type: 'select', options: CUST_TYPES, required: true },
          { key: 'date', label: 'Fecha', type: 'date', required: true },
          { key: 'qty', label: 'Cantidad pedida', type: 'number', step: 0.001, min: 0, required: true },
        ], onSubmit: vals => { run(vals); return true; } })),
      res));
    body.appendChild(traceBox);
    run(st);
  }

  /* ---------- CAT-08 Combos ---------- */
  function comboCard(v) {
    const cs = comps(v.id); const ch = comboCheck(v.id); const pr = priceFor(v.id);
    const parts = pr ? explodeCombo.length && ch.ok ? explodeCombo(v.id, 1, pr.price) : [] : [];
    const tb = table({ id: 'cat08-' + v.id, rows: cs, search: false, columns: [
      { key: 'c', label: 'Componente', value: c => G.variantName(c.component_variant_id) },
      { key: 'qty', label: 'Cantidad', align: 'r', render: c => `${F.num(c.qty, 3)} ${qtyUnit(vari(c.component_variant_id))}` },
      { key: 'est_weight_kg', label: 'Peso est.', align: 'r', render: c => c.est_weight_kg ? F.kg(c.est_weight_kg, 3) : '—' },
      { key: 'price_share_pct', label: '% del precio', align: 'r', render: c => F.pct(c.price_share_pct, 1) },
      { key: 'amt', label: 'Importe', align: 'r', render: c => { const x = parts.find(p => p.variant_id === c.component_variant_id); return x ? F.money(x.amount) : '—'; } },
      { key: 'stk', label: 'Stock disp.', align: 'r', render: c => { const s = publishableStockRaw(c.component_variant_id); return h('span', { class: s < c.qty ? 'num' : 'num' }, s < c.qty ? badge(F.num(s, 1), 'bad') : F.num(s, 1)); } }],
      actions: canManage() ? c => [btn('Quitar', () => { D.remove('combo_components', c.id); emit('product.changed', { variant_id: v.id }); toast('Componente quitado', 'ok'); G.refresh(); }, { sm: true, kind: 'ghost' })] : null,
      footer: ['Total', '', '', { v: F.pct(ch.sum, 1), align: 'r' }, { v: pr ? F.money(pr.price) : '—', align: 'r' }, { v: `${F.num(comboStock(v.id), 0)} combos`, align: 'r' }] });
    return card(`${v.sku} · ${v.name} · ${G.brandName(v.brand_id)}`, h('div', { class: 'stack' },
      ch.ok ? notice(`Reparto 100 % · precio ${pr ? F.money(pr.price) : 'sin precio (RN-CAT-05)'} · alcanza para ${F.num(comboStock(v.id), 0)} combos con el stock disponible. El stock y el comprobante salen por componente.`, comboStock(v.id) > 0 ? 'ok' : 'warn') : notice(ch.problems.join(' '), 'bad'),
      tb), { actions: canManage() ? [btn('Agregar componente', () => compDialog(v), { sm: true, kind: 'primary' })] : null });
  }
  function compDialog(v) {
    drawer(`Agregar componente · ${v.name}`, (bd, close) => {
      const left = R(100 - U.sum(comps(v.id), c => c.price_share_pct), 3);
      bd.appendChild(notice(`Falta repartir ${F.pct(left, 1)} del precio. Un combo no contiene otro combo (RN-CAT-08).`, 'info'));
      bd.appendChild(form({ id: 'catcc', values: { qty: 1, price_share_pct: left > 0 ? left : 10 }, submitLabel: 'Agregar', onCancel: close,
        fields: [{ key: 'component_variant_id', label: 'Variante', type: 'select', options: variantOpts(x => x.sellable && x.id !== v.id), required: true, span: 2 }, { key: 'qty', label: 'Cantidad', type: 'number', step: 0.001, min: 0.001, required: true }, { key: 'est_weight_kg', label: 'Peso estimado (kg)', type: 'number', step: 0.001, min: 0 }, { key: 'price_share_pct', label: '% del precio', type: 'number', step: 0.01, min: 0.01, max: 100, required: true }],
        onSubmit: vals => { addComboComponent(v.id, vals); close(); toast('Componente agregado', 'ok'); G.refresh(); return true; } }));
    }, { code: 'CAT-08' });
  }
  function newCombo() {
    if (!canManage()) return G.require('cat.product.manage', () => { });
    drawer('Nuevo combo', (bd, close) => {
      bd.appendChild(form({ id: 'catnc', values: { brand_id: G.ctx.brand !== 'ALL' ? G.ctx.brand : 'br-DG', code: 'PACK-', price: 0 }, submitLabel: 'Crear combo', onCancel: close,
        fields: [{ key: 'brand_id', label: 'Marca', type: 'select', options: brandOpts(), required: true }, { key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'price', label: 'Precio público (S/)', type: 'money', min: 0.01, step: 0.01, required: true }],
        onSubmit: vals => {
          const p = saveProduct({ code: vals.code, name: vals.name, brand_id: vals.brand_id, category_id: 'pc-COMBOS', product_type: 'COMBO', origin: 'PRODUCED', storage: 'CHILLED', shelf_life_days: 5, requires_lot: false, igv_affectation: '10', sanitary_authority: 'NONE', allow_discount: false, status: 'ACTIVE' });
          const v = saveVariant({ product_id: p.id, sku: (G.brandName(vals.brand_id) === 'Don Guando' ? 'DG' : vals.brand_id.slice(3)) + '-' + vals.code, name: vals.name, sale_mode: 'UNIT', min_order_qty: 1, qty_step: 1, status: 'ACTIVE' });
          for (const l of D.where('price_lists', x => x.brand_id === vals.brand_id && x.status === 'ACTIVE' && !(x.customer_types || []).length && x.valid_from <= G.TODAY)) addPrice({ list_id: l.id, variant_id: v.id, price: /B2B/.test(l.code) ? R(vals.price * 0.9) : vals.price, valid_from: G.TODAY, reason: 'Alta de combo' });
          close(); toast('Combo creado: agrega sus componentes', 'ok'); G.refresh(); return true;
        } }));
    }, { code: 'CAT-08' });
  }
  function renderCombos(el) {
    const body = page(el, { code: 'CAT-08', title: 'Combos', sub: 'Componentes con cantidad, peso estimado y porcentaje del precio; el reparto suma 100 % y se valida el stock de cada componente.',
      actions: canManage() ? [{ label: 'Nuevo combo', kind: 'primary', icon: '+', onClick: newCombo }] : [] });
    const combos = G.scope.filter(D.where('product_variants', v => (prod(v.product_id) || {}).product_type === 'COMBO'));
    if (!combos.length) { body.appendChild(G.ui.empty('No hay combos en las marcas seleccionadas.')); return; }
    body.appendChild(kpis([{ label: 'Combos', value: F.num(combos.length) }, { label: 'Con reparto válido', value: F.num(combos.filter(v => comboCheck(v.id).ok).length) }, { label: 'Sin stock de algún componente', value: F.num(combos.filter(v => comboStock(v.id) <= 0).length), tone: combos.some(v => comboStock(v.id) <= 0) ? 'warn' : 'ok' }]));
    for (const v of combos) body.appendChild(comboCard(v));
  }

  /* ---------- CAT-09 Publicación web ---------- */
  function renderWeb(el) {
    const body = page(el, { code: 'CAT-09', title: 'Publicación web', sub: 'Productos y variantes marcados para la tienda de cada marca, con título, descripción, imagen y estado de sincronización (lo envía WEB a WooCommerce).' });
    const rows = G.scope.filter(D.all('products')).filter(isSaleType);
    const k2 = G.kpi('KPI-CAT-02', { brand: G.ctx.brand !== 'ALL' ? G.ctx.brand : null }) || {};
    body.appendChild(kpis([
      { label: 'Productos publicados', value: F.num(rows.filter(p => p.web_publishable).length), sub: `de ${rows.length} de venta` },
      { label: 'Pendientes de envío', value: F.num(rows.filter(p => p.web_sync_status === 'PENDING').length), tone: rows.some(p => p.web_sync_status === 'PENDING') ? 'warn' : '' },
      { label: 'Publicados sin stock', value: F.pct(k2.value), sub: `${k2.numerator || 0} de ${k2.denominator || 0} variantes · KPI-CAT-02`, tone: (k2.value || 0) > 0 ? 'warn' : 'ok' },
      { label: 'Bloqueados por registro vencido', value: F.num(rows.filter(p => sanitaryState(p).code === 'EXPIRED').length), sub: 'RN-CAT-09', tone: 'bad' },
    ]));
    if (!G.screens['WEB-01']) body.appendChild(notice('El envío a WooCommerce lo hace WEB. En esta vista, «Enviar a la web» marca el cambio como enviado con la fecha y hora.', 'info'));
    body.appendChild(table({ id: 'cat09', rows, onRow: p => webDialog(p),
      filters: [G.ctx.brand === 'ALL' ? { key: 'brand_id', label: 'Marca', options: brandOpts() } : null, { key: 'web', label: 'Web', options: [['1', 'Publicado'], ['0', 'No publicado']], value: p => p.web_publishable ? '1' : '0' }, { key: 'web_sync_status', label: 'Sincronización', options: Object.entries(SYNC).map(([k, v]) => [k, v[0]]) }].filter(Boolean),
      columns: [
        { key: 'name', label: 'Producto', render: p => h('div', null, h('div', null, p.web_title || p.name), h('div', { class: 'small muted' }, p.image_url || 'Sin imagen')) },
        { key: 'brand_id', label: 'Tienda', render: p => brandBadge(p.brand_id), value: p => G.brandName(p.brand_id) },
        { key: 'vars', label: 'Variantes web', align: 'r', value: p => D.where('product_variants', v => v.product_id === p.id && v.web_publishable && v.status === 'ACTIVE').length },
        { key: 'stk', label: 'Stock publicable', align: 'r', sort: false, render: p => { const vs = D.where('product_variants', v => v.product_id === p.id && v.status === 'ACTIVE'); const s = U.sum(vs, v => publishableStock(v.id)); return s > 0 ? F.num(s, 1) : badge('0', p.web_publishable ? 'bad' : ''); } },
        { key: 'san', label: 'Registro', render: p => sanBadge(p), value: p => sanitaryState(p).code },
        { key: 'web_publishable', label: 'Publicado', render: p => p.web_publishable ? badge('Sí', 'ok') : 'No' },
        { key: 'web_sync_status', label: 'Sincronización', render: p => h('div', null, syncBadge(p.web_sync_status), p.web_synced_at ? h('div', { class: 'small muted' }, F.datetime(p.web_synced_at)) : null) },
      ],
      actions: p => canWeb() ? [btn(p.web_publishable ? 'Retirar' : 'Publicar', () => { try { setWeb(p.id, !p.web_publishable); toast(p.web_publishable ? 'Retirado de la web' : 'Marcado para la web', 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { sm: true }), p.web_sync_status === 'PENDING' ? btn('Enviar a la web', () => { syncWeb(p.id); toast('Enviado a la web', 'ok'); G.refresh(); }, { sm: true, kind: 'primary' }) : null].filter(Boolean) : [] }));
  }
  function setWeb(pid, on) {
    need('cat.product.publish_web', 'RN-CAT-09');
    const p = prod(pid);
    if (on && sanitaryState(p).code === 'EXPIRED') G.fail('RN-CAT-09', `${p.name} tiene el registro sanitario vencido (${F.date(p.sanitary_registry_expires)}): no se publica en la web. Renueva el registro en CAT-10.`);
    if (on && sanitaryState(p).code === 'MISSING') G.fail('RN-CAT-09', `${p.name} no tiene registro sanitario: no se publica.`);
    if (on && p.status !== 'ACTIVE') G.fail('RN-CAT-11', 'Solo se publican productos activos.');
    D.update('products', pid, { web_publishable: on, web_sync_status: 'PENDING' });
    if (on) for (const v of D.where('product_variants', v => v.product_id === pid && v.status === 'ACTIVE' && v.web_publishable == null)) D.update('product_variants', v.id, { web_publishable: true }, { silent: true });
    emit('product.changed', { product_id: pid, web: on });
  }
  function syncWeb(pid) {
    if (G.web && typeof G.web.syncProduct === 'function') return G.web.syncProduct(pid);
    const p = prod(pid);
    D.update('products', pid, { web_sync_status: p.web_publishable ? 'SYNCED' : 'NOT_PUBLISHED', web_synced_at: G.date.now() });
  }
  function webDialog(p) {
    drawer(`Publicación web · ${p.name}`, (bd, close) => {
      const vs = D.where('product_variants', v => v.product_id === p.id);
      bd.appendChild(form({ id: 'catw', values: Object.assign({}, p), submitLabel: canWeb() ? 'Guardar' : false, onCancel: close,
        fields: [{ key: 'web_title', label: 'Título en la tienda', span: 2 }, { key: 'web_description', label: 'Descripción', type: 'textarea' }, { key: 'image_url', label: 'Imagen (ruta en INT/archivos)', span: 2 }, ...vs.map(v => ({ key: 'wv_' + v.id, label: `Publicar ${v.name}`, type: 'checkbox' }))],
        values: Object.assign({}, p, Object.fromEntries(vs.map(v => ['wv_' + v.id, !!v.web_publishable]))),
        onSubmit: vals => {
          need('cat.product.publish_web', 'RN-CAT-09');
          for (const v of vs) if (!!vals['wv_' + v.id] !== !!v.web_publishable) { if (vals['wv_' + v.id] && sanitaryState(p).code === 'EXPIRED') return 'RN-CAT-09: el registro sanitario está vencido: no se publica.'; D.update('product_variants', v.id, { web_publishable: !!vals['wv_' + v.id] }); }
          D.update('products', p.id, { web_title: vals.web_title, web_description: vals.web_description, image_url: vals.image_url, web_sync_status: p.web_publishable ? 'PENDING' : p.web_sync_status });
          emit('product.changed', { product_id: p.id, web: true });
          close(); toast('Datos web guardados: pendiente de envío', 'ok'); G.refresh(); return true;
        } }));
    }, { code: 'CAT-09' });
  }

  /* ---------- CAT-10 Registros sanitarios ---------- */
  function renderSanitary(el) {
    const alert = G.param('cat_sanitary_alert_days');
    const body = page(el, { code: 'CAT-10', title: 'Registros sanitarios', sub: `Autoridad, número y vencimiento con semáforo a ${alert}, 30 y 0 días. SENASA para carne fresca; DIGESA para industrializados y envasados (D-CAT-04, provisional).` });
    const rows = G.scope.filter(D.all('products')).filter(p => p.sanitary_authority && p.sanitary_authority !== 'NONE').map(p => Object.assign({ _s: sanitaryState(p) }, { p }));
    const n = c => rows.filter(r => r._s.code === c).length;
    body.appendChild(kpis([
      { label: 'Vigentes', value: F.num(n('OK')), tone: 'ok' }, { label: `Ámbar (≤ ${alert} días)`, value: F.num(n('AMBER')), tone: 'warn' },
      { label: 'Rojo (≤ 30 días)', value: F.num(n('RED')), tone: 'bad' }, { label: 'Vencidos o sin registro', value: F.num(n('EXPIRED') + n('MISSING')), tone: 'bad', sub: 'No se publican en la web (RN-CAT-09)' },
    ]));
    const order = { EXPIRED: 0, MISSING: 1, RED: 2, AMBER: 3, OK: 4 };
    body.appendChild(table({ id: 'cat10', rows: rows.sort((a, b) => order[a._s.code] - order[b._s.code] || (a._s.days ?? 0) - (b._s.days ?? 0)), onRow: r => sanitaryDialog(r.p),
      filters: [{ key: 'auth', label: 'Autoridad', options: AUTH.slice(0, 2), value: r => r.p.sanitary_authority }, { key: 'sem', label: 'Semáforo', options: [['OK', 'Vigente'], ['AMBER', 'Ámbar'], ['RED', 'Rojo'], ['EXPIRED', 'Vencido'], ['MISSING', 'Sin registro']], value: r => r._s.code }, G.ctx.brand === 'ALL' ? { key: 'brand', label: 'Marca', options: brandOpts(), value: r => r.p.brand_id } : null].filter(Boolean),
      columns: [
        { key: 'code', label: 'Código', mono: true, value: r => r.p.code }, { key: 'name', label: 'Producto', value: r => r.p.name },
        { key: 'brand', label: 'Marca', value: r => G.brandName(r.p.brand_id) }, { key: 'auth', label: 'Autoridad', value: r => r.p.sanitary_authority },
        { key: 'reg', label: 'Número de registro', mono: true, value: r => r.p.sanitary_registry || '—' },
        { key: 'exp', label: 'Vence', value: r => r.p.sanitary_registry_expires || '', render: r => F.date(r.p.sanitary_registry_expires) },
        { key: 'days', label: 'Días', align: 'r', value: r => r._s.days ?? -9999, render: r => r._s.days == null ? '—' : F.num(r._s.days) },
        { key: 'sem', label: 'Semáforo', value: r => order[r._s.code], render: r => badge(r._s.label, r._s.tone) },
        { key: 'cert', label: 'Certificado', value: r => r.p.sanitary_certificate || '—' },
        { key: 'st', label: 'Estado', render: r => status(r.p.status), value: r => r.p.status },
      ] }));
  }
  function sanitaryDialog(p) {
    drawer(`Registro sanitario · ${p.name}`, (bd, close) => {
      const s = sanitaryState(p);
      bd.appendChild(dl([['Autoridad', p.sanitary_authority], ['Número actual', p.sanitary_registry], ['Vence', F.date(p.sanitary_registry_expires)], ['Semáforo', badge(s.label, s.tone)], ['Certificado', p.sanitary_certificate || '—'], ['Estado del producto', status(p.status)]]));
      if (!canSanitary()) { bd.appendChild(notice(`Tu rol (${G.roleName()}) solo consulta: renovar exige cat.sanitary.manage.`, 'info')); return; }
      let fileName = p.sanitary_certificate || null;
      const file = h('input', { type: 'file', class: 'input', attrs: { accept: '.pdf,.jpg,.png', 'aria-label': 'Certificado' }, on: { change: e => { fileName = e.target.files[0] ? e.target.files[0].name : fileName; } } });
      bd.appendChild(card('Registrar o renovar', h('div', { class: 'stack' }, form({ id: 'catsan', values: { sanitary_registry: p.sanitary_registry, sanitary_registry_expires: p.sanitary_registry_expires, sanitary_authority: p.sanitary_authority, activate: p.status !== 'ACTIVE' }, submitLabel: 'Guardar registro', onCancel: close,
        fields: [{ key: 'sanitary_authority', label: 'Autoridad', type: 'select', options: AUTH.slice(0, 2), required: true }, { key: 'sanitary_registry', label: 'Número de registro', required: true }, { key: 'sanitary_registry_expires', label: 'Vence', type: 'date', required: true }, p.status !== 'ACTIVE' ? { key: 'activate', label: 'Activar el producto', type: 'checkbox' } : null].filter(Boolean),
        onSubmit: vals => {
          need('cat.sanitary.manage', 'RN-CAT-09');
          if (vals.sanitary_registry_expires <= G.TODAY) return 'RN-CAT-09: la fecha de vencimiento ya pasó: registra la renovación vigente.';
          D.update('products', p.id, { sanitary_authority: vals.sanitary_authority, sanitary_registry: vals.sanitary_registry, sanitary_registry_expires: vals.sanitary_registry_expires, sanitary_certificate: fileName, status: vals.activate ? 'ACTIVE' : p.status });
          emit('product.changed', { product_id: p.id, sanitary: true });
          close(); toast('Registro sanitario actualizado', 'ok'); G.refresh(); return true;
        } }), h('label', { class: 'small muted' }, 'Adjunto del certificado (PDF o imagen)'), file)));
    }, { code: 'CAT-10' });
  }

  /* ---------- CAT-11 Etiquetas de balanza ---------- */
  function renderScale(el) {
    const L = layout();
    const body = page(el, { code: 'CAT-11', title: 'Etiquetas de balanza', sub: 'Formato EAN-13 con prefijo 2: posición del PLU y del valor (peso en gramos o precio en céntimos) y prueba de lectura de una etiqueta (RN-CAT-12). D-CAT-02: peso en gramos y PLU de 5 dígitos (provisional).' });
    const testOut = h('div', { class: 'stack' });
    const testRead = code => {
      const r = parseScaleBarcode(code);
      G.ui.clear(testOut);
      if (!r.ok) { testOut.appendChild(notice(r.error, 'bad')); return; }
      const v = r.variant ? vari(r.variant) : null; const pr = v ? priceFor(v.id, { channel: 'COUNTER' }) : null;
      testOut.appendChild(notice('Lectura válida · dígito de control EAN-13 correcto.', 'ok'));
      testOut.appendChild(dl([['PLU', h('span', { class: 'mono' }, r.plu)], ['Variante', v ? `${v.sku} · ${v.name}` : 'Ningún producto activo tiene este PLU'], [r.value_type === 'WEIGHT_G' ? 'Peso' : 'Importe', r.value_type === 'WEIGHT_G' ? F.kg(r.weight_kg, 3) : F.money(r.amount)],
        ['Precio mostrador', pr ? F.money(pr.price) + '/kg' : '—'], ['Importe', pr && r.weight_kg != null ? F.money(R(r.weight_kg * pr.price)) : '—'],
        ['Rango de peso', v && v.min_weight_kg ? `${F.kg(v.min_weight_kg, 3)} – ${F.kg(v.max_weight_kg, 3)} por unidad (RN-CAT-03)` : '—']]));
      if (v && v.sale_mode === 'UNIT_VARIABLE_WEIGHT' && r.weight_kg != null && (r.weight_kg < v.min_weight_kg || r.weight_kg > v.max_weight_kg)) testOut.appendChild(notice(`RN-CAT-03: ${F.kg(r.weight_kg, 3)} está fuera del rango por unidad: el mostrador pide confirmación (RN-POS-04).`, 'warn'));
    };
    const inp = h('input', { class: 'input mono', value: '2012345012509', attrs: { 'aria-label': 'Código de la etiqueta', inputmode: 'numeric' } });
    const plus = D.where('product_variants', v => v.scale_plu && v.status === 'ACTIVE');
    const genOut = h('div', { class: 'stack' });
    const gen = vals => { const v = vari(vals.variant_id); if (!v) return; const code = buildScaleBarcode(v.scale_plu, Number(vals.kg) || 0); const pr = priceFor(v.id, { channel: 'COUNTER' });
      G.ui.clear(genOut).appendChild(h('div', { class: 'label-card', style: 'max-width:300px' }, h('b', null, v.name), h('div', { class: 'small' }, `${G.brandFull(v.brand_id)} · PLU ${v.scale_plu}`), h('div', { class: 'row between' }, h('span', null, F.kg(Number(vals.kg), 3)), h('b', null, pr ? F.money(R(Number(vals.kg) * pr.price)) : '—')), h('div', { class: 'small muted' }, pr ? `${F.money(pr.price)}/kg · envasado ${F.date(G.TODAY)}` : ''), ean13Svg(code)));
      inp.value = code; };
    body.appendChild(h('div', { class: 'grid c2' },
      card('Formato vigente (cat_scale_barcode_layout)', form({ id: 'catlay', values: Object.assign({}, L, { reason: '' }), submitLabel: G.can('cat.product.manage') ? 'Guardar formato' : false,
        fields: [{ key: 'prefix', label: 'Prefijo', required: true }, { key: 'value_type', label: 'Valor', type: 'select', options: [['WEIGHT_G', 'Peso en gramos'], ['PRICE_CENTS', 'Precio en céntimos']], required: true },
          { key: 'plu_start', label: 'PLU: posición (desde 1)', type: 'number', min: 1, max: 12, required: true }, { key: 'plu_len', label: 'PLU: largo', type: 'number', min: 1, max: 6, required: true },
          { key: 'value_start', label: 'Valor: posición', type: 'number', min: 1, max: 12, required: true }, { key: 'value_len', label: 'Valor: largo', type: 'number', min: 1, max: 6, required: true },
          { key: 'reason', label: 'Motivo del cambio', required: true, span: 2 }],
        onSubmit: vals => { need('cat.product.manage', 'RN-CAT-12'); const nl = { prefix: String(vals.prefix), plu_start: Number(vals.plu_start), plu_len: Number(vals.plu_len), value_start: Number(vals.value_start), value_len: Number(vals.value_len), value_type: vals.value_type };
          if (nl.plu_start - 1 + nl.plu_len > nl.value_start - 1 && nl.value_start - 1 + nl.value_len > nl.plu_start - 1) return 'El PLU y el valor se superponen en el código.';
          if (nl.value_start - 1 + nl.value_len > 12 || nl.plu_start - 1 + nl.plu_len > 12) return 'El PLU y el valor deben caber en los primeros 12 dígitos (el 13.º es el control).';
          G.setParam('cat_scale_barcode_layout', nl, vals.reason); toast('Formato guardado', 'ok'); G.refresh(); return true; } })),
      card('Prueba de lectura', h('div', { class: 'stack' }, h('div', { class: 'row' }, inp, btn('Leer etiqueta', () => testRead(inp.value), { kind: 'primary' })), testOut))));
    body.appendChild(card('Generar etiqueta de prueba', h('div', { class: 'grid c2' }, form({ id: 'catgen', values: { variant_id: (plus[0] || {}).id, kg: 0.965 }, submitLabel: 'Generar',
      fields: [{ key: 'variant_id', label: 'Variante con PLU', type: 'select', options: plus.map(v => [v.id, `${v.scale_plu} · ${v.name}`]), required: true }, { key: 'kg', label: 'Peso (kg)', type: 'number', step: 0.001, min: 0.001, max: 99.999, required: true }],
      onSubmit: vals => { gen(vals); testRead(inp.value); return true; } }), genOut)));
    body.appendChild(card('Variantes con PLU de balanza', table({ id: 'cat11', rows: plus, search: true, pageSize: 10, columns: [{ key: 'scale_plu', label: 'PLU', mono: true }, { key: 'sku', label: 'SKU', mono: true }, { key: 'name', label: 'Variante' }, { key: 'sale_mode', label: 'Modo', value: v => G.saleModeName(v.sale_mode) }, { key: 'brand', label: 'Marca', value: v => G.brandName(v.brand_id) }] }), { flush: true }));
    testRead(inp.value);
  }

  /* ---------- CAT-12 Historial de precios ---------- */
  function renderHistory(el) {
    const body = page(el, { code: 'CAT-12', title: 'Historial de precios', sub: 'Cambios de precio por variante y lista con usuario, fecha y precio anterior. Cada vigencia cerrada queda como historia; nada se sobreescribe.' });
    const lists = new Map(G.scope.filter(D.all('price_lists')).map(l => [l.id, l]));
    const items = D.where('price_list_items', x => lists.has(x.list_id));
    const groups = U.groupBy(items, x => x.list_id + '|' + x.variant_id + '|' + (Number(x.min_qty) || 0));
    const rows = [];
    for (const g of Object.values(groups)) { g.sort(U.by('valid_from')); g.forEach((x, i) => { const prev = i ? g[i - 1] : null; rows.push({ x, prev, list: lists.get(x.list_id), v: vari(x.variant_id), change: prev ? R((x.price - prev.price) / prev.price * 100, 1) : null }); }); }
    const changes = rows.filter(r => r.prev);
    body.appendChild(kpis([
      { label: 'Cambios registrados', value: F.num(changes.length) },
      { label: 'Cambios este mes', value: F.num(changes.filter(r => G.date.month(r.x.valid_from) === G.date.month(G.TODAY)).length) },
      { label: 'Programados', value: F.num(rows.filter(r => r.x.valid_from > G.TODAY).length) },
      { label: 'Variación promedio', value: changes.length ? F.pct(U.sum(changes, r => r.change) / changes.length, 1) : '—' },
    ]));
    body.appendChild(table({ id: 'cat12', rows: rows.sort((a, b) => String(b.x.valid_from).localeCompare(String(a.x.valid_from)) || String(b.x.created_at).localeCompare(String(a.x.created_at))),
      filters: [{ key: 'list', label: 'Lista', options: [...lists.values()].map(l => [l.id, l.name]), value: r => r.x.list_id }, { key: 'kind', label: 'Tipo', options: [['CHANGE', 'Cambio de precio'], ['FIRST', 'Precio inicial']], value: r => r.prev ? 'CHANGE' : 'FIRST' }],
      columns: [
        { key: 'from', label: 'Vigente desde', value: r => r.x.valid_from, render: r => F.date(r.x.valid_from) },
        { key: 'sku', label: 'SKU', mono: true, value: r => r.v ? r.v.sku : '—' }, { key: 'v', label: 'Variante', value: r => r.v ? r.v.name : '—' },
        { key: 'list', label: 'Lista', value: r => r.list.name },
        { key: 'prev', label: 'Precio anterior', align: 'r', value: r => r.prev ? r.prev.price : null, render: r => r.prev ? h('span', { class: 'nowrap' }, F.money(r.prev.price)) : '—' },
        { key: 'price', label: 'Precio', align: 'r', value: r => r.x.price, render: r => h('b', { class: 'num nowrap' }, F.money(r.x.price)) },
        { key: 'change', label: 'Cambio', align: 'r', render: r => r.change == null ? '—' : badge((r.change > 0 ? '+' : '') + F.num(r.change, 1) + ' %', r.change > 0 ? 'warn' : 'ok') },
        { key: 'to', label: 'Hasta', value: r => r.x.valid_to || '', render: r => r.x.valid_to ? F.date(r.x.valid_to) : 'Sin fin' },
        { key: 'user', label: 'Usuario', value: r => r.x.created_by || '—' },
        { key: 'at', label: 'Registrado', value: r => r.x.created_at, render: r => F.datetime(r.x.created_at) },
        { key: 'reason', label: 'Motivo', value: r => r.x.reason || '—' },
      ] }));
  }

  /* =====================================================================
     Registro del módulo
     ===================================================================== */
  const SC = G.SPEC.CAT.screens;
  const nm = code => (SC.find(s => s[0] === code) || [code, code])[1];
  G.register({ code: 'CAT', name: 'Catálogo y listas de precio', phase: 1, group: 'Ventas y canales', screens: [
    { code: 'CAT-01', name: nm('CAT-01'), render: renderProducts },
    { code: 'CAT-02', name: nm('CAT-02'), render: renderProduct },
    { code: 'CAT-03', name: nm('CAT-03'), render: renderVariants },
    { code: 'CAT-04', name: nm('CAT-04'), render: renderCuts },
    { code: 'CAT-05', name: nm('CAT-05'), render: renderLists },
    { code: 'CAT-06', name: nm('CAT-06'), render: renderListItems },
    { code: 'CAT-07', name: nm('CAT-07'), render: renderSimulator },
    { code: 'CAT-08', name: nm('CAT-08'), render: renderCombos },
    { code: 'CAT-09', name: nm('CAT-09'), render: renderWeb },
    { code: 'CAT-10', name: nm('CAT-10'), render: renderSanitary },
    { code: 'CAT-11', name: nm('CAT-11'), render: renderScale },
    { code: 'CAT-12', name: nm('CAT-12'), render: renderHistory },
  ] });

  /* ---------- búsqueda, escáner y alertas ---------- */
  G.searchProviders.push(q => {
    const s = String(q || '').toLowerCase(); if (s.length < 2 || !G.canSee('CAT')) return [];
    const out = [];
    for (const v of D.all('product_variants')) { if (out.length >= 6) break; if (v.sku.toLowerCase().includes(s) || v.name.toLowerCase().includes(s) || String(v.barcode || '').includes(s)) out.push({ label: `${v.sku} · ${v.name}`, sub: `Variante · ${G.brandName(v.brand_id)} · ${priceLabel(v.id) || 'sin precio WhatsApp'}`, go: () => G.go('CAT-02', { id: v.product_id }) }); }
    for (const p of D.all('products')) { if (out.length >= 8) break; if (p.name.toLowerCase().includes(s) || p.code.toLowerCase().includes(s)) out.push({ label: p.name, sub: `Producto ${p.code} · ${G.brandName(p.brand_id)}`, go: () => G.go('CAT-02', { id: p.id }) }); }
    return out;
  });
  G.scanHandlers.push(code => {
    const c = String(code || '').trim().toUpperCase();
    const v = D.find('product_variants', x => x.sku === c || (x.barcode && x.barcode === c));
    if (v) return () => { G.go('CAT-02', { id: v.product_id }); toast(`${v.sku} · ${v.name}`, 'info'); };
    if (/^\d{13}$/.test(c) && c.startsWith(String(layout().prefix))) {
      const r = parseScaleBarcode(c);
      if (r.ok && r.variant) return () => { const vv = vari(r.variant); G.go('CAT-02', { id: vv.product_id }); toast(`Etiqueta de balanza: ${vv.name} · ${F.kg(r.weight_kg, 3)}`, 'info'); };
    }
    return null;
  });
  G.alertProviders.push(() => {
    const ps = D.where('products', p => p.status === 'ACTIVE' && ['EXPIRED', 'RED'].includes(sanitaryState(p).code));
    return ps.length ? [{ module: 'CAT', title: `${ps.length} registro(s) sanitario(s) vencido(s) o por vencer en 30 días`, detail: ps.slice(0, 3).map(p => `${p.name} (${sanitaryState(p).label})`).join(', ') + ' · RN-CAT-09', tone: ps.some(p => sanitaryState(p).code === 'EXPIRED') ? 'bad' : 'warn', go: () => G.go('CAT-10') }] : [];
  });
  // lot.blocked (ALM): solo alerta en CAT-01; el producto no cambia
  G.events.on('lot.blocked', p => { const l = p && p.lot_id && D.get('lots', p.lot_id); if (l) G.notify({ role: 'ADMINISTRACION', title: `Lote ${l.code} bloqueado`, body: `${G.variantName(l.variant_id)}: se muestra en CAT-01; el producto sigue activo.`, module: 'CAT', tone: 'warn' }); });

  /* =====================================================================
     Datos de ejemplo (orden 20)
     ===================================================================== */
  G.seed(20, function seedCatalogo() {
    const ins = (t, r) => D.insert(t, r, { silent: true });
    // tipos de corte
    const CUTS = [['ENTERO', 'Entero', ['CUY', 'CONEJO', 'AVES', 'CORDERO']], ['MITADES', 'En mitades', ['CUY', 'AVES']], ['SIN_CAB_PAT', 'Sin cabeza y sin patas', ['CUY', 'CONEJO']], ['DESHUESADO', 'Deshuesado', ['CUY', 'CONEJO', 'AVES', 'CORDERO', 'CERDO']],
      ['SEMIDESHUESADO', 'Semideshuesado', ['CUY', 'CONEJO']], ['TROZADO', 'Trozado en presas', ['CONEJO', 'AVES', 'CORDERO']], ['SIN_PIEL', 'Sin piel', ['AVES', 'CONEJO']], ['PECHUGA', 'Pechuga', ['AVES']], ['PIERNA', 'Pierna', ['CORDERO', 'CERDO']],
      ['COSTILLAR', 'Costillar', ['CORDERO', 'CERDO', 'RES']], ['MOLIDA', 'Molida', ['RES', 'CERDO']], ['PORCIONADO', 'Porcionado al vacío', ['CERDO', 'RES', 'CORDERO']], ['FILETE', 'Filete', ['RES', 'CERDO', 'AVES']], ['AHUMADO', 'Ahumado', ['CERDO', 'EMBUTIDOS']],
      ['ENVASADO', 'Presentación envasada', ['CALDOS', 'EMBUTIDOS', 'MANTECA', 'ABARROTES', 'CAFE', 'FRUTOS_SECOS', 'MERMELADAS', 'INFUSIONES', 'COMBOS']]];
    CUTS.forEach(([code, name, lines], i) => ins('cut_types', { id: 'ct-' + code, code, name, applies_to_lines: lines, sort_order: (i + 1) * 10, status: 'ACTIVE' }));
    const cutOf = { 'DG-CUY-ENT': 'ENTERO', 'DG-CUY-MIT': 'MITADES', 'DG-CUY-DES': 'DESHUESADO', 'DG-CUY-CNG': 'ENTERO', 'DG-CON-ENT': 'ENTERO', 'DG-CON-TRZ': 'TROZADO', 'DG-POL-ENT': 'ENTERO', 'DG-POL-PEC': 'PECHUGA', 'DG-PAT-ENT': 'ENTERO', 'DG-GAL-ENT': 'ENTERO', 'DG-COR-PIE': 'PIERNA', 'DG-COR-COS': 'COSTILLAR', 'M2-BON-KG': 'PORCIONADO', 'M2-PAN-KG': 'PORCIONADO', 'M2-PAN-AHU': 'AHUMADO', 'M2-LOM-KG': 'FILETE', 'M2-ASA-KG': 'COSTILLAR', 'M2-CHU-KG': 'PORCIONADO' };
    ins('product_categories', { id: 'pc-COMBOS', code: 'COMBOS', name: 'Combos y packs', line: 'COMBOS' });
    // productos: datos web, SUNAT, descuento y registro sanitario
    for (const p of D.all('products')) {
      const sale = isSaleType(p);
      Object.assign(p, { sunat_product_code: SUNAT_CODES[p.line] || null, allow_discount: !['LOMO'].includes(p.code), sanitary_alert_days: null, web_title: sale ? `${p.name} · ${G.brandName(p.brand_id)}` : null, web_description: sale ? `${p.name} de ${G.brandName(p.brand_id)}. ${lab(STORAGE, p.storage)}; vida útil ${p.shelf_life_days} días.` : null, image_url: sale ? `productos/${p.code.toLowerCase()}.jpg` : null, web_sync_status: sale && p.web_publishable ? 'SYNCED' : 'NOT_PUBLISHED', web_synced_at: sale && p.web_publishable ? '2026-10-09T22:00' : null, sanitary_certificate: p.sanitary_registry ? `cert-${p.code.toLowerCase()}.pdf` : null });
    }
    const P = id => D.get('products', id);
    Object.assign(P('pr-MERM'), { sanitary_registry_expires: G.date.add(G.TODAY, 60) }); // ámbar (CA-CAT-05)
    Object.assign(P('pr-JAMO'), { sanitary_registry_expires: G.date.add(G.TODAY, 21) }); // rojo: por vencer
    Object.assign(P('pr-INFU'), { sanitary_registry_expires: '2026-10-05', web_publishable: false, web_sync_status: 'REMOVED', web_synced_at: '2026-10-05T23:00' }); // vencido: retirado de la web
    Object.assign(P('pr-CAFE'), { web_sync_status: 'PENDING', web_title: 'Café de altura Villa Rica · tostado medio' });
    // producto DIGESA sin registro: no se puede activar (RN-CAT-09)
    ins('products', { id: 'pr-PATE', brand_id: 'br-DG', category_id: 'pc-EMBUTIDOS', code: 'PATE', name: 'Paté de cuy', line: 'EMBUTIDOS', product_type: 'GOODS', origin: 'PRODUCED', storage: 'CHILLED', shelf_life_days: 30, requires_lot: true, igv_affectation: '10', sunat_product_code: '50112004', sanitary_authority: 'DIGESA', sanitary_registry: null, sanitary_registry_expires: null, status: 'INACTIVE', web_publishable: false, web_sync_status: 'NOT_PUBLISHED', allow_discount: true, sanitary_alert_days: null });
    let plu = Math.max(...D.all('product_variants').map(v => Number(v.scale_plu) || 0)) + 1;
    ins('product_variants', { id: 'va-DG-PATE-180', product_id: 'pr-PATE', brand_id: 'br-DG', sku: 'DG-PATE-180', name: 'Paté de cuy 180 g', barcode: '7750000180189', uom_id: 'um-NIU', sale_mode: 'UNIT', status: 'INACTIVE', web_publishable: false, min_order_qty: 1, qty_step: 1, std_cost: 6.4, sellable: true, line: 'EMBUTIDOS', cut_type_id: 'ct-ENVASADO' });
    // conejo deshuesado (CA-CAT-02)
    ins('product_variants', { id: 'va-DG-CON-DES', product_id: 'pr-CON-ENT', brand_id: 'br-DG', sku: 'DG-CON-DES', name: 'Conejo deshuesado al vacío', barcode: '775' + U.pad(plu * 7 % 1000000000, 10), uom_id: 'um-KGM', sale_mode: 'KG', nominal_weight_kg: null, weight_tolerance_pct: 5, min_weight_kg: null, max_weight_kg: null, scale_plu: String(plu), status: 'ACTIVE', web_publishable: true, min_order_qty: 0.5, qty_step: 0.25, std_cost: 30.5, sellable: true, line: 'CONEJO' });
    plu++;
    for (const v of D.all('product_variants')) {
      if (!v.cut_type_id) v.cut_type_id = cutOf[v.sku] ? 'ct-' + cutOf[v.sku] : (v.sellable && v.sale_mode === 'UNIT' ? 'ct-ENVASADO' : v.id === 'va-DG-CON-DES' ? null : null);
      if (v.id === 'va-DG-CON-DES') v.cut_type_id = 'ct-DESHUESADO';
    }
    // frutos secos a granel en múltiplos de 0,25 kg (RN-CAT-07)
    const pAlm = P('pr-ALME');
    ins('product_variants', { id: 'va-M5-ALM-GRA', product_id: pAlm.id, brand_id: 'br-M5', sku: 'M5-ALM-GRA', name: 'Almendras tostadas a granel', barcode: '775' + U.pad(plu * 7 % 1000000000, 10), uom_id: 'um-KGM', sale_mode: 'KG', weight_tolerance_pct: 3, scale_plu: String(plu), status: 'ACTIVE', web_publishable: true, min_order_qty: 0.25, qty_step: 0.25, std_cost: 46, sellable: true, line: 'FRUTOS_SECOS', cut_type_id: 'ct-ENVASADO' });
    plu++;
    // listas: prioridad, tipos de cliente y vigencia
    for (const l of D.all('price_lists')) Object.assign(l, { priority: l.priority ?? 100, customer_types: l.customer_types || [], valid_to: l.valid_to || null, currency: 'PEN' });
    for (const it of D.all('price_list_items')) Object.assign(it, { min_qty: it.min_qty || 0, created_by: it.created_by || 'Carga inicial', created_at: it.valid_from + 'T08:00' });
    const add = (list, vid, price, from, to, by, reason, prev) => ins('price_list_items', { id: `pll-${list.slice(3)}-${vid.slice(3)}-${from.replace(/-/g, '')}`, list_id: list, variant_id: vid, price, basis: (vari(vid) || {}).sale_mode === 'UNIT' ? 'UNIT' : 'KG', min_qty: 0, valid_from: from, valid_to: to || null, created_by: by || 'Carmen Huamán Soto', created_at: from + 'T09:15', reason: reason || null, previous_price: prev || null });
    // WhatsApp Lima (CA-CAT-01): misma tabla de precios que el público (D-CAT-03), prioridad 90
    ins('price_lists', { id: 'pl-DG-WA', code: 'DG-WA', name: 'WhatsApp Lima · Don Guando', brand_id: 'br-DG', channels: ['WHATSAPP'], customer_types: [], includes_igv: true, currency: 'PEN', priority: 90, status: 'ACTIVE', valid_from: '2026-08-01', valid_to: null });
    for (const it of D.where('price_list_items', x => x.list_id === 'pl-DG-PUB' && !x.valid_to)) add('pl-DG-WA', it.variant_id, it.price, '2026-08-01', null, 'Carga inicial', 'Lista por canal (D-CAT-03)');
    // conejo deshuesado y almendras a granel en las listas
    add('pl-DG-PUB', 'va-DG-CON-DES', 48, '2026-07-01', null, 'Carga inicial'); add('pl-DG-WA', 'va-DG-CON-DES', 48, '2026-08-01', null, 'Carga inicial'); add('pl-DG-B2B', 'va-DG-CON-DES', 43.2, '2026-07-01', null, 'Carga inicial');
    add('pl-M5-PUB', 'va-M5-ALM-GRA', 84, '2026-07-01', null, 'Carga inicial'); add('pl-M5-B2B', 'va-M5-ALM-GRA', 75.6, '2026-07-01', null, 'Carga inicial');
    // Restaurantes (CA-CAT-02): prioridad 50, solo restaurantes, cualquier canal
    ins('price_lists', { id: 'pl-DG-RES', code: 'DG-RES', name: 'Restaurantes · Don Guando', brand_id: 'br-DG', channels: [], customer_types: ['RESTAURANT'], includes_igv: true, currency: 'PEN', priority: 50, status: 'ACTIVE', valid_from: '2026-09-01', valid_to: null });
    add('pl-DG-RES', 'va-DG-CON-DES', 44, '2026-09-01', null, 'Patricia León Vera', 'Precio para restaurantes'); add('pl-DG-RES', 'va-DG-CUY-ENT', 39, '2026-09-01', null, 'Patricia León Vera', 'Precio para restaurantes'); add('pl-DG-RES', 'va-DG-CON-ENT', 29.5, '2026-09-01', null, 'Patricia León Vera', 'Precio para restaurantes');
    // tramo por volumen: café 250 g desde 6 unidades
    ins('price_list_items', { id: 'pll-M5-PUB-CAF250-V6', list_id: 'pl-M5-PUB', variant_id: 'va-M5-CAF-250', price: 29, basis: 'UNIT', min_qty: 6, valid_from: '2026-09-01', valid_to: null, created_by: 'Lucía Paredes Gil', created_at: '2026-09-01T10:00', reason: 'Precio por volumen (6 o más)' });
    // historia: pollo de corral 21 → 22 desde el 15/09 (PUB y WhatsApp)
    for (const [lid, from] of [['pl-DG-PUB', '2026-07-01'], ['pl-DG-WA', '2026-08-01']]) {
      const cur = D.find('price_list_items', x => x.list_id === lid && x.variant_id === 'va-DG-POL-ENT' && !x.valid_to);
      Object.assign(cur, { price: 21, valid_to: '2026-09-14', closed_by: 'Carmen Huamán Soto', closed_reason: 'Alza del proveedor avícola' });
      add(lid, 'va-DG-POL-ENT', 22, '2026-09-15', null, 'Carmen Huamán Soto', 'Alza del proveedor avícola', 21);
    }
    // historia: lomo fino 82 → 85 desde el 01/10 en la Marca 2
    { const cur = D.find('price_list_items', x => x.list_id === 'pl-M2-PUB' && x.variant_id === 'va-M2-LOM-KG' && !x.valid_to); Object.assign(cur, { price: 82, valid_to: '2026-09-30' }); add('pl-M2-PUB', 'va-M2-LOM-KG', 85, '2026-10-01', null, 'Rosa Quispe Huamán', 'Ajuste por costo de reposición', 82); }
    // programado: cuy entero en WhatsApp sube a 44 desde el 01/11
    { const cur = D.find('price_list_items', x => x.list_id === 'pl-DG-WA' && x.variant_id === 'va-DG-CUY-ENT' && !x.valid_to); Object.assign(cur, { valid_to: '2026-10-31' }); add('pl-DG-WA', 'va-DG-CUY-ENT', 44, '2026-11-01', null, 'Rosa Quispe Huamán', 'Temporada de fin de año', 42); }
    // borrador: campaña de Navidad de la Marca 5
    ins('price_lists', { id: 'pl-M5-NAV', code: 'M5-NAV', name: 'Navidad · Marca 5 (web y WhatsApp)', brand_id: 'br-M5', channels: ['WEB', 'WHATSAPP'], customer_types: [], includes_igv: true, currency: 'PEN', priority: 80, status: 'DRAFT', valid_from: '2026-12-01', valid_to: '2026-12-31' });
    for (const vid of ['va-M5-CAF-250', 'va-M5-MIX-200', 'va-M5-MER-AGU', 'va-M5-NUE-250']) { const it = D.find('price_list_items', x => x.list_id === 'pl-M5-PUB' && x.variant_id === vid && !x.valid_to && !x.min_qty); add('pl-M5-NAV', vid, R(it.price * 0.9, 1), '2026-12-01', '2026-12-31', 'Lucía Paredes Gil', 'Campaña de Navidad −10 %'); }
    // combos (RN-CAT-08)
    const combo = (id, br, code, name, vid, sku, price, cs) => {
      ins('products', { id, brand_id: br, category_id: 'pc-COMBOS', code, name, line: 'COMBOS', product_type: 'COMBO', origin: 'PRODUCED', storage: 'CHILLED', shelf_life_days: 5, requires_lot: false, igv_affectation: '10', sunat_product_code: '50112000', sanitary_authority: 'NONE', sanitary_registry: null, sanitary_registry_expires: null, status: 'ACTIVE', web_publishable: true, allow_discount: false, web_title: name, web_description: cs.map(c => `${c[1]} × ${G.variantName(c[0])}`).join(' + '), image_url: `productos/${code.toLowerCase()}.jpg`, web_sync_status: 'SYNCED', web_synced_at: '2026-10-09T22:00', sanitary_alert_days: null });
      ins('product_variants', { id: vid, product_id: id, brand_id: br, sku, name, barcode: '775' + U.pad(plu * 7 % 1000000000, 10), uom_id: 'um-NIU', sale_mode: 'UNIT', status: 'ACTIVE', web_publishable: true, min_order_qty: 1, qty_step: 1, std_cost: R(U.sum(cs, c => c[1] * ((vari(c[0]) || {}).std_cost || 0) * ((vari(c[0]) || {}).sale_mode === 'UNIT_VARIABLE_WEIGHT' ? (vari(c[0]) || {}).nominal_weight_kg : 1))), sellable: true, line: 'COMBOS', cut_type_id: 'ct-ENVASADO' });
      plu++;
      cs.forEach(([cv, q, pct]) => { const v = vari(cv); ins('combo_components', { id: `cc-${sku}-${v.sku}`, combo_variant_id: vid, component_variant_id: cv, qty: q, est_weight_kg: v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? R(q * v.nominal_weight_kg, 3) : v.sale_mode === 'KG' ? q : null, price_share_pct: pct }); });
      const b = br.slice(3);
      for (const [lid, from] of [[`pl-${b}-PUB`, '2026-09-01'], [`pl-${b}-B2B`, '2026-09-01']].concat(b === 'DG' ? [['pl-DG-WA', '2026-09-01']] : [])) add(lid, vid, /B2B/.test(lid) ? R(price * 0.9) : price, from, null, 'Lucía Paredes Gil', 'Alta de combo');
    };
    combo('pr-PACK-FAM', 'br-DG', 'PACK-FAM', 'Pack familiar', 'va-DG-PACK-FAM', 'DG-PACK-FAM', 82, [['va-DG-CUY-ENT', 1, 60], ['va-DG-CHO-500', 2, 30], ['va-DG-CAL-1L', 1, 10]]);
    combo('pr-PACK-PAR', 'br-M2', 'PACK-PAR', 'Pack parrillero', 'va-M2-PACK-PAR', 'M2-PACK-PAR', 95, [['va-M2-BON-KG', 1, 45], ['va-M2-ASA-KG', 1, 40], ['va-M2-PAN-AHU', 1, 15]]);
  }, 'catalogo');

  /* =====================================================================
     Pruebas de aceptación (una por CA-CAT-*)
     ===================================================================== */
  const T = (name, fn) => G.tests.push({ module: 'CAT', name, fn });
  const eq = (a, b, msg) => { if (Math.abs(Number(a) - Number(b)) > 0.0001) throw new Error(`${msg}: se esperaba ${b} y se obtuvo ${a}`); };
  const throwsCode = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y se obtuvo: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code}`); };
  T('CA-CAT-01: cuy entero peso variable 0,900 kg × 2 u a S/ 42,00/kg en «WhatsApp Lima» → 1,800 kg y S/ 75,60', async () => {
    const v = vari('va-DG-CUY-ENT');
    if (v.sale_mode !== 'UNIT_VARIABLE_WEIGHT' || v.nominal_weight_kg !== 0.9) throw new Error('El cuy entero no es de peso variable con 0,900 kg nominal');
    const prev = G.ctx.role; G.ctx.role = 'VENDEDORA';
    try {
      const o = G.orders.create({ customer_id: 'cu-0001', brand_id: 'br-DG', channel: 'WHATSAPP', lines: [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }] });
      const l = o.lines[0];
      if (l.price_list_id !== 'pl-DG-WA') throw new Error('El precio no salió de la lista WhatsApp Lima: ' + l.price_list_id);
      eq(l.unit_price, 42, 'Precio por kg'); eq(l.est_weight_kg, 1.8, 'Peso estimado'); eq(l.est_amount, 75.6, 'Importe estimado');
    } finally { G.ctx.role = prev; }
  });
  T('CA-CAT-02: conejo deshuesado: lista general (prioridad 100) S/ 48,00/kg y «Restaurantes» (prioridad 50) S/ 44,00/kg', async () => {
    const pub = D.find('price_list_items', x => x.list_id === 'pl-DG-PUB' && x.variant_id === 'va-DG-CON-DES' && !x.valid_to);
    if (D.get('price_lists', 'pl-DG-PUB').priority !== 100 || pub.price !== 48 || D.get('price_lists', 'pl-DG-RES').priority !== 50) throw new Error('Datos de partida distintos');
    const rest = priceFor('va-DG-CON-DES', { channel: 'WEB', customer_type: 'RESTAURANT' });
    const per = priceFor('va-DG-CON-DES', { channel: 'WEB', customer_type: 'PERSON' });
    eq(rest.price, 44, 'Precio para restaurante'); eq(per.price, 48, 'Precio para persona');
    if (rest.list_id !== 'pl-DG-RES' || per.list_id !== 'pl-DG-PUB') throw new Error('Listas elegidas incorrectas');
    // y por el servicio común con un cliente restaurante real
    const viaCore = G.price.of('va-DG-CON-DES', { brand_id: 'br-DG', channel: 'WEB', customer_id: 'cu-B001' });
    eq(viaCore.price, 44, 'G.price.of para El Cuy Dorado');
  });
  T('CA-CAT-03: precio vigente desde el 01/10 sin fin; otro desde el 15/10 sin cerrar el anterior → RN-CAT-06', async () => {
    addPrice({ list_id: 'pl-DG-PUB', variant_id: 'va-DG-CAL-500', price: 15, valid_from: '2026-10-01', closePrevious: true, reason: 'Prueba' });
    throwsCode(() => addPrice({ list_id: 'pl-DG-PUB', variant_id: 'va-DG-CAL-500', price: 16, valid_from: '2026-10-15' }), 'RN-CAT-06');
    const ok = addPrice({ list_id: 'pl-DG-PUB', variant_id: 'va-DG-CAL-500', price: 16, valid_from: '2026-10-15', closePrevious: true, reason: 'Cambio' });
    const prev = D.find('price_list_items', x => x.list_id === 'pl-DG-PUB' && x.variant_id === 'va-DG-CAL-500' && x.valid_from === '2026-10-01');
    if (prev.valid_to !== '2026-10-14' || !ok) throw new Error('No cerró la vigencia anterior el 14/10');
  });
  T('CA-CAT-04: etiqueta 2012345012509 → PLU 12345 y 1,250 kg; con el último dígito cambiado es inválida', async () => {
    const r = G.cat.parseScaleBarcode('2012345012509');
    if (!r.ok || r.plu !== '12345') throw new Error('PLU leído: ' + r.plu + ' ' + (r.error || ''));
    eq(r.weight_kg, 1.25, 'Peso');
    if (!ean13CheckOk('2012345012509')) throw new Error('El dígito de control debería ser válido');
    const bad = G.cat.parseScaleBarcode('2012345012508');
    if (bad.ok || !/RN-CAT-12/.test(bad.error)) throw new Error('La etiqueta alterada debería ser inválida');
    if (buildScaleBarcode('12345', 1.25) !== '2012345012509') throw new Error('El generador no reproduce la etiqueta');
  });
  T('CA-CAT-05: mermelada de la Marca 5 con DIGESA que vence en 60 días → ámbar en CAT-10; DIGESA sin número no se activa', async () => {
    const p = prod('pr-MERM');
    if (p.brand_id !== 'br-M5' || p.sanitary_authority !== 'DIGESA') throw new Error('La mermelada no es DIGESA de la Marca 5');
    if (p.sanitary_registry_expires !== G.date.add(G.TODAY, 60)) { D.update('products', p.id, { sanitary_registry_expires: G.date.add(G.TODAY, 60) }, { silent: true }); Object.assign(p, prod('pr-MERM')); } /* CAL siembra el DIGESA vencido el 30/09 (CA-CAL-07): esta prueba prepara su propio vencimiento a 60 días */
    const s = sanitaryState(p); if (s.code !== 'AMBER' || s.days !== 60) throw new Error('Semáforo esperado ámbar a 60 días: ' + s.code + ' ' + s.days);
    G.go('CAT-10'); await new Promise(r => setTimeout(r, 20));
    const txt = document.querySelector('.main').textContent; if (!/Vence en 60 días/.test(txt)) throw new Error('CAT-10 no muestra la mermelada en ámbar');
    const pate = prod('pr-PATE');
    throwsCode(() => saveProduct(Object.assign({}, pate, { status: 'ACTIVE' }), pate), 'RN-CAT-09');
  });
  T('CA-CAT-06: «Pack familiar» cuy 60 % + chorizo 1 kg 30 % + caldo 10 %; agregar otro combo → RN-CAT-08', async () => {
    const cs = comps('va-DG-PACK-FAM');
    const pct = Object.fromEntries(cs.map(c => [c.component_variant_id, c.price_share_pct]));
    if (pct['va-DG-CUY-ENT'] !== 60 || pct['va-DG-CHO-500'] !== 30 || pct['va-DG-CAL-1L'] !== 10) throw new Error('Reparto distinto al criterio');
    const cho = cs.find(c => c.component_variant_id === 'va-DG-CHO-500'); if (cho.qty * 0.5 !== 1) throw new Error('El chorizo no suma 1 kg');
    if (!comboCheck('va-DG-PACK-FAM').ok) throw new Error('El combo debería ser válido');
    throwsCode(() => addComboComponent('va-DG-PACK-FAM', { component_variant_id: 'va-M2-PACK-PAR', qty: 1, price_share_pct: 5 }), 'RN-CAT-08');
    const parts = explodeCombo('va-DG-PACK-FAM', 1, 82); eq(U.sum(parts, p => p.amount), 82, 'Reparto del precio');
  });
  T('CA-CAT-07: filtrar CAT-01 por la marca de café, frutos secos, mermeladas e infusiones → solo esas 4 líneas', async () => {
    const prev = G.ctx.brand; G.ctx.brand = 'br-M5';
    try {
      const lines = new Set(productRows('SALE').map(p => p.line));
      const want = ['CAFE', 'FRUTOS_SECOS', 'MERMELADAS', 'INFUSIONES'];
      if (lines.size !== 4 || !want.every(l => lines.has(l))) throw new Error('Líneas visibles: ' + [...lines].join(', '));
      G.go('CAT-01'); await new Promise(r => setTimeout(r, 20));
      if (/Bondiola|Cuy entero/.test(document.querySelector('.main').textContent)) throw new Error('CAT-01 muestra productos de otras marcas');
    } finally { G.ctx.brand = prev; }
  });
})();
