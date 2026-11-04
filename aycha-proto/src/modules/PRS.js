/* =====================================================================
   PRS · Presupuesto (fase 3) · docs/fase-3/modulos/PRS-presupuesto.md
   Presupuesto anual por empresa con versiones (borrador → enviada →
   aprobada, una sola vigente), líneas por concepto × mes × marca/local/
   centro de costo, real calculado desde FAC (ventas y costo), GAS (gastos
   aprobados) y PER (planilla, comisiones y bonos), semáforo, proyección de
   cierre lineal por días, alertas al responsable y snapshots de meses
   cerrados (RN-PRS-09).
   Tablas: budget_concepts, budget_concept_mappings, budgets, budget_versions,
   budget_lines, budget_actuals (solo inserción), budget_forecasts, budget_alerts.
   ===================================================================== */
(function () {
  const { h, btn, badge, page, card, table, kpis, dl, notice, drawer, modal, toast, form, tabs, pills, empty } = G.ui;
  const U = G.util, F = G.fmt;
  const R = (n, d = 2) => U.round(n, d);
  const PRS = G.prs = {};
  const MOD = 'PRS';

  /* ------------------------------------------------------------------
     Etiquetas y parámetros
     ------------------------------------------------------------------ */
  const TYPES = [['INCOME', 'Ingreso'], ['COST_OF_SALES', 'Costo de ventas'], ['EXPENSE', 'Gasto']];
  const BEHAVIORS = [['VARIABLE', 'Variable'], ['FIXED', 'Fijo']];
  const SOURCES = [['SALES', 'Ventas aceptadas − notas de crédito (FAC)'], ['COST_OF_SALES', 'Costo de ventas de los comprobantes (FAC/CNT)'], ['EXPENSE_CATEGORY', 'Categoría de gasto (GAS)'], ['PAYROLL', 'Personal (PER)'], ['ACCOUNT', 'Cuenta contable (CNT)']];
  const PAYROLL_KINDS = [['PAYROLL', 'Planilla y cargas (importada o estimada)'], ['COMMISSION', 'Comisiones de vendedoras'], ['BONUS', 'Bonos por entrega']];
  const VST = { DRAFT: ['Borrador', ''], SUBMITTED: ['Por aprobar', 'warn'], APPROVED: ['Aprobada · vigente', 'ok'], REJECTED: ['Rechazada', 'bad'], SUPERSEDED: ['Reemplazada', ''] };
  const AST = { OPEN: ['Abierta', 'bad'], ACK: ['En seguimiento', 'warn'], CLOSED: ['Cerrada', ''], RESOLVED: ['Resuelta', 'ok'] };
  const LIGHT = { GREEN: ['Verde', 'ok'], AMBER: ['Ámbar', 'warn'], RED: ['Rojo', 'bad'] };
  const SRC_LBL = { FAC: 'Ventas (FAC)', GAS: 'Gastos (GAS)', PER: 'Personal (PER)', PER_EST: 'Planilla estimada', SNAPSHOT: 'Snapshot de cierre', CNT: 'Contabilidad (CNT)' };
  const lbl = (list, v) => (list.find(x => x[0] === v) || [v, v || '—'])[1];
  const vBadge = s => badge((VST[s] || [s])[0], (VST[s] || [, ''])[1]);
  const aBadge = s => badge((AST[s] || [s])[0], (AST[s] || [, ''])[1]);
  const lBadge = l => l ? badge(LIGHT[l][0], LIGHT[l][1]) : badge('Sin dato', '');
  PRS.TYPES = TYPES; PRS.SOURCES = SOURCES;
  const amberPct = () => Number(G.param('prs_amber_pct') ?? 5);
  const alertPct = () => Number(G.param('prs_alert_pct') ?? 10);
  const startMonth = () => Math.min(12, Math.max(1, Number(G.param('prs_fiscal_year_start_month') ?? 1)));
  const method = () => String(G.param('prs_forecast_method') ?? 'LINEAR_DAYS').replace(/"/g, '');
  const nowOr = at => at || G.date.now();
  const uid = () => G.ctx.userId();
  const nb = t => String(t).replace(/ /g, '\u00a0');
  const m0 = v => nb(F.money(v, 0));
  const pctTxt = p => p === null || p === undefined || !isFinite(p) ? '—' : nb(F.pct(p, 1));

  /* ------------------------------------------------------------------
     Fechas del año presupuestal
     ------------------------------------------------------------------ */
  PRS.monthsOf = year => { const s = `${year}-${U.pad(startMonth(), 2)}-01`; return Array.from({ length: 12 }, (_, i) => G.date.addMonths(s, i)); };
  PRS.yearOf = month => { const m = Number(month.slice(5, 7)); const y = Number(month.slice(0, 4)); return m >= startMonth() ? y : y - 1; };
  PRS.daysIn = p => G.date.diff(G.date.addMonths(G.date.month(p), 1), G.date.month(p));
  PRS.monthEnd = p => G.date.add(G.date.addMonths(G.date.month(p), 1), -1);
  PRS.elapsed = (p, asOf = G.TODAY) => { const m = G.date.month(p); if (asOf < m) return 0; return asOf >= PRS.monthEnd(m) ? PRS.daysIn(m) : G.date.diff(asOf, m) + 1; };
  /** CLOSED (período contable cerrado), COMPLETE (mes vencido abierto), CURRENT, FUTURE */
  PRS.monthState = (p, asOf = G.TODAY) => { const m = G.date.month(p); if (m > asOf) return 'FUTURE'; if (G.period.isClosed(m)) return 'CLOSED'; return PRS.monthEnd(m) < asOf ? 'COMPLETE' : 'CURRENT'; };
  const MSTATE = { CLOSED: 'Cerrado', COMPLETE: 'Vencido (abierto)', CURRENT: 'En curso', FUTURE: 'Futuro' };

  /* ------------------------------------------------------------------
     Semáforo (RN-PRS-07) y proyección (RN-PRS-08)
     ------------------------------------------------------------------ */
  PRS.isIncome = type => type === 'INCOME';
  PRS.light = function (pct, type) {
    if (pct === null || pct === undefined || !isFinite(pct)) return null;
    const a = amberPct();
    if (PRS.isIncome(type)) return pct >= 100 ? 'GREEN' : pct >= 100 - a ? 'AMBER' : 'RED';
    return pct <= 100 ? 'GREEN' : pct <= 100 + a ? 'AMBER' : 'RED';
  };
  PRS.lightFor = function (budget, value, type) {
    if (!budget) return PRS.isIncome(type) ? 'GREEN' : (value > 0.005 ? 'RED' : 'GREEN');
    return PRS.light(value / budget * 100, type);
  };
  PRS.pct = (a, b) => b ? R(a / b * 100, 1) : null;
  /** RN-PRS-08: real a la fecha / días transcurridos × días del mes; los fijos usan su presupuesto (o el real si ya lo superó) */
  PRS.forecastValue = function ({ actual = 0, budget = 0, elapsed, days, fixed }) {
    if (fixed) return R(Math.max(budget || 0, actual || 0));
    if (!elapsed) return R(budget || 0);
    if (method() !== 'LINEAR_DAYS') return R(Math.max(actual, budget));
    return R(actual / elapsed * days);
  };

  /* ------------------------------------------------------------------
     Conceptos y mapeos (RN-PRS-02, RN-PRS-06)
     ------------------------------------------------------------------ */
  PRS.concept = id => G.db.get('budget_concepts', id);
  PRS.cName = id => (PRS.concept(id) || {}).name || (id === '__UNMAPPED' ? 'Sin concepto (falta mapeo)' : '—');
  PRS.cCode = id => (PRS.concept(id) || {}).code || '—';
  PRS.concepts = () => G.db.all('budget_concepts').sort(U.by('sort_order'));
  PRS.leaves = () => PRS.concepts().filter(c => !c.is_group && c.status === 'ACTIVE');
  PRS.mappingsOf = cid => G.db.where('budget_concept_mappings', m => m.concept_id === cid && m.status !== 'INACTIVE');
  PRS.typeOf = cid => (PRS.concept(cid) || {}).concept_type || 'EXPENSE';
  PRS.isFixed = cid => (PRS.concept(cid) || {}).behavior === 'FIXED';
  PRS.needsMapping = c => c && !c.is_group && c.concept_type !== 'INCOME';
  PRS.isMapped = cid => PRS.mappingsOf(cid).length > 0;
  /** índice fuente → concepto para calcular el real (cada documento cuenta una sola vez) */
  PRS.mapIndex = function () {
    const idx = { SALES: null, COST_OF_SALES: null, EXPENSE_CATEGORY: {}, PAYROLL: {}, ACCOUNT: {} };
    const active = new Set(PRS.leaves().map(c => c.id));
    for (const m of G.db.where('budget_concept_mappings', m => m.status !== 'INACTIVE' && active.has(m.concept_id))) {
      if (m.source === 'SALES' || m.source === 'COST_OF_SALES') { if (!idx[m.source]) idx[m.source] = m.concept_id; }
      else if (idx[m.source] && !idx[m.source][m.ref]) idx[m.source][m.ref] = m.concept_id;
    }
    return idx;
  };
  PRS.mapLabel = function (m) {
    if (m.source === 'EXPENSE_CATEGORY') { const c = G.db.get('expense_categories', m.ref); return `GAS · ${c ? c.name : m.ref}`; }
    if (m.source === 'PAYROLL') return `PER · ${lbl(PAYROLL_KINDS, m.ref)}`;
    if (m.source === 'ACCOUNT') return `CNT · cuenta ${m.ref}`;
    return lbl(SOURCES, m.source);
  };
  PRS.addMapping = function (concept_id, { source, ref, note }) {
    if (!G.can('prs.concept.manage')) G.fail('RN-PRS-02', 'Mapear conceptos requiere el permiso prs.concept.manage (Administración o Contadora).');
    const c = PRS.concept(concept_id); if (!c || c.is_group) G.fail('RN-PRS-02', 'Elige un concepto de detalle (no un grupo).');
    if (!source) G.fail('RN-PRS-02', 'Elige la fuente del mapeo.');
    if (['EXPENSE_CATEGORY', 'PAYROLL', 'ACCOUNT'].includes(source) && !ref) G.fail('RN-PRS-02', 'Indica la categoría, el tipo de costo de personal o la cuenta contable.');
    if (source === 'ACCOUNT' && !/^\d{2,8}$/.test(String(ref))) G.fail('RN-PRS-02', `La cuenta contable «${ref}» debe ser numérica (PCGE, de 2 a 8 dígitos).`);
    if (c.concept_type === 'INCOME' && !['SALES', 'ACCOUNT'].includes(source)) G.fail('RN-PRS-06', 'Un concepto de ingreso solo se mapea a ventas (FAC) o a cuentas de ingreso.');
    if (c.concept_type !== 'INCOME' && source === 'SALES') G.fail('RN-PRS-06', 'Las ventas solo se mapean a conceptos de ingreso.');
    if (source === 'EXPENSE_CATEGORY') {
      const cat = G.db.get('expense_categories', ref);
      if (cat && cat.category_group === 'PERSONNEL' && G.db.find('budget_concept_mappings', m => m.source === 'PAYROLL' && m.status !== 'INACTIVE')) G.fail('RN-PRS-06', `«${cat.name}» es una categoría de personal de GAS: el personal se toma de PER y no se cuenta dos veces.`);
    }
    if (source === 'PAYROLL' && G.db.find('budget_concept_mappings', m => m.source === 'EXPENSE_CATEGORY' && m.status !== 'INACTIVE' && (G.db.get('expense_categories', m.ref) || {}).category_group === 'PERSONNEL')) G.fail('RN-PRS-06', 'Hay categorías de personal de GAS mapeadas: quítalas antes de mapear PER (un mismo costo cuenta una sola vez).');
    const dup = G.db.find('budget_concept_mappings', m => m.status !== 'INACTIVE' && m.source === source && String(m.ref || '') === String(ref || ''));
    if (dup) G.fail('RN-PRS-06', `${PRS.mapLabel(dup)} ya está mapeada a «${PRS.cName(dup.concept_id)}»: un mismo documento cuenta una sola vez.`);
    return G.db.insert('budget_concept_mappings', { concept_id, source, ref: ref || null, note: note || null, status: 'ACTIVE', created_by: uid() });
  };
  PRS.removeMapping = function (id) {
    if (!G.can('prs.concept.manage')) G.fail('RN-PRS-02', 'Quitar mapeos requiere prs.concept.manage.');
    return G.db.update('budget_concept_mappings', id, { status: 'INACTIVE', removed_by: uid(), removed_at: G.date.now() });
  };
  PRS.saveConcept = function (d, id) {
    if (!G.can('prs.concept.manage')) G.fail('RN-PRS-02', 'Crear o editar conceptos requiere prs.concept.manage.');
    const code = String(d.code || '').trim().toUpperCase(); if (!code || !String(d.name || '').trim()) G.fail('RN-PRS-01', 'El concepto necesita código y nombre.');
    if (G.db.find('budget_concepts', c => c.code === code && c.id !== id)) G.fail('RN-PRS-01', `Ya existe el concepto ${code}.`);
    const parent = d.parent_id ? PRS.concept(d.parent_id) : null;
    const row = { code, name: String(d.name).trim(), parent_id: d.parent_id || null, is_group: !!d.is_group, concept_type: parent ? parent.concept_type : (d.concept_type || 'EXPENSE'), behavior: d.is_group ? null : (d.behavior || 'VARIABLE'), default_cost_center_id: d.default_cost_center_id || null, status: d.status || 'ACTIVE', sort_order: parent ? (parent.sort_order + 1 + G.db.where('budget_concepts', c => c.parent_id === parent.id).length) : 900 };
    return id ? G.db.update('budget_concepts', id, row) : G.db.insert('budget_concepts', row);
  };

  /* ------------------------------------------------------------------
     Responsables de centro de costo (RN-PRS-10, RN-PRS-12)
     ------------------------------------------------------------------ */
  const AREA_ROLE = { PRODUCTION: 'JEFE_PRODUCCION', QUALITY: 'CALIDAD', WAREHOUSE: 'JEFE_PRODUCCION', DELIVERY: 'COORDINADOR_DELIVERY', SALES: 'SUPERVISORA_VENTAS', MARKETING: 'MARKETING', ADMIN: 'ADMINISTRACION', FINANCE: 'CONTADORA', HR: 'RRHH' };
  PRS.ownerOf = function (cc_id) {
    const cc = cc_id && G.db.get('cost_centers', cc_id); if (!cc) return null;
    const u = G.db.find('users', u => u.role === AREA_ROLE[cc.area] && u.status !== 'INACTIVE');
    return u ? u.id : null;
  };
  PRS.canViewAll = () => G.can('prs.report.view_all');
  /** RN-PRS-12: sin prs.report.view_all solo se ven las líneas del centro propio y de las marcas de alcance */
  PRS.visible = function (s) {
    if (!G.scope.ok(s)) return false;
    if (PRS.canViewAll()) return true;
    const me = uid(); const u = G.db.get('users', me) || {};
    return !!s.cost_center_id && PRS.ownerOf(s.cost_center_id) === me && (!s.brand_id || !u.brands || !u.brands.length || u.brands.includes(s.brand_id));
  };

  /* ------------------------------------------------------------------
     Presupuestos y versiones (RN-PRS-01/03/04/05)
     ------------------------------------------------------------------ */
  PRS.budgetFor = year => G.db.find('budgets', b => b.company_id === 'co-dg' && Number(b.year) === Number(year));
  PRS.versionsOf = bid => G.db.where('budget_versions', v => v.budget_id === bid).sort(U.by('version_no'));
  PRS.version = id => G.db.get('budget_versions', id);
  PRS.approved = bid => G.db.find('budget_versions', v => v.budget_id === bid && v.status === 'APPROVED');
  PRS.approvedFor = year => { const b = PRS.budgetFor(year); return b ? PRS.approved(b.id) : null; };
  PRS.yearOfVersion = v => (G.db.get('budgets', (v || {}).budget_id) || {}).year;
  PRS.vLabel = v => v ? `${PRS.yearOfVersion(v)} · v${v.version_no}` : '—';
  PRS.vCode = v => v ? `PRS-${PRS.yearOfVersion(v)}-V${v.version_no}` : '';
  PRS.linesOf = vid => G.db.where('budget_lines', l => l.version_id === vid);
  PRS.editable = v => v && ['DRAFT', 'REJECTED'].includes(v.status);
  const hist = (v, action, note, at, user) => (v.history || []).concat([{ at: nowOr(at), action, user: G.userName(user || uid()) || G.ctx.userName(), note: note || null }]);

  PRS.createBudget = function (year, { name, user_id, at } = {}) {
    if (!G.can('prs.budget.edit')) G.fail('RN-PRS-01', 'Crear presupuestos requiere el permiso prs.budget.edit (Administración).');
    year = Number(year);
    if (!(year >= 2020 && year <= 2100)) G.fail('RN-PRS-01', 'Indica un año válido.');
    const ex = PRS.budgetFor(year); if (ex) G.fail('RN-PRS-01', `Ya existe el presupuesto ${year} de la empresa: crea una nueva versión dentro de él.`);
    const by = user_id || uid();
    const b = G.db.insert('budgets', { company_id: 'co-dg', year, name: name || `Presupuesto ${year}`, status: 'ACTIVE', current_version_id: null, created_by: by, created_at: nowOr(at) }, { silent: G._seeding });
    PRS.newVersion(b.id, { user_id: by, at, name: 'Versión inicial' });
    return b;
  };
  /** nueva versión en borrador; si from_version_id copia sus líneas (revisión) con ajuste % */
  PRS.newVersion = function (budget_id, { from_version_id, pct = 0, name, user_id, at, source } = {}) {
    if (!G.can('prs.budget.edit')) G.fail('RN-PRS-04', 'Crear versiones requiere prs.budget.edit.');
    const no = (Math.max(0, ...PRS.versionsOf(budget_id).map(v => v.version_no)) || 0) + 1;
    const by = user_id || uid();
    const v = G.db.insert('budget_versions', { budget_id, version_no: no, name: name || (from_version_id ? `Revisión de v${(PRS.version(from_version_id) || {}).version_no}` : `Versión ${no}`), status: 'DRAFT', based_on_version_id: from_version_id || null, source: source || (from_version_id ? 'COPY_VERSION' : 'MANUAL'), adjust_pct: Number(pct) || 0, created_by: by, created_at: nowOr(at), submitted_by: null, submitted_at: null, approved_by: null, approved_at: null, decision_comment: null, history: [{ at: nowOr(at), action: from_version_id ? `Creada como revisión de ${PRS.vLabel(PRS.version(from_version_id))}${pct ? ` (${pct > 0 ? '+' : ''}${pct} %)` : ''}` : 'Creada', user: G.userName(by) }] }, { silent: G._seeding });
    if (from_version_id) PRS.copyVersion(from_version_id, v.id, pct, { silent: true });
    return v;
  };
  const keyOf = l => `${l.concept_id}|${l.brand_id || ''}|${l.establishment_id || ''}|${l.cost_center_id || ''}`;
  PRS.keyOf = keyOf;
  /** valida una línea (RN-PRS-01/04/11/13) y la guarda (alta o cambio de importe) */
  PRS.setLine = function (version_id, d, { silent } = {}) {
    const v = PRS.version(version_id); if (!v) G.fail('RN-PRS-01', 'La versión no existe.');
    if (!PRS.editable(v)) G.fail('RN-PRS-04', `${PRS.vLabel(v)} está ${(VST[v.status] || [v.status])[0].toLowerCase()}: sus líneas no se modifican. Crea una revisión nueva.`);
    if (!G._seeding && !G.can('prs.budget.edit')) G.fail('RN-PRS-04', 'Editar versiones en borrador requiere prs.budget.edit (Administración).');
    const amount = Number(d.amount);
    if (d.amount === '' || d.amount === null || d.amount === undefined || isNaN(amount)) G.fail('RN-PRS-11', 'El importe debe ser un número en soles sin IGV.');
    if (amount < 0) G.fail('RN-PRS-11', `El importe ${F.money(amount)} es negativo: los importes del presupuesto son en soles, sin IGV y no negativos.`);
    const c = PRS.concept(d.concept_id); if (!c || c.is_group) G.fail('RN-PRS-01', 'Cada línea necesita un concepto de detalle.');
    if (c.status !== 'ACTIVE') G.fail('RN-PRS-01', `El concepto ${c.code} está inactivo.`);
    const year = PRS.yearOfVersion(v); const month = d.month ? G.date.month(d.month) : null;
    if (!month || !PRS.monthsOf(year).includes(month)) G.fail('RN-PRS-01', `El mes debe pertenecer al año presupuestal ${year}.`);
    const dims = { brand_id: d.brand_id || null, establishment_id: d.establishment_id || null, cost_center_id: d.cost_center_id || null };
    if (!dims.brand_id && !dims.establishment_id && !dims.cost_center_id) G.fail('RN-PRS-01', 'Cada línea necesita al menos una dimensión: marca, local o centro de costo.');
    if (dims.brand_id && !G.db.get('brands', dims.brand_id)) G.fail('RN-PRS-01', `La marca ${dims.brand_id} no existe.`);
    if (dims.establishment_id && !G.db.get('establishments', dims.establishment_id)) G.fail('RN-PRS-01', `El local ${dims.establishment_id} no existe.`);
    if (dims.cost_center_id && !G.db.get('cost_centers', dims.cost_center_id)) G.fail('RN-PRS-01', `El centro de costo ${dims.cost_center_id} no existe.`);
    const row = Object.assign({ version_id, concept_id: c.id, month }, dims, { amount: R(amount), note: d.note || null });
    const k = keyOf(row);
    const same = G.db.find('budget_lines', l => l.version_id === version_id && l.month === month && keyOf(l) === k);
    if (d.id) {
      if (same && same.id !== d.id) G.fail('RN-PRS-13', `Ya hay una línea de ${c.name} en ${G.date.monthName(month)} con esas dimensiones (${PRS.dimText(row)}): edita esa.`);
      return G.db.update('budget_lines', d.id, { amount: row.amount, note: row.note, concept_id: row.concept_id, month, ...dims }, { silent: silent || G._seeding });
    }
    if (same) { if (d.strict) G.fail('RN-PRS-13', `Ya hay una línea de ${c.name} en ${G.date.monthName(month)} con esas dimensiones: una sola línea por concepto, mes, marca, local y centro de costo.`); return G.db.update('budget_lines', same.id, { amount: row.amount, note: row.note || same.note }, { silent: silent || G._seeding }); }
    return G.db.insert('budget_lines', row, { silent: silent || G._seeding });
  };
  PRS.updateLineAmount = function (line_id, amount) {
    const l = G.db.get('budget_lines', line_id); if (!l) G.fail('RN-PRS-01', 'La línea no existe.');
    return PRS.setLine(l.version_id, Object.assign({}, l, { amount }));
  };
  PRS.removeSlot = function (version_id, key) {
    const v = PRS.version(version_id);
    if (!PRS.editable(v)) G.fail('RN-PRS-04', `${PRS.vLabel(v)} no está en borrador: no se quitan líneas.`);
    if (!G.can('prs.budget.edit')) G.fail('RN-PRS-04', 'Editar versiones requiere prs.budget.edit.');
    const ls = PRS.linesOf(version_id).filter(l => keyOf(l) === key);
    for (const l of ls) G.db.remove('budget_lines', l.id);
    return ls.length;
  };
  PRS.applyPct = (amount, pct) => R(Number(amount) * (1 + Number(pct || 0) / 100), 2);
  PRS.copyVersion = function (from_id, to_id, pct = 0, { silent, months } = {}) {
    const to = PRS.version(to_id); if (!PRS.editable(to)) G.fail('RN-PRS-04', `${PRS.vLabel(to)} no está en borrador.`);
    const fy = PRS.yearOfVersion(PRS.version(from_id)), ty = PRS.yearOfVersion(to);
    const fm = PRS.monthsOf(fy), tm = PRS.monthsOf(ty);
    for (const l of PRS.linesOf(to_id)) G.db.remove('budget_lines', l.id);
    let n = 0, tot = 0;
    for (const l of PRS.linesOf(from_id)) {
      const i = fm.indexOf(l.month); if (i < 0) continue; if (months && !months.includes(i)) continue;
      const amount = PRS.applyPct(l.amount, pct);
      G.db.insert('budget_lines', { version_id: to_id, concept_id: l.concept_id, month: tm[i], brand_id: l.brand_id, establishment_id: l.establishment_id, cost_center_id: l.cost_center_id, amount, note: l.note }, { silent: true });
      n++; tot += amount;
    }
    if (!silent) G.db.update('budget_versions', to_id, { source: 'COPY_VERSION', adjust_pct: Number(pct) || 0, based_on_version_id: from_id, history: hist(to, `Copiadas ${n} líneas de ${PRS.vLabel(PRS.version(from_id))} con ${pct >= 0 ? '+' : ''}${pct} %`) });
    return { lines: n, total: R(tot) };
  };

  /** propuesta de líneas desde el real del año anterior: cerrados (snapshot), vencidos (real), mes en curso (proyección), futuros (presupuesto aprobado) */
  PRS.actualBasis = function (sourceYear, { asOf = G.TODAY } = {}) {
    const ap = PRS.approvedFor(sourceYear);
    const months = PRS.monthsOf(sourceYear);
    const out = [];
    const ex = PRS.execution(ap ? ap.id : null, months, { asOf, byMonth: true, includeUnbudgeted: true, allConcepts: true });
    for (const s of ex.slots) {
      if (s.concept_id === '__UNMAPPED') continue;
      months.forEach((m, i) => {
        const b = s.months[m] || { budget: 0, actual: 0, forecast: 0 };
        const st = PRS.monthState(m, asOf);
        const base = st === 'FUTURE' ? b.budget : st === 'CURRENT' ? b.forecast : b.actual;
        if (base > 0.004) out.push({ i, month: m, basis: st, concept_id: s.concept_id, brand_id: s.brand_id, establishment_id: s.establishment_id, cost_center_id: s.cost_center_id, amount: R(base) });
      });
    }
    return out;
  };
  PRS.copyFromActual = function (to_id, pct = 0, { asOf = G.TODAY, at, user_id } = {}) {
    const to = PRS.version(to_id); if (!PRS.editable(to)) G.fail('RN-PRS-04', `${PRS.vLabel(to)} no está en borrador: no se copian líneas sobre ella.`);
    if (!G._seeding && !G.can('prs.budget.edit')) G.fail('RN-PRS-04', 'Copiar líneas requiere prs.budget.edit.');
    const ty = PRS.yearOfVersion(to); const tm = PRS.monthsOf(ty);
    const basis = PRS.actualBasis(ty - 1, { asOf });
    for (const l of PRS.linesOf(to_id)) G.db.remove('budget_lines', l.id);
    const agg = {};
    for (const b of basis) { if (!b.brand_id && !b.establishment_id && !b.cost_center_id) continue; const k = keyOf(b) + '|' + b.i; if (!agg[k]) agg[k] = Object.assign({}, b, { amount: 0 }); agg[k].amount += b.amount; }
    let n = 0, tot = 0;
    for (const b of Object.values(agg)) { const amount = R(PRS.applyPct(b.amount, pct), 0); G.db.insert('budget_lines', { version_id: to_id, concept_id: b.concept_id, month: tm[b.i], brand_id: b.brand_id, establishment_id: b.establishment_id, cost_center_id: b.cost_center_id, amount, note: `Real ${ty - 1} (${lbl([['CLOSED', 'cerrado'], ['COMPLETE', 'real'], ['CURRENT', 'proyección'], ['FUTURE', 'presupuesto']], b.basis)}) ${pct >= 0 ? '+' : ''}${pct} %` }, { silent: true }); n++; tot += amount; }
    G.db.update('budget_versions', to_id, { source: 'COPY_ACTUAL', adjust_pct: Number(pct) || 0, history: hist(to, `Copiado el real ${ty - 1} con ${pct >= 0 ? '+' : ''}${pct} % (${n} líneas, ${m0(tot)})`, null, at, user_id) }, { silent: G._seeding });
    return { lines: n, total: R(tot) };
  };

  /** RN-PRS-02: conceptos de costo o gasto usados en la versión sin mapeo */
  PRS.unmappedIn = vid => { const ids = [...new Set(PRS.linesOf(vid).map(l => l.concept_id))]; return ids.map(PRS.concept).filter(c => PRS.needsMapping(c) && !PRS.isMapped(c.id)); };
  PRS.submit = function (vid, { user_id, at, comment } = {}) {
    const v = PRS.version(vid);
    if (!v) G.fail('RN-PRS-01', 'La versión no existe.');
    if (!G._seeding && !G.can('prs.budget.submit')) G.fail('RN-PRS-05', 'Enviar a aprobación requiere prs.budget.submit (Administración).');
    if (!PRS.editable(v)) G.fail('RN-PRS-04', `${PRS.vLabel(v)} ya está ${(VST[v.status] || [v.status])[0].toLowerCase()}.`);
    if (!PRS.linesOf(vid).length) G.fail('RN-PRS-01', `${PRS.vLabel(v)} no tiene líneas.`);
    const un = PRS.unmappedIn(vid);
    if (un.length) G.fail('RN-PRS-02', `Sin mapeo a categorías de gasto o cuentas: ${un.map(c => `${c.code} ${c.name}`).join(', ')}. Mapéalos en PRS-02 para calcular su real; mientras tanto la versión no se envía.`);
    const by = user_id || uid();
    G.db.update('budget_versions', vid, { status: 'SUBMITTED', submitted_by: by, submitted_at: nowOr(at), decision_comment: null, history: hist(v, 'Enviada a aprobación', comment, at, by) }, { silent: G._seeding });
    PRS.notify({ role: 'GERENTE', title: `Presupuesto por aprobar ${PRS.vLabel(v)}`, body: `${G.userName(by)} envió ${PRS.vLabel(v)} (${v.name}).`, ref: { screen: 'PRS-05', id: vid }, tone: 'warn', at });
    return PRS.version(vid);
  };
  PRS.approve = function (vid, { user_id, comment, at } = {}) {
    const v = PRS.version(vid); const by = user_id || uid();
    if (!v) G.fail('RN-PRS-03', 'La versión no existe.');
    if (v.status !== 'SUBMITTED') G.fail('RN-PRS-03', `Solo se aprueba una versión enviada; ${PRS.vLabel(v)} está ${(VST[v.status] || [v.status])[0].toLowerCase()}.`);
    if (by === v.submitted_by || by === v.created_by) G.fail('RN-PRS-05', `${G.userName(by)} ${by === v.submitted_by ? 'envió' : 'elaboró'} ${PRS.vLabel(v)}: la aprueba otra persona (D-PRS-03: solo GERENTE).`);
    const role = (G.db.get('users', by) || {}).role || G.ctx.role;
    if (!G._seeding && !G.can('prs.budget.approve', role)) G.fail('RN-PRS-05', 'Aprobar presupuestos requiere prs.budget.approve (GERENTE, D-PRS-03).');
    const prev = PRS.approved(v.budget_id);
    if (prev && prev.id !== vid) G.db.update('budget_versions', prev.id, { status: 'SUPERSEDED', superseded_at: nowOr(at), superseded_by_version_id: vid, history: hist(prev, `Reemplazada por ${PRS.vLabel(v)}`, null, at, by) }, { silent: G._seeding });
    G.db.update('budget_versions', vid, { status: 'APPROVED', approved_by: by, approved_at: nowOr(at), decision_comment: comment || null, history: hist(v, 'Aprobada · versión vigente', comment, at, by) }, { silent: G._seeding });
    G.db.update('budgets', v.budget_id, { current_version_id: vid }, { silent: G._seeding });
    PRS.notify({ user_id: v.submitted_by, title: `Presupuesto aprobado ${PRS.vLabel(v)}`, body: comment || 'Ya es la versión vigente.', ref: { screen: 'PRS-01' }, tone: 'ok', at });
    return PRS.version(vid);
  };
  PRS.reject = function (vid, { user_id, comment, at } = {}) {
    const v = PRS.version(vid); const by = user_id || uid();
    if (!v || v.status !== 'SUBMITTED') G.fail('RN-PRS-03', 'Solo se rechaza una versión enviada.');
    if (by === v.submitted_by || by === v.created_by) G.fail('RN-PRS-05', 'Quien elabora o envía la versión no la rechaza: decide otra persona.');
    if (!G._seeding && !G.can('prs.budget.approve')) G.fail('RN-PRS-05', 'Rechazar requiere prs.budget.approve.');
    if (!String(comment || '').trim()) G.fail('RN-PRS-05', 'Escribe el motivo del rechazo para que se corrija la versión.');
    G.db.update('budget_versions', vid, { status: 'REJECTED', rejected_by: by, rejected_at: nowOr(at), decision_comment: comment, history: hist(v, 'Rechazada', comment, at, by) }, { silent: G._seeding });
    PRS.notify({ user_id: v.submitted_by, title: `Presupuesto rechazado ${PRS.vLabel(v)}`, body: comment, ref: { screen: 'PRS-03', id: vid }, tone: 'bad', at });
    return PRS.version(vid);
  };
  PRS.notify = function ({ user_id, role, title, body, ref, tone, at }) {
    if (!user_id && !role) return;
    if (!G._seeding && !at) return G.notify({ user_id, role, title, body, ref, tone, module: MOD });
    const targets = user_id ? [user_id] : G.db.where('users', u => u.role === role && u.status !== 'INACTIVE').map(u => u.id);
    for (const t of targets) G.db.insert('notifications', { user_id: t, title, body, ref, tone, module: MOD, read_at: null, at: nowOr(at), created_at: nowOr(at) }, { silent: true });
  };
  /** totales de una versión por tipo de concepto */
  PRS.totals = function (vid, months) {
    const o = { INCOME: 0, COST_OF_SALES: 0, EXPENSE: 0 };
    for (const l of PRS.linesOf(vid)) { if (months && !months.includes(l.month)) continue; o[PRS.typeOf(l.concept_id)] += l.amount; }
    return { income: R(o.INCOME), cost: R(o.COST_OF_SALES), expense: R(o.EXPENSE), spend: R(o.COST_OF_SALES + o.EXPENSE), result: R(o.INCOME - o.COST_OF_SALES - o.EXPENSE) };
  };

  /* ------------------------------------------------------------------
     Real (RN-PRS-06) y snapshots de meses cerrados (RN-PRS-09)
     ------------------------------------------------------------------ */
  const ccVen = brand_id => { const id = 'cc-VEN-' + String(brand_id || '').replace('br-', ''); return G.db.get('cost_centers', id) ? id : null; };
  /** centro de costo por puesto, solo si PER no está (respaldo) */
  PRS.ccForEmployee = function (e) {
    const p = (e.position || '').toLowerCase(); const L = e.establishment_id === 'es-L2' ? 'L2' : 'L1';
    if (/gerent|administr|compras|auditor/.test(p)) return 'cc-ADM'; if (/contad|practicante/.test(p)) return 'cc-FIN'; if (/rr\. ?hh|recursos/.test(p)) return 'cc-RRHH';
    if (/calidad/.test(p)) return 'cc-CAL'; if (/marketing/.test(p)) return 'cc-MKT-DG'; if (/repartidor|delivery/.test(p)) return 'cc-DEL'; if (/cajer/.test(p)) return 'cc-VEN-MOS';
    if (/vended|ventas|visitador/.test(p)) return 'cc-VEN-DG'; if (/almac|prepar/.test(p)) return 'cc-ALM-' + L; return 'cc-PROD-' + L;
  };
  PRS.payrollRows = function (period, { asOf = G.TODAY } = {}) {
    const m = G.date.month(period);
    if (G.per && typeof G.per.costRows === 'function') {
      try { return G.per.costRows(m).map(r => ({ kind: r.kind === 'PAYROLL_EST' ? 'PAYROLL' : r.kind, est: r.kind === 'PAYROLL_EST', employee_id: r.employee_id, cost_center_id: r.cost_center_id, establishment_id: r.establishment_id || (G.db.get('cost_centers', r.cost_center_id) || {}).establishment_id || null, brand_id: r.brand_id || null, amount: r.amount, ref: r.ref || null })); } catch (e) { console.error('PRS: G.per.costRows', e); }
    }
    const st = PRS.monthState(m, asOf); if (st === 'FUTURE') return [];
    const f = st === 'CURRENT' ? PRS.elapsed(m, asOf) / PRS.daysIn(m) : 1;
    return G.db.where('employees', e => e.status === 'ACTIVE' && (!e.hire_date || e.hire_date <= PRS.monthEnd(m)) && e.monthly_salary).map(e => { const cc = PRS.ccForEmployee(e); return { kind: 'PAYROLL', est: true, employee_id: e.id, cost_center_id: cc, establishment_id: (G.db.get('cost_centers', cc) || {}).establishment_id || e.establishment_id, brand_id: (G.db.get('cost_centers', cc) || {}).brand_id || null, amount: R(e.monthly_salary * 1.215 * f) }; });
  };
  /** filas del real vivo de un mes (sin IGV): {concept_id, brand_id, establishment_id, cost_center_id, amount, source, ref_type, ref_id, label, date} */
  PRS.liveRows = function (period, { asOf = G.TODAY } = {}) {
    const m = G.date.month(period), to = PRS.monthEnd(m); const lim = to < asOf ? to : asOf;
    const idx = PRS.mapIndex(); const out = [];
    // ingresos y costo de ventas: comprobantes aceptados − notas de crédito
    for (const d of G.db.where('sales_documents', d => d.issue_date >= m && d.issue_date <= lim && d.sunat_status === 'ACCEPTED' && ['INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(d.doc_type))) {
      const sg = d.doc_type === 'CREDIT_NOTE' ? -1 : 1; const dims = { brand_id: d.brand_id || null, establishment_id: d.establishment_id || null, cost_center_id: ccVen(d.brand_id) };
      const base = { source: 'FAC', ref_type: 'sales_documents', ref_id: d.id, label: `${G.docTypeName ? G.docTypeName(d.doc_type) : d.doc_type} ${d.full_number || ''}`.trim(), detail: d.customer_name || G.custName(d.customer_id), date: d.issue_date };
      out.push(Object.assign({ concept_id: idx.SALES || '__UNMAPPED_INCOME', amount: R(sg * (d.subtotal || 0)) }, dims, base));
      if (d.cost) out.push(Object.assign({ concept_id: idx.COST_OF_SALES || '__UNMAPPED', amount: R(sg * d.cost) }, dims, base, { detail: 'Costo de lo vendido' }));
    }
    // gastos aprobados (GAS, ya repartidos por centro y marca)
    let gas;
    if (G.gas && typeof G.gas.rows === 'function') gas = G.gas.rows({ from: m, to: lim }).map(r => ({ e: r.e, cc: r.cost_center_id, brand: r.brand_id, site: r.establishment_id, net: r.net }));
    else gas = G.db.where('expenses', e => ['APPROVED', 'PAID'].includes(e.status) && e.issue_date >= m && e.issue_date <= lim).map(e => ({ e, cc: e.cost_center_id, brand: e.brand_id, site: e.establishment_id, net: e.net_pen }));
    for (const g of gas) {
      if (!g.net) continue;
      out.push({ concept_id: idx.EXPENSE_CATEGORY[g.e.category_id] || '__UNMAPPED', brand_id: g.brand || null, establishment_id: g.site || null, cost_center_id: g.cc || null, amount: R(g.net), source: 'GAS', ref_type: 'expenses', ref_id: g.e.id, label: g.e.number, detail: g.e.description, date: g.e.issue_date, category_id: g.e.category_id });
    }
    // personal (PER): planilla, comisiones y bonos
    for (const p of PRS.payrollRows(m, { asOf })) {
      out.push({ concept_id: idx.PAYROLL[p.kind] || '__UNMAPPED', brand_id: p.brand_id, establishment_id: p.establishment_id, cost_center_id: p.cost_center_id, amount: R(p.amount), source: p.est ? 'PER_EST' : 'PER', ref_type: 'employees', ref_id: p.employee_id, label: lbl(PAYROLL_KINDS, p.kind) + (p.est ? ' (estimado)' : ''), detail: (G.db.get('employees', p.employee_id) || {}).full_name || p.employee_id, date: lim });
    }
    return out.filter(r => r.amount);
  };
  PRS.runsOf = period => { const m = G.date.month(period); const rs = U.groupBy(G.db.where('budget_actuals', a => a.period === m), 'run_no'); return Object.keys(rs).map(Number).sort((a, b) => a - b).map(n => { const rows = rs[n]; return { run_no: n, run_id: rows[0].run_id, frozen_at: rows[0].frozen_at, frozen_by: rows[0].frozen_by, reason: rows[0].reason, rows, total: R(U.sum(rows, r => r.amount)) }; }); };
  PRS.latestRun = period => { const rs = PRS.runsOf(period); return rs[rs.length - 1] || null; };
  /** RN-PRS-09: mes cerrado → snapshot congelado; si no, real vivo */
  PRS.actualRows = function (period, { asOf = G.TODAY } = {}) {
    const m = G.date.month(period);
    if (PRS.monthState(m, asOf) === 'FUTURE') return [];
    if (G.period.isClosed(m)) { const run = PRS.latestRun(m); if (run) return run.rows.map(a => ({ concept_id: a.concept_id, brand_id: a.brand_id, establishment_id: a.establishment_id, cost_center_id: a.cost_center_id, amount: a.amount, source: 'SNAPSHOT', origin: a.source, ref_type: 'budget_actuals', ref_id: a.id, label: `Corrida ${a.run_no}`, detail: a.reason, date: PRS.monthEnd(m) })); }
    return PRS.liveRows(m, { asOf });
  };
  /** congela el real vivo de un mes en una corrida nueva (nunca edita la anterior) */
  PRS.freeze = function (period, { reason, user_id, at, rows } = {}) {
    const m = G.date.month(period);
    if (!G._seeding && !(G.can('prs.concept.manage') || G.can('prs.budget.approve'))) G.fail('RN-PRS-09', 'Congelar o recalcular el real requiere prs.concept.manage (Contadora o Administración) o GERENTE.');
    const live = rows || PRS.liveRows(m, { asOf: PRS.monthEnd(m) > G.TODAY ? G.TODAY : PRS.monthEnd(m) });
    const agg = {};
    for (const r of live) { const k = keyOf(r) + '|' + (r.source || r.origin || ''); if (!agg[k]) agg[k] = { concept_id: r.concept_id, brand_id: r.brand_id || null, establishment_id: r.establishment_id || null, cost_center_id: r.cost_center_id || null, source: r.origin || r.source, amount: 0 }; agg[k].amount += r.amount; }
    const run_no = (Math.max(0, ...PRS.runsOf(m).map(x => x.run_no)) || 0) + 1;
    const run_id = `bar-${m.slice(0, 7)}-${run_no}`; const by = user_id || uid(); const fa = nowOr(at);
    for (const a of Object.values(agg)) G.db.insert('budget_actuals', Object.assign(a, { period: m, run_id, run_no, amount: R(a.amount), frozen_at: fa, frozen_by: by, reason: reason || 'Cierre del período', created_at: fa }), { silent: true });
    return PRS.latestRun(m);
  };

  /* ------------------------------------------------------------------
     Ejecución: presupuesto vs real por línea (sin doble conteo)
     ------------------------------------------------------------------ */
  const dimsMatch = (s, r) => (!s.brand_id || s.brand_id === r.brand_id) && (!s.establishment_id || s.establishment_id === r.establishment_id) && (!s.cost_center_id || s.cost_center_id === r.cost_center_id);
  const spec = s => (s.brand_id ? 1 : 0) + (s.establishment_id ? 1 : 0) + (s.cost_center_id ? 1 : 0);
  /**
   * PRS.execution(version_id, months, {asOf, withRows, byMonth, includeUnbudgeted})
   * → {slots:[{key, concept_id, type, fixed, brand_id, establishment_id, cost_center_id, budget, actual, forecast, unbudgeted, months:{m:{budget,actual,forecast}}, rows}], unmapped}
   * Cada fila del real se asigna a la línea más específica de su concepto cuyas dimensiones coinciden.
   */
  PRS.execution = function (vid, months, { asOf = G.TODAY, withRows = false, byMonth = true, includeUnbudgeted = true } = {}) {
    const slots = new Map(); const ls = vid ? PRS.linesOf(vid).filter(l => months.includes(l.month)) : [];
    const mk = (src, unb) => { const k = unb ? `${keyOf(src)}|*` : keyOf(src); if (!slots.has(k)) slots.set(k, { key: k, concept_id: src.concept_id, type: PRS.typeOf(src.concept_id), fixed: PRS.isFixed(src.concept_id), brand_id: src.brand_id || null, establishment_id: src.establishment_id || null, cost_center_id: src.cost_center_id || null, budget: 0, actual: 0, forecast: 0, unbudgeted: !!unb, months: {}, rows: [] }); return slots.get(k); };
    const cm = (s, m) => s.months[m] || (s.months[m] = { budget: 0, actual: 0, forecast: 0 });
    for (const l of ls) { const s = mk(l); s.budget += l.amount; cm(s, l.month).budget += l.amount; }
    const byConcept = () => U.groupBy([...slots.values()].filter(s => !s.unbudgeted), 'concept_id');
    let bc = byConcept();
    for (const m of months) {
      if (PRS.monthState(m, asOf) === 'FUTURE') continue;
      for (const r of PRS.actualRows(m, { asOf })) {
        const cands = (bc[r.concept_id] || []).filter(s => dimsMatch(s, r));
        let s = cands.sort((a, b) => spec(b) - spec(a))[0];
        if (!s) { if (!includeUnbudgeted) continue; s = mk(r, true); }
        s.actual += r.amount; cm(s, m).actual += r.amount; if (withRows) s.rows.push(Object.assign({ month: m }, r));
      }
    }
    for (const s of slots.values()) {
      for (const m of months) {
        const st = PRS.monthState(m, asOf); const x = cm(s, m);
        x.forecast = st === 'FUTURE' ? x.budget : st === 'CURRENT' ? PRS.forecastValue({ actual: x.actual, budget: x.budget, elapsed: PRS.elapsed(m, asOf), days: PRS.daysIn(m), fixed: s.fixed }) : x.actual;
        x.budget = R(x.budget); x.actual = R(x.actual); s.forecast += x.forecast;
      }
      s.budget = R(s.budget); s.actual = R(s.actual); s.forecast = R(s.forecast);
      if (!byMonth) s.months = null;
    }
    const all = [...slots.values()];
    return { slots: all.filter(s => !String(s.concept_id).startsWith('__')), unmapped: all.filter(s => String(s.concept_id).startsWith('__')) };
  };
  PRS.dimText = s => ([s.brand_id ? G.brandName(s.brand_id) : null, s.establishment_id ? G.siteName(s.establishment_id) : null, s.cost_center_id ? (G.db.get('cost_centers', s.cost_center_id) || {}).code || s.cost_center_id : null].filter(Boolean).join(' · ') || 'Sin dimensión') + (s.unbudgeted ? ' (sin línea presupuestal)' : '');
  /** agrupa slots por concepto y una dimensión (concept | brand | site | cc) */
  PRS.aggregate = function (slots, dim = 'concept') {
    const field = { brand: 'brand_id', site: 'establishment_id', cc: 'cost_center_id' }[dim];
    const g = {};
    for (const s of slots) {
      const dv = field ? (s[field] || '') : ''; const k = s.concept_id + '|' + dv;
      if (!g[k]) g[k] = { key: k, concept_id: s.concept_id, type: s.type, dim, dim_value: dv || null, budget: 0, actual: 0, forecast: 0, slots: [] };
      const x = g[k]; x.budget += s.budget; x.actual += s.actual; x.forecast += s.forecast; x.slots.push(s);
    }
    return Object.values(g).map(x => { x.budget = R(x.budget); x.actual = R(x.actual); x.forecast = R(x.forecast); x.diff = R(x.actual - x.budget); x.pct = PRS.pct(x.actual, x.budget); x.light = PRS.lightFor(x.budget, x.forecast, x.type); x.fpct = PRS.pct(x.forecast, x.budget); return x; })
      .sort((a, b) => ((PRS.concept(a.concept_id) || {}).sort_order || 999) - ((PRS.concept(b.concept_id) || {}).sort_order || 999) || String(a.dim_value).localeCompare(String(b.dim_value)));
  };
  PRS.dimName = (dim, v) => !v ? ({ brand: 'Sin marca', site: 'Sin local', cc: 'Sin centro' }[dim] || '') : dim === 'brand' ? G.brandName(v) : dim === 'site' ? G.siteName(v) : dim === 'cc' ? G.ccName(v) : '';
  PRS.sumType = (slots, kind) => { const f = kind === 'INCOME' ? s => s.type === 'INCOME' : s => s.type !== 'INCOME'; const xs = slots.filter(f); return { budget: R(U.sum(xs, s => s.budget)), actual: R(U.sum(xs, s => s.actual)), forecast: R(U.sum(xs, s => s.forecast)) }; };

  /* ------------------------------------------------------------------
     Proyección guardada y alertas (RN-PRS-08, RN-PRS-10)
     ------------------------------------------------------------------ */
  PRS.evaluateSlot = function (o) {
    const period = G.date.month(o.period); const asOf = o.asOf || G.TODAY;
    const days = PRS.daysIn(period), elapsed = PRS.elapsed(period, asOf);
    const fixed = o.fixed !== undefined ? o.fixed : PRS.isFixed(o.concept_id);
    const type = o.type || PRS.typeOf(o.concept_id);
    const forecast = o.forecast !== undefined ? o.forecast : PRS.forecastValue({ actual: o.actual, budget: o.budget, elapsed, days, fixed });
    const pct = PRS.pct(forecast, o.budget); const light = PRS.lightFor(o.budget, forecast, type);
    const exceeds = !PRS.isIncome(type) && o.budget > 0 && forecast > o.budget * (1 + alertPct() / 100) + 0.004;
    let alert = null;
    if (exceeds && o.create !== false) alert = PRS.raiseAlert(Object.assign({}, o, { period, forecast, pct, light, elapsed, days, asOf }));
    return { forecast, pct, light, exceeds, elapsed, days, alert };
  };
  PRS.raiseAlert = function (o) {
    const k = keyOf(o);
    const open = G.db.find('budget_alerts', a => a.version_id === o.version_id && a.period === o.period && a.slot_key === k && ['OPEN', 'ACK'].includes(a.status));
    const owner = PRS.ownerOf(o.cost_center_id);
    const data = { budget: R(o.budget), actual: R(o.actual), forecast: R(o.forecast), pct: o.pct, level: o.light === 'AMBER' ? 'AMBER' : 'RED', as_of: o.asOf, days_elapsed: o.elapsed };
    if (open) return G.db.update('budget_alerts', open.id, data, { silent: true });
    const notified = [owner, ...G.db.where('users', u => u.role === 'GERENTE' && u.status !== 'INACTIVE').map(u => u.id)].filter((x, i, a) => x && a.indexOf(x) === i);
    const at = o.at || nowOr();
    const a = G.db.insert('budget_alerts', Object.assign({ version_id: o.version_id, period: o.period, slot_key: k, concept_id: o.concept_id, brand_id: o.brand_id || null, establishment_id: o.establishment_id || null, cost_center_id: o.cost_center_id || null, kind: 'FORECAST', status: 'OPEN', owner_user_id: owner, notified, comments: [], created_at: at, raised_at: at }, data), { silent: true });
    const title = `PRS: ${PRS.cName(o.concept_id)} se proyecta en ${pctTxt(o.pct)}`;
    const body = `${PRS.dimText(o)} · ${G.date.monthName(o.period)}: presupuesto ${m0(o.budget)}, real ${m0(o.actual)} al día ${o.elapsed}, proyección ${m0(o.forecast)} (RN-PRS-10).`;
    for (const u of notified) PRS.notify({ user_id: u, title, body, ref: { screen: 'PRS-10', id: a.id }, tone: 'bad', at: o.at });
    if (!G._seeding) G.events.emit('control_alert.raised', { module: MOD, alert_id: a.id, concept: PRS.cCode(o.concept_id), pct: o.pct });
    return a;
  };
  /** evalúa todas las líneas de gasto del mes y genera o actualiza alertas; resuelve las que ya no exceden */
  PRS.runAlerts = function (vid, period, { asOf = G.TODAY, at } = {}) {
    const m = G.date.month(period); const ex = PRS.execution(vid, [m], { asOf, includeUnbudgeted: false });
    const raised = []; const keys = new Set();
    for (const s of ex.slots) {
      if (PRS.isIncome(s.type) || !(s.budget > 0)) continue;
      const r = PRS.evaluateSlot({ version_id: vid, period: m, concept_id: s.concept_id, brand_id: s.brand_id, establishment_id: s.establishment_id, cost_center_id: s.cost_center_id, budget: s.budget, actual: s.actual, forecast: s.forecast, type: s.type, fixed: s.fixed, asOf, at });
      if (r.alert) { raised.push(r.alert); keys.add(r.alert.slot_key); }
    }
    for (const a of G.db.where('budget_alerts', a => a.version_id === vid && a.period === m && a.status === 'OPEN' && !keys.has(a.slot_key))) G.db.update('budget_alerts', a.id, { status: 'RESOLVED', comments: (a.comments || []).concat([{ at: nowOr(at), user: 'Sistema', text: `La proyección volvió a estar dentro del ${alertPct()} % (RN-PRS-10).` }]) }, { silent: true });
    return raised;
  };
  PRS.commentAlert = function (id, text, { status, at, user_id } = {}) {
    const a = G.db.get('budget_alerts', id); if (!a) G.fail('RN-PRS-10', 'La alerta no existe.');
    if (!String(text || '').trim()) G.fail('RN-PRS-10', 'Escribe el comentario o la acción tomada.');
    const by = user_id || uid();
    return G.db.update('budget_alerts', id, { comments: (a.comments || []).concat([{ at: nowOr(at), user: G.userName(by), text: String(text).trim() }]), status: status || a.status, closed_at: status === 'CLOSED' ? nowOr(at) : a.closed_at || null }, { silent: G._seeding });
  };
  PRS.saveForecast = function (vid, period, { asOf = G.TODAY, at } = {}) {
    const m = G.date.month(period); const ex = PRS.execution(vid, [m], { asOf, includeUnbudgeted: true });
    const run = `bf-${m.slice(0, 7)}-${asOf}-${G.db.where('budget_forecasts', f => f.period === m).length}`;
    const el = PRS.elapsed(m, asOf), days = PRS.daysIn(m);
    for (const s of ex.slots) G.db.insert('budget_forecasts', { version_id: vid, run_id: run, period: m, as_of: asOf, concept_id: s.concept_id, brand_id: s.brand_id, establishment_id: s.establishment_id, cost_center_id: s.cost_center_id, actual_to_date: s.actual, days_elapsed: el, days_in_month: days, budget: s.budget, forecast: s.forecast, pct: PRS.pct(s.forecast, s.budget), method: s.fixed ? 'FIXED_BUDGET' : method(), created_at: nowOr(at) }, { silent: true });
    return { run_id: run, count: ex.slots.length };
  };

  /* ------------------------------------------------------------------
     Importación (PRS-04)
     ------------------------------------------------------------------ */
  const parseNum = s => { let t = String(s ?? '').replace(/S\/|\s| /g, ''); if (!t) return NaN; if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''); else if (t.includes(',')) t = /,\d{1,2}$/.test(t) ? t.replace(',', '.') : t.replace(/,/g, ''); return Number(t); };
  PRS.parseNum = parseNum;
  /** texto pegado de Excel (tabulado, ; o ,): concepto, mes, marca, local, centro de costo, importe */
  PRS.parseImport = function (vid, text) {
    const v = PRS.version(vid); const year = PRS.yearOfVersion(v); const months = PRS.monthsOf(year);
    const lines = String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const ok = [], errors = [], seen = new Set();
    lines.forEach((ln, i) => {
      const sep = ln.includes('\t') ? '\t' : ln.includes(';') ? ';' : ',';
      const c = ln.split(sep).map(x => x.trim());
      if (i === 0 && /concepto/i.test(c[0])) return;
      const n = i + 1; const err = (code, msg) => errors.push({ row: n, code, msg, raw: ln });
      const concept = G.db.find('budget_concepts', x => x.code === String(c[0] || '').toUpperCase());
      if (!concept || concept.is_group) return err('RN-PRS-01', `El concepto «${c[0] || ''}» no existe o es un grupo.`);
      let mm = String(c[1] || ''); let month = /^\d{1,2}$/.test(mm) ? months.find(m => Number(m.slice(5, 7)) === Number(mm)) : /^\d{4}-\d{2}/.test(mm) ? G.date.month(mm) : null;
      if (!month || !months.includes(month)) return err('RN-PRS-01', `El mes «${mm}» no pertenece al año ${year}.`);
      const brand = c[2] ? G.db.find('brands', b => b.code === c[2].toUpperCase() || b.id === c[2] || b.id === 'br-' + c[2].toUpperCase()) : null;
      if (c[2] && !brand) return err('RN-PRS-01', `La marca «${c[2]}» no existe.`);
      const site = c[3] ? G.db.find('establishments', e => e.code === c[3].toUpperCase() || e.id === c[3] || e.id === 'es-' + c[3].toUpperCase()) : null;
      if (c[3] && !site) return err('RN-PRS-01', `El local «${c[3]}» no existe.`);
      const cc = c[4] ? G.db.find('cost_centers', x => x.code === c[4].toUpperCase() || x.id === c[4] || x.id === 'cc-' + c[4].toUpperCase()) : null;
      if (c[4] && !cc) return err('RN-PRS-01', `El centro de costo «${c[4]}» no existe.`);
      if (!brand && !site && !cc) return err('RN-PRS-01', 'Falta al menos una dimensión: marca, local o centro de costo.');
      const amount = parseNum(c[5]);
      if (isNaN(amount)) return err('RN-PRS-11', `El importe «${c[5] || ''}» no es un número.`);
      if (amount < 0) return err('RN-PRS-11', `El importe ${F.money(amount)} es negativo.`);
      const row = { concept_id: concept.id, month, brand_id: brand ? brand.id : null, establishment_id: site ? site.id : null, cost_center_id: cc ? cc.id : null, amount: R(amount) };
      const k = keyOf(row) + '|' + month; if (seen.has(k)) return err('RN-PRS-13', `Repite ${concept.code} ${G.date.monthName(month)} ${PRS.dimText(row)}: una sola línea por concepto, mes y dimensiones.`);
      seen.add(k);
      row.warn = PRS.needsMapping(concept) && !PRS.isMapped(concept.id) ? 'RN-PRS-02: el concepto no tiene mapeo; la versión no se podrá enviar hasta mapearlo.' : null;
      row.replaces = G.db.find('budget_lines', l => l.version_id === vid && l.month === month && keyOf(l) === keyOf(row)) ? true : false;
      ok.push(row);
    });
    return { ok, errors };
  };
  PRS.applyImport = function (vid, rows) {
    const v = PRS.version(vid); if (!PRS.editable(v)) G.fail('RN-PRS-04', `${PRS.vLabel(v)} no está en borrador.`);
    let n = 0; for (const r of rows) { PRS.setLine(vid, r, { silent: true }); n++; }
    G.db.update('budget_versions', vid, { source: v.source === 'MANUAL' ? 'IMPORT' : v.source, history: hist(v, `Importadas ${n} líneas desde Excel`) });
    return n;
  };

  /* ------------------------------------------------------------------
     Indicadores (TAB)
     ------------------------------------------------------------------ */
  const kpiExec = p => {
    const from = G.date.month(p.from || G.TODAY), to = p.to || G.TODAY;
    const ap = PRS.approvedFor(PRS.yearOf(from)); if (!ap) return null;
    const months = PRS.monthsOf(PRS.yearOf(from)).filter(m => m >= from && m <= to);
    const ex = PRS.execution(ap.id, months, { asOf: G.TODAY });
    const slots = ex.slots.filter(s => (!p.brand || s.brand_id === p.brand) && (!p.site || s.establishment_id === p.site));
    // presupuesto a la fecha: el mes en curso se prorratea por días (el real va al día)
    const pr = s => U.sum(months, m => { const x = s.months[m] || { budget: 0 }; return PRS.monthState(m) === 'CURRENT' ? x.budget * PRS.elapsed(m) / PRS.daysIn(m) : x.budget; });
    const inc = slots.filter(s => s.type === 'INCOME'), exp = slots.filter(s => s.type !== 'INCOME');
    return { inc: { b: R(U.sum(inc, pr)), a: R(U.sum(inc, s => s.actual)) }, exp: { b: R(U.sum(exp, pr)), a: R(U.sum(exp, s => s.actual)) }, slots, months };
  };
  G.kpiCalc['KPI-PRS-01'] = p => { const k = kpiExec(p); if (!k) return null; return { value: PRS.pct(k.exp.a, k.exp.b) ?? 0, numerator: k.exp.a, denominator: k.exp.b }; };
  G.kpiCalc['KPI-PRS-02'] = p => { const k = kpiExec(p); if (!k) return null; return { value: PRS.pct(k.inc.a, k.inc.b) ?? 0, numerator: k.inc.a, denominator: k.inc.b }; };
  G.kpiCalc['KPI-PRS-03'] = p => { const k = kpiExec(p); if (!k) return null; return { value: R(k.exp.a - k.exp.b), numerator: k.exp.a, denominator: k.exp.b }; };
  const monthEval = (p) => { const m = G.date.month(p.to || G.TODAY); const ap = PRS.approvedFor(PRS.yearOf(m)); if (!ap) return null; const ex = PRS.execution(ap.id, [m]); return ex.slots.filter(s => (!p.brand || s.brand_id === p.brand) && (!p.site || s.establishment_id === p.site)); };
  G.kpiCalc['KPI-PRS-04'] = p => { const s = monthEval(p); if (!s) return null; const e = PRS.sumType(s, 'EXPENSE'); return { value: PRS.pct(e.forecast, e.budget) ?? 0, numerator: e.forecast, denominator: e.budget }; };
  G.kpiCalc['KPI-PRS-05'] = p => { const s = monthEval(p); if (!s) return null; return PRS.aggregate(s, 'concept').filter(x => x.light === 'RED').length; };

  /* ------------------------------------------------------------------
     Alertas, búsqueda y escaneo globales
     ------------------------------------------------------------------ */
  G.alertProviders.push(() => {
    const out = [];
    const open = G.db.where('budget_alerts', a => a.status === 'OPEN');
    if (open.length) out.push({ module: MOD, title: `${open.length} conceptos del presupuesto se proyectan por encima (+${alertPct()} %)`, detail: open.slice(0, 3).map(a => `${PRS.cName(a.concept_id)} ${pctTxt(a.pct)}`).join(' · '), tone: 'bad', go: () => G.go('PRS-10') });
    const sub = G.db.where('budget_versions', v => v.status === 'SUBMITTED');
    if (sub.length && G.can('prs.budget.approve')) out.push({ module: MOD, title: `${sub.length} versión(es) de presupuesto por aprobar`, detail: sub.map(PRS.vLabel).join(', ') + ' · RN-PRS-05', tone: 'warn', go: () => G.go('PRS-05', { id: sub[0].id }) });
    return out;
  });
  G.searchProviders.push(q => {
    const s = q.toLowerCase(); const out = [];
    for (const v of G.db.all('budget_versions')) { const t = `${PRS.vCode(v)} ${PRS.vLabel(v)} presupuesto ${v.name}`.toLowerCase(); if (t.includes(s)) out.push({ label: `Presupuesto ${PRS.vLabel(v)}`, sub: `${v.name} · ${(VST[v.status] || [v.status])[0]}`, go: () => G.go('PRS-03', { id: v.id }) }); }
    for (const c of PRS.leaves()) if (c.name.toLowerCase().includes(s) || c.code.toLowerCase().includes(s)) out.push({ label: `Concepto ${c.code} · ${c.name}`, sub: 'Presupuesto · real frente a presupuesto', go: () => G.go('PRS-07', { concept: c.id }) });
    return out.slice(0, 6);
  });
  G.scanHandlers.push(code => { const v = G.db.all('budget_versions').find(x => PRS.vCode(x) === code); return v ? () => G.go('PRS-03', { id: v.id }) : null; });
  G.events.on('period.closed', p => { try { if (p && p.period && !PRS.latestRun(p.period)) PRS.freeze(p.period, { reason: `Cierre del período ${G.date.monthName(p.period)} (period.closed)` }); } catch (e) { console.error('PRS snapshot', e); } });

  /* ------------------------------------------------------------------
     Interfaz: estado y utilidades de pantalla
     ------------------------------------------------------------------ */
  const ui = PRS._ui = PRS._ui || {};
  const curYear = () => PRS.yearOf(G.TODAY);
  const tryDo = (fn, ok) => { try { const r = fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); if (!(e instanceof G.RuleError)) console.error(e); return null; } };
  const versionOpts = (pred = () => true) => G.db.all('budget_versions').filter(pred).sort((a, b) => (PRS.yearOfVersion(b) - PRS.yearOfVersion(a)) || (b.version_no - a.version_no)).map(v => [v.id, `${PRS.vLabel(v)} · ${(VST[v.status] || [v.status])[0]} · ${v.name}`]);
  const sel = (opts, value, onChange, label, extra = {}) => { const s = h('select', { class: 'input', attrs: { 'aria-label': label }, style: extra.style || 'width:100%;max-width:100%;min-width:0' }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, l))); s.addEventListener('change', () => onChange(s.value)); return extra.wrap === false ? s : h('label', { class: 'stack', style: 'gap:2px;min-width:0' }, h('span', { class: 'small muted' }, label), s); };
  const brandOpts = () => [['', 'Todas las marcas'], ...G.scope.brands().map(b => [b.id, b.name])];
  const siteOpts = () => [['', 'Todos los locales'], ...G.scope.sites().map(e => [e.id, e.name])];
  const ccOpts = () => [['', 'Todos los centros'], ...G.db.all('cost_centers').map(c => [c.id, `${c.code} · ${c.name}`])];
  const leafOpts = () => PRS.leaves().map(c => [c.id, `${c.code} · ${c.name}`]);
  const typeBadge = t => badge(lbl(TYPES, t), t === 'INCOME' ? 'ok' : t === 'COST_OF_SALES' ? 'info' : '');
  const lightCell = (l, pct) => h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, lBadge(l), pct !== undefined ? h('span', { class: 'small muted num' }, pctTxt(pct)) : null);
  const scopeNote = () => PRS.canViewAll() ? null : notice(`RN-PRS-12: tu rol ve solo las líneas de los centros de costo a tu cargo y de tus marcas.`, 'info');
  const decisionNote = () => h('div', { class: 'small muted' }, 'D-PRS-01: por área y local, marca opcional · D-PRS-02: sin flujo de caja en esta fase · D-PRS-03: aprueba solo GERENTE (valores provisionales).');
  function timeline(items) { return h('div', { class: 'timeline' }, (items || []).slice().reverse().map(x => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.datetime(x.at)), h('span', { class: 'dot' }), h('div', null, h('b', null, x.action || x.text), h('div', { class: 'small muted' }, [x.user, x.note].filter(Boolean).join(' · '))))));}

  /* ---------- ficha de la versión (drawer) ---------- */
  PRS.openVersion = function (vid) {
    const v = PRS.version(vid); if (!v) return;
    drawer(`Presupuesto ${PRS.vLabel(v)}`, (b, close) => {
      const t = PRS.totals(vid); const ls = PRS.linesOf(vid);
      b.append(h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, vBadge(v.status), badge(PRS.vCode(v), 'primary'), v.adjust_pct ? badge(`Ajuste ${v.adjust_pct > 0 ? '+' : ''}${v.adjust_pct} %`, 'info') : null));
      b.append(dl([['Nombre', v.name], ['Origen', { MANUAL: 'Manual', COPY_VERSION: 'Copia de versión', COPY_ACTUAL: 'Copia del real del año anterior', IMPORT: 'Importada de Excel' }[v.source] || v.source], ['Basada en', v.based_on_version_id ? PRS.vLabel(PRS.version(v.based_on_version_id)) : '—'], ['Elaboró', `${G.userName(v.created_by)} · ${F.datetime(v.created_at)}`], ['Envió', v.submitted_by ? `${G.userName(v.submitted_by)} · ${F.datetime(v.submitted_at)}` : '—'], ['Decidió', v.approved_by ? `${G.userName(v.approved_by)} · ${F.datetime(v.approved_at)}` : v.rejected_by ? `${G.userName(v.rejected_by)} · ${F.datetime(v.rejected_at)}` : '—'], ['Comentario', v.decision_comment || '—'], ['Líneas', F.num(ls.length)], ['Ingresos', m0(t.income)], ['Costo de ventas', m0(t.cost)], ['Gastos', m0(t.expense)], ['Resultado', m0(t.result)]]));
      const acts = [btn('Abrir matriz', () => { close(); G.go('PRS-03', { id: vid }); }, { kind: 'primary', sm: true }), btn('Comparar', () => { close(); G.go('PRS-09', { b: vid }); }, { sm: true })];
      if (G.can('prs.budget.edit')) acts.push(btn('Crear revisión', () => { const nv = tryDo(() => PRS.newVersion(v.budget_id, { from_version_id: vid }), r => `Revisión ${PRS.vLabel(r)} creada en borrador`); if (nv) { close(); G.go('PRS-03', { id: nv.id }); } }, { sm: true }));
      if (['DRAFT', 'REJECTED', 'SUBMITTED'].includes(v.status)) acts.push(btn('Envío y aprobación', () => { close(); G.go('PRS-05', { id: vid }); }, { sm: true }));
      b.append(h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, acts));
      b.append(card('Historial', timeline(v.history)));
    }, { code: PRS.vCode(v) });
  };

  /* ---------- PRS-01 Presupuestos ---------- */
  function newBudgetDialog() {
    if (!G.can('prs.budget.edit')) return toast('Crear presupuestos requiere prs.budget.edit (Administración).', 'warn');
    drawer('Nuevo presupuesto anual', (b, close) => {
      const y = Math.max(curYear() + 1, ...G.db.all('budgets').map(x => Number(x.year) + 1));
      b.append(notice('RN-PRS-01: un presupuesto por empresa y año. Empieza vacío, o cópialo desde una versión o desde el real del año anterior (PRS-04).', 'info'));
      b.append(form({ id: 'prs-new', fields: [{ key: 'year', label: 'Año', type: 'number', required: true, min: 2020, max: 2100 }, { key: 'name', label: 'Nombre', required: true }, { key: 'start', label: 'Contenido inicial', type: 'select', required: true, options: [['EMPTY', 'Vacío'], ['ACTUAL', 'Real del año anterior con ajuste %'], ['VERSION', 'Copia de la versión vigente del año anterior']] }, { key: 'pct', label: 'Ajuste %', type: 'number', help: 'Ej.: 8 sube cada línea 8 %.' }],
        values: { year: y, name: `Presupuesto ${y}`, start: 'ACTUAL', pct: 8 }, submitLabel: 'Crear presupuesto', onCancel: close,
        onSubmit: vals => { try { const bud = PRS.createBudget(vals.year, { name: vals.name }); const v = PRS.versionsOf(bud.id)[0]; if (vals.start === 'ACTUAL') PRS.copyFromActual(v.id, Number(vals.pct) || 0); if (vals.start === 'VERSION') { const ap = PRS.approvedFor(Number(vals.year) - 1); if (ap) PRS.copyVersion(ap.id, v.id, Number(vals.pct) || 0); } toast(`Presupuesto ${vals.year} creado en borrador`, 'ok'); close(); G.go('PRS-03', { id: v.id }); return true; } catch (e) { return e.message; } } }));
    });
  }
  function scr01(el) {
    const body = page(el, { code: 'PRS-01', title: 'Presupuestos', sub: 'Presupuesto anual de la empresa: versión vigente, versiones en trámite y totales de ingreso, costo y gasto (sin IGV).', actions: [{ label: 'Nuevo presupuesto', kind: 'primary', onClick: newBudgetDialog, disabled: !G.can('prs.budget.edit') }, { label: 'Real frente a presupuesto', onClick: () => G.go('PRS-06') }] });
    const y = curYear(); const ap = PRS.approvedFor(y); const t = ap ? PRS.totals(ap.id) : null;
    const pend = G.db.where('budget_versions', v => v.status === 'SUBMITTED');
    const k1 = G.kpi('KPI-PRS-01', { from: `${y}-01-01`, to: G.TODAY }), k2 = G.kpi('KPI-PRS-02', { from: `${y}-01-01`, to: G.TODAY });
    body.append(kpis([
      { label: `Versión vigente ${y}`, value: ap ? `v${ap.version_no}` : 'Sin aprobar', sub: ap ? `Aprobada ${F.date(ap.approved_at)} por ${G.userShort ? G.userShort(ap.approved_by) : G.userName(ap.approved_by)}` : 'RN-PRS-03', tone: ap ? 'ok' : 'bad', onClick: ap ? () => PRS.openVersion(ap.id) : null },
      { label: `Ingresos presupuestados ${y}`, value: t ? m0(t.income) : '—', sub: 'Ventas sin IGV' },
      { label: 'Costo + gasto presupuestado', value: t ? m0(t.spend) : '—', sub: t ? `Resultado ${m0(t.result)}` : '' },
      { label: 'Ejecución del gasto (año)', value: k1 && k1.value !== null ? pctTxt(k1.value) : '—', sub: k1 ? `${m0(k1.numerator)} de ${m0(k1.denominator)} a la fecha` : '', tone: k1 ? (PRS.light(k1.value, 'EXPENSE') === 'GREEN' ? 'ok' : PRS.light(k1.value, 'EXPENSE') === 'AMBER' ? 'warn' : 'bad') : '' },
      { label: 'Cumplimiento de ingresos (año)', value: k2 && k2.value !== null ? pctTxt(k2.value) : '—', sub: 'KPI-PRS-02', tone: k2 ? ({ GREEN: 'ok', AMBER: 'warn', RED: 'bad' }[PRS.light(k2.value, 'INCOME')] || '') : '' },
      { label: 'Versiones por aprobar', value: pend.length, tone: pend.length ? 'warn' : 'ok', onClick: () => G.go('PRS-05') },
    ]));
    const co = G.db.get('companies', 'co-dg') || {};
    const rows = G.db.all('budgets').sort(U.by('year', -1)).map(b => { const vs = PRS.versionsOf(b.id); const cur = PRS.approved(b.id); const last = vs[vs.length - 1]; const shown = cur || last; return Object.assign({}, b, { vs, cur, last, t: shown ? PRS.totals(shown.id) : { income: 0, cost: 0, expense: 0, result: 0 } }); });
    body.append(table({ id: 'prs01', columns: [
      { key: 'year', label: 'Año', mono: true }, { key: 'co', label: 'Empresa', value: () => co.legal_name || 'Don Guando' },
      { key: 'cur', label: 'Versión vigente', render: r => r.cur ? h('span', null, `v${r.cur.version_no} `, vBadge('APPROVED')) : h('span', null, badge('Sin versión aprobada', 'warn')) },
      { key: 'last', label: 'Última versión', render: r => r.last ? h('span', null, `v${r.last.version_no} `, vBadge(r.last.status)) : '—' },
      { key: 'n', label: 'Versiones', align: 'r', value: r => r.vs.length },
      { key: 'inc', label: 'Ingresos', align: 'r', value: r => r.t.income, render: r => m0(r.t.income) },
      { key: 'cos', label: 'Costo de ventas', align: 'r', value: r => r.t.cost, render: r => m0(r.t.cost) },
      { key: 'exp', label: 'Gastos', align: 'r', value: r => r.t.expense, render: r => m0(r.t.expense) },
      { key: 'res', label: 'Resultado', align: 'r', value: r => r.t.result, render: r => h('b', { style: { color: r.t.result < 0 ? 'var(--bad)' : '' } }, m0(r.t.result)) }],
      rows, onRow: r => openBudget(r.id), search: false, empty: 'Aún no hay presupuestos: crea el del año.' }));
    if (ap) {
      const months = PRS.monthsOf(y); const ls = U.groupBy(PRS.linesOf(ap.id), 'month');
      const inc = months.map(m => R(U.sum((ls[m] || []).filter(l => PRS.typeOf(l.concept_id) === 'INCOME'), l => l.amount)));
      const exp = months.map(m => R(U.sum((ls[m] || []).filter(l => PRS.typeOf(l.concept_id) !== 'INCOME'), l => l.amount)));
      body.append(card(`Presupuesto vigente ${PRS.vLabel(ap)} por mes`, G.ui.chart.bar({ labels: months.map(G.date.monthName), series: [{ name: 'Ingresos', values: inc }, { name: 'Costo + gasto', values: exp }], format: m0 })));
    }
    body.append(decisionNote());
  }
  function openBudget(bid) {
    const b = G.db.get('budgets', bid);
    drawer(`${b.name}`, (body, close) => {
      body.append(dl([['Empresa', (G.db.get('companies', b.company_id) || {}).legal_name], ['Año', b.year], ['Meses', `${G.date.monthName(PRS.monthsOf(b.year)[0])} – ${G.date.monthName(PRS.monthsOf(b.year)[11])} (prs_fiscal_year_start_month = ${startMonth()})`], ['Vigente', PRS.approved(bid) ? PRS.vLabel(PRS.approved(bid)) : 'Ninguna']]));
      body.append(table({ id: 'prs01v', search: false, columns: [{ key: 'version_no', label: 'Versión', render: v => `v${v.version_no}` }, { key: 'name', label: 'Nombre' }, { key: 'status', label: 'Estado', render: v => vBadge(v.status) }, { key: 'created_by', label: 'Elaboró', value: v => G.userName(v.created_by) }, { key: 'tot', label: 'Gasto + costo', align: 'r', render: v => m0(PRS.totals(v.id).spend) }, { key: 'inc', label: 'Ingresos', align: 'r', render: v => m0(PRS.totals(v.id).income) }],
        rows: PRS.versionsOf(bid).slice().reverse(), onRow: v => { close(); PRS.openVersion(v.id); } }));
      const ap = PRS.approved(bid);
      if (G.can('prs.budget.edit')) body.append(h('div', { class: 'row', style: 'gap:8px' }, btn('Nueva revisión de la vigente', () => { if (!ap) return toast('RN-PRS-03: no hay versión aprobada para revisar.', 'warn'); const nv = tryDo(() => PRS.newVersion(bid, { from_version_id: ap.id }), r => `Revisión ${PRS.vLabel(r)} creada`); if (nv) { close(); G.go('PRS-03', { id: nv.id }); } }, { kind: 'primary', sm: true }), btn('Versión vacía', () => { const nv = tryDo(() => PRS.newVersion(bid, {}), r => `Versión ${PRS.vLabel(r)} creada`); if (nv) { close(); G.go('PRS-04', { id: nv.id }); } }, { sm: true })));
    }, { code: `PRS-${b.year}` });
  }

  /* ---------- PRS-02 Conceptos ---------- */
  function scr02(el) {
    const can = G.can('prs.concept.manage');
    const body = page(el, { code: 'PRS-02', title: 'Conceptos presupuestales', sub: 'Árbol de conceptos con su tipo, si es fijo o variable y de dónde sale su real (categorías de gasto, personal, ventas o cuentas contables).', actions: [{ label: 'Nuevo concepto', kind: 'primary', disabled: !can, onClick: () => conceptDrawer(null) }] });
    const cs = PRS.concepts(); const leaves = cs.filter(c => !c.is_group);
    const unm = leaves.filter(c => c.status === 'ACTIVE' && PRS.needsMapping(c) && !PRS.isMapped(c.id));
    const idx = PRS.mapIndex();
    const cats = G.db.where('expense_categories', c => c.status === 'ACTIVE');
    const freeCats = cats.filter(c => !idx.EXPENSE_CATEGORY[c.id]);
    const ap = PRS.approvedFor(curYear()); const used = ap ? U.groupBy(PRS.linesOf(ap.id), 'concept_id') : {};
    body.append(kpis([{ label: 'Conceptos de detalle', value: leaves.filter(c => c.status === 'ACTIVE').length, sub: `${cs.filter(c => c.is_group).length} grupos` }, { label: 'Sin mapeo (RN-PRS-02)', value: unm.length, tone: unm.length ? 'bad' : 'ok', sub: unm.map(c => c.code).join(', ') }, { label: 'Categorías de gasto sin concepto', value: freeCats.length, tone: freeCats.length ? 'warn' : 'ok', sub: freeCats.length ? 'Su gasto queda fuera del real' : 'Todo el gasto de GAS entra' }, { label: 'Fijos', value: leaves.filter(c => c.behavior === 'FIXED').length, sub: 'Proyectan con su presupuesto (RN-PRS-08)' }]));
    if (unm.length) body.append(notice(h('span', null, h('b', null, 'RN-PRS-02: '), `${unm.map(c => `${c.code} ${c.name}`).join(', ')} no tiene(n) mapeo: su real sería cero y ninguna versión que los use se puede enviar.`), 'bad'));
    if (freeCats.length) body.append(notice(`Categorías de GAS sin concepto: ${freeCats.map(c => c.name).join(', ')}. Su gasto aparece como «Sin concepto» en PRS-06.`, 'warn'));
    body.append(table({ id: 'prs02', pageSize: 50, columns: [
      { key: 'code', label: 'Código', mono: true, render: c => h('span', { style: { paddingLeft: c.parent_id ? '14px' : '0', fontWeight: c.is_group ? 700 : 400, whiteSpace: 'nowrap' } }, c.code) },
      { key: 'name', label: 'Concepto', render: c => h('span', { style: { fontWeight: c.is_group ? 700 : 400 } }, c.name) },
      { key: 'concept_type', label: 'Tipo', render: c => typeBadge(c.concept_type), value: c => lbl(TYPES, c.concept_type) },
      { key: 'behavior', label: 'Fijo/variable', value: c => c.is_group ? '' : lbl(BEHAVIORS, c.behavior) },
      { key: 'map', label: 'Mapeo del real', sort: false, value: c => PRS.mappingsOf(c.id).map(PRS.mapLabel).join(' · '), render: c => c.is_group ? '' : PRS.mappingsOf(c.id).length ? h('div', { class: 'stack', style: 'gap:2px' }, PRS.mappingsOf(c.id).slice(0, 3).map(m => h('span', { class: 'small' }, PRS.mapLabel(m))), PRS.mappingsOf(c.id).length > 3 ? h('span', { class: 'small muted' }, `+${PRS.mappingsOf(c.id).length - 3} más`) : null) : (PRS.needsMapping(c) ? badge('Sin mapeo · RN-PRS-02', 'bad') : badge('Ingreso sin mapeo', 'warn')) },
      { key: 'lines', label: `Líneas ${ap ? PRS.vLabel(ap) : ''}`, align: 'r', value: c => (used[c.id] || []).length, render: c => c.is_group ? '' : F.num((used[c.id] || []).length) },
      { key: 'status', label: 'Estado', render: c => G.ui.status(c.status) }],
      rows: cs, onRow: c => conceptDrawer(c.id), filters: [{ key: 'concept_type', label: 'Tipo', options: TYPES }, { key: 'behavior', label: 'Comportamiento', options: BEHAVIORS }] }));
  }
  function conceptDrawer(id) {
    const c = id ? PRS.concept(id) : null; const can = G.can('prs.concept.manage');
    drawer(c ? `${c.code} · ${c.name}` : 'Nuevo concepto', (b, close) => {
      if (!can) b.append(notice('Solo consulta: los conceptos y su mapeo los gestionan Administración y la Contadora (prs.concept.manage).', 'info'));
      b.append(form({ id: 'prs-c', fields: [
        { key: 'code', label: 'Código', required: true, disabled: !can }, { key: 'name', label: 'Nombre', required: true, disabled: !can },
        { key: 'parent_id', label: 'Grupo', type: 'select', options: PRS.concepts().filter(x => x.is_group && x.id !== id).map(x => [x.id, `${x.code} · ${x.name}`]), disabled: !can, help: 'Hereda el tipo del grupo.' },
        { key: 'is_group', label: 'Es grupo (no lleva líneas)', type: 'checkbox', disabled: !can || !!(c && c.parent_id) },
        { key: 'concept_type', label: 'Tipo (si es grupo raíz)', type: 'select', options: TYPES, disabled: !can },
        { key: 'behavior', label: 'Comportamiento', type: 'select', options: BEHAVIORS, disabled: !can, help: 'Fijo: la proyección de cierre usa el presupuesto (RN-PRS-08).' },
        { key: 'default_cost_center_id', label: 'Centro de costo sugerido', type: 'select', options: G.db.all('cost_centers').map(x => [x.id, `${x.code} · ${x.name}`]), disabled: !can },
        { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']], required: true, disabled: !can }],
        values: c ? Object.assign({}, c) : { status: 'ACTIVE', behavior: 'VARIABLE', concept_type: 'EXPENSE' }, submitLabel: can ? 'Guardar concepto' : false, onCancel: close,
        onSubmit: vals => { try { const r = PRS.saveConcept(vals, id); toast('Concepto guardado', 'ok'); close(); G.refresh(); if (!id) setTimeout(() => conceptDrawer(r.id), 20); return true; } catch (e) { return e.message; } } }));
      if (c && !c.is_group) {
        const ms = PRS.mappingsOf(c.id);
        b.append(card('Mapeo del real (RN-PRS-02, RN-PRS-06)', h('div', { class: 'stack' },
          ms.length ? h('div', { class: 'stack', style: 'gap:6px' }, ms.map(m => h('div', { class: 'row between' }, h('span', null, PRS.mapLabel(m), m.source === 'ACCOUNT' && !G.cnt ? h('span', { class: 'small muted' }, ' · CNT no está activo en este entorno: real 0') : null), can ? btn('Quitar', () => { tryDo(() => PRS.removeMapping(m.id), 'Mapeo quitado'); close(); conceptDrawer(c.id); }, { sm: true, kind: 'ghost' }) : null))) : notice(PRS.needsMapping(c) ? 'RN-PRS-02: sin mapeo no se calcula su real y la versión no se envía.' : 'Concepto de ingreso: se mapea a ventas (FAC).', PRS.needsMapping(c) ? 'bad' : 'warn'),
          can ? form({ id: 'prs-map', fields: [
            { key: 'source', label: 'Fuente', type: 'select', required: true, options: SOURCES.filter(([s]) => c.concept_type === 'INCOME' ? ['SALES', 'ACCOUNT'].includes(s) : s !== 'SALES'), onChange: () => {} },
            { key: 'ref', label: 'Categoría, tipo de personal o cuenta', type: 'select', options: () => [...G.db.where('expense_categories', x => x.status === 'ACTIVE').map(x => [x.id, `GAS · ${x.name}${PRS.mapIndex().EXPENSE_CATEGORY[x.id] ? ` (en ${PRS.cCode(PRS.mapIndex().EXPENSE_CATEGORY[x.id])})` : ''}`]), ...PAYROLL_KINDS.map(([k, l]) => [k, `PER · ${l}`])], help: 'Para cuenta contable usa el campo de abajo.' },
            { key: 'account', label: 'Cuenta contable (PCGE)', placeholder: 'p. ej. 6321' }],
            values: {}, submitLabel: 'Agregar mapeo',
            onSubmit: vals => { try { const ref = vals.source === 'ACCOUNT' ? vals.account : ['SALES', 'COST_OF_SALES'].includes(vals.source) ? null : vals.ref; if (vals.source === 'PAYROLL' && !PAYROLL_KINDS.find(k => k[0] === ref)) return 'RN-PRS-02: para personal elige un tipo PER (planilla, comisiones o bonos).'; if (vals.source === 'EXPENSE_CATEGORY' && PAYROLL_KINDS.find(k => k[0] === ref)) return 'RN-PRS-02: elige una categoría de GAS.'; PRS.addMapping(c.id, { source: vals.source, ref }); toast('Mapeo agregado', 'ok'); close(); G.refresh(); conceptDrawer(c.id); return true; } catch (e) { return e.message; } } }) : null)));
      }
    }, { code: 'PRS-02' });
  }

  /* ---------- PRS-03 Edición de versión (matriz) ---------- */
  const defaultVersion = () => { const d = G.db.all('budget_versions').filter(v => PRS.editable(v)).sort((a, b) => PRS.yearOfVersion(a) - PRS.yearOfVersion(b))[0]; return (d || PRS.approvedFor(curYear()) || G.db.all('budget_versions')[0] || {}).id; };
  function scr03(el, params = {}) {
    if (params.id) ui.vid = params.id; if (!ui.vid || !PRS.version(ui.vid)) ui.vid = defaultVersion();
    const v = PRS.version(ui.vid); const f = ui.f03 = ui.f03 || {};
    const editable = v && PRS.editable(v) && G.can('prs.budget.edit');
    const body = page(el, { code: 'PRS-03', title: 'Edición de versión', sub: 'Matriz concepto × mes en soles sin IGV, con filtros por marca, local y centro de costo. Cada celda es una línea (RN-PRS-13).', actions: v ? [{ label: 'Agregar línea', kind: 'primary', disabled: !editable, onClick: () => lineDrawer(v) }, { label: 'Carga y copia', onClick: () => G.go('PRS-04', { id: v.id }) }, { label: 'Enviar a aprobación', onClick: () => G.go('PRS-05', { id: v.id }), disabled: !PRS.editable(v) }] : [] });
    if (!v) { body.append(empty('No hay versiones. Crea un presupuesto en PRS-01.')); return; }
    const year = PRS.yearOfVersion(v); const months = PRS.monthsOf(year);
    body.append(h('div', { class: 'grid c4' }, sel(versionOpts(), v.id, x => { ui.vid = x; G.go('PRS-03', { id: x }); }, 'Versión'), sel(brandOpts(), f.brand, x => { f.brand = x; G.refresh(); }, 'Marca'), sel(siteOpts(), f.site, x => { f.site = x; G.refresh(); }, 'Local'), sel(ccOpts(), f.cc, x => { f.cc = x; G.refresh(); }, 'Centro de costo')));
    if (!PRS.editable(v)) body.append(notice(h('span', null, h('b', null, 'RN-PRS-04: '), `${PRS.vLabel(v)} está ${(VST[v.status] || [v.status])[0].toLowerCase()}; sus líneas no se modifican. `, G.can('prs.budget.edit') ? btn('Crear revisión en borrador', () => { const nv = tryDo(() => PRS.newVersion(v.budget_id, { from_version_id: v.id }), r => `Revisión ${PRS.vLabel(r)} creada`); if (nv) G.go('PRS-03', { id: nv.id }); }, { sm: true, kind: 'primary' }) : null), 'warn'));
    else if (!G.can('prs.budget.edit')) body.append(notice('Solo consulta: editar versiones en borrador requiere prs.budget.edit (Administración).', 'info'));
    const un = PRS.unmappedIn(v.id); if (un.length) body.append(notice(`RN-PRS-02: ${un.map(c => c.code).join(', ')} sin mapeo; mapéalos en PRS-02 antes de enviar.`, 'bad'));
    const sc = scopeNote(); if (sc) body.append(sc);
    const lines = PRS.linesOf(v.id).filter(l => (!f.brand || l.brand_id === f.brand) && (!f.site || l.establishment_id === f.site) && (!f.cc || l.cost_center_id === f.cc) && PRS.visible(l));
    const slots = {}; for (const l of lines) { const k = keyOf(l); (slots[k] = slots[k] || { key: k, concept_id: l.concept_id, brand_id: l.brand_id, establishment_id: l.establishment_id, cost_center_id: l.cost_center_id, m: {} }).m[l.month] = l; }
    const byC = U.groupBy(Object.values(slots), 'concept_id');
    const t = PRS.totals(v.id);
    body.append(kpis([{ label: 'Estado', value: (VST[v.status] || [v.status])[0], sub: `${PRS.vCode(v)} · ${v.name}` }, { label: 'Ingresos', value: m0(t.income) }, { label: 'Costo de ventas', value: m0(t.cost) }, { label: 'Gastos', value: m0(t.expense) }, { label: 'Resultado', value: m0(t.result), tone: t.result < 0 ? 'bad' : 'ok' }, { label: 'Líneas (filtro)', value: F.num(lines.length), sub: `${Object.keys(slots).length} filas de la matriz` }]));
    const colTot = months.map(() => 0); let grand = 0;
    const thead = h('thead', null, h('tr', null, h('th', { style: 'min-width:200px;position:sticky;left:0;background:var(--surface)' }, 'Concepto / dimensión'), months.map(m => h('th', { class: 'r' }, G.date.monthName(m))), h('th', { class: 'r' }, 'Total'), editable ? h('th') : null));
    const tb = h('tbody');
    const order = PRS.concepts();
    for (const c of order) {
      if (c.is_group) { const kids = order.filter(x => x.parent_id === c.id && byC[x.id]); if (!kids.length) continue; const gt = months.map(m => U.sum(kids.flatMap(k => byC[k.id]), s => (s.m[m] || {}).amount || 0)); tb.append(h('tr', { style: 'background:var(--primary-soft)' }, h('td', { style: 'position:sticky;left:0;background:var(--primary-soft)' }, h('b', null, `${c.code} · ${c.name}`)), gt.map(x => h('td', { class: 'r num small' }, h('b', null, F.num(x, 0)))), h('td', { class: 'r num' }, h('b', null, F.num(U.sum(gt), 0))), editable ? h('td') : null)); continue; }
      for (const s of (byC[c.id] || []).sort((a, b) => PRS.dimText(a).localeCompare(PRS.dimText(b)))) {
        let rt = 0;
        const cells = months.map((m, i) => {
          const l = s.m[m]; const val = l ? l.amount : 0; rt += val; colTot[i] += PRS.typeOf(c.id) === 'INCOME' ? 0 : val;
          if (!editable) return h('td', { class: 'r num small' }, l ? F.num(val, 0) : h('span', { class: 'muted' }, '·'));
          const inp = h('input', { class: 'input num', type: 'number', value: l ? val : '', placeholder: '0', attrs: { 'aria-label': `${c.code} ${G.date.monthName(m)} ${PRS.dimText(s)}`, min: 0, step: 'any' }, style: 'width:88px;text-align:right;padding:4px 6px' });
          inp.addEventListener('change', () => { if (inp.value === '' && !l) return; tryDo(() => l ? PRS.updateLineAmount(l.id, inp.value === '' ? 0 : inp.value) : PRS.setLine(v.id, { concept_id: c.id, month: m, brand_id: s.brand_id, establishment_id: s.establishment_id, cost_center_id: s.cost_center_id, amount: inp.value }), `${c.code} ${G.date.monthName(m)}: ${F.money(Number(inp.value || 0))}`); });
          return h('td', { class: 'r' }, inp);
        });
        grand += PRS.typeOf(c.id) === 'INCOME' ? 0 : rt;
        tb.append(h('tr', null, h('td', { style: 'position:sticky;left:0;background:var(--surface)' }, h('div', null, `${c.code} · ${c.name}`), h('div', { class: 'small muted' }, PRS.dimText(s), c.behavior === 'FIXED' ? ' · fijo' : '')), cells, h('td', { class: 'r num' }, h('b', null, F.num(rt, 0))),
          editable ? h('td', null, btn('Quitar', () => G.ui.confirm({ title: 'Quitar fila', message: `Se quitan las 12 líneas de ${c.name} · ${PRS.dimText(s)} de ${PRS.vLabel(v)}.`, danger: true, confirmLabel: 'Quitar', onConfirm: () => tryDo(() => PRS.removeSlot(v.id, s.key), n => `${n} líneas quitadas`) }), { sm: true, kind: 'ghost' })) : null));
      }
    }
    const tfoot = h('tfoot', null, h('tr', null, h('td', { style: 'position:sticky;left:0;background:var(--surface)' }, h('b', null, 'Total costo + gasto')), colTot.map(x => h('td', { class: 'r num small' }, h('b', null, F.num(x, 0)))), h('td', { class: 'r num' }, h('b', null, F.num(grand, 0))), editable ? h('td') : null));
    body.append(lines.length ? h('div', { class: 'card' }, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl prs-mx' }, thead, tb, tfoot))) : empty('No hay líneas con estos filtros. Agrega una línea, importa desde Excel o copia otra versión (PRS-04).'));
    body.append(h('div', { class: 'small muted' }, 'Importes en soles sin IGV (RN-PRS-11). Cambia una celda y sal del campo para guardar; una celda vacía en una fila existente no crea línea. Totales de columna: solo costo y gasto.'));
  }
  function lineDrawer(v) {
    const months = PRS.monthsOf(PRS.yearOfVersion(v));
    drawer(`Agregar línea a ${PRS.vLabel(v)}`, (b, close) => {
      const prev = h('div', { class: 'small muted' });
      const calc = vals => { const a = Number(vals.amount) || 0; const n = vals.mode === 'ONE' ? 1 : 12; const per = vals.mode === 'ANNUAL' ? R(a / 12) : a; prev.textContent = vals.mode === 'ONE' ? `1 línea de ${F.money(a)}` : `${n} líneas de ${F.money(per)} = ${F.money(per * n)} en el año`; };
      b.append(form({ id: 'prs-l', fields: [
        { key: 'concept_id', label: 'Concepto', type: 'select', required: true, options: leafOpts(), onChange: (x, vals, api) => { const c = PRS.concept(x); if (c && c.default_cost_center_id && !vals.cost_center_id) api.set('cost_center_id', c.default_cost_center_id); } },
        { key: 'brand_id', label: 'Marca (opcional, D-PRS-01)', type: 'select', options: G.db.all('brands').map(x => [x.id, x.name]) },
        { key: 'establishment_id', label: 'Local', type: 'select', options: G.db.all('establishments').map(x => [x.id, x.name]) },
        { key: 'cost_center_id', label: 'Centro de costo', type: 'select', options: G.db.all('cost_centers').map(x => [x.id, `${x.code} · ${x.name}`]) },
        { key: 'mode', label: 'Cómo cargar', type: 'select', required: true, options: [['MONTHLY', 'Mismo importe cada mes'], ['ANNUAL', 'Total anual repartido en 12'], ['ONE', 'Un solo mes']], onChange: (x, vals) => calc(vals) },
        { key: 'month', label: 'Mes (si es un solo mes)', type: 'select', options: months.map(m => [m, G.date.monthName(m)]) },
        { key: 'amount', label: 'Importe (S/ sin IGV)', type: 'money', required: true, onChange: (x, vals) => calc(vals) },
        { key: 'note', label: 'Nota', span: 2 }],
        values: { mode: 'MONTHLY', month: months[0] }, submitLabel: 'Agregar', onCancel: close, extraActions: [prev],
        onSubmit: vals => {
          try {
            const a = Number(vals.amount); if (a < 0) G.fail('RN-PRS-11', `El importe ${F.money(a)} es negativo.`);
            const ms = vals.mode === 'ONE' ? [vals.month] : months; const per = vals.mode === 'ANNUAL' ? R(a / 12) : a;
            const k = keyOf(vals); if (G.db.find('budget_lines', l => l.version_id === v.id && keyOf(l) === k && ms.includes(l.month))) G.fail('RN-PRS-13', `Ya existe ${PRS.cName(vals.concept_id)} · ${PRS.dimText(vals)} en esta versión: edita sus celdas en la matriz.`);
            ms.forEach((m, i) => PRS.setLine(v.id, { concept_id: vals.concept_id, month: m, brand_id: vals.brand_id, establishment_id: vals.establishment_id, cost_center_id: vals.cost_center_id, amount: vals.mode === 'ANNUAL' && i === 11 ? R(a - per * 11) : per, note: vals.note, strict: true }));
            toast(`${ms.length} línea(s) agregada(s)`, 'ok'); close(); G.refresh(); return true;
          } catch (e) { return e.message; }
        } }));
    }, { code: 'PRS-03' });
  }

  /* ---------- PRS-04 Carga y copia ---------- */
  const SAMPLE = 'concepto;mes;marca;local;centro;importe\nPUB-PLA;1;DG;;MKT-DG;6 500,00\nPUB-PLA;2;DG;;MKT-DG;6 000\nDLV-COM;1;;L1;DEL;2050\nEMP-EMP;1;;L2;PROD-L2;1 600,50\nGPE-CAP;3;;;RRHH;1200\nOCU-MAN;13;;L2;PROD-L2;600\nADM-GEN;1;;L1;ADM;-80';
  function scr04(el, params = {}) {
    if (params.id) ui.vid4 = params.id;
    const drafts = versionOpts(v => PRS.editable(v));
    if (!ui.vid4 || !PRS.editable(PRS.version(ui.vid4))) ui.vid4 = drafts.length ? drafts[0][0] : null;
    const v = PRS.version(ui.vid4); const can = G.can('prs.budget.edit');
    const body = page(el, { code: 'PRS-04', title: 'Carga y copia', sub: 'Llena una versión en borrador: importa líneas desde Excel con validación, copia otra versión o copia el real del año anterior con un ajuste %.', actions: v ? [{ label: 'Ver matriz', onClick: () => G.go('PRS-03', { id: v.id }) }] : [] });
    if (!v) { body.append(notice('No hay versiones en borrador. Crea una revisión desde PRS-01 o PRS-03 (RN-PRS-04: solo se cargan líneas en borrador).', 'warn')); return; }
    if (!can) body.append(notice('Solo consulta: cargar líneas requiere prs.budget.edit (Administración).', 'info'));
    const year = PRS.yearOfVersion(v);
    body.append(h('div', { class: 'grid c2' }, sel(drafts, v.id, x => { ui.vid4 = x; G.refresh(); }, 'Versión destino (borrador)'), h('div', { class: 'stack', style: 'gap:2px;min-width:0' }, h('span', { class: 'small muted' }, 'Contenido actual'), h('div', null, `${F.num(PRS.linesOf(v.id).length)} líneas · gasto + costo ${m0(PRS.totals(v.id).spend)} · ingresos ${m0(PRS.totals(v.id).income)}`))));
    body.append(h('div', { style: 'min-width:0;max-width:100%' }, tabs([
      { key: 'imp', label: 'Importar de Excel', render: p => {
        const ta = h('textarea', { class: 'input mono', style: 'min-height:150px;font-size:12px;width:100%;box-sizing:border-box', placeholder: 'Pega aquí las celdas copiadas de Excel (concepto, mes, marca, local, centro de costo, importe)' }, ui.imp || '');
        const out = h('div', { class: 'stack' });
        const file = h('input', { type: 'file', style: 'width:100%;min-width:0', attrs: { accept: '.csv,.txt,.tsv', 'aria-label': 'Archivo CSV' } });
        file.addEventListener('change', () => { const fl = file.files[0]; if (!fl) return; const rd = new FileReader(); rd.onload = () => { ta.value = rd.result; ui.imp = ta.value; check(); }; rd.readAsText(fl); });
        const check = () => {
          ui.imp = ta.value; U.clear(out);
          const r = PRS.parseImport(v.id, ta.value);
          out.append(kpis([{ label: 'Filas válidas', value: r.ok.length, tone: r.ok.length ? 'ok' : '' }, { label: 'Con error', value: r.errors.length, tone: r.errors.length ? 'bad' : 'ok' }, { label: 'Reemplazan líneas', value: r.ok.filter(x => x.replaces).length, sub: 'RN-PRS-13: se actualiza el importe' }, { label: 'Total válido', value: m0(U.sum(r.ok, x => x.amount)) }]));
          if (r.errors.length) out.append(table({ id: 'prs04e', search: false, columns: [{ key: 'row', label: 'Fila', align: 'r' }, { key: 'code', label: 'Regla', mono: true }, { key: 'msg', label: 'Problema' }, { key: 'raw', label: 'Texto', mono: true }], rows: r.errors }));
          if (r.ok.length) out.append(table({ id: 'prs04o', search: false, pageSize: 10, columns: [{ key: 'c', label: 'Concepto', value: x => `${PRS.cCode(x.concept_id)} · ${PRS.cName(x.concept_id)}` }, { key: 'month', label: 'Mes', value: x => G.date.monthName(x.month) }, { key: 'd', label: 'Dimensiones', value: x => PRS.dimText(x) }, { key: 'amount', label: 'Importe', align: 'r', render: x => F.money(x.amount) }, { key: 'w', label: 'Aviso', render: x => x.warn ? badge('Sin mapeo · RN-PRS-02', 'warn') : x.replaces ? badge('Reemplaza', 'info') : badge('Nueva', 'ok') }], rows: r.ok }));
          out.append(h('div', { class: 'row', style: 'gap:8px' }, btn(`Cargar ${r.ok.length} filas válidas`, () => { if (!r.ok.length) return toast('No hay filas válidas.', 'warn'); const n = tryDo(() => PRS.applyImport(v.id, r.ok), n => `${n} líneas cargadas en ${PRS.vLabel(v)}${r.errors.length ? ` · ${r.errors.length} filas con error no se cargaron` : ''}`); if (n) { ui.imp = ''; } }, { kind: 'primary', disabled: !can || !r.ok.length })));
        };
        ta.addEventListener('input', () => { ui.imp = ta.value; });
        p.append(h('div', { class: 'stack' }, notice(`Columnas: concepto (código de PRS-02) · mes (1–12 o ${year}-MM) · marca (DG, M2…) · local (L1, L2) · centro de costo (código) · importe en soles sin IGV. Separador tabulación (copiar de Excel), «;» o «,». Se valida cada fila (RN-PRS-01, 11, 13).`, 'info'),
          ta, h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, btn('Validar', check, { kind: 'primary' }), btn('Cargar ejemplo con errores', () => { ta.value = SAMPLE; check(); }), h('label', { class: 'small stack', style: 'gap:2px;min-width:0;flex:1 1 200px' }, 'o archivo CSV:', file)), out));
        if (ta.value) check();
      } },
      { key: 'ver', label: 'Otra versión', render: p => {
        const st = ui.c4 = ui.c4 || { from: (PRS.approvedFor(year - 1) || PRS.approvedFor(year) || {}).id, pct: 0 };
        const src = PRS.version(st.from);
        const prev = h('div');
        const draw = () => { U.clear(prev); const s = PRS.version(st.from); if (!s) return; const t = PRS.totals(s.id); prev.append(dl([['Origen', `${PRS.vLabel(s)} · ${(VST[s.status] || [s.status])[0]}`], ['Líneas', F.num(PRS.linesOf(s.id).length)], ['Gasto + costo origen', m0(t.spend)], [`Con ${st.pct >= 0 ? '+' : ''}${st.pct} %`, m0(PRS.applyPct(t.spend, st.pct))], ['Ingresos con ajuste', m0(PRS.applyPct(t.income, st.pct))]])); };
        const pct = h('input', { class: 'input', type: 'number', value: st.pct, style: 'max-width:120px', attrs: { 'aria-label': 'Ajuste %' } }); pct.addEventListener('input', () => { st.pct = Number(pct.value) || 0; draw(); });
        p.append(h('div', { class: 'stack' }, h('div', { class: 'grid c2' }, sel(versionOpts(x => x.id !== v.id), src && src.id, x => { st.from = x; draw(); }, 'Versión origen'), h('label', { class: 'stack', style: 'gap:2px' }, h('span', { class: 'small muted' }, 'Ajuste %'), pct)), prev,
          notice(`Reemplaza todas las líneas de ${PRS.vLabel(v)}. Los meses se copian en orden (mes 1 → mes 1).`, 'warn'),
          h('div', null, btn('Copiar versión', () => tryDo(() => PRS.copyVersion(st.from, v.id, st.pct), r => `${r.lines} líneas copiadas (${m0(r.total)})`), { kind: 'primary', disabled: !can }))));
        draw();
      } },
      { key: 'act', label: `Real ${year - 1}`, render: p => {
        const st = ui.a4 = ui.a4 || { pct: 8 };
        const out = h('div');
        const draw = () => {
          U.clear(out);
          const basis = PRS.actualBasis(year - 1);
          const byC = U.groupBy(basis, 'concept_id');
          const kind = U.groupBy(basis, 'basis');
          out.append(h('div', { class: 'small muted', style: 'margin:6px 0' }, `Base ${year - 1}: meses cerrados desde el snapshot (RN-PRS-09) ${(kind.CLOSED || []).length ? '✓' : '—'}, vencidos con el real vivo, mes en curso con su proyección (RN-PRS-08) y meses futuros con el presupuesto aprobado.`));
          if (!basis.length) { out.append(empty(`No hay real ni presupuesto aprobado de ${year - 1} para copiar.`)); return; }
          const rows = Object.entries(byC).map(([cid, xs]) => ({ cid, base: R(U.sum(xs, x => x.amount)), res: R(U.sum(xs, x => PRS.applyPct(x.amount, st.pct))), n: xs.length, closed: R(U.sum(xs.filter(x => x.basis === 'CLOSED'), x => x.amount)), fut: R(U.sum(xs.filter(x => ['CURRENT', 'FUTURE'].includes(x.basis)), x => x.amount)) }));
          out.append(table({ id: 'prs04a', search: false, pageSize: 30, columns: [{ key: 'c', label: 'Concepto', value: r => `${PRS.cCode(r.cid)} · ${PRS.cName(r.cid)}` }, { key: 'closed', label: 'De meses cerrados', align: 'r', render: r => m0(r.closed) }, { key: 'fut', label: 'Proyección + ppto.', align: 'r', render: r => m0(r.fut) }, { key: 'base', label: `Base ${year - 1}`, align: 'r', render: r => m0(r.base) }, { key: 'res', label: `${year} con ${st.pct >= 0 ? '+' : ''}${st.pct} %`, align: 'r', render: r => h('b', null, m0(r.res)) }], rows,
            footer: ['Total', '', '', m0(U.sum(rows, r => r.base)), { v: h('b', null, m0(U.sum(rows, r => r.res))), align: 'r' }] }));
          out.append(h('div', { class: 'small muted' }, `Ejemplo CA-PRS-05: una línea de ${F.money(2500)} con +8 % queda en ${F.money(PRS.applyPct(2500, 8))}.`));
        };
        const pct = h('input', { class: 'input', type: 'number', value: st.pct, style: 'max-width:120px', attrs: { 'aria-label': 'Ajuste % sobre el real' } }); pct.addEventListener('change', () => { st.pct = Number(pct.value) || 0; draw(); });
        p.append(h('div', { class: 'stack' }, h('div', { class: 'row', style: 'gap:10px;align-items:flex-end;flex-wrap:wrap' }, h('label', { class: 'stack', style: 'gap:2px' }, h('span', { class: 'small muted' }, 'Ajuste % sobre el real'), pct), btn(`Copiar real ${year - 1} a ${PRS.vLabel(v)}`, () => tryDo(() => PRS.copyFromActual(v.id, st.pct), r => `${r.lines} líneas copiadas (${m0(r.total)})`), { kind: 'primary', disabled: !can })), notice(`Reemplaza todas las líneas de ${PRS.vLabel(v)} con el real ${year - 1} por línea y mes.`, 'warn'), out));
        draw();
      } },
    ], { key: 'prs04' })));
  }

  /* ---------- PRS-05 Envío y aprobación ---------- */
  PRS.diffVersions = function (aId, bId) {
    const a = aId ? U.groupBy(PRS.linesOf(aId), 'concept_id') : {}, b = bId ? U.groupBy(PRS.linesOf(bId), 'concept_id') : {};
    const ids = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    const ya = aId ? PRS.monthsOf(PRS.yearOfVersion(PRS.version(aId))) : [], yb = bId ? PRS.monthsOf(PRS.yearOfVersion(PRS.version(bId))) : [];
    return ids.map(cid => {
      const ma = Array(12).fill(0), mb = Array(12).fill(0);
      for (const l of a[cid] || []) { const i = ya.indexOf(l.month); if (i >= 0) ma[i] += l.amount; }
      for (const l of b[cid] || []) { const i = yb.indexOf(l.month); if (i >= 0) mb[i] += l.amount; }
      const ta = R(U.sum(ma)), tb = R(U.sum(mb));
      return { concept_id: cid, type: PRS.typeOf(cid), a: ta, b: tb, diff: R(tb - ta), pct: ta ? R((tb - ta) / ta * 100, 1) : null, ma: ma.map(x => R(x)), mb: mb.map(x => R(x)) };
    }).sort((x, y) => ((PRS.concept(x.concept_id) || {}).sort_order || 0) - ((PRS.concept(y.concept_id) || {}).sort_order || 0));
  };
  function scr05(el, params = {}) {
    const list = G.db.all('budget_versions').filter(v => ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(v.status)).sort((a, b) => (a.status === 'SUBMITTED' ? -1 : 1) - (b.status === 'SUBMITTED' ? -1 : 1) || PRS.yearOfVersion(a) - PRS.yearOfVersion(b));
    if (params.id) ui.vid5 = params.id; if (!ui.vid5 || !PRS.version(ui.vid5)) ui.vid5 = (list[0] || {}).id;
    const v = PRS.version(ui.vid5);
    const body = page(el, { code: 'PRS-05', title: 'Envío y aprobación', sub: 'Envía la versión, revisa sus diferencias con la vigente y apruébala o recházala con comentario. Quien elabora o envía no aprueba (RN-PRS-05).' });
    body.append(kpis([{ label: 'Por aprobar', value: list.filter(x => x.status === 'SUBMITTED').length, tone: 'warn' }, { label: 'En borrador', value: list.filter(x => x.status === 'DRAFT').length }, { label: 'Rechazadas por corregir', value: list.filter(x => x.status === 'REJECTED').length, tone: list.some(x => x.status === 'REJECTED') ? 'bad' : '' }, { label: 'Tu rol', value: G.roleName(G.ctx.role), sub: [G.can('prs.budget.submit') ? 'envía' : null, G.can('prs.budget.approve') ? 'aprueba' : null].filter(Boolean).join(' y ') || 'solo consulta' }]));
    body.append(table({ id: 'prs05', search: false, columns: [{ key: 'v', label: 'Versión', value: x => PRS.vLabel(x) }, { key: 'name', label: 'Nombre' }, { key: 'status', label: 'Estado', render: x => vBadge(x.status) }, { key: 'created_by', label: 'Elaboró', value: x => G.userName(x.created_by) }, { key: 'submitted_at', label: 'Enviada', value: x => x.submitted_at ? `${F.datetime(x.submitted_at)} · ${G.userName(x.submitted_by)}` : '—' }, { key: 'sel', label: '', sort: false, render: x => x.id === ui.vid5 ? badge('En revisión', 'primary') : '' }], rows: list, onRow: x => { ui.vid5 = x.id; G.refresh(); }, empty: 'No hay versiones en borrador, enviadas ni rechazadas.' }));
    if (!v) return;
    const cur = PRS.approved(v.budget_id); const d = PRS.diffVersions(cur && cur.id !== v.id ? cur.id : null, v.id);
    const un = PRS.unmappedIn(v.id); const me = uid();
    const checks = [
      [PRS.linesOf(v.id).length > 0, `RN-PRS-01: ${F.num(PRS.linesOf(v.id).length)} líneas con concepto, mes, importe y al menos una dimensión.`],
      [!un.length, un.length ? `RN-PRS-02: falta mapeo en ${un.map(c => c.code).join(', ')}.` : 'RN-PRS-02: todos los conceptos de costo y gasto tienen mapeo.'],
      [true, cur ? `RN-PRS-03: al aprobar, ${PRS.vLabel(cur)} pasa a reemplazada.` : 'RN-PRS-03: será la primera versión vigente del año.'],
      [v.status !== 'SUBMITTED' || (me !== v.submitted_by && me !== v.created_by), v.status === 'SUBMITTED' ? `RN-PRS-05: envió ${G.userName(v.submitted_by)}, elaboró ${G.userName(v.created_by)}; decide otra persona (tú: ${G.userName(me) || G.ctx.userName()}).` : 'RN-PRS-05: aprobará una persona distinta de quien envía.'],
    ];
    const actions = [];
    if (PRS.editable(v)) actions.push(btn('Enviar a aprobación', () => tryDo(() => PRS.submit(v.id), `${PRS.vLabel(v)} enviada a aprobación`), { kind: 'primary', disabled: !G.can('prs.budget.submit') }));
    if (v.status === 'SUBMITTED') {
      actions.push(btn('Aprobar', () => modal(`Aprobar ${PRS.vLabel(v)}`, mb => { const ta = h('textarea', { class: 'input', placeholder: 'Comentario (opcional)' }); mb.append(h('p', null, cur ? `${PRS.vLabel(cur)} quedará reemplazada (RN-PRS-03).` : 'Será la versión vigente.'), ta); mb._ta = ta; }, [{ label: 'Cancelar' }, { label: 'Aprobar', kind: 'primary', onClick: () => { const ta = document.querySelector('.modal textarea'); return tryDo(() => PRS.approve(v.id, { comment: ta && ta.value }), `${PRS.vLabel(v)} aprobada · versión vigente`) ? true : false; } }]), { kind: 'primary', disabled: !G.can('prs.budget.approve') }));
      actions.push(btn('Rechazar', () => modal(`Rechazar ${PRS.vLabel(v)}`, mb => mb.append(h('textarea', { class: 'input', placeholder: 'Motivo del rechazo (obligatorio)' })), [{ label: 'Cancelar' }, { label: 'Rechazar', kind: 'danger', onClick: () => { const ta = document.querySelector('.modal textarea'); return tryDo(() => PRS.reject(v.id, { comment: ta && ta.value }), `${PRS.vLabel(v)} rechazada`) ? true : false; } }]), { kind: 'danger', disabled: !G.can('prs.budget.approve') }));
    }
    actions.push(btn('Ver matriz', () => G.go('PRS-03', { id: v.id }), { sm: false }));
    const ta = cur ? PRS.totals(cur.id) : null, tv = PRS.totals(v.id);
    body.append(h('div', { class: 'grid side-r' },
      card(`Diferencias de ${PRS.vLabel(v)} frente a ${cur && cur.id !== v.id ? PRS.vLabel(cur) + ' (vigente)' : 'nada vigente'}`, d.length ? table({ id: 'prs05d', search: false, pageSize: 40, columns: [{ key: 'c', label: 'Concepto', value: r => `${PRS.cCode(r.concept_id)} · ${PRS.cName(r.concept_id)}` }, { key: 'a', label: 'Vigente', align: 'r', render: r => m0(r.a) }, { key: 'b', label: 'Propuesta', align: 'r', render: r => m0(r.b) }, { key: 'diff', label: 'Diferencia', align: 'r', render: r => h('span', { style: { color: Math.abs(r.diff) < 1 ? 'var(--muted)' : (r.diff > 0) !== (r.type === 'INCOME') ? 'var(--bad)' : 'var(--ok)' } }, `${r.diff > 0 ? '+' : ''}${F.num(r.diff, 0)}`) }, { key: 'pct', label: '%', align: 'r', render: r => r.pct === null ? (r.b ? badge('Nuevo', 'info') : '—') : `${r.pct > 0 ? '+' : ''}${F.num(r.pct, 1)} %` }], rows: d.filter(r => Math.abs(r.diff) >= 0.5 || !cur), empty: 'Sin diferencias con la vigente.' }) : empty('La versión no tiene líneas.'), { flush: true }),
      h('div', { class: 'stack' },
        card('Decisión', h('div', { class: 'stack' }, h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, vBadge(v.status), badge(PRS.vCode(v), 'primary')), dl([['Ingresos', `${m0(tv.income)}${ta ? ` (vigente ${m0(ta.income)})` : ''}`], ['Costo + gasto', `${m0(tv.spend)}${ta ? ` (vigente ${m0(ta.spend)})` : ''}`], ['Resultado', `${m0(tv.result)}${ta ? ` (vigente ${m0(ta.result)})` : ''}`], ['Comentario', v.decision_comment || '—']]),
          h('div', { class: 'stack', style: 'gap:4px' }, checks.map(([ok, t]) => h('div', { class: 'small' }, badge(ok ? 'OK' : 'Falta', ok ? 'ok' : 'bad'), ' ', t))), h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, actions))),
        card('Historial', timeline(v.history)))));
  }

  /* ---------- PRS-06 Real frente a presupuesto ---------- */
  function periodPicker(st, year, { mode = true } = {}) {
    const ms = PRS.monthsOf(year).filter(m => m <= G.TODAY);
    if (!st.month || !ms.includes(st.month)) st.month = ms[ms.length - 1] || PRS.monthsOf(year)[0];
    return h('div', { class: 'stack', style: 'gap:8px' },
      h('div', { style: 'overflow-x:auto' }, pills(ms.map(m => [m, G.date.monthName(m)]), st.month, x => { st.month = x; G.refresh(); })),
      mode ? pills([['MONTH', 'Mes'], ['YTD', 'Acumulado']], st.mode || 'MONTH', x => { st.mode = x; G.refresh(); }) : null);
  }
  const yearsWithApproved = () => G.db.all('budgets').filter(b => PRS.approved(b.id)).map(b => [String(b.year), String(b.year)]);
  function scr06(el, params = {}) {
    const st = ui.s06 = ui.s06 || { year: String(curYear()), mode: 'MONTH', dim: 'concept' };
    if (params.month) { st.month = params.month; st.year = String(PRS.yearOf(params.month)); }
    const ap = PRS.approvedFor(st.year);
    const body = page(el, { code: 'PRS-06', title: 'Real frente a presupuesto', sub: 'Por concepto y dimensión: presupuesto, real, diferencia, % de ejecución y semáforo (RN-PRS-07), del mes o acumulado. El real sale de FAC, GAS y PER sin IGV (RN-PRS-06).', actions: [{ label: 'Proyección de cierre', onClick: () => G.go('PRS-08') }] });
    if (!ap) { body.append(notice(`RN-PRS-03: el presupuesto ${st.year} no tiene versión aprobada.`, 'warn')); return; }
    body.append(h('div', { class: 'grid c3' }, sel(yearsWithApproved(), st.year, x => { st.year = x; st.month = null; G.refresh(); }, 'Año'), sel([['concept', 'Solo concepto'], ['brand', 'Concepto × marca'], ['site', 'Concepto × local'], ['cc', 'Concepto × centro de costo']], st.dim, x => { st.dim = x; G.refresh(); }, 'Dimensión'), sel([['', 'Todos los tipos'], ...TYPES], st.type || '', x => { st.type = x; G.refresh(); }, 'Tipo')));
    body.append(periodPicker(st, st.year));
    const months = st.mode === 'YTD' ? PRS.monthsOf(st.year).filter(m => m <= st.month) : [st.month];
    const ex = PRS.execution(ap.id, months);
    const slots = ex.slots.filter(PRS.visible);
    const sc = scopeNote(); if (sc) body.append(sc);
    const hasCur = months.some(m => PRS.monthState(m) === 'CURRENT');
    const inc = PRS.sumType(slots, 'INCOME'), exp = PRS.sumType(slots, 'EXPENSE');
    const agg = PRS.aggregate(slots, st.dim).filter(x => !st.type || x.type === st.type);
    const conceptsAgg = PRS.aggregate(slots, 'concept');
    const lt = (b, v, t) => ({ GREEN: 'ok', AMBER: 'warn', RED: 'bad' }[PRS.lightFor(b, v, t)]);
    body.append(kpis([
      { label: 'Ingresos: real / presupuesto', value: pctTxt(PRS.pct(inc.actual, inc.budget)), sub: `${m0(inc.actual)} de ${m0(inc.budget)}`, tone: lt(inc.budget, inc.forecast, 'INCOME') },
      { label: 'Costo + gasto: real / presupuesto', value: pctTxt(PRS.pct(exp.actual, exp.budget)), sub: `${m0(exp.actual)} de ${m0(exp.budget)}`, tone: lt(exp.budget, exp.forecast, 'EXPENSE') },
      hasCur ? { label: 'Desviación proyectada de gasto', value: m0(R(exp.forecast - exp.budget)), sub: `Real a la fecha − presupuesto: ${m0(R(exp.actual - exp.budget))}`, tone: exp.forecast > exp.budget ? 'bad' : 'ok' } : { label: 'Desviación de gasto', value: m0(R(exp.actual - exp.budget)), sub: 'KPI-PRS-03: real − presupuesto', tone: exp.actual > exp.budget ? 'bad' : 'ok' },
      { label: 'Conceptos en rojo', value: conceptsAgg.filter(x => x.light === 'RED').length, sub: `${conceptsAgg.filter(x => x.light === 'AMBER').length} en ámbar`, tone: conceptsAgg.some(x => x.light === 'RED') ? 'bad' : 'ok', onClick: () => G.go('PRS-10') },
      { label: 'Base del real', value: months.length === 1 ? MSTATE[PRS.monthState(months[0])] : `${months.length} meses`, sub: months.some(m => PRS.monthState(m) === 'CLOSED') ? 'Meses cerrados: snapshot (RN-PRS-09)' : 'Real vivo' },
    ]));
    if (hasCur) body.append(notice(`Mes en curso (día ${PRS.elapsed(G.TODAY)} de ${PRS.daysIn(G.TODAY)}): el % de ejecución compara el real a la fecha; el semáforo usa la proyección de cierre (RN-PRS-08), para no mostrar en verde un gasto que se va a pasar.`, 'info'));
    const unm = ex.unmapped.filter(s => Math.abs(s.actual) > 0.5);
    if (unm.length) body.append(notice(`RN-PRS-02: ${m0(U.sum(unm, s => s.actual))} del real no tiene concepto (categorías sin mapeo). Revísalo en PRS-02.`, 'warn'));
    const unb = slots.filter(s => s.unbudgeted && Math.abs(s.actual) > 0.5);
    if (unb.length) body.append(notice(`Real sin línea presupuestal: ${unb.map(s => `${PRS.cCode(s.concept_id)} ${m0(s.actual)}`).join(' · ')}.`, 'warn'));
    const cols = [{ key: 'c', label: 'Concepto', value: r => `${PRS.cCode(r.concept_id)} · ${PRS.cName(r.concept_id)}`, render: r => h('div', null, h('div', null, `${PRS.cCode(r.concept_id)} · ${PRS.cName(r.concept_id)}`), h('div', { class: 'small muted' }, lbl(TYPES, r.type), PRS.isFixed(r.concept_id) ? ' · fijo' : '')) }];
    if (st.dim !== 'concept') cols.push({ key: 'dv', label: { brand: 'Marca', site: 'Local', cc: 'Centro de costo' }[st.dim], value: r => PRS.dimName(st.dim, r.dim_value) });
    cols.push({ key: 'budget', label: 'Presupuesto', align: 'r', render: r => m0(r.budget) }, { key: 'actual', label: 'Real', align: 'r', render: r => h('b', null, m0(r.actual)) }, { key: 'diff', label: 'Diferencia', align: 'r', render: r => h('span', { style: { color: Math.abs(r.diff) < 1 ? '' : (r.diff > 0) !== PRS.isIncome(r.type) ? 'var(--bad)' : 'var(--ok)' } }, `${r.diff > 0 ? '+' : ''}${F.num(r.diff, 0)}`) }, { key: 'pct', label: '% ejec.', align: 'r', value: r => r.pct ?? -1, render: r => h('div', { style: 'min-width:90px' }, h('div', { class: 'num small' }, pctTxt(r.pct)), G.ui.progress(r.pct || 0, { GREEN: 'ok', AMBER: 'warn', RED: 'bad' }[r.light] || '')) });
    if (hasCur) cols.push({ key: 'forecast', label: 'Proyección', align: 'r', render: r => h('span', { class: 'muted' }, m0(r.forecast)) });
    cols.push({ key: 'light', label: 'Semáforo', value: r => ({ GREEN: 3, AMBER: 2, RED: 1 }[r.light] || 0), render: r => lightCell(r.light, hasCur ? r.fpct : undefined) });
    body.append(table({ id: 'prs06', pageSize: 40, columns: cols, rows: agg, onRow: r => G.go('PRS-07', { concept: r.concept_id, month: st.month, mode: st.mode, dim: st.dim, dv: r.dim_value || '' }), filters: [{ key: 'light', label: 'Semáforo', options: [['GREEN', 'Verde'], ['AMBER', 'Ámbar'], ['RED', 'Rojo']] }],
      footer: [h('b', null, 'Resultado (ingresos − costo − gasto)'), ...(st.dim !== 'concept' ? [''] : []), { v: m0(R(inc.budget - exp.budget)), align: 'r' }, { v: h('b', null, m0(R(inc.actual - exp.actual))), align: 'r' }, '', '', ...(hasCur ? [''] : []), ''] }));
    // gráfico anual presupuesto vs real
    const yms = PRS.monthsOf(st.year); const ey = PRS.execution(ap.id, yms.filter(m => m <= G.TODAY)).slots.filter(PRS.visible);
    const sv = (f, t) => yms.map(m => m > G.TODAY ? null : R(U.sum(ey.filter(s => t === 'INCOME' ? s.type === 'INCOME' : s.type !== 'INCOME'), s => (s.months[m] || {})[f] || 0)));
    const ly = PRS.linesOf(ap.id); const bm = (t) => yms.map(m => R(U.sum(ly.filter(l => l.month === m && (t === 'INCOME' ? PRS.typeOf(l.concept_id) === 'INCOME' : PRS.typeOf(l.concept_id) !== 'INCOME')), l => l.amount)));
    body.append(h('div', { class: 'grid c2' },
      card(`Costo + gasto ${st.year}: presupuesto y real`, G.ui.chart.bar({ labels: yms.map(G.date.monthName), series: [{ name: 'Presupuesto', values: bm('EXPENSE') }, { name: 'Real', values: sv('actual', 'EXPENSE').map(x => x ?? 0) }], format: m0 })),
      card(`Ingresos ${st.year}: presupuesto y real`, G.ui.chart.bar({ labels: yms.map(G.date.monthName), series: [{ name: 'Presupuesto', values: bm('INCOME') }, { name: 'Real', values: sv('actual', 'INCOME').map(x => x ?? 0) }], format: m0 }))));
    body.append(h('div', { class: 'small muted' }, `Semáforo (RN-PRS-07, prs_amber_pct = ${amberPct()} %): gasto verde hasta 100 %, ámbar hasta ${100 + amberPct()} %, rojo encima; ingresos verde desde 100 %, ámbar desde ${100 - amberPct()} %, rojo debajo. Versión ${PRS.vLabel(ap)}.`));
  }

  /* ---------- PRS-07 Detalle del real ---------- */
  function expenseDrawer(id) {
    const e = G.db.get('expenses', id); if (!e) return;
    if (G.gas && typeof G.gas.open === 'function') return G.gas.open(id);
    drawer(`Gasto ${e.number}`, b => b.append(dl([['Descripción', e.description], ['Fecha', F.date(e.issue_date)], ['Categoría', (G.db.get('expense_categories', e.category_id) || {}).name], ['Proveedor', e.supplier_id ? G.supName(e.supplier_id) : '—'], ['Sin IGV', F.money(e.net_pen)], ['Total', F.money(e.amount_pen)], ['Estado', e.status]])), { code: 'GAS' });
  }
  function fleetInfo(e) {
    if (!e || !e.vehicle_id) return null;
    const veh = G.db.get('vehicles', e.vehicle_id) || {};
    const cat = G.db.get('expense_categories', e.category_id) || {};
    const fl = G.db.find('fuel_loads', x => x.expense_id === e.id); const mt = G.db.find('vehicle_maintenances', x => x.expense_id === e.id) || G.db.find('maintenance_orders', x => x.expense_id === e.id);
    if (e.fuel_gallons || cat.delivery_cost_type === 'FUEL' || fl) return `Carga de combustible ${veh.plate || e.vehicle_id}: ${F.num((fl && fl.gallons) || e.fuel_gallons, 3)} gal · vale ${(fl && fl.voucher_no) || e.fuel_voucher_no || '—'} · ${F.num((fl && fl.odometer_km) || e.odometer_km)} km${fl ? ' (FLO)' : ''}`;
    if (/MAINT|SOAT|TECH/.test(cat.delivery_cost_type || '') || mt) return `Mantenimiento ${veh.plate || e.vehicle_id}${mt ? ` · orden ${mt.number || mt.id} (FLO)` : ''} · ${cat.name}`;
    return `Vehículo ${veh.plate || e.vehicle_id} · ${cat.name}`;
  }
  function scr07(el, params = {}) {
    const st = ui.s07 = ui.s07 || { year: String(curYear()), mode: 'MONTH' };
    if (params.concept) st.concept = params.concept; if (params.month) { st.month = params.month; st.year = String(PRS.yearOf(params.month)); } if (params.mode) st.mode = params.mode;
    if (params.dim !== undefined) { st.dim = params.dim; st.dv = params.dv || ''; }
    if (!st.concept || !PRS.concept(st.concept)) st.concept = (G.db.find('budget_concepts', c => c.code === 'PUB-PLA') || PRS.leaves()[0] || {}).id;
    const ap = PRS.approvedFor(st.year);
    const body = page(el, { code: 'PRS-07', title: 'Detalle del real', sub: 'Bajada a los gastos, comprobantes, planillas y snapshots que forman el real del concepto; los gastos de flota muestran su carga de combustible o mantenimiento.', actions: [{ label: 'Volver a PRS-06', onClick: () => G.go('PRS-06') }] });
    body.append(h('div', { class: 'grid c3' }, sel(leafOpts(), st.concept, x => { st.concept = x; st.dim = ''; st.dv = ''; G.refresh(); }, 'Concepto'), sel(yearsWithApproved(), st.year, x => { st.year = x; st.month = null; G.refresh(); }, 'Año'), sel([['', 'Todas las dimensiones'], ...(st.dim && st.dv ? [[st.dv, `${PRS.dimName(st.dim, st.dv)}`]] : [])], st.dv || '', x => { st.dv = x; G.refresh(); }, 'Filtro de dimensión')));
    body.append(periodPicker(st, st.year));
    const months = st.mode === 'YTD' ? PRS.monthsOf(st.year).filter(m => m <= st.month) : [st.month];
    const field = { brand: 'brand_id', site: 'establishment_id', cc: 'cost_center_id' }[st.dim];
    const ex = PRS.execution(ap ? ap.id : null, months, { withRows: true });
    const slots = ex.slots.filter(s => s.concept_id === st.concept && PRS.visible(s) && (!field || !st.dv || s[field] === st.dv));
    const rows = slots.flatMap(s => s.rows.map(r => Object.assign({ slot: s }, r)));
    const c = PRS.concept(st.concept);
    const bud = R(U.sum(slots, s => s.budget)), act = R(U.sum(slots, s => s.actual)), fc = R(U.sum(slots, s => s.forecast));
    body.append(kpis([{ label: 'Presupuesto', value: m0(bud), sub: ap ? PRS.vLabel(ap) : '' }, { label: 'Real', value: m0(act), sub: `${F.num(rows.length)} partidas` }, { label: '% ejecución', value: pctTxt(PRS.pct(act, bud)) }, { label: 'Semáforo', value: (LIGHT[PRS.lightFor(bud, fc, c.concept_type)] || ['—'])[0], tone: { GREEN: 'ok', AMBER: 'warn', RED: 'bad' }[PRS.lightFor(bud, fc, c.concept_type)], sub: fc !== act ? `Proyección ${m0(fc)}` : '' }, { label: 'Mapeo', value: PRS.mappingsOf(st.concept).length, sub: PRS.mappingsOf(st.concept).map(PRS.mapLabel).slice(0, 2).join(' · ') || 'Sin mapeo · RN-PRS-02', tone: PRS.isMapped(st.concept) || c.concept_type === 'INCOME' ? '' : 'bad' }]));
    // snapshots de meses cerrados
    const closed = months.filter(m => PRS.monthState(m) === 'CLOSED');
    if (closed.length) {
      const runs = closed.map(m => ({ m, runs: PRS.runsOf(m) }));
      body.append(card('Meses cerrados: snapshot congelado (RN-PRS-09)', h('div', { class: 'stack' },
        table({ id: 'prs07r', search: false, columns: [{ key: 'm', label: 'Mes', value: r => G.date.monthName(r.m) }, { key: 'n', label: 'Corridas', align: 'r', value: r => r.runs.length }, { key: 'last', label: 'Vigente', render: r => r.runs.length ? `Corrida ${r.runs[r.runs.length - 1].run_no} · ${F.datetime(r.runs[r.runs.length - 1].frozen_at)} · ${G.userName(r.runs[r.runs.length - 1].frozen_by)}` : badge('Sin snapshot: real vivo', 'warn') }, { key: 'reason', label: 'Motivo', value: r => r.runs.length ? r.runs[r.runs.length - 1].reason : '' }, { key: 'tot', label: 'Total del concepto', align: 'r', render: r => { const run = r.runs[r.runs.length - 1]; return run ? m0(U.sum(run.rows.filter(x => x.concept_id === st.concept), x => x.amount)) : '—'; } }],
          rows: runs, actions: r => [btn('Recalcular', () => recalcDialog(r.m), { sm: true, disabled: !(G.can('prs.concept.manage') || G.can('prs.budget.approve')) })] }),
        h('div', { class: 'small muted' }, 'Recalcular crea una corrida nueva con el real vivo de ese mes; la anterior se conserva (solo inserción).')), { flush: false }));
    }
    body.append(table({ id: 'prs07', pageSize: 30, columns: [
      { key: 'date', label: 'Fecha', render: r => F.date(r.date), value: r => r.date },
      { key: 'source', label: 'Origen', value: r => SRC_LBL[r.source] || r.source, render: r => badge(SRC_LBL[r.source] || r.source, r.source === 'SNAPSHOT' ? '' : r.source === 'GAS' ? 'info' : r.source === 'FAC' ? 'ok' : 'warn') },
      { key: 'label', label: 'Documento', mono: true },
      { key: 'detail', label: 'Descripción', render: r => { const e = r.ref_type === 'expenses' ? G.db.get('expenses', r.ref_id) : null; const fi = fleetInfo(e); return h('div', null, h('div', null, r.detail || '—'), fi ? h('div', { class: 'small', style: 'color:var(--info)' }, fi) : null, e && e.allocated !== false && G.db.find('expense_allocations', a => a.expense_id === e.id) ? h('div', { class: 'small muted' }, 'Repartido entre marcas (RN-GAS-04)') : null); } },
      { key: 'dims', label: 'Línea presupuestal', value: r => PRS.dimText(r.slot) },
      { key: 'cc', label: 'Centro / marca / local', value: r => [r.cost_center_id ? (G.db.get('cost_centers', r.cost_center_id) || {}).code : null, r.brand_id ? G.brandName(r.brand_id) : null, r.establishment_id ? G.siteName(r.establishment_id) : null].filter(Boolean).join(' · ') },
      { key: 'amount', label: 'Sin IGV', align: 'r', render: r => h('b', { style: { color: r.amount < 0 ? 'var(--bad)' : '' } }, F.money(r.amount)) }],
      rows: rows.sort((a, b) => String(b.date).localeCompare(String(a.date))), onRow: r => { if (r.ref_type === 'expenses') expenseDrawer(r.ref_id); else if (r.ref_type === 'sales_documents') { const d = G.db.get('sales_documents', r.ref_id); drawer(`${r.label}`, b => b.append(dl([['Cliente', d.customer_name], ['Fecha', F.date(d.issue_date)], ['Marca', G.brandName(d.brand_id)], ['Local', G.siteName(d.establishment_id)], ['Subtotal sin IGV', F.money(d.subtotal)], ['IGV', F.money(d.igv)], ['Total', F.money(d.total)], ['Costo', F.money(d.cost)], ['SUNAT', d.sunat_status]])), { code: 'FAC' }); } else if (r.ref_type === 'employees') drawer(r.detail, b => b.append(dl([['Tipo', r.label], ['Centro de costo', G.ccName(r.cost_center_id)], ['Importe del mes', F.money(r.amount)], ['Fuente', r.source === 'PER_EST' ? 'Estimado: sueldo × 1,215 (sin planilla importada en PER)' : 'PER']])), { code: 'PER' }); },
      filters: [{ key: 'source', label: 'Origen', options: Object.entries(SRC_LBL) }], empty: 'No hay partidas del real para este concepto en el período.',
      footer: ['Total', '', '', '', '', '', { v: h('b', null, F.money(act)), align: 'r' }] }));
  }
  function recalcDialog(m) {
    const run = PRS.latestRun(m); const live = R(U.sum(PRS.liveRows(m, { asOf: PRS.monthEnd(m) }), r => r.amount));
    modal(`Recalcular ${G.date.monthName(m)}`, b => { b.append(dl([['Snapshot vigente', run ? `Corrida ${run.run_no} · ${m0(run.total)}` : 'No hay'], ['Real vivo hoy', m0(live)], ['Diferencia', m0(R(live - (run ? run.total : 0)))]])); b.append(h('textarea', { class: 'input', placeholder: 'Motivo del recálculo (obligatorio)' })); b.append(notice('RN-PRS-09: se crea una corrida nueva; la anterior no se edita.', 'info')); },
      [{ label: 'Cancelar' }, { label: 'Crear corrida', kind: 'primary', onClick: () => { const ta = document.querySelector('.modal textarea'); if (!ta || !ta.value.trim()) { toast('RN-PRS-09: escribe el motivo del recálculo.', 'warn'); return false; } return tryDo(() => PRS.freeze(m, { reason: ta.value.trim() }), r => `Corrida ${r.run_no} de ${G.date.monthName(m)}: ${m0(r.total)}`) ? true : false; } }]);
  }

  /* ---------- PRS-08 Proyección de cierre ---------- */
  function scr08(el) {
    const st = ui.s08 = ui.s08 || { by: 'concept' };
    const m = G.date.month(G.TODAY); const ap = PRS.approvedFor(PRS.yearOf(m));
    const body = page(el, { code: 'PRS-08', title: 'Proyección de cierre', sub: `Real a la fecha, días transcurridos y proyección al cierre de ${G.date.monthName(m)} por concepto frente al presupuesto (RN-PRS-08: lineal por días; los fijos usan su presupuesto).`, actions: ap ? [{ label: 'Guardar proyección', onClick: () => tryDo(() => PRS.saveForecast(ap.id, m), r => `Proyección guardada (${r.count} líneas)`), disabled: !G.can('prs.report.view_all') }, { label: 'Generar alertas', kind: 'primary', onClick: () => tryDo(() => PRS.runAlerts(ap.id, m), r => r.length ? `${r.length} alerta(s) activas; se avisó a los responsables y a GERENTE` : 'Ningún concepto supera el umbral de alerta'), disabled: !G.can('prs.report.view_all') }] : [] });
    if (!ap) { body.append(notice('RN-PRS-03: no hay versión aprobada para el año en curso.', 'warn')); return; }
    const el_ = PRS.elapsed(m), days = PRS.daysIn(m);
    const ex = PRS.execution(ap.id, [m]); const slots = ex.slots.filter(PRS.visible);
    const e = PRS.sumType(slots, 'EXPENSE'), i = PRS.sumType(slots, 'INCOME');
    const rows = st.by === 'concept' ? PRS.aggregate(slots, 'concept') : slots.map(s => Object.assign({}, s, { slots: [s], diff: R(s.actual - s.budget), pct: PRS.pct(s.actual, s.budget), fpct: PRS.pct(s.forecast, s.budget), light: PRS.lightFor(s.budget, s.forecast, s.type) }));
    const thr = alertPct();
    const alerting = rows.filter(r => !PRS.isIncome(r.type) && r.budget > 0 && r.forecast > r.budget * (1 + thr / 100));
    body.append(kpis([{ label: 'Días transcurridos', value: `${el_} de ${days}`, sub: `Al ${F.date(G.TODAY)}` }, { label: 'Gasto real a la fecha', value: m0(e.actual), sub: `Presupuesto del mes ${m0(e.budget)}` }, { label: 'Gasto proyectado al cierre', value: m0(e.forecast), sub: `KPI-PRS-04: ${pctTxt(PRS.pct(e.forecast, e.budget))}`, tone: { GREEN: 'ok', AMBER: 'warn', RED: 'bad' }[PRS.lightFor(e.budget, e.forecast, 'EXPENSE')] }, { label: 'Ingresos proyectados', value: m0(i.forecast), sub: `${pctTxt(PRS.pct(i.forecast, i.budget))} de ${m0(i.budget)}`, tone: { GREEN: 'ok', AMBER: 'warn', RED: 'bad' }[PRS.lightFor(i.budget, i.forecast, 'INCOME')] }, { label: `Superan +${thr} % (RN-PRS-10)`, value: alerting.length, tone: alerting.length ? 'bad' : 'ok', onClick: () => G.go('PRS-10') }]));
    body.append(pills([['concept', 'Por concepto'], ['line', 'Por línea presupuestal']], st.by, x => { st.by = x; G.refresh(); }));
    const openKeys = new Set(G.db.where('budget_alerts', a => a.version_id === ap.id && a.period === m && ['OPEN', 'ACK'].includes(a.status)).map(a => a.concept_id + (st.by === 'line' ? '|' + a.slot_key : '')));
    body.append(table({ id: 'prs08' + st.by, pageSize: 40, columns: [
      { key: 'c', label: 'Concepto', value: r => `${PRS.cCode(r.concept_id)} · ${PRS.cName(r.concept_id)}`, render: r => h('div', null, h('div', null, `${PRS.cCode(r.concept_id)} · ${PRS.cName(r.concept_id)}`), st.by === 'line' ? h('div', { class: 'small muted' }, PRS.dimText(r)) : null) },
      { key: 'm', label: 'Método', value: r => PRS.isFixed(r.concept_id) ? 'Fijo: presupuesto' : `Lineal: ${el_}/${days} días` },
      { key: 'budget', label: 'Presupuesto', align: 'r', render: r => m0(r.budget) }, { key: 'actual', label: 'Real a la fecha', align: 'r', render: r => m0(r.actual) },
      { key: 'forecast', label: 'Proyección', align: 'r', render: r => h('b', null, m0(r.forecast)) },
      { key: 'fpct', label: '% vs ppto.', align: 'r', value: r => r.fpct ?? -1, render: r => pctTxt(r.fpct) },
      { key: 'light', label: 'Semáforo', value: r => ({ GREEN: 3, AMBER: 2, RED: 1 }[r.light] || 0), render: r => lBadge(r.light) },
      { key: 'al', label: 'Alerta', sort: false, render: r => { const k = r.concept_id + (st.by === 'line' ? '|' + r.key : ''); const exc = !PRS.isIncome(r.type) && r.budget > 0 && r.forecast > r.budget * (1 + thr / 100); return openKeys.has(k) ? badge('Alerta abierta', 'bad') : exc ? badge(`> +${thr} %`, 'bad') : ''; } }],
      rows, onRow: r => G.go('PRS-07', { concept: r.concept_id, month: m, mode: 'MONTH' }), filters: [{ key: 'light', label: 'Semáforo', options: [['GREEN', 'Verde'], ['AMBER', 'Ámbar'], ['RED', 'Rojo']] }, { key: 'type', label: 'Tipo', options: TYPES }] }));
    const top = PRS.aggregate(slots, 'concept').filter(r => r.budget > 0 && !PRS.isIncome(r.type)).sort((a, b) => (b.fpct || 0) - (a.fpct || 0)).slice(0, 10);
    const saved = U.groupBy(G.db.where('budget_forecasts', f => f.period === m && f.version_id === ap.id), 'run_id');
    const sv = Object.values(saved).map(fs => ({ run: fs[0].run_id, as_of: fs[0].as_of, at: fs[0].created_at, exp: R(U.sum(fs.filter(f => PRS.typeOf(f.concept_id) !== 'INCOME'), f => f.forecast)), inc: R(U.sum(fs.filter(f => PRS.typeOf(f.concept_id) === 'INCOME'), f => f.forecast)), b: R(U.sum(fs.filter(f => PRS.typeOf(f.concept_id) !== 'INCOME'), f => f.budget)) })).sort(U.by('at', -1));
    body.append(h('div', { class: 'grid c2' }, card('Proyección / presupuesto: los 10 gastos más exigidos', G.ui.chart.hbar({ items: top.map(r => ({ label: PRS.cName(r.concept_id), value: r.fpct || 0, tone: { GREEN: 'ok', AMBER: 'warn', RED: 'bad' }[r.light] })), format: v => pctTxt(v) })),
      card('Proyecciones guardadas', sv.length ? table({ id: 'prs08s', search: false, columns: [{ key: 'as_of', label: 'Al día', render: r => F.date(r.as_of) }, { key: 'exp', label: 'Gasto proyectado', align: 'r', render: r => m0(r.exp) }, { key: 'p', label: '% ppto.', align: 'r', render: r => pctTxt(PRS.pct(r.exp, r.b)) }, { key: 'inc', label: 'Ingreso proyectado', align: 'r', render: r => m0(r.inc) }], rows: sv }) : empty('Aún no se guarda ninguna proyección de este mes.'), { flush: true })));
  }

  /* ---------- PRS-09 Comparativo de versiones ---------- */
  function scr09(el, params = {}) {
    const st = ui.s09 = ui.s09 || {};
    if (params.b) { st.b = params.b; st.a = null; }
    const all = G.db.all('budget_versions');
    if (!st.b || !PRS.version(st.b)) st.b = (all.find(v => v.status === 'SUBMITTED') || all.find(v => v.status === 'APPROVED') || {}).id;
    const vb = PRS.version(st.b);
    if (!st.a || !PRS.version(st.a)) { const ap = vb ? PRS.approved(vb.budget_id) : null; st.a = ap && ap.id !== st.b ? ap.id : (vb && vb.based_on_version_id) || (all.find(v => v.id !== st.b) || {}).id; }
    const va = PRS.version(st.a);
    const body = page(el, { code: 'PRS-09', title: 'Comparativo de versiones', sub: 'Diferencias entre dos versiones por concepto y mes, en soles sin IGV. Útil para revisar una revisión antes de aprobarla o comparar años.' });
    body.append(h('div', { class: 'grid c2' }, sel(versionOpts(), st.a, x => { st.a = x; G.refresh(); }, 'Versión A (base)'), sel(versionOpts(), st.b, x => { st.b = x; G.refresh(); }, 'Versión B (comparada)')));
    if (!va || !vb) { body.append(empty('Elige dos versiones.')); return; }
    const d = PRS.diffVersions(va.id, vb.id); const ta = PRS.totals(va.id), tb = PRS.totals(vb.id);
    body.append(kpis([{ label: 'Ingresos A → B', value: `${m0(ta.income)} → ${m0(tb.income)}`, sub: `${tb.income - ta.income >= 0 ? '+' : ''}${m0(R(tb.income - ta.income))}` }, { label: 'Costo + gasto A → B', value: `${m0(ta.spend)} → ${m0(tb.spend)}`, sub: `${tb.spend - ta.spend >= 0 ? '+' : ''}${m0(R(tb.spend - ta.spend))}`, tone: tb.spend > ta.spend ? 'warn' : 'ok' }, { label: 'Resultado A → B', value: `${m0(ta.result)} → ${m0(tb.result)}`, tone: tb.result >= ta.result ? 'ok' : 'bad' }, { label: 'Conceptos con cambios', value: d.filter(r => Math.abs(r.diff) >= 0.5).length, sub: `de ${d.length}` }]));
    st.c = st.c && d.find(r => r.concept_id === st.c) ? st.c : (d.filter(r => Math.abs(r.diff) >= 0.5).sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))[0] || d[0] || {}).concept_id;
    body.append(table({ id: 'prs09', pageSize: 40, columns: [{ key: 'c', label: 'Concepto', value: r => `${PRS.cCode(r.concept_id)} · ${PRS.cName(r.concept_id)}`, render: r => h('span', { style: { fontWeight: r.concept_id === st.c ? 700 : 400 } }, `${PRS.cCode(r.concept_id)} · ${PRS.cName(r.concept_id)}`) }, { key: 'type', label: 'Tipo', value: r => lbl(TYPES, r.type) }, { key: 'a', label: PRS.vLabel(va), align: 'r', render: r => m0(r.a) }, { key: 'b', label: PRS.vLabel(vb), align: 'r', render: r => m0(r.b) }, { key: 'diff', label: 'Diferencia', align: 'r', render: r => h('b', { style: { color: Math.abs(r.diff) < 1 ? 'var(--muted)' : (r.diff > 0) !== PRS.isIncome(r.type) ? 'var(--bad)' : 'var(--ok)' } }, `${r.diff > 0 ? '+' : ''}${F.num(r.diff, 0)}`) }, { key: 'pct', label: '%', align: 'r', render: r => r.pct === null ? (r.b ? badge('Nuevo', 'info') : '—') : `${r.pct > 0 ? '+' : ''}${F.num(r.pct, 1)} %` }],
      rows: d, onRow: r => { st.c = r.concept_id; G.refresh(); }, filters: [{ key: 'type', label: 'Tipo', options: TYPES }],
      footer: ['Costo + gasto', '', { v: m0(ta.spend), align: 'r' }, { v: m0(tb.spend), align: 'r' }, { v: h('b', null, `${tb.spend - ta.spend >= 0 ? '+' : ''}${F.num(R(tb.spend - ta.spend), 0)}`), align: 'r' }, ''] }));
    const rc = d.find(r => r.concept_id === st.c);
    if (rc) {
      const labels = Array.from({ length: 12 }, (_, i) => G.date.monthName(PRS.monthsOf(PRS.yearOfVersion(vb))[i]).slice(0, 3));
      body.append(card(`${PRS.cName(rc.concept_id)} por mes`, h('div', { class: 'stack' }, G.ui.chart.bar({ labels, series: [{ name: PRS.vLabel(va), values: rc.ma }, { name: PRS.vLabel(vb), values: rc.mb }], format: m0 }),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, ''), labels.map(l => h('th', { class: 'r' }, l)))), h('tbody', null,
          h('tr', null, h('td', null, PRS.vLabel(va)), rc.ma.map(x => h('td', { class: 'r num small' }, F.num(x, 0)))),
          h('tr', null, h('td', null, PRS.vLabel(vb)), rc.mb.map(x => h('td', { class: 'r num small' }, F.num(x, 0)))),
          h('tr', null, h('td', null, h('b', null, 'Diferencia')), rc.mb.map((x, i) => { const df = R(x - rc.ma[i]); return h('td', { class: 'r num small', style: { color: Math.abs(df) < 1 ? 'var(--muted)' : (df > 0) !== PRS.isIncome(rc.type) ? 'var(--bad)' : 'var(--ok)' } }, h('b', null, `${df > 0 ? '+' : ''}${F.num(df, 0)}`)); }))))))));
    }
  }

  /* ---------- PRS-10 Alertas de desviación ---------- */
  function alertDrawer(id) {
    const a = G.db.get('budget_alerts', id); if (!a) return;
    drawer(`${PRS.cName(a.concept_id)} · ${G.date.monthName(a.period)}`, (b, close) => {
      b.append(h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, aBadge(a.status), lBadge(a.level === 'AMBER' ? 'AMBER' : 'RED'), badge(PRS.vLabel(PRS.version(a.version_id)), 'primary')));
      b.append(dl([['Línea', PRS.dimText(a)], ['Responsable', a.owner_user_id ? G.userName(a.owner_user_id) : '—'], ['Avisados', (a.notified || []).map(G.userName).join(', ')], ['Presupuesto del mes', F.money(a.budget)], ['Real al día', `${F.money(a.actual)} (día ${a.days_elapsed} de ${PRS.daysIn(a.period)}, al ${F.date(a.as_of)})`], ['Proyección', `${F.money(a.forecast)} · ${pctTxt(a.pct)}`], ['Exceso proyectado', F.money(R(a.forecast - a.budget))], ['Generada', F.datetime(a.raised_at || a.created_at)]]));
      b.append(card('Comentarios y acciones', h('div', { class: 'stack' }, (a.comments || []).length ? timeline((a.comments || []).map(c => ({ at: c.at, action: c.text, user: c.user }))) : empty('Sin comentarios aún.'),
        ['OPEN', 'ACK'].includes(a.status) ? form({ id: 'prs-ac', fields: [{ key: 'text', label: 'Comentario o acción', type: 'textarea', required: true }, { key: 'status', label: 'Estado después', type: 'select', options: [['ACK', 'En seguimiento'], ['CLOSED', 'Cerrar alerta'], ['OPEN', 'Sigue abierta']], required: true }], values: { status: 'ACK' }, submitLabel: 'Registrar', onSubmit: v => { try { PRS.commentAlert(a.id, v.text, { status: v.status }); toast('Comentario registrado', 'ok'); close(); G.refresh(); alertDrawer(a.id); return true; } catch (e) { return e.message; } } }) : null)));
      b.append(h('div', { class: 'row', style: 'gap:8px' }, btn('Ver detalle del real', () => { close(); G.go('PRS-07', { concept: a.concept_id, month: a.period, mode: 'MONTH' }); }, { sm: true })));
    }, { code: 'PRS-10' });
  }
  function scr10(el) {
    const st = ui.s10 = ui.s10 || {};
    const m = G.date.month(G.TODAY); const ap = PRS.approvedFor(PRS.yearOf(m));
    const body = page(el, { code: 'PRS-10', title: 'Alertas de desviación', sub: `Conceptos en ámbar o rojo, responsables notificados y comentarios. Se alerta cuando la proyección supera el presupuesto en más de ${alertPct()} % (RN-PRS-10).`, actions: ap ? [{ label: 'Reevaluar el mes', kind: 'primary', disabled: !G.can('prs.report.view_all'), onClick: () => tryDo(() => PRS.runAlerts(ap.id, m), r => `${r.length} alerta(s) activas en ${G.date.monthName(m)}`) }] : [] });
    const all = G.db.all('budget_alerts').filter(a => PRS.visible(a)).sort(U.by('raised_at', -1));
    const open = all.filter(a => a.status === 'OPEN'), ack = all.filter(a => a.status === 'ACK');
    body.append(kpis([{ label: 'Abiertas', value: open.length, tone: open.length ? 'bad' : 'ok' }, { label: 'En seguimiento', value: ack.length, tone: ack.length ? 'warn' : '' }, { label: 'Exceso proyectado abierto', value: m0(U.sum(open.concat(ack), a => Math.max(0, a.forecast - a.budget))) }, { label: 'Responsables avisados', value: new Set(open.concat(ack).flatMap(a => a.notified || [])).size }, { label: 'Cerradas o resueltas', value: all.filter(a => ['CLOSED', 'RESOLVED'].includes(a.status)).length }]));
    const sc = scopeNote(); if (sc) body.append(sc);
    body.append(table({ id: 'prs10', columns: [
      { key: 'period', label: 'Mes', value: a => a.period, render: a => G.date.monthName(a.period) },
      { key: 'c', label: 'Concepto', value: a => PRS.cName(a.concept_id), render: a => h('div', null, h('div', null, PRS.cName(a.concept_id)), h('div', { class: 'small muted' }, PRS.dimText(a))) },
      { key: 'level', label: 'Nivel', render: a => lBadge(a.level === 'AMBER' ? 'AMBER' : 'RED') },
      { key: 'budget', label: 'Presupuesto', align: 'r', render: a => m0(a.budget) }, { key: 'actual', label: 'Real', align: 'r', render: a => m0(a.actual) },
      { key: 'forecast', label: 'Proyección', align: 'r', render: a => h('b', null, m0(a.forecast)) }, { key: 'pct', label: '%', align: 'r', render: a => pctTxt(a.pct) },
      { key: 'owner', label: 'Responsable', value: a => a.owner_user_id ? G.userName(a.owner_user_id) : '—' },
      { key: 'com', label: 'Comentarios', align: 'r', value: a => (a.comments || []).length },
      { key: 'status', label: 'Estado', value: a => a.status, render: a => aBadge(a.status) }],
      rows: all, onRow: a => alertDrawer(a.id), filters: [{ key: 'status', label: 'Estado', options: Object.entries(AST).map(([k, v]) => [k, v[0]]) }, { key: 'period', label: 'Mes', options: [...new Set(all.map(a => a.period))].map(p => [p, G.date.monthName(p)]) }], empty: 'No hay alertas.' }));
    if (ap) {
      const ex = PRS.execution(ap.id, [m]); const ag = PRS.aggregate(ex.slots.filter(PRS.visible), 'cc').filter(x => ['AMBER', 'RED'].includes(x.light));
      body.append(card(`Semáforo actual de ${G.date.monthName(m)}: ámbar y rojo por centro de costo`, ag.length ? table({ id: 'prs10s', search: false, pageSize: 15, columns: [{ key: 'c', label: 'Concepto', value: r => PRS.cName(r.concept_id) }, { key: 'dv', label: 'Centro de costo', value: r => PRS.dimName('cc', r.dim_value) }, { key: 'o', label: 'Responsable', value: r => r.dim_value ? G.userName(PRS.ownerOf(r.dim_value)) : '—' }, { key: 'budget', label: 'Presupuesto', align: 'r', render: r => m0(r.budget) }, { key: 'forecast', label: 'Proyección', align: 'r', render: r => m0(r.forecast) }, { key: 'light', label: 'Semáforo', render: r => lightCell(r.light, r.fpct) }], rows: ag, onRow: r => G.go('PRS-07', { concept: r.concept_id, month: m, dim: 'cc', dv: r.dim_value || '' }) }) : empty('Todo en verde.'), { flush: true }));
    }
  }

  /* ------------------------------------------------------------------
     Registro
     ------------------------------------------------------------------ */
  G.register({ code: MOD, name: (G.SPEC && G.SPEC.PRS && G.SPEC.PRS.name) || 'Presupuesto', phase: 3, group: 'Finanzas', screens: [
    { code: 'PRS-01', name: 'Presupuestos', render: scr01 },
    { code: 'PRS-02', name: 'Conceptos presupuestales', render: scr02 },
    { code: 'PRS-03', name: 'Edición de versión', render: scr03 },
    { code: 'PRS-04', name: 'Carga y copia', render: scr04 },
    { code: 'PRS-05', name: 'Envío y aprobación', render: scr05 },
    { code: 'PRS-06', name: 'Real frente a presupuesto', render: scr06 },
    { code: 'PRS-07', name: 'Detalle del real', render: scr07 },
    { code: 'PRS-08', name: 'Proyección de cierre', render: scr08 },
    { code: 'PRS-09', name: 'Comparativo de versiones', render: scr09 },
    { code: 'PRS-10', name: 'Alertas de desviación', render: scr10 },
  ] });

  /* ------------------------------------------------------------------
     Datos de ejemplo: 2026 aprobado (v1 reemplazada, v2 vigente, v3 por
     aprobar), 2027 en borrador, snapshots ene–ago, proyecciones y alertas
     ------------------------------------------------------------------ */
  G.seed(72, function seedPRS() {
    const r = U.rng(72072);
    const ins = (t, row) => G.db.insert(t, row, { silent: true });
    const U_ADM = (G.db.find('users', u => u.role === 'ADMINISTRACION') || {}).id, U_GER = (G.db.find('users', u => u.role === 'GERENTE') || {}).id, U_CNT = (G.db.find('users', u => u.role === 'CONTADORA') || {}).id;
    const U_MKT = (G.db.find('users', u => u.role === 'MARKETING') || {}).id, U_COO = (G.db.find('users', u => u.role === 'COORDINADOR_DELIVERY') || {}).id, U_PRO = (G.db.find('users', u => u.role === 'JEFE_PRODUCCION') || {}).id;
    // conceptos: [código, nombre, grupo, tipo, comportamiento, centro sugerido]
    const C = [
      ['ING', 'Ingresos', null, 'INCOME'], ['ING-VTA', 'Ventas de productos', 'ING', 'INCOME', 'VARIABLE', 'cc-VEN-DG'],
      ['COS', 'Costo de ventas', null, 'COST_OF_SALES'], ['COS-VTA', 'Costo de los productos vendidos', 'COS', 'COST_OF_SALES', 'VARIABLE', 'cc-VEN-DG'],
      ['GPE', 'Gastos de personal', null, 'EXPENSE'], ['GPE-PLA', 'Planilla y cargas sociales', 'GPE', 'EXPENSE', 'FIXED', 'cc-ADM'], ['GPE-COM', 'Comisiones y bonos por entrega', 'GPE', 'EXPENSE', 'VARIABLE', 'cc-VEN-DG'], ['GPE-CAP', 'Capacitación del personal', 'GPE', 'EXPENSE', 'VARIABLE', 'cc-RRHH'],
      ['PUB', 'Publicidad y marketing', null, 'EXPENSE'], ['PUB-PLA', 'Publicidad en plataformas', 'PUB', 'EXPENSE', 'VARIABLE', 'cc-MKT-DG'], ['PUB-CRE', 'Creadores de contenido', 'PUB', 'EXPENSE', 'VARIABLE', 'cc-MKT-DG'], ['PUB-MUE', 'Muestras y degustaciones', 'PUB', 'EXPENSE', 'VARIABLE', 'cc-VEN-DG'],
      ['DLV', 'Delivery y reparto', null, 'EXPENSE'], ['DLV-COM', 'Combustible', 'DLV', 'EXPENSE', 'VARIABLE', 'cc-DEL'], ['DLV-ALQ', 'Alquiler de vehículos', 'DLV', 'EXPENSE', 'FIXED', 'cc-DEL'], ['DLV-VEH', 'Mantenimiento, SOAT, peajes y multas', 'DLV', 'EXPENSE', 'VARIABLE', 'cc-DEL'], ['DLV-TER', 'Empresas de delivery y fletes a provincia', 'DLV', 'EXPENSE', 'VARIABLE', 'cc-DEL'], ['DLV-REP', 'Alimentación, movilidad y jornales del reparto', 'DLV', 'EXPENSE', 'VARIABLE', 'cc-DEL'],
      ['EMP', 'Empaques e insumos', null, 'EXPENSE'], ['EMP-EMP', 'Empaques e impresiones', 'EMP', 'EXPENSE', 'VARIABLE', 'cc-PROD-L2'], ['EMP-INS', 'Insumos menores de producción', 'EMP', 'EXPENSE', 'VARIABLE', 'cc-PROD-L2'],
      ['OCU', 'Ocupación y servicios', null, 'EXPENSE'], ['OCU-ALQ', 'Alquiler de locales', 'OCU', 'EXPENSE', 'FIXED', 'cc-ADM'], ['OCU-SER', 'Luz, agua e internet', 'OCU', 'EXPENSE', 'FIXED', 'cc-ADM'], ['OCU-MAN', 'Mantenimiento de equipos y cámaras', 'OCU', 'EXPENSE', 'VARIABLE', 'cc-PROD-L2'],
      ['ADM', 'Administración', null, 'EXPENSE'], ['ADM-GEN', 'Útiles, limpieza, trámites y otros', 'ADM', 'EXPENSE', 'VARIABLE', 'cc-ADM'], ['ADM-HON', 'Honorarios profesionales', 'ADM', 'EXPENSE', 'VARIABLE', 'cc-ADM'],
    ];
    const T0 = '2025-11-20T09:00';
    C.forEach(([code, name, parent, type, beh, cc], i) => ins('budget_concepts', { id: 'bc-' + code, code, name, parent_id: parent ? 'bc-' + parent : null, is_group: !parent, concept_type: type, behavior: parent ? beh : null, default_cost_center_id: cc || null, status: 'ACTIVE', sort_order: (i + 1) * 10, created_at: T0 }));
    const MAP = [['ING-VTA', 'SALES', null], ['COS-VTA', 'COST_OF_SALES', null], ['GPE-PLA', 'PAYROLL', 'PAYROLL'], ['GPE-COM', 'PAYROLL', 'COMMISSION'], ['GPE-COM', 'PAYROLL', 'BONUS'],
      ['PUB-PLA', 'EXPENSE_CATEGORY', 'gc-PUB-ANUN'], ['PUB-CRE', 'EXPENSE_CATEGORY', 'gc-PUB-CREA'], ['PUB-MUE', 'EXPENSE_CATEGORY', 'gc-COM-MUE'],
      ['DLV-COM', 'EXPENSE_CATEGORY', 'gc-DEL-COMB'], ['DLV-ALQ', 'EXPENSE_CATEGORY', 'gc-DEL-ALQ'], ['DLV-VEH', 'EXPENSE_CATEGORY', 'gc-DEL-MANT'], ['DLV-VEH', 'EXPENSE_CATEGORY', 'gc-DEL-SOAT'], ['DLV-VEH', 'EXPENSE_CATEGORY', 'gc-DEL-PEAJE'], ['DLV-VEH', 'EXPENSE_CATEGORY', 'gc-DEL-MULTA'],
      ['DLV-TER', 'EXPENSE_CATEGORY', 'gc-DEL-EMP'], ['DLV-TER', 'EXPENSE_CATEGORY', 'gc-DEL-PROV'], ['DLV-REP', 'EXPENSE_CATEGORY', 'gc-DEL-ALIM'], ['DLV-REP', 'EXPENSE_CATEGORY', 'gc-DEL-MOV'], ['DLV-REP', 'EXPENSE_CATEGORY', 'gc-DEL-JOR'],
      ['EMP-EMP', 'EXPENSE_CATEGORY', 'gc-INS-EMP'], ['EMP-INS', 'EXPENSE_CATEGORY', 'gc-PRO-INS'], ['OCU-ALQ', 'EXPENSE_CATEGORY', 'gc-ALQ-LOC'], ['OCU-SER', 'EXPENSE_CATEGORY', 'gc-SER-LUZ'], ['OCU-SER', 'EXPENSE_CATEGORY', 'gc-SER-AGUA'], ['OCU-SER', 'EXPENSE_CATEGORY', 'gc-SER-INT'], ['OCU-MAN', 'EXPENSE_CATEGORY', 'gc-EQU-MAN'],
      ['ADM-GEN', 'EXPENSE_CATEGORY', 'gc-ADM-UTI'], ['ADM-GEN', 'EXPENSE_CATEGORY', 'gc-ADM-TRA'], ['ADM-GEN', 'EXPENSE_CATEGORY', 'gc-OTR'], ['ADM-HON', 'ACCOUNT', '6321']];
    MAP.forEach(([c, s, ref], i) => ins('budget_concept_mappings', { id: `bcm-${U.pad(i + 1, 3)}`, concept_id: 'bc-' + c, source: s, ref, note: s === 'ACCOUNT' ? 'Asesoría y consultoría (PCGE 6321); real desde CNT' : null, status: 'ACTIVE', created_by: U_CNT, created_at: T0 }));
    // líneas base (importe de octubre; las variables siguen la estacionalidad)
    const SEAS = [0.90, 0.86, 0.93, 0.95, 1.00, 0.97, 1.03, 0.98, 0.99, 1.00, 1.03, 1.20];
    const BASE = [
      ['ING-VTA', 'br-DG', null, 'cc-VEN-DG', 62000], ['ING-VTA', 'br-M2', null, 'cc-VEN-M2', 10800], ['ING-VTA', 'br-M3', null, 'cc-VEN-M3', 6800], ['ING-VTA', 'br-M4', null, 'cc-VEN-M4', 3300], ['ING-VTA', 'br-M5', null, 'cc-VEN-M5', 6600],
      ['COS-VTA', 'br-DG', null, 'cc-VEN-DG', 44600], ['COS-VTA', 'br-M2', null, 'cc-VEN-M2', 7800], ['COS-VTA', 'br-M3', null, 'cc-VEN-M3', 3700], ['COS-VTA', 'br-M4', null, 'cc-VEN-M4', 1750], ['COS-VTA', 'br-M5', null, 'cc-VEN-M5', 3400],
      ['GPE-COM', null, 'es-L1', 'cc-VEN-DG', 2400], ['GPE-COM', null, 'es-L1', 'cc-DEL', 950],
      ['PUB-PLA', 'br-DG', null, 'cc-MKT-DG', 6000], ['PUB-PLA', 'br-M2', null, 'cc-MKT-M2', 600], ['PUB-PLA', 'br-M3', null, 'cc-MKT-M3', 500], ['PUB-PLA', 'br-M4', null, 'cc-MKT-M4', 400], ['PUB-PLA', 'br-M5', null, 'cc-MKT-M5', 1100],
      ['PUB-CRE', 'br-DG', null, 'cc-MKT-DG', 800], ['PUB-CRE', 'br-M2', null, 'cc-MKT-M2', 1500], ['PUB-MUE', 'br-DG', 'es-L1', 'cc-VEN-DG', 150],
      ['DLV-COM', null, 'es-L1', 'cc-DEL', 1900], ['DLV-COM', null, 'es-L2', 'cc-DEL', 350], ['DLV-ALQ', null, 'es-L2', 'cc-DEL', 1170], ['DLV-VEH', null, 'es-L1', 'cc-DEL', 520], ['DLV-VEH', null, 'es-L2', 'cc-DEL', 80],
      ['DLV-TER', null, 'es-L1', 'cc-DEL', 2600], ['DLV-REP', null, 'es-L1', 'cc-DEL', 160], ['DLV-REP', null, 'es-L2', 'cc-DEL', 110],
      ['EMP-EMP', null, 'es-L2', 'cc-PROD-L2', 1500], ['EMP-INS', null, 'es-L2', 'cc-PROD-L2', 100],
      ['OCU-ALQ', null, 'es-L1', 'cc-ADM', 4500], ['OCU-ALQ', null, 'es-L2', 'cc-PROD-L2', 3000], ['OCU-SER', null, 'es-L1', 'cc-ADM', 470], ['OCU-SER', null, 'es-L1', 'cc-PROD-L1', 1650], ['OCU-SER', null, 'es-L2', 'cc-PROD-L2', 2620], ['OCU-MAN', null, 'es-L2', 'cc-PROD-L2', 600],
      ['ADM-GEN', null, 'es-L1', 'cc-ADM', 250],
    ];
    // planilla presupuestada por centro de costo (sueldo × 1,215 de los trabajadores activos)
    const pay = {}; for (const e of G.db.where('employees', e => e.status === 'ACTIVE' && e.monthly_salary)) { const cc = PRS.ccForEmployee(e); pay[cc] = (pay[cc] || 0) + e.monthly_salary * 1.215; }
    for (const [cc, v] of Object.entries(pay).sort()) BASE.push(['GPE-PLA', null, (G.db.get('cost_centers', cc) || {}).establishment_id || null, cc, Math.round(v / 10) * 10]);
    const months26 = PRS.monthsOf(2026), months27 = PRS.monthsOf(2027);
    const amountFor = (b, i, ver) => {
      const [code, brand] = b; let a = b[4];
      if (!PRS.isFixed('bc-' + code)) a = a * SEAS[i];
      if (ver === 1 || (ver >= 2 && i < 6)) { if (code === 'PUB-PLA' && brand === 'br-DG') a = 4500 * SEAS[i]; if (code === 'ING-VTA' && brand === 'br-DG') a = a * 0.95; if (code === 'DLV-TER') a = 2200 * SEAS[i]; }
      if (ver === 3 && i >= 10) { if (code === 'PUB-PLA' && brand === 'br-DG') a = 7500 * SEAS[i]; if (code === 'ING-VTA' && brand === 'br-DG') a = a * 1.06; if (code === 'DLV-TER') a = 3200 * SEAS[i]; if (code === 'GPE-COM' && b[3] === 'cc-VEN-DG') a = 2800 * SEAS[i]; }
      return Math.round(a / 10) * 10;
    };
    const B26 = ins('budgets', { id: 'bud-2026', company_id: 'co-dg', year: 2026, name: 'Presupuesto 2026', status: 'ACTIVE', current_version_id: 'bv-2026-2', created_by: U_ADM, created_at: '2025-11-20T09:00' });
    const V = (id, no, name, status, o) => ins('budget_versions', Object.assign({ id, budget_id: o.budget_id || B26.id, version_no: no, name, status, based_on_version_id: null, source: 'MANUAL', adjust_pct: 0, created_by: U_ADM, submitted_by: null, submitted_at: null, approved_by: null, approved_at: null, decision_comment: null }, o));
    V('bv-2026-1', 1, 'Presupuesto inicial 2026', 'SUPERSEDED', { created_at: '2025-11-20T09:00', submitted_by: U_ADM, submitted_at: '2025-12-12T17:40', approved_by: U_GER, approved_at: '2025-12-18T10:15', decision_comment: 'Aprobado. Revisar publicidad a mitad de año según resultados de Meta.', superseded_at: '2026-07-14T11:20', superseded_by_version_id: 'bv-2026-2', source: 'COPY_ACTUAL', adjust_pct: 6,
      history: [{ at: '2025-11-20T09:00', action: 'Creada desde el real 2025 +6 %', user: G.userName(U_ADM) }, { at: '2025-12-12T17:40', action: 'Enviada a aprobación', user: G.userName(U_ADM) }, { at: '2025-12-18T10:15', action: 'Aprobada · versión vigente', user: G.userName(U_GER), note: 'Revisar publicidad a mitad de año.' }, { at: '2026-07-14T11:20', action: 'Reemplazada por 2026 · v2', user: G.userName(U_GER) }] });
    V('bv-2026-2', 2, 'Reproyección de julio: más pauta para Don Guando', 'APPROVED', { created_at: '2026-07-06T10:00', based_on_version_id: 'bv-2026-1', source: 'COPY_VERSION', submitted_by: U_ADM, submitted_at: '2026-07-10T16:05', approved_by: U_GER, approved_at: '2026-07-14T11:20', decision_comment: 'Sube Meta y Google de Don Guando a S/ 6 000 desde julio; ventas +5 %.',
      history: [{ at: '2026-07-06T10:00', action: 'Creada como revisión de 2026 · v1', user: G.userName(U_ADM) }, { at: '2026-07-10T16:05', action: 'Enviada a aprobación', user: G.userName(U_ADM), note: 'Publicidad DG de 4 500 a 6 000; tercerizado de delivery 2 600' }, { at: '2026-07-14T11:20', action: 'Aprobada · versión vigente', user: G.userName(U_GER) }] });
    V('bv-2026-3', 3, 'Ajuste de campaña navideña (nov–dic)', 'SUBMITTED', { created_at: '2026-10-06T09:30', based_on_version_id: 'bv-2026-2', source: 'COPY_VERSION', submitted_by: U_ADM, submitted_at: '2026-10-08T18:10',
      history: [{ at: '2026-10-06T09:30', action: 'Creada como revisión de 2026 · v2', user: G.userName(U_ADM) }, { at: '2026-10-08T18:10', action: 'Enviada a aprobación', user: G.userName(U_ADM), note: 'Navidad: pauta DG 7 500, ventas DG +6 %, más tercerizado y comisiones en nov–dic' }] });
    let ln = 0;
    for (const [vid, ver] of [['bv-2026-1', 1], ['bv-2026-2', 2], ['bv-2026-3', 3]]) for (const b of BASE) months26.forEach((m, i) => { ln++; ins('budget_lines', { id: `bl-${vid.slice(3)}-${U.pad(ln, 5)}`, version_id: vid, concept_id: 'bc-' + b[0], month: m, brand_id: b[1], establishment_id: b[2], cost_center_id: b[3], amount: amountFor(b, i, ver), note: null, created_at: '2025-11-20T09:00' }); });
    // snapshots de ene–ago (meses cerrados): real congelado al cierre
    const v2 = PRS.linesOf('bv-2026-2');
    const salesF = {};
    for (const [mi, m] of months26.slice(0, 8).entries()) {
      const fa = G.date.add(PRS.monthEnd(m), 8) + 'T18:00';
      const rows = [];
      for (const l of v2.filter(x => x.month === m)) {
        const c = PRS.concept(l.concept_id); let f;
        if (c.concept_type === 'INCOME') { f = 0.92 + r() * 0.15; salesF[l.brand_id + m] = f; }
        else if (c.concept_type === 'COST_OF_SALES') f = (salesF[l.brand_id + m] || 1) * (0.98 + r() * 0.05);
        else if (c.behavior === 'FIXED') f = c.code === 'OCU-SER' ? 0.9 + r() * 0.18 : c.code === 'GPE-PLA' ? 0.97 + r() * 0.04 : 1;
        else f = 0.8 + r() * 0.38;
        if (c.code === 'PUB-PLA' && l.brand_id === 'br-DG' && mi >= 5) f = 1.04 + r() * 0.12;
        rows.push({ concept_id: l.concept_id, brand_id: l.brand_id, establishment_id: l.establishment_id, cost_center_id: l.cost_center_id, amount: R(l.amount * f), source: c.concept_type === 'EXPENSE' ? (c.code.startsWith('GPE') ? 'PER' : 'GAS') : 'FAC' });
      }
      PRS.freeze(m, { rows, reason: `Cierre del período ${G.date.monthName(m)} (period.closed)`, user_id: U_CNT, at: fa });
      if (mi === 7) { const rows2 = rows.map(x => Object.assign({}, x, { amount: x.concept_id === 'bc-OCU-SER' && x.cost_center_id === 'cc-PROD-L2' ? R(x.amount + 380) : x.amount })); PRS.freeze(m, { rows: rows2, reason: 'Recálculo: factura de luz de agosto del Local 2 registrada después del cierre', user_id: U_CNT, at: '2026-09-15T12:30' }); }
    }
    // presupuesto 2027 en borrador: real 2026 +8 % (meses cerrados, real, proyección y presupuesto)
    const B27 = ins('budgets', { id: 'bud-2027', company_id: 'co-dg', year: 2027, name: 'Presupuesto 2027', status: 'ACTIVE', current_version_id: null, created_by: U_ADM, created_at: '2026-10-09T15:00' });
    V('bv-2027-1', 1, 'Borrador 2027 desde el real 2026 +8 %', 'DRAFT', { budget_id: B27.id, created_at: '2026-10-09T15:00', history: [{ at: '2026-10-09T15:00', action: 'Creada', user: G.userName(U_ADM) }] });
    PRS.copyFromActual('bv-2027-1', 8, { at: '2026-10-09T15:05', user_id: U_ADM });
    for (const mo of [3, 8]) ins('budget_lines', { version_id: 'bv-2027-1', concept_id: 'bc-GPE-CAP', month: months27[mo - 1], brand_id: null, establishment_id: null, cost_center_id: 'cc-RRHH', amount: 1800, note: 'Curso BPM y manipulación de alimentos (sin mapeo aún)', created_at: '2026-10-09T15:20' });
    // proyecciones guardadas y alertas de setiembre y octubre
    PRS.saveForecast('bv-2026-2', '2026-10-01', { asOf: '2026-10-05', at: '2026-10-05T19:00' });
    PRS.saveForecast('bv-2026-2', '2026-10-01', { asOf: G.TODAY, at: G.TODAY + 'T07:00' });
    PRS.runAlerts('bv-2026-2', '2026-09-01', { asOf: '2026-09-30', at: '2026-10-01T07:00' });
    for (const a of G.db.where('budget_alerts', a => a.period === '2026-09-01')) {
      const c = PRS.cCode(a.concept_id);
      const txt = { 'PUB-CRE': [U_MKT, 'Serie de 4 videos de Renzo Parrillero para Marca 2 aprobada fuera de presupuesto; en octubre solo un video.', 'CLOSED'], 'DLV-VEH': [U_COO, 'Papeleta SAT de la furgoneta y cambio de cadena de MTB-456; se descuenta la multa al conductor (PER).', 'CLOSED'], 'OCU-MAN': [U_PRO, 'Mantenimiento correctivo de la cámara de frío de Lurín; no se repite en el trimestre.', 'CLOSED'], 'EMP-EMP': [U_PRO, 'Compra de bolsas impresas para 2 meses (stock hasta noviembre).', 'ACK'] }[c];
      if (txt) PRS.commentAlert(a.id, txt[1], { status: txt[2], at: '2026-10-03T10:30', user_id: txt[0] });
    }
    PRS.runAlerts('bv-2026-2', '2026-10-01', { asOf: G.TODAY, at: G.TODAY + 'T07:00' });
    const pa = G.db.find('budget_alerts', a => a.period === '2026-10-01' && a.concept_id === 'bc-PUB-PLA' && a.brand_id === 'br-DG');
    if (pa) PRS.commentAlert(pa.id, 'Adelantamos pauta por el Día de la Canción Criolla (31/10). Desde el 15/10 bajamos el diario de Meta CTWA a S/ 120 para cerrar cerca de S/ 6 300.', { status: 'ACK', at: G.TODAY + 'T09:20', user_id: U_MKT });
  }, 'Presupuesto 2026 aprobado y 2027 en borrador');

  /* ------------------------------------------------------------------
     Pruebas funcionales: una por criterio CA-PRS
     ------------------------------------------------------------------ */
  const asRole = async (role, fn) => { const prev = G.ctx.role, ps = G.ctx.session; G.ctx.role = role; G.ctx.session = null; try { return await fn(); } finally { G.ctx.role = prev; G.ctx.session = ps; } };
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (!String(e.message).startsWith(code)) throw new Error(`Se esperaba ${code} y llegó: ${e.message}`); return e; } throw new Error(`Se esperaba el rechazo ${code}`); };
  G.tests.push({ module: MOD, name: 'CA-PRS-01: publicidad DG S/ 6 000 en octubre con real S/ 4 800 al día 20 → proyección S/ 7 440 (124 %), rojo y alerta', fn: async () => {
    const r = PRS.evaluateSlot({ version_id: 'bv-2026-2', period: '2026-10-01', concept_id: 'bc-PUB-PLA', brand_id: 'br-DG', cost_center_id: 'cc-MKT-DG', budget: 6000, actual: 4800, asOf: '2026-10-20', at: '2026-10-20T08:00' });
    if (r.elapsed !== 20 || r.days !== 31) throw new Error(`Días ${r.elapsed}/${r.days}`);
    if (r.forecast !== 7440) throw new Error('Proyección ' + r.forecast);
    if (r.pct !== 124) throw new Error('% ' + r.pct);
    if (r.light !== 'RED') throw new Error('Semáforo ' + r.light);
    if (!r.alert || r.alert.forecast !== 7440 || !['OPEN', 'ACK'].includes(r.alert.status)) throw new Error('No se generó la alerta');
    if (!(r.alert.notified || []).includes(PRS.ownerOf('cc-MKT-DG'))) throw new Error('No se avisó al responsable del centro de costo');
  } });
  G.tests.push({ module: MOD, name: 'CA-PRS-02: cambiar el importe de una línea de una versión aprobada se rechaza con RN-PRS-04', fn: async () => {
    const l = PRS.linesOf('bv-2026-2')[0]; const before = l.amount;
    expectFail(() => PRS.updateLineAmount(l.id, before + 500), 'RN-PRS-04');
    if (G.db.get('budget_lines', l.id).amount !== before) throw new Error('La línea cambió');
  } });
  G.tests.push({ module: MOD, name: 'CA-PRS-03: con la v1 aprobada, al aprobar la v2 la v1 queda reemplazada y solo la v2 está vigente', fn: async () => {
    const b = await asRole('ADMINISTRACION', () => PRS.createBudget(2030, { name: 'Prueba CA-PRS-03' }));
    const v1 = PRS.versionsOf(b.id)[0];
    await asRole('ADMINISTRACION', () => { PRS.setLine(v1.id, { concept_id: 'bc-PUB-PLA', month: '2030-01-01', brand_id: 'br-DG', cost_center_id: 'cc-MKT-DG', amount: 5000 }); PRS.submit(v1.id); });
    await asRole('GERENTE', () => PRS.approve(v1.id));
    const v2 = await asRole('ADMINISTRACION', () => { const v = PRS.newVersion(b.id, { from_version_id: v1.id, pct: 5 }); PRS.submit(v.id); return v; });
    await asRole('GERENTE', () => PRS.approve(v2.id));
    if (PRS.version(v1.id).status !== 'SUPERSEDED') throw new Error('v1 quedó ' + PRS.version(v1.id).status);
    const ap = PRS.versionsOf(b.id).filter(v => v.status === 'APPROVED');
    if (ap.length !== 1 || ap[0].id !== v2.id) throw new Error('Vigentes: ' + ap.map(v => v.version_no).join(','));
    if (PRS.linesOf(v2.id)[0].amount !== 5250) throw new Error('La revisión no copió con +5 %');
  } });
  G.tests.push({ module: MOD, name: 'CA-PRS-04: ventas presupuestadas S/ 120 000 y reales S/ 115 000 (95,8 %) → ámbar; S/ 112 000 (93,3 %) → rojo', fn: async () => {
    const p1 = PRS.pct(115000, 120000), p2 = PRS.pct(112000, 120000);
    if (p1 !== 95.8 || p2 !== 93.3) throw new Error(`% ${p1} y ${p2}`);
    if (PRS.lightFor(120000, 115000, 'INCOME') !== 'AMBER') throw new Error('115 000 no es ámbar');
    if (PRS.lightFor(120000, 112000, 'INCOME') !== 'RED') throw new Error('112 000 no es rojo');
    if (PRS.lightFor(120000, 121000, 'INCOME') !== 'GREEN') throw new Error('121 000 no es verde');
  } });
  G.tests.push({ module: MOD, name: 'CA-PRS-05: copiar el real del año anterior con +8 % deja una línea de S/ 2 500 en S/ 2 700', fn: async () => {
    // real congelado de marzo 2026 con creadores de contenido Marca 2 = S/ 2 500 (nueva corrida, RN-PRS-09)
    const run = PRS.latestRun('2026-03-01');
    const rows = run.rows.map(x => ({ concept_id: x.concept_id, brand_id: x.brand_id, establishment_id: x.establishment_id, cost_center_id: x.cost_center_id, source: x.source, amount: x.concept_id === 'bc-PUB-CRE' && x.brand_id === 'br-M2' ? 2500 : x.amount }));
    PRS.freeze('2026-03-01', { rows, reason: 'Prueba CA-PRS-05' });
    if (PRS.runsOf('2026-03-01').length !== run.run_no + 1) throw new Error('No creó una corrida nueva');
    await asRole('ADMINISTRACION', () => PRS.copyFromActual('bv-2027-1', 8));
    const l = PRS.linesOf('bv-2027-1').find(x => x.concept_id === 'bc-PUB-CRE' && x.brand_id === 'br-M2' && x.month === '2027-03-01');
    if (!l || l.amount !== 2700) throw new Error('Línea ' + (l && l.amount));
    if (PRS.applyPct(2500, 8) !== 2700) throw new Error('applyPct');
  } });
  G.tests.push({ module: MOD, name: 'CA-PRS-06: la persona de ADMINISTRACION que envió la versión no puede aprobarla (RN-PRS-05)', fn: async () => {
    const adm = G.db.find('users', u => u.role === 'ADMINISTRACION').id;
    const v = await asRole('ADMINISTRACION', () => { const nv = PRS.newVersion('bud-2026', { from_version_id: 'bv-2026-2' }); return PRS.submit(nv.id); });
    if (v.submitted_by !== adm) throw new Error('No la envió ADMINISTRACION');
    await asRole('ADMINISTRACION', () => expectFail(() => PRS.approve(v.id), 'RN-PRS-05'));
    expectFail(() => PRS.approve(v.id, { user_id: adm }), 'RN-PRS-05');
    if (PRS.version(v.id).status !== 'SUBMITTED' || PRS.approved('bud-2026').id !== 'bv-2026-2') throw new Error('Cambió el estado');
  } });
  G.tests.push({ module: MOD, name: 'CA-PRS-07: una línea con importe −100 se rechaza con RN-PRS-11', fn: async () => {
    const n = PRS.linesOf('bv-2027-1').length;
    await asRole('ADMINISTRACION', () => expectFail(() => PRS.setLine('bv-2027-1', { concept_id: 'bc-ADM-GEN', month: '2027-01-01', establishment_id: 'es-L1', cost_center_id: 'cc-ADM', amount: -100 }), 'RN-PRS-11'));
    const r = PRS.parseImport('bv-2027-1', 'ADM-GEN;1;;L1;ADM;-100');
    if (!r.errors.length || r.errors[0].code !== 'RN-PRS-11') throw new Error('La importación no rechazó el −100');
    if (PRS.linesOf('bv-2027-1').length !== n) throw new Error('Se creó la línea');
  } });
})();
