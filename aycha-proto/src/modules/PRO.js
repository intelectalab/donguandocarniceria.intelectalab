/* =====================================================================
   PRO · Órdenes de producción (Fase 2)
   Líneas por local → plan semanal (MRP simple) → orden RECIPE / CUTTING /
   PACKING → consumo por lote con FEFO (PRODUCTION_OUT) → puntos de control →
   producción en lote nuevo en cuarentena (PRODUCTION_IN) → personal y
   equipos → cierre con costo real por kg (production_order.closed).
   Expone G.pro.create, release, consume, output, reading, addLabor,
   addEquipment, computeCost, close, void, theoretical, unitKg, lines,
   equipmentList, equipUsable, ensureCatalog.
   ===================================================================== */
(function () {
  'use strict';
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, form, toast, confirm, modal, tabs: uiTabs, pills } = G.ui;

  /* pestañas como hijo de una grilla: min-width 0 para que su tabla haga scroll propio y no desborde a 390 px */
  const tabs = (...a) => { const t = uiTabs(...a); t.style.minWidth = '0'; return t; };
  const U = G.util, F = G.fmt;
  const R = (n, d = 2) => U.round(n, d);
  const T_L = 'production_lines', T_O = 'production_orders', T_C = 'production_order_consumptions', T_OUT = 'production_order_outputs', T_LAB = 'production_order_labor', T_EQ = 'production_order_equipment', T_CCP = 'production_ccp_readings';
  const lbl = (arr, v) => (arr.find(x => x[0] === v) || [v, v || '—'])[1];
  const ORDER_TYPES = [['RECIPE', 'Receta'], ['CUTTING', 'Despiece'], ['PACKING', 'Porcionado y vacío']];
  const LINE_TYPES = [['CUTTING', 'Cortes y despiece'], ['VACUUM_PACK', 'Empaque al vacío'], ['LARD', 'Mantecas'], ['BROTH', 'Caldos'], ['SAUSAGE', 'Embutidos'], ['JAM', 'Mermeladas'], ['OTHER', 'Otra']];
  const C_ROLES = [['RAW_MATERIAL', 'Materia prima'], ['INPUT', 'Insumo'], ['PACKAGING', 'Empaque']];
  const O_ROLES = [['MAIN', 'Producto principal'], ['CO_PRODUCT', 'Coproducto'], ['BY_PRODUCT', 'Subproducto'], ['WASTE', 'Merma']];
  const TASKS = [['CUTTER', 'Despostador'], ['PACKER', 'Empacador'], ['COOK', 'Cocinero'], ['SAUSAGE_MAKER', 'Embutidor'], ['QUALITY', 'Control de calidad'], ['HELPER', 'Ayudante'], ['SUPERVISOR', 'Supervisor']];
  const OSTAT = { PLANNED: ['Planificada', 'info'], RELEASED: ['Liberada', 'info'], IN_PROGRESS: ['En proceso', 'warn'], CLOSED: ['Cerrada', 'ok'], VOIDED: ['Anulada', 'bad'] };
  const ost = s => badge((OSTAT[s] || [s])[0], (OSTAT[s] || [])[1] || '');
  const OPEN = ['PLANNED', 'RELEASED', 'IN_PROGRESS'];
  const ACTIVE = ['RELEASED', 'IN_PROGRESS'];
  const run = (fn, ok) => { try { const r = fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); if (!(e instanceof G.RuleError)) console.error(e); return null; } };
  const ord = id => G.db.get(T_O, id);
  const lineOf = id => G.db.get(T_L, id);
  const consOf = id => G.db.where(T_C, c => c.order_id === id);
  const outsOf = id => G.db.where(T_OUT, c => c.order_id === id);
  const labOf = id => G.db.where(T_LAB, c => c.order_id === id);
  const eqOf = id => G.db.where(T_EQ, c => c.order_id === id);
  const ccpOf = id => G.db.where(T_CCP, c => c.order_id === id);
  const canCost = () => G.can('pro.cost.view');
  const money = v => canCost() ? F.money(v) : '•••';
  const kg3 = v => F.kg(v, 3);

  /* ---------- catálogo adicional de producción (materia prima de despiece, insumos y aditivos) ---------- */
  // [sku, código de producto, marca, categoría, nombre, conservación, vida útil, costo estándar, modo, vendible]
  const EXTRA = [
    ['MP-CER-REC', 'MP-CERR', 'M3', 'MP', 'Recortes de cerdo para embutido', 'CHILLED', 4, 18.40],
    ['MP-CER-GRA', 'MP-CERG', 'M4', 'MP', 'Grasa dorsal de cerdo', 'CHILLED', 5, 9.00],
    ['MP-CER-PIE', 'MP-CERP', 'M3', 'MP', 'Pierna de cerdo para jamón', 'CHILLED', 5, 16.50],
    ['MP-CER-SAN', 'MP-CERS', 'M3', 'MP', 'Sangre de cerdo', 'CHILLED', 2, 3.50],
    ['MP-CUY-MEN', 'MP-CUYM', 'DG', 'MP', 'Menudencia de cuy', 'CHILLED', 3, 12.00],
    ['MP-GAL-CAR', 'MP-GALC', 'M4', 'MP', 'Carcasa de gallina para caldo', 'FROZEN', 30, 6.00],
    ['MP-COR-CAN', 'MP-COR', 'DG', 'MP', 'Cordero en canal', 'CHILLED', 5, 22.00],
    ['MP-COR-GRA', 'MP-CORG', 'DG', 'MP', 'Grasa de cordero', 'CHILLED', 5, 3.00],
    ['DG-COR-PAL', 'COR-PAL', 'DG', 'CORDERO', 'Paleta de cordero', 'CHILLED', 7, 26.00],
    ['DG-COR-CUE', 'COR-CUE', 'DG', 'CORDERO', 'Cuello y falda de cordero', 'CHILLED', 7, 14.00],
    ['IN-NIT-KG', 'IN-NIT', 'M3', 'INSUMOS', 'Nitrito de sodio (SIN 250)', 'AMBIENT', 720, 38.00],
    ['IN-ERI-KG', 'IN-ERI', 'M3', 'INSUMOS', 'Eritorbato de sodio (SIN 316)', 'AMBIENT', 720, 32.00],
    ['IN-FOS-KG', 'IN-FOS', 'M3', 'INSUMOS', 'Fosfato para salmuera (SIN 451i)', 'AMBIENT', 720, 14.00],
    ['IN-PEC-KG', 'IN-PEC', 'M5', 'INSUMOS', 'Pectina cítrica (SIN 440)', 'AMBIENT', 720, 95.00],
    ['IN-CIT-KG', 'IN-CIT', 'M5', 'INSUMOS', 'Ácido cítrico (SIN 330)', 'AMBIENT', 720, 9.50],
    ['IN-SOR-KG', 'IN-SOR', 'M5', 'INSUMOS', 'Sorbato de potasio (SIN 202)', 'AMBIENT', 720, 42.00],
    ['IN-AJI-KG', 'IN-AJI', 'M3', 'INSUMOS', 'Ají panca molido', 'AMBIENT', 180, 12.00],
    ['IN-AJO-KG', 'IN-AJO', 'DG', 'INSUMOS', 'Ajo molido', 'CHILLED', 15, 11.00],
    ['IN-VIN-KG', 'IN-VIN', 'M3', 'INSUMOS', 'Vinagre tinto', 'AMBIENT', 365, 3.48],
    ['IN-AGUA-KG', 'IN-AGUA', 'DG', 'INSUMOS', 'Agua potable y hielo', 'AMBIENT', 1, 0.05],
    ['IN-VER-KG', 'IN-VER', 'DG', 'INSUMOS', 'Verduras para caldo (apio, poro, zanahoria)', 'CHILLED', 7, 3.20],
    ['IN-FRE-KG', 'IN-FRE', 'M5', 'INSUMOS', 'Fresa fresca', 'CHILLED', 6, 6.50],
    ['IN-CEB-KG', 'IN-CEB', 'M3', 'INSUMOS', 'Cebolla blanca picada', 'CHILLED', 5, 2.80],
  ];
  function ensureCatalog() {
    let n = 0;
    for (const [sku, pc, br, cat, name, storage, life, cost] of EXTRA) {
      const pid = 'pr-' + pc, vid = 'va-' + sku, goods = cat === 'CORDERO';
      if (!G.db.get('products', pid)) G.db.insert('products', { id: pid, brand_id: 'br-' + br, category_id: 'pc-' + cat, code: pc, name, line: goods ? 'CORDERO' : 'OTROS', product_type: goods ? 'GOODS' : 'INPUT', origin: goods ? 'PRODUCED' : 'RAW_MATERIAL', storage, shelf_life_days: life, requires_lot: sku !== 'IN-AGUA-KG', igv_affectation: '10', sanitary_authority: cat === 'INSUMOS' ? 'NONE' : 'SENASA', sanitary_registry: null, status: 'ACTIVE', web_publishable: false, allow_discount: false, source_module: 'PRO' }, { silent: true });
      if (!G.db.get('product_variants', vid)) G.db.insert('product_variants', { id: vid, product_id: pid, brand_id: 'br-' + br, sku, name, barcode: '7759' + U.pad(4100 + (n++) * 37, 9), uom_id: 'um-KGM', sale_mode: 'KG', nominal_weight_kg: null, weight_tolerance_pct: 5, min_weight_kg: null, max_weight_kg: null, scale_plu: null, status: 'ACTIVE', web_publishable: false, min_order_qty: 0.5, qty_step: 0.25, std_cost: cost, sellable: false, line: goods ? 'CORDERO' : 'OTROS' }, { silent: true });
    }
  }

  /* ---------- equipos (EQU es dueño de `equipment`; respaldo propio si EQU no está o aún no sembró) ---------- */
  // código, nombre, categoría, local, carga S/ por hora, estado, calibración vigente hasta (balanzas)
  const EQF = [
    ['EQ-SIE-L1', 'Sierra de cinta', 'SAW', 'es-L1', 5.00], ['EQ-MOL-L1', 'Molino de carne N.° 22', 'GRINDER', 'es-L1', 3.00],
    ['EQ-EMB-L1', 'Embutidora manual 15 L', 'STUFFER', 'es-L1', 4.00], ['EQ-SEL-L1', 'Selladora al vacío de cámara', 'SEALER', 'es-L1', 2.50],
    ['EQ-AHU-L1', 'Ahumador artesanal', 'OTHER', 'es-L1', 3.00], ['EQ-BAL-L1', 'Balanza de plataforma 150 kg', 'SCALE', 'es-L1', 0, 'ACTIVE', '2026-12-15'],
    ['EQ-BAL-L1B', 'Balanza de mesa 30 kg', 'SCALE', 'es-L1', 0, 'ACTIVE', '2026-10-05'],
    ['EQ-MAR-L2', 'Marmita de 100 L', 'POT', 'es-L2', 3.50], ['EQ-COC-L2', 'Cocina industrial de 3 hornillas', 'STOVE', 'es-L2', 2.00],
    ['EQ-OLL-L2', 'Olla de acero 60 L', 'POT', 'es-L2', 0.80], ['EQ-TOS-L2', 'Tostadora de café 5 kg', 'OTHER', 'es-L2', 6.00],
    ['EQ-MOC-L2', 'Molino de café', 'GRINDER', 'es-L2', 1.50], ['EQ-SEL-L2', 'Selladora al vacío de mesa', 'SEALER', 'es-L2', 2.00, 'OUT_OF_SERVICE'],
    ['EQ-SEL-L2B', 'Selladora de banda continua', 'SEALER', 'es-L2', 1.80], ['EQ-BAL-L2', 'Balanza de mesa 60 kg', 'SCALE', 'es-L2', 0, 'ACTIVE', '2027-01-20'],
  ];
  const EQ_FALLBACK = EQF.map(([code, name, category, est, rate, st, cal]) => ({ id: 'eq-' + code, code, name, category, establishment_id: est, hourly_rate: rate, status: st || 'ACTIVE', requires_calibration: category === 'SCALE', calibration_valid_until: cal || null, source: 'PRO' }));
  function calUntil(eqId) { const c = G.db.where('equipment_calibrations', x => x.equipment_id === eqId && x.result === 'PASS').sort(U.by('valid_until', -1))[0]; return c ? c.valid_until : null; }
  function equTable() { return G.db.all('equipment').map(e => ({ id: e.id, code: e.code, name: e.name, category: e.category, establishment_id: e.establishment_id, hourly_rate: Number(e.hourly_rate) || 0, status: e.status, requires_calibration: !!e.requires_calibration || e.category === 'SCALE', calibration_valid_until: calUntil(e.id), source: 'EQU' })); }
  function equipmentList(site) { const t = equTable(); const list = t.length ? t : EQ_FALLBACK; return site ? list.filter(e => e.establishment_id === site) : list; }
  function equipmentOf(id) { return equTable().find(e => e.id === id) || EQ_FALLBACK.find(e => e.id === id) || null; }
  const eqName = id => { const e = equipmentOf(id); return e ? e.name : '—'; };
  function equipUsable(eq, date = G.TODAY) {
    if (typeof eq === 'string') eq = equipmentOf(eq);
    if (!eq) G.fail('RN-PRO-15', 'Equipo no encontrado.');
    if (eq.status !== 'ACTIVE') G.fail('RN-PRO-15', `${eq.name} (${eq.code}) está ${eq.status === 'OUT_OF_SERVICE' ? 'fuera de servicio' : 'dado de baja'} (RN-EQU-03): no se registra en la orden. Usa otro equipo o cierra su mantenimiento en EQU.`);
    if (eq.requires_calibration && (!eq.calibration_valid_until || eq.calibration_valid_until < date)) G.fail('RN-PRO-15', `${eq.name} (${eq.code}) tiene la calibración vencida${eq.calibration_valid_until ? ' desde el ' + F.date(eq.calibration_valid_until) : ''} (RN-EQU-04): no se usa como balanza. Calíbrala en EQU o usa otra.`);
    return true;
  }

  /* ---------- utilidades de producto ---------- */
  function unitKg(vid) {
    const v = G.variant(vid); if (!v) return 1;
    if (v.sale_mode === 'KG') return 1;
    if (v.nominal_weight_kg) return v.nominal_weight_kg;
    const m = /(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml)\b/i.exec(v.name);
    if (m) { const n = Number(m[1].replace(',', '.')); const u = m[2].toLowerCase(); return u === 'g' || u === 'ml' ? n / 1000 : n; }
    return 1;
  }
  function roleOf(vid) {
    const p = G.productOf(vid); const v = G.variant(vid);
    if (!p) return 'INPUT';
    if (p.category_id === 'pc-EMPAQUES') return 'PACKAGING';
    if (p.category_id === 'pc-INSUMOS') return v && v.sale_mode === 'UNIT' ? 'PACKAGING' : 'INPUT';
    return 'RAW_MATERIAL';
  }
  function storageWh(vid, site) {
    const p = G.productOf(vid); const n = site === 'es-L2' ? 'L2' : 'L1';
    return p && p.storage === 'FROZEN' ? 'wh-CNG-' + n : p && p.storage === 'CHILLED' ? 'wh-CAM-' + n : 'wh-ALM-' + n;
  }
  const LOT_PREFIX = { CHOR: 'CH', SALH: 'SH', MORC: 'MO', JAMO: 'JA', PANC: 'PA', MANT: 'MA', 'CAL-HUE': 'CB', CALG: 'CG', MERM: 'ME', CAFE: 'CF', BOND: 'BO', CHUL: 'CU', 'CUY-ENT': 'CY', 'CUY-FRZ': 'CZ', 'CON-ENT': 'CN', 'EMB-CHO': 'CC', 'MP-CERR': 'RC', 'MP-CERG': 'GR', 'MP-CERP': 'PI', 'MP-HUE': 'HU', 'MP-CUYM': 'MN', 'MP-CORG': 'GC', 'COR-PIE': 'CP', 'COR-PAL': 'PL', 'COR-CUE': 'CF' };
  function nextLotCode(productId, date) {
    const p = G.db.get('products', productId) || {}; const pre = LOT_PREFIX[p.code] || String(p.code || 'PR').replace(/[^A-Z]/g, '').slice(0, 2);
    let code; do { code = `${pre}-${String(date || G.TODAY).slice(0, 4)}-${U.pad(Number(G.db.next('LOTPRO-' + pre, '', 1)), 4)}`; } while (G.db.find('lots', l => l.code === code));
    return code;
  }
  /** lotes liberados y no vencidos a la fecha del consumo, por FEFO (RN-PRO-02, RN-PRO-03) */
  function validLots(vid, wh, date) {
    return G.db.where('stock_balances', b => b.variant_id === vid && b.warehouse_id === wh && b.lot_id && b.qty - (b.reserved_qty || 0) > 0.0005)
      .map(b => ({ b, lot: G.db.get('lots', b.lot_id) }))
      .filter(x => x.lot && x.lot.qc_status === 'RELEASED' && (!x.lot.expiry_date || x.lot.expiry_date >= date))
      .sort((a, c) => String(a.lot.expiry_date || '9999').localeCompare(String(c.lot.expiry_date || '9999')) || String(a.lot.code).localeCompare(c.lot.code));
  }
  function availAt(vid, wh, date) {
    const p = G.productOf(vid);
    if (p && !p.requires_lot) return R(U.sum(G.db.where('stock_balances', b => b.variant_id === vid && b.warehouse_id === wh), b => b.qty - (b.reserved_qty || 0)), 3);
    return R(U.sum(validLots(vid, wh, date), x => x.b.qty - (x.b.reserved_qty || 0)), 3);
  }
  function siteWarehouses(site) { return G.db.where('warehouses', w => w.establishment_id === site && w.status === 'ACTIVE' && !['QUARANTINE', 'RETURNS'].includes(w.wh_type)); }
  function pickWh(vid, o, date, need = 0) {
    const ln = lineOf(o.line_id); const cands = [ln && ln.input_warehouse_id, storageWh(vid, o.establishment_id), ...siteWarehouses(o.establishment_id).map(w => w.id)].filter((x, i, a) => x && a.indexOf(x) === i);
    return cands.find(w => availAt(vid, w, date) >= need - 0.0005 && availAt(vid, w, date) > 0) || cands.find(w => availAt(vid, w, date) > 0) || cands[0];
  }

  /* ---------- teóricos de la orden (RN-PRO-12 = RN-REC-08) ---------- */
  function theoretical(o) {
    if (typeof o === 'string') o = ord(o);
    const out = [];
    if (o.order_type === 'RECIPE' && G.rec && o.recipe_version_id) {
      const sc = G.rec.scale(o.recipe_version_id, o.planned_output_kg);
      for (const r of sc.rows) out.push({ variant_id: r.variant_id, kg: r.kg, base_kg: r.base_kg, tolerance_pct: r.tolerance_pct, role: roleOf(r.variant_id), qty: r.kg });
      const outV = o.output_variant_id; const units = outV ? o.planned_output_kg / unitKg(outV) : 0;
      for (const p of sc.packaging) { const q = p.per === 'UNIT' ? Math.ceil(units * p.qty) : R(o.planned_output_kg * p.qty, 2); out.push({ variant_id: p.variant_id, kg: 0, qty: q, role: 'PACKAGING', per: p.per }); }
    } else if (o.order_type === 'CUTTING' && G.des && o.cutting_template_id) {
      const t = G.des.template(o.cutting_template_id); const v = t && G.db.find('product_variants', x => x.product_id === t.input_product_id);
      if (v) out.push({ variant_id: v.id, kg: R(o.planned_output_kg, 3), qty: R(o.planned_output_kg, 3), role: 'RAW_MATERIAL' });
    } else if (o.order_type === 'PACKING' && o.source_variant_id) {
      const inKg = R(o.planned_output_kg / ((o.expected_yield_pct || 98) / 100), 3);
      const sv = G.variant(o.source_variant_id);
      out.push({ variant_id: o.source_variant_id, kg: inKg, qty: sv && sv.sale_mode !== 'KG' ? Math.ceil(inKg / unitKg(o.source_variant_id)) : inKg, role: 'RAW_MATERIAL' });
      out.push({ variant_id: 'va-EM-VAC-2030', kg: 0, qty: Math.ceil(o.planned_output_kg / unitKg(o.output_variant_id || o.source_variant_id)), role: 'PACKAGING', per: 'UNIT' });
    }
    return out;
  }

  /* ---------- costo de la orden (RN-PRO-07, RN-PRO-08) ---------- */
  function computeCost(o) {
    if (typeof o === 'string') o = ord(o);
    const cons = consOf(o.id), outs = outsOf(o.id);
    const byRole = r => R(U.sum(cons.filter(c => c.role === r), c => c.total_cost));
    const raw = byRole('RAW_MATERIAL'), inp = byRole('INPUT'), pack = byRole('PACKAGING');
    const labor = R(U.sum(labOf(o.id), l => l.cost)), equip = R(U.sum(eqOf(o.id), l => l.cost));
    const consumed_kg = R(U.sum(cons.filter(c => c.role !== 'PACKAGING'), c => c.weight_kg), 3);
    const main_kg = R(U.sum(outs.filter(x => ['MAIN', 'CO_PRODUCT'].includes(x.output_role)), x => x.weight_kg), 3);
    const by_kg = R(U.sum(outs.filter(x => x.output_role === 'BY_PRODUCT'), x => x.weight_kg), 3);
    const waste_reg = R(U.sum(outs.filter(x => x.output_role === 'WASTE'), x => x.weight_kg), 3);
    const product_kg = R(main_kg + by_kg, 3);
    const total = R(raw + inp + pack + labor + equip);
    const actual = consumed_kg > 0 ? R(product_kg / consumed_kg * 100, 2) : null;
    const expected = o.expected_yield_pct;
    const waste_kg = R(consumed_kg - product_kg, 3);
    const ln = lineOf(o.line_id);
    return {
      raw, inp, pack, material: R(raw + inp + pack), labor, equip, total, consumed_kg, main_kg, by_kg, product_kg, waste_reg, waste_kg,
      waste_pct: consumed_kg > 0 ? R(waste_kg / consumed_kg * 100, 2) : null, max_waste: ln ? (ln.max_waste_pct ?? G.param('pro_max_waste_pct')) : G.param('pro_max_waste_pct'),
      actual_yield: actual, expected_yield: expected, deviation: actual !== null && expected != null ? R(actual - expected, 2) : null,
      cost_per_kg: main_kg > 0 ? R(total / main_kg, 6) : null, labor_hours: R(U.sum(labOf(o.id), l => l.hours), 2),
      ingredient_cost_per_kg: main_kg > 0 ? R((raw + inp) / main_kg, 6) : null,
    };
  }

  /* ---------- acciones de dominio ---------- */
  function assertActive(o) { if (!o) G.fail('RN-PRO-04', 'Orden no encontrada.'); if (!ACTIVE.includes(o.status)) G.fail('RN-PRO-04', `La orden ${o.number} está ${(OSTAT[o.status] || [o.status])[0].toLowerCase()}: solo se registra con la orden liberada o en proceso.${o.status === 'PLANNED' ? ' Libérala primero.' : ''}`); }
  function assertScope(o) {
    const u = G.scope.user();
    if (u && u.sites && u.sites.length && !u.sites.includes(o.establishment_id)) G.fail('RN-PRO-09', `La orden ${o.number} es de ${G.siteName(o.establishment_id)} y tu usuario solo registra en ${u.sites.map(G.siteName).join(', ')}.`);
  }
  function assertRecord(o, opts) { if (opts.seed) return; if (!G.can('pro.order.record')) G.fail('RN-PRO-09', `Tu rol (${G.roleName()}) no tiene el permiso pro.order.record.`); assertScope(o); }
  function hist(o, action, detail, at) { o.history = (o.history || []).concat([{ at: at || G.date.now(), action, detail, user: G.ctx.userName() }]); }
  function toInProgress(o, at) { if (o.status === 'RELEASED') { o.status = 'IN_PROGRESS'; o.started_at = at; hist(o, 'Inicio', 'Primer registro de la orden', at); } }

  function create(p, opts = {}) {
    if (!opts.seed && !G.can('pro.order.create')) G.fail('RN-PRO-09', `Tu rol (${G.roleName()}) no tiene el permiso pro.order.create.`);
    const ln = lineOf(p.line_id); if (!ln) G.fail('RN-PRO-01', 'Elige la línea de producción.');
    if (ln.status !== 'ACTIVE') G.fail('RN-PRO-01', `La línea ${ln.code} está inactiva.`);
    const kg = Number(p.planned_output_kg); if (!(kg > 0)) G.fail('RN-PRO-12', 'Los kg planificados deben ser mayores que cero.');
    const row = { company_id: 'co-dg', establishment_id: ln.establishment_id, line_id: ln.id, order_type: p.order_type, planned_date: p.planned_date || G.TODAY, planned_output_kg: R(kg, 3), supervisor_user_id: p.supervisor_user_id || null, status: 'PLANNED', notes: p.notes || null };
    if (p.order_type === 'RECIPE') {
      const v = G.rec && G.rec.version(p.recipe_version_id);
      // historial sembrado: la versión que estaba aprobada en esa fecha pudo retirarse después (versionAt)
      if (!v || (v.status !== 'APPROVED' && !(opts.seed && v.status === 'RETIRED' && v.approved_at && v.approved_at.slice(0, 10) <= (p.planned_date || G.TODAY) && (!v.retired_at || v.retired_at.slice(0, 10) > (p.planned_date || G.TODAY))))) G.fail('RN-PRO-01', `La orden de receta necesita una versión APROBADA${v ? ` (la v${v.version} está ${G.rec.statusLabel(v.status).toLowerCase()})` : ''}. Aprueba la versión en REC-07.`);
      const rc = G.rec.recipe(v.recipe_id);
      Object.assign(row, { recipe_version_id: v.id, product_id: rc.product_id, brand_id: rc.brand_id, output_variant_id: p.output_variant_id || rc.output_variant_id, scale_factor: R(kg / v.base_output_kg, 6), expected_yield_pct: v.expected_yield_pct ?? G.rec.expectedYield(v.id) });
    } else if (p.order_type === 'CUTTING') {
      const t = G.des && G.des.template(p.cutting_template_id);
      if (!t || t.status !== 'ACTIVE') G.fail('RN-PRO-01', `La orden de despiece necesita una plantilla ACTIVA${t ? ` (${t.code} v${t.version} está ${t.status === 'DRAFT' ? 'en borrador' : 'retirada'})` : ''}. Actívala en DES-01.`);
      const ip = G.db.get('products', t.input_product_id);
      Object.assign(row, { cutting_template_id: t.id, product_id: t.input_product_id, brand_id: (ip || {}).brand_id || null, scale_factor: null, expected_yield_pct: G.des.expectedYield(t.id) });
    } else if (p.order_type === 'PACKING') {
      const sv = G.variant(p.source_variant_id); if (!sv) G.fail('RN-PRO-01', 'Elige el producto que se porciona y empaca.');
      const outV = G.variant(p.output_variant_id || p.source_variant_id);
      Object.assign(row, { source_variant_id: sv.id, output_variant_id: outV.id, product_id: outV.product_id, brand_id: outV.brand_id, expected_yield_pct: 98 });
    } else G.fail('RN-PRO-01', 'Tipo de orden no válido.');
    const s = G.series.next('OP01');
    row.number = 'OP01-' + U.pad(s.number, 4); row.series = 'OP01';
    row.history = [{ at: opts.at || G.date.now(), action: 'Creación', detail: `${lbl(ORDER_TYPES, row.order_type)} · ${F.kg(kg, 1)} planificados`, user: opts.user || G.ctx.userName() }];
    return G.db.insert(T_O, row, { silent: !!opts.seed });
  }
  function release(id, opts = {}) {
    const o = ord(id); if (!o) G.fail('RN-PRO-04', 'Orden no encontrada.');
    if (!opts.seed && !G.can('pro.order.create')) G.fail('RN-PRO-09', `Tu rol (${G.roleName()}) no tiene el permiso pro.order.create para liberar órdenes.`);
    if (o.status !== 'PLANNED') G.fail('RN-PRO-04', `La orden ${o.number} ya está ${(OSTAT[o.status] || [o.status])[0].toLowerCase()}.`);
    o.status = 'RELEASED'; o.released_at = opts.at || G.date.now(); hist(o, 'Liberación', 'Lista para registrar en planta', o.released_at); G.db.touch();
    return o;
  }

  /** Consumo por lote (RN-PRO-02, RN-PRO-03, RN-PRO-13). Sin lote: reparte por FEFO entre lotes válidos. */
  function consume(id, p, opts = {}) {
    const o = ord(id); assertActive(o); assertRecord(o, opts);
    const v = G.variant(p.variant_id); if (!v) G.fail('RN-PRO-13', 'Elige el insumo.');
    const prod = G.productOf(v.id);
    const at = p.at || G.date.now(); const date = at.slice(0, 10);
    const qty = R(Number(p.qty), 3); if (!(qty > 0)) G.fail('RN-PRO-13', 'La cantidad consumida debe ser mayor que cero.');
    const wh = p.warehouse_id || pickWh(v.id, o, date, qty);
    const role = p.role || roleOf(v.id);
    const th = theoretical(o).find(t => t.variant_id === v.id);
    if (o.order_type === 'CUTTING' && role === 'RAW_MATERIAL' && G.des) { const t = G.des.template(o.cutting_template_id); if (t && prod.id !== t.input_product_id) G.fail('RN-DES-09', `El lote de entrada debe ser de ${G.db.get('products', t.input_product_id).name}, no de ${prod.name}.`); }
    if (prod.requires_lot && !p.lot_id) {
      const lots = validLots(v.id, wh, date);
      let left = qty; const rows = [];
      if (R(U.sum(lots, x => x.b.qty - (x.b.reserved_qty || 0)), 3) < qty - 0.0005) G.fail('RN-ALM-03', `Stock liberado insuficiente de ${v.name} en ${G.whName(wh)}: hay ${F.num(U.sum(lots, x => x.b.qty), 3)} y se piden ${F.num(qty, 3)}. Revisa lotes en cuarentena o pide una transferencia.`);
      for (const x of lots) { if (left <= 0.0005) break; const take = R(Math.min(left, x.b.qty - (x.b.reserved_qty || 0)), 3); rows.push(consume(id, Object.assign({}, p, { lot_id: x.lot.id, qty: take, weight_kg: p.weight_kg ? R(p.weight_kg * take / qty, 3) : undefined, warehouse_id: wh, at }), Object.assign({}, opts, { fefoChecked: true }))); left = R(left - take, 3); }
      return rows.length === 1 ? rows[0] : rows;
    }
    let lot = null;
    if (p.lot_id) {
      lot = G.db.get('lots', p.lot_id); if (!lot) G.fail('RN-PRO-02', 'Lote no encontrado.');
      if (lot.variant_id !== v.id) G.fail('RN-PRO-02', `El lote ${lot.code} es de ${G.variantName(lot.variant_id)}, no de ${v.name}.`);
      if (lot.qc_status !== 'RELEASED') G.fail('RN-PRO-02', `El lote ${lot.code} está en ${G.ui.statusLabel(lot.qc_status).toLowerCase()}: solo se consume un lote liberado por Calidad.`);
      if (lot.expiry_date && lot.expiry_date < date) G.fail('RN-PRO-02', `El lote ${lot.code} venció el ${F.date(lot.expiry_date)}: no se consume.`);
      if (!opts.fefoChecked) {
        const earlier = validLots(v.id, wh, date).filter(x => x.lot.id !== lot.id && String(x.lot.expiry_date || '9999') < String(lot.expiry_date || '9999'));
        if (earlier.length) {
          if (!p.fefo_override_reason || !String(p.fefo_override_reason).trim()) G.fail('RN-PRO-03', `FEFO: el lote ${earlier[0].lot.code} vence antes (${F.date(earlier[0].lot.expiry_date)}) que ${lot.code} (${F.date(lot.expiry_date)}) en ${G.whName(wh)}. Usa ese lote o escribe el motivo para tomar otro.`);
          if (!opts.seed && !G.can('pro.fefo.override')) G.fail('RN-PRO-03', `Tomar un lote fuera de FEFO exige el permiso pro.fefo.override (jefe de producción). Usa el lote ${earlier[0].lot.code}.`);
        }
      }
    }
    const weight = v.sale_mode === 'KG' ? qty : v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? R(p.weight_kg != null ? p.weight_kg : qty * unitKg(v.id), 3) : role === 'PACKAGING' ? 0 : R(qty * unitKg(v.id), 3);
    const mv = G.inv.move({ type: 'PRODUCTION_OUT', wh, variant: v.id, lot: lot ? lot.id : null, qty, weight: v.sale_mode === 'UNIT' ? null : weight, source: { type: 'PRODUCTION_ORDER', id: o.id }, at, reason: `Consumo ${o.number}`, allowUnreleased: true });
    const m = mv.moves[0];
    const row = G.db.insert(T_C, { order_id: o.id, warehouse_id: wh, variant_id: v.id, lot_id: lot ? lot.id : null, role, theoretical_kg: th ? (th.kg || th.qty) : null, qty, weight_kg: weight, unit_cost: R(m.unit_cost, 6), total_cost: R(Math.abs(m.total_cost)), consumed_at: at, fefo_override_reason: p.fefo_override_reason || null, stock_movement_id: m.id, user: opts.user || G.ctx.userName() }, { silent: !!opts.seed });
    toInProgress(o, at); G.db.touch();
    return row;
  }

  /** Producción: lote nuevo en cuarentena (RN-PRO-05) con PRODUCTION_IN (RN-PRO-13). Mermas sin lote. */
  function output(id, p, opts = {}) {
    const o = ord(id); assertActive(o); assertRecord(o, opts);
    const at = p.at || G.date.now(); const date = at.slice(0, 10);
    const role = p.output_role || (o.order_type === 'CUTTING' ? 'CO_PRODUCT' : 'MAIN');
    const tl = p.template_line_id && G.des ? G.des.line(p.template_line_id) : null;
    if (role === 'WASTE') {
      const w = R(Number(p.weight_kg), 3); if (!(w > 0)) G.fail('RN-PRO-08', 'Escribe los kg de merma.');
      if (!opts.seed && !(p.waste_reason || '').trim()) G.fail('RN-PRO-08', 'La merma se registra con su motivo (recorte, goteo, evaporación, descarte de calidad…).');
      const row = G.db.insert(T_OUT, { order_id: o.id, variant_id: null, lot_id: null, output_role: 'WASTE', qty: 0, weight_kg: w, template_line_id: tl ? tl.id : null, waste_reason: p.waste_reason || 'Merma de proceso', at, user: opts.user || G.ctx.userName() }, { silent: !!opts.seed });
      toInProgress(o, at); G.db.touch(); return row;
    }
    const v = G.variant(p.variant_id); if (!v) G.fail('RN-PRO-13', 'Elige la variante producida.');
    const weight = R(Number(p.weight_kg), 3); if (!(weight > 0)) G.fail('RN-PRO-13', 'Escribe los kg producidos (peso real de balanza).');
    const qty = v.sale_mode === 'KG' ? weight : Math.round(Number(p.qty) || 0);
    if (!(qty > 0)) G.fail('RN-PRO-13', `Escribe las unidades producidas de ${v.name}.`);
    if (p.scale_equipment_id) equipUsable(p.scale_equipment_id, date);
    const prod = G.productOf(v.id);
    const code = (p.lot_code || '').trim() || nextLotCode(prod.id, date);
    if (G.db.find('lots', l => l.code === code)) G.fail('RN-PRO-13', `Ya existe un lote con el código ${code}.`);
    const requested = p.qc_status || 'QUARANTINE';
    const qc = G.modOn('CAL') ? 'QUARANTINE' : requested; // RN-PRO-05
    const ver = o.recipe_version_id && G.rec ? G.rec.version(o.recipe_version_id) : null;
    const life = (ver && ver.shelf_life_days && ['MAIN', 'CO_PRODUCT'].includes(role)) ? ver.shelf_life_days : prod.shelf_life_days;
    const provisional = p.unit_cost != null ? Number(p.unit_cost) : provisionalUnitCost(o, v.id);
    const lot = G.db.insert('lots', { product_id: prod.id, variant_id: v.id, code, origin: o.order_type === 'CUTTING' ? 'CUTTING' : 'PRODUCTION', supplier_id: null, production_date: date, expiry_date: G.date.add(date, life || 7), qc_status: qc, unit_cost: R(provisional, 6), production_order_id: o.id, requested_qc_status: requested, ccp_deviation: !!o.critical_deviation, notes: qc !== requested ? `Enviado como ${G.ui.statusLabel(requested)}; queda en cuarentena hasta que Calidad lo libere (RN-PRO-05).` : null }, { silent: !!opts.seed });
    const ln = lineOf(o.line_id);
    const wh = p.warehouse_id || (o.order_type === 'CUTTING' ? storageWh(v.id, o.establishment_id) : (ln && ln.output_warehouse_id) || storageWh(v.id, o.establishment_id));
    const mv = G.inv.move({ type: 'PRODUCTION_IN', wh, variant: v.id, lot: lot.id, qty, weight: v.sale_mode === 'UNIT' ? null : weight, unitCost: provisional, source: { type: 'PRODUCTION_ORDER', id: o.id }, at, reason: `Producción ${o.number}` });
    const ref = tl && G.des ? G.des.refPrice(v.id, date) : null;
    const row = G.db.insert(T_OUT, { order_id: o.id, variant_id: v.id, lot_id: lot.id, output_role: role, qty, weight_kg: weight, warehouse_id: wh, scale_equipment_id: p.scale_equipment_id || null, template_line_id: tl ? tl.id : null, reference_price_per_kg: ref, nrv_cost_per_kg: tl ? tl.nrv_cost_per_kg : null, allocated_cost: null, unit_cost: R(provisional, 6), stock_movement_id: mv.moves[0].id, at, user: opts.user || G.ctx.userName() }, { silent: !!opts.seed });
    toInProgress(o, at); G.db.touch();
    if (!opts.seed && G.modOn('CAL')) G.notify({ role: 'CALIDAD', title: `Lote ${code} por liberar`, body: `${v.name} · ${F.kg(weight, 3)} de la orden ${o.number} (en cuarentena).`, ref: lot.id, tone: o.critical_deviation ? 'bad' : 'info', module: 'PRO' });
    return row;
  }
  function provisionalUnitCost(o, vid) {
    const c = computeCost(o);
    const perKg = c.total > 0 && o.planned_output_kg > 0 ? c.total / (o.order_type === 'CUTTING' ? Math.max(o.planned_output_kg * 0.7, 0.001) : o.planned_output_kg) : (G.variant(vid) || {}).std_cost / unitKg(vid);
    return R(perKg * unitKg(vid), 6);
  }

  function reading(id, p, opts = {}) {
    const o = ord(id); assertActive(o); assertRecord(o, opts);
    const cp = G.db.get('recipe_control_points', p.control_point_id); if (!cp) G.fail('RN-PRO-11', 'Elige el punto de control.');
    const val = Number(p.value); if (p.value === '' || p.value == null || isNaN(val)) G.fail('RN-PRO-11', 'Escribe el valor leído.');
    const inRange = (cp.min_value == null || val >= cp.min_value) && (cp.max_value == null || val <= cp.max_value);
    if (!inRange && !(p.corrective_action || '').trim()) G.fail('RN-PRO-11', `La lectura ${F.num(val, 1)} ${cp.unit} está fuera del rango ${F.num(cp.min_value, 1)}–${F.num(cp.max_value, 1)} ${cp.unit} de ${cp.code}: escribe la acción correctiva que aplicaste.`);
    const at = p.at || G.date.now();
    const row = G.db.insert(T_CCP, { order_id: o.id, control_point_id: cp.id, value: val, read_at: at, read_by: opts.userId || G.ctx.userId(), reader_name: opts.user || G.ctx.userName(), in_range: inRange, corrective_action: inRange ? null : p.corrective_action.trim() }, { silent: !!opts.seed });
    if (!inRange && cp.is_critical) {
      o.critical_deviation = true; hist(o, 'Punto crítico fuera de rango', `${cp.code}: ${F.num(val, 1)} ${cp.unit} · ${p.corrective_action}`, at);
      for (const x of outsOf(o.id)) if (x.lot_id) { const l = G.db.get('lots', x.lot_id); if (l) l.ccp_deviation = true; }
      if (!opts.seed) G.notify({ role: 'CALIDAD', title: `Punto crítico fuera de rango en ${o.number}`, body: `${cp.code} ${F.num(val, 1)} ${cp.unit}: el lote producido no se libera sin no conformidad cerrada (RN-PRO-11, RN-CAL-03).`, ref: o.id, tone: 'bad', module: 'PRO' });
    }
    toInProgress(o, at); G.db.touch();
    return row;
  }
  function addLabor(id, p, opts = {}) {
    const o = ord(id); assertActive(o); assertRecord(o, opts);
    const e = G.db.get('employees', p.employee_id); if (!e) G.fail('RN-PRO-16', 'Elige el trabajador.');
    const hrs = Number(p.hours); const max = G.param('pro_max_hours_per_record');
    if (!(hrs > 0) || hrs > max) G.fail('RN-PRO-16', `Las horas deben ser mayores que 0 y no superar ${max} h por registro.`);
    const def = G.param('pro_default_labor_rate_pen');
    const rate = p.hourly_rate != null && p.hourly_rate !== '' ? Number(p.hourly_rate) : def;
    if (!opts.seed && rate !== def && (G.ctx.role === 'OPERARIO_PRODUCCION' || !canCost())) G.fail('RN-PRO-09', 'El operario no cambia tarifas: se usa la tarifa vigente (RN-PRO-18).');
    const row = G.db.insert(T_LAB, { order_id: o.id, employee_id: e.id, task_role: p.task_role || 'HELPER', work_date: p.work_date || G.TODAY, hours: R(hrs, 2), hourly_rate: R(rate, 4), cost: R(hrs * rate), rate_source: rate === def ? 'PARAM' : 'MANUAL' }, { silent: !!opts.seed });
    toInProgress(o, (p.work_date || G.TODAY) + 'T12:00'); G.db.touch();
    return row;
  }
  function addEquipment(id, p, opts = {}) {
    const o = ord(id); assertActive(o); assertRecord(o, opts);
    const eq = equipmentOf(p.equipment_id); equipUsable(eq, p.date || G.TODAY);
    if (eq.establishment_id && eq.establishment_id !== o.establishment_id) G.fail('RN-PRO-15', `${eq.name} es de ${G.siteName(eq.establishment_id)} y la orden es de ${G.siteName(o.establishment_id)}.`);
    const hrs = Number(p.hours); const max = G.param('pro_max_hours_per_record');
    if (!(hrs > 0) || hrs > max) G.fail('RN-PRO-16', `Las horas de equipo deben ser mayores que 0 y no superar ${max} h por registro.`);
    const rate = p.hourly_rate != null && p.hourly_rate !== '' ? Number(p.hourly_rate) : eq.hourly_rate;
    if (!opts.seed && rate !== eq.hourly_rate && (G.ctx.role === 'OPERARIO_PRODUCCION' || !canCost())) G.fail('RN-PRO-09', 'El operario no cambia la tarifa del equipo.');
    const row = G.db.insert(T_EQ, { order_id: o.id, equipment_id: eq.id, equipment_name: eq.name, hours: R(hrs, 2), hourly_rate: R(rate, 4), cost: R(hrs * rate) }, { silent: !!opts.seed });
    toInProgress(o, (p.date || G.TODAY) + 'T12:00'); G.db.touch();
    return row;
  }

  /** Cierre con costo real (RN-PRO-06/07/08/10/17; en despiece RN-DES-02/03/04/06/07) */
  function close(id, opts = {}) {
    const o = ord(id); if (!o) G.fail('RN-PRO-04', 'Orden no encontrada.');
    if (!opts.seed && !G.can('pro.order.close')) G.fail('RN-PRO-09', `Tu rol (${G.roleName()}) no cierra órdenes: hace falta el permiso pro.order.close (jefe de producción).`);
    if (!opts.seed) assertScope(o);
    if (!ACTIVE.includes(o.status)) G.fail('RN-PRO-04', `La orden ${o.number} está ${(OSTAT[o.status] || [o.status])[0].toLowerCase()}: no se puede cerrar.`);
    const date = opts.date || G.TODAY;
    if (G.period.isClosed(date)) G.fail('RN-PRO-10', `El período ${G.date.monthName(date)} está cerrado: no se cierra una orden con fecha ${F.date(date)}. Usa una fecha del período abierto o pide a la contadora reabrirlo (RN-PLT-05).`);
    const c = computeCost(o);
    if (!(c.consumed_kg > 0)) G.fail('RN-PRO-06', 'La orden no tiene consumos de materia prima o insumos: registra los consumos (PRO-06) antes de cerrar.');
    if (!(c.product_kg > 0)) G.fail('RN-PRO-06', 'La orden no tiene producción registrada: registra los lotes producidos (PRO-08) antes de cerrar.');
    let alloc = null, mb = null;
    if (o.order_type === 'CUTTING' && G.des) {
      mb = G.des.massBalance(o);
      if (!mb.ok) {
        if (!opts.massOverride) G.fail('RN-DES-04', `Balance de masa fuera de tolerancia: entran ${F.kg(mb.input_kg, 3)} y se registran ${F.kg(mb.output_kg, 3)} (diferencia ${F.pct(mb.diff_pct, 2)}, tolerancia ${F.pct(mb.tolerance_pct, 1)}). Registra la merma o los cortes faltantes; quien tenga des.mass_balance.override puede cerrar con la excepción.`);
        if (!opts.seed && !G.can('des.mass_balance.override')) G.fail('RN-DES-04', `Cerrar fuera de tolerancia exige el permiso des.mass_balance.override (diferencia ${F.pct(mb.diff_pct, 2)}).`);
      }
      alloc = G.des.allocateOrder(o, date);
    }
    const tol = G.param('pro_yield_tolerance_pp');
    const yReason = (opts.yield_deviation_reason || '').trim(), wReason = (opts.waste_reason || '').trim();
    if (c.deviation !== null && Math.abs(c.deviation) > tol + 1e-9 && !yReason) G.fail('RN-PRO-06', `El rendimiento real ${F.pct(c.actual_yield, 2)} difiere ${c.deviation > 0 ? '+' : ''}${F.num(c.deviation, 2)} puntos del esperado ${F.pct(c.expected_yield, 2)} (tolerancia ${tol} puntos): escribe el motivo de la desviación para cerrar.`);
    if (c.waste_pct !== null && c.waste_pct > c.max_waste + 1e-9 && !wReason) G.fail('RN-PRO-08', `La merma ${F.pct(c.waste_pct, 2)} supera el máximo de la línea (${F.pct(c.max_waste, 1)}): escribe el motivo para cerrar.`);
    // costo final de cada lote producido (ALM solo fija el costo, sin nuevo ingreso: RN-PRO-17)
    const lotsOut = [];
    const outs = outsOf(o.id);
    for (const x of outs) {
      if (x.output_role === 'WASTE') continue;
      let total;
      if (alloc) { const a = alloc.rows.find(r => r.output_id === x.id); total = a ? a.allocated : 0; x.reference_price_per_kg = a ? a.ref_price : x.reference_price_per_kg; x.nrv_cost_per_kg = a ? a.nrv_cost : x.nrv_cost_per_kg; }
      else total = ['MAIN', 'CO_PRODUCT'].includes(x.output_role) && c.main_kg > 0 ? R(c.total * x.weight_kg / c.main_kg) : 0;
      x.allocated_cost = R(total);
      x.unit_cost = x.qty > 0 ? R(total / x.qty, 6) : 0;
      const l = G.db.get('lots', x.lot_id); if (l) l.unit_cost = x.unit_cost;
      lotsOut.push({ lot_id: x.lot_id, code: l ? l.code : null, variant_id: x.variant_id, kg: x.weight_kg, qty: x.qty, unit_cost: x.unit_cost, total: x.allocated_cost, role: x.output_role });
    }
    // RN-DES-03: la suma de lo asignado con el método elegido es exactamente el costo total
    if (!alloc && lotsOut.length) { const diff = R(c.total - U.sum(lotsOut, l => l.total)); if (Math.abs(diff) >= 0.005) { const big = outs.filter(x => ['MAIN', 'CO_PRODUCT'].includes(x.output_role)).sort((a, b) => b.weight_kg - a.weight_kg)[0]; if (big) { big.allocated_cost = R(big.allocated_cost + diff); big.unit_cost = R(big.allocated_cost / big.qty, 6); const l = G.db.get('lots', big.lot_id); if (l) l.unit_cost = big.unit_cost; const lo = lotsOut.find(z => z.lot_id === big.lot_id); if (lo) { lo.total = big.allocated_cost; lo.unit_cost = big.unit_cost; } } } }
    const co_alloc = alloc ? R(U.sum(alloc.rows.filter(r => r.role === 'CO_PRODUCT'), r => r.allocated)) : null;
    Object.assign(o, {
      status: 'CLOSED', closed_at: opts.at || (date === G.TODAY ? G.date.now() : date + 'T18:00'), close_date: date, closed_by: opts.user || G.ctx.userName(),
      input_kg: c.consumed_kg, output_kg: c.product_kg, main_kg: c.main_kg, waste_kg: c.waste_kg, waste_pct: c.waste_pct, actual_yield_pct: c.actual_yield, yield_deviation_pp: c.deviation,
      yield_deviation_reason: yReason || null, waste_reason: wReason || null,
      raw_material_cost: c.raw, input_cost: c.inp, packaging_cost: c.pack, material_cost: c.material, labor_cost: c.labor, equipment_cost: c.equip, total_cost: c.total,
      cost_per_kg: alloc ? (c.main_kg > 0 ? R(co_alloc / c.main_kg, 6) : null) : c.cost_per_kg, ingredient_cost_per_kg: c.ingredient_cost_per_kg,
      mass_balance_pct: mb ? mb.diff_pct : null, mass_balance_override_by: mb && !mb.ok ? (opts.userId || G.ctx.userId()) : null,
      joint_cost: alloc ? alloc.joint_cost : null, nrv_total: alloc ? alloc.nrv_total : null,
    });
    if (o.recipe_version_id && G.rec) { const v = G.rec.version(o.recipe_version_id); o.standard_cost_per_kg = v ? v.standard_cost_per_kg : null; }
    hist(o, 'Cierre', `Costo ${F.money(c.total)} · ${o.cost_per_kg != null ? F.money(o.cost_per_kg, 4) + ' por kg' : ''} · rendimiento ${F.pct(c.actual_yield, 2)}`, o.closed_at);
    G.db.touch();
    if (o.order_type === 'CUTTING' && G.des) G.des.raiseAlerts(o, { seed: opts.seed });
    if (!opts.seed) { G.audit('CERRAR', T_O, o.id, `${o.number} · ${F.money(o.total_cost)}`); G.events.emit('production_order.closed', { order_id: o.id, number: o.number, order_type: o.order_type, establishment_id: o.establishment_id, close_date: date, total_cost: o.total_cost, cost_per_kg: o.cost_per_kg, lots: lotsOut }); }
    return o;
  }
  function voidOrder(id, reason, opts = {}) {
    const o = ord(id); if (!o) G.fail('RN-PRO-14', 'Orden no encontrada.');
    if (!opts.seed && !G.can('pro.order.void')) G.fail('RN-PRO-14', `Tu rol (${G.roleName()}) no anula órdenes (permiso pro.order.void).`);
    if (!OPEN.includes(o.status)) G.fail('RN-PRO-14', `La orden ${o.number} está ${(OSTAT[o.status] || [o.status])[0].toLowerCase()}: no se anula.`);
    if (consOf(o.id).length || outsOf(o.id).length) G.fail('RN-PRO-14', `La orden ${o.number} ya tiene consumos o producción registrados: no se anula. Ciérrala o revierte los movimientos en ALM.`);
    if (!(reason || '').trim()) G.fail('RN-PRO-14', 'Escribe el motivo de la anulación.');
    o.status = 'VOIDED'; o.void_reason = reason.trim(); o.voided_at = opts.at || G.date.now(); o.voided_by = opts.user || G.ctx.userName(); hist(o, 'Anulación', reason, o.voided_at); G.db.touch();
    if (!opts.seed) G.audit('ANULAR', T_O, o.id, `${o.number} · ${reason}`);
    return o;
  }

  G.pro = { create, release, consume, output, reading, addLabor, addEquipment, computeCost, close, void: voidOrder, theoretical, unitKg, roleOf, storageWh, validLots, availAt, pickWh, equipmentList, equipmentOf, equipUsable, eqName, ensureCatalog, order: ord, line: lineOf, consumptions: consOf, outputs: outsOf, labor: labOf, equipment: eqOf, readings: ccpOf, nextLotCode, statusBadge: ost, ORDER_TYPES, O_ROLES, OSTAT };

  /* =====================================================================
     Seeds 42 (catálogo y líneas) y 43 (historial de setiembre y octubre)
     ===================================================================== */
  const LINES = [
    ['L1-COR', 'Sala de cortes y despiece', 'es-L1', 'CUTTING', 'wh-CAM-L1', 'wh-CAM-L1', 'cc-PROD-L1', 6],
    ['L1-VAC', 'Porcionado y empaque al vacío', 'es-L1', 'VACUUM_PACK', 'wh-CAM-L1', 'wh-CNG-L1', 'cc-PROD-L1', 3],
    ['L1-EMB', 'Embutidos artesanales', 'es-L1', 'SAUSAGE', 'wh-CAM-L1', 'wh-CAM-L1', 'cc-PROD-L1', 8],
    ['L1-AHU', 'Curados y ahumados', 'es-L1', 'OTHER', 'wh-CAM-L1', 'wh-CAM-L1', 'cc-PROD-L1', 26],
    ['L2-MAN', 'Mantecas', 'es-L2', 'LARD', 'wh-PRD-L2', 'wh-ALM-L2', 'cc-PROD-L2', 22],
    ['L2-CAL', 'Caldos', 'es-L2', 'BROTH', 'wh-PRD-L2', 'wh-CNG-L2', 'cc-PROD-L2', 24],
    ['L2-MER', 'Mermeladas', 'es-L2', 'JAM', 'wh-PRD-L2', 'wh-ALM-L2', 'cc-PROD-L2', 15],
    ['L2-CAF', 'Tostado de café', 'es-L2', 'OTHER', 'wh-PRD-L2', 'wh-ALM-L2', 'cc-PROD-L2', 18],
  ];
  G.seed(42, function seedProLines() {
    ensureCatalog();
    LINES.forEach(([code, name, est, type, inWh, outWh, cc, waste]) => G.db.insert(T_L, { id: 'pl-' + code, establishment_id: est, code, name, line_type: type, input_warehouse_id: inWh, output_warehouse_id: outWh, cost_center_id: cc, max_waste_pct: waste, status: 'ACTIVE' }, { silent: true }));
  }, 'PRO líneas');

  G.seed(43, function seedProHistory() {
    // sin DES (build aislado) se siembran las órdenes por receta y empaque; las de despiece solo con DES
    if (!G.rec) return;
    const r = U.rng(4343);
    const noise = (a) => (r() + r() + r() - 1.5) / 1.5 * a; // aproximadamente normal en ±a
    const users = G.db.all('users');
    const jefe = users.find(u => u.role === 'JEFE_PRODUCCION'), cal = users.find(u => u.role === 'CALIDAD');
    const opL1 = users.find(u => u.role === 'OPERARIO_PRODUCCION' && (u.sites || []).includes('es-L1'));
    const opL2 = users.find(u => u.role === 'OPERARIO_PRODUCCION' && (u.sites || []).includes('es-L2'));
    const empOf = u => u && u.employee_id;
    const emps = G.db.all('employees');
    const W = { 'es-L1': [empOf(opL1), (emps.find(e => /Ayudante/.test(e.position) && e.establishment_id === 'es-L1') || {}).id].filter(Boolean), 'es-L2': [empOf(opL2), ...emps.filter(e => e.establishment_id === 'es-L2' && /Operari/.test(e.position) && e.id !== empOf(opL2)).map(e => e.id)].filter(Boolean) };
    const sup = { cerdo: 'su-' + U.rucCheck('2051290011').slice(-8), camal: 'su-' + U.rucCheck('2055418723').slice(-8), cordero: 'su-' + U.rucCheck('2048871205').slice(-8), insumos: 'su-' + U.rucCheck('2052219974').slice(-8), avicola: 'su-' + U.rucCheck('2060233817').slice(-8), cafe: 'su-' + U.rucCheck('2060775190').slice(-8) };
    const supplierFor = (vid, d) => ({ 'va-MP-CER-MR': (G.date.parse(d).getUTCDate() % 3 === 0) ? sup.camal : sup.cerdo, 'va-MP-CUY-CAN': 'su-GRANJA', 'va-MP-CON-CAN': 'su-GRANJA', 'va-MP-COR-CAN': sup.cordero, 'va-MP-CER-SAN': sup.camal, 'va-MP-HUE-KG': sup.camal, 'va-MP-GAL-CAR': sup.avicola, 'va-IN-CAV-KG': sup.cafe, 'va-MP-CER-REC': sup.camal, 'va-MP-CER-GRA': sup.camal, 'va-MP-CER-PIE': sup.cerdo })[vid] || (G.productOf(vid).category_id === 'pc-INSUMOS' ? sup.insumos : null);
    const opt = { seed: true };
    const receive = (vid, wh, qty, d, costF = 1) => {
      const v = G.variant(vid), p = G.productOf(vid);
      const cost = R(v.std_cost * costF * (1 + noise(0.03)), 4);
      if (!p.requires_lot) { G.inv.move({ type: 'RECEIPT', wh, variant: vid, qty, unitCost: cost, source: { type: 'PURCHASE_RECEIPT', id: 'REC-' + d }, at: G.date.add(d, -1) + 'T16:00', reason: 'Recepción de compra' }); return; }
      const s = supplierFor(vid, d);
      const lot = G.db.insert('lots', { product_id: p.id, variant_id: vid, code: `L${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}-P${U.pad(G.db.next('LOTPRO-IN', '', 1), 3)}`, origin: s === 'su-GRANJA' ? 'FARM' : 'PURCHASE', supplier_id: s, production_date: G.date.add(d, -1), expiry_date: G.date.add(G.date.add(d, -1), p.shelf_life_days), qc_status: 'RELEASED', unit_cost: cost, released_at: G.date.add(d, -1) + 'T17:00', released_by: cal ? cal.name : 'Calidad' }, { silent: true });
      G.inv.move({ type: 'RECEIPT', wh, variant: vid, lot: lot.id, qty, weight: v.sale_mode === 'UNIT' ? null : qty, unitCost: cost, source: { type: s === 'su-GRANJA' ? 'FARM_RECEIPT' : 'PURCHASE_RECEIPT', id: 'REC-' + d }, at: G.date.add(d, -1) + 'T16:00', reason: 'Recepción de compra' });
      return lot;
    };
    // lleva a la sala de producción del local 2 lo que pide la orden (TRANSFER_OUT/IN) o compra el faltante
    const ensure = (vid, o, qty, d) => {
      const target = o.establishment_id === 'es-L2' ? 'wh-PRD-L2' : storageWh(vid, 'es-L1');
      let have = availAt(vid, target, d); if (have >= qty - 0.0005) return target;
      const p = G.productOf(vid);
      const sources = o.establishment_id === 'es-L2' ? [storageWh(vid, 'es-L2'), 'wh-CAM-L1', 'wh-CNG-L1'] : [];
      for (const src of sources) {
        if (have >= qty - 0.0005) break;
        if (!p.requires_lot) { const q = R(Math.min(qty - have, availAt(vid, src, d)), 3); if (q > 0) { G.inv.move({ type: 'TRANSFER_OUT', wh: src, variant: vid, qty: q, source: { type: 'PRODUCTION_REQUEST', id: o.id }, at: d + 'T06:30', reason: 'Requisición a sala de producción' }); G.inv.move({ type: 'TRANSFER_IN', wh: target, variant: vid, qty: q, unitCost: G.inv.avg(vid, src), source: { type: 'PRODUCTION_REQUEST', id: o.id }, at: d + 'T06:35', reason: 'Requisición a sala de producción' }); have = R(have + q, 3); } continue; }
        for (const x of validLots(vid, src, d)) {
          if (have >= qty - 0.0005) break;
          const q = R(Math.min(qty - have, x.b.qty - (x.b.reserved_qty || 0)), 3); if (q <= 0) continue;
          const uc = x.b.avg_cost;
          G.inv.move({ type: 'TRANSFER_OUT', wh: src, variant: vid, lot: x.lot.id, qty: q, weight: q, source: { type: 'PRODUCTION_REQUEST', id: o.id }, at: d + 'T06:30', reason: 'Requisición a sala de producción', allowUnreleased: true });
          G.inv.move({ type: 'TRANSFER_IN', wh: target, variant: vid, lot: x.lot.id, qty: q, weight: q, unitCost: uc, source: { type: 'PRODUCTION_REQUEST', id: o.id }, at: d + 'T06:35', reason: 'Requisición a sala de producción' });
          have = R(have + q, 3);
        }
      }
      if (have < qty - 0.0005) receive(vid, target, R(Math.ceil((qty - have) * 2) / 2, 3), d);
      return target;
    };
    const seedUser = o => (o.establishment_id === 'es-L2' ? opL2 : opL1) || jefe;
    const at = (d, hm) => d + 'T' + hm;
    const sellPlan = []; // salidas consolidadas por ventas de lo producido
    const SELL = { 'va-MP-CER-PIE': 0.55, 'va-M2-PAN-KG': 0.6, 'va-MP-CUY-MEN': 1, 'va-MP-COR-GRA': 1 };
    const KEEP = new Set(['va-MP-CER-REC', 'va-MP-CER-GRA', 'va-MP-HUE-KG']);
    const releaseLot = (lotId, when) => { const l = G.db.get('lots', lotId); if (l && when <= G.TODAY + 'T99') { l.qc_status = 'RELEASED'; l.released_at = when; l.released_by = cal ? cal.name : 'Calidad'; } };
    const labor = (o, d, hours, roles) => { const ws = W[o.establishment_id]; roles.forEach((tr, i) => { if (ws[i % ws.length]) addLabor(o.id, { employee_id: ws[i % ws.length], task_role: tr, hours: R(Math.max(0.5, hours + noise(0.5)), 1), work_date: d }, opt); }); };
    const equip = (o, d, list) => list.forEach(([code, hrs]) => { const e = equipmentOf('eq-' + code) || equipmentOf('eq-' + code + '-01') || equipmentOf('eq-EQ-' + code); if (e && e.status === 'ACTIVE') addEquipment(o.id, { equipment_id: e.id, hours: R(Math.max(0.25, hrs), 2), date: d }, opt); });
    const EQ_LINE = { 'L1-EMB': [['MOL-L1', 1], ['EMB-L1', 2.5], ['SEL-L1', 1]], 'L1-AHU': [['AHU-L1', 5], ['SEL-L1', 1]], 'L1-VAC': [['SEL-L1', 1.5]], 'L2-MAN': [['MAR-L2', 2]], 'L2-CAL': [['MAR-L2', 6], ['SEL-L2B', 1]], 'L2-MER': [['COC-L2', 2], ['SEL-L2B', 0.5]], 'L2-CAF': [['TOS-L2', 2], ['MOC-L2', 0.5], ['SEL-L2B', 0.5]] };
    const TASKS_LINE = { 'L1-EMB': ['SAUSAGE_MAKER', 'HELPER'], 'L1-AHU': ['COOK', 'HELPER'], 'L1-VAC': ['PACKER'], 'L2-MAN': ['COOK'], 'L2-CAL': ['COOK', 'HELPER'], 'L2-MER': ['COOK', 'PACKER'], 'L2-CAF': ['COOK'] };
    const REASONS_Y = ['Recortes con más grasa de lo habitual; se separó el exceso.', 'Evaporación mayor por fuego alto en la segunda hora.', 'Fruta muy madura, más pulpa descartada al seleccionar.', 'Canal con más hueso del promedio del proveedor.', 'Calibración de la embutidora; se repitió una tanda.'];
    let closedCount = 0;

    function finish(o, d, closeDay, stage) {
      // stage: 'CLOSE' | 'OPEN' (en curso hoy)
      if (stage !== 'CLOSE') return;
      const c = computeCost(o);
      const tol = G.param('pro_yield_tolerance_pp');
      const yr = c.deviation !== null && Math.abs(c.deviation) > tol ? U.pick(r, REASONS_Y) : '';
      const wr = c.waste_pct !== null && c.waste_pct > c.max_waste ? 'Merma por proceso de cocción y limpieza; registrada en la orden.' : '';
      close(o.id, { seed: true, date: closeDay, yield_deviation_reason: yr, waste_reason: wr, massOverride: true, user: jefe ? jefe.name : 'Jefe de producción', userId: jefe && jefe.id, at: closeDay + 'T17:30' });
      closedCount++;
    }

    function recipeOrder(code, d, kgPlan, stage = 'CLOSE', extra = {}) {
      const rc = G.rec.recipeByCode(code); if (!rc) return null;
      const v = G.rec.versionAt(rc.id, d); if (!v) return null;
      const lnCode = rc.line_code; const ln = lineOf('pl-' + lnCode);
      const o = create({ order_type: 'RECIPE', line_id: ln.id, recipe_version_id: v.id, planned_output_kg: kgPlan, planned_date: d, supervisor_user_id: jefe && jefe.id, output_variant_id: rc.output_variant_id }, { seed: true, at: at(G.date.add(d, -2), '15:00'), user: jefe && jefe.name });
      if (stage === 'PLANNED') return o;
      release(o.id, { seed: true, at: at(G.date.add(d, -1), '16:00') });
      if (stage === 'RELEASED') return o;
      const u = seedUser(o); const uo = { seed: true, user: u.name, userId: u.id };
      const sc = G.rec.scale(v.id, kgPlan);
      for (const it of sc.rows) {
        const q = R(it.kg * (1 + noise(0.012)), 3);
        const wh = ensure(it.variant_id, o, q, d);
        consume(o.id, { variant_id: it.variant_id, qty: q, warehouse_id: wh, at: at(d, '08:1' + (it.seq % 10)) }, uo);
      }
      // puntos de control
      const cps = G.rec.controlPoints(v.id);
      for (const cp of cps) {
        if (extra.partialCcp && cp !== cps[0]) continue;
        let val = cp.min_value != null && cp.max_value != null ? R(cp.min_value + (cp.max_value - cp.min_value) * (0.2 + r() * 0.6), 1) : cp.max_value ?? cp.min_value;
        let act = '';
        const bad = !extra.noBad && r() < (cp.is_critical ? 0.03 : 0.07);
        if (bad) { val = R((cp.max_value ?? val) + (cp.max_value - cp.min_value || 2) * 0.15, 1); act = cp.corrective_action; }
        reading(o.id, { control_point_id: cp.id, value: val, corrective_action: act, at: at(d, '10:' + U.pad(10 + cps.indexOf(cp) * 7, 2)) }, uo);
      }
      labor(o, d, rc.recipe_type === 'CURED' ? 6 : 4, TASKS_LINE[lnCode] || ['HELPER']);
      equip(o, d, (EQ_LINE[lnCode] || []).map(([c, hh]) => [c, hh * (kgPlan / 25) ** 0.4 + noise(0.2)]));
      if (stage === 'NO_OUTPUT') return o;
      const consumed = computeCost(o).consumed_kg;
      const y = (o.expected_yield_pct + noise(extra.yNoise || 2.2) - (extra.yDrop || 0)) / 100;
      const outKg = R(consumed * y, 3);
      // variantes de salida (chorizo: 80 % en 500 g, 20 % en 1 kg)
      const outs = rc.code === 'RC-CHO' ? [['va-M3-CHO-500', 0.8], ['va-M3-CHO-1K', 0.2]] : rc.code === 'RC-JAM' ? [['va-M3-JAM-KG', 0.4], ['va-M3-JAM-250', 0.6]] : rc.code === 'RC-CAF' ? [['va-M5-CAF-250', 0.7], ['va-M5-CAF-G500', 0.3]] : [[rc.output_variant_id, 1]];
      let units = 0; const plan = [];
      for (const [vid, share] of outs) {
        const kg = R(outKg * share, 3); const uk = unitKg(vid); const q = G.variant(vid).sale_mode === 'KG' ? kg : Math.max(1, Math.round(kg / uk));
        if (G.variant(vid).sale_mode !== 'KG') units += q;
        plan.push({ vid, kg, q });
      }
      // empaques por unidad o por kg
      for (const pk of sc.packaging) {
        const q = pk.per === 'UNIT' ? units || Math.ceil(outKg / unitKg(outs[0][0])) : Math.max(1, R(outKg * pk.qty, 0));
        if (!(q > 0)) continue;
        const wh = ensure(pk.variant_id, o, q, d);
        consume(o.id, { variant_id: pk.variant_id, qty: q, warehouse_id: wh, at: at(d, '13:05') }, uo);
      }
      const c = computeCost(o); const cpk = c.total / Math.max(0.001, U.sum(plan, x => x.kg));
      const scale = equipmentList(o.establishment_id).find(e => e.category === 'SCALE' && e.status === 'ACTIVE' && (!e.calibration_valid_until || e.calibration_valid_until >= d));
      for (const x of plan) {
        const row = output(o.id, { variant_id: x.vid, output_role: 'MAIN', qty: x.q, weight_kg: x.kg, unit_cost: R(cpk * (G.variant(x.vid).sale_mode === 'KG' ? 1 : x.kg / x.q), 6), scale_equipment_id: scale && scale.id, at: at(d, '14:2' + plan.indexOf(x)), qc_status: 'RELEASED' }, uo);
        if (stage === 'CLOSE' && d < G.date.add(G.TODAY, -1)) { releaseLot(row.lot_id, at(G.date.add(d, 1), '09:30')); sellPlan.push({ lot_id: row.lot_id, d }); }
      }
      if (extra.waste) output(o.id, { output_role: 'WASTE', weight_kg: extra.waste, waste_reason: 'Descarte de tripa rota y masa del arranque', at: at(d, '14:40') }, uo);
      finish(o, d, extra.closeDay || d, stage);
      return o;
    }

    function cuttingOrder(tplId, d, inKg, stage = 'CLOSE', extra = {}) {
      if (!G.des) return null;
      const t = G.des.template(tplId); if (!t) return null;
      const ln = lineOf('pl-L1-COR');
      const o = create({ order_type: 'CUTTING', line_id: ln.id, cutting_template_id: t.id, planned_output_kg: inKg, planned_date: d, supervisor_user_id: jefe && jefe.id }, { seed: true, at: at(G.date.add(d, -2), '15:00'), user: jefe && jefe.name });
      if (stage === 'PLANNED') return o;
      release(o.id, { seed: true, at: at(G.date.add(d, -1), '16:00') });
      if (stage === 'RELEASED') return o;
      const u = seedUser(o); const uo = { seed: true, user: u.name, userId: u.id };
      const inV = G.db.find('product_variants', x => x.product_id === t.input_product_id);
      const q = R(inKg * (1 + noise(0.02)), 3);
      const wh = ensure(inV.id, o, q, d);
      consume(o.id, { variant_id: inV.id, qty: q, warehouse_id: wh, at: at(d, '07:05') }, uo);
      labor(o, d, Math.max(1, q / 30), ['CUTTER', 'HELPER']);
      equip(o, d, t.species === 'CERDO' || t.species === 'CORDERO' ? [['SIE-L1', R(q / 60 + 0.3, 2)]] : [['SEL-L1', 0.5]]);
      const lines = G.des.lines(t.id);
      const supplierPenalty = extra.penalty || 0;
      const plan = []; let sum = 0;
      for (const tl of lines) {
        if (tl.role === 'WASTE') continue;
        const pct = Math.max(0.5, tl.standard_yield_pct + noise(tl.role === 'CO_PRODUCT' ? 1.6 : 0.9) - (tl.role === 'CO_PRODUCT' ? supplierPenalty : 0));
        const kg = R(q * pct / 100, 3); sum += kg; plan.push({ tl, kg });
      }
      if (extra.partial) plan.splice(extra.partial);
      const unreg = R(q * (0.002 + r() * 0.008), 3);
      const wasteKg = R(q - sum - unreg, 3);
      // costeo conjunto previo, para que el lote entre con su costo final
      const joint = computeCost(o).total; const alloc = G.des.allocate(joint, plan.map(x => ({ key: x.tl.id, role: x.tl.role, kg: x.kg, ref_price: G.des.refPrice(x.tl.output_variant_id, d), nrv_cost: x.tl.nrv_cost_per_kg })));
      const scale = equipmentList('es-L1').find(e => e.category === 'SCALE' && e.status === 'ACTIVE' && e.calibration_valid_until >= d);
      for (const x of plan) {
        const v = G.variant(x.tl.output_variant_id); const qq = v.sale_mode === 'KG' ? x.kg : Math.max(1, Math.round(x.kg / unitKg(v.id)));
        const a = alloc.rows.find(z => z.key === x.tl.id);
        const row = output(o.id, { variant_id: v.id, output_role: x.tl.role, template_line_id: x.tl.id, qty: qq, weight_kg: x.kg, unit_cost: a ? R(a.allocated / qq, 6) : 0, scale_equipment_id: scale && scale.id, at: at(d, '09:' + U.pad(5 + plan.indexOf(x) * 4, 2)), qc_status: 'RELEASED' }, uo);
        if (stage === 'CLOSE' && d <= G.date.add(G.TODAY, -1)) { const by = x.tl.role === 'BY_PRODUCT' || KEEP.has(v.id); if (by || d < G.date.add(G.TODAY, -1)) releaseLot(row.lot_id, at(d, by ? '10:30' : '16:00')); if (!KEEP.has(v.id)) sellPlan.push({ lot_id: row.lot_id, d, share: SELL[v.id] }); }
      }
      if (!extra.partial && wasteKg > 0) output(o.id, { output_role: 'WASTE', weight_kg: wasteKg, waste_reason: 'Hueso astillado, sangre y recortes no aprovechables', template_line_id: (lines.find(l => l.role === 'WASTE') || {}).id, at: at(d, '09:50') }, uo);
      finish(o, d, d, stage);
      return o;
    }

    function packingOrder(d, units, stage = 'CLOSE') {
      const ln = lineOf('pl-L1-VAC');
      const kgPlan = R(units * 0.85, 3);
      const o = create({ order_type: 'PACKING', line_id: ln.id, source_variant_id: 'va-DG-CUY-ENT', output_variant_id: 'va-DG-CUY-CNG', planned_output_kg: kgPlan, planned_date: d, supervisor_user_id: jefe && jefe.id }, { seed: true, at: at(G.date.add(d, -2), '15:00'), user: jefe && jefe.name });
      release(o.id, { seed: true, at: at(G.date.add(d, -1), '16:00') });
      if (stage === 'RELEASED') return o;
      const u = seedUser(o); const uo = { seed: true, user: u.name, userId: u.id };
      // cuyes enteros del día anterior (lote de beneficio de la granja)
      const lot = G.db.insert('lots', { product_id: 'pr-CUY-ENT', variant_id: 'va-DG-CUY-ENT', code: `L${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}-G${U.pad(G.db.next('LOTPRO-GRJ', '', 1), 2)}`, origin: 'FARM', supplier_id: 'su-GRANJA', production_date: G.date.add(d, -1), expiry_date: G.date.add(d, 6), qc_status: 'RELEASED', unit_cost: 26.5, released_at: G.date.add(d, -1) + 'T17:00', released_by: cal ? cal.name : 'Calidad' }, { silent: true });
      const w = R(units * (0.86 + noise(0.02)), 3);
      G.inv.move({ type: 'RECEIPT', wh: 'wh-CAM-L1', variant: 'va-DG-CUY-ENT', lot: lot.id, qty: units, weight: w, unitCost: R(26.5 * (1 + noise(0.02)), 4), source: { type: 'FARM_RECEIPT', id: 'GRJ-' + d }, at: G.date.add(d, -1) + 'T16:30', reason: 'Recepción de la granja para congelar' });
      consume(o.id, { variant_id: 'va-DG-CUY-ENT', lot_id: lot.id, qty: units, weight_kg: w, warehouse_id: 'wh-CAM-L1', at: at(d, '08:00') }, Object.assign({ fefoChecked: true }, uo));
      const wh = ensure('va-EM-VAC-2030', o, units, d);
      consume(o.id, { variant_id: 'va-EM-VAC-2030', qty: units, warehouse_id: wh, at: at(d, '08:05') }, uo);
      labor(o, d, 2, ['PACKER']); equip(o, d, [['SEL-L1', 1.5]]);
      const outKg = R(w * (0.985 + noise(0.006)), 3);
      const c = computeCost(o);
      const row = output(o.id, { variant_id: 'va-DG-CUY-CNG', output_role: 'MAIN', qty: units, weight_kg: outKg, unit_cost: R(c.total / units, 6), at: at(d, '10:00'), qc_status: 'RELEASED' }, uo);
      if (d < G.date.add(G.TODAY, -1)) releaseLot(row.lot_id, at(G.date.add(d, 1), '09:30'));
      finish(o, d, d, stage);
      return o;
    }

    // calendario de producción: lunes a sábado
    const start = '2026-09-01';
    for (let d = start; d < G.TODAY; d = G.date.add(d, 1)) {
      const dow = G.date.parse(d).getUTCDay(); if (dow === 0) continue;
      const wk = Math.floor(G.date.diff(d, start) / 7);
      if ([1, 3, 5].includes(dow)) cuttingOrder('ct-CER-1', d, R(72 + noise(8), 1), 'CLOSE', { penalty: G.date.parse(d).getUTCDate() % 3 === 0 ? 1.2 : 0 });
      if (dow === 2 || (dow === 4 && wk % 2 === 0)) cuttingOrder('ct-CUY-1', d, R(22 + noise(3), 1));
      if (dow === 4 && wk % 2 === 1) cuttingOrder('ct-COR-1', d, R(19 + noise(2), 1));
      if (dow === 6) cuttingOrder(wk % 2 ? 'ct-CON-1' : 'ct-CUY-1', d, R(wk % 2 ? 16 : 20, 1));
      if (dow === 1) packingOrder(d, 24 + Math.round(noise(4)));
      if (dow === 2 || dow === 5) recipeOrder('RC-CHO', d, 25, 'CLOSE', d === '2026-09-18' ? { yDrop: 4.5 } : {});
      if (dow === 4) recipeOrder('RC-HUA', d, 20);
      if (dow === 6) recipeOrder('RC-MOR', d, 15);
      if (dow === 3) recipeOrder(wk % 2 ? 'RC-PAN' : 'RC-JAM', d, wk % 2 ? 10 : 18);
      if (dow === 1) recipeOrder('RC-MAN', d, 20);
      if (dow === 2 || dow === 5) recipeOrder('RC-CAL', d, 40);
      if (dow === 3) recipeOrder('RC-MAG', d, 30);
      if (dow === 4) recipeOrder('RC-CGA', d, 30);
      if (dow === 5 && wk % 2 === 0) recipeOrder('RC-MFR', d, 25);
      if (dow === 6) recipeOrder('RC-CAF', d, 24, 'CLOSE', wk === 2 ? { closeDay: G.date.add(d, 2) } : {});
    }
    // una orden anulada sin movimientos
    const ov = recipeOrder('RC-MAG', '2026-09-24', 30, 'PLANNED');
    if (ov) voidOrder(ov.id, 'El proveedor no entregó el aguaymanto; se reprograma para la semana siguiente.', { seed: true, at: '2026-09-23T17:10', user: jefe && jefe.name });
    // hoy (sábado 10/10): en curso, liberadas y planificadas
    const t = G.TODAY;
    const oCho = recipeOrder('RC-CHO', t, 25, 'NO_OUTPUT', { partialCcp: true, noBad: true });
    if (oCho) oCho.notes = 'Masa embutida; falta reposo en cámara y registro de producción.';
    cuttingOrder('ct-CUY-1', t, 21.5, 'OPEN', { partial: 2 });
    const oCal = recipeOrder('RC-CAL', t, 40, 'NO_OUTPUT', { partialCcp: true, noBad: true });
    recipeOrder('RC-MFR', t, 25, 'RELEASED');
    recipeOrder('RC-CAF', t, 24, 'PLANNED');
    recipeOrder('RC-MAN', G.date.add(t, 2), 20, 'PLANNED');
    cuttingOrder('ct-CER-1', G.date.add(t, 2), 75, 'PLANNED');
    recipeOrder('RC-JAM', G.date.add(t, 3), 18, 'PLANNED');
    recipeOrder('RC-HUA', G.date.add(t, 5), 20, 'PLANNED');
    // ventas consolidadas de lo producido (salida del kardex por despacho de pedidos del período)
    for (const s of sellPlan) {
      const l = G.db.get('lots', s.lot_id); if (!l || l.qc_status !== 'RELEASED') continue;
      const bal = G.db.find('stock_balances', b => b.lot_id === l.id && b.qty > 0); if (!bal) continue;
      const expired = l.expiry_date < G.TODAY;
      const share = s.share != null ? s.share : expired ? 1 : 0.35 + r() * 0.4;
      let q = bal.qty * share; const v = G.variant(l.variant_id); q = v.sale_mode === 'KG' ? R(q, 3) : Math.floor(q);
      if (expired && s.share == null) q = bal.qty;
      if (!(q > 0)) continue;
      const day = G.date.add(s.d, 1 + Math.floor(r() * 2)); if (day > G.TODAY) continue;
      G.inv.move({ type: 'SALE', wh: bal.warehouse_id, variant: l.variant_id, lot: l.id, qty: q, weight: v.sale_mode === 'UNIT' ? null : R(bal.weight_kg * q / bal.qty, 3), source: { type: 'SALES_SUMMARY', id: 'VTA-' + day }, at: day + 'T19:00', reason: 'Salida por pedidos despachados (consolidado del día)', allowUnreleased: true });
    }
    // bajas por vencimiento de subproductos que no se usaron
    for (const b of G.db.where('stock_balances', b => b.qty > 0.0005 && b.lot_id)) {
      const l = G.db.get('lots', b.lot_id); if (!l || !l.production_order_id && !/-P\d{3}$/.test(l.code)) continue;
      if (l.expiry_date && l.expiry_date < G.TODAY) G.inv.move({ type: 'WASTE', wh: b.warehouse_id, variant: b.variant_id, lot: l.id, qty: b.qty, weight: G.variant(b.variant_id).sale_mode === 'UNIT' ? null : b.qty, source: { type: 'EXPIRY', id: l.id }, at: G.date.add(l.expiry_date, 1) + 'T08:00', reason: 'Baja por vencimiento', allowUnreleased: true });
    }
    // stock vigente de insumos para la semana (dos lotes con vencimientos distintos para mostrar FEFO)
    for (const rc of G.db.all('recipes')) {
      const v = G.rec.current(rc.id); if (!v) continue;
      const ln = lineOf('pl-' + rc.line_code); if (!ln) continue;
      for (const it of G.rec.ingredients(v.id)) {
        const p = G.productOf(it.variant_id); const wh = ln.establishment_id === 'es-L2' ? storageWh(it.variant_id, 'es-L2') : storageWh(it.variant_id, 'es-L1');
        const need = R(it.qty_kg * 2.5, 3);
        if (availAt(it.variant_id, wh, G.TODAY) >= need) continue;
        if (!p.requires_lot) { receive(it.variant_id, wh, Math.ceil(need), G.date.add(G.TODAY, -1)); continue; }
        receive(it.variant_id, wh, R(Math.ceil(need * 0.6 * 2) / 2, 3), G.date.add(G.TODAY, -2));
        receive(it.variant_id, wh, R(Math.ceil(need * 0.6 * 2) / 2, 3), G.TODAY);
      }
    }
    // carne de cerdo en el local 1: dos lotes para la demo de FEFO (PRO-06)
    receive('va-MP-CER-MR', 'wh-CAM-L1', 80, G.date.add(G.TODAY, -1));
    if (oCal) oCal.notes = 'Cocción en marcha desde las 08:30; falta el registro de producción y el enfriado.';
    G.db.touch();
  }, 'PRO historial');

  /* =====================================================================
     Interfaz
     ===================================================================== */
  const scopedOrders = pred => G.scope.filter(G.db.all(T_O)).filter(pred || (() => true));
  const ordLabel = o => `${o.number} · ${productLabel(o)} · ${G.siteName(o.establishment_id)}`;
  function productLabel(o) {
    if (o.order_type === 'RECIPE' && G.rec) { const v = G.rec.version(o.recipe_version_id); const rc = v && G.rec.recipe(v.recipe_id); return rc ? `${rc.name} v${v.version}` : '—'; }
    if (o.order_type === 'CUTTING' && G.des) { const t = G.des.template(o.cutting_template_id); return t ? `Despiece ${t.name}` : 'Despiece'; }
    return `${G.variantName(o.source_variant_id)} → ${G.variantName(o.output_variant_id)}`;
  }
  /** selector de orden para las pantallas de planta (PRO-06…10, DES-04…06) */
  function orderPicker(code, params, pred, opts = {}) {
    const list = scopedOrders(pred).sort((a, b) => (ACTIVE.includes(b.status) - ACTIVE.includes(a.status)) || String(b.planned_date).localeCompare(a.planned_date) || String(b.number).localeCompare(a.number));
    let o = params && params.id ? ord(params.id) : null;
    if (o && !G.scope.ok(o)) o = null;
    if (!o) o = list.find(x => ACTIVE.includes(x.status)) || list[0] || null;
    const sel = h('select', { class: 'input', style: 'width:100%;max-width:560px;min-width:0', attrs: { 'aria-label': 'Orden de producción', id: code + '-order' } }, list.slice(0, 120).map(x => h('option', { value: x.id, selected: o && x.id === o.id }, `${ordLabel(x)} · ${(OSTAT[x.status] || [x.status])[0]}`)));
    sel.addEventListener('change', () => G.go(code, { id: sel.value }));
    const node = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;align-items:center' }, h('span', { class: 'small muted' }, opts.label || 'Orden'), sel, o ? ost(o.status) : null, o ? btn('Ficha', () => G.go('PRO-11', { id: o.id }), { sm: true, kind: 'ghost' }) : null);
    return { o, node };
  }
  function yieldBadge(o, c) {
    const dev = o.status === 'CLOSED' ? o.yield_deviation_pp : c && c.deviation;
    if (dev == null) return badge('—', '');
    const tol = G.param('pro_yield_tolerance_pp');
    return badge(`${dev > 0 ? '+' : ''}${F.num(dev, 2)} pp`, Math.abs(dev) <= tol ? 'ok' : Math.abs(dev) <= tol * 1.7 ? 'warn' : 'bad');
  }
  function costBadge(o) {
    if (o.status !== 'CLOSED' || o.order_type !== 'RECIPE' || !o.standard_cost_per_kg || o.ingredient_cost_per_kg == null) return badge('—', '');
    const v = R((o.ingredient_cost_per_kg - o.standard_cost_per_kg) / o.standard_cost_per_kg * 100, 1);
    return badge(`${v > 0 ? '+' : ''}${F.num(v, 1)} %`, v <= 3 ? 'ok' : v <= 8 ? 'warn' : 'bad');
  }
  function stepsOf(o) {
    const st = [['PLANNED', 'Planificada'], ['RELEASED', 'Liberada'], ['IN_PROGRESS', 'En proceso'], ['CLOSED', 'Cerrada']];
    if (o.status === 'VOIDED') return h('div', { class: 'steps' }, h('span', { class: 'step cur' }, 'Anulada: ' + (o.void_reason || '')));
    const idx = st.findIndex(s => s[0] === o.status);
    return h('div', { class: 'steps' }, st.map(([k, l], i) => h('span', { class: 'step' + (i < idx ? ' done' : i === idx ? ' cur' : '') }, h('span', { class: 'n' }, i + 1), l)));
  }
  const lotCell = id => { const l = G.db.get('lots', id); return l ? h('span', null, h('span', { class: 'mono' }, l.code), ' ', G.ui.status(l.qc_status)) : '—'; };
  const actionNav = (o) => h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
    ACTIVE.includes(o.status) ? [
      btn('Consumos', () => G.go(o.order_type === 'CUTTING' && G.screens['DES-04'] ? 'DES-04' : 'PRO-06', { id: o.id }), { sm: true }),
      o.order_type === 'RECIPE' ? btn('Puntos de control', () => G.go('PRO-07', { id: o.id }), { sm: true }) : null,
      btn('Producción', () => G.go(o.order_type === 'CUTTING' && G.screens['DES-04'] ? 'DES-04' : 'PRO-08', { id: o.id }), { sm: true }),
      btn('Personal y equipos', () => G.go('PRO-09', { id: o.id }), { sm: true }),
      btn('Cierre', () => G.go('PRO-10', { id: o.id }), { sm: true, kind: 'primary' })] : null,
    o.status === 'PLANNED' ? btn('Liberar', () => run(() => release(o.id), `Orden ${o.number} liberada a planta`), { sm: true, kind: 'primary', disabled: !G.can('pro.order.create') }) : null,
    OPEN.includes(o.status) && !consOf(o.id).length && !outsOf(o.id).length ? btn('Anular', () => G.go('PRO-13', { id: o.id }), { sm: true, kind: 'danger' }) : null,
    o.order_type === 'CUTTING' && G.screens['DES-06'] ? btn('Costeo conjunto', () => G.go('DES-06', { id: o.id }), { sm: true }) : null);

  /* ---------- PRO-01 Líneas de producción ---------- */
  function renderLines(el) {
    const rows = G.scope.filter(G.db.all(T_L));
    const monthFrom = G.date.month(G.TODAY);
    const kgByLine = U.groupBy(G.db.where(T_O, o => o.status === 'CLOSED' && o.close_date >= monthFrom), 'line_id');
    G.ui.crud(el, {
      code: 'PRO-01', title: 'Líneas de producción', sub: 'Qué se produce en cada local, de qué almacén salen los insumos, a dónde entra el producto terminado y a qué centro de costo va (D-PRO-01: Local 1 cortes, vacío, embutidos y ahumados; Local 2 mantecas, caldos, mermeladas y café).',
      table: T_L, rows: () => rows, createLabel: 'Nueva línea', canCreate: G.can('pro.order.create'), canEdit: G.can('pro.order.create'),
      kpis: () => [{ label: 'Líneas activas', value: rows.filter(l => l.status === 'ACTIVE').length, sub: `${rows.filter(l => l.establishment_id === 'es-L1').length} en Local 1 · ${rows.filter(l => l.establishment_id === 'es-L2').length} en Local 2` }, { label: 'Órdenes abiertas', value: scopedOrders(o => OPEN.includes(o.status)).length, sub: 'planificadas, liberadas o en proceso' }, { label: 'Kg producidos en el mes', value: F.kg(U.sum(Object.values(kgByLine).flat(), o => o.main_kg), 0), sub: 'órdenes cerradas desde ' + F.date(monthFrom) }],
      filters: [{ key: 'establishment_id', label: 'Local', options: G.ui.opts('establishments', e => e.short || e.name) }, { key: 'line_type', label: 'Tipo', options: LINE_TYPES }],
      columns: [
        { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Línea' }, { key: 'establishment_id', label: 'Local', value: l => G.siteName(l.establishment_id) },
        { key: 'line_type', label: 'Tipo', value: l => lbl(LINE_TYPES, l.line_type) }, { key: 'input_warehouse_id', label: 'Almacén de insumos', value: l => G.whName(l.input_warehouse_id) },
        { key: 'output_warehouse_id', label: 'Producto terminado', value: l => G.whName(l.output_warehouse_id) }, { key: 'cost_center_id', label: 'Centro de costo', value: l => G.ccName(l.cost_center_id) },
        { key: 'max_waste_pct', label: 'Merma máx.', align: 'r', render: l => F.pct(l.max_waste_pct, 1) },
        { key: 'kg', label: 'Kg del mes', align: 'r', value: l => U.sum(kgByLine[l.id] || [], o => o.main_kg), render: l => F.num(U.sum(kgByLine[l.id] || [], o => o.main_kg), 1) },
        { key: 'status', label: 'Estado', render: l => G.ui.status(l.status) },
      ],
      fields: [
        { key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true },
        { key: 'establishment_id', label: 'Local', type: 'select', required: true, options: G.ui.opts('establishments', e => e.short || e.name) },
        { key: 'line_type', label: 'Tipo de línea', type: 'select', required: true, options: LINE_TYPES },
        { key: 'input_warehouse_id', label: 'Almacén de insumos', type: 'select', options: G.ui.opts('warehouses', w => `${w.name} (${G.siteName(w.establishment_id)})`) },
        { key: 'output_warehouse_id', label: 'Almacén de producto terminado', type: 'select', options: G.ui.opts('warehouses', w => `${w.name} (${G.siteName(w.establishment_id)})`) },
        { key: 'cost_center_id', label: 'Centro de costo', type: 'select', options: G.ui.opts('cost_centers', c => `${c.code} · ${c.name}`) },
        { key: 'max_waste_pct', label: 'Merma máxima sin motivo (%)', type: 'number', min: 0, max: 100, help: 'RN-PRO-08: por defecto ' + G.param('pro_max_waste_pct') + ' %.' },
        { key: 'status', label: 'Estado', type: 'select', required: true, options: [['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva']] },
      ],
      defaults: () => ({ status: 'ACTIVE', max_waste_pct: G.param('pro_max_waste_pct'), establishment_id: G.ctx.site !== 'ALL' ? G.ctx.site : 'es-L1' }),
      beforeSave: (v, row) => { if (G.db.find(T_L, l => l.code === v.code && (!row || l.id !== row.id))) return { code: 'Ya existe una línea con ese código.' }; const wi = G.db.get('warehouses', v.input_warehouse_id), wo = G.db.get('warehouses', v.output_warehouse_id); if ((wi && wi.establishment_id !== v.establishment_id) || (wo && wo.establishment_id !== v.establishment_id)) return 'Los almacenes deben ser del mismo local de la línea.'; },
      detail: l => { const os = G.db.where(T_O, o => o.line_id === l.id).sort(U.by('planned_date', -1)); return h('div', { class: 'stack' }, dl([['Local', G.siteName(l.establishment_id)], ['Tipo', lbl(LINE_TYPES, l.line_type)], ['Almacén de insumos', G.whName(l.input_warehouse_id)], ['Producto terminado', G.whName(l.output_warehouse_id)], ['Centro de costo', G.ccName(l.cost_center_id)], ['Merma máxima', F.pct(l.max_waste_pct, 1)], ['Equipos del local', equipmentList(l.establishment_id).map(e => e.name).join(', ')]]), h('h3', null, 'Últimas órdenes'), table({ id: 'pro01o-' + l.id, rows: os.slice(0, 30), search: false, pageSize: 10, onRow: o => G.go('PRO-11', { id: o.id }), columns: [{ key: 'number', label: 'Orden', mono: true }, { key: 'planned_date', label: 'Fecha', render: o => F.date(o.planned_date) }, { key: 'p', label: 'Producto', value: productLabel }, { key: 'main_kg', label: 'Kg', align: 'r', render: o => o.main_kg ? F.num(o.main_kg, 1) : '—' }, { key: 'status', label: 'Estado', render: o => ost(o.status) }] })); },
    });
  }

  /* ---------- PRO-02 Plan semanal ---------- */
  function planData(site) {
    const from = G.TODAY, to = G.date.add(G.TODAY, 6);
    const prodVars = new Map();
    // productos que se producen con receta aprobada o salen de una plantilla de despiece activa
    const recipes = G.rec ? G.db.all('recipes').filter(rc => rc.status === 'ACTIVE' && G.rec.current(rc.id)) : [];
    for (const rc of recipes) prodVars.set(rc.product_id, { kind: 'RECIPE', recipe: rc, version: G.rec.current(rc.id), line: lineOf('pl-' + rc.line_code) });
    const tpls = G.des ? G.db.where('cutting_templates', t => t.status === 'ACTIVE') : [];
    for (const t of tpls) for (const tl of G.des.lines(t.id)) if (tl.role === 'CO_PRODUCT' && tl.output_variant_id) { const pid = (G.variant(tl.output_variant_id) || {}).product_id; if (pid && !prodVars.has(pid)) prodVars.set(pid, { kind: 'CUTTING', template: t, tline: tl, line: lineOf('pl-L1-COR') }); }
    const demand = new Map(), sold = new Map();
    const d30 = G.date.add(G.TODAY, -30);
    for (const so of G.db.all('sales_orders')) {
      const dd = String(so.delivery_date || '').slice(0, 10);
      const isOpen = ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY'].includes(so.status) && dd >= from && dd <= to;
      const isSold = ['DELIVERED', 'CLOSED'].includes(so.status) && dd >= d30 && dd < G.TODAY;
      if (!isOpen && !isSold) continue;
      for (const l of so.lines || []) {
        const v = G.variant(l.variant_id); if (!v || !prodVars.has(v.product_id)) continue;
        const kg = l.weighed_kg || (v.sale_mode === 'KG' ? l.qty : l.est_weight_kg || l.qty * unitKg(v.id));
        const m = isOpen ? demand : sold; m.set(v.product_id, (m.get(v.product_id) || 0) + kg);
      }
    }
    const days = G.param('pro_safety_stock_days');
    const rows = [];
    for (const [pid, info] of prodVars) {
      const p = G.db.get('products', pid); if (!p) continue;
      if (site && info.line && info.line.establishment_id !== site) continue;
      const vars = G.db.where('product_variants', v => v.product_id === pid);
      const stock = R(U.sum(vars, v => G.inv.qty(v.id, null, { releasedOnly: true }) * (v.sale_mode === 'KG' ? 1 : unitKg(v.id))), 2);
      const openKg = R(U.sum(G.db.where(T_O, o => OPEN.includes(o.status) && (o.product_id === pid || (o.order_type === 'CUTTING' && info.kind === 'CUTTING' && o.cutting_template_id === info.template.id))), o => o.order_type === 'CUTTING' ? o.planned_output_kg * (info.tline ? info.tline.standard_yield_pct / 100 : 1) : o.planned_output_kg), 2);
      const dem = R(demand.get(pid) || 0, 2), safety = R((sold.get(pid) || 0) / 30 * days, 2);
      const need = R(dem + safety - stock - openKg, 2);
      let sugKg = 0;
      if (need > 0) {
        if (info.kind === 'RECIPE') { const base = info.version.base_output_kg; sugKg = Math.ceil(need / base) * base; }
        else sugKg = R(Math.ceil(need / (info.tline.standard_yield_pct / 100) / 5) * 5, 1);
      }
      rows.push({ id: pid, p, info, dem, safety, stock, openKg, need, sugKg, site: info.line && info.line.establishment_id });
    }
    return rows.sort((a, b) => b.need - a.need);
  }
  function renderPlan(el) {
    const site = G.ctx.site !== 'ALL' ? G.ctx.site : null;
    const body = page(el, { code: 'PRO-02', title: 'Plan semanal', sub: `Necesidad = pedidos confirmados (${F.date(G.TODAY)} al ${F.date(G.date.add(G.TODAY, 6))}) + stock de seguridad (${G.param('pro_safety_stock_days')} días de venta promedio) − stock liberado − órdenes abiertas. Sugiere órdenes por línea y local.`, actions: [btn('Requerimiento de insumos', () => G.go('PRO-03'), { sm: true })] });
    const rows = planData(site);
    const sug = rows.filter(r => r.sugKg > 0);
    body.appendChild(kpis([
      { label: 'Productos con necesidad', value: sug.length, sub: `de ${rows.length} productos con receta o plantilla`, tone: sug.length ? 'warn' : 'ok' },
      { label: 'Kg sugeridos', value: F.kg(U.sum(sug, r => r.sugKg), 0) },
      { label: 'Demanda confirmada', value: F.kg(U.sum(rows, r => r.dem), 1), sub: 'pedidos de los próximos 7 días' },
      { label: 'Órdenes abiertas', value: scopedOrders(o => OPEN.includes(o.status)).length, sub: F.kg(U.sum(rows, r => r.openKg), 0) + ' en curso o por hacer' },
    ]));
    const planOne = (r) => {
      if (!G.can('pro.order.create')) return toast(`Tu rol (${G.roleName()}) no crea órdenes (pro.order.create).`, 'warn');
      const date = G.date.add(G.TODAY, 2);
      run(() => r.info.kind === 'RECIPE' ? create({ order_type: 'RECIPE', line_id: r.info.line.id, recipe_version_id: r.info.version.id, planned_output_kg: r.sugKg, planned_date: date, supervisor_user_id: G.ctx.userId() }) : create({ order_type: 'CUTTING', line_id: r.info.line.id, cutting_template_id: r.info.template.id, planned_output_kg: r.sugKg, planned_date: date, supervisor_user_id: G.ctx.userId() }), o => `Orden ${o.number} planificada para el ${F.date(date)}`);
    };
    body.appendChild(table({
      id: 'pro02', rows, pageSize: 30,
      filters: [{ key: 'site', label: 'Local', options: [['es-L1', 'Local 1'], ['es-L2', 'Local 2']] }, { key: 'kind', label: 'Origen', value: r => r.info.kind, options: [['RECIPE', 'Receta'], ['CUTTING', 'Despiece']] }],
      columns: [
        { key: 'p', label: 'Producto', value: r => r.p.name }, { key: 'b', label: 'Marca', value: r => G.brandName(r.p.brand_id) },
        { key: 'line', label: 'Línea', value: r => r.info.line ? `${r.info.line.code} · ${G.siteName(r.info.line.establishment_id)}` : '—' },
        { key: 'src', label: 'Cómo se produce', value: r => r.info.kind === 'RECIPE' ? `${r.info.recipe.code} v${r.info.version.version}` : `${r.info.template.code} (${F.pct(r.info.tline.standard_yield_pct, 1)})` },
        { key: 'dem', label: 'Pedidos (kg)', align: 'r', render: r => F.num(r.dem, 1) }, { key: 'safety', label: 'Seguridad (kg)', align: 'r', render: r => F.num(r.safety, 1) },
        { key: 'stock', label: 'Stock liberado', align: 'r', render: r => F.num(r.stock, 1) }, { key: 'openKg', label: 'Órdenes abiertas', align: 'r', render: r => F.num(r.openKg, 1) },
        { key: 'need', label: 'Necesidad', align: 'r', render: r => h('b', { style: r.need > 0 ? 'color:var(--bad)' : '' }, F.num(r.need, 1)) },
        { key: 'sugKg', label: 'Sugerido', align: 'r', render: r => r.sugKg ? h('b', null, r.info.kind === 'CUTTING' ? `${F.num(r.sugKg, 0)} kg de entrada` : F.kg(r.sugKg, 0)) : '—' },
      ],
      actions: r => r.sugKg ? [btn('Planificar', () => planOne(r), { sm: true, kind: 'primary', disabled: !G.can('pro.order.create') })] : [],
    }));
    const next = scopedOrders(o => o.status === 'PLANNED').sort(U.by('planned_date'));
    body.appendChild(card('Órdenes planificadas', next.length ? table({ id: 'pro02n', rows: next, search: false, onRow: o => G.go('PRO-11', { id: o.id }), columns: [{ key: 'number', label: 'Orden', mono: true }, { key: 'planned_date', label: 'Fecha', render: o => F.date(o.planned_date) }, { key: 'l', label: 'Línea', value: o => (lineOf(o.line_id) || {}).code }, { key: 'p', label: 'Producto', value: productLabel }, { key: 'planned_output_kg', label: 'Kg', align: 'r' }], actions: o => [btn('Liberar', () => run(() => release(o.id), `Orden ${o.number} liberada`), { sm: true, disabled: !G.can('pro.order.create') })] }) : G.ui.empty('No hay órdenes planificadas.'), { flush: true }));
  }

  /* ---------- PRO-03 Requerimiento de insumos ---------- */
  function requirementRows(site) {
    const os = scopedOrders(o => ['PLANNED', 'RELEASED'].includes(o.status) && (!site || o.establishment_id === site));
    const need = new Map();
    for (const o of os) for (const t of theoretical(o)) {
      const k = o.establishment_id + '|' + t.variant_id;
      const x = need.get(k) || { site: o.establishment_id, variant_id: t.variant_id, role: t.role, qty: 0, orders: [] };
      x.qty = R(x.qty + (t.role === 'PACKAGING' ? t.qty : t.kg || t.qty), 3); x.orders.push(o.number); need.set(k, x);
    }
    return [...need.values()].map(x => {
      const whs = siteWarehouses(x.site).map(w => w.id);
      const stock = R(U.sum(whs, w => availAt(x.variant_id, w, G.TODAY)), 3);
      return Object.assign(x, { id: x.site + x.variant_id, stock, short: R(Math.max(0, x.qty - stock), 3), cost: G.inv.avg(x.variant_id) });
    }).sort((a, b) => b.short - a.short || String(a.variant_id).localeCompare(b.variant_id));
  }
  const reqState = { sel: {} };
  function renderReq(el) {
    const site = G.ctx.site !== 'ALL' ? G.ctx.site : null;
    const rows = requirementRows(site);
    const short = rows.filter(r => r.short > 0);
    const body = page(el, { code: 'PRO-03', title: 'Requerimiento de insumos', sub: 'Explota las órdenes planificadas y liberadas con la receta escalada (RN-PRO-12), compara con el stock liberado y no vencido del local y propone requerimientos de compra (COM-03).' });
    body.appendChild(kpis([
      { label: 'Órdenes explotadas', value: scopedOrders(o => ['PLANNED', 'RELEASED'].includes(o.status) && (!site || o.establishment_id === site)).length },
      { label: 'Insumos requeridos', value: rows.length },
      { label: 'Con faltante', value: short.length, tone: short.length ? 'bad' : 'ok' },
      { label: 'Valor del faltante', value: money(U.sum(short, r => r.short * r.cost)), sub: 'al costo promedio vigente' },
    ]));
    const propose = () => {
      const pick = short.filter(r => reqState.sel[r.id] !== false);
      if (!pick.length) return toast('No hay faltantes seleccionados.', 'warn');
      const lines = pick.map(r => ({ variant_id: r.variant_id, qty: r.short, establishment_id: r.site, needed_by: G.date.add(G.TODAY, 1), source: 'PRO-03', orders: r.orders }));
      let via = 'aviso a Compras';
      if (G.com && typeof G.com.addRequirements === 'function') { try { G.com.addRequirements(lines); via = 'COM-03'; } catch (e) { return toast(e.message, 'bad'); } }
      else G.notify({ role: 'COMPRAS', title: `Requerimiento de producción: ${pick.length} insumos`, body: pick.map(r => `${G.variantName(r.variant_id)}: ${F.num(r.short, 3)} (${G.siteName(r.site)})`).join(' · '), ref: 'PRO-03', tone: 'warn', module: 'PRO' });
      G.audit('REQUERIR', 'production_orders', 'PRO-03', `${pick.length} insumos`);
      toast(`Requerimiento enviado (${via}): ${pick.length} insumos`, 'ok');
    };
    body.appendChild(table({
      id: 'pro03', rows, pageSize: 30,
      toolbar: [btn('Proponer requerimiento de compra', propose, { sm: true, kind: 'primary', disabled: !short.length || !(G.can('pro.order.create') || G.ctx.role === 'GERENTE') })],
      filters: [{ key: 'site', label: 'Local', options: [['es-L1', 'Local 1'], ['es-L2', 'Local 2']] }, { key: 'role', label: 'Tipo', options: C_ROLES }, { key: 'falta', label: 'Faltante', value: r => r.short > 0 ? 'S' : 'N', options: [['S', 'Con faltante'], ['N', 'Cubierto']] }],
      columns: [
        { key: 'sel', label: '', sort: false, render: r => { if (!(r.short > 0)) return ''; const c = h('input', { type: 'checkbox', checked: reqState.sel[r.id] !== false, attrs: { 'aria-label': 'Incluir ' + G.variantName(r.variant_id) } }); c.addEventListener('click', e => e.stopPropagation()); c.addEventListener('change', () => { reqState.sel[r.id] = c.checked; }); return c; } },
        { key: 'v', label: 'Insumo', value: r => G.variantName(r.variant_id) }, { key: 'role', label: 'Tipo', value: r => lbl(C_ROLES, r.role) }, { key: 'site', label: 'Local', value: r => G.siteName(r.site) },
        { key: 'qty', label: 'Requerido', align: 'r', render: r => F.num(r.qty, 3) }, { key: 'stock', label: 'Stock liberado', align: 'r', render: r => F.num(r.stock, 3) },
        { key: 'short', label: 'Faltante', align: 'r', render: r => r.short > 0 ? h('b', { style: 'color:var(--bad)' }, F.num(r.short, 3)) : badge('Cubierto', 'ok') },
        { key: 'cost', label: 'Costo prom.', align: 'r', render: r => money(r.cost) }, { key: 'orders', label: 'Órdenes', value: r => r.orders.join(', ') },
      ],
    }));
  }

  /* ---------- PRO-04 Órdenes de producción ---------- */
  const listState = { range: 'MONTH' };
  function renderOrders(el) {
    const ranges = [['TODAY', 'Hoy'], ['WEEK', '7 días'], ['MONTH', 'Octubre'], ['PREV', 'Setiembre'], ['ALL', 'Todas']];
    const rf = { TODAY: [G.TODAY, G.TODAY], WEEK: [G.date.add(G.TODAY, -6), G.date.add(G.TODAY, 7)], MONTH: [G.date.month(G.TODAY), '9999'], PREV: [G.date.addMonths(G.TODAY, -1), G.date.add(G.date.month(G.TODAY), -1)], ALL: ['0000', '9999'] }[listState.range];
    const all = scopedOrders();
    const rows = all.filter(o => o.planned_date >= rf[0] && o.planned_date <= rf[1]).sort((a, b) => String(b.planned_date).localeCompare(a.planned_date) || String(b.number).localeCompare(a.number));
    const body = page(el, { code: 'PRO-04', title: 'Órdenes de producción', sub: 'Todas las órdenes por local, línea, marca, estado y fecha, con semáforo de rendimiento (real vs esperado) y de costo de ingredientes frente al estándar de la receta.', actions: G.can('pro.order.create') ? [btn('Nueva orden', () => G.go('PRO-05'), { kind: 'primary', icon: '+' })] : [] });
    const closed = rows.filter(o => o.status === 'CLOSED');
    const tol = G.param('pro_yield_tolerance_pp');
    body.appendChild(kpis([
      { label: 'En proceso', value: all.filter(o => o.status === 'IN_PROGRESS').length, sub: `${all.filter(o => o.status === 'RELEASED').length} liberadas · ${all.filter(o => o.status === 'PLANNED').length} planificadas`, onClick: () => { listState.range = 'ALL'; G.refresh(); } },
      { label: 'Cerradas en el rango', value: closed.length, sub: F.kg(U.sum(closed, o => o.main_kg), 0) + ' producidos' },
      { label: 'Fuera de tolerancia', value: closed.filter(o => Math.abs(o.yield_deviation_pp || 0) > tol).length, sub: `rendimiento a más de ${tol} puntos`, tone: closed.some(o => Math.abs(o.yield_deviation_pp || 0) > tol) ? 'warn' : 'ok' },
      canCost() ? { label: 'Costo producido', value: F.money(U.sum(closed, o => o.total_cost), 0), sub: 'órdenes cerradas del rango' } : { label: 'Con punto crítico fuera de rango', value: rows.filter(o => o.critical_deviation).length },
    ]));
    body.appendChild(table({
      id: 'pro04', rows, pageSize: 25,
      toolbar: [pills(ranges, listState.range, v => { listState.range = v; G.refresh(); })],
      filters: [{ key: 'establishment_id', label: 'Local', options: [['es-L1', 'Local 1'], ['es-L2', 'Local 2']] }, { key: 'line_id', label: 'Línea', options: G.db.all(T_L).map(l => [l.id, l.code + ' · ' + l.name]) }, { key: 'brand_id', label: 'Marca', options: G.db.all('brands').map(b => [b.id, G.brandName(b.id)]) }, { key: 'status', label: 'Estado', options: Object.entries(OSTAT).map(([k, v]) => [k, v[0]]) }, { key: 'order_type', label: 'Tipo', options: ORDER_TYPES }],
      onRow: o => G.go('PRO-11', { id: o.id }),
      columns: [
        { key: 'number', label: 'Orden', mono: true }, { key: 'planned_date', label: 'Fecha', render: o => F.date(o.planned_date) },
        { key: 'line', label: 'Línea', value: o => (lineOf(o.line_id) || {}).code }, { key: 'order_type', label: 'Tipo', value: o => lbl(ORDER_TYPES, o.order_type) },
        { key: 'p', label: 'Producto', value: productLabel }, { key: 'brand_id', label: 'Marca', value: o => G.brandName(o.brand_id) },
        { key: 'planned_output_kg', label: 'Kg plan', align: 'r', render: o => F.num(o.planned_output_kg, 1) },
        { key: 'main_kg', label: 'Kg real', align: 'r', value: o => o.status === 'CLOSED' ? o.main_kg : computeCost(o).main_kg, render: o => { const k = o.status === 'CLOSED' ? o.main_kg : computeCost(o).main_kg; return k ? F.num(k, 1) : '—'; } },
        { key: 'y', label: 'Rendimiento', value: o => o.yield_deviation_pp, render: o => yieldBadge(o, o.status !== 'CLOSED' && consOf(o.id).length ? computeCost(o) : null) },
        { key: 'cpk', label: 'Costo/kg', align: 'r', value: o => o.cost_per_kg, render: o => o.cost_per_kg != null ? money(o.cost_per_kg) : '—' },
        { key: 'cs', label: 'vs estándar', value: o => o.ingredient_cost_per_kg, render: o => costBadge(o) },
        { key: 'status', label: 'Estado', render: o => h('span', null, ost(o.status), o.critical_deviation ? badge('PCC', 'bad') : null) },
      ],
    }));
  }

  /* ---------- PRO-05 Nueva orden ---------- */
  function renderNew(el, params = {}) {
    const body = page(el, { code: 'PRO-05', title: 'Nueva orden', sub: 'Una orden de receta toma la versión APROBADA y la deja fija (RN-PRO-01); el factor de escala = kg planificados / kg base de la receta (RN-PRO-12). El despiece usa la plantilla ACTIVA de DES.' });
    if (!G.can('pro.order.create')) { body.appendChild(notice(`Tu rol (${G.roleName()}) no crea órdenes: hace falta el permiso pro.order.create (jefe de producción).`, 'warn')); }
    const preV = params.version && G.rec ? G.rec.version(params.version) : null;
    const preRc = preV ? G.rec.recipe(preV.recipe_id) : null;
    const vals = { order_type: params.type || (params.template ? 'CUTTING' : 'RECIPE'), recipe_id: preRc ? preRc.id : null, cutting_template_id: params.template || null, planned_output_kg: params.kg || 25, planned_date: G.date.add(G.TODAY, 1), supervisor_user_id: G.ctx.userId(), source_variant_id: 'va-DG-CUY-ENT', output_variant_id: 'va-DG-CUY-CNG' };
    const recipes = G.rec ? G.db.all('recipes').filter(rc => rc.status === 'ACTIVE') : [];
    const lineOpts = type => G.scope.filter(G.db.where(T_L, l => l.status === 'ACTIVE')).filter(l => type === 'CUTTING' ? l.line_type === 'CUTTING' : type === 'PACKING' ? l.line_type === 'VACUUM_PACK' : !['CUTTING', 'VACUUM_PACK'].includes(l.line_type)).map(l => [l.id, `${l.code} · ${l.name} (${G.siteName(l.establishment_id)})`]);
    const preview = h('div');
    const draw = () => {
      G.ui.clear(preview);
      const t = vals.order_type; const kg = Number(vals.planned_output_kg) || 0;
      if (t === 'RECIPE') {
        const rc = G.rec && G.rec.recipe(vals.recipe_id); const v = rc && G.rec.current(rc.id);
        if (!rc) return preview.appendChild(notice('Elige la receta.', 'info'));
        if (!v) return preview.appendChild(notice(`RN-PRO-01: «${rc.name}» no tiene versión aprobada. Apruébala en REC-07.`, 'bad'));
        const sc = G.rec.scale(v.id, kg);
        preview.appendChild(h('div', { class: 'stack' }, dl([['Versión fijada', `v${v.version} (aprobada ${F.date(v.approved_at)})`], ['Kg base de salida', F.kg(v.base_output_kg, 3)], ['Factor de escala', F.num(sc.factor, 4)], ['Rendimiento esperado', F.pct(v.expected_yield_pct, 2)], ['Costo estándar', canCost() ? F.money(v.standard_cost_per_kg, 4) + ' por kg' : '—']]),
          table({ id: 'pro05sc', search: false, pageSize: 40, rows: sc.rows, columns: [{ key: 'seq', label: '#', align: 'r' }, { key: 'v', label: 'Ingrediente', value: x => G.variantName(x.variant_id) }, { key: 'base_kg', label: 'Kg base', align: 'r', render: x => F.num(x.base_kg, 4) }, { key: 'kg', label: 'Kg teóricos', align: 'r', render: x => h('b', null, F.num(x.kg, 3)) }, { key: 's', label: 'Stock liberado', align: 'r', render: x => { const ln = lineOf(vals.line_id); const s = ln ? U.sum(siteWarehouses(ln.establishment_id), w => availAt(x.variant_id, w.id, G.TODAY)) : 0; return h('span', { style: s < x.kg ? 'color:var(--bad);font-weight:700' : '' }, F.num(s, 3)); } }] })));
      } else if (t === 'CUTTING') {
        const tp = G.des && G.des.template(vals.cutting_template_id);
        if (!tp) return preview.appendChild(notice('Elige la plantilla de despiece activa.', 'info'));
        preview.appendChild(table({ id: 'pro05ct', search: false, pageSize: 20, rows: G.des.lines(tp.id), columns: [{ key: 'name', label: 'Corte' }, { key: 'role', label: 'Rol', value: x => lbl(O_ROLES, x.role) }, { key: 'standard_yield_pct', label: 'Estándar', align: 'r', render: x => F.pct(x.standard_yield_pct, 1) }, { key: 'kg', label: 'Kg esperados', align: 'r', render: x => F.num(kg * x.standard_yield_pct / 100, 3) }] }));
      } else {
        preview.appendChild(dl([['Entrada estimada', F.kg(kg / 0.98, 3) + ' (rendimiento esperado 98 %)'], ['Bolsas al vacío', Math.ceil(kg / unitKg(vals.output_variant_id))]]));
      }
    };
    const f = form({
      id: 'pro05', values: vals, submitLabel: 'Crear orden',
      fields: [
        { key: 'order_type', label: 'Tipo de orden', type: 'select', required: true, options: ORDER_TYPES, onChange: (v, all, api) => { const opts = lineOpts(v); api.inputs.line_id.innerHTML = ''; opts.forEach(([k, l]) => api.inputs.line_id.appendChild(h('option', { value: k }, l))); all.line_id = opts[0] && opts[0][0]; draw(); } },
        { key: 'line_id', label: 'Línea', type: 'select', required: true, options: () => lineOpts(vals.order_type), onChange: draw },
        { key: 'recipe_id', label: 'Receta (orden RECIPE)', type: 'select', options: recipes.map(rc => { const v = G.rec.current(rc.id); return [rc.id, `${rc.code} · ${rc.name}${v ? ' · v' + v.version : ' · sin versión aprobada'}`]; }), onChange: (v, all, api) => { const rc = G.rec.recipe(v); if (rc) { const l = lineOf('pl-' + rc.line_code); if (l) { api.set('line_id', l.id); all.line_id = l.id; } } draw(); } },
        { key: 'cutting_template_id', label: 'Plantilla de despiece (orden CUTTING)', type: 'select', options: G.des ? G.db.where('cutting_templates', t => t.status === 'ACTIVE').map(t => [t.id, `${t.code} · ${t.name} v${t.version}`]) : [], onChange: draw },
        { key: 'source_variant_id', label: 'Producto a porcionar (PACKING)', type: 'select', options: G.db.where('product_variants', v => v.sellable && v.status === 'ACTIVE').map(v => [v.id, v.name]), onChange: draw },
        { key: 'output_variant_id', label: 'Presentación de salida (PACKING)', type: 'select', options: G.db.where('product_variants', v => v.sellable && v.status === 'ACTIVE').map(v => [v.id, v.name]), onChange: draw },
        { key: 'planned_output_kg', label: 'Kg planificados (despiece: kg de entrada)', type: 'number', required: true, min: 0.1, onChange: draw },
        { key: 'planned_date', label: 'Fecha planificada', type: 'date', required: true },
        { key: 'supervisor_user_id', label: 'Supervisor', type: 'select', options: G.db.where('users', u => ['JEFE_PRODUCCION', 'GERENTE', 'CALIDAD'].includes(u.role)).map(u => [u.id, `${u.name} (${G.roleName(u.role)})`]) },
        { key: 'release', label: 'Liberar a planta al crear', type: 'checkbox' },
        { key: 'notes', label: 'Notas para planta', type: 'textarea' },
      ],
      onSubmit: v => {
        try {
          const rc = v.order_type === 'RECIPE' && G.rec ? G.rec.recipe(v.recipe_id) : null;
          const cur = rc && G.rec.current(rc.id);
          if (v.order_type === 'RECIPE' && !cur) return `RN-PRO-01: ${rc ? `«${rc.name}» no tiene versión aprobada` : 'elige la receta'}.`;
          const o = create({ order_type: v.order_type, line_id: v.line_id, recipe_version_id: cur && cur.id, cutting_template_id: v.cutting_template_id, source_variant_id: v.source_variant_id, output_variant_id: v.order_type === 'PACKING' ? v.output_variant_id : null, planned_output_kg: v.planned_output_kg, planned_date: v.planned_date, supervisor_user_id: v.supervisor_user_id, notes: v.notes });
          if (v.release) release(o.id);
          toast(`Orden ${o.number} creada${v.release ? ' y liberada' : ''}`, 'ok'); G.go('PRO-11', { id: o.id }); return true;
        } catch (e) { return e.message; }
      },
    });
    if (!vals.line_id) { const l = lineOpts(vals.order_type)[0]; vals.line_id = l && l[0]; }
    if (preRc) { const l = lineOf('pl-' + preRc.line_code); if (l) { f.api.set('line_id', l.id); vals.line_id = l.id; } }
    f.api.values.line_id = vals.line_id;
    body.appendChild(h('div', { class: 'grid c2' }, card('Datos de la orden', f), card('Teórico de la orden', preview)));
    Object.assign(vals, f.api.values); f.api.values = vals;
    draw();
  }

  /* ---------- PRO-06 Consumo de insumos (tableta del operario) ---------- */
  const conState = {};
  function phone(title, inner) {
    const head = h('div', { style: 'background:var(--side);color:var(--side-ink);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px' }, h('b', { style: 'font-family:var(--font-display)' }, title), h('span', { class: 'mono small' }, G.date.now().slice(11, 16)));
    const content = h('div', { style: 'padding:12px;display:grid;gap:10px;align-content:start' });
    const r = inner(content); if (r instanceof Node) content.appendChild(r);
    return h('div', { class: 'phone' }, h('div', { class: 'phone-screen' }, head, content));
  }
  const tabletWrap = (ph, side) => h('div', { style: 'display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start;min-width:0' }, h('div', { style: 'flex:0 1 380px;min-width:0;max-width:100%' }, ph), h('div', { class: 'stack', style: 'flex:1 1 380px;min-width:0;gap:16px' }, side));
  function renderConsume(el, params = {}) {
    const body = page(el, { code: 'PRO-06', title: 'Consumo de insumos', sub: 'Tableta de planta: escanea el lote, compara kg teóricos de la receta escalada con kg reales y respeta FEFO (RN-PRO-02, RN-PRO-03). Cada consumo sale con PRODUCTION_OUT (RN-PRO-13).' });
    const { o, node } = orderPicker('PRO-06', params, x => OPEN.includes(x.status) || x.status === 'CLOSED');
    body.appendChild(node);
    if (!o) return body.appendChild(G.ui.empty('No hay órdenes en tu alcance.'));
    const th = theoretical(o); const cons = consOf(o.id);
    const consumedOf = vid => R(U.sum(cons.filter(c => c.variant_id === vid), c => c.role === 'PACKAGING' ? c.qty : c.weight_kg), 3);
    const st = conState[o.id] = conState[o.id] || { vid: (th.find(t => consumedOf(t.variant_id) < (t.role === 'PACKAGING' ? t.qty : t.kg) - 0.0005) || th[0] || {}).variant_id };
    const ph = phone(o.number + ' · ' + G.siteName(o.establishment_id), c => {
      c.appendChild(h('div', { class: 'small' }, h('b', null, productLabel(o)), ' · ', F.kg(o.planned_output_kg, 1), ' plan · ', ost(o.status)));
      if (!ACTIVE.includes(o.status)) { c.appendChild(notice(`RN-PRO-04: la orden está ${(OSTAT[o.status] || [''])[0].toLowerCase()}. ${o.status === 'PLANNED' ? 'El jefe de producción debe liberarla.' : 'No admite consumos.'}`, 'warn')); }
      for (const t of th) {
        const done = consumedOf(t.variant_id); const target = t.role === 'PACKAGING' ? t.qty : t.kg; const pct = target ? done / target * 100 : 0;
        const tolKg = target * (t.tolerance_pct || 2) / 100;
        const tone = done === 0 ? '' : Math.abs(done - target) <= tolKg ? 'ok' : done > target ? 'bad' : 'warn';
        c.appendChild(h('button', { type: 'button', class: 'kan-card', style: `text-align:left;cursor:pointer;${st.vid === t.variant_id ? 'outline:2px solid var(--primary)' : ''}`, on: { click: () => { st.vid = t.variant_id; G.refresh(); } } },
          h('div', { class: 'between' }, h('b', { class: 'small' }, G.variantName(t.variant_id)), badge(lbl(C_ROLES, t.role), '')),
          h('div', { class: 'between small' }, h('span', null, `${F.num(done, 3)} de ${F.num(target, 3)} ${t.role === 'PACKAGING' ? 'u' : 'kg'}`), tone ? badge(tone === 'ok' ? 'En tolerancia' : tone === 'bad' ? 'Pasado' : 'Falta', tone) : null),
          G.ui.progress(pct, tone)));
      }
      if (ACTIVE.includes(o.status) && st.vid) {
        const t = th.find(x => x.variant_id === st.vid) || { variant_id: st.vid, kg: 0, qty: 0 };
        const prod = G.productOf(st.vid); const v = G.variant(st.vid);
        const wh = pickWh(st.vid, o, G.TODAY, Math.max(0.001, (t.role === 'PACKAGING' ? t.qty : t.kg) - consumedOf(st.vid)));
        const lots = prod && prod.requires_lot ? validLots(st.vid, wh, G.TODAY) : [];
        const remaining = R(Math.max(0, (t.role === 'PACKAGING' ? t.qty : t.kg) - consumedOf(st.vid)), 3);
        const fv = { lot_code: lots[0] ? lots[0].lot.code : '', qty: remaining || '', fefo_override_reason: '' };
        c.appendChild(h('div', { class: 'stack', style: 'gap:6px;border-top:1px solid var(--line);padding-top:8px' }, h('b', null, 'Registrar: ' + v.name), h('div', { class: 'small muted' }, `Almacén: ${G.whName(wh)}`),
          lots.length ? h('div', { class: 'small' }, 'Sugerencia FEFO: ', h('b', { class: 'mono' }, lots[0].lot.code), ` vence ${F.date(lots[0].lot.expiry_date)} · ${F.num(lots[0].b.qty, 3)} disp.`) : prod && prod.requires_lot ? notice('No hay lotes liberados y vigentes en el local: pide a Calidad liberar o a Almacén transferir.', 'warn') : null,
          form({
            id: 'pro06f', values: fv, submitLabel: 'Registrar consumo',
            fields: [
              prod && prod.requires_lot ? { key: 'lot_code', label: 'Lote (escanea o escribe)', required: true, help: lots.length ? 'Otros: ' + lots.slice(1, 4).map(x => `${x.lot.code} (${F.date(x.lot.expiry_date)})`).join(', ') : '' } : null,
              { key: 'qty', label: v.sale_mode === 'UNIT' ? 'Unidades' : 'Kg reales (balanza)', type: 'number', required: true, min: 0.001 },
              v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? { key: 'weight_kg', label: 'Peso real (kg)', type: 'number' } : null,
              { key: 'fefo_override_reason', label: 'Motivo si no usas el lote FEFO', type: 'textarea' },
            ].filter(Boolean),
            onSubmit: x => {
              try {
                let lot = null;
                if (prod.requires_lot) { lot = G.db.find('lots', l => l.code.toUpperCase() === String(x.lot_code).trim().toUpperCase()); if (!lot) return 'RN-PRO-02: no existe el lote ' + x.lot_code + '.'; }
                const lb = lot && G.db.find('stock_balances', b => b.lot_id === lot.id && b.variant_id === st.vid && b.qty > 0);
                const row = consume(o.id, { variant_id: st.vid, lot_id: lot && lot.id, qty: x.qty, weight_kg: x.weight_kg, fefo_override_reason: x.fefo_override_reason, warehouse_id: lb ? lb.warehouse_id : wh });
                const rr = Array.isArray(row) ? row[0] : row;
                const diff = t.kg ? R(consumedOf(st.vid) + (rr.role === 'PACKAGING' ? rr.qty : rr.weight_kg) - (t.role === 'PACKAGING' ? t.qty : t.kg), 3) : null;
                toast(`Consumo registrado: ${F.num(x.qty, 3)} de ${v.name}${lot ? ' · lote ' + lot.code : ''}${diff != null && Math.abs(diff) > 0.0005 ? ` (${diff > 0 ? '+' : ''}${F.num(diff, 3)} vs teórico)` : ''}`, 'ok');
                const nx = th.find(z => z.variant_id !== st.vid && consumedOf(z.variant_id) < (z.role === 'PACKAGING' ? z.qty : z.kg) - 0.0005); if (nx) st.vid = nx.variant_id;
                G.refresh(); return true;
              } catch (e) { return e.message; }
            },
          })));
      }
    });
    const side = [
      card('Consumos registrados', table({ id: 'pro06c-' + o.id, rows: cons.slice().sort(U.by('consumed_at', -1)), search: false, pageSize: 15, columns: [{ key: 'consumed_at', label: 'Hora', render: c => F.datetime(c.consumed_at) }, { key: 'v', label: 'Insumo', value: c => G.variantName(c.variant_id) }, { key: 'lot', label: 'Lote', render: c => c.lot_id ? h('span', { class: 'mono' }, (G.db.get('lots', c.lot_id) || {}).code) : 'sin lote' }, { key: 'wh', label: 'Almacén', value: c => G.whName(c.warehouse_id) }, { key: 'qty', label: 'Cantidad', align: 'r', render: c => F.num(c.qty, 3) }, { key: 'total_cost', label: 'Costo', align: 'r', render: c => money(c.total_cost) }, { key: 'f', label: 'FEFO', render: c => c.fefo_override_reason ? badge('Fuera de FEFO', 'warn') : '' }] }), { flush: true }),
      card('Teórico frente a real', table({ id: 'pro06t-' + o.id, rows: th, search: false, pageSize: 30, columns: [{ key: 'v', label: 'Ingrediente', value: t => G.variantName(t.variant_id) }, { key: 't', label: 'Teórico', align: 'r', render: t => F.num(t.role === 'PACKAGING' ? t.qty : t.kg, 3) }, { key: 'r', label: 'Real', align: 'r', render: t => F.num(consumedOf(t.variant_id), 3) }, { key: 'd', label: 'Diferencia', align: 'r', render: t => { const d = R(consumedOf(t.variant_id) - (t.role === 'PACKAGING' ? t.qty : t.kg), 3); return h('span', { style: Math.abs(d) > (t.kg || t.qty) * (t.tolerance_pct || 2) / 100 ? 'color:var(--warn);font-weight:700' : '' }, (d > 0 ? '+' : '') + F.num(d, 3)); } }] }), { flush: true }),
      G.ctx.role === 'OPERARIO_PRODUCCION' ? notice('D-REC-02: el operario ve los kg de su orden, no el costo ni la receta completa.', 'info') : null,
    ];
    body.appendChild(tabletWrap(ph, side.filter(Boolean)));
  }

  /* ---------- PRO-07 Puntos de control ---------- */
  function renderCcp(el, params = {}) {
    const body = page(el, { code: 'PRO-07', title: 'Puntos de control', sub: 'Lectura de cada punto de control de la receta (temperatura de cocción, tiempo, pH, salmuera, °Brix) con su rango. Fuera de rango exige acción correctiva; un punto crítico fuera de rango deja el lote pendiente de no conformidad (RN-PRO-11).' });
    const { o, node } = orderPicker('PRO-07', params, x => x.order_type === 'RECIPE');
    body.appendChild(node);
    if (!o) return body.appendChild(G.ui.empty('No hay órdenes de receta en tu alcance.'));
    const cps = G.rec ? G.rec.controlPoints(o.recipe_version_id) : [];
    const reads = ccpOf(o.id);
    if (o.critical_deviation) body.appendChild(notice(h('span', null, h('b', null, 'Punto crítico fuera de rango. '), 'Los lotes de esta orden no se liberan sin una no conformidad cerrada en CAL (RN-PRO-11, RN-CAL-03).'), 'bad'));
    const grid = h('div', { class: 'grid c2' });
    for (const cp of cps) {
      const rs = reads.filter(x => x.control_point_id === cp.id).sort(U.by('read_at', -1));
      const last = rs[0];
      const fv = { value: '', corrective_action: '' };
      const live = h('div', { class: 'small' });
      const f = ACTIVE.includes(o.status) ? form({
        id: 'pro07-' + cp.id, values: fv, submitLabel: 'Registrar lectura',
        fields: [{ key: 'value', label: `Valor (${cp.unit})`, type: 'number', required: true, onChange: (v) => { G.ui.clear(live); if (v === '' || v == null) return; const ok = (cp.min_value == null || v >= cp.min_value) && (cp.max_value == null || v <= cp.max_value); live.appendChild(ok ? badge('Dentro de rango', 'ok') : badge(cp.is_critical ? 'Fuera de rango · punto crítico' : 'Fuera de rango', 'bad')); } }, { key: 'corrective_action', label: 'Acción correctiva (obligatoria fuera de rango)', type: 'textarea', placeholder: cp.corrective_action }],
        onSubmit: x => { try { const rr = reading(o.id, { control_point_id: cp.id, value: x.value, corrective_action: x.corrective_action }); toast(rr.in_range ? `Lectura ${cp.code} registrada` : `Lectura fuera de rango registrada con acción correctiva${cp.is_critical ? ': Calidad fue notificada' : ''}`, rr.in_range ? 'ok' : 'warn'); G.refresh(); return true; } catch (e) { return e.message; } },
      }) : notice('RN-PRO-04: la orden no admite lecturas en este estado.', 'info');
      grid.appendChild(card(`${cp.code} · ${lbl(G.rec.VARS, cp.variable)}`, h('div', { class: 'stack' },
        h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' }, badge(`${F.num(cp.min_value, 1)} – ${F.num(cp.max_value, 1)} ${cp.unit}`, 'info'), cp.is_critical ? badge('Crítico', 'bad') : badge('No crítico', ''), cp.step_seq ? badge('Paso ' + cp.step_seq, '') : null),
        h('div', { class: 'small muted' }, 'Acción si sale de rango: ' + cp.corrective_action),
        last ? h('div', { class: 'small' }, 'Última: ', h('b', null, `${F.num(last.value, 1)} ${cp.unit}`), ' · ', F.datetime(last.read_at), ' ', last.in_range ? badge('OK', 'ok') : badge('Fuera', 'bad')) : h('div', { class: 'small muted' }, 'Sin lecturas.'),
        f, live)));
    }
    if (!cps.length) grid.appendChild(G.ui.empty('La receta no tiene puntos de control.'));
    body.appendChild(grid);
    body.appendChild(card('Lecturas de la orden', table({ id: 'pro07r-' + o.id, rows: reads.slice().sort(U.by('read_at', -1)), search: false, columns: [{ key: 'read_at', label: 'Hora', render: x => F.datetime(x.read_at) }, { key: 'cp', label: 'Punto', value: x => (G.db.get('recipe_control_points', x.control_point_id) || {}).code }, { key: 'value', label: 'Valor', align: 'r', render: x => { const cp = G.db.get('recipe_control_points', x.control_point_id) || {}; return `${F.num(x.value, 1)} ${cp.unit || ''}`; } }, { key: 'in_range', label: 'Resultado', render: x => x.in_range ? badge('En rango', 'ok') : badge('Fuera de rango', 'bad') }, { key: 'corrective_action', label: 'Acción correctiva' }, { key: 'reader_name', label: 'Registró' }] }), { flush: true }));
  }

  /* ---------- PRO-08 Registro de producción ---------- */
  function renderOutput(el, params = {}) {
    const body = page(el, { code: 'PRO-08', title: 'Registro de producción', sub: 'Kg producidos por variante con su lote nuevo. Con CAL activo todo lote entra en CUARENTENA aunque se envíe con otro estado (RN-PRO-05); subproductos y mermas con motivo. La balanza debe estar calibrada (RN-PRO-15).' });
    const { o, node } = orderPicker('PRO-08', params, x => x.status !== 'VOIDED');
    body.appendChild(node);
    if (!o) return body.appendChild(G.ui.empty('No hay órdenes en tu alcance.'));
    const outs = outsOf(o.id); const c = computeCost(o);
    body.appendChild(kpis([
      { label: 'Consumido (MP e insumos)', value: kg3(c.consumed_kg) }, { label: 'Producido', value: kg3(c.product_kg), sub: `${F.kg(c.main_kg, 3)} principal` },
      { label: 'Rendimiento', value: F.pct(c.actual_yield, 2), sub: `esperado ${F.pct(o.expected_yield_pct, 2)}`, tone: c.deviation == null ? '' : Math.abs(c.deviation) <= G.param('pro_yield_tolerance_pp') ? 'ok' : 'warn' },
      { label: 'Merma', value: kg3(c.waste_kg), sub: c.waste_pct != null ? `${F.pct(c.waste_pct, 2)} · máx. ${F.pct(c.max_waste, 1)}` : '' },
    ]));
    const prod = G.db.get('products', o.product_id);
    const varOpts = o.order_type === 'CUTTING' && G.des ? G.des.lines(o.cutting_template_id).filter(l => l.output_variant_id).map(l => [l.output_variant_id, `${l.name} (${lbl(O_ROLES, l.role)})`]) : G.db.where('product_variants', v => v.product_id === (prod || {}).id).map(v => [v.id, v.name]);
    const scales = equipmentList(o.establishment_id).filter(e => e.category === 'SCALE');
    const grid = h('div', { class: 'grid c2' });
    if (ACTIVE.includes(o.status)) {
      const preview = h('div', { class: 'small' });
      const fv = { variant_id: o.output_variant_id || (varOpts[0] || [])[0], output_role: o.order_type === 'CUTTING' ? 'CO_PRODUCT' : 'MAIN', qty: '', weight_kg: '', lot_code: '', scale_equipment_id: (scales.find(s => s.status === 'ACTIVE' && s.calibration_valid_until >= G.TODAY) || {}).id, qc_status: 'QUARANTINE' };
      grid.appendChild(card('Registrar lote producido', h('div', { class: 'stack' }, form({
        id: 'pro08', values: fv, submitLabel: 'Registrar',
        fields: [
          { key: 'variant_id', label: 'Variante', type: 'select', required: true, options: varOpts },
          { key: 'output_role', label: 'Rol', type: 'select', required: true, options: O_ROLES },
          { key: 'qty', label: 'Unidades (presentaciones por unidad)', type: 'number', min: 0, onChange: (v, all) => { const vv = G.variant(all.variant_id); if (vv && vv.sale_mode === 'UNIT' && v) { G.ui.clear(preview); preview.append(`≈ ${F.kg(v * unitKg(vv.id), 3)} nominales`); } } },
          { key: 'weight_kg', label: 'Kg reales (balanza)', type: 'number', required: true, min: 0 },
          { key: 'scale_equipment_id', label: 'Balanza', type: 'select', options: scales.map(s => [s.id, `${s.name}${s.status !== 'ACTIVE' ? ' · fuera de servicio' : s.calibration_valid_until < G.TODAY ? ' · calibración vencida' : ''}`]) },
          { key: 'lot_code', label: 'Código de lote (vacío = automático)', placeholder: nextLotCodePreview(o) },
          { key: 'qc_status', label: 'Estado con que se envía', type: 'select', options: [['QUARANTINE', 'Cuarentena'], ['RELEASED', 'Liberado']], help: 'RN-PRO-05: con CAL activo queda en cuarentena igual.' },
          { key: 'waste_reason', label: 'Motivo (merma)', type: 'textarea' },
        ],
        onSubmit: x => { try { const row = output(o.id, x); if (row.lot_id) { const l = G.db.get('lots', row.lot_id); toast(`Lote ${l.code} registrado en ${G.ui.statusLabel(l.qc_status).toLowerCase()}${x.qc_status === 'RELEASED' && l.qc_status === 'QUARANTINE' ? ' (RN-PRO-05: lo libera Calidad)' : ''}`, 'ok'); const dv = o.order_type === 'CUTTING' && G.des ? G.des.cutDeviation(o, row) : null; if (dv && dv.alert) toast(`RN-DES-05: ${dv.name} rinde ${F.pct(dv.real, 1)} frente a ${F.pct(dv.std, 1)} estándar`, 'warn'); } else toast('Merma registrada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } },
      }), preview)));
    } else grid.appendChild(card('Registro', notice(`RN-PRO-04: la orden está ${(OSTAT[o.status] || [''])[0].toLowerCase()} y no admite producción.`, 'info')));
    grid.appendChild(card('Lotes y mermas de la orden', table({ id: 'pro08o-' + o.id, rows: outs, search: false, pageSize: 20, columns: [{ key: 'v', label: 'Producto', value: x => x.variant_id ? G.variantName(x.variant_id) : 'Merma' }, { key: 'output_role', label: 'Rol', value: x => lbl(O_ROLES, x.output_role) }, { key: 'lot', label: 'Lote', render: x => x.lot_id ? lotCell(x.lot_id) : (x.waste_reason || '—') }, { key: 'qty', label: 'Unid.', align: 'r', render: x => x.variant_id && G.variant(x.variant_id).sale_mode !== 'KG' ? F.num(x.qty) : '—' }, { key: 'weight_kg', label: 'Kg', align: 'r', render: x => F.num(x.weight_kg, 3) }, { key: 'sc', label: 'Balanza', value: x => x.scale_equipment_id ? eqName(x.scale_equipment_id) : '—' }, { key: 'unit_cost', label: 'Costo unit.', align: 'r', render: x => x.lot_id ? money(x.unit_cost) : '—' }] }), { flush: true }));
    body.appendChild(grid);
  }
  function nextLotCodePreview(o) { const p = G.db.get('products', o.product_id) || {}; const pre = LOT_PREFIX[p.code] || String(p.code || '').slice(0, 2); return `${pre}-${G.TODAY.slice(0, 4)}-####`; }

  /* ---------- PRO-09 Personal y equipos ---------- */
  function renderCrew(el, params = {}) {
    const body = page(el, { code: 'PRO-09', title: 'Personal y equipos', sub: `Operarios con su función y horas (tarifa D-PRO-03: S/ ${F.num(G.param('pro_default_labor_rate_pen'), 2)} por hora hasta que PER tenga la de cada uno, RN-PRO-18) y equipos con su carga por hora; solo equipos en servicio y calibrados (RN-PRO-15). Máximo ${G.param('pro_max_hours_per_record')} h por registro (RN-PRO-16).` });
    const { o, node } = orderPicker('PRO-09', params, x => x.status !== 'VOIDED');
    body.appendChild(node);
    if (!o) return body.appendChild(G.ui.empty('No hay órdenes en tu alcance.'));
    const labs = labOf(o.id), eqs = eqOf(o.id);
    body.appendChild(kpis([{ label: 'Horas de personal', value: F.num(U.sum(labs, l => l.hours), 1) + ' h', sub: `${labs.length} registros` }, { label: 'Mano de obra', value: money(U.sum(labs, l => l.cost)) }, { label: 'Horas de equipo', value: F.num(U.sum(eqs, l => l.hours), 1) + ' h' }, { label: 'Carga por equipos', value: money(U.sum(eqs, l => l.cost)) }]));
    const emps = G.db.where('employees', e => e.status === 'ACTIVE' && e.establishment_id === o.establishment_id);
    const eqList = equipmentList(o.establishment_id);
    const grid = h('div', { class: 'grid c2' });
    const active = ACTIVE.includes(o.status);
    const rateEditable = canCost() && G.ctx.role !== 'OPERARIO_PRODUCCION';
    grid.appendChild(card('Personal', h('div', { class: 'stack' }, active ? form({
      id: 'pro09l', values: { employee_id: (emps[0] || {}).id, task_role: 'HELPER', hours: '', hourly_rate: G.param('pro_default_labor_rate_pen'), work_date: G.TODAY }, submitLabel: 'Agregar',
      fields: [{ key: 'employee_id', label: 'Trabajador', type: 'select', required: true, options: emps.map(e => [e.id, `${e.full_name} · ${e.position}`]) }, { key: 'task_role', label: 'Función', type: 'select', required: true, options: TASKS }, { key: 'hours', label: 'Horas', type: 'number', required: true, min: 0.1 }, { key: 'work_date', label: 'Fecha', type: 'date', required: true }, { key: 'hourly_rate', label: 'Tarifa S/ por hora', type: rateEditable ? 'number' : 'readonly', help: rateEditable ? 'RN-PRO-18' : 'El operario no cambia tarifas (RN-PRO-09).' }],
      onSubmit: x => { try { addLabor(o.id, rateEditable ? x : Object.assign({}, x, { hourly_rate: null })); toast('Horas registradas', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } },
    }) : null, table({ id: 'pro09lt-' + o.id, rows: labs, search: false, columns: [{ key: 'e', label: 'Trabajador', value: l => (G.db.get('employees', l.employee_id) || {}).full_name }, { key: 'task_role', label: 'Función', value: l => lbl(TASKS, l.task_role) }, { key: 'work_date', label: 'Fecha', render: l => F.date(l.work_date) }, { key: 'hours', label: 'Horas', align: 'r', render: l => F.num(l.hours, 2) }, { key: 'hourly_rate', label: 'Tarifa', align: 'r', render: l => money(l.hourly_rate) }, { key: 'cost', label: 'Costo', align: 'r', render: l => money(l.cost) }] }))));
    grid.appendChild(card('Equipos', h('div', { class: 'stack' }, active ? form({
      id: 'pro09e', values: { equipment_id: (eqList.find(e => e.status === 'ACTIVE' && e.category !== 'SCALE') || {}).id, hours: '' }, submitLabel: 'Agregar',
      fields: [{ key: 'equipment_id', label: 'Equipo', type: 'select', required: true, options: eqList.map(e => [e.id, `${e.name} · S/ ${F.num(e.hourly_rate, 2)}/h${e.status !== 'ACTIVE' ? ' · FUERA DE SERVICIO' : e.requires_calibration && (!e.calibration_valid_until || e.calibration_valid_until < G.TODAY) ? ' · CALIBRACIÓN VENCIDA' : ''}`]) }, { key: 'hours', label: 'Horas', type: 'number', required: true, min: 0.1 }, rateEditable ? { key: 'hourly_rate', label: 'Tarifa S/ por hora (vacío = la del equipo)', type: 'number' } : null].filter(Boolean),
      onSubmit: x => { try { addEquipment(o.id, x); toast('Equipo registrado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } },
    }) : null, table({ id: 'pro09et-' + o.id, rows: eqs, search: false, columns: [{ key: 'e', label: 'Equipo', value: l => l.equipment_name || eqName(l.equipment_id) }, { key: 'hours', label: 'Horas', align: 'r', render: l => F.num(l.hours, 2) }, { key: 'hourly_rate', label: 'Carga/h', align: 'r', render: l => money(l.hourly_rate) }, { key: 'cost', label: 'Costo', align: 'r', render: l => money(l.cost) }] }))));
    body.appendChild(grid);
  }

  /* ---------- PRO-10 Cierre de la orden ---------- */
  function costTable(c) {
    return table({ id: 'pro-cost', search: false, rows: [['Materia prima', c.raw], ['Insumos', c.inp], ['Empaques', c.pack], ['Mano de obra', c.labor], ['Carga por equipos', c.equip]].map(([k, v]) => ({ id: k, k, v })), columns: [{ key: 'k', label: 'Concepto' }, { key: 'v', label: 'Importe', align: 'r', render: x => money(x.v) }, { key: 'p', label: '%', align: 'r', render: x => c.total ? F.pct(x.v / c.total * 100, 1) : '—' }], footer: ['Total', { v: money(c.total), align: 'r' }, ''] });
  }
  function renderClose(el, params = {}) {
    const body = page(el, { code: 'PRO-10', title: 'Cierre de la orden', sub: 'Rendimiento real frente al esperado (RN-PRO-06), merma (RN-PRO-08), costo total y costo por kg (RN-PRO-07). Pide motivo si la desviación supera la tolerancia, respeta el período contable (RN-PRO-10) y emite production_order.closed (RN-PRO-17).' });
    const { o, node } = orderPicker('PRO-10', params, x => ACTIVE.includes(x.status) || x.status === 'CLOSED');
    body.appendChild(node);
    if (!o) return body.appendChild(G.ui.empty('No hay órdenes por cerrar.'));
    const c = computeCost(o);
    const tol = G.param('pro_yield_tolerance_pp');
    const devBad = c.deviation != null && Math.abs(c.deviation) > tol;
    const wasteBad = c.waste_pct != null && c.waste_pct > c.max_waste;
    body.appendChild(kpis([
      { label: 'Rendimiento real', value: F.pct(o.status === 'CLOSED' ? o.actual_yield_pct : c.actual_yield, 2), sub: `esperado ${F.pct(o.expected_yield_pct, 2)} · ${c.deviation != null ? (c.deviation > 0 ? '+' : '') + F.num(c.deviation, 2) + ' pp' : '—'}`, tone: devBad ? 'bad' : 'ok' },
      { label: 'Merma', value: F.kg(c.waste_kg, 3), sub: `${F.pct(c.waste_pct, 2)} · máx. ${F.pct(c.max_waste, 1)}`, tone: wasteBad ? 'warn' : 'ok' },
      { label: 'Costo total', value: money(o.status === 'CLOSED' ? o.total_cost : c.total) },
      { label: o.order_type === 'CUTTING' ? 'Costo por kg de corte útil' : 'Costo por kg', value: canCost() ? F.money(o.status === 'CLOSED' ? o.cost_per_kg : c.cost_per_kg, 4) : '•••', sub: `${F.kg(c.main_kg, 3)} de producto principal` },
    ]));
    const grid = h('div', { class: 'grid c2' });
    grid.appendChild(card('Costo de la orden', canCost() ? costTable(c) : notice('Tu rol no ve costos (pro.cost.view).', 'info'), { flush: canCost() }));
    let mb = null;
    if (o.order_type === 'CUTTING' && G.des) mb = G.des.massBalance(o);
    const right = h('div', { class: 'stack' });
    right.appendChild(dl([['Consumido (MP e insumos)', F.kg(c.consumed_kg, 3)], ['Producto (principal, coproductos y subproductos)', F.kg(c.product_kg, 3)], ['Merma registrada', F.kg(c.waste_reg, 3)], ['Horas de personal', F.num(c.labor_hours, 2) + ' h'], mb ? ['Balance de masa', `${F.pct(mb.diff_pct, 2)} (tolerancia ${F.pct(mb.tolerance_pct, 1)}) `] : null, ['Período', G.period.isClosed(G.TODAY) ? 'Cerrado' : 'Abierto']]));
    if (o.status === 'CLOSED') {
      right.appendChild(notice(h('span', null, h('b', null, `Cerrada el ${F.date(o.close_date)} por ${o.closed_by}. `), o.yield_deviation_reason ? 'Motivo de desviación: ' + o.yield_deviation_reason + '. ' : '', o.waste_reason ? 'Motivo de merma: ' + o.waste_reason : ''), 'ok'));
    } else {
      if (mb && !mb.ok) right.appendChild(notice(`RN-DES-04: balance de masa fuera de tolerancia (${F.pct(mb.diff_pct, 2)}). Revisa DES-05.`, 'bad'));
      const canClose = G.can('pro.order.close');
      right.appendChild(form({
        id: 'pro10', values: { date: G.TODAY, yield_deviation_reason: '', waste_reason: '', massOverride: false }, submitLabel: 'Cerrar orden',
        fields: [{ key: 'date', label: 'Fecha de cierre', type: 'date', required: true }, { key: 'yield_deviation_reason', label: `Motivo de la desviación de rendimiento${devBad ? ' (obligatorio)' : ''}`, type: 'textarea' }, { key: 'waste_reason', label: `Motivo de la merma${wasteBad ? ' (obligatorio)' : ''}`, type: 'textarea' }, mb && !mb.ok ? { key: 'massOverride', label: 'Cerrar fuera de tolerancia con des.mass_balance.override', type: 'checkbox' } : null].filter(Boolean),
        onSubmit: x => { if (!canClose) return `RN-PRO-09: tu rol (${G.roleName()}) no cierra órdenes (pro.order.close).`; try { const r = close(o.id, x); toast(`Orden ${r.number} cerrada: ${canCost() ? F.money(r.total_cost) + ' · ' + F.money(r.cost_per_kg, 4) + ' por kg' : F.kg(r.main_kg, 3)}`, 'ok'); G.refresh(); return true; } catch (e) { return e.message; } },
      }));
      if (!canClose) right.appendChild(notice('El operario registra; el cierre lo hace el jefe de producción (RN-PRO-09).', 'info'));
    }
    grid.appendChild(card('Rendimiento y cierre', right));
    body.appendChild(grid);
    if (o.order_type === 'CUTTING' && G.des) body.appendChild(card('Costeo conjunto (DES-06)', G.des.allocationView(o), { actions: [btn('Abrir DES-06', () => G.go('DES-06', { id: o.id }), { sm: true })] }));
  }

  /* ---------- PRO-11 Ficha de la orden ---------- */
  function renderFile(el, params = {}) {
    const { o, node } = orderPicker('PRO-11', params, null, { label: 'Ficha de' });
    const body = page(el, { code: 'PRO-11', title: 'Ficha de la orden', sub: 'Toda la historia: lotes que entraron y salieron, lecturas, personas, equipos, costos y decisiones de calidad sobre los lotes producidos.' });
    body.appendChild(node);
    if (!o) return body.appendChild(G.ui.empty('Sin órdenes.'));
    const c = computeCost(o); const ln = lineOf(o.line_id);
    body.appendChild(stepsOf(o));
    body.appendChild(actionNav(o));
    const ver = o.recipe_version_id && G.rec ? G.rec.version(o.recipe_version_id) : null;
    body.appendChild(h('div', { class: 'grid c2' }, card('Datos', dl([['Orden', o.number], ['Tipo', lbl(ORDER_TYPES, o.order_type)], ['Producto', productLabel(o)], ['Marca', G.brandFull(o.brand_id)], ['Local y línea', `${G.siteName(o.establishment_id)} · ${ln ? ln.code + ' ' + ln.name : '—'}`], ['Fecha planificada', F.date(o.planned_date)], ['Kg planificados', F.kg(o.planned_output_kg, 3)], ['Factor de escala', o.scale_factor != null ? F.num(o.scale_factor, 4) : '—'], ['Versión fijada', ver ? `v${ver.version} (${G.rec.statusLabel(ver.status)})` : '—'], ['Supervisor', G.userName(o.supervisor_user_id)], ['Notas', o.notes]])),
      card('Resultado', dl([['Rendimiento', `${F.pct(o.status === 'CLOSED' ? o.actual_yield_pct : c.actual_yield, 2)} (esperado ${F.pct(o.expected_yield_pct, 2)})`], ['Merma', `${F.kg(c.waste_kg, 3)} · ${F.pct(c.waste_pct, 2)}`], ['Costo total', money(o.status === 'CLOSED' ? o.total_cost : c.total)], ['Costo por kg', canCost() ? F.money(o.status === 'CLOSED' ? o.cost_per_kg : c.cost_per_kg, 4) : '•••'], ['Costo estándar de la receta', o.standard_cost_per_kg && canCost() ? F.money(o.standard_cost_per_kg, 4) + ' por kg (ingredientes)' : '—'], ['Cierre', o.close_date ? `${F.date(o.close_date)} · ${o.closed_by}` : '—'], ['Motivos', [o.yield_deviation_reason, o.waste_reason, o.void_reason].filter(Boolean).join(' · ')]]))));
    const decisions = G.db.where('lot_quality_decisions', d => outsOf(o.id).some(x => x.lot_id && x.lot_id === d.lot_id));
    body.appendChild(tabs([
      { key: 'in', label: 'Lotes que entraron', count: consOf(o.id).length, render: p => p.appendChild(table({ id: 'pro11c-' + o.id, rows: consOf(o.id), search: false, pageSize: 30, columns: [{ key: 'v', label: 'Insumo', value: x => G.variantName(x.variant_id) }, { key: 'role', label: 'Rol', value: x => lbl(C_ROLES, x.role) }, { key: 'lot', label: 'Lote', render: x => x.lot_id ? h('span', null, h('span', { class: 'mono' }, (G.db.get('lots', x.lot_id) || {}).code), ' ', G.supName((G.db.get('lots', x.lot_id) || {}).supplier_id) !== '—' ? h('span', { class: 'small muted' }, G.supName((G.db.get('lots', x.lot_id) || {}).supplier_id)) : null) : 'sin lote' }, { key: 'theoretical_kg', label: 'Teórico', align: 'r', render: x => x.theoretical_kg != null ? F.num(x.theoretical_kg, 3) : '—' }, { key: 'qty', label: 'Real', align: 'r', render: x => F.num(x.qty, 3) }, { key: 'total_cost', label: 'Costo', align: 'r', render: x => money(x.total_cost) }, { key: 'consumed_at', label: 'Hora', render: x => F.datetime(x.consumed_at) }, { key: 'fefo_override_reason', label: 'Motivo FEFO' }] })) },
      { key: 'out', label: 'Lotes producidos', count: outsOf(o.id).length, render: p => p.appendChild(table({ id: 'pro11o-' + o.id, rows: outsOf(o.id), search: false, columns: [{ key: 'v', label: 'Producto', value: x => x.variant_id ? G.variantName(x.variant_id) : 'Merma' }, { key: 'output_role', label: 'Rol', value: x => lbl(O_ROLES, x.output_role) }, { key: 'lot', label: 'Lote y calidad', render: x => x.lot_id ? lotCell(x.lot_id) : x.waste_reason }, { key: 'weight_kg', label: 'Kg', align: 'r', render: x => F.num(x.weight_kg, 3) }, { key: 'qty', label: 'Unid.', align: 'r' }, { key: 'allocated_cost', label: 'Costo asignado', align: 'r', render: x => x.allocated_cost != null ? money(x.allocated_cost) : '—' }, { key: 'unit_cost', label: 'Costo unit.', align: 'r', render: x => x.lot_id ? money(x.unit_cost) : '—' }] })) },
      { key: 'ccp', label: 'Lecturas', count: ccpOf(o.id).length, render: p => p.appendChild(table({ id: 'pro11r-' + o.id, rows: ccpOf(o.id), search: false, columns: [{ key: 'read_at', label: 'Hora', render: x => F.datetime(x.read_at) }, { key: 'cp', label: 'Punto', value: x => { const cp = G.db.get('recipe_control_points', x.control_point_id) || {}; return `${cp.code} ${F.num(cp.min_value, 1)}–${F.num(cp.max_value, 1)} ${cp.unit}`; } }, { key: 'value', label: 'Valor', align: 'r' }, { key: 'in_range', label: 'Resultado', render: x => x.in_range ? badge('En rango', 'ok') : badge('Fuera', 'bad') }, { key: 'corrective_action', label: 'Acción correctiva' }, { key: 'reader_name', label: 'Registró' }] })) },
      { key: 'crew', label: 'Personas y equipos', count: labOf(o.id).length + eqOf(o.id).length, render: p => { p.appendChild(table({ id: 'pro11l-' + o.id, rows: labOf(o.id), search: false, columns: [{ key: 'e', label: 'Trabajador', value: l => (G.db.get('employees', l.employee_id) || {}).full_name }, { key: 't', label: 'Función', value: l => lbl(TASKS, l.task_role) }, { key: 'hours', label: 'Horas', align: 'r' }, { key: 'cost', label: 'Costo', align: 'r', render: l => money(l.cost) }] })); p.appendChild(table({ id: 'pro11e-' + o.id, rows: eqOf(o.id), search: false, columns: [{ key: 'e', label: 'Equipo', value: l => l.equipment_name || eqName(l.equipment_id) }, { key: 'hours', label: 'Horas', align: 'r' }, { key: 'cost', label: 'Costo', align: 'r', render: l => money(l.cost) }] })); } },
      { key: 'cost', label: 'Costos', render: p => p.appendChild(canCost() ? costTable(c) : notice('Tu rol no ve costos.', 'info')) },
      { key: 'qc', label: 'Calidad', count: decisions.length, render: p => { p.appendChild(dl(outsOf(o.id).filter(x => x.lot_id).map(x => { const l = G.db.get('lots', x.lot_id); return [l.code, h('span', null, G.ui.status(l.qc_status), l.released_at ? ` ${F.datetime(l.released_at)} · ${l.released_by}` : '', l.ccp_deviation ? badge('PCC fuera de rango', 'bad') : null, l.requested_qc_status && l.requested_qc_status !== 'QUARANTINE' ? h('span', { class: 'small muted' }, ` (enviado como ${G.ui.statusLabel(l.requested_qc_status)})`) : null)]; }))); if (decisions.length) p.appendChild(table({ id: 'pro11q-' + o.id, rows: decisions, search: false, columns: [{ key: 'lot', label: 'Lote', value: d => (G.db.get('lots', d.lot_id) || {}).code }, { key: 'decision', label: 'Decisión' }, { key: 'reason', label: 'Motivo' }, { key: 'decided_at', label: 'Fecha', render: d => F.datetime(d.decided_at || d.created_at) }] })); } },
      { key: 'hist', label: 'Historial', render: p => p.appendChild(h('div', { class: 'timeline' }, (o.history || []).slice().reverse().map(x => h('div', { class: 'tl-item' }, h('b', null, x.action), ' ', h('span', { class: 'small muted' }, `${F.datetime(x.at)} · ${x.user || ''}`), x.detail ? h('div', { class: 'small' }, x.detail) : null)))) },
    ], { key: 'pro11tabs' }));
  }

  /* ---------- PRO-12 Tablero de producción ---------- */
  const dashState = { m: 'CUR' };
  function renderDash(el) {
    const site = G.ctx.site !== 'ALL' ? G.ctx.site : null, brand = G.ctx.brand !== 'ALL' ? G.ctx.brand : null;
    const from = dashState.m === 'CUR' ? G.date.month(G.TODAY) : G.date.addMonths(G.TODAY, -1);
    const to = dashState.m === 'CUR' ? G.TODAY : G.date.add(G.date.month(G.TODAY), -1);
    const p = { from, to, site, brand };
    const body = page(el, { code: 'PRO-12', title: 'Tablero de producción', sub: `KPI-PRO-01 a KPI-PRO-07 de ${G.date.monthName(from)} por local, línea y producto (filtro superior de marca y local).` });
    body.appendChild(pills([['PREV', 'Setiembre'], ['CUR', 'Octubre (a la fecha)']], dashState.m, v => { dashState.m = v; G.refresh(); }));
    const k = c => G.kpi(c, p) || { value: null };
    const v1 = k('KPI-PRO-01'), v2 = k('KPI-PRO-02'), v3 = k('KPI-PRO-03'), v4 = k('KPI-PRO-04'), v5 = k('KPI-PRO-05'), v6 = k('KPI-PRO-06'), v7 = k('KPI-PRO-07');
    body.appendChild(kpis([
      { label: 'KPI-PRO-01 Kg producidos', value: F.kg(v1.value, 0), sub: 'principal y coproductos' },
      { label: 'KPI-PRO-02 Rendimiento vs esperado', value: v2.value != null ? `${v2.value > 0 ? '+' : ''}${F.num(v2.value, 2)} pp` : '—', sub: 'meta 0 puntos', tone: v2.value != null && Math.abs(v2.value) <= 1 ? 'ok' : 'warn' },
      { label: 'KPI-PRO-03 Merma por proceso', value: F.pct(v3.value, 2) },
      { label: 'KPI-PRO-04 Costo por kg', value: canCost() ? F.money(v4.value) : '•••' },
      { label: 'KPI-PRO-05 Receta vs real', value: v5.value != null ? `${v5.value > 0 ? '+' : ''}${F.pct(v5.value, 1)}` : '—', sub: 'costo de ingredientes por kg', tone: v5.value != null && v5.value <= 3 ? 'ok' : 'warn' },
      { label: 'KPI-PRO-06 Productividad', value: v6.value != null ? F.num(v6.value, 2) + ' kg/h' : '—', sub: 'kg por hora de personal' },
      { label: 'KPI-PRO-07 Cumplimiento del plan', value: F.pct(v7.value, 1), sub: 'cerradas en la fecha planificada' },
    ]));
    const os = closedIn(p);
    const byLine = U.groupBy(os, 'line_id');
    const lines = G.db.all(T_L).filter(l => byLine[l.id]);
    body.appendChild(h('div', { class: 'grid c2' },
      card('Kg producidos por línea', lines.length ? G.ui.chart.bar({ labels: lines.map(l => l.code), series: [{ name: 'Kg', values: lines.map(l => R(U.sum(byLine[l.id], o => o.main_kg), 1)) }] }) : G.ui.empty('Sin órdenes cerradas.')),
      card('Merma por línea (KPI-PRO-03)', G.ui.chart.hbar({ items: lines.map(l => { const L = byLine[l.id]; const inK = U.sum(L, o => o.input_kg), outK = U.sum(L, o => o.output_kg); const w = inK ? (inK - outK) / inK * 100 : 0; return { label: `${l.code} (máx. ${F.num(l.max_waste_pct, 0)} %)`, value: R(w, 2), tone: w > l.max_waste_pct ? 'bad' : 'ok' }; }), format: v => F.pct(v, 1) }))));
    const byProd = U.groupBy(os, o => productLabel(o).replace(/ v\d+$/, ''));
    const prodRows = Object.entries(byProd).map(([name, L]) => ({ id: name, name, n: L.length, kg: R(U.sum(L, o => o.main_kg), 2), cost: R(U.sum(L, o => o.total_cost), 2), inK: U.sum(L, o => o.input_kg), outK: U.sum(L, o => o.output_kg), exp: U.sum(L, o => (o.expected_yield_pct || 0) * o.input_kg) })).map(x => Object.assign(x, { cpk: x.kg ? x.cost / x.kg : null, y: x.inK ? x.outK / x.inK * 100 : null, ey: x.inK ? x.exp / x.inK : null }));
    body.appendChild(card('Por producto', table({ id: 'pro12p', rows: prodRows, search: false, pageSize: 30, sort: 'kg', dir: -1, columns: [{ key: 'name', label: 'Producto' }, { key: 'n', label: 'Órdenes', align: 'r' }, { key: 'kg', label: 'Kg', align: 'r', render: x => F.num(x.kg, 1) }, { key: 'y', label: 'Rend. real', align: 'r', render: x => F.pct(x.y, 2) }, { key: 'ey', label: 'Esperado', align: 'r', render: x => F.pct(x.ey, 2) }, { key: 'd', label: 'Desv.', align: 'r', value: x => x.y - x.ey, render: x => { const d = x.y - x.ey; return h('span', { style: Math.abs(d) > G.param('pro_yield_tolerance_pp') ? 'color:var(--bad);font-weight:700' : '' }, `${d > 0 ? '+' : ''}${F.num(d, 2)} pp`); } }, { key: 'cpk', label: 'Costo/kg', align: 'r', render: x => money(x.cpk) }, { key: 'cost', label: 'Costo total', align: 'r', render: x => money(x.cost) }] }), { flush: true }));
    const bySite = ['es-L1', 'es-L2'].map(s => ({ s, kg: G.kpi('KPI-PRO-01', Object.assign({}, p, { site: s })) }));
    body.appendChild(card('Por local', G.ui.chart.hbar({ items: bySite.map(x => ({ label: G.siteName(x.s), value: (x.kg || {}).value || 0 })), format: v => F.kg(v, 0) })));
  }

  /* ---------- PRO-13 Anulación ---------- */
  function renderVoid(el, params = {}) {
    const body = page(el, { code: 'PRO-13', title: 'Anulación', sub: 'Anula una orden sin consumos ni producción registrados, con motivo (RN-PRO-14). Las órdenes con movimientos se cierran o se revierten en ALM.' });
    const voidable = scopedOrders(o => OPEN.includes(o.status));
    const rows = voidable.map(o => ({ o, id: o.id, ok: !consOf(o.id).length && !outsOf(o.id).length })).sort((a, b) => (b.ok - a.ok) || String(a.o.planned_date).localeCompare(b.o.planned_date));
    const pre = params.id ? ord(params.id) : null;
    const doVoid = o => modal('Anular ' + o.number, (b) => { b.appendChild(h('p', null, `${productLabel(o)} · ${F.kg(o.planned_output_kg, 1)} · ${F.date(o.planned_date)}`)); b.appendChild(h('textarea', { class: 'input', id: 'pro13-reason', placeholder: 'Motivo de la anulación (obligatorio)', attrs: { 'aria-label': 'Motivo' } })); }, [{ label: 'Cancelar' }, { label: 'Anular orden', kind: 'danger', onClick: () => { const reason = document.getElementById('pro13-reason').value; const r = run(() => voidOrder(o.id, reason), `Orden ${o.number} anulada`); return !!r; } }]);
    if (pre && OPEN.includes(pre.status)) setTimeout(() => doVoid(pre), 0);
    body.appendChild(kpis([{ label: 'Abiertas sin movimientos', value: rows.filter(r => r.ok).length, sub: 'se pueden anular' }, { label: 'Abiertas con movimientos', value: rows.filter(r => !r.ok).length, sub: 'no se anulan (RN-PRO-14)' }, { label: 'Anuladas', value: scopedOrders(o => o.status === 'VOIDED').length }]));
    body.appendChild(card('Órdenes abiertas', table({ id: 'pro13', rows, search: true, columns: [{ key: 'n', label: 'Orden', mono: true, value: r => r.o.number }, { key: 'd', label: 'Fecha', value: r => r.o.planned_date, render: r => F.date(r.o.planned_date) }, { key: 'p', label: 'Producto', value: r => productLabel(r.o) }, { key: 's', label: 'Estado', render: r => ost(r.o.status) }, { key: 'm', label: 'Movimientos', render: r => r.ok ? badge('Sin movimientos', 'ok') : badge(`${consOf(r.o.id).length} consumos · ${outsOf(r.o.id).length} producciones`, 'warn') }], actions: r => [btn('Anular', () => doVoid(r.o), { sm: true, kind: 'danger', disabled: !r.ok || !G.can('pro.order.void') })] }), { flush: true }));
    const voided = scopedOrders(o => o.status === 'VOIDED');
    body.appendChild(card('Historial de anulaciones', table({ id: 'pro13v', rows: voided, search: false, columns: [{ key: 'number', label: 'Orden', mono: true }, { key: 'p', label: 'Producto', value: productLabel }, { key: 'voided_at', label: 'Anulada', render: o => F.datetime(o.voided_at) }, { key: 'voided_by', label: 'Por' }, { key: 'void_reason', label: 'Motivo' }] }), { flush: true }));
  }

  /* ---------- registro ---------- */
  const spec = G.SPEC.PRO || { screens: [] };
  const nm = c => ((spec.screens || []).find(s => s[0] === c) || [c, c])[1];
  G.register({
    code: 'PRO', name: (G.SPEC.PRO || {}).name || 'Órdenes de producción', phase: 2, group: 'Producción y calidad',
    screens: [
      { code: 'PRO-01', name: nm('PRO-01'), render: renderLines },
      { code: 'PRO-02', name: nm('PRO-02'), render: renderPlan },
      { code: 'PRO-03', name: nm('PRO-03'), render: renderReq },
      { code: 'PRO-04', name: nm('PRO-04'), render: renderOrders },
      { code: 'PRO-05', name: nm('PRO-05'), render: renderNew },
      { code: 'PRO-06', name: nm('PRO-06'), render: renderConsume },
      { code: 'PRO-07', name: nm('PRO-07'), render: renderCcp },
      { code: 'PRO-08', name: nm('PRO-08'), render: renderOutput },
      { code: 'PRO-09', name: nm('PRO-09'), render: renderCrew },
      { code: 'PRO-10', name: nm('PRO-10'), render: renderClose },
      { code: 'PRO-11', name: nm('PRO-11'), render: renderFile },
      { code: 'PRO-12', name: nm('PRO-12'), render: renderDash },
      { code: 'PRO-13', name: nm('PRO-13'), render: renderVoid },
    ],
  });
  G.pro.orderPicker = orderPicker; G.pro.phone = phone; G.pro.tabletWrap = tabletWrap; G.pro.productLabel = productLabel; G.pro.lotCell = lotCell; G.pro.costTable = costTable;

  /* ---------- indicadores (TAB) ---------- */
  function closedIn({ from, to, site, brand, line } = {}) { return G.db.where(T_O, o => o.status === 'CLOSED' && o.close_date >= (from || '0000') && o.close_date <= (to || '9999') && (!site || o.establishment_id === site) && (!brand || o.brand_id === brand) && (!line || o.line_id === line)); }
  G.pro.closedIn = closedIn;
  G.kpiCalc['KPI-PRO-01'] = p => R(U.sum(closedIn(p), o => o.main_kg), 2);
  G.kpiCalc['KPI-PRO-02'] = p => { const os = closedIn(p); const inK = U.sum(os, o => o.input_kg); if (!inK) return null; const real = U.sum(os, o => o.output_kg) / inK * 100; const exp = U.sum(os, o => (o.expected_yield_pct || 0) * o.input_kg) / inK; return { value: R(real - exp, 2), numerator: R(real, 2), denominator: R(exp, 2) }; };
  G.kpiCalc['KPI-PRO-03'] = p => { const os = closedIn(p); const inK = U.sum(os, o => o.input_kg); return inK ? { value: R((inK - U.sum(os, o => o.output_kg)) / inK * 100, 2), numerator: R(inK - U.sum(os, o => o.output_kg), 2), denominator: R(inK, 2) } : null; };
  G.kpiCalc['KPI-PRO-04'] = p => { const os = closedIn(p); const kg = U.sum(os, o => o.main_kg); return kg ? { value: R(U.sum(os, o => o.total_cost) / kg, 4), numerator: R(U.sum(os, o => o.total_cost)), denominator: R(kg, 2) } : null; };
  G.kpiCalc['KPI-PRO-05'] = p => { const os = closedIn(p).filter(o => o.order_type === 'RECIPE' && o.standard_cost_per_kg); const std = U.sum(os, o => o.standard_cost_per_kg * o.main_kg); return std ? { value: R((U.sum(os, o => o.ingredient_cost_per_kg * o.main_kg) - std) / std * 100, 2), numerator: R(U.sum(os, o => o.ingredient_cost_per_kg * o.main_kg)), denominator: R(std) } : null; };
  G.kpiCalc['KPI-PRO-06'] = p => { const os = closedIn(p); const hrs = U.sum(os, o => U.sum(labOf(o.id), l => l.hours)); return hrs ? { value: R(U.sum(os, o => o.main_kg) / hrs, 2), numerator: R(U.sum(os, o => o.main_kg), 2), denominator: R(hrs, 2) } : null; };
  G.kpiCalc['KPI-PRO-07'] = p => { const os = G.db.where(T_O, o => o.status !== 'VOIDED' && o.planned_date >= (p.from || '0000') && o.planned_date <= (p.to || '9999') && o.planned_date < G.TODAY && (!p.site || o.establishment_id === p.site) && (!p.brand || o.brand_id === p.brand)); return os.length ? { value: R(os.filter(o => o.status === 'CLOSED' && o.close_date === o.planned_date).length / os.length * 100, 1), numerator: os.filter(o => o.status === 'CLOSED' && o.close_date === o.planned_date).length, denominator: os.length } : null; };

  /* ---------- búsqueda, escaneo y alertas ---------- */
  G.searchProviders.push(q => {
    const s = q.toLowerCase(); if (s.length < 2) return [];
    const out = [];
    for (const o of G.scope.filter(G.db.all(T_O))) { if (out.length >= 6) break; if (o.number.toLowerCase().includes(s) || productLabel(o).toLowerCase().includes(s)) out.push({ label: `${o.number} · ${productLabel(o)}`, sub: `Orden de producción · ${(OSTAT[o.status] || [''])[0]} · ${F.date(o.planned_date)}`, go: () => G.go('PRO-11', { id: o.id }) }); }
    for (const l of G.db.where('lots', l => l.production_order_id && l.code.toLowerCase().includes(s)).slice(0, 4)) out.push({ label: `Lote ${l.code}`, sub: `${G.variantName(l.variant_id)} · ${G.ui.statusLabel(l.qc_status)} · ${(ord(l.production_order_id) || {}).number}`, go: () => G.go('PRO-11', { id: l.production_order_id }) });
    return out;
  });
  G.scanHandlers.push(code => {
    const o = G.db.find(T_O, x => x.number.toUpperCase() === code); if (o) return () => G.go('PRO-11', { id: o.id });
    const l = G.db.find('lots', x => x.code.toUpperCase() === code && (x.production_order_id || G.db.find(T_C, c => c.lot_id === x.id)));
    if (l) return () => lotDrawer(l);
    return null;
  });
  function lotDrawer(l) {
    drawer('Lote ' + l.code, b => {
      const made = l.production_order_id ? ord(l.production_order_id) : null;
      const used = G.db.where(T_C, c => c.lot_id === l.id);
      b.appendChild(dl([['Producto', G.variantName(l.variant_id)], ['Estado de calidad', G.ui.status(l.qc_status)], ['Producción', F.date(l.production_date)], ['Vence', F.date(l.expiry_date)], ['Costo unitario', money(l.unit_cost)], ['Stock', F.num(G.inv.qty(l.variant_id, null) && U.sum(G.db.where('stock_balances', x => x.lot_id === l.id), x => x.qty), 3)], ['Proveedor', G.supName(l.supplier_id)], ['Producido en', made ? made.number : '—']]));
      if (made) b.appendChild(btn('Abrir orden ' + made.number, () => G.go('PRO-11', { id: made.id }), { sm: true }));
      if (used.length) { b.appendChild(h('h3', null, 'Consumido en')); b.appendChild(table({ id: 'lotused-' + l.id, rows: used, search: false, onRow: c => G.go('PRO-11', { id: c.order_id }), columns: [{ key: 'o', label: 'Orden', value: c => (ord(c.order_id) || {}).number, mono: true }, { key: 'qty', label: 'Cantidad', align: 'r', render: c => F.num(c.qty, 3) }, { key: 'consumed_at', label: 'Fecha', render: c => F.datetime(c.consumed_at) }] })); }
    }, { code: 'PRO-11' });
  }
  G.pro.lotDrawer = lotDrawer;
  G.alertProviders.push(() => {
    const out = [];
    const late = scopedOrders(o => ACTIVE.includes(o.status) && o.planned_date < G.TODAY);
    if (late.length) out.push({ module: 'PRO', title: `${late.length} orden(es) de producción atrasadas`, detail: late.slice(0, 3).map(o => o.number).join(', ') + ' siguen abiertas después de su fecha.', tone: 'warn', go: () => G.go('PRO-04') });
    const crit = scopedOrders(o => o.critical_deviation && o.planned_date >= G.date.add(G.TODAY, -7));
    if (crit.length) out.push({ module: 'PRO', title: `${crit.length} orden(es) con punto crítico fuera de rango`, detail: 'Sus lotes no se liberan sin no conformidad cerrada (RN-PRO-11).', tone: 'bad', go: () => G.go('PRO-11', { id: crit[0].id }) });
    return out;
  });
  G.events.on('lot.released', p => { const l = p && G.db.get('lots', p.lot_id || p.id); if (l && l.production_order_id) { const o = ord(l.production_order_id); if (o) { hist(o, 'Lote liberado por Calidad', l.code); G.db.touch(); } } });
  G.events.on('lot.blocked', p => { const l = p && G.db.get('lots', p.lot_id || p.id); if (l && l.production_order_id) { const o = ord(l.production_order_id); if (o) { hist(o, 'Lote bloqueado por Calidad', `${l.code}${l.block_reason ? ' · ' + l.block_reason : ''}`); G.db.touch(); } } });

  /* ---------- pruebas de aceptación (CA-PRO-01 … 08) ---------- */
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e.message; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code} y la acción pasó.`); };
  const asRole = (role, fn) => { const prev = G.ctx.role, ps = G.ctx.session; G.ctx.role = role; G.ctx.session = null; try { return fn(); } finally { G.ctx.role = prev; G.ctx.session = ps; } };
  function approveChorizoV2() { const v = G.rec.version('rv-CHO-2'); if (v.status !== 'APPROVED') asRole('CALIDAD', () => G.rec.approve(v.id)); return G.rec.version('rv-CHO-2'); }
  function testLot(vid, wh, qty, cost, exp, qc = 'RELEASED', code) {
    const p = G.productOf(vid);
    const lot = G.db.insert('lots', { product_id: p.id, variant_id: vid, code: code || ('T-' + vid.slice(3, 9) + '-' + Math.floor(Math.random() * 1e6)), origin: 'PURCHASE', production_date: G.TODAY, expiry_date: exp || G.date.add(G.TODAY, 3), qc_status: qc, unit_cost: cost }, { silent: true });
    G.inv.move({ type: 'RECEIPT', wh, variant: vid, lot: lot.id, qty, weight: qty, unitCost: cost, source: { type: 'TEST', id: 'CA' }, at: G.TODAY + 'T06:00', reason: 'Prueba' });
    return lot;
  }
  function choOrder(kg = 25) { const v = approveChorizoV2(); const o = create({ order_type: 'RECIPE', line_id: 'pl-L1-EMB', recipe_version_id: v.id, planned_output_kg: kg, planned_date: G.TODAY }); release(o.id); return o; }
  function buildCA02() {
    const o = choOrder(25);
    const R1 = 'Prueba CA (lote de prueba)';
    consume(o.id, { variant_id: 'va-MP-CER-REC', lot_id: testLot('va-MP-CER-REC', 'wh-CAM-L1', 17.5, 18.40).id, qty: 17.5, warehouse_id: 'wh-CAM-L1', fefo_override_reason: R1 });
    consume(o.id, { variant_id: 'va-MP-CER-GRA', lot_id: testLot('va-MP-CER-GRA', 'wh-CAM-L1', 5.0, 9.72).id, qty: 5.0, warehouse_id: 'wh-CAM-L1', fefo_override_reason: R1 });
    consume(o.id, { variant_id: 'va-IN-ESP-KG', lot_id: testLot('va-IN-ESP-KG', 'wh-ALM-L1', 1.34, 26.00).id, qty: 1.34, warehouse_id: 'wh-ALM-L1', fefo_override_reason: R1 });
    consume(o.id, { variant_id: 'va-IN-VIN-KG', lot_id: testLot('va-IN-VIN-KG', 'wh-ALM-L1', 2.00, 3.48).id, qty: 2.00, warehouse_id: 'wh-ALM-L1', fefo_override_reason: R1 });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-DEV-L1', variant: 'va-EM-VAC-2030', qty: 48, unitCost: 0.35, source: { type: 'TEST', id: 'CA' }, at: G.TODAY + 'T06:00' });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-DEV-L1', variant: 'va-EM-BOL-NUM', qty: 3, unitCost: 0.60, source: { type: 'TEST', id: 'CA' }, at: G.TODAY + 'T06:00' });
    consume(o.id, { variant_id: 'va-EM-VAC-2030', qty: 48, warehouse_id: 'wh-DEV-L1' });
    consume(o.id, { variant_id: 'va-EM-BOL-NUM', qty: 3, warehouse_id: 'wh-DEV-L1' });
    const emps = G.db.where('employees', e => e.establishment_id === 'es-L1').slice(0, 2);
    for (const e of emps) addLabor(o.id, { employee_id: e.id, task_role: 'SAUSAGE_MAKER', hours: 4 });
    // precondición: equipo activo de la categoría en el Local 1; con EQU encendido su catálogo puede no tenerlo (la embutidora de EQU está en el Local 2)
    const eq = cat => equipmentList('es-L1').find(e => e.category === cat && e.status === 'ACTIVE') || (G.db.all('equipment').length ? equipmentOf(G.db.insert('equipment', { code: 'PRUEBA-' + cat + '-L1', name: 'Equipo de prueba ' + cat, category: cat, establishment_id: 'es-L1', hourly_rate: 0, status: 'ACTIVE', requires_calibration: false }, { silent: true }).id) : null);
    addEquipment(o.id, { equipment_id: eq('STUFFER').id, hours: 3, hourly_rate: 4.00 });
    addEquipment(o.id, { equipment_id: eq('SEALER').id, hours: 1, hourly_rate: 2.50 });
    addEquipment(o.id, { equipment_id: eq('GRINDER').id, hours: 1, hourly_rate: 3.00 });
    output(o.id, { variant_id: 'va-M3-CHO-500', output_role: 'MAIN', qty: 48, weight_kg: 24.2 });
    return o;
  }
  /** orden de caldo de huesos en proceso (si el seed no la dejó): se libera y se consume su primer ingrediente */
  function calOrder() {
    const rc = G.rec.recipeByCode('RC-CAL'); const v = rc && G.rec.current(rc.id); if (!v) return null;
    const ln = lineOf('pl-' + rc.line_code); if (!ln) return null;
    const o = create({ order_type: 'RECIPE', line_id: ln.id, recipe_version_id: v.id, planned_output_kg: 40, planned_date: G.TODAY }); release(o.id);
    const it = G.rec.scale(v.id, 40).rows[0];
    const wh = ln.establishment_id === 'es-L2' ? 'wh-PRD-L2' : storageWh(it.variant_id, 'es-L1');
    const lot = G.productOf(it.variant_id).requires_lot ? testLot(it.variant_id, wh, it.kg, 3.2).id : null;
    if (!lot) G.inv.move({ type: 'RECEIPT', wh, variant: it.variant_id, qty: it.kg, unitCost: 3.2, source: { type: 'TEST', id: 'CA' }, at: G.TODAY + 'T06:00' });
    consume(o.id, { variant_id: it.variant_id, lot_id: lot, qty: it.kg, warehouse_id: wh, fefo_override_reason: 'Prueba CA-PRO-07' });
    return ord(o.id);
  }
  const T = (name, fn) => G.tests.push({ module: 'PRO', name, fn });
  T('CA-PRO-01: chorizo v2 (10,0 kg base) en orden de 25,0 kg → factor 2,5 y 17,500 kg de carne de cerdo', async () => {
    const o = choOrder(25);
    assert(Math.abs(o.scale_factor - 2.5) < 1e-9, 'Factor esperado 2,5 y salió ' + o.scale_factor);
    const meat = theoretical(o).find(t => t.variant_id === 'va-MP-CER-REC');
    assert(meat && Math.abs(meat.kg - 17.5) < 1e-9, 'Carne teórica esperada 17,500 kg y salió ' + (meat && meat.kg));
    assert(o.recipe_version_id === 'rv-CHO-2', 'La orden debe fijar la versión 2 (RN-PRO-01)');
  });
  T('CA-PRO-02: orden de chorizo con S/ 370,60 + 41,80 + 18,60 + mano de obra y equipos, 24,2 kg → S/ 524,50 y S/ 21,6736 por kg', async () => {
    const o = buildCA02();
    const c = computeCost(o);
    assert(c.raw === 370.6 && c.inp === 41.8 && c.pack === 18.6, `Materiales ${c.raw} / ${c.inp} / ${c.pack}`);
    assert(c.labor === 76 && c.equip === 17.5, `Mano de obra ${c.labor} y equipos ${c.equip}`);
    assert(c.total === 524.5, 'Costo total esperado 524,50 y salió ' + c.total);
    const r = close(o.id, { yield_deviation_reason: 'Prueba CA-PRO-02' });
    assert(r.total_cost === 524.5 && R(r.cost_per_kg, 4) === 21.6736, `Cierre: ${r.total_cost} / ${r.cost_per_kg}`);
    const lot = G.db.get('lots', outsOf(o.id)[0].lot_id); assert(Math.abs(lot.unit_cost * 48 - 524.5) < 0.01, 'El costo del lote debe sumar el costo de la orden');
    assert(G.db.where('domain_events', e => e.name === 'production_order.closed' && e.payload.order_id === o.id).length === 1, 'Debe emitir production_order.closed');
  });
  T('CA-PRO-03: 25,84 kg consumidos y 93,65 % real frente a 96,74 % (−3,09 puntos) → cierre sin motivo rechazado con RN-PRO-06', async () => {
    const o = buildCA02(); const c = computeCost(o);
    assert(c.consumed_kg === 25.84 && c.actual_yield === 93.65 && c.expected_yield === 96.74 && c.deviation === -3.09, `Rendimiento ${c.consumed_kg} · ${c.actual_yield} · ${c.expected_yield} · ${c.deviation}`);
    expectFail(() => close(o.id, {}), 'RN-PRO-06');
  });
  T('CA-PRO-04: lote de carne de cerdo en cuarentena → el operario no lo consume (RN-PRO-02)', async () => {
    const o = choOrder(25);
    const lot = testLot('va-MP-CER-REC', 'wh-CAM-L1', 10, 18.4, null, 'QUARANTINE');
    asRole('OPERARIO_PRODUCCION', () => expectFail(() => consume(o.id, { variant_id: 'va-MP-CER-REC', lot_id: lot.id, qty: 5, warehouse_id: 'wh-CAM-L1' }), 'RN-PRO-02'));
  });
  T('CA-PRO-05: dos lotes liberados (vencen 14/10 y 18/10) en el almacén de insumos del local 1 → consumir el del 18/10 sin motivo se rechaza con RN-PRO-03', async () => {
    const o = choOrder(25);
    testLot('va-MP-CER-REC', 'wh-CAM-L1', 10, 18.4, '2026-10-14');
    const late = testLot('va-MP-CER-REC', 'wh-CAM-L1', 10, 18.4, '2026-10-18');
    expectFail(() => consume(o.id, { variant_id: 'va-MP-CER-REC', lot_id: late.id, qty: 5, warehouse_id: 'wh-CAM-L1' }), 'RN-PRO-03');
  });
  T('CA-PRO-06: con CAL activo, el lote CH-2026-0412 enviado como RELEASED queda en QUARANTINE (RN-PRO-05)', async () => {
    assert(G.modOn('CAL'), 'CAL debe estar activo');
    const o = choOrder(25);
    consume(o.id, { variant_id: 'va-MP-CER-REC', lot_id: testLot('va-MP-CER-REC', 'wh-CAM-L1', 17.5, 18.4).id, qty: 17.5, warehouse_id: 'wh-CAM-L1', fefo_override_reason: 'Prueba' });
    // con CAL en el build, CAL ya sembró el lote CH-2026-0412 (RN-PRO-13 no repite códigos): se usa el mismo caso con un sufijo
    const code = G.db.find('lots', l => l.code === 'CH-2026-0412') ? 'CH-2026-0412-B' : 'CH-2026-0412';
    const row = output(o.id, { variant_id: 'va-M3-CHO-500', qty: 30, weight_kg: 15.1, lot_code: code, qc_status: 'RELEASED' });
    const lot = G.db.get('lots', row.lot_id);
    assert(lot.code === code && lot.qc_status === 'QUARANTINE', 'El lote debe quedar en cuarentena y salió ' + lot.qc_status);
    const mv = G.db.get('stock_movements', row.stock_movement_id); assert(mv && mv.movement_type === 'PRODUCTION_IN', 'Debe ingresar con PRODUCTION_IN (RN-PRO-13)');
  });
  T('CA-PRO-07: caldo de huesos con lectura de 82 °C en un punto crítico de 90–100 °C sin acción correctiva → RN-PRO-11', async () => {
    const o = G.db.find(T_O, x => x.order_type === 'RECIPE' && x.status === 'IN_PROGRESS' && (G.rec.recipe(G.rec.version(x.recipe_version_id).recipe_id) || {}).code === 'RC-CAL') || calOrder();
    assert(o, 'Debe existir una orden de caldo en proceso');
    const cp = G.rec.controlPoints(o.recipe_version_id).find(c => c.variable === 'CORE_TEMP' && c.min_value === 90 && c.max_value === 100 && c.is_critical);
    assert(cp, 'La receta debe tener el punto crítico 90–100 °C');
    expectFail(() => reading(o.id, { control_point_id: cp.id, value: 82, corrective_action: '' }), 'RN-PRO-11');
    const ok = reading(o.id, { control_point_id: cp.id, value: 82, corrective_action: 'Se subió el fuego y se extendió la cocción 15 min' });
    assert(!ok.in_range && ord(o.id).critical_deviation, 'Con acción correctiva se registra y marca el desvío crítico');
  });
  T('CA-PRO-08: con setiembre de 2026 cerrado, cerrar una orden con fecha 30/09/2026 se rechaza con RN-PRO-10', async () => {
    const p = G.db.find('accounting_periods', x => x.period === '2026-09-01'); G.db.update('accounting_periods', p.id, { status: 'CLOSED' }, { silent: true });
    const o = G.db.find(T_O, x => x.status === 'IN_PROGRESS') || buildCA02();
    assert(o && ord(o.id).status === 'IN_PROGRESS', 'Debe existir una orden en proceso');
    expectFail(() => close(o.id, { date: '2026-09-30' }), 'RN-PRO-10');
  });
})();
