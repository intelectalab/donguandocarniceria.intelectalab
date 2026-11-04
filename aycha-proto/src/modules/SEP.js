/* =====================================================================
   SEP · Separación de una marca a otro RUC o a otro sistema (Fase 4)
   Asistente auditado: destino y fecha de corte (mes cerrado), validaciones
   previas PASS/WARN/FAIL, catálogo, precios y series, stock por lote con
   traspaso (factura al costo promedio + guía motivo venta), clientes,
   pedidos abiertos y cuentas por cobrar, canales (WhatsApp, web, anuncios),
   usuarios y locales, aprobación por otra persona, ejecución por elemento
   con reintento, paquete de exportación con huella SHA-256, acta e
   historia de empresas de la marca. Nada del histórico se reescribe.
   Disparadores: RN-SEP-05 (empresa vigente en sales_documents) y RN-SEP-06
   (marca separada en sales_orders). Expone G.sep.
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, toast, form, tabs, pills } = G.ui;
  const U = G.util, F = G.fmt, D = G.db;
  const R = (n, d = 2) => U.round(n, d);
  const S = G.sep = G.sep || {};
  const T_SEP = 'brand_separations', T_CHK = 'brand_separation_checks', T_IT = 'brand_separation_items', T_HIS = 'brand_company_history';
  const now = () => G.date.now();
  const me = () => G.ctx.userId();
  const meName = () => G.ctx.userName();
  const coOf = id => id ? (D.get('companies', id) || null) : null;
  const coName = id => { const c = coOf(id); return c ? c.legal_name : (id || '—'); };
  const coRuc = id => (coOf(id) || {}).ruc || '—';
  const monthEnd = d => G.date.add(G.date.addMonths(G.date.month(d), 1), -1);
  const isMonthEnd = d => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d === monthEnd(d);
  const brandOf = id => D.get('brands', id) || {};
  const swatch = id => h('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: brandOf(id).primary_color || 'var(--primary)', marginRight: '6px', verticalAlign: 'baseline' } });
  const brandLbl = id => h('span', null, swatch(id), G.brandName(id));
  const unitOf = v => v && v.sale_mode === 'KG' ? 'kg' : 'u';
  const qtyTxt = (q, v) => q === null || q === undefined ? '—' : G.fmt.num(q, v && v.sale_mode === 'KG' ? 3 : (Math.abs(q % 1) > 0.0005 ? 3 : 0)) + ' ' + unitOf(v);
  const isoMax = (a, b) => (a > b ? a : b);

  /* ------------------------------------------------------------------
     Catálogos del módulo
     ------------------------------------------------------------------ */
  const DEST = [['OTHER_RUC', 'Otro RUC del tenant'], ['OTHER_TENANT', 'Otra empresa en Aycha (otro tenant)'], ['OTHER_SYSTEM', 'Otro sistema']];
  const destName = t => (DEST.find(x => x[0] === t) || [t, t])[1];
  const ST = { DRAFT: ['Borrador', ''], VALIDATED: ['Validada', 'info'], APPROVED: ['Aprobada', 'ok'], EXECUTING: ['En ejecución', 'info'], COMPLETED: ['Completada', 'ok'], FAILED: ['Fallida', 'bad'], CANCELLED: ['Cancelada', ''] };
  const stBadge = s => badge((ST[s] || [s])[0], (ST[s] || [s, ''])[1]);
  const IST = { PENDING: ['Pendiente', 'warn'], DONE: ['Hecho', 'ok'], FAILED: ['Falló', 'bad'], EXCLUDED: ['Excluido', ''] };
  const itBadge = s => badge((IST[s] || [s])[0], (IST[s] || [s, ''])[1]);
  const resBadge = r => badge(r, { PASS: 'ok', WARN: 'warn', FAIL: 'bad' }[r] || '');
  const LIVE = ['DRAFT', 'VALIDATED', 'APPROVED', 'EXECUTING', 'FAILED'];
  const TYPES = {
    SERIES_NEW: ['Serie nueva del destino', 10], PRODUCT: ['Producto y presentaciones', 20], PRICE_LIST: ['Lista de precios', 25], STOCK: ['Stock por lote', 30],
    CUSTOMERS: ['Clientes', 40], ORDER: ['Pedido abierto', 50], RECEIVABLE: ['Cuenta por cobrar', 60], CHANNEL: ['Canal de mensajería', 70], WEB_STORE: ['Tienda web', 72],
    AD_ACCOUNT: ['Cuenta de anuncios', 74], CASH_ACCOUNT: ['Caja o pasarela', 76], USER: ['Usuario', 80], WAREHOUSE: ['Almacén', 85], SERIES_ORIGIN: ['Serie de la marca en el origen', 90],
  };
  const typeName = t => (TYPES[t] || [t])[0];
  const ACTS = {
    SERIES_NEW: [['CREATE', 'Crear en el destino']],
    PRODUCT: [['MOVE', 'Mover'], ['COPY', 'Copiar'], ['EXPORT_ONLY', 'Solo exportar']],
    PRICE_LIST: [['MOVE', 'Mover'], ['COPY', 'Copiar'], ['EXPORT_ONLY', 'Solo exportar']],
    STOCK: [['TRANSFER', 'Traspaso con comprobante y guía'], ['EXPORT_ONLY', 'Solo exportar'], ['LEAVE', 'Dejar en el origen']],
    CUSTOMERS: [['SHARED', 'Compartidos (no se copian)'], ['EXPORT', 'Exportar con consentimiento']],
    ORDER: [['KEEP', 'Mantener y facturar con la empresa nueva'], ['CANCEL_NOTIFY', 'Cancelar con aviso y exportar'], ['EXPORT', 'Solo exportar']],
    RECEIVABLE: [['KEEP_ORIGIN', 'Queda en el origen'], ['ASSIGN', 'Ceder al destino']],
    CHANNEL: [['KEEP_INBOX', 'Sigue en la bandeja con sus chats'], ['MIGRATE', 'Migrar a la otra cuenta (proveedor oficial)'], ['DISCONNECT', 'Desconectar y exportar historial']],
    WEB_STORE: [['REASSIGN', 'Reasignar a la empresa nueva'], ['DISCONNECT', 'Desconectar']],
    AD_ACCOUNT: [['REASSIGN', 'Reasignar a la empresa nueva'], ['DISCONNECT', 'Desconectar']],
    CASH_ACCOUNT: [['REASSIGN', 'Reasignar a la empresa nueva'], ['DISCONNECT', 'Desconectar']],
    USER: [['KEEP', 'Mantener'], ['REMOVE_SCOPE', 'Quitar la marca de su alcance'], ['MOVE', 'Mover al destino']],
    WAREHOUSE: [['KEEP', 'Mantener (compartido)'], ['MOVE', 'Mover al destino']],
    SERIES_ORIGIN: [['CLOSE', 'Cerrar en el origen'], ['KEEP', 'Mantener (notas de comprobantes anteriores)']],
  };
  /** acciones válidas según el destino (RN-SEP-14, RN-SEP-15, RN-SEP-17) */
  S.actionsFor = function (type, dest) {
    const all = ACTS[type] || [];
    const same = dest === 'OTHER_RUC';
    const deny = {
      CUSTOMERS: same ? ['EXPORT'] : ['SHARED'],
      ORDER: same ? ['CANCEL_NOTIFY', 'EXPORT'] : ['KEEP'],
      CHANNEL: same ? ['MIGRATE', 'DISCONNECT'] : dest === 'OTHER_TENANT' ? ['KEEP_INBOX', 'DISCONNECT'] : ['KEEP_INBOX', 'MIGRATE'],
      PRODUCT: same ? ['COPY'] : dest === 'OTHER_SYSTEM' ? ['COPY'] : [],
      PRICE_LIST: same ? ['COPY'] : dest === 'OTHER_SYSTEM' ? ['COPY'] : [],
    }[type] || [];
    return all.filter(a => !deny.includes(a[0]));
  };
  const actName = (type, a) => ((ACTS[type] || []).find(x => x[0] === a) || [a, a || '—'])[1];
  const CHECKS = [
    ['CUTOFF_MONTH_END', 'Fecha de corte al último día del mes', 'RN-SEP-01'],
    ['CUTOFF_PERIOD_CLOSED', 'Período del corte cerrado en la empresa de origen', 'RN-SEP-01'],
    ['DESTINATION_COHERENT', 'Destino coherente', 'RN-SEP-03'],
    ['NO_ORDERS_IN_PREPARATION', 'Sin pedidos de la marca en preparación o en ruta', 'RN-SEP-15'],
    ['NO_OPEN_ROUTES', 'Sin rutas de reparto abiertas con pedidos de la marca', 'RN-SEP-15'],
    ['DOCUMENTS_SENT', 'Comprobantes de la marca enviados a la SUNAT', 'RN-SEP-05'],
    ['DOCS_AFTER_CUTOFF', 'Comprobantes posteriores al corte con la empresa de origen', 'RN-SEP-05'],
    ['DEST_SERIES_OSE', 'Series y OSE del destino', 'RN-SEP-05'],
    ['STOCK_COUNTED', 'Conteo de stock reciente en los almacenes de la marca', 'RN-SEP-13'],
    ['STOCK_ITEMS_VALID', 'Elementos de stock con cantidad y acción', 'RN-SEP-12'],
    ['RECEIVABLES_DECISION', 'Decisión sobre cuentas por cobrar', 'RN-SEP-16'],
    ['WHATSAPP_DECISION', 'Acción para cada número de WhatsApp', 'RN-SEP-17'],
    ['USERS_DECISION', 'Usuarios con alcance en la marca', 'RN-SEP-08'],
    ['CONSIGNMENT_SETTLED', 'Consignación de la marca liquidada', 'RN-SEP-13'],
    ['CUSTOMERS_CONSENT', 'Clientes a exportar con consentimiento', 'RN-SEP-14'],
  ];
  const IN_PROCESS = ['IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE'];

  /* ------------------------------------------------------------------
     SHA-256 síncrono (huella del paquete y del acta)
     ------------------------------------------------------------------ */
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  S.sha256 = function (str) {
    const bytes = new TextEncoder().encode(String(str));
    const l = bytes.length, total = ((l + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total); buf.set(bytes); buf[l] = 0x80;
    const dv = new DataView(buf.buffer); dv.setUint32(total - 4, (l * 8) >>> 0); dv.setUint32(total - 8, Math.floor(l / 536870912));
    let Hh = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const W = new Uint32Array(64); const rr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let i = 0; i < total; i += 64) {
      for (let t = 0; t < 16; t++) W[t] = dv.getUint32(i + t * 4);
      for (let t = 16; t < 64; t++) { const x = W[t - 15], y = W[t - 2]; W[t] = (W[t - 16] + (rr(x, 7) ^ rr(x, 18) ^ (x >>> 3)) + W[t - 7] + (rr(y, 17) ^ rr(y, 19) ^ (y >>> 10))) | 0; }
      let [a, b, c, d, e, f, g, hh] = Hh;
      for (let t = 0; t < 64; t++) { const t1 = (hh + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t]) | 0; const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0; hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
      Hh = [Hh[0] + a, Hh[1] + b, Hh[2] + c, Hh[3] + d, Hh[4] + e, Hh[5] + f, Hh[6] + g, Hh[7] + hh].map(x => x | 0);
    }
    return Hh.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  };
  const byteLen = s => new TextEncoder().encode(s).length;
  const fmtBytes = n => n >= 1048576 ? F.num(n / 1048576, 2) + ' MB' : F.num(n / 1024, 1) + ' KB';

  /* ------------------------------------------------------------------
     Empresas emisoras por vigencia (brand_company_history) · RN-SEP-04/05
     ------------------------------------------------------------------ */
  S.history = brand => D.where(T_HIS, r => r.brand_id === brand && r.status !== 'VOIDED').sort(U.by('valid_from'));
  /** empresa que emite por la marca en esa fecha; null si la marca ya no emite en este tenant */
  S.companyFor = function (brand, date = G.TODAY) {
    const d = String(date || G.TODAY).slice(0, 10);
    const rows = S.history(brand);
    const r = rows.find(x => x.valid_from <= d && (!x.valid_to || x.valid_to >= d));
    if (r) return r.company_id;
    if (rows.length && rows[rows.length - 1].valid_to && d > rows[rows.length - 1].valid_to) return null;
    const b = D.get('brands', brand); return (b && b.company_id) || 'co-dg';
  };
  /** agrega una vigencia validando que no se cruce con otra (RN-SEP-04) */
  S.addHistory = function (row, opts = {}) {
    const rows = S.history(row.brand_id).filter(x => x.id !== row.id);
    const to = row.valid_to || '9999-12-31';
    const cross = rows.find(x => x.valid_from <= to && (x.valid_to || '9999-12-31') >= row.valid_from);
    if (cross) G.fail('RN-SEP-04', `La vigencia ${F.date(row.valid_from)} – ${row.valid_to ? F.date(row.valid_to) : 'sin fin'} de ${G.brandName(row.brand_id)} se cruza con la de ${coName(cross.company_id)} (${F.date(cross.valid_from)} – ${cross.valid_to ? F.date(cross.valid_to) : 'sin fin'}). Cierra la vigencia anterior primero.`);
    const c = coOf(row.company_id) || {};
    return D.insert(T_HIS, Object.assign({ company_name: c.legal_name || null, ruc: c.ruc || null, status: 'ACTIVE' }, row), { silent: !!opts.silent });
  };
  S.closeHistory = function (brand, validTo, opts = {}) {
    const open = S.history(brand).find(x => !x.valid_to || x.valid_to > validTo);
    if (open) D.update(T_HIS, open.id, { valid_to: validTo, closed_by_separation_id: opts.separation_id || null }, { silent: !!opts.silent });
    return open;
  };
  /** serie activa del tipo para la marca que pertenece a la empresa indicada */
  S.seriesFor = function (docType, brand, company, appliesTo) {
    const s = D.find('document_series', x => x.doc_type === docType && x.brand_id === brand && x.status === 'ACTIVE' && (x.company_id || 'co-dg') === company && (!appliesTo || !x.applies_to || x.applies_to === appliesTo));
    return s ? s.series : null;
  };
  /**
   * RN-SEP-05: desde el día siguiente al corte, los comprobantes de la marca se emiten con la empresa vigente
   * a su fecha (y sus series); con el RUC anterior se rechazan. Las notas siguen la empresa del comprobante que corrigen.
   * Devuelve el id de la empresa que corresponde.
   */
  S.assertDocCompany = function ({ brand_id, date, company_id, series, related_document_id, doc_type }) {
    if (!brand_id) return company_id || 'co-dg';
    const d = String(date || G.TODAY).slice(0, 10);
    const rel = related_document_id ? D.get('sales_documents', related_document_id) : null;
    const expected = rel ? (rel.company_id || 'co-dg') : S.companyFor(brand_id, d);
    const b = brandOf(brand_id);
    if (!expected) G.fail('RN-SEP-05', `${G.brandName(brand_id)} se separó de este tenant el ${F.date(b.separated_at)}: ya no emite comprobantes aquí (el histórico anterior al corte se conserva).`);
    if (company_id && company_id !== expected) G.fail('RN-SEP-05', `El comprobante de ${G.brandName(brand_id)} del ${F.date(d)} se emite con ${coName(expected)} (RUC ${coRuc(expected)}); con ${coName(company_id)} (RUC ${coRuc(company_id)}) se rechaza.${rel ? ' Las notas siguen la empresa del comprobante que corrigen.' : ''}`);
    if (series) {
      const s = D.find('document_series', x => x.series === series);
      if (s && (s.company_id || 'co-dg') !== expected) G.fail('RN-SEP-05', `La serie ${series} es de ${coName(s.company_id || 'co-dg')} (RUC ${coRuc(s.company_id || 'co-dg')}); desde el ${F.date(G.date.add(S.cutoffOf(brand_id) || d, 1))} ${G.brandName(brand_id)} emite con ${coName(expected)}${doc_type ? ' y la serie ' + (S.seriesFor(doc_type, brand_id, expected) || '(sin serie)') : ''}.`);
    }
    return expected;
  };
  S.cutoffOf = brand => { const b = brandOf(brand); const s = b.separation_id && D.get(T_SEP, b.separation_id); return s ? s.cutoff_date : null; };
  /** RN-SEP-06: una marca separada a otro tenant o a otro sistema no recibe pedidos nuevos */
  S.assertOrderBrand = function (brand_id) {
    const b = D.get('brands', brand_id); if (!b || b.status !== 'SEPARATED') return true;
    const sep = b.separation_id ? D.get(T_SEP, b.separation_id) : null;
    if (!sep || sep.dest_type !== 'OTHER_RUC') G.fail('RN-SEP-06', `${G.brandName(brand_id)} se separó ${sep ? 'a ' + destName(sep.dest_type).toLowerCase() + ' (' + (sep.dest_system_name || sep.dest_tenant_name || sep.dest_legal_name || '') + ')' : ''} con corte al ${F.date(sep ? sep.cutoff_date : b.separated_at)}: ya no recibe pedidos nuevos en este tenant.`);
    return true;
  };

  /* ---------- disparadores sobre comprobantes y pedidos ---------- */
  const coreIssue = G.docs.issue;
  G.docs.issue = function (d) {
    if (G._seeding || !d || !d.brand_id) return coreIssue.apply(this, arguments);
    const date = d.date || G.TODAY;
    const rel = d.related_document_id ? D.get('sales_documents', d.related_document_id) : null;
    const exp0 = rel ? (rel.company_id || 'co-dg') : S.companyFor(d.brand_id, date);
    let series = d.series;
    if (!series && !d.counter && exp0) series = S.seriesFor(d.doc_type, d.brand_id, exp0, d.applies_to) || null;
    if (!series) series = G.series.for(d.doc_type, d.brand_id, { counter: d.counter, appliesTo: d.applies_to });
    const exp = S.assertDocCompany({ brand_id: d.brand_id, date, company_id: d.company_id, series, related_document_id: d.related_document_id, doc_type: d.doc_type });
    S._expect = exp;
    try { return coreIssue.call(this, Object.assign({}, d, { series })); } finally { S._expect = null; }
  };
  if (G.fac && typeof G.fac.issue === 'function') {
    const facIssue = G.fac.issue;
    G.fac.issue = function (d, opts = {}) {
      if (!d || !d.brand_id) return facIssue.apply(this, arguments);
      const date = d.date || G.TODAY;
      const rel = d.related_document_id ? D.get('sales_documents', d.related_document_id) : null;
      const exp = rel ? (rel.company_id || 'co-dg') : S.companyFor(d.brand_id, date);
      if (exp === 'co-dg') { if (d.company_id && d.company_id !== exp) S.assertDocCompany({ brand_id: d.brand_id, date, company_id: d.company_id }); return facIssue.apply(this, arguments); }
      // FAC valida las series contra la empresa co-dg (ver NOTAS-SEP.md): la empresa nueva emite por el servicio común
      const series = d.series || S.seriesFor(d.doc_type, d.brand_id, exp, d.applies_to);
      S.assertDocCompany({ brand_id: d.brand_id, date, company_id: d.company_id, series, related_document_id: d.related_document_id, doc_type: d.doc_type });
      const doc = G.docs.issue({ doc_type: d.doc_type, brand_id: d.brand_id, establishment_id: d.establishment_id || 'es-L1', customer_id: d.customer_id || 'cu-VARIOS', order_id: d.order_id || null, lines: (d.lines || []).map(l => Object.assign({ igv_affectation: '10', uom_code: 'NIU', cost: 0 }, l)), date, series, related_document_id: d.related_document_id, note_reason_code: d.note_reason_code, note_reason: d.note_reason, payment_terms: d.payment_terms || 'CASH', credit_days: d.credit_days, seller_id: d.seller_id || me(), silent: !!opts.silent });
      if (opts.send !== false && typeof G.fac.send === 'function') { try { G.fac.send(doc); } catch (e) { if (!(e instanceof G.RuleError)) console.error(e); } }
      return D.get('sales_documents', doc.id);
    };
  }
  const coreCreate = G.orders.create;
  G.orders.create = function (d) {
    if (!G._seeding && d) { const v0 = (d.lines || [])[0] && G.variant(d.lines[0].variant_id); S.assertOrderBrand(d.brand_id || (v0 && v0.brand_id) || 'br-DG'); }
    return coreCreate.apply(this, arguments);
  };
  const dbIns = G.db.insert;
  G.db.insert = function (name, row, opts) {
    if (!G._seeding && row && row.brand_id) {
      if (name === 'sales_documents') {
        const exp = S._expect || S.assertDocCompany({ brand_id: row.brand_id, date: row.issue_date, company_id: row.company_id, series: row.series, related_document_id: row.related_document_id, doc_type: row.doc_type });
        if (exp && row.company_id !== exp) row = Object.assign({}, row, { company_id: exp });
      } else if (name === 'sales_orders') S.assertOrderBrand(row.brand_id);
    }
    return dbIns.call(this, name, row, opts);
  };

  /* ------------------------------------------------------------------
     Consultas de apoyo
     ------------------------------------------------------------------ */
  S.get = id => D.get(T_SEP, id);
  S.all = () => D.all(T_SEP).slice().sort(U.by('number', -1));
  S.items = (id, type) => D.where(T_IT, i => i.separation_id === id && (!type || i.item_type === type)).sort((a, b) => (a.seq - b.seq));
  S.checks = id => D.where(T_CHK, c => c.separation_id === id).sort((a, b) => a.seq - b.seq);
  S.live = brand => D.find(T_SEP, s => s.brand_id === brand && LIVE.includes(s.status) && !s.simulation);
  S.isLocked = sep => ['APPROVED', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(sep.status);
  S.brandVariants = brand => D.where('product_variants', v => v.brand_id === brand);
  S.openOrders = brand => D.where('sales_orders', o => o.brand_id === brand && o.status === 'CONFIRMED');
  S.ordersInProcess = brand => D.where('sales_orders', o => o.brand_id === brand && IN_PROCESS.includes(o.status));
  /** saldo según kardex a la fecha de corte: saldo actual menos movimientos posteriores (la carga inicial cuenta como saldo de apertura) */
  S.stockRows = function (brand, cutoff) {
    const vs = new Set(S.brandVariants(brand).map(v => v.id));
    const after = new Map();
    for (const m of D.all('stock_movements')) {
      if (!vs.has(m.variant_id) || m.source_type === 'INITIAL_LOAD' || String(m.moved_at).slice(0, 10) <= cutoff) continue;
      const k = `${m.warehouse_id}|${m.variant_id}|${m.lot_id || ''}`; after.set(k, R((after.get(k) || 0) + m.qty, 3));
    }
    return D.where('stock_balances', b => vs.has(b.variant_id) && (b.qty > 0.0005 || after.get(`${b.warehouse_id}|${b.variant_id}|${b.lot_id || ''}`)))
      .map(b => { const k = `${b.warehouse_id}|${b.variant_id}|${b.lot_id || ''}`; return { b, at_cut: Math.max(0, R(b.qty - (after.get(k) || 0), 3)), after: after.get(k) || 0 }; });
  };
  /** clientes que compraron la marca en los últimos sep_customer_history_months meses (RN-SEP-14) y su consentimiento (D-SEP-03) */
  S.customers = function (sep) {
    const months = Number(G.param('sep_customer_history_months') ?? 24);
    const from = G.date.addMonths(G.date.month(sep.cutoff_date), -(months - 1));
    const ids = new Set(D.where('sales_orders', o => o.brand_id === sep.brand_id && o.customer_id && o.status !== 'CANCELLED' && String(o.created_at).slice(0, 10) >= from && String(o.created_at).slice(0, 10) <= sep.cutoff_date).map(o => o.customer_id));
    const consented = new Set(D.where('contact_consents', c => c.purpose === 'MARKETING' && c.granted).map(c => c.customer_id));
    const list = [...ids].map(id => D.get('customers', id)).filter(Boolean).filter(c => !['cu-VARIOS'].includes(c.id));
    const withConsent = list.filter(c => c.marketing_opt_in || consented.has(c.id));
    return { from, months, all: list, withConsent, withoutConsent: list.filter(c => !withConsent.includes(c)) };
  };
  S.receivables = sep => D.where('sales_documents', d => d.brand_id === sep.brand_id && (d.balance || 0) > 0.005 && d.issue_date <= sep.cutoff_date && d.status !== 'VOIDED' && (d.company_id || 'co-dg') === sep.origin_company_id);
  S.channels = brand => D.where('messaging_channels', c => c.brand_id === brand);
  S.convCount = chId => D.where('conversations', c => c.channel_id === chId).length;
  S.brandUsers = brand => D.where('users', u => u.status === 'ACTIVE' && (u.brands || []).includes(brand));
  /** almacenes con stock de la marca y su participación */
  S.warehouseShare = function (brand) {
    const vs = new Set(S.brandVariants(brand).map(v => v.id));
    const m = new Map();
    for (const b of D.all('stock_balances')) { if (!(b.qty > 0)) continue; const r = m.get(b.warehouse_id) || { wh: b.warehouse_id, brandQty: 0, otherQty: 0, lots: 0 }; if (vs.has(b.variant_id)) { r.brandQty += b.qty * (b.avg_cost || 1); r.lots++; } else r.otherQty += b.qty * (b.avg_cost || 1); m.set(b.warehouse_id, r); }
    return [...m.values()].filter(r => r.brandQty > 0).map(r => Object.assign(r, { pct: R(r.brandQty / (r.brandQty + r.otherQty) * 100, 1) }));
  };
  /** ventas de la marca por empresa emisora (para el tablero y SEP-12): conserva la empresa con la que se emitió (RN-SEP-18) */
  S.salesByCompany = function ({ from = '0000', to = '9999', brand } = {}) {
    const m = new Map();
    for (const d of D.all('sales_documents')) {
      if (brand && d.brand_id !== brand) continue; if (d.issue_date < from || d.issue_date > to) continue;
      if (d.status === 'VOIDED' || d.sunat_status === 'VOIDED' || d.sunat_status === 'REJECTED' || d.doc_type === 'INTERNAL_NOTE') continue;
      const sign = d.doc_type === 'CREDIT_NOTE' ? -1 : 1; const co = d.company_id || 'co-dg';
      const r = m.get(co) || { company_id: co, company: coName(co), ruc: coRuc(co), docs: 0, subtotal: 0, total: 0 };
      r.docs++; r.subtotal = R(r.subtotal + sign * (d.subtotal || 0)); r.total = R(r.total + sign * (d.total || 0)); m.set(co, r);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };

  /* ------------------------------------------------------------------
     Crear y editar (RN-SEP-01/02/03/11)
     ------------------------------------------------------------------ */
  const canPrep = () => G.can('sep.separation.prepare');
  const assertPrep = () => { if (!canPrep()) G.fail('RN-SEP-08', `Tu rol (${G.roleName()}) no tiene el permiso sep.separation.prepare.`); };
  const pushHist = (sep, to, note, o = {}) => { const hist = (sep.history || []).concat([{ at: o.at || now(), from: sep.status || null, to, user: o.byName || meName(), note: note || null }]); return hist; };
  S.coherence = function (v) {
    const origin = v.origin_company_id;
    if (v.dest_type === 'OTHER_RUC') {
      if (!v.dest_company_id) return 'Otro RUC del tenant exige la empresa destino.';
      if (v.dest_company_id === origin) return `La empresa destino debe ser distinta de la de origen (${coName(origin)}).`;
      if (!coOf(v.dest_company_id)) return 'La empresa destino no existe en este tenant.';
    } else {
      if (v.dest_company_id) return `${destName(v.dest_type)} no lleva empresa destino del tenant: indica sus datos (razón social y RUC) o el sistema.`;
      if (v.dest_type === 'OTHER_TENANT' && !(v.dest_tenant_id || v.dest_tenant_name)) return 'Otro tenant exige el tenant destino (uno existente o el nombre del nuevo).';
      if (v.dest_type === 'OTHER_SYSTEM' && !v.dest_system_name) return 'Otro sistema exige el nombre del sistema destino.';
    }
    if (v.dest_ruc && !U.rucOk(String(v.dest_ruc))) return `El RUC del destino ${v.dest_ruc} no es válido (dígito verificador).`;
    return null;
  };
  /** crea una separación en borrador con sus elementos propuestos */
  S.create = function (v, o = {}) {
    if (!o.seed) assertPrep();
    const brand = D.get('brands', v.brand_id); if (!brand) G.fail('RN-SEP-03', 'Elige la marca.');
    if (brand.status === 'SEPARATED') G.fail('RN-SEP-11', `${G.brandName(v.brand_id)} ya está separada: deshacerlo es otra separación en sentido inverso desde el destino.`);
    if (!v.simulation) { const live = S.live(v.brand_id); if (live) G.fail('RN-SEP-02', `${G.brandName(v.brand_id)} ya tiene la separación viva ${live.number} (${(ST[live.status] || [live.status])[0].toLowerCase()}): complétala o cancélala antes de crear otra.`); }
    if (!isMonthEnd(v.cutoff_date)) G.fail('RN-SEP-01', `La fecha de corte ${F.date(v.cutoff_date)} no es el último día del mes (sería ${F.date(monthEnd(v.cutoff_date || G.TODAY))}).`);
    let destCo = v.dest_company_id || null;
    if (v.dest_type === 'OTHER_RUC' && !destCo && v.new_company_ruc) {
      const ruc = String(v.new_company_ruc).trim();
      if (!U.rucOk(ruc)) G.fail('RN-SEP-03', `El RUC ${ruc} de la empresa nueva no es válido (dígito verificador SUNAT).`);
      if (D.find('companies', c => c.ruc === ruc)) G.fail('RN-SEP-03', `Ya existe una empresa con el RUC ${ruc}: elígela en la lista.`);
      if (!v.new_company_name) G.fail('RN-SEP-03', 'Indica la razón social de la empresa nueva.');
      destCo = D.insert('companies', { legal_name: String(v.new_company_name).toUpperCase(), ruc, trade_name: v.new_company_trade || null, tax_regime: 'MYPE', fiscal_address: v.new_company_address || null, status: 'PREPARING', default_currency: 'PEN', timezone: 'America/Lima', einvoice_provider: null }).id;
    }
    const origin = S.companyFor(v.brand_id, v.cutoff_date) || brand.company_id || 'co-dg';
    const tenantRow = v.dest_tenant_id ? (D.raw('tenants').find(t => t.id === v.dest_tenant_id) || {}) : {};
    const row = {
      number: o.number || D.next('SEP', 'SEP-', 4), brand_id: v.brand_id, origin_company_id: origin, dest_type: v.dest_type, dest_company_id: v.dest_type === 'OTHER_RUC' ? destCo : null,
      dest_tenant_id: v.dest_type === 'OTHER_TENANT' ? (v.dest_tenant_id || null) : null, dest_tenant_name: v.dest_type === 'OTHER_TENANT' ? (v.dest_tenant_name || tenantRow.name || null) : null,
      dest_system_name: v.dest_type === 'OTHER_SYSTEM' ? (v.dest_system_name || null) : null, dest_legal_name: v.dest_type === 'OTHER_RUC' ? coName(destCo) : (v.dest_legal_name || null), dest_ruc: v.dest_type === 'OTHER_RUC' ? coRuc(destCo) : (v.dest_ruc || null),
      cutoff_date: v.cutoff_date, simulation: !!v.simulation, receivables_policy: v.receivables_policy || 'KEEP_ORIGIN', notes: v.notes || null, status: 'DRAFT',
      prepared_by: o.by || me(), prepared_by_name: o.byName || meName(), prepared_at: o.at || now(), checks_run_at: null, validated_at: null, warn_note: null, approved_by: null, approved_by_name: null, approved_at: null, approval_note: null,
      executed_at: null, completed_at: null, cancelled_at: null, cancel_reason: null, export: null, act: null, transfer_docs: [], history: [{ at: o.at || now(), from: null, to: 'DRAFT', user: o.byName || meName(), note: v.simulation ? 'Simulación (no cambia datos)' : null }],
    };
    const err = S.coherence(row); if (err) G.fail('RN-SEP-03', err);
    const sep = D.insert(T_SEP, row, { silent: !!o.seed });
    S.buildItems(sep.id, o);
    return sep;
  };
  /** edita destino, corte o notas; aprobada ya no cambia (RN-SEP-11); una validada vuelve a borrador */
  S.update = function (id, v) {
    assertPrep();
    const sep = S.get(id);
    if (S.isLocked(sep)) G.fail('RN-SEP-11', `${sep.number} está ${(ST[sep.status] || [sep.status])[0].toLowerCase()}: no cambia su alcance ni su fecha de corte.${sep.status === 'COMPLETED' ? ' Completada es irreversible: deshacerla es otra separación en sentido inverso.' : ''}`);
    if (v.cutoff_date !== undefined && !isMonthEnd(v.cutoff_date)) G.fail('RN-SEP-01', `La fecha de corte ${F.date(v.cutoff_date)} no es el último día del mes.`);
    const next = Object.assign({}, sep, v);
    next.dest_legal_name = next.dest_type === 'OTHER_RUC' ? coName(next.dest_company_id) : next.dest_legal_name; next.dest_ruc = next.dest_type === 'OTHER_RUC' ? coRuc(next.dest_company_id) : next.dest_ruc;
    const err = S.coherence(next); if (err) G.fail('RN-SEP-03', err);
    const scopeChanged = ['cutoff_date', 'dest_type', 'dest_company_id'].some(k => v[k] !== undefined && v[k] !== sep[k]);
    const patch = Object.assign({}, v, { dest_legal_name: next.dest_legal_name, dest_ruc: next.dest_ruc });
    if (sep.status === 'VALIDATED') { patch.status = 'DRAFT'; patch.history = pushHist(sep, 'DRAFT', 'Cambio de alcance: vuelve a validar'); patch.validated_at = null; }
    D.update(T_SEP, id, patch);
    if (scopeChanged) S.buildItems(id);
    return S.get(id);
  };
  /** propone los elementos de la separación según el destino (se pueden ajustar antes de aprobar) */
  S.buildItems = function (id, o = {}) {
    const sep = S.get(id);
    if (S.isLocked(sep)) G.fail('RN-SEP-11', `${sep.number} está aprobada o en curso: su alcance no cambia.`);
    for (const it of S.items(id)) D.remove(T_IT, it.id);
    for (const c of S.checks(id)) D.remove(T_CHK, c.id);
    const add = (type, r) => D.insert(T_IT, Object.assign({ separation_id: id, item_type: type, seq: (TYPES[type] || [0, 99])[1] * 1000 + S.items(id, type).length, status: 'PENDING', attempts: 0, error: null, executed_at: null, result: null, refs: [] }, r), { silent: true });
    const brand = sep.brand_id, same = sep.dest_type === 'OTHER_RUC';
    const def = (type, wanted) => { const ok = S.actionsFor(type, sep.dest_type).map(a => a[0]); return ok.includes(wanted) ? wanted : (ok[0] || null); };
    // series del destino (solo otro RUC del tenant)
    if (same) {
      const n = Math.max(1, ...D.where(T_SEP, s => s.dest_type === 'OTHER_RUC' && s.id !== id && s.status !== 'CANCELLED').map(() => 1));
      const sufOf = bs => String(bs).slice(0, 1) + String(bs).slice(-1);
      let base = 200 + n; while (D.find('document_series', x => ['B' + base, 'F' + base, 'FC' + sufOf(base), 'BC' + sufOf(base)].includes(x.series))) base++;
      const suf = sufOf(base);
      for (const [dt, code, ap] of [['INVOICE', 'F' + base, null], ['RECEIPT', 'B' + base, null], ['CREDIT_NOTE', 'FC' + suf, 'INVOICE'], ['CREDIT_NOTE', 'BC' + suf, 'RECEIPT']]) add('SERIES_NEW', { ref_table: 'document_series', ref_id: null, label: `${code} · ${G.docTypeName(dt)}${ap ? ' de ' + G.docTypeName(ap).toLowerCase() : ''}`, code, doc_type: dt, applies_to: ap, action: 'CREATE' });
    }
    for (const p of D.where('products', p => p.brand_id === brand && p.status !== 'INACTIVE')) add('PRODUCT', { ref_table: 'products', ref_id: p.id, label: p.name, qty: D.where('product_variants', v => v.product_id === p.id).length, uom: 'presentaciones', action: def('PRODUCT', same ? 'MOVE' : sep.dest_type === 'OTHER_TENANT' ? 'COPY' : 'EXPORT_ONLY') });
    for (const l of D.where('price_lists', l => l.brand_id === brand)) add('PRICE_LIST', { ref_table: 'price_lists', ref_id: l.id, label: l.name || l.id, qty: D.where('price_list_items', x => x.list_id === l.id).length, uom: 'precios', action: def('PRICE_LIST', same ? 'MOVE' : sep.dest_type === 'OTHER_TENANT' ? 'COPY' : 'EXPORT_ONLY') });
    const canTransfer = same || U.rucOk(String(sep.dest_ruc || ''));
    for (const { b, at_cut } of S.stockRows(brand, sep.cutoff_date)) {
      const v = G.variant(b.variant_id) || {}; const lot = b.lot_id ? D.get('lots', b.lot_id) : null; const wh = D.get('warehouses', b.warehouse_id) || {};
      const usable = G.inv.lotUsable(b.lot_id); const special = ['TRANSIT', 'VEHICLE'].includes(wh.wh_type) || /TRA|VEH/.test(b.warehouse_id);
      const avail = R(b.qty - (b.reserved_qty || 0), 3);
      const nearExp = lot && lot.expiry_date && G.date.diff(lot.expiry_date, G.TODAY) <= 10;
      if (!(b.qty > 0.0005) && !(at_cut > 0.0005)) continue;
      const gone = !(b.qty > 0.0005), reserved = !gone && !(avail > 0.0005);
      const action = gone ? 'EXPORT_ONLY' : !usable || special || nearExp || reserved ? 'LEAVE' : canTransfer ? 'TRANSFER' : 'EXPORT_ONLY';
      const qty = gone ? at_cut : reserved ? b.qty : Math.min(at_cut > 0.0005 ? at_cut : b.qty, avail);
      add('STOCK', { ref_table: 'stock_balances', ref_id: b.id, label: `${v.name || b.variant_id}${lot ? ' · ' + lot.code : ''}`, variant_id: b.variant_id, lot_id: b.lot_id || null, warehouse_id: b.warehouse_id, establishment_id: wh.establishment_id || null, expiry_date: lot ? lot.expiry_date : null, qty_at_cutoff: at_cut, qty: R(qty, 3), uom: unitOf(v), unit_cost: R(b.avg_cost || v.std_cost || 0, 4), reserved_qty: b.reserved_qty || 0, action, note: gone ? 'Ya salió después del corte: solo va en el paquete' : reserved ? 'Todo el saldo está reservado por pedidos o producción del origen' : !usable ? 'Lote no liberado o vencido (RN-ALM-02)' : special ? 'Stock en tránsito o en vehículo' : nearExp ? 'Vence en 10 días o menos: se liquida en el origen' : null, received_qty: null });
    }
    const cu = S.customers(sep);
    add('CUSTOMERS', { ref_table: 'customers', ref_id: null, label: same ? `${cu.all.length} clientes de la marca (compartidos en el tenant)` : `${cu.withConsent.length} de ${cu.all.length} clientes con consentimiento (últimos ${cu.months} meses)`, qty: same ? cu.all.length : cu.withConsent.length, uom: 'clientes', action: def('CUSTOMERS', same ? 'SHARED' : 'EXPORT') });
    for (const ord of S.openOrders(brand)) add('ORDER', { ref_table: 'sales_orders', ref_id: ord.id, label: `${ord.number} · ${G.custName(ord.customer_id)}`, qty: 1, amount: ord.final_total ?? ord.estimated_total, action: def('ORDER', same ? 'KEEP' : 'CANCEL_NOTIFY'), delivery_date: ord.delivery_date });
    for (const d of S.receivables(sep)) add('RECEIVABLE', { ref_table: 'sales_documents', ref_id: d.id, label: `${d.full_number} · ${d.customer_name || G.custName(d.customer_id)}`, amount: d.balance, action: sep.receivables_policy === 'ASSIGN' ? 'ASSIGN' : 'KEEP_ORIGIN', due_date: d.due_date });
    for (const c of S.channels(brand)) add('CHANNEL', { ref_table: 'messaging_channels', ref_id: c.id, label: `${c.kind === 'WHATSAPP' ? 'WhatsApp' : c.kind === 'TIKTOK' ? 'TikTok' : c.kind === 'MESSENGER' ? 'Messenger' : c.kind === 'INSTAGRAM' ? 'Instagram' : c.kind} ${c.number}`, kind: c.kind, qty: S.convCount(c.id), uom: 'conversaciones', action: def('CHANNEL', same ? 'KEEP_INBOX' : sep.dest_type === 'OTHER_TENANT' ? 'MIGRATE' : 'DISCONNECT') });
    const b = brandOf(brand); const webProducts = D.where('products', p => p.brand_id === brand && p.web_publishable).length;
    if (b.website || webProducts) add('WEB_STORE', { ref_table: 'brands', ref_id: brand, label: b.website ? `Tienda ${b.website}` : `Tienda web (${webProducts} productos publicados)`, qty: webProducts, uom: 'productos publicados', action: same ? 'REASSIGN' : 'DISCONNECT' });
    for (const a of D.where('ad_accounts', a => a.brand_id === brand)) add('AD_ACCOUNT', { ref_table: 'ad_accounts', ref_id: a.id, label: a.name || `${a.platform} · ${G.brandName(brand)}`, platform: a.platform, action: same ? 'REASSIGN' : 'DISCONNECT' });
    for (const ca of D.where('cash_accounts', c => c.brand_id === brand)) add('CASH_ACCOUNT', { ref_table: 'cash_accounts', ref_id: ca.id, label: ca.name || ca.id, action: same ? 'REASSIGN' : 'DISCONNECT' });
    for (const u of S.brandUsers(brand)) { const only = (u.brands || []).length === 1; add('USER', { ref_table: 'users', ref_id: u.id, label: `${u.name} · ${G.roleName(u.role)}`, only_brand: only, action: same ? 'KEEP' : only ? 'MOVE' : 'REMOVE_SCOPE' }); }
    for (const w of S.warehouseShare(brand).filter(r => r.pct >= 99.9)) add('WAREHOUSE', { ref_table: 'warehouses', ref_id: w.wh, label: G.whName(w.wh), qty: w.lots, uom: 'lotes', action: same ? 'KEEP' : 'MOVE' });
    for (const s of D.where('document_series', s => s.brand_id === brand && s.status === 'ACTIVE' && (s.company_id || 'co-dg') === sep.origin_company_id)) add('SERIES_ORIGIN', { ref_table: 'document_series', ref_id: s.id, label: `${s.series} · ${G.docTypeName(s.doc_type)}${s.applies_to ? ' de ' + G.docTypeName(s.applies_to).toLowerCase() : ''}`, code: s.series, doc_type: s.doc_type, action: ['INVOICE', 'RECEIPT'].includes(s.doc_type) ? 'CLOSE' : 'KEEP', note: ['INVOICE', 'RECEIPT'].includes(s.doc_type) ? null : 'Se mantiene para notas de comprobantes anteriores al corte' });
    D.update(T_SEP, id, { items_built_at: o.at || now(), checks_run_at: null }, { silent: true });
    return S.items(id);
  };
  /** cambia la acción, la cantidad o excluye un elemento (RN-SEP-11, RN-SEP-12) */
  S.setItem = function (itemId, patch) {
    assertPrep();
    const it = D.get(T_IT, itemId); const sep = S.get(it.separation_id);
    if (S.isLocked(sep) && !(sep.status === 'FAILED' && patch.status === 'EXCLUDED' && it.status === 'FAILED')) G.fail('RN-SEP-11', `${sep.number} está ${(ST[sep.status] || [sep.status])[0].toLowerCase()}: su alcance no cambia.`);
    const p = {};
    if (patch.action !== undefined) { if (!S.actionsFor(it.item_type, sep.dest_type).some(a => a[0] === patch.action)) G.fail('RN-SEP-03', `La acción «${actName(it.item_type, patch.action)}» no aplica a ${destName(sep.dest_type).toLowerCase()}.`); p.action = patch.action; }
    if (patch.qty !== undefined) {
      const q = Number(patch.qty);
      if (it.item_type === 'STOCK') {
        if (!(q > 0)) G.fail('RN-SEP-12', `Un elemento de stock lleva cantidad mayor que 0 (${it.label}). Si no se traspasa, elige «Dejar en el origen» o exclúyelo.`);
      }
      p.qty = R(q, 3);
    }
    if (it.item_type === 'STOCK' && (p.action || it.action) === 'TRANSFER' && (patch.qty !== undefined || patch.action !== undefined)) {
      const q = p.qty ?? it.qty; const b = D.get('stock_balances', it.ref_id); const avail = b ? R(b.qty - (b.reserved_qty || 0), 3) : 0;
      if (q > avail + 0.0005) G.fail('RN-SEP-12', `${it.label}: hay ${F.num(avail, 3)} ${it.uom} disponibles en ${G.whName(it.warehouse_id)} y se traspasan ${F.num(q, 3)}.`);
    }
    if (patch.status === 'EXCLUDED') { if (!patch.exclude_reason) G.fail('RN-SEP-09', 'Excluir un elemento exige motivo.'); p.status = 'EXCLUDED'; p.exclude_reason = patch.exclude_reason; }
    if (patch.status === 'PENDING' && it.status === 'EXCLUDED') { p.status = 'PENDING'; p.exclude_reason = null; }
    if (patch.note !== undefined) p.note = patch.note;
    D.update(T_IT, itemId, p);
    if (sep.status === 'VALIDATED') D.update(T_SEP, sep.id, { status: 'DRAFT', validated_at: null, history: pushHist(sep, 'DRAFT', 'Cambio de alcance: vuelve a validar') });
    return D.get(T_IT, itemId);
  };
  S.setPolicy = function (id, policy) {
    assertPrep(); const sep = S.get(id);
    if (S.isLocked(sep)) G.fail('RN-SEP-11', `${sep.number} ya está aprobada: no cambia su alcance.`);
    D.update(T_SEP, id, { receivables_policy: policy });
    for (const it of S.items(id, 'RECEIVABLE')) D.update(T_IT, it.id, { action: policy === 'ASSIGN' ? 'ASSIGN' : 'KEEP_ORIGIN' }, { silent: true });
    if (sep.status === 'VALIDATED') D.update(T_SEP, id, { status: 'DRAFT', validated_at: null, history: pushHist(sep, 'DRAFT', 'Cambio de alcance: vuelve a validar') });
  };

  /* ------------------------------------------------------------------
     Validaciones previas (SEP-03) · RN-SEP-07
     ------------------------------------------------------------------ */
  S.runChecks = function (id, o = {}) {
    if (!o.seed) assertPrep();
    const sep = S.get(id);
    if (S.isLocked(sep)) G.fail('RN-SEP-11', `${sep.number} ya está aprobada o en curso: las validaciones quedaron registradas.`);
    const at = o.at || now();
    const res = {};
    const set = (code, result, detail, count) => { res[code] = { result, detail, count: count ?? null }; };
    const brand = sep.brand_id, same = sep.dest_type === 'OTHER_RUC';
    const p = G.period.of(sep.cutoff_date);
    set('CUTOFF_MONTH_END', isMonthEnd(sep.cutoff_date) ? 'PASS' : 'FAIL', isMonthEnd(sep.cutoff_date) ? `Corte al ${F.date(sep.cutoff_date)}.` : `${F.date(sep.cutoff_date)} no es fin de mes.`);
    set('CUTOFF_PERIOD_CLOSED', p && p.status === 'CLOSED' ? 'PASS' : 'WARN', p && p.status === 'CLOSED' ? `${G.date.monthName(sep.cutoff_date)} está cerrado en ${coName(sep.origin_company_id)}.` : `${G.date.monthName(sep.cutoff_date)} está ${p ? (p.status === 'CLOSING' ? 'en cierre' : 'abierto') : 'sin período'}: se exige cerrado para aprobar y ejecutar (RN-SEP-01).`);
    const coh = S.coherence(sep);
    set('DESTINATION_COHERENT', coh ? 'FAIL' : 'PASS', coh || `${destName(sep.dest_type)}: ${sep.dest_legal_name || sep.dest_tenant_name || sep.dest_system_name}${sep.dest_ruc ? ' · RUC ' + sep.dest_ruc : ''}.`);
    const prep = S.ordersInProcess(brand);
    set('NO_ORDERS_IN_PREPARATION', prep.length ? 'FAIL' : 'PASS', prep.length ? `${prep.length} pedido(s) en preparación o en ruta: ${prep.slice(0, 6).map(x => `${x.number} (${G.ui.statusLabel(x.status).toLowerCase()})`).join(', ')}. Termínalos antes de validar.` : 'Ningún pedido de la marca en preparación, pesado, listo o en ruta.', prep.length);
    const routes = D.where('delivery_routes', r => !['CLOSED', 'SETTLED', 'CANCELLED', 'COMPLETED'].includes(r.status) && (r.order_ids || []).some(oid => (D.get('sales_orders', oid) || {}).brand_id === brand));
    set('NO_OPEN_ROUTES', routes.length ? 'FAIL' : 'PASS', routes.length ? `${routes.length} ruta(s) abiertas con pedidos de la marca: ${routes.map(r => r.number || r.id).join(', ')}.` : 'Sin rutas abiertas con pedidos de la marca.', routes.length);
    const docs = D.where('sales_documents', d => d.brand_id === brand && d.issue_date <= sep.cutoff_date && d.status !== 'VOIDED');
    const rej = docs.filter(d => d.sunat_status === 'REJECTED'), pend = docs.filter(d => ['PENDING', 'OBSERVED'].includes(d.sunat_status));
    set('DOCUMENTS_SENT', rej.length ? 'FAIL' : pend.length ? 'WARN' : 'PASS', rej.length ? `${rej.length} rechazado(s) por la SUNAT hasta el corte: ${rej.slice(0, 5).map(d => d.full_number).join(', ')}. Corrige y reemite.` : pend.length ? `${pend.length} pendiente(s) u observado(s): ${pend.slice(0, 5).map(d => d.full_number).join(', ')}.` : `${docs.length} comprobantes hasta el corte, todos aceptados.`, rej.length + pend.length);
    const after = D.where('sales_documents', d => d.brand_id === brand && d.issue_date > sep.cutoff_date && (d.company_id || 'co-dg') === sep.origin_company_id && d.status !== 'VOIDED');
    set('DOCS_AFTER_CUTOFF', after.length && !sep.simulation ? 'WARN' : 'PASS', after.length ? `${after.length} comprobante(s) del ${F.date(G.date.add(sep.cutoff_date, 1))} en adelante salieron con ${coName(sep.origin_company_id)} (${F.money(U.sum(after, d => d.total))}). Desde la ejecución rige RN-SEP-05; la contadora decide si se regularizan con nota de crédito y reemisión.` : 'Ningún comprobante posterior al corte con la empresa de origen.', after.length);
    if (same) {
      const co = coOf(sep.dest_company_id) || {}; const sn = S.items(id, 'SERIES_NEW').filter(i => i.status !== 'EXCLUDED');
      const hasInv = sn.some(i => i.doc_type === 'INVOICE'), hasRec = sn.some(i => i.doc_type === 'RECEIPT');
      set('DEST_SERIES_OSE', !hasInv || !hasRec ? 'FAIL' : !co.einvoice_provider ? 'WARN' : 'PASS', !hasInv || !hasRec ? 'Faltan series nuevas de factura o boleta para el destino (SEP-04).' : !co.einvoice_provider ? `Series ${sn.map(i => i.code).join(', ')} listas; ${co.legal_name || 'el destino'} aún no tiene OSE configurado.` : `Series ${sn.map(i => i.code).join(', ')} · OSE ${co.einvoice_provider}${co.einvoice_test && co.einvoice_test.result === 'ACCEPTED' ? ' (prueba aceptada)' : ''}.`);
    } else set('DEST_SERIES_OSE', 'PASS', 'No aplica: el destino emite con sus propias series fuera de este tenant.');
    const stk = S.items(id, 'STOCK').filter(i => i.status !== 'EXCLUDED');
    const whs = [...new Set(stk.map(i => i.warehouse_id))];
    const recent = whs.filter(w => D.find('stock_counts', c => c.warehouse_id === w && ['APPROVED', 'CLOSED'].includes(c.status) && String(c.counted_at || c.approved_at || '').slice(0, 10) >= G.date.add(sep.cutoff_date, -15)));
    set('STOCK_COUNTED', !whs.length || recent.length === whs.length ? 'PASS' : 'WARN', !whs.length ? 'La marca no tiene stock.' : recent.length === whs.length ? `Conteo aprobado en ${whs.map(G.whName).join(', ')}.` : `Sin conteo aprobado desde el ${F.date(G.date.add(sep.cutoff_date, -15))} en: ${whs.filter(w => !recent.includes(w)).map(G.whName).join(', ')}.`, whs.length - recent.length);
    const badStock = stk.filter(i => !(i.qty > 0) || !i.action);
    set('STOCK_ITEMS_VALID', badStock.length ? 'FAIL' : 'PASS', badStock.length ? `${badStock.length} elemento(s) sin cantidad o acción: ${badStock.slice(0, 4).map(i => i.label).join(', ')} (RN-SEP-12).` : `${stk.length} lotes: ${stk.filter(i => i.action === 'TRANSFER').length} con traspaso, ${stk.filter(i => i.action === 'EXPORT_ONLY').length} solo exportar, ${stk.filter(i => i.action === 'LEAVE').length} se dejan.`, badStock.length);
    const rec = S.items(id, 'RECEIVABLE');
    set('RECEIVABLES_DECISION', sep.receivables_policy ? 'PASS' : 'FAIL', sep.receivables_policy ? `${rec.length} por cobrar (${F.money(U.sum(rec, i => i.amount))}): ${sep.receivables_policy === 'ASSIGN' ? 'se ceden al destino' : 'quedan en el origen (D-SEP-04)'}.` : 'Elige si las cuentas por cobrar quedan en el origen o se ceden.');
    const wa = S.items(id, 'CHANNEL').filter(i => i.kind === 'WHATSAPP');
    const waBad = wa.filter(i => !i.action && i.status !== 'EXCLUDED');
    set('WHATSAPP_DECISION', waBad.length ? 'FAIL' : wa.length ? 'PASS' : 'WARN', waBad.length ? `${waBad.length} número(s) sin acción.` : wa.length ? wa.map(i => `${i.label}: ${actName('CHANNEL', i.action).toLowerCase()}`).join(' · ') : 'La marca no tiene número de WhatsApp propio.');
    const us = S.items(id, 'USER');
    set('USERS_DECISION', us.length ? 'PASS' : 'WARN', us.length ? `${us.length} usuario(s): ${us.filter(i => i.only_brand).length} solo con esta marca.` : 'Ningún usuario tiene la marca en su alcance.', us.length);
    const cng = stk.filter(i => /CNG/.test(i.warehouse_id || '') || ((D.get('warehouses', i.warehouse_id) || {}).wh_type === 'CONSIGNMENT'));
    set('CONSIGNMENT_SETTLED', cng.length ? 'WARN' : 'PASS', cng.length ? `${cng.length} lote(s) de la marca en almacenes de consignación: liquida la consignación antes de ejecutar.` : 'Sin stock de la marca en consignación.', cng.length);
    if (!same) {
      const cu = S.customers(sep);
      set('CUSTOMERS_CONSENT', cu.withoutConsent.length ? 'WARN' : 'PASS', `${cu.withConsent.length} de ${cu.all.length} clientes de los últimos ${cu.months} meses tienen consentimiento registrado; ${cu.withoutConsent.length} no se exportan (D-SEP-03).`, cu.withoutConsent.length);
    } else set('CUSTOMERS_CONSENT', 'PASS', 'Mismo tenant: los clientes son compartidos y no se copian (RN-SEP-14).');
    for (const c of S.checks(id)) D.remove(T_CHK, c.id);
    CHECKS.forEach(([code, title, rn], i) => { const r = res[code] || { result: 'PASS', detail: '—' }; D.insert(T_CHK, { separation_id: id, seq: i, code, title, rule: rn, result: r.result, detail: r.detail, count: r.count, run_at: at, run_by: o.byName || meName() }, { silent: true }); });
    D.update(T_SEP, id, { checks_run_at: at }, { silent: !!o.seed });
    return S.checks(id);
  };
  S.checkSummary = id => { const cs = S.checks(id); return { pass: cs.filter(c => c.result === 'PASS').length, warn: cs.filter(c => c.result === 'WARN').length, fail: cs.filter(c => c.result === 'FAIL').length, total: cs.length }; };
  /** pasa a VALIDATED: validaciones ejecutadas y ninguna en FAIL; WARN con nota (RN-SEP-07) */
  S.validate = function (id, note, o = {}) {
    if (!o.seed) assertPrep();
    const sep = S.get(id);
    if (sep.status !== 'DRAFT') G.fail('RN-SEP-11', `${sep.number} está ${(ST[sep.status] || [sep.status])[0].toLowerCase()}: solo un borrador se valida.`);
    if (!sep.checks_run_at) G.fail('RN-SEP-07', 'Ejecuta las validaciones previas antes de validar (SEP-03).');
    const coh = S.coherence(sep); if (coh) G.fail('RN-SEP-03', coh);
    const cs = S.checks(id); const fails = cs.filter(c => c.result === 'FAIL'), warns = cs.filter(c => c.result === 'WARN');
    if (fails.length) G.fail('RN-SEP-07', `${fails.length} validación(es) en FAIL: ${fails.map(c => c.code).join(', ')}. Resuélvelas y vuelve a ejecutar las validaciones.`);
    if (warns.length && !String(note || '').trim()) G.fail('RN-SEP-07', `Hay ${warns.length} advertencia(s) (${warns.map(c => c.code).join(', ')}): acéptalas con una nota.`);
    D.update(T_SEP, id, { status: 'VALIDATED', validated_at: o.at || now(), warn_note: note || null, history: pushHist(sep, 'VALIDATED', note, o) }, { silent: !!o.seed });
    if (!o.seed) G.notify({ role: 'GERENTE', title: `${sep.number} por aprobar`, body: `Separación de ${G.brandName(sep.brand_id)} con corte al ${F.date(sep.cutoff_date)}.`, ref: sep.id, module: 'SEP', tone: 'info' });
    return S.get(id);
  };
  const assertCutoffClosed = (sep, what) => { if (!G.period.isClosed(sep.cutoff_date)) G.fail('RN-SEP-01', `Para ${what} ${sep.number}, ${G.date.monthName(sep.cutoff_date)} debe estar cerrado en ${coName(sep.origin_company_id)} (hoy está ${(G.period.of(sep.cutoff_date) || {}).status === 'CLOSING' ? 'en cierre' : 'abierto'}). Ciérralo en PLT-09.`); };
  /** aprobación por otra persona con sep.separation.approve (RN-SEP-08) y con el mes del corte cerrado (RN-SEP-01) */
  S.approve = function (id, note, o = {}) {
    const sep = S.get(id);
    if (!o.seed && !G.can('sep.separation.approve')) G.fail('RN-SEP-08', `Tu rol (${G.roleName()}) no tiene el permiso sep.separation.approve.`);
    if (sep.status !== 'VALIDATED') G.fail('RN-SEP-11', `${sep.number} está ${(ST[sep.status] || [sep.status])[0].toLowerCase()}: se aprueba una separación validada.`);
    const by = o.by || me();
    if (by && by === sep.prepared_by) G.fail('RN-SEP-08', `${sep.prepared_by_name} preparó ${sep.number}: la aprueba otra persona.`);
    assertCutoffClosed(sep, 'aprobar');
    D.update(T_SEP, id, { status: 'APPROVED', approved_by: by, approved_by_name: o.byName || meName(), approved_at: o.at || now(), approval_note: note || null, history: pushHist(sep, 'APPROVED', note, o) }, { silent: !!o.seed });
    if (!o.seed) G.notify({ role: 'ADMINISTRACION', title: `${sep.number} aprobada`, body: `Ejecuta la separación de ${G.brandName(sep.brand_id)} en SEP-09.`, ref: sep.id, module: 'SEP', tone: 'ok' });
    return S.get(id);
  };
  S.cancel = function (id, reason, o = {}) {
    if (!o.seed) assertPrep();
    const sep = S.get(id);
    if (sep.status === 'COMPLETED') G.fail('RN-SEP-11', `${sep.number} está completada y es irreversible: deshacerla es otra separación en sentido inverso.`);
    if (!['DRAFT', 'VALIDATED', 'APPROVED'].includes(sep.status)) G.fail('RN-SEP-11', `${sep.number} ya empezó a ejecutarse: se cancela solo antes de ejecutar; reintenta los elementos fallidos.`);
    if (!String(reason || '').trim()) G.fail('RN-SEP-11', 'Cancelar exige motivo.');
    D.update(T_SEP, id, { status: 'CANCELLED', cancelled_at: o.at || now(), cancel_reason: reason, history: pushHist(sep, 'CANCELLED', reason, o) }, { silent: !!o.seed });
    return S.get(id);
  };

  /* ------------------------------------------------------------------
     Ejecución por elemento (SEP-09) · RN-SEP-09/13/15/16/17/20
     ------------------------------------------------------------------ */
  const destCustomer = function (sep) {
    const ruc = sep.dest_ruc; if (!ruc || !U.rucOk(String(ruc))) G.fail('RN-SEP-13', `El traspaso con comprobante exige un RUC válido del destino (${ruc || 'sin RUC'}).`);
    let c = D.find('customers', x => x.doc_type === 'RUC' && x.doc_number === ruc);
    if (!c) c = D.insert('customers', { doc_type: 'RUC', doc_number: ruc, full_name: sep.dest_legal_name || coName(sep.dest_company_id), trade_name: null, phone: null, email: null, customer_type: 'BUSINESS', source_channel: 'OTHER', marketing_opt_in: false, status: 'ACTIVE', orders_count: 0, segment_brands: [], notes: `Destino de la separación ${sep.number}` }, { silent: true });
    return c;
  };
  S.destWarehouse = function (sep, site) {
    const co = coOf(sep.dest_company_id) || {}; const code = (co.trade_name || co.legal_name || 'DEST').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
    const id = `wh-${code}-${String(site || 'es-L1').slice(3)}`;
    return D.get('warehouses', id) || D.insert('warehouses', { id, establishment_id: site, code: `${code}-${String(site).slice(3)}`, name: `Almacén ${co.trade_name || co.legal_name} · ${G.siteName(site)}`, wh_type: 'MAIN', min_temp_c: null, max_temp_c: null, allows_sale: true, pick_priority: 9, status: 'ACTIVE', company_id: sep.dest_company_id, created_by_separation_id: sep.id });
  };
  const guideFor = function (sep, site, doc, its, customer) {
    const lines = its.map(i => { const v = G.variant(i.variant_id) || {}; return { variant_id: i.variant_id, description: `${v.name || i.label}${i.lot_id ? ' · lote ' + ((D.get('lots', i.lot_id) || {}).code || '') : ''}`, qty: i.qty, uom_code: v.sale_mode === 'KG' ? 'KGM' : 'NIU', weight_kg: v.sale_mode === 'KG' ? i.qty : R(i.qty * (v.nominal_weight_kg || 0.3), 3), lot_id: i.lot_id }; });
    const destAddr = sep.dest_type === 'OTHER_RUC' ? ((D.get('establishments', site) || {}).address || (coOf(sep.dest_company_id) || {}).fiscal_address) : 'Domicilio del destino';
    if (G.fac && typeof G.fac.issueGuide === 'function') {
      const veh = D.find('vehicles', v => v.establishment_id === site) || D.find('vehicles', () => true);
      const drv = D.find('users', u => u.role === 'REPARTIDOR' && u.status === 'ACTIVE' && u.employee_id) || {};
      const g = G.fac.issueGuide({ reason_code: '01', origin_establishment_id: site, brand_id: sep.brand_id, sales_document_id: doc.id, recipient_customer_id: customer.id, transport_mode: '02', vehicle_id: veh && veh.id, driver_user_id: drv.id, lines, gross_weight_kg: U.sum(lines, l => l.weight_kg || 0) || 1, dest_address: destAddr, notes: `Traspaso por separación ${sep.number} (motivo 01 venta)` });
      return g.full_number;
    }
    const s = G.series.next(site === 'es-L2' ? 'T002' : 'T001');
    const g = D.insert('dispatch_guides', { company_id: sep.origin_company_id, establishment_id: site, brand_id: sep.brand_id, series: s.series, number: s.number, full_number: `${s.series}-${U.pad(s.number, 8)}`, issue_date: G.TODAY, transfer_reason_code: '01', transport_mode: '02', recipient_customer_id: customer.id, sales_document_id: doc.id, dest_address: destAddr, gross_weight_kg: R(U.sum(lines, l => l.weight_kg || 0), 3), sunat_status: 'PENDING', status: 'ISSUED', issued_by: meName(), notes: `Traspaso ${sep.number}` }, { silent: true });
    for (const l of lines) D.insert('dispatch_guide_lines', Object.assign({ guide_id: g.id }, l), { silent: true });
    return g.full_number;
  };
  /** traspaso de stock (RN-SEP-13): factura de la empresa de origen a la de destino al costo promedio (D-SEP-01) + guía motivo venta por local + salida y recepción */
  const execStock = function (sep, its, dry) {
    const ok = [];
    for (const it of its) {
      const b = D.get('stock_balances', it.ref_id); const avail = b ? R(b.qty - (b.reserved_qty || 0), 3) : 0;
      let err = null;
      if (!(it.qty > 0)) err = `RN-SEP-12: ${it.label} lleva cantidad mayor que 0.`;
      else if (!b || it.qty > avail + 0.0005) err = `RN-ALM-03: ${it.label}: hay ${F.num(avail, 3)} ${it.uom} disponibles y se traspasan ${F.num(it.qty, 3)}.`;
      else if (!G.inv.lotUsable(it.lot_id)) err = `RN-ALM-02: el lote de ${it.label} no está liberado o está vencido: elige «Dejar en el origen».`;
      if (err) { fail(it, err); continue; }
      ok.push(it);
    }
    if (!ok.length) return;
    if (dry) { for (const it of ok) done(it, `Simulado: se vendería ${F.num(it.qty, 3)} ${it.uom} al costo promedio ${F.money(it.unit_cost)} con factura y guía motivo 01.`, [], { received_qty: it.qty }); return; }
    let customer, doc;
    try {
      customer = destCustomer(sep);
      const lines = ok.map(i => { const v = G.variant(i.variant_id) || {}; const total = R(i.qty * i.unit_cost * (1 + G.tax.rate())); return { variant_id: i.variant_id, description: `${v.name || i.label}${i.lot_id ? ' · lote ' + ((D.get('lots', i.lot_id) || {}).code || '') : ''} · traspaso ${sep.number}`, qty: i.qty, uom_code: v.sale_mode === 'KG' ? 'KGM' : 'NIU', unit_price: R(i.unit_cost * (1 + G.tax.rate()), 4), igv_affectation: '10', total, lot_id: i.lot_id, unit_cost: i.unit_cost, cost: R(i.qty * i.unit_cost) }; });
      const site = ok[0].establishment_id || 'es-L1';
      const series = S.seriesFor('INVOICE', sep.brand_id, sep.origin_company_id) || G.series.for('INVOICE', sep.brand_id);
      const d = { doc_type: 'INVOICE', brand_id: sep.brand_id, establishment_id: site, customer_id: customer.id, lines, date: G.TODAY, series, payment_terms: 'CREDIT', credit_days: 30, seller_id: me() };
      doc = G.fac && typeof G.fac.issue === 'function' ? G.fac.issue(d) : G.docs.issue(Object.assign({ accept: true }, d));
      D.update('sales_documents', doc.id, { separation_id: sep.id, note: `Traspaso de stock por separación ${sep.number} (D-SEP-01: costo promedio)` }, { silent: true });
    } catch (e) { for (const it of ok) fail(it, e.message); return; }
    const bySite = U.groupBy(ok, i => i.establishment_id || 'es-L1');
    const guides = {};
    for (const [site, list] of Object.entries(bySite)) {
      try { guides[site] = guideFor(sep, site, doc, list, customer); } catch (e) { for (const it of list) fail(it, e.message); delete bySite[site]; }
    }
    for (const [site, list] of Object.entries(bySite)) for (const it of list) {
      try {
        const v = G.variant(it.variant_id) || {}; const w = v.sale_mode === 'KG' ? it.qty : null;
        const out = G.inv.move({ type: 'SALE', wh: it.warehouse_id, variant: it.variant_id, lot: it.lot_id, qty: it.qty, weight: w, source: { type: 'BRAND_SEPARATION', id: sep.id }, reason: `Traspaso ${sep.number} · ${doc.full_number} · GRE ${guides[site]}` });
        let received = it.qty, destWh = null;
        if (sep.dest_type === 'OTHER_RUC') {
          destWh = S.destWarehouse(sep, site);
          received = 0;
          for (const m of out.moves) { const r = G.inv.move({ type: 'RECEIPT', wh: destWh.id, variant: it.variant_id, lot: m.lot_id, qty: Math.abs(m.qty), weight: m.weight_kg != null ? Math.abs(m.weight_kg) : w, unitCost: m.unit_cost, source: { type: 'BRAND_SEPARATION', id: sep.id }, reason: `Recepción ${sep.number} · ${doc.full_number}`, allowUnreleased: true }); received = R(received + U.sum(r.moves, x => Math.abs(x.qty)), 3); }
        }
        done(it, `${doc.full_number} · GRE ${guides[site]}${destWh ? ' · recibido en ' + destWh.name : ' · recepción confirmada por el destino'}`, [doc.id], { received_qty: received, dest_warehouse_id: destWh ? destWh.id : null, document_id: doc.id, guide_number: guides[site] });
      } catch (e) { fail(it, e.message); }
    }
    D.update(T_SEP, sep.id, { transfer_docs: (S.get(sep.id).transfer_docs || []).concat([{ document_id: doc.id, full_number: doc.full_number, total: doc.total, guides: Object.values(guides), at: now() }]) }, { silent: true });
  };
  let RUN = null;
  const done = (it, result, refs = [], extra = {}) => { D.update(T_IT, it.id, Object.assign({ status: 'DONE', result, refs, error: null, attempts: (it.attempts || 0) + 1, executed_at: RUN ? RUN.at : now() }, extra), { silent: true }); };
  const fail = (it, msg) => { D.update(T_IT, it.id, { status: 'FAILED', error: msg, attempts: (it.attempts || 0) + 1, executed_at: RUN ? RUN.at : now() }, { silent: true }); };
  const EXEC = {
    SERIES_NEW(sep, it, dry) {
      if (D.find('document_series', s => s.series === it.code)) G.fail('RN-PLT-03', `La serie ${it.code} ya existe: cambia el código en SEP-04.`);
      if (!/^[FB][A-Z0-9]{3}$/.test(it.code)) G.fail('RN-PLT-03', `${it.code} no es un código de serie electrónica válido (F o B y 3 caracteres).`);
      if (dry) return `Simulado: se crearía ${it.code} para ${coName(sep.dest_company_id)}`;
      const s = D.insert('document_series', { id: 'se-' + it.code, company_id: sep.dest_company_id, establishment_id: 'es-L1', brand_id: sep.brand_id, doc_type: it.doc_type, series: it.code, next_number: 1, is_electronic: true, status: 'INACTIVE', applies_to: it.applies_to || null, all_sites: true, created_by_separation_id: sep.id, valid_from: G.date.add(sep.cutoff_date, 1) });
      return { result: `Serie ${it.code} creada para ${coName(sep.dest_company_id)}; se activa al completar`, refs: [s.id] };
    },
    PRODUCT(sep, it, dry) {
      const p = D.get('products', it.ref_id); if (!p) G.fail('RN-SEP-09', 'El producto ya no existe.');
      const vs = D.where('product_variants', v => v.product_id === p.id);
      if (dry) return `Simulado: ${actName('PRODUCT', it.action).toLowerCase()} ${p.name} (${vs.length} presentaciones)`;
      if (sep.dest_type === 'OTHER_RUC') return `${p.name} sigue con la marca: desde el ${F.date(G.date.add(sep.cutoff_date, 1))} se factura con ${coName(sep.dest_company_id)}`;
      if (it.action === 'COPY' && sep.dest_tenant_id) { const np = D.insert('products', Object.assign({}, p, { id: undefined, tenant: sep.dest_tenant_id, copied_from: p.id }), { silent: true }); for (const v of vs) D.insert('product_variants', Object.assign({}, v, { id: undefined, product_id: np.id, tenant: sep.dest_tenant_id, copied_from: v.id }), { silent: true }); return { result: `Copiado al tenant ${sep.dest_tenant_name || sep.dest_tenant_id} con ${vs.length} presentaciones`, refs: [np.id] }; }
      if (it.action === 'MOVE') { for (const v of vs) D.update('product_variants', v.id, { status: 'INACTIVE', sellable: false, inactive_reason: `Separación ${sep.number}` }, { silent: true }); return `Exportado y desactivado en el origen (${vs.length} presentaciones)`; }
      return `Va en el paquete de exportación (${vs.length} presentaciones)`;
    },
    PRICE_LIST(sep, it, dry) {
      const l = D.get('price_lists', it.ref_id); if (!l) G.fail('RN-SEP-09', 'La lista ya no existe.');
      if (dry) return `Simulado: ${actName('PRICE_LIST', it.action).toLowerCase()} ${it.label}`;
      if (sep.dest_type === 'OTHER_RUC') return `${it.label} sigue vigente para la marca`;
      if (it.action === 'MOVE') { D.update('price_lists', l.id, { status: 'INACTIVE' }, { silent: true }); return 'Exportada y desactivada en el origen'; }
      return `Va en el paquete (${it.qty} precios)`;
    },
    CUSTOMERS(sep, it, dry) {
      const cu = S.customers(sep);
      if (sep.dest_type === 'OTHER_RUC') return `${cu.all.length} clientes compartidos en el tenant: no se copian (RN-SEP-14)`;
      return `${dry ? 'Simulado: ' : ''}${cu.withConsent.length} clientes con consentimiento van en el paquete con sus direcciones; ${cu.withoutConsent.length} sin consentimiento no se exportan (D-SEP-03)`;
    },
    ORDER(sep, it, dry) {
      const o = D.get('sales_orders', it.ref_id); if (!o) G.fail('RN-SEP-09', 'El pedido ya no existe.');
      if (IN_PROCESS.includes(o.status)) G.fail('RN-SEP-15', `${o.number} pasó a ${G.ui.statusLabel(o.status).toLowerCase()}: termínalo antes de ejecutar este elemento.`);
      if (it.action === 'KEEP') { if (o.status === 'CANCELLED') G.fail('RN-SEP-15', `${o.number} fue cancelado.`); return `${dry ? 'Simulado: ' : ''}${o.number} se mantiene y se factura con ${coName(sep.dest_company_id)}`; }
      if (dry) return `Simulado: ${o.number} se cancelaría con aviso al cliente y se exportaría`;
      if (it.action === 'CANCEL_NOTIFY') {
        if (o.status !== 'CANCELLED') G.orders.transition(o, 'CANCELLED', { reason: `Separación ${sep.number}: ${G.brandName(sep.brand_id)} pasa a ${sep.dest_system_name || sep.dest_tenant_name || sep.dest_legal_name}` });
        const ch = S.channels(sep.brand_id).find(c => c.kind === 'WHATSAPP');
        const m = G.msg.send({ customer_id: o.customer_id, channel_id: ch ? ch.id : null, kind: 'UTILITY', template: 'aviso_cambio_marca', text: `Hola, tu pedido ${o.number} de ${G.brandName(sep.brand_id)} se canceló porque la marca pasa a ${sep.dest_legal_name || sep.dest_system_name || sep.dest_tenant_name}. Te contactarán desde su nuevo canal. Disculpa la molestia.`, ref: o.id });
        return { result: `${o.number} cancelado con aviso por WhatsApp; va en el paquete`, refs: [o.id, m.id] };
      }
      return `${o.number} va en el paquete`;
    },
    RECEIVABLE(sep, it, dry) {
      const d = D.get('sales_documents', it.ref_id); if (!d) G.fail('RN-SEP-09', 'El comprobante ya no existe.');
      if (it.action === 'ASSIGN') { if (dry) return `Simulado: se cedería ${d.full_number} (${F.money(d.balance)})`; D.update('sales_documents', d.id, { assigned_to: sep.dest_company_id || sep.dest_ruc, assigned_by_separation_id: sep.id, assigned_at: now() }, { silent: true }); return `Cedida al destino (${F.money(d.balance)}); los cobros se registran en el origen y se liquidan (RN-SEP-16)`; }
      return `${dry ? 'Simulado: ' : ''}${d.full_number} queda en ${coName(d.company_id || 'co-dg')} (${F.money(d.balance)})`;
    },
    CHANNEL(sep, it, dry) {
      const c = D.get('messaging_channels', it.ref_id); if (!c) G.fail('RN-SEP-09', 'El canal ya no existe.');
      const n = S.convCount(c.id);
      if (dry) return `Simulado: ${actName('CHANNEL', it.action).toLowerCase()} (${n} conversaciones)`;
      if (it.action === 'KEEP_INBOX') return `${c.number} sigue en la bandeja con ${n} conversaciones; solo cambia la empresa que factura`;
      if (it.action === 'MIGRATE') { D.update('messaging_channels', c.id, { status: 'MIGRATED', migrated_to_tenant: sep.dest_tenant_id || sep.dest_tenant_name, migrated_at: now() }, { silent: true }); return `Migración solicitada al proveedor oficial (${c.provider || 'CLOUD_API'}) hacia ${sep.dest_tenant_name || sep.dest_tenant_id}; ${n} conversaciones van en el paquete`; }
      D.update('messaging_channels', c.id, { status: 'DISCONNECTED', disconnected_at: now(), disconnect_reason: `Separación ${sep.number}` }, { silent: true });
      return `Desconectado de CRM; su historial (${n} conversaciones) va en el paquete`;
    },
    WEB_STORE(sep, it, dry) {
      if (dry) return `Simulado: ${actName('WEB_STORE', it.action).toLowerCase()}`;
      if (it.action === 'DISCONNECT') { let n = 0; for (const p of D.where('products', p => p.brand_id === sep.brand_id && p.web_publishable)) { D.update('products', p.id, { web_publishable: false }, { silent: true }); n++; } return `Tienda desconectada: ${n} productos despublicados`; }
      return `Tienda reasignada a ${coName(sep.dest_company_id)}: los cobros web desde el ${F.date(G.date.add(sep.cutoff_date, 1))} se emiten con su RUC`;
    },
    AD_ACCOUNT(sep, it, dry) {
      const a = D.get('ad_accounts', it.ref_id); if (!a) G.fail('RN-SEP-09', 'La cuenta ya no existe.');
      if (dry) return `Simulado: ${actName('AD_ACCOUNT', it.action).toLowerCase()} ${a.name || a.id}`;
      if (it.action === 'DISCONNECT') { D.update('ad_accounts', a.id, { status: 'DISCONNECTED', disconnected_at: now() }, { silent: true }); return 'Desconectada; el gasto anterior al corte queda en el origen (RN-SEP-20)'; }
      D.update('ad_accounts', a.id, { company_id: sep.dest_company_id, reassigned_at: now() }, { silent: true }); return `Reasignada a ${coName(sep.dest_company_id)}; el gasto anterior al corte queda en el origen (RN-SEP-20)`;
    },
    CASH_ACCOUNT(sep, it, dry) { return dry ? 'Simulado' : `${it.label}: ${actName('CASH_ACCOUNT', it.action).toLowerCase()}`; },
    USER(sep, it, dry) {
      const u = D.get('users', it.ref_id); if (!u) G.fail('RN-SEP-09', 'El usuario ya no existe.');
      if (dry) return `Simulado: ${actName('USER', it.action).toLowerCase()}`;
      if (it.action === 'REMOVE_SCOPE') { D.update('users', u.id, { brands: (u.brands || []).filter(b => b !== sep.brand_id) }, { silent: true }); return `Sin ${G.brandName(sep.brand_id)} en su alcance; conserva ${(u.brands || []).filter(b => b !== sep.brand_id).map(G.brandName).join(', ') || 'sin marcas'}`; }
      if (it.action === 'MOVE') { D.update('users', u.id, { status: 'INACTIVE', inactive_reason: `Pasa al destino de la separación ${sep.number}` }, { silent: true }); return 'Desactivado en el origen: su cuenta se crea en el destino'; }
      return 'Se mantiene sin cambios';
    },
    WAREHOUSE(sep, it, dry) { return dry ? 'Simulado' : `${it.label}: ${actName('WAREHOUSE', it.action).toLowerCase()}`; },
    SERIES_ORIGIN(sep, it, dry) {
      const s = D.get('document_series', it.ref_id); if (!s) G.fail('RN-SEP-09', 'La serie ya no existe.');
      if (it.action === 'KEEP') return `${s.series} se mantiene para notas de crédito y débito de comprobantes anteriores al corte`;
      if (dry) return `Simulado: se cerraría ${s.series} (último número ${s.next_number - 1})`;
      D.update('document_series', s.id, { status: 'INACTIVE', closed_at: now(), closed_reason: `Separación ${sep.number} · corte ${F.date(sep.cutoff_date)}` });
      return `${s.series} cerrada en el origen (último número ${s.next_number - 1})`;
    },
  };
  /** ejecuta los elementos pendientes o fallidos; con todos hechos o excluidos intenta completar */
  S.execute = function (id, o = {}) {
    const sep = S.get(id);
    if (!o.seed && !G.can('sep.separation.execute')) G.fail('RN-SEP-08', `Tu rol (${G.roleName()}) no tiene el permiso sep.separation.execute.`);
    if (sep.status === 'COMPLETED') G.fail('RN-SEP-11', `${sep.number} ya está completada: es irreversible.`);
    if (!['APPROVED', 'EXECUTING', 'FAILED'].includes(sep.status)) G.fail('RN-SEP-11', `${sep.number} está ${(ST[sep.status] || [sep.status])[0].toLowerCase()}: se ejecuta una separación aprobada.`);
    if (!sep.simulation) assertCutoffClosed(sep, 'ejecutar');
    const dry = !!sep.simulation;
    RUN = { at: o.at || now() };
    try {
      D.update(T_SEP, id, { status: 'EXECUTING', executed_at: sep.executed_at || RUN.at, history: sep.status === 'EXECUTING' ? sep.history : pushHist(sep, 'EXECUTING', sep.status === 'FAILED' ? 'Reintento de elementos fallidos' : dry ? 'Ejecución simulada' : null, o) }, { silent: !!o.seed });
      const pend = S.items(id).filter(i => ['PENDING', 'FAILED'].includes(i.status) && (!o.only || o.only.includes(i.id)));
      const stock = pend.filter(i => i.item_type === 'STOCK');
      for (const it of pend.filter(i => i.item_type !== 'STOCK' && i.item_type !== 'SERIES_ORIGIN')) runOne(sep, it, dry);
      const trf = stock.filter(i => i.action === 'TRANSFER');
      if (trf.length) execStock(S.get(id), trf, dry);
      for (const it of stock.filter(i => i.action !== 'TRANSFER')) done(it, it.action === 'LEAVE' ? `${dry ? 'Simulado: ' : ''}Se deja en ${G.whName(it.warehouse_id)} (${coName(sep.origin_company_id)})` : `${dry ? 'Simulado: ' : ''}Stock al corte en el paquete (${F.num(it.qty_at_cutoff, 3)} ${it.uom})`);
      for (const it of pend.filter(i => i.item_type === 'SERIES_ORIGIN')) runOne(sep, it, dry);
    } finally { RUN = null; }
    const its = S.items(id); const failed = its.filter(i => i.status === 'FAILED');
    const cur = S.get(id);
    if (failed.length) { D.update(T_SEP, id, { status: 'FAILED', history: pushHist(cur, 'FAILED', `${failed.length} elemento(s) fallaron: reintenta desde SEP-09`, o) }, { silent: !!o.seed }); return S.get(id); }
    if (S.canComplete(cur).ok) return S.complete(id, o);
    return cur;
  };
  const runOne = (sep, it, dry) => { try { const r = EXEC[it.item_type](S.get(sep.id), D.get(T_IT, it.id), dry); if (r && typeof r === 'object') done(it, r.result, r.refs || []); else done(it, r || 'Hecho'); } catch (e) { fail(it, e.message); } };
  S.retryItem = function (itemId) { const it = D.get(T_IT, itemId); return S.execute(it.separation_id, { only: [itemId] }); };
  S.canComplete = function (sep) {
    const its = S.items(sep.id); const open = its.filter(i => !['DONE', 'EXCLUDED'].includes(i.status));
    if (open.length) return { ok: false, rule: 'RN-SEP-09', msg: `Faltan ${open.length} elemento(s) por hacer o excluir: ${open.slice(0, 4).map(i => i.label).join(', ')}.` };
    if (sep.dest_type !== 'OTHER_RUC' && !(sep.export && sep.export.sha256)) return { ok: false, rule: 'RN-SEP-10', msg: `${destName(sep.dest_type)}: genera el paquete de exportación con su huella SHA-256 en SEP-10 antes de completar.` };
    return { ok: true };
  };
  /** completa: vigencias de empresa, series nuevas activas, marca SEPARATED si sale del tenant, acta (RN-SEP-09/10/18) */
  S.complete = function (id, o = {}) {
    const sep = S.get(id);
    if (sep.status === 'COMPLETED') G.fail('RN-SEP-11', `${sep.number} ya está completada.`);
    if (!['EXECUTING'].includes(sep.status)) G.fail('RN-SEP-11', `${sep.number} está ${(ST[sep.status] || [sep.status])[0].toLowerCase()}: se completa una separación en ejecución.`);
    const c = S.canComplete(sep); if (!c.ok) G.fail(c.rule, c.msg);
    const at = o.at || now();
    if (!sep.simulation) {
      const next = G.date.add(sep.cutoff_date, 1);
      S.closeHistory(sep.brand_id, sep.cutoff_date, { separation_id: sep.id, silent: !!o.seed });
      if (sep.dest_type === 'OTHER_RUC') S.addHistory({ brand_id: sep.brand_id, company_id: sep.dest_company_id, valid_from: next, valid_to: null, separation_id: sep.id, reason: `Separación ${sep.number}` }, { silent: !!o.seed });
      for (const it of S.items(id, 'SERIES_NEW').filter(i => i.status === 'DONE')) { const s = D.find('document_series', x => x.series === it.code); if (s) D.update('document_series', s.id, { status: 'ACTIVE', activated_at: at }, { silent: true }); }
      const b = brandOf(sep.brand_id); const co = coOf(sep.dest_company_id);
      if (sep.dest_type === 'OTHER_RUC') {
        D.update('brands', sep.brand_id, { company_id: sep.dest_company_id, separated_at: at, separation_id: sep.id, legal_footer: `Representación impresa del comprobante electrónico · ${b.name} es una marca de ${co.legal_name} · RUC ${co.ruc}` });
        if (co.status === 'PREPARING') D.update('companies', co.id, { status: 'ACTIVE' });
      } else D.update('brands', sep.brand_id, { status: 'SEPARATED', separated_at: at, separation_id: sep.id });
    }
    D.update(T_SEP, id, { status: 'COMPLETED', completed_at: at, history: pushHist(S.get(id), 'COMPLETED', sep.simulation ? 'Simulación completada: no se cambiaron datos' : null, o) }, { silent: !!o.seed });
    S.generateAct(id, o);
    if (!o.seed) G.audit('SEPARACION', T_SEP, id, `${sep.number} completada · ${G.brandName(sep.brand_id)} → ${sep.dest_legal_name || sep.dest_tenant_name || sep.dest_system_name}${sep.simulation ? ' (simulación)' : ''}`);
    return S.get(id);
  };

  /* ------------------------------------------------------------------
     Exportación completa (SEP-10) · RN-SEP-14/19
     ------------------------------------------------------------------ */
  S.exportData = function (sep) {
    const brand = sep.brand_id;
    const prods = D.where('products', p => p.brand_id === brand), vars = S.brandVariants(brand);
    const lists = D.where('price_lists', l => l.brand_id === brand); const lids = new Set(lists.map(l => l.id));
    const cu = S.customers(sep); const cids = new Set(cu.withConsent.map(c => c.id));
    const addrs = D.where('customer_addresses', a => cids.has(a.customer_id));
    const ruc = coRuc(sep.origin_company_id);
    const docs = D.where('sales_documents', d => d.brand_id === brand).map(d => { const code = { INVOICE: '01', RECEIPT: '03', CREDIT_NOTE: '07', DEBIT_NOTE: '08' }[d.doc_type] || '00'; const base = `${(coOf(d.company_id || 'co-dg') || {}).ruc || ruc}-${code}-${d.series}-${d.number}`; return Object.assign({}, d, { files: { xml: base + '.xml', pdf: base + '.pdf', cdr: d.sunat_status === 'ACCEPTED' ? 'R-' + base + '.zip' : null } }); });
    const chans = S.channels(brand); const chIds = new Set(chans.map(c => c.id));
    const conv = D.where('conversations', c => chIds.has(c.channel_id)); const cvIds = new Set(conv.map(c => c.id));
    return {
      catalogo: prods, presentaciones: vars, listas_de_precio: lists, precios: D.where('price_list_items', i => lids.has(i.list_id)),
      clientes: cu.withConsent, direcciones: addrs, pedidos: D.where('sales_orders', o => o.brand_id === brand), comprobantes: docs,
      stock_al_corte: S.items(sep.id, 'STOCK').map(i => ({ almacen: i.warehouse_id, presentacion: i.variant_id, lote: i.lot_id, vence: i.expiry_date, cantidad_al_corte: i.qty_at_cutoff, accion: i.action, cantidad: i.qty, costo_promedio: i.unit_cost })),
      saldos_por_cobrar: S.receivables(sep).map(d => ({ comprobante: d.full_number, cliente: d.customer_name, vence: d.due_date, saldo: d.balance, accion: sep.receivables_policy })),
      canales: chans, conversaciones: conv, mensajes: D.where('conversation_messages', m => cvIds.has(m.conversation_id)),
    };
  };
  S.exportCounts = sep => Object.entries(S.exportData(sep)).map(([k, rows]) => ({ dataset: k, rows: rows.length, file: `${sep.number.toLowerCase()}/${k}.csv` }));
  /** genera el paquete (JSON de Aycha + CSV), su huella y su tamaño; se registra como exportación con datos personales (requiere aprobación de otra persona) */
  S.buildExport = function (id, o = {}) {
    if (!o.seed) assertPrep();
    const sep = S.get(id);
    if (!['APPROVED', 'EXECUTING', 'FAILED', 'COMPLETED'].includes(sep.status)) G.fail('RN-SEP-19', `${sep.number} está ${(ST[sep.status] || [sep.status])[0].toLowerCase()}: el paquete se genera de una separación aprobada.`);
    if (sep.status === 'COMPLETED' && sep.export && sep.export.sha256) G.fail('RN-SEP-11', `${sep.number} está completada: su paquete ${sep.export.file_name} ya quedó registrado.`);
    const at = o.at || now();
    const data = S.exportData(sep);
    const pkg = { formato: 'aycha-separacion-v1', separacion: sep.number, marca: brandOf(sep.brand_id).name, empresa_origen: { razon_social: coName(sep.origin_company_id), ruc: coRuc(sep.origin_company_id) }, destino: { tipo: sep.dest_type, razon_social: sep.dest_legal_name, ruc: sep.dest_ruc, tenant: sep.dest_tenant_name, sistema: sep.dest_system_name }, fecha_corte: sep.cutoff_date, generado: at, datos: data };
    const json = JSON.stringify(pkg);
    const csvBytes = U.sum(Object.values(data), rows => rows.length * 140);
    const sha = S.sha256(json);
    const rows = U.sum(Object.values(data), r => r.length);
    const number = `EXP-${sep.number}`;
    const prev = D.find('data_exports', x => x.separation_id === sep.id && x.status !== 'REJECTED');
    const exp = { number, report: 'brand_separation', report_name: `Paquete de separación ${sep.number} · ${G.brandName(sep.brand_id)}`, filters: { brand: sep.brand_id, cutoff: sep.cutoff_date }, format: 'JSON+CSV', rows_count: rows, contains_personal_data: true, reason: `Separación ${sep.number} a ${destName(sep.dest_type).toLowerCase()}`, status: 'PENDING_APPROVAL', requested_by_id: o.by || me(), requested_by: o.byName || meName(), requested_role: G.ctx.role, requested_at: at, source_module: 'SEP', approved_by: null, approved_by_id: null, approved_at: null, link_expires_at: null, file_name: `${sep.number}-${brandOf(sep.brand_id).code}-${sep.cutoff_date.replace(/-/g, '')}.zip`, sha256: sha, size_bytes: byteLen(json) + csvBytes, separation_id: sep.id, downloads: [], watermark: `${o.byName || meName()} · ${F.datetime(at)} · ${number}` };
    const row = prev ? D.update('data_exports', prev.id, exp, { silent: !!o.seed }) : D.insert('data_exports', exp, { silent: !!o.seed });
    D.update(T_SEP, id, { export: { data_export_id: row.id, file_name: exp.file_name, sha256: sha, size_bytes: exp.size_bytes, json_bytes: byteLen(json), rows, generated_at: at, generated_by: exp.requested_by, counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])) } }, { silent: !!o.seed });
    S._lastJson = json;
    if (!o.seed) G.notify({ role: 'GERENTE', title: `${number} por aprobar`, body: 'Exportación con datos personales (RN-SEP-19).', ref: sep.id, module: 'SEP', tone: 'warn' });
    return S.get(id).export;
  };
  S.exportRow = sep => sep && sep.export && sep.export.data_export_id ? D.get('data_exports', sep.export.data_export_id) : null;
  S.approveExport = function (id, o = {}) {
    const sep = S.get(id); const x = S.exportRow(sep); if (!x) G.fail('RN-SEP-19', 'Primero genera el paquete.');
    if (!o.seed && !G.can('sep.export.download')) G.fail('RN-SEP-19', `Tu rol (${G.roleName()}) no tiene el permiso sep.export.download.`);
    const by = o.by || me();
    if (by === x.requested_by_id) G.fail('RN-SEP-19', `${x.requested_by} generó el paquete: lo aprueba otra persona (exportación con datos personales).`);
    const at = o.at || now(); const hrs = Number(G.param('sep_export_link_hours') ?? 72);
    const exp = new Date(Date.parse(at.length === 16 ? at + ':00Z' : at.slice(0, 19) + 'Z') + hrs * 3600000).toISOString().slice(0, 16);
    D.update('data_exports', x.id, { status: 'READY', approved_by: o.byName || meName(), approved_by_id: by, approved_at: at, link_expires_at: exp, link_token: S.sha256(x.sha256 + at).slice(0, 24) }, { silent: !!o.seed });
    return D.get('data_exports', x.id);
  };
  S.linkState = x => !x ? 'NONE' : x.status === 'PENDING_APPROVAL' ? 'PENDING' : x.status === 'REJECTED' ? 'REJECTED' : x.link_expires_at && x.link_expires_at < now().slice(0, 16) ? 'EXPIRED' : 'READY';
  S.download = function (id) {
    const sep = S.get(id); const x = S.exportRow(sep);
    if (!G.can('sep.export.download')) G.fail('RN-SEP-19', `Tu rol (${G.roleName()}) no tiene el permiso sep.export.download.`);
    const st = S.linkState(x);
    if (st === 'PENDING') G.fail('RN-SEP-19', 'El paquete espera la aprobación de otra persona.');
    if (st === 'EXPIRED') G.fail('RN-SEP-19', `El enlace venció el ${F.datetime(x.link_expires_at)} (sep_export_link_hours). Genera el paquete de nuevo.`);
    if (st !== 'READY') G.fail('RN-SEP-19', 'No hay un paquete listo.');
    D.update('data_exports', x.id, { downloads: (x.downloads || []).concat([{ at: now(), by: meName() }]) });
    const json = S._lastJson || JSON.stringify({ separacion: sep.number, sha256: x.sha256, datos: S.exportData(sep) });
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = x.file_name.replace(/\.zip$/, '.json'); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); } catch (e) { /* sin descarga en este navegador */ }
    return x;
  };

  /* ------------------------------------------------------------------
     Acta (SEP-11) · RN-SEP-18
     ------------------------------------------------------------------ */
  S.actData = function (sep) {
    const stock = S.items(sep.id, 'STOCK').filter(i => i.action === 'TRANSFER' && i.status !== 'EXCLUDED');
    const rec = S.items(sep.id, 'RECEIVABLE');
    return { stock, sent: R(U.sum(stock, i => i.qty), 3), received: R(U.sum(stock, i => i.received_qty || 0), 3), value: R(U.sum(stock, i => i.qty * i.unit_cost)), rec, recKeep: R(U.sum(rec.filter(i => i.action === 'KEEP_ORIGIN'), i => i.amount)), recAssign: R(U.sum(rec.filter(i => i.action === 'ASSIGN'), i => i.amount)), docs: sep.transfer_docs || [], orders: S.items(sep.id, 'ORDER') };
  };
  S.generateAct = function (id, o = {}) {
    const sep = S.get(id); const a = S.actData(sep); const at = o.at || now();
    const text = [sep.number, sep.brand_id, sep.cutoff_date, sep.origin_company_id, sep.dest_ruc, a.sent, a.received, a.recKeep, a.recAssign, a.docs.map(d => d.full_number).join(','), sep.prepared_by_name, sep.approved_by_name, at].join('|');
    const sha = S.sha256(text);
    const file = `Acta-${sep.number}.pdf`;
    const att = D.insert('file_attachments', { entity: T_SEP, entity_id: sep.id, file_name: file, ext: 'PDF', mime: 'application/pdf', size_bytes: 48000 + a.stock.length * 900, sha256: sha, classification: 'CONFIDENTIAL', storage_key: `s3://aycha-${String(G.ctx.tenant).toLowerCase()}-files/${T_SEP}/${sep.id}/${sha.slice(0, 16)}.pdf`, status: 'ACTIVE', uploaded_by: o.byName || meName(), uploaded_at: at, links: [] }, { silent: true });
    D.update(T_SEP, id, { act: { generated_at: at, generated_by: o.byName || meName(), sha256: sha, file_name: file, attachment_id: att.id } }, { silent: true });
    if (!o.seed) G.audit('ACTA', T_SEP, id, `${file} · SHA-256 ${sha.slice(0, 16)}…`);
    return S.get(id).act;
  };

  /* ------------------------------------------------------------------
     Indicadores (KPI-SEP-01, KPI-SEP-02)
     ------------------------------------------------------------------ */
  const sepsIn = p => D.where(T_SEP, s => !s.simulation && ['EXECUTING', 'COMPLETED', 'FAILED'].includes(s.status) && (!p.brand || s.brand_id === p.brand) && (!p.from || String(s.executed_at || '').slice(0, 10) >= p.from) && (!p.to || String(s.executed_at || '').slice(0, 10) <= p.to));
  G.kpiCalc['KPI-SEP-01'] = p => { const its = []; for (const s of sepsIn(p)) its.push(...S.items(s.id, 'STOCK').filter(i => i.action === 'TRANSFER' && i.status === 'DONE')); return { value: R(U.sum(its, i => Math.abs((i.qty || 0) - (i.received_qty || 0))), 3), numerator: its.length, denominator: null, detail: `${its.length} lotes traspasados` }; };
  G.kpiCalc['KPI-SEP-02'] = p => { const its = []; for (const s of sepsIn(p)) its.push(...S.items(s.id, 'ORDER')); const ok = its.filter(i => ['DONE', 'EXCLUDED'].includes(i.status)).length; return { value: its.length ? R(ok / its.length * 100, 1) : null, numerator: ok, denominator: its.length }; };

  /* ------------------------------------------------------------------
     Ganchos globales
     ------------------------------------------------------------------ */
  G.alertProviders.push(() => {
    const out = [];
    for (const s of D.where(T_SEP, x => LIVE.includes(x.status))) {
      const sm = S.checkSummary(s.id);
      if (s.status === 'FAILED') out.push({ module: 'SEP', title: `${s.number}: ${S.items(s.id).filter(i => i.status === 'FAILED').length} elemento(s) fallaron`, detail: 'Reintenta desde la ejecución (SEP-09).', tone: 'bad', go: () => G.go('SEP-09', { id: s.id }) });
      else if (sm.fail) out.push({ module: 'SEP', title: `${s.number}: ${sm.fail} validación(es) en FAIL`, detail: S.checks(s.id).filter(c => c.result === 'FAIL').map(c => c.code).join(', '), tone: 'warn', go: () => G.go('SEP-03', { id: s.id }) });
      if (!s.simulation && ['VALIDATED', 'APPROVED'].includes(s.status) && !G.period.isClosed(s.cutoff_date)) out.push({ module: 'SEP', title: `${s.number} espera el cierre de ${G.date.monthName(s.cutoff_date)}`, detail: 'RN-SEP-01: se aprueba y ejecuta con el mes del corte cerrado.', tone: 'info', go: () => G.go('SEP-09', { id: s.id }) });
      const x = S.exportRow(s); if (x && x.status === 'PENDING_APPROVAL') out.push({ module: 'SEP', title: `${x.number} espera aprobación`, detail: 'Exportación con datos personales (RN-SEP-19).', tone: 'warn', go: () => G.go('SEP-10', { id: s.id }) });
    }
    return out;
  });
  G.searchProviders.push(q => { const s = String(q).toLowerCase(); return D.all(T_SEP).filter(x => [x.number, G.brandName(x.brand_id), x.dest_legal_name, x.dest_system_name, x.dest_tenant_name].some(v => v && String(v).toLowerCase().includes(s))).slice(0, 6).map(x => ({ label: `Separación ${x.number}`, sub: `${G.brandName(x.brand_id)} → ${x.dest_legal_name || x.dest_tenant_name || x.dest_system_name} · ${(ST[x.status] || [x.status])[0]}`, go: () => G.go('SEP-09', { id: x.id }) })); });
  if (G.scanHandlers) G.scanHandlers.push(code => { const s = D.find(T_SEP, x => x.number === code || (x.export && ('EXP-' + x.number) === code)); return s ? () => G.go('SEP-09', { id: s.id }) : null; });

  /* ------------------------------------------------------------------
     Interfaz
     ------------------------------------------------------------------ */
  const STEPS = [['SEP-02', 'Destino y corte'], ['SEP-03', 'Validaciones'], ['SEP-04', 'Catálogo y series'], ['SEP-05', 'Stock'], ['SEP-06', 'Clientes y pedidos'], ['SEP-07', 'Canales'], ['SEP-08', 'Usuarios y locales'], ['SEP-09', 'Aprobación'], ['SEP-10', 'Exportación'], ['SEP-11', 'Acta']];
  const tryDo = (fn, okMsg) => { try { const r = fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); return null; } };
  const pickSep = params => { if (params && params.id) { const s = S.get(params.id); if (s) return s; } return D.find(T_SEP, s => LIVE.includes(s.status) && !s.simulation && G.scope.ok(s, { brand: 'brand_id', site: '_' })) || S.all().filter(s => G.scope.ok(s, { brand: 'brand_id', site: '_' }))[0] || null; };
  const sepSelect = (sep, screen) => h('select', { class: 'input', style: 'max-width:280px', attrs: { 'aria-label': 'Separación' }, on: { change: e => G.go(screen, { id: e.target.value }) } }, S.all().map(s => h('option', { value: s.id, selected: sep && s.id === sep.id }, `${s.number} · ${G.brandName(s.brand_id)} · ${(ST[s.status] || [s.status])[0]}${s.simulation ? ' (simulación)' : ''}`)));
  const destLabel = s => s.dest_type === 'OTHER_RUC' ? `${s.dest_legal_name} · RUC ${s.dest_ruc}` : s.dest_type === 'OTHER_TENANT' ? `${s.dest_tenant_name || s.dest_tenant_id}${s.dest_ruc ? ' · RUC ' + s.dest_ruc : ''}` : `${s.dest_system_name}${s.dest_ruc ? ' · RUC ' + s.dest_ruc : ''}`;
  function wizard(sep, cur) {
    const ci = STEPS.findIndex(s => s[0] === cur);
    return h('div', { class: 'steps', attrs: { role: 'navigation', 'aria-label': 'Pasos de la separación' } }, STEPS.map(([code, name], i) => h('div', { class: 'step' + (i < ci ? ' done' : i === ci ? ' cur' : ''), style: 'cursor:pointer', attrs: { role: 'link', tabindex: '0' }, on: { click: () => G.go(code, sep ? { id: sep.id } : {}) } }, h('span', { class: 'n' }, String(i + 1)), name)));
  }
  function sepHead(sep) {
    const sm = S.checkSummary(sep.id); const its = S.items(sep.id); const doneN = its.filter(i => ['DONE', 'EXCLUDED'].includes(i.status)).length;
    return h('div', { class: 'row between', style: 'gap:12px' },
      h('div', { class: 'row', style: 'gap:8px' }, h('b', { class: 'mono' }, sep.number), brandLbl(sep.brand_id), h('span', { class: 'muted' }, '→'), h('span', null, destName(sep.dest_type) + ': ' + destLabel(sep)), stBadge(sep.status), sep.simulation ? badge('Simulación', 'info') : null),
      h('div', { class: 'row small muted', style: 'gap:12px' }, h('span', null, `Corte ${F.date(sep.cutoff_date)}`), h('span', null, `Validaciones ${sm.total ? `${sm.pass}/${sm.warn}/${sm.fail}` : 'sin ejecutar'}`), h('span', null, `Elementos ${doneN}/${its.length}`)));
  }
  /** encabezado común de las pantallas del asistente */
  function wizPage(el, code, title, sub, params, extra = []) {
    const sep = pickSep(params);
    const body = page(el, { code, title, sub, actions: [sep ? sepSelect(sep, code) : null, ...extra].filter(Boolean) });
    if (!sep) { body.appendChild(notice(h('span', null, 'Aún no hay separaciones. ', btn('Nueva separación', () => G.go('SEP-02'), { sm: true, kind: 'primary' })), 'info')); return { body, sep: null }; }
    body.appendChild(wizard(sep, code));
    body.appendChild(card(null, sepHead(sep)));
    if (S.isLocked(sep) && !['SEP-09', 'SEP-10', 'SEP-11'].includes(code)) body.appendChild(notice(`RN-SEP-11: ${sep.number} está ${(ST[sep.status] || [sep.status])[0].toLowerCase()}; su alcance ya no cambia.${sep.status === 'COMPLETED' ? ' Completada es irreversible: deshacerla es otra separación en sentido inverso.' : ''}`, sep.status === 'COMPLETED' ? 'info' : 'warn'));
    return { body, sep };
  }
  const actSelect = (it, sep) => h('select', { class: 'input', style: 'min-width:170px', disabled: S.isLocked(sep) || !canPrep() || it.status === 'EXCLUDED', attrs: { 'aria-label': 'Acción de ' + it.label }, on: { click: e => e.stopPropagation(), change: e => tryDo(() => S.setItem(it.id, { action: e.target.value }), 'Acción actualizada') } }, S.actionsFor(it.item_type, sep.dest_type).map(([v, l]) => h('option', { value: v, selected: v === it.action }, l)));
  const excludeBtn = (it, sep) => it.status === 'EXCLUDED'
    ? btn('Incluir', () => tryDo(() => S.setItem(it.id, { status: 'PENDING' }), 'Elemento incluido'), { sm: true, disabled: S.isLocked(sep) || !canPrep() })
    : btn('Excluir', () => askReason(`Excluir ${it.label}`, 'Motivo (queda en el acta)', r => S.setItem(it.id, { status: 'EXCLUDED', exclude_reason: r }), 'Elemento excluido'), { sm: true, kind: 'ghost', disabled: (S.isLocked(sep) && !(sep.status === 'FAILED' && it.status === 'FAILED')) || !canPrep() || it.status === 'DONE' });
  function askReason(title, label, fn, okMsg) {
    modal(title, (b, close) => b.appendChild(form({ id: 'sep-reason', fields: [{ key: 'reason', label, type: 'textarea', required: true }], submitLabel: 'Confirmar', onCancel: close, onSubmit: v => { try { fn(v.reason); close(); toast(okMsg, 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })));
  }
  function itemDrawer(it, sep) {
    drawer(it.label, b => {
      b.appendChild(dl([['Tipo', typeName(it.item_type)], ['Acción', actName(it.item_type, it.action)], ['Estado', itBadge(it.status)], it.qty != null ? ['Cantidad', `${F.num(it.qty, 3)} ${it.uom || ''}`] : null, it.qty_at_cutoff != null ? ['Saldo kardex al corte', `${F.num(it.qty_at_cutoff, 3)} ${it.uom}`] : null, it.received_qty != null ? ['Recibido en destino', `${F.num(it.received_qty, 3)} ${it.uom}`] : null, it.amount != null ? ['Importe', F.money(it.amount)] : null, it.warehouse_id ? ['Almacén', G.whName(it.warehouse_id)] : null, it.expiry_date ? ['Vence', F.date(it.expiry_date)] : null, it.unit_cost != null ? ['Costo promedio', F.money(it.unit_cost)] : null, ['Intentos', String(it.attempts || 0)], ['Ejecutado', it.executed_at ? F.datetime(it.executed_at) : '—'], ['Resultado', it.result || '—'], it.error ? ['Error', h('span', { style: 'color:var(--bad)' }, it.error)] : null, it.exclude_reason ? ['Motivo de exclusión', it.exclude_reason] : null, it.note ? ['Nota', it.note] : null]));
      const acts = h('div', { class: 'row', style: 'margin-top:12px' });
      if (it.status === 'FAILED' && G.can('sep.separation.execute')) acts.appendChild(btn('Reintentar', () => { tryDo(() => S.retryItem(it.id), r => `Reintento: ${(ST[r.status] || [r.status])[0]}`); }, { kind: 'primary', sm: true }));
      if (it.item_type === 'ORDER' && it.ref_id && G.screens['PED-02']) acts.appendChild(btn('Abrir pedido', () => G.go('PED-02', { id: it.ref_id }), { sm: true }));
      if (acts.children.length) b.appendChild(acts);
    }, { code: 'SEP-09' });
  }
  const itemsTable = (sep, rows, extraCols = [], o = {}) => table({
    id: o.id, columns: [{ key: 'label', label: 'Elemento', render: o.labelRender || (it => it.label), value: it => it.label }, ...extraCols, { key: 'action', label: 'Acción', render: it => actSelect(it, sep), value: it => actName(it.item_type, it.action) }, { key: 'status', label: 'Estado', render: it => itBadge(it.status), value: it => it.status }],
    rows, onRow: it => itemDrawer(it, sep), actions: it => [excludeBtn(it, sep)], filters: o.filters, pageSize: o.pageSize || 15, empty: o.empty, search: o.search,
  });
  const DECISIONS = {
    'D-SEP-01': ['¿A qué valor se traspasa el stock al nuevo RUC y con qué comprobante? Lo confirma la contadora.', 'Factura de venta al costo promedio, con guía de remisión motivo venta.'],
    'D-SEP-02': ['¿La línea gourmet irá a otro RUC dentro de Aycha o a otro sistema?', 'Otro RUC dentro de Aycha.'],
    'D-SEP-03': ['¿Pasar datos de clientes a otra empresa exige un consentimiento nuevo (Ley de Protección de Datos Personales)? Lo confirma asesoría legal.', 'Se exportan solo con consentimiento de marketing registrado.'],
    'D-SEP-04': ['¿Las cuentas por cobrar de la marca se ceden al nuevo RUC?', 'Se quedan en el origen.'],
  };
  const DEC = id => { const d = DECISIONS[id]; return d ? notice(h('span', null, h('b', null, `${id}: valor provisional. `), d[1], h('span', { class: 'muted' }, ` · ${d[0]}`)), 'info') : h('span'); };

  /* ---------- SEP-01 Separaciones ---------- */
  function sep01(el) {
    const body = page(el, { code: 'SEP-01', title: 'Separaciones', sub: 'Cada separación saca una marca a otro RUC del tenant, a otra empresa en Aycha o a otro sistema, con corte en un mes cerrado y sin reescribir el histórico.', actions: [canPrep() ? { label: 'Nueva separación', kind: 'primary', icon: '+', onClick: () => G.go('SEP-02') } : null].filter(Boolean) });
    const rows = S.all().filter(s => G.scope.ok(s, { brand: 'brand_id', site: '_' }));
    const k1 = G.kpi('KPI-SEP-01', { from: null, to: null }) || {}, k2 = G.kpi('KPI-SEP-02', { from: null, to: null }) || {};
    body.appendChild(kpis([
      { label: 'En curso', value: String(rows.filter(s => LIVE.includes(s.status) && !s.simulation).length), sub: 'borrador a ejecución', tone: rows.some(s => s.status === 'FAILED') ? 'bad' : '' },
      { label: 'Completadas', value: String(rows.filter(s => s.status === 'COMPLETED' && !s.simulation).length), sub: 'irreversibles (RN-SEP-11)' },
      { label: 'Simulaciones', value: String(rows.filter(s => s.simulation).length), sub: 'ensayos sin cambiar datos' },
      { label: 'KPI-SEP-01 · Diferencia de stock', value: F.num(k1.value || 0, 3), sub: `${k1.numerator || 0} lotes traspasados · meta 0`, tone: k1.value ? 'bad' : 'ok' },
      { label: 'KPI-SEP-02 · Pedidos abiertos resueltos', value: k2.value == null ? '—' : F.pct(k2.value), sub: k2.denominator ? `${k2.numerator} de ${k2.denominator}` : 'sin separaciones ejecutadas', tone: k2.value != null && k2.value < 100 ? 'warn' : '' },
    ]));
    body.appendChild(DEC('D-SEP-02'));
    body.appendChild(table({
      id: 'sep01', rows, sort: 'number', dir: -1,
      columns: [{ key: 'number', label: 'Número', mono: true }, { key: 'brand_id', label: 'Marca', render: s => brandLbl(s.brand_id), value: s => G.brandName(s.brand_id) }, { key: 'dest_type', label: 'Destino', render: s => h('div', null, h('div', null, destName(s.dest_type)), h('div', { class: 'small muted' }, destLabel(s))), value: s => destName(s.dest_type) + ' ' + destLabel(s) },
        { key: 'cutoff_date', label: 'Corte', render: s => h('span', null, F.date(s.cutoff_date), ' ', G.period.isClosed(s.cutoff_date) ? badge('mes cerrado', 'ok') : badge('mes abierto', 'warn')) }, { key: 'status', label: 'Estado', render: s => h('span', { class: 'row', style: 'gap:4px' }, stBadge(s.status), s.simulation ? badge('Simulación', 'info') : null) },
        { key: 'prepared_by_name', label: 'Preparó', render: s => h('div', null, s.prepared_by_name, h('div', { class: 'small muted' }, F.datetime(s.prepared_at))) }, { key: 'approved_by_name', label: 'Aprobó', render: s => s.approved_by_name ? h('div', null, s.approved_by_name, h('div', { class: 'small muted' }, F.datetime(s.approved_at))) : '—' },
        { key: 'prog', label: 'Avance', render: s => { const its = S.items(s.id); const d = its.filter(i => ['DONE', 'EXCLUDED'].includes(i.status)).length; return h('div', { style: 'min-width:90px' }, G.ui.progress(its.length ? d / its.length * 100 : 0, s.status === 'FAILED' ? 'bad' : ''), h('div', { class: 'small muted' }, `${d}/${its.length}`)); }, value: s => S.items(s.id).filter(i => i.status === 'DONE').length }],
      filters: [{ key: 'status', label: 'Estado', options: Object.entries(ST).map(([k, v]) => [k, v[0]]) }, { key: 'dest_type', label: 'Destino', options: DEST }, { key: 'brand_id', label: 'Marca', options: D.all('brands').map(b => [b.id, G.brandName(b.id)]) }, { key: 'sim', label: 'Tipo', options: [['0', 'Real'], ['1', 'Simulación']], value: s => s.simulation ? '1' : '0' }],
      onRow: s => sepDrawer(s), empty: 'No hay separaciones.',
    }));
  }
  function sepDrawer(s) {
    drawer(`${s.number} · ${G.brandName(s.brand_id)}`, (b, close) => {
      const acts = h('div', { class: 'row' }, btn('Abrir asistente', () => { close(); G.go(s.status === 'DRAFT' ? 'SEP-03' : 'SEP-09', { id: s.id }); }, { kind: 'primary', sm: true }), btn('Historial de la marca', () => { close(); G.go('SEP-12', { brand: s.brand_id }); }, { sm: true }),
        ['DRAFT', 'VALIDATED', 'APPROVED'].includes(s.status) && canPrep() ? btn('Cancelar', () => askReason(`Cancelar ${s.number}`, 'Motivo de la cancelación', r => { S.cancel(s.id, r); close(); }, 'Separación cancelada'), { sm: true, kind: 'danger' }) : null);
      b.appendChild(acts);
      const sm = S.checkSummary(s.id); const its = S.items(s.id);
      b.appendChild(dl([['Marca', brandLbl(s.brand_id)], ['Empresa de origen', `${coName(s.origin_company_id)} · RUC ${coRuc(s.origin_company_id)}`], ['Destino', `${destName(s.dest_type)} · ${destLabel(s)}`], ['Fecha de corte', `${F.date(s.cutoff_date)} · desde el ${F.date(G.date.add(s.cutoff_date, 1))} rige el destino`], ['Estado', stBadge(s.status)], ['Simulación', s.simulation ? 'Sí: no cambia datos' : 'No'], ['Validaciones', sm.total ? `${sm.pass} PASS · ${sm.warn} WARN · ${sm.fail} FAIL (${F.datetime(s.checks_run_at)})` : 'Sin ejecutar'], ['Nota de advertencias', s.warn_note], ['Elementos', `${its.length} (${its.filter(i => i.status === 'DONE').length} hechos, ${its.filter(i => i.status === 'EXCLUDED').length} excluidos, ${its.filter(i => i.status === 'FAILED').length} fallidos)`], ['Cuentas por cobrar', s.receivables_policy === 'ASSIGN' ? 'Se ceden' : 'Quedan en el origen'], ['Preparó', `${s.prepared_by_name} · ${F.datetime(s.prepared_at)}`], ['Aprobó', s.approved_by_name ? `${s.approved_by_name} · ${F.datetime(s.approved_at)}` : '—'], ['Paquete', s.export ? `${s.export.file_name} · ${fmtBytes(s.export.size_bytes)} · SHA-256 ${s.export.sha256.slice(0, 16)}…` : '—'], ['Acta', s.act ? `${s.act.file_name} · ${F.datetime(s.act.generated_at)}` : '—'], s.cancel_reason ? ['Motivo de cancelación', s.cancel_reason] : null, ['Notas', s.notes]]));
      b.appendChild(h('h3', { style: 'margin-top:16px' }, 'Historial'));
      b.appendChild(h('div', { class: 'timeline' }, (s.history || []).slice().reverse().map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.datetime(x.at)), h('span', { class: 'dot' }), h('div', null, h('b', null, (ST[x.to] || [x.to])[0]), h('div', { class: 'small muted' }, x.user), x.note ? h('div', { class: 'small' }, x.note) : null)))));
    }, { code: 'SEP-01', wide: true });
  }

  /* ---------- SEP-02 Nueva separación: destino y corte ---------- */
  const cutoffOptions = () => { const out = []; let m = G.date.addMonths(G.date.month(G.TODAY), -12); for (let i = 0; i < 14; i++) { const e = monthEnd(m); const p = G.period.of(e); out.push([e, `${F.date(e)} · ${G.date.monthName(e)} ${p ? (p.status === 'CLOSED' ? '(cerrado)' : p.status === 'CLOSING' ? '(en cierre)' : '(abierto)') : '(sin período)'}`]); m = G.date.addMonths(m, 1); } return out.reverse(); };
  function sep02(el, params) {
    const editing = params && params.id ? S.get(params.id) : null;
    const body = page(el, { code: 'SEP-02', title: editing ? `Destino y corte · ${editing.number}` : 'Nueva separación: destino y corte', sub: 'Elige la marca, a dónde va (otro RUC del tenant, otra empresa en Aycha u otro sistema) y la fecha de corte: el último día de un mes, que debe estar cerrado para aprobar y ejecutar.', actions: [editing ? sepSelect(editing, 'SEP-02') : null, btn('Separaciones', () => G.go('SEP-01'))].filter(Boolean) });
    if (editing) { body.appendChild(wizard(editing, 'SEP-02')); body.appendChild(card(null, sepHead(editing))); }
    if (!canPrep()) body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso sep.separation.prepare: puedes revisar, no preparar.`, 'warn'));
    if (editing && S.isLocked(editing)) body.appendChild(notice(`RN-SEP-11: ${editing.number} está ${(ST[editing.status] || [editing.status])[0].toLowerCase()}: no cambia su alcance ni su fecha de corte.`, 'warn'));
    const brands = D.where('brands', b => b.status !== 'SEPARATED' && G.scope.ok({ brand_id: b.id }));
    const companies = D.all('companies');
    const tenants = D.raw('tenants').filter(t => t.id !== G.ctx.tenant);
    const values = editing ? Object.assign({}, editing) : { brand_id: (brands.find(b => !S.live(b.id)) || brands[0] || {}).id, dest_type: 'OTHER_RUC', cutoff_date: cutoffOptions().find(o => G.period.isClosed(o[0]))?.[0] || monthEnd(G.date.addMonths(G.TODAY, -1)), receivables_policy: 'KEEP_ORIGIN', dest_company_id: (companies.find(c => c.id !== 'co-dg') || {}).id || '' };
    const preview = h('div');
    const draw = v => {
      G.ui.clear(preview);
      const origin = v.brand_id ? (S.companyFor(v.brand_id, v.cutoff_date || G.TODAY) || 'co-dg') : null;
      const live = v.brand_id ? S.live(v.brand_id) : null;
      const err = S.coherence(Object.assign({}, v, { origin_company_id: origin, dest_company_id: v.dest_type === 'OTHER_RUC' ? (v.dest_company_id || (v.new_company_ruc ? 'nuevo' : '')) : (v.dest_company_id || null) }));
      const p = v.cutoff_date ? G.period.of(v.cutoff_date) : null;
      const next = v.cutoff_date ? G.date.add(v.cutoff_date, 1) : null;
      const destTxt = v.dest_type === 'OTHER_RUC' ? (v.dest_company_id ? coName(v.dest_company_id) : v.new_company_name || 'empresa nueva') : v.dest_type === 'OTHER_TENANT' ? (v.dest_tenant_name || (tenants.find(t => t.id === v.dest_tenant_id) || {}).name || 'tenant destino') : (v.dest_system_name || 'sistema destino');
      preview.append(dl([['Marca', v.brand_id ? brandLbl(v.brand_id) : '—'], ['Empresa de origen', origin ? `${coName(origin)} · RUC ${coRuc(origin)}` : '—'], ['Hasta el corte', v.cutoff_date ? `${F.date(v.cutoff_date)}: factura ${coName(origin)}` : '—'], ['Desde el', next ? `${F.date(next)}: ${v.dest_type === 'OTHER_RUC' ? 'factura ' + destTxt + ' con series nuevas' : 'la marca sale del tenant y no recibe pedidos (RN-SEP-06)'}` : '—'],
        ['Mes del corte', p ? (p.status === 'CLOSED' ? badge('Cerrado', 'ok') : h('span', { style: 'color:var(--warn);font-weight:600' }, `${p.status === 'CLOSING' ? 'En cierre' : 'Abierto'}: ciérralo antes de aprobar (RN-SEP-01)`)) : badge('Sin período', 'warn')], ['Fin de mes', isMonthEnd(v.cutoff_date) ? 'Sí' : h('span', { style: 'color:var(--bad);font-weight:600' }, 'RN-SEP-01: no es el último día del mes')],
        ['Separación viva', live && (!editing || live.id !== editing.id) && !v.simulation ? h('span', { style: 'color:var(--bad);font-weight:600' }, `RN-SEP-02: ya existe ${live.number} viva para esta marca`) : 'Ninguna'], ['Coherencia del destino', err ? h('span', { style: 'color:var(--bad);font-weight:600' }, 'RN-SEP-03: ' + err) : badge('Coherente', 'ok')],
        ['Pedidos abiertos', v.brand_id ? `${S.openOrders(v.brand_id).length} confirmados sin despachar · ${S.ordersInProcess(v.brand_id).length} en preparación o en ruta` : '—'], ['Stock de la marca', v.brand_id ? `${S.stockRows(v.brand_id, v.cutoff_date || G.TODAY).length} lotes en ${new Set(S.stockRows(v.brand_id, v.cutoff_date || G.TODAY).map(r => r.b.warehouse_id)).size} almacenes` : '—']]));
    };
    const locked = editing && S.isLocked(editing);
    const fbox = h('div');
    const build = values => { const dt = values.dest_type; G.ui.clear(fbox); const f = form({
      id: 'sep02', values,
      fields: [
        { key: 'brand_id', label: 'Marca', type: 'select', required: true, options: brands.map(b => [b.id, b.name]), disabled: !!editing, onChange: (x, v) => draw(v) },
        { key: 'dest_type', label: 'Destino', type: 'select', required: true, options: DEST, disabled: locked, onChange: (x, v) => { if (x !== 'OTHER_RUC') v.dest_company_id = ''; build(v); } },
        { hidden: dt !== 'OTHER_RUC', key: 'dest_company_id', label: 'Empresa destino (otro RUC del tenant)', type: 'select', options: companies.map(c => [c.id, `${c.legal_name} · ${c.ruc}${c.status === 'PREPARING' ? ' (en preparación)' : ''}`]), disabled: locked, help: 'Solo para «Otro RUC del tenant». Debe ser distinta de la de origen (RN-SEP-03).', onChange: (x, v) => draw(v) },
        { hidden: dt !== 'OTHER_RUC' || !!editing, key: 'new_company_ruc', label: 'O crea la empresa: RUC', placeholder: '20…', disabled: locked || !!editing, help: 'Se valida el dígito verificador de la SUNAT.', onChange: (x, v) => draw(v) },
        { hidden: dt !== 'OTHER_RUC' || !!editing, key: 'new_company_name', label: 'Razón social de la empresa nueva', disabled: locked || !!editing, onChange: (x, v) => draw(v) },
        { hidden: dt !== 'OTHER_TENANT', key: 'dest_tenant_id', label: 'Tenant destino (otra empresa en Aycha)', type: 'select', options: tenants.map(t => [t.id, `${t.name} (${t.id})`]), disabled: locked, onChange: (x, v) => draw(v) },
        { hidden: dt !== 'OTHER_TENANT', key: 'dest_tenant_name', label: 'O nombre del tenant nuevo', disabled: locked, onChange: (x, v) => draw(v) },
        { hidden: dt !== 'OTHER_SYSTEM', key: 'dest_system_name', label: 'Sistema destino (otro sistema)', placeholder: 'ERP del comprador', disabled: locked, onChange: (x, v) => draw(v) },
        { hidden: dt === 'OTHER_RUC', key: 'dest_legal_name', label: 'Razón social del destino (otro tenant u otro sistema)', disabled: locked, onChange: (x, v) => draw(v) },
        { hidden: dt === 'OTHER_RUC', key: 'dest_ruc', label: 'RUC del destino (para el traspaso con factura)', disabled: locked, onChange: (x, v) => draw(v) },
        { key: 'cutoff_date', label: 'Fecha de corte (último día del mes)', type: 'select', required: true, options: cutoffOptions(), disabled: locked, onChange: (x, v) => draw(v) },
        { key: 'receivables_policy', label: 'Cuentas por cobrar emitidas antes del corte', type: 'select', required: true, options: [['KEEP_ORIGIN', 'Quedan en el origen (D-SEP-04)'], ['ASSIGN', 'Se ceden al destino']], disabled: locked },
        { key: 'simulation', label: 'Solo simulación (ensaya la ejecución sin cambiar datos)', type: 'checkbox', disabled: !!editing, onChange: (x, v) => draw(v) },
        { key: 'notes', label: 'Notas', type: 'textarea', disabled: locked },
      ],
      submitLabel: locked || !canPrep() ? false : editing ? 'Guardar cambios' : 'Crear y validar',
      onSubmit: v => {
        try {
          const clean = { dest_type: v.dest_type, dest_company_id: v.dest_type === 'OTHER_RUC' ? (v.dest_company_id || null) : null, dest_tenant_id: v.dest_type === 'OTHER_TENANT' ? (v.dest_tenant_id || null) : null, dest_tenant_name: v.dest_type === 'OTHER_TENANT' ? (v.dest_tenant_name || null) : null, dest_system_name: v.dest_type === 'OTHER_SYSTEM' ? (v.dest_system_name || null) : null, dest_legal_name: v.dest_type !== 'OTHER_RUC' ? (v.dest_legal_name || null) : undefined, dest_ruc: v.dest_type !== 'OTHER_RUC' ? (v.dest_ruc || null) : undefined, cutoff_date: v.cutoff_date, receivables_policy: v.receivables_policy, notes: v.notes || null };
          if (clean.dest_type === 'OTHER_RUC' && v.new_company_ruc && !editing) clean.dest_company_id = null;
          Object.keys(clean).forEach(k => clean[k] === undefined && delete clean[k]);
          const s = editing ? S.update(editing.id, clean) : S.create(Object.assign({ brand_id: v.brand_id, simulation: !!v.simulation, new_company_ruc: v.new_company_ruc, new_company_name: v.new_company_name }, clean));
          toast(editing ? 'Cambios guardados' : `${s.number} creada en borrador`, 'ok'); G.go('SEP-03', { id: s.id }); return true;
        } catch (e) { return e.message; }
      },
    }); fbox.appendChild(f); draw(f.api.values); };
    body.appendChild(h('div', { class: 'grid side-r' }, card(editing ? 'Datos de la separación' : 'Datos de la nueva separación', fbox), card('Qué va a pasar', preview)));
    build(values);
    body.appendChild(DEC('D-SEP-02'));
  }

  /* ---------- SEP-03 Validaciones previas ---------- */
  function sep03(el, params) {
    const { body, sep } = wizPage(el, 'SEP-03', 'Validaciones previas', 'Revisa el período, los pedidos en curso, los comprobantes, las series y el OSE del destino, el stock, las decisiones y la consignación. Ninguna puede quedar en FAIL; un WARN se acepta con nota (RN-SEP-07).', params);
    if (!sep) return;
    const cs = S.checks(sep.id); const sm = S.checkSummary(sep.id);
    body.appendChild(kpis([{ label: 'PASS', value: String(sm.pass), tone: 'ok' }, { label: 'WARN', value: String(sm.warn), tone: sm.warn ? 'warn' : '' }, { label: 'FAIL', value: String(sm.fail), tone: sm.fail ? 'bad' : '' }, { label: 'Última ejecución', value: sep.checks_run_at ? F.datetime(sep.checks_run_at) : '—', sub: cs[0] ? cs[0].run_by : 'sin ejecutar' }]));
    const can = canPrep() && sep.status === 'DRAFT';
    const bar = h('div', { class: 'row' }, btn('Ejecutar validaciones', () => tryDo(() => S.runChecks(sep.id), r => `Validaciones: ${r.filter(c => c.result === 'FAIL').length} FAIL, ${r.filter(c => c.result === 'WARN').length} WARN`), { kind: 'primary', disabled: !can, title: can ? null : 'Solo en borrador y con sep.separation.prepare' }));
    body.appendChild(bar);
    body.appendChild(table({ id: 'sep03', rows: cs, search: false, pageSize: 20, empty: 'Ejecuta las validaciones para ver el resultado.',
      columns: [{ key: 'code', label: 'Validación', render: c => h('div', null, h('b', { class: 'mono small' }, c.code), h('div', null, c.title)), value: c => c.code + ' ' + c.title }, { key: 'result', label: 'Resultado', render: c => resBadge(c.result) }, { key: 'detail', label: 'Detalle', render: c => h('span', { class: 'small' }, c.detail) }, { key: 'rule', label: 'Regla', render: c => h('span', { class: 'mono small', style: 'white-space:nowrap' }, c.rule) }],
      filters: [{ key: 'result', label: 'Resultado', options: [['PASS', 'PASS'], ['WARN', 'WARN'], ['FAIL', 'FAIL']] }],
      onRow: c => drawer(c.code, b => { b.appendChild(dl([['Validación', c.title], ['Resultado', resBadge(c.result)], ['Detalle', c.detail], ['Cantidad', c.count == null ? '—' : String(c.count)], ['Regla', c.rule], ['Ejecutada', `${F.datetime(c.run_at)} · ${c.run_by}`]])); if (c.code === 'NO_ORDERS_IN_PREPARATION' && c.result === 'FAIL') b.appendChild(table({ id: 'sep03-prep', search: false, rows: S.ordersInProcess(sep.brand_id), columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'status', label: 'Estado', render: o => G.ui.status(o.status) }, { key: 'delivery_date', label: 'Entrega', render: o => F.date(o.delivery_date) }, { key: 'c', label: 'Cliente', value: o => G.custName(o.customer_id) }] })); }, { code: 'SEP-03' }) }));
    if (sep.status === 'DRAFT') {
      const warns = cs.filter(c => c.result === 'WARN');
      body.appendChild(card('Marcar como validada', form({ id: 'sep03v', fields: [{ key: 'note', label: warns.length ? `Nota para aceptar ${warns.length} advertencia(s): ${warns.map(c => c.code).join(', ')}` : 'Nota (opcional)', type: 'textarea', required: false }], values: { note: sep.warn_note || '' }, submitLabel: canPrep() ? 'Validar' : false, onSubmit: v => { try { S.validate(sep.id, v.note); toast(`${sep.number} validada: pasa a aprobación`, 'ok'); G.go('SEP-09', { id: sep.id }); return true; } catch (e) { return e.message; } } })));
    } else if (sep.validated_at) body.appendChild(notice(`Validada el ${F.datetime(sep.validated_at)}${sep.warn_note ? ' · Nota: ' + sep.warn_note : ''}.`, 'ok'));
  }

  /* ---------- SEP-04 Catálogo, precios y series ---------- */
  function sep04(el, params) {
    const { body, sep } = wizPage(el, 'SEP-04', 'Catálogo, precios y series', 'Productos, presentaciones y listas de precio de la marca: mover, copiar o solo exportar. Series nuevas del destino y cierre de las series propias de la marca en el origen.', params);
    if (!sep) return;
    const P = S.items(sep.id, 'PRODUCT'), L = S.items(sep.id, 'PRICE_LIST'), N = S.items(sep.id, 'SERIES_NEW'), O = S.items(sep.id, 'SERIES_ORIGIN');
    body.appendChild(kpis([{ label: 'Productos', value: String(P.length), sub: `${U.sum(P, i => i.qty || 0)} presentaciones` }, { label: 'Listas de precio', value: String(L.length), sub: `${U.sum(L, i => i.qty || 0)} precios` }, { label: 'Series nuevas', value: String(N.length), sub: N.map(i => i.code).join(', ') || 'no aplica' }, { label: 'Series que se cierran', value: String(O.filter(i => i.action === 'CLOSE').length), sub: O.filter(i => i.action === 'CLOSE').map(i => i.code).join(', ') || '—' }]));
    body.appendChild(tabs([
      { key: 'p', label: 'Productos', count: P.length, render: p => p.appendChild(itemsTable(sep, P, [{ key: 'qty', label: 'Presentaciones', align: 'r' }, { key: 'line', label: 'Línea', value: it => (D.get('products', it.ref_id) || {}).line || '—' }], { id: 'sep04-p' })) },
      { key: 'l', label: 'Listas de precio', count: L.length, render: p => p.appendChild(itemsTable(sep, L, [{ key: 'qty', label: 'Precios', align: 'r' }, { key: 'ch', label: 'Canales', value: it => ((D.get('price_lists', it.ref_id) || {}).channels || []).map(G.channelName).join(', ') }], { id: 'sep04-l' })) },
      { key: 's', label: 'Series', count: N.length + O.length, render: p => {
        if (sep.dest_type === 'OTHER_RUC') {
          p.appendChild(h('h3', null, `Series nuevas de ${coName(sep.dest_company_id)}`));
          p.appendChild(table({ id: 'sep04-n', search: false, rows: N, onRow: it => itemDrawer(it, sep), columns: [{ key: 'code', label: 'Serie', render: it => h('input', { class: 'input mono', style: 'width:90px', value: it.code, disabled: S.isLocked(sep) || !canPrep(), attrs: { maxlength: 4, 'aria-label': 'Código de serie' }, on: { click: e => e.stopPropagation(), change: e => tryDo(() => { const c = e.target.value.toUpperCase(); if (!/^[FB][A-Z0-9]{3}$/.test(c)) G.fail('RN-PLT-03', `${c} no es un código válido (F o B y 3 caracteres).`); if (D.find('document_series', x => x.series === c)) G.fail('RN-PLT-03', `La serie ${c} ya existe.`); D.update(T_IT, it.id, { code: c, label: `${c} · ${G.docTypeName(it.doc_type)}${it.applies_to ? ' de ' + G.docTypeName(it.applies_to).toLowerCase() : ''}` }); }, 'Serie actualizada') } }), value: it => it.code }, { key: 'doc_type', label: 'Tipo', value: it => G.docTypeName(it.doc_type) + (it.applies_to ? ' de ' + G.docTypeName(it.applies_to).toLowerCase() : '') }, { key: 'vf', label: 'Vigente desde', value: () => F.date(G.date.add(sep.cutoff_date, 1)) }, { key: 'status', label: 'Estado', render: it => itBadge(it.status) }] }));
        } else p.appendChild(notice(`${destName(sep.dest_type)}: el destino emite con sus propias series; aquí solo se cierran las de la marca.`, 'info'));
        p.appendChild(h('h3', { style: 'margin-top:14px' }, `Series de la marca en ${coName(sep.origin_company_id)}`));
        p.appendChild(itemsTable(sep, O, [{ key: 'next', label: 'Último número', align: 'r', value: it => { const s = D.get('document_series', it.ref_id); return s ? s.next_number - 1 : '—'; } }, { key: 'note', label: 'Nota', render: it => h('span', { class: 'small muted' }, it.note || '') }], { id: 'sep04-o', search: false }));
      } },
    ]));
  }

  /* ---------- SEP-05 Stock al corte y traspaso ---------- */
  function sep05(el, params) {
    const { body, sep } = wizPage(el, 'SEP-05', 'Stock al corte y traspaso', 'Stock de la marca por almacén, lote y vencimiento a la fecha de corte; para cada lote: traspaso con comprobante y guía, solo exportar o dejar, y la cantidad.', params);
    if (!sep) return;
    const its = S.items(sep.id, 'STOCK').filter(i => G.scope.ok(i, { brand: '_', site: 'establishment_id' }));
    const trf = its.filter(i => i.action === 'TRANSFER' && i.status !== 'EXCLUDED');
    const value = R(U.sum(trf, i => i.qty * i.unit_cost)); const igv = R(value * G.tax.rate());
    const units = U.sum(trf.filter(i => i.uom === 'u'), i => i.qty), kg = U.sum(trf.filter(i => i.uom === 'kg'), i => i.qty);
    const k1 = R(U.sum(trf.filter(i => i.status === 'DONE'), i => Math.abs(i.qty - (i.received_qty || 0))), 3);
    body.appendChild(kpis([{ label: 'Lotes de la marca', value: String(its.length), sub: `${new Set(its.map(i => i.warehouse_id)).size} almacenes` }, { label: 'A traspasar', value: `${F.num(units, 0)} u · ${F.num(kg, 3)} kg`, sub: `${trf.length} lotes` }, { label: 'Valor al costo promedio', value: F.money(value), sub: `Factura ${F.money(value + igv)} con IGV (D-SEP-01)` }, { label: 'KPI-SEP-01 · Diferencia', value: F.num(k1, 3), sub: 'enviado − recibido · meta 0', tone: k1 ? 'bad' : 'ok' }]));
    body.appendChild(DEC('D-SEP-01'));
    if (sep.dest_type === 'OTHER_RUC') body.appendChild(notice(`RN-SEP-13: entre RUC distintos el traspaso se documenta con una factura de ${coName(sep.origin_company_id)} a ${coName(sep.dest_company_id)} y una guía de remisión remitente motivo 01 (venta) por local; el stock entra a los almacenes de la empresa nueva en el mismo local.`, 'info'));
    const qtyInput = it => h('input', { class: 'input num', type: 'number', style: 'width:96px', value: it.qty, attrs: { step: it.uom === 'kg' ? '0.001' : '1', min: '0', 'aria-label': 'Cantidad de ' + it.label }, disabled: S.isLocked(sep) || !canPrep() || it.status === 'EXCLUDED' || it.action === 'LEAVE', on: { click: e => e.stopPropagation(), change: e => tryDo(() => S.setItem(it.id, { qty: Number(e.target.value) }), 'Cantidad actualizada') } });
    body.appendChild(itemsTable(sep, its, [
      { key: 'warehouse_id', label: 'Almacén', value: it => G.whName(it.warehouse_id) },
      { key: 'expiry_date', label: 'Vence', render: it => it.expiry_date ? h('span', null, F.date(it.expiry_date), G.date.diff(it.expiry_date, G.TODAY) <= 10 ? h('span', null, ' ', badge(`${G.date.diff(it.expiry_date, G.TODAY)} d`, 'warn')) : null) : '—', value: it => it.expiry_date || '' },
      { key: 'qty_at_cutoff', label: 'Kardex al corte', align: 'r', render: it => qtyTxt(it.qty_at_cutoff, { sale_mode: it.uom === 'kg' ? 'KG' : 'UNIT' }) },
      { key: 'cur', label: 'Disponible hoy', align: 'r', value: it => { const b = D.get('stock_balances', it.ref_id); return b ? F.num(b.qty - (b.reserved_qty || 0), it.uom === 'kg' ? 3 : 0) : '0'; } },
      { key: 'qty', label: 'Cantidad', align: 'r', render: qtyInput, value: it => it.qty },
      { key: 'val', label: 'Valor', align: 'r', value: it => F.money(it.qty * it.unit_cost) },
      { key: 'received_qty', label: 'Recibido', align: 'r', render: it => it.received_qty == null ? '—' : h('span', { style: Math.abs(it.received_qty - it.qty) > 0.0005 ? 'color:var(--bad);font-weight:700' : '' }, F.num(it.received_qty, it.uom === 'kg' ? 3 : 0)) },
    ], { id: 'sep05', pageSize: 20, labelRender: it => { const v = G.variant(it.variant_id) || {}; const lot = it.lot_id ? D.get('lots', it.lot_id) : null; return h('div', { style: 'min-width:170px' }, h('div', null, v.name || it.label), h('div', { class: 'small muted mono' }, lot ? lot.code : 'sin lote'), it.note ? h('div', { class: 'small', style: 'color:var(--warn)' }, it.note) : null); }, filters: [{ key: 'warehouse_id', label: 'Almacén', options: [...new Set(its.map(i => i.warehouse_id))].map(w => [w, G.whName(w)]) }, { key: 'action', label: 'Acción', options: ACTS.STOCK }, { key: 'status', label: 'Estado', options: Object.entries(IST).map(([k, v]) => [k, v[0]]) }], empty: 'La marca no tiene stock.' }));
    const docs = sep.transfer_docs || [];
    if (docs.length) body.appendChild(card('Comprobantes y guías del traspaso', table({ id: 'sep05-d', search: false, rows: docs, columns: [{ key: 'full_number', label: 'Factura', mono: true }, { key: 'total', label: 'Total', align: 'r', value: d => F.money(d.total) }, { key: 'guides', label: 'Guías (motivo 01)', value: d => (d.guides || []).join(', ') }, { key: 'at', label: 'Emitido', value: d => F.datetime(d.at) }], onRow: d => { if (G.screens['FAC-04']) G.go('FAC-04', { id: d.document_id }); } }), { flush: true }));
  }

  /* ---------- SEP-06 Clientes, pedidos abiertos y saldos ---------- */
  function sep06(el, params) {
    const { body, sep } = wizPage(el, 'SEP-06', 'Clientes, pedidos abiertos y saldos', 'Clientes de la marca, pedidos confirmados sin despachar (mantener, cancelar con aviso o exportar) y cuentas por cobrar (quedan en el origen o se ceden).', params);
    if (!sep) return;
    const cu = S.customers(sep); const ords = S.items(sep.id, 'ORDER'); const rec = S.items(sep.id, 'RECEIVABLE');
    const k2 = ords.length ? R(ords.filter(i => ['DONE', 'EXCLUDED'].includes(i.status)).length / ords.length * 100, 1) : null;
    body.appendChild(kpis([{ label: 'Clientes de la marca', value: String(cu.all.length), sub: `últimos ${cu.months} meses (desde ${F.date(cu.from)})` }, { label: 'Con consentimiento', value: String(cu.withConsent.length), sub: sep.dest_type === 'OTHER_RUC' ? 'mismo tenant: compartidos' : 'se exportan (D-SEP-03)' }, { label: 'Pedidos abiertos', value: String(ords.length), sub: `${F.money(U.sum(ords, i => i.amount || 0))}` }, { label: 'KPI-SEP-02 · Resueltos', value: k2 == null ? '—' : F.pct(k2), sub: 'hechos o excluidos · meta 100 %', tone: k2 != null && k2 < 100 ? 'warn' : k2 === 100 ? 'ok' : '' }, { label: 'Por cobrar al corte', value: F.money(U.sum(rec, i => i.amount || 0)), sub: `${rec.length} comprobantes` }]));
    const inProc = S.ordersInProcess(sep.brand_id);
    if (inProc.length && !S.isLocked(sep)) body.appendChild(notice(`RN-SEP-15: ${inProc.length} pedido(s) de la marca en preparación o en ruta (${inProc.map(o => o.number).join(', ')}): la validación falla hasta que se terminen.`, 'warn'));
    body.appendChild(tabs([
      { key: 'c', label: 'Clientes', count: cu.all.length, render: p => {
        p.appendChild(notice(sep.dest_type === 'OTHER_RUC' ? 'RN-SEP-14: en el mismo tenant los clientes son compartidos y no se copian.' : `RN-SEP-14: se exportan solo los que compraron la marca en los últimos ${cu.months} meses, con sus direcciones; mientras D-SEP-03 no se decida, solo los que tienen consentimiento registrado.`, 'info'));
        const it = S.items(sep.id, 'CUSTOMERS')[0];
        if (it) p.appendChild(h('div', { class: 'row', style: 'margin:8px 0' }, h('b', null, 'Acción:'), actSelect(it, sep), itBadge(it.status)));
        const consented = new Set(cu.withConsent.map(c => c.id));
        p.appendChild(table({ id: 'sep06-c', rows: cu.all, pageSize: 12, columns: [{ key: 'full_name', label: 'Cliente', value: c => c.trade_name || c.full_name }, { key: 'doc', label: 'Documento', value: c => `${c.doc_type || ''} ${c.doc_number || ''}`, mono: true }, { key: 'phone', label: 'Celular', mono: true }, { key: 'last_order_at', label: 'Última compra', value: c => F.date(c.last_order_at) }, { key: 'cons', label: 'Consentimiento', render: c => consented.has(c.id) ? badge('Sí', 'ok') : badge('No', ''), value: c => consented.has(c.id) ? 'Sí' : 'No' }, { key: 'exp', label: 'Exportar', value: c => sep.dest_type === 'OTHER_RUC' ? 'No (compartido)' : consented.has(c.id) ? 'Sí' : 'No' }], filters: [{ key: 'cons', label: 'Consentimiento', options: [['Sí', 'Con consentimiento'], ['No', 'Sin consentimiento']], value: c => consented.has(c.id) ? 'Sí' : 'No' }] }));
        p.appendChild(DEC('D-SEP-03'));
      } },
      { key: 'o', label: 'Pedidos abiertos', count: ords.length, render: p => {
        p.appendChild(notice(sep.dest_type === 'OTHER_RUC' ? `RN-SEP-15: los confirmados sin despachar se mantienen y se facturan con ${coName(sep.dest_company_id)}.` : 'RN-SEP-15: los confirmados sin despachar se cancelan con aviso al cliente y se exportan.', 'info'));
        p.appendChild(itemsTable(sep, ords, [{ key: 'delivery_date', label: 'Entrega', value: it => F.date(it.delivery_date) }, { key: 'amount', label: 'Importe', align: 'r', value: it => F.money(it.amount) }, { key: 'st', label: 'Estado del pedido', render: it => G.ui.status((D.get('sales_orders', it.ref_id) || {}).status) }], { id: 'sep06-o', empty: 'Sin pedidos confirmados sin despachar.' }));
      } },
      { key: 'r', label: 'Cuentas por cobrar', count: rec.length, render: p => {
        p.appendChild(h('div', { class: 'row', style: 'margin-bottom:8px' }, h('b', null, 'Política:'), h('select', { class: 'input', style: 'max-width:280px', disabled: S.isLocked(sep) || !canPrep(), on: { change: e => tryDo(() => S.setPolicy(sep.id, e.target.value), 'Política actualizada') } }, [['KEEP_ORIGIN', 'Quedan en el origen (D-SEP-04)'], ['ASSIGN', 'Se ceden al destino']].map(([v, l]) => h('option', { value: v, selected: sep.receivables_policy === v }, l)))));
        p.appendChild(notice('RN-SEP-16: las emitidas antes del corte se quedan en la empresa de origen salvo que la contadora decida cederlas; los cobros posteriores se registran en el origen.', 'info'));
        p.appendChild(itemsTable(sep, rec, [{ key: 'amount', label: 'Saldo', align: 'r', value: it => F.money(it.amount) }, { key: 'due_date', label: 'Vence', value: it => F.date(it.due_date) }], { id: 'sep06-r', empty: 'Sin cuentas por cobrar de la marca al corte.' }));
        p.appendChild(DEC('D-SEP-04'));
      } },
    ]));
  }

  /* ---------- SEP-07 Canales ---------- */
  function sep07(el, params) {
    const { body, sep } = wizPage(el, 'SEP-07', 'Canales', 'Números de WhatsApp, tienda web, cuentas de anuncios y cajas o pasarelas de la marca, con la acción para cada uno.', params);
    if (!sep) return;
    const ch = S.items(sep.id, 'CHANNEL'), web = S.items(sep.id, 'WEB_STORE'), ads = S.items(sep.id, 'AD_ACCOUNT'), cash = S.items(sep.id, 'CASH_ACCOUNT');
    body.appendChild(kpis([{ label: 'Números de WhatsApp', value: String(ch.filter(i => i.kind === 'WHATSAPP').length), sub: `${U.sum(ch.filter(i => i.kind === 'WHATSAPP'), i => i.qty || 0)} conversaciones` }, { label: 'Otros canales', value: String(ch.filter(i => i.kind !== 'WHATSAPP').length) }, { label: 'Tienda web', value: web.length ? actName('WEB_STORE', web[0].action) : 'Sin tienda' }, { label: 'Cuentas de anuncios', value: String(ads.length) }]));
    body.appendChild(notice({ OTHER_RUC: 'RN-SEP-17: en el mismo tenant los números siguen en la bandeja con sus chats; solo cambia la empresa que factura.', OTHER_TENANT: 'RN-SEP-17: a otro tenant los números se migran entre cuentas de WhatsApp Business con el proveedor oficial.', OTHER_SYSTEM: 'RN-SEP-17: a otro sistema los números se desconectan de CRM y su historial va en el paquete.' }[sep.dest_type], 'info'));
    body.appendChild(card('Mensajería', itemsTable(sep, ch, [{ key: 'kind', label: 'Tipo' }, { key: 'qty', label: 'Conversaciones', align: 'r' }, { key: 'cst', label: 'Estado del canal', render: it => G.ui.status((D.get('messaging_channels', it.ref_id) || {}).status || 'ACTIVE') }], { id: 'sep07-c', search: false }), { flush: true }));
    body.appendChild(h('div', { class: 'grid c2' },
      card('Tienda web', web.length ? itemsTable(sep, web, [{ key: 'qty', label: 'Publicados', align: 'r' }], { id: 'sep07-w', search: false }) : G.ui.empty('La marca no tiene tienda ni productos publicados.'), { flush: true }),
      card('Cuentas de anuncios', ads.length ? itemsTable(sep, ads, [{ key: 'platform', label: 'Plataforma' }], { id: 'sep07-a', search: false }) : G.ui.empty('La marca no tiene cuentas de anuncios propias.'), { flush: true })));
    body.appendChild(card('Cajas y pasarelas', cash.length ? itemsTable(sep, cash, [], { id: 'sep07-k', search: false }) : h('p', { class: 'small muted' }, 'Las cajas, cuentas bancarias, Yape, Plin, Mercado Pago y POS son compartidas por todas las marcas: no se mueven. Los cobros posteriores de comprobantes anteriores al corte se registran en el origen (RN-SEP-16).')));
    body.appendChild(notice('RN-SEP-20: la tienda web y las cuentas de anuncios se reasignan a la empresa nueva o se desconectan; el gasto de anuncios anterior al corte queda en el origen.', 'info'));
  }

  /* ---------- SEP-08 Usuarios y locales ---------- */
  function sep08(el, params) {
    const { body, sep } = wizPage(el, 'SEP-08', 'Usuarios y locales', 'Vendedoras y personal con alcance en la marca, locales y almacenes dedicados: mover, quitar alcance o mantener.', params);
    if (!sep) return;
    const us = S.items(sep.id, 'USER'); const wi = S.items(sep.id, 'WAREHOUSE');
    body.appendChild(kpis([{ label: 'Usuarios con la marca', value: String(us.length), sub: `${us.filter(i => i.only_brand).length} solo con esta marca` }, { label: 'Almacenes con stock de la marca', value: String(S.warehouseShare(sep.brand_id).length), sub: `${wi.length} dedicados` }, { label: 'Locales', value: String(D.all('establishments').length), sub: 'compartidos' }]));
    body.appendChild(card('Usuarios', itemsTable(sep, us, [{ key: 'br', label: 'Marcas en su alcance', value: it => ((D.get('users', it.ref_id) || {}).brands || []).map(G.brandName).join(', ') }, { key: 'only', label: 'Solo esta marca', render: it => it.only_brand ? badge('Sí', 'warn') : 'No', value: it => it.only_brand ? 'Sí' : 'No' }], { id: 'sep08-u', search: false, empty: 'Ningún usuario tiene la marca en su alcance.' }), { flush: true }));
    const share = S.warehouseShare(sep.brand_id);
    body.appendChild(card('Almacenes y locales', table({ id: 'sep08-w', search: false, rows: share, columns: [{ key: 'wh', label: 'Almacén', value: r => G.whName(r.wh) }, { key: 'site', label: 'Local', value: r => G.siteName((D.get('warehouses', r.wh) || {}).establishment_id) }, { key: 'lots', label: 'Lotes de la marca', align: 'r' }, { key: 'pct', label: 'Participación (valor)', align: 'r', render: r => h('div', { style: 'min-width:120px' }, G.ui.progress(r.pct), h('span', { class: 'small' }, F.pct(r.pct))) }, { key: 'dec', label: 'Acción', value: r => { const it = wi.find(i => i.ref_id === r.wh); return it ? actName('WAREHOUSE', it.action) : 'Compartido: se mantiene'; } }], empty: 'La marca no tiene stock en almacenes.' }), { flush: true }));
    if (wi.length) body.appendChild(card('Almacenes dedicados', itemsTable(sep, wi, [{ key: 'qty', label: 'Lotes', align: 'r' }], { id: 'sep08-d', search: false }), { flush: true }));
  }

  /* ---------- SEP-09 Resumen, aprobación y ejecución ---------- */
  function sep09(el, params) {
    const { body, sep } = wizPage(el, 'SEP-09', 'Resumen, aprobación y ejecución', 'Resumen de todo lo propuesto; la aprueba otra persona con el mes del corte cerrado; la ejecución avanza por elemento y reintenta los que fallan.', params);
    if (!sep) return;
    const its = S.items(sep.id);
    const groups = U.groupBy(its, 'item_type');
    const doneN = its.filter(i => i.status === 'DONE').length, exN = its.filter(i => i.status === 'EXCLUDED').length, failN = its.filter(i => i.status === 'FAILED').length;
    body.appendChild(kpis([{ label: 'Elementos', value: String(its.length) }, { label: 'Hechos', value: String(doneN), tone: 'ok' }, { label: 'Excluidos', value: String(exN) }, { label: 'Fallidos', value: String(failN), tone: failN ? 'bad' : '' }, { label: 'Avance', value: F.pct(its.length ? (doneN + exN) / its.length * 100 : 0, 0) }]));
    const acts = h('div', { class: 'row' });
    const prepBy = sep.prepared_by === me();
    if (sep.status === 'VALIDATED') {
      const closed = G.period.isClosed(sep.cutoff_date);
      acts.appendChild(btn('Aprobar', () => modal(`Aprobar ${sep.number}`, (b, close) => b.appendChild(form({ id: 'sep09a', fields: [{ key: 'note', label: 'Nota de aprobación', type: 'textarea' }], submitLabel: 'Aprobar', onCancel: close, onSubmit: v => { try { S.approve(sep.id, v.note); close(); toast(`${sep.number} aprobada`, 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))), { kind: 'primary', disabled: !G.can('sep.separation.approve'), title: !G.can('sep.separation.approve') ? 'Requiere sep.separation.approve' : null }));
      if (!closed) acts.appendChild(h('span', { class: 'small', style: 'color:var(--warn)' }, `RN-SEP-01: ${G.date.monthName(sep.cutoff_date)} sigue abierto; la aprobación se rechaza hasta cerrarlo.`));
      if (prepBy) acts.appendChild(h('span', { class: 'small muted' }, `RN-SEP-08: preparaste ${sep.number}; la aprueba otra persona.`));
    }
    if (['APPROVED', 'EXECUTING', 'FAILED'].includes(sep.status)) acts.appendChild(btn(sep.status === 'FAILED' ? 'Reintentar fallidos' : sep.simulation ? 'Ejecutar simulación' : 'Ejecutar', () => tryDo(() => S.execute(sep.id), r => `${r.number}: ${(ST[r.status] || [r.status])[0]}${r.status === 'EXECUTING' ? ' · ' + S.canComplete(r).msg : ''}`), { kind: 'primary', disabled: !G.can('sep.separation.execute'), title: !G.can('sep.separation.execute') ? 'Requiere sep.separation.execute' : null }));
    if (sep.status === 'EXECUTING') acts.appendChild(btn('Completar', () => tryDo(() => S.complete(sep.id), `${sep.number} completada`), { kind: 'accent', disabled: !G.can('sep.separation.execute') }));
    if (sep.status === 'DRAFT') acts.appendChild(btn('Ir a validaciones', () => G.go('SEP-03', { id: sep.id }), { kind: 'primary' }));
    if (['DRAFT', 'VALIDATED', 'APPROVED'].includes(sep.status) && canPrep()) acts.appendChild(btn('Cancelar', () => askReason(`Cancelar ${sep.number}`, 'Motivo de la cancelación', r => S.cancel(sep.id, r), 'Separación cancelada'), { kind: 'danger' }));
    body.appendChild(acts);
    if (sep.status === 'EXECUTING') { const c = S.canComplete(sep); if (!c.ok) body.appendChild(notice(`${c.rule}: ${c.msg}`, 'warn')); }
    if (sep.simulation) body.appendChild(notice('Simulación: la ejecución revisa cada elemento sin emitir comprobantes, mover stock ni cambiar canales o usuarios.', 'info'));
    body.appendChild(h('div', { class: 'grid side-r' },
      card('Resumen por tipo', table({ id: 'sep09-s', search: false, pageSize: 20, rows: Object.entries(groups).map(([t, l]) => ({ t, l, seq: (TYPES[t] || [0, 99])[1] })).sort((a, b) => a.seq - b.seq), columns: [{ key: 't', label: 'Tipo', value: r => typeName(r.t) }, { key: 'n', label: 'Elementos', align: 'r', value: r => r.l.length }, { key: 'a', label: 'Acciones', value: r => Object.entries(U.groupBy(r.l, 'action')).map(([a, x]) => `${actName(r.t, a)}: ${x.length}`).join(' · ') }, { key: 'p', label: 'Avance', render: r => { const d = r.l.filter(i => ['DONE', 'EXCLUDED'].includes(i.status)).length; return h('div', { style: 'min-width:90px' }, G.ui.progress(d / r.l.length * 100, r.l.some(i => i.status === 'FAILED') ? 'bad' : ''), h('span', { class: 'small muted' }, `${d}/${r.l.length}`)); } }] }), { flush: true }),
      card('Aprobación', dl([['Preparó', `${sep.prepared_by_name} · ${F.datetime(sep.prepared_at)}`], ['Validada', sep.validated_at ? F.datetime(sep.validated_at) : '—'], ['Nota de advertencias', sep.warn_note], ['Aprobó', sep.approved_by_name ? `${sep.approved_by_name} · ${F.datetime(sep.approved_at)}` : '—'], ['Nota de aprobación', sep.approval_note], ['Ejecución', sep.executed_at ? F.datetime(sep.executed_at) : '—'], ['Completada', sep.completed_at ? F.datetime(sep.completed_at) : '—'], ['Mes del corte', G.period.isClosed(sep.cutoff_date) ? badge('Cerrado', 'ok') : badge('Abierto', 'warn')]]))));
    body.appendChild(card('Avance por elemento', table({ id: 'sep09-i', rows: its, pageSize: 15, onRow: it => itemDrawer(it, sep),
      columns: [{ key: 'item_type', label: 'Tipo', value: it => typeName(it.item_type) }, { key: 'label', label: 'Elemento' }, { key: 'action', label: 'Acción', value: it => actName(it.item_type, it.action) }, { key: 'status', label: 'Estado', render: it => itBadge(it.status), value: it => it.status }, { key: 'result', label: 'Resultado', render: it => h('span', { class: 'small', style: it.error ? 'color:var(--bad)' : '' }, it.error || it.result || it.exclude_reason || '—') }],
      actions: it => [it.status === 'FAILED' && G.can('sep.separation.execute') ? btn('Reintentar', () => tryDo(() => S.retryItem(it.id), r => `Reintento: ${(ST[r.status] || [r.status])[0]}`), { sm: true }) : null, it.status === 'FAILED' && canPrep() ? excludeBtn(it, sep) : null].filter(Boolean),
      filters: [{ key: 'item_type', label: 'Tipo', options: Object.keys(groups).map(t => [t, typeName(t)]) }, { key: 'status', label: 'Estado', options: Object.entries(IST).map(([k, v]) => [k, v[0]]) }] }), { flush: true }));
  }

  /* ---------- SEP-10 Exportación completa ---------- */
  function sep10(el, params) {
    const { body, sep } = wizPage(el, 'SEP-10', 'Exportación completa', 'Genera el paquete (JSON de Aycha y CSV), muestra su huella SHA-256 y su tamaño, y da el enlace de descarga con vencimiento tras la aprobación de otra persona.', params);
    if (!sep) return;
    const x = S.exportRow(sep); const st = S.linkState(x);
    const counts = S.exportCounts(sep);
    body.appendChild(kpis([{ label: 'Registros', value: F.num(U.sum(counts, c => c.rows)), sub: `${counts.length} conjuntos` }, { label: 'Huella SHA-256', value: sep.export ? sep.export.sha256.slice(0, 12) + '…' : '—', sub: sep.export ? 'paquete generado' : 'sin paquete' }, { label: 'Tamaño', value: sep.export ? fmtBytes(sep.export.size_bytes) : '—' }, { label: 'Enlace', value: { NONE: 'Sin paquete', PENDING: 'Por aprobar', READY: 'Listo', EXPIRED: 'Vencido', REJECTED: 'Rechazado' }[st], sub: x && x.link_expires_at ? 'vence ' + F.datetime(x.link_expires_at) : `vigencia ${G.param('sep_export_link_hours') ?? 72} h`, tone: st === 'READY' ? 'ok' : st === 'EXPIRED' ? 'bad' : st === 'PENDING' ? 'warn' : '' }]));
    if (sep.dest_type !== 'OTHER_RUC') body.appendChild(notice(`RN-SEP-10: una separación a ${destName(sep.dest_type).toLowerCase()} se completa solo con el paquete y su huella SHA-256.`, sep.export ? 'ok' : 'warn'));
    else body.appendChild(notice('Mismo tenant: el paquete es opcional (respaldo); los datos siguen en Aycha.', 'info'));
    const acts = h('div', { class: 'row' },
      btn(sep.export ? 'Generar de nuevo' : 'Generar paquete', () => tryDo(() => S.buildExport(sep.id), r => `Paquete generado · SHA-256 ${r.sha256.slice(0, 12)}…`), { kind: 'primary', disabled: !canPrep() || !['APPROVED', 'EXECUTING', 'FAILED'].includes(sep.status), title: !['APPROVED', 'EXECUTING', 'FAILED'].includes(sep.status) ? 'Se genera de una separación aprobada' : null }),
      x && x.status === 'PENDING_APPROVAL' ? btn('Aprobar exportación', () => tryDo(() => S.approveExport(sep.id), 'Exportación aprobada: enlace activo'), { kind: 'accent', disabled: !G.can('sep.export.download') }) : null,
      btn('Descargar', () => tryDo(() => S.download(sep.id), 'Descarga registrada'), { disabled: st !== 'READY' || !G.can('sep.export.download') }));
    body.appendChild(acts);
    body.appendChild(h('div', { class: 'grid side-r' },
      card('Contenido del paquete (RN-SEP-19)', table({ id: 'sep10-c', search: false, pageSize: 20, rows: counts, columns: [{ key: 'dataset', label: 'Conjunto', value: c => c.dataset.replace(/_/g, ' ') }, { key: 'rows', label: 'Registros', align: 'r', value: c => F.num(c.rows) }, { key: 'file', label: 'Archivo CSV', mono: true }], footer: ['Total', { v: F.num(U.sum(counts, c => c.rows)), align: 'r' }, ''] }), { flush: true }),
      card('Registro de la exportación', x ? dl([['Número', h('span', { class: 'mono' }, x.number)], ['Archivo', x.file_name], ['SHA-256', h('span', { class: 'mono small', style: 'overflow-wrap:anywhere' }, x.sha256)], ['Tamaño', fmtBytes(x.size_bytes)], ['Datos personales', x.contains_personal_data ? 'Sí (aprobación de otra persona)' : 'No'], ['Solicitó', `${x.requested_by} · ${F.datetime(x.requested_at)}`], ['Aprobó', x.approved_by ? `${x.approved_by} · ${F.datetime(x.approved_at)}` : 'Pendiente'], ['Vence', x.link_expires_at ? F.datetime(x.link_expires_at) : '—'], ['Descargas', String((x.downloads || []).length)], ['Marca de agua', x.watermark]]) : G.ui.empty('Aún no se generó el paquete.'))));
    if (x && (x.downloads || []).length) body.appendChild(card('Descargas', table({ id: 'sep10-d', search: false, rows: x.downloads.map((d, i) => Object.assign({ id: i }, d)), columns: [{ key: 'at', label: 'Fecha', value: d => F.datetime(d.at) }, { key: 'by', label: 'Usuario' }] }), { flush: true }));
  }

  /* ---------- SEP-11 Acta ---------- */
  function sep11(el, params) {
    const { body, sep } = wizPage(el, 'SEP-11', 'Acta', 'Acta en PDF con la fecha de corte, las empresas, los saldos trasladados, el stock traspasado, los comprobantes del traspaso y las firmas de quien preparó y aprobó.', params, []);
    if (!sep) return;
    const a = S.actData(sep);
    body.appendChild(h('div', { class: 'row' }, btn('Generar acta', () => tryDo(() => S.generateAct(sep.id), r => `${r.file_name} adjunta · SHA-256 ${r.sha256.slice(0, 12)}…`), { kind: 'primary', disabled: !canPrep() || !['EXECUTING', 'COMPLETED', 'FAILED'].includes(sep.status), title: !['EXECUTING', 'COMPLETED', 'FAILED'].includes(sep.status) ? 'El acta se genera al ejecutar' : null }), btn('Imprimir / PDF', () => G.print()), sep.act ? h('span', { class: 'small muted' }, `${sep.act.file_name} · ${F.datetime(sep.act.generated_at)} · ${sep.act.generated_by} · SHA-256 ${sep.act.sha256.slice(0, 16)}…`) : h('span', { class: 'small muted' }, 'Vista previa: el acta se adjunta al completar (RN-SEP-18).')));
    const dest = sep.dest_type === 'OTHER_RUC' ? `${coName(sep.dest_company_id)} · RUC ${coRuc(sep.dest_company_id)}` : destLabel(sep);
    const doc = h('div', { class: 'stack', style: 'gap:14px' },
      h('div', { class: 'between row' }, h('div', null, h('h2', { style: 'margin:0' }, `Acta de separación de marca ${sep.number}`), h('div', { class: 'muted small' }, sep.simulation ? 'SIMULACIÓN · sin efectos' : `${coName(sep.origin_company_id)} · RUC ${coRuc(sep.origin_company_id)}`)), stBadge(sep.status)),
      h('p', null, `Con fecha de corte ${F.date(sep.cutoff_date)}, la marca ${brandOf(sep.brand_id).name} deja de emitir con ${coName(sep.origin_company_id)} (RUC ${coRuc(sep.origin_company_id)}) y, desde el ${F.date(G.date.add(sep.cutoff_date, 1))}, ${sep.dest_type === 'OTHER_RUC' ? `emite con ${dest} con las series ${S.items(sep.id, 'SERIES_NEW').map(i => i.code).join(', ')}` : `pasa a ${destName(sep.dest_type).toLowerCase()}: ${dest}`}. El histórico anterior al corte se conserva tal como se emitió (RN-SEP-18).`),
      dl([['Empresa de origen', `${coName(sep.origin_company_id)} · RUC ${coRuc(sep.origin_company_id)}`], ['Destino', `${destName(sep.dest_type)} · ${dest}`], ['Fecha de corte', F.date(sep.cutoff_date)], ['Stock traspasado', `${a.stock.length} lotes · ${F.num(a.sent, 3)} enviados · ${F.num(a.received, 3)} recibidos · diferencia ${F.num(R(Math.abs(a.sent - a.received), 3), 3)}`], ['Valor del traspaso', `${F.money(a.value)} + IGV ${F.money(R(a.value * G.tax.rate()))} (D-SEP-01)`], ['Cuentas por cobrar', `Quedan en el origen ${F.money(a.recKeep)} · cedidas ${F.money(a.recAssign)}`], ['Pedidos abiertos', `${a.orders.length} · ${a.orders.filter(i => ['DONE', 'EXCLUDED'].includes(i.status)).length} resueltos`], ['Paquete', sep.export ? `${sep.export.file_name} · SHA-256 ${sep.export.sha256}` : 'No generado']]),
      a.docs.length ? table({ id: 'sep11-d', search: false, rows: a.docs, columns: [{ key: 'full_number', label: 'Comprobante de traspaso', mono: true }, { key: 'total', label: 'Total', align: 'r', value: d => F.money(d.total) }, { key: 'guides', label: 'Guías de remisión', value: d => (d.guides || []).join(', ') }] }) : h('p', { class: 'small muted' }, 'Sin comprobantes de traspaso.'),
      a.stock.length ? table({ id: 'sep11-s', search: false, pageSize: 12, rows: a.stock, columns: [{ key: 'label', label: 'Lote' }, { key: 'wh', label: 'Almacén', value: i => G.whName(i.warehouse_id) }, { key: 'qty', label: 'Enviado', align: 'r', value: i => F.num(i.qty, 3) }, { key: 'received_qty', label: 'Recibido', align: 'r', value: i => i.received_qty == null ? '—' : F.num(i.received_qty, 3) }, { key: 'status', label: 'Estado', render: i => itBadge(i.status) }] }) : null,
      h('div', { class: 'grid c2', style: 'margin-top:24px' },
        h('div', { style: 'border-top:1px solid var(--line);padding-top:6px' }, h('b', null, sep.prepared_by_name), h('div', { class: 'small muted' }, `Preparó · ${F.datetime(sep.prepared_at)}`)),
        h('div', { style: 'border-top:1px solid var(--line);padding-top:6px' }, h('b', null, sep.approved_by_name || 'Pendiente de aprobación'), h('div', { class: 'small muted' }, sep.approved_at ? `Aprobó · ${F.datetime(sep.approved_at)}` : 'Aprobación (RN-SEP-08)'))));
    body.appendChild(card(null, doc));
  }

  /* ---------- SEP-12 Historial de la marca ---------- */
  function sep12(el, params) {
    const brands = D.where('brands', b => G.scope.ok({ brand_id: b.id }));
    const brand = (params && params.brand) || (G.ctx.brand !== 'ALL' ? G.ctx.brand : (pickSep({}) || {}).brand_id || 'br-M5');
    const body = page(el, { code: 'SEP-12', title: 'Historial de la marca', sub: 'Empresas emisoras de la marca por vigencia y separaciones ejecutadas; los meses anteriores siguen mostrando la empresa de entonces.', actions: [h('select', { class: 'input', style: 'max-width:240px', attrs: { 'aria-label': 'Marca' }, on: { change: e => G.go('SEP-12', { brand: e.target.value }) } }, brands.map(b => h('option', { value: b.id, selected: b.id === brand }, b.name)))] });
    const b = brandOf(brand); const hist = S.history(brand); const seps = D.where(T_SEP, s => s.brand_id === brand).sort(U.by('number', -1));
    body.appendChild(kpis([{ label: 'Marca', value: G.brandName(brand), sub: b.status === 'SEPARATED' ? 'Separada' : 'Activa' }, { label: 'Empresa vigente hoy', value: (coOf(S.companyFor(brand, G.TODAY)) || {}).trade_name || coName(S.companyFor(brand, G.TODAY)) || 'Fuera del tenant', sub: S.companyFor(brand, G.TODAY) ? 'RUC ' + coRuc(S.companyFor(brand, G.TODAY)) : '' }, { label: 'Vigencias', value: String(hist.length) }, { label: 'Separaciones', value: String(seps.length), sub: `${seps.filter(s => s.status === 'COMPLETED' && !s.simulation).length} ejecutadas` }]));
    const tl = h('div', { class: 'timeline' }, hist.slice().reverse().map(r => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.date(r.valid_from)), h('span', { class: 'dot' }), h('div', null, h('b', null, coName(r.company_id)), h('div', { class: 'small muted' }, `RUC ${coRuc(r.company_id)} · ${F.date(r.valid_from)} – ${r.valid_to ? F.date(r.valid_to) : 'vigente'}`), r.reason ? h('div', { class: 'small' }, r.reason) : null))));
    // ventas por mes y empresa emisora (CA-SEP-05)
    const months = []; let m = G.date.addMonths(G.date.month(G.TODAY), -2); for (let i = 0; i < 3; i++) { months.push(m); m = G.date.addMonths(m, 1); }
    const byMonth = months.map(mo => S.salesByCompany({ from: mo, to: monthEnd(mo), brand }));
    const cos = [...new Set(byMonth.flat().map(r => r.company_id))];
    const chart = cos.length ? G.ui.chart.bar({ labels: months.map(G.date.monthName), series: cos.map(c => ({ name: (coOf(c) || {}).trade_name || coName(c), values: byMonth.map(rows => (rows.find(r => r.company_id === c) || {}).total || 0) })), stacked: true, format: v => F.money(v) }) : G.ui.empty('Sin ventas de la marca en los últimos meses.');
    body.appendChild(h('div', { class: 'grid c2' }, card('Empresas emisoras por vigencia', hist.length ? tl : G.ui.empty('Sin vigencias registradas.')), card('Ventas por empresa emisora', h('div', null, chart, h('p', { class: 'small muted' }, 'Los comprobantes conservan la empresa con la que se emitieron (RN-SEP-18).')))));
    body.appendChild(card('Ventas por mes y empresa', table({ id: 'sep12-v', search: false, rows: months.flatMap((mo, i) => byMonth[i].map(r => Object.assign({ id: mo + r.company_id, month: mo }, r))), columns: [{ key: 'month', label: 'Mes', value: r => G.date.monthName(r.month) }, { key: 'company', label: 'Empresa emisora' }, { key: 'ruc', label: 'RUC', mono: true }, { key: 'docs', label: 'Comprobantes', align: 'r' }, { key: 'subtotal', label: 'Valor venta', align: 'r', value: r => F.money(r.subtotal) }, { key: 'total', label: 'Total', align: 'r', value: r => F.money(r.total) }], empty: 'Sin ventas.' }), { flush: true }));
    body.appendChild(card('Separaciones de la marca', table({ id: 'sep12-s', search: false, rows: seps, columns: [{ key: 'number', label: 'Número', mono: true }, { key: 'dest', label: 'Destino', value: s => `${destName(s.dest_type)} · ${destLabel(s)}` }, { key: 'cutoff_date', label: 'Corte', value: s => F.date(s.cutoff_date) }, { key: 'status', label: 'Estado', render: s => h('span', { class: 'row', style: 'gap:4px' }, stBadge(s.status), s.simulation ? badge('Simulación', 'info') : null) }, { key: 'completed_at', label: 'Completada', value: s => s.completed_at ? F.datetime(s.completed_at) : '—' }], onRow: s => sepDrawer(s), empty: 'Esta marca no tiene separaciones.' }), { flush: true }));
  }

  /* ------------------------------------------------------------------
     Registro
     ------------------------------------------------------------------ */
  const SP = Object.fromEntries((G.SPEC.SEP ? G.SPEC.SEP.screens : []).map(s => [s[0], s[1]]));
  G.register({
    code: 'SEP', name: 'Separación de marcas', phase: 4, group: 'Plataforma',
    screens: [
      { code: 'SEP-01', name: SP['SEP-01'] || 'Separaciones', render: sep01 },
      { code: 'SEP-02', name: SP['SEP-02'] || 'Nueva separación: destino y corte', render: sep02 },
      { code: 'SEP-03', name: SP['SEP-03'] || 'Validaciones previas', render: sep03 },
      { code: 'SEP-04', name: SP['SEP-04'] || 'Catálogo, precios y series', render: sep04 },
      { code: 'SEP-05', name: SP['SEP-05'] || 'Stock al corte y traspaso', render: sep05 },
      { code: 'SEP-06', name: SP['SEP-06'] || 'Clientes, pedidos abiertos y saldos', render: sep06 },
      { code: 'SEP-07', name: SP['SEP-07'] || 'Canales', render: sep07 },
      { code: 'SEP-08', name: SP['SEP-08'] || 'Usuarios y locales', render: sep08 },
      { code: 'SEP-09', name: SP['SEP-09'] || 'Resumen, aprobación y ejecución', render: sep09 },
      { code: 'SEP-10', name: SP['SEP-10'] || 'Exportación completa', render: sep10 },
      { code: 'SEP-11', name: SP['SEP-11'] || 'Acta', render: sep11 },
      { code: 'SEP-12', name: SP['SEP-12'] || 'Historial de la marca', render: sep12 },
    ],
  });

  /* ------------------------------------------------------------------
     Datos de ejemplo (orden 80, determinista)
     ------------------------------------------------------------------ */
  G.seed(80, () => {
    const ins = (t, r) => D.insert(t, r, { silent: true });
    const userBy = role => D.find('users', u => u.role === role && u.status === 'ACTIVE') || { id: null, name: G.roleName(role) };
    const cont = userBy('CONTADORA'), adm = userBy('ADMINISTRACION'), ger = userBy('GERENTE');
    // vigencias de empresa emisora de las marcas del tenant
    for (const b of D.all('brands')) if (!D.find(T_HIS, r => r.brand_id === b.id)) S.addHistory({ brand_id: b.id, company_id: b.company_id || 'co-dg', valid_from: '2023-03-01', valid_to: null, separation_id: null, reason: 'Alta de la marca' }, { silent: true });
    // empresa destino de la línea gourmet (otro RUC dentro de Aycha, D-SEP-02)
    if (!D.get('companies', 'co-gou')) ins('companies', { id: 'co-gou', legal_name: 'DON GUANDO GOURMET SAC', ruc: U.rucCheck('2061543287'), trade_name: 'Gourmet', tax_regime: 'MYPE', fiscal_address: 'Av. Los Próceres 1240 Of. 2, Santiago de Surco, Lima', fiscal_ubigeo: '150140', status: 'PREPARING', default_currency: 'PEN', timezone: 'America/Lima', einvoice_provider: 'OSE homologado', einvoice_env: 'PRODUCCION', einvoice_test: { at: '2026-10-07T11:00', result: 'ACCEPTED', series: 'B201' } });
    // almendras a granel recibidas en setiembre (Almacén 2), parte del stock al corte
    if (G.variant('va-M5-ALM-GRA') && !D.get('lots', 'lo-SEP-ALG')) {
      ins('lots', { id: 'lo-SEP-ALG', product_id: 'pr-ALME', variant_id: 'va-M5-ALM-GRA', code: 'L260906-ALG', origin: 'PURCHASE', supplier_id: null, production_date: '2026-09-05', expiry_date: '2027-03-05', qc_status: 'RELEASED', unit_cost: 46, released_at: '2026-09-06T11:00', released_by: 'Calidad' });
      try { G.inv.move({ type: 'RECEIPT', wh: 'wh-ALM-L2', variant: 'va-M5-ALM-GRA', lot: 'lo-SEP-ALG', qty: 25, weight: 25, unitCost: 46, source: { type: 'PURCHASE', id: null }, at: '2026-09-06T11:00', reason: 'Compra de almendras a granel' }); } catch (e) { console.error(e); }
    }
    // SEP-0001: primer intento a otro sistema, cancelado al decidir D-SEP-02
    const s1 = S.create({ brand_id: 'br-M5', dest_type: 'OTHER_SYSTEM', dest_system_name: 'Sistema propio de la línea gourmet', dest_legal_name: null, dest_ruc: null, cutoff_date: '2026-07-31', notes: 'Evaluación inicial de la línea de café y frutos secos.' }, { seed: true, number: 'SEP-0001', by: cont.id, byName: cont.name, at: '2026-08-12T10:30' });
    S.cancel(s1.id, 'D-SEP-02: la gerencia decidió que la línea gourmet va a otro RUC dentro de Aycha.', { seed: true, byName: ger.name, at: '2026-08-20T17:10' });
    // SEP-0002: línea gourmet al nuevo RUC del tenant, corte 30/09 (en curso: validaciones con un pedido en preparación)
    const s2 = S.create({ brand_id: 'br-M5', dest_type: 'OTHER_RUC', dest_company_id: 'co-gou', cutoff_date: '2026-09-30', receivables_policy: 'KEEP_ORIGIN', notes: 'La línea gourmet factura con su propio RUC desde el 01/10/2026; mismo inicio de sesión y misma bandeja.' }, { seed: true, number: 'SEP-0002', by: cont.id, byName: cont.name, at: '2026-10-08T09:40' });
    const aguay = S.items(s2.id, 'STOCK').filter(i => i.variant_id === 'va-IN-AGU-KG');
    for (const it of aguay) D.update(T_IT, it.id, { action: 'LEAVE', note: 'Insumo fresco: se consume en producción del origen antes de vencer' }, { silent: true });
    S.runChecks(s2.id, { seed: true, at: '2026-10-10T09:15', byName: cont.name });
    // SEP-0003: simulación de Despensa a otro sistema (ensayo completo con paquete y acta)
    const s3 = S.create({ brand_id: 'br-M4', dest_type: 'OTHER_SYSTEM', dest_system_name: 'ERP del comprador de la línea Despensa', dest_legal_name: 'DESPENSA ANDINA DISTRIBUCIONES SAC', dest_ruc: U.rucCheck('2060877412'), cutoff_date: '2026-08-31', simulation: true, receivables_policy: 'KEEP_ORIGIN', notes: 'Ensayo para estimar el paquete y los elementos si se vende la línea Despensa.' }, { seed: true, number: 'SEP-0003', by: adm.id, byName: adm.name, at: '2026-10-06T10:00' });
    S.runChecks(s3.id, { seed: true, at: '2026-10-06T10:20', byName: adm.name });
    const sm3 = S.checkSummary(s3.id);
    if (!sm3.fail) {
      S.validate(s3.id, sm3.warn ? 'Advertencias revisadas: ensayo sin efectos sobre los datos.' : null, { seed: true, byName: adm.name, at: '2026-10-06T10:25' });
      S.approve(s3.id, 'Aprobado como ensayo.', { seed: true, by: ger.id, byName: ger.name, at: '2026-10-06T16:00' });
      S.execute(s3.id, { seed: true, byName: adm.name, at: '2026-10-07T09:00' });
      S.buildExport(s3.id, { seed: true, by: adm.id, byName: adm.name, at: '2026-10-07T09:30' });
      S.approveExport(s3.id, { seed: true, by: ger.id, byName: ger.name, at: '2026-10-08T09:00' });
      if (S.get(s3.id).status === 'EXECUTING') S.complete(s3.id, { seed: true, byName: adm.name, at: '2026-10-08T09:10' });
    }
  }, 'SEP');

  /* ------------------------------------------------------------------
     Pruebas funcionales (una por criterio CA, más reglas)
     ------------------------------------------------------------------ */
  const asRole = async (role, fn) => { const prev = G.ctx.role; G.ctx.role = role; try { return await fn(); } finally { G.ctx.role = prev; } };
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba ${code} y no falló`); };
  const bySeq = n => D.find(T_SEP, s => s.number === n);
  const finishPrep = brand => { for (const o of S.ordersInProcess(brand)) { o.status = 'DELIVERED'; o.delivered_at = G.TODAY + 'T12:00'; (o.history = o.history || []).push({ at: G.TODAY + 'T12:00', from: 'IN_ROUTE', to: 'DELIVERED', user: 'Prueba' }); } };
  const closeSept = () => { const p = G.period.of('2026-09-30'); D.update('accounting_periods', p.id, { status: 'CLOSED', closed_at: G.TODAY + 'T08:00', closed_by: 'Contadora' }); };
  const runM5 = (o = {}) => {
    const s = bySeq('SEP-0002'); finishPrep('br-M5');
    if (o.prepare) o.prepare(s);
    S.runChecks(s.id); const sm = S.checkSummary(s.id); if (sm.fail) throw new Error('Validaciones en FAIL: ' + S.checks(s.id).filter(c => c.result === 'FAIL').map(c => c.code + ' ' + c.detail).join(' | '));
    S.validate(s.id, 'Advertencias aceptadas en la prueba');
    if (o.beforeApprove) o.beforeApprove(s);
    closeSept(); S.approve(s.id, 'Aprobada');
    const r = S.execute(s.id);
    if (r.status !== 'COMPLETED') throw new Error(`Quedó ${r.status}: ` + S.items(s.id).filter(i => i.status === 'FAILED').map(i => `${i.label}: ${i.error}`).join(' | '));
    return S.get(s.id);
  };
  G.tests.push({ module: 'SEP', name: 'CA-SEP-01: gourmet a nuevo RUC con corte 30/09: rechazo con setiembre abierto, aprobación con setiembre cerrado, B201 desde el 01/10 y boleta con el RUC anterior rechazada', fn: async () => {
    const s = bySeq('SEP-0002'); if (!s || s.brand_id !== 'br-M5' || s.dest_type !== 'OTHER_RUC' || s.cutoff_date !== '2026-09-30') throw new Error('Falta la separación de la línea gourmet');
    finishPrep('br-M5'); S.runChecks(s.id); S.validate(s.id, 'Advertencias aceptadas');
    if (G.period.isClosed('2026-09-30')) throw new Error('Setiembre debería estar abierto');
    expectFail(() => S.approve(s.id, 'x'), 'RN-SEP-01');
    closeSept();
    const ap = S.approve(s.id, 'Aprobada por gerencia'); if (ap.status !== 'APPROVED' || ap.approved_by === ap.prepared_by) throw new Error('No quedó aprobada por otra persona');
    const r = S.execute(s.id); if (r.status !== 'COMPLETED') throw new Error('No se completó: ' + S.items(s.id).filter(i => i.status === 'FAILED').map(i => i.error).join(' | '));
    const doc = G.docs.issue({ doc_type: 'RECEIPT', brand_id: 'br-M5', establishment_id: 'es-L1', customer_id: 'cu-VARIOS', lines: [{ variant_id: 'va-M5-CAF-250', description: 'Café tostado molido 250 g', qty: 1, uom_code: 'NIU', unit_price: 32, total: 32 }], date: '2026-10-05' });
    if (doc.series !== 'B201' || doc.company_id !== 'co-gou') throw new Error(`Se emitió ${doc.series} con ${doc.company_id}`);
    expectFail(() => G.docs.issue({ doc_type: 'RECEIPT', brand_id: 'br-M5', company_id: 'co-dg', establishment_id: 'es-L1', customer_id: 'cu-VARIOS', lines: [{ description: 'Café', qty: 1, unit_price: 32, total: 32 }], date: '2026-10-05' }), 'RN-SEP-05');
    expectFail(() => G.docs.issue({ doc_type: 'RECEIPT', brand_id: 'br-M5', series: 'B005', establishment_id: 'es-L1', customer_id: 'cu-VARIOS', lines: [{ description: 'Café', qty: 1, unit_price: 32, total: 32 }], date: '2026-10-05' }), 'RN-SEP-05');
    if (S.companyFor('br-M5', '2026-09-30') !== 'co-dg' || S.companyFor('br-M5', '2026-10-01') !== 'co-gou') throw new Error('Vigencias mal cerradas');
    if (G.fac) { const d2 = G.fac.issue({ doc_type: 'RECEIPT', brand_id: 'br-M5', customer_id: 'cu-0001', lines: [{ variant_id: 'va-M5-CAF-250', description: 'Café', qty: 1, unit_price: 32, total: 32 }], date: '2026-10-05' }); if (d2.series !== 'B201' || d2.company_id !== 'co-gou') throw new Error('FAC emitió ' + d2.series); }
  } });
  G.tests.push({ module: 'SEP', name: 'CA-SEP-02: traspaso de 40 u de café (Almacén 1) y 25 kg de frutos secos (Almacén 2) con factura y guías; destino recibe 40 u y 25 kg; diferencia 0', fn: async () => {
    const s = runM5({ prepare: sep => {
      // 40 u de café recibidas el 28/09 en el Almacén 1 (antes del corte) y las almendras a granel sembradas (25 kg en el Almacén 2)
      D.insert('lots', { id: 'lo-T-CAF', product_id: 'pr-CAFE', variant_id: 'va-M5-CAF-250', code: 'L260928-CAF', origin: 'PRODUCTION', production_date: '2026-09-28', expiry_date: '2027-06-28', qc_status: 'RELEASED', unit_cost: 14.5 });
      G.inv.move({ type: 'RECEIPT', wh: 'wh-ALM-L1', variant: 'va-M5-CAF-250', lot: 'lo-T-CAF', qty: 40, unitCost: 14.5, source: { type: 'PRODUCTION', id: null }, at: '2026-09-28T10:00', reason: 'Tostado de setiembre' });
      S.buildItems(sep.id);
      const st = S.items(sep.id, 'STOCK');
      const c1 = st.find(i => i.lot_id === 'lo-T-CAF'), al = st.find(i => i.variant_id === 'va-M5-ALM-GRA' && i.warehouse_id === 'wh-ALM-L2');
      if (!c1 || !al) throw new Error('Faltan los lotes de café o de almendras en el stock al corte');
      if (c1.qty_at_cutoff !== 40 || al.qty_at_cutoff !== 25) throw new Error(`Stock al corte: café ${c1.qty_at_cutoff} u, almendras ${al.qty_at_cutoff} kg`);
      for (const it of st) if (![c1.id, al.id].includes(it.id)) S.setItem(it.id, { status: 'EXCLUDED', exclude_reason: 'Fuera del caso de prueba' });
      S.setItem(c1.id, { qty: 40, action: 'TRANSFER' }); S.setItem(al.id, { qty: 25, action: 'TRANSFER' });
    } });
    const td = s.transfer_docs || []; if (td.length !== 1) throw new Error('Se esperaba un comprobante de traspaso: ' + td.length);
    const doc = D.get('sales_documents', td[0].document_id); if (!doc || doc.doc_type !== 'INVOICE' || doc.company_id !== 'co-dg') throw new Error('El comprobante de venta no es factura de la empresa de origen');
    if ((td[0].guides || []).length !== 2) throw new Error('Se esperaban 2 guías (L1 y L2): ' + (td[0].guides || []).join(','));
    const wh1 = S.destWarehouse(s, 'es-L1'), wh2 = S.destWarehouse(s, 'es-L2');
    const q1 = G.inv.qty('va-M5-CAF-250', wh1.id), q2 = G.inv.qty('va-M5-ALM-GRA', wh2.id);
    if (q1 !== 40 || q2 !== 25) throw new Error(`Destino recibió ${q1} u y ${q2} kg`);
    const k = G.kpi('KPI-SEP-01', { from: '2026-01-01', to: '2026-12-31' }); if (!k || k.value !== 0 || k.numerator !== 2) throw new Error('KPI-SEP-01 = ' + JSON.stringify(k));
  } });
  G.tests.push({ module: 'SEP', name: 'CA-SEP-03: a otro sistema no se completa sin paquete; con paquete y huella queda SEPARATED y un pedido nuevo se rechaza con RN-SEP-06', fn: async () => {
    finishPrep('br-M3');
    const s = await asRole('CONTADORA', () => { const x = S.create({ brand_id: 'br-M3', dest_type: 'OTHER_SYSTEM', dest_system_name: 'ERP de Embutidos del Norte', dest_legal_name: 'EMBUTIDOS DEL NORTE SAC', cutoff_date: '2026-08-31' }); S.runChecks(x.id); S.validate(x.id, 'Advertencias aceptadas'); return x; });
    S.approve(s.id, 'Aprobada');
    const r = S.execute(s.id); if (r.status !== 'EXECUTING') throw new Error('Debería quedar en ejecución sin paquete: ' + r.status + ' ' + S.items(s.id).filter(i => i.status === 'FAILED').map(i => i.error).join('|'));
    expectFail(() => S.complete(s.id), 'RN-SEP-10');
    const ex = S.buildExport(s.id); if (!/^[0-9a-f]{64}$/.test(ex.sha256) || !(ex.size_bytes > 0)) throw new Error('Paquete sin huella');
    const c = S.complete(s.id); if (c.status !== 'COMPLETED' || brandOf('br-M3').status !== 'SEPARATED') throw new Error('La marca no quedó SEPARATED');
    const v = D.find('product_variants', x => x.brand_id === 'br-M3' && x.sellable);
    expectFail(() => G.orders.create({ brand_id: 'br-M3', customer_id: 'cu-0001', channel: 'WHATSAPP', lines: v ? [{ variant_id: v.id, qty: 1 }] : [] }), 'RN-SEP-06');
  } });
  G.tests.push({ module: 'SEP', name: 'CA-SEP-04: 12 pedidos confirmados sin despachar se mantienen y se facturan con el nuevo RUC; pedidos abiertos resueltos 100 %', fn: async () => {
    const s = runM5({ prepare: sep => {
      const open = S.openOrders('br-M5'); const base = D.where('sales_orders', o => o.brand_id === 'br-M5' && o.status === 'CLOSED' && o.lines && o.lines.length).slice(0, 12 - open.length);
      for (const o of base) { const c = U.clone(o); delete c.id; Object.assign(c, { number: D.next('PED', 'P-', 6), status: 'CONFIRMED', delivered_at: null, closed_at: null, delivery_date: '2026-10-12', paid_amount: 0, payment_ids: [], history: [{ at: '2026-09-29T10:00', from: 'DRAFT', to: 'CONFIRMED', user: 'Prueba' }] }); c.lines.forEach(l => { l.weighed_kg = null; }); G.orders.recalc(c); D.insert('sales_orders', c); }
      if (S.openOrders('br-M5').length !== 12) throw new Error('El caso necesita 12 pedidos abiertos');
      S.buildItems(sep.id);
    } });
    const its = S.items(s.id, 'ORDER'); if (its.length !== 12 || its.some(i => i.status !== 'DONE' || i.action !== 'KEEP')) throw new Error('Pedidos no resueltos: ' + its.map(i => i.status).join(','));
    const k = G.kpi('KPI-SEP-02', { from: '2026-01-01', to: '2026-12-31' }); if (!k || k.value !== 100 || k.denominator !== 12) throw new Error('KPI-SEP-02 = ' + JSON.stringify(k));
    for (const it of its) { const o = D.get('sales_orders', it.ref_id); const d = G.docs.fromOrder(o, { date: G.TODAY }); if (d.company_id !== 'co-gou' || !['B201', 'F201'].includes(d.series)) throw new Error(`${o.number} facturado con ${d.series} · ${d.company_id}`); }
  } });
  G.tests.push({ module: 'SEP', name: 'CA-SEP-05: el WhatsApp de la marca sigue en la bandeja con sus chats y setiembre muestra las ventas con el RUC anterior', fn: async () => {
    const before = S.convCount('ch-wa-0501'); const sepBefore = S.salesByCompany({ from: '2026-09-01', to: '2026-09-30', brand: 'br-M5' });
    const s = runM5();
    const it = S.items(s.id, 'CHANNEL').find(i => i.ref_id === 'ch-wa-0501'); if (!it || it.action !== 'KEEP_INBOX' || it.status !== 'DONE') throw new Error('El número no quedó en la bandeja');
    const ch = D.get('messaging_channels', 'ch-wa-0501'); if (!ch || ['DISCONNECTED', 'MIGRATED'].includes(ch.status) || ch.brand_id !== 'br-M5') throw new Error('Canal alterado');
    if (S.convCount('ch-wa-0501') !== before || before === 0) throw new Error('Se perdieron conversaciones');
    const sepAfter = S.salesByCompany({ from: '2026-09-01', to: '2026-09-30', brand: 'br-M5' });
    if (sepAfter.length !== 1 || sepAfter[0].company_id !== 'co-dg' || sepAfter[0].total !== sepBefore[0].total || !(sepAfter[0].total > 0)) throw new Error('Setiembre cambió de empresa: ' + JSON.stringify(sepAfter));
  } });
  G.tests.push({ module: 'SEP', name: 'CA-SEP-06: con 3 pedidos de la marca en preparación NO_ORDERS_IN_PREPARATION queda en FAIL y no pasa a validada hasta que se terminen', fn: async () => {
    const s = bySeq('SEP-0002');
    const cand = S.ordersInProcess('br-M5').concat(D.where('sales_orders', o => o.brand_id === 'br-M5' && ['CONFIRMED', 'CLOSED'].includes(o.status))).slice(0, 3);
    for (const o of cand) o.status = 'IN_PREPARATION';
    if (S.ordersInProcess('br-M5').length !== 3) throw new Error('El caso necesita 3 pedidos en preparación');
    S.runChecks(s.id); const c = S.checks(s.id).find(x => x.code === 'NO_ORDERS_IN_PREPARATION');
    if (c.result !== 'FAIL' || c.count !== 3) throw new Error('Validación: ' + c.result + ' ' + c.count);
    expectFail(() => S.validate(s.id, 'nota'), 'RN-SEP-07'); if (S.get(s.id).status !== 'DRAFT') throw new Error('No debía validarse');
    finishPrep('br-M5'); S.runChecks(s.id);
    if (S.checks(s.id).find(x => x.code === 'NO_ORDERS_IN_PREPARATION').result !== 'PASS') throw new Error('Debería pasar');
    if (S.validate(s.id, 'Advertencias aceptadas').status !== 'VALIDATED') throw new Error('No quedó validada');
  } });
  G.tests.push({ module: 'SEP', name: 'RN-SEP-05: disparador de empresa vigente en sales_documents (inserción directa y notas)', fn: async () => {
    const before = D.find('sales_documents', d => d.brand_id === 'br-M5' && d.issue_date <= '2026-09-30' && d.doc_type === 'RECEIPT');
    runM5();
    expectFail(() => D.insert('sales_documents', { company_id: 'co-dg', brand_id: 'br-M5', doc_type: 'RECEIPT', series: 'B005', number: 999, issue_date: '2026-10-06', total: 10 }), 'RN-SEP-05');
    const ok = D.insert('sales_documents', { company_id: 'co-dg', brand_id: 'br-M5', doc_type: 'RECEIPT', series: 'B005', number: 998, issue_date: '2026-09-29', total: 10 }); if (ok.company_id !== 'co-dg') throw new Error('Un comprobante anterior al corte debe conservar su empresa');
    if (before.company_id !== 'co-dg') throw new Error('El histórico cambió de empresa');
    const nc = G.docs.issue({ doc_type: 'CREDIT_NOTE', brand_id: 'br-M5', establishment_id: 'es-L1', customer_id: before.customer_id || 'cu-VARIOS', related_document_id: before.id, applies_to: 'RECEIPT', lines: [{ description: 'Devolución', qty: 1, unit_price: 5, total: 5 }], date: G.TODAY, note_reason_code: '07', note_reason: 'Devolución' });
    if (nc.company_id !== 'co-dg' || nc.series !== 'BC05') throw new Error(`La nota de un comprobante anterior debe seguir su empresa (${nc.series} · ${nc.company_id})`);
  } });
  G.tests.push({ module: 'SEP', name: 'RN-SEP-06: disparador de marca separada en sales_orders', fn: async () => {
    if (S.assertOrderBrand('br-M4') !== true) throw new Error('La simulación no debe separar la marca');
    D.update('brands', 'br-M4', { status: 'SEPARATED', separation_id: bySeq('SEP-0003').id });
    expectFail(() => S.assertOrderBrand('br-M4'), 'RN-SEP-06');
    expectFail(() => D.insert('sales_orders', { brand_id: 'br-M4', number: 'P-TEST', status: 'DRAFT', lines: [] }), 'RN-SEP-06');
  } });
  G.tests.push({ module: 'SEP', name: 'RN-SEP-02/03/04/08/11/12: una viva por marca, destino coherente, vigencias sin cruce, aprueba otra persona, alcance fijo y stock con cantidad', fn: async () => {
    expectFail(() => S.create({ brand_id: 'br-M5', dest_type: 'OTHER_RUC', dest_company_id: 'co-gou', cutoff_date: '2026-08-31' }), 'RN-SEP-02');
    expectFail(() => S.create({ brand_id: 'br-M2', dest_type: 'OTHER_RUC', dest_company_id: 'co-dg', cutoff_date: '2026-08-31' }), 'RN-SEP-03');
    expectFail(() => S.create({ brand_id: 'br-M2', dest_type: 'OTHER_TENANT', cutoff_date: '2026-08-31' }), 'RN-SEP-03');
    expectFail(() => S.create({ brand_id: 'br-M2', dest_type: 'OTHER_SYSTEM', dest_system_name: 'X', cutoff_date: '2026-08-30' }), 'RN-SEP-01');
    expectFail(() => S.addHistory({ brand_id: 'br-M2', company_id: 'co-gou', valid_from: '2026-10-01', valid_to: null }), 'RN-SEP-04');
    const s = bySeq('SEP-0002'); finishPrep('br-M5'); S.runChecks(s.id); S.validate(s.id, 'ok'); closeSept();
    await asRole('CONTADORA', () => expectFail(() => S.approve(s.id, 'x'), 'RN-SEP-08'));
    const prev = s.prepared_by; D.update(T_SEP, s.id, { prepared_by: me() }); expectFail(() => S.approve(s.id, 'x'), 'RN-SEP-08'); D.update(T_SEP, s.id, { prepared_by: prev });
    const it = S.items(s.id, 'STOCK').find(i => i.action === 'TRANSFER');
    expectFail(() => S.setItem(it.id, { qty: 0 }), 'RN-SEP-12');
    S.approve(s.id, 'ok');
    expectFail(() => S.update(s.id, { cutoff_date: '2026-08-31' }), 'RN-SEP-11');
    expectFail(() => S.setItem(it.id, { qty: 1 }), 'RN-SEP-11');
    const sim = bySeq('SEP-0003'); if (sim.status !== 'COMPLETED' || !sim.export || brandOf('br-M4').status === 'SEPARATED') throw new Error('La simulación sembrada debe estar completada sin separar la marca');
    expectFail(() => S.cancel(sim.id, 'x'), 'RN-SEP-11');
  } });
})();
