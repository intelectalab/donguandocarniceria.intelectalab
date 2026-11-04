/* =====================================================================
   DES · Despiece y costeo conjunto (Fase 2)
   Plantillas por especie con rendimiento estándar por corte (CO_PRODUCT,
   BY_PRODUCT, WASTE), activación con versión (RN-DES-01, RN-DES-08),
   precios de referencia con vigencia (D-DES-02: lista web sin IGV),
   despiece en tableta sobre órdenes CUTTING de PRO (consumo PRODUCTION_OUT
   y lotes nuevos PRODUCTION_IN), balance de masa (RN-DES-04), costeo
   conjunto por valor neto realizable y valor de mercado relativo
   (RN-DES-02/03/06/07), alertas por corte fuera de estándar (RN-DES-05) y
   revalorización del inventario al costo final (G.inv.move ADJUSTMENT).
   Expone G.des.template, lines, line, expectedYield, refPrice, allocate,
   allocateOrder, massBalance, cutDeviation, raiseAlerts, allocationView,
   activate, newVersion, createTemplate, saveLine, removeLine, setRefPrice,
   registerInput, registerCut, close, stats.
   ===================================================================== */
(function () {
  'use strict';
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, form, toast, confirm, modal, pills } = G.ui;
  const U = G.util, F = G.fmt;
  const R = (n, d = 2) => U.round(n, d);
  const T_T = 'cutting_templates', T_TL = 'cutting_template_lines', T_P = 'cut_reference_prices';
  const T_O = 'production_orders', T_OUT = 'production_order_outputs', T_C = 'production_order_consumptions', T_LAB = 'production_order_labor';
  const lbl = (arr, v) => (arr.find(x => x[0] === v) || [v, v || '—'])[1];
  const SPECIES = [['CUY', 'Cuy'], ['CONEJO', 'Conejo'], ['POLLO', 'Pollo de corral'], ['PATO', 'Pato'], ['CERDO', 'Cerdo'], ['CORDERO', 'Cordero'], ['RES', 'Res']];
  const ROLES = [['CO_PRODUCT', 'Coproducto'], ['BY_PRODUCT', 'Subproducto'], ['WASTE', 'Merma']];
  const ROLE_TONE = { CO_PRODUCT: 'ok', BY_PRODUCT: 'info', WASTE: '' };
  const TSTAT = { DRAFT: ['Borrador', ''], ACTIVE: ['Activa', 'ok'], RETIRED: ['Retirada', ''] };
  const tbadge = s => badge((TSTAT[s] || [s])[0], (TSTAT[s] || [])[1] || '');
  const rbadge = r => badge(lbl(ROLES, r), ROLE_TONE[r] || '');
  const ACTIVE_O = ['RELEASED', 'IN_PROGRESS'];
  const nm = code => ((((G.SPEC || {}).DES || {}).screens || []).find(s => s[0] === code) || [code, code])[1];
  const canCost = () => G.can('pro.cost.view');
  const money = (v, d) => canCost() ? F.money(v, d) : '•••';
  const kg3 = v => F.kg(v, 3);
  const pp = v => v == null ? '—' : `${v > 0 ? '+' : ''}${F.num(v, 2)} pp`;
  const run = (fn, ok) => { try { const r = fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); if (!(e instanceof G.RuleError)) console.error(e); return null; } };
  const needPro = () => { if (!G.pro) G.fail('RN-DES-02', 'El despiece se registra sobre órdenes CUTTING de PRO y PRO no está en esta instalación.'); };

  /* =====================================================================
     Dominio: plantillas
     ===================================================================== */
  const template = id => G.db.get(T_T, id);
  const lines = tid => G.db.where(T_TL, l => l.template_id === tid).sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const line = id => G.db.get(T_TL, id);
  const tname = t => t ? `${t.name} v${t.version}` : '—';
  const inputVariant = t => t && (t.input_variant_id || (G.db.find('product_variants', v => v.product_id === t.input_product_id) || {}).id);
  const sumPct = tid => R(U.sum(lines(tid), l => Number(l.standard_yield_pct) || 0), 3);
  const rolePct = (tid, role) => R(U.sum(lines(tid).filter(l => l.role === role), l => Number(l.standard_yield_pct) || 0), 3);
  const expectedYield = tid => R(U.sum(lines(tid).filter(l => l.role !== 'WASTE'), l => Number(l.standard_yield_pct) || 0), 2);
  const tolOf = t => t && t.mass_balance_tolerance_pct != null && t.mass_balance_tolerance_pct !== '' ? Number(t.mass_balance_tolerance_pct) : G.param('des_mass_balance_tolerance_pct');
  const versionsOf = t => G.db.where(T_T, x => x.code === t.code).sort((a, b) => b.version - a.version);
  const canManage = () => G.can('des.template.manage');
  function thist(t, action, detail, at) { t.history = (t.history || []).concat([{ at: at || G.date.now(), action, detail, user: G.ctx.userName() }]); }

  function assertManage(opts) { if (!opts.seed && !canManage()) G.fail('RN-DES-01', `Tu rol (${G.roleName()}) no crea ni edita plantillas (permiso des.template.manage, jefe de producción).`); }
  function assertDraft(t) {
    if (!t) G.fail('RN-DES-08', 'Plantilla no encontrada.');
    if (t.status !== 'DRAFT') G.fail('RN-DES-08', `${tname(t)} está ${(TSTAT[t.status] || [t.status])[0].toLowerCase()}: no se edita. Crea una versión nueva; los despieces cerrados conservan la versión usada.`);
  }
  function createTemplate(p, opts = {}) {
    assertManage(opts);
    const v = G.variant(p.input_variant_id); if (!v) G.fail('RN-DES-09', 'Elige el producto de entrada (canal o pieza).');
    const code = String(p.code || '').trim().toUpperCase(); if (!code) G.fail('RN-DES-01', 'Escribe el código de la plantilla.');
    if (G.db.find(T_T, t => t.code === code && t.input_product_id !== v.product_id)) G.fail('RN-DES-01', `El código ${code} ya se usa en otra plantilla.`);
    const prev = G.db.where(T_T, t => t.code === code);
    const row = G.db.insert(T_T, { code, name: String(p.name || '').trim() || v.name, species: p.species || 'CUY', input_product_id: v.product_id, input_variant_id: v.id, brand_id: p.brand_id || v.brand_id, version: prev.length ? Math.max(...prev.map(x => x.version)) + 1 : 1, status: 'DRAFT', mass_balance_tolerance_pct: p.mass_balance_tolerance_pct !== undefined && p.mass_balance_tolerance_pct !== '' ? Number(p.mass_balance_tolerance_pct) : G.param('des_mass_balance_tolerance_pct'), notes: p.notes || null, created_by: G.ctx.userName(), history: [] }, { silent: !!opts.seed });
    thist(row, 'Creación', 'Borrador nuevo', opts.at);
    if (!opts.seed) G.audit('CREAR', T_T, row.id, `${row.code} v${row.version}`);
    return row;
  }
  function updateTemplate(id, p, opts = {}) {
    assertManage(opts); const t = template(id); assertDraft(t);
    const tol = Number(p.mass_balance_tolerance_pct); if (!(tol > 0) || tol > 10) G.fail('RN-DES-04', 'La tolerancia de balance debe estar entre 0 y 10 %.');
    Object.assign(t, { name: String(p.name || t.name).trim(), species: p.species || t.species, mass_balance_tolerance_pct: tol, notes: p.notes || null });
    thist(t, 'Edición', 'Datos generales'); G.db.touch(); return t;
  }
  function saveLine(tid, p, opts = {}) {
    assertManage(opts); const t = template(tid); assertDraft(t);
    const role = p.role; if (!ROLES.find(r => r[0] === role)) G.fail('RN-DES-01', 'Elige el rol del corte (coproducto, subproducto o merma).');
    const pct = R(Number(p.standard_yield_pct), 3); if (!(pct > 0) || pct > 100) G.fail('RN-DES-01', 'El rendimiento estándar debe ser mayor que 0 y no superar 100 %.');
    const vid = role === 'WASTE' ? null : p.output_variant_id;
    if (role !== 'WASTE' && !G.variant(vid)) G.fail('RN-DES-01', 'Elige la variante que sale del corte (el lote nuevo entra a ese producto).');
    const nrv = role === 'BY_PRODUCT' ? R(Number(p.nrv_cost_per_kg) || 0, 4) : 0;
    if (nrv < 0) G.fail('RN-DES-02', 'El costo adicional de venta no puede ser negativo.');
    const name = String(p.name || '').trim() || (vid ? G.variantName(vid) : 'Merma');
    const cur = lines(tid);
    const data = { template_id: tid, name, output_variant_id: vid, role, standard_yield_pct: pct, nrv_cost_per_kg: nrv, notes: p.notes || null };
    let row;
    if (p.id) { row = line(p.id); if (!row || row.template_id !== tid) G.fail('RN-DES-01', 'Línea no encontrada.'); Object.assign(row, data); G.db.touch(); }
    else row = G.db.insert(T_TL, Object.assign({ seq: cur.length ? Math.max(...cur.map(l => l.seq || 0)) + 10 : 10 }, data), { silent: !!opts.seed });
    if (!opts.seed) thist(t, p.id ? 'Línea editada' : 'Línea agregada', `${name} · ${F.pct(pct, 2)}`);
    return row;
  }
  function removeLine(id, opts = {}) {
    assertManage(opts); const l = line(id); if (!l) G.fail('RN-DES-01', 'Línea no encontrada.');
    const t = template(l.template_id); assertDraft(t);
    G.db.remove(T_TL, id); thist(t, 'Línea quitada', l.name); G.db.touch();
  }
  /** RN-DES-01 y RN-DES-08 */
  function validateTemplate(tid) {
    const t = template(tid); const ls = lines(tid);
    const tol = G.param('des_template_sum_tolerance_pct');
    const sum = sumPct(tid);
    const problems = [];
    if (Math.abs(sum - 100) > tol + 1e-9) problems.push(`la suma de rendimientos es ${F.pct(sum, 2)} y debe ser 100 % ± ${F.num(tol, 1)}`);
    if (!ls.some(l => l.role === 'CO_PRODUCT')) problems.push('no tiene ningún coproducto');
    for (const l of ls) if (l.role !== 'WASTE' && !l.output_variant_id) problems.push(`${l.name} no tiene variante de salida`);
    return { ok: !problems.length, sum, tol, problems, t };
  }
  function activate(tid, opts = {}) {
    assertManage(opts); const t = template(tid); assertDraft(t);
    const v = validateTemplate(tid);
    if (!v.ok) G.fail('RN-DES-01', `${tname(t)} no se activa: ${v.problems.join('; ')}.`);
    const at = opts.at || G.date.now();
    for (const o of G.db.where(T_T, x => x.id !== t.id && x.status === 'ACTIVE' && x.input_product_id === t.input_product_id)) {
      o.status = 'RETIRED'; o.retired_at = at; o.retired_by = opts.user || G.ctx.userName(); o.replaced_by = t.id;
      thist(o, 'Retiro', `Reemplazada por ${t.code} v${t.version} (RN-DES-08)`, at);
    }
    t.status = 'ACTIVE'; t.activated_at = at; t.activated_by = opts.user || G.ctx.userName();
    thist(t, 'Activación', `Suma ${F.pct(v.sum, 2)} · rendimiento esperado ${F.pct(expectedYield(t.id), 2)}`, at);
    G.db.touch();
    if (!opts.seed) G.audit('ACTIVAR', T_T, t.id, `${t.code} v${t.version}`);
    return t;
  }
  function retire(tid, reason, opts = {}) {
    assertManage(opts); const t = template(tid); if (!t || t.status !== 'ACTIVE') G.fail('RN-DES-08', 'Solo se retira una plantilla activa.');
    if (!(reason || '').trim()) G.fail('RN-DES-08', 'Escribe el motivo del retiro.');
    t.status = 'RETIRED'; t.retired_at = G.date.now(); t.retired_by = G.ctx.userName(); thist(t, 'Retiro', reason); G.db.touch(); G.audit('RETIRAR', T_T, t.id, reason);
    return t;
  }
  function newVersion(tid, opts = {}) {
    assertManage(opts); const t = template(tid); if (!t) G.fail('RN-DES-08', 'Plantilla no encontrada.');
    const draft = G.db.find(T_T, x => x.code === t.code && x.status === 'DRAFT');
    if (draft) G.fail('RN-DES-08', `Ya hay un borrador de ${t.code} (v${draft.version}): edítalo en lugar de crear otro.`);
    const max = Math.max(...versionsOf(t).map(x => x.version));
    const row = G.db.insert(T_T, { code: t.code, name: t.name, species: t.species, input_product_id: t.input_product_id, input_variant_id: inputVariant(t), brand_id: t.brand_id, version: max + 1, status: 'DRAFT', mass_balance_tolerance_pct: t.mass_balance_tolerance_pct, notes: null, parent_id: t.id, created_by: G.ctx.userName(), history: [] }, { silent: !!opts.seed });
    for (const l of lines(t.id)) G.db.insert(T_TL, { template_id: row.id, seq: l.seq, name: l.name, output_variant_id: l.output_variant_id, role: l.role, standard_yield_pct: l.standard_yield_pct, nrv_cost_per_kg: l.nrv_cost_per_kg, notes: l.notes }, { silent: true });
    thist(row, 'Nueva versión', `Copia de v${t.version}`);
    return row;
  }

  /* =====================================================================
     Precios de referencia (D-DES-02: lista web sin IGV)
     ===================================================================== */
  function refRow(vid, date = G.TODAY) {
    return G.db.where(T_P, p => p.variant_id === vid && p.status === 'ACTIVE' && p.valid_from <= date && (!p.valid_to || p.valid_to >= date))
      .sort((a, b) => String(b.valid_from).localeCompare(a.valid_from) || String(b.created_at).localeCompare(a.created_at))[0] || null;
  }
  const refPrice = (vid, date) => { const r = vid ? refRow(vid, date || G.TODAY) : null; return r ? r.price_per_kg : null; };
  function webPrice(vid, date = G.TODAY) {
    const v = G.variant(vid); if (!v) return null;
    const p = G.price.of(vid, { channel: 'WEB', date }); if (!p || !(p.price > 0)) return null;
    const perKg = p.basis === 'KG' || v.sale_mode === 'KG' ? p.price : v.nominal_weight_kg ? p.price / v.nominal_weight_kg : null;
    return perKg == null ? null : R(perKg / (1 + G.tax.rate()), 2);
  }
  function setRefPrice(p, opts = {}) {
    if (!opts.seed && !G.can('des.reference_price.manage')) G.fail('RN-DES-07', `Tu rol (${G.roleName()}) no carga precios de referencia (permiso des.reference_price.manage).`);
    const v = G.variant(p.variant_id); if (!v) G.fail('RN-DES-07', 'Elige la variante del corte.');
    const price = R(Number(p.price_per_kg), 4); if (!(price > 0)) G.fail('RN-DES-07', `El precio de referencia de ${v.name} debe ser mayor que cero.`);
    const from = p.valid_from || G.TODAY;
    if (p.valid_to && p.valid_to < from) G.fail('RN-DES-07', 'La vigencia termina antes de empezar.');
    for (const r of G.db.where(T_P, r => r.variant_id === v.id && r.status === 'ACTIVE' && (!r.valid_to || r.valid_to >= from))) {
      if (r.valid_from >= from) { r.status = 'REPLACED'; r.replaced_at = opts.at || G.date.now(); } else r.valid_to = G.date.add(from, -1);
    }
    const row = G.db.insert(T_P, { variant_id: v.id, price_per_kg: price, valid_from: from, valid_to: p.valid_to || null, source: p.source || 'MANUAL', web_price_per_kg: webPrice(v.id, from), note: p.note || null, status: 'ACTIVE', created_by: opts.user || G.ctx.userName() }, { silent: !!opts.seed });
    if (!opts.seed) G.audit('PRECIO', T_P, row.id, `${v.name} · ${F.money(price)} por kg desde ${F.date(from)}`);
    G.db.touch();
    return row;
  }
  /** variantes que salen de plantillas activas o en borrador (precio exigido por RN-DES-07) */
  function priceTargets() {
    const m = new Map();
    for (const t of G.db.where(T_T, t => t.status !== 'RETIRED')) for (const l of lines(t.id)) if (l.role !== 'WASTE' && l.output_variant_id) {
      const x = m.get(l.output_variant_id) || { variant_id: l.output_variant_id, roles: new Set(), templates: new Set(), active: false };
      x.roles.add(l.role); x.templates.add(t.name); if (t.status === 'ACTIVE') x.active = true; m.set(l.output_variant_id, x);
    }
    return [...m.values()];
  }

  /* =====================================================================
     Costeo conjunto (RN-DES-02, RN-DES-03, RN-DES-06, RN-DES-07)
     items: [{key, role, kg, ref_price, nrv_cost, name}]
     ===================================================================== */
  function allocate(joint, items, opts = {}) {
    joint = R(Number(joint) || 0);
    const rows = items.map(it => Object.assign({}, it, { kg: R(Number(it.kg) || 0, 3), nrv_cost: Number(it.nrv_cost) || 0, ref_price: it.ref_price == null ? null : Number(it.ref_price), allocated: 0, rounding: 0 }));
    const missing = rows.filter(r => r.role !== 'WASTE' && !(r.ref_price > 0));
    if (missing.length) G.fail('RN-DES-07', `Sin precio de referencia vigente${opts.date ? ' al ' + F.date(opts.date) : ''}: ${missing.map(r => r.name || G.variantName(r.variant_id)).join(', ')}. Cárgalo en DES-03; sin él el despiece no cierra.`);
    const co = rows.filter(r => r.role === 'CO_PRODUCT' && r.kg > 0), by = rows.filter(r => r.role === 'BY_PRODUCT');
    if (!co.length) G.fail('RN-DES-02', 'No hay coproductos con kg registrados: no hay a quién repartir el costo conjunto.');
    for (const r of by) { r.nrv_unit = R(r.ref_price - r.nrv_cost, 4); r.nrv = R(r.kg * Math.max(0, r.nrv_unit)); r.allocated = r.nrv; r.method = 'VNR'; }
    const nrv_total = R(U.sum(by, r => r.nrv));
    if (nrv_total >= joint - 1e-9) {
      const top = by.slice().sort((a, b) => b.nrv - a.nrv)[0];
      G.fail('RN-DES-06', `El VNR de los subproductos (${F.money(nrv_total)}) iguala o supera el costo conjunto (${F.money(joint)}): el despiece no cierra. Revisa el precio de referencia de ${top ? `${top.name || G.variantName(top.variant_id)} (${F.money(top.ref_price)} por kg)` : 'los subproductos'} en DES-03.`);
    }
    const remaining = R(joint - nrv_total);
    for (const r of co) r.market_value = R(r.kg * r.ref_price, 4);
    const market_total = R(U.sum(co, r => r.market_value), 4);
    for (const r of co) { r.share_pct = R(r.market_value / market_total * 100, 4); r.raw = remaining * r.market_value / market_total; r.allocated = R(r.raw); r.method = 'VALOR_RELATIVO'; }
    for (const r of rows) if (r.role === 'WASTE') { r.allocated = 0; r.method = 'SIN_COSTO'; }
    const rounding_diff = R(joint - U.sum(rows, r => r.allocated));
    let rounding_to = null;
    if (Math.abs(rounding_diff) >= 0.005) {
      const big = co.slice().sort((a, b) => b.market_value - a.market_value)[0];
      big.allocated = R(big.allocated + rounding_diff); big.rounding = rounding_diff; rounding_to = big.key;
    }
    for (const r of rows) r.cost_per_kg = r.kg > 0 ? R(r.allocated / r.kg, 4) : 0;
    return { joint_cost: joint, nrv_total, remaining, market_total: R(market_total, 2), rounding_diff, rounding_to, rows };
  }
  const order = id => typeof id === 'string' ? G.db.get(T_O, id) : id;
  const outsOf = id => G.pro ? G.pro.outputs(id) : G.db.where(T_OUT, x => x.order_id === id);
  const consOf = id => G.pro ? G.pro.consumptions(id) : G.db.where(T_C, x => x.order_id === id);
  function despieceDate(o) { const c = consOf(o.id).filter(x => x.role === 'RAW_MATERIAL').sort(U.by('consumed_at'))[0]; return c ? String(c.consumed_at).slice(0, 10) : o.planned_date; }
  function orderItems(o, date, useStored) {
    const d = despieceDate(o) || date || G.TODAY;
    return outsOf(o.id).map(x => {
      const tl = x.template_line_id ? line(x.template_line_id) : null;
      const role = x.output_role === 'MAIN' ? 'CO_PRODUCT' : x.output_role;
      return { key: x.id, output_id: x.id, variant_id: x.variant_id, lot_id: x.lot_id, name: tl ? tl.name : x.variant_id ? G.variantName(x.variant_id) : 'Merma', role, kg: x.weight_kg, ref_price: role === 'WASTE' ? null : useStored && x.reference_price_per_kg != null ? x.reference_price_per_kg : refPrice(x.variant_id, d), nrv_cost: tl ? tl.nrv_cost_per_kg : (x.nrv_cost_per_kg || 0), stored: x.allocated_cost };
    });
  }
  function allocateOrder(o, date) {
    o = order(o); needPro();
    const c = G.pro.computeCost(o);
    const a = allocate(c.total, orderItems(o, date), { date: despieceDate(o) });
    a.cost = c; return a;
  }

  /* ---------- balance de masa (RN-DES-04) ---------- */
  function massBalance(o) {
    o = order(o);
    const input_kg = R(U.sum(consOf(o.id).filter(c => c.role === 'RAW_MATERIAL'), c => c.weight_kg), 3);
    const outs = outsOf(o.id);
    const sumRole = rs => R(U.sum(outs.filter(x => rs.includes(x.output_role)), x => x.weight_kg), 3);
    const co_kg = sumRole(['CO_PRODUCT', 'MAIN']), by_kg = sumRole(['BY_PRODUCT']), waste_kg = sumRole(['WASTE']);
    const output_kg = R(co_kg + by_kg + waste_kg, 3);
    const diff_kg = R(input_kg - output_kg, 3);
    const diff_pct = input_kg > 0 ? R(Math.abs(diff_kg) / input_kg * 100, 2) : null;
    const t = template(o.cutting_template_id);
    const tolerance_pct = tolOf(t);
    return { input_kg, co_kg, by_kg, waste_kg, output_kg, diff_kg, diff_pct, tolerance_pct, ok: input_kg > 0 && diff_pct <= tolerance_pct + 1e-9 };
  }

  /* ---------- rendimiento por corte (RN-DES-05) ---------- */
  function cutRows(o, opts = {}) {
    o = order(o); const t = template(o.cutting_template_id); if (!t) return [];
    const outs = opts.outs || outsOf(o.id);
    const inKg = opts.input_kg != null ? opts.input_kg : (massBalance(o).input_kg || 0);
    const final = opts.final != null ? opts.final : o.status === 'CLOSED';
    const lim = G.param('des_cut_yield_alert_pp');
    return lines(t.id).map(tl => {
      const xs = outs.filter(x => x.template_line_id === tl.id);
      const kg = R(U.sum(xs, x => x.weight_kg), 3);
      const has = xs.length > 0 || final;
      const real = inKg > 0 && has ? R(kg / inKg * 100, 2) : null;
      const dev = real != null ? R(real - tl.standard_yield_pct, 2) : null;
      return { tl, kg, n: xs.length, outs: xs, expected_kg: R((inKg || o.planned_output_kg) * tl.standard_yield_pct / 100, 3), real, std: tl.standard_yield_pct, dev, alert: tl.role !== 'WASTE' && dev != null && Math.abs(dev) > lim + 1e-9 };
    });
  }
  function cutDeviation(o, row) {
    o = order(o); if (!row || !row.template_line_id) return null;
    const r = cutRows(o, { final: false }).find(x => x.tl.id === row.template_line_id);
    return r ? { name: r.tl.name, real: r.real, std: r.std, dev: r.dev, alert: r.alert, role: r.tl.role } : null;
  }
  function inputSupplier(o) { const c = consOf(o.id).find(x => x.role === 'RAW_MATERIAL' && x.lot_id); const l = c && G.db.get('lots', c.lot_id); return l ? l.supplier_id : null; }
  function operatorOf(o, labs, outs) {
    const ls = labs || G.db.where(T_LAB, l => l.order_id === o.id);
    const cut = ls.find(l => l.task_role === 'CUTTER') || ls[0];
    if (cut) { const e = G.db.get('employees', cut.employee_id); if (e) return e.full_name; }
    const x = (outs || outsOf(o.id)).find(y => y.user); return x ? x.user : '—';
  }
  function raiseAlerts(o, opts = {}) {
    o = order(o);
    const rows = cutRows(o, { final: true }).filter(r => r.alert);
    const sup = inputSupplier(o), op = operatorOf(o);
    o.cut_alerts = rows.map(r => ({ template_line_id: r.tl.id, name: r.tl.name, role: r.tl.role, real: r.real, std: r.std, dev: r.dev, operator: op, supplier_id: sup, at: o.closed_at || G.date.now() }));
    G.db.touch();
    if (!opts.seed) for (const a of o.cut_alerts) {
      G.notify({ role: 'JEFE_PRODUCCION', title: `RN-DES-05: ${a.name} fuera de estándar en ${o.number}`, body: `Rinde ${F.pct(a.real, 2)} frente a ${F.pct(a.std, 2)} estándar (${pp(a.dev)}). Operario: ${op}. Proveedor de la canal: ${sup ? G.supName(sup) : '—'}.`, ref: o.id, tone: 'warn', module: 'DES' });
      G.events.emit('control_alert.raised', { module: 'DES', rule: 'RN-DES-05', order_id: o.id, number: o.number, cut: a.name, real: a.real, std: a.std, dev: a.dev, operator: op, supplier_id: sup });
    }
    return o.cut_alerts;
  }

  /* ---------- registro en planta (sobre PRO) ---------- */
  function assertCut(o) { needPro(); if (!o || o.order_type !== 'CUTTING') G.fail('RN-DES-09', 'Elige una orden de despiece (CUTTING).'); }
  function scaleFor(site, date = G.TODAY) { return G.pro ? G.pro.equipmentList(site).find(e => e.category === 'SCALE' && e.status === 'ACTIVE' && (!e.calibration_valid_until || e.calibration_valid_until >= date)) : null; }
  /** lotes del producto de entrada en los almacenes del local, en FEFO, con su motivo de bloqueo */
  function inputLots(o) {
    const t = template(o.cutting_template_id); if (!t) return [];
    const whs = new Set(G.db.where('warehouses', w => w.establishment_id === o.establishment_id).map(w => w.id));
    return G.db.where('stock_balances', b => whs.has(b.warehouse_id) && b.lot_id && b.qty > 0.0005 && (G.productOf(b.variant_id) || {}).id === t.input_product_id)
      .map(b => { const l = G.db.get('lots', b.lot_id); const why = !l ? 'sin lote' : l.qc_status !== 'RELEASED' ? G.ui.statusLabel(l.qc_status).toLowerCase() : l.expiry_date && l.expiry_date < G.TODAY ? 'vencido' : null; return { b, lot: l, why }; })
      .filter(x => x.lot).sort((a, c) => String(a.lot.expiry_date || '9999').localeCompare(String(c.lot.expiry_date || '9999')) || String(a.lot.code).localeCompare(c.lot.code));
  }
  function registerInput(id, p, opts = {}) {
    const o = order(id); assertCut(o);
    const t = template(o.cutting_template_id);
    const lot = G.db.get('lots', p.lot_id); if (!lot) G.fail('RN-DES-09', 'Elige el lote de canal que entra al despiece.');
    if (lot.product_id !== t.input_product_id) G.fail('RN-DES-09', `El lote ${lot.code} es de ${G.variantName(lot.variant_id)}; ${tname(t)} parte de ${G.variantName(inputVariant(t))}.`);
    if (lot.qc_status !== 'RELEASED') G.fail('RN-DES-09', `El lote ${lot.code} está en ${G.ui.statusLabel(lot.qc_status).toLowerCase()}: solo entra al despiece un lote liberado por Calidad (RN-PRO-02).`);
    if (lot.expiry_date && lot.expiry_date < (p.at || G.TODAY).slice(0, 10)) G.fail('RN-DES-09', `El lote ${lot.code} venció el ${F.date(lot.expiry_date)}: no entra al despiece.`);
    const kg = R(Number(p.weight_kg), 3); if (!(kg > 0)) G.fail('RN-DES-09', 'Escribe los kg de canal pesados en la balanza.');
    const bal = G.db.where('stock_balances', b => b.lot_id === lot.id && b.qty > 0.0005).sort((a, b) => b.qty - a.qty)[0];
    if (!bal) G.fail('RN-ALM-03', `El lote ${lot.code} no tiene saldo en almacén.`);
    return G.pro.consume(o.id, { variant_id: lot.variant_id, lot_id: lot.id, qty: kg, warehouse_id: p.warehouse_id || bal.warehouse_id, role: 'RAW_MATERIAL', fefo_override_reason: p.fefo_override_reason, at: p.at }, opts);
  }
  function provisionalUnitCost(o, tl, kg, qty) {
    const t = template(o.cutting_template_id); const inKg = massBalance(o).input_kg || o.planned_output_kg;
    let joint = G.pro.computeCost(o).total; const iv = G.variant(inputVariant(t));
    if (!(joint > 0)) joint = inKg * ((iv && iv.std_cost) || 0);
    let perKg;
    try {
      const a = allocate(joint, lines(t.id).filter(l => l.role !== 'WASTE').map(l => ({ key: l.id, role: l.role, kg: inKg * l.standard_yield_pct / 100, ref_price: refPrice(l.output_variant_id, G.TODAY), nrv_cost: l.nrv_cost_per_kg, name: l.name })));
      perKg = (a.rows.find(r => r.key === tl.id) || {}).cost_per_kg;
    } catch (e) { perKg = null; }
    if (perKg == null) { const v = G.variant(tl.output_variant_id); perKg = (v.std_cost || 0) / G.pro.unitKg(v.id); }
    return R(perKg * kg / qty, 6);
  }
  function registerCut(id, p, opts = {}) {
    const o = order(id); assertCut(o);
    const tl = line(p.template_line_id); if (!tl || tl.template_id !== o.cutting_template_id) G.fail('RN-DES-05', 'Elige un corte de la plantilla de esta orden.');
    const kg = R(Number(p.weight_kg), 3); if (!(kg > 0)) G.fail('RN-PRO-13', `Escribe los kg pesados de ${tl.name}.`);
    if (!opts.seed && !(massBalance(o).input_kg > 0)) G.fail('RN-DES-04', 'Registra primero el lote de canal que entra y su peso: sin kg de entrada no se mide el rendimiento.');
    let row;
    if (tl.role === 'WASTE') row = G.pro.output(o.id, { output_role: 'WASTE', weight_kg: kg, waste_reason: (p.waste_reason || '').trim() || tl.name, template_line_id: tl.id, at: p.at }, opts);
    else {
      const v = G.variant(tl.output_variant_id);
      const qty = v.sale_mode === 'KG' ? kg : Math.max(1, Math.round(Number(p.qty) || kg / G.pro.unitKg(v.id)));
      const sc = p.scale_equipment_id === undefined ? scaleFor(o.establishment_id, (p.at || G.TODAY).slice(0, 10)) : null;
      row = G.pro.output(o.id, { variant_id: v.id, output_role: tl.role, template_line_id: tl.id, qty, weight_kg: kg, unit_cost: p.unit_cost != null ? p.unit_cost : provisionalUnitCost(o, tl, kg, qty), lot_code: p.lot_code, scale_equipment_id: p.scale_equipment_id || (sc && sc.id) || null, qc_status: p.qc_status || 'QUARANTINE', at: p.at }, opts);
    }
    return { row, dev: cutDeviation(o, row) };
  }
  /** cierre del despiece: RN-DES-04 con permiso, luego PRO.close (que aplica RN-DES-02/03/06/07) */
  function closeCutting(id, opts = {}) {
    const o = order(id); assertCut(o);
    const mb = massBalance(o);
    if (mb.input_kg > 0 && !mb.ok) {
      const msg = `entran ${kg3(mb.input_kg)} y se registran ${kg3(mb.output_kg)} (diferencia ${F.pct(mb.diff_pct, 2)}, tolerancia ${F.pct(mb.tolerance_pct, 1)})`;
      if (!opts.override) G.fail('RN-DES-04', `Balance de masa fuera de tolerancia: ${msg}. Registra la merma o los cortes que faltan; quien tenga des.mass_balance.override puede cerrar con la excepción.`);
      if (!opts.seed && !G.can('des.mass_balance.override')) G.fail('RN-DES-04', `Cerrar fuera de tolerancia exige el permiso des.mass_balance.override y tu rol (${G.roleName()}) no lo tiene: ${msg}.`);
    }
    const r = G.pro.close(o.id, Object.assign({}, opts, { massOverride: !!opts.override }));
    if (!mb.ok && opts.override) { r.mass_balance_override_reason = (opts.override_reason || '').trim() || null; G.db.touch(); }
    return r;
  }
  /** revalorización: el lote producido queda en inventario a su costo conjunto final (RN-DES-02, RN-DES-10) */
  function revalue(o) {
    const out = [];
    for (const x of outsOf(o.id)) {
      if (!x.lot_id || x.output_role === 'WASTE' || x.unit_cost == null) continue;
      for (const b of G.db.where('stock_balances', b => b.lot_id === x.lot_id && b.qty > 0.0005)) {
        if (Math.abs((b.avg_cost || 0) - x.unit_cost) < 0.00005) continue;
        const q = b.qty, w = b.weight_kg; const src = { type: 'PRODUCTION_ORDER', id: o.id };
        const a = G.inv.move({ type: 'ADJUSTMENT', wh: b.warehouse_id, variant: b.variant_id, lot: b.lot_id, qty: -q, weight: w, source: src, reason: `Revalorización ${o.number}: sale a costo provisional (RN-DES-02)`, allowUnreleased: true, allowNegative: true });
        const c = G.inv.move({ type: 'ADJUSTMENT', wh: b.warehouse_id, variant: b.variant_id, lot: b.lot_id, qty: q, weight: w, unitCost: x.unit_cost, source: src, reason: `Revalorización ${o.number}: entra a costo conjunto final (RN-DES-02)` });
        out.push(a.moves[0], c.moves[0]);
      }
    }
    return out;
  }
  G.events.on('production_order.closed', p => { const o = p && G.db.get(T_O, p.order_id); if (o && o.order_type === 'CUTTING') { try { revalue(o); } catch (e) { console.error('DES revalorización', e); } } });

  /* ---------- estadística de despieces cerrados (KPI, DES-07/08/09) ---------- */
  function stats(orders) {
    const ids = new Set(orders.map(o => o.id));
    const outsBy = U.groupBy(G.db.where(T_OUT, x => ids.has(x.order_id)), 'order_id');
    const consBy = U.groupBy(G.db.where(T_C, x => ids.has(x.order_id)), 'order_id');
    const labBy = U.groupBy(G.db.where(T_LAB, x => ids.has(x.order_id)), 'order_id');
    return orders.map(o => {
      const t = template(o.cutting_template_id); const outs = outsBy[o.id] || [], cons = (consBy[o.id] || []).filter(c => c.role === 'RAW_MATERIAL');
      const input_kg = R(U.sum(cons, c => c.weight_kg), 3), input_cost = R(U.sum(cons, c => c.total_cost));
      const lot = cons[0] && cons[0].lot_id ? G.db.get('lots', cons[0].lot_id) : null;
      const co = outs.filter(x => ['CO_PRODUCT', 'MAIN'].includes(x.output_role)), by = outs.filter(x => x.output_role === 'BY_PRODUCT');
      const co_kg = R(U.sum(co, x => x.weight_kg), 3), by_kg = R(U.sum(by, x => x.weight_kg), 3), waste_reg = R(U.sum(outs.filter(x => x.output_role === 'WASTE'), x => x.weight_kg), 3);
      const std_co = t ? rolePct(t.id, 'CO_PRODUCT') : 0;
      const cuts = t ? cutRows(o, { outs, input_kg, final: o.status === 'CLOSED' }) : [];
      return {
        o, t, species: t ? t.species : null, date: o.close_date || o.planned_date, month: String(o.close_date || o.planned_date).slice(0, 7), input_kg, input_cost, lot, supplier_id: lot ? lot.supplier_id : null,
        co_kg, by_kg, waste_reg, waste_kg: R(input_kg - co_kg - by_kg, 3), co_alloc: R(U.sum(co, x => x.allocated_cost || 0)), by_alloc: R(U.sum(by, x => x.allocated_cost || 0)),
        std_co, co_yield: input_kg ? R(co_kg / input_kg * 100, 2) : null, operator: operatorOf(o, labBy[o.id] || [], outs), cuts,
      };
    });
  }
  const closedCuts = ({ from, to, brand, site, species } = {}) => G.db.where(T_O, o => o.order_type === 'CUTTING' && o.status === 'CLOSED' && o.close_date >= (from || '0000') && o.close_date <= (to || '9999') && (!site || o.establishment_id === site) && (!brand || o.brand_id === brand) && (!species || (template(o.cutting_template_id) || {}).species === species));
  function kpiYield(ss) { const inK = U.sum(ss, s => s.input_kg); if (!inK) return null; const real = U.sum(ss, s => s.co_kg) / inK * 100; const std = U.sum(ss, s => s.std_co * s.input_kg) / inK; return { value: R(real - std, 2), numerator: R(real, 2), denominator: R(std, 2) }; }
  function kpiWaste(ss) { const inK = U.sum(ss, s => s.input_kg); if (!inK) return null; const w = U.sum(ss, s => s.waste_kg); return { value: R(w / inK * 100, 2), numerator: R(w, 3), denominator: R(inK, 3) }; }
  function kpiCost(ss) { const k = U.sum(ss, s => s.co_kg); if (!k) return null; const c = U.sum(ss, s => s.co_alloc); return { value: R(c / k, 4), numerator: R(c), denominator: R(k, 3) }; }
  function kpiOut(ss) { const cs = ss.flatMap(s => s.cuts.filter(c => c.tl.role !== 'WASTE' && c.n > 0)); if (!cs.length) return null; const bad = cs.filter(c => c.alert).length; return { value: R(bad / cs.length * 100, 2), numerator: bad, denominator: cs.length }; }
  G.kpiCalc['KPI-DES-01'] = p => kpiYield(stats(closedCuts(p || {})));
  G.kpiCalc['KPI-DES-02'] = p => kpiWaste(stats(closedCuts(p || {})));
  G.kpiCalc['KPI-DES-03'] = p => kpiCost(stats(closedCuts(p || {})));
  G.kpiCalc['KPI-DES-04'] = p => kpiOut(stats(closedCuts(p || {})));

  G.des = { template, lines, line, inputVariant, sumPct, expectedYield, validate: validateTemplate, createTemplate, updateTemplate, saveLine, removeLine, activate, retire, newVersion, refPrice, refRow, webPrice, setRefPrice, allocate, allocateOrder, massBalance, cutRows, cutDeviation, raiseAlerts, registerInput, registerCut, close: closeCutting, revalue, stats, closedCuts, SPECIES, ROLES };

  /* =====================================================================
     Seeds 42.5 (catálogo, plantillas y precios) y 44 (despieces de pollo)
     ===================================================================== */
  // [código de producto, marca, categoría, nombre, conservación, vida útil, [sku, nombre variante, costo estándar]]
  const NEWP = [
    ['MP-POL', 'DG', 'MP', 'Pollo de corral en canal', 'CHILLED', 4, 'MP-POL-CAN', 'Pollo de corral en canal', 11.80],
    ['MP-PAT', 'DG', 'MP', 'Pato en canal', 'CHILLED', 4, 'MP-PAT-CAN', 'Pato en canal', 16.50],
    ['POL-PIE', 'DG', 'AVES', 'Pierna y muslo de pollo de corral', 'CHILLED', 6, 'DG-POL-PIE', 'Pierna y muslo de pollo de corral', 13.20],
    ['POL-ALA', 'DG', 'AVES', 'Alitas de pollo de corral', 'CHILLED', 6, 'DG-POL-ALA', 'Alitas de pollo de corral', 10.40],
    ['MP-POLC', 'DG', 'MP', 'Carcasa y menudencia de pollo', 'FROZEN', 30, 'MP-POL-CAR', 'Carcasa y menudencia de pollo', 3.10],
    ['PAT-MAG', 'DG', 'AVES', 'Magret de pato', 'CHILLED', 6, 'DG-PAT-MAG', 'Magret de pato', 48.00],
    ['PAT-PIE', 'DG', 'AVES', 'Pierna de pato', 'CHILLED', 6, 'DG-PAT-PIE', 'Pierna de pato', 29.00],
    ['MP-PATG', 'DG', 'MP', 'Grasa de pato', 'CHILLED', 10, 'MP-PAT-GRA', 'Grasa de pato', 8.00],
    ['MP-PATC', 'DG', 'MP', 'Carcasa de pato para caldo', 'FROZEN', 30, 'MP-PAT-CAR', 'Carcasa de pato para caldo', 2.80],
  ];
  // id, código, nombre, especie, variante de entrada, versión, estado, activación, retiro, notas, líneas [nombre, variante, rol, %, costo adicional]
  const TPL = [
    ['ct-COR-1', 'PL-COR', 'Cordero en canal', 'CORDERO', 'va-MP-COR-CAN', 1, 'ACTIVE', '2026-08-20T10:00', null, 'Canal entera del productor de cordero; sierra para pierna y costillar.', [
      ['Pierna', 'va-DG-COR-PIE', 'CO_PRODUCT', 31, 0], ['Costillar', 'va-DG-COR-COS', 'CO_PRODUCT', 20, 0], ['Paleta', 'va-DG-COR-PAL', 'CO_PRODUCT', 22, 0], ['Cuello y falda', 'va-DG-COR-CUE', 'CO_PRODUCT', 10, 0],
      ['Huesos para caldo', 'va-MP-HUE-KG', 'BY_PRODUCT', 12, 1.00], ['Grasa para manteca', 'va-MP-COR-GRA', 'BY_PRODUCT', 3, 1.00], ['Merma (hueso astillado, sangre, recortes)', null, 'WASTE', 2, 0]]],
    ['ct-CER-1', 'PL-CER', 'Cerdo media res (Marca 2)', 'CERDO', 'va-MP-CER-MR', 1, 'ACTIVE', '2026-08-18T09:00', null, 'D-DES-03: el cerdo llega en media res del camal o del productor; salen los cortes primarios de la Marca 2.', [
      ['Bondiola', 'va-M2-BON-KG', 'CO_PRODUCT', 9, 0], ['Panceta', 'va-M2-PAN-KG', 'CO_PRODUCT', 12, 0], ['Chuleta', 'va-M2-CHU-KG', 'CO_PRODUCT', 16, 0], ['Pierna para jamón', 'va-MP-CER-PIE', 'CO_PRODUCT', 22, 0],
      ['Recortes para embutido', 'va-MP-CER-REC', 'CO_PRODUCT', 14, 0], ['Grasa dorsal para manteca', 'va-MP-CER-GRA', 'BY_PRODUCT', 8, 0.80], ['Huesos para caldo', 'va-MP-HUE-KG', 'BY_PRODUCT', 15, 1.00], ['Merma (sangre, piel, recortes)', null, 'WASTE', 4, 0]]],
    ['ct-CER-2', 'PL-CER', 'Cerdo media res (Marca 2)', 'CERDO', 'va-MP-CER-MR', 2, 'DRAFT', null, null, 'D-DES-01: ajuste con los primeros 20 despieces; la chuleta baja a 15 % y falta asignar 1 punto.', [
      ['Bondiola', 'va-M2-BON-KG', 'CO_PRODUCT', 9, 0], ['Panceta', 'va-M2-PAN-KG', 'CO_PRODUCT', 12, 0], ['Chuleta', 'va-M2-CHU-KG', 'CO_PRODUCT', 15, 0], ['Pierna para jamón', 'va-MP-CER-PIE', 'CO_PRODUCT', 22, 0],
      ['Recortes para embutido', 'va-MP-CER-REC', 'CO_PRODUCT', 14, 0], ['Grasa dorsal para manteca', 'va-MP-CER-GRA', 'BY_PRODUCT', 8, 0.80], ['Huesos para caldo', 'va-MP-HUE-KG', 'BY_PRODUCT', 15, 1.00], ['Merma (sangre, piel, recortes)', null, 'WASTE', 4, 0]]],
    ['ct-CUY-0', 'PL-CUY', 'Cuy entero en canal', 'CUY', 'va-MP-CUY-CAN', 1, 'RETIRED', '2026-07-15T09:00', '2026-08-25T09:00', 'Primera versión de la demostración.', [
      ['Cuy deshuesado', 'va-DG-CUY-DES', 'CO_PRODUCT', 64, 0], ['Huesos y carcasa', 'va-MP-HUE-KG', 'BY_PRODUCT', 23, 1.00], ['Menudencia', 'va-MP-CUY-MEN', 'BY_PRODUCT', 8, 1.50], ['Merma', null, 'WASTE', 5, 0]]],
    ['ct-CUY-1', 'PL-CUY', 'Cuy entero en canal', 'CUY', 'va-MP-CUY-CAN', 2, 'ACTIVE', '2026-08-25T09:00', null, 'Cuyes de la Granja Don Guando; menudencia aparte para venta y caldo.', [
      ['Cuy deshuesado', 'va-DG-CUY-DES', 'CO_PRODUCT', 66, 0], ['Huesos y carcasa', 'va-MP-HUE-KG', 'BY_PRODUCT', 22, 1.00], ['Menudencia', 'va-MP-CUY-MEN', 'BY_PRODUCT', 8, 1.50], ['Merma', null, 'WASTE', 4, 0]]],
    ['ct-CON-1', 'PL-CON', 'Conejo en canal', 'CONEJO', 'va-MP-CON-CAN', 1, 'ACTIVE', '2026-08-25T09:30', null, 'Conejo de la granja trozado en 8 piezas.', [
      ['Conejo trozado', 'va-DG-CON-TRZ', 'CO_PRODUCT', 82, 0], ['Huesos y cabeza', 'va-MP-HUE-KG', 'BY_PRODUCT', 12, 1.00], ['Merma', null, 'WASTE', 6, 0]]],
    ['ct-POL-1', 'PL-POL', 'Pollo de corral en canal', 'POLLO', 'va-MP-POL-CAN', 1, 'ACTIVE', '2026-08-28T11:00', null, 'Pollo de corral en canal; la carcasa va a caldos (RN-DES-10).', [
      ['Pechuga', 'va-DG-POL-PEC', 'CO_PRODUCT', 32, 0], ['Pierna y muslo', 'va-DG-POL-PIE', 'CO_PRODUCT', 30, 0], ['Alitas', 'va-DG-POL-ALA', 'CO_PRODUCT', 10, 0], ['Carcasa y menudencia', 'va-MP-POL-CAR', 'BY_PRODUCT', 23, 0.50], ['Merma', null, 'WASTE', 5, 0]]],
    ['ct-PAT-1', 'PL-PAT', 'Pato en canal', 'PATO', 'va-MP-PAT-CAN', 1, 'DRAFT', null, null, 'Propuesta para la línea gourmet: magret y pierna para confit; la grasa va a la Marca 5.', [
      ['Magret', 'va-DG-PAT-MAG', 'CO_PRODUCT', 26, 0], ['Pierna', 'va-DG-PAT-PIE', 'CO_PRODUCT', 28, 0], ['Grasa de pato', 'va-MP-PAT-GRA', 'BY_PRODUCT', 12, 2.00], ['Carcasa para caldo', 'va-MP-PAT-CAR', 'BY_PRODUCT', 26, 0.50], ['Merma', null, 'WASTE', 8, 0]]],
  ];
  // [variante, precio por kg (null = lista web sin IGV), desde, fuente, nota] · cambios posteriores en orden
  const PRICES = [
    ['va-DG-CUY-DES', null, '2026-08-01'], ['va-DG-CON-TRZ', null, '2026-08-01'], ['va-DG-POL-PEC', null, '2026-08-01'],
    ['va-M2-BON-KG', null, '2026-08-01'], ['va-M2-PAN-KG', null, '2026-08-01'], ['va-M2-CHU-KG', null, '2026-08-01'],
    ['va-DG-COR-PIE', null, '2026-08-01'], ['va-DG-COR-COS', null, '2026-08-01'],
    ['va-DG-COR-PAL', 30.00, '2026-08-01', 'MANUAL', 'Sin precio web: mercado mayorista de Lima'], ['va-DG-COR-CUE', 18.00, '2026-08-01', 'MANUAL', 'Sin precio web: mercado mayorista de Lima'],
    ['va-MP-HUE-KG', 5.50, '2026-08-01', 'MANUAL', 'Precio de venta a restaurantes para caldo'], ['va-MP-COR-GRA', 3.00, '2026-08-01', 'MANUAL', 'Grasa para manteca (precio de compra evitado)'],
    ['va-MP-CUY-MEN', 14.00, '2026-08-01', 'MANUAL', 'Menudencia de cuy a picanterías'], ['va-MP-CER-PIE', 19.50, '2026-08-01', 'MANUAL', 'Precio de compra evitado de pierna para jamón'],
    ['va-MP-CER-REC', 18.00, '2026-08-01', 'MANUAL', 'Precio de compra evitado de recortes para embutido'], ['va-MP-CER-GRA', 5.00, '2026-08-01', 'MANUAL', 'Grasa dorsal para manteca'],
    ['va-DG-POL-PIE', 15.25, '2026-08-01', 'MANUAL', 'Referencia de mercado (pierna y muslo de corral)'], ['va-DG-POL-ALA', 13.50, '2026-08-01', 'MANUAL', 'Referencia de mercado'], ['va-MP-POL-CAR', 3.50, '2026-08-01', 'MANUAL', 'Carcasa para caldo'],
    ['va-DG-PAT-MAG', 62.00, '2026-08-15', 'MANUAL', 'Referencia de restaurantes gourmet'], ['va-DG-PAT-PIE', 38.00, '2026-08-15', 'MANUAL', 'Referencia de restaurantes gourmet'], ['va-MP-PAT-GRA', 12.00, '2026-08-15', 'MANUAL', 'Grasa para la Marca 5'],
    // octubre: mercado mayorista del cordero y huesos (D-DES-02: provisional)
    ['va-DG-COR-PIE', 45.00, '2026-10-01', 'MANUAL', 'Mercado mayorista de octubre (la pierna sube por la demanda de restaurantes)'], ['va-DG-COR-COS', 38.00, '2026-10-01', 'MANUAL', 'Mercado mayorista de octubre'],
    ['va-DG-COR-PAL', 35.00, '2026-10-01', 'MANUAL', 'Mercado mayorista de octubre'], ['va-DG-COR-CUE', 20.00, '2026-10-01', 'MANUAL', 'Mercado mayorista de octubre'],
    ['va-MP-HUE-KG', 6.00, '2026-10-01', 'MANUAL', 'Nueva lista a restaurantes'],
  ];
  G.seed(42.5, function seedDesTemplates() {
    if (G.pro) G.pro.ensureCatalog();
    let n = 0;
    for (const [pc, br, cat, name, storage, life, sku, vname, cost] of NEWP) {
      const pid = 'pr-' + pc, vid = 'va-' + sku, goods = cat !== 'MP';
      if (!G.db.get('products', pid)) G.db.insert('products', { id: pid, brand_id: 'br-' + br, category_id: 'pc-' + cat, code: pc, name, line: goods ? 'AVES' : 'OTROS', product_type: goods ? 'GOODS' : 'INPUT', origin: goods ? 'PRODUCED' : 'RAW_MATERIAL', storage, shelf_life_days: life, requires_lot: true, igv_affectation: '10', sanitary_authority: 'SENASA', sanitary_registry: 'SENASA-PE-' + U.pad(1620 + n * 7, 5), sanitary_registry_expires: '2027-06-30', status: 'ACTIVE', web_publishable: false, allow_discount: false, source_module: 'DES' }, { silent: true });
      if (!G.db.get('product_variants', vid)) G.db.insert('product_variants', { id: vid, product_id: pid, brand_id: 'br-' + br, sku, name: vname, barcode: '7759' + U.pad(5200 + (n++) * 41, 9), uom_id: 'um-KGM', sale_mode: 'KG', nominal_weight_kg: null, weight_tolerance_pct: 5, min_weight_kg: null, max_weight_kg: null, scale_plu: null, status: 'ACTIVE', web_publishable: false, min_order_qty: 0.5, qty_step: 0.25, std_cost: cost, sellable: goods, line: goods ? 'AVES' : 'OTROS' }, { silent: true });
    }
    // respaldo: los cortes de salida vendibles necesitan registro sanitario (los de cordero de PRO llegan sin él)
    const outPids = new Set(TPL.flatMap(x => x[10].map(l => l[1])).filter(Boolean).map(v => (G.variant(v) || {}).product_id));
    for (const p of G.db.where('products', p => outPids.has(p.id) && p.product_type === 'GOODS' && p.sanitary_authority && p.sanitary_authority !== 'NONE' && (!p.sanitary_registry || !p.sanitary_registry_expires))) {
      p.sanitary_registry = p.sanitary_registry || 'SENASA-PE-' + U.pad(1700 + (n++) * 11, 5); p.sanitary_registry_expires = p.sanitary_registry_expires || '2027-06-30';
    }
    const jefe = G.db.find('users', u => u.role === 'JEFE_PRODUCCION');
    const jn = jefe ? jefe.name : 'Jefe de producción';
    for (const [id, code, name, species, vin, version, status, actAt, retAt, notes, ls] of TPL) {
      const v = G.variant(vin); if (!v) continue;
      const t = G.db.insert(T_T, { id, code, name, species, input_product_id: v.product_id, input_variant_id: v.id, brand_id: v.brand_id, version, status, mass_balance_tolerance_pct: 2, notes, created_by: jn, activated_at: actAt, activated_by: actAt ? jn : null, retired_at: retAt, retired_by: retAt ? jn : null, replaced_by: retAt ? 'ct-' + id.slice(3, 6) + '-1' : null, parent_id: version > 1 ? (TPL.find(x => x[1] === code && x[5] === version - 1) || [])[0] || null : null,
        history: [{ at: (actAt || '2026-10-08T16:00'), action: 'Creación', detail: version > 1 ? `Copia de v${version - 1}` : 'Plantilla de demostración (D-DES-01)', user: jn }].concat(actAt ? [{ at: actAt, action: 'Activación', detail: 'Suma 100 %', user: jn }] : []).concat(retAt ? [{ at: retAt, action: 'Retiro', detail: 'Reemplazada por la versión siguiente (RN-DES-08)', user: jn }] : []) }, { silent: true });
      ls.forEach(([lname, vid, role, pct, nrv], i) => G.db.insert(T_TL, { template_id: t.id, seq: (i + 1) * 10, name: lname, output_variant_id: vid, role, standard_yield_pct: pct, nrv_cost_per_kg: nrv, notes: null }, { silent: true }));
    }
    for (const [vid, price, from, src, note] of PRICES) {
      if (!G.variant(vid)) continue;
      const w = price != null ? null : (webPrice(vid, from) ?? webPrice(vid));
      const p = price != null ? price : w != null ? w : R((G.variant(vid).std_cost || 0) * 1.35, 2);
      if (!(p > 0)) continue;
      setRefPrice({ variant_id: vid, price_per_kg: p, valid_from: from, source: price == null && w != null ? 'WEB_LIST' : (src || 'MANUAL'), note: price == null && w != null ? 'Lista web sin IGV (D-DES-02)' : (note || 'Sin precio web: costo estándar + 35 %') }, { seed: true, user: jn, at: from + 'T08:00' });
    }
  }, 'DES plantillas y precios');

  G.seed(44, function seedDesPollo() {
    if (!G.pro || !template('ct-POL-1')) return;
    const r = U.rng(4444);
    const noise = a => (r() + r() + r() - 1.5) / 1.5 * a;
    const users = G.db.all('users');
    const jefe = users.find(u => u.role === 'JEFE_PRODUCCION'), cal = users.find(u => u.role === 'CALIDAD');
    const op = users.find(u => u.role === 'OPERARIO_PRODUCCION' && (u.sites || []).includes('es-L1')) || jefe;
    const emp = (op && op.employee_id) || (G.db.find('employees', e => e.establishment_id === 'es-L1') || {}).id;
    const avicola = 'su-' + U.rucCheck('2060233817').slice(-8);
    const uo = { seed: true, user: op ? op.name : 'Operario', userId: op && op.id };
    const t = template('ct-POL-1'); const tls = lines(t.id);
    const mkLot = (d, kg, sup, cost) => {
      const lot = G.db.insert('lots', { product_id: 'pr-MP-POL', variant_id: 'va-MP-POL-CAN', code: `PC-${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}-${U.pad(G.db.next('DES-LOTPC', '', 1), 2)}`, origin: sup === 'su-GRANJA' ? 'FARM' : 'PURCHASE', supplier_id: sup, production_date: G.date.add(d, -1), expiry_date: G.date.add(d, 3), qc_status: 'RELEASED', unit_cost: cost, released_at: G.date.add(d, -1) + 'T17:00', released_by: cal ? cal.name : 'Calidad' }, { silent: true });
      G.inv.move({ type: 'RECEIPT', wh: 'wh-CAM-L1', variant: 'va-MP-POL-CAN', lot: lot.id, qty: kg, weight: kg, unitCost: cost, source: { type: sup === 'su-GRANJA' ? 'FARM_RECEIPT' : 'PURCHASE_RECEIPT', id: 'REC-' + d }, at: G.date.add(d, -1) + 'T16:00', reason: 'Recepción de pollo en canal' });
      return lot;
    };
    // [fecha, kg, proveedor, castigo a la pechuga en puntos]
    const DAYS = [['2026-09-03', 28, 'su-GRANJA', 0], ['2026-09-10', 31, avicola, 0], ['2026-09-17', 30, 'su-GRANJA', 0], ['2026-09-24', 29.5, avicola, 4.2], ['2026-10-01', 32, 'su-GRANJA', 0], ['2026-10-08', 30.5, avicola, 3.9]];
    for (const [d, kgIn, sup, pen] of DAYS) {
      const cost = R(sup === 'su-GRANJA' ? 11.6 + noise(0.2) : 12.4 + noise(0.25), 2);
      const kg = R(kgIn + noise(0.4), 3);
      const lot = mkLot(d, kg, sup, cost);
      const o = G.pro.create({ order_type: 'CUTTING', line_id: 'pl-L1-COR', cutting_template_id: t.id, planned_output_kg: kgIn, planned_date: d, supervisor_user_id: jefe && jefe.id }, { seed: true, at: G.date.add(d, -2) + 'T15:00', user: jefe && jefe.name });
      G.pro.release(o.id, { seed: true, at: G.date.add(d, -1) + 'T16:00' });
      registerInput(o.id, { lot_id: lot.id, weight_kg: kg, at: d + 'T07:10' }, Object.assign({ fefoChecked: true }, uo));
      if (emp) G.pro.addLabor(o.id, { employee_id: emp, task_role: 'CUTTER', hours: R(1.5 + noise(0.3), 1), work_date: d }, uo);
      let sum = 0; const plan = [];
      for (const tl of tls) {
        if (tl.role === 'WASTE') continue;
        const pct = tl.standard_yield_pct + noise(tl.role === 'CO_PRODUCT' ? 1.1 : 0.8) - (tl.name === 'Pechuga' ? pen : 0) + (tl.role === 'BY_PRODUCT' ? pen * 0.6 : 0);
        const k = R(kg * pct / 100, 3); sum += k; plan.push({ tl, k });
      }
      const joint = G.pro.computeCost(o).total;
      const a = allocate(joint, plan.map(x => ({ key: x.tl.id, role: x.tl.role, kg: x.k, ref_price: refPrice(x.tl.output_variant_id, d), nrv_cost: x.tl.nrv_cost_per_kg, name: x.tl.name })));
      const outRows = [];
      plan.forEach((x, i) => { const al = a.rows.find(z => z.key === x.tl.id); outRows.push(registerCut(o.id, { template_line_id: x.tl.id, weight_kg: x.k, unit_cost: R(al.allocated / x.k, 6), qc_status: 'RELEASED', at: d + 'T08:' + U.pad(10 + i * 6, 2) }, uo).row); });
      const unreg = R(kg * (0.003 + r() * 0.006), 3);
      const wl = tls.find(l => l.role === 'WASTE');
      const wk = R(kg - sum - unreg, 3); if (wk > 0) registerCut(o.id, { template_line_id: wl.id, weight_kg: wk, waste_reason: 'Plumas residuales, sangre y recortes', at: d + 'T08:50' }, uo);
      const c = G.pro.computeCost(o);
      G.pro.close(o.id, { seed: true, date: d, massOverride: true, yield_deviation_reason: c.deviation != null && Math.abs(c.deviation) > G.param('pro_yield_tolerance_pp') ? 'Pechugas pequeñas del lote del proveedor avícola.' : '', waste_reason: c.waste_pct != null && c.waste_pct > c.max_waste ? 'Pollo con más plumón y sangre retenida; se limpió más.' : '', user: jefe ? jefe.name : 'Jefe de producción', userId: jefe && jefe.id, at: d + 'T17:20' });
      // liberación y venta consolidada de lo producido
      for (const x of outRows) {
        const l = G.db.get('lots', x.lot_id); if (!l) continue;
        l.qc_status = 'RELEASED'; l.released_at = d + 'T11:00'; l.released_by = cal ? cal.name : 'Calidad';
        const day = G.date.add(d, 1 + Math.floor(r() * 2)); if (day >= G.TODAY) continue;
        const bal = G.db.find('stock_balances', b => b.lot_id === l.id && b.qty > 0); if (!bal) continue;
        G.inv.move({ type: x.output_role === 'BY_PRODUCT' ? 'WASTE' : 'SALE', wh: bal.warehouse_id, variant: l.variant_id, lot: l.id, qty: bal.qty, weight: bal.qty, source: { type: x.output_role === 'BY_PRODUCT' ? 'INTERNAL_USE' : 'SALES_SUMMARY', id: 'VTA-' + day }, at: day + 'T19:00', reason: x.output_role === 'BY_PRODUCT' ? 'Uso interno en caldos (RN-DES-10)' : 'Salida por pedidos despachados (consolidado del día)', allowUnreleased: true });
      }
    }
    // hoy: canal de pollo en cámara y una orden liberada para registrar desde la tableta
    mkLot(G.TODAY, 24, 'su-GRANJA', 11.70); mkLot(G.TODAY, 18, avicola, 12.35);
    const o = G.pro.create({ order_type: 'CUTTING', line_id: 'pl-L1-COR', cutting_template_id: t.id, planned_output_kg: 24, planned_date: G.TODAY, supervisor_user_id: jefe && jefe.id, notes: 'Pedido especial de pechugas para restaurantes del domingo.' }, { seed: true, at: G.date.add(G.TODAY, -1) + 'T15:00', user: jefe && jefe.name });
    G.pro.release(o.id, { seed: true, at: G.date.add(G.TODAY, -1) + 'T16:30' });
    G.db.touch();
  }, 'DES despieces de pollo');

  /* =====================================================================
     Interfaz
     ===================================================================== */
  const scopedTemplates = () => G.scope.filter(G.db.all(T_T));
  const cutOrders = pred => G.scope.filter(G.db.where(T_O, o => o.order_type === 'CUTTING' && o.status !== 'VOIDED')).filter(pred || (() => true));
  const devBadge = (dev, alert) => dev == null ? badge('pendiente', '') : badge(pp(dev), alert ? 'bad' : Math.abs(dev) > G.param('des_cut_yield_alert_pp') * 0.6 ? 'warn' : 'ok');
  const proMissing = body => { body.appendChild(notice('El despiece se registra sobre órdenes CUTTING de PRO; activa PRO para usar esta pantalla.', 'warn')); };
  const lotCell = id => G.pro ? G.pro.lotCell(id) : (G.db.get('lots', id) || {}).code || '—';
  function picker(code, params, pred) {
    if (!G.pro) return { o: null, node: h('span') };
    if (!params || !params.id) { const ip = cutOrders(o => o.status === 'IN_PROGRESS' && (!pred || pred(o))).sort((a, b) => String(b.planned_date).localeCompare(a.planned_date))[0]; if (ip) params = { id: ip.id }; }
    return G.pro.orderPicker(code, params,x => x.order_type === 'CUTTING' && x.status !== 'VOIDED' && (!pred || pred(x)), { label: 'Despiece' });
  }
  function templatePicker(code, t, pred) {
    const list = scopedTemplates().filter(pred || (() => true)).sort((a, b) => String(a.code).localeCompare(b.code) || b.version - a.version);
    const sel = h('select', { class: 'input', style: 'max-width:100%', attrs: { 'aria-label': 'Plantilla', id: code + '-tpl' } }, list.map(x => h('option', { value: x.id, selected: t && x.id === t.id }, `${x.code} · ${tname(x)} · ${(TSTAT[x.status] || [x.status])[0]}`)));
    sel.addEventListener('change', () => G.go(code, { id: sel.value }));
    return h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;align-items:center' }, h('span', { class: 'small muted' }, 'Plantilla'), sel, t ? tbadge(t.status) : null);
  }
  function segBar(parts) {
    const tot = U.sum(parts, p => Math.max(0, p.v)) || 1;
    return h('div', { class: 'des-seg', attrs: { role: 'img', 'aria-label': parts.map(p => `${p.l} ${F.num(p.v, 2)}`).join(', ') } }, parts.filter(p => p.v > 0).map(p => h('i', { class: p.c, style: { width: (p.v / tot * 100) + '%' }, title: `${p.l}: ${F.num(p.v, 2)}` })));
  }
  const segLegend = parts => h('div', { class: 'legend' }, parts.map(p => h('span', null, h('i', { class: 'des-dot ' + p.c }), `${p.l} ${p.t || ''}`)));

  /* ---------- DES-01 Plantillas de despiece ---------- */
  function renderTemplates(el) {
    const body = page(el, { code: 'DES-01', title: nm('DES-01'), sub: 'Una plantilla por producto de entrada (canal o pieza) con el rendimiento estándar de cada corte. Solo una versión ACTIVA por producto (RN-DES-08); los despieces cerrados guardan la versión que usaron.', actions: [btn('Nueva plantilla', () => newTemplateModal(), { kind: 'primary', disabled: !canManage(), title: canManage() ? '' : 'Requiere des.template.manage' })] });
    const all = scopedTemplates();
    const useBy = U.groupBy(G.db.where(T_O, o => o.order_type === 'CUTTING' && o.status !== 'VOIDED'), 'cutting_template_id');
    const monthFrom = G.date.month(G.TODAY);
    const drafts = all.filter(t => t.status === 'DRAFT');
    body.appendChild(kpis([
      { label: 'Plantillas activas', value: all.filter(t => t.status === 'ACTIVE').length, sub: `${new Set(all.filter(t => t.status === 'ACTIVE').map(t => t.species)).size} especies cubiertas` },
      { label: 'Borradores', value: drafts.length, sub: `${drafts.filter(t => !validateTemplate(t.id).ok).length} no suman 100 % (RN-DES-01)`, tone: drafts.some(t => !validateTemplate(t.id).ok) ? 'warn' : '' },
      { label: 'Despieces cerrados en el mes', value: closedCuts({ from: monthFrom }).filter(o => G.scope.ok(o)).length, sub: 'desde ' + F.date(monthFrom) },
      { label: 'Tolerancia de suma', value: '± ' + F.pct(G.param('des_template_sum_tolerance_pct'), 1), sub: `balance de masa por defecto ${F.pct(G.param('des_mass_balance_tolerance_pct'), 1)}` },
    ]));
    body.appendChild(table({
      id: 'des01', rows: all.slice().sort((a, b) => String(a.code).localeCompare(b.code) || b.version - a.version), onRow: t => templateDrawer(t),
      filters: [{ key: 'species', label: 'Especie', options: SPECIES }, { key: 'status', label: 'Estado', options: Object.entries(TSTAT).map(([k, v]) => [k, v[0]]) }],
      columns: [
        { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Plantilla' }, { key: 'species', label: 'Especie', value: t => lbl(SPECIES, t.species) },
        { key: 'input', label: 'Producto de entrada', value: t => G.variantName(inputVariant(t)) }, { key: 'brand', label: 'Marca', value: t => G.brandName(t.brand_id) },
        { key: 'version', label: 'Versión', align: 'r', render: t => 'v' + t.version },
        { key: 'n', label: 'Cortes', align: 'r', value: t => lines(t.id).length },
        { key: 'sum', label: 'Suma', align: 'r', value: t => sumPct(t.id), render: t => { const v = validateTemplate(t.id); return badge(F.pct(v.sum, 2), Math.abs(v.sum - 100) <= v.tol ? 'ok' : 'bad'); } },
        { key: 'exp', label: 'Rend. esperado', align: 'r', value: t => expectedYield(t.id), render: t => F.pct(expectedYield(t.id), 1) },
        { key: 'tol', label: 'Tolerancia balance', align: 'r', render: t => F.pct(tolOf(t), 1) },
        { key: 'uses', label: 'Despieces', align: 'r', value: t => (useBy[t.id] || []).length },
        { key: 'status', label: 'Estado', render: t => tbadge(t.status) },
      ],
    }));
    body.appendChild(notice('D-DES-01: los rendimientos son los de la plantilla de demostración; se ajustan con los primeros 20 despieces de cada especie (DES-07 muestra el real).', 'info'));
  }
  function templateActions(t, close) {
    const done = r => { if (close) close(); return r; };
    return h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
      btn(t.status === 'DRAFT' ? 'Editar' : 'Ver en el editor', () => { if (close) close(); G.go('DES-02', { id: t.id }); }, { sm: true }),
      t.status === 'DRAFT' ? btn('Activar', () => run(() => done(activate(t.id)), `${tname(t)} activa; la versión anterior queda retirada (RN-DES-08)`), { sm: true, kind: 'primary', disabled: !canManage() }) : null,
      t.status !== 'DRAFT' ? btn('Nueva versión', () => { const r = run(() => newVersion(t.id), x => `Borrador v${x.version} creado`); if (r) { if (close) close(); G.go('DES-02', { id: r.id }); } }, { sm: true, disabled: !canManage() }) : null,
      t.status === 'ACTIVE' && G.screens['PRO-05'] ? btn('Planificar despiece', () => { if (close) close(); G.go('PRO-05', { template: t.id, type: 'CUTTING' }); }, { sm: true }) : null,
      t.status === 'ACTIVE' ? btn('Retirar', () => modal('Retirar ' + tname(t), b => { b.appendChild(notice('Sin plantilla activa no se crean órdenes de despiece de este producto (RN-PRO-01).', 'warn')); b.appendChild(h('textarea', { class: 'input', id: 'des-ret-why', placeholder: 'Motivo del retiro' })); }, [{ label: 'Cancelar' }, { label: 'Retirar', kind: 'danger', onClick: c => { const why = document.getElementById('des-ret-why').value; const r = run(() => retire(t.id, why), 'Plantilla retirada'); if (!r) return false; done(); } }]), { sm: true, kind: 'danger', disabled: !canManage() }) : null);
  }
  function templateDrawer(t) {
    drawer(tname(t), (b, close) => {
      const v = validateTemplate(t.id);
      b.appendChild(dl([['Código', t.code], ['Especie', lbl(SPECIES, t.species)], ['Producto de entrada', G.variantName(inputVariant(t))], ['Marca', G.brandName(t.brand_id)], ['Estado', tbadge(t.status)], ['Suma de rendimientos', `${F.pct(v.sum, 2)} (100 % ± ${F.num(v.tol, 1)})`], ['Rendimiento esperado', F.pct(expectedYield(t.id), 2)], ['Tolerancia de balance', F.pct(tolOf(t), 1)], ['Activada', t.activated_at ? `${F.datetime(t.activated_at)} · ${t.activated_by || ''}` : '—'], ['Retirada', t.retired_at ? `${F.datetime(t.retired_at)} · ${t.retired_by || ''}` : '—'], ['Notas', t.notes]]));
      if (!v.ok) b.appendChild(notice('RN-DES-01: ' + v.problems.join('; ') + '.', t.status === 'DRAFT' ? 'warn' : 'info'));
      b.appendChild(templateActions(t, close));
      b.appendChild(h('h3', null, 'Cortes'));
      b.appendChild(linesTable(t, false));
      b.appendChild(h('h3', null, 'Versiones'));
      b.appendChild(table({ id: 'des01v-' + t.id, rows: versionsOf(t), search: false, onRow: x => { close(); templateDrawer(x); }, columns: [{ key: 'version', label: 'Versión', render: x => 'v' + x.version }, { key: 'status', label: 'Estado', render: x => tbadge(x.status) }, { key: 'activated_at', label: 'Activada', render: x => x.activated_at ? F.date(x.activated_at.slice(0, 10)) : '—' }, { key: 'retired_at', label: 'Retirada', render: x => x.retired_at ? F.date(x.retired_at.slice(0, 10)) : '—' }, { key: 'exp', label: 'Rend. esperado', align: 'r', render: x => F.pct(expectedYield(x.id), 1) }, { key: 'uses', label: 'Despieces', align: 'r', value: x => G.db.where(T_O, o => o.cutting_template_id === x.id && o.status !== 'VOIDED').length }] }));
      b.appendChild(h('h3', null, 'Historial'));
      b.appendChild(h('div', { class: 'timeline' }, (t.history || []).slice().reverse().map(x => h('div', { class: 'tl-item' }, h('b', null, x.action), h('div', { class: 'small' }, x.detail || ''), h('div', { class: 'small muted' }, `${F.datetime(x.at)} · ${x.user || ''}`)))));
    }, { wide: true, code: 'DES-01' });
  }
  function newTemplateModal() {
    const inputs = G.db.where('product_variants', v => { const p = G.productOf(v.id); return p && v.status === 'ACTIVE' && v.sale_mode === 'KG' && (p.category_id === 'pc-MP' || /canal|pierna|media res/i.test(v.name)); }).map(v => [v.id, `${v.name} (${v.sku})`]);
    drawer('Nueva plantilla de despiece', (b, close) => {
      b.appendChild(form({
        id: 'des01n', values: { species: 'CUY', mass_balance_tolerance_pct: G.param('des_mass_balance_tolerance_pct') }, submitLabel: 'Crear borrador', onCancel: close,
        fields: [
          { key: 'code', label: 'Código (familia de versiones)', required: true, placeholder: 'PL-RES' }, { key: 'name', label: 'Nombre', required: true, placeholder: 'Pierna de res' },
          { key: 'species', label: 'Especie', type: 'select', required: true, options: SPECIES },
          { key: 'input_variant_id', label: 'Producto de entrada', type: 'select', required: true, options: inputs, help: 'D-DES-03: res y cerdo pueden partir de la pieza primaria (pierna, lomo).' },
          { key: 'mass_balance_tolerance_pct', label: 'Tolerancia de balance de masa (%)', type: 'number', min: 0.1, max: 10, help: 'RN-DES-04' },
          { key: 'notes', label: 'Notas', type: 'textarea' },
        ],
        onSubmit: x => { try { const t = createTemplate(x); toast(`Borrador ${t.code} v${t.version} creado: agrega los cortes`, 'ok'); close(); G.go('DES-02', { id: t.id }); return true; } catch (e) { return e.message; } },
      }));
    }, { code: 'DES-01' });
  }
  function linesTable(t, editable) {
    const ls = lines(t.id);
    return table({
      id: 'des-lines-' + t.id + (editable ? '-e' : ''), rows: ls, search: false, pageSize: 30,
      columns: [
        { key: 'seq', label: '#', align: 'r' }, { key: 'name', label: 'Corte' }, { key: 'output_variant_id', label: 'Variante de salida', value: l => l.output_variant_id ? G.variantName(l.output_variant_id) : '— (sin lote)' },
        { key: 'role', label: 'Rol', render: l => rbadge(l.role) }, { key: 'standard_yield_pct', label: 'Estándar', align: 'r', render: l => F.pct(l.standard_yield_pct, 2) },
        { key: 'ref', label: 'Precio ref. por kg', align: 'r', value: l => refPrice(l.output_variant_id), render: l => l.role === 'WASTE' ? '—' : refPrice(l.output_variant_id) != null ? F.money(refPrice(l.output_variant_id)) : badge('sin precio · RN-DES-07', 'bad') },
        { key: 'nrv_cost_per_kg', label: 'Costo adicional por kg', align: 'r', render: l => l.role === 'BY_PRODUCT' ? F.money(l.nrv_cost_per_kg) : '—' },
        { key: 'val', label: 'Base de reparto', align: 'r', render: l => { const p = refPrice(l.output_variant_id); return l.role === 'WASTE' ? 'sin costo' : p == null ? '—' : l.role === 'BY_PRODUCT' ? `VNR ${F.money(p - l.nrv_cost_per_kg)} por kg` : `mercado ${F.money(p)} por kg`; } },
      ],
      actions: editable ? l => [btn('Editar', () => lineDrawer(t, l), { sm: true, kind: 'ghost' }), btn('Quitar', () => confirm({ title: 'Quitar ' + l.name, message: 'La línea sale del borrador.', danger: true, confirmLabel: 'Quitar', onConfirm: () => run(() => removeLine(l.id), 'Línea quitada') }), { sm: true, kind: 'ghost' })] : null,
      footer: ['', 'Suma', '', '', { v: F.pct(sumPct(t.id), 2), align: 'r' }, '', '', ''],
    });
  }
  function variantOptions() { return G.db.where('product_variants', v => v.status === 'ACTIVE' && v.sale_mode !== 'UNIT').map(v => [v.id, `${v.name} (${v.sku})`]).sort((a, b) => a[1].localeCompare(b[1])); }
  function lineDrawer(t, l) {
    drawer(l ? 'Editar ' + l.name : 'Agregar corte', (b, close) => {
      const prev = h('div', { class: 'small muted' });
      const show = vals => { G.ui.clear(prev); const p = refPrice(vals.output_variant_id); prev.append(vals.role === 'WASTE' ? 'La merma no recibe costo (RN-DES-02).' : p == null ? 'Sin precio de referencia vigente: cárgalo en DES-03 (RN-DES-07).' : vals.role === 'BY_PRODUCT' ? `VNR = ${F.money(p)} − ${F.money(Number(vals.nrv_cost_per_kg) || 0)} = ${F.money(p - (Number(vals.nrv_cost_per_kg) || 0))} por kg; se resta del costo conjunto.` : `Valor de mercado ${F.money(p)} por kg: recibe costo según su valor relativo.`); };
      const v0 = l ? Object.assign({}, l) : { role: 'CO_PRODUCT', nrv_cost_per_kg: 0 };
      b.appendChild(form({
        id: 'des02l', values: v0, submitLabel: l ? 'Guardar' : 'Agregar', onCancel: close,
        fields: [
          { key: 'name', label: 'Nombre del corte', required: true }, { key: 'role', label: 'Rol', type: 'select', required: true, options: ROLES, onChange: (v, vals) => show(vals) },
          { key: 'output_variant_id', label: 'Variante de salida (no aplica a merma)', type: 'select', options: variantOptions(), onChange: (v, vals) => show(vals) },
          { key: 'standard_yield_pct', label: 'Rendimiento estándar (%)', type: 'number', required: true, min: 0.01, max: 100 },
          { key: 'nrv_cost_per_kg', label: 'Costo adicional de venta por kg (subproductos)', type: 'money', min: 0, onChange: (v, vals) => show(vals) },
          { key: 'notes', label: 'Notas', type: 'textarea' },
        ],
        onSubmit: x => { try { saveLine(t.id, Object.assign({}, x, { id: l && l.id })); toast(l ? 'Corte actualizado' : 'Corte agregado', 'ok'); close(); G.refresh(); return true; } catch (e) { return e.message; } },
      }));
      b.appendChild(prev); show(v0);
    }, { code: 'DES-02' });
  }

  /* ---------- DES-02 Editor de plantilla ---------- */
  function renderEditor(el, params = {}) {
    let t = params.id ? template(params.id) : null;
    if (t && !G.scope.ok(t)) t = null;
    const all = scopedTemplates();
    if (!t) t = all.find(x => x.status === 'DRAFT') || all.find(x => x.status === 'ACTIVE') || all[0];
    const body = page(el, { code: 'DES-02', title: nm('DES-02'), sub: 'Cortes de salida con su variante, rol, rendimiento estándar, precio de referencia y costo adicional para el VNR. La suma debe dar 100 % ± tolerancia para activar (RN-DES-01).', actions: t ? [templateActions(t)] : [] });
    if (!t) return body.appendChild(G.ui.empty('No hay plantillas en tu alcance.'));
    body.appendChild(templatePicker('DES-02', t));
    const v = validateTemplate(t.id);
    const co = rolePct(t.id, 'CO_PRODUCT'), by = rolePct(t.id, 'BY_PRODUCT'), wa = rolePct(t.id, 'WASTE');
    body.appendChild(kpis([
      { label: 'Suma de rendimientos', value: F.pct(v.sum, 2), sub: `debe ser 100 % ± ${F.num(v.tol, 1)} (RN-DES-01)`, tone: Math.abs(v.sum - 100) <= v.tol ? 'ok' : 'bad' },
      { label: 'Coproductos', value: F.pct(co, 2), sub: `${lines(t.id).filter(l => l.role === 'CO_PRODUCT').length} cortes` },
      { label: 'Subproductos', value: F.pct(by, 2), sub: 'se valorizan al VNR' }, { label: 'Merma estándar', value: F.pct(wa, 2), sub: 'no recibe costo' },
      { label: 'Rendimiento esperado', value: F.pct(expectedYield(t.id), 2), sub: 'coproductos + subproductos (PRO)' },
    ]));
    const parts = [{ l: 'Coproductos', v: co, c: 'co', t: F.pct(co, 1) }, { l: 'Subproductos', v: by, c: 'by', t: F.pct(by, 1) }, { l: 'Merma', v: wa, c: 'wa', t: F.pct(wa, 1) }, { l: 'Falta', v: Math.max(0, 100 - v.sum), c: 'gap', t: F.pct(Math.max(0, 100 - v.sum), 2) }];
    body.appendChild(card('Composición de 100 kg de entrada', h('div', { class: 'stack' }, segBar(parts), segLegend(parts), v.ok ? notice(`${tname(t)} cumple RN-DES-01${t.status === 'DRAFT' ? ': lista para activar' : ''}.`, 'ok') : notice('RN-DES-01: ' + v.problems.join('; ') + '.', 'bad'))));
    const grid = h('div', { class: 'grid c2 des-grid' });
    const editable = t.status === 'DRAFT' && canManage();
    grid.appendChild(card('Datos de la plantilla', t.status === 'DRAFT' && canManage() ? form({
      id: 'des02h', values: { name: t.name, species: t.species, mass_balance_tolerance_pct: tolOf(t), notes: t.notes }, submitLabel: 'Guardar datos',
      fields: [{ key: 'name', label: 'Nombre', required: true }, { key: 'species', label: 'Especie', type: 'select', required: true, options: SPECIES }, { key: 'mass_balance_tolerance_pct', label: 'Tolerancia de balance (%)', type: 'number', min: 0.1, max: 10, required: true }, { key: 'notes', label: 'Notas', type: 'textarea' }],
      onSubmit: x => { try { updateTemplate(t.id, x); toast('Plantilla guardada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } },
    }) : h('div', { class: 'stack' }, dl([['Código', t.code], ['Versión', 'v' + t.version], ['Estado', tbadge(t.status)], ['Producto de entrada', G.variantName(inputVariant(t))], ['Especie', lbl(SPECIES, t.species)], ['Tolerancia de balance', F.pct(tolOf(t), 1)], ['Notas', t.notes]]), notice(t.status === 'DRAFT' ? 'Solo el jefe de producción edita plantillas (des.template.manage).' : `RN-DES-08: una versión ${(TSTAT[t.status] || [''])[0].toLowerCase()} no se edita; crea una versión nueva.`, 'info'))));
    grid.appendChild(card('Simulación de costeo con el estándar', simulation(t)));
    body.appendChild(card('Cortes de salida', linesTable(t, editable), { actions: editable ? [btn('Agregar corte', () => lineDrawer(t, null), { sm: true, kind: 'primary' })] : [btn('Precios de referencia', () => G.go('DES-03'), { sm: true })] }));
    body.appendChild(grid);
  }
  function simulation(t) {
    const wrap = h('div', { class: 'stack' });
    const iv = inputVariant(t);
    const st = { kg: 20, cost: R(G.inv.avg(iv), 2), extra: 15 };
    const out = h('div');
    const draw = () => {
      G.ui.clear(out);
      const joint = R(st.kg * st.cost + st.extra);
      try {
        const a = allocate(joint, lines(t.id).map(l => ({ key: l.id, name: l.name, role: l.role, kg: st.kg * l.standard_yield_pct / 100, ref_price: refPrice(l.output_variant_id), nrv_cost: l.nrv_cost_per_kg, variant_id: l.output_variant_id })));
        out.appendChild(h('p', { class: 'small muted' }, `Costo conjunto ${money(joint)} · VNR de subproductos ${money(a.nrv_total)} · por repartir ${money(a.remaining)}`));
        out.appendChild(table({ id: 'des02s-' + t.id, rows: a.rows.filter(r => r.role !== 'WASTE'), search: false, columns: [{ key: 'name', label: 'Corte' }, { key: 'kg', label: 'Kg', align: 'r', render: r => F.num(r.kg, 3) }, { key: 'allocated', label: 'Costo asignado', align: 'r', render: r => money(r.allocated) }, { key: 'cost_per_kg', label: 'Costo por kg', align: 'r', render: r => money(r.cost_per_kg, 4) }, { key: 'm', label: 'Margen sobre ref.', align: 'r', render: r => r.ref_price ? F.pct((r.ref_price - r.cost_per_kg) / r.ref_price * 100, 1) : '—' }] }));
      } catch (e) { out.appendChild(notice(e.message, 'bad')); }
    };
    wrap.appendChild(form({ id: 'des02sim', values: st, submitLabel: false, fields: [
      { key: 'kg', label: 'Kg de entrada', type: 'number', min: 0.1, onChange: v => { st.kg = Number(v) || 0; draw(); } },
      { key: 'cost', label: `Costo por kg de ${G.variantName(iv)}`, type: 'money', min: 0, help: 'Costo promedio del inventario (G.inv.avg)', onChange: v => { st.cost = Number(v) || 0; draw(); } },
      { key: 'extra', label: 'Mano de obra y equipos (S/)', type: 'money', min: 0, onChange: v => { st.extra = Number(v) || 0; draw(); } },
    ] }));
    wrap.appendChild(out); draw();
    return wrap;
  }

  /* ---------- DES-03 Precios de referencia ---------- */
  function renderPrices(el) {
    const can = G.can('des.reference_price.manage');
    const body = page(el, { code: 'DES-03', title: nm('DES-03'), sub: 'Precio de mercado por kg de cada corte con vigencia: se toma de la lista de precios del canal web sin IGV (D-DES-02) o se escribe. Sin precio vigente el despiece no cierra (RN-DES-07).', actions: [btn('Actualizar desde la lista web', () => syncWeb(), { kind: 'primary', disabled: !can, title: can ? '' : 'Requiere des.reference_price.manage' })] });
    const rows = priceTargets().map(x => { const r = refRow(x.variant_id); const w = webPrice(x.variant_id); return Object.assign(x, { cur: r, price: r ? r.price_per_kg : null, web: w, diff: r && w ? R((r.price_per_kg - w) / w * 100, 1) : null, hist: G.db.where(T_P, p => p.variant_id === x.variant_id).length }); });
    const since = G.date.add(G.TODAY, -30);
    body.appendChild(kpis([
      { label: 'Cortes con precio vigente', value: `${rows.filter(r => r.price != null).length} de ${rows.length}`, tone: rows.some(r => r.price == null && r.active) ? 'bad' : 'ok', sub: 'de plantillas activas y en borrador' },
      { label: 'Sin precio (bloquean el cierre)', value: rows.filter(r => r.price == null && r.active).length, tone: rows.some(r => r.price == null && r.active) ? 'bad' : '', sub: 'RN-DES-07' },
      { label: 'Tomados de la lista web', value: rows.filter(r => r.cur && r.cur.source === 'WEB_LIST').length, sub: `${rows.filter(r => r.cur && r.cur.source === 'MANUAL').length} escritos a mano` },
      { label: 'Cambios en 30 días', value: G.db.where(T_P, p => p.valid_from >= since && p.status !== 'REPLACED').length, sub: 'desde ' + F.date(since) },
    ]));
    body.appendChild(table({
      id: 'des03', rows, onRow: r => priceDrawer(r.variant_id),
      filters: [{ key: 'role', label: 'Rol', value: r => [...r.roles].join(','), options: [['CO_PRODUCT', 'Coproducto'], ['BY_PRODUCT', 'Subproducto']] }, { key: 'src', label: 'Fuente', value: r => r.cur ? r.cur.source : 'NONE', options: [['WEB_LIST', 'Lista web'], ['MANUAL', 'Manual'], ['NONE', 'Sin precio']] }],
      columns: [
        { key: 'v', label: 'Corte (variante)', value: r => G.variantName(r.variant_id) }, { key: 'roles', label: 'Rol', render: r => h('span', { class: 'row', style: 'gap:4px' }, [...r.roles].map(rbadge)) },
        { key: 'tpl', label: 'Plantillas', value: r => [...r.templates].join(', ') },
        { key: 'price', label: 'Precio vigente por kg', align: 'r', render: r => r.price != null ? h('b', null, F.money(r.price)) : badge('sin precio', r.active ? 'bad' : 'warn') },
        { key: 'src', label: 'Fuente', value: r => r.cur ? (r.cur.source === 'WEB_LIST' ? 'Lista web' : 'Manual') : '—' },
        { key: 'from', label: 'Desde', render: r => r.cur ? F.date(r.cur.valid_from) : '—' },
        { key: 'web', label: 'Web sin IGV', align: 'r', render: r => r.web != null ? F.money(r.web) : '—' },
        { key: 'diff', label: 'Dif. con web', align: 'r', render: r => r.diff == null ? '—' : badge(`${r.diff > 0 ? '+' : ''}${F.num(r.diff, 1)} %`, Math.abs(r.diff) <= 5 ? 'ok' : 'warn') },
        { key: 'hist', label: 'Historial', align: 'r' },
      ],
      actions: r => [btn('Cambiar', () => priceForm(r.variant_id), { sm: true, kind: 'ghost', disabled: !can })],
    }));
    body.appendChild(notice('D-DES-02: valor provisional; el precio de referencia es el de la lista web sin IGV. Los cortes que no se venden en la web (paleta, huesos, grasa, menudencia) llevan precio escrito con su nota.', 'info'));
  }
  function syncWeb() {
    const ch = priceTargets().map(x => ({ x, w: webPrice(x.variant_id), r: refRow(x.variant_id) })).filter(z => z.w != null && (!z.r || Math.abs(z.r.price_per_kg - z.w) >= 0.005));
    if (!ch.length) return toast('Los precios tomados de la web ya están al día', 'info');
    confirm({ title: 'Actualizar desde la lista web', message: `${ch.length} corte(s) cambian al precio web sin IGV desde hoy: ${ch.map(z => `${G.variantName(z.x.variant_id)} ${F.money(z.w)}`).join(', ')}.`, confirmLabel: 'Actualizar', onConfirm: () => run(() => ch.forEach(z => setRefPrice({ variant_id: z.x.variant_id, price_per_kg: z.w, valid_from: G.TODAY, source: 'WEB_LIST', note: 'Lista web sin IGV (D-DES-02)' })), `${ch.length} precio(s) actualizados`) });
  }
  function priceForm(vid) {
    const w = webPrice(vid); const cur = refRow(vid);
    drawer('Precio de referencia · ' + G.variantName(vid), (b, close) => {
      b.appendChild(dl([['Precio vigente', cur ? `${F.money(cur.price_per_kg)} por kg desde ${F.date(cur.valid_from)}` : '—'], ['Lista web sin IGV', w != null ? F.money(w) + ' por kg' : 'No se vende en la web']]));
      b.appendChild(form({
        id: 'des03f', values: { price_per_kg: cur ? cur.price_per_kg : w, valid_from: G.TODAY, source: 'MANUAL', note: '' }, submitLabel: 'Guardar precio', onCancel: close,
        fields: [{ key: 'price_per_kg', label: 'Precio por kg (S/, sin IGV)', type: 'money', required: true, min: 0.01 }, { key: 'valid_from', label: 'Vigente desde', type: 'date', required: true }, { key: 'source', label: 'Fuente', type: 'select', required: true, options: [['MANUAL', 'Escrito (mercado, compra evitada)'], ['WEB_LIST', 'Lista web sin IGV']], onChange: (v, vals, api) => { if (v === 'WEB_LIST' && w != null) api.set('price_per_kg', w); } }, { key: 'note', label: 'Nota (de dónde sale el precio)', type: 'textarea' }],
        onSubmit: x => { try { setRefPrice(Object.assign({ variant_id: vid }, x)); toast('Precio de referencia guardado; el anterior queda en el historial', 'ok'); close(); G.refresh(); return true; } catch (e) { return e.message; } },
      }));
    }, { code: 'DES-03' });
  }
  function priceDrawer(vid) {
    drawer('Historial · ' + G.variantName(vid), (b, close) => {
      const hs = G.db.where(T_P, p => p.variant_id === vid).sort((a, c) => String(a.valid_from).localeCompare(c.valid_from) || String(a.created_at).localeCompare(c.created_at));
      const live = hs.filter(p => p.status === 'ACTIVE');
      if (live.length > 1) b.appendChild(G.ui.chart.line({ labels: live.map(p => F.date(p.valid_from)), series: [{ name: 'Precio por kg', values: live.map(p => p.price_per_kg) }], format: v => F.money(v), height: 180 }));
      b.appendChild(table({ id: 'des03h-' + vid, rows: hs.slice().reverse(), search: false, columns: [{ key: 'valid_from', label: 'Desde', render: p => F.date(p.valid_from) }, { key: 'valid_to', label: 'Hasta', render: p => p.valid_to ? F.date(p.valid_to) : 'vigente' }, { key: 'price_per_kg', label: 'Precio por kg', align: 'r', render: p => F.money(p.price_per_kg) }, { key: 'source', label: 'Fuente', value: p => p.source === 'WEB_LIST' ? 'Lista web' : 'Manual' }, { key: 'web_price_per_kg', label: 'Web sin IGV', align: 'r', render: p => p.web_price_per_kg != null ? F.money(p.web_price_per_kg) : '—' }, { key: 'status', label: 'Estado', render: p => p.status === 'REPLACED' ? badge('Reemplazado', '') : p.valid_to && p.valid_to < G.TODAY ? badge('Vencido', '') : badge('Vigente', 'ok') }, { key: 'note', label: 'Nota' }, { key: 'created_by', label: 'Cargado por' }] }));
      if (G.can('des.reference_price.manage')) b.appendChild(btn('Cambiar precio', () => { close(); priceForm(vid); }, { kind: 'primary', sm: true }));
    }, { wide: true, code: 'DES-03' });
  }

  /* ---------- DES-04 Despiece en curso (tableta) ---------- */
  function newOrderModal() {
    const tpls = scopedTemplates().filter(t => t.status === 'ACTIVE');
    drawer('Nueva orden de despiece', (b, close) => {
      b.appendChild(form({
        id: 'des04n', values: { template_id: (tpls[0] || {}).id, kg: 20, date: G.TODAY, release: true }, submitLabel: 'Crear orden', onCancel: close,
        fields: [{ key: 'template_id', label: 'Plantilla activa', type: 'select', required: true, options: tpls.map(t => [t.id, `${tname(t)} · ${G.variantName(inputVariant(t))}`]) }, { key: 'kg', label: 'Kg de entrada planificados', type: 'number', required: true, min: 0.1 }, { key: 'date', label: 'Fecha', type: 'date', required: true }, { key: 'release', label: 'Liberar a planta al crear', type: 'checkbox' }],
        onSubmit: x => {
          try {
            needPro(); const ln = G.db.find('production_lines', l => l.line_type === 'CUTTING' && l.status === 'ACTIVE' && (G.ctx.site === 'ALL' || l.establishment_id === G.ctx.site)) || G.db.find('production_lines', l => l.line_type === 'CUTTING');
            if (!ln) return 'RN-PRO-01: no hay una línea de cortes y despiece activa.';
            const o = G.pro.create({ order_type: 'CUTTING', line_id: ln.id, cutting_template_id: x.template_id, planned_output_kg: x.kg, planned_date: x.date, supervisor_user_id: G.ctx.userId() });
            if (x.release) G.pro.release(o.id);
            toast(`Orden ${o.number} creada${x.release ? ' y liberada' : ''}`, 'ok'); close(); G.go('DES-04', { id: o.id }); return true;
          } catch (e) { return e.message; }
        },
      }));
    }, { code: 'DES-04' });
  }
  function renderLive(el, params = {}) {
    const body = page(el, { code: 'DES-04', title: nm('DES-04'), sub: 'Desde la tableta de la sala de cortes: lote de canal que entra con su peso y, por cada corte, los kg pesados con su lote nuevo (en cuarentena, RN-PRO-05). Avisa al instante si un corte se aleja del estándar (RN-DES-05).', actions: [btn('Nueva orden de despiece', newOrderModal, { kind: 'primary', disabled: !G.can('pro.order.create') })] });
    if (!G.pro) return proMissing(body);
    const { o, node } = picker('DES-04', params);
    body.appendChild(node);
    if (!o) return body.appendChild(G.ui.empty('No hay órdenes de despiece en tu alcance.'));
    const t = template(o.cutting_template_id);
    if (!t) return body.appendChild(notice('La orden no tiene plantilla de despiece.', 'bad'));
    const active = ACTIVE_O.includes(o.status), canRec = G.can('pro.order.record');
    const mb = massBalance(o); const rows = cutRows(o);
    const raw = consOf(o.id).filter(c => c.role === 'RAW_MATERIAL');
    const sc = scaleFor(o.establishment_id);
    body.appendChild(kpis([
      { label: 'Entrada', value: kg3(mb.input_kg), sub: raw.length ? raw.map(c => (G.db.get('lots', c.lot_id) || {}).code).join(', ') : `planificado ${F.kg(o.planned_output_kg, 1)}` },
      { label: 'Pesado', value: kg3(mb.output_kg), sub: `${rows.filter(r => r.n).length} de ${rows.length} cortes` },
      { label: 'Diferencia', value: mb.input_kg ? `${kg3(mb.diff_kg)} · ${F.pct(mb.diff_pct, 2)}` : '—', sub: `tolerancia ${F.pct(mb.tolerance_pct, 1)} (RN-DES-04)`, tone: mb.input_kg && rows.every(r => r.n) ? (mb.ok ? 'ok' : 'bad') : '' },
      { label: 'Cortes fuera de estándar', value: rows.filter(r => r.alert).length, sub: `más de ${F.num(G.param('des_cut_yield_alert_pp'), 0)} puntos`, tone: rows.some(r => r.alert) ? 'bad' : 'ok' },
    ]));
    const tab = G.pro.phone(`${o.number} · ${t.name}`, c => {
      c.appendChild(h('div', { class: 'des-tile' }, h('div', { class: 'between' }, h('b', null, 'Entrada'), G.pro.statusBadge(o.status)), h('div', { class: 'small muted' }, `${G.variantName(inputVariant(t))} · ${tname(t)} · balanza ${sc ? sc.name : 'sin balanza calibrada'}`),
        raw.length ? raw.map(cn => { const l = G.db.get('lots', cn.lot_id); return h('div', { class: 'between small', style: 'gap:8px;flex-wrap:wrap' }, h('span', { class: 'mono' }, l ? l.code : '—'), h('span', null, `${kg3(cn.weight_kg)} · ${l && l.supplier_id ? G.supName(l.supplier_id) : '—'}`)); }) : null,
        active && canRec ? inputForm(o) : null));
      if (o.status === 'PLANNED') c.appendChild(h('div', { class: 'des-tile' }, notice('RN-PRO-04: la orden está planificada; libérala para registrar.', 'warn'), btn('Liberar a planta', () => run(() => G.pro.release(o.id), 'Orden liberada'), { kind: 'primary', disabled: !G.can('pro.order.create') })));
      for (const r of rows) c.appendChild(cutTile(o, r, active && canRec && mb.input_kg > 0));
      if (active && !canRec) c.appendChild(notice(`Tu rol (${G.roleName()}) no registra en planta (pro.order.record).`, 'info'));
      c.appendChild(h('div', { class: 'des-tile' }, h('div', { class: 'between' }, h('b', null, 'Balance'), mb.input_kg ? badge(F.pct(mb.diff_pct, 2), mb.ok ? 'ok' : 'warn') : badge('sin entrada', '')), segBar([{ v: mb.co_kg, c: 'co' }, { v: mb.by_kg, c: 'by' }, { v: mb.waste_kg, c: 'wa' }, { v: Math.max(0, mb.diff_kg), c: 'gap' }].map(p => Object.assign({ l: '' }, p))), btn('Balance y cierre', () => G.go('DES-05', { id: o.id }), { sm: true, kind: active ? 'primary' : '' })));
    });
    const side = [];
    side.push(card('Real frente al estándar', table({ id: 'des04d-' + o.id, rows, search: false, pageSize: 20, columns: [{ key: 'n', label: 'Corte', value: r => r.tl.name }, { key: 'r', label: 'Rol', render: r => rbadge(r.tl.role) }, { key: 'std', label: 'Estándar', align: 'r', render: r => F.pct(r.std, 2) }, { key: 'exp', label: 'Kg esperados', align: 'r', render: r => F.num(r.expected_kg, 3) }, { key: 'kg', label: 'Kg reales', align: 'r', render: r => r.n ? F.num(r.kg, 3) : '—' }, { key: 'real', label: 'Real', align: 'r', render: r => r.real != null ? F.pct(r.real, 2) : '—' }, { key: 'dev', label: 'Desviación', align: 'r', render: r => r.tl.role === 'WASTE' && r.dev != null ? badge(pp(r.dev), '') : devBadge(r.dev, r.alert) }] })));
    const outs = outsOf(o.id);
    side.push(card('Lotes nuevos', table({ id: 'des04o-' + o.id, rows: outs, search: false, pageSize: 20, empty: 'Aún no hay cortes pesados.', columns: [{ key: 'v', label: 'Producto', value: x => x.variant_id ? G.variantName(x.variant_id) : 'Merma' }, { key: 'role', label: 'Rol', render: x => rbadge(x.output_role) }, { key: 'lot', label: 'Lote', render: x => x.lot_id ? lotCell(x.lot_id) : (x.waste_reason || '—') }, { key: 'weight_kg', label: 'Kg', align: 'r', render: x => F.num(x.weight_kg, 3) }, { key: 'wh', label: 'Almacén', value: x => x.warehouse_id ? G.whName(x.warehouse_id) : '—' }, { key: 'uc', label: 'Costo por kg', align: 'r', render: x => x.lot_id ? money(x.allocated_cost != null ? x.allocated_cost / x.weight_kg : x.unit_cost * x.qty / x.weight_kg, 4) : '—' }, { key: 'at', label: 'Hora', render: x => String(x.at || '').slice(11, 16) }] })));
    side.push(card('Efecto en inventario', movesTable(o), { flush: true }));
    body.appendChild(G.pro.tabletWrap(tab, side));
  }
  function inputForm(o) {
    const lots = inputLots(o);
    const ok = lots.filter(x => !x.why);
    const wrap = h('div', { class: 'stack', style: 'gap:6px' });
    if (!lots.length) { wrap.appendChild(notice(`No hay lotes de ${G.variantName(inputVariant(template(o.cutting_template_id)))} en ${G.siteName(o.establishment_id)}. Recíbelos en ALM.`, 'warn')); return wrap; }
    const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Lote de canal', id: 'des04-lot' } }, lots.map((x, i) => h('option', { value: x.lot.id, disabled: !!x.why, selected: x === ok[0] }, `${x.lot.code} · ${F.num(x.b.qty, 3)} kg · vence ${F.date(x.lot.expiry_date)}${x.why ? ' · ' + x.why : i === lots.indexOf(ok[0]) ? ' · FEFO' : ''}`)));
    const kgIn = h('input', { class: 'input', type: 'number', placeholder: 'Kg en balanza', attrs: { step: 'any', min: 0, 'aria-label': 'Kg de entrada', id: 'des04-kg' } });
    const why = h('input', { class: 'input', placeholder: 'Motivo si no es el lote FEFO (RN-PRO-03)', attrs: { 'aria-label': 'Motivo FEFO', id: 'des04-why' } });
    wrap.append(sel, h('div', { class: 'des-in' }, kgIn, btn('Registrar entrada', () => run(() => registerInput(o.id, { lot_id: sel.value, weight_kg: kgIn.value, fefo_override_reason: why.value }), r => `Entrada registrada: ${kg3(r.weight_kg || (Array.isArray(r) ? U.sum(r, x => x.weight_kg) : 0))} (PRODUCTION_OUT)`), { kind: 'primary' })), why);
    return wrap;
  }
  function cutTile(o, r, can) {
    const tone = r.alert ? 'bad' : r.n ? 'ok' : '';
    const tile = h('div', { class: 'des-tile ' + tone },
      h('div', { class: 'between' }, h('b', null, r.tl.name), rbadge(r.tl.role)),
      h('div', { class: 'between small' }, h('span', { class: 'muted' }, `Estándar ${F.pct(r.std, 1)} · esperado ${F.num(r.expected_kg, 3)} kg`), r.tl.role === 'WASTE' ? (r.n ? badge(F.pct(r.real, 2), '') : null) : devBadge(r.dev, r.alert)),
      r.n ? h('div', { class: 'small' }, `Pesado ${kg3(r.kg)}${r.real != null ? ' · real ' + F.pct(r.real, 2) : ''}${r.outs.length > 1 ? ` en ${r.outs.length} pesadas` : ''}`) : null,
      r.alert ? h('div', { class: 'small', style: 'color:var(--bad)' }, `RN-DES-05: se aleja ${F.num(Math.abs(r.dev), 2)} puntos del estándar; al cerrar se avisa al jefe de producción.`) : null);
    if (can) {
      const kg = h('input', { class: 'input', type: 'number', placeholder: 'Kg', attrs: { step: 'any', min: 0, 'aria-label': 'Kg de ' + r.tl.name, id: 'des04-c-' + r.tl.id } });
      const why = r.tl.role === 'WASTE' ? h('input', { class: 'input', placeholder: 'Motivo de la merma', value: 'Hueso astillado, sangre y recortes', attrs: { 'aria-label': 'Motivo de merma' } }) : null;
      tile.appendChild(h('div', { class: 'des-in' }, kg, btn(r.tl.role === 'WASTE' ? 'Registrar' : 'Pesar', () => {
        try { const res = registerCut(o.id, { template_line_id: r.tl.id, weight_kg: kg.value, waste_reason: why && why.value }); const l = res.row.lot_id && G.db.get('lots', res.row.lot_id); if (res.dev && res.dev.alert) toast(`RN-DES-05: ${res.dev.name} rinde ${F.pct(res.dev.real, 2)} frente a ${F.pct(res.dev.std, 2)} estándar (${pp(res.dev.dev)})`, 'warn'); else toast(l ? `${r.tl.name}: lote ${l.code} en ${G.ui.statusLabel(l.qc_status).toLowerCase()} (PRODUCTION_IN)` : 'Merma registrada', 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); }
      }, { kind: r.n ? '' : 'primary' })));
      if (why) tile.appendChild(why);
    }
    return tile;
  }
  function movesTable(o) {
    const mv = G.db.where('stock_movements', m => m.source_id === o.id).sort(U.by('moved_at'));
    return table({ id: 'des-mv-' + o.id, rows: mv, search: false, pageSize: 12, empty: 'Sin movimientos de inventario todavía.', columns: [{ key: 'moved_at', label: 'Hora', render: m => F.datetime(m.moved_at) }, { key: 'movement_type', label: 'Movimiento', render: m => badge(m.movement_type, m.qty > 0 ? 'ok' : 'warn') }, { key: 'v', label: 'Producto', value: m => G.variantName(m.variant_id) }, { key: 'lot', label: 'Lote', value: m => (G.db.get('lots', m.lot_id) || {}).code, mono: true }, { key: 'qty', label: 'Cantidad', align: 'r', render: m => F.num(m.qty, 3) }, { key: 'unit_cost', label: 'Costo unit.', align: 'r', render: m => money(m.unit_cost, 4) }, { key: 'wh', label: 'Almacén', value: m => G.whName(m.warehouse_id) }] });
  }

  /* ---------- DES-05 Balance de masa ---------- */
  function renderBalance(el, params = {}) {
    const body = page(el, { code: 'DES-05', title: nm('DES-05'), sub: 'Kg de entrada = Σ cortes + subproductos + merma registrada. Fuera de la tolerancia de la plantilla el despiece no cierra salvo con el permiso des.mass_balance.override (RN-DES-04).' });
    if (!G.pro) return proMissing(body);
    const { o, node } = picker('DES-05', params);
    body.appendChild(node);
    if (!o) return body.appendChild(G.ui.empty('No hay órdenes de despiece en tu alcance.'));
    const t = template(o.cutting_template_id); const mb = massBalance(o); const rows = cutRows(o);
    body.appendChild(kpis([
      { label: 'Entrada', value: kg3(mb.input_kg) }, { label: 'Coproductos', value: kg3(mb.co_kg), sub: mb.input_kg ? F.pct(mb.co_kg / mb.input_kg * 100, 2) : '' },
      { label: 'Subproductos', value: kg3(mb.by_kg), sub: mb.input_kg ? F.pct(mb.by_kg / mb.input_kg * 100, 2) : '' }, { label: 'Merma registrada', value: kg3(mb.waste_kg), sub: mb.input_kg ? F.pct(mb.waste_kg / mb.input_kg * 100, 2) : '' },
      { label: 'Diferencia sin registrar', value: mb.input_kg ? kg3(mb.diff_kg) : '—', sub: mb.input_kg ? `${F.pct(mb.diff_pct, 2)} · tolerancia ${F.pct(mb.tolerance_pct, 1)}` : 'registra la entrada', tone: mb.input_kg ? (mb.ok ? 'ok' : 'bad') : '' },
    ]));
    const eq = h('div', { class: 'des-eq' }, h('span', null, h('b', null, kg3(mb.input_kg)), h('small', null, 'entrada')), '=', h('span', null, h('b', null, F.num(mb.co_kg, 3)), h('small', null, 'coproductos')), '+', h('span', null, h('b', null, F.num(mb.by_kg, 3)), h('small', null, 'subproductos')), '+', h('span', null, h('b', null, F.num(mb.waste_kg, 3)), h('small', null, 'merma')), mb.diff_kg >= 0 ? '+' : '−', h('span', { class: mb.ok ? '' : 'bad' }, h('b', null, F.num(Math.abs(mb.diff_kg), 3)), h('small', null, 'sin registrar')));
    const parts = [{ l: 'Coproductos', v: mb.co_kg, c: 'co', t: kg3(mb.co_kg) }, { l: 'Subproductos', v: mb.by_kg, c: 'by', t: kg3(mb.by_kg) }, { l: 'Merma', v: mb.waste_kg, c: 'wa', t: kg3(mb.waste_kg) }, { l: 'Sin registrar', v: Math.max(0, mb.diff_kg), c: 'gap', t: kg3(Math.max(0, mb.diff_kg)) }];
    body.appendChild(card(`Balance de ${o.number} · ${tname(t)}`, h('div', { class: 'stack' }, eq, segBar(parts), segLegend(parts), mb.input_kg ? notice(mb.ok ? `Dentro de la tolerancia: |${F.num(mb.diff_kg, 3)}| / ${F.num(mb.input_kg, 3)} = ${F.pct(mb.diff_pct, 2)} ≤ ${F.pct(mb.tolerance_pct, 1)}.` : `RN-DES-04: |${F.num(mb.diff_kg, 3)}| / ${F.num(mb.input_kg, 3)} = ${F.pct(mb.diff_pct, 2)} supera ${F.pct(mb.tolerance_pct, 1)}. Registra la merma o los cortes que faltan.`, mb.ok ? 'ok' : 'bad') : notice('Sin entrada registrada (DES-04).', 'warn'))));
    const grid = h('div', { class: 'grid c2 des-grid' });
    grid.appendChild(card('Por corte', table({ id: 'des05c-' + o.id, rows, search: false, columns: [{ key: 'n', label: 'Corte', value: r => r.tl.name }, { key: 'r', label: 'Rol', render: r => rbadge(r.tl.role) }, { key: 'exp', label: 'Esperado', align: 'r', render: r => F.num(r.expected_kg, 3) }, { key: 'kg', label: 'Real', align: 'r', render: r => F.num(r.kg, 3) }, { key: 'd', label: 'Diferencia', align: 'r', render: r => F.num(R(r.kg - r.expected_kg, 3), 3) }], footer: ['Total', '', { v: F.num(U.sum(rows, r => r.expected_kg), 3), align: 'r' }, { v: F.num(mb.output_kg, 3), align: 'r' }, { v: F.num(R(mb.output_kg - U.sum(rows, r => r.expected_kg), 3), 3), align: 'r' }] }), { flush: true }));
    grid.appendChild(card('Cierre del despiece', closePanel(o, mb)));
    body.appendChild(grid);
    const ss = stats(cutOrders(x => x.status === 'CLOSED' || ACTIVE_O.includes(x.status)).sort((a, b) => String(b.planned_date).localeCompare(a.planned_date)).slice(0, 80));
    body.appendChild(card('Balance de los despieces recientes', table({ id: 'des05l', rows: ss, onRow: s => G.go('DES-05', { id: s.o.id }), filters: [{ key: 'sp', label: 'Especie', value: s => s.species, options: SPECIES }, { key: 'st', label: 'Estado', value: s => s.o.status, options: [['IN_PROGRESS', 'En proceso'], ['RELEASED', 'Liberada'], ['CLOSED', 'Cerrada']] }], columns: [
      { key: 'num', label: 'Orden', value: s => s.o.number, mono: true }, { key: 'date', label: 'Fecha', value: s => s.date, render: s => F.date(s.date) }, { key: 'tpl', label: 'Plantilla', value: s => tname(s.t) },
      { key: 'in', label: 'Entrada', align: 'r', value: s => s.input_kg, render: s => F.num(s.input_kg, 3) }, { key: 'out', label: 'Registrado', align: 'r', value: s => R(s.co_kg + s.by_kg + s.waste_reg, 3), render: s => F.num(R(s.co_kg + s.by_kg + s.waste_reg, 3), 3) },
      { key: 'diff', label: 'Diferencia', align: 'r', value: s => s.input_kg ? R(Math.abs(s.input_kg - s.co_kg - s.by_kg - s.waste_reg) / s.input_kg * 100, 2) : null, render: s => { if (!s.input_kg) return '—'; const d = R(Math.abs(s.input_kg - s.co_kg - s.by_kg - s.waste_reg) / s.input_kg * 100, 2); return badge(F.pct(d, 2), d <= tolOf(s.t) ? 'ok' : 'bad'); } },
      { key: 'ov', label: 'Excepción', value: s => s.o.mass_balance_override_by ? G.userName(s.o.mass_balance_override_by) : '' }, { key: 'status', label: 'Estado', render: s => G.pro.statusBadge(s.o.status) },
    ] })));
  }
  function closePanel(o, mb) {
    const wrap = h('div', { class: 'stack' });
    if (o.status === 'CLOSED') {
      wrap.appendChild(notice(h('span', null, h('b', null, `Cerrada el ${F.date(o.close_date)} por ${o.closed_by}. `), `Balance ${F.pct(o.mass_balance_pct, 2)}${o.mass_balance_override_by ? ` cerrado con excepción de ${G.userName(o.mass_balance_override_by)}${o.mass_balance_override_reason ? ': ' + o.mass_balance_override_reason : ''}` : ''}. Costo conjunto ${money(o.joint_cost)} repartido en DES-06.`), 'ok'));
      if ((o.cut_alerts || []).length) wrap.appendChild(notice(`RN-DES-05: ${o.cut_alerts.map(a => `${a.name} ${pp(a.dev)}`).join(', ')}.`, 'warn'));
      wrap.appendChild(btn('Ver costeo conjunto', () => G.go('DES-06', { id: o.id }), { sm: true }));
      return wrap;
    }
    if (!ACTIVE_O.includes(o.status)) { wrap.appendChild(notice('RN-PRO-04: la orden no está liberada ni en proceso.', 'info')); return wrap; }
    const canClose = G.can('pro.order.close'), canOv = G.can('des.mass_balance.override');
    const c = G.pro.computeCost(o); const tol = G.param('pro_yield_tolerance_pp');
    const devBad = c.deviation != null && Math.abs(c.deviation) > tol;
    wrap.appendChild(dl([['Rendimiento real', `${F.pct(c.actual_yield, 2)} frente a ${F.pct(o.expected_yield_pct, 2)} (${pp(c.deviation)})`], ['Merma total', `${kg3(c.waste_kg)} · ${F.pct(c.waste_pct, 2)} (máx. ${F.pct(c.max_waste, 1)})`], ['Costo conjunto acumulado', money(c.total)]]));
    let preview = null; try { preview = allocateOrder(o); } catch (e) { wrap.appendChild(notice(e.message, 'bad')); }
    if (preview) wrap.appendChild(notice(`Al cerrar se repartirán ${money(preview.joint_cost)}: ${money(preview.nrv_total)} a subproductos por VNR y ${money(preview.remaining)} a coproductos por valor de mercado.`, 'info'));
    wrap.appendChild(form({
      id: 'des05f', values: { date: G.TODAY, yield_deviation_reason: '', waste_reason: '', override: false, override_reason: '' }, submitLabel: 'Cerrar despiece',
      fields: [{ key: 'date', label: 'Fecha de cierre', type: 'date', required: true }, { key: 'yield_deviation_reason', label: `Motivo de la desviación de rendimiento${devBad ? ' (obligatorio, RN-PRO-06)' : ''}`, type: 'textarea' }, { key: 'waste_reason', label: 'Motivo de la merma (si supera el máximo de la línea)', type: 'textarea' },
        !mb.ok && mb.input_kg ? { key: 'override', label: `Cerrar fuera de tolerancia (des.mass_balance.override)${canOv ? '' : ' · tu rol no tiene el permiso'}`, type: 'checkbox', disabled: !canOv } : null,
        !mb.ok && mb.input_kg ? { key: 'override_reason', label: 'Motivo de la excepción', type: 'textarea' } : null].filter(Boolean),
      onSubmit: x => {
        if (!canClose) return `RN-PRO-09: tu rol (${G.roleName()}) no cierra órdenes (pro.order.close).`;
        if (x.override && !(x.override_reason || '').trim()) return { override_reason: 'Escribe el motivo de la excepción (RN-DES-04).' };
        try { const r = closeCutting(o.id, x); toast(`Despiece ${r.number} cerrado: ${money(r.joint_cost)} repartidos${(r.cut_alerts || []).length ? ` · ${r.cut_alerts.length} alerta(s) RN-DES-05` : ''}`, (r.cut_alerts || []).length ? 'warn' : 'ok'); G.refresh(); return true; } catch (e) { return e.message; }
      },
    }));
    if (!canClose) wrap.appendChild(notice('El operario registra; el cierre lo hace el jefe de producción (RN-PRO-09).', 'info'));
    return wrap;
  }

  /* ---------- DES-06 Costeo conjunto ---------- */
  function allocationView(o) {
    o = order(o);
    const wrap = h('div', { class: 'stack' });
    if (!canCost()) { wrap.appendChild(notice('Tu rol no ve costos (pro.cost.view).', 'info')); return wrap; }
    if (!G.pro) { wrap.appendChild(notice('Requiere PRO.', 'warn')); return wrap; }
    const closed = o.status === 'CLOSED';
    const c = G.pro.computeCost(o);
    let a;
    try { a = allocate(closed ? o.total_cost : c.total, orderItems(o, null, closed), { date: despieceDate(o) }); }
    catch (e) { wrap.appendChild(notice(e.message, 'bad')); return wrap; }
    const co = a.rows.filter(r => r.role === 'CO_PRODUCT'), by = a.rows.filter(r => r.role === 'BY_PRODUCT');
    const big = a.rows.find(r => r.key === a.rounding_to);
    const extra = R(c.inp + c.pack);
    wrap.appendChild(h('ol', { class: 'des-steps' },
      h('li', null, h('b', null, 'Costo conjunto: '), `canal ${F.money(c.raw)} + mano de obra ${F.money(c.labor)} + equipos ${F.money(c.equip)}${extra ? ` + insumos y empaques ${F.money(extra)}` : ''} = `, h('b', null, F.money(a.joint_cost))),
      h('li', null, h('b', null, 'VNR de subproductos: '), by.length ? by.map(r => `${r.name} ${F.num(r.kg, 3)} kg × (${F.money(r.ref_price)} − ${F.money(r.nrv_cost)})`).join(' + ') + ' = ' : 'no hay subproductos = ', h('b', null, F.money(a.nrv_total))),
      h('li', null, h('b', null, 'Por repartir a coproductos: '), `${F.money(a.joint_cost)} − ${F.money(a.nrv_total)} = `, h('b', null, F.money(a.remaining))),
      h('li', null, h('b', null, 'Valor de mercado: '), co.map(r => `${r.name} ${F.num(r.kg, 3)} × ${F.money(r.ref_price)}`).join(' + ') + ' = ', h('b', null, F.money(a.market_total))),
      h('li', null, h('b', null, 'Redondeo (RN-DES-03): '), Math.abs(a.rounding_diff) >= 0.005 ? `cada importe a 2 decimales; la diferencia de ${F.money(a.rounding_diff)} va a ${big ? big.name : '—'} (mayor valor de mercado) para que la suma sea exactamente ${F.money(a.joint_cost)}.` : `cada importe a 2 decimales; la suma ya da ${F.money(a.joint_cost)} sin ajuste.`)));
    wrap.appendChild(table({
      id: 'des06-' + o.id, rows: a.rows, search: false, pageSize: 30,
      columns: [
        { key: 'name', label: 'Corte' }, { key: 'role', label: 'Rol', render: r => rbadge(r.role) }, { key: 'kg', label: 'Kg', align: 'r', render: r => F.num(r.kg, 3) },
        { key: 'ref_price', label: 'Precio ref.', align: 'r', render: r => r.ref_price != null ? F.money(r.ref_price) : '—' }, { key: 'nrv_cost', label: 'Costo adic.', align: 'r', render: r => r.role === 'BY_PRODUCT' ? F.money(r.nrv_cost) : '—' },
        { key: 'base', label: 'VNR o valor de mercado', align: 'r', render: r => r.role === 'BY_PRODUCT' ? F.money(r.nrv) : r.role === 'CO_PRODUCT' ? F.money(r.market_value) : '—' },
        { key: 'share', label: '% del valor', align: 'r', render: r => r.role === 'CO_PRODUCT' ? F.pct(r.share_pct, 2) : '—' },
        { key: 'calc', label: 'Cálculo', render: r => h('span', { class: 'small mono des-nw' }, r.role === 'CO_PRODUCT' ? `${F.num(a.remaining, 2)} × ${F.num(r.market_value, 2)} / ${F.num(a.market_total, 2)} = ${F.num(r.raw, 4)}${r.rounding ? ` ${r.rounding > 0 ? '+' : '−'} ${F.num(Math.abs(r.rounding), 2)}` : ''}` : r.role === 'BY_PRODUCT' ? `${F.num(r.kg, 3)} × ${F.num(r.nrv_unit, 2)}` : 'merma: sin costo') },
        { key: 'allocated', label: 'Asignado', align: 'r', render: r => h('b', { class: 'des-nw' }, F.money(r.allocated)) }, { key: 'cost_per_kg', label: 'Costo por kg', align: 'r', render: r => r.kg ? F.money(r.cost_per_kg, 4) : '—' },
        { key: 'lot', label: 'Lote', render: r => r.lot_id ? lotCell(r.lot_id) : '—' },
      ],
      footer: ['Total', '', { v: F.num(U.sum(a.rows, r => r.kg), 3), align: 'r' }, '', '', '', '', '', { v: h('b', null, F.money(U.sum(a.rows, r => r.allocated))), align: 'r' }, '', ''],
    }));
    wrap.appendChild(notice(closed ? `Costeo final del cierre del ${F.date(o.close_date)}: cada lote queda con su costo por kg en el inventario (revalorización con ADJUSTMENT).` : 'Vista previa con lo registrado hasta ahora; el reparto final se fija al cerrar (DES-05).', closed ? 'ok' : 'info'));
    return wrap;
  }
  function renderJoint(el, params = {}) {
    const body = page(el, { code: 'DES-06', title: nm('DES-06'), sub: 'Costo conjunto (canal + mano de obra + equipos), VNR de subproductos, reparto por valor de mercado relativo y costo por kg de cada corte, con el redondeo explicado (RN-DES-02, RN-DES-03). La merma no recibe costo.' });
    if (!G.pro) return proMissing(body);
    if (!params.id) { const last = cutOrders(x => x.status === 'CLOSED').sort((a, b) => String(b.close_date).localeCompare(a.close_date) || String(b.number).localeCompare(a.number))[0]; if (last) params = { id: last.id }; }
    const { o, node } = picker('DES-06', params);
    body.appendChild(node);
    if (!o) return body.appendChild(G.ui.empty('No hay órdenes de despiece en tu alcance.'));
    const c = G.pro.computeCost(o); const mb = massBalance(o);
    body.appendChild(kpis([
      { label: 'Costo conjunto', value: money(o.status === 'CLOSED' ? o.joint_cost : c.total), sub: `canal ${money(c.raw)}` },
      { label: 'VNR subproductos', value: money(o.status === 'CLOSED' ? o.nrv_total : (() => { try { return allocateOrder(o).nrv_total; } catch (e) { return null; } })()), sub: 'se resta del costo conjunto' },
      { label: 'Costo por kg de corte útil', value: money(o.status === 'CLOSED' ? o.cost_per_kg : null, 4), sub: `${kg3(mb.co_kg)} de coproductos`, tone: o.status === 'CLOSED' ? '' : 'info' },
      { label: 'Costo de la canal por kg', value: mb.input_kg ? money(c.raw / mb.input_kg, 4) : '—', sub: kg3(mb.input_kg) + ' de entrada' },
    ]));
    body.appendChild(card(`Reparto · ${o.number} · ${tname(template(o.cutting_template_id))}`, allocationView(o)));
    body.appendChild(card('Efecto en inventario', movesTable(o), { flush: true }));
  }

  /* ---------- DES-07 Rendimiento por corte ---------- */
  const ST = { sp: 'ALL', month: 'ALL', op: '', sup: '' };
  function filterBar(code, ss, extra = {}) {
    const months = [...new Set(ss.map(s => s.month))].sort();
    const sel = (key, label, options) => { const s = h('select', { class: 'input', style: 'width:auto;max-width:100%', attrs: { 'aria-label': label, id: code + '-' + key } }, h('option', { value: '' }, label + ': todos'), options.map(([v, l]) => h('option', { value: v, selected: ST[key] === v }, l))); s.addEventListener('change', () => { ST[key] = s.value; G.refresh(); }); return s; };
    return h('div', { class: 'stack', style: 'gap:8px' },
      pills([['ALL', 'Todas las especies'], ...SPECIES.filter(([k]) => ss.some(s => s.species === k))], ST.sp, v => { ST.sp = v; G.refresh(); }),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' }, h('select', { class: 'input', style: 'width:auto;max-width:100%', attrs: { 'aria-label': 'Mes', id: code + '-month' }, on: { change: e => { ST.month = e.target.value; G.refresh(); } } }, h('option', { value: 'ALL' }, 'Todos los meses'), months.map(m => h('option', { value: m, selected: ST.month === m }, G.date.monthName(m + '-01')))),
        extra.op !== false ? sel('op', 'Operario', [...new Set(ss.map(s => s.operator))].sort().map(x => [x, x])) : null,
        extra.sup !== false ? sel('sup', 'Proveedor', [...new Set(ss.map(s => s.supplier_id).filter(Boolean))].map(x => [x, G.supName(x)])) : null));
  }
  const applyST = (ss, opts = {}) => ss.filter(s => (ST.sp === 'ALL' || s.species === ST.sp) && (ST.month === 'ALL' || s.month === ST.month) && (opts.op === false || !ST.op || s.operator === ST.op) && (opts.sup === false || !ST.sup || s.supplier_id === ST.sup));
  function renderYield(el) {
    const body = page(el, { code: 'DES-07', title: nm('DES-07'), sub: `Rendimiento real frente al estándar por corte, especie, operario, proveedor de la canal y mes, de los despieces cerrados. Un corte se marca si se aleja más de ${F.num(G.param('des_cut_yield_alert_pp'), 0)} puntos (RN-DES-05).` });
    const all = stats(cutOrders(o => o.status === 'CLOSED'));
    body.appendChild(filterBar('DES-07', all));
    const ss = applyST(all);
    const detail = ss.flatMap(s => s.cuts.filter(c => c.tl.role !== 'WASTE').map(c => ({ id: s.o.id + c.tl.id, s, c })));
    const k1 = kpiYield(ss), k4 = kpiOut(ss);
    body.appendChild(kpis([
      { label: 'Despieces', value: ss.length, sub: F.kg(U.sum(ss, s => s.input_kg), 0) + ' de entrada' },
      { label: 'Rendimiento de coproductos', value: k1 ? F.pct(k1.numerator, 2) : '—', sub: k1 ? `estándar ${F.pct(k1.denominator, 2)} · ${pp(k1.value)}` : '', tone: k1 ? (Math.abs(k1.value) <= 1 ? 'ok' : 'warn') : '' },
      { label: 'Cortes fuera de estándar', value: k4 ? `${k4.numerator} de ${k4.denominator}` : '—', sub: k4 ? F.pct(k4.value, 1) : '', tone: k4 && k4.value > 10 ? 'bad' : 'ok' },
      { label: 'Alertas enviadas', value: U.sum(ss, s => (s.o.cut_alerts || []).length), sub: 'al jefe de producción' },
    ]));
    // agregado por plantilla y corte
    const agg = new Map();
    for (const d of detail) { const k = d.s.t.code + '|' + d.c.tl.name; const x = agg.get(k) || { id: k, sp: d.s.species, tpl: d.s.t.name, name: d.c.tl.name, role: d.c.tl.role, std: 0, kg: 0, inKg: 0, n: 0, alerts: 0, min: null, max: null, stdW: 0 }; x.n++; x.kg += d.c.kg; x.inKg += d.s.input_kg; x.stdW += d.c.std * d.s.input_kg; x.alerts += d.c.alert ? 1 : 0; x.min = x.min == null ? d.c.real : Math.min(x.min, d.c.real); x.max = x.max == null ? d.c.real : Math.max(x.max, d.c.real); agg.set(k, x); }
    const aggRows = [...agg.values()].map(x => Object.assign(x, { real: x.inKg ? R(x.kg / x.inKg * 100, 2) : null, std: x.inKg ? R(x.stdW / x.inKg, 2) : 0 })).map(x => Object.assign(x, { dev: x.real != null ? R(x.real - x.std, 2) : null }));
    if (ST.sp !== 'ALL' && aggRows.length) body.appendChild(card('Real frente al estándar', G.ui.chart.bar({ labels: aggRows.map(x => x.name), series: [{ name: 'Estándar', values: aggRows.map(x => x.std), color: 'var(--muted)' }, { name: 'Real', values: aggRows.map(x => x.real) }], format: v => F.pct(v, 1) })));
    body.appendChild(card('Por corte', table({ id: 'des07a', rows: aggRows, search: false, pageSize: 30, columns: [
      { key: 'sp', label: 'Especie', value: x => lbl(SPECIES, x.sp) }, { key: 'tpl', label: 'Plantilla' }, { key: 'name', label: 'Corte' }, { key: 'role', label: 'Rol', render: x => rbadge(x.role) }, { key: 'n', label: 'Despieces', align: 'r' },
      { key: 'std', label: 'Estándar', align: 'r', render: x => F.pct(x.std, 2) }, { key: 'real', label: 'Real ponderado', align: 'r', render: x => F.pct(x.real, 2) }, { key: 'dev', label: 'Desviación', align: 'r', render: x => devBadge(x.dev, Math.abs(x.dev) > G.param('des_cut_yield_alert_pp')) },
      { key: 'rng', label: 'Mín.–máx.', align: 'r', render: x => `${F.num(x.min, 1)}–${F.num(x.max, 1)} %` }, { key: 'alerts', label: 'Fuera de estándar', align: 'r', render: x => x.alerts ? badge(String(x.alerts), 'bad') : '0' },
    ] }), { flush: true }));
    body.appendChild(card('Detalle por despiece', table({ id: 'des07d', rows: detail, onRow: d => G.go('DES-06', { id: d.s.o.id }), filters: [{ key: 'al', label: 'Alerta', value: d => d.c.alert ? 'S' : 'N', options: [['S', 'Fuera de estándar'], ['N', 'Dentro']] }], columns: [
      { key: 'date', label: 'Fecha', value: d => d.s.date, render: d => F.date(d.s.date) }, { key: 'num', label: 'Orden', value: d => d.s.o.number, mono: true }, { key: 'tpl', label: 'Plantilla', value: d => tname(d.s.t) }, { key: 'cut', label: 'Corte', value: d => d.c.tl.name },
      { key: 'op', label: 'Operario', value: d => d.s.operator }, { key: 'sup', label: 'Proveedor', value: d => G.supName(d.s.supplier_id) }, { key: 'in', label: 'Entrada', align: 'r', value: d => d.s.input_kg, render: d => F.num(d.s.input_kg, 3) },
      { key: 'kg', label: 'Kg', align: 'r', value: d => d.c.kg, render: d => F.num(d.c.kg, 3) }, { key: 'real', label: 'Real', align: 'r', value: d => d.c.real, render: d => F.pct(d.c.real, 2) }, { key: 'std', label: 'Estándar', align: 'r', render: d => F.pct(d.c.std, 2) },
      { key: 'dev', label: 'Desviación', align: 'r', value: d => d.c.dev, render: d => devBadge(d.c.dev, d.c.alert) },
    ] })));
  }

  /* ---------- DES-08 Comparación de proveedores ---------- */
  function renderSuppliers(el) {
    const body = page(el, { code: 'DES-08', title: nm('DES-08'), sub: 'Rendimiento y costo por kg de corte útil por proveedor de la canal (camal, productores, Granja Don Guando): el más barato por kg de canal no siempre es el más barato por kg de corte vendible (KPI-DES-03).' });
    const all = stats(cutOrders(o => o.status === 'CLOSED'));
    body.appendChild(filterBar('DES-08', all, { sup: false }));
    const ss = applyST(all, { sup: false });
    const g = U.groupBy(ss, s => (s.supplier_id || 'NONE') + '|' + s.species);
    const rows = Object.entries(g).map(([k, xs]) => {
      const inK = U.sum(xs, s => s.input_kg), coK = U.sum(xs, s => s.co_kg);
      const y = kpiYield(xs), w = kpiWaste(xs), cst = kpiCost(xs);
      return { id: k, sup: xs[0].supplier_id, sp: xs[0].species, n: xs.length, inK: R(inK, 3), canal: inK ? R(U.sum(xs, s => s.input_cost) / inK, 4) : null, co_yield: inK ? R(coK / inK * 100, 2) : null, dev: y ? y.value : null, waste: w ? w.value : null, cpk: cst ? cst.value : null, nrv: inK ? R(U.sum(xs, s => s.by_alloc) / inK, 4) : null, alerts: U.sum(xs, s => (s.o.cut_alerts || []).length) };
    }).sort((a, b) => String(a.sp).localeCompare(b.sp) || (a.cpk || 0) - (b.cpk || 0));
    const best = {}; for (const r of rows) if (r.cpk != null && (!best[r.sp] || r.cpk < best[r.sp].cpk)) best[r.sp] = r;
    const multi = rows.filter(r => rows.filter(x => x.sp === r.sp).length > 1);
    body.appendChild(kpis([
      { label: 'Proveedores de canal', value: new Set(rows.map(r => r.sup)).size, sub: `${rows.length} combinaciones con especie` },
      { label: 'Especies con más de un proveedor', value: new Set(multi.map(r => r.sp)).size, sub: [...new Set(multi.map(r => lbl(SPECIES, r.sp)))].join(', ') || '—' },
      { label: 'Costo por kg de corte útil', value: (() => { const k = kpiCost(ss); return k ? money(k.value, 4) : '—'; })(), sub: 'KPI-DES-03 del filtro' },
    ]));
    body.appendChild(card('Por proveedor y especie', table({ id: 'des08', rows, search: false, pageSize: 30, columns: [
      { key: 'sup', label: 'Proveedor de la canal', value: r => r.sup ? G.supName(r.sup) : 'Sin proveedor', render: r => h('span', null, r.sup ? G.supName(r.sup) : 'Sin proveedor', best[r.sp] === r && multi.includes(r) ? h('span', null, ' ', badge('mejor costo útil', 'ok')) : null) },
      { key: 'sp', label: 'Especie', value: r => lbl(SPECIES, r.sp) }, { key: 'n', label: 'Despieces', align: 'r' }, { key: 'inK', label: 'Kg de canal', align: 'r', render: r => F.num(r.inK, 1) },
      { key: 'canal', label: 'Canal por kg', align: 'r', render: r => money(r.canal, 4) }, { key: 'co_yield', label: 'Rend. coproductos', align: 'r', render: r => F.pct(r.co_yield, 2) },
      { key: 'dev', label: 'Frente al estándar', align: 'r', render: r => r.dev == null ? '—' : badge(pp(r.dev), Math.abs(r.dev) <= 1 ? 'ok' : r.dev < 0 ? 'bad' : 'info') }, { key: 'waste', label: 'Merma', align: 'r', render: r => F.pct(r.waste, 2) },
      { key: 'nrv', label: 'VNR subprod. por kg canal', align: 'r', render: r => money(r.nrv, 4) }, { key: 'cpk', label: 'Costo por kg útil', align: 'r', render: r => h('b', null, money(r.cpk, 4)) }, { key: 'alerts', label: 'Alertas', align: 'r' },
    ] }), { flush: true }));
    if (rows.length && canCost()) body.appendChild(card('Costo por kg de corte útil', G.ui.chart.hbar({ items: rows.map(r => ({ label: `${lbl(SPECIES, r.sp)} · ${r.sup ? G.supName(r.sup) : '—'}`, value: r.cpk || 0, tone: best[r.sp] === r ? 'ok' : '' })), format: v => F.money(v, 2) })));
  }

  /* ---------- DES-09 Tablero de despiece ---------- */
  let dashPeriod = 'MONTH';
  function renderDash(el) {
    const body = page(el, { code: 'DES-09', title: nm('DES-09'), sub: 'KPI-DES-01 a KPI-DES-04 de los despieces cerrados, por especie, con las alertas de rendimiento y los despieces abiertos.' });
    const per = { MONTH: [G.date.month(G.TODAY), G.TODAY, 'Mes en curso'], PREV: [G.date.addMonths(G.date.month(G.TODAY), -1), G.date.add(G.date.month(G.TODAY), -1), 'Mes anterior'], D30: [G.date.add(G.TODAY, -29), G.TODAY, 'Últimos 30 días'] };
    body.appendChild(pills(Object.entries(per).map(([k, v]) => [k, v[2]]), dashPeriod, v => { dashPeriod = v; G.refresh(); }));
    const [from, to] = per[dashPeriod];
    const ss = stats(cutOrders(o => o.status === 'CLOSED' && o.close_date >= from && o.close_date <= to));
    const k1 = kpiYield(ss), k2 = kpiWaste(ss), k3 = kpiCost(ss), k4 = kpiOut(ss);
    const lim = G.param('des_cut_yield_alert_pp');
    body.appendChild(kpis([
      { label: 'KPI-DES-01 · Rendimiento frente al estándar', value: k1 ? pp(k1.value) : '—', sub: k1 ? `real ${F.pct(k1.numerator, 2)} · estándar ${F.pct(k1.denominator, 2)} · meta 0` : 'sin despieces', tone: k1 ? (Math.abs(k1.value) <= 1 ? 'ok' : 'warn') : '', onClick: () => G.go('DES-07') },
      { label: 'KPI-DES-02 · Merma de despiece', value: k2 ? F.pct(k2.value, 2) : '—', sub: k2 ? `${kg3(k2.numerator)} de ${F.kg(k2.denominator, 1)}` : '', tone: k2 && k2.value > 5 ? 'warn' : 'ok', onClick: () => G.go('DES-05') },
      { label: 'KPI-DES-03 · Costo por kg de corte útil', value: k3 ? money(k3.value, 4) : '—', sub: k3 ? `${money(k3.numerator)} / ${F.kg(k3.denominator, 1)}` : '', onClick: () => G.go('DES-08') },
      { label: 'KPI-DES-04 · Cortes fuera de estándar', value: k4 ? F.pct(k4.value, 1) : '—', sub: k4 ? `${k4.numerator} de ${k4.denominator} cortes (> ${F.num(lim, 0)} pp)` : '', tone: k4 && k4.value > 10 ? 'bad' : 'ok', onClick: () => G.go('DES-07') },
    ]));
    const bySp = U.groupBy(ss, 'species');
    const sps = SPECIES.filter(([k]) => bySp[k]);
    const grid = h('div', { class: 'grid c2 des-grid' });
    grid.appendChild(card('Merma por especie (KPI-DES-02)', sps.length ? G.ui.chart.bar({ labels: sps.map(s => s[1]), series: [{ name: 'Merma %', values: sps.map(([k]) => (kpiWaste(bySp[k]) || {}).value || 0) }], format: v => F.pct(v, 2) }) : G.ui.empty('Sin despieces cerrados en el período.')));
    grid.appendChild(card('Rendimiento frente al estándar por especie (KPI-DES-01)', sps.length ? G.ui.chart.hbar({ items: sps.map(([k, l]) => { const v = (kpiYield(bySp[k]) || {}).value || 0; return { label: l, value: v, tone: Math.abs(v) <= 1 ? 'ok' : v < 0 ? 'bad' : '' }; }), format: v => pp(v) }) : G.ui.empty('Sin datos.')));
    body.appendChild(grid);
    body.appendChild(card('Por especie', table({ id: 'des09s', rows: sps.map(([k, l]) => ({ id: k, k, l, xs: bySp[k] })), search: false, columns: [
      { key: 'l', label: 'Especie' }, { key: 'n', label: 'Despieces', align: 'r', value: r => r.xs.length }, { key: 'in', label: 'Kg de entrada', align: 'r', render: r => F.num(U.sum(r.xs, s => s.input_kg), 1) },
      { key: 'y', label: 'KPI-DES-01', align: 'r', render: r => pp((kpiYield(r.xs) || {}).value) }, { key: 'w', label: 'KPI-DES-02', align: 'r', render: r => F.pct((kpiWaste(r.xs) || {}).value, 2) },
      { key: 'c', label: 'KPI-DES-03', align: 'r', render: r => money((kpiCost(r.xs) || {}).value, 4) }, { key: 'o', label: 'KPI-DES-04', align: 'r', render: r => F.pct((kpiOut(r.xs) || {}).value, 1) },
    ] }), { flush: true }));
    const alerts = ss.flatMap(s => (s.o.cut_alerts || []).map((a, i) => ({ id: s.o.id + i, s, a }))).sort((x, y) => String(y.s.date).localeCompare(x.s.date));
    body.appendChild(card('Alertas de rendimiento (RN-DES-05)', table({ id: 'des09a', rows: alerts, search: false, pageSize: 10, empty: 'Sin cortes fuera de estándar en el período.', onRow: x => G.go('DES-06', { id: x.s.o.id }), columns: [
      { key: 'd', label: 'Fecha', render: x => F.date(x.s.date) }, { key: 'o', label: 'Orden', value: x => x.s.o.number, mono: true }, { key: 't', label: 'Plantilla', value: x => x.s.t.name }, { key: 'c', label: 'Corte', value: x => x.a.name },
      { key: 'r', label: 'Real', align: 'r', render: x => F.pct(x.a.real, 2) }, { key: 'st', label: 'Estándar', align: 'r', render: x => F.pct(x.a.std, 2) }, { key: 'dv', label: 'Desviación', align: 'r', render: x => badge(pp(x.a.dev), 'bad') },
      { key: 'op', label: 'Operario', value: x => x.a.operator }, { key: 'sup', label: 'Proveedor', value: x => G.supName(x.a.supplier_id) },
    ] })));
    const open = cutOrders(o => ['PLANNED', 'RELEASED', 'IN_PROGRESS'].includes(o.status));
    body.appendChild(card('Despieces abiertos', table({ id: 'des09o', rows: open, search: false, onRow: o => G.go('DES-04', { id: o.id }), empty: 'No hay despieces abiertos.', columns: [{ key: 'number', label: 'Orden', mono: true }, { key: 'planned_date', label: 'Fecha', render: o => F.date(o.planned_date) }, { key: 't', label: 'Plantilla', value: o => tname(template(o.cutting_template_id)) }, { key: 'kg', label: 'Kg planificados', align: 'r', render: o => F.num(o.planned_output_kg, 1) }, { key: 'mb', label: 'Registrado', align: 'r', render: o => { const m = massBalance(o); return m.input_kg ? `${F.num(m.output_kg, 3)} de ${F.num(m.input_kg, 3)}` : 'sin entrada'; } }, { key: 'status', label: 'Estado', render: o => G.pro ? G.pro.statusBadge(o.status) : o.status }] })));
  }

  G.des.allocationView = allocationView;
  G.register({
    code: 'DES', name: (G.SPEC.DES || {}).name || 'Despiece y costeo conjunto', phase: 2, group: 'Producción y calidad',
    screens: [
      { code: 'DES-01', name: nm('DES-01'), render: renderTemplates }, { code: 'DES-02', name: nm('DES-02'), render: renderEditor },
      { code: 'DES-03', name: nm('DES-03'), render: renderPrices }, { code: 'DES-04', name: nm('DES-04'), render: renderLive },
      { code: 'DES-05', name: nm('DES-05'), render: renderBalance }, { code: 'DES-06', name: nm('DES-06'), render: renderJoint },
      { code: 'DES-07', name: nm('DES-07'), render: renderYield }, { code: 'DES-08', name: nm('DES-08'), render: renderSuppliers },
      { code: 'DES-09', name: nm('DES-09'), render: renderDash },
    ],
  });

  /* ---------- búsqueda, escaneo y alertas ---------- */
  G.searchProviders.push(q => {
    const s = q.toLowerCase(); if (s.length < 2) return [];
    return scopedTemplates().filter(t => t.code.toLowerCase().includes(s) || t.name.toLowerCase().includes(s) || lbl(SPECIES, t.species).toLowerCase().includes(s)).slice(0, 5).map(t => ({ label: `${t.code} · ${tname(t)}`, sub: `Plantilla de despiece · ${(TSTAT[t.status] || [''])[0]} · ${F.pct(sumPct(t.id), 1)}`, go: () => G.go('DES-02', { id: t.id }) }));
  });
  G.scanHandlers.push(code => { const t = G.db.where(T_T, x => x.code.toUpperCase() === code).sort((a, b) => (b.status === 'ACTIVE') - (a.status === 'ACTIVE') || b.version - a.version)[0]; return t ? () => G.go('DES-02', { id: t.id }) : null; });
  G.alertProviders.push(() => {
    const out = [];
    const since = G.date.add(G.TODAY, -7);
    const recent = cutOrders(o => o.status === 'CLOSED' && o.close_date >= since && (o.cut_alerts || []).length);
    if (recent.length) out.push({ module: 'DES', title: `${U.sum(recent, o => o.cut_alerts.length)} corte(s) fuera de estándar en 7 días`, detail: recent.slice(0, 3).map(o => `${o.number}: ${o.cut_alerts.map(a => `${a.name} ${pp(a.dev)}`).join(', ')}`).join(' · ') + ' (RN-DES-05).', tone: 'warn', go: () => G.go('DES-07') });
    const noPrice = priceTargets().filter(x => x.active && refPrice(x.variant_id) == null);
    if (noPrice.length) out.push({ module: 'DES', title: `${noPrice.length} corte(s) sin precio de referencia`, detail: noPrice.slice(0, 3).map(x => G.variantName(x.variant_id)).join(', ') + ': el despiece no cierra (RN-DES-07).', tone: 'bad', go: () => G.go('DES-03') });
    const late = cutOrders(o => ACTIVE_O.includes(o.status) && o.planned_date < G.TODAY);
    if (late.length) out.push({ module: 'DES', title: `${late.length} despiece(s) sin cerrar de días anteriores`, detail: late.slice(0, 3).map(o => o.number).join(', ') + ': revisa el balance de masa.', tone: 'warn', go: () => G.go('DES-05', { id: late[0].id }) });
    return out;
  });

  /* ---------- pruebas de aceptación (CA-DES-01 … 05) ---------- */
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e.message; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code} y la acción pasó.`); };
  const asRole = (role, fn) => { const prev = G.ctx.role, ps = G.ctx.session; G.ctx.role = role; G.ctx.session = null; try { return fn(); } finally { G.ctx.role = prev; G.ctx.session = ps; } };
  const near = (a, b, m) => assert(Math.abs(a - b) < 0.005, `${m}: esperado ${b} y salió ${a}`);
  function testOrder(tplId, inKg, unitCost, { labor, saw } = {}) {
    const t = template(tplId); const vid = inputVariant(t); const p = G.productOf(vid);
    const lot = G.db.insert('lots', { product_id: p.id, variant_id: vid, code: 'T-DES-' + U.pad(G.db.next('DES-TEST', '', 1), 4), origin: 'PURCHASE', supplier_id: 'su-GRANJA', production_date: G.TODAY, expiry_date: G.date.add(G.TODAY, 4), qc_status: 'RELEASED', unit_cost: unitCost }, { silent: true });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-CAM-L1', variant: vid, lot: lot.id, qty: inKg, weight: inKg, unitCost, source: { type: 'TEST', id: 'CA-DES' }, at: G.TODAY + 'T06:00', reason: 'Prueba' });
    const o = G.pro.create({ order_type: 'CUTTING', line_id: 'pl-L1-COR', cutting_template_id: tplId, planned_output_kg: inKg, planned_date: G.TODAY });
    G.pro.release(o.id);
    registerInput(o.id, { lot_id: lot.id, weight_kg: inKg, warehouse_id: 'wh-CAM-L1', fefo_override_reason: 'Prueba CA (lote de prueba)' });
    if (labor) { const e = G.db.find('employees', x => x.establishment_id === 'es-L1'); G.pro.addLabor(o.id, { employee_id: e.id, task_role: 'CUTTER', hours: labor[0], hourly_rate: labor[1] }); }
    if (saw) { const eq = G.pro.equipmentList('es-L1').find(e => e.category === 'SAW' && e.status === 'ACTIVE') || G.pro.equipmentList('es-L1').find(e => e.status === 'ACTIVE' && e.category !== 'SCALE'); G.pro.addEquipment(o.id, { equipment_id: eq.id, hours: saw[0], hourly_rate: saw[1] }); }
    return o;
  }
  const lineOfV = (tplId, vid) => lines(tplId).find(l => vid ? l.output_variant_id === vid : l.role === 'WASTE');
  const CUTS = { pierna: 'va-DG-COR-PIE', costillar: 'va-DG-COR-COS', paleta: 'va-DG-COR-PAL', cuello: 'va-DG-COR-CUE', huesos: 'va-MP-HUE-KG', grasa: 'va-MP-COR-GRA', merma: null };
  function corderoCA(kgs) {
    const o = testOrder('ct-COR-1', 20.0, 22.00, { labor: [1, 12.50], saw: [0.5, 5.00] });
    const rows = {};
    for (const [k, kg] of Object.entries(kgs)) if (kg > 0) rows[k] = registerCut(o.id, { template_line_id: lineOfV('ct-COR-1', CUTS[k]).id, weight_kg: kg, waste_reason: 'Prueba CA' });
    return { o, rows };
  }
  const CA02 = { pierna: 6.0, costillar: 4.0, paleta: 4.5, cuello: 2.0, huesos: 2.5, grasa: 0.5, merma: 0.5 };
  const T = (name, fn) => G.tests.push({ module: 'DES', name, fn });
  T('CA-DES-01: «Cordero en canal» 31 + 20 + 22 + 10 + 12 + 3 + 2 = 100 % → ACTIVE; con merma 1 % (99 %) se rechaza con RN-DES-01', async () => {
    const mk = merma => { const t = createTemplate({ code: 'PL-COR-CA' + merma, name: 'Cordero en canal', species: 'CORDERO', input_variant_id: 'va-MP-COR-CAN' }); [['Pierna', 'va-DG-COR-PIE', 'CO_PRODUCT', 31], ['Costillar', 'va-DG-COR-COS', 'CO_PRODUCT', 20], ['Paleta', 'va-DG-COR-PAL', 'CO_PRODUCT', 22], ['Cuello y falda', 'va-DG-COR-CUE', 'CO_PRODUCT', 10], ['Huesos', 'va-MP-HUE-KG', 'BY_PRODUCT', 12, 1], ['Grasa', 'va-MP-COR-GRA', 'BY_PRODUCT', 3, 1], ['Merma', null, 'WASTE', merma]].forEach(([name, vid, role, pct, nrv]) => saveLine(t.id, { name, output_variant_id: vid, role, standard_yield_pct: pct, nrv_cost_per_kg: nrv || 0 })); return t; };
    const t = mk(2);
    assert(sumPct(t.id) === 100, 'La suma debe ser 100 % y salió ' + sumPct(t.id));
    activate(t.id);
    assert(template(t.id).status === 'ACTIVE', 'La plantilla debe quedar ACTIVE');
    assert(template('ct-COR-1').status === 'RETIRED', 'RN-DES-08: la versión activa anterior del mismo producto queda retirada');
    const bad = mk(1);
    assert(sumPct(bad.id) === 99, 'La suma con merma 1 % debe ser 99 %');
    expectFail(() => activate(bad.id), 'RN-DES-01');
    assert(template(bad.id).status === 'DRAFT', 'La plantilla rechazada sigue en borrador');
  });
  T('CA-DES-02: canal 20,0 kg × S/ 22 + 1 h × S/ 12,50 + 0,5 h × S/ 5 = S/ 455,00; VNR S/ 13,50 → pierna 192,41, costillar 108,33, paleta 112,25, cuello 28,51, huesos 12,50, grasa 1,00', async () => {
    const { o, rows } = corderoCA(CA02);
    const c = G.pro.computeCost(o);
    near(c.total, 455, 'Costo conjunto'); near(c.raw, 440, 'Costo de la canal');
    const a = allocateOrder(o);
    near(a.nrv_total, 13.5, 'VNR de subproductos'); near(a.remaining, 441.5, 'Por repartir');
    const r = closeCutting(o.id, {});
    assert(r.status === 'CLOSED', 'El despiece debe cerrar');
    const exp = { pierna: 192.41, costillar: 108.33, paleta: 112.25, cuello: 28.51, huesos: 12.50, grasa: 1.00 };
    for (const [k, v] of Object.entries(exp)) near(G.db.get(T_OUT, rows[k].row.id).allocated_cost, v, 'Asignado a ' + k);
    near(U.sum(outsOf(o.id), x => x.allocated_cost || 0), 455, 'Suma asignada (RN-DES-03)');
    near(r.nrv_total, 13.5, 'VNR guardado en la orden'); near(r.joint_cost, 455, 'Costo conjunto guardado');
    const bal = G.db.find('stock_balances', b => b.lot_id === rows.pierna.row.lot_id && b.qty > 0);
    assert(bal && Math.abs(bal.avg_cost * bal.qty - 192.41) < 0.01, 'El lote de pierna debe quedar en inventario a S/ 192,41 (revalorización)');
    assert(G.db.where('stock_movements', m => m.source_id === o.id && m.movement_type === 'PRODUCTION_OUT').length === 1 && G.db.where('stock_movements', m => m.source_id === o.id && m.movement_type === 'PRODUCTION_IN').length === 6, 'Debe haber 1 salida de canal y 6 lotes nuevos en el kardex');
  });
  T('CA-DES-03: 19,4 kg registrados de 20,0 kg (diferencia 3 %) → cerrar sin el permiso se rechaza con RN-DES-04', async () => {
    const { o } = corderoCA(Object.assign({}, CA02, { grasa: 0.4, merma: 0 }));
    const mb = massBalance(o);
    near(mb.output_kg, 19.4, 'Kg registrados'); near(mb.diff_pct, 3, 'Diferencia %');
    assert(!mb.ok && mb.tolerance_pct === 2, 'Debe quedar fuera de la tolerancia de 2 %');
    expectFail(() => closeCutting(o.id, {}), 'RN-DES-04');
    asRole('CALIDAD', () => expectFail(() => closeCutting(o.id, { override: true }), 'RN-DES-04'));
    assert(G.db.get(T_O, o.id).status === 'IN_PROGRESS', 'La orden sigue en proceso');
    const r = closeCutting(o.id, { override: true, override_reason: 'Prueba: goteo en cámara' });
    assert(r.status === 'CLOSED' && r.mass_balance_override_by, 'Con des.mass_balance.override cierra y registra quién');
  });
  T('CA-DES-04: pierna al 30,0 % frente a 31 % (−1 punto) → sin alerta; al 27 % (−4 puntos) → alerta RN-DES-05', async () => {
    const a = corderoCA(CA02);
    near(cutDeviation(a.o, a.rows.pierna.row).dev, -1, 'Desviación de la pierna');
    closeCutting(a.o.id, {});
    assert((G.db.get(T_O, a.o.id).cut_alerts || []).length === 0, 'Con −1 punto no debe haber alerta');
    const n0 = G.db.where('notifications', x => /RN-DES-05/.test(x.title)).length;
    const b = corderoCA(Object.assign({}, CA02, { pierna: 5.4, merma: 1.1 }));
    const dv = cutDeviation(b.o, b.rows.pierna.row);
    assert(dv.alert && dv.dev === -4 && dv.real === 27, `La pierna debe rendir 27 % (−4) y salió ${dv.real} (${dv.dev})`);
    closeCutting(b.o.id, { yield_deviation_reason: 'Prueba CA-DES-04' });
    const al = G.db.get(T_O, b.o.id).cut_alerts || [];
    assert(al.length === 1 && al[0].name === 'Pierna' && al[0].dev === -4 && al[0].operator && al[0].supplier_id === 'su-GRANJA', 'Debe crearse una alerta de la pierna con operario y proveedor');
    assert(G.db.where('notifications', x => /RN-DES-05/.test(x.title)).length > n0, 'Debe notificar al jefe de producción');
  });
  T('CA-DES-05: cuy entero con menudencia a S/ 1 400 por kg (precio mal cargado) → VNR mayor que el costo conjunto, cierre rechazado con RN-DES-06', async () => {
    setRefPrice({ variant_id: 'va-MP-CUY-MEN', price_per_kg: 1400, valid_from: G.TODAY, note: 'Precio mal cargado (debía ser 14,00)' });
    const o = testOrder('ct-CUY-1', 10.0, 24.00);
    const L = vid => lineOfV('ct-CUY-1', vid).id;
    registerCut(o.id, { template_line_id: L('va-DG-CUY-DES'), weight_kg: 6.6 });
    registerCut(o.id, { template_line_id: L('va-MP-HUE-KG'), weight_kg: 2.2 });
    registerCut(o.id, { template_line_id: L('va-MP-CUY-MEN'), weight_kg: 0.8 });
    registerCut(o.id, { template_line_id: L(null), weight_kg: 0.4, waste_reason: 'Prueba' });
    assert(massBalance(o).ok, 'El balance debe estar dentro de la tolerancia');
    const msg = expectFail(() => closeCutting(o.id, {}), 'RN-DES-06');
    assert(/Menudencia/.test(msg), 'El mensaje debe señalar la menudencia: ' + msg);
    assert(G.db.get(T_O, o.id).status === 'IN_PROGRESS', 'El despiece no cierra');
  });
})();
