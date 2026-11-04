/* =====================================================================
   B2B · Clientes empresariales (fase 3) · B2B-01 … B2B-17
   Crédito con límite, plazo, gracia y bloqueo automático por vencido;
   excepciones aprobadas por un tercero; precios por cliente (respetados
   por G.price.of) con aprobación bajo margen; pedidos recurrentes con
   corridas idempotentes; estado de cuenta, cartera por antigüedad,
   recordatorios y promesas; reclamos; y el portal del cliente
   (B2B-12 … B2B-17) filtrado siempre por G.ctx.portalCustomer.
   Expone G.b2b (PED llama G.b2b.assertCredit / G.b2b.confirm al confirmar).
   ===================================================================== */
(function () {
  const { h, btn, badge, status, page, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs: uiTabs, pills, chart } = G.ui;

  /* pestañas como hijo de una grilla: min-width 0 para que su tabla haga scroll propio y no desborde a 390 px */
  const tabs = (...a) => { const t = uiTabs(...a); t.style.minWidth = '0'; return t; };
  const U = G.util, F = G.fmt, D = G.db;
  const R = (n, d = 2) => U.round(n, d);
  const T = { prof: 'customer_credit_profiles', exc: 'credit_exceptions', price: 'customer_prices', ro: 'recurring_orders', rol: 'recurring_order_lines', run: 'recurring_order_runs', acc: 'b2b_portal_accounts', claim: 'b2b_claims', rem: 'collection_reminders', prom: 'payment_promises' };
  const P = k => G.param(k);
  const num = (v, d = 0) => F.num(v, d);
  const err = e => toast(e && e.message ? e.message : String(e), 'bad');
  const tryDo = (fn, ok) => { try { const r = fn(); if (ok) toast(ok, 'ok'); G.refresh(); return r; } catch (e) { err(e); return null; } };
  const B2B_TYPES = ['RESTAURANT', 'BUSINESS', 'CONSIGNMENT_POINT'];
  const CTYPE = { RESTAURANT: 'Restaurante', BUSINESS: 'Negocio', CONSIGNMENT_POINT: 'Punto de consignación' };
  const CLAIM = { QUALITY: 'Calidad', WEIGHT: 'Peso', MISSING: 'Faltante', WRONG_PRODUCT: 'Producto equivocado', LATE: 'Entrega tardía', BILLING: 'Facturación', OTHER: 'Otro' };
  const RESOL = { CREDIT_NOTE: 'Nota de crédito', REPLACEMENT: 'Reposición', NO_ACTION: 'Sin acción', OTHER: 'Otra' };
  const REM = { BEFORE_DUE: 'Antes del vencimiento', DUE_DAY: 'Día del vencimiento', OVERDUE_3: '3 días vencido', OVERDUE_7: '7 días vencido', BLOCK_NOTICE: 'Aviso de bloqueo' };
  const RUN = { CREATED: ['Creado', 'info'], CONFIRMED: ['Confirmado', 'ok'], SKIPPED: ['Omitido', ''], BLOCKED_CREDIT: ['Bloqueado por crédito', 'bad'], FAILED: ['Fallido', 'bad'] };
  const PROLE = { OWNER: 'Dueño', BUYER: 'Comprador', ACCOUNTING: 'Contabilidad' };
  const WD = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const isoDow = d => { const w = G.date.parse(d).getUTCDay(); return w === 0 ? 7 : w; };
  const addHours = (iso, hrs) => { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), +(iso.slice(11, 13) || 0), +(iso.slice(14, 16) || 0))); d.setUTCHours(d.getUTCHours() + hrs); return d.toISOString().slice(0, 16); };
  const hoursBetween = (a, b) => { const p = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +(s.slice(11, 13) || 0), +(s.slice(14, 16) || 0)); return (p(b) - p(a)) / 3600000; };

  /* =================================================================
     Dominio
     ================================================================= */
  const B = G.b2b = {};
  B.profile = cid => D.find(T.prof, p => p.customer_id === cid);
  B.customers = () => D.where('customers', c => B2B_TYPES.includes(c.customer_type));
  const openDoc = d => d.payment_terms === 'CREDIT' && d.status !== 'VOIDED' && !['CREDIT_NOTE', 'INTERNAL_NOTE'].includes(d.doc_type) && (d.balance || 0) > 0.009;
  /** comprobantes a crédito con saldo (vista b2b_receivables_v) */
  B.openDocs = cid => D.where('sales_documents', d => d.customer_id === cid && openDoc(d));
  B.balance = cid => R(U.sum(B.openDocs(cid), d => d.balance));
  B.unbilled = (cid, exceptId) => { const billed = new Set(D.where('sales_documents', d => d.customer_id === cid && d.order_id).map(d => d.order_id)); return R(U.sum(D.where('sales_orders', o => o.customer_id === cid && o.id !== exceptId && o.payment_method_id === 'pm-CREDIT' && ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED'].includes(o.status) && !billed.has(o.id)), o => o.final_total ?? o.estimated_total)); };
  B.exposure = (cid, exceptId) => R(B.balance(cid) + B.unbilled(cid, exceptId));
  /** función customer_overdue_days */
  B.overdueDays = (cid, date = G.TODAY) => B.openDocs(cid).reduce((m, d) => d.due_date && d.due_date < date ? Math.max(m, G.date.diff(date, d.due_date)) : m, 0);
  B.overdueAmount = (cid, date = G.TODAY) => R(U.sum(B.openDocs(cid).filter(d => d.due_date && d.due_date < date), d => d.balance));
  B.available = cid => { const p = B.profile(cid); return p ? R(p.credit_limit - B.exposure(cid)) : 0; };
  B.graceOf = p => p && p.grace_days != null ? p.grace_days : (P('b2b_grace_days') ?? 5);
  /** RN-B2B-03: bloqueado por vencido más allá de la gracia (o bloqueo manual) */
  B.isBlocked = (cid, date = G.TODAY) => { const p = B.profile(cid); if (!p) return false; if (p.status === 'BLOCKED' || p.status === 'SUSPENDED') return true; return p.block_on_overdue !== false && B.overdueDays(cid, date) > B.graceOf(p); };
  B.effStatus = cid => { const p = B.profile(cid); if (!p) return 'NONE'; if (p.status === 'SUSPENDED') return 'SUSPENDED'; return B.isBlocked(cid) ? 'BLOCKED' : 'ACTIVE'; };
  B.bucket = days => days <= 0 ? 'Por vencer' : days <= 15 ? '1–15' : days <= 30 ? '16–30' : days <= 60 ? '31–60' : 'Más de 60';
  B.BUCKETS = ['Por vencer', '1–15', '16–30', '31–60', 'Más de 60'];
  B.dueDateFor = (issue, term) => G.date.add(issue, Number(term) || 0);
  const nowIso = () => G.date.now().slice(0, 16);
  const histPush = (p, entry) => { p.history = (p.history || []).concat([Object.assign({ at: G._seeding ? (entry.at || G.TODAY + 'T08:00') : nowIso(), user: G._seeding ? 'Sistema' : G.ctx.userName() }, entry)]); };

  /* ---------- ficha de crédito ---------- */
  B.saveProfile = (cid, d, reason) => {
    if (!G._seeding && !G.can('b2b.credit.manage')) G.fail('RN-B2B-20', 'El límite, el plazo y el estado de crédito solo los cambia b2b.credit.manage (GERENTE, ADMINISTRACION).');
    if (!reason) G.fail('RN-B2B-20', 'El cambio de la condición de crédito exige motivo.');
    const c = D.get('customers', cid);
    if (!c || c.doc_type !== 'RUC' || !U.rucOk(c.doc_number) || !B2B_TYPES.includes(c.customer_type)) G.fail('RN-B2B-01', `Solo un cliente con RUC y tipo restaurante, negocio o punto de consignación puede tener crédito (${c ? G.custName(c.id) + ': ' + c.doc_type + ' · ' + c.customer_type : 'cliente no encontrado'}).`);
    if (d.credit_limit != null && Number(d.credit_limit) < 0) G.fail('RN-B2B-20', 'El límite no puede ser negativo.');
    if (d.term_days != null && (Number(d.term_days) < 0 || Number(d.term_days) > 120)) G.fail('RN-B2B-08', 'El plazo debe estar entre 0 y 120 días.');
    const p = B.profile(cid);
    const row = { credit_limit: Number(d.credit_limit ?? (p ? p.credit_limit : 0)), term_days: Number(d.term_days ?? (p ? p.term_days : P('b2b_default_term_days') ?? 15)), grace_days: Number(d.grace_days ?? (p ? p.grace_days : P('b2b_grace_days') ?? 5)), block_on_overdue: d.block_on_overdue ?? (p ? p.block_on_overdue : true), review_on: d.review_on || (p ? p.review_on : G.date.addMonths(G.TODAY, 6)), seller_user_id: d.seller_user_id || (p ? p.seller_user_id : c.seller_user_id) || null, change_reason: reason };
    if (p) { const ch = Object.keys(row).filter(k => k !== 'change_reason' && String(row[k]) !== String(p[k])); for (const k of ch) histPush(p, { field: k, before: p[k], after: row[k], reason }); D.update(T.prof, p.id, row, { silent: G._seeding }); return p; }
    const np = D.insert(T.prof, Object.assign({ customer_id: cid, status: 'ACTIVE', blocked_reason: null, blocked_at: null, history: [] }, row), { silent: G._seeding });
    histPush(np, { field: 'credit_limit', before: null, after: row.credit_limit, reason }); return np;
  };
  /** recalcula el bloqueo automático (RN-B2B-03/04) y deja auditoría */
  B.refresh = (cid, opts = {}) => {
    const p = B.profile(cid); if (!p || p.status === 'SUSPENDED') return p;
    const od = B.overdueDays(cid); const should = p.block_on_overdue !== false && od > B.graceOf(p);
    if (should && p.status !== 'BLOCKED') { p.status = 'BLOCKED'; p.blocked_reason = `Comprobante vencido hace ${od} días (gracia ${B.graceOf(p)})`; p.blocked_at = G._seeding ? (opts.at || G.TODAY + 'T06:00') : nowIso(); p.auto_blocked = true; histPush(p, { field: 'status', before: 'ACTIVE', after: 'BLOCKED', reason: p.blocked_reason, at: opts.at }); D.touch(); if (!G._seeding) { G.audit('BLOQUEO_CREDITO', T.prof, p.id, p.blocked_reason); G.events.emit('credit.blocked', { customer_id: cid, reason: p.blocked_reason }); } }
    else if (!should && p.status === 'BLOCKED' && p.auto_blocked) { p.status = 'ACTIVE'; histPush(p, { field: 'status', before: 'BLOCKED', after: 'ACTIVE', reason: 'Pagó lo vencido (desbloqueo automático)' }); p.blocked_reason = null; p.auto_blocked = false; D.touch(); if (!G._seeding) { G.audit('DESBLOQUEO_CREDITO', T.prof, p.id, 'Pago de lo vencido'); G.events.emit('credit.unblocked', { customer_id: cid }); } }
    return p;
  };
  B.block = (cid, reason) => { if (!G.can('b2b.credit.manage')) G.fail('RN-B2B-20', 'Bloquear exige b2b.credit.manage.'); if (!reason) G.fail('RN-B2B-04', 'El bloqueo exige motivo.'); const p = B.profile(cid); histPush(p, { field: 'status', before: p.status, after: 'BLOCKED', reason }); D.update(T.prof, p.id, { status: 'BLOCKED', blocked_reason: reason, blocked_at: nowIso(), auto_blocked: false }); G.audit('BLOQUEO_CREDITO', T.prof, p.id, reason); G.events.emit('credit.blocked', { customer_id: cid, reason }); return p; };
  B.unblock = (cid, reason) => {
    if (!G.can('b2b.credit.manage')) G.fail('RN-B2B-20', 'Desbloquear exige b2b.credit.manage.');
    if (!reason) G.fail('RN-B2B-04', 'El desbloqueo exige motivo.');
    const p = B.profile(cid); const od = B.overdueDays(cid);
    if (od > B.graceOf(p)) G.fail('RN-B2B-04', `${G.custName(cid)} mantiene ${F.money(B.overdueAmount(cid))} vencidos hace ${od} días: el bloqueo se levanta al pagar lo vencido o con una excepción aprobada para un pedido (B2B-04). Una promesa de pago no desbloquea (RN-B2B-19).`);
    histPush(p, { field: 'status', before: p.status, after: 'ACTIVE', reason }); D.update(T.prof, p.id, { status: 'ACTIVE', blocked_reason: null, auto_blocked: false }); G.audit('DESBLOQUEO_CREDITO', T.prof, p.id, reason); G.events.emit('credit.unblocked', { customer_id: cid }); return p;
  };

  /* ---------- control de crédito (assert_credit_available) ---------- */
  B.validException = o => { const x = D.find(T.exc, e => e.order_id === o.id && e.status === 'APPROVED'); return x && (!x.valid_until || x.valid_until >= nowIso()) ? x : null; };
  B.check = (o) => {
    if (o.payment_method_id !== 'pm-CREDIT') return { ok: true, credit: false };
    const p = B.profile(o.customer_id); const amount = o.final_total ?? o.estimated_total ?? 0;
    if (!p) return { ok: false, code: 'RN-B2B-01', msg: `${G.custName(o.customer_id)} no tiene condición de crédito: el pedido va al contado o registra su ficha en B2B-02.` };
    const exc = B.validException(o);
    const od = B.overdueDays(o.customer_id);
    if (B.isBlocked(o.customer_id)) { if (exc) return { ok: true, credit: true, exception: exc }; return { ok: false, code: 'RN-B2B-03', msg: `${G.custName(o.customer_id)} está bloqueado para crédito: ${p.status === 'BLOCKED' && !p.auto_blocked && od <= B.graceOf(p) ? p.blocked_reason : `tiene ${F.money(B.overdueAmount(o.customer_id))} vencidos hace ${od} días (gracia ${B.graceOf(p)})`}. Puede pagar al contado o pedir una excepción (B2B-04).`, overdue: B.overdueAmount(o.customer_id) }; }
    const exp = B.exposure(o.customer_id, o.id); const after = R(exp + amount);
    if (after > p.credit_limit + 0.005) { if (exc) return { ok: true, credit: true, exception: exc }; return { ok: false, code: 'RN-B2B-02', msg: `Saldo ${F.money(B.balance(o.customer_id))} + pedidos sin facturar ${F.money(B.unbilled(o.customer_id, o.id))} + este pedido ${F.money(amount)} = ${F.money(after)} supera el límite de ${F.money(p.credit_limit)}. Pide una excepción (B2B-04) o cobra al contado.`, exceeded: R(after - p.credit_limit) }; }
    return { ok: true, credit: true };
  };
  B.assertCredit = o => { const r = B.check(o); if (!r.ok) G.fail(r.code, r.msg, r); return r; };
  /** confirma un pedido con control de crédito (lo usan PED, el portal y las corridas) */
  B.confirm = (o, opts = {}) => {
    if (typeof o === 'string') o = D.get('sales_orders', o);
    const r = B.assertCredit(o);
    G.orders.transition(o, 'CONFIRMED', { reason: opts.reason || (r.exception ? 'Confirmado con excepción de crédito' : null) });
    if (r.exception) D.update(T.exc, r.exception.id, { status: 'USED' }, { silent: true });
    return o;
  };

  /* ---------- excepciones de crédito (RN-B2B-05) ---------- */
  B.requestException = (o, reason) => {
    if (!G.can('b2b.exception.request') && !G.can('b2b.exception.approve')) G.fail('RN-B2B-05', 'Solicitar excepciones exige b2b.exception.request (vendedora o supervisora).');
    if (!reason) G.fail('RN-B2B-05', 'La excepción exige motivo.');
    if (D.find(T.exc, e => e.order_id === o.id && ['PENDING', 'APPROVED'].includes(e.status))) G.fail('RN-B2B-05', `El pedido ${o.number} ya tiene una excepción pendiente o aprobada.`);
    const p = B.profile(o.customer_id); const amount = o.final_total ?? o.estimated_total;
    const exceeded = p ? Math.max(0, R(B.exposure(o.customer_id, o.id) + amount - p.credit_limit)) : amount;
    return D.insert(T.exc, { customer_id: o.customer_id, order_id: o.id, requested_by: G.ctx.userId(), reason, order_amount: amount, exceeded_amount: exceeded, overdue_amount: B.overdueAmount(o.customer_id), status: 'PENDING', decided_by: null, decided_at: null, decision_note: null, valid_until: null, requested_at: nowIso() });
  };
  B.decideException = (x, approve, note) => {
    if (x.status !== 'PENDING') G.fail('RN-B2B-05', 'La excepción ya fue decidida.');
    if (G.ctx.userId() === x.requested_by) G.fail('RN-B2B-05', 'Quien solicita la excepción no la aprueba: debe decidirla GERENTE o ADMINISTRACION, otra persona.');
    if (!G.can('b2b.exception.approve')) G.fail('RN-B2B-05', 'Aprobar o rechazar excepciones exige b2b.exception.approve (GERENTE o ADMINISTRACION).');
    const until = approve ? addHours(nowIso(), P('b2b_exception_valid_hours') ?? 48) : null;
    D.update(T.exc, x.id, { status: approve ? 'APPROVED' : 'REJECTED', decided_by: G.ctx.userId(), decided_at: nowIso(), decision_note: note || null, valid_until: until });
    G.events.emit('credit_exception.decided', { exception_id: x.id, order_id: x.order_id, approved: approve });
    G.notify({ user_id: x.requested_by, title: `Excepción de crédito ${approve ? 'aprobada' : 'rechazada'}`, body: `${G.custName(x.customer_id)} · ${F.money(x.order_amount)}${approve ? ' · vale hasta ' + F.datetime(until) : ''}`, tone: approve ? 'ok' : 'bad', module: 'B2B', ref: x.order_id });
    return x;
  };
  B.excStatus = x => x.status === 'APPROVED' && x.valid_until && x.valid_until < nowIso() ? 'EXPIRED' : x.status;

  /* ---------- precios por cliente (RN-B2B-06/07) ---------- */
  B.costOf = vid => G.inv.avg(vid);
  B.minPrice = vid => R(B.costOf(vid) * (1 + (P('b2b_min_margin_pct') ?? 10) / 100), 2);
  B.prices = cid => D.where(T.price, p => p.customer_id === cid);
  B.savePrice = d => {
    if (!G._seeding && !G.can('b2b.price.manage')) G.fail('RN-B2B-07', 'Registrar precios por cliente exige b2b.price.manage.');
    const v = G.variant(d.variant_id); if (!v) G.fail('RN-B2B-06', 'Elige la presentación.');
    if (!(Number(d.unit_price) > 0)) G.fail('RN-B2B-06', 'El precio debe ser mayor que cero.');
    if (!d.valid_from) G.fail('RN-B2B-06', 'Indica el inicio de la vigencia.');
    if (d.valid_to && d.valid_to < d.valid_from) G.fail('RN-B2B-06', 'La vigencia termina antes de empezar.');
    const ov = B.prices(d.customer_id).find(p => p.variant_id === d.variant_id && p.status !== 'REJECTED' && (p.valid_from || p.req_valid_from) <= (d.valid_to || '9999-12-31') && d.valid_from <= ((p.valid_from ? p.valid_to : p.req_valid_to) || '9999-12-31'));
    if (ov) G.fail('RN-B2B-06', `${v.name} ya tiene un precio de ${F.money(ov.unit_price)}/${ov.price_basis === 'KG' ? 'kg' : 'u'} vigente del ${F.date(ov.valid_from || ov.req_valid_from)} al ${(ov.valid_to || ov.req_valid_to) ? F.date(ov.valid_to || ov.req_valid_to) : 'indefinido'}: las vigencias no se traslapan. Cierra el anterior antes.`);
    const min = B.minPrice(v.id); const below = Number(d.unit_price) < min - 0.005; const canBelow = G._seeding ? !!d.approved_by : G.can('b2b.price.approve_below_margin');
    const basis = d.price_basis || (v.sale_mode === 'UNIT' ? 'UNIT' : 'KG');
    const row = { customer_id: d.customer_id, variant_id: v.id, unit_price: Number(d.unit_price), price: Number(d.unit_price), price_basis: basis, basis, notes: d.notes || null, cost_at_request: B.costOf(v.id), min_price: min, requested_by: G._seeding ? (d.requested_by || 'us-pleon') : G.ctx.userId() };
    if (below && !canBelow) return D.insert(T.price, Object.assign(row, { valid_from: null, valid_to: null, req_valid_from: d.valid_from, req_valid_to: d.valid_to || null, status: 'PENDING_APPROVAL', below_margin_approved_by: null }), { silent: G._seeding });
    return D.insert(T.price, Object.assign(row, { valid_from: d.valid_from, valid_to: d.valid_to || null, status: 'ACTIVE', below_margin_approved_by: below ? (G._seeding ? d.approved_by : G.ctx.userId()) : null }), { silent: G._seeding });
  };
  B.decidePrice = (p, approve, note) => {
    if (!G.can('b2b.price.approve_below_margin')) G.fail('RN-B2B-07', 'Aprobar precios bajo el margen mínimo exige b2b.price.approve_below_margin (GERENTE).');
    if (p.requested_by === G.ctx.userId()) G.fail('RN-B2B-07', 'Quien registra el precio no lo aprueba.');
    if (approve) { const ov = B.prices(p.customer_id).find(x => x.id !== p.id && x.variant_id === p.variant_id && x.status === 'ACTIVE' && x.valid_from <= (p.req_valid_to || '9999-12-31') && p.req_valid_from <= (x.valid_to || '9999-12-31')); if (ov) G.fail('RN-B2B-06', 'Otro precio vigente se traslapa con esta vigencia.'); return D.update(T.price, p.id, { status: 'ACTIVE', valid_from: p.req_valid_from, valid_to: p.req_valid_to, below_margin_approved_by: G.ctx.userId(), notes: [p.notes, note].filter(Boolean).join(' · ') }); }
    return D.update(T.price, p.id, { status: 'REJECTED', notes: [p.notes, 'Rechazado: ' + (note || '')].filter(Boolean).join(' · ') });
  };
  B.closePrice = (p, date) => { if (!G.can('b2b.price.manage')) G.fail('RN-B2B-06', 'Exige b2b.price.manage.'); if (date < p.valid_from) G.fail('RN-B2B-06', 'El cierre no puede ser anterior al inicio.'); return D.update(T.price, p.id, { valid_to: date }); };

  /* ---------- pedidos recurrentes (RN-B2B-09/10/11) ---------- */
  B.roLines = rid => D.where(T.rol, l => l.recurring_order_id === rid);
  B.isHoliday = d => !!D.find('calendar_holidays', x => x.holiday_date === d && !x.establishment_id);
  B.occurs = (ro, d) => {
    if (d < ro.starts_on || (ro.ends_on && d > ro.ends_on)) return false;
    if (ro.frequency === 'WEEKLY') return (ro.weekdays || []).includes(isoDow(d));
    if (ro.frequency === 'EVERY_N_DAYS') return G.date.diff(d, ro.starts_on) % (ro.interval_days || 7) === 0;
    if (ro.frequency === 'MONTHLY') return Number(d.slice(8, 10)) === Number(ro.day_of_month);
    return false;
  };
  B.nextDates = (ro, from, n = 4) => { const out = []; for (let d = from, i = 0; out.length < n && i < 120; d = G.date.add(d, 1), i++) if (B.occurs(ro, d)) out.push(d); return out; };
  B.saveRecurring = (d, lines, existing) => {
    if (!G._seeding && !G.can('b2b.recurring.manage')) G.fail('RN-B2B-09', 'Programar pedidos recurrentes exige b2b.recurring.manage.');
    if (!d.customer_id || !d.address_id) G.fail('RN-B2B-09', 'Elige el cliente y la dirección de entrega.');
    if (d.frequency === 'WEEKLY' && !(d.weekdays || []).length) G.fail('RN-B2B-09', 'Marca al menos un día de la semana.');
    if (d.frequency === 'EVERY_N_DAYS' && !(Number(d.interval_days) >= 1)) G.fail('RN-B2B-09', 'Indica cada cuántos días.');
    if (!lines || !lines.length) G.fail('RN-B2B-09', 'Agrega al menos una línea.');
    const brands = new Set(lines.map(l => (G.variant(l.variant_id) || {}).brand_id)); if (brands.size > 1) G.fail('RN-PED-02', 'Un pedido recurrente es de una sola marca: crea uno por marca.');
    const addr = D.get('customer_addresses', d.address_id); const z = addr && D.get('delivery_zones', addr.zone_id);
    const row = { customer_id: d.customer_id, brand_id: [...brands][0], establishment_id: z ? z.establishment_id : 'es-L1', address_id: d.address_id, name: d.name || 'Pedido recurrente', frequency: d.frequency, weekdays: (d.weekdays || []).map(Number), interval_days: d.interval_days ? Number(d.interval_days) : null, day_of_month: d.day_of_month ? Number(d.day_of_month) : null, slot_from: d.slot_from || '09:00', slot_to: d.slot_to || '13:00', lead_days: d.lead_days != null && d.lead_days !== '' ? Number(d.lead_days) : (P('b2b_recurring_lead_days') ?? 1), starts_on: d.starts_on || G.TODAY, ends_on: d.ends_on || null, auto_confirm: !!d.auto_confirm, requested_doc_type: d.requested_doc_type || 'INVOICE', status: d.status || 'ACTIVE', notes: d.notes || null };
    const ro = existing ? D.update(T.ro, existing.id, row) : D.insert(T.ro, row, { silent: G._seeding });
    if (existing) for (const l of B.roLines(ro.id)) D.remove(T.rol, l.id);
    for (const l of lines) D.insert(T.rol, { recurring_order_id: ro.id, variant_id: l.variant_id, qty: Number(l.qty), est_weight_kg: l.est_weight_kg != null ? Number(l.est_weight_kg) : null, cut_notes: l.cut_notes || null }, { silent: true });
    ro.next_delivery_date = B.nextDates(ro, G.date.add(G.TODAY, 1), 1)[0] || null;
    return ro;
  };
  const slotFor = (est, from) => D.find('order_time_slots', s => s.establishment_id === est && s.slot_from === from) || D.find('order_time_slots', s => s.establishment_id === est);
  /** corrida programada: una sola por programación y fecha de entrega aunque se ejecute dos veces (RN-B2B-09) */
  B.runRecurring = (at = G.date.now(), opts = {}) => {
    const runTime = P('b2b_recurring_run_time') || '18:00'; const date = at.slice(0, 10);
    if (!opts.force && at.slice(11, 16) < runTime) return { ran: 0, msg: `La corrida es a las ${runTime}.`, runs: [] };
    const out = [];
    for (const ro of D.where(T.ro, x => x.status === 'ACTIVE' && (!opts.only || x.id === opts.only))) {
      const del = G.date.add(date, ro.lead_days ?? (P('b2b_recurring_lead_days') ?? 1));
      if (!B.occurs(ro, del)) continue;
      if (D.find(T.run, r => r.recurring_order_id === ro.id && r.delivery_date === del)) continue; // idempotente
      out.push(B.runOne(ro, del, at));
    }
    return { ran: out.length, runs: out };
  };
  B.runOne = (ro, del, at) => {
    const base = { recurring_order_id: ro.id, delivery_date: del, run_at: at, order_id: null };
    if (B.isHoliday(del)) return D.insert(T.run, Object.assign(base, { status: 'SKIPPED', message: 'Feriado: no hay reparto' }), { silent: true });
    const skipped = []; const lines = [];
    for (const l of B.roLines(ro.id)) { const v = G.variant(l.variant_id); if (!v || v.status !== 'ACTIVE' || !v.sellable) { skipped.push(v ? v.name : l.variant_id); continue; } lines.push({ variant_id: l.variant_id, qty: l.qty, est_weight_kg: l.est_weight_kg, cut_notes: l.cut_notes }); }
    if (!lines.length) return D.insert(T.run, Object.assign(base, { status: 'FAILED', message: 'Todas las presentaciones están inactivas: ' + skipped.join(', ') }), { silent: true });
    const p = B.profile(ro.customer_id); const slot = slotFor(ro.establishment_id, ro.slot_from);
    let o;
    try {
      o = G.orders.create({ customer_id: ro.customer_id, brand_id: ro.brand_id, channel: 'B2B', fulfillment: 'DELIVERY', address_id: ro.address_id, delivery_date: del, slot_id: slot ? slot.id : null, payment_method_id: p ? 'pm-CREDIT' : 'pm-TRANSFER', requested_doc_type: ro.requested_doc_type, notes: `Pedido recurrente «${ro.name}»` + (skipped.length ? ` · omitido: ${skipped.join(', ')}` : ''), establishment_id: ro.establishment_id, seller_id: (p && p.seller_user_id) || (D.get('customers', ro.customer_id) || {}).seller_user_id || null, lines, extra: { recurring_order_id: ro.id } });
    } catch (e) { return D.insert(T.run, Object.assign(base, { status: 'FAILED', message: e.message }), { silent: true }); }
    o.created_at = at.length > 10 ? at : o.created_at;
    let st = 'CREATED', msg = skipped.length ? `RN-B2B-11: se omitió ${skipped.join(', ')} (inactiva)` : 'Precios tomados en la corrida (RN-B2B-11)';
    const chk = B.check(o);
    if (!chk.ok) { st = 'BLOCKED_CREDIT'; msg = chk.msg; if (!G._seeding) { G.notify({ user_id: o.seller_id, title: 'Pedido recurrente bloqueado por crédito', body: `${G.custName(o.customer_id)} · ${o.number}: ${chk.msg}`, tone: 'bad', module: 'B2B', ref: o.id }); G.msg.send({ customer_id: o.customer_id, kind: 'UTILITY', template: 'b2b_pedido_recurrente_bloqueado', text: `Su pedido ${o.number} para el ${F.date(del)} quedó en espera por saldo vencido. Contáctenos para regularizar.`, ref: o.id }); } }
    else if (ro.auto_confirm) { try { B.confirm(o, { reason: 'Corrida automática de pedido recurrente' }); st = 'CONFIRMED'; } catch (e) { st = 'CREATED'; msg = 'Queda en la bandeja de la vendedora: ' + e.message; } }
    const run = D.insert(T.run, Object.assign(base, { order_id: o.id, status: st, message: msg }), { silent: true });
    D.update(T.ro, ro.id, { next_delivery_date: B.nextDates(ro, G.date.add(del, 1), 1)[0] || null }, { silent: true });
    if (!G._seeding) G.events.emit('recurring_order.run', { recurring_order_id: ro.id, delivery_date: del, status: st, order_id: o.id });
    return run;
  };

  /* ---------- portal (RN-B2B-12 … 15, 18) ---------- */
  B._preview = 'cu-B001';
  B.portalCustomer = () => { if (G.ctx.role === 'CLIENTE_B2B') { if (!G.ctx.portalCustomer) G.fail('RN-B2B-12', 'Tu usuario del portal no está ligado a un cliente.'); return G.ctx.portalCustomer; } return B._preview; };
  B.portalAccount = () => D.find(T.acc, a => a.user_id === G.ctx.userId() && a.customer_id === B.portalCustomer());
  /** doble filtro: empresa (G.db) + cliente del portal. El parámetro externo nunca reemplaza al cliente de la sesión. */
  B.portal = {
    docs: () => { const cid = B.portalCustomer(); return D.where('sales_documents', d => d.customer_id === cid).sort(U.by('issue_date', -1)); },
    orders: () => { const cid = B.portalCustomer(); return D.where('sales_orders', o => o.customer_id === cid).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); },
    claims: () => { const cid = B.portalCustomer(); return D.where(T.claim, c => c.customer_id === cid); },
    accounts: () => { const cid = B.portalCustomer(); return D.where(T.acc, a => a.customer_id === cid); },
    download: (docId, kind) => { const cid = B.portalCustomer(); const d = D.get('sales_documents', docId); if (!d || d.customer_id !== cid) G.fail('RN-B2B-12', 'Ese comprobante no pertenece a tu empresa.'); if (d.sunat_status !== 'ACCEPTED') G.fail('RN-B2B-18', `${G.docs.label(d)} aún no está aceptado por la SUNAT (${G.ui.statusLabel(d.sunat_status)}): se descarga cuando tenga CDR.`); return { name: `${D.get('companies', 'co-dg') ? D.get('companies', 'co-dg').ruc : '20'}-${d.doc_type === 'INVOICE' ? '01' : d.doc_type === 'RECEIPT' ? '03' : '07'}-${d.series}-${d.number}.${kind === 'PDF' ? 'pdf' : kind === 'XML' ? 'xml' : 'zip'}`, doc: d }; },
  };
  B.earliestDate = (at = G.date.now()) => G.date.add(at.slice(0, 10), at.slice(11, 16) < (P('b2b_cutoff_time') || '16:00') ? 1 : 2);
  B.repeatLines = o => o.lines.map(l => { const pr = G.price.of(l.variant_id, { brand_id: o.brand_id, channel: 'B2B', customer_id: o.customer_id }); const v = G.variant(l.variant_id); return { variant_id: l.variant_id, qty: l.qty, est_weight_kg: l.est_weight_kg, old_price: l.unit_price, new_price: pr ? pr.price : null, basis: pr ? pr.basis : l.price_basis, diff: pr ? R(pr.price - l.unit_price) : null, active: !!(v && v.status === 'ACTIVE' && v.sellable && pr) }; });
  /** pedido del portal: pedido mínimo y hora de corte (RN-B2B-14); confirma si cumple RN-PED-01 y crédito, si no pasa a la vendedora (RN-B2B-13) */
  B.portalOrder = ({ lines, delivery_date, slot_from = '09:00', notes, at = G.date.now(), pay = 'AUTO', repeat_of }) => {
    const cid = B.portalCustomer(); const acc = B.portalAccount();
    if (G.ctx.role === 'CLIENTE_B2B' && acc && !acc.can_order) G.fail('RN-B2B-12', 'Tu usuario del portal no tiene permiso para pedir (rol contabilidad).');
    const ls = (lines || []).filter(l => Number(l.qty) > 0); if (!ls.length) G.fail('RN-B2B-14', 'El carrito está vacío.');
    const est = ls.map(l => { const pr = G.price.of(l.variant_id, { channel: 'B2B', customer_id: cid }); const v = G.variant(l.variant_id); if (!pr) G.fail('RN-CAT-05', `${v.name} no tiene precio para tu empresa.`); const kg = v.sale_mode === 'KG' ? Number(l.qty) : v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? R(Number(l.qty) * v.nominal_weight_kg, 3) : null; return R((pr.basis === 'KG' ? kg : Number(l.qty)) * pr.price); });
    const total = R(U.sum(est, x => x)); const min = P('b2b_min_order_amount') ?? 150;
    if (total < min) G.fail('RN-B2B-14', `El pedido mínimo en el portal es ${F.money(min)}; tu carrito suma ${F.money(total)}.`);
    const earliest = B.earliestDate(at);
    if (!delivery_date || delivery_date < earliest) G.fail('RN-B2B-14', `Después de las ${P('b2b_cutoff_time') || '16:00'} el pedido se entrega desde el ${F.date(earliest)} (hora de corte). Elige esa fecha o una posterior.`);
    const c = D.get('customers', cid); const addr = D.find('customer_addresses', a => a.customer_id === cid && a.is_default); const zone = addr && D.get('delivery_zones', addr.zone_id); const site = zone ? zone.establishment_id : 'es-L1'; const slot = slotFor(site, slot_from);
    const prof = B.profile(cid); const pm = pay === 'AUTO' ? (prof ? 'pm-CREDIT' : 'pm-TRANSFER') : pay;
    const byBrand = U.groupBy(ls, l => G.variant(l.variant_id).brand_id); const res = [];
    for (const [brand, bl] of Object.entries(byBrand)) {
      const o = G.orders.create({ customer_id: cid, brand_id: brand, channel: 'B2B', fulfillment: 'DELIVERY', address_id: addr ? addr.id : null, delivery_date, slot_id: slot ? slot.id : null, payment_method_id: pm, requested_doc_type: 'INVOICE', notes: notes || 'Pedido del portal B2B', establishment_id: site, seller_id: (prof && prof.seller_user_id) || c.seller_user_id || null, lines: bl.map(l => ({ variant_id: l.variant_id, qty: Number(l.qty), est_weight_kg: l.est_weight_kg })), extra: { portal_account_id: acc ? acc.id : null, origin_ref: repeat_of ? 'Repetir ' + (D.get('sales_orders', repeat_of) || {}).number : 'Portal B2B' } });
      let confirmed = false, reason = null;
      const miss = G.orders.missing(o);
      if (miss.length) reason = 'RN-PED-01: faltan ' + miss.join(', ');
      else { const chk = B.check(o); if (!chk.ok) reason = chk.msg.startsWith(chk.code) ? chk.msg : `${chk.code}: ${chk.msg}`; else { B.confirm(o, { reason: 'Pedido del portal B2B' }); confirmed = true; } }
      if (!confirmed && !G._seeding) G.notify({ user_id: o.seller_id, title: 'Pedido del portal por revisar', body: `${G.custName(cid)} · ${o.number}: ${reason}`, tone: 'warn', module: 'B2B', ref: o.id });
      res.push({ order: o, confirmed, reason });
    }
    return res;
  };

  /* ---------- reclamos (RN-B2B-17) ---------- */
  B.openClaim = d => {
    if (!d.description) G.fail('RN-B2B-17', 'Describe el reclamo.');
    if (['QUALITY', 'WEIGHT'].includes(d.claim_type) && !(d.photo_urls || []).length) G.fail('RN-B2B-17', `Un reclamo de ${CLAIM[d.claim_type].toLowerCase()} exige al menos una foto.`);
    if (d.order_id) { const o = D.get('sales_orders', d.order_id); if (!o || o.customer_id !== d.customer_id) G.fail('RN-B2B-12', 'El pedido no es de este cliente.'); }
    const c = D.insert(T.claim, { customer_id: d.customer_id, order_id: d.order_id || null, document_id: d.document_id || null, portal_account_id: d.portal_account_id || null, claim_type: d.claim_type, description: d.description, photo_urls: d.photo_urls || [], status: 'OPEN', first_response_at: null, response: null, resolution: null, resolution_note: null, credit_note_id: null, resolved_by: null, resolved_at: null, opened_at: d.opened_at || nowIso(), number: D.next('RCB', 'RB-', 4) }, { silent: G._seeding });
    if (!G._seeding) { G.events.emit('b2b_claim.opened', { claim_id: c.id, customer_id: c.customer_id, type: c.claim_type }); G.notify({ role: 'SUPERVISORA_VENTAS', title: 'Nuevo reclamo B2B', body: `${G.custName(c.customer_id)} · ${CLAIM[c.claim_type]}: ${c.description.slice(0, 80)}`, tone: 'warn', module: 'B2B', ref: c.id }); }
    return c;
  };
  B.claimDue = c => addHours(c.opened_at || c.created_at.slice(0, 16), P('b2b_claim_response_hours') ?? 48);
  B.respondClaim = (c, text) => { if (!G.can('b2b.claim.resolve')) G.fail('RN-B2B-17', 'Responder reclamos exige b2b.claim.resolve.'); if (!text) G.fail('RN-B2B-17', 'Escribe la respuesta.'); return D.update(T.claim, c.id, { response: text, first_response_at: c.first_response_at || nowIso(), status: c.status === 'OPEN' ? 'IN_REVIEW' : c.status, responder_id: G.ctx.userId() }); };
  B.resolveClaim = (c, { resolution, note, amount, reject }) => {
    if (!G.can('b2b.claim.resolve')) G.fail('RN-B2B-17', 'Resolver reclamos exige b2b.claim.resolve.');
    if (reject) return D.update(T.claim, c.id, { status: 'REJECTED', resolution: 'NO_ACTION', resolution_note: note || 'Rechazado', resolved_by: G.ctx.userId(), resolved_at: nowIso(), first_response_at: c.first_response_at || nowIso() });
    let nc = null;
    if (resolution === 'CREDIT_NOTE') {
      if (!(Number(amount) > 0)) G.fail('RN-B2B-17', 'Un reclamo resuelto con abono exige la nota de crédito enlazada: indica el monto.');
      const doc = D.get('sales_documents', c.document_id) || (c.order_id && D.find('sales_documents', d => d.order_id === c.order_id && ['INVOICE', 'RECEIPT'].includes(d.doc_type)));
      if (!doc) G.fail('RN-B2B-17', 'El reclamo no tiene comprobante para emitir la nota de crédito.');
      if (Number(amount) > doc.total) G.fail('RN-B2B-17', 'El abono supera el comprobante.');
      nc = G.docs.issue({ doc_type: 'CREDIT_NOTE', brand_id: doc.brand_id, establishment_id: doc.establishment_id, customer_id: doc.customer_id, related_document_id: doc.id, note_reason_code: c.claim_type === 'WEIGHT' ? '09' : '07', note_reason: `Reclamo ${c.number}: ${note || CLAIM[c.claim_type]}`, lines: [{ description: `Abono por reclamo ${c.number} (${CLAIM[c.claim_type].toLowerCase()})`, qty: 1, uom_code: 'ZZ', unit_price: Number(amount), total: Number(amount), igv_affectation: '10' }], date: G._seeding ? (c.opened_at || G.TODAY).slice(0, 10) : G.TODAY, accept: true, series: G.series.for('CREDIT_NOTE', doc.brand_id), silent: G._seeding });
      if (doc.balance > 0) doc.balance = Math.max(0, R(doc.balance - Number(amount)));
      D.touch();
    }
    return D.update(T.claim, c.id, { status: 'RESOLVED', resolution, resolution_note: note || null, credit_note_id: nc ? nc.id : null, resolved_by: G._seeding ? 'us-pleon' : G.ctx.userId(), resolved_at: G._seeding ? c.opened_at : nowIso(), first_response_at: c.first_response_at || (G._seeding ? c.opened_at : nowIso()) }, { silent: G._seeding });
  };

  /* ---------- cobranza (RN-B2B-16/19) ---------- */
  B.schedule = doc => {
    if (!doc || !openDoc(doc) || !doc.due_date) return [];
    const before = P('b2b_reminder_days_before') ?? 3; const out = [];
    for (const [type, date] of [['BEFORE_DUE', G.date.add(doc.due_date, -before)], ['DUE_DAY', doc.due_date], ['OVERDUE_3', G.date.add(doc.due_date, 3)], ['OVERDUE_7', G.date.add(doc.due_date, 7)]]) {
      if (D.find(T.rem, r => r.document_id === doc.id && r.reminder_type === type)) continue;
      out.push(D.insert(T.rem, { customer_id: doc.customer_id, document_id: doc.id, reminder_type: type, channel: 'WHATSAPP', scheduled_for: date, sent_at: null, template_code: 'cobranza_' + type.toLowerCase(), status: 'SCHEDULED' }, { silent: true }));
    }
    return out;
  };
  B.sendDue = (date = G.TODAY) => {
    let n = 0, c = 0;
    for (const r of D.where(T.rem, r => r.status === 'SCHEDULED' && r.scheduled_for <= date)) {
      const doc = D.get('sales_documents', r.document_id);
      if (!doc || !openDoc(doc)) { D.update(T.rem, r.id, { status: 'CANCELLED' }, { silent: true }); c++; continue; }
      if (!G._seeding) G.msg.send({ customer_id: r.customer_id, kind: 'UTILITY', template: r.template_code, text: `${G.custName(r.customer_id)}: ${G.docs.label(doc)} por ${F.money(doc.balance)} ${r.reminder_type === 'BEFORE_DUE' ? 'vence el ' + F.date(doc.due_date) : r.reminder_type === 'DUE_DAY' ? 'vence hoy' : 'está vencido desde el ' + F.date(doc.due_date)}. Cuentas BCP e Interbank en su estado de cuenta.`, ref: doc.id });
      D.update(T.rem, r.id, { status: 'SENT', sent_at: G._seeding ? r.scheduled_for + 'T09:00' : nowIso() }, { silent: true }); n++;
    }
    return { sent: n, cancelled: c };
  };
  B.addPromise = d => { if (!G._seeding && !G.can('b2b.collection.manage')) G.fail('RN-B2B-19', 'Registrar promesas exige b2b.collection.manage.'); if (!(Number(d.amount) > 0)) G.fail('RN-B2B-19', 'El monto debe ser mayor que cero.'); if (!d.promised_date) G.fail('RN-B2B-19', 'Indica la fecha prometida.'); return D.insert(T.prom, { customer_id: d.customer_id, document_id: d.document_id || null, promised_date: d.promised_date, amount: Number(d.amount), recorded_by: G._seeding ? 'us-chuaman' : G.ctx.userId(), status: 'OPEN', notes: d.notes || null }, { silent: G._seeding }); };
  /** RN-B2B-19: vencida sin pago → incumplida */
  B.evalPromises = (date = G.TODAY) => { let n = 0; for (const p of D.where(T.prom, p => p.status === 'OPEN')) { const doc = p.document_id && D.get('sales_documents', p.document_id); const paid = doc ? (doc.balance || 0) <= 0.009 : B.overdueAmount(p.customer_id) <= 0.009; if (paid) { D.update(T.prom, p.id, { status: 'KEPT' }, { silent: true }); n++; } else if (p.promised_date < date) { D.update(T.prom, p.id, { status: 'BROKEN' }, { silent: true }); n++; } } return n; };
  B.aging = (rows = B.customers()) => rows.map(c => { const docs = B.openDocs(c.id); const b = {}; for (const k of B.BUCKETS) b[k] = 0; for (const d of docs) b[B.bucket(d.due_date ? G.date.diff(G.TODAY, d.due_date) : 0)] += d.balance; for (const k of B.BUCKETS) b[k] = R(b[k]); return { c, docs, b, total: R(U.sum(docs, d => d.balance)) }; }).filter(r => r.total > 0);
  /** estado de cuenta: comprobantes a crédito, notas y cobros con saldo corrido */
  B.statement = cid => {
    const docs = D.where('sales_documents', d => d.customer_id === cid && d.payment_terms === 'CREDIT' && d.status !== 'VOIDED');
    const ids = new Set(docs.map(d => d.id)); const mv = [];
    for (const d of docs) mv.push({ date: d.issue_date, kind: 'DOC', ref: G.docs.label(d), doc: d, due: d.due_date, charge: d.total, credit: 0 });
    for (const n of D.where('sales_documents', d => d.doc_type === 'CREDIT_NOTE' && ids.has(d.related_document_id))) mv.push({ date: n.issue_date, kind: 'NC', ref: G.docs.label(n), doc: n, charge: 0, credit: n.total, rel: n.related_document_id });
    for (const p of D.where('payments', p => p.customer_id === cid && p.status === 'CONFIRMED' && (p.allocations || []).some(a => ids.has(a.document_id)))) { const amt = U.sum(p.allocations.filter(a => ids.has(a.document_id)), a => a.amount); mv.push({ date: p.paid_at.slice(0, 10), kind: 'PAY', ref: `Cobro ${p.number} · ${G.pmName(p.payment_method_id)}${p.reference ? ' · ' + p.reference : ''}`, pay: p, charge: 0, credit: R(amt) }); }
    mv.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'DOC' ? -1 : 1));
    let bal = 0; for (const m of mv) { bal = R(bal + m.charge - m.credit); m.balance = bal; }
    return mv;
  };

  /* ---------- eventos ---------- */
  G.events.on('document.issued', pl => {
    const d = D.get('sales_documents', pl.document_id); if (!d || d.payment_terms !== 'CREDIT') return;
    const p = B.profile(d.customer_id);
    if (p) { const due = B.dueDateFor(d.issue_date, p.term_days); if (!d.due_date || d.due_date !== due) { d.due_date = due; D.touch(); } }
    if (d.due_date && d.due_date < d.issue_date) G.fail('RN-B2B-08', 'El vencimiento no puede ser anterior a la emisión.');
    B.schedule(d);
  });
  G.events.on('payment.confirmed', pl => { const cs = new Set(); for (const a of pl.allocations || []) { const d = a.document_id && D.get('sales_documents', a.document_id); if (d) cs.add(d.customer_id); } for (const c of cs) { B.refresh(c); B.evalPromises(); } });
  G.events.on('payment.reversed', pl => { for (const p of D.all(T.prof)) B.refresh(p.customer_id); });

  /* =================================================================
     Interfaz interna (B2B-01 … B2B-11)
     ================================================================= */
  const custSel = (cur, onChange, list) => { const s = h('select', { class: 'input', style: 'max-width:300px', attrs: { 'aria-label': 'Cliente', id: 'b2b-cust' } }, (list || B.customers()).map(c => h('option', { value: c.id, selected: c.id === cur }, `${G.custName(c.id)}${B.profile(c.id) ? '' : ' (sin crédito)'}`))); s.addEventListener('change', () => onChange(s.value)); return s; };
  const effBadge = cid => { const s = B.effStatus(cid); return s === 'NONE' ? badge('Contado', '') : status(s); };
  const ageBadge = days => days > 0 ? badge(F.days(days), days > 30 ? 'bad' : days > 15 ? 'warn' : 'warn') : badge('Al día', 'ok');
  const pickCust = params => params.id || B._lastCust || 'cu-B001';
  function askReason(title, fn, okMsg, extra) {
    modal(title, bd => { if (extra) bd.appendChild(extra); bd.appendChild(h('div', { class: 'field' }, h('label', { attrs: { for: 'b2b-reason' } }, 'Motivo *'), h('textarea', { class: 'input', attrs: { id: 'b2b-reason' } }))); }, [{ label: 'Cancelar' }, { label: 'Confirmar', kind: 'primary', onClick: () => { const r = document.getElementById('b2b-reason').value.trim(); try { fn(r); toast(okMsg, 'ok'); G.refresh(); } catch (e) { err(e); return false; } } }]);
  }

  /* ---------- B2B-01 Clientes empresariales ---------- */
  function scr01(el) {
    const body = page(el, { code: 'B2B-01', title: 'Clientes empresariales', sub: 'Límite, saldo, vencido, disponible, días de mora y estado de crédito de restaurantes, negocios y puntos de consignación.', actions: [{ label: 'Nueva ficha de crédito', kind: 'primary', icon: '+', disabled: !G.can('b2b.credit.manage'), onClick: () => G.go('B2B-02', { id: (B.customers().find(c => !B.profile(c.id)) || {}).id }) }] });
    const rows = B.customers().filter(c => { if (G.ctx.brand === 'ALL') return true; return (c.segment_brands || []).includes(G.ctx.brand) || c.customer_type === 'CONSIGNMENT_POINT'; }).map(c => { const p = B.profile(c.id); const od = B.overdueDays(c.id); const a = D.find('customer_addresses', x => x.customer_id === c.id && x.is_default); return { c, id: c.id, name: G.custName(c.id), type: c.customer_type, limit: p ? p.credit_limit : null, balance: B.balance(c.id), overdue: B.overdueAmount(c.id), avail: p ? B.available(c.id) : null, od, st: B.effStatus(c.id), seller: (p && p.seller_user_id) || c.seller_user_id, zone: a ? a.zone_id : null, age: od <= 0 ? 'Por vencer' : B.bucket(od) }; });
    body.appendChild(kpis([{ label: 'Clientes con crédito', value: rows.filter(r => r.limit != null).length, sub: `${rows.length} empresas` }, { label: 'Saldo por cobrar', value: F.money(U.sum(rows, r => r.balance), 0), onClick: () => G.go('B2B-08') }, { label: 'Vencido', value: F.money(U.sum(rows, r => r.overdue), 0), sub: F.pct(U.sum(rows, r => r.balance) ? U.sum(rows, r => r.overdue) / U.sum(rows, r => r.balance) * 100 : 0, 0) + ' de la cartera', tone: 'warn' }, { label: 'Bloqueados', value: rows.filter(r => r.st === 'BLOCKED').length, sub: `gracia ${P('b2b_grace_days')} días (RN-B2B-03)`, tone: rows.some(r => r.st === 'BLOCKED') ? 'bad' : 'ok' }]));
    body.appendChild(table({ id: 'b2b01', rows, onRow: r => G.go('B2B-02', { id: r.id }), columns: [
      { key: 'name', label: 'Cliente' }, { key: 'type', label: 'Tipo', render: r => CTYPE[r.type] }, { key: 'limit', label: 'Límite', align: 'r', render: r => r.limit != null ? F.money(r.limit, 0) : '—' }, { key: 'balance', label: 'Saldo', align: 'r', render: r => F.money(r.balance) },
      { key: 'overdue', label: 'Vencido', align: 'r', render: r => r.overdue ? h('span', { style: 'color:var(--bad)' }, F.money(r.overdue)) : '—' }, { key: 'avail', label: 'Disponible', align: 'r', render: r => r.avail == null ? '—' : badge(F.money(r.avail, 0), r.avail < 0 ? 'bad' : r.limit && r.avail < r.limit * 0.15 ? 'warn' : 'ok') },
      { key: 'od', label: 'Mora', align: 'r', render: r => ageBadge(r.od) }, { key: 'st', label: 'Estado', render: r => effBadge(r.id), value: r => r.st }, { key: 'seller', label: 'Vendedora', render: r => G.userShort(r.seller), value: r => G.userName(r.seller) },
    ], filters: [{ key: 'zone', label: 'Zona', options: [...new Set(rows.map(r => r.zone).filter(Boolean))].map(z => [z, G.zoneName(z)]) }, { key: 'age', label: 'Antigüedad', options: B.BUCKETS.map(b => [b, b]) }, { key: 'st', label: 'Estado', options: [['ACTIVE', 'Activo'], ['BLOCKED', 'Bloqueado'], ['SUSPENDED', 'Suspendido'], ['NONE', 'Contado']] }, { key: 'type', label: 'Tipo', options: Object.entries(CTYPE) }] }));
  }

  /* ---------- B2B-02 Ficha de crédito ---------- */
  function scr02(el, params) {
    const cid = pickCust(params); B._lastCust = cid; const c = D.get('customers', cid) || {}; const p = B.profile(cid); const canM = G.can('b2b.credit.manage');
    const body = page(el, { code: 'B2B-02', title: 'Ficha de crédito', sub: 'Límite, plazo, días de gracia, bloqueo automático por vencido, revisión periódica e historial de cambios con motivo (RN-B2B-20).', actions: [custSel(cid, v => G.go('B2B-02', { id: v }))] });
    if (p) body.appendChild(kpis([{ label: 'Límite', value: F.money(p.credit_limit, 0), sub: `plazo ${p.term_days} días · gracia ${p.grace_days}` }, { label: 'Saldo + sin facturar', value: F.money(B.exposure(cid)), sub: `${F.money(B.balance(cid))} comprobantes + ${F.money(B.unbilled(cid))} pedidos` }, { label: 'Disponible', value: F.money(B.available(cid)), tone: B.available(cid) < 0 ? 'bad' : 'ok' }, { label: 'Estado', value: G.ui.statusLabel(B.effStatus(cid)), sub: B.isBlocked(cid) ? (p.blocked_reason || `vencido ${B.overdueDays(cid)} días`) : 'puede comprar a crédito', tone: B.isBlocked(cid) ? 'bad' : 'ok' }]));
    else body.appendChild(notice(`${G.custName(cid)} compra al contado. ${c.doc_type === 'RUC' && B2B_TYPES.includes(c.customer_type) ? 'Registra su ficha de crédito con un motivo.' : 'RN-B2B-01: solo un cliente con RUC y tipo restaurante, negocio o punto de consignación puede tener crédito.'}`, 'info'));
    const f = form({ id: 'b2b-prof', fields: [
      { key: 'credit_limit', label: 'Límite de crédito (S/)', type: 'money', required: true, min: 0 }, { key: 'term_days', label: 'Plazo (días calendario)', type: 'number', required: true, min: 0, max: 120, help: 'Vencimiento = emisión + plazo (RN-B2B-08)' },
      { key: 'grace_days', label: 'Días de gracia', type: 'number', required: true, min: 0, max: 60 }, { key: 'block_on_overdue', label: 'Bloqueo automático por vencido', type: 'checkbox' },
      { key: 'review_on', label: 'Revisar el', type: 'date' }, { key: 'seller_user_id', label: 'Vendedora', type: 'select', options: D.where('users', u => ['VENDEDORA', 'SUPERVISORA_VENTAS'].includes(u.role)).map(u => [u.id, u.name]) },
      { key: 'reason', label: 'Motivo del cambio', type: 'textarea', required: true, placeholder: 'D-B2B-01: plazo 15 días; límite caso por caso' },
    ], values: p ? Object.assign({}, p, { reason: '' }) : { credit_limit: 3000, term_days: P('b2b_default_term_days') ?? 15, grace_days: P('b2b_grace_days') ?? 5, block_on_overdue: true, review_on: G.date.addMonths(G.TODAY, 6), seller_user_id: c.seller_user_id }, submitLabel: canM ? (p ? 'Guardar cambios' : 'Crear ficha') : false, onSubmit: v => { B.saveProfile(cid, v, v.reason); B.refresh(cid); toast('Condición de crédito guardada con motivo', 'ok'); G.refresh(); return true; } });
    const hist = p ? (p.history || []).slice().reverse() : [];
    body.appendChild(h('div', { class: 'grid c2' }, card('Condición de crédito', h('div', { class: 'stack' }, f, p ? h('div', { class: 'row' }, B.effStatus(cid) === 'BLOCKED' ? btn('Desbloquear', () => askReason('Desbloquear crédito', r => B.unblock(cid, r), 'Crédito desbloqueado'), { sm: true, disabled: !canM }) : btn('Bloquear', () => askReason('Bloquear crédito', r => B.block(cid, r), 'Crédito bloqueado'), { sm: true, kind: 'danger', disabled: !canM }), btn('Estado de cuenta', () => G.go('B2B-07', { id: cid }), { sm: true }), btn('Precios', () => G.go('B2B-03', { id: cid }), { sm: true })) : null)),
      card('Historial de cambios', hist.length ? h('div', { class: 'timeline' }, hist.map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.datetime(x.at)), h('span', { class: 'dot' }), h('div', null, h('b', null, { credit_limit: 'Límite', term_days: 'Plazo', grace_days: 'Gracia', status: 'Estado', block_on_overdue: 'Bloqueo automático', review_on: 'Revisión', seller_user_id: 'Vendedora' }[x.field] || x.field), `: ${x.field === 'credit_limit' && x.before != null ? F.money(x.before, 0) : x.before ?? '—'} → ${x.field === 'credit_limit' ? F.money(x.after, 0) : x.after}`, h('div', { class: 'small muted' }, `${x.user} · ${x.reason}`))))) : G.ui.empty('Sin cambios registrados.'))));
    const prom = D.where(T.prom, x => x.customer_id === cid);
    if (prom.length) body.appendChild(notice(`Promesas de pago: ${prom.filter(x => x.status === 'KEPT').length} cumplidas, ${prom.filter(x => x.status === 'BROKEN').length} incumplidas (cuentan en la revisión del crédito, RN-B2B-19).`, prom.some(x => x.status === 'BROKEN') ? 'warn' : 'info'));
  }

  /* ---------- B2B-03 Precios del cliente ---------- */
  function scr03(el, params) {
    const cid = pickCust(params); B._lastCust = cid; const canP = G.can('b2b.price.manage');
    const body = page(el, { code: 'B2B-03', title: 'Precios del cliente', sub: 'Precio por presentación con vigencia y base (unidad o kg); compara con la lista del canal y el costo promedio. Los precios bajo margen se aprueban (RN-B2B-07).', actions: [custSel(cid, v => G.go('B2B-03', { id: v })), btn('Nuevo precio', () => priceForm(cid), { kind: 'primary', disabled: !canP })] });
    const rows = B.prices(cid).map(p => { const v = G.variant(p.variant_id); const list = G.db.find('price_list_items', x => x.list_id === `pl-${v.brand_id.slice(3)}-B2B` && x.variant_id === v.id && !x.valid_to); const cost = B.costOf(v.id); const st = p.status === 'ACTIVE' && p.valid_to && p.valid_to < G.TODAY ? 'EXPIRED' : p.status === 'ACTIVE' && p.valid_from > G.TODAY ? 'SCHEDULED' : p.status; return Object.assign({}, p, { v, list: list ? list.price : null, cost, margin: p.unit_price ? R((p.unit_price / (1 + G.tax.rate()) - cost) / (p.unit_price / (1 + G.tax.rate())) * 100, 1) : 0, st }); });
    const pend = D.where(T.price, p => p.status === 'PENDING_APPROVAL');
    body.appendChild(kpis([{ label: 'Precios vigentes', value: rows.filter(r => r.st === 'ACTIVE').length }, { label: 'Por aprobar (bajo margen)', value: pend.length, sub: 'todos los clientes', tone: pend.length ? 'warn' : 'ok' }, { label: 'Margen mínimo', value: (P('b2b_min_margin_pct') ?? 10) + ' %', sub: 'sobre el costo promedio' }]));
    body.appendChild(table({ id: 'b2b03', rows, columns: [
      { key: 'v', label: 'Presentación', render: r => r.v.name, value: r => r.v.name }, { key: 'unit_price', label: 'Precio cliente', align: 'r', render: r => h('b', null, `${F.money(r.unit_price)}/${r.price_basis === 'KG' ? 'kg' : 'u'}`) }, { key: 'list', label: 'Lista B2B', align: 'r', render: r => r.list ? F.money(r.list) : '—' },
      { key: 'diff', label: 'vs lista', align: 'r', render: r => r.list ? F.pct((r.unit_price - r.list) / r.list * 100, 1) : '—' }, { key: 'cost', label: 'Costo prom.', align: 'r', render: r => F.money(r.cost) }, { key: 'margin', label: 'Margen', align: 'r', render: r => badge(F.pct(r.margin, 1), r.unit_price < B.minPrice(r.variant_id) ? 'bad' : 'ok') },
      { key: 'vig', label: 'Vigencia', render: r => r.valid_from ? `${F.date(r.valid_from)} – ${r.valid_to ? F.date(r.valid_to) : 'indefinido'}` : `solicitado ${F.date(r.req_valid_from)} – ${r.req_valid_to ? F.date(r.req_valid_to) : 'indefinido'}`, value: r => r.valid_from || r.req_valid_from }, { key: 'st', label: 'Estado', render: r => r.st === 'SCHEDULED' ? badge('Programado', 'info') : status(r.st) },
      { key: 'ap', label: 'Aprobó bajo margen', render: r => r.below_margin_approved_by ? G.userShort(r.below_margin_approved_by) : '—' },
    ], actions: r => [r.status === 'PENDING_APPROVAL' ? btn('Aprobar', () => askReason('Aprobar precio bajo margen', n => B.decidePrice(r, true, n), 'Precio aprobado'), { sm: true, kind: 'primary', disabled: !G.can('b2b.price.approve_below_margin') }) : null, r.status === 'PENDING_APPROVAL' ? btn('Rechazar', () => askReason('Rechazar precio', n => B.decidePrice(r, false, n), 'Precio rechazado'), { sm: true }) : null, r.st === 'ACTIVE' ? btn('Cerrar vigencia', () => tryDo(() => B.closePrice(r, G.TODAY), 'Vigencia cerrada hoy'), { sm: true, disabled: !canP }) : null] }));
    if (pend.length) body.appendChild(card('Bandeja de aprobación (todos los clientes)', table({ id: 'b2b03p', search: false, rows: pend, columns: [{ key: 'customer_id', label: 'Cliente', render: r => G.custName(r.customer_id) }, { key: 'variant_id', label: 'Presentación', render: r => G.variantName(r.variant_id) }, { key: 'unit_price', label: 'Precio', align: 'r', render: r => F.money(r.unit_price) }, { key: 'min_price', label: 'Mínimo', align: 'r', render: r => F.money(r.min_price) }, { key: 'requested_by', label: 'Solicitó', render: r => G.userShort(r.requested_by) }] }), { flush: true }));
    body.appendChild(notice('G.price.of usa el precio del cliente antes que la lista del canal (RN-B2B-06): los pedidos de PED, del portal y de las corridas lo toman automáticamente.', 'info'));
  }
  function priceForm(cid) {
    drawer('Nuevo precio · ' + G.custName(cid), (bd, close) => {
      const info = h('div', { class: 'small muted' });
      bd.appendChild(form({ id: 'b2b-pr', fields: [
        { key: 'variant_id', label: 'Presentación', type: 'select', required: true, options: D.where('product_variants', v => v.sellable && v.status === 'ACTIVE').map(v => [v.id, `${v.name} · ${G.brandName(v.brand_id)}`]), onChange: (v, vals, api) => { const vv = G.variant(v); api.set('price_basis', vv.sale_mode === 'UNIT' ? 'UNIT' : 'KG'); info.textContent = `Costo promedio ${F.money(B.costOf(v))} · mínimo sin aprobación ${F.money(B.minPrice(v))}`; } },
        { key: 'unit_price', label: 'Precio (con IGV)', type: 'money', required: true, onChange: (v, vals) => { if (vals.variant_id) info.textContent = `Costo promedio ${F.money(B.costOf(vals.variant_id))} · mínimo ${F.money(B.minPrice(vals.variant_id))}${v < B.minPrice(vals.variant_id) ? ' · bajo margen: requiere aprobación de GERENTE' : ''}`; } },
        { key: 'price_basis', label: 'Base', type: 'select', required: true, options: [['KG', 'Por kg'], ['UNIT', 'Por unidad']] }, { key: 'valid_from', label: 'Vigente desde', type: 'date', required: true }, { key: 'valid_to', label: 'Vigente hasta', type: 'date' }, { key: 'notes', label: 'Notas', type: 'textarea' },
      ], values: { valid_from: G.TODAY }, onCancel: close, onSubmit: v => { const r = B.savePrice(Object.assign({ customer_id: cid }, v)); close(); toast(r.status === 'PENDING_APPROVAL' ? 'RN-B2B-07: precio bajo el margen mínimo, queda por aprobar' : 'Precio registrado', r.status === 'PENDING_APPROVAL' ? 'warn' : 'ok'); G.refresh(); return true; } }));
      bd.appendChild(info);
    }, { code: 'B2B-03' });
  }

  /* ---------- B2B-04 Excepciones de crédito ---------- */
  function scr04(el) {
    const body = page(el, { code: 'B2B-04', title: 'Excepciones de crédito', sub: 'Solicitudes por pedido (monto excedido o vencido) con aprobación de otra persona y vigencia de 48 horas (RN-B2B-05).', actions: [{ label: 'Solicitar excepción', kind: 'primary', disabled: !(G.can('b2b.exception.request') || G.can('b2b.exception.approve')), onClick: () => excForm() }] });
    const rows = D.all(T.exc).map(x => Object.assign({}, x, { st: B.excStatus(x) })).sort((a, b) => String(b.requested_at || b.created_at).localeCompare(String(a.requested_at || a.created_at)));
    body.appendChild(kpis([{ label: 'Pendientes', value: rows.filter(r => r.st === 'PENDING').length, tone: rows.some(r => r.st === 'PENDING') ? 'warn' : 'ok' }, { label: 'Aprobadas vigentes', value: rows.filter(r => r.st === 'APPROVED').length, sub: `${P('b2b_exception_valid_hours')} h, un solo pedido` }, { label: 'Usadas', value: rows.filter(r => r.st === 'USED').length }, { label: 'Rechazadas o vencidas', value: rows.filter(r => ['REJECTED', 'EXPIRED'].includes(r.st)).length }]));
    body.appendChild(table({ id: 'b2b04', rows, columns: [
      { key: 'requested_at', label: 'Solicitud', render: r => F.datetime(r.requested_at || r.created_at) }, { key: 'customer_id', label: 'Cliente', render: r => G.custName(r.customer_id) }, { key: 'order', label: 'Pedido', mono: true, render: r => (D.get('sales_orders', r.order_id) || {}).number },
      { key: 'order_amount', label: 'Pedido', align: 'r', render: r => F.money(r.order_amount) }, { key: 'exceeded_amount', label: 'Excede', align: 'r', render: r => r.exceeded_amount ? F.money(r.exceeded_amount) : '—' }, { key: 'overdue_amount', label: 'Vencido', align: 'r', render: r => r.overdue_amount ? F.money(r.overdue_amount) : '—' },
      { key: 'requested_by', label: 'Solicitó', render: r => G.userShort(r.requested_by) }, { key: 'reason', label: 'Motivo' }, { key: 'st', label: 'Estado', render: r => status(r.st) }, { key: 'decided_by', label: 'Decidió', render: r => r.decided_by ? `${G.userShort(r.decided_by)} · vale hasta ${F.datetime(r.valid_until)}` : '—' },
    ], filters: [{ key: 'st', label: 'Estado', options: [['PENDING', 'Pendiente'], ['APPROVED', 'Aprobada'], ['USED', 'Usada'], ['REJECTED', 'Rechazada'], ['EXPIRED', 'Vencida']] }],
    actions: r => r.st === 'PENDING' ? [btn('Aprobar', () => askReason('Aprobar excepción', n => B.decideException(D.get(T.exc, r.id), true, n), 'Excepción aprobada por 48 h'), { sm: true, kind: 'primary' }), btn('Rechazar', () => askReason('Rechazar excepción', n => B.decideException(D.get(T.exc, r.id), false, n), 'Excepción rechazada'), { sm: true })] : r.st === 'APPROVED' ? [btn('Confirmar pedido', () => tryDo(() => B.confirm(r.order_id), 'Pedido confirmado con la excepción'), { sm: true })] : [] }));
  }
  function excForm() {
    const cand = D.where('sales_orders', o => o.status === 'DRAFT' && o.payment_method_id === 'pm-CREDIT' && !B.check(o).ok && !D.find(T.exc, e => e.order_id === o.id && ['PENDING', 'APPROVED'].includes(e.status)));
    drawer('Solicitar excepción de crédito', (bd, close) => {
      if (!cand.length) return bd.appendChild(G.ui.empty('No hay pedidos a crédito en borrador bloqueados por crédito.'));
      bd.appendChild(form({ id: 'b2b-ex', fields: [{ key: 'order_id', label: 'Pedido', type: 'select', required: true, options: cand.map(o => [o.id, `${o.number} · ${G.custName(o.customer_id)} · ${F.money(o.estimated_total)} · ${B.check(o).code}`]) }, { key: 'reason', label: 'Motivo', type: 'textarea', required: true }], onCancel: close, onSubmit: v => { B.requestException(D.get('sales_orders', v.order_id), v.reason); close(); toast('Excepción solicitada: la decide GERENTE o ADMINISTRACION', 'ok'); G.refresh(); return true; } }));
    }, { code: 'B2B-04' });
  }

  /* ---------- B2B-05 Pedidos recurrentes ---------- */
  const freqText = ro => ro.frequency === 'WEEKLY' ? (ro.weekdays || []).map(d => WD[d]).join(' y ') : ro.frequency === 'EVERY_N_DAYS' ? `cada ${ro.interval_days} días` : `día ${ro.day_of_month} de cada mes`;
  function scr05(el) {
    const canR = G.can('b2b.recurring.manage');
    const body = page(el, { code: 'B2B-05', title: 'Pedidos recurrentes', sub: 'Programación por cliente: días o cada N días, franja, dirección, líneas, anticipación y confirmación automática o revisión. Los precios se toman en la corrida (RN-B2B-11).', actions: [{ label: 'Programar pedido', kind: 'primary', icon: '+', disabled: !canR, onClick: () => roForm() }] });
    const rows = D.all(T.ro).map(ro => Object.assign({}, ro, { lines: B.roLines(ro.id), next: B.nextDates(ro, G.date.add(G.TODAY, 1), 1)[0] }));
    body.appendChild(table({ id: 'b2b05', rows, onRow: r => roDrawer(r), columns: [
      { key: 'customer_id', label: 'Cliente', render: r => G.custName(r.customer_id) }, { key: 'name', label: 'Programación' }, { key: 'freq', label: 'Frecuencia', render: r => freqText(r) }, { key: 'slot', label: 'Franja', render: r => `${r.slot_from}–${r.slot_to}` },
      { key: 'lines', label: 'Líneas', render: r => r.lines.map(l => `${num(l.qty, G.variant(l.variant_id).sale_mode === 'KG' ? 1 : 0)} ${G.variant(l.variant_id).sale_mode === 'KG' ? 'kg' : 'u'} ${G.variantName(l.variant_id)}`).join(' · ') },
      { key: 'auto_confirm', label: 'Confirmación', render: r => r.auto_confirm ? badge('Automática', 'ok') : badge('Revisión', 'info') }, { key: 'next', label: 'Próxima entrega', render: r => r.status === 'ACTIVE' && r.next ? `${WD[isoDow(r.next)]} ${F.date(r.next)}` : '—' }, { key: 'status', label: 'Estado', render: r => status(r.status) },
    ], actions: r => [btn(r.status === 'ACTIVE' ? 'Pausar' : 'Reactivar', () => tryDo(() => { if (!canR) G.fail('RN-B2B-09', 'Exige b2b.recurring.manage.'); D.update(T.ro, r.id, { status: r.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }); }, r.status === 'ACTIVE' ? 'Programación pausada' : 'Programación activa'), { sm: true, disabled: !canR || r.status === 'ENDED' })] }));
    body.appendChild(notice(`Corrida: ${P('b2b_recurring_lead_days')} día antes de la entrega a las ${P('b2b_recurring_run_time')}. Si el cliente está bloqueado o sin disponible, el pedido queda en borrador y se avisa a la vendedora y al cliente (RN-B2B-10). Los feriados se omiten.`, 'info'));
  }
  function roDrawer(ro) {
    drawer(ro.name, (bd, close) => {
      bd.appendChild(dl([['Cliente', G.custName(ro.customer_id)], ['Marca', G.brandName(ro.brand_id)], ['Dirección', (D.get('customer_addresses', ro.address_id) || {}).address_line], ['Frecuencia', freqText(ro)], ['Franja', `${ro.slot_from}–${ro.slot_to}`], ['Anticipación', ro.lead_days + ' día(s)'], ['Desde', F.date(ro.starts_on)], ['Hasta', F.date(ro.ends_on)], ['Confirmación', ro.auto_confirm ? 'Automática (si cumple crédito)' : 'Revisión de la vendedora'], ['Comprobante', G.docTypeName(ro.requested_doc_type)]]));
      bd.appendChild(table({ id: 'b2b05l', search: false, rows: B.roLines(ro.id), columns: [{ key: 'variant_id', label: 'Producto', render: r => G.variantName(r.variant_id) }, { key: 'qty', label: 'Cantidad', align: 'r', render: r => num(r.qty, 1) }, { key: 'price', label: 'Precio hoy', align: 'r', render: r => { const p = G.price.of(r.variant_id, { channel: 'B2B', customer_id: ro.customer_id }); return p ? `${F.money(p.price)}/${p.basis === 'KG' ? 'kg' : 'u'}${p.list_id === 'CUSTOMER' ? ' · cliente' : ''}` : '—'; } }, { key: 'cut_notes', label: 'Corte' }] }));
      bd.appendChild(h('h3', null, 'Próximas entregas')); bd.appendChild(h('div', { class: 'row' }, B.nextDates(ro, G.date.add(G.TODAY, 1), 6).map(d => badge(`${WD[isoDow(d)]} ${F.date(d)}${B.isHoliday(d) ? ' · feriado' : ''}`, B.isHoliday(d) ? 'warn' : 'info'))));
      bd.appendChild(h('div', { class: 'row' }, btn('Editar', () => { close(); roForm(ro); }, { sm: true, disabled: !G.can('b2b.recurring.manage') }), btn('Ver corridas', () => { G.ui.closeAll(); G.go('B2B-06'); }, { sm: true })));
    }, { code: 'B2B-05', wide: true });
  }
  function roForm(existing) {
    drawer(existing ? 'Editar ' + existing.name : 'Programar pedido recurrente', (bd, close) => {
      const st = { lines: existing ? B.roLines(existing.id).map(l => ({ variant_id: l.variant_id, qty: l.qty, cut_notes: l.cut_notes })) : [{ variant_id: 'va-DG-CUY-DES', qty: 10 }] };
      const linesBox = h('div', { class: 'stack' });
      const drawLines = () => { G.ui.clear(linesBox); st.lines.forEach((l, i) => { const s = h('select', { class: 'input', attrs: { 'aria-label': 'Producto' } }, D.where('product_variants', v => v.sellable && v.status === 'ACTIVE').map(v => h('option', { value: v.id, selected: v.id === l.variant_id }, `${v.name} · ${G.brandName(v.brand_id)}`))); s.addEventListener('change', () => { l.variant_id = s.value; }); const q = h('input', { class: 'input', type: 'number', min: 0.5, step: 0.5, value: l.qty, style: 'width:90px', attrs: { 'aria-label': 'Cantidad' } }); q.addEventListener('input', () => { l.qty = Number(q.value); }); linesBox.appendChild(h('div', { class: 'row' }, s, q, btn('Quitar', () => { st.lines.splice(i, 1); drawLines(); }, { sm: true, kind: 'ghost' }))); }); linesBox.appendChild(btn('Agregar línea', () => { st.lines.push({ variant_id: 'va-DG-CAL-1L', qty: 6 }); drawLines(); }, { sm: true })); };
      drawLines();
      const f = form({ id: 'b2b-ro', fields: [
        { key: 'customer_id', label: 'Cliente', type: 'select', required: true, options: B.customers().map(c => [c.id, G.custName(c.id)]), onChange: (v, vals, api) => { const a = D.find('customer_addresses', x => x.customer_id === v && x.is_default); api.set('address_id', a ? a.id : ''); } },
        { key: 'address_id', label: 'Dirección', type: 'select', required: true, options: D.where('customer_addresses', a => B2B_TYPES.includes((D.get('customers', a.customer_id) || {}).customer_type)).map(a => [a.id, `${G.custName(a.customer_id)} · ${a.address_line}`]) },
        { key: 'name', label: 'Nombre', required: true }, { key: 'frequency', label: 'Frecuencia', type: 'select', required: true, options: [['WEEKLY', 'Días de la semana'], ['EVERY_N_DAYS', 'Cada N días'], ['MONTHLY', 'Mensual']] },
        { key: 'weekdays', label: 'Días (1 = lunes … 7 = domingo, separados por coma)', help: 'Ej.: 1,4 para lunes y jueves' }, { key: 'interval_days', label: 'Cada N días', type: 'number', min: 1 }, { key: 'day_of_month', label: 'Día del mes', type: 'number', min: 1, max: 28 },
        { key: 'slot_from', label: 'Franja', type: 'select', required: true, options: [['09:00', '09:00–13:00'], ['13:00', '13:00–17:00'], ['17:00', '17:00–20:00']] }, { key: 'lead_days', label: 'Anticipación (días)', type: 'number', min: 0, max: 7 },
        { key: 'starts_on', label: 'Desde', type: 'date', required: true }, { key: 'ends_on', label: 'Hasta', type: 'date' }, { key: 'auto_confirm', label: 'Confirmar automáticamente si cumple crédito', type: 'checkbox' },
      ], values: existing ? Object.assign({}, existing, { weekdays: (existing.weekdays || []).join(',') }) : { customer_id: 'cu-B001', address_id: 'ad-B001', frequency: 'WEEKLY', weekdays: '1,4', slot_from: '09:00', lead_days: P('b2b_recurring_lead_days'), starts_on: G.date.add(G.TODAY, 1), auto_confirm: true, name: 'Pedido fijo semanal' }, onCancel: close,
        onSubmit: v => { const slot = { '09:00': '13:00', '13:00': '17:00', '17:00': '20:00' }; B.saveRecurring(Object.assign({}, v, { weekdays: String(v.weekdays || '').split(',').map(x => Number(x.trim())).filter(x => x >= 1 && x <= 7), slot_to: slot[v.slot_from] }), st.lines, existing); close(); toast('Pedido recurrente programado', 'ok'); G.refresh(); return true; } });
      bd.append(f, h('h3', null, 'Líneas'), linesBox);
      f.querySelector('.form-actions') && bd.appendChild(f.querySelector('.form-actions'));
    }, { code: 'B2B-05', wide: true });
  }

  /* ---------- B2B-06 Calendario de corridas ---------- */
  function scr06(el) {
    const rt = P('b2b_recurring_run_time');
    const body = page(el, { code: 'B2B-06', title: 'Calendario de corridas', sub: `Próximas corridas (cada día a las ${rt}) y resultado de las anteriores: creado, confirmado, omitido, bloqueado por crédito o fallido, con enlace al pedido.`, actions: [btn(`Ejecutar corrida de hoy ${rt}`, () => { const r = B.runRecurring(G.TODAY + 'T' + rt, {}); toast(r.ran ? `${r.ran} corrida(s) ejecutada(s)` : 'Nada nuevo: la corrida es idempotente (una por programación y fecha, RN-B2B-09)', r.ran ? 'ok' : 'info'); G.refresh(); }, { kind: 'primary', disabled: !G.can('b2b.recurring.manage') }), btn('Ejecutar de nuevo', () => { const r = B.runRecurring(G.TODAY + 'T' + rt, {}); toast(r.ran ? `${r.ran} corrida(s)` : 'Sin duplicados: ya existía la corrida de cada programación y fecha', 'info'); G.refresh(); }, { disabled: !G.can('b2b.recurring.manage') })] });
    const up = []; for (let i = 0; i < 10; i++) { const runDay = G.date.add(G.TODAY, i); for (const ro of D.where(T.ro, x => x.status === 'ACTIVE')) { const del = G.date.add(runDay, ro.lead_days); if (B.occurs(ro, del)) { const done = D.find(T.run, r => r.recurring_order_id === ro.id && r.delivery_date === del); up.push({ runDay, del, ro, done }); } } }
    const runs = D.all(T.run).sort((a, b) => String(b.run_at).localeCompare(String(a.run_at)));
    const m = runs.filter(r => r.delivery_date >= G.date.month(G.TODAY));
    body.appendChild(kpis([{ label: 'Corridas del mes', value: m.length }, { label: 'Con pedido', value: F.pct(m.length ? m.filter(r => ['CREATED', 'CONFIRMED'].includes(r.status)).length / m.length * 100 : 0, 0), sub: 'KPI-B2B-05', tone: 'ok' }, { label: 'Bloqueadas por crédito', value: m.filter(r => r.status === 'BLOCKED_CREDIT').length, tone: m.some(r => r.status === 'BLOCKED_CREDIT') ? 'bad' : 'ok' }, { label: 'Omitidas o fallidas', value: m.filter(r => ['SKIPPED', 'FAILED'].includes(r.status)).length }]));
    body.appendChild(h('div', { class: 'grid c2' }, card('Próximas corridas', table({ id: 'b2b06u', search: false, pageSize: 10, rows: up, columns: [{ key: 'runDay', label: 'Corrida', render: r => `${WD[isoDow(r.runDay)]} ${F.date(r.runDay)} ${rt}` }, { key: 'del', label: 'Entrega', render: r => `${WD[isoDow(r.del)]} ${F.date(r.del)}` }, { key: 'c', label: 'Cliente', render: r => G.custName(r.ro.customer_id) }, { key: 'st', label: 'Estado', render: r => r.done ? badge(RUN[r.done.status][0], RUN[r.done.status][1]) : B.isHoliday(r.del) ? badge('Feriado: se omitirá', 'warn') : B.isBlocked(r.ro.customer_id) ? badge('Cliente bloqueado', 'bad') : badge('Programada', 'info') }] }), { flush: true }),
      card('Resultado de las corridas', table({ id: 'b2b06r', pageSize: 10, rows: runs, columns: [{ key: 'run_at', label: 'Corrida', render: r => F.datetime(r.run_at) }, { key: 'delivery_date', label: 'Entrega', render: r => F.date(r.delivery_date) }, { key: 'c', label: 'Cliente', render: r => G.custName((D.get(T.ro, r.recurring_order_id) || {}).customer_id), value: r => G.custName((D.get(T.ro, r.recurring_order_id) || {}).customer_id) }, { key: 'status', label: 'Resultado', render: r => badge(RUN[r.status][0], RUN[r.status][1]) }, { key: 'order', label: 'Pedido', mono: true, render: r => { const o = D.get('sales_orders', r.order_id); return o ? h('span', null, o.number, ' ', status(o.status)) : '—'; } }, { key: 'message', label: 'Detalle' }], filters: [{ key: 'status', label: 'Resultado', options: Object.entries(RUN).map(([k, v]) => [k, v[0]]) }] }), { flush: true })));
  }

  /* ---------- B2B-07 Estado de cuenta ---------- */
  function statementView(cid, portal) {
    const mv = B.statement(cid); const p = B.profile(cid);
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(kpis([{ label: 'Saldo', value: F.money(B.balance(cid)) }, { label: 'Vencido', value: F.money(B.overdueAmount(cid)), sub: B.overdueDays(cid) ? `${B.overdueDays(cid)} días de mora` : 'sin mora', tone: B.overdueAmount(cid) ? 'bad' : 'ok' }, { label: 'Disponible', value: p ? F.money(B.available(cid)) : 'Contado', sub: p ? `límite ${F.money(p.credit_limit, 0)} · plazo ${p.term_days} días` : '' }, { label: 'Estado de crédito', value: G.ui.statusLabel(B.effStatus(cid) === 'NONE' ? 'NOT_APPLICABLE' : B.effStatus(cid)), tone: B.isBlocked(cid) ? 'bad' : 'ok' }]));
    wrap.appendChild(table({ id: (portal ? 'p' : '') + 'b2b07', rows: mv.slice().reverse(), columns: [
      { key: 'date', label: 'Fecha', render: r => F.date(r.date) }, { key: 'ref', label: 'Documento' }, { key: 'due', label: 'Vence', render: r => r.kind === 'DOC' ? F.date(r.due) : '—' },
      { key: 'mora', label: 'Mora', align: 'r', render: r => r.kind === 'DOC' && r.doc.balance > 0.009 ? ageBadge(G.date.diff(G.TODAY, r.due)) : r.kind === 'DOC' ? badge('Pagado', 'ok') : '—' },
      { key: 'charge', label: 'Cargo', align: 'r', render: r => r.charge ? F.money(r.charge) : '' }, { key: 'credit', label: 'Abono', align: 'r', render: r => r.credit ? F.money(r.credit) : '' }, { key: 'balance', label: 'Saldo', align: 'r', render: r => h('b', null, F.money(r.balance)) },
    ], filters: [{ key: 'kind', label: 'Tipo', options: [['DOC', 'Comprobantes'], ['NC', 'Notas de crédito'], ['PAY', 'Cobros']] }] }));
    return wrap;
  }
  const exportStatement = cid => { const mv = B.statement(cid); const lines = ['Fecha;Documento;Vence;Cargo;Abono;Saldo'].concat(mv.map(m => [m.date, m.ref, m.due || '', m.charge, m.credit, m.balance].join(';'))); try { const a = h('a', { attrs: { href: URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' })), download: `estado-de-cuenta-${G.custName(cid).replace(/\W+/g, '-')}.csv` } }); document.body.appendChild(a); a.click(); a.remove(); } catch (e) { } toast('Estado de cuenta exportado (Excel/CSV)', 'ok'); };
  function scr07(el, params) {
    const cid = pickCust(params); B._lastCust = cid;
    const body = page(el, { code: 'B2B-07', title: 'Estado de cuenta', sub: 'Comprobantes a crédito, notas de crédito, cobros y saldo corrido, con vencimientos y días de mora.', actions: [custSel(cid, v => G.go('B2B-07', { id: v })), btn('Excel', () => exportStatement(cid), { sm: true }), btn('PDF', () => G.print(), { sm: true })] });
    body.appendChild(statementView(cid, false));
  }

  /* ---------- B2B-08 Cartera por antigüedad ---------- */
  function scr08(el, params) {
    const by = params.by || 'customer';
    const body = page(el, { code: 'B2B-08', title: 'Cartera por antigüedad', sub: 'Saldo por tramos (por vencer, 1–15, 16–30, 31–60, más de 60 días) por cliente, vendedora y marca.', actions: [pills([['customer', 'Por cliente'], ['seller', 'Por vendedora'], ['brand', 'Por marca']], by, v => G.go('B2B-08', { by: v }))] });
    const ag = B.aging(); const tot = {}; for (const k of B.BUCKETS) tot[k] = R(U.sum(ag, r => r.b[k]));
    const all = R(U.sum(ag, r => r.total));
    body.appendChild(kpis(B.BUCKETS.map((k, i) => ({ label: k === 'Por vencer' ? k : k + ' días', value: F.money(tot[k], 0), sub: F.pct(all ? tot[k] / all * 100 : 0, 0), tone: i === 0 ? 'ok' : i === 1 ? 'warn' : 'bad' }))));
    let rows;
    if (by === 'customer') rows = ag.map(r => Object.assign({ key: r.c.id, name: G.custName(r.c.id), total: r.total }, r.b));
    else { const groups = {}; for (const r of ag) for (const d of r.docs) { const k = by === 'seller' ? ((B.profile(r.c.id) || {}).seller_user_id || r.c.seller_user_id || '—') : d.brand_id; const g = groups[k] = groups[k] || Object.assign({ key: k, name: by === 'seller' ? G.userName(k) : G.brandName(k), total: 0 }, Object.fromEntries(B.BUCKETS.map(b => [b, 0]))); const b = B.bucket(d.due_date ? G.date.diff(G.TODAY, d.due_date) : 0); g[b] = R(g[b] + d.balance); g.total = R(g.total + d.balance); } rows = Object.values(groups); }
    body.appendChild(table({ id: 'b2b08' + by, rows, onRow: by === 'customer' ? r => G.go('B2B-07', { id: r.key }) : null, columns: [{ key: 'name', label: by === 'customer' ? 'Cliente' : by === 'seller' ? 'Vendedora' : 'Marca' }].concat(B.BUCKETS.map((k, i) => ({ key: k, label: k, align: 'r', render: r => r[k] ? h('span', { style: i >= 2 ? 'color:var(--bad)' : '' }, F.money(r[k])) : '—' }))).concat([{ key: 'total', label: 'Total', align: 'r', render: r => h('b', null, F.money(r.total)) }]), footer: ['Total'].concat(B.BUCKETS.map(k => F.money(tot[k]))).concat([F.money(all)]) }));
    body.appendChild(card('Composición de la cartera', chart.bar({ labels: B.BUCKETS, series: [{ name: 'Saldo', values: B.BUCKETS.map(k => tot[k]) }], format: v => F.money(v, 0) })));
  }

  /* ---------- B2B-09 Recordatorios y promesas ---------- */
  function scr09(el) {
    const canC = G.can('b2b.collection.manage');
    const body = page(el, { code: 'B2B-09', title: 'Recordatorios y promesas', sub: 'Recordatorios por comprobante (3 días antes, el día y a 3 y 7 días de vencido) con plantilla de utilidad; promesas de pago con fecha y cumplimiento.', actions: [btn('Enviar pendientes de hoy', () => { const r = B.sendDue(G.TODAY); toast(`${r.sent} recordatorio(s) enviado(s) por WhatsApp (plantilla de utilidad S/ ${num(G.msg.cost('UTILITY'), 4)} c/u) · ${r.cancelled} cancelado(s) por pago`, 'ok'); G.refresh(); }, { kind: 'primary', disabled: !canC }), btn('Evaluar promesas', () => { const n = B.evalPromises(); toast(`${n} promesa(s) actualizadas (RN-B2B-19)`, 'info'); G.refresh(); }, { disabled: !canC })] });
    const rem = D.all(T.rem).sort((a, b) => b.scheduled_for.localeCompare(a.scheduled_for)); const prom = D.all(T.prom).sort((a, b) => b.promised_date.localeCompare(a.promised_date));
    body.appendChild(kpis([{ label: 'Pendientes de envío hoy', value: rem.filter(r => r.status === 'SCHEDULED' && r.scheduled_for <= G.TODAY).length, tone: 'warn' }, { label: 'Programados', value: rem.filter(r => r.status === 'SCHEDULED').length }, { label: 'Enviados', value: rem.filter(r => r.status === 'SENT').length }, { label: 'Promesas incumplidas', value: prom.filter(p => p.status === 'BROKEN').length, sub: 'no levantan el bloqueo', tone: prom.some(p => p.status === 'BROKEN') ? 'bad' : 'ok' }]));
    body.appendChild(tabs([
      { key: 'r', label: 'Recordatorios', count: rem.length, render: pn => pn.appendChild(table({ id: 'b2b09r', rows: rem, columns: [{ key: 'scheduled_for', label: 'Programado', render: r => F.date(r.scheduled_for) }, { key: 'customer_id', label: 'Cliente', render: r => G.custName(r.customer_id) }, { key: 'doc', label: 'Comprobante', mono: true, render: r => G.docs.label(D.get('sales_documents', r.document_id)) }, { key: 'reminder_type', label: 'Tipo', render: r => REM[r.reminder_type] }, { key: 'channel', label: 'Canal', render: r => r.channel === 'WHATSAPP' ? 'WhatsApp' : 'Correo' }, { key: 'status', label: 'Estado', render: r => status(r.status) }, { key: 'sent_at', label: 'Enviado', render: r => F.datetime(r.sent_at) }], filters: [{ key: 'status', label: 'Estado', options: [['SCHEDULED', 'Programado'], ['SENT', 'Enviado'], ['CANCELLED', 'Cancelado']] }, { key: 'reminder_type', label: 'Tipo', options: Object.entries(REM) }] })) },
      { key: 'p', label: 'Promesas de pago', count: prom.length, render: pn => { pn.appendChild(h('div', { class: 'row', style: 'margin-bottom:10px' }, btn('Registrar promesa', () => promForm(), { sm: true, kind: 'primary', disabled: !canC }))); pn.appendChild(table({ id: 'b2b09p', rows: prom, columns: [{ key: 'customer_id', label: 'Cliente', render: r => G.custName(r.customer_id) }, { key: 'doc', label: 'Comprobante', mono: true, render: r => r.document_id ? G.docs.label(D.get('sales_documents', r.document_id)) : 'Saldo vencido' }, { key: 'promised_date', label: 'Promete pagar', render: r => F.date(r.promised_date) }, { key: 'amount', label: 'Monto', align: 'r', render: r => F.money(r.amount) }, { key: 'recorded_by', label: 'Registró', render: r => G.userShort(r.recorded_by) }, { key: 'status', label: 'Estado', render: r => r.status === 'BROKEN' ? badge('Incumplida', 'bad') : r.status === 'KEPT' ? badge('Cumplida', 'ok') : status(r.status) }, { key: 'notes', label: 'Notas' }] })); } },
    ]));
  }
  function promForm() {
    drawer('Registrar promesa de pago', (bd, close) => bd.appendChild(form({ id: 'b2b-pm', fields: [{ key: 'document_id', label: 'Comprobante', type: 'select', required: true, options: D.where('sales_documents', d => openDoc(d) && B2B_TYPES.includes((D.get('customers', d.customer_id) || {}).customer_type)).map(d => [d.id, `${G.custName(d.customer_id)} · ${G.docs.label(d)} · ${F.money(d.balance)} · vence ${F.date(d.due_date)}`]) }, { key: 'promised_date', label: 'Fecha prometida', type: 'date', required: true }, { key: 'amount', label: 'Monto', type: 'money', required: true }, { key: 'notes', label: 'Notas', type: 'textarea' }], values: { promised_date: G.date.add(G.TODAY, 3) }, onCancel: close, onSubmit: v => { const d = D.get('sales_documents', v.document_id); B.addPromise(Object.assign({ customer_id: d.customer_id }, v)); close(); toast('Promesa registrada (no levanta el bloqueo, RN-B2B-19)', 'ok'); G.refresh(); return true; } })), { code: 'B2B-09' });
  }

  /* ---------- B2B-10 Reclamos B2B ---------- */
  function claimDrawer(c, portal) {
    drawer(`Reclamo ${c.number}`, (bd, close) => {
      const o = D.get('sales_orders', c.order_id); const nc = c.credit_note_id && D.get('sales_documents', c.credit_note_id); const due = B.claimDue(c); const late = !c.first_response_at && nowIso() > due;
      bd.appendChild(h('div', { class: 'row' }, status(c.status), badge(CLAIM[c.claim_type], 'info'), late ? badge('Plazo de respuesta vencido', 'bad') : null));
      bd.appendChild(dl([['Cliente', G.custName(c.customer_id)], ['Pedido', o ? `${o.number} · entregado ${F.date((o.delivered_at || '').slice(0, 10))}` : '—'], ['Registrado', F.datetime(c.opened_at || c.created_at)], ['Responder antes de', F.datetime(due)], ['Descripción', c.description], ['Fotos', (c.photo_urls || []).map(x => x.split('/').pop()).join(', ') || '—'], ['Primera respuesta', c.first_response_at ? `${F.datetime(c.first_response_at)} · ${c.response || ''}` : 'Pendiente'], ['Resolución', c.resolution ? `${RESOL[c.resolution]} · ${c.resolution_note || ''}` : '—'], ['Nota de crédito', nc ? `${G.docs.label(nc)} · ${F.money(nc.total)}` : '—']]));
      if (portal || !['OPEN', 'IN_REVIEW'].includes(c.status)) return;
      const canR = G.can('b2b.claim.resolve');
      const resp = h('textarea', { class: 'input', placeholder: 'Respuesta al cliente', attrs: { 'aria-label': 'Respuesta' } });
      const resSel = h('select', { class: 'input', attrs: { 'aria-label': 'Resolución' } }, Object.entries(RESOL).map(([k, l]) => h('option', { value: k }, l)));
      const amt = h('input', { class: 'input', type: 'number', placeholder: 'Monto del abono (S/)', attrs: { 'aria-label': 'Monto' } });
      bd.appendChild(h('div', { class: 'stack' }, resp, h('div', { class: 'row' }, btn('Responder', () => { if (tryDo(() => B.respondClaim(c, resp.value.trim()), 'Respuesta registrada')) { close(); } }, { sm: true, disabled: !canR })), h('div', { class: 'row' }, resSel, amt), h('div', { class: 'row' }, btn('Resolver', () => { if (tryDo(() => B.resolveClaim(D.get(T.claim, c.id), { resolution: resSel.value, note: resp.value.trim(), amount: Number(amt.value) }), 'Reclamo resuelto')) close(); }, { sm: true, kind: 'primary', disabled: !canR }), btn('Rechazar', () => { if (tryDo(() => B.resolveClaim(D.get(T.claim, c.id), { reject: true, note: resp.value.trim() }), 'Reclamo rechazado')) close(); }, { sm: true, kind: 'danger', disabled: !canR }))));
    }, { code: portal ? 'B2B-16' : 'B2B-10' });
  }
  function claimsTable(rows, id, portal) {
    return table({ id, rows: rows.sort((a, b) => String(b.opened_at || b.created_at).localeCompare(String(a.opened_at || a.created_at))), onRow: r => claimDrawer(r, portal), columns: [
      { key: 'number', label: 'Reclamo', mono: true }, { key: 'opened_at', label: 'Fecha', render: r => F.datetime(r.opened_at || r.created_at) }, portal ? null : { key: 'customer_id', label: 'Cliente', render: r => G.custName(r.customer_id) },
      { key: 'claim_type', label: 'Tipo', render: r => CLAIM[r.claim_type] }, { key: 'order', label: 'Pedido', mono: true, render: r => (D.get('sales_orders', r.order_id) || {}).number }, { key: 'description', label: 'Descripción', render: r => r.description.length > 60 ? r.description.slice(0, 58) + '…' : r.description },
      { key: 'due', label: 'Plazo', render: r => r.first_response_at ? badge(`Respondido en ${num(hoursBetween(r.opened_at || r.created_at.slice(0, 16), r.first_response_at), 0)} h`, 'ok') : badge(`Antes de ${F.datetime(B.claimDue(r))}`, nowIso() > B.claimDue(r) ? 'bad' : 'warn') },
      { key: 'status', label: 'Estado', render: r => status(r.status) }, { key: 'resolution', label: 'Resolución', render: r => r.resolution ? RESOL[r.resolution] : '—' },
    ].filter(Boolean), filters: [{ key: 'status', label: 'Estado', options: [['OPEN', 'Abierto'], ['IN_REVIEW', 'En revisión'], ['RESOLVED', 'Resuelto'], ['REJECTED', 'Rechazado']] }, { key: 'claim_type', label: 'Tipo', options: Object.entries(CLAIM) }] });
  }
  function scr10(el) {
    const body = page(el, { code: 'B2B-10', title: 'Reclamos B2B', sub: 'Bandeja interna: tipo, evidencia, plazo de respuesta de 48 h, responsable, resolución y nota de crédito enlazada (RN-B2B-17).' });
    const rows = D.all(T.claim); const open = rows.filter(r => ['OPEN', 'IN_REVIEW'].includes(r.status));
    const resp = rows.filter(r => r.first_response_at);
    body.appendChild(kpis([{ label: 'Abiertos', value: open.length, tone: open.length ? 'warn' : 'ok' }, { label: 'Fuera de plazo', value: open.filter(r => !r.first_response_at && nowIso() > B.claimDue(r)).length, tone: open.some(r => !r.first_response_at && nowIso() > B.claimDue(r)) ? 'bad' : 'ok' }, { label: 'Respuesta promedio', value: resp.length ? num(U.sum(resp, r => hoursBetween(r.opened_at || r.created_at.slice(0, 16), r.first_response_at)) / resp.length, 1) + ' h' : '—', sub: 'KPI-B2B-08' }, { label: 'Con nota de crédito', value: rows.filter(r => r.credit_note_id).length }]));
    body.appendChild(claimsTable(rows, 'b2b10', false));
  }

  /* ---------- B2B-11 Accesos al portal ---------- */
  function inviteUser(cid, d) {
    if (!d.name || !d.email) G.fail('RN-B2B-12', 'Nombre y correo son obligatorios.');
    if (D.find('users', u => (u.email || '').toLowerCase() === d.email.toLowerCase())) G.fail('RN-B2B-12', 'Ya existe un usuario con ese correo.');
    const u = D.insert('users', { id: 'us-portal-' + U.token(6).toLowerCase(), name: d.name, email: d.email, role: 'CLIENTE_B2B', user_type: 'B2B_CUSTOMER', customer_id: cid, brands: [], sites: [], status: 'ACTIVE', twofa_enabled: false, last_login: null });
    return D.insert(T.acc, { customer_id: cid, user_id: u.id, portal_role: d.portal_role || 'BUYER', can_order: d.portal_role !== 'ACCOUNTING', can_view_statement: true, invited_by: G.ctx.userId(), invited_at: nowIso(), status: 'INVITED' });
  }
  function accountsTable(rows, id, canM) {
    return table({ id, rows, columns: [
      { key: 'user', label: 'Usuario', render: r => (D.get('users', r.user_id) || {}).name }, { key: 'email', label: 'Correo', render: r => (D.get('users', r.user_id) || {}).email }, id === 'b2b11' ? { key: 'customer_id', label: 'Cliente', render: r => G.custName(r.customer_id) } : null,
      { key: 'portal_role', label: 'Rol', render: r => PROLE[r.portal_role] }, { key: 'can_order', label: 'Pide', render: r => r.can_order ? 'Sí' : 'No' }, { key: 'invited', label: 'Invitado', render: r => r.invited_by ? `${G.userShort(r.invited_by)} · ${F.date(r.invited_at)}` : '—' },
      { key: 'last', label: 'Último ingreso', render: r => F.datetime((D.get('users', r.user_id) || {}).last_login) }, { key: 'status', label: 'Estado', render: r => r.status === 'INVITED' ? badge('Invitado', 'info') : r.status === 'DISABLED' ? badge('Desactivado', 'bad') : status(r.status) },
    ].filter(Boolean), actions: r => canM && r.portal_role !== 'OWNER' ? [btn(r.status === 'DISABLED' ? 'Activar' : 'Desactivar', () => tryDo(() => { D.update(T.acc, r.id, { status: r.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED' }); D.update('users', r.user_id, { status: r.status === 'DISABLED' ? 'ACTIVE' : 'INACTIVE' }); }, r.status === 'DISABLED' ? 'Usuario activado' : 'Usuario desactivado'), { sm: true })] : [] });
  }
  function inviteForm(cid) {
    drawer('Invitar usuario al portal', (bd, close) => bd.appendChild(form({ id: 'b2b-inv', fields: [{ key: 'name', label: 'Nombre', required: true }, { key: 'email', label: 'Correo', required: true }, { key: 'portal_role', label: 'Rol en el portal', type: 'select', required: true, options: Object.entries(PROLE).filter(([k]) => k !== 'OWNER') }], onCancel: close, onSubmit: v => { inviteUser(cid, v); close(); toast('Invitación enviada por correo (simulada)', 'ok'); G.refresh(); return true; } })), { code: 'B2B-11' });
  }
  function scr11(el) {
    const body = page(el, { code: 'B2B-11', title: 'Accesos al portal', sub: 'Usuarios del cliente (dueño, comprador, contabilidad): invitación, bloqueo y último ingreso. Cada usuario está ligado a un solo cliente (RN-B2B-12).' });
    const rows = D.all(T.acc);
    body.appendChild(kpis([{ label: 'Usuarios del portal', value: rows.length }, { label: 'Activos', value: rows.filter(r => r.status === 'ACTIVE').length }, { label: 'Invitaciones pendientes', value: rows.filter(r => r.status === 'INVITED').length, tone: 'info' }, { label: 'Clientes con portal', value: new Set(rows.map(r => r.customer_id)).size }]));
    const sel = custSel(B._lastCust || 'cu-B001', v => { B._lastCust = v; });
    body.appendChild(h('div', { class: 'row' }, sel, btn('Invitar usuario', () => tryDo(() => inviteForm(sel.value)), { kind: 'primary', sm: true, disabled: !G.canDo('B2B', 'C') })));
    body.appendChild(accountsTable(rows, 'b2b11', G.canDo('B2B', 'E')));
  }

  /* =================================================================
     Portal del cliente (B2B-12 … B2B-17)
     ================================================================= */
  const cart = { cust: null, items: {}, date: null, slot: '09:00', notes: '', repeat_of: null };
  const resetCart = cid => { cart.cust = cid; cart.items = {}; cart.date = null; cart.notes = ''; cart.repeat_of = null; };
  function portalPage(el, code, title, sub, actions) {
    const cid = B.portalCustomer(); if (cart.cust !== cid) resetCart(cid);
    const c = D.get('customers', cid) || {}; const br = D.get('brands', 'br-DG') || {};
    const body = page(el, { code, title, sub, actions });
    const banner = h('div', { class: 'card', style: `padding:10px 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-left:4px solid ${br.primary_color || 'var(--primary)'}` }, h('div', { style: 'min-width:0;flex:1' }, h('b', null, 'Portal de pedidos · Don Guando'), h('div', { class: 'small muted' }, `${c.full_name} · RUC ${c.doc_number}`)), effBadge(cid));
    if (G.ctx.role !== 'CLIENTE_B2B') { const s = custSel(cid, v => { B._preview = v; G.refresh(); }, B.customers().filter(x => D.find(T.acc, a => a.customer_id === x.id) || x.id === B._preview)); banner.appendChild(h('div', { class: 'row small' }, 'Vista previa como:', s)); }
    body.appendChild(banner);
    return { body, cid, c };
  }
  const priceTxt = pr => pr ? `${F.money(pr.price)}/${pr.basis === 'KG' ? 'kg' : 'u'}` : '—';
  const avail = vid => { const q = U.sum(G.inv.saleWarehouses('es-L1').concat(G.inv.saleWarehouses('es-L2')), w => G.inv.qty(vid, w.id, { available: true, releasedOnly: true })); const v = G.variant(vid); const lim = v.sale_mode === 'KG' ? 5 : 6; return q <= 0 ? badge('Se programa', 'warn') : q < lim ? badge('Pocas unidades', 'warn') : badge('Disponible', 'ok'); };
  function scr12(el) {
    const { body, cid } = portalPage(el, 'B2B-12', 'Portal · Catálogo', 'Productos con el precio de tu empresa, disponibilidad y presentación. Agrega al carrito y envía tu pedido en «Pedido nuevo».', [btn('Ir al carrito', () => G.go('B2B-13'), { kind: 'primary' })]);
    const c = D.get('customers', cid) || {}; const brands = (c.segment_brands && c.segment_brands.length ? c.segment_brands : ['br-DG', 'br-M2', 'br-M3']);
    const rows = D.where('product_variants', v => v.sellable && v.status === 'ACTIVE' && (brands.includes(v.brand_id) || D.find(T.price, p => p.customer_id === cid && p.variant_id === v.id))).map(v => ({ v, pr: G.price.of(v.id, { brand_id: v.brand_id, channel: 'B2B', customer_id: cid }) })).filter(r => r.pr);
    const inCart = Object.keys(cart.items).length;
    if (inCart) body.appendChild(notice(`Tienes ${inCart} producto(s) en el carrito.`, 'info'));
    body.appendChild(table({ id: 'pb2b12', rows, columns: [
      { key: 'v', label: 'Producto', render: r => h('div', null, h('b', null, r.v.name), h('div', { class: 'small muted' }, `${G.brandName(r.v.brand_id)} · ${G.saleModeName(r.v.sale_mode)}${r.v.nominal_weight_kg ? ' · ~' + F.kg(r.v.nominal_weight_kg, 2) + ' c/u' : ''}`)), value: r => r.v.name },
      { key: 'price', label: 'Tu precio', align: 'r', render: r => h('span', null, h('b', null, priceTxt(r.pr)), r.pr.list_id === 'CUSTOMER' ? h('div', null, badge('Precio pactado', 'primary')) : null), value: r => r.pr.price },
      { key: 'avail', label: 'Disponibilidad', render: r => avail(r.v.id), value: () => '' },
      { key: 'add', label: '', sort: false, render: r => { const q = h('input', { class: 'input', type: 'number', min: r.v.min_order_qty, step: r.v.qty_step, value: cart.items[r.v.id] ? cart.items[r.v.id].qty : '', placeholder: r.v.sale_mode === 'KG' ? 'kg' : 'u', style: 'width:72px', attrs: { 'aria-label': 'Cantidad ' + r.v.name } }); return h('div', { class: 'row', style: 'flex-wrap:nowrap' }, q, btn('Agregar', () => { const n = Number(q.value); if (!(n > 0)) return toast('Indica la cantidad.', 'warn'); cart.items[r.v.id] = { qty: n }; toast(`${r.v.name} en el carrito`, 'ok'); G.refresh(); }, { sm: true })); } },
    ], filters: [{ key: 'brand', label: 'Marca', options: brands.map(b => [b, G.brandName(b)]), value: r => r.v.brand_id }, { key: 'line', label: 'Línea', options: [...new Set(rows.map(r => r.v.line))].map(l => [l, l]), value: r => r.v.line }] }));
  }
  function scr13(el, params) {
    const { body, cid } = portalPage(el, 'B2B-13', 'Portal · Pedido nuevo y repetir', `Carrito con pedido mínimo de ${F.money(P('b2b_min_order_amount'))}, hora de corte ${P('b2b_cutoff_time')} para entrega al día siguiente y fecha de entrega. «Repetir pedido» copia un pedido anterior con los precios de hoy y te muestra la diferencia.`);
    const acc = B.portalAccount(); const canOrder = G.ctx.role !== 'CLIENTE_B2B' || !acc || acc.can_order;
    const earliest = B.earliestDate(); if (!cart.date || cart.date < earliest) cart.date = earliest;
    const prev = B.portal.orders().filter(o => ['DELIVERED', 'CLOSED'].includes(o.status)).slice(0, 12);
    const repSel = h('select', { class: 'input', attrs: { 'aria-label': 'Pedido a repetir', id: 'b2b-rep' } }, h('option', { value: '' }, 'Elige un pedido anterior…'), prev.map(o => h('option', { value: o.id, selected: cart.repeat_of === o.id }, `${o.number} · ${F.date(o.delivery_date)} · ${F.money(o.final_total ?? o.estimated_total)}`)));
    repSel.addEventListener('change', () => { if (!repSel.value) return; const o = D.get('sales_orders', repSel.value); cart.items = {}; cart.repeat_of = o.id; for (const l of B.repeatLines(o)) if (l.active) cart.items[l.variant_id] = { qty: l.qty, est_weight_kg: l.est_weight_kg, old_price: l.old_price }; G.refresh(); });
    body.appendChild(card('Repetir pedido', h('div', { class: 'stack' }, h('div', { class: 'row' }, repSel), cart.repeat_of ? (() => { const o = D.get('sales_orders', cart.repeat_of); const rl = B.repeatLines(o); return h('div', { class: 'stack' }, table({ id: 'pb2b13r', search: false, rows: rl, columns: [{ key: 'variant_id', label: 'Producto', render: r => G.variantName(r.variant_id) }, { key: 'qty', label: 'Cant.', align: 'r', render: r => num(r.qty, 2) }, { key: 'old_price', label: 'Precio anterior', align: 'r', render: r => `${F.money(r.old_price)}/${r.basis === 'KG' ? 'kg' : 'u'}` }, { key: 'new_price', label: 'Precio hoy', align: 'r', render: r => r.new_price != null ? `${F.money(r.new_price)}/${r.basis === 'KG' ? 'kg' : 'u'}` : badge('No disponible', 'bad') }, { key: 'diff', label: 'Diferencia', align: 'r', render: r => r.diff == null ? '—' : badge(`${r.diff > 0 ? '+' : ''}${F.money(r.diff)}/${r.basis === 'KG' ? 'kg' : 'u'}`, r.diff > 0 ? 'warn' : r.diff < 0 ? 'ok' : '') }] }), h('div', { class: 'small muted' }, 'RN-B2B-15: se copian las líneas con los precios vigentes. Revisa la diferencia antes de enviar.')); })() : null)));
    const lines = Object.entries(cart.items).map(([vid, it]) => { const v = G.variant(vid); const pr = G.price.of(vid, { brand_id: v.brand_id, channel: 'B2B', customer_id: cid }); const kg = v.sale_mode === 'KG' ? it.qty : v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? R(it.qty * v.nominal_weight_kg, 3) : null; const amt = pr ? R((pr.basis === 'KG' ? kg : it.qty) * pr.price) : 0; return { vid, v, it, pr, kg, amt }; });
    const total = R(U.sum(lines, l => l.amt)); const min = P('b2b_min_order_amount') ?? 150;
    const tb = table({ id: 'pb2b13c', search: false, rows: lines, empty: 'El carrito está vacío: agrega productos desde el catálogo (B2B-12) o repite un pedido.', columns: [
      { key: 'v', label: 'Producto', render: r => r.v.name }, { key: 'qty', label: 'Cantidad', align: 'r', render: r => { const q = h('input', { class: 'input', type: 'number', min: 0, step: r.v.qty_step, value: r.it.qty, style: 'width:72px', attrs: { 'aria-label': 'Cantidad ' + r.v.name } }); q.addEventListener('change', () => { const n = Number(q.value); if (n > 0) cart.items[r.vid].qty = n; else delete cart.items[r.vid]; G.refresh(); }); return q; } },
      { key: 'kg', label: 'Peso estimado', align: 'r', render: r => r.kg != null ? F.kg(r.kg, 3) : '—' }, { key: 'pr', label: 'Precio', align: 'r', render: r => priceTxt(r.pr) }, { key: 'amt', label: 'Estimado', align: 'r', render: r => F.money(r.amt) },
    ], footer: ['Total estimado', '', '', '', h('b', null, F.money(total))] });
    const dateI = h('input', { class: 'input', type: 'date', value: cart.date, min: earliest, attrs: { id: 'b2b-date' } }); dateI.addEventListener('change', () => { cart.date = dateI.value; });
    const slotS = h('select', { class: 'input', attrs: { id: 'b2b-slot' } }, [['09:00', '09:00–13:00'], ['13:00', '13:00–17:00'], ['17:00', '17:00–20:00']].map(([v, l]) => h('option', { value: v, selected: cart.slot === v }, l))); slotS.addEventListener('change', () => { cart.slot = slotS.value; });
    const notes = h('input', { class: 'input', value: cart.notes, placeholder: 'Ej.: cuyes enteros abiertos, ingreso por cocina', attrs: { id: 'b2b-notes' } }); notes.addEventListener('input', () => { cart.notes = notes.value; });
    const p = B.profile(cid); const chk = p ? { blocked: B.isBlocked(cid), avail: B.available(cid) } : null;
    const now = G.date.now().slice(11, 16);
    body.appendChild(h('div', { class: 'grid side-r' }, card('Carrito', tb, { flush: true }), card('Entrega y envío', h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('label', { attrs: { for: 'b2b-date' } }, 'Fecha de entrega'), dateI, h('div', { class: 'help' }, `Hora ${now}: ${now < P('b2b_cutoff_time') ? 'antes' : 'después'} del corte de las ${P('b2b_cutoff_time')} → desde el ${F.date(earliest)}.`)),
      h('div', { class: 'field' }, h('label', { attrs: { for: 'b2b-slot' } }, 'Franja'), slotS), h('div', { class: 'field' }, h('label', { attrs: { for: 'b2b-notes' } }, 'Indicaciones de preparación'), notes),
      h('div', { class: 'row between' }, h('span', null, 'Pedido mínimo'), badge(`${F.money(total)} de ${F.money(min)}`, total >= min ? 'ok' : 'warn')),
      chk ? h('div', { class: 'row between' }, h('span', null, 'Crédito'), chk.blocked ? badge('Bloqueado: pagas al contado o la vendedora revisa', 'bad') : badge(`Disponible ${F.money(chk.avail)}`, chk.avail >= total ? 'ok' : 'warn')) : h('div', { class: 'small muted' }, 'Pago al contado (transferencia, Yape o Plin).'),
      btn('Enviar pedido', () => { const res = tryDo(() => B.portalOrder({ lines: lines.map(l => ({ variant_id: l.vid, qty: l.it.qty })), delivery_date: cart.date, slot_from: cart.slot, notes: cart.notes, repeat_of: cart.repeat_of })); if (res) { const ok = res.every(x => x.confirmed); toast(ok ? `Pedido ${res.map(x => x.order.number).join(', ')} confirmado para el ${F.date(cart.date)}` : `Pedido ${res.map(x => x.order.number).join(', ')} recibido: la vendedora lo revisa (${res.find(x => !x.confirmed).reason})`, ok ? 'ok' : 'warn'); resetCart(cid); G.go('B2B-14'); } }, { kind: 'primary', disabled: !lines.length || !canOrder }),
      !canOrder ? h('div', { class: 'small muted' }, 'Tu rol (contabilidad) no puede pedir.') : null))));
  }
  function scr14(el) {
    const { body } = portalPage(el, 'B2B-14', 'Portal · Mis pedidos', 'Estado y seguimiento de cada pedido, peso real y monto final.');
    const rows = B.portal.orders();
    body.appendChild(kpis([{ label: 'En curso', value: rows.filter(o => ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE'].includes(o.status)).length }, { label: 'Por revisar', value: rows.filter(o => o.status === 'DRAFT').length, sub: 'la vendedora los confirma', tone: rows.some(o => o.status === 'DRAFT') ? 'warn' : 'ok' }, { label: 'Entregados del mes', value: rows.filter(o => ['DELIVERED', 'CLOSED'].includes(o.status) && (o.delivered_at || '') >= G.date.month(G.TODAY)).length }, { label: 'Comprado del mes', value: F.money(U.sum(rows.filter(o => ['DELIVERED', 'CLOSED'].includes(o.status) && (o.delivered_at || '') >= G.date.month(G.TODAY)), o => o.final_total ?? o.estimated_total), 0) }]));
    body.appendChild(table({ id: 'pb2b14', rows, onRow: o => orderDrawer(o), columns: [
      { key: 'number', label: 'Pedido', mono: true }, { key: 'delivery_date', label: 'Entrega', render: o => `${F.date(o.delivery_date)} ${o.slot_from ? o.slot_from + '–' + o.slot_to : ''}` }, { key: 'status', label: 'Estado', render: o => status(o.status) },
      { key: 'kg', label: 'Peso real', align: 'r', render: o => { const w = o.lines.filter(l => l.price_basis === 'KG'); return w.length && w.every(l => l.weighed_kg != null) ? F.kg(U.sum(w, l => l.weighed_kg), 3) : w.length ? `≈ ${F.kg(o.est_kg, 3)}` : '—'; } },
      { key: 'final_total', label: 'Monto', align: 'r', render: o => o.final_total != null ? h('b', null, F.money(o.final_total)) : `≈ ${F.money(o.estimated_total)}` }, { key: 'pm', label: 'Pago', render: o => G.pmName(o.payment_method_id) }, { key: 'origin', label: 'Origen', render: o => o.portal_account_id ? badge('Portal', 'primary') : o.recurring_order_id ? badge('Recurrente', 'info') : badge('Vendedora', '') },
    ], filters: [{ key: 'status', label: 'Estado', options: G.ORDER_STATUS.map(s => [s, G.ui.statusLabel(s)]) }] }));
  }
  function orderDrawer(o) {
    drawer(`Pedido ${o.number}`, bd => {
      bd.appendChild(h('div', { class: 'row' }, status(o.status), o.weight_diff_status === 'NOTICE_SENT' ? badge('Diferencia de peso avisada', 'warn') : null));
      bd.appendChild(dl([['Entrega', `${F.date(o.delivery_date)} · ${o.slot_from || ''}–${o.slot_to || ''}`], ['Dirección', (D.get('customer_addresses', o.address_id) || {}).address_line], ['Pago', G.pmName(o.payment_method_id)], ['Estimado', F.money(o.estimated_total)], ['Final (peso real)', F.money(o.final_total)], ['Comprobante', (() => { const d = D.find('sales_documents', d => d.order_id === o.id && ['INVOICE', 'RECEIPT'].includes(d.doc_type)); return d ? G.docs.label(d) : '—'; })()]]));
      bd.appendChild(table({ id: 'pb2b14l', search: false, rows: o.lines, columns: [{ key: 'variant_id', label: 'Producto', render: l => G.variantName(l.variant_id) }, { key: 'qty', label: 'Cant.', align: 'r', render: l => num(l.qty, 2) }, { key: 'est', label: 'Peso est.', align: 'r', render: l => l.est_weight_kg != null ? F.kg(l.est_weight_kg, 3) : '—' }, { key: 'w', label: 'Peso real', align: 'r', render: l => l.weighed_kg != null ? F.kg(l.weighed_kg, 3) : '—' }, { key: 'p', label: 'Precio', align: 'r', render: l => `${F.money(l.unit_price)}/${l.price_basis === 'KG' ? 'kg' : 'u'}` }, { key: 'a', label: 'Monto', align: 'r', render: l => F.money(l.final_amount ?? l.est_amount) }] }));
      bd.appendChild(h('h3', null, 'Seguimiento')); bd.appendChild(h('div', { class: 'timeline' }, (o.history || []).map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.datetime(x.at)), h('span', { class: 'dot' }), h('div', null, G.ui.statusLabel(x.to), x.reason ? h('div', { class: 'small muted' }, x.reason) : null)))));
    }, { code: 'B2B-14', wide: true });
  }
  function scr15(el) {
    const { body, cid } = portalPage(el, 'B2B-15', 'Portal · Estado de cuenta y comprobantes', 'Saldo, vencidos y descarga de PDF, XML y CDR de los comprobantes aceptados por la SUNAT (RN-B2B-18).', [btn('Exportar Excel', () => exportStatement(cid), { sm: true })]);
    const acc = B.portalAccount(); if (G.ctx.role === 'CLIENTE_B2B' && acc && !acc.can_view_statement) { body.appendChild(notice('Tu usuario no tiene acceso al estado de cuenta.', 'warn')); return; }
    body.appendChild(statementView(cid, true));
    const docs = B.portal.docs().slice(0, 200);
    const dlBtn = (d, k) => btn(k, () => { try { const r = B.portal.download(d.id, k); G.audit('DESCARGA', 'sales_documents', d.id, `${k} desde el portal`); modal(r.name, bd => bd.appendChild(k === 'XML' ? h('pre', { class: 'mono small', style: 'white-space:pre-wrap;max-height:50vh;overflow:auto' }, `<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">\n  <cbc:ID>${d.series}-${d.number}</cbc:ID>\n  <cbc:IssueDate>${d.issue_date}</cbc:IssueDate>\n  <cac:AccountingCustomerParty><cbc:CustomerAssignedAccountID>${d.customer_doc_number}</cbc:CustomerAssignedAccountID></cac:AccountingCustomerParty>\n  <cac:TaxTotal><cbc:TaxAmount currencyID="PEN">${d.igv}</cbc:TaxAmount></cac:TaxTotal>\n  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="PEN">${d.total}</cbc:PayableAmount></cac:LegalMonetaryTotal>\n  <ds:DigestValue>${d.xml_hash || ''}</ds:DigestValue>\n</Invoice>`) : k === 'CDR' ? notice(`Constancia de recepción: el comprobante ${d.series}-${d.number} ha sido aceptado (código 0). Archivo R-${r.name}.`, 'ok') : dl([['Comprobante', G.docs.label(d)], ['Emisión', F.date(d.issue_date)], ['Vence', F.date(d.due_date)], ['Subtotal', F.money(d.subtotal)], ['IGV', F.money(d.igv)], ['Total', F.money(d.total)], ['Saldo', F.money(d.balance)]])), [{ label: 'Descargar', kind: 'primary', onClick: () => { toast(`${r.name} descargado (simulado)`, 'ok'); } }]); } catch (e) { err(e); } }, { sm: true, disabled: d.sunat_status !== 'ACCEPTED', title: d.sunat_status !== 'ACCEPTED' ? 'RN-B2B-18: solo comprobantes aceptados' : '' });
    body.appendChild(card('Mis comprobantes', table({ id: 'pb2b15d', rows: docs, columns: [{ key: 'issue_date', label: 'Emisión', render: d => F.date(d.issue_date) }, { key: 'doc', label: 'Comprobante', mono: true, render: d => G.docs.label(d), value: d => d.full_number }, { key: 'total', label: 'Total', align: 'r', render: d => F.money(d.total) }, { key: 'due_date', label: 'Vence', render: d => F.date(d.due_date) }, { key: 'balance', label: 'Saldo', align: 'r', render: d => d.balance > 0.009 ? F.money(d.balance) : badge('Pagado', 'ok') }, { key: 'sunat_status', label: 'SUNAT', render: d => status(d.sunat_status) }, { key: 'dl', label: 'Descargas', sort: false, render: d => h('div', { class: 'row', style: 'flex-wrap:nowrap;gap:4px' }, ['PDF', 'XML', 'CDR'].map(k => dlBtn(d, k))) }] }), { flush: true }));
  }
  const claimDraft = { photos: [] };
  function scr16(el) {
    const { body, cid } = portalPage(el, 'B2B-16', 'Portal · Reclamos', `Registra un reclamo con foto y sigue la respuesta (plazo ${P('b2b_claim_response_hours')} h).`);
    const orders = B.portal.orders().filter(o => ['DELIVERED', 'CLOSED'].includes(o.status)).slice(0, 20);
    const f = form({ id: 'pb2b16', fields: [
      { key: 'order_id', label: 'Pedido entregado', type: 'select', required: true, options: orders.map(o => [o.id, `${o.number} · ${F.date(o.delivery_date)} · ${F.money(o.final_total ?? o.estimated_total)}`]) },
      { key: 'claim_type', label: 'Tipo', type: 'select', required: true, options: Object.entries(CLAIM) }, { key: 'description', label: 'Qué pasó', type: 'textarea', required: true },
    ], values: { claim_type: 'WEIGHT' }, submitLabel: 'Enviar reclamo', onSubmit: v => { const o = D.get('sales_orders', v.order_id); const doc = D.find('sales_documents', d => d.order_id === o.id && ['INVOICE', 'RECEIPT'].includes(d.doc_type)); B.openClaim({ customer_id: cid, order_id: o.id, document_id: doc ? doc.id : null, claim_type: v.claim_type, description: v.description, photo_urls: claimDraft.photos.slice(), portal_account_id: (B.portalAccount() || {}).id }); claimDraft.photos = []; toast('Reclamo registrado: te respondemos en 48 horas', 'ok'); G.refresh(); return true; } });
    const phRow = h('div', { class: 'row' }, btn('Adjuntar foto', () => { claimDraft.photos.push(`reclamos/${cid}/foto-${claimDraft.photos.length + 1}.jpg`); G.refresh(); }, { sm: true }), claimDraft.photos.length ? badge(`${claimDraft.photos.length} foto(s)`, 'ok') : h('span', { class: 'small muted' }, 'Calidad y peso exigen al menos una foto (RN-B2B-17).'));
    body.appendChild(h('div', { class: 'grid c2' }, card('Nuevo reclamo', h('div', { class: 'stack' }, phRow, f)), card('Mis reclamos', claimsTable(B.portal.claims(), 'pb2b16t', true), { flush: true })));
  }
  function scr17(el) {
    const { body, cid } = portalPage(el, 'B2B-17', 'Portal · Usuarios de mi empresa', 'El dueño invita o desactiva compradores y personal de contabilidad de su empresa.');
    const acc = B.portalAccount(); const isOwner = G.ctx.role !== 'CLIENTE_B2B' ? G.canDo('B2B', 'E') : !!(acc && acc.portal_role === 'OWNER' && G.can('b2b.portal.manage_users'));
    if (!isOwner) body.appendChild(notice('Solo el dueño de la cuenta gestiona usuarios (b2b.portal.manage_users).', 'info'));
    body.appendChild(h('div', { class: 'row' }, btn('Invitar usuario', () => inviteForm(cid), { kind: 'primary', sm: true, disabled: !isOwner })));
    body.appendChild(accountsTable(B.portal.accounts(), 'pb2b17', isOwner));
  }

  /* ---------- registro ---------- */
  const PR = ['CLIENTE_B2B'];
  G.register({ code: 'B2B', name: 'Clientes empresariales', phase: 3, group: 'Nuevos canales', screens: [
    { code: 'B2B-01', name: 'Clientes empresariales', render: scr01 }, { code: 'B2B-02', name: 'Ficha de crédito', render: scr02 }, { code: 'B2B-03', name: 'Precios del cliente', render: scr03 }, { code: 'B2B-04', name: 'Excepciones de crédito', render: scr04 },
    { code: 'B2B-05', name: 'Pedidos recurrentes', render: scr05 }, { code: 'B2B-06', name: 'Calendario de corridas', render: scr06 }, { code: 'B2B-07', name: 'Estado de cuenta', render: scr07 }, { code: 'B2B-08', name: 'Cartera por antigüedad', render: scr08 },
    { code: 'B2B-09', name: 'Recordatorios y promesas', render: scr09 }, { code: 'B2B-10', name: 'Reclamos B2B', render: scr10 }, { code: 'B2B-11', name: 'Accesos al portal', render: scr11 },
    { code: 'B2B-12', name: 'Portal · Catálogo', render: scr12, roles: PR }, { code: 'B2B-13', name: 'Portal · Pedido nuevo y repetir', render: scr13, roles: PR }, { code: 'B2B-14', name: 'Portal · Mis pedidos', render: scr14, roles: PR },
    { code: 'B2B-15', name: 'Portal · Estado de cuenta y comprobantes', render: scr15, roles: PR }, { code: 'B2B-16', name: 'Portal · Reclamos', render: scr16, roles: PR }, { code: 'B2B-17', name: 'Portal · Usuarios de mi empresa', render: scr17, roles: PR },
  ] });
  // las pantallas internas no las ve el cliente del portal (el armazón ya lo filtra por roles)

  /* ---------- ganchos ---------- */
  G.alertProviders.push(() => {
    if (!G.canSee('B2B') || G.ctx.role === 'CLIENTE_B2B') return [];
    const out = []; const bl = D.all(T.prof).filter(p => B.isBlocked(p.customer_id));
    if (bl.length) out.push({ module: 'B2B', title: `${bl.length} cliente(s) B2B bloqueados para crédito`, detail: bl.map(p => G.custName(p.customer_id)).join(', '), tone: 'bad', go: () => G.go('B2B-01') });
    const ex = D.where(T.exc, x => x.status === 'PENDING'); if (ex.length) out.push({ module: 'B2B', title: `${ex.length} excepción(es) de crédito por decidir`, tone: 'warn', go: () => G.go('B2B-04') });
    const pr = D.where(T.price, x => x.status === 'PENDING_APPROVAL'); if (pr.length) out.push({ module: 'B2B', title: `${pr.length} precio(s) bajo margen por aprobar`, tone: 'warn', go: () => G.go('B2B-03', { id: pr[0].customer_id }) });
    const cl = D.where(T.claim, c => ['OPEN', 'IN_REVIEW'].includes(c.status) && !c.first_response_at); if (cl.length) out.push({ module: 'B2B', title: `${cl.length} reclamo(s) B2B sin respuesta`, detail: 'Plazo de 48 horas (RN-B2B-17)', tone: cl.some(c => nowIso() > B.claimDue(c)) ? 'bad' : 'warn', go: () => G.go('B2B-10') });
    const rb = D.where(T.run, r => r.status === 'BLOCKED_CREDIT' && r.delivery_date >= G.TODAY); if (rb.length) out.push({ module: 'B2B', title: `${rb.length} pedido(s) recurrente(s) bloqueados por crédito`, tone: 'bad', go: () => G.go('B2B-06') });
    return out;
  });
  G.searchProviders.push(q => {
    if (G.ctx.role === 'CLIENTE_B2B') return [];
    return B.customers().filter(c => G.custName(c.id).toLowerCase().includes(q) || (c.doc_number || '').includes(q)).slice(0, 5).map(c => ({ label: G.custName(c.id), sub: `Cliente empresarial · ${F.money(B.balance(c.id))} de saldo · B2B-02`, go: () => G.go('B2B-02', { id: c.id }) }));
  });

  /* ---------- indicadores ---------- */
  const isB2B = cid => B2B_TYPES.includes((D.get('customers', cid) || {}).customer_type);
  const b2bOrders = p => D.where('sales_orders', o => o.channel === 'B2B' && o.created_at.slice(0, 10) >= p.from && o.created_at.slice(0, 10) <= p.to && (!p.brand || o.brand_id === p.brand));
  G.kpiCalc['KPI-B2B-01'] = p => { const rec = U.sum(D.where('sales_documents', d => isB2B(d.customer_id) && openDoc(d) && d.issue_date <= p.to), d => d.balance); const sales = U.sum(D.where('sales_documents', d => isB2B(d.customer_id) && d.payment_terms === 'CREDIT' && d.doc_type === 'INVOICE' && d.issue_date >= p.from && d.issue_date <= p.to), d => d.total); const days = G.date.diff(p.to, p.from) + 1; return { value: sales ? R(rec / sales * days, 1) : 0, numerator: R(rec), denominator: R(sales) }; };
  G.kpiCalc['KPI-B2B-02'] = p => { const docs = D.where('sales_documents', d => isB2B(d.customer_id) && openDoc(d)); const tot = U.sum(docs, d => d.balance); const ov = U.sum(docs.filter(d => d.due_date && d.due_date < p.to), d => d.balance); return { value: tot ? R(ov / tot * 100, 1) : 0, numerator: R(ov), denominator: R(tot) }; };
  G.kpiCalc['KPI-B2B-03'] = p => { const ds = D.where('sales_documents', d => isB2B(d.customer_id) && d.sunat_status === 'ACCEPTED' && d.issue_date >= p.from && d.issue_date <= p.to && (!p.brand || d.brand_id === p.brand)); return R(U.sum(ds.filter(d => d.doc_type !== 'CREDIT_NOTE'), d => d.subtotal) - U.sum(ds.filter(d => d.doc_type === 'CREDIT_NOTE'), d => d.subtotal)); };
  G.kpiCalc['KPI-B2B-04'] = p => { const os = b2bOrders(p); const n = os.filter(o => o.portal_account_id).length; return { value: os.length ? R(n / os.length * 100, 1) : 0, numerator: n, denominator: os.length }; };
  G.kpiCalc['KPI-B2B-05'] = p => { const rs = D.where(T.run, r => r.delivery_date >= p.from && r.delivery_date <= p.to); const n = rs.filter(r => ['CREATED', 'CONFIRMED'].includes(r.status)).length; return { value: rs.length ? R(n / rs.length * 100, 1) : 0, numerator: n, denominator: rs.length }; };
  G.kpiCalc['KPI-B2B-06'] = () => D.all(T.prof).filter(x => B.isBlocked(x.customer_id)).length;
  G.kpiCalc['KPI-B2B-07'] = p => { const del = D.where('sales_orders', o => o.channel === 'B2B' && ['DELIVERED', 'CLOSED'].includes(o.status) && (o.delivered_at || '').slice(0, 10) >= p.from && (o.delivered_at || '').slice(0, 10) <= p.to).length; const cl = D.where(T.claim, c => (c.opened_at || c.created_at).slice(0, 10) >= p.from && (c.opened_at || c.created_at).slice(0, 10) <= p.to).length; return { value: del ? R(cl / del * 100, 1) : 0, numerator: cl, denominator: del }; };
  G.kpiCalc['KPI-B2B-08'] = p => { const cs = D.where(T.claim, c => c.first_response_at && (c.opened_at || c.created_at).slice(0, 10) >= p.from && (c.opened_at || c.created_at).slice(0, 10) <= p.to); return { value: cs.length ? R(U.sum(cs, c => hoursBetween(c.opened_at || c.created_at.slice(0, 16), c.first_response_at)) / cs.length, 1) : 0, denominator: cs.length }; };

  /* =================================================================
     Datos de ejemplo (orden 61)
     ================================================================= */
  G.seed(61, function seedB2B() {
    const r = U.rng(6161);
    // correlativos de pedidos y cobros del núcleo (ver NOTAS-B2B.md)
    const maxNum = (t, f, pre) => D.all(t).reduce((m, x) => { const n = Number(String(x[f] || '').replace(pre, '')); return n > m ? n : m; }, 0);
    for (const [k, t, f, pre] of [['PED', 'sales_orders', 'number', 'P-'], ['CB', 'payments', 'number', 'CB-']]) { const key = G.ctx.tenant + ':' + k; D.seq[key] = Math.max(D.seq[key] || 0, maxNum(t, f, pre)); }
    // fichas de crédito
    const PROF = [['cu-B001', 5000, 15, 5], ['cu-B002', 3000, 15, 5], ['cu-B003', 8000, 30, 10], ['cu-B004', 2000, 7, 5], ['cu-B005', 10000, 30, 5], ['cu-B006', 2500, 15, 5], ['cu-B007', 6000, 30, 5], ['cu-B009', 4000, 15, 5], ['cu-B010', 4000, 15, 5], ['cu-B011', 4000, 15, 5]];
    for (const [cid, lim, term, gr] of PROF) { const p = B.saveProfile(cid, { credit_limit: lim, term_days: term, grace_days: gr, block_on_overdue: true, review_on: '2027-01-15', seller_user_id: cid === 'cu-B005' || cid === 'cu-B007' ? 'us-evargas' : 'us-atorres' }, 'Alta de la ficha: D-B2B-01 plazo y límite caso por caso'); p.history[0].at = '2026-07-15T10:00'; p.history[0].user = 'Carmen Huamán'; }
    const p1 = B.profile('cu-B001'); B.saveProfile('cu-B001', { credit_limit: 5000 }, 'x'); p1.history.push({ at: '2026-09-02T11:30', user: 'Carmen Huamán', field: 'credit_limit', before: 3500, after: 5000, reason: 'Aumenta su compra a 2 pedidos fijos por semana' });
    // vencimientos según el plazo de cada cliente (RN-B2B-08) y cobranza de lo antiguo
    for (const d of D.where('sales_documents', d => d.payment_terms === 'CREDIT' && ['cu-B001', 'cu-B002', 'cu-B003', 'cu-B004', 'cu-B005', 'cu-B006', 'cu-B007', 'cu-B008'].includes(d.customer_id))) {
      const p = B.profile(d.customer_id); if (p) d.due_date = B.dueDateFor(d.issue_date, p.term_days);
      if (d.due_date < G.date.add(G.TODAY, 2) && d.balance > 0) G.pay.register({ customer_id: d.customer_id, payment_method_id: 'pm-TRANSFER', amount: d.balance, reference: 'OP' + (61000000 + Math.floor(r() * 999999)), cash_account_id: 'ca-BCP-CTE', allocations: [{ order_id: d.order_id, document_id: d.id, amount: d.balance }], brand_id: d.brand_id, establishment_id: d.establishment_id, at: G.date.add(d.due_date < G.TODAY ? d.due_date : G.TODAY, -1) + 'T15:20', silent: true });
    }
    // precios por cliente (cuy S/ 25/kg en setiembre y S/ 26/kg en octubre: CA-B2B-05 y 07)
    const PRICES = [['cu-B001', 'va-DG-CUY-ENT', 25, '2026-09-01', '2026-09-30', 'us-rquispe', 'Precio por volumen de 80 kg semanales'], ['cu-B001', 'va-DG-CUY-ENT', 26, '2026-10-01', '2026-10-31', 'us-rquispe', 'Ajuste de octubre: precio por volumen'], ['cu-B001', 'va-DG-CUY-DES', 62, '2026-09-01', null], ['cu-B001', 'va-DG-CAL-1L', 15.5, '2026-09-01', null], ['cu-B003', 'va-M2-BON-KG', 33, '2026-09-15', null], ['cu-B003', 'va-M2-ASA-KG', 37, '2026-09-15', null], ['cu-B005', 'va-DG-POL-ENT', 19.5, '2026-08-01', '2026-12-31'], ['cu-B002', 'va-DG-CUY-ENT', 36, '2026-09-01', null]];
    for (const [cid, vid, pr, from, to, ap, nt] of PRICES) B.savePrice({ customer_id: cid, variant_id: vid, unit_price: pr, valid_from: from, valid_to: to, approved_by: ap, notes: nt || null });
    B.savePrice({ customer_id: 'cu-B007', variant_id: 'va-M2-LOM-KG', unit_price: 64, valid_from: '2026-10-12', valid_to: null, requested_by: 'us-pleon', notes: 'Hotel pide lomo para su carta de temporada' });
    // pedidos B2B propios del escenario (precio vigente a la fecha del pedido)
    const mkOrder = (cid, date, lines, { st = 'CLOSED', pm = 'pm-CREDIT', slot = '09:00', portal = null, recurring = null, invoice = true, wdev = 0 } = {}) => {
      const addr = D.find('customer_addresses', a => a.customer_id === cid && a.is_default); const est = (D.get('delivery_zones', addr.zone_id) || {}).establishment_id || 'es-L1';
      const brand = G.variant(lines[0].variant_id).brand_id;
      const o = G.orders.create({ customer_id: cid, brand_id: brand, channel: 'B2B', fulfillment: 'DELIVERY', address_id: addr.id, delivery_date: date, slot_id: slotFor(est, slot).id, payment_method_id: pm, requested_doc_type: 'INVOICE', notes: recurring ? 'Pedido recurrente' : portal ? 'Pedido del portal B2B' : 'Pedido por WhatsApp de la vendedora', establishment_id: est, seller_id: (B.profile(cid) || {}).seller_user_id || 'us-atorres', lines, extra: { portal_account_id: portal, recurring_order_id: recurring } });
      for (const l of o.lines) { const pr = G.price.of(l.variant_id, { brand_id: brand, channel: 'B2B', customer_id: cid, date: G.date.add(date, -1) }); if (pr) { l.unit_price = pr.price; l.list_price = pr.price; l.price_basis = pr.basis; l.price_list_id = pr.list_id; } }
      o.created_at = G.date.add(date, -1) + 'T18:00'; o.history = [{ at: o.created_at, from: null, to: 'DRAFT', user: recurring ? 'Corrida automática' : portal ? 'Portal B2B' : 'Ana Torres' }];
      if (st !== 'DRAFT') { o.confirmed_at = o.created_at.slice(0, 11) + '18:01'; o.history.push({ at: o.confirmed_at, from: 'DRAFT', to: 'CONFIRMED', user: recurring ? 'Corrida automática' : 'Ana Torres' }); }
      if (['WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED', 'CLOSED'].includes(st)) { for (const l of o.lines) if (l.price_basis === 'KG') { l.weighed_kg = R(l.est_weight_kg * (1 + (wdev || (r() - 0.5) * 0.06)), 3); l.weight_source = 'SCALE'; } o.weight_diff_status = 'WITHIN_TOLERANCE'; }
      G.orders.recalc(o);
      if (['DELIVERED', 'CLOSED'].includes(st)) { o.delivered_at = date + 'T' + slot.slice(0, 2) + ':40'; o.driver_user_id = est === 'es-L2' ? 'us-jchoque' : 'us-pcondori'; o.history.push({ at: o.delivered_at, from: 'IN_ROUTE', to: 'DELIVERED', user: 'Pedro Condori' }); if (st === 'CLOSED') o.closed_at = o.delivered_at; }
      o.status = st; D.touch();
      let doc = null; if (invoice && ['DELIVERED', 'CLOSED'].includes(st)) { doc = G.docs.fromOrder(o, { date, silent: true, accept: true }); const p = B.profile(cid); if (p && doc.payment_terms === 'CREDIT') doc.due_date = B.dueDateFor(doc.issue_date, p.term_days); }
      return { o, doc };
    };
    const payDoc = (doc, at) => G.pay.register({ customer_id: doc.customer_id, payment_method_id: 'pm-TRANSFER', amount: doc.balance, reference: 'OP' + (62000000 + Math.floor(r() * 999999)), cash_account_id: 'ca-BCP-CTE', allocations: [{ order_id: doc.order_id, document_id: doc.id, amount: doc.balance }], brand_id: doc.brand_id, establishment_id: doc.establishment_id, at: at + 'T11:00', silent: true });
    // recurrente de El Cuy Dorado: lunes y jueves (10 kg de cuy deshuesado + caldos)
    const roCD = B.saveRecurring({ customer_id: 'cu-B001', address_id: 'ad-B001', name: 'Cuy de la semana (lun y jue)', frequency: 'WEEKLY', weekdays: [1, 4], slot_from: '09:00', slot_to: '13:00', lead_days: 1, starts_on: '2026-09-01', auto_confirm: true }, [{ variant_id: 'va-DG-CUY-DES', qty: 10 }, { variant_id: 'va-DG-CAL-1L', qty: 6 }]);
    for (let d = '2026-09-03'; d <= '2026-10-09'; d = G.date.add(d, 1)) {
      if (!B.occurs(roCD, d)) continue;
      if (B.isHoliday(d)) { D.insert(T.run, { recurring_order_id: roCD.id, delivery_date: d, run_at: G.date.add(d, -1) + 'T18:00', order_id: null, status: 'SKIPPED', message: 'Feriado: no hay reparto' }, { silent: true }); continue; }
      const { o, doc } = mkOrder('cu-B001', d, [{ variant_id: 'va-DG-CUY-DES', qty: 10, est_weight_kg: 10 }, { variant_id: 'va-DG-CAL-1L', qty: 6 }], { recurring: roCD.id });
      D.insert(T.run, { recurring_order_id: roCD.id, delivery_date: d, run_at: G.date.add(d, -1) + 'T18:00', order_id: o.id, status: 'CONFIRMED', message: 'Precios tomados en la corrida (RN-B2B-11)' }, { silent: true });
      if (doc && doc.due_date < '2026-10-08') payDoc(doc, G.date.add(doc.due_date, -2 + (r() < 0.3 ? 1 : 0)));
    }
    // El Cuy Dorado: pedido de setiembre con cuy entero a S/ 25/kg (CA-B2B-07) y pedidos del portal
    mkOrder('cu-B001', '2026-09-26', [{ variant_id: 'va-DG-CUY-ENT', qty: 20 }], { portal: 'pa-cd-owner', pm: 'pm-CREDIT' }).doc && null;
    const lastCuy = D.where('sales_orders', o => o.customer_id === 'cu-B001' && o.lines.some(l => l.variant_id === 'va-DG-CUY-ENT')).pop(); if (lastCuy) { const dd = D.find('sales_documents', x => x.order_id === lastCuy.id); if (dd) payDoc(dd, '2026-10-09'); }
    mkOrder('cu-B001', G.date.add(G.TODAY, 2), [{ variant_id: 'va-DG-CUY-ENT', qty: 12 }, { variant_id: 'va-DG-CAL-500', qty: 10 }], { st: 'CONFIRMED', portal: 'pa-cd-owner', slot: '13:00' });
    // recurrente de La Arequipeña (bloqueada) y de Parrillas del Sur
    const roAQ = B.saveRecurring({ customer_id: 'cu-B002', address_id: 'ad-B002', name: 'Cuyes para el fin de semana', frequency: 'WEEKLY', weekdays: [2, 6], slot_from: '09:00', slot_to: '13:00', lead_days: 1, starts_on: '2026-09-15', auto_confirm: true }, [{ variant_id: 'va-DG-CUY-ENT', qty: 12 }]);
    const roPS = B.saveRecurring({ customer_id: 'cu-B003', address_id: 'ad-B003', name: 'Parrilla de los viernes', frequency: 'WEEKLY', weekdays: [5], slot_from: '13:00', slot_to: '17:00', lead_days: 1, starts_on: '2026-09-04', auto_confirm: false }, [{ variant_id: 'va-M2-BON-KG', qty: 6 }, { variant_id: 'va-M2-ASA-KG', qty: 8 }]);
    B.saveRecurring({ customer_id: 'cu-B007', address_id: 'ad-B007', name: 'Pollo de corral para el buffet', frequency: 'EVERY_N_DAYS', interval_days: 3, slot_from: '09:00', slot_to: '13:00', lead_days: 1, starts_on: '2026-09-01', auto_confirm: true, status: 'PAUSED' }, [{ variant_id: 'va-DG-POL-ENT', qty: 15 }]);
    // La Arequipeña: factura del 18/09 a 15 días vencida el 03/10 (7 días) → bloqueada
    for (const d of ['2026-09-15', '2026-09-19', '2026-09-22', '2026-09-26', '2026-09-29', '2026-10-03', '2026-10-06']) {
      const { o, doc } = mkOrder('cu-B002', d, [{ variant_id: 'va-DG-CUY-ENT', qty: 12 }], { recurring: roAQ.id });
      D.insert(T.run, { recurring_order_id: roAQ.id, delivery_date: d, run_at: G.date.add(d, -1) + 'T18:00', order_id: o.id, status: 'CONFIRMED', message: 'Precios tomados en la corrida (RN-B2B-11)' }, { silent: true });
      if (doc && d !== '2026-09-19' && d < '2026-10-01') payDoc(doc, G.date.add(doc.due_date, -1));
    }
    const fAQ = D.where('sales_documents', d => d.customer_id === 'cu-B002' && d.issue_date === '2026-09-19')[0]; if (fAQ) { fAQ.issue_date = '2026-09-18'; fAQ.due_date = '2026-10-03'; }
    for (const p of D.all(T.prof)) B.refresh(p.customer_id, { at: G.date.add(G.TODAY, -1) + 'T06:00' });
    { const o = mkOrder('cu-B002', '2026-10-10', [{ variant_id: 'va-DG-CUY-ENT', qty: 12 }], { st: 'DRAFT', recurring: roAQ.id }).o; D.insert(T.run, { recurring_order_id: roAQ.id, delivery_date: '2026-10-10', run_at: '2026-10-09T18:00', order_id: o.id, status: 'BLOCKED_CREDIT', message: B.check(o).msg }, { silent: true }); }
    // Parrillas del Sur: viernes; promesa incumplida sobre una factura vencida (gracia 10 días)
    for (const d of ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25', '2026-10-02', '2026-10-09']) {
      const { o, doc } = mkOrder('cu-B003', d, [{ variant_id: 'va-M2-BON-KG', qty: 6, est_weight_kg: 6 }, { variant_id: 'va-M2-ASA-KG', qty: 8, est_weight_kg: 8 }], { slot: '13:00', recurring: roPS.id });
      D.insert(T.run, { recurring_order_id: roPS.id, delivery_date: d, run_at: G.date.add(d, -1) + 'T18:00', order_id: o.id, status: 'CREATED', message: 'Revisión de la vendedora (sin confirmación automática)' }, { silent: true });
      if (doc && d === '2026-09-04') { /* queda vencida: promesa incumplida */ } else if (doc && doc.due_date < G.TODAY) payDoc(doc, doc.due_date);
    }
    const fPS = D.find('sales_documents', d => d.customer_id === 'cu-B003' && d.issue_date === '2026-09-04');
    if (fPS) { fPS.due_date = '2026-10-04'; B.addPromise({ customer_id: 'cu-B003', document_id: fPS.id, promised_date: '2026-10-06', amount: fPS.balance, notes: 'El administrador ofreció transferir el lunes 06/10' }); }
    // Sabores de mi Tierra (plazo 7): facturas vencidas hace 10 y 40 días (CA-B2B-08)
    for (const [d, due] of [['2026-08-24', '2026-08-31'], ['2026-09-23', '2026-09-30'], ['2026-10-06', '2026-10-13']]) { const { doc } = mkOrder('cu-B004', d, [{ variant_id: 'va-DG-CON-ENT', qty: 6 }, { variant_id: 'va-DG-CUY-ENT', qty: 8 }]); if (doc) doc.due_date = due; }
    // Hotel Miramar: vencida hace 3 días (dentro de la gracia) y Catering por vencer
    { const { doc } = mkOrder('cu-B007', '2026-09-07', [{ variant_id: 'va-DG-POL-ENT', qty: 15 }, { variant_id: 'va-DG-PAT-ENT', qty: 4 }]); if (doc) doc.due_date = '2026-10-07'; }
    mkOrder('cu-B005', '2026-09-28', [{ variant_id: 'va-DG-POL-ENT', qty: 30 }, { variant_id: 'va-DG-CUY-ENT', qty: 25 }]);
    mkOrder('cu-B005', '2026-10-07', [{ variant_id: 'va-DG-COR-PIE', qty: 8, est_weight_kg: 8 }, { variant_id: 'va-DG-CAL-1L', qty: 20 }]);
    // El Cuy Dorado: una factura vencida hace 2 días (dentro de la gracia) con promesa abierta
    const fCD = D.where('sales_documents', d => d.customer_id === 'cu-B001' && openDoc(d)).sort(U.by('issue_date'))[0]; if (fCD) { fCD.due_date = '2026-10-08'; B.addPromise({ customer_id: 'cu-B001', document_id: fCD.id, promised_date: '2026-10-13', amount: fCD.balance, notes: 'Pagan los martes por transferencia' }); }
    for (const p of D.all(T.prof)) B.refresh(p.customer_id, { at: G.TODAY + 'T06:00' });
    B.evalPromises(G.TODAY);
    // usuarios del portal
    D.insert(T.acc, { id: 'pa-cd-owner', customer_id: 'cu-B001', user_id: 'us-portal-cuydorado', portal_role: 'OWNER', can_order: true, can_view_statement: true, invited_by: 'us-pleon', invited_at: '2026-08-20T10:00', status: 'ACTIVE' }, { silent: true });
    const U2 = [['us-portal-cd-conta', 'Lucía Ramos (El Cuy Dorado)', 'contabilidad@elcuydorado.pe', 'cu-B001', 'ACCOUNTING', 'ACTIVE', '2026-10-06T09:12'], ['us-portal-cd-chef', 'Jorge Paz (El Cuy Dorado)', 'cocina@elcuydorado.pe', 'cu-B001', 'BUYER', 'INVITED', null], ['us-portal-parrillas', 'Rocío Silva (Parrillas del Sur)', 'compras@parrillasdelsur.pe', 'cu-B003', 'OWNER', 'ACTIVE', '2026-10-08T17:45'], ['us-portal-catering', 'Martín Vela (Catering Eventos)', 'logistica@cateringeventos.pe', 'cu-B005', 'OWNER', 'DISABLED', '2026-09-02T08:30']];
    for (const [id, name, email, cid, role, st, last] of U2) { D.insert('users', { id, name, email, role: 'CLIENTE_B2B', user_type: 'B2B_CUSTOMER', customer_id: cid, brands: [], sites: [], status: st === 'DISABLED' ? 'INACTIVE' : 'ACTIVE', twofa_enabled: false, last_login: last }, { silent: true }); D.insert(T.acc, { customer_id: cid, user_id: id, portal_role: role, can_order: role !== 'ACCOUNTING', can_view_statement: true, invited_by: role === 'OWNER' ? 'us-pleon' : 'us-portal-cuydorado', invited_at: '2026-09-01T10:00', status: st }, { silent: true }); }
    // reclamos
    const cdDel = D.where('sales_orders', o => o.customer_id === 'cu-B001' && o.status === 'CLOSED').sort(U.by('delivery_date', -1));
    if (cdDel[2]) { const c = B.openClaim({ customer_id: 'cu-B001', order_id: cdDel[2].id, document_id: (D.find('sales_documents', d => d.order_id === cdDel[2].id) || {}).id, claim_type: 'WEIGHT', description: 'El cuy deshuesado llegó con 9,4 kg y se facturó 10 kg: adjuntamos foto de nuestra balanza.', photo_urls: ['reclamos/cu-B001/balanza-1.jpg'], portal_account_id: 'pa-cd-owner', opened_at: cdDel[2].delivery_date + 'T14:10' }); c.first_response_at = cdDel[2].delivery_date + 'T17:30'; c.response = 'Revisamos el ticket de balanza: corresponde un abono por 0,6 kg.'; B.resolveClaim(c, { resolution: 'CREDIT_NOTE', note: 'Abono por 0,6 kg de cuy deshuesado', amount: R(0.6 * 62) }); }
    if (cdDel[0]) B.openClaim({ customer_id: 'cu-B001', order_id: cdDel[0].id, document_id: (D.find('sales_documents', d => d.order_id === cdDel[0].id) || {}).id, claim_type: 'QUALITY', description: 'Dos caldos de 1 L llegaron descongelados.', photo_urls: ['reclamos/cu-B001/caldos.jpg'], portal_account_id: 'pa-cd-owner', opened_at: '2026-10-09T15:20' });
    const psDel = D.where('sales_orders', o => o.customer_id === 'cu-B003' && o.status === 'CLOSED').sort(U.by('delivery_date', -1));
    if (psDel[0]) { const c = B.openClaim({ customer_id: 'cu-B003', order_id: psDel[0].id, claim_type: 'LATE', description: 'El pedido llegó 16:45 y la franja era 13:00–17:00; necesitamos antes de las 15:00 para el servicio.', photo_urls: [], portal_account_id: null, opened_at: '2026-10-08T09:00' }); D.update(T.claim, c.id, { status: 'IN_REVIEW', first_response_at: '2026-10-08T12:30', response: 'Programamos su pedido en la primera salida de la tarde.' }, { silent: true }); }
    const ctDoc = D.find('sales_documents', d => d.customer_id === 'cu-B005' && d.doc_type === 'INVOICE');
    if (ctDoc) { const c = B.openClaim({ customer_id: 'cu-B005', document_id: ctDoc.id, order_id: ctDoc.order_id, claim_type: 'BILLING', description: 'Solicitamos la factura a nombre de otra razón social del grupo.', photo_urls: [], opened_at: '2026-10-01T10:00' }); D.update(T.claim, c.id, { status: 'REJECTED', resolution: 'NO_ACTION', resolution_note: 'La factura se emite al RUC que hizo el pedido; para otra razón social, registrar otro cliente.', first_response_at: '2026-10-01T16:00', resolved_by: 'us-chuaman', resolved_at: '2026-10-01T16:00' }, { silent: true }); }
    // recordatorios: programar y marcar los ya enviados
    for (const d of D.where('sales_documents', d => openDoc(d) && isB2B(d.customer_id))) B.schedule(d);
    B.sendDue(G.date.add(G.TODAY, -1));
  }, 'clientes empresariales');

  /* =================================================================
     Pruebas de aceptación (CA-B2B-01 … 09)
     ================================================================= */
  const T_ = (name, fn) => G.tests.push({ module: 'B2B', name, fn });
  const eq = (a, b, msg) => { if (a !== b && Math.abs(Number(a) - Number(b)) > 0.005) throw new Error(`${msg}: se esperaba ${b} y salió ${a}`); };
  const expectRule = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code} y no ocurrió`); };
  const asRole = (role, fn) => { const prev = G.ctx.role; try { G.ctx.role = role; return fn(); } finally { G.ctx.role = prev; } };
  const clearDebt = cid => { for (const d of D.where('sales_documents', d => d.customer_id === cid)) d.balance = 0; for (const o of D.where('sales_orders', o => o.customer_id === cid && o.payment_method_id === 'pm-CREDIT' && !['DRAFT', 'CANCELLED', 'CLOSED'].includes(o.status))) o.status = 'CLOSED'; };
  const creditOrder = (cid, qty = 62, pm = 'pm-CREDIT') => { const a = D.find('customer_addresses', x => x.customer_id === cid && x.is_default); const est = D.get('delivery_zones', a.zone_id).establishment_id; return G.orders.create({ customer_id: cid, brand_id: 'br-DG', channel: 'B2B', fulfillment: 'DELIVERY', address_id: a.id, delivery_date: G.date.add(G.TODAY, 1), slot_id: slotFor(est, '09:00').id, payment_method_id: pm, requested_doc_type: 'INVOICE', notes: 'Prueba', establishment_id: est, lines: [{ variant_id: 'va-DG-CAL-1L', qty }] }); };
  T_('CA-B2B-01: límite S/ 5 000 y saldo S/ 4 200; pedido a crédito de S/ 1 000 → RN-B2B-02; con excepción aprobada por GERENTE se confirma', async () => {
    const cid = 'cu-B006'; clearDebt(cid); B.saveProfile(cid, { credit_limit: 5000 }, 'Prueba CA-B2B-01');
    G.docs.issue({ doc_type: 'INVOICE', brand_id: 'br-DG', establishment_id: 'es-L2', customer_id: cid, lines: [{ description: 'Saldo anterior', qty: 1, unit_price: 4200, total: 4200, igv_affectation: '10' }], date: G.TODAY, payment_terms: 'CREDIT', credit_days: 15, accept: true });
    eq(B.exposure(cid), 4200, 'saldo');
    const o = creditOrder(cid, 62); if (!(o.estimated_total >= 1000)) throw new Error('El pedido de prueba no llega a S/ 1 000: ' + o.estimated_total);
    expectRule(() => B.confirm(o), 'RN-B2B-02'); eq(o.status, 'DRAFT', 'sigue en borrador');
    const x = asRole('VENDEDORA', () => B.requestException(o, 'Evento del sábado, paga el lunes'));
    B.decideException(D.get(T.exc, x.id), true, 'Cliente puntual');
    B.confirm(o); eq(o.status, 'CONFIRMED', 'estado'); eq(D.get(T.exc, x.id).status, 'USED', 'excepción usada');
  });
  T_('CA-B2B-02: factura vencida hace 6 días con gracia 5 → pedido a crédito rechazado con RN-B2B-03; al contado se acepta', async () => {
    const cid = 'cu-B006'; clearDebt(cid); B.saveProfile(cid, { credit_limit: 20000, grace_days: 5, term_days: 15 }, 'Prueba CA-B2B-02');
    const d = G.docs.issue({ doc_type: 'INVOICE', brand_id: 'br-DG', establishment_id: 'es-L2', customer_id: cid, lines: [{ description: 'Pedido anterior', qty: 1, unit_price: 500, total: 500, igv_affectation: '10' }], date: G.date.add(G.TODAY, -21), payment_terms: 'CREDIT', credit_days: 15, accept: true });
    eq(d.due_date, G.date.add(G.TODAY, -6), 'vencimiento'); eq(B.overdueDays(cid), 6, 'días de mora');
    const o = creditOrder(cid, 10); expectRule(() => B.confirm(o), 'RN-B2B-03');
    o.payment_method_id = 'pm-TRANSFER'; B.confirm(o); eq(o.status, 'CONFIRMED', 'al contado');
  });
  T_('CA-B2B-03: recurrente lunes y jueves con 10 kg de cuy; la corrida del domingo 18:00 se ejecuta dos veces → un solo pedido para el lunes', async () => {
    clearDebt('cu-B006');
    const ro = B.saveRecurring({ customer_id: 'cu-B006', address_id: 'ad-B006', name: 'Cuy lunes y jueves', frequency: 'WEEKLY', weekdays: [1, 4], slot_from: '09:00', slot_to: '13:00', lead_days: 1, starts_on: G.TODAY, auto_confirm: true }, [{ variant_id: 'va-DG-CUY-DES', qty: 10, est_weight_kg: 10 }]);
    const at = '2026-10-11T18:00'; if (isoDow('2026-10-11') !== 7) throw new Error('El 11/10/2026 no es domingo');
    B.runRecurring(at); B.runRecurring(at);
    const runs = D.where(T.run, r => r.recurring_order_id === ro.id); eq(runs.length, 1, 'corridas'); eq(runs[0].delivery_date, '2026-10-12', 'fecha de entrega');
    const os = D.where('sales_orders', o => o.recurring_order_id === ro.id); eq(os.length, 1, 'pedidos'); eq(os[0].lines[0].qty, 10, 'kg de cuy'); eq(os[0].channel, 'B2B', 'canal');
    eq(B.runRecurring('2026-10-11T17:59').ran, 0, 'antes de la hora no corre');
  });
  T_('CA-B2B-04: el usuario del portal del cliente A no ve comprobantes del cliente B', async () => {
    const prev = [G.ctx.role, G.ctx.portalCustomer];
    try {
      G.ctx.role = 'CLIENTE_B2B'; G.ctx.portalCustomer = 'cu-B001';
      const docs = B.portal.docs(); if (!docs.length) throw new Error('El cliente A no tiene comprobantes');
      if (docs.some(d => d.customer_id !== 'cu-B001')) throw new Error('Se filtró un comprobante de otro cliente');
      if (B.portal.orders().some(o => o.customer_id !== 'cu-B001')) throw new Error('Se filtró un pedido de otro cliente');
      const other = D.find('sales_documents', d => d.customer_id === 'cu-B002'); if (!other) throw new Error('Falta comprobante del cliente B');
      expectRule(() => B.portal.download(other.id, 'PDF'), 'RN-B2B-12');
      B._preview = 'cu-B002'; if (B.portalCustomer() !== 'cu-B001') throw new Error('La vista previa reemplazó al cliente de la sesión');
      G.ctx.portalCustomer = null; expectRule(() => B.portal.docs(), 'RN-B2B-12');
    } finally { G.ctx.role = prev[0]; G.ctx.portalCustomer = prev[1]; B._preview = 'cu-B001'; }
  });
  T_('CA-B2B-05: precio S/ 26/kg de cuy vigente del 01/10 al 31/10/2026; otro desde el 15/10/2026 → RN-B2B-06', async () => {
    const cur = B.prices('cu-B001').find(p => p.variant_id === 'va-DG-CUY-ENT' && p.valid_from === '2026-10-01'); eq(cur.unit_price, 26, 'precio vigente'); eq(cur.valid_to, '2026-10-31', 'fin');
    eq(G.price.of('va-DG-CUY-ENT', { channel: 'B2B', customer_id: 'cu-B001' }).price, 26, 'G.price.of respeta el precio del cliente');
    expectRule(() => B.savePrice({ customer_id: 'cu-B001', variant_id: 'va-DG-CUY-ENT', unit_price: 27, price_basis: 'KG', valid_from: '2026-10-15' }), 'RN-B2B-06');
  });
  T_('CA-B2B-06: factura a crédito de 15 días emitida el 01/10/2026 → vence el 16/10/2026 y el recordatorio previo sale el 13/10/2026', async () => {
    clearDebt('cu-B006'); B.saveProfile('cu-B006', { term_days: 15, credit_limit: 9000 }, 'Prueba CA-B2B-06');
    const d = G.docs.issue({ doc_type: 'INVOICE', brand_id: 'br-DG', establishment_id: 'es-L2', customer_id: 'cu-B006', lines: [{ description: 'Conejo', qty: 1, unit_price: 300, total: 300, igv_affectation: '10' }], date: '2026-10-01', payment_terms: 'CREDIT', accept: true });
    eq(d.due_date, '2026-10-16', 'vencimiento');
    const rem = D.find(T.rem, r => r.document_id === d.id && r.reminder_type === 'BEFORE_DUE'); if (!rem) throw new Error('No se programó el recordatorio previo'); eq(rem.scheduled_for, '2026-10-13', 'recordatorio');
    B.schedule(d); eq(D.where(T.rem, r => r.document_id === d.id).length, 4, 'uno por comprobante y tipo');
  });
  T_('CA-B2B-07: pedido anterior con cuy a S/ 25/kg y precio vigente S/ 26/kg → «repetir pedido» muestra la diferencia de S/ 1/kg', async () => {
    const o = D.where('sales_orders', x => x.customer_id === 'cu-B001' && x.lines.some(l => l.variant_id === 'va-DG-CUY-ENT' && l.unit_price === 25))[0]; if (!o) throw new Error('Falta el pedido de setiembre a S/ 25/kg');
    const l = B.repeatLines(o).find(x => x.variant_id === 'va-DG-CUY-ENT'); eq(l.old_price, 25, 'precio anterior'); eq(l.new_price, 26, 'precio vigente'); eq(l.diff, 1, 'diferencia'); eq(l.basis, 'KG', 'base');
  });
  T_('CA-B2B-08: comprobantes por vencer, a 10 y a 40 días de vencidos → tramos «por vencer», «1–15» y «31–60»', async () => {
    eq(B.bucket(-3), 'Por vencer', 'por vencer'); eq(B.bucket(10), '1–15', '10 días'); eq(B.bucket(40), '31–60', '40 días');
    const row = B.aging().find(x => x.c.id === 'cu-B004'); if (!row) throw new Error('Sabores de mi Tierra no está en la cartera');
    if (!(row.b['Por vencer'] > 0 && row.b['1–15'] > 0 && row.b['31–60'] > 0)) throw new Error('Tramos de Sabores de mi Tierra: ' + JSON.stringify(row.b));
  });
  T_('CA-B2B-09: la vendedora solicita una excepción y ella misma intenta aprobarla → RN-B2B-05', async () => {
    const cid = 'cu-B002'; const o = creditOrder(cid, 10);
    asRole('VENDEDORA', () => { const x = B.requestException(o, 'Cliente antiguo'); expectRule(() => B.decideException(D.get(T.exc, x.id), true, 'ok'), 'RN-B2B-05'); });
    const x = D.find(T.exc, e => e.order_id === o.id); eq(x.status, 'PENDING', 'sigue pendiente');
  });
  T_('RN-B2B-07/14: precio bajo margen queda por aprobar; portal con pedido mínimo y hora de corte', async () => {
    asRole('SUPERVISORA_VENTAS', () => { const p = B.savePrice({ customer_id: 'cu-B006', variant_id: 'va-DG-CON-ENT', unit_price: 15, price_basis: 'KG', valid_from: G.TODAY }); eq(p.status, 'PENDING_APPROVAL', 'estado'); if (G.price.of('va-DG-CON-ENT', { channel: 'B2B', customer_id: 'cu-B006' }).price === 15) throw new Error('Un precio pendiente se está usando'); });
    const prev = [G.ctx.role, G.ctx.portalCustomer];
    try { G.ctx.role = 'CLIENTE_B2B'; G.ctx.portalCustomer = 'cu-B001';
      expectRule(() => B.portalOrder({ lines: [{ variant_id: 'va-DG-CAL-1L', qty: 2 }], delivery_date: '2026-10-12', at: '2026-10-10T10:00' }), 'RN-B2B-14');
      expectRule(() => B.portalOrder({ lines: [{ variant_id: 'va-DG-CAL-1L', qty: 20 }], delivery_date: '2026-10-11', at: '2026-10-10T16:30' }), 'RN-B2B-14');
      const res = B.portalOrder({ lines: [{ variant_id: 'va-DG-CAL-1L', qty: 20 }], delivery_date: '2026-10-12', at: '2026-10-10T16:30' });
      eq(res[0].order.channel, 'B2B', 'canal'); if (!res[0].order.portal_account_id) throw new Error('Sin portal_account_id');
    } finally { G.ctx.role = prev[0]; G.ctx.portalCustomer = prev[1]; }
  });
})();
