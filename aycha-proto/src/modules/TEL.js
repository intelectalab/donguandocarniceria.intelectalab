/* =====================================================================
   TEL · Telefonía con grabación (Fase 1, INCLUIDA Y DESACTIVADA)
   Decisión de gerencia (10/10/2026): incluir la central de llamadas
   grabadas y dejarla lista para activar más adelante; por el momento no.
   Mientras tenant_modules.TEL = false toda acción de negocio (llamar,
   atender, grabar, transcribir, escuchar, purgar) se rechaza con
   RN-PLT-07. La configuración y la lista de activación sí funcionan para
   dejarlo preparado. Los datos sembrados son una vista previa.
   ===================================================================== */
(function () {
  const { h, btn, badge, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs, pills } = G.ui;
  const U = G.util;
  const R = (n, d = 2) => U.round(n, d);
  const T = G.tel = G.tel || {};
  const ins = (t, r) => G.db.insert(t, r, { silent: true });

  const STEPS = [[1, 'PROVIDER_AND_NUMBERS', 'Proveedor y números', 'Contrato con el proveedor (Twilio u otro con números de Lima) y números comprados'], [2, 'CARRIER_FORWARDING', 'Desvío del operador', 'El operador desvía las llamadas de los celulares de la publicidad al número de la central'], [3, 'RECORDING_NOTICE', 'Aviso grabado', 'Audio «Esta llamada puede ser grabada para fines de calidad» cargado (RN-TEL-04, Ley 29733)'], [4, 'SELLER_USERS', 'Usuarios de vendedoras', 'Cada vendedora con usuario, softphone y grupo de llamada'], [5, 'SIGNED_POLICY', 'Política firmada', 'Política de grabación y datos personales firmada por las vendedoras'], [6, 'SWITCH_ON', 'Encendido', 'Módulo encendido en PLT-12 y llamada de prueba completa']];
  const DIR = [['INBOUND', 'Entrante'], ['OUTBOUND', 'Saliente']];
  const CST = { RINGING: ['Sonando', 'info'], IN_PROGRESS: ['En curso', 'info'], COMPLETED: ['Atendida', 'ok'], MISSED: ['Perdida', 'bad'], VOICEMAIL: ['Buzón', 'warn'], FAILED: ['Fallida', 'bad'], BUSY: ['Ocupado', 'warn'], NO_ANSWER: ['Sin respuesta', 'bad'], SETUP: ['Preparación', 'warn'], LIVE: ['En producción', 'ok'], AVAILABLE: ['Disponible', 'ok'], PURGED: ['Purgada', ''], OPEN: ['Abierta', 'warn'], DONE: ['Hecha', 'ok'], EXPIRED: ['Vencida', 'bad'], CANCELLED: ['Cancelada', ''], UNDER_REVIEW: ['En revisión', 'info'], DISMISSED: ['Descartada', ''], CONFIRMED: ['Confirmada', 'bad'], ACTIVE: ['Activo', 'ok'], INACTIVE: ['Inactivo', ''], PLAY: ['Escucha', 'info'], DOWNLOAD: ['Descarga', 'warn'] };
  const st = s => CST[s] ? badge(CST[s][0], CST[s][1]) : G.ui.status(s);
  const stName = s => CST[s] ? CST[s][0] : G.ui.statusLabel(s);
  const KIND = [['LANDLINE_LIMA', 'Fijo de Lima'], ['VIRTUAL_MOBILE', 'Móvil virtual'], ['TOLL_FREE', 'Línea gratuita 0800']];
  const kindName = k => (KIND.find(x => x[0] === k) || [k, k])[1];
  const MISSED = ['MISSED', 'NO_ANSWER', 'VOICEMAIL'];
  T.STEPS = STEPS; T.status = st;
  /** tarifas por minuto en USD (D-TEL-01 Twilio por defecto) */
  T.RATES_DEFAULT = { out_mobile: 0.074, out_landline: 0.0158, inbound: 0.0085, recording: 0.0025, transcription: 0.05 };

  /* ------------------------------------------------------------------
     Apoyo
     ------------------------------------------------------------------ */
  const addMin = (iso, m) => { const s = String(iso); const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +(s.slice(11, 13) || 0), +(s.slice(14, 16) || 0), +(s.slice(17, 19) || 0))); d.setUTCSeconds(d.getUTCSeconds() + Math.round(m * 60)); return d.toISOString().slice(0, 19); };
  T.addMin = addMin;
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const e164 = p => { const d = String(p || '').replace(/[^\d+]/g, ''); if (d.startsWith('+')) return d; if (/^9\d{8}$/.test(d)) return '+51' + d; if (/^51\d{9}$/.test(d)) return '+' + d; if (/^1\d{7}$/.test(d)) return '+51' + d; return d ? '+' + d : ''; };
  T.e164 = e164;
  T.settings = () => G.db.find('tel_settings', x => x.singleton);
  T.rates = () => Object.assign({}, T.RATES_DEFAULT, (T.settings() || {}).rates || {});
  T.isLive = () => G.modOn('TEL') && (T.settings() || {}).stage === 'LIVE';
  /** toda acción de negocio: módulo encendido (RN-PLT-07) y etapa LIVE (RN-TEL-02) */
  T.assertCalls = function () {
    G.assertMod('TEL');
    const s = T.settings();
    if (!s || s.stage !== 'LIVE') G.fail('RN-TEL-02', 'TEL está en preparación (SETUP): se configura todo, pero aún no se cursan llamadas. Completa los 6 pasos y pásalo a producción en TEL-01.');
  };
  /** simulación del guardia tel_guard de la BD: con TEL apagado rechaza escribir en cualquier tabla tel_* */
  T.dbWrite = function (tableName, row, opts = {}) {
    if (!/^tel_/.test(tableName)) G.fail('RN-PLT-07', 'tel_guard solo protege tablas tel_*.');
    G.assertMod('TEL');
    return G.db.insert(tableName, row, opts);
  };
  /** API simulada /api/v1/tel/*: 403 con RN-PLT-07 mientras el módulo esté apagado */
  T.api = function (method, path, body) {
    if (!G.modOn('TEL')) return { status: 403, code: 'RN-PLT-07', message: 'RN-PLT-07: el módulo TEL está desactivado para esta empresa.' };
    try {
      if (method === 'GET' && /\/calls$/.test(path)) return { status: 200, data: T.visibleCalls() };
      if (method === 'PUT' && /\/settings$/.test(path)) return { status: 200, data: T.saveSettings(body || {}, { via: 'API' }) };
      if (method === 'POST' && /\/calls$/.test(path)) return { status: 201, data: T.click2call(body || {}) };
      return { status: 404, message: 'Ruta no encontrada' };
    } catch (e) { return { status: e.code === 'RN-TEL-11' ? 403 : 422, code: e.code, message: e.message }; }
  };
  T.officialNumbers = function () {
    const s = new Set();
    for (const c of G.db.where('messaging_channels', c => c.kind === 'WHATSAPP')) s.add(e164(c.number));
    for (const n of G.db.all('tel_numbers')) { s.add(n.e164); for (const f of n.forwarded_from || []) s.add(e164(f)); }
    for (const a of G.db.where('cash_accounts', a => a.account_type === 'WALLET')) s.add(e164(a.account_number));
    return s;
  };
  T.callerOf = function (num) {
    const n = e164(num);
    const c = G.db.find('customers', x => x.phone && e164(x.phone) === n);
    if (c) return { customer: c };
    const l = G.db.find('leads', x => x.phone && e164(x.phone) === n);
    return l ? { lead: l } : {};
  };
  T.numberFor = function (brand_id) {
    const nums = G.db.where('tel_numbers', n => n.status === 'ACTIVE');
    return nums.find(n => n.brand_id === brand_id) || nums.find(n => !n.brand_id) || nums[0] || null;
  };
  T.group = brand_id => G.db.find('tel_ring_groups', g => g.brand_id === brand_id) || G.db.find('tel_ring_groups', g => g.brand_id === 'br-DG');
  /** orden de timbre del grupo (RN-TEL-06): por turno, cada vendedora ring_timeout_s en orden de prioridad; o todas a la vez */
  T.ringPlan = function (group) {
    if (!group) return [];
    const ms = G.db.where('tel_ring_members', m => m.group_id === group.id && m.active).sort(U.by('priority'));
    const to = group.ring_timeout_s || (T.settings() || {}).ring_timeout_s || 25;
    if (group.strategy === 'SIMULTANEOUS') return [{ users: ms.map(m => m.user_id), from_s: 0, to_s: to }];
    return ms.map((m, i) => ({ users: [m.user_id], from_s: i * to, to_s: (i + 1) * to }));
  };
  /** tareas de devolver llamada: crm_tasks (CALLBACK) + vista previa sembrada en la llamada */
  T.tasks = function () {
    const out = G.db.where('crm_tasks', t => t.task_type === 'CALLBACK').map(t => Object.assign({ source: 'CRM' }, t));
    for (const c of G.db.all('tel_calls')) if (c.preview_task) out.push(Object.assign({ id: 'pt-' + c.id, source: 'PREVIEW', task_type: 'CALLBACK', call_id: c.id, customer_id: c.customer_id, brand_id: c.brand_id }, c.preview_task));
    return out;
  };
  /** alertas de llamadas: control_alerts (CALL_TRANSCRIPT) + vista previa sembrada en la transcripción */
  T.alerts = function () {
    const out = G.db.where('control_alerts', a => a.source_type === 'CALL_TRANSCRIPT').map(a => Object.assign({ source: 'CRM' }, a));
    for (const t of G.db.all('tel_transcripts')) for (const [i, a] of (t.preview_alerts || []).entries()) out.push(Object.assign({ id: 'pa-' + t.id + '-' + i, source: 'PREVIEW', source_type: 'CALL_TRANSCRIPT', call_id: t.call_id }, a));
    return out;
  };
  T.visibleCalls = function () {
    const all = G.scope.filter(G.db.all('tel_calls'), { brand: 'brand_id', site: '_none' });
    if (G.can('tel.call.view_all')) return all;
    const me = G.ctx.userId();
    return all.filter(c => c.user_id === me);
  };

  /* ------------------------------------------------------------------
     Activación y ajustes · RN-TEL-01, 02, 03
     ------------------------------------------------------------------ */
  T.prepareActivation = function () {
    let s = T.settings();
    if (!s) s = G.db.insert('tel_settings', { id: 'tel-settings', singleton: true, provider: 'TWILIO', connector_id: null, stage: 'SETUP', recording_enabled: true, transcription_enabled: !!G.param('tel_transcription_enabled'), recording_notice_text: 'Gracias por llamar. Esta llamada puede ser grabada para fines de calidad.', notice_audio_file_id: null, retention_days: Number(G.param('tel_retention_days')) || 180, ring_strategy: 'ROUND_ROBIN', ring_timeout_s: Number(G.param('tel_ring_timeout_s')) || 25, callback_due_minutes: Number(G.param('tel_callback_due_minutes')) || 30, outbound_registered_only: G.param('tel_outbound_registered_only') !== false, rates: Object.assign({}, T.RATES_DEFAULT) }, { silent: G._seeding });
    else if (s.stage !== 'LIVE') s.stage = 'SETUP';
    for (const [no, code] of STEPS) if (!G.db.find('tel_activation_steps', x => x.step_no === no)) G.db.insert('tel_activation_steps', { step_no: no, step_code: code, done: false, done_by: null, done_at: null, evidence_file_id: null, notes: null }, { silent: true });
    G.db.touch();
    return s;
  };
  G.events.on('module.enabled', p => { if (p && p.module === 'TEL') T.prepareActivation(); });
  G.events.on('module.disabled', p => { if (p && p.module === 'TEL') { const s = T.settings(); if (s && s.stage === 'LIVE') { s.stage = 'SETUP'; s.disabled_at = G.date.now(); G.db.touch(); } } });
  const needManage = () => { if (!G.can('tel.settings.manage')) G.fail('RN-TEL-02', `Tu rol (${G.roleName()}) no tiene el permiso tel.settings.manage (ajustes y lista de activación).`); };
  T.markStep = function (no, { done = true, notes, evidence } = {}) {
    needManage();
    const s = G.db.find('tel_activation_steps', x => x.step_no === no);
    if (!s) G.fail('RN-TEL-02', 'Paso no encontrado.');
    if (no === 6 && done) G.assertMod('TEL');
    if (done && !notes && !s.notes && !evidence) G.fail('RN-TEL-02', `El paso ${no} exige evidencia o nota (qué se hizo y dónde está el respaldo).`);
    return G.db.update('tel_activation_steps', s.id, { done, done_by: done ? G.ctx.userId() : null, done_at: done ? G.date.now() : null, notes: notes || s.notes, evidence: evidence || s.evidence || null });
  };
  T.goLive = function () {
    G.assertMod('TEL'); needManage();
    const steps = G.db.all('tel_activation_steps');
    const missing = STEPS.filter(([no]) => { const s = steps.find(x => x.step_no === no); return !s || !s.done || !s.done_by || !s.done_at; });
    if (missing.length) G.fail('RN-TEL-02', `Para pasar a producción faltan ${missing.length} de 6 pasos: ${missing.map(m => m[0] + '. ' + m[2]).join(', ')}.`);
    const s = T.settings(); G.db.update('tel_settings', s.id, { stage: 'LIVE', live_at: G.date.now(), live_by: G.ctx.userId() });
    return s;
  };
  T.backToSetup = function (reason) { needManage(); if (!reason) G.fail('RN-TEL-02', 'Volver a preparación exige motivo.'); const s = T.settings(); G.db.update('tel_settings', s.id, { stage: 'SETUP', setup_reason: reason }); return s; };
  /** ajustes (preparación): con el módulo apagado quedan guardados para el encendido; la API externa sigue respondiendo 403 */
  T.saveSettings = function (patch, opts = {}) {
    if (opts.via === 'API') G.assertMod('TEL');
    needManage();
    const s = T.settings() || T.prepareActivation();
    const p = Object.assign({}, patch);
    if (p.provider && !['FAKE', 'TWILIO', 'OTHER'].includes(p.provider)) G.fail('RN-TEL-03', 'Proveedor no válido: FAKE, TWILIO u OTHER.');
    if (p.retention_days != null && !(p.retention_days >= 1 && p.retention_days <= 3650)) G.fail('RN-TEL-10', 'La retención va de 1 a 3650 días.');
    if (p.ring_timeout_s != null && !(p.ring_timeout_s >= 5 && p.ring_timeout_s <= 120)) G.fail('RN-TEL-06', 'El tiempo de timbre va de 5 a 120 segundos.');
    if (p.callback_due_minutes != null && !(p.callback_due_minutes > 0)) G.fail('RN-TEL-07', 'El plazo para devolver la llamada debe ser mayor que cero.');
    if (p.recording_enabled && !(p.recording_notice_text || s.recording_notice_text)) G.fail('RN-TEL-04', 'Con grabación activa el aviso es obligatorio.');
    const before = { retention_days: s.retention_days, callback_due_minutes: s.callback_due_minutes, ring_timeout_s: s.ring_timeout_s, transcription_enabled: s.transcription_enabled, outbound_registered_only: s.outbound_registered_only };
    G.db.update('tel_settings', s.id, p);
    const map = { retention_days: 'tel_retention_days', callback_due_minutes: 'tel_callback_due_minutes', ring_timeout_s: 'tel_ring_timeout_s', transcription_enabled: 'tel_transcription_enabled', outbound_registered_only: 'tel_outbound_registered_only' };
    for (const [k, pk] of Object.entries(map)) if (p[k] !== undefined && p[k] !== before[k]) G.setParam(pk, p[k], opts.reason || 'Ajuste en TEL-02');
    return s;
  };

  /* ------------------------------------------------------------------
     Llamadas · RN-TEL-04 a 08, 12
     ------------------------------------------------------------------ */
  function callCost(direction, to, seconds, recorded) {
    const r = T.rates(); const min = Math.ceil((seconds || 0) / 60);
    const voice = direction === 'OUTBOUND' ? (/^\+519/.test(to) ? r.out_mobile : r.out_landline) : r.inbound;
    return R(min * voice + (recorded ? min * r.recording : 0), 4);
  }
  function createTask(call, at) {
    const s = T.settings(); const due = addMin(at, s.callback_due_minutes || Number(G.param('tel_callback_due_minutes')) || 30);
    if (G.db.find('crm_tasks', t => t.call_id === call.id && t.status === 'OPEN')) return null; // una sola tarea abierta por llamada
    const row = { task_type: 'CALLBACK', customer_id: call.customer_id || null, lead_id: call.lead_id || null, conversation_id: null, call_id: call.id, order_id: null, assigned_user_id: call.user_id || (T.ringPlan(T.group(call.brand_id))[0] || { users: [] }).users[0] || null, brand_id: call.brand_id, due_at: due, status: 'OPEN', done_at: null, result: null, phone: call.from_e164 };
    let t = null;
    if (G.crm && typeof G.crm.createTask === 'function') { try { t = G.crm.createTask(row); } catch (e) { if (e instanceof G.RuleError) throw e; } }
    if (!t) t = G.db.insert('crm_tasks', row);
    if (t.assigned_user_id) G.notify({ user_id: t.assigned_user_id, title: 'Devolver llamada perdida', body: `${call.from_e164} · vence ${G.fmt.datetime(due)}`, ref: call.id, tone: 'warn', module: 'TEL' });
    return t;
  }
  function closeCallbacks(num, at) {
    const out = [];
    for (const t of G.db.where('crm_tasks', t => t.task_type === 'CALLBACK' && t.status === 'OPEN')) {
      const c = t.call_id && G.db.get('tel_calls', t.call_id);
      if ((c && e164(c.from_e164) === e164(num)) || (t.phone && e164(t.phone) === e164(num))) out.push(G.db.update('crm_tasks', t.id, { status: 'DONE', done_at: at, result: 'Se cerró sola: el cliente volvió a llamar y fue atendido (RN-TEL-07)' }));
    }
    return out;
  }
  function ensureLead(num, brand_id, at) {
    if (G.crm && typeof G.crm.createLead === 'function') { try { const l = G.crm.createLead({ brand_id, phone: num, source: 'PHONE', first_contact_at: at }); if (l && l.id) return l; } catch (e) { if (e instanceof G.RuleError) throw e; } }
    return G.db.insert('leads', { brand_id, channel_id: null, customer_id: null, full_name: null, phone: num, source: 'PHONE', owner_user_id: null, status: 'NEW', first_contact_at: at, notes: 'Lead creado al sonar una llamada (RN-TEL-08)' });
  }
  /** graba la llamada: sin aviso no se guarda (RN-TEL-04) */
  T._record = function (call) {
    const s = T.settings();
    if (!s.recording_enabled) return null;
    if (!call.notice_played) { G.db.update('tel_calls', call.id, { recording_skipped: 'RN-TEL-04: sin aviso de grabación' }, { silent: true }); return null; }
    const day = String(call.started_at).slice(0, 10);
    const retention_until = G.date.add(day, s.retention_days || 180);
    const file = G.db.insert('file_attachments', { module_code: 'TEL', entity_type: 'tel_calls', entity_id: call.id, storage_key: 'tel/rec/' + call.id + '.mp3', file_name: 'llamada-' + call.id + '.mp3', mime_type: 'audio/mpeg', size_bytes: Math.max(1, (call.duration_seconds || 1) * 8000), sha256: Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[(call.id.charCodeAt(i % call.id.length) + i) % 16]).join(''), classification: 'PERSONAL_DATA', status: 'ACTIVE', retention_until }, { silent: true });
    const rec = T.dbWrite('tel_recordings', { call_id: call.id, file_id: file.id, duration_seconds: call.duration_seconds || 0, provider_recording_id: 'RE' + call.id.replace(/\W/g, ''), retention_until, legal_hold: false, status: 'AVAILABLE', purged_at: null });
    if (s.transcription_enabled) T.transcribe(rec.id);
    return rec;
  };
  /**
   * Llamada entrante (proveedor → webhook). {from_e164, number_id, option, at, status:'COMPLETED'|'MISSED'|'NO_ANSWER'|'VOICEMAIL'|'BUSY', user_id, wait_seconds, duration_seconds, order_id}
   */
  T.registerInbound = function (d) {
    T.assertCalls();
    const s = T.settings();
    const at = d.at || G.date.now();
    const from = e164(d.from_e164);
    if (!G.util.phoneOk(from)) G.fail('RN-TEL-08', 'Número del cliente no válido (E.164).');
    const num = (d.number_id && G.db.get('tel_numbers', d.number_id)) || T.numberFor(null);
    if (!num) G.fail('RN-TEL-03', 'No hay números de la central configurados (TEL-03).');
    const menu = num.menu_id && G.db.get('tel_menus', num.menu_id);
    const opt = menu && (menu.options || []).find(o => String(o.digit) === String(d.option || ''));
    const who = T.callerOf(from);
    const brand_id = (opt && opt.brand_id) || num.brand_id || (who.customer && (who.customer.segment_brands || [])[0]) || 'br-DG';
    let lead = who.lead || null;
    if (!who.customer && !lead) lead = ensureLead(from, brand_id, at); // RN-TEL-08
    const status = d.status || 'COMPLETED';
    const plan = T.ringPlan((opt && opt.ring_group_id && G.db.get('tel_ring_groups', opt.ring_group_id)) || T.group(brand_id));
    const user_id = d.user_id || (status === 'COMPLETED' ? ((plan[0] || { users: [] }).users[0] || null) : ((plan[0] || { users: [] }).users[0] || null));
    const wait = d.wait_seconds != null ? d.wait_seconds : (status === 'COMPLETED' ? 12 : (plan.length ? plan[plan.length - 1].to_s : 25));
    const dur = status === 'COMPLETED' ? (d.duration_seconds != null ? d.duration_seconds : 120) : 0;
    const notice = !!s.recording_enabled && status === 'COMPLETED';
    const call = T.dbWrite('tel_calls', { number_id: num.id, direction: 'INBOUND', from_e164: from, to_e164: num.e164, brand_id, customer_id: who.customer ? who.customer.id : null, lead_id: lead ? lead.id : null, order_id: d.order_id || null, user_id, status, notice_played: notice, started_at: at, answered_at: status === 'COMPLETED' ? addMin(at, wait / 60) : null, ended_at: addMin(at, (wait + dur) / 60), wait_seconds: wait, duration_seconds: dur, provider_call_id: 'CA' + U.uid('').replace(/\W/g, ''), cost_usd: callCost('INBOUND', from, dur, notice), menu_option: d.option || null });
    if (status === 'COMPLETED') {
      if (notice) T._record(call);
      closeCallbacks(from, call.answered_at || at);
      G.events.emit('call.completed', { call_id: call.id, customer_id: call.customer_id, lead_id: call.lead_id, order_id: call.order_id, user_id });
    } else if (MISSED.includes(status)) {
      createTask(call, at); // RN-TEL-07
      G.events.emit('call.missed', { call_id: call.id, from: from });
    }
    return call;
  };
  /** click-to-call desde la ficha o el pedido (RN-TEL-05): sale con el número de la marca; el cliente nunca ve el número personal */
  T.click2call = function ({ customer_id, lead_id, order_id, user_id, duration_seconds = 90, status = 'COMPLETED', at } = {}) {
    T.assertCalls();
    if (!G.can('tel.call.make')) G.fail('RN-TEL-05', `Tu rol (${G.roleName()}) no tiene el permiso tel.call.make.`);
    const s = T.settings();
    const o = order_id ? G.db.get('sales_orders', order_id) : null;
    const cust = G.db.get('customers', customer_id || (o && o.customer_id));
    const lead = !cust && lead_id ? G.db.get('leads', lead_id) : null;
    if (s.outbound_registered_only && !cust && !lead) G.fail('RN-TEL-05', 'Solo se llama a clientes o leads registrados (tel_outbound_registered_only).');
    const to = e164((o && o.contact_phone) || (cust && cust.phone) || (lead && lead.phone));
    if (!G.util.phoneOk(to)) G.fail('RN-TEL-05', 'El cliente no tiene un celular válido.');
    const brand_id = (o && o.brand_id) || (cust && (cust.segment_brands || [])[0]) || (lead && lead.brand_id) || 'br-DG';
    const num = T.numberFor(brand_id);
    if (!num) G.fail('RN-TEL-03', 'No hay números de la central configurados (TEL-03).');
    const start = at || G.date.now();
    const dur = status === 'COMPLETED' ? duration_seconds : 0;
    const call = T.dbWrite('tel_calls', { number_id: num.id, direction: 'OUTBOUND', from_e164: num.e164, to_e164: to, brand_id, customer_id: cust ? cust.id : null, lead_id: lead ? lead.id : null, order_id: o ? o.id : null, user_id: user_id || G.ctx.userId(), status, notice_played: !!s.recording_enabled && dur > 0, started_at: start, answered_at: dur ? addMin(start, 0.2) : null, ended_at: addMin(start, 0.2 + dur / 60), wait_seconds: dur ? 12 : 25, duration_seconds: dur, provider_call_id: 'CA' + U.uid('').replace(/\W/g, ''), cost_usd: callCost('OUTBOUND', to, dur, !!s.recording_enabled && dur > 0) });
    if (status === 'COMPLETED') { if (call.notice_played) T._record(call); G.events.emit('call.completed', { call_id: call.id, customer_id: call.customer_id, order_id: call.order_id, user_id: call.user_id }); }
    return call;
  };
  /** botón «Llamar» para CLI y PED: no aparece con TEL apagado ni sin tel.call.make (RN-TEL-01) */
  T.callButton = function (ref = {}) {
    if (!G.modOn('TEL') || !G.can('tel.call.make')) return null;
    return btn('Llamar', () => { try { const c = T.click2call(ref); toast(`Llamando con el número ${c.from_e164}…`, 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { sm: true, kind: 'accent' });
  };

  /* ------------------------------------------------------------------
     Transcripción y alertas · RN-TEL-09
     ------------------------------------------------------------------ */
  const DEFAULT_PHRASES = ['yapeame', 'plineame', 'a mi numero', 'a mi cuenta', 'mi yape', 'mi plin', 'por fuera', 'por interno', 'directo conmigo', 'sin boleta', 'sin comprobante', 'te hago precio aparte'];
  const OFF_TERMS = ['cabrito', 'pavo entero', 'jabali', 'venado', 'lechon'];
  /** revisa un texto con las reglas de alerta que aplican a llamadas. Devuelve una alerta por tipo de regla. */
  T.scan = function (text) {
    const t = norm(text); const out = [];
    const rules = G.db.where('control_alert_rules', r => r.active !== false && (!r.applies_to || r.applies_to.includes('CALL')));
    const phrases = new Set(DEFAULT_PHRASES.concat(rules.filter(r => r.rule_type === 'KEYWORD').map(r => norm(r.pattern))));
    const hits = [...phrases].filter(p => p && t.includes(p));
    if (hits.length) out.push({ rule_type: 'KEYWORD', severity: 'HIGH', matched_text: hits.join(' · '), label: 'Frase de control' });
    const official = T.officialNumbers();
    const phones = (t.match(/(?:\+?51[\s-]?)?9(?:[\s-]?\d){8}/g) || []).map(x => '+51' + x.replace(/\D/g, '').replace(/^51(?=9\d{8}$)/, '')).filter(p => !official.has(p));
    if (phones.length) out.push({ rule_type: 'FOREIGN_PHONE', severity: 'HIGH', matched_text: [...new Set(phones)].join(', '), label: 'Número ajeno a la empresa' });
    const own = new Set(G.db.all('cash_accounts').map(a => String(a.account_number || '').replace(/\D/g, '')).filter(Boolean));
    const accs = (t.match(/\b\d(?:[\s-]?\d){12,19}\b/g) || []).map(x => x.replace(/\D/g, '')).filter(x => !own.has(x));
    if (accs.length) out.push({ rule_type: 'FOREIGN_ACCOUNT', severity: 'HIGH', matched_text: accs.join(', '), label: 'Cuenta bancaria ajena' });
    const catalog = G.db.all('products').map(p => norm(p.name)).join(' | ');
    const off = OFF_TERMS.concat(rules.filter(r => r.rule_type === 'OFF_CATALOG_TERM').map(r => norm(r.pattern))).filter(x => t.includes(x) && !catalog.includes(x));
    if (off.length) out.push({ rule_type: 'OFF_CATALOG_TERM', severity: 'MEDIUM', matched_text: off.join(', '), label: 'Producto fuera del catálogo' });
    return out;
  };
  const SAMPLE_TEXTS = ['Vendedora: Buenos días, Don Guando, habla Ana. Cliente: Quería dos cuyes enteros para el sábado. Vendedora: Claro, ¿a la misma dirección de Surco? Le confirmo la franja de 9 a 13 y le llega el resumen por WhatsApp.', 'Cliente: ¿Tienen caldo de huesos congelado? Vendedora: Sí, de un litro a 18 soles. ¿Se lo agrego al pedido de mañana? Cliente: Sí, dos por favor.', 'Cliente: El pollo llegó con menos peso. Vendedora: Le reviso el peso real en balanza y le devolvemos la diferencia como saldo a favor.', 'Vendedora: Le llamo para confirmar su pedido de bondiola, son 1,5 kg; el peso final puede variar hasta 5 %.'];
  /** transcribe una grabación (con tel_transcription_enabled) y pasa el texto por las reglas de alerta de CRM */
  T.transcribe = function (recording_id, text) {
    G.assertMod('TEL');
    const s = T.settings();
    if (!s.transcription_enabled) G.fail('RN-TEL-09', 'La transcripción está desactivada (tel_transcription_enabled = no). Actívala en TEL-02.');
    const rec = G.db.get('tel_recordings', recording_id); if (!rec) G.fail('RN-TEL-09', 'Grabación no encontrada.');
    if (rec.status === 'PURGED') G.fail('RN-TEL-10', 'La grabación fue purgada: ya no se puede transcribir.');
    if (G.db.find('tel_transcripts', x => x.recording_id === rec.id)) G.fail('RN-TEL-09', 'Esta grabación ya tiene transcripción.');
    const call = G.db.get('tel_calls', rec.call_id);
    const txt = text || SAMPLE_TEXTS[(call.id.charCodeAt(call.id.length - 1)) % SAMPLE_TEXTS.length];
    const tr = T.dbWrite('tel_transcripts', { call_id: call.id, recording_id: rec.id, provider: (s.provider === 'TWILIO' ? 'TWILIO_VOICE_INTELLIGENCE' : 'FAKE'), language: 'es', transcript: txt, cost_usd: R(Math.ceil(rec.duration_seconds / 60) * T.rates().transcription, 4) });
    const found = T.scan(txt);
    const alerts = found.map(f => raiseAlert(call, tr, f));
    tr.alert_ids = alerts.map(a => a.id); G.db.touch();
    return { transcript: tr, alerts };
  };
  function raiseAlert(call, tr, f) {
    const rule = G.db.find('control_alert_rules', r => r.rule_type === f.rule_type && r.active !== false);
    const row = { rule_id: rule ? rule.id : null, rule_code: rule ? rule.code : 'TEL-' + f.rule_type, rule_type: f.rule_type, source_type: 'CALL_TRANSCRIPT', message_id: null, call_id: call.id, conversation_id: null, user_id: call.user_id, severity: f.severity, matched_text: f.matched_text, excerpt: tr.transcript.slice(0, 160), status: 'OPEN', reviewed_by: null, reviewed_at: null, resolution_note: null, raised_at: G.date.now() };
    let a = null;
    if (G.crm && typeof G.crm.raiseAlert === 'function') { try { a = G.crm.raiseAlert(row); } catch (e) { if (e instanceof G.RuleError) throw e; } }
    if (!a) a = G.db.insert('control_alerts', row);
    G.notify({ role: 'SUPERVISORA_VENTAS', title: `Alerta en llamada: ${f.label}`, body: `${G.userName(call.user_id)} · «${f.matched_text}»`, ref: call.id, tone: 'bad', module: 'TEL' });
    G.events.emit('control_alert.raised', { alert_id: a.id, source_type: 'CALL_TRANSCRIPT', call_id: call.id, rule_type: f.rule_type });
    return a;
  }

  /* ------------------------------------------------------------------
     Escucha, descarga, retención y purga · RN-TEL-10, 11
     ------------------------------------------------------------------ */
  T.canListen = function (rec, action = 'PLAY') {
    const call = rec && G.db.get('tel_calls', rec.call_id); if (!call) return false;
    if (action === 'DOWNLOAD') return G.can('tel.recording.download');
    return G.can('tel.recording.listen_all') || (call.user_id === G.ctx.userId() && G.can('tel.recording.listen_own'));
  };
  T.listen = function (recording_id, { action = 'PLAY', reason } = {}) {
    G.assertMod('TEL');
    const rec = G.db.get('tel_recordings', recording_id); if (!rec) G.fail('RN-TEL-11', 'Grabación no encontrada.');
    if (rec.status === 'PURGED') G.fail('RN-TEL-10', `La grabación se purgó el ${G.fmt.date(rec.purged_at)} al vencer su retención: ya no se puede escuchar (se conservan los datos de la llamada).`);
    if (!T.canListen(rec, action)) G.fail('RN-TEL-11', action === 'DOWNLOAD' ? '403: descargar grabaciones exige el permiso tel.recording.download.' : '403: solo escuchas tus grabaciones; escuchar las de otras vendedoras exige tel.recording.listen_all.');
    const log = G.db.insert('tel_recording_access_log', { recording_id: rec.id, user_id: G.ctx.userId(), action, reason: reason || null, accessed_at: G.date.now() }, { silent: true });
    G.db.insert('access_log', { user_id: G.ctx.userId(), event: action === 'PLAY' ? 'RECORDING_PLAY' : 'RECORDING_DOWNLOAD', module_code: 'TEL', entity_type: 'tel_recordings', entity_id: rec.id, details: { reason: reason || null }, occurred_at: log.accessed_at }, { silent: true });
    G.events.emit('recording.accessed', { recording_id: rec.id, action, user_id: G.ctx.userId() });
    return log;
  };
  T.setLegalHold = function (recording_id, on, reason) {
    G.assertMod('TEL');
    if (!G.can('tel.recording.listen_all')) G.fail('RN-TEL-10', 'La retención legal la marca la supervisora o gerencia.');
    if (!reason) G.fail('RN-TEL-10', 'La retención legal exige motivo (reclamo, proceso, pedido de autoridad).');
    const rec = G.db.get('tel_recordings', recording_id); if (rec.status === 'PURGED') G.fail('RN-TEL-10', 'La grabación ya fue purgada.');
    return G.db.update('tel_recordings', rec.id, { legal_hold: !!on, legal_hold_reason: reason });
  };
  /** corrida de purga (tel_purge_recordings): audio vencido y sin retención legal → PURGED */
  T.purge = function (asOf = G.TODAY) {
    G.assertMod('TEL');
    if (!G.can('tel.settings.manage') && !G.can('tel.recording.listen_all')) G.fail('RN-TEL-10', 'Tu rol no puede correr la purga de grabaciones.');
    const due = G.db.where('tel_recordings', r => r.status === 'AVAILABLE' && !r.legal_hold && r.retention_until < asOf);
    for (const r of due) { G.db.update('tel_recordings', r.id, { status: 'PURGED', purged_at: asOf + 'T03:00' }, { silent: true }); const f = G.db.get('file_attachments', r.file_id); if (f) G.db.update('file_attachments', f.id, { status: 'DELETED', deleted_reason: 'Retención vencida (RN-TEL-10)' }, { silent: true }); }
    const run = G.db.insert('audit_purge_runs', { category: 'RECORDINGS', module_code: 'TEL', cutoff_date: asOf, rows_archived: 0, rows_purged: due.length, result: 'OK', run_at: G.date.now(), run_by: G.ctx.userName() }, { silent: true });
    G.audit('PURGAR', 'tel_recordings', run.id, `${due.length} grabaciones purgadas al ${G.fmt.date(asOf)}`);
    return { run, purged: due };
  };

  /* ------------------------------------------------------------------
     Costos e indicadores · KPI-TEL-01 a 08
     ------------------------------------------------------------------ */
  T.costSummary = function (calls) {
    const r = T.rates(); const ids = new Set(calls.map(c => c.id));
    let minutes = 0, voice = 0, rec = 0;
    for (const c of calls) { const m = Math.ceil((c.duration_seconds || 0) / 60); minutes += m; const v = c.direction === 'OUTBOUND' ? (/^\+519/.test(c.to_e164) ? r.out_mobile : r.out_landline) : r.inbound; voice += m * v; if (c.notice_played && m) rec += m * r.recording; }
    const trans = U.sum(G.db.where('tel_transcripts', t => ids.has(t.call_id)), t => t.cost_usd || 0);
    const total = R(voice + rec + trans, 2); const fx = G.ads && G.ads.fx ? G.ads.fx(G.TODAY, 'USD') : Number((G.db.all('exchange_rates').sort(U.by('date', -1))[0] || { sell: 3.75 }).sell);
    const orders = new Set(calls.map(c => c.order_id).filter(Boolean)).size;
    return { minutes, voice_usd: R(voice, 2), recording_usd: R(rec, 2), transcription_usd: R(trans, 2), total_usd: total, fx, total_pen: R(total * fx), orders, per_order_pen: orders ? R(total * fx / orders) : null };
  };
  const cIn = (p, pred = () => true) => G.db.where('tel_calls', c => { const d = String(c.started_at).slice(0, 10); return d >= p.from && d <= p.to && (!p.brand || c.brand_id === p.brand) && pred(c); });
  G.kpiCalc['KPI-TEL-01'] = p => { const inb = cIn(p, c => c.direction === 'INBOUND' && !['RINGING', 'IN_PROGRESS'].includes(c.status)); const ok = inb.filter(c => c.status === 'COMPLETED').length; return { value: inb.length ? R(ok / inb.length * 100, 1) : null, numerator: ok, denominator: inb.length }; };
  G.kpiCalc['KPI-TEL-02'] = p => { const n = cIn(p, c => c.direction === 'INBOUND' && MISSED.includes(c.status)).length; return { value: n, numerator: n, denominator: null }; };
  G.kpiCalc['KPI-TEL-03'] = p => { const c = cIn(p, c => c.direction === 'INBOUND' && c.status === 'COMPLETED'); return { value: c.length ? R(U.sum(c, x => x.wait_seconds) / c.length / 60, 2) : null, numerator: R(U.sum(c, x => x.wait_seconds) / 60, 2), denominator: c.length }; };
  G.kpiCalc['KPI-TEL-04'] = p => { const c = cIn(p, c => c.status === 'COMPLETED'); return { value: c.length ? R(U.sum(c, x => x.duration_seconds) / c.length / 60, 2) : null, numerator: R(U.sum(c, x => x.duration_seconds) / 60, 2), denominator: c.length }; };
  G.kpiCalc['KPI-TEL-05'] = p => { const c = cIn(p, c => c.status === 'COMPLETED'); const w = c.filter(x => x.order_id).length; return { value: c.length ? R(w / c.length * 100, 1) : null, numerator: w, denominator: c.length }; };
  G.kpiCalc['KPI-TEL-06'] = p => { const ts = T.tasks().filter(t => { const d = String(t.due_at).slice(0, 10); return d >= p.from && d <= p.to && (!p.brand || t.brand_id === p.brand) && t.status !== 'CANCELLED'; }); const ok = ts.filter(t => t.status === 'DONE' && t.done_at && t.done_at <= t.due_at).length; return { value: ts.length ? R(ok / ts.length * 100, 1) : null, numerator: ok, denominator: ts.length }; };
  G.kpiCalc['KPI-TEL-07'] = p => { const s = T.costSummary(cIn(p)); const withOrder = new Set(cIn(p).map(c => c.order_id).filter(Boolean)).size; return { value: withOrder ? R(s.total_pen / withOrder) : null, numerator: s.total_pen, denominator: withOrder }; };
  G.kpiCalc['KPI-TEL-08'] = p => { const n = T.alerts().filter(a => { const c = G.db.get('tel_calls', a.call_id); const d = String(c ? c.started_at : '').slice(0, 10); return c && d >= p.from && d <= p.to && (!p.brand || c.brand_id === p.brand); }).length; return { value: n, numerator: n, denominator: null }; };
  T.drill = function (code, p) {
    if (code === 'KPI-TEL-06') { const ts = T.tasks().filter(t => String(t.due_at).slice(0, 10) >= p.from && String(t.due_at).slice(0, 10) <= p.to); return { columns: [['llamada', 'Llamada'], ['vence', 'Vence'], ['hecha', 'Hecha'], ['a_tiempo', 'A tiempo (1/0)', 'num']], rows: ts.map(t => ({ llamada: (G.db.get('tel_calls', t.call_id) || {}).from_e164 || t.phone, vence: G.fmt.datetime(t.due_at), hecha: G.fmt.datetime(t.done_at), a_tiempo: t.status === 'DONE' && t.done_at <= t.due_at ? 1 : 0 })), sum: ['a_tiempo'] }; }
    const cs = cIn(p);
    return { columns: [['fecha', 'Inicio'], ['dir', 'Dirección'], ['numero', 'Número'], ['vendedora', 'Vendedora'], ['estado', 'Estado'], ['espera', 'Espera (s)', 'num'], ['duracion', 'Duración (s)', 'num'], ['costo', 'Costo USD', 'num']], rows: cs.map(c => ({ fecha: G.fmt.datetime(c.started_at), dir: c.direction === 'INBOUND' ? 'Entrante' : 'Saliente', numero: c.direction === 'INBOUND' ? c.from_e164 : c.to_e164, vendedora: G.userShort(c.user_id), estado: stName(c.status), espera: c.wait_seconds || 0, duracion: c.duration_seconds || 0, costo: c.cost_usd || 0 })), sum: ['duracion', 'costo'] };
  };

  /* ------------------------------------------------------------------
     Semilla (orden 25): vista previa de cómo se vería con datos
     ------------------------------------------------------------------ */
  G.seed(25, function seedTEL() {
    const r = U.rng(2525);
    T.prepareActivation();
    const s = T.settings();
    Object.assign(s, { provider: 'TWILIO', connector_id: 'ic-tel-twilio', preview: true });
    const admin = G.db.find('users', u => u.role === 'ADMIN_SISTEMA'); const ger = G.db.find('users', u => u.role === 'GERENTE');
    const done = { 1: [admin, '2026-10-06T16:20', 'Cotización Twilio aprobada; número fijo de Lima +51 1 708 5500 reservado (sin activar).'], 3: [admin, '2026-10-08T11:05', 'Audio del aviso grabado por la locutora; archivo aviso-grabacion.mp3 (12 s).'], 4: [admin, '2026-10-09T09:40', '5 vendedoras con usuario y softphone en el celular de la empresa (D-TEL-05).'] };
    for (const st0 of G.db.all('tel_activation_steps')) { const d = done[st0.step_no]; if (d) Object.assign(st0, { done: true, done_by: d[0].id, done_at: d[1], notes: d[2] }); else if (st0.step_no === 5) st0.notes = 'Pendiente: el abogado de datos personales revisa la política (D-TEL-03).'; else if (st0.step_no === 2) st0.notes = 'Pendiente: pedir al operador el desvío de +51 987 650 101 y +51 987 650 102.'; }
    const brands = G.db.all('brands').sort(U.by('sort_order'));
    // grupos de llamada por marca (RN-TEL-06)
    const sellers = G.db.where('users', u => u.role === 'VENDEDORA');
    const sup = G.db.find('users', u => u.role === 'SUPERVISORA_VENTAS');
    const groups = {};
    for (const b of brands) {
      const g = ins('tel_ring_groups', { id: 'trg-' + b.code, brand_id: b.id, name: 'Vendedoras ' + b.name.split(' · ')[0], strategy: b.code === 'M5' ? 'SIMULTANEOUS' : 'ROUND_ROBIN', ring_timeout_s: 25 });
      groups[b.id] = g;
      sellers.filter(u => u.brands.includes(b.id)).forEach((u, i) => ins('tel_ring_members', { group_id: g.id, user_id: u.id, priority: i + 1, active: true }));
      if (b.code === 'DG') ins('tel_ring_members', { group_id: g.id, user_id: sup.id, priority: 9, active: true });
    }
    const menu = ins('tel_menus', { id: 'tmn-GENERAL', name: 'Menú general', greeting_text: 'Gracias por llamar a Don Guando. Esta llamada puede ser grabada para fines de calidad. Para Don Guando marca 1; Marca 2, cortes, marca 2; Marca 3, embutidos, marca 3; Marca 4, despensa, marca 4; Marca 5, gourmet, marca 5; para hablar con la supervisora marca 9.', business_hours: { mon_sat: ['08:00', '20:00'], sun: ['09:00', '14:00'], holidays: 'closed' }, after_hours_action: 'CALLBACK_TASK', options: brands.map((b, i) => ({ digit: i + 1, brand_id: b.id, label: b.name.split(' · ')[0], ring_group_id: groups[b.id].id })).concat([{ digit: 9, brand_id: null, label: 'Supervisora', ring_group_id: groups['br-DG'].id, direct_user_id: sup.id }]), status: 'ACTIVE' });
    const gen = ins('tel_numbers', { id: 'tnu-GEN', brand_id: null, e164: '+5117085500', number_kind: 'LANDLINE_LIMA', provider_ref: 'PN-TW-7085500', menu_id: menu.id, ring_group_id: null, forwarded_from: ['+51987650101', '+51987650102'], status: 'ACTIVE' });
    const m5 = ins('tel_numbers', { id: 'tnu-M5', brand_id: 'br-M5', e164: '+51987650950', number_kind: 'VIRTUAL_MOBILE', provider_ref: 'PN-TW-987650950', menu_id: null, ring_group_id: groups['br-M5'].id, forwarded_from: ['+51987650501'], status: 'ACTIVE' });
    ins('tel_numbers', { id: 'tnu-0800', brand_id: null, e164: '+5180070850', number_kind: 'TOLL_FREE', provider_ref: null, menu_id: menu.id, ring_group_id: null, forwarded_from: [], status: 'INACTIVE' });
    // llamadas de ejemplo (01/10 al 10/10) enlazadas a clientes y pedidos reales
    const ords = G.db.where('sales_orders', o => o.created_at >= '2026-10-01' && o.customer_id && o.customer_id.startsWith('cu-0'));
    const byDay = U.groupBy(ords, o => o.created_at.slice(0, 10));
    const persons = G.db.where('customers', c => c.customer_type === 'PERSON' && c.id.startsWith('cu-0'));
    const fx = 3.75; let n = 0;
    const mkCall = (c) => { n++; const call = ins('tel_calls', Object.assign({ id: 'tca-' + U.pad(n, 4), provider_call_id: 'CAprev' + U.pad(n, 5), preview: true }, c)); return call; };
    const rec = (call, retDays) => { const day = call.started_at.slice(0, 10); const until = G.date.add(day, retDays || s.retention_days); return ins('tel_recordings', { id: 'tre-' + call.id.slice(4), call_id: call.id, file_id: 'fa-tel-prev-' + call.id.slice(4), duration_seconds: call.duration_seconds, provider_recording_id: 'REprev' + call.id.slice(4), retention_until: until, legal_hold: false, status: 'AVAILABLE', purged_at: null, preview: true }); };
    const optFor = b => brands.findIndex(x => x.id === b) + 1;
    for (let d = '2026-10-01'; d <= G.TODAY; d = G.date.add(d, 1)) {
      const dayOrders = byDay[d] || []; const k = 8 + U.int(r, 0, 6);
      for (let i = 0; i < k; i++) {
        const t = d + 'T' + U.pad(U.int(r, 8, 19), 2) + ':' + U.pad(U.int(r, 0, 59), 2) + ':' + U.pad(U.int(r, 0, 59), 2);
        const o = dayOrders.length && r() < 0.55 ? U.pick(r, dayOrders) : null;
        const cust = o ? G.db.get('customers', o.customer_id) : r() < 0.8 ? U.pick(r, persons) : null;
        const brand_id = o ? o.brand_id : cust ? ((cust.segment_brands || [])[0] || 'br-DG') : U.pick(r, ['br-DG', 'br-DG', 'br-M2', 'br-M5']);
        const plan = T.ringPlan(groups[brand_id]);
        const outbound = r() < 0.24 && cust;
        const x = r();
        const status = outbound ? (x < 0.82 ? 'COMPLETED' : 'NO_ANSWER') : x < 0.74 ? 'COMPLETED' : x < 0.85 ? 'MISSED' : x < 0.91 ? 'NO_ANSWER' : x < 0.96 ? 'VOICEMAIL' : x < 0.98 ? 'BUSY' : 'FAILED';
        const user = (plan.length ? U.pick(r, plan.flatMap(p => p.users)) : sellers[0].id);
        const wait = status === 'COMPLETED' ? U.int(r, 4, 75) : 50 + U.int(r, 0, 25);
        const dur = status === 'COMPLETED' ? U.int(r, 35, 420) : 0;
        const num = brand_id === 'br-M5' && !outbound ? m5 : gen;
        const phone = cust ? cust.phone : '+519' + U.pad(U.int(r, 10000000, 99999999), 8);
        const call = mkCall({ number_id: num.id, direction: outbound ? 'OUTBOUND' : 'INBOUND', from_e164: outbound ? num.e164 : phone, to_e164: outbound ? phone : num.e164, brand_id, customer_id: cust ? cust.id : null, lead_id: null, lead_phone: cust ? null : phone, order_id: status === 'COMPLETED' && o && r() < 0.8 ? o.id : null, user_id: user, status, notice_played: status === 'COMPLETED', started_at: t, answered_at: status === 'COMPLETED' ? addMin(t, wait / 60) : null, ended_at: addMin(t, (wait + dur) / 60), wait_seconds: wait, duration_seconds: dur, cost_usd: callCost(outbound ? 'OUTBOUND' : 'INBOUND', outbound ? phone : num.e164, dur, status === 'COMPLETED'), menu_option: outbound ? null : optFor(brand_id) });
        if (status === 'COMPLETED') { const rc = rec(call); if (r() < 0.3) ins('tel_transcripts', { call_id: call.id, recording_id: rc.id, provider: 'TWILIO_VOICE_INTELLIGENCE', language: 'es', transcript: SAMPLE_TEXTS[U.int(r, 0, SAMPLE_TEXTS.length - 1)], cost_usd: R(Math.ceil(dur / 60) * 0.05, 4), preview: true, preview_alerts: [] }); }
        if (!outbound && MISSED.includes(status)) { const due = addMin(t, s.callback_due_minutes); const doneIn = r(); call.preview_task = { assigned_user_id: user, due_at: due, status: d === G.TODAY && doneIn < 0.6 ? 'OPEN' : doneIn < 0.12 ? 'EXPIRED' : 'DONE', done_at: d === G.TODAY && doneIn < 0.6 ? null : doneIn < 0.12 ? null : addMin(t, doneIn < 0.75 ? U.int(r, 6, 28) : U.int(r, 35, 140)), result: doneIn < 0.12 ? null : 'Devuelta por la vendedora', phone }; }
      }
    }
    // dos llamadas con frases de control (vista previa de alertas)
    const bad = [['Vendedora: Si quiere se lo dejo más barato por fuera, yapéame a mi número 912 345 678 y se lo llevo yo.', 'us-cnunez'], ['Vendedora: Para el cabrito no tenemos, pero le consigo uno; deposíteme a mi cuenta 19312345678012 y lo coordinamos.', 'us-evargas']];
    bad.forEach(([txt, uid], i) => {
      const u = G.db.get('users', uid) || sellers[i + 2];
      const cust = persons[40 + i * 7];
      const call = mkCall({ number_id: gen.id, direction: 'INBOUND', from_e164: cust.phone, to_e164: gen.e164, brand_id: u.brands[0], customer_id: cust.id, lead_id: null, order_id: null, user_id: u.id, status: 'COMPLETED', notice_played: true, started_at: '2026-10-0' + (7 + i) + 'T1' + (5 + i) + ':12:40', answered_at: '2026-10-0' + (7 + i) + 'T1' + (5 + i) + ':13:02', ended_at: '2026-10-0' + (7 + i) + 'T1' + (5 + i) + ':17:30', wait_seconds: 22, duration_seconds: 268, cost_usd: callCost('INBOUND', gen.e164, 268, true), menu_option: optFor(u.brands[0]) });
      const rc = rec(call);
      ins('tel_transcripts', { call_id: call.id, recording_id: rc.id, provider: 'TWILIO_VOICE_INTELLIGENCE', language: 'es', transcript: txt, cost_usd: R(5 * 0.05, 4), preview: true, preview_alerts: T.scan(txt).map(f => ({ rule_type: f.rule_type, rule_code: 'TEL-' + f.rule_type, severity: f.severity, matched_text: f.matched_text, excerpt: txt.slice(0, 160), status: i === 0 ? 'UNDER_REVIEW' : 'OPEN', user_id: u.id, label: f.label, raised_at: call.ended_at })) });
    });
    // en vivo (vista previa del panel): una en curso y una sonando
    const live = [['IN_PROGRESS', G.TODAY + 'T11:42:10', 'br-DG'], ['RINGING', G.TODAY + 'T11:44:51', 'br-M2']];
    live.forEach(([stt, t, b]) => { const cust = U.pick(r, persons); mkCall({ number_id: gen.id, direction: 'INBOUND', from_e164: cust.phone, to_e164: gen.e164, brand_id: b, customer_id: cust.id, user_id: stt === 'IN_PROGRESS' ? T.ringPlan(groups[b])[0].users[0] : null, status: stt, notice_played: stt === 'IN_PROGRESS', started_at: t, answered_at: stt === 'IN_PROGRESS' ? addMin(t, 0.3) : null, ended_at: null, wait_seconds: stt === 'IN_PROGRESS' ? 18 : null, duration_seconds: null, cost_usd: null, menu_option: optFor(b) }); });
    // grabaciones antiguas para retención: purgada, por vencer, con retención legal
    [['2026-04-08T10:20:00', 'PURGED', false], ['2026-04-13T16:05:00', 'AVAILABLE', false], ['2026-04-14T12:30:00', 'AVAILABLE', false], ['2026-04-09T09:15:00', 'AVAILABLE', true], ['2026-04-20T17:45:00', 'AVAILABLE', false]].forEach(([t, stt, hold], i) => {
      const cust = persons[100 + i];
      const call = mkCall({ number_id: gen.id, direction: 'INBOUND', from_e164: cust.phone, to_e164: gen.e164, brand_id: 'br-DG', customer_id: cust.id, user_id: sellers[i % 2].id, status: 'COMPLETED', notice_played: true, started_at: t, answered_at: addMin(t, 0.2), ended_at: addMin(t, 3), wait_seconds: 12, duration_seconds: 168, cost_usd: callCost('INBOUND', gen.e164, 168, true), menu_option: 1, pilot: true });
      const rc = rec(call);
      if (stt === 'PURGED') Object.assign(rc, { status: 'PURGED', purged_at: '2026-10-06T03:00' });
      if (hold) Object.assign(rc, { legal_hold: true, legal_hold_reason: 'Reclamo en el Libro de Reclamaciones N.° 2026-118: conservar hasta su cierre' });
    });
    // bitácora de escuchas (solo inserción)
    const recs = G.db.all('tel_recordings').filter(x => x.status === 'AVAILABLE');
    [[sup.id, 'PLAY', 'Revisión de calidad semanal'], [sup.id, 'PLAY', 'Alerta de control en llamada'], [sup.id, 'PLAY', 'Reclamo de peso'], [ger.id, 'DOWNLOAD', 'Libro de Reclamaciones N.° 2026-118'], ['us-atorres', 'PLAY', 'Revisar lo que pidió la clienta']].forEach(([uid, a, why], i) => ins('tel_recording_access_log', { recording_id: recs[(i * 7) % recs.length].id, user_id: uid, action: a, reason: why, accessed_at: G.date.add(G.TODAY, -(i % 4)) + 'T1' + i + ':2' + i, preview: true }));
    // catálogo de indicadores: requieren TEL (RN-TAB-07)
    const KD = { '01': 'PCT', '02': 'COUNT', '03': 'MINUTES', '04': 'MINUTES', '05': 'PCT', '06': 'PCT', '07': 'PEN', '08': 'COUNT' };
    for (const [nn, unit] of Object.entries(KD)) { const k = G.db.find('kpi_definitions', x => x.code === 'KPI-TEL-' + nn); if (k) Object.assign(k, { unit, calculator: 'kpi_tel_' + nn, drilldown: nn === '06' ? 'TEL-09' : nn === '08' ? 'TEL-10' : nn === '07' ? 'TEL-11' : 'TEL-08', decimals: unit === 'COUNT' ? 0 : 2, dimensions: ['brand', 'user'], source: 'tel_calls, tel_transcripts, crm_tasks', visible_roles: ['GERENTE', 'SUPERVISORA_VENTAS', 'AUDITOR', 'ADMINISTRACION'], requires_module: 'TEL' }); }
    void fx;
  }, 'TEL');

  /* ------------------------------------------------------------------
     Interfaz
     ------------------------------------------------------------------ */
  const off = () => !G.modOn('TEL');
  const guarded = fn => () => { try { fn(); } catch (e) { toast(e.message, 'bad'); } };
  function stateBanner(body) {
    const s = T.settings() || {};
    const steps = G.db.all('tel_activation_steps'); const nDone = steps.filter(x => x.done).length;
    body.appendChild(h('div', { class: 'grid c3' },
      card('Módulo', h('div', { class: 'stack' }, h('div', null, G.modOn('TEL') ? badge('Encendido', 'ok') : badge('Apagado (RN-PLT-07)', 'bad')), h('div', { class: 'muted small' }, 'Decisión de gerencia del 10/10/2026: incluido y listo para activar más adelante; por el momento no.'))),
      card('Etapa', h('div', { class: 'stack' }, h('div', null, st(s.stage || 'SETUP')), h('div', { class: 'muted small' }, `${nDone} de 6 pasos de activación hechos`), G.ui.progress(nDone / 6 * 100, nDone === 6 ? 'ok' : 'warn'))),
      card('Proveedor', h('div', { class: 'stack' }, h('b', null, s.provider === 'TWILIO' ? 'Twilio (D-TEL-01)' : s.provider === 'FAKE' ? 'Adaptador falso de pruebas' : s.provider || '—'), h('div', { class: 'muted small' }, 'Detrás de TelephonyProvider: cambiar de proveedor es configurar otro conector (RN-TEL-03).')))));
  }
  const previewNote = () => off() ? notice('Vista previa con datos de ejemplo de cómo se verá. Mientras TEL esté apagado, llamar, atender, grabar, transcribir y escuchar se rechaza con RN-PLT-07.', 'info') : null;
  const callLabel = c => c ? `${c.direction === 'INBOUND' ? c.from_e164 : c.to_e164} · ${G.fmt.datetime(c.started_at)}` : '—';
  const who = c => c.customer_id ? G.custName(c.customer_id) : c.lead_id ? 'Lead ' + ((G.db.get('leads', c.lead_id) || {}).phone || '') : (c.lead_phone ? 'Lead nuevo (' + c.lead_phone + ')' : '—');
  const secs = s => s == null ? '—' : s >= 60 ? `${Math.floor(s / 60)} min ${U.pad(s % 60, 2)} s` : `${s} s`;

  function s01(el) {
    const body = G.ui.page(el, { code: 'TEL-01', title: 'Lista de activación', sub: 'Los 6 pasos para encender la central: responsable, fecha y evidencia de cada uno. Con los 6 hechos se pasa de preparación (SETUP) a producción (LIVE).', actions: [G.modOn('TEL') ? { label: 'Pasar a producción (LIVE)', kind: 'primary', onClick: guarded(() => { T.goLive(); toast('TEL en producción', 'ok'); G.refresh(); }) } : { label: 'Encender módulo TEL', kind: 'primary', onClick: switchOn }] });
    stateBanner(body);
    const canM = G.can('tel.settings.manage');
    if (!canM) body.appendChild(notice('Marcar pasos y pasar a producción exige el permiso tel.settings.manage (administrador del sistema).', 'warn'));
    const steps = G.db.all('tel_activation_steps').sort(U.by('step_no'));
    body.appendChild(h('div', { class: 'steps' }, steps.map(s0 => h('div', { class: 'step' + (s0.done ? ' done' : '') }, h('b', null, s0.step_no + '. ' + STEPS[s0.step_no - 1][2]), h('div', { class: 'muted small' }, s0.done ? `${G.userShort(s0.done_by)} · ${G.fmt.date(s0.done_at)}` : 'Pendiente')))));
    body.appendChild(table({ id: 'tel-01', search: false, columns: [
      { key: 'step_no', label: 'Paso', align: 'c' }, { key: 'n', label: 'Qué se hace', value: x => STEPS[x.step_no - 1][2], render: x => h('div', null, h('b', null, STEPS[x.step_no - 1][2]), h('div', { class: 'muted small' }, STEPS[x.step_no - 1][3])) },
      { key: 'done', label: 'Estado', render: x => x.done ? badge('Hecho', 'ok') : badge('Pendiente', 'warn') }, { key: 'done_by', label: 'Responsable', value: x => G.userShort(x.done_by) }, { key: 'done_at', label: 'Fecha', render: x => G.fmt.datetime(x.done_at) }, { key: 'notes', label: 'Evidencia o nota', value: x => x.evidence || x.notes || '' }],
      rows: steps, actions: x => canM ? [x.done ? btn('Desmarcar', guarded(() => { T.markStep(x.step_no, { done: false }); G.refresh(); }), { sm: true }) : btn('Marcar hecho', () => stepForm(x), { sm: true, kind: 'primary' })] : [] }));
    body.appendChild(notice('RN-TEL-02: al encender el módulo se crean la lista de 6 pasos y los ajustes en SETUP; se configura todo, pero no se cursan llamadas. El paso 6 solo se marca con el módulo encendido. Apagarlo de nuevo bloquea todo y conserva lo registrado (RN-TEL-01).', 'info'));
  }
  function stepForm(x) {
    drawer('Paso ' + x.step_no + ': ' + STEPS[x.step_no - 1][2], (b, close) => {
      b.appendChild(notice(STEPS[x.step_no - 1][3], 'info'));
      b.appendChild(form({ id: 'tel-step', values: { notes: x.notes || '' }, fields: [{ key: 'evidence', label: 'Evidencia (archivo o enlace)', type: 'text', placeholder: 'contrato-twilio.pdf' }, { key: 'notes', label: 'Nota', type: 'textarea', required: true }], submitLabel: 'Marcar hecho', onCancel: close, onSubmit: v => { T.markStep(x.step_no, { done: true, notes: v.notes, evidence: v.evidence }); close(); toast('Paso marcado', 'ok'); G.refresh(); return true; } }));
    }, { code: 'TEL-01' });
  }
  function switchOn() {
    if (!(G.ctx.role === 'GERENTE' || G.ctx.role === 'ADMIN_SISTEMA')) { toast('Encender un módulo lo hace gerencia o el administrador del sistema (PLT-12).', 'warn'); return; }
    modal('Encender TEL', b => b.appendChild(form({ id: 'tel-on', fields: [{ key: 'reason', label: 'Motivo (queda en el historial del módulo)', type: 'textarea', required: true }], submitLabel: 'Encender', onSubmit: v => { G.setModule('TEL', true, v.reason); G.ui.closeAll(); toast('TEL encendido en etapa de preparación (SETUP)', 'ok'); G.refresh(); return true; } })));
  }

  function s02(el) {
    const body = G.ui.page(el, { code: 'TEL-02', title: 'Ajustes', sub: 'Proveedor y conector, grabación, transcripción, días de retención, texto y audio del aviso, reparto, tiempo de timbre, plazo para devolver llamadas y «solo llamar a clientes registrados».' });
    previewNote() && body.appendChild(notice('Con el módulo apagado los ajustes se guardan como preparación para el encendido; la API /api/v1/tel/* y el guardia tel_guard de la base de datos siguen rechazando escrituras con RN-PLT-07.', 'info'));
    const s = T.settings() || T.prepareActivation();
    const canM = G.can('tel.settings.manage');
    const rates = T.rates();
    body.appendChild(h('div', { class: 'grid side-r' },
      card('Configuración', form({ id: 'tel-set', values: Object.assign({}, s, { r_out: rates.out_mobile, r_land: rates.out_landline, r_in: rates.inbound, r_rec: rates.recording, r_tr: rates.transcription }), fields: [
        { key: 'provider', label: 'Proveedor (TelephonyProvider)', type: 'select', options: [['TWILIO', 'Twilio'], ['FAKE', 'Adaptador falso (pruebas)'], ['OTHER', 'Otro con números de Lima']], required: true, disabled: !canM },
        { key: 'connector_id', label: 'Conector (INT)', type: 'text', disabled: !canM },
        { key: 'recording_enabled', label: 'Grabar las llamadas', type: 'checkbox', disabled: !canM },
        { key: 'transcription_enabled', label: 'Transcribir las grabaciones y pasarlas por las alertas de CRM', type: 'checkbox', disabled: !canM },
        { key: 'recording_notice_text', label: 'Texto del aviso de grabación (RN-TEL-04)', type: 'textarea', required: true, disabled: !canM },
        { key: 'retention_days', label: 'Días de retención de grabaciones', type: 'number', min: 1, max: 3650, required: true, disabled: !canM, help: 'D-TEL-03: 180 días mientras el abogado lo valida' },
        { key: 'ring_strategy', label: 'Reparto por defecto', type: 'select', options: [['ROUND_ROBIN', 'Por turno (prioridad)'], ['SIMULTANEOUS', 'Todas a la vez']], required: true, disabled: !canM },
        { key: 'ring_timeout_s', label: 'Segundos que suena cada vendedora', type: 'number', min: 5, max: 120, required: true, disabled: !canM },
        { key: 'callback_due_minutes', label: 'Minutos para devolver una llamada perdida', type: 'number', min: 1, required: true, disabled: !canM },
        { key: 'outbound_registered_only', label: 'Solo llamar a clientes o leads registrados', type: 'checkbox', disabled: !canM },
        { key: 'r_out', label: 'Tarifa saliente a celular (USD/min)', type: 'number', disabled: !canM }, { key: 'r_land', label: 'Tarifa saliente a fijo (USD/min)', type: 'number', disabled: !canM },
        { key: 'r_in', label: 'Tarifa entrante (USD/min)', type: 'number', disabled: !canM }, { key: 'r_rec', label: 'Grabación (USD/min)', type: 'number', disabled: !canM }, { key: 'r_tr', label: 'Transcripción (USD/min)', type: 'number', disabled: !canM }],
        submitLabel: canM ? 'Guardar ajustes' : false,
        onSubmit: v => { T.saveSettings({ provider: v.provider, connector_id: v.connector_id || null, recording_enabled: !!v.recording_enabled, transcription_enabled: !!v.transcription_enabled, recording_notice_text: v.recording_notice_text, retention_days: Number(v.retention_days), ring_strategy: v.ring_strategy, ring_timeout_s: Number(v.ring_timeout_s), callback_due_minutes: Number(v.callback_due_minutes), outbound_registered_only: !!v.outbound_registered_only, rates: { out_mobile: Number(v.r_out), out_landline: Number(v.r_land), inbound: Number(v.r_in), recording: Number(v.r_rec), transcription: Number(v.r_tr) } }); toast('Ajustes guardados', 'ok'); G.refresh(); return true; } })),
      h('div', { class: 'stack' },
        card('Aviso de grabación · Ley 29733', h('div', { class: 'stack' }, h('p', null, '«', s.recording_notice_text, '»'), h('div', { class: 'muted small' }, 'Se reproduce antes de conectar con la vendedora en toda llamada grabada; una llamada sin aviso no guarda su grabación (RN-TEL-04). La política de privacidad informa la finalidad (calidad y control), el plazo de conservación (' + s.retention_days + ' días) y cómo ejercer los derechos ARCO; las grabaciones se clasifican como datos personales.'), h('div', { class: 'row' }, badge(s.notice_audio_file_id ? 'Audio cargado' : 'Audio: aviso-grabacion.mp3 (paso 3)', 'info')))),
        card('Llamadas de WhatsApp', h('div', { class: 'muted small' }, 'RN-TEL-12 · D-TEL-04: en coexistencia las llamadas de WhatsApp no pasan por la API ni se graban. El perfil y la respuesta automática de los 6 números indican el número de la central: +51 1 708 5500.')),
        card('API y base de datos', dl([['GET /api/v1/tel/calls', (() => { const r0 = T.api('GET', '/api/v1/tel/calls'); return r0.status === 200 ? badge('200 OK', 'ok') : badge(`${r0.status} ${r0.code}`, 'bad'); })()], ['Escritura en tel_* (tel_guard)', G.modOn('TEL') ? badge('Permitida', 'ok') : badge('403 RN-PLT-07', 'bad')]])))));
  }

  function s03(el) {
    const canM = G.can('tel.settings.manage');
    const body = G.ui.page(el, { code: 'TEL-03', title: 'Números y desvíos', sub: 'Números de la central por marca o general, con menú o grupo de llamada, y los celulares de la publicidad desviados por el operador.', actions: canM ? [{ label: 'Agregar número', kind: 'primary', icon: '+', onClick: () => numberForm(null) }] : [] });
    previewNote() && body.appendChild(previewNote());
    body.appendChild(notice('D-TEL-02: por defecto un número general con menú por marca. Los 6 números de WhatsApp siguen en la app; el operador desvía sus llamadas de voz a la central (paso 2).', 'info'));
    const rows = G.db.all('tel_numbers');
    body.appendChild(table({ id: 'tel-03', columns: [{ key: 'e164', label: 'Número', mono: true }, { key: 'kind', label: 'Tipo', value: n => kindName(n.number_kind) }, { key: 'brand', label: 'Marca', value: n => n.brand_id ? G.brandName(n.brand_id) : 'General' }, { key: 'dest', label: 'Atiende', value: n => n.menu_id ? 'Menú: ' + (G.db.get('tel_menus', n.menu_id) || {}).name : n.ring_group_id ? 'Grupo: ' + (G.db.get('tel_ring_groups', n.ring_group_id) || {}).name : '—' }, { key: 'fw', label: 'Desvíos desde', value: n => (n.forwarded_from || []).join(', ') || '—' }, { key: 'provider_ref', label: 'Referencia del proveedor', mono: true }, { key: 'status', label: 'Estado', render: n => st(n.status) }], rows, onRow: n => canM ? numberForm(n) : null }));
  }
  function numberForm(n) {
    drawer(n ? 'Número ' + n.e164 : 'Nuevo número', (b, close) => {
      b.appendChild(form({ id: 'tel-num', values: n ? Object.assign({}, n, { forwarded: (n.forwarded_from || []).join(', ') }) : { number_kind: 'LANDLINE_LIMA', status: 'ACTIVE' }, fields: [
        { key: 'e164', label: 'Número (E.164)', type: 'text', required: true, placeholder: '+5117085500' },
        { key: 'number_kind', label: 'Tipo', type: 'select', options: KIND, required: true },
        { key: 'brand_id', label: 'Marca (vacío = general)', type: 'select', options: G.db.all('brands').map(b0 => [b0.id, b0.name]) },
        { key: 'menu_id', label: 'Menú de voz', type: 'select', options: G.db.all('tel_menus').map(m => [m.id, m.name]) },
        { key: 'ring_group_id', label: 'Grupo de llamada (si no hay menú)', type: 'select', options: G.db.all('tel_ring_groups').map(g => [g.id, g.name]) },
        { key: 'forwarded', label: 'Celulares desviados (separados por coma)', type: 'text', span: 2 },
        { key: 'provider_ref', label: 'Referencia del proveedor', type: 'text' }, { key: 'status', label: 'Estado', type: 'select', options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']], required: true }],
        submitLabel: 'Guardar', onCancel: close,
        onSubmit: v => {
          if (!/^\+[0-9]{8,15}$/.test(v.e164)) return { e164: 'Formato E.164: + y de 8 a 15 dígitos.' };
          if (G.db.find('tel_numbers', x => x.e164 === v.e164 && (!n || x.id !== n.id))) return { e164: 'Ese número ya está registrado.' };
          if (!v.menu_id && !v.ring_group_id) return { menu_id: 'Elige un menú o un grupo de llamada.' };
          const fw = String(v.forwarded || '').split(',').map(x => e164(x.trim())).filter(Boolean);
          if (fw.some(x => !G.util.phoneOk(x))) return { forwarded: 'Algún celular no es válido.' };
          const row = { e164: v.e164, number_kind: v.number_kind, brand_id: v.brand_id || null, menu_id: v.menu_id || null, ring_group_id: v.ring_group_id || null, forwarded_from: fw, provider_ref: v.provider_ref || null, status: v.status };
          if (n) G.db.update('tel_numbers', n.id, row); else G.db.insert('tel_numbers', row);
          close(); toast('Número guardado', 'ok'); G.refresh(); return true;
        } }));
    }, { code: 'TEL-03' });
  }

  function s04(el) {
    const canM = G.can('tel.settings.manage');
    const body = G.ui.page(el, { code: 'TEL-04', title: 'Menú de voz y horario', sub: 'Saludo, opciones por marca (1 Don Guando, 2 Marca 2…), horario de atención y qué pasa fuera de horario (buzón o tarea de devolución).' });
    previewNote() && body.appendChild(previewNote());
    const m = G.db.find('tel_menus', x => x.status === 'ACTIVE') || G.db.all('tel_menus')[0];
    if (!m) { body.appendChild(G.ui.empty('Sin menú configurado.')); return; }
    const bh = m.business_hours || {};
    const vals = { name: m.name, greeting_text: m.greeting_text, after_hours_action: m.after_hours_action, ms_from: (bh.mon_sat || [])[0], ms_to: (bh.mon_sat || [])[1], su_from: (bh.sun || [])[0], su_to: (bh.sun || [])[1] };
    (m.options || []).forEach(o => { vals['opt' + o.digit] = o.brand_id || (o.direct_user_id ? 'SUP' : ''); });
    const brOpts = G.db.all('brands').map(b => [b.id, b.name]).concat([['SUP', 'Supervisora (directo)']]);
    body.appendChild(h('div', { class: 'grid side-r' },
      card('Menú', form({ id: 'tel-menu', values: vals, fields: [
        { key: 'name', label: 'Nombre', type: 'text', required: true, disabled: !canM },
        { key: 'greeting_text', label: 'Saludo (incluye el aviso de grabación)', type: 'textarea', required: true, disabled: !canM },
        ...[1, 2, 3, 4, 5, 9].map(d => ({ key: 'opt' + d, label: 'Opción ' + d, type: 'select', options: brOpts, disabled: !canM })),
        { key: 'ms_from', label: 'Lunes a sábado desde', type: 'text', placeholder: '08:00', disabled: !canM }, { key: 'ms_to', label: 'Lunes a sábado hasta', type: 'text', placeholder: '20:00', disabled: !canM },
        { key: 'su_from', label: 'Domingo desde', type: 'text', disabled: !canM }, { key: 'su_to', label: 'Domingo hasta', type: 'text', disabled: !canM },
        { key: 'after_hours_action', label: 'Fuera de horario', type: 'select', options: [['CALLBACK_TASK', 'Tarea de devolver la llamada'], ['VOICEMAIL', 'Buzón de voz'], ['FORWARD', 'Desviar a la supervisora']], required: true, disabled: !canM }],
        submitLabel: canM ? 'Guardar menú' : false,
        onSubmit: v => {
          const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
          for (const k of ['ms_from', 'ms_to', 'su_from', 'su_to']) if (v[k] && !hhmm.test(v[k])) return { [k]: 'Formato HH:MM' };
          if (v.ms_from && v.ms_to && v.ms_from >= v.ms_to) return { ms_to: 'La hora final debe ser posterior a la inicial.' };
          if (!/grabad/i.test(v.greeting_text) && T.settings().recording_enabled) return { greeting_text: 'RN-TEL-04: con grabación activa el saludo debe incluir el aviso de grabación.' };
          const opts = [1, 2, 3, 4, 5, 9].filter(d => v['opt' + d]).map(d => { const b = v['opt' + d]; const g = b !== 'SUP' && T.group(b); return { digit: d, brand_id: b === 'SUP' ? null : b, label: b === 'SUP' ? 'Supervisora' : G.brandName(b), ring_group_id: g ? g.id : (T.group('br-DG') || {}).id, direct_user_id: b === 'SUP' ? (G.db.find('users', u => u.role === 'SUPERVISORA_VENTAS') || {}).id : null }; });
          const dup = opts.map(o => o.brand_id).filter(Boolean); if (new Set(dup).size !== dup.length) return 'Una marca está en dos opciones.';
          G.db.update('tel_menus', m.id, { name: v.name, greeting_text: v.greeting_text, after_hours_action: v.after_hours_action, business_hours: { mon_sat: [v.ms_from, v.ms_to], sun: [v.su_from, v.su_to], holidays: 'closed' }, options: opts });
          toast('Menú guardado', 'ok'); G.refresh(); return true;
        } })),
      h('div', { class: 'stack' },
        card('Así lo escucha el cliente', h('div', { class: 'chat' }, h('div', { class: 'msg sys' }, m.greeting_text), (m.options || []).map(o => h('div', { class: 'msg' }, h('b', null, o.digit), ' → ', o.label, ' · ', h('span', { class: 'muted small' }, o.ring_group_id ? (G.db.get('tel_ring_groups', o.ring_group_id) || {}).name : ''))))),
        card('Horario', dl([['Lunes a sábado', (bh.mon_sat || []).join(' – ')], ['Domingo', (bh.sun || []).join(' – ')], ['Feriados', 'Cerrado'], ['Fuera de horario', { CALLBACK_TASK: 'Tarea de devolver la llamada (RN-TEL-07)', VOICEMAIL: 'Buzón de voz (crea tarea)', FORWARD: 'Desvío a la supervisora' }[m.after_hours_action]]])))));
  }

  function s05(el) {
    const canM = G.can('tel.settings.manage');
    const body = G.ui.page(el, { code: 'TEL-05', title: 'Grupos de llamada', sub: 'Vendedoras por marca con prioridad; estrategia por turno (cada una suena unos segundos en orden) o todas a la vez (RN-TEL-06).' });
    previewNote() && body.appendChild(previewNote());
    const groups = G.scope.filter(G.db.all('tel_ring_groups'), { brand: 'brand_id', site: '_none' });
    body.appendChild(h('div', { class: 'grid c2' }, groups.map(g => {
      const ms = G.db.where('tel_ring_members', m => m.group_id === g.id).sort(U.by('priority'));
      const plan = T.ringPlan(g);
      return card(g.name, h('div', { class: 'stack' },
        h('div', { class: 'row', style: 'flex-wrap:wrap' }, badge(g.strategy === 'SIMULTANEOUS' ? 'Todas a la vez' : 'Por turno', 'info'), badge(g.ring_timeout_s + ' s por vendedora', ''), G.brandName(g.brand_id)),
        table({ id: 'tel-05-' + g.id, search: false, columns: [{ key: 'priority', label: 'Prioridad', align: 'c' }, { key: 'u', label: 'Vendedora', value: m => G.userName(m.user_id) }, { key: 'active', label: 'Estado', render: m => m.active ? badge('Activa', 'ok') : badge('Pausada', '') }], rows: ms,
          actions: m => canM ? [btn('↑', () => { const prev = ms.filter(x => x.priority < m.priority).pop(); if (prev) { const p0 = prev.priority; G.db.update('tel_ring_members', prev.id, { priority: m.priority }); G.db.update('tel_ring_members', m.id, { priority: p0 }); G.refresh(); } }, { sm: true, title: 'Subir prioridad' }), btn(m.active ? 'Pausar' : 'Activar', () => { G.db.update('tel_ring_members', m.id, { active: !m.active }); G.refresh(); }, { sm: true })] : [] }),
        h('div', { class: 'muted small' }, 'Orden de timbre: ', plan.map(p => `${p.users.map(G.userShort).join(' + ')} (${p.from_s}–${p.to_s} s)`).join(' → ') || '—', ' → buzón o llamada perdida.'),
        canM ? h('div', { class: 'row' }, btn('Editar grupo', () => groupForm(g), { sm: true }), btn('Agregar vendedora', () => memberForm(g), { sm: true })) : null));
    })));
  }
  function groupForm(g) {
    drawer('Grupo ' + g.name, (b, close) => b.appendChild(form({ id: 'tel-grp', values: g, fields: [{ key: 'name', label: 'Nombre', type: 'text', required: true }, { key: 'strategy', label: 'Estrategia', type: 'select', options: [['ROUND_ROBIN', 'Por turno'], ['SIMULTANEOUS', 'Todas a la vez']], required: true }, { key: 'ring_timeout_s', label: 'Segundos por vendedora', type: 'number', min: 5, max: 120, required: true }], submitLabel: 'Guardar', onCancel: close, onSubmit: v => { G.db.update('tel_ring_groups', g.id, { name: v.name, strategy: v.strategy, ring_timeout_s: Number(v.ring_timeout_s) }); close(); toast('Grupo guardado', 'ok'); G.refresh(); return true; } })), { code: 'TEL-05' });
  }
  function memberForm(g) {
    const ms = G.db.where('tel_ring_members', m => m.group_id === g.id);
    drawer('Agregar a ' + g.name, (b, close) => b.appendChild(form({ id: 'tel-mem', fields: [{ key: 'user_id', label: 'Vendedora', type: 'select', required: true, options: G.db.where('users', u => ['VENDEDORA', 'SUPERVISORA_VENTAS'].includes(u.role) && !ms.find(m => m.user_id === u.id)).map(u => [u.id, u.name]) }], submitLabel: 'Agregar', onCancel: close, onSubmit: v => { const u = G.db.get('users', v.user_id); if (u.role === 'VENDEDORA' && !u.brands.includes(g.brand_id)) return { user_id: `${u.name} no atiende ${G.brandName(g.brand_id)} (SEG).` }; G.db.insert('tel_ring_members', { group_id: g.id, user_id: v.user_id, priority: ms.length + 1, active: true }); close(); toast('Vendedora agregada', 'ok'); G.refresh(); return true; } })), { code: 'TEL-05' });
  }

  function s06(el) {
    const body = G.ui.page(el, { code: 'TEL-06', title: 'Teléfono en la app', sub: 'Softphone en la computadora o el celular de la empresa: al sonar abre la ficha 360 del cliente o crea el lead (RN-TEL-08).' });
    previewNote() && body.appendChild(previewNote());
    const S = T._phone = T._phone || { num: '', option: 1 };
    const custs = G.scope.filter(G.db.where('customers', c => c.phone && c.status === 'ACTIVE'), { brand: '_none', site: '_none' }).slice(0, 60);
    const screen = h('div', { class: 'phone-screen' });
    const draw = () => {
      G.ui.clear(screen);
      screen.appendChild(h('div', { class: 'stack' }, h('b', null, 'Central Don Guando'), h('div', { class: 'muted small' }, `${G.ctx.userName()} · ${T.isLive() ? 'en línea' : 'sin servicio (' + (off() ? 'módulo apagado' : 'etapa de preparación') + ')'}`)));
      if (S.call) {
        const c = G.db.get('tel_calls', S.call);
        const w = T.callerOf(c.from_e164);
        screen.appendChild(card(c.status === 'RINGING' ? 'Llamada entrante' : 'Llamada', h('div', { class: 'stack' }, h('b', { class: 'mono' }, c.from_e164), w.customer ? custCard(w.customer) : h('div', null, badge('Lead nuevo creado (RN-TEL-08)', 'info')), st(c.status))));
      } else {
        const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Cliente que llama', id: 'tel-06-num' } }, h('option', { value: '' }, 'Número desconocido'), custs.map(c => h('option', { value: c.phone, selected: S.num === c.phone }, `${c.phone} · ${c.full_name}`)));
        sel.addEventListener('change', () => { S.num = sel.value; });
        const opt = h('select', { class: 'input', attrs: { 'aria-label': 'Opción del menú', id: 'tel-06-opt' } }, G.db.all('brands').sort(U.by('sort_order')).map((b, i) => h('option', { value: i + 1, selected: Number(S.option) === i + 1 }, `${i + 1} · ${b.name}`)));
        opt.addEventListener('change', () => { S.option = opt.value; });
        screen.appendChild(h('div', { class: 'stack' }, h('label', { class: 'small', attrs: { for: 'tel-06-num' } }, 'Simular que llama'), sel, h('label', { class: 'small', attrs: { for: 'tel-06-opt' } }, 'Opción marcada'), opt,
          h('div', { class: 'row', style: 'flex-wrap:wrap' },
            btn('Contestar', guarded(() => { const c = T.registerInbound({ from_e164: S.num || unknownNum(), option: S.option, status: 'COMPLETED', duration_seconds: 150, user_id: G.ctx.userId() }); S.call = c.id; toast('Llamada atendida y grabada con aviso', 'ok'); draw(); }), { kind: 'primary', sm: true }),
            btn('No contestar', guarded(() => { const c = T.registerInbound({ from_e164: S.num || unknownNum(), option: S.option, status: 'MISSED' }); S.call = c.id; toast('Llamada perdida: se creó la tarea de devolverla', 'warn'); draw(); }), { sm: true }))));
      }
      if (S.call) screen.appendChild(btn('Colgar', () => { S.call = null; draw(); }, { sm: true }));
    };
    draw();
    const lastIn = G.db.where('tel_calls', c => c.direction === 'INBOUND' && (G.can('tel.call.view_all') || c.user_id === G.ctx.userId())).sort(U.by('started_at', -1)).slice(0, 8);
    body.appendChild(h('div', { class: 'grid c2' }, h('div', { class: 'phone' }, screen), card('Últimas entrantes', h('div', { class: 'stack' }, lastIn.map(c => h('div', { class: 'between', style: 'gap:8px' }, h('div', { style: 'min-width:0' }, h('div', null, who(c)), h('div', { class: 'muted small mono' }, callLabel(c))), st(c.status)))))));
  }
  function unknownNum() { T._unk = (T._unk || 0) + 1; return '+51955' + U.pad(300100 + T._unk, 6); }
  function custCard(c) {
    const os = G.db.where('sales_orders', o => o.customer_id === c.id).sort(U.by('created_at', -1));
    const open = os.filter(o => !['CLOSED', 'CANCELLED', 'DELIVERED'].includes(o.status));
    return h('div', { class: 'stack', style: 'gap:4px' }, h('b', null, c.full_name), h('div', { class: 'muted small' }, `${c.orders_count || os.length} pedidos · último ${G.fmt.date(c.last_order_at)}`), open.length ? h('div', { class: 'small' }, 'En curso: ', open.slice(0, 2).map(o => o.number + ' (' + G.ui.statusLabel(o.status) + ')').join(', ')) : null);
  }

  function s07(el, params) {
    const body = G.ui.page(el, { code: 'TEL-07', title: 'Llamar desde la ficha o el pedido', sub: 'Botón «Llamar» (click-to-call) con el número de la marca del cliente o del pedido; el cliente nunca ve el número personal de la vendedora (RN-TEL-05).' });
    previewNote() && body.appendChild(previewNote());
    const today = G.scope.filter(G.db.where('sales_orders', o => o.delivery_date === G.TODAY && !['CANCELLED', 'CLOSED'].includes(o.status))).slice(0, 200);
    const S = T._c2c = T._c2c || {};
    const sel = h('select', { class: 'input', attrs: { 'aria-label': 'Pedido', id: 'tel-07-o' } }, today.map(o => h('option', { value: o.id, selected: (S.order || (params && params.order)) === o.id }, `${o.number} · ${G.custName(o.customer_id)} · ${G.brandName(o.brand_id)}`)));
    sel.addEventListener('change', () => { S.order = sel.value; G.refresh(); });
    const o = G.db.get('sales_orders', S.order || (params && params.order) || (today[0] || {}).id);
    const num = o && T.numberFor(o.brand_id);
    const bt = o ? T.callButton({ order_id: o.id }) : null;
    body.appendChild(h('div', { class: 'grid c2' },
      card('Pedido de hoy', h('div', { class: 'stack' }, sel, o ? dl([['Cliente', G.custName(o.customer_id)], ['Celular del cliente', o.contact_phone], ['Marca', G.brandFull(o.brand_id)], ['Sale con el número', num ? num.e164 + ' (' + (num.brand_id ? 'de la marca' : 'general') + ')' : '—'], ['Estado', G.ui.status(o.status)]]) : G.ui.empty('Sin pedidos para hoy')),
        { actions: [bt || h('span', { class: 'muted small' }, off() ? 'Sin botón «Llamar»: TEL apagado (CA-TEL-01)' : 'Sin permiso tel.call.make')] }),
      card('Llamada simulada', h('div', { class: 'stack' },
        h('div', { class: 'muted small' }, 'Para probar el flujo completo con duración y resultado:'),
        form({ id: 'tel-07-f', values: { duration: 95, status: 'COMPLETED' }, fields: [{ key: 'duration', label: 'Duración (s)', type: 'number', min: 0 }, { key: 'status', label: 'Resultado', type: 'select', options: [['COMPLETED', 'Atendió'], ['NO_ANSWER', 'No contestó'], ['BUSY', 'Ocupado']], required: true }], submitLabel: 'Llamar', onSubmit: v => { if (!o) return 'Elige un pedido.'; const c = T.click2call({ order_id: o.id, duration_seconds: Number(v.duration) || 0, status: v.status }); toast(`Llamada ${stName(c.status).toLowerCase()} con ${c.from_e164}`, 'ok'); G.refresh(); return true; } })))));
    const mine = G.db.where('tel_calls', c => c.direction === 'OUTBOUND' && (G.can('tel.call.view_all') || c.user_id === G.ctx.userId())).sort(U.by('started_at', -1));
    body.appendChild(card('Llamadas salientes', table({ id: 'tel-07', columns: [{ key: 'started_at', label: 'Inicio', render: c => G.fmt.datetime(c.started_at) }, { key: 'from_e164', label: 'Sale con', mono: true }, { key: 'to_e164', label: 'Cliente', mono: true }, { key: 'w', label: 'Nombre', value: who }, { key: 'u', label: 'Vendedora', value: c => G.userShort(c.user_id) }, { key: 'o', label: 'Pedido', value: c => (G.db.get('sales_orders', c.order_id) || {}).number || '—' }, { key: 'status', label: 'Estado', render: c => st(c.status) }, { key: 'duration_seconds', label: 'Duración', align: 'r', render: c => secs(c.duration_seconds) }], rows: mine, onRow: callDrawer, pageSize: 10 }), { flush: true }));
  }

  function callDrawer(c) {
    drawer('Llamada ' + callLabel(c), (b) => {
      const rec = G.db.find('tel_recordings', r => r.call_id === c.id);
      if (c.preview) b.appendChild(notice('Llamada de ejemplo (vista previa).', 'info'));
      b.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' }, rec ? btn('Grabación y transcripción', () => G.go('TEL-10', { rec: rec.id }), { sm: true, kind: 'primary' }) : null, c.order_id ? btn('Ver pedido', () => G.screens['PED-03'] ? G.go('PED-03', { id: c.order_id }) : toast((G.db.get('sales_orders', c.order_id) || {}).number, 'info'), { sm: true }) : null));
      b.appendChild(dl([['Dirección', c.direction === 'INBOUND' ? 'Entrante' : 'Saliente'], ['Desde', c.from_e164], ['Hacia', c.to_e164], ['Cliente o lead', who(c)], ['Marca', G.brandName(c.brand_id)], ['Opción del menú', c.menu_option || '—'], ['Vendedora', G.userName(c.user_id)], ['Estado', st(c.status)], ['Inicio', G.fmt.datetime(c.started_at)], ['Atendida', G.fmt.datetime(c.answered_at)], ['Fin', G.fmt.datetime(c.ended_at)], ['Espera', secs(c.wait_seconds)], ['Duración', secs(c.duration_seconds)], ['Aviso de grabación', c.notice_played ? 'Reproducido' : 'No'], ['Grabación', rec ? st(rec.status) : (c.recording_skipped || '—')], ['Pedido creado', (G.db.get('sales_orders', c.order_id) || {}).number || '—'], ['Costo', c.cost_usd != null ? 'USD ' + G.fmt.num(c.cost_usd, 4) : '—'], ['ID del proveedor', c.provider_call_id]]));
      const tk = T.tasks().filter(t => t.call_id === c.id);
      if (tk.length) b.appendChild(card('Tarea de devolver la llamada', dl([['Responsable', G.userName(tk[0].assigned_user_id)], ['Vence', G.fmt.datetime(tk[0].due_at)], ['Estado', st(tk[0].status)], ['Hecha', G.fmt.datetime(tk[0].done_at)], ['Resultado', tk[0].result]])));
    }, { code: 'TEL-08', wide: true });
  }

  function s08(el) {
    const body = G.ui.page(el, { code: 'TEL-08', title: 'Historial de llamadas', sub: 'Por cliente, pedido y vendedora: dirección, estado, espera, duración, grabación y pedido creado.' });
    previewNote() && body.appendChild(previewNote());
    const calls = T.visibleCalls().sort(U.by('started_at', -1));
    if (!G.can('tel.call.view_all')) body.appendChild(notice('Ves solo tus llamadas (tel.call.view_own).', 'info'));
    const recSet = new Set(G.db.all('tel_recordings').map(r => r.call_id));
    const done = calls.filter(c => c.status === 'COMPLETED');
    body.appendChild(kpis([{ label: 'Llamadas', value: G.fmt.num(calls.length) }, { label: 'Atendidas', value: G.fmt.num(done.length) }, { label: 'Perdidas', value: G.fmt.num(calls.filter(c => MISSED.includes(c.status)).length), tone: 'warn' }, { label: 'Terminan en pedido', value: G.fmt.pct(done.length ? done.filter(c => c.order_id).length / done.length * 100 : null) }]));
    body.appendChild(table({ id: 'tel-08', columns: [
      { key: 'started_at', label: 'Inicio', render: c => G.fmt.datetime(c.started_at) }, { key: 'direction', label: 'Dirección', value: c => c.direction === 'INBOUND' ? 'Entrante' : 'Saliente' }, { key: 'num', label: 'Número', mono: true, value: c => c.direction === 'INBOUND' ? c.from_e164 : c.to_e164 },
      { key: 'w', label: 'Cliente o lead', value: who }, { key: 'brand', label: 'Marca', value: c => G.brandName(c.brand_id) }, { key: 'u', label: 'Vendedora', value: c => G.userShort(c.user_id) },
      { key: 'status', label: 'Estado', value: c => stName(c.status), render: c => st(c.status) }, { key: 'wait_seconds', label: 'Espera', align: 'r', render: c => secs(c.wait_seconds) }, { key: 'duration_seconds', label: 'Duración', align: 'r', render: c => secs(c.duration_seconds) },
      { key: 'rec', label: 'Grabación', value: c => recSet.has(c.id) ? 'Sí' : 'No' }, { key: 'o', label: 'Pedido', value: c => (G.db.get('sales_orders', c.order_id) || {}).number || '' }],
      rows: calls, onRow: callDrawer, filters: [{ key: 'direction', label: 'Dirección', options: DIR }, { key: 'status', label: 'Estado', options: Object.entries(CST).slice(0, 8).map(([k, v]) => [k, v[0]]) }, { key: 'user_id', label: 'Vendedora', options: G.db.where('users', u => ['VENDEDORA', 'SUPERVISORA_VENTAS'].includes(u.role)).map(u => [u.id, u.name]) }, { key: 'brand_id', label: 'Marca', options: G.db.all('brands').map(b => [b.id, G.brandName(b.id)]) }] }));
  }

  function s09(el) {
    const body = G.ui.page(el, { code: 'TEL-09', title: 'Llamadas perdidas', sub: `Tareas de devolver la llamada con vencimiento (${(T.settings() || {}).callback_due_minutes || 30} min) y responsable; se cierran solas si el cliente vuelve a llamar y se le atiende (RN-TEL-07).` });
    previewNote() && body.appendChild(previewNote());
    const me = G.ctx.userId(); const all = G.can('tel.call.view_all');
    const ts = T.tasks().filter(t => all || t.assigned_user_id === me).sort(U.by('due_at', -1));
    const nowS = G.date.now();
    const late = ts.filter(t => t.status === 'OPEN' && t.due_at < nowS);
    const onTime = ts.filter(t => t.status === 'DONE' && t.done_at && t.done_at <= t.due_at).length;
    body.appendChild(kpis([{ label: 'Abiertas', value: G.fmt.num(ts.filter(t => t.status === 'OPEN').length), tone: 'warn' }, { label: 'Vencidas', value: G.fmt.num(late.length + ts.filter(t => t.status === 'EXPIRED').length), tone: late.length ? 'bad' : 'ok' }, { label: 'Devueltas a tiempo', value: G.fmt.pct(ts.length ? onTime / ts.length * 100 : null), sub: 'KPI-TEL-06' }]));
    body.appendChild(table({ id: 'tel-09', columns: [
      { key: 'due_at', label: 'Vence', render: t => h('span', null, G.fmt.datetime(t.due_at), ' ', t.status === 'OPEN' && t.due_at < nowS ? badge('vencida', 'bad') : null) },
      { key: 'num', label: 'Número', mono: true, value: t => (G.db.get('tel_calls', t.call_id) || {}).from_e164 || t.phone },
      { key: 'w', label: 'Cliente o lead', value: t => t.customer_id ? G.custName(t.customer_id) : 'Lead' }, { key: 'brand', label: 'Marca', value: t => G.brandName(t.brand_id) },
      { key: 'u', label: 'Responsable', value: t => G.userShort(t.assigned_user_id) }, { key: 'status', label: 'Estado', value: t => stName(t.status), render: t => st(t.status) }, { key: 'done_at', label: 'Hecha', render: t => G.fmt.datetime(t.done_at) }, { key: 'result', label: 'Resultado', value: t => t.result || '' }],
      rows: ts, onRow: t => { const c = G.db.get('tel_calls', t.call_id); if (c) callDrawer(c); },
      filters: [{ key: 'status', label: 'Estado', options: [['OPEN', 'Abierta'], ['DONE', 'Hecha'], ['EXPIRED', 'Vencida']] }],
      actions: t => t.status === 'OPEN' ? [btn('Devolver', guarded(() => { const call = T.click2call({ customer_id: t.customer_id, lead_id: t.lead_id }); if (t.source === 'CRM') G.db.update('crm_tasks', t.id, { status: 'DONE', done_at: call.started_at, result: 'Llamada devuelta (' + stName(call.status) + ')' }); toast('Llamada devuelta', 'ok'); G.refresh(); }), { sm: true, kind: 'primary' })] : [] }));
  }

  let playTimer = null;
  function s10(el, params) {
    const body = G.ui.page(el, { code: 'TEL-10', title: 'Grabación y transcripción', sub: 'Reproductor con registro de acceso, texto de la transcripción y alertas encontradas (Ley 29733: cada escucha queda en la bitácora).' });
    previewNote() && body.appendChild(previewNote());
    const calls = new Map(T.visibleCalls().map(c => [c.id, c]));
    const recs = G.db.all('tel_recordings').filter(r => calls.has(r.call_id)).sort((a, b) => String(calls.get(b.call_id).started_at).localeCompare(calls.get(a.call_id).started_at));
    const trBy = new Map(G.db.all('tel_transcripts').map(t => [t.recording_id, t]));
    const sel0 = (params && params.rec && G.db.get('tel_recordings', params.rec)) || recs.find(r => (trBy.get(r.id) || {}).preview_alerts && trBy.get(r.id).preview_alerts.length) || recs[0];
    const pick = h('select', { class: 'input', attrs: { 'aria-label': 'Grabación', id: 'tel-10-sel' } }, recs.slice(0, 150).map(r => { const c = calls.get(r.call_id); return h('option', { value: r.id, selected: sel0 && r.id === sel0.id }, `${G.fmt.datetime(c.started_at)} · ${who(c)} · ${G.userShort(c.user_id)}${trBy.has(r.id) ? ' · con texto' : ''}`); }));
    pick.addEventListener('change', () => G.go('TEL-10', { rec: pick.value }));
    body.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap' }, h('label', { class: 'muted small', attrs: { for: 'tel-10-sel' } }, 'Grabación'), pick));
    if (!sel0) { body.appendChild(G.ui.empty('No hay grabaciones visibles para tu usuario.')); return; }
    const c = G.db.get('tel_calls', sel0.call_id); const tr = trBy.get(sel0.id);
    const dur = sel0.duration_seconds || 1; const bars = 60;
    const pos = h('span', { class: 'mono small' }, '0:00 / ' + Math.floor(dur / 60) + ':' + U.pad(dur % 60, 2));
    const svg = G.ui.svg('svg', { viewBox: `0 0 ${bars * 6} 48`, width: '100%', height: 48, role: 'img', 'aria-label': 'Forma de onda' });
    const rr = U.rng(sel0.id.length * 977 + dur);
    for (let i = 0; i < bars; i++) { const hh = 6 + rr() * 36; svg.appendChild(G.ui.svg('rect', { x: i * 6, y: 24 - hh / 2, width: 4, height: hh, rx: 1, fill: 'var(--muted)', 'data-i': i })); }
    const paint = p => { svg.querySelectorAll('rect').forEach(b => b.setAttribute('fill', Number(b.getAttribute('data-i')) / bars <= p ? 'var(--primary)' : 'var(--muted)')); const s = Math.round(p * dur); pos.textContent = `${Math.floor(s / 60)}:${U.pad(s % 60, 2)} / ${Math.floor(dur / 60)}:${U.pad(dur % 60, 2)}`; };
    let p = 0;
    const play = btn('Reproducir', guarded(() => {
      if (playTimer) { clearInterval(playTimer); playTimer = null; play.lastChild.textContent = 'Reproducir'; return; }
      T.listen(sel0.id, { action: 'PLAY', reason: 'Escucha desde TEL-10' });
      play.lastChild.textContent = 'Pausa';
      playTimer = setInterval(() => { p = Math.min(1, p + 1 / 40); paint(p); if (p >= 1 || !document.body.contains(svg)) { clearInterval(playTimer); playTimer = null; } }, 250);
    }), { kind: 'primary', sm: true });
    const dlBtn = btn('Descargar', guarded(() => { modal('Motivo de la descarga', b => b.appendChild(form({ id: 'tel-dl', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], submitLabel: 'Descargar', onSubmit: v => { T.listen(sel0.id, { action: 'DOWNLOAD', reason: v.reason }); G.ui.closeAll(); toast('Descarga registrada en la bitácora', 'ok'); G.refresh(); return true; } }))); }), { sm: true });
    const alerts = T.alerts().filter(a => a.call_id === c.id);
    const hl = tr ? (() => { const div = h('div', { style: 'white-space:pre-wrap;line-height:1.6' }); let txt = tr.transcript; const marks = alerts.flatMap(a => String(a.matched_text).split(/ · |, /)); const nt = norm(txt); const ranges = []; for (const m of marks) { const mm = norm(m).replace(/^\+51/, ''); let i = nt.indexOf(mm); if (i < 0 && /^\d+$/.test(mm)) { const re = new RegExp(mm.split('').join('[\\s-]?')); const mt = nt.match(re); if (mt) i = mt.index, ranges.push([i, i + mt[0].length]); } else if (i >= 0) ranges.push([i, i + mm.length]); } ranges.sort((a, b) => a[0] - b[0]); let last = 0; for (const [a, b] of ranges) { if (a < last) continue; div.append(txt.slice(last, a), h('mark', null, txt.slice(a, b))); last = b; } div.append(txt.slice(last)); return div; })() : null;
    body.appendChild(h('div', { class: 'grid side-r' },
      h('div', { class: 'stack' },
        card('Reproductor', h('div', { class: 'stack' },
          sel0.status === 'PURGED' ? notice(`RN-TEL-10: grabación purgada el ${G.fmt.date(sel0.purged_at)}; se conservan los datos de la llamada.`, 'warn') : null,
          svg, h('div', { class: 'between' }, h('div', { class: 'row' }, play, dlBtn), pos),
          h('div', { class: 'muted small' }, `Retención hasta ${G.fmt.date(sel0.retention_until)}${sel0.legal_hold ? ' · retención legal' : ''} · aviso reproducido: ${c.notice_played ? 'sí' : 'no'}`))),
        card('Transcripción', tr ? h('div', { class: 'stack' }, hl, h('div', { class: 'muted small' }, `${tr.provider} · ${tr.language} · USD ${G.fmt.num(tr.cost_usd, 4)}`)) : h('div', { class: 'stack' }, G.ui.empty('Sin transcripción.'), btn('Transcribir', guarded(() => { const r0 = T.transcribe(sel0.id); toast(`Transcrita: ${r0.alerts.length} alerta(s)`, r0.alerts.length ? 'warn' : 'ok'); G.refresh(); }), { sm: true })))),
      h('div', { class: 'stack' },
        card('Llamada', dl([['Cliente o lead', who(c)], ['Vendedora', G.userName(c.user_id)], ['Marca', G.brandName(c.brand_id)], ['Inicio', G.fmt.datetime(c.started_at)], ['Duración', secs(c.duration_seconds)], ['Pedido', (G.db.get('sales_orders', c.order_id) || {}).number || '—']])),
        card('Alertas encontradas', alerts.length ? h('div', { class: 'stack' }, alerts.map(a => h('div', { class: 'notice ' + (a.severity === 'HIGH' ? 'bad' : 'warn') }, h('div', null, h('b', null, a.label || a.rule_type), ' · «', a.matched_text, '» ', st(a.status))))) : G.ui.empty('Sin alertas.')),
        card('Accesos a esta grabación', (() => { const lg = G.db.where('tel_recording_access_log', l => l.recording_id === sel0.id).sort(U.by('accessed_at', -1)); return lg.length ? h('div', { class: 'stack' }, lg.map(l => h('div', { class: 'small' }, G.fmt.datetime(l.accessed_at), ' · ', G.userShort(l.user_id), ' · ', stName(l.action), l.reason ? ' · ' + l.reason : ''))) : G.ui.empty('Nadie la escuchó todavía.'); })()))));
  }

  function s11(el) {
    const body = G.ui.page(el, { code: 'TEL-11', title: 'Panel de supervisión', sub: 'En vivo: llamadas en curso, en espera y perdidas. Del día: atendidas, tiempos y alertas por vendedora; costo de telefonía del mes por pedido en soles.' });
    previewNote() && body.appendChild(previewNote());
    if (!G.can('tel.call.view_all')) { body.appendChild(notice('El panel exige el permiso tel.call.view_all (supervisora o gerencia).', 'warn')); return; }
    const calls = G.scope.filter(G.db.all('tel_calls'), { brand: 'brand_id', site: '_none' });
    const live = calls.filter(c => ['RINGING', 'IN_PROGRESS'].includes(c.status));
    const day = calls.filter(c => String(c.started_at).slice(0, 10) === G.TODAY && !['RINGING', 'IN_PROGRESS'].includes(c.status));
    const inb = day.filter(c => c.direction === 'INBOUND');
    const ok = inb.filter(c => c.status === 'COMPLETED');
    const al = T.alerts().filter(a => { const c = G.db.get('tel_calls', a.call_id); return c && String(c.started_at).slice(0, 7) === G.TODAY.slice(0, 7); });
    body.appendChild(kpis([{ label: 'En curso', value: G.fmt.num(live.filter(c => c.status === 'IN_PROGRESS').length), tone: 'info' }, { label: 'Sonando / en espera', value: G.fmt.num(live.filter(c => c.status === 'RINGING').length), tone: live.some(c => c.status === 'RINGING') ? 'warn' : '' }, { label: 'Atendidas hoy', value: G.fmt.pct(inb.length ? ok.length / inb.length * 100 : null), sub: `${ok.length} de ${inb.length} entrantes` }, { label: 'Perdidas hoy', value: G.fmt.num(inb.filter(c => MISSED.includes(c.status)).length), tone: 'bad' }, { label: 'Espera promedio', value: secs(ok.length ? Math.round(U.sum(ok, c => c.wait_seconds) / ok.length) : null) }, { label: 'Alertas del mes', value: G.fmt.num(al.length), tone: al.length ? 'bad' : 'ok', onClick: () => G.go('TEL-10') }]));
    body.appendChild(card('En vivo', live.length ? table({ id: 'tel-11l', search: false, columns: [{ key: 'started_at', label: 'Desde', render: c => G.fmt.datetime(c.started_at) }, { key: 'from_e164', label: 'Número', mono: true }, { key: 'w', label: 'Cliente', value: who }, { key: 'b', label: 'Marca', value: c => G.brandName(c.brand_id) }, { key: 'u', label: 'Vendedora', value: c => c.user_id ? G.userShort(c.user_id) : 'Sonando en el grupo' }, { key: 'status', label: 'Estado', render: c => st(c.status) }], rows: live }) : G.ui.empty('Sin llamadas en este momento.'), { flush: true }));
    const sellers = G.db.where('users', u => ['VENDEDORA', 'SUPERVISORA_VENTAS'].includes(u.role));
    const rows = sellers.map(u => { const mine = day.filter(c => c.user_id === u.id); const a = mine.filter(c => c.status === 'COMPLETED'); const ib = mine.filter(c => c.direction === 'INBOUND'); return { u, n: mine.length, ans: a.length, miss: ib.filter(c => MISSED.includes(c.status)).length, wait: a.length ? Math.round(U.sum(a.filter(c => c.direction === 'INBOUND'), c => c.wait_seconds) / Math.max(1, a.filter(c => c.direction === 'INBOUND').length)) : null, dur: a.length ? Math.round(U.sum(a, c => c.duration_seconds) / a.length) : null, ord: a.filter(c => c.order_id).length, alerts: al.filter(x => x.user_id === u.id).length }; });
    body.appendChild(card('Del día por vendedora', table({ id: 'tel-11v', search: false, columns: [{ key: 'u', label: 'Vendedora', value: x => x.u.name }, { key: 'n', label: 'Llamadas', align: 'r' }, { key: 'ans', label: 'Atendidas', align: 'r' }, { key: 'miss', label: 'Perdidas', align: 'r' }, { key: 'wait', label: 'Espera prom.', align: 'r', render: x => secs(x.wait) }, { key: 'dur', label: 'Duración prom.', align: 'r', render: x => secs(x.dur) }, { key: 'ord', label: 'Con pedido', align: 'r' }, { key: 'alerts', label: 'Alertas (mes)', align: 'r', render: x => x.alerts ? badge(x.alerts, 'bad') : '0' }], rows }), { flush: true }));
    const month = calls.filter(c => String(c.started_at).slice(0, 7) === G.TODAY.slice(0, 7));
    const cs = T.costSummary(month);
    const r = T.rates();
    const simOut = h('div', { class: 'stack' });
    const sim = v => { const m = Number(v.minutes) || 0; const voice = R(m * r.out_mobile, 2), rec = R(m * r.recording, 2), tr = v.transcribe ? R(m * r.transcription, 2) : 0; const tot = R(voice + rec + tr, 2); G.ui.clear(simOut).appendChild(dl([['Voz saliente a celular', `USD ${G.fmt.num(voice, 2)} (${m} × ${r.out_mobile})`], ['Grabación', `USD ${G.fmt.num(rec, 2)} (${m} × ${r.recording})`], ['Transcripción', `USD ${G.fmt.num(tr, 2)} (${m} × ${r.transcription})`], ['Total del mes', h('b', null, `USD ${G.fmt.num(tot, 2)} ≈ ${G.fmt.money(tot * cs.fx)}`)], ['Por pedido', v.orders ? G.fmt.money(tot * cs.fx / v.orders) : '—']])); };
    const f = form({ id: 'tel-sim', values: { minutes: 900, transcribe: true, orders: 300 }, fields: [{ key: 'minutes', label: 'Minutos salientes a celular', type: 'number', min: 0, onChange: (v, vals) => sim(vals) }, { key: 'orders', label: 'Pedidos con llamada', type: 'number', min: 0, onChange: (v, vals) => sim(vals) }, { key: 'transcribe', label: 'Con transcripción', type: 'checkbox', onChange: (v, vals) => sim(vals) }], submitLabel: false });
    sim(f.api.values);
    body.appendChild(h('div', { class: 'grid c2' },
      card('Costo de telefonía del mes', dl([['Minutos', G.fmt.num(cs.minutes)], ['Voz', 'USD ' + G.fmt.num(cs.voice_usd, 2)], ['Grabación', 'USD ' + G.fmt.num(cs.recording_usd, 2)], ['Transcripción', 'USD ' + G.fmt.num(cs.transcription_usd, 2)], ['Total', h('b', null, 'USD ' + G.fmt.num(cs.total_usd, 2) + ' ≈ ' + G.fmt.money(cs.total_pen))], ['Pedidos con llamada', G.fmt.num(cs.orders)], ['Costo por pedido (KPI-TEL-07)', h('b', null, G.fmt.money(cs.per_order_pen))]])),
      card('Simulador de costo (tarifas Twilio)', h('div', { class: 'stack' }, f, simOut))));
  }

  function s12(el) {
    const body = G.ui.page(el, { code: 'TEL-12', title: 'Escuchas y retención', sub: `Bitácora de escuchas y descargas, grabaciones por vencer, retención legal y corridas de purga (${(T.settings() || {}).retention_days || 180} días desde la llamada, RN-TEL-10).`, actions: [{ label: 'Correr purga de hoy', kind: 'primary', onClick: guarded(() => { const r = T.purge(G.TODAY); toast(`${r.purged.length} grabación(es) purgada(s)`, 'ok'); G.refresh(); }) }] });
    previewNote() && body.appendChild(previewNote());
    body.appendChild(notice('Ley 29733 de Protección de Datos Personales: las grabaciones son datos personales; se avisa al inicio de la llamada, se conservan solo el plazo definido, cada escucha y descarga queda registrada (solo inserción) y al vencer se elimina el audio conservando los datos de la llamada.', 'info'));
    const recs = G.db.all('tel_recordings');
    const soon = recs.filter(r => r.status === 'AVAILABLE' && !r.legal_hold && G.date.diff(r.retention_until, G.TODAY) <= 30).sort(U.by('retention_until'));
    const holds = recs.filter(r => r.legal_hold);
    const logs = G.db.all('tel_recording_access_log').sort(U.by('accessed_at', -1));
    const runs = G.db.where('audit_purge_runs', r => r.category === 'RECORDINGS');
    body.appendChild(kpis([{ label: 'Grabaciones disponibles', value: G.fmt.num(recs.filter(r => r.status === 'AVAILABLE').length) }, { label: 'Vencen en 30 días', value: G.fmt.num(soon.length), tone: soon.length ? 'warn' : 'ok' }, { label: 'Con retención legal', value: G.fmt.num(holds.length) }, { label: 'Purgadas', value: G.fmt.num(recs.filter(r => r.status === 'PURGED').length) }, { label: 'Escuchas y descargas', value: G.fmt.num(logs.length) }]));
    const callOf = r => G.db.get('tel_calls', r.call_id) || {};
    const recCols = [{ key: 'c', label: 'Llamada', value: r => callLabel(callOf(r)) }, { key: 'u', label: 'Vendedora', value: r => G.userShort(callOf(r).user_id) }, { key: 'retention_until', label: 'Retención hasta', render: r => G.fmt.date(r.retention_until) }, { key: 'status', label: 'Estado', render: r => st(r.status) }, { key: 'legal_hold', label: 'Retención legal', value: r => r.legal_hold ? 'Sí' : 'No', render: r => r.legal_hold ? badge('Sí', 'info') : 'No' }, { key: 'legal_hold_reason', label: 'Motivo', value: r => r.legal_hold_reason || '' }];
    const holdAct = r => r.status === 'AVAILABLE' && G.can('tel.recording.listen_all') ? [btn(r.legal_hold ? 'Quitar retención' : 'Retención legal', () => modal('Retención legal', b => b.appendChild(form({ id: 'tel-hold', fields: [{ key: 'reason', label: 'Motivo', type: 'textarea', required: true }], submitLabel: 'Guardar', onSubmit: v => { T.setLegalHold(r.id, !r.legal_hold, v.reason); G.ui.closeAll(); toast('Retención actualizada', 'ok'); G.refresh(); return true; } }))), { sm: true })] : [];
    body.appendChild(tabs([
      { key: 'log', label: 'Bitácora', count: logs.length, render: p => p.appendChild(table({ id: 'tel-12l', columns: [{ key: 'accessed_at', label: 'Fecha', render: l => G.fmt.datetime(l.accessed_at) }, { key: 'u', label: 'Usuaria', value: l => G.userName(l.user_id) }, { key: 'action', label: 'Acción', value: l => stName(l.action), render: l => st(l.action) }, { key: 'c', label: 'Llamada', value: l => callLabel(callOf(G.db.get('tel_recordings', l.recording_id) || {})) }, { key: 'reason', label: 'Motivo', value: l => l.reason || '' }], rows: logs, filters: [{ key: 'action', label: 'Acción', options: [['PLAY', 'Escucha'], ['DOWNLOAD', 'Descarga']] }] })) },
      { key: 'soon', label: 'Por vencer', count: soon.length, render: p => p.appendChild(table({ id: 'tel-12s', columns: recCols, rows: soon, actions: holdAct, onRow: r => G.go('TEL-10', { rec: r.id }) })) },
      { key: 'hold', label: 'Retención legal', count: holds.length, render: p => p.appendChild(table({ id: 'tel-12h', columns: recCols, rows: holds, actions: holdAct })) },
      { key: 'runs', label: 'Corridas de purga', count: runs.length, render: p => p.appendChild(table({ id: 'tel-12r', columns: [{ key: 'run_at', label: 'Fecha', render: r => G.fmt.datetime(r.run_at) }, { key: 'cutoff_date', label: 'Corte', render: r => G.fmt.date(r.cutoff_date) }, { key: 'rows_purged', label: 'Purgadas', align: 'r' }, { key: 'result', label: 'Resultado' }, { key: 'run_by', label: 'Ejecutó' }], rows: runs, empty: 'Sin corridas: la purga corre cada noche cuando el módulo está encendido.' })) },
      { key: 'purged', label: 'Purgadas', count: recs.filter(r => r.status === 'PURGED').length, render: p => p.appendChild(table({ id: 'tel-12p', columns: recCols.concat([{ key: 'purged_at', label: 'Purgada', render: r => G.fmt.datetime(r.purged_at) }]), rows: recs.filter(r => r.status === 'PURGED') })) },
    ]));
  }

  G.register({ code: 'TEL', name: 'Telefonía (incluida y apagada)', phase: 1, group: 'Atención y marketing', screens: [
    { code: 'TEL-01', name: 'Lista de activación', render: s01 },
    { code: 'TEL-02', name: 'Ajustes', render: s02 },
    { code: 'TEL-03', name: 'Números y desvíos', render: s03 },
    { code: 'TEL-04', name: 'Menú de voz y horario', render: s04 },
    { code: 'TEL-05', name: 'Grupos de llamada', render: s05 },
    { code: 'TEL-06', name: 'Teléfono en la app', render: s06 },
    { code: 'TEL-07', name: 'Llamar desde la ficha o el pedido', render: s07 },
    { code: 'TEL-08', name: 'Historial de llamadas', render: s08 },
    { code: 'TEL-09', name: 'Llamadas perdidas', render: s09 },
    { code: 'TEL-10', name: 'Grabación y transcripción', render: s10 },
    { code: 'TEL-11', name: 'Panel de supervisión', render: s11 },
    { code: 'TEL-12', name: 'Escuchas y retención', render: s12 },
  ] });

  G.alertProviders.push(() => {
    if (!G.modOn('TEL') || !G.canSee('TEL')) return [];
    const late = T.tasks().filter(t => t.status === 'OPEN' && t.due_at < G.date.now());
    return late.length ? [{ module: 'TEL', title: `${late.length} llamada(s) perdida(s) sin devolver a tiempo`, detail: 'RN-TEL-07', tone: 'warn', go: () => G.go('TEL-09') }] : [];
  });

  /* ------------------------------------------------------------------
     Pruebas CA-TEL-01 a 07
     ------------------------------------------------------------------ */
  const expectRule = (fn, code, msg) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e; throw new Error(`${msg}: se esperaba ${code} y salió «${e.message}»`); } throw new Error(`${msg}: se esperaba ${code} y no falló`); };
  /** enciende TEL y lo deja en producción (los 6 pasos) para probar el flujo; el finally lo apaga */
  function liveForTest() {
    G.setModule('TEL', true, 'prueba');
    for (const [no] of STEPS) T.markStep(no, { done: true, notes: 'Prueba automática' });
    T.goLive();
  }
  const ses = (user_id, role) => { const u = G.db.get('users', user_id); G.ctx.role = role; G.ctx.session = { user_id, role, tenant: 'DG', name: u.name }; };
  G.tests.push({ module: 'TEL', name: 'CA-TEL-01: con TEL apagado la vendedora no ve «Llamar»; GET /api/v1/tel/calls → 403 RN-PLT-07; grabar ajustes en la BD falla con RN-PLT-07', fn: async () => {
    const role = G.ctx.role, sess = G.ctx.session;
    try {
      if (G.modOn('TEL')) throw new Error('TEL debía estar apagado por defecto');
      ses('us-atorres', 'VENDEDORA');
      if (T.callButton({ customer_id: 'cu-0001' }) !== null) throw new Error('Con TEL apagado no debía aparecer «Llamar»');
      const r = T.api('GET', '/api/v1/tel/calls'); if (r.status !== 403 || r.code !== 'RN-PLT-07') throw new Error('La API debía responder 403 RN-PLT-07 y respondió ' + r.status);
      const w = T.api('PUT', '/api/v1/tel/settings', { retention_days: 90 }); if (w.status !== 403 || w.code !== 'RN-PLT-07') throw new Error('Grabar ajustes por la API debía dar 403');
      expectRule(() => T.dbWrite('tel_settings', { singleton: true, retention_days: 90 }), 'RN-PLT-07', 'Escritura directa en tel_settings');
      expectRule(() => T.click2call({ customer_id: 'cu-0001' }), 'RN-PLT-07', 'Llamar');
      const rec = G.db.all('tel_recordings')[0]; expectRule(() => T.listen(rec.id), 'RN-PLT-07', 'Escuchar');
      G.setModule('TEL', true, 'prueba');
      if (!T.callButton({ customer_id: 'cu-0001' })) throw new Error('Encendido, la vendedora debía ver «Llamar»');
      if (T.api('GET', '/api/v1/tel/calls').status !== 200) throw new Error('Encendido, la API debía responder 200');
    } finally { G.ctx.role = role; G.ctx.session = sess; G.setModule('TEL', false, 'prueba'); }
  } });
  G.tests.push({ module: 'TEL', name: 'CA-TEL-02: al encender queda en SETUP con 6 pasos; con 5 hechos pasar a LIVE se rechaza con RN-TEL-02; con 6 pasa', fn: async () => {
    const role = G.ctx.role;
    try {
      G.ctx.role = 'ADMIN_SISTEMA';
      G.setModule('TEL', true, 'prueba');
      if (T.settings().stage !== 'SETUP') throw new Error('Debía quedar en SETUP'); if (G.db.all('tel_activation_steps').length !== 6) throw new Error('Debía haber 6 pasos');
      for (const no of [1, 2, 3, 4, 5]) T.markStep(no, { done: true, notes: 'Hecho en prueba' });
      expectRule(() => T.goLive(), 'RN-TEL-02', 'Con 5 pasos');
      T.markStep(6, { done: true, notes: 'Encendido y llamada de prueba' });
      T.goLive(); if (T.settings().stage !== 'LIVE') throw new Error('Con 6 pasos debía pasar a LIVE');
    } finally { G.ctx.role = role; G.setModule('TEL', false, 'prueba'); }
  } });
  G.tests.push({ module: 'TEL', name: 'CA-TEL-03: llamada perdida a las 10:00 → tarea con vencimiento 10:30; vuelve a llamar a las 12:00 y la atienden → la tarea se cierra', fn: async () => {
    try {
      liveForTest();
      const c = G.db.get('customers', 'cu-0007');
      const miss = T.registerInbound({ from_e164: c.phone, option: 1, at: '2026-10-10T10:00:00', status: 'MISSED' });
      const t = G.db.find('crm_tasks', x => x.call_id === miss.id);
      if (!t || t.status !== 'OPEN' || String(t.due_at).slice(0, 16) !== '2026-10-10T10:30') throw new Error('La tarea debía vencer 10:30 y vence ' + (t && t.due_at));
      T.registerInbound({ from_e164: c.phone, option: 1, at: '2026-10-10T12:00:00', status: 'COMPLETED', duration_seconds: 90 });
      if (G.db.get('crm_tasks', t.id).status !== 'DONE') throw new Error('La tarea debía cerrarse sola');
    } finally { G.setModule('TEL', false, 'prueba'); }
  } });
  G.tests.push({ module: 'TEL', name: 'CA-TEL-04: grabación del 01/10/2026 se conserva hasta el 30/03/2027; tras la purga del 01/04/2027 no se escucha', fn: async () => {
    try {
      liveForTest();
      const call = T.registerInbound({ from_e164: G.db.get('customers', 'cu-0011').phone, option: 1, at: '2026-10-01T11:00:00', status: 'COMPLETED', duration_seconds: 200 });
      const rec = G.db.find('tel_recordings', r => r.call_id === call.id);
      if (!rec || rec.retention_until !== '2027-03-30') throw new Error('Retención esperada 2027-03-30 y es ' + (rec && rec.retention_until));
      T.purge('2027-03-30'); if (G.db.get('tel_recordings', rec.id).status !== 'AVAILABLE') throw new Error('El 30/03/2027 aún se conserva');
      T.purge('2027-04-01'); if (G.db.get('tel_recordings', rec.id).status !== 'PURGED') throw new Error('Debía quedar purgada');
      expectRule(() => T.listen(rec.id), 'RN-TEL-10', 'Escuchar una purgada');
      if (!G.db.get('tel_calls', call.id)) throw new Error('Los datos de la llamada se conservan');
    } finally { G.setModule('TEL', false, 'prueba'); }
  } });
  G.tests.push({ module: 'TEL', name: 'CA-TEL-05: vendedora sin listen_all no escucha la llamada de otra (403); la supervisora sí y queda en la bitácora', fn: async () => {
    const role = G.ctx.role, sess = G.ctx.session;
    try {
      liveForTest();
      const call = T.registerInbound({ from_e164: G.db.get('customers', 'cu-0021').phone, option: 1, at: '2026-10-10T09:30:00', status: 'COMPLETED', user_id: 'us-atorres', duration_seconds: 120 });
      const rec = G.db.find('tel_recordings', r => r.call_id === call.id);
      ses('us-bramos', 'VENDEDORA');
      const e = expectRule(() => T.listen(rec.id), 'RN-TEL-11', 'Betty escuchando a Ana'); if (!/403/.test(e.message)) throw new Error('El rechazo debía ser 403');
      ses('us-atorres', 'VENDEDORA'); T.listen(rec.id); // la dueña escucha la suya
      const sup = G.db.find('users', u => u.role === 'SUPERVISORA_VENTAS'); ses(sup.id, 'SUPERVISORA_VENTAS');
      const log = T.listen(rec.id, { reason: 'Revisión de calidad' });
      const row = G.db.get('tel_recording_access_log', log.id);
      if (!row || row.user_id !== sup.id || !row.accessed_at || row.action !== 'PLAY') throw new Error('La escucha debía quedar en la bitácora con fecha y usuaria');
    } finally { G.ctx.role = role; G.ctx.session = sess; G.setModule('TEL', false, 'prueba'); }
  } });
  G.tests.push({ module: 'TEL', name: 'CA-TEL-06: transcripción «yapéame a mi número 912 345 678» → 2 alertas para la supervisora (frase y número ajeno)', fn: async () => {
    try {
      liveForTest();
      T.saveSettings({ transcription_enabled: false });
      const call = T.registerInbound({ from_e164: G.db.get('customers', 'cu-0031').phone, option: 1, at: '2026-10-10T10:10:00', status: 'COMPLETED', user_id: 'us-atorres', duration_seconds: 60 });
      const rec = G.db.find('tel_recordings', r => r.call_id === call.id);
      expectRule(() => T.transcribe(rec.id, 'hola'), 'RN-TEL-09', 'Transcribir con la opción apagada');
      T.saveSettings({ transcription_enabled: true });
      const n0 = G.db.where('notifications', n => n.module === 'TEL').length;
      const r = T.transcribe(rec.id, 'yapéame a mi número 912 345 678');
      const types = r.alerts.map(a => a.rule_type).sort().join(',');
      if (r.alerts.length !== 2 || types !== 'FOREIGN_PHONE,KEYWORD') throw new Error('Se esperaban 2 alertas (frase y número ajeno) y hay ' + r.alerts.length + ' (' + types + ')');
      if (G.db.where('control_alerts', a => a.call_id === call.id && a.source_type === 'CALL_TRANSCRIPT').length !== 2) throw new Error('Las alertas debían quedar en control_alerts');
      if (G.db.where('notifications', n => n.module === 'TEL').length - n0 < 2) throw new Error('La supervisora debía recibir las alertas');
    } finally { G.setModule('TEL', false, 'prueba'); }
  } });
  G.tests.push({ module: 'TEL', name: 'CA-TEL-07: 900 minutos salientes a celular con grabación y transcripción → ≈ USD 114 (67 + 2 + 45) y costo por pedido en soles', fn: async () => {
    try {
      liveForTest(); T.saveSettings({ transcription_enabled: true });
      const orders = G.db.where('sales_orders', o => o.delivery_date === G.TODAY && o.customer_id && o.customer_id.startsWith('cu-0') && !['CANCELLED'].includes(o.status)).slice(0, 15);
      const calls = [];
      for (let i = 0; i < 30; i++) calls.push(T.click2call({ order_id: orders[i % 15].id, duration_seconds: 1800, at: '2026-10-0' + (1 + (i % 9)) + 'T10:00:00' }));
      const s = T.costSummary(calls);
      if (s.minutes !== 900) throw new Error('Minutos esperados 900 y son ' + s.minutes);
      if (Math.abs(s.voice_usd - 66.6) > 0.01 || Math.abs(s.recording_usd - 2.25) > 0.01 || Math.abs(s.transcription_usd - 45) > 0.01) throw new Error(`Desglose ${s.voice_usd} + ${s.recording_usd} + ${s.transcription_usd}`);
      if (Math.abs(s.total_usd - 114) > 0.5) throw new Error('Total esperado ≈ USD 114 y es ' + s.total_usd);
      if (s.orders !== 15 || !(s.per_order_pen > 0) || Math.abs(s.per_order_pen - R(s.total_usd * s.fx / 15)) > 0.01) throw new Error('Costo por pedido en soles mal calculado');
    } finally { G.setModule('TEL', false, 'prueba'); }
  } });
})();
