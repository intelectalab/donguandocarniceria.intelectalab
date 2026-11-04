/* =====================================================================
   FAC · Comprobantes electrónicos y guía de remisión (FAC-01 … FAC-12)
   Un solo RUC (AGROPECUARIA DON GUANDO SAC) emite para 5 marcas con series
   propias (F001–F005, B001–B005, B010 mostrador). Envío asíncrono al OSE
   simulado con reintentos (fac_retry_backoff_minutes), notas de crédito y
   débito (catálogos 09 y 10), resumen diario y comunicación de baja, guía
   de remisión remitente (catálogo 20). Expone G.fac.
   ===================================================================== */
(function () {
  const { h, btn, badge, status, page, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs, pills } = G.ui;
  const U = G.util, F = G.fmt, D = G.db;
  const R = (n, d = 2) => U.round(n, d);
  const money = v => F.money(v);

  /* IGV: el parámetro fac_igv_rate se expresa como fracción (0.18). El núcleo lo dividía
     entre 100; FAC, dueño del parámetro, interpreta ambos formatos (0.18 o 18). */
  G.tax.rate = function () { const v = Number(G.param('fac_igv_rate') ?? 0.18); return v > 1 ? v / 100 : v; };

  /* ---------- catálogos SUNAT ---------- */
  const CAT09 = [['01', 'Anulación de la operación'], ['02', 'Anulación por error en el RUC'], ['03', 'Corrección por error en la descripción'], ['04', 'Descuento global'], ['05', 'Descuento por ítem'], ['06', 'Devolución total'], ['07', 'Devolución por ítem'], ['08', 'Bonificación'], ['09', 'Disminución en el valor (diferencia de peso)'], ['10', 'Otros conceptos'], ['13', 'Ajustes de montos o fechas de pago']];
  const CAT10 = [['01', 'Intereses por mora'], ['02', 'Aumento en el valor'], ['03', 'Penalidades u otros conceptos']];
  const CAT20 = [['01', 'Venta'], ['02', 'Compra'], ['04', 'Traslado entre establecimientos de la misma empresa'], ['05', 'Consignación'], ['06', 'Devolución'], ['08', 'Importación'], ['09', 'Exportación'], ['13', 'Otros'], ['14', 'Venta sujeta a confirmación del comprador'], ['17', 'Traslado de bienes para transformación']];
  const catName = (cat, c) => (cat.find(x => x[0] === c) || [c, c])[1];
  const SUNAT_CODE = { INVOICE: '01', RECEIPT: '03', CREDIT_NOTE: '07', DEBIT_NOTE: '08', DISPATCH_GUIDE: '09' };
  const ID_CODE = { RUC: '6', DNI: '1', CE: '4', NONE: '0' };
  const ID_NAME = { RUC: 'RUC', DNI: 'DNI', CE: 'C. E.', NONE: 'Sin documento' };
  const TYPE_SHORT = { INVOICE: 'Factura', RECEIPT: 'Boleta', CREDIT_NOTE: 'N. crédito', DEBIT_NOTE: 'N. débito', INTERNAL_NOTE: 'Nota interna' };
  const typeBadge = t => badge(TYPE_SHORT[t] || G.docTypeName(t), { INVOICE: 'info', RECEIPT: '', CREDIT_NOTE: 'warn', DEBIT_NOTE: 'warn' }[t] || '');
  const docNo = d => d ? (d.full_number || `${d.series}-${U.pad(d.number, 8)}`) : '—';
  const valid = d => d && d.status !== 'VOIDED' && d.sunat_status !== 'REJECTED';
  const isSent = d => (d.send_attempts || 0) > 0 || d.sunat_status !== 'PENDING';
  const sunatBadge = d => d.status === 'VOIDED' && d.sunat_status !== 'VOIDED' ? h('span', { class: 'row', style: 'gap:4px' }, status(d.sunat_status), badge('Baja solicitada', 'bad')) : status(d.sunat_status);
  const brandOf = id => D.get('brands', id) || { name: '—', primary_color: 'var(--primary)', code: '?' };
  const company = () => D.get('companies', 'co-dg') || { legal_name: 'AGROPECUARIA DON GUANDO SAC', ruc: '—', fiscal_address: '' };

  /* ---------- tiempo (reloj simulado del OSE: minutos) ---------- */
  const T = {
    parse(s) { const [d, t = '00:00:00'] = String(s).split('T'); const [y, m, dd] = d.split('-').map(Number); const [hh = 0, mi = 0, ss = 0] = t.split(':').map(Number); return Date.UTC(y, m - 1, dd, hh, mi, ss); },
    fmt(ms) { return new Date(ms).toISOString().slice(0, 19); },
    add(s, min) { return T.fmt(T.parse(s) + min * 60000); },
    diffMin(a, b) { return (T.parse(a) - T.parse(b)) / 60000; },
  };
  const hash = s => { let h1 = 0x811c9dc5, h2 = 0x1b873593; for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619); h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822507); } const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789+/'; let out = ''; let x = h1 >>> 0, y = h2 >>> 0; for (let i = 0; i < 28; i++) { out += a[(i % 2 ? x : y) % a.length]; if (i % 2) x = Math.floor(x / a.length) || (x ^ 0x9e3779b9) >>> 0; else y = Math.floor(y / a.length) || (y ^ 0x85ebca6b) >>> 0; } return out; };

  /* ---------- índices ---------- */
  function index() {
    const byOrder = new Map(), notes = new Map();
    for (const d of D.all('sales_documents')) {
      if (d.order_id && ['INVOICE', 'RECEIPT'].includes(d.doc_type)) { if (!byOrder.has(d.order_id)) byOrder.set(d.order_id, []); byOrder.get(d.order_id).push(d); }
      if (d.related_document_id) { if (!notes.has(d.related_document_id)) notes.set(d.related_document_id, []); notes.get(d.related_document_id).push(d); }
    }
    return { byOrder, notes };
  }
  /** suma de notas de crédito vigentes de un comprobante (RN-FAC-08) */
  function credited(docId) { return R(U.sum(D.where('sales_documents', n => n.related_document_id === docId && n.doc_type === 'CREDIT_NOTE' && valid(n)), n => n.total)); }

  /* ---------- series (RN-FAC-02, RN-FAC-12) ---------- */
  function seriesFor(docType, brand_id, opts = {}) {
    if (opts.counter && docType === 'RECEIPT') return 'B010';
    const cands = D.where('document_series', s => s.doc_type === docType && s.status === 'ACTIVE' && (!opts.appliesTo || s.applies_to === opts.appliesTo) && (docType === 'DISPATCH_GUIDE' ? true : s.brand_id === brand_id));
    const site = opts.site;
    const best = cands.find(s => site && s.establishment_id === site) || cands.find(s => !site || s.all_sites || !s.establishment_id) || cands[0];
    return best ? best.series : null;
  }
  function assertSeries(code, docType, brand_id, site, opts = {}) {
    const s = D.find('document_series', x => x.series === code);
    if (!s) G.fail('RN-FAC-02', `No existe la serie ${code}. Créala en FAC-10.`);
    if (s.company_id && s.company_id !== 'co-dg') G.fail('RN-FAC-02', `La serie ${code} no pertenece a la empresa emisora.`);
    if (s.status !== 'ACTIVE') G.fail('RN-FAC-02', `La serie ${code} está inactiva; actívala en FAC-10 o usa otra.`);
    if (s.doc_type !== docType) G.fail('RN-FAC-02', `La serie ${code} es de ${G.docTypeName(s.doc_type).toLowerCase()}, no de ${G.docTypeName(docType).toLowerCase()}.`);
    if (docType === 'DISPATCH_GUIDE') { if (s.establishment_id && site && s.establishment_id !== site) G.fail('RN-FAC-12', `La serie de guía ${code} es del ${G.siteName(s.establishment_id)}; la guía sale del ${G.siteName(site)} (usa ${seriesFor('DISPATCH_GUIDE', null, { site })}).`); return s; }
    if (s.brand_id && s.brand_id !== brand_id) G.fail('RN-FAC-02', `La serie ${code} está configurada para ${G.brandName(s.brand_id)}; un comprobante de ${G.brandName(brand_id)} usa la serie ${seriesFor(docType, brand_id, { appliesTo: s.applies_to, site }) || '(sin serie)'}.`);
    if (!s.brand_id && !(code === 'B010' && opts.counter)) G.fail('RN-FAC-02', `La serie ${code} es exclusiva del mostrador del ${G.siteName(s.establishment_id)}.`);
    if (s.establishment_id && site && s.establishment_id !== site && !s.all_sites) G.fail('RN-FAC-02', `La serie ${code} es del ${G.siteName(s.establishment_id)} y el comprobante es del ${G.siteName(site)}.`);
    return s;
  }

  /* ---------- validación previa al envío (RN-FAC-01) ---------- */
  function assertReady(doc) {
    const ls = doc.lines || [];
    if (!ls.length) G.fail('RN-FAC-01', `${docNo(doc)} no tiene líneas: agrega al menos una antes de enviar.`);
    const s = R(U.sum(ls, l => l.subtotal)), i = R(U.sum(ls, l => l.igv)), t = R(U.sum(ls, l => l.total));
    if (Math.abs(t - doc.total) > 0.01) G.fail('RN-FAC-01', `Las líneas de ${docNo(doc)} suman ${money(t)} y la cabecera dice ${money(doc.total)}: corrige antes de enviar.`);
    if (Math.abs(s - doc.subtotal) > 0.01 || Math.abs(i - doc.igv) > 0.01) G.fail('RN-FAC-01', `El valor de venta (${money(s)}) o el IGV (${money(i)}) de las líneas no cuadra con la cabecera (${money(doc.subtotal)} / ${money(doc.igv)}).`);
    if (Math.abs(R(doc.subtotal + doc.igv) - doc.total) > 0.01) G.fail('RN-FAC-01', `Valor de venta + IGV (${money(doc.subtotal + doc.igv)}) no es igual al total (${money(doc.total)}).`);
    return true;
  }

  /* ---------- OSE / PSE simulado (EInvoiceProvider FAKE) ---------- */
  const ose = {
    mode: 'ONLINE', next: null,
    submit(row, kind) {
      if (this.mode === 'DOWN') return { result: 'TIMEOUT', code: '0109', message: 'El OSE no respondió en 30 s (servicio no disponible). Se reintentará.' };
      if (this.next) { const n = this.next; this.next = null; if (n === 'OBSERVED') return { result: 'OBSERVED', code: '4287', message: 'El precio unitario ingresado difiere del calculado con el valor de venta (se acepta con observación).' }; if (n === 'REJECTED') return { result: 'REJECTED', code: '3105', message: 'El XML no contiene la dirección del punto de llegada o del establecimiento emisor.' }; }
      if (kind === 'DOC') {
        if (row.doc_type === 'INVOICE' && !U.rucOk(row.customer_doc_number)) return { result: 'REJECTED', code: '2017', message: 'El número de documento de identidad del receptor debe ser RUC válido.' };
        if (row.related_document_id) { const ref = D.get('sales_documents', row.related_document_id); if (ref && ref.sunat_status === 'REJECTED') return { result: 'REJECTED', code: '2116', message: 'El comprobante de referencia fue rechazado por SUNAT.' }; }
        return { result: 'ACCEPTED', code: '0', message: `La ${G.docTypeName(row.doc_type)} número ${docNo(row)}, ha sido aceptada.` };
      }
      return { result: 'ACCEPTED', code: '0', message: kind === 'GUIDE' ? `La guía de remisión ${row.full_number} ha sido aceptada.` : `El resumen ${row.identifier} ha sido aceptado.` };
    },
  };
  const fac = { offset: 0 };
  const clock = () => T.add(G.date.now(), fac.offset);
  const backoff = () => { const b = G.param('fac_retry_backoff_minutes'); return Array.isArray(b) && b.length ? b : [1, 5, 15, 60, 240]; };
  const maxAttempts = () => Number(G.param('fac_max_send_attempts') ?? 5) || 5;

  /** registra un intento de envío (fac_register_attempt) · RN-FAC-06 */
  function send(docOrId, opts = {}) {
    const doc = typeof docOrId === 'string' ? D.get('sales_documents', docOrId) : docOrId;
    if (!doc) G.fail('RN-FAC-06', 'Comprobante no encontrado.');
    if (doc.sunat_status !== 'PENDING') G.fail('RN-FAC-03', `${docNo(doc)} ya tiene respuesta de SUNAT (${G.ui.statusLabel(doc.sunat_status)}): no se vuelve a enviar.`);
    if (doc.status === 'VOIDED') G.fail('RN-FAC-10', `${docNo(doc)} está anulado.`);
    assertReady(doc);
    const at = opts.at || clock();
    const n = (doc.send_attempts || 0) + 1;
    const res = ose.submit(doc, 'DOC');
    D.insert('einvoice_submissions', { document_id: doc.id, guide_id: null, summary_id: null, attempt_no: n, provider: G.param('fac_einvoice_provider') || 'FAKE', requested_at: at, response_code: res.code, result: res.result, message: res.message, duration_ms: res.result === 'TIMEOUT' ? 30000 : 380 + (n * 53) % 400, manual: !!opts.manual }, { silent: true });
    const patch = { send_attempts: n, last_attempt_at: at, sunat_code: res.code, sunat_message: res.message };
    if (res.result === 'ACCEPTED' || res.result === 'OBSERVED') Object.assign(patch, { sunat_status: res.result, sent_at: at, accepted_at: T.add(at, 0.02), next_retry_at: null, needs_review: false, xml_hash: doc.xml_hash || hash(doc.full_number + doc.total), cdr_hash: hash('CDR' + doc.full_number + at) });
    else if (res.result === 'REJECTED') Object.assign(patch, { sunat_status: 'REJECTED', sent_at: at, next_retry_at: null, needs_review: true, xml_hash: doc.xml_hash || hash(doc.full_number + doc.total) });
    else { const b = backoff(); if (n < maxAttempts()) Object.assign(patch, { next_retry_at: T.add(at, b[Math.min(n - 1, b.length - 1)]), needs_review: false }); else Object.assign(patch, { next_retry_at: null, needs_review: true }); }
    D.update('sales_documents', doc.id, patch, { silent: true });
    if (patch.sunat_status === 'ACCEPTED' || patch.sunat_status === 'OBSERVED') G.events.emit('document.accepted', { document_id: doc.id, full_number: doc.full_number, sunat_status: patch.sunat_status, order_id: doc.order_id });
    if (patch.sunat_status === 'REJECTED') { G.events.emit('document.rejected', { document_id: doc.id, full_number: doc.full_number, code: res.code, message: res.message }); if (!G._seeding) G.notify({ role: 'ADMINISTRACION', title: `SUNAT rechazó ${docNo(doc)}`, body: `${res.code} · ${res.message}`, ref: doc.id, tone: 'bad', module: 'FAC' }); }
    return { result: res.result, attempt: n, code: res.code, message: res.message };
  }
  function sendGuide(gOrId, opts = {}) {
    const g = typeof gOrId === 'string' ? D.get('dispatch_guides', gOrId) : gOrId;
    if (g.sunat_status !== 'PENDING') G.fail('RN-FAC-03', `La guía ${g.full_number} ya tiene respuesta de SUNAT.`);
    const at = opts.at || clock(); const n = (g.send_attempts || 0) + 1;
    const res = ose.submit(g, 'GUIDE');
    D.insert('einvoice_submissions', { document_id: null, guide_id: g.id, summary_id: null, attempt_no: n, provider: G.param('fac_einvoice_provider') || 'FAKE', requested_at: at, response_code: res.code, result: res.result, message: res.message, duration_ms: res.result === 'TIMEOUT' ? 30000 : 520 }, { silent: true });
    const patch = { send_attempts: n, last_attempt_at: at, sunat_code: res.code, sunat_message: res.message };
    if (res.result === 'ACCEPTED' || res.result === 'OBSERVED') Object.assign(patch, { sunat_status: 'ACCEPTED', accepted_at: at, next_retry_at: null });
    else if (res.result === 'REJECTED') Object.assign(patch, { sunat_status: 'REJECTED', next_retry_at: null });
    else { const b = backoff(); patch.next_retry_at = n < maxAttempts() ? T.add(at, b[Math.min(n - 1, b.length - 1)]) : null; patch.needs_review = n >= maxAttempts(); }
    D.update('dispatch_guides', g.id, patch, { silent: true });
    return { result: res.result, attempt: n };
  }
  /** procesa la cola: reintentos vencidos y comprobantes aún no enviados (outbox) */
  function processQueue(at) {
    at = at || clock(); let n = 0; const out = { accepted: 0, failed: 0, rejected: 0 };
    for (const d of D.where('sales_documents', d => d.sunat_status === 'PENDING' && d.status !== 'VOIDED' && !d.needs_review && !d.summary_pending && (!d.send_attempts || (d.next_retry_at && d.next_retry_at <= at)))) {
      try { const r = send(d, { at }); n++; if (r.result === 'ACCEPTED' || r.result === 'OBSERVED') out.accepted++; else if (r.result === 'REJECTED') out.rejected++; else out.failed++; } catch (e) { out.failed++; }
    }
    for (const g of D.where('dispatch_guides', g => g.sunat_status === 'PENDING' && g.status !== 'VOIDED' && !g.needs_review && (!g.send_attempts || (g.next_retry_at && g.next_retry_at <= at)))) { const r = sendGuide(g, { at }); n++; if (r.result === 'ACCEPTED') out.accepted++; else out.failed++; }
    for (const s of D.where('sunat_daily_summaries', s => s.status === 'SENT')) { querySummary(s.id); n++; }
    out.processed = n; return out;
  }

  /* ---------- emisión (fac_assert_ready + numeración sin saltos) ---------- */
  function issue(d, opts = {}) {
    const date = d.date || G.TODAY;
    try { G.period.assertOpen(date); } catch (e) { G.fail('RN-FAC-17', `No se emite con fecha de un período cerrado (${e.message}).`); }
    if (!(d.lines || []).length) G.fail('RN-FAC-01', 'El comprobante necesita al menos una línea.');
    for (const l of d.lines) { if (!(Number(l.total) > 0)) G.fail('RN-FAC-01', `La línea «${l.description || '—'}» no tiene importe.`); if (!(Number(l.qty) > 0)) G.fail('RN-FAC-01', `La línea «${l.description || '—'}» no tiene cantidad.`); }
    const cust = D.get('customers', d.customer_id) || null;
    const buyer = Object.assign({ doc_type: cust ? (cust.doc_type || 'NONE') : 'NONE', doc_number: cust ? cust.doc_number : null, name: cust ? cust.full_name : 'Clientes varios' }, d.buyer || {});
    if (!buyer.doc_number) buyer.doc_type = 'NONE';
    const total = R(U.sum(d.lines, l => Number(l.total)));
    if (d.doc_type === 'INVOICE' && !(buyer.doc_type === 'RUC' && U.rucOk(buyer.doc_number))) G.fail('RN-FAC-04', `La factura exige un cliente con RUC de 11 dígitos y dígito verificador válido (${buyer.name}: ${buyer.doc_number || 'sin documento'}). Emite boleta o corrige el RUC en CLI.`);
    const lim = Number(G.param('fac_receipt_id_required_above') ?? 700);
    if (d.doc_type === 'RECEIPT' && total > lim && !buyer.doc_number) G.fail('RN-FAC-05', `La boleta de ${money(total)} supera ${money(lim)} (fac_receipt_id_required_above): identifica al adquirente con su DNI u otro documento.`);
    if (d.payment_terms === 'CREDIT' && !(Number(d.credit_days) > 0) && !d.due_date) G.fail('RN-FAC-13', 'Un comprobante al crédito necesita fecha de vencimiento (días de crédito).');
    const site = d.establishment_id || 'es-L1';
    const series = d.series || seriesFor(d.doc_type, d.brand_id, { counter: d.counter, appliesTo: d.applies_to, site });
    if (!series) G.fail('RN-FAC-02', `No hay una serie activa de ${G.docTypeName(d.doc_type).toLowerCase()} para ${G.brandName(d.brand_id)}.`);
    assertSeries(series, d.doc_type, d.brand_id, site, { counter: d.counter });
    fac._issuing = true; let doc;
    try {
      doc = G.docs.issue({ doc_type: d.doc_type, brand_id: d.brand_id, establishment_id: site, customer_id: d.customer_id || 'cu-VARIOS', order_id: d.order_id || null, lines: d.lines.map(l => Object.assign({ igv_affectation: '10', uom_code: 'NIU', cost: 0 }, l)), date, series, related_document_id: d.related_document_id, note_reason_code: d.note_reason_code, note_reason: d.note_reason, payment_terms: d.payment_terms || 'CASH', credit_days: d.credit_days, seller_id: d.seller_id || G.ctx.userId(), accept: false, silent: !!opts.silent });
    } finally { fac._issuing = false; }
    const issued_at = opts.at || (date === G.TODAY ? clock() : date + 'T18:00:00');
    const addr = cust ? D.find('customer_addresses', a => a.customer_id === cust.id && a.is_default) : null;
    D.update('sales_documents', doc.id, { customer_doc_type: buyer.doc_type, customer_doc_number: buyer.doc_number || null, customer_name: buyer.name, buyer_address: buyer.address || (addr ? addr.address_line : null), brand_name: brandOf(d.brand_id).name, brand_logo: 'logo-' + brandOf(d.brand_id).code, issued_at, due_date: d.payment_terms === 'CREDIT' ? (d.due_date || doc.due_date) : null, next_retry_at: null, needs_review: false, summary_pending: d.doc_type === 'RECEIPT' && G.param('fac_receipt_summary_mode') === 'SUMMARY', cash_shift_id: d.cash_shift_id || null }, { silent: true });
    if (opts.send !== false && !doc.summary_pending) send(doc, { at: issued_at });
    return doc;
  }
  function linesFromOrder(o) {
    const ls = o.lines.map(l => { const v = G.variant(l.variant_id) || { name: l.variant_id, std_cost: 0 }; const kg = l.price_basis === 'KG'; const qty = kg ? l.weighed_kg : l.qty; return { variant_id: l.variant_id, description: v.name + (kg ? ` · ${F.num(l.weighed_kg, 3)} kg` + (v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? ` (${l.qty} u)` : '') : ''), qty, units: l.qty, uom_code: kg ? 'KGM' : 'NIU', unit_price: l.unit_price, igv_affectation: (G.productOf(l.variant_id) || {}).igv_affectation || '10', total: l.final_amount ?? l.est_amount, lot_id: l.lot_id || null, unit_cost: v.std_cost, cost: R(qty * (v.std_cost || 0)) }; });
    if (o.delivery_fee > 0) ls.push({ variant_id: null, description: 'Servicio de delivery', qty: 1, uom_code: 'ZZ', unit_price: o.delivery_fee, igv_affectation: '10', total: o.delivery_fee, cost: 0 });
    return ls;
  }
  /** FAC-02 · RN-FAC-14: el pedido se factura con el peso real */
  function issueFromOrder(orderOrId, opts = {}) {
    const o = typeof orderOrId === 'string' ? D.get('sales_orders', orderOrId) : orderOrId;
    if (!o) G.fail('RN-FAC-14', 'Pedido no encontrado.');
    if (!['READY', 'IN_ROUTE', 'DELIVERED', 'CLOSED'].includes(o.status)) G.fail('RN-FAC-14', `El pedido ${o.number} está «${G.ui.statusLabel(o.status)}»: se factura listo o entregado, con su peso real.`);
    const pend = (o.lines || []).filter(l => l.price_basis === 'KG' && l.weighed_kg == null);
    if (pend.length) G.fail('RN-FAC-14', `Faltan pesar ${pend.length} línea(s) por kg del pedido ${o.number}: el comprobante sale con el peso real.`);
    if (o.requested_doc_type === 'NONE') G.fail('RN-FAC-14', `El pedido ${o.number} no pidió comprobante.`);
    const prev = D.find('sales_documents', d => d.order_id === o.id && ['INVOICE', 'RECEIPT'].includes(d.doc_type) && valid(d));
    if (prev) G.fail('RN-FAC-14', `El pedido ${o.number} ya tiene el comprobante ${docNo(prev)}.`);
    G.orders.recalc(o);
    const cust = D.get('customers', o.billing_customer_id || o.customer_id);
    const type = opts.doc_type || G.docs.typeFor(cust, o.requested_doc_type);
    return issue({ doc_type: type, brand_id: o.brand_id, establishment_id: o.establishment_id, customer_id: cust ? cust.id : o.customer_id, order_id: o.id, lines: linesFromOrder(o), date: opts.date, counter: o.channel === 'COUNTER', seller_id: o.seller_id, payment_terms: o.payment_method_id === 'pm-CREDIT' ? 'CREDIT' : 'CASH', credit_days: opts.credit_days || (cust && cust.credit_days) || 15, buyer: opts.buyer }, opts);
  }
  /** RN-FAC-03: un comprobante enviado no cambia */
  const IMMUTABLE = ['doc_type', 'series', 'number', 'full_number', 'issue_date', 'customer_id', 'customer_doc_type', 'customer_doc_number', 'customer_name', 'subtotal', 'igv', 'total', 'lines'];
  function update(docId, patch) {
    const doc = D.get('sales_documents', docId);
    const bad = Object.keys(patch).filter(k => IMMUTABLE.includes(k));
    if (isSent(doc) && bad.length) G.fail('RN-FAC-03', `${docNo(doc)} ya fue enviado a SUNAT (${G.ui.statusLabel(doc.sunat_status)}): no cambia ${bad.join(', ')}. Corrígelo con una nota de crédito o de débito.`);
    return D.update('sales_documents', docId, patch);
  }

  /* ---------- notas (RN-FAC-07, RN-FAC-08, RN-FAC-15) ---------- */
  function note(kind, d) {
    const ref = D.get('sales_documents', d.document_id);
    const cat = kind === 'CREDIT_NOTE' ? CAT09 : CAT10;
    if (!ref || !['INVOICE', 'RECEIPT'].includes(ref.doc_type)) G.fail('RN-FAC-07', 'La nota refiere a una factura o a una boleta.');
    if (!valid(ref)) G.fail('RN-FAC-07', `${docNo(ref)} está ${ref.status === 'VOIDED' ? 'anulado' : 'rechazado por SUNAT'}: no admite notas.`);
    const code = U.pad(String(d.reason_code || ''), 2);
    if (!cat.find(x => x[0] === code)) G.fail('RN-FAC-07', `Elige el motivo SUNAT del catálogo ${kind === 'CREDIT_NOTE' ? '09' : '10'}.`);
    if (d.customer_id && d.customer_id !== ref.customer_id) G.fail('RN-FAC-07', `La nota es del mismo cliente del comprobante (${ref.customer_name}).`);
    const series = d.series || seriesFor(kind, ref.brand_id, { appliesTo: ref.doc_type, site: ref.establishment_id });
    const s = D.find('document_series', x => x.series === series);
    if (!s || s.doc_type !== kind || s.applies_to !== ref.doc_type || series[0] !== ref.series[0]) G.fail('RN-FAC-07', `La serie ${series || '—'} no corresponde: una nota de ${docNo(ref)} usa una serie ${ref.series[0]} de ${kind === 'CREDIT_NOTE' ? 'nota de crédito' : 'nota de débito'} de ${G.docTypeName(ref.doc_type).toLowerCase()}.`);
    let lines = d.lines;
    if (!lines || !lines.length) { const amt = R(Number(d.amount) || 0); lines = [{ variant_id: null, description: `${catName(cat, code)} · ref. ${docNo(ref)}`, qty: 1, uom_code: 'ZZ', unit_price: amt, igv_affectation: (ref.lines[0] || {}).igv_affectation || '10', total: amt }]; }
    const total = R(U.sum(lines, l => Number(l.total)));
    if (!(total > 0)) G.fail('RN-FAC-07', 'La nota necesita un importe mayor que cero.');
    if (kind === 'CREDIT_NOTE') { const used = credited(ref.id); const avail = R(ref.total - used); if (total > avail + 0.005) G.fail('RN-FAC-08', `${docNo(ref)} (${money(ref.total)}) ya tiene notas de crédito por ${money(used)}: el disponible es ${money(avail)} y pides ${money(total)}.`); }
    const doc = issue({ doc_type: kind, brand_id: ref.brand_id, establishment_id: ref.establishment_id, customer_id: ref.customer_id, buyer: { doc_type: ref.customer_doc_type, doc_number: ref.customer_doc_number, name: ref.customer_name }, order_id: ref.order_id, related_document_id: ref.id, note_reason_code: code, note_reason: d.reason || catName(cat, code), lines, date: d.date, series }, { send: d.send });
    // devolución: reingreso del stock al almacén de devoluciones (RN-ALM-01)
    if (kind === 'CREDIT_NOTE' && d.restock && ['06', '07'].includes(code)) {
      for (const l of lines) {
        if (!l.variant_id) continue; const v = G.variant(l.variant_id); if (!v) continue;
        const qty = v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? (l.units || Math.max(1, Math.round(l.qty / (v.nominal_weight_kg || 1)))) : l.qty;
        G.inv.move({ type: 'RETURN', wh: d.restock.wh || 'wh-DEV-L1', variant: v.id, lot: l.lot_id || null, qty, weight: v.sale_mode !== 'UNIT' ? l.qty : null, unitCost: l.unit_cost || v.std_cost, source: { type: 'CREDIT_NOTE', id: doc.id }, reason: `Devolución ${docNo(doc)}` });
      }
      D.update('sales_documents', doc.id, { restocked_wh: d.restock.wh || 'wh-DEV-L1' }, { silent: true });
    }
    return doc;
  }
  const creditNote = d => note('CREDIT_NOTE', d);
  const debitNote = d => note('DEBIT_NOTE', d);
  /** RN-FAC-15: reclamo de peso después de emitir → nota de crédito 09 por disminución de valor */
  function weightCreditNote(docId, claims, reason) {
    const ref = D.get('sales_documents', docId);
    const lines = [];
    for (const c of claims) {
      const l = ref.lines[c.line]; if (!l || l.uom_code !== 'KGM') G.fail('RN-FAC-15', 'La diferencia de peso se aplica a líneas vendidas por kg.');
      const kg = Number(c.real_kg); if (!(kg >= 0) || kg >= l.qty) G.fail('RN-FAC-15', `El peso reclamado (${F.num(kg, 3)} kg) debe ser menor al facturado (${F.num(l.qty, 3)} kg).`);
      lines.push({ variant_id: null, description: `Diferencia de peso ${F.num(l.qty - kg, 3)} kg · ${l.description.split(' · ')[0]}`, qty: R(l.qty - kg, 3), uom_code: 'KGM', unit_price: l.unit_price, igv_affectation: l.igv_affectation || '10', total: R((l.qty - kg) * l.unit_price) });
    }
    return creditNote({ document_id: docId, reason_code: U.pad(String(G.param('fac_weight_credit_note_reason') ?? '09'), 2), reason: reason || 'Reclamo del cliente por diferencia de peso', lines });
  }

  /* ---------- anulación (RN-FAC-09, RN-FAC-10) y resúmenes ---------- */
  function voidDoc(docId, reason) {
    const doc = D.get('sales_documents', docId);
    if (!reason || !String(reason).trim()) G.fail('RN-FAC-10', 'Anular exige motivo.');
    if (doc.status === 'VOIDED') G.fail('RN-FAC-10', `${docNo(doc)} ya está anulado: un comprobante anulado no se reactiva.`);
    if (doc.sunat_status === 'REJECTED') G.fail('RN-FAC-10', `${docNo(doc)} fue rechazado por SUNAT y no tiene validez: reemítelo con un nuevo número.`);
    const nc = D.find('sales_documents', n => n.related_document_id === doc.id && valid(n));
    if (nc) G.fail('RN-FAC-10', `${docNo(doc)} tiene la nota ${docNo(nc)}: corrige con otra nota de crédito (motivo 01) en lugar de anular.`);
    const patch = { status: 'VOIDED', void_reason: reason, voided_at: G.date.now(), voided_by: G.ctx.userName() };
    if (doc.sunat_status === 'PENDING' && !isSent(doc)) { patch.sunat_status = 'VOIDED'; D.update('sales_documents', doc.id, patch); return null; }
    D.update('sales_documents', doc.id, patch);
    const type = doc.series[0] === 'B' ? 'RC' : 'RA';
    let s = D.find('sunat_daily_summaries', x => x.summary_type === type && x.reference_date === G.TODAY && x.status === 'PENDING');
    if (!s) s = D.insert('sunat_daily_summaries', { company_id: 'co-dg', summary_type: type, reference_date: G.TODAY, identifier: `${type}-${G.TODAY.replace(/-/g, '')}-${D.where('sunat_daily_summaries', x => x.summary_type === type && x.reference_date === G.TODAY).length + 1}`, ticket: null, status: 'PENDING', sent_at: null }, { silent: true });
    D.insert('sunat_daily_summary_lines', { summary_id: s.id, document_id: doc.id, action: 'VOID', reason }, { silent: true });
    return s;
  }
  function createDailySummary(date) {
    const docs = D.where('sales_documents', d => d.doc_type === 'RECEIPT' && d.issue_date === date && d.summary_pending && d.sunat_status === 'PENDING');
    if (!docs.length) G.fail('RN-FAC-09', `No hay boletas del ${F.date(date)} pendientes de informar por resumen diario.`);
    const s = D.insert('sunat_daily_summaries', { company_id: 'co-dg', summary_type: 'RC', reference_date: date, identifier: `RC-${date.replace(/-/g, '')}-${D.where('sunat_daily_summaries', x => x.summary_type === 'RC' && x.reference_date === date).length + 1}`, status: 'PENDING' });
    for (const d of docs) D.insert('sunat_daily_summary_lines', { summary_id: s.id, document_id: d.id, action: 'ADD' }, { silent: true });
    return s;
  }
  function sendSummary(id, opts = {}) {
    const s = D.get('sunat_daily_summaries', id);
    if (s.status !== 'PENDING') G.fail('RN-FAC-09', `${s.identifier} ya fue enviado.`);
    const at = opts.at || clock(); const n = D.where('einvoice_submissions', x => x.summary_id === id).length + 1;
    const res = ose.submit(s, 'SUMMARY');
    const ok = res.result === 'ACCEPTED' || res.result === 'OBSERVED';
    D.insert('einvoice_submissions', { summary_id: id, attempt_no: n, provider: G.param('fac_einvoice_provider') || 'FAKE', requested_at: at, response_code: ok ? '0' : res.code, result: ok ? 'ACCEPTED' : res.result, message: ok ? `Ticket generado para ${s.identifier}` : res.message, duration_ms: 610 }, { silent: true });
    if (!ok) return D.update('sunat_daily_summaries', id, { last_error: res.message });
    return D.update('sunat_daily_summaries', id, { status: 'SENT', sent_at: at, ticket: '20261' + String(Math.abs(parseInt(hash(s.identifier).replace(/[^0-9]/g, '').slice(0, 8) || '7', 10))).padStart(10, '3'), last_error: null });
  }
  function querySummary(id) {
    const s = D.get('sunat_daily_summaries', id);
    if (s.status !== 'SENT') G.fail('RN-FAC-09', `${s.identifier} no tiene ticket pendiente de consulta.`);
    D.update('sunat_daily_summaries', id, { status: 'ACCEPTED', accepted_at: clock() });
    for (const l of D.where('sunat_daily_summary_lines', x => x.summary_id === id)) {
      const d = D.get('sales_documents', l.document_id); if (!d) continue;
      if (l.action === 'VOID') { D.update('sales_documents', d.id, { sunat_status: 'VOIDED' }, { silent: true }); }
      else if (l.action === 'ADD' && d.sunat_status === 'PENDING') { D.update('sales_documents', d.id, { sunat_status: 'ACCEPTED', summary_pending: false, sent_at: s.sent_at, accepted_at: clock(), xml_hash: hash(d.full_number) }, { silent: true }); G.events.emit('document.accepted', { document_id: d.id, full_number: d.full_number }); }
    }
    return D.get('sunat_daily_summaries', id);
  }
  /** comprobante rechazado: se reemite con un número nuevo (el rechazado no se reutiliza) */
  function reissue(docId, opts = {}) {
    const old = D.get('sales_documents', docId);
    if (old.sunat_status !== 'REJECTED') G.fail('RN-FAC-03', `${docNo(old)} no está rechazado: corrígelo con nota de crédito o débito.`);
    if (old.reissued_by) G.fail('RN-FAC-03', `${docNo(old)} ya se reemitió como ${docNo(D.get('sales_documents', old.reissued_by))}.`);
    const doc = issue({ doc_type: old.doc_type, brand_id: old.brand_id, establishment_id: old.establishment_id, customer_id: old.customer_id, buyer: opts.buyer || { doc_type: old.customer_doc_type, doc_number: old.customer_doc_number, name: old.customer_name, address: old.buyer_address || D.get('establishments', old.establishment_id).address }, order_id: old.order_id, related_document_id: old.related_document_id, note_reason_code: old.note_reason_code, note_reason: old.note_reason, lines: old.lines.map(l => ({ variant_id: l.variant_id, description: l.description, qty: l.qty, units: l.units, uom_code: l.uom_code, unit_price: l.unit_price, igv_affectation: l.igv_affectation, total: l.total, lot_id: l.lot_id, unit_cost: l.unit_cost, cost: l.cost })), payment_terms: old.payment_terms, credit_days: old.due_date ? Math.max(1, G.date.diff(old.due_date, old.issue_date)) : null, seller_id: old.seller_id });
    D.update('sales_documents', old.id, { reissued_by: doc.id }, { silent: true });
    // los cobros aplicados al rechazado pasan al nuevo
    for (const p of D.all('payments')) for (const a of p.allocations || []) if (a.document_id === old.id) a.document_id = doc.id;
    return doc;
  }

  /* ---------- guía de remisión remitente (RN-FAC-11, RN-FAC-12) ---------- */
  function issueGuide(d) {
    const date = d.date || G.TODAY;
    if (!G._seeding) try { G.period.assertOpen(date); } catch (e) { G.fail('RN-FAC-17', e.message); }
    const code = U.pad(String(d.reason_code || ''), 2);
    const allowed = (G.param('fac_gre_allowed_reasons') || []).map(String);
    if (!CAT20.find(x => x[0] === code)) G.fail('RN-FAC-11', 'Elige el motivo de traslado del catálogo 20.');
    if (!allowed.includes(code)) G.fail('RN-FAC-11', `El motivo ${code} · ${catName(CAT20, code)} no está habilitado (fac_gre_allowed_reasons: ${allowed.join(', ')}).`);
    const origin = d.origin_establishment_id || 'es-L1';
    const isTransfer = !!(d.transfer_id || d.transfer_ref);
    if (code === '01' && !(d.order_id || d.sales_document_id)) G.fail('RN-FAC-11', `El motivo 01 (venta) se enlaza al pedido o al comprobante${isTransfer ? '; un traslado entre locales usa el motivo 04' : ''}.`);
    if (code === '04') {
      if (!d.dest_establishment_id) G.fail('RN-FAC-11', 'El motivo 04 exige el establecimiento de llegada de la misma empresa.');
      if (d.dest_establishment_id === origin) G.fail('RN-FAC-11', 'El punto de llegada debe ser otro establecimiento.');
      if (!isTransfer) G.fail('RN-FAC-11', 'El motivo 04 se enlaza a la transferencia de almacén (ALM).');
    }
    if (['05', '14'].includes(code) && !d.recipient_customer_id) G.fail('RN-FAC-11', `El motivo ${code} exige el destinatario.`);
    const mode = d.transport_mode === '01' ? '01' : '02';
    if (mode === '01' && !d.carrier_supplier_id) G.fail('RN-FAC-11', 'Transporte público: indica la empresa de transporte.');
    let driverEmp = d.driver_employee_id || null;
    if (!driverEmp && d.driver_user_id) driverEmp = (D.get('users', d.driver_user_id) || {}).employee_id || null;
    if (mode === '02' && (!d.vehicle_id || !driverEmp)) G.fail('RN-FAC-11', 'Transporte privado: indica el vehículo y el conductor.');
    const start = d.start_date || date;
    if (start < date) G.fail('RN-FAC-11', `El traslado no empieza antes de la emisión (inicio ${F.date(start)}, emisión ${F.date(date)}).`);
    const lines = (d.lines || []).filter(l => l.variant_id && Number(l.qty) > 0);
    if (!lines.length) G.fail('RN-FAC-11', 'La guía necesita al menos una línea con producto y cantidad.');
    const weight = R(Number(d.gross_weight_kg) || U.sum(lines, l => Number(l.weight_kg) || 0), 3);
    if (!(weight > 0)) G.fail('RN-FAC-11', 'Indica el peso bruto total (kg).');
    const series = d.series || seriesFor('DISPATCH_GUIDE', null, { site: origin });
    assertSeries(series, 'DISPATCH_GUIDE', null, origin);
    const n = G.series.next(series);
    const oEst = D.get('establishments', origin) || {};
    const dEst = d.dest_establishment_id ? D.get('establishments', d.dest_establishment_id) : null;
    const rAddr = d.recipient_customer_id ? D.find('customer_addresses', a => a.customer_id === d.recipient_customer_id && a.is_default) : null;
    const emp = driverEmp ? D.get('employees', driverEmp) : null;
    const g = D.insert('dispatch_guides', {
      company_id: 'co-dg', establishment_id: origin, brand_id: d.brand_id || null, series_id: n.series_id, series: n.series, number: n.number, full_number: `${n.series}-${U.pad(n.number, 8)}`, issue_date: date, transfer_reason_code: code, transport_mode: mode, start_date: start,
      carrier_supplier_id: mode === '01' ? d.carrier_supplier_id : null, vehicle_id: mode === '02' ? d.vehicle_id : null, driver_employee_id: mode === '02' ? driverEmp : null, driver_license: mode === '02' ? (d.driver_license || (emp ? 'Q' + emp.doc_number : null)) : null,
      origin_ubigeo: d.origin_ubigeo || oEst.ubigeo, origin_address: d.origin_address || oEst.address, dest_ubigeo: d.dest_ubigeo || (dEst ? dEst.ubigeo : rAddr ? rAddr.ubigeo : '150101'), dest_address: d.dest_address || (dEst ? dEst.address : rAddr ? rAddr.address_line : '—'), dest_establishment_id: d.dest_establishment_id || null,
      recipient_customer_id: d.recipient_customer_id || null, gross_weight_kg: weight, packages: Math.max(1, Number(d.packages) || 1), order_id: d.order_id || null, transfer_id: d.transfer_id || null, transfer_ref: d.transfer_ref || null, sales_document_id: d.sales_document_id || null,
      sunat_status: 'PENDING', status: 'ISSUED', send_attempts: 0, issued_at: date === G.TODAY ? clock() : date + 'T08:00:00', issued_by: G.ctx.userName(), notes: d.notes || null,
    });
    for (const l of lines) { const v = G.variant(l.variant_id) || {}; D.insert('dispatch_guide_lines', { guide_id: g.id, variant_id: l.variant_id, description: l.description || v.name, qty: R(Number(l.qty), 3), uom_code: l.uom_code || (v.sale_mode === 'KG' ? 'KGM' : 'NIU'), weight_kg: l.weight_kg != null ? R(Number(l.weight_kg), 3) : null, lot_id: l.lot_id || null }, { silent: true }); }
    G.events.emit('guide.issued', { guide_id: g.id, full_number: g.full_number, reason: code, transfer_id: g.transfer_id, transfer_ref: g.transfer_ref, order_id: g.order_id });
    if (d.send !== false) sendGuide(g, { at: g.issued_at });
    return D.get('dispatch_guides', g.id);
  }
  function voidGuide(id, reason) {
    const g = D.get('dispatch_guides', id);
    if (!reason) G.fail('RN-FAC-10', 'Anular la guía exige motivo.');
    if (g.status === 'VOIDED') G.fail('RN-FAC-10', 'La guía ya está anulada.');
    return D.update('dispatch_guides', id, { status: 'VOIDED', sunat_status: 'VOIDED', void_reason: reason });
  }

  /* ---------- representación impresa (RN-FAC-16) ---------- */
  function words(n) {
    const U1 = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
    const D1 = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
    const C1 = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
    const lt = x => { if (!x) return ''; if (x === 100) return 'cien'; const c = Math.floor(x / 100), r = x % 100; let s = C1[c]; if (r) s += (s ? ' ' : '') + (r < 30 ? U1[r] : D1[Math.floor(r / 10)] + (r % 10 ? ' y ' + U1[r % 10] : '')); return s; };
    const ent = Math.floor(n + 1e-9), cent = Math.round((n - ent) * 100);
    const mill = Math.floor(ent / 1e6), miles = Math.floor((ent % 1e6) / 1000), rest = ent % 1000;
    let s = '';
    if (mill) s += (mill === 1 ? 'un millón' : lt(mill).replace(/uno$/, 'un') + ' millones') + ' ';
    if (miles) s += (miles === 1 ? 'mil' : lt(miles).replace(/uno$/, 'ún') + ' mil') + ' ';
    s += lt(rest);
    return `SON: ${(s.trim() || 'cero').toUpperCase()} CON ${U.pad(cent, 2)}/100 SOLES`;
  }
  function logo(brand, size = 44) {
    const s = G.ui.svg; const ini = (brand.code === 'DG' ? 'DG' : brand.name.replace(/^Marca \d · /, '').slice(0, 2)).toUpperCase();
    return s('svg', { viewBox: '0 0 44 44', width: size, height: size, role: 'img', 'aria-label': 'Logo de ' + brand.name },
      s('rect', { x: 1, y: 1, width: 42, height: 42, rx: 10, fill: brand.primary_color }),
      s('circle', { cx: 22, cy: 22, r: 15, fill: 'none', stroke: 'rgba(255,255,255,.55)', 'stroke-width': 1.2 }),
      s('text', { x: 22, y: 27, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: 'white', 'font-family': 'Georgia, serif' }, ini));
  }
  const paper = 'background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:18px;';
  function qrText(doc) { const c = company(); return [c.ruc, SUNAT_CODE[doc.doc_type], doc.series, doc.number, doc.igv, doc.total, doc.issue_date, ID_CODE[doc.customer_doc_type] || '0', doc.customer_doc_number || '-', doc.xml_hash || ''].join('|'); }
  function printNode(doc, fmt = 'A4', tplOverride) {
    const c = company(); const b = Object.assign({}, brandOf(doc.brand_id), tplOverride || {});
    const title = `${G.docTypeName(doc.doc_type).toUpperCase()} ELECTRÓNICA`;
    const ref = doc.related_document_id ? D.get('sales_documents', doc.related_document_id) : null;
    const legends = (b.print_legends || '').split('\n').filter(Boolean);
    if (fmt === '80') {
      const L = [];
      L.push(b.name.toUpperCase(), c.legal_name, 'RUC ' + c.ruc, c.fiscal_address, '-'.repeat(38), title, docNo(doc), 'Fecha: ' + F.date(doc.issue_date) + ' ' + String(doc.issued_at || '').slice(11, 16), `${ID_NAME[doc.customer_doc_type] || 'Doc.'}: ${doc.customer_doc_number || '-'}`, 'Cliente: ' + (doc.customer_name || '-'), '-'.repeat(38));
      for (const l of doc.lines) { L.push(l.description.slice(0, 38)); L.push(`  ${F.num(l.qty, l.uom_code === 'KGM' ? 3 : 0)} ${l.uom_code === 'KGM' ? 'kg' : 'u'} x ${F.num(l.unit_price, 2)}`.padEnd(26) + F.num(l.total, 2).padStart(12)); }
      L.push('-'.repeat(38), 'Op. gravada'.padEnd(26) + F.num(doc.subtotal, 2).padStart(12), `IGV ${F.num(G.tax.rate() * 100, 0)} %`.padEnd(26) + F.num(doc.igv, 2).padStart(12), 'TOTAL S/'.padEnd(26) + F.num(doc.total, 2).padStart(12), words(doc.total));
      if (ref) L.push(`Ref.: ${docNo(ref)} · ${catName(doc.doc_type === 'CREDIT_NOTE' ? CAT09 : CAT10, doc.note_reason_code)}`);
      L.push('Hash: ' + (doc.xml_hash || 'pendiente de envío'));
      return h('div', { class: 'stack', style: 'gap:8px;align-items:center' }, b.print_show_logo !== false ? logo(b, 40) : null, h('div', { class: 'ticket', style: 'max-width:340px;width:100%' }, L.join('\n')), U_qr(doc, 110), h('div', { class: 'small muted', style: 'max-width:320px;text-align:center' }, legends.concat([b.legal_footer || '']).join(' · ')));
    }
    const thS = 'text-align:left;padding:6px;border-bottom:2px solid ' + b.primary_color;
    return h('div', { style: paper + 'display:grid;gap:12px;font-size:13px;min-width:0' },
      h('div', { style: 'display:flex;gap:14px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap' },
        h('div', { style: 'display:flex;gap:12px;align-items:center;min-width:0' }, b.print_show_logo !== false ? logo(b, 54) : null, h('div', { style: 'min-width:0' }, h('div', { style: `font-weight:700;font-size:17px;color:${b.primary_color}` }, b.name), h('div', { style: 'font-weight:600' }, c.legal_name), h('div', { class: 'small muted' }, c.fiscal_address), h('div', { class: 'small muted' }, (D.get('establishments', doc.establishment_id) || {}).name || ''))),
        h('div', { style: `border:2px solid ${b.primary_color};border-radius:8px;padding:8px 14px;text-align:center;min-width:190px` }, h('div', { style: 'font-weight:700' }, 'RUC ' + c.ruc), h('div', { style: `font-weight:700;color:${b.primary_color}` }, title), h('div', { class: 'mono', style: 'font-weight:700' }, docNo(doc)))),
      h('div', { class: 'grid c2', style: 'gap:6px 18px' },
        dl([['Adquirente', doc.customer_name || '—'], [ID_NAME[doc.customer_doc_type] || 'Documento', doc.customer_doc_number || '—'], ['Dirección', doc.buyer_address || '—']]),
        dl([['Fecha de emisión', F.date(doc.issue_date)], ['Moneda', 'Soles (PEN)'], ['Forma de pago', doc.payment_terms === 'CREDIT' ? `Crédito · vence ${F.date(doc.due_date)}` : 'Contado'], ref ? ['Documento que modifica', `${docNo(ref)} · ${doc.note_reason_code} ${catName(doc.doc_type === 'CREDIT_NOTE' ? CAT09 : CAT10, doc.note_reason_code)}`] : null, doc.note_reason ? ['Sustento', doc.note_reason] : null])),
      h('div', { class: 'tbl-wrap' }, h('table', { style: 'width:100%;border-collapse:collapse;font-size:12.5px' },
        h('thead', null, h('tr', null, ['Cant.', 'Unid.', 'Descripción', 'P. unit.', 'Importe'].map((x, i) => h('th', { style: thS + (i === 0 || i >= 3 ? ';text-align:right' : '') }, x)))),
        h('tbody', null, doc.lines.map(l => h('tr', null, h('td', { style: 'padding:5px 6px;text-align:right' }, F.num(l.qty, l.uom_code === 'KGM' ? 3 : 0)), h('td', { style: 'padding:5px 6px' }, l.uom_code), h('td', { style: 'padding:5px 6px' }, l.description), h('td', { style: 'padding:5px 6px;text-align:right' }, F.num(l.unit_price, 2)), h('td', { style: 'padding:5px 6px;text-align:right' }, F.num(l.total, 2))))))),
      h('div', { style: 'display:flex;gap:16px;justify-content:space-between;flex-wrap:wrap;align-items:flex-end' },
        h('div', { style: 'display:flex;gap:12px;align-items:center;min-width:0;flex:1' }, U_qr(doc, 96), h('div', { class: 'small', style: 'min-width:0' }, h('div', { style: 'font-weight:600' }, words(doc.total)), h('div', { class: 'muted mono', style: 'overflow-wrap:anywhere' }, 'Hash: ' + (doc.xml_hash || 'pendiente de envío')), legends.map(x => h('div', { class: 'muted' }, x)))),
        dl([['Op. gravada', money(doc.subtotal)], [`IGV ${F.num(G.tax.rate() * 100, 0)} %`, money(doc.igv)], ['Importe total', h('b', null, money(doc.total))]])),
      h('div', { class: 'small muted', style: `border-top:1px solid var(--line);padding-top:8px` }, b.legal_footer || `Representación impresa del comprobante electrónico · RUC ${c.ruc}`));
  }
  const U_qr = (doc, size) => G.ui.qr(qrText(doc), size);
  function showPrint(doc, fmt = 'A4') {
    modal(`${docNo(doc)} · ${fmt === '80' ? 'ticket 80 mm' : 'A4'}`, body => { body.appendChild(printNode(doc, fmt)); }, [{ label: fmt === '80' ? 'Ver A4' : 'Ver ticket 80 mm', onClick: () => { showPrint(doc, fmt === '80' ? 'A4' : '80'); } }, { label: 'Imprimir', kind: 'primary', onClick: () => { G.print(); return false; } }], { wide: fmt !== '80' });
  }
  function xmlOf(doc) {
    const c = company();
    return `<?xml version="1.0" encoding="UTF-8"?>\n<${doc.doc_type === 'CREDIT_NOTE' ? 'CreditNote' : doc.doc_type === 'DEBIT_NOTE' ? 'DebitNote' : 'Invoice'} xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">\n  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>\n  <cbc:ID>${docNo(doc)}</cbc:ID>\n  <cbc:IssueDate>${doc.issue_date}</cbc:IssueDate>\n  <cbc:InvoiceTypeCode>${SUNAT_CODE[doc.doc_type]}</cbc:InvoiceTypeCode>\n  <cac:AccountingSupplierParty><cbc:ID schemeID="6">${c.ruc}</cbc:ID><cbc:RegistrationName>${c.legal_name}</cbc:RegistrationName></cac:AccountingSupplierParty>\n  <cac:AccountingCustomerParty><cbc:ID schemeID="${ID_CODE[doc.customer_doc_type] || '0'}">${doc.customer_doc_number || '-'}</cbc:ID><cbc:RegistrationName>${U.esc(doc.customer_name)}</cbc:RegistrationName></cac:AccountingCustomerParty>\n  <cac:TaxTotal><cbc:TaxAmount currencyID="PEN">${doc.igv.toFixed(2)}</cbc:TaxAmount></cac:TaxTotal>\n  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="PEN">${doc.subtotal.toFixed(2)}</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="PEN">${doc.total.toFixed(2)}</cbc:PayableAmount></cac:LegalMonetaryTotal>\n${doc.lines.map((l, i) => `  <cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="${l.uom_code}">${l.qty}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="PEN">${l.subtotal.toFixed(2)}</cbc:LineExtensionAmount><cac:Item><cbc:Description>${U.esc(l.description)}</cbc:Description></cac:Item></cac:InvoiceLine>`).join('\n')}\n  <ds:DigestValue>${doc.xml_hash || ''}</ds:DigestValue>\n</${doc.doc_type === 'CREDIT_NOTE' ? 'CreditNote' : doc.doc_type === 'DEBIT_NOTE' ? 'DebitNote' : 'Invoice'}>`;
  }
  function download(name, text, mime = 'text/plain') {
    try { const a = h('a', { href: URL.createObjectURL(new Blob([(mime === 'text/csv' ? '﻿' : '') + text], { type: mime + ';charset=utf-8' })), download: name }); document.body.appendChild(a); a.click(); a.remove(); toast(`Archivo ${name} generado`, 'ok'); }
    catch (e) { toast('No se pudo generar el archivo: ' + e.message, 'bad'); }
  }
  const csv = rows => rows.map(r => r.map(x => { const s = String(x ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\n');

  /* ---------- utilidades de interfaz ---------- */
  function stbl(cols, rows, empty = 'Sin registros.') {
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, cols.map(c => h('th', { class: c[2] || '' }, c[0])))),
      h('tbody', null, rows.length ? rows.map(r => h('tr', null, cols.map(c => { const v = c[1](r); return h('td', { class: c[2] || '' }, v instanceof Node ? v : (v === null || v === undefined || v === '' ? '—' : String(v))); }))) : h('tr', null, h('td', { attrs: { colspan: cols.length } }, G.ui.empty(empty))))));
  }
  const RANGES = [['today', 'Hoy'], ['7d', '7 días'], ['month', 'Este mes'], ['prev', 'Mes anterior'], ['all', 'Todo']];
  function inRange(date, key) {
    if (!date) return false; const d = String(date).slice(0, 10);
    if (key === 'today') return d === G.TODAY;
    if (key === '7d') return d > G.date.add(G.TODAY, -7) && d <= G.TODAY;
    if (key === 'month') return d >= G.date.month(G.TODAY) && d <= G.TODAY;
    if (key === 'prev') return d >= G.date.addMonths(G.TODAY, -1) && d < G.date.month(G.TODAY);
    return true;
  }
  const st = { range01: 'month', range09: 'month', month12: G.date.month(G.TODAY), brand11: 'br-DG', guideDraft: null };
  const brandOpts = () => G.scope.brands().filter(b => b.status === 'ACTIVE').map(b => [b.id, G.brandName(b.id)]);
  const siteOpts = () => G.scope.sites().map(e => [e.id, e.short || e.name]);
  const err = e => { toast(e.message, 'bad'); return e.message; };
  const run = (fn, ok) => { try { const r = fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); G.refresh(); return r; } catch (e) { err(e); return null; } };
  const linkTo = (label, fn) => h('a', { href: '#', on: { click: e => { e.preventDefault(); fn(); } } }, label);
  function custPicker(onPick, opts = {}) {
    const box = h('div', { class: 'stack', style: 'gap:6px' });
    const res = h('div', { class: 'stack', style: 'gap:4px' });
    const inp = h('input', { class: 'input', placeholder: opts.placeholder || 'Buscar cliente por nombre, RUC, DNI o celular…', attrs: { 'aria-label': 'Buscar cliente' } });
    const draw = () => {
      G.ui.clear(res); const q = inp.value.trim().toLowerCase(); if (q.length < 2 && !opts.showB2B) return;
      const rows = D.where('customers', c => c.status !== 'MERGED' && (q.length >= 2 ? [c.full_name, c.trade_name, c.doc_number, c.phone].some(x => x && String(x).toLowerCase().includes(q)) : ['RESTAURANT', 'BUSINESS', 'CONSIGNMENT_POINT'].includes(c.customer_type)) && (!opts.filter || opts.filter(c))).slice(0, 8);
      if (!rows.length) res.appendChild(h('div', { class: 'small muted' }, 'Sin coincidencias.'));
      for (const c of rows) res.appendChild(h('button', { class: 'btn ghost sm', style: 'justify-content:flex-start;text-align:left', type: 'button', on: { click: () => { inp.value = c.trade_name || c.full_name; G.ui.clear(res); onPick(c); } } }, `${c.trade_name || c.full_name} · ${ID_NAME[c.doc_type] || c.doc_type} ${c.doc_number || '—'}`));
    };
    inp.addEventListener('input', draw); box.append(inp, res); if (opts.showB2B) draw();
    return box;
  }

  /* ---------- ficha del comprobante (FAC-04 y drawers) ---------- */
  function docActions(doc, close) {
    const acts = [];
    acts.push(btn('A4', () => showPrint(doc, 'A4'), { sm: true }), btn('Ticket 80 mm', () => showPrint(doc, '80'), { sm: true }));
    acts.push(btn('XML', () => download(`${company().ruc}-${SUNAT_CODE[doc.doc_type]}-${docNo(doc)}.xml`, xmlOf(doc), 'application/xml'), { sm: true }));
    if (['ACCEPTED', 'OBSERVED', 'VOIDED'].includes(doc.sunat_status)) acts.push(btn('CDR', () => download(`R-${company().ruc}-${SUNAT_CODE[doc.doc_type]}-${docNo(doc)}.xml`, `<?xml version="1.0"?>\n<ApplicationResponse>\n  <cbc:ResponseCode>${doc.sunat_code || '0'}</cbc:ResponseCode>\n  <cbc:Description>${U.esc(doc.sunat_message || 'Aceptado')}</cbc:Description>\n  <cbc:ReferenceID>${docNo(doc)}</cbc:ReferenceID>\n  <cbc:ResponseDate>${String(doc.accepted_at || doc.sent_at || '').slice(0, 10)}</cbc:ResponseDate>\n  <ds:DigestValue>${doc.cdr_hash || ''}</ds:DigestValue>\n</ApplicationResponse>`, 'application/xml'), { sm: true }));
    if (doc.sunat_status === 'PENDING' && doc.status !== 'VOIDED') acts.push(btn('Reenviar al OSE', () => G.require('fac.document.resend', () => run(() => { if (doc.needs_review) D.update('sales_documents', doc.id, { needs_review: false }, { silent: true }); return send(doc, { manual: true }); }, r => `Intento ${r.attempt}: ${G.ui.statusLabel(r.result === 'TIMEOUT' || r.result === 'ERROR' ? 'RETRY' : r.result)} · ${r.message}`)), { sm: true, kind: 'primary' }));
    if (doc.sunat_status === 'REJECTED' && !doc.reissued_by) acts.push(btn('Reemitir con nuevo número', () => G.require('fac.document.issue', () => { const nd = run(() => reissue(doc.id), r => `Reemitido como ${docNo(r)}`); if (nd && close) { close(); openDoc(nd.id); } }), { sm: true, kind: 'primary' }));
    if (['INVOICE', 'RECEIPT'].includes(doc.doc_type) && valid(doc) && G.canDo('FAC', 'C')) { acts.push(btn('Nota de crédito', () => { if (close) close(); G.go('FAC-05', { id: doc.id }); }, { sm: true })); acts.push(btn('Nota de débito', () => { if (close) close(); G.go('FAC-06', { id: doc.id }); }, { sm: true })); }
    if (doc.status !== 'VOIDED' && doc.sunat_status !== 'REJECTED') acts.push(btn('Anular', () => G.require('fac.document.void', () => modal(`Anular ${docNo(doc)}`, body => body.appendChild(form({ id: 'void', fields: [{ key: 'reason', label: 'Motivo de la anulación', type: 'textarea', required: true, help: 'RN-FAC-10: un comprobante anulado no se reactiva. Si ya fue aceptado va por comunicación de baja (facturas) o resumen diario (boletas) en FAC-08.' }], submitLabel: 'Anular comprobante', onSubmit: v => { try { const s = voidDoc(doc.id, v.reason); G.ui.closeAll(); toast(s ? `Anulado; agregado a ${s.identifier} (FAC-08)` : 'Anulado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })))), { sm: true, kind: 'danger' }));
    return h('div', { class: 'row' }, acts);
  }
  function renderDoc(el, doc, close) {
    const ix = { payments: [] };
    for (const p of D.all('payments')) for (const a of p.allocations || []) if (a.document_id === doc.id) ix.payments.push({ p, a });
    const notes = D.where('sales_documents', n => n.related_document_id === doc.id);
    const ref = doc.related_document_id ? D.get('sales_documents', doc.related_document_id) : null;
    const o = doc.order_id ? D.get('sales_orders', doc.order_id) : null;
    const subs = D.where('einvoice_submissions', s => s.document_id === doc.id).sort(U.by('attempt_no'));
    const brand = brandOf(doc.brand_id);
    el.appendChild(docActions(doc, close));
    if (doc.sunat_status === 'REJECTED') el.appendChild(notice(h('div', null, h('b', null, `SUNAT rechazó el comprobante · código ${doc.sunat_code}`), h('div', null, doc.sunat_message), doc.reissued_by ? h('div', null, 'Reemitido como ', linkTo(docNo(D.get('sales_documents', doc.reissued_by)), () => openDoc(doc.reissued_by))) : h('div', { class: 'small' }, 'No tiene validez tributaria ni genera cuenta por cobrar (RN-CAJ-14): reemítelo con un número nuevo.')), 'bad'));
    if (doc.sunat_status === 'OBSERVED') el.appendChild(notice(h('div', null, h('b', null, `Aceptado con observación ${doc.sunat_code}`), h('div', null, doc.sunat_message), h('div', { class: 'small' }, 'Es válido; corrige el dato en los siguientes comprobantes.')), 'warn'));
    if (doc.sunat_status === 'PENDING' && doc.status !== 'VOIDED') el.appendChild(notice(doc.needs_review ? `Agotó ${maxAttempts()} intentos automáticos (RN-FAC-06): queda para revisión y reenvío manual.` : doc.summary_pending ? 'Se informa por resumen diario de boletas (FAC-08).' : doc.send_attempts ? `Último intento ${F.datetime(doc.last_attempt_at)}: ${doc.sunat_message || 'sin respuesta'}. Próximo reintento ${F.datetime(doc.next_retry_at)}.` : 'En cola de envío al OSE.', doc.needs_review ? 'bad' : 'warn'));
    if (doc.status === 'VOIDED') el.appendChild(notice(`Anulado el ${F.datetime(doc.voided_at)} por ${doc.voided_by || '—'}: ${doc.void_reason}. ${doc.sunat_status === 'VOIDED' ? 'Baja aceptada por SUNAT.' : 'Baja pendiente de envío (FAC-08).'}`, 'bad'));
    el.appendChild(h('div', { class: 'grid c2' },
      card('Comprobante', dl([['Tipo', typeBadge(doc.doc_type)], ['Número', h('span', { class: 'mono' }, docNo(doc))], ['Estado SUNAT', sunatBadge(doc)], ['Fecha de emisión', F.date(doc.issue_date)], ['Emitido', F.datetime(doc.issued_at)], ['Aceptado', F.datetime(doc.accepted_at)], ['Marca', h('span', { class: 'row', style: 'gap:6px' }, logo(brand, 20), brand.name)], ['Local', G.siteName(doc.establishment_id)], ['Vendedora', G.userName(doc.seller_id)], ['Condición de pago', doc.payment_terms === 'CREDIT' ? `Crédito · vence ${F.date(doc.due_date)}` : 'Contado'],
        o ? ['Pedido', h('span', null, o.number, ' · ', status(o.status))] : null, ref ? ['Modifica a', linkTo(docNo(ref), () => openDoc(ref.id))] : null, doc.note_reason_code ? ['Motivo SUNAT', `${doc.note_reason_code} · ${catName(doc.doc_type === 'CREDIT_NOTE' ? CAT09 : CAT10, doc.note_reason_code)}`] : null, doc.note_reason ? ['Sustento', doc.note_reason] : null, doc.restocked_wh ? ['Reingreso de stock', G.whName(doc.restocked_wh)] : null])),
      card('Adquirente (congelado al emitir)', dl([['Documento', `${ID_NAME[doc.customer_doc_type] || doc.customer_doc_type || '—'} ${doc.customer_doc_number || ''}`], ['Nombre o razón social', doc.customer_name], ['Dirección', doc.buyer_address || '—'], ['Ficha actual del cliente', G.custName(doc.customer_id)], ['Hash del XML', h('span', { class: 'mono small', style: 'overflow-wrap:anywhere' }, doc.xml_hash || '—')], ['Respuesta', doc.sunat_code ? `${doc.sunat_code} · ${doc.sunat_message}` : '—']]))));
    el.appendChild(card('Líneas', h('div', null, stbl([['Descripción', l => l.description], ['Cant.', l => F.num(l.qty, l.uom_code === 'KGM' ? 3 : 0) + ' ' + l.uom_code, 'r'], ['P. unit.', l => F.num(l.unit_price, 2), 'r'], ['Valor venta', l => money(l.subtotal), 'r'], ['IGV', l => money(l.igv), 'r'], ['Total', l => money(l.total), 'r']], doc.lines),
      h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:8px' }, dl([['Valor de venta', money(doc.subtotal)], [`IGV ${F.num(G.tax.rate() * 100, 0)} %`, money(doc.igv)], ['Total', h('b', null, money(doc.total))], notes.length ? ['Notas de crédito', money(credited(doc.id))] : null]))), { flush: false }));
    if (notes.length) el.appendChild(card('Notas relacionadas', stbl([['Número', n => linkTo(docNo(n), () => openDoc(n.id))], ['Tipo', n => typeBadge(n.doc_type)], ['Motivo', n => `${n.note_reason_code} · ${n.note_reason || ''}`], ['Total', n => money(n.total), 'r'], ['SUNAT', n => sunatBadge(n)]], notes)));
    el.appendChild(card('Cobros aplicados', stbl([['Cobro', x => x.p.number], ['Fecha', x => F.datetime(x.p.paid_at)], ['Medio', x => G.pmName(x.p.payment_method_id)], ['Operación', x => x.p.reference], ['Aplicado', x => money(x.a.amount), 'r'], ['Estado', x => status(x.p.status)]], ix.payments, 'Sin cobros aplicados.')));
    el.appendChild(card('Intentos de envío al OSE (RN-FAC-06)', stbl([['N.º', s => s.attempt_no], ['Fecha', s => F.datetime(s.requested_at)], ['Proveedor', s => s.provider], ['Resultado', s => status(s.result === 'TIMEOUT' || s.result === 'ERROR' ? 'FAILED' : s.result)], ['Código', s => s.response_code], ['Mensaje', s => s.message], ['ms', s => F.num(s.duration_ms), 'r']], subs, 'Aún no se envía.')));
  }
  function openDoc(id) { const doc = D.get('sales_documents', id); if (!doc) return; drawer(`${G.docTypeName(doc.doc_type)} ${docNo(doc)}`, (b, close) => { b.appendChild(h('div', { class: 'row' }, btn('Abrir en pantalla completa', () => { close(); G.go('FAC-04', { id }); }, { sm: true, kind: 'ghost' }))); renderDoc(b, doc, close); }, { wide: true, code: 'FAC-04', noFocus: true }); }
  function docPicker(body, target, pred, title) {
    const rows = G.scope.filter(D.where('sales_documents', d => pred(d) && d.issue_date >= G.date.add(G.TODAY, -45))).sort(U.by('issue_date', -1));
    body.appendChild(notice(title, 'info'));
    body.appendChild(table({ id: 'pick:' + target, columns: [{ key: 'issue_date', label: 'Fecha', render: d => F.date(d.issue_date) }, { key: 'full_number', label: 'Número', mono: true }, { key: 'doc_type', label: 'Tipo', render: d => typeBadge(d.doc_type), value: d => TYPE_SHORT[d.doc_type] }, { key: 'customer_name', label: 'Cliente' }, { key: 'total', label: 'Total', align: 'r', render: d => money(d.total) }, { key: 'sunat_status', label: 'SUNAT', render: d => sunatBadge(d) }], rows, pageSize: 12, onRow: d => G.go(target, { id: d.id }), sort: 'issue_date', dir: -1 }));
  }

  /* =====================================================================
     Pantallas
     ===================================================================== */
  function fac01(el) {
    const body = page(el, { code: 'FAC-01', title: 'Comprobantes', sub: 'Facturas, boletas y notas de las 5 marcas con el RUC de la empresa; estado SUNAT, reenvío y descarga de XML, CDR y PDF.', actions: [G.canDo('FAC', 'C') ? { label: 'Emitir desde pedido', kind: 'primary', onClick: () => G.go('FAC-02') } : null, G.canDo('FAC', 'C') ? { label: 'Emisión directa', onClick: () => G.go('FAC-03') } : null].filter(Boolean) });
    body.appendChild(pills(RANGES, st.range01, v => { st.range01 = v; G.refresh(); }));
    const rows = G.scope.filter(D.where('sales_documents', d => inRange(d.issue_date, st.range01)));
    const sales = rows.filter(d => ['INVOICE', 'RECEIPT'].includes(d.doc_type) && valid(d));
    const ncs = rows.filter(d => d.doc_type === 'CREDIT_NOTE' && valid(d));
    const nds = rows.filter(d => d.doc_type === 'DEBIT_NOTE' && valid(d));
    const net = R(U.sum(sales, d => d.total) - U.sum(ncs, d => d.total) + U.sum(nds, d => d.total));
    body.appendChild(kpis([
      { label: 'Comprobantes', value: F.num(rows.length), sub: `${F.num(rows.filter(d => d.doc_type === 'INVOICE').length)} facturas · ${F.num(rows.filter(d => d.doc_type === 'RECEIPT').length)} boletas` },
      { label: 'Venta neta (con IGV)', value: money(net), sub: `IGV ${money(R(U.sum(sales, d => d.igv) - U.sum(ncs, d => d.igv) + U.sum(nds, d => d.igv)))}` },
      { label: 'Pendientes de envío', value: F.num(rows.filter(d => d.sunat_status === 'PENDING' && d.status !== 'VOIDED').length), tone: rows.some(d => d.sunat_status === 'PENDING' && d.needs_review) ? 'bad' : 'warn', onClick: () => G.go('FAC-07') },
      { label: 'Observados / rechazados', value: `${rows.filter(d => d.sunat_status === 'OBSERVED').length} / ${rows.filter(d => d.sunat_status === 'REJECTED').length}`, tone: rows.some(d => d.sunat_status === 'REJECTED' && !d.reissued_by) ? 'bad' : '' },
    ]));
    const series = [...new Set(rows.map(d => d.series))].sort().map(s => [s, s]);
    body.appendChild(table({
      id: 'fac01', rows, sort: 'issue_date', dir: -1, pageSize: 20, searchPlaceholder: 'Número, cliente, RUC o DNI…', searchText: d => (d.customer_doc_number || '') + ' ' + (d.customer_name || ''),
      columns: [{ key: 'issue_date', label: 'Fecha', render: d => F.date(d.issue_date) }, { key: 'full_number', label: 'Número', mono: true }, { key: 'doc_type', label: 'Tipo', render: d => typeBadge(d.doc_type), value: d => TYPE_SHORT[d.doc_type] }, { key: 'brand_id', label: 'Marca', value: d => G.brandName(d.brand_id) }, { key: 'establishment_id', label: 'Local', value: d => G.siteName(d.establishment_id) }, { key: 'customer_name', label: 'Cliente' }, { key: 'total', label: 'Total', align: 'r', render: d => money(d.doc_type === 'CREDIT_NOTE' ? -d.total : d.total) }, { key: 'sunat_status', label: 'SUNAT', render: d => sunatBadge(d), value: d => G.ui.statusLabel(d.sunat_status) }],
      filters: [{ key: 'doc_type', label: 'Tipo', options: Object.entries(TYPE_SHORT).slice(0, 4) }, { key: 'series', label: 'Serie', options: series }, { key: 'brand_id', label: 'Marca', options: brandOpts() }, { key: 'establishment_id', label: 'Local', options: siteOpts() }, { key: 'sunat_status', label: 'SUNAT', options: ['PENDING', 'ACCEPTED', 'OBSERVED', 'REJECTED', 'VOIDED'].map(s => [s, G.ui.statusLabel(s)]) }],
      onRow: d => openDoc(d.id),
      actions: d => [d.sunat_status === 'PENDING' && d.status !== 'VOIDED' && G.can('fac.document.resend') ? btn('Reenviar', () => run(() => send(d, { manual: true }), r => `${docNo(d)}: ${r.message}`), { sm: true }) : null, btn('PDF', () => showPrint(d, 'A4'), { sm: true, kind: 'ghost' })].filter(Boolean),
      footer: ['', '', '', '', '', 'Venta neta', { v: money(net), align: 'r' }, ''],
    }));
  }

  function pendingOrders() {
    const ix = index();
    return G.scope.filter(D.where('sales_orders', o => ['DELIVERED', 'CLOSED', 'READY'].includes(o.status) && o.requested_doc_type !== 'NONE' && !(ix.byOrder.get(o.id) || []).some(valid) && (o.status !== 'READY' || !(o.lines || []).some(l => l.price_basis === 'KG' && l.weighed_kg == null))));
  }
  function fac02(el) {
    const body = page(el, { code: 'FAC-02', title: 'Emitir desde el pedido', sub: 'Pedidos listos o entregados con peso real y sin comprobante: el sistema sugiere factura o boleta, toma la serie de la marca y emite (RN-FAC-14).' });
    const rows = pendingOrders();
    const late = rows.filter(o => ['DELIVERED', 'CLOSED'].includes(o.status) && o.delivered_at && T.diffMin(G.date.now(), o.delivered_at) > 1440);
    const k = G.kpi('KPI-FAC-05');
    body.appendChild(kpis([{ label: 'Pedidos por facturar', value: F.num(rows.length), sub: `${rows.filter(o => o.status === 'READY').length} listos · ${rows.filter(o => o.status !== 'READY').length} entregados` }, { label: 'Entregados hace más de 24 h', value: F.num(late.length), tone: late.length ? 'bad' : 'ok', sub: 'KPI-FAC-05 · meta 0' }, { label: 'Importe por facturar', value: money(U.sum(rows, o => o.final_total ?? o.estimated_total)) }, { label: 'KPI-FAC-05 del mes', value: k ? F.pct(k.value) : '—', sub: k ? `${k.numerator} de ${k.denominator} entregados` : '' }]));
    if (!G.can('fac.document.issue')) body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso fac.document.issue: puedes ver la lista pero no emitir.`, 'warn'));
    body.appendChild(table({
      id: 'fac02', rows, sort: 'delivered_at', dir: 1, empty: 'Todos los pedidos listos o entregados tienen su comprobante.',
      columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'status', label: 'Estado', render: o => status(o.status) }, { key: 'delivered_at', label: 'Entregado', render: o => o.delivered_at ? F.datetime(o.delivered_at) : '—' }, { key: 'brand_id', label: 'Marca', value: o => G.brandName(o.brand_id) }, { key: 'customer_id', label: 'Cliente', value: o => G.custName(o.billing_customer_id || o.customer_id) }, { key: 'sug', label: 'Sugerido', value: o => G.docs.typeFor(D.get('customers', o.billing_customer_id || o.customer_id), o.requested_doc_type) === 'INVOICE' ? 'Factura' : 'Boleta' }, { key: 'series', label: 'Serie', mono: true, value: o => seriesFor(G.docs.typeFor(D.get('customers', o.billing_customer_id || o.customer_id), o.requested_doc_type), o.brand_id, { counter: o.channel === 'COUNTER', site: o.establishment_id }) }, { key: 'final_total', label: 'Total final', align: 'r', render: o => money(o.final_total ?? o.estimated_total) }],
      filters: [{ key: 'brand_id', label: 'Marca', options: brandOpts() }, { key: 'status', label: 'Estado', options: [['READY', 'Listo'], ['DELIVERED', 'Entregado'], ['CLOSED', 'Cerrado']] }],
      onRow: o => emitDrawer(o),
      actions: o => [btn('Emitir', () => emitDrawer(o), { sm: true, kind: 'primary', disabled: !G.can('fac.document.issue') })],
    }));
  }
  function emitDrawer(o) {
    drawer(`Emitir comprobante · ${o.number}`, (b, close) => {
      const cust = D.get('customers', o.billing_customer_id || o.customer_id) || {};
      const sug = G.docs.typeFor(cust, o.requested_doc_type);
      let type = sug;
      const panel = h('div', { class: 'stack' });
      const draw = () => {
        G.ui.clear(panel);
        const lines = linesFromOrder(o);
        const split = lines.map(l => Object.assign({}, l, G.tax.split(l.total, true, l.igv_affectation)));
        const tot = { base: R(U.sum(split, l => l.base)), igv: R(U.sum(split, l => l.igv)), total: R(U.sum(split, l => l.total)) };
        const ser = seriesFor(type, o.brand_id, { counter: o.channel === 'COUNTER', site: o.establishment_id });
        const lim = Number(G.param('fac_receipt_id_required_above') ?? 700);
        const pend = o.lines.filter(l => l.price_basis === 'KG' && l.weighed_kg == null);
        panel.appendChild(h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Tipo:'), pills([['INVOICE', 'Factura'], ['RECEIPT', 'Boleta']], type, v => { type = v; draw(); }), h('span', { class: 'muted small' }, `Sugerido: ${sug === 'INVOICE' ? 'factura (cliente con RUC válido)' : 'boleta'} · pidió ${G.docTypeName(o.requested_doc_type).toLowerCase()}`)));
        if (type === 'INVOICE' && !(cust.doc_type === 'RUC' && U.rucOk(cust.doc_number))) panel.appendChild(notice(`RN-FAC-04: ${cust.full_name || 'el cliente'} no tiene RUC válido (${cust.doc_number || 'sin documento'}). Emite boleta o corrige el RUC en CLI.`, 'bad'));
        if (type === 'RECEIPT' && tot.total > lim && !cust.doc_number) panel.appendChild(notice(`RN-FAC-05: la boleta supera ${money(lim)} y el cliente no tiene documento.`, 'bad'));
        if (pend.length) panel.appendChild(notice(`RN-FAC-14: faltan pesar ${pend.length} línea(s).`, 'bad'));
        panel.appendChild(h('div', { class: 'grid c2' }, dl([['Serie', h('b', { class: 'mono' }, ser || '—')], ['Marca', G.brandFull(o.brand_id)], ['Local', G.siteName(o.establishment_id)], ['Condición', o.payment_method_id === 'pm-CREDIT' ? `Crédito ${cust.credit_days || 15} días (RN-FAC-13)` : 'Contado']]), dl([['Adquirente', cust.full_name], [ID_NAME[cust.doc_type] || 'Documento', cust.doc_number || '—'], ['Pedido', `${o.number} · ${G.ui.statusLabel(o.status)}`], ['Pagado', money(o.paid_amount || 0)]])));
        panel.appendChild(stbl([['Descripción', l => l.description], ['Cant.', l => F.num(l.qty, l.uom_code === 'KGM' ? 3 : 0) + ' ' + l.uom_code, 'r'], ['P. unit.', l => F.num(l.unit_price, 2), 'r'], ['Valor venta', l => money(l.base), 'r'], ['IGV', l => money(l.igv), 'r'], ['Total', l => money(l.total), 'r']], split));
        panel.appendChild(h('div', { class: 'row', style: 'justify-content:flex-end' }, dl([['Valor de venta', money(tot.base)], ['IGV', money(tot.igv)], ['Total', h('b', null, money(tot.total))]])));
        panel.appendChild(h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Cancelar', close), btn(`Emitir ${type === 'INVOICE' ? 'factura' : 'boleta'} ${ser || ''}`, () => G.require('fac.document.issue', () => { try { const d = issueFromOrder(o.id, { doc_type: type }); close(); toast(`${docNo(d)} emitido · ${G.ui.statusLabel(D.get('sales_documents', d.id).sunat_status)}`, 'ok'); G.refresh(); showPrint(D.get('sales_documents', d.id), o.channel === 'COUNTER' ? '80' : 'A4'); } catch (e) { err(e); } }), { kind: 'primary' })));
      };
      draw(); b.appendChild(panel);
    }, { wide: true, code: 'FAC-02' });
  }

  function fac03(el) {
    const body = page(el, { code: 'FAC-03', title: 'Emisión directa', sub: 'Comprobante sin pedido (servicio, ajuste o venta suelta) con productos del catálogo de la marca o líneas de servicio; calcula IGV en vivo.' });
    if (!G.can('fac.document.issue')) { body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso fac.document.issue.`, 'warn')); }
    const s = st.direct = st.direct || { type: 'RECEIPT', brand: G.ctx.brand !== 'ALL' ? G.ctx.brand : 'br-DG', site: G.ctx.site !== 'ALL' ? G.ctx.site : 'es-L1', cust: null, buyer: { doc_type: 'DNI', doc_number: '', name: '' }, lines: [], terms: 'CASH', days: 15, date: G.TODAY };
    const wrap = h('div', { class: 'grid side-r' }); body.appendChild(wrap);
    const left = h('div', { class: 'stack' }), right = h('div', { class: 'stack' }); wrap.append(left, right);
    const draw = () => {
      G.ui.clear(left); G.ui.clear(right);
      const vars = D.where('product_variants', v => v.sellable && v.status === 'ACTIVE' && v.brand_id === s.brand);
      const head = h('div', { class: 'stack' },
        h('div', { class: 'row' }, pills([['INVOICE', 'Factura'], ['RECEIPT', 'Boleta']], s.type, v => { s.type = v; draw(); }), h('select', { class: 'input', style: 'width:auto', attrs: { 'aria-label': 'Marca' }, on: { change: e => { s.brand = e.target.value; s.lines = []; draw(); } } }, brandOpts().map(([v, l]) => h('option', { value: v, selected: v === s.brand }, l))), h('select', { class: 'input', style: 'width:auto', attrs: { 'aria-label': 'Local' }, on: { change: e => { s.site = e.target.value; draw(); } } }, siteOpts().map(([v, l]) => h('option', { value: v, selected: v === s.site }, l))), h('input', { class: 'input', type: 'date', value: s.date, style: 'width:auto', attrs: { 'aria-label': 'Fecha de emisión' }, on: { change: e => { s.date = e.target.value; draw(); } } })),
        h('div', { class: 'small muted' }, `Serie: `, h('b', { class: 'mono' }, seriesFor(s.type, s.brand, { site: s.site }) || '—'), ` · ${G.period.isClosed(s.date) ? 'período cerrado (RN-FAC-17)' : 'período abierto'}`));
      left.appendChild(card('Datos del comprobante', head));
      const cbox = h('div', { class: 'stack' });
      if (s.cust) { const c = D.get('customers', s.cust); cbox.appendChild(h('div', { class: 'row between' }, h('div', null, h('b', null, c.trade_name || c.full_name), h('div', { class: 'small muted' }, `${ID_NAME[c.doc_type] || c.doc_type} ${c.doc_number || '—'}${c.doc_type === 'RUC' ? (U.rucOk(c.doc_number) ? ' · RUC válido' : ' · RUC inválido') : ''}`)), btn('Cambiar', () => { s.cust = null; draw(); }, { sm: true, kind: 'ghost' }))); }
      else {
        cbox.appendChild(custPicker(c => { s.cust = c.id; s.terms = c.customer_type === 'PERSON' ? 'CASH' : s.terms; draw(); }, { showB2B: s.type === 'INVOICE' }));
        if (s.type === 'RECEIPT') cbox.appendChild(h('div', { class: 'grid c3', style: 'gap:8px' }, h('select', { class: 'input', attrs: { 'aria-label': 'Tipo de documento' }, on: { change: e => { s.buyer.doc_type = e.target.value; } } }, [['DNI', 'DNI'], ['CE', 'Carné de extranjería'], ['NONE', 'Sin documento']].map(([v, l]) => h('option', { value: v, selected: s.buyer.doc_type === v }, l))), h('input', { class: 'input', placeholder: 'N.º de documento', value: s.buyer.doc_number, attrs: { 'aria-label': 'Número de documento' }, on: { input: e => { s.buyer.doc_number = e.target.value.trim(); } } }), h('input', { class: 'input', placeholder: 'Nombre (boleta sin cliente registrado)', value: s.buyer.name, attrs: { 'aria-label': 'Nombre del adquirente' }, on: { input: e => { s.buyer.name = e.target.value; } } })));
      }
      left.appendChild(card('Adquirente', cbox));
      // líneas
      const lt = h('div', { class: 'stack', style: 'gap:8px' });
      s.lines.forEach((l, i) => {
        const v = l.variant_id ? G.variant(l.variant_id) : null;
        l.total = R((Number(l.qty) || 0) * (Number(l.unit_price) || 0));
        lt.appendChild(h('div', { style: 'display:grid;grid-template-columns:minmax(0,3fr) minmax(70px,1fr) minmax(80px,1fr) minmax(80px,1fr) auto;gap:6px;align-items:center' },
          v ? h('div', { class: 'small', style: 'min-width:0' }, v.name, h('div', { class: 'muted' }, v.sale_mode === 'UNIT' ? 'por unidad' : 'por kg (peso real)')) : h('input', { class: 'input', value: l.description, placeholder: 'Descripción del servicio', attrs: { 'aria-label': 'Descripción' }, on: { input: e => { l.description = e.target.value; } } }),
          h('input', { class: 'input', type: 'number', step: 'any', value: l.qty, attrs: { 'aria-label': 'Cantidad' }, on: { change: e => { l.qty = Number(e.target.value); draw(); } } }),
          h('input', { class: 'input', type: 'number', step: '0.01', value: l.unit_price, attrs: { 'aria-label': 'Precio unitario con IGV' }, on: { change: e => { l.unit_price = Number(e.target.value); draw(); } } }),
          h('div', { class: 'num small', style: 'text-align:right' }, money(l.total)),
          btn('Quitar', () => { s.lines.splice(i, 1); draw(); }, { sm: true, kind: 'ghost' })));
      });
      const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Producto' } }, h('option', { value: '' }, 'Agregar producto del catálogo…'), vars.map(v => h('option', { value: v.id }, `${v.sku} · ${v.name}`)));
      sel.addEventListener('change', () => { const v = G.variant(sel.value); if (!v) return; const pr = G.price.of(v.id, { brand_id: s.brand, channel: s.type === 'INVOICE' ? 'B2B' : 'COUNTER', customer_id: s.cust }) || { price: 0 }; s.lines.push({ variant_id: v.id, description: v.name, qty: v.sale_mode === 'UNIT' ? 1 : 1, uom_code: v.sale_mode === 'UNIT' ? 'NIU' : 'KGM', unit_price: pr.price, igv_affectation: (G.productOf(v.id) || {}).igv_affectation || '10', unit_cost: v.std_cost }); draw(); });
      lt.appendChild(h('div', { class: 'row' }, h('div', { style: 'flex:1;min-width:200px' }, sel), btn('Línea de servicio', () => { s.lines.push({ variant_id: null, description: 'Servicio de corte y empaque al vacío', qty: 1, uom_code: 'ZZ', unit_price: 10, igv_affectation: '10' }); draw(); }, { sm: true })));
      left.appendChild(card('Líneas (precios con IGV)', lt));
      // resumen
      const ls = s.lines.map(l => Object.assign({}, l, G.tax.split(R((Number(l.qty) || 0) * (Number(l.unit_price) || 0)), true, l.igv_affectation || '10')));
      const tot = { base: R(U.sum(ls, l => l.base)), igv: R(U.sum(ls, l => l.igv)), total: R(U.sum(ls, l => l.total)) };
      const termSel = h('div', { class: 'stack', style: 'gap:6px' }, pills([['CASH', 'Contado'], ['CREDIT', 'Crédito']], s.terms, v => { s.terms = v; draw(); }), s.terms === 'CREDIT' ? h('label', { class: 'small' }, 'Días de crédito (RN-FAC-13) ', h('input', { class: 'input', type: 'number', min: 1, value: s.days, style: 'width:90px', attrs: { 'aria-label': 'Días de crédito' }, on: { change: e => { s.days = Number(e.target.value); draw(); } } }), ` · vence ${F.date(G.date.add(s.date, s.days || 0))}`) : null);
      right.appendChild(card('Resumen', h('div', { class: 'stack' }, dl([['Valor de venta', money(tot.base)], [`IGV ${F.num(G.tax.rate() * 100, 0)} %`, money(tot.igv)], ['Total', h('b', null, money(tot.total))]]), termSel,
        btn(`Emitir ${s.type === 'INVOICE' ? 'factura' : 'boleta'}`, () => G.require('fac.document.issue', () => {
          try {
            const buyer = s.cust ? null : (s.buyer.doc_number || s.buyer.name ? { doc_type: s.buyer.doc_number ? s.buyer.doc_type : 'NONE', doc_number: s.buyer.doc_number || null, name: s.buyer.name || 'Clientes varios' } : null);
            if (buyer && buyer.doc_type === 'DNI' && buyer.doc_number && !U.dniOk(buyer.doc_number)) G.fail('RN-FAC-05', 'El DNI tiene 8 dígitos.');
            const d = issue({ doc_type: s.type, brand_id: s.brand, establishment_id: s.site, customer_id: s.cust || 'cu-VARIOS', buyer, lines: s.lines.map(l => ({ variant_id: l.variant_id, description: l.description, qty: Number(l.qty), uom_code: l.uom_code, unit_price: Number(l.unit_price), igv_affectation: l.igv_affectation || '10', total: R(Number(l.qty) * Number(l.unit_price)), unit_cost: l.unit_cost || 0, cost: R(Number(l.qty) * (l.unit_cost || 0)) })), date: s.date, payment_terms: s.terms, credit_days: s.days });
            st.direct = null; toast(`${docNo(d)} emitido · ${G.ui.statusLabel(D.get('sales_documents', d.id).sunat_status)}`, 'ok'); G.refresh(); openDoc(d.id);
          } catch (e) { err(e); }
        }), { kind: 'primary', disabled: !s.lines.length }))));
      right.appendChild(notice(h('div', { class: 'small' }, `RN-FAC-04: factura solo con RUC válido. RN-FAC-05: boleta mayor a ${money(G.param('fac_receipt_id_required_above') ?? 700)} identifica al adquirente. D-FAC-05: la afectación sale de cada producto (catálogo 07).`), 'info'));
    };
    draw();
  }

  function fac04(el, params) {
    const doc = params && params.id ? D.get('sales_documents', params.id) : null;
    const body = page(el, { code: 'FAC-04', title: doc ? `${G.docTypeName(doc.doc_type)} ${docNo(doc)}` : 'Detalle del comprobante', sub: 'Cabecera, líneas, IGV, adquirente congelado, pedido, cobros aplicados e intentos de envío con sus respuestas.', actions: [{ label: 'Volver a comprobantes', onClick: () => G.go('FAC-01') }] });
    if (!doc) { docPicker(body, 'FAC-04', () => true, 'Elige un comprobante de los últimos 45 días (o búscalo arriba por número).'); return; }
    renderDoc(body, doc);
  }

  function noteScreen(el, params, kind) {
    const code = kind === 'CREDIT_NOTE' ? 'FAC-05' : 'FAC-06';
    const cat = kind === 'CREDIT_NOTE' ? CAT09 : CAT10;
    const ref = params && params.id ? D.get('sales_documents', params.id) : null;
    const body = page(el, { code, title: kind === 'CREDIT_NOTE' ? 'Nota de crédito' : 'Nota de débito', sub: kind === 'CREDIT_NOTE' ? 'Contra una factura o boleta: motivo del catálogo 09 (anulación, devolución, diferencia de peso, descuento), líneas e importe; reingresa stock si es devolución.' : 'Contra una factura o boleta: motivo del catálogo 10 (intereses, aumento de valor, penalidades).' });
    if (!G.can('fac.credit_note.issue')) body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso fac.credit_note.issue: puedes revisar, no emitir.`, 'warn'));
    if (!ref) { docPicker(body, code, d => ['INVOICE', 'RECEIPT'].includes(d.doc_type) && valid(d), 'Elige la factura o boleta que vas a modificar.'); return; }
    const used = credited(ref.id), avail = R(ref.total - used);
    const s = st['n' + code] && st['n' + code].ref === ref.id ? st['n' + code] : (st['n' + code] = { ref: ref.id, reason: kind === 'CREDIT_NOTE' ? '07' : '02', text: '', mode: kind === 'CREDIT_NOTE' ? 'LINES' : 'AMOUNT', amount: kind === 'CREDIT_NOTE' ? 0 : 10, sel: {}, kg: {}, restock: true, wh: 'wh-DEV-L1' });
    body.appendChild(h('div', { class: 'grid c2' }, card('Comprobante que se modifica', dl([['Número', linkTo(docNo(ref), () => openDoc(ref.id))], ['Cliente', `${ref.customer_name} · ${ID_NAME[ref.customer_doc_type] || ''} ${ref.customer_doc_number || ''}`], ['Fecha', F.date(ref.issue_date)], ['Total', money(ref.total)], ['Estado SUNAT', sunatBadge(ref)], kind === 'CREDIT_NOTE' ? ['Notas previas', money(used)] : null, kind === 'CREDIT_NOTE' ? ['Disponible (RN-FAC-08)', h('b', null, money(avail))] : null, ['Serie de la nota', h('b', { class: 'mono' }, seriesFor(kind, ref.brand_id, { appliesTo: ref.doc_type }) || '—')]])),
      card('Motivo SUNAT', h('div', { class: 'stack' }, h('select', { class: 'input', attrs: { 'aria-label': 'Motivo' }, on: { change: e => { s.reason = e.target.value; if (['01', '02', '06'].includes(s.reason)) s.mode = 'ALL'; else if (s.reason === '09') s.mode = 'WEIGHT'; else if (['04', '10', '13'].includes(s.reason) || kind === 'DEBIT_NOTE') s.mode = 'AMOUNT'; else s.mode = 'LINES'; G.refresh(); } } }, cat.map(([c, n]) => h('option', { value: c, selected: c === s.reason }, `${c} · ${n}`))),
        h('textarea', { class: 'input', placeholder: 'Sustento (obligatorio para SUNAT)', attrs: { 'aria-label': 'Sustento' }, on: { input: e => { s.text = e.target.value; } } }, s.text),
        kind === 'CREDIT_NOTE' && s.reason === '09' ? h('div', { class: 'small muted' }, `RN-FAC-15: el reclamo de peso se resuelve con el motivo ${U.pad(String(G.param('fac_weight_credit_note_reason') ?? '09'), 2)} (fac_weight_credit_note_reason), sin editar el comprobante.`) : null))));
    const calc = () => {
      if (s.mode === 'ALL') return ref.lines.map(l => Object.assign({}, l, { total: l.total }));
      if (s.mode === 'AMOUNT') return s.amount > 0 ? [{ variant_id: null, description: `${catName(cat, s.reason)} · ref. ${docNo(ref)}`, qty: 1, uom_code: 'ZZ', unit_price: Number(s.amount), igv_affectation: '10', total: Number(s.amount) }] : [];
      if (s.mode === 'WEIGHT') return ref.lines.map((l, i) => s.kg[i] != null && s.kg[i] !== '' && Number(s.kg[i]) < l.qty ? { variant_id: null, description: `Diferencia de peso ${F.num(l.qty - s.kg[i], 3)} kg · ${l.description.split(' · ')[0]}`, qty: R(l.qty - s.kg[i], 3), uom_code: 'KGM', unit_price: l.unit_price, igv_affectation: l.igv_affectation || '10', total: R((l.qty - s.kg[i]) * l.unit_price) } : null).filter(Boolean);
      return ref.lines.map((l, i) => { const q = s.sel[i]; if (!(q > 0)) return null; const qty = Math.min(q, l.qty); return { variant_id: l.variant_id, description: l.description.split(' · ')[0], qty, units: l.units && l.qty ? Math.round(l.units * qty / l.qty) || 1 : undefined, uom_code: l.uom_code, unit_price: l.unit_price, igv_affectation: l.igv_affectation || '10', total: R(qty * l.unit_price), lot_id: l.lot_id, unit_cost: l.unit_cost }; }).filter(Boolean);
    };
    const lines = calc(); const tot = R(U.sum(lines, l => l.total)); const sp = G.tax.split(tot, true, '10');
    let content;
    if (s.mode === 'ALL') content = notice(`${catName(cat, s.reason)}: la nota va por el total del comprobante (${money(ref.total)}).`, 'info');
    else if (s.mode === 'AMOUNT') content = h('label', { class: 'small' }, 'Importe con IGV ', h('input', { class: 'input', type: 'number', step: '0.01', min: 0, value: s.amount, style: 'width:140px', attrs: { 'aria-label': 'Importe' }, on: { change: e => { s.amount = Number(e.target.value); G.refresh(); } } }));
    else content = stbl([['Línea', l => l.description], ['Facturado', l => F.num(l.qty, l.uom_code === 'KGM' ? 3 : 0) + ' ' + l.uom_code, 'r'], ['P. unit.', l => F.num(l.unit_price, 2), 'r'], [s.mode === 'WEIGHT' ? 'Peso real reclamado (kg)' : 'Cantidad a devolver/descontar', l => { const i = ref.lines.indexOf(l); if (s.mode === 'WEIGHT' && l.uom_code !== 'KGM') return h('span', { class: 'muted small' }, 'No va por kg'); return h('input', { class: 'input', type: 'number', step: 'any', min: 0, max: l.qty, value: (s.mode === 'WEIGHT' ? s.kg[i] : s.sel[i]) ?? '', style: 'width:120px', attrs: { 'aria-label': 'Cantidad' }, on: { change: e => { const v = e.target.value === '' ? null : Number(e.target.value); if (s.mode === 'WEIGHT') s.kg[i] = v; else s.sel[i] = v; G.refresh(); } } }); }], ['Total línea', l => money(l.total), 'r']], ref.lines);
    const restock = kind === 'CREDIT_NOTE' && ['06', '07'].includes(s.reason) && ref.lines.some(l => l.variant_id);
    body.appendChild(card('Líneas e importe', h('div', { class: 'stack' }, content,
      restock ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.restock, on: { change: e => { s.restock = e.target.checked; } } }), h('span', null, 'Reingresar la mercadería devuelta al almacén '), h('select', { class: 'input', style: 'width:auto', attrs: { 'aria-label': 'Almacén' }, on: { change: e => { s.wh = e.target.value; } } }, D.where('warehouses', w => w.establishment_id === ref.establishment_id || w.id === 'wh-DEV-L1').map(w => h('option', { value: w.id, selected: w.id === s.wh }, w.name)))) : null,
      h('div', { class: 'row between' }, dl([['Valor de venta', money(sp.base)], ['IGV', money(sp.igv)], ['Total de la nota', h('b', null, money(tot))]]),
        kind === 'CREDIT_NOTE' && tot > avail + 0.005 ? notice(`RN-FAC-08: supera el disponible (${money(avail)}).`, 'bad') : null,
        btn(`Emitir ${kind === 'CREDIT_NOTE' ? 'nota de crédito' : 'nota de débito'}`, () => G.require('fac.credit_note.issue', () => {
          try { if (!s.text.trim()) G.fail('RN-FAC-07', 'Escribe el sustento de la nota.'); const d = note(kind, { document_id: ref.id, reason_code: s.reason, reason: s.text, lines, restock: restock && s.restock ? { wh: s.wh } : null }); st['n' + code] = null; toast(`${docNo(d)} emitida por ${money(d.total)}`, 'ok'); G.go('FAC-04', { id: d.id }); } catch (e) { err(e); }
        }), { kind: 'primary', disabled: !lines.length }))), { flush: false }));
  }
  const fac05 = (el, p) => noteScreen(el, p, 'CREDIT_NOTE');
  const fac06 = (el, p) => noteScreen(el, p, 'DEBIT_NOTE');

  function fac07(el) {
    const body = page(el, { code: 'FAC-07', title: 'Cola de envío', sub: 'Comprobantes y guías pendientes, con error o en reintento (1, 5, 15, 60 y 240 min); próximo intento y reenvío manual. El OSE de este prototipo es la implementación falsa (D-FAC-01).' });
    const now = clock();
    const docs = G.scope.filter(D.where('sales_documents', d => d.status !== 'VOIDED' && (d.sunat_status === 'PENDING' || (d.sunat_status === 'REJECTED' && !d.reissued_by))));
    const guides = D.where('dispatch_guides', g => g.sunat_status === 'PENDING' && g.status !== 'VOIDED');
    const sums = D.where('sunat_daily_summaries', s => ['PENDING', 'SENT'].includes(s.status));
    body.appendChild(kpis([
      { label: 'Pendientes de envío', value: F.num(docs.filter(d => d.sunat_status === 'PENDING').length + guides.length) },
      { label: 'En reintento', value: F.num(docs.filter(d => d.sunat_status === 'PENDING' && d.send_attempts && !d.needs_review).length), tone: 'warn' },
      { label: 'Revisión manual', value: F.num(docs.filter(d => d.sunat_status === 'PENDING' && d.needs_review).length), tone: docs.some(d => d.needs_review && d.sunat_status === 'PENDING') ? 'bad' : 'ok', sub: `agotaron ${maxAttempts()} intentos` },
      { label: 'Rechazados sin reemitir', value: F.num(docs.filter(d => d.sunat_status === 'REJECTED').length), tone: docs.some(d => d.sunat_status === 'REJECTED') ? 'bad' : 'ok' },
      { label: 'Pendientes > 24 h', value: F.num((G.kpi('KPI-FAC-02') || {}).value || 0), sub: 'KPI-FAC-02 · meta 0' },
    ]));
    const sim = h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'OSE:'), pills([['ONLINE', 'En línea'], ['DOWN', 'Caído (sin respuesta)']], ose.mode, v => { ose.mode = v; toast(v === 'DOWN' ? 'OSE caído: los envíos quedan pendientes y se reintentan' : 'OSE en línea', v === 'DOWN' ? 'warn' : 'ok'); G.refresh(); }),
        h('span', { class: 'small muted' }, 'Próxima respuesta:'), pills([['', 'Normal'], ['OBSERVED', 'Observar'], ['REJECTED', 'Rechazar']], ose.next || '', v => { ose.next = v || null; G.refresh(); })),
      h('div', { class: 'row' }, h('span', { class: 'small' }, 'Reloj del despachador: ', h('b', { class: 'mono' }, F.datetime(now)), fac.offset ? ` (+${fac.offset} min)` : ''), [1, 5, 15, 60, 240].map(m => btn(`+${m} min`, () => { fac.offset += m; const r = processQueue(); toast(`Reloj +${m} min · procesados ${r.processed}: ${r.accepted} aceptados, ${r.failed} sin respuesta, ${r.rejected} rechazados`, r.failed || r.rejected ? 'warn' : 'ok'); G.refresh(); }, { sm: true })),
        btn('Procesar cola ahora', () => { const r = processQueue(); toast(`Procesados ${r.processed}: ${r.accepted} aceptados, ${r.failed} sin respuesta, ${r.rejected} rechazados`, r.failed || r.rejected ? 'warn' : 'ok'); G.refresh(); }, { kind: 'primary', sm: true })),
      h('div', { class: 'small muted' }, `Parámetros: fac_max_send_attempts = ${maxAttempts()} · fac_retry_backoff_minutes = [${backoff().join(', ')}] · fac_einvoice_provider = ${G.param('fac_einvoice_provider')}`));
    body.appendChild(card('Simulador del OSE/PSE', sim));
    const items = [
      ...docs.map(d => ({ kind: 'DOC', id: d.id, number: docNo(d), type: TYPE_SHORT[d.doc_type], brand: G.brandName(d.brand_id), issued: d.issued_at, attempts: d.send_attempts || 0, last: d.sunat_message, next: d.next_retry_at, state: d.sunat_status === 'REJECTED' ? 'REJECTED' : d.needs_review ? 'FAILED' : d.send_attempts ? 'RETRY' : 'PENDING', row: d })),
      ...guides.map(g => ({ kind: 'GUIDE', id: g.id, number: g.full_number, type: 'Guía', brand: g.brand_id ? G.brandName(g.brand_id) : '—', issued: g.issued_at, attempts: g.send_attempts || 0, last: g.sunat_message, next: g.next_retry_at, state: g.needs_review ? 'FAILED' : g.send_attempts ? 'RETRY' : 'PENDING', row: g })),
      ...sums.map(s => ({ kind: 'SUM', id: s.id, number: s.identifier, type: s.summary_type === 'RA' ? 'Com. de baja' : 'Resumen diario', brand: '—', issued: s.created_at, attempts: D.where('einvoice_submissions', x => x.summary_id === s.id).length, last: s.last_error || (s.ticket ? 'Ticket ' + s.ticket : ''), next: null, state: s.status === 'SENT' ? 'SENT' : 'PENDING', row: s })),
    ];
    body.appendChild(table({
      id: 'fac07', rows: items, sort: 'issued', dir: 1, empty: 'La cola está vacía: todo fue aceptado.',
      columns: [{ key: 'number', label: 'Documento', mono: true }, { key: 'type', label: 'Tipo' }, { key: 'brand', label: 'Marca' }, { key: 'issued', label: 'Emitido', render: x => F.datetime(x.issued) }, { key: 'attempts', label: 'Intentos', align: 'r' }, { key: 'state', label: 'Estado', render: x => status(x.state) }, { key: 'last', label: 'Última respuesta', render: x => x.last ? h('span', { class: 'small' }, x.last) : '—' }, { key: 'next', label: 'Próximo intento', render: x => x.next ? h('span', { class: x.next <= now ? 'badge warn' : 'small' }, F.datetime(x.next)) : '—' }],
      filters: [{ key: 'state', label: 'Estado', options: [['PENDING', 'Pendiente'], ['RETRY', 'Reintento'], ['FAILED', 'Revisión manual'], ['REJECTED', 'Rechazado'], ['SENT', 'Ticket enviado']] }],
      onRow: x => x.kind === 'DOC' ? openDoc(x.id) : x.kind === 'GUIDE' ? openGuide(x.id) : openSummary(x.id),
      actions: x => x.kind === 'DOC' && x.state === 'REJECTED' ? [btn('Reemitir', () => G.require('fac.document.issue', () => run(() => reissue(x.id), r => `Reemitido como ${docNo(r)}`)), { sm: true })] : x.kind === 'DOC' ? [btn('Reenviar', () => G.require('fac.document.resend', () => run(() => { D.update('sales_documents', x.id, { needs_review: false }, { silent: true }); return send(x.id, { manual: true }); }, r => `Intento ${r.attempt}: ${r.message}`)), { sm: true })] : x.kind === 'GUIDE' ? [btn('Reenviar', () => run(() => sendGuide(x.id), r => `Guía: ${r.result}`), { sm: true })] : [btn(x.state === 'SENT' ? 'Consultar ticket' : 'Enviar', () => run(() => x.state === 'SENT' ? querySummary(x.id) : sendSummary(x.id), 'Resumen procesado'), { sm: true })],
    }));
  }

  function openSummary(id) {
    const s = D.get('sunat_daily_summaries', id);
    drawer(`${s.summary_type === 'RA' ? 'Comunicación de baja' : 'Resumen diario'} ${s.identifier}`, b => {
      const lines = D.where('sunat_daily_summary_lines', l => l.summary_id === id);
      b.appendChild(h('div', { class: 'row' }, s.status === 'PENDING' ? btn('Enviar a SUNAT', () => { run(() => sendSummary(id), r => r.status === 'SENT' ? `Ticket ${r.ticket}` : 'Sin respuesta del OSE'); G.ui.closeAll(); openSummary(id); }, { kind: 'primary', sm: true }) : null, s.status === 'SENT' ? btn('Consultar ticket', () => { run(() => querySummary(id), 'Ticket aceptado: bajas registradas'); G.ui.closeAll(); openSummary(id); }, { kind: 'primary', sm: true }) : null));
      b.appendChild(dl([['Tipo', s.summary_type === 'RA' ? 'RA · comunicación de baja (facturas y notas F)' : 'RC · resumen diario de boletas'], ['Fecha de referencia', F.date(s.reference_date)], ['Estado', status(s.status)], ['Ticket', s.ticket || '—'], ['Enviado', F.datetime(s.sent_at)], ['Aceptado', F.datetime(s.accepted_at)], s.last_error ? ['Último error', s.last_error] : null]));
      b.appendChild(stbl([['Comprobante', l => { const d = D.get('sales_documents', l.document_id); return d ? linkTo(docNo(d), () => openDoc(d.id)) : '—'; }], ['Acción', l => ({ ADD: 'Informar', MODIFY: 'Modificar', VOID: 'Dar de baja' })[l.action]], ['Motivo', l => l.reason || '—'], ['Total', l => money((D.get('sales_documents', l.document_id) || {}).total), 'r'], ['SUNAT', l => status((D.get('sales_documents', l.document_id) || {}).sunat_status)]], lines));
    }, { code: 'FAC-08', wide: true });
  }
  function fac08(el) {
    const body = page(el, { code: 'FAC-08', title: 'Resumen diario y bajas', sub: 'Resúmenes diarios de boletas (RC) y comunicaciones de baja (RA) con su ticket y estado (RN-FAC-09). Al anular un comprobante aceptado se agrega a la baja del día.' });
    const mode = G.param('fac_receipt_summary_mode');
    body.appendChild(notice(h('div', { class: 'row between' }, h('span', null, `Modo de boletas: `, h('b', null, mode === 'SUMMARY' ? 'resumen diario' : 'envío individual'), ` (fac_receipt_summary_mode · D-FAC-03, valor provisional: envío individual). Plazos de baja a confirmar por la contadora.`), G.canDo('FAC', 'A') ? btn(mode === 'SUMMARY' ? 'Pasar a envío individual' : 'Pasar a resumen diario', () => modal('Cambiar el modo de envío de boletas', bd => bd.appendChild(form({ id: 'mode', fields: [{ key: 'reason', label: 'Motivo del cambio', type: 'textarea', required: true }], submitLabel: 'Cambiar', onSubmit: v => { try { G.setParam('fac_receipt_summary_mode', mode === 'SUMMARY' ? 'INDIVIDUAL' : 'SUMMARY', v.reason); G.ui.closeAll(); toast('Modo actualizado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))), { sm: true }) : null), 'info'));
    const rows = D.all('sunat_daily_summaries');
    const lines = D.all('sunat_daily_summary_lines'); const cnt = U.groupBy(lines, 'summary_id');
    body.appendChild(kpis([{ label: 'Bajas por enviar', value: F.num(rows.filter(s => s.status === 'PENDING' && s.summary_type === 'RA').length), tone: rows.some(s => s.status === 'PENDING') ? 'warn' : 'ok' }, { label: 'Tickets por consultar', value: F.num(rows.filter(s => s.status === 'SENT').length) }, { label: 'Comprobantes dados de baja (mes)', value: F.num(D.where('sales_documents', d => d.sunat_status === 'VOIDED' && d.issue_date >= G.date.month(G.TODAY)).length) }, { label: 'Boletas por informar', value: F.num(D.where('sales_documents', d => d.summary_pending && d.sunat_status === 'PENDING').length) }]));
    const dt = h('input', { class: 'input', type: 'date', value: G.TODAY, style: 'width:auto', attrs: { 'aria-label': 'Fecha del resumen' } });
    body.appendChild(card('Generar resumen diario de boletas', h('div', { class: 'row' }, dt, btn('Generar RC', () => run(() => createDailySummary(dt.value), r => `${r.identifier} generado`), { kind: 'primary', sm: true, disabled: mode !== 'SUMMARY' }), h('span', { class: 'small muted' }, mode === 'SUMMARY' ? 'Agrupa las boletas del día pendientes de informar.' : 'Con envío individual cada boleta va sola al OSE; el resumen se usa para bajas de boletas.'))));
    body.appendChild(table({ id: 'fac08', rows, sort: 'reference_date', dir: -1, columns: [{ key: 'identifier', label: 'Identificador', mono: true }, { key: 'summary_type', label: 'Tipo', value: s => s.summary_type === 'RA' ? 'Comunicación de baja' : 'Resumen de boletas' }, { key: 'reference_date', label: 'Fecha ref.', render: s => F.date(s.reference_date) }, { key: 'n', label: 'Comprobantes', align: 'r', value: s => (cnt[s.id] || []).length }, { key: 'ticket', label: 'Ticket', mono: true }, { key: 'status', label: 'Estado', render: s => status(s.status) }], onRow: s => openSummary(s.id), actions: s => s.status === 'PENDING' ? [btn('Enviar', () => run(() => sendSummary(s.id), r => r.status === 'SENT' ? `Ticket ${r.ticket}` : 'Sin respuesta del OSE'), { sm: true, kind: 'primary' })] : s.status === 'SENT' ? [btn('Consultar ticket', () => run(() => querySummary(s.id), 'Ticket aceptado'), { sm: true })] : [], empty: 'Sin resúmenes ni bajas.' }));
  }

  /* ---------- guías ---------- */
  function guideLines(id) { return D.where('dispatch_guide_lines', l => l.guide_id === id); }
  function openGuide(id) {
    const g = D.get('dispatch_guides', id);
    drawer(`Guía de remisión ${g.full_number}`, (b, close) => {
      b.appendChild(h('div', { class: 'row' }, btn('Representación impresa', () => modal(`GRE ${g.full_number}`, bd => bd.appendChild(guidePrint(g)), [{ label: 'Imprimir', kind: 'primary', onClick: () => { G.print(); return false; } }], { wide: true }), { sm: true }), g.sunat_status === 'PENDING' ? btn('Reenviar', () => { run(() => sendGuide(g.id), r => `Guía: ${G.ui.statusLabel(r.result)}`); close(); openGuide(id); }, { sm: true, kind: 'primary' }) : null, g.status !== 'VOIDED' ? btn('Anular', () => modal('Anular guía', bd => bd.appendChild(form({ id: 'vg', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], submitLabel: 'Anular', onSubmit: v => { try { voidGuide(g.id, v.reason); G.ui.closeAll(); toast('Guía anulada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))), { sm: true, kind: 'danger' }) : null));
      b.appendChild(guideDetail(g));
    }, { wide: true, code: 'FAC-09' });
  }
  function guideDetail(g) {
    const o = g.order_id ? D.get('sales_orders', g.order_id) : null;
    return h('div', { class: 'stack' }, h('div', { class: 'grid c2' },
      dl([['Número', h('b', { class: 'mono' }, g.full_number)], ['Estado SUNAT', status(g.sunat_status)], ['Emisión', F.date(g.issue_date)], ['Inicio del traslado', F.date(g.start_date)], ['Motivo (cat. 20)', `${g.transfer_reason_code} · ${catName(CAT20, g.transfer_reason_code)}`], ['Modalidad', g.transport_mode === '01' ? '01 · Transporte público' : '02 · Transporte privado'], g.transport_mode === '01' ? ['Transportista', G.supName(g.carrier_supplier_id)] : ['Vehículo', (D.get('vehicles', g.vehicle_id) || {}).plate || '—'], g.transport_mode === '02' ? ['Conductor', `${(D.get('employees', g.driver_employee_id) || {}).full_name || '—'} · licencia ${g.driver_license || '—'}`] : null]),
      dl([['Partida', `${g.origin_address} (${g.origin_ubigeo})`], ['Llegada', `${g.dest_address} (${g.dest_ubigeo})`], ['Destinatario', g.recipient_customer_id ? G.custName(g.recipient_customer_id) : g.dest_establishment_id ? `${company().legal_name} · ${G.siteName(g.dest_establishment_id)}` : '—'], ['Peso bruto', F.kg(g.gross_weight_kg, 3)], ['Bultos', g.packages], o ? ['Pedido', `${o.number} · ${G.ui.statusLabel(o.status)}`] : null, g.transfer_ref || g.transfer_id ? ['Transferencia', g.transfer_ref || g.transfer_id] : null, g.sales_document_id ? ['Comprobante', docNo(D.get('sales_documents', g.sales_document_id))] : null, g.void_reason ? ['Anulación', g.void_reason] : null])),
      stbl([['Producto', l => l.description], ['Cantidad', l => F.num(l.qty, l.uom_code === 'KGM' ? 3 : 0) + ' ' + l.uom_code, 'r'], ['Peso', l => l.weight_kg != null ? F.kg(l.weight_kg, 3) : '—', 'r'], ['Lote', l => l.lot_id ? (D.get('lots', l.lot_id) || {}).code : '—']], guideLines(g.id)),
      stbl([['Intento', s => s.attempt_no], ['Fecha', s => F.datetime(s.requested_at)], ['Resultado', s => status(s.result === 'TIMEOUT' ? 'FAILED' : s.result)], ['Mensaje', s => s.message]], D.where('einvoice_submissions', s => s.guide_id === g.id), 'Aún no se envía.'));
  }
  function guidePrint(g) {
    const c = company(); const b = g.brand_id ? brandOf(g.brand_id) : brandOf('br-DG');
    return h('div', { style: paper + 'display:grid;gap:10px;font-size:13px' },
      h('div', { style: 'display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap' }, h('div', { style: 'display:flex;gap:10px;align-items:center' }, logo(b, 48), h('div', null, h('b', null, c.legal_name), h('div', { class: 'small muted' }, c.fiscal_address))), h('div', { style: `border:2px solid ${b.primary_color};border-radius:8px;padding:8px 12px;text-align:center` }, h('b', null, 'RUC ' + c.ruc), h('div', { style: `color:${b.primary_color};font-weight:700` }, 'GUÍA DE REMISIÓN ELECTRÓNICA REMITENTE'), h('div', { class: 'mono' }, g.full_number))),
      guideDetail(g), G.ui.qr([c.ruc, '09', g.series, g.number, g.issue_date].join('|'), 90));
  }
  function fac09(el) {
    const body = page(el, { code: 'FAC-09', title: 'Guía de remisión', sub: 'GRE remitente con motivo del catálogo 20, modalidad, transportista o vehículo y conductor, partida, llegada, peso y bultos; desde el pedido, la transferencia o directa (RN-FAC-11).', actions: G.can('fac.guide.issue') ? [{ label: 'Nueva guía', kind: 'primary', onClick: () => guideDrawer() }] : [] });
    body.appendChild(pills(RANGES, st.range09, v => { st.range09 = v; G.refresh(); }));
    const rows = D.where('dispatch_guides', g => inRange(g.issue_date, st.range09) && G.scope.ok(g));
    body.appendChild(kpis([{ label: 'Guías', value: F.num(rows.length) }, { label: 'Traslados entre locales (04)', value: F.num(rows.filter(g => g.transfer_reason_code === '04').length) }, { label: 'Ventas y provincia (01)', value: F.num(rows.filter(g => g.transfer_reason_code === '01').length) }, { label: 'Consignación (05)', value: F.num(rows.filter(g => g.transfer_reason_code === '05').length) }, { label: 'Pendientes de SUNAT', value: F.num(rows.filter(g => g.sunat_status === 'PENDING').length), tone: rows.some(g => g.sunat_status === 'PENDING') ? 'warn' : 'ok' }]));
    body.appendChild(table({ id: 'fac09', rows, sort: 'issue_date', dir: -1, columns: [{ key: 'issue_date', label: 'Fecha', render: g => F.date(g.issue_date) }, { key: 'full_number', label: 'Número', mono: true }, { key: 'transfer_reason_code', label: 'Motivo', value: g => `${g.transfer_reason_code} · ${catName(CAT20, g.transfer_reason_code)}` }, { key: 'transport_mode', label: 'Modalidad', value: g => g.transport_mode === '01' ? 'Público' : 'Privado' }, { key: 'dest', label: 'Llegada', value: g => g.dest_establishment_id ? G.siteName(g.dest_establishment_id) : g.recipient_customer_id ? G.custName(g.recipient_customer_id) : g.dest_address }, { key: 'gross_weight_kg', label: 'Peso', align: 'r', render: g => F.kg(g.gross_weight_kg, 3) }, { key: 'sunat_status', label: 'SUNAT', render: g => status(g.sunat_status) }], filters: [{ key: 'transfer_reason_code', label: 'Motivo', options: CAT20.filter(x => (G.param('fac_gre_allowed_reasons') || []).includes(x[0])) }], onRow: g => openGuide(g.id), empty: 'Sin guías en el rango.' }));
  }
  function guideDrawer(pre) {
    const s = Object.assign({ source: 'TRANSFER', reason_code: '04', transport_mode: '02', origin_establishment_id: 'es-L2', dest_establishment_id: 'es-L1', vehicle_id: 've-BXR-871', driver_user_id: (D.find('users', u => u.role === 'REPARTIDOR' && u.name.startsWith('Hugo')) || {}).id, start_date: G.TODAY, packages: 1, lines: [{ variant_id: 'va-DG-CAL-1L', qty: 20, weight_kg: 20 }], transfer_ref: '' }, pre || {});
    drawer('Nueva guía de remisión', (b, close) => {
      const draw = () => {
        G.ui.clear(b);
        b.appendChild(h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Origen del traslado:'), pills([['ORDER', 'Pedido'], ['TRANSFER', 'Transferencia'], ['DIRECT', 'Directa']], s.source, v => { s.source = v; if (v === 'TRANSFER') { s.reason_code = '04'; } else if (v === 'ORDER') { s.reason_code = '01'; s.dest_establishment_id = ''; const o = D.where('sales_orders', o => ['READY', 'IN_ROUTE', 'WEIGHED', 'DELIVERED'].includes(o.status) && o.delivery_date >= G.date.add(G.TODAY, -1))[0]; if (o) { s.order_id = o.id; s.recipient_customer_id = o.customer_id; s.lines = o.lines.map(l => ({ variant_id: l.variant_id, qty: l.qty, weight_kg: l.weighed_kg ?? l.est_weight_kg ?? R(l.qty * 0.5, 3) })); } } draw(); })));
        const allowed = (G.param('fac_gre_allowed_reasons') || []).map(String);
        const orders = D.where('sales_orders', o => ['READY', 'IN_ROUTE', 'WEIGHED', 'DELIVERED'].includes(o.status) && o.delivery_date >= G.date.add(G.TODAY, -1)).slice(0, 80);
        const fields = [
          { key: 'reason_code', label: 'Motivo de traslado (catálogo 20)', type: 'select', required: true, options: CAT20.filter(x => allowed.includes(x[0])).map(([c, n]) => [c, `${c} · ${n}`]), onChange: (v) => { s.reason_code = v; } },
          { key: 'transport_mode', label: 'Modalidad', type: 'select', required: true, options: [['02', '02 · Privado (vehículo y conductor propios)'], ['01', '01 · Público (empresa de transporte)']], onChange: v => { s.transport_mode = v; draw(); } },
          { key: 'origin_establishment_id', label: 'Punto de partida', type: 'select', required: true, options: siteOpts(), onChange: v => { s.origin_establishment_id = v; } },
          s.source === 'ORDER' ? { key: 'order_id', label: 'Pedido', type: 'select', required: true, options: orders.map(o => [o.id, `${o.number} · ${G.custName(o.customer_id)} · ${G.ui.statusLabel(o.status)}`]), onChange: v => { s.order_id = v; const o = D.get('sales_orders', v); if (o) { s.recipient_customer_id = o.customer_id; s.lines = o.lines.map(l => ({ variant_id: l.variant_id, qty: l.qty, weight_kg: l.weighed_kg ?? l.est_weight_kg ?? R(l.qty * 0.5, 3) })); } draw(); } } : { key: 'dest_establishment_id', label: 'Establecimiento de llegada (motivo 04)', type: 'select', options: siteOpts(), onChange: v => { s.dest_establishment_id = v; } },
          s.source === 'TRANSFER' ? { key: 'transfer_ref', label: 'Transferencia de almacén', type: 'select', required: true, options: transferOpts(), onChange: v => { s.transfer_ref = v; } } : { key: 'recipient_customer_id', label: 'Destinatario (venta, consignación)', type: 'select', options: D.where('customers', c => ['RESTAURANT', 'BUSINESS', 'CONSIGNMENT_POINT'].includes(c.customer_type) || c.id === 'cu-PROV1' || c.id === s.recipient_customer_id).map(c => [c.id, c.trade_name || c.full_name]), onChange: v => { s.recipient_customer_id = v; } },
          s.transport_mode === '01' ? { key: 'carrier_supplier_id', label: 'Empresa de transporte', type: 'select', required: true, options: D.where('suppliers', x => x.supplier_type === 'DELIVERY_COMPANY').map(x => [x.id, x.trade_name]), onChange: v => { s.carrier_supplier_id = v; } } : { key: 'vehicle_id', label: 'Vehículo', type: 'select', required: true, options: D.all('vehicles').map(v => [v.id, `${v.plate} · ${v.vehicle_type}${v.refrigerated ? ' refrigerado' : ''}`]), onChange: v => { s.vehicle_id = v; } },
          s.transport_mode === '02' ? { key: 'driver_user_id', label: 'Conductor', type: 'select', required: true, options: D.where('users', u => ['REPARTIDOR', 'COORDINADOR_DELIVERY', 'ALMACENERO'].includes(u.role)).map(u => [u.id, u.name]), onChange: v => { s.driver_user_id = v; } } : null,
          { key: 'start_date', label: 'Inicio del traslado', type: 'date', required: true, onChange: v => { s.start_date = v; } },
          { key: 'packages', label: 'Bultos', type: 'number', min: 1, required: true, onChange: v => { s.packages = v; } },
          { key: 'gross_weight_kg', label: 'Peso bruto (kg)', type: 'number', min: 0, help: 'Vacío: suma del peso de las líneas.', onChange: v => { s.gross_weight_kg = v; } },
        ].filter(Boolean);
        const lt = h('div', { class: 'stack', style: 'gap:6px' });
        s.lines.forEach((l, i) => lt.appendChild(h('div', { style: 'display:grid;grid-template-columns:minmax(0,3fr) minmax(70px,1fr) minmax(80px,1fr) auto;gap:6px;align-items:center' },
          h('select', { class: 'input', attrs: { 'aria-label': 'Producto' }, on: { change: e => { l.variant_id = e.target.value; } } }, D.where('product_variants', v => v.status === 'ACTIVE').map(v => h('option', { value: v.id, selected: v.id === l.variant_id }, `${v.sku} · ${v.name}`))),
          h('input', { class: 'input', type: 'number', step: 'any', value: l.qty, attrs: { 'aria-label': 'Cantidad' }, on: { change: e => { l.qty = Number(e.target.value); } } }),
          h('input', { class: 'input', type: 'number', step: 'any', value: l.weight_kg ?? '', placeholder: 'kg', attrs: { 'aria-label': 'Peso kg' }, on: { change: e => { l.weight_kg = e.target.value === '' ? null : Number(e.target.value); } } }),
          btn('Quitar', () => { s.lines.splice(i, 1); draw(); }, { sm: true, kind: 'ghost' }))));
        lt.appendChild(btn('Agregar línea', () => { s.lines.push({ variant_id: 'va-DG-CUY-ENT', qty: 1, weight_kg: null }); draw(); }, { sm: true }));
        b.appendChild(form({ id: 'gre', fields, values: s, submitLabel: 'Emitir guía', onCancel: close, extraActions: [], onSubmit: v => {
          Object.assign(s, v);
          try {
            const g = issueGuide({ reason_code: s.reason_code, transport_mode: s.transport_mode, origin_establishment_id: s.origin_establishment_id, dest_establishment_id: s.source === 'ORDER' ? null : s.dest_establishment_id || null, order_id: s.source === 'ORDER' ? s.order_id : null, transfer_ref: s.source === 'TRANSFER' ? s.transfer_ref : null, transfer_id: s.source === 'TRANSFER' && D.get('stock_transfers', s.transfer_ref) ? s.transfer_ref : null, recipient_customer_id: s.source === 'TRANSFER' ? null : s.recipient_customer_id || null, carrier_supplier_id: s.carrier_supplier_id, vehicle_id: s.vehicle_id, driver_user_id: s.driver_user_id, start_date: s.start_date, packages: s.packages, gross_weight_kg: s.gross_weight_kg, lines: s.lines, brand_id: s.order_id ? (D.get('sales_orders', s.order_id) || {}).brand_id : null });
            close(); toast(`Guía ${g.full_number} emitida · ${G.ui.statusLabel(g.sunat_status)}`, 'ok'); G.refresh(); openGuide(g.id); return true;
          } catch (e) { return e.message; }
        } }));
        b.appendChild(card('Líneas (bienes que se trasladan)', lt));
      };
      draw();
    }, { wide: true, code: 'FAC-09' });
  }
  function transferOpts() {
    const t = D.all('stock_transfers');
    const out = t.slice(-15).map(x => [x.id, `${x.number || x.code || x.id} · ${G.whName(x.from_warehouse_id || x.from_wh)} → ${G.whName(x.to_warehouse_id || x.to_wh)}`]);
    for (let i = 1; i <= 3; i++) { const ref = `TR-${G.TODAY.replace(/-/g, '').slice(2)}-0${i}`; if (!D.find('dispatch_guides', g => g.transfer_ref === ref)) out.push([ref, `${ref} · transferencia entre locales (referencia de ALM)`]); }
    return out;
  }

  function fac10(el) {
    const can = G.can('fac.series.manage');
    const body = page(el, { code: 'FAC-10', title: 'Series', sub: 'Series por tipo, marca y local con su correlativo siguiente y estado (RN-FAC-02, RN-PLT-03). D-FAC-02: series por marca; el Local 2 usa la serie de su marca.', actions: can ? [{ label: 'Nueva serie', kind: 'primary', onClick: () => seriesForm() }] : [] });
    const cnt = U.groupBy(D.all('sales_documents'), 'series'); const gcnt = U.groupBy(D.all('dispatch_guides'), 'series');
    const rows = D.where('document_series', s => ['INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'DISPATCH_GUIDE'].includes(s.doc_type));
    body.appendChild(kpis([{ label: 'Series electrónicas activas', value: F.num(rows.filter(s => s.status === 'ACTIVE').length) }, { label: 'Marcas con series propias', value: F.num(new Set(rows.filter(s => s.brand_id).map(s => s.brand_id)).size) }, { label: 'Comprobantes emitidos', value: F.num(D.all('sales_documents').length) }]));
    body.appendChild(table({ id: 'fac10', rows, sort: 'series', pageSize: 40, columns: [{ key: 'series', label: 'Serie', mono: true }, { key: 'doc_type', label: 'Tipo', value: s => G.docTypeName(s.doc_type) + (s.applies_to ? ` de ${G.docTypeName(s.applies_to).toLowerCase()}` : '') }, { key: 'brand_id', label: 'Marca', value: s => s.brand_id ? G.brandName(s.brand_id) : (s.series === 'B010' ? 'Todas (mostrador)' : 'Empresa') }, { key: 'establishment_id', label: 'Local', value: s => G.siteName(s.establishment_id) + (s.all_sites ? ' (también Local 2)' : '') }, { key: 'next_number', label: 'Siguiente', align: 'r', mono: true, value: s => U.pad(s.next_number, 8) }, { key: 'n', label: 'Emitidos', align: 'r', value: s => ((cnt[s.series] || []).length + (gcnt[s.series] || []).length) }, { key: 'status', label: 'Estado', render: s => status(s.status) }], filters: [{ key: 'doc_type', label: 'Tipo', options: [['INVOICE', 'Factura'], ['RECEIPT', 'Boleta'], ['CREDIT_NOTE', 'Nota de crédito'], ['DEBIT_NOTE', 'Nota de débito'], ['DISPATCH_GUIDE', 'Guía']] }, { key: 'brand_id', label: 'Marca', options: brandOpts() }],
      actions: s => can ? [btn(s.status === 'ACTIVE' ? 'Desactivar' : 'Activar', () => modal(`${s.status === 'ACTIVE' ? 'Desactivar' : 'Activar'} la serie ${s.series}`, bd => bd.appendChild(form({ id: 'ser', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], submitLabel: 'Confirmar', onSubmit: v => { D.update('document_series', s.id, { status: s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', status_reason: v.reason }); G.ui.closeAll(); toast('Serie actualizada', 'ok'); G.refresh(); return true; } }))), { sm: true })] : [] }));
  }
  function seriesForm() {
    drawer('Nueva serie', (b, close) => b.appendChild(form({ id: 'nser', values: { doc_type: 'RECEIPT', establishment_id: 'es-L2' }, fields: [{ key: 'doc_type', label: 'Tipo', type: 'select', required: true, options: [['INVOICE', 'Factura (F###)'], ['RECEIPT', 'Boleta (B###)'], ['CREDIT_NOTE', 'Nota de crédito (FC## / BC##)'], ['DEBIT_NOTE', 'Nota de débito (FD## / BD##)'], ['DISPATCH_GUIDE', 'Guía de remisión (T###)']] }, { key: 'series', label: 'Serie (4 caracteres)', required: true, help: 'Ej.: F011 factura de Don Guando en el Local 2.' }, { key: 'brand_id', label: 'Marca', type: 'select', options: brandOpts() }, { key: 'establishment_id', label: 'Local', type: 'select', required: true, options: siteOpts() }, { key: 'applies_to', label: 'Aplica a (notas)', type: 'select', options: [['INVOICE', 'Facturas'], ['RECEIPT', 'Boletas']] }], submitLabel: 'Crear serie', onCancel: close, onSubmit: v => {
      const code = String(v.series || '').toUpperCase();
      const pat = { INVOICE: /^F[A-Z0-9]{3}$/, RECEIPT: /^B[A-Z0-9]{3}$/, CREDIT_NOTE: /^[FB][A-Z0-9]{3}$/, DEBIT_NOTE: /^[FB][A-Z0-9]{3}$/, DISPATCH_GUIDE: /^T[A-Z0-9]{3}$/ }[v.doc_type];
      if (!pat.test(code)) return { series: `RN-FAC-02: formato no válido para ${G.docTypeName(v.doc_type).toLowerCase()}.` };
      if (D.find('document_series', s => s.series === code)) return { series: 'RN-PLT-03: esa serie ya existe.' };
      if (['CREDIT_NOTE', 'DEBIT_NOTE'].includes(v.doc_type) && (!v.applies_to || code[0] !== (v.applies_to === 'INVOICE' ? 'F' : 'B'))) return { applies_to: 'RN-FAC-07: la serie de nota empieza con F si aplica a facturas o con B si aplica a boletas.' };
      if (v.doc_type !== 'DISPATCH_GUIDE' && !v.brand_id) return { brand_id: 'D-FAC-02: cada serie de comprobante es de una marca.' };
      D.insert('document_series', { id: 'se-' + code, company_id: 'co-dg', establishment_id: v.establishment_id, brand_id: v.doc_type === 'DISPATCH_GUIDE' ? null : v.brand_id, doc_type: v.doc_type, series: code, next_number: 1, is_electronic: true, status: 'ACTIVE', applies_to: v.applies_to || null });
      close(); toast(`Serie ${code} creada`, 'ok'); G.refresh(); return true;
    } })), { code: 'FAC-10' });
  }

  function fac11(el) {
    const body = page(el, { code: 'FAC-11', title: 'Plantillas impresas', sub: 'Diseño por marca: logo, color, pie legal y leyendas; la razón social y el RUC son siempre los de la empresa emisora (RN-FAC-16). Vista previa A4 y 80 mm.' });
    body.appendChild(pills(G.db.all('brands').filter(b => b.status === 'ACTIVE').map(b => [b.id, G.brandName(b.id)]), st.brand11, v => { st.brand11 = v; G.refresh(); }));
    const b = brandOf(st.brand11);
    const sample = D.where('sales_documents', d => d.brand_id === b.id && d.doc_type === 'RECEIPT' && valid(d)).sort(U.by('issue_date', -1))[0] || { doc_type: 'RECEIPT', series: seriesFor('RECEIPT', b.id), number: 1, full_number: seriesFor('RECEIPT', b.id) + '-00000001', issue_date: G.TODAY, issued_at: G.TODAY + 'T10:00', brand_id: b.id, establishment_id: 'es-L1', customer_doc_type: 'DNI', customer_doc_number: '45128833', customer_name: 'Cliente de ejemplo', lines: [{ description: 'Producto de ejemplo', qty: 1, uom_code: 'NIU', unit_price: 59, subtotal: 50, igv: 9, total: 59 }], subtotal: 50, igv: 9, total: 59, payment_terms: 'CASH' };
    const wrap = h('div', { class: 'grid side-r' }); body.appendChild(wrap);
    const prev = h('div', { class: 'stack' });
    const tpl = { legal_footer: b.legal_footer, print_legends: b.print_legends || '', print_show_logo: b.print_show_logo !== false };
    const redraw = () => { G.ui.clear(prev); prev.appendChild(tabs([{ key: 'a4', label: 'A4', render: p => p.appendChild(printNode(sample, 'A4', tpl)) }, { key: '80', label: 'Ticket 80 mm', render: p => p.appendChild(printNode(sample, '80', tpl)) }], { key: 'fac11-prev' })); };
    wrap.append(prev, card('Diseño de ' + G.brandName(b.id), form({ id: 'tpl', values: tpl, fields: [{ key: 'color', label: 'Color de la marca (PLT)', type: 'readonly' }, { key: 'print_show_logo', label: 'Mostrar el logo de la marca', type: 'checkbox', onChange: v => { tpl.print_show_logo = v; redraw(); } }, { key: 'legal_footer', label: 'Pie legal', type: 'textarea', required: true, onChange: v => { tpl.legal_footer = v; redraw(); } }, { key: 'print_legends', label: 'Leyendas (una por línea)', type: 'textarea', onChange: v => { tpl.print_legends = v; redraw(); } }], submitLabel: G.canDo('FAC', 'E') ? 'Guardar plantilla' : false, onSubmit: v => {
      if (!/RUC/i.test(v.legal_footer || '')) return { legal_footer: `RN-FAC-16: el pie legal menciona a la empresa emisora y su RUC (${company().ruc}).` };
      D.update('brands', b.id, { legal_footer: v.legal_footer, print_legends: v.print_legends, print_show_logo: !!v.print_show_logo }); toast('Plantilla guardada', 'ok'); G.refresh(); return true;
    } })));
    const colorInp = wrap.querySelector('#f-tpl-color'); if (colorInp) colorInp.value = b.primary_color;
    redraw();
  }

  function fac12(el) {
    const body = page(el, { code: 'FAC-12', title: 'Comprobantes del período', sub: 'Resumen por tipo, marca y estado SUNAT para la contadora, con exportación a Excel (CSV separado por punto y coma).' });
    const months = []; for (let m = G.date.month(G.TODAY); m >= '2026-09-01'; m = G.date.addMonths(m, -1)) months.push([m, G.date.monthName(m)]);
    const per = G.period.of(st.month12);
    body.appendChild(h('div', { class: 'row' }, pills(months, st.month12, v => { st.month12 = v; G.refresh(); }), per ? status(per.status) : null));
    const to = G.date.add(G.date.addMonths(st.month12, 1), -1);
    const rows = G.scope.filter(D.where('sales_documents', d => d.issue_date >= st.month12 && d.issue_date <= to));
    const sign = d => d.doc_type === 'CREDIT_NOTE' ? -1 : 1;
    const ok = rows.filter(valid);
    body.appendChild(kpis([{ label: 'Comprobantes', value: F.num(rows.length) }, { label: 'Valor de venta neto', value: money(U.sum(ok, d => sign(d) * d.subtotal)) }, { label: 'IGV neto', value: money(U.sum(ok, d => sign(d) * d.igv)) }, { label: 'Total neto', value: money(U.sum(ok, d => sign(d) * d.total)) }, { label: 'Anulados / rechazados', value: `${rows.filter(d => d.status === 'VOIDED').length} / ${rows.filter(d => d.sunat_status === 'REJECTED').length}`, tone: rows.some(d => d.sunat_status === 'REJECTED') ? 'warn' : '' }]));
    const groups = U.groupBy(rows, d => d.doc_type + '|' + d.brand_id + '|' + d.series);
    const piv = Object.entries(groups).map(([k, ds]) => { const [t, b, s] = k.split('|'); const v = ds.filter(valid); return { key: k, type: t, brand: b, series: s, n: ds.length, from: U.pad(Math.min(...ds.map(d => d.number)), 8), to: U.pad(Math.max(...ds.map(d => d.number)), 8), base: R(U.sum(v, d => d.subtotal)), igv: R(U.sum(v, d => d.igv)), total: R(U.sum(v, d => d.total)), acc: ds.filter(d => ['ACCEPTED', 'OBSERVED'].includes(d.sunat_status)).length, pend: ds.filter(d => d.sunat_status === 'PENDING').length, bad: ds.filter(d => ['REJECTED', 'VOIDED'].includes(d.sunat_status) || d.status === 'VOIDED').length }; });
    body.appendChild(table({ id: 'fac12', rows: piv, sort: 'series', pageSize: 40, search: false, columns: [{ key: 'type', label: 'Tipo', render: r => typeBadge(r.type), value: r => TYPE_SHORT[r.type] }, { key: 'brand', label: 'Marca', value: r => G.brandName(r.brand) }, { key: 'series', label: 'Serie', mono: true }, { key: 'range', label: 'Del – al', mono: true, value: r => `${r.from} – ${r.to}` }, { key: 'n', label: 'Cant.', align: 'r' }, { key: 'base', label: 'Valor venta', align: 'r', render: r => money(r.base) }, { key: 'igv', label: 'IGV', align: 'r', render: r => money(r.igv) }, { key: 'total', label: 'Total', align: 'r', render: r => money(r.total) }, { key: 'acc', label: 'Aceptados', align: 'r' }, { key: 'pend', label: 'Pendientes', align: 'r' }, { key: 'bad', label: 'Anul./rech.', align: 'r' }],
      toolbar: [btn('Exportar resumen', () => download(`comprobantes-resumen-${st.month12.slice(0, 7)}.csv`, csv([['Tipo', 'Marca', 'Serie', 'Del', 'Al', 'Cantidad', 'Valor venta', 'IGV', 'Total', 'Aceptados', 'Pendientes', 'Anulados o rechazados']].concat(piv.map(r => [TYPE_SHORT[r.type], G.brandName(r.brand), r.series, r.from, r.to, r.n, r.base, r.igv, r.total, r.acc, r.pend, r.bad]))), 'text/csv'), { sm: true }), btn('Exportar detalle', () => download(`comprobantes-detalle-${st.month12.slice(0, 7)}.csv`, csv([['Fecha', 'Tipo', 'Serie', 'Número', 'Doc. adquirente', 'Adquirente', 'Marca', 'Local', 'Valor venta', 'IGV', 'Total', 'Estado SUNAT', 'Estado', 'Referencia', 'Motivo']].concat(rows.sort(U.by('issue_date')).map(d => [d.issue_date, SUNAT_CODE[d.doc_type], d.series, d.number, d.customer_doc_number || '', d.customer_name, G.brandName(d.brand_id), G.siteName(d.establishment_id), d.subtotal, d.igv, d.total, d.sunat_status, d.status, d.related_document_id ? docNo(D.get('sales_documents', d.related_document_id)) : '', d.note_reason_code || '']))), 'text/csv'), { sm: true, kind: 'primary' })] }));
    const byStatus = U.groupBy(rows, 'sunat_status');
    body.appendChild(h('div', { class: 'grid c2' }, card('Por estado SUNAT', G.ui.chart.hbar({ items: Object.entries(byStatus).map(([k, v]) => ({ label: G.ui.statusLabel(k), value: v.length, tone: { ACCEPTED: 'ok', OBSERVED: 'warn', REJECTED: 'bad', PENDING: 'warn' }[k] || '' })), format: v => F.num(v) })), card('Total neto por marca', G.ui.chart.hbar({ items: Object.entries(U.groupBy(ok, 'brand_id')).map(([k, v]) => ({ label: G.brandName(k), value: R(U.sum(v, d => sign(d) * d.total)) })), format: money }))));
  }

  G.register({
    code: 'FAC', name: 'Comprobantes y guías', phase: 1, group: 'Finanzas',
    screens: [
      { code: 'FAC-01', name: 'Comprobantes', render: fac01 },
      { code: 'FAC-02', name: 'Emitir desde el pedido', render: fac02 },
      { code: 'FAC-03', name: 'Emisión directa', render: fac03 },
      { code: 'FAC-04', name: 'Detalle del comprobante', render: fac04 },
      { code: 'FAC-05', name: 'Nota de crédito', render: fac05 },
      { code: 'FAC-06', name: 'Nota de débito', render: fac06 },
      { code: 'FAC-07', name: 'Cola de envío', render: fac07 },
      { code: 'FAC-08', name: 'Resumen diario y bajas', render: fac08 },
      { code: 'FAC-09', name: 'Guía de remisión', render: fac09 },
      { code: 'FAC-10', name: 'Series', render: fac10 },
      { code: 'FAC-11', name: 'Plantillas impresas', render: fac11 },
      { code: 'FAC-12', name: 'Comprobantes del período', render: fac12 },
    ],
  });

  /* ---------- API pública ---------- */
  G.fac = { issue, issueFromOrder, send, sendGuide, processQueue, update, creditNote, debitNote, weightCreditNote, voidDoc, reissue, issueGuide, voidGuide, createDailySummary, sendSummary, querySummary, credited, seriesFor, assertSeries, assertReady, splitIgv: (t, aff) => G.tax.split(t, true, aff || '10'), ose, clock, advance: m => { fac.offset += m; return clock(); }, resetClock: () => { fac.offset = 0; }, printNode, pendingOrders, open: openDoc, openGuide, CAT09, CAT10, CAT20, docNo, valid };

  /* comprobantes emitidos por otros módulos (POS, DEL): FAC completa el adquirente y los envía por la cola */
  G.events.on('document.issued', p => {
    if (fac._issuing) return;
    const d = D.get('sales_documents', p.document_id); if (!d) return;
    const b = brandOf(d.brand_id);
    D.update('sales_documents', d.id, { issued_at: d.issued_at || clock(), brand_name: b.name, brand_logo: 'logo-' + b.code }, { silent: true });
    if (d.sunat_status === 'PENDING' && !d.send_attempts) setTimeout(() => { try { const x = D.get('sales_documents', d.id); if (x && x.sunat_status === 'PENDING' && !x.send_attempts && x.status !== 'VOIDED') send(x); } catch (e) { /* queda en la cola (FAC-07) */ } }, 0);
  });

  /* ---------- búsqueda, escáner y alertas ---------- */
  G.searchProviders.push(q => {
    const s = q.trim().toUpperCase(); if (s.length < 3) return [];
    const out = [];
    for (const d of D.all('sales_documents')) { if (out.length >= 6) break; if ((d.full_number || '').includes(s) || (s.length >= 5 && (d.customer_name || '').toUpperCase().includes(s)) || (s.length >= 8 && d.customer_doc_number === s)) out.push({ label: `${TYPE_SHORT[d.doc_type]} ${docNo(d)}`, sub: `${d.customer_name} · ${money(d.total)} · ${G.ui.statusLabel(d.sunat_status)}`, go: () => G.go('FAC-04', { id: d.id }) }); }
    for (const g of D.all('dispatch_guides')) if ((g.full_number || '').includes(s) && out.length < 8) out.push({ label: `Guía ${g.full_number}`, sub: catName(CAT20, g.transfer_reason_code), go: () => { G.go('FAC-09'); openGuide(g.id); } });
    return out;
  });
  G.scanHandlers.push(code => { const d = D.find('sales_documents', x => x.full_number === code); if (d) return () => G.go('FAC-04', { id: d.id }); const g = D.find('dispatch_guides', x => x.full_number === code); return g ? () => { G.go('FAC-09'); openGuide(g.id); } : null; });
  G.alertProviders.push(() => {
    const out = [];
    const rej = D.where('sales_documents', d => d.sunat_status === 'REJECTED' && !d.reissued_by && d.status !== 'VOIDED');
    if (rej.length) out.push({ module: 'FAC', title: `${rej.length} comprobante(s) rechazado(s) por SUNAT`, detail: rej.slice(0, 3).map(d => `${docNo(d)} (${d.sunat_code})`).join(', ') + ': reemítelos con un número nuevo.', tone: 'bad', go: () => G.go('FAC-07') });
    const man = D.where('sales_documents', d => d.sunat_status === 'PENDING' && d.needs_review && d.status !== 'VOIDED');
    if (man.length) out.push({ module: 'FAC', title: `${man.length} comprobante(s) agotaron los reintentos al OSE`, detail: 'RN-FAC-06: requieren reenvío manual en la cola de envío.', tone: 'bad', go: () => G.go('FAC-07') });
    const late = pendingOrders().filter(o => o.delivered_at && T.diffMin(G.date.now(), o.delivered_at) > 1440);
    if (late.length) out.push({ module: 'FAC', title: `${late.length} pedido(s) entregado(s) hace más de 24 h sin comprobante`, detail: late.slice(0, 3).map(o => o.number).join(', '), tone: 'warn', go: () => G.go('FAC-02') });
    return out;
  });

  /* ---------- indicadores (TAB) ---------- */
  const docsIn = (p, pred) => D.where('sales_documents', d => d.issue_date >= (p.from || '0000') && d.issue_date <= (p.to || '9999') && (!p.brand || d.brand_id === p.brand) && (!p.site || d.establishment_id === p.site) && pred(d));
  G.kpiCalc['KPI-FAC-01'] = p => { const sent = docsIn(p, d => d.sunat_status !== 'PENDING' && (d.send_attempts || 0) > 0 || ['ACCEPTED', 'OBSERVED', 'REJECTED'].includes(d.sunat_status)); const rej = sent.filter(d => d.sunat_status === 'REJECTED'); return { value: sent.length ? R(rej.length / sent.length * 100, 2) : 0, numerator: rej.length, denominator: sent.length }; };
  G.kpiCalc['KPI-FAC-02'] = p => { const now = G.date.now(); const n = docsIn(Object.assign({}, p, { from: null }), d => d.sunat_status === 'PENDING' && d.status !== 'VOIDED' && d.issued_at && T.diffMin(now, d.issued_at) > 1440).length; return { value: n, numerator: n, denominator: null }; };
  G.kpiCalc['KPI-FAC-03'] = p => { const nc = U.sum(docsIn(p, d => d.doc_type === 'CREDIT_NOTE' && valid(d)), d => d.total); const s = U.sum(docsIn(p, d => ['INVOICE', 'RECEIPT'].includes(d.doc_type) && valid(d)), d => d.total); return { value: s ? R(nc / s * 100, 2) : 0, numerator: R(nc), denominator: R(s) }; };
  G.kpiCalc['KPI-FAC-04'] = p => { const m = docsIn(p, d => ['ACCEPTED', 'OBSERVED'].includes(d.sunat_status) && d.issued_at && d.accepted_at).map(d => T.diffMin(d.accepted_at, d.issued_at)).filter(x => x >= 0).sort((a, b) => a - b); if (!m.length) return 0; const mid = Math.floor(m.length / 2); return { value: R(m.length % 2 ? m[mid] : (m[mid - 1] + m[mid]) / 2, 1), numerator: null, denominator: m.length }; };
  G.kpiCalc['KPI-FAC-05'] = p => {
    const ix = index(); const now = G.date.now();
    const del = D.where('sales_orders', o => ['DELIVERED', 'CLOSED'].includes(o.status) && o.delivered_at && o.delivered_at.slice(0, 10) >= (p.from || '0000') && o.delivered_at.slice(0, 10) <= (p.to || '9999') && (!p.brand || o.brand_id === p.brand) && (!p.site || o.establishment_id === p.site));
    const miss = del.filter(o => o.requested_doc_type !== 'NONE' && T.diffMin(now, o.delivered_at) > 1440 && !(ix.byOrder.get(o.id) || []).some(valid));
    return { value: del.length ? R(miss.length / del.length * 100, 2) : 0, numerator: miss.length, denominator: del.length };
  };

  /* =====================================================================
     Datos de ejemplo (orden 30)
     ===================================================================== */
  G.seed(30, function seedFAC() {
    const ins = (t, r) => D.insert(t, r, { silent: true });
    const r = U.rng(3030);
    // series: las de marca valen para ambos locales (D-FAC-02); notas de débito por marca
    for (const s of D.all('document_series')) if (s.brand_id && ['INVOICE', 'RECEIPT', 'CREDIT_NOTE'].includes(s.doc_type)) s.all_sites = true;
    D.all('brands').filter(b => b.company_id === 'co-dg').forEach((b, i) => { const n = i + 1; for (const [ap, L] of [['INVOICE', 'F'], ['RECEIPT', 'B']]) if (!D.get('document_series', `se-${L}D0${n}`)) ins('document_series', { id: `se-${L}D0${n}`, company_id: 'co-dg', establishment_id: 'es-L1', brand_id: b.id, doc_type: 'DEBIT_NOTE', series: `${L}D0${n}`, next_number: 1, is_electronic: true, status: 'ACTIVE', applies_to: ap, all_sites: true }); });
    // plantillas por marca
    const LEG = { 'br-DG': 'Carnes de granja · Conserve refrigerado de 0 a 4 °C\nPedidos por WhatsApp +51 987 650 101', 'br-M2': 'Cortes al vacío · Conserve refrigerado de 0 a 4 °C', 'br-M3': 'Embutidos artesanales · Consumir antes de la fecha indicada', 'br-M4': 'Despensa y consumo diario', 'br-M5': 'Café de altura, frutos secos y mermeladas artesanales' };
    for (const b of D.all('brands')) if (LEG[b.id]) { b.print_legends = LEG[b.id]; b.print_show_logo = true; }
    // correlativo de pedidos al día (el historial sembrado numera a mano)
    const maxOrd = Math.max(0, ...D.all('sales_orders').map(o => Number(String(o.number).replace(/\D/g, '')) || 0));
    if ((D.seq['DG:PED'] || 0) < maxOrd) D.seq['DG:PED'] = maxOrd;
    // comprobantes históricos: hora de emisión, aceptación y CDR
    const ords = new Map(D.all('sales_orders').map(o => [o.id, o]));
    const docs = D.all('sales_documents');
    const addrBy = new Map(D.where('customer_addresses', a => a.is_default).map(a => [a.customer_id, a]));
    for (const d of docs) {
      const o = d.order_id ? ords.get(d.order_id) : null;
      d.issued_at = d.issued_at || (o && o.delivered_at ? o.delivered_at.slice(0, 16) + ':00' : d.issue_date + 'T19:00:00');
      const b = brandOf(d.brand_id); d.brand_name = b.name; d.brand_logo = 'logo-' + b.code;
      const addr = addrBy.get(d.customer_id); d.buyer_address = addr ? addr.address_line : null;
      if (d.sunat_status === 'ACCEPTED') { const lag = 1 + Math.floor(r() * 9); d.sent_at = T.add(d.issued_at, lag - 0.5); d.accepted_at = T.add(d.issued_at, lag); d.sunat_code = '0'; d.sunat_message = `La ${G.docTypeName(d.doc_type)} número ${docNo(d)}, ha sido aceptada.`; d.cdr_hash = hash('CDR' + d.full_number); if (d.issue_date >= '2026-10-01') ins('einvoice_submissions', { document_id: d.id, guide_id: null, summary_id: null, attempt_no: 1, provider: 'FAKE', requested_at: d.sent_at, response_code: '0', result: 'ACCEPTED', message: d.sunat_message, duration_ms: 350 + Math.floor(r() * 500) }); }
    }
    // hoy: pendientes en reintento, uno observado y uno rechazado
    const today = docs.filter(d => d.issue_date === G.TODAY).sort(U.by('issued_at'));
    const setPending = (d, attempts, lastAt) => {
      Object.assign(d, { sunat_status: 'PENDING', sent_at: null, accepted_at: null, xml_hash: hash(d.full_number + d.total), cdr_hash: null, send_attempts: attempts, sunat_code: attempts ? '0109' : null, sunat_message: attempts ? 'El OSE no respondió en 30 s (servicio no disponible). Se reintentará.' : null, last_attempt_at: attempts ? lastAt : null });
      D.t.einvoice_submissions = (D.t.einvoice_submissions || []).filter(x => x.document_id !== d.id);
      let at = d.issued_at; const b = [1, 5, 15, 60, 240];
      for (let k = 1; k <= attempts; k++) { ins('einvoice_submissions', { document_id: d.id, attempt_no: k, provider: 'FAKE', requested_at: at, response_code: '0109', result: 'TIMEOUT', message: d.sunat_message, duration_ms: 30000 }); d.last_attempt_at = at; at = T.add(at, b[k - 1]); }
      d.next_retry_at = attempts && attempts < 5 ? at : null; d.needs_review = attempts >= 5;
    };
    today.slice(-4).forEach((d, i) => setPending(d, i === 3 ? 0 : i + 1));
    const obs = today[0], rej = today[1];
    if (obs) { obs.sunat_status = 'OBSERVED'; obs.sunat_code = '4287'; obs.sunat_message = 'El precio unitario ingresado difiere del calculado con el valor de venta (se acepta con observación).'; const s = D.find('einvoice_submissions', x => x.document_id === obs.id); if (s) { s.result = 'OBSERVED'; s.response_code = '4287'; s.message = obs.sunat_message; } }
    if (rej) { rej.sunat_status = 'REJECTED'; rej.sunat_code = '3105'; rej.sunat_message = 'El XML no contiene la dirección del punto de llegada o del establecimiento emisor.'; rej.accepted_at = null; rej.cdr_hash = null; rej.needs_review = true; const s = D.find('einvoice_submissions', x => x.document_id === rej.id); if (s) { s.result = 'REJECTED'; s.response_code = '3105'; s.message = rej.sunat_message; } }
    // ayer: uno que agotó los 5 intentos (revisión manual)
    const y = docs.filter(d => d.issue_date === G.date.add(G.TODAY, -1) && d.doc_type === 'RECEIPT').sort(U.by('issued_at'))[0];
    if (y) setPending(y, 5);
    // anulación por comunicación de baja (aceptada) y reemisión con la condición correcta
    const inv = docs.find(d => d.doc_type === 'INVOICE' && d.issue_date === '2026-10-09' && d.payment_terms === 'CASH');
    if (inv) {
      inv.status = 'VOIDED'; inv.void_reason = 'Factura emitida con el RUC de la sede equivocada del cliente; se reemitió.'; inv.voided_at = '2026-10-09T17:40:00'; inv.voided_by = 'Carmen Huamán Soto'; inv.sunat_status = 'VOIDED';
      const nd = G.docs.issue({ doc_type: 'INVOICE', brand_id: inv.brand_id, establishment_id: inv.establishment_id, customer_id: inv.customer_id, order_id: inv.order_id, lines: inv.lines.map(l => ({ variant_id: l.variant_id, description: l.description, qty: l.qty, uom_code: l.uom_code, unit_price: l.unit_price, igv_affectation: l.igv_affectation, total: l.total, cost: l.cost })), date: '2026-10-09', seller_id: inv.seller_id, accept: true, silent: true });
      Object.assign(nd, { issued_at: '2026-10-09T17:45:00', sent_at: '2026-10-09T17:46:00', accepted_at: '2026-10-09T17:46:30', sunat_code: '0', sunat_message: `La Factura número ${nd.full_number}, ha sido aceptada.`, brand_name: inv.brand_name, brand_logo: inv.brand_logo, buyer_address: inv.buyer_address });
      for (const p of D.all('payments')) for (const a of p.allocations || []) if (a.document_id === inv.id) a.document_id = nd.id;
      const s = ins('sunat_daily_summaries', { company_id: 'co-dg', summary_type: 'RA', reference_date: '2026-10-09', identifier: 'RA-20261009-1', ticket: '202613004517', status: 'ACCEPTED', sent_at: '2026-10-09T18:05:00', accepted_at: '2026-10-09T18:20:00' });
      ins('sunat_daily_summary_lines', { summary_id: s.id, document_id: inv.id, action: 'VOID', reason: inv.void_reason });
      ins('einvoice_submissions', { summary_id: s.id, attempt_no: 1, provider: 'FAKE', requested_at: '2026-10-09T18:05:00', response_code: '0', result: 'ACCEPTED', message: 'Ticket generado para RA-20261009-1', duration_ms: 640 });
    }
    // pedidos entregados o listos sin comprobante (FAC-02)
    let num = maxOrd;
    const mk = (cust, brand, lines, st2, dDate, deliveredAt, pm) => {
      num++; const c = D.get('customers', cust);
      const o = { id: 'so-F' + U.pad(num, 5), number: 'P-' + U.pad(num, 6), brand_id: brand, establishment_id: 'es-L1', channel: c.customer_type === 'PERSON' ? 'WHATSAPP' : 'B2B', customer_id: cust, address_id: null, seller_id: brand === 'br-DG' ? 'us-atorres' : 'us-cnunez', fulfillment: 'PICKUP', delivery_date: dDate, slot_id: 'ts-L1-1', slot_from: '09:00', slot_to: '13:00', requested_doc_type: c.doc_type === 'RUC' ? 'INVOICE' : 'RECEIPT', billing_customer_id: cust, payment_method_id: pm, status: st2, paid_amount: 0, discount_status: 'NONE', weight_diff_status: 'WITHIN_TOLERANCE', contact_phone: c.phone, zone_id: null, pickup_establishment_id: 'es-L1', notes: 'Recoge en el local', reschedule_count: 0, created_at: G.date.add(dDate, -1) + 'T16:20', confirmed_at: G.date.add(dDate, -1) + 'T16:31', delivered_at: deliveredAt, history: [], tenant: 'DG',
        lines: lines.map((x, k) => { const v = G.variant(x[0]); const pr = G.price.of(v.id, { brand_id: brand, channel: c.customer_type === 'PERSON' ? 'WHATSAPP' : 'B2B' }); const kg = pr.basis === 'KG'; return { id: `ol-F${num}-${k}`, variant_id: v.id, qty: x[1], unit_price: pr.price, list_price: pr.price, price_basis: pr.basis, price_list_id: pr.list_id, est_weight_kg: kg ? R(v.sale_mode === 'KG' ? x[1] : x[1] * v.nominal_weight_kg, 3) : null, tolerance_pct: v.weight_tolerance_pct, discount_pct: 0, discount_amount: 0, weighed_kg: kg ? x[2] : null, weight_source: kg ? 'SCALE' : null, final_amount: null, lot_id: null, cut_notes: null }; }) };
      G.orders.recalc(o);
      o.history = [{ at: o.created_at, from: null, to: 'DRAFT', user: 'Ana Torres Lazo' }, { at: o.confirmed_at, from: 'DRAFT', to: 'CONFIRMED', user: 'Ana Torres Lazo' }, { at: deliveredAt || G.TODAY + 'T10:00', from: 'READY', to: st2, user: 'Sistema' }];
      return ins('sales_orders', o);
    };
    mk('cu-B004', 'br-DG', [['va-DG-CUY-ENT', 6, 5.62], ['va-DG-CAL-1L', 4]], 'DELIVERED', G.TODAY, G.TODAY + 'T10:40', 'pm-TRANSFER');
    mk('cu-0031', 'br-DG', [['va-DG-CUY-ENT', 2, 1.96]], 'DELIVERED', G.TODAY, G.TODAY + 'T11:15', 'pm-YAPE');
    mk('cu-0077', 'br-M2', [['va-M2-BON-KG', 1.5, 1.542], ['va-M2-PAN-AHU', 1]], 'READY', G.TODAY, null, 'pm-CARD');
    mk('cu-0102', 'br-DG', [['va-DG-CON-ENT', 1, 1.71], ['va-DG-CHO-500', 2]], 'DELIVERED', G.date.add(G.TODAY, -1), G.date.add(G.TODAY, -1) + 'T12:05', 'pm-YAPE');
    // guías de remisión
    const hugo = D.find('users', u => u.role === 'REPARTIDOR' && u.name.startsWith('Hugo')) || {};
    const pedro = D.find('users', u => u.role === 'REPARTIDOR' && u.name.startsWith('Pedro')) || {};
    const carrier = D.find('suppliers', s => s.trade_name === 'Andinos Cargo (provincia)') || {};
    const mkG = (d, accept, at) => { const g = issueGuide(Object.assign({ send: false }, d)); g.issued_at = at; if (accept) { g.sunat_status = 'ACCEPTED'; g.send_attempts = 1; g.accepted_at = T.add(at, 2); g.sunat_code = '0'; g.sunat_message = `La guía de remisión ${g.full_number} ha sido aceptada.`; ins('einvoice_submissions', { guide_id: g.id, attempt_no: 1, provider: 'FAKE', requested_at: T.add(at, 1), response_code: '0', result: 'ACCEPTED', message: g.sunat_message, duration_ms: 540 }); } return g; };
    mkG({ date: '2026-10-08', reason_code: '04', transport_mode: '02', origin_establishment_id: 'es-L2', dest_establishment_id: 'es-L1', transfer_ref: 'TR-261008-01', vehicle_id: 've-BXR-871', driver_user_id: hugo.id, start_date: '2026-10-08', packages: 6, lines: [{ variant_id: 'va-DG-CAL-1L', qty: 48, weight_kg: 49.9 }, { variant_id: 'va-M4-CGA-1L', qty: 24, weight_kg: 25.1 }] }, true, '2026-10-08T07:30:00');
    mkG({ date: '2026-10-09', reason_code: '05', transport_mode: '02', origin_establishment_id: 'es-L1', recipient_customer_id: 'cu-B009', vehicle_id: 've-MTA-123', driver_user_id: pedro.id, start_date: '2026-10-09', packages: 2, lines: [{ variant_id: 'va-M5-CAF-250', qty: 12, weight_kg: 3.2 }, { variant_id: 'va-M5-MER-AGU', qty: 18, weight_kg: 5.9 }] }, true, '2026-10-09T09:10:00');
    const oB2B = D.all('sales_orders').find(o => o.channel === 'B2B' && o.delivery_date === G.TODAY && ['READY', 'IN_ROUTE', 'DELIVERED'].includes(o.status)) || D.all('sales_orders').find(o => o.channel === 'B2B' && o.status === 'CLOSED');
    if (oB2B) mkG({ date: G.TODAY, reason_code: '01', transport_mode: '02', origin_establishment_id: 'es-L1', order_id: oB2B.id, recipient_customer_id: oB2B.customer_id, vehicle_id: 've-BXR-871', driver_user_id: hugo.id, start_date: G.TODAY, packages: 1, brand_id: oB2B.brand_id, lines: oB2B.lines.map(l => ({ variant_id: l.variant_id, qty: l.qty, weight_kg: l.weighed_kg ?? l.est_weight_kg ?? R(l.qty * 0.5, 3) })) }, true, G.TODAY + 'T08:15:00');
    const oProv = D.all('sales_orders').find(o => o.status === 'CLOSED' && o.brand_id === 'br-DG' && o.delivery_date === G.date.add(G.TODAY, -1));
    if (oProv) { const g = mkG({ date: G.TODAY, reason_code: '01', transport_mode: '01', origin_establishment_id: 'es-L1', order_id: oProv.id, recipient_customer_id: 'cu-PROV1', dest_address: 'Agencia Andinos Cargo · Av. Parra 214, Arequipa', dest_ubigeo: '040101', carrier_supplier_id: carrier.id, start_date: G.TODAY, packages: 1, brand_id: 'br-DG', lines: [{ variant_id: 'va-DG-CUY-CNG', qty: 6, weight_kg: 5.3 }, { variant_id: 'va-EM-ISO-20', qty: 1, weight_kg: 1.2 }], notes: 'Envío a provincia en caja isotérmica con gel' }, false, G.TODAY + 'T09:05:00'); g.send_attempts = 0; }
  }, 'FAC');

  /* =====================================================================
     Pruebas de aceptación (CA-FAC-01 … CA-FAC-08)
     ===================================================================== */
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba ${code} y no hubo error.`); };
  const near = (a, b, msg) => { if (Math.abs(a - b) > 0.005) throw new Error(`${msg}: ${a} ≠ ${b}`); };
  const ruc20100070970 = () => D.get('customers', 'cu-TFAC1') || D.insert('customers', { id: 'cu-TFAC1', doc_type: 'RUC', doc_number: '20100070970', full_name: 'RESTAURANTE LA HUACA DEL SUR SAC', trade_name: 'La Huaca del Sur', customer_type: 'RESTAURANT', phone: '+51999111222', status: 'ACTIVE' }, { silent: true });
  const quickInvoice = (total, opts = {}) => issue(Object.assign({ doc_type: 'INVOICE', brand_id: 'br-DG', establishment_id: 'es-L1', customer_id: ruc20100070970().id, lines: [{ description: 'Cuy entero beneficiado', qty: 1, uom_code: 'NIU', unit_price: total, total }] }, opts));
  G.tests.push({ module: 'FAC', name: 'CA-FAC-01: factura F001 de S/ 236,00 → valor S/ 200,00, IGV S/ 36,00 y adquirente congelado', fn: async () => {
    const c = ruc20100070970();
    const o = G.orders.create({ customer_id: c.id, brand_id: 'br-DG', channel: 'B2B', fulfillment: 'PICKUP', pickup_establishment_id: 'es-L1', establishment_id: 'es-L1', delivery_date: G.TODAY, slot_id: 'ts-L1-1', payment_method_id: 'pm-TRANSFER', requested_doc_type: 'INVOICE', notes: 'Prueba', lines: [{ variant_id: 'va-DG-CAL-1L', qty: 10 }] });
    o.lines[0].unit_price = 23.6; G.orders.recalc(o); o.status = 'DELIVERED'; o.delivered_at = G.TODAY + 'T10:00:00';
    near(o.final_total, 236, 'Total final del pedido');
    const d = issueFromOrder(o.id);
    if (d.series !== 'F001') throw new Error('Serie ' + d.series);
    near(d.subtotal, 200, 'Valor de venta'); near(d.igv, 36, 'IGV'); near(d.total, 236, 'Total');
    D.update('customers', c.id, { full_name: 'OTRO NOMBRE SAC' }, { silent: true });
    const x = D.get('sales_documents', d.id);
    if (x.customer_name !== 'RESTAURANTE LA HUACA DEL SUR SAC' || x.customer_doc_number !== '20100070970') throw new Error('El adquirente no quedó congelado');
  } });
  G.tests.push({ module: 'FAC', name: 'CA-FAC-02: boleta de S/ 850 sin documento → RN-FAC-05; con DNI se emite', fn: async () => {
    const lines = [{ description: 'Cordero entero para evento', qty: 1, uom_code: 'NIU', unit_price: 850, total: 850 }];
    expectFail(() => issue({ doc_type: 'RECEIPT', brand_id: 'br-DG', establishment_id: 'es-L1', customer_id: 'cu-VARIOS', lines }), 'RN-FAC-05');
    const c = D.find('customers', x => x.doc_type === 'DNI' && x.doc_number);
    expectFail(() => issue({ doc_type: 'RECEIPT', brand_id: 'br-DG', customer_id: c.id, buyer: { doc_type: 'NONE', doc_number: null, name: c.full_name }, lines }), 'RN-FAC-05');
    const d = issue({ doc_type: 'RECEIPT', brand_id: 'br-DG', establishment_id: 'es-L1', customer_id: c.id, lines });
    if (d.customer_doc_number !== c.doc_number || d.series !== 'B001') throw new Error('No emitió con el DNI');
  } });
  G.tests.push({ module: 'FAC', name: 'CA-FAC-03: boleta aceptada de S/ 82,32 no cambia (RN-FAC-03); se corrige con nota BC01', fn: async () => {
    const c = D.find('customers', x => x.doc_type === 'DNI' && x.doc_number);
    const d = issue({ doc_type: 'RECEIPT', brand_id: 'br-DG', establishment_id: 'es-L1', customer_id: c.id, lines: [{ variant_id: 'va-DG-CUY-ENT', description: 'Cuy entero beneficiado · 1.960 kg (2 u)', qty: 1.96, uom_code: 'KGM', unit_price: 42, total: 82.32 }] });
    if (D.get('sales_documents', d.id).sunat_status !== 'ACCEPTED') throw new Error('La boleta no quedó aceptada');
    expectFail(() => update(d.id, { total: 78 }), 'RN-FAC-03');
    const nc = creditNote({ document_id: d.id, reason_code: '09', reason: 'Diferencia de peso reclamada', amount: 4.32 });
    if (nc.series !== 'BC01') throw new Error('Serie de la nota ' + nc.series);
    near(nc.total, 4.32, 'Nota'); near(credited(d.id), 4.32, 'Acreditado');
    near(D.get('sales_documents', d.id).total, 82.32, 'La boleta conserva su total');
  } });
  G.tests.push({ module: 'FAC', name: 'CA-FAC-04: factura de S/ 236 con nota de S/ 200; otra nota de S/ 50 → RN-FAC-08', fn: async () => {
    const f = quickInvoice(236);
    creditNote({ document_id: f.id, reason_code: '05', reason: 'Descuento por volumen acordado', amount: 200 });
    expectFail(() => creditNote({ document_id: f.id, reason_code: '05', reason: 'Otro descuento', amount: 50 }), 'RN-FAC-08');
    const ok = creditNote({ document_id: f.id, reason_code: '05', reason: 'Saldo exacto', amount: 36 }); near(ok.total, 36, 'Nota por el disponible');
  } });
  G.tests.push({ module: 'FAC', name: 'CA-FAC-05: OSE caído, 30 boletas del mostrador quedan pendientes y se aceptan solas al volver (reintentos 1, 5, 15 min)', fn: async () => {
    const prev = ose.mode; ose.mode = 'DOWN'; fac.offset = 0;
    try {
      const t0 = G.TODAY + 'T09:00:00'; const docs = [];
      for (let i = 0; i < 30; i++) docs.push(issue({ doc_type: 'RECEIPT', brand_id: ['br-DG', 'br-M2', 'br-M3', 'br-M4', 'br-M5'][i % 5], establishment_id: 'es-L1', counter: true, customer_id: 'cu-VARIOS', lines: [{ description: 'Venta de mostrador', qty: 1, uom_code: 'NIU', unit_price: 20 + i, total: 20 + i }] }, { at: t0 }));
      if (docs.some(d => d.series !== 'B010')) throw new Error('No usó la serie B010 del mostrador');
      const all = () => docs.map(d => D.get('sales_documents', d.id));
      if (!all().every(d => d.sunat_status === 'PENDING' && d.send_attempts === 1)) throw new Error('No quedaron pendientes tras el primer intento');
      if (!all().every(d => printNode(d, '80'))) throw new Error('No se imprimen');
      if (all()[0].next_retry_at !== T.add(t0, 1)) throw new Error('Primer reintento no es a 1 min: ' + all()[0].next_retry_at);
      processQueue(T.add(t0, 1)); if (!all().every(d => d.send_attempts === 2 && d.next_retry_at === T.add(t0, 6))) throw new Error('Segundo reintento no programado a los 5 min');
      processQueue(T.add(t0, 6)); if (!all().every(d => d.send_attempts === 3 && d.next_retry_at === T.add(t0, 21))) throw new Error('Tercer reintento no programado a los 15 min');
      ose.mode = 'ONLINE';
      processQueue(T.add(t0, 21));
      if (!all().every(d => d.sunat_status === 'ACCEPTED' && d.send_attempts === 4)) throw new Error('No pasaron a aceptadas al volver el servicio');
      if (D.where('einvoice_submissions', s => docs.some(d => d.id === s.document_id)).length !== 120) throw new Error('No se registraron los 4 intentos de cada boleta');
    } finally { ose.mode = prev; }
  } });
  G.tests.push({ module: 'FAC', name: 'CA-FAC-06: transferencia de 20 kg de chorizo L1→L2 con motivo 01 → RN-FAC-11; con 04, vehículo y conductor se emite', fn: async () => {
    const drv = D.find('users', u => u.role === 'REPARTIDOR');
    const base = { transport_mode: '02', origin_establishment_id: 'es-L1', dest_establishment_id: 'es-L2', transfer_ref: 'TR-PRUEBA-01', vehicle_id: 've-BXR-871', driver_user_id: drv.id, packages: 2, lines: [{ variant_id: 'va-M3-CHO-1K', qty: 20, weight_kg: 20 }] };
    expectFail(() => issueGuide(Object.assign({ reason_code: '01' }, base)), 'RN-FAC-11');
    expectFail(() => issueGuide(Object.assign({}, base, { reason_code: '04', vehicle_id: null })), 'RN-FAC-11');
    let fired = null; G.events.on('guide.issued', p => { fired = p; });
    const g = issueGuide(Object.assign({ reason_code: '04' }, base));
    if (g.series !== 'T001' || g.gross_weight_kg !== 20 || g.transfer_reason_code !== '04') throw new Error('Guía incorrecta');
    if (!fired || fired.guide_id !== g.id) throw new Error('No emitió guide.issued');
  } });
  G.tests.push({ module: 'FAC', name: 'CA-FAC-07: la serie B002 de la Marca 2 no emite boletas de Don Guando (RN-FAC-02)', fn: async () => {
    expectFail(() => issue({ doc_type: 'RECEIPT', brand_id: 'br-DG', establishment_id: 'es-L1', series: 'B002', customer_id: 'cu-VARIOS', lines: [{ description: 'Cuy', qty: 1, unit_price: 42, total: 42 }] }), 'RN-FAC-02');
    const d = issue({ doc_type: 'RECEIPT', brand_id: 'br-M2', establishment_id: 'es-L1', series: 'B002', customer_id: 'cu-VARIOS', lines: [{ description: 'Bondiola', qty: 1, unit_price: 38, total: 38 }] });
    if (d.series !== 'B002') throw new Error('No emitió con B002 para la Marca 2');
  } });
  G.tests.push({ module: 'FAC', name: 'CA-FAC-08: líneas por S/ 236,00 y cabecera de S/ 240,00 → el primer intento de envío se rechaza con RN-FAC-01', fn: async () => {
    const d = issue({ doc_type: 'INVOICE', brand_id: 'br-DG', establishment_id: 'es-L1', customer_id: ruc20100070970().id, lines: [{ description: 'Pedido B2B', qty: 1, unit_price: 236, total: 236 }] }, { send: false });
    if (d.send_attempts) throw new Error('No debía enviarse aún');
    update(d.id, { total: 240 });
    expectFail(() => send(d.id), 'RN-FAC-01');
    if (D.where('einvoice_submissions', s => s.document_id === d.id).length) throw new Error('Registró un intento con la cabecera descuadrada');
  } });
})();
