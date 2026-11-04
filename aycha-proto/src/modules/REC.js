/* =====================================================================
   REC · Recetas y formulación (Fase 2)
   Receta oficial por producto con versiones (DRAFT → IN_REVIEW → APPROVED →
   RETIRED) aprobadas por un usuario distinto del autor, ingredientes por
   lote base con aditivos SIN y dosis en ppm, pasos, puntos de control,
   alérgenos, vida útil, escalado lineal y costo estándar por kg con el
   costo promedio real (G.inv.avg). Ficha técnica imprimible.
   Expone G.rec.approve, submit, newVersion, scale, standardCost,
   expectedYield, validate, current, versionAt y los CRUD de la versión.
   ===================================================================== */
(function () {
  'use strict';
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, form, toast, confirm, modal, tabs: uiTabs } = G.ui;

  /* pestañas como hijo de una grilla: min-width 0 para que su tabla haga scroll propio y no desborde a 390 px */
  const tabs = (...a) => { const t = uiTabs(...a); t.style.minWidth = '0'; return t; };
  const U = G.util, F = G.fmt;
  const R = (n, d = 2) => U.round(n, d);
  const lbl = (arr, v) => (arr.find(x => x[0] === v) || [v, v || '—'])[1];
  const TYPES = [['SAUSAGE', 'Embutido'], ['BROTH', 'Caldo'], ['JAM', 'Mermelada'], ['LARD', 'Manteca'], ['CURED', 'Curado y ahumado'], ['CUT_PACK', 'Corte envasado'], ['OTHER', 'Otro']];
  const COOKED = ['SAUSAGE', 'BROTH', 'JAM', 'LARD', 'CURED'];
  const VARS = [['CORE_TEMP', 'Temperatura interna'], ['TIME', 'Tiempo'], ['PH', 'pH'], ['BRINE_PCT', '% de salmuera'], ['BRIX', '°Brix'], ['WATER_ACTIVITY', 'Actividad de agua'], ['OTHER', 'Otra']];
  const FUNCS = [['PRESERVATIVE', 'Conservante'], ['ANTIOXIDANT', 'Antioxidante'], ['COLOR', 'Colorante'], ['FLAVOR_ENHANCER', 'Potenciador del sabor'], ['THICKENER', 'Espesante'], ['GELLING', 'Gelificante'], ['ACIDITY_REGULATOR', 'Acidulante'], ['STABILIZER', 'Estabilizante'], ['EMULSIFIER', 'Emulsionante'], ['SEQUESTRANT', 'Secuestrante'], ['OTHER', 'Otra']];
  const EQCAT = [['POT', 'Olla o marmita'], ['STOVE', 'Cocina'], ['STUFFER', 'Embutidora'], ['SEALER', 'Selladora'], ['GRINDER', 'Molino'], ['SAW', 'Sierra'], ['SCALE', 'Balanza'], ['SMOKER', 'Ahumador'], ['COLD_ROOM', 'Cámara de frío'], ['ROASTER', 'Tostadora'], ['OTHER', 'Otro']];
  const STORAGE = [['CHILLED', 'Refrigerado (0 a 4 °C)'], ['FROZEN', 'Congelado (−18 °C o menos)'], ['AMBIENT', 'Ambiente, lugar fresco y seco']];
  const VSTAT = { DRAFT: ['Borrador', ''], IN_REVIEW: ['En revisión', 'warn'], APPROVED: ['Aprobada', 'ok'], RETIRED: ['Retirada', ''] };
  const vbadge = s => badge((VSTAT[s] || [s])[0], (VSTAT[s] || [])[1] || '');
  const statusLabel = s => (VSTAT[s] || [s])[0];
  const T_A = 'food_additives', T_R = 'recipes', T_V = 'recipe_versions', T_I = 'recipe_ingredients', T_S = 'recipe_steps', T_C = 'recipe_control_points';
  // alérgeno por defecto del ingrediente (se puede corregir en la línea)
  const ALLERGEN_OF = { 'va-IN-ESP-KG': 'Mostaza', 'va-IN-VER-KG': 'Apio', 'va-IN-VIN-KG': 'Sulfitos' };

  const recipe = id => G.db.get(T_R, id);
  const recipeByCode = code => G.db.find(T_R, r => r.code === code);
  const version = id => G.db.get(T_V, id);
  const versionsOf = rid => G.db.where(T_V, v => v.recipe_id === rid).sort((a, b) => b.version - a.version);
  const current = rid => G.db.find(T_V, v => v.recipe_id === rid && v.status === 'APPROVED');
  const ingredients = vid => G.db.where(T_I, i => i.version_id === vid).sort(U.by('seq'));
  const steps = vid => G.db.where(T_S, s => s.version_id === vid).sort(U.by('seq'));
  const controlPoints = vid => G.db.where(T_C, c => c.version_id === vid).sort((a, b) => (a.step_seq || 0) - (b.step_seq || 0) || String(a.code).localeCompare(b.code));
  const totalKg = vid => R(U.sum(ingredients(vid), i => i.qty_kg), 4);
  const expectedYield = vid => { const t = totalKg(vid); const v = version(vid); return t && v ? R(v.base_output_kg / t * 100, 2) : null; };
  const ppm = (i, total) => total ? R(i.qty_kg / total * 1e6, 1) : 0;
  function versionAt(rid, date) {
    return G.db.where(T_V, v => v.recipe_id === rid && v.approved_at && v.approved_at.slice(0, 10) <= date && (!v.retired_at || v.retired_at.slice(0, 10) > date)).sort((a, b) => b.version - a.version)[0] || current(rid);
  }
  const canEdit = () => G.can('rec.version.edit');
  const canCost = () => G.can('rec.cost.view');
  const isOperario = () => G.ctx.role === 'OPERARIO_PRODUCCION';

  /* ---------- reglas y cálculos ---------- */
  function assertDraft(v) {
    if (!v) G.fail('RN-REC-03', 'Versión no encontrada.');
    if (['APPROVED', 'RETIRED'].includes(v.status)) G.fail('RN-REC-03', `La versión ${v.version} de ${recipe(v.recipe_id).name} está ${statusLabel(v.status).toLowerCase()}: no cambia (ni ingredientes, ni pasos, ni puntos de control). Crea una versión nueva.`);
    if (v.status === 'IN_REVIEW') G.fail('RN-REC-03', `La versión ${v.version} está en revisión: devuélvela a borrador para cambiarla.`);
  }
  function assertEditor(opts) { if (!opts.seed && !canEdit()) G.fail('RN-REC-03', `Tu rol (${G.roleName()}) no edita recetas (permiso rec.version.edit).`); }
  /** RN-REC-08: factor = kg deseados / kg base; cada ingrediente = kg base × factor, a 3 decimales */
  function scale(vid, kg) {
    const v = version(vid); if (!v) G.fail('RN-REC-08', 'Versión no encontrada.');
    const factor = R(Number(kg) / v.base_output_kg, 6);
    return { factor, version: v, rows: ingredients(vid).map(i => ({ seq: i.seq, variant_id: i.variant_id, base_kg: i.qty_kg, kg: R(i.qty_kg * factor, 3), tolerance_pct: i.weighing_tolerance_pct, is_additive: i.is_additive })), packaging: (v.packaging || []).map(p => ({ variant_id: p.variant_id, per: p.per, qty: p.qty })) };
  }
  /** RN-REC-09: Σ (kg × costo promedio vigente) / kg base de salida */
  function standardCost(vid, opts = {}) {
    const v = version(vid);
    const rows = ingredients(vid).map(i => { const cost = opts.costOf && opts.costOf[i.variant_id] != null ? Number(opts.costOf[i.variant_id]) : G.inv.avg(i.variant_id); return { id: i.id, seq: i.seq, variant_id: i.variant_id, qty_kg: i.qty_kg, cost, amount: R(i.qty_kg * cost, 4) }; });
    const total = R(U.sum(rows, r => r.amount), 4);
    return { rows, total: R(total, 2), per_kg: v && v.base_output_kg ? R(total / v.base_output_kg, 6) : null };
  }
  function allergensOf(vid) {
    const s = new Set();
    for (const i of ingredients(vid)) { if (i.allergen) s.add(i.allergen); if (i.additive_id) { const a = G.db.get(T_A, i.additive_id); if (a && a.allergen) s.add(a.allergen); } }
    return [...s].sort();
  }
  /** validaciones de aprobación: [{code, level:'error'|'warn'|'ok', msg}] */
  function validate(vid) {
    const v = version(vid); const rc = recipe(v.recipe_id); const out = [];
    const ins = ingredients(vid); const total = totalKg(vid);
    out.push(ins.length ? { code: 'RN-REC-11', level: 'ok', msg: `${ins.length} ingredientes, ${F.num(total, 4)} kg por lote base` } : { code: 'RN-REC-11', level: 'error', msg: 'La versión no tiene ingredientes.' });
    out.push(v.shelf_life_days > 0 ? { code: 'RN-REC-10', level: 'ok', msg: `Vida útil ${v.shelf_life_days} días` } : { code: 'RN-REC-10', level: 'error', msg: 'Una versión sin vida útil en días no se aprueba: escríbela en REC-02.' });
    for (const i of ins.filter(x => x.is_additive)) {
      const a = i.additive_id && G.db.get(T_A, i.additive_id);
      if (!a || !a.sin_code) { out.push({ code: 'RN-REC-04', level: 'error', msg: `${G.variantName(i.variant_id)} está marcado como aditivo y no tiene un aditivo del catálogo con código SIN.` }); continue; }
      const d = ppm(i, total);
      if (a.max_ppm) out.push(d > a.max_ppm ? { code: 'RN-REC-05', level: 'error', msg: `${a.name} (SIN ${a.sin_code}): ${F.num(i.qty_kg, 4)} kg en ${F.num(total, 4)} kg = ${F.num(d, 0)} ppm, supera el límite de ${F.num(a.max_ppm, 0)} ppm. Baja la dosis o revisa el límite cargado por Calidad.` } : { code: 'RN-REC-05', level: 'ok', msg: `${a.name} (SIN ${a.sin_code}): ${F.num(d, 0)} ppm, dentro del límite de ${F.num(a.max_ppm, 0)} ppm` });
      else out.push({ code: 'RN-REC-05', level: 'warn', msg: `${a.name} (SIN ${a.sin_code}): ${F.num(d, 0)} ppm sin límite configurado (D-REC-01). La aprobación queda registrada con esta advertencia.` });
    }
    const cps = controlPoints(vid);
    if (COOKED.includes(rc.recipe_type)) out.push(cps.some(c => c.is_critical && ['CORE_TEMP', 'TIME'].includes(c.variable)) ? { code: 'RN-REC-06', level: 'ok', msg: 'Tiene punto de control crítico de temperatura interna o de tiempo' } : { code: 'RN-REC-06', level: 'error', msg: `Una receta de tipo ${lbl(TYPES, rc.recipe_type).toLowerCase()} necesita al menos un punto de control CRÍTICO de temperatura interna o de tiempo para aprobarse.` });
    for (const c of cps) if (!(c.min_value == null || c.max_value == null || c.min_value <= c.max_value) || !String(c.corrective_action || '').trim()) out.push({ code: 'RN-REC-12', level: 'error', msg: `El punto ${c.code} necesita mínimo ≤ máximo y acción correctiva escrita.` });
    if (cps.length && !out.some(o => o.code === 'RN-REC-12')) out.push({ code: 'RN-REC-12', level: 'ok', msg: `${cps.length} puntos de control con rango y acción correctiva` });
    const y = expectedYield(vid); const maxY = G.param('rec_max_yield_pct');
    if (y != null) out.push(y >= 1 && y <= maxY ? { code: 'RN-REC-11', level: 'ok', msg: `Rendimiento esperado ${F.pct(y, 2)} (entre 1 % y ${maxY} %)` } : { code: 'RN-REC-11', level: 'error', msg: `Rendimiento esperado ${F.pct(y, 2)} fuera del rango 1 %–${maxY} %: revisa los kg base de salida o los ingredientes.` });
    return out;
  }
  function approve(vid, opts = {}) {
    const v = version(vid); if (!v) G.fail('RN-REC-02', 'Versión no encontrada.');
    const uid = opts.userId || G.ctx.userId();
    if (!opts.seed && !G.can('rec.version.approve')) G.fail('RN-REC-02', `Aprueba un usuario con el permiso rec.version.approve (Calidad o Gerencia); tu rol (${G.roleName()}) no lo tiene.`);
    if (v.created_by && v.created_by === uid) G.fail('RN-REC-02', `Quien creó la versión (${G.userName(v.created_by)}) no la aprueba: debe aprobarla otro usuario con rec.version.approve.`);
    if (!['DRAFT', 'IN_REVIEW'].includes(v.status)) G.fail('RN-REC-03', `La versión ${v.version} ya está ${statusLabel(v.status).toLowerCase()}.`);
    const checks = validate(vid);
    const err = checks.find(c => c.level === 'error'); if (err) G.fail(err.code, err.msg);
    const warns = checks.filter(c => c.level === 'warn').map(c => `${c.code}: ${c.msg}`);
    const at = opts.at || G.date.now();
    const prev = current(v.recipe_id);
    if (prev && prev.id !== v.id) Object.assign(prev, { status: 'RETIRED', retired_at: at, retired_by: uid });
    Object.assign(v, { status: 'APPROVED', approved_by: uid, approved_at: at, allergens: allergensOf(vid), standard_cost_per_kg: standardCost(vid).per_kg, expected_yield_pct: expectedYield(vid), approval_warnings: warns.join('\n') || null });
    v.history = (v.history || []).concat([{ at, action: 'Aprobación', user: G.userName(uid), detail: warns.length ? `${warns.length} advertencia(s)` : 'Sin advertencias' }]);
    G.db.touch();
    if (!opts.seed) { G.audit('APROBAR', T_V, v.id, `${recipe(v.recipe_id).code} v${v.version}`); G.events.emit('recipe_version.approved', { version_id: v.id, recipe_id: v.recipe_id, version: v.version, previous_version_id: prev ? prev.id : null, allergens: v.allergens }); }
    return v;
  }
  function submit(vid) {
    const v = version(vid); assertEditor({}); assertDraft(v);
    if (!ingredients(vid).length) G.fail('RN-REC-11', 'Agrega ingredientes antes de enviar a revisión.');
    v.status = 'IN_REVIEW'; v.submitted_at = G.date.now(); v.submitted_by = G.ctx.userId(); v.expected_yield_pct = expectedYield(vid);
    v.history = (v.history || []).concat([{ at: v.submitted_at, action: 'Enviada a revisión', user: G.ctx.userName() }]); G.db.touch();
    G.notify({ role: 'CALIDAD', title: `Receta por aprobar: ${recipe(v.recipe_id).name} v${v.version}`, body: 'Revisa aditivos, puntos de control y vida útil en REC-07.', ref: v.id, module: 'REC' });
    return v;
  }
  function backToDraft(vid, comment) {
    const v = version(vid); if (!v || v.status !== 'IN_REVIEW') G.fail('RN-REC-03', 'Solo una versión en revisión vuelve a borrador.');
    if (!canEdit() && !G.can('rec.version.approve')) G.fail('RN-REC-03', 'Tu rol no puede devolver versiones.');
    if (!(comment || '').trim()) G.fail('RN-REC-03', 'Escribe qué debe corregirse.');
    v.status = 'DRAFT'; v.history = (v.history || []).concat([{ at: G.date.now(), action: 'Devuelta a borrador', user: G.ctx.userName(), detail: comment }]); G.db.touch();
    G.notify({ user_id: v.created_by, title: `Receta devuelta: ${recipe(v.recipe_id).name} v${v.version}`, body: comment, ref: v.id, tone: 'warn', module: 'REC' });
    return v;
  }
  function newVersion(rid, fromVid, opts = {}) {
    assertEditor(opts);
    const rc = recipe(rid); if (!rc) G.fail('RN-REC-03', 'Receta no encontrada.');
    if (!opts.seed && versionsOf(rid).some(v => ['DRAFT', 'IN_REVIEW'].includes(v.status))) G.fail('RN-REC-03', `«${rc.name}» ya tiene una versión en borrador o en revisión: termínala antes de crear otra.`);
    const src = fromVid ? version(fromVid) : (current(rid) || versionsOf(rid)[0]);
    const n = (versionsOf(rid)[0] || { version: 0 }).version + 1;
    const v = G.db.insert(T_V, { recipe_id: rid, version: n, base_output_kg: src ? src.base_output_kg : 10, expected_yield_pct: null, shelf_life_days: src ? src.shelf_life_days : null, storage: src ? src.storage : 'CHILLED', allergens: [], standard_cost_per_kg: null, status: 'DRAFT', notes: opts.notes || (src ? `Copia de la v${src.version}` : ''), packaging: src ? U.clone(src.packaging || []) : [], created_by: opts.userId || G.ctx.userId(), created_at: opts.at || G.date.now(), history: [{ at: opts.at || G.date.now(), action: 'Creación', user: opts.user || G.ctx.userName(), detail: src ? `Desde la v${src.version}` : 'Nueva' }] }, { silent: !!opts.seed });
    if (src) {
      for (const i of ingredients(src.id)) G.db.insert(T_I, Object.assign({}, i, { id: undefined, version_id: v.id, created_at: undefined }), { silent: true });
      for (const s of steps(src.id)) G.db.insert(T_S, Object.assign({}, s, { id: undefined, version_id: v.id, created_at: undefined }), { silent: true });
      for (const c of controlPoints(src.id)) G.db.insert(T_C, Object.assign({}, c, { id: undefined, version_id: v.id, created_at: undefined }), { silent: true });
    }
    return v;
  }
  function saveVersion(vid, patch) { const v = version(vid); assertEditor({}); assertDraft(v); const p = {}; for (const k of ['base_output_kg', 'shelf_life_days', 'storage', 'notes']) if (patch[k] !== undefined) p[k] = patch[k]; if (p.base_output_kg !== undefined && !(Number(p.base_output_kg) > 0)) G.fail('RN-REC-11', 'Los kg base de salida deben ser mayores que cero.'); return G.db.update(T_V, vid, p); }
  function addIngredient(vid, p, opts = {}) {
    const v = version(vid); assertEditor(opts); if (!opts.seed) assertDraft(v);
    if (!G.variant(p.variant_id)) G.fail('RN-REC-04', 'Elige el ingrediente.');
    if (!(Number(p.qty_kg) > 0)) G.fail('RN-REC-11', 'Los kg por lote base deben ser mayores que cero.');
    if (p.is_additive && !(p.additive_id && (G.db.get(T_A, p.additive_id) || {}).sin_code)) G.fail('RN-REC-04', 'Un ingrediente marcado como aditivo exige un aditivo del catálogo con código SIN.');
    const seq = p.seq || (Math.max(0, ...ingredients(vid).map(i => i.seq)) + 1);
    return G.db.insert(T_I, { version_id: vid, seq, variant_id: p.variant_id, qty_kg: R(Number(p.qty_kg), 4), weighing_tolerance_pct: p.weighing_tolerance_pct != null && p.weighing_tolerance_pct !== '' ? Number(p.weighing_tolerance_pct) : 2, is_additive: !!p.is_additive, additive_id: p.is_additive ? p.additive_id : null, allergen: p.allergen != null ? (p.allergen || null) : (ALLERGEN_OF[p.variant_id] || null) }, { silent: !!opts.seed });
  }
  function updateIngredient(id, patch) {
    const i = G.db.get(T_I, id); if (!i) G.fail('RN-REC-03', 'Ingrediente no encontrado.');
    assertEditor({}); assertDraft(version(i.version_id));
    const next = Object.assign({}, i, patch);
    if (!(Number(next.qty_kg) > 0)) G.fail('RN-REC-11', 'Los kg por lote base deben ser mayores que cero.');
    if (next.is_additive && !(next.additive_id && (G.db.get(T_A, next.additive_id) || {}).sin_code)) G.fail('RN-REC-04', 'Un ingrediente marcado como aditivo exige un aditivo del catálogo con código SIN.');
    return G.db.update(T_I, id, { variant_id: next.variant_id, qty_kg: R(Number(next.qty_kg), 4), weighing_tolerance_pct: Number(next.weighing_tolerance_pct), is_additive: !!next.is_additive, additive_id: next.is_additive ? next.additive_id : null, allergen: next.allergen || null });
  }
  function removeRow(table_, id) { const r = G.db.get(table_, id); if (!r) return; assertEditor({}); assertDraft(version(r.version_id)); G.db.remove(table_, id); }
  function saveStep(vid, p, id) { const v = version(vid); assertEditor({}); assertDraft(v); if (!(p.description || '').trim()) G.fail('RN-REC-12', 'Describe el paso.'); const row = { seq: Number(p.seq) || (Math.max(0, ...steps(vid).map(s => s.seq)) + 1), description: p.description.trim(), duration_min: p.duration_min === '' || p.duration_min == null ? null : Number(p.duration_min), equipment_category: p.equipment_category || null }; if (steps(vid).some(s => s.seq === row.seq && s.id !== id)) G.fail('RN-REC-12', `Ya hay un paso ${row.seq}.`); return id ? G.db.update(T_S, id, row) : G.db.insert(T_S, Object.assign({ version_id: vid }, row)); }
  function moveStep(id, dir) { const s = G.db.get(T_S, id); assertEditor({}); assertDraft(version(s.version_id)); const list = steps(s.version_id); const i = list.findIndex(x => x.id === id); const o = list[i + dir]; if (!o) return; const a = s.seq; s.seq = o.seq; o.seq = a; G.db.touch(); }
  function saveCp(vid, p, id, opts = {}) {
    const v = version(vid); assertEditor(opts); if (!opts.seed) assertDraft(v);
    const min = p.min_value === '' || p.min_value == null ? null : Number(p.min_value), max = p.max_value === '' || p.max_value == null ? null : Number(p.max_value);
    if (min != null && max != null && min > max) G.fail('RN-REC-12', `El mínimo (${min}) no puede ser mayor que el máximo (${max}).`);
    if (!String(p.corrective_action || '').trim()) G.fail('RN-REC-12', 'Escribe la acción correctiva del punto de control.');
    if (!(p.code || '').trim() || !(p.unit || '').trim()) G.fail('RN-REC-12', 'El punto de control necesita código y unidad.');
    if (controlPoints(vid).some(c => c.code === p.code && c.id !== id)) G.fail('RN-REC-12', `Ya existe el punto ${p.code} en esta versión.`);
    const row = { step_seq: p.step_seq === '' || p.step_seq == null ? null : Number(p.step_seq), code: p.code.trim(), variable: p.variable, min_value: min, max_value: max, unit: p.unit.trim(), is_critical: !!p.is_critical, corrective_action: p.corrective_action.trim() };
    return id ? G.db.update(T_C, id, row) : G.db.insert(T_C, Object.assign({ version_id: vid }, row), { silent: !!opts.seed });
  }

  G.rec = { recipe, recipeByCode, version, versionsOf, current, versionAt, ingredients, steps, controlPoints, totalKg, expectedYield, scale, standardCost, allergensOf, validate, approve, submit, backToDraft, newVersion, saveVersion, addIngredient, updateIngredient, removeIngredient: id => removeRow(T_I, id), removeStep: id => removeRow(T_S, id), removeControlPoint: id => removeRow(T_C, id), saveStep, saveCp, ppm, statusLabel, VARS, TYPES };

  /* =====================================================================
     Seed 42: aditivos, recetas y versiones
     ===================================================================== */
  // [código, nombre, producto, tipo, marca, variante de salida, línea, pasos, puntos de control, versiones]
  const S_SAUS = [[1, 'Moler recortes y grasa con disco de 8 mm, todo a menos de 4 °C', 20, 'GRINDER'], [2, 'Mezclar con sal, nitrito, especias, ají y agua helada hasta ligar', 15, 'OTHER'], [3, 'Embutir en tripa natural sin aire y atar cada 12 cm', 40, 'STUFFER'], [4, 'Reposar en cámara para asentar el color', 720, 'COLD_ROOM'], [5, 'Envasar al vacío y etiquetar', 30, 'SEALER']];
  const CP_SAUS = [['PC1', 'CORE_TEMP', 0, 4, '°C', true, 'Si la masa supera 4 °C, llevarla a cámara 30 min antes de seguir; si supera 7 °C, separarla y avisar a Calidad.', 2], ['PC2', 'TIME', 12, 24, 'h', false, 'Si el reposo es menor de 12 h, prolongarlo antes de envasar.', 4], ['PC3', 'PH', 5.2, 5.9, 'pH', false, 'Revisar la dosis de vinagre y anotar en la orden.', 2]];
  const S_BROTH = [[1, 'Blanquear y lavar los huesos', 20, 'POT'], [2, 'Cocinar a fuego lento con verduras', 420, 'POT'], [3, 'Colar y desgrasar', 30, 'OTHER'], [4, 'Enfriar en baño de hielo', 120, 'OTHER'], [5, 'Envasar en bolsas de 1 L, sellar y congelar', 40, 'SEALER']];
  const CP_BROTH = [['PC1', 'CORE_TEMP', 90, 100, '°C', true, 'Si baja de 90 °C, subir el fuego y extender la cocción 15 min.', 2], ['PC2', 'TIME', 360, 480, 'min', true, 'Si la cocción no llega a 6 h, prolongarla antes de colar.', 2], ['PC3', 'CORE_TEMP', 0, 10, '°C', true, 'Si no baja de 10 °C en 2 h, pasar a baño de hielo y avisar a Calidad.', 4]];
  const S_JAM = [[1, 'Seleccionar, lavar y despulpar la fruta', 40, 'OTHER'], [2, 'Cocinar con el azúcar en tres partes', 50, 'STOVE'], [3, 'Agregar pectina y ácido cítrico y concentrar', 15, 'STOVE'], [4, 'Llenar en caliente en frascos y voltear', 30, 'OTHER']];
  const CP_JAM = [['PC1', 'BRIX', 62, 66, '°Bx', false, 'Si está bajo, seguir concentrando; si está alto, corregir con pulpa.', 3], ['PC2', 'CORE_TEMP', 85, 95, '°C', true, 'Llenar solo sobre 85 °C; si baja, recalentar la olla.', 4], ['PC3', 'PH', 3.0, 3.5, 'pH', false, 'Ajustar con ácido cítrico.', 3]];
  const RECIPES = [
    ['RC-CHO', 'Chorizo parrillero', 'pr-CHOR', 'SAUSAGE', 'br-M3', 'va-M3-CHO-500', 'L1-EMB', S_SAUS, CP_SAUS, [
      { v: 1, status: 'RETIRED_OR_APPROVED', base: 10, shelf: 21, storage: 'CHILLED', approved: '2026-06-12', notes: 'Fórmula original de la casa.', ing: [['MP-CER-REC', 7.2], ['MP-CER-GRA', 1.8], ['IN-AGUA-KG', 0.6], ['IN-VIN-KG', 0.25], ['IN-AJI-KG', 0.2], ['IN-SAL-KG', 0.2], ['IN-ESP-KG', 0.12], ['IN-AJO-KG', 0.08], ['IN-NIT-KG', 0.0015, '250']], pack: [['IN-TRI-M', 'KG', 0.04], ['EM-VAC-2030', 'UNIT', 1]] },
      { v: 2, status: 'IN_REVIEW', base: 10, shelf: 21, storage: 'CHILLED', submitted: '2026-10-08T16:20', notes: 'Menos agua; se agrega eritorbato (SIN 316) para conservar el color.', ing: [['MP-CER-REC', 7.0], ['MP-CER-GRA', 2.0], ['IN-AGUA-KG', 0.5], ['IN-VIN-KG', 0.25], ['IN-AJI-KG', 0.2], ['IN-SAL-KG', 0.18], ['IN-ESP-KG', 0.12], ['IN-AJO-KG', 0.08], ['IN-NIT-KG', 0.0015, '250'], ['IN-ERI-KG', 0.005, '316']], pack: [['IN-TRI-M', 'KG', 0.04], ['EM-VAC-2030', 'UNIT', 1]] }]],
    ['RC-HUA', 'Salchicha huachana', 'pr-SALH', 'SAUSAGE', 'br-M3', 'va-M3-HUA-500', 'L1-EMB', S_SAUS, CP_SAUS, [
      { v: 1, status: 'APPROVED', base: 10, shelf: 21, storage: 'CHILLED', approved: '2026-05-20', ing: [['MP-CER-REC', 6.5], ['MP-CER-GRA', 2.0], ['IN-AJI-KG', 0.6], ['IN-VIN-KG', 0.4], ['IN-AGUA-KG', 0.4], ['IN-SAL-KG', 0.18], ['IN-ESP-KG', 0.15], ['IN-AJO-KG', 0.15], ['IN-NIT-KG', 0.0012, '250']], pack: [['IN-TRI-M', 'KG', 0.05], ['EM-VAC-2030', 'UNIT', 1]] }]],
    ['RC-MOR', 'Morcilla', 'pr-MORC', 'SAUSAGE', 'br-M3', 'va-M3-MOR-500', 'L1-EMB', [[1, 'Colar la sangre y mezclar con cebolla sofrita y especias', 25, 'POT'], [2, 'Embutir en tripa', 30, 'STUFFER'], [3, 'Cocinar en agua a 80 °C', 30, 'POT'], [4, 'Enfriar en agua con hielo', 20, 'OTHER'], [5, 'Envasar al vacío', 20, 'SEALER']], [['PC1', 'CORE_TEMP', 72, 80, '°C', true, 'Si no llega a 72 °C, prolongar la cocción 10 min y volver a medir.', 3], ['PC2', 'TIME', 25, 35, 'min', true, 'Ajustar el tiempo de cocción al calibre de la tripa.', 3], ['PC3', 'CORE_TEMP', 0, 4, '°C', false, 'Enfriar en agua con hielo hasta bajar de 4 °C.', 4]], [
      { v: 1, status: 'APPROVED', base: 8.6, shelf: 14, storage: 'CHILLED', approved: '2026-04-02', ing: [['MP-CER-SAN', 5.0], ['MP-CER-GRA', 1.5], ['IN-CEB-KG', 2.0], ['IN-AJI-KG', 0.2], ['IN-ESP-KG', 0.15], ['IN-SAL-KG', 0.15], ['IN-AJO-KG', 0.05]], pack: [['IN-TRI-M', 'KG', 0.05], ['EM-VAC-2030', 'UNIT', 1]] }]],
    ['RC-JAM', 'Jamón ahumado', 'pr-JAMO', 'CURED', 'br-M3', 'va-M3-JAM-250', 'L1-AHU', [[1, 'Preparar la salmuera e inyectar la pierna', 40, 'OTHER'], [2, 'Masajear y curar en cámara 48 h', 2880, 'COLD_ROOM'], [3, 'Ahumar con leña de nogal', 300, 'SMOKER'], [4, 'Cocinar hasta 70 °C interno', 120, 'POT'], [5, 'Enfriar, rebanar y envasar al vacío', 60, 'SEALER']], [['PC1', 'BRINE_PCT', 18, 22, '%', false, 'Corregir la salmuera con sal o agua antes de inyectar.', 1], ['PC2', 'TIME', 240, 360, 'min', true, 'Ahumado insuficiente: continuar hasta el mínimo.', 3], ['PC3', 'CORE_TEMP', 68, 72, '°C', true, 'Si no llega a 68 °C, prolongar la cocción; si supera 72 °C, registrar y avisar a Calidad.', 4]], [
      { v: 1, status: 'APPROVED', base: 10, shelf: 30, storage: 'CHILLED', approved: '2026-03-18', ing: [['MP-CER-PIE', 11.5], ['IN-AGUA-KG', 1.2], ['IN-SAL-KG', 0.24], ['IN-AZU-KG', 0.06], ['IN-ESP-KG', 0.05], ['IN-FOS-KG', 0.036, '451(i)'], ['IN-NIT-KG', 0.0018, '250']], pack: [['EM-VAC-2030', 'UNIT', 1]] }]],
    ['RC-PAN', 'Panceta ahumada', 'pr-PANC', 'CURED', 'br-M2', 'va-M2-PAN-AHU', 'L1-AHU', [[1, 'Frotar la panceta con sal, azúcar y especias', 20, 'OTHER'], [2, 'Curar en cámara 72 h', 4320, 'COLD_ROOM'], [3, 'Ahumar en frío y luego en caliente', 210, 'SMOKER'], [4, 'Enfriar, porcionar y envasar al vacío', 40, 'SEALER']], [['PC1', 'TIME', 180, 240, 'min', true, 'Si el ahumado no llega a 180 min, continuar.', 3], ['PC2', 'CORE_TEMP', 65, 70, '°C', true, 'Si no llega a 65 °C, prolongar el ahumado caliente.', 3]], [
      { v: 1, status: 'APPROVED', base: 10, shelf: 30, storage: 'CHILLED', approved: '2026-03-18', ing: [['M2-PAN-KG', 12.0], ['IN-SAL-KG', 0.3], ['IN-AZU-KG', 0.1], ['IN-ESP-KG', 0.08], ['IN-NIT-KG', 0.0018, '250']], pack: [['EM-VAC-2030', 'UNIT', 1]] }]],
    ['RC-MAN', 'Manteca de cerdo', 'pr-MANT', 'LARD', 'br-M4', 'va-M4-MAN-500', 'L2-MAN', [[1, 'Picar la grasa dorsal en cubos', 30, 'OTHER'], [2, 'Fundir a fuego medio removiendo', 100, 'POT'], [3, 'Colar en caliente', 20, 'OTHER'], [4, 'Envasar tibia y dejar solidificar', 40, 'SEALER']], [['PC1', 'CORE_TEMP', 110, 125, '°C', true, 'Si supera 125 °C, bajar el fuego para no quemar la grasa.', 2], ['PC2', 'TIME', 90, 120, 'min', false, 'Ajustar el tiempo de fundido al tamaño del cubo.', 2]], [
      { v: 1, status: 'APPROVED', base: 10, shelf: 180, storage: 'AMBIENT', approved: '2026-02-10', ing: [['MP-CER-GRA', 12.5], ['IN-SAL-KG', 0.02]], pack: [['EM-VAC-2030', 'UNIT', 1]] }]],
    ['RC-CAL', 'Caldo de huesos', 'pr-CAL-HUE', 'BROTH', 'br-DG', 'va-DG-CAL-1L', 'L2-CAL', S_BROTH, CP_BROTH, [
      { v: 1, status: 'RETIRED', base: 10, shelf: 120, storage: 'FROZEN', approved: '2026-03-02', retired: '2026-09-15', ing: [['MP-HUE-KG', 3.5], ['IN-AGUA-KG', 8.0], ['IN-VER-KG', 0.6], ['IN-SAL-KG', 0.08]], pack: [['EM-VAC-2030', 'UNIT', 1]] },
      { v: 2, status: 'APPROVED', base: 10, shelf: 120, storage: 'FROZEN', approved: '2026-09-15', notes: 'Más hueso por lote para mejorar el cuerpo; menos sal.', ing: [['MP-HUE-KG', 4.0], ['IN-AGUA-KG', 7.5], ['IN-VER-KG', 0.8], ['IN-SAL-KG', 0.06], ['IN-AJO-KG', 0.04]], pack: [['EM-VAC-2030', 'UNIT', 1]] }]],
    ['RC-CGA', 'Caldo de gallina', 'pr-CALG', 'BROTH', 'br-M4', 'va-M4-CGA-1L', 'L2-CAL', S_BROTH, CP_BROTH, [
      { v: 1, status: 'APPROVED', base: 10, shelf: 120, storage: 'FROZEN', approved: '2026-04-11', ing: [['MP-GAL-CAR', 3.5], ['MP-HUE-KG', 1.0], ['IN-AGUA-KG', 7.5], ['IN-VER-KG', 0.8], ['IN-SAL-KG', 0.06]], pack: [['EM-VAC-2030', 'UNIT', 1]] }]],
    ['RC-MAG', 'Mermelada de aguaymanto', 'pr-MERM', 'JAM', 'br-M5', 'va-M5-MER-AGU', 'L2-MER', S_JAM, CP_JAM, [
      { v: 1, status: 'APPROVED', base: 10, shelf: 180, storage: 'AMBIENT', approved: '2026-05-05', ing: [['IN-AGU-KG', 7.0], ['IN-AZU-KG', 4.2], ['IN-PEC-KG', 0.06, '440'], ['IN-CIT-KG', 0.03, '330'], ['IN-SOR-KG', 0.005, '202']], pack: [['EM-FRA-250', 'UNIT', 1]] }]],
    ['RC-MFR', 'Mermelada de fresa', 'pr-MERM', 'JAM', 'br-M5', 'va-M5-MER-FRE', 'L2-MER', S_JAM, CP_JAM, [
      { v: 1, status: 'APPROVED', base: 10, shelf: 180, storage: 'AMBIENT', approved: '2026-05-05', ing: [['IN-FRE-KG', 7.0], ['IN-AZU-KG', 4.3], ['IN-CIT-KG', 0.035, '330'], ['IN-PEC-KG', 0.05, '440']], pack: [['EM-FRA-250', 'UNIT', 1]] },
      { v: 2, status: 'DRAFT', base: 10, shelf: 150, storage: 'AMBIENT', notes: 'Prueba con menos azúcar para la línea gourmet: más pectina.', ing: [['IN-FRE-KG', 7.5], ['IN-AZU-KG', 3.6], ['IN-CIT-KG', 0.035, '330'], ['IN-PEC-KG', 0.08, '440']], pack: [['EM-FRA-250', 'UNIT', 1]] }]],
    ['RC-CAF', 'Café tostado de altura', 'pr-CAFE', 'OTHER', 'br-M5', 'va-M5-CAF-250', 'L2-CAF', [[1, 'Precalentar el tambor a 200 °C', 15, 'ROASTER'], [2, 'Tostar en tandas de 5 kg hasta segundo crack incipiente', 14, 'ROASTER'], [3, 'Enfriar y reposar 24 h', 1440, 'OTHER'], [4, 'Moler (molido) o envasar en grano', 30, 'GRINDER'], [5, 'Envasar y sellar', 30, 'SEALER']], [['PC1', 'CORE_TEMP', 205, 220, '°C', true, 'Detener el tueste fuera de rango y separar la tanda.', 2], ['PC2', 'TIME', 12, 16, 'min', false, 'Ajustar la curva de tueste.', 2]], [
      { v: 1, status: 'APPROVED', base: 10, shelf: 270, storage: 'AMBIENT', approved: '2026-01-22', ing: [['IN-CAV-KG', 11.9]], pack: [['EM-VAC-2030', 'UNIT', 1]] }]],
    ['RC-CHC', 'Chorizo de cuy', 'pr-EMB-CHO', 'SAUSAGE', 'br-DG', 'va-DG-CHO-500', 'L1-EMB', S_SAUS, CP_SAUS.slice(0, 1), [
      { v: 1, status: 'DRAFT', base: 10, shelf: null, storage: 'CHILLED', notes: 'Desarrollo nuevo: falta definir la vida útil con Calidad.', ing: [['MP-CUY-CAN', 6.0], ['MP-CER-GRA', 2.5], ['IN-AJI-KG', 0.3], ['IN-VIN-KG', 0.2], ['IN-SAL-KG', 0.16], ['IN-ESP-KG', 0.12], ['IN-AJO-KG', 0.08], ['IN-NIT-KG', 0.0015, '250']], pack: [['IN-TRI-M', 'KG', 0.04], ['EM-VAC-2030', 'UNIT', 1]] }]],
  ];
  const ADDITIVES = [
    ['250', 'Nitrito de sodio', 'PRESERVATIVE', null, null, null, 'va-IN-NIT-KG'], ['252', 'Nitrato de potasio', 'PRESERVATIVE', null, null, null, null],
    ['316', 'Eritorbato de sodio', 'ANTIOXIDANT', null, null, null, 'va-IN-ERI-KG'], ['300', 'Ácido ascórbico', 'ANTIOXIDANT', null, null, null, null],
    ['451(i)', 'Trifosfato pentasódico', 'SEQUESTRANT', null, null, null, 'va-IN-FOS-KG'], ['330', 'Ácido cítrico', 'ACIDITY_REGULATOR', null, null, null, 'va-IN-CIT-KG'],
    ['440', 'Pectinas', 'GELLING', null, null, null, 'va-IN-PEC-KG'], ['202', 'Sorbato de potasio', 'PRESERVATIVE', 1000, 'Codex CXS 296-2009 (confituras y jaleas), cargado por Calidad el 15/09/2026', null, 'va-IN-SOR-KG'],
    ['621', 'Glutamato monosódico', 'FLAVOR_ENHANCER', null, null, null, null], ['407', 'Carragenina', 'THICKENER', null, null, null, null], ['1422', 'Adipato de dialmidón acetilado', 'THICKENER', null, null, null, null],
  ];
  /* Respaldo sin PRO (build aislado): insumos y materia prima que usan las recetas, mismo catálogo que PRO.ensureCatalog */
  // [sku, código de producto, marca, categoría, nombre, conservación, vida útil, costo estándar]
  const EXTRA_REC = [
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
  function ensureCatalogLite() {
    let n = 0;
    for (const [sku, pc, br, cat, name, storage, life, cost] of EXTRA_REC) {
      const pid = 'pr-' + pc, vid = 'va-' + sku, goods = cat === 'CORDERO';
      if (!G.db.get('products', pid)) G.db.insert('products', { id: pid, brand_id: 'br-' + br, category_id: 'pc-' + cat, code: pc, name, line: goods ? 'CORDERO' : 'OTROS', product_type: goods ? 'GOODS' : 'INPUT', origin: goods ? 'PRODUCED' : 'RAW_MATERIAL', storage, shelf_life_days: life, requires_lot: sku !== 'IN-AGUA-KG', igv_affectation: '10', sanitary_authority: cat === 'INSUMOS' ? 'NONE' : 'SENASA', sanitary_registry: null, status: 'ACTIVE', web_publishable: false, allow_discount: false, source_module: 'PRO' }, { silent: true });
      if (!G.db.get('product_variants', vid)) G.db.insert('product_variants', { id: vid, product_id: pid, brand_id: 'br-' + br, sku, name, barcode: '7759' + U.pad(4100 + (n++) * 37, 9), uom_id: 'um-KGM', sale_mode: 'KG', nominal_weight_kg: null, weight_tolerance_pct: 5, min_weight_kg: null, max_weight_kg: null, scale_plu: null, status: 'ACTIVE', web_publishable: false, min_order_qty: 0.5, qty_step: 0.25, std_cost: cost, sellable: false, line: goods ? 'CORDERO' : 'OTROS' }, { silent: true });
    }
  }
  G.seed(42, function seedRecipes() {
    if (G.pro && G.pro.ensureCatalog) G.pro.ensureCatalog(); else ensureCatalogLite();
    const users = G.db.all('users');
    const jefe = users.find(u => u.role === 'JEFE_PRODUCCION'), cal = users.find(u => u.role === 'CALIDAD'), ger = users.find(u => u.role === 'GERENTE');
    for (const [sin, name, fn, max, src, allergen, vid] of ADDITIVES) G.db.insert(T_A, { id: 'fa-' + sin.replace(/[()]/g, ''), sin_code: sin, name, function_class: fn, max_ppm: max, max_ppm_source: src, allergen, status: 'ACTIVE', variant_id: vid }, { silent: true });
    const addId = sin => 'fa-' + sin.replace(/[()]/g, '');
    for (const [code, name, product, type, brand, outV, line, stp, cps, vers] of RECIPES) {
      const rc = G.db.insert(T_R, { id: 'rc-' + code.slice(3), product_id: product, code, name, recipe_type: type, brand_id: brand, status: 'ACTIVE', output_variant_id: outV, line_code: line }, { silent: true });
      for (const d of vers) {
        const approvedAt = d.approved ? d.approved + 'T11:00' : null;
        const v = G.db.insert(T_V, { id: `rv-${code.slice(3)}-${d.v}`, recipe_id: rc.id, version: d.v, base_output_kg: d.base, expected_yield_pct: null, shelf_life_days: d.shelf, storage: d.storage, allergens: [], standard_cost_per_kg: null, status: 'DRAFT', notes: d.notes || null, packaging: d.pack.map(([sku, per, qty]) => ({ variant_id: 'va-' + sku, per, qty })), created_by: jefe && jefe.id, created_at: (d.approved ? G.date.add(d.approved, -6) : '2026-10-02') + 'T09:00', history: [{ at: (d.approved ? G.date.add(d.approved, -6) : '2026-10-02') + 'T09:00', action: 'Creación', user: jefe ? jefe.name : 'Jefe de producción' }] }, { silent: true });
        d.ing.forEach(([sku, kg, sin], i) => addIngredient(v.id, { seq: i + 1, variant_id: 'va-' + sku, qty_kg: kg, is_additive: !!sin, additive_id: sin ? addId(sin) : null, weighing_tolerance_pct: sin ? 1 : 2 }, { seed: true }));
        stp.forEach(([seq, desc, min, eq]) => G.db.insert(T_S, { version_id: v.id, seq, description: desc, duration_min: min, equipment_category: eq }, { silent: true }));
        cps.forEach(([c, variable, mn, mx, unit, crit, act, step]) => saveCp(v.id, { code: c, variable, min_value: mn, max_value: mx, unit, is_critical: crit, corrective_action: act, step_seq: step }, null, { seed: true }));
        v.expected_yield_pct = expectedYield(v.id);
        if (d.status === 'IN_REVIEW') { v.status = 'IN_REVIEW'; v.submitted_at = d.submitted; v.submitted_by = jefe && jefe.id; v.history.push({ at: d.submitted, action: 'Enviada a revisión', user: jefe ? jefe.name : '' }); }
        if (d.approved) {
          v.status = 'APPROVED'; v.approved_by = (cal || ger).id; v.approved_at = approvedAt; v.allergens = allergensOf(v.id); v.standard_cost_per_kg = standardCost(v.id).per_kg;
          const warns = validate(v.id).filter(x => x.level === 'warn'); v.approval_warnings = warns.map(x => `${x.code}: ${x.msg}`).join('\n') || null;
          v.history.push({ at: approvedAt, action: 'Aprobación', user: (cal || ger).name, detail: warns.length ? `${warns.length} advertencia(s)` : 'Sin advertencias' });
          if (d.retired) { v.status = 'RETIRED'; v.retired_at = d.retired + 'T11:00'; v.retired_by = (cal || ger).id; }
        }
      }
    }
    // el costo estándar al aprobar: los insumos subieron desde entonces en algunas recetas (KPI-REC-01)
    const bump = { 'rv-MAG-1': 0.93, 'rv-CHO-1': 0.97, 'rv-CAF-1': 0.95 };
    for (const [id, f] of Object.entries(bump)) { const v = version(id); if (v && v.standard_cost_per_kg) v.standard_cost_per_kg = R(v.standard_cost_per_kg * f, 6); }
  }, 'REC recetas');

  /* =====================================================================
     Interfaz
     ===================================================================== */
  const vLabel = v => { const rc = recipe(v.recipe_id); return `${rc ? rc.code + ' · ' + rc.name : '—'} · v${v.version} (${statusLabel(v.status)})`; };
  function verPicker(code, params, pred, def) {
    const all = G.db.all(T_V).filter(pred || (() => true)).filter(v => { const rc = recipe(v.recipe_id); return rc && G.scope.ok(rc, { site: '_none' }); }).sort((a, b) => String((recipe(a.recipe_id) || {}).code).localeCompare((recipe(b.recipe_id) || {}).code) || b.version - a.version);
    let v = params && params.id ? version(params.id) : null;
    if (!v) v = (def && version(def) && all.find(x => x.id === def)) || all[0] || null;
    const sel = h('select', { class: 'input', style: 'width:100%;max-width:560px;min-width:0', attrs: { 'aria-label': 'Versión de receta', id: code + '-ver' } }, all.map(x => h('option', { value: x.id, selected: v && x.id === v.id }, vLabel(x))));
    sel.addEventListener('change', () => G.go(code, { id: sel.value }));
    return { v, node: h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;align-items:center' }, h('span', { class: 'small muted' }, 'Versión'), sel, v ? vbadge(v.status) : null) };
  }
  const nav = v => h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' }, [['REC-02', 'Versión'], ['REC-03', 'Ingredientes'], ['REC-05', 'Pasos'], ['REC-06', 'Puntos de control'], ['REC-07', 'Revisión'], ['REC-09', 'Costo'], ['REC-10', 'Ficha técnica']].map(([c, l]) => btn(l, () => G.go(c, { id: v.id }), { sm: true, kind: G.nav.current === c ? 'primary' : 'ghost' })));
  const lockNote = v => v.status !== 'DRAFT' ? notice(`RN-REC-03: la versión ${v.version} está ${statusLabel(v.status).toLowerCase()} y no se edita.${v.status === 'IN_REVIEW' ? ' Devuélvela a borrador en REC-07 para corregirla.' : ' Crea una versión nueva para cambiar la receta.'}`, v.status === 'APPROVED' ? 'info' : 'warn') : null;
  const tryRun = (fn, ok) => { try { const r = fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); if (!(e instanceof G.RuleError)) console.error(e); return null; } };
  const operarioGate = body => { if (isOperario()) { body.appendChild(notice('D-REC-02: las recetas son confidenciales para los operarios. Ves los kg de tu orden en PRO-06.', 'info')); return true; } return false; };
  const recalcOf = v => v.recalc_cost_per_kg != null ? v.recalc_cost_per_kg : standardCost(v.id).per_kg;
  const variation = v => v.standard_cost_per_kg ? R((recalcOf(v) - v.standard_cost_per_kg) / v.standard_cost_per_kg * 100, 2) : null;

  /* ---------- REC-01 Recetas ---------- */
  function renderList(el) {
    const rows = G.db.all(T_R).filter(rc => G.scope.ok(rc, { site: '_none' })).map(rc => { const vs = versionsOf(rc.id); const cur = vs.find(v => v.status === 'APPROVED'); const pend = vs.find(v => ['DRAFT', 'IN_REVIEW'].includes(v.status)); return { id: rc.id, rc, cur, pend, vs }; });
    const body = page(el, { code: 'REC-01', title: 'Recetas', sub: 'Receta oficial por producto terminado con su versión vigente, la versión en curso y el costo estándar por kg calculado con el costo promedio real de cada insumo (RN-REC-09).', actions: canEdit() ? [btn('Nueva receta', () => newRecipe(), { kind: 'primary', icon: '+' })] : [] });
    if (operarioGate(body)) return;
    const alertPct = G.param('rec_cost_alert_pct');
    body.appendChild(kpis([
      { label: 'Recetas activas', value: rows.filter(r => r.rc.status === 'ACTIVE').length, sub: `${rows.filter(r => r.cur).length} con versión aprobada` },
      { label: 'En revisión', value: rows.filter(r => r.pend && r.pend.status === 'IN_REVIEW').length, sub: 'esperan aprobación de Calidad', tone: rows.some(r => r.pend && r.pend.status === 'IN_REVIEW') ? 'warn' : '', onClick: () => G.go('REC-07') },
      { label: 'Borradores', value: rows.filter(r => r.pend && r.pend.status === 'DRAFT').length },
      canCost() ? { label: `Costo que varió más de ${alertPct} %`, value: rows.filter(r => r.cur && Math.abs(variation(r.cur) || 0) > alertPct).length, sub: 'KPI-REC-01 · ver REC-09', tone: rows.some(r => r.cur && Math.abs(variation(r.cur) || 0) > alertPct) ? 'warn' : 'ok', onClick: () => G.go('REC-09') } : { label: 'Puntos de control', value: G.db.all(T_C).length },
    ]));
    body.appendChild(table({
      id: 'rec01', rows, pageSize: 25, onRow: r => openRecipe(r.rc),
      filters: [{ key: 'type', label: 'Tipo', value: r => r.rc.recipe_type, options: TYPES }, { key: 'brand', label: 'Marca', value: r => r.rc.brand_id, options: G.db.all('brands').map(b => [b.id, G.brandName(b.id)]) }, { key: 'st', label: 'Versión vigente', value: r => r.cur ? 'APPROVED' : 'NONE', options: [['APPROVED', 'Con versión aprobada'], ['NONE', 'Sin versión aprobada']] }],
      columns: [
        { key: 'code', label: 'Código', mono: true, value: r => r.rc.code }, { key: 'name', label: 'Receta', value: r => r.rc.name },
        { key: 'p', label: 'Producto', value: r => (G.db.get('products', r.rc.product_id) || {}).name }, { key: 'b', label: 'Marca', value: r => G.brandName(r.rc.brand_id) },
        { key: 't', label: 'Tipo', value: r => lbl(TYPES, r.rc.recipe_type) },
        { key: 'cur', label: 'Vigente', render: r => r.cur ? h('span', null, `v${r.cur.version} `, vbadge('APPROVED')) : badge('Sin aprobar', 'warn') },
        { key: 'pend', label: 'En curso', render: r => r.pend ? h('span', null, `v${r.pend.version} `, vbadge(r.pend.status)) : '—' },
        { key: 'y', label: 'Rend. esperado', align: 'r', value: r => r.cur && r.cur.expected_yield_pct, render: r => r.cur ? F.pct(r.cur.expected_yield_pct, 2) : '—' },
        canCost() ? { key: 'c', label: 'Costo est. por kg', align: 'r', value: r => r.cur && r.cur.standard_cost_per_kg, render: r => r.cur ? F.money(r.cur.standard_cost_per_kg, 3) : '—' } : null,
        { key: 'al', label: 'Alérgenos', value: r => r.cur ? (r.cur.allergens || []).join(', ') || 'Ninguno' : '—' },
      ].filter(Boolean),
    }));
  }
  function openRecipe(rc) {
    drawer(rc.name, b => {
      b.appendChild(dl([['Código', rc.code], ['Producto', (G.db.get('products', rc.product_id) || {}).name], ['Marca', G.brandFull(rc.brand_id)], ['Tipo', lbl(TYPES, rc.recipe_type)], ['Presentación por defecto', G.variantName(rc.output_variant_id)], ['Línea de producción', rc.line_code]]));
      b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' }, canEdit() ? btn('Nueva versión', () => { const v = tryRun(() => newVersion(rc.id), v => `Versión ${v.version} creada en borrador`); if (v) G.go('REC-02', { id: v.id }); }, { sm: true, kind: 'primary' }) : null, current(rc.id) ? btn('Escalar', () => G.go('REC-08', { id: current(rc.id).id }), { sm: true }) : null, current(rc.id) ? btn('Ficha técnica', () => G.go('REC-10', { id: current(rc.id).id }), { sm: true }) : null));
      b.appendChild(h('h3', null, 'Versiones'));
      b.appendChild(table({ id: 'rec01v-' + rc.id, rows: versionsOf(rc.id), search: false, onRow: v => G.go('REC-02', { id: v.id }), columns: [{ key: 'version', label: 'Versión', render: v => 'v' + v.version }, { key: 'status', label: 'Estado', render: v => vbadge(v.status) }, { key: 'base_output_kg', label: 'Kg base', align: 'r' }, { key: 'y', label: 'Rend.', align: 'r', render: v => F.pct(v.expected_yield_pct ?? expectedYield(v.id), 2) }, { key: 'approved_at', label: 'Aprobada', render: v => v.approved_at ? `${F.date(v.approved_at)} · ${G.userShort(v.approved_by)}` : '—' }, { key: 'retired_at', label: 'Retirada', render: v => F.date(v.retired_at) }] }));
    }, { code: 'REC-01' });
  }
  function newRecipe() {
    drawer('Nueva receta', (b, close) => b.appendChild(form({
      id: 'rec01n', values: { recipe_type: 'SAUSAGE', base_output_kg: 10 }, submitLabel: 'Crear receta y versión 1',
      fields: [
        { key: 'product_id', label: 'Producto terminado', type: 'select', required: true, options: G.db.where('products', p => p.origin === 'PRODUCED' && p.product_type === 'GOODS').map(p => [p.id, `${p.name} · ${G.brandName(p.brand_id)}`]) },
        { key: 'code', label: 'Código', required: true, placeholder: 'RC-XXX' }, { key: 'name', label: 'Nombre', required: true },
        { key: 'recipe_type', label: 'Tipo', type: 'select', required: true, options: TYPES },
        { key: 'line_code', label: 'Línea de producción', type: 'select', options: G.db.all('production_lines').map(l => [l.code, `${l.code} · ${l.name}`]) },
        { key: 'base_output_kg', label: 'Kg base de salida', type: 'number', required: true, min: 0.1 },
      ],
      onSubmit: x => {
        if (G.db.find(T_R, r => r.code === x.code)) return { code: 'Ya existe una receta con ese código.' };
        const p = G.db.get('products', x.product_id); const outV = G.db.find('product_variants', v => v.product_id === p.id);
        const rc = G.db.insert(T_R, { product_id: p.id, code: x.code.trim().toUpperCase(), name: x.name, recipe_type: x.recipe_type, brand_id: p.brand_id, status: 'ACTIVE', output_variant_id: outV && outV.id, line_code: x.line_code });
        const v = G.db.insert(T_V, { recipe_id: rc.id, version: 1, base_output_kg: Number(x.base_output_kg), shelf_life_days: p.shelf_life_days, storage: p.storage, allergens: [], status: 'DRAFT', packaging: [], created_by: G.ctx.userId(), history: [{ at: G.date.now(), action: 'Creación', user: G.ctx.userName() }] });
        close(); toast(`Receta ${rc.code} creada: agrega ingredientes`, 'ok'); G.go('REC-03', { id: v.id }); return true;
      },
    })), { code: 'REC-01' });
  }

  /* ---------- REC-02 Editor de versión ---------- */
  function renderEditor(el, params = {}) {
    const body = page(el, { code: 'REC-02', title: 'Editor de versión', sub: 'Kg base de salida, rendimiento esperado calculado (RN-REC-11), vida útil (RN-REC-10), conservación y notas. Solo se edita en borrador (RN-REC-03).' });
    if (operarioGate(body)) return;
    const { v, node } = verPicker('REC-02', params, null, 'rv-CHO-2');
    body.appendChild(node);
    if (!v) return body.appendChild(G.ui.empty('Sin versiones.'));
    const rc = recipe(v.recipe_id);
    body.appendChild(nav(v));
    const ln = lockNote(v); if (ln) body.appendChild(ln);
    const total = totalKg(v.id);
    const live = h('div');
    const drawLive = (base) => { G.ui.clear(live); const y = total ? R(base / total * 100, 2) : null; const maxY = G.param('rec_max_yield_pct'); live.appendChild(kpis([{ label: 'Kg de ingredientes por lote', value: F.num(total, 4) }, { label: 'Rendimiento esperado', value: F.pct(y, 2), sub: `${F.num(base, 3)} / ${F.num(total, 4)} × 100 · rango 1 %–${maxY} %`, tone: y != null && y >= 1 && y <= maxY ? 'ok' : 'bad' }, { label: 'Merma esperada', value: y != null ? F.kg(Math.max(0, total - base), 3) : '—', sub: y != null && y > 100 ? 'absorbe agua o caldo' : '' }, canCost() ? { label: 'Costo estándar por kg', value: F.money(standardCost(v.id).per_kg, 3), sub: v.standard_cost_per_kg ? `al aprobar ${F.money(v.standard_cost_per_kg, 3)}` : 'con el costo promedio vigente' } : null].filter(Boolean))); };
    drawLive(v.base_output_kg);
    body.appendChild(live);
    const editable = v.status === 'DRAFT' && canEdit();
    const f = form({
      id: 'rec02', values: { base_output_kg: v.base_output_kg, shelf_life_days: v.shelf_life_days, storage: v.storage, notes: v.notes }, submitLabel: editable ? 'Guardar' : false,
      fields: [{ key: 'base_output_kg', label: 'Kg base de salida', type: 'number', required: true, min: 0.001, disabled: !editable, onChange: x => drawLive(Number(x) || 0) }, { key: 'shelf_life_days', label: 'Vida útil (días)', type: 'number', min: 1, disabled: !editable, help: 'RN-REC-10: obligatoria para aprobar.' }, { key: 'storage', label: 'Conservación', type: 'select', options: STORAGE, disabled: !editable }, { key: 'notes', label: 'Notas de la versión', type: 'textarea', disabled: !editable }],
      onSubmit: x => { try { saveVersion(v.id, { base_output_kg: Number(x.base_output_kg), shelf_life_days: x.shelf_life_days === '' ? null : Number(x.shelf_life_days), storage: x.storage, notes: x.notes }); toast('Versión guardada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } },
    });
    const acts = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
      v.status === 'DRAFT' && canEdit() ? btn('Enviar a revisión', () => tryRun(() => submit(v.id), 'Versión enviada a revisión: Calidad fue notificada'), { kind: 'primary', sm: true }) : null,
      v.status === 'IN_REVIEW' ? btn('Revisar y aprobar (REC-07)', () => G.go('REC-07', { id: v.id }), { kind: 'primary', sm: true }) : null,
      canEdit() && ['APPROVED', 'RETIRED'].includes(v.status) ? btn('Nueva versión desde esta', () => { const nv = tryRun(() => newVersion(v.recipe_id, v.id), x => `Versión ${x.version} creada`); if (nv) G.go('REC-02', { id: nv.id }); }, { sm: true }) : null);
    body.appendChild(h('div', { class: 'grid c2' }, card(`${rc.name} · v${v.version}`, h('div', { class: 'stack' }, acts, f)), card('Historial de la versión', h('div', { class: 'stack' }, dl([['Estado', vbadge(v.status)], ['Creada por', G.userName(v.created_by)], ['Aprobada', v.approved_at ? `${F.datetime(v.approved_at)} · ${G.userName(v.approved_by)}` : '—'], ['Retirada', F.datetime(v.retired_at)], ['Alérgenos', (v.status === 'APPROVED' || v.status === 'RETIRED' ? v.allergens : allergensOf(v.id)).join(', ') || 'Ninguno'], ['Advertencias al aprobar', v.approval_warnings]]), h('div', { class: 'timeline' }, (v.history || []).slice().reverse().map(x => h('div', { class: 'tl-item' }, h('b', null, x.action), ' ', h('span', { class: 'small muted' }, `${F.datetime(x.at)} · ${x.user || ''}`), x.detail ? h('div', { class: 'small' }, x.detail) : null)))))));
    body.appendChild(card('Empaques por lote', table({ id: 'rec02p-' + v.id, rows: (v.packaging || []).map((p, i) => Object.assign({ id: i }, p)), search: false, columns: [{ key: 'v', label: 'Empaque', value: p => G.variantName(p.variant_id) }, { key: 'per', label: 'Base', value: p => p.per === 'UNIT' ? 'por unidad producida' : 'por kg producido' }, { key: 'qty', label: 'Cantidad', align: 'r' }] }), { flush: true }));
  }

  /* ---------- REC-03 Ingredientes ---------- */
  function ingForm(v, row, close) {
    const vals = row ? Object.assign({}, row) : { weighing_tolerance_pct: 2, is_additive: false };
    const inputs = G.db.where('product_variants', x => { const p = G.productOf(x.id); return p && (p.product_type === 'INPUT' || ['pc-CERDO', 'pc-CUY', 'pc-AVES'].includes(p.category_id)) && x.sale_mode !== 'UNIT' && p.category_id !== 'pc-EMPAQUES'; });
    return form({
      id: 'rec03f', values: vals, submitLabel: row ? 'Guardar' : 'Agregar',
      fields: [
        { key: 'variant_id', label: 'Producto o insumo', type: 'select', required: true, options: inputs.map(x => [x.id, `${x.name} (${x.sku})`]), onChange: (x, all, api) => { const fa = G.db.find(T_A, a => a.variant_id === x); if (fa) { api.set('is_additive', true); api.set('additive_id', fa.id); all.is_additive = true; all.additive_id = fa.id; } if (ALLERGEN_OF[x]) { api.set('allergen', ALLERGEN_OF[x]); all.allergen = ALLERGEN_OF[x]; } } },
        { key: 'qty_kg', label: 'Kg por lote base', type: 'number', required: true, min: 0.0001 },
        { key: 'weighing_tolerance_pct', label: 'Tolerancia de pesaje (%)', type: 'number', min: 0, max: 100 },
        { key: 'is_additive', label: 'Es aditivo (RN-REC-04)', type: 'checkbox' },
        { key: 'additive_id', label: 'Aditivo del catálogo (SIN)', type: 'select', options: G.db.where(T_A, a => a.status === 'ACTIVE').map(a => [a.id, `SIN ${a.sin_code} · ${a.name}`]) },
        { key: 'allergen', label: 'Alérgeno', placeholder: 'Mostaza, apio, sulfitos, gluten…' },
      ],
      onSubmit: x => { try { if (row) updateIngredient(row.id, x); else addIngredient(v.id, x); close(); toast(row ? 'Ingrediente actualizado' : 'Ingrediente agregado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } },
    });
  }
  function renderIngredients(el, params = {}) {
    const body = page(el, { code: 'REC-03', title: 'Ingredientes', sub: 'Producto o insumo con kg por lote base, tolerancia de pesaje y alérgeno; un aditivo exige su código SIN (RN-REC-04) y su dosis en ppm = kg del aditivo / kg totales × 1 000 000 no supera el límite configurado (RN-REC-05).' });
    if (operarioGate(body)) return;
    const { v, node } = verPicker('REC-03', params, null, 'rv-CHO-2');
    body.appendChild(node);
    if (!v) return body.appendChild(G.ui.empty('Sin versiones.'));
    body.appendChild(nav(v));
    const ln = lockNote(v); if (ln) body.appendChild(ln);
    const ins = ingredients(v.id); const total = totalKg(v.id);
    const editable = v.status === 'DRAFT' && canEdit();
    const sc = canCost() ? standardCost(v.id) : null;
    body.appendChild(table({
      id: 'rec03-' + v.id, rows: ins, search: false, pageSize: 40,
      toolbar: editable ? [btn('Agregar ingrediente', () => drawer('Agregar ingrediente', (b, close) => b.appendChild(ingForm(v, null, close)), { code: 'REC-03' }), { sm: true, kind: 'primary', icon: '+' })] : [],
      columns: [
        { key: 'seq', label: '#', align: 'r' }, { key: 'v', label: 'Ingrediente', value: i => G.variantName(i.variant_id) },
        { key: 'qty_kg', label: 'Kg por lote', align: 'r', render: i => F.num(i.qty_kg, 4) }, { key: 'p', label: '% del total', align: 'r', render: i => F.pct(i.qty_kg / total * 100, 2) },
        { key: 'weighing_tolerance_pct', label: 'Tolerancia', align: 'r', render: i => `± ${F.pct(i.weighing_tolerance_pct, 1)}` },
        { key: 'a', label: 'Aditivo', render: i => { if (!i.is_additive) return '—'; const a = G.db.get(T_A, i.additive_id); return a ? `SIN ${a.sin_code} · ${a.name}` : badge('Sin SIN (RN-REC-04)', 'bad'); } },
        { key: 'ppm', label: 'Dosis', align: 'r', render: i => { if (!i.is_additive) return '—'; const a = G.db.get(T_A, i.additive_id) || {}; const d = ppm(i, total); return h('span', { style: a.max_ppm && d > a.max_ppm ? 'color:var(--bad);font-weight:700' : '' }, `${F.num(d, 0)} ppm`); } },
        { key: 'lim', label: 'Límite', align: 'r', render: i => { if (!i.is_additive) return '—'; const a = G.db.get(T_A, i.additive_id) || {}; return a.max_ppm ? `${F.num(a.max_ppm, 0)} ppm` : badge('Sin límite', 'warn'); } },
        { key: 'allergen', label: 'Alérgeno' },
        sc ? { key: 'c', label: 'Costo prom.', align: 'r', render: i => F.money((sc.rows.find(x => x.id === i.id) || {}).cost, 3) } : null,
        sc ? { key: 'm', label: 'Importe', align: 'r', render: i => F.money((sc.rows.find(x => x.id === i.id) || {}).amount, 2) } : null,
      ].filter(Boolean),
      footer: ['', 'Total', { v: F.num(total, 4), align: 'r' }, { v: '100 %', align: 'r' }, '', '', '', '', '', sc ? { v: '', align: 'r' } : null, sc ? { v: F.money(sc.total), align: 'r' } : null].filter(x => x !== null),
      actions: editable ? i => [btn('Editar', () => drawer('Editar ingrediente', (b, close) => b.appendChild(ingForm(v, i, close)), { code: 'REC-03' }), { sm: true }), btn('Quitar', () => tryRun(() => G.rec.removeIngredient(i.id), 'Ingrediente quitado'), { sm: true, kind: 'danger' })] : null,
    }));
    body.appendChild(h('div', { class: 'grid c2' }, card('Alérgenos de la versión (RN-REC-07)', h('div', { class: 'stack' }, h('div', null, (allergensOf(v.id).length ? allergensOf(v.id) : ['Ninguno']).map(a => badge(a, a === 'Ninguno' ? 'ok' : 'warn'))), h('p', { class: 'small muted' }, 'Unión de los alérgenos de los ingredientes y aditivos; se fijan al aprobar y no se escriben a mano.'))),
      card('Validación de aditivos', h('div', { class: 'stack' }, validate(v.id).filter(c => ['RN-REC-04', 'RN-REC-05'].includes(c.code)).map(c => notice(`${c.code}: ${c.msg}`, c.level === 'error' ? 'bad' : c.level === 'warn' ? 'warn' : 'ok')), validate(v.id).some(c => ['RN-REC-04', 'RN-REC-05'].includes(c.code)) ? null : h('p', { class: 'small muted' }, 'La versión no tiene aditivos.')))));
  }

  /* ---------- REC-04 Catálogo de aditivos ---------- */
  function renderAdditives(el) {
    const usage = a => G.db.where(T_I, i => i.additive_id === a.id).map(i => ({ i, v: version(i.version_id) })).filter(x => x.v);
    G.ui.crud(el, {
      code: 'REC-04', title: 'Catálogo de aditivos', sub: 'Código SIN, nombre, función, límite máximo configurable y alérgenos. Los límites los carga Calidad según la norma vigente; el sistema no trae límites de fábrica (D-REC-01: sin límite, la aprobación avisa).',
      table: T_A, canCreate: G.can('rec.version.approve') || canEdit(), canEdit: G.can('rec.version.approve') || canEdit(), createLabel: 'Nuevo aditivo',
      kpis: () => { const all = G.db.all(T_A); return [{ label: 'Aditivos', value: all.length }, { label: 'Con límite cargado', value: all.filter(a => a.max_ppm).length, sub: 'por Calidad' }, { label: 'Sin límite (D-REC-01)', value: all.filter(a => !a.max_ppm).length, tone: 'warn' }, { label: 'Usados en recetas', value: all.filter(a => usage(a).length).length }]; },
      filters: [{ key: 'function_class', label: 'Función', options: FUNCS }],
      columns: [{ key: 'sin_code', label: 'SIN', mono: true }, { key: 'name', label: 'Nombre' }, { key: 'function_class', label: 'Función', value: a => lbl(FUNCS, a.function_class) }, { key: 'max_ppm', label: 'Límite', align: 'r', render: a => a.max_ppm ? `${F.num(a.max_ppm, 0)} ppm` : badge('Sin límite', 'warn') }, { key: 'max_ppm_source', label: 'Fuente del límite' }, { key: 'allergen', label: 'Alérgeno' }, { key: 'u', label: 'Recetas', align: 'r', value: a => usage(a).length }, { key: 'status', label: 'Estado', render: a => G.ui.status(a.status) }],
      fields: [{ key: 'sin_code', label: 'Código SIN', required: true, help: 'Ejemplos: 250, 451(i), 1422.' }, { key: 'name', label: 'Nombre', required: true }, { key: 'function_class', label: 'Función', type: 'select', required: true, options: FUNCS }, { key: 'max_ppm', label: 'Límite máximo (ppm)', type: 'number', min: 0 }, { key: 'max_ppm_source', label: 'Norma o fuente del límite' }, { key: 'allergen', label: 'Alérgeno' }, { key: 'variant_id', label: 'Insumo de almacén', type: 'select', options: G.db.where('product_variants', x => (G.productOf(x.id) || {}).category_id === 'pc-INSUMOS').map(x => [x.id, x.name]) }, { key: 'status', label: 'Estado', type: 'select', required: true, options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']] }],
      defaults: () => ({ status: 'ACTIVE', function_class: 'PRESERVATIVE' }),
      beforeSave: (x, row) => { if (!/^[0-9]{3,4}[a-z]?(\([ivx]+\))?$/.test(String(x.sin_code).trim())) return { sin_code: 'Código SIN no válido: 3 o 4 dígitos, una letra opcional y numeral romano entre paréntesis (p. ej. 451(i)).' }; if (G.db.find(T_A, a => a.sin_code === x.sin_code && (!row || a.id !== row.id))) return { sin_code: 'Ese código SIN ya está en el catálogo.' }; if (x.max_ppm !== '' && x.max_ppm != null && !(Number(x.max_ppm) > 0)) return { max_ppm: 'El límite debe ser mayor que 0 o quedar vacío.' }; if (x.max_ppm && !(x.max_ppm_source || '').trim()) return { max_ppm_source: 'Indica la norma de la que sale el límite.' }; if (x.max_ppm === '') x.max_ppm = null; },
      detail: a => h('div', { class: 'stack' }, dl([['Código SIN', a.sin_code], ['Función', lbl(FUNCS, a.function_class)], ['Límite', a.max_ppm ? `${F.num(a.max_ppm, 0)} ppm` : 'Sin límite cargado (D-REC-01)'], ['Fuente', a.max_ppm_source], ['Alérgeno', a.allergen], ['Insumo', G.variantName(a.variant_id)]]), h('h3', null, 'Uso en recetas'), table({ id: 'rec04u-' + a.id, rows: usage(a).map(x => ({ id: x.i.id, x })), search: false, columns: [{ key: 'r', label: 'Versión', value: r => vLabel(r.x.v) }, { key: 'kg', label: 'Kg', align: 'r', render: r => F.num(r.x.i.qty_kg, 4) }, { key: 'ppm', label: 'Dosis', align: 'r', render: r => { const d = ppm(r.x.i, totalKg(r.x.v.id)); return h('span', { style: a.max_ppm && d > a.max_ppm ? 'color:var(--bad);font-weight:700' : '' }, `${F.num(d, 0)} ppm`); } }] })),
    });
  }

  /* ---------- REC-05 Pasos ---------- */
  function renderSteps(el, params = {}) {
    const body = page(el, { code: 'REC-05', title: 'Pasos', sub: 'Orden, descripción, tiempo y categoría de equipo (olla, cocina, embutidora, selladora…). Solo se cambian en borrador (RN-REC-03).' });
    if (operarioGate(body)) return;
    const { v, node } = verPicker('REC-05', params, null, 'rv-CHO-2');
    body.appendChild(node); if (!v) return;
    body.appendChild(nav(v)); const ln = lockNote(v); if (ln) body.appendChild(ln);
    const editable = v.status === 'DRAFT' && canEdit();
    const st = steps(v.id);
    const edit = s => drawer(s ? 'Editar paso ' + s.seq : 'Nuevo paso', (b, close) => b.appendChild(form({ id: 'rec05f', values: s || { seq: (Math.max(0, ...st.map(x => x.seq)) + 1) }, submitLabel: 'Guardar', fields: [{ key: 'seq', label: 'Orden', type: 'number', required: true, min: 1 }, { key: 'description', label: 'Descripción', type: 'textarea', required: true }, { key: 'duration_min', label: 'Tiempo (min)', type: 'number', min: 0 }, { key: 'equipment_category', label: 'Equipo', type: 'select', options: EQCAT }], onSubmit: x => { try { saveStep(v.id, x, s && s.id); close(); toast('Paso guardado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })), { code: 'REC-05' });
    body.appendChild(kpis([{ label: 'Pasos', value: st.length }, { label: 'Tiempo total', value: F.num(U.sum(st, s => s.duration_min || 0) / 60, 1) + ' h', sub: 'incluye reposos y curados' }, { label: 'Puntos de control', value: controlPoints(v.id).length, onClick: () => G.go('REC-06', { id: v.id }) }]));
    body.appendChild(table({ id: 'rec05-' + v.id, rows: st, search: false, toolbar: editable ? [btn('Agregar paso', () => edit(null), { sm: true, kind: 'primary', icon: '+' })] : [], columns: [{ key: 'seq', label: '#', align: 'r' }, { key: 'description', label: 'Descripción' }, { key: 'duration_min', label: 'Tiempo', align: 'r', render: s => s.duration_min != null ? (s.duration_min >= 120 ? F.num(s.duration_min / 60, 1) + ' h' : s.duration_min + ' min') : '—' }, { key: 'equipment_category', label: 'Equipo', value: s => s.equipment_category ? lbl(EQCAT, s.equipment_category) : '—' }, { key: 'cp', label: 'Control', render: s => { const c = controlPoints(v.id).filter(x => x.step_seq === s.seq); return c.length ? c.map(x => badge(x.code + (x.is_critical ? ' crítico' : ''), x.is_critical ? 'bad' : 'info')) : '—'; } }], actions: editable ? s => [btn('↑', () => tryRun(() => moveStep(s.id, -1)), { sm: true, title: 'Subir' }), btn('↓', () => tryRun(() => moveStep(s.id, 1)), { sm: true, title: 'Bajar' }), btn('Editar', () => edit(s), { sm: true }), btn('Quitar', () => tryRun(() => G.rec.removeStep(s.id), 'Paso quitado'), { sm: true, kind: 'danger' })] : null }));
  }

  /* ---------- REC-06 Puntos de control ---------- */
  function renderCps(el, params = {}) {
    const body = page(el, { code: 'REC-06', title: 'Puntos de control', sub: 'Variable (temperatura interna, tiempo, pH, % de salmuera, °Brix, actividad de agua), rango mínimo y máximo, unidad, si es crítico y la acción correctiva (RN-REC-12). Las recetas cocidas necesitan un punto crítico de temperatura o tiempo (RN-REC-06).' });
    if (operarioGate(body)) return;
    const { v, node } = verPicker('REC-06', params, null, 'rv-CHO-2');
    body.appendChild(node); if (!v) return;
    body.appendChild(nav(v)); const ln = lockNote(v); if (ln) body.appendChild(ln);
    const editable = v.status === 'DRAFT' && canEdit();
    const cps = controlPoints(v.id);
    const rc = recipe(v.recipe_id);
    const reads = G.db.where('production_ccp_readings', r => cps.some(c => c.id === r.control_point_id));
    const sameCode = G.db.where('production_ccp_readings', r => { const c = G.db.get(T_C, r.control_point_id); return c && version(c.version_id) && version(c.version_id).recipe_id === rc.id; });
    const edit = c => drawer(c ? 'Editar ' + c.code : 'Nuevo punto de control', (b, close) => b.appendChild(form({ id: 'rec06f', values: c || { code: 'PC' + (cps.length + 1), variable: 'CORE_TEMP', unit: '°C', is_critical: false }, submitLabel: 'Guardar', fields: [{ key: 'code', label: 'Código', required: true }, { key: 'variable', label: 'Variable', type: 'select', required: true, options: VARS }, { key: 'min_value', label: 'Mínimo', type: 'number' }, { key: 'max_value', label: 'Máximo', type: 'number' }, { key: 'unit', label: 'Unidad', required: true }, { key: 'step_seq', label: 'Paso', type: 'select', options: steps(v.id).map(s => [s.seq, `${s.seq}. ${s.description.slice(0, 40)}`]) }, { key: 'is_critical', label: 'Es crítico (PCC)', type: 'checkbox' }, { key: 'corrective_action', label: 'Acción correctiva', type: 'textarea', required: true }], onSubmit: x => { try { saveCp(v.id, x, c && c.id); close(); toast('Punto de control guardado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })), { code: 'REC-06' });
    const need = COOKED.includes(rc.recipe_type);
    const hasCrit = cps.some(c => c.is_critical && ['CORE_TEMP', 'TIME'].includes(c.variable));
    body.appendChild(kpis([{ label: 'Puntos de control', value: cps.length, sub: `${cps.filter(c => c.is_critical).length} críticos` }, { label: 'RN-REC-06', value: !need ? 'No aplica' : hasCrit ? 'Cumple' : 'Falta', sub: need ? 'crítico de temperatura o tiempo' : lbl(TYPES, rc.recipe_type), tone: need && !hasCrit ? 'bad' : 'ok' }, { label: 'Lecturas en producción', value: sameCode.length, sub: 'todas las versiones de la receta' }, { label: 'Fuera de rango (KPI-REC-03)', value: F.pct(sameCode.length ? sameCode.filter(r => !r.in_range).length / sameCode.length * 100 : null, 1), tone: sameCode.some(r => !r.in_range) ? 'warn' : 'ok' }]));
    body.appendChild(table({ id: 'rec06-' + v.id, rows: cps, search: false, toolbar: editable ? [btn('Agregar punto', () => edit(null), { sm: true, kind: 'primary', icon: '+' })] : [], columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'variable', label: 'Variable', value: c => lbl(VARS, c.variable) }, { key: 'r', label: 'Rango', render: c => `${F.num(c.min_value, 1)} – ${F.num(c.max_value, 1)} ${c.unit}` }, { key: 'step_seq', label: 'Paso', align: 'r' }, { key: 'is_critical', label: 'Crítico', render: c => c.is_critical ? badge('Crítico', 'bad') : '—' }, { key: 'corrective_action', label: 'Acción correctiva' }, { key: 'rd', label: 'Lecturas', align: 'r', render: c => { const rs = reads.filter(r => r.control_point_id === c.id); return rs.length ? `${rs.length} (${rs.filter(r => !r.in_range).length} fuera)` : '—'; } }], actions: editable ? c => [btn('Editar', () => edit(c), { sm: true }), btn('Quitar', () => tryRun(() => G.rec.removeControlPoint(c.id), 'Punto quitado'), { sm: true, kind: 'danger' })] : null }));
  }

  /* ---------- REC-07 Revisión y aprobación ---------- */
  function renderReview(el, params = {}) {
    const body = page(el, { code: 'REC-07', title: 'Revisión y aprobación', sub: 'Comparación con la versión vigente, validaciones (aditivos, puntos de control, vida útil, rendimiento) y aprobación por un usuario con rec.version.approve distinto del autor (RN-REC-02). Aprobar retira la versión anterior (RN-REC-01).' });
    if (operarioGate(body)) return;
    const pending = G.db.where(T_V, v => ['IN_REVIEW', 'DRAFT'].includes(v.status));
    const { v, node } = verPicker('REC-07', params, x => ['IN_REVIEW', 'DRAFT'].includes(x.status) || (params.id && x.id === params.id), (pending.find(x => x.status === 'IN_REVIEW') || {}).id);
    body.appendChild(kpis([{ label: 'En revisión', value: pending.filter(x => x.status === 'IN_REVIEW').length, tone: pending.some(x => x.status === 'IN_REVIEW') ? 'warn' : 'ok' }, { label: 'En borrador', value: pending.filter(x => x.status === 'DRAFT').length }, { label: 'Aprobadas en los últimos 30 días', value: G.db.where(T_V, x => x.approved_at && x.approved_at.slice(0, 10) >= G.date.add(G.TODAY, -30)).length }]));
    body.appendChild(node);
    if (!v) return body.appendChild(G.ui.empty('No hay versiones por revisar.'));
    const rc = recipe(v.recipe_id); const prev = current(rc.id);
    const checks = validate(v.id);
    const errs = checks.filter(c => c.level === 'error');
    const canApprove = G.can('rec.version.approve'); const isAuthor = v.created_by === G.ctx.userId();
    const grid = h('div', { class: 'grid c2' });
    grid.appendChild(card('Validaciones', h('div', { class: 'stack' }, checks.map(c => h('div', { class: 'row', style: 'gap:8px;align-items:flex-start' }, badge(c.level === 'ok' ? 'OK' : c.level === 'warn' ? 'Aviso' : 'Bloquea', c.level === 'ok' ? 'ok' : c.level === 'warn' ? 'warn' : 'bad'), h('span', { class: 'small' }, h('b', { class: 'mono' }, c.code), ' ', c.msg))),
      h('div', { class: 'row', style: 'gap:8px;align-items:flex-start' }, badge(isAuthor ? 'Bloquea' : canApprove ? 'OK' : 'Bloquea', isAuthor || !canApprove ? 'bad' : 'ok'), h('span', { class: 'small' }, h('b', { class: 'mono' }, 'RN-REC-02'), ` Autor: ${G.userName(v.created_by)} · revisa: ${G.ctx.userName()} (${G.roleName()})${isAuthor ? ' — es la misma persona' : !canApprove ? ' — sin permiso rec.version.approve' : ''}`)),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
        btn('Aprobar versión', () => tryRun(() => approve(v.id), x => `v${x.version} aprobada${prev ? `; la v${prev.version} pasa a retirada` : ''}${x.approval_warnings ? ' (con advertencias registradas)' : ''}`), { kind: 'primary', disabled: !canApprove || v.status === 'APPROVED' }),
        v.status === 'IN_REVIEW' ? btn('Devolver a borrador', () => modal('Devolver a borrador', b => b.appendChild(h('textarea', { class: 'input', id: 'rec07-c', placeholder: 'Qué debe corregirse', attrs: { 'aria-label': 'Comentario' } })), [{ label: 'Cancelar' }, { label: 'Devolver', kind: 'danger', onClick: () => !!tryRun(() => backToDraft(v.id, document.getElementById('rec07-c').value), 'Versión devuelta al autor') }]), { sm: true }) : null,
        btn('Editar versión', () => G.go('REC-02', { id: v.id }), { sm: true, kind: 'ghost' })),
      errs.length ? notice(`No se aprueba mientras haya ${errs.length} bloqueo(s).`, 'bad') : null)));
    // comparación
    const a = prev ? ingredients(prev.id) : [], b = ingredients(v.id);
    const keys = [...new Set([...a.map(x => x.variant_id), ...b.map(x => x.variant_id)])];
    const cmp = keys.map(k => { const x = a.find(i => i.variant_id === k), y = b.find(i => i.variant_id === k); return { id: k, k, old: x ? x.qty_kg : null, now: y ? y.qty_kg : null }; });
    const sc = canCost() ? standardCost(v.id) : null;
    grid.appendChild(card(prev ? `Frente a la vigente v${prev.version}` : 'Primera versión', h('div', { class: 'stack' },
      dl([['Kg base de salida', `${prev ? F.num(prev.base_output_kg, 3) + ' → ' : ''}${F.num(v.base_output_kg, 3)}`], ['Kg de ingredientes', `${prev ? F.num(totalKg(prev.id), 4) + ' → ' : ''}${F.num(totalKg(v.id), 4)}`], ['Rendimiento esperado', `${prev ? F.pct(prev.expected_yield_pct, 2) + ' → ' : ''}${F.pct(expectedYield(v.id), 2)}`], ['Vida útil', `${prev ? (prev.shelf_life_days || '—') + ' → ' : ''}${v.shelf_life_days || '—'} días`], canCost() ? ['Costo por kg', `${prev ? F.money(prev.standard_cost_per_kg, 3) + ' → ' : ''}${F.money(sc.per_kg, 3)}`] : null, ['Alérgenos', `${prev ? (prev.allergens || []).join(', ') || 'ninguno' : ''}${prev ? ' → ' : ''}${allergensOf(v.id).join(', ') || 'ninguno'}`]]),
      table({ id: 'rec07c-' + v.id, rows: cmp, search: false, pageSize: 30, columns: [{ key: 'k', label: 'Ingrediente', value: x => G.variantName(x.k) }, { key: 'old', label: prev ? 'v' + prev.version : 'Antes', align: 'r', render: x => x.old != null ? F.num(x.old, 4) : '—' }, { key: 'now', label: 'v' + v.version, align: 'r', render: x => x.now != null ? F.num(x.now, 4) : '—' }, { key: 'd', label: 'Cambio', align: 'r', render: x => x.old == null ? badge('Nuevo', 'info') : x.now == null ? badge('Quitado', 'warn') : x.old === x.now ? '—' : h('b', null, (x.now > x.old ? '+' : '') + F.num(x.now - x.old, 4)) }] }))));
    body.appendChild(grid);
  }

  /* ---------- REC-08 Escalado ---------- */
  const scaleState = { kg: 25 };
  function renderScale(el, params = {}) {
    const body = page(el, { code: 'REC-08', title: 'Escalado', sub: 'Cantidad deseada → factor = kg deseados / kg base y kg de cada ingrediente = kg base × factor, redondeado a 3 decimales (RN-REC-08). Es lo que usa la orden de producción (PRO-05).' });
    if (operarioGate(body)) return;
    const { v, node } = verPicker('REC-08', params, x => x.status === 'APPROVED', 'rv-CAL-2');
    body.appendChild(node); if (!v) return body.appendChild(G.ui.empty('No hay versiones aprobadas.'));
    if (params.kg) scaleState.kg = Number(params.kg);
    const out = h('div', { class: 'stack', style: 'min-width:0' });
    const draw = () => {
      G.ui.clear(out);
      const sc = scale(v.id, scaleState.kg);
      const site = 'pl-' + (recipe(v.recipe_id) || {}).line_code; const ln = G.db.get('production_lines', site);
      const stock = vid => ln && G.pro ? U.sum(G.db.where('warehouses', w => w.establishment_id === ln.establishment_id), w => G.pro.availAt(vid, w.id, G.TODAY)) : G.inv.qty(vid, null, { releasedOnly: true });
      out.appendChild(kpis([{ label: 'Factor de escala', value: F.num(sc.factor, 4), sub: `${F.num(scaleState.kg, 3)} / ${F.num(v.base_output_kg, 3)} kg base` }, { label: 'Kg de ingredientes', value: F.num(U.sum(sc.rows, r => r.kg), 3) }, { label: 'Rendimiento esperado', value: F.pct(v.expected_yield_pct, 2) }, canCost() ? { label: 'Costo estándar del lote', value: F.money(v.standard_cost_per_kg * scaleState.kg) } : null].filter(Boolean)));
      out.appendChild(table({ id: 'rec08-' + v.id, rows: sc.rows.map(r => Object.assign({ id: r.seq }, r)), search: false, pageSize: 40, columns: [{ key: 'seq', label: '#', align: 'r' }, { key: 'v', label: 'Ingrediente', value: r => G.variantName(r.variant_id) }, { key: 'base_kg', label: 'Kg base', align: 'r', render: r => F.num(r.base_kg, 4) }, { key: 'kg', label: 'Kg escalados', align: 'r', render: r => h('b', null, F.num(r.kg, 3)) }, { key: 't', label: 'Tolerancia', align: 'r', render: r => `± ${F.num(r.kg * r.tolerance_pct / 100, 3)} kg` }, { key: 's', label: ln ? 'Stock liberado ' + G.siteName(ln.establishment_id) : 'Stock liberado', align: 'r', render: r => { const s = stock(r.variant_id); return h('span', { style: s < r.kg ? 'color:var(--bad);font-weight:700' : '' }, F.num(s, 3)); } }] }));
    };
    const inp = h('input', { class: 'input num', type: 'number', min: 0.1, step: 'any', value: scaleState.kg, style: 'width:120px', attrs: { 'aria-label': 'Kg deseados', id: 'rec08-kg' } });
    inp.addEventListener('input', () => { const n = Number(inp.value); if (n > 0) { scaleState.kg = n; draw(); } });
    body.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:10px;align-items:center' }, h('label', { attrs: { for: 'rec08-kg' } }, 'Kg deseados'), inp, G.screens['PRO-05'] && G.can('pro.order.create') ? btn('Crear orden de producción', () => G.go('PRO-05', { version: v.id, kg: scaleState.kg }), { kind: 'primary', sm: true }) : null));
    body.appendChild(out); draw();
  }

  /* ---------- REC-09 Costo de la receta ---------- */
  function renderCost(el, params = {}) {
    const body = page(el, { code: 'REC-09', title: 'Costo de la receta', sub: `Costo por kg = Σ (kg × costo promedio vigente) / kg base de salida (RN-REC-09), y su variación desde la última aprobación. Avisa si supera ${G.param('rec_cost_alert_pct')} % (KPI-REC-01).` });
    if (!canCost()) { body.appendChild(notice(`Tu rol (${G.roleName()}) no ve costos de recetas (rec.cost.view).`, 'warn')); return; }
    const alertPct = G.param('rec_cost_alert_pct');
    const app = G.db.where(T_V, v => v.status === 'APPROVED');
    const rows = app.map(v => ({ id: v.id, v, rc: recipe(v.recipe_id), now: standardCost(v.id).per_kg })).map(r => Object.assign(r, { var: r.v.standard_cost_per_kg ? R((r.now - r.v.standard_cost_per_kg) / r.v.standard_cost_per_kg * 100, 2) : null }));
    const kv = G.kpi('KPI-REC-01');
    body.appendChild(kpis([{ label: 'KPI-REC-01 Variación promedio', value: kv && kv.value != null ? `${kv.value > 0 ? '+' : ''}${F.pct(kv.value, 2)}` : '—', tone: kv && Math.abs(kv.value) > alertPct ? 'warn' : 'ok' }, { label: `Recetas sobre ${alertPct} %`, value: rows.filter(r => Math.abs(r.var || 0) > alertPct).length, tone: rows.some(r => Math.abs(r.var || 0) > alertPct) ? 'bad' : 'ok' }, { label: 'Recetas aprobadas', value: rows.length }]));
    body.appendChild(table({
      id: 'rec09', rows, search: true, onRow: r => G.go('REC-09', { id: r.v.id }), sort: 'var', dir: -1,
      toolbar: [btn('Recalcular y avisar', () => { let n = 0; for (const r of rows) { r.v.recalc_cost_per_kg = r.now; r.v.recalc_at = G.date.now(); if (Math.abs(r.var || 0) > alertPct) { n++; G.notify({ role: 'JEFE_PRODUCCION', title: `Costo de ${r.rc.name} varió ${F.pct(r.var, 1)}`, body: `Estándar al aprobar ${F.money(r.v.standard_cost_per_kg, 3)} → hoy ${F.money(r.now, 3)} por kg.`, ref: r.v.id, tone: 'warn', module: 'REC' }); } } G.db.touch(); toast(`Costos recalculados; ${n} aviso(s) al jefe de producción`, n ? 'warn' : 'ok'); G.refresh(); }, { sm: true, kind: 'primary' })],
      columns: [{ key: 'c', label: 'Receta', value: r => `${r.rc.code} · ${r.rc.name} v${r.v.version}` }, { key: 'std', label: 'Al aprobar', align: 'r', value: r => r.v.standard_cost_per_kg, render: r => F.money(r.v.standard_cost_per_kg, 3) }, { key: 'now', label: 'Recalculado hoy', align: 'r', render: r => F.money(r.now, 3) }, { key: 'var', label: 'Variación', align: 'r', render: r => h('b', { style: Math.abs(r.var || 0) > alertPct ? 'color:var(--bad)' : '' }, `${r.var > 0 ? '+' : ''}${F.pct(r.var, 2)}`) }, { key: 'a', label: 'Aprobada', render: r => F.date(r.v.approved_at) }, { key: 'rec', label: 'Último recálculo', render: r => F.datetime(r.v.recalc_at) }],
    }));
    const { v, node } = verPicker('REC-09', params, null, (rows.sort((a, b) => Math.abs(b.var || 0) - Math.abs(a.var || 0))[0] || {}).id);
    if (!v) return;
    const sc = standardCost(v.id);
    body.appendChild(card('Detalle por ingrediente', h('div', { class: 'stack' }, node, table({ id: 'rec09d-' + v.id, rows: sc.rows, search: false, pageSize: 40, columns: [{ key: 'v', label: 'Ingrediente', value: r => G.variantName(r.variant_id) }, { key: 'qty_kg', label: 'Kg por lote', align: 'r', render: r => F.num(r.qty_kg, 4) }, { key: 'cost', label: 'Costo promedio', align: 'r', render: r => F.money(r.cost, 4) }, { key: 'amount', label: 'Importe', align: 'r', render: r => F.money(r.amount, 2) }, { key: 'p', label: '% del costo', align: 'r', render: r => F.pct(sc.total ? r.amount / sc.total * 100 : 0, 1) }], footer: ['Total', '', '', { v: F.money(sc.total), align: 'r' }, ''] }), dl([['Kg base de salida', F.num(v.base_output_kg, 3)], ['Costo por kg hoy', F.money(sc.per_kg, 4)], ['Costo al aprobar', v.standard_cost_per_kg ? F.money(v.standard_cost_per_kg, 4) : 'aún no aprobada']]))));
  }

  /* ---------- REC-10 Ficha técnica ---------- */
  function renderSheet(el, params = {}) {
    const body = page(el, { code: 'REC-10', title: 'Ficha técnica', sub: 'Por versión: ingredientes en orden decreciente, aditivos con su código SIN, alérgenos, vida útil, conservación y registro sanitario del producto (CAL-10).', actions: [btn('Imprimir o PDF', () => G.print(), { kind: 'primary' })] });
    if (operarioGate(body)) return;
    const { v, node } = verPicker('REC-10', params, null, 'rv-CHO-1');
    body.appendChild(node); if (!v) return;
    const rc = recipe(v.recipe_id); const p = G.db.get('products', rc.product_id) || {}; const br = G.db.get('brands', rc.brand_id) || {};
    const ins = ingredients(v.id).slice().sort((a, b) => b.qty_kg - a.qty_kg); const total = totalKg(v.id);
    const reg = G.db.find('sanitary_registrations', s => s.product_id === p.id && s.status !== 'REVOKED');
    const regNo = reg ? reg.registration_number || reg.number : p.sanitary_registry; const regExp = reg ? reg.expires_on || reg.valid_until : p.sanitary_registry_expires;
    const name = i => i.is_additive ? (G.db.get(T_A, i.additive_id) || {}).name : G.variantName(i.variant_id).replace(/ \(SIN.*\)$/, '');
    const allergens = ['APPROVED', 'RETIRED'].includes(v.status) ? v.allergens : allergensOf(v.id);
    const sheet = h('div', { class: 'card', style: `padding:20px;border-top:6px solid ${br.primary_color || 'var(--primary)'};max-width:860px` },
      h('div', { class: 'between', style: 'flex-wrap:wrap;gap:12px' }, h('div', null, h('div', { class: 'small muted' }, `${br.name || ''} · AGROPECUARIA DON GUANDO SAC`), h('h2', { style: 'margin:4px 0' }, p.name || rc.name), h('div', { class: 'small' }, `Ficha técnica ${rc.code} · versión ${v.version} · `, vbadge(v.status))), h('div', { class: 'small', style: 'text-align:right' }, `Registro sanitario: ${regNo || 'no aplica'}`, h('br'), regExp ? `Vence: ${F.date(regExp)}` : '', regExp && regExp < G.TODAY ? badge('Vencido', 'bad') : null)),
      h('h3', null, 'Ingredientes'), h('p', null, ins.map(i => `${name(i)}${i.is_additive ? ` (SIN ${(G.db.get(T_A, i.additive_id) || {}).sin_code})` : ''} ${F.num(i.qty_kg / total * 100, i.qty_kg / total < 0.01 ? 2 : 1)} %`).join(', ') + '.'),
      h('h3', null, 'Aditivos'), ins.some(i => i.is_additive) ? h('ul', null, ins.filter(i => i.is_additive).map(i => { const a = G.db.get(T_A, i.additive_id) || {}; return h('li', null, `${lbl(FUNCS, a.function_class)}: ${a.name} (SIN ${a.sin_code}) · ${F.num(ppm(i, total), 0)} ppm${a.max_ppm ? ` (límite ${F.num(a.max_ppm, 0)} ppm)` : ''}`); })) : h('p', null, 'Sin aditivos.'),
      h('h3', null, 'Alérgenos'), h('p', null, allergens.length ? h('b', null, 'Contiene: ' + allergens.join(', ').toLowerCase() + '.') : 'No contiene alérgenos declarables.'),
      h('div', { class: 'grid c3' }, dl([['Vida útil', v.shelf_life_days ? v.shelf_life_days + ' días' : 'Sin definir (RN-REC-10)']]), dl([['Conservación', lbl(STORAGE, v.storage)]]), dl([['Presentaciones', G.db.where('product_variants', x => x.product_id === p.id).map(x => x.name).join(' · ')]])),
      h('h3', null, 'Controles del proceso'), h('ul', null, controlPoints(v.id).map(c => h('li', null, `${c.code} ${lbl(VARS, c.variable).toLowerCase()} ${F.num(c.min_value, 1)}–${F.num(c.max_value, 1)} ${c.unit}${c.is_critical ? ' (crítico)' : ''}`))),
      h('p', { class: 'small muted' }, v.approved_at ? `Aprobada el ${F.date(v.approved_at)} por ${G.userName(v.approved_by)}. Elaborado por ${br.legal_footer || 'Agropecuaria Don Guando SAC'}.` : 'Versión no aprobada: borrador de ficha.'));
    body.appendChild(sheet);
  }

  /* ---------- registro ---------- */
  const spec = G.SPEC.REC || { screens: [] };
  const nm = c => ((spec.screens || []).find(s => s[0] === c) || [c, c])[1];
  G.register({
    code: 'REC', name: (G.SPEC.REC || {}).name || 'Recetas y formulación', phase: 2, group: 'Producción y calidad',
    screens: [
      { code: 'REC-01', name: nm('REC-01'), render: renderList }, { code: 'REC-02', name: nm('REC-02'), render: renderEditor },
      { code: 'REC-03', name: nm('REC-03'), render: renderIngredients }, { code: 'REC-04', name: nm('REC-04'), render: renderAdditives },
      { code: 'REC-05', name: nm('REC-05'), render: renderSteps }, { code: 'REC-06', name: nm('REC-06'), render: renderCps },
      { code: 'REC-07', name: nm('REC-07'), render: renderReview }, { code: 'REC-08', name: nm('REC-08'), render: renderScale },
      { code: 'REC-09', name: nm('REC-09'), render: renderCost }, { code: 'REC-10', name: nm('REC-10'), render: renderSheet },
    ],
  });

  /* ---------- indicadores, búsqueda y alertas ---------- */
  G.kpiCalc['KPI-REC-01'] = () => { const vs = G.db.where(T_V, v => v.status === 'APPROVED' && v.standard_cost_per_kg); if (!vs.length) return null; const vals = vs.map(v => (standardCost(v.id).per_kg - v.standard_cost_per_kg) / v.standard_cost_per_kg * 100); return { value: R(U.sum(vals) / vals.length, 2), numerator: vals.filter(x => Math.abs(x) > G.param('rec_cost_alert_pct')).length, denominator: vs.length }; };
  G.kpiCalc['KPI-REC-02'] = () => {
    const vs = G.db.where(T_V, v => v.status === 'APPROVED'); if (!vs.length) return null;
    const ok = vs.filter(v => { const p = G.db.get('products', recipe(v.recipe_id).product_id) || {}; const regOk = !p.sanitary_authority || p.sanitary_authority === 'NONE' || (p.sanitary_registry && (!p.sanitary_registry_expires || p.sanitary_registry_expires >= G.TODAY)); return v.shelf_life_days > 0 && controlPoints(v.id).length > 0 && regOk; });
    return { value: R(ok.length / vs.length * 100, 1), numerator: ok.length, denominator: vs.length };
  };
  G.kpiCalc['KPI-REC-03'] = ({ from, to } = {}) => { const rs = G.db.where('production_ccp_readings', r => String(r.read_at).slice(0, 10) >= (from || '0000') && String(r.read_at).slice(0, 10) <= (to || '9999')); return rs.length ? { value: R(rs.filter(r => !r.in_range).length / rs.length * 100, 2), numerator: rs.filter(r => !r.in_range).length, denominator: rs.length } : null; };
  G.searchProviders.push(q => { const s = q.toLowerCase(); if (s.length < 3 || isOperario()) return []; return G.db.where(T_R, r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s)).slice(0, 4).map(r => ({ label: `${r.code} · ${r.name}`, sub: `Receta · vigente ${current(r.id) ? 'v' + current(r.id).version : 'sin aprobar'}`, go: () => G.go('REC-02', { id: (current(r.id) || versionsOf(r.id)[0]).id }) })); });
  G.scanHandlers.push(code => { const r = G.db.find(T_R, x => x.code.toUpperCase() === code); return r ? () => G.go('REC-02', { id: (current(r.id) || versionsOf(r.id)[0]).id }) : null; });
  G.alertProviders.push(() => { const p = G.db.where(T_V, v => v.status === 'IN_REVIEW'); return p.length && (G.can('rec.version.approve') || canEdit()) ? [{ module: 'REC', title: `${p.length} versión(es) de receta por aprobar`, detail: p.map(v => `${recipe(v.recipe_id).name} v${v.version}`).join(', '), tone: 'info', go: () => G.go('REC-07', { id: p[0].id }) }] : []; });

  /* ---------- pruebas de aceptación (CA-REC-01 … 06) ---------- */
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e.message; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code} y la acción pasó.`); };
  const asRole = (role, fn) => { const prev = G.ctx.role, ps = G.ctx.session; G.ctx.role = role; G.ctx.session = null; try { return fn(); } finally { G.ctx.role = prev; G.ctx.session = ps; } };
  const T = (name, fn) => G.tests.push({ module: 'REC', name, fn });
  T('CA-REC-01: chorizo parrillero v2 con 10,3365 kg de ingredientes y 10,0 kg base → al aprobar rinde 96,74 % y la v1 pasa a RETIRED', async () => {
    assert(totalKg('rv-CHO-2') === 10.3365, 'Kg de ingredientes ' + totalKg('rv-CHO-2'));
    const v = asRole('CALIDAD', () => approve('rv-CHO-2'));
    assert(v.status === 'APPROVED' && v.expected_yield_pct === 96.74, `Estado ${v.status} y rendimiento ${v.expected_yield_pct}`);
    assert(version('rv-CHO-1').status === 'RETIRED', 'La v1 debe pasar a RETIRED (RN-REC-01)');
    assert(G.db.where(T_V, x => x.recipe_id === 'rc-CHO' && x.status === 'APPROVED').length === 1, 'Una sola versión aprobada');
    assert(/RN-REC-05/.test(v.approval_warnings || ''), 'Sin límite cargado, la aprobación registra la advertencia de aditivos');
  });
  T('CA-REC-02: la autora de la versión intenta aprobarla → RN-REC-02', async () => {
    const nv = newVersion('rc-MFR', 'rv-MFR-1', { seed: true, userId: G.ctx.userId() });
    expectFail(() => approve(nv.id), 'RN-REC-02');
    asRole('JEFE_PRODUCCION', () => expectFail(() => approve('rv-CHO-2'), 'RN-REC-02'));
  });
  T('CA-REC-03: nitrito de sodio (SIN 250) 0,0015 kg en 10,3365 kg = 145 ppm con límite de 100 ppm → RN-REC-05', async () => {
    const i = ingredients('rv-CHO-2').find(x => x.additive_id === 'fa-250');
    assert(Math.round(ppm(i, totalKg('rv-CHO-2'))) === 145, 'Dosis ' + ppm(i, totalKg('rv-CHO-2')));
    G.db.update(T_A, 'fa-250', { max_ppm: 100, max_ppm_source: 'Prueba' }, { silent: true });
    asRole('CALIDAD', () => expectFail(() => approve('rv-CHO-2'), 'RN-REC-05'));
    assert(version('rv-CHO-2').status === 'IN_REVIEW', 'La versión sigue en revisión');
  });
  T('CA-REC-04: receta de caldo de huesos sin punto de control crítico de temperatura → RN-REC-06', async () => {
    const nv = newVersion('rc-CAL', 'rv-CAL-2', { seed: true });
    for (const c of controlPoints(nv.id)) c.is_critical = false;
    asRole('CALIDAD', () => expectFail(() => approve(nv.id), 'RN-REC-06'));
  });
  T('CA-REC-05: en una versión aprobada, cambiar los kg de un ingrediente → RN-REC-03', async () => {
    const i = ingredients('rv-CAL-2')[0];
    asRole('JEFE_PRODUCCION', () => expectFail(() => updateIngredient(i.id, { qty_kg: 4.5 }), 'RN-REC-03'));
    assert(G.db.get(T_I, i.id).qty_kg === 4.0, 'El ingrediente no debe cambiar');
  });
  T('CA-REC-06: 7,000 kg de carne a S/ 18,50 + 2,000 kg de grasa a S/ 9,00 + resto S/ 6,20 con 10,0 kg base → S/ 15,370 por kg (S/ 153,70)', async () => {
    const rc = G.db.insert(T_R, { product_id: 'pr-CHOR', code: 'RC-TST', name: 'Prueba de costo', recipe_type: 'SAUSAGE', brand_id: 'br-M3', status: 'ACTIVE' }, { silent: true });
    const v = G.db.insert(T_V, { recipe_id: rc.id, version: 1, base_output_kg: 10, status: 'DRAFT', packaging: [], created_by: null }, { silent: true });
    addIngredient(v.id, { variant_id: 'va-MP-CER-REC', qty_kg: 7 }, { seed: true }); addIngredient(v.id, { variant_id: 'va-MP-CER-GRA', qty_kg: 2 }, { seed: true });
    addIngredient(v.id, { variant_id: 'va-IN-ESP-KG', qty_kg: 0.2 }, { seed: true }); addIngredient(v.id, { variant_id: 'va-IN-SAL-KG', qty_kg: 0.5 }, { seed: true });
    const c = standardCost(v.id, { costOf: { 'va-MP-CER-REC': 18.5, 'va-MP-CER-GRA': 9, 'va-IN-ESP-KG': 26, 'va-IN-SAL-KG': 2 } });
    assert(c.total === 153.7 && c.per_kg === 15.37, `Costo ${c.total} y por kg ${c.per_kg}`);
  });
})();
