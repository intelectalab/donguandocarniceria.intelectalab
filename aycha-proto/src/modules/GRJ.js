/* =====================================================================
   GRJ · Integración con el SaaS de Granja Don Guando (fase 2)
   Hoy la granja comparte el RUC: sus envíos llegan con NTI sin IGV (serie NI01).
   Tras el spin-off facturará con su RUC propio: el documento esperado lo decide
   la fecha (RN-GRJ-02). Webhook idempotente, mapeo de ítems, recepción con lote
   de origen (galpón y lote de la granja), diferencias de peso y conciliación.
   Tablas propias: farm_links, farm_product_mappings, farm_dispatches,
   farm_dispatch_lines, farm_reconciliations.
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, toast, form, tabs: uiTabs, empty } = G.ui;

  /* pestañas como hijo de una grilla: min-width 0 para que su tabla haga scroll propio y no desborde a 390 px */
  const tabs = (...a) => { const t = uiTabs(...a); t.style.minWidth = '0'; return t; };
  const U = G.util, F = G.fmt, R = (n, d = 2) => U.round(n, d);
  const MOD = 'GRJ';
  const FARM = 'su-GRANJA';
  const TENANT_REF = 'granja-donguando';
  const igvRate = () => { const r = G.tax.rate(); return r < 0.05 ? r * 100 : r; };
  const LBL = { RECEIVED_PENDING: ['Por recibir', 'warn'], RECEIVED: ['Recibido', 'ok'], DISPUTED: ['En disputa', 'bad'], RECONCILED: ['Conciliado', ''], ERROR: ['Con error', 'bad'], OPEN: ['Abierta', 'info'], AGREED: ['Acordada', 'warn'], CLOSED: ['Cerrada', 'ok'], ACTIVE: ['Vigente', 'ok'], SCHEDULED: ['Programado', 'info'], ENDED: ['Terminado', ''], FAKE: ['Simulado', 'info'], DISABLED: ['Apagado', ''], INACTIVE: ['Inactivo', ''], NTI: ['NTI sin IGV', 'info'], INVOICE: ['Factura con IGV', 'warn'] };
  const st = s => LBL[s] ? badge(LBL[s][0], LBL[s][1]) : G.ui.status(s);
  const dateOnly = s => String(s || '').slice(0, 10);
  const uid = () => G.ctx.userId();
  const company = () => G.db.get('companies', 'co-dg') || {};
  const perm = (p, what) => { if (!G.can(p)) throw new Error(`Tu rol (${G.roleName()}) no tiene el permiso ${p} para ${what}.`); };
  const tryDo = (fn, ok) => { try { const r = fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); G.refresh(); return r || true; } catch (e) { toast(e.message, 'bad'); return null; } };
  const tol = () => Number(G.param('grj_weight_tolerance_pct'));
  const linesOf = id => G.db.where('farm_dispatch_lines', l => l.dispatch_id === id);
  const mapOf = (sid, code) => G.db.find('farm_product_mappings', m => m.supplier_id === sid && m.farm_item_code === code && m.status === 'ACTIVE');
  const docOf = d => d.purchase_document_id ? G.db.get('purchase_documents', d.purchase_document_id) : null;
  const linkStatus = l => l.status === 'CLOSED' ? 'CLOSED' : l.valid_from > G.TODAY ? 'SCHEDULED' : l.valid_to && l.valid_to < G.TODAY ? 'ENDED' : 'ACTIVE';

  /* ---------- vínculos y documento esperado (RN-GRJ-01/02/03/10) ---------- */
  function linkAt(supplierId, date) { return G.db.find('farm_links', l => l.supplier_id === supplierId && l.status !== 'CLOSED' && l.valid_from <= date && (!l.valid_to || l.valid_to >= date)); }
  /** grj_expected_doc_type(proveedor, fecha): lo decide la fecha, no el usuario */
  function expectedDocType(supplierId, date) { const l = linkAt(supplierId, dateOnly(date)); return l ? l.mode : null; }
  const overlaps = (a1, a2, b1, b2) => a1 <= (b2 || '9999-12-31') && b1 <= (a2 || '9999-12-31');
  function createLink(d, opts = {}) {
    if (!opts.system) perm('grj.link.manage', 'crear vínculos con la granja');
    const s = G.db.get('suppliers', d.supplier_id); if (!s) throw new Error('Elige el proveedor de la granja.');
    if (!['NTI', 'INVOICE'].includes(d.mode)) throw new Error('El modo es NTI o INVOICE.');
    if (!d.valid_from) throw new Error('Indica desde cuándo rige el vínculo.');
    if (d.valid_to && d.valid_to < d.valid_from) throw new Error('La vigencia termina antes de empezar.');
    const ruc = String(d.farm_ruc || (d.mode === 'NTI' ? s.doc_number : '')).trim();
    const own = company().ruc;
    if (d.mode === 'NTI' && ruc !== own) G.fail('RN-GRJ-03', `Un vínculo NTI solo vale si la granja tiene el mismo RUC de la empresa (${own}); ${s.trade_name || s.legal_name} tiene ${ruc || 'otro RUC'}: el modo debe ser INVOICE.`);
    if (d.mode === 'INVOICE') { if (!U.rucOk(ruc)) G.fail('RN-GRJ-03', `Con factura, la granja necesita su RUC propio válido (${ruc || 'vacío'}).`); if (ruc === own) G.fail('RN-GRJ-03', 'Con el mismo RUC de la empresa no hay factura entre ambas: el modo es NTI.'); }
    const clash = G.db.find('farm_links', l => l.supplier_id === s.id && l.status !== 'CLOSED' && overlaps(l.valid_from, l.valid_to, d.valid_from, d.valid_to));
    if (clash) G.fail('RN-GRJ-01', `Se superpone con el vínculo ${clash.mode} vigente ${F.date(clash.valid_from)} – ${clash.valid_to ? F.date(clash.valid_to) : 'sin fin'}: los vínculos de un mismo proveedor no se superponen.`);
    return G.db.insert('farm_links', { id: opts.id, supplier_id: s.id, company_id: 'co-dg', mode: d.mode, valid_from: d.valid_from, valid_to: d.valid_to || null, farm_tenant_ref: d.farm_tenant_ref || TENANT_REF, farm_ruc: ruc, farm_legal_name: d.farm_legal_name || s.legal_name, connector_status: d.connector_status || 'FAKE', status: 'ACTIVE', created_by: opts.user || uid(), last_webhook_at: null, notes: d.notes || null }, { silent: !!opts.silent });
  }
  /** Cambio a factura (spin-off): cierra el NTI en la fecha de corte y abre INVOICE desde el día siguiente (RN-GRJ-10) */
  function spinOff({ cut_date, new_ruc, legal_name, supplier_id = FARM }) {
    perm('grj.link.manage', 'hacer el cambio a factura');
    if (!cut_date) throw new Error('Elige la fecha de corte.');
    if (G.date.add(cut_date, 1).slice(8, 10) !== '01') G.fail('RN-GRJ-10', `La fecha de corte debe ser el último día de un mes (${F.date(cut_date)} no lo es).`);
    const nti = linkAt(supplier_id, cut_date);
    if (!nti || nti.mode !== 'NTI') G.fail('RN-GRJ-10', 'No hay un vínculo NTI vigente en la fecha de corte.');
    const after = G.db.find('farm_dispatches', d => d.farm_link_id === nti.id && dateOnly(d.dispatched_at) > cut_date);
    if (after) G.fail('RN-GRJ-10', `Ya hay una NTI posterior al corte (${after.farm_document_number}, ${F.date(after.dispatched_at)}): elige un corte posterior.`);
    if (G.period.isClosed(G.date.add(cut_date, 1))) G.fail('RN-GRJ-10', 'El día siguiente al corte cae en un período cerrado.');
    const prevTo = nti.valid_to;
    G.db.update('farm_links', nti.id, { valid_to: cut_date, spin_off_cut: cut_date });
    try {
      const inv = createLink({ supplier_id, mode: 'INVOICE', valid_from: G.date.add(cut_date, 1), valid_to: prevTo && prevTo > cut_date ? prevTo : null, farm_ruc: new_ruc, farm_legal_name: legal_name || 'GRANJA DON GUANDO SAC', farm_tenant_ref: nti.farm_tenant_ref, notes: `Spin-off: corte ${F.date(cut_date)}` });
      G.audit('SPIN_OFF', 'farm_links', inv.id, `NTI hasta ${cut_date}; factura del RUC ${new_ruc} desde ${G.date.add(cut_date, 1)}`);
      return inv;
    } catch (e) { G.db.update('farm_links', nti.id, { valid_to: prevTo, spin_off_cut: null }, { silent: true }); throw e; }
  }
  function undoSpinOff() {
    perm('grj.link.manage', 'deshacer el cambio a factura');
    const inv = G.db.find('farm_links', l => l.supplier_id === FARM && l.mode === 'INVOICE' && l.status !== 'CLOSED');
    if (!inv) throw new Error('No hay un cambio a factura programado.');
    if (inv.valid_from <= G.TODAY) throw new Error('El vínculo con factura ya rige: no se deshace.');
    if (G.db.find('farm_dispatches', d => d.farm_link_id === inv.id)) throw new Error('Ya hay envíos con factura.');
    G.db.update('farm_links', inv.id, { status: 'CLOSED', notes: 'Programación deshecha' });
    const nti = G.db.find('farm_links', l => l.supplier_id === FARM && l.mode === 'NTI' && l.spin_off_cut);
    if (nti) G.db.update('farm_links', nti.id, { valid_to: null, spin_off_cut: null });
  }

  /* ---------- mapeo de ítems (RN-GRJ-05) ---------- */
  function mapItem({ farm_item_code, farm_item_name, variant_id, conversion_factor = 1, transfer_price }, opts = {}) {
    if (!opts.system) perm('grj.mapping.manage', 'mapear productos de la granja');
    if (!farm_item_code || !variant_id) throw new Error('Indica el código de la granja y la variante de Aycha.');
    if (!(Number(conversion_factor) > 0)) throw new Error('El factor de conversión debe ser mayor que cero.');
    const ex = G.db.find('farm_product_mappings', m => m.supplier_id === FARM && m.farm_item_code === farm_item_code);
    const row = ex ? G.db.update('farm_product_mappings', ex.id, { variant_id, farm_item_name: farm_item_name || ex.farm_item_name, conversion_factor: Number(conversion_factor), transfer_price: transfer_price != null && transfer_price !== '' ? Number(transfer_price) : ex.transfer_price, status: 'ACTIVE' })
      : G.db.insert('farm_product_mappings', { supplier_id: FARM, farm_item_code, farm_item_name: farm_item_name || farm_item_code, variant_id, conversion_factor: Number(conversion_factor), transfer_price: transfer_price != null && transfer_price !== '' ? Number(transfer_price) : null, status: 'ACTIVE' }, { silent: !!opts.silent });
    if (!opts.silent) for (const d of G.db.where('farm_dispatches', x => x.status === 'RECEIVED_PENDING' && !x.purchase_document_id)) reprocess(d.id);
    return row;
  }
  function unmappedItems() {
    const out = {};
    for (const l of G.db.all('farm_dispatch_lines')) if (!mapOf(FARM, l.farm_item_code)) { const o = out[l.farm_item_code] = out[l.farm_item_code] || { code: l.farm_item_code, name: l.farm_item_name, count: 0, kg: 0 }; o.count++; o.kg += l.sent_weight_kg; }
    return Object.values(out);
  }

  /* ---------- webhook del SaaS de Granja (RN-GRJ-02/04/05/11) ---------- */
  /** FarmProvider con implementación falsa: arma el payload como lo enviaría el SaaS de Granja */
  const provider = {
    nextNumber() { const nums = G.db.all('farm_dispatches').map(d => Number(String(d.farm_document_number).split('-')[1]) || 0); return 'NI01-' + U.pad(Math.max(200, ...nums) + 1, 6); },
    build({ number, date, items, order_ref }) {
      const sid = FARM; const mode = expectedDocType(sid, date) || 'NTI';
      return { event: 'farm.dispatch_issued', farm_tenant: TENANT_REF, document_type: mode, document_number: mode === 'NTI' ? number : number.replace(/^NI01/, 'F001'), dispatched_at: date + 'T06:' + U.pad(10 + (number.length * 7) % 40, 2), signature_valid: true, order_ref: order_ref || null, issuer_ruc: (linkAt(sid, date) || {}).farm_ruc || company().ruc,
        lines: items.map((it, i) => ({ item_code: it.code, item_name: it.name, lot_code: it.lot || `GDG-G0${(i % 4) + 1}-L26${U.pad((Number(number.slice(-3)) % 40) + 1, 2)}`, origin: it.origin || { granja: 'Granja Don Guando · Pachacámac', galpon: 'Galpón ' + ((i % 4) + 1), lote_crianza: 'Lote 26-' + U.pad((Number(number.slice(-3)) % 40) + 1, 2), fecha_beneficio: G.date.add(date, -1), animales: it.qty || null, sanitario: 'SENASA · guía de tránsito interno' }, qty: it.qty || null, weight_kg: it.kg, unit_price: it.price })) };
    },
    confirm(d) { return { event: 'aycha.dispatch_received', document: d.farm_document_number, received_at: d.received_at, lines: linesOf(d.id).map(l => ({ item_code: l.farm_item_code, sent_kg: l.sent_weight_kg, received_kg: l.received_weight_kg, difference_pct: l.difference_pct, reason: l.difference_reason })) }; },
  };
  function ingest(payload, opts = {}) {
    const p = payload || {};
    const key = `${p.farm_tenant || '?'}:${p.document_type || '?'}:${p.document_number || '?'}`;
    const dup = G.db.find('farm_dispatches', d => d.idempotency_key === key);
    if (dup) { G.db.update('farm_dispatches', dup.id, { duplicates_received: (dup.duplicates_received || 0) + 1, last_duplicate_at: opts.at || G.date.now() }, { silent: true }); return { duplicate: true, dispatch: dup }; }
    const link0 = G.db.find('farm_links', l => l.farm_tenant_ref === p.farm_tenant && l.status !== 'CLOSED');
    const sid = link0 ? link0.supplier_id : FARM;
    const date = dateOnly(p.dispatched_at || G.TODAY);
    const link = linkAt(sid, date) || link0;
    const expected = expectedDocType(sid, date);
    const sent = R(U.sum(p.lines || [], l => Number(l.weight_kg) || 0), 3);
    const value = R(U.sum(p.lines || [], l => (Number(l.weight_kg) || 0) * (Number(l.unit_price) || 0)));
    const d = G.db.insert('farm_dispatches', { id: opts.id, farm_link_id: link ? link.id : null, idempotency_key: key, farm_document_type: p.document_type || 'NTI', farm_document_number: p.document_number || '—', dispatched_at: p.dispatched_at || G.date.now(), expected_doc_type: expected, total_sent_kg: sent, total_value: value, raw_payload: JSON.parse(JSON.stringify(p)), status: 'RECEIVED_PENDING', error_message: null, purchase_receipt_id: null, purchase_document_id: null, received_at: null, source: opts.source || 'WEBHOOK', arrived_at: opts.at || G.date.now(), order_ref: p.order_ref || null, duplicates_received: 0, was_disputed: false }, { silent: !!opts.silent });
    if (link) G.db.update('farm_links', link.id, { last_webhook_at: opts.at || G.date.now() }, { silent: true });
    const err = msg => { G.db.update('farm_dispatches', d.id, { status: 'ERROR', error_message: msg }, { silent: true }); return { duplicate: false, dispatch: G.db.get('farm_dispatches', d.id), error: msg }; };
    if (p.signature_valid === false) return err('RN-GRJ-11: la firma del webhook no es válida; se guardó crudo y no se procesó. Pide a la granja reenviarlo.');
    if (!link) return err('No hay un vínculo vigente con la granja para la fecha del envío (GRJ-01).');
    if (!(p.lines || []).length) return err('RN-GRJ-11: el envío llegó sin líneas.');
    if (expected && p.document_type !== expected) return err(`RN-GRJ-02: el ${F.date(date)} el documento esperado es ${expected === 'NTI' ? 'NTI sin IGV' : 'factura del RUC de la granja'} y llegó ${p.document_type}. El tipo lo decide la fecha, no quien emite.`);
    for (const l of p.lines) {
      const m = mapOf(sid, l.item_code);
      G.db.insert('farm_dispatch_lines', { dispatch_id: d.id, farm_item_code: l.item_code, farm_item_name: l.item_name || l.item_code, farm_lot_code: l.lot_code || '—', farm_origin: l.origin || {}, sent_qty: l.qty != null ? Number(l.qty) : null, sent_weight_kg: R(Number(l.weight_kg), 3), unit_price: R(Number(l.unit_price) || (m && m.transfer_price) || 0, 6), mapping_id: m ? m.id : null, received_qty: null, received_weight_kg: null, temp_c: null, lot_id: null, difference_pct: null, difference_reason: null }, { silent: true });
    }
    reprocess(d.id, opts);
    if (!G._seeding && !opts.silent) G.events.emit('farm_dispatch.arrived', { dispatch_id: d.id, number: d.farm_document_number });
    return { duplicate: false, dispatch: G.db.get('farm_dispatches', d.id) };
  }
  /** vuelve a procesar un envío: mapeo y comprobante en COM (NTI sin IGV o factura con IGV según la fecha) */
  function reprocess(id, opts = {}) {
    const d = G.db.get('farm_dispatches', id); if (!d || d.purchase_document_id) return d;
    if (d.status === 'ERROR' && /RN-GRJ-0[2]|RN-GRJ-11|vínculo/.test(d.error_message || '') && !opts.force) return d;
    const ls = linesOf(id);
    const link = G.db.get('farm_links', d.farm_link_id); const sid = link ? link.supplier_id : FARM;
    for (const l of ls) { const m = mapOf(sid, l.farm_item_code); if (m && l.mapping_id !== m.id) G.db.update('farm_dispatch_lines', l.id, { mapping_id: m.id, unit_price: l.unit_price || m.transfer_price || 0 }, { silent: true }); }
    const un = linesOf(id).filter(l => !l.mapping_id);
    if (un.length) { G.db.update('farm_dispatches', id, { status: 'RECEIVED_PENDING', error_message: `RN-GRJ-05: ítems sin mapear: ${un.map(l => `${l.farm_item_code} (${l.farm_item_name})`).join(', ')}. Mapéalos en GRJ-02 para recibir el envío.` }, { silent: true }); return G.db.get('farm_dispatches', id); }
    const date = dateOnly(d.dispatched_at); const mode = d.expected_doc_type || expectedDocType(sid, date) || 'NTI';
    const [series, number] = String(d.farm_document_number).split('-');
    const lines = linesOf(id).map(l => { const m = G.db.get('farm_product_mappings', l.mapping_id); return { variant_id: m.variant_id, description: `${l.farm_item_name} · lote granja ${l.farm_lot_code}`, qty: l.sent_weight_kg, unit_price: l.unit_price }; });
    try {
      let doc;
      if (G.com && G.com.registerDocument) doc = G.com.registerDocument({ supplier_id: sid, doc_type: mode === 'NTI' ? 'INTERNAL_TRANSFER' : 'INVOICE', series: series || 'NI01', number: number || d.farm_document_number, issue_date: date, accounting_date: date, establishment_id: 'es-L2', brand_id: 'br-DG', cost_center_id: 'cc-PROD-L2', lines, farm_dispatch_id: id, notes: `Envío de la granja ${d.farm_document_number}` }, { system: true, user: opts.user, at: opts.at, silent: true });
      else {
        const sub = R(U.sum(lines, l => l.qty * l.unit_price)); const igv = mode === 'NTI' ? 0 : R(sub * igvRate());
        doc = G.db.insert('purchase_documents', { company_id: 'co-dg', supplier_id: sid, establishment_id: 'es-L2', brand_id: 'br-DG', cost_center_id: 'cc-PROD-L2', doc_type: mode === 'NTI' ? 'INTERNAL_TRANSFER' : 'INVOICE', sunat_doc_type: mode === 'NTI' ? '00' : '01', series: series || 'NI01', number: String(number || '').replace(/^0+(?=\d)/, ''), issue_date: date, accounting_date: date, currency: 'PEN', exchange_rate: 1, base_taxed: mode === 'NTI' ? 0 : sub, igv, non_taxed: mode === 'NTI' ? sub : 0, other_charges: 0, total: R(sub + igv), igv_is_credit: mode !== 'NTI', match_status: 'NOT_CHECKED', status: 'REGISTERED', paid_amount: 0, balance: mode === 'NTI' ? 0 : R(sub + igv), farm_dispatch_id: id }, { silent: true });
      }
      G.db.update('farm_dispatches', id, { purchase_document_id: doc.id, status: d.status === 'ERROR' ? 'RECEIVED_PENDING' : d.status, error_message: null }, { silent: true });
    } catch (e) { G.db.update('farm_dispatches', id, { status: 'ERROR', error_message: e.message }, { silent: true }); }
    return G.db.get('farm_dispatches', id);
  }

  /* ---------- recepción de un envío (RN-GRJ-05/06/07) ---------- */
  /** diferencia de una línea: kg recibidos vs enviados */
  const diffPct = (sent, recv) => sent ? R((Number(recv) - Number(sent)) / Number(sent) * 100, 3) : 0;
  /* Respaldo sin COM (build aislado): misma forma que G.com.postReceipt; valida temperatura (RN-COM-02),
     crea el lote de origen y entra al stock por G.inv.move (RN-ALM-01). */
  const storageMax = p => p.storage === 'FROZEN' ? Number(G.param('com_frozen_max_c') ?? -18) : p.storage === 'CHILLED' ? Number(G.param('com_chilled_max_c') ?? 4) : null;
  function postReceiptLite(d, opts = {}) {
    const wh = G.db.get('warehouses', d.warehouse_id); if (!wh) throw new Error('Elige el almacén de destino.');
    const at = d.received_at || G.date.now(); const date = dateOnly(at);
    if (!G._seeding) G.period.assertOpen(date);
    const id = U.uid('prc'); const number = G.db.next('RC', 'RC-', 5);
    const pending = d.inspection === 'PENDING'; const rlines = [];
    for (const l of d.lines || []) {
      const v = G.variant(l.variant_id); const p = v && G.db.get('products', v.product_id); if (!v || !p) throw new Error('Producto no encontrado en la recepción.');
      const max = storageMax(p); const temp = l.temp_c === '' || l.temp_c == null ? null : Number(l.temp_c);
      if (max != null && temp == null) G.fail('RN-COM-02', `${v.name} es ${p.storage === 'FROZEN' ? 'congelado' : 'refrigerado'}: registra su temperatura al recibirlo.`);
      if (max != null && temp > max + 1e-9 && (l.decision || 'ACCEPT') === 'ACCEPT') G.fail('RN-COM-02', `${v.name} llegó a ${F.num(temp, 1)} °C y el máximo es ${F.num(max, 1)} °C: rechaza la línea o envíala a decisión de calidad.`);
      const weight = l.weight_kg != null ? R(l.weight_kg, 3) : null; const total = R((weight != null ? weight : l.qty) * (Number(l.unit_price) || 0));
      let lot = null, mv = null;
      if (p.requires_lot) lot = G.db.insert('lots', { product_id: p.id, variant_id: v.id, code: 'G' + date.replace(/-/g, '').slice(2) + '-' + number.slice(-4) + String.fromCharCode(65 + rlines.length), origin: 'FARM', supplier_id: d.supplier_id, production_date: l.production_date || date, expiry_date: G.date.add(date, p.shelf_life_days || 7), qc_status: pending ? 'QUARANTINE' : 'RELEASED', unit_cost: Number(l.unit_price) || 0, cost_basis: 'KG', received_weight_kg: weight, supplier_lot_code: l.supplier_lot_code || null, farm_lot_code: l.farm_lot_code || null, farm_origin: l.farm_origin || null, released_at: pending ? null : at, released_by: pending ? null : 'Inspección de recepción', receipt_id: id }, { silent: true });
      if (!opts.historical) { const r = G.inv.move({ type: 'RECEIPT', wh: wh.id, variant: v.id, lot: lot ? lot.id : null, qty: l.qty, weight: v.sale_mode === 'UNIT' ? null : weight, unitCost: l.qty ? total / l.qty : 0, source: { type: 'FARM_RECEIPT', id }, at, reason: `Recepción ${number} · Granja`, allowUnreleased: true }); mv = r.moves[0]; }
      rlines.push(G.db.insert('purchase_receipt_lines', { receipt_id: id, po_line_id: null, variant_id: v.id, lot_id: lot ? lot.id : null, supplier_lot_code: l.supplier_lot_code || null, expiry_date: lot ? lot.expiry_date : null, qty: l.qty || 0, weight_kg: weight, temp_c: temp, unit_cost: Number(l.unit_price) || 0, price_basis: 'KG', total_cost: total, accepted: true, quality_hold: false, rejection_reason: null, over_receipt_reason: null, over_pct: 0, stock_movement_id: mv ? mv.id : null }, { silent: true }));
    }
    return G.db.insert('purchase_receipts', { id, number, company_id: 'co-dg', establishment_id: wh.establishment_id, warehouse_id: wh.id, supplier_id: d.supplier_id, po_id: null, receipt_type: d.receipt_type, received_at: at, received_by: opts.user || uid(), vehicle_temp_c: d.vehicle_temp_c == null || d.vehicle_temp_c === '' ? null : Number(d.vehicle_temp_c), carrier_guide: d.carrier_guide || null, scale_equipment_id: d.scale || null, inspection_id: null, inspection_result: d.inspection || 'OK', status: 'POSTED', historical: !!opts.historical, total_cost: R(U.sum(rlines, x => x.total_cost)), document_id: null, farm_dispatch_id: d.farm_dispatch_id || null, notes: d.notes || null }, { silent: !!opts.silent });
  }
  function receive(id, data = {}, opts = {}) {
    if (!opts.system) perm('grj.dispatch.receive', 'recibir envíos de la granja');
    const d = G.db.get('farm_dispatches', id); if (!d) throw new Error('Envío no encontrado.');
    if (d.status !== 'RECEIVED_PENDING') throw new Error(`El envío ${d.farm_document_number} está «${LBL[d.status][0]}»: no está por recibir.`);
    const ls = linesOf(id);
    const un = ls.filter(l => !l.mapping_id);
    if (un.length) G.fail('RN-GRJ-05', `No se recibe una línea con un ítem de la granja sin mapear: ${un.map(l => l.farm_item_code).join(', ')}. Mapéalo en GRJ-02.`);
    if (!d.purchase_document_id) { reprocess(id); if (!G.db.get('farm_dispatches', id).purchase_document_id) throw new Error(G.db.get('farm_dispatches', id).error_message || 'El envío aún no tiene su documento.'); }
    const inputs = new Map((data.lines || []).map(x => [x.id, x]));
    const t = tol();
    const evals = ls.map(l => {
      const x = inputs.get(l.id) || {};
      const recvKg = x.received_weight_kg === '' || x.received_weight_kg == null ? null : Number(x.received_weight_kg);
      if (!(recvKg >= 0) || recvKg === null) throw new Error(`Registra los kg recibidos de ${l.farm_item_name}.`);
      const dp = diffPct(l.sent_weight_kg, recvKg);
      const reason = String(x.reason || '').trim();
      if (Math.abs(dp) > t + 1e-9 && !reason) G.fail('RN-GRJ-07', `${l.farm_item_name}: se enviaron ${F.kg(l.sent_weight_kg, 1)} y llegaron ${F.kg(recvKg, 1)} (${dp > 0 ? '+' : ''}${F.pct(dp, 2)}), más que la tolerancia de ${F.pct(t, 0)}: indica el motivo; el envío quedará en disputa con la granja.`);
      return { l, x, recvKg, dp, reason, over: Math.abs(dp) > t + 1e-9 };
    });
    const link = G.db.get('farm_links', d.farm_link_id);
    const wh = data.warehouse_id || 'wh-CAM-L2';
    const at = data.received_at || opts.at || G.date.now();
    let rc = null;
    if (!opts.existingReceipt) {
      rc = (G.com && G.com.postReceipt ? G.com.postReceipt : postReceiptLite)({ supplier_id: link ? link.supplier_id : FARM, warehouse_id: wh, received_at: at, vehicle_temp_c: data.vehicle_temp_c, carrier_guide: d.farm_document_number, scale: data.scale || 'BAL-L2-01', inspection: data.inspection || 'PENDING', receipt_type: (d.expected_doc_type || 'NTI') === 'NTI' ? 'FARM_NTI' : 'FARM_INVOICE', farm_dispatch_id: id, notes: `Envío de la granja ${d.farm_document_number}`,
        lines: evals.map(({ l, x, recvKg }) => { const m = G.db.get('farm_product_mappings', l.mapping_id); const v = G.variant(m.variant_id); const qty = v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? (Number(x.received_qty) || l.sent_qty || Math.round(recvKg / (v.nominal_weight_kg || 1))) : v.sale_mode === 'KG' ? recvKg : (Number(x.received_qty) || l.sent_qty); return { variant_id: m.variant_id, qty, weight_kg: recvKg * Number(m.conversion_factor || 1), temp_c: x.temp_c, price_basis: 'KG', unit_price: l.unit_price / Number(m.conversion_factor || 1), decision: x.decision || 'ACCEPT', farm_lot_code: l.farm_lot_code, farm_origin: Object.assign({ granja_documento: d.farm_document_number }, l.farm_origin), supplier_lot_code: l.farm_lot_code, production_date: (l.farm_origin || {}).fecha_beneficio || dateOnly(at) }; }) }, { system: true, user: opts.user, historical: !!opts.historical, silent: !!opts.silent });
    } else rc = opts.existingReceipt;
    const rls = G.com && G.com.rcLines ? G.com.rcLines(rc.id) : G.db.where('purchase_receipt_lines', x => x.receipt_id === rc.id);
    evals.forEach(({ l, x, recvKg, dp, reason }, i) => G.db.update('farm_dispatch_lines', l.id, { received_qty: x.received_qty != null && x.received_qty !== '' ? Number(x.received_qty) : l.sent_qty, received_weight_kg: R(recvKg, 3), temp_c: x.temp_c === '' || x.temp_c == null ? null : Number(x.temp_c), lot_id: (rls[i] || {}).lot_id || x.lot_id || null, difference_pct: dp, difference_reason: reason || null }, { silent: true }));
    const disputed = evals.some(e => e.over);
    G.db.update('farm_dispatches', id, { status: disputed ? 'DISPUTED' : 'RECEIVED', was_disputed: disputed, received_at: at, received_by: opts.user || uid(), purchase_receipt_id: rc.id }, { silent: !!opts.silent });
    const doc = docOf(d); if (doc && !doc.receipt_id) G.db.update('purchase_documents', doc.id, { receipt_id: rc.id }, { silent: true });
    if (d.order_ref) { const po = G.db.find('purchase_orders', p => p.number === d.order_ref); if (po && ['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) G.db.update('purchase_orders', po.id, { status: 'RECEIVED', last_receipt_at: at, received_complete_at: at, history: (po.history || []).concat([{ at, user: G.userName(opts.user || uid()), action: `Recibida con el envío ${d.farm_document_number}` }]) }, { silent: true }); }
    G.db.update('farm_dispatches', id, { confirmation_sent_at: at, confirmation_payload: provider.confirm(G.db.get('farm_dispatches', id)) }, { silent: true });
    if (!G._seeding) {
      G.events.emit('farm_dispatch.received', { dispatch_id: id, number: d.farm_document_number, receipt_id: rc.id, disputed });
      if (disputed) { G.events.emit('farm_dispatch.disputed', { dispatch_id: id, number: d.farm_document_number }); for (const role of ['CONTADORA', 'COMPRAS']) G.notify({ role, title: `Envío ${d.farm_document_number} en disputa`, body: 'Diferencia de peso con la granja sobre la tolerancia (RN-GRJ-07).', ref: id, module: MOD, tone: 'warn' }); }
    }
    return G.db.get('farm_dispatches', id);
  }
  function resolveDispute(id, { decision, note }, opts = {}) {
    if (!G.can('grj.reconciliation.close') && !G.can('grj.link.manage') && !G.canDo(MOD, 'E')) throw new Error(`Tu rol (${G.roleName()}) no puede registrar acuerdos con la granja.`);
    const d = G.db.get('farm_dispatches', id); if (!d || d.status !== 'DISPUTED') throw new Error('El envío no está en disputa.');
    if (!String(note || '').trim()) throw new Error('Indica el acuerdo con la granja.');
    const ls = linesOf(id);
    const kgDiff = R(U.sum(ls, l => (l.received_weight_kg || 0) - l.sent_weight_kg), 3);
    const valDiff = R(U.sum(ls, l => ((l.received_weight_kg || 0) - l.sent_weight_kg) * l.unit_price));
    G.db.update('farm_dispatches', id, { status: 'RECEIVED', agreement: { decision, note, kg_difference: kgDiff, value_difference: valDiff, by: opts.user || uid(), at: opts.at || G.date.now() } }, { silent: !!opts.silent });
    return G.db.get('farm_dispatches', id);
  }

  /* ---------- conciliación mensual (RN-GRJ-09) ---------- */
  function monthDispatches(period) { const m = period.slice(0, 7); return G.db.where('farm_dispatches', d => String(d.dispatched_at).slice(0, 7) === m); }
  function reconcileData(period) {
    const ds = monthDispatches(period);
    const recv = ds.filter(d => ['RECEIVED', 'DISPUTED', 'RECONCILED'].includes(d.status));
    const byProd = {};
    const issues = [];
    for (const d of recv) for (const l of linesOf(d.id)) {
      const m = l.mapping_id ? G.db.get('farm_product_mappings', l.mapping_id) : null;
      const k = m ? m.variant_id : l.farm_item_code;
      const o = byProd[k] = byProd[k] || { key: k, name: m ? G.variantName(m.variant_id) : l.farm_item_name, sent_kg: 0, received_kg: 0, sent_value: 0, received_value: 0, lines: 0 };
      o.sent_kg += l.sent_weight_kg; o.received_kg += l.received_weight_kg || 0; o.sent_value += l.sent_weight_kg * l.unit_price; o.received_value += (l.received_weight_kg || 0) * l.unit_price; o.lines++;
      if (Math.abs(l.difference_pct || 0) > tol() + 1e-9 && !l.difference_reason) issues.push({ type: 'NO_REASON', d, l });
    }
    for (const d of ds.filter(x => x.status === 'DISPUTED')) issues.push({ type: 'DISPUTED', d });
    for (const d of ds.filter(x => x.status === 'RECEIVED_PENDING')) issues.push({ type: 'PENDING', d });
    for (const d of ds.filter(x => x.status === 'ERROR')) issues.push({ type: 'ERROR', d });
    const rows = Object.values(byProd).map(o => Object.assign(o, { sent_kg: R(o.sent_kg, 3), received_kg: R(o.received_kg, 3), sent_value: R(o.sent_value), received_value: R(o.received_value) }));
    return { rows, issues, sent_kg: R(U.sum(rows, r => r.sent_kg), 3), received_kg: R(U.sum(rows, r => r.received_kg), 3), sent_value: R(U.sum(rows, r => r.sent_value)), received_value: R(U.sum(rows, r => r.received_value)), dispatches: ds.length };
  }
  function reconRow(period) { return G.db.find('farm_reconciliations', r => r.period === G.date.month(period)); }
  function upsertRecon(period, patch = {}, opts = {}) {
    const p = G.date.month(period); const data = reconcileData(p);
    const link = linkAt(FARM, G.date.add(G.date.addMonths(p, 1), -1)) || linkAt(FARM, p) || G.db.find('farm_links', l => l.supplier_id === FARM);
    const base = { farm_link_id: link ? link.id : null, period: p, sent_kg: data.sent_kg, received_kg: data.received_kg, sent_value: data.sent_value, received_value: data.received_value, difference_kg: R(data.received_kg - data.sent_kg, 3), difference_value: R(data.received_value - data.sent_value) };
    const ex = reconRow(p);
    if (ex) return G.db.update('farm_reconciliations', ex.id, Object.assign(base, patch), { silent: !!opts.silent });
    return G.db.insert('farm_reconciliations', Object.assign({ status: 'OPEN', notes: null, closed_by: null }, base, patch), { silent: !!opts.silent });
  }
  function agree(period, note, opts = {}) {
    if (!G.can('grj.reconciliation.close') && !G.canDo(MOD, 'E')) throw new Error(`Tu rol (${G.roleName()}) no registra acuerdos con la granja.`);
    if (!String(note || '').trim()) throw new Error('Describe el acuerdo con la granja.');
    const data = reconcileData(period);
    const blocking = data.issues.filter(i => i.type === 'DISPUTED' || i.type === 'NO_REASON');
    if (blocking.length) G.fail('RN-GRJ-09', `Hay ${blocking.length} diferencia(s) sin motivo o en disputa: resuélvelas antes de acordar el mes.`);
    return upsertRecon(period, { status: 'AGREED', notes: note, agreed_by: opts.user || uid(), agreed_at: opts.at || G.date.now() }, opts);
  }
  function closeRecon(period, opts = {}) {
    perm('grj.reconciliation.close', 'cerrar la conciliación con la granja');
    const data = reconcileData(period);
    const bad = data.issues.filter(i => i.type !== 'ERROR');
    if (bad.length) G.fail('RN-GRJ-09', `La conciliación de ${G.date.monthName(period)} tiene ${bad.length} pendiente(s) (disputas, diferencias sin motivo o envíos por recibir): no se cierra.`);
    const r = reconRow(period);
    if (!r || r.status !== 'AGREED') G.fail('RN-GRJ-09', 'Primero registra el acuerdo con la granja (estado ACORDADA).');
    for (const d of monthDispatches(period).filter(x => x.status === 'RECEIVED')) G.db.update('farm_dispatches', d.id, { status: 'RECONCILED' }, { silent: true });
    return upsertRecon(period, { status: 'CLOSED', closed_by: opts.user || uid(), closed_at: G.date.now() }, opts);
  }
  /** para el cierre contable (CNT-12): el mes de la granja no cierra con diferencias sin motivo */
  function reconciliationOk(period) {
    const p = G.date.month(period);
    if (!monthDispatches(p).length) return { ok: true, detail: 'Sin envíos de la granja en el mes.' };
    const r = reconRow(p);
    if (r && r.status === 'CLOSED') return { ok: true, detail: `Conciliación cerrada: ${F.kg(r.sent_kg, 1)} enviados, ${F.kg(r.received_kg, 1)} recibidos.` };
    const data = reconcileData(p);
    return { ok: false, detail: `Conciliación ${r ? LBL[r.status][0].toLowerCase() : 'sin abrir'}: ${data.issues.length} pendiente(s). Ciérrala en GRJ-05 (RN-GRJ-09).` };
  }

  /* ---------- pedidos a la granja ---------- */
  function createFarmOrder({ lines, expected_date, warehouse_id = 'wh-CAM-L2', notes }, opts = {}) {
    if (!G.com) throw new Error('COM no está disponible.');
    const ls = (lines || []).filter(l => l.farm_item_code && Number(l.kg) > 0).map(l => { const m = mapOf(FARM, l.farm_item_code); if (!m) G.fail('RN-GRJ-05', `El ítem ${l.farm_item_code} no está mapeado.`); return { variant_id: m.variant_id, qty: Number(l.kg), price_basis: 'KG', unit_price: m.transfer_price || 0 }; });
    const po = G.com.createPO({ supplier_id: FARM, warehouse_id, expected_date: expected_date || G.date.add(G.TODAY, 1), lines: ls, notes: notes || 'Pedido a la granja', order_date: opts.date }, opts);
    return G.com.submitPO(po.id, opts);
  }
  /** simula que la granja despacha (opcionalmente un pedido) y envía el webhook */
  function simulateDispatch({ po_id, date = G.TODAY } = {}) {
    const number = provider.nextNumber();
    let items;
    const r = U.rng(Number(number.slice(-4)) * 7);
    if (po_id) {
      const po = G.db.get('purchase_orders', po_id);
      items = G.com.poLines(po_id).map(l => { const m = G.db.find('farm_product_mappings', x => x.variant_id === l.variant_id && x.supplier_id === FARM); const kg = R(Number(l.est_weight_kg || l.qty) * (0.98 + r() * 0.03), 1); return { code: m ? m.farm_item_code : 'GR-?', name: m ? m.farm_item_name : G.variantName(l.variant_id), kg, qty: m && G.variant(m.variant_id).sale_mode === 'UNIT_VARIABLE_WEIGHT' ? Math.round(kg / (G.variant(m.variant_id).nominal_weight_kg || 1)) : Math.round(kg / 0.75), price: m ? m.transfer_price : l.unit_price }; });
      return ingest(provider.build({ number, date, items, order_ref: po.number }));
    }
    const kg = 150 + Math.floor(r() * 120);
    items = [{ code: 'GR-CUY-CAN', name: 'Cuy en canal', kg, qty: Math.round(kg / 0.75), price: (mapOf(FARM, 'GR-CUY-CAN') || {}).transfer_price || 24 }, { code: 'GR-CON-CAN', name: 'Conejo en canal', kg: 40 + Math.floor(r() * 30), qty: 30, price: (mapOf(FARM, 'GR-CON-CAN') || {}).transfer_price || 17.5 }];
    return ingest(provider.build({ number, date, items }));
  }

  /* ---------- indicadores ---------- */
  const inR = (s, p) => { const d = dateOnly(s); return d >= (p.from || '0000') && d <= (p.to || '9999'); };
  G.kpiCalc['KPI-GRJ-01'] = p => { const ds = new Set(G.db.where('farm_dispatches', d => d.received_at && inR(d.received_at, p)).map(d => d.id)); const ls = G.db.where('farm_dispatch_lines', l => ds.has(l.dispatch_id) && l.received_weight_kg != null); const sent = U.sum(ls, l => l.sent_weight_kg); const diff = U.sum(ls, l => Math.abs(l.sent_weight_kg - l.received_weight_kg)); return { value: sent ? R(diff / sent * 100, 2) : 0, numerator: R(diff, 3), denominator: R(sent, 3) }; };
  G.kpiCalc['KPI-GRJ-02'] = p => { const ds = G.db.where('farm_dispatches', d => d.received_at && inR(d.received_at, p)); const dis = ds.filter(d => d.status === 'DISPUTED' || d.was_disputed).length; return { value: ds.length ? R(dis / ds.length * 100, 1) : 0, numerator: dis, denominator: ds.length }; };
  function costCompare(p) {
    const rcs = new Map(G.db.where('purchase_receipts', r => r.status === 'POSTED' && inR(r.received_at, p)).map(r => [r.id, r]));
    const ls = G.db.where('purchase_receipt_lines', l => rcs.has(l.receipt_id) && l.accepted && l.weight_kg > 0);
    const by = {};
    for (const l of ls) { const r = rcs.get(l.receipt_id); const farm = (G.db.get('suppliers', r.supplier_id) || {}).supplier_type === 'RELATED_FARM'; const o = by[l.variant_id] = by[l.variant_id] || { variant_id: l.variant_id, fk: 0, fc: 0, ok: 0, oc: 0 }; if (farm) { o.fk += l.weight_kg; o.fc += l.total_cost; } else { o.ok += l.weight_kg; o.oc += l.total_cost; } }
    return Object.values(by).map(o => Object.assign(o, { farm: o.fk ? o.fc / o.fk : null, other: o.ok ? o.oc / o.ok : null }));
  }
  G.kpiCalc['KPI-GRJ-03'] = p => { const rows = costCompare(p).filter(o => o.farm != null && o.other != null); const num = U.sum(rows, o => o.fc); const den = U.sum(rows, o => o.fk * o.other); return { value: den ? R(num / den * 100, 1) : null, numerator: R(num), denominator: R(den) }; };

  /* ---------- interfaz ---------- */
  function monthPills(key) { G.grj._m = G.grj._m || {}; const cur = G.grj._m[key] || G.date.month(G.TODAY); return G.ui.pills([['2026-09-01', 'Setiembre 2026'], ['2026-10-01', 'Octubre 2026']], cur, v => { G.grj._m[key] = v; G.refresh(); }); }
  const curMonth = key => (G.grj._m || {})[key] || G.date.month(G.TODAY);
  const mRange = m => ({ from: m, to: m === G.date.month(G.TODAY) ? G.TODAY : G.date.add(G.date.addMonths(m, 1), -1) });
  function openDispatch(id) {
    const d = G.db.get('farm_dispatches', id); if (!d) return;
    drawer(`Envío ${d.farm_document_number}`, (b, close) => {
      const re = () => { close(); openDispatch(id); };
      const acts = h('div', { class: 'row' });
      if (d.status === 'RECEIVED_PENDING') acts.append(btn('Recibir (GRJ-04)', () => { close(); G.go('GRJ-04', { id }); }, { sm: true, kind: 'primary', disabled: !G.can('grj.dispatch.receive') }));
      if (['RECEIVED_PENDING', 'ERROR'].includes(d.status) && !d.purchase_document_id) acts.append(btn('Reprocesar', () => tryDo(() => reprocess(id, { force: true }), r => r.purchase_document_id ? 'Envío procesado' : (r.error_message || 'Sigue pendiente')) && re(), { sm: true }));
      if (d.status === 'DISPUTED') acts.append(btn('Registrar acuerdo', () => disputeModal(d, re), { sm: true, kind: 'accent' }));
      const doc = docOf(d);
      if (doc && G.com) acts.append(btn('Ver ' + (doc.doc_type === 'INTERNAL_TRANSFER' ? 'NTI' : 'factura') + ' (COM-07)', () => { close(); G.go('COM-07'); G.com.openDoc(doc.id); }, { sm: true, kind: 'ghost' }));
      if (d.purchase_receipt_id && G.com) acts.append(btn('Ver recepción (COM-06)', () => { close(); G.go('COM-06'); G.com.openReceipt(d.purchase_receipt_id); }, { sm: true, kind: 'ghost' }));
      b.append(acts);
      if (d.error_message) b.append(notice(d.error_message, d.status === 'ERROR' ? 'bad' : 'warn'));
      if (d.agreement) b.append(notice(`Acuerdo con la granja (${G.userName(d.agreement.by)}, ${F.datetime(d.agreement.at)}): ${d.agreement.note} · diferencia ${F.kg(d.agreement.kg_difference, 3)} / ${F.money(d.agreement.value_difference)}`, 'info'));
      b.append(dl([['Estado', st(d.status)], ['Documento de la granja', `${d.farm_document_type} ${d.farm_document_number}`], ['Documento esperado (RN-GRJ-02)', d.expected_doc_type ? st(d.expected_doc_type) : '—'], ['Despachado', F.datetime(d.dispatched_at)], ['Llegó por', d.source === 'MANUAL' ? 'Carga manual' : 'Webhook firmado'], ['Clave de idempotencia', h('span', { class: 'mono small' }, d.idempotency_key)], ['Duplicados recibidos', d.duplicates_received ? `${d.duplicates_received} (ignorados, RN-GRJ-04)` : '0'], ['Pedido', d.order_ref || '—'], ['Kg y valor enviados', `${F.kg(d.total_sent_kg, 3)} · ${F.money(d.total_value)}`], ['Comprobante en COM', doc ? `${G.com ? G.com.docLabel(doc) : doc.series + '-' + doc.number} · ${F.money(doc.total)} · IGV ${F.money(doc.igv)}` : 'Pendiente'], ['Recibido', d.received_at ? `${F.datetime(d.received_at)} · ${G.userName(d.received_by)}` : '—'], ['Confirmación a la granja', d.confirmation_sent_at ? 'Enviada ' + F.datetime(d.confirmation_sent_at) : '—']]));
      b.append(card('Líneas y lotes de origen', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Ítem de la granja', 'Lote de la granja', 'Enviado', 'Recibido', 'Dif.', 'Lote local'].map(x => h('th', null, x)))), h('tbody', null, linesOf(id).map(l => { const lot = l.lot_id ? G.db.get('lots', l.lot_id) : null; const o = l.farm_origin || {}; return h('tr', null, h('td', null, h('b', null, l.farm_item_code), h('div', { class: 'small' }, l.farm_item_name), l.mapping_id ? h('div', { class: 'muted small' }, '→ ' + G.variantName((G.db.get('farm_product_mappings', l.mapping_id) || {}).variant_id)) : badge('sin mapear', 'bad')), h('td', null, h('span', { class: 'mono' }, l.farm_lot_code), h('div', { class: 'muted small' }, [o.galpon, o.lote_crianza, o.fecha_beneficio ? 'benef. ' + F.date(o.fecha_beneficio) : null].filter(Boolean).join(' · '))), h('td', { class: 'r' }, F.kg(l.sent_weight_kg, 3), l.sent_qty ? h('div', { class: 'muted small' }, F.num(l.sent_qty) + ' u') : null), h('td', { class: 'r' }, l.received_weight_kg != null ? F.kg(l.received_weight_kg, 3) : '—', l.temp_c != null ? h('div', { class: 'muted small' }, F.num(l.temp_c, 1) + ' °C') : null), h('td', { class: 'r' }, l.difference_pct != null ? badge((l.difference_pct > 0 ? '+' : '') + F.pct(l.difference_pct, 2), Math.abs(l.difference_pct) > tol() ? 'bad' : 'ok') : '—', l.difference_reason ? h('div', { class: 'muted small' }, l.difference_reason) : null), h('td', { class: 'mono' }, lot ? lot.code : '—', lot ? h('div', null, G.ui.status(lot.qc_status)) : null)); })))), { flush: true }));
      b.append(card('Payload crudo del webhook (RN-GRJ-11)', h('pre', { class: 'mono small', style: 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;margin:0' }, JSON.stringify(d.raw_payload, null, 1))));
    }, { code: 'GRJ-03', wide: true });
  }
  function disputeModal(d, after) {
    modal('Acuerdo con la granja · ' + d.farm_document_number, (b, close) => {
      const ls = linesOf(d.id);
      b.append(dl([['Diferencia', `${F.kg(U.sum(ls, l => (l.received_weight_kg || 0) - l.sent_weight_kg), 3)} · ${F.money(U.sum(ls, l => ((l.received_weight_kg || 0) - l.sent_weight_kg) * l.unit_price))}`]]));
      b.append(form({ id: 'agr', values: { decision: 'ACCEPT_RECEIVED' }, fields: [{ key: 'decision', label: 'Acuerdo', type: 'select', options: [['ACCEPT_RECEIVED', 'La granja reconoce lo recibido (ajusta en la conciliación)'], ['ACCEPT_SENT', 'Don Guando asume la merma (se mantiene lo enviado)']] }, { key: 'note', label: 'Detalle del acuerdo', type: 'textarea', required: true }], submitLabel: 'Registrar acuerdo', onCancel: close, onSubmit: v => { try { resolveDispute(d.id, v); toast('Acuerdo registrado', 'ok'); close(); after && after(); G.refresh(); return true; } catch (e) { return e.message; } } }));
    });
  }

  function scrLink(el) {
    const body = page(el, { code: 'GRJ-01', title: 'Vínculo con la granja', sub: 'Granja Don Guando es otra unidad de negocio con el mismo RUC: hoy entrega con NTI sin IGV. El modo y su vigencia deciden el documento de cada envío (RN-GRJ-02).', actions: G.can('grj.link.manage') ? [{ label: 'Nuevo vínculo', icon: '+', onClick: () => linkForm() }, { label: 'Cambio a factura', kind: 'primary', onClick: () => G.go('GRJ-06') }] : [] });
    const links = G.db.all('farm_links').sort(U.by('valid_from'));
    const cur = linkAt(FARM, G.TODAY);
    const s = G.db.get('suppliers', FARM) || {};
    const next = links.find(l => l.supplier_id === FARM && l.valid_from > G.TODAY && l.status !== 'CLOSED');
    body.append(kpis([{ label: 'Documento esperado hoy', value: cur ? (cur.mode === 'NTI' ? 'NTI sin IGV' : 'Factura') : 'Sin vínculo', tone: cur ? 'ok' : 'bad' }, { label: 'RUC emisor', value: cur ? cur.farm_ruc : '—', sub: cur && cur.farm_ruc === company().ruc ? 'mismo RUC de la empresa' : 'RUC propio' }, { label: 'Conector', value: cur ? LBL[cur.connector_status][0] : '—', sub: cur && cur.last_webhook_at ? 'último webhook ' + F.datetime(cur.last_webhook_at) : '' }, { label: 'Cambio programado', value: next ? F.date(next.valid_from) : 'No', tone: next ? 'info' : '' }]));
    body.append(notice([h('b', null, 'D-GRJ-01: '), 'mientras compartan RUC, las compras a la granja se registran con NTI sin IGV. ', h('b', null, 'D-GRJ-02: '), `la NTI se asienta contra la cuenta de enlace ${G.param('cnt_interunit_account_code') || '4699'}, que salda en cero al consolidar. `, h('b', null, 'D-GRJ-03: '), 'precio de transferencia = lista de la granja sin IGV.'], 'info'));
    body.append(table({ id: 'grj01', columns: [{ key: 'supplier_id', label: 'Proveedor', value: l => G.supName(l.supplier_id) }, { key: 'mode', label: 'Modo', render: l => st(l.mode) }, { key: 'valid_from', label: 'Desde', render: l => F.date(l.valid_from) }, { key: 'valid_to', label: 'Hasta', render: l => l.valid_to ? F.date(l.valid_to) : 'Sin fin' }, { key: 'farm_tenant_ref', label: 'Tenant de la granja', mono: true }, { key: 'farm_ruc', label: 'RUC emisor', mono: true }, { key: 'connector_status', label: 'Conector', render: l => st(l.connector_status) }, { key: 'st', label: 'Estado', render: l => st(linkStatus(l)) }], rows: links,
      onRow: l => drawer(`Vínculo ${l.mode}`, (b, close) => { if (G.can('grj.link.manage') && l.status !== 'CLOSED') b.append(h('div', { class: 'row' }, btn('Probar conector', () => { G.db.update('farm_links', l.id, { connector_status: 'FAKE', last_ping_at: G.date.now() }); toast('Conector de la granja responde (implementación simulada)', 'ok'); close(); G.refresh(); }, { sm: true }), btn(l.connector_status === 'DISABLED' ? 'Encender conector' : 'Apagar conector', () => { G.db.update('farm_links', l.id, { connector_status: l.connector_status === 'DISABLED' ? 'FAKE' : 'DISABLED' }); close(); G.refresh(); }, { sm: true }))); b.append(dl([['Proveedor', G.supName(l.supplier_id)], ['Razón social del emisor', l.farm_legal_name], ['Modo', st(l.mode)], ['Vigencia', `${F.date(l.valid_from)} – ${l.valid_to ? F.date(l.valid_to) : 'sin fin'}`], ['Tenant de la granja', l.farm_tenant_ref], ['RUC emisor', l.farm_ruc], ['Conector', st(l.connector_status)], ['Último webhook', F.datetime(l.last_webhook_at)], ['Notas', l.notes]])); b.append(card('Envíos con este vínculo', h('div', null, `${G.db.where('farm_dispatches', d => d.farm_link_id === l.id).length} envíos`))); }, { code: 'GRJ-01' }) }));
    const maps = G.db.where('farm_product_mappings', m => m.supplier_id === FARM && m.status === 'ACTIVE');
    body.append(card('Precio de transferencia (lista de la granja sin IGV, RN-GRJ-08)', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Ítem de la granja', 'Variante de Aycha', 'Precio por kg', ''].map((x, i) => h('th', { class: i === 2 ? 'r' : '' }, x)))), h('tbody', null, maps.map(m => h('tr', null, h('td', null, h('b', { class: 'mono' }, m.farm_item_code), ' ', m.farm_item_name), h('td', null, G.variantName(m.variant_id)), h('td', { class: 'r' }, F.money(m.transfer_price)), h('td', { class: 'r' }, G.can('grj.link.manage') || G.can('grj.mapping.manage') ? btn('Cambiar', () => modal('Precio de ' + m.farm_item_name, (bb, cl) => bb.append(form({ id: 'tp', values: { p: m.transfer_price }, fields: [{ key: 'p', label: 'Precio por kg sin IGV', type: 'number', min: 0, required: true }, { key: 'why', label: 'Motivo', required: true }], submitLabel: 'Guardar', onCancel: cl, onSubmit: v => { G.db.update('farm_product_mappings', m.id, { transfer_price: Number(v.p) }); G.audit('PRECIO_TRANSFERENCIA', 'farm_product_mappings', m.id, `${m.farm_item_code}: ${m.transfer_price} → ${v.p} · ${v.why}`); toast('Precio de transferencia actualizado', 'ok'); cl(); G.refresh(); return true; } }))), { sm: true }) : null)))))), { flush: true }));
    if (s.id) body.append(card('Proveedor de la granja', dl([['Proveedor', `${s.legal_name} (${s.supplier_type})`], ['Documento', `${s.doc_type} ${s.doc_number}`], ['Empresa relacionada', s.related_company_id ? (G.db.get('companies', s.related_company_id) || {}).legal_name : '—']])));
  }
  function linkForm() {
    drawer('Nuevo vínculo con la granja', (b, close) => b.append(form({ id: 'lnk', values: { supplier_id: FARM, mode: 'INVOICE', valid_from: G.date.add(G.TODAY, 1) }, fields: [
      { key: 'supplier_id', label: 'Proveedor de granja', type: 'select', options: G.ui.opts('suppliers', s => s.trade_name || s.legal_name, s => s.supplier_type === 'RELATED_FARM'), required: true },
      { key: 'mode', label: 'Modo', type: 'select', options: [['NTI', 'NTI sin IGV (mismo RUC)'], ['INVOICE', 'Factura con IGV (RUC propio)']], required: true },
      { key: 'valid_from', label: 'Desde', type: 'date', required: true }, { key: 'valid_to', label: 'Hasta', type: 'date' },
      { key: 'farm_ruc', label: 'RUC emisor', help: 'NTI: el mismo RUC de la empresa (RN-GRJ-03). Factura: el RUC propio de la granja.' }, { key: 'farm_tenant_ref', label: 'Tenant de la granja', placeholder: TENANT_REF }],
      submitLabel: 'Crear vínculo', onCancel: close, onSubmit: v => { try { createLink(v); toast('Vínculo creado', 'ok'); close(); G.refresh(); return true; } catch (e) { return e.message; } } })), { code: 'GRJ-01' });
  }
  function scrMapping(el) {
    const body = page(el, { code: 'GRJ-02', title: 'Mapeo de productos', sub: 'Ítem de la granja → variante de Aycha y factor de conversión. Un envío con un ítem sin mapear queda por recibir hasta mapearlo (RN-GRJ-05).', actions: G.can('grj.mapping.manage') ? [{ label: 'Nuevo mapeo', kind: 'primary', icon: '+', onClick: () => mapForm({}) }] : [] });
    const un = unmappedItems();
    const maps = G.db.where('farm_product_mappings', m => m.supplier_id === FARM);
    body.append(kpis([{ label: 'Ítems mapeados', value: maps.filter(m => m.status === 'ACTIVE').length }, { label: 'Ítems sin mapear', value: un.length, tone: un.length ? 'bad' : 'ok' }, { label: 'Envíos detenidos por mapeo', value: G.db.where('farm_dispatches', d => d.status === 'RECEIVED_PENDING' && !d.purchase_document_id).length, tone: 'warn' }]));
    if (un.length) body.append(card('Ítems sin mapear', h('div', { class: 'stack' }, un.map(u => h('div', { class: 'row between' }, h('span', null, h('b', { class: 'mono' }, u.code), ' ', u.name, h('span', { class: 'muted small' }, ` · ${u.count} línea(s), ${F.kg(u.kg, 1)}`)), btn('Mapear', () => mapForm({ farm_item_code: u.code, farm_item_name: u.name }), { sm: true, kind: 'primary', disabled: !G.can('grj.mapping.manage') }))))));
    body.append(table({ id: 'grj02', columns: [{ key: 'farm_item_code', label: 'Código de la granja', mono: true }, { key: 'farm_item_name', label: 'Ítem de la granja' }, { key: 'variant_id', label: 'Variante de Aycha', value: m => G.variantName(m.variant_id) }, { key: 'conversion_factor', label: 'Factor', align: 'r', render: m => F.num(m.conversion_factor, 3) }, { key: 'transfer_price', label: 'Precio/kg', align: 'r', render: m => F.money(m.transfer_price) }, { key: 'status', label: 'Estado', render: m => st(m.status) }], rows: maps, onRow: m => mapForm(m) }));
  }
  function mapForm(m) {
    drawer(m.id ? 'Editar mapeo' : 'Nuevo mapeo', (b, close) => b.append(form({ id: 'map', values: Object.assign({ conversion_factor: 1 }, m), fields: [
      { key: 'farm_item_code', label: 'Código de la granja', required: true, disabled: !!m.id }, { key: 'farm_item_name', label: 'Nombre en la granja' },
      { key: 'variant_id', label: 'Variante de Aycha', type: 'select', options: G.ui.opts('product_variants', v => `${v.name} (${v.sku})`, v => ['pc-MP', 'pc-CUY', 'pc-CONEJO', 'pc-AVES'].includes((G.productOf(v.id) || {}).category_id)), required: true },
      { key: 'conversion_factor', label: 'Factor de conversión', type: 'number', min: 0, help: 'kg de Aycha por cada kg que reporta la granja.' }, { key: 'transfer_price', label: 'Precio de transferencia por kg (sin IGV)', type: 'number', min: 0 }],
      submitLabel: 'Guardar', onCancel: close, onSubmit: v => { try { mapItem(Object.assign({}, m, v)); toast('Mapeo guardado; los envíos detenidos se reprocesaron', 'ok'); close(); G.refresh(); return true; } catch (e) { return e.message; } } })), { code: 'GRJ-02' });
  }
  function scrDispatches(el) {
    const body = page(el, { code: 'GRJ-03', title: 'Envíos de la granja', sub: 'Lo que la granja despacha llega por webhook firmado (o carga manual): documento, fecha, kg y valor enviados. Recibirlo dos veces no lo duplica (RN-GRJ-04). También los pedidos que se le hacen.', actions: [
      { label: 'Simular webhook de la granja', kind: 'primary', onClick: () => { const r = tryDo(() => simulateDispatch(), x => `Llegó ${x.dispatch.farm_document_number} (${F.kg(x.dispatch.total_sent_kg, 1)}, ${F.money(x.dispatch.total_value)})`); } },
      { label: 'Reenviar el último webhook', onClick: () => { const last = G.db.all('farm_dispatches').filter(d => d.raw_payload).sort(U.by('arrived_at', -1))[0]; if (!last) return; const r = ingest(last.raw_payload); toast(r.duplicate ? `RN-GRJ-04: ${last.farm_document_number} ya estaba registrado; no se duplicó (${r.dispatch.duplicates_received} duplicado(s) ignorados).` : 'Registrado', r.duplicate ? 'info' : 'ok'); G.refresh(); } },
      { label: 'Carga manual', onClick: () => manualForm() }] });
    const ds = G.db.all('farm_dispatches').sort(U.by('dispatched_at', -1));
    const m = G.date.month(G.TODAY);
    body.append(kpis([{ label: 'Por recibir', value: ds.filter(d => d.status === 'RECEIVED_PENDING').length, tone: 'warn' }, { label: 'En disputa', value: ds.filter(d => d.status === 'DISPUTED').length, tone: 'bad' }, { label: 'Con error', value: ds.filter(d => d.status === 'ERROR').length, tone: 'bad' }, { label: 'Kg enviados en el mes', value: F.kg(U.sum(ds.filter(d => d.dispatched_at >= m), d => d.total_sent_kg), 0), sub: F.money(U.sum(ds.filter(d => d.dispatched_at >= m), d => d.total_value)) }]));
    body.append(tabs([
      { key: 'env', label: 'Envíos', count: ds.length, render: p => p.append(table({ id: 'grj03', columns: [{ key: 'dispatched_at', label: 'Despacho', render: d => F.datetime(d.dispatched_at) }, { key: 'farm_document_number', label: 'Documento', render: d => h('span', null, h('span', { class: 'mono' }, d.farm_document_number), h('div', { class: 'muted small' }, d.source === 'MANUAL' ? 'carga manual' : 'webhook')) }, { key: 'expected_doc_type', label: 'Esperado', render: d => d.expected_doc_type ? st(d.expected_doc_type) : '—' }, { key: 'total_sent_kg', label: 'Kg enviados', align: 'r', render: d => F.kg(d.total_sent_kg, 1) }, { key: 'rec', label: 'Kg recibidos', align: 'r', value: d => U.sum(linesOf(d.id), l => l.received_weight_kg || 0), render: d => d.received_at ? F.kg(U.sum(linesOf(d.id), l => l.received_weight_kg || 0), 1) : '—' }, { key: 'total_value', label: 'Valor', align: 'r', render: d => F.money(d.total_value) }, { key: 'order_ref', label: 'Pedido', mono: true }, { key: 'status', label: 'Estado', render: d => h('span', null, st(d.status), d.duplicates_received ? h('div', { class: 'muted small' }, `${d.duplicates_received} duplicado(s)`) : null) }], rows: ds, onRow: d => openDispatch(d.id), filters: [{ key: 'status', label: 'Estado', options: Object.keys(LBL).slice(0, 5).map(k => [k, LBL[k][0]]) }] })) },
      { key: 'ped', label: 'Pedidos a la granja', render: p => {
        const pos = G.db.where('purchase_orders', x => x.supplier_id === FARM).sort(U.by('order_date', -1));
        p.append(h('div', { class: 'row between', style: 'margin-bottom:10px' }, h('span', { class: 'muted small' }, 'Se piden como OC a Granja Don Guando: sin IGV mientras rija la NTI. Al despachar, la granja envía la NTI con el número del pedido.'), btn('Nuevo pedido a la granja', () => farmOrderForm(), { kind: 'primary', sm: true, disabled: !G.can('com.order.create') })));
        p.append(table({ id: 'grj03p', columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'order_date', label: 'Fecha', render: x => F.date(x.order_date) }, { key: 'expected_date', label: 'Para', render: x => F.date(x.expected_date) }, { key: 'lines', label: 'Productos', value: x => G.com ? G.com.poLines(x.id).map(l => `${G.variantName(l.variant_id)} ${F.kg(l.qty, 0)}`).join(' · ') : '' }, { key: 'total', label: 'Total', align: 'r', render: x => F.money(x.total) }, { key: 'status', label: 'Estado', render: x => G.ui.status(x.status) }], rows: pos, onRow: x => G.com && G.com.openPO(x.id), actions: x => ['APPROVED'].includes(x.status) && !G.db.find('farm_dispatches', d => d.order_ref === x.number) ? [btn('Simular despacho', () => tryDo(() => simulateDispatch({ po_id: x.id }), r => `La granja despachó ${r.dispatch.farm_document_number}`), { sm: true })] : [] }));
      } },
      { key: 'raw', label: 'Entradas del webhook', render: p => p.append(table({ id: 'grj03r', columns: [{ key: 'arrived_at', label: 'Llegó', render: d => F.datetime(d.arrived_at) }, { key: 'idempotency_key', label: 'Clave de idempotencia', mono: true }, { key: 'duplicates_received', label: 'Duplicados', align: 'r' }, { key: 'sig', label: 'Firma', render: d => (d.raw_payload || {}).signature_valid === false ? badge('inválida', 'bad') : badge('válida', 'ok') }, { key: 'error_message', label: 'Error', render: d => d.error_message ? h('span', { class: 'small' }, d.error_message) : '—' }], rows: G.db.all('farm_dispatches').sort(U.by('arrived_at', -1)), onRow: d => openDispatch(d.id) })) }]));
  }
  function farmOrderForm() {
    drawer('Pedido a la granja', (b, close) => {
      const maps = G.db.where('farm_product_mappings', m => m.supplier_id === FARM && m.status === 'ACTIVE');
      const fields = maps.map(m => ({ key: m.farm_item_code, label: `${m.farm_item_name} (kg) · ${F.money(m.transfer_price)}/kg`, type: 'number', min: 0 }));
      b.append(notice(`Documento esperado para mañana: ${expectedDocType(FARM, G.date.add(G.TODAY, 1)) === 'NTI' ? 'NTI sin IGV' : 'factura con IGV'} (RN-GRJ-02).`, 'info'));
      b.append(form({ id: 'fo', values: { expected_date: G.date.add(G.TODAY, 1), 'GR-CUY-CAN': 250 }, fields: [{ key: 'expected_date', label: 'Para el', type: 'date', required: true }].concat(fields), submitLabel: 'Crear y enviar pedido', onCancel: close, onSubmit: v => { try { const po = createFarmOrder({ expected_date: v.expected_date, lines: maps.map(m => ({ farm_item_code: m.farm_item_code, kg: v[m.farm_item_code] })) }); toast(`Pedido ${po.number} ${po.status === 'APPROVED' ? 'aprobado y enviado a la granja' : 'enviado a aprobación (RN-COM-01)'}`, 'ok'); close(); G.refresh(); return true; } catch (e) { return e.message; } } }));
    }, { code: 'GRJ-03' });
  }
  function manualForm() {
    drawer('Carga manual de un envío', (b, close) => {
      const maps = G.db.where('farm_product_mappings', m => m.supplier_id === FARM && m.status === 'ACTIVE');
      b.append(notice('Úsala si el conector está caído: con el mismo número de documento no se duplica (RN-GRJ-04).', 'info'));
      b.append(form({ id: 'man', values: { number: provider.nextNumber(), date: G.TODAY, item: 'GR-CUY-CAN', kg: 200, lot: 'GDG-G02-L2618' }, fields: [{ key: 'number', label: 'Número de la NTI o factura', required: true }, { key: 'date', label: 'Fecha de despacho', type: 'date', required: true }, { key: 'item', label: 'Ítem', type: 'select', options: maps.map(m => [m.farm_item_code, m.farm_item_name]).concat([['GR-POL-BEN', 'Pollo de corral beneficiado (sin mapear)']]), required: true }, { key: 'kg', label: 'Kg enviados', type: 'number', min: 0, required: true }, { key: 'qty', label: 'Unidades', type: 'number', min: 0 }, { key: 'lot', label: 'Lote de la granja', required: true }, { key: 'galpon', label: 'Galpón' }],
        submitLabel: 'Registrar envío', onCancel: close, onSubmit: v => { const m = mapOf(FARM, v.item); const p = provider.build({ number: v.number, date: v.date, items: [{ code: v.item, name: m ? m.farm_item_name : 'Pollo de corral beneficiado', kg: Number(v.kg), qty: Number(v.qty) || null, price: m ? m.transfer_price : 8.9, lot: v.lot, origin: { granja: 'Granja Don Guando · Pachacámac', galpon: v.galpon || '—', fecha_beneficio: G.date.add(v.date, -1) } }] }); const r = ingest(p, { source: 'MANUAL' }); toast(r.duplicate ? 'RN-GRJ-04: ese documento ya estaba registrado; no se duplicó' : r.error ? r.error : `Envío ${v.number} registrado`, r.duplicate || r.error ? 'warn' : 'ok'); close(); G.refresh(); return true; } }));
    }, { code: 'GRJ-03' });
  }
  function scrReceive(el, params) {
    const d = params.id ? G.db.get('farm_dispatches', params.id) : null;
    const body = page(el, { code: 'GRJ-04', title: 'Recepción de un envío', sub: `Por línea: kg y unidades enviados frente a recibidos, temperatura y lote de la granja. Cada línea crea un lote local con origen FARM (RN-GRJ-06); más de ${F.pct(tol(), 0)} de diferencia exige motivo y deja el envío en disputa (RN-GRJ-07).` });
    const pend = G.db.where('farm_dispatches', x => x.status === 'RECEIVED_PENDING').sort(U.by('dispatched_at'));
    if (!d) {
      body.append(card('Envíos por recibir', pend.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Documento', 'Despacho', 'Kg enviados', 'Valor', 'Estado', ''].map(x => h('th', null, x)))), h('tbody', null, pend.map(x => h('tr', null, h('td', { class: 'mono' }, x.farm_document_number), h('td', null, F.datetime(x.dispatched_at)), h('td', { class: 'r' }, F.kg(x.total_sent_kg, 1)), h('td', { class: 'r' }, F.money(x.total_value)), h('td', null, x.error_message ? h('span', { class: 'small' }, badge('detenido', 'bad'), ' ', x.error_message) : st(x.status)), h('td', { class: 'r' }, btn('Recibir', () => G.go('GRJ-04', { id: x.id }), { sm: true, kind: 'primary', disabled: !!x.error_message || !G.can('grj.dispatch.receive') }))))))) : empty('No hay envíos de la granja por recibir.'), { flush: true }));
      const done = G.db.where('farm_dispatches', x => x.received_at).sort(U.by('received_at', -1)).slice(0, 12);
      body.append(card('Últimas recepciones', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('tbody', null, done.map(x => h('tr', { class: 'click', on: { click: () => openDispatch(x.id) } }, h('td', { class: 'mono' }, x.farm_document_number), h('td', null, F.datetime(x.received_at)), h('td', { class: 'r' }, `${F.kg(x.total_sent_kg, 1)} → ${F.kg(U.sum(linesOf(x.id), l => l.received_weight_kg || 0), 1)}`), h('td', null, st(x.status))))))), { flush: true }));
      return;
    }
    if (d.status !== 'RECEIVED_PENDING') { body.append(notice(`El envío ${d.farm_document_number} está «${LBL[d.status][0]}».`, 'info'), h('div', { class: 'row' }, btn('Ver envío', () => openDispatch(d.id)), btn('Volver', () => G.go('GRJ-04')))); return; }
    if (d.error_message) body.append(notice(d.error_message, 'bad'));
    if (!G.can('grj.dispatch.receive')) body.append(notice(`Tu rol (${G.roleName()}) no tiene grj.dispatch.receive.`, 'warn'));
    const doc = docOf(d);
    body.append(card(`Envío ${d.farm_document_number} · ${F.datetime(d.dispatched_at)}`, dl([['Documento esperado', d.expected_doc_type ? st(d.expected_doc_type) : '—'], ['Comprobante en COM', doc ? `${G.com ? G.com.docLabel(doc) : doc.number} · ${F.money(doc.total)} · IGV ${F.money(doc.igv)}` : 'Pendiente'], ['Kg y valor enviados', `${F.kg(d.total_sent_kg, 3)} · ${F.money(d.total_value)}`], ['Pedido', d.order_ref || '—']])));
    const ls = linesOf(d.id);
    const st0 = ls.map(l => ({ id: l.id, received_qty: l.sent_qty, received_weight_kg: '', temp_c: '', reason: '', decision: 'ACCEPT' }));
    const head = { warehouse_id: 'wh-CAM-L2', inspection: 'PENDING', vehicle_temp_c: '' };
    const rowsBox = h('tbody');
    const diffCells = [];
    ls.forEach((l, i) => {
      const x = st0[i];
      const diffCell = h('td', { class: 'r' }, '—'); diffCells.push(diffCell);
      const upd = () => { if (x.received_weight_kg === '' || x.received_weight_kg == null) { diffCell.textContent = '—'; return; } const dp = diffPct(l.sent_weight_kg, x.received_weight_kg); G.ui.clear(diffCell).append(badge((dp > 0 ? '+' : '') + F.pct(dp, 2), Math.abs(dp) > tol() + 1e-9 ? 'bad' : 'ok'), Math.abs(dp) > tol() + 1e-9 ? h('div', { class: 'small', style: 'color:var(--bad)' }, 'Exige motivo') : null); };
      const I = (k, a = {}) => h('input', Object.assign({ class: 'input', value: x[k] ?? '', style: 'min-width:80px', on: { input: e => { x[k] = e.target.value; upd(); } } }, a));
      const m = l.mapping_id ? G.db.get('farm_product_mappings', l.mapping_id) : null;
      rowsBox.append(h('tr', null, h('td', null, h('b', null, l.farm_item_name), h('div', { class: 'muted small' }, m ? '→ ' + G.variantName(m.variant_id) : 'sin mapear'), h('div', { class: 'mono small' }, l.farm_lot_code)), h('td', { class: 'r' }, F.kg(l.sent_weight_kg, 3), l.sent_qty ? h('div', { class: 'muted small' }, F.num(l.sent_qty) + ' u') : null), h('td', null, I('received_weight_kg', { type: 'number', step: '0.001' })), h('td', null, I('received_qty', { type: 'number' })), h('td', null, I('temp_c', { type: 'number', step: '0.1' })), diffCell, h('td', null, h('select', { class: 'input', on: { change: e => x.decision = e.target.value } }, [['ACCEPT', 'Aceptar'], ['QUALITY_HOLD', 'A calidad']].map(([v, t]) => h('option', { value: v }, t)))), h('td', null, I('reason', { placeholder: 'Motivo de la diferencia', style: 'min-width:160px' }))));
    });
    const tbl = h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Línea y lote de la granja', 'Enviado', 'Kg recibidos', 'Unidades', 'T °C', 'Diferencia', 'Decisión', 'Motivo'].map(x => h('th', null, x)))), rowsBox));
    const f = form({ id: 'grjrc', values: head, fields: [{ key: 'warehouse_id', label: 'Almacén', type: 'select', options: G.ui.opts('warehouses', w => w.name, w => ['COLD_ROOM', 'QUARANTINE', 'PRODUCTION'].includes(w.wh_type)), required: true }, { key: 'inspection', label: 'Inspección de recepción', type: 'select', options: [['PENDING', 'Pendiente: lotes en cuarentena (CAL-03)'], ['OK', 'Conforme: lotes liberados']] }, { key: 'vehicle_temp_c', label: 'T° del vehículo (°C)', type: 'number' }],
      submitLabel: 'Registrar recepción', onCancel: () => G.go('GRJ-04'), onSubmit: v => { try { const r = receive(d.id, Object.assign({}, v, { lines: st0 })); toast(r.status === 'DISPUTED' ? `Envío ${r.farm_document_number} recibido y EN DISPUTA con la granja (RN-GRJ-07)` : `Envío ${r.farm_document_number} recibido; confirmación enviada a la granja`, r.status === 'DISPUTED' ? 'warn' : 'ok'); G.go('GRJ-03'); openDispatch(d.id); return true; } catch (e) { toast(e.message, 'bad'); return e.message; } } });
    f.insertBefore(h('div', { class: 'stack', style: 'margin-top:12px' }, h('b', null, 'Líneas'), tbl), f.querySelector('.form-actions'));
    body.append(card('Recepción', f));
  }
  function scrRecon(el) {
    const m = curMonth('rc');
    const body = page(el, { code: 'GRJ-05', title: 'Conciliación mensual', sub: 'Kg y valor enviados según la granja frente a lo recibido, por mes y producto. El mes de la granja no se cierra en CNT con diferencias sin motivo (RN-GRJ-09).', actions: [monthPills('rc')] });
    const data = reconcileData(m); const r = reconRow(m);
    body.append(kpis([{ label: 'Envíos del mes', value: data.dispatches }, { label: 'Kg enviados / recibidos', value: `${F.num(data.sent_kg, 0)} / ${F.num(data.received_kg, 0)}`, sub: `diferencia ${F.kg(data.received_kg - data.sent_kg, 1)}` }, { label: 'Valor enviado / recibido', value: F.money(data.sent_value, 0), sub: `diferencia ${F.money(data.received_value - data.sent_value)}` }, { label: 'Pendientes', value: data.issues.length, tone: data.issues.length ? 'bad' : 'ok' }, { label: 'Estado', value: r ? LBL[r.status][0] : 'Sin abrir', tone: r && r.status === 'CLOSED' ? 'ok' : 'warn' }]));
    body.append(table({ id: 'grj05', columns: [{ key: 'name', label: 'Producto' }, { key: 'lines', label: 'Líneas', align: 'r' }, { key: 'sent_kg', label: 'Kg enviados', align: 'r', render: x => F.num(x.sent_kg, 3) }, { key: 'received_kg', label: 'Kg recibidos', align: 'r', render: x => F.num(x.received_kg, 3) }, { key: 'dk', label: 'Dif. kg', align: 'r', value: x => R(x.received_kg - x.sent_kg, 3), render: x => F.num(x.received_kg - x.sent_kg, 3) }, { key: 'dp', label: 'Dif. %', align: 'r', value: x => x.sent_kg ? R((x.received_kg - x.sent_kg) / x.sent_kg * 100, 2) : 0, render: x => F.pct(x.sent_kg ? (x.received_kg - x.sent_kg) / x.sent_kg * 100 : 0, 2) }, { key: 'sent_value', label: 'Valor enviado', align: 'r', render: x => F.money(x.sent_value) }, { key: 'received_value', label: 'Valor recibido', align: 'r', render: x => F.money(x.received_value) }], rows: data.rows, search: false, footer: ['Total', '', { v: F.num(data.sent_kg, 3), align: 'r' }, { v: F.num(data.received_kg, 3), align: 'r' }, { v: F.num(data.received_kg - data.sent_kg, 3), align: 'r' }, '', { v: F.money(data.sent_value), align: 'r' }, { v: F.money(data.received_value), align: 'r' }] }));
    const label = { NO_REASON: 'Diferencia sin motivo', DISPUTED: 'En disputa con la granja', PENDING: 'Envío por recibir', ERROR: 'Envío con error (no cuenta)' };
    body.append(card('Diferencias pendientes', data.issues.length ? h('div', { class: 'stack' }, data.issues.map(i => h('div', { class: 'row between' }, h('span', null, badge(label[i.type], i.type === 'ERROR' ? '' : 'bad'), ' ', h('span', { class: 'mono' }, i.d.farm_document_number), i.l ? ` · ${i.l.farm_item_name} ${F.pct(i.l.difference_pct, 2)}` : ''), i.type === 'DISPUTED' ? btn('Registrar acuerdo', () => disputeModal(i.d), { sm: true }) : btn('Ver', () => openDispatch(i.d.id), { sm: true, kind: 'ghost' })))) : empty('Sin diferencias pendientes.')));
    const canAgree = G.can('grj.reconciliation.close') || G.canDo(MOD, 'E');
    body.append(card('Acuerdo y cierre con la granja', h('div', { class: 'stack' },
      r && r.notes ? notice(`Acuerdo (${G.userName(r.agreed_by)}, ${F.datetime(r.agreed_at)}): ${r.notes}`, 'info') : null,
      r && r.status === 'CLOSED' ? notice(`Conciliación cerrada por ${G.userName(r.closed_by)}. CNT puede cerrar el mes (tarea FARM_RECONCILED).`, 'ok') : null,
      (!r || r.status === 'OPEN') && canAgree ? form({ id: 'agrm', fields: [{ key: 'note', label: 'Acuerdo con la granja (acta, diferencias aceptadas)', type: 'textarea', required: true }], submitLabel: 'Registrar acuerdo del mes', onSubmit: v => { try { agree(m, v.note); toast('Acuerdo registrado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }) : null,
      r && r.status === 'AGREED' ? h('div', { class: 'row' }, btn('Cerrar conciliación', () => tryDo(() => closeRecon(m), 'Conciliación cerrada'), { kind: 'primary', disabled: !G.can('grj.reconciliation.close'), title: G.can('grj.reconciliation.close') ? null : 'Lo cierra la contadora (grj.reconciliation.close)' }), G.can('grj.reconciliation.close') ? null : h('span', { class: 'muted small' }, 'La cierra la contadora (grj.reconciliation.close).')) : null)));
  }
  function scrSpinOff(el) {
    const body = page(el, { code: 'GRJ-06', title: 'Cambio a factura (spin-off)', sub: 'Cuando la granja tenga RUC propio: fecha de corte (último día de un mes), nuevo RUC, cierre del vínculo NTI y apertura del vínculo con factura desde el día siguiente. Los documentos anteriores conservan su tipo (RN-GRJ-10).' });
    const inv = G.db.find('farm_links', l => l.supplier_id === FARM && l.mode === 'INVOICE' && l.status !== 'CLOSED');
    const nti = G.db.find('farm_links', l => l.supplier_id === FARM && l.mode === 'NTI' && l.status !== 'CLOSED');
    if (inv) {
      body.append(notice(`Cambio programado: NTI hasta el ${F.date(nti && nti.valid_to)}; factura del RUC ${inv.farm_ruc} (${inv.farm_legal_name}) desde el ${F.date(inv.valid_from)}.`, 'info'));
      body.append(h('div', { class: 'steps' }, [['1', 'Corte ' + F.date(nti && nti.valid_to)], ['2', 'RUC ' + inv.farm_ruc], ['3', 'NTI cerrado'], ['4', 'Factura desde ' + F.date(inv.valid_from)]].map(([n, t]) => h('div', { class: 'step done' }, h('span', { class: 'n' }, n), t))));
      body.append(card('Qué cambia', dl([['Envíos hasta el corte', 'NTI sin IGV (D-GRJ-01), contra la cuenta de enlace 4699'], ['Envíos desde el día siguiente', 'Factura con IGV 18 % del RUC de la granja: crédito fiscal y cuenta 4212'], ['Pedidos a la granja', 'Desde la fecha, las OC llevan IGV'], ['Documento esperado el ' + F.date(inv.valid_from), st(expectedDocType(FARM, inv.valid_from))], ['Documento esperado el ' + F.date(nti ? nti.valid_to : G.TODAY), st(expectedDocType(FARM, nti ? nti.valid_to : G.TODAY))]])));
      if (G.can('grj.link.manage') && inv.valid_from > G.TODAY) body.append(h('div', { class: 'row' }, btn('Deshacer la programación', () => tryDo(() => undoSpinOff(), 'Programación deshecha'), { kind: 'danger' })));
      return;
    }
    if (!G.can('grj.link.manage')) body.append(notice(`Tu rol (${G.roleName()}) no tiene grj.link.manage: el cambio lo hacen GERENTE o la contadora.`, 'warn'));
    const ends = []; for (let mm = G.date.month(G.TODAY); ends.length < 9; mm = G.date.addMonths(mm, 1)) ends.push(G.date.add(G.date.addMonths(mm, 1), -1));
    const vals = { cut_date: ends[5], new_ruc: '', legal_name: 'GRANJA DON GUANDO SAC' };
    const prev = h('div');
    const draw = () => { G.ui.clear(prev); const ok = U.rucOk(String(vals.new_ruc)); prev.append(h('div', { class: 'steps' }, h('div', { class: 'step ' + (vals.cut_date ? 'done' : 'cur') }, h('span', { class: 'n' }, '1'), 'Fecha de corte ' + F.date(vals.cut_date)), h('div', { class: 'step ' + (ok ? 'done' : 'cur') }, h('span', { class: 'n' }, '2'), 'RUC propio ' + (ok ? vals.new_ruc : 'por validar')), h('div', { class: 'step' }, h('span', { class: 'n' }, '3'), 'NTI hasta ' + F.date(vals.cut_date)), h('div', { class: 'step' }, h('span', { class: 'n' }, '4'), 'Factura desde ' + F.date(G.date.add(vals.cut_date, 1)))), dl([['Hoy rige', st(expectedDocType(FARM, G.TODAY) || '—')], ['El ' + F.date(vals.cut_date), 'NTI sin IGV'], ['El ' + F.date(G.date.add(vals.cut_date, 1)), 'Factura con IGV del RUC ' + (ok ? vals.new_ruc : '—')], ['NTI posteriores al corte', String(G.db.where('farm_dispatches', d => dateOnly(d.dispatched_at) > vals.cut_date && d.expected_doc_type === 'NTI').length)]])); };
    const f = form({ id: 'spin', values: vals, fields: [{ key: 'cut_date', label: 'Fecha de corte (último día del mes)', type: 'select', options: ends.map(e => [e, F.date(e)]), required: true, onChange: v => { vals.cut_date = v; draw(); } }, { key: 'new_ruc', label: 'Nuevo RUC de la granja', required: true, help: 'Se valida el dígito verificador; debe ser distinto del RUC de la empresa (RN-GRJ-03).', onChange: v => { vals.new_ruc = v; draw(); } }, { key: 'legal_name', label: 'Razón social', required: true, onChange: v => vals.legal_name = v }],
      submitLabel: 'Programar el cambio a factura', onSubmit: v => { try { spinOff(v); toast('Cambio a factura programado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } });
    body.append(h('div', { class: 'grid c2' }, card('Datos del cambio', f), card('Vista previa', prev)));
    draw();
    body.append(notice(['RUC de ejemplo válido para probar: ', h('span', { class: 'mono' }, U.rucCheck('2061245780')), '. Sin desarrollo: el cambio es solo de configuración.'], 'info'));
  }
  function scrBoard(el) {
    const m = curMonth('tb'); const p = mRange(m);
    const body = page(el, { code: 'GRJ-07', title: 'Tablero de la granja', sub: 'KPI-GRJ-01 a KPI-GRJ-03: diferencia de peso con la granja, envíos en disputa y costo por kg de la granja frente a terceros.', actions: [monthPills('tb')] });
    const k1 = G.kpi('KPI-GRJ-01', p) || {}, k2 = G.kpi('KPI-GRJ-02', p) || {}, k3 = G.kpi('KPI-GRJ-03', p) || {};
    body.append(kpis([{ label: 'KPI-GRJ-01 · Diferencia de peso', value: F.pct(k1.value, 2), sub: `${F.kg(k1.numerator, 1)} de ${F.kg(k1.denominator, 0)}`, tone: k1.value > tol() ? 'warn' : 'ok' }, { label: 'KPI-GRJ-02 · Envíos en disputa', value: F.pct(k2.value, 1), sub: `${k2.numerator} de ${k2.denominator} envíos`, tone: k2.value > 0 ? 'warn' : 'ok' }, { label: 'KPI-GRJ-03 · Granja vs terceros', value: k3.value == null ? 'Sin comparables' : F.pct(k3.value, 1), sub: 'costo por kg (100 % = igual)', tone: k3.value != null && k3.value <= 100 ? 'ok' : 'warn' }]));
    const ds = G.db.where('farm_dispatches', d => d.received_at && inR(d.received_at, p)).sort(U.by('dispatched_at'));
    body.append(card('Kg enviados y recibidos por envío', ds.length ? G.ui.chart.bar({ labels: ds.map(d => F.date(d.dispatched_at).slice(0, 5)), series: [{ name: 'Enviado', values: ds.map(d => d.total_sent_kg) }, { name: 'Recibido', values: ds.map(d => U.sum(linesOf(d.id), l => l.received_weight_kg || 0)) }], format: v => F.kg(v, 1) }) : empty('Sin envíos recibidos en el mes.')));
    const cc = costCompare(p).filter(o => o.farm != null);
    body.append(card('Costo por kg: granja frente a terceros', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Producto', 'Kg de la granja', 'S/ por kg granja', 'S/ por kg terceros', 'Granja / terceros'].map((x, i) => h('th', { class: i ? 'r' : '' }, x)))), h('tbody', null, cc.map(o => h('tr', null, h('td', null, G.variantName(o.variant_id)), h('td', { class: 'r' }, F.num(o.fk, 1)), h('td', { class: 'r' }, F.money(o.farm)), h('td', { class: 'r' }, o.other != null ? F.money(o.other) : 'Solo la granja'), h('td', { class: 'r' }, o.other != null ? badge(F.pct(o.farm / o.other * 100, 1), o.farm <= o.other ? 'ok' : 'warn') : '—')))))), { flush: true }));
  }

  G.grj = { FARM_SUPPLIER: FARM, linkAt, expectedDocType, createLink, spinOff, undoSpinOff, mapItem, unmappedItems, ingest, reprocess, receive, resolveDispute, reconcileData, upsertRecon, agree, closeRecon, reconciliationOk, createFarmOrder, simulateDispatch, provider, openDispatch, _m: {} };
  const SC = G.SPEC.GRJ.screens; const nameOf = c => (SC.find(s => s[0] === c) || [c, c])[1];
  G.register({ code: 'GRJ', name: 'Integración con la granja', phase: 2, group: 'Abastecimiento y contabilidad', screens: [
    { code: 'GRJ-01', name: nameOf('GRJ-01'), render: scrLink }, { code: 'GRJ-02', name: nameOf('GRJ-02'), render: scrMapping }, { code: 'GRJ-03', name: nameOf('GRJ-03'), render: scrDispatches },
    { code: 'GRJ-04', name: nameOf('GRJ-04'), render: scrReceive }, { code: 'GRJ-05', name: nameOf('GRJ-05'), render: scrRecon }, { code: 'GRJ-06', name: nameOf('GRJ-06').replace(/\*/g, ''), render: scrSpinOff }, { code: 'GRJ-07', name: nameOf('GRJ-07'), render: scrBoard }] });

  G.alertProviders.push(() => {
    if (!G.canSee(MOD)) return [];
    const out = [];
    const dis = G.db.where('farm_dispatches', d => d.status === 'DISPUTED');
    if (dis.length) out.push({ module: MOD, title: `${dis.length} envío(s) de la granja en disputa`, detail: dis.map(d => d.farm_document_number).join(', ') + ' · RN-GRJ-07', tone: 'warn', go: () => G.go('GRJ-05') });
    const err = G.db.where('farm_dispatches', d => d.status === 'ERROR' || (d.status === 'RECEIVED_PENDING' && d.error_message));
    if (err.length) out.push({ module: MOD, title: `${err.length} envío(s) de la granja detenidos`, detail: 'Error de webhook o ítem sin mapear (RN-GRJ-05/11)', tone: 'bad', go: () => G.go('GRJ-03') });
    const pend = G.db.where('farm_dispatches', d => d.status === 'RECEIVED_PENDING' && !d.error_message);
    if (pend.length) out.push({ module: MOD, title: `${pend.length} envío(s) de la granja por recibir`, detail: pend.map(d => d.farm_document_number).join(', '), tone: 'info', go: () => G.go('GRJ-04') });
    return out;
  });
  G.searchProviders.push(q => G.db.where('farm_dispatches', d => String(d.farm_document_number).toLowerCase().includes(q.toLowerCase())).slice(0, 5).map(d => ({ label: d.farm_document_number, sub: `Envío de la granja · ${F.kg(d.total_sent_kg, 1)} · ${LBL[d.status][0]}`, go: () => { G.go('GRJ-03'); openDispatch(d.id); } })));
  G.scanHandlers.push(code => { const d = G.db.find('farm_dispatches', x => String(x.farm_document_number).toUpperCase() === code); if (d) return () => { G.go('GRJ-03'); openDispatch(d.id); }; const l = G.db.find('farm_dispatch_lines', x => String(x.farm_lot_code).toUpperCase() === code); if (l) return () => { G.go('GRJ-03'); openDispatch(l.dispatch_id); }; return null; });

  /* =====================================================================
     Datos de ejemplo: vínculo NTI desde 01/01/2026, mapeos, envíos de
     setiembre y octubre (lunes, miércoles y viernes), disputas, errores y
     el envío de hoy con el lote lo-Q001 en cuarentena.
     ===================================================================== */
  G.seed(41, function seedGRJ() {
    const r = U.rng(4141);
    const prevRole = G.ctx.role; G.ctx.role = 'GERENTE';
    try {
      const s = G.db.get('suppliers', FARM); if (!s) return;
      const link = createLink({ supplier_id: FARM, mode: 'NTI', valid_from: '2026-01-01', farm_ruc: company().ruc, farm_tenant_ref: TENANT_REF, farm_legal_name: 'AGROPECUARIA DON GUANDO SAC · unidad Granja Don Guando', notes: 'D-GRJ-01: mismo RUC, NTI sin IGV' }, { system: true, id: 'fl-NTI-2026', silent: true, user: 'us-mcardenas' });
      const MAP = [['GR-CUY-CAN', 'Cuy en canal (beneficiado, sin vísceras)', 'va-MP-CUY-CAN', 24.0], ['GR-CUY-BEN', 'Cuy entero beneficiado para venta', 'va-DG-CUY-ENT', 29.1], ['GR-CON-CAN', 'Conejo en canal', 'va-MP-CON-CAN', 17.5], ['GR-PAT-BEN', 'Pato beneficiado', 'va-DG-PAT-ENT', 12.0], ['GR-GAL-BEN', 'Gallina de corral beneficiada', 'va-DG-GAL-ENT', 9.8], ['GR-HUE-CUY', 'Huesos de cuy para caldo', 'va-MP-HUE-KG', 2.8]];
      for (const [code, name, vid, price] of MAP) { mapItem({ farm_item_code: code, farm_item_name: name, variant_id: vid, conversion_factor: 1, transfer_price: price }, { system: true, silent: true }); if (G.com) G.com.updateCatalogPrice(FARM, vid, price, '2026-09-01', 'LISTA'); }
      const HIST = '2026-10-05';
      // los huesos para caldo llegan congelados: su temperatura va bajo el máximo de congelado (RN-COM-02)
      const frozenLine = l => { const m = G.db.get('farm_product_mappings', l.mapping_id); const v = m && G.variant(m.variant_id); const p = v && G.db.get('products', v.product_id); return !!p && p.storage === 'FROZEN'; };
      const days = []; for (let d = '2026-09-02'; d <= '2026-10-09'; d = G.date.add(d, 1)) { const w = G.date.parse(d).getUTCDay(); if (w === 1 || w === 3 || w === 5) days.push(d); }
      let n = 201;
      const mk = (date, items, extra = {}) => { const number = 'NI01-' + U.pad(n++, 6); const p = provider.build({ number, date, items, order_ref: extra.order_ref }); if (extra.signature_valid === false) p.signature_valid = false; return ingest(p, { silent: true, at: date + 'T06:35', user: 'us-irojas' }); };
      for (const d of days) {
        const w = G.date.parse(d).getUTCDay();
        const items = [];
        const kgC = 140 + Math.floor(r() * 181); items.push({ code: 'GR-CUY-CAN', name: 'Cuy en canal (beneficiado, sin vísceras)', kg: R(kgC + r(), 1), qty: Math.round(kgC / 0.74), price: 24 });
        if (w !== 3) { const k = 40 + Math.floor(r() * 51); items.push({ code: 'GR-CON-CAN', name: 'Conejo en canal', kg: R(k + r(), 1), qty: Math.round(k / 1.45), price: 17.5 }); }
        if (w === 3) { const k = 15 + Math.floor(r() * 16); items.push({ code: 'GR-PAT-BEN', name: 'Pato beneficiado', kg: R(k + r(), 1), qty: Math.round(k / 2.4), price: 12 }); }
        if (w === 5) { const k = 20 + Math.floor(r() * 16); items.push({ code: 'GR-GAL-BEN', name: 'Gallina de corral beneficiada', kg: R(k + r(), 1), qty: Math.round(k / 1.9), price: 9.8 }); }
        if (r() < 0.3) items.push({ code: 'GR-HUE-CUY', name: 'Huesos de cuy para caldo', kg: 20 + Math.floor(r() * 21), qty: null, price: 2.8 });
        // pedido a la granja para los envíos de octubre (OC sin IGV)
        let order_ref = null;
        if (d >= '2026-10-01' && G.com) { try { const po = createFarmOrder({ expected_date: d, lines: items.map(it => ({ farm_item_code: it.code, kg: Math.round(it.kg) })) }, { system: true, user: 'us-dflores', at: G.date.add(d, -1) + 'T16:00', silent: true, date: G.date.add(d, -1) }); if (po.status === 'PENDING_APPROVAL') G.com.approvePO(po.id, 'us-rquispe', { at: G.date.add(d, -1) + 'T18:20', silent: true }); order_ref = po.number; } catch (e) { console.warn('pedido granja', e.message); } }
        if (d === '2026-10-09') items.push({ code: 'GR-POL-BEN', name: 'Pollo de corral beneficiado', kg: 48.2, qty: 22, price: 8.9 });
        const res = mk(d, items, { order_ref });
        const disp = res.dispatch;
        if (d === '2026-10-09') continue; // detenido: ítem sin mapear (RN-GRJ-05)
        const ls = linesOf(disp.id);
        const special = d === '2026-09-16' ? -1.6 : d === '2026-10-07' ? -2.1 : null;
        const lines = ls.map((l, i) => { const dp = special != null && i === 0 ? special : -(0.15 + r() * 0.7); return { id: l.id, received_qty: l.sent_qty, received_weight_kg: R(l.sent_weight_kg * (1 + dp / 100), 1), temp_c: frozenLine(l) ? R(-19.5 - r() * 2, 1) : R(1.8 + r() * 1.6, 1), reason: special != null && i === 0 ? (d === '2026-09-16' ? 'Merma por goteo; la balanza de la granja estaba sin calibrar' : 'Faltan 6 cuyes según el conteo; la granja revisa su guía') : '' }; });
        receive(disp.id, { warehouse_id: 'wh-CAM-L2', inspection: 'OK', received_at: d + 'T08:' + U.pad(5 + Math.floor(r() * 40), 2), lines }, { system: true, user: 'us-irojas', historical: d < HIST, silent: true, at: d + 'T08:40' });
        if (d === '2026-09-16') resolveDispute(disp.id, { decision: 'ACCEPT_RECEIVED', note: 'La granja reconoce 1,6 % de merma y la descuenta en la conciliación de setiembre' }, { user: 'us-mcardenas', at: '2026-09-18T11:00', silent: true });
      }
      // webhook con firma inválida (8 oct) y un duplicado ignorado
      mk('2026-10-08', [{ code: 'GR-CUY-CAN', name: 'Cuy en canal', kg: 12, qty: 16, price: 24 }], { signature_valid: false });
      const anyRec = G.db.find('farm_dispatches', d => d.status === 'RECEIVED' && d.dispatched_at >= '2026-10-01');
      if (anyRec) ingest(anyRec.raw_payload, { silent: true, at: anyRec.dispatched_at.slice(0, 10) + 'T06:36' });
      // hoy: envío con el lote lo-Q001 (cuy entero beneficiado, en cuarentena) y otro por recibir
      const lq = G.db.get('lots', 'lo-Q001');
      const today = mk(G.TODAY, [{ code: 'GR-CUY-BEN', name: 'Cuy entero beneficiado para venta', kg: 36.6, qty: 40, price: 29.1, lot: 'GDG-G03-L2619', origin: { granja: 'Granja Don Guando · Pachacámac', galpon: 'Galpón 3', lote_crianza: 'Lote 26-19', fecha_beneficio: '2026-10-09', animales: 40, peso_vivo_prom: 1.32, sanitario: 'SENASA · guía de tránsito interno' } }]).dispatch;
      if (lq && G.com) {
        const mv = G.db.find('stock_movements', m => m.source_id === 'GRJ-REC-0012');
        const rc = G.db.insert('purchase_receipts', { id: 'GRJ-REC-0012', number: G.db.next('RC', 'RC-', 5), company_id: 'co-dg', establishment_id: 'es-L1', warehouse_id: 'wh-CUA-L1', supplier_id: FARM, po_id: null, receipt_type: 'FARM_NTI', received_at: G.TODAY + 'T07:10', received_by: 'us-mtorres', vehicle_temp_c: 3.2, carrier_guide: today.farm_document_number, scale_equipment_id: 'BAL-L1-01', inspection_id: null, inspection_result: 'PENDING', status: 'POSTED', historical: false, total_cost: R(36.4 * 29.1), document_id: today.purchase_document_id, farm_dispatch_id: today.id, notes: 'Lote en cuarentena hasta la inspección de calidad (CAL-03)' }, { silent: true });
        G.db.insert('purchase_receipt_lines', { receipt_id: rc.id, po_line_id: null, variant_id: 'va-DG-CUY-ENT', lot_id: 'lo-Q001', supplier_lot_code: 'GDG-G03-L2619', expiry_date: lq.expiry_date, qty: 40, weight_kg: 36.4, temp_c: 2.8, unit_cost: 29.1, price_basis: 'KG', total_cost: R(36.4 * 29.1), accepted: true, quality_hold: false, rejection_reason: null, over_receipt_reason: null, over_pct: 0, stock_movement_id: mv ? mv.id : null }, { silent: true });
        G.db.update('lots', 'lo-Q001', { farm_lot_code: 'GDG-G03-L2619', farm_origin: { granja: 'Granja Don Guando · Pachacámac', galpon: 'Galpón 3', lote_crianza: 'Lote 26-19', fecha_beneficio: '2026-10-09', granja_documento: today.farm_document_number }, receipt_id: rc.id }, { silent: true });
        receive(today.id, { lines: linesOf(today.id).map(l => ({ id: l.id, received_qty: 40, received_weight_kg: 36.4, temp_c: 2.8, lot_id: 'lo-Q001' })) }, { system: true, user: 'us-mtorres', silent: true, at: G.TODAY + 'T07:10', existingReceipt: rc });
      }
      mk(G.TODAY, [{ code: 'GR-CUY-CAN', name: 'Cuy en canal (beneficiado, sin vísceras)', kg: 300.0, qty: 405, price: 24 }, { code: 'GR-CON-CAN', name: 'Conejo en canal', kg: 62.4, qty: 43, price: 17.5 }]);
      // conciliación de setiembre acordada (falta que la contadora la cierre); octubre abierta
      upsertRecon('2026-09-01', { status: 'AGREED', notes: 'Acta de conciliación de setiembre firmada con la granja: se acepta la merma del 16/09.', agreed_by: 'us-dflores', agreed_at: '2026-10-03T10:30' }, { silent: true });
      upsertRecon('2026-10-01', {}, { silent: true });
    } finally { G.ctx.role = prevRole; }
  }, 'GRJ granja');

  /* ---------- pruebas: una por criterio CA-GRJ-… ---------- */
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (!String(e.message).startsWith(code)) throw new Error(`Se esperaba ${code} y salió: ${e.message}`); return e; } throw new Error(`Se esperaba el rechazo ${code} y no ocurrió.`); };
  const nti245 = (number = 'NI01-000245', kg = 300) => provider.build({ number, date: G.TODAY, items: [{ code: 'GR-CUY-CAN', name: 'Cuy en canal', kg, qty: 405, price: 24 }] });
  G.tests.push({ module: MOD, name: 'CA-GRJ-01: con el vínculo NTI vigente desde el 01/01/2026, la NTI-1 000245 de 300,0 kg de cuy a S/ 24,00 crea un comprobante INTERNAL_TRANSFER de S/ 7 200,00 con IGV 0', fn: async () => {
    const l = linkAt(FARM, G.TODAY); if (!l || l.mode !== 'NTI' || l.valid_from !== '2026-01-01') throw new Error('Falta el vínculo NTI desde el 01/01/2026');
    const r = ingest(nti245()); const doc = docOf(r.dispatch);
    if (!doc) throw new Error('No se creó el comprobante: ' + r.dispatch.error_message);
    if (doc.doc_type !== 'INTERNAL_TRANSFER' || doc.total !== 7200 || doc.igv !== 0) throw new Error(`Comprobante ${doc.doc_type} ${doc.total} IGV ${doc.igv}`);
  } });
  G.tests.push({ module: MOD, name: 'CA-GRJ-02: recibido con 297,5 kg (−0,83 %) se acepta sin motivo; con 295,0 kg (−1,67 %) exige motivo y queda DISPUTED', fn: async () => {
    const a = ingest(nti245()).dispatch; const la = linesOf(a.id)[0];
    const ra = receive(a.id, { lines: [{ id: la.id, received_weight_kg: 297.5, received_qty: 405, temp_c: 2.2 }] });
    if (ra.status !== 'RECEIVED' || linesOf(a.id)[0].difference_pct !== -0.833) throw new Error(`Estado ${ra.status}, dif ${linesOf(a.id)[0].difference_pct}`);
    const lot = G.db.get('lots', linesOf(a.id)[0].lot_id); if (!lot || lot.origin !== 'FARM' || lot.farm_lot_code !== la.farm_lot_code) throw new Error('RN-GRJ-06: el lote local debía tener origen FARM y el lote de la granja');
    const b = ingest(nti245('NI01-000246')).dispatch; const lb = linesOf(b.id)[0];
    expectFail(() => receive(b.id, { lines: [{ id: lb.id, received_weight_kg: 295.0, temp_c: 2.2 }] }), 'RN-GRJ-07');
    const rb = receive(b.id, { lines: [{ id: lb.id, received_weight_kg: 295.0, temp_c: 2.2, reason: 'Merma por goteo' }] });
    if (rb.status !== 'DISPUTED') throw new Error('Debía quedar DISPUTED y quedó ' + rb.status);
  } });
  G.tests.push({ module: MOD, name: 'CA-GRJ-03: NTI hasta el 31/03/2027 e INVOICE desde el 01/04/2027 → el 02/04/2027 se espera INVOICE; un tercer vínculo desde el 15/03/2027 se rechaza con RN-GRJ-01', fn: async () => {
    spinOff({ cut_date: '2027-03-31', new_ruc: U.rucCheck('2061245780'), legal_name: 'GRANJA DON GUANDO SAC' });
    if (expectedDocType(FARM, '2027-04-02') !== 'INVOICE') throw new Error('El 02/04/2027 debía esperarse INVOICE');
    if (expectedDocType(FARM, '2027-03-31') !== 'NTI') throw new Error('El 31/03/2027 debía seguir NTI');
    expectFail(() => createLink({ supplier_id: FARM, mode: 'INVOICE', valid_from: '2027-03-15', farm_ruc: U.rucCheck('2061245780') }), 'RN-GRJ-01');
  } });
  G.tests.push({ module: MOD, name: 'CA-GRJ-04: un proveedor de granja con RUC distinto al de la empresa no puede tener vínculo NTI (RN-GRJ-03)', fn: async () => {
    const s = G.db.insert('suppliers', { doc_type: 'RUC', doc_number: U.rucCheck('2061245780'), legal_name: 'GRANJA DON GUANDO SAC', trade_name: 'Granja (RUC propio)', supplier_type: 'RELATED_FARM', status: 'ACTIVE', payment_terms_days: 15, sunat_status: 'ACTIVE' });
    expectFail(() => createLink({ supplier_id: s.id, mode: 'NTI', valid_from: '2027-01-01' }), 'RN-GRJ-03');
  } });
  G.tests.push({ module: MOD, name: 'CA-GRJ-05: el mismo envío recibido dos veces por webhook deja un solo registro (RN-GRJ-04)', fn: async () => {
    const p = nti245('NI01-000247', 120);
    const a = ingest(p); const b = ingest(JSON.parse(JSON.stringify(p)));
    if (!b.duplicate || b.dispatch.id !== a.dispatch.id) throw new Error('El segundo webhook no se reconoció como duplicado');
    const n = G.db.where('farm_dispatches', d => d.idempotency_key === a.dispatch.idempotency_key).length;
    if (n !== 1) throw new Error('Quedaron ' + n + ' registros');
    if (G.db.where('purchase_documents', d => d.series === 'NI01' && d.number === '247').length !== 1) throw new Error('Se duplicó el comprobante');
  } });
})();
