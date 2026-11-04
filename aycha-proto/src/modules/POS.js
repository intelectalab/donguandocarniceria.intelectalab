/* =====================================================================
   POS · Mostrador del Local 1 (POS-01 … POS-12)
   Abre el mostrador sin un segundo inventario ni una segunda caja:
   turnos con fondo y arqueo, venta por peso con balanza (digitado,
   balanza conectada o etiqueta EAN-13 prefijo 2), boleta B010 o factura
   de la marca al instante, pagos mixtos (efectivo, POS Visa, Yape, Plin,
   saldo a favor), devoluciones con nota de crédito, retiros de caja y
   pedidos de recojo. Cada venta es un pedido COUNTER de PED que descuenta
   por FEFO de wh-MOS-L1 con G.inv.move sin tocar lo reservado.
   Expone G.pos (TAB, CAJ y FAC pueden leer turnos y ventas).
   ===================================================================== */
(function () {
  const { h, btn, badge, status, page, card, table, kpis, dl, notice, drawer, modal, toast, pills, chart, empty } = G.ui;
  const U = G.util, F = G.fmt, D = G.db;
  const R = (n, d = 2) => U.round(n, d);
  const money = v => F.money(v).replace('S/ ', 'S/ ');
  const kg3 = v => v === null || v === undefined ? '—' : F.num(v, 3) + ' kg';
  const ins = (t, r) => D.insert(t, r, { silent: true });
  const TERM = 'pt-MOS1';
  const DENOMS = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1];
  const METHODS = [['pm-CASH', 'Efectivo'], ['pm-CARD', 'Tarjeta (POS Visa)'], ['pm-YAPE', 'Yape'], ['pm-PLIN', 'Plin']];
  const CARD_BRANDS = [['VISA', 'Visa'], ['MASTERCARD', 'Mastercard'], ['AMEX', 'American Express'], ['DINERS', 'Diners Club']];
  const LINES = [['ALL', 'Todo'], ['CUY', 'Cuy'], ['CONEJO', 'Conejo'], ['AVES', 'Aves'], ['EMBUTIDOS', 'Embutidos'], ['CALDOS', 'Caldos'], ['CORTES', 'Cortes'], ['DESPENSA', 'Despensa'], ['GOURMET', 'Gourmet']];
  const lineGroup = v => ({ CERDO: 'CORTES', RES: 'CORTES', CORDERO: 'CORTES', MANTECA: 'DESPENSA', ABARROTES: 'DESPENSA', CAFE: 'GOURMET', FRUTOS_SECOS: 'GOURMET', MERMELADAS: 'GOURMET', INFUSIONES: 'GOURMET' }[v.line] || v.line);
  const MOVE = { CASH_IN: 'Ingreso de sencillo', CASH_OUT: 'Retiro a caja fuerte', DEPOSIT: 'Depósito al banco', PETTY_EXPENSE: 'Gasto menor' };
  const SRC = { MANUAL: 'Digitado', SCALE: 'Balanza conectada', LABEL: 'Etiqueta de balanza' };
  const isRule = e => e && (e instanceof G.RuleError || /^RN-/.test(String(e.message || '')));
  function act(fn, okMsg, after) { try { const r = fn(); if (okMsg) toast(okMsg, 'ok'); if (after) after(r); else G.refresh(); return r; } catch (e) { if (!isRule(e)) console.error(e); toast(e.message, 'bad'); return null; } }
  const inp = (type, value, onInput, attrs = {}) => { const i = h('input', Object.assign({ class: 'input', type, value: value ?? '' }, attrs)); i.addEventListener('input', () => onInput(type === 'number' ? (i.value === '' ? null : Number(i.value)) : i.value, i)); return i; };
  const sel = (options, value, onChange, attrs = {}) => { const s = h('select', Object.assign({ class: 'input' }, attrs), options.map(([v, l]) => h('option', { value: v ?? '', selected: String(v ?? '') === String(value ?? '') }, l))); s.addEventListener('change', () => onChange(s.value)); return s; };
  const fld = (label, input, help, span) => h('div', { class: 'field' + (span ? ' span2' : '') }, h('label', null, label), input, help ? h('div', { class: 'help' }, help) : null);
  const hm = s => String(s || '').slice(11, 16);

  /* =====================================================================
     Cajas registradoras y turnos (RN-POS-01, 02, 07, 08, 09)
     ===================================================================== */
  const terminal = id => D.get('pos_terminals', id || TERM) || D.find('pos_terminals', t => t.status === 'ACTIVE');
  const openShifts = () => D.where('pos_shifts', s => s.status === 'OPEN');
  function currentShift() {
    const me = G.ctx.userId();
    return D.find('pos_shifts', s => s.status === 'OPEN' && s.cashier_user_id === me) || (['GERENTE', 'SUPERVISORA_VENTAS', 'ADMINISTRACION', 'AUDITOR'].includes(G.ctx.role) ? openShifts()[0] || null : null);
  }
  function openShift({ terminal_id = TERM, user_id, float = 0, counts = null, at } = {}) {
    user_id = user_id || G.ctx.userId();
    if (!G._seeding && !G.can('pos.shift.open')) G.fail('RN-POS-01', `Tu rol (${G.roleName()}) no abre turnos de caja (pos.shift.open).`);
    const t = D.get('pos_terminals', terminal_id); if (!t || t.status !== 'ACTIVE') G.fail('RN-POS-01', 'La caja registradora no existe o está inactiva.');
    const onT = D.find('pos_shifts', s => s.terminal_id === terminal_id && s.status === 'OPEN');
    if (onT) G.fail('RN-POS-01', `La caja «${t.name}» ya tiene un turno abierto por ${onT.cashier_name} desde ${F.datetime(onT.opened_at)}: una caja tiene como máximo un turno abierto.`);
    const onU = D.find('pos_shifts', s => s.cashier_user_id === user_id && s.status === 'OPEN');
    if (onU) G.fail('RN-POS-02', `${G.userName(user_id)} ya tiene un turno abierto en ${(terminal(onU.terminal_id) || {}).name}: ciérralo antes de abrir otro.`);
    if (!(Number(float) >= 0)) G.fail('RN-POS-01', 'El fondo inicial no puede ser negativo.');
    const when = at || G.date.now();
    if (!G._seeding) G.period.assertOpen(when.slice(0, 10));
    return D.insert('pos_shifts', { number: D.next('POSSH', 'TUR-', 5), terminal_id, establishment_id: t.establishment_id, cashier_user_id: user_id, cashier_name: G.userName(user_id), opened_at: when, opening_float: R(float), opening_counts: counts, status: 'OPEN', closed_at: null, expected_cash: null, counted_cash: null, difference: null, difference_reason: null, approved_by: null });
  }
  const shiftPays = sh => D.where('payments', p => p.pos_shift_id === sh.id && p.status === 'CONFIRMED');
  const shiftMoves = sh => D.where('pos_cash_movements', m => m.shift_id === sh.id);
  /** pos_expected_cash: fondo + cobros en efectivo + ingresos − retiros − depósitos − gastos menores (RN-POS-07) */
  function expectedCash(sh) {
    sh = typeof sh === 'string' ? D.get('pos_shifts', sh) : sh;
    const cash = U.sum(shiftPays(sh).filter(p => p.payment_method_id === 'pm-CASH'), p => p.amount);
    const mv = shiftMoves(sh); const s = t => U.sum(mv.filter(m => m.movement_type === t), m => m.amount);
    return { float: sh.opening_float, cash_sales: R(cash), cash_in: R(s('CASH_IN')), cash_out: R(s('CASH_OUT')), deposits: R(s('DEPOSIT')), petty: R(s('PETTY_EXPENSE')), expected: R(sh.opening_float + cash + s('CASH_IN') - s('CASH_OUT') - s('DEPOSIT') - s('PETTY_EXPENSE')) };
  }
  function expectedBy(sh) { const ps = shiftPays(sh); const by = pm => R(U.sum(ps.filter(p => p.payment_method_id === pm), p => p.amount)); return { 'pm-CASH': expectedCash(sh).expected, 'pm-CARD': by('pm-CARD'), 'pm-YAPE': by('pm-YAPE'), 'pm-PLIN': by('pm-PLIN') }; }
  function cashMovement({ shift_id, type, amount, reason, authorized_by, at }) {
    const sh = D.get('pos_shifts', shift_id);
    if (!sh || sh.status !== 'OPEN') G.fail('RN-POS-09', 'Los ingresos y retiros de efectivo se registran en un turno abierto.');
    if (!MOVE[type]) G.fail('RN-POS-09', 'Tipo de movimiento no válido.');
    amount = Number(amount);
    if (!(amount > 0)) G.fail('RN-POS-09', 'El monto debe ser mayor que cero.');
    if (!reason || !String(reason).trim()) G.fail('RN-POS-09', 'Escribe el motivo del movimiento.');
    const out = type !== 'CASH_IN';
    if (out && amount > expectedCash(sh).expected + 0.005) G.fail('RN-POS-09', `En caja deberían quedar ${money(expectedCash(sh).expected)}: no se puede sacar ${money(amount)}.`);
    const lim = G.param('pos_cash_out_approval_above') ?? 100;
    let auth = null;
    if (out && amount > lim && !G._seeding) {
      if (authorized_by) { const u = D.get('users', authorized_by); if (!u || !G.can('pos.cash.withdraw', u.role)) G.fail('RN-POS-09', `${u ? u.name : 'Esa persona'} no puede autorizar retiros (pos.cash.withdraw).`); auth = authorized_by; }
      else if (G.can('pos.cash.withdraw')) auth = G.ctx.userId();
      else G.fail('RN-POS-09', `Los retiros y gastos sobre ${money(lim)} necesitan autorización de la supervisora o administración (pos.cash.withdraw).`);
    }
    return D.insert('pos_cash_movements', { shift_id, movement_type: type, amount: R(amount), reason, authorized_by: auth || authorized_by || null, authorized_by_name: auth || authorized_by ? G.userName(auth || authorized_by) : null, moved_at: at || G.date.now(), user_id: G.ctx.userId(), user_name: G.ctx.userName() });
  }
  function closeShift(shift_id, { counts = {}, cash_denoms = null, reason, at } = {}) {
    const sh = D.get('pos_shifts', shift_id);
    if (!sh) G.fail('RN-POS-07', 'Turno no encontrado.');
    if (sh.status !== 'OPEN') G.fail('RN-POS-01', 'El turno ya está cerrado: un turno cerrado no se reabre.');
    const exp = expectedBy(sh);
    const rows = Object.keys(exp).map(pm => { const c = counts[pm]; if (c === undefined || c === null || c === '' || isNaN(c)) G.fail('RN-POS-07', `Falta contar ${G.pmName(pm)}.`); return { pm, expected: exp[pm], counted: R(Number(c)), difference: R(Number(c) - exp[pm]) }; });
    const any = rows.some(r => Math.abs(r.difference) >= 0.005);
    if (any && !String(reason || '').trim()) G.fail('RN-POS-07', `Hay diferencia en el arqueo (${rows.filter(r => Math.abs(r.difference) >= 0.005).map(r => `${G.pmName(r.pm)} ${r.difference > 0 ? '+' : ''}${money(r.difference)}`).join(', ')}): escribe el motivo para cerrar.`);
    for (const r of rows) D.insert('pos_shift_counts', { shift_id, payment_method_id: r.pm, expected_amount: r.expected, counted_amount: r.counted, difference: r.difference }, { silent: true });
    const cash = rows.find(r => r.pm === 'pm-CASH');
    Object.assign(sh, { status: 'CLOSED', closed_at: at || G.date.now(), closed_by: G.ctx.userId(), expected_cash: cash.expected, counted_cash: cash.counted, difference: cash.difference, total_difference: R(U.sum(rows, r => r.difference)), difference_reason: reason || null, closing_denoms: cash_denoms });
    D.update('pos_shifts', sh.id, { status: 'CLOSED' }, { silent: !!G._seeding });
    const lim = G.param('pos_max_cash_diff_without_approval') ?? 5;
    if (!G._seeding && rows.some(r => Math.abs(r.difference) > lim + 1e-9)) G.notify({ role: 'SUPERVISORA_VENTAS', title: `Arqueo con diferencia · ${sh.number}`, body: `${sh.cashier_name}: ${rows.map(r => `${G.pmName(r.pm)} ${money(r.difference)}`).join(' · ')}. Motivo: ${reason}`, ref: sh.id, tone: 'warn', module: 'POS' });
    G.events.emit('pos.shift.closed', { shift_id: sh.id, difference: sh.difference });
    return sh;
  }
  function approveShift(shift_id, note) {
    const sh = D.get('pos_shifts', shift_id);
    if (!sh || sh.status !== 'CLOSED') G.fail('RN-POS-08', 'Solo se aprueba un turno cerrado.');
    if (!G.can('pos.shift.approve')) G.fail('RN-POS-08', `Tu rol (${G.roleName()}) no aprueba cierres (pos.shift.approve).`);
    if (sh.cashier_user_id === G.ctx.userId()) G.fail('RN-POS-08', 'El cierre lo aprueba una persona distinta del cajero.');
    Object.assign(sh, { status: 'APPROVED', approved_by: G.ctx.userId(), approved_by_name: G.ctx.userName(), approved_at: G.date.now(), approval_note: note || null });
    D.update('pos_shifts', sh.id, { status: 'APPROVED' });
    return sh;
  }

  /* =====================================================================
     Precio de la caja, peso y etiqueta de balanza (RN-POS-04, RN-POS-06)
     ===================================================================== */
  function priceOf(variant_id, term) {
    term = term || terminal();
    const v = G.variant(variant_id); if (!v) return null;
    if (term && term.default_price_list_id) {
      const it = D.where('price_list_items', x => x.list_id === term.default_price_list_id && x.variant_id === variant_id && x.valid_from <= G.TODAY && (!x.valid_to || x.valid_to >= G.TODAY)).sort(U.by('valid_from', -1))[0];
      if (it) return { price: it.price, basis: it.basis, list_id: it.list_id };
    }
    return G.price.of(variant_id, { brand_id: v.brand_id, channel: 'COUNTER' });
  }
  function validateWeight(variant_id, kgv, qty = 1, { override } = {}) {
    const v = G.variant(variant_id);
    const w = Number(kgv);
    if (!(w > 0)) G.fail('RN-POS-04', 'El peso debe ser mayor que 0.');
    const max = G.param('pos_max_manual_weight_kg') ?? 30;
    if (w > max + 1e-9) G.fail('RN-POS-04', `El peso ${F.num(w, 3)} kg supera el máximo digitable por línea (${F.num(max, 0)} kg, pos_max_manual_weight_kg).`);
    if (v.sale_mode === 'UNIT_VARIABLE_WEIGHT' && v.min_weight_kg && v.max_weight_kg) {
      const per = w / (Number(qty) || 1);
      if ((per < v.min_weight_kg - 1e-9 || per > v.max_weight_kg + 1e-9) && !(override && G.can('pos.weight.override'))) G.fail('RN-POS-04', `${v.name}: ${F.num(per, 3)} kg por unidad está fuera del rango aceptado (${F.num(v.min_weight_kg, 3)} a ${F.num(v.max_weight_kg, 3)} kg). Revisa el peso o pide a la supervisora que lo acepte (pos.weight.override).`);
    }
    return R(w, 3);
  }
  /** EAN-13 de balanza: prefijo 2X + PLU (5) + peso en gramos (5) + dígito de control (D-POS-02) */
  function parseOwn(code) {
    const s = String(code || '').trim();
    if (!/^2\d{12}$/.test(s)) return null;
    const sum = s.slice(0, 12).split('').reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
    return { prefix: s.slice(0, 2), plu: s.slice(2, 7), weight_kg: R(Number(s.slice(7, 12)) / 1000, 3), check_ok: (10 - sum % 10) % 10 === Number(s[12]) };
  }
  function parseLabel(code) {
    if (G.cat && typeof G.cat.parseScaleBarcode === 'function') {
      try { const r = G.cat.parseScaleBarcode(String(code).trim()); if (r && (r.plu || r.PLU)) { const own = parseOwn(code) || {}; return { prefix: r.prefix || own.prefix, plu: String(r.plu || r.PLU).padStart(5, '0'), weight_kg: R(r.weight_kg ?? r.weight ?? (r.grams != null ? r.grams / 1000 : own.weight_kg), 3), check_ok: r.valid ?? r.check_ok ?? own.check_ok ?? true }; } } catch (e) { /* respaldo propio */ }
    }
    return parseOwn(code);
  }
  const pluOf = v => v && v.scale_plu ? String(v.scale_plu).padStart(5, '0') : null;
  function scanLabel(code, expectVariant) {
    const p = parseLabel(code);
    if (!p) G.fail('RN-POS-06', `«${code}» no es una etiqueta de balanza (EAN-13 que empieza con 2).`);
    if (!p.check_ok) G.fail('RN-POS-06', `La etiqueta ${code} tiene el dígito de control inválido: vuelve a leerla o digita el peso.`);
    const v = D.find('product_variants', x => pluOf(x) === p.plu && x.status === 'ACTIVE');
    if (expectVariant) { const ev = G.variant(expectVariant); if (pluOf(ev) !== p.plu) G.fail('RN-POS-06', `La etiqueta es del PLU ${p.plu}${v ? ' (' + v.name + ')' : ''} y no de ${ev.name} (PLU ${pluOf(ev) || 'sin PLU'}).`); }
    if (!v) G.fail('RN-POS-06', `El PLU ${p.plu} de la etiqueta no corresponde a ningún producto activo.`);
    if (!v.sellable) G.fail('RN-PED-02', `${v.name} no se vende.`);
    if (!(p.weight_kg > 0)) G.fail('RN-POS-06', 'La etiqueta no trae peso.');
    return { variant_id: v.id, weight_kg: p.weight_kg, plu: p.plu, barcode: String(code).trim() };
  }
  /** lectura estable simulada de la balanza conectada (ScaleProvider falso) */
  let readN = 0;
  function readScale(variant_id, qty = 1) { const v = G.variant(variant_id); const r = U.rng(++readN * 7919 + String(variant_id).length * 31)(); const base = v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? v.nominal_weight_kg * (Number(qty) || 1) : 0.5 + Math.round(r * 6) / 4; return R(base * (0.94 + r * 0.14), 3); }
  /** RN-POS-10 / RN-ALM-09: la venta no toma stock reservado para pedidos */
  function stockCheck(lines, wh) {
    const need = new Map();
    for (const l of lines) need.set(l.variant_id, R((need.get(l.variant_id) || 0) + l.stock_qty, 3));
    for (const [vid, q] of need) {
      const phys = G.inv.qty(vid, wh, { releasedOnly: true }); const av = G.inv.qty(vid, wh, { available: true, releasedOnly: true });
      const v = G.variant(vid); const u = v.sale_mode === 'KG' ? 'kg' : 'u';
      if (q > av + 0.0005) {
        if (q <= phys + 0.0005) G.fail('RN-ALM-09', `${v.name}: hay ${F.num(phys, 3)} ${u} en ${G.whName(wh)} pero ${F.num(phys - av, 3)} están reservados para pedidos de delivery; solo se pueden vender ${F.num(Math.max(0, av), 3)} (RN-POS-10).`);
        G.fail('RN-ALM-03', `${v.name}: stock insuficiente en ${G.whName(wh)} (disponible ${F.num(Math.max(0, av), 3)} ${u}, se piden ${F.num(q, 3)}).`);
      }
    }
  }
  const customerCredit = cid => R(U.sum(D.where('customer_balance_movements', m => m.customer_id === cid), m => m.amount));

  /* =====================================================================
     Venta del mostrador: pedido COUNTER + stock + comprobante + cobros
     ===================================================================== */
  function priceLines(lines, term) {
    return lines.map(l => {
      const v = G.variant(l.variant_id); if (!v || v.status !== 'ACTIVE' || !v.sellable) G.fail('RN-PED-02', 'Solo se venden productos activos del catálogo.');
      const pr = priceOf(v.id, term); if (!pr) G.fail('RN-CAT-05', `${v.name} no tiene precio vigente en la lista de la caja.`);
      const byKg = pr.basis === 'KG';
      const qty = v.sale_mode === 'KG' ? Number(l.weight_kg) : Number(l.qty) || 1;
      if (byKg && !(Number(l.weight_kg) > 0)) G.fail('RN-POS-04', `${v.name} se vende por peso: registra el peso.`);
      const amount = R((byKg ? Number(l.weight_kg) : qty) * pr.price);
      return Object.assign({}, l, { v, price: pr.price, basis: pr.basis, list_id: pr.list_id, qty, amount, brand_id: v.brand_id, stock_qty: v.sale_mode === 'KG' ? Number(l.weight_kg) : qty });
    });
  }
  function cartTotals(lines, term) { try { const ls = priceLines(lines, term); const t = R(U.sum(ls, l => l.amount)); const x = G.tax.split(t, true); return { lines: ls, total: t, base: x.base, igv: x.igv, brands: [...new Set(ls.map(l => l.brand_id))] }; } catch (e) { return { lines: [], total: 0, base: 0, igv: 0, brands: [], error: e.message }; } }
  function validatePayments(payments, total, customer_id) {
    const ps = (payments || []).filter(p => Number(p.amount) > 0);
    for (const p of ps) {
      if (p.pm === 'pm-CARD') { if (!p.reference) G.fail('RN-CAJ-02', 'La tarjeta exige el número de operación del POS.'); if (!/^\d{4}$/.test(String(p.card_last4 || ''))) G.fail('RN-CAJ-02', 'Indica los 4 últimos dígitos de la tarjeta.'); }
      if (['pm-YAPE', 'pm-PLIN'].includes(p.pm) && !p.reference) G.fail('RN-CAJ-02', `${G.pmName(p.pm)} exige el número de operación.`);
      if (p.pm === 'CREDIT_BALANCE') { if (!customer_id || customer_id === 'cu-VARIOS') G.fail('RN-POS-11', 'El saldo a favor se usa con el cliente identificado.'); if (Number(p.amount) > customerCredit(customer_id) + 0.005) G.fail('RN-POS-11', `El cliente tiene ${money(customerCredit(customer_id))} de saldo a favor.`); }
    }
    const sum = R(U.sum(ps, p => p.amount)); const cash = R(U.sum(ps.filter(p => p.pm === 'pm-CASH'), p => p.amount)); const nonCash = R(sum - cash);
    if (nonCash > total + 0.005) G.fail('RN-POS-11', `Los pagos que no son efectivo (${money(nonCash)}) superan el total (${money(total)}): el vuelto solo sale del efectivo.`);
    if (sum < total - 0.005) G.fail('RN-POS-11', `La suma de pagos (${money(sum)}) no alcanza el total (${money(total)}): faltan ${money(total - sum)}.`);
    const change = R(sum - total);
    if (change > cash + 0.005) G.fail('RN-POS-11', 'El vuelto solo sale del efectivo.');
    return { ps, sum, cash, change };
  }
  function checkout({ shift_id, customer_id, doc_type = 'RECEIPT', lines = [], payments = [], oseDown = false, at, seed } = {}) {
    const sh = D.get('pos_shifts', shift_id);
    if (!sh || sh.status !== 'OPEN') G.fail('RN-POS-03', 'La venta del mostrador solo se confirma dentro de un turno abierto: abre el turno en POS-01.');
    if (!seed && !G.can('pos.sale.create')) G.fail('RN-POS-03', `Tu rol (${G.roleName()}) no vende en el mostrador (pos.sale.create).`);
    G.assertMod('POS');
    const term = terminal(sh.terminal_id);
    if (!lines.length) G.fail('RN-POS-11', 'El carrito está vacío.');
    const when = at || G.date.now();
    if (!seed) G.period.assertOpen(when.slice(0, 10));
    const priced = priceLines(lines, term);
    for (const l of priced) if (l.basis === 'KG' && l.weight_source !== 'LABEL') validateWeight(l.variant_id, l.weight_kg, l.qty, { override: l.override });
    stockCheck(priced, term.warehouse_id);
    const cust = D.get('customers', customer_id || 'cu-VARIOS') || D.get('customers', 'cu-VARIOS');
    if (doc_type === 'INVOICE' && !(cust.doc_type === 'RUC' && U.rucOk(cust.doc_number))) G.fail('RN-FAC-01', 'La factura exige un cliente con RUC válido: identifícalo o emite boleta.');
    const groups = U.groupBy(priced, 'brand_id');
    const lim = G.param('fac_receipt_id_required_above') ?? 700;
    if (doc_type === 'RECEIPT' && !cust.doc_number) for (const [b, ls] of Object.entries(groups)) if (U.sum(ls, l => l.amount) > lim) G.fail('RN-PED-01', `La boleta de ${G.brandName(b)} supera ${money(lim)}: exige el documento del cliente (DOCUMENTO_CLIENTE).`);
    const total = R(U.sum(priced, l => l.amount));
    const pv = validatePayments(payments, total, cust.id);
    const ticket = D.next('POSTK', 'TK-', 6);
    const mainPm = (pv.ps.slice().sort((a, b) => b.amount - a.amount)[0] || {}).pm;
    const orders = [], docs = [];
    // un pedido y un comprobante por marca (D-POS-03), cobrados en un solo paso
    for (const [brand_id, ls] of Object.entries(groups)) {
      const o = G.orders.create({ customer_id: cust.id, brand_id, channel: 'COUNTER', fulfillment: 'COUNTER', establishment_id: term.establishment_id, payment_method_id: mainPm && mainPm !== 'CREDIT_BALANCE' ? mainPm : 'pm-CASH', requested_doc_type: doc_type, billing_customer_id: cust.id, seller_id: sh.cashier_user_id, notes: null,
        lines: ls.map(l => ({ variant_id: l.variant_id, qty: l.qty, est_weight_kg: l.basis === 'KG' ? l.weight_kg : null })), extra: { pos_shift_id: sh.id, pos_terminal_id: term.id, pos_ticket: ticket, contact_phone: cust.phone || null } });
      o.lines.forEach((ln, i) => { const l = ls[i]; ln.unit_price = l.price; ln.list_price = l.price; ln.price_list_id = l.list_id; if (l.basis === 'KG') { ln.price_basis = 'KG'; ln.est_weight_kg = l.weight_kg; ln.weighed_kg = R(l.weight_kg, 3); ln.weight_source = l.weight_source || 'MANUAL'; ln.scale_barcode = l.scale_barcode || null; } });
      G.orders.recalc(o);
      if (seed) { o.created_at = when; o.history[0].at = when; o.history[0].user = sh.cashier_name; }
      G.orders.transition(o, 'CONFIRMED', { at: when, user: sh.cashier_name, reason: 'Venta de mostrador ' + ticket });
      for (const ln of o.lines) {
        const v = G.variant(ln.variant_id);
        const mv = G.inv.move({ type: 'SALE', wh: term.warehouse_id, variant: ln.variant_id, qty: v.sale_mode === 'KG' ? ln.weighed_kg : ln.qty, weight: ln.price_basis === 'KG' ? ln.weighed_kg : null, source: { type: 'POS_SALE', id: o.id }, at: when, reason: `Venta mostrador ${ticket}` });
        ln.lot_id = (mv.moves[0] || {}).lot_id || null; ln.unit_cost = mv.unit_cost; ln.cost = mv.total_cost;
      }
      G.orders.transition(o, 'DELIVERED', { at: when, user: sh.cashier_name, reason: 'Entregado en mostrador' });
      const doc = G.docs.fromOrder(o, { date: when.slice(0, 10), accept: !oseDown, silent: !!seed });
      doc.pos_shift_id = sh.id; doc.pos_terminal_id = term.id; doc.pos_ticket = ticket; doc.issued_at = when;
      if (oseDown) { doc.sunat_status = 'PENDING'; doc.send_attempts = 1; doc.last_error = 'OSE sin respuesta (tiempo de espera agotado): queda en la cola de reintentos (RN-FAC-06).'; }
      orders.push(o); docs.push(doc);
    }
    // cobros aplicados por pedido (RN-POS-05: en el turno abierto)
    const left = new Map(orders.map(o => [o.id, o.final_total]));
    const docOf = new Map(docs.map(d => [d.order_id, d.id]));
    const pays = [];
    const order2 = pv.ps.slice().sort((a, b) => (a.pm === 'pm-CASH') - (b.pm === 'pm-CASH'));
    for (const p of order2) {
      let amt = p.pm === 'pm-CASH' ? R(p.amount - pv.change) : R(p.amount); if (amt <= 0.004) continue;
      const allocations = [];
      for (const o of orders) { const l = left.get(o.id); if (l <= 0.004 || amt <= 0.004) continue; const a = R(Math.min(l, amt)); allocations.push({ order_id: o.id, document_id: docOf.get(o.id), amount: a }); left.set(o.id, R(l - a)); amt = R(amt - a); }
      if (!allocations.length) continue;
      const tot = R(U.sum(allocations, a => a.amount));
      if (p.pm === 'CREDIT_BALANCE') {
        D.insert('customer_balance_movements', { customer_id: cust.id, movement_type: 'APPLIED', amount: -tot, order_id: orders[0].id, document_id: docs[0].id, reason: `Saldo a favor aplicado en ${ticket}`, at: when }, { silent: !!seed });
        for (const a of allocations) { const o = orders.find(x => x.id === a.order_id); o.paid_amount = R((o.paid_amount || 0) + a.amount); }
        continue;
      }
      const pay = G.pay.register({ customer_id: cust.id, payment_method_id: p.pm, amount: tot, reference: p.reference || null, cash_account_id: p.pm === 'pm-CASH' ? term.cash_account_id : p.pm === 'pm-CARD' ? term.card_account_id : null, allocations, brand_id: orders[0].brand_id, establishment_id: term.establishment_id, at: when, card_last4: p.card_last4 || null, silent: !!seed });
      Object.assign(pay, { pos_shift_id: sh.id, pos_ticket: ticket, card_brand: p.pm === 'pm-CARD' ? (p.card_brand || 'VISA') : null, received_by: sh.cashier_user_id, cash_given: p.pm === 'pm-CASH' ? R(p.amount) : null, change_given: p.pm === 'pm-CASH' ? pv.change : null });
      pays.push(pay);
    }
    for (const o of orders) { o.cash_given = pv.cash || null; o.change_given = pv.change; G.orders.transition(o, 'CLOSED', { at: when, user: sh.cashier_name, reason: 'Venta de mostrador pagada' }); }
    D.touch();
    return { ticket, orders, docs, payments: pays, total, change: pv.change };
  }

  /* =====================================================================
     Devolución con nota de crédito (RN-POS-13, D-POS-04)
     ===================================================================== */
  function refund({ document_id, lines = [], mode = 'SAME', reason, shift_id, at, seed } = {}) {
    if (!seed && !G.can('pos.sale.refund')) G.fail('RN-POS-13', `Las devoluciones del mostrador las hace la supervisora (pos.sale.refund); tu rol: ${G.roleName()}.`);
    const doc = D.get('sales_documents', document_id);
    if (!doc || !['RECEIPT', 'INVOICE'].includes(doc.doc_type) || !doc.pos_shift_id) G.fail('RN-POS-13', 'Elige una boleta o factura del mostrador.');
    if (doc.issue_date !== G.TODAY) G.fail('RN-POS-13', 'En el mostrador solo se devuelven comprobantes del día; otros reclamos van por FAC.');
    if (!reason || !String(reason).trim()) G.fail('RN-POS-13', 'Escribe el motivo de la devolución.');
    const sel = lines.filter(x => Number(x.qty) > 0 || Number(x.weight_kg) > 0);
    if (!sel.length) G.fail('RN-POS-13', 'Elige al menos una línea y la cantidad o peso devuelto.');
    doc.returned = doc.returned || {};
    const ncLines = sel.map(x => {
      const l = doc.lines[x.index]; if (!l || !l.variant_id) G.fail('RN-POS-13', 'Línea no válida.');
      const v = G.variant(l.variant_id); const byKg = l.uom_code === 'KGM';
      const q = byKg ? Number(x.weight_kg) : Number(x.qty);
      const prev = doc.returned[x.index] || 0;
      if (q > l.qty - prev + 0.0005) G.fail('RN-POS-13', `${v.name}: se vendió ${F.num(l.qty, byKg ? 3 : 0)} ${byKg ? 'kg' : 'u'} y ya se devolvió ${F.num(prev, byKg ? 3 : 0)}; no se puede devolver ${F.num(q, byKg ? 3 : 0)}.`);
      const units = v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? Math.max(1, Number(x.qty) || 1) : null;
      return { idx: x.index, v, l, byKg, q, units, total: R(q * l.unit_price) };
    });
    const amount = R(U.sum(ncLines, x => x.total));
    const sh = shift_id ? D.get('pos_shifts', shift_id) : D.get('pos_shifts', doc.pos_shift_id);
    const o = D.get('sales_orders', doc.order_id);
    const pays = D.where('payments', p => (p.allocations || []).some(a => a.document_id === doc.id || a.order_id === doc.order_id));
    const pm = (pays.slice().sort((a, b) => b.amount - a.amount)[0] || {}).payment_method_id || 'pm-CASH';
    if (mode === 'SAME' && pm === 'pm-CASH' && (!sh || sh.status !== 'OPEN')) G.fail('RN-POS-05', 'Devolver efectivo exige un turno abierto: abre el turno en POS-01.');
    if (mode === 'SAME' && pm === 'pm-CASH' && sh && amount > expectedCash(sh).expected + 0.005) G.fail('RN-POS-05', 'No hay efectivo suficiente en caja para devolver.');
    if (mode === 'CREDIT' && (!doc.customer_id || doc.customer_id === 'cu-VARIOS')) G.fail('RN-POS-13', 'Para dejarlo como saldo a favor identifica al cliente (no «Clientes varios»).');
    const when = at || G.date.now();
    const nc = G.docs.issue({ doc_type: 'CREDIT_NOTE', brand_id: doc.brand_id, establishment_id: doc.establishment_id, customer_id: doc.customer_id, order_id: doc.order_id, related_document_id: doc.id, series: G.series.for('CREDIT_NOTE', doc.brand_id, { appliesTo: doc.doc_type }), note_reason_code: '07', note_reason: reason, date: when.slice(0, 10), accept: true, silent: !!seed,
      lines: ncLines.map(x => ({ variant_id: x.v.id, description: x.l.description, qty: x.q, uom_code: x.l.uom_code, unit_price: x.l.unit_price, igv_affectation: '10', total: x.total, unit_cost: x.l.unit_cost, cost: R(x.q * (x.l.unit_cost || 0)) })) });
    Object.assign(nc, { pos_shift_id: sh ? sh.id : null, refund_mode: mode, refund_method: mode === 'SAME' ? pm : 'CREDIT_BALANCE', refund_status: mode === 'SAME' && pm !== 'pm-CASH' ? 'PENDING' : 'DONE' });
    // el producto vuelve a un lote bloqueado hasta que calidad lo revise
    for (const x of ncLines) {
      const orig = x.l.lot_id ? D.get('lots', x.l.lot_id) : null;
      const lot = D.insert('lots', { product_id: x.v.product_id, variant_id: x.v.id, code: `DEV${when.slice(2, 4)}${when.slice(5, 7)}${when.slice(8, 10)}-${U.pad(D.all('lots').filter(l => l.origin === 'RETURN').length + 1, 3)}`, origin: 'RETURN', supplier_id: null, production_date: orig ? orig.production_date : when.slice(0, 10), expiry_date: orig ? orig.expiry_date : null, qc_status: 'BLOCKED', unit_cost: x.l.unit_cost || x.v.std_cost, block_reason: `Devolución del mostrador (${nc.series}-${U.pad(nc.number, 8)}): revisión de calidad; si no se libera, merma (D-POS-04)`, parent_lot_id: orig ? orig.id : null }, { silent: !!seed });
      G.inv.move({ type: 'RETURN', wh: 'wh-DEV-L1', variant: x.v.id, lot: lot.id, qty: x.v.sale_mode === 'KG' ? x.q : (x.units || x.q), weight: x.byKg ? x.q : null, unitCost: x.l.unit_cost || x.v.std_cost, source: { type: 'CREDIT_NOTE', id: nc.id }, at: when, reason: 'Devolución del mostrador: ' + reason });
      doc.returned[x.idx] = R((doc.returned[x.idx] || 0) + x.q, 3);
    }
    if (mode === 'SAME' && pm === 'pm-CASH') { const m = D.insert('pos_cash_movements', { shift_id: sh.id, movement_type: 'CASH_OUT', amount, reason: `Devolución ${nc.series}-${U.pad(nc.number, 8)}: ${reason}`, authorized_by: G.ctx.userId(), authorized_by_name: G.ctx.userName(), moved_at: when, user_id: G.ctx.userId(), user_name: G.ctx.userName(), refund_document_id: nc.id }, { silent: !!seed }); nc.cash_movement_id = m.id; }
    if (mode === 'SAME' && pm !== 'pm-CASH' && !seed) G.notify({ role: 'ADMINISTRACION', title: `Devolver ${money(amount)} por ${G.pmName(pm)}`, body: `Nota de crédito ${nc.series}-${U.pad(nc.number, 8)} · ${G.custName(doc.customer_id)}`, ref: nc.id, tone: 'warn', module: 'POS' });
    if (mode === 'CREDIT') D.insert('customer_balance_movements', { customer_id: doc.customer_id, movement_type: 'CREDIT_NOTE', amount, order_id: doc.order_id, document_id: nc.id, reason: `Devolución del mostrador: ${reason}`, at: when }, { silent: !!seed });
    if (o) { o.returned_amount = R((o.returned_amount || 0) + amount); }
    D.touch();
    return nc;
  }

  /* =====================================================================
     Pedidos por recoger (POS-12)
     ===================================================================== */
  const pickups = est => D.where('sales_orders', o => o.status === 'READY' && o.fulfillment === 'PICKUP' && (o.pickup_establishment_id || o.establishment_id) === est);
  function collect(o, { shift_id, pm, amount, reference, card_last4, card_brand }) {
    const sh = D.get('pos_shifts', shift_id);
    if (!sh || sh.status !== 'OPEN') G.fail('RN-POS-05', 'Todo cobro del mostrador se registra en un turno abierto.');
    const term = terminal(sh.terminal_id);
    validatePayments([{ pm, amount, reference, card_last4 }], Number(amount), o.customer_id);
    const doc = D.find('sales_documents', d => d.order_id === o.id && d.doc_type !== 'CREDIT_NOTE');
    const p = G.pay.register({ customer_id: o.customer_id, payment_method_id: pm, amount, reference, cash_account_id: pm === 'pm-CASH' ? term.cash_account_id : pm === 'pm-CARD' ? term.card_account_id : null, allocations: [{ order_id: o.id, document_id: doc ? doc.id : null, amount: R(amount) }], brand_id: o.brand_id, establishment_id: term.establishment_id, card_last4 });
    Object.assign(p, { pos_shift_id: sh.id, card_brand: pm === 'pm-CARD' ? card_brand || 'VISA' : null, received_by: G.ctx.userId() });
    D.touch(); return p;
  }
  function deliverPickup(o) {
    if (o.status !== 'READY' || o.fulfillment !== 'PICKUP') G.fail('RN-PED-03', 'Solo se entrega un pedido LISTO para recojo.');
    const bal = G.orders.balance(o);
    if (bal < -0.005 && !['WAIVE'].includes(o.balance_mode)) G.fail('RN-PED-15', `Falta cobrar ${money(-bal)}: cobra el saldo antes de entregar.`);
    G.orders.transition(o, 'DELIVERED', { reason: 'Recogido en ' + G.siteName(o.pickup_establishment_id || o.establishment_id) });
    if (!D.find('sales_documents', d => d.order_id === o.id && d.doc_type !== 'CREDIT_NOTE')) G.docs.fromOrder(o, { accept: true });
    const b2 = G.orders.balance(o);
    if (Math.abs(b2) < 0.005 || o.balance_mode) G.orders.transition(o, 'CLOSED', { reason: 'Recojo pagado' });
    return o;
  }

  G.pos = { terminal, currentShift, openShift, closeShift, approveShift, expectedCash, expectedBy, cashMovement, priceOf, validateWeight, parseLabel, scanLabel, readScale, stockCheck, checkout, refund, collect, deliverPickup, pickups };

  /* =====================================================================
     Ganchos: búsqueda, escáner, alertas e indicadores
     ===================================================================== */
  G.searchProviders.push(q => {
    const s = String(q || '').trim().toUpperCase(); if (s.length < 4) return [];
    return D.where('sales_documents', d => d.pos_shift_id && ((d.full_number || '').includes(s) || (d.pos_ticket || '').includes(s))).slice(0, 5).map(d => ({ label: `${G.docs.label(d)} · ${d.pos_ticket || ''}`, sub: `Mostrador · ${F.date(d.issue_date)} · ${money(d.total)}`, go: () => G.go('POS-05', { doc: d.id }) }));
  });
  G.scanHandlers.push(code => {
    if (/^2\d{12}$/.test(code) && G.screens['POS-02']) return () => { try { addLabel(code); G.go('POS-02'); } catch (e) { toast(e.message, 'bad'); } };
    if (/^TK-\d+$/.test(code)) { const d = D.find('sales_documents', x => x.pos_ticket === code); return d ? () => G.go('POS-05', { doc: d.id }) : null; }
    return null;
  });
  G.alertProviders.push(() => {
    const out = [];
    const pend = D.where('pos_shifts', s => s.status === 'CLOSED'); if (pend.length) out.push({ module: 'POS', title: `${pend.length} cierre(s) de caja por aprobar`, detail: 'Lo aprueba una persona distinta del cajero (RN-POS-08).', tone: 'info', go: () => G.go('POS-08') });
    const old = openShifts().filter(s => s.opened_at.slice(0, 10) < G.TODAY); if (old.length) out.push({ module: 'POS', title: 'Turno de caja abierto desde otro día', detail: old.map(s => s.number).join(', '), tone: 'bad', go: () => G.go('POS-07') });
    const ose = D.where('sales_documents', d => d.pos_shift_id && d.sunat_status === 'PENDING'); if (ose.length) out.push({ module: 'POS', title: `${ose.length} comprobante(s) del mostrador en cola de reintento`, detail: 'El ticket se entregó; el OSE no respondió (RN-POS-12).', tone: 'warn', go: () => G.go('POS-10') });
    return out;
  });
  const inP = (d, p) => d >= (p.from || '0000') && d <= (p.to || '9999');
  const counterOrders = p => D.where('sales_orders', o => o.channel === 'COUNTER' && ['DELIVERED', 'CLOSED'].includes(o.status) && inP((o.delivered_at || o.created_at).slice(0, 10), p) && (!p.brand || o.brand_id === p.brand) && (!p.site || o.establishment_id === p.site));
  G.kpiCalc['KPI-POS-01'] = p => R(U.sum(counterOrders(p), o => o.final_total ?? o.estimated_total));
  G.kpiCalc['KPI-POS-02'] = p => { const os = counterOrders(p); const t = new Set(os.map(o => o.pos_ticket || o.id)).size; return { value: t ? R(U.sum(os, o => o.final_total ?? o.estimated_total) / t) : 0, numerator: R(U.sum(os, o => o.final_total ?? o.estimated_total)), denominator: t }; };
  G.kpiCalc['KPI-POS-03'] = p => R(U.sum(D.where('pos_shifts', s => s.closed_at && inP(s.closed_at.slice(0, 10), p) && (!p.site || s.establishment_id === p.site)), s => Math.abs(s.difference || 0)));
  G.kpiCalc['KPI-POS-04'] = p => { let n = 0, d = 0; for (const o of counterOrders(p)) for (const l of o.lines || []) if (l.price_basis === 'KG') { d++; if (['SCALE', 'LABEL'].includes(l.weight_source)) n++; } return { value: d ? R(n / d * 100, 1) : 0, numerator: n, denominator: d }; };
  G.kpiCalc['KPI-POS-05'] = p => { const ss = D.where('pos_shifts', s => inP(s.opened_at.slice(0, 10), p) && (!p.site || s.establishment_id === p.site)); const hrs = U.sum(ss, s => Math.max(0.25, (Date.parse(s.closed_at || G.date.now()) - Date.parse(s.opened_at)) / 3.6e6)); const ids = new Set(ss.map(s => s.id)); const t = new Set(D.where('sales_orders', o => o.channel === 'COUNTER' && ids.has(o.pos_shift_id)).map(o => o.pos_ticket)).size; return { value: hrs ? R(t / hrs, 1) : 0, numerator: t, denominator: R(hrs, 1) }; };

  /* =====================================================================
     Interfaz
     ===================================================================== */
  const cart = { lines: [], customer_id: null, doc_type: null, line: 'ALL', q: '' };
  let lastSale = null;
  let keyN = 0;
  const cartAdd = l => { if (l.weight_source === undefined && G.variant(l.variant_id).sale_mode === 'UNIT') { const ex = cart.lines.find(x => x.variant_id === l.variant_id && !x.weight_kg); if (ex) { ex.qty += l.qty || 1; return; } } cart.lines.push(Object.assign({ key: ++keyN, qty: 1 }, l)); };
  function addLabel(code) { const r = scanLabel(code); const v = G.variant(r.variant_id); cartAdd({ variant_id: r.variant_id, qty: 1, weight_kg: r.weight_kg, weight_source: 'LABEL', scale_barcode: r.barcode }); toast(`${v.name}: ${kg3(r.weight_kg)} leído de la etiqueta`, 'ok'); }
  function addByCode(code) {
    const c = String(code || '').trim(); if (!c) return;
    if (/^2\d{12}$/.test(c)) return addLabel(c);
    const v = D.find('product_variants', x => x.sellable && x.status === 'ACTIVE' && (x.barcode === c || x.sku.toUpperCase() === c.toUpperCase()));
    if (!v) return toast(`No se reconoce el código ${c}: búscalo por nombre (RN-PED-02, no existe el producto libre).`, 'warn');
    if (v.sale_mode === 'UNIT') { cartAdd({ variant_id: v.id, qty: 1 }); toast(`${v.name} agregado`, 'ok'); } else weightModal(v);
  }
  function shiftBanner(body) {
    const sh = currentShift();
    if (!sh) { body.appendChild(notice([h('b', null, 'RN-POS-03: no hay un turno abierto. '), 'La venta y los cobros del mostrador se registran dentro de un turno. ', G.can('pos.shift.open') ? btn('Abrir turno (POS-01)', () => G.go('POS-01'), { sm: true, kind: 'primary' }) : null], 'warn')); return null; }
    return sh;
  }
  const docShort = d => `${d.series}-${U.pad(d.number, 8)}`;
  const docPays = d => D.where('payments', p => (p.allocations || []).some(a => a.document_id === d.id || a.order_id === d.order_id));

  /** teclado numérico de peso (POS-03) */
  function weightPad(v, onOk, { term } = {}) {
    term = term || terminal();
    const st = { qty: 1, kg: '', source: 'MANUAL', barcode: null, override: false };
    const pr = priceOf(v.id, term);
    const box = h('div', { class: 'stack' });
    const disp = h('input', { class: 'input pos-weight', type: 'text', inputmode: 'decimal', placeholder: '0,000', attrs: { 'aria-label': 'Peso en kg' } });
    const out = h('div', { class: 'small' });
    const msg = h('div', { class: 'small', style: 'color:var(--bad)' });
    const calc = () => { const w = Number(String(disp.value).replace(',', '.')); st.kg = w; msg.textContent = ''; if (w > 0 && pr) { out.textContent = `${F.num(w, 3)} kg × ${money(pr.price)} = ${money(R(w * pr.price))}${v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? ` · ${F.num(w / (st.qty || 1), 3)} kg por unidad` : ''}`; try { validateWeight(v.id, w, st.qty); out.style.color = 'var(--ok)'; } catch (e) { out.style.color = 'var(--bad)'; msg.textContent = e.message; } } else out.textContent = ''; };
    disp.addEventListener('input', () => { st.source = 'MANUAL'; calc(); });
    const key = k => { let s = String(disp.value); if (k === 'C') s = ''; else if (k === '⌫') s = s.slice(0, -1); else if (k === ',') { if (!s.includes('.')) s = (s || '0') + '.'; } else { const [a, b] = s.split('.'); if (b !== undefined && b.length >= 3) return; s += k; } disp.value = s; st.source = 'MANUAL'; calc(); };
    const pad = h('div', { class: 'pos-keypad' }, ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', '⌫'].map(k => h('button', { type: 'button', class: 'btn', on: { click: () => key(k) } }, k)));
    const lbl = h('input', { class: 'input', placeholder: 'Etiqueta EAN-13 (2…)', inputmode: 'numeric' });
    box.append(
      dl([['Producto', `${v.name} · PLU ${pluOf(v) || '—'}`], ['Precio', pr ? `${money(pr.price)}/kg` : 'Sin precio'], v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? ['Rango por unidad', `${F.num(v.min_weight_kg, 3)} a ${F.num(v.max_weight_kg, 3)} kg (RN-POS-04)`] : ['Máximo por línea', `${F.num(G.param('pos_max_manual_weight_kg') ?? 30, 0)} kg`], ['Modo de la caja', { MANUAL: 'Digitado (MANUAL)', CONNECTED: 'Balanza conectada', LABEL: 'Etiqueta de balanza (D-POS-02)' }[term.scale_mode] || term.scale_mode], ['Disponible en la exhibidora', `${F.num(G.inv.qty(v.id, term.warehouse_id, { available: true, releasedOnly: true }), v.sale_mode === 'KG' ? 3 : 0)} ${v.sale_mode === 'KG' ? 'kg' : 'u'}`]]),
      v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? fld('Unidades', inp('number', 1, x => { st.qty = Math.max(1, Math.round(x || 1)); calc(); }, { min: 1, step: 1 })) : null,
      h('div', { class: 'row' }, disp, h('span', null, 'kg')), pad,
      h('div', { class: 'row' }, btn('Leer balanza (peso estable)', () => { disp.value = String(readScale(v.id, st.qty)); calc(); st.source = 'SCALE'; out.textContent += ' · balanza'; }, { sm: true }),
        lbl, btn('Leer etiqueta', () => { try { const r = scanLabel(lbl.value, v.id); disp.value = String(r.weight_kg); calc(); st.source = 'LABEL'; st.barcode = r.barcode; out.textContent += ' · etiqueta'; } catch (e) { msg.textContent = e.message; } }, { sm: true })),
      out, msg,
      G.can('pos.weight.override') ? h('label', { class: 'check' }, (() => { const c = h('input', { type: 'checkbox' }); c.addEventListener('change', () => { st.override = c.checked; }); return c; })(), h('span', null, 'Aceptar fuera del rango de la variante (pos.weight.override)')) : null,
      btn('Agregar al carrito', () => { msg.textContent = ''; try { const w = st.source === 'LABEL' ? R(st.kg, 3) : validateWeight(v.id, st.kg, st.qty, { override: st.override }); onOk({ variant_id: v.id, qty: v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? st.qty : 1, weight_kg: w, weight_source: st.source, scale_barcode: st.barcode, override: st.override }); } catch (e) { msg.textContent = e.message; } }, { kind: 'primary' }));
    return box;
  }
  function weightModal(v) { const m = modal(`Peso · ${v.name}`, bd => weightPad(v, l => { cartAdd(l); toast(`${v.name}: ${kg3(l.weight_kg)}`, 'ok'); m.close(); G.refresh(); }), []); }

  /* ---------- POS-01 Abrir turno ---------- */
  function renderOpen(el) {
    const body = page(el, { code: 'POS-01', title: 'Abrir turno', sub: 'Elige la caja, cuenta el fondo inicial por denominación y abre el turno. Una caja y una cajera tienen como máximo un turno abierto (RN-POS-01, RN-POS-02).' });
    const ts = D.where('pos_terminals', t => t.status === 'ACTIVE');
    const mine = D.find('pos_shifts', s => s.status === 'OPEN' && s.cashier_user_id === G.ctx.userId());
    if (mine) body.appendChild(notice([h('b', null, `Ya tienes el turno ${mine.number} abierto desde ${F.datetime(mine.opened_at)}. `), btn('Ir a la venta', () => G.go('POS-02'), { sm: true, kind: 'primary' }), ' ', btn('Cerrar turno', () => G.go('POS-07'), { sm: true })], 'info'));
    const st = { terminal_id: (ts[0] || {}).id, counts: {} };
    const tot = h('b', { class: 'num', style: 'font-size:1.3rem' }, money(0));
    const msg = h('div', { class: 'small', style: 'color:var(--bad)' });
    const sum = () => R(U.sum(DENOMS, d => d * (st.counts[d] || 0)));
    body.appendChild(h('div', { class: 'grid c2' },
      card('Fondo inicial', h('div', { class: 'stack' },
        fld('Caja registradora', sel(ts.map(t => [t.id, `${t.name} · ${G.siteName(t.establishment_id)}`]), st.terminal_id, v => { st.terminal_id = v; })),
        h('div', { class: 'pos-denoms' }, DENOMS.map(d => h('label', { class: 'pos-denom' }, h('span', { class: 'small' }, d >= 10 ? `Billete ${money(d)}` : `Moneda ${money(d)}`), inp('number', '', x => { st.counts[d] = Math.max(0, Math.floor(x || 0)); tot.textContent = money(sum()); }, { min: 0, step: 1, placeholder: '0' })))),
        h('div', { class: 'row between' }, h('span', null, 'Total del fondo'), tot), msg,
        btn('Abrir turno', () => { msg.textContent = ''; try { const s = openShift({ terminal_id: st.terminal_id, float: sum(), counts: Object.assign({}, st.counts) }); toast(`Turno ${s.number} abierto con ${money(s.opening_float)}`, 'ok'); G.go('POS-02'); } catch (e) { msg.textContent = e.message; } }, { kind: 'primary', disabled: !G.can('pos.shift.open') }),
        !G.can('pos.shift.open') ? h('div', { class: 'muted small' }, `Tu rol (${G.roleName()}) no abre turnos: entra como cajero.`) : null)),
      card('Turnos abiertos y recientes', table({ id: 'pos01', search: false, pageSize: 8, columns: [{ key: 'number', label: 'Turno', mono: true }, { key: 't', label: 'Caja', value: s => (terminal(s.terminal_id) || {}).name }, { key: 'cashier_name', label: 'Cajero' }, { key: 'opened_at', label: 'Apertura', render: s => F.datetime(s.opened_at) }, { key: 'opening_float', label: 'Fondo', align: 'r', render: s => money(s.opening_float) }, { key: 'status', label: 'Estado', render: s => status(s.status) }], rows: D.all('pos_shifts').sort(U.by('opened_at', -1)) }), { flush: true })));
  }

  /* ---------- POS-02 Venta ---------- */
  function renderSale(el) {
    const term = terminal();
    const body = page(el, { code: 'POS-02', title: 'Venta', sub: `${term ? term.name : 'Mostrador'} · ${G.whName(term && term.warehouse_id)} · lector, balanza y accesos rápidos. Vende del mismo stock por lote sin tocar lo reservado para delivery (RN-POS-10).`, actions: [{ label: `Cobrar ${money(cartTotals(cart.lines, term).total)}`, kind: 'primary', onClick: () => G.go('POS-04'), disabled: !cart.lines.length }] });
    const sh = shiftBanner(body);
    if (sh) body.appendChild(h('div', { class: 'row small muted' }, `Turno ${sh.number} · ${sh.cashier_name} · desde ${hm(sh.opened_at)} · efectivo esperado ${money(expectedCash(sh).expected)}`));
    if (cart.doc_type === null) cart.doc_type = G.param('pos_receipt_default_doc') === 'INVOICE' ? 'INVOICE' : 'RECEIPT';
    const grid = h('div', { class: 'grid side-r' }); body.appendChild(grid);
    const left = h('div', { class: 'stack', style: 'min-width:0' }), right = h('div', { class: 'stack', style: 'min-width:0' });
    grid.append(left, right);
    // catálogo de la exhibidora
    const scan = h('input', { class: 'input', placeholder: 'Escanea o escribe: código de barras, etiqueta de balanza (2…) o SKU, y Enter', attrs: { 'aria-label': 'Lector' } });
    scan.addEventListener('keydown', e => { if (e.key === 'Enter') { try { addByCode(scan.value); scan.value = ''; G.refresh(); } catch (ex) { toast(ex.message, 'bad'); } } });
    const tilesBox = h('div');
    const search = inp('search', cart.q, v => { cart.q = v; drawTiles(); }, { placeholder: 'Buscar producto', attrs: { 'aria-label': 'Buscar producto' } });
    function drawTiles() {
      G.ui.clear(tilesBox);
      const s = cart.q.trim().toLowerCase();
      const vs = D.where('product_variants', v => v.sellable && v.status === 'ACTIVE' && (cart.line === 'ALL' || lineGroup(v) === cart.line) && (!s || v.name.toLowerCase().includes(s) || v.sku.toLowerCase().includes(s)));
      const items = vs.map(v => ({ v, av: G.inv.qty(v.id, term.warehouse_id, { available: true, releasedOnly: true }), pr: priceOf(v.id, term) })).filter(x => x.pr).sort((a, b) => (b.av > 0) - (a.av > 0) || a.v.name.localeCompare(b.v.name));
      if (!items.length) { tilesBox.appendChild(empty('Sin productos con ese filtro.')); return; }
      tilesBox.appendChild(h('div', { class: 'pos-tiles' }, items.map(({ v, av, pr }) => h('button', { type: 'button', class: 'pos-tile' + (av <= 0 ? ' off' : ''), disabled: av <= 0, style: `border-top:3px solid ${(D.get('brands', v.brand_id) || {}).primary_color || 'var(--line)'}`, on: { click: () => { if (v.sale_mode === 'UNIT') { cartAdd({ variant_id: v.id, qty: 1 }); G.refresh(); } else weightModal(v); } } },
        h('b', null, v.name), h('span', { class: 'small muted' }, G.brandName(v.brand_id)), h('span', { class: 'num' }, `${money(pr.price)}${pr.basis === 'KG' ? '/kg' : ''}`), h('span', { class: 'small' }, av > 0 ? `${F.num(av, v.sale_mode === 'KG' ? 2 : 0)} ${v.sale_mode === 'KG' ? 'kg' : 'u'} disp.` : 'Sin stock')))));
    }
    left.appendChild(card('Productos de la exhibidora', h('div', { class: 'stack' }, scan, h('div', { class: 'row' }, search), pills(LINES, cart.line, v => { cart.line = v; G.refresh(); }), tilesBox)));
    drawTiles();
    // carrito
    const t = cartTotals(cart.lines, term);
    const cust = D.get('customers', cart.customer_id || 'cu-VARIOS');
    const custRes = h('div', { class: 'row', style: 'gap:6px' });
    const custQ = inp('search', '', v => { G.ui.clear(custRes); const s = String(v || '').replace(/\s/g, ''); if (s.length < 4) return; D.where('customers', c => c.status === 'ACTIVE' && ((c.doc_number || '').includes(s) || (c.phone || '').includes(s) || (c.full_name || '').toLowerCase().includes(s.toLowerCase()))).slice(0, 5).forEach(c => custRes.appendChild(btn(`${c.trade_name || c.full_name} · ${c.doc_number || c.phone || ''}`, () => { cart.customer_id = c.id; if (c.doc_type === 'RUC') cart.doc_type = 'INVOICE'; G.refresh(); }, { sm: true }))); }, { placeholder: 'DNI, RUC o celular (opcional)' });
    right.appendChild(card('Carrito', h('div', { class: 'stack' },
      cart.lines.length ? h('div', { class: 'stack', style: 'gap:6px' }, cart.lines.map(l => { const v = G.variant(l.variant_id); const pl = t.lines.find(x => x.key === l.key) || {}; return h('div', { class: 'pos-cart-line' },
        h('div', { style: 'min-width:0' }, h('b', null, v.name), h('div', { class: 'small muted' }, pl.basis === 'KG' ? `${v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? l.qty + ' u · ' : ''}${kg3(l.weight_kg)} × ${money(pl.price)}/kg · ${SRC[l.weight_source] || 'Digitado'}` : `${l.qty} × ${money(pl.price)}`)),
        h('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, v.sale_mode === 'UNIT' ? inp('number', l.qty, x => { l.qty = Math.max(1, Math.round(x || 1)); }, { min: 1, step: 1, style: 'width:62px', on: { change: () => G.refresh() } }) : null, h('b', { class: 'num' }, money(pl.amount)), btn('×', () => { cart.lines = cart.lines.filter(x => x !== l); G.refresh(); }, { sm: true, kind: 'ghost', title: 'Quitar' }))); })) : empty('Escanea o toca un producto.'),
      t.error ? notice(t.error, 'bad') : null,
      t.brands.length > 1 ? notice(`D-POS-03: el carrito tiene ${t.brands.length} marcas; se emite un comprobante por marca y se cobra en un solo paso.`, 'info') : null,
      h('div', { class: 'divider' }),
      h('div', { class: 'row between' }, h('span', { class: 'small' }, `Cliente: ${cust.trade_name || cust.full_name}${cust.doc_number ? ' · ' + cust.doc_number : ''}`), cart.customer_id ? btn('Quitar', () => { cart.customer_id = null; cart.doc_type = 'RECEIPT'; G.refresh(); }, { sm: true, kind: 'ghost' }) : null), custQ, custRes,
      pills([['RECEIPT', 'Boleta B010'], ['INVOICE', 'Factura de la marca']], cart.doc_type, v => { cart.doc_type = v; G.refresh(); }),
      cart.doc_type === 'INVOICE' && !(cust.doc_type === 'RUC' && U.rucOk(cust.doc_number)) ? notice('RN-FAC-01: la factura exige un cliente con RUC válido.', 'warn') : null,
      dl([['Op. gravada', money(t.base)], ['IGV 18 %', money(t.igv)], ['Total', h('b', { class: 'num', style: 'font-size:1.25rem' }, money(t.total))]]),
      btn(`Cobrar ${money(t.total)}`, () => G.go('POS-04'), { kind: 'primary', disabled: !cart.lines.length || !sh }),
      cart.lines.length ? btn('Vaciar carrito', () => { cart.lines = []; G.refresh(); }, { kind: 'ghost', sm: true }) : null)));
  }

  /* ---------- POS-03 Ingreso de peso ---------- */
  const w3 = { variant: 'va-DG-CON-ENT' };
  function renderWeight(el) {
    const term = terminal();
    const body = page(el, { code: 'POS-03', title: 'Ingreso de peso', sub: 'Teclado numérico con 3 decimales y el rango aceptado de la variante; con balanza conectada toma el peso estable y con etiqueta lo lee del código (RN-POS-04, RN-POS-06).' });
    const vs = D.where('product_variants', v => v.sellable && v.status === 'ACTIVE' && v.sale_mode !== 'UNIT' && priceOf(v.id, term));
    const v = G.variant(w3.variant) || vs[0];
    body.appendChild(h('div', { class: 'grid c2' },
      card('Producto por peso', h('div', { class: 'stack' }, fld('Producto', sel(vs.map(x => [x.id, `${x.name} · PLU ${pluOf(x) || '—'}`]), v.id, x => { w3.variant = x; G.refresh(); })),
        weightPad(v, l => { cartAdd(l); toast(`${v.name}: ${kg3(l.weight_kg)} al carrito`, 'ok'); G.go('POS-02'); }, { term }))),
      card('Etiquetas de balanza (D-POS-02)', h('div', { class: 'stack' },
        notice('EAN-13 que empieza con 2: prefijo (2 dígitos) + PLU (5) + peso en gramos (5) + dígito de control. Se acepta solo con dígito válido y PLU igual al de la variante (RN-POS-06).', 'info'),
        table({ id: 'pos03', search: false, pageSize: 10, columns: [{ key: 'name', label: 'Producto' }, { key: 'plu', label: 'PLU', mono: true, value: x => pluOf(x) }, { key: 'ej', label: 'Etiqueta de ejemplo', mono: true, value: x => sampleLabel(x, 1.25) }], rows: vs.filter(x => pluOf(x)).slice(0, 30), onRow: x => { try { addLabel(sampleLabel(x, 1.25)); G.go('POS-02'); } catch (e) { toast(e.message, 'bad'); } } })), { flush: false })));
  }
  function sampleLabel(v, kgv) { const s = '20' + pluOf(v) + U.pad(Math.round(kgv * 1000), 5); const sum = s.split('').reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0); return s + ((10 - sum % 10) % 10); }

  /* ---------- POS-04 Cobro ---------- */
  function renderPay(el) {
    const term = terminal();
    const body = page(el, { code: 'POS-04', title: 'Cobro', sub: 'Medios mezclados: efectivo con vuelto, tarjeta (operación, marca y 4 dígitos), Yape o Plin (operación) y saldo a favor. La suma debe igualar el total; el vuelto solo sale del efectivo (RN-POS-11).', actions: [{ label: 'Volver a la venta', onClick: () => G.go('POS-02') }] });
    const sh = shiftBanner(body);
    const t = cartTotals(cart.lines, term);
    if (!cart.lines.length) { body.appendChild(notice('El carrito está vacío: agrega productos en POS-02.', 'info')); if (lastSale) body.appendChild(btn('Ver el último comprobante (POS-05)', () => G.go('POS-05'), { kind: 'primary' })); return; }
    const cid = cart.customer_id || 'cu-VARIOS';
    const credit = cart.customer_id ? customerCredit(cid) : 0;
    const p = { cash: '', card: '', card_ref: '', card_last4: '', card_brand: 'VISA', yape: '', yape_ref: '', plin: '', plin_ref: '', credit: '', ose: false };
    const live = h('div', { class: 'stack' });
    const payments = () => [{ pm: 'pm-CARD', amount: Number(p.card) || 0, reference: p.card_ref, card_last4: p.card_last4, card_brand: p.card_brand }, { pm: 'pm-YAPE', amount: Number(p.yape) || 0, reference: p.yape_ref }, { pm: 'pm-PLIN', amount: Number(p.plin) || 0, reference: p.plin_ref }, { pm: 'CREDIT_BALANCE', amount: Number(p.credit) || 0 }, { pm: 'pm-CASH', amount: Number(p.cash) || 0 }];
    function upd() {
      G.ui.clear(live);
      const ps = payments().filter(x => x.amount > 0); const sum = R(U.sum(ps, x => x.amount)); const cash = Number(p.cash) || 0;
      const falta = R(t.total - sum), vuelto = R(sum - t.total);
      let err = null; try { validatePayments(ps, t.total, cid); } catch (e) { err = e.message; }
      live.append(dl([['Total', h('b', { class: 'num' }, money(t.total))], ['Pagado', money(sum)], falta > 0.004 ? ['Falta', h('b', { style: 'color:var(--bad)' }, money(falta))] : ['Vuelto (del efectivo)', h('b', { class: 'num', style: 'font-size:1.2rem' }, money(Math.max(0, vuelto)))], ['Efectivo neto en caja', money(Math.max(0, R(cash - Math.max(0, vuelto))))]]), err && sum > 0 ? notice(err, 'warn') : null);
    }
    const f = (k, type, attrs) => inp(type, p[k], v => { p[k] = v ?? ''; upd(); }, attrs || {});
    const quick = (k) => () => { for (const x of ['cash', 'card', 'yape', 'plin', 'credit']) p[x] = ''; p[k] = t.total; G.ui.clear(form); buildForm(); upd(); };
    const form = h('div', { class: 'stack' });
    function buildForm() {
      form.append(h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Rápido:'), btn('Efectivo exacto', quick('cash'), { sm: true }), btn('Todo con tarjeta', quick('card'), { sm: true }), btn('Todo con Yape', quick('yape'), { sm: true })),
        h('div', { class: 'form-grid' },
          fld('Efectivo recibido', f('cash', 'number', { min: 0, step: 0.1 }), 'Billetes y monedas que entrega el cliente'),
          fld('Tarjeta: monto', f('card', 'number', { min: 0, step: 0.01 })), fld('Tarjeta: número de operación', f('card_ref', 'text', { placeholder: '004512' })),
          fld('Tarjeta: marca', sel(CARD_BRANDS, p.card_brand, v => { p.card_brand = v; })), fld('Tarjeta: 4 últimos dígitos', f('card_last4', 'text', { inputmode: 'numeric', maxlength: 4, placeholder: '4821' })),
          fld('Yape: monto', f('yape', 'number', { min: 0, step: 0.01 })), fld('Yape: número de operación', f('yape_ref', 'text')),
          fld('Plin: monto', f('plin', 'number', { min: 0, step: 0.01 })), fld('Plin: número de operación', f('plin_ref', 'text')),
          credit > 0 ? fld(`Saldo a favor (disponible ${money(credit)})`, f('credit', 'number', { min: 0, max: credit, step: 0.01 })) : null),
        h('label', { class: 'check' }, (() => { const c = h('input', { type: 'checkbox' }); c.addEventListener('change', () => { p.ose = c.checked; }); return c; })(), h('span', null, 'Simular que el OSE no responde (el ticket se entrega igual, RN-POS-12)')));
    }
    buildForm();
    const msg = h('div', { class: 'small', style: 'color:var(--bad)' });
    const cust = D.get('customers', cid);
    body.appendChild(h('div', { class: 'grid side-r' },
      card('Medios de pago', h('div', { class: 'stack' }, form, msg, btn(`Cobrar y emitir ${cart.doc_type === 'INVOICE' ? 'factura' : 'boleta'}`, () => {
        msg.textContent = '';
        try { const r = checkout({ shift_id: sh && sh.id, customer_id: cart.customer_id, doc_type: cart.doc_type, lines: cart.lines, payments: payments(), oseDown: p.ose }); lastSale = { ticket: r.ticket, docs: r.docs.map(d => d.id), change: r.change }; cart.lines = []; cart.customer_id = null; cart.doc_type = null; toast(`Venta ${r.ticket} cobrada: ${r.docs.map(docShort).join(', ')}${r.change ? ' · vuelto ' + money(r.change) : ''}`, 'ok'); G.go('POS-05'); }
        catch (e) { if (!isRule(e)) console.error(e); msg.textContent = e.message; }
      }, { kind: 'primary', disabled: !sh }))),
      h('div', { class: 'stack', style: 'min-width:0' }, card('Resumen', h('div', { class: 'stack' }, dl([['Cliente', `${cust.trade_name || cust.full_name}${cust.doc_number ? ' · ' + cust.doc_number : ''}`], ['Comprobante', cart.doc_type === 'INVOICE' ? 'Factura de la marca' : 'Boleta B010'], ['Productos', `${cart.lines.length} línea(s) · ${t.brands.map(b => G.brandName(b)).join(', ')}`], ['Op. gravada', money(t.base)], ['IGV', money(t.igv)]]), live)))));
    upd();
  }

  /* ---------- ticket térmico de 80 mm ---------- */
  const W = 40;
  const rowTxt = (l, r) => { l = String(l); r = String(r); const n = Math.max(1, W - l.length - r.length); return l.length + r.length >= W ? l + '\n' + ' '.repeat(Math.max(0, W - r.length)) + r : l + ' '.repeat(n) + r; };
  const num2 = v => F.num(v, 2);
  function ticketNode(doc) {
    const b = D.get('brands', doc.brand_id) || {}; const co = D.get('companies', 'co-dg') || {}; const est = D.get('establishments', doc.establishment_id) || {};
    const sh = D.get('pos_shifts', doc.pos_shift_id); const term = sh ? terminal(sh.terminal_id) : null;
    const pays = docPays(doc);
    const title = { RECEIPT: 'BOLETA DE VENTA ELECTRÓNICA', INVOICE: 'FACTURA ELECTRÓNICA', CREDIT_NOTE: 'NOTA DE CRÉDITO ELECTRÓNICA' }[doc.doc_type] || G.docTypeName(doc.doc_type).toUpperCase();
    const lines = [];
    lines.push(co.legal_name || '', `RUC ${co.ruc || ''}`, est.address || '', '-'.repeat(W), title, docShort(doc), `Fecha: ${F.date(doc.issue_date)} ${hm(doc.issued_at || doc.created_at)}   ${term ? term.code : ''}`, `Cajero: ${sh ? sh.cashier_name : G.ctx.userName()}`, `Cliente: ${doc.customer_name || ''}`, doc.customer_doc_number ? `${doc.customer_doc_type} ${doc.customer_doc_number}` : 'Sin documento', '-'.repeat(W));
    for (const l of doc.lines) { lines.push(l.description.slice(0, W)); lines.push(rowTxt(` ${l.uom_code === 'KGM' ? F.num(l.qty, 3) + ' kg' : F.num(l.qty, 0) + ' u'} x ${num2(l.unit_price)}`, num2(l.total))); }
    lines.push('-'.repeat(W), rowTxt('OP. GRAVADA', num2(doc.subtotal)), rowTxt('IGV 18 %', num2(doc.igv)), rowTxt('TOTAL S/', num2(doc.total)));
    if (doc.doc_type !== 'CREDIT_NOTE') for (const p of pays) { const a = (p.allocations.find(x => x.document_id === doc.id || x.order_id === doc.order_id) || {}).amount; lines.push(rowTxt(p.payment_method_id === 'pm-CARD' ? `${(CARD_BRANDS.find(c => c[0] === p.card_brand) || ['', 'Tarjeta'])[1]} ****${p.card_last4 || ''} op.${p.reference || ''}` : `${G.pmName(p.payment_method_id)}${p.reference ? ' op.' + p.reference : ''}`, num2(a))); if (p.payment_method_id === 'pm-CASH' && p.cash_given) { lines.push(rowTxt(' Recibido', num2(p.cash_given)), rowTxt(' Vuelto', num2(p.change_given || 0))); } }
    if (doc.related_document_id) { const rd = D.get('sales_documents', doc.related_document_id); lines.push(`Ref.: ${rd ? docShort(rd) : ''} · ${doc.note_reason || ''}`); }
    lines.push('-'.repeat(W), doc.sunat_status === 'ACCEPTED' ? 'Aceptado por SUNAT (OSE)' : 'Pendiente de envío al OSE (cola de reintentos)', (b.legal_footer || '').slice(0, 160));
    return h('div', { class: 'ticket pos-ticket' }, h('div', { style: `text-align:center;border-bottom:3px solid ${b.primary_color || 'var(--primary)'};padding-bottom:6px;margin-bottom:6px` }, h('b', { style: `color:${b.primary_color || 'var(--primary)'};font-size:16px;letter-spacing:.04em` }, (b.name || '').split(' · ')[0].toUpperCase()), b.website ? h('div', null, b.website) : null), lines.join('\n'), h('div', { style: 'display:flex;justify-content:center;margin-top:8px' }, G.ui.qr(`${co.ruc}|${{ RECEIPT: '03', INVOICE: '01', CREDIT_NOTE: '07' }[doc.doc_type]}|${doc.series}|${doc.number}|${num2(doc.igv)}|${num2(doc.total)}|${doc.issue_date}`, 96)));
  }
  function retry(doc) { doc.send_attempts = (doc.send_attempts || 0) + 1; doc.sunat_status = 'ACCEPTED'; doc.sent_at = G.date.now(); doc.last_error = null; D.update('sales_documents', doc.id, { sunat_status: 'ACCEPTED' }); G.events.emit('document.accepted', { document_id: doc.id }); }
  function docActions(doc) {
    const c = D.get('customers', doc.customer_id) || {};
    return h('div', { class: 'row' },
      btn('Imprimir (80 mm)', () => G.print(), { kind: 'primary' }),
      btn('Enviar por WhatsApp', () => { const ph = c.phone || prompt('Celular del cliente (+51…)'); if (!ph) return; if (!U.phoneOk(ph)) return toast('Celular no válido (+51 y 9 dígitos).', 'warn'); act(() => G.msg.send({ customer_id: doc.customer_id, kind: 'UTILITY', template: 'comprobante_electronico', text: `${G.docs.label(doc)} por ${money(doc.total)}: https://cpe.donguando.pe/${doc.series}-${doc.number}`, ref: doc.id, inServiceWindow: false }), 'Comprobante enviado por WhatsApp', () => { }); }),
      btn('Enviar por correo', () => { const em = c.email || prompt('Correo del cliente'); if (!em) return; if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return toast('Correo no válido.', 'warn'); doc.sent_email_to = em; D.update('sales_documents', doc.id, { sent_email_to: em }); toast(`PDF y XML enviados a ${em}`, 'ok'); }),
      doc.sunat_status === 'PENDING' ? btn('Reintentar envío al OSE', () => act(() => retry(doc), 'Comprobante aceptado por el OSE')) : null);
  }

  /* ---------- POS-05 Comprobante ---------- */
  function renderDoc(el, params) {
    const body = page(el, { code: 'POS-05', title: 'Comprobante', sub: 'Boleta B010 o factura de la marca con su logo; impresión térmica de 80 mm o envío por WhatsApp o correo. Si el OSE no responde, el ticket se entrega igual (RN-POS-12).', actions: [{ label: 'Nueva venta', kind: 'primary', onClick: () => G.go('POS-02') }] });
    let docs = params.doc ? [D.get('sales_documents', params.doc)].filter(Boolean) : lastSale ? lastSale.docs.map(id => D.get('sales_documents', id)).filter(Boolean) : [];
    if (!docs.length) { const d = D.where('sales_documents', x => x.pos_shift_id && x.doc_type !== 'CREDIT_NOTE').sort((a, b) => String(b.issued_at || b.created_at).localeCompare(String(a.issued_at || a.created_at)))[0]; if (d) docs = D.where('sales_documents', x => x.pos_ticket && x.pos_ticket === d.pos_ticket); }
    if (!docs.length) { body.appendChild(empty('Aún no hay ventas del mostrador.')); return; }
    if (lastSale && !params.doc && lastSale.change) body.appendChild(notice([h('b', null, `Vuelto: ${money(lastSale.change)}`), ' · entrégalo antes de cerrar la venta.'], 'ok'));
    if (docs.length > 1) body.appendChild(notice(`D-POS-03: la venta ${docs[0].pos_ticket} se dividió en ${docs.length} comprobantes, uno por marca.`, 'info'));
    for (const d of docs) body.appendChild(card(`${G.docs.label(d)} · ${G.brandName(d.brand_id)}`, h('div', { class: 'grid c2' }, h('div', null, ticketNode(d)), h('div', { class: 'stack' }, dl([['Venta', d.pos_ticket || '—'], ['Estado SUNAT', status(d.sunat_status)], ['Intentos de envío', d.send_attempts || 0], d.last_error ? ['Último error', d.last_error] : null, ['Total', money(d.total)], ['Pedido', (D.get('sales_orders', d.order_id) || {}).number || '—']]), docActions(d)))));
  }

  /* ---------- POS-06 Ingresos y retiros ---------- */
  function renderMoves(el) {
    const body = page(el, { code: 'POS-06', title: 'Ingresos y retiros', sub: 'Retiro a caja fuerte, depósito, gasto menor e ingreso de sencillo; sobre el límite necesitan autorización (RN-POS-09).' });
    const sh = shiftBanner(body);
    const lim = G.param('pos_cash_out_approval_above') ?? 100;
    const shown = sh || D.all('pos_shifts').sort(U.by('opened_at', -1))[0];
    if (shown) { const e = expectedCash(shown); body.appendChild(kpis([{ label: 'Efectivo esperado ahora', value: money(e.expected), tone: 'info', sub: `Turno ${shown.number}` }, { label: 'Ingresos', value: money(e.cash_in) }, { label: 'Retiros y depósitos', value: money(e.cash_out + e.deposits) }, { label: 'Gastos menores', value: money(e.petty) }])); }
    if (sh) {
      const approvers = D.where('users', u => u.status === 'ACTIVE' && G.can('pos.cash.withdraw', u.role) && u.id !== G.ctx.userId());
      body.appendChild(card('Registrar movimiento', G.ui.form({ id: 'pos06', fields: [
        { key: 'type', label: 'Tipo', type: 'select', required: true, options: Object.entries(MOVE) },
        { key: 'amount', label: 'Monto', type: 'money', required: true, min: 0.01 },
        { key: 'reason', label: 'Motivo', type: 'text', required: true, placeholder: 'Retiro parcial a caja fuerte, compra de bolsas…' },
        { key: 'auth', label: `Autoriza (sobre ${money(lim)})`, type: 'select', options: approvers.map(u => [u.id, `${u.name} · ${G.roleName(u.role)}`]), help: G.can('pos.cash.withdraw') ? 'Tu rol puede autorizar: queda a tu nombre si no eliges a otra persona.' : 'Obligatorio para retiros, depósitos y gastos sobre el límite.' },
      ], values: { type: 'CASH_OUT' }, submitLabel: 'Registrar', onSubmit: v => { cashMovement({ shift_id: sh.id, type: v.type, amount: v.amount, reason: v.reason, authorized_by: v.auth || null }); toast('Movimiento registrado', 'ok'); G.refresh(); return true; } })));
    }
    if (shown) body.appendChild(card(`Movimientos del turno ${shown.number}`, table({ id: 'pos06', search: false, columns: [{ key: 'moved_at', label: 'Hora', render: m => hm(m.moved_at) }, { key: 'movement_type', label: 'Tipo', value: m => MOVE[m.movement_type] }, { key: 'reason', label: 'Motivo' }, { key: 'amount', label: 'Monto', align: 'r', render: m => (m.movement_type === 'CASH_IN' ? '+' : '−') + money(m.amount) }, { key: 'authorized_by_name', label: 'Autorizó' }, { key: 'user_name', label: 'Registró' }], rows: shiftMoves(shown).sort(U.by('moved_at', -1)), empty: 'Sin movimientos en el turno.' }), { flush: true }));
  }

  /* ---------- POS-07 Cerrar turno ---------- */
  function renderClose(el) {
    const body = page(el, { code: 'POS-07', title: 'Cerrar turno', sub: 'Arqueo por medio de pago: efectivo contado por denominación, tarjeta según el cierre del POS, Yape y Plin según los avisos. Toda diferencia exige motivo (RN-POS-07).' });
    const sh = shiftBanner(body);
    if (!sh) { const last = D.where('pos_shifts', s => s.status !== 'OPEN').sort(U.by('closed_at', -1))[0]; if (last) body.appendChild(card(`Último cierre · ${last.number}`, dl([['Cajero', last.cashier_name], ['Cerrado', F.datetime(last.closed_at)], ['Efectivo esperado', money(last.expected_cash)], ['Contado', money(last.counted_cash)], ['Diferencia', money(last.difference)], ['Estado', status(last.status)]]))); return; }
    const e = expectedCash(sh); const exp = expectedBy(sh);
    const st = { denoms: {}, card: '', yape: '', plin: '', reason: '' };
    const live = h('div');
    const cashCounted = () => R(U.sum(DENOMS, d => d * (st.denoms[d] || 0)));
    const counts = () => ({ 'pm-CASH': cashCounted(), 'pm-CARD': st.card === '' ? null : Number(st.card), 'pm-YAPE': st.yape === '' ? null : Number(st.yape), 'pm-PLIN': st.plin === '' ? null : Number(st.plin) });
    function upd() {
      G.ui.clear(live); const c = counts();
      live.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Medio', 'Esperado', 'Contado', 'Diferencia'].map((x, i) => h('th', { class: i ? 'r' : '' }, x)))), h('tbody', null, Object.keys(exp).map(pm => { const d = c[pm] == null ? null : R(c[pm] - exp[pm]); return h('tr', null, h('td', null, G.pmName(pm)), h('td', { class: 'r num' }, money(exp[pm])), h('td', { class: 'r num' }, c[pm] == null ? '—' : money(c[pm])), h('td', { class: 'r num', style: d && Math.abs(d) >= 0.005 ? 'color:var(--bad);font-weight:700' : '' }, d == null ? '—' : money(d))); })))));
    }
    const msg = h('div', { class: 'small', style: 'color:var(--bad)' });
    body.appendChild(h('div', { class: 'grid c2' },
      card(`Turno ${sh.number} · ${sh.cashier_name}`, h('div', { class: 'stack' }, dl([['Caja', (terminal(sh.terminal_id) || {}).name], ['Apertura', F.datetime(sh.opened_at)], ['Fondo', money(e.float)], ['+ Cobros en efectivo', money(e.cash_sales)], ['+ Ingresos', money(e.cash_in)], ['− Retiros', money(e.cash_out)], ['− Depósitos', money(e.deposits)], ['− Gastos menores', money(e.petty)], ['= Efectivo esperado (pos_expected_cash)', h('b', null, money(e.expected))]]),
        notice(`Si la diferencia supera ${money(G.param('pos_max_cash_diff_without_approval') ?? 5)} se notifica a la supervisora; el cierre lo aprueba otra persona (RN-POS-08).`, 'info'))),
      card('Arqueo', h('div', { class: 'stack' },
        h('div', { class: 'pos-denoms' }, DENOMS.map(d => h('label', { class: 'pos-denom' }, h('span', { class: 'small' }, money(d)), inp('number', '', x => { st.denoms[d] = Math.max(0, Math.floor(x || 0)); upd(); }, { min: 0, step: 1, placeholder: '0' })))),
        h('div', { class: 'form-grid' }, fld('Tarjeta según el cierre del POS', inp('number', '', x => { st.card = x ?? ''; upd(); }, { step: 0.01 })), fld('Yape según los avisos', inp('number', '', x => { st.yape = x ?? ''; upd(); }, { step: 0.01 })), fld('Plin según los avisos', inp('number', '', x => { st.plin = x ?? ''; upd(); }, { step: 0.01 })),
          fld('Motivo de la diferencia', (() => { const t = h('textarea', { class: 'input', rows: 2 }); t.addEventListener('input', () => { st.reason = t.value; }); return t; })(), 'Obligatorio si hay diferencia', true)),
        live, msg, btn('Cerrar turno', () => { msg.textContent = ''; try { closeShift(sh.id, { counts: counts(), cash_denoms: Object.assign({}, st.denoms), reason: st.reason }); toast(`Turno ${sh.number} cerrado: pasa a aprobación (POS-08)`, 'ok'); G.go('POS-08'); } catch (x) { msg.textContent = x.message; } }, { kind: 'primary', disabled: !G.can('pos.shift.open') })))));
    upd();
  }

  /* ---------- POS-08 Aprobación de cierre ---------- */
  function renderApprove(el) {
    const body = page(el, { code: 'POS-08', title: 'Aprobación de cierre', sub: 'La supervisora revisa el arqueo por medio de pago y el historial del cajero, y aprueba. Quien cerró no aprueba (RN-POS-08).' });
    const rows = D.where('pos_shifts', s => s.status !== 'OPEN').sort((a, b) => (a.status === 'CLOSED' ? 0 : 1) - (b.status === 'CLOSED' ? 0 : 1) || String(b.closed_at).localeCompare(String(a.closed_at)));
    const k3 = G.kpi('KPI-POS-03', { from: G.date.month(G.TODAY), to: G.TODAY }) || {};
    body.appendChild(kpis([{ label: 'Por aprobar', value: F.num(rows.filter(s => s.status === 'CLOSED').length), tone: 'warn' }, { label: 'KPI-POS-03 · diferencias del mes', value: money(k3.value), sub: 'Suma de valores absolutos (meta S/ 0)' }, { label: 'Turnos cerrados del mes', value: F.num(rows.filter(s => (s.closed_at || '').slice(0, 7) === G.TODAY.slice(0, 7)).length) }]));
    if (!G.can('pos.shift.approve')) body.appendChild(notice(`Tu rol (${G.roleName()}) no aprueba cierres (pos.shift.approve).`, 'info'));
    const open = s => drawer(`Cierre ${s.number}`, (bd, close) => {
      const cs = D.where('pos_shift_counts', c => c.shift_id === s.id);
      bd.appendChild(dl([['Cajero', s.cashier_name], ['Caja', (terminal(s.terminal_id) || {}).name], ['Apertura', F.datetime(s.opened_at)], ['Cierre', F.datetime(s.closed_at)], ['Fondo', money(s.opening_float)], ['Motivo de la diferencia', s.difference_reason || '—'], ['Estado', status(s.status)], s.approved_by_name ? ['Aprobó', `${s.approved_by_name} · ${F.datetime(s.approved_at)}`] : null]));
      bd.appendChild(table({ id: 'pos08c', search: false, columns: [{ key: 'pm', label: 'Medio', value: c => G.pmName(c.payment_method_id) }, { key: 'expected_amount', label: 'Esperado', align: 'r', render: c => money(c.expected_amount) }, { key: 'counted_amount', label: 'Contado', align: 'r', render: c => money(c.counted_amount) }, { key: 'difference', label: 'Diferencia', align: 'r', render: c => h('b', { style: Math.abs(c.difference) >= 0.005 ? 'color:var(--bad)' : '' }, money(c.difference)) }], rows: cs }));
      const hist = D.where('pos_shifts', x => x.cashier_user_id === s.cashier_user_id && x.status !== 'OPEN').sort(U.by('closed_at', -1)).slice(0, 8);
      bd.appendChild(card(`Historial de ${s.cashier_name}`, chart.hbar({ items: hist.map(x => ({ label: `${x.number} · ${F.date(x.closed_at)}`, value: x.difference || 0, tone: Math.abs(x.difference || 0) >= 0.005 ? 'bad' : 'ok' })), format: v => money(v) })));
      if (s.status === 'CLOSED' && G.can('pos.shift.approve')) bd.appendChild(btn('Aprobar cierre', () => act(() => approveShift(s.id), 'Cierre aprobado', () => { close(); G.refresh(); }), { kind: 'primary', disabled: s.cashier_user_id === G.ctx.userId() }));
    }, { code: 'POS-08' });
    body.appendChild(table({ id: 'pos08', columns: [{ key: 'number', label: 'Turno', mono: true }, { key: 'cashier_name', label: 'Cajero' }, { key: 'closed_at', label: 'Cierre', render: s => F.datetime(s.closed_at) }, { key: 'expected_cash', label: 'Efectivo esperado', align: 'r', render: s => money(s.expected_cash) }, { key: 'counted_cash', label: 'Contado', align: 'r', render: s => money(s.counted_cash) }, { key: 'difference', label: 'Diferencia', align: 'r', render: s => h('b', { style: Math.abs(s.difference || 0) >= 0.005 ? 'color:var(--bad)' : 'color:var(--ok)' }, money(s.difference)) }, { key: 'status', label: 'Estado', render: s => status(s.status) }], rows, onRow: open,
      actions: s => s.status === 'CLOSED' && G.can('pos.shift.approve') ? [btn('Aprobar', () => act(() => approveShift(s.id), 'Cierre aprobado'), { sm: true, kind: 'primary', disabled: s.cashier_user_id === G.ctx.userId() })] : [] }));
  }

  /* ---------- POS-09 Devolución ---------- */
  function renderRefund(el, params) {
    const body = page(el, { code: 'POS-09', title: 'Devolución', sub: 'Busca el comprobante del día, elige líneas y peso devuelto, emite la nota de crédito y devuelve por el mismo medio o como saldo a favor. Lo devuelto entra a un lote bloqueado (RN-POS-13, D-POS-04).' });
    if (!G.can('pos.sale.refund')) body.appendChild(notice(`Las devoluciones las hace la supervisora (pos.sale.refund). Tu rol: ${G.roleName()}.`, 'warn'));
    const docs = D.where('sales_documents', d => d.pos_shift_id && ['RECEIPT', 'INVOICE'].includes(d.doc_type) && d.issue_date === G.TODAY).sort((a, b) => String(b.issued_at || '').localeCompare(String(a.issued_at || '')));
    const doc = params.doc ? D.get('sales_documents', params.doc) : null;
    body.appendChild(table({ id: 'pos09d', pageSize: 6, columns: [{ key: 'h', label: 'Hora', value: d => hm(d.issued_at) }, { key: 'full_number', label: 'Comprobante', mono: true, value: d => docShort(d) }, { key: 'customer_name', label: 'Cliente' }, { key: 'brand', label: 'Marca', value: d => G.brandName(d.brand_id) }, { key: 'total', label: 'Total', align: 'r', render: d => money(d.total) }, { key: 'ret', label: 'Devuelto', align: 'r', value: d => R(U.sum(D.where('sales_documents', x => x.related_document_id === d.id), x => x.total)), render: d => { const v = R(U.sum(D.where('sales_documents', x => x.related_document_id === d.id), x => x.total)); return v ? money(v) : '—'; } }], rows: docs, onRow: d => G.go('POS-09', { doc: d.id }), empty: 'Sin comprobantes del mostrador hoy.' }));
    if (doc) {
      const st = { lines: doc.lines.map((l, i) => ({ index: i, qty: 0, weight_kg: 0 })), mode: 'SAME', reason: '' };
      const msg = h('div', { class: 'small', style: 'color:var(--bad)' });
      const tot = h('b', { class: 'num' }, money(0));
      const upd = () => { tot.textContent = money(R(U.sum(st.lines, x => { const l = doc.lines[x.index]; return (l.uom_code === 'KGM' ? x.weight_kg : x.qty) * l.unit_price; }))); };
      body.appendChild(h('div', { class: 'grid c2' },
        card(`Devolver de ${G.docs.label(doc)}`, h('div', { class: 'stack' }, doc.lines.filter(l => l.variant_id).map((l) => { const i = doc.lines.indexOf(l); const v = G.variant(l.variant_id); const ret = (doc.returned || {})[i] || 0; const x = st.lines[i]; return h('div', { class: 'pos-cart-line' }, h('div', { style: 'min-width:0' }, h('b', null, l.description), h('div', { class: 'small muted' }, `Vendido ${l.uom_code === 'KGM' ? kg3(l.qty) : F.num(l.qty, 0) + ' u'} × ${money(l.unit_price)}${ret ? ' · ya devuelto ' + F.num(ret, 3) : ''}`)),
          h('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? inp('number', '', q => { x.qty = q || 0; upd(); }, { min: 0, step: 1, style: 'width:60px', placeholder: 'u' }) : null, l.uom_code === 'KGM' ? inp('number', '', q => { x.weight_kg = q || 0; upd(); }, { min: 0, step: 0.001, style: 'width:90px', placeholder: 'kg' }) : inp('number', '', q => { x.qty = q || 0; upd(); }, { min: 0, step: 1, style: 'width:70px', placeholder: 'u' }))); }),
          h('div', { class: 'row between' }, h('span', null, 'Total de la nota de crédito'), tot))),
        card('Nota de crédito', h('div', { class: 'stack' },
          pills([['SAME', 'Mismo medio de pago'], ['CREDIT', 'Saldo a favor del cliente']], st.mode, v => { st.mode = v; [...el.querySelectorAll('.pos-refund-mode .pill-tabs button')].forEach((b, i) => b.classList.toggle('active', (i === 0) === (v === 'SAME'))); }),
          fld('Motivo', (() => { const t = h('textarea', { class: 'input', rows: 2, placeholder: 'Producto con mal olor, peso equivocado…' }); t.addEventListener('input', () => { st.reason = t.value; }); return t; })()),
          notice('D-POS-04: la carne fresca devuelta no vuelve a la venta; entra a un lote bloqueado en Devoluciones Local 1 y se da de baja como merma salvo que calidad la libere.', 'info'),
          msg, btn('Emitir nota de crédito', () => { msg.textContent = ''; try { const nc = refund({ document_id: doc.id, lines: st.lines, mode: st.mode, reason: st.reason, shift_id: (currentShift() || {}).id }); toast(`Nota de crédito ${docShort(nc)} emitida`, 'ok'); G.go('POS-05', { doc: nc.id }); } catch (e) { msg.textContent = e.message; } }, { kind: 'primary', disabled: !G.can('pos.sale.refund') })), { class: 'pos-refund-mode' })));
    }
    const ncs = D.where('sales_documents', d => d.doc_type === 'CREDIT_NOTE' && d.pos_shift_id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    body.appendChild(card('Notas de crédito del mostrador', table({ id: 'pos09n', search: false, pageSize: 8, columns: [{ key: 'issue_date', label: 'Fecha', render: d => F.date(d.issue_date) }, { key: 'n', label: 'Nota', mono: true, value: d => docShort(d) }, { key: 'r', label: 'Afecta a', mono: true, value: d => { const r = D.get('sales_documents', d.related_document_id); return r ? docShort(r) : '—'; } }, { key: 'note_reason', label: 'Motivo' }, { key: 'refund_method', label: 'Devolución', value: d => d.refund_method === 'CREDIT_BALANCE' ? 'Saldo a favor' : G.pmName(d.refund_method) }, { key: 'total', label: 'Total', align: 'r', render: d => money(d.total) }], rows: ncs, onRow: d => G.go('POS-05', { doc: d.id }), empty: 'Sin devoluciones.' }), { flush: true }));
  }

  /* ---------- POS-10 Ventas del turno ---------- */
  const s10 = { shift: null };
  function renderShiftSales(el) {
    const body = page(el, { code: 'POS-10', title: 'Ventas del turno', sub: 'Tickets del turno con medio de pago, comprobante y estado SUNAT; reimpresión y reintento de envío.' });
    const shifts = D.all('pos_shifts').sort(U.by('opened_at', -1));
    const sh = D.get('pos_shifts', s10.shift) || currentShift() || shifts[0];
    if (!sh) { body.appendChild(empty('Aún no hay turnos.')); return; }
    body.appendChild(h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Turno'), sel(shifts.map(s => [s.id, `${s.number} · ${s.cashier_name} · ${F.date(s.opened_at)} · ${G.ui.statusLabel(s.status)}`]), sh.id, v => { s10.shift = v; G.refresh(); }, { style: 'max-width:420px' })));
    const docs = D.where('sales_documents', d => d.pos_shift_id === sh.id).sort((a, b) => String(b.issued_at || b.created_at).localeCompare(String(a.issued_at || a.created_at)));
    const sales = docs.filter(d => d.doc_type !== 'CREDIT_NOTE');
    const pays = shiftPays(sh);
    const tickets = new Set(sales.map(d => d.pos_ticket)).size;
    const tot = R(U.sum(sales, d => d.total)) - R(U.sum(docs.filter(d => d.doc_type === 'CREDIT_NOTE'), d => d.total));
    body.appendChild(kpis([{ label: 'Ventas netas', value: money(tot) }, { label: 'Tickets', value: F.num(tickets) }, { label: 'Ticket promedio', value: money(tickets ? R(U.sum(sales, d => d.total) / tickets) : 0) }, ...METHODS.map(([pm, n]) => ({ label: n, value: money(R(U.sum(pays.filter(p => p.payment_method_id === pm), p => p.amount))) })), { label: 'Pendientes en el OSE', value: F.num(docs.filter(d => d.sunat_status === 'PENDING').length), tone: docs.some(d => d.sunat_status === 'PENDING') ? 'warn' : 'ok' }]));
    body.appendChild(table({ id: 'pos10', columns: [
      { key: 'h', label: 'Hora', value: d => hm(d.issued_at || d.created_at) }, { key: 'pos_ticket', label: 'Venta', mono: true }, { key: 'n', label: 'Comprobante', mono: true, value: d => `${G.docTypeName(d.doc_type)} ${docShort(d)}` },
      { key: 'customer_name', label: 'Cliente' }, { key: 'b', label: 'Marca', value: d => G.brandName(d.brand_id) },
      { key: 'pm', label: 'Medios', value: d => d.doc_type === 'CREDIT_NOTE' ? 'Devolución' : [...new Set(docPays(d).map(p => G.pmName(p.payment_method_id)))].join(' + ') },
      { key: 'total', label: 'Total', align: 'r', render: d => (d.doc_type === 'CREDIT_NOTE' ? '−' : '') + money(d.total) }, { key: 'sunat_status', label: 'SUNAT', render: d => status(d.sunat_status) },
    ], rows: docs, onRow: d => drawer(`${G.docs.label(d)}`, bd => { bd.append(ticketNode(d), docActions(d)); }, { code: 'POS-10' }), filters: [{ key: 'sunat_status', label: 'SUNAT', options: [['ACCEPTED', 'Aceptado'], ['PENDING', 'Pendiente']] }, { key: 'doc_type', label: 'Tipo', options: [['RECEIPT', 'Boleta'], ['INVOICE', 'Factura'], ['CREDIT_NOTE', 'Nota de crédito']] }] }));
  }

  /* ---------- POS-11 Cajas registradoras ---------- */
  function renderTerminals(el) {
    const canM = G.can('pos.terminal.manage');
    G.ui.crud(el, { code: 'POS-11', title: 'Cajas registradoras', sub: 'Local, almacén del que descuenta, caja de efectivo, cuenta del adquirente del POS de tarjeta, series, modo de balanza y lista de precios por defecto.', table: 'pos_terminals', canCreate: canM, canEdit: canM, createLabel: 'Nueva caja',
      columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Caja' }, { key: 'establishment_id', label: 'Local', value: t => G.siteName(t.establishment_id) }, { key: 'warehouse_id', label: 'Almacén', value: t => G.whName(t.warehouse_id) }, { key: 'cash_account_id', label: 'Efectivo', value: t => (D.get('cash_accounts', t.cash_account_id) || {}).name }, { key: 'card_account_id', label: 'Adquirente', value: t => (D.get('cash_accounts', t.card_account_id) || {}).name || '—' }, { key: 'series', label: 'Series', value: t => `${(D.get('document_series', t.receipt_series_id) || {}).series || '—'} · facturas de la marca` }, { key: 'scale_mode', label: 'Balanza', value: t => ({ MANUAL: 'Digitado', CONNECTED: 'Conectada', LABEL: 'Etiqueta' }[t.scale_mode]) }, { key: 'status', label: 'Estado', render: t => status(t.status) }],
      fields: [{ key: 'code', label: 'Código', type: 'text', required: true }, { key: 'name', label: 'Nombre', type: 'text', required: true },
        { key: 'establishment_id', label: 'Local', type: 'select', required: true, options: D.where('establishments', e => e.has_counter).map(e => [e.id, e.name]) },
        { key: 'warehouse_id', label: 'Almacén del que descuenta', type: 'select', required: true, options: D.where('warehouses', w => w.allows_sale).map(w => [w.id, w.name]) },
        { key: 'cash_account_id', label: 'Caja de efectivo', type: 'select', required: true, options: D.where('cash_accounts', c => c.account_type === 'CASH_REGISTER').map(c => [c.id, c.name]) },
        { key: 'card_account_id', label: 'Cuenta del adquirente (D-POS-01)', type: 'select', options: D.where('cash_accounts', c => c.account_type === 'CARD_ACQUIRER').map(c => [c.id, `${c.name} · comisión ${c.fee_pct} %`]) },
        { key: 'receipt_series_id', label: 'Serie de boletas', type: 'select', required: true, options: D.where('document_series', s => s.doc_type === 'RECEIPT').map(s => [s.id, s.series + (s.note ? ' · ' + s.note : '')]) },
        { key: 'scale_mode', label: 'Modo de balanza', type: 'select', required: true, options: [['MANUAL', 'Digitado con validación'], ['CONNECTED', 'Balanza conectada'], ['LABEL', 'Etiqueta EAN-13 prefijo 2']] },
        { key: 'default_price_list_id', label: 'Lista de precios por defecto', type: 'select', options: D.where('price_lists', p => (p.channels || []).includes('COUNTER')).map(p => [p.id, p.name]) },
        { key: 'status', label: 'Estado', type: 'select', required: true, options: [['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva']] }],
      defaults: () => ({ establishment_id: 'es-L1', warehouse_id: 'wh-MOS-L1', cash_account_id: 'ca-CAJA-L1', card_account_id: 'ca-POS-VISA', receipt_series_id: 'se-B010', scale_mode: 'LABEL', default_price_list_id: 'pl-MOS-L1', status: 'ACTIVE' }),
      beforeSave: (v, r) => { if (D.find('pos_terminals', t => t.code === v.code && (!r || t.id !== r.id))) return { code: 'Ya existe una caja con ese código.' }; if (r && v.status === 'INACTIVE' && D.find('pos_shifts', s => s.terminal_id === r.id && s.status === 'OPEN')) return 'RN-POS-01: la caja tiene un turno abierto; ciérralo antes de desactivarla.'; },
      above: b => canM ? null : notice(`Tu rol (${G.roleName()}) solo consulta (pos.terminal.manage: administración y sistemas).`, 'info'),
      detail: t => h('div', { class: 'stack' }, dl([['Código', t.code], ['Local', G.siteName(t.establishment_id)], ['Almacén', G.whName(t.warehouse_id)], ['Caja de efectivo', (D.get('cash_accounts', t.cash_account_id) || {}).name], ['Adquirente', (D.get('cash_accounts', t.card_account_id) || {}).name || '—'], ['Serie de boletas', (D.get('document_series', t.receipt_series_id) || {}).series], ['Facturas', 'F001–F005 según la marca del producto'], ['Balanza', t.scale_mode], ['Lista de precios', (D.get('price_lists', t.default_price_list_id) || {}).name || 'Lista pública de cada marca'], ['Turno abierto', (D.find('pos_shifts', s => s.terminal_id === t.id && s.status === 'OPEN') || {}).number || 'No']])) });
  }

  /* ---------- POS-12 Pedidos por recoger ---------- */
  function renderPickup(el, params) {
    const term = terminal();
    const body = page(el, { code: 'POS-12', title: 'Pedidos por recoger', sub: `Pedidos LISTO con recojo en ${G.siteName(term.establishment_id)}: busca por número o celular, cobra el saldo y entrega.` });
    const sh = shiftBanner(body);
    const rows = pickups(term.establishment_id);
    const later = D.where('sales_orders', o => o.fulfillment === 'PICKUP' && (o.pickup_establishment_id || o.establishment_id) === term.establishment_id && ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED'].includes(o.status) && o.delivery_date === G.TODAY);
    body.appendChild(kpis([{ label: 'Listos para entregar', value: F.num(rows.length), tone: 'ok' }, { label: 'Con saldo por cobrar', value: F.num(rows.filter(o => G.orders.balance(o) < -0.005).length), tone: 'warn' }, { label: 'En preparación para hoy', value: F.num(later.length) }, { label: 'Entregados hoy', value: F.num(D.where('sales_orders', o => o.fulfillment === 'PICKUP' && (o.delivered_at || '').slice(0, 10) === G.TODAY).length) }]));
    const open = o => drawer(`Recojo ${o.number}`, (bd, close) => {
      const bal = G.orders.balance(o); const c = D.get('customers', o.customer_id) || {};
      bd.appendChild(dl([['Cliente', `${c.full_name || c.trade_name} · ${o.contact_phone || c.phone || '—'}`], ['Marca', G.brandName(o.brand_id)], ['Franja', `${F.date(o.delivery_date)} ${o.slot_from || ''}–${o.slot_to || ''}`], ['Total', money(o.final_total ?? o.estimated_total)], ['Pagado', money(o.paid_amount || 0)], ['Saldo', bal < -0.005 ? h('b', { style: 'color:var(--bad)' }, `Por cobrar ${money(-bal)}`) : bal > 0.005 ? h('b', { style: 'color:var(--ok)' }, `A favor ${money(bal)}`) : 'Pagado']]));
      bd.appendChild(table({ id: 'pos12l', search: false, columns: [{ key: 'p', label: 'Producto', value: l => G.variantName(l.variant_id) }, { key: 'q', label: 'Cant.', align: 'r', render: l => l.price_basis === 'KG' ? kg3(l.weighed_kg ?? l.est_weight_kg) : F.num(l.qty, 0) }, { key: 'a', label: 'Importe', align: 'r', render: l => money(l.final_amount ?? l.est_amount) }], rows: o.lines }));
      if (bal < -0.005) {
        const p = { pm: 'pm-CASH', amount: R(-bal), reference: '', card_last4: '' };
        const msg = h('div', { class: 'small', style: 'color:var(--bad)' });
        bd.appendChild(card('Cobrar el saldo', h('div', { class: 'stack' }, h('div', { class: 'form-grid' }, fld('Medio', sel(METHODS, p.pm, v => { p.pm = v; })), fld('Monto', inp('number', p.amount, v => { p.amount = v; }, { step: 0.01 })), fld('Operación', inp('text', '', v => { p.reference = v; })), fld('Tarjeta: 4 dígitos', inp('text', '', v => { p.card_last4 = v; }, { maxlength: 4 }))), msg,
          btn('Registrar cobro', () => { msg.textContent = ''; try { collect(o, { shift_id: sh && sh.id, pm: p.pm, amount: p.amount, reference: p.reference, card_last4: p.card_last4 }); toast('Cobro registrado en el turno', 'ok'); close(); open(o); G.refresh(); } catch (e) { msg.textContent = e.message; } }, { kind: 'primary', disabled: !sh }))));
      }
      bd.appendChild(h('div', { class: 'row' }, btn('Entregar al cliente', () => act(() => deliverPickup(o), `Pedido ${o.number} entregado`, () => { close(); G.refresh(); }), { kind: 'primary', disabled: bal < -0.005 }), btn('Ver pedido (PED-03)', () => { close(); G.go('PED-03', { id: o.id }); }, { kind: 'ghost' })));
    }, { code: 'POS-12' });
    body.appendChild(table({ id: 'pos12', searchPlaceholder: 'Número de pedido o celular', columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'c', label: 'Cliente', value: o => G.custName(o.customer_id) }, { key: 'contact_phone', label: 'Celular', mono: true }, { key: 'b', label: 'Marca', value: o => G.brandName(o.brand_id) }, { key: 'slot', label: 'Franja', value: o => `${o.slot_from || ''}–${o.slot_to || ''}` }, { key: 't', label: 'Total', align: 'r', value: o => o.final_total ?? o.estimated_total, render: o => money(o.final_total ?? o.estimated_total) }, { key: 'bal', label: 'Saldo', align: 'r', value: o => G.orders.balance(o), render: o => { const b = G.orders.balance(o); return b < -0.005 ? h('b', { style: 'color:var(--bad)' }, 'Cobrar ' + money(-b)) : b > 0.005 ? h('span', { style: 'color:var(--ok)' }, 'A favor ' + money(b)) : badge('Pagado', 'ok'); } }], rows, onRow: open, empty: 'No hay pedidos listos para recoger.' }));
    if (params.id) { const o = D.get('sales_orders', params.id); if (o) setTimeout(() => open(o), 0); }
  }

  /* =====================================================================
     Registro
     ===================================================================== */
  const SN = Object.fromEntries(G.SPEC.POS.screens.map(s => [s[0], s[1]]));
  G.register({ code: 'POS', name: 'Mostrador', phase: 1, group: 'Ventas y canales', screens: [
    { code: 'POS-01', name: SN['POS-01'], render: renderOpen },
    { code: 'POS-02', name: SN['POS-02'], render: renderSale },
    { code: 'POS-03', name: SN['POS-03'], render: renderWeight },
    { code: 'POS-04', name: SN['POS-04'], render: renderPay },
    { code: 'POS-05', name: SN['POS-05'], render: renderDoc },
    { code: 'POS-06', name: SN['POS-06'], render: renderMoves },
    { code: 'POS-07', name: SN['POS-07'], render: renderClose },
    { code: 'POS-08', name: SN['POS-08'], render: renderApprove },
    { code: 'POS-09', name: SN['POS-09'], render: renderRefund },
    { code: 'POS-10', name: SN['POS-10'], render: renderShiftSales },
    { code: 'POS-11', name: SN['POS-11'], render: renderTerminals },
    { code: 'POS-12', name: SN['POS-12'], render: renderPickup },
  ] });

  /* =====================================================================
     Datos de ejemplo (orden 23): caja, lista de vitrina, exhibidora,
     turnos de 3 días con ventas, retiros, una devolución y recojos.
     ===================================================================== */
  G.seed(23, function seedPOS() {
    const r = U.rng(230023);
    // lista de precios de la vitrina (todas las marcas) y conejo entero a S/ 38/kg (CA-POS-02)
    ins('price_lists', { id: 'pl-MOS-L1', code: 'MOS-L1', name: 'Mostrador Local 1 (vitrina, todas las marcas)', brand_id: null, channels: ['COUNTER'], includes_igv: true, status: 'ACTIVE', valid_from: '2026-10-01' });
    const con = G.variant('va-DG-CON-ENT'); if (con) { con.min_weight_kg = 1.2; con.max_weight_kg = 2.5; }
    // chorizo artesanal a granel con PLU 12345 (CA-POS-06)
    if (!G.variant('va-M3-CHO-ART')) {
      ins('products', { id: 'pr-CHOA', brand_id: 'br-M3', category_id: 'pc-EMBUTIDOS', code: 'CHOA', name: 'Chorizo artesanal', line: 'EMBUTIDOS', product_type: 'GOODS', origin: 'PRODUCED', storage: 'CHILLED', shelf_life_days: 21, requires_lot: true, igv_affectation: '10', sanitary_authority: 'DIGESA', sanitary_registry: 'R.S. N4412N-NADGAN', sanitary_registry_expires: '2027-08-01', status: 'ACTIVE', web_publishable: false, allow_discount: true });
      ins('product_variants', { id: 'va-M3-CHO-ART', product_id: 'pr-CHOA', brand_id: 'br-M3', sku: 'M3-CHO-ART', name: 'Chorizo artesanal a granel', barcode: '7750000123450', uom_id: 'um-KGM', sale_mode: 'KG', nominal_weight_kg: null, weight_tolerance_pct: 5, min_weight_kg: null, max_weight_kg: null, scale_plu: '12345', status: 'ACTIVE', web_publishable: false, min_order_qty: 0.25, qty_step: 0.25, std_cost: 17.5, sellable: true, line: 'EMBUTIDOS' });
      ins('price_list_items', { id: 'pll-M3-PUB-M3-CHO-ART', list_id: 'pl-M3-PUB', variant_id: 'va-M3-CHO-ART', price: 36, basis: 'KG', valid_from: '2026-07-01', valid_to: null });
      ins('price_list_items', { id: 'pll-M3-B2B-M3-CHO-ART', list_id: 'pl-M3-B2B', variant_id: 'va-M3-CHO-ART', price: 32.4, basis: 'KG', valid_from: '2026-07-01', valid_to: null });
      const lot = ins('lots', { id: 'lo-CHOA1', product_id: 'pr-CHOA', variant_id: 'va-M3-CHO-ART', code: 'L261008-CA1', origin: 'PRODUCTION', production_date: '2026-10-08', expiry_date: '2026-10-29', qc_status: 'RELEASED', unit_cost: 17.5, released_at: '2026-10-08T16:00', released_by: 'Silvia Ramos Tello' });
      G.inv.move({ type: 'RECEIPT', wh: 'wh-MOS-L1', variant: 'va-M3-CHO-ART', lot: lot.id, qty: 14, weight: 14, unitCost: 17.5, source: { type: 'PRODUCTION', id: 'OP01-0044' }, at: '2026-10-08T17:00', reason: 'Producción para la vitrina' });
    }
    for (const it of D.where('price_list_items', x => /-PUB$/.test(x.list_id) && !x.valid_to)) ins('price_list_items', { id: 'pll-MOS-' + it.variant_id.slice(3), list_id: 'pl-MOS-L1', variant_id: it.variant_id, price: it.variant_id === 'va-DG-CON-ENT' ? 38 : it.price, basis: it.basis, valid_from: '2026-10-01', valid_to: null });
    // caja registradora del Local 1
    ins('pos_terminals', { id: TERM, code: 'MOS-1', name: 'Mostrador 1', establishment_id: 'es-L1', warehouse_id: 'wh-MOS-L1', cash_account_id: 'ca-CAJA-L1', card_account_id: 'ca-POS-VISA', receipt_series_id: 'se-B010', invoice_series_id: null, scale_mode: 'LABEL', default_price_list_id: 'pl-MOS-L1', status: 'ACTIVE' });
    // surtido de la exhibidora (transferencia desde cámara, congeladora y almacén)
    const stock = [['va-DG-CUY-ENT', 10], ['va-DG-CUY-MIT', 4], ['va-DG-CON-ENT', 6], ['va-DG-POL-ENT', 6], ['va-DG-GAL-ENT', 4], ['va-DG-PAT-ENT', 3], ['va-DG-CUY-DES', 4], ['va-DG-CAL-1L', 12], ['va-DG-CAL-500', 18], ['va-DG-CHO-500', 18], ['va-DG-COR-PIE', 5], ['va-M2-BON-KG', 6], ['va-M2-PAN-KG', 5], ['va-M2-LOM-KG', 3], ['va-M3-CHO-500', 8], ['va-M3-HUA-500', 8], ['va-M3-MOR-500', 5], ['va-M4-MAN-500', 6], ['va-M4-CGA-1L', 6], ['va-M5-CAF-250', 6], ['va-M5-MER-AGU', 6], ['va-M5-ALM-250', 5]];
    for (const [vid, q] of stock) {
      const v = G.variant(vid); if (!v) continue;
      const from = (D.where('stock_balances', b => b.variant_id === vid && b.warehouse_id !== 'wh-MOS-L1' && G.db.get('warehouses', b.warehouse_id).establishment_id === 'es-L1' && b.qty - (b.reserved_qty || 0) > 0).sort((a, b) => (b.qty - b.reserved_qty) - (a.qty - a.reserved_qty))[0] || {}).warehouse_id;
      if (!from) continue;
      const avail = G.inv.qty(vid, from, { available: true, releasedOnly: true }); const qq = Math.min(q, Math.floor(avail * 0.6)); if (qq <= 0) continue;
      try { G.inv.transfer({ from, to: 'wh-MOS-L1', variant: vid, qty: qq, weight: v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? R(qq * v.nominal_weight_kg, 3) : v.sale_mode === 'KG' ? qq : null, source: { type: 'TRANSFER', id: 'TR-MOS-' + vid.slice(3) }, at: '2026-10-08T07:00', reason: 'Surtido de la exhibidora del mostrador' }); } catch (e) { /* sin stock suficiente: se omite */ }
    }
    // turnos de 3 días con ventas
    const cashier = D.find('users', u => u.role === 'CAJERO');
    const pv = (G.ctx.role = 'GERENTE');
    const pool = stock.map(s => s[0]).filter(v => G.variant(v));
    const mkSale = (sh, at, n) => {
      const lines = []; const used = new Set();
      for (let k = 0; k < n; k++) {
        const vid = U.pick(r, pool); if (used.has(vid)) continue; used.add(vid); const v = G.variant(vid);
        if (G.inv.qty(vid, 'wh-MOS-L1', { available: true, releasedOnly: true }) < (v.sale_mode === 'KG' ? 1.5 : 1.5)) continue;
        if (v.sale_mode === 'UNIT') lines.push({ variant_id: vid, qty: 1 + (r() < 0.3 ? 1 : 0) });
        else if (v.sale_mode === 'KG') lines.push({ variant_id: vid, qty: 1, weight_kg: R(0.4 + r() * 0.9, 3), weight_source: r() < 0.7 ? 'LABEL' : 'MANUAL' });
        else lines.push({ variant_id: vid, qty: 1, weight_kg: R(v.nominal_weight_kg * (0.92 + r() * 0.16), 3), weight_source: r() < 0.6 ? 'LABEL' : r() < 0.5 ? 'SCALE' : 'MANUAL' });
      }
      if (!lines.length) return null;
      for (const l of lines) if (l.weight_source === 'LABEL') { const v = G.variant(l.variant_id); if (pluOf(v)) l.scale_barcode = sampleLabel(v, l.weight_kg); else l.weight_source = 'MANUAL'; }
      const tot = R(U.sum(priceLines(lines, terminal()), l => l.amount));
      const x = r(); let payments;
      if (x < 0.42) payments = [{ pm: 'pm-CASH', amount: Math.ceil(tot / 10) * 10 }];
      else if (x < 0.66) payments = [{ pm: 'pm-YAPE', amount: tot, reference: String(10000000 + Math.floor(r() * 89999999)) }];
      else if (x < 0.74) payments = [{ pm: 'pm-PLIN', amount: tot, reference: String(20000000 + Math.floor(r() * 79999999)) }];
      else if (x < 0.9) payments = [{ pm: 'pm-CARD', amount: tot, reference: U.pad(Math.floor(r() * 999999), 6), card_last4: U.pad(Math.floor(r() * 9999), 4), card_brand: r() < 0.8 ? 'VISA' : 'MASTERCARD' }];
      else { const c = Math.min(tot, 20); payments = [{ pm: 'pm-CASH', amount: c }, { pm: 'pm-CARD', amount: R(tot - c), reference: U.pad(Math.floor(r() * 999999), 6), card_last4: U.pad(Math.floor(r() * 9999), 4), card_brand: 'VISA' }]; if (tot - c <= 0) payments = [{ pm: 'pm-CASH', amount: tot }]; }
      try { return checkout({ shift_id: sh.id, customer_id: null, doc_type: 'RECEIPT', lines, payments, at, seed: true }); } catch (e) { return null; }
    };
    const day = (date, open, closeAt, nSales, opts = {}) => {
      const sh = openShift({ terminal_id: TERM, user_id: cashier.id, float: 200, counts: { 100: 1, 50: 1, 20: 1, 10: 2, 5: 2, 1: 5, 0.5: 4, 0.2: 10, 0.1: 10 }, at: date + 'T' + open });
      for (let i = 0; i < nSales; i++) { const t0 = Number(open.slice(0, 2)) * 60 + 20 + Math.floor(i * ((closeAt ? (Number(closeAt.slice(0, 2)) * 60 - 30) : 12 * 60) - Number(open.slice(0, 2)) * 60) / nSales); mkSale(sh, `${date}T${U.pad(Math.floor(t0 / 60), 2)}:${U.pad(t0 % 60, 2)}`, 1 + (r() < 0.45 ? 1 : 0) + (r() < 0.2 ? 1 : 0)); }
      for (const m of opts.moves || []) D.insert('pos_cash_movements', Object.assign({ shift_id: sh.id, moved_at: date + 'T' + m.at, user_id: cashier.id, user_name: cashier.name }, m.row), { silent: true });
      if (closeAt) {
        const exp = expectedBy(sh); const diff = opts.diff || 0;
        closeShift(sh.id, { counts: { 'pm-CASH': R(exp['pm-CASH'] + diff), 'pm-CARD': exp['pm-CARD'], 'pm-YAPE': exp['pm-YAPE'], 'pm-PLIN': exp['pm-PLIN'] }, reason: diff ? opts.reason : null, at: date + 'T' + closeAt });
        sh.closed_by = cashier.id;
        if (opts.approve) Object.assign(sh, { status: 'APPROVED', approved_by: 'us-pleon', approved_by_name: 'Patricia León Vera', approved_at: date + 'T20:10' });
      }
      return sh;
    };
    day('2026-10-08', '08:00', '19:00', 8, { diff: -2.5, reason: 'Vuelto mal entregado en una venta en efectivo', approve: true, moves: [{ at: '13:10', row: { movement_type: 'PETTY_EXPENSE', amount: 12, reason: 'Compra de bolsas biodegradables', authorized_by: null } }] });
    day('2026-10-09', '08:00', '19:05', 10, { diff: 0, moves: [{ at: '12:30', row: { movement_type: 'CASH_OUT', amount: 300, reason: 'Retiro parcial a caja fuerte', authorized_by: 'us-pleon', authorized_by_name: 'Patricia León Vera' } }, { at: '09:15', row: { movement_type: 'CASH_IN', amount: 50, reason: 'Ingreso de sencillo (monedas)', authorized_by: null } }] });
    const today = day(G.TODAY, '08:00', null, 7, { moves: [{ at: '09:05', row: { movement_type: 'CASH_IN', amount: 40, reason: 'Ingreso de sencillo (monedas)', authorized_by: null } }, { at: '11:40', row: { movement_type: 'PETTY_EXPENSE', amount: 18, reason: 'Hielo para la exhibidora', authorized_by: null } }] });
    // una devolución de hoy con nota de crédito (lote bloqueado)
    const d0 = D.where('sales_documents', d => d.pos_shift_id === today.id && d.doc_type === 'RECEIPT' && d.lines.some(l => l.variant_id && l.uom_code === 'NIU'))[0];
    if (d0) { const i = d0.lines.findIndex(l => l.variant_id && l.uom_code === 'NIU'); try { refund({ document_id: d0.id, lines: [{ index: i, qty: 1 }], mode: 'SAME', reason: 'Envase dañado al entregar', shift_id: today.id, at: G.TODAY + 'T11:55', seed: true }); } catch (e) { /* sin efectivo suficiente */ } }
    // recojos listos en el Local 1
    const ready = D.where('sales_orders', o => o.status === 'READY' && o.establishment_id === 'es-L1' && o.created_at.slice(0, 10) === G.TODAY);
    let have = ready.filter(o => o.fulfillment === 'PICKUP').length;
    for (const o of ready.filter(o => o.fulfillment === 'DELIVERY')) { if (have >= 4) break; o.fulfillment = 'PICKUP'; o.pickup_establishment_id = 'es-L1'; o.address_id = null; o.zone_id = null; G.orders.recalc(o); have++; }
  }, 'mostrador');

  /* =====================================================================
     Pruebas de aceptación (CA-POS-01 … CA-POS-06)
     ===================================================================== */
  const T = (name, fn) => G.tests.push({ module: 'POS', name, fn });
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (!String(e.message).startsWith(code)) throw new Error(`Se esperaba ${code} y salió: ${e.message}`); return e; } throw new Error('Se esperaba el rechazo ' + code); };
  const near = (a, b, m) => { if (Math.abs(a - b) > 0.005) throw new Error(`${m}: ${a} ≠ ${b}`); };
  const shiftNow = () => D.find('pos_shifts', s => s.terminal_id === TERM && s.status === 'OPEN');
  T('CA-POS-01: con la caja «Mostrador 1» abierta, otra cajera no abre turno en la misma caja (RN-POS-01)', async () => {
    const sh = shiftNow(); if (!sh) throw new Error('Debe haber un turno abierto en Mostrador 1');
    if (terminal(TERM).name !== 'Mostrador 1') throw new Error('La caja debe llamarse Mostrador 1');
    expectFail(() => openShift({ terminal_id: TERM, user_id: 'us-pleon', float: 200 }), 'RN-POS-01');
    expectFail(() => openShift({ terminal_id: TERM, user_id: sh.cashier_user_id, float: 200 }), 'RN-POS-01');
  });
  T('CA-POS-02: conejo entero (1,200 a 2,500 kg): 25 kg se rechaza (RN-POS-04); 1,850 kg se cobra 1,850 × S/ 38,00 = S/ 70,30', async () => {
    const v = G.variant('va-DG-CON-ENT'); if (v.min_weight_kg !== 1.2 || v.max_weight_kg !== 2.5) throw new Error('Rango esperado 1,200–2,500 kg');
    expectFail(() => validateWeight('va-DG-CON-ENT', 25, 1), 'RN-POS-04');
    near(priceOf('va-DG-CON-ENT').price, 38, 'Precio por kg');
    const w = validateWeight('va-DG-CON-ENT', 1.85, 1);
    const sh = shiftNow();
    const r = checkout({ shift_id: sh.id, lines: [{ variant_id: 'va-DG-CON-ENT', qty: 1, weight_kg: w, weight_source: 'MANUAL' }], payments: [{ pm: 'pm-CASH', amount: 100 }] });
    near(r.total, 70.30, 'Total'); near(r.orders[0].final_total, 70.30, 'Total final del pedido'); near(r.change, 29.70, 'Vuelto');
    if (r.orders[0].channel !== 'COUNTER' || r.orders[0].fulfillment !== 'COUNTER' || r.orders[0].status !== 'CLOSED') throw new Error('Debe ser un pedido COUNTER cerrado');
  });
  T('CA-POS-03: venta de S/ 120,00 con S/ 50 en efectivo y S/ 70 con Visa (op. 004512, ****4821) emite la boleta de la caja y deja dos cobros en el turno', async () => {
    const sh = shiftNow(); const before = shiftPays(sh).length;
    const r = checkout({ shift_id: sh.id, lines: [{ variant_id: 'va-DG-CHO-500', qty: 3 }, { variant_id: 'va-DG-CAL-500', qty: 3 }], payments: [{ pm: 'pm-CASH', amount: 50 }, { pm: 'pm-CARD', amount: 70, reference: '004512', card_last4: '4821', card_brand: 'VISA' }] });
    near(r.total, 120, 'Total');
    if (r.docs.length !== 1 || r.docs[0].doc_type !== 'RECEIPT') throw new Error('Debe emitirse una boleta');
    if (r.docs[0].series !== (D.get('document_series', terminal().receipt_series_id) || {}).series) throw new Error('La boleta debe salir con la serie de la caja (B010): ' + r.docs[0].series);
    const ps = shiftPays(sh); if (ps.length - before !== 2) throw new Error('Deben quedar dos cobros en el turno');
    const card = r.payments.find(p => p.payment_method_id === 'pm-CARD'); if (!card || card.reference !== '004512' || card.card_last4 !== '4821' || card.amount !== 70) throw new Error('Cobro con tarjeta incorrecto');
    near(r.payments.find(p => p.payment_method_id === 'pm-CASH').amount, 50, 'Cobro en efectivo');
  });
  T('CA-POS-04: fondo S/ 200 + efectivo S/ 1 350 − retiro S/ 1 000 → esperado S/ 550; con S/ 545 la diferencia es −S/ 5 y no se cierra sin motivo (RN-POS-07)', async () => {
    D.insert('pos_terminals', { id: 'pt-TEST', code: 'MOS-T', name: 'Mostrador de prueba', establishment_id: 'es-L1', warehouse_id: 'wh-MOS-L1', cash_account_id: 'ca-CAJA-L1', card_account_id: 'ca-POS-VISA', receipt_series_id: 'se-B010', scale_mode: 'MANUAL', default_price_list_id: 'pl-MOS-L1', status: 'ACTIVE' });
    const sh = openShift({ terminal_id: 'pt-TEST', user_id: 'us-pleon', float: 200 });
    const p = G.pay.register({ customer_id: 'cu-VARIOS', payment_method_id: 'pm-CASH', amount: 1350, cash_account_id: 'ca-CAJA-L1', allocations: [], brand_id: 'br-DG', establishment_id: 'es-L1' }); p.pos_shift_id = sh.id;
    cashMovement({ shift_id: sh.id, type: 'CASH_OUT', amount: 1000, reason: 'Retiro a caja fuerte' });
    near(expectedCash(sh).expected, 550, 'Efectivo esperado');
    expectFail(() => closeShift(sh.id, { counts: { 'pm-CASH': 545, 'pm-CARD': 0, 'pm-YAPE': 0, 'pm-PLIN': 0 } }), 'RN-POS-07');
    if (sh.status !== 'OPEN') throw new Error('No debe cerrarse sin motivo');
    closeShift(sh.id, { counts: { 'pm-CASH': 545, 'pm-CARD': 0, 'pm-YAPE': 0, 'pm-PLIN': 0 }, reason: 'Faltante por vuelto' });
    near(sh.difference, -5, 'Diferencia'); if (sh.status !== 'CLOSED') throw new Error('Con motivo sí se cierra');
    expectFail(() => openShift({ terminal_id: 'pt-TEST', user_id: 'us-pleon', float: 0 }) && closeShift(sh.id, { counts: {} }), 'RN-POS-01');
  });
  T('CA-POS-05: con 3 cuyes en la exhibidora y 2 reservados para delivery, vender 2 se rechaza (RN-ALM-09) y vender 1 sí', async () => {
    const vid = 'va-DG-CUY-ENT', wh = 'wh-MOS-L1';
    const q = G.inv.qty(vid, wh);
    if (q > 3) G.inv.move({ type: 'ADJUSTMENT', wh, variant: vid, qty: -(q - 3), reason: 'Preparación de la prueba' });
    if (q < 3) { const lot = G.inv.fefo(vid, 'wh-CAM-L1')[0]; G.inv.move({ type: 'RECEIPT', wh, variant: vid, lot: lot ? lot.b.lot_id : null, qty: 3 - q, unitCost: 26.5, reason: 'Preparación de la prueba' }); }
    if (Math.abs(G.inv.qty(vid, wh) - 3) > 0.001) throw new Error('Deben quedar 3 cuyes en la exhibidora');
    const a = D.find('customer_addresses', x => x.zone_id === 'dz-SURCO-A' && x.customer_id.startsWith('cu-0'));
    const o = G.orders.create({ customer_id: a.customer_id, brand_id: 'br-DG', address_id: a.id, lines: [{ variant_id: vid, qty: 2 }] });
    G.inv.reserve(o);
    near(G.inv.qty(vid, wh, { available: true }), 1, 'Disponible en la exhibidora');
    const sh = shiftNow();
    expectFail(() => checkout({ shift_id: sh.id, lines: [{ variant_id: vid, qty: 2, weight_kg: 1.8 }], payments: [{ pm: 'pm-CASH', amount: 100 }] }), 'RN-ALM-09');
    const r = checkout({ shift_id: sh.id, lines: [{ variant_id: vid, qty: 1, weight_kg: 0.9 }], payments: [{ pm: 'pm-CASH', amount: 50 }] });
    near(r.total, 37.8, 'Total de 1 cuy (0,900 kg × S/ 42)');
    near(G.inv.qty(vid, wh), 2, 'Quedan los 2 reservados'); near(G.inv.qty(vid, wh, { available: true }), 0, 'Sin disponible');
  });
  T('CA-POS-06: la etiqueta 2012345012509 del chorizo artesanal (PLU 12345) toma 1,250 kg; con PLU de otro producto se rechaza (RN-POS-06)', async () => {
    const r = scanLabel('2012345012509', 'va-M3-CHO-ART');
    if (r.variant_id !== 'va-M3-CHO-ART' || r.weight_kg !== 1.25) throw new Error('Debe leer chorizo artesanal con 1,250 kg: ' + JSON.stringify(r));
    expectFail(() => scanLabel('2012345012509', 'va-DG-CUY-ENT'), 'RN-POS-06');
    expectFail(() => scanLabel(sampleLabel(G.variant('va-DG-CUY-ENT'), 1.25), 'va-M3-CHO-ART'), 'RN-POS-06');
    expectFail(() => scanLabel('2012345012508'), 'RN-POS-06');
    const sh = shiftNow();
    const s = checkout({ shift_id: sh.id, lines: [{ variant_id: r.variant_id, qty: 1, weight_kg: r.weight_kg, weight_source: 'LABEL', scale_barcode: r.barcode }], payments: [{ pm: 'pm-YAPE', amount: 45, reference: '77881122' }] });
    near(s.total, 45, '1,250 kg × S/ 36'); if (s.orders[0].lines[0].weight_source !== 'LABEL') throw new Error('La línea debe guardar el origen del peso');
  });
})();
