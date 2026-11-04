/* =====================================================================
   CAJ · Cajas, cobros y conciliación (CAJ-01 … CAJ-13)
   Cobros con número de operación único por medio, aplicación a pedidos y
   comprobantes, saldo a favor, caja y liquidación del repartidor, abonos de
   Mercado Pago y del POS Visa con comisión e IGV, conciliación de Yape, Plin
   y banco contra el estado de cuenta, traslados y cuentas por cobrar.
   Expone G.caj.
   ===================================================================== */
(function () {
  const { h, btn, badge, status, page, card, table, kpis, dl, notice, drawer, modal, form, toast, pills } = G.ui;
  const U = G.util, F = G.fmt, D = G.db;
  const R = (n, d = 2) => U.round(n, d);
  const money = v => F.money(v);

  const ACC_TYPE = { CASH_REGISTER: 'Caja del mostrador', PETTY_CASH: 'Caja chica', BANK: 'Banco', WALLET: 'Billetera', GATEWAY: 'Pasarela', CARD_ACQUIRER: 'Adquirente POS', DRIVER_CASH: 'Caja del repartidor' };
  const PM_ACC = { CASH: ['CASH_REGISTER', 'DRIVER_CASH', 'PETTY_CASH'], WALLET: ['WALLET'], CARD: ['CARD_ACQUIRER'], GATEWAY: ['GATEWAY'], BANK: ['BANK'] };
  const DIGITAL = ['pm-MP', 'pm-CARD', 'pm-YAPE', 'pm-PLIN', 'pm-TRANSFER'];
  const SETTLE_KINDS = ['GATEWAY', 'CARD_ACQUIRER'];
  const MOV = { OVERPAYMENT: 'Pago de más', WEIGHT_DIFFERENCE: 'Diferencia de peso', CREDIT_NOTE: 'Nota de crédito', APPLIED: 'Uso en pedido', REFUND: 'Devolución', ADJUSTMENT: 'Ajuste' };
  const acc = id => D.get('cash_accounts', id);
  const accName = id => (acc(id) || {}).name || '—';
  const valid = d => d && d.status !== 'VOIDED' && d.sunat_status !== 'REJECTED';
  const docNo = d => d ? (d.full_number || `${d.series}-${U.pad(d.number, 8)}`) : '—';
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const alertDays = () => Number(G.param('caj_reconciliation_alert_days') ?? 3);
  const feeIgvRate = () => { const v = Number(G.param('caj_mp_fee_igv_rate') ?? 0.18); return v > 1 ? v / 100 : v; };
  const day = s => String(s || '').slice(0, 10);
  const err = e => { toast(e.message, 'bad'); return e.message; };
  const run = (fn, ok) => { try { const r = fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); G.refresh(); return r; } catch (e) { err(e); return null; } };
  const nextNo = (key, prefix, w) => D.next(key, prefix, w);

  /* ---------- índices y saldos derivados (RN-CAJ-09, RN-CAJ-14) ---------- */
  function index() {
    const byOrder = new Map(), byDoc = new Map(), nc = new Map();
    for (const p of D.all('payments')) { if (p.status !== 'CONFIRMED') continue; for (const a of p.allocations || []) { if (a.order_id) push(byOrder, a.order_id, { p, a }); if (a.document_id) push(byDoc, a.document_id, { p, a }); } }
    for (const d of D.all('sales_documents')) if (d.doc_type === 'CREDIT_NOTE' && d.related_document_id && valid(d)) nc.set(d.related_document_id, R((nc.get(d.related_document_id) || 0) + d.total));
    return { byOrder, byDoc, nc };
  }
  const applied = p => R(U.sum(p.allocations || [], a => a.amount) + (p.to_balance || 0));
  const unapplied = p => R(p.amount - applied(p));
  /** cuenta por cobrar = total − notas de crédito − cobros confirmados aplicados (RN-CAJ-14) */
  function receivable(doc, ix) {
    if (!doc || !valid(doc) || !['INVOICE', 'RECEIPT', 'DEBIT_NOTE'].includes(doc.doc_type)) return 0;
    ix = ix || index();
    return R(doc.total - (ix.nc.get(doc.id) || 0) - U.sum(ix.byDoc.get(doc.id) || [], x => x.a.amount));
  }
  const orderTotal = o => o.final_total ?? o.estimated_total ?? 0;
  function orderPaid(id, ix) { ix = ix || index(); return R(U.sum(ix.byOrder.get(id) || [], x => x.a.amount)); }
  function syncOrder(id, ix) { const o = D.get('sales_orders', id); if (!o) return; ix = ix || index(); const xs = ix.byOrder.get(id) || []; o.paid_amount = R(U.sum(xs, x => x.a.amount)); o.payment_ids = [...new Set(xs.map(x => x.p.id))]; D.touch(); }
  function syncDoc(id, ix) { const d = D.get('sales_documents', id); if (!d) return; if (d.payment_terms === 'CREDIT') { d.balance = Math.max(0, receivable(d, ix || index())); D.touch(); } }
  function syncAll(p) { const ix = index(); for (const a of p.allocations || []) { if (a.order_id) syncOrder(a.order_id, ix); if (a.document_id) syncDoc(a.document_id, ix); } }

  /* ---------- saldo a favor (RN-CAJ-08) ---------- */
  function balanceOf(cid) { return R(U.sum(D.where('customer_balance_movements', m => m.customer_id === cid), m => m.amount)); }
  function balances() { const m = new Map(); for (const x of D.all('customer_balance_movements')) m.set(x.customer_id, R((m.get(x.customer_id) || 0) + x.amount)); return m; }
  function addBalance(cid, type, amount, ref = {}) {
    if (!(amount > 0)) G.fail('RN-CAJ-08', 'El crédito a favor debe ser mayor que cero.');
    if (!ref.reason) G.fail('RN-CAJ-08', 'Registra el motivo del saldo a favor.');
    return D.insert('customer_balance_movements', { customer_id: cid, movement_type: type, amount: R(amount), order_id: ref.order_id || null, payment_id: ref.payment_id || null, document_id: ref.document_id || null, reason: ref.reason, at: ref.at || G.date.now(), user: G.ctx.userName() });
  }
  function useBalance(cid, amount, ref = {}) {
    amount = R(Number(amount)); const bal = balanceOf(cid);
    if (!(amount > 0)) G.fail('RN-CAJ-08', 'Indica un monto mayor que cero.');
    if (amount > bal + 0.001) G.fail('RN-CAJ-08', `El saldo a favor de ${G.custName(cid)} es ${money(bal)} y pides usar ${money(amount)}: el saldo nunca queda negativo.`);
    if (!ref.order_id && !ref.document_id) G.fail('RN-CAJ-08', 'Elige el pedido o comprobante donde se usa el saldo.');
    const o = ref.order_id ? D.get('sales_orders', ref.order_id) : null;
    const p = D.insert('payments', { number: nextNo('CB', 'CB-', 6), customer_id: cid, payment_method_id: 'pm-BALANCE', cash_account_id: null, amount, paid_at: G.date.now(), reference: null, status: 'CONFIRMED', brand_id: o ? o.brand_id : null, establishment_id: o ? o.establishment_id : null, fee_amount: 0, reconciliation_status: 'NOT_APPLICABLE', received_by: G.ctx.userId(), allocations: [{ order_id: ref.order_id || null, document_id: ref.document_id || null, amount }] });
    D.insert('customer_balance_movements', { customer_id: cid, movement_type: 'APPLIED', amount: -amount, order_id: ref.order_id || null, payment_id: p.id, document_id: ref.document_id || null, reason: ref.reason || `Uso del saldo a favor en ${o ? o.number : 'comprobante'}`, at: G.date.now(), user: G.ctx.userName() });
    syncAll(p); G.events.emit('payment.confirmed', { payment_id: p.id, amount, allocations: p.allocations });
    return p;
  }
  function refundBalance(cid, amount, { account_id, reference, reason } = {}) {
    amount = R(Number(amount)); const bal = balanceOf(cid);
    if (!(amount > 0)) G.fail('RN-CAJ-08', 'Indica un monto mayor que cero.');
    if (amount > bal + 0.001) G.fail('RN-CAJ-08', `El saldo a favor es ${money(bal)}: no se devuelve ${money(amount)}.`);
    const a = acc(account_id);
    if (!a || !['BANK', 'WALLET'].includes(a.account_type)) G.fail('RN-CAJ-08', 'D-CAJ-04: el saldo a favor se devuelve solo por transferencia o Yape, desde una cuenta bancaria o billetera de la empresa.');
    if (!reference) G.fail('RN-CAJ-02', 'La devolución exige el número de operación.');
    if (!reason) G.fail('RN-CAJ-08', 'Registra el motivo de la devolución.');
    return D.insert('customer_balance_movements', { customer_id: cid, movement_type: 'REFUND', amount: -amount, reason, refund_account_id: account_id, refund_reference: reference, at: G.date.now(), user: G.ctx.userName() });
  }

  /* ---------- cobros (RN-CAJ-01 … RN-CAJ-07, RN-CAJ-15) ---------- */
  function checkAllocs(allocs, amount, ix, alreadyApplied = 0) {
    const tot = R(U.sum(allocs, a => Number(a.amount) || 0));
    if (allocs.some(a => !(Number(a.amount) > 0))) G.fail('RN-CAJ-05', 'Cada aplicación debe ser mayor que cero.');
    if (tot + alreadyApplied > amount + 0.001) G.fail('RN-CAJ-05', `Lo aplicado (${money(tot + alreadyApplied)}) supera el monto del cobro (${money(amount)}); quedan ${money(Math.max(0, amount - alreadyApplied))} por aplicar.`);
    const perDoc = new Map(), perOrder = new Map();
    for (const a of allocs) { if (a.document_id) perDoc.set(a.document_id, R((perDoc.get(a.document_id) || 0) + Number(a.amount))); else if (a.order_id) perOrder.set(a.order_id, R((perOrder.get(a.order_id) || 0) + Number(a.amount))); }
    for (const [id, amt] of perDoc) { const d = D.get('sales_documents', id); if (!d) G.fail('RN-CAJ-07', 'Comprobante no encontrado.'); if (!valid(d)) G.fail('RN-CAJ-14', `${docNo(d)} está ${d.status === 'VOIDED' ? 'anulado' : 'rechazado por SUNAT'}: no genera cuenta por cobrar hasta corregirse.`); const rec = receivable(d, ix); if (amt > rec + 0.001) G.fail('RN-CAJ-07', `A ${docNo(d)} le quedan ${money(rec)} por cobrar (total ${money(d.total)} menos notas de crédito y cobros); no se aplican ${money(amt)}.`); }
    for (const [id, amt] of perOrder) { const o = D.get('sales_orders', id); if (!o) G.fail('RN-CAJ-05', 'Pedido no encontrado.'); const pend = R(orderTotal(o) - orderPaid(id, ix)); if (amt > pend + 0.001) G.fail('RN-CAJ-05', `Al pedido ${o.number} le quedan ${money(Math.max(0, pend))} por pagar; el excedente pasa a saldo a favor (CAJ-04).`); }
    return tot;
  }
  function register(d) {
    const pm = D.get('payment_methods', d.payment_method_id);
    if (!pm || pm.id === 'pm-BALANCE') G.fail('RN-CAJ-01', 'Elige el medio de pago.');
    if (pm.id === 'pm-CREDIT') G.fail('RN-CAJ-01', 'El crédito B2B no es un cobro: registra el cobro cuando el cliente pague.');
    const amount = R(Number(d.amount));
    if (!(amount > 0)) G.fail('RN-CAJ-01', 'El monto debe ser mayor que cero.');
    const accountId = d.cash_account_id || G.pay.accountFor(pm.id, { driver_user_id: d.collected_by_user_id });
    const a = acc(accountId);
    if (!a || a.status !== 'ACTIVE') G.fail('RN-CAJ-01', 'El cobro solo va a una cuenta activa de la empresa.');
    if (!(PM_ACC[pm.kind] || []).includes(a.account_type)) G.fail('RN-CAJ-01', `${pm.name} no se cobra en ${a.name} (${ACC_TYPE[a.account_type]}).`);
    const ref = String(d.reference || '').trim();
    if (pm.requires_reference && !ref) G.fail('RN-CAJ-02', `${pm.name} exige el número de operación.`);
    if (pm.id === 'pm-CARD') { if (!d.card_brand) G.fail('RN-CAJ-03', 'El cobro con tarjeta registra la marca de la tarjeta.'); if (!/^\d{4}$/.test(String(d.card_last4 || ''))) G.fail('RN-CAJ-03', 'El cobro con tarjeta registra los 4 últimos dígitos.'); }
    if (ref && pm.requires_reference) { const dup = D.find('payments', p => p.payment_method_id === pm.id && p.status === 'CONFIRMED' && String(p.reference || '').trim().toUpperCase() === ref.toUpperCase()); if (dup) G.fail('RN-CAJ-04', `La operación ${ref} de ${pm.name} ya está registrada en ${dup.number} (${money(dup.amount)}, ${G.custName(dup.customer_id)}): no se usa dos veces.`); }
    const allocs = (d.allocations || []).filter(x => Number(x.amount) > 0).map(x => ({ order_id: x.order_id || (x.document_id ? (D.get('sales_documents', x.document_id) || {}).order_id || null : null), document_id: x.document_id || null, amount: R(Number(x.amount)) }));
    // RN-CAJ-15: contra entrega solo por el repartidor asignado, con su caja
    for (const x of allocs) {
      const o = x.order_id && D.get('sales_orders', x.order_id);
      const cod = o && ['DELIVERY', 'PROVINCE_SHIPPING'].includes(o.fulfillment) && o.driver_user_id && (d.on_delivery || (pm.id === 'pm-CASH' && ['IN_ROUTE', 'DELIVERED', 'NOT_DELIVERED'].includes(o.status)));
      if (!cod) continue;
      if (G.ctx.role === 'VENDEDORA') G.fail('RN-CAJ-15', `El cobro contra entrega de ${o.number} lo registra el repartidor desde la app; la vendedora no lo registra.`);
      if (d.collected_by_user_id !== o.driver_user_id) G.fail('RN-CAJ-15', `${o.number} está asignado a ${G.userShort(o.driver_user_id)}: solo ese repartidor registra el cobro contra entrega.`);
      if (pm.id === 'pm-CASH' && accountId !== 'ca-DRV-' + o.driver_user_id.slice(3)) G.fail('RN-CAJ-15', 'El efectivo contra entrega entra a la caja del repartidor.');
    }
    const ix = index();
    checkAllocs(allocs, amount, ix);
    const at = d.at || G.date.now();
    try { G.period.assertOpen(day(at)); } catch (e) { G.fail('RN-PLT-05', e.message.replace(/^RN-PLT-05: /, '')); }
    const p = G.pay.register({ customer_id: d.customer_id, payment_method_id: pm.id, amount, reference: ref || null, cash_account_id: accountId, allocations: allocs, brand_id: d.brand_id || null, establishment_id: d.establishment_id || a.establishment_id || null, at, collected_by_user_id: d.collected_by_user_id || null, card_last4: d.card_last4 || null });
    const emp = d.collected_by_user_id ? (D.get('users', d.collected_by_user_id) || {}).employee_id : null;
    D.update('payments', p.id, { card_brand: pm.id === 'pm-CARD' ? d.card_brand : null, gateway_transaction_id: pm.id === 'pm-MP' ? ref : null, voucher_name: d.voucher_name || null, collected_by_employee_id: emp || null, on_delivery: !!d.on_delivery, notes: d.notes || null, to_balance: 0, fee_amount: R(amount * (a.fee_pct || 0) / 100 + (a.fee_fixed || 0)) }, { silent: true });
    syncAll(p);
    return D.get('payments', p.id);
  }
  function apply(paymentId, allocs) {
    const p = D.get('payments', paymentId);
    if (!p || p.status !== 'CONFIRMED') G.fail('RN-CAJ-05', 'Solo se aplica un cobro vigente.');
    const list = allocs.filter(x => Number(x.amount) > 0).map(x => ({ order_id: x.order_id || (x.document_id ? (D.get('sales_documents', x.document_id) || {}).order_id || null : null), document_id: x.document_id || null, amount: R(Number(x.amount)) }));
    if (!list.length) G.fail('RN-CAJ-05', 'Indica cuánto aplicar.');
    checkAllocs(list, p.amount, index(), applied(p));
    p.allocations = (p.allocations || []).concat(list); D.update('payments', p.id, { allocations: p.allocations }, { silent: true });
    syncAll(p);
    return p;
  }
  function toBalance(paymentId, amount, reason) {
    const p = D.get('payments', paymentId); amount = R(Number(amount));
    if (!p || p.status !== 'CONFIRMED') G.fail('RN-CAJ-05', 'Solo un cobro vigente genera saldo a favor.');
    if (!(amount > 0) || amount > unapplied(p) + 0.001) G.fail('RN-CAJ-05', `El cobro ${p.number} tiene ${money(unapplied(p))} sin aplicar.`);
    const m = addBalance(p.customer_id, 'OVERPAYMENT', amount, { payment_id: p.id, reason: reason || `Pago de más en ${p.number}` });
    D.update('payments', p.id, { to_balance: R((p.to_balance || 0) + amount) }, { silent: true });
    return m;
  }
  function reverse(paymentId, reason) {
    const p = D.get('payments', paymentId);
    if (!reason || !String(reason).trim()) G.fail('RN-CAJ-06', 'Revertir un cobro exige motivo.');
    if (p.status === 'REVERSED') G.fail('RN-CAJ-06', `${p.number} ya está revertido: un cobro revertido no se reactiva.`);
    const b = p.settlement_batch_id && D.get('settlement_batches', p.settlement_batch_id);
    if (b && b.status !== 'OPEN') G.fail('RN-CAJ-12', `${p.number} ya está conciliado en el abono ${b.reference}: no cambia; registra un ajuste.`);
    if (p.driver_settlement_id) G.fail('RN-CAJ-10', `${p.number} ya se liquidó con el repartidor (${(D.get('driver_settlements', p.driver_settlement_id) || {}).number}).`);
    if ((p.to_balance || 0) > 0) { if (balanceOf(p.customer_id) < p.to_balance - 0.001) G.fail('RN-CAJ-08', `El cliente ya usó el saldo a favor que generó ${p.number}: revertirlo dejaría su saldo negativo.`); D.insert('customer_balance_movements', { customer_id: p.customer_id, movement_type: 'ADJUSTMENT', amount: -p.to_balance, payment_id: p.id, reason: `Reverso de ${p.number}: ${reason}`, at: G.date.now(), user: G.ctx.userName() }); }
    if (b) { D.t.settlement_batch_items = D.ensure('settlement_batch_items').filter(i => i.payment_id !== p.id); }
    D.update('payments', p.id, { status: 'REVERSED', reversal_reason: reason, reversed_at: G.date.now(), reversed_by: G.ctx.userName(), reconciliation_status: p.reconciliation_status === 'PENDING' ? 'NOT_APPLICABLE' : p.reconciliation_status, settlement_batch_id: null });
    syncAll(p);
    G.events.emit('payment.reversed', { payment_id: p.id, amount: p.amount, reason });
    return D.get('payments', p.id);
  }
  /** RN-CAJ-12: un cobro conciliado no cambia de monto */
  function updatePayment(id, patch) {
    const p = D.get('payments', id);
    if ('amount' in patch && p.reconciliation_status === 'MATCHED') G.fail('RN-CAJ-12', `${p.number} está conciliado: su monto no cambia.`);
    if ('amount' in patch && R(Number(patch.amount)) < applied(p)) G.fail('RN-CAJ-05', `${p.number} ya tiene ${money(applied(p))} aplicados.`);
    if (p.status !== 'CONFIRMED') G.fail('RN-CAJ-06', 'Solo se corrige un cobro vigente.');
    return D.update('payments', id, patch);
  }

  /* ---------- caja del repartidor (RN-CAJ-10, RN-CAJ-11) ---------- */
  const driverAcc = uid => 'ca-DRV-' + String(uid).slice(3);
  const drivers = () => D.where('users', u => u.role === 'REPARTIDOR' && u.status === 'ACTIVE');
  function driverExpected(uid, date = G.TODAY) {
    const a = driverAcc(uid);
    const cash = D.where('payments', p => p.status === 'CONFIRMED' && p.cash_account_id === a && !p.driver_settlement_id && day(p.paid_at) <= date).sort(U.by('paid_at'));
    const digital = D.where('payments', p => p.status === 'CONFIRMED' && p.collected_by_user_id === uid && p.cash_account_id !== a && !p.driver_settlement_id && day(p.paid_at) <= date);
    const ex = D.where('driver_expenses', x => x.driver_user_id === uid && x.paid_with === 'ROUTE_CASH' && x.status !== 'VOIDED' && !x.settled && x.expense_date <= date);
    const expenses = R(U.sum(ex, x => x.amount));
    return { cash: R(U.sum(cash, p => p.amount) - expenses), gross: R(U.sum(cash, p => p.amount)), expenses, expenseRows: ex, digital: R(U.sum(digital, p => p.amount)), payments: cash, digitalPayments: digital };
  }
  const receivingFor = uid => { const u = D.get('users', uid) || {}; return (u.sites || []).includes('es-L2') ? 'ca-CCH-L2' : 'ca-CAJA-L1'; };
  function settleDriver({ driver_user_id, delivered_cash, reason, receiving_account_id, date, received_by_user_id, at }) {
    const uid = driver_user_id; const drv = D.get('users', uid);
    if (!drv) G.fail('RN-CAJ-10', 'Elige el repartidor.');
    const receiver = received_by_user_id || G.ctx.userId();
    if (receiver === uid) G.fail('RN-CAJ-11', `${drv.name} no recibe su propia liquidación: la recibe la caja del mostrador (Local 1) o administración (Local 2).`);
    const dlv = R(Number(delivered_cash));
    if (!(dlv >= 0) || delivered_cash === '' || delivered_cash == null) G.fail('RN-CAJ-10', 'Registra el efectivo entregado.');
    const exp = driverExpected(uid, date || G.TODAY);
    if (!exp.payments.length && !exp.digitalPayments.length && !dlv) G.fail('RN-CAJ-10', `${drv.name} no tiene cobros pendientes de liquidar.`);
    const diff = R(dlv - exp.cash); const tol = Number(G.param('caj_driver_diff_tolerance') ?? 0);
    if (Math.abs(diff) > tol + 0.001 && !String(reason || '').trim()) G.fail('RN-CAJ-10', `La liquidación de ${drv.name} tiene una diferencia de ${money(diff)} (esperado ${money(exp.cash)}, entregado ${money(dlv)}): registra el motivo.`);
    const recv = receiving_account_id || receivingFor(uid); const ra = acc(recv);
    if (!ra || ra.status !== 'ACTIVE' || !['CASH_REGISTER', 'PETTY_CASH', 'BANK'].includes(ra.account_type)) G.fail('RN-CAJ-10', 'El efectivo pasa a una caja o cuenta activa que recibe.');
    const when = at || G.date.now();
    const route = D.find('delivery_routes', r => (r.driver_user_id === uid) && day(r.route_date || r.date) === (date || G.TODAY));
    const s = D.insert('driver_settlements', { number: nextNo('LQ', 'LQ-', 5), driver_employee_id: drv.employee_id, driver_user_id: uid, driver_cash_account_id: driverAcc(uid), receiving_account_id: recv, settlement_date: date || G.TODAY, route_ref: route ? route.id : null, expected_cash: exp.cash, expected_digital: exp.digital, delivered_cash: dlv, difference: diff, difference_reason: Math.abs(diff) > 0.001 ? reason : (reason || null), status: Math.abs(diff) > 0.001 ? 'WITH_DIFFERENCE' : 'SETTLED', received_by: receiver, settled_at: when, payment_ids: exp.payments.concat(exp.digitalPayments).map(p => p.id) });
    for (const p of exp.payments.concat(exp.digitalPayments)) p.driver_settlement_id = s.id;
    for (const x of exp.expenseRows || []) { x.settled = true; x.settlement_id = s.id; }
    if (dlv > 0) D.insert('cash_transfers', { from_account_id: driverAcc(uid), to_account_id: recv, amount: dlv, transferred_at: when, reference: s.number, reason: `Liquidación del repartidor ${drv.name}`, status: 'CONFIRMED', settlement_id: s.id }, { silent: true });
    D.touch();
    G.events.emit('driver.settled', { settlement_id: s.id, driver_user_id: uid, expected_cash: exp.cash, delivered_cash: dlv, difference: diff, route_ref: s.route_ref });
    if (Math.abs(diff) > 0.001 && !G._seeding) G.notify({ role: 'ADMINISTRACION', title: `Liquidación ${s.number} con diferencia ${money(diff)}`, body: `${drv.name}: ${reason}`, ref: s.id, tone: 'warn', module: 'CAJ' });
    return s;
  }
  function approveSettlement(id) {
    const s = D.get('driver_settlements', id);
    if (s.status !== 'WITH_DIFFERENCE') G.fail('RN-CAJ-10', 'Solo se aprueba una liquidación con diferencia.');
    if (s.received_by === G.ctx.userId() && G.ctx.role !== 'GERENTE') G.fail('RN-CAJ-11', 'Quien recibió la liquidación no aprueba su diferencia.');
    return D.update('driver_settlements', id, { status: 'APPROVED', approved_by: G.ctx.userName(), approved_at: G.date.now() });
  }

  /* ---------- abonos de pasarela, adquirente y estado de cuenta (RN-CAJ-12, RN-CAJ-13) ---------- */
  function createBatch(d) {
    const src = acc(d.source_account_id); const bank = acc(d.bank_account_id);
    if (!src || !['GATEWAY', 'CARD_ACQUIRER', 'WALLET', 'BANK'].includes(src.account_type)) G.fail('RN-CAJ-13', 'Elige la pasarela, el adquirente o la cuenta cuyo abono vas a conciliar.');
    if (!bank || !['BANK', 'WALLET'].includes(bank.account_type)) G.fail('RN-CAJ-13', 'Elige la cuenta bancaria donde llegó el abono.');
    const ref = String(d.reference || '').trim(); if (!ref) G.fail('RN-CAJ-13', 'El abono necesita su referencia (n.º de liquidación o de operación bancaria).');
    if (D.find('settlement_batches', b => b.source_account_id === src.id && b.reference === ref)) G.fail('RN-CAJ-13', `Ya existe el abono ${ref} de ${src.name}.`);
    const ids = d.payment_ids || [];
    if (!ids.length) G.fail('RN-CAJ-13', 'Selecciona los cobros que incluye el abono.');
    const taken = new Set(D.all('settlement_batch_items').map(i => i.payment_id));
    const ps = ids.map(id => D.get('payments', id));
    for (const p of ps) {
      if (!p || p.status !== 'CONFIRMED') G.fail('RN-CAJ-13', `${p ? p.number : 'Un cobro'} no está confirmado: solo se incluyen cobros vigentes.`);
      if (p.cash_account_id !== src.id) G.fail('RN-CAJ-13', `${p.number} se cobró en ${accName(p.cash_account_id)}, no en ${src.name}.`);
      if (taken.has(p.id) || p.settlement_batch_id) G.fail('RN-CAJ-13', `${p.number} ya está incluido en otro abono: cada cobro se concilia una sola vez.`);
    }
    const gross = d.gross_amount != null && d.gross_amount !== '' ? R(Number(d.gross_amount)) : R(U.sum(ps, p => p.amount));
    const fee = R(Number(d.fee_amount) || 0); const igv = d.fee_igv != null && d.fee_igv !== '' ? R(Number(d.fee_igv)) : R(fee * feeIgvRate());
    const net = d.net_amount != null && d.net_amount !== '' ? R(Number(d.net_amount)) : R(gross - fee - igv);
    const kind = SETTLE_KINDS.includes(src.account_type) ? 'SETTLEMENT' : 'STATEMENT';
    const b = D.insert('settlement_batches', { source_account_id: src.id, bank_account_id: bank.id, deposit_date: d.deposit_date || G.TODAY, reference: ref, gross_amount: gross, fee_amount: fee, fee_igv: igv, net_amount: net, status: 'OPEN', difference_reason: null, kind, imported: !!d.imported, created_by: G.ctx.userName() }, { silent: !!d.silent });
    const sumP = U.sum(ps, p => p.amount) || 1;
    for (const p of ps) { D.insert('settlement_batch_items', { batch_id: b.id, payment_id: p.id, gross_amount: p.amount, fee_amount: R(fee * p.amount / sumP) }, { silent: true }); p.settlement_batch_id = b.id; }
    D.touch();
    return b;
  }
  function batchCheck(b) {
    const items = D.where('settlement_batch_items', i => i.batch_id === b.id);
    const sum = R(U.sum(items, i => i.gross_amount));
    return { items, sum, d1: R(sum - b.gross_amount), d2: R(b.gross_amount - b.fee_amount - b.fee_igv - b.net_amount) };
  }
  function closeBatch(id, { reason, at } = {}) {
    const b = D.get('settlement_batches', id);
    if (b.status !== 'OPEN') G.fail('RN-CAJ-12', `El abono ${b.reference} ya está cerrado.`);
    const c = batchCheck(b);
    const ok = Math.abs(c.d1) < 0.005 && Math.abs(c.d2) < 0.005;
    if (!ok && !String(reason || '').trim()) G.fail('RN-CAJ-12', `El abono ${b.reference} no cuadra: cobros incluidos ${money(c.sum)} contra bruto ${money(b.gross_amount)} (diferencia ${money(c.d1)}); bruto − comisión − IGV − neto = ${money(c.d2)}. Corrige o ciérralo con motivo.`);
    const when = at || G.date.now();
    D.update('settlement_batches', id, { status: ok ? 'MATCHED' : 'WITH_DIFFERENCE', difference_reason: ok ? null : reason, closed_at: when, closed_by: G.ctx.userName() }, { silent: !!G._seeding });
    for (const i of c.items) { const p = D.get('payments', i.payment_id); if (p) { p.reconciliation_status = ok ? 'MATCHED' : 'DIFFERENCE'; p.matched_at = when; } }
    if (b.kind === 'SETTLEMENT' && b.net_amount > 0) D.insert('cash_transfers', { from_account_id: b.source_account_id, to_account_id: b.bank_account_id, amount: b.net_amount, transferred_at: b.deposit_date + 'T12:00:00', reference: b.reference, reason: `Abono ${accName(b.source_account_id)} (neto de comisión)`, status: 'CONFIRMED', batch_id: b.id }, { silent: true });
    D.touch();
    return D.get('settlement_batches', id);
  }
  const pendingOf = (accountId, upTo) => D.where('payments', p => p.status === 'CONFIRMED' && p.cash_account_id === accountId && p.reconciliation_status === 'PENDING' && !p.settlement_batch_id && (!upTo || day(p.paid_at) <= upTo)).sort(U.by('paid_at'));
  /** importación simulada del reporte de liquidaciones (Mercado Pago o adquirente del POS) */
  function importSettlement(sourceId, opts = {}) {
    const src = acc(sourceId); if (!src || !SETTLE_KINDS.includes(src.account_type)) G.fail('RN-CAJ-13', 'La liquidación se importa de Mercado Pago o del adquirente del POS.');
    const until = G.date.add(opts.date || G.TODAY, -(src.settlement_days || 0));
    const ps = pendingOf(src.id, until);
    if (!ps.length) G.fail('RN-CAJ-13', `No hay cobros de ${src.name} con el plazo de abono cumplido (${src.settlement_days} días, hasta el ${F.date(until)}).`);
    const gross = R(U.sum(ps, p => p.amount)); const fee = R(U.sum(ps, p => p.amount * (src.fee_pct || 0) / 100 + (src.fee_fixed || 0))); const igv = R(fee * feeIgvRate());
    return createBatch({ source_account_id: src.id, bank_account_id: opts.bank || 'ca-BCP-CTE', deposit_date: opts.date || G.TODAY, reference: opts.reference || `LIQ-${src.code}-${(opts.date || G.TODAY).replace(/-/g, '')}`, gross_amount: gross, fee_amount: fee, fee_igv: igv, net_amount: R(gross - fee - igv), payment_ids: ps.map(p => p.id), imported: true });
  }
  /** importación simulada del estado de cuenta (Yape, Plin, banco): cruza por n.º de operación y monto */
  function importStatement(accountId, date = G.TODAY) {
    const a = acc(accountId); if (!a || !['WALLET', 'BANK'].includes(a.account_type)) G.fail('RN-CAJ-13', 'El estado de cuenta se importa de Yape, Plin o del banco.');
    const ps = pendingOf(a.id, date);
    if (!ps.length) G.fail('RN-CAJ-13', `No hay cobros de ${a.name} pendientes de conciliar hasta el ${F.date(date)}.`);
    const lines = ps.slice(0, Math.max(1, ps.length - (ps.length > 2 ? 1 : 0))).map(p => ({ date: day(p.paid_at), op: p.reference, amount: p.amount }));
    lines.push({ date, op: 'OP' + (90000000 + ps.length * 7919 % 9999999), amount: 35, unknown: true });
    const matched = [], missing = [];
    const byOp = new Map(lines.filter(l => !l.unknown).map(l => [String(l.op).toUpperCase(), l]));
    for (const p of ps) { const l = byOp.get(String(p.reference || '').toUpperCase()); if (l && Math.abs(l.amount - p.amount) < 0.005) matched.push(p); else missing.push(p); }
    const unknown = lines.filter(l => l.unknown);
    let b = null;
    if (matched.length) { b = createBatch({ source_account_id: a.id, bank_account_id: a.account_type === 'WALLET' ? (a.bank_name === 'Interbank' ? 'ca-IBK-CTE' : 'ca-BCP-CTE') : a.id, deposit_date: date, reference: `EECC-${a.code}-${date.replace(/-/g, '')}-${D.where('settlement_batches', x => x.source_account_id === a.id && x.deposit_date === date).length + 1}`, gross_amount: R(U.sum(matched, p => p.amount)), fee_amount: 0, fee_igv: 0, net_amount: R(U.sum(matched, p => p.amount)), payment_ids: matched.map(p => p.id), imported: true }); b = closeBatch(b.id); }
    return { batch: b, matched, missing, unknown, lines };
  }

  /* ---------- traslados (CAJ-12) y saldos de cuentas ---------- */
  function transfer({ from, to, amount, reference, reason, at }) {
    const a = acc(from), b = acc(to); amount = R(Number(amount));
    if (!a || !b || a.status !== 'ACTIVE' || b.status !== 'ACTIVE') G.fail('RN-CAJ-01', 'Los traslados son entre cuentas activas de la empresa.');
    if (from === to) G.fail('RN-CAJ-01', 'Elige cuentas distintas.');
    if (!(amount > 0)) G.fail('RN-CAJ-01', 'El monto debe ser mayor que cero.');
    if (!reason) G.fail('RN-CAJ-01', 'El traslado exige motivo.');
    if (['CASH_REGISTER', 'PETTY_CASH', 'DRIVER_CASH'].includes(a.account_type)) { const bal = ledger().get(from).balance; if (amount > bal + 0.001) G.fail('RN-CAJ-01', `${a.name} tiene ${money(bal)}: no se trasladan ${money(amount)}.`); }
    if (['BANK', 'WALLET'].includes(a.account_type) && !reference) G.fail('RN-CAJ-02', 'El traslado desde un banco o billetera exige el número de operación.');
    return D.insert('cash_transfers', { from_account_id: from, to_account_id: to, amount, transferred_at: at || G.date.now(), reference: reference || null, reason, status: 'CONFIRMED', created_by: G.ctx.userName() });
  }
  function voidTransfer(id, reason) { const t = D.get('cash_transfers', id); if (!reason) G.fail('RN-CAJ-06', 'Anular un traslado exige motivo.'); if (t.status === 'VOIDED') G.fail('RN-CAJ-06', 'El traslado ya está anulado.'); if (t.settlement_id || t.batch_id) G.fail('RN-CAJ-12', 'Este traslado nace de una liquidación o un abono: no se anula aquí.'); return D.update('cash_transfers', id, { status: 'VOIDED', void_reason: reason }); }
  function ledger() {
    const m = new Map(); for (const a of D.all('cash_accounts')) m.set(a.id, { acc: a, balance: a.opening_balance || 0, rows: [] });
    const add = (id, at, kind, label, amount, ref) => { const x = m.get(id); if (!x) return; x.balance = R(x.balance + amount); x.rows.push({ at, kind, label, amount: R(amount), ref }); };
    for (const p of D.all('payments')) if (p.status === 'CONFIRMED' && p.cash_account_id) add(p.cash_account_id, p.paid_at, 'COBRO', `${p.number} · ${G.pmName(p.payment_method_id)} · ${G.custName(p.customer_id)}`, p.amount, p.id);
    for (const t of D.all('cash_transfers')) if (t.status === 'CONFIRMED') { add(t.from_account_id, t.transferred_at, 'SALIDA', `Traslado a ${accName(t.to_account_id)} · ${t.reason}`, -t.amount, t.id); add(t.to_account_id, t.transferred_at, 'INGRESO', `Traslado de ${accName(t.from_account_id)} · ${t.reason}`, t.amount, t.id); }
    for (const b of D.all('settlement_batches')) if (b.kind === 'SETTLEMENT' && b.status !== 'OPEN' && (b.fee_amount + b.fee_igv) > 0) add(b.source_account_id, b.deposit_date + 'T12:00:00', 'COMISION', `Comisión e IGV · ${b.reference}`, -(b.fee_amount + b.fee_igv), b.id);
    for (const x of D.all('customer_balance_movements')) if (x.movement_type === 'REFUND' && x.refund_account_id) add(x.refund_account_id, x.at || x.created_at, 'DEVOLUCION', `Devolución de saldo a favor · ${G.custName(x.customer_id)}`, x.amount, x.id);
    return m;
  }

  /* ---------- cuentas por cobrar (v_receivables) ---------- */
  function receivables(opts = {}) {
    const ix = index(); const out = [];
    for (const d of D.all('sales_documents')) {
      if (!valid(d) || !['INVOICE', 'RECEIPT', 'DEBIT_NOTE'].includes(d.doc_type)) continue;
      if (!opts.includeCash && d.payment_terms !== 'CREDIT') continue;
      const rec = receivable(d, ix); if (rec < (d.payment_terms === 'CREDIT' ? 0.005 : 1)) continue;
      const age = G.date.diff(G.TODAY, d.issue_date); const overdue = d.due_date ? Math.max(0, G.date.diff(G.TODAY, d.due_date)) : 0;
      out.push({ doc: d, rec, age, overdue, bucket: age <= 30 ? 'B0' : age <= 60 ? 'B1' : 'B2' });
    }
    return out;
  }
  /** pedido contra entrega: se cobra al entregar */
  const isCOD = o => o.fulfillment === 'DELIVERY' && ['pm-CASH', 'pm-CARD'].includes(o.payment_method_id);

  /* ---------- utilidades de interfaz ---------- */
  function stbl(cols, rows, empty = 'Sin registros.') {
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, cols.map(c => h('th', { class: c[2] || '' }, c[0])))),
      h('tbody', null, rows.length ? rows.map(r => h('tr', null, cols.map(c => { const v = c[1](r); return h('td', { class: c[2] || '' }, v instanceof Node ? v : (v === null || v === undefined || v === '' ? '—' : String(v))); }))) : h('tr', null, h('td', { attrs: { colspan: cols.length } }, G.ui.empty(empty))))));
  }
  const RANGES = [['today', 'Hoy'], ['7d', '7 días'], ['month', 'Este mes'], ['all', 'Todo']];
  const inRange = (date, key) => { const d = day(date); if (key === 'today') return d === G.TODAY; if (key === '7d') return d > G.date.add(G.TODAY, -7) && d <= G.TODAY; if (key === 'month') return d >= G.date.month(G.TODAY) && d <= G.TODAY; return true; };
  const st = { range03: '7d', drv: null, date13: G.TODAY, inclCash: false };
  const brandOpts = () => G.scope.brands().map(b => [b.id, G.brandName(b.id)]);
  const pmOpts = () => D.where('payment_methods', p => p.status === 'ACTIVE' && p.id !== 'pm-CREDIT').map(p => [p.id, p.name]);
  const accOpts = pred => D.where('cash_accounts', a => a.status === 'ACTIVE' && (!pred || pred(a))).map(a => [a.id, a.name]);
  const linkTo = (label, fn) => h('a', { href: '#', on: { click: e => { e.preventDefault(); fn(); } } }, label);
  function custPicker(onPick) {
    const box = h('div', { class: 'stack', style: 'gap:6px' }); const res = h('div', { class: 'stack', style: 'gap:4px' });
    const inp = h('input', { class: 'input', placeholder: 'Buscar cliente por nombre, documento o celular…', attrs: { 'aria-label': 'Buscar cliente' } });
    inp.addEventListener('input', () => { G.ui.clear(res); const q = inp.value.trim().toLowerCase(); if (q.length < 2) return; const rows = D.where('customers', c => [c.full_name, c.trade_name, c.doc_number, c.phone].some(x => x && String(x).toLowerCase().includes(q))).slice(0, 8); if (!rows.length) res.appendChild(h('div', { class: 'small muted' }, 'Sin coincidencias.')); for (const c of rows) res.appendChild(h('button', { class: 'btn ghost sm', type: 'button', style: 'justify-content:flex-start;text-align:left', on: { click: () => onPick(c) } }, `${c.trade_name || c.full_name} · ${c.doc_type} ${c.doc_number || '—'}`)); });
    box.append(inp, res); return box;
  }
  const reconBadge = p => p.reconciliation_status ? status(p.reconciliation_status) : '—';
  function openItems(cid, ix) {
    ix = ix || index(); const out = [];
    const docOrders = new Set();
    for (const d of D.where('sales_documents', d => d.customer_id === cid && valid(d) && ['INVOICE', 'RECEIPT', 'DEBIT_NOTE'].includes(d.doc_type))) { if (d.order_id) docOrders.add(d.order_id); const rec = receivable(d, ix); if (rec > 0.009) out.push({ key: 'd:' + d.id, document_id: d.id, order_id: d.order_id || null, label: `${G.docTypeName(d.doc_type)} ${docNo(d)}`, date: d.issue_date, total: d.total, pending: rec, due: d.due_date }); }
    for (const o of D.where('sales_orders', o => o.customer_id === cid && !['DRAFT', 'CANCELLED'].includes(o.status) && !docOrders.has(o.id))) { const pend = R(orderTotal(o) - orderPaid(o.id, ix)); if (pend > 0.009) out.push({ key: 'o:' + o.id, order_id: o.id, document_id: null, label: `Pedido ${o.number} · ${G.ui.statusLabel(o.status)}`, date: o.delivery_date, total: orderTotal(o), pending: pend }); }
    return out.sort(U.by('date'));
  }

  /* =====================================================================
     Pantallas
     ===================================================================== */
  function caj01(el) {
    const body = page(el, { code: 'CAJ-01', title: 'Cuentas', sub: 'Cajas, bancos, billeteras, pasarela, adquirente y cajas de repartidores con su saldo, local, titular, comisión y días de abono. Los datos de pago que ve el cliente salen de aquí (RN-CAJ-01).', actions: G.can('caj.account.manage') ? [{ label: 'Nueva cuenta', kind: 'primary', onClick: () => accForm() }] : [] });
    const L = ledger(); const rows = D.where('cash_accounts', a => G.scope.ok(a, { brand: 'brand_id', site: 'establishment_id' }) || !a.establishment_id);
    const sumT = types => R(U.sum(rows.filter(a => types.includes(a.account_type)), a => L.get(a.id).balance));
    body.appendChild(kpis([{ label: 'Bancos', value: money(sumT(['BANK'])) }, { label: 'Billeteras (Yape, Plin)', value: money(sumT(['WALLET'])) }, { label: 'Por abonar (MP y POS)', value: money(sumT(['GATEWAY', 'CARD_ACQUIRER'])), sub: 'Cobrado, aún no depositado' }, { label: 'Efectivo en cajas', value: money(sumT(['CASH_REGISTER', 'PETTY_CASH'])) }, { label: 'En cajas de repartidores', value: money(sumT(['DRIVER_CASH'])), tone: sumT(['DRIVER_CASH']) > 0 ? 'warn' : 'ok', onClick: () => G.go('CAJ-07') }]));
    body.appendChild(table({ id: 'caj01', rows, pageSize: 30, columns: [{ key: 'name', label: 'Cuenta' }, { key: 'account_type', label: 'Tipo', value: a => ACC_TYPE[a.account_type] || a.account_type }, { key: 'establishment_id', label: 'Local', value: a => a.establishment_id ? G.siteName(a.establishment_id) : 'Empresa' }, { key: 'holder', label: 'Titular', value: a => a.holder_employee_id ? ((D.get('employees', a.holder_employee_id) || {}).full_name || '—') : (a.bank_name || 'AGROPECUARIA DON GUANDO SAC') }, { key: 'account_number', label: 'N.º / número', mono: true }, { key: 'fee_pct', label: 'Comisión', align: 'r', value: a => a.fee_pct ? F.pct(a.fee_pct, 2) : '—' }, { key: 'settlement_days', label: 'Abono', align: 'r', value: a => a.settlement_days ? F.days(a.settlement_days) : '—' }, { key: 'bal', label: 'Saldo', align: 'r', value: a => L.get(a.id).balance, render: a => money(L.get(a.id).balance) }, { key: 'status', label: 'Estado', render: a => status(a.status) }],
      filters: [{ key: 'account_type', label: 'Tipo', options: Object.entries(ACC_TYPE) }], onRow: a => openAcc(a.id, L) }));
  }
  function payData(a) {
    if (a.account_type === 'WALLET') return h('div', { class: 'row', style: 'align-items:flex-start' }, G.ui.qr(a.qr_payload || a.account_number, 110), dl([['Billetera', a.name], ['Número', a.account_number], ['Titular', a.holder_name || 'AGROPECUARIA DON GUANDO SAC']]));
    if (a.account_type === 'GATEWAY') return dl([['Enlace de pago', a.payment_link_base || '—'], ['Comisión', F.pct(a.fee_pct, 2) + ' + IGV'], ['Liberación', F.days(a.settlement_days)]]);
    if (a.account_type === 'BANK') return dl([['Banco', a.bank_name], ['Cuenta', a.account_number], ['CCI', a.cci || '—'], ['Titular', 'AGROPECUARIA DON GUANDO SAC']]);
    return dl([['Uso', ACC_TYPE[a.account_type]], a.max_balance ? ['Tope de efectivo', money(a.max_balance)] : null]);
  }
  function openAcc(id, L) {
    L = L || ledger(); const x = L.get(id); const a = x.acc;
    drawer(a.name, b => {
      b.appendChild(h('div', { class: 'grid c2' }, card('Datos', dl([['Tipo', ACC_TYPE[a.account_type]], ['Local', a.establishment_id ? G.siteName(a.establishment_id) : 'Empresa'], ['Saldo inicial (01/09)', money(a.opening_balance || 0)], ['Saldo actual', h('b', null, money(x.balance))], ['Comisión', a.fee_pct ? `${F.pct(a.fee_pct, 2)} + IGV ${F.pct(feeIgvRate() * 100, 0)}` : '—'], ['Días de abono', a.settlement_days || '—'], ['Estado', status(a.status)]])), card('Datos de pago oficiales', h('div', { class: 'stack' }, payData(a), h('div', { class: 'small muted' }, 'RN-CAJ-01: la vendedora no escribe ni edita estos datos; el mensaje de pago (CAJ-05) los toma de aquí.')))));
      const rows = x.rows.slice().sort((p, q) => String(q.at).localeCompare(String(p.at))).slice(0, 60);
      b.appendChild(card(`Últimos movimientos (${x.rows.length})`, stbl([['Fecha', r => F.datetime(r.at)], ['Tipo', r => ({ COBRO: 'Cobro', SALIDA: 'Traslado (sale)', INGRESO: 'Traslado (entra)', COMISION: 'Comisión', DEVOLUCION: 'Devolución' })[r.kind]], ['Detalle', r => r.label], ['Importe', r => h('span', { class: r.amount < 0 ? 'num' : 'num' }, money(r.amount)), 'r']], rows)));
    }, { wide: true, code: 'CAJ-01' });
  }
  function accForm() {
    drawer('Nueva cuenta', (b, close) => b.appendChild(form({ id: 'nacc', values: { account_type: 'BANK' }, fields: [{ key: 'name', label: 'Nombre', required: true }, { key: 'account_type', label: 'Tipo', type: 'select', required: true, options: Object.entries(ACC_TYPE).filter(x => x[0] !== 'DRIVER_CASH') }, { key: 'establishment_id', label: 'Local', type: 'select', options: G.scope.sites().map(e => [e.id, e.short]) }, { key: 'bank_name', label: 'Banco o proveedor' }, { key: 'account_number', label: 'N.º de cuenta, número o código de comercio', required: true }, { key: 'cci', label: 'CCI (bancos)' }, { key: 'fee_pct', label: 'Comisión %', type: 'number', min: 0 }, { key: 'settlement_days', label: 'Días de abono', type: 'number', min: 0 }], submitLabel: 'Crear cuenta', onCancel: close, onSubmit: v => {
      if (D.find('cash_accounts', a => a.account_number === v.account_number)) return { account_number: 'Ya existe una cuenta con ese número.' };
      D.insert('cash_accounts', { code: v.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10), name: v.name, account_type: v.account_type, establishment_id: v.establishment_id || null, currency: 'PEN', bank_name: v.bank_name || null, account_number: v.account_number, cci: v.cci || null, fee_pct: Number(v.fee_pct) || 0, fee_fixed: 0, settlement_days: Number(v.settlement_days) || 0, status: 'ACTIVE', opening_balance: 0, brand_id: null });
      close(); toast('Cuenta creada', 'ok'); G.refresh(); return true;
    } })), { code: 'CAJ-01' });
  }

  function caj02(el, params) {
    const body = page(el, { code: 'CAJ-02', title: 'Registrar cobro', sub: 'Medio, cuenta, monto, fecha y número de operación; tarjeta con marca y 4 dígitos; captura del voucher; aplicación al pedido o comprobante del cliente.' });
    if (!G.can('caj.payment.register')) body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso caj.payment.register.`, 'warn'));
    const s = st.reg && st.reg.key === JSON.stringify(params || {}) ? st.reg : (st.reg = { key: JSON.stringify(params || {}), cust: null, alloc: {}, vals: { payment_method_id: 'pm-YAPE', at: G.date.now().slice(0, 16), card_brand: 'VISA' } });
    if (!s.cust && params) { const o = params.order_id && D.get('sales_orders', params.order_id); const d = params.document_id && D.get('sales_documents', params.document_id); s.cust = params.customer_id || (o && o.customer_id) || (d && d.customer_id) || null; if (o) { s.vals.brand_id = o.brand_id; if (o.payment_method_id && o.payment_method_id !== 'pm-CREDIT') s.vals.payment_method_id = o.payment_method_id; } if (d) s.vals.brand_id = d.brand_id; s.pre = params; }
    const grid = h('div', { class: 'grid c2' }); body.appendChild(grid);
    const left = h('div', { class: 'stack' }), right = h('div', { class: 'stack' }); grid.append(left, right);
    const accFor = pm => { const k = (D.get('payment_methods', pm) || {}).kind; return accOpts(a => (PM_ACC[k] || []).includes(a.account_type) && a.account_type !== 'DRIVER_CASH'); };
    const sumAlloc = () => R(U.sum(Object.values(s.alloc), v => Number(v) || 0));
    const live = h('div', { class: 'small' });
    const updLive = () => { const amt = Number(s.vals.amount) || 0; const ap = sumAlloc(); G.ui.clear(live); live.append(`Aplicado ${money(ap)} de ${money(amt)} · sin aplicar ${money(R(amt - ap))}`); if (ap > amt + 0.001) live.append(h('span', { class: 'badge bad', style: 'margin-left:6px' }, 'RN-CAJ-05')); };
    const pm = D.get('payment_methods', s.vals.payment_method_id) || {};
    const accs = accFor(s.vals.payment_method_id);
    if (!accs.find(a => a[0] === s.vals.cash_account_id)) s.vals.cash_account_id = (accs.find(a => a[0] === G.pay.accountFor(s.vals.payment_method_id, {})) || accs[0] || [])[0];
    left.appendChild(card('Cobro', form({ id: 'reg', values: s.vals, submitLabel: false, fields: [
      { key: 'payment_method_id', label: 'Medio de pago', type: 'select', required: true, options: pmOpts(), onChange: v => { s.vals.payment_method_id = v; G.refresh(); } },
      { key: 'cash_account_id', label: 'Cuenta de la empresa', type: 'select', required: true, options: accs, onChange: v => { s.vals.cash_account_id = v; } },
      { key: 'amount', label: 'Monto (S/)', type: 'money', required: true, min: 0, onChange: v => { s.vals.amount = v; updLive(); } },
      { key: 'at', label: 'Fecha y hora', type: 'datetime', required: true, onChange: v => { s.vals.at = v; } },
      { key: 'reference', label: pm.requires_reference ? 'N.º de operación *' : 'N.º de operación', help: pm.requires_reference ? 'RN-CAJ-02 obligatorio · RN-CAJ-04 no se repite para el mismo medio.' : 'Opcional en efectivo.', onChange: v => { s.vals.reference = v; } },
      pm.id === 'pm-CARD' ? { key: 'card_brand', label: 'Marca de la tarjeta', type: 'select', required: true, options: [['VISA', 'Visa'], ['MASTERCARD', 'Mastercard'], ['AMEX', 'American Express'], ['DINERS', 'Diners']], onChange: v => { s.vals.card_brand = v; } } : null,
      pm.id === 'pm-CARD' ? { key: 'card_last4', label: '4 últimos dígitos', help: 'RN-CAJ-03', onChange: v => { s.vals.card_last4 = v; } } : null,
      { key: 'brand_id', label: 'Marca', type: 'select', options: brandOpts(), onChange: v => { s.vals.brand_id = v; } },
      { key: 'voucher_name', label: 'Voucher o captura (archivo)', placeholder: 'captura-yape.jpg', onChange: v => { s.vals.voucher_name = v; } },
    ].filter(Boolean) })));
    // cliente y aplicación
    const cbox = h('div', { class: 'stack' });
    if (!s.cust) cbox.appendChild(custPicker(c => { s.cust = c.id; s.alloc = {}; G.refresh(); }));
    else {
      const c = D.get('customers', s.cust); const ix = index(); const items = openItems(c.id, ix); const bal = balanceOf(c.id);
      if (s.pre && !s.preDone) { s.preDone = true; const it = items.find(i => (s.pre.document_id && i.document_id === s.pre.document_id) || (s.pre.order_id && i.order_id === s.pre.order_id && !i.document_id) || (s.pre.order_id && i.order_id === s.pre.order_id)); if (it) { s.alloc[it.key] = it.pending; if (!s.vals.amount) s.vals.amount = it.pending; } }
      cbox.appendChild(h('div', { class: 'row between' }, h('div', null, h('b', null, c.trade_name || c.full_name), h('div', { class: 'small muted' }, `${c.doc_type} ${c.doc_number || '—'} · saldo a favor ${money(bal)}`)), btn('Cambiar cliente', () => { s.cust = null; s.alloc = {}; G.refresh(); }, { sm: true, kind: 'ghost' })));
      cbox.appendChild(stbl([['Pedido o comprobante', i => i.label], ['Fecha', i => F.date(i.date)], ['Vence', i => i.due ? F.date(i.due) : '—'], ['Pendiente', i => money(i.pending), 'r'], ['Aplicar', i => h('input', { class: 'input', type: 'number', step: '0.01', min: 0, style: 'width:110px', value: s.alloc[i.key] ?? '', attrs: { 'aria-label': 'Aplicar a ' + i.label }, on: { input: e => { s.alloc[i.key] = e.target.value; updLive(); } } }), 'r']], items, 'El cliente no tiene pedidos ni comprobantes pendientes: el cobro queda sin aplicar o como saldo a favor.'));
      cbox.appendChild(h('div', { class: 'row' }, btn('Aplicar en orden de antigüedad', () => { let left2 = Number(s.vals.amount) || 0; s.alloc = {}; for (const i of items) { if (left2 <= 0) break; const t = Math.min(left2, i.pending); s.alloc[i.key] = R(t); left2 = R(left2 - t); } G.refresh(); }, { sm: true }), live));
      s._items = items;
    }
    right.appendChild(card('Cliente y aplicación', cbox));
    right.appendChild(h('div', { class: 'row', style: 'justify-content:flex-end' }, btn('Limpiar', () => { st.reg = null; G.go('CAJ-02'); }, { kind: 'ghost' }), btn('Registrar cobro', () => G.require('caj.payment.register', () => {
      try {
        const f = el.querySelector('form'); if (f) Object.assign(s.vals, f.api.values);
        if (!s.cust) G.fail('RN-CAJ-01', 'Elige el cliente que paga.');
        const allocs = (s._items || []).filter(i => Number(s.alloc[i.key]) > 0).map(i => ({ order_id: i.order_id, document_id: i.document_id, amount: Number(s.alloc[i.key]) }));
        const p = register({ customer_id: s.cust, payment_method_id: s.vals.payment_method_id, cash_account_id: s.vals.cash_account_id, amount: s.vals.amount, at: s.vals.at ? s.vals.at + (s.vals.at.length === 16 ? ':00' : '') : null, reference: s.vals.reference, card_brand: s.vals.card_brand, card_last4: s.vals.card_last4, brand_id: s.vals.brand_id, voucher_name: s.vals.voucher_name, allocations: allocs });
        st.reg = null; toast(`${p.number} registrado por ${money(p.amount)}${unapplied(p) > 0 ? ` · ${money(unapplied(p))} sin aplicar` : ''}`, 'ok'); G.go('CAJ-03'); openPay(p.id);
      } catch (e) { err(e); }
    }), { kind: 'primary', disabled: !G.can('caj.payment.register') })));
    updLive();
  }

  function openPay(id) {
    const p = D.get('payments', id); if (!p) return;
    drawer(`Cobro ${p.number}`, (b, close) => {
      const acts = [];
      if (p.status === 'CONFIRMED' && unapplied(p) > 0.009) { acts.push(btn('Aplicar', () => { close(); G.go('CAJ-04', { id: p.id }); }, { sm: true, kind: 'primary' })); acts.push(btn('Pasar a saldo a favor', () => modal('Pasar a saldo a favor', bd => bd.appendChild(form({ id: 'tob', values: { amount: unapplied(p) }, fields: [{ key: 'amount', label: 'Monto', type: 'money', required: true, min: 0 }, { key: 'reason', label: 'Motivo', required: true }], submitLabel: 'Pasar', onSubmit: v => { try { toBalance(p.id, v.amount, v.reason); G.ui.closeAll(); toast('Saldo a favor registrado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))), { sm: true })); }
      if (p.status === 'CONFIRMED') acts.push(btn('Revertir', () => G.require('caj.payment.reverse', () => modal(`Revertir ${p.number}`, bd => bd.appendChild(form({ id: 'rev', fields: [{ key: 'reason', label: 'Motivo del reverso', type: 'textarea', required: true, help: 'RN-CAJ-06: un cobro revertido no se reactiva y deshace sus aplicaciones.' }], submitLabel: 'Revertir cobro', onSubmit: v => { try { reverse(p.id, v.reason); G.ui.closeAll(); toast(`${p.number} revertido`, 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })))), { sm: true, kind: 'danger' }));
      if (acts.length) b.appendChild(h('div', { class: 'row' }, acts));
      if (p.status === 'REVERSED') b.appendChild(notice(`Revertido el ${F.datetime(p.reversed_at)} por ${p.reversed_by}: ${p.reversal_reason}`, 'bad'));
      const batch = p.settlement_batch_id && D.get('settlement_batches', p.settlement_batch_id); const ls = p.driver_settlement_id && D.get('driver_settlements', p.driver_settlement_id);
      b.appendChild(h('div', { class: 'grid c2' }, dl([['Cliente', G.custName(p.customer_id)], ['Medio', G.pmName(p.payment_method_id)], ['Cuenta', accName(p.cash_account_id)], ['Monto', h('b', null, money(p.amount))], ['Fecha', F.datetime(p.paid_at)], ['N.º de operación', p.reference || '—'], p.card_last4 ? ['Tarjeta', `${p.card_brand || ''} •••• ${p.card_last4}`] : null, p.voucher_name ? ['Voucher', p.voucher_name] : null]),
        dl([['Estado', status(p.status)], ['Conciliación', reconBadge(p)], ['Comisión estimada', money(p.fee_amount || 0)], batch ? ['Abono', `${batch.reference} · ${G.ui.statusLabel(batch.status)}`] : null, ls ? ['Liquidación', `${ls.number} · ${G.ui.statusLabel(ls.status)}`] : null, ['Registró', G.userName(p.received_by)], p.collected_by_user_id ? ['Cobró (repartidor)', G.userName(p.collected_by_user_id)] : null, ['Aplicado', money(applied(p))], ['Sin aplicar', money(unapplied(p))]])));
      b.appendChild(card('Aplicaciones', stbl([['Pedido', a => a.order_id ? (D.get('sales_orders', a.order_id) || {}).number : '—'], ['Comprobante', a => a.document_id ? (G.fac ? linkTo(docNo(D.get('sales_documents', a.document_id)), () => G.fac.open(a.document_id)) : docNo(D.get('sales_documents', a.document_id))) : '—'], ['Monto', a => money(a.amount), 'r']], (p.allocations || []).concat(p.to_balance ? [{ order_id: null, document_id: null, amount: p.to_balance }] : []), 'Sin aplicar.')));
    }, { wide: true, code: 'CAJ-03' });
  }
  function caj03(el) {
    const body = page(el, { code: 'CAJ-03', title: 'Cobros', sub: 'Cobros por fecha, medio, cuenta, marca, vendedora, repartidor y estado de conciliación; reverso con motivo.', actions: G.can('caj.payment.register') ? [{ label: 'Registrar cobro', kind: 'primary', onClick: () => { st.reg = null; G.go('CAJ-02'); } }] : [] });
    body.appendChild(pills(RANGES, st.range03, v => { st.range03 = v; G.refresh(); }));
    const rows = G.scope.filter(D.where('payments', p => inRange(p.paid_at, st.range03)));
    const ok = rows.filter(p => p.status === 'CONFIRMED');
    body.appendChild(kpis([{ label: 'Cobrado', value: money(U.sum(ok, p => p.amount)), sub: `${ok.length} cobros` }, { label: 'Digital por conciliar', value: money(U.sum(ok.filter(p => p.reconciliation_status === 'PENDING'), p => p.amount)), tone: 'warn', onClick: () => G.go('CAJ-09') }, { label: 'Efectivo contra entrega', value: money(U.sum(ok.filter(p => (p.cash_account_id || '').startsWith('ca-DRV')), p => p.amount)), onClick: () => G.go('CAJ-06') }, { label: 'Sin aplicar', value: money(U.sum(ok, p => Math.max(0, unapplied(p)))), onClick: () => G.go('CAJ-04') }, { label: 'Revertidos', value: F.num(rows.filter(p => p.status === 'REVERSED').length), tone: rows.some(p => p.status === 'REVERSED') ? 'bad' : '' }]));
    body.appendChild(table({ id: 'caj03', rows, sort: 'paid_at', dir: -1, pageSize: 20, searchPlaceholder: 'N.º de cobro, operación o cliente…', searchText: p => G.custName(p.customer_id) + ' ' + (p.reference || ''),
      columns: [{ key: 'paid_at', label: 'Fecha', render: p => F.datetime(p.paid_at) }, { key: 'number', label: 'Cobro', mono: true }, { key: 'customer_id', label: 'Cliente', value: p => G.custName(p.customer_id) }, { key: 'payment_method_id', label: 'Medio', value: p => G.pmName(p.payment_method_id) }, { key: 'reference', label: 'Operación', mono: true }, { key: 'amount', label: 'Monto', align: 'r', render: p => money(p.amount) }, { key: 'un', label: 'Sin aplicar', align: 'r', value: p => p.status === 'CONFIRMED' ? unapplied(p) : 0, render: p => p.status === 'CONFIRMED' && unapplied(p) > 0.009 ? h('span', { class: 'badge warn' }, money(unapplied(p))) : '—' }, { key: 'reconciliation_status', label: 'Conciliación', render: reconBadge, value: p => G.ui.statusLabel(p.reconciliation_status) }, { key: 'status', label: 'Estado', render: p => status(p.status) }],
      filters: [{ key: 'payment_method_id', label: 'Medio', options: pmOpts().concat([['pm-BALANCE', 'Saldo a favor']]) }, { key: 'cash_account_id', label: 'Cuenta', options: accOpts() }, { key: 'brand_id', label: 'Marca', options: brandOpts() }, { key: 'received_by', label: 'Vendedora', options: D.where('users', u => u.role === 'VENDEDORA').map(u => [u.id, u.name]) }, { key: 'collected_by_user_id', label: 'Repartidor', options: drivers().map(u => [u.id, u.name]) }, { key: 'reconciliation_status', label: 'Conciliación', options: ['PENDING', 'MATCHED', 'DIFFERENCE', 'NOT_APPLICABLE'].map(x => [x, G.ui.statusLabel(x)]) }, { key: 'status', label: 'Estado', options: [['CONFIRMED', 'Confirmado'], ['REVERSED', 'Revertido']] }],
      onRow: p => openPay(p.id), footer: ['', '', '', '', 'Total vigente', { v: money(U.sum(ok, p => p.amount)), align: 'r' }, '', '', ''] }));
  }

  function caj04(el, params) {
    const p = params && params.id ? D.get('payments', params.id) : null;
    const body = page(el, { code: 'CAJ-04', title: 'Aplicar cobro', sub: 'Reparte un cobro entre los pedidos y comprobantes del cliente y muestra lo que queda sin aplicar (RN-CAJ-05, RN-CAJ-07).' });
    if (!p) {
      const rows = G.scope.filter(D.where('payments', x => x.status === 'CONFIRMED' && x.payment_method_id !== 'pm-BALANCE' && unapplied(x) > 0.009));
      body.appendChild(notice(`${rows.length} cobro(s) vigentes con saldo sin aplicar. Elige uno.`, rows.length ? 'warn' : 'ok'));
      body.appendChild(table({ id: 'caj04', rows, sort: 'paid_at', dir: -1, columns: [{ key: 'paid_at', label: 'Fecha', render: x => F.datetime(x.paid_at) }, { key: 'number', label: 'Cobro', mono: true }, { key: 'customer_id', label: 'Cliente', value: x => G.custName(x.customer_id) }, { key: 'payment_method_id', label: 'Medio', value: x => G.pmName(x.payment_method_id) }, { key: 'amount', label: 'Monto', align: 'r', render: x => money(x.amount) }, { key: 'un', label: 'Sin aplicar', align: 'r', value: x => unapplied(x), render: x => money(unapplied(x)) }], onRow: x => G.go('CAJ-04', { id: x.id }), empty: 'Todos los cobros están aplicados.' }));
      return;
    }
    const ix = index(); const items = openItems(p.customer_id, ix); const s = st['ap' + p.id] = st['ap' + p.id] || {};
    const un = unapplied(p);
    body.appendChild(h('div', { class: 'grid c2' }, card('Cobro', dl([['Cobro', p.number], ['Cliente', G.custName(p.customer_id)], ['Medio', G.pmName(p.payment_method_id)], ['Operación', p.reference || '—'], ['Monto', money(p.amount)], ['Aplicado', money(applied(p))], ['Sin aplicar', h('b', null, money(un))], ['Estado', status(p.status)]])),
      card('Aplicaciones actuales', stbl([['Pedido', a => a.order_id ? (D.get('sales_orders', a.order_id) || {}).number : '—'], ['Comprobante', a => a.document_id ? docNo(D.get('sales_documents', a.document_id)) : '—'], ['Monto', a => money(a.amount), 'r']], p.allocations || [], 'Sin aplicaciones.'))));
    const live = h('span', { class: 'small' }); const upd = () => { const t = R(U.sum(Object.values(s), v => Number(v) || 0)); G.ui.clear(live); live.append(`Por aplicar ahora ${money(t)} · quedará sin aplicar ${money(R(un - t))}`); if (t > un + 0.001) live.append(h('span', { class: 'badge bad', style: 'margin-left:6px' }, 'RN-CAJ-05')); };
    body.appendChild(card('Pendientes del cliente', h('div', { class: 'stack' }, stbl([['Pedido o comprobante', i => i.label], ['Fecha', i => F.date(i.date)], ['Total', i => money(i.total), 'r'], ['Pendiente', i => money(i.pending), 'r'], ['Aplicar', i => h('input', { class: 'input', type: 'number', step: '0.01', min: 0, style: 'width:110px', value: s[i.key] ?? '', attrs: { 'aria-label': 'Aplicar a ' + i.label }, on: { input: e => { s[i.key] = e.target.value; upd(); } } }), 'r']], items, 'Sin pendientes: pasa el saldo a favor del cliente.'),
      h('div', { class: 'row between' }, live, h('div', { class: 'row' }, un > 0.009 ? btn('Pasar lo no aplicado a saldo a favor', () => run(() => toBalance(p.id, un, `Pago de más en ${p.number}`), `${money(un)} a saldo a favor`), { sm: true }) : null, btn('Aplicar', () => run(() => { const list = items.filter(i => Number(s[i.key]) > 0).map(i => ({ order_id: i.order_id, document_id: i.document_id, amount: Number(s[i.key]) })); apply(p.id, list); delete st['ap' + p.id]; }, 'Cobro aplicado'), { kind: 'primary' }))))));
    upd();
  }

  function caj05(el, params) {
    const body = page(el, { code: 'CAJ-05', title: 'Mensaje de pago', sub: 'Arma el mensaje con el monto y los datos oficiales de la empresa (QR de Yape o Plin, enlace de Mercado Pago o cuenta bancaria). La vendedora no edita los datos de la cuenta (RN-CAJ-01).' });
    const ix = index();
    const orders = G.scope.filter(D.where('sales_orders', o => ['DRAFT', 'CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY'].includes(o.status) && o.delivery_date >= G.TODAY && R(orderTotal(o) - orderPaid(o.id, ix)) > 0.009)).sort(U.by('number', -1)).slice(0, 120);
    const s = st.msg = st.msg || { order: (params && params.order_id) || (orders[0] || {}).id, pm: 'pm-YAPE' };
    if (params && params.order_id) s.order = params.order_id;
    const o = D.get('sales_orders', s.order);
    body.appendChild(h('div', { class: 'row' }, h('select', { class: 'input', style: 'max-width:420px', attrs: { 'aria-label': 'Pedido' }, on: { change: e => { s.order = e.target.value; G.refresh(); } } }, orders.map(x => h('option', { value: x.id, selected: x.id === s.order }, `${x.number} · ${G.custName(x.customer_id)} · ${money(R(orderTotal(x) - orderPaid(x.id, ix)))}`))), pills([['pm-YAPE', 'Yape'], ['pm-PLIN', 'Plin'], ['pm-MP', 'Mercado Pago'], ['pm-TRANSFER', 'Transferencia']], s.pm, v => { s.pm = v; G.refresh(); })));
    if (!o) { body.appendChild(G.ui.empty('No hay pedidos con saldo por pagar.')); return; }
    const due = R(orderTotal(o) - orderPaid(o.id, ix));
    const a = acc(G.pay.accountFor(s.pm, {}));
    const brand = D.get('brands', o.brand_id) || {}; const c = D.get('customers', o.customer_id) || {};
    const link = `${a.payment_link_base || 'https://link.mercadopago.com.pe/donguando'}?ref=${o.number}&monto=${due.toFixed(2)}`;
    const dataLine = s.pm === 'pm-MP' ? `Paga con tarjeta aquí: ${link}` : s.pm === 'pm-TRANSFER' ? `Transfiere a ${a.bank_name} cta. cte. ${a.account_number} · CCI ${a.cci} · titular AGROPECUARIA DON GUANDO SAC` : `Yapea o plinea al ${String(a.account_number).replace('+51', '')} (AGROPECUARIA DON GUANDO SAC) o escanea el QR adjunto`;
    const text = `Hola ${String(c.full_name || '').split(' ')[0]}, gracias por tu pedido ${o.number} de ${brand.whatsapp_display_name || G.brandName(o.brand_id)}.\nTotal a pagar: ${money(due)}${o.final_total == null ? ' (estimado; el peso real se confirma al pesar)' : ''}.\n${dataLine}.\nEnvíanos la captura con el número de operación para confirmar tu pedido.`;
    body.appendChild(h('div', { class: 'grid side-r' },
      card('Mensaje para el cliente', h('div', { class: 'stack' }, h('textarea', { class: 'input', readOnly: true, rows: 7, attrs: { 'aria-label': 'Mensaje' } }, text), h('div', { class: 'row' }, btn('Copiar', () => { try { navigator.clipboard.writeText(text); toast('Mensaje copiado', 'ok'); } catch (e) { toast('Copia el texto manualmente', 'warn'); } }, { sm: true }), btn('Enviar por WhatsApp', () => run(() => { const ch = D.find('messaging_channels', x => x.kind === 'WHATSAPP' && x.brand_id === o.brand_id); return G.msg.send({ customer_id: o.customer_id, channel_id: ch ? ch.id : null, kind: 'SESSION', text, ref: o.id, inServiceWindow: true }); }, m => `Mensaje enviado (costo ${money(m.cost)}, dentro de la ventana de servicio)`), { sm: true, kind: 'primary' })))),
      card('Datos oficiales (solo lectura)', h('div', { class: 'stack' }, s.pm === 'pm-YAPE' || s.pm === 'pm-PLIN' ? G.ui.qr(a.qr_payload || a.account_number, 150) : s.pm === 'pm-MP' ? G.ui.qr(link, 150) : null, payData(a), notice('RN-CAJ-01: estos datos salen de la cuenta registrada en CAJ-01; para cambiarlos se requiere el permiso caj.account.manage.', 'info')))));
  }

  function caj06(el) {
    const body = page(el, { code: 'CAJ-06', title: 'Caja del repartidor', sub: 'Cobros contra entrega del día por repartidor: entregados y cobrados, entregados por cobrar y en ruta. Solo el repartidor asignado registra el cobro (RN-CAJ-15).' });
    const ix = index(); const ds = drivers();
    const todays = D.where('sales_orders', o => o.driver_user_id && o.delivery_date === G.TODAY && ['IN_ROUTE', 'DELIVERED', 'NOT_DELIVERED', 'CLOSED'].includes(o.status));
    const cards = ds.map(u => {
      const os = todays.filter(o => o.driver_user_id === u.id);
      const cod = os.filter(isCOD);
      const exp = driverExpected(u.id);
      const collectedToday = D.where('payments', p => p.status === 'CONFIRMED' && p.collected_by_user_id === u.id && day(p.paid_at) === G.TODAY);
      const toCollect = cod.filter(o => ['DELIVERED', 'CLOSED'].includes(o.status) && R(orderTotal(o) - orderPaid(o.id, ix)) > 0.009);
      return { u, os, cod, exp, collectedToday, toCollect };
    });
    body.appendChild(kpis([{ label: 'Pedidos asignados hoy', value: F.num(todays.length) }, { label: 'Contra entrega', value: F.num(cards.reduce((a, c) => a + c.cod.length, 0)) }, { label: 'Efectivo en manos de repartidores', value: money(U.sum(cards, c => c.exp.cash)), tone: 'warn', onClick: () => G.go('CAJ-07') }, { label: 'Entregados por cobrar', value: F.num(cards.reduce((a, c) => a + c.toCollect.length, 0)), tone: cards.some(c => c.toCollect.length) ? 'bad' : 'ok' }]));
    for (const c of cards) {
      const rows = c.os.map(o => ({ o, pend: R(orderTotal(o) - orderPaid(o.id, ix)) }));
      body.appendChild(card(`${c.u.name} · ${accName(driverAcc(c.u.id))}`, h('div', { class: 'stack' },
        h('div', { class: 'row' }, badge(`Efectivo por liquidar ${money(c.exp.cash)}`, c.exp.cash > 0 ? 'warn' : 'ok'), badge(`Cobrado hoy ${money(U.sum(c.collectedToday, p => p.amount))}`, 'info'), c.exp.payments.some(p => day(p.paid_at) < G.TODAY) ? badge('Tiene efectivo de días anteriores sin liquidar', 'bad') : null, btn('Liquidar', () => { st.drv = c.u.id; G.go('CAJ-07'); }, { sm: true, kind: 'primary' })),
        stbl([['Pedido', x => x.o.number], ['Cliente', x => G.custName(x.o.customer_id)], ['Estado', x => status(x.o.status)], ['Pago', x => G.pmName(x.o.payment_method_id) + (isCOD(x.o) ? ' · contra entrega' : '')], ['Total', x => money(orderTotal(x.o)), 'r'], ['Por cobrar', x => x.pend > 0.009 ? h('b', null, money(x.pend)) : '—', 'r'], ['', x => ['DELIVERED', 'CLOSED'].includes(x.o.status) && x.pend > 0.009 && x.o.payment_method_id !== 'pm-CREDIT' ? btn('Cobrar', () => codModal(x.o, x.pend), { sm: true }) : '']], rows, 'Sin pedidos asignados hoy.'))));
    }
  }
  function codModal(o, pend) {
    modal(`Cobro contra entrega · ${o.number}`, (b, close) => b.appendChild(form({ id: 'cod', values: { payment_method_id: o.payment_method_id === 'pm-CARD' ? 'pm-CARD' : 'pm-CASH', amount: pend, card_brand: 'VISA' }, fields: [{ key: 'payment_method_id', label: 'Medio', type: 'select', required: true, options: D.where('payment_methods', p => p.allowed_on_delivery && p.status === 'ACTIVE').map(p => [p.id, p.name]) }, { key: 'amount', label: 'Monto', type: 'money', required: true, min: 0 }, { key: 'reference', label: 'N.º de operación (no efectivo)' }, { key: 'card_brand', label: 'Marca de tarjeta', type: 'select', options: [['VISA', 'Visa'], ['MASTERCARD', 'Mastercard']] }, { key: 'card_last4', label: '4 últimos dígitos (tarjeta)' }], help: '', submitLabel: 'Registrar cobro', onCancel: close, onSubmit: v => {
      try {
        const doc = D.find('sales_documents', d => d.order_id === o.id && valid(d) && ['INVOICE', 'RECEIPT'].includes(d.doc_type));
        const p = register({ customer_id: o.customer_id, payment_method_id: v.payment_method_id, amount: v.amount, reference: v.reference, card_brand: v.card_brand, card_last4: v.card_last4, cash_account_id: v.payment_method_id === 'pm-CASH' ? driverAcc(o.driver_user_id) : null, collected_by_user_id: o.driver_user_id, on_delivery: true, brand_id: o.brand_id, establishment_id: o.establishment_id, allocations: [{ order_id: o.id, document_id: doc ? doc.id : null, amount: v.amount }] });
        close(); toast(`${p.number} registrado a nombre de ${G.userShort(o.driver_user_id)}`, 'ok'); G.refresh(); return true;
      } catch (e) { return e.message; }
    } })));
  }

  function caj07(el) {
    const body = page(el, { code: 'CAJ-07', title: 'Liquidación del repartidor', sub: 'Al volver de ruta: efectivo esperado, efectivo entregado, diferencia y motivo, y quién recibe; el efectivo pasa solo a la caja receptora (RN-CAJ-10, RN-CAJ-11). D-CAJ-03: recibe la cajera del Local 1 o administración en el Local 2.' });
    const ds = drivers(); if (!st.drv || !ds.find(u => u.id === st.drv)) st.drv = (ds.find(u => driverExpected(u.id).cash > 0) || ds[0] || {}).id;
    body.appendChild(pills(ds.map(u => [u.id, `${u.name.split(' ').slice(0, 2).join(' ')} · ${money(driverExpected(u.id).cash)}`]), st.drv, v => { st.drv = v; G.refresh(); }));
    const u = D.get('users', st.drv); if (!u) return;
    const exp = driverExpected(u.id);
    const me = G.ctx.userId() === u.id;
    if (me) body.appendChild(notice('RN-CAJ-11: no puedes recibir tu propia liquidación.', 'bad'));
    if (!G.can('caj.driver.settle')) body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso caj.driver.settle.`, 'warn'));
    const tol = Number(G.param('caj_driver_diff_tolerance') ?? 0);
    const diffBox = h('div', { class: 'kpi', style: 'min-width:0' });
    const showDiff = v => { const d = R((Number(v) || 0) - exp.cash); G.ui.clear(diffBox); diffBox.className = 'kpi ' + (Math.abs(d) > tol + 0.001 ? 'bad' : 'ok'); diffBox.append(h('span', { class: 'lbl' }, 'Diferencia'), h('span', { class: 'val' }, money(d)), h('span', { class: 'sub' }, Math.abs(d) > tol + 0.001 ? `Supera la tolerancia (${money(tol)}): exige motivo` : 'Cuadra')); };
    body.appendChild(h('div', { class: 'grid c2' },
      card(`Efectivo esperado · ${exp.payments.length} cobro(s)`, h('div', { class: 'stack' }, stbl([['Cobro', p => p.number], ['Hora', p => F.datetime(p.paid_at)], ['Pedido', p => ((p.allocations || [])[0] && (D.get('sales_orders', p.allocations[0].order_id) || {}).number) || '—'], ['Cliente', p => G.custName(p.customer_id)], ['Monto', p => money(p.amount), 'r']], exp.payments, 'Sin efectivo por liquidar.'), h('div', { class: 'row between' }, h('span', { class: 'small muted' }, `Digital cobrado en ruta: ${money(exp.digital)} (${exp.digitalPayments.length})`), h('b', null, `Esperado ${money(exp.cash)}`)))),
      card('Entrega del efectivo', h('div', { class: 'stack' }, diffBox, form({ id: 'liq', values: { delivered_cash: exp.cash, receiving_account_id: receivingFor(u.id) }, fields: [{ key: 'delivered_cash', label: 'Efectivo entregado (S/)', type: 'money', required: true, min: 0, onChange: v => showDiff(v) }, { key: 'reason', label: 'Motivo de la diferencia', type: 'textarea' }, { key: 'receiving_account_id', label: 'Caja que recibe', type: 'select', required: true, options: accOpts(a => ['CASH_REGISTER', 'PETTY_CASH', 'BANK'].includes(a.account_type)) }], submitLabel: me || !G.can('caj.driver.settle') ? false : 'Liquidar', onSubmit: v => { try { const s = settleDriver({ driver_user_id: u.id, delivered_cash: v.delivered_cash, reason: v.reason, receiving_account_id: v.receiving_account_id }); toast(`${s.number}: ${G.ui.statusLabel(s.status)}${s.difference ? ' · diferencia ' + money(s.difference) : ''}`, s.difference ? 'warn' : 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })))));
    showDiff(exp.cash);
    const hist = D.all('driver_settlements').slice().sort(U.by('settled_at', -1));
    body.appendChild(table({ id: 'caj07', rows: hist, sort: 'settled_at', dir: -1, pageSize: 12, columns: [{ key: 'number', label: 'Liquidación', mono: true }, { key: 'settlement_date', label: 'Fecha', render: s => F.date(s.settlement_date) }, { key: 'driver_user_id', label: 'Repartidor', value: s => G.userShort(s.driver_user_id) }, { key: 'expected_cash', label: 'Esperado', align: 'r', render: s => money(s.expected_cash) }, { key: 'delivered_cash', label: 'Entregado', align: 'r', render: s => money(s.delivered_cash) }, { key: 'difference', label: 'Diferencia', align: 'r', render: s => s.difference ? h('span', { class: 'badge ' + (s.difference < 0 ? 'bad' : 'warn') }, money(s.difference)) : money(0) }, { key: 'receiving_account_id', label: 'Recibió', value: s => `${accName(s.receiving_account_id)} · ${G.userShort(s.received_by)}` }, { key: 'status', label: 'Estado', render: s => status(s.status === 'WITH_DIFFERENCE' ? 'DIFFERENCE' : s.status) }],
      filters: [{ key: 'driver_user_id', label: 'Repartidor', options: drivers().map(x => [x.id, x.name]) }, { key: 'status', label: 'Estado', options: [['SETTLED', 'Liquidado'], ['WITH_DIFFERENCE', 'Con diferencia'], ['APPROVED', 'Aprobado']] }],
      onRow: s => drawer(`Liquidación ${s.number}`, b => { b.appendChild(dl([['Repartidor', G.userName(s.driver_user_id)], ['Fecha', F.date(s.settlement_date)], ['Ruta (DEL)', s.route_ref || '—'], ['Esperado efectivo', money(s.expected_cash)], ['Digital cobrado en ruta', money(s.expected_digital)], ['Entregado', money(s.delivered_cash)], ['Diferencia', money(s.difference)], ['Motivo', s.difference_reason || '—'], ['Caja que recibe', accName(s.receiving_account_id)], ['Recibió', G.userName(s.received_by)], ['Estado', status(s.status === 'WITH_DIFFERENCE' ? 'DIFFERENCE' : s.status)], s.approved_by ? ['Aprobó', `${s.approved_by} · ${F.datetime(s.approved_at)}`] : null])); b.appendChild(stbl([['Cobro', p => p.number], ['Medio', p => G.pmName(p.payment_method_id)], ['Monto', p => money(p.amount), 'r']], (s.payment_ids || []).map(id => D.get('payments', id)).filter(Boolean))); }, { code: 'CAJ-07', wide: true }),
      actions: s => s.status === 'WITH_DIFFERENCE' && G.can('caj.reconciliation.manage') ? [btn('Aprobar diferencia', () => run(() => approveSettlement(s.id), 'Diferencia aprobada'), { sm: true })] : [] }));
  }

  function openBatch(id) {
    const b = D.get('settlement_batches', id);
    drawer(`Abono ${b.reference}`, (bd, close) => {
      const c = batchCheck(b); const ok = Math.abs(c.d1) < 0.005 && Math.abs(c.d2) < 0.005;
      if (b.status === 'OPEN') bd.appendChild(notice(ok ? 'Cuadra: la suma de los cobros es igual al bruto y bruto − comisión − IGV = neto. Ciérralo para conciliar los cobros.' : `No cuadra (RN-CAJ-12): cobros ${money(c.sum)} vs bruto ${money(b.gross_amount)} (diferencia ${money(c.d1)}); bruto − comisión − IGV − neto = ${money(c.d2)}.`, ok ? 'ok' : 'warn'));
      if (b.status === 'OPEN' && G.can('caj.reconciliation.manage')) bd.appendChild(ok ? h('div', { class: 'row' }, btn('Cerrar conciliado', () => { if (run(() => closeBatch(id), 'Abono conciliado: cobros en MATCHED')) { close(); openBatch(id); } }, { kind: 'primary', sm: true })) : form({ id: 'cb', fields: [{ key: 'reason', label: 'Motivo para cerrar con diferencia', type: 'textarea', required: true }], submitLabel: 'Cerrar con diferencia', onSubmit: v => { try { closeBatch(id, { reason: v.reason }); close(); toast('Abono cerrado con diferencia', 'warn'); G.refresh(); openBatch(id); return true; } catch (e) { return e.message; } } }));
      bd.appendChild(h('div', { class: 'grid c2' }, dl([['Origen', accName(b.source_account_id)], ['Abonado en', accName(b.bank_account_id)], ['Fecha de abono', F.date(b.deposit_date)], ['Referencia', b.reference], ['Tipo', b.kind === 'SETTLEMENT' ? 'Liquidación de pasarela o adquirente' : 'Estado de cuenta'], ['Estado', status(b.status === 'WITH_DIFFERENCE' ? 'DIFFERENCE' : b.status)], b.difference_reason ? ['Motivo', b.difference_reason] : null]), dl([['Bruto', money(b.gross_amount)], ['Comisión', money(b.fee_amount)], ['IGV de la comisión', money(b.fee_igv)], ['Neto abonado', h('b', null, money(b.net_amount))], ['Cobros incluidos', `${c.items.length} · ${money(c.sum)}`], ['Costo efectivo', b.gross_amount ? F.pct((b.fee_amount + b.fee_igv) / b.gross_amount * 100, 2) : '—']])));
      bd.appendChild(stbl([['Cobro', i => (D.get('payments', i.payment_id) || {}).number], ['Fecha', i => F.datetime((D.get('payments', i.payment_id) || {}).paid_at)], ['Operación', i => (D.get('payments', i.payment_id) || {}).reference], ['Bruto', i => money(i.gross_amount), 'r'], ['Comisión', i => money(i.fee_amount), 'r'], ['Conciliación', i => reconBadge(D.get('payments', i.payment_id) || {})]], c.items));
    }, { wide: true, code: 'CAJ-08' });
  }
  function batchForm() {
    const s = { source: 'ca-MP', bank: 'ca-BCP-CTE', date: G.TODAY, ref: '', gross: '', fee: '', sel: {} };
    drawer('Registrar abono', (b, close) => {
      const draw = () => {
        G.ui.clear(b);
        const src = acc(s.source); const ps = pendingOf(s.source).slice(-300);
        const selected = ps.filter(p => s.sel[p.id]); const sum = R(U.sum(selected, p => p.amount));
        const gross = s.gross === '' ? sum : Number(s.gross); const fee = s.fee === '' ? R(gross * (src.fee_pct || 0) / 100) : Number(s.fee); const igv = R(fee * feeIgvRate()); const net = R(gross - fee - igv);
        b.appendChild(h('div', { class: 'grid c2' },
          h('label', { class: 'small' }, 'Origen ', h('select', { class: 'input', on: { change: e => { s.source = e.target.value; s.sel = {}; draw(); } } }, accOpts(a => ['GATEWAY', 'CARD_ACQUIRER', 'WALLET'].includes(a.account_type) || a.id === 'ca-BCP-CTE').map(([v, l]) => h('option', { value: v, selected: v === s.source }, l)))),
          h('label', { class: 'small' }, 'Abonado en ', h('select', { class: 'input', on: { change: e => { s.bank = e.target.value; } } }, accOpts(a => a.account_type === 'BANK').map(([v, l]) => h('option', { value: v, selected: v === s.bank }, l)))),
          h('label', { class: 'small' }, 'Fecha de abono ', h('input', { class: 'input', type: 'date', value: s.date, on: { change: e => { s.date = e.target.value; } } })),
          h('label', { class: 'small' }, 'Referencia (n.º de liquidación u operación) ', h('input', { class: 'input', value: s.ref, on: { input: e => { s.ref = e.target.value; } } })),
          h('label', { class: 'small' }, 'Bruto (vacío = suma seleccionada) ', h('input', { class: 'input', type: 'number', step: '0.01', value: s.gross, on: { change: e => { s.gross = e.target.value; draw(); } } })),
          h('label', { class: 'small' }, `Comisión (vacío = ${F.pct(src.fee_pct || 0, 2)}) `, h('input', { class: 'input', type: 'number', step: '0.01', value: s.fee, on: { change: e => { s.fee = e.target.value; draw(); } } }))));
        b.appendChild(h('div', { class: 'row' }, badge(`Seleccionado ${money(sum)} (${selected.length})`, 'info'), badge(`Bruto ${money(gross)}`), badge(`Comisión ${money(fee)} + IGV ${money(igv)}`), badge(`Neto ${money(net)}`, 'ok'), Math.abs(sum - gross) > 0.005 ? badge(`Diferencia ${money(R(sum - gross))}`, 'bad') : badge('Cuadra', 'ok')));
        b.appendChild(h('div', { class: 'row' }, btn('Seleccionar todos', () => { for (const p of ps) s.sel[p.id] = true; draw(); }, { sm: true }), btn('Ninguno', () => { s.sel = {}; draw(); }, { sm: true, kind: 'ghost' }), btn('Crear abono', () => { try { const bt = createBatch({ source_account_id: s.source, bank_account_id: s.bank, deposit_date: s.date, reference: s.ref, gross_amount: gross, fee_amount: fee, fee_igv: igv, net_amount: net, payment_ids: selected.map(p => p.id) }); close(); toast(`Abono ${bt.reference} registrado`, 'ok'); G.refresh(); openBatch(bt.id); } catch (e) { err(e); } }, { kind: 'primary', sm: true })));
        b.appendChild(h('div', { style: 'max-height:380px;overflow:auto' }, stbl([['', p => h('input', { type: 'checkbox', checked: !!s.sel[p.id], attrs: { 'aria-label': 'Incluir ' + p.number }, on: { change: e => { s.sel[p.id] = e.target.checked; draw(); } } })], ['Cobro', p => p.number], ['Fecha', p => F.datetime(p.paid_at)], ['Operación', p => p.reference], ['Monto', p => money(p.amount), 'r']], ps, 'Sin cobros pendientes de esta cuenta.')));
      };
      draw();
    }, { wide: true, code: 'CAJ-08' });
  }
  function caj08(el) {
    const can = G.can('caj.reconciliation.manage');
    const body = page(el, { code: 'CAJ-08', title: 'Abonos de pasarela y adquirente', sub: 'Abono en el banco (bruto, comisión, IGV de la comisión, neto) y los cobros que incluye; cuadre automático. También concilia Yape, Plin y banco contra el estado de cuenta (importación simulada).', actions: can ? [{ label: 'Registrar abono', kind: 'primary', onClick: () => batchForm() }] : [] });
    if (!can) body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso caj.reconciliation.manage: solo consulta.`, 'warn'));
    const rows = D.all('settlement_batches');
    const mth = rows.filter(b => b.deposit_date >= G.date.month(G.TODAY) && b.status !== 'OPEN' && b.kind === 'SETTLEMENT');
    const k2 = G.kpi('KPI-CAJ-02');
    body.appendChild(kpis([{ label: 'Abonos abiertos', value: F.num(rows.filter(b => b.status === 'OPEN').length), tone: rows.some(b => b.status === 'OPEN') ? 'warn' : 'ok' }, { label: 'Liquidaciones conciliadas (mes)', value: F.num(mth.length), sub: money(U.sum(mth, b => b.gross_amount)) + ' bruto' }, { label: 'Comisiones con IGV (mes)', value: money(U.sum(mth, b => b.fee_amount + b.fee_igv)) }, { label: 'Costo de cobro digital', value: k2 ? F.pct(k2.value, 2) : '—', sub: 'KPI-CAJ-02' }, { label: 'Con diferencia', value: F.num(rows.filter(b => b.status === 'WITH_DIFFERENCE').length) }]));
    if (can) {
      const dt = h('input', { class: 'input', type: 'date', value: G.TODAY, style: 'width:auto', attrs: { 'aria-label': 'Fecha' } });
      const showRes = r => modal(`Estado de cuenta importado · ${r.lines.length} movimientos`, bd => { bd.appendChild(h('div', { class: 'row' }, badge(`Conciliados ${r.matched.length} · ${money(U.sum(r.matched, p => p.amount))}`, 'ok'), badge(`Cobros sin abono ${r.missing.length}`, r.missing.length ? 'bad' : 'ok'), badge(`Abonos sin cobro ${r.unknown.length}`, r.unknown.length ? 'warn' : 'ok'))); if (r.missing.length) bd.appendChild(card('Cobros registrados que no aparecen en el estado de cuenta (revisar la captura)', stbl([['Cobro', p => p.number], ['Fecha', p => F.datetime(p.paid_at)], ['Operación', p => p.reference], ['Monto', p => money(p.amount), 'r'], ['Registró', p => G.userShort(p.received_by)]], r.missing))); if (r.unknown.length) bd.appendChild(card('Abonos del banco sin cobro registrado', stbl([['Fecha', l => F.date(l.date)], ['Operación', l => l.op], ['Monto', l => money(l.amount), 'r']], r.unknown))); });
      body.appendChild(card('Importar (simulado)', h('div', { class: 'stack' }, h('div', { class: 'row' }, dt, btn('Liquidación de Mercado Pago', () => { const bt = run(() => importSettlement('ca-MP', { date: dt.value }), x => `Liquidación ${x.reference}: ${money(x.gross_amount)} bruto, comisión ${money(x.fee_amount)} + IGV ${money(x.fee_igv)}`); if (bt) openBatch(bt.id); }, { sm: true }), btn('Liquidación del POS Visa', () => { const bt = run(() => importSettlement('ca-POS-VISA', { date: dt.value }), x => `Liquidación ${x.reference} importada`); if (bt) openBatch(bt.id); }, { sm: true }), btn('Estado de cuenta Yape', () => { const r = run(() => importStatement('ca-YAPE', dt.value)); if (r) showRes(r); }, { sm: true }), btn('Estado de cuenta Plin', () => { const r = run(() => importStatement('ca-PLIN', dt.value)); if (r) showRes(r); }, { sm: true }), btn('Estado de cuenta BCP (transferencias)', () => { const r = run(() => importStatement('ca-BCP-CTE', dt.value)); if (r) showRes(r); }, { sm: true })), h('div', { class: 'small muted' }, `Mercado Pago: ${F.pct(acc('ca-MP').fee_pct, 2)} + IGV, abono a ${acc('ca-MP').settlement_days} días · POS Visa: ${F.pct(acc('ca-POS-VISA').fee_pct, 2)} + IGV, ${acc('ca-POS-VISA').settlement_days} días · caj_mp_fee_igv_rate = ${feeIgvRate()}`))));
    }
    body.appendChild(table({ id: 'caj08', rows, sort: 'deposit_date', dir: -1, pageSize: 15, columns: [{ key: 'deposit_date', label: 'Abono', render: b => F.date(b.deposit_date) }, { key: 'reference', label: 'Referencia', mono: true }, { key: 'source_account_id', label: 'Origen', value: b => accName(b.source_account_id) }, { key: 'gross_amount', label: 'Bruto', align: 'r', render: b => money(b.gross_amount) }, { key: 'fee', label: 'Comisión + IGV', align: 'r', value: b => R(b.fee_amount + b.fee_igv), render: b => money(R(b.fee_amount + b.fee_igv)) }, { key: 'net_amount', label: 'Neto', align: 'r', render: b => money(b.net_amount) }, { key: 'status', label: 'Estado', render: b => status(b.status === 'WITH_DIFFERENCE' ? 'DIFFERENCE' : b.status) }],
      filters: [{ key: 'source_account_id', label: 'Origen', options: accOpts(a => ['GATEWAY', 'CARD_ACQUIRER', 'WALLET', 'BANK'].includes(a.account_type)) }, { key: 'status', label: 'Estado', options: [['OPEN', 'Abierto'], ['MATCHED', 'Conciliado'], ['WITH_DIFFERENCE', 'Con diferencia']] }], onRow: b => openBatch(b.id) }));
  }

  function caj09(el) {
    const body = page(el, { code: 'CAJ-09', title: 'Conciliación pendiente', sub: `Cobros digitales sin conciliar por antigüedad; alerta a los ${alertDays()} días de vencido el plazo de abono de la cuenta (caj_reconciliation_alert_days).` });
    const rows = G.scope.filter(D.where('payments', p => p.status === 'CONFIRMED' && DIGITAL.includes(p.payment_method_id) && p.reconciliation_status === 'PENDING')).map(p => { const a = acc(p.cash_account_id) || {}; const age = G.date.diff(G.TODAY, day(p.paid_at)); const late = age - (a.settlement_days || 0); return Object.assign(p, { _age: age, _late: late }); });
    const alertRows = rows.filter(p => p._late > alertDays());
    const k = G.kpi('KPI-CAJ-03');
    body.appendChild(kpis([{ label: 'Sin conciliar', value: money(U.sum(rows, p => p.amount)), sub: `${rows.length} cobros` }, { label: 'En plazo de abono', value: money(U.sum(rows.filter(p => p._late <= 0), p => p.amount)) }, { label: `Vencidos 1–${alertDays()} días`, value: money(U.sum(rows.filter(p => p._late > 0 && p._late <= alertDays()), p => p.amount)), tone: 'warn' }, { label: `Con alerta (> ${alertDays()} días)`, value: money(U.sum(alertRows, p => p.amount)), tone: alertRows.length ? 'bad' : 'ok', sub: `KPI-CAJ-03 ${k ? money(k.value) : ''}` }]));
    const byAcc = U.groupBy(rows, 'cash_account_id');
    body.appendChild(card('Por cuenta', G.ui.chart.hbar({ items: Object.entries(byAcc).map(([a, ps]) => ({ label: accName(a), value: R(U.sum(ps, p => p.amount)), tone: ps.some(p => p._late > alertDays()) ? 'bad' : '' })), format: money })));
    body.appendChild(table({ id: 'caj09', rows, sort: '_late', dir: -1, columns: [{ key: 'paid_at', label: 'Fecha', render: p => F.datetime(p.paid_at) }, { key: 'number', label: 'Cobro', mono: true }, { key: 'cash_account_id', label: 'Cuenta', value: p => accName(p.cash_account_id) }, { key: 'reference', label: 'Operación', mono: true }, { key: 'customer_id', label: 'Cliente', value: p => G.custName(p.customer_id) }, { key: 'amount', label: 'Monto', align: 'r', render: p => money(p.amount) }, { key: '_age', label: 'Antigüedad', align: 'r', render: p => F.days(p._age) }, { key: '_late', label: 'Vencido el abono', align: 'r', render: p => p._late > alertDays() ? h('span', { class: 'badge bad' }, F.days(p._late)) : p._late > 0 ? h('span', { class: 'badge warn' }, F.days(p._late)) : 'En plazo' }, { key: 'batch', label: 'Abono', value: p => p.settlement_batch_id ? 'En abono abierto' : '—' }],
      filters: [{ key: 'cash_account_id', label: 'Cuenta', options: accOpts(a => ['GATEWAY', 'CARD_ACQUIRER', 'WALLET', 'BANK'].includes(a.account_type)) }], onRow: p => openPay(p.id) }));
  }

  function caj10(el) {
    const body = page(el, { code: 'CAJ-10', title: 'Saldos a favor', sub: 'Clientes con saldo a favor (pago de más, diferencia de peso, nota de crédito), sus movimientos y su uso en un pedido o devolución (RN-CAJ-08, D-CAJ-04).' });
    const bal = balances(); const movs = U.groupBy(D.all('customer_balance_movements'), 'customer_id');
    const rows = [...bal.entries()].filter(([, v]) => Math.abs(v) > 0.004).map(([cid, v]) => ({ id: cid, cid, name: G.custName(cid), bal: v, n: (movs[cid] || []).length, last: (movs[cid] || []).map(m => m.at || m.created_at).sort().pop() }));
    body.appendChild(kpis([{ label: 'Saldo a favor total', value: money(U.sum(rows, r => r.bal)), sub: 'KPI-CAJ-05' }, { label: 'Clientes con saldo', value: F.num(rows.length) }, { label: 'Usado este mes', value: money(-U.sum(D.where('customer_balance_movements', m => m.movement_type === 'APPLIED' && day(m.at || m.created_at) >= G.date.month(G.TODAY)), m => m.amount)) }, { label: 'Devuelto este mes', value: money(-U.sum(D.where('customer_balance_movements', m => m.movement_type === 'REFUND' && day(m.at || m.created_at) >= G.date.month(G.TODAY)), m => m.amount)) }]));
    body.appendChild(table({ id: 'caj10', rows, sort: 'bal', dir: -1, columns: [{ key: 'name', label: 'Cliente' }, { key: 'bal', label: 'Saldo a favor', align: 'r', render: r => money(r.bal) }, { key: 'n', label: 'Movimientos', align: 'r' }, { key: 'last', label: 'Último', render: r => F.datetime(r.last) }], onRow: r => openBal(r.cid), empty: 'Ningún cliente tiene saldo a favor.' }));
  }
  function openBal(cid) {
    drawer(`Saldo a favor · ${G.custName(cid)}`, (b, close) => {
      const bal = balanceOf(cid); const ix = index();
      const orders = D.where('sales_orders', o => o.customer_id === cid && !['CANCELLED', 'DRAFT'].includes(o.status) && R(orderTotal(o) - orderPaid(o.id, ix)) > 0.009);
      b.appendChild(h('div', { class: 'row' }, h('b', null, `Saldo ${money(bal)}`),
        btn('Usar en un pedido', () => modal('Usar saldo a favor', bd => bd.appendChild(form({ id: 'use', values: { amount: Math.min(bal, orders[0] ? R(orderTotal(orders[0]) - orderPaid(orders[0].id, ix)) : bal) }, fields: [{ key: 'order_id', label: 'Pedido', type: 'select', required: true, options: orders.map(o => [o.id, `${o.number} · debe ${money(R(orderTotal(o) - orderPaid(o.id, ix)))}`]) }, { key: 'amount', label: 'Monto', type: 'money', required: true, min: 0 }], submitLabel: 'Aplicar saldo', onSubmit: v => { try { useBalance(cid, v.amount, { order_id: v.order_id }); G.ui.closeAll(); toast('Saldo aplicado al pedido', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))), { sm: true, kind: 'primary', disabled: !(bal > 0) || !orders.length }),
        btn('Devolver', () => G.require('caj.balance.refund', () => modal('Devolver saldo a favor', bd => bd.appendChild(form({ id: 'ref', values: { amount: bal, account_id: 'ca-YAPE' }, fields: [{ key: 'amount', label: 'Monto', type: 'money', required: true, min: 0 }, { key: 'account_id', label: 'Desde (D-CAJ-04: transferencia o Yape)', type: 'select', required: true, options: accOpts(a => ['BANK', 'WALLET'].includes(a.account_type)) }, { key: 'reference', label: 'N.º de operación', required: true }, { key: 'reason', label: 'Motivo', required: true }], submitLabel: 'Registrar devolución', onSubmit: v => { try { refundBalance(cid, v.amount, v); G.ui.closeAll(); toast('Devolución registrada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })))), { sm: true, disabled: !(bal > 0) })));
      b.appendChild(stbl([['Fecha', m => F.datetime(m.at || m.created_at)], ['Tipo', m => MOV[m.movement_type]], ['Detalle', m => m.reason], ['Pedido', m => m.order_id ? (D.get('sales_orders', m.order_id) || {}).number : '—'], ['Importe', m => money(m.amount), 'r']], D.where('customer_balance_movements', m => m.customer_id === cid).sort(U.by('at', -1))));
    }, { wide: true, code: 'CAJ-10' });
  }

  function caj11(el) {
    const body = page(el, { code: 'CAJ-11', title: 'Cuentas por cobrar', sub: 'Comprobantes con saldo por cliente y antigüedad (0–30, 31–60, más de 60 días) con su vencimiento. Saldo = total − notas de crédito − cobros aplicados; los rechazados por SUNAT no cuentan (RN-CAJ-14).' });
    if (!G.can('caj.receivable.view')) { body.appendChild(notice(`Tu rol (${G.roleName()}) no tiene el permiso caj.receivable.view.`, 'warn')); return; }
    body.appendChild(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.inclCash, on: { change: e => { st.inclCash = e.target.checked; G.refresh(); } } }), h('span', null, 'Incluir saldos de comprobantes al contado (diferencias de peso por cobrar, desde S/ 1,00)')));
    const recs = receivables({ includeCash: st.inclCash }).filter(x => G.scope.ok(x.doc));
    const total = R(U.sum(recs, x => x.rec)); const over = R(U.sum(recs.filter(x => x.overdue > 0), x => x.rec));
    const k = G.kpi('KPI-CAJ-04');
    body.appendChild(kpis([{ label: 'Por cobrar', value: money(total), sub: `${recs.length} comprobantes` }, { label: 'Vencido', value: money(over), tone: over > 0 ? 'bad' : 'ok', sub: k ? `KPI-CAJ-04 ${F.pct(k.value)}` : '' }, { label: '0–30 días', value: money(U.sum(recs.filter(x => x.bucket === 'B0'), x => x.rec)) }, { label: '31–60 días', value: money(U.sum(recs.filter(x => x.bucket === 'B1'), x => x.rec)), tone: 'warn' }, { label: 'Más de 60 días', value: money(U.sum(recs.filter(x => x.bucket === 'B2'), x => x.rec)), tone: 'bad' }]));
    const byC = U.groupBy(recs, x => x.doc.customer_id);
    const rows = Object.entries(byC).map(([cid, xs]) => ({ id: cid, name: G.custName(cid), n: xs.length, total: R(U.sum(xs, x => x.rec)), b0: R(U.sum(xs.filter(x => x.bucket === 'B0'), x => x.rec)), b1: R(U.sum(xs.filter(x => x.bucket === 'B1'), x => x.rec)), b2: R(U.sum(xs.filter(x => x.bucket === 'B2'), x => x.rec)), over: R(U.sum(xs.filter(x => x.overdue > 0), x => x.rec)), maxOver: Math.max(0, ...xs.map(x => x.overdue)), xs }));
    body.appendChild(table({ id: 'caj11', rows, sort: 'total', dir: -1, columns: [{ key: 'name', label: 'Cliente' }, { key: 'n', label: 'Comp.', align: 'r' }, { key: 'b0', label: '0–30', align: 'r', render: r => money(r.b0) }, { key: 'b1', label: '31–60', align: 'r', render: r => money(r.b1) }, { key: 'b2', label: '> 60', align: 'r', render: r => money(r.b2) }, { key: 'over', label: 'Vencido', align: 'r', render: r => r.over > 0 ? h('span', { class: 'badge bad' }, `${money(r.over)} · ${r.maxOver} d`) : '—' }, { key: 'total', label: 'Total', align: 'r', render: r => h('b', null, money(r.total)) }],
      onRow: r => drawer(`Por cobrar · ${r.name}`, (b, close) => { b.appendChild(h('div', { class: 'row' }, G.can('caj.payment.register') ? btn('Registrar cobro', () => { close(); st.reg = null; G.go('CAJ-02', { customer_id: r.id }); }, { sm: true, kind: 'primary' }) : null)); b.appendChild(stbl([['Comprobante', x => G.fac ? linkTo(docNo(x.doc), () => G.fac.open(x.doc.id)) : docNo(x.doc)], ['Emisión', x => F.date(x.doc.issue_date)], ['Vence', x => F.date(x.doc.due_date)], ['Total', x => money(x.doc.total), 'r'], ['Saldo', x => money(x.rec), 'r'], ['Vencido', x => x.overdue ? h('span', { class: 'badge bad' }, F.days(x.overdue)) : 'Al día']], r.xs.sort((a, c) => a.doc.issue_date.localeCompare(c.doc.issue_date)))); }, { wide: true, code: 'CAJ-11' }),
      footer: ['Total', '', { v: money(U.sum(rows, r => r.b0)), align: 'r' }, { v: money(U.sum(rows, r => r.b1)), align: 'r' }, { v: money(U.sum(rows, r => r.b2)), align: 'r' }, { v: money(over), align: 'r' }, { v: money(total), align: 'r' }], empty: 'Sin cuentas por cobrar.' }));
  }

  function caj12(el) {
    const body = page(el, { code: 'CAJ-12', title: 'Traslados entre cuentas', sub: 'Depósitos del mostrador al banco, fondos de caja chica, barridos de billeteras y traspasos de liquidaciones, con referencia y motivo.', actions: G.canDo('CAJ', 'C') ? [{ label: 'Nuevo traslado', kind: 'primary', onClick: () => drawer('Nuevo traslado', (b, close) => b.appendChild(form({ id: 'tr', values: { from: 'ca-CAJA-L1', to: 'ca-BCP-CTE', at: G.date.now().slice(0, 16) }, fields: [{ key: 'from', label: 'Desde', type: 'select', required: true, options: accOpts() }, { key: 'to', label: 'Hacia', type: 'select', required: true, options: accOpts() }, { key: 'amount', label: 'Monto', type: 'money', required: true, min: 0 }, { key: 'at', label: 'Fecha y hora', type: 'datetime', required: true }, { key: 'reference', label: 'N.º de operación o depósito' }, { key: 'reason', label: 'Motivo', required: true }], submitLabel: 'Registrar traslado', onCancel: close, onSubmit: v => { try { transfer(Object.assign({}, v, { at: v.at + ':00' })); close(); toast('Traslado registrado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })), { code: 'CAJ-12' }) }] : [] });
    const rows = D.all('cash_transfers');
    const m = rows.filter(t => t.status === 'CONFIRMED' && day(t.transferred_at) >= G.date.month(G.TODAY));
    body.appendChild(kpis([{ label: 'Traslados del mes', value: F.num(m.length) }, { label: 'Depositado al banco (mes)', value: money(U.sum(m.filter(t => (acc(t.to_account_id) || {}).account_type === 'BANK'), t => t.amount)) }, { label: 'De liquidaciones de repartidores', value: money(U.sum(m.filter(t => t.settlement_id), t => t.amount)) }, { label: 'Netos de abonos MP/POS', value: money(U.sum(m.filter(t => t.batch_id), t => t.amount)) }]));
    body.appendChild(table({ id: 'caj12', rows, sort: 'transferred_at', dir: -1, columns: [{ key: 'transferred_at', label: 'Fecha', render: t => F.datetime(t.transferred_at) }, { key: 'from_account_id', label: 'Desde', value: t => accName(t.from_account_id) }, { key: 'to_account_id', label: 'Hacia', value: t => accName(t.to_account_id) }, { key: 'amount', label: 'Monto', align: 'r', render: t => money(t.amount) }, { key: 'reference', label: 'Referencia', mono: true }, { key: 'reason', label: 'Motivo' }, { key: 'status', label: 'Estado', render: t => status(t.status) }],
      filters: [{ key: 'from_account_id', label: 'Desde', options: accOpts() }, { key: 'to_account_id', label: 'Hacia', options: accOpts() }],
      actions: t => t.status === 'CONFIRMED' && !t.settlement_id && !t.batch_id && G.canDo('CAJ', 'A') ? [btn('Anular', () => modal('Anular traslado', bd => bd.appendChild(form({ id: 'vt', fields: [{ key: 'reason', label: 'Motivo', required: true }], submitLabel: 'Anular', onSubmit: v => { try { voidTransfer(t.id, v.reason); G.ui.closeAll(); toast('Traslado anulado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))), { sm: true, kind: 'ghost' })] : [] }));
  }

  function caj13(el) {
    const body = page(el, { code: 'CAJ-13', title: 'Cierre diario de caja', sub: 'Resumen del día por cuenta y medio: saldo inicial, cobrado, trasladado, comisiones, conciliado, diferencias de repartidores y saldo final.', actions: [{ label: 'Imprimir', onClick: () => G.print() }] });
    const dt = h('input', { class: 'input', type: 'date', value: st.date13, style: 'width:auto', attrs: { 'aria-label': 'Fecha' }, on: { change: e => { st.date13 = e.target.value; G.refresh(); } } });
    body.appendChild(h('div', { class: 'row' }, dt, btn('Hoy', () => { st.date13 = G.TODAY; G.refresh(); }, { sm: true }), btn('Día anterior', () => { st.date13 = G.date.add(st.date13, -1); G.refresh(); }, { sm: true })));
    const d = st.date13; const L = ledger();
    const rows = [...L.values()].map(x => { const before = x.rows.filter(r => day(r.at) < d); const on = x.rows.filter(r => day(r.at) === d); const open = R((x.acc.opening_balance || 0) + U.sum(before, r => r.amount)); const c = R(U.sum(on.filter(r => r.kind === 'COBRO'), r => r.amount)); const tin = R(U.sum(on.filter(r => r.kind === 'INGRESO'), r => r.amount)); const tout = R(U.sum(on.filter(r => r.kind === 'SALIDA'), r => r.amount)); const fee = R(U.sum(on.filter(r => r.kind === 'COMISION' || r.kind === 'DEVOLUCION'), r => r.amount)); return { id: x.acc.id, name: x.acc.name, type: x.acc.account_type, open, c, tin, tout, fee, close: R(open + c + tin + tout + fee) }; }).filter(r => r.open || r.c || r.tin || r.tout || r.fee);
    const pays = D.where('payments', p => p.status === 'CONFIRMED' && day(p.paid_at) === d);
    const matched = D.where('payments', p => p.matched_at && day(p.matched_at) === d);
    const sets = D.where('driver_settlements', s => s.settlement_date === d);
    body.appendChild(kpis([{ label: 'Cobrado del día', value: money(U.sum(pays, p => p.amount)), sub: `${pays.length} cobros` }, { label: 'Conciliado del día', value: money(U.sum(matched, p => p.amount)), sub: `${matched.length} cobros` }, { label: 'Liquidaciones de repartidores', value: F.num(sets.length), sub: money(U.sum(sets, s => s.delivered_cash)) + ' entregado' }, { label: 'Diferencias de caja', value: money(U.sum(sets, s => s.difference || 0)), tone: sets.some(s => Math.abs(s.difference || 0) > 0.001) ? 'bad' : 'ok' }]));
    const caja = rows.find(r => r.id === 'ca-CAJA-L1');
    if (d === G.TODAY && caja && caja.close > 200 && G.canDo('CAJ', 'C')) body.appendChild(notice(h('div', { class: 'row between' }, h('span', null, `La caja del mostrador tiene ${money(caja.close)}; el fondo fijo es S/ 200,00.`), btn(`Depositar ${money(R(caja.close - 200))} al BCP`, () => run(() => transfer({ from: 'ca-CAJA-L1', to: 'ca-BCP-CTE', amount: R(caja.close - 200), reference: 'DEP-' + d.replace(/-/g, ''), reason: 'Depósito del efectivo del día' }), 'Depósito registrado'), { sm: true, kind: 'primary' })), 'info'));
    body.appendChild(table({ id: 'caj13', rows, search: false, pageSize: 30, columns: [{ key: 'name', label: 'Cuenta' }, { key: 'type', label: 'Tipo', value: r => ACC_TYPE[r.type] }, { key: 'open', label: 'Saldo inicial', align: 'r', render: r => money(r.open) }, { key: 'c', label: 'Cobrado', align: 'r', render: r => money(r.c) }, { key: 'tin', label: 'Entradas', align: 'r', render: r => money(r.tin) }, { key: 'tout', label: 'Salidas', align: 'r', render: r => money(r.tout) }, { key: 'fee', label: 'Comisiones y devol.', align: 'r', render: r => money(r.fee) }, { key: 'close', label: 'Saldo final', align: 'r', render: r => h('b', null, money(r.close)) }],
      footer: ['Total', '', { v: money(U.sum(rows, r => r.open)), align: 'r' }, { v: money(U.sum(rows, r => r.c)), align: 'r' }, { v: money(U.sum(rows, r => r.tin)), align: 'r' }, { v: money(U.sum(rows, r => r.tout)), align: 'r' }, { v: money(U.sum(rows, r => r.fee)), align: 'r' }, { v: money(U.sum(rows, r => r.close)), align: 'r' }] }));
    const byPm = U.groupBy(pays, 'payment_method_id');
    body.appendChild(h('div', { class: 'grid c2' }, card('Por medio de pago', stbl([['Medio', ([k]) => G.pmName(k)], ['Cobros', ([, v]) => v.length, 'r'], ['Monto', ([, v]) => money(U.sum(v, p => p.amount)), 'r'], ['Conciliados', ([, v]) => v.filter(p => p.reconciliation_status === 'MATCHED').length, 'r']], Object.entries(byPm))), card('Liquidaciones del día', stbl([['N.º', s => s.number], ['Repartidor', s => G.userShort(s.driver_user_id)], ['Esperado', s => money(s.expected_cash), 'r'], ['Entregado', s => money(s.delivered_cash), 'r'], ['Diferencia', s => money(s.difference), 'r'], ['Estado', s => status(s.status === 'WITH_DIFFERENCE' ? 'DIFFERENCE' : s.status)]], sets, 'Sin liquidaciones este día.'))));
  }

  G.register({
    code: 'CAJ', name: 'Cajas, cobros y conciliación', phase: 1, group: 'Finanzas',
    screens: [
      { code: 'CAJ-01', name: 'Cuentas', render: caj01 },
      { code: 'CAJ-02', name: 'Registrar cobro', render: caj02 },
      { code: 'CAJ-03', name: 'Cobros', render: caj03 },
      { code: 'CAJ-04', name: 'Aplicar cobro', render: caj04 },
      { code: 'CAJ-05', name: 'Mensaje de pago', render: caj05 },
      { code: 'CAJ-06', name: 'Caja del repartidor', render: caj06 },
      { code: 'CAJ-07', name: 'Liquidación del repartidor', render: caj07 },
      { code: 'CAJ-08', name: 'Abonos de pasarela y adquirente', render: caj08 },
      { code: 'CAJ-09', name: 'Conciliación pendiente', render: caj09 },
      { code: 'CAJ-10', name: 'Saldos a favor', render: caj10 },
      { code: 'CAJ-11', name: 'Cuentas por cobrar', render: caj11 },
      { code: 'CAJ-12', name: 'Traslados entre cuentas', render: caj12 },
      { code: 'CAJ-13', name: 'Cierre diario de caja', render: caj13 },
    ],
  });

  G.caj = { register, apply, toBalance, reverse, updatePayment, receivable, receivables, orderPaid, syncOrder, balanceOf, addBalance, useBalance, refundBalance, driverExpected, settleDriver, approveSettlement, createBatch, closeBatch, importSettlement, importStatement, transfer, voidTransfer, ledger, balance: id => (ledger().get(id) || {}).balance, unapplied, openPayment: openPay };

  /* nota de crédito aceptada sobre un comprobante ya pagado → saldo a favor; pedido cancelado con pago → saldo a favor */
  G.events.on('document.accepted', p => {
    const nc = D.get('sales_documents', p.document_id);
    if (!nc || nc.doc_type !== 'CREDIT_NOTE' || !nc.related_document_id) return;
    if (D.find('customer_balance_movements', m => m.document_id === nc.id)) return;
    const ref = D.get('sales_documents', nc.related_document_id); const rec = receivable(ref);
    if (rec < -0.009) addBalance(nc.customer_id, nc.note_reason_code === '09' ? 'WEIGHT_DIFFERENCE' : 'CREDIT_NOTE', R(Math.min(nc.total, -rec)), { document_id: nc.id, order_id: nc.order_id, reason: `${docNo(nc)} sobre ${docNo(ref)} ya pagado` });
  });
  G.events.on('order.cancelled', p => {
    const o = D.get('sales_orders', p.order_id); if (!o) return;
    const paid = orderPaid(o.id); if (paid > 0.009 && !D.find('customer_balance_movements', m => m.order_id === o.id && m.movement_type === 'OVERPAYMENT')) addBalance(o.customer_id, 'OVERPAYMENT', paid, { order_id: o.id, reason: `Pedido ${o.number} cancelado con pago` });
  });

  /* ---------- búsqueda, escáner y alertas ---------- */
  G.searchProviders.push(q => {
    const s = q.trim().toUpperCase(); if (s.length < 4) return [];
    return D.where('payments', p => (p.number || '').includes(s) || String(p.reference || '').toUpperCase().includes(s)).slice(0, 6).map(p => ({ label: `Cobro ${p.number} · ${money(p.amount)}`, sub: `${G.pmName(p.payment_method_id)} ${p.reference || ''} · ${G.custName(p.customer_id)} · ${G.ui.statusLabel(p.status)}`, go: () => { G.go('CAJ-03'); openPay(p.id); } }));
  });
  G.scanHandlers.push(code => { const p = D.find('payments', x => x.number === code); return p ? () => { G.go('CAJ-03'); openPay(p.id); } : null; });
  G.alertProviders.push(() => {
    const out = [];
    for (const u of drivers()) { const e = driverExpected(u.id, G.date.add(G.TODAY, -1)); if (e.cash > 0) out.push({ module: 'CAJ', title: `${u.name.split(' ').slice(0, 2).join(' ')} tiene ${money(e.cash)} sin liquidar de días anteriores`, detail: 'RN-CAJ-10: liquida su caja en CAJ-07.', tone: 'bad', go: () => { st.drv = u.id; G.go('CAJ-07'); } }); }
    const dif = D.where('driver_settlements', s => s.status === 'WITH_DIFFERENCE');
    if (dif.length) out.push({ module: 'CAJ', title: `${dif.length} liquidación(es) con diferencia de caja por aprobar`, detail: dif.map(s => `${s.number} ${money(s.difference)}`).join(', '), tone: 'warn', go: () => G.go('CAJ-07') });
    const k = G.kpi('KPI-CAJ-03', { from: null });
    if (k && k.value > 0) out.push({ module: 'CAJ', title: `${money(k.value)} en cobros digitales sin conciliar`, detail: `${k.numerator} cobro(s) con más de ${alertDays()} días de vencido su plazo de abono.`, tone: 'warn', go: () => G.go('CAJ-09') });
    const open = D.where('settlement_batches', b => b.status === 'OPEN');
    if (open.length) out.push({ module: 'CAJ', title: `${open.length} abono(s) por cerrar`, detail: open.map(b => b.reference).join(', '), tone: 'info', go: () => G.go('CAJ-08') });
    return out;
  });

  /* ---------- indicadores (TAB) ---------- */
  const inP = (date, p) => { const d0 = day(date); return d0 >= (p.from || '0000') && d0 <= (p.to || '9999'); };
  G.kpiCalc['KPI-CAJ-01'] = p => { const ss = D.where('driver_settlements', s => inP(s.settlement_date, p)); const num = R(U.sum(ss, s => Math.abs(s.difference || 0))); const den = R(U.sum(ss, s => s.expected_cash)); return { value: den ? R(num / den * 100, 3) : 0, numerator: num, denominator: den }; };
  G.kpiCalc['KPI-CAJ-02'] = p => { const bs = D.where('settlement_batches', b => b.kind === 'SETTLEMENT' && b.status !== 'OPEN' && inP(b.deposit_date, p) && (!p.brand || true)); const num = R(U.sum(bs, b => b.fee_amount + b.fee_igv)); const den = R(U.sum(bs, b => b.gross_amount)); return { value: den ? R(num / den * 100, 2) : 0, numerator: num, denominator: den }; };
  G.kpiCalc['KPI-CAJ-03'] = p => { const ref = p.to || G.TODAY; const ps = D.where('payments', x => x.status === 'CONFIRMED' && DIGITAL.includes(x.payment_method_id) && x.reconciliation_status === 'PENDING' && day(x.paid_at) <= ref && (!p.brand || x.brand_id === p.brand) && (!p.site || x.establishment_id === p.site) && G.date.diff(ref, day(x.paid_at)) - ((acc(x.cash_account_id) || {}).settlement_days || 0) > alertDays()); return { value: R(U.sum(ps, x => x.amount)), numerator: ps.length, denominator: null }; };
  G.kpiCalc['KPI-CAJ-04'] = p => { const rs = receivables().filter(x => (!p.brand || x.doc.brand_id === p.brand) && (!p.site || x.doc.establishment_id === p.site)); const tot = R(U.sum(rs, x => x.rec)); const ov = R(U.sum(rs.filter(x => x.overdue > 0), x => x.rec)); return { value: tot ? R(ov / tot * 100, 2) : 0, numerator: ov, denominator: tot }; };
  G.kpiCalc['KPI-CAJ-05'] = () => { let s = 0, n = 0; for (const v of balances().values()) if (v > 0.004) { s += v; n++; } return { value: R(s), numerator: n, denominator: null }; };
  G.kpiCalc['KPI-CAJ-06'] = p => { const ix = index(); const os = D.where('sales_orders', o => isCOD(o) && ['DELIVERED', 'CLOSED'].includes(o.status) && o.delivered_at && inP(o.delivered_at, p) && (!p.brand || o.brand_id === p.brand) && (!p.site || o.establishment_id === p.site)); const miss = os.filter(o => orderPaid(o.id, ix) < orderTotal(o) - 0.01); return { value: os.length ? R(miss.length / os.length * 100, 2) : 0, numerator: miss.length, denominator: os.length }; };

  /* =====================================================================
     Datos de ejemplo (orden 31)
     ===================================================================== */
  G.seed(31, function seedCAJ() {
    const ins = (t, r) => D.insert(t, r, { silent: true });
    const r = U.rng(3131);
    if (!D.get('payment_methods', 'pm-BALANCE')) ins('payment_methods', { id: 'pm-BALANCE', code: 'BALANCE', name: 'Saldo a favor', kind: 'INTERNAL', requires_reference: false, allowed_on_delivery: false, status: 'INTERNAL' });
    const maxCB = Math.max(0, ...D.all('payments').map(p => Number(String(p.number).replace(/\D/g, '')) || 0));
    if ((D.seq['DG:CB'] || 0) < maxCB) D.seq['DG:CB'] = maxCB;
    // cuentas: saldo inicial (01/09) y datos de pago oficiales
    const emp = role => (D.find('users', u => u.role === role) || {}).employee_id || null;
    const A = { 'ca-CAJA-L1': { opening_balance: 200, holder_employee_id: emp('CAJERO') }, 'ca-CCH-L1': { opening_balance: 0, holder_employee_id: emp('ADMINISTRACION') }, 'ca-CCH-L2': { opening_balance: 200, holder_employee_id: (D.find('users', u => u.role === 'ALMACENERO' && (u.sites || []).includes('es-L2')) || {}).employee_id }, 'ca-BCP-CTE': { opening_balance: 25000, cci: '002-193-002284719055-14' }, 'ca-IBK-CTE': { opening_balance: 8000, cci: '003-200-003001847722-41' }, 'ca-YAPE': { opening_balance: 0, qr_payload: '0002010102113932f1a7c4e6b8d0yape987650001AGROPECUARIA DON GUANDO SAC6304A1B2', holder_name: 'AGROPECUARIA DON GUANDO SAC' }, 'ca-PLIN': { opening_balance: 0, qr_payload: '000201010211plin987650002AGROPECUARIA DON GUANDO SAC6304C3D4', holder_name: 'AGROPECUARIA DON GUANDO SAC' }, 'ca-MP': { opening_balance: 0, payment_link_base: 'https://link.mercadopago.com.pe/donguando' }, 'ca-POS-VISA': { opening_balance: 0 } };
    for (const a of D.all('cash_accounts')) Object.assign(a, { brand_id: null, opening_balance: 0 }, A[a.id] || {});
    // pedidos: el pagado se deriva de los cobros (RN-CAJ-09)
    let ix = index();
    for (const o of D.all('sales_orders')) { const xs = ix.byOrder.get(o.id) || []; o.paid_amount = R(U.sum(xs, x => x.a.amount)); o.payment_ids = [...new Set(xs.map(x => x.p.id))]; }
    const pays = D.all('payments').filter(p => p.status === 'CONFIRMED');
    for (const p of pays) { p.to_balance = 0; if (p.payment_method_id === 'pm-CARD') { p.card_brand = r() < 0.7 ? 'VISA' : 'MASTERCARD'; p.card_last4 = String(1000 + Math.floor(r() * 8999)); } if (p.payment_method_id === 'pm-MP') p.gateway_transaction_id = p.reference; if (DIGITAL.includes(p.payment_method_id)) { p.reconciliation_status = 'PENDING'; p.settlement_batch_id = null; } }
    const bucket = new Map(); const addB = (k, p) => push(bucket, k, p);
    const mkBatch = (src, bank, date, ref, ps, opts = {}) => {
      const a = acc(src); const gross0 = R(U.sum(ps, p => p.amount)); const gross = R(gross0 - (opts.minus || 0));
      const fee = SETTLE_KINDS.includes(a.account_type) ? R(U.sum(ps, p => p.amount * a.fee_pct / 100)) : 0; const igv = R(fee * 0.18);
      const b = ins('settlement_batches', { source_account_id: src, bank_account_id: bank, deposit_date: date, reference: ref, gross_amount: gross, fee_amount: fee, fee_igv: igv, net_amount: R(gross - fee - igv), status: 'OPEN', kind: SETTLE_KINDS.includes(a.account_type) ? 'SETTLEMENT' : 'STATEMENT', imported: true, created_by: 'Carmen Huamán Soto' });
      for (const p of ps) { ins('settlement_batch_items', { batch_id: b.id, payment_id: p.id, gross_amount: p.amount, fee_amount: R(p.amount * (a.fee_pct || 0) / 100) }); p.settlement_batch_id = b.id; }
      if (opts.open) return b;
      const when = date + 'T16:30:00'; const ok = !opts.minus;
      Object.assign(b, { status: ok ? 'MATCHED' : 'WITH_DIFFERENCE', difference_reason: opts.reason || null, closed_at: when, closed_by: 'Carmen Huamán Soto' });
      for (const p of ps) { p.reconciliation_status = ok ? 'MATCHED' : 'DIFFERENCE'; p.matched_at = when; }
      if (b.kind === 'SETTLEMENT') ins('cash_transfers', { from_account_id: src, to_account_id: bank, amount: b.net_amount, transferred_at: date + 'T12:00:00', reference: ref, reason: `Abono ${a.name} (neto de comisión)`, status: 'CONFIRMED', batch_id: b.id });
      return b;
    };
    // Mercado Pago: retiro semanal (domingo) de lo liberado a 14 días; hoy, liquidación abierta por cerrar
    const mp = pays.filter(p => p.payment_method_id === 'pm-MP').sort(U.by('paid_at'));
    for (const dep of ['2026-09-20', '2026-09-27', '2026-10-04', G.TODAY]) { const lim = G.date.add(dep, -14); const ps = mp.filter(p => !p.settlement_batch_id && day(p.paid_at) <= lim); if (ps.length) mkBatch('ca-MP', 'ca-BCP-CTE', dep, `LIQ-MP-${dep.replace(/-/g, '')}`, ps, { open: dep === G.TODAY }); }
    // POS Visa: abono diario a 2 días; uno con contracargo descontado
    const pos = U.groupBy(pays.filter(p => p.payment_method_id === 'pm-CARD'), p => day(p.paid_at));
    for (const [d0, ps] of Object.entries(pos).sort()) { const dep = G.date.add(d0, 2); if (dep >= G.TODAY) continue; const cb = d0 === '2026-10-03' && ps.length ? { minus: ps[0].amount, reason: `Contracargo de ${money(ps[0].amount)} por desconocimiento del tarjetahabiente (${ps[0].number}); en disputa con el adquirente.` } : {}; mkBatch('ca-POS-VISA', 'ca-BCP-CTE', dep, `LIQ-POS-${dep.replace(/-/g, '')}`, ps, cb); }
    // Yape, Plin y transferencias: conciliación diaria contra el estado de cuenta hasta el 07/10 (3 capturas de Yape sin abono)
    const stmt = { 'pm-YAPE': ['ca-YAPE', 'ca-BCP-CTE'], 'pm-PLIN': ['ca-PLIN', 'ca-IBK-CTE'], 'pm-TRANSFER': ['ca-BCP-CTE', 'ca-BCP-CTE'] };
    const missingYape = new Set(pays.filter(p => p.payment_method_id === 'pm-YAPE' && ['2026-10-05', '2026-10-06'].includes(day(p.paid_at))).slice(0, 3).map(p => p.id));
    for (const [pm, [src, bank]] of Object.entries(stmt)) { const g = U.groupBy(pays.filter(p => p.payment_method_id === pm && day(p.paid_at) <= '2026-10-07' && !missingYape.has(p.id)), p => day(p.paid_at)); for (const [d0, ps] of Object.entries(g).sort()) mkBatch(src, bank, G.date.add(d0, 1), `EECC-${acc(src).code}-${d0.replace(/-/g, '')}`, ps); }
    // barridos semanales de las billeteras al banco (domingos)
    for (const sun of ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04']) for (const [w, bank] of [['ca-YAPE', 'ca-BCP-CTE'], ['ca-PLIN', 'ca-IBK-CTE']]) {
      const inflow = R(U.sum(pays.filter(p => p.cash_account_id === w && day(p.paid_at) <= sun), p => p.amount)); const out = R(U.sum(D.where('cash_transfers', t => t.from_account_id === w), t => t.amount));
      if (inflow - out > 0) ins('cash_transfers', { from_account_id: w, to_account_id: bank, amount: R(inflow - out), transferred_at: sun + 'T20:00:00', reference: `BAR-${w.slice(3)}-${sun.replace(/-/g, '')}`, reason: 'Barrido semanal de la billetera a la cuenta corriente', status: 'CONFIRMED' });
    }
    // liquidaciones de repartidores de días anteriores (Julio Choque no liquidó el 09/10)
    const cajero = D.find('users', u => u.role === 'CAJERO') || {}; const admin = D.find('users', u => u.role === 'ADMINISTRACION') || {};
    let lq = 0;
    for (const u of drivers()) {
      const g = U.groupBy(pays.filter(p => p.cash_account_id === driverAcc(u.id) && day(p.paid_at) < G.TODAY), p => day(p.paid_at));
      const daysL = Object.keys(g).sort();
      for (const d0 of daysL) {
        if (u.name.startsWith('Julio') && d0 === daysL[daysL.length - 1] && d0 >= G.date.add(G.TODAY, -2)) continue;
        const ps = g[d0]; const exp = R(U.sum(ps, p => p.amount)); lq++;
        let diff = 0, reason = null, stt = 'SETTLED';
        if (d0 === '2026-10-06' && u.name.startsWith('Pedro')) { diff = -5; reason = 'Vuelto entregado de más a un cliente de Surco A; el repartidor lo repone en la próxima liquidación.'; stt = 'APPROVED'; }
        if (d0 === '2026-10-09' && u.name.startsWith('Hugo')) { diff = 2; reason = 'Cliente no aceptó el vuelto de S/ 2,00.'; stt = 'WITH_DIFFERENCE'; }
        const recv = receivingFor(u.id); const by = recv === 'ca-CCH-L2' ? admin.id : cajero.id; const at = d0 + 'T19:30:00';
        const s = ins('driver_settlements', { number: 'LQ-' + U.pad(lq, 5), driver_employee_id: u.employee_id, driver_user_id: u.id, driver_cash_account_id: driverAcc(u.id), receiving_account_id: recv, settlement_date: d0, route_ref: null, expected_cash: exp, expected_digital: 0, delivered_cash: R(exp + diff), difference: diff, difference_reason: reason, status: stt, received_by: by, settled_at: at, payment_ids: ps.map(p => p.id), approved_by: stt === 'APPROVED' ? 'Carmen Huamán Soto' : null, approved_at: stt === 'APPROVED' ? d0 + 'T20:10:00' : null });
        for (const p of ps) p.driver_settlement_id = s.id;
        ins('cash_transfers', { from_account_id: driverAcc(u.id), to_account_id: recv, amount: R(exp + diff), transferred_at: at, reference: s.number, reason: `Liquidación del repartidor ${u.name}`, status: 'CONFIRMED', settlement_id: s.id });
      }
    }
    D.seq['DG:LQ'] = lq;
    // depósito diario del efectivo al banco (fondo fijo S/ 200 en el mostrador y en la caja chica del Local 2)
    for (const box of ['ca-CAJA-L1', 'ca-CCH-L2']) {
      const ins0 = U.groupBy(pays.filter(p => p.cash_account_id === box && day(p.paid_at) < G.TODAY), p => day(p.paid_at));
      const tins = U.groupBy(D.where('cash_transfers', t => t.to_account_id === box && day(t.transferred_at) < G.TODAY), t => day(t.transferred_at));
      for (const d0 of [...new Set([...Object.keys(ins0), ...Object.keys(tins)])].sort()) { const amt = R(U.sum(ins0[d0] || [], p => p.amount) + U.sum(tins[d0] || [], t => t.amount)); if (amt > 0) ins('cash_transfers', { from_account_id: box, to_account_id: 'ca-BCP-CTE', amount: amt, transferred_at: d0 + 'T20:30:00', reference: `DEP-${box.slice(3)}-${d0.replace(/-/g, '')}`, reason: 'Depósito del efectivo del día', status: 'CONFIRMED' }); }
    }
    ins('cash_transfers', { from_account_id: 'ca-BCP-CTE', to_account_id: 'ca-CCH-L1', amount: 500, transferred_at: '2026-09-01T09:00:00', reference: 'OP71230001', reason: 'Fondo de caja chica Local 1', status: 'CONFIRMED' });
    ins('cash_transfers', { from_account_id: 'ca-BCP-CTE', to_account_id: 'ca-CCH-L1', amount: 350, transferred_at: '2026-10-01T09:00:00', reference: 'OP71230588', reason: 'Reposición de caja chica (rendición de gastos de setiembre)', status: 'CONFIRMED' });
    // saldos a favor: pagos de más de octubre
    const os = D.where('sales_orders', o => ['DELIVERED', 'CLOSED'].includes(o.status) && o.delivery_date >= '2026-10-01' && o.final_total != null && o.paid_amount - o.final_total >= 0.1);
    for (const o of os) { o.balance_mode = 'CUSTOMER_CREDIT'; ins('customer_balance_movements', { customer_id: o.customer_id, movement_type: 'OVERPAYMENT', amount: R(o.paid_amount - o.final_total), order_id: o.id, payment_id: (o.payment_ids || [])[0] || null, document_id: null, reason: `Pagó ${money(o.paid_amount)} por el peso estimado; el peso real dio ${money(o.final_total)}`, at: (o.delivered_at || o.delivery_date + 'T18:00') + '', user: 'Sistema' }); }
    const big = os.slice().sort((a, b) => (b.paid_amount - b.final_total) - (a.paid_amount - a.final_total))[0];
    if (big) ins('customer_balance_movements', { customer_id: big.customer_id, movement_type: 'REFUND', amount: -R(big.paid_amount - big.final_total), reason: 'Cliente pidió la devolución por Yape', refund_account_id: 'ca-YAPE', refund_reference: 'OP88120034', at: G.date.add(G.TODAY, -1) + 'T16:00:00', user: 'Carmen Huamán Soto' });
    // cuentas por cobrar B2B: cobros por transferencia de facturas de setiembre (uno parcial)
    const credit = D.where('sales_documents', d => d.payment_terms === 'CREDIT' && valid(d)).sort(U.by('issue_date'));
    const payDoc = (d, amount, date, ref) => { const p = G.pay.register({ customer_id: d.customer_id, payment_method_id: 'pm-TRANSFER', amount, reference: ref, cash_account_id: 'ca-BCP-CTE', allocations: [{ order_id: d.order_id, document_id: d.id, amount }], brand_id: d.brand_id, establishment_id: d.establishment_id, at: date + 'T11:00:00', silent: true }); p.to_balance = 0; p.received_by = admin.id; return p; };
    if (credit[0]) payDoc(credit[0], credit[0].total, '2026-09-22', 'OP55100231');
    if (credit[1]) payDoc(credit[1], credit[1].total, '2026-10-02', 'OP55100877');
    if (credit[2]) payDoc(credit[2], 300, '2026-10-05', 'OP55101402');
    // Yape duplicado revertido (misma captura enviada dos veces)
    const y = pays.find(p => p.payment_method_id === 'pm-YAPE' && day(p.paid_at) === '2026-10-09');
    if (y) { const dup = ins('payments', { number: 'CB-' + U.pad(++D.seq['DG:CB'], 6), customer_id: y.customer_id, payment_method_id: 'pm-YAPE', cash_account_id: 'ca-YAPE', amount: y.amount, paid_at: day(y.paid_at) + 'T17:05:00', reference: y.reference, status: 'REVERSED', reversal_reason: `Captura de Yape duplicada: la operación ${y.reference} ya estaba en ${y.number}.`, reversed_at: '2026-10-09T17:30:00', reversed_by: 'Carmen Huamán Soto', brand_id: y.brand_id, establishment_id: y.establishment_id, fee_amount: 0, reconciliation_status: 'NOT_APPLICABLE', received_by: y.received_by, allocations: [], to_balance: 0 }); if (!dup) throw new Error('—'); }
    ix = index(); for (const d of credit) d.balance = Math.max(0, receivable(d, ix));
    for (const o of D.all('sales_orders')) { const xs = ix.byOrder.get(o.id) || []; o.paid_amount = R(U.sum(xs, x => x.a.amount)); o.payment_ids = [...new Set(xs.map(x => x.p.id))]; }
  }, 'CAJ');

  /* =====================================================================
     Pruebas de aceptación (CA-CAJ-01 … CA-CAJ-06)
     ===================================================================== */
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba ${code} y no hubo error.`); };
  const near = (a, b, msg) => { if (Math.abs(a - b) > 0.005) throw new Error(`${msg}: ${a} ≠ ${b}`); };
  const creditInvoice = (total, cid = 'cu-B001') => G.docs.issue({ doc_type: 'INVOICE', brand_id: 'br-DG', establishment_id: 'es-L1', customer_id: cid, lines: [{ description: 'Pedido B2B al crédito', qty: 1, uom_code: 'NIU', unit_price: total, total, igv_affectation: '10' }], payment_terms: 'CREDIT', credit_days: 15, accept: true });
  G.tests.push({ module: 'CAJ', name: 'CA-CAJ-01: Yape sin número de operación → RN-CAJ-02; la operación 81234567 dos veces → RN-CAJ-04', fn: async () => {
    const base = { customer_id: 'cu-0005', payment_method_id: 'pm-YAPE', amount: 64.5, cash_account_id: 'ca-YAPE' };
    expectFail(() => register(base), 'RN-CAJ-02');
    const p = register(Object.assign({ reference: '81234567' }, base));
    if (p.reconciliation_status !== 'PENDING') throw new Error('El Yape debía quedar por conciliar');
    expectFail(() => register(Object.assign({ reference: '81234567' }, base, { amount: 30 })), 'RN-CAJ-04');
    reverse(p.id, 'Prueba: captura equivocada');
    const p2 = register(Object.assign({ reference: '81234567' }, base));
    if (!p2) throw new Error('Tras revertir, la operación vuelve a poder registrarse');
  } });
  G.tests.push({ module: 'CAJ', name: 'CA-CAJ-02: cobro de S/ 1 000 a facturas de S/ 600 y S/ 700 → pagada y saldo S/ 300; S/ 100 más → RN-CAJ-05', fn: async () => {
    const f1 = creditInvoice(600), f2 = creditInvoice(700);
    const p = register({ customer_id: 'cu-B001', payment_method_id: 'pm-TRANSFER', amount: 1000, reference: 'OP-TEST-1000', cash_account_id: 'ca-BCP-CTE' });
    apply(p.id, [{ document_id: f1.id, amount: 600 }, { document_id: f2.id, amount: 400 }]);
    near(receivable(D.get('sales_documents', f1.id)), 0, 'Factura 1'); near(receivable(D.get('sales_documents', f2.id)), 300, 'Factura 2');
    near(D.get('sales_documents', f2.id).balance, 300, 'Saldo guardado de la factura 2');
    expectFail(() => apply(p.id, [{ document_id: f2.id, amount: 100 }]), 'RN-CAJ-05');
  } });
  G.tests.push({ module: 'CAJ', name: 'CA-CAJ-03: 6 cobros contra entrega por S/ 512,40 y entrega de S/ 500,00 → «con diferencia» de −S/ 12,40 y no cierra sin motivo', fn: async () => {
    const drv = drivers()[0]; const prevRole = G.ctx.role;
    try {
      G.ctx.role = 'CAJERO';
      const pre = driverExpected(drv.id); if (pre.payments.length || pre.digitalPayments.length) settleDriver({ driver_user_id: drv.id, delivered_cash: pre.cash });
      for (let i = 0; i < 6; i++) register({ customer_id: 'cu-00' + (10 + i), payment_method_id: 'pm-CASH', amount: 85.4, collected_by_user_id: drv.id, cash_account_id: driverAcc(drv.id), on_delivery: true });
      near(driverExpected(drv.id).cash, 512.4, 'Esperado');
      expectFail(() => settleDriver({ driver_user_id: drv.id, delivered_cash: 500 }), 'RN-CAJ-10');
      expectFail(() => settleDriver({ driver_user_id: drv.id, delivered_cash: 500, reason: 'x', received_by_user_id: drv.id }), 'RN-CAJ-11');
      let ev = null; G.events.on('driver.settled', p => { ev = p; });
      const s = settleDriver({ driver_user_id: drv.id, delivered_cash: 500, reason: 'Faltan S/ 12,40: vuelto mal calculado en dos entregas' });
      if (s.status !== 'WITH_DIFFERENCE') throw new Error('Estado ' + s.status); near(s.difference, -12.4, 'Diferencia');
      if (!ev || ev.settlement_id !== s.id) throw new Error('No emitió driver.settled');
      near(driverExpected(drv.id).cash, 0, 'La caja del repartidor quedó liquidada');
    } finally { G.ctx.role = prevRole; }
  } });
  G.tests.push({ module: 'CAJ', name: 'CA-CAJ-04: abono de Mercado Pago de S/ 970,30 neto por S/ 1 000,00 con comisión S/ 25,17 e IGV S/ 4,53 → conciliado y cobros MATCHED', fn: async () => {
    const ps = [400, 350, 250].map((a, i) => register({ customer_id: 'cu-00' + (20 + i), payment_method_id: 'pm-MP', amount: a, reference: 'MP-TEST-' + i, cash_account_id: 'ca-MP' }));
    const b = createBatch({ source_account_id: 'ca-MP', bank_account_id: 'ca-BCP-CTE', deposit_date: G.TODAY, reference: 'LIQ-MP-PRUEBA', gross_amount: 1000, fee_amount: 25.17, fee_igv: 4.53, net_amount: 970.3, payment_ids: ps.map(p => p.id) });
    expectFail(() => createBatch({ source_account_id: 'ca-MP', bank_account_id: 'ca-BCP-CTE', reference: 'LIQ-MP-OTRA', payment_ids: [ps[0].id] }), 'RN-CAJ-13');
    const c = closeBatch(b.id);
    if (c.status !== 'MATCHED') throw new Error('Estado ' + c.status);
    if (!ps.every(p => D.get('payments', p.id).reconciliation_status === 'MATCHED')) throw new Error('Los cobros no pasaron a MATCHED');
    expectFail(() => updatePayment(ps[0].id, { amount: 390 }), 'RN-CAJ-12');
  } });
  G.tests.push({ module: 'CAJ', name: 'CA-CAJ-05: saldo a favor de S/ 7,68; usar S/ 10,00 → RN-CAJ-08', fn: async () => {
    const cid = 'cu-0042';
    D.t.customer_balance_movements = D.ensure('customer_balance_movements').filter(m => m.customer_id !== cid);
    addBalance(cid, 'WEIGHT_DIFFERENCE', 7.68, { reason: 'Diferencia de peso del pedido de prueba' });
    near(balanceOf(cid), 7.68, 'Saldo');
    const o = G.orders.create({ customer_id: cid, brand_id: 'br-DG', channel: 'WHATSAPP', fulfillment: 'PICKUP', establishment_id: 'es-L1', delivery_date: G.TODAY, slot_id: 'ts-L1-1', payment_method_id: 'pm-YAPE', notes: 'Prueba', lines: [{ variant_id: 'va-DG-CAL-1L', qty: 1 }] });
    expectFail(() => useBalance(cid, 10, { order_id: o.id }), 'RN-CAJ-08');
    useBalance(cid, 7.68, { order_id: o.id });
    near(balanceOf(cid), 0, 'Saldo final'); near(D.get('sales_orders', o.id).paid_amount, 7.68, 'Pagado del pedido derivado (RN-CAJ-09)');
  } });
  G.tests.push({ module: 'CAJ', name: 'CA-CAJ-06: factura de S/ 236 con nota de crédito de S/ 36 y cobro de S/ 150 → por cobrar S/ 50', fn: async () => {
    const f = creditInvoice(236, 'cu-B002');
    if (G.fac) G.fac.creditNote({ document_id: f.id, reason_code: '05', reason: 'Descuento por volumen', amount: 36 });
    else G.docs.issue({ doc_type: 'CREDIT_NOTE', brand_id: 'br-DG', establishment_id: 'es-L1', customer_id: 'cu-B002', related_document_id: f.id, note_reason_code: '05', applies_to: 'INVOICE', lines: [{ description: 'Descuento', qty: 1, unit_price: 36, total: 36 }], accept: true });
    register({ customer_id: 'cu-B002', payment_method_id: 'pm-TRANSFER', amount: 150, reference: 'OP-TEST-150', cash_account_id: 'ca-BCP-CTE', allocations: [{ document_id: f.id, amount: 150 }] });
    near(receivable(D.get('sales_documents', f.id)), 50, 'Cuenta por cobrar');
    const row = receivables().find(x => x.doc.id === f.id); if (!row) throw new Error('No aparece en cuentas por cobrar'); near(row.rec, 50, 'Vista de cuentas por cobrar');
    expectFail(() => register({ customer_id: 'cu-B002', payment_method_id: 'pm-TRANSFER', amount: 60, reference: 'OP-TEST-60', cash_account_id: 'ca-BCP-CTE', allocations: [{ document_id: f.id, amount: 60 }] }), 'RN-CAJ-07');
  } });
})();
