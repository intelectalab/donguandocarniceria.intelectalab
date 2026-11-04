/* =====================================================================
   CAL · Calidad (fase 2)
   Checklists versionados por etapa, programación y tareas del día
   (RN-CAL-08, RN-CAL-13), temperaturas con excursiones (RN-CAL-04/05/14/15),
   decisiones de calidad sobre lotes (RN-CAL-01/02/03/10/17), no conformidades
   y acciones (RN-CAL-06/07), registros sanitarios (RN-CAL-09/10), reclamos
   (RN-CAL-11/12), plan HACCP y muestras de laboratorio.
   Expone G.cal.release(lotId), G.cal.decide(...), G.cal.assertSanitary(...).
   ===================================================================== */
(function () {
  const { h, btn, badge, status, page, card, table, kpis, dl, notice, drawer, modal, toast, tabs, form } = G.ui;
  const U = G.util, F = G.fmt;
  const R = (n, d = 2) => U.round(n, d);
  const T = v => (v === null || v === undefined || v === '' || isNaN(v)) ? '—' : F.num(v, 1) + ' °C';
  const userByRole = role => G.db.find('users', u => u.role === role && u.status === 'ACTIVE');
  const uidOf = role => (userByRole(role) || {}).id || null;
  const minutes = (a, b) => (Date.parse(String(a).slice(0, 19)) - Date.parse(String(b).slice(0, 19))) / 60000;
  const nowIso = () => G.date.now().slice(0, 16);

  /* ---------- catálogos y etiquetas ---------- */
  const STAGES = [['RECEPTION', 'Recepción'], ['PROCESS', 'Proceso'], ['PACKING', 'Empaque'], ['DISPATCH', 'Despacho'], ['CLEANING', 'Limpieza y desinfección'], ['BPM', 'BPM']];
  const stageName = s => (STAGES.find(x => x[0] === s) || [s, s])[1];
  const FREQS = [['PER_SHIFT', 'Por turno'], ['DAILY', 'Diaria'], ['WEEKLY', 'Semanal'], ['MONTHLY', 'Mensual']];
  const freqName = s => (FREQS.find(x => x[0] === s) || [s, s])[1];
  const ANSWER_TYPES = [['YES_NO', 'Sí / No'], ['NUMBER', 'Número con rango'], ['TEXT', 'Texto'], ['PHOTO', 'Foto']];
  const POINT_TYPES = [['COLD_ROOM', 'Cámara'], ['FREEZER', 'Congeladora'], ['POT', 'Olla o marmita'], ['VEHICLE', 'Vehículo'], ['DISPLAY', 'Exhibidora'], ['PRODUCT', 'Producto (núcleo)']];
  const ptName = s => (POINT_TYPES.find(x => x[0] === s) || [s, s])[1];
  const CONTEXTS = [['ROUTINE', 'Rutina'], ['LOADING', 'Carga de vehículo'], ['RECEPTION', 'Recepción'], ['COOKING', 'Cocción']];
  const NC_SOURCES = [['RECEPTION', 'Recepción'], ['PROCESS', 'Proceso'], ['PACKING', 'Empaque'], ['DISPATCH', 'Despacho'], ['TEMPERATURE', 'Temperatura'], ['CUSTOMER_CLAIM', 'Reclamo de cliente'], ['AUDIT', 'Auditoría'], ['SUPPLIER', 'Proveedor'], ['EQUIPMENT', 'Equipo']];
  const srcName = s => (NC_SOURCES.find(x => x[0] === s) || [s, s])[1];
  const SEVS = [['MINOR', 'Menor'], ['MAJOR', 'Mayor'], ['CRITICAL', 'Crítica']];
  const ACTION_TYPES = [['CORRECTION', 'Corrección inmediata'], ['CORRECTIVE', 'Acción correctiva'], ['PREVENTIVE', 'Acción preventiva']];
  const atName = s => (ACTION_TYPES.find(x => x[0] === s) || [s, s])[1];
  const CLAIM_TYPES = [['SPOILED', 'Producto en mal estado'], ['TEMPERATURE', 'Llegó sin frío'], ['FOREIGN_BODY', 'Cuerpo extraño'], ['WRONG_WEIGHT', 'Peso incorrecto'], ['PACKAGING', 'Empaque dañado'], ['TASTE', 'Sabor u olor'], ['LABEL', 'Etiqueta'], ['OTHER', 'Otro']];
  const claimTypeName = s => (CLAIM_TYPES.find(x => x[0] === s) || [s, s])[1];
  const RESOLUTIONS = [['REPLACEMENT', 'Reposición'], ['CREDIT_NOTE', 'Nota de crédito'], ['REFUND', 'Devolución del dinero'], ['NONE', 'Sin compensación (no procede)']];
  const DECISIONS = [['RELEASE', 'Liberar'], ['RELEASE_WITH_NOTE', 'Liberar con observación'], ['HOLD', 'Retener'], ['REJECT', 'Rechazar']];
  const decName = s => (DECISIONS.find(x => x[0] === s) || [s, s])[1];
  const MY = {
    PASS: ['Conforme', 'ok'], FAIL: ['No conforme', 'bad'], CONDITIONAL: ['Condicional', 'warn'], IN_PROGRESS: ['En curso', 'info'],
    MINOR: ['Menor', ''], MAJOR: ['Mayor', 'warn'], CRITICAL: ['Crítica', 'bad'], VERIFICATION: ['En verificación', 'warn'], INVESTIGATING: ['En investigación', 'warn'],
    RELEASE: ['Liberar', 'ok'], RELEASE_WITH_NOTE: ['Liberar c/obs.', 'warn'], HOLD: ['Retener', 'warn'], REJECT: ['Rechazar', 'bad'],
    MISSED: ['Incumplida', 'bad'], DONE: ['Hecha', 'ok'], PENDING: ['Pendiente', 'warn'], VERIFIED: ['Verificada', 'ok'],
    EXPIRING: ['Por vencer', 'warn'], SECOND: ['2.º aviso', 'bad'], NONE_REG: ['Sin registro', 'bad'],
  };
  const sb = s => MY[s] ? badge(MY[s][0], MY[s][1]) : status(s);

  /* ---------- utilidades de dominio ---------- */
  const lot = id => G.db.get('lots', id);
  const lotCode = id => (lot(id) || {}).code || '—';
  const prod = id => G.db.get('products', id);
  const isProducedLot = l => l && ['PRODUCTION', 'CUTTING'].includes(l.origin);
  const pointOf = id => G.db.get('temperature_points', id);
  const shiftOf = iso => Number(String(iso).slice(11, 13)) < 14 ? 'M' : 'T';
  const shiftName = s => ({ M: 'Mañana', T: 'Tarde', D: 'Día', W: 'Semana', X: 'Mes' }[s] || s);
  const outRange = (p, v) => (p.min_c != null && v < p.min_c) || (p.max_c != null && v > p.max_c);
  const deviation = (p, v) => p.max_c != null && v > p.max_c ? R(v - p.max_c, 2) : p.min_c != null && v < p.min_c ? R(p.min_c - v, 2) : 0;
  const rangeTxt = p => p.min_c == null && p.max_c == null ? '—' : p.min_c == null ? `≤ ${T(p.max_c)}` : p.max_c == null ? `≥ ${T(p.min_c)}` : `${F.num(p.min_c, 1)} a ${F.num(p.max_c, 1)} °C`;

  /** supervisor de la orden que produjo el lote (PRO) o el registrado en el lote */
  function lotProducers(l) {
    const out = new Set();
    if (!l) return out;
    if (l.created_by_user_id) out.add(l.created_by_user_id);
    if (l.supervisor_user_id) out.add(l.supervisor_user_id);
    const outRow = G.db.find('production_order_outputs', o => o.lot_id === l.id);
    const po = G.db.get('production_orders', (outRow && outRow.order_id) || l.production_order_id);
    if (po && po.supervisor_user_id) out.add(po.supervisor_user_id);
    return out;
  }
  function lotOrderLabel(l) {
    const outRow = G.db.find('production_order_outputs', o => o.lot_id === l.id);
    const po = G.db.get('production_orders', (outRow && outRow.order_id) || l.production_order_id);
    return po ? po.number : (l.production_order_ref || '—');
  }

  /* ---------- registros sanitarios (RN-CAL-09/10) ---------- */
  function regEffective(r, date = G.TODAY) { if (r.status === 'ACTIVE' && r.expires_on && r.expires_on < date) return 'EXPIRED'; return r.status; }
  function currentReg(productId, date = G.TODAY) {
    const rows = G.db.where('sanitary_registrations', r => r.product_id === productId && regEffective(r, date) === 'ACTIVE' && r.issued_on <= date);
    return rows.sort(U.by('expires_on', -1))[0] || null;
  }
  function sanitaryValid(productId, date = G.TODAY) {
    const p = prod(productId); if (!p) return false;
    if (!p.sanitary_authority || p.sanitary_authority === 'NONE') return true;
    const regs = G.db.where('sanitary_registrations', r => r.product_id === productId);
    if (regs.length) return !!currentReg(productId, date);
    return !!(p.sanitary_registry && (!p.sanitary_registry_expires || p.sanitary_registry_expires >= date));
  }
  /** assert_sanitary_valid: un producto DIGESA sin registro vigente no se libera ni se etiqueta (RN-CAL-10) */
  function assertSanitary(productId, date = G.TODAY, code = 'RN-CAL-10') {
    const p = prod(productId); if (!p || p.sanitary_authority !== 'DIGESA') return true;
    if (!sanitaryValid(productId, date)) {
      const last = G.db.where('sanitary_registrations', r => r.product_id === productId).sort(U.by('expires_on', -1))[0];
      G.fail(code, `${p.name} requiere registro sanitario DIGESA vigente y ${last ? `el ${last.number} venció el ${F.date(last.expires_on)}` : 'no tiene registro'}. Renuévalo en CAL-10 antes de liberar o etiquetar.`);
    }
    return true;
  }
  function registerSanitary(d) {
    if (!G.can('cal.sanitary.manage')) G.fail('RN-CAL-09', 'Registrar o renovar registros sanitarios exige el permiso cal.sanitary.manage.');
    const p = prod(d.product_id); if (!p) G.fail('RN-CAL-09', 'Elige el producto.');
    if (!String(d.number || '').trim()) G.fail('RN-CAL-09', 'Indica el número del registro o autorización.');
    if (!d.issued_on) G.fail('RN-CAL-09', 'Indica la fecha de emisión.');
    if (d.expires_on && d.expires_on <= d.issued_on) G.fail('RN-CAL-09', 'El vencimiento debe ser posterior a la emisión.');
    if (G.db.find('sanitary_registrations', r => r.product_id === p.id && r.authority === d.authority && r.number === d.number.trim())) G.fail('RN-CAL-09', `El registro ${d.number} ya existe para ${p.name}.`);
    const row = G.db.insert('sanitary_registrations', { product_id: p.id, authority: d.authority || p.sanitary_authority, registration_type: d.registration_type || 'SANITARY_REGISTRY', number: d.number.trim(), issued_on: d.issued_on, expires_on: d.expires_on || null, establishment_id: d.establishment_id || null, file_url: d.file_url || null, status: 'ACTIVE', notes: d.notes || null, registered_by: G.ctx.userName() });
    syncProduct(p.id);
    return row;
  }
  /** el registro vigente se copia al producto (CAT) */
  function syncProduct(productId, silent) {
    const regs = G.db.where('sanitary_registrations', r => r.product_id === productId);
    if (!regs.length) return;
    for (const r of regs) if (r.status === 'ACTIVE' && regEffective(r) === 'EXPIRED') G.db.update('sanitary_registrations', r.id, { status: 'EXPIRED' }, { silent: true });
    const cur = currentReg(productId) || regs.sort(U.by('expires_on', -1))[0];
    G.db.update('products', productId, { sanitary_registry: cur.number, sanitary_registry_expires: cur.expires_on, sanitary_authority: cur.authority }, { silent: silent !== false });
  }
  function sanitaryState(productId) {
    const p = prod(productId);
    if (!p || !p.sanitary_authority || p.sanitary_authority === 'NONE') return { st: 'NOT_APPLICABLE', days: null };
    const cur = currentReg(productId);
    if (!cur) return { st: p.sanitary_authority === 'DIGESA' ? 'NONE_REG' : 'EXPIRED', days: null, reg: G.db.where('sanitary_registrations', r => r.product_id === productId).sort(U.by('expires_on', -1))[0] };
    const days = cur.expires_on ? G.date.diff(cur.expires_on, G.TODAY) : null;
    const first = G.param('cat_sanitary_alert_days') ?? 90, second = G.param('cal_sanitary_second_alert_days') ?? 30;
    return { st: days !== null && days <= second ? 'SECOND' : days !== null && days <= first ? 'EXPIRING' : 'ACTIVE', days, reg: cur };
  }

  /* ---------- checklists e inspecciones (RN-CAL-08) ---------- */
  const itemsOf = chkId => G.db.where('qc_checklist_items', i => i.checklist_id === chkId).sort(U.by('seq'));
  function answerConforming(it, a) {
    if (!a) return false;
    if (it.answer_type === 'YES_NO') return a.answer_bool === true;
    if (it.answer_type === 'NUMBER') { const v = Number(a.answer_num); if (a.answer_num === null || a.answer_num === undefined || a.answer_num === '' || isNaN(v)) return false; return (it.min_value == null || v >= it.min_value) && (it.max_value == null || v <= it.max_value); }
    if (it.answer_type === 'PHOTO') return !it.requires_photo || !!a.photo_url;
    return true;
  }
  /** cal_finish_inspection: puntaje, ítems críticos y resultado */
  function scoreOf(items, answers) {
    let ok = 0, critFail = [];
    for (const it of items) { const a = answers[it.id]; const c = answerConforming(it, a); if (c) ok++; else if (it.is_critical) critFail.push(it); }
    const score = items.length ? R(ok / items.length * 100, 2) : 0;
    const min = G.param('cal_min_checklist_score_pct') ?? 90;
    const result = critFail.length ? 'FAIL' : score >= min ? 'PASS' : 'FAIL';
    return { score, result, critFail, ok, total: items.length, min };
  }
  function inspect(d, opts = {}) {
    if (!opts.seed) { G.assertMod('CAL'); if (!G.can('cal.inspection.record')) G.fail('RN-CAL-08', 'Llenar checklists exige el permiso cal.inspection.record.'); }
    const chk = G.db.get('qc_checklists', d.checklist_id); if (!chk) G.fail('RN-CAL-08', 'Elige el checklist.');
    if (chk.status !== 'ACTIVE') G.fail('RN-CAL-08', `El checklist ${chk.code} v${chk.version} no está activo.`);
    const items = itemsOf(chk.id);
    const answers = d.answers || {};
    for (const it of items) if (!answers[it.id] || (it.answer_type === 'YES_NO' && typeof answers[it.id].answer_bool !== 'boolean') || (it.answer_type === 'NUMBER' && (answers[it.id].answer_num === '' || answers[it.id].answer_num == null))) { if (!opts.seed) G.fail('RN-CAL-08', `Falta responder: «${it.question}».`); }
    const sc = scoreOf(items, answers);
    const at = d.inspected_at || nowIso();
    const ins = G.db.insert('qc_inspections', { number: G.db.next('INS', 'INS-', 5), checklist_id: chk.id, checklist_version: chk.version, stage: chk.stage, establishment_id: d.establishment_id || 'es-L1', schedule_id: d.schedule_id || null, shift: d.shift || shiftOf(at), lot_id: d.lot_id || null, production_order_id: d.production_order_id || null, production_order_ref: d.production_order_ref || null, purchase_receipt_id: d.purchase_receipt_id || null, sales_order_id: d.sales_order_id || null, vehicle_id: d.vehicle_id || null, area: d.area || null, inspector_user_id: d.inspector_user_id || G.ctx.userId(), inspected_at: at, status: 'DONE', result: sc.result, score_pct: sc.score, critical_failed: sc.critFail.map(i => i.question), notes: d.notes || null }, { silent: !!opts.seed });
    for (const it of items) { const a = answers[it.id] || {}; G.db.insert('qc_inspection_answers', { inspection_id: ins.id, item_id: it.id, answer_bool: a.answer_bool ?? null, answer_num: a.answer_num === '' || a.answer_num == null ? null : Number(a.answer_num), answer_text: a.answer_text || null, photo_url: a.photo_url || null, is_conforming: answerConforming(it, a) }, { silent: true }); }
    if (!opts.seed && sc.result === 'FAIL') G.notify({ role: 'CALIDAD', title: `Inspección ${ins.number} no conforme`, body: `${chk.name} · ${G.siteName(ins.establishment_id)} · puntaje ${F.pct(sc.score)}${sc.critFail.length ? ' · ítem crítico: ' + sc.critFail[0].question : ''}`, tone: 'bad', module: 'CAL', ref: { screen: 'CAL-03', id: ins.id } });
    return ins;
  }

  /* ---------- programación y tareas del día (RN-CAL-13) ---------- */
  function slotsFor(s, date) {
    const wd = G.date.parse(date).getUTCDay();
    if (s.status !== 'ACTIVE' || (s.active_from && date < s.active_from)) return [];
    if (s.frequency === 'PER_SHIFT') return ['M', 'T'];
    if (s.frequency === 'DAILY') return ['D'];
    if (s.frequency === 'WEEKLY') return wd === (s.weekday ?? 6) ? ['W'] : [];
    if (s.frequency === 'MONTHLY') return date.slice(8, 10) === '01' ? ['X'] : [];
    return [];
  }
  let _insIdx = null, _insIdxN = -1, _insArr = null;
  function insIndex() {
    const raw = G.db.raw('qc_inspections'); const all = G.db.all('qc_inspections');
    if (_insIdx && _insIdxN === raw.length && _insArr === raw) return _insIdx;
    _insIdx = new Map(); _insIdxN = raw.length; _insArr = raw;
    for (const i of all) if (i.schedule_id) { const k = i.schedule_id + '|' + i.inspected_at.slice(0, 10); (_insIdx.get(k) || _insIdx.set(k, []).get(k)).push(i); }
    return _insIdx;
  }
  /** tareas programadas de un día con su estado: DONE, PENDING o MISSED (una tarea no hecha al final del turno es incumplida) */
  function tasksFor(date, opts = {}) {
    const out = []; const idx = insIndex(); const nowT = G.date.now().slice(11, 16);
    for (const s of G.db.all('qc_schedules')) {
      if (opts.site && s.establishment_id !== opts.site) continue;
      const chk = G.db.get('qc_checklists', s.checklist_id); if (!chk) continue;
      if (opts.stages && !opts.stages.includes(chk.stage)) continue;
      const done = (idx.get(s.id + '|' + date) || []).slice();
      for (const sl of slotsFor(s, date)) {
        const hit = sl === 'M' || sl === 'T' ? done.find(i => (i.shift || shiftOf(i.inspected_at)) === sl) : done[0];
        if (hit) done.splice(done.indexOf(hit), 1);
        const endT = sl === 'M' ? '14:00' : '22:00';
        const st = hit ? 'DONE' : date < G.TODAY ? 'MISSED' : date > G.TODAY ? 'PENDING' : nowT >= endT ? 'MISSED' : 'PENDING';
        out.push({ schedule: s, checklist: chk, date, slot: sl, status: st, inspection: hit || null });
      }
    }
    return out;
  }
  function compliance(from, to, opts = {}) {
    let prog = 0, done = 0;
    for (let d = from; d <= to && d <= G.TODAY; d = G.date.add(d, 1)) for (const t of tasksFor(d, opts)) { if (t.status === 'PENDING') continue; prog++; if (t.status === 'DONE') done++; }
    return { prog, done, pct: prog ? R(done / prog * 100, 1) : null };
  }

  /* ---------- temperaturas, excursiones (RN-CAL-04/05/14/16) ---------- */
  const openExc = pointId => G.db.find('temperature_excursions', e => e.point_id === pointId && e.status === 'OPEN' && !e.ended_at);
  function lotsExposed(p) {
    if (!p.warehouse_id) return [];
    const ids = [...new Set(G.db.where('stock_balances', b => b.warehouse_id === p.warehouse_id && b.qty > 0 && b.lot_id).map(b => b.lot_id))];
    return ids.map(lot).filter(Boolean);
  }
  /** registra una lectura (solo inserción) y abre, actualiza o termina la excursión */
  function recordReading(pointId, value, o = {}) {
    const p = pointOf(pointId); if (!p) G.fail('RN-CAL-04', 'Elige el punto de temperatura.');
    if (!o.seed) { G.assertMod('CAL'); if (!G.can('cal.inspection.record')) G.fail('RN-CAL-04', 'Registrar temperaturas exige el permiso cal.inspection.record.'); }
    const v = Number(value); if (value === '' || value === null || value === undefined || isNaN(v)) G.fail('RN-CAL-04', 'Indica la temperatura leída.');
    if (v < -40 || v > 130) G.fail('RN-CAL-04', `La lectura ${T(v)} no es plausible: revisa el termómetro.`);
    const at = o.at || nowIso();
    const inR = !outRange(p, v);
    const rd = G.db.insert('temperature_readings', { point_id: p.id, establishment_id: p.establishment_id, read_at: at, value_c: R(v, 2), source: o.source || 'MANUAL', context: o.context || (p.point_type === 'VEHICLE' ? 'LOADING' : p.point_type === 'POT' || p.point_type === 'PRODUCT' ? 'COOKING' : 'ROUTINE'), read_by: o.read_by || G.ctx.userId(), photo_url: o.photo_url || null, in_range: inR, excursion_id: null, approved_by: null }, { silent: true });
    let exc = openExc(p.id), opened = false;
    if (!inR) {
      const dev = deviation(p, v);
      if (!exc) { exc = G.db.insert('temperature_excursions', { point_id: p.id, establishment_id: p.establishment_id, started_at: at, ended_at: null, first_value_c: R(v, 2), max_deviation_c: dev, max_value_c: R(v, 2), readings_count: 1, status: 'OPEN', action_taken: null, closed_by: null, closed_at: null, nonconformity_id: null, lots_exposed: lotsExposed(p).map(l => l.id) }, { silent: true }); opened = true; }
      else G.db.update('temperature_excursions', exc.id, { max_deviation_c: Math.max(exc.max_deviation_c, dev), max_value_c: dev > exc.max_deviation_c ? R(v, 2) : exc.max_value_c, readings_count: exc.readings_count + 1 }, { silent: true });
      rd.excursion_id = exc.id;
      if (!o.seed && opened) {
        G.events.emit('temperature.excursion_opened', { excursion_id: exc.id, point: p.code, value_c: v, deviation_c: dev });
        const resp = G.db.find('users', u => u.role === 'ALMACENERO' && (u.sites || []).includes(p.establishment_id));
        if (resp) G.notify({ user_id: resp.id, title: `Temperatura fuera de rango en ${p.name}`, body: `${T(v)} (rango ${rangeTxt(p)}): desviación ${F.num(dev, 1)} °C.`, tone: 'bad', module: 'CAL', ref: { screen: 'CAL-06', id: exc.id } });
        G.notify({ role: 'CALIDAD', title: `Excursión abierta: ${p.name}`, body: `${T(v)} a las ${at.slice(11, 16)} (RN-CAL-04).`, tone: 'bad', module: 'CAL', ref: { screen: 'CAL-06', id: exc.id } });
      }
    } else if (exc) {
      G.db.update('temperature_excursions', exc.id, { ended_at: at }, { silent: true });
    }
    G.db.touch();
    return { reading: rd, excursion: exc ? G.db.get('temperature_excursions', exc.id) : null, opened };
  }
  function closeExcursion(id, action, o = {}) {
    const e = G.db.get('temperature_excursions', id); if (!e) G.fail('RN-CAL-05', 'Excursión no encontrada.');
    if (e.status === 'CLOSED') G.fail('RN-CAL-05', 'La excursión ya está cerrada.');
    if (!String(action || '').trim()) G.fail('RN-CAL-05', 'Una excursión solo se cierra con la acción tomada escrita (por ejemplo: «se trasladó el producto a la cámara 2 y se llamó al técnico»).');
    return G.db.update('temperature_excursions', id, { status: 'CLOSED', action_taken: action.trim(), closed_by: G.ctx.userId(), closed_at: nowIso(), ended_at: e.ended_at || nowIso(), nonconformity_id: o.nonconformity_id || e.nonconformity_id || null });
  }
  function lastReading(pointId) { let best = null; for (const r of G.db.all('temperature_readings')) if (r.point_id === pointId && (!best || r.read_at > best.read_at)) best = r; return best; }
  function lastReadings() { const m = new Map(); for (const r of G.db.all('temperature_readings')) { const b = m.get(r.point_id); if (!b || r.read_at > b.read_at) m.set(r.point_id, r); } return m; }
  /** RN-CAL-14: puntos sin lectura dentro de su frecuencia más la gracia */
  function missingReadings(lr = lastReadings()) {
    const grace = G.param('cal_reading_grace_min') ?? 30; const now = G.date.now();
    return G.db.where('temperature_points', p => p.status === 'ACTIVE' && ['COLD_ROOM', 'FREEZER', 'DISPLAY'].includes(p.point_type)).filter(p => { const l = lr.get(p.id); return !l || minutes(now, l.read_at) > p.reading_frequency_min + grace; });
  }
  /** RN-CAL-15: lectura de carga del vehículo refrigerado; fuera de rango exige aprobación de calidad */
  function loadingCheck(vehicleId, value, o = {}) {
    const p = G.db.find('temperature_points', x => x.vehicle_id === vehicleId && x.status === 'ACTIVE');
    if (!p) return { ok: true, point: null };
    const r = recordReading(p.id, value, Object.assign({ context: 'LOADING' }, o));
    return { ok: r.reading.in_range, reading: r.reading, point: p, needs_approval: !r.reading.in_range };
  }
  function loadingApproved(vehicleId, date = G.TODAY) {
    const p = G.db.find('temperature_points', x => x.vehicle_id === vehicleId); if (!p) return true;
    const rs = G.db.where('temperature_readings', r => r.point_id === p.id && r.context === 'LOADING' && r.read_at.slice(0, 10) === date).sort(U.by('read_at', -1));
    if (!rs.length) return false;
    return rs[0].in_range || !!rs[0].approved_by;
  }
  function approveLoading(readingId) {
    if (!G.can('cal.lot.release')) G.fail('RN-CAL-15', 'Solo calidad aprueba una carga con temperatura fuera de rango.');
    const r = G.db.get('temperature_readings', readingId);
    // la lectura es de solo inserción: la aprobación se registra como un campo de control, no cambia el valor
    r.approved_by = G.ctx.userId(); r.approved_at = nowIso(); G.db.touch();
    G.audit('APROBAR', 'temperature_readings', r.id, 'Carga aprobada por calidad (RN-CAL-15)');
    return r;
  }

  /* ---------- no conformidades y acciones (RN-CAL-06/07) ---------- */
  const ncActions = id => G.db.where('corrective_actions', a => a.nonconformity_id === id);
  function createNC(d, o = {}) {
    if (!o.seed) G.assertMod('CAL');
    if (!String(d.description || '').trim()) G.fail('RN-CAL-06', 'Describe la no conformidad.');
    const nc = G.db.insert('nonconformities', { number: d.number || G.db.next('NC', 'NC-2026-', 3), source: d.source || 'PROCESS', severity: d.severity || 'MINOR', description: d.description.trim(), establishment_id: d.establishment_id || null, lot_id: d.lot_id || null, supplier_id: d.supplier_id || null, equipment_id: d.equipment_id || null, production_order_id: d.production_order_id || null, detected_at: d.detected_at || nowIso(), detected_by: d.detected_by || G.ctx.userId(), root_cause: d.root_cause || null, responsible_user_id: d.responsible_user_id || uidOf('CALIDAD'), due_date: d.due_date || G.date.add(G.TODAY, 7), status: d.status || 'OPEN', closed_at: d.closed_at || null, closed_by: d.closed_by || null, effectiveness_verified: d.effectiveness_verified ?? null, claim_id: d.claim_id || null, excursion_id: d.excursion_id || null }, { silent: !!o.seed });
    // RN-CAL-07: una no conformidad CRITICAL sobre un lote lo bloquea hasta su cierre
    if (nc.severity === 'CRITICAL' && nc.lot_id && !['CLOSED', 'VOIDED'].includes(nc.status)) {
      const l = lot(nc.lot_id);
      if (l && !['BLOCKED', 'RECALLED', 'REJECTED'].includes(l.qc_status)) {
        G.cal._allow = true; try { G.db.update('lots', l.id, { qc_status: 'BLOCKED', block_reason: `No conformidad crítica ${nc.number}: ${nc.description}` }, { silent: !!o.seed }); } finally { G.cal._allow = false; }
        if (!o.seed) G.events.emit('lot.blocked', { lot_id: l.id, code: l.code, reason: 'NC ' + nc.number });
      }
    }
    if (!o.seed) G.notify({ user_id: nc.responsible_user_id, title: `No conformidad ${nc.number} (${MY[nc.severity][0].toLowerCase()})`, body: nc.description, tone: nc.severity === 'MINOR' ? 'warn' : 'bad', module: 'CAL', ref: { screen: 'CAL-08', id: nc.id } });
    return nc;
  }
  function addAction(ncId, d, o = {}) {
    const nc = G.db.get('nonconformities', ncId); if (!nc) G.fail('RN-CAL-06', 'No conformidad no encontrada.');
    if (['CLOSED', 'VOIDED'].includes(nc.status) && !o.seed) G.fail('RN-CAL-06', `La no conformidad ${nc.number} ya está cerrada.`);
    if (!String(d.description || '').trim()) G.fail('RN-CAL-06', 'Describe la acción.');
    const a = G.db.insert('corrective_actions', { nonconformity_id: nc.id, action_type: d.action_type || 'CORRECTIVE', description: d.description.trim(), responsible_user_id: d.responsible_user_id || nc.responsible_user_id, due_date: d.due_date || nc.due_date, done_at: d.done_at || null, evidence_url: d.evidence_url || null, status: d.status || 'PENDING' }, { silent: !!o.seed });
    if (nc.status === 'OPEN' && !o.seed) G.db.update('nonconformities', nc.id, { status: 'IN_PROGRESS' }, { silent: true });
    return a;
  }
  function setActionStatus(id, st, evidence) {
    const a = G.db.get('corrective_actions', id); if (!a) G.fail('RN-CAL-06', 'Acción no encontrada.');
    if (st === 'DONE' && !String(evidence || a.evidence_url || '').trim()) G.fail('RN-CAL-06', 'Para marcarla hecha adjunta la evidencia (foto, registro o descripción).');
    if (st === 'VERIFIED' && !G.can('cal.nonconformity.close')) G.fail('RN-CAL-06', 'Verificar acciones exige el permiso cal.nonconformity.close.');
    return G.db.update('corrective_actions', id, { status: st, done_at: st === 'DONE' ? nowIso() : a.done_at, evidence_url: evidence || a.evidence_url });
  }
  function closeNC(id, o = {}) {
    const nc = G.db.get('nonconformities', id); if (!nc) G.fail('RN-CAL-06', 'No conformidad no encontrada.');
    if (!G.can('cal.nonconformity.close')) G.fail('RN-CAL-06', 'Cerrar no conformidades exige el permiso cal.nonconformity.close.');
    const root = String(o.root_cause ?? nc.root_cause ?? '').trim();
    const acts = ncActions(id);
    if (!root) G.fail('RN-CAL-06', `${nc.number} no se cierra sin causa raíz.`);
    if (!acts.some(a => a.action_type === 'CORRECTIVE' && a.status !== 'CANCELLED')) G.fail('RN-CAL-06', `${nc.number} necesita al menos una acción correctiva antes de cerrarse.`);
    const pend = acts.filter(a => !['DONE', 'VERIFIED', 'CANCELLED'].includes(a.status));
    if (pend.length) G.fail('RN-CAL-06', `${nc.number} tiene ${pend.length} acción(es) pendiente(s): «${pend[0].description}». Termínalas o cancélalas con motivo antes de cerrar.`);
    const r = G.db.update('nonconformities', id, { status: 'CLOSED', root_cause: root, closed_at: nowIso(), closed_by: G.ctx.userId(), effectiveness_verified: o.verified !== false });
    return r;
  }

  /* ---------- decisiones sobre lotes (RN-CAL-01/02/03/10/17) ---------- */
  function lotInspections(l) { return G.db.where('qc_inspections', i => i.lot_id === l.id).sort(U.by('inspected_at', -1)); }
  function requiredStages(l) { return isProducedLot(l) ? ['PACKING', 'PROCESS'] : ['RECEPTION', 'PROCESS', 'PACKING']; }
  function openNCsOf(lotId) { return G.db.where('nonconformities', n => n.lot_id === lotId && !['CLOSED', 'VOIDED'].includes(n.status)); }
  /** qué impide liberar el lote hoy (lista de mensajes con su regla) */
  function lotBlockers(l, date = G.TODAY) {
    const out = [];
    if (!sanitaryValid(l.product_id, date) && (prod(l.product_id) || {}).sanitary_authority === 'DIGESA') out.push({ rule: 'RN-CAL-10', msg: 'Producto DIGESA sin registro sanitario vigente.' });
    const pass = lotInspections(l).find(i => i.result === 'PASS' && requiredStages(l).includes(i.stage));
    if (!pass) out.push({ rule: 'RN-CAL-03', msg: `Falta una inspección conforme de ${requiredStages(l).slice(0, 2).map(stageName).join(' o ').toLowerCase()}.` });
    const ncs = openNCsOf(l.id);
    if (ncs.length) out.push({ rule: 'RN-CAL-03', msg: `${ncs.length} no conformidad(es) abierta(s): ${ncs.map(n => n.number).join(', ')}.` });
    if (l.expiry_date && l.expiry_date < date) out.push({ rule: 'RN-ALM-02', msg: 'El lote está vencido.' });
    return out;
  }
  /** cal_decide_lot(lote, decisión, usuario, motivo) · solo inserción (RN-CAL-16) */
  function decide(lotId, decision, o = {}) {
    if (!o.seed) G.assertMod('CAL');
    const l = lot(lotId); if (!l) G.fail('RN-CAL-01', 'Lote no encontrado.');
    if (!DECISIONS.find(x => x[0] === decision)) G.fail('RN-CAL-01', 'Decisión no válida.');
    const user = o.user_id || G.ctx.userId();
    const date = (o.at || nowIso()).slice(0, 10);
    // RN-CAL-02: quien registró el lote o supervisó su orden no lo libera
    if (lotProducers(l).has(user)) G.fail('RN-CAL-02', `${G.userName(user)} registró o supervisó la orden ${lotOrderLabel(l)} que produjo el lote ${l.code}: otra persona de calidad debe decidir.`);
    if (!o.seed && !G.can('cal.lot.release')) G.fail('RN-CAL-01', `Solo un usuario con el permiso cal.lot.release decide sobre el lote ${l.code} (tu rol: ${G.roleName()}).`);
    if (['RECALLED'].includes(l.qc_status)) G.fail('RN-CAL-01', `El lote ${l.code} está retirado del mercado (ETQ): no admite decisiones de calidad.`);
    let insp = o.inspection_id ? G.db.get('qc_inspections', o.inspection_id) : null;
    if (decision === 'RELEASE' || decision === 'RELEASE_WITH_NOTE') {
      if (l.qc_status === 'RELEASED') G.fail('RN-CAL-01', `El lote ${l.code} ya está liberado.`);
      assertSanitary(l.product_id, date);
      if (!insp) insp = lotInspections(l).find(i => i.result === 'PASS' && requiredStages(l).includes(i.stage));
      if (!insp || insp.result !== 'PASS') G.fail('RN-CAL-03', `Para liberar el lote ${l.code} falta una inspección conforme (PASS) de ${requiredStages(l).slice(0, 2).map(stageName).join(' o ').toLowerCase()}. Hazla en CAL-03.`);
      const ncs = openNCsOf(l.id);
      if (ncs.length) G.fail('RN-CAL-03', `El lote ${l.code} tiene la no conformidad ${ncs[0].number} abierta: ciérrala en CAL-08 antes de liberarlo.`);
      if (decision === 'RELEASE_WITH_NOTE' && !String(o.reason || '').trim()) G.fail('RN-CAL-01', 'Liberar con observación exige escribir la observación.');
    }
    if (decision === 'HOLD' && !String(o.reason || '').trim()) G.fail('RN-CAL-01', 'Retener un lote exige el motivo.');
    if (decision === 'REJECT') {
      if (!String(o.reason || '').trim()) G.fail('RN-CAL-17', 'El rechazo exige el motivo.');
      if (!['WASTE', 'REPROCESS'].includes(o.destination)) G.fail('RN-CAL-17', 'El rechazo exige el destino: merma o reproceso.');
    }
    const newStatus = { RELEASE: 'RELEASED', RELEASE_WITH_NOTE: 'RELEASED', HOLD: 'BLOCKED', REJECT: 'REJECTED' }[decision];
    const at = o.at || nowIso();
    const dec = G.db.insert('lot_quality_decisions', { lot_id: l.id, decision, decided_by: user, decided_at: at, inspection_id: insp ? insp.id : null, reason: o.reason || null, reject_destination: decision === 'REJECT' ? o.destination : null, previous_status: l.qc_status, new_status: newStatus }, { silent: !!o.seed });
    const patch = { qc_status: newStatus, last_decision: decision, quality_note: decision === 'RELEASE_WITH_NOTE' ? o.reason : (l.quality_note || null) };
    if (newStatus === 'RELEASED') Object.assign(patch, { released_at: at, released_by: G.userName(user), block_reason: null });
    if (newStatus === 'BLOCKED') patch.block_reason = 'Retenido por calidad: ' + o.reason;
    if (newStatus === 'REJECTED') patch.block_reason = `Rechazado (${o.destination === 'WASTE' ? 'merma' : 'reproceso'}): ${o.reason}`;
    G.cal._allow = true; try { G.db.update('lots', l.id, patch, { silent: !!o.seed }); } finally { G.cal._allow = false; }
    if (!o.seed) {
      const ev = { RELEASED: 'lot.released', BLOCKED: 'lot.blocked', REJECTED: 'lot.rejected' }[newStatus];
      G.events.emit(ev, { lot_id: l.id, code: l.code, decision, destination: o.destination || null, decision_id: dec.id });
      if (newStatus === 'REJECTED') G.events.emit('lot.blocked', { lot_id: l.id, code: l.code, reason: 'Rechazado por calidad' });
      if (newStatus === 'REJECTED') G.notify({ role: 'ALMACENERO', title: `Lote ${l.code} rechazado`, body: `Destino: ${o.destination === 'WASTE' ? 'merma' : 'reproceso'}. Muévelo en ALM.`, tone: 'bad', module: 'CAL' });
    }
    return dec;
  }

  /* ---------- reclamos (RN-CAL-11/12) ---------- */
  function createClaim(d, o = {}) {
    if (!o.seed) G.assertMod('CAL');
    const ord = d.sales_order_id ? G.db.get('sales_orders', d.sales_order_id) : null;
    const customer_id = d.customer_id || (ord && ord.customer_id);
    if (!customer_id) G.fail('RN-CAL-11', 'Indica el cliente o el pedido.');
    if (!String(d.description || '').trim()) G.fail('RN-CAL-11', 'Describe el reclamo.');
    const doc = d.sales_document_id ? G.db.get('sales_documents', d.sales_document_id) : (ord ? G.db.find('sales_documents', x => x.order_id === ord.id && x.doc_type !== 'CREDIT_NOTE') : null);
    const l = d.lot_id ? lot(d.lot_id) : null;
    const c = G.db.insert('quality_claims', { number: d.number || G.db.next('QR', 'QR-2026-', 3), customer_id, sales_order_id: ord ? ord.id : null, sales_document_id: doc ? doc.id : null, lot_id: l ? l.id : null, product_id: d.product_id || (l ? l.product_id : null), claim_type: d.claim_type || 'OTHER', description: d.description.trim(), photo_url: d.photo_url || null, received_at: d.received_at || nowIso(), channel: d.channel || 'WHATSAPP', status: d.status || 'OPEN', resolution: d.resolution || null, credit_note_id: d.credit_note_id || null, nonconformity_id: null, resolved_at: d.resolved_at || null, resolved_by: d.resolved_by || null, brand_id: ord ? ord.brand_id : (d.brand_id || null), establishment_id: ord ? ord.establishment_id : null }, { silent: !!o.seed });
    const types = G.param('cal_claim_nc_types') || ['SPOILED', 'FOREIGN_BODY', 'TEMPERATURE'];
    if (types.includes(c.claim_type) && c.lot_id) {
      const nc = createNC({ source: 'CUSTOMER_CLAIM', severity: 'MAJOR', description: `Reclamo ${c.number} (${claimTypeName(c.claim_type).toLowerCase()}) de ${G.custName(customer_id)} sobre el lote ${l.code}: ${c.description}`, establishment_id: c.establishment_id, lot_id: c.lot_id, claim_id: c.id, detected_at: c.received_at, number: d.nc_number, status: d.nc_status, root_cause: d.nc_root_cause, closed_at: d.nc_closed_at, closed_by: d.nc_closed_by, effectiveness_verified: d.nc_closed_at ? true : null }, o);
      G.db.update('quality_claims', c.id, { nonconformity_id: nc.id }, { silent: true });
    }
    return G.db.get('quality_claims', c.id);
  }
  function resolveClaim(id, d) {
    const c = G.db.get('quality_claims', id); if (!c) G.fail('RN-CAL-12', 'Reclamo no encontrado.');
    if (!G.can('cal.claim.resolve')) G.fail('RN-CAL-12', 'Resolver reclamos exige el permiso cal.claim.resolve.');
    if (!d.resolution) G.fail('RN-CAL-12', 'Un reclamo resuelto necesita el tipo de resolución.');
    if (d.resolution === 'CREDIT_NOTE' && !d.credit_note_id) G.fail('RN-CAL-12', 'La resolución con nota de crédito exige el comprobante relacionado (emítelo desde aquí o en FAC).');
    return G.db.update('quality_claims', id, { status: 'RESOLVED', resolution: d.resolution, credit_note_id: d.credit_note_id || null, resolution_notes: d.notes || null, resolved_at: nowIso(), resolved_by: G.ctx.userId() });
  }
  function issueCreditNote(claimId, amount) {
    const c = G.db.get('quality_claims', claimId); const doc = G.db.get('sales_documents', c.sales_document_id);
    if (!doc) G.fail('RN-CAL-12', 'El reclamo no tiene comprobante relacionado: no se puede emitir la nota de crédito.');
    const amt = R(Number(amount)); if (!(amt > 0) || amt > doc.total) G.fail('RN-CAL-12', `El monto debe estar entre S/ 0,01 y ${F.money(doc.total)}.`);
    const series = G.series.for('CREDIT_NOTE', doc.brand_id, { appliesTo: doc.doc_type });
    const nc = G.docs.issue({ doc_type: 'CREDIT_NOTE', brand_id: doc.brand_id, establishment_id: doc.establishment_id, customer_id: doc.customer_id, order_id: doc.order_id, related_document_id: doc.id, series, note_reason_code: '07', note_reason: `Devolución por reclamo de calidad ${c.number}`, lines: [{ description: `Devolución por reclamo ${c.number}`, qty: 1, uom_code: 'ZZ', unit_price: amt, total: amt, igv_affectation: '10' }] });
    return nc;
  }

  /* ---------- protección de lots.qc_status (RN-CAL-01) ---------- */
  G.cal = { _allow: false };
  const _update = G.db.update;
  G.db.update = function (name, id, patch, opts) {
    if (name === 'lots' && patch && Object.prototype.hasOwnProperty.call(patch, 'qc_status') && !G._seeding && !G.cal._allow) {
      const l = this.get('lots', id);
      if (l && isProducedLot(l) && l.qc_status === 'QUARANTINE' && ['RELEASED', 'REJECTED'].includes(patch.qc_status) && G.modOn('CAL'))
        G.fail('RN-CAL-01', `Con CAL activo el lote ${l.code} solo cambia de estado de calidad mediante una decisión de calidad registrada (CAL-07) por un usuario con cal.lot.release.`);
    }
    return _update.call(this, name, id, patch, opts);
  };

  Object.assign(G.cal, {
    release: (lotId, o = {}) => decide(lotId, o.withNote ? 'RELEASE_WITH_NOTE' : 'RELEASE', o), decide, lotBlockers, inspect, scoreOf, tasksFor, compliance,
    recordReading, closeExcursion, loadingCheck, loadingApproved, approveLoading, missingReadings, createNC, addAction, setActionStatus, closeNC,
    createClaim, resolveClaim, assertSanitary, sanitaryValid, sanitaryState, registerSanitary, currentReg, lotProducers, stageName,
  });

  /* =====================================================================
     Datos de ejemplo (orden 44)
     ===================================================================== */
  G.seed(44, function seedCAL() {
    const r = U.rng(4401);
    const ins = (t, row) => G.db.insert(t, row, { silent: true });
    const Q = uidOf('CALIDAD'), JEFE = uidOf('JEFE_PRODUCCION');
    const opL2 = (G.db.find('users', u => u.role === 'OPERARIO_PRODUCCION' && (u.sites || []).includes('es-L2')) || {}).id;
    const opL1 = (G.db.find('users', u => u.role === 'OPERARIO_PRODUCCION' && (u.sites || []).includes('es-L1')) || {}).id;
    const almL1 = (G.db.find('users', u => u.role === 'ALMACENERO' && (u.sites || []).includes('es-L1')) || {}).id;
    const almL2 = (G.db.find('users', u => u.role === 'ALMACENERO' && (u.sites || []).includes('es-L2')) || {}).id;
    const prep = uidOf('PREPARADOR');
    const camal = G.db.find('suppliers', s => s.supplier_type === 'SLAUGHTERHOUSE');
    const porcinos = G.db.find('suppliers', s => /PORCINOS/.test(s.legal_name));

    /* --- checklists versionados --- */
    const CHK = [
      ['CHK-REC', 'Recepción de carne y materia prima', 'RECEPTION', [
        ['Temperatura del producto al recibir (°C)', 'NUMBER', -2, 4, true], ['Vehículo del proveedor refrigerado y limpio', 'YES_NO', null, null, false], ['Empaque íntegro, sin roturas ni fugas', 'YES_NO', null, null, false],
        ['Color y olor característicos', 'YES_NO', null, null, true], ['Guía o NTI y certificado sanitario SENASA', 'YES_NO', null, null, true], ['Peso recibido coincide con la guía (±2 %)', 'YES_NO', null, null, false], ['Foto del producto recibido', 'PHOTO', null, null, false], ['Observaciones', 'TEXT', null, null, false]]],
      ['CHK-PRO', 'Control de proceso de embutidos y cortes', 'PROCESS', [
        ['Temperatura de la sala de proceso (°C)', 'NUMBER', 2, 12, false], ['Temperatura del núcleo tras cocción (°C)', 'NUMBER', 72, 98, true], ['Utensilios y superficies desinfectados antes de iniciar', 'YES_NO', null, null, false],
        ['Separación de materia prima cruda y producto cocido', 'YES_NO', null, null, true], ['Personal con uniforme, cofia y sin joyas', 'YES_NO', null, null, false], ['Insumos con lote liberado y vigente', 'YES_NO', null, null, false], ['Observaciones del proceso', 'TEXT', null, null, false]]],
      ['CHK-EMP', 'Empaque y etiquetado', 'PACKING', [
        ['Sellado al vacío sin fugas (muestra de 5 paquetes)', 'YES_NO', null, null, false], ['Etiqueta con lote, vencimiento y registro sanitario', 'YES_NO', null, null, true], ['Peso neto dentro de la tolerancia', 'YES_NO', null, null, false],
        ['Temperatura del producto al empacar (°C)', 'NUMBER', 0, 7, false], ['Bolsa y bandeja limpias, sin deformaciones', 'YES_NO', null, null, false], ['Código de barras legible en el lector', 'YES_NO', null, null, false],
        ['Alérgenos declarados según la receta', 'YES_NO', null, null, false], ['Producto ordenado en gavetas limpias', 'YES_NO', null, null, false], ['Mesa de empaque desinfectada', 'YES_NO', null, null, false], ['Foto del lote empacado', 'PHOTO', null, null, false]]],
      ['CHK-DES', 'Despacho de pedidos', 'DISPATCH', [
        ['Caja isotérmica con gel refrigerante', 'YES_NO', null, null, true], ['Temperatura del vehículo al cargar (°C)', 'NUMBER', 0, 6, false], ['Bolsas numeradas y selladas', 'YES_NO', null, null, false], ['Productos crudos separados de listos para consumo', 'YES_NO', null, null, false], ['Observaciones', 'TEXT', null, null, false]]],
      ['CHK-LIM', 'Limpieza y desinfección', 'CLEANING', [
        ['Pisos y desagües limpios', 'YES_NO', null, null, false], ['Mesas y tablas desinfectadas (cloro 200 ppm)', 'YES_NO', null, null, true], ['Equipos desarmados y lavados', 'YES_NO', null, null, false], ['Concentración de desinfectante medida (ppm)', 'NUMBER', 150, 250, false], ['Tachos con tapa y bolsa', 'YES_NO', null, null, false], ['Foto de evidencia', 'PHOTO', null, null, false]]],
      ['CHK-BPM', 'Buenas prácticas de manufactura del personal', 'BPM', [
        ['Lavado de manos al ingresar', 'YES_NO', null, null, true], ['Uniforme completo y limpio', 'YES_NO', null, null, false], ['Uñas cortas, sin joyas ni maquillaje', 'YES_NO', null, null, false], ['Carné de sanidad vigente', 'YES_NO', null, null, false], ['Sin alimentos ni celulares en la sala', 'YES_NO', null, null, false]]],
    ];
    const chkIds = {};
    for (const [code, name, stage, items] of CHK) {
      if (code === 'CHK-EMP') { const old = ins('qc_checklists', { id: 'qc-' + code + '-v1', code, name, stage, version: 1, status: 'RETIRED', created_by: 'Silvia Ramos Tello', activated_at: '2026-03-02' }); items.slice(0, 7).forEach(([q, t, mi, ma, crit], i) => ins('qc_checklist_items', { checklist_id: old.id, seq: i + 1, question: q, answer_type: t, min_value: mi, max_value: ma, is_critical: crit, requires_photo: t === 'PHOTO' })); }
      const c = ins('qc_checklists', { id: 'qc-' + code, code, name, stage, version: code === 'CHK-EMP' ? 2 : 1, status: 'ACTIVE', created_by: 'Silvia Ramos Tello', activated_at: code === 'CHK-EMP' ? '2026-08-20' : '2026-07-01' });
      chkIds[code] = c.id;
      items.forEach(([q, t, mi, ma, crit], i) => ins('qc_checklist_items', { id: `qi-${code}-${i + 1}`, checklist_id: c.id, seq: i + 1, question: q, answer_type: t, min_value: mi, max_value: ma, is_critical: crit, requires_photo: t === 'PHOTO' }));
    }
    ins('qc_checklists', { id: 'qc-CHK-MOS', code: 'CHK-MOS', name: 'Apertura del mostrador', stage: 'BPM', version: 1, status: 'DRAFT', created_by: 'Silvia Ramos Tello' });
    ins('qc_checklist_items', { checklist_id: 'qc-CHK-MOS', seq: 1, question: 'Exhibidora entre 0 y 4 °C', answer_type: 'NUMBER', min_value: 0, max_value: 4, is_critical: true, requires_photo: false });
    ins('qc_checklist_items', { checklist_id: 'qc-CHK-MOS', seq: 2, question: 'Balanza del mostrador con calibración vigente', answer_type: 'YES_NO', is_critical: true, requires_photo: false });

    /* --- programación por local y área (D-CAL-01: una responsable de calidad para los 2 locales) --- */
    const SCH = [
      ['sch-01', 'CHK-REC', 'es-L1', 'Recepción · cámara Local 1', 'DAILY', 'ALMACENERO'], ['sch-02', 'CHK-REC', 'es-L2', 'Recepción de la granja · Local 2', 'DAILY', 'ALMACENERO'],
      ['sch-03', 'CHK-PRO', 'es-L2', 'Sala de embutidos y caldos', 'PER_SHIFT', 'OPERARIO_PRODUCCION'], ['sch-04', 'CHK-PRO', 'es-L1', 'Sala de cortes', 'DAILY', 'OPERARIO_PRODUCCION'],
      ['sch-05', 'CHK-EMP', 'es-L2', 'Empaque al vacío Local 2', 'PER_SHIFT', 'CALIDAD'], ['sch-06', 'CHK-DES', 'es-L1', 'Zona de despacho', 'PER_SHIFT', 'PREPARADOR'],
      ['sch-07', 'CHK-LIM', 'es-L1', 'Sala de cortes y mostrador', 'DAILY', 'OPERARIO_PRODUCCION'], ['sch-08', 'CHK-LIM', 'es-L2', 'Sala de producción', 'DAILY', 'OPERARIO_PRODUCCION'],
      ['sch-09', 'CHK-BPM', 'es-L1', 'Personal Local 1', 'WEEKLY', 'CALIDAD'], ['sch-10', 'CHK-BPM', 'es-L2', 'Personal Local 2', 'WEEKLY', 'CALIDAD'],
      ['sch-11', 'CHK-LIM', 'es-L2', 'Cámaras y congeladoras (limpieza profunda)', 'MONTHLY', 'ALMACENERO'],
    ];
    for (const [id, chk, est, area, fr, role] of SCH) ins('qc_schedules', { id, checklist_id: chkIds[chk], establishment_id: est, area, frequency: fr, responsible_role: role, weekday: fr === 'WEEKLY' ? 6 : null, status: 'ACTIVE', active_from: '2026-09-01' });
    const whoFor = (role, est) => role === 'ALMACENERO' ? (est === 'es-L2' ? almL2 : almL1) : role === 'OPERARIO_PRODUCCION' ? (est === 'es-L2' ? opL2 : opL1) : role === 'PREPARADOR' ? prep : Q;
    const answersFor = (chkId, mode) => {
      const items = G.db.where('qc_checklist_items', i => i.checklist_id === chkId); const a = {};
      for (const it of items) {
        const bad = mode === 'CRIT' ? it.is_critical : mode === 'MINOR' ? (!it.is_critical && r() < 0.18) : false;
        if (it.answer_type === 'YES_NO') a[it.id] = { answer_bool: !bad };
        else if (it.answer_type === 'NUMBER') { const lo = it.min_value ?? 0, hi = it.max_value ?? lo + 10; a[it.id] = { answer_num: bad ? R(hi + 1.5, 1) : R(lo + (hi - lo) * (0.3 + r() * 0.4), 1) }; }
        else if (it.answer_type === 'PHOTO') a[it.id] = { photo_url: bad ? null : `evidencias/${chkId.slice(3)}-${Math.floor(r() * 9000 + 1000)}.jpg` };
        else a[it.id] = { answer_text: U.pick(r, ['Sin observaciones', 'Conforme', 'Se reforzó la limpieza de la mesa 2', 'Todo en orden']) };
      }
      return a;
    };
    // inspecciones programadas del 1 al 10 de octubre (~93 % de cumplimiento) y de hoy en la mañana
    const nowHour = '11:30';
    for (let d = '2026-10-01'; d <= G.TODAY; d = G.date.add(d, 1)) {
      for (const s of G.db.all('qc_schedules')) for (const sl of slotsFor(s, d)) {
        const hm = sl === 'T' ? '15:' + U.pad(10 + Math.floor(r() * 40), 2) : '07:' + U.pad(10 + Math.floor(r() * 45), 2);
        if (d === G.TODAY && (sl === 'T' || hm > nowHour || r() < 0.3)) continue;
        if (d < G.TODAY && r() < 0.07) continue; // incumplidas
        const x = r(); const mode = x < 0.03 ? 'CRIT' : x < 0.25 ? 'MINOR' : 'OK';
        inspect({ checklist_id: s.checklist_id, establishment_id: s.establishment_id, schedule_id: s.id, shift: sl === 'T' ? 'T' : 'M', area: s.area, inspector_user_id: whoFor(s.responsible_role, s.establishment_id), inspected_at: d + 'T' + hm, answers: answersFor(s.checklist_id, mode), notes: mode === 'CRIT' ? 'Se corrigió en el momento y se informó a calidad' : null }, { seed: true });
      }
    }

    /* --- puntos de temperatura y plan HACCP --- */
    const P = [
      ['tp-CAM-L1', 'TP-CAM-L1', 'Cámara 1 · Local 1', 'COLD_ROOM', 'es-L1', 'wh-CAM-L1', null, 0, 4, 160],
      ['tp-CNG-L1', 'TP-CNG-L1', 'Congeladora · Local 1', 'FREEZER', 'es-L1', 'wh-CNG-L1', null, -22, -18, 160],
      ['tp-MOS-L1', 'TP-MOS-L1', 'Exhibidora del mostrador', 'DISPLAY', 'es-L1', 'wh-MOS-L1', null, 0, 4, 160],
      ['tp-CUA-L1', 'TP-CUA-L1', 'Cámara de cuarentena · Local 1', 'COLD_ROOM', 'es-L1', 'wh-CUA-L1', null, 0, 4, 160],
      ['tp-CAM-L2', 'TP-CAM-L2', 'Cámara 2 · Local 2', 'COLD_ROOM', 'es-L2', 'wh-CAM-L2', null, 0, 4, 160],
      ['tp-CNG-L2', 'TP-CNG-L2', 'Congeladora · Local 2', 'FREEZER', 'es-L2', 'wh-CNG-L2', null, -22, -18, 160],
      ['tp-MAR-L2', 'TP-MAR-L2', 'Marmita de caldos (cocción)', 'POT', 'es-L2', null, null, 85, 100, 60],
      ['tp-NUC-L2', 'TP-NUC-L2', 'Núcleo de embutido cocido', 'PRODUCT', 'es-L2', null, null, 72, 98, 120],
      ['tp-VAN-1', 'TP-VAN-BXR871', 'Furgoneta refrigerada BXR-871', 'VEHICLE', 'es-L1', null, 've-BXR-871', 0, 6, 480],
    ];
    for (const [id, code, name, t, est, wh, ve, mi, ma, fr] of P) ins('temperature_points', { id, code, name, point_type: t, establishment_id: est, equipment_id: null, warehouse_id: wh, vehicle_id: ve, min_c: mi, max_c: ma, reading_frequency_min: fr, status: 'ACTIVE', sensor: false });
    const HACCP = [
      ['PCC-1', 'Carnes frescas', 'Recepción de carne y canales', 'Biológico: multiplicación de patógenos por ruptura de la cadena de frío', 'Producto ≤ 4 °C al recibir', 'Termómetro punzón en cada recepción', 'Cada recepción', 'Rechazar o enfriar de inmediato; no conformidad al proveedor', 'Revisión semanal de registros de recepción', null],
      ['PCC-2', 'Embutidos', 'Cocción de embutidos', 'Biológico: supervivencia de Listeria y Salmonella', 'Núcleo ≥ 72 °C por 2 min', 'Termómetro de núcleo en 3 piezas por tanda', 'Cada tanda', 'Prolongar la cocción hasta alcanzar el límite; retener el lote', 'Calibración del termómetro y revisión diaria', 'tp-NUC-L2'],
      ['PCC-3', 'Caldos', 'Cocción de caldos en marmita', 'Biológico: esporulados (Clostridium)', '≥ 85 °C por 30 min y enfriado a < 10 °C en 2 h', 'Lectura de la marmita al inicio, medio y fin', 'Cada tanda', 'Recocinar; si no se enfrió a tiempo, rechazar', 'Revisión del registro de enfriado', 'tp-MAR-L2'],
      ['PCC-4', 'Todas las refrigeradas', 'Almacenamiento en cámara', 'Biológico: crecimiento microbiano', '0 a 4 °C', 'Lectura manual 3 veces por turno (D-CAL-02)', 'Cada 160 min', 'Trasladar el producto, bloquear lotes expuestos y llamar al técnico', 'Revisión de excursiones en CAL-06', 'tp-CAM-L1'],
      ['PCC-5', 'Congelados', 'Almacenamiento en congeladora', 'Biológico: descongelación parcial', '≤ −18 °C', 'Lectura manual 3 veces por turno', 'Cada 160 min', 'Evaluar el producto; si superó −12 °C, bloquear', 'Revisión semanal', 'tp-CNG-L2'],
      ['PCC-6', 'Delivery', 'Carga y reparto refrigerado', 'Biológico: ruptura de cadena de frío en el reparto', 'Furgoneta 0 a 6 °C al cargar (RN-CAL-15)', 'Lectura al cargar', 'Cada salida', 'No se carga sin aprobación de calidad', 'Revisión diaria del registro de carga', 'tp-VAN-1'],
    ];
    for (const [code, line, step, hazard, lim, mon, fr, act, ver, pt] of HACCP) ins('haccp_plan', { code, product_line: line, step, hazard, critical_limit: lim, monitoring: mon, frequency: fr, corrective_action: act, verification: ver, point_id: pt, status: 'ACTIVE', approved_by: 'Silvia Ramos Tello', approved_on: '2026-08-20' });

    /* --- lecturas del 1 al 10 de octubre con excursiones --- */
    const TIMES = ['06:30', '09:10', '11:50', '14:30', '17:10', '19:50'];
    const special = {
      'tp-CAM-L1|2026-10-06': [['11:50', 7.1], ['12:50', 7.8], ['13:50', 6.9], ['14:30', 3.8]],
      'tp-MOS-L1|2026-10-03': [['14:30', 4.6], ['17:10', 3.2]],
      'tp-VAN-1|2026-10-09': [['08:30', 8.2], ['09:20', 5.1]],
      'tp-CNG-L2|2026-10-10': [['09:10', -14.5]],
    };
    for (let d = '2026-10-01'; d <= G.TODAY; d = G.date.add(d, 1)) {
      for (const p of G.db.all('temperature_points')) {
        const sp = special[p.id + '|' + d];
        let times = ['VEHICLE'].includes(p.point_type) ? ['08:30'] : ['POT', 'PRODUCT'].includes(p.point_type) ? (G.date.parse(d).getUTCDay() === 0 ? [] : ['10:15', '15:40']) : TIMES;
        if (d === G.TODAY) times = times.filter(t => t <= '09:10');
        const list = times.filter(t => !(sp && sp.some(x => x[0] === t))).map(t => [t, R(p.min_c + (p.max_c - p.min_c) * (0.25 + r() * 0.5), 1)]).concat(sp || []).sort((a, b) => a[0].localeCompare(b[0]));
        for (const [t, v] of list) recordReading(p.id, v, { seed: true, at: d + 'T' + t, read_by: p.establishment_id === 'es-L2' ? almL2 : (p.point_type === 'VEHICLE' ? prep : almL1) });
      }
    }
    // furgoneta: la excursión del 09/10 se cerró con aprobación de calidad
    const vanR = G.db.find('temperature_readings', x => x.point_id === 'tp-VAN-1' && x.read_at.startsWith('2026-10-09'));
    if (vanR) { vanR.approved_by = Q; vanR.approved_at = '2026-10-09T08:45'; }
    for (const e of G.db.all('temperature_excursions')) {
      if (e.point_id === 'tp-VAN-1') Object.assign(e, { status: 'CLOSED', action_taken: 'Se agregaron 4 geles y se esperó 40 min con el equipo de frío encendido; calidad aprobó la carga a 5,1 °C.', closed_by: Q, closed_at: '2026-10-09T09:25' });
      if (e.point_id === 'tp-MOS-L1') Object.assign(e, { status: 'CLOSED', action_taken: 'Puerta de la exhibidora mal cerrada tras la reposición; se ajustó el burlete.', closed_by: Q, closed_at: '2026-10-03T17:20' });
    }

    /* --- lotes de calidad: chorizo CH-2026-0412 (cuarentena), carne de cerdo CP-2026-0310 del camal, mermelada con DIGESA vencido --- */
    const upsertLot = (code, row) => { const ex = G.db.find('lots', l => l.code === code); if (ex) { Object.assign(ex, row, { id: ex.id, code }); return ex; } return ins('lots', Object.assign({ code }, row)); };
    const vCer = G.variant('va-MP-CER-MR');
    const cp = upsertLot('CP-2026-0310', { id: 'lo-CP0310', product_id: vCer.product_id, variant_id: vCer.id, origin: 'PURCHASE', supplier_id: camal ? camal.id : null, production_date: '2026-10-03', expiry_date: '2026-10-11', qc_status: 'RELEASED', unit_cost: 12.8, received_weight_kg: 118.4, released_at: '2026-10-03T09:00', released_by: 'Silvia Ramos Tello', notes: 'Media res de cerdo · guía del camal 0012-004518', parent_lots: [] });
    G.inv.move({ type: 'RECEIPT', wh: 'wh-CAM-L2', variant: vCer.id, lot: cp.id, qty: 118.4, weight: 118.4, unitCost: 12.8, source: { type: 'PURCHASE_RECEIPT', id: 'REC-0310' }, at: '2026-10-03T08:20', reason: 'Recepción del camal' });
    G.inv.move({ type: 'PRODUCTION_OUT', wh: 'wh-CAM-L2', variant: vCer.id, lot: cp.id, qty: 32.5, weight: 32.5, source: { type: 'PRODUCTION', id: 'OP01-0412' }, at: '2026-10-09T08:00', reason: 'Consumo para chorizo parrillero' });
    const vCho = G.variant('va-M3-CHO-500');
    const ch = upsertLot('CH-2026-0412', { id: 'lo-CH0412', product_id: vCho.product_id, variant_id: vCho.id, origin: 'PRODUCTION', supplier_id: null, production_date: '2026-10-09', expiry_date: '2026-10-30', qc_status: 'QUARANTINE', unit_cost: 11.4, released_at: null, released_by: null, production_order_ref: 'OP01-0412', supervisor_user_id: JEFE, created_by_user_id: opL2, notes: 'Chorizo parrillero 500 g · 60 paquetes', parent_lots: [{ lot_id: cp.id, kg: 32.5, order_ref: 'OP01-0412' }] });
    G.inv.move({ type: 'PRODUCTION_IN', wh: 'wh-PRD-L2', variant: vCho.id, lot: ch.id, qty: 60, weight: 30, unitCost: 11.4, source: { type: 'PRODUCTION', id: 'OP01-0412' }, at: '2026-10-09T16:30', reason: 'Producción en cuarentena (RN-PRO-05)', allowUnreleased: true });
    inspect({ checklist_id: chkIds['CHK-PRO'], establishment_id: 'es-L2', lot_id: ch.id, production_order_ref: 'OP01-0412', area: 'Sala de embutidos y caldos', inspector_user_id: Q, inspected_at: '2026-10-09T15:20', answers: answersFor(chkIds['CHK-PRO'], 'OK'), notes: 'Cocción a 74 °C en núcleo, 3 piezas' }, { seed: true });
    const vMer = G.variant('va-M5-MER-AGU');
    const me = upsertLot('ME-2026-1010', { id: 'lo-ME1010', product_id: vMer.product_id, variant_id: vMer.id, origin: 'PRODUCTION', production_date: G.TODAY, expiry_date: G.date.add(G.TODAY, 180), qc_status: 'QUARANTINE', unit_cost: 6.2, production_order_ref: 'OP01-0415', supervisor_user_id: JEFE, created_by_user_id: opL2, notes: '120 frascos de 250 g', parent_lots: [] });
    G.inv.move({ type: 'PRODUCTION_IN', wh: 'wh-PRD-L2', variant: vMer.id, lot: me.id, qty: 120, unitCost: 6.2, source: { type: 'PRODUCTION', id: 'OP01-0415' }, at: G.TODAY + 'T10:40', reason: 'Producción en cuarentena', allowUnreleased: true });
    inspect({ checklist_id: chkIds['CHK-EMP'], establishment_id: 'es-L2', lot_id: me.id, production_order_ref: 'OP01-0415', area: 'Empaque', inspector_user_id: Q, inspected_at: G.TODAY + 'T10:55', answers: answersFor(chkIds['CHK-EMP'], 'OK') }, { seed: true });
    const vCg = G.variant('va-M4-CGA-1L');
    const cg = upsertLot('CG-2026-1009', { id: 'lo-CG1009', product_id: vCg.product_id, variant_id: vCg.id, origin: 'PRODUCTION', production_date: '2026-10-09', expiry_date: G.date.add('2026-10-09', 120), qc_status: 'QUARANTINE', unit_cost: 6.9, production_order_ref: 'OP01-0414', supervisor_user_id: JEFE, created_by_user_id: opL2, notes: '80 envases de 1 L', parent_lots: [] });
    G.inv.move({ type: 'PRODUCTION_IN', wh: 'wh-CNG-L2', variant: vCg.id, lot: cg.id, qty: 80, unitCost: 6.9, source: { type: 'PRODUCTION', id: 'OP01-0414' }, at: '2026-10-09T17:30', reason: 'Producción en cuarentena', allowUnreleased: true });
    // lo-Q001 (granja): inspección de recepción conforme de hoy, lista para decidir
    const lq = lot('lo-Q001');
    if (lq) { lq.farm_origin = lq.farm_origin || { species: 'Cuy (Cavia porcellus) raza Perú', slaughter_date: '2026-10-09', farm_name: 'Granja Don Guando · Pachacámac' }; inspect({ checklist_id: chkIds['CHK-REC'], establishment_id: 'es-L1', lot_id: lq.id, area: 'Recepción · cámara Local 1', inspector_user_id: almL1, inspected_at: G.TODAY + 'T07:25', answers: answersFor(chkIds['CHK-REC'], 'OK'), notes: '40 cuyes, 36,4 kg; 2,8 °C' }, { seed: true }); }
    // decisiones históricas de octubre (KPI-CAL-01/02)
    for (const l of G.db.where('lots', x => isProducedLot(x) && x.qc_status === 'RELEASED' && x.production_date >= '2026-10-01')) {
      ins('lot_quality_decisions', { lot_id: l.id, decision: 'RELEASE', decided_by: Q, decided_at: (l.released_at || l.production_date + 'T16:00'), inspection_id: null, reason: null, reject_destination: null, previous_status: 'QUARANTINE', new_status: 'RELEASED' });
    }
    const held = G.db.where('lots', x => isProducedLot(x) && x.qc_status === 'RELEASED' && x.production_date >= '2026-10-05' && x.variant_id === 'va-M3-HUA-500')[0];
    if (held) { const ds = G.db.where('lot_quality_decisions', d => d.lot_id === held.id); for (const d of ds) d.decided_at = held.production_date + 'T18:10'; ins('lot_quality_decisions', { lot_id: held.id, decision: 'HOLD', decided_by: Q, decided_at: held.production_date + 'T16:05', reason: 'Peso neto bajo en 3 de 10 paquetes; repesar', previous_status: 'QUARANTINE', new_status: 'BLOCKED' }); }
    const vJk = G.variant('va-M3-JAM-KG');
    const jr = upsertLot('JA-2026-1003', { id: 'lo-JA1003', product_id: vJk.product_id, variant_id: vJk.id, origin: 'PRODUCTION', production_date: '2026-10-03', expiry_date: '2026-11-02', qc_status: 'REJECTED', unit_cost: 33, production_order_ref: 'OP01-0398', supervisor_user_id: JEFE, created_by_user_id: opL2, block_reason: 'Rechazado (merma): ahumado irregular y núcleo a 66 °C', parent_lots: [] });
    ins('lot_quality_decisions', { lot_id: jr.id, decision: 'REJECT', decided_by: Q, decided_at: '2026-10-03T17:40', reason: 'Ahumado irregular y núcleo a 66 °C (PCC-2 no alcanzado)', reject_destination: 'WASTE', previous_status: 'QUARANTINE', new_status: 'REJECTED' });

    /* --- muestras y análisis de laboratorio --- */
    const LAB = [
      ['MU-2026-031', 'lo-CH0412', 'ANALYSIS', 'Laboratorio Certificaciones Alimentarias SAC', 'Microbiológico: coliformes, E. coli, Salmonella, Listeria', '2026-10-09', null, 'PENDING', null],
      ['MU-2026-030', 'lo-ME1010', 'RETENTION', 'Muestra de retención en Local 2', 'Contramuestra (2 frascos) por 6 meses', G.TODAY, null, 'RETAINED', null],
      ['MU-2026-027', 'lo-JA1003', 'ANALYSIS', 'Laboratorio Certificaciones Alimentarias SAC', 'Microbiológico y temperatura de proceso', '2026-10-03', '2026-10-06', 'FAIL', 'informes/MU-2026-027.pdf'],
      ['MU-2026-024', null, 'WATER', 'Laboratorio Certificaciones Alimentarias SAC', 'Agua de proceso Local 2: cloro residual y coliformes', '2026-09-26', '2026-09-30', 'PASS', 'informes/MU-2026-024.pdf'],
    ];
    const lotIdOf = { 'lo-CH0412': ch.id, 'lo-ME1010': me.id, 'lo-JA1003': jr.id };
    for (const [code, l, t, labn, an, sent, res, st, file] of LAB) ins('qc_lab_samples', { code, lot_id: l ? lotIdOf[l] : null, sample_type: t, lab_name: labn, analysis: an, sent_on: sent, result_on: res, result: st, file_url: file, establishment_id: 'es-L2', taken_by: Q });

    /* --- no conformidades y acciones --- */
    const nc14 = createNC({ number: 'NC-2026-014', source: 'TEMPERATURE', severity: 'CRITICAL', description: 'Cámara 1 del Local 1 llegó a 7,8 °C por 3 h (rango 0 a 4 °C) por falla del compresor; lote de chuleta L261006-C02 expuesto.', establishment_id: 'es-L1', lot_id: 'lo-B001', detected_at: '2026-10-06T12:50', detected_by: almL1, responsible_user_id: Q, due_date: '2026-10-13', status: 'IN_PROGRESS' }, { seed: true });
    addAction(nc14.id, { action_type: 'CORRECTION', description: 'Trasladar el producto a la cámara 2 y bloquear el lote expuesto', status: 'DONE', done_at: '2026-10-06T13:30', evidence_url: 'evidencias/NC014-traslado.jpg', due_date: '2026-10-06' }, { seed: true });
    addAction(nc14.id, { action_type: 'CORRECTIVE', description: 'Cambio del relé del compresor y prueba de 24 h (Frío Total)', status: 'PENDING', due_date: '2026-10-12' }, { seed: true });
    addAction(nc14.id, { action_type: 'PREVENTIVE', description: 'Agregar limpieza del condensador cada 30 días al plan preventivo (EQU-05)', status: 'PENDING', due_date: '2026-10-15' }, { seed: true });
    const exc6 = G.db.find('temperature_excursions', e => e.point_id === 'tp-CAM-L1' && e.started_at.startsWith('2026-10-06'));
    if (exc6) Object.assign(exc6, { status: 'CLOSED', action_taken: 'Se trasladó todo el producto a la cámara 2 del Local 2 y se bloqueó el lote de chuleta. Técnico de Frío Total reinició el compresor.', closed_by: Q, closed_at: '2026-10-06T15:00', nonconformity_id: nc14.id });
    if (exc6) nc14.excursion_id = exc6.id;
    const nc13 = createNC({ number: 'NC-2026-013', source: 'SUPPLIER', severity: 'MAJOR', description: 'Media res de cerdo recibida a 6,1 °C (límite 4 °C) de Porcinos del Sur.', establishment_id: 'es-L2', supplier_id: porcinos ? porcinos.id : null, detected_at: '2026-10-02T07:40', detected_by: almL2, responsible_user_id: Q, due_date: '2026-10-09', status: 'VERIFICATION', root_cause: 'El vehículo del proveedor hizo dos entregas antes sin preenfriar la tolva.' }, { seed: true });
    addAction(nc13.id, { action_type: 'CORRECTION', description: 'Recibir con observación y enfriar de inmediato en cámara 2', status: 'DONE', done_at: '2026-10-02T08:00', evidence_url: 'Registro de recepción REC-0302' }, { seed: true });
    addAction(nc13.id, { action_type: 'CORRECTIVE', description: 'Carta al proveedor exigiendo preenfriado y registro de temperatura del vehículo', status: 'DONE', done_at: '2026-10-04T10:00', evidence_url: 'cartas/porcinos-2026-10-04.pdf' }, { seed: true });
    const nc12 = createNC({ number: 'NC-2026-012', source: 'PACKING', severity: 'MINOR', description: 'Fugas de vacío en 4 de 20 paquetes de bondiola (selladora SEL-L1-01).', establishment_id: 'es-L1', detected_at: '2026-09-28T11:00', detected_by: Q, responsible_user_id: JEFE, due_date: '2026-10-02', status: 'CLOSED', root_cause: 'Resistencia de sellado con desgaste; temperatura de sellado baja.', closed_at: '2026-10-01T17:00', closed_by: Q, effectiveness_verified: true }, { seed: true });
    addAction(nc12.id, { action_type: 'CORRECTION', description: 'Reempacar los 4 paquetes', status: 'VERIFIED', done_at: '2026-09-28T12:00', evidence_url: 'Registro de reempaque' }, { seed: true });
    addAction(nc12.id, { action_type: 'CORRECTIVE', description: 'Cambio de la resistencia de sellado (orden de mantenimiento)', status: 'VERIFIED', done_at: '2026-09-30T16:00', evidence_url: 'Orden de mantenimiento OM-0027' }, { seed: true });
    const nc11 = createNC({ number: 'NC-2026-011', source: 'AUDIT', severity: 'MINOR', description: 'Dos operarios sin cofia en la sala de embutidos durante la inspección BPM.', establishment_id: 'es-L2', detected_at: '2026-09-26T10:00', detected_by: Q, responsible_user_id: JEFE, due_date: '2026-10-03', status: 'OPEN' }, { seed: true });
    addAction(nc11.id, { action_type: 'CORRECTIVE', description: 'Charla de BPM y dotación de cofias desechables en el ingreso', status: 'PENDING', due_date: '2026-10-03' }, { seed: true });

    /* --- registros sanitarios por producto (historial y vigente) --- */
    let k = 0;
    for (const p of G.db.where('products', x => x.product_type === 'GOODS' && ['SENASA', 'DIGESA'].includes(x.sanitary_authority))) {
      if (p.code !== 'MERM' && (!p.sanitary_registry || !p.sanitary_registry_expires)) continue; /* sin registro: CAT lo muestra como «Sin registro» */
      k++;
      const exp = p.code === 'MERM' ? '2026-09-30' : p.sanitary_registry_expires;
      const years = p.sanitary_authority === 'DIGESA' ? 5 : 2;
      const issued = G.date.add(exp, -365 * years);
      if (k % 3 === 0 || p.code === 'MERM') ins('sanitary_registrations', { product_id: p.id, authority: p.sanitary_authority, registration_type: p.sanitary_authority === 'DIGESA' ? 'SANITARY_REGISTRY' : 'SANITARY_AUTHORIZATION', number: p.sanitary_registry.replace(/\d{2}(\D*)$/, m => String((Number(m.slice(0, 2)) + 37) % 100).padStart(2, '0') + m.slice(2)), issued_on: G.date.add(issued, -365 * years), expires_on: issued, establishment_id: 'es-L2', file_url: `registros/${p.code}-anterior.pdf`, status: 'EXPIRED', notes: 'Registro anterior (renovado)' });
      ins('sanitary_registrations', { product_id: p.id, authority: p.sanitary_authority, registration_type: p.sanitary_authority === 'DIGESA' ? 'SANITARY_REGISTRY' : 'SANITARY_AUTHORIZATION', number: p.sanitary_registry, issued_on: issued, expires_on: exp, establishment_id: p.sanitary_authority === 'DIGESA' ? 'es-L2' : null, file_url: `registros/${p.code}.pdf`, status: exp < G.TODAY ? 'EXPIRED' : 'ACTIVE', notes: p.code === 'MERM' ? 'Renovación presentada en VUCE el 22/09/2026 (expediente 2026-118844); pendiente de resolución' : null });
      if (p.code === 'MERM') G.db.update('products', p.id, { sanitary_registry_expires: '2026-09-30' }, { silent: true });
    }

    /* --- reclamos de calidad (3 en octubre, 2 en setiembre) --- */
    const delivered = G.db.where('sales_orders', o => ['DELIVERED', 'CLOSED'].includes(o.status));
    const findOrd = (variant, from, to) => delivered.find(o => o.delivery_date >= from && o.delivery_date <= to && o.lines.some(l => l.variant_id === variant));
    const lotOfVariant = v => G.db.where('lots', l => l.variant_id === v && l.qc_status === 'RELEASED').sort(U.by('production_date'))[0];
    const CL = [
      ['QR-2026-008', 'va-DG-CUY-ENT', '2026-10-07', '2026-10-09', 'SPOILED', 'El cuy llegó con olor fuerte y coloración verdosa en el abdomen.', 'INVESTIGATING', null, 'NC-2026-015'],
      ['QR-2026-009', 'va-M2-BON-KG', '2026-10-04', '2026-10-06', 'WRONG_WEIGHT', 'Pagó 1,5 kg y la etiqueta dice 1,38 kg.', 'RESOLVED', 'REPLACEMENT', null],
      ['QR-2026-010', 'va-DG-CAL-1L', '2026-10-08', '2026-10-09', 'PACKAGING', 'Envase de caldo con la tapa rajada; se derramó en la bolsa.', 'OPEN', null, null],
      ['QR-2026-006', 'va-DG-CON-ENT', '2026-09-10', '2026-09-14', 'TASTE', 'Conejo con sabor fuerte.', 'RESOLVED', 'NONE', null],
      ['QR-2026-007', 'va-DG-POL-ENT', '2026-09-20', '2026-09-24', 'TEMPERATURE', 'El pollo llegó tibio después de 3 h de reparto.', 'RESOLVED', 'REFUND', 'NC-2026-010'],
    ];
    for (const [num, v, from, to, type, desc, st, res, ncNum] of CL) {
      const o = findOrd(v, from, to); if (!o) continue;
      const l = lotOfVariant(v);
      const line = o.lines.find(x => x.variant_id === v);
      if (l && ncNum) { line.lot_id = l.id; const dd = G.db.find('sales_documents', d => d.order_id === o.id); if (dd) for (const dl2 of dd.lines) if (dl2.variant_id === v) dl2.lot_id = l.id; }
      createClaim({ number: num, sales_order_id: o.id, lot_id: l && ncNum ? l.id : null, product_id: (G.variant(v) || {}).product_id, claim_type: type, description: desc, received_at: G.date.add(o.delivery_date, 1) + 'T10:' + U.pad(10 + k % 40, 2), channel: 'WHATSAPP', status: st, resolution: res, resolved_at: st === 'RESOLVED' ? G.date.add(o.delivery_date, 2) + 'T12:00' : null, resolved_by: st === 'RESOLVED' ? Q : null, nc_number: ncNum, nc_status: num === 'QR-2026-007' ? 'CLOSED' : 'OPEN', nc_root_cause: num === 'QR-2026-007' ? 'Ruta larga sin caja isotérmica por falta de stock de geles.' : null, nc_closed_at: num === 'QR-2026-007' ? '2026-09-30T18:00' : null, nc_closed_by: num === 'QR-2026-007' ? Q : null }, { seed: true });
    }
    const ncCl = G.db.find('nonconformities', n => n.number === 'NC-2026-010');
    if (ncCl) addAction(ncCl.id, { action_type: 'CORRECTIVE', description: 'Stock mínimo de 200 geles y verificación en el checklist de despacho', status: 'VERIFIED', done_at: '2026-09-27T10:00', evidence_url: 'Checklist CHK-DES con ítem crítico de gel' }, { seed: true });
    G.db.seq['DG:NC'] = 15; G.db.seq['DG:QR'] = 10;
  }, 'calidad');

  /* =====================================================================
     Pantallas
     ===================================================================== */
  const canAct = (perm) => G.can(perm);
  const run = (fn, ok) => { try { const r = fn(); if (ok) toast(ok, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); return null; } };
  const siteOpts = () => G.db.all('establishments').map(e => [e.id, e.short || e.name]);
  const userOpts = roles => G.db.where('users', u => u.status === 'ACTIVE' && (!roles || roles.includes(u.role))).map(u => [u.id, `${u.name} · ${G.roleName(u.role)}`]);
  const lotOpts = pred => G.db.where('lots', pred || (() => true)).sort(U.by('production_date', -1)).slice(0, 300).map(l => [l.id, `${l.code} · ${G.variantName(l.variant_id)} · ${G.ui.statusLabel(l.qc_status)}`]);

  /* ---------- CAL-01 Plantillas ---------- */
  function rCAL01(el) {
    const body = page(el, { code: 'CAL-01', title: 'Plantillas de checklist', sub: 'Preguntas por etapa con ítems críticos y versión. Una versión activa no se edita: se crea la siguiente y se activa (la anterior queda retirada).', actions: [{ label: 'Nueva plantilla', kind: 'primary', icon: '+', onClick: () => G.require('cal.checklist.manage', () => newChecklist()) }] });
    const rows = G.db.all('qc_checklists');
    const items = U.groupBy(G.db.all('qc_checklist_items'), 'checklist_id');
    body.appendChild(kpis([{ label: 'Plantillas activas', value: rows.filter(c => c.status === 'ACTIVE').length }, { label: 'Ítems críticos (activos)', value: rows.filter(c => c.status === 'ACTIVE').reduce((a, c) => a + (items[c.id] || []).filter(i => i.is_critical).length, 0) }, { label: 'Puntaje mínimo (RN-CAL-08)', value: F.pct(G.param('cal_min_checklist_score_pct'), 0), sub: 'cal_min_checklist_score_pct' }, { label: 'Borradores', value: rows.filter(c => c.status === 'DRAFT').length }]));
    body.appendChild(table({ id: 'cal01', columns: [
      { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Plantilla' }, { key: 'stage', label: 'Etapa', render: r => stageName(r.stage), value: r => stageName(r.stage) },
      { key: 'version', label: 'Versión', align: 'r', render: r => 'v' + r.version }, { key: 'n', label: 'Ítems', align: 'r', value: r => (items[r.id] || []).length },
      { key: 'crit', label: 'Críticos', align: 'r', value: r => (items[r.id] || []).filter(i => i.is_critical).length }, { key: 'status', label: 'Estado', render: r => status(r.status) }],
      rows: rows.sort((a, b) => a.code.localeCompare(b.code) || b.version - a.version), filters: [{ key: 'stage', label: 'Etapa', options: STAGES }, { key: 'status', label: 'Estado', options: [['ACTIVE', 'Activo'], ['DRAFT', 'Borrador'], ['RETIRED', 'Retirado']] }], onRow: r => openChecklist(r) }));
    body.appendChild(notice('Cada respuesta «No» o fuera de rango es un ítem no conforme. Con un ítem crítico no conforme la inspección es «No conforme» aunque el puntaje supere el mínimo (RN-CAL-08).', 'info'));
  }
  function newChecklist() {
    drawer('Nueva plantilla de checklist', (b, close) => b.appendChild(form({ id: 'cal-newchk', fields: [{ key: 'code', label: 'Código', required: true, placeholder: 'CHK-XXX' }, { key: 'name', label: 'Nombre', required: true }, { key: 'stage', label: 'Etapa', type: 'select', options: STAGES, required: true }],
      onSubmit: v => { if (G.db.find('qc_checklists', c => c.code === v.code.toUpperCase())) return 'Ya existe una plantilla con ese código.'; const c = G.db.insert('qc_checklists', { code: v.code.toUpperCase(), name: v.name, stage: v.stage, version: 1, status: 'DRAFT', created_by: G.ctx.userName() }); close(); toast('Plantilla creada en borrador: agrega sus preguntas', 'ok'); G.refresh(); openChecklist(c); return true; } })), { code: 'CAL-01' });
  }
  function openChecklist(c) {
    drawer(`${c.code} v${c.version} · ${c.name}`, (b, close) => {
      const its = itemsOf(c.id);
      const editable = c.status === 'DRAFT' && canAct('cal.checklist.manage');
      b.appendChild(h('div', { class: 'row' },
        c.status === 'DRAFT' ? btn('Activar versión', () => G.require('cal.checklist.manage', () => run(() => { if (!itemsOf(c.id).length) G.fail('RN-CAL-08', 'Una plantilla sin preguntas no se activa.'); for (const o of G.db.where('qc_checklists', x => x.code === c.code && x.status === 'ACTIVE')) G.db.update('qc_checklists', o.id, { status: 'RETIRED' }); G.db.update('qc_checklists', c.id, { status: 'ACTIVE', activated_at: G.TODAY }); close(); }, `${c.code} v${c.version} activada`)), { kind: 'primary', sm: true }) : null,
        c.status === 'ACTIVE' ? btn('Crear nueva versión', () => G.require('cal.checklist.manage', () => { if (G.db.find('qc_checklists', x => x.code === c.code && x.status === 'DRAFT')) return toast('Ya hay una versión en borrador de esta plantilla.', 'warn'); const n = G.db.insert('qc_checklists', { code: c.code, name: c.name, stage: c.stage, version: Math.max(...G.db.where('qc_checklists', x => x.code === c.code).map(x => x.version)) + 1, status: 'DRAFT', created_by: G.ctx.userName() }); for (const it of its) G.db.insert('qc_checklist_items', Object.assign({}, it, { id: undefined, checklist_id: n.id }), { silent: true }); close(); toast(`Versión v${n.version} creada en borrador`, 'ok'); G.refresh(); openChecklist(n); }), { sm: true }) : null,
        btn('Llenar ahora', () => { close(); G.go('CAL-03', { checklist: c.id }); }, { sm: true, disabled: c.status !== 'ACTIVE' })));
      b.appendChild(dl([['Etapa', stageName(c.stage)], ['Versión', 'v' + c.version], ['Estado', status(c.status)], ['Activada', F.date(c.activated_at)], ['Creada por', c.created_by]]));
      b.appendChild(table({ id: 'cal01-items-' + c.id, search: false, columns: [{ key: 'seq', label: '#', align: 'r' }, { key: 'question', label: 'Pregunta' }, { key: 'answer_type', label: 'Respuesta', render: r => (ANSWER_TYPES.find(x => x[0] === r.answer_type) || [])[1] }, { key: 'rng', label: 'Rango', value: r => r.answer_type === 'NUMBER' ? `${r.min_value ?? '—'} a ${r.max_value ?? '—'}` : '' }, { key: 'is_critical', label: 'Crítico', render: r => r.is_critical ? badge('Crítico', 'bad') : '' }],
        rows: its, actions: editable ? r => [btn('Quitar', () => { G.db.remove('qc_checklist_items', r.id); close(); openChecklist(c); }, { sm: true, kind: 'ghost' })] : null }));
      if (editable) b.appendChild(card('Agregar pregunta', form({ id: 'cal01-item', fields: [{ key: 'question', label: 'Pregunta', required: true, span: 2 }, { key: 'answer_type', label: 'Tipo de respuesta', type: 'select', options: ANSWER_TYPES, required: true }, { key: 'is_critical', label: 'Ítem crítico', type: 'checkbox' }, { key: 'min_value', label: 'Mínimo (número)', type: 'number' }, { key: 'max_value', label: 'Máximo (número)', type: 'number' }],
        submitLabel: 'Agregar', onSubmit: v => { G.db.insert('qc_checklist_items', { checklist_id: c.id, seq: its.length + 1, question: v.question, answer_type: v.answer_type, min_value: v.min_value === '' ? null : v.min_value, max_value: v.max_value === '' ? null : v.max_value, is_critical: !!v.is_critical, requires_photo: v.answer_type === 'PHOTO' }); close(); openChecklist(c); return true; } })));
      else if (c.status === 'ACTIVE') b.appendChild(notice('Versión activa: para cambiar preguntas crea una nueva versión (las inspecciones guardan la versión con la que se hicieron).', 'info'));
    }, { code: 'CAL-01', wide: true });
  }

  /* ---------- CAL-02 Programación ---------- */
  function rCAL02(el) {
    const body = page(el, { code: 'CAL-02', title: 'Programación', sub: 'Qué checklist se hace, en qué local y área, con qué frecuencia y qué rol lo hace. Genera las tareas del día; una tarea no hecha al final del turno cuenta como incumplida (RN-CAL-13).', actions: [{ label: 'Nueva programación', kind: 'primary', icon: '+', onClick: () => G.require('cal.checklist.manage', () => editSchedule(null)) }] });
    const site = G.ctx.site !== 'ALL' ? G.ctx.site : null;
    const today = tasksFor(G.TODAY, { site });
    const wk = compliance(G.date.add(G.TODAY, -6), G.TODAY, { site });
    body.appendChild(kpis([{ label: 'Tareas de hoy', value: today.length }, { label: 'Hechas hoy', value: today.filter(t => t.status === 'DONE').length, tone: 'ok' }, { label: 'Pendientes', value: today.filter(t => t.status === 'PENDING').length, tone: 'warn' }, { label: 'Incumplidas hoy', value: today.filter(t => t.status === 'MISSED').length, tone: today.some(t => t.status === 'MISSED') ? 'bad' : '' }, { label: 'Cumplimiento 7 días', value: F.pct(wk.pct), sub: `${wk.done} de ${wk.prog}` }]));
    body.appendChild(tabs([
      { key: 'today', label: 'Tareas de hoy', count: today.length, render: p => p.appendChild(table({ id: 'cal02-today', columns: [
        { key: 'slot', label: 'Turno', value: t => shiftName(t.slot) }, { key: 'chk', label: 'Checklist', value: t => t.checklist.name }, { key: 'area', label: 'Área', value: t => t.schedule.area }, { key: 'site', label: 'Local', value: t => G.siteName(t.schedule.establishment_id) },
        { key: 'role', label: 'Rol', value: t => G.roleName(t.schedule.responsible_role) }, { key: 'status', label: 'Estado', render: t => sb(t.status), value: t => t.status }, { key: 'res', label: 'Resultado', render: t => t.inspection ? sb(t.inspection.result) : '—' }],
        rows: today, filters: [{ key: 'status', label: 'Estado', options: [['DONE', 'Hecha'], ['PENDING', 'Pendiente'], ['MISSED', 'Incumplida']], value: t => t.status }],
        actions: t => [t.status !== 'DONE' ? btn('Llenar', () => G.go('CAL-03', { schedule: t.schedule.id, slot: t.slot }), { sm: true, kind: 'primary' }) : btn('Ver', () => openInspection(t.inspection), { sm: true })] })) },
      { key: 'sched', label: 'Programación', render: p => {
        const rows = G.scope.filter(G.db.all('qc_schedules'));
        p.appendChild(table({ id: 'cal02-sch', columns: [{ key: 'chk', label: 'Checklist', value: s => (G.db.get('qc_checklists', s.checklist_id) || {}).name }, { key: 'stage', label: 'Etapa', value: s => stageName((G.db.get('qc_checklists', s.checklist_id) || {}).stage) }, { key: 'site', label: 'Local', value: s => G.siteName(s.establishment_id) }, { key: 'area', label: 'Área' }, { key: 'frequency', label: 'Frecuencia', value: s => freqName(s.frequency) + (s.frequency === 'WEEKLY' ? ' (sábado)' : '') }, { key: 'responsible_role', label: 'Rol', value: s => G.roleName(s.responsible_role) }, { key: 'm', label: 'Cumplimiento del mes', align: 'r', value: s => { let pr = 0, dn = 0; for (let d = G.date.month(G.TODAY); d <= G.TODAY; d = G.date.add(d, 1)) for (const t of tasksFor(d)) if (t.schedule.id === s.id && t.status !== 'PENDING') { pr++; if (t.status === 'DONE') dn++; } return pr ? F.pct(dn / pr * 100) : '—'; } }, { key: 'status', label: 'Estado', render: s => status(s.status) }],
          rows, filters: [{ key: 'frequency', label: 'Frecuencia', options: FREQS }], onRow: s => G.require('cal.checklist.manage', () => editSchedule(s)) }));
      } },
    ]));
  }
  function editSchedule(s) {
    drawer(s ? 'Editar programación' : 'Nueva programación', (b, close) => b.appendChild(form({ id: 'cal02-f', values: s || { frequency: 'DAILY', status: 'ACTIVE', responsible_role: 'OPERARIO_PRODUCCION' }, fields: [
      { key: 'checklist_id', label: 'Checklist (activo)', type: 'select', required: true, options: G.ui.opts('qc_checklists', c => `${c.code} · ${c.name}`, c => c.status === 'ACTIVE') }, { key: 'establishment_id', label: 'Local', type: 'select', options: siteOpts(), required: true },
      { key: 'area', label: 'Área', required: true }, { key: 'frequency', label: 'Frecuencia', type: 'select', options: FREQS, required: true },
      { key: 'responsible_role', label: 'Rol que lo hace', type: 'select', required: true, options: ['CALIDAD', 'OPERARIO_PRODUCCION', 'ALMACENERO', 'PREPARADOR', 'REPARTIDOR', 'JEFE_PRODUCCION'].map(x => [x, G.roleName(x)]) }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva']], required: true }],
      onCancel: close, onSubmit: v => { const row = { checklist_id: v.checklist_id, establishment_id: v.establishment_id, area: v.area, frequency: v.frequency, responsible_role: v.responsible_role, status: v.status, weekday: v.frequency === 'WEEKLY' ? 6 : null }; if (s) G.db.update('qc_schedules', s.id, row); else G.db.insert('qc_schedules', Object.assign(row, { active_from: G.TODAY })); close(); toast('Programación guardada', 'ok'); G.refresh(); return true; } })), { code: 'CAL-02' });
  }

  /* ---------- CAL-03 Inspección ---------- */
  function rCAL03(el, params) {
    const body = page(el, { code: 'CAL-03', title: 'Inspección', sub: 'Llenado en celular o tableta: respuestas, fotos y resultado calculado al momento; vinculada a un lote, orden, recepción, pedido o vehículo.', actions: [{ label: 'Nueva inspección', kind: 'primary', icon: '+', onClick: () => G.require('cal.inspection.record', () => inspectionDrawer({})) }] });
    if (params.schedule || params.checklist || params.lot) setTimeout(() => G.require('cal.inspection.record', () => inspectionDrawer(params)), 0);
    const rows = G.scope.filter(G.db.all('qc_inspections')).sort(U.by('inspected_at', -1));
    const month = rows.filter(i => i.inspected_at >= G.date.month(G.TODAY));
    body.appendChild(kpis([{ label: 'Inspecciones del mes', value: month.length }, { label: 'Conformes', value: F.pct(month.length ? month.filter(i => i.result === 'PASS').length / month.length * 100 : null), tone: 'ok' }, { label: 'No conformes del mes', value: month.filter(i => i.result === 'FAIL').length, tone: 'bad' }, { label: 'Hoy', value: rows.filter(i => i.inspected_at.startsWith(G.TODAY)).length }]));
    body.appendChild(table({ id: 'cal03', columns: [
      { key: 'number', label: 'N.º', mono: true }, { key: 'inspected_at', label: 'Fecha', render: r => F.datetime(r.inspected_at) }, { key: 'chk', label: 'Checklist', value: r => (G.db.get('qc_checklists', r.checklist_id) || {}).name }, { key: 'stage', label: 'Etapa', value: r => stageName(r.stage) },
      { key: 'site', label: 'Local', value: r => G.siteName(r.establishment_id) }, { key: 'link', label: 'Vinculada a', value: r => r.lot_id ? 'Lote ' + lotCode(r.lot_id) : r.sales_order_id ? 'Pedido ' + ((G.db.get('sales_orders', r.sales_order_id) || {}).number) : r.vehicle_id ? 'Vehículo ' + r.vehicle_id.slice(3) : r.production_order_ref ? 'Orden ' + r.production_order_ref : (r.area || '—') },
      { key: 'insp', label: 'Inspector', value: r => G.userShort(r.inspector_user_id) }, { key: 'score_pct', label: 'Puntaje', align: 'r', render: r => F.pct(r.score_pct, 0) }, { key: 'result', label: 'Resultado', render: r => sb(r.result) }],
      rows, filters: [{ key: 'stage', label: 'Etapa', options: STAGES }, { key: 'result', label: 'Resultado', options: [['PASS', 'Conforme'], ['FAIL', 'No conforme']] }], onRow: r => openInspection(r) }));
  }
  function inspectionDrawer(pre) {
    const sch = pre.schedule ? G.db.get('qc_schedules', pre.schedule) : null;
    const st = { checklist_id: pre.checklist || (sch && sch.checklist_id) || (G.db.find('qc_checklists', c => c.status === 'ACTIVE') || {}).id, establishment_id: (sch && sch.establishment_id) || (G.ctx.site !== 'ALL' ? G.ctx.site : 'es-L1'), lot_id: pre.lot || '', sales_order: '', vehicle_id: '', production_order_ref: '', notes: '', answers: {} };
    drawer('Nueva inspección', (b, close) => {
      const head = h('div'), itemsBox = h('div', { class: 'stack' }), live = h('div'), err = h('div', { class: 'err' });
      function drawHead() {
        G.ui.clear(head);
        head.appendChild(form({ id: 'cal03-head', submitLabel: false, values: st, fields: [
          { key: 'checklist_id', label: 'Checklist', type: 'select', required: true, options: G.ui.opts('qc_checklists', c => `${c.code} v${c.version} · ${c.name}`, c => c.status === 'ACTIVE'), onChange: v => { st.checklist_id = v; st.answers = {}; drawItems(); } },
          { key: 'establishment_id', label: 'Local', type: 'select', options: siteOpts(), required: true, onChange: v => { st.establishment_id = v; } },
          { key: 'lot_id', label: 'Lote (opcional)', type: 'select', options: lotOpts(l => ['QUARANTINE', 'BLOCKED', 'RELEASED'].includes(l.qc_status) && (!l.expiry_date || l.expiry_date >= G.date.add(G.TODAY, -3))), onChange: v => { st.lot_id = v; } },
          { key: 'sales_order', label: 'Pedido (opcional, P-…)', placeholder: 'P-000123', onChange: v => { st.sales_order = v; } },
          { key: 'vehicle_id', label: 'Vehículo (opcional)', type: 'select', options: G.ui.opts('vehicles', v => `${v.plate} · ${v.vehicle_type}`), onChange: v => { st.vehicle_id = v; } },
          { key: 'production_order_ref', label: 'Orden de producción (opcional)', placeholder: 'OP01-0412', onChange: v => { st.production_order_ref = v; } }] }));
        if (sch) head.appendChild(notice(`Tarea programada: ${sch.area} · ${freqName(sch.frequency)} · turno ${shiftName(pre.slot || shiftOf(G.date.now()))}`, 'info'));
      }
      function drawLive() {
        const its = itemsOf(st.checklist_id); const sc = scoreOf(its, st.answers);
        const answered = its.filter(i => st.answers[i.id]).length;
        G.ui.clear(live).appendChild(h('div', { class: 'row between card', style: 'padding:10px 14px' }, h('span', null, `Respondidas ${answered} de ${its.length}`), h('span', null, 'Puntaje ', h('b', null, F.pct(sc.score, 0)), ' · mínimo ', F.pct(sc.min, 0)), h('span', null, 'Resultado: ', sb(sc.result)), sc.critFail.length ? h('span', { class: 'small', style: 'color:var(--bad)' }, 'Crítico no conforme: ' + sc.critFail.map(i => i.question).join('; ')) : null));
      }
      function drawItems() {
        G.ui.clear(itemsBox);
        for (const it of itemsOf(st.checklist_id)) {
          const a = st.answers[it.id] || {};
          let ctl;
          if (it.answer_type === 'YES_NO') ctl = G.ui.pills([['Y', 'Sí'], ['N', 'No']], a.answer_bool === true ? 'Y' : a.answer_bool === false ? 'N' : null, v => { st.answers[it.id] = { answer_bool: v === 'Y' }; drawItems(); });
          else if (it.answer_type === 'NUMBER') { ctl = h('input', { class: 'input', type: 'number', step: '0.1', value: a.answer_num ?? '', attrs: { 'aria-label': it.question }, style: 'max-width:140px' }); ctl.addEventListener('input', () => { st.answers[it.id] = { answer_num: ctl.value === '' ? '' : Number(ctl.value) }; drawLive(); }); }
          else if (it.answer_type === 'PHOTO') { ctl = h('input', { class: 'input', type: 'file', attrs: { accept: 'image/*', capture: 'environment', 'aria-label': it.question } }); ctl.addEventListener('change', () => { st.answers[it.id] = { photo_url: ctl.files[0] ? 'evidencias/' + ctl.files[0].name : null }; drawLive(); }); if (a.photo_url) ctl = h('div', { class: 'row' }, ctl, h('span', { class: 'small muted' }, a.photo_url)); }
          else { ctl = h('input', { class: 'input', value: a.answer_text || '', attrs: { 'aria-label': it.question } }); ctl.addEventListener('input', () => { st.answers[it.id] = { answer_text: ctl.value }; drawLive(); }); }
          const conf = st.answers[it.id] ? answerConforming(it, st.answers[it.id]) : null;
          itemsBox.appendChild(h('div', { class: 'card', style: 'padding:10px 12px' }, h('div', { class: 'row between' }, h('b', null, `${it.seq}. ${it.question}`), h('span', { class: 'row' }, it.is_critical ? badge('Crítico', 'bad') : null, conf === null ? null : conf ? badge('Conforme', 'ok') : badge('No conforme', 'bad'))),
            it.answer_type === 'NUMBER' ? h('div', { class: 'small muted' }, `Rango: ${it.min_value ?? '—'} a ${it.max_value ?? '—'}`) : null, h('div', { style: 'margin-top:6px' }, ctl)));
        }
        drawLive();
      }
      drawHead(); drawItems();
      const notes = h('textarea', { class: 'input', placeholder: 'Observaciones', attrs: { 'aria-label': 'Observaciones' } });
      b.append(head, live, itemsBox, h('div', { class: 'field' }, h('label', null, 'Observaciones'), notes), err,
        h('div', { class: 'form-actions' }, btn('Cancelar', close), btn('Terminar inspección', () => {
          err.textContent = '';
          try {
            const o = st.sales_order ? G.db.find('sales_orders', x => x.number === st.sales_order.trim().toUpperCase()) : null;
            if (st.sales_order && !o) G.fail('RN-CAL-08', `No existe el pedido ${st.sales_order}.`);
            const i = inspect({ checklist_id: st.checklist_id, establishment_id: st.establishment_id, schedule_id: sch ? sch.id : null, shift: pre.slot && ['M', 'T'].includes(pre.slot) ? pre.slot : undefined, area: sch ? sch.area : null, lot_id: st.lot_id || null, sales_order_id: o ? o.id : null, vehicle_id: st.vehicle_id || null, production_order_ref: st.production_order_ref || null, answers: st.answers, notes: notes.value });
            close(); toast(`Inspección ${i.number}: ${MY[i.result][0]} (${F.pct(i.score_pct, 0)})`, i.result === 'PASS' ? 'ok' : 'bad'); G.refresh(); openInspection(i);
          } catch (e) { err.textContent = e.message; }
        }, { kind: 'primary' })));
    }, { code: 'CAL-03', wide: true });
  }
  function openInspection(i) {
    if (!i) return;
    const chk = G.db.get('qc_checklists', i.checklist_id) || {};
    drawer(`Inspección ${i.number}`, (b, close) => {
      b.appendChild(h('div', { class: 'row' }, i.result === 'FAIL' && G.canDo('CAL', 'C') ? btn('Abrir no conformidad', () => { close(); ncDrawer({ source: ['RECEPTION', 'PROCESS', 'PACKING', 'DISPATCH'].includes(i.stage) ? i.stage : 'AUDIT', severity: (i.critical_failed || []).length ? 'MAJOR' : 'MINOR', lot_id: i.lot_id, establishment_id: i.establishment_id, description: `Inspección ${i.number} (${chk.name}) no conforme: ${(i.critical_failed || []).join('; ') || 'puntaje ' + F.pct(i.score_pct, 0)}` }); }, { kind: 'danger', sm: true }) : null, i.lot_id ? btn('Ver lote en CAL-07', () => { close(); G.go('CAL-07', { lot: i.lot_id }); }, { sm: true }) : null));
      b.appendChild(dl([['Checklist', `${chk.code} v${i.checklist_version || chk.version} · ${chk.name}`], ['Etapa', stageName(i.stage)], ['Local', G.siteName(i.establishment_id)], ['Área', i.area], ['Fecha', F.datetime(i.inspected_at)], ['Inspector', G.userName(i.inspector_user_id)], ['Lote', i.lot_id ? lotCode(i.lot_id) : null], ['Orden', i.production_order_ref], ['Pedido', i.sales_order_id ? (G.db.get('sales_orders', i.sales_order_id) || {}).number : null], ['Vehículo', i.vehicle_id ? i.vehicle_id.slice(3) : null], ['Puntaje', F.pct(i.score_pct, 1)], ['Resultado', sb(i.result)], ['Observaciones', i.notes]]));
      const ans = G.db.where('qc_inspection_answers', a => a.inspection_id === i.id);
      const itm = new Map(G.db.where('qc_checklist_items', x => x.checklist_id === i.checklist_id).map(x => [x.id, x]));
      b.appendChild(table({ id: 'cal03-ans', search: false, columns: [{ key: 'q', label: 'Pregunta', value: a => { const it = itm.get(a.item_id) || {}; return `${it.seq}. ${it.question}`; } }, { key: 'v', label: 'Respuesta', value: a => a.answer_bool === true ? 'Sí' : a.answer_bool === false ? 'No' : a.answer_num != null ? F.num(a.answer_num, 1) : a.photo_url || a.answer_text || '—' }, { key: 'crit', label: 'Crítico', render: a => (itm.get(a.item_id) || {}).is_critical ? badge('Crítico', 'bad') : '' }, { key: 'c', label: 'Conformidad', render: a => a.is_conforming ? badge('Conforme', 'ok') : badge('No conforme', 'bad') }], rows: ans.sort((x, y) => ((itm.get(x.item_id) || {}).seq || 0) - ((itm.get(y.item_id) || {}).seq || 0)) }));
    }, { code: 'CAL-03', wide: true });
  }

  /* ---------- CAL-04 Puntos de temperatura y plan HACCP ---------- */
  function rCAL04(el) {
    const body = page(el, { code: 'CAL-04', title: 'Puntos de temperatura', sub: 'Cámaras, congeladoras, ollas, vehículos y exhibidoras con su rango, frecuencia de lectura y equipo o almacén asociado; y el plan HACCP con sus puntos críticos de control.', actions: [{ label: 'Nuevo punto', kind: 'primary', icon: '+', onClick: () => G.require('cal.checklist.manage', () => editPoint(null)) }] });
    const lr = lastReadings();
    const pts = G.scope.filter(G.db.all('temperature_points'));
    body.appendChild(tabs([
      { key: 'pts', label: 'Puntos', count: pts.length, render: p => p.appendChild(table({ id: 'cal04', columns: [
        { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Punto' }, { key: 'point_type', label: 'Tipo', value: r => ptName(r.point_type) }, { key: 'site', label: 'Local', value: r => G.siteName(r.establishment_id) }, { key: 'rng', label: 'Rango', value: r => rangeTxt(r) },
        { key: 'reading_frequency_min', label: 'Frecuencia', align: 'r', value: r => r.reading_frequency_min + ' min' }, { key: 'asoc', label: 'Asociado a', value: r => r.warehouse_id ? G.whName(r.warehouse_id) : r.vehicle_id ? 'Vehículo ' + r.vehicle_id.slice(3) : r.equipment_id ? ((G.db.get('equipment', r.equipment_id) || {}).code || '—') : '—' },
        { key: 'eq', label: 'Equipo (EQU)', value: r => r.equipment_id ? (G.db.get('equipment', r.equipment_id) || {}).code : '—' }, { key: 'last', label: 'Última lectura', render: r => { const l = lr.get(r.id); return l ? h('span', null, h('b', { style: l.in_range ? '' : 'color:var(--bad)' }, T(l.value_c)), h('span', { class: 'muted small' }, ' ' + F.datetime(l.read_at))) : '—'; } }, { key: 'status', label: 'Estado', render: r => status(r.status) }],
        rows: pts, filters: [{ key: 'point_type', label: 'Tipo', options: POINT_TYPES }], onRow: r => G.require('cal.checklist.manage', () => editPoint(r)) })) },
      { key: 'haccp', label: 'Plan HACCP', render: p => {
        p.appendChild(notice('Puntos críticos de control (PCC) con su límite crítico, monitoreo y acción correctiva. Los PCC de temperatura se vigilan con los puntos de esta pantalla.', 'info'));
        p.appendChild(table({ id: 'cal04-haccp', columns: [{ key: 'code', label: 'PCC', mono: true }, { key: 'product_line', label: 'Línea' }, { key: 'step', label: 'Etapa' }, { key: 'hazard', label: 'Peligro' }, { key: 'critical_limit', label: 'Límite crítico' }, { key: 'monitoring', label: 'Monitoreo' }, { key: 'corrective_action', label: 'Acción correctiva' }, { key: 'pt', label: 'Punto', value: r => r.point_id ? (pointOf(r.point_id) || {}).code : '—' }],
          rows: G.db.all('haccp_plan'), onRow: r => drawer(`${r.code} · ${r.step}`, () => dl([['Línea', r.product_line], ['Etapa', r.step], ['Peligro', r.hazard], ['Límite crítico', r.critical_limit], ['Monitoreo', r.monitoring], ['Frecuencia', r.frequency], ['Acción correctiva', r.corrective_action], ['Verificación', r.verification], ['Punto de temperatura', r.point_id ? (pointOf(r.point_id) || {}).name : '—'], ['Aprobado por', `${r.approved_by} · ${F.date(r.approved_on)}`]]), { code: 'CAL-04' }) }));
      } },
    ]));
  }
  function editPoint(pt) {
    drawer(pt ? 'Editar punto ' + pt.code : 'Nuevo punto de temperatura', (b, close) => b.appendChild(form({ id: 'cal04-f', values: pt || { point_type: 'COLD_ROOM', reading_frequency_min: 160, status: 'ACTIVE', establishment_id: 'es-L1' }, fields: [
      { key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'point_type', label: 'Tipo', type: 'select', options: POINT_TYPES, required: true }, { key: 'establishment_id', label: 'Local', type: 'select', options: siteOpts(), required: true },
      { key: 'min_c', label: 'Mínimo °C', type: 'number' }, { key: 'max_c', label: 'Máximo °C', type: 'number' }, { key: 'reading_frequency_min', label: 'Frecuencia de lectura (min)', type: 'number', min: 1, required: true },
      { key: 'warehouse_id', label: 'Almacén asociado', type: 'select', options: G.ui.opts('warehouses', w => w.name) }, { key: 'vehicle_id', label: 'Vehículo', type: 'select', options: G.ui.opts('vehicles', v => v.plate, v => v.refrigerated) },
      { key: 'equipment_id', label: 'Equipo (EQU)', type: 'select', options: G.ui.opts('equipment', e => `${e.code} · ${e.name}`) }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']], required: true }],
      onCancel: close, onSubmit: v => { if (v.min_c !== '' && v.max_c !== '' && v.min_c != null && v.max_c != null && Number(v.min_c) >= Number(v.max_c)) return { max_c: 'El máximo debe ser mayor que el mínimo.' }; if (G.db.find('temperature_points', x => x.code === v.code && (!pt || x.id !== pt.id))) return { code: 'Código repetido.' }; const row = { code: v.code, name: v.name, point_type: v.point_type, establishment_id: v.establishment_id, min_c: v.min_c === '' ? null : Number(v.min_c), max_c: v.max_c === '' ? null : Number(v.max_c), reading_frequency_min: Number(v.reading_frequency_min), warehouse_id: v.warehouse_id || null, vehicle_id: v.vehicle_id || null, equipment_id: v.equipment_id || null, status: v.status }; if (pt) G.db.update('temperature_points', pt.id, row); else G.db.insert('temperature_points', Object.assign(row, { sensor: false })); close(); toast('Punto guardado', 'ok'); G.refresh(); return true; } })), { code: 'CAL-04' });
  }

  /* ---------- CAL-05 Registro de temperaturas ---------- */
  /** adaptador TemperatureSensorProvider (implementación falsa: D-CAL-02, aún sin registradores) */
  const SensorProvider = { read(p) { const mid = (p.min_c + p.max_c) / 2, span = (p.max_c - p.min_c) / 2; return R(mid + (Math.random() - 0.5) * span * 1.2, 1); } };
  function semaforo(p, l, now) {
    const exc = openExc(p.id);
    if (exc || (l && !l.in_range)) return ['bad', 'Fuera de rango'];
    const grace = G.param('cal_reading_grace_min') ?? 30;
    if (!l || (['COLD_ROOM', 'FREEZER', 'DISPLAY'].includes(p.point_type) && minutes(now, l.read_at) > p.reading_frequency_min + grace)) return ['warn', 'Lectura atrasada (RN-CAL-14)'];
    if (p.max_c != null && l.value_c > p.max_c - 0.5 || p.min_c != null && l.value_c < p.min_c + 0.3 && p.point_type !== 'POT' && p.point_type !== 'PRODUCT') return ['warn', 'Cerca del límite'];
    return ['ok', 'En rango'];
  }
  function rCAL05(el) {
    const body = page(el, { code: 'CAL-05', title: 'Registro de temperaturas', sub: 'Lectura manual (con foto opcional del termómetro) o de sensor; semáforo por punto. Las lecturas son de solo inserción: un error se corrige con otra lectura (RN-CAL-16).', actions: [
      { label: 'Leer sondas (simulado)', icon: '⟳', onClick: () => G.require('cal.inspection.record', () => run(() => { let n = 0, out = 0; for (const p of G.scope.filter(G.db.where('temperature_points', x => x.status === 'ACTIVE' && ['COLD_ROOM', 'FREEZER', 'DISPLAY'].includes(x.point_type)))) { const r = recordReading(p.id, SensorProvider.read(p), { source: 'SENSOR' }); n++; if (!r.reading.in_range) out++; } toast(`${n} lecturas de sensor registradas${out ? `, ${out} fuera de rango` : ''}`, out ? 'warn' : 'ok'); })) },
      { label: 'Registrar lectura', kind: 'primary', icon: '+', onClick: () => G.require('cal.inspection.record', () => readingDrawer(null)) }] });
    const lr = lastReadings(); const now = G.date.now();
    const pts = G.scope.filter(G.db.where('temperature_points', p => p.status === 'ACTIVE'));
    const grid = h('div', { class: 'grid c3' });
    for (const p of pts) {
      const l = lr.get(p.id); const [tone, txt] = semaforo(p, l, now);
      grid.appendChild(h('div', { class: 'card', style: `padding:12px 14px;border-left:4px solid var(--${tone})` },
        h('div', { class: 'row between' }, h('b', null, p.name), badge(txt, tone)),
        h('div', { class: 'row between', style: 'margin-top:6px' }, h('span', { style: 'font-size:1.6rem;font-weight:700' }, l ? T(l.value_c) : '—'), h('span', { class: 'small muted' }, `Rango ${rangeTxt(p)}`)),
        h('div', { class: 'small muted' }, l ? `${F.datetime(l.read_at)} · ${l.source === 'SENSOR' ? 'sensor' : 'manual'} · ${G.userShort(l.read_by)}` : 'Sin lecturas', ' · cada ', p.reading_frequency_min, ' min'),
        h('div', { class: 'row', style: 'margin-top:8px' }, btn('Registrar', () => G.require('cal.inspection.record', () => readingDrawer(p)), { sm: true, kind: 'primary' }), openExc(p.id) ? btn('Ver excursión', () => G.go('CAL-06', { id: openExc(p.id).id }), { sm: true, kind: 'danger' }) : null)));
    }
    body.appendChild(grid);
    const loadPend = G.db.where('temperature_readings', r => r.context === 'LOADING' && !r.in_range && !r.approved_by && r.read_at.slice(0, 10) === G.TODAY);
    if (loadPend.length) body.appendChild(notice([h('b', null, 'RN-CAL-15: '), `${loadPend.length} carga(s) de vehículo con temperatura fuera de rango esperan aprobación de calidad; PRE no verifica la carga sin ella. `, ...loadPend.map(r => btn(`Aprobar ${pointOf(r.point_id).name} (${T(r.value_c)})`, () => run(() => approveLoading(r.id), 'Carga aprobada por calidad'), { sm: true }))], 'warn'));
    const rows = G.scope.filter(G.db.where('temperature_readings', r => r.read_at >= G.date.add(G.TODAY, -2))).sort(U.by('read_at', -1));
    body.appendChild(card('Lecturas de los últimos 3 días', table({ id: 'cal05', columns: [
      { key: 'read_at', label: 'Fecha y hora', render: r => F.datetime(r.read_at) }, { key: 'pt', label: 'Punto', value: r => (pointOf(r.point_id) || {}).name }, { key: 'value_c', label: 'Lectura', align: 'r', render: r => h('b', { style: r.in_range ? '' : 'color:var(--bad)' }, T(r.value_c)) }, { key: 'rng', label: 'Rango', value: r => rangeTxt(pointOf(r.point_id) || {}) },
      { key: 'context', label: 'Contexto', value: r => (CONTEXTS.find(x => x[0] === r.context) || [])[1] }, { key: 'source', label: 'Fuente', value: r => r.source === 'SENSOR' ? 'Sensor' : 'Manual' }, { key: 'by', label: 'Registró', value: r => G.userShort(r.read_by) }, { key: 'in_range', label: 'Estado', render: r => r.in_range ? badge('En rango', 'ok') : badge(r.approved_by ? 'Fuera · aprobada' : 'Fuera de rango', 'bad'), value: r => r.in_range ? 'IN' : 'OUT' }],
      rows, filters: [{ key: 'pt', label: 'Punto', options: pts.map(p => [p.name, p.name]), value: r => (pointOf(r.point_id) || {}).name }, { key: 'in_range', label: 'Estado', options: [['IN', 'En rango'], ['OUT', 'Fuera de rango']], value: r => r.in_range ? 'IN' : 'OUT' }] }), { flush: true }));
  }
  function readingDrawer(p) {
    drawer('Registrar lectura', (b, close) => {
      const info = h('div');
      const f = form({ id: 'cal05-f', values: { point_id: p ? p.id : '', context: p && p.point_type === 'VEHICLE' ? 'LOADING' : 'ROUTINE', source: 'MANUAL' }, fields: [
        { key: 'point_id', label: 'Punto', type: 'select', required: true, options: G.ui.opts('temperature_points', x => `${x.name} (${rangeTxt(x)})`, x => x.status === 'ACTIVE'), onChange: () => upd() },
        { key: 'value_c', label: 'Temperatura leída (°C)', type: 'number', required: true, onChange: () => upd() },
        { key: 'context', label: 'Contexto', type: 'select', options: CONTEXTS, required: true }, { key: 'source', label: 'Fuente', type: 'select', options: [['MANUAL', 'Termómetro manual'], ['SENSOR', 'Sensor']], required: true },
        { key: 'photo', label: 'Foto del termómetro (opcional)', type: 'text', placeholder: 'nombre del archivo' }],
        submitLabel: 'Registrar', onCancel: close, onSubmit: v => { const r = recordReading(v.point_id, v.value_c, { context: v.context, source: v.source, photo_url: v.photo || null }); close(); toast(r.reading.in_range ? `Lectura registrada: ${T(r.reading.value_c)} en rango` : `RN-CAL-04: ${T(r.reading.value_c)} fuera de rango. ${r.opened ? 'Se abrió una excursión y se avisó al responsable del local y a calidad.' : 'Se actualizó la excursión abierta.'}`, r.reading.in_range ? 'ok' : 'bad'); G.refresh(); return true; } });
      function upd() { const pt = pointOf(f.api.values.point_id); const v = f.api.values.value_c; G.ui.clear(info); if (!pt) return; info.appendChild(notice(v === '' || v == null ? `Rango ${rangeTxt(pt)}` : outRange(pt, Number(v)) ? `Fuera de rango: desviación ${F.num(deviation(pt, Number(v)), 1)} °C. Se abrirá o actualizará una excursión (RN-CAL-04).` : `En rango (${rangeTxt(pt)}).${openExc(pt.id) ? ' Registrará el fin de la excursión abierta.' : ''}`, v === '' || v == null ? 'info' : outRange(pt, Number(v)) ? 'bad' : 'ok')); }
      b.append(f, info); upd();
    }, { code: 'CAL-05' });
  }

  /* ---------- CAL-06 Excursiones ---------- */
  function rCAL06(el, params) {
    const body = page(el, { code: 'CAL-06', title: 'Excursiones y alertas', sub: 'Lecturas fuera de rango agrupadas en una excursión con su desviación máxima, duración, lotes expuestos y acción tomada. Solo se cierra con la acción escrita (RN-CAL-05).' });
    const rows = G.scope.filter(G.db.all('temperature_excursions')).sort(U.by('started_at', -1));
    const miss = missingReadings();
    const dur = e => { const end = e.ended_at || G.date.now(); const m = minutes(end, e.started_at); return m >= 60 ? `${F.num(m / 60, 1)} h` : `${Math.round(m)} min`; };
    body.appendChild(kpis([{ label: 'Excursiones abiertas', value: rows.filter(e => e.status === 'OPEN').length, tone: rows.some(e => e.status === 'OPEN') ? 'bad' : 'ok' }, { label: 'En curso (sin fin)', value: rows.filter(e => !e.ended_at).length }, { label: 'Excursiones del mes', value: rows.filter(e => e.started_at >= G.date.month(G.TODAY)).length }, { label: 'Puntos con lectura atrasada', value: miss.length, sub: `RN-CAL-14 · gracia ${G.param('cal_reading_grace_min')} min`, tone: miss.length ? 'warn' : '' }]));
    if (miss.length) body.appendChild(notice([h('b', null, 'RN-CAL-14: '), 'sin lectura dentro de su frecuencia más la gracia: ', miss.map(p => p.name).join(', '), '. ', btn('Registrar lecturas', () => G.go('CAL-05'), { sm: true })], 'warn'));
    body.appendChild(table({ id: 'cal06', columns: [
      { key: 'pt', label: 'Punto', value: e => (pointOf(e.point_id) || {}).name }, { key: 'started_at', label: 'Inicio', render: e => F.datetime(e.started_at) }, { key: 'ended_at', label: 'Fin', render: e => e.ended_at ? F.datetime(e.ended_at) : badge('En curso', 'bad') }, { key: 'dur', label: 'Duración', value: e => dur(e) },
      { key: 'first_value_c', label: '1.ª lectura', align: 'r', render: e => T(e.first_value_c) }, { key: 'max_deviation_c', label: 'Desv. máx.', align: 'r', render: e => F.num(e.max_deviation_c, 1) + ' °C' }, { key: 'readings_count', label: 'Lecturas', align: 'r' },
      { key: 'lots', label: 'Lotes expuestos', align: 'r', value: e => (e.lots_exposed || []).length }, { key: 'status', label: 'Estado', render: e => status(e.status) }, { key: 'nc', label: 'NC', value: e => e.nonconformity_id ? (G.db.get('nonconformities', e.nonconformity_id) || {}).number : '' }],
      rows, filters: [{ key: 'status', label: 'Estado', options: [['OPEN', 'Abierta'], ['CLOSED', 'Cerrada']] }], onRow: e => openExcursion(e) }));
    if (params.id) setTimeout(() => { const e = G.db.get('temperature_excursions', params.id); if (e) openExcursion(e); }, 0);
  }
  function openExcursion(e) {
    const p = pointOf(e.point_id) || {};
    drawer(`Excursión · ${p.name}`, (b, close) => {
      const rds = G.db.where('temperature_readings', r => r.excursion_id === e.id || (r.point_id === e.point_id && r.read_at >= e.started_at && r.read_at <= (e.ended_at || '9999'))).sort(U.by('read_at'));
      b.appendChild(dl([['Punto', `${p.code} · ${p.name}`], ['Rango', rangeTxt(p)], ['Inicio', F.datetime(e.started_at)], ['Fin', e.ended_at ? F.datetime(e.ended_at) : 'En curso'], ['Primera lectura', T(e.first_value_c)], ['Desviación máxima', F.num(e.max_deviation_c, 1) + ' °C'], ['Lecturas fuera de rango', e.readings_count], ['Estado', status(e.status)], ['Acción tomada', e.action_taken], ['Cerrada por', e.closed_by ? `${G.userName(e.closed_by)} · ${F.datetime(e.closed_at)}` : null], ['No conformidad', e.nonconformity_id ? (G.db.get('nonconformities', e.nonconformity_id) || {}).number : null]]));
      b.appendChild(card('Lecturas', h('div', { class: 'timeline' }, rds.map(r => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.datetime(r.read_at)), h('span', { class: 'dot', style: r.in_range ? 'background:var(--ok)' : 'background:var(--bad)' }), h('span', null, h('b', null, T(r.value_c)), ' · ', r.in_range ? 'en rango' : 'fuera de rango', ' · ', G.userShort(r.read_by)))))));
      const lots = (e.lots_exposed || []).map(lot).filter(Boolean);
      b.appendChild(card('Lotes expuestos', lots.length ? table({ id: 'cal06-lots', search: false, columns: [{ key: 'code', label: 'Lote', mono: true }, { key: 'v', label: 'Producto', value: l => G.variantName(l.variant_id) }, { key: 'expiry_date', label: 'Vence', render: l => F.date(l.expiry_date) }, { key: 'qc_status', label: 'Estado', render: l => status(l.qc_status) }], rows: lots, onRow: l => { close(); G.go('CAL-07', { lot: l.id }); } }) : G.ui.empty('El punto no tiene almacén asociado o no había stock.')));
      if (e.status === 'OPEN') {
        b.appendChild(card('Cerrar la excursión', form({ id: 'cal06-close', fields: [{ key: 'action', label: 'Acción tomada (obligatoria, RN-CAL-05)', type: 'textarea' }, { key: 'nc', label: 'Abrir no conformidad vinculada', type: 'checkbox' }], submitLabel: 'Cerrar excursión',
          onSubmit: v => { let nc = null; if (v.nc && String(v.action || '').trim()) nc = createNC({ source: 'TEMPERATURE', severity: e.max_deviation_c >= 3 ? 'CRITICAL' : 'MAJOR', description: `${p.name}: ${T(e.first_value_c)} con desviación máxima ${F.num(e.max_deviation_c, 1)} °C desde ${F.datetime(e.started_at)}.`, establishment_id: p.establishment_id, equipment_id: p.equipment_id || null, excursion_id: e.id }); closeExcursion(e.id, v.action, { nonconformity_id: nc ? nc.id : null }); close(); toast('Excursión cerrada' + (nc ? ` y ${nc.number} abierta` : ''), 'ok'); G.refresh(); return true; } })));
      }
    }, { code: 'CAL-06', wide: true });
  }

  /* ---------- CAL-07 Lotes por liberar, decisiones y laboratorio ---------- */
  function rCAL07(el, params) {
    const body = page(el, { code: 'CAL-07', title: 'Lotes por liberar', sub: 'Lotes en cuarentena o retenidos con su orden, inspecciones, lecturas y no conformidades. Solo calidad decide (RN-CAL-01) y quien produjo no libera (RN-CAL-02).' });
    const pend = G.db.where('lots', l => ['QUARANTINE', 'BLOCKED'].includes(l.qc_status)).sort(U.by('production_date', -1));
    const decs = G.db.all('lot_quality_decisions').sort(U.by('decided_at', -1));
    body.appendChild(kpis([{ label: 'En cuarentena', value: pend.filter(l => l.qc_status === 'QUARANTINE').length, tone: 'warn' }, { label: 'Retenidos o bloqueados', value: pend.filter(l => l.qc_status === 'BLOCKED').length, tone: 'bad' }, { label: 'Listos para liberar', value: pend.filter(l => !lotBlockers(l).length).length, tone: 'ok' }, { label: 'Liberados a la primera (mes)', value: F.pct((G.kpi('KPI-CAL-01') || {}).value), sub: 'KPI-CAL-01' }]));
    if (!G.can('cal.lot.release')) body.appendChild(notice(`Tu rol (${G.roleName()}) ve los lotes pero no decide: el permiso cal.lot.release es de Calidad.`, 'warn'));
    body.appendChild(tabs([
      { key: 'pend', label: 'Por decidir', count: pend.length, render: p => p.appendChild(table({ id: 'cal07', columns: [
        { key: 'code', label: 'Lote', mono: true }, { key: 'v', label: 'Producto', value: l => G.variantName(l.variant_id) }, { key: 'brand', label: 'Marca', value: l => G.brandName((G.variant(l.variant_id) || {}).brand_id) }, { key: 'origin', label: 'Origen', value: l => ({ PRODUCTION: 'Producción', CUTTING: 'Despiece', FARM: 'Granja', PURCHASE: 'Compra' }[l.origin] || l.origin) },
        { key: 'ord', label: 'Orden', value: l => isProducedLot(l) ? lotOrderLabel(l) : (l.supplier_id ? G.supName(l.supplier_id) : '—') }, { key: 'production_date', label: 'Producido', render: l => F.date(l.production_date) }, { key: 'qty', label: 'Stock', align: 'r', value: l => F.num(U.sum(G.db.where('stock_balances', b => b.lot_id === l.id), b => b.qty), 1) },
        { key: 'qc_status', label: 'Estado', render: l => status(l.qc_status) }, { key: 'chk', label: 'Verificación', render: l => { const bl = lotBlockers(l); return bl.length ? h('span', { class: 'small', style: 'color:var(--bad)' }, bl.map(x => x.rule).join(', ')) : badge('Listo', 'ok'); } }],
        rows: pend, onRow: l => openLot(l), actions: l => [btn('Liberar', () => decisionModal(l, 'RELEASE'), { sm: true, kind: 'primary', disabled: !G.can('cal.lot.release') }), btn('Decidir…', () => openLot(l), { sm: true })] })) },
      { key: 'hist', label: 'Decisiones', count: decs.length, render: p => p.appendChild(table({ id: 'cal07-dec', columns: [{ key: 'decided_at', label: 'Fecha', render: d => F.datetime(d.decided_at) }, { key: 'lot', label: 'Lote', mono: true, value: d => lotCode(d.lot_id) }, { key: 'v', label: 'Producto', value: d => G.variantName((lot(d.lot_id) || {}).variant_id) }, { key: 'decision', label: 'Decisión', render: d => sb(d.decision) }, { key: 'tr', label: 'Estado', value: d => `${G.ui.statusLabel(d.previous_status)} → ${G.ui.statusLabel(d.new_status)}` }, { key: 'by', label: 'Decidió', value: d => G.userShort(d.decided_by) }, { key: 'reason', label: 'Motivo' }, { key: 'dest', label: 'Destino', value: d => d.reject_destination === 'WASTE' ? 'Merma' : d.reject_destination === 'REPROCESS' ? 'Reproceso' : '' }],
        rows: decs, filters: [{ key: 'decision', label: 'Decisión', options: DECISIONS }], onRow: d => { const l = lot(d.lot_id); if (l) openLot(l); } })) },
      { key: 'lab', label: 'Muestras y laboratorio', render: p => {
        p.appendChild(h('div', { class: 'row' }, btn('Registrar muestra', () => G.require('cal.inspection.record', () => labDrawer(null)), { kind: 'primary', sm: true })));
        p.appendChild(table({ id: 'cal07-lab', columns: [{ key: 'code', label: 'Muestra', mono: true }, { key: 'lot', label: 'Lote', value: s => s.lot_id ? lotCode(s.lot_id) : '—' }, { key: 'sample_type', label: 'Tipo', value: s => ({ ANALYSIS: 'Análisis', RETENTION: 'Contramuestra', WATER: 'Agua' }[s.sample_type]) }, { key: 'analysis', label: 'Análisis' }, { key: 'lab_name', label: 'Laboratorio' }, { key: 'sent_on', label: 'Enviada', render: s => F.date(s.sent_on) }, { key: 'result_on', label: 'Resultado', render: s => F.date(s.result_on) }, { key: 'result', label: 'Estado', render: s => s.result === 'RETAINED' ? badge('Retenida', 'info') : sb(s.result) }, { key: 'file_url', label: 'Informe' }],
          rows: G.db.all('qc_lab_samples').sort(U.by('sent_on', -1)), onRow: s => labDrawer(s) }));
        p.appendChild(notice('El análisis de laboratorio externo se adjunta como archivo; el sistema guarda el resultado. Un resultado no conforme se gestiona con una no conformidad o un retiro de lote (ETQ).', 'info'));
      } },
    ]));
    if (params.lot) setTimeout(() => { const l = lot(params.lot); if (l) openLot(l); }, 0);
  }
  function labDrawer(s) {
    drawer(s ? 'Muestra ' + s.code : 'Registrar muestra', (b, close) => b.appendChild(form({ id: 'cal07-lab-f', values: s || { sample_type: 'ANALYSIS', result: 'PENDING', sent_on: G.TODAY, lab_name: 'Laboratorio Certificaciones Alimentarias SAC' }, fields: [
      { key: 'lot_id', label: 'Lote', type: 'select', options: lotOpts() }, { key: 'sample_type', label: 'Tipo', type: 'select', options: [['ANALYSIS', 'Análisis'], ['RETENTION', 'Contramuestra'], ['WATER', 'Agua']], required: true }, { key: 'analysis', label: 'Análisis', required: true, span: 2 }, { key: 'lab_name', label: 'Laboratorio', required: true },
      { key: 'sent_on', label: 'Enviada', type: 'date', required: true }, { key: 'result_on', label: 'Fecha del resultado', type: 'date' }, { key: 'result', label: 'Resultado', type: 'select', options: [['PENDING', 'Pendiente'], ['PASS', 'Conforme'], ['FAIL', 'No conforme'], ['RETAINED', 'Retenida']], required: true }, { key: 'file_url', label: 'Archivo del informe' }],
      onCancel: close, onSubmit: v => { if (['PASS', 'FAIL'].includes(v.result) && (!v.result_on || !v.file_url)) return 'Un resultado necesita la fecha y el archivo del informe.'; const row = { lot_id: v.lot_id || null, sample_type: v.sample_type, analysis: v.analysis, lab_name: v.lab_name, sent_on: v.sent_on, result_on: v.result_on || null, result: v.result, file_url: v.file_url || null }; if (s) G.db.update('qc_lab_samples', s.id, row); else G.db.insert('qc_lab_samples', Object.assign(row, { code: G.db.next('MU', 'MU-2026-', 3), taken_by: G.ctx.userId() })); close(); toast('Muestra guardada' + (v.result === 'FAIL' ? ': registra la no conformidad o el retiro' : ''), v.result === 'FAIL' ? 'warn' : 'ok'); G.refresh(); return true; } })), { code: 'CAL-07' });
  }
  function openLot(l) {
    drawer(`Lote ${l.code}`, (b, close) => {
      const bl = lotBlockers(l); const can = G.can('cal.lot.release');
      if (['QUARANTINE', 'BLOCKED'].includes(l.qc_status)) b.appendChild(h('div', { class: 'row' }, DECISIONS.map(([d, n]) => btn(n, () => { close(); decisionModal(l, d); }, { sm: true, kind: d === 'RELEASE' ? 'primary' : d === 'REJECT' ? 'danger' : '', disabled: !can })), btn('Nueva inspección', () => { close(); G.go('CAL-03', { lot: l.id }); }, { sm: true }), G.screens['ETQ-04'] ? btn('Trazabilidad', () => { close(); G.go('ETQ-04', { lot: l.id }); }, { sm: true }) : null));
      if (bl.length) b.appendChild(notice(h('div', null, h('b', null, 'Antes de liberar: '), h('ul', { style: 'margin:4px 0 0 18px' }, bl.map(x => h('li', null, `${x.rule}: ${x.msg}`)))), 'warn'));
      else if (['QUARANTINE', 'BLOCKED'].includes(l.qc_status)) b.appendChild(notice('Todas las verificaciones están completas: el lote puede liberarse.', 'ok'));
      const pr = lotProducers(l);
      b.appendChild(dl([['Producto', G.variantName(l.variant_id)], ['Marca', G.brandName((G.variant(l.variant_id) || {}).brand_id)], ['Origen', l.origin], ['Orden', isProducedLot(l) ? lotOrderLabel(l) : '—'], ['Registró / supervisó', [...pr].map(G.userShort).join(', ') || '—'], ['Proveedor', l.supplier_id ? G.supName(l.supplier_id) : null], ['Producido', F.date(l.production_date)], ['Vence', F.date(l.expiry_date)], ['Estado', status(l.qc_status)], ['Motivo de bloqueo', l.block_reason], ['Observación de calidad', l.quality_note], ['Registro sanitario', (() => { const s = sanitaryState(l.product_id); return s.st === 'NOT_APPLICABLE' ? 'No aplica' : h('span', null, (s.reg || {}).number || '—', ' ', sb(s.st)); })()], ['Liberado', l.released_at ? `${F.datetime(l.released_at)} · ${l.released_by}` : null]]));
      const insps = lotInspections(l);
      b.appendChild(card('Inspecciones', insps.length ? table({ id: 'cal07-ins', search: false, columns: [{ key: 'number', label: 'N.º', mono: true }, { key: 'stage', label: 'Etapa', value: i => stageName(i.stage) }, { key: 'inspected_at', label: 'Fecha', render: i => F.datetime(i.inspected_at) }, { key: 'score_pct', label: 'Puntaje', align: 'r', render: i => F.pct(i.score_pct, 0) }, { key: 'result', label: 'Resultado', render: i => sb(i.result) }], rows: insps, onRow: i => openInspection(i) }) : G.ui.empty('Sin inspecciones del lote.')));
      const ncs = G.db.where('nonconformities', n => n.lot_id === l.id);
      b.appendChild(card('No conformidades', ncs.length ? table({ id: 'cal07-nc', search: false, columns: [{ key: 'number', label: 'N.º', mono: true }, { key: 'severity', label: 'Severidad', render: n => sb(n.severity) }, { key: 'description', label: 'Descripción' }, { key: 'status', label: 'Estado', render: n => sb(n.status) }], rows: ncs, onRow: n => { close(); G.go('CAL-08', { id: n.id }); } }) : G.ui.empty('Sin no conformidades.')));
      const whs = [...new Set(G.db.where('stock_balances', x => x.lot_id === l.id).map(x => x.warehouse_id))];
      const pts = G.db.where('temperature_points', p => whs.includes(p.warehouse_id));
      if (pts.length) { const rd = G.db.where('temperature_readings', r => pts.some(p => p.id === r.point_id) && r.read_at >= (l.production_date || G.TODAY)); const out = rd.filter(r => !r.in_range); b.appendChild(card('Lecturas de los puntos de control', h('p', { class: 'small' }, `${rd.length} lecturas en ${pts.map(p => p.name).join(', ')} desde la producción; ${out.length} fuera de rango.`))); }
      const ds = G.db.where('lot_quality_decisions', d => d.lot_id === l.id).sort(U.by('decided_at'));
      if (ds.length) b.appendChild(card('Historial de decisiones', h('div', { class: 'timeline' }, ds.map(d => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.datetime(d.decided_at)), h('span', { class: 'dot' }), h('span', null, sb(d.decision), ' ', G.userShort(d.decided_by), d.reason ? ' · ' + d.reason : ''))))));
    }, { code: 'CAL-07', wide: true });
  }
  function decisionModal(l, decision) {
    if (!G.can('cal.lot.release')) { toast(`RN-CAL-01: solo un usuario con el permiso cal.lot.release decide sobre el lote ${l.code}.`, 'warn'); return; }
    const insps = lotInspections(l).filter(i => i.result === 'PASS');
    modal(`${decName(decision)} el lote ${l.code}`, (b, close) => b.appendChild(form({ id: 'cal07-dec-f', values: { inspection_id: insps[0] ? insps[0].id : '', destination: 'WASTE' }, fields: [
      decision.startsWith('RELEASE') ? { key: 'inspection_id', label: 'Inspección conforme (RN-CAL-03)', type: 'select', options: insps.map(i => [i.id, `${i.number} · ${stageName(i.stage)} · ${F.pct(i.score_pct, 0)}`]) } : null,
      { key: 'reason', label: decision === 'RELEASE' ? 'Comentario (opcional)' : decision === 'RELEASE_WITH_NOTE' ? 'Observación (obligatoria)' : 'Motivo (obligatorio)', type: 'textarea' },
      decision === 'REJECT' ? { key: 'destination', label: 'Destino (RN-CAL-17)', type: 'select', options: [['WASTE', 'Merma'], ['REPROCESS', 'Reproceso']], required: true } : null].filter(Boolean),
      submitLabel: decName(decision), onCancel: close, onSubmit: v => { const d = decide(l.id, decision, { reason: v.reason, destination: v.destination, inspection_id: v.inspection_id || null }); close(); toast(`Lote ${l.code}: ${G.ui.statusLabel(d.new_status).toLowerCase()} (${decName(decision).toLowerCase()})`, d.new_status === 'RELEASED' ? 'ok' : 'warn'); G.refresh(); return true; } })), [], {});
  }

  /* ---------- CAL-08 No conformidades ---------- */
  function rCAL08(el, params) {
    const body = page(el, { code: 'CAL-08', title: 'No conformidades', sub: 'Origen, severidad, lote, proveedor o equipo, causa raíz, responsable, plazo y estado. Se cierran con causa raíz y todas sus acciones terminadas (RN-CAL-06).', actions: [{ label: 'Nueva no conformidad', kind: 'primary', icon: '+', onClick: () => ncDrawer({}) }] });
    const rows = G.scope.filter(G.db.all('nonconformities')).sort(U.by('detected_at', -1));
    const open = rows.filter(n => !['CLOSED', 'VOIDED'].includes(n.status));
    const age = open.length ? R(U.sum(open, n => G.date.diff(G.TODAY, n.detected_at.slice(0, 10))) / open.length, 1) : 0;
    body.appendChild(kpis([{ label: 'Abiertas', value: open.length, tone: open.length ? 'warn' : 'ok' }, { label: 'Críticas abiertas', value: open.filter(n => n.severity === 'CRITICAL').length, tone: open.some(n => n.severity === 'CRITICAL') ? 'bad' : '' }, { label: 'Vencidas', value: open.filter(n => n.due_date && n.due_date < G.TODAY).length, tone: 'bad' }, { label: 'Antigüedad promedio', value: F.days(age), sub: 'KPI-CAL-04' }, { label: 'Cerradas en el mes', value: rows.filter(n => n.status === 'CLOSED' && (n.closed_at || '') >= G.date.month(G.TODAY)).length }]));
    const acts = U.groupBy(G.db.all('corrective_actions'), 'nonconformity_id');
    body.appendChild(table({ id: 'cal08', columns: [
      { key: 'number', label: 'N.º', mono: true }, { key: 'detected_at', label: 'Detectada', render: n => F.date(n.detected_at) }, { key: 'source', label: 'Origen', value: n => srcName(n.source) }, { key: 'severity', label: 'Severidad', render: n => sb(n.severity), value: n => n.severity }, { key: 'description', label: 'Descripción', render: n => h('span', { class: 'small' }, n.description.length > 90 ? n.description.slice(0, 88) + '…' : n.description) },
      { key: 'ref', label: 'Lote / proveedor / equipo', value: n => n.lot_id ? 'Lote ' + lotCode(n.lot_id) : n.supplier_id ? G.supName(n.supplier_id) : n.equipment_id ? ((G.db.get('equipment', n.equipment_id) || {}).code || '') : '—' },
      { key: 'resp', label: 'Responsable', value: n => G.userShort(n.responsible_user_id) }, { key: 'due_date', label: 'Plazo', render: n => h('span', { style: n.due_date < G.TODAY && !['CLOSED', 'VOIDED'].includes(n.status) ? 'color:var(--bad);font-weight:600' : '' }, F.date(n.due_date)) },
      { key: 'acts', label: 'Acciones', align: 'r', value: n => { const a = acts[n.id] || []; return `${a.filter(x => ['DONE', 'VERIFIED', 'CANCELLED'].includes(x.status)).length}/${a.length}`; } }, { key: 'status', label: 'Estado', render: n => sb(n.status), value: n => n.status }],
      rows, filters: [{ key: 'status', label: 'Estado', options: [['OPEN', 'Abierta'], ['IN_PROGRESS', 'En proceso'], ['VERIFICATION', 'En verificación'], ['CLOSED', 'Cerrada'], ['VOIDED', 'Anulada']] }, { key: 'severity', label: 'Severidad', options: SEVS }, { key: 'source', label: 'Origen', options: NC_SOURCES }], onRow: n => openNC(n) }));
    if (params.id) setTimeout(() => { const n = G.db.get('nonconformities', params.id); if (n) openNC(n); }, 0);
  }
  function ncDrawer(pre) {
    drawer('Nueva no conformidad', (b, close) => b.appendChild(form({ id: 'cal08-f', values: Object.assign({ source: 'PROCESS', severity: 'MINOR', due_date: G.date.add(G.TODAY, 7), responsible_user_id: uidOf('CALIDAD'), establishment_id: G.ctx.site !== 'ALL' ? G.ctx.site : 'es-L1' }, pre), fields: [
      { key: 'source', label: 'Origen', type: 'select', options: NC_SOURCES, required: true }, { key: 'severity', label: 'Severidad', type: 'select', options: SEVS, required: true, help: 'Crítica sobre un lote lo bloquea hasta el cierre (RN-CAL-07).' },
      { key: 'description', label: 'Descripción', type: 'textarea', required: true }, { key: 'establishment_id', label: 'Local', type: 'select', options: siteOpts() },
      { key: 'lot_id', label: 'Lote', type: 'select', options: lotOpts() }, { key: 'supplier_id', label: 'Proveedor', type: 'select', options: G.ui.opts('suppliers', s => s.trade_name || s.legal_name, s => !['ADVERTISING', 'CONTENT_CREATOR'].includes(s.supplier_type)) },
      { key: 'equipment_id', label: 'Equipo', type: 'select', options: G.ui.opts('equipment', e => `${e.code} · ${e.name}`) }, { key: 'responsible_user_id', label: 'Responsable', type: 'select', options: userOpts(['CALIDAD', 'JEFE_PRODUCCION', 'ALMACENERO', 'COMPRAS', 'COORDINADOR_DELIVERY', 'GERENTE']), required: true }, { key: 'due_date', label: 'Plazo', type: 'date', required: true }],
      onCancel: close, onSubmit: v => { if (!G.canDo('CAL', 'C')) return 'Tu rol no registra no conformidades.'; const n = createNC(v); close(); toast(`${n.number} registrada${n.severity === 'CRITICAL' && n.lot_id ? '; el lote quedó bloqueado (RN-CAL-07)' : ''}`, 'ok'); G.refresh(); openNC(n); return true; } })), { code: 'CAL-08' });
  }
  function openNC(n) {
    n = G.db.get('nonconformities', n.id);
    drawer(`${n.number} · ${srcName(n.source)}`, (b, close) => {
      const reopen = () => { close(); G.refresh(); openNC(n); };
      const acts = ncActions(n.id);
      const closed = ['CLOSED', 'VOIDED'].includes(n.status);
      if (!closed) b.appendChild(h('div', { class: 'row' },
        n.status !== 'VERIFICATION' ? btn('Pasar a verificación', () => run(() => G.db.update('nonconformities', n.id, { status: 'VERIFICATION' }), 'En verificación') && reopen(), { sm: true }) : null,
        btn('Cerrar no conformidad', () => modal(`Cerrar ${n.number}`, (mb, mc) => mb.appendChild(form({ id: 'cal08-close', values: { root_cause: n.root_cause || '', verified: true }, fields: [{ key: 'root_cause', label: 'Causa raíz', type: 'textarea', required: true }, { key: 'verified', label: 'Eficacia verificada', type: 'checkbox' }], submitLabel: 'Cerrar', onCancel: mc, onSubmit: v => { closeNC(n.id, { root_cause: v.root_cause, verified: !!v.verified }); mc(); toast(`${n.number} cerrada${n.lot_id && lot(n.lot_id) && lot(n.lot_id).qc_status === 'BLOCKED' ? '. El lote sigue bloqueado: decide en CAL-07' : ''}`, 'ok'); reopen(); return true; } }))), { sm: true, kind: 'primary', disabled: !G.can('cal.nonconformity.close') }),
        btn('Anular', () => modal('Anular ' + n.number, (mb, mc) => mb.appendChild(form({ id: 'cal08-void', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], submitLabel: 'Anular', onCancel: mc, onSubmit: v => { G.db.update('nonconformities', n.id, { status: 'VOIDED', void_reason: v.reason }); mc(); toast('Anulada', 'ok'); reopen(); return true; } }))), { sm: true, kind: 'ghost', disabled: !G.can('cal.nonconformity.close') })));
      b.appendChild(dl([['Severidad', sb(n.severity)], ['Estado', sb(n.status)], ['Descripción', n.description], ['Local', G.siteName(n.establishment_id)], ['Lote', n.lot_id ? `${lotCode(n.lot_id)} (${G.ui.statusLabel((lot(n.lot_id) || {}).qc_status)})` : null], ['Proveedor', n.supplier_id ? G.supName(n.supplier_id) : null], ['Equipo', n.equipment_id ? (G.db.get('equipment', n.equipment_id) || {}).code : null], ['Reclamo', n.claim_id ? (G.db.get('quality_claims', n.claim_id) || {}).number : null], ['Detectada', `${F.datetime(n.detected_at)} · ${G.userShort(n.detected_by)}`], ['Responsable', G.userName(n.responsible_user_id)], ['Plazo', F.date(n.due_date)], ['Causa raíz', n.root_cause], ['Cierre', n.closed_at ? `${F.datetime(n.closed_at)} · ${G.userShort(n.closed_by)} · eficacia ${n.effectiveness_verified ? 'verificada' : 'sin verificar'}` : null], ['Motivo de anulación', n.void_reason]]));
      if (!closed) b.appendChild(card('Causa raíz', form({ id: 'cal08-root', values: { root_cause: n.root_cause || '' }, fields: [{ key: 'root_cause', label: 'Causa raíz (5 porqués, Ishikawa)', type: 'textarea' }], submitLabel: 'Guardar causa', onSubmit: v => { G.db.update('nonconformities', n.id, { root_cause: v.root_cause }); toast('Causa raíz guardada', 'ok'); reopen(); return true; } })));
      b.appendChild(card('Acciones', acts.length ? table({ id: 'cal08-acts-' + n.id, search: false, columns: [{ key: 'action_type', label: 'Tipo', value: a => atName(a.action_type) }, { key: 'description', label: 'Acción' }, { key: 'resp', label: 'Responsable', value: a => G.userShort(a.responsible_user_id) }, { key: 'due_date', label: 'Plazo', render: a => F.date(a.due_date) }, { key: 'evidence_url', label: 'Evidencia' }, { key: 'status', label: 'Estado', render: a => sb(a.status) }], rows: acts,
        actions: a => closed ? [] : [a.status === 'PENDING' ? btn('Hecha', () => { const ev = prompt2('Evidencia de la acción (foto, registro o descripción)'); ev.then(x => { if (x === null) return; run(() => setActionStatus(a.id, 'DONE', x), 'Acción terminada'); reopen(); }); }, { sm: true }) : null, a.status === 'DONE' ? btn('Verificar', () => { run(() => setActionStatus(a.id, 'VERIFIED'), 'Acción verificada'); reopen(); }, { sm: true }) : null, a.status === 'PENDING' ? btn('Cancelar', () => { run(() => setActionStatus(a.id, 'CANCELLED'), 'Acción cancelada'); reopen(); }, { sm: true, kind: 'ghost' }) : null].filter(Boolean) }) : G.ui.empty('Sin acciones todavía.')));
      if (!closed) b.appendChild(card('Agregar acción', form({ id: 'cal08-act', values: { action_type: 'CORRECTIVE', responsible_user_id: n.responsible_user_id, due_date: n.due_date }, fields: [{ key: 'action_type', label: 'Tipo', type: 'select', options: ACTION_TYPES, required: true }, { key: 'description', label: 'Descripción', type: 'textarea', required: true }, { key: 'responsible_user_id', label: 'Responsable', type: 'select', options: userOpts(), required: true }, { key: 'due_date', label: 'Plazo', type: 'date', required: true }], submitLabel: 'Agregar acción', onSubmit: v => { addAction(n.id, v); toast('Acción agregada', 'ok'); reopen(); return true; } })));
    }, { code: 'CAL-08', wide: true });
  }
  /** pide un texto en un modal (devuelve una promesa con el texto o null) */
  function prompt2(label) {
    return new Promise(res => { let done = false; modal(label, (b, close) => b.appendChild(form({ id: 'cal-prompt', fields: [{ key: 'v', label, type: 'textarea', required: true }], submitLabel: 'Aceptar', onCancel: () => { close(); if (!done) { done = true; res(null); } }, onSubmit: v => { done = true; close(); res(v.v); return true; } })), []); });
  }

  /* ---------- CAL-09 Acciones correctivas ---------- */
  function rCAL09(el) {
    const body = page(el, { code: 'CAL-09', title: 'Acciones correctivas', sub: 'Corrección, acción correctiva y preventiva con responsable, plazo, evidencia y verificación de todas las no conformidades.' });
    const rows = G.db.all('corrective_actions').map(a => Object.assign({ nc: G.db.get('nonconformities', a.nonconformity_id) || {} }, a)).filter(a => G.scope.ok(a.nc)).sort(U.by('due_date'));
    const pend = rows.filter(a => a.status === 'PENDING');
    body.appendChild(kpis([{ label: 'Pendientes', value: pend.length, tone: 'warn' }, { label: 'Vencidas', value: pend.filter(a => a.due_date < G.TODAY).length, tone: 'bad' }, { label: 'Hechas sin verificar', value: rows.filter(a => a.status === 'DONE').length }, { label: 'Verificadas', value: rows.filter(a => a.status === 'VERIFIED').length, tone: 'ok' }]));
    body.appendChild(table({ id: 'cal09', columns: [
      { key: 'ncn', label: 'NC', mono: true, value: a => a.nc.number }, { key: 'sev', label: 'Severidad', render: a => sb(a.nc.severity), value: a => a.nc.severity }, { key: 'action_type', label: 'Tipo', value: a => atName(a.action_type) }, { key: 'description', label: 'Acción' },
      { key: 'resp', label: 'Responsable', value: a => G.userShort(a.responsible_user_id) }, { key: 'due_date', label: 'Plazo', render: a => h('span', { style: a.status === 'PENDING' && a.due_date < G.TODAY ? 'color:var(--bad);font-weight:600' : '' }, F.date(a.due_date)) }, { key: 'done_at', label: 'Hecha', render: a => F.date(a.done_at) }, { key: 'evidence_url', label: 'Evidencia' }, { key: 'status', label: 'Estado', render: a => sb(a.status), value: a => a.status }],
      rows, filters: [{ key: 'status', label: 'Estado', options: [['PENDING', 'Pendiente'], ['DONE', 'Hecha'], ['VERIFIED', 'Verificada'], ['CANCELLED', 'Cancelada']] }, { key: 'action_type', label: 'Tipo', options: ACTION_TYPES }],
      onRow: a => G.go('CAL-08', { id: a.nonconformity_id }),
      actions: a => [a.status === 'PENDING' ? btn('Marcar hecha', () => prompt2('Evidencia de la acción').then(x => { if (x !== null) run(() => setActionStatus(a.id, 'DONE', x), 'Acción terminada'); }), { sm: true }) : null, a.status === 'DONE' ? btn('Verificar', () => run(() => setActionStatus(a.id, 'VERIFIED'), 'Acción verificada'), { sm: true, disabled: !G.can('cal.nonconformity.close') }) : null].filter(Boolean) }));
  }

  /* ---------- CAL-10 Historial de registros sanitarios ---------- */
  function rCAL10(el, params) {
    const body = page(el, { code: 'CAL-10', title: 'Historial de registros sanitarios', sub: 'Por producto, todos sus registros o autorizaciones SENASA o DIGESA con número, emisión, vencimiento, archivo y renovaciones. El vigente se copia al producto (CAT-10); con CAL se suma el 2.º aviso a calidad (RN-CAL-09).', actions: [{ label: 'Registrar o renovar', kind: 'primary', icon: '+', onClick: () => G.require('cal.sanitary.manage', () => sanDrawer(null)) }] });
    const prods = G.db.where('products', p => p.status === 'ACTIVE' && ['SENASA', 'DIGESA'].includes(p.sanitary_authority) && p.product_type === 'GOODS');
    const stOf = new Map(prods.map(p => [p.id, sanitaryState(p.id)]));
    const cnt = s => prods.filter(p => stOf.get(p.id).st === s).length;
    const k8 = G.kpi('KPI-CAL-08') || {};
    body.appendChild(kpis([{ label: 'Vigentes', value: cnt('ACTIVE'), tone: 'ok' }, { label: `Por vencer (≤ ${G.param('cat_sanitary_alert_days') ?? 90} días)`, value: cnt('EXPIRING'), tone: 'warn' }, { label: `2.º aviso (≤ ${G.param('cal_sanitary_second_alert_days')} días)`, value: cnt('SECOND'), tone: 'bad' }, { label: 'DIGESA sin registro vigente', value: k8.value ?? '—', sub: 'KPI-CAL-08 · meta 0', tone: k8.value ? 'bad' : 'ok' }]));
    body.appendChild(notice('D-CAL-03 (valor provisional): embutidos, mermeladas y caldos envasados requieren DIGESA; la carne fresca, SENASA. Calidad carga la lista real aquí. Un producto DIGESA sin registro vigente no se libera ni se etiqueta (RN-CAL-10, RN-ETQ-02).', 'info'));
    body.appendChild(table({ id: 'cal10', columns: [
      { key: 'code', label: 'Código', mono: true }, { key: 'name', label: 'Producto' }, { key: 'brand', label: 'Marca', value: p => G.brandName(p.brand_id) }, { key: 'sanitary_authority', label: 'Autoridad' },
      { key: 'num', label: 'Registro vigente', mono: true, value: p => (stOf.get(p.id).reg || {}).number || '—' }, { key: 'exp', label: 'Vence', render: p => F.date((stOf.get(p.id).reg || {}).expires_on), value: p => (stOf.get(p.id).reg || {}).expires_on || '' },
      { key: 'days', label: 'Días', align: 'r', value: p => stOf.get(p.id).days ?? '—' }, { key: 'n', label: 'Registros', align: 'r', value: p => G.db.where('sanitary_registrations', r => r.product_id === p.id).length }, { key: 'st', label: 'Semáforo', render: p => sb(stOf.get(p.id).st), value: p => stOf.get(p.id).st }],
      rows: prods, filters: [{ key: 'sanitary_authority', label: 'Autoridad', options: [['SENASA', 'SENASA'], ['DIGESA', 'DIGESA']] }, { key: 'st', label: 'Semáforo', options: [['ACTIVE', 'Vigente'], ['EXPIRING', 'Por vencer'], ['SECOND', '2.º aviso'], ['EXPIRED', 'Vencido'], ['NONE_REG', 'Sin registro']], value: p => stOf.get(p.id).st }], onRow: p => openSan(p) }));
    if (params.product) setTimeout(() => { const p = prod(params.product); if (p) openSan(p); }, 0);
  }
  function openSan(p) {
    drawer(`${p.name} · registros sanitarios`, (b, close) => {
      const regs = G.db.where('sanitary_registrations', r => r.product_id === p.id).sort(U.by('issued_on', -1));
      const s = sanitaryState(p.id);
      b.appendChild(h('div', { class: 'row' }, btn('Registrar o renovar', () => { close(); G.require('cal.sanitary.manage', () => sanDrawer(p)); }, { kind: 'primary', sm: true })));
      b.appendChild(dl([['Autoridad', p.sanitary_authority], ['Copiado al producto (CAT)', `${p.sanitary_registry || '—'} · vence ${F.date(p.sanitary_registry_expires)}`], ['Semáforo', sb(s.st)], ['Días para vencer', s.days ?? '—']]));
      b.appendChild(h('div', { class: 'timeline' }, regs.map(r => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, F.date(r.issued_on)), h('span', { class: 'dot', style: regEffective(r) === 'ACTIVE' ? 'background:var(--ok)' : 'background:var(--muted)' }), h('div', null, h('b', { class: 'mono' }, r.number), ' ', status(regEffective(r)), h('div', { class: 'small muted' }, `${r.authority} · ${({ SANITARY_REGISTRY: 'Registro sanitario', SANITARY_AUTHORIZATION: 'Autorización sanitaria', PLANT_HABILITATION: 'Habilitación de planta', OTHER: 'Otro' })[r.registration_type]} · vence ${F.date(r.expires_on)} · ${r.file_url || 'sin archivo'}`), r.notes ? h('div', { class: 'small' }, r.notes) : null)))));
    }, { code: 'CAL-10', wide: true });
  }
  function sanDrawer(p) {
    drawer('Registrar o renovar registro sanitario', (b, close) => b.appendChild(form({ id: 'cal10-f', values: { product_id: p ? p.id : '', authority: p ? p.sanitary_authority : 'DIGESA', registration_type: 'SANITARY_REGISTRY', issued_on: G.TODAY }, fields: [
      { key: 'product_id', label: 'Producto', type: 'select', required: true, options: G.ui.opts('products', x => `${x.code} · ${x.name}`, x => x.product_type === 'GOODS' && x.sanitary_authority !== 'NONE') }, { key: 'authority', label: 'Autoridad', type: 'select', options: [['SENASA', 'SENASA'], ['DIGESA', 'DIGESA']], required: true },
      { key: 'registration_type', label: 'Tipo', type: 'select', required: true, options: [['SANITARY_REGISTRY', 'Registro sanitario'], ['SANITARY_AUTHORIZATION', 'Autorización sanitaria'], ['PLANT_HABILITATION', 'Habilitación de planta'], ['OTHER', 'Otro']] }, { key: 'number', label: 'Número', required: true },
      { key: 'issued_on', label: 'Emisión', type: 'date', required: true }, { key: 'expires_on', label: 'Vencimiento', type: 'date' }, { key: 'file_url', label: 'Archivo (resolución)', required: true }, { key: 'notes', label: 'Notas', type: 'textarea' }],
      onCancel: close, onSubmit: v => { const r = registerSanitary(v); close(); toast(`Registro ${r.number} guardado y copiado al producto`, 'ok'); G.refresh(); return true; } })), { code: 'CAL-10' });
  }

  /* ---------- CAL-11 Reclamos ---------- */
  function rCAL11(el, params) {
    const body = page(el, { code: 'CAL-11', title: 'Reclamos de calidad', sub: 'Desde el CRM o el pedido: cliente, pedido, comprobante, lote, tipo, fotos y resolución. Los reclamos por mal estado, cuerpo extraño o temperatura con lote abren una no conformidad mayor (RN-CAL-11).', actions: [{ label: 'Registrar reclamo', kind: 'primary', icon: '+', onClick: () => claimDrawer({ order: params.order }) }] });
    const rows = G.scope.filter(G.db.all('quality_claims')).sort(U.by('received_at', -1));
    const k7 = G.kpi('KPI-CAL-07') || {};
    body.appendChild(kpis([{ label: 'Abiertos', value: rows.filter(c => ['OPEN', 'INVESTIGATING'].includes(c.status)).length, tone: 'warn' }, { label: 'Reclamos del mes', value: rows.filter(c => c.received_at >= G.date.month(G.TODAY)).length }, { label: 'Cada 1000 pedidos', value: F.num(k7.value, 1), sub: `KPI-CAL-07 · ${k7.numerator ?? '—'} / ${F.num(k7.denominator)} entregados` }, { label: 'Con no conformidad', value: rows.filter(c => c.nonconformity_id).length }]));
    body.appendChild(table({ id: 'cal11', columns: [
      { key: 'number', label: 'N.º', mono: true }, { key: 'received_at', label: 'Recibido', render: c => F.date(c.received_at) }, { key: 'cust', label: 'Cliente', value: c => G.custName(c.customer_id) }, { key: 'ord', label: 'Pedido', mono: true, value: c => c.sales_order_id ? (G.db.get('sales_orders', c.sales_order_id) || {}).number : '—' },
      { key: 'doc', label: 'Comprobante', value: c => c.sales_document_id ? (G.db.get('sales_documents', c.sales_document_id) || {}).full_number : '—' }, { key: 'prod', label: 'Producto', value: c => (prod(c.product_id) || {}).name || '—' }, { key: 'lot', label: 'Lote', mono: true, value: c => c.lot_id ? lotCode(c.lot_id) : '—' },
      { key: 'claim_type', label: 'Tipo', value: c => claimTypeName(c.claim_type) }, { key: 'nc', label: 'NC', value: c => c.nonconformity_id ? (G.db.get('nonconformities', c.nonconformity_id) || {}).number : '' }, { key: 'status', label: 'Estado', render: c => sb(c.status), value: c => c.status }],
      rows, filters: [{ key: 'status', label: 'Estado', options: [['OPEN', 'Abierto'], ['INVESTIGATING', 'En investigación'], ['RESOLVED', 'Resuelto'], ['REJECTED', 'Rechazado']] }, { key: 'claim_type', label: 'Tipo', options: CLAIM_TYPES }], onRow: c => openClaim(c) }));
    if (params.order) setTimeout(() => claimDrawer({ order: params.order }), 0);
  }
  function claimDrawer(pre) {
    drawer('Registrar reclamo de calidad', (b, close) => {
      const info = h('div');
      const f = form({ id: 'cal11-f', values: { order: pre.order ? (G.db.get('sales_orders', pre.order) || {}).number : '', claim_type: 'SPOILED', channel: 'WHATSAPP' }, fields: [
        { key: 'order', label: 'Pedido (P-…)', required: true, placeholder: 'P-000123', onChange: () => upd() }, { key: 'lot_code', label: 'Lote (código de la etiqueta)', placeholder: 'Se propone el del pedido', onChange: () => upd() },
        { key: 'claim_type', label: 'Tipo', type: 'select', options: CLAIM_TYPES, required: true, onChange: () => upd() }, { key: 'channel', label: 'Canal', type: 'select', options: [['WHATSAPP', 'WhatsApp'], ['PHONE', 'Teléfono'], ['WEB', 'Web'], ['COUNTER', 'Mostrador']], required: true },
        { key: 'description', label: 'Descripción', type: 'textarea', required: true }, { key: 'photo', label: 'Foto del cliente (archivo)' }],
        submitLabel: 'Registrar', onCancel: close, onSubmit: v => {
          const o = G.db.find('sales_orders', x => x.number === String(v.order).trim().toUpperCase()); if (!o) return { order: 'No existe ese pedido.' };
          const l = v.lot_code ? G.db.find('lots', x => x.code === String(v.lot_code).trim().toUpperCase()) : (o.lines.find(x => x.lot_id) ? lot(o.lines.find(x => x.lot_id).lot_id) : null);
          if (v.lot_code && !l) return { lot_code: 'No existe ese lote.' };
          const c = createClaim({ sales_order_id: o.id, lot_id: l ? l.id : null, product_id: l ? l.product_id : G.productOf(o.lines[0].variant_id).id, claim_type: v.claim_type, description: v.description, channel: v.channel, photo_url: v.photo || null });
          close(); toast(`Reclamo ${c.number} registrado${c.nonconformity_id ? ` y no conformidad ${(G.db.get('nonconformities', c.nonconformity_id) || {}).number} abierta (RN-CAL-11)` : ''}`, 'ok'); G.refresh(); openClaim(c); return true;
        } });
      function upd() { const v = f.api.values; const o = G.db.find('sales_orders', x => x.number === String(v.order || '').trim().toUpperCase()); G.ui.clear(info); if (!o) return; const lots = o.lines.filter(x => x.lot_id).map(x => lotCode(x.lot_id)); const types = G.param('cal_claim_nc_types') || []; info.appendChild(notice(`${G.custName(o.customer_id)} · ${G.brandName(o.brand_id)} · entregado ${F.date(o.delivery_date)} · ${o.lines.map(x => G.variantName(x.variant_id)).join(', ')}${lots.length ? ' · lotes ' + lots.join(', ') : ' · sin lote registrado'}${types.includes(v.claim_type) && (v.lot_code || lots.length) ? ' · abrirá una no conformidad MAYOR' : ''}`, 'info')); }
      b.append(f, info); upd();
    }, { code: 'CAL-11' });
  }
  function openClaim(c) {
    c = G.db.get('quality_claims', c.id);
    drawer(`Reclamo ${c.number}`, (b, close) => {
      const doc = c.sales_document_id ? G.db.get('sales_documents', c.sales_document_id) : null;
      b.appendChild(dl([['Cliente', G.custName(c.customer_id)], ['Pedido', c.sales_order_id ? (G.db.get('sales_orders', c.sales_order_id) || {}).number : null], ['Comprobante', doc ? `${doc.full_number} · ${F.money(doc.total)}` : null], ['Producto', (prod(c.product_id) || {}).name], ['Lote', c.lot_id ? lotCode(c.lot_id) : null], ['Tipo', claimTypeName(c.claim_type)], ['Descripción', c.description], ['Foto', c.photo_url], ['Recibido', `${F.datetime(c.received_at)} · ${c.channel}`], ['Estado', sb(c.status)], ['No conformidad', c.nonconformity_id ? (G.db.get('nonconformities', c.nonconformity_id) || {}).number : null], ['Resolución', c.resolution ? (RESOLUTIONS.find(x => x[0] === c.resolution) || [])[1] : null], ['Nota de crédito', c.credit_note_id ? (G.db.get('sales_documents', c.credit_note_id) || {}).full_number : null], ['Resuelto', c.resolved_at ? `${F.datetime(c.resolved_at)} · ${G.userShort(c.resolved_by)}` : null]]));
      b.appendChild(h('div', { class: 'row' }, c.nonconformity_id ? btn('Ver no conformidad', () => { close(); G.go('CAL-08', { id: c.nonconformity_id }); }, { sm: true }) : null, c.lot_id && G.screens['ETQ-04'] ? btn('Trazabilidad del lote', () => { close(); G.go('ETQ-04', { lot: c.lot_id }); }, { sm: true }) : null, c.status === 'OPEN' ? btn('En investigación', () => { G.db.update('quality_claims', c.id, { status: 'INVESTIGATING' }); close(); G.refresh(); openClaim(c); }, { sm: true }) : null));
      if (['OPEN', 'INVESTIGATING'].includes(c.status)) {
        const st = { cn: G.db.find('sales_documents', d => d.doc_type === 'CREDIT_NOTE' && d.related_document_id === c.sales_document_id) };
        const cnBox = h('div');
        const drawCn = () => { G.ui.clear(cnBox); cnBox.appendChild(st.cn ? notice(`Nota de crédito ${st.cn.full_number} por ${F.money(st.cn.total)} lista para vincular.`, 'ok') : h('div', { class: 'row' }, h('input', { class: 'input', id: 'cal11-amt', type: 'number', step: '0.01', placeholder: 'Monto con IGV', style: 'max-width:160px', attrs: { 'aria-label': 'Monto de la nota de crédito' } }), btn('Emitir nota de crédito', () => { try { st.cn = issueCreditNote(c.id, document.getElementById('cal11-amt').value); toast(`Nota de crédito ${st.cn.full_number} emitida`, 'ok'); drawCn(); } catch (e) { toast(e.message, 'bad'); } }, { sm: true, disabled: !doc }))); };
        b.appendChild(card('Resolver', h('div', null, form({ id: 'cal11-res', values: { resolution: 'REPLACEMENT' }, fields: [{ key: 'resolution', label: 'Resolución', type: 'select', options: RESOLUTIONS, required: true }, { key: 'notes', label: 'Detalle', type: 'textarea' }], submitLabel: 'Marcar resuelto',
          onSubmit: v => { resolveClaim(c.id, { resolution: v.resolution, notes: v.notes, credit_note_id: v.resolution === 'CREDIT_NOTE' && st.cn ? st.cn.id : null }); close(); toast('Reclamo resuelto', 'ok'); G.refresh(); return true; } }), h('div', { class: 'small muted', style: 'margin-top:6px' }, 'Con nota de crédito (RN-CAL-12):'), cnBox)));
        drawCn();
      }
    }, { code: 'CAL-11', wide: true });
  }

  /* ---------- CAL-12 Limpieza y BPM ---------- */
  function rCAL12(el) {
    const body = page(el, { code: 'CAL-12', title: 'Limpieza y BPM', sub: 'Cumplimiento de la programación de limpieza, desinfección y BPM por local y área, con sus evidencias. Una tarea no hecha al final del turno cuenta como incumplida (RN-CAL-13).', actions: [{ label: 'Registrar limpieza', kind: 'primary', icon: '+', onClick: () => { const t = tasksFor(G.TODAY, { stages: ['CLEANING', 'BPM'] }).find(x => x.status === 'PENDING'); G.go('CAL-03', t ? { schedule: t.schedule.id, slot: t.slot } : { checklist: 'qc-CHK-LIM' }); } }] });
    const site = G.ctx.site !== 'ALL' ? G.ctx.site : null;
    const opts = { stages: ['CLEANING', 'BPM'], site };
    const m = compliance(G.date.month(G.TODAY), G.TODAY, opts), w = compliance(G.date.add(G.TODAY, -6), G.TODAY, opts);
    const today = tasksFor(G.TODAY, opts);
    body.appendChild(kpis([{ label: 'Cumplimiento del mes', value: F.pct(m.pct), sub: `KPI-CAL-06 · ${m.done} de ${m.prog}`, tone: m.pct >= 95 ? 'ok' : 'warn' }, { label: 'Últimos 7 días', value: F.pct(w.pct), sub: `${w.done} de ${w.prog}` }, { label: 'Hoy hechas', value: `${today.filter(t => t.status === 'DONE').length} de ${today.length}` }, { label: 'Incumplidas del mes', value: m.prog - m.done, tone: m.prog - m.done ? 'bad' : '' }]));
    const days = []; for (let i = 6; i >= 0; i--) days.push(G.date.add(G.TODAY, -i));
    const scheds = G.scope.filter(G.db.all('qc_schedules')).filter(s => ['CLEANING', 'BPM'].includes((G.db.get('qc_checklists', s.checklist_id) || {}).stage));
    const byDay = {}; for (const d of days) byDay[d] = tasksFor(d, opts);
    body.appendChild(card('Últimos 7 días por área', table({ id: 'cal12-mx', search: false, pageSize: 50, columns: [{ key: 'area', label: 'Área' }, { key: 'site', label: 'Local', value: s => G.siteName(s.establishment_id) }, { key: 'f', label: 'Frecuencia', value: s => freqName(s.frequency) }, ...days.map(d => ({ key: d, label: d.slice(8, 10) + '/' + d.slice(5, 7), sort: false, align: 'c', render: s => { const ts = byDay[d].filter(t => t.schedule.id === s.id); if (!ts.length) return h('span', { class: 'muted' }, '·'); return h('span', null, ts.map(t => badge(t.status === 'DONE' ? '✓' : t.status === 'MISSED' ? '✗' : '…', MY[t.status][1]))); } }))], rows: scheds }), { flush: true }));
    const ev = G.db.where('qc_inspections', i => ['CLEANING', 'BPM'].includes(i.stage) && i.inspected_at >= G.date.add(G.TODAY, -6)).filter(i => G.scope.ok(i)).sort(U.by('inspected_at', -1));
    const photos = new Map(G.db.where('qc_inspection_answers', a => a.photo_url).map(a => [a.inspection_id, a.photo_url]));
    body.appendChild(card('Registros y evidencias', table({ id: 'cal12-ev', columns: [{ key: 'inspected_at', label: 'Fecha', render: i => F.datetime(i.inspected_at) }, { key: 'area', label: 'Área' }, { key: 'stage', label: 'Tipo', value: i => stageName(i.stage) }, { key: 'by', label: 'Responsable', value: i => G.userShort(i.inspector_user_id) }, { key: 'ph', label: 'Evidencia', value: i => photos.get(i.id) || '—' }, { key: 'score_pct', label: 'Puntaje', align: 'r', render: i => F.pct(i.score_pct, 0) }, { key: 'result', label: 'Resultado', render: i => sb(i.result) }], rows: ev, onRow: i => openInspection(i) }), { flush: true }));
  }

  /* ---------- CAL-13 Tablero ---------- */
  function rCAL13(el) {
    const body = page(el, { code: 'CAL-13', title: 'Tablero de calidad', sub: 'Indicadores KPI-CAL-01 a KPI-CAL-08 del mes en curso, con el filtro de local de la barra superior.' });
    const val = (c, fmt) => { const r = G.kpi(c) || {}; return fmt(r.value); };
    const k4 = G.kpi('KPI-CAL-04') || {};
    body.appendChild(kpis([
      { label: 'KPI-CAL-01 · Liberados a la primera', value: val('KPI-CAL-01', v => F.pct(v)), tone: 'ok', onClick: () => G.go('CAL-07') },
      { label: 'KPI-CAL-02 · Rechazados o retenidos', value: val('KPI-CAL-02', v => F.pct(v)), onClick: () => G.go('CAL-07') },
      { label: 'KPI-CAL-03 · Temperaturas fuera de rango', value: val('KPI-CAL-03', v => F.pct(v, 2)), onClick: () => G.go('CAL-06') },
      { label: 'KPI-CAL-04 · No conformidades abiertas', value: F.num(k4.value), sub: `antigüedad promedio ${F.days(k4.avg_age_days)}`, tone: k4.value ? 'warn' : 'ok', onClick: () => G.go('CAL-08') },
      { label: 'KPI-CAL-05 · Cumplimiento de checklists', value: val('KPI-CAL-05', v => F.pct(v)), onClick: () => G.go('CAL-02') },
      { label: 'KPI-CAL-06 · Limpieza y BPM', value: val('KPI-CAL-06', v => F.pct(v)), onClick: () => G.go('CAL-12') },
      { label: 'KPI-CAL-07 · Reclamos cada 1000 pedidos', value: val('KPI-CAL-07', v => F.num(v, 1)), onClick: () => G.go('CAL-11') },
      { label: 'KPI-CAL-08 · DIGESA sin registro vigente', value: val('KPI-CAL-08', v => F.num(v)), tone: (G.kpi('KPI-CAL-08') || {}).value ? 'bad' : 'ok', onClick: () => G.go('CAL-10') },
    ]));
    const from = G.date.month(G.TODAY);
    const rd = G.scope.filter(G.db.where('temperature_readings', r => r.read_at >= from));
    const byP = U.groupBy(rd, 'point_id');
    const g = h('div', { class: 'grid c2' });
    g.appendChild(card('Lecturas fuera de rango por punto (% del mes)', G.ui.chart.hbar({ items: Object.entries(byP).map(([pid, rs]) => ({ label: (pointOf(pid) || {}).name, value: R(rs.filter(x => !x.in_range).length / rs.length * 100, 2), tone: rs.some(x => !x.in_range) ? 'bad' : '' })).sort((a, b) => b.value - a.value), format: v => F.pct(v, 1) })));
    const days = []; for (let d = from; d <= G.TODAY; d = G.date.add(d, 1)) days.push(d);
    const site = G.ctx.site !== 'ALL' ? G.ctx.site : null;
    const daily = days.map(d => { const ts = tasksFor(d, { site }).filter(t => t.status !== 'PENDING'); return ts.length ? R(ts.filter(t => t.status === 'DONE').length / ts.length * 100, 1) : 0; });
    g.appendChild(card('Cumplimiento diario de checklists (%)', G.ui.chart.bar({ labels: days.map(d => d.slice(8, 10)), series: [{ name: 'Cumplimiento', values: daily }], format: v => F.pct(v) })));
    const ncs = G.scope.filter(G.db.where('nonconformities', n => n.status !== 'VOIDED'));
    g.appendChild(card('No conformidades por origen', G.ui.chart.hbar({ items: NC_SOURCES.map(([s, n]) => ({ label: n, value: ncs.filter(x => x.source === s).length })).filter(x => x.value) })));
    const decs = G.db.where('lot_quality_decisions', d => d.decided_at >= from);
    g.appendChild(card('Decisiones de lote del mes', G.ui.chart.hbar({ items: DECISIONS.map(([d, n]) => ({ label: n, value: decs.filter(x => x.decision === d).length, tone: d === 'REJECT' ? 'bad' : d === 'HOLD' ? 'warn' : '' })) })));
    body.appendChild(g);
  }

  /* ---------- registro ---------- */
  const S = G.SPEC.CAL;
  const nameOf = c => (S.screens.find(s => s[0] === c) || [c, c])[1];
  const RENDER = { 'CAL-01': rCAL01, 'CAL-02': rCAL02, 'CAL-03': rCAL03, 'CAL-04': rCAL04, 'CAL-05': rCAL05, 'CAL-06': rCAL06, 'CAL-07': rCAL07, 'CAL-08': rCAL08, 'CAL-09': rCAL09, 'CAL-10': rCAL10, 'CAL-11': rCAL11, 'CAL-12': rCAL12, 'CAL-13': rCAL13 };
  G.register({ code: 'CAL', name: S.name, phase: 2, group: 'Producción y calidad', screens: Object.keys(RENDER).map(code => ({ code, name: nameOf(code), render: RENDER[code] })) });

  /* ---------- indicadores ---------- */
  const inRange = (s, p) => { const d = String(s || '').slice(0, 10); return d >= p.from && d <= p.to; };
  function lotDecisionStats(p) {
    const byLot = U.groupBy(G.db.where('lot_quality_decisions', d => inRange(d.decided_at, p)), 'lot_id');
    const lots = Object.keys(byLot);
    const first = lots.filter(id => byLot[id].sort(U.by('decided_at'))[0].decision === 'RELEASE').length;
    const bad = lots.filter(id => byLot[id].some(d => ['REJECT', 'HOLD'].includes(d.decision))).length;
    return { n: lots.length, first, bad };
  }
  G.kpiCalc['KPI-CAL-01'] = p => { const s = lotDecisionStats(p); return { value: s.n ? R(s.first / s.n * 100, 1) : null, numerator: s.first, denominator: s.n }; };
  G.kpiCalc['KPI-CAL-02'] = p => { const s = lotDecisionStats(p); return { value: s.n ? R(s.bad / s.n * 100, 1) : null, numerator: s.bad, denominator: s.n }; };
  G.kpiCalc['KPI-CAL-03'] = p => { const rs = G.db.where('temperature_readings', r => inRange(r.read_at, p) && (!p.site || r.establishment_id === p.site)); const out = rs.filter(r => !r.in_range).length; return { value: rs.length ? R(out / rs.length * 100, 2) : null, numerator: out, denominator: rs.length }; };
  G.kpiCalc['KPI-CAL-04'] = p => { const at = p.to; const open = G.db.where('nonconformities', n => n.detected_at.slice(0, 10) <= at && n.status !== 'VOIDED' && (n.status !== 'CLOSED' || (n.closed_at || '').slice(0, 10) > at) && (!p.site || n.establishment_id === p.site)); return { value: open.length, avg_age_days: open.length ? R(U.sum(open, n => G.date.diff(at, n.detected_at.slice(0, 10))) / open.length, 1) : 0 }; };
  G.kpiCalc['KPI-CAL-05'] = p => { const c = compliance(p.from, p.to, { site: p.site }); return { value: c.pct, numerator: c.done, denominator: c.prog }; };
  G.kpiCalc['KPI-CAL-06'] = p => { const c = compliance(p.from, p.to, { site: p.site, stages: ['CLEANING', 'BPM'] }); return { value: c.pct, numerator: c.done, denominator: c.prog }; };
  /** reclamos de calidad / pedidos entregados × 1000 */
  const per1000 = (claims, delivered) => delivered ? R(claims / delivered * 1000, 1) : null;
  G.cal.per1000 = per1000;
  G.kpiCalc['KPI-CAL-07'] = p => { const cl = G.db.where('quality_claims', c => inRange(c.received_at, p) && (!p.brand || c.brand_id === p.brand) && (!p.site || c.establishment_id === p.site)).length; const del = G.sales.orders(p).length; return { value: per1000(cl, del), numerator: cl, denominator: del }; };
  G.kpiCalc['KPI-CAL-08'] = p => { const at = p.to || G.TODAY; const list = G.db.where('products', x => x.status === 'ACTIVE' && x.sanitary_authority === 'DIGESA' && x.product_type === 'GOODS' && (!p.brand || x.brand_id === p.brand)).filter(x => !sanitaryValid(x.id, at)); return { value: list.length, items: list.map(x => x.name) }; };

  /* ---------- alertas, búsqueda y escáner ---------- */
  G.alertProviders.push(() => {
    if (!G.modOn('CAL') || !G.canSee('CAL')) return [];
    const out = [];
    const exc = G.db.where('temperature_excursions', e => e.status === 'OPEN' && !e.ended_at);
    if (exc.length) out.push({ module: 'CAL', title: `${exc.length} excursión(es) de temperatura en curso`, detail: exc.map(e => `${(pointOf(e.point_id) || {}).name} ${T(e.max_value_c ?? e.first_value_c)}`).join(' · ') + ' (RN-CAL-04)', tone: 'bad', go: () => G.go('CAL-06') });
    const miss = missingReadings();
    if (miss.length) out.push({ module: 'CAL', title: `${miss.length} punto(s) sin lectura a tiempo`, detail: miss.slice(0, 3).map(p => p.name).join(', ') + ' (RN-CAL-14)', tone: 'warn', go: () => G.go('CAL-05') });
    const q = G.db.where('lots', l => l.qc_status === 'QUARANTINE');
    if (q.length) out.push({ module: 'CAL', title: `${q.length} lote(s) en cuarentena por decidir`, detail: q.slice(0, 4).map(l => l.code).join(', '), tone: 'info', go: () => G.go('CAL-07') });
    const late = G.db.where('nonconformities', n => !['CLOSED', 'VOIDED'].includes(n.status) && n.due_date < G.TODAY);
    if (late.length) out.push({ module: 'CAL', title: `${late.length} no conformidad(es) vencida(s)`, detail: late.map(n => n.number).join(', '), tone: 'warn', go: () => G.go('CAL-08') });
    const second = G.param('cal_sanitary_second_alert_days') ?? 30;
    const san = G.db.where('products', p => p.status === 'ACTIVE' && p.product_type === 'GOODS' && ['SENASA', 'DIGESA'].includes(p.sanitary_authority)).map(p => [p, sanitaryState(p.id)]).filter(([, s]) => ['SECOND', 'EXPIRED', 'NONE_REG'].includes(s.st));
    if (san.length) out.push({ module: 'CAL', title: `${san.length} registro(s) sanitario(s) vencido(s) o a ≤ ${second} días`, detail: san.slice(0, 3).map(([p, s]) => `${p.name} (${s.days == null ? 'vencido' : s.days + ' d'})`).join(', ') + ' (RN-CAL-09)', tone: 'bad', go: () => G.go('CAL-10') });
    return out;
  });
  G.searchProviders.push(q => {
    const s = q.toLowerCase(); const out = [];
    for (const n of G.db.all('nonconformities')) if (n.number.toLowerCase().includes(s)) out.push({ label: n.number, sub: 'No conformidad · ' + n.description.slice(0, 60), go: () => G.go('CAL-08', { id: n.id }) });
    for (const c of G.db.all('quality_claims')) if (c.number.toLowerCase().includes(s)) out.push({ label: c.number, sub: 'Reclamo de calidad · ' + G.custName(c.customer_id), go: () => G.go('CAL-11') });
    for (const i of G.db.all('qc_inspections')) if (i.number.toLowerCase() === s) out.push({ label: i.number, sub: 'Inspección', go: () => { G.go('CAL-03'); openInspection(i); } });
    return out.slice(0, 6);
  });
  G.scanHandlers.push(code => {
    const n = G.db.find('nonconformities', x => x.number === code); if (n) return () => G.go('CAL-08', { id: n.id });
    const p = G.db.find('temperature_points', x => x.code === code); if (p) return () => { G.go('CAL-05'); readingDrawer(p); };
    const i = G.db.find('qc_inspections', x => x.number === code); if (i) return () => { G.go('CAL-03'); openInspection(i); };
    return null;
  });

  /* =====================================================================
     Pruebas de aceptación (una por CA-CAL)
     ===================================================================== */
  const asRole = async (role, fn) => { const prev = G.ctx.role; G.ctx.role = role; try { return await fn(); } finally { G.ctx.role = prev; } };
  const expectFail = (fn, code) => { try { fn(); } catch (e) { if (!String(e.message).startsWith(code)) throw new Error(`Se esperaba ${code} y salió: ${e.message}`); return e; } throw new Error(`Se esperaba el rechazo ${code} y la operación pasó.`); };
  const chLot = () => G.db.find('lots', l => l.code === 'CH-2026-0412');
  G.tests.push({ module: 'CAL', name: 'CA-CAL-01: el jefe que supervisó la orden no libera CH-2026-0412 (RN-CAL-02); calidad con inspección PASS lo deja RELEASED', fn: async () => {
    const l = chLot(); if (!l || l.qc_status !== 'QUARANTINE') throw new Error('CH-2026-0412 debe estar en cuarentena.');
    await asRole('JEFE_PRODUCCION', () => expectFail(() => G.cal.release(l.id), 'RN-CAL-02'));
    if (lot(l.id).qc_status !== 'QUARANTINE') throw new Error('El lote no debió cambiar.');
    await asRole('CALIDAD', () => { const i = lotInspections(l).find(x => x.result === 'PASS'); if (!i) throw new Error('Falta la inspección PASS sembrada.'); const d = G.cal.release(l.id); if (d.decided_by !== uidOf('CALIDAD')) throw new Error('Decidió otra persona.'); });
    if (lot(l.id).qc_status !== 'RELEASED') throw new Error('El lote debió quedar RELEASED.');
    if (!G.db.find('domain_events', e => e.name === 'lot.released' && e.payload.lot_id === l.id)) throw new Error('No se emitió lot.released.');
  } });
  G.tests.push({ module: 'CAL', name: 'CA-CAL-02: un UPDATE directo de qc_status a RELEASED se rechaza con RN-CAL-01', fn: async () => {
    const l = chLot();
    expectFail(() => G.db.update('lots', l.id, { qc_status: 'RELEASED' }), 'RN-CAL-01');
    if (lot(l.id).qc_status !== 'QUARANTINE') throw new Error('El estado cambió sin decisión.');
  } });
  G.tests.push({ module: 'CAL', name: 'CA-CAL-03: cámara 1 L1 (0–4 °C) a 6,5 °C abre excursión con desviación 2,5; 3,0 °C registra el fin; cerrar sin acción → RN-CAL-05', fn: async () => {
    const p = G.db.find('temperature_points', x => x.code === 'TP-CAM-L1');
    if (p.min_c !== 0 || p.max_c !== 4) throw new Error('Rango de la cámara 1 distinto de 0–4 °C.');
    if (openExc(p.id)) throw new Error('No debía haber excursión abierta al inicio.');
    const r1 = G.cal.recordReading(p.id, 6.5, { at: G.TODAY + 'T10:00' });
    if (!r1.opened || r1.excursion.max_deviation_c !== 2.5) throw new Error('Desviación esperada 2,5 °C; salió ' + (r1.excursion || {}).max_deviation_c);
    const r2 = G.cal.recordReading(p.id, 3.0, { at: G.TODAY + 'T10:40' });
    if (!r2.reading.in_range || G.db.get('temperature_excursions', r1.excursion.id).ended_at !== G.TODAY + 'T10:40') throw new Error('La lectura en rango no registró el fin.');
    expectFail(() => G.cal.closeExcursion(r1.excursion.id, ''), 'RN-CAL-05');
    G.cal.closeExcursion(r1.excursion.id, 'Se revisó la puerta de la cámara');
    if (G.db.get('temperature_excursions', r1.excursion.id).status !== 'CLOSED') throw new Error('No se cerró con la acción escrita.');
  } });
  G.tests.push({ module: 'CAL', name: 'CA-CAL-04: una no conformidad con una acción correctiva pendiente no se cierra (RN-CAL-06)', fn: async () => {
    const nc = G.cal.createNC({ source: 'PROCESS', severity: 'MINOR', description: 'Prueba: mesa sin desinfectar', establishment_id: 'es-L2', root_cause: 'Falta de supervisión' });
    G.cal.addAction(nc.id, { action_type: 'CORRECTIVE', description: 'Capacitar al turno tarde' });
    expectFail(() => G.cal.closeNC(nc.id), 'RN-CAL-06');
    const a = ncActions(nc.id)[0]; G.cal.setActionStatus(a.id, 'DONE', 'Lista de asistencia');
    G.cal.closeNC(nc.id);
    if (G.db.get('nonconformities', nc.id).status !== 'CLOSED') throw new Error('Con la acción terminada debió cerrarse.');
  } });
  G.tests.push({ module: 'CAL', name: 'CA-CAL-05: checklist de empaque de 10 ítems con 1 crítico no conforme (90 %) → FAIL', fn: async () => {
    const chk = G.db.find('qc_checklists', c => c.code === 'CHK-EMP' && c.status === 'ACTIVE'); const its = itemsOf(chk.id);
    if (its.length !== 10 || its.filter(i => i.is_critical).length !== 1) throw new Error('El checklist de empaque debe tener 10 ítems y 1 crítico.');
    const ans = {}; for (const it of its) ans[it.id] = it.answer_type === 'YES_NO' ? { answer_bool: !it.is_critical } : it.answer_type === 'NUMBER' ? { answer_num: 3 } : it.answer_type === 'PHOTO' ? { photo_url: 'f.jpg' } : { answer_text: 'ok' };
    const i = G.cal.inspect({ checklist_id: chk.id, establishment_id: 'es-L2', answers: ans });
    if (i.score_pct !== 90) throw new Error('Puntaje esperado 90 %; salió ' + i.score_pct);
    if (i.result !== 'FAIL') throw new Error('Con un crítico no conforme el resultado debe ser FAIL.');
  } });
  G.tests.push({ module: 'CAL', name: 'CA-CAL-06: reclamo por producto en mal estado del lote CH-2026-0412 crea una no conformidad MAJOR vinculada', fn: async () => {
    const l = chLot(); const o = G.db.find('sales_orders', x => x.status === 'CLOSED' && x.brand_id === 'br-M3');
    const c = G.cal.createClaim({ sales_order_id: o.id, lot_id: l.id, claim_type: 'SPOILED', description: 'Chorizo con olor agrio al abrir' });
    const nc = G.db.get('nonconformities', c.nonconformity_id);
    if (!nc || nc.severity !== 'MAJOR' || nc.source !== 'CUSTOMER_CLAIM' || nc.lot_id !== l.id) throw new Error('No se creó la NC MAJOR del reclamo vinculada al lote.');
  } });
  G.tests.push({ module: 'CAL', name: 'CA-CAL-07: mermelada de aguaymanto con DIGESA vencido el 30/09/2026 → liberar el 10/10/2026 se rechaza con RN-CAL-10', fn: async () => {
    const p = G.db.find('products', x => x.code === 'MERM');
    const reg = G.db.where('sanitary_registrations', r => r.product_id === p.id).sort(U.by('expires_on', -1))[0];
    if (!reg || reg.expires_on !== '2026-09-30' || p.sanitary_authority !== 'DIGESA') throw new Error('La mermelada debe tener DIGESA vencido el 30/09/2026.');
    const l = G.db.find('lots', x => x.code === 'ME-2026-1010');
    await asRole('CALIDAD', () => expectFail(() => G.cal.release(l.id, { at: '2026-10-10T12:00' }), 'RN-CAL-10'));
    if (lot(l.id).qc_status !== 'QUARANTINE') throw new Error('El lote no debió liberarse.');
  } });
  G.tests.push({ module: 'CAL', name: 'CA-CAL-08: 3 reclamos de calidad en octubre con ~1000 pedidos al mes → 3,0 reclamos cada 1000 pedidos', fn: async () => {
    const oct = { from: '2026-10-01', to: '2026-10-31' };
    const k = G.kpi('KPI-CAL-07', oct);
    if (k.numerator !== 3) throw new Error('Se esperaban 3 reclamos en octubre; hay ' + k.numerator);
    if (G.cal.per1000(3, 1000) !== 3) throw new Error('3 reclamos / 1000 pedidos debe dar 3,0.');
    if (k.value !== R(3 / k.denominator * 1000, 1)) throw new Error('El indicador no usa reclamos / entregados × 1000.');
    const sep = G.kpi('KPI-CAL-07', { from: '2026-09-01', to: '2026-09-30' });
    if (sep.denominator < 900 || sep.denominator > 1100) throw new Error('Setiembre debe tener ~1000 pedidos entregados; hay ' + sep.denominator);
  } });
})();
