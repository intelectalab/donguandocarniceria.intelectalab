/* =====================================================================
   ETQ · Etiquetas, trazabilidad y retiro de lotes (fase 2)
   Plantillas por marca (RN-ETQ-03), impresión con peso real, precio y código
   de balanza 20+PLU+gramos (RN-ETQ-01/02/11/12), reimpresión con motivo
   (RN-ETQ-04), trazabilidad hacia atrás y adelante (RN-ETQ-05), retiro de
   lote con bloqueo de stock y lista de contacto (RN-ETQ-06/07/08/13) y página
   pública del QR (RN-ETQ-09/10).
   Expone G.etq.recall(...), G.etq.traceBackward/Forward, G.etq.publicLotPage(token).
   ===================================================================== */
(function () {
  const { h, btn, badge, status, page, card, table, kpis, dl, notice, drawer, modal, toast, tabs, form } = G.ui;
  const U = G.util, F = G.fmt;
  const R = (n, d = 2) => U.round(n, d);
  const nowIso = () => G.date.now().slice(0, 16);
  const run = (fn, ok) => { try { const r = fn(); if (ok) toast(ok, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); return null; } };
  const lot = id => G.db.get('lots', id);
  const lotByCode = c => G.db.find('lots', l => l.code === String(c || '').trim().toUpperCase());
  const prod = id => G.db.get('products', id);
  const REQUIRED = ['product', 'brand', 'net_weight', 'lot', 'production_date', 'expiry_date', 'sanitary_registry'];
  const NOPRINT = ['REJECTED', 'BLOCKED', 'RECALLED'];
  const RISK = [['CLASS_I', 'Clase I · riesgo grave para la salud'], ['CLASS_II', 'Clase II · riesgo moderado'], ['CLASS_III', 'Clase III · sin riesgo para la salud (etiqueta, peso)']];
  const CONTACT_ST = [['PENDING', 'Pendiente'], ['CONTACTED', 'Contactado'], ['RECOVERED', 'Recuperado'], ['NOT_REACHABLE', 'No ubicable']];
  const MY = { PENDING: ['Pendiente', 'warn'], CONTACTED: ['Contactado', 'info'], RECOVERED: ['Recuperado', 'ok'], NOT_REACHABLE: ['No ubicable', 'bad'], CLASS_I: ['Clase I', 'bad'], CLASS_II: ['Clase II', 'warn'], CLASS_III: ['Clase III', 'info'] };
  const sb = s => MY[s] ? badge(MY[s][0], MY[s][1]) : status(s);
  const STORAGE_TXT = { CHILLED: 'Mantener refrigerado entre 0 °C y 4 °C', FROZEN: 'Mantener congelado a −18 °C o menos. No recongelar', AMBIENT: 'Conservar en lugar fresco y seco. Refrigerar después de abrir' };
  const ALLERGENS = { EMBUTIDOS: 'Contiene: proteína de soya. Puede contener trazas de leche y mostaza', FRUTOS_SECOS: 'Contiene: frutos secos (almendra, nuez). Puede contener maní', CALDOS: 'Puede contener apio', MERMELADAS: 'Sin alérgenos declarados', CAFE: 'Sin alérgenos declarados' };
  const allergensOf = p => ALLERGENS[p.line] || 'Sin alérgenos declarados';
  const PRINTERS = [['IMP-L1-01', 'Zebra ZD421 · Local 1 (ZPL 100 × 50 mm)', 'es-L1', 'ZPL'], ['IMP-L2-01', 'Zebra ZD421 · Local 2 (ZPL 100 × 50 mm)', 'es-L2', 'ZPL'], ['BAL-L1-01', 'Balanza etiquetadora del mostrador (ESC/POS 58 mm)', 'es-L1', 'ESCPOS'], ['PDF', 'PDF (respaldo)', null, 'PDF']];
  const printerSite = code => (PRINTERS.find(p => p[0] === code) || [])[2] || null;

  /* ---------- pesos, precios y códigos ---------- */
  /** peso neto nominal de una presentación por unidad (500 g, 1 kg, 1 L) */
  function nominalKg(v) {
    if (!v) return null; if (v.nominal_weight_kg) return v.nominal_weight_kg;
    const m = /(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)\b/i.exec(v.name); if (!m) return null;
    const n = Number(m[1].replace(',', '.')); const u = m[2].toLowerCase();
    return u === 'g' || u === 'ml' ? n / 1000 : n;
  }
  const roundTo = (v, step) => R(Math.round(v / step + 1e-9) * step, 2);
  /** RN-ETQ-11: precio = precio por kg de la lista del canal × peso real, redondeado a etq_price_rounding */
  function priceFor(variantId, kg, channel = 'COUNTER') {
    const v = G.variant(variantId); const pr = G.price.of(variantId, { brand_id: v.brand_id, channel });
    if (!pr) return { price: null, per_kg: null };
    const step = Number(G.param('etq_price_rounding') ?? 0.1) || 0.1;
    if (pr.basis === 'KG') return { per_kg: pr.price, price: roundTo(pr.price * kg, step), basis: 'KG', list_id: pr.list_id };
    return { per_kg: kg ? R(pr.price / kg, 2) : null, price: pr.price, basis: 'UNIT', list_id: pr.list_id };
  }
  const ean13check = d12 => { let s = 0; for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1); return String((10 - s % 10) % 10); };
  /** código de balanza: 2 (peso variable) + 0 + PLU (5) + gramos (5) + dígito verificador */
  function scaleBarcode(plu, kg) { const d12 = '20' + U.pad(Number(plu) % 100000, 5) + U.pad(Math.round(kg * 1000) % 100000, 5); return d12 + ean13check(d12); }
  function decodeScale(code) { if (!/^20\d{11}$/.test(code) || ean13check(code.slice(0, 12)) !== code[12]) return null; const plu = String(Number(code.slice(2, 7))); const v = G.db.find('product_variants', x => x.scale_plu === plu); return v ? { variant: v, kg: Number(code.slice(7, 12)) / 1000 } : null; }
  const EAN = { L: ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'], G: ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'], P: ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'] };
  /** EAN-13 real en SVG */
  function barcodeSvg(code, w = 190, hgt = 44) {
    const s = G.ui.svg; const c = String(code);
    if (!/^\d{13}$/.test(c)) return h('span', { class: 'mono small' }, c);
    let bits = '101'; const par = EAN.P[Number(c[0])];
    for (let i = 1; i <= 6; i++) bits += EAN[par[i - 1]][Number(c[i])];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += EAN.L[Number(c[i])].split('').map(b => b === '1' ? '0' : '1').join('');
    bits += '101';
    const m = w / (bits.length + 14);
    const svg = s('svg', { viewBox: `0 0 ${w} ${hgt + 12}`, width: w, height: hgt + 12, role: 'img', 'aria-label': 'Código de barras ' + c });
    svg.appendChild(s('rect', { x: 0, y: 0, width: w, height: hgt + 12, fill: '#ffffff' }));
    for (let i = 0; i < bits.length; i++) if (bits[i] === '1') { const guard = i < 3 || (i >= 45 && i < 50) || i >= 92; svg.appendChild(s('rect', { x: (7 + i) * m, y: 2, width: m + 0.05, height: guard ? hgt + 4 : hgt, fill: '#111111' })); }
    svg.appendChild(s('text', { x: w / 2, y: hgt + 11, 'text-anchor': 'middle', 'font-size': 9, 'font-family': 'monospace', fill: '#111111' }, `${c[0]} ${c.slice(1, 7)} ${c.slice(7)}`));
    return svg;
  }

  /* ---------- QR público ---------- */
  function tokenFor(lotId, create = true) {
    let t = G.db.find('lot_qr_tokens', x => x.lot_id === lotId && x.status === 'ACTIVE');
    if (!t && create) t = G.db.insert('lot_qr_tokens', { lot_id: lotId, token: U.token(22), status: 'ACTIVE' }, { silent: true });
    return t;
  }
  const qrUrl = tok => (G.param('etq_public_base_url') || 'https://trazabilidad.aycha.pe/l/') + tok;

  /* ---------- genealogía (v_lot_genealogy) ---------- */
  /** aristas padre → hijo: consumos y producciones de PRO más el origen guardado en el lote */
  function genealogy() {
    const edges = [];
    const outs = U.groupBy(G.db.all('production_order_outputs').filter(o => o.lot_id), 'order_id');
    for (const c of G.db.all('production_order_consumptions')) for (const o of outs[c.order_id] || []) if (c.lot_id && o.lot_id !== c.lot_id) edges.push({ parent: c.lot_id, child: o.lot_id, kg: c.weight_kg || c.qty, order: (G.db.get('production_orders', c.order_id) || {}).number || null, date: (c.consumed_at || '').slice(0, 10) });
    for (const l of G.db.all('lots')) for (const p of l.parent_lots || []) edges.push({ parent: p.lot_id, child: l.id, kg: p.kg, order: p.order_ref || l.production_order_ref || null, date: l.production_date });
    const seen = new Set(); return edges.filter(e => { const k = e.parent + '>' + e.child; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  /** etq_trace_backward: todos los niveles hasta lotes de compra o granja (RN-ETQ-05) */
  function traceBackward(lotId, edges = genealogy(), seen = new Set()) {
    const l = lot(lotId); if (!l || seen.has(lotId)) return null; seen.add(lotId);
    const parents = edges.filter(e => e.child === lotId).map(e => Object.assign({ edge: e }, traceBackward(e.parent, edges, seen))).filter(x => x.lot);
    return { lot: l, parents, supplier_id: l.supplier_id || null, farm: isFarm(l) };
  }
  function descendants(lotId, edges = genealogy()) {
    const out = []; const q = [lotId]; const seen = new Set([lotId]);
    while (q.length) { const x = q.shift(); for (const e of edges.filter(y => y.parent === x)) if (!seen.has(e.child)) { seen.add(e.child); out.push({ lot_id: e.child, parent: x, kg: e.kg, order: e.order, date: e.date }); q.push(e.child); } }
    return out;
  }
  const lineKg = (variantId, qty, uom) => uom === 'KGM' ? qty : R(qty * (nominalKg(G.variant(variantId)) || 0), 3);
  /** pedidos, comprobantes y entregas en consignación con los lotes dados */
  function salesOfLots(ids) {
    const set = ids instanceof Set ? ids : new Set(ids); const out = []; const docOrderLot = new Set();
    for (const d of G.db.all('sales_documents')) {
      if (d.doc_type === 'CREDIT_NOTE' || d.status === 'VOIDED') continue;
      for (const ln of d.lines || []) if (ln.lot_id && set.has(ln.lot_id)) { out.push({ source: 'DOCUMENT', lot_id: ln.lot_id, customer_id: d.customer_id, sales_document_id: d.id, sales_order_id: d.order_id || null, date: d.issue_date, qty: ln.qty, weight_kg: lineKg(ln.variant_id, ln.qty, ln.uom_code), brand_id: d.brand_id }); if (d.order_id) docOrderLot.add(d.order_id + '|' + ln.lot_id); }
    }
    for (const o of G.db.all('sales_orders')) {
      if (['CANCELLED', 'DRAFT'].includes(o.status)) continue;
      for (const ln of o.lines || []) if (ln.lot_id && set.has(ln.lot_id) && !docOrderLot.has(o.id + '|' + ln.lot_id)) out.push({ source: 'ORDER', lot_id: ln.lot_id, customer_id: o.customer_id, sales_document_id: null, sales_order_id: o.id, date: o.delivery_date, qty: ln.qty, weight_kg: ln.weighed_kg ?? ln.est_weight_kg ?? lineKg(ln.variant_id, ln.qty, 'NIU'), brand_id: o.brand_id, status: o.status });
    }
    const dels = new Map(G.db.all('consignment_deliveries').map(d => [d.id, d]));
    for (const ln of G.db.all('consignment_delivery_lines')) if (set.has(ln.lot_id)) { const d = dels.get(ln.delivery_id); const pt = d && G.db.get('consignment_points', d.point_id); if (d && pt && d.status !== 'VOIDED') out.push({ source: 'CONSIGNMENT', lot_id: ln.lot_id, customer_id: pt.customer_id, sales_document_id: null, sales_order_id: null, consignment_delivery_id: d.id, date: d.delivery_date, qty: ln.qty, weight_kg: ln.weight_kg ?? lineKg(ln.variant_id, ln.qty, 'NIU') }); }
    return out;
  }
  /** etq_trace_forward: lotes derivados de todos los niveles y sus ventas */
  function traceForward(lotId) { const edges = genealogy(); const desc = descendants(lotId, edges); const ids = [lotId, ...desc.map(d => d.lot_id)]; return { descendants: desc, sales: salesOfLots(ids), lot_ids: ids }; }
  function isFarm(l) { return !!l && (l.origin === 'FARM' || l.supplier_id === 'su-GRANJA'); }
  /** RN-ETQ-10: origen enviado por la granja (especie, fecha de beneficio y granja), del lote o de su historia */
  function farmOrigin(lotId) {
    const edges = genealogy(); const q = [lotId]; const seen = new Set();
    while (q.length) {
      const id = q.shift(); if (seen.has(id)) continue; seen.add(id); const l = lot(id); if (!l) continue;
      if (isFarm(l)) {
        const fl = G.db.find('farm_dispatch_lines', x => x.lot_id === l.id);
        const o = (fl && fl.farm_origin && Object.keys(fl.farm_origin).length ? fl.farm_origin : null) || l.farm_origin || {};
        return { species: o.species || (prod(l.product_id) || {}).name, slaughter_date: o.slaughter_date || l.production_date, farm_name: o.farm_name || 'Granja Don Guando', lot_code: l.code };
      }
      for (const e of edges.filter(x => x.child === id)) q.push(e.parent);
    }
    return null;
  }
  /** public_lot_page(token): solo los campos permitidos; nunca precios, clientes ni costos (RN-ETQ-09) */
  function publicLotPage(token) {
    const t = G.db.find('lot_qr_tokens', x => x.token === token && x.status === 'ACTIVE');
    const l = t && lot(t.lot_id);
    if (!l || !['RELEASED', 'RECALLED'].includes(l.qc_status)) return { available: false, message: 'Este código no corresponde a un lote disponible.' };
    const v = G.variant(l.variant_id) || {}; const p = prod(l.product_id) || {}; const b = G.db.get('brands', p.brand_id) || {};
    const reg = G.cal && G.cal.currentReg ? G.cal.currentReg(p.id) : null;
    const out = { available: true, product: v.name || p.name, brand: b.name, brand_color: b.primary_color, lot: l.code, production_date: l.production_date, expiry_date: l.expiry_date, sanitary_authority: p.sanitary_authority !== 'NONE' ? p.sanitary_authority : null, sanitary_registry: reg ? reg.number : p.sanitary_registry, storage: STORAGE_TXT[p.storage] || '', allergens: allergensOf(p), recalled: l.qc_status === 'RECALLED', recall_notice: null, origin: farmOrigin(l.id) };
    if (out.recalled) { const rl = G.db.where('lot_recall_lots', x => x.lot_id === l.id).map(x => G.db.get('lot_recalls', x.recall_id)).filter(Boolean)[0]; out.recall_notice = `Este lote fue retirado del mercado${rl ? ' el ' + F.date(rl.initiated_at) : ''}. No lo consumas: escríbenos por WhatsApp y te lo reponemos o devolvemos tu dinero.`; }
    return out;
  }

  /* ---------- plantillas e impresión ---------- */
  const fieldsIn = body => [...new Set((String(body).match(/\{\{\s*([a-z_]+)\s*\}\}/g) || []).map(x => x.replace(/[{}\s]/g, '')))];
  /** RN-ETQ-03: campos obligatorios de una plantilla ACTIVE */
  function missingFields(body, includesQr) { const f = fieldsIn(body); return REQUIRED.concat(includesQr ? ['qr'] : []).filter(k => !f.includes(k)); }
  function saveTemplate(v, existing) {
    if (!G.can('etq.template.manage')) G.fail('RN-ETQ-03', 'Editar plantillas exige el permiso etq.template.manage.');
    if (!v.brand_id || !String(v.code || '').trim() || !String(v.body || '').trim()) G.fail('RN-ETQ-03', 'Marca, código y cuerpo son obligatorios.');
    if (!(Number(v.width_mm) > 0 && Number(v.height_mm) > 0)) G.fail('RN-ETQ-03', 'Indica el tamaño en mm.');
    if (v.status === 'ACTIVE') { const miss = missingFields(v.body, !!v.includes_qr); if (miss.length) G.fail('RN-ETQ-03', `Una plantilla activa debe incluir ${miss.map(x => '{{' + x + '}}').join(', ')}.`); }
    if (G.db.find('label_templates', t => t.code === v.code.trim().toUpperCase() && (!existing || t.id !== existing.id))) G.fail('RN-ETQ-03', 'Código de plantilla repetido.');
    const row = { brand_id: v.brand_id, code: v.code.trim().toUpperCase(), name: v.name || v.code, format: v.format, width_mm: Number(v.width_mm), height_mm: Number(v.height_mm), body: v.body, includes_qr: !!v.includes_qr, status: v.status || 'DRAFT' };
    return existing ? G.db.update('label_templates', existing.id, row) : G.db.insert('label_templates', row);
  }
  /** por qué no se puede etiquetar el lote hoy (o null) */
  function whyNotPrint(l, date = G.TODAY) {
    if (!l) return { rule: 'RN-ETQ-01', msg: 'Elige el lote.' };
    if (NOPRINT.includes(l.qc_status)) return { rule: 'RN-ETQ-01', msg: `El lote ${l.code} está ${G.ui.statusLabel(l.qc_status).toLowerCase()}: no se imprime su etiqueta.` };
    const p = prod(l.product_id);
    if (p && p.sanitary_authority === 'DIGESA') {
      const ok = G.cal && G.cal.sanitaryValid ? G.cal.sanitaryValid(p.id, date) : !!(p.sanitary_registry && (!p.sanitary_registry_expires || p.sanitary_registry_expires >= date));
      if (!ok) return { rule: 'RN-ETQ-02', msg: `${p.name} es DIGESA y no tiene registro sanitario vigente (RN-CAL-10): renuévalo en CAL-10 antes de etiquetar.` };
    }
    return null;
  }
  function labelData({ lot_id, variant_id, weight_kg, channel = 'COUNTER', token }) {
    const l = lot(lot_id); const v = G.variant(variant_id || (l && l.variant_id)); const p = prod(v.product_id); const b = G.db.get('brands', v.brand_id);
    const kg = v.sale_mode === 'UNIT' ? nominalKg(v) : Number(weight_kg);
    const pr = priceFor(v.id, kg, channel);
    const reg = G.cal && G.cal.currentReg ? G.cal.currentReg(p.id) : null;
    const tk = token || (l ? (tokenFor(l.id, false) || {}).token : null) || 'PENDIENTE';
    return { product: v.name, brand: b.name, brand_color: b.primary_color, net_weight: kg ? F.num(kg, 3) + ' kg' : '—', kg, price_per_kg: pr.per_kg != null ? F.money(pr.per_kg) + ' / kg' : '—', price: pr.price != null ? F.money(pr.price) : '—', price_value: pr.price, lot: l ? l.code : '—', production_date: l ? F.date(l.production_date) : '—', expiry_date: l ? F.date(l.expiry_date) : '—', sanitary_registry: (reg ? reg.number : p.sanitary_registry) ? `${p.sanitary_authority} ${reg ? reg.number : p.sanitary_registry}` : 'No aplica', storage: STORAGE_TXT[p.storage] || '', allergens: allergensOf(p), barcode: v.sale_mode !== 'UNIT' && v.scale_plu ? scaleBarcode(v.scale_plu, kg || 0) : v.barcode, qr: qrUrl(tk), token: tk, legal: b.legal_footer };
  }
  function renderBody(body, d) { return String(body).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => d[k] != null ? String(d[k]) : m); }
  function zpl(tpl, d) {
    const lines = renderBody(tpl.body, Object.assign({}, d, { barcode: '[BC]', qr: '[QR]' })).split('\n').filter(x => x.trim());
    let y = 20; const out = ['^XA', `^PW${Math.round(tpl.width_mm * 8)}`, `^LL${Math.round(tpl.height_mm * 8)}`, '^CI28'];
    for (const ln of lines) { if (ln.includes('[BC]')) { out.push(`^FO20,${y}^BY2^BEN,60,Y,N^FD${String(d.barcode).slice(0, 12)}^FS`); y += 90; } else if (ln.includes('[QR]')) { out.push(`^FO${Math.round(tpl.width_mm * 8) - 170},20^BQN,2,4^FDLA,${d.qr}^FS`); } else { out.push(`^FO20,${y}^A0N,${y === 20 ? 30 : 22},${y === 20 ? 30 : 22}^FD${ln.trim()}^FS`); y += y === 20 ? 36 : 26; } }
    out.push('^XZ'); return out.join('\n');
  }
  function labelCard(tpl, d) {
    const lines = renderBody(tpl.body, d).split('\n');
    return h('div', { class: 'label-card', style: `max-width:${Math.min(360, tpl.width_mm * 3.4)}px;border-top:6px solid ${d.brand_color || 'var(--primary)'}` },
      h('div', { style: 'display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px' },
        h('div', { style: 'min-width:0' }, lines.filter(x => !/^\s*https?:\/\//.test(x) && !/^\s*\d{13}\s*$/.test(x) && x.trim() !== d.qr && x.trim() !== String(d.barcode)).map((x, i) => h('div', { style: i === 0 ? 'font-weight:700;font-size:13px' : i === 1 ? 'font-weight:700;font-size:15px' : 'font-size:11px;line-height:1.35' }, x))),
        tpl.includes_qr ? h('div', { style: 'text-align:center' }, G.ui.qr(d.qr, 78), h('div', { style: 'font-size:8px' }, 'Escanéame')) : null),
      fieldsIn(tpl.body).includes('barcode') ? h('div', null, barcodeSvg(d.barcode)) : null);
  }
  /** imprime etiquetas (solo inserción, RN-ETQ-12) */
  function printLabels(d, o = {}) {
    if (!o.seed) { G.assertMod('ETQ'); if (!G.can('etq.label.print') && !G.can('etq.template.manage') && !G.canDo('ETQ', 'C')) G.fail('RN-ETQ-01', 'Imprimir etiquetas exige el permiso etq.label.print.'); }
    const l = lot(d.lot_id); const w = whyNotPrint(l, (d.at || G.TODAY).slice(0, 10)); if (w) G.fail(w.rule, w.msg);
    const v = G.variant(d.variant_id || l.variant_id);
    if (v.id !== l.variant_id && v.product_id !== l.product_id) G.fail('RN-ETQ-01', `El lote ${l.code} es de ${G.variantName(l.variant_id)}.`);
    const tpl = G.db.get('label_templates', d.template_id); if (!tpl || tpl.status !== 'ACTIVE') G.fail('RN-ETQ-03', 'Elige una plantilla activa.');
    if (tpl.brand_id !== v.brand_id) G.fail('RN-ETQ-03', `La plantilla ${tpl.code} es de ${G.brandName(tpl.brand_id)} y el producto de ${G.brandName(v.brand_id)}.`);
    const copies = Math.round(Number(d.copies || 1)); if (!(copies >= 1 && copies <= 500)) G.fail('RN-ETQ-12', 'Las copias van de 1 a 500.');
    if (v.sale_mode !== 'UNIT') {
      if (!(Number(d.weight_kg) > 0)) G.fail('RN-ETQ-11', 'El peso de la etiqueta es el peso real pesado: pesa el producto.');
      if (d.scale_equipment_id && G.equ && !o.seed) G.equ.assertScaleForSale(d.scale_equipment_id, (d.at || G.TODAY).slice(0, 10));
    }
    const tk = tokenFor(l.id, true);
    const data = labelData({ lot_id: l.id, variant_id: v.id, weight_kg: d.weight_kg, channel: d.channel || 'COUNTER', token: tk.token });
    const p = G.db.insert('label_prints', { template_id: tpl.id, lot_id: l.id, variant_id: v.id, production_order_id: d.production_order_id || null, production_order_ref: d.production_order_ref || null, copies, net_weight_kg: data.kg != null ? R(data.kg, 3) : null, price: data.price_value, channel: d.channel || 'COUNTER', barcode: data.barcode, printer_code: d.printer_code || 'PDF', establishment_id: printerSite(d.printer_code) || d.establishment_id || null, scale_equipment_id: d.scale_equipment_id || null, printed_by: d.printed_by || G.ctx.userId(), printed_at: d.at || nowIso(), reprint_of: d.reprint_of || null, reprint_reason: d.reprint_reason || null, payload_hash: hashOf(zpl(tpl, data)), source: d.source || 'ETQ' }, { silent: !!o.seed });
    return p;
  }
  function hashOf(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return ('00000000' + (x >>> 0).toString(16)).slice(-8); }
  /** RN-ETQ-04: reimpresión con motivo, enlazada a la original */
  function reprint(printId, reason, copies) {
    if (!G.can('etq.label.reprint')) G.fail('RN-ETQ-04', 'Reimprimir exige el permiso etq.label.reprint (jefe de producción o calidad).');
    if (!String(reason || '').trim()) G.fail('RN-ETQ-04', 'Una reimpresión exige el motivo.');
    const p = G.db.get('label_prints', printId); if (!p) G.fail('RN-ETQ-04', 'Impresión no encontrada.');
    const orig = p.reprint_of ? G.db.get('label_prints', p.reprint_of) || p : p;
    return printLabels({ template_id: p.template_id, lot_id: p.lot_id, variant_id: p.variant_id, weight_kg: p.net_weight_kg, copies: copies || p.copies, printer_code: p.printer_code, channel: p.channel, reprint_of: orig.id, reprint_reason: reason.trim(), production_order_ref: p.production_order_ref });
  }

  /* ---------- retiro de lote (RN-ETQ-06/07/08/13) ---------- */
  function recallPreview(lotIds, includeDesc) {
    const edges = genealogy(); const ids = new Set(lotIds); const desc = [];
    if (includeDesc) for (const id of lotIds) for (const d of descendants(id, edges)) if (!ids.has(d.lot_id)) { ids.add(d.lot_id); desc.push(d.lot_id); }
    const sales = salesOfLots(ids);
    const byKey = new Map();
    for (const s of sales) { const k = `${s.customer_id}|${s.lot_id}|${s.sales_document_id || s.sales_order_id || s.consignment_delivery_id}`; const x = byKey.get(k); if (x) { x.qty += s.qty; x.weight_kg = R(x.weight_kg + s.weight_kg, 3); } else byKey.set(k, Object.assign({}, s)); }
    const stock = G.db.where('stock_balances', b => ids.has(b.lot_id) && b.qty > 0);
    return { lot_ids: [...ids], descendants: desc, contacts: [...byKey.values()], stock };
  }
  /** etq_start_recall */
  function startRecall(d, o = {}) {
    if (!o.seed) { G.assertMod('ETQ'); if (!G.can('etq.recall.start')) G.fail('RN-ETQ-13', `Iniciar un retiro exige el permiso etq.recall.start (tu rol: ${G.roleName()}).`); }
    const lotIds = (d.lot_ids || []).filter(Boolean); if (!lotIds.length) G.fail('RN-ETQ-06', 'Elige al menos un lote.');
    if (!String(d.reason || '').trim()) G.fail('RN-ETQ-06', 'Indica el motivo del retiro.');
    if (!RISK.find(x => x[0] === d.risk_class)) G.fail('RN-ETQ-06', 'Indica la clase de riesgo.');
    const inc = d.include_descendants !== false;
    const pv = recallPreview(lotIds, inc);
    const at = d.initiated_at || nowIso();
    const rc = G.db.insert('lot_recalls', { number: d.number || G.db.next('RC', 'RC-2026-', 3), reason: d.reason.trim(), risk_class: d.risk_class, include_descendants: inc, initiated_by: d.initiated_by || G.ctx.userId(), initiated_at: at, contacts_listed_at: null, authority_notified_at: d.authority_notified_at || null, status: 'OPEN', closing_summary: null, closed_at: null, closed_by: null }, { silent: !!o.seed });
    const affectedOrders = new Set();
    for (const id of pv.lot_ids) {
      const l = lot(id);
      const remaining = R(U.sum(G.db.where('stock_balances', b => b.lot_id === id), b => b.qty), 3);
      G.db.insert('lot_recall_lots', { recall_id: rc.id, lot_id: id, is_descendant: !lotIds.includes(id), previous_status: l.qc_status, remaining_qty: remaining }, { silent: true });
      G.db.update('lots', id, { qc_status: 'RECALLED', block_reason: `Retiro ${rc.number}: ${rc.reason}` }, { silent: !!o.seed });
      if (!o.seed) G.events.emit('lot.recalled', { lot_id: id, code: l.code, recall_id: rc.id, number: rc.number });
      for (const b of G.db.where('stock_balances', x => x.lot_id === id && (x.reserved_qty || 0) > 0)) for (const ord of G.db.where('sales_orders', x => (x.reservations || []).some(r => r.balance_id === b.id))) affectedOrders.add(ord);
    }
    // RN-ETQ-06: el stock queda bloqueado; las reservas de pedidos sobre esos lotes se rehacen por FEFO con lotes liberados
    if (!o.seed) for (const ord of affectedOrders) { G.inv.release(ord); G.inv.reserve(ord); }
    // RN-ETQ-07: lista de contacto por cliente que recibió los lotes
    for (const c of pv.contacts) G.db.insert('lot_recall_contacts', { recall_id: rc.id, customer_id: c.customer_id, lot_id: c.lot_id, sales_document_id: c.sales_document_id, sales_order_id: c.sales_order_id, consignment_delivery_id: c.consignment_delivery_id || null, qty: R(c.qty, 3), weight_kg: R(c.weight_kg, 3), status: 'PENDING', contacted_at: null, contact_notes: null, recovered_kg: null }, { silent: true });
    G.db.update('lot_recalls', rc.id, { contacts_listed_at: d.contacts_listed_at || nowIso(), affected_orders: [...affectedOrders].map(x => x.number) }, { silent: true });
    if (!o.seed) { G.audit('RETIRO', 'lot_recalls', rc.id, `${rc.number} iniciado por ${G.ctx.userName()}: ${pv.lot_ids.length} lote(s), ${pv.contacts.length} contacto(s) (RN-ETQ-13)`); G.notify({ role: 'CALIDAD', title: `Retiro ${rc.number} iniciado`, body: `${pv.lot_ids.length} lote(s) retirados y ${pv.contacts.length} cliente(s) por avisar.`, tone: 'bad', module: 'ETQ', ref: { screen: 'ETQ-07', id: rc.id } }); G.notify({ role: 'ALMACENERO', title: `Retiro ${rc.number}: separa el stock`, body: pv.lot_ids.map(i => lot(i).code).join(', '), tone: 'bad', module: 'ETQ' }); }
    return G.db.get('lot_recalls', rc.id);
  }
  const waChannel = brand => G.db.find('messaging_channels', c => c.kind === 'WHATSAPP' && c.brand_id === brand) || G.db.find('messaging_channels', c => c.kind === 'WHATSAPP');
  /** aviso por WhatsApp con la plantilla de utilidad del CRM (etq_recall_whatsapp_template) */
  function notifyContact(contactId) {
    const c = G.db.get('lot_recall_contacts', contactId); const rc = G.db.get('lot_recalls', c.recall_id); const l = lot(c.lot_id); const cu = G.db.get('customers', c.customer_id) || {};
    if (rc.status !== 'OPEN') G.fail('RN-ETQ-08', 'El retiro ya está cerrado.');
    if (!cu.phone) G.fail('RN-ETQ-07', `${G.custName(c.customer_id)} no tiene celular registrado: márcalo como no ubicable o contáctalo por otro medio.`);
    const v = G.variant(l.variant_id);
    const tpl = G.param('etq_recall_whatsapp_template') || 'recall_aviso_cliente';
    const text = `Hola ${(cu.full_name || '').split(' ')[0]}, somos ${G.brandName(v.brand_id)}. Por precaución estamos retirando el lote ${l.code} de ${v.name} que recibiste${c.sales_order_id ? ' en tu pedido ' + (G.db.get('sales_orders', c.sales_order_id) || {}).number : ''}. Por favor no lo consumas: te lo reponemos o devolvemos tu dinero. Responde a este mensaje y coordinamos el recojo.`;
    const m = G.msg.send({ customer_id: c.customer_id, channel_id: (waChannel(v.brand_id) || {}).id, kind: 'UTILITY', template: tpl, text, ref: { type: 'lot_recall', id: rc.id, contact_id: c.id } });
    G.db.update('lot_recall_contacts', c.id, { status: c.status === 'PENDING' ? 'CONTACTED' : c.status, contacted_at: c.contacted_at || nowIso(), contact_notes: (c.contact_notes ? c.contact_notes + ' · ' : '') + `WhatsApp ${tpl} enviado`, message_id: m.id });
    return m;
  }
  function setContact(contactId, st, d = {}) {
    const c = G.db.get('lot_recall_contacts', contactId);
    if (!CONTACT_ST.find(x => x[0] === st)) G.fail('RN-ETQ-08', 'Estado no válido.');
    if (st === 'RECOVERED' && !(Number(d.recovered_kg) >= 0)) G.fail('RN-ETQ-08', 'Indica los kg recuperados.');
    if (st === 'RECOVERED' && Number(d.recovered_kg) > (c.weight_kg || 0) + 0.001) G.fail('RN-ETQ-08', `No se recuperan más kg de los vendidos (${F.num(c.weight_kg, 3)} kg).`);
    return G.db.update('lot_recall_contacts', c.id, { status: st, contacted_at: c.contacted_at || nowIso(), recovered_kg: st === 'RECOVERED' ? R(Number(d.recovered_kg), 3) : c.recovered_kg, contact_notes: d.notes ? (c.contact_notes ? c.contact_notes + ' · ' : '') + d.notes : c.contact_notes });
  }
  function closeRecall(id, summary) {
    if (!G.can('etq.recall.close')) G.fail('RN-ETQ-08', 'Cerrar un retiro exige el permiso etq.recall.close.');
    const rc = G.db.get('lot_recalls', id); if (rc.status !== 'OPEN') G.fail('RN-ETQ-08', 'El retiro no está abierto.');
    const pend = G.db.where('lot_recall_contacts', c => c.recall_id === id && c.status === 'PENDING');
    if (pend.length) G.fail('RN-ETQ-08', `Quedan ${pend.length} contacto(s) pendiente(s) (${pend.slice(0, 3).map(c => G.custName(c.customer_id)).join(', ')}): todos deben estar contactados, recuperados o no ubicables.`);
    if (!String(summary || '').trim()) G.fail('RN-ETQ-08', 'El cierre exige un resumen escrito.');
    const r = G.db.update('lot_recalls', id, { status: 'CLOSED', closing_summary: summary.trim(), closed_at: nowIso(), closed_by: G.ctx.userId() });
    G.events.emit('recall.closed', { recall_id: id, number: rc.number });
    return r;
  }

  G.etq = { recall: startRecall, startRecall, recallPreview, notifyContact, setContact, closeRecall, traceBackward, traceForward, salesOfLots, publicLotPage, tokenFor, printLabels, reprint, priceFor, scaleBarcode, decodeScale, missingFields, saveTemplate, whyNotPrint, labelData, farmOrigin };

  /* =====================================================================
     Datos de ejemplo (orden 45)
     ===================================================================== */
  G.seed(45, function seedETQ() {
    const r = U.rng(4501);
    const ins = (t, row) => G.db.insert(t, row, { silent: true });
    const tk = () => { const c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 22; i++) s += c[Math.floor(r() * c.length)]; return s; };
    const Q = (G.db.find('users', u => u.role === 'CALIDAD') || {}).id;
    /* --- plantillas por marca --- */
    const BODY_W = '{{brand}}\n{{product}}\nPeso neto: {{net_weight}} · {{price_per_kg}}\nTotal: {{price}}\nLote: {{lot}} · Prod.: {{production_date}} · Vence: {{expiry_date}}\nReg. sanitario: {{sanitary_registry}}\n{{storage}}\n{{allergens}}\n{{barcode}}\n{{qr}}';
    const BODY_U = '{{brand}}\n{{product}}\nContenido neto: {{net_weight}} · Precio: {{price}}\nLote: {{lot}} · Prod.: {{production_date}} · Vence: {{expiry_date}}\nReg. sanitario: {{sanitary_registry}}\n{{storage}}\n{{allergens}}\n{{barcode}}\n{{qr}}';
    const T = [['ETQ-DG-100X50', 'br-DG', 'Don Guando · carnes de granja (peso variable)', 'ZPL', 100, 50, BODY_W, true, 'ACTIVE'], ['ETQ-DG-MOS', 'br-DG', 'Don Guando · balanza del mostrador', 'ESCPOS', 58, 40, BODY_W, true, 'ACTIVE'], ['ETQ-DG-ENV', 'br-DG', 'Don Guando · envasados (caldos y embutidos)', 'ZPL', 100, 50, BODY_U, true, 'ACTIVE'],
      ['ETQ-M2-100X50', 'br-M2', 'Marca 2 · cortes al vacío', 'ZPL', 100, 50, BODY_W, true, 'ACTIVE'], ['ETQ-M3-100X50', 'br-M3', 'Marca 3 · embutidos', 'ZPL', 100, 50, BODY_U, true, 'ACTIVE'], ['ETQ-M3-KG', 'br-M3', 'Marca 3 · jamón por kg', 'ZPL', 100, 50, BODY_W, true, 'ACTIVE'],
      ['ETQ-M4-80X50', 'br-M4', 'Marca 4 · despensa', 'ZPL', 80, 50, BODY_U, true, 'ACTIVE'], ['ETQ-M5-PDF', 'br-M5', 'Marca 5 · gourmet (frascos y bolsas)', 'PDF', 70, 45, BODY_U, true, 'ACTIVE'],
      ['ETQ-M5-NUEVA', 'br-M5', 'Marca 5 · nuevo diseño (borrador sin registro sanitario)', 'PDF', 70, 45, '{{brand}}\n{{product}}\n{{net_weight}} · {{price}}\nLote {{lot}} · {{production_date}} · {{expiry_date}}\n{{qr}}', true, 'DRAFT']];
    for (const [code, b, name, fmt, w, hh, body, qr, st] of T) ins('label_templates', { id: 'lt-' + code, code, brand_id: b, name, format: fmt, width_mm: w, height_mm: hh, body, includes_qr: qr, status: st });

    /* --- origen de la granja en los lotes FARM y genealogía de los cuyes --- */
    const farmLots = G.db.where('lots', l => l.origin === 'FARM' && l.id !== 'lo-Q001');
    for (const l of farmLots) l.farm_origin = l.farm_origin || { species: l.variant_id === 'va-MP-CON-CAN' ? 'Conejo (Oryctolagus cuniculus)' : 'Cuy (Cavia porcellus) raza Perú', slaughter_date: G.date.add(l.production_date, -1), farm_name: 'Granja Don Guando · Pachacámac' };
    const canal = farmLots.filter(l => l.variant_id === 'va-MP-CUY-CAN').sort(U.by('production_date'));
    for (const l of G.db.where('lots', x => ['va-DG-CUY-ENT', 'va-DG-CUY-MIT', 'va-DG-CUY-DES'].includes(x.variant_id) && x.origin === 'PRODUCTION' && x.id !== 'lo-Q001')) { const src = canal.filter(c => c.production_date <= l.production_date).pop() || canal[0]; if (src) l.parent_lots = [{ lot_id: src.id, kg: R(8 + r() * 10, 1), order_ref: 'OP01-0' + (300 + Math.floor(r() * 90)) }]; }
    const vCuy = G.variant('va-DG-CUY-ENT');
    const cu = ins('lots', { id: 'lo-CU1008', product_id: vCuy.product_id, variant_id: vCuy.id, code: 'CU-2026-1008', origin: 'FARM', supplier_id: 'su-GRANJA', production_date: '2026-10-08', expiry_date: '2026-10-15', qc_status: 'RELEASED', unit_cost: 26.5, released_at: '2026-10-08T09:30', released_by: 'Silvia Ramos Tello', received_weight_kg: 27.6, farm_origin: { species: 'Cuy (Cavia porcellus) raza Perú', slaughter_date: '2026-10-07', farm_name: 'Granja Don Guando · Pachacámac' }, parent_lots: [] });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-CAM-L1', variant: vCuy.id, lot: cu.id, qty: 30, weight: 27.6, unitCost: 26.5, source: { type: 'FARM_RECEIPT', id: 'GRJ-REC-0011' }, at: '2026-10-08T08:10', reason: 'Recepción de la granja' });
    ins('lot_qr_tokens', { lot_id: cu.id, token: 'cuy1008DonGuandoGranja', status: 'ACTIVE' });

    /* --- lotes en los pedidos entregados del 5 al 10 de octubre (FEFO) --- */
    const lotsBy = U.groupBy(G.db.where('lots', l => l.qc_status === 'RELEASED' && !['lo-CU1008'].includes(l.id)), 'variant_id');
    const docsBy = new Map(G.db.where('sales_documents', d => d.order_id).map(d => [d.order_id, d]));
    for (const o of G.db.where('sales_orders', x => ['DELIVERED', 'CLOSED'].includes(x.status) && x.delivery_date >= '2026-10-05')) {
      for (const ln of o.lines) { if (ln.lot_id) continue; const c = (lotsBy[ln.variant_id] || []).filter(l => l.production_date <= o.delivery_date).sort(U.by('expiry_date'))[0]; if (!c) continue; ln.lot_id = c.id; const dd = docsBy.get(o.id); if (dd) for (const dl2 of dd.lines) if (dl2.variant_id === ln.variant_id && !dl2.lot_id) dl2.lot_id = c.id; }
    }
    // el lote de cuy de la granja llegó a 4 clientes el 8 y 9 de octubre
    let nCu = 0;
    for (const o of G.db.where('sales_orders', x => ['DELIVERED', 'CLOSED'].includes(x.status) && ['2026-10-08', '2026-10-09'].includes(x.delivery_date))) { const ln = o.lines.find(x => x.variant_id === vCuy.id); if (!ln || nCu >= 4) continue; ln.lot_id = cu.id; const dd = docsBy.get(o.id); if (dd) for (const dl2 of dd.lines) if (dl2.variant_id === vCuy.id) dl2.lot_id = cu.id; nCu++; }

    /* --- retiro abierto: morcilla MO-2026-0928 (laboratorio no conforme) --- */
    const vMo = G.variant('va-M3-MOR-500');
    const mo = ins('lots', { id: 'lo-MO0928', product_id: vMo.product_id, variant_id: vMo.id, code: 'MO-2026-0928', origin: 'PRODUCTION', production_date: '2026-09-28', expiry_date: '2026-10-12', qc_status: 'RELEASED', unit_cost: 6.8, released_at: '2026-09-28T17:00', released_by: 'Silvia Ramos Tello', production_order_ref: 'OP01-0371', parent_lots: [] });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-CAM-L1', variant: vMo.id, lot: mo.id, qty: 8, unitCost: 6.8, source: { type: 'PRODUCTION', id: 'OP01-0371' }, at: '2026-09-28T17:30', reason: 'Producción' });
    let nMo = 0;
    for (const o of G.db.where('sales_orders', x => ['DELIVERED', 'CLOSED'].includes(x.status) && x.delivery_date >= '2026-09-29' && x.delivery_date <= '2026-10-06').sort(U.by('delivery_date'))) { const ln = o.lines.find(x => x.variant_id === vMo.id); if (!ln || nMo >= 6) continue; ln.lot_id = mo.id; const dd = docsBy.get(o.id); if (dd) for (const dl2 of dd.lines) if (dl2.variant_id === vMo.id) dl2.lot_id = mo.id; nMo++; }
    ins('qc_lab_samples', { code: 'MU-2026-029', lot_id: mo.id, sample_type: 'ANALYSIS', lab_name: 'Laboratorio Certificaciones Alimentarias SAC', analysis: 'Microbiológico: coliformes totales y E. coli', sent_on: '2026-10-02', result_on: '2026-10-08', result: 'FAIL', file_url: 'informes/MU-2026-029.pdf', establishment_id: 'es-L2', taken_by: Q });
    const rc2 = startRecall({ number: 'RC-2026-002', lot_ids: [mo.id], include_descendants: true, reason: 'Resultado de laboratorio MU-2026-029: coliformes por encima del límite en la muestra de retención', risk_class: 'CLASS_II', initiated_by: Q, initiated_at: '2026-10-08T16:20', contacts_listed_at: '2026-10-08T16:24', authority_notified_at: '2026-10-09T10:00' }, { seed: true });
    const cts = G.db.where('lot_recall_contacts', c => c.recall_id === rc2.id);
    cts.forEach((c, i) => {
      const st = i < 2 ? 'RECOVERED' : i < 4 ? 'CONTACTED' : 'PENDING';
      if (st !== 'PENDING') { Object.assign(c, { status: st, contacted_at: '2026-10-08T17:' + U.pad(5 + i * 7, 2), contact_notes: `WhatsApp ${G.param('etq_recall_whatsapp_template')} enviado` + (st === 'RECOVERED' ? ' · recogido por el repartidor' : ' · cliente confirmó que no lo consumirá'), recovered_kg: st === 'RECOVERED' ? c.weight_kg : null }); const cu2 = G.db.get('customers', c.customer_id); ins('messages', { customer_id: c.customer_id, channel_id: (waChannel('br-M3') || {}).id, direction: 'OUT', kind: 'UTILITY', template: G.param('etq_recall_whatsapp_template'), text: `Hola ${(cu2.full_name || '').split(' ')[0]}, por precaución estamos retirando el lote MO-2026-0928 de Morcilla 500 g. Por favor no lo consumas: te lo reponemos o devolvemos tu dinero.`, ref: { type: 'lot_recall', id: rc2.id, contact_id: c.id }, sent_at: c.contacted_at, sender_user_id: Q, status: 'DELIVERED', cost: 0.0998 }); }
    });
    /* --- retiro cerrado de setiembre: etiqueta sin alérgenos --- */
    const vSh = G.variant('va-M3-HUA-500');
    const sh = ins('lots', { id: 'lo-SH0902', product_id: vSh.product_id, variant_id: vSh.id, code: 'SH-2026-0902', origin: 'PRODUCTION', production_date: '2026-09-02', expiry_date: '2026-09-23', qc_status: 'RELEASED', unit_cost: 7.6, released_at: '2026-09-02T17:00', released_by: 'Silvia Ramos Tello', production_order_ref: 'OP01-0322', parent_lots: [] });
    let nSh = 0;
    for (const o of G.db.where('sales_orders', x => x.status === 'CLOSED' && x.delivery_date >= '2026-09-03' && x.delivery_date <= '2026-09-08').sort(U.by('delivery_date'))) { const ln = o.lines.find(x => x.variant_id === vSh.id); if (!ln || nSh >= 4) continue; ln.lot_id = sh.id; const dd = docsBy.get(o.id); if (dd) for (const dl2 of dd.lines) if (dl2.variant_id === vSh.id) dl2.lot_id = sh.id; nSh++; }
    const rc1 = startRecall({ number: 'RC-2026-001', lot_ids: [sh.id], include_descendants: true, reason: 'Etiqueta impresa sin la declaración de soya (alérgeno)', risk_class: 'CLASS_III', initiated_by: Q, initiated_at: '2026-09-09T10:00', contacts_listed_at: '2026-09-09T10:07' }, { seed: true });
    G.db.where('lot_recall_contacts', c => c.recall_id === rc1.id).forEach((c, i) => Object.assign(c, { status: i === 3 ? 'NOT_REACHABLE' : i % 2 ? 'CONTACTED' : 'RECOVERED', contacted_at: '2026-09-09T1' + (1 + i) + ':00', recovered_kg: i % 2 || i === 3 ? null : R(c.weight_kg * 0.5, 3), contact_notes: i === 3 ? 'Tres llamadas sin respuesta' : 'Aviso por WhatsApp' }));
    Object.assign(G.db.get('lot_recalls', rc1.id), { status: 'CLOSED', closing_summary: 'Se avisó a todos los clientes; se recuperó la mitad del producto en 2 domicilios. Se corrigió la plantilla ETQ-M3-100X50 con {{allergens}}.', closed_at: '2026-09-12T18:00', closed_by: Q });
    G.db.seq['DG:RC'] = 2;

    /* --- impresiones de octubre (producción y preparación) y reimpresiones --- */
    const tplFor = v => { const ts = G.db.where('label_templates', t => t.brand_id === v.brand_id && t.status === 'ACTIVE'); return (v.sale_mode === 'UNIT' ? ts.find(t => !t.body.includes('price_per_kg')) : ts.find(t => t.body.includes('price_per_kg'))) || ts[0]; };
    const users = { 'es-L1': (G.db.find('users', u => u.role === 'OPERARIO_PRODUCCION' && (u.sites || []).includes('es-L1')) || {}).id, 'es-L2': (G.db.find('users', u => u.role === 'OPERARIO_PRODUCCION' && (u.sites || []).includes('es-L2')) || {}).id };
    const prints = [];
    for (const l of G.db.where('lots', x => x.qc_status === 'RELEASED' && x.production_date >= '2026-10-03' && ['PRODUCTION', 'FARM', 'CUTTING'].includes(x.origin))) {
      const v = G.variant(l.variant_id); if (!v || !v.sellable) continue; const t = tplFor(v); if (!t) continue;
      if (whyNotPrint(l, l.production_date)) continue;
      const site = (G.db.get('products', v.product_id) || {}).line === 'CUY' || v.brand_id === 'br-M2' ? 'es-L1' : 'es-L2';
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const kg = v.sale_mode === 'UNIT' ? null : R((v.nominal_weight_kg || 1) * (0.9 + r() * 0.25), 3);
        prints.push(printLabels({ template_id: t.id, lot_id: l.id, variant_id: v.id, weight_kg: kg, copies: v.sale_mode === 'UNIT' ? 10 + Math.floor(r() * 30) : 1, printer_code: site === 'es-L1' ? 'IMP-L1-01' : 'IMP-L2-01', channel: 'COUNTER', at: l.production_date + 'T' + U.pad(14 + k, 2) + ':' + U.pad(Math.floor(r() * 59), 2), printed_by: users[site], production_order_ref: l.production_order_ref || null, source: 'PRO' }, { seed: true }));
      }
      if (!G.db.find('lot_qr_tokens', x => x.lot_id === l.id)) ins('lot_qr_tokens', { lot_id: l.id, token: tk(), status: 'ACTIVE' });
    }
    for (const p of G.db.where('label_prints', () => true)) { const t = G.db.find('lot_qr_tokens', x => x.lot_id === p.lot_id); if (t) p.payload_hash = hashOf(p.id + t.token); }
    const REASONS = ['Etiqueta arrugada en la selladora', 'Cinta de impresión agotada a la mitad', 'Cliente pidió etiqueta nueva por mancha', 'Error de peso: se repesó el paquete'];
    prints.filter((_, i) => i % 9 === 4).slice(0, 5).forEach((p, i) => { G.db.insert('label_prints', Object.assign({}, p, { id: undefined, copies: 1 + (i % 2), reprint_of: p.id, reprint_reason: REASONS[i % REASONS.length], printed_by: Q, printed_at: p.printed_at.slice(0, 11) + '17:3' + i }), { silent: true }); });
  }, 'etiquetas');

  /* =====================================================================
     Pantallas
     ===================================================================== */
  const lotOpts = pred => G.db.where('lots', pred || (() => true)).sort(U.by('production_date', -1)).map(l => [l.id, `${l.code} · ${G.variantName(l.variant_id)} · ${G.ui.statusLabel(l.qc_status)}`]);
  const brandOpts = () => G.db.all('brands').filter(b => G.scope.ok({ brand_id: b.id })).map(b => [b.id, b.name]);
  const sampleLot = brand => G.db.where('lots', l => l.qc_status === 'RELEASED' && (G.variant(l.variant_id) || {}).brand_id === brand && (G.variant(l.variant_id) || {}).sellable).sort(U.by('production_date', -1))[0];

  /* ---------- ETQ-01 Plantillas ---------- */
  function rETQ01(el) {
    const body = page(el, { code: 'ETQ-01', title: 'Plantillas de etiqueta', sub: 'Por marca: formato (ZPL, ESC/POS o PDF), tamaño en mm, cuerpo con campos {{…}}, QR y vista previa. Una plantilla activa incluye los campos obligatorios (RN-ETQ-03).', actions: [{ label: 'Nueva plantilla', kind: 'primary', icon: '+', onClick: () => G.require('etq.template.manage', () => editTpl(null)) }] });
    const rows = G.scope.filter(G.db.all('label_templates'));
    body.appendChild(notice(['Campos disponibles: ', h('span', { class: 'mono small' }, '{{product}} {{brand}} {{net_weight}} {{price_per_kg}} {{price}} {{lot}} {{production_date}} {{expiry_date}} {{sanitary_registry}} {{storage}} {{allergens}} {{barcode}} {{qr}}'), '. Obligatorios: ', REQUIRED.map(x => '{{' + x + '}}').join(' '), ' y {{qr}} si lleva QR.'], 'info'));
    body.appendChild(table({ id: 'etq01', columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Plantilla' }, { key: 'brand', label: 'Marca', value: t => G.brandName(t.brand_id) }, { key: 'format', label: 'Formato' }, { key: 'size', label: 'Tamaño', value: t => `${F.num(t.width_mm)} × ${F.num(t.height_mm)} mm` }, { key: 'includes_qr', label: 'QR', value: t => t.includes_qr ? 'Sí' : 'No' }, { key: 'miss', label: 'Campos', render: t => { const m = missingFields(t.body, t.includes_qr); return m.length ? badge('Faltan ' + m.length, 'bad') : badge('Completos', 'ok'); } }, { key: 'status', label: 'Estado', render: t => status(t.status) }],
      rows, filters: [{ key: 'brand_id', label: 'Marca', options: brandOpts() }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activa'], ['DRAFT', 'Borrador'], ['INACTIVE', 'Inactiva']] }], onRow: t => openTpl(t) }));
  }
  function openTpl(t) {
    drawer(`${t.code} · ${t.name}`, (b, close) => {
      const l = sampleLot(t.brand_id);
      b.appendChild(h('div', { class: 'row' }, btn('Editar', () => { close(); G.require('etq.template.manage', () => editTpl(t)); }, { sm: true, kind: 'primary' }), t.status !== 'ACTIVE' ? btn('Activar', () => G.require('etq.template.manage', () => { if (run(() => saveTemplate(Object.assign({}, t, { status: 'ACTIVE' }), t), 'Plantilla activada')) { close(); } }), { sm: true }) : btn('Desactivar', () => G.require('etq.template.manage', () => { run(() => G.db.update('label_templates', t.id, { status: 'INACTIVE' }), 'Plantilla desactivada'); close(); }), { sm: true, kind: 'ghost' })));
      const m = missingFields(t.body, t.includes_qr);
      if (m.length) b.appendChild(notice(`RN-ETQ-03: le faltan ${m.map(x => '{{' + x + '}}').join(', ')}; no puede activarse.`, 'bad'));
      b.appendChild(dl([['Marca', G.brandName(t.brand_id)], ['Formato', t.format], ['Tamaño', `${t.width_mm} × ${t.height_mm} mm`], ['QR', t.includes_qr ? 'Sí' : 'No'], ['Estado', status(t.status)]]));
      if (l) { const d = labelData({ lot_id: l.id, variant_id: l.variant_id, weight_kg: (G.variant(l.variant_id).nominal_weight_kg || 1), channel: 'COUNTER' }); b.appendChild(card(`Vista previa con el lote ${l.code}`, h('div', { class: 'stack' }, labelCard(t, d), h('pre', { class: 'mono small', style: 'white-space:pre-wrap;max-height:220px;overflow:auto;background:var(--bg);padding:8px;border-radius:6px' }, t.format === 'ZPL' ? zpl(t, d) : renderBody(t.body, d))))); }
    }, { code: 'ETQ-01', wide: true });
  }
  function editTpl(t) {
    drawer(t ? 'Editar ' + t.code : 'Nueva plantilla', (b, close) => b.appendChild(form({ id: 'etq01-f', values: t || { format: 'ZPL', width_mm: 100, height_mm: 50, includes_qr: true, status: 'DRAFT', body: '{{brand}}\n{{product}}\nPeso neto: {{net_weight}} · Total: {{price}}\nLote: {{lot}} · Prod.: {{production_date}} · Vence: {{expiry_date}}\nReg. sanitario: {{sanitary_registry}}\n{{storage}}\n{{barcode}}\n{{qr}}' }, fields: [
      { key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'brand_id', label: 'Marca', type: 'select', options: brandOpts(), required: true }, { key: 'format', label: 'Formato', type: 'select', options: [['ZPL', 'ZPL (Zebra)'], ['ESCPOS', 'ESC/POS (balanza o ticketera)'], ['PDF', 'PDF']], required: true },
      { key: 'width_mm', label: 'Ancho (mm)', type: 'number', min: 10, required: true }, { key: 'height_mm', label: 'Alto (mm)', type: 'number', min: 10, required: true }, { key: 'includes_qr', label: 'Lleva QR de trazabilidad', type: 'checkbox' }, { key: 'status', label: 'Estado', type: 'select', options: [['DRAFT', 'Borrador'], ['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva']], required: true },
      { key: 'body', label: 'Cuerpo con campos {{…}}', type: 'textarea', required: true }],
      onCancel: close, onSubmit: v => { const r2 = saveTemplate(v, t); close(); toast(`Plantilla ${r2.code} guardada`, 'ok'); G.refresh(); return true; } })), { code: 'ETQ-01' });
  }

  /* ---------- ETQ-02 Impresión ---------- */
  function rETQ02(el, params) {
    const body = page(el, { code: 'ETQ-02', title: 'Impresión de etiquetas', sub: 'Lote, variante, peso real, precio (lista del canal × kg, redondeado a S/ 0,10), copias e impresora. Muestra el bloqueo si el lote no se puede etiquetar (RN-ETQ-01, RN-ETQ-02). Código de balanza: 2 + 0 + PLU + gramos.' });
    const st = { lot_id: params.lot || (G.db.where('lots', l => l.qc_status === 'RELEASED' && (G.variant(l.variant_id) || {}).sale_mode !== 'UNIT').sort(U.by('production_date', -1))[0] || {}).id, weight_kg: '', copies: 1, channel: 'COUNTER', printer_code: G.ctx.site === 'es-L2' ? 'IMP-L2-01' : 'IMP-L1-01', scale: '' };
    const left = h('div', { class: 'stack' }), right = h('div', { class: 'stack' });
    body.appendChild(h('div', { class: 'grid c2' }, left, right));
    const scales = G.db.where('equipment', e => e.category === 'SCALE' && e.status !== 'RETIRED');
    function tplOpts(v) { return v ? G.db.where('label_templates', t => t.brand_id === v.brand_id && t.status === 'ACTIVE').map(t => [t.id, `${t.code} · ${t.format} ${t.width_mm}×${t.height_mm}`]) : []; }
    function draw() {
      G.ui.clear(left); G.ui.clear(right);
      const l = lot(st.lot_id); const v = l ? G.variant(l.variant_id) : null;
      const tpls = tplOpts(v); if (!tpls.find(x => x[0] === st.template_id)) st.template_id = tpls[0] ? tpls[0][0] : '';
      if (v && v.sale_mode === 'UNIT') st.weight_kg = nominalKg(v);
      const f = form({ id: 'etq02-f', submitLabel: false, values: st, fields: [
        { key: 'lot_id', label: 'Lote', type: 'select', required: true, options: lotOpts(x => !x.expiry_date || x.expiry_date >= G.TODAY), onChange: x => { st.lot_id = x; st.weight_kg = ''; draw(); } },
        { key: 'template_id', label: 'Plantilla de la marca', type: 'select', required: true, options: tpls, onChange: x => { st.template_id = x; draw(); } },
        v && v.sale_mode !== 'UNIT' ? { key: 'scale', label: 'Balanza', type: 'select', options: scales.map(e => [e.id, `${e.code} · ${e.name}${G.equ && !G.equ.scaleUsable(e.id) ? ' (no apta)' : ''}`]), onChange: x => { st.scale = x; draw(); } } : null,
        { key: 'weight_kg', label: v && v.sale_mode === 'UNIT' ? 'Contenido neto (kg)' : 'Peso real (kg)', type: v && v.sale_mode === 'UNIT' ? 'readonly' : 'number', step: '0.001', onChange: x => { st.weight_kg = x; drawRight(); } },
        { key: 'channel', label: 'Lista de precios del canal', type: 'select', options: [['COUNTER', 'Público (mostrador, web, WhatsApp)'], ['B2B', 'Restaurantes y negocios']], onChange: x => { st.channel = x; drawRight(); } },
        { key: 'copies', label: 'Copias', type: 'number', min: 1, max: 500, onChange: x => { st.copies = x; } }, { key: 'printer_code', label: 'Impresora', type: 'select', options: PRINTERS.map(p => [p[0], p[1]]), onChange: x => { st.printer_code = x; } }].filter(Boolean) });
      left.appendChild(card('Datos de la etiqueta', h('div', null, f, h('div', { class: 'row', style: 'margin-top:10px' },
        v && v.sale_mode !== 'UNIT' ? btn('Leer balanza', () => { if (!st.scale) return toast('Elige la balanza.', 'warn'); try { if (G.equ) G.equ.assertScaleForSale(st.scale); st.weight_kg = R((v.nominal_weight_kg || 1) * (0.9 + Math.random() * 0.25), 3); draw(); } catch (e) { toast(e.message, 'bad'); } }, { sm: true }) : null,
        btn('Imprimir', () => { try { const p = printLabels({ template_id: st.template_id, lot_id: st.lot_id, variant_id: v && v.id, weight_kg: st.weight_kg, copies: st.copies, printer_code: st.printer_code, channel: st.channel, scale_equipment_id: st.scale || null }); toast(`${p.copies} etiqueta(s) enviadas a ${st.printer_code} · ${p.barcode}`, 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { kind: 'primary' })))));
      drawRight();
    }
    function drawRight() {
      G.ui.clear(right);
      const l = lot(st.lot_id); if (!l) return;
      const w = whyNotPrint(l);
      if (w) right.appendChild(notice([h('b', null, w.rule + ': '), w.msg], 'bad'));
      else if (l.qc_status === 'QUARANTINE') right.appendChild(notice('El lote está en cuarentena: se puede etiquetar, pero no se vende hasta que calidad lo libere (CAL-07).', 'warn'));
      if (st.scale && G.equ && !G.equ.scaleUsable(st.scale)) right.appendChild(notice('RN-EQU-03: la balanza elegida no tiene calibración vigente; no pesa ventas.', 'bad'));
      const tpl = G.db.get('label_templates', st.template_id);
      if (!tpl) { right.appendChild(notice('La marca no tiene plantilla activa: créala en ETQ-01.', 'warn')); return; }
      const v = G.variant(l.variant_id);
      if (v.sale_mode !== 'UNIT' && !(Number(st.weight_kg) > 0)) { right.appendChild(notice('Pesa el producto: la etiqueta lleva el peso real (RN-ETQ-11).', 'info')); }
      const d = labelData({ lot_id: l.id, variant_id: v.id, weight_kg: Number(st.weight_kg) || 0, channel: st.channel });
      right.appendChild(card('Vista previa', h('div', { class: 'stack' }, labelCard(tpl, d), h('div', { class: 'small muted' }, v.sale_mode !== 'UNIT' ? `${d.price_per_kg} × ${d.net_weight} = ${F.money((priceFor(v.id, Number(st.weight_kg) || 0, st.channel).per_kg || 0) * (Number(st.weight_kg) || 0))} → redondeado ${d.price}` : `Precio por unidad ${d.price}`), h('details', null, h('summary', { class: 'small' }, `Código ${tpl.format}`), h('pre', { class: 'mono small', style: 'white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:6px' }, tpl.format === 'ZPL' ? zpl(tpl, d) : renderBody(tpl.body, d))))));
    }
    draw();
    const recent = G.db.all('label_prints').filter(p => G.scope.ok({ establishment_id: p.establishment_id })).sort(U.by('printed_at', -1)).slice(0, 8);
    body.appendChild(card('Últimas impresiones', table({ id: 'etq02-last', search: false, columns: printCols(), rows: recent }), { flush: true }));
  }

  /* ---------- ETQ-03 Historial ---------- */
  const printCols = () => [{ key: 'printed_at', label: 'Fecha', render: p => F.datetime(p.printed_at) }, { key: 'lot', label: 'Lote', mono: true, value: p => (lot(p.lot_id) || {}).code }, { key: 'v', label: 'Producto', value: p => G.variantName(p.variant_id) }, { key: 'net_weight_kg', label: 'Peso', align: 'r', render: p => p.net_weight_kg != null ? F.num(p.net_weight_kg, 3) + ' kg' : '—' }, { key: 'price', label: 'Precio', align: 'r', render: p => F.money(p.price) }, { key: 'copies', label: 'Copias', align: 'r' }, { key: 'printer_code', label: 'Impresora', mono: true }, { key: 'by', label: 'Imprimió', value: p => G.userShort(p.printed_by) }, { key: 'rp', label: 'Reimpresión', render: p => p.reprint_of ? h('span', { class: 'small' }, badge('Reimpresión', 'warn'), ' ', p.reprint_reason) : '' }];
  function rETQ03(el) {
    const body = page(el, { code: 'ETQ-03', title: 'Historial de impresiones', sub: 'Quién, cuándo, qué lote y cuántas copias; las reimpresiones llevan su motivo y quedan enlazadas a la original. Las impresiones son de solo inserción (RN-ETQ-04, RN-ETQ-12).' });
    const rows = G.db.all('label_prints').filter(p => G.scope.ok({ establishment_id: p.establishment_id, brand_id: (G.variant(p.variant_id) || {}).brand_id })).sort(U.by('printed_at', -1));
    const m = rows.filter(p => p.printed_at >= G.date.month(G.TODAY));
    body.appendChild(kpis([{ label: 'Impresiones del mes', value: m.length }, { label: 'Etiquetas del mes', value: F.num(U.sum(m, p => p.copies)) }, { label: 'Reimpresiones', value: m.filter(p => p.reprint_of).length, sub: `KPI-ETQ-03: ${F.pct((G.kpi('KPI-ETQ-03') || {}).value)}`, tone: 'warn' }, { label: 'Lotes etiquetados', value: new Set(m.map(p => p.lot_id)).size }]));
    body.appendChild(table({ id: 'etq03', columns: printCols(), rows, filters: [{ key: 'printer_code', label: 'Impresora', options: PRINTERS.map(p => [p[0], p[0]]) }, { key: 'rp', label: 'Tipo', options: [['N', 'Original'], ['R', 'Reimpresión']], value: p => p.reprint_of ? 'R' : 'N' }],
      onRow: p => openPrint(p), actions: p => [btn('Reimprimir', () => reprintModal(p), { sm: true, disabled: !G.can('etq.label.reprint') })] }));
  }
  function openPrint(p) {
    drawer('Impresión de etiquetas', (b) => {
      const tpl = G.db.get('label_templates', p.template_id); const l = lot(p.lot_id);
      b.appendChild(dl([['Lote', l.code], ['Producto', G.variantName(p.variant_id)], ['Plantilla', tpl ? tpl.code : '—'], ['Peso', p.net_weight_kg != null ? F.num(p.net_weight_kg, 3) + ' kg' : '—'], ['Precio', F.money(p.price)], ['Código de barras', h('span', { class: 'mono' }, p.barcode)], ['Copias', p.copies], ['Impresora', p.printer_code], ['Orden', p.production_order_ref], ['Imprimió', `${G.userName(p.printed_by)} · ${F.datetime(p.printed_at)}`], ['Reimpresión de', p.reprint_of ? F.datetime((G.db.get('label_prints', p.reprint_of) || {}).printed_at) : null], ['Motivo', p.reprint_reason], ['Huella del contenido', h('span', { class: 'mono' }, p.payload_hash)]]));
      if (p.barcode) b.appendChild(barcodeSvg(p.barcode));
      const rps = G.db.where('label_prints', x => x.reprint_of === p.id);
      if (rps.length) b.appendChild(card('Reimpresiones', table({ id: 'etq03-rp', search: false, columns: printCols(), rows: rps })));
    }, { code: 'ETQ-03', wide: true });
  }
  function reprintModal(p) {
    modal('Reimprimir etiqueta', (b, close) => b.appendChild(form({ id: 'etq03-rp-f', values: { copies: p.copies }, fields: [{ key: 'reason', label: 'Motivo (obligatorio, RN-ETQ-04)', type: 'textarea', required: true }, { key: 'copies', label: 'Copias', type: 'number', min: 1, max: 500, required: true }], submitLabel: 'Reimprimir', onCancel: close, onSubmit: v => { reprint(p.id, v.reason, v.copies); close(); toast('Reimpresión registrada y enlazada a la original', 'ok'); G.refresh(); return true; } })), []);
  }

  /* ---------- ETQ-04 Trazabilidad ---------- */
  function lotPicker(st, onPick, pred) {
    const inp = h('input', { class: 'input', placeholder: 'Código de lote (CH-2026-0412)', value: st.code || '', style: 'max-width:260px', attrs: { 'aria-label': 'Código de lote', list: 'etq-lots' } });
    const dlist = h('datalist', { id: 'etq-lots' }, G.db.where('lots', pred || (() => true)).slice(-400).map(l => h('option', { value: l.code }, G.variantName(l.variant_id))));
    const go = () => { const l = lotByCode(inp.value); if (!l) return toast('Lote no encontrado', 'warn'); onPick(l); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    return h('div', { class: 'row' }, inp, dlist, btn('Ver', go, { sm: true, kind: 'primary' }));
  }
  function nodeView(n, depth = 0) {
    const l = n.lot; const v = G.variant(l.variant_id);
    return h('div', { style: `margin-left:${depth ? 16 : 0}px;border-left:${depth ? '2px solid var(--line, #ddd)' : 'none'};padding-left:${depth ? 10 : 0}px;margin-top:6px` },
      h('div', { class: 'row', style: 'gap:6px' }, h('b', { class: 'mono' }, l.code), h('span', null, v ? v.name : ''), status(l.qc_status), n.edge ? h('span', { class: 'small muted' }, `${F.num(n.edge.kg, 1)} kg${n.edge.order ? ' · orden ' + n.edge.order : ''}${n.edge.date ? ' · ' + F.date(n.edge.date) : ''}`) : null),
      !n.parents.length ? h('div', { class: 'small' }, isFarm(l) ? h('span', null, badge('Granja Don Guando', 'ok'), ` beneficio ${F.date((l.farm_origin || {}).slice_date || (l.farm_origin || {}).slaughter_date || l.production_date)}`) : l.supplier_id ? `Proveedor: ${G.supName(l.supplier_id)} · recibido ${F.date(l.production_date)}` : l.origin === 'PRODUCTION' || l.origin === 'CUTTING' ? 'Sin consumos registrados en PRO' : '') : null,
      n.parents.map(p => nodeView(p, depth + 1)));
  }
  function rETQ04(el, params) {
    const l = lot(params.lot) || lotByCode(params.code) || G.db.find('lots', x => x.code === 'CH-2026-0412') || G.db.all('lots')[0];
    const body = page(el, { code: 'ETQ-04', title: 'Trazabilidad de un lote', sub: 'Árbol hacia atrás (órdenes, lotes de insumo, proveedor o granja) y hacia adelante (lotes derivados, pedidos, comprobantes, consignación y clientes) con kg, documentos y fechas; recorre todos los niveles (RN-ETQ-05).', actions: [{ label: 'Exportar PDF', onClick: () => G.print() }, { label: 'Iniciar retiro', kind: 'danger', onClick: () => G.go('ETQ-06', { lot: l.id }) }] });
    body.appendChild(lotPicker({ code: l.code }, x => G.go('ETQ-04', { lot: x.id })));
    const back = traceBackward(l.id); const fw = traceForward(l.id);
    const v = G.variant(l.variant_id);
    const kgSold = R(U.sum(fw.sales, s => s.weight_kg), 3);
    body.appendChild(kpis([{ label: 'Lote', value: l.code, sub: v ? v.name : '' }, { label: 'Estado', value: G.ui.statusLabel(l.qc_status) }, { label: 'Lotes derivados', value: fw.descendants.length }, { label: 'Clientes que lo recibieron', value: new Set(fw.sales.map(s => s.customer_id)).size, sub: `${F.num(kgSold, 3)} kg vendidos` }, { label: 'Stock actual', value: F.num(U.sum(G.db.where('stock_balances', b => fw.lot_ids.includes(b.lot_id)), b => b.qty), 1), sub: 'del lote y sus derivados' }]));
    const g = h('div', { class: 'grid c2' });
    g.appendChild(card('Hacia atrás', h('div', null, nodeView(back), (() => { const o = farmOrigin(l.id); return o ? notice(`De nuestra granja a tu mesa: ${o.species}, beneficio ${F.date(o.slaughter_date)}, ${o.farm_name} (lote ${o.lot_code}).`, 'ok') : null; })())));
    g.appendChild(card('Hacia adelante · lotes derivados', fw.descendants.length ? table({ id: 'etq04-desc', search: false, columns: [{ key: 'lot', label: 'Lote', mono: true, value: d => lot(d.lot_id).code }, { key: 'v', label: 'Producto', value: d => G.variantName(lot(d.lot_id).variant_id) }, { key: 'from', label: 'Desde', mono: true, value: d => lot(d.parent).code }, { key: 'kg', label: 'kg', align: 'r', render: d => F.num(d.kg, 1) }, { key: 'order', label: 'Orden', mono: true }, { key: 'st', label: 'Estado', render: d => status(lot(d.lot_id).qc_status) }], rows: fw.descendants, onRow: d => G.go('ETQ-04', { lot: d.lot_id }) }) : G.ui.empty('Sin lotes derivados.')));
    body.appendChild(g);
    body.appendChild(card('Hacia adelante · clientes, pedidos y comprobantes', table({ id: 'etq04-sales', columns: [{ key: 'date', label: 'Fecha', render: s => F.date(s.date) }, { key: 'lot', label: 'Lote', mono: true, value: s => lot(s.lot_id).code }, { key: 'cust', label: 'Cliente', value: s => G.custName(s.customer_id) }, { key: 'phone', label: 'Celular', value: s => (G.db.get('customers', s.customer_id) || {}).phone }, { key: 'ord', label: 'Pedido', mono: true, value: s => s.sales_order_id ? (G.db.get('sales_orders', s.sales_order_id) || {}).number : s.source === 'CONSIGNMENT' ? 'Consignación' : '—' }, { key: 'doc', label: 'Comprobante', mono: true, value: s => s.sales_document_id ? (G.db.get('sales_documents', s.sales_document_id) || {}).full_number : '—' }, { key: 'qty', label: 'Cant.', align: 'r', render: s => F.num(s.qty, 3) }, { key: 'weight_kg', label: 'kg', align: 'r', render: s => F.num(s.weight_kg, 3) }],
      rows: fw.sales.sort(U.by('date', -1)), empty: 'Ningún pedido, comprobante ni entrega en consignación lleva este lote.' }), { flush: true }));
  }

  /* ---------- ETQ-05 Retiros ---------- */
  const recallStats = rc => { const cs = G.db.where('lot_recall_contacts', c => c.recall_id === rc.id); const done = cs.filter(c => c.status !== 'PENDING').length; return { cs, done, total: cs.length, kg: R(U.sum(cs, c => c.weight_kg || 0), 3), rec: R(U.sum(cs, c => c.recovered_kg || 0), 3) }; };
  function rETQ05(el) {
    const body = page(el, { code: 'ETQ-05', title: 'Retiros de lote', sub: 'Lista de retiros con su estado, lotes, clientes afectados y avance del contacto.', actions: [{ label: 'Nuevo retiro', kind: 'danger', icon: '+', onClick: () => G.go('ETQ-06') }] });
    const rows = G.db.all('lot_recalls').sort(U.by('initiated_at', -1));
    const open = rows.filter(r => r.status === 'OPEN');
    body.appendChild(kpis([{ label: 'Retiros abiertos', value: open.length, tone: open.length ? 'bad' : 'ok' }, { label: 'Contactos pendientes', value: U.sum(open, r => recallStats(r).total - recallStats(r).done), tone: 'warn' }, { label: 'Recuperación (año)', value: F.pct((G.kpi('KPI-ETQ-02', { from: '2026-01-01' }) || {}).value), sub: 'KPI-ETQ-02' }, { label: 'Minutos para listar clientes', value: F.num((G.kpi('KPI-ETQ-01', { from: '2026-01-01' }) || {}).value, 0), sub: 'KPI-ETQ-01 (promedio)' }]));
    body.appendChild(table({ id: 'etq05', columns: [{ key: 'number', label: 'N.º', mono: true }, { key: 'initiated_at', label: 'Inicio', render: r => F.datetime(r.initiated_at) }, { key: 'reason', label: 'Motivo' }, { key: 'risk_class', label: 'Riesgo', render: r => sb(r.risk_class) }, { key: 'lots', label: 'Lotes', value: r => G.db.where('lot_recall_lots', x => x.recall_id === r.id).map(x => lot(x.lot_id).code).join(', ') }, { key: 'cl', label: 'Clientes', align: 'r', value: r => new Set(recallStats(r).cs.map(c => c.customer_id)).size }, { key: 'av', label: 'Avance', render: r => { const s = recallStats(r); return h('div', { style: 'min-width:120px' }, G.ui.progress(s.total ? s.done / s.total * 100 : 100, s.done === s.total ? 'ok' : 'warn'), h('span', { class: 'small' }, `${s.done} de ${s.total}`)); } }, { key: 'kg', label: 'kg recuperados', align: 'r', value: r => { const s = recallStats(r); return `${F.num(s.rec, 2)} / ${F.num(s.kg, 2)}`; } }, { key: 'status', label: 'Estado', render: r => status(r.status) }],
      rows, onRow: r => G.go('ETQ-07', { id: r.id }) }));
  }

  /* ---------- ETQ-06 Nuevo retiro ---------- */
  function rETQ06(el, params) {
    const body = page(el, { code: 'ETQ-06', title: 'Nuevo retiro', sub: 'Motivo, clase de riesgo, lotes e inclusión de lotes derivados, con la vista previa de clientes a contactar y stock que se bloquea. Iniciarlo exige el permiso etq.recall.start y queda en la auditoría (RN-ETQ-13).' });
    if (!G.can('etq.recall.start')) body.appendChild(notice(`Tu rol (${G.roleName()}) puede ver la vista previa, pero iniciar el retiro es de Calidad o Gerencia (etq.recall.start).`, 'warn'));
    const st = { lots: params.lot ? [params.lot] : [], inc: true, reason: '', risk: 'CLASS_II' };
    const left = h('div', { class: 'stack' }), right = h('div', { class: 'stack' });
    body.appendChild(h('div', { class: 'grid c2' }, left, right));
    function draw() {
      G.ui.clear(left); G.ui.clear(right);
      left.appendChild(card('Lotes a retirar', h('div', { class: 'stack' }, lotPicker({}, l => { if (!st.lots.includes(l.id)) st.lots.push(l.id); draw(); }, l => l.qc_status !== 'RECALLED'),
        st.lots.length ? h('div', { class: 'stack', style: 'gap:4px' }, st.lots.map(id => h('div', { class: 'row between' }, h('span', null, h('b', { class: 'mono' }, lot(id).code), ' ', G.variantName(lot(id).variant_id), ' ', status(lot(id).qc_status)), btn('Quitar', () => { st.lots = st.lots.filter(x => x !== id); draw(); }, { sm: true, kind: 'ghost' })))) : G.ui.empty('Agrega al menos un lote.'))));
      const f = form({ id: 'etq06-f', values: { reason: st.reason, risk_class: st.risk, include: st.inc }, fields: [{ key: 'reason', label: 'Motivo del retiro', type: 'textarea', required: true, onChange: x => { st.reason = x; } }, { key: 'risk_class', label: 'Clase de riesgo', type: 'select', options: RISK, required: true, onChange: x => { st.risk = x; } }, { key: 'include', label: 'Incluir todos los lotes derivados', type: 'checkbox', onChange: x => { st.inc = x; draw(); } }],
        submitLabel: 'Iniciar retiro', onSubmit: () => { const rc = startRecall({ lot_ids: st.lots, include_descendants: st.inc, reason: st.reason, risk_class: st.risk }); const s = recallStats(rc); toast(`Retiro ${rc.number} iniciado: lotes RECALLED y ${s.total} contacto(s) por avisar`, 'ok'); G.go('ETQ-07', { id: rc.id }); return true; } });
      left.appendChild(card('Datos del retiro', f));
      if (!st.lots.length) return;
      const pv = recallPreview(st.lots, st.inc);
      right.appendChild(kpis([{ label: 'Lotes que pasan a RECALLED', value: pv.lot_ids.length, sub: pv.descendants.length ? `${pv.descendants.length} derivado(s)` : 'sin derivados' }, { label: 'Clientes a contactar', value: new Set(pv.contacts.map(c => c.customer_id)).size, sub: `${pv.contacts.length} entregas` }, { label: 'kg vendidos', value: F.num(U.sum(pv.contacts, c => c.weight_kg), 3) }, { label: 'Stock que se bloquea', value: F.num(U.sum(pv.stock, b => b.qty), 1), sub: `${pv.stock.length} saldo(s)` }]));
      right.appendChild(card('Lotes', table({ id: 'etq06-lots', search: false, columns: [{ key: 'c', label: 'Lote', mono: true, value: id => lot(id).code }, { key: 'v', label: 'Producto', value: id => G.variantName(lot(id).variant_id) }, { key: 'd', label: 'Tipo', value: id => pv.descendants.includes(id) ? 'Derivado' : 'Elegido' }, { key: 's', label: 'Estado actual', render: id => status(lot(id).qc_status) }], rows: pv.lot_ids })));
      right.appendChild(card('Stock que se bloquea', pv.stock.length ? table({ id: 'etq06-stk', search: false, columns: [{ key: 'wh', label: 'Almacén', value: b => G.whName(b.warehouse_id) }, { key: 'lot', label: 'Lote', mono: true, value: b => lot(b.lot_id).code }, { key: 'qty', label: 'Cant.', align: 'r', render: b => F.num(b.qty, 3) }, { key: 'res', label: 'Reservado', align: 'r', render: b => F.num(b.reserved_qty || 0, 3) }], rows: pv.stock }) : G.ui.empty('Sin stock en almacenes.')));
      right.appendChild(card('Clientes a contactar', table({ id: 'etq06-cts', search: false, columns: [{ key: 'cust', label: 'Cliente', value: c => G.custName(c.customer_id) }, { key: 'lot', label: 'Lote', mono: true, value: c => lot(c.lot_id).code }, { key: 'doc', label: 'Pedido / comprobante', value: c => c.sales_document_id ? (G.db.get('sales_documents', c.sales_document_id) || {}).full_number : c.sales_order_id ? (G.db.get('sales_orders', c.sales_order_id) || {}).number : 'Consignación' }, { key: 'kg', label: 'kg', align: 'r', render: c => F.num(c.weight_kg, 3) }], rows: pv.contacts, empty: 'Ningún cliente recibió estos lotes.' })));
    }
    draw();
  }

  /* ---------- ETQ-07 Seguimiento ---------- */
  function rETQ07(el, params) {
    const all = G.db.all('lot_recalls').sort(U.by('initiated_at', -1));
    const rc = G.db.get('lot_recalls', params.id) || all.find(r => r.status === 'OPEN') || all[0];
    const body = page(el, { code: 'ETQ-07', title: 'Seguimiento del retiro', sub: 'Por cliente: pedido, comprobante, kg, contacto con la plantilla de WhatsApp del CRM, resultado y kg recuperados. Se cierra con todos los contactos en estado final y un resumen (RN-ETQ-08).' });
    if (!rc) { body.appendChild(G.ui.empty('No hay retiros.')); return; }
    const sel = h('select', { class: 'input', style: 'max-width:360px', attrs: { 'aria-label': 'Retiro' } }, all.map(r => h('option', { value: r.id, selected: r.id === rc.id }, `${r.number} · ${G.ui.statusLabel(r.status)} · ${r.reason.slice(0, 40)}`)));
    sel.addEventListener('change', () => G.go('ETQ-07', { id: sel.value }));
    const s = recallStats(rc);
    const open = rc.status === 'OPEN';
    body.appendChild(h('div', { class: 'row between' }, sel, h('div', { class: 'row' }, open ? btn('Avisar a pendientes por WhatsApp', () => run(() => { let n = 0; for (const c of s.cs.filter(c => c.status === 'PENDING')) { try { notifyContact(c.id); n++; } catch (e) { } } toast(`${n} aviso(s) enviados con la plantilla ${G.param('etq_recall_whatsapp_template')}`, 'ok'); }), { kind: 'primary', sm: true }) : null, open && !rc.authority_notified_at ? btn('Registrar aviso a la autoridad', () => run(() => G.db.update('lot_recalls', rc.id, { authority_notified_at: nowIso() }), 'Aviso a la autoridad sanitaria registrado'), { sm: true }) : null)));
    body.appendChild(kpis([{ label: 'Estado', value: G.ui.statusLabel(rc.status), sub: MY[rc.risk_class][0] }, { label: 'Avance de contacto', value: `${s.done} de ${s.total}`, sub: F.pct(s.total ? s.done / s.total * 100 : 100) }, { label: 'kg recuperados', value: F.num(s.rec, 3), sub: `de ${F.num(s.kg, 3)} kg vendidos (${F.pct(s.kg ? s.rec / s.kg * 100 : null)})` }, { label: 'Lista de clientes', value: rc.contacts_listed_at ? `${F.num(Math.max(0, (Date.parse(rc.contacts_listed_at) - Date.parse(rc.initiated_at)) / 60000), 0)} min` : '—', sub: 'KPI-ETQ-01' }]));
    body.appendChild(dl([['Motivo', rc.reason], ['Lotes', G.db.where('lot_recall_lots', x => x.recall_id === rc.id).map(x => `${lot(x.lot_id).code}${x.is_descendant ? ' (derivado)' : ''} · antes ${G.ui.statusLabel(x.previous_status)} · stock ${F.num(x.remaining_qty, 1)}`).join(' · ')], ['Iniciado', `${F.datetime(rc.initiated_at)} · ${G.userName(rc.initiated_by)}`], ['Aviso a la autoridad', rc.authority_notified_at ? F.datetime(rc.authority_notified_at) : 'Pendiente'], ['Pedidos con reserva rehecha', (rc.affected_orders || []).join(', ') || null], ['Cierre', rc.closed_at ? `${F.datetime(rc.closed_at)} · ${G.userShort(rc.closed_by)}: ${rc.closing_summary}` : null]]));
    body.appendChild(table({ id: 'etq07', columns: [{ key: 'cust', label: 'Cliente', value: c => G.custName(c.customer_id) }, { key: 'phone', label: 'Celular', value: c => (G.db.get('customers', c.customer_id) || {}).phone }, { key: 'lot', label: 'Lote', mono: true, value: c => lot(c.lot_id).code }, { key: 'ord', label: 'Pedido', mono: true, value: c => c.sales_order_id ? (G.db.get('sales_orders', c.sales_order_id) || {}).number : '—' }, { key: 'doc', label: 'Comprobante', mono: true, value: c => c.sales_document_id ? (G.db.get('sales_documents', c.sales_document_id) || {}).full_number : '—' }, { key: 'weight_kg', label: 'kg', align: 'r', render: c => F.num(c.weight_kg, 3) }, { key: 'recovered_kg', label: 'Recuperado', align: 'r', render: c => c.recovered_kg != null ? F.num(c.recovered_kg, 3) : '—' }, { key: 'contact_notes', label: 'Contacto', render: c => h('span', { class: 'small' }, c.contact_notes || '') }, { key: 'status', label: 'Estado', render: c => sb(c.status), value: c => c.status }],
      rows: s.cs, filters: [{ key: 'status', label: 'Estado', options: CONTACT_ST }],
      actions: c => open ? [c.status === 'PENDING' ? btn('WhatsApp', () => run(() => notifyContact(c.id), 'Aviso enviado'), { sm: true, kind: 'primary' }) : null, btn('Resultado', () => resultModal(c), { sm: true })].filter(Boolean) : [] }));
    if (open) body.appendChild(card('Cerrar el retiro', form({ id: 'etq07-close', fields: [{ key: 'summary', label: 'Resumen escrito (obligatorio)', type: 'textarea', required: true }], submitLabel: 'Cerrar retiro', onSubmit: v => { closeRecall(rc.id, v.summary); toast(`Retiro ${rc.number} cerrado`, 'ok'); G.refresh(); return true; } })));
  }
  function resultModal(c) {
    modal(`Resultado · ${G.custName(c.customer_id)}`, (b, close) => b.appendChild(form({ id: 'etq07-res', values: { status: c.status === 'PENDING' ? 'CONTACTED' : c.status, recovered_kg: c.recovered_kg ?? c.weight_kg }, fields: [{ key: 'status', label: 'Resultado', type: 'select', options: CONTACT_ST, required: true }, { key: 'recovered_kg', label: `kg recuperados (vendidos ${F.num(c.weight_kg, 3)})`, type: 'number', min: 0 }, { key: 'notes', label: 'Notas', type: 'textarea' }], submitLabel: 'Guardar', onCancel: close, onSubmit: v => { setContact(c.id, v.status, { recovered_kg: v.recovered_kg, notes: v.notes }); close(); toast('Contacto actualizado', 'ok'); G.refresh(); return true; } })), []);
  }

  /* ---------- ETQ-08 Página pública ---------- */
  function rETQ08(el, params) {
    const body = page(el, { code: 'ETQ-08', title: 'Página pública del QR', sub: 'Lo que ve el cliente al escanear el QR, sin inicio de sesión: producto, marca, lote, fechas, registro sanitario y, si viene de Granja Don Guando, «de nuestra granja a tu mesa». Nunca precios, clientes ni costos (RN-ETQ-09).' });
    let l = lot(params.lot) || (params.token ? lot((G.db.find('lot_qr_tokens', t => t.token === params.token) || {}).lot_id) : null) || G.db.find('lots', x => x.code === 'CU-2026-1008') || G.db.find('lots', x => x.qc_status === 'RELEASED');
    body.appendChild(lotPicker({ code: l ? l.code : '' }, x => G.go('ETQ-08', { lot: x.id })));
    if (!l) return;
    const t = tokenFor(l.id, true);
    const pg = publicLotPage(t.token);
    const phone = h('div', { class: 'phone' }); const scr = h('div', { class: 'phone-screen', style: 'padding:0' }); phone.appendChild(scr);
    scr.appendChild(h('div', { class: 'small mono', style: 'padding:6px 10px;background:var(--bg);border-bottom:1px solid var(--line, #ddd);overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, qrUrl(t.token)));
    if (!pg.available) scr.appendChild(h('div', { style: 'padding:24px;text-align:center' }, h('h2', null, 'Lote no disponible'), h('p', null, pg.message)));
    else {
      scr.appendChild(h('div', { style: `background:${pg.brand_color || 'var(--primary)'};color:#fff;padding:18px 16px` }, h('div', { style: 'font-size:12px;opacity:.85' }, pg.brand), h('div', { style: 'font-size:20px;font-weight:700' }, pg.product)));
      const c = h('div', { style: 'padding:14px 16px;display:grid;gap:10px' });
      if (pg.recalled) c.appendChild(notice([h('b', null, 'Aviso de retiro. '), pg.recall_notice], 'bad'));
      if (pg.origin) c.appendChild(h('div', { class: 'card', style: 'padding:12px;border-left:4px solid var(--ok)' }, h('b', null, 'De nuestra granja a tu mesa'), h('div', { class: 'small' }, `${pg.origin.species} criado en ${pg.origin.farm_name}.`), h('div', { class: 'small' }, `Fecha de beneficio: ${F.date(pg.origin.slaughter_date)}`)));
      c.appendChild(dl([['Lote', pg.lot], ['Producción', F.date(pg.production_date)], ['Vence', F.date(pg.expiry_date)], ['Registro sanitario', pg.sanitary_registry ? `${pg.sanitary_authority} ${pg.sanitary_registry}` : 'No aplica'], ['Conservación', pg.storage], ['Alérgenos', pg.allergens]]));
      c.appendChild(h('div', { class: 'small muted' }, '¿Dudas sobre tu producto? Escríbenos por WhatsApp.'));
      scr.appendChild(c);
    }
    const keys = Object.keys(pg);
    body.appendChild(h('div', { class: 'grid c2' }, phone, card('Datos que expone public_lot_page', h('div', { class: 'stack' }, G.ui.qr(qrUrl(t.token), 140), h('div', { class: 'small' }, 'Campos devueltos: ', h('span', { class: 'mono' }, keys.join(', '))), notice(`Sin precio, costo, cliente ni pedido (${['price', 'cost', 'customer', 'customer_id', 'order'].filter(k => keys.includes(k)).length ? 'REVISAR' : 'verificado'}). Un lote ${l.qc_status === 'RELEASED' || l.qc_status === 'RECALLED' ? 'liberado o retirado sí se muestra' : 'que no está liberado ni retirado no se muestra'} (RN-ETQ-09).`, 'info')))));
  }

  /* ---------- ETQ-09 Tablero ---------- */
  function rETQ09(el) {
    const body = page(el, { code: 'ETQ-09', title: 'Tablero de trazabilidad', sub: 'Indicadores KPI-ETQ-01 a KPI-ETQ-03: rapidez para listar clientes en un retiro, recuperación y reimpresiones por local.' });
    const y = { from: '2026-01-01' };
    const k1 = G.kpi('KPI-ETQ-01', y) || {}, k2 = G.kpi('KPI-ETQ-02', y) || {}, k3 = G.kpi('KPI-ETQ-03') || {};
    body.appendChild(kpis([{ label: 'KPI-ETQ-01 · Minutos para listar clientes', value: F.num(k1.value, 0), sub: `promedio de ${k1.denominator ?? 0} retiro(s) del año`, onClick: () => G.go('ETQ-05') }, { label: 'KPI-ETQ-02 · Recuperación en retiros', value: F.pct(k2.value), sub: `${F.num(k2.numerator, 2)} de ${F.num(k2.denominator, 2)} kg`, onClick: () => G.go('ETQ-07') }, { label: 'KPI-ETQ-03 · Reimpresiones', value: F.pct(k3.value), sub: `${k3.numerator ?? 0} de ${k3.denominator ?? 0} impresiones del mes`, onClick: () => G.go('ETQ-03') }]));
    const m = G.db.where('label_prints', p => p.printed_at >= G.date.month(G.TODAY));
    const g = h('div', { class: 'grid c2' });
    g.appendChild(card('Reimpresiones por local (%)', G.ui.chart.hbar({ items: G.db.all('establishments').map(e => { const ps = m.filter(p => p.establishment_id === e.id); return { label: e.short, value: ps.length ? R(ps.filter(p => p.reprint_of).length / ps.length * 100, 1) : 0 }; }), format: v => F.pct(v) })));
    g.appendChild(card('Etiquetas impresas en el mes por marca', G.ui.chart.hbar({ items: G.db.all('brands').map(b => ({ label: b.name.split(' · ')[0], value: U.sum(m.filter(p => (G.variant(p.variant_id) || {}).brand_id === b.id), p => p.copies) })), format: v => F.num(v) })));
    const days = []; for (let d = G.date.month(G.TODAY); d <= G.TODAY; d = G.date.add(d, 1)) days.push(d);
    g.appendChild(card('Impresiones por día', G.ui.chart.bar({ labels: days.map(d => d.slice(8, 10)), series: [{ name: 'Originales', values: days.map(d => m.filter(p => p.printed_at.startsWith(d) && !p.reprint_of).length) }, { name: 'Reimpresiones', values: days.map(d => m.filter(p => p.printed_at.startsWith(d) && p.reprint_of).length) }], stacked: true, format: v => F.num(v) })));
    g.appendChild(card('Retiros', table({ id: 'etq09-rc', search: false, columns: [{ key: 'number', label: 'N.º', mono: true }, { key: 'risk_class', label: 'Riesgo', render: r => sb(r.risk_class) }, { key: 'm', label: 'Min. para listar', align: 'r', value: r => r.contacts_listed_at ? Math.round((Date.parse(r.contacts_listed_at) - Date.parse(r.initiated_at)) / 60000) : '—' }, { key: 'rec', label: 'Recuperación', align: 'r', value: r => { const s = recallStats(r); return F.pct(s.kg ? s.rec / s.kg * 100 : null); } }, { key: 'status', label: 'Estado', render: r => status(r.status) }], rows: G.db.all('lot_recalls'), onRow: r => G.go('ETQ-07', { id: r.id }) }), { flush: true }));
    body.appendChild(g);
  }

  /* ---------- registro ---------- */
  const S = G.SPEC.ETQ;
  const nameOf = c => (S.screens.find(s => s[0] === c) || [c, c])[1];
  const RENDER = { 'ETQ-01': rETQ01, 'ETQ-02': rETQ02, 'ETQ-03': rETQ03, 'ETQ-04': rETQ04, 'ETQ-05': rETQ05, 'ETQ-06': rETQ06, 'ETQ-07': rETQ07, 'ETQ-08': rETQ08, 'ETQ-09': rETQ09 };
  G.register({ code: 'ETQ', name: 'Etiquetas y trazabilidad', phase: 2, group: 'Producción y calidad', screens: Object.keys(RENDER).map(code => ({ code, name: nameOf(code), render: RENDER[code] })) });

  /* ---------- indicadores ---------- */
  const inP = (s, p) => { const d = String(s || '').slice(0, 10); return d >= p.from && d <= p.to; };
  G.kpiCalc['KPI-ETQ-01'] = p => { const rs = G.db.where('lot_recalls', r => r.contacts_listed_at && inP(r.initiated_at, p)); const mins = rs.map(r => (Date.parse(r.contacts_listed_at) - Date.parse(r.initiated_at)) / 60000); return { value: rs.length ? R(U.sum(mins) / rs.length, 1) : null, numerator: R(U.sum(mins), 1), denominator: rs.length }; };
  G.kpiCalc['KPI-ETQ-02'] = p => { const ids = new Set(G.db.where('lot_recalls', r => inP(r.initiated_at, p)).map(r => r.id)); const cs = G.db.where('lot_recall_contacts', c => ids.has(c.recall_id)); const sold = R(U.sum(cs, c => c.weight_kg || 0), 3), rec = R(U.sum(cs, c => c.recovered_kg || 0), 3); return { value: sold ? R(rec / sold * 100, 1) : null, numerator: rec, denominator: sold }; };
  G.kpiCalc['KPI-ETQ-03'] = p => { const ps = G.db.where('label_prints', x => inP(x.printed_at, p) && (!p.site || x.establishment_id === p.site) && (!p.brand || (G.variant(x.variant_id) || {}).brand_id === p.brand)); const rp = ps.filter(x => x.reprint_of).length; return { value: ps.length ? R(rp / ps.length * 100, 1) : null, numerator: rp, denominator: ps.length }; };

  /* ---------- alertas, búsqueda y escáner ---------- */
  G.alertProviders.push(() => {
    if (!G.modOn('ETQ') || !G.canSee('ETQ')) return [];
    const out = [];
    for (const rc of G.db.where('lot_recalls', r => r.status === 'OPEN')) { const s = recallStats(rc); out.push({ module: 'ETQ', title: `Retiro ${rc.number} abierto: ${s.total - s.done} contacto(s) pendiente(s)`, detail: rc.reason, tone: s.total - s.done ? 'bad' : 'warn', go: () => G.go('ETQ-07', { id: rc.id }) }); }
    const noTpl = G.db.all('brands').filter(b => b.status === 'ACTIVE' && !G.db.find('label_templates', t => t.brand_id === b.id && t.status === 'ACTIVE'));
    if (noTpl.length) out.push({ module: 'ETQ', title: `${noTpl.length} marca(s) sin plantilla de etiqueta activa`, detail: noTpl.map(b => b.name).join(', '), tone: 'warn', go: () => G.go('ETQ-01') });
    return out;
  });
  G.searchProviders.push(q => { const s = q.toLowerCase(); return G.db.where('lots', l => l.code.toLowerCase().includes(s)).slice(0, 5).map(l => ({ label: l.code, sub: 'Lote · ' + G.variantName(l.variant_id) + ' · ' + G.ui.statusLabel(l.qc_status), go: () => G.go('ETQ-04', { lot: l.id }) })).concat(G.db.where('lot_recalls', r => r.number.toLowerCase().includes(s)).map(r => ({ label: r.number, sub: 'Retiro de lote', go: () => G.go('ETQ-07', { id: r.id }) }))); });
  G.scanHandlers.push(code => {
    const l = lotByCode(code); if (l) return () => G.go('ETQ-04', { lot: l.id });
    const rc = G.db.find('lot_recalls', r => r.number === code); if (rc) return () => G.go('ETQ-07', { id: rc.id });
    const sc = decodeScale(code); if (sc) return () => toast(`Etiqueta de balanza: ${sc.variant.name} · ${F.num(sc.kg, 3)} kg (PLU ${sc.variant.scale_plu})`, 'info');
    const tok = G.db.find('lot_qr_tokens', t => code.endsWith('/' + t.token.toUpperCase()) || code === t.token.toUpperCase()); if (tok) return () => G.go('ETQ-08', { lot: tok.lot_id });
    return null;
  });

  /* =====================================================================
     Pruebas de aceptación (una por CA-ETQ)
     ===================================================================== */
  const asRole = async (role, fn) => { const prev = G.ctx.role; G.ctx.role = role; try { return await fn(); } finally { G.ctx.role = prev; } };
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (!String(e.message).startsWith(code)) throw new Error(`Se esperaba ${code} y salió: ${e.message}`); return e; } throw new Error(`Se esperaba el rechazo ${code} y la operación pasó.`); };
  const ch = () => lotByCode('CH-2026-0412'), cp = () => lotByCode('CP-2026-0310');
  G.tests.push({ module: 'ETQ', name: 'CA-ETQ-01: CH-2026-0412 en cuarentena se etiqueta; RECALLED se rechaza con RN-ETQ-01', fn: async () => {
    const l = ch(); if (l.qc_status !== 'QUARANTINE') throw new Error('CH-2026-0412 debe estar en cuarentena.');
    const tpl = G.db.find('label_templates', t => t.code === 'ETQ-M3-100X50');
    const p = G.etq.printLabels({ template_id: tpl.id, lot_id: l.id, copies: 60, printer_code: 'IMP-L2-01' });
    if (!p || p.copies !== 60) throw new Error('No se imprimió.');
    G.db.update('lots', l.id, { qc_status: 'RECALLED' });
    expectFail(() => G.etq.printLabels({ template_id: tpl.id, lot_id: l.id, copies: 1, printer_code: 'IMP-L2-01' }), 'RN-ETQ-01');
  } });
  G.tests.push({ module: 'ETQ', name: 'CA-ETQ-02: la trazabilidad hacia atrás del chorizo CH-2026-0412 muestra el lote CP-2026-0310 del camal y su proveedor', fn: async () => {
    const t = G.etq.traceBackward(ch().id);
    const par = t.parents.find(x => x.lot.code === 'CP-2026-0310');
    if (!par) throw new Error('No aparece CP-2026-0310 hacia atrás.');
    const sup = G.db.get('suppliers', par.supplier_id);
    if (!sup || sup.supplier_type !== 'SLAUGHTERHOUSE') throw new Error('El proveedor del lote debe ser el camal.');
  } });
  G.tests.push({ module: 'ETQ', name: 'CA-ETQ-03: retiro de CP-2026-0310 con derivados deja CP y CH-2026-0412 RECALLED y crea 3 contactos (3 boletas)', fn: async () => {
    const l = ch();
    await asRole('CALIDAD', () => { if (G.cal) G.cal.release(l.id); else G.db.update('lots', l.id, { qc_status: 'RELEASED' }); });
    const custs = G.db.where('customers', c => c.customer_type === 'PERSON' && c.doc_type === 'DNI').slice(5, 8);
    for (const c of custs) { G.inv.move({ type: 'SALE', wh: 'wh-PRD-L2', variant: l.variant_id, lot: l.id, qty: 2, source: { type: 'TEST', id: 'ca-etq-03' } }); G.docs.issue({ doc_type: 'RECEIPT', brand_id: 'br-M3', establishment_id: 'es-L1', customer_id: c.id, lines: [{ variant_id: l.variant_id, description: 'Chorizo parrillero 500 g', qty: 2, uom_code: 'NIU', unit_price: 24, total: 48, igv_affectation: '10', lot_id: l.id }] }); }
    const rc = await asRole('CALIDAD', () => G.etq.recall({ lot_ids: [cp().id], include_descendants: true, reason: 'Carne de cerdo con resultado positivo a Salmonella en el camal', risk_class: 'CLASS_I' }));
    if (cp().qc_status !== 'RECALLED' || ch().qc_status !== 'RECALLED') throw new Error('Ambos lotes deben quedar RECALLED.');
    const cs = G.db.where('lot_recall_contacts', c => c.recall_id === rc.id);
    if (cs.length !== 3) throw new Error('Se esperaban 3 contactos; hay ' + cs.length);
    if (!G.db.find('domain_events', e => e.name === 'lot.recalled' && e.payload.lot_id === ch().id)) throw new Error('No se emitió lot.recalled del derivado.');
    if (G.inv.lotUsable(ch().id)) throw new Error('El stock del lote retirado debe quedar bloqueado.');
    const m = G.etq.notifyContact(cs[0].id); if (m.template !== G.param('etq_recall_whatsapp_template') || m.kind !== 'UTILITY') throw new Error('El aviso debe usar la plantilla de utilidad del CRM.');
  } });
  G.tests.push({ module: 'ETQ', name: 'CA-ETQ-04: un retiro con un contacto PENDING no se cierra (RN-ETQ-08)', fn: async () => {
    const rc = G.db.find('lot_recalls', r => r.status === 'OPEN');
    if (!G.db.find('lot_recall_contacts', c => c.recall_id === rc.id && c.status === 'PENDING')) throw new Error('El retiro sembrado debe tener contactos pendientes.');
    expectFail(() => G.etq.closeRecall(rc.id, 'Resumen'), 'RN-ETQ-08');
    for (const c of G.db.where('lot_recall_contacts', x => x.recall_id === rc.id && x.status === 'PENDING')) G.etq.setContact(c.id, 'NOT_REACHABLE', { notes: 'Sin respuesta' });
    G.etq.closeRecall(rc.id, 'Todos los clientes avisados');
    if (G.db.get('lot_recalls', rc.id).status !== 'CLOSED') throw new Error('Con todos los contactos en estado final debió cerrarse.');
  } });
  G.tests.push({ module: 'ETQ', name: 'CA-ETQ-05: una plantilla ACTIVE sin {{sanitary_registry}} se rechaza con RN-ETQ-03', fn: async () => {
    expectFail(() => G.etq.saveTemplate({ brand_id: 'br-DG', code: 'ETQ-PRUEBA', name: 'Prueba', format: 'ZPL', width_mm: 100, height_mm: 50, includes_qr: true, status: 'ACTIVE', body: '{{brand}} {{product}} {{net_weight}} {{lot}} {{production_date}} {{expiry_date}} {{qr}}' }), 'RN-ETQ-03');
    const d = G.db.find('label_templates', t => t.code === 'ETQ-M5-NUEVA');
    expectFail(() => G.etq.saveTemplate(Object.assign({}, d, { status: 'ACTIVE' }), d), 'RN-ETQ-03');
  } });
  G.tests.push({ module: 'ETQ', name: 'CA-ETQ-06: el QR de un lote de cuy de la Granja Don Guando muestra «de nuestra granja a tu mesa» con la fecha de beneficio, sin precios ni clientes', fn: async () => {
    const l = lotByCode('CU-2026-1008'); const t = G.etq.tokenFor(l.id);
    const pg = G.etq.publicLotPage(t.token);
    if (!pg.available || !pg.origin || pg.origin.slaughter_date !== '2026-10-07' || !/Granja Don Guando/.test(pg.origin.farm_name)) throw new Error('Falta el origen de la granja con la fecha de beneficio.');
    const txt = JSON.stringify(pg).toLowerCase();
    if (['price', 'cost', 'customer', 'order', 'precio', 's/ '].some(k => txt.includes(k))) throw new Error('La página pública expone precios, costos o clientes.');
    if (G.etq.salesOfLots([l.id]).length < 1) throw new Error('El lote debe tener clientes (para comprobar que no se muestran).');
    const q = G.etq.publicLotPage(G.etq.tokenFor('lo-Q001').token); if (q.available) throw new Error('Un lote en cuarentena no se muestra (RN-ETQ-09).');
  } });
  G.tests.push({ module: 'ETQ', name: 'RN-ETQ-11: precio de la etiqueta = S/ por kg × peso real redondeado a S/ 0,10 y código 2+0+PLU+gramos', fn: async () => {
    const v = G.variant('va-DG-CUY-ENT'); const p = G.etq.priceFor(v.id, 0.987, 'COUNTER');
    if (p.per_kg !== 42 || p.price !== 41.5) throw new Error('42 × 0,987 = 41,454 → S/ 41,50; salió ' + p.price);
    const bc = G.etq.scaleBarcode(v.scale_plu, 0.987); const dec = G.etq.decodeScale(bc);
    if (!bc.startsWith('2') || !dec || dec.variant.id !== v.id || dec.kg !== 0.987) throw new Error('Código de balanza mal formado: ' + bc);
  } });
})();
