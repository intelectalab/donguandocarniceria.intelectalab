/* =====================================================================
   COM · Compras y cuentas por pagar (fase 2)
   Proveedores → catálogo → requerimientos → OC con aprobación por monto →
   recepción valorizada (G.inv.move RECEIPT, lote liberado o en cuarentena) →
   comprobante del proveedor con cruce de tres vías → cuentas por pagar → pagos.
   Tablas propias: supplier_catalog, purchase_orders, purchase_order_lines,
   purchase_receipts, purchase_receipt_lines, purchase_documents,
   purchase_document_lines, supplier_payments, supplier_payment_allocations
   (+ purchase_requisitions para COM-03).
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, toast, form, tabs, confirm, empty, progress } = G.ui;
  const U = G.util, F = G.fmt, R = (n, d = 2) => U.round(n, d);
  const MOD = 'COM';
  /** tasa del IGV: fac_igv_rate puede venir como 18 o como 0,18 */
  const igvRate = () => { const r = G.tax.rate(); return r < 0.05 ? r * 100 : r; };

  /* ---------- etiquetas ---------- */
  const LBL = {
    DRAFT: ['Borrador', ''], PENDING_APPROVAL: ['Por aprobar', 'warn'], APPROVED: ['Aprobada', 'ok'], PARTIALLY_RECEIVED: ['Recibida parcial', 'warn'], RECEIVED: ['Recibida', 'ok'], CLOSED: ['Cerrada', ''], VOIDED: ['Anulado', 'bad'],
    POSTED: ['Registrada', 'ok'], REGISTERED: ['Registrado', 'info'], OBSERVED: ['Observado', 'warn'], NOT_CHECKED: ['Sin cruce', ''], MATCHED: ['Cuadra', 'ok'], APPROVED_DIFF: ['Diferencia aprobada', 'info'],
    PENDING: ['Pendiente', 'warn'], ORDERED: ['En OC', 'info'], CANCELLED: ['Cancelado', ''], CONFIRMED: ['Confirmado', 'ok'], REVERSED: ['Revertido', 'bad'], ACTIVE: ['Activo', 'ok'], INACTIVE: ['Inactivo', ''],
    SUSPENDED: ['Suspendido', 'bad'], LOW: ['De baja', 'bad'], NOT_LOCATED: ['No habido', 'bad'], UNKNOWN: ['Sin consultar', ''], PAID: ['Pagado', 'ok'], PARTIAL: ['Pago parcial', 'warn'], OPEN: ['Por pagar', 'info'], OVERDUE: ['Vencido', 'bad'],
    QUARANTINE: ['Cuarentena', 'warn'], RELEASED: ['Liberado', 'ok'], REJECTED: ['Rechazado', 'bad'], HOLD: ['Decisión de calidad', 'warn'], ACCEPTED: ['Aceptada', 'ok'],
  };
  const st = s => LBL[s] ? badge(LBL[s][0], LBL[s][1]) : G.ui.status(s);
  const SUP_TYPES = [['PRODUCER', 'Productor'], ['SLAUGHTERHOUSE', 'Camal'], ['RELATED_FARM', 'Granja relacionada'], ['PACKAGING', 'Empaques'], ['INPUTS', 'Insumos'], ['SERVICES', 'Servicios'], ['ADVERTISING', 'Publicidad'], ['CONTENT_CREATOR', 'Creador de contenido'], ['DELIVERY_COMPANY', 'Empresa de delivery'], ['VEHICLE_RENTAL', 'Alquiler de vehículos'], ['OTHER', 'Otro']];
  const supTypeName = t => (SUP_TYPES.find(x => x[0] === t) || [t, t])[1];
  const PDOC = [['INVOICE', 'Factura', '01'], ['RECEIPT', 'Boleta de venta', '03'], ['FEE_RECEIPT', 'Recibo por honorarios', '02'], ['CREDIT_NOTE', 'Nota de crédito', '07'], ['DEBIT_NOTE', 'Nota de débito', '08'], ['PURCHASE_SETTLEMENT', 'Liquidación de compra', '04'], ['INTERNAL_TRANSFER', 'Nota de transferencia interna (NTI)', '00'], ['OTHER', 'Otro (no domiciliado)', '91']];
  const pdocName = t => (PDOC.find(x => x[0] === t) || [t, t])[1];
  const sunatType = t => (PDOC.find(x => x[0] === t) || [, , '00'])[2];
  const IGV_TYPES = ['INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_SETTLEMENT'];
  const CREDIT_TYPES = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_SETTLEMENT'];
  const METHODS = [['TRANSFER', 'Transferencia'], ['CASH', 'Efectivo'], ['CHECK', 'Cheque'], ['YAPE', 'Yape'], ['PLIN', 'Plin'], ['INTERNAL_SETTLEMENT', 'Liquidación interna'], ['OTHER', 'Otro (detracción u otro)']];
  const methodName = m => (METHODS.find(x => x[0] === m) || [m, m])[1];
  const SUNAT_ST = [['ACTIVE', 'Activo y habido'], ['SUSPENDED', 'Suspensión temporal'], ['LOW', 'De baja'], ['NOT_LOCATED', 'No habido'], ['UNKNOWN', 'Sin consultar']];

  /* ---------- ayudas ---------- */
  const sup = id => G.db.get('suppliers', id);
  const supName = id => G.supName(id);
  const uid = () => G.ctx.userId();
  const normSer = s => String(s ?? '').trim().toUpperCase();
  const normNum = n => String(n ?? '').trim().replace(/^0+(?=\d)/, '');
  const docRef = d => d ? `${d.series}-${d.number}` : '—';
  const docLabel = d => d ? `${d.doc_type === 'INTERNAL_TRANSFER' ? 'NTI' : pdocName(d.doc_type)} ${docRef(d)}` : '—';
  const fxOf = d => Number(d.exchange_rate) || 1;
  const pen = (d, v) => R((Number(v) || 0) * fxOf(d));
  const moneyDoc = (d, v) => (d.currency && d.currency !== 'PEN') ? `US$ ${F.num(v, 2)}` : F.money(v);
  const prodOf = vid => G.productOf(vid) || {};
  const isMeat = vid => { const p = prodOf(vid); return ['pc-MP', 'pc-CUY', 'pc-CONEJO', 'pc-AVES', 'pc-CORDERO', 'pc-CERDO', 'pc-RES'].includes(p.category_id); };
  const basisOf = vid => { const v = G.variant(vid); return v && v.sale_mode === 'UNIT' ? 'UNIT' : 'KG'; };
  const qtyLbl = (l, basis) => basis === 'KG' ? F.kg(l.qty, 3) : F.num(l.qty, 0) + ' u';
  const can = p => G.can(p);
  const perm = (p, what) => { if (!G.can(p)) throw new Error(`Tu rol (${G.roleName()}) no tiene el permiso ${p} para ${what}.`); };
  const tryDo = (fn, ok) => { try { const r = fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); G.refresh(); return r || true; } catch (e) { toast(e.message, 'bad'); if (!(e instanceof G.RuleError) && !/permiso|Elige|Indica|Agrega/.test(e.message)) console.warn(e); return null; } };
  const userIs = (a, b) => a && b && a === b;
  const tol = k => Number(G.param(k));
  const dateOnly = s => String(s || '').slice(0, 10);
  const COMPANY = () => G.db.get('companies', 'co-dg') || G.db.find('companies', () => true) || {};

  /* ---------- proveedores (RN-COM-11, RN-COM-13) ---------- */
  const NOT_LOCATED_RUCS = new Set(); // lo llena el seed (conector falso de INT)
  /** conector falso de consulta RUC (INT): devuelve condición y estado del contribuyente */
  function sunatLookup(docNumber) {
    const ruc = String(docNumber || '');
    if (!U.rucOk(ruc)) return { ok: false, status: 'UNKNOWN', msg: 'RUC con formato o dígito verificador inválido.' };
    if (NOT_LOCATED_RUCS.has(ruc)) return { ok: true, status: 'NOT_LOCATED', msg: 'Contribuyente activo · condición NO HABIDO' };
    const s = G.db.find('suppliers', x => x.doc_number === ruc);
    if (s && ['LOW', 'SUSPENDED'].includes(s.sunat_status)) return { ok: true, status: s.sunat_status, msg: s.sunat_status === 'LOW' ? 'Baja de oficio' : 'Suspensión temporal de actividades' };
    return { ok: true, status: 'ACTIVE', msg: 'Contribuyente ACTIVO · condición HABIDO' };
  }
  function checkSunat(id) {
    const s = sup(id); if (!s) throw new Error('Proveedor no encontrado.');
    if (s.doc_type !== 'RUC') return G.db.update('suppliers', id, { sunat_status: 'UNKNOWN', sunat_checked_at: G.date.now(), sunat_msg: 'Sin RUC: no se consulta en la SUNAT' });
    const r = sunatLookup(s.doc_number);
    return G.db.update('suppliers', id, { sunat_status: r.status, sunat_checked_at: G.date.now(), sunat_msg: r.msg });
  }
  function assertSupplierCanOrder(s) {
    if (!s) G.fail('RN-COM-11', 'Elige el proveedor.');
    if (s.status !== 'ACTIVE') G.fail('RN-COM-11', `${s.trade_name || s.legal_name} está inactivo: no recibe órdenes de compra.`);
    if (['NOT_LOCATED', 'LOW', 'SUSPENDED'].includes(s.sunat_status)) G.fail('RN-COM-11', `${s.trade_name || s.legal_name} figura como «${LBL[s.sunat_status][0]}» en la SUNAT: no recibe órdenes de compra. Vuelve a consultar su RUC cuando regularice.`);
  }
  function saveSupplier(vals, row) {
    const dt = vals.doc_type || 'RUC';
    const dn = String(vals.doc_number || '').trim();
    if (dt === 'RUC' && !U.rucOk(dn)) G.fail('RN-COM-11', `El RUC ${dn || '(vacío)'} no es válido (11 dígitos con dígito verificador SUNAT).`);
    if (dt === 'DNI' && !U.dniOk(dn)) G.fail('RN-COM-11', 'El DNI debe tener 8 dígitos.');
    const dup = G.db.find('suppliers', s => s.doc_type === dt && s.doc_number === dn && (!row || s.id !== row.id));
    if (dup) G.fail('RN-COM-11', `Ya existe el proveedor ${dup.trade_name || dup.legal_name} con ${dt} ${dn}.`);
    const base = { doc_type: dt, doc_number: dn, legal_name: vals.legal_name, trade_name: vals.trade_name || null, supplier_type: vals.supplier_type, phone: vals.phone || null, email: vals.email || null, payment_terms_days: Number(vals.payment_terms_days) || 0, default_cost_center_id: vals.default_cost_center_id || null, status: vals.status || 'ACTIVE', notes: vals.notes || null, bank_name: vals.bank_name || null };
    let s;
    if (row) {
      s = G.db.update('suppliers', row.id, base);
      if ((vals.bank_account || '') !== (row.bank_account || '')) requestBankChange(row.id, vals.bank_account, 'Cambio desde la ficha del proveedor');
    } else {
      s = G.db.insert('suppliers', Object.assign(base, { bank_account: vals.bank_account || null, related_company_id: vals.supplier_type === 'RELATED_FARM' ? 'co-dg' : null, rating: 3, sunat_status: 'UNKNOWN' }));
      if (dt === 'RUC') checkSunat(s.id);
    }
    return s;
  }
  /** RN-COM-13: la cuenta bancaria solo la cambia GERENTE; los demás la solicitan */
  function requestBankChange(id, account, reason, opts = {}) {
    const s = sup(id); if (!s) throw new Error('Proveedor no encontrado.');
    const acc = String(account || '').trim();
    if (!acc) G.fail('RN-COM-13', 'Indica el número de cuenta bancaria.');
    if (G.can('com.supplier.bank_change') && !opts.forceRequest) {
      G.db.update('suppliers', id, { bank_account: acc, pending_bank_change: null });
      G.audit('CUENTA_BANCARIA', 'suppliers', id, `Cuenta de ${s.trade_name}: ${s.bank_account || '—'} → ${acc} · ${reason || 'sin motivo'}`);
      return { applied: true };
    }
    G.db.update('suppliers', id, { pending_bank_change: { account: acc, reason: reason || null, requested_by: opts.user || uid(), requested_at: G.date.now() } });
    if (!G._seeding) G.notify({ role: 'GERENTE', title: 'Cambio de cuenta bancaria por aprobar', body: `${s.trade_name}: ${acc}`, ref: id, module: MOD, tone: 'warn' });
    return { applied: false };
  }
  function approveBankChange(id, user = uid()) {
    const s = sup(id); const p = s && s.pending_bank_change; if (!p) throw new Error('No hay un cambio de cuenta pendiente.');
    if (!G.can('com.supplier.bank_change')) G.fail('RN-COM-13', 'Cambiar la cuenta bancaria de un proveedor exige com.supplier.bank_change (GERENTE).');
    if (userIs(p.requested_by, user)) G.fail('RN-COM-13', 'Quien solicita el cambio de cuenta no lo aprueba.');
    G.db.update('suppliers', id, { bank_account: p.account, pending_bank_change: null, bank_changed_at: G.date.now(), bank_changed_by: user });
    G.audit('CUENTA_BANCARIA', 'suppliers', id, `Aprobado: ${s.bank_account || '—'} → ${p.account} (solicitó ${G.userName(p.requested_by)}) · ${p.reason || ''}`);
  }

  /* ---------- catálogo por proveedor ---------- */
  function catalogOf(supplierId) { return G.db.where('supplier_catalog', c => c.supplier_id === supplierId && c.status === 'ACTIVE'); }
  function catalogPrice(supplierId, vid) { const c = G.db.find('supplier_catalog', x => x.supplier_id === supplierId && x.variant_id === vid); return c ? c.last_price : null; }
  function updateCatalogPrice(supplierId, vid, price, date, source) {
    if (!vid) return;
    let c = G.db.find('supplier_catalog', x => x.supplier_id === supplierId && x.variant_id === vid);
    if (!c) c = G.db.insert('supplier_catalog', { supplier_id: supplierId, variant_id: vid, supplier_sku: null, purchase_uom_id: basisOf(vid) === 'KG' ? 'um-KGM' : 'um-NIU', price_basis: basisOf(vid), last_price: price, min_order_qty: null, lead_time_days: 2, status: 'ACTIVE', price_history: [] }, { silent: true });
    const hist = (c.price_history || []).concat([{ date, price: R(price, 4), source }]).slice(-12);
    G.db.update('supplier_catalog', c.id, { last_price: R(price, 4), price_history: hist }, { silent: true });
  }

  /* ---------- requerimientos (COM-03) ---------- */
  function createRequisition(d, opts = {}) {
    if (!d.variant_id) throw new Error('Elige el producto.');
    if (!(Number(d.qty) > 0)) throw new Error('Indica una cantidad mayor que cero.');
    return G.db.insert('purchase_requisitions', { number: G.db.next('RQ', 'RQ-', 4), source: d.source || 'MANUAL', source_ref: d.source_ref || null, warehouse_id: d.warehouse_id || 'wh-ALM-L2', establishment_id: (G.db.get('warehouses', d.warehouse_id || 'wh-ALM-L2') || {}).establishment_id || 'es-L2', variant_id: d.variant_id, qty: Number(d.qty), needed_date: d.needed_date || G.date.add(G.TODAY, 3), status: 'PENDING', requested_by: opts.user || uid(), requested_at: opts.at || G.date.now(), po_id: null, notes: d.notes || null }, { silent: !!opts.silent });
  }
  /** agrupa requerimientos pendientes en OC por proveedor (el más barato del catálogo o el elegido) */
  function requisitionsToPOs(ids, supplierPick = {}, opts = {}) {
    const reqs = ids.map(id => G.db.get('purchase_requisitions', id)).filter(r => r && r.status === 'PENDING');
    if (!reqs.length) throw new Error('Elige al menos un requerimiento pendiente.');
    const groups = {};
    for (const r of reqs) {
      const cands = G.db.where('supplier_catalog', c => c.variant_id === r.variant_id && c.status === 'ACTIVE' && (sup(c.supplier_id) || {}).status === 'ACTIVE' && !['NOT_LOCATED', 'LOW'].includes((sup(c.supplier_id) || {}).sunat_status)).sort(U.by('last_price'));
      const sid = supplierPick[r.id] || (cands[0] && cands[0].supplier_id);
      if (!sid) throw new Error(`${G.variantName(r.variant_id)} no tiene proveedor en el catálogo (COM-02): agrégalo primero.`);
      const k = sid + '|' + r.warehouse_id; (groups[k] = groups[k] || []).push(r);
    }
    const pos = [];
    for (const [k, rs] of Object.entries(groups)) {
      const [sid, wh] = k.split('|');
      const po = createPO({ supplier_id: sid, warehouse_id: wh, establishment_id: (G.db.get('warehouses', wh) || {}).establishment_id, expected_date: rs.map(r => r.needed_date).sort()[0], notes: 'Desde requerimientos ' + rs.map(r => r.number).join(', '), lines: rs.map(r => ({ variant_id: r.variant_id, qty: r.qty, price_basis: basisOf(r.variant_id), unit_price: catalogPrice(sid, r.variant_id) || (G.variant(r.variant_id) || {}).std_cost || 0 })) }, opts);
      for (const r of rs) G.db.update('purchase_requisitions', r.id, { status: 'ORDERED', po_id: po.id }, { silent: true });
      pos.push(po);
    }
    return pos;
  }

  /* ---------- órdenes de compra (RN-COM-01) ---------- */
  const poLines = poId => G.db.where('purchase_order_lines', l => l.po_id === poId);
  const lineSub = l => R((l.price_basis === 'KG' ? (Number(l.est_weight_kg) || Number(l.qty)) : Number(l.qty)) * Number(l.unit_price));
  function poNoIgv(supplierId, date) { const s = sup(supplierId); return !!(s && s.supplier_type === 'RELATED_FARM' && G.grj && G.grj.expectedDocType ? G.grj.expectedDocType(supplierId, date || G.TODAY) === 'NTI' : s && s.supplier_type === 'RELATED_FARM'); }
  function poTotals(lines, supplierId, date) { const sub = R(U.sum(lines, lineSub)); const igv = poNoIgv(supplierId, date) ? 0 : R(sub * igvRate()); return { subtotal: sub, igv, total: R(sub + igv) }; }
  function createPO(d, opts = {}) {
    if (!opts.system) perm('com.order.create', 'crear órdenes de compra');
    const s = sup(d.supplier_id); assertSupplierCanOrder(s);
    const date = d.order_date || G.TODAY;
    if (!G._seeding) G.period.assertOpen(date);
    const wh = G.db.get('warehouses', d.warehouse_id); if (!wh) throw new Error('Elige el almacén de destino.');
    const lines = (d.lines || []).filter(l => l.variant_id && Number(l.qty) > 0);
    if (!lines.length) throw new Error('Agrega al menos una línea con producto y cantidad.');
    for (const l of lines) { if (!(Number(l.unit_price) >= 0) || l.unit_price === '' || l.unit_price == null) throw new Error(`Indica el precio de ${G.variantName(l.variant_id)}.`); }
    if (d.expected_date && d.expected_date < date) throw new Error('La fecha esperada no puede ser anterior a la fecha de la OC.');
    const ls = lines.map(l => ({ variant_id: l.variant_id, qty: R(Number(l.qty), 3), price_basis: l.price_basis || basisOf(l.variant_id), est_weight_kg: (l.price_basis || basisOf(l.variant_id)) === 'KG' ? R(Number(l.est_weight_kg) || Number(l.qty), 3) : (l.est_weight_kg ? Number(l.est_weight_kg) : null), unit_price: R(Number(l.unit_price), 6), igv_affectation: '10' }));
    const t = poTotals(ls, s.id, date);
    const n = G.series.next('OC01');
    const user = opts.user || uid();
    const po = G.db.insert('purchase_orders', { id: opts.id, number: n.full, company_id: 'co-dg', establishment_id: d.establishment_id || wh.establishment_id, supplier_id: s.id, warehouse_id: wh.id, brand_id: d.brand_id || null, order_date: date, expected_date: d.expected_date || G.date.add(date, 2), currency: 'PEN', subtotal: t.subtotal, igv: t.igv, total: t.total, status: 'DRAFT', approved_by: null, approved_at: null, void_reason: null, notes: d.notes || null, created_by: user, created_at: opts.at || (date + 'T' + (G._seeding ? '09:00' : G.date.now().slice(11, 16))), no_igv: t.igv === 0, history: [{ at: opts.at || G.date.now(), user: G.userName(user), action: 'Creada' }] }, { silent: !!opts.silent });
    for (const l of ls) G.db.insert('purchase_order_lines', Object.assign({ po_id: po.id, subtotal: lineSub(l), received_qty: 0, received_weight_kg: 0 }, l), { silent: true });
    return po;
  }
  function addHist(po, action, user, at) { G.db.update('purchase_orders', po.id, { history: (po.history || []).concat([{ at: at || G.date.now(), user: G.userName(user || uid()), action }]) }, { silent: true }); }
  /** envía la OC: por debajo del umbral se aprueba sola (RN-COM-01) */
  function submitPO(id, opts = {}) {
    const po = G.db.get('purchase_orders', id); if (!po) throw new Error('OC no encontrada.');
    if (po.status !== 'DRAFT') throw new Error(`La OC ${po.number} no está en borrador.`);
    assertSupplierCanOrder(sup(po.supplier_id));
    const thr = Number(G.param('com_po_approval_threshold_pen'));
    if (po.total <= thr) {
      G.db.update('purchase_orders', id, { status: 'APPROVED', approved_by: null, auto_approved: true, approved_at: opts.at || G.date.now(), submitted_at: opts.at || G.date.now() }, { silent: !!opts.silent });
      addHist(po, `Enviada y aprobada sola (total ${F.money(po.total)} ≤ umbral ${F.money(thr)})`, opts.user, opts.at);
    } else {
      G.db.update('purchase_orders', id, { status: 'PENDING_APPROVAL', submitted_at: opts.at || G.date.now() }, { silent: !!opts.silent });
      addHist(po, `Enviada a aprobación (total ${F.money(po.total)} > umbral ${F.money(thr)})`, opts.user, opts.at);
      if (!G._seeding) for (const r of ['GERENTE', 'ADMINISTRACION']) G.notify({ role: r, title: `OC ${po.number} por aprobar`, body: `${supName(po.supplier_id)} · ${F.money(po.total)}`, ref: po.id, module: MOD, tone: 'warn' });
    }
    return G.db.get('purchase_orders', id);
  }
  /** com_approve_order(oc, usuario) · RN-COM-01: aprueba alguien con com.order.approve distinto de quien la creó */
  function approvePO(id, user = uid(), opts = {}) {
    const po = G.db.get('purchase_orders', id); if (!po) throw new Error('OC no encontrada.');
    if (po.status !== 'PENDING_APPROVAL') throw new Error(`La OC ${po.number} no está pendiente de aprobación.`);
    if (userIs(po.created_by, user)) G.fail('RN-COM-01', `Quien crea la OC no la aprueba: ${po.number} la creó ${G.userName(po.created_by)}. Debe aprobarla otra persona con el permiso com.order.approve.`);
    const u = G.db.get('users', user); const role = u ? u.role : G.ctx.role;
    if (!G.can('com.order.approve', role)) G.fail('RN-COM-01', `Aprobar una OC de ${F.money(po.total)} (sobre ${F.money(G.param('com_po_approval_threshold_pen'))}) exige com.order.approve: GERENTE o ADMINISTRACIÓN (D-COM-01).`);
    G.db.update('purchase_orders', id, { status: 'APPROVED', approved_by: user, approved_at: opts.at || G.date.now() }, { silent: !!opts.silent });
    addHist(po, 'Aprobada', user, opts.at);
    return G.db.get('purchase_orders', id);
  }
  function returnPO(id, reason) {
    const po = G.db.get('purchase_orders', id);
    if (!po || po.status !== 'PENDING_APPROVAL') throw new Error('Solo se devuelve una OC pendiente de aprobación.');
    if (!G.can('com.order.approve')) G.fail('RN-COM-01', 'Devolver una OC exige com.order.approve.');
    if (!String(reason || '').trim()) throw new Error('Indica el motivo de la devolución.');
    G.db.update('purchase_orders', id, { status: 'DRAFT', return_reason: reason });
    addHist(po, 'Devuelta a borrador: ' + reason);
  }
  function voidPO(id, reason) {
    const po = G.db.get('purchase_orders', id); if (!po) throw new Error('OC no encontrada.');
    if (G.db.find('purchase_receipts', r => r.po_id === id && r.status === 'POSTED')) throw new Error(`La OC ${po.number} ya tiene recepciones: ciérrala en lugar de anularla.`);
    if (!String(reason || '').trim()) throw new Error('Indica el motivo de la anulación.');
    G.db.update('purchase_orders', id, { status: 'VOIDED', void_reason: reason });
    addHist(po, 'Anulada: ' + reason);
    G.db.where('purchase_requisitions', r => r.po_id === id).forEach(r => G.db.update('purchase_requisitions', r.id, { status: 'PENDING', po_id: null }, { silent: true }));
  }
  function closePO(id) { const po = G.db.get('purchase_orders', id); if (!po || po.status !== 'PARTIALLY_RECEIVED') throw new Error('Solo se cierra una OC recibida parcialmente.'); G.db.update('purchase_orders', id, { status: 'CLOSED', closed_at: G.date.now() }); addHist(po, 'Cerrada con saldo pendiente'); }
  const poOrdered = l => l.price_basis === 'KG' ? Number(l.est_weight_kg || l.qty) : Number(l.qty);
  const poReceived = l => l.price_basis === 'KG' ? Number(l.received_weight_kg || 0) : Number(l.received_qty || 0);
  const poPct = po => { const ls = poLines(po.id); const o = U.sum(ls, poOrdered); return o ? Math.min(100, U.sum(ls, poReceived) / o * 100) : 0; };

  /* ---------- recepción valorizada (RN-COM-02/03/04/10) ---------- */
  const tempMax = p => p.storage === 'FROZEN' ? tol('com_frozen_max_c') : p.storage === 'CHILLED' ? tol('com_chilled_max_c') : null;
  /** valida una línea de recepción y devuelve sus valores calculados (también lo usa la vista para el cálculo en vivo) */
  function evalReceiptLine(l, poLine) {
    const v = G.variant(l.variant_id || (poLine && poLine.variant_id)); if (!v) throw new Error('Elige el producto de la línea.');
    const p = G.db.get('products', v.product_id) || {};
    const basis = poLine ? poLine.price_basis : (l.price_basis || basisOf(v.id));
    const weight = l.weight_kg === '' || l.weight_kg == null ? null : Number(l.weight_kg);
    let qty = Number(l.qty) || 0;
    if (v.sale_mode === 'KG') qty = weight || qty;
    if (v.sale_mode === 'UNIT_VARIABLE_WEIGHT' && !qty && weight) qty = Math.max(1, Math.round(weight / (v.nominal_weight_kg || 1)));
    const decision = l.decision || 'ACCEPT';
    const out = { v, p, basis, qty: R(qty, 3), weight: weight != null ? R(weight, 3) : null, decision, temp: l.temp_c === '' || l.temp_c == null ? null : Number(l.temp_c), max: tempMax(p), problems: [] };
    if (decision !== 'REJECT') {
      if (basis === 'KG' && !(weight > 0)) G.fail('RN-COM-03', `${v.name} se compra por kg: registra el peso recibido (mayor que 0).`);
      if (!(out.qty > 0)) throw new Error(`Indica la cantidad recibida de ${v.name}.`);
    }
    if (out.max != null) {
      if (out.temp == null) G.fail('RN-COM-02', `${v.name} es ${p.storage === 'FROZEN' ? 'congelado' : 'refrigerado'}: registra su temperatura al recibirlo.`);
      if (out.temp > out.max + 1e-9 && decision === 'ACCEPT') G.fail('RN-COM-02', `${v.name} llegó a ${F.num(out.temp, 1)} °C y el máximo es ${F.num(out.max, 1)} °C: rechaza la línea o envíala a decisión de calidad.`);
    }
    const price = poLine ? Number(poLine.unit_price) : Number(l.unit_price);
    if (!(price >= 0) || isNaN(price)) throw new Error(`Indica el costo de ${v.name} (precio sin IGV).`);
    out.unit_price = price;
    out.total_cost = decision === 'REJECT' ? 0 : R((basis === 'KG' ? out.weight : out.qty) * price);
    if (poLine && decision !== 'REJECT') {
      const ordered = poOrdered(poLine), already = poReceived(poLine);
      const now = basis === 'KG' ? out.weight : out.qty;
      const overPct = ordered ? ((already + now) - ordered) / ordered * 100 : 0;
      out.over_pct = R(overPct, 2);
      if (overPct > tol('com_over_receipt_tolerance_pct') + 1e-9) {
        if (!String(l.over_receipt_reason || '').trim()) G.fail('RN-COM-04', `${v.name}: se recibe ${F.pct(overPct, 1)} más que lo pedido (tolerancia ${F.pct(tol('com_over_receipt_tolerance_pct'), 0)}): indica el motivo y que lo apruebe GERENTE o ADMINISTRACIÓN.`);
        if (!G.can('com.order.approve')) G.fail('RN-COM-04', `El exceso de ${F.pct(overPct, 1)} en ${v.name} exige la aprobación de alguien con com.order.approve.`);
      }
    }
    return out;
  }
  function newLotCode(date, prefix = 'C') { const k = 'LOTCOM'; const n = G.db.next(k, '', 3); let code = `${prefix}${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}-${n}`; while (G.db.find('lots', l => l.code === code)) code += 'X'; return code; }
  /**
   * Registra una recepción (contra OC o sin ella). Cada línea aceptada crea un lote (RN-COM-10) y mueve stock con G.inv.move RECEIPT.
   * d: {po_id, supplier_id, establishment_id, warehouse_id, received_at, vehicle_temp_c, carrier_guide, scale, inspection:'OK'|'PENDING', receipt_type, lines:[…]}
   * opts: {system, user, historical (sin kardex: carga histórica), id}
   */
  function postReceipt(d, opts = {}) {
    if (!opts.system) perm('com.receipt.record', 'registrar recepciones');
    const po = d.po_id ? G.db.get('purchase_orders', d.po_id) : null;
    if (po && !['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) throw new Error(`La OC ${po.number} está «${LBL[po.status][0]}»: solo se recibe una OC aprobada.`);
    const supplierId = po ? po.supplier_id : d.supplier_id; const s = sup(supplierId); if (!s) throw new Error('Elige el proveedor.');
    const whId = d.warehouse_id || (po && po.warehouse_id); const wh = G.db.get('warehouses', whId); if (!wh) throw new Error('Elige el almacén de destino.');
    const at = d.received_at || G.date.now(); const date = dateOnly(at);
    if (!G._seeding) G.period.assertOpen(date);
    const lines = (d.lines || []).filter(l => l && (l.po_line_id || l.variant_id) && (Number(l.qty) > 0 || Number(l.weight_kg) > 0 || l.decision === 'REJECT'));
    if (!lines.length) throw new Error('Registra al menos una línea con cantidad o peso.');
    const evals = lines.map(l => { const pl = l.po_line_id ? G.db.get('purchase_order_lines', l.po_line_id) : null; return { l, pl, e: evalReceiptLine(l, pl) }; });
    for (const x of evals) if (x.e.decision === 'REJECT' && !String(x.l.rejection_reason || '').trim()) x.l.rejection_reason = x.e.temp != null && x.e.max != null && x.e.temp > x.e.max ? `Temperatura ${F.num(x.e.temp, 1)} °C fuera de rango (máx. ${F.num(x.e.max, 1)} °C)` : 'Rechazada en la recepción';
    const id = opts.id || U.uid('prc');
    const number = G.db.next('RC', 'RC-', 5);
    const user = opts.user || uid();
    const inspectionPending = d.inspection === 'PENDING';
    const rlines = [];
    for (const { l, pl, e } of evals) {
      let lot = null, mv = null;
      const accepted = e.decision !== 'REJECT';
      const hold = e.decision === 'QUALITY_HOLD';
      if (accepted && e.p.requires_lot) {
        const exp = l.expiry_date || G.date.add(date, e.p.shelf_life_days || 7);
        lot = G.db.insert('lots', { id: l.lot_id_hint || undefined, product_id: e.p.id, variant_id: e.v.id, code: l.lot_code || newLotCode(date, d.receipt_type && d.receipt_type.startsWith('FARM') ? 'G' : 'C'), origin: d.receipt_type && d.receipt_type.startsWith('FARM') ? 'FARM' : 'PURCHASE', supplier_id: s.id, production_date: l.production_date || date, expiry_date: exp, qc_status: hold || inspectionPending ? 'QUARANTINE' : 'RELEASED', unit_cost: R(e.unit_price, 6), cost_basis: e.basis, received_weight_kg: e.weight, supplier_lot_code: l.supplier_lot_code || null, farm_lot_code: l.farm_lot_code || null, farm_origin: l.farm_origin || null, released_at: hold || inspectionPending ? null : at, released_by: hold || inspectionPending ? null : (d.inspection === 'OK' ? 'Inspección de recepción' : null), notes: hold ? `Decisión de calidad pendiente: ${e.temp != null ? F.num(e.temp, 1) + ' °C' : 'observación en recepción'}` : inspectionPending ? 'Pendiente de inspección de recepción (CAL-03)' : null, receipt_id: id }, { silent: true });
      }
      if (accepted && !opts.historical) {
        const dest = (hold || (inspectionPending && wh.establishment_id === 'es-L1')) && wh.establishment_id === 'es-L1' ? 'wh-CUA-L1' : wh.id;
        const r = G.inv.move({ type: 'RECEIPT', wh: dest, variant: e.v.id, lot: lot ? lot.id : null, qty: e.qty, weight: e.v.sale_mode === 'UNIT' ? null : e.weight, unitCost: e.qty ? e.total_cost / e.qty : 0, source: { type: d.receipt_type && d.receipt_type.startsWith('FARM') ? 'FARM_RECEIPT' : 'PURCHASE_RECEIPT', id }, at, reason: `Recepción ${number} · ${s.trade_name || s.legal_name}`, allowUnreleased: true });
        mv = r.moves[0];
      }
      const rl = G.db.insert('purchase_receipt_lines', { receipt_id: id, po_line_id: pl ? pl.id : null, variant_id: e.v.id, lot_id: lot ? lot.id : null, supplier_lot_code: l.supplier_lot_code || null, expiry_date: lot ? lot.expiry_date : null, qty: e.qty || 0, weight_kg: e.weight, temp_c: e.temp, unit_cost: R(e.unit_price, 6), price_basis: e.basis, total_cost: e.total_cost, accepted, quality_hold: hold, rejection_reason: accepted ? null : l.rejection_reason, over_receipt_reason: l.over_receipt_reason || null, over_pct: e.over_pct || 0, stock_movement_id: mv ? mv.id : null }, { silent: true });
      rlines.push(rl);
      if (pl && accepted) G.db.update('purchase_order_lines', pl.id, { received_qty: R((pl.received_qty || 0) + e.qty, 3), received_weight_kg: R((pl.received_weight_kg || 0) + (e.weight || 0), 3) }, { silent: true });
    }
    const rc = G.db.insert('purchase_receipts', { id, number, company_id: 'co-dg', establishment_id: d.establishment_id || wh.establishment_id, warehouse_id: wh.id, supplier_id: s.id, po_id: po ? po.id : null, receipt_type: d.receipt_type || 'PURCHASE', received_at: at, received_by: user, vehicle_temp_c: d.vehicle_temp_c === '' || d.vehicle_temp_c == null ? null : Number(d.vehicle_temp_c), carrier_guide: d.carrier_guide || null, scale_equipment_id: d.scale || null, inspection_id: null, inspection_result: d.inspection || 'OK', status: 'POSTED', void_reason: null, historical: !!opts.historical, total_cost: R(U.sum(rlines, x => x.total_cost)), document_id: null, farm_dispatch_id: d.farm_dispatch_id || null, notes: d.notes || null }, { silent: !!opts.silent });
    if (po) {
      const ls = poLines(po.id);
      const done = ls.every(x => poReceived(x) >= poOrdered(x) * 0.98 - 1e-9);
      G.db.update('purchase_orders', po.id, { status: done ? 'RECEIVED' : 'PARTIALLY_RECEIVED', last_receipt_at: at, received_complete_at: done ? at : null }, { silent: true });
      addHist(po, `Recepción ${number}${done ? ' (completa)' : ' (parcial)'}`, user, at);
    }
    if (!G._seeding) G.events.emit('purchase_receipt.posted', { receipt_id: rc.id, number, supplier_id: s.id, po_id: po ? po.id : null, lots: rlines.map(x => x.lot_id).filter(Boolean) });
    return rc;
  }
  const rcLines = id => G.db.where('purchase_receipt_lines', l => l.receipt_id === id);

  /* ---------- comprobantes del proveedor (RN-COM-05/06/07/09/12/15) ---------- */
  const pdLines = id => G.db.where('purchase_document_lines', l => l.document_id === id);
  function findDuplicate(supplierId, docType, series, number, excludeId) {
    return G.db.find('purchase_documents', d => d.id !== excludeId && d.status !== 'VOIDED' && d.company_id === 'co-dg' && d.supplier_id === supplierId && d.doc_type === docType && normSer(d.series) === normSer(series) && normNum(d.number) === normNum(number));
  }
  /** com_three_way_match(comprobante): OC ↔ recepción ↔ comprobante (RN-COM-07) */
  function threeWayMatch(docId) {
    const d = G.db.get('purchase_documents', docId); if (!d) return null;
    const tolP = tol('com_price_tolerance_pct');
    const rows = [];
    for (const l of pdLines(docId)) {
      const rl = l.receipt_line_id ? G.db.get('purchase_receipt_lines', l.receipt_line_id) : null;
      if (!rl) continue;
      const pl = rl.po_line_id ? G.db.get('purchase_order_lines', rl.po_line_id) : null;
      const basis = rl.price_basis || basisOf(rl.variant_id);
      const recQ = basis === 'KG' ? Number(rl.weight_kg || 0) : Number(rl.qty || 0);
      const ref = pl ? Number(pl.unit_price) : Number(rl.unit_cost);
      const priceDiff = ref ? (Number(l.unit_price) - ref) / ref * 100 : 0;
      const qtyDiff = R(Number(l.qty) - recQ, 3);
      const priceOk = Math.abs(priceDiff) <= tolP + 1e-9, qtyOk = Math.abs(qtyDiff) < 0.0005;
      rows.push({ line_id: l.id, description: l.description, variant_id: l.variant_id, basis, po_number: pl ? (G.db.get('purchase_orders', pl.po_id) || {}).number : null, po_price: pl ? Number(pl.unit_price) : null, rc_price: Number(rl.unit_cost), inv_price: Number(l.unit_price), price_diff_pct: R(priceDiff, 2), po_qty: pl ? poOrdered(pl) : null, rec_qty: recQ, inv_qty: Number(l.qty), qty_diff: qtyDiff, price_ok: priceOk, qty_ok: qtyOk, ok: priceOk && qtyOk });
    }
    return { status: !rows.length ? 'NOT_CHECKED' : rows.every(r => r.ok) ? 'MATCHED' : 'OBSERVED', rows, tolerance_pct: tolP };
  }
  function toInbox(o) {
    if (G.cnt && G.cnt.toInbox) return G.cnt.toInbox(o);
    const ex = G.db.find('accountant_inbox_items', x => x.source_type === o.source_type && x.source_id === o.source_id && x.reason === o.reason && ['PENDING', 'CLASSIFIED', 'RETURNED'].includes(x.status));
    if (ex) return ex;
    return G.db.insert('accountant_inbox_items', { company_id: 'co-dg', period: G.date.month(o.date || G.TODAY), source_type: o.source_type, source_id: o.source_id, reason: o.reason, status: 'PENDING', assigned_to: null, classification: null, notes: o.notes || null, ref_label: o.ref_label || null, amount: o.amount || null, created_at: o.at || G.date.now() }, { silent: true });
  }
  /**
   * Registra el comprobante del proveedor.
   * d: {supplier_id, doc_type, series, number, issue_date, accounting_date, due_date, currency, exchange_rate, base_taxed, igv, non_taxed, other_charges, total,
   *     igv_is_credit, po_id, receipt_id, brand_id, cost_center_id, establishment_id, lines:[{variant_id, description, qty, unit_price, receipt_line_id, cost_center_id}], file_pdf_url, file_xml_url}
   */
  function registerDocument(d, opts = {}) {
    if (!opts.system) perm('com.document.record', 'registrar comprobantes del proveedor');
    const s = sup(d.supplier_id); if (!s) throw new Error('Elige el proveedor.');
    const type = d.doc_type || 'INVOICE';
    const series = normSer(d.series), number = normNum(d.number);
    if (!series || !number) throw new Error('Indica la serie y el número del comprobante.');
    const dup = findDuplicate(s.id, type, series, number);
    if (dup) G.fail('RN-COM-05', `${pdocName(type)} ${series}-${number} de ${s.trade_name || s.legal_name} ya está registrada (${F.date(dup.issue_date)}, ${moneyDoc(dup, dup.total)}). Un comprobante es único por empresa, proveedor, tipo, serie y número.`);
    const issue = d.issue_date || G.TODAY; const acc = d.accounting_date || issue;
    if (G.period.isClosed(acc)) G.fail('RN-COM-09', `El período ${G.date.monthName(acc)} está cerrado: registra el comprobante con fecha contable en un período abierto.`);
    const currency = d.currency || 'PEN';
    const fx = currency === 'PEN' ? 1 : Number(d.exchange_rate);
    if (!(fx > 0)) throw new Error('El comprobante en moneda extranjera necesita el tipo de cambio de su fecha (RN-CNT-19).');
    const lines = (d.lines || []).filter(l => l && (l.description || l.variant_id) && Number(l.qty) > 0);
    const nti = type === 'INTERNAL_TRANSFER';
    const hasIgv = IGV_TYPES.includes(type);
    let base = d.base_taxed, igv = d.igv, nt = Number(d.non_taxed) || 0, oc = Number(d.other_charges) || 0, total = d.total;
    if (lines.length && (base === undefined || base === null || base === '')) {
      const sub = R(U.sum(lines, l => Number(l.qty) * Number(l.unit_price)));
      if (hasIgv) { base = sub; igv = R(sub * igvRate()); } else { base = 0; igv = 0; nt = R(nt + sub); }
      total = R(Number(base) + Number(igv) + nt + oc);
    }
    base = R(Number(base) || 0); igv = R(Number(igv) || 0);
    if (total === undefined || total === null || total === '') total = R(base + igv + nt + oc);
    total = R(Number(total));
    if (nti && igv !== 0) G.fail('RN-COM-12', `Una NTI de la granja no lleva IGV: el IGV debe ser 0,00 (llegó ${F.money(igv)}).`);
    if (Math.abs(R(base + igv + nt + oc) - total) > 0.011) G.fail('RN-COM-06', `El total ${F.money(total)} no cuadra: base ${F.money(base)} + IGV ${F.money(igv)} + no gravado ${F.money(nt)} + otros ${F.money(oc)} = ${F.money(R(base + igv + nt + oc))}.`);
    if (!(total > 0)) throw new Error('El total del comprobante debe ser mayor que cero.');
    const credit = d.igv_is_credit !== undefined ? !!d.igv_is_credit && CREDIT_TYPES.includes(type) : CREDIT_TYPES.includes(type);
    const rc = d.receipt_id ? G.db.get('purchase_receipts', d.receipt_id) : null;
    const po = d.po_id ? G.db.get('purchase_orders', d.po_id) : (rc && rc.po_id ? G.db.get('purchase_orders', rc.po_id) : null);
    const terms = s.payment_terms_days || 0;
    const id = opts.id || U.uid('pdc');
    const doc = G.db.insert('purchase_documents', {
      id, company_id: 'co-dg', supplier_id: s.id, establishment_id: d.establishment_id || (rc && rc.establishment_id) || (po && po.establishment_id) || 'es-L1', brand_id: d.brand_id || (po && po.brand_id) || null,
      cost_center_id: d.cost_center_id || s.default_cost_center_id || null, doc_type: type, sunat_doc_type: sunatType(type), series, number, issue_date: issue, due_date: d.due_date || (nti ? null : G.date.add(issue, terms)), accounting_date: acc,
      currency, exchange_rate: fx, base_taxed: base, igv, non_taxed: nt, other_charges: oc, total, igv_is_credit: credit, po_id: po ? po.id : null, receipt_id: rc ? rc.id : null, related_document_id: d.related_document_id || null,
      file_pdf_url: d.file_pdf_url || `comprobantes/${s.doc_number}-${sunatType(type)}-${series}-${number}.pdf`, file_xml_url: nti ? null : (d.file_xml_url || `comprobantes/${s.doc_number}-${sunatType(type)}-${series}-${number}.xml`),
      match_status: 'NOT_CHECKED', status: 'REGISTERED', void_reason: null, paid_amount: 0, balance: nti ? 0 : total, registered_by: opts.user || uid(), registered_at: opts.at || G.date.now(), farm_dispatch_id: d.farm_dispatch_id || null, notes: d.notes || null, scheduled_pay_date: null, description: d.description || (lines.length ? lines.map(l => l.description || G.variantName(l.variant_id)).slice(0, 3).join(', ') : null),
    }, { silent: !!opts.silent });
    for (const l of lines) {
      const sub = R(Number(l.qty) * Number(l.unit_price));
      const li = hasIgv ? R(sub * igvRate()) : 0;
      G.db.insert('purchase_document_lines', { document_id: id, receipt_line_id: l.receipt_line_id || null, variant_id: l.variant_id || null, description: l.description || G.variantName(l.variant_id), qty: R(Number(l.qty), 3), unit_price: R(Number(l.unit_price), 6), subtotal: hasIgv ? sub : 0, igv: li, total: R(sub + li), non_taxed: hasIgv ? 0 : sub, cost_center_id: l.cost_center_id || doc.cost_center_id }, { silent: true });
    }
    if (rc) G.db.update('purchase_receipts', rc.id, { document_id: id }, { silent: true });
    const m = threeWayMatch(id);
    if (m.status === 'OBSERVED') {
      G.db.update('purchase_documents', id, { match_status: 'OBSERVED', status: 'OBSERVED', match_detail: m.rows }, { silent: true });
      const worst = m.rows.filter(r => !r.ok).map(r => !r.price_ok ? `${r.description}: precio ${F.money(r.inv_price)} vs OC ${F.money(r.po_price ?? r.rc_price)} (${r.price_diff_pct > 0 ? '+' : ''}${F.pct(r.price_diff_pct, 2)})` : `${r.description}: facturado ${F.num(r.inv_qty, 3)} vs recibido ${F.num(r.rec_qty, 3)}`).join(' · ');
      toInbox({ source_type: 'PURCHASE_DOCUMENT', source_id: id, reason: 'PO_MISMATCH', date: acc, notes: `RN-COM-07: ${worst}`, ref_label: `${supName(s.id)} · ${docLabel(doc)}`, amount: pen(doc, total), at: opts.at });
    } else {
      G.db.update('purchase_documents', id, { match_status: m.status, match_detail: m.rows }, { silent: true });
      applyCost(id, opts);
    }
    for (const l of lines) if (l.variant_id) updateCatalogPrice(s.id, l.variant_id, Number(l.unit_price), issue, nti ? 'NTI' : 'COMPROBANTE');
    if (!G._seeding) G.events.emit('purchase_document.registered', { document_id: id, supplier_id: s.id, doc_type: type, total, match_status: G.db.get('purchase_documents', id).match_status });
    return G.db.get('purchase_documents', id);
  }
  /** RN-COM-10 / RN-COM-15: la diferencia de costo ajusta el lote si queda stock; lo consumido va al costo de ventas */
  function applyCost(docId) {
    const d = G.db.get('purchase_documents', docId); const adj = [];
    for (const l of pdLines(docId)) {
      const rl = l.receipt_line_id ? G.db.get('purchase_receipt_lines', l.receipt_line_id) : null; if (!rl || !rl.accepted) continue;
      const unitInv = Number(l.unit_price) * fxOf(d) * (d.igv_is_credit || !IGV_TYPES.includes(d.doc_type) ? 1 : 1 + igvRate());
      const q = rl.price_basis === 'KG' ? Number(rl.weight_kg || 0) : Number(rl.qty || 0);
      const diff = R((unitInv - Number(rl.unit_cost)) * q);
      if (Math.abs(diff) < 0.005) continue;
      const lot = rl.lot_id ? G.db.get('lots', rl.lot_id) : null;
      const left = rl.lot_id ? U.sum(G.db.where('stock_balances', b => b.lot_id === rl.lot_id), b => b.qty) : 0;
      const share = rl.qty ? Math.max(0, Math.min(1, left / rl.qty)) : 0;
      const toStock = R(diff * share), toCogs = R(diff - toStock);
      if (lot && share > 0) G.db.update('lots', lot.id, { unit_cost: R(unitInv, 6), cost_adjusted_by: d.id }, { silent: true });
      adj.push({ receipt_line_id: rl.id, lot_id: rl.lot_id, diff, to_stock: toStock, to_cogs: toCogs });
    }
    G.db.update('purchase_documents', docId, { cost_adjustments: adj }, { silent: true });
    return adj;
  }
  /** aprueba la diferencia del cruce (bandeja de la contadora o COM-08) */
  function approveMatch(docId, note, user = uid()) {
    const d = G.db.get('purchase_documents', docId); if (!d) throw new Error('Comprobante no encontrado.');
    if (d.match_status !== 'OBSERVED') throw new Error('El comprobante no está observado.');
    if (!G.canDo('COM', 'A') && !G.can('cnt.entry.approve')) G.fail('RN-COM-07', `Aprobar la diferencia exige aprobar en COM (CONTADORA, ADMINISTRACIÓN o GERENTE); tu rol es ${G.roleName()}.`);
    if (!String(note || '').trim()) throw new Error('Indica el motivo por el que se acepta la diferencia.');
    G.db.update('purchase_documents', docId, { match_status: 'APPROVED_DIFF', status: 'APPROVED', match_note: note, match_approved_by: user, match_approved_at: G.date.now() });
    applyCost(docId);
    for (const it of G.db.where('accountant_inbox_items', x => x.source_id === docId && x.reason === 'PO_MISMATCH' && ['PENDING', 'CLASSIFIED', 'RETURNED'].includes(x.status))) G.db.update('accountant_inbox_items', it.id, { status: 'APPROVED', approved_by: user, approved_at: G.date.now(), notes: (it.notes || '') + ' · Aprobado: ' + note }, { silent: true });
    if (!G._seeding) G.events.emit('purchase_document.registered', { document_id: docId, supplier_id: d.supplier_id, doc_type: d.doc_type, total: d.total, match_status: 'APPROVED_DIFF', approved: true });
    return G.db.get('purchase_documents', docId);
  }
  /** RN-COM-14: un comprobante con pagos no se anula */
  function voidDocument(docId, reason) {
    const d = G.db.get('purchase_documents', docId); if (!d) throw new Error('Comprobante no encontrado.');
    if ((d.paid_amount || 0) > 0.004) G.fail('RN-COM-14', `${docLabel(d)} tiene pagos aplicados por ${F.money(d.paid_amount)}: no se anula; registra una nota de crédito del proveedor.`);
    if (!String(reason || '').trim()) throw new Error('Indica el motivo de la anulación.');
    if (G.period.isClosed(d.accounting_date)) G.fail('RN-COM-09', 'El período del comprobante está cerrado.');
    G.db.update('purchase_documents', docId, { status: 'VOIDED', void_reason: reason, balance: 0 });
  }

  /* ---------- pagos (RN-COM-08, RN-COM-13, detracciones D-COM-03) ---------- */
  const isOpenDoc = d => d.status !== 'VOIDED' && d.doc_type !== 'INTERNAL_TRANSFER' && (d.balance || 0) > 0.004;
  function detractionRates() { const r = G.param('com_detraction_rates'); return r && typeof r === 'object' ? r : {}; }
  function detractionFor(d) { const s = sup(d.supplier_id) || {}; const rate = Number(detractionRates()[s.supplier_type] || 0); if (!rate || pen(d, d.total) <= 700) return 0; return Math.round(pen(d, d.total) * rate / 100); }
  function registerPayment(d, opts = {}) {
    if (!opts.system) perm('com.payment.record', 'registrar pagos a proveedores');
    const s = sup(d.supplier_id); if (!s) throw new Error('Elige el proveedor.');
    const ca = G.db.get('cash_accounts', d.cash_account_id); if (!ca) throw new Error('Elige la cuenta o caja de pago.');
    const at = d.paid_at || G.date.now(); const date = dateOnly(at);
    if (!G._seeding) G.period.assertOpen(date);
    const allocs = (d.allocations || []).filter(a => a.document_id && Number(a.amount) > 0);
    if (!allocs.length) throw new Error('Aplica el pago a al menos un comprobante.');
    for (const a of allocs) {
      const doc = G.db.get('purchase_documents', a.document_id);
      if (!doc || doc.supplier_id !== s.id) throw new Error('El comprobante no es de este proveedor.');
      if (doc.status === 'VOIDED') throw new Error(`${docLabel(doc)} está anulado.`);
      const open = R(doc.total - (doc.paid_amount || 0));
      if (Number(a.amount) > open + 0.004) G.fail('RN-COM-08', `A ${docLabel(doc)} (total ${moneyDoc(doc, doc.total)}) ya se aplicaron ${moneyDoc(doc, doc.paid_amount || 0)}: el saldo es ${moneyDoc(doc, open)} y no se puede aplicar ${moneyDoc(doc, a.amount)}.`);
    }
    const method = d.method || 'TRANSFER';
    if (method === 'TRANSFER' && !d.detraction) {
      if (!s.bank_account) G.fail('RN-COM-13', `${s.trade_name} no tiene cuenta bancaria registrada: regístrala (la aprueba GERENTE) antes de transferir.`);
      const to = String(d.paid_to_account || s.bank_account).replace(/\s/g, '');
      if (to !== String(s.bank_account).replace(/\s/g, '')) G.fail('RN-COM-13', `La cuenta destino ${d.paid_to_account} no es la registrada de ${s.trade_name} (${s.bank_account}). Solo se paga a la cuenta registrada.`);
      if (s.pending_bank_change) G.fail('RN-COM-13', `${s.trade_name} tiene un cambio de cuenta pendiente de aprobación de GERENTE: apruébalo o recházalo antes de pagar.`);
    }
    const amount = R(U.sum(allocs, a => Number(a.amount)));
    const pay = G.db.insert('supplier_payments', { id: opts.id, number: G.db.next('PP', 'PP-', 5), company_id: 'co-dg', supplier_id: s.id, cash_account_id: ca.id, paid_at: at, amount, method, reference: d.reference || null, paid_to_account: d.detraction ? (d.paid_to_account || 'Banco de la Nación · cuenta de detracciones') : (method === 'TRANSFER' ? s.bank_account : null), status: 'CONFIRMED', is_detraction: !!d.detraction, registered_by: opts.user || uid(), currency: 'PEN' }, { silent: !!opts.silent });
    for (const a of allocs) {
      G.db.insert('supplier_payment_allocations', { payment_id: pay.id, document_id: a.document_id, amount: R(Number(a.amount)) }, { silent: true });
      const doc = G.db.get('purchase_documents', a.document_id);
      const paid = R((doc.paid_amount || 0) + Number(a.amount));
      G.db.update('purchase_documents', doc.id, { paid_amount: paid, balance: R(doc.total - paid), last_paid_at: at }, { silent: true });
    }
    if (!G._seeding) G.events.emit('supplier_payment.registered', { payment_id: pay.id, supplier_id: s.id, amount, cash_account_id: ca.id });
    return pay;
  }
  /** pago con detracción: un pago a la cuenta de detracciones y otro neto al proveedor */
  function payWithDetraction(d, opts) {
    const doc = G.db.get('purchase_documents', d.allocations[0].document_id);
    const det = detractionFor(doc);
    if (!det) return [registerPayment(d, opts)];
    const amt = Number(d.allocations[0].amount);
    const p1 = registerPayment(Object.assign({}, d, { method: 'OTHER', detraction: true, reference: d.detraction_ref || 'Constancia de depósito', allocations: [{ document_id: doc.id, amount: Math.min(det, amt) }] }), opts);
    const rest = R(amt - Math.min(det, amt));
    const p2 = rest > 0 ? registerPayment(Object.assign({}, d, { allocations: [{ document_id: doc.id, amount: rest }] }), opts) : null;
    return [p1, p2].filter(Boolean);
  }
  function reversePayment(id, reason) {
    const p = G.db.get('supplier_payments', id); if (!p || p.status !== 'CONFIRMED') throw new Error('Pago no encontrado o ya revertido.');
    perm('com.payment.record', 'revertir pagos');
    if (!String(reason || '').trim()) throw new Error('Indica el motivo.');
    G.period.assertOpen(G.TODAY);
    G.db.update('supplier_payments', id, { status: 'REVERSED', reverse_reason: reason, reversed_at: G.date.now() });
    for (const a of G.db.where('supplier_payment_allocations', x => x.payment_id === id)) { const doc = G.db.get('purchase_documents', a.document_id); if (doc) { const paid = R((doc.paid_amount || 0) - a.amount); G.db.update('purchase_documents', doc.id, { paid_amount: paid, balance: R(doc.total - paid) }, { silent: true }); } }
  }
  /** v_accounts_payable: comprobantes con saldo */
  function payables(asOf = G.TODAY) {
    return G.db.where('purchase_documents', isOpenDoc).map(d => { const days = d.due_date ? G.date.diff(asOf, d.due_date) : 0; return Object.assign({}, d, { overdue_days: days, bucket: !d.due_date || days <= 0 ? 'NOT_DUE' : days <= 30 ? 'D0_30' : days <= 60 ? 'D31_60' : 'D60' }); });
  }
  const BUCKETS = [['NOT_DUE', 'Por vencer'], ['D0_30', 'Vencido 0–30 días'], ['D31_60', 'Vencido 31–60 días'], ['D60', 'Vencido más de 60 días']];
  function schedulePayment(docId, date) { const d = G.db.get('purchase_documents', docId); if (!d) return; if (date && date < G.TODAY) throw new Error('La fecha programada no puede ser pasada.'); G.db.update('purchase_documents', docId, { scheduled_pay_date: date || null }); }

  /* ---------- evaluación de proveedores (COM-11) ---------- */
  function evaluation(month) {
    const from = G.date.month(month || G.TODAY), to = G.date.add(G.date.addMonths(from, 1), -1);
    const rcs = G.db.where('purchase_receipts', r => r.status === 'POSTED' && dateOnly(r.received_at) >= from && dateOnly(r.received_at) <= to);
    const bySup = U.groupBy(rcs, 'supplier_id');
    const lineMap = U.groupBy(G.db.all('purchase_receipt_lines'), 'receipt_id');
    const docs = G.db.where('purchase_documents', d => d.status !== 'VOIDED' && d.issue_date >= from && d.issue_date <= to);
    const docsBy = U.groupBy(docs, 'supplier_id');
    const out = [];
    for (const [sid, rs] of Object.entries(bySup)) {
      const withPo = rs.filter(r => r.po_id);
      const onTime = withPo.filter(r => { const po = G.db.get('purchase_orders', r.po_id); return po && dateOnly(r.received_at) <= po.expected_date; }).length;
      const ls = rs.flatMap(r => lineMap[r.id] || []);
      const obs = ls.filter(l => !l.accepted || l.quality_hold).length;
      const wd = ls.filter(l => l.po_line_id && l.price_basis === 'KG').map(l => { const pl = G.db.get('purchase_order_lines', l.po_line_id); const o = pl ? poOrdered(pl) : 0; return o ? Math.abs((l.weight_kg || 0) - o) / o * 100 : 0; });
      const ds = docsBy[sid] || [];
      const priceObs = ds.filter(d => ['OBSERVED', 'APPROVED_DIFF'].includes(d.match_status)).length;
      const punct = withPo.length ? onTime / withPo.length * 100 : null;
      const obsPct = ls.length ? obs / ls.length * 100 : 0;
      const wPct = wd.length ? U.sum(wd) / wd.length : 0;
      const pPct = ds.length ? priceObs / ds.length * 100 : 0;
      const score = R(((punct ?? 100) / 100 * 2 + (1 - Math.min(obsPct, 50) / 50) * 1.2 + (1 - Math.min(wPct, 10) / 10) * 0.9 + (1 - Math.min(pPct, 50) / 50) * 0.9), 2);
      out.push({ supplier_id: sid, receipts: rs.length, with_po: withPo.length, punctuality: punct, lines: ls.length, observed: obs, observed_pct: obsPct, weight_diff_pct: wPct, docs: ds.length, price_obs: priceObs, price_obs_pct: pPct, score, rating: Math.max(1, Math.min(5, Math.round(score))) });
    }
    return out.sort(U.by('score', -1));
  }

  /* ---------- indicadores KPI-COM-01..06 ---------- */
  const inRange = (s, p) => { const d = dateOnly(s); return d >= (p.from || '0000') && d <= (p.to || '9999'); };
  function recLinesIn(p) { const rs = new Map(G.db.where('purchase_receipts', r => r.status === 'POSTED' && inRange(r.received_at, p) && (!p.site || r.establishment_id === p.site)).map(r => [r.id, r])); return G.db.where('purchase_receipt_lines', l => rs.has(l.receipt_id)).map(l => Object.assign({ rc: rs.get(l.receipt_id) }, l)); }
  G.kpiCalc['KPI-COM-01'] = p => { const ls = recLinesIn(p).filter(l => l.accepted && l.weight_kg > 0); const kg = U.sum(ls, l => l.weight_kg); return { value: kg ? R(U.sum(ls, l => l.total_cost) / kg) : 0, numerator: R(U.sum(ls, l => l.total_cost)), denominator: R(kg, 3) }; };
  G.kpiCalc['KPI-COM-02'] = p => { const ls = recLinesIn(p); const o = ls.filter(l => !l.accepted || l.quality_hold).length; return { value: ls.length ? R(o / ls.length * 100, 1) : 0, numerator: o, denominator: ls.length }; };
  G.kpiCalc['KPI-COM-03'] = p => { const pos = G.db.where('purchase_orders', o => o.last_receipt_at && inRange(o.last_receipt_at, p) && (!p.site || o.establishment_id === p.site)); const ok = pos.filter(o => o.received_complete_at && dateOnly(o.received_complete_at) <= o.expected_date).length; return { value: pos.length ? R(ok / pos.length * 100, 1) : 0, numerator: ok, denominator: pos.length }; };
  G.kpiCalc['KPI-COM-04'] = p => { const pays = new Map(G.db.where('supplier_payments', x => x.status === 'CONFIRMED' && inRange(x.paid_at, p)).map(x => [x.id, x])); let num = 0, den = 0; for (const a of G.db.where('supplier_payment_allocations', a => pays.has(a.payment_id))) { const d = G.db.get('purchase_documents', a.document_id); if (!d) continue; num += G.date.diff(dateOnly(pays.get(a.payment_id).paid_at), d.issue_date) * a.amount; den += a.amount; } return { value: den ? R(num / den, 1) : 0, numerator: R(num), denominator: R(den) }; };
  G.kpiCalc['KPI-COM-05'] = p => { const docs = new Map(G.db.where('purchase_documents', d => d.status !== 'VOIDED' && inRange(d.accounting_date, p)).map(d => [d.id, d])); let farm = 0, all = 0; for (const l of G.db.where('purchase_document_lines', l => docs.has(l.document_id) && l.variant_id && isMeat(l.variant_id))) { const d = docs.get(l.document_id); const v = pen(d, l.subtotal || l.non_taxed || 0); all += v; if ((sup(d.supplier_id) || {}).supplier_type === 'RELATED_FARM') farm += v; } return { value: all ? R(farm / all * 100, 1) : 0, numerator: R(farm), denominator: R(all) }; };
  G.kpiCalc['KPI-COM-06'] = p => { const asOf = p.to || G.TODAY; const ds = G.db.where('purchase_documents', d => isOpenDoc(d) && d.due_date && d.due_date < asOf); return { value: R(U.sum(ds, d => pen(d, d.balance))), numerator: ds.length, denominator: null }; };

  /* ---------- interfaz: piezas comunes ---------- */
  const supOpts = (pred = () => true) => G.db.where('suppliers', s => pred(s)).sort(U.by('trade_name')).map(s => [s.id, `${s.trade_name || s.legal_name} · ${supTypeName(s.supplier_type)}`]);
  const whOpts = () => G.db.where('warehouses', w => w.status === 'ACTIVE').map(w => [w.id, w.name]);
  const varOpts = (pred = () => true) => G.db.where('product_variants', v => v.status === 'ACTIVE' && pred(v)).sort(U.by('name')).map(v => [v.id, `${v.name} (${v.sku})`]);
  const bankOpts = () => G.db.where('cash_accounts', c => ['BANK', 'PETTY_CASH', 'CASH_REGISTER'].includes(c.account_type) && c.status === 'ACTIVE').map(c => [c.id, c.name]);
  const sel = (options, value, onChange, attrs = {}) => { const s = h('select', Object.assign({ class: 'input', on: { change: e => onChange(e.target.value) } }, attrs), options.map(([v, l]) => h('option', { value: v, selected: String(value ?? '') === String(v) }, l))); return s; };
  const inp = (value, onInput, attrs = {}) => h('input', Object.assign({ class: 'input', value: value ?? '', on: { input: e => onInput(e.target.value) } }, attrs));
  /** editor de líneas simple: cols [{key,label,type:'select'|'number'|'text'|'date', options(l), width, step, render(l)}] */
  function lineEditor(o) {
    const box = h('div', { class: 'stack' });
    const tw = h('div', { class: 'tbl-wrap' });
    const foot = h('div', { class: 'row between' });
    function draw() {
      G.ui.clear(tw);
      const t = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, o.cols.map(c => h('th', { class: c.align || '' }, c.label)), h('th'))));
      const tb = h('tbody');
      o.lines.forEach((l, i) => tb.appendChild(h('tr', null, o.cols.map(c => h('td', { class: c.align || '', style: c.width ? `min-width:${c.width}` : null }, c.render ? c.render(l, i) : c.type === 'select' ? sel([['', '—']].concat(typeof c.options === 'function' ? c.options(l) : c.options), l[c.key], v => { l[c.key] = v; if (c.onChange) c.onChange(l, v); o.onChange && o.onChange(); if (c.redraw) draw(); }) : inp(l[c.key], v => { l[c.key] = c.type === 'number' ? (v === '' ? '' : Number(v)) : v; o.onChange && o.onChange(); }, { type: c.type || 'text', step: c.step || 'any' }))), h('td', null, o.fixed ? null : btn('Quitar', () => { o.lines.splice(i, 1); draw(); o.onChange && o.onChange(); }, { sm: true, kind: 'ghost' })))));
      t.appendChild(tb); tw.appendChild(t);
    }
    draw();
    box.append(tw);
    if (!o.fixed) foot.append(btn('Agregar línea', () => { o.lines.push(o.blank()); draw(); o.onChange && o.onChange(); }, { sm: true, icon: '+' }));
    if (o.summary) foot.append(o.summary);
    box.append(foot);
    box.redraw = draw;
    return box;
  }
  function monthPills(key, cb) { const cur = (G.com._month = G.com._month || {})[key] || G.date.month(G.TODAY); return G.ui.pills([['2026-09-01', 'Setiembre 2026'], ['2026-10-01', 'Octubre 2026']], cur, v => { G.com._month[key] = v; cb ? cb(v) : G.refresh(); }); }
  const curMonth = key => ((G.com._month || {})[key]) || G.date.month(G.TODAY);
  const monthRange = m => ({ from: m, to: m === G.date.month(G.TODAY) ? G.TODAY : G.date.add(G.date.addMonths(m, 1), -1) });

  /* ---------- fichas (drawers) ---------- */
  function openSupplier(id) {
    const s = sup(id); if (!s) return;
    drawer(s.trade_name || s.legal_name, (b, close) => {
      const acts = h('div', { class: 'row' });
      if (G.canDo(MOD, 'E')) acts.append(btn('Editar', () => { close(); editSupplier(s); }, { sm: true, kind: 'primary' }));
      if (s.doc_type === 'RUC') acts.append(btn('Consultar RUC en SUNAT', () => tryDo(() => checkSunat(s.id), r => `SUNAT: ${r.sunat_msg}`) && (close(), openSupplier(id)), { sm: true }));
      acts.append(btn('Cambiar cuenta bancaria', () => bankChangeModal(s, () => { close(); openSupplier(id); }), { sm: true }));
      if (s.pending_bank_change && can('com.supplier.bank_change')) acts.append(btn('Aprobar nueva cuenta', () => tryDo(() => approveBankChange(s.id), 'Cuenta bancaria actualizada') && (close(), openSupplier(id)), { sm: true, kind: 'accent' }));
      if (G.canDo(MOD, 'C') && s.supplier_type !== 'RELATED_FARM') acts.append(btn('Nueva OC', () => { close(); poForm({ supplier_id: s.id }); }, { sm: true }));
      b.append(acts);
      if (['NOT_LOCATED', 'LOW', 'SUSPENDED'].includes(s.sunat_status)) b.append(notice(`RN-COM-11: ${s.sunat_msg || LBL[s.sunat_status][0]}. Este proveedor no recibe órdenes de compra.`, 'bad'));
      if (s.pending_bank_change) b.append(notice(`RN-COM-13: cambio de cuenta pendiente a ${s.pending_bank_change.account} (pidió ${G.userName(s.pending_bank_change.requested_by)} · ${s.pending_bank_change.reason || 'sin motivo'}). Hasta aprobarlo no se paga por transferencia.`, 'warn'));
      if (s.supplier_type === 'RELATED_FARM') b.append(notice(['Granja Don Guando comparte el RUC de la comercializadora: sus entregas llegan con NTI sin IGV (GRJ). ', G.screens['GRJ-01'] ? btn('Ver vínculo (GRJ-01)', () => { close(); G.go('GRJ-01'); }, { sm: true }) : null], 'info'));
      b.append(dl([[s.doc_type, h('span', { class: 'mono' }, s.doc_number)], ['Razón social', s.legal_name], ['Tipo', supTypeName(s.supplier_type)], ['Estado SUNAT', h('span', null, st(s.sunat_status), ' ', h('span', { class: 'muted small' }, s.sunat_checked_at ? 'consultado ' + F.datetime(s.sunat_checked_at) : ''))], ['Condición de pago', s.payment_terms_days ? `${s.payment_terms_days} días` : 'Contado'], ['Cuenta bancaria', s.bank_account ? `${s.bank_name || ''} ${s.bank_account}` : 'Sin cuenta registrada'], ['Centro de costo', G.ccName(s.default_cost_center_id)], ['Empresa relacionada', s.related_company_id ? (G.db.get('companies', s.related_company_id) || {}).legal_name : 'No'], ['Calificación', s.rating ? '★'.repeat(s.rating) + '☆'.repeat(5 - s.rating) : '—'], ['Teléfono', s.phone], ['Correo', s.email], ['Notas', s.notes]]));
      const docs = G.db.where('purchase_documents', d => d.supplier_id === s.id && d.status !== 'VOIDED').sort(U.by('issue_date', -1));
      const bal = U.sum(docs.filter(isOpenDoc), d => pen(d, d.balance));
      b.append(kpis([{ label: 'Saldo por pagar', value: F.money(bal) }, { label: 'Comprobantes', value: docs.length }, { label: 'Productos en catálogo', value: catalogOf(s.id).length }]));
      b.append(card('Comprobantes recientes', docs.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('tbody', null, docs.slice(0, 8).map(d => h('tr', { class: 'click', on: { click: () => { close(); openDoc(d.id); } } }, h('td', null, docLabel(d)), h('td', null, F.date(d.issue_date)), h('td', { class: 'r' }, moneyDoc(d, d.total)), h('td', null, st(d.status === 'REGISTERED' ? (d.balance > 0.004 ? (d.due_date && d.due_date < G.TODAY ? 'OVERDUE' : 'OPEN') : 'PAID') : d.status))))))) : empty('Sin comprobantes.'), { flush: true }));
    }, { code: 'COM-01', wide: true });
  }
  function bankChangeModal(s, after) {
    modal('Cuenta bancaria de ' + (s.trade_name || s.legal_name), (b, close) => {
      b.append(notice(can('com.supplier.bank_change') ? 'Como GERENTE el cambio se aplica de inmediato y queda en la auditoría (RN-COM-13).' : 'RN-COM-13: el cambio queda pendiente hasta que lo apruebe GERENTE; mientras tanto no se paga por transferencia.', 'info'));
      b.append(form({ id: 'bank', fields: [{ key: 'account', label: 'Nueva cuenta (o CCI)', required: true, span: 2 }, { key: 'reason', label: 'Motivo', type: 'textarea', required: true }], values: {}, submitLabel: can('com.supplier.bank_change') ? 'Cambiar cuenta' : 'Solicitar cambio', onCancel: close, onSubmit: v => { const r = requestBankChange(s.id, v.account, v.reason); toast(r.applied ? 'Cuenta bancaria cambiada' : 'Cambio enviado a GERENTE', 'ok'); close(); after && after(); G.refresh(); return true; } }));
    });
  }
  function editSupplier(s) {
    drawer(s ? 'Editar proveedor' : 'Nuevo proveedor', (b, close) => {
      b.append(form({ id: 'sup', values: s ? Object.assign({}, s) : { doc_type: 'RUC', supplier_type: 'PRODUCER', payment_terms_days: 15, status: 'ACTIVE' }, fields: [
        { key: 'doc_type', label: 'Documento', type: 'select', options: [['RUC', 'RUC'], ['DNI', 'DNI'], ['CE', 'Carné de extranjería'], ['FOREIGN', 'Extranjero']], required: true },
        { key: 'doc_number', label: 'Número', required: true, help: 'El RUC se valida con su dígito verificador y se consulta en la SUNAT (RN-COM-11).' },
        { key: 'legal_name', label: 'Razón social', required: true, span: 2 }, { key: 'trade_name', label: 'Nombre comercial' },
        { key: 'supplier_type', label: 'Tipo', type: 'select', options: SUP_TYPES, required: true }, { key: 'payment_terms_days', label: 'Días de crédito', type: 'number', min: 0 },
        { key: 'default_cost_center_id', label: 'Centro de costo por defecto', type: 'select', options: G.ui.opts('cost_centers', c => `${c.code} · ${c.name}`) },
        { key: 'bank_name', label: 'Banco' }, { key: 'bank_account', label: 'Cuenta bancaria', help: s ? 'Cambiarla exige aprobación de GERENTE (RN-COM-13).' : null },
        { key: 'phone', label: 'Teléfono' }, { key: 'email', label: 'Correo' }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']] }, { key: 'notes', label: 'Notas', type: 'textarea' }],
        submitLabel: s ? 'Guardar' : 'Crear proveedor', onCancel: close, onSubmit: v => { const r = saveSupplier(v, s); toast(s ? 'Proveedor actualizado' : `Proveedor creado · SUNAT: ${LBL[r.sunat_status][0]}`, 'ok'); close(); G.refresh(); return true; } }));
    }, { code: 'COM-01' });
  }
  function openPO(id) {
    const po = G.db.get('purchase_orders', id); if (!po) return;
    drawer('Orden de compra ' + po.number, (b, close) => {
      const re = () => { close(); openPO(id); };
      const acts = h('div', { class: 'row' });
      if (po.status === 'DRAFT' && G.canDo(MOD, 'C')) acts.append(btn('Enviar', () => tryDo(() => submitPO(po.id), r => r.status === 'APPROVED' ? 'OC aprobada sola (bajo el umbral)' : 'OC enviada a aprobación') && re(), { sm: true, kind: 'primary' }));
      if (po.status === 'PENDING_APPROVAL') {
        acts.append(btn('Aprobar', () => tryDo(() => approvePO(po.id), 'OC aprobada') && re(), { sm: true, kind: 'primary', disabled: !can('com.order.approve') || po.created_by === uid(), title: po.created_by === uid() ? 'RN-COM-01: quien crea no aprueba' : null }));
        acts.append(btn('Devolver', () => promptReason('Devolver a borrador', r => tryDo(() => returnPO(po.id, r), 'OC devuelta') && re()), { sm: true, disabled: !can('com.order.approve') }));
      }
      if (['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) && G.canDo(MOD, 'C')) acts.append(btn('Recibir', () => { close(); G.go('COM-06', { po_id: po.id }); }, { sm: true, kind: 'accent' }));
      if (po.status === 'PARTIALLY_RECEIVED') acts.append(btn('Cerrar con saldo', () => tryDo(() => closePO(po.id), 'OC cerrada') && re(), { sm: true }));
      if (['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(po.status)) acts.append(btn('Anular', () => promptReason('Anular OC', r => tryDo(() => voidPO(po.id, r), 'OC anulada') && re()), { sm: true, kind: 'danger' }));
      acts.append(btn('PDF', () => G.print(), { sm: true, kind: 'ghost' }));
      b.append(acts);
      if (po.status === 'PENDING_APPROVAL' && po.created_by === uid()) b.append(notice(`RN-COM-01: creaste esta OC; la aprueba otra persona con com.order.approve (D-COM-01: GERENTE o ADMINISTRACIÓN).`, 'warn'));
      b.append(dl([['Estado', st(po.status)], ['Proveedor', supName(po.supplier_id)], ['Local y almacén', `${G.siteName(po.establishment_id)} · ${G.whName(po.warehouse_id)}`], ['Fecha', F.date(po.order_date)], ['Esperada', F.date(po.expected_date)], ['Creada por', G.userName(po.created_by)], ['Aprobación', po.auto_approved ? 'Automática (bajo el umbral)' : po.approved_by ? `${G.userName(po.approved_by)} · ${F.datetime(po.approved_at)}` : '—'], ['IGV', po.no_igv ? 'Sin IGV (NTI de la granja, RN-COM-12)' : '18 %'], ['Notas', po.notes]]));
      const ls = poLines(po.id);
      b.append(card('Líneas', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Producto', 'Pedido', 'Precio s/IGV', 'Subtotal', 'Recibido'].map((x, i) => h('th', { class: i ? 'r' : '' }, x)))), h('tbody', null, ls.map(l => h('tr', null, h('td', null, G.variantName(l.variant_id)), h('td', { class: 'r' }, l.price_basis === 'KG' ? F.kg(poOrdered(l), 3) : F.num(l.qty) + ' u'), h('td', { class: 'r' }, F.money(l.unit_price) + (l.price_basis === 'KG' ? '/kg' : '/u')), h('td', { class: 'r' }, F.money(l.subtotal)), h('td', { class: 'r' }, l.price_basis === 'KG' ? F.kg(poReceived(l), 3) : F.num(poReceived(l)) + ' u')))), h('tfoot', null, h('tr', null, h('td', null, 'Subtotal / IGV / Total'), h('td'), h('td'), h('td', { class: 'r' }, `${F.money(po.subtotal)} / ${F.money(po.igv)}`), h('td', { class: 'r' }, h('b', null, F.money(po.total))))))), { flush: true }));
      const rcs = G.db.where('purchase_receipts', r => r.po_id === po.id);
      if (rcs.length) b.append(card('Recepciones', h('div', { class: 'stack' }, rcs.map(r => h('div', { class: 'row between' }, h('a', { class: 'linklike', href: '#', on: { click: e => { e.preventDefault(); close(); openReceipt(r.id); } } }, r.number), h('span', null, F.datetime(r.received_at)), h('span', null, F.money(r.total_cost)))))));
      b.append(card('Historial', h('div', { class: 'timeline' }, (po.history || []).map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.datetime(x.at)), h('span', { class: 'dot' }), h('div', null, h('b', null, x.action), h('div', { class: 'muted small' }, x.user)))))));
    }, { code: 'COM-04', wide: true });
  }
  function promptReason(title, fn) { modal(title, (b, close) => b.append(form({ id: 'why', fields: [{ key: 'r', label: 'Motivo', type: 'textarea', required: true }], submitLabel: 'Confirmar', onCancel: close, onSubmit: v => { close(); fn(v.r); return true; } }))); }
  function openReceipt(id) {
    const r = G.db.get('purchase_receipts', id); if (!r) return;
    drawer('Recepción ' + r.number, (b, close) => {
      const doc = r.document_id ? G.db.get('purchase_documents', r.document_id) : null;
      const acts = h('div', { class: 'row' });
      if (!doc && G.can('com.document.record')) acts.append(btn('Registrar comprobante', () => { close(); docForm({ receipt_id: r.id }); }, { sm: true, kind: 'primary' }));
      if (G.screens['CAL-03']) acts.append(btn('Inspección (CAL-03)', () => { close(); G.go('CAL-03'); }, { sm: true }));
      if (acts.children.length) b.append(acts);
      if (r.historical) b.append(notice('Recepción de la carga histórica: su stock ya se consumió; queda el lote para la trazabilidad (sin movimiento en el kardex).', 'info'));
      b.append(dl([['Proveedor', supName(r.supplier_id)], ['Tipo', { PURCHASE: 'Compra', FARM_NTI: 'Granja · NTI', FARM_INVOICE: 'Granja · factura' }[r.receipt_type]], ['OC', r.po_id ? (G.db.get('purchase_orders', r.po_id) || {}).number : 'Sin OC (D-COM-02)'], ['Fecha y hora', F.datetime(r.received_at)], ['Almacén', G.whName(r.warehouse_id)], ['Recibió', G.userName(r.received_by)], ['Temperatura del vehículo', r.vehicle_temp_c != null ? F.num(r.vehicle_temp_c, 1) + ' °C' : '—'], ['Guía del transportista', r.carrier_guide], ['Balanza', r.scale_equipment_id], ['Inspección de recepción', r.inspection_result === 'PENDING' ? 'Pendiente (CAL-03)' : 'Conforme'], ['Comprobante', doc ? docLabel(doc) : 'Pendiente'], ['Costo total', F.money(r.total_cost)]]));
      b.append(card('Líneas', receiptLinesTable(rcLines(r.id)), { flush: true }));
    }, { code: 'COM-06', wide: true });
  }
  function receiptLinesTable(ls) {
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Producto', 'Cant.', 'Peso', 'T °C', 'Costo', 'Lote', 'Estado'].map(x => h('th', null, x)))), h('tbody', null, ls.map(l => { const lot = l.lot_id ? G.db.get('lots', l.lot_id) : null; return h('tr', null, h('td', null, G.variantName(l.variant_id)), h('td', { class: 'r' }, F.num(l.qty, 3)), h('td', { class: 'r' }, l.weight_kg != null ? F.kg(l.weight_kg, 3) : '—'), h('td', { class: 'r' }, l.temp_c != null ? F.num(l.temp_c, 1) : '—'), h('td', { class: 'r' }, F.money(l.total_cost), h('div', { class: 'muted small' }, F.money(l.unit_cost, 2) + (l.price_basis === 'KG' ? '/kg' : '/u'))), h('td', { class: 'mono' }, lot ? lot.code : '—', lot ? h('div', null, st(lot.qc_status)) : null), h('td', null, !l.accepted ? h('span', null, st('REJECTED'), h('div', { class: 'muted small' }, l.rejection_reason)) : l.quality_hold ? st('HOLD') : st('ACCEPTED'))); }))));
  }
  function openDoc(id) {
    const d = G.db.get('purchase_documents', id); if (!d) return;
    drawer(docLabel(d), (b, close) => {
      const re = () => { close(); openDoc(id); };
      const acts = h('div', { class: 'row' });
      if (isOpenDoc(d) && can('com.payment.record')) acts.append(btn('Pagar', () => { close(); payForm({ supplier_id: d.supplier_id, document_id: d.id }); }, { sm: true, kind: 'primary' }));
      if (d.match_status === 'OBSERVED') acts.append(btn('Ver cruce (COM-08)', () => { close(); G.go('COM-08', { id: d.id }); }, { sm: true, kind: 'accent' }));
      if (isOpenDoc(d)) acts.append(btn('Programar pago', () => modal('Programar pago', (bb, cl) => bb.append(form({ id: 'sch', fields: [{ key: 'date', label: 'Fecha de pago', type: 'date', required: true }], values: { date: d.due_date && d.due_date > G.TODAY ? d.due_date : G.TODAY }, submitLabel: 'Programar', onCancel: cl, onSubmit: v => { schedulePayment(d.id, v.date); toast('Pago programado', 'ok'); cl(); re(); G.refresh(); return true; } }))), { sm: true }));
      if (d.status !== 'VOIDED' && G.canDo(MOD, 'A')) acts.append(btn('Anular', () => promptReason('Anular comprobante', r => tryDo(() => voidDocument(d.id, r), 'Comprobante anulado') && re()), { sm: true, kind: 'danger' }));
      if (G.screens['CNT-03']) acts.append(btn('Asiento (CNT-03)', () => { close(); G.go('CNT-03', { source_id: d.id }); }, { sm: true, kind: 'ghost' }));
      b.append(acts);
      if (d.match_status === 'OBSERVED') b.append(notice('RN-COM-07: el cruce de tres vías encontró diferencias; el comprobante está en la bandeja de la contadora (CNT-05) y su costo no se ajusta hasta aprobarlo.', 'warn'));
      const s = sup(d.supplier_id);
      b.append(dl([['Proveedor', `${supName(d.supplier_id)} · ${s ? s.doc_type + ' ' + s.doc_number : ''}`], ['Tipo SUNAT', `${d.sunat_doc_type} · ${pdocName(d.doc_type)}`], ['Emisión / contable', `${F.date(d.issue_date)} / ${F.date(d.accounting_date)}`], ['Vencimiento', d.due_date ? F.date(d.due_date) : 'No aplica'], ['Moneda', d.currency + (d.currency !== 'PEN' ? ` · T. C. ${F.num(d.exchange_rate, 3)}` : '')], ['Base gravada', moneyDoc(d, d.base_taxed)], ['IGV', moneyDoc(d, d.igv) + (d.igv_is_credit ? ' (crédito fiscal)' : d.igv ? ' (no es crédito: va al costo, RN-COM-15)' : '')], ['No gravado', moneyDoc(d, d.non_taxed)], ['Otros cargos', moneyDoc(d, d.other_charges)], ['Total', h('b', null, moneyDoc(d, d.total))], ['Pagado / saldo', `${moneyDoc(d, d.paid_amount || 0)} / ${moneyDoc(d, d.balance || 0)}`], ['Marca / centro de costo', `${d.brand_id ? G.brandName(d.brand_id) : 'Sin marca'} · ${G.ccName(d.cost_center_id)}`], ['OC / recepción', `${d.po_id ? (G.db.get('purchase_orders', d.po_id) || {}).number : '—'} / ${d.receipt_id ? (G.db.get('purchase_receipts', d.receipt_id) || {}).number : '—'}`], ['Cruce', st(d.match_status)], ['Estado', st(d.status)], ['Archivos', [d.file_pdf_url, d.file_xml_url].filter(Boolean).join(' · ')], ['Registró', `${G.userName(d.registered_by)} · ${F.datetime(d.registered_at)}`], d.void_reason ? ['Motivo de anulación', d.void_reason] : null, d.match_note ? ['Diferencia aprobada', `${d.match_note} (${G.userName(d.match_approved_by)})`] : null]));
      const ls = pdLines(d.id);
      if (ls.length) b.append(card('Líneas', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Descripción', 'Cant.', 'P. unit.', 'Total'].map((x, i) => h('th', { class: i ? 'r' : '' }, x)))), h('tbody', null, ls.map(l => h('tr', null, h('td', null, l.description), h('td', { class: 'r' }, F.num(l.qty, 3)), h('td', { class: 'r' }, F.num(l.unit_price, 4)), h('td', { class: 'r' }, F.num(l.total, 2))))))), { flush: true }));
      const pays = G.db.where('supplier_payment_allocations', a => a.document_id === d.id).map(a => ({ a, p: G.db.get('supplier_payments', a.payment_id) })).filter(x => x.p);
      if (pays.length) b.append(card('Pagos', h('div', { class: 'stack' }, pays.map(({ a, p }) => h('div', { class: 'row between' }, h('span', null, p.number, ' ', st(p.status)), h('span', null, F.datetime(p.paid_at)), h('span', null, methodName(p.method) + (p.is_detraction ? ' · detracción' : '')), h('b', null, F.money(a.amount)))))));
      if ((d.cost_adjustments || []).length) b.append(card('Ajuste de costo (RN-COM-10)', h('div', { class: 'stack small' }, d.cost_adjustments.map(x => h('div', null, `Diferencia ${F.money(x.diff)}: ${F.money(x.to_stock)} al lote en stock y ${F.money(x.to_cogs)} al costo de ventas (ya consumido).`)))));
    }, { code: 'COM-07', wide: true });
  }

  /* ---------- formularios de flujo ---------- */
  function poForm(pre = {}) {
    if (!can('com.order.create')) { toast(`Tu rol (${G.roleName()}) no tiene com.order.create.`, 'warn'); return; }
    drawer('Nueva orden de compra', (b, close) => {
      const lines = (pre.lines || []).map(l => Object.assign({}, l));
      let vals = Object.assign({ supplier_id: pre.supplier_id || '', warehouse_id: 'wh-CAM-L2', expected_date: G.date.add(G.TODAY, 2), brand_id: '' }, pre);
      const sum = h('div', { class: 'small' });
      const recalc = () => { const t = poTotals(lines.filter(l => l.variant_id && Number(l.qty) > 0 && l.unit_price !== ''), vals.supplier_id); const thr = Number(G.param('com_po_approval_threshold_pen')); G.ui.clear(sum).append(h('span', null, `Subtotal ${F.money(t.subtotal)} · IGV ${F.money(t.igv)} · `), h('b', null, `Total ${F.money(t.total)}`), ' ', t.total > thr ? badge('Requiere aprobación (RN-COM-01)', 'warn') : badge('Se aprueba sola', 'ok')); };
      const varsFor = () => { const cat = catalogOf(vals.supplier_id).map(c => c.variant_id); return varOpts(v => !cat.length || cat.includes(v.id)); };
      const ed = lineEditor({ lines, blank: () => ({ variant_id: '', qty: '', price_basis: 'KG', unit_price: '' }), onChange: recalc, summary: sum, cols: [
        { key: 'variant_id', label: 'Producto', type: 'select', options: varsFor, width: '220px', redraw: true, onChange: (l, v) => { l.price_basis = basisOf(v); const p = catalogPrice(vals.supplier_id, v); if (p != null) l.unit_price = p; } },
        { key: 'qty', label: 'Cantidad (kg o u)', type: 'number', width: '90px' },
        { key: 'price_basis', label: 'Base', type: 'select', options: [['KG', 'Por kg'], ['UNIT', 'Por unidad']], width: '100px' },
        { key: 'unit_price', label: 'Precio s/IGV', type: 'number', width: '90px' },
        { key: 'sub', label: 'Subtotal', render: l => F.money(l.variant_id && l.qty && l.unit_price !== '' ? lineSub(l) : 0), align: 'r' }] });
      if (!lines.length) { lines.push({ variant_id: '', qty: '', price_basis: 'KG', unit_price: '' }); ed.redraw(); }
      const f = form({ id: 'po', values: vals, fields: [
        { key: 'supplier_id', label: 'Proveedor', type: 'select', options: supOpts(s => s.status === 'ACTIVE' && !['ADVERTISING', 'CONTENT_CREATOR'].includes(s.supplier_type)), required: true, onChange: v => { vals.supplier_id = v; ed.redraw(); recalc(); } },
        { key: 'warehouse_id', label: 'Almacén de destino', type: 'select', options: whOpts(), required: true, onChange: v => { vals.warehouse_id = v; } },
        { key: 'expected_date', label: 'Fecha esperada', type: 'date', required: true, onChange: v => { vals.expected_date = v; } },
        { key: 'brand_id', label: 'Marca (opcional)', type: 'select', options: G.ui.opts('brands', x => x.name), onChange: v => { vals.brand_id = v; } },
        { key: 'notes', label: 'Notas', type: 'textarea', onChange: v => { vals.notes = v; } }],
        submitLabel: 'Guardar borrador', onCancel: close, extraActions: [btn('Guardar y enviar', () => submit(true), { kind: 'accent' })], onSubmit: () => submit(false) });
      function submit(send) {
        try { const po = createPO(Object.assign({}, vals, { lines })); let msg = `OC ${po.number} creada`; if (send) { const p2 = submitPO(po.id); msg = p2.status === 'APPROVED' ? `OC ${po.number} aprobada sola (≤ ${F.money(G.param('com_po_approval_threshold_pen'))})` : `OC ${po.number} enviada a aprobación`; } toast(msg, 'ok'); close(); G.refresh(); return true; } catch (e) { toast(e.message, 'bad'); return e.message; }
      }
      vals = f.api.values;
      f.insertBefore(h('div', { class: 'stack', style: 'margin-top:12px' }, h('b', null, 'Líneas'), ed), f.querySelector('.form-actions'));
      b.append(f); ed.redraw(); recalc();
    }, { code: 'COM-04', wide: true });
  }
  function docForm(pre = {}) {
    if (!can('com.document.record')) { toast(`Tu rol (${G.roleName()}) no tiene com.document.record.`, 'warn'); return; }
    drawer('Registrar comprobante del proveedor', (b, close) => {
      const rc = pre.receipt_id ? G.db.get('purchase_receipts', pre.receipt_id) : null;
      let vals = Object.assign({ supplier_id: rc ? rc.supplier_id : (pre.supplier_id || ''), doc_type: 'INVOICE', issue_date: G.TODAY, accounting_date: G.TODAY, currency: 'PEN', exchange_rate: 1, igv_is_credit: true, brand_id: '', cost_center_id: '' }, pre);
      const lines = rc ? rcLines(rc.id).filter(l => l.accepted).map(l => ({ receipt_line_id: l.id, variant_id: l.variant_id, description: G.variantName(l.variant_id), qty: l.price_basis === 'KG' ? l.weight_kg : l.qty, unit_price: l.unit_cost })) : (pre.lines || [{ description: '', qty: 1, unit_price: '' }]);
      const sum = h('div', { class: 'small' });
      const recalc = () => { const sub = R(U.sum(lines.filter(l => Number(l.qty) > 0), l => Number(l.qty) * Number(l.unit_price || 0))); const hasIgv = IGV_TYPES.includes(vals.doc_type); const igv = hasIgv ? R(sub * igvRate()) : 0; G.ui.clear(sum).append(`Base ${F.money(hasIgv ? sub : 0)} · IGV ${F.money(igv)} · no gravado ${F.money(hasIgv ? 0 : sub)} · `, h('b', null, `Total ${F.money(R(sub + igv))}`), vals.doc_type === 'INTERNAL_TRANSFER' ? ' · NTI sin IGV (RN-COM-12)' : ''); };
      const ed = lineEditor({ lines, fixed: !!rc, blank: () => ({ description: '', qty: 1, unit_price: '' }), onChange: recalc, summary: sum, cols: [
        { key: 'description', label: 'Descripción', width: '200px' }, { key: 'qty', label: 'Cantidad', type: 'number', width: '90px' }, { key: 'unit_price', label: 'P. unit. s/IGV', type: 'number', width: '100px' },
        rc ? { key: 'cmp', label: 'Precio OC/recepción', align: 'r', render: l => { const rl = G.db.get('purchase_receipt_lines', l.receipt_line_id); const pl = rl && rl.po_line_id ? G.db.get('purchase_order_lines', rl.po_line_id) : null; return F.money(pl ? pl.unit_price : rl ? rl.unit_cost : 0); } } : null].filter(Boolean) });
      const f = form({ id: 'pdoc', values: vals, fields: [
        { key: 'supplier_id', label: 'Proveedor', type: 'select', options: supOpts(), required: true, disabled: !!rc, onChange: v => { vals.supplier_id = v; const s = sup(v); if (s) { f.api.set('cost_center_id', s.default_cost_center_id || ''); vals.cost_center_id = s.default_cost_center_id || ''; } } },
        { key: 'doc_type', label: 'Tipo', type: 'select', options: PDOC.map(x => [x[0], `${x[2]} · ${x[1]}`]), required: true, onChange: v => { vals.doc_type = v; f.api.set('igv_is_credit', CREDIT_TYPES.includes(v)); vals.igv_is_credit = CREDIT_TYPES.includes(v); recalc(); } },
        { key: 'series', label: 'Serie', required: true, onChange: v => vals.series = v }, { key: 'number', label: 'Número', required: true, onChange: v => vals.number = v },
        { key: 'issue_date', label: 'Fecha de emisión', type: 'date', required: true, onChange: v => vals.issue_date = v }, { key: 'accounting_date', label: 'Fecha contable', type: 'date', required: true, help: 'No puede caer en un período cerrado (RN-COM-09).', onChange: v => vals.accounting_date = v },
        { key: 'currency', label: 'Moneda', type: 'select', options: [['PEN', 'Soles'], ['USD', 'Dólares']], onChange: v => { vals.currency = v; if (v === 'USD') { const fx = G.db.find('exchange_rates', x => x.date === vals.issue_date) || G.db.all('exchange_rates')[0]; f.api.set('exchange_rate', fx ? fx.sell : 3.75); vals.exchange_rate = fx ? fx.sell : 3.75; } else { f.api.set('exchange_rate', 1); vals.exchange_rate = 1; } } },
        { key: 'exchange_rate', label: 'Tipo de cambio', type: 'number', onChange: v => vals.exchange_rate = v },
        { key: 'brand_id', label: 'Marca', type: 'select', options: G.ui.opts('brands', x => x.name), help: 'Sin marca, la contadora la asigna en la bandeja (RN-CNT-16).', onChange: v => vals.brand_id = v },
        { key: 'cost_center_id', label: 'Centro de costo', type: 'select', options: G.ui.opts('cost_centers', c => `${c.code} · ${c.name}`), onChange: v => vals.cost_center_id = v },
        { key: 'igv_is_credit', label: 'El IGV es crédito fiscal', type: 'checkbox', onChange: v => vals.igv_is_credit = v },
        { key: 'file_pdf_url', label: 'Archivo PDF', placeholder: 'factura.pdf', onChange: v => vals.file_pdf_url = v }],
        submitLabel: 'Registrar comprobante', onCancel: close, onSubmit: () => {
          try { const d = registerDocument(Object.assign({}, vals, { receipt_id: rc ? rc.id : null, po_id: rc ? rc.po_id : vals.po_id, lines })); toast(d.match_status === 'OBSERVED' ? `${docLabel(d)} quedó OBSERVADO y pasó a la bandeja de la contadora (RN-COM-07)` : `${docLabel(d)} registrado`, d.match_status === 'OBSERVED' ? 'warn' : 'ok'); close(); G.refresh(); return true; } catch (e) { return e.message; }
        } });
      f.insertBefore(h('div', { class: 'stack', style: 'margin-top:12px' }, h('b', null, rc ? `Líneas de la recepción ${rc.number}` : 'Líneas'), ed), f.querySelector('.form-actions'));
      vals = f.api.values;
      if (rc) b.append(notice(`Cruce de tres vías: se compara con la OC y la recepción ${rc.number}. Tolerancia de precio ${F.pct(tol('com_price_tolerance_pct'), 0)} (RN-COM-07).`, 'info'));
      b.append(f); recalc();
    }, { code: 'COM-07', wide: true });
  }
  function payForm(pre = {}) {
    if (!can('com.payment.record')) { toast(`Tu rol (${G.roleName()}) no tiene com.payment.record.`, 'warn'); return; }
    drawer('Pago a proveedor', (b, close) => {
      let vals = { supplier_id: pre.supplier_id || '', cash_account_id: 'ca-BCP-CTE', method: 'TRANSFER', paid_at: G.TODAY + 'T' + G.date.now().slice(11, 16), reference: '', paid_to_account: '' };
      const box = h('div', { class: 'stack' });
      let allocs = [];
      function drawDocs() {
        G.ui.clear(box);
        const s = sup(vals.supplier_id);
        if (!s) { box.append(empty('Elige el proveedor para ver sus comprobantes con saldo.')); return; }
        vals.paid_to_account = s.bank_account || '';
        const docs = G.db.where('purchase_documents', d => d.supplier_id === s.id && isOpenDoc(d)).sort(U.by('due_date'));
        allocs = docs.map(d => ({ d, amount: pre.document_id ? (d.id === pre.document_id ? d.balance : 0) : 0 }));
        if (!docs.length) { box.append(empty('Este proveedor no tiene comprobantes con saldo.')); return; }
        box.append(dl([['Cuenta registrada', s.bank_account ? `${s.bank_name || ''} ${s.bank_account}` : 'Sin cuenta: no se puede transferir (RN-COM-13)'], ['Detracción configurada', detractionRates()[s.supplier_type] ? F.pct(detractionRates()[s.supplier_type], 0) + ' (D-COM-03)' : 'No aplica']]));
        const tot = h('b');
        const upd = () => { tot.textContent = 'Total a pagar ' + F.money(U.sum(allocs, a => Number(a.amount) || 0)); };
        box.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Comprobante', 'Vence', 'Saldo', 'Aplicar'].map((x, i) => h('th', { class: i > 1 ? 'r' : '' }, x)))), h('tbody', null, allocs.map(a => h('tr', null, h('td', null, docLabel(a.d), detractionFor(a.d) ? h('div', { class: 'muted small' }, `Detracción ${F.money(detractionFor(a.d))}`) : null), h('td', null, F.date(a.d.due_date), a.d.due_date < G.TODAY ? h('div', null, st('OVERDUE')) : null), h('td', { class: 'r' }, moneyDoc(a.d, a.d.balance)), h('td', { class: 'r' }, inp(a.amount || '', v => { a.amount = v === '' ? 0 : Number(v); upd(); }, { type: 'number', step: '0.01', style: 'width:110px' }))))))));
        box.append(h('div', { class: 'row between' }, btn('Aplicar saldos completos', () => { allocs.forEach(a => a.amount = a.d.balance); drawDocs2(); }, { sm: true }), tot)); upd();
        function drawDocs2() { const keep = allocs.map(a => a.amount); drawDocs(); allocs.forEach((a, i) => a.amount = keep[i] ?? a.amount); for (const [i, inpEl] of [...box.querySelectorAll('tbody input')].entries()) inpEl.value = allocs[i].amount; upd(); }
      }
      const f = form({ id: 'pay', values: vals, fields: [
        { key: 'supplier_id', label: 'Proveedor', type: 'select', options: supOpts(s => G.db.find('purchase_documents', d => d.supplier_id === s.id && isOpenDoc(d))), required: true, onChange: v => { vals.supplier_id = v; pre.document_id = null; drawDocs(); f.api.set('paid_to_account', vals.paid_to_account); } },
        { key: 'cash_account_id', label: 'Pagar desde', type: 'select', options: bankOpts(), required: true, onChange: v => vals.cash_account_id = v },
        { key: 'method', label: 'Medio', type: 'select', options: METHODS.filter(m => m[0] !== 'INTERNAL_SETTLEMENT'), required: true, onChange: v => vals.method = v },
        { key: 'paid_at', label: 'Fecha y hora', type: 'datetime', required: true, onChange: v => vals.paid_at = v },
        { key: 'reference', label: 'Número de operación', required: true, onChange: v => vals.reference = v },
        { key: 'paid_to_account', label: 'Cuenta destino', help: 'Debe ser la registrada del proveedor (RN-COM-13).', onChange: v => vals.paid_to_account = v }],
        submitLabel: 'Registrar pago', onCancel: close, onSubmit: () => {
          const al = allocs.filter(a => Number(a.amount) > 0).map(a => ({ document_id: a.d.id, amount: Number(a.amount) }));
          try {
            let ps = [];
            if (al.length === 1 && detractionFor(G.db.get('purchase_documents', al[0].document_id))) ps = payWithDetraction(Object.assign({}, vals, { allocations: al }));
            else ps = [registerPayment(Object.assign({}, vals, { allocations: al }))];
            toast(`Pago ${ps.map(p => p.number).join(' + ')} registrado por ${F.money(U.sum(ps, p => p.amount))}`, 'ok'); close(); G.refresh(); return true;
          } catch (e) { return e.message; }
        } });
      vals = f.api.values;
      f.insertBefore(box, f.querySelector('.form-actions'));
      b.append(f); drawDocs(); if (vals.paid_to_account) f.api.set('paid_to_account', vals.paid_to_account);
    }, { code: 'COM-10', wide: true });
  }

  /* ---------- pantallas ---------- */
  const PO_ST = [['DRAFT', 'Borrador'], ['PENDING_APPROVAL', 'Por aprobar'], ['APPROVED', 'Aprobada'], ['PARTIALLY_RECEIVED', 'Recibida parcial'], ['RECEIVED', 'Recibida'], ['CLOSED', 'Cerrada'], ['VOIDED', 'Anulada']];

  function scrSuppliers(el) {
    const body = page(el, { code: 'COM-01', title: 'Proveedores', sub: 'RUC validado con la SUNAT, tipo, condición de pago, cuenta bancaria registrada y empresa relacionada. Un proveedor no habido o de baja no recibe OC.', actions: G.canDo(MOD, 'C') ? [{ label: 'Nuevo proveedor', kind: 'primary', icon: '+', onClick: () => editSupplier(null) }] : [] });
    const rows = G.db.all('suppliers');
    const balBy = U.groupBy(G.db.where('purchase_documents', isOpenDoc), 'supplier_id');
    body.append(kpis([{ label: 'Proveedores activos', value: rows.filter(s => s.status === 'ACTIVE').length }, { label: 'Observados en SUNAT', value: rows.filter(s => ['NOT_LOCATED', 'LOW', 'SUSPENDED'].includes(s.sunat_status)).length, tone: 'bad' }, { label: 'Cambios de cuenta por aprobar', value: rows.filter(s => s.pending_bank_change).length, tone: 'warn' }, { label: 'Sin cuenta bancaria', value: rows.filter(s => !s.bank_account && s.doc_type !== 'FOREIGN' && s.supplier_type !== 'RELATED_FARM').length }]));
    body.append(table({ id: 'com01', columns: [
      { key: 'trade_name', label: 'Proveedor', render: s => h('div', null, h('b', null, s.trade_name || s.legal_name), h('div', { class: 'muted small' }, s.legal_name)) },
      { key: 'doc_number', label: 'Documento', render: s => h('span', { class: 'mono' }, `${s.doc_type} ${s.doc_number}`) },
      { key: 'supplier_type', label: 'Tipo', value: s => supTypeName(s.supplier_type) },
      { key: 'payment_terms_days', label: 'Crédito', align: 'r', render: s => s.payment_terms_days ? s.payment_terms_days + ' d' : 'Contado' },
      { key: 'bank_account', label: 'Cuenta bancaria', render: s => s.pending_bank_change ? h('span', null, s.bank_account || '—', ' ', badge('cambio pendiente', 'warn')) : (s.bank_account || '—') },
      { key: 'sunat_status', label: 'SUNAT', render: s => st(s.sunat_status) },
      { key: 'bal', label: 'Por pagar', align: 'r', value: s => R(U.sum(balBy[s.id] || [], d => pen(d, d.balance))), render: s => F.money(U.sum(balBy[s.id] || [], d => pen(d, d.balance))) },
      { key: 'rating', label: 'Calif.', align: 'c', render: s => s.rating ? '★'.repeat(s.rating) : '—' }], rows, onRow: s => openSupplier(s.id),
      filters: [{ key: 'supplier_type', label: 'Tipo', options: SUP_TYPES }, { key: 'sunat_status', label: 'SUNAT', options: SUNAT_ST }] }));
  }
  function scrCatalog(el) {
    const body = page(el, { code: 'COM-02', title: 'Catálogo por proveedor', sub: 'Qué le compramos a cada proveedor: código, unidad, último precio sin IGV, pedido mínimo, plazo y la historia del precio.', actions: G.canDo(MOD, 'E') ? [{ label: 'Agregar producto', kind: 'primary', icon: '+', onClick: () => catForm() }] : [] });
    const rows = G.db.all('supplier_catalog');
    const byVar = U.groupBy(rows.filter(r => r.status === 'ACTIVE'), 'variant_id');
    const multi = Object.values(byVar).filter(x => x.length > 1);
    body.append(kpis([{ label: 'Productos con proveedor', value: Object.keys(byVar).length }, { label: 'Con más de un proveedor', value: multi.length, sub: 'comparables por precio' }, { label: 'Precios cambiados este mes', value: rows.filter(r => (r.price_history || []).some(x => x.date >= G.date.month(G.TODAY) && x.source !== 'LISTA')).length }]));
    body.append(table({ id: 'com02', columns: [
      { key: 'supplier_id', label: 'Proveedor', value: r => supName(r.supplier_id) }, { key: 'variant_id', label: 'Producto', value: r => G.variantName(r.variant_id) },
      { key: 'supplier_sku', label: 'Código del proveedor', mono: true }, { key: 'price_basis', label: 'Unidad', value: r => r.price_basis === 'KG' ? 'kg' : 'unidad' },
      { key: 'last_price', label: 'Último precio s/IGV', align: 'r', render: r => F.money(r.last_price, r.last_price < 1 ? 3 : 2) },
      { key: 'trend', label: 'Variación', align: 'r', value: r => { const hh = r.price_history || []; return hh.length > 1 ? R((hh[hh.length - 1].price - hh[0].price) / hh[0].price * 100, 1) : 0; }, render: r => { const hh = r.price_history || []; if (hh.length < 2) return '—'; const v = (hh[hh.length - 1].price - hh[0].price) / hh[0].price * 100; return badge((v > 0 ? '+' : '') + F.pct(v, 1), v > 2 ? 'warn' : v < 0 ? 'ok' : ''); } },
      { key: 'min_order_qty', label: 'Pedido mínimo', align: 'r', render: r => r.min_order_qty ? F.num(r.min_order_qty, 0) : '—' }, { key: 'lead_time_days', label: 'Plazo', align: 'r', render: r => F.days(r.lead_time_days) },
      { key: 'status', label: 'Estado', render: r => st(r.status) }], rows, onRow: r => catDetail(r),
      filters: [{ key: 'supplier_id', label: 'Proveedor', options: supOpts(s => rows.some(r => r.supplier_id === s.id)) }] }));
    if (multi.length) body.append(card('Comparación entre proveedores del mismo producto', h('div', { class: 'stack' }, multi.map(list => h('div', null, h('b', null, G.variantName(list[0].variant_id)), G.ui.chart.hbar({ items: list.map(c => ({ label: supName(c.supplier_id), value: c.last_price, tone: c.last_price === Math.min(...list.map(x => x.last_price)) ? 'ok' : '' })), format: v => F.money(v) }))))));
  }
  function catDetail(r) {
    drawer(G.variantName(r.variant_id), (b, close) => {
      if (G.canDo(MOD, 'E')) b.append(h('div', { class: 'row' }, btn('Editar', () => { close(); catForm(r); }, { sm: true, kind: 'primary' }), btn(r.status === 'ACTIVE' ? 'Desactivar' : 'Activar', () => { G.db.update('supplier_catalog', r.id, { status: r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }); close(); G.refresh(); }, { sm: true })));
      b.append(dl([['Proveedor', supName(r.supplier_id)], ['Código del proveedor', r.supplier_sku], ['Unidad de compra', r.price_basis === 'KG' ? 'kg' : 'unidad'], ['Último precio', F.money(r.last_price, 3) + ' sin IGV'], ['Pedido mínimo', r.min_order_qty], ['Plazo de entrega', F.days(r.lead_time_days)]]));
      const hh = r.price_history || [];
      if (hh.length > 1) b.append(card('Historia del precio', G.ui.chart.line({ labels: hh.map(x => F.date(x.date).slice(0, 5)), series: [{ name: 'Precio', values: hh.map(x => x.price) }], format: v => F.money(v) })));
      b.append(card('Registro', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('tbody', null, hh.slice().reverse().map(x => h('tr', null, h('td', null, F.date(x.date)), h('td', null, { OC: 'Orden de compra', COMPROBANTE: 'Comprobante', LISTA: 'Lista del proveedor', NTI: 'NTI de la granja' }[x.source] || x.source), h('td', { class: 'r' }, F.money(x.price, 3))))))), { flush: true }));
    }, { code: 'COM-02' });
  }
  function catForm(r) {
    drawer(r ? 'Editar producto del catálogo' : 'Agregar producto al catálogo', (b, close) => b.append(form({ id: 'cat', values: r ? Object.assign({}, r) : { price_basis: 'KG', lead_time_days: 2, status: 'ACTIVE' }, fields: [
      { key: 'supplier_id', label: 'Proveedor', type: 'select', options: supOpts(), required: true, disabled: !!r }, { key: 'variant_id', label: 'Producto', type: 'select', options: varOpts(), required: true, disabled: !!r },
      { key: 'supplier_sku', label: 'Código del proveedor' }, { key: 'price_basis', label: 'Unidad', type: 'select', options: [['KG', 'kg'], ['UNIT', 'unidad']] },
      { key: 'last_price', label: 'Precio sin IGV', type: 'number', min: 0, required: true }, { key: 'min_order_qty', label: 'Pedido mínimo', type: 'number', min: 0 }, { key: 'lead_time_days', label: 'Plazo (días)', type: 'number', min: 0 }],
      submitLabel: 'Guardar', onCancel: close, onSubmit: v => {
        if (!r && G.db.find('supplier_catalog', c => c.supplier_id === v.supplier_id && c.variant_id === v.variant_id)) return 'Ese producto ya está en el catálogo de este proveedor.';
        if (r) { const changed = Number(v.last_price) !== Number(r.last_price); G.db.update('supplier_catalog', r.id, { supplier_sku: v.supplier_sku, price_basis: v.price_basis, min_order_qty: v.min_order_qty || null, lead_time_days: v.lead_time_days, last_price: Number(v.last_price), price_history: changed ? (r.price_history || []).concat([{ date: G.TODAY, price: Number(v.last_price), source: 'LISTA' }]) : r.price_history }); }
        else G.db.insert('supplier_catalog', { supplier_id: v.supplier_id, variant_id: v.variant_id, supplier_sku: v.supplier_sku || null, purchase_uom_id: v.price_basis === 'KG' ? 'um-KGM' : 'um-NIU', price_basis: v.price_basis, last_price: Number(v.last_price), min_order_qty: v.min_order_qty || null, lead_time_days: v.lead_time_days || 0, status: 'ACTIVE', price_history: [{ date: G.TODAY, price: Number(v.last_price), source: 'LISTA' }] });
        toast('Catálogo actualizado', 'ok'); close(); G.refresh(); return true;
      } })), { code: 'COM-02' });
  }
  function scrRequisitions(el) {
    const body = page(el, { code: 'COM-03', title: 'Requerimientos', sub: 'Lo que pide el plan de producción (PRO-03) o un almacén: producto, cantidad y fecha. Marca varios y agrúpalos en órdenes de compra por proveedor.', actions: G.canDo(MOD, 'C') ? [{ label: 'Nuevo requerimiento', kind: 'primary', icon: '+', onClick: () => reqForm() }] : [] });
    const rows = G.db.all('purchase_requisitions').sort(U.by('needed_date'));
    const pend = rows.filter(r => r.status === 'PENDING');
    G.com._sel = G.com._sel || new Set();
    for (const id of [...G.com._sel]) if (!pend.find(r => r.id === id)) G.com._sel.delete(id);
    body.append(kpis([{ label: 'Pendientes', value: pend.length, tone: pend.length ? 'warn' : 'ok' }, { label: 'Para hoy o vencidos', value: pend.filter(r => r.needed_date <= G.TODAY).length, tone: 'bad' }, { label: 'Del plan de producción', value: pend.filter(r => r.source === 'PRO-03').length }, { label: 'En OC', value: rows.filter(r => r.status === 'ORDERED').length }]));
    const groupBtn = btn(`Generar OC con los marcados (${G.com._sel.size})`, () => {
      if (!G.com._sel.size) return toast('Marca al menos un requerimiento pendiente.', 'warn');
      const pos = tryDo(() => requisitionsToPOs([...G.com._sel]), r => `${r.length} OC creada(s) en borrador: ${r.map(p => p.number).join(', ')}`);
      if (pos) G.com._sel.clear();
    }, { kind: 'primary', disabled: !can('com.order.create') });
    body.append(h('div', { class: 'row between' }, h('span', { class: 'muted small' }, 'Se elige el proveedor más barato del catálogo (COM-02) y se agrupa por proveedor y almacén.'), groupBtn));
    body.append(table({ id: 'com03', columns: [
      { key: 'pick', label: '', sort: false, render: r => r.status === 'PENDING' ? h('input', { type: 'checkbox', checked: G.com._sel.has(r.id), on: { click: e => e.stopPropagation(), change: e => { e.target.checked ? G.com._sel.add(r.id) : G.com._sel.delete(r.id); groupBtn.lastChild.textContent = `Generar OC con los marcados (${G.com._sel.size})`; } } }) : '' },
      { key: 'number', label: 'Número', mono: true }, { key: 'source', label: 'Origen', value: r => ({ 'PRO-03': 'Plan de producción', WAREHOUSE: 'Almacén (stock mínimo)', MANUAL: 'Manual' }[r.source] || r.source) },
      { key: 'variant_id', label: 'Producto', value: r => G.variantName(r.variant_id) }, { key: 'qty', label: 'Cantidad', align: 'r', render: r => basisOf(r.variant_id) === 'KG' ? F.kg(r.qty, 1) : F.num(r.qty) + ' u' },
      { key: 'warehouse_id', label: 'Para', value: r => G.whName(r.warehouse_id) }, { key: 'needed_date', label: 'Fecha', render: r => h('span', null, F.date(r.needed_date), r.status === 'PENDING' && r.needed_date <= G.TODAY ? h('div', null, badge('urgente', 'bad')) : null) },
      { key: 'best', label: 'Mejor precio', align: 'r', render: r => { const c = G.db.where('supplier_catalog', x => x.variant_id === r.variant_id && x.status === 'ACTIVE').sort(U.by('last_price'))[0]; return c ? h('span', null, F.money(c.last_price), h('div', { class: 'muted small' }, supName(c.supplier_id))) : badge('sin proveedor', 'warn'); } },
      { key: 'status', label: 'Estado', render: r => h('span', null, st(r.status), r.po_id ? h('div', { class: 'muted small mono' }, (G.db.get('purchase_orders', r.po_id) || {}).number) : null) }], rows,
      filters: [{ key: 'status', label: 'Estado', options: [['PENDING', 'Pendiente'], ['ORDERED', 'En OC'], ['CANCELLED', 'Cancelado']] }, { key: 'source', label: 'Origen', options: [['PRO-03', 'Plan de producción'], ['WAREHOUSE', 'Almacén'], ['MANUAL', 'Manual']] }],
      onRow: r => drawer('Requerimiento ' + r.number, (b, close) => { if (r.status === 'PENDING' && G.canDo(MOD, 'E')) b.append(h('div', { class: 'row' }, btn('Cancelar requerimiento', () => { G.db.update('purchase_requisitions', r.id, { status: 'CANCELLED' }); close(); G.refresh(); }, { sm: true, kind: 'danger' }))); if (r.po_id) b.append(h('div', { class: 'row' }, btn('Ver OC', () => { close(); openPO(r.po_id); }, { sm: true }))); b.append(dl([['Producto', G.variantName(r.variant_id)], ['Cantidad', F.num(r.qty, 3)], ['Almacén', G.whName(r.warehouse_id)], ['Fecha requerida', F.date(r.needed_date)], ['Origen', r.source + (r.source_ref ? ' · ' + r.source_ref : '')], ['Pidió', G.userName(r.requested_by) + ' · ' + F.datetime(r.requested_at)], ['Notas', r.notes]])); }, { code: 'COM-03' }) }));
  }
  function reqForm() {
    drawer('Nuevo requerimiento', (b, close) => b.append(form({ id: 'req', values: { warehouse_id: 'wh-ALM-L2', needed_date: G.date.add(G.TODAY, 3), source: 'MANUAL' }, fields: [
      { key: 'variant_id', label: 'Producto', type: 'select', options: varOpts(v => !v.sellable || G.db.find('supplier_catalog', c => c.variant_id === v.id)), required: true },
      { key: 'qty', label: 'Cantidad (kg o u)', type: 'number', min: 0, required: true }, { key: 'warehouse_id', label: 'Almacén', type: 'select', options: whOpts(), required: true },
      { key: 'needed_date', label: 'Fecha requerida', type: 'date', required: true }, { key: 'source', label: 'Origen', type: 'select', options: [['MANUAL', 'Manual'], ['WAREHOUSE', 'Almacén (stock mínimo)'], ['PRO-03', 'Plan de producción']] }, { key: 'notes', label: 'Notas', type: 'textarea' }],
      submitLabel: 'Crear', onCancel: close, onSubmit: v => { const r = createRequisition(v); toast(`Requerimiento ${r.number} creado`, 'ok'); close(); G.refresh(); return true; } })), { code: 'COM-03' });
  }
  function scrPOs(el) {
    const body = page(el, { code: 'COM-04', title: 'Órdenes de compra', sub: `Serie OC01. Hasta ${F.money(G.param('com_po_approval_threshold_pen'))} la OC se aprueba sola al enviarla; encima la aprueba otra persona con com.order.approve (RN-COM-01).`, actions: can('com.order.create') ? [{ label: 'Nueva OC', kind: 'primary', icon: '+', onClick: () => poForm() }] : [] });
    const rows = G.scope.filter(G.db.all('purchase_orders'), { brand: 'x', site: 'establishment_id' }).sort(U.by('order_date', -1));
    const open = rows.filter(r => ['APPROVED', 'PARTIALLY_RECEIVED'].includes(r.status));
    body.append(kpis([{ label: 'Por aprobar', value: rows.filter(r => r.status === 'PENDING_APPROVAL').length, tone: 'warn', onClick: () => G.go('COM-05') }, { label: 'Por recibir', value: open.length, sub: F.money(U.sum(open, r => r.total)) }, { label: 'Atrasadas', value: open.filter(r => r.expected_date < G.TODAY).length, tone: 'bad' }, { label: 'Compradas en el mes', value: F.money(U.sum(rows.filter(r => r.order_date >= G.date.month(G.TODAY) && r.status !== 'VOIDED'), r => r.total)) }]));
    body.append(table({ id: 'com04', columns: [
      { key: 'number', label: 'OC', mono: true }, { key: 'order_date', label: 'Fecha', render: r => F.date(r.order_date) }, { key: 'supplier_id', label: 'Proveedor', value: r => supName(r.supplier_id) },
      { key: 'warehouse_id', label: 'Destino', value: r => G.whName(r.warehouse_id) }, { key: 'expected_date', label: 'Esperada', render: r => h('span', null, F.date(r.expected_date), ['APPROVED', 'PARTIALLY_RECEIVED'].includes(r.status) && r.expected_date < G.TODAY ? h('div', null, badge('atrasada', 'bad')) : null) },
      { key: 'total', label: 'Total', align: 'r', render: r => F.money(r.total) }, { key: 'rec', label: 'Recibido', value: r => R(poPct(r), 0), render: r => r.status === 'DRAFT' || r.status === 'PENDING_APPROVAL' ? '—' : h('div', { style: 'min-width:80px' }, progress(poPct(r), poPct(r) >= 98 ? 'ok' : ''), h('span', { class: 'small muted' }, F.pct(poPct(r), 0))) },
      { key: 'status', label: 'Estado', render: r => st(r.status) }], rows, onRow: r => openPO(r.id),
      filters: [{ key: 'status', label: 'Estado', options: PO_ST }, { key: 'supplier_id', label: 'Proveedor', options: supOpts(s => rows.some(r => r.supplier_id === s.id)) }] }));
  }
  function scrApprovals(el) {
    const thr = Number(G.param('com_po_approval_threshold_pen'));
    const body = page(el, { code: 'COM-05', title: 'Aprobación de órdenes', sub: `Bandeja del aprobador: OC sobre ${F.money(thr)} (D-COM-01: aprueban GERENTE o ADMINISTRACIÓN). Quien creó la OC no la aprueba.` });
    const rows = G.db.where('purchase_orders', r => r.status === 'PENDING_APPROVAL').sort(U.by('submitted_at'));
    if (!can('com.order.approve')) body.append(notice(`Tu rol (${G.roleName()}) no tiene com.order.approve: ves la bandeja en modo lectura.`, 'info'));
    body.append(kpis([{ label: 'Por aprobar', value: rows.length, tone: rows.length ? 'warn' : 'ok' }, { label: 'Monto en espera', value: F.money(U.sum(rows, r => r.total)) }, { label: 'Aprobadas este mes', value: G.db.where('purchase_orders', r => r.approved_at && r.approved_at >= G.date.month(G.TODAY) && !r.auto_approved).length }, { label: 'Aprobadas solas este mes', value: G.db.where('purchase_orders', r => r.auto_approved && r.approved_at >= G.date.month(G.TODAY)).length }]));
    if (!rows.length) { body.append(card(null, empty('No hay órdenes por aprobar.'))); return; }
    body.append(h('div', { class: 'grid c2' }, rows.map(po => {
      const ls = poLines(po.id); const mine = po.created_by === uid();
      const cmp = ls.map(l => { const c = G.db.where('supplier_catalog', x => x.variant_id === l.variant_id && x.supplier_id !== po.supplier_id && x.status === 'ACTIVE').sort(U.by('last_price'))[0]; return c && c.last_price < l.unit_price ? `${G.variantName(l.variant_id)}: ${supName(c.supplier_id)} lo da a ${F.money(c.last_price)}` : null; }).filter(Boolean);
      return card(`${po.number} · ${supName(po.supplier_id)}`, h('div', { class: 'stack' },
        dl([['Total', h('b', null, F.money(po.total))], ['Creó', `${G.userName(po.created_by)} · ${F.datetime(po.created_at)}`], ['Destino', G.whName(po.warehouse_id)], ['Esperada', F.date(po.expected_date)]]),
        h('div', { class: 'small' }, ls.map(l => h('div', null, `${G.variantName(l.variant_id)} · ${l.price_basis === 'KG' ? F.kg(poOrdered(l), 1) : F.num(l.qty) + ' u'} × ${F.money(l.unit_price)} = ${F.money(l.subtotal)}`))),
        cmp.length ? notice('Precio más bajo en el catálogo: ' + cmp.join(' · '), 'info') : null,
        mine ? notice('RN-COM-01: tú creaste esta OC; no puedes aprobarla.', 'warn') : null,
        h('div', { class: 'row' }, btn('Aprobar', () => tryDo(() => approvePO(po.id), `OC ${po.number} aprobada`), { kind: 'primary', sm: true, disabled: !can('com.order.approve') || mine }), btn('Devolver', () => promptReason('Devolver ' + po.number, r => tryDo(() => returnPO(po.id, r), 'OC devuelta a borrador')), { sm: true, disabled: !can('com.order.approve') }), btn('Ver', () => openPO(po.id), { sm: true, kind: 'ghost' }))));
    })));
  }
  function scrReceipt(el, params) {
    const body = page(el, { code: 'COM-06', title: 'Recepción', sub: 'Contra la OC o sin ella: kg, unidades, temperatura por línea y del vehículo, lote del proveedor, balanza e inspección. Cada línea aceptada crea su lote y mueve el stock (RN-COM-10).' });
    const pending = G.scope.filter(G.db.where('purchase_orders', p => ['APPROVED', 'PARTIALLY_RECEIVED'].includes(p.status)), { brand: 'x' }).sort(U.by('expected_date'));
    const po = params.po_id ? G.db.get('purchase_orders', params.po_id) : null;
    if (!po && !params.direct) {
      body.append(kpis([{ label: 'OC por recibir', value: pending.length }, { label: 'Esperadas hoy', value: pending.filter(p => p.expected_date === G.TODAY).length, tone: 'info' }, { label: 'Lotes en cuarentena por recepción', value: G.db.where('lots', l => l.qc_status === 'QUARANTINE' && (l.origin === 'PURCHASE' || l.origin === 'FARM')).length, tone: 'warn' }]));
      body.append(card('Órdenes por recibir', pending.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['OC', 'Proveedor', 'Esperada', 'Avance', ''].map(x => h('th', null, x)))), h('tbody', null, pending.map(p => h('tr', null, h('td', { class: 'mono' }, p.number), h('td', null, supName(p.supplier_id)), h('td', null, F.date(p.expected_date), p.expected_date < G.TODAY ? h('div', null, badge('atrasada', 'bad')) : null), h('td', null, F.pct(poPct(p), 0)), h('td', { class: 'r' }, btn('Recibir', () => G.go('COM-06', { po_id: p.id }), { sm: true, kind: 'primary', disabled: !can('com.receipt.record') }))))))) : empty('No hay OC aprobadas por recibir.'), { flush: true, actions: [btn('Recepción sin OC', () => G.go('COM-06', { direct: 1 }), { sm: true, disabled: !can('com.receipt.record') })] }));
      const recent = G.scope.filter(G.db.all('purchase_receipts'), { brand: 'x' }).sort(U.by('received_at', -1));
      body.append(table({ id: 'com06', columns: [{ key: 'number', label: 'Recepción', mono: true }, { key: 'received_at', label: 'Fecha', render: r => F.datetime(r.received_at) }, { key: 'supplier_id', label: 'Proveedor', value: r => supName(r.supplier_id) }, { key: 'receipt_type', label: 'Tipo', value: r => ({ PURCHASE: 'Compra', FARM_NTI: 'Granja · NTI', FARM_INVOICE: 'Granja · factura' }[r.receipt_type]) }, { key: 'po', label: 'OC', value: r => r.po_id ? (G.db.get('purchase_orders', r.po_id) || {}).number : 'Sin OC' }, { key: 'total_cost', label: 'Costo', align: 'r', render: r => F.money(r.total_cost) }, { key: 'doc', label: 'Comprobante', render: r => r.document_id ? st('POSTED') : badge('pendiente', 'warn') }], rows: recent, onRow: r => openReceipt(r.id), filters: [{ key: 'receipt_type', label: 'Tipo', options: [['PURCHASE', 'Compra'], ['FARM_NTI', 'Granja · NTI']] }] }));
      return;
    }
    if (!can('com.receipt.record')) body.append(notice(`Tu rol (${G.roleName()}) no tiene com.receipt.record: no puedes registrar la recepción.`, 'warn'));
    let head = { po_id: po ? po.id : null, supplier_id: po ? po.supplier_id : '', warehouse_id: po ? po.warehouse_id : 'wh-CAM-L1', received_at: G.TODAY + 'T' + G.date.now().slice(11, 16), vehicle_temp_c: '', carrier_guide: '', scale: 'BAL-L1-01', inspection: 'OK' };
    const lines = po ? poLines(po.id).map(pl => ({ po_line_id: pl.id, variant_id: pl.variant_id, qty: '', weight_kg: '', temp_c: '', supplier_lot_code: '', expiry_date: '', decision: 'ACCEPT', over_receipt_reason: '', pend: R(poOrdered(pl) - poReceived(pl), 3), basis: pl.price_basis, unit_price: pl.unit_price })) : [{ variant_id: '', qty: '', weight_kg: '', temp_c: '', decision: 'ACCEPT', unit_price: '' }];
    const info = h('div', { class: 'stack' });
    const recalc = () => {
      G.ui.clear(info); let tot = 0; const msgs = [];
      for (const l of lines) { if (!l.variant_id || !(Number(l.qty) > 0 || Number(l.weight_kg) > 0)) continue; try { const e = evalReceiptLine(l, l.po_line_id ? G.db.get('purchase_order_lines', l.po_line_id) : null); tot += e.total_cost; if (e.weight && e.total_cost) msgs.push(`${e.v.name}: ${F.money(e.total_cost / e.weight)} por kg`); } catch (er) { msgs.push(h('span', { class: 'small', style: 'color:var(--bad)' }, er.message)); } }
      info.append(h('div', { class: 'row between' }, h('b', null, 'Costo de la recepción ' + F.money(tot)), h('span', { class: 'small muted' }, `Refrigerados ≤ ${F.num(tol('com_chilled_max_c'), 0)} °C · congelados ≤ ${F.num(tol('com_frozen_max_c'), 0)} °C · exceso ≤ ${F.pct(tol('com_over_receipt_tolerance_pct'), 0)}`)), msgs.map(m => h('div', { class: 'small' }, m)));
    };
    const ed = lineEditor({ lines, fixed: !!po, blank: () => ({ variant_id: '', qty: '', weight_kg: '', temp_c: '', decision: 'ACCEPT', unit_price: '' }), onChange: recalc, cols: [
      po ? { key: 'variant_id', label: 'Producto', render: l => h('div', null, G.variantName(l.variant_id), h('div', { class: 'muted small' }, `Pendiente ${l.basis === 'KG' ? F.kg(l.pend, 1) : F.num(l.pend) + ' u'} · ${F.money(l.unit_price)}${l.basis === 'KG' ? '/kg' : '/u'}`)) } : { key: 'variant_id', label: 'Producto', type: 'select', options: () => varOpts(v => !v.sellable || (G.productOf(v.id) || {}).origin === 'RESALE'), width: '200px', onChange: (l, v) => { l.unit_price = catalogPrice(head.supplier_id, v) ?? (G.variant(v) || {}).std_cost; }, redraw: true },
      { key: 'qty', label: 'Unidades', type: 'number', width: '80px' }, { key: 'weight_kg', label: 'Peso kg', type: 'number', width: '90px' }, { key: 'temp_c', label: 'T °C', type: 'number', width: '70px' },
      po ? null : { key: 'unit_price', label: 'Costo s/IGV', type: 'number', width: '90px' },
      { key: 'supplier_lot_code', label: 'Lote prov.', width: '100px' }, { key: 'expiry_date', label: 'Vence', type: 'date', width: '130px' },
      { key: 'decision', label: 'Decisión', type: 'select', options: [['ACCEPT', 'Aceptar'], ['QUALITY_HOLD', 'A calidad'], ['REJECT', 'Rechazar']], width: '120px' },
      { key: 'over_receipt_reason', label: 'Motivo exceso / rechazo', width: '140px' }].filter(Boolean) });
    const f = form({ id: 'rc', values: head, fields: [
      po ? { key: 'po', label: 'Orden de compra', type: 'readonly' } : { key: 'supplier_id', label: 'Proveedor', type: 'select', options: supOpts(s => s.status === 'ACTIVE' && !['ADVERTISING', 'CONTENT_CREATOR', 'SERVICES'].includes(s.supplier_type)), required: true, onChange: v => head.supplier_id = v },
      { key: 'warehouse_id', label: 'Almacén', type: 'select', options: whOpts(), required: true, onChange: v => head.warehouse_id = v },
      { key: 'received_at', label: 'Fecha y hora', type: 'datetime', required: true, onChange: v => head.received_at = v },
      { key: 'vehicle_temp_c', label: 'T° del vehículo (°C)', type: 'number', onChange: v => head.vehicle_temp_c = v },
      { key: 'carrier_guide', label: 'Guía del transportista', onChange: v => head.carrier_guide = v },
      { key: 'scale', label: 'Balanza usada', type: 'select', options: [['BAL-L1-01', 'Balanza de piso Local 1 (BAL-L1-01)'], ['BAL-L2-01', 'Balanza de piso Local 2 (BAL-L2-01)'], ['BAL-L1-02', 'Balanza de mostrador Local 1']], onChange: v => head.scale = v },
      { key: 'inspection', label: 'Inspección de recepción (CAL-03)', type: 'select', options: [['OK', 'Conforme: lotes liberados'], ['PENDING', 'Pendiente: lotes en cuarentena']], onChange: v => head.inspection = v }],
      submitLabel: 'Registrar recepción', onCancel: () => G.go('COM-06'), onSubmit: () => {
        try { const rc = postReceipt(Object.assign({}, head, { lines: lines.map(l => Object.assign({}, l, { rejection_reason: l.decision === 'REJECT' ? l.over_receipt_reason : null })) })); toast(`Recepción ${rc.number} registrada · ${F.money(rc.total_cost)}`, 'ok'); G.go('COM-06'); openReceipt(rc.id); return true; } catch (e) { toast(e.message, 'bad'); return e.message; }
      } });
    head = Object.assign(f.api.values, { po_id: head.po_id });
    if (po) f.api.set('po', `${po.number} · ${supName(po.supplier_id)}`);
    f.insertBefore(h('div', { class: 'stack', style: 'margin-top:12px' }, h('b', null, 'Líneas recibidas'), ed, info), f.querySelector('.form-actions'));
    body.append(card(po ? `Recibir ${po.number}` : 'Recepción sin OC (D-COM-02: camal y productores)', f));
    recalc();
  }
  function scrDocs(el) {
    const body = page(el, { code: 'COM-07', title: 'Comprobantes del proveedor', sub: 'Facturas, boletas, recibos por honorarios, notas y NTI de la granja. Únicos por proveedor, tipo, serie y número (RN-COM-05); el total cuadra con base + IGV + no gravado + otros (RN-COM-06).', actions: can('com.document.record') ? [{ label: 'Registrar comprobante', kind: 'primary', icon: '+', onClick: () => docForm() }] : [] });
    const rows = G.db.all('purchase_documents').sort(U.by('issue_date', -1));
    const noDoc = G.db.where('purchase_receipts', r => !r.document_id && r.status === 'POSTED' && !r.historical);
    const m = G.date.month(G.TODAY);
    body.append(kpis([{ label: 'Registrados en el mes', value: rows.filter(d => d.accounting_date >= m && d.status !== 'VOIDED').length, sub: F.money(U.sum(rows.filter(d => d.accounting_date >= m && d.status !== 'VOIDED'), d => pen(d, d.total))) }, { label: 'Observados (cruce)', value: rows.filter(d => d.match_status === 'OBSERVED').length, tone: 'warn', onClick: () => G.go('COM-08') }, { label: 'Recepciones sin comprobante', value: noDoc.length, tone: noDoc.length ? 'info' : '' }, { label: 'NTI de la granja (mes)', value: rows.filter(d => d.doc_type === 'INTERNAL_TRANSFER' && d.accounting_date >= m).length }]));
    if (noDoc.length) body.append(card('Recepciones esperando su comprobante', h('div', { class: 'row' }, noDoc.map(r => btn(`${r.number} · ${supName(r.supplier_id)} · ${F.money(r.total_cost)}`, () => docForm({ receipt_id: r.id }), { sm: true, disabled: !can('com.document.record') })))));
    body.append(table({ id: 'com07', columns: [
      { key: 'issue_date', label: 'Emisión', render: d => F.date(d.issue_date) }, { key: 'doc', label: 'Comprobante', value: d => docLabel(d), render: d => h('span', null, h('span', { class: 'mono' }, `${d.sunat_doc_type} ${docRef(d)}`), h('div', { class: 'muted small' }, pdocName(d.doc_type))) },
      { key: 'supplier_id', label: 'Proveedor', value: d => supName(d.supplier_id) }, { key: 'base_taxed', label: 'Base', align: 'r', render: d => moneyDoc(d, d.base_taxed || d.non_taxed) }, { key: 'igv', label: 'IGV', align: 'r', render: d => moneyDoc(d, d.igv) },
      { key: 'total', label: 'Total', align: 'r', value: d => pen(d, d.total), render: d => moneyDoc(d, d.total) }, { key: 'brand_id', label: 'Marca', value: d => d.brand_id ? G.brandName(d.brand_id) : '—' },
      { key: 'match_status', label: 'Cruce', render: d => st(d.match_status) }, { key: 'status', label: 'Estado', render: d => st(d.status) }], rows, onRow: d => openDoc(d.id),
      filters: [{ key: 'doc_type', label: 'Tipo', options: PDOC.map(x => [x[0], x[1]]) }, { key: 'match_status', label: 'Cruce', options: [['MATCHED', 'Cuadra'], ['OBSERVED', 'Observado'], ['APPROVED_DIFF', 'Diferencia aprobada'], ['NOT_CHECKED', 'Sin cruce']] }, { key: 'supplier_id', label: 'Proveedor', options: supOpts(s => rows.some(r => r.supplier_id === s.id)) }, { key: 'month', label: 'Mes', options: [['2026-09', 'Setiembre'], ['2026-10', 'Octubre']], value: d => d.accounting_date.slice(0, 7) }] }));
  }
  function scrMatch(el, params) {
    const body = page(el, { code: 'COM-08', title: 'Cruce de tres vías', sub: `OC ↔ recepción ↔ comprobante. Precio facturado vs OC con tolerancia ${F.pct(tol('com_price_tolerance_pct'), 0)} y cantidad facturada vs recibida (RN-COM-07). Lo observado va a la bandeja de la contadora (CNT-05).` });
    const docs = G.db.where('purchase_documents', d => d.receipt_id && d.status !== 'VOIDED').sort(U.by('issue_date', -1));
    const obs = docs.filter(d => d.match_status === 'OBSERVED');
    body.append(kpis([{ label: 'Comprobantes cruzados', value: docs.length }, { label: 'Cuadran', value: docs.filter(d => d.match_status === 'MATCHED').length, tone: 'ok' }, { label: 'Observados', value: obs.length, tone: obs.length ? 'warn' : 'ok' }, { label: 'Diferencias aprobadas', value: docs.filter(d => d.match_status === 'APPROVED_DIFF').length, tone: 'info' }]));
    const focus = params.id ? G.db.get('purchase_documents', params.id) : obs[0];
    if (focus) {
      const m = threeWayMatch(focus.id);
      const canApprove = G.canDo('COM', 'A') || G.can('cnt.entry.approve');
      const tblM = h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Línea', 'OC', 'Precio OC', 'Recibido', 'Facturado', 'Precio facturado', 'Dif. precio', 'Dif. cantidad', ''].map((x, i) => h('th', { class: i > 1 ? 'r' : '' }, x)))), h('tbody', null, m.rows.map(r => h('tr', null, h('td', null, r.description), h('td', { class: 'mono' }, r.po_number || 'Sin OC'), h('td', { class: 'r' }, r.po_price != null ? F.money(r.po_price) : F.money(r.rc_price)), h('td', { class: 'r' }, F.num(r.rec_qty, 3)), h('td', { class: 'r' }, F.num(r.inv_qty, 3)), h('td', { class: 'r' }, F.money(r.inv_price)), h('td', { class: 'r' }, badge((r.price_diff_pct > 0 ? '+' : '') + F.pct(r.price_diff_pct, 2), r.price_ok ? 'ok' : 'bad')), h('td', { class: 'r' }, badge(F.num(r.qty_diff, 3), r.qty_ok ? 'ok' : 'bad')), h('td', null, st(r.ok ? 'MATCHED' : 'OBSERVED')))))));
      let act;
      if (focus.match_status === 'OBSERVED') {
        const eff = U.sum(m.rows, r => (r.inv_price - (r.po_price ?? r.rc_price)) * r.inv_qty);
        const apForm = canApprove ? form({ id: 'apd', fields: [{ key: 'note', label: 'Motivo para aceptar la diferencia', type: 'textarea', required: true }], submitLabel: 'Aprobar diferencia', onSubmit: v => { try { approveMatch(focus.id, v.note); toast('Diferencia aprobada; el comprobante pasa a contabilidad', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } }, extraActions: [btn('Pedir nota de crédito al proveedor', () => { G.db.update('purchase_documents', focus.id, { notes: 'Se pidió nota de crédito al proveedor el ' + F.date(G.TODAY) }); toast('Anotado: se pidió nota de crédito al proveedor', 'ok'); })] }) : notice(`Tu rol (${G.roleName()}) no aprueba diferencias; lo hace la contadora o administración.`, 'info');
        act = h('div', { class: 'stack' }, notice(`Efecto: ${F.money(eff)} más que lo pactado. Si se aprueba, la diferencia ajusta el costo del lote o va al costo de ventas (RN-COM-10).`, 'warn'), apForm);
      } else act = notice(focus.match_status === 'APPROVED_DIFF' ? `Diferencia aprobada por ${G.userName(focus.match_approved_by)}: ${focus.match_note}` : 'Este comprobante cuadra con la OC y la recepción.', focus.match_status === 'APPROVED_DIFF' ? 'info' : 'ok');
      body.append(card(`${docLabel(focus)} · ${supName(focus.supplier_id)}`, h('div', { class: 'stack' }, tblM, act), { actions: [btn('Abrir comprobante', () => openDoc(focus.id), { sm: true, kind: 'ghost' })] }));
    }
    body.append(table({ id: 'com08', columns: [{ key: 'issue_date', label: 'Emisión', render: d => F.date(d.issue_date) }, { key: 'doc', label: 'Comprobante', value: d => docLabel(d) }, { key: 'supplier_id', label: 'Proveedor', value: d => supName(d.supplier_id) }, { key: 'po', label: 'OC', value: d => d.po_id ? (G.db.get('purchase_orders', d.po_id) || {}).number : 'Sin OC' }, { key: 'max', label: 'Mayor dif. de precio', align: 'r', value: d => Math.max(0, ...(d.match_detail || []).map(r => Math.abs(r.price_diff_pct))), render: d => F.pct(Math.max(0, ...(d.match_detail || []).map(r => Math.abs(r.price_diff_pct))), 2) }, { key: 'match_status', label: 'Cruce', render: d => st(d.match_status) }], rows: docs, onRow: d => G.go('COM-08', { id: d.id }), filters: [{ key: 'match_status', label: 'Cruce', options: [['MATCHED', 'Cuadra'], ['OBSERVED', 'Observado'], ['APPROVED_DIFF', 'Diferencia aprobada']] }] }));
  }
  function scrPayables(el) {
    const body = page(el, { code: 'COM-09', title: 'Cuentas por pagar', sub: 'Saldo por proveedor y comprobante, vencimientos y antigüedad. Programa los pagos de la semana. Las NTI de la granja no van aquí: se saldan en la cuenta de enlace interno (D-GRJ-02).' });
    const rows = payables();
    const tot = U.sum(rows, d => pen(d, d.balance));
    const byB = U.groupBy(rows, 'bucket');
    body.append(kpis(BUCKETS.map(([k, l]) => ({ label: l, value: F.money(U.sum(byB[k] || [], d => pen(d, d.balance))), sub: `${(byB[k] || []).length} comprobantes`, tone: k === 'NOT_DUE' ? '' : k === 'D0_30' ? 'warn' : 'bad' })).concat([{ label: 'Total por pagar', value: F.money(tot) }])));
    const bySup = Object.entries(U.groupBy(rows, 'supplier_id')).map(([sid, ds]) => ({ sid, total: U.sum(ds, d => pen(d, d.balance)), over: U.sum(ds.filter(d => d.bucket !== 'NOT_DUE'), d => pen(d, d.balance)) })).sort(U.by('total', -1));
    const sched = rows.filter(d => d.scheduled_pay_date).sort(U.by('scheduled_pay_date'));
    body.append(h('div', { class: 'grid c2' },
      card('Saldo por proveedor', bySup.length ? G.ui.chart.hbar({ items: bySup.slice(0, 8).map(x => ({ label: supName(x.sid), value: x.total, tone: x.over > 0 ? 'bad' : '' })), format: v => F.money(v, 0) }) : empty('Sin saldos.')),
      card('Pagos programados', sched.length ? h('div', { class: 'stack' }, sched.map(d => h('div', { class: 'row between' }, h('span', null, F.date(d.scheduled_pay_date)), h('span', null, supName(d.supplier_id)), h('span', { class: 'mono small' }, docRef(d)), h('b', null, F.money(pen(d, d.balance)))))) : empty('Sin pagos programados. Programa desde la ficha del comprobante.'), { actions: [btn('Pagar', () => payForm(), { sm: true, kind: 'primary', disabled: !can('com.payment.record') })] })));
    body.append(table({ id: 'com09', columns: [
      { key: 'supplier_id', label: 'Proveedor', value: d => supName(d.supplier_id) }, { key: 'doc', label: 'Comprobante', value: d => docLabel(d) }, { key: 'issue_date', label: 'Emisión', render: d => F.date(d.issue_date) },
      { key: 'due_date', label: 'Vence', render: d => F.date(d.due_date) }, { key: 'overdue_days', label: 'Días vencido', align: 'r', render: d => d.overdue_days > 0 ? badge(d.overdue_days + ' d', d.overdue_days > 30 ? 'bad' : 'warn') : '—' },
      { key: 'total', label: 'Total', align: 'r', render: d => moneyDoc(d, d.total) }, { key: 'balance', label: 'Saldo', align: 'r', value: d => pen(d, d.balance), render: d => h('b', null, moneyDoc(d, d.balance)) },
      { key: 'scheduled_pay_date', label: 'Programado', render: d => d.scheduled_pay_date ? F.date(d.scheduled_pay_date) : '—' }], rows: rows.sort(U.by('due_date')), onRow: d => openDoc(d.id),
      filters: [{ key: 'bucket', label: 'Antigüedad', options: BUCKETS }, { key: 'supplier_id', label: 'Proveedor', options: supOpts(s => rows.some(r => r.supplier_id === s.id)) }], footer: ['Total', '', '', '', '', '', { v: F.money(tot), align: 'r' }, ''] }));
  }
  function scrPayments(el) {
    const body = page(el, { code: 'COM-10', title: 'Pagos a proveedores', sub: 'Pago desde una cuenta bancaria o caja, con número de operación, aplicado a uno o varios comprobantes. Solo a la cuenta registrada del proveedor (RN-COM-13); nunca más que el saldo (RN-COM-08).', actions: can('com.payment.record') ? [{ label: 'Registrar pago', kind: 'primary', icon: '+', onClick: () => payForm() }] : [] });
    const rows = G.db.all('supplier_payments').sort(U.by('paid_at', -1));
    const m = G.date.month(G.TODAY);
    const kp = G.kpi('KPI-COM-04', monthRange(m));
    body.append(kpis([{ label: 'Pagado en el mes', value: F.money(U.sum(rows.filter(p => p.status === 'CONFIRMED' && p.paid_at >= m), p => p.amount)) }, { label: 'Pagos', value: rows.filter(p => p.paid_at >= m).length }, { label: 'Días de pago (KPI-COM-04)', value: kp ? F.num(kp.value, 1) + ' d' : '—' }, { label: 'Por banco BCP / Interbank', value: `${rows.filter(p => p.cash_account_id === 'ca-BCP-CTE' && p.paid_at >= m).length} / ${rows.filter(p => p.cash_account_id === 'ca-IBK-CTE' && p.paid_at >= m).length}` }]));
    const rates = detractionRates();
    body.append(card('Detracciones (D-COM-03)', h('div', { class: 'stack' },
      Object.keys(rates).length ? h('div', { class: 'row' }, Object.entries(rates).map(([k, v]) => badge(`${supTypeName(k)}: ${F.pct(v, 0)}`, 'info'))) : notice('Sin tasas cargadas: la contadora las confirma por tipo de servicio. Con una tasa cargada, el pago de un comprobante mayor a S/ 700 se divide en el depósito de detracción (Banco de la Nación) y el pago neto.', 'info'),
      (G.can('cnt.rule.manage') || G.ctx.role === 'GERENTE') ? form({ id: 'det', values: { type: 'SERVICES', rate: 12 }, fields: [{ key: 'type', label: 'Tipo de proveedor', type: 'select', options: SUP_TYPES.filter(x => ['SERVICES', 'DELIVERY_COMPANY', 'VEHICLE_RENTAL', 'OTHER'].includes(x[0])) }, { key: 'rate', label: 'Tasa %', type: 'number', min: 0, max: 15 }], submitLabel: 'Guardar tasa', onSubmit: v => { const r = Object.assign({}, rates); if (Number(v.rate) > 0) r[v.type] = Number(v.rate); else delete r[v.type]; G.setParam('com_detraction_rates', r, 'Tasa confirmada por la contadora (D-COM-03)'); toast('Tasa de detracción guardada', 'ok'); G.refresh(); return true; } }) : null)));
    body.append(table({ id: 'com10', columns: [
      { key: 'number', label: 'Pago', mono: true }, { key: 'paid_at', label: 'Fecha', render: p => F.datetime(p.paid_at) }, { key: 'supplier_id', label: 'Proveedor', value: p => supName(p.supplier_id) },
      { key: 'cash_account_id', label: 'Desde', value: p => (G.db.get('cash_accounts', p.cash_account_id) || {}).name }, { key: 'method', label: 'Medio', value: p => methodName(p.method) + (p.is_detraction ? ' · detracción' : '') },
      { key: 'reference', label: 'Operación', mono: true }, { key: 'docs', label: 'Aplicado a', value: p => G.db.where('supplier_payment_allocations', a => a.payment_id === p.id).map(a => docRef(G.db.get('purchase_documents', a.document_id))).join(', ') },
      { key: 'amount', label: 'Importe', align: 'r', render: p => F.money(p.amount) }, { key: 'status', label: 'Estado', render: p => st(p.status) }], rows,
      onRow: p => drawer('Pago ' + p.number, (b, close) => { if (p.status === 'CONFIRMED' && can('com.payment.record')) b.append(h('div', { class: 'row' }, btn('Revertir', () => promptReason('Revertir pago', r => { if (tryDo(() => reversePayment(p.id, r), 'Pago revertido')) close(); }), { sm: true, kind: 'danger' }))); b.append(dl([['Proveedor', supName(p.supplier_id)], ['Fecha', F.datetime(p.paid_at)], ['Desde', (G.db.get('cash_accounts', p.cash_account_id) || {}).name], ['Medio', methodName(p.method)], ['Cuenta destino', p.paid_to_account], ['Operación', p.reference], ['Importe', F.money(p.amount)], ['Registró', G.userName(p.registered_by)], ['Estado', st(p.status)], p.reverse_reason ? ['Motivo de reversión', p.reverse_reason] : null])); b.append(card('Aplicación', h('div', { class: 'stack' }, G.db.where('supplier_payment_allocations', a => a.payment_id === p.id).map(a => { const d = G.db.get('purchase_documents', a.document_id); return h('div', { class: 'row between' }, h('span', null, docLabel(d)), h('b', null, F.money(a.amount))); })))); }, { code: 'COM-10' }),
      filters: [{ key: 'cash_account_id', label: 'Cuenta', options: bankOpts() }, { key: 'status', label: 'Estado', options: [['CONFIRMED', 'Confirmado'], ['REVERSED', 'Revertido']] }] }));
  }
  function scrEvaluation(el) {
    const m = curMonth('ev');
    const body = page(el, { code: 'COM-11', title: 'Evaluación de proveedores', sub: 'Puntualidad (recibido hasta la fecha esperada), recepciones observadas por calidad, diferencias de peso contra la OC y de precio en el cruce, por mes.', actions: [monthPills('ev')] });
    const ev = evaluation(m);
    body.append(kpis([{ label: 'Proveedores evaluados', value: ev.length }, { label: 'Puntualidad promedio', value: F.pct(U.sum(ev.filter(x => x.punctuality != null), x => x.punctuality) / Math.max(1, ev.filter(x => x.punctuality != null).length), 0) }, { label: 'Líneas observadas', value: U.sum(ev, x => x.observed), tone: 'warn' }, { label: 'Comprobantes con diferencia de precio', value: U.sum(ev, x => x.price_obs), tone: 'warn' }]));
    body.append(table({ id: 'com11', columns: [
      { key: 'supplier_id', label: 'Proveedor', value: x => supName(x.supplier_id) }, { key: 'receipts', label: 'Recepciones', align: 'r' },
      { key: 'punctuality', label: 'Puntualidad', align: 'r', render: x => x.punctuality == null ? 'Sin OC' : badge(F.pct(x.punctuality, 0), x.punctuality >= 90 ? 'ok' : x.punctuality >= 70 ? 'warn' : 'bad') },
      { key: 'observed_pct', label: 'Observadas por calidad', align: 'r', render: x => `${x.observed} de ${x.lines} (${F.pct(x.observed_pct, 0)})` },
      { key: 'weight_diff_pct', label: 'Dif. de peso vs OC', align: 'r', render: x => F.pct(x.weight_diff_pct, 1) }, { key: 'price_obs_pct', label: 'Dif. de precio', align: 'r', render: x => `${x.price_obs} de ${x.docs}` },
      { key: 'score', label: 'Puntaje', align: 'r', render: x => h('b', null, F.num(x.score, 2)) }, { key: 'rating', label: 'Calificación', render: x => '★'.repeat(x.rating) + '☆'.repeat(5 - x.rating) }], rows: ev, onRow: x => openSupplier(x.supplier_id) }));
    if (G.canDo(MOD, 'E')) body.append(h('div', { class: 'row' }, btn('Actualizar calificaciones', () => { for (const x of ev) G.db.update('suppliers', x.supplier_id, { rating: x.rating }, { silent: true }); G.audit('EVALUAR', 'suppliers', 'mes ' + m, `${ev.length} calificaciones`); toast('Calificaciones actualizadas', 'ok'); G.refresh(); }, { kind: 'primary' })));
  }
  function scrBoard(el) {
    const m = curMonth('tb');
    const p = monthRange(m);
    const body = page(el, { code: 'COM-12', title: 'Tablero de compras', sub: 'KPI-COM-01 a KPI-COM-06 del mes, calculados con las recepciones, comprobantes y pagos registrados.', actions: [monthPills('tb')] });
    const K = c => G.kpi(c, p) || { value: null };
    const k1 = K('KPI-COM-01'), k2 = K('KPI-COM-02'), k3 = K('KPI-COM-03'), k4 = K('KPI-COM-04'), k5 = K('KPI-COM-05'), k6 = K('KPI-COM-06');
    body.append(kpis([
      { label: 'KPI-COM-01 · Costo por kg comprado', value: F.money(k1.value), sub: `${F.money(k1.numerator)} / ${F.kg(k1.denominator, 0)}` },
      { label: 'KPI-COM-02 · Observadas por calidad', value: F.pct(k2.value, 1), sub: `${k2.numerator} de ${k2.denominator} líneas`, tone: k2.value > 5 ? 'warn' : 'ok' },
      { label: 'KPI-COM-03 · Cumplimiento', value: F.pct(k3.value, 0), sub: `${k3.numerator} de ${k3.denominator} OC a tiempo`, tone: k3.value >= 90 ? 'ok' : 'warn' },
      { label: 'KPI-COM-04 · Días de pago', value: F.num(k4.value, 1) + ' d', sub: 'ponderado por importe' },
      { label: 'KPI-COM-05 · Participación de la granja', value: F.pct(k5.value, 1), sub: `${F.money(k5.numerator, 0)} de ${F.money(k5.denominator, 0)} en cárnicos` },
      { label: 'KPI-COM-06 · Por pagar vencido', value: F.money(k6.value), sub: `${k6.numerator} comprobantes`, tone: k6.value > 0 ? 'bad' : 'ok', onClick: () => G.go('COM-09') }]));
    const ls = recLinesIn(p).filter(l => l.accepted && l.weight_kg > 0);
    const byPair = Object.values(U.groupBy(ls, l => l.rc.supplier_id + '|' + l.variant_id)).map(g => ({ sup: g[0].rc.supplier_id, v: g[0].variant_id, kg: U.sum(g, l => l.weight_kg), cost: U.sum(g, l => l.total_cost) })).map(x => Object.assign(x, { per: x.kg ? x.cost / x.kg : 0 })).sort(U.by('cost', -1));
    const docs = G.db.where('purchase_documents', d => d.status !== 'VOIDED' && d.accounting_date >= p.from && d.accounting_date <= p.to);
    const byType = Object.entries(U.groupBy(docs, d => (sup(d.supplier_id) || {}).supplier_type)).map(([t, ds]) => ({ label: supTypeName(t), value: U.sum(ds, d => pen(d, d.base_taxed + d.non_taxed)) })).sort(U.by('value', -1));
    body.append(h('div', { class: 'grid c2' },
      card('Compras del mes por tipo de proveedor (sin IGV)', byType.length ? G.ui.chart.hbar({ items: byType, format: v => F.money(v, 0) }) : empty('Sin compras.')),
      card('Costo por kg por proveedor y producto (KPI-COM-01)', byPair.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Proveedor', 'Producto', 'kg', 'S/ por kg'].map((x, i) => h('th', { class: i > 1 ? 'r' : '' }, x)))), h('tbody', null, byPair.slice(0, 10).map(x => h('tr', null, h('td', null, supName(x.sup)), h('td', null, G.variantName(x.v)), h('td', { class: 'r' }, F.num(x.kg, 1)), h('td', { class: 'r' }, F.money(x.per))))))) : empty('Sin recepciones con peso.'), { flush: true })));
    const weeks = []; for (let d = p.from; d <= p.to; d = G.date.add(d, 7)) weeks.push(d);
    const recs = G.db.where('purchase_receipts', r => r.status === 'POSTED' && inRange(r.received_at, p));
    body.append(card('Recepciones valorizadas por semana', G.ui.chart.bar({ labels: weeks.map(w => F.date(w).slice(0, 5)), series: [{ name: 'Granja', values: weeks.map(w => U.sum(recs.filter(r => r.receipt_type !== 'PURCHASE' && dateOnly(r.received_at) >= w && dateOnly(r.received_at) < G.date.add(w, 7)), r => r.total_cost)) }, { name: 'Terceros', values: weeks.map(w => U.sum(recs.filter(r => r.receipt_type === 'PURCHASE' && dateOnly(r.received_at) >= w && dateOnly(r.received_at) < G.date.add(w, 7)), r => r.total_cost)) }], stacked: true, format: v => F.money(v, 0) })));
  }

  /* ---------- registro ---------- */
  G.com = { sunatLookup, checkSunat, createPO, submitPO, approvePO, approveOrder: approvePO, returnPO, voidPO, closePO, postReceipt, evalReceiptLine, registerDocument, threeWayMatch, approveMatch, voidDocument, registerPayment, payWithDetraction, reversePayment, payables, schedulePayment, evaluation, requestBankChange, approveBankChange, createRequisition, requisitionsToPOs, catalogPrice, updateCatalogPrice, openPO, openDoc, openReceipt, openSupplier, docLabel, poLines, rcLines, pdLines, isMeat, NOT_LOCATED_RUCS, _month: {} };
  const SC = G.SPEC.COM.screens;
  const nameOf = c => (SC.find(s => s[0] === c) || [c, c])[1];
  G.register({ code: 'COM', name: 'Compras y cuentas por pagar', phase: 2, group: 'Abastecimiento y contabilidad', screens: [
    { code: 'COM-01', name: nameOf('COM-01'), render: scrSuppliers }, { code: 'COM-02', name: nameOf('COM-02'), render: scrCatalog }, { code: 'COM-03', name: nameOf('COM-03'), render: scrRequisitions },
    { code: 'COM-04', name: nameOf('COM-04'), render: scrPOs }, { code: 'COM-05', name: nameOf('COM-05'), render: scrApprovals }, { code: 'COM-06', name: nameOf('COM-06'), render: scrReceipt },
    { code: 'COM-07', name: nameOf('COM-07'), render: scrDocs }, { code: 'COM-08', name: nameOf('COM-08'), render: scrMatch }, { code: 'COM-09', name: nameOf('COM-09'), render: scrPayables },
    { code: 'COM-10', name: nameOf('COM-10'), render: scrPayments }, { code: 'COM-11', name: nameOf('COM-11'), render: scrEvaluation }, { code: 'COM-12', name: nameOf('COM-12'), render: scrBoard }] });

  /* ---------- ganchos globales ---------- */
  G.alertProviders.push(() => {
    if (!G.canSee(MOD)) return [];
    const out = [];
    const pa = G.db.where('purchase_orders', p => p.status === 'PENDING_APPROVAL');
    if (pa.length) out.push({ module: MOD, title: `${pa.length} OC por aprobar`, detail: `${F.money(U.sum(pa, p => p.total))} en espera (RN-COM-01)`, tone: 'warn', go: () => G.go('COM-05') });
    const od = payables().filter(d => d.bucket !== 'NOT_DUE');
    if (od.length) out.push({ module: MOD, title: `${od.length} comprobantes de proveedor vencidos`, detail: F.money(U.sum(od, d => pen(d, d.balance))), tone: 'bad', go: () => G.go('COM-09') });
    const ob = G.db.where('purchase_documents', d => d.match_status === 'OBSERVED');
    if (ob.length) out.push({ module: MOD, title: `${ob.length} comprobante(s) observados en el cruce de tres vías`, detail: 'RN-COM-07 · bandeja de la contadora', tone: 'warn', go: () => G.go('COM-08') });
    return out;
  });
  G.searchProviders.push(q => {
    const s = q.toLowerCase(); const out = [];
    for (const x of G.db.all('suppliers')) if ((x.trade_name || '').toLowerCase().includes(s) || (x.legal_name || '').toLowerCase().includes(s) || (x.doc_number || '').includes(q)) out.push({ label: x.trade_name || x.legal_name, sub: `Proveedor · ${x.doc_type} ${x.doc_number}`, go: () => { G.go('COM-01'); openSupplier(x.id); } });
    for (const p of G.db.all('purchase_orders')) if (p.number.toLowerCase().includes(s)) out.push({ label: p.number, sub: `OC · ${supName(p.supplier_id)} · ${F.money(p.total)}`, go: () => { G.go('COM-04'); openPO(p.id); } });
    for (const d of G.db.all('purchase_documents')) if (`${d.series}-${d.number}`.toLowerCase().includes(s)) out.push({ label: docLabel(d), sub: `Comprobante de ${supName(d.supplier_id)}`, go: () => { G.go('COM-07'); openDoc(d.id); } });
    return out.slice(0, 8);
  });
  G.scanHandlers.push(code => {
    const p = G.db.find('purchase_orders', x => x.number === code); if (p) return () => { G.go('COM-04'); openPO(p.id); };
    const r = G.db.find('purchase_receipts', x => x.number === code); if (r) return () => { G.go('COM-06'); openReceipt(r.id); };
    return null;
  });

  /* =====================================================================
     Datos de ejemplo (setiembre y octubre): camal, productores, empaques,
     insumos, café verde, servicios, publicidad y creadores de contenido.
     ===================================================================== */
  G.seed(40, function seedCOM() {
    const r = U.rng(4040);
    const prevRole = G.ctx.role; G.ctx.role = 'GERENTE';
    try {
      const S = t => G.db.find('suppliers', x => x.trade_name && x.trade_name.startsWith(t));
      const camal = S('Camal'), avi = S('Avícola'), cord = S('Corderos'), porc = S('Porcinos'), cafe = S('Cafés'), emp = S('Empaques'), ins = S('Insumos'), frio = S('Frío'), exp = S('Express'), motos = S('Motos'), goog = S('Google'), meta = S('Meta'), vale = S('Vale'), renzo = S('Renzo');
      const U_COMPRAS = 'us-dflores', U_GER = 'us-rquispe', U_ADM = 'us-chuaman', U_ALM1 = 'us-mtorres', U_ALM2 = 'us-irojas', U_CONT = 'us-mcardenas', U_PRAC = 'us-khuerta';
      /* proveedores: cuenta bancaria, notas, uno no habido y un cambio de cuenta pendiente */
      const banks = { [camal.id]: ['BCP', '191-2045871-0-36'], [avi.id]: ['BBVA', '0011-0182-0100045291'], [cord.id]: ['BCP', '285-1098834-0-12'], [porc.id]: ['Interbank', '200-3004567811'], [cafe.id]: ['BCP', '355-2299871-0-48'], [emp.id]: ['Scotiabank', '000-7781234'], [ins.id]: ['BCP', '191-3301129-0-77'], [frio.id]: ['Interbank', '200-3007788123'], [exp.id]: ['BCP', '193-1187733-0-25'], [motos.id]: ['BCP', '191-9981100-0-05'], [vale.id]: ['BCP', '191-5524411-0-61'], [renzo.id]: ['Interbank', '898-3109987744'] };
      for (const [id, [b, a]] of Object.entries(banks)) G.db.update('suppliers', id, { bank_name: b, bank_account: a, sunat_checked_at: '2026-09-01T09:00', sunat_msg: 'Contribuyente ACTIVO · condición HABIDO' }, { silent: true });
      G.db.update('suppliers', camal.id, { notes: 'Compra directa sin OC (D-COM-02): se recibe con guía y factura.' }, { silent: true });
      const rucNH = U.rucCheck('2060998812'); NOT_LOCATED_RUCS.add(rucNH);
      const nh = G.db.insert('suppliers', { id: 'su-ELSOL', doc_type: 'RUC', doc_number: rucNH, legal_name: 'DISTRIBUIDORA CÁRNICA EL SOL EIRL', trade_name: 'Cárnica El Sol', supplier_type: 'PRODUCER', phone: '+5101' + '4390011', email: 'ventas@carnicaelsol.pe', status: 'ACTIVE', payment_terms_days: 7, related_company_id: null, sunat_status: 'NOT_LOCATED', sunat_checked_at: '2026-10-03T10:15', sunat_msg: 'Contribuyente activo · condición NO HABIDO', rating: 2, default_cost_center_id: 'cc-PROD-L1', bank_name: 'BCP', bank_account: '191-0098812-0-90', notes: 'Ofrece cerdo más barato; no se le compra mientras siga NO HABIDO (RN-COM-11).' }, { silent: true });
      /* catálogo */
      const CAT = [[camal, 'MP-CER-MR', 12.8, 'CAM-MR'], [camal, 'M2-LOM-KG', 58, 'CAM-LOM'], [camal, 'MP-HUE-KG', 3.2, 'CAM-HUE'], [porc, 'MP-CER-MR', 12.6, 'PS-MEDIA'], [nh, 'MP-CER-MR', 11.4, 'ES-CERDO'], [avi, 'DG-POL-ENT', 9.5, 'AV-POLLO'], [avi, 'DG-POL-PEC', 15.2, 'AV-PECH'], [avi, 'DG-GAL-ENT', 10.4, 'AV-GALL'],
        [cord, 'DG-COR-PIE', 31.5, 'CH-PIER'], [cord, 'DG-COR-COS', 33.5, 'CH-COST'], [cafe, 'IN-CAV-KG', 21, 'VR-VERDE'], [cafe, 'IN-AGU-KG', 7.5, 'VR-AGUAY'], [emp, 'EM-VAC-2030', 0.35, 'EP-V2030'], [emp, 'EM-BOL-NUM', 0.6, 'EP-BNUM'], [emp, 'EM-ISO-20', 9.5, 'EP-ISO20'], [emp, 'EM-GEL-500', 2.1, 'EP-GEL'], [emp, 'EM-FRA-250', 1.4, 'EP-FRA250'],
        [ins, 'IN-TRI-M', 38, 'IC-TRIPA'], [ins, 'IN-ESP-KG', 26, 'IC-ESPCH'], [ins, 'IN-SAL-KG', 1.2, 'IC-SAL'], [ins, 'IN-AZU-KG', 3.6, 'IC-AZU']];
      for (const [s, sku, price, code] of CAT) {
        const vid = 'va-' + sku; const b = basisOf(vid);
        G.db.insert('supplier_catalog', { id: `sc-${s.id}-${sku}`, supplier_id: s.id, variant_id: vid, supplier_sku: code, purchase_uom_id: b === 'KG' ? 'um-KGM' : 'um-NIU', price_basis: b, last_price: price, min_order_qty: b === 'KG' ? 20 : 100, lead_time_days: s === cafe ? 7 : s === emp ? 5 : 2, status: 'ACTIVE', price_history: [{ date: '2026-07-01', price: R(price * 0.96, 3), source: 'LISTA' }, { date: '2026-08-01', price: R(price * 0.98, 3), source: 'LISTA' }, { date: '2026-09-01', price, source: 'LISTA' }] }, { silent: true });
      }
      /* compras de setiembre y octubre */
      const HIST_UNTIL = '2026-10-05'; // antes de esta fecha: carga histórica (su stock ya se consumió; queda el lote para la trazabilidad)
      const tm = (d, hh) => d + 'T' + hh;
      const userWh = wh => (G.db.get('warehouses', wh) || {}).establishment_id === 'es-L2' ? U_ALM2 : U_ALM1;
      const docs = [];
      let invAvi = 7310, invCamal = 4571, invPorc = 2214, invCord = 880, invCafe = 1501, invEmp = 9930, invIns = 3307;
      /** compra completa: OC (opcional) → recepción → comprobante */
      function buy({ s, date, wh, lines, withPo = true, docSeries, docNo, recvDate, temp = 2.6, priceOver = null, receive = true, invoice = true, poStatus, creator = U_COMPRAS, vehTemp = 3.1, holdIdx = null }) {
        let po = null;
        if (withPo) {
          po = createPO({ supplier_id: s.id, warehouse_id: wh, order_date: G.date.add(date, -2), expected_date: date, lines: lines.map(l => ({ variant_id: 'va-' + l[0], qty: l[1], price_basis: basisOf('va-' + l[0]), unit_price: l[2] })) }, { user: creator, at: tm(G.date.add(date, -2), '10:15'), silent: true });
          submitPO(po.id, { user: creator, at: tm(G.date.add(date, -2), '10:20'), silent: true });
          if (G.db.get('purchase_orders', po.id).status === 'PENDING_APPROVAL') { if (poStatus === 'PENDING_APPROVAL') return { po }; approvePO(po.id, r() < 0.7 ? U_GER : U_ADM, { at: tm(G.date.add(date, -2), '15:40'), silent: true }); }
          if (!receive) return { po };
        }
        const rd = recvDate || date;
        const pls = po ? poLines(po.id) : [];
        const rlines = lines.map((l, i) => {
          const vid = 'va-' + l[0]; const v = G.variant(vid); const p = G.productOf(vid); const b = basisOf(vid);
          const kg = b === 'KG' ? R(l[1] * (0.985 + r() * 0.03), 1) : null;
          const units = v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? Math.round((kg || l[1]) / v.nominal_weight_kg) : v.sale_mode === 'KG' ? kg : l[1];
          const cold = ['CHILLED', 'FROZEN'].includes(p.storage);
          const t = cold ? (p.storage === 'FROZEN' ? -19.5 + r() : (holdIdx === i ? 5.2 : R(temp + (r() - 0.5), 1))) : null;
          return { po_line_id: po ? pls[i].id : null, variant_id: vid, qty: units, weight_kg: kg, temp_c: t, supplier_lot_code: (s.trade_name || 'X').slice(0, 2).toUpperCase() + rd.replace(/-/g, '').slice(2) + '-' + (i + 1), decision: holdIdx === i ? 'QUALITY_HOLD' : 'ACCEPT', unit_price: l[2] };
        });
        const rc = postReceipt({ po_id: po ? po.id : null, supplier_id: s.id, warehouse_id: wh, received_at: tm(rd, U.pad(7 + Math.floor(r() * 4), 2) + ':' + U.pad(Math.floor(r() * 50), 2)), vehicle_temp_c: vehTemp, carrier_guide: 'EG07-' + (1000 + Math.floor(r() * 8000)), scale: (G.db.get('warehouses', wh) || {}).establishment_id === 'es-L2' ? 'BAL-L2-01' : 'BAL-L1-01', inspection: 'OK', lines: rlines }, { system: true, user: userWh(wh), historical: rd < HIST_UNTIL, silent: true });
        if (!invoice) return { po, rc };
        const rls = rcLines(rc.id).filter(x => x.accepted);
        const d = registerDocument({ supplier_id: s.id, doc_type: 'INVOICE', series: docSeries, number: String(docNo), issue_date: rd, accounting_date: rd, receipt_id: rc.id, brand_id: null, lines: rls.map((x, i) => ({ receipt_line_id: x.id, variant_id: x.variant_id, description: G.variantName(x.variant_id), qty: x.price_basis === 'KG' ? x.weight_kg : x.qty, unit_price: priceOver && priceOver[i] ? priceOver[i] : x.unit_cost })) }, { system: true, user: r() < 0.5 ? U_PRAC : U_COMPRAS, at: tm(rd, '17:30'), silent: true });
        docs.push(d);
        return { po, rc, d };
      }
      const days = []; for (let d = '2026-09-01'; d <= G.TODAY; d = G.date.add(d, 1)) days.push(d);
      const dow = d => G.date.parse(d).getUTCDay();
      for (const d of days) {
        const w = dow(d);
        // Avícola Los Andes: martes y viernes con OC (pollo, gallina y pechuga)
        if ((w === 2 || w === 5) && d <= '2026-10-09') {
          const kgP = 100 + Math.floor(r() * 41);
          const ls = [['DG-POL-ENT', kgP, 9.5]]; if (w === 5) ls.push(['DG-GAL-ENT', 20 + Math.floor(r() * 15), 10.4]); if (r() < 0.5) ls.push(['DG-POL-PEC', 15 + Math.floor(r() * 10), 15.2]);
          const special = d === '2026-10-06' ? { priceOver: [9.8] } : d === '2026-10-09' ? { holdIdx: 0 } : {};
          buy(Object.assign({ s: avi, date: d, wh: 'wh-CAM-L1', lines: ls, docSeries: 'F002', docNo: invAvi++ }, special));
        }
        // Camal San Pedro: lunes y jueves, sin OC (D-COM-02)
        if ((w === 1 || w === 4) && d <= '2026-10-09') {
          const ls = [['MP-CER-MR', 180 + Math.floor(r() * 81), 12.8]]; if (w === 4) ls.push(['M2-LOM-KG', 15 + Math.floor(r() * 10), 58]); if (r() < 0.4) ls.push(['MP-HUE-KG', 30 + Math.floor(r() * 20), 3.2]);
          buy({ s: camal, date: d, wh: 'wh-CAM-L2', lines: ls, withPo: false, docSeries: 'F001', docNo: invCamal++ });
        }
        // Porcinos del Sur: miércoles con OC (supera el umbral: la aprueba gerencia)
        if (w === 3 && d <= '2026-10-07') buy({ s: porc, date: d, wh: 'wh-CAM-L2', lines: [['MP-CER-MR', 150 + Math.floor(r() * 51), 12.6]], docSeries: 'F003', docNo: invPorc++ });
      }
      // Corderos de Huancavelica (quincenal)
      for (const d of ['2026-09-04', '2026-09-18', '2026-10-02']) buy({ s: cord, date: d, wh: 'wh-CAM-L1', lines: [['DG-COR-PIE', 40, 31.5], ['DG-COR-COS', 25, 33.5]], docSeries: 'E001', docNo: invCord++ });
      // café verde y aguaymanto (Villa Rica)
      buy({ s: cafe, date: '2026-09-08', wh: 'wh-ALM-L2', lines: [['IN-CAV-KG', 120, 21]], docSeries: 'F001', docNo: invCafe++ });
      buy({ s: cafe, date: '2026-09-15', wh: 'wh-CAM-L2', lines: [['IN-AGU-KG', 80, 7.5]], docSeries: 'F001', docNo: invCafe++ });
      buy({ s: cafe, date: '2026-10-02', wh: 'wh-CAM-L2', lines: [['IN-AGU-KG', 80, 7.5]], docSeries: 'F001', docNo: invCafe++ });
      buy({ s: cafe, date: '2026-10-07', wh: 'wh-ALM-L2', lines: [['IN-CAV-KG', 120, 21]], docSeries: 'F001', docNo: invCafe++ });
      // empaques e insumos
      buy({ s: emp, date: '2026-09-03', wh: 'wh-ALM-L1', lines: [['EM-VAC-2030', 3000, 0.35], ['EM-BOL-NUM', 2000, 0.6], ['EM-ISO-20', 40, 9.5], ['EM-GEL-500', 200, 2.1], ['EM-FRA-250', 1000, 1.4]], docSeries: 'F004', docNo: invEmp++ });
      buy({ s: emp, date: '2026-10-01', wh: 'wh-ALM-L1', lines: [['EM-VAC-2030', 3000, 0.35], ['EM-BOL-NUM', 2000, 0.6], ['EM-GEL-500', 200, 2.1]], docSeries: 'F004', docNo: invEmp++ });
      buy({ s: ins, date: '2026-09-10', wh: 'wh-ALM-L2', lines: [['IN-TRI-M', 20, 38], ['IN-ESP-KG', 15, 26], ['IN-SAL-KG', 50, 1.2], ['IN-AZU-KG', 60, 3.6]], docSeries: 'F001', docNo: invIns++ });
      buy({ s: ins, date: '2026-10-06', wh: 'wh-ALM-L2', lines: [['IN-TRI-M', 20, 38], ['IN-ESP-KG', 15, 26], ['IN-AZU-KG', 60, 3.6]], docSeries: 'F001', docNo: invIns++ });
      // OC abiertas de hoy: aprobada por recibir, pendiente de aprobación, parcial y borrador
      buy({ s: avi, date: G.TODAY, wh: 'wh-CAM-L1', lines: [['DG-POL-ENT', 120, 9.5], ['DG-GAL-ENT', 30, 10.4]], receive: false });
      buy({ s: cord, date: '2026-10-13', wh: 'wh-CAM-L1', lines: [['DG-COR-PIE', 42, 31.5], ['DG-COR-COS', 30, 33.5]], poStatus: 'PENDING_APPROVAL' });
      const part = createPO({ supplier_id: porc.id, warehouse_id: 'wh-CAM-L2', order_date: '2026-10-08', expected_date: '2026-10-09', lines: [{ variant_id: 'va-MP-CER-MR', qty: 160, price_basis: 'KG', unit_price: 12.6 }, { variant_id: 'va-MP-HUE-KG', qty: 40, price_basis: 'KG', unit_price: 3.0 }] }, { user: U_COMPRAS, at: '2026-10-08T09:30', silent: true });
      submitPO(part.id, { user: U_COMPRAS, at: '2026-10-08T09:31', silent: true }); approvePO(part.id, U_ADM, { at: '2026-10-08T12:10', silent: true });
      const pl0 = poLines(part.id)[0];
      const prc = postReceipt({ po_id: part.id, warehouse_id: 'wh-CAM-L2', received_at: '2026-10-09T08:20', vehicle_temp_c: 3.4, carrier_guide: 'EG07-5521', scale: 'BAL-L2-01', inspection: 'OK', lines: [{ po_line_id: pl0.id, qty: 4, weight_kg: 158.6, temp_c: 2.9, supplier_lot_code: 'PS261009-1', decision: 'ACCEPT' }] }, { system: true, user: U_ALM2, silent: true });
      const pd = registerDocument({ supplier_id: porc.id, doc_type: 'INVOICE', series: 'F003', number: String(invPorc++), issue_date: '2026-10-09', receipt_id: prc.id, lines: rcLines(prc.id).map(x => ({ receipt_line_id: x.id, variant_id: x.variant_id, description: G.variantName(x.variant_id), qty: x.weight_kg, unit_price: x.unit_cost })) }, { system: true, user: U_COMPRAS, at: '2026-10-09T17:00', silent: true }); docs.push(pd);
      createPO({ supplier_id: emp.id, warehouse_id: 'wh-ALM-L1', order_date: G.TODAY, expected_date: '2026-10-15', lines: [{ variant_id: 'va-EM-ISO-20', qty: 60, price_basis: 'UNIT', unit_price: 9.5 }, { variant_id: 'va-EM-FRA-250', qty: 1500, price_basis: 'UNIT', unit_price: 1.4 }] }, { user: U_COMPRAS, at: G.TODAY + 'T08:40', silent: true });
      // servicios, publicidad y creadores de contenido (sin recepción)
      const svc = (s, type, series, no, date, base, opts = {}) => { const total = opts.currency ? base : (IGV_TYPES.includes(type) ? R(base * 1.18) : base); const d = registerDocument(Object.assign({ supplier_id: s.id, doc_type: type, series, number: String(no), issue_date: date, accounting_date: date, base_taxed: IGV_TYPES.includes(type) && !opts.currency ? base : 0, igv: IGV_TYPES.includes(type) && !opts.currency ? R(base * 0.18) : 0, non_taxed: IGV_TYPES.includes(type) && !opts.currency ? 0 : base, total, lines: [{ description: opts.desc, qty: 1, unit_price: base }] }, opts), { system: true, user: U_PRAC, at: tm(date, '16:00'), silent: true }); docs.push(d); return d; };
      svc(frio, 'INVOICE', 'F001', 2231, '2026-09-30', 850, { desc: 'Mantenimiento preventivo de cámaras de frío · setiembre', brand_id: null, cost_center_id: 'cc-ADM' });
      svc(exp, 'INVOICE', 'F002', 6612, '2026-09-30', 3400, { desc: 'Servicio de delivery tercerizado · setiembre', brand_id: 'br-DG', cost_center_id: 'cc-DEL' });
      svc(motos, 'INVOICE', 'F001', 778, '2026-09-30', 1350, { desc: 'Alquiler de moto MTC-789 · 30 días', brand_id: 'br-DG', cost_center_id: 'cc-DEL' });
      svc(goog, 'OTHER', 'GADS', 5512093, '2026-09-30', 420, { desc: 'Google Ads · setiembre', brand_id: 'br-DG', cost_center_id: 'cc-MKT-DG', currency: 'USD', exchange_rate: 3.745 });
      svc(meta, 'OTHER', 'FBADS', 88120071, '2026-09-30', 610, { desc: 'Meta Ads · setiembre', brand_id: 'br-DG', cost_center_id: 'cc-MKT-DG', currency: 'USD', exchange_rate: 3.745 });
      svc(vale, 'FEE_RECEIPT', 'E001', 45, '2026-09-25', 1200, { desc: 'Videos de recetas con cuy (4 piezas) · campaña setiembre', brand_id: 'br-DG', cost_center_id: 'cc-MKT-DG' });
      svc(renzo, 'FEE_RECEIPT', 'E001', 112, '2026-10-03', 900, { desc: 'Contenido parrillero Marca 2 (3 reels)', brand_id: 'br-M2', cost_center_id: 'cc-MKT-M2' });
      svc(exp, 'INVOICE', 'F002', 6730, '2026-10-08', 980, { desc: 'Delivery tercerizado · 1–7 octubre', brand_id: 'br-DG', cost_center_id: 'cc-DEL' });
      // pagos: lo de setiembre casi todo pagado; quedan facturas del camal vencidas y una pagada en parte
      const payDoc = (d, date, amount, acc = 'ca-BCP-CTE') => { const noBank = !sup(d.supplier_id).bank_account; return registerPayment({ supplier_id: d.supplier_id, cash_account_id: acc, method: noBank ? 'OTHER' : 'TRANSFER', paid_at: date + 'T11:' + U.pad(10 + Math.floor(r() * 40), 2), reference: noBank ? 'Cargo tarjeta corporativa ' + (5100 + Math.floor(r() * 800)) : 'OP' + (40000000 + Math.floor(r() * 9999999)), allocations: [{ document_id: d.id, amount }] }, { system: true, user: U_ADM, silent: true }); };
      const camalDocs = docs.filter(d => d.supplier_id === camal.id).sort(U.by('issue_date'));
      const leaveOpen = new Set(camalDocs.filter(d => d.issue_date >= '2026-09-14' && d.issue_date <= '2026-09-21').map(d => d.id));
      let partialDone = false;
      for (const d0 of docs) {
        const d = G.db.get('purchase_documents', d0.id);
        if (!d || d.doc_type === 'INTERNAL_TRANSFER' || d.status === 'OBSERVED') continue;
        const due = d.due_date || d.issue_date;
        if (leaveOpen.has(d.id)) { if (!partialDone) { payDoc(d, G.date.add(due, 2), R(Math.floor(d.total * 0.6))); partialDone = true; } continue; }
        if (due <= '2026-10-08') { const acc = (sup(d.supplier_id).bank_name === 'Interbank' || r() < 0.25) ? 'ca-IBK-CTE' : 'ca-BCP-CTE'; const pd2 = G.date.add(due, -Math.floor(r() * 2)); payDoc(d, pd2 < d.issue_date ? d.issue_date : pd2 > '2026-10-09' ? '2026-10-09' : pd2, d.total, acc); }
      }
      // programación de pagos de la próxima semana
      for (const d of G.db.where('purchase_documents', x => isOpenDoc(x) && x.due_date && x.due_date >= G.TODAY && x.due_date <= '2026-10-16')) G.db.update('purchase_documents', d.id, { scheduled_pay_date: d.due_date }, { silent: true });
      // cambio de cuenta solicitado por compras, pendiente de GERENTE (RN-COM-13)
      G.db.update('suppliers', emp.id, { pending_bank_change: { account: '0011-0661-0200078812', reason: 'El proveedor envió carta con nueva cuenta BBVA', requested_by: U_COMPRAS, requested_at: '2026-10-08T16:20' } }, { silent: true });
      // requerimientos pendientes (plan de producción y almacén)
      createRequisition({ source: 'PRO-03', source_ref: 'Plan semana 42', warehouse_id: 'wh-ALM-L2', variant_id: 'va-IN-CAV-KG', qty: 60, needed_date: '2026-10-14', notes: 'Tostado de café Marca 5' }, { user: 'us-olazo', at: '2026-10-09T15:00', silent: true });
      createRequisition({ source: 'PRO-03', source_ref: 'Plan semana 42', warehouse_id: 'wh-ALM-L2', variant_id: 'va-IN-TRI-M', qty: 10, needed_date: '2026-10-12', notes: 'Chorizo parrillero y huachana' }, { user: 'us-olazo', at: '2026-10-09T15:02', silent: true });
      createRequisition({ source: 'PRO-03', source_ref: 'Plan semana 42', warehouse_id: 'wh-ALM-L2', variant_id: 'va-IN-ESP-KG', qty: 8, needed_date: '2026-10-12' }, { user: 'us-olazo', at: '2026-10-09T15:03', silent: true });
      createRequisition({ source: 'WAREHOUSE', warehouse_id: 'wh-ALM-L1', variant_id: 'va-EM-VAC-2030', qty: 2000, needed_date: G.TODAY, notes: 'Bajo el stock mínimo' }, { user: U_ALM1, at: G.TODAY + 'T07:30', silent: true });
      createRequisition({ source: 'PRO-03', source_ref: 'Plan semana 42', warehouse_id: 'wh-CAM-L2', variant_id: 'va-IN-AGU-KG', qty: 50, needed_date: '2026-10-13', notes: 'Mermelada de aguaymanto' }, { user: 'us-olazo', at: '2026-10-09T15:05', silent: true });
      const old = createRequisition({ source: 'WAREHOUSE', warehouse_id: 'wh-ALM-L1', variant_id: 'va-EM-BOL-NUM', qty: 2000, needed_date: '2026-09-29' }, { user: U_ALM1, at: '2026-09-27T09:00', silent: true });
      G.db.update('purchase_requisitions', old.id, { status: 'ORDERED', po_id: (G.db.find('purchase_orders', p => p.supplier_id === emp.id && p.order_date >= '2026-09-29') || {}).id || null }, { silent: true });
    } finally { G.ctx.role = prevRole; }
  }, 'COM compras');

  /* =====================================================================
     Pruebas funcionales: una por criterio CA-COM-…
     ===================================================================== */
  const asRole = async (role, fn) => { const prev = G.ctx.role; G.ctx.role = role; try { return await fn(); } finally { G.ctx.role = prev; } };
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (!String(e.message).startsWith(code)) throw new Error(`Se esperaba ${code} y salió: ${e.message}`); return e; } throw new Error(`Se esperaba el rechazo ${code} y no ocurrió.`); };
  const avi = () => G.db.find('suppliers', x => (x.trade_name || '').startsWith('Avícola'));
  const newPollo = (kg = 120, price = 9.5) => createPO({ supplier_id: avi().id, warehouse_id: 'wh-CAM-L1', expected_date: G.TODAY, lines: [{ variant_id: 'va-DG-POL-ENT', qty: kg, price_basis: 'KG', unit_price: price }] });
  G.tests.push({ module: MOD, name: 'CA-COM-01: OC de 120 kg × S/ 9,50 + IGV = S/ 1 345,20 se aprueba sola; una de S/ 2 500 de COMPRAS queda pendiente y no la aprueba quien la creó', fn: async () => {
    const po = newPollo(); if (po.total !== 1345.2) throw new Error('Total esperado 1 345,20 y salió ' + po.total);
    const p2 = submitPO(po.id); if (p2.status !== 'APPROVED') throw new Error('Debía aprobarse sola y quedó ' + p2.status);
    await asRole('COMPRAS', () => {
      const big = createPO({ supplier_id: G.db.find('suppliers', x => (x.trade_name || '').startsWith('Corderos')).id, warehouse_id: 'wh-CAM-L1', lines: [{ variant_id: 'va-DG-COR-PIE', qty: 2500 / 1.18 / 31.25, price_basis: 'KG', unit_price: 31.25 }] });
      const s2 = submitPO(big.id); if (s2.status !== 'PENDING_APPROVAL') throw new Error('Una OC de ' + big.total + ' debía quedar pendiente');
      if (Math.abs(big.total - 2500) > 0.05) throw new Error('Total de la OC grande: ' + big.total);
      expectFail(() => approvePO(big.id), 'RN-COM-01');
      G.ctx.role = 'GERENTE'; approvePO(big.id); if (G.db.get('purchase_orders', big.id).status !== 'APPROVED') throw new Error('GERENTE no pudo aprobar');
    });
  } });
  G.tests.push({ module: MOD, name: 'CA-COM-02: recepción de 120,0 kg de pollo a 2,5 °C se acepta; una línea a 7,0 °C sin decisión se rechaza con RN-COM-02', fn: async () => {
    const po = newPollo(); submitPO(po.id); const pl = poLines(po.id)[0];
    const rc = postReceipt({ po_id: po.id, received_at: G.TODAY + 'T09:00', lines: [{ po_line_id: pl.id, qty: 55, weight_kg: 120, temp_c: 2.5 }] });
    const l = rcLines(rc.id)[0]; if (!l.accepted || l.quality_hold) throw new Error('La línea a 2,5 °C debía aceptarse');
    const po2 = newPollo(); submitPO(po2.id); const pl2 = poLines(po2.id)[0];
    expectFail(() => postReceipt({ po_id: po2.id, lines: [{ po_line_id: pl2.id, qty: 55, weight_kg: 120, temp_c: 7.0 }] }), 'RN-COM-02');
    const rc2 = postReceipt({ po_id: po2.id, lines: [{ po_line_id: pl2.id, qty: 55, weight_kg: 120, temp_c: 7.0, decision: 'QUALITY_HOLD' }] });
    const lot = G.db.get('lots', rcLines(rc2.id)[0].lot_id); if (lot.qc_status !== 'QUARANTINE') throw new Error('Con decisión de calidad el lote debía quedar en cuarentena');
  } });
  G.tests.push({ module: MOD, name: 'CA-COM-03: la factura F001-4581 del camal ya registrada se rechaza con RN-COM-05', fn: async () => {
    const camal = G.db.find('suppliers', x => x.supplier_type === 'SLAUGHTERHOUSE');
    if (!G.db.find('purchase_documents', d => d.supplier_id === camal.id && d.series === 'F001' && d.number === '4581')) throw new Error('El seed debía tener la F001-4581 del camal');
    expectFail(() => registerDocument({ supplier_id: camal.id, doc_type: 'INVOICE', series: 'F001', number: '00004581', issue_date: G.TODAY, base_taxed: 100, igv: 18, total: 118 }), 'RN-COM-05');
  } });
  G.tests.push({ module: MOD, name: 'CA-COM-04: a una factura de S/ 1 345,20 con S/ 1 000,00 pagados, un pago de S/ 400,00 se rechaza con RN-COM-08 y el saldo sigue en S/ 345,20', fn: async () => {
    const s = avi();
    const d = registerDocument({ supplier_id: s.id, doc_type: 'INVOICE', series: 'F002', number: '99001', issue_date: G.TODAY, base_taxed: 1140, igv: 205.2, total: 1345.2 });
    registerPayment({ supplier_id: s.id, cash_account_id: 'ca-BCP-CTE', method: 'TRANSFER', reference: 'OP1', allocations: [{ document_id: d.id, amount: 1000 }] });
    expectFail(() => registerPayment({ supplier_id: s.id, cash_account_id: 'ca-BCP-CTE', method: 'TRANSFER', reference: 'OP2', allocations: [{ document_id: d.id, amount: 400 }] }), 'RN-COM-08');
    const bal = G.db.get('purchase_documents', d.id).balance; if (bal !== 345.2) throw new Error('Saldo esperado 345,20 y quedó ' + bal);
  } });
  G.tests.push({ module: MOD, name: 'CA-COM-05: factura a S/ 9,80 por kg frente a S/ 9,50 de la OC (+3,16 %) queda observada y va a la bandeja de la contadora (RN-COM-07)', fn: async () => {
    const po = newPollo(); submitPO(po.id); const pl = poLines(po.id)[0];
    const rc = postReceipt({ po_id: po.id, lines: [{ po_line_id: pl.id, qty: 55, weight_kg: 120, temp_c: 2.5 }] });
    const rl = rcLines(rc.id)[0];
    const d = registerDocument({ supplier_id: avi().id, doc_type: 'INVOICE', series: 'F002', number: '99002', issue_date: G.TODAY, receipt_id: rc.id, lines: [{ receipt_line_id: rl.id, variant_id: rl.variant_id, description: 'Pollo', qty: 120, unit_price: 9.8 }] });
    if (d.match_status !== 'OBSERVED') throw new Error('Debía quedar observado y quedó ' + d.match_status);
    const diff = threeWayMatch(d.id).rows[0].price_diff_pct; if (diff !== 3.16) throw new Error('Diferencia esperada +3,16 % y salió ' + diff);
    if (!G.db.find('accountant_inbox_items', x => x.source_id === d.id && x.reason === 'PO_MISMATCH' && x.status === 'PENDING')) throw new Error('No llegó a la bandeja de la contadora');
  } });
  G.tests.push({ module: MOD, name: 'CA-COM-06: recepción de 120,0 kg con costo S/ 1 140,00 → S/ 9,50 por kg y el lote con ese costo unitario', fn: async () => {
    const po = newPollo(); submitPO(po.id); const pl = poLines(po.id)[0];
    const rc = postReceipt({ po_id: po.id, lines: [{ po_line_id: pl.id, qty: 55, weight_kg: 120, temp_c: 2.4 }] });
    const l = rcLines(rc.id)[0];
    if (l.total_cost !== 1140) throw new Error('Costo total esperado 1 140,00 y salió ' + l.total_cost);
    if (R(l.total_cost / l.weight_kg) !== 9.5) throw new Error('Costo por kg distinto de 9,50');
    const lot = G.db.get('lots', l.lot_id); if (!lot || lot.unit_cost !== 9.5) throw new Error('El lote debía quedar con costo unitario 9,50 y tiene ' + (lot && lot.unit_cost));
    if (G.inv.qty('va-DG-POL-ENT', 'wh-CAM-L1') <= 0) throw new Error('No entró stock');
  } });
})();
