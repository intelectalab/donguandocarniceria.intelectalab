/* =====================================================================
   CRM · Bandeja omnicanal, leads y control de vendedoras (Fase 1)
   6 números de WhatsApp por Cloud API con coexistencia (sin conectores QR),
   TikTok, Messenger e Instagram; asignación por turno; ventanas de 24/48/72 h;
   costo por mensaje; plantillas; leads y pedido desde el chat; alertas de
   control de vendedoras; recompra, encuestas y consentimientos (Ley 29733).
   ===================================================================== */
(function () {
  const { h, btn, badge, card, table, kpis, dl, notice, drawer, modal, form, toast, tabs, pills } = G.ui;
  const U = G.util, R = (n, d = 2) => U.round(n, d);
  const C = G.crm = G.crm || {};
  const ins = (t, r) => G.db.insert(t, r, { silent: true });
  const upd = (t, id, p) => G.db.update(t, id, p, { silent: true });

  /* ---------- estilos propios (tokens del núcleo) ---------- */
  if (typeof document !== 'undefined' && !document.getElementById('crm-style')) {
    const st = document.createElement('style'); st.id = 'crm-style';
    st.textContent = `
.crm-inbox{display:grid;grid-template-columns:minmax(260px,370px) minmax(0,1fr);gap:16px;align-items:start}
.crm-list{display:flex;flex-direction:column;max-height:70vh;overflow-y:auto}
.crm-item{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer;background:var(--surface)}
.crm-item:hover{background:var(--surface-2)}.crm-item.sel{background:var(--primary-soft)}
.crm-av{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:13px;background:var(--surface-2);color:var(--ink);border:2px solid var(--line)}
.crm-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.crm-snip{color:var(--muted);font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.crm-side{display:grid;gap:4px;justify-items:end;align-content:start;font-size:.75rem;color:var(--muted);max-width:110px;text-align:right}
.crm-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.crm-compose{display:grid;gap:8px;margin-top:10px}
.crm-compose textarea{min-height:64px;width:100%}
.crm-tag{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 7px;border-radius:999px;font-size:.72rem;font-weight:600;border:1px solid var(--line);color:var(--muted)}
.chat .msg .tpl{display:block;font-size:11px;color:var(--muted);margin-bottom:3px;font-weight:600}
.chat .msg .tr{display:block;font-style:italic;color:var(--muted);margin-top:4px}
.chat .msg.note{align-self:center;background:var(--accent-soft);border:1px dashed var(--accent);max-width:90%}
.chat .msg .flag{display:block;font-size:11px;color:var(--bad);font-weight:600;margin-top:4px}
.crm-funnel{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.stack>div:has(>.tabs){min-width:0}
@media(max-width:900px){.crm-inbox{grid-template-columns:minmax(0,1fr)}.crm-inbox .crm-pane{display:none}}`;
    document.head.appendChild(st);
  }

  /* ---------- tiempo (reloj de la demo: sábado 10/10/2026, desde las 16:30) ---------- */
  const SEED_NOW = G.TODAY + 'T16:30:00';
  C.now = () => { if (G._seeding) return SEED_NOW; const t = new Date().toTimeString().slice(0, 8); return G.TODAY + 'T' + (t < '16:30:00' ? '16:30:00' : t); };
  const T = s => { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : 0; };
  const ISO = ms => new Date(ms).toISOString().slice(0, 19);
  const addH = (s, n) => ISO(T(s) + n * 3600000);
  const addM = (s, n) => ISO(T(s) + n * 60000);
  const mins = (a, b) => (T(a) - T(b)) / 60000;
  const wd = s => { const d = new Date(T(s)).getUTCDay(); return d === 0 ? 7 : d; };
  const hm = s => String(s).slice(11, 16);
  const dur = m => { if (m == null || !isFinite(m)) return '—'; m = Math.max(0, Math.round(m)); if (m < 60) return m + ' min'; const hh = Math.floor(m / 60); if (hh < 48) return hh + ' h ' + String(m % 60).padStart(2, '0') + ' min'; return Math.floor(hh / 24) + ' d ' + (hh % 24) + ' h'; };
  C.T = T; C.addH = addH; C.addM = addM; C.dur = dur;
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const digits = s => String(s || '').replace(/\D/g, '');
  const last9 = s => digits(s).slice(-9);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const median = arr => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  C.median = median;

  /** horario de atención (RN-CRM-14): «lun-sáb 08:00-20:00, dom 09:00-14:00» */
  C.bizHours = () => {
    const s = String(G.param('crm_business_hours') || 'lun-sáb 08:00-20:00, dom 09:00-14:00'); const out = {};
    const days = { lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6, dom: 7 };
    for (const part of s.split(',')) { const m = norm(part.trim()).match(/^([a-z]+)(?:-([a-z]+))?\s+(\d{2}:\d{2})-(\d{2}:\d{2})$/); if (!m) continue; const a = days[m[1]], b = m[2] ? days[m[2]] : a; for (let d = a; d <= b; d++) out[d] = [m[3], m[4]]; }
    return out;
  };
  /** minutos dentro del horario de atención entre dos instantes (el reloj se detiene fuera de horario) */
  C.bizMinutes = (from, to) => {
    if (!from || !to || T(to) <= T(from)) return 0;
    const bh = C.bizHours(); let total = 0, day = from.slice(0, 10), g = 0; const end = to.slice(0, 10);
    while (day <= end && g++ < 400) { const w = bh[wd(day)]; if (w) { const s = Math.max(T(day + 'T' + w[0]), T(from)), e = Math.min(T(day + 'T' + w[1]), T(to)); if (e > s) total += (e - s) / 60000; } day = G.date.add(day, 1); }
    return total;
  };

  /* ---------- catálogos de etiquetas ---------- */
  const KIND = { WHATSAPP: ['WhatsApp', 'WA'], TIKTOK: ['TikTok', 'TT'], MESSENGER: ['Messenger', 'FB'], INSTAGRAM: ['Instagram', 'IG'] };
  const ORDER_CH = { WHATSAPP: 'WHATSAPP', TIKTOK: 'TIKTOK', MESSENGER: 'FACEBOOK', INSTAGRAM: 'INSTAGRAM' };
  const kindName = k => (KIND[k] || [k])[0];
  const kindTag = k => (KIND[k] || [k, k])[1];
  const CONN = { CLOUD_API_COEXISTENCE: 'Cloud API con coexistencia', CLOUD_API: 'Cloud API (solo API)', APP_ONLY: 'Solo app (sin integración)', DM_API: 'API de mensajes directos', NOT_AVAILABLE: 'No disponible' };
  const ASSIGN = [['SHIFT_ROUND_ROBIN', 'Turno rotativo'], ['LEAST_OPEN', 'Menos chats abiertos'], ['MANUAL', 'Manual']];
  const CSTATUS = { OPEN: ['Abierta', 'info'], PENDING: ['Esperando cliente', 'warn'], SNOOZED: ['En espera', ''], CLOSED: ['Cerrada', ''] };
  const ENTRY = { ORGANIC: 'Orgánico', CTWA_AD: 'Anuncio clic a WhatsApp', TRACKING_CODE: 'Código de anuncio', UTM: 'UTM', TEMPLATE_REPLY: 'Respuesta a plantilla', TIKTOK_DM: 'Mensaje de TikTok', PHONE: 'Llamada' };
  const CLOSE = [['ORDER_CREATED', 'Pedido creado'], ['NO_PURCHASE', 'Sin compra'], ['INFO_ONLY', 'Solo información'], ['SPAM', 'Spam'], ['TRANSFERRED', 'Derivado'], ['INACTIVE', 'Sin actividad']];
  const LOST = [['PRICE', 'Precio'], ['NO_STOCK', 'Sin stock'], ['OUT_OF_ZONE', 'Fuera de zona'], ['NO_RESPONSE', 'No respondió'], ['DELIVERY_TIME', 'Plazo de entrega'], ['PRODUCT_NOT_OFFERED', 'Producto que no vendemos'], ['DUPLICATE', 'Duplicado'], ['SPAM', 'Spam'], ['OTHER', 'Otro']];
  const LSTATUS = [['NEW', 'Nuevo'], ['CONTACTED', 'Contactado'], ['QUALIFIED', 'Calificado'], ['WON', 'Ganado'], ['LOST', 'Perdido'], ['DISCARDED', 'Descartado']];
  const ASTATUS = { OPEN: ['Abierta', 'bad'], UNDER_REVIEW: ['En revisión', 'warn'], DISMISSED: ['Descartada', ''], CONFIRMED: ['Confirmada', 'bad'] };
  const SEV = { HIGH: ['Alta', 'bad'], MEDIUM: ['Media', 'warn'], LOW: ['Baja', 'info'] };
  const RTYPE = { KEYWORD: 'Frase', FOREIGN_PHONE: 'Celular ajeno', FOREIGN_ACCOUNT: 'Cuenta ajena', OFF_CATALOG_TERM: 'Producto fuera del catálogo', APP_DELETION: 'Borrado en el celular (coexistencia)', UNANSWERED_CHAT: 'Chat sin responder', SURVEY_FLAG: 'Encuesta: compra fuera de la web' };
  const PURPOSE = { ORDER_CONFIRMATION: 'Confirmación de pedido', ORDER_DISPATCHED: 'Pedido en camino', WEIGHT_DIFFERENCE: 'Diferencia de peso', PAYMENT_REQUEST: 'Recordatorio de pago', POST_DELIVERY_SURVEY: 'Encuesta posentrega', REBUY: 'Recompra', RECORDING_NOTICE: 'Aviso de registro', REENGAGE: 'Reactivación', PROMOTION: 'Promoción', OTHER: 'Otro' };
  const CAT = { UTILITY: 'Utilidad', MARKETING: 'Marketing', AUTHENTICATION: 'Autenticación', SERVICE: 'Servicio' };
  const TPLST = { DRAFT: ['Borrador', ''], PENDING: ['En revisión de Meta', 'warn'], APPROVED: ['Aprobada', 'ok'], REJECTED: ['Rechazada', 'bad'], PAUSED: ['Pausada', 'warn'], DISABLED: ['Desactivada', ''] };
  const TASK = { CALLBACK: 'Devolver llamada', REBUY: 'Recompra', FOLLOW_UP: 'Seguimiento', SURVEY_FOLLOW_UP: 'Seguimiento de encuesta', ALERT_REVIEW: 'Revisar alerta', UNANSWERED_CHAT: 'Chat sin responder' };
  const REBUY = { NEW: ['Nuevo', ''], ACTIVE: ['Al día', 'ok'], DUE: ['Por avisar', 'info'], AT_RISK: ['En riesgo', 'warn'], LOST: ['Perdido', 'bad'] };
  const CHARGE_R = { CHARGED: 'Cobrado', FREE_SERVICE_QUOTA: 'Gratis (cuota de 1000)', FREE_CTWA_WINDOW: 'Gratis (ventana de anuncio 72 h)', FREE_UTILITY_IN_WINDOW: 'Gratis (utilidad en ventana)', BUSINESS_APP: 'Desde la app del celular', NOT_WHATSAPP: 'No es WhatsApp' };
  const optsOf = obj => Object.entries(obj).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]);
  const lbl = (arr, k) => (arr.find(x => x[0] === k) || [k, k || '—'])[1];
  C.LABELS = { KIND, ENTRY, CLOSE, LOST, LSTATUS, ASTATUS, SEV, RTYPE, PURPOSE, CAT, TASK, REBUY, CHARGE_R };

  /* ---------- accesos rápidos ---------- */
  const chan = id => G.db.get('messaging_channels', id);
  const conv = id => G.db.get('conversations', id);
  const userRow = id => G.db.get('users', id);
  const roleOf = id => (userRow(id) || {}).role || G.ctx.role;
  const me = () => G.ctx.userId();
  C.chan = chan; C.conv = conv;
  C.chLabel = ch => ch ? `${kindName(ch.kind)} · ${ch.display_name}` : '—';
  C.contactName = cv => {
    if (!cv) return '—';
    if (cv.customer_id) return G.custName(cv.customer_id);
    const l = cv.lead_id && G.db.get('leads', cv.lead_id); const ct = G.db.get('channel_contacts', cv.contact_id);
    return (l && l.full_name) || (ct && (ct.display_name || ct.phone || ct.external_user_id)) || 'Contacto';
  };
  const initials = s => String(s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
  C.yape = () => { const y = G.db.find('official_identifiers', x => x.identifier_type === 'YAPE' && x.status === 'ACTIVE'); return y ? y.value : '+51987650001'; };

  /* =====================================================================
     Miembros, turnos, estados y asignación (RN-CRM-02, RN-CRM-03)
     ===================================================================== */
  C.memberRows = chId => G.db.where('channel_members', m => m.channel_id === chId && m.active !== false && m.status !== 'INACTIVE');
  C.isMember = (chId, uid) => C.memberRows(chId).some(m => m.user_id === uid);
  C.channelsFor = (uid = me()) => {
    const u = userRow(uid); const all = G.db.all('messaging_channels');
    if (!u) return all;
    if (u.role === 'VENDEDORA') return all.filter(ch => C.isMember(ch.id, uid));
    if (u.role === 'SUPERVISORA_VENTAS') return all.filter(ch => !(u.brands || []).length || u.brands.includes(ch.brand_id));
    return all;
  };
  /** conversaciones visibles para el usuario y el selector de marca */
  C.visible = rows => { const ids = new Set(C.channelsFor().map(c => c.id)); return rows.filter(r => ids.has(r.channel_id) && G.scope.ok(r, { site: '_none' })); };
  C.agentStatus = uid => { const rows = G.db.where('crm_agent_status', s => s.user_id === uid); return rows.length ? rows[rows.length - 1].status : 'OFFLINE'; };
  C.setAgentStatus = (uid, status, at) => { ins('crm_agent_status', { user_id: uid, status, changed_at: at || C.now() }); return status; };
  C.shiftsOf = memberId => G.db.where('channel_member_shifts', s => s.member_id === memberId);
  C.inShift = (m, at) => {
    const sh = C.shiftsOf(m.id); const d = wd(at), t = hm(at);
    if (!sh.length) { const b = C.bizHours()[d]; return !!b && t >= b[0] && t < b[1]; }
    return sh.some(s => s.weekday === d && t >= s.time_from && t < s.time_to);
  };
  C.openCount = uid => G.db.where('conversations', c => c.assigned_user_id === uid && c.status !== 'CLOSED').length;
  C.lastAssignedAt = (uid, chId) => { let last = ''; for (const a of G.db.all('conversation_assignments')) if (a.to_user_id === uid && a.channel_id === chId && a.assigned_at > last) last = a.assigned_at; return last; };
  /** crm_pick_agent: en turno, en línea y bajo su tope; turno rotativo = la que recibió hace más tiempo */
  C.pickAgent = function (chId, at = C.now()) {
    const ch = chan(chId); const mode = ch.assignment_mode || 'SHIFT_ROUND_ROBIN';
    if (mode === 'MANUAL') return null;
    const cap = G.param('crm_max_open_conversations') || 25;
    const rows = C.memberRows(chId).filter(m => (m.member_role || 'AGENT') === 'AGENT' && C.inShift(m, at) && C.agentStatus(m.user_id) === 'ONLINE')
      .map(m => ({ m, open: C.openCount(m.user_id), last: C.lastAssignedAt(m.user_id, chId) }))
      .filter(x => x.open < (x.m.max_open_conversations || cap));
    if (!rows.length) return null;
    rows.sort(mode === 'LEAST_OPEN' ? ((a, b) => a.open - b.open || a.last.localeCompare(b.last)) : ((a, b) => a.last.localeCompare(b.last) || a.open - b.open));
    return rows[0].m.user_id;
  };
  C.assign = function (cvId, toUid, { reason = 'MANUAL_REASSIGN', by = null, note = null, at } = {}) {
    const cv = conv(cvId); const ch = chan(cv.channel_id);
    if (toUid && !C.isMember(cv.channel_id, toUid)) G.fail('RN-CRM-03', `${G.userName(toUid)} no es miembro del número ${ch.display_name}: no se le puede asignar este chat.`);
    if ((toUid || null) === (cv.assigned_user_id || null)) return cv;
    const when = at || C.now();
    ins('conversation_assignments', { conversation_id: cv.id, channel_id: cv.channel_id, from_user_id: cv.assigned_user_id || null, to_user_id: toUid || null, reason, assigned_by: by, assigned_at: when, note });
    upd('conversations', cv.id, { assigned_user_id: toUid || null, queued_at: toUid ? null : when });
    if (toUid) {
      G.events.emit('conversation.assigned', { conversation_id: cv.id, user_id: toUid, reason });
      if (!G._seeding) G.notify({ user_id: toUid, title: 'Chat asignado', body: `${C.contactName(cv)} · ${ch.display_name}`, ref: cv.id, module: 'CRM' });
    }
    return cv;
  };
  /** crm_auto_assign: si nadie cumple, el chat queda en cola */
  C.autoAssign = function (cv, at) {
    const uid = C.pickAgent(cv.channel_id, at || C.now());
    if (!uid) { if (!cv.queued_at) upd('conversations', cv.id, { queued_at: at || C.now() }); return null; }
    C.assign(cv.id, uid, { reason: chan(cv.channel_id).assignment_mode === 'LEAST_OPEN' ? 'AUTO_LEAST_OPEN' : 'AUTO_SHIFT', at });
    return uid;
  };
  C.reassign = function (cvId, toUid, { by = me(), note, at } = {}) {
    if (!G.can('crm.conversation.reassign', roleOf(by))) G.fail('RN-CRM-03', 'Solo la supervisora reasigna o toma chats (permiso crm.conversation.reassign).');
    return C.assign(cvId, toUid, { reason: toUid ? 'MANUAL_REASSIGN' : 'RETURN_TO_QUEUE', by, note, at });
  };
  /** RN-CRM-03: la vendedora responde solo sus chats; la supervisora, los de sus números */
  C.canReply = (cv, uid) => {
    const u = userRow(uid); if (!u || !cv) return false;
    if (u.role === 'GERENTE') return true;
    if (u.role === 'SUPERVISORA_VENTAS') return C.channelsFor(uid).some(c => c.id === cv.channel_id);
    if (u.role === 'VENDEDORA') return cv.assigned_user_id === uid && C.isMember(cv.channel_id, uid);
    return C.memberRows(cv.channel_id).some(m => m.user_id === uid && m.member_role === 'SUPERVISOR');
  };

  /* =====================================================================
     Ventanas, costo (RN-CRM-05, 06, 12, 13) y mensajes inmutables (RN-CRM-04)
     ===================================================================== */
  C.windowHours = ch => ch.kind === 'TIKTOK' ? G.param('crm_tiktok_window_hours') : ch.kind === 'WHATSAPP' ? G.param('crm_wa_service_window_hours') : G.param('crm_meta_dm_window_hours');
  C.windows = (cv, at = C.now()) => {
    const ch = chan(cv.channel_id); const svc = cv.service_window_expires_at, ad = cv.free_entry_expires_at;
    return { hours: C.windowHours(ch), inService: !!svc && T(at) <= T(svc), svcLeft: svc ? mins(svc, at) : null, inCtwa: ch.kind === 'WHATSAPP' && !!ad && T(at) <= T(ad), ctwaLeft: ad ? mins(ad, at) : null };
  };
  const svcCache = { arr: null, len: -1, ten: null, map: new Map() };
  /** respuestas de servicio contadas para la cuota mensual del número */
  C.serviceCount = (chId, period) => {
    const arr = G.db.ensure('message_charges');
    if (svcCache.arr !== arr || svcCache.len !== arr.length || svcCache.ten !== G.ctx.tenant) {
      svcCache.map = new Map();
      for (const x of arr) if (x.tenant === G.ctx.tenant && x.category === 'SERVICE' && (x.reason === 'FREE_SERVICE_QUOTA' || x.reason === 'CHARGED')) { const k = x.channel_id + '|' + x.period; svcCache.map.set(k, (svcCache.map.get(k) || 0) + 1); }
      svcCache.arr = arr; svcCache.len = arr.length; svcCache.ten = G.ctx.tenant;
    }
    return svcCache.map.get(chId + '|' + period) || 0;
  };
  /** tarifa de un mensaje saliente de WhatsApp (RN-CRM-13); las plantillas usan G.msg.cost del núcleo */
  C.rateFor = (category, { inService = false, inCtwa = false, origin = 'API', served = 0, quota = 1000 } = {}) => {
    const free = reason => ({ billable: false, reason, rate: 0, amount: 0 });
    if (origin === 'BUSINESS_APP') return free('BUSINESS_APP');
    if (inCtwa) return free('FREE_CTWA_WINDOW');
    if (category === 'SERVICE') { if (served < quota) return free('FREE_SERVICE_QUOTA'); const r = G.param('crm_wa_rate_service') ?? 0.0998; return { billable: true, reason: 'CHARGED', rate: r, amount: r }; }
    const amt = category === 'AUTHENTICATION' ? (G.param('crm_wa_rate_authentication') ?? 0.0998) : G.msg.cost(category, { inServiceWindow: inService, inAdWindow: inCtwa });
    if (!amt) return free('FREE_UTILITY_IN_WINDOW');
    return { billable: true, reason: 'CHARGED', rate: amt, amount: amt };
  };
  /** costo estimado del próximo mensaje de una categoría en la conversación */
  C.nextCost = (cv, category, at = C.now(), origin = 'API') => {
    const ch = chan(cv.channel_id); if (ch.kind !== 'WHATSAPP') return { billable: false, reason: 'NOT_WHATSAPP', amount: 0, rate: 0 };
    const w = C.windows(cv, at);
    return C.rateFor(category, { inService: w.inService, inCtwa: w.inCtwa, origin, served: C.serviceCount(ch.id, G.date.month(at)), quota: ch.free_service_quota ?? G.param('crm_wa_service_free_per_number') });
  };
  /** simulador del costo mensual (CA-CRM-05): mismas tarifas mensaje a mensaje */
  C.simulate = ({ orders = 1000, numbers = 2, replies = 10, utilities = 2, ctwaShare = 0 } = {}) => {
    const quota = G.param('crm_wa_service_free_per_number') ?? 1000; const served = new Array(numbers).fill(0);
    let service = 0, utility = 0; const nCtwa = Math.round(orders * ctwaShare);
    for (let i = 0; i < orders; i++) {
      const n = i % numbers; const ctwa = i < nCtwa;
      for (let k = 0; k < replies; k++) { const r = C.rateFor('SERVICE', { inCtwa: ctwa, served: served[n], quota }); if (r.reason !== 'FREE_CTWA_WINDOW') served[n]++; service += r.amount; }
      for (let k = 0; k < utilities; k++) utility += C.rateFor('UTILITY', { inService: false, inCtwa: ctwa }).amount;
    }
    return { service: R(service), utility: R(utility), total: R(service + utility) };
  };

  function addMsg(cv, m) {
    const row = ins('conversation_messages', { conversation_id: cv.id, channel_id: cv.channel_id, brand_id: cv.brand_id, direction: m.direction, origin: m.origin || 'API', sender_user_id: m.sender_user_id || null, msg_type: m.msg_type || 'TEXT', body: m.body ?? null, media: m.media || null, template_id: m.template_id || null, category: m.category || null, referral: m.referral || null, order_id: m.order_id || null, sent_at: m.sent_at, unsupported_kind: m.unsupported_kind || null, cost: 0 });
    row.external_id = 'wamid.HBgL' + row.id.replace(/[^a-z0-9]/gi, '');
    if (m.transcript) ins('message_transcripts', { message_id: row.id, provider: 'TRANSCRIPCION_FALSA', language: 'es', transcript: m.transcript, confidence: 0.93 });
    return row;
  }
  const statusEv = (msg, status, at, extra) => ins('message_status_events', Object.assign({ message_id: msg.id, status, occurred_at: at || msg.sent_at }, extra || {}));
  function charge(msg, cv, ch, category, w, origin, at) {
    const period = G.date.month(at); const served = category === 'SERVICE' ? C.serviceCount(ch.id, period) : 0;
    const r = C.rateFor(category, { inService: w.inService, inCtwa: w.inCtwa, origin, served, quota: ch.free_service_quota ?? G.param('crm_wa_service_free_per_number') });
    const row = ins('message_charges', { message_id: msg.id, channel_id: ch.id, brand_id: cv.brand_id, user_id: msg.sender_user_id, conversation_id: cv.id, order_id: msg.order_id, period, category, billable: r.billable, reason: r.reason, rate: r.rate, amount: R(r.amount, 4), charged_at: at });
    if (svcCache.arr === G.db.ensure('message_charges')) { svcCache.len++; if (category === 'SERVICE' && (r.reason === 'FREE_SERVICE_QUOTA' || r.reason === 'CHARGED')) { const k = ch.id + '|' + period; svcCache.map.set(k, (svcCache.map.get(k) || 0) + 1); } }
    msg.cost = row.amount; msg.charge_reason = r.reason;
    return row;
  }
  /** salida sin validaciones: inserta, cobra y actualiza la conversación */
  function out(cv, o) {
    const ch = chan(cv.channel_id); const at = o.at; const w = C.windows(cv, at);
    const msg = addMsg(cv, { direction: 'OUT', origin: o.origin || 'API', sender_user_id: o.user_id, msg_type: o.msg_type, body: o.body, media: o.media, template_id: o.template_id, category: o.category, order_id: o.order_id, sent_at: at, transcript: o.transcript });
    statusEv(msg, 'SENT', at); statusEv(msg, 'DELIVERED', at, { pricing_category: ch.kind === 'WHATSAPP' ? o.category : null });
    if (ch.kind === 'WHATSAPP') charge(msg, cv, ch, o.category, w, o.origin || 'API', at);
    const human = !!o.user_id && o.origin !== 'SYSTEM';
    const patch = { last_outbound_at: at, outbound_since_inbound: (cv.outbound_since_inbound || 0) + (o.origin === 'SYSTEM' ? 0 : 1) };
    if (human) { patch.last_reply_at = at; if (!cv.first_response_at && T(at) >= T(cv.opened_at)) patch.first_response_at = at; }
    upd('conversations', cv.id, patch);
    if (human && cv.lead_id) { const l = G.db.get('leads', cv.lead_id); if (l && l.status === 'NEW') upd('leads', l.id, { status: 'CONTACTED', first_response_at: at, owner_user_id: l.owner_user_id || o.user_id }); }
    if (human && !o.template_id) C.scanMessage(msg, cv, o.transcript);
    G.events.emit('message.sent', { message_id: msg.id, conversation_id: cv.id, kind: o.category === 'SERVICE' ? 'SESSION' : o.category, cost: msg.cost || 0, ref: o.order_id || null });
    return msg;
  }
  C.fill = (body, vars = {}) => String(body || '').replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] != null && vars[k] !== '' ? vars[k] : m);
  C.utilityCount = orderId => G.db.where('conversation_messages', m => m.order_id === orderId && m.category === 'UTILITY' && m.msg_type === 'TEMPLATE').length;
  const UNSUB = '\n\nSi no deseas recibir promociones, responde BAJA.';

  /** envío validado (bandeja, API y sistema) */
  C.send = function (cvId, o = {}) {
    const cv = conv(cvId); if (!cv) G.fail('RN-CRM-03', 'Conversación no encontrada.');
    const ch = chan(cv.channel_id); const at = o.at || C.now(); const origin = o.origin || 'API';
    const uid = o.user_id !== undefined ? o.user_id : (o.system ? null : me());
    if (!o.system && !C.canReply(cv, uid)) G.fail('RN-CRM-03', cv.assigned_user_id ? `Este chat está asignado a ${G.userShort(cv.assigned_user_id)}: solo ella (o la supervisora) responde.` : 'El chat está en cola: la supervisora debe asignarlo o tomarlo.');
    const tpl = o.template_id ? G.db.get('message_templates', o.template_id) : null;
    const w = C.windows(cv, at); let category = 'SERVICE', msgType = o.msg_type || 'TEXT', body = o.text;
    if (tpl) {
      if (ch.kind === 'TIKTOK') G.fail('RN-CRM-06', 'TikTok no admite plantillas ni envíos masivos.');
      if (ch.kind !== 'WHATSAPP') G.fail('RN-CRM-05', `${kindName(ch.kind)} no admite plantillas: solo se responde dentro de ${w.hours} h desde el último mensaje del cliente.`);
      if (tpl.provider_status !== 'APPROVED') G.fail('RN-CRM-07', `La plantilla ${tpl.name} está «${TPLST[tpl.provider_status][0]}»: solo se envían plantillas aprobadas por Meta.`);
      if (tpl.brand_id && tpl.brand_id !== cv.brand_id) G.fail('RN-CRM-07', `La plantilla ${tpl.name} es de ${G.brandName(tpl.brand_id)} y el número es de ${G.brandName(cv.brand_id)}.`);
      category = tpl.category;
      if (category === 'MARKETING') {
        if (!o.system && !G.can('crm.template.send_marketing', roleOf(uid))) G.fail('RN-CRM-08', 'Tu rol no envía plantillas de marketing (permiso crm.template.send_marketing).');
        if (C.consentState(cv.customer_id, cv.contact_id, 'MARKETING') !== true) G.fail('RN-CRM-08', `${C.contactName(cv)} no tiene consentimiento de marketing vigente (último registro: ${C.consentState(cv.customer_id, cv.contact_id, 'MARKETING') === false ? 'baja' : 'ninguno'}). Registra su «SÍ» con evidencia antes de enviar.`);
      }
      if (category === 'UTILITY' && o.order_id) {
        const max = G.param('crm_utility_templates_per_order') ?? 2; const n = C.utilityCount(o.order_id);
        if (n >= max && !(o.allowExtra && G.can('crm.template.send_extra', roleOf(uid)))) G.fail('RN-CRM-07', `El pedido ya recibió ${n} plantillas de utilidad (máximo ${max}). Una más requiere el permiso crm.template.send_extra.`);
      }
      msgType = 'TEMPLATE'; body = C.fill(tpl.body, o.vars || {}) + (category === 'MARKETING' ? UNSUB : '');
    } else {
      if (!String(body || '').trim() && !['IMAGE', 'DOCUMENT', 'LOCATION', 'AUDIO'].includes(msgType)) G.fail('RN-CRM-05', 'Escribe el mensaje.');
      if (cv.status === 'CLOSED') G.fail('RN-CRM-05', 'La conversación está cerrada: reábrela o espera a que el cliente escriba.');
      if (ch.kind === 'TIKTOK') {
        const lim = G.param('crm_tiktok_window_hours'), max = G.param('crm_tiktok_max_consecutive');
        if (!cv.last_inbound_at || mins(at, cv.last_inbound_at) > lim * 60) G.fail('RN-CRM-06', `En TikTok solo se responde dentro de ${lim} h desde el último mensaje del cliente (escribió hace ${dur(cv.last_inbound_at ? mins(at, cv.last_inbound_at) : null)}).`);
        if ((cv.outbound_since_inbound || 0) >= max) G.fail('RN-CRM-06', `En TikTok se envían como máximo ${max} mensajes seguidos sin respuesta del cliente.`);
      } else if (!w.inService) G.fail('RN-CRM-05', `Fuera de la ventana de ${w.hours} h desde el último mensaje del cliente: solo se envía una plantilla aprobada.`);
    }
    return out(cv, { at, origin, user_id: uid, msg_type: msgType, body, media: o.media, template_id: tpl ? tpl.id : null, category, order_id: o.order_id || null, transcript: o.transcript });
  };
  C.deleteMessage = () => G.fail('RN-CRM-04', 'Los mensajes son de solo inserción: no se borran ni desde la bandeja ni desde la API. El mensaje sigue visible para la supervisora.');
  C.editMessage = () => G.fail('RN-CRM-04', 'Los mensajes son de solo inserción: no se editan. Envía un mensaje nuevo con la corrección.');
  C.msgStatus = msgId => { const ev = G.db.where('message_status_events', e => e.message_id === msgId); return ev.length ? ev[ev.length - 1].status : null; };
  /** el cliente borró su mensaje: se conserva el original (RN-CRM-04) */
  C.customerDeleted = (msgId, at) => statusEv({ id: msgId }, 'DELETED_BY_CUSTOMER', at || C.now());
  /** la vendedora borró el mensaje desde el celular (coexistencia): se conserva y alerta */
  C.appDeleted = function (msgId, at) {
    const m = G.db.get('conversation_messages', msgId); const cv = conv(m.conversation_id);
    statusEv(m, 'DELETED_IN_APP', at || C.now());
    const rule = G.db.find('control_alert_rules', r => r.rule_type === 'APP_DELETION' && r.active !== false);
    return rule ? C.raiseAlert({ rule, matched: 'Mensaje borrado desde la app del celular', msg: m, cv, excerpt: m.body, at }) : null;
  };
  C.addNote = (cvId, text, uid = me(), at) => { const cv = conv(cvId); if (!String(text || '').trim()) G.fail('RN-CRM-04', 'Escribe la nota.'); const notes = (cv.internal_notes || []).concat([{ at: at || C.now(), user_id: uid, text }]); upd('conversations', cv.id, { internal_notes: notes }); return notes; };
  C.close = function (cvId, reason, at) {
    const cv = conv(cvId); if (!reason) G.fail('RN-CRM-09', 'Elige el motivo de cierre.');
    const hasOrder = !!G.db.find('conversation_orders', x => x.conversation_id === cv.id);
    if (reason === 'ORDER_CREATED' && !hasOrder) G.fail('RN-CRM-09', 'No hay pedido vinculado: elige otro motivo.');
    upd('conversations', cv.id, { status: 'CLOSED', closed_at: at || C.now(), close_reason: reason });
    return cv;
  };
  C.reopen = cvId => upd('conversations', cvId, { status: 'OPEN', closed_at: null, close_reason: null });

  /* =====================================================================
     Control de vendedoras (RN-CRM-15, 16, 17)
     ===================================================================== */
  C.officialSet = () => { const ph = new Set(), acc = new Set(); for (const o of G.db.where('official_identifiers', x => x.status !== 'INACTIVE')) { const d = digits(o.value); if (['PHONE', 'YAPE', 'PLIN'].includes(o.identifier_type)) ph.add(d.slice(-9)); else if (['BANK_ACCOUNT', 'CCI'].includes(o.identifier_type)) acc.add(d); } return { ph, acc }; };
  C.catalogHas = term => { const t = norm(term); return G.db.all('products').some(p => p.status === 'ACTIVE' && p.product_type === 'GOODS' && norm(p.name).includes(t)) || G.db.all('product_variants').some(v => v.status === 'ACTIVE' && v.sellable && norm(v.name).includes(t)); };
  /** crm_scan_text: frases, celulares y cuentas ajenas, términos fuera del catálogo */
  C.scanText = function (text, { customerPhone } = {}) {
    const hits = []; const raw = String(text || ''); const n = norm(raw);
    const rules = G.db.where('control_alert_rules', r => r.active !== false); const byType = t => rules.filter(r => r.rule_type === t);
    const off = C.officialSet(); const own = customerPhone ? last9(customerPhone) : null;
    let rest = raw;
    for (const a of raw.match(/\d(?:[ .-]?\d){12,19}/g) || []) { rest = rest.replace(a, ' '); const d = digits(a); if (d.length < 13 || d.length > 20 || off.acc.has(d)) continue; for (const r of byType('FOREIGN_ACCOUNT')) hits.push({ rule: r, matched: a }); }
    for (const p of rest.match(/(?:\+?51[ .-]?)?9(?:[ .-]?\d){8}(?!\d)/g) || []) { const d = last9(p); if (off.ph.has(d) || (own && d === own)) continue; for (const r of byType('FOREIGN_PHONE')) hits.push({ rule: r, matched: p.trim() }); }
    for (const r of byType('KEYWORD')) { const k = norm(r.pattern); if (k && new RegExp('(^|[^a-z0-9])' + esc(k) + '($|[^a-z0-9])').test(n)) hits.push({ rule: r, matched: r.pattern }); }
    for (const r of byType('OFF_CATALOG_TERM')) { const k = norm(r.pattern); if (k && new RegExp('(^|[^a-z0-9])' + esc(k) + '(es|s)?($|[^a-z0-9])').test(n) && !C.catalogHas(r.pattern)) hits.push({ rule: r, matched: r.pattern }); }
    return hits;
  };
  C.scanMessage = function (msg, cv, transcript) {
    const text = msg.msg_type === 'AUDIO' ? transcript : msg.body; if (!text) return [];
    const cust = cv.customer_id && G.db.get('customers', cv.customer_id); const ct = G.db.get('channel_contacts', cv.contact_id);
    return C.scanText(text, { customerPhone: (cust && cust.phone) || (ct && ct.phone) }).map(x => C.raiseAlert({ rule: x.rule, matched: x.matched, msg, cv, source_type: msg.msg_type === 'AUDIO' ? 'VOICE_NOTE' : 'MESSAGE', excerpt: text, at: msg.sent_at }));
  };
  C.raiseAlert = function ({ rule, matched, msg, cv, source_type = 'MESSAGE', excerpt, at, user_id }) {
    const a = ins('control_alerts', { rule_id: rule.id, rule_code: rule.code, source_type, message_id: msg ? msg.id : null, call_id: null, conversation_id: cv ? cv.id : null, user_id: user_id || (msg && msg.sender_user_id) || (cv && cv.assigned_user_id) || null, brand_id: cv ? cv.brand_id : null, severity: rule.severity, matched_text: matched, excerpt: String(excerpt || '').slice(0, 300), status: 'OPEN', raised_at: at || C.now() });
    G.events.emit('control_alert.raised', { alert_id: a.id, user_id: a.user_id, rule: rule.code, severity: a.severity });
    G.notify({ role: 'SUPERVISORA_VENTAS', title: `Alerta de control (${SEV[a.severity][0].toLowerCase()})`, body: `${G.userShort(a.user_id)} · ${rule.name || rule.code}: «${matched}»`, ref: a.id, tone: a.severity === 'HIGH' ? 'bad' : 'warn', module: 'CRM' });
    return a;
  };
  C.reviewAlert = function (id, status, note, by = me()) {
    if (!G.can('crm.alert.review', roleOf(by))) G.fail('RN-CRM-17', 'Solo la supervisora o gerencia revisan alertas (permiso crm.alert.review).');
    const a = G.db.get('control_alerts', id);
    if (['DISMISSED', 'CONFIRMED'].includes(a.status)) G.fail('RN-CRM-17', 'La alerta ya está cerrada: las alertas no se reabren ni se borran.');
    if (['DISMISSED', 'CONFIRMED'].includes(status) && !String(note || '').trim()) G.fail('RN-CRM-17', 'Cerrar una alerta exige una nota de la revisión.');
    if (a.user_id && a.user_id === by) G.fail('RN-CRM-17', 'Nadie revisa una alerta sobre sí misma.');
    upd('control_alerts', id, { status, reviewed_by: by, reviewed_at: C.now(), resolution_note: note || null });
    G.audit('REVISAR', 'control_alerts', id, `${ASTATUS[status][0]}: ${note || ''}`);
    if (status === 'CONFIRMED') G.notify({ role: 'GERENTE', title: 'Alerta de control confirmada', body: `${G.userShort(a.user_id)} · ${a.matched_text} · ${note}`, ref: id, tone: 'bad', module: 'CRM' });
    return G.db.get('control_alerts', id);
  };

  /* =====================================================================
     Consentimientos (RN-CRM-08, RN-CRM-21 · Ley 29733)
     ===================================================================== */
  C.consentState = (customer_id, contact_id, purpose = 'MARKETING') => {
    const rows = G.db.where('contact_consents', c => c.purpose === purpose && ((customer_id && c.customer_id === customer_id) || (contact_id && c.contact_id === contact_id)));
    if (!rows.length) return null; rows.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)); return !!rows[rows.length - 1].granted;
  };
  C.recordConsent = function ({ customer_id, contact_id, purpose, granted, channel = 'WHATSAPP', evidence_text, evidence_message_id, brand_id, at }) {
    if (!evidence_text && !evidence_message_id) G.fail('RN-CRM-21', 'El consentimiento se registra con evidencia (mensaje o texto); nunca se presume.');
    const r = ins('contact_consents', { customer_id: customer_id || null, contact_id: contact_id || null, purpose, granted: !!granted, channel, evidence_message_id: evidence_message_id || null, evidence_text: evidence_text || null, recorded_at: at || C.now(), recorded_by: G._seeding ? null : me(), brand_id: brand_id || null });
    if (purpose === 'MARKETING' && !granted) G.events.emit('consent.opted_out', { customer_id, contact_id, channel, brand_id });
    return r;
  };

  /* =====================================================================
     Entrada de mensajes (webhook de INT): contacto, lead, ventana y asignación
     ===================================================================== */
  C.adByCode = code => code ? G.db.find('ad_ads', a => a.code === code || a.tracking_code === code || norm(a.code) === norm(code)) : null;
  C.codeInText = text => {
    const t = String(text || '');
    for (const a of G.db.all('ad_ads')) for (const c of [a.tracking_code, a.code].filter(Boolean)) if (c.length >= 5 && new RegExp('(^|[^A-Za-z0-9])' + esc(c) + '($|[^A-Za-z0-9])', 'i').test(t)) return c.toUpperCase();
    const m = t.match(/\b([A-Z]{2}\d?)-([A-Z]\d{1,3})\b/i); return m ? m[0].toUpperCase() : null;
  };
  /**
   * C.receive({channel_id, from, name, text, msg_type, referral:{ad_code}, at, transcript, media, group, assignTo, asLead})
   * RN-CRM-10 (cliente por celular o lead), RN-CRM-11 (grupos y no soportados), RN-CRM-12 (referral), RN-CRM-21 (aviso)
   */
  C.receive = function (o) {
    const ch = chan(o.channel_id); const at = o.at || C.now();
    if (!ch) G.fail('RN-CRM-01', 'Número o cuenta no conectado.');
    if (ch.connection_mode === 'NOT_AVAILABLE') G.fail('RN-CRM-06', `${ch.display_name} no está disponible para la cuenta peruana: los anuncios de TikTok llevan a WhatsApp con código (RN-ADS-03).`);
    if (ch.connection_mode === 'APP_ONLY') G.fail('RN-CRM-01', `${ch.display_name} está en modo solo app: no hay integración y el pedido se registra a mano.`);
    if (o.group) { upd('messaging_channels', ch.id, { group_msgs_discarded: (ch.group_msgs_discarded || 0) + 1 }); return { discarded: true }; }
    let contact = G.db.find('channel_contacts', c => c.provider === ch.kind && c.external_user_id === o.from);
    let lead = null, isNewContact = false;
    if (!contact) {
      isNewContact = true;
      const cust = ch.kind === 'WHATSAPP' ? G.db.find('customers', c => c.phone === o.from) : (o.customer_id ? G.db.get('customers', o.customer_id) : null);
      if (!cust || o.asLead) {
        lead = ins('leads', { brand_id: ch.brand_id, channel_id: ch.id, customer_id: cust && o.asLead ? null : null, full_name: o.name || null, phone: ch.kind === 'WHATSAPP' ? o.from : null, source: ch.kind, owner_user_id: null, status: 'NEW', first_contact_at: at, notes: null, ad_code: null, existing_customer_id: cust ? cust.id : null });
        G.events.emit('lead.created', { lead_id: lead.id, channel_id: ch.id });
      }
      contact = ins('channel_contacts', { provider: ch.kind, external_user_id: o.from, display_name: o.name || (cust && cust.full_name) || null, phone: ch.kind === 'WHATSAPP' ? o.from : null, customer_id: cust && !lead ? cust.id : null, lead_id: lead ? lead.id : null, blocked: false });
    } else if (contact.lead_id) lead = G.db.get('leads', contact.lead_id);
    let cv = G.db.find('conversations', c => c.contact_id === contact.id && c.channel_id === ch.id && c.status !== 'CLOSED');
    let created = false;
    const code = o.referral && o.referral.ad_code ? o.referral.ad_code : C.codeInText(o.text);
    if (!cv) {
      created = true;
      const entry = o.referral ? 'CTWA_AD' : ch.kind === 'TIKTOK' ? 'TIKTOK_DM' : code ? 'TRACKING_CODE' : 'ORGANIC';
      const ad = C.adByCode(code);
      cv = ins('conversations', { channel_id: ch.id, contact_id: contact.id, brand_id: ch.brand_id, customer_id: contact.customer_id || null, lead_id: contact.lead_id || null, assigned_user_id: null, status: 'OPEN', entry_point: entry, ad_id: ad ? ad.id : null, ad_code: code || null, opened_at: at, last_inbound_at: null, last_outbound_at: null, outbound_since_inbound: 0, first_response_at: null, service_window_expires_at: null, free_entry_expires_at: entry === 'CTWA_AD' ? addH(at, G.param('crm_wa_ctwa_free_hours') ?? 72) : null, closed_at: null, close_reason: null, tags: [], internal_notes: [] });
      if (lead && code && !lead.ad_code) upd('leads', lead.id, { ad_code: code, ad_id: ad ? ad.id : null });
    } else if (o.referral && cv.entry_point !== 'CTWA_AD') {
      const ad = C.adByCode(code); upd('conversations', cv.id, { entry_point: 'CTWA_AD', ad_code: code, ad_id: ad ? ad.id : null, free_entry_expires_at: addH(at, G.param('crm_wa_ctwa_free_hours') ?? 72) });
    }
    const unsupported = ['VIEW_ONCE', 'LIVE_LOCATION', 'EPHEMERAL'].includes(o.msg_type);
    const msg = addMsg(cv, { direction: 'IN', origin: o.origin || 'API', msg_type: unsupported ? 'UNSUPPORTED' : (o.msg_type || 'TEXT'), body: unsupported ? null : (o.text || null), referral: o.referral || null, sent_at: at, media: o.media, transcript: o.transcript, unsupported_kind: unsupported ? o.msg_type : null });
    upd('conversations', cv.id, { last_inbound_at: at, outbound_since_inbound: 0, service_window_expires_at: addH(at, C.windowHours(ch)), status: cv.status === 'CLOSED' ? 'CLOSED' : 'OPEN' });
    if (isNewContact && ch.recording_notice_text) {
      const n = out(cv, { at: addM(at, 0), origin: 'SYSTEM', user_id: null, msg_type: 'TEXT', body: ch.recording_notice_text, category: 'SERVICE' });
      ins('contact_consents', { customer_id: contact.customer_id || null, contact_id: contact.id, purpose: 'RECORDING_NOTICE', granted: true, channel: ch.kind === 'WHATSAPP' ? 'WHATSAPP' : ch.kind, evidence_message_id: n.id, evidence_text: 'Aviso automático al primer mensaje', recorded_at: at, brand_id: ch.brand_id });
    } else if (created && ch.auto_greeting) out(cv, { at, origin: 'SYSTEM', user_id: null, msg_type: 'TEXT', body: ch.auto_greeting, category: 'SERVICE' });
    if (o.text && /^\s*baja\s*\.?$/i.test(o.text)) C.recordConsent({ customer_id: cv.customer_id, contact_id: contact.id, purpose: 'MARKETING', granted: false, channel: ch.kind === 'WHATSAPP' ? 'WHATSAPP' : ch.kind, evidence_message_id: msg.id, evidence_text: 'Respondió BAJA', brand_id: ch.brand_id, at });
    const fresh = conv(cv.id);
    if (o.assignTo && !fresh.assigned_user_id) C.assign(cv.id, o.assignTo, { reason: ch.assignment_mode === 'LEAST_OPEN' ? 'AUTO_LEAST_OPEN' : 'AUTO_SHIFT', at });
    else if (!fresh.assigned_user_id) C.autoAssign(fresh, at);
    G.events.emit('message.received', { conversation_id: cv.id, message_id: msg.id });
    return { conversation: conv(cv.id), message: msg, lead, contact };
  };

  /* =====================================================================
     Leads, pedido desde el chat y atribución (RN-CRM-09, RN-CRM-10, RN-CRM-22)
     ===================================================================== */
  C.setLeadStatus = function (id, status, { reason, note } = {}) {
    const l = G.db.get('leads', id);
    if (status === 'WON') G.fail('RN-CRM-09', 'Un lead pasa a GANADO solo al guardar su pedido desde el chat.');
    if (l.status === 'WON') G.fail('RN-CRM-09', 'El lead ya está ganado: tiene pedido.');
    if (status === 'LOST' && !reason) G.fail('RN-CRM-09', 'Para marcar el lead como perdido elige el motivo.');
    upd('leads', id, { status, lost_reason: status === 'LOST' ? reason : null, notes: note ? [l.notes, note].filter(Boolean).join(' · ') : l.notes });
    return G.db.get('leads', id);
  };
  C.leadToCustomer = function (cv, data = {}) {
    const ch = chan(cv.channel_id); const lead = cv.lead_id && G.db.get('leads', cv.lead_id); const ct = G.db.get('channel_contacts', cv.contact_id);
    if (lead && lead.existing_customer_id) { const c0 = G.db.get('customers', lead.existing_customer_id); upd('conversations', cv.id, { customer_id: c0.id }); upd('channel_contacts', ct.id, { customer_id: c0.id }); return c0; }
    const name = data.full_name || (lead && lead.full_name) || (ct && ct.display_name);
    if (!name) G.fail('RN-PED-01', 'Falta el nombre del cliente.');
    const phone = data.phone || (lead && lead.phone) || (ct && ct.phone) || null;
    if (phone && !U.phoneOk(phone)) G.fail('RN-PED-01', 'El celular debe estar en formato E.164 (+51…).');
    let c = phone && G.db.find('customers', x => x.phone === phone);
    if (!c) c = G.db.insert('customers', { doc_type: data.doc_number ? 'DNI' : 'NONE', doc_number: data.doc_number || null, full_name: name, phone, email: null, customer_type: 'PERSON', source_channel: ORDER_CH[ch.kind], marketing_opt_in: false, status: 'ACTIVE', first_order_at: null, last_order_at: null, orders_count: 0, segment_brands: [], created_from: 'CRM' });
    upd('conversations', cv.id, { customer_id: c.id }); upd('channel_contacts', ct.id, { customer_id: c.id }); if (lead) upd('leads', lead.id, { customer_id: c.id });
    return c;
  };
  C.orderOrigin = cv => { const ch = chan(cv.channel_id); return { channel: ORDER_CH[ch.kind], origin_wa_number: ch.kind === 'WHATSAPP' ? ch.number : null, origin_ad_code: cv.ad_code || null, brand_id: cv.brand_id, seller_id: cv.assigned_user_id || me(), entry_point: cv.entry_point }; };
  function attribute(cv, o, lead, isNew, at) {
    const prevAtt = G.db.find('ad_attributions', x => x.order_id === o.id);
    if (prevAtt && !(prevAtt.method === 'NONE' && !prevAtt.ad_id)) return null; /* si ADS ya atribuyó el pedido sin anuncio, CRM completa la atribución con el código del chat */
    const method = { CTWA_AD: 'CTWA_REFERRAL', TRACKING_CODE: 'TRACKING_CODE', TIKTOK_DM: 'TIKTOK_DM' }[cv.entry_point] || (cv.ad_code ? 'TRACKING_CODE' : 'NONE');
    const ad = C.adByCode(cv.ad_code);
    const row = { lead_id: lead ? lead.id : null, order_id: o.id, conversation_id: cv.id, ad_id: ad ? ad.id : null, campaign_id: ad ? ad.campaign_id : null, platform: ad ? ad.platform : (cv.entry_point === 'TIKTOK_DM' ? 'TIKTOK' : cv.entry_point === 'CTWA_AD' ? 'META' : null), method, is_new_customer: !!isNew, attributed_at: at || C.now(), ad_code: cv.ad_code || null, brand_id: o.brand_id };
    if (prevAtt) return G.db.update('ad_attributions', prevAtt.id, Object.assign({}, row, { lead_origin: prevAtt.lead_origin, customer_id: prevAtt.customer_id }), { silent: true });
    if (G.ads && typeof G.ads.attribute === 'function') { try { return G.ads.attribute(row); } catch (e) { if (e instanceof G.RuleError) throw e; } }
    return ins('ad_attributions', row);
  }
  /** crm_link_order: un pedido pertenece a una sola conversación; el lead pasa a WON */
  C.linkOrder = function (cv, o, lead, isNew, at) {
    if (G.db.find('conversation_orders', x => x.order_id === o.id)) G.fail('RN-CRM-09', `El pedido ${o.number} ya está vinculado a otra conversación.`);
    ins('conversation_orders', { conversation_id: cv.id, order_id: o.id, lead_id: lead ? lead.id : null, linked_at: at || C.now() });
    if (lead && lead.status !== 'WON') { upd('leads', lead.id, { status: 'WON', converted_order_id: o.id, converted_at: at || C.now(), customer_id: o.customer_id }); G.events.emit('lead.converted', { lead_id: lead.id, order_id: o.id }); }
    attribute(cv, o, lead, isNew, at);
  };
  const qtyTxt = l => { const v = G.variant(l.variant_id); return v && v.sale_mode === 'KG' ? G.fmt.kg(l.qty, 2) : `${l.qty} ${l.qty === 1 ? 'u.' : 'u.'}`; };
  C.orderVars = o => {
    const c = G.db.get('customers', o.customer_id) || {}; const a = o.address_id && G.db.get('customer_addresses', o.address_id);
    return { cliente: (c.full_name || 'cliente').split(' ')[0], pedido: o.number, marca: G.brandName(o.brand_id), productos: (o.lines || []).map(l => `• ${qtyTxt(l)} ${G.variantName(l.variant_id)}${l.est_weight_kg ? ` (≈ ${G.fmt.kg(l.est_weight_kg, 3)})` : ''}`).join('\n') || '• (por definir)', peso: o.est_kg ? G.fmt.kg(o.est_kg, 3) : 'no aplica', total: G.fmt.money(o.estimated_total), direccion: a ? a.address_line : o.fulfillment === 'PICKUP' ? 'recojo en ' + G.siteName(o.pickup_establishment_id) : 'por confirmar', fecha: G.fmt.date(o.delivery_date), franja: o.slot_from ? `${o.slot_from}–${o.slot_to}` : '', enlace_pago: 'https://mpago.la/dg-' + o.number.toLowerCase(), yape: C.yape(), repartidor: o.driver_user_id ? G.userShort(o.driver_user_id) : 'nuestro repartidor', enlace_seguimiento: 'https://donguando.aycha.pe/s/' + o.number.slice(2), peso_real: o.final_total != null ? G.fmt.kg(U.sum(o.lines, l => l.weighed_kg || 0), 3) : '' };
  };
  /** RN-CRM-22: resumen y cobro en un solo mensaje (plantilla de confirmación) */
  C.sendSummary = function (o, cv, uid, at) {
    const ch = chan(cv.channel_id);
    if (ch.kind === 'WHATSAPP') { const tpl = C.templateFor(cv.brand_id, 'ORDER_CONFIRMATION'); if (!tpl) G.fail('RN-CRM-07', 'No hay plantilla de confirmación aprobada para la marca.'); return C.send(cv.id, { template_id: tpl.id, vars: C.orderVars(o), order_id: o.id, user_id: uid, at, system: !uid }); }
    const v = C.orderVars(o);
    return C.send(cv.id, { text: `Pedido ${v.pedido} de ${v.marca}:\n${v.productos}\nTotal estimado ${v.total} · ${v.direccion} · ${v.fecha} ${v.franja}\nPaga con el enlace de la empresa: ${v.enlace_pago}`, order_id: o.id, user_id: uid, at, system: !uid });
  };
  /** «Crear pedido» desde el chat: borrador de PED con el origen lleno y no editable (RN-CRM-09, RN-PED-16) */
  C.createOrder = function (cvId, d = {}) {
    const cv = conv(cvId); const uid = d.user_id !== undefined ? d.user_id : me(); const at = d.at || C.now();
    if (!d.system && !G.can('crm.conversation.create_order', roleOf(uid))) G.fail('RN-CRM-09', 'Tu rol no crea pedidos desde el chat (permiso crm.conversation.create_order).');
    if (!d.system && !C.canReply(cv, uid)) G.fail('RN-CRM-03', 'Solo la vendedora asignada (o la supervisora) crea el pedido de este chat.');
    const lead = cv.lead_id && G.db.get('leads', cv.lead_id);
    let custId = cv.customer_id;
    if (!custId) custId = C.leadToCustomer(cv, d.customer || {}).id;
    const isNew = !G.db.find('sales_orders', x => x.customer_id === custId && x.status !== 'CANCELLED');
    let addrId = d.address_id || null;
    if (!addrId && d.address && d.address.address_line) {
      const z = d.address.lat != null && G.geo && G.geo.zoneAt ? G.geo.zoneAt(d.address.lat, d.address.lng) : null;
      addrId = G.db.insert('customer_addresses', { customer_id: custId, label: 'Casa', address_line: d.address.address_line, reference: d.address.reference || null, lat: d.address.lat ?? null, lng: d.address.lng ?? null, zone_id: z ? z.id : null, contact_name: G.custName(custId), contact_phone: (G.db.get('customers', custId) || {}).phone, is_default: true, status: 'ACTIVE', pin_source: 'MAP' }).id;
    }
    const og = C.orderOrigin(cv);
    const o = G.orders.create({ customer_id: custId, brand_id: og.brand_id, channel: og.channel, fulfillment: d.fulfillment || 'DELIVERY', address_id: addrId, delivery_date: d.delivery_date || null, slot_id: d.slot_id || null, payment_method_id: d.payment_method_id || null, requested_doc_type: d.requested_doc_type, notes: d.notes || null, lines: d.lines || [], origin_wa_number: og.origin_wa_number, origin_ad_code: og.origin_ad_code, seller_id: og.seller_id, origin_ref: 'CRM:' + cv.id, extra: { origin_locked: true, conversation_id: cv.id } });
    C.linkOrder(cv, o, lead, isNew, at);
    let message = null, summaryError = null;
    if (d.sendSummary !== false) { try { message = C.sendSummary(o, conv(cv.id), uid, at); } catch (e) { if (!(e instanceof G.RuleError)) throw e; summaryError = e.message; } }
    return { order: o, message, isNew, summaryError };
  };
  C.templateFor = (brand_id, purpose) => G.db.find('message_templates', t => t.brand_id === brand_id && t.purpose === purpose && t.provider_status === 'APPROVED');
  /** conversación de WhatsApp de la marca para avisos iniciados por la empresa */
  C.ensureWaConversation = function (customer_id, brand_id, waNumber, at) {
    const c = G.db.get('customers', customer_id); if (!c || !c.phone) G.fail('RN-CRM-05', 'El cliente no tiene celular registrado: no se le puede escribir por WhatsApp.');
    const ch = (waNumber && G.db.find('messaging_channels', x => x.number === waNumber)) || G.db.find('messaging_channels', x => x.kind === 'WHATSAPP' && x.brand_id === brand_id);
    let ct = G.db.find('channel_contacts', x => x.provider === 'WHATSAPP' && x.external_user_id === c.phone);
    if (!ct) ct = ins('channel_contacts', { provider: 'WHATSAPP', external_user_id: c.phone, display_name: c.full_name, phone: c.phone, customer_id: c.id, lead_id: null, blocked: false });
    let cv = G.db.where('conversations', x => x.contact_id === ct.id && x.channel_id === ch.id).sort((a, b) => b.opened_at.localeCompare(a.opened_at))[0];
    if (!cv) cv = ins('conversations', { channel_id: ch.id, contact_id: ct.id, brand_id: ch.brand_id, customer_id: c.id, lead_id: null, assigned_user_id: null, status: 'PENDING', entry_point: 'ORGANIC', ad_id: null, ad_code: null, opened_at: at || C.now(), outbound_since_inbound: 0, tags: [], internal_notes: [], business_initiated: true });
    return cv;
  };
  /**
   * G.crm.sendTemplate({order_id, customer_id, brand_id, purpose, template_id, vars, conversation_id, user_id, at, allowExtra})
   * Para PED (confirmación, diferencia de peso), DEL («va en camino»), ETQ (retiro de lote) y CMP. Lanza RuleError (RN-CRM-07/08).
   */
  C.sendTemplate = function ({ order_id, customer_id, brand_id, purpose, template_id, vars = {}, conversation_id, user_id, at, allowExtra } = {}) {
    const o = order_id && G.db.get('sales_orders', order_id);
    customer_id = customer_id || (o && o.customer_id); brand_id = brand_id || (o && o.brand_id) || 'br-DG';
    let cv = conversation_id && conv(conversation_id);
    if (!cv && o) { const link = G.db.find('conversation_orders', x => x.order_id === o.id); cv = link && conv(link.conversation_id); }
    if (!cv || chan(cv.channel_id).kind !== 'WHATSAPP') cv = C.ensureWaConversation(customer_id, brand_id, o && o.origin_wa_number, at);
    const tpl = template_id ? G.db.get('message_templates', template_id) : C.templateFor(cv.brand_id, purpose);
    if (!tpl) G.fail('RN-CRM-07', `No hay plantilla aprobada de «${PURPOSE[purpose] || purpose}» para ${G.brandName(cv.brand_id)}.`);
    return C.send(cv.id, { template_id: tpl.id, vars: Object.assign(o ? C.orderVars(o) : {}, vars), order_id: order_id || null, user_id: user_id ?? null, system: user_id == null, at, allowExtra });
  };

  /* =====================================================================
     Recompra (RN-CRM-19), encuestas (RN-CRM-20), muestreo (RN-CRM-18), tareas
     ===================================================================== */
  C.rebuyCompute = function (dates, today = G.TODAY) {
    const ds = [...new Set(dates.map(d => String(d).slice(0, 10)))].sort(); const n = ds.length; const last = ds[n - 1] || null;
    if (n < (G.param('crm_rebuy_min_orders') ?? 3)) return { orders_count: n, median_interval_days: null, last_order_at: last, next_expected_at: null, status: 'NEW', due_task_at: null };
    const gaps = []; for (let i = 1; i < n; i++) gaps.push(G.date.diff(ds[i], ds[i - 1]));
    const med = median(gaps); const next = G.date.add(last, Math.round(med)); const since = G.date.diff(today, last);
    const status = since > med * G.param('crm_rebuy_lost_factor') ? 'LOST' : since > med * G.param('crm_rebuy_risk_factor') ? 'AT_RISK' : G.date.diff(next, today) <= G.param('crm_rebuy_notice_days') ? 'DUE' : 'ACTIVE';
    return { orders_count: n, median_interval_days: med, last_order_at: last, next_expected_at: next, status, due_task_at: G.date.add(next, -G.param('crm_rebuy_notice_days')) };
  };
  C.addTask = t => ins('crm_tasks', Object.assign({ status: 'OPEN', done_at: null, result: null }, t));
  /** crm_rebuy_schedule: perfil y una sola tarea de recompra abierta por cliente y marca */
  C.rebuySchedule = function (customer_id, brand_id, { dates, today = G.TODAY, seller, createTask = true } = {}) {
    const p = C.rebuyCompute(dates, today);
    let prof = G.db.find('customer_rebuy_profiles', x => x.customer_id === customer_id && x.brand_id === brand_id);
    const row = Object.assign({ customer_id, brand_id, computed_at: today + 'T06:00:00' }, p); delete row.due_task_at;
    if (prof) upd('customer_rebuy_profiles', prof.id, row); else prof = ins('customer_rebuy_profiles', row);
    let task = G.db.find('crm_tasks', t => t.task_type === 'REBUY' && t.customer_id === customer_id && t.brand_id === brand_id && t.status === 'OPEN');
    if (createTask && !task && p.due_task_at && p.status !== 'LOST') {
      const ch = G.db.find('messaging_channels', x => x.kind === 'WHATSAPP' && x.brand_id === brand_id); const ag = seller || (ch && (C.memberRows(ch.id).find(m => m.member_role !== 'SUPERVISOR') || {}).user_id);
      task = C.addTask({ task_type: 'REBUY', customer_id, brand_id, assigned_user_id: ag || null, due_at: p.due_task_at + 'T09:00:00', note: `Frecuencia ${G.fmt.num(p.median_interval_days, 1)} días · esperado ${G.fmt.date(p.next_expected_at)}` });
    }
    return { profile: G.db.get('customer_rebuy_profiles', prof.id), task };
  };
  C.rebuyRecompute = function (today = G.TODAY) {
    const groups = new Map();
    for (const o of G.db.all('sales_orders')) { if (!['DELIVERED', 'CLOSED'].includes(o.status) || !o.customer_id || o.customer_id === 'cu-VARIOS') continue; const k = o.customer_id + '|' + o.brand_id; let g = groups.get(k); if (!g) groups.set(k, g = { dates: [], seller: null, last: '' }); const d = (o.delivered_at || o.delivery_date || o.created_at).slice(0, 10); g.dates.push(d); if (d >= g.last) { g.last = d; if (o.seller_id) g.seller = o.seller_id; } }
    const existing = new Map(G.db.all('customer_rebuy_profiles').map(p => [p.customer_id + '|' + p.brand_id, p]));
    const openTasks = new Set(G.db.where('crm_tasks', t => t.task_type === 'REBUY' && t.status === 'OPEN').map(t => t.customer_id + '|' + t.brand_id));
    let n = 0;
    for (const [k, g] of groups) {
      const [cid, bid] = k.split('|'); const p = C.rebuyCompute(g.dates, today); const row = Object.assign({ customer_id: cid, brand_id: bid, computed_at: today + 'T06:00:00' }, p); const due = row.due_task_at; delete row.due_task_at;
      const ex = existing.get(k); if (ex) Object.assign(ex, row); else ins('customer_rebuy_profiles', row);
      if (due && p.status !== 'LOST' && G.date.diff(due, today) <= 7 && !openTasks.has(k)) { const sel = g.seller && (userRow(g.seller) || {}).role === 'VENDEDORA' ? g.seller : null; C.addTask({ task_type: 'REBUY', customer_id: cid, brand_id: bid, assigned_user_id: sel, due_at: due + 'T09:00:00', note: `Frecuencia ${G.fmt.num(p.median_interval_days, 1)} días · esperado ${G.fmt.date(p.next_expected_at)}` }); openTasks.add(k); }
      n++;
    }
    G.db.touch(); return n;
  };
  C.completeTask = function (id, result) { if (!String(result || '').trim()) G.fail('RN-CRM-19', 'Anota el resultado de la tarea.'); return upd('crm_tasks', id, { status: 'DONE', done_at: C.now(), result }); };
  /** RN-CRM-20: encuesta a las 2 h de la entrega, en ventana o como utilidad si no se agotó el cupo */
  C.scheduleSurvey = function (o, at) {
    if (G.db.find('delivery_surveys', s => s.order_id === o.id)) return null;
    const sendAt = addH(at || o.delivered_at || C.now(), G.param('crm_survey_delay_hours') ?? 2);
    let mode = 'NOT_SENT', cv = null; const link = G.db.find('conversation_orders', x => x.order_id === o.id); cv = link && conv(link.conversation_id);
    try {
      if (cv && C.windows(cv, sendAt).inService) { C.send(cv.id, { text: C.fill(C.surveyText, C.orderVars(o)), order_id: o.id, system: true, user_id: null, at: sendAt }); mode = 'SESSION'; }
      else if (C.utilityCount(o.id) < (G.param('crm_utility_templates_per_order') ?? 2)) { C.sendTemplate({ order_id: o.id, purpose: 'POST_DELIVERY_SURVEY', at: sendAt }); mode = 'TEMPLATE'; }
    } catch (e) { if (!(e instanceof G.RuleError)) throw e; }
    return ins('delivery_surveys', { order_id: o.id, customer_id: o.customer_id, seller_user_id: o.seller_id, brand_id: o.brand_id, sent_at: sendAt, send_mode: mode, answered_at: null });
  };
  C.surveyText = '¿Cómo te fue con tu pedido {{pedido}}? Califica del 1 al 5 la atención y el producto. ¿Recibiste lo que pediste?';
  C.answerSurvey = function (id, a, at) {
    const s = G.db.get('delivery_surveys', id); const when = at || C.now();
    upd('delivery_surveys', id, Object.assign({}, a, { answered_at: when }));
    if (a.received_as_ordered === false || a.bought_outside_catalog) C.addTask({ task_type: 'SURVEY_FOLLOW_UP', customer_id: s.customer_id, order_id: s.order_id, brand_id: s.brand_id, assigned_user_id: s.seller_user_id, due_at: addH(when, 24), note: a.received_as_ordered === false ? 'Respondió «no recibí lo que pedí»' : 'Respondió «compré algo que no está en la web»' });
    if (a.bought_outside_catalog) { const rule = G.db.find('control_alert_rules', r => r.rule_type === 'SURVEY_FLAG'); if (rule) { const link = G.db.find('conversation_orders', x => x.order_id === s.order_id); C.raiseAlert({ rule, matched: 'Compró algo que no está en la web', cv: link ? conv(link.conversation_id) : null, user_id: s.seller_user_id, excerpt: a.comments || 'Respuesta de la encuesta posentrega', at: when }); } }
    G.events.emit('survey.answered', { survey_id: id });
    return G.db.get('delivery_surveys', id);
  };
  C.weekStart = d => G.date.add(d.slice(0, 10), -(wd(d) - 1));
  C.reviewSample = function (week) {
    const from = G.date.add(week, -7); const by = {};
    const linked = new Set(G.db.all('conversation_orders').map(x => x.conversation_id));
    for (const cv of G.db.where('conversations', c => c.status === 'CLOSED' && c.closed_at && c.closed_at.slice(0, 10) >= from && c.closed_at.slice(0, 10) < week && !linked.has(c.id) && c.assigned_user_id)) (by[cv.assigned_user_id] = by[cv.assigned_user_id] || []).push(cv);
    const out = [];
    for (const [uid, list] of Object.entries(by)) {
      if ((userRow(uid) || {}).role !== 'VENDEDORA') continue;
      const size = Math.min(list.length, Math.max(G.param('crm_review_sample_min') ?? 3, Math.ceil(list.length * (G.param('crm_review_sample_pct') ?? 10) / 100)));
      const r = U.rng(T(week) / 86400000 + uid.length * 97); const pool = list.slice().sort((a, b) => a.id.localeCompare(b.id)); const pick = [];
      while (pick.length < size) pick.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
      out.push({ user_id: uid, universe: list.length, sample: pick });
    }
    return out;
  };
  C.recordReview = function (cvId, week, result, notes, by = me()) {
    if (!G.can('crm.review.perform', roleOf(by))) G.fail('RN-CRM-18', 'Tu rol no hace la revisión por muestreo (permiso crm.review.perform).');
    if (result !== 'OK' && !String(notes || '').trim()) G.fail('RN-CRM-18', 'Un resultado observado o incidente exige nota.');
    if (G.db.find('conversation_reviews', x => x.conversation_id === cvId && x.sample_week === week)) G.fail('RN-CRM-18', 'Esta conversación ya se revisó esta semana.');
    return ins('conversation_reviews', { conversation_id: cvId, reviewer_user_id: by, sample_week: week, result, notes: notes || null, reviewed_at: C.now() });
  };
  /** chats sin responder en horario (RN-CRM-14) y cola sin asignar (RN-CRM-02) */
  C.waitMins = (cv, at = C.now()) => cv.status !== 'CLOSED' && cv.last_inbound_at && (!cv.last_reply_at || cv.last_reply_at < cv.last_inbound_at) ? C.bizMinutes(cv.last_inbound_at, at) : 0;
  C.sweep = function (at = C.now()) {
    const lim = G.param('crm_unanswered_alert_minutes') ?? 15; const rule = G.db.find('control_alert_rules', r => r.rule_type === 'UNANSWERED_CHAT' && r.active !== false);
    for (const cv of G.db.where('conversations', c => c.status !== 'CLOSED' && c.last_inbound_at)) {
      if (cv.unanswered_flag_for === cv.last_inbound_at) continue;
      const m = C.waitMins(cv, at); if (m <= lim) continue;
      upd('conversations', cv.id, { unanswered_flag_for: cv.last_inbound_at });
      C.addTask({ task_type: 'UNANSWERED_CHAT', customer_id: cv.customer_id, lead_id: cv.lead_id, conversation_id: cv.id, brand_id: cv.brand_id, assigned_user_id: cv.assigned_user_id, due_at: at, note: `Sin respuesta desde ${hm(cv.last_inbound_at)} (${dur(m)} en horario)` });
      if (rule) C.raiseAlert({ rule, matched: `Sin respuesta ${dur(m)}`, cv, user_id: cv.assigned_user_id, excerpt: (G.db.where('conversation_messages', x => x.conversation_id === cv.id && x.direction === 'IN').pop() || {}).body, at });
    }
  };
  /** cobrado de un pedido según los cobros aplicados (respaldo si paid_amount no está al día) */
  C.paidOf = o => { let s2 = 0; for (const py of G.db.all('payments')) if (py.status === 'CONFIRMED') for (const a of py.allocations || []) if (a.order_id === o.id) s2 += a.amount; return R(Math.max(o.paid_amount || 0, s2)); };
  C.balanceOf = o => R(C.paidOf(o) - (o.final_total ?? o.estimated_total));
  C.frt = cv => cv.first_response_at ? C.bizMinutes(cv.opened_at, cv.first_response_at) : null;

  /* ---------- eventos consumidos (02-mapa §3); nunca rompen el flujo del emisor ---------- */
  const safe = fn => p => { try { fn(p); } catch (e) { if (!(e instanceof G.RuleError)) console.error(e); } };
  const crmOrder = id => { const o = G.db.get('sales_orders', id); return o && (o.origin_wa_number || G.db.find('conversation_orders', x => x.order_id === o.id)) ? o : null; };
  const sentPurpose = (o, purpose) => G.db.where('conversation_messages', m => m.order_id === o.id && m.template_id).some(m => (G.db.get('message_templates', m.template_id) || {}).purpose === purpose);
  G.events.on('order.confirmed', safe(p => { const o = crmOrder(p.order_id); if (o && !sentPurpose(o, 'ORDER_CONFIRMATION')) C.sendTemplate({ order_id: o.id, purpose: 'ORDER_CONFIRMATION' }); }));
  G.events.on('order.dispatched', safe(p => { const o = crmOrder(p.order_id); if (o && !sentPurpose(o, 'ORDER_DISPATCHED')) C.sendTemplate({ order_id: o.id, purpose: 'ORDER_DISPATCHED' }); }));
  G.events.on('order.weighed', safe(p => { if (!p.over) return; const o = crmOrder(p.order_id); const link = o && G.db.find('conversation_orders', x => x.order_id === o.id); const cv = link && conv(link.conversation_id); if (cv && C.windows(cv).inService) { const v = C.orderVars(o); C.send(cv.id, { text: `${v.cliente}, al pesar tu pedido ${v.pedido} el peso real fue ${v.peso_real} (estimado ${v.peso}). Nuevo total: ${G.fmt.money(o.final_total)}. ¿Continuamos?`, order_id: o.id, system: true, user_id: null }); } }));
  G.events.on('order.delivered', safe(p => { const o = G.db.get('sales_orders', p.order_id); if (o && o.customer_id && o.channel !== 'COUNTER') C.scheduleSurvey(o); }));

  /* =====================================================================
     Indicadores (TAB)
     ===================================================================== */
  const inP = (s, p) => !!s && s.slice(0, 10) >= p.from && s.slice(0, 10) <= p.to;
  const bOk = (r, p) => !p.brand || r.brand_id === p.brand;
  const delivDate = o => (o.delivered_at || o.delivery_date || o.created_at).slice(0, 10);
  G.kpiCalc['KPI-CRM-01'] = p => G.db.where('leads', l => inP(l.first_contact_at, p) && bOk(l, p)).length;
  G.kpiCalc['KPI-CRM-02'] = p => { const xs = G.db.where('conversations', c => inP(c.opened_at, p) && bOk(c, p) && c.first_response_at).map(C.frt); return { value: xs.length ? R(median(xs), 1) : 0, denominator: xs.length }; };
  G.kpiCalc['KPI-CRM-03'] = p => { const lim = G.param('crm_unanswered_alert_minutes') ?? 15; return G.db.where('conversations', c => bOk(c, p) && C.waitMins(c) > lim).length; };
  G.kpiCalc['KPI-CRM-04'] = p => { const ls = G.db.where('leads', l => inP(l.first_contact_at, p) && bOk(l, p)); const w = ls.filter(l => l.status === 'WON').length; return { value: ls.length ? R(w / ls.length * 100, 1) : 0, numerator: w, denominator: ls.length }; };
  G.kpiCalc['KPI-CRM-05'] = p => { const first = new Map(); for (const o of G.db.all('sales_orders')) if (['DELIVERED', 'CLOSED'].includes(o.status) && (!p.brand || o.brand_id === p.brand)) { const d = delivDate(o); if (!first.has(o.customer_id) || d < first.get(o.customer_id)) first.set(o.customer_id, d); } let n = 0; for (const d of first.values()) if (d >= p.from && d <= p.to) n++; return n; };
  G.kpiCalc['KPI-CRM-06'] = p => { const inp = new Set(), prev = new Set(); const pf = G.date.add(p.from, -90); for (const o of G.db.all('sales_orders')) { if (!['DELIVERED', 'CLOSED'].includes(o.status) || (p.brand && o.brand_id !== p.brand)) continue; const d = delivDate(o); if (d >= p.from && d <= p.to) inp.add(o.customer_id); else if (d >= pf && d < p.from) prev.add(o.customer_id); } const r = [...inp].filter(c => prev.has(c)).length; return { value: inp.size ? R(r / inp.size * 100, 1) : 0, numerator: r, denominator: inp.size }; };
  G.kpiCalc['KPI-CRM-07'] = p => { const by = U.groupBy(G.db.where('sales_orders', o => ['DELIVERED', 'CLOSED'].includes(o.status) && (!p.brand || o.brand_id === p.brand)), 'customer_id'); const m = G.date.month(p.from); let base = 0, back = 0; for (const os of Object.values(by)) { const ds = os.map(delivDate).sort(); if (G.date.month(ds[0]) !== m) continue; base++; if (ds.some(d => d > ds[0] && G.date.diff(d, ds[0]) <= 30)) back++; } return { value: base ? R(back / base * 100, 1) : 0, numerator: back, denominator: base, note: 'Recompra a 30 días' }; };
  G.kpiCalc['KPI-CRM-08'] = p => { const cost = U.sum(G.db.where('message_charges', x => inP(x.charged_at, p) && bOk(x, p)), x => x.amount); const n = G.db.where('sales_orders', o => o.channel === 'WHATSAPP' && ['DELIVERED', 'CLOSED'].includes(o.status) && inP(o.delivered_at || o.delivery_date, p) && bOk(o, p)).length; return { value: n ? R(cost / n, 4) : 0, numerator: R(cost, 4), denominator: n }; };
  G.kpiCalc['KPI-CRM-09'] = p => { const xs = G.db.where('delivery_surveys', s => s.answered_at && inP(s.answered_at, p) && bOk(s, p) && s.rating_service); return { value: xs.length ? R(U.sum(xs, s => s.rating_service) / xs.length, 2) : 0, denominator: xs.length }; };
  G.kpiCalc['KPI-CRM-10'] = p => G.db.where('control_alerts', a => a.status === 'CONFIRMED' && inP(a.reviewed_at, p) && bOk(a, p)).length;
  G.kpiCalc['KPI-CRM-11'] = p => G.db.where('customer_rebuy_profiles', x => x.status === 'LOST' && bOk(x, p)).length;
  G.kpiCalc['KPI-CRM-12'] = p => { const xs = G.db.where('customer_rebuy_profiles', x => ['ACTIVE', 'DUE', 'AT_RISK'].includes(x.status) && x.median_interval_days != null && bOk(x, p)).map(x => x.median_interval_days); return xs.length ? R(median(xs), 1) : 0; };
  G.kpiCalc['KPI-CRM-13'] = p => { const paid = new Map(); for (const py of G.db.all('payments')) if (py.status === 'CONFIRMED' && py.customer_id && (!p.brand || py.brand_id === p.brand)) paid.set(py.customer_id, (paid.get(py.customer_id) || 0) + py.amount); const custs = new Set(G.db.where('sales_orders', o => o.status !== 'CANCELLED' && (!p.brand || o.brand_id === p.brand)).map(o => o.customer_id)); let s = 0; for (const c of custs) s += paid.get(c) || 0; return { value: custs.size ? R(s / custs.size) : 0, numerator: R(s), denominator: custs.size }; };
  G.kpiCalc['KPI-CRM-14'] = p => { const linked = new Set(G.db.all('conversation_orders').map(x => x.conversation_id)); const cl = G.db.where('conversations', c => c.status === 'CLOSED' && inP(c.closed_at, p) && bOk(c, p)); const no = cl.filter(c => !linked.has(c.id)).length; return { value: cl.length ? R(no / cl.length * 100, 1) : 0, numerator: no, denominator: cl.length }; };
  C.salesBySeller = p => { const sellers = new Set(G.db.where('users', u => u.role === 'VENDEDORA').map(u => u.id)); const out = {}; for (const py of G.db.all('payments')) { if (py.status !== 'CONFIRMED' || !inP(py.paid_at, p)) continue; for (const a of py.allocations || []) { const o = a.order_id && G.db.get('sales_orders', a.order_id); if (o && sellers.has(o.seller_id) && bOk(o, p)) out[o.seller_id] = R((out[o.seller_id] || 0) + a.amount); } } return out; };
  G.kpiCalc['KPI-CRM-15'] = p => { const by = C.salesBySeller(p); return { value: R(U.sum(Object.values(by))), detail: Object.fromEntries(Object.entries(by).map(([k, v]) => [G.userShort(k), v])) }; };

  /* ---------- búsqueda y alertas globales ---------- */
  G.searchProviders.push(q => {
    if (!G.canSee('CRM')) return []; const n = norm(q); const d = digits(q); if (n.length < 3) return [];
    const out = [];
    for (const cv of C.visible(G.db.all('conversations'))) { const ct = G.db.get('channel_contacts', cv.contact_id) || {}; if (norm(C.contactName(cv)).includes(n) || (d.length >= 4 && digits(ct.phone || ct.external_user_id).includes(d)) || norm(ct.external_user_id).includes(n)) out.push({ label: 'Chat · ' + C.contactName(cv), sub: `${C.chLabel(chan(cv.channel_id))} · ${CSTATUS[cv.status][0]}`, go: () => G.go('CRM-02', { id: cv.id }) }); if (out.length >= 6) break; }
    for (const l of G.db.where('leads', l => norm(l.full_name).includes(n) || (d.length >= 4 && digits(l.phone).includes(d))).slice(0, 4)) out.push({ label: 'Lead · ' + (l.full_name || l.phone), sub: lbl(LSTATUS, l.status) + ' · ' + G.brandName(l.brand_id), go: () => G.go('CRM-05', { id: l.id }) });
    return out;
  });
  G.alertProviders.push(() => {
    if (!G.canSee('CRM')) return []; const out = [];
    if (G.can('crm.alert.review')) { const a = G.db.where('control_alerts', x => x.status === 'OPEN' && x.severity === 'HIGH' && G.scope.ok(x, { site: '_none' })); if (a.length) out.push({ module: 'CRM', title: `${a.length} alertas de control de gravedad alta`, detail: 'Vendedoras con frases, números o productos fuera del canal oficial (RN-CRM-15/16).', tone: 'bad', go: () => G.go('CRM-12') }); }
    const qlim = G.param('crm_unassigned_alert_minutes') ?? 5; const at = C.now();
    const q = C.visible(G.db.where('conversations', c => c.status !== 'CLOSED' && !c.assigned_user_id && c.queued_at && mins(at, c.queued_at) > qlim));
    if (q.length && G.can('crm.conversation.reassign')) out.push({ module: 'CRM', title: `${q.length} chat(s) en cola más de ${qlim} min`, detail: 'Nadie del número está en turno y en línea (RN-CRM-02).', tone: 'warn', go: () => G.go('CRM-06') });
    return out;
  });

  /* =====================================================================
     Datos de ejemplo (seed 24): canales, equipos, plantillas, reglas y
     conversaciones creíbles ligadas a clientes y pedidos reales del núcleo
     ===================================================================== */
  G.seed(24, function seedCRM() {
    const r = U.rng(2424);
    // correlativo de pedidos alineado con los pedidos sembrados por el núcleo (G.orders.create usa G.db.next('PED'))
    let maxN = 0; for (const o of G.db.all('sales_orders')) { const n = parseInt(String(o.number).slice(2), 10); if (n > maxN) maxN = n; }
    if ((G.db.seq['DG:PED'] || 0) < maxN) G.db.seq['DG:PED'] = maxN;
    const SUP = 'us-pleon';
    const NOTICE = b => `Hola, gracias por escribir a ${b}. Esta conversación queda registrada para atender tu pedido y mejorar el servicio (Ley 29733). Política de privacidad: donguando.com/privacidad. Para no recibir promociones responde BAJA.`;
    /* --- canales: modo de conexión oficial (RN-CRM-01) --- */
    for (const ch of G.db.all('messaging_channels')) {
      const b = G.brandName(ch.brand_id);
      Object.assign(ch, {
        connection_mode: ch.kind === 'WHATSAPP' ? 'CLOUD_API_COEXISTENCE' : ch.id === 'ch-tt-M5' ? 'NOT_AVAILABLE' : 'DM_API',
        external_id: ch.kind === 'WHATSAPP' ? 'PNID-' + digits(ch.number).slice(-6) + '1088' : ch.kind.toLowerCase() + '-' + ch.id.slice(-2).toLowerCase() + '-77120', display_phone: ch.kind === 'WHATSAPP' ? ch.number : null,
        waba_id: ch.kind === 'WHATSAPP' ? 'WABA-1098' + (ch.brand_id === 'br-DG' ? '01' : ch.brand_id.slice(-1) + '0') : null,
        assignment_mode: ch.id === 'ch-wa-0102' ? 'LEAST_OPEN' : 'SHIFT_ROUND_ROBIN', free_service_quota: ch.kind === 'WHATSAPP' ? (G.param('crm_wa_service_free_per_number') ?? 1000) : 0,
        auto_greeting: `¡Hola! Te atiende ${b}. En un momento una asesora te responde.`, recording_notice_text: NOTICE(b), synced_history_from: ch.kind === 'WHATSAPP' ? '2026-04-10' : null,
        connected_at: '2026-10-01T09:30:00', group_msgs_discarded: ch.kind === 'WHATSAPP' ? 3 + Math.floor(r() * 20) : 0, catalog_synced_at: ch.kind === 'WHATSAPP' ? '2026-10-10T06:00:00' : null, status: ch.id === 'ch-tt-M5' ? 'PAUSED' : 'ACTIVE',
      });
    }
    /* --- miembros, supervisora y turnos (D-CRM-03) --- */
    const SH = { 'us-atorres': [[1, 6, '10:00', '20:00']], 'us-bramos': [[1, 6, '08:00', '16:00']], 'us-cnunez': [[1, 6, '08:00', '18:00']], 'us-dflores': [[1, 5, '08:00', '17:00']], 'us-evargas': [[1, 6, '08:00', '20:00'], [7, 7, '09:00', '14:00']] };
    for (const m of G.db.all('channel_members')) {
      Object.assign(m, { member_role: 'AGENT', max_open_conversations: 25, active: true });
      for (const [a, b, f, t] of SH[m.user_id] || [[1, 6, '08:00', '20:00']]) for (let d = a; d <= b; d++) ins('channel_member_shifts', { member_id: m.id, weekday: d, time_from: f, time_to: t });
    }
    for (const ch of G.db.all('messaging_channels')) ins('channel_members', { id: `cm-${ch.id}-${SUP}`, channel_id: ch.id, user_id: SUP, role: 'SUPERVISOR', member_role: 'SUPERVISOR', max_open_conversations: 40, active: true, status: 'ACTIVE' });
    [['us-atorres', 'ONLINE', '09:58'], ['us-bramos', 'ONLINE', '08:01'], ['us-cnunez', 'ONLINE', '08:05'], ['us-evargas', 'ONLINE', '07:59'], [SUP, 'ONLINE', '08:10'], ['us-dflores', 'OFFLINE', '17:02']].forEach(([u, s, t]) => C.setAgentStatus(u, s, (u === 'us-dflores' ? '2026-10-09' : G.TODAY) + 'T' + t + ':00'));
    /* --- identificadores oficiales y reglas de control (RN-CRM-15/16) --- */
    [['YAPE', '+51987650001', 'Yape empresa (BCP)'], ['PLIN', '+51987650002', 'Plin empresa (Interbank)'], ['BANK_ACCOUNT', '193-2284719-0-55', 'BCP cuenta corriente soles'], ['BANK_ACCOUNT', '200-3001847722', 'Interbank cuenta corriente soles'], ['CCI', '00219300228471905518', 'CCI BCP'], ['EMAIL', 'ventas@donguando.pe', 'Correo de ventas'], ['URL', 'https://donguando.com', 'Tienda web'], ['PHONE', '+5112748800', 'Central Local 1']]
      .forEach(([t, v, l]) => ins('official_identifiers', { identifier_type: t, value: v, label: l, brand_id: null, status: 'ACTIVE' }));
    for (const ch of G.db.where('messaging_channels', c => c.kind === 'WHATSAPP')) ins('official_identifiers', { identifier_type: 'PHONE', value: ch.number, label: 'WhatsApp ' + ch.display_name, brand_id: ch.brand_id, status: 'ACTIVE' });
    [['CTL-01', 'KEYWORD', 'por fuera', 'MEDIUM', 'Venta por fuera'], ['CTL-02', 'KEYWORD', 'a mi número', 'HIGH', 'Deriva a su número'], ['CTL-03', 'KEYWORD', 'directo conmigo', 'HIGH', 'Trato directo'], ['CTL-04', 'KEYWORD', 'mi yape', 'HIGH', 'Yape personal'], ['CTL-05', 'KEYWORD', 'mi plin', 'HIGH', 'Plin personal'], ['CTL-06', 'KEYWORD', 'a mi cuenta', 'HIGH', 'Cuenta personal'],
      ['CTL-07', 'FOREIGN_PHONE', 'Celular de 9 dígitos fuera de la lista oficial y distinto al del cliente', 'HIGH', 'Celular ajeno'], ['CTL-08', 'FOREIGN_ACCOUNT', 'Cuenta de 13 a 20 dígitos fuera de la lista oficial', 'HIGH', 'Cuenta ajena'],
      ['CTL-09', 'OFF_CATALOG_TERM', 'lechón', 'MEDIUM', 'Lechón'], ['CTL-10', 'OFF_CATALOG_TERM', 'cabrito', 'MEDIUM', 'Cabrito'], ['CTL-11', 'OFF_CATALOG_TERM', 'pavo', 'MEDIUM', 'Pavo'], ['CTL-12', 'OFF_CATALOG_TERM', 'cecina', 'MEDIUM', 'Cecina'], ['CTL-13', 'OFF_CATALOG_TERM', 'codorniz', 'MEDIUM', 'Codorniz'],
      ['CTL-14', 'APP_DELETION', 'Mensaje borrado desde la app del celular de la empresa', 'HIGH', 'Borrado en el celular'], ['CTL-15', 'UNANSWERED_CHAT', 'Chat sin responder más de crm_unanswered_alert_minutes en horario', 'LOW', 'Chat sin responder'], ['CTL-16', 'SURVEY_FLAG', 'Encuesta: «compré algo que no está en la web»', 'HIGH', 'Compra fuera de la web']]
      .forEach(([code, t, p, s, n]) => ins('control_alert_rules', { id: 'car-' + code, code, rule_type: t, pattern: p, severity: s, name: n, applies_to: ['CHAT', 'CALL'], active: true }));
    /* --- plantillas por marca (RN-CRM-07) --- */
    const TPL = [
      ['confirmacion_pedido', 'UTILITY', 'ORDER_CONFIRMATION', 'APPROVED', 'Hola {{cliente}}, confirmamos tu pedido {{pedido}} de {{marca}}:\n{{productos}}\nPeso estimado: {{peso}} · Total estimado: {{total}}\nEntrega: {{direccion}} · {{fecha}} {{franja}}\nPaga con el enlace de la empresa {{enlace_pago}} o con Yape empresa {{yape}}. El monto final se ajusta al peso real.'],
      ['pedido_en_camino', 'UTILITY', 'ORDER_DISPATCHED', 'APPROVED', '{{cliente}}, tu pedido {{pedido}} de {{marca}} ya va en camino con {{repartidor}}. Llega entre {{franja}}. Sigue la entrega aquí: {{enlace_seguimiento}}'],
      ['diferencia_peso', 'UTILITY', 'WEIGHT_DIFFERENCE', 'APPROVED', '{{cliente}}, al pesar tu pedido {{pedido}} el peso real fue {{peso_real}} (estimado {{peso}}). El nuevo total es {{total}}. Responde SÍ para continuar o llámanos.'],
      ['encuesta_posentrega', 'UTILITY', 'POST_DELIVERY_SURVEY', 'APPROVED', '¿Cómo te fue con tu pedido {{pedido}}? Califica del 1 al 5 la atención y el producto, y dinos si recibiste lo que pediste.'],
      ['recordatorio_pago', 'UTILITY', 'PAYMENT_REQUEST', 'APPROVED', '{{cliente}}, tu pedido {{pedido}} está listo. Puedes pagar {{total}} con el enlace de la empresa {{enlace_pago}}.'],
      ['recompra_frecuente', 'MARKETING', 'REBUY', 'APPROVED', 'Hola {{cliente}}, ya toca tu pedido de {{marca}}. Esta semana tenemos producto fresco y delivery gratis desde 3 unidades. ¿Te separamos lo de siempre?'],
      ['promo_fin_de_semana', 'MARKETING', 'PROMOTION', 'PENDING', '{{cliente}}, este fin de semana 10 % de descuento en {{marca}} pidiendo por este WhatsApp. Válido hasta el domingo.'],
    ];
    for (const b of G.db.all('brands')) TPL.forEach(([n, c, p, s, body], i) => ins('message_templates', { id: `mt-${b.code}-${i + 1}`, brand_id: b.id, channel_id: null, name: n, language: 'es', category: c, purpose: p, body, variables: [...new Set((body.match(/\{\{(\w+)\}\}/g) || []).map(x => x.slice(2, -2)))], provider_template_id: s === 'APPROVED' ? 'HX' + b.code + (7710 + i) : null, provider_status: b.code === 'M3' && p === 'PROMOTION' ? 'REJECTED' : s, rejection_reason: b.code === 'M3' && p === 'PROMOTION' ? 'Meta: el texto promete un descuento sin condiciones claras' : null, submitted_at: '2026-09-25T10:00:00' }));
    /* --- respuestas rápidas --- */
    const QR = [['/delivery', 'Hacemos delivery en Surco, Miraflores, San Isidro, San Borja, La Molina, Barranco, Jesús María, Lince, Chorrillos, Lurín y Pachacámac. Es gratis desde 3 unidades o 3 kg; si no, de S/ 8 a S/ 14 según la zona.'], ['/pago', 'Puedes pagar con Yape empresa +51 987 650 001, Plin empresa +51 987 650 002 o con el enlace de pago que llega con tu resumen. No aceptamos pagos a cuentas personales.'], ['/peso', 'El cuy, el conejo y el pollo se cobran por peso real. Te enviamos el peso estimado y, si al pesar varía más de 10 %, te avisamos antes de despachar.'], ['/horario', 'Atendemos de lunes a sábado de 8:00 a 20:00 y domingos de 9:00 a 14:00. Franjas de entrega: 09:00–13:00, 13:00–17:00 y 17:00–20:00.'], ['/recojo', 'Puedes recoger en el Local 1: Av. Los Próceres 1240, Santiago de Surco, de 9:00 a 19:00.'], ['/provincia', 'Enviamos a provincia por agencia (Andinos Cargo) los martes y viernes; el flete se paga en destino.']];
    for (const b of G.db.all('brands')) QR.forEach(([s, body]) => ins('quick_replies', { brand_id: b.id, owner_user_id: null, shortcut: s, body, status: 'ACTIVE' }));
    ins('quick_replies', { brand_id: null, owner_user_id: 'us-atorres', shortcut: '/gracias', body: 'Gracias por tu compra. Cualquier consulta escríbenos por aquí.', status: 'ACTIVE' });

    /* --- conversaciones a partir de los pedidos reales (6–10 de octubre) --- */
    const chFor = o => o.channel === 'WHATSAPP' ? G.db.find('messaging_channels', c => c.number === o.origin_wa_number) : o.brand_id !== 'br-DG' ? null : o.channel === 'TIKTOK' ? chan('ch-tt-DG') : o.channel === 'FACEBOOK' ? chan('ch-fb-DG') : o.channel === 'INSTAGRAM' ? chan('ch-ig-DG') : null;
    const handle = c => '@' + norm(c.full_name.split(' ')[0]) + '.' + c.id.slice(-3);
    const priceTxt = l => `${G.fmt.money(l.unit_price)} ${l.price_basis === 'KG' ? 'el kg' : 'c/u'}`;
    const PAYTXT = { 'pm-YAPE': 'Pago con Yape', 'pm-PLIN': 'Pago con Plin', 'pm-CASH': 'Pago en efectivo al recibir', 'pm-CARD': 'Con tarjeta al recibir, por favor', 'pm-TRANSFER': 'Hago transferencia', 'pm-MP': 'Con el enlace de pago' };
    const reserved = new Set(['cu-0012', 'cu-0031', 'cu-0045', 'cu-0066', 'cu-0090', 'cu-0101', 'cu-0150', 'cu-0201', 'cu-0033', 'cu-0120']);
    const say = (cv, uid, text, at, extra) => C.send(cv.id, Object.assign({ text, user_id: uid, system: true, at }, extra || {}));
    function fromOrder(o) {
      const ch = chFor(o); const c = G.db.get('customers', o.customer_id); if (!ch || !c || !c.phone || reserved.has(c.id)) return;
      const members = C.memberRows(ch.id).filter(m => m.member_role !== 'SUPERVISOR').map(m => m.user_id);
      const seller = members.includes(o.seller_id) ? o.seller_id : members[0]; if (!seller) return;
      const today = o.created_at.slice(0, 10) === G.TODAY;
      let t = addM(o.created_at.slice(0, 16), -24); if (today && t > G.TODAY + 'T15:40') t = addM(G.TODAY + 'T15:00', -Math.floor(r() * 300));
      const ad = o.origin_ad_code && C.adByCode(o.origin_ad_code); const ctwa = ch.kind === 'WHATSAPP' && ad && ad.platform === 'META' && /CT/.test(ad.code);
      const l0 = o.lines[0]; const v0 = G.variant(l0.variant_id); const when = o.delivery_date === o.created_at.slice(0, 10) ? 'hoy' : 'mañana';
      const want = o.lines.map(l => `${l.price_basis === 'KG' && G.variant(l.variant_id).sale_mode === 'KG' ? G.fmt.kg(l.qty, 1) : l.qty} de ${G.variantName(l.variant_id).toLowerCase()}`).join(' y ');
      const first = (ad && !ctwa ? `Hola, vi su anuncio ${ad.code}. ` : 'Hola, buenas. ') + `Quisiera ${want} para ${when}.`;
      const isFirst = c.first_order_at === o.created_at && o.created_at >= '2026-10-01';
      const rec = C.receive({ channel_id: ch.id, from: ch.kind === 'WHATSAPP' ? c.phone : handle(c), name: c.full_name, customer_id: c.id, text: first, at: t + ':00', referral: ctwa ? { ad_code: ad.code, source_type: 'ad', headline: ad.name } : null, assignTo: seller, asLead: isFirst });
      const cv = rec.conversation; const a = o.address_id && G.db.get('customer_addresses', o.address_id);
      t = addM(t, 2 + Math.floor(r() * 5)); say(cv, seller, `¡Hola ${c.full_name.split(' ')[0]}! Claro que sí. ${v0.name} está a ${priceTxt(l0)}${v0.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? ` (aprox. ${G.fmt.kg(v0.nominal_weight_kg, 1)} c/u, se cobra el peso real)` : ''}. ¿A qué dirección lo enviamos?`, t + ':00');
      t = addM(t, 3 + Math.floor(r() * 6)); C.receive({ channel_id: ch.id, from: ch.kind === 'WHATSAPP' ? c.phone : handle(c), text: o.fulfillment === 'PICKUP' ? 'Paso a recoger al local.' : a ? `A ${a.address_line}. ${a.reference}.` : 'A la dirección de siempre.', at: t + ':00' });
      t = addM(t, 2 + Math.floor(r() * 4)); say(cv, seller, `Perfecto. Te lo llevamos ${when} en la franja ${o.slot_from || '13:00'}–${o.slot_to || '17:00'}. ¿Cómo deseas pagar?`, t + ':00');
      t = addM(t, 2 + Math.floor(r() * 8)); C.receive({ channel_id: ch.id, from: ch.kind === 'WHATSAPP' ? c.phone : handle(c), text: PAYTXT[o.payment_method_id] || 'Pago al recibir', at: t + ':00' });
      const conv2 = conv(cv.id); const lead = conv2.lead_id && G.db.get('leads', conv2.lead_id);
      if (!conv2.customer_id) { upd('conversations', cv.id, { customer_id: c.id }); upd('channel_contacts', conv2.contact_id, { customer_id: c.id }); }
      C.linkOrder(conv(cv.id), o, lead, isFirst, t + ':00');
      t = addM(t, 2 + Math.floor(r() * 3));
      if (o.status !== 'DRAFT') {
        if (ch.kind === 'WHATSAPP') C.send(cv.id, { template_id: C.templateFor(cv.brand_id, 'ORDER_CONFIRMATION').id, vars: C.orderVars(o), order_id: o.id, user_id: seller, system: true, at: t + ':00' });
        else say(cv, seller, `Listo, pedido ${o.number} registrado: total estimado ${G.fmt.money(o.estimated_total)}. Paga con el enlace de la empresa https://mpago.la/dg-${o.number.toLowerCase()}`, t + ':00', { order_id: o.id });
        if (r() < 0.7) { C.receive({ channel_id: ch.id, from: ch.kind === 'WHATSAPP' ? c.phone : handle(c), text: U.pick(r, ['Listo, gracias.', 'Ya pagué, te mando la captura.', 'Perfecto, gracias.', 'Ok, quedo atenta.']), at: addM(t, 4) + ':00' }); say(cv, seller, U.pick(r, ['¡Gracias a ti! Cualquier cosa nos escribes.', 'Recibido, gracias.', 'Perfecto, quedamos así.']), addM(t, 6) + ':00'); t = addM(t, 6); }
      }
      if (ch.kind === 'WHATSAPP' && ['IN_ROUTE', 'DELIVERED', 'CLOSED'].includes(o.status) && o.delivered_at) { let tt = addM(o.delivered_at.slice(0, 16), -35); if (today && tt > G.TODAY + 'T16:20') tt = G.TODAY + 'T16:20'; C.send(cv.id, { template_id: C.templateFor(cv.brand_id, 'ORDER_DISPATCHED').id, vars: C.orderVars(o), order_id: o.id, user_id: null, system: true, at: (tt < t ? addM(t, 30) : tt) + ':00' }); }
      if (!today && o.status !== 'DRAFT') C.close(cv.id, 'ORDER_CREATED', (o.delivered_at ? addM(o.delivered_at.slice(0, 16), 30) : addM(t, 60)) + ':00');
      else if (!today) C.close(cv.id, 'NO_PURCHASE', addM(t, 120) + ':00');
    }
    const ordersSeed = G.db.where('sales_orders', o => o.created_at >= '2026-10-06' && ['WHATSAPP', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM'].includes(o.channel) && o.seller_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const o of ordersSeed) fromOrder(o);

    /* --- conversaciones sin compra (leads), 28/09 al 09/10, para leads y muestreo --- */
    const NAMES = ['Karen Salas', 'Diego Huamán', 'Rocío Medina', 'Óscar Tello', 'Fiorella Ruiz', 'Iván Luna', 'Gisela Ponce', 'Renato Vega', 'Yesenia Ríos', 'Bruno Arce', 'Lorena Sáenz', 'Kevin Chuquispuma'];
    const ASK = [['¿Cuánto está el cuy entero? ¿Llegan a Ate?', 'El cuy entero está a S/ 42 el kg. Por ahora no llegamos a Ate; sí a Surco, La Molina y San Borja.', 'OUT_OF_ZONE'], ['¿Tienen pavo para Navidad?', 'No trabajamos pavo; tenemos pato entero y pollo de corral.', 'PRODUCT_NOT_OFFERED'], ['Precio del conejo entero', 'El conejo entero está a S/ 32 el kg (aprox. 1,6 kg).', 'PRICE'], ['¿Hacen envíos hoy mismo?', 'Hoy ya cerró la franja de la tarde; podemos llevarlo mañana de 09:00 a 13:00.', 'DELIVERY_TIME'], ['Hola, info del caldo de huesos', 'El caldo de huesos de 1 L está a S/ 18 y el de cuy de 500 ml a S/ 14.', 'NO_RESPONSE'], ['¿Venden al por mayor para restaurante?', 'Sí, tenemos lista para restaurantes. ¿Me compartes tu RUC y el volumen semanal?', null]];
    const waCh = G.db.where('messaging_channels', c => c.kind === 'WHATSAPP');
    let k = 0;
    for (let d = '2026-09-28'; d <= '2026-10-09'; d = G.date.add(d, 1)) {
      if (wd(d) === 7) continue;
      for (let i = 0; i < 6; i++) {
        const ch = waCh[(k + i) % waCh.length]; const members = C.memberRows(ch.id).filter(m => m.member_role !== 'SUPERVISOR').map(m => m.user_id); if (!members.length) continue;
        const seller = members[(k + i) % members.length]; const [q, ans, lost] = ASK[(k * 7 + i) % ASK.length]; const nm = NAMES[(k + i) % NAMES.length];
        const t = `${d}T${String(9 + Math.floor(r() * 9)).padStart(2, '0')}:${String(Math.floor(r() * 50)).padStart(2, '0')}`;
        const phone = '+519' + String(40000000 + Math.floor(r() * 59999999));
        const rec = C.receive({ channel_id: ch.id, from: phone, name: nm, text: (r() < 0.3 ? `Vi el anuncio ${U.pick(r, G.db.where('ad_ads', a => a.brand_id === ch.brand_id)).code}. ` : '') + q, at: t + ':00', assignTo: seller });
        say(rec.conversation, seller, ans, addM(t, 3 + Math.floor(r() * 9)) + ':00');
        if (rec.lead) { const ld = G.db.get('leads', rec.lead.id); const recent = d >= '2026-10-08'; if (!recent) upd('leads', ld.id, lost ? { status: 'LOST', lost_reason: lost } : { status: 'QUALIFIED' }); }
        C.close(rec.conversation.id, lost === 'NO_RESPONSE' ? 'INACTIVE' : lost ? 'NO_PURCHASE' : 'INFO_ONLY', addM(t, 180) + ':00');
        k++;
      }
    }

    /* --- conversaciones de hoy escritas a mano (casos del día) --- */
    const cu = id => G.db.get('customers', id); const fn = id => cu(id).full_name.split(' ')[0];
    const IN = (ch, from, text, at, x) => C.receive(Object.assign({ channel_id: ch, from, text, at: G.TODAY + 'T' + at + ':00' }, x || {}));
    const OUT = (cv, uid, text, at, x) => say(cv, uid, text, G.TODAY + 'T' + at + ':00', x);
    // H1 · Ana · DG Ventas 1 · anuncio clic a WhatsApp (ventana 72 h)
    let c1 = cu('cu-0012'); let ad1 = G.db.get('ad_ads', 'ad-DG-META-CTWA-1');
    let h1 = IN('ch-wa-0101', c1.phone, 'Hola! Vi la promo del cuy entero. ¿Para hoy en la tarde llegan a Surco?', '15:52', { name: c1.full_name, referral: { ad_code: ad1 ? ad1.code : 'DGMCT1', source_type: 'ad', headline: 'Cuy entero de granja' }, assignTo: 'us-atorres' }).conversation;
    OUT(h1, 'us-atorres', `¡Hola ${fn('cu-0012')}! Sí, hoy tenemos la franja de 17:00 a 20:00 en Surco. El cuy entero está a S/ 42 el kg (aprox. 0,9 kg c/u). ¿Cuántos te separo?`, '15:55');
    IN('ch-wa-0101', c1.phone, 'Dos cuyes y un caldo de huesos de 1 litro', '16:02');
    OUT(h1, 'us-atorres', 'El cuy, el conejo y el pollo se cobran por peso real. Te enviamos el peso estimado y, si al pesar varía más de 10 %, te avisamos antes de despachar.', '16:04');
    IN('ch-wa-0101', c1.phone, 'Ok. ¿El delivery cuánto es?', '16:10');
    OUT(h1, 'us-atorres', `Con 3 productos el delivery es gratis. ¿Te lo envío a ${(G.db.find('customer_addresses', a => a.customer_id === 'cu-0012') || {}).address_line || 'tu dirección'} como la última vez?`, '16:12');
    IN('ch-wa-0101', c1.phone, 'Sí, a la misma dirección. Pago con Yape.', '16:20');
    // H2 · lead nuevo con código de anuncio DG-A12 (asignación automática)
    IN('ch-wa-0101', '+51912345678', 'Buenas tardes, vi el anuncio DG-A12 del cuy al horno. ¿Hacen delivery a La Molina?', '16:08', { name: 'Mariela Ccori' });
    // H3 · Betty · DG Ventas 2 · caso real de control: producto que no vendemos y cobro a Yape personal
    const c3 = cu('cu-0031');
    const h3 = IN('ch-wa-0102', c3.phone, 'Hola, ¿tienen lechón para el sábado 17? Es para un cumpleaños, unas 25 personas.', '11:40', { name: c3.full_name, assignTo: 'us-bramos' }).conversation;
    OUT(h3, 'us-bramos', `Hola ${fn('cu-0031')}, sí, sí tenemos lechón al horno entero para el sábado, te sale S/ 380 con papas y ensalada.`, '11:46');
    IN('ch-wa-0102', c3.phone, 'Ya, ¿y cómo pago? ¿Al Yape de Don Guando?', '11:50');
    const bad = OUT(h3, 'us-bramos', 'Ese pedido mejor lo coordinamos directo conmigo porque es aparte. Escríbeme a mi número 945 118 270 y me yapeas a mi yape, así te sale más barato por fuera.', '11:53', { origin: 'BUSINESS_APP' });
    C.appDeleted(bad.id, G.TODAY + 'T11:58:00');
    IN('ch-wa-0102', c3.phone, 'Listo, te escribo a tu número.', '12:01');
    OUT(h3, 'us-bramos', 'Ok', '12:02', { origin: 'BUSINESS_APP' });
    C.close(h3.id, 'INFO_ONLY', G.TODAY + 'T12:05:00');
    // H4 · Carla · Marca 2 · pedido creado desde el chat y confirmado
    const c4 = cu('cu-0045');
    const h4 = IN('ch-wa-0201', c4.phone, 'Hola, quiero bondiola para parrilla, como kilo y medio, para mañana al mediodía.', '10:12', { name: c4.full_name, assignTo: 'us-cnunez' }).conversation;
    OUT(h4, 'us-cnunez', `Hola ${fn('cu-0045')}, la bondiola está a S/ 38 el kg; te la cortamos gruesa para parrilla. ¿La enviamos a tu dirección registrada?`, '10:15');
    IN('ch-wa-0201', c4.phone, 'Sí, porfa. Pago con Yape.', '10:21');
    try {
      const rs = C.createOrder(h4.id, { system: true, user_id: 'us-cnunez', at: G.TODAY + 'T10:24:00', delivery_date: G.date.add(G.TODAY, 1), slot_id: (G.db.find('customer_addresses', a => a.customer_id === 'cu-0045') || {}).zone_id && G.db.get('delivery_zones', G.db.find('customer_addresses', a => a.customer_id === 'cu-0045').zone_id).establishment_id === 'es-L2' ? 'ts-L2-1' : 'ts-L1-1', payment_method_id: 'pm-YAPE', notes: 'Cortes gruesos para parrilla', lines: [{ variant_id: 'va-M2-BON-KG', qty: 1.5, est_weight_kg: 1.5, cut_notes: 'Cortes de 3 cm' }] });
      try { G.orders.transition(rs.order, 'CONFIRMED', { user: 'Carla Núñez Pinto', at: G.TODAY + 'T10:30:00' }); } catch (e) { }
      IN('ch-wa-0201', c4.phone, 'Listo, ya yapeé al número de la empresa.', '10:33');
      OUT(h4, 'us-cnunez', 'Recibido, gracias. Mañana te llega entre 09:00 y 13:00.', '10:35');
    } catch (e) { console.error('Seed CRM H4', e); }
    // H5 · Marca 4 · cola sin asignar (Diana desconectada, nadie en turno)
    IN('ch-wa-0401', '+51955221144', 'Hola, ¿tienen manteca de cerdo en presentación de 1 kg? Es para mi panadería.', '16:21', { name: 'Panadería Santa Rosa' });
    // H6 · Elena · Marca 5 · nota de voz con transcripción, ubicación, mensaje borrado por el cliente y catálogo
    const c6 = cu('cu-0066');
    const h6 = IN('ch-wa-0501', c6.phone, null, '09:31', { name: c6.full_name, msg_type: 'AUDIO', media: { duration_s: 14 }, transcript: 'Hola, quería dos cafés en grano de medio kilo y una mermelada de aguaymanto para mañana en la tarde.', assignTo: 'us-evargas' }).conversation;
    const del6 = IN('ch-wa-0501', c6.phone, 'perdón, era para otra persona', '09:33').message; C.customerDeleted(del6.id, G.TODAY + 'T09:34:00');
    IN('ch-wa-0501', c6.phone, null, '09:36', { msg_type: 'LOCATION', media: { lat: -12.0901, lng: -76.9712, label: 'Av. Primavera 1050, San Borja' } });
    OUT(h6, 'us-evargas', 'Café en grano 500 g · S/ 55,00 c/u · Marca 5 Gourmet', '09:40', { msg_type: 'PRODUCT' });
    OUT(h6, 'us-evargas', null, '09:42', { msg_type: 'AUDIO', media: { duration_s: 11 }, transcript: 'Hola, sí tenemos los dos cafés y la mermelada. Te lo enviamos mañana de 13:00 a 17:00, el delivery es gratis desde tres productos.' });
    IN('ch-wa-0501', c6.phone, 'Perfecto, mañana pago con Plin.', '09:50');
    OUT(h6, 'us-evargas', 'Anotado. En un momento te mando el resumen con el enlace de pago.', '09:52');
    // H7 · TikTok · Ana (48 h, máximo 10 seguidos)
    const h7 = IN('ch-tt-DG', '@luchito.parrillero', 'Cuánto está el cuy? lo vi en su video', '14:02', { name: 'Luis Parrillero', assignTo: 'us-atorres' }).conversation;
    OUT(h7, 'us-atorres', 'Hola, el cuy entero beneficiado está a S/ 42 el kg (aprox. 0,9 kg c/u).', '14:05');
    OUT(h7, 'us-atorres', 'Para pedir escríbenos al WhatsApp de Don Guando Ventas 1, +51 987 650 101, y te atendemos con el código TT-C07.', '14:06');
    IN('ch-tt-DG', '@luchito.parrillero', 'ya les escribo', '14:30');
    OUT(h7, 'us-atorres', 'Perfecto, te esperamos.', '14:31');
    // H8 · Messenger fuera de ventana (no admite plantillas)
    const c8 = cu('cu-0101');
    const h8 = C.receive({ channel_id: 'ch-fb-DG', from: 'fb.' + c8.id, name: c8.full_name, customer_id: c8.id, text: '¿Hacen delivery a Barranco los domingos?', at: '2026-10-08T11:20:00', assignTo: 'us-evargas' }).conversation;
    say(h8, 'us-evargas', 'Hola, los domingos repartimos de 09:00 a 14:00 en Barranco. ¿Te ayudo con un pedido?', '2026-10-08T11:31:00'); upd('conversations', h8.id, { status: 'PENDING' });
    // H9 · Instagram · Elena
    const h9 = IN('ch-ig-DG', '@sofi.cocina', '¿Tienen conejo trozado? ¿precio?', '13:10', { name: 'Sofía Cocina', assignTo: 'us-evargas' }).conversation;
    OUT(h9, 'us-evargas', 'Sí, el conejo trozado está a S/ 34 el kg, en bandejas de 1 kg aprox.', '13:14');
    IN('ch-ig-DG', '@sofi.cocina', 'Gracias, lo pienso y les escribo', '13:20');
    OUT(h9, 'us-evargas', 'Claro, aquí estamos.', '13:21');
    // H10 · DG Ventas 1 fuera de ventana (solo plantilla) con consentimiento de marketing
    const c10 = cu('cu-0150');
    const h10 = C.receive({ channel_id: 'ch-wa-0101', from: c10.phone, name: c10.full_name, text: 'Gracias, todo llegó bien. Muy rico el cuy.', at: '2026-10-08T19:40:00', assignTo: 'us-atorres' }).conversation;
    say(h10, 'us-atorres', '¡Qué bueno! Gracias por tu compra.', '2026-10-08T19:43:00'); upd('conversations', h10.id, { status: 'PENDING' });
    C.recordConsent({ customer_id: c10.id, contact_id: h10.contact_id, purpose: 'MARKETING', granted: true, channel: 'WHATSAPP', evidence_text: 'Respondió «SÍ, quiero recibir promociones» al aviso de registro (15/09)', brand_id: 'br-DG', at: '2026-09-15T12:00:00' });
    // H11 · DG Ventas 2 · baja de marketing (Ley 29733)
    const c11 = cu('cu-0201');
    const h11 = C.receive({ channel_id: 'ch-wa-0102', from: c11.phone, name: c11.full_name, text: 'Hola, ¿el pollo de corral viene limpio?', at: '2026-10-09T09:40:00', assignTo: 'us-evargas' }).conversation;
    C.recordConsent({ customer_id: c11.id, contact_id: h11.contact_id, purpose: 'MARKETING', granted: true, channel: 'WHATSAPP', evidence_text: 'Aceptó promociones en el formulario web (20/09)', brand_id: 'br-DG', at: '2026-09-20T10:00:00' });
    say(h11, 'us-evargas', 'Sí, viene limpio y sin vísceras.', '2026-10-09T09:46:00');
    C.send(h11.id, { template_id: 'mt-DG-6', vars: { cliente: fn('cu-0201'), marca: 'Don Guando' }, user_id: SUP, system: true, at: '2026-10-09T10:00:00' });
    C.receive({ channel_id: 'ch-wa-0102', from: c11.phone, text: 'BAJA', at: '2026-10-09T10:12:00' });
    say(h11, 'us-evargas', 'Listo, ya no te enviaremos promociones. Seguimos atentos a tus pedidos.', '2026-10-09T10:14:00');
    C.close(h11.id, 'INFO_ONLY', '2026-10-09T12:00:00');
    // H12 · Marca 3 · Carla
    const c12 = cu('cu-0090');
    const h12 = IN('ch-wa-0301', c12.phone, '¿El chorizo parrillero viene congelado o fresco?', '15:30', { name: c12.full_name, assignTo: 'us-cnunez' }).conversation;
    OUT(h12, 'us-cnunez', 'Viene fresco, refrigerado, y dura 21 días cerrado. El de 1 kg está a S/ 44.', '15:33');
    IN('ch-wa-0301', c12.phone, 'Ok, ¿y la salchicha huachana?', '16:05');
    // historial de control: una alerta confirmada y una descartada la semana pasada
    const h13 = C.receive({ channel_id: 'ch-wa-0102', from: cu('cu-0033').phone, name: cu('cu-0033').full_name, text: '¿Cómo les pago el pedido de mañana?', at: '2026-09-29T10:02:00', assignTo: 'us-bramos' }).conversation;
    say(h13, 'us-bramos', 'Si quieres me pasas a mi yape y yo lo registro.', '2026-09-29T10:05:00', { origin: 'BUSINESS_APP' });
    C.close(h13.id, 'NO_PURCHASE', '2026-09-29T12:00:00');
    for (const a of G.db.where('control_alerts', x => x.conversation_id === h13.id)) upd('control_alerts', a.id, { status: 'CONFIRMED', reviewed_by: SUP, reviewed_at: '2026-09-29T15:00:00', resolution_note: 'Se habló con la vendedora: primera llamada de atención por escrito. Se le recordó la política de cobro solo a cuentas de la empresa.' });
    const h14 = C.receive({ channel_id: 'ch-wa-0101', from: cu('cu-0120').phone, name: cu('cu-0120').full_name, text: '¿El cuy llega con hielo?', at: '2026-10-03T11:00:00', assignTo: 'us-evargas' }).conversation;
    say(h14, 'us-evargas', 'Llega en caja isotérmica con gel refrigerante; el gel va por fuera de la bolsa al vacío.', '2026-10-03T11:04:00');
    C.close(h14.id, 'INFO_ONLY', '2026-10-03T13:00:00');
    for (const a of G.db.where('control_alerts', x => x.conversation_id === h14.id)) upd('control_alerts', a.id, { status: 'DISMISSED', reviewed_by: SUP, reviewed_at: '2026-10-03T16:20:00', resolution_note: 'Falso positivo: «por fuera» se refiere al empaque del gel, no a una venta.' });

    /* --- etiquetas y notas internas --- */
    upd('conversations', h1.id, { tags: ['Cliente frecuente', 'Anuncio'] }); upd('conversations', h3.id, { tags: ['Evento'], internal_notes: [{ at: G.TODAY + 'T12:20:00', user_id: SUP, text: 'Revisar con gerencia: ofreció lechón (no lo vendemos) y cobro a Yape personal.' }] });
    upd('conversations', h6.id, { tags: ['Recompra'] });

    /* --- encuestas posentrega (pedidos entregados 7–9 oct) --- */
    const delivered = G.db.where('sales_orders', o => ['DELIVERED', 'CLOSED'].includes(o.status) && o.delivered_at && o.delivered_at >= '2026-10-07' && o.delivered_at < G.TODAY && o.customer_id !== 'cu-VARIOS' && o.channel !== 'B2B');
    let betty = false;
    for (const o of delivered.slice(0, 70)) {
      const s = ins('delivery_surveys', { order_id: o.id, customer_id: o.customer_id, seller_user_id: o.seller_id, brand_id: o.brand_id, sent_at: addH(o.delivered_at.slice(0, 16), 2), send_mode: r() < 0.6 ? 'SESSION' : 'TEMPLATE', answered_at: null });
      if (r() < 0.72) {
        const rs = r() < 0.08 ? 2 : r() < 0.25 ? 4 : 5; const flagB = !betty && o.seller_id === 'us-bramos';
        Object.assign(s, { answered_at: addH(s.sent_at, 1), rating_service: flagB ? 3 : rs, rating_product: flagB ? 4 : Math.max(3, rs - (r() < 0.2 ? 1 : 0)), received_as_ordered: flagB ? true : r() > 0.04, bought_outside_catalog: flagB, comments: flagB ? 'La vendedora me ofreció lechón y le pagué aparte a su Yape; eso no está en la web.' : rs <= 2 ? 'El pedido llegó tarde y el pollo pesó menos.' : U.pick(r, ['Todo muy bien', 'Muy rico, gracias', 'Llegó a tiempo', null]) });
        if (flagB) { betty = true; C.answerSurvey(s.id, { rating_service: 3, rating_product: 4, received_as_ordered: true, bought_outside_catalog: true, comments: s.comments }, s.answered_at); }
        else if (s.received_as_ordered === false) C.addTask({ task_type: 'SURVEY_FOLLOW_UP', customer_id: s.customer_id, order_id: s.order_id, brand_id: s.brand_id, assigned_user_id: s.seller_user_id, due_at: addH(s.answered_at, 24), note: 'Respondió «no recibí lo que pedí»' });
      }
    }
    /* --- recompra, revisión de la semana pasada, tareas varias y barrido --- */
    C.rebuyRecompute(G.TODAY);
    const lastWeek = C.weekStart(G.TODAY);
    const sample = C.reviewSample(lastWeek); let nrev = 0;
    for (const s of sample) for (const cv of s.sample.slice(0, 2)) { ins('conversation_reviews', { conversation_id: cv.id, reviewer_user_id: SUP, sample_week: lastWeek, result: nrev % 4 === 3 ? 'OBSERVED' : 'OK', notes: nrev % 4 === 3 ? 'No ofreció alternativa (pato o pollo de corral) cuando el cliente pidió un producto que no vendemos.' : null, reviewed_at: G.TODAY + 'T09:' + String(10 + nrev).padStart(2, '0') + ':00' }); nrev++; }
    C.addTask({ task_type: 'CALLBACK', customer_id: 'cu-0012', brand_id: 'br-DG', assigned_user_id: 'us-atorres', due_at: G.TODAY + 'T17:30:00', note: 'Pidió que la llamen para coordinar un pedido grande para el domingo' });
    C.addTask({ task_type: 'FOLLOW_UP', customer_id: 'cu-0066', conversation_id: h6.id, brand_id: 'br-M5', assigned_user_id: 'us-evargas', due_at: G.TODAY + 'T18:00:00', note: 'Enviar resumen con enlace de pago del café y la mermelada' });
    C.addTask({ task_type: 'ALERT_REVIEW', conversation_id: h3.id, brand_id: 'br-DG', assigned_user_id: SUP, due_at: G.TODAY + 'T18:00:00', note: 'Revisar alertas de Betty Ramos (lechón y Yape personal)' });
    C.sweep(SEED_NOW);
  }, 'crm');

  /* =====================================================================
     Pruebas de aceptación (una por CA-CRM-*)
     ===================================================================== */
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const throwsCode = (fn, code) => { try { fn(); } catch (e) { if (String(e.message).startsWith(code)) return e.message; throw new Error(`Se esperaba ${code} y salió: ${e.message}`); } throw new Error(`Se esperaba el rechazo ${code} y no hubo error.`); };
  const TT = (name, fn) => G.tests.push({ module: 'CRM', name, fn });
  /** número de prueba con 3 vendedoras en turno todo el día */
  function testChannel(id, brand, members) {
    const ch = G.db.insert('messaging_channels', { id, kind: 'WHATSAPP', brand_id: brand, number: '+5198765' + id.slice(-4), display_name: 'Don Guando · Ventas 1 (prueba)', coexistence: true, provider: 'CLOUD_API', connection_mode: 'CLOUD_API_COEXISTENCE', assignment_mode: 'SHIFT_ROUND_ROBIN', free_service_quota: 1000, status: 'ACTIVE' }, { silent: true });
    for (const u of members) { const m = ins('channel_members', { channel_id: ch.id, user_id: u, member_role: 'AGENT', max_open_conversations: 25, active: true }); for (let d = 1; d <= 7; d++) ins('channel_member_shifts', { member_id: m.id, weekday: d, time_from: '00:00', time_to: '23:59' }); }
    return ch;
  }
  TT('CA-CRM-01: dos chats nuevos van a B (sin chats) y luego a A (recibió hace 1 h); C desconectada no recibe', async () => {
    const at = G.TODAY + 'T15:00:00'; const [A, B, Cc] = ['us-atorres', 'us-bramos', 'us-evargas'];
    const ch = testChannel('ch-wa-9001', 'br-DG', [A, B, Cc]);
    C.setAgentStatus(A, 'ONLINE', at); C.setAgentStatus(B, 'ONLINE', at); C.setAgentStatus(Cc, 'OFFLINE', at);
    const old = C.receive({ channel_id: ch.id, from: '+51900000001', name: 'Previo', text: 'Hola', at: addH(at, -1), assignTo: A }).conversation;
    ok(old.assigned_user_id === A, 'El chat previo debía quedar con A');
    const c1 = C.receive({ channel_id: ch.id, from: '+51900000002', name: 'Cliente 1', text: 'Hola, quiero cuy', at }).conversation;
    const c2 = C.receive({ channel_id: ch.id, from: '+51900000003', name: 'Cliente 2', text: 'Precio del conejo', at: addM(at, 1) }).conversation;
    ok(c1.assigned_user_id === B, 'El primero debía ir a B y fue a ' + G.userShort(c1.assigned_user_id));
    ok(c2.assigned_user_id === A, 'El segundo debía ir a A y fue a ' + G.userShort(c2.assigned_user_id));
    ok(![c1, c2].some(c => c.assigned_user_id === Cc), 'C (desconectada) no debe recibir');
  });
  TT('CA-CRM-02: texto libre fuera de la ventana de 24 h se rechaza (RN-CRM-05) y la plantilla aprobada sí se envía', async () => {
    const cv = C.receive({ channel_id: 'ch-wa-0101', from: '+51900000010', name: 'Cliente ventana', text: 'Hola, ¿tienen pato?', at: '2026-10-05T10:00:00', assignTo: 'us-atorres' }).conversation;
    throwsCode(() => C.send(cv.id, { text: '¿Sigues interesado?', user_id: 'us-atorres', at: '2026-10-06T10:30:00' }), 'RN-CRM-05');
    const m = C.send(cv.id, { template_id: C.templateFor('br-DG', 'ORDER_CONFIRMATION').id, vars: { cliente: 'Cliente' }, user_id: 'us-atorres', at: '2026-10-06T10:30:00' });
    ok(m && m.msg_type === 'TEMPLATE', 'La plantilla aprobada debía enviarse');
  });
  TT('CA-CRM-03: TikTok rechaza el undécimo mensaje seguido y la respuesta a las 49 h (RN-CRM-06)', async () => {
    const at = G.TODAY + 'T10:00:00';
    const cv = C.receive({ channel_id: 'ch-tt-DG', from: '@prueba.tt', name: 'Prueba TT', text: 'Precio del cuy', at, assignTo: 'us-atorres' }).conversation;
    for (let i = 0; i < 10; i++) C.send(cv.id, { text: 'Mensaje ' + (i + 1), user_id: 'us-atorres', at: addM(at, i + 1) });
    throwsCode(() => C.send(cv.id, { text: 'Mensaje 11', user_id: 'us-atorres', at: addM(at, 12) }), 'RN-CRM-06');
    const cv2 = C.receive({ channel_id: 'ch-tt-DG', from: '@prueba.tt2', name: 'Prueba TT 2', text: 'Hola', at: '2026-10-08T09:00:00', assignTo: 'us-atorres' }).conversation;
    throwsCode(() => C.send(cv2.id, { text: 'Hola, ¿sigues?', user_id: 'us-atorres', at: '2026-10-10T10:00:00' }), 'RN-CRM-06');
    throwsCode(() => C.send(cv2.id, { template_id: 'mt-DG-1', user_id: 'us-atorres', at: '2026-10-08T10:00:00' }), 'RN-CRM-06');
  });
  TT('CA-CRM-04: Marca 2 con 1000 respuestas en octubre: la 1001 cuesta S/ 0,0998; utilidad en ventana S/ 0; marketing S/ 0,2339', async () => {
    const ch = chan('ch-wa-0201'); const period = '2026-10-01'; const have = C.serviceCount(ch.id, period);
    for (let i = have; i < 1000; i++) ins('message_charges', { message_id: 'x' + i, channel_id: ch.id, brand_id: 'br-M2', period, category: 'SERVICE', billable: false, reason: 'FREE_SERVICE_QUOTA', rate: 0, amount: 0, charged_at: '2026-10-05T10:00:00' });
    ok(C.serviceCount(ch.id, period) === 1000, 'Debía haber 1000 respuestas: ' + C.serviceCount(ch.id, period));
    const at = G.TODAY + 'T11:00:00';
    const cv = C.receive({ channel_id: ch.id, from: '+51900000020', name: 'Cliente M2', text: 'Hola, bondiola', at, assignTo: 'us-cnunez' }).conversation;
    // el aviso de registro automático ya fue la respuesta 1001
    const m = C.send(cv.id, { text: 'Hola, está a S/ 38 el kg', user_id: 'us-cnunez', at: addM(at, 2) });
    ok(Math.abs(m.cost - 0.0998) < 1e-6, 'La respuesta tras la cuota debía costar 0,0998 y costó ' + m.cost);
    const u = C.send(cv.id, { template_id: C.templateFor('br-M2', 'PAYMENT_REQUEST').id, user_id: 'us-cnunez', at: addM(at, 3) });
    ok(u.cost === 0, 'La utilidad dentro de la ventana debía ser gratis: ' + u.cost);
    C.recordConsent({ customer_id: cv.customer_id, contact_id: cv.contact_id, purpose: 'MARKETING', granted: true, evidence_text: 'SÍ', at: addM(at, 4) });
    const mk = C.send(cv.id, { template_id: C.templateFor('br-M2', 'REBUY').id, user_id: 'us-pleon', at: addM(at, 5) });
    ok(Math.abs(mk.cost - 0.2339) < 1e-6, 'Marketing debía costar 0,2339: ' + mk.cost);
  });
  TT('CA-CRM-05: 1000 pedidos por 2 números ≈ S/ 1000 (798 servicio + 200 utilidad); con la mitad por anuncio ≈ S/ 400', async () => {
    const a = C.simulate({ orders: 1000, numbers: 2, replies: 10, utilities: 2, ctwaShare: 0 });
    ok(Math.abs(a.service - 798.4) < 0.5 && Math.abs(a.utility - 199.6) < 0.5, `Servicio ${a.service} y utilidad ${a.utility}`);
    ok(Math.abs(a.total - 1000) < 5, 'Total ≈ 1000: ' + a.total);
    const b = C.simulate({ orders: 1000, numbers: 2, replies: 10, utilities: 2, ctwaShare: 0.5 });
    ok(Math.abs(b.total - 400) < 5, 'Con la mitad por anuncio ≈ 400: ' + b.total);
  });
  TT('CA-CRM-06: «escríbeme a mi número 987 654 321… por fuera» da 3 alertas; Yape oficial o celular del cliente no alertan', async () => {
    const at = G.TODAY + 'T11:00:00'; const c = G.db.get('customers', 'cu-0300');
    const cv = C.receive({ channel_id: 'ch-wa-0101', from: c.phone, name: c.full_name, text: 'Hola', at, assignTo: 'us-atorres' }).conversation;
    if (cv.assigned_user_id !== 'us-atorres') C.assign(cv.id, 'us-atorres');
    const before = G.db.all('control_alerts').length;
    C.send(cv.id, { text: 'Mejor escríbeme a mi número 987 654 321, te lo dejo más barato por fuera', user_id: 'us-atorres', at: addM(at, 1) });
    const news = G.db.all('control_alerts').slice(before);
    ok(news.length === 3, 'Debían ser 3 alertas y fueron ' + news.length + ': ' + news.map(a => a.rule_code).join(', '));
    ok(G.db.where('notifications', n => n.module === 'CRM' && n.title.startsWith('Alerta de control')).length >= 3, 'La supervisora debía recibir las alertas');
    const b2 = G.db.all('control_alerts').length;
    C.send(cv.id, { text: 'Puedes yapear al 987 650 001, es el Yape de la empresa', user_id: 'us-atorres', at: addM(at, 2) });
    C.send(cv.id, { text: 'Te llamo al ' + c.phone.slice(3) + ' para coordinar', user_id: 'us-atorres', at: addM(at, 3) });
    ok(G.db.all('control_alerts').length === b2, 'Yape oficial o celular del cliente no deben alertar');
  });
  TT('CA-CRM-07: «lechón para el sábado» alerta por producto fuera del catálogo; con «Lechón al horno» activo ya no', async () => {
    ok(C.scanText('Te ofrezco lechón para el sábado').some(x => x.rule.rule_type === 'OFF_CATALOG_TERM'), 'Debía alertar lechón');
    G.db.insert('products', { id: 'pr-LECH', brand_id: 'br-DG', category_id: 'pc-CERDO', code: 'LECH', name: 'Lechón al horno', product_type: 'GOODS', status: 'ACTIVE' }, { silent: true });
    ok(!C.scanText('Te ofrezco lechón para el sábado').some(x => x.rule.rule_type === 'OFF_CATALOG_TERM'), 'Con el producto activo no debe alertar');
  });
  TT('CA-CRM-08: «vi el anuncio DG-A12» → pedido WhatsApp con número, marca, vendedora y anuncio; lead WON; atribución por código y cliente nuevo', async () => {
    const at = G.TODAY + 'T11:00:00';
    const rec = C.receive({ channel_id: 'ch-wa-0101', from: '+51911222333', name: 'Rosa Nueva', text: 'Hola, vi el anuncio DG-A12', at, assignTo: 'us-atorres' });
    ok(rec.lead && rec.conversation.entry_point === 'TRACKING_CODE', 'Debía crear lead con código');
    const r1 = C.createOrder(rec.conversation.id, { user_id: 'us-atorres', at: addM(at, 5), lines: [{ variant_id: 'va-DG-CUY-ENT', qty: 2 }] });
    const o = r1.order;
    ok(o.channel === 'WHATSAPP' && o.origin_wa_number === chan('ch-wa-0101').number && o.brand_id === 'br-DG' && o.seller_id === 'us-atorres' && o.origin_ad_code === 'DG-A12', 'Origen del pedido incompleto');
    ok(o.status === 'DRAFT' && o.origin_locked, 'Debe quedar en borrador con origen bloqueado');
    ok(G.db.get('leads', rec.lead.id).status === 'WON', 'El lead debía quedar WON');
    const at2 = G.db.find('ad_attributions', x => x.order_id === o.id);
    ok(at2 && at2.method === 'TRACKING_CODE' && at2.is_new_customer, 'Atribución por código y cliente nuevo');
    ok(r1.message && r1.message.msg_type === 'TEMPLATE', 'Debía enviar el resumen en un solo mensaje');
  });
  TT('CA-CRM-09: borrar o editar un mensaje no se puede (RN-CRM-04) y sigue visible', async () => {
    const m = G.db.find('conversation_messages', x => x.direction === 'OUT' && x.sender_user_id === 'us-bramos');
    const prev = G.ctx.role; G.ctx.role = 'VENDEDORA';
    try { throwsCode(() => C.deleteMessage(m.id), 'RN-CRM-04'); throwsCode(() => C.editMessage(m.id, 'x'), 'RN-CRM-04'); } finally { G.ctx.role = prev; }
    ok(G.db.get('conversation_messages', m.id), 'El mensaje debe seguir existiendo');
    const borrado = G.db.find('message_status_events', e => e.status === 'DELETED_IN_APP'); ok(borrado && G.db.get('conversation_messages', borrado.message_id), 'El borrado en el celular conserva el original');
  });
  TT('CA-CRM-10: compras los días 1, 16 y 31 → frecuencia 15, esperado día 46, tarea día 43', async () => {
    const r1 = C.rebuySchedule('cu-0400', 'br-M4', { dates: ['2026-08-01', '2026-08-16', '2026-08-31'], today: '2026-09-02' });
    ok(r1.profile.median_interval_days === 15, 'Frecuencia 15: ' + r1.profile.median_interval_days);
    ok(r1.profile.next_expected_at === '2026-09-15', 'Esperado día 46 (15/09): ' + r1.profile.next_expected_at);
    ok(r1.task && r1.task.due_at.slice(0, 10) === '2026-09-12', 'Tarea día 43 (12/09)');
    const r2 = C.rebuySchedule('cu-0400', 'br-M4', { dates: ['2026-08-01', '2026-08-16', '2026-08-31'], today: '2026-09-02' });
    ok(r2.task.id === r1.task.id, 'Una sola tarea abierta por cliente y marca');
  });
  TT('CA-CRM-11: reasignar de A a B deja historial; B responde, A no; a una vendedora de Marca 2 se rechaza', async () => {
    const at = G.TODAY + 'T11:00:00';
    const cv = C.receive({ channel_id: 'ch-wa-0101', from: '+51900000030', name: 'Reasignar', text: 'Hola', at, assignTo: 'us-atorres' }).conversation;
    C.reassign(cv.id, 'us-evargas', { by: 'us-pleon', at: addM(at, 1) });
    const hist = G.db.where('conversation_assignments', a => a.conversation_id === cv.id);
    ok(hist.some(a => a.to_user_id === 'us-atorres') && hist.some(a => a.to_user_id === 'us-evargas' && a.from_user_id === 'us-atorres'), 'Historial con ambas');
    ok(C.send(cv.id, { text: 'Hola, te atiendo yo', user_id: 'us-evargas', at: addM(at, 2) }), 'B debe poder responder');
    throwsCode(() => C.send(cv.id, { text: 'Hola', user_id: 'us-atorres', at: addM(at, 3) }), 'RN-CRM-03');
    throwsCode(() => C.reassign(cv.id, 'us-cnunez', { by: 'us-pleon' }), 'RN-CRM-03');
  });
  TT('CA-CRM-12: recompra sin consentimiento se rechaza (RN-CRM-08); con «SÍ» se envía; tras «BAJA» vuelve a rechazarse', async () => {
    const at = G.TODAY + 'T11:00:00'; const c = G.db.insert('customers', { doc_type: 'NONE', doc_number: null, full_name: 'Marta Sin Consentimiento', phone: '+51944555666', email: null, customer_type: 'PERSON', source_channel: 'WHATSAPP', marketing_opt_in: false, status: 'ACTIVE', first_order_at: null, last_order_at: null, orders_count: 0, segment_brands: [] }); /* cliente propio: otros módulos (CLI, CMP) siembran consentimientos para los clientes existentes */
    const cv = C.receive({ channel_id: 'ch-wa-0101', from: c.phone, name: c.full_name, text: 'Hola', at, assignTo: 'us-atorres' }).conversation;
    if (cv.assigned_user_id !== 'us-atorres') C.assign(cv.id, 'us-atorres');
    const tpl = C.templateFor('br-DG', 'REBUY').id;
    throwsCode(() => C.send(cv.id, { template_id: tpl, user_id: 'us-pleon', at: addM(at, 1) }), 'RN-CRM-08');
    const yes = C.receive({ channel_id: 'ch-wa-0101', from: c.phone, text: 'SÍ, quiero recibir promociones', at: addM(at, 2) }).message;
    C.recordConsent({ customer_id: c.id, contact_id: cv.contact_id, purpose: 'MARKETING', granted: true, evidence_message_id: yes.id, at: addM(at, 2) });
    ok(C.send(cv.id, { template_id: tpl, user_id: 'us-pleon', at: addM(at, 3) }), 'Con SÍ debía enviarse');
    let ev = false; G.events.on('consent.opted_out', () => { ev = true; });
    C.receive({ channel_id: 'ch-wa-0101', from: c.phone, text: 'BAJA', at: addM(at, 4) });
    ok(ev, 'Debía emitir consent.opted_out');
    throwsCode(() => C.send(cv.id, { template_id: tpl, user_id: 'us-pleon', at: addM(at, 5) }), 'RN-CRM-08');
  });
  TT('RN-CRM-01: TikTok no disponible y sin modo QR', async () => {
    throwsCode(() => C.receive({ channel_id: 'ch-tt-M5', from: '@x', text: 'hola' }), 'RN-CRM-06');
    ok(!Object.keys(CONN).some(k => /QR/.test(k)), 'No debe existir modo QR');
  });

  /* =====================================================================
     Interfaz: piezas comunes (lista tipo WhatsApp Web, chat y redacción)
     ===================================================================== */
  const S = { sel: null, st: 'OPEN', ch: '', kind: '', who: '', q: '', unanswered: false, expiring: false, ad: false };
  const isSup = () => ['SUPERVISORA_VENTAS', 'GERENTE'].includes(G.ctx.role);
  const cst = s => badge(CSTATUS[s][0], CSTATUS[s][1]);
  const sevB = s => badge(SEV[s][0], SEV[s][1]);
  const chB = ch => badge(kindTag(ch.kind) + ' · ' + ch.display_name, ch.kind === 'WHATSAPP' ? 'ok' : 'info');
  const goConv = id => G.go('CRM-02', { id });
  function winBadges(cv, at) {
    const ch = chan(cv.channel_id); const w = C.windows(cv, at); const out = [];
    if (cv.status === 'CLOSED') return out;
    if (ch.kind === 'TIKTOK') out.push(badge(w.inService ? `TikTok 48 h: quedan ${dur(w.svcLeft)} · ${cv.outbound_since_inbound || 0}/${G.param('crm_tiktok_max_consecutive')} seguidos` : 'TikTok: ventana de 48 h vencida', w.inService ? (w.svcLeft < 240 ? 'warn' : 'info') : 'bad'));
    else out.push(badge(w.inService ? `Ventana ${w.hours} h: quedan ${dur(w.svcLeft)}` : 'Fuera de ventana: solo plantilla', w.inService ? (w.svcLeft < 120 ? 'warn' : 'ok') : 'bad'));
    if (w.inCtwa) out.push(badge(`Anuncio 72 h gratis: ${dur(w.ctwaLeft)}`, 'info'));
    return out;
  }
  function lastMsgMap() { const m = new Map(); for (const x of G.db.all('conversation_messages')) { const p = m.get(x.conversation_id); if (!p || x.sent_at >= p.sent_at) m.set(x.conversation_id, x); } return m; }
  const snippet = m => !m ? '' : m.msg_type === 'AUDIO' ? 'Nota de voz' : m.msg_type === 'LOCATION' ? 'Ubicación' : m.msg_type === 'IMAGE' ? 'Foto' : m.msg_type === 'DOCUMENT' ? 'Documento' : m.msg_type === 'UNSUPPORTED' ? 'Mensaje no disponible' : (m.direction === 'OUT' ? (m.origin === 'SYSTEM' ? 'Automático: ' : 'Tú: ') : '') + String(m.body || '').split('\n')[0];
  function convItem(cv, at, last, onClick) {
    const ch = chan(cv.channel_id); const br = G.db.get('brands', cv.brand_id) || {}; const wait = C.waitMins(cv, at);
    return h('div', { class: 'crm-item' + (S.sel === cv.id ? ' sel' : ''), on: { click: () => onClick(cv) }, attrs: { role: 'button', tabindex: '0' } },
      h('div', { class: 'crm-av', style: { borderColor: br.primary_color || 'var(--line)' } }, initials(C.contactName(cv))),
      h('div', { style: 'min-width:0;display:grid;gap:2px' }, h('div', { class: 'crm-name' }, C.contactName(cv)), h('div', { class: 'crm-snip' }, snippet(last)),
        h('div', { class: 'row', style: 'gap:4px' }, h('span', { class: 'crm-tag' }, kindTag(ch.kind) + ' ' + ch.display_name), cv.entry_point === 'CTWA_AD' || cv.entry_point === 'TRACKING_CODE' ? h('span', { class: 'crm-tag' }, 'Anuncio ' + (cv.ad_code || '')) : null, cv.lead_id && !cv.customer_id ? h('span', { class: 'crm-tag' }, 'Lead') : null)),
      h('div', { class: 'crm-side' }, h('span', null, last ? hm(last.sent_at) : ''), wait > 0 ? badge(dur(wait), wait > (G.param('crm_unanswered_alert_minutes') ?? 15) ? 'bad' : 'warn') : (() => { const w = C.windows(cv, at); return cv.status === 'CLOSED' ? null : w.inService ? (w.svcLeft < 120 ? badge('Vence ' + dur(w.svcLeft), 'warn') : null) : badge('Solo plantilla', 'bad'); })(), h('span', null, cv.assigned_user_id ? G.userShort(cv.assigned_user_id).split(' ')[0] : 'En cola')));
  }
  function msgBody(m, flags, tr) {
    const kids = [];
    const tpl = m.template_id && G.db.get('message_templates', m.template_id);
    if (tpl) kids.push(h('span', { class: 'tpl' }, `Plantilla · ${CAT[tpl.category]} · ${tpl.name}`));
    if (m.msg_type === 'AUDIO') kids.push(h('span', null, `Nota de voz ${m.media && m.media.duration_s ? '0:' + String(m.media.duration_s).padStart(2, '0') : ''}`), tr ? h('span', { class: 'tr' }, 'Transcripción: ' + tr.transcript) : null);
    else if (m.msg_type === 'LOCATION') kids.push(h('span', null, `Ubicación: ${(m.media || {}).label || ''} (${G.fmt.num((m.media || {}).lat, 4)}, ${G.fmt.num((m.media || {}).lng, 4)})`));
    else if (m.msg_type === 'IMAGE') kids.push(h('span', null, '[Foto] ' + (m.body || '')));
    else if (m.msg_type === 'DOCUMENT') kids.push(h('span', null, '[Documento] ' + (m.body || '')));
    else if (m.msg_type === 'PRODUCT' || m.msg_type === 'CATALOG') kids.push(h('span', { class: 'tpl' }, 'Producto del catálogo'), h('span', null, m.body));
    else if (m.msg_type === 'UNSUPPORTED') kids.push(h('span', { class: 'muted' }, `Mensaje «${m.unsupported_kind === 'VIEW_ONCE' ? 'ver una vez' : m.unsupported_kind === 'LIVE_LOCATION' ? 'ubicación en vivo' : 'temporal'}» no disponible con coexistencia (RN-CRM-11).`));
    else kids.push(m.body || '');
    if (flags.cust) kids.push(h('span', { class: 'flag' }, 'El cliente borró este mensaje · se conserva el original (RN-CRM-04)'));
    if (flags.app) kids.push(h('span', { class: 'flag' }, 'Borrado desde el celular de la empresa · se conserva (RN-CRM-04)'));
    for (const a of flags.alerts || []) kids.push(h('span', { class: 'flag' }, `Alerta ${SEV[a.severity][0].toLowerCase()}: ${(G.db.get('control_alert_rules', a.rule_id) || {}).name || a.rule_code} «${a.matched_text}»`));
    return kids;
  }
  const ORIG = { API: 'Bandeja', BUSINESS_APP: 'App del celular', SYSTEM: 'Automático', HISTORY_SYNC: 'Historial sincronizado' };
  function chatView(cv) {
    const msgs = G.db.where('conversation_messages', m => m.conversation_id === cv.id).sort((a, b) => a.sent_at.localeCompare(b.sent_at));
    const ids = new Set(msgs.map(m => m.id)); const ev = U.groupBy(G.db.where('message_status_events', e => ids.has(e.message_id)), 'message_id');
    const trs = new Map(G.db.where('message_transcripts', t => ids.has(t.message_id)).map(t => [t.message_id, t]));
    const showAlerts = G.can('crm.alert.review'); const al = showAlerts ? U.groupBy(G.db.where('control_alerts', a => a.conversation_id === cv.id && a.message_id), 'message_id') : {};
    const items = msgs.map(m => ({ at: m.sent_at, m })).concat((cv.internal_notes || []).map(n => ({ at: n.at, n }))).sort((a, b) => a.at.localeCompare(b.at));
    const box = h('div', { class: 'chat', style: 'max-height:56vh;min-height:280px' });
    let day = '';
    for (const it of items) {
      if (it.at.slice(0, 10) !== day) { day = it.at.slice(0, 10); box.appendChild(h('div', { class: 'msg sys' }, G.fmt.date(day))); }
      if (it.n) { box.appendChild(h('div', { class: 'msg note' }, h('b', null, 'Nota interna · ' + G.userShort(it.n.user_id) + ': '), it.n.text, h('span', { class: 'meta' }, hm(it.at) + ' · solo la ve el equipo'))); continue; }
      const m = it.m; const es = (ev[m.id] || []).map(e => e.status); const alerts = al[m.id] || [];
      const flags = { cust: es.includes('DELETED_BY_CUSTOMER'), app: es.includes('DELETED_IN_APP'), alerts };
      const st = es.includes('READ') ? 'leído' : es.includes('DELIVERED') ? 'entregado' : es.includes('SENT') ? 'enviado' : '';
      const cost = m.direction === 'OUT' && chan(m.channel_id).kind === 'WHATSAPP' ? (m.cost > 0 ? G.fmt.money(m.cost, 4) : 'gratis') : null;
      const cls = 'msg' + (m.direction === 'OUT' ? ' out' : '') + (m.origin === 'SYSTEM' ? ' sys' : '') + (alerts.length || flags.app ? ' alert' : '');
      box.appendChild(h('div', { class: cls, attrs: { 'data-id': m.id }, title: 'Clic para ver el detalle', style: 'cursor:pointer', on: { click: () => msgDetail(m) } }, msgBody(m, flags, trs.get(m.id)),
        h('span', { class: 'meta' }, [hm(m.sent_at), m.direction === 'OUT' ? (m.sender_user_id ? G.userShort(m.sender_user_id) : 'Sistema') : null, m.direction === 'OUT' ? ORIG[m.origin] : null, st, cost].filter(Boolean).join(' · '))));
    }
    if (!items.length) box.appendChild(U.empty ? G.ui.empty('Sin mensajes.') : h('div', null, 'Sin mensajes.'));
    setTimeout(() => { box.scrollTop = box.scrollHeight; }, 0);
    return box;
  }
  function msgDetail(m) {
    drawer('Mensaje', (b, close) => {
      const ev = G.db.where('message_status_events', e => e.message_id === m.id); const ch = G.db.find('message_charges', x => x.message_id === m.id); const tr = G.db.find('message_transcripts', x => x.message_id === m.id);
      b.appendChild(dl([['Dirección', m.direction === 'IN' ? 'Entrante (cliente)' : 'Saliente'], ['Origen', ORIG[m.origin] || m.origin], ['Tipo', m.msg_type], ['Enviado por', m.sender_user_id ? G.userName(m.sender_user_id) : '—'], ['Fecha', G.fmt.datetime(m.sent_at)], ['Id del proveedor', h('span', { class: 'mono small' }, m.external_id)], ['Texto', m.body || '—'], tr ? ['Transcripción', tr.transcript] : null, ch ? ['Costo', `${G.fmt.money(ch.amount, 4)} · ${CAT[ch.category]} · ${CHARGE_R[ch.reason]}`] : null, m.referral ? ['Referral de anuncio', `${m.referral.ad_code || ''} ${m.referral.headline || ''}`] : null]));
      b.appendChild(card('Estados (solo inserción)', h('div', { class: 'timeline' }, ev.map(e => h('div', { class: 'tl-item' }, h('span', { class: 'when' }, hm(e.occurred_at)), h('span', { class: 'dot' }), h('span', null, { SENT: 'Enviado', DELIVERED: 'Entregado', READ: 'Leído', FAILED: 'Falló', DELETED_BY_CUSTOMER: 'Borrado por el cliente', DELETED_IN_APP: 'Borrado en la app del celular' }[e.status] || e.status))))));
      b.appendChild(notice('RN-CRM-04: los mensajes son de solo inserción. Editar o borrar no está permitido, tampoco por API.', 'info'));
      b.appendChild(h('div', { class: 'row' }, btn('Editar', () => { try { C.editMessage(m.id); } catch (e) { toast(e.message, 'bad'); } }, { sm: true }), btn('Borrar', () => { try { C.deleteMessage(m.id); } catch (e) { toast(e.message, 'bad'); } }, { sm: true, kind: 'danger' })));
    });
  }
  /** texto de costo y permiso del próximo mensaje */
  C.previewText = function (cv, at = C.now()) {
    const ch = chan(cv.channel_id); const w = C.windows(cv, at);
    if (cv.status === 'CLOSED') return 'Conversación cerrada: reábrela para escribir (las plantillas sí se envían).';
    if (ch.kind === 'TIKTOK') return w.inService ? `TikTok: quedan ${dur(w.svcLeft)} para responder · ${cv.outbound_since_inbound || 0} de ${G.param('crm_tiktok_max_consecutive')} mensajes seguidos · sin plantillas (RN-CRM-06).` : 'TikTok: pasaron más de 48 h; solo el cliente puede reabrir la conversación (RN-CRM-06).';
    if (ch.kind !== 'WHATSAPP') return w.inService ? `${kindName(ch.kind)}: ventana de ${w.hours} h abierta (${dur(w.svcLeft)}); los mensajes no se cobran.` : `${kindName(ch.kind)}: ventana de ${w.hours} h vencida y no hay plantillas; espera a que el cliente escriba (RN-CRM-05).`;
    const svc = C.nextCost(cv, 'SERVICE', at); const served = C.serviceCount(ch.id, G.date.month(at)); const quota = ch.free_service_quota ?? 1000;
    const ut = C.nextCost(cv, 'UTILITY', at), mk = C.nextCost(cv, 'MARKETING', at);
    if (!w.inService) return `Fuera de la ventana de 24 h: solo plantillas aprobadas · utilidad ${ut.amount ? G.fmt.money(ut.amount, 4) : 'gratis'} · marketing ${mk.amount ? G.fmt.money(mk.amount, 4) : 'gratis'} (RN-CRM-05).`;
    return `Próxima respuesta: ${svc.amount ? G.fmt.money(svc.amount, 4) + ' (cuota de ' + quota + ' respuestas gratis agotada)' : svc.reason === 'FREE_CTWA_WINDOW' ? 'gratis por la ventana de anuncio de 72 h' : `gratis (respuesta ${served + 1} de ${quota} gratis del mes en este número)`} · utilidad ${ut.amount ? G.fmt.money(ut.amount, 4) : 'gratis'} · marketing ${mk.amount ? G.fmt.money(mk.amount, 4) : 'gratis'}.`;
  };
  const act = (fn, okMsg) => { try { const r = fn(); if (okMsg) toast(okMsg, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); return false; } };
  function composer(cv) {
    const can = G.canDo('CRM', 'C') && C.canReply(cv, me()); const ch = chan(cv.channel_id);
    const wrap = h('div', { class: 'crm-compose' });
    const info = h('div', { class: 'small muted' }, C.previewText(cv));
    if (!can) { wrap.append(notice(cv.assigned_user_id ? `RN-CRM-03: este chat está asignado a ${G.userName(cv.assigned_user_id)}; solo ella o la supervisora responden.` : 'RN-CRM-03: el chat está en cola. La supervisora lo asigna o lo toma desde Supervisión en vivo.', 'warn'), info); return wrap; }
    const qrs = G.db.where('quick_replies', q => q.status === 'ACTIVE' && (q.brand_id === cv.brand_id || q.owner_user_id === me()));
    const ta = h('textarea', { class: 'input', placeholder: 'Escribe un mensaje o un atajo (/delivery, /pago, /peso)…', attrs: { 'aria-label': 'Mensaje' } });
    ta.addEventListener('input', () => { const m = ta.value.match(/^(\/[a-z0-9_]+) $/); if (m) { const q = qrs.find(x => x.shortcut === m[1]); if (q) ta.value = q.body; } });
    const qsel = h('select', { class: 'input', attrs: { 'aria-label': 'Respuestas rápidas' }, style: 'max-width:200px' }, h('option', { value: '' }, 'Respuestas rápidas'), qrs.map(q => h('option', { value: q.id }, q.shortcut)));
    qsel.addEventListener('change', () => { const q = qrs.find(x => x.id === qsel.value); if (q) ta.value = q.body; qsel.value = ''; ta.focus(); });
    const send = () => act(() => { C.send(cv.id, { text: ta.value }); ta.value = ''; }, 'Mensaje enviado');
    wrap.append(ta, h('div', { class: 'row' }, btn('Enviar', send, { kind: 'primary' }), qsel,
      ch.kind === 'WHATSAPP' ? btn('Plantilla', () => templateModal(cv), { sm: true }) : null,
      btn('Catálogo', () => catalogModal(cv), { sm: true }), btn('Adjuntar', () => attachModal(cv), { sm: true }), btn('Nota de voz', () => voiceModal(cv), { sm: true }),
      btn('Nota interna', () => noteModal(cv), { sm: true, kind: 'ghost' })), info);
    return wrap;
  }
  function templateModal(cv) {
    const tpls = G.db.where('message_templates', t => t.brand_id === cv.brand_id);
    const orders = G.db.where('conversation_orders', x => x.conversation_id === cv.id).map(x => G.db.get('sales_orders', x.order_id)).filter(Boolean);
    const recent = cv.customer_id ? G.db.where('sales_orders', o => o.customer_id === cv.customer_id && o.brand_id === cv.brand_id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5) : [];
    const ords = [...new Map(orders.concat(recent).map(o => [o.id, o])).values()];
    modal('Enviar plantilla', (b, close) => {
      const prev = h('div', { class: 'msg out', style: 'max-width:100%' });
      const costEl = h('div', { class: 'small muted' });
      const f = form({ id: 'crm-tpl', fields: [
        { key: 'template_id', label: 'Plantilla', type: 'select', required: true, options: tpls.map(t => [t.id, `${t.name} · ${CAT[t.category]} · ${TPLST[t.provider_status][0]}`]), onChange: () => draw() },
        { key: 'order_id', label: 'Pedido (cuenta para el tope de utilidad)', type: 'select', options: ords.map(o => [o.id, `${o.number} · ${G.ui.statusLabel(o.status)} · ${C.utilityCount(o.id)} de ${G.param('crm_utility_templates_per_order')} plantillas`]), onChange: () => draw() },
        { key: 'extra', label: 'Enviar como plantilla adicional (permiso crm.template.send_extra)', type: 'checkbox' },
      ], values: { template_id: (tpls.find(t => t.provider_status === 'APPROVED') || tpls[0] || {}).id, order_id: (ords[0] || {}).id }, submitLabel: 'Enviar plantilla', onCancel: close,
      onSubmit: v => { try { const o = v.order_id && G.db.get('sales_orders', v.order_id); C.send(cv.id, { template_id: v.template_id, order_id: v.order_id || null, vars: Object.assign(o ? C.orderVars(o) : { cliente: C.contactName(cv).split(' ')[0], marca: G.brandName(cv.brand_id) }), allowExtra: !!v.extra }); close(); toast('Plantilla enviada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } });
      function draw() { const v = f.api.values; const t = G.db.get('message_templates', v.template_id); const o = v.order_id && G.db.get('sales_orders', v.order_id); if (!t) return; prev.textContent = C.fill(t.body, o ? C.orderVars(o) : { cliente: C.contactName(cv).split(' ')[0], marca: G.brandName(cv.brand_id) }) + (t.category === 'MARKETING' ? UNSUB : ''); const c = C.nextCost(cv, t.category); costEl.textContent = `Costo de este envío: ${c.amount ? G.fmt.money(c.amount, 4) : 'gratis'} (${CHARGE_R[c.reason] || ''})${t.category === 'MARKETING' ? ` · consentimiento de marketing: ${C.consentState(cv.customer_id, cv.contact_id) === true ? 'otorgado' : C.consentState(cv.customer_id, cv.contact_id) === false ? 'dio de baja' : 'sin registro'}` : ''}.`; }
      b.append(f, h('div', { class: 'stack', style: 'margin-top:10px' }, h('b', { class: 'small' }, 'Vista previa'), prev, costEl)); draw();
    }, [], { wide: true });
  }
  function catalogModal(cv) {
    const vs = G.db.where('product_variants', v => v.brand_id === cv.brand_id && v.status === 'ACTIVE' && v.sellable);
    modal('Enviar producto del catálogo', (b, close) => {
      b.append(notice('Catálogo de WhatsApp sincronizado con CAT: solo productos activos con precio vigente.', 'info'));
      b.append(table({ id: 'crm-cat-pick', columns: [{ key: 'name', label: 'Producto' }, { key: 'p', label: 'Precio', align: 'r', value: v => { const p = G.price.of(v.id, { brand_id: v.brand_id, channel: 'WHATSAPP' }); return p ? `${G.fmt.money(p.price)} ${p.basis === 'KG' ? '/kg' : 'c/u'}` : 'Sin precio'; } }], rows: vs, pageSize: 8,
        onRow: v => { const p = G.price.of(v.id, { brand_id: v.brand_id, channel: 'WHATSAPP' }); if (act(() => C.send(cv.id, { msg_type: 'PRODUCT', text: `${v.name} · ${p ? G.fmt.money(p.price) + (p.basis === 'KG' ? ' el kg' : ' c/u') : ''} · ${G.brandName(v.brand_id)}` }), 'Producto enviado') !== false) close(); } }));
    });
  }
  function attachModal(cv) {
    modal('Adjuntar', (b, close) => b.append(form({ id: 'crm-att', fields: [{ key: 't', label: 'Tipo', type: 'select', required: true, options: [['IMAGE', 'Foto'], ['DOCUMENT', 'Documento (PDF)'], ['LOCATION', 'Ubicación del local']] }, { key: 'c', label: 'Leyenda o nombre del archivo', type: 'text' }], values: { t: 'IMAGE' }, submitLabel: 'Enviar', onCancel: close,
      onSubmit: v => { try { C.send(cv.id, v.t === 'LOCATION' ? { msg_type: 'LOCATION', media: { lat: -12.1385, lng: -76.9905, label: 'Local 1 · Av. Los Próceres 1240, Surco' } } : { msg_type: v.t, text: v.c || (v.t === 'IMAGE' ? 'foto.jpg' : 'lista-de-precios.pdf') }); close(); toast('Adjunto enviado', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })));
  }
  function voiceModal(cv) {
    modal('Nota de voz', (b, close) => b.append(notice('La nota de voz se transcribe y pasa por las mismas reglas de control (RN-CRM-16).', 'info'), form({ id: 'crm-voice', fields: [{ key: 'tr', label: 'Lo que dice la nota (transcripción)', type: 'textarea', required: true }, { key: 's', label: 'Duración (s)', type: 'number', min: 1, max: 120 }], values: { s: 12 }, submitLabel: 'Grabar y enviar', onCancel: close,
      onSubmit: v => { try { C.send(cv.id, { msg_type: 'AUDIO', media: { duration_s: v.s || 12 }, transcript: v.tr }); close(); toast('Nota de voz enviada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })));
  }
  function noteModal(cv) { modal('Nota interna', (b, close) => b.append(form({ id: 'crm-note', fields: [{ key: 't', label: 'Nota (no la ve el cliente)', type: 'textarea', required: true }], submitLabel: 'Guardar nota', onCancel: close, onSubmit: v => { try { C.addNote(cv.id, v.t); close(); toast('Nota guardada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))); }
  function simulateModal(cv) {
    const ct = G.db.get('channel_contacts', cv.contact_id);
    modal('Simular mensaje del cliente', (b, close) => b.append(notice('Simula la entrada por webhook del proveedor oficial (INT) para probar ventanas, asignación y bajas.', 'info'), form({ id: 'crm-sim', fields: [{ key: 'text', label: 'Texto', type: 'textarea' }, { key: 'k', label: 'Tipo', type: 'select', required: true, options: [['TEXT', 'Texto'], ['VIEW_ONCE', 'Foto «ver una vez» (no disponible)'], ['LIVE_LOCATION', 'Ubicación en vivo (no disponible)'], ['GROUP', 'Mensaje de un grupo (se descarta)'], ['DELETE', 'El cliente borra su último mensaje']] }], values: { k: 'TEXT', text: 'Hola, ¿siguen atendiendo?' }, submitLabel: 'Recibir', onCancel: close,
      onSubmit: v => { try { if (v.k === 'DELETE') { const m = G.db.where('conversation_messages', x => x.conversation_id === cv.id && x.direction === 'IN').pop(); if (m) C.customerDeleted(m.id); } else { const r1 = C.receive({ channel_id: cv.channel_id, from: ct.external_user_id, text: v.text, msg_type: v.k === 'GROUP' ? 'TEXT' : v.k, group: v.k === 'GROUP' }); if (r1.discarded) toast('RN-CRM-11: mensaje de grupo descartado en el webhook (coexistencia).', 'info'); } close(); G.refresh(); return true; } catch (e) { return e.message; } } })));
  }
  function tagsModal(cv) {
    const all = ['Cliente frecuente', 'Anuncio', 'Recompra', 'Reclamo', 'Mayorista', 'Evento', 'Provincia', 'Pregunta de precio'];
    modal('Etiquetas', (b, close) => { const sel = new Set(cv.tags || []); const box = h('div', { class: 'row' }); const draw = () => { G.ui.clear(box); for (const t of all) box.appendChild(btn(t, () => { sel.has(t) ? sel.delete(t) : sel.add(t); draw(); }, { sm: true, kind: sel.has(t) ? 'primary' : '' })); }; draw(); b.append(box); },
      [{ label: 'Cancelar' }, { label: 'Guardar', kind: 'primary', onClick: () => { const btns = document.querySelectorAll('.modal .btn.primary.sm'); upd('conversations', cv.id, { tags: [...btns].map(x => x.textContent) }); toast('Etiquetas guardadas', 'ok'); G.refresh(); } }]);
  }
  function closeModal(cv) {
    const has = !!G.db.find('conversation_orders', x => x.conversation_id === cv.id);
    modal('Cerrar conversación', (b, close) => b.append(form({ id: 'crm-close', fields: [{ key: 'r', label: 'Motivo', type: 'select', required: true, options: CLOSE.filter(c => has || c[0] !== 'ORDER_CREATED') }], values: { r: has ? 'ORDER_CREATED' : 'NO_PURCHASE' }, submitLabel: 'Cerrar', onCancel: close, onSubmit: v => { try { C.close(cv.id, v.r); close(); toast('Conversación cerrada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })));
  }
  function reassignModal(cv) {
    const ms = C.memberRows(cv.channel_id);
    modal('Reasignar o tomar el chat', (b, close) => b.append(form({ id: 'crm-reas', fields: [{ key: 'u', label: 'Asignar a', type: 'select', options: ms.map(m => [m.user_id, `${G.userName(m.user_id)} · ${m.member_role === 'SUPERVISOR' ? 'supervisora' : 'vendedora'} · ${G.ui.statusLabel(C.agentStatus(m.user_id))} · ${C.openCount(m.user_id)} abiertos`]) }, { key: 'n', label: 'Nota', type: 'text' }], values: { u: ms.find(m => m.user_id === me()) ? me() : '' }, submitLabel: 'Reasignar', onCancel: close,
      onSubmit: v => { try { C.reassign(cv.id, v.u || null, { note: v.n }); close(); toast(v.u ? 'Chat reasignado' : 'Chat devuelto a la cola', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })));
  }
  function convHeader(cv, { compact } = {}) {
    const ch = chan(cv.channel_id); const at = C.now(); const ct = G.db.get('channel_contacts', cv.contact_id) || {};
    const acts = [];
    if (G.can('crm.conversation.create_order') && C.canReply(cv, me()) && cv.status !== 'CLOSED') acts.push(btn('Crear pedido', () => G.go('CRM-03', { id: cv.id }), { kind: 'primary', sm: true }));
    if (G.can('crm.conversation.reassign')) acts.push(btn('Reasignar', () => reassignModal(cv), { sm: true }));
    acts.push(btn('Etiquetas', () => tagsModal(cv), { sm: true }));
    acts.push(cv.status === 'CLOSED' ? btn('Reabrir', () => act(() => C.reopen(cv.id), 'Conversación reabierta'), { sm: true }) : btn('Cerrar', () => closeModal(cv), { sm: true }));
    if (cv.customer_id && G.can('crm.customer.view_full')) acts.push(btn('Ficha 360', () => G.go('CRM-04', { id: cv.customer_id }), { sm: true, kind: 'ghost' }));
    if (compact) acts.push(btn('Abrir', () => goConv(cv.id), { sm: true, kind: 'ghost' }));
    acts.push(btn('Simular cliente', () => simulateModal(cv), { sm: true, kind: 'ghost', title: 'Entrada de prueba por webhook' }));
    const nAl = G.can('crm.alert.review') ? G.db.where('control_alerts', a => a.conversation_id === cv.id && ['OPEN', 'UNDER_REVIEW'].includes(a.status)).length : 0;
    return h('div', { class: 'stack' }, h('div', { class: 'crm-head' },
      h('div', { style: 'min-width:0' }, h('div', { class: 'row' }, h('b', { style: 'font-size:1.05rem' }, C.contactName(cv)), cst(cv.status), cv.customer_id ? badge('Cliente', 'ok') : badge('Lead', 'info')),
        h('div', { class: 'small muted' }, `${C.chLabel(ch)} · ${ct.phone || ct.external_user_id || ''} · ${ENTRY[cv.entry_point]}${cv.ad_code ? ' ' + cv.ad_code : ''} · ${cv.assigned_user_id ? 'Atiende ' + G.userName(cv.assigned_user_id) : 'En cola'}`),
        h('div', { class: 'row', style: 'gap:6px;margin-top:4px' }, ...winBadges(cv, at), ...(cv.tags || []).map(t => h('span', { class: 'crm-tag' }, t)))),
      h('div', { class: 'row' }, acts)), nAl ? notice(h('span', null, `${nAl} alerta(s) de control abiertas en este chat. `, h('a', { href: '#', on: { click: e => { e.preventDefault(); G.go('CRM-12', { conv: cv.id }); } } }, 'Revisar')), 'bad') : null);
  }
  function convPanel(cv, opts = {}) { return card(null, h('div', { class: 'stack' }, convHeader(cv, opts), chatView(cv), composer(cv))); }

  /* =====================================================================
     Pantallas
     ===================================================================== */
  const pg = (el, code, sub, actions) => G.ui.page(el, { code, title: G.screens[code].name, sub, actions });
  function convFiltered(at) {
    const all = C.visible(G.db.all('conversations')); const ulim = G.param('crm_unanswered_alert_minutes') ?? 15;
    return all.filter(c => (S.st === 'ALL' || (S.st === 'OPEN' ? c.status !== 'CLOSED' : c.status === 'CLOSED'))
      && (!S.ch || c.channel_id === S.ch) && (!S.kind || chan(c.channel_id).kind === S.kind)
      && (!S.who || (S.who === 'none' ? !c.assigned_user_id : S.who === 'me' ? c.assigned_user_id === me() : c.assigned_user_id === S.who))
      && (!S.unanswered || C.waitMins(c, at) > ulim) && (!S.expiring || (() => { const w = C.windows(c, at); return w.inService && w.svcLeft < 120; })())
      && (!S.ad || ['CTWA_AD', 'TRACKING_CODE', 'TIKTOK_DM'].includes(c.entry_point))
      && (!S.q || norm(C.contactName(c) + ' ' + ((G.db.get('channel_contacts', c.contact_id) || {}).external_user_id || '')).includes(norm(S.q))));
  }
  function rInbox(el) {
    C.sweep(); const at = C.now();
    if (G.ctx.role === 'VENDEDORA' && S.who === '' && !S._init) { S.who = 'me'; S._init = true; }
    const body = pg(el, 'CRM-01', 'Chats de los números y cuentas donde atiendes. Cada fila muestra la red, el número, el tiempo sin respuesta y la ventana vigente.');
    const vis = C.visible(G.db.all('conversations')).filter(c => c.status !== 'CLOSED'); const ulim = G.param('crm_unanswered_alert_minutes') ?? 15;
    body.appendChild(kpis([
      { label: 'Abiertas', value: vis.length, onClick: () => { Object.assign(S, { st: 'OPEN', who: '', unanswered: false, expiring: false, ad: false }); G.refresh(); } },
      { label: 'En cola', value: vis.filter(c => !c.assigned_user_id).length, tone: vis.some(c => !c.assigned_user_id) ? 'warn' : '', onClick: () => { S.who = 'none'; G.refresh(); } },
      { label: `Sin responder > ${ulim} min`, value: vis.filter(c => C.waitMins(c, at) > ulim).length, tone: 'bad', onClick: () => { S.unanswered = true; G.refresh(); } },
      { label: 'Ventana por vencer (< 2 h)', value: vis.filter(c => { const w = C.windows(c, at); return w.inService && w.svcLeft < 120; }).length, onClick: () => { S.expiring = true; G.refresh(); } },
      { label: 'Llegaron por anuncio', value: vis.filter(c => ['CTWA_AD', 'TRACKING_CODE', 'TIKTOK_DM'].includes(c.entry_point)).length, onClick: () => { S.ad = true; G.refresh(); } },
    ]));
    const chs = C.channelsFor();
    const sel = (key, label, options) => { const s = h('select', { class: 'input', attrs: { 'aria-label': label } }, h('option', { value: '' }, label + ': todos'), options.map(([v, l]) => h('option', { value: v, selected: S[key] === v }, l))); s.addEventListener('change', () => { S[key] = s.value; G.refresh(); }); return s; };
    const chk = (key, label) => h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: S[key], on: { change: e => { S[key] = e.target.checked; G.refresh(); } } }), h('span', null, label));
    const search = h('input', { class: 'input search', placeholder: 'Buscar contacto o número…', value: S.q, attrs: { 'aria-label': 'Buscar' } });
    const listBox = h('div', { class: 'crm-list' });
    const pane = h('div', { class: 'crm-pane' });
    const drawList = () => {
      G.ui.clear(listBox); const lm = lastMsgMap();
      const rows = convFiltered(at).sort((a, b) => ((lm.get(b.id) || {}).sent_at || '').localeCompare((lm.get(a.id) || {}).sent_at || ''));
      if (!rows.length) listBox.appendChild(G.ui.empty('No hay conversaciones con estos filtros.'));
      for (const cv of rows.slice(0, 120)) listBox.appendChild(convItem(cv, at, lm.get(cv.id), c => { if (window.innerWidth < 900) return goConv(c.id); S.sel = c.id; G.refresh(); }));
      if (!S.sel || !rows.find(r => r.id === S.sel)) S.sel = rows[0] ? rows[0].id : null;
    };
    search.addEventListener('input', () => { S.q = search.value; drawList(); });
    drawList();
    const filters = h('div', { class: 'stack', style: 'padding:10px 12px;border-bottom:1px solid var(--line)' },
      pills([['OPEN', 'Abiertas'], ['CLOSED', 'Cerradas'], ['ALL', 'Todas']], S.st, v => { S.st = v; G.refresh(); }), search,
      h('div', { class: 'row' }, sel('ch', 'Número', chs.map(c => [c.id, `${kindTag(c.kind)} · ${c.display_name}`])), sel('kind', 'Red', Object.keys(KIND).map(k => [k, kindName(k)])),
        sel('who', 'Asignada', [['me', 'A mí'], ['none', 'En cola']].concat(G.db.where('users', u => u.role === 'VENDEDORA' || u.role === 'SUPERVISORA_VENTAS').map(u => [u.id, G.userShort(u.id)])))),
      h('div', { class: 'row' }, chk('unanswered', 'Sin responder'), chk('expiring', 'Ventana por vencer'), chk('ad', 'Llegó por anuncio')));
    const cv = S.sel && conv(S.sel);
    pane.appendChild(cv ? convPanel(cv, { compact: true }) : card(null, G.ui.empty('Elige una conversación.')));
    body.appendChild(h('div', { class: 'crm-inbox' }, h('section', { class: 'card', style: 'overflow:hidden' }, filters, listBox), pane));
  }
  function rConv(el, params) {
    let cv = params && params.id && conv(params.id);
    if (!cv) { const vis = C.visible(G.db.where('conversations', c => c.status !== 'CLOSED')); cv = vis.find(c => c.assigned_user_id === me()) || vis[0]; }
    const body = pg(el, 'CRM-02', 'Hilo completo con texto, fotos, audios transcritos y ubicación; responde con atajos, catálogo y plantillas y mira cuánto cuesta el próximo mensaje.', [btn('Bandeja', () => G.go('CRM-01'), { sm: true })]);
    if (!cv) { body.appendChild(G.ui.empty('No hay conversaciones visibles para tu usuario.')); return; }
    if (!C.visible([cv]).length) { body.appendChild(notice('RN-CRM-03: no eres miembro del número de esta conversación.', 'bad')); return; }
    S.sel = cv.id;
    body.appendChild(h('div', { class: 'grid side-r' }, convPanel(cv), sidePanel(cv)));
  }
  function sidePanel(cv) {
    const c = cv.customer_id && G.db.get('customers', cv.customer_id); const lead = cv.lead_id && G.db.get('leads', cv.lead_id);
    const parts = [];
    if (c) {
      const os = G.db.where('sales_orders', o => o.customer_id === c.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
      const due = U.sum(os.filter(o => !['CANCELLED', 'DRAFT'].includes(o.status)), o => Math.min(0, C.balanceOf(o)));
      const prof = G.db.find('customer_rebuy_profiles', p => p.customer_id === c.id && p.brand_id === cv.brand_id); const mk = C.consentState(c.id, cv.contact_id);
      parts.push(card('Cliente', h('div', { class: 'stack' }, dl([['Nombre', c.full_name], ['Celular', c.phone], ['Documento', c.doc_number ? `${c.doc_type} ${c.doc_number}` : 'Sin documento'], ['Pedidos', `${os.length} · último ${os[0] ? G.fmt.date(os[0].created_at) : '—'}`], ['Saldo por cobrar', G.fmt.money(-due)], ['Recompra', prof ? `${REBUY[prof.status][0]}${prof.median_interval_days ? ' · cada ' + G.fmt.num(prof.median_interval_days, 0) + ' días' : ''}` : '—'], ['Marketing', mk === true ? badge('Consentimiento otorgado', 'ok') : mk === false ? badge('Dio de baja', 'bad') : badge('Sin consentimiento', '')]]),
        G.can('crm.customer.view_full') ? btn('Ver ficha 360', () => G.go('CRM-04', { id: c.id }), { sm: true }) : null)));
      parts.push(card('Pedidos recientes', os.length ? h('div', { class: 'stack' }, os.slice(0, 5).map(o => h('div', { class: 'row between small' }, h('span', { class: 'mono' }, o.number), G.ui.status(o.status), h('span', null, G.fmt.money(o.final_total ?? o.estimated_total))))) : G.ui.empty('Sin pedidos.')));
    }
    if (lead) parts.push(card('Lead', dl([['Estado', lbl(LSTATUS, lead.status)], ['Origen', kindName(lead.source)], ['Anuncio', lead.ad_code || '—'], ['Primer contacto', G.fmt.datetime(lead.first_contact_at)], lead.lost_reason ? ['Motivo de pérdida', lbl(LOST, lead.lost_reason)] : null])));
    const links = G.db.where('conversation_orders', x => x.conversation_id === cv.id);
    parts.push(card('Pedido de este chat', links.length ? h('div', { class: 'stack' }, links.map(x => { const o = G.db.get('sales_orders', x.order_id); return o ? h('div', { class: 'stack', style: 'gap:2px' }, h('div', { class: 'row between' }, h('b', { class: 'mono' }, o.number), G.ui.status(o.status)), h('span', { class: 'small muted' }, `${G.fmt.money(o.final_total ?? o.estimated_total)} · origen ${o.origin_wa_number || G.channelName(o.channel)} · anuncio ${o.origin_ad_code || '—'}`), G.screens['PED-02'] ? btn('Abrir en Pedidos', () => G.go('PED-02', { id: o.id }), { sm: true }) : null) : null; })) : h('div', { class: 'stack' }, h('span', { class: 'small muted' }, 'Aún no hay pedido vinculado.'), G.can('crm.conversation.create_order') && C.canReply(cv, me()) ? btn('Crear pedido', () => G.go('CRM-03', { id: cv.id }), { sm: true, kind: 'primary' }) : null)));
    const tasks = G.db.where('crm_tasks', t => t.status === 'OPEN' && (t.conversation_id === cv.id || (cv.customer_id && t.customer_id === cv.customer_id)));
    if (tasks.length) parts.push(card('Tareas abiertas', h('div', { class: 'stack' }, tasks.map(t => h('div', { class: 'small' }, h('b', null, TASK[t.task_type]), ' · vence ', G.fmt.datetime(t.due_at), t.note ? h('div', { class: 'muted' }, t.note) : null)))));
    return h('div', { class: 'stack' }, parts);
  }

  /* ---------- CRM-03 Crear pedido desde el chat ---------- */
  function rCreate(el, params) {
    const cv = params && params.id && conv(params.id);
    const body = pg(el, 'CRM-03', 'Borrador de pedido con cliente, celular, canal, número de origen, marca, vendedora y anuncio ya llenos. Al guardar se envía el resumen con el enlace de pago de la empresa en un solo mensaje.');
    if (!cv) {
      const linked = new Set(G.db.all('conversation_orders').map(x => x.conversation_id));
      const rows = C.visible(G.db.where('conversations', c => c.status !== 'CLOSED' && !linked.has(c.id)));
      body.appendChild(notice('Elige el chat desde el que nace el pedido (RN-CRM-09: un pedido pertenece a una sola conversación).', 'info'));
      body.appendChild(table({ id: 'crm03-pick', columns: [{ key: 'n', label: 'Contacto', value: c => C.contactName(c) }, { key: 'ch', label: 'Número', value: c => C.chLabel(chan(c.channel_id)) }, { key: 'a', label: 'Atiende', value: c => G.userShort(c.assigned_user_id) }, { key: 'e', label: 'Entrada', value: c => ENTRY[c.entry_point] + (c.ad_code ? ' ' + c.ad_code : '') }], rows, onRow: c => G.go('CRM-03', { id: c.id }) }));
      return;
    }
    if (!G.can('crm.conversation.create_order') || !C.canReply(cv, me())) { body.appendChild(notice('RN-CRM-03 / RN-CRM-09: solo la vendedora asignada o la supervisora crea el pedido de este chat.', 'bad')); return; }
    const og = C.orderOrigin(cv); const c = cv.customer_id && G.db.get('customers', cv.customer_id); const ct = G.db.get('channel_contacts', cv.contact_id) || {};
    const lead = cv.lead_id && G.db.get('leads', cv.lead_id);
    const addrs = c ? G.db.where('customer_addresses', a => a.customer_id === c.id && a.status !== 'INACTIVE') : [];
    const st = { customer: { full_name: (lead && lead.full_name) || ct.display_name || '', phone: ct.phone || '', doc_number: '' }, address_id: (addrs.find(a => a.is_default) || addrs[0] || {}).id || '', newAddr: { address_line: '', reference: '', lat: null, lng: null }, fulfillment: 'DELIVERY', delivery_date: G.date.add(G.TODAY, 1), slot_id: '', payment_method_id: 'pm-YAPE', requested_doc_type: c && c.doc_type === 'RUC' ? 'INVOICE' : 'RECEIPT', notes: '', lines: [] };
    const vs = G.db.where('product_variants', v => v.brand_id === cv.brand_id && v.status === 'ACTIVE' && v.sellable);
    body.appendChild(card('Origen del pedido (no editable · RN-PED-16)', dl([['Canal', G.channelName(og.channel)], ['Número de origen', og.origin_wa_number || C.chLabel(chan(cv.channel_id))], ['Marca', G.brandFull(og.brand_id)], ['Vendedora', G.userName(og.seller_id)], ['Anuncio', og.origin_ad_code ? `${og.origin_ad_code} · ${ENTRY[cv.entry_point]}` : 'Sin anuncio (orgánico)'], ['Conversación', C.contactName(cv)]])));
    const inp = (obj, key, attrs = {}) => { const i = h('input', Object.assign({ class: 'input', value: obj[key] ?? '' }, attrs)); i.addEventListener('change', () => { obj[key] = attrs.type === 'number' ? Number(i.value) : i.value; draw(); }); return i; };
    const field = (label, node) => h('div', { class: 'field' }, h('label', null, label), node);
    const selN = (obj, key, options, onCh) => { const s = h('select', { class: 'input' }, options.map(([v, l]) => h('option', { value: v, selected: String(obj[key]) === String(v) }, l))); s.addEventListener('change', () => { obj[key] = s.value; if (onCh) onCh(); draw(); }); return s; };
    const custCard = c ? card('Cliente', dl([['Cliente', c.full_name], ['Celular', c.phone], ['Documento', c.doc_number || 'Sin documento']])) : card('Cliente nuevo (el lead pasa a cliente con su primer pedido · RN-CRM-10)', h('div', { class: 'form-grid' }, field('Nombre completo *', inp(st.customer, 'full_name')), field('Celular (E.164)', ct.phone ? h('input', { class: 'input', value: ct.phone, readOnly: true }) : inp(st.customer, 'phone', { placeholder: '+519…' })), field('DNI (opcional)', inp(st.customer, 'doc_number'))));
    const zoneOf = () => { const a = st.address_id && G.db.get('customer_addresses', st.address_id); const z = a ? a.zone_id : st.newAddr.lat != null && G.geo ? (G.geo.zoneAt(st.newAddr.lat, st.newAddr.lng) || {}).id : null; return z && G.db.get('delivery_zones', z); };
    const slotOpts = () => { const z = zoneOf(); const est = z ? z.establishment_id : 'es-L1'; return G.db.where('order_time_slots', s => s.establishment_id === est && s.status === 'ACTIVE').map(s => [s.id, `${s.name} · ${G.siteName(est)}`]); };
    const mapBox = h('div');
    const delivCard = card('Entrega y pago', h('div', { class: 'stack' }, h('div', { class: 'form-grid' },
      field('Modalidad', selN(st, 'fulfillment', G.FULFILL.filter(f => f[0] !== 'COUNTER'))),
      field('Dirección', selN(st, 'address_id', addrs.map(a => [a.id, `${a.label}: ${a.address_line}${a.lat == null ? ' (sin pin)' : ''}`]).concat([['', 'Nueva dirección…']]), () => drawMap())),
      field('Fecha', inp(st, 'delivery_date', { type: 'date' })), field('Franja', (() => { const opts = slotOpts(); if (!st.slot_id && opts[0]) st.slot_id = opts[0][0]; return selN(st, 'slot_id', opts); })()),
      field('Forma de pago', selN(st, 'payment_method_id', G.db.where('payment_methods', p => p.id !== 'pm-CREDIT').map(p => [p.id, p.name]))), field('Comprobante', selN(st, 'requested_doc_type', [['RECEIPT', 'Boleta'], ['INVOICE', 'Factura']])),
      h('div', { class: 'field span2' }, h('label', null, 'Notas de preparación'), inp(st, 'notes', { placeholder: 'Cortes, limpieza, llamar antes…' }))), mapBox));
    function drawMap() { G.ui.clear(mapBox); if (st.address_id) return; mapBox.append(h('div', { class: 'form-grid' }, field('Dirección', inp(st.newAddr, 'address_line')), field('Referencia', inp(st.newAddr, 'reference'))), h('div', { class: 'small muted' }, 'Marca el pin en el mapa (RN-PED-01 exige dirección con referencia y pin).'), G.ui.map({ height: 240, pick: st.newAddr.lat != null ? { lat: st.newAddr.lat, lng: st.newAddr.lng } : null, onPick: (lat, lng) => { st.newAddr.lat = lat; st.newAddr.lng = lng; draw(); } })); }
    drawMap();
    const linesBox = h('div', { class: 'stack' }); const sum = h('div', { class: 'stack' }); const prev = h('div', { class: 'msg out', style: 'max-width:100%;white-space:pre-wrap' });
    const addSel = h('select', { class: 'input', attrs: { 'aria-label': 'Producto' } }, vs.map(v => h('option', { value: v.id }, v.name)));
    const linesCard = card('Productos (solo del catálogo de la marca · RN-PED-02)', h('div', { class: 'stack' }, linesBox, h('div', { class: 'row' }, addSel, btn('Agregar', () => { const v = G.variant(addSel.value); st.lines.push({ variant_id: v.id, qty: v.sale_mode === 'KG' ? 1 : 1, est_weight_kg: v.sale_mode === 'UNIT_VARIABLE_WEIGHT' ? v.nominal_weight_kg : v.sale_mode === 'KG' ? 1 : null, cut_notes: '' }); draw(); }, { sm: true })), sum));
    function tmpOrder() { const z = zoneOf(); const o = { brand_id: cv.brand_id, channel: og.channel, customer_id: c ? c.id : null, fulfillment: st.fulfillment, zone_id: z ? z.id : null, lines: [], status: 'DRAFT' }; for (const l of st.lines) { try { G.orders.addLine(o, { variant_id: l.variant_id, qty: l.qty, est_weight_kg: l.est_weight_kg }, { noRecalc: true }); } catch (e) { } } G.orders.recalc(o); return o; }
    function draw() {
      G.ui.clear(linesBox);
      st.lines.forEach((l, i) => { const v = G.variant(l.variant_id); linesBox.appendChild(h('div', { class: 'row' }, h('b', { style: 'min-width:160px' }, v.name), h('label', { class: 'small' }, v.sale_mode === 'KG' ? 'kg' : 'Cant.'), inp(l, 'qty', { type: 'number', min: 0.25, step: v.sale_mode === 'KG' ? 0.25 : 1, style: 'width:80px' }), v.sale_mode !== 'UNIT' ? [h('label', { class: 'small' }, 'Peso est. kg'), inp(l, 'est_weight_kg', { type: 'number', step: 0.05, style: 'width:90px' })] : null, inp(l, 'cut_notes', { placeholder: 'Corte', style: 'width:140px' }), btn('Quitar', () => { st.lines.splice(i, 1); draw(); }, { sm: true, kind: 'ghost' }))); });
      for (const l of st.lines) { const v = G.variant(l.variant_id); if (v.sale_mode === 'KG') l.est_weight_kg = l.qty; }
      const o = tmpOrder(); G.ui.clear(sum);
      sum.append(dl([['Peso estimado', o.est_kg ? G.fmt.kg(o.est_kg, 3) : '—'], ['Delivery', G.fmt.money(o.delivery_fee)], ['Total estimado (IGV incluido)', h('b', null, G.fmt.money(o.estimated_total))]]));
      const tpl = C.templateFor(cv.brand_id, 'ORDER_CONFIRMATION'); const vars = C.orderVars(Object.assign({ number: 'P-(nuevo)', customer_id: c ? c.id : null, delivery_date: st.delivery_date, slot_from: (G.db.get('order_time_slots', st.slot_id) || {}).slot_from, slot_to: (G.db.get('order_time_slots', st.slot_id) || {}).slot_to, address_id: st.address_id, pickup_establishment_id: 'es-L1' }, o));
      if (!c) vars.cliente = (st.customer.full_name || 'cliente').split(' ')[0]; if (!st.address_id && st.newAddr.address_line) vars.direccion = st.newAddr.address_line;
      prev.textContent = chan(cv.channel_id).kind === 'WHATSAPP' && tpl ? C.fill(tpl.body, vars) : `Pedido de ${vars.marca}:\n${vars.productos}\nTotal estimado ${vars.total}`;
    }
    const cost = C.nextCost(cv, 'UTILITY');
    body.appendChild(h('div', { class: 'grid side-r' }, h('div', { class: 'stack' }, custCard, delivCard, linesCard), h('div', { class: 'stack' }, card('Mensaje que recibirá el cliente (RN-CRM-22)', h('div', { class: 'stack' }, prev, h('div', { class: 'small muted' }, `Plantilla de confirmación · ${cost.amount ? G.fmt.money(cost.amount, 4) : 'gratis'} (${CHARGE_R[cost.reason] || 'no es WhatsApp'}). La vendedora no escribe números de cuenta.`))),
      card(null, h('div', { class: 'stack' }, btn('Guardar pedido y enviar resumen', () => {
        try {
          const res = C.createOrder(cv.id, { customer: st.customer, address_id: st.address_id || null, address: st.address_id ? null : st.newAddr, fulfillment: st.fulfillment, delivery_date: st.delivery_date, slot_id: st.slot_id, payment_method_id: st.payment_method_id, requested_doc_type: st.requested_doc_type, notes: st.notes, lines: st.lines.map(l => ({ variant_id: l.variant_id, qty: Number(l.qty), est_weight_kg: l.est_weight_kg != null ? Number(l.est_weight_kg) : undefined, cut_notes: l.cut_notes })) });
          const miss = G.orders.missing(res.order);
          toast(`Pedido ${res.order.number} guardado en borrador${res.message ? ' y resumen enviado' : ''}${res.summaryError ? ' · ' + res.summaryError : ''}${miss.length ? ' · falta para confirmar: ' + miss.join(', ') : ''}`, res.summaryError ? 'warn' : 'ok');
          G.go('CRM-02', { id: cv.id });
        } catch (e) { toast(e.message, 'bad'); }
      }, { kind: 'primary' }), btn('Volver al chat', () => goConv(cv.id)))))));
    draw();
  }

  /* ---------- CRM-04 Ficha 360 ---------- */
  function rCustomer(el, params) {
    const c = params && params.id && G.db.get('customers', params.id);
    const body = pg(el, 'CRM-04', 'Todo el cliente en un lugar: datos, direcciones con pin, pedidos y saldo, chats de todas las redes, encuestas, consentimientos, recompra y valor de vida.');
    if (!G.can('crm.customer.view_full')) { body.appendChild(notice('Tu rol no ve la ficha 360 (permiso crm.customer.view_full).', 'warn')); return; }
    if (!c) {
      const convC = new Set(C.visible(G.db.all('conversations')).map(x => x.customer_id).filter(Boolean));
      const rows = G.db.where('customers', x => x.status !== 'INACTIVE' && x.id !== 'cu-VARIOS' && (G.ctx.role !== 'VENDEDORA' || convC.has(x.id)));
      body.appendChild(table({ id: 'crm04', columns: [{ key: 'full_name', label: 'Cliente', value: x => x.trade_name || x.full_name }, { key: 'phone', label: 'Celular', mono: true }, { key: 'customer_type', label: 'Tipo' }, { key: 'orders_count', label: 'Pedidos', align: 'r' }, { key: 'last_order_at', label: 'Último pedido', render: x => G.fmt.date(x.last_order_at) }, { key: 'chat', label: 'Chats', align: 'r', value: x => convC.has(x.id) ? 'Sí' : '' }], rows, onRow: x => G.go('CRM-04', { id: x.id }), searchPlaceholder: 'Nombre, celular…' }));
      return;
    }
    const os = G.db.where('sales_orders', o => o.customer_id === c.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const pays = G.db.where('payments', p => p.customer_id === c.id && p.status === 'CONFIRMED');
    const ltv = U.sum(pays, p => p.amount); const bal = U.sum(os.filter(o => !['CANCELLED', 'DRAFT'].includes(o.status)), o => C.balanceOf(o));
    const convs = G.db.where('conversations', x => x.customer_id === c.id); const surveys = G.db.where('delivery_surveys', s => s.customer_id === c.id);
    const profs = G.db.where('customer_rebuy_profiles', p => p.customer_id === c.id); const cons = G.db.where('contact_consents', x => x.customer_id === c.id).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
    body.appendChild(kpis([{ label: 'Pedidos', value: os.length }, { label: 'Valor de vida (cobrado)', value: G.fmt.money(ltv) }, { label: bal < 0 ? 'Saldo por cobrar' : 'Saldo a favor', value: G.fmt.money(Math.abs(bal)), tone: bal < 0 ? 'warn' : '' }, { label: 'Chats', value: convs.length }, { label: 'Marketing', value: C.consentState(c.id, null) === true ? 'Otorgado' : C.consentState(c.id, null) === false ? 'Baja' : 'Sin registro' }]));
    const addrs = G.db.where('customer_addresses', a => a.customer_id === c.id);
    body.appendChild(tabs([
      { key: 'd', label: 'Datos y direcciones', render: p => p.append(h('div', { class: 'grid c2' }, card('Datos', dl([['Nombre', c.full_name], ['Nombre comercial', c.trade_name], ['Documento', c.doc_number ? `${c.doc_type} ${c.doc_number}` : 'Sin documento'], ['Celular', c.phone], ['Correo', c.email], ['Tipo', c.customer_type], ['Canal de origen', G.channelName(c.source_channel)], ['Marcas', (c.segment_brands || []).map(G.brandName).join(', ')]])), card('Direcciones con pin', h('div', { class: 'stack' }, addrs.map(a => h('div', { class: 'small' }, h('b', null, a.label + ': '), a.address_line, ' · ', a.reference || 'sin referencia', a.lat == null ? badge('Sin pin', 'warn') : null)), G.ui.map({ height: 220, points: addrs.filter(a => a.lat != null).map(a => ({ lat: a.lat, lng: a.lng, label: a.label, tone: 'primary' })) }))))) },
      { key: 'o', label: 'Pedidos', count: os.length, render: p => p.append(table({ id: 'crm04o', columns: [{ key: 'number', label: 'Pedido', mono: true }, { key: 'brand_id', label: 'Marca', render: o => G.brandName(o.brand_id) }, { key: 'channel', label: 'Canal', render: o => G.channelName(o.channel) }, { key: 'created_at', label: 'Fecha', render: o => G.fmt.date(o.created_at) }, { key: 'status', label: 'Estado', render: o => G.ui.status(o.status) }, { key: 't', label: 'Total', align: 'r', value: o => o.final_total ?? o.estimated_total, render: o => G.fmt.money(o.final_total ?? o.estimated_total) }, { key: 'paid_amount', label: 'Pagado', align: 'r', value: o => C.paidOf(o), render: o => G.fmt.money(C.paidOf(o)) }, { key: 'seller_id', label: 'Vendedora', render: o => G.userShort(o.seller_id) }], rows: os, onRow: o => G.screens['PED-02'] && G.go('PED-02', { id: o.id }) })) },
      { key: 'c', label: 'Chats', count: convs.length, render: p => p.append(table({ id: 'crm04c', columns: [{ key: 'ch', label: 'Número o cuenta', value: x => C.chLabel(chan(x.channel_id)) }, { key: 'opened_at', label: 'Abierta', render: x => G.fmt.datetime(x.opened_at) }, { key: 'status', label: 'Estado', render: x => cst(x.status) }, { key: 'a', label: 'Atendió', value: x => G.userShort(x.assigned_user_id) }, { key: 'e', label: 'Entrada', value: x => ENTRY[x.entry_point] }], rows: convs, onRow: x => goConv(x.id) })) },
      { key: 't', label: 'Llamadas', render: p => p.append(G.modOn('TEL') ? table({ id: 'crm04t', columns: [{ key: 'started_at', label: 'Fecha', render: x => G.fmt.datetime(x.started_at) }, { key: 'direction', label: 'Sentido' }, { key: 'duration_s', label: 'Duración (s)', align: 'r' }], rows: G.db.where('tel_calls', x => x.customer_id === c.id) }) : notice('RN-PLT-07: la telefonía (TEL) está incluida y apagada; cuando se active, aquí aparecen las llamadas con su grabación y transcripción.', 'info')) },
      { key: 's', label: 'Encuestas y reclamos', count: surveys.length, render: p => p.append(table({ id: 'crm04s', columns: [{ key: 'o', label: 'Pedido', value: s => (G.db.get('sales_orders', s.order_id) || {}).number }, { key: 'sent_at', label: 'Enviada', render: s => G.fmt.datetime(s.sent_at) }, { key: 'rating_service', label: 'Atención', align: 'r' }, { key: 'rating_product', label: 'Producto', align: 'r' }, { key: 'f', label: 'Señal', render: s => s.bought_outside_catalog ? badge('Compra fuera de la web', 'bad') : s.received_as_ordered === false ? badge('No recibió lo pedido', 'warn') : '' }, { key: 'comments', label: 'Comentario' }], rows: surveys })) },
      { key: 'k', label: 'Consentimientos', count: cons.length, render: p => p.append(table({ id: 'crm04k', columns: [{ key: 'recorded_at', label: 'Fecha', render: x => G.fmt.datetime(x.recorded_at) }, { key: 'purpose', label: 'Propósito', value: x => ({ DATA_PROCESSING: 'Tratamiento de datos', MARKETING: 'Marketing', RECORDING_NOTICE: 'Aviso de registro', SURVEY: 'Encuestas' })[x.purpose] }, { key: 'granted', label: 'Estado', render: x => x.granted ? badge('Otorgado', 'ok') : badge('Baja', 'bad') }, { key: 'evidence_text', label: 'Evidencia' }], rows: cons })) },
      { key: 'r', label: 'Recompra', render: p => p.append(table({ id: 'crm04r', columns: [{ key: 'brand_id', label: 'Marca', render: x => G.brandName(x.brand_id) }, { key: 'orders_count', label: 'Pedidos', align: 'r' }, { key: 'median_interval_days', label: 'Frecuencia (días)', align: 'r', render: x => G.fmt.num(x.median_interval_days, 1) }, { key: 'last_order_at', label: 'Último', render: x => G.fmt.date(x.last_order_at) }, { key: 'next_expected_at', label: 'Esperado', render: x => G.fmt.date(x.next_expected_at) }, { key: 'status', label: 'Estado', render: x => badge(REBUY[x.status][0], REBUY[x.status][1]) }], rows: profs })) },
    ], { key: 'crm04:' + c.id }));
  }

  /* ---------- CRM-05 Leads ---------- */
  function rLeads(el, params) {
    const body = pg(el, 'CRM-05', 'Embudo de leads por marca, red, número, anuncio y vendedora; un lead se gana solo con su pedido desde el chat y se pierde con motivo.', G.can('crm.lead.manage') ? [{ label: 'Nuevo lead', kind: 'primary', icon: '+', onClick: () => newLead() }] : []);
    const chIds = new Set(C.channelsFor().map(c => c.id));
    const rows = G.db.where('leads', l => (!l.channel_id || chIds.has(l.channel_id)) && G.scope.ok(l, { site: '_none' }));
    const cnt = s => rows.filter(l => l.status === s).length;
    body.appendChild(h('div', { class: 'crm-funnel' }, LSTATUS.map(([k, l]) => h('div', { class: 'kpi' + (k === 'WON' ? ' ok' : k === 'LOST' ? ' bad' : '') }, h('span', { class: 'lbl' }, l), h('span', { class: 'val' }, cnt(k)), h('span', { class: 'sub' }, rows.length ? G.fmt.pct(cnt(k) / rows.length * 100) : '—')))));
    const k4 = G.kpi('KPI-CRM-04') || {};
    body.appendChild(notice(`Conversión del mes (KPI-CRM-04): ${G.fmt.pct(k4.value)} · ${k4.numerator || 0} ganados de ${k4.denominator || 0} leads.`, 'info'));
    const convOf = l => G.db.find('conversations', c => c.lead_id === l.id);
    const t = table({ id: 'crm05', columns: [
      { key: 'full_name', label: 'Lead', value: l => l.full_name || l.phone || 'Contacto' }, { key: 'phone', label: 'Celular', mono: true },
      { key: 'source', label: 'Red', value: l => kindName(l.source) }, { key: 'ch', label: 'Número', value: l => (chan(l.channel_id) || {}).display_name }, { key: 'brand_id', label: 'Marca', value: l => G.brandName(l.brand_id) },
      { key: 'ad_code', label: 'Anuncio' }, { key: 'owner', label: 'Vendedora', value: l => G.userShort(l.owner_user_id || (convOf(l) || {}).assigned_user_id) },
      { key: 'first_contact_at', label: 'Primer contacto', render: l => G.fmt.datetime(l.first_contact_at) }, { key: 'status', label: 'Estado', value: l => l.status, render: l => badge(lbl(LSTATUS, l.status), { WON: 'ok', LOST: 'bad', NEW: 'info', QUALIFIED: 'info', CONTACTED: '', DISCARDED: '' }[l.status]) },
      { key: 'lost_reason', label: 'Motivo', value: l => l.lost_reason ? lbl(LOST, l.lost_reason) : '' }],
      rows: rows.sort((a, b) => b.first_contact_at.localeCompare(a.first_contact_at)), onRow: l => leadDrawer(l),
      filters: [{ key: 'status', label: 'Estado', options: LSTATUS }, { key: 'brand_id', label: 'Marca', options: G.scope.brands().map(b => [b.id, G.brandName(b.id)]) }, { key: 'source', label: 'Red', options: Object.keys(KIND).map(k => [k, kindName(k)]) }, { key: 'channel_id', label: 'Número', options: C.channelsFor().map(c => [c.id, c.display_name]) }, { key: 'ad', label: 'Anuncio', options: [['1', 'Con anuncio'], ['0', 'Orgánico']], value: l => l.ad_code ? '1' : '0' }] });
    body.appendChild(t);
    if (params && params.id) { const l = G.db.get('leads', params.id); if (l) setTimeout(() => leadDrawer(l), 0); }
    function leadDrawer(l) {
      drawer(l.full_name || l.phone || 'Lead', (b, close) => {
        const cv = convOf(l);
        b.append(dl([['Estado', lbl(LSTATUS, l.status)], ['Red y número', `${kindName(l.source)} · ${(chan(l.channel_id) || {}).display_name || '—'}`], ['Marca', G.brandFull(l.brand_id)], ['Anuncio', l.ad_code || 'Orgánico'], ['Primer contacto', G.fmt.datetime(l.first_contact_at)], ['Primera respuesta', G.fmt.datetime(l.first_response_at)], ['Pedido', l.converted_order_id ? (G.db.get('sales_orders', l.converted_order_id) || {}).number : '—'], ['Motivo de pérdida', l.lost_reason ? lbl(LOST, l.lost_reason) : '—'], ['Notas', l.notes]]));
        const canM = G.can('crm.lead.manage') && !['WON'].includes(l.status);
        b.append(h('div', { class: 'row' }, cv ? btn('Abrir chat', () => { close(); goConv(cv.id); }, { sm: true, kind: 'primary' }) : null,
          canM ? btn('Calificado', () => { if (act(() => C.setLeadStatus(l.id, 'QUALIFIED'), 'Lead calificado') !== false) close(); }, { sm: true }) : null,
          canM ? btn('Descartar', () => { if (act(() => C.setLeadStatus(l.id, 'DISCARDED'), 'Lead descartado') !== false) close(); }, { sm: true, kind: 'ghost' }) : null));
        if (canM) b.append(card('Marcar como perdido', form({ id: 'crm05-lost', fields: [{ key: 'reason', label: 'Motivo', type: 'select', options: LOST }, { key: 'note', label: 'Nota', type: 'text' }], submitLabel: 'Marcar perdido', onSubmit: v => { try { C.setLeadStatus(l.id, 'LOST', v); close(); toast('Lead perdido', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })));
        if (cv) b.append(card('Conversación', chatView(cv)));
      }, { wide: true, code: 'CRM-05' });
    }
    function newLead() {
      drawer('Nuevo lead', (b, close) => b.append(form({ id: 'crm05-new', fields: [{ key: 'full_name', label: 'Nombre', required: true }, { key: 'phone', label: 'Celular (+51…)', required: true }, { key: 'brand_id', label: 'Marca', type: 'select', required: true, options: G.scope.brands().map(x => [x.id, G.brandName(x.id)]) }, { key: 'source', label: 'Origen', type: 'select', required: true, options: [['PHONE', 'Teléfono'], ['WALK_IN', 'Visita al local'], ['REFERRAL', 'Referido'], ['WEB_FORM', 'Formulario web'], ['OTHER', 'Otro']] }, { key: 'notes', label: 'Notas', type: 'textarea' }], submitLabel: 'Crear lead', onCancel: close,
        onSubmit: v => { if (!U.phoneOk(v.phone)) return { phone: 'Usa formato E.164: +51 seguido de 9 dígitos.' }; const cu2 = G.db.find('customers', x => x.phone === v.phone); if (cu2) return `RN-CRM-10: ${cu2.full_name} ya es cliente con ese celular; no se crea lead.`; if (G.db.find('leads', x => x.phone === v.phone && !['LOST', 'DISCARDED'].includes(x.status))) return 'Ya hay un lead abierto con ese celular.'; G.db.insert('leads', Object.assign({}, v, { status: 'NEW', first_contact_at: C.now(), owner_user_id: me(), channel_id: null })); close(); toast('Lead creado', 'ok'); G.refresh(); return true; } })));
    }
  }

  /* ---------- CRM-06 Supervisión en vivo ---------- */
  function rSupervision(el) {
    C.sweep(); const at = C.now();
    const body = pg(el, 'CRM-06', 'Para la supervisora: chats abiertos por vendedora, cola sin asignar, chats sin responder y tiempos de primera respuesta del día; reasigna o toma un chat.');
    const vis = C.visible(G.db.where('conversations', c => c.status !== 'CLOSED')); const ulim = G.param('crm_unanswered_alert_minutes') ?? 15; const qlim = G.param('crm_unassigned_alert_minutes') ?? 5;
    const today = C.visible(G.db.where('conversations', c => c.opened_at.slice(0, 10) === G.TODAY && c.first_response_at)); const frts = today.map(C.frt);
    const sellers = G.db.where('users', u => u.role === 'VENDEDORA' && C.channelsFor().some(ch => C.isMember(ch.id, u.id)));
    const queue = vis.filter(c => !c.assigned_user_id); const unans = vis.filter(c => C.waitMins(c, at) > ulim);
    body.appendChild(kpis([{ label: 'Chats abiertos', value: vis.length }, { label: 'En cola', value: queue.length, tone: queue.some(c => c.queued_at && mins(at, c.queued_at) > qlim) ? 'bad' : '' }, { label: `Sin responder > ${ulim} min`, value: unans.length, tone: unans.length ? 'bad' : 'ok' }, { label: 'Primera respuesta (mediana hoy)', value: frts.length ? dur(median(frts)) : '—', sub: `Meta ${G.param('crm_first_response_target_minutes')} min · ${frts.length} chats`, tone: frts.length && median(frts) > G.param('crm_first_response_target_minutes') ? 'warn' : 'ok' }, { label: 'Vendedoras en línea', value: `${sellers.filter(u => C.agentStatus(u.id) === 'ONLINE').length} de ${sellers.length}` }]));
    const canR = G.can('crm.conversation.reassign');
    const convTable = (id, rows, empty) => table({ id, columns: [{ key: 'n', label: 'Contacto', value: c => C.contactName(c) }, { key: 'ch', label: 'Número', value: c => C.chLabel(chan(c.channel_id)) }, { key: 'a', label: 'Atiende', value: c => c.assigned_user_id ? G.userShort(c.assigned_user_id) : 'En cola' }, { key: 'w', label: 'Esperando', value: c => C.waitMins(c, at), render: c => badge(dur(c.assigned_user_id ? C.waitMins(c, at) : mins(at, c.queued_at || c.opened_at)), 'bad') }], rows, empty, onRow: c => goConv(c.id), pageSize: 8,
      actions: c => canR ? [btn('Reasignar', () => reassignModal(c), { sm: true }), C.isMember(c.channel_id, me()) ? btn('Tomar', () => act(() => C.reassign(c.id, me()), 'Chat tomado'), { sm: true, kind: 'primary' }) : null] : [] });
    body.appendChild(h('div', { class: 'grid c2' }, card('Cola sin asignar (RN-CRM-02)', convTable('crm06q', queue, 'No hay chats en cola.'), { flush: true }), card(`Sin responder más de ${ulim} min (RN-CRM-14)`, convTable('crm06u', unans, 'Todos los chats tienen respuesta.'), { flush: true })));
    const frtBy = U.groupBy(today, 'assigned_user_id');
    const ordersToday = U.groupBy(G.db.where('sales_orders', o => o.created_at.slice(0, 10) === G.TODAY && o.seller_id), 'seller_id');
    const alertsBy = U.groupBy(G.db.where('control_alerts', a => ['OPEN', 'UNDER_REVIEW'].includes(a.status)), 'user_id');
    body.appendChild(card('Vendedoras', table({ id: 'crm06s', search: false, columns: [
      { key: 'name', label: 'Vendedora', value: u => u.name }, { key: 'st', label: 'Estado', value: u => C.agentStatus(u.id), render: u => G.ui.status(C.agentStatus(u.id)) },
      { key: 'ch', label: 'Números', value: u => C.channelsFor().filter(ch => C.isMember(ch.id, u.id)).map(ch => kindTag(ch.kind) + ' ' + ch.display_name).join(', ') },
      { key: 'open', label: 'Abiertos / tope', value: u => C.openCount(u.id), render: u => h('div', { style: 'min-width:120px' }, h('span', { class: 'small' }, `${C.openCount(u.id)} / ${G.param('crm_max_open_conversations')}`), G.ui.progress(C.openCount(u.id) / G.param('crm_max_open_conversations') * 100)) },
      { key: 'un', label: 'Sin responder', align: 'r', value: u => vis.filter(c => c.assigned_user_id === u.id && C.waitMins(c, at) > ulim).length },
      { key: 'frt', label: '1.ª respuesta hoy', align: 'r', value: u => { const xs = (frtBy[u.id] || []).map(C.frt); return xs.length ? R(median(xs), 1) : null; }, render: u => { const xs = (frtBy[u.id] || []).map(C.frt); return xs.length ? dur(median(xs)) : '—'; } },
      { key: 'ord', label: 'Pedidos hoy', align: 'r', value: u => (ordersToday[u.id] || []).length },
      { key: 'al', label: 'Alertas abiertas', align: 'r', value: u => (alertsBy[u.id] || []).length, render: u => (alertsBy[u.id] || []).length ? badge(String((alertsBy[u.id] || []).length), 'bad') : '0' }],
      rows: sellers, actions: u => G.can('crm.channel.manage') || canR ? [h('select', { class: 'input', attrs: { 'aria-label': 'Estado' }, on: { change: e => { C.setAgentStatus(u.id, e.target.value); toast('Estado actualizado', 'ok'); G.refresh(); } } }, ['ONLINE', 'AWAY', 'OFFLINE'].map(s => h('option', { value: s, selected: C.agentStatus(u.id) === s }, G.ui.statusLabel(s))))] : [] }), { flush: true }));
  }

  /* ---------- CRM-07 Números y cuentas ---------- */
  function rChannels(el) {
    const can = G.can('crm.channel.manage'); const period = G.date.month(G.TODAY);
    const body = pg(el, 'CRM-07', 'Cada número de WhatsApp se conecta una sola vez por la API oficial con coexistencia (proveedor oficial); no existe conexión por QR. Las credenciales las carga el administrador en INT.', can ? [{ label: 'Conectar número o cuenta', kind: 'primary', icon: '+', onClick: () => edit(null) }] : []);
    body.appendChild(notice('RN-CRM-01: sin conectores por QR de WhatsApp Web (rompen las reglas de WhatsApp y ponen en riesgo el número de la publicidad). Con coexistencia el número sigue en la app WhatsApp Business del celular y se sincronizan 6 meses de historial; los grupos no se sincronizan y las listas de difusión quedan de solo lectura. D-CRM-01: adaptador genérico de Cloud API (proveedor por definir).', 'info'));
    const rows = G.scope.filter(G.db.all('messaging_channels'), { site: '_none' });
    body.appendChild(table({ id: 'crm07', columns: [
      { key: 'kind', label: 'Red', value: c => kindName(c.kind) }, { key: 'display_name', label: 'Nombre' }, { key: 'number', label: 'Número o cuenta', mono: true }, { key: 'brand_id', label: 'Marca', value: c => G.brandName(c.brand_id) },
      { key: 'connection_mode', label: 'Conexión', render: c => badge(CONN[c.connection_mode] || c.connection_mode, c.connection_mode === 'NOT_AVAILABLE' ? 'warn' : c.connection_mode === 'APP_ONLY' ? '' : 'ok') },
      { key: 'quota', label: 'Respuestas gratis usadas', value: c => c.kind === 'WHATSAPP' ? C.serviceCount(c.id, period) : null, render: c => c.kind === 'WHATSAPP' ? h('div', { style: 'min-width:120px' }, h('span', { class: 'small' }, `${C.serviceCount(c.id, period)} de ${c.free_service_quota}`), G.ui.progress(C.serviceCount(c.id, period) / (c.free_service_quota || 1) * 100, C.serviceCount(c.id, period) >= c.free_service_quota ? 'bad' : '')) : '—' },
      { key: 'quality_rating', label: 'Calidad', render: c => c.quality_rating ? badge({ HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Baja' }[c.quality_rating], c.quality_rating === 'HIGH' ? 'ok' : 'warn') : '—' },
      { key: 'assignment_mode', label: 'Asignación', value: c => lbl(ASSIGN, c.assignment_mode) }, { key: 'status', label: 'Estado', render: c => G.ui.status(c.status) }],
      rows, onRow: c => detail(c) }));
    function detail(c) {
      drawer(C.chLabel(c), (b, close) => {
        b.append(dl([['Red', kindName(c.kind)], ['Número o cuenta', c.number], ['Marca', G.brandFull(c.brand_id)], ['Conexión', CONN[c.connection_mode]], ['Id externo', c.external_id], ['Cuenta de WhatsApp Business', c.waba_id], ['Historial sincronizado desde', G.fmt.date(c.synced_history_from)], ['Conectado', G.fmt.datetime(c.connected_at)], ['Mensajes de grupo descartados', c.kind === 'WHATSAPP' ? String(c.group_msgs_discarded || 0) + ' (RN-CRM-11)' : '—'], ['Límite de mensajería', c.messaging_limit ? c.messaging_limit + ' contactos/día' : '—'], ['Credenciales', 'Guardadas cifradas en INT; las vendedoras nunca las ven']]));
        b.append(card('Saludo automático', h('p', { class: 'small' }, c.auto_greeting || '—')), card('Aviso de registro (Ley 29733)', h('p', { class: 'small' }, c.recording_notice_text || '—')));
        b.append(h('div', { class: 'row' }, btn('Probar conexión', () => toast(c.connection_mode === 'NOT_AVAILABLE' ? 'RN-CRM-06: la mensajería directa de TikTok no está disponible para la cuenta peruana (D-CRM-04).' : `Conexión correcta: webhook verificado y firma válida (${kindName(c.kind)}).`, c.connection_mode === 'NOT_AVAILABLE' ? 'warn' : 'ok'), { sm: true }), can ? btn('Editar', () => { close(); edit(c); }, { sm: true, kind: 'primary' }) : null));
      }, { code: 'CRM-07' });
    }
    function edit(c) {
      drawer(c ? 'Editar ' + c.display_name : 'Conectar número o cuenta', (b, close) => b.append(form({ id: 'crm07', fields: [
        { key: 'kind', label: 'Red', type: 'select', required: true, options: Object.keys(KIND).map(k => [k, kindName(k)]), disabled: !!c },
        { key: 'number', label: 'Número (E.164) o cuenta', required: true, disabled: !!c }, { key: 'display_name', label: 'Nombre visible', required: true }, { key: 'brand_id', label: 'Marca', type: 'select', required: true, options: G.db.all('brands').map(x => [x.id, G.brandName(x.id)]) },
        { key: 'connection_mode', label: 'Modo de conexión', type: 'select', required: true, options: Object.entries(CONN), help: 'No hay modo por QR (RN-CRM-01).' }, { key: 'assignment_mode', label: 'Asignación', type: 'select', required: true, options: ASSIGN },
        { key: 'auto_greeting', label: 'Saludo automático', type: 'textarea' }, { key: 'recording_notice_text', label: 'Aviso de registro (Ley 29733)', type: 'textarea' }, { key: 'status', label: 'Estado', type: 'select', required: true, options: [['ACTIVE', 'Activo'], ['PAUSED', 'Pausado'], ['DISCONNECTED', 'Desconectado']] }],
        values: c ? Object.assign({}, c) : { kind: 'WHATSAPP', connection_mode: 'CLOUD_API_COEXISTENCE', assignment_mode: 'SHIFT_ROUND_ROBIN', status: 'ACTIVE', brand_id: 'br-DG' }, submitLabel: c ? 'Guardar' : 'Conectar', onCancel: close,
        onSubmit: v => {
          if (!c && v.kind === 'WHATSAPP' && !U.phoneOk(v.number)) return { number: 'Número en formato E.164 (+51…).' };
          if (!c && G.db.find('messaging_channels', x => x.number === v.number && x.kind === v.kind)) return 'RN-CRM-01: ese número ya está conectado; cada número se conecta una sola vez.';
          if (v.kind === 'WHATSAPP' && !['CLOUD_API_COEXISTENCE', 'CLOUD_API', 'APP_ONLY'].includes(v.connection_mode)) return 'RN-CRM-01: un número de WhatsApp solo se conecta por Cloud API (con o sin coexistencia) o queda en solo app.';
          const row = { display_name: v.display_name, brand_id: v.brand_id, connection_mode: v.connection_mode, assignment_mode: v.assignment_mode, auto_greeting: v.auto_greeting, recording_notice_text: v.recording_notice_text, status: v.status };
          if (c) G.db.update('messaging_channels', c.id, row); else G.db.insert('messaging_channels', Object.assign(row, { kind: v.kind, number: v.number, coexistence: v.connection_mode === 'CLOUD_API_COEXISTENCE', provider: 'CLOUD_API', free_service_quota: v.kind === 'WHATSAPP' ? G.param('crm_wa_service_free_per_number') : 0, external_id: 'pendiente', connected_at: C.now(), synced_history_from: G.date.addMonths(G.TODAY, -6) }));
          close(); toast(c ? 'Cambios guardados' : 'Número conectado', 'ok'); G.refresh(); return true;
        } })), { code: 'CRM-07' });
    }
  }

  /* ---------- CRM-08 Equipos y turnos ---------- */
  function rTeams(el) {
    const can = G.can('crm.channel.manage'); const DAYS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const body = pg(el, 'CRM-08', 'Miembros por número, turnos por día, tope de chats abiertos y modo de asignación. Solo reciben chats las vendedoras en turno, en línea y bajo su tope (RN-CRM-02).');
    body.appendChild(notice(`D-CRM-03: tope provisional de ${G.param('crm_max_open_conversations')} chats por vendedora y turnos de 08:00 a 20:00.`, 'info'));
    for (const ch of G.scope.filter(G.db.all('messaging_channels'), { site: '_none' })) {
      const ms = G.db.where('channel_members', m => m.channel_id === ch.id);
      const modeSel = h('select', { class: 'input', disabled: !can, attrs: { 'aria-label': 'Modo de asignación' } }, ASSIGN.map(([v, l]) => h('option', { value: v, selected: ch.assignment_mode === v }, l)));
      modeSel.addEventListener('change', () => { G.db.update('messaging_channels', ch.id, { assignment_mode: modeSel.value }); toast('Modo de asignación guardado', 'ok'); });
      const next = C.pickAgent(ch.id);
      body.appendChild(card(C.chLabel(ch), h('div', { class: 'stack' }, h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Asignación:'), modeSel, h('span', { class: 'small' }, 'Próximo chat iría a: ', h('b', null, next ? G.userShort(next) : 'cola (nadie disponible)')), can ? btn('Agregar miembro', () => addMember(ch), { sm: true }) : null),
        table({ id: 'crm08-' + ch.id, search: false, pageSize: 10, columns: [{ key: 'u', label: 'Miembro', value: m => G.userName(m.user_id) }, { key: 'r', label: 'Rol', value: m => m.member_role === 'SUPERVISOR' ? 'Supervisora' : 'Vendedora' }, { key: 's', label: 'Estado', render: m => G.ui.status(C.agentStatus(m.user_id)) }, { key: 'sh', label: 'Turnos', value: m => { const s = C.shiftsOf(m.id); return s.length ? [...new Set(s.map(x => `${x.time_from}–${x.time_to}`))].map(t => s.filter(x => `${x.time_from}–${x.time_to}` === t).map(x => DAYS[x.weekday]).join(' ') + ' ' + t).join(' · ') : 'Horario de atención'; } }, { key: 'in', label: 'En turno ahora', render: m => C.inShift(m, C.now()) ? badge('Sí', 'ok') : badge('No', '') }, { key: 'o', label: 'Abiertos / tope', value: m => `${C.openCount(m.user_id)} / ${m.max_open_conversations || 25}` }, { key: 'a', label: 'Activo', render: m => m.active === false ? badge('No', '') : badge('Sí', 'ok') }],
          rows: ms, actions: m => can ? [btn('Turnos', () => shifts(m), { sm: true }), btn(m.active === false ? 'Activar' : 'Quitar', () => { G.db.update('channel_members', m.id, { active: m.active === false }); G.refresh(); }, { sm: true, kind: 'ghost' })] : [] })), { flush: false }));
    }
    function addMember(ch) {
      drawer('Agregar miembro · ' + ch.display_name, (b, close) => b.append(form({ id: 'crm08-add', fields: [{ key: 'u', label: 'Usuario', type: 'select', required: true, options: G.db.where('users', u => ['VENDEDORA', 'SUPERVISORA_VENTAS'].includes(u.role) && !C.isMember(ch.id, u.id)).map(u => [u.id, `${u.name} · ${G.roleName(u.role)} · ${(u.brands || []).map(G.brandName).join(', ') || 'todas'}`]) }, { key: 'cap', label: 'Tope de chats abiertos', type: 'number', min: 1, max: 100 }], values: { cap: G.param('crm_max_open_conversations') }, submitLabel: 'Agregar', onCancel: close,
        onSubmit: v => { const u = G.db.get('users', v.u); if (u.role === 'VENDEDORA' && !(u.brands || []).includes(ch.brand_id)) return `RN-CRM-03: ${u.name} no atiende ${G.brandName(ch.brand_id)}; agrégale la marca en SEG primero.`; G.db.insert('channel_members', { channel_id: ch.id, user_id: u.id, member_role: u.role === 'VENDEDORA' ? 'AGENT' : 'SUPERVISOR', max_open_conversations: v.cap || 25, active: true }); close(); toast('Miembro agregado', 'ok'); G.refresh(); return true; } })));
    }
    function shifts(m) {
      drawer('Turnos · ' + G.userName(m.user_id), (b, close) => {
        const cur = C.shiftsOf(m.id); const vals = {}; for (let d = 1; d <= 7; d++) { const s = cur.find(x => x.weekday === d); vals['f' + d] = s ? s.time_from : ''; vals['t' + d] = s ? s.time_to : ''; }
        b.append(form({ id: 'crm08-sh', fields: [1, 2, 3, 4, 5, 6, 7].flatMap(d => [{ key: 'f' + d, label: DAYS[d] + ' desde', type: 'time' }, { key: 't' + d, label: DAYS[d] + ' hasta', type: 'time' }]), values: vals, submitLabel: 'Guardar turnos', onCancel: close,
          onSubmit: v => { for (let d = 1; d <= 7; d++) if (v['f' + d] && v['t' + d] && v['f' + d] >= v['t' + d]) return `El turno del ${DAYS[d]} termina antes de empezar.`; for (const s of cur) G.db.remove('channel_member_shifts', s.id); for (let d = 1; d <= 7; d++) if (v['f' + d] && v['t' + d]) G.db.insert('channel_member_shifts', { member_id: m.id, weekday: d, time_from: v['f' + d], time_to: v['t' + d] }); close(); toast('Turnos guardados', 'ok'); G.refresh(); return true; } }));
      });
    }
  }

  /* ---------- CRM-09 Plantillas ---------- */
  function rTemplates(el) {
    const can = G.can('crm.template.manage');
    const body = pg(el, 'CRM-09', 'Plantillas de utilidad y marketing por marca con variables, propósito, estado de aprobación en Meta y costo por envío fuera de la ventana.', can ? [{ label: 'Nueva plantilla', kind: 'primary', icon: '+', onClick: () => edit(null) }] : []);
    const rows = G.scope.filter(G.db.all('message_templates'), { site: '_none' });
    body.appendChild(kpis([{ label: 'Aprobadas', value: rows.filter(t => t.provider_status === 'APPROVED').length, tone: 'ok' }, { label: 'En revisión de Meta', value: rows.filter(t => t.provider_status === 'PENDING').length, tone: 'warn' }, { label: 'Rechazadas', value: rows.filter(t => t.provider_status === 'REJECTED').length, tone: 'bad' }, { label: 'Tope por pedido', value: `${G.param('crm_utility_templates_per_order')} de utilidad`, sub: 'RN-CRM-07' }]));
    const sent = U.groupBy(G.db.where('conversation_messages', m => m.template_id), 'template_id');
    body.appendChild(table({ id: 'crm09', columns: [{ key: 'brand_id', label: 'Marca', value: t => G.brandName(t.brand_id) }, { key: 'name', label: 'Nombre', mono: true }, { key: 'category', label: 'Categoría', value: t => CAT[t.category] }, { key: 'purpose', label: 'Propósito', value: t => PURPOSE[t.purpose] }, { key: 'provider_status', label: 'Meta', render: t => badge(TPLST[t.provider_status][0], TPLST[t.provider_status][1]) },
      { key: 'cost', label: 'Costo fuera de ventana', align: 'r', value: t => C.rateFor(t.category, {}).amount, render: t => G.fmt.money(C.rateFor(t.category, {}).amount, 4) }, { key: 'in', label: 'En ventana', align: 'r', value: t => C.rateFor(t.category, { inService: true }).amount, render: t => C.rateFor(t.category, { inService: true }).amount ? G.fmt.money(C.rateFor(t.category, { inService: true }).amount, 4) : 'Gratis' }, { key: 'n', label: 'Envíos', align: 'r', value: t => (sent[t.id] || []).length }],
      rows, onRow: t => detail(t), filters: [{ key: 'category', label: 'Categoría', options: [['UTILITY', 'Utilidad'], ['MARKETING', 'Marketing']] }, { key: 'provider_status', label: 'Estado', options: optsOf(TPLST) }] }));
    function detail(t) {
      drawer(t.name, (b, close) => {
        b.append(dl([['Marca', G.brandFull(t.brand_id)], ['Categoría', CAT[t.category]], ['Propósito', PURPOSE[t.purpose]], ['Variables', (t.variables || []).join(', ')], ['Estado en Meta', TPLST[t.provider_status][0]], ['Id en Meta', t.provider_template_id], t.rejection_reason ? ['Motivo del rechazo', t.rejection_reason] : null]));
        b.append(card('Texto', h('div', { class: 'msg out', style: 'max-width:100%' }, t.body + (t.category === 'MARKETING' ? UNSUB : ''))));
        if (can) b.append(h('div', { class: 'row' }, ['DRAFT', 'REJECTED'].includes(t.provider_status) ? btn('Enviar a aprobación', () => { G.db.update('message_templates', t.id, { provider_status: 'PENDING', submitted_at: C.now() }); close(); toast('Enviada a Meta', 'ok'); G.refresh(); }, { sm: true, kind: 'primary' }) : null,
          t.provider_status === 'PENDING' ? btn('Registrar aprobación de Meta', () => { G.db.update('message_templates', t.id, { provider_status: 'APPROVED', provider_template_id: 'HX' + t.id.slice(-6) }); close(); toast('Plantilla aprobada', 'ok'); G.refresh(); }, { sm: true }) : null,
          t.provider_status === 'PENDING' ? btn('Registrar rechazo', () => { G.db.update('message_templates', t.id, { provider_status: 'REJECTED', rejection_reason: 'Rechazada por Meta' }); close(); G.refresh(); }, { sm: true, kind: 'ghost' }) : null,
          ['DRAFT', 'REJECTED'].includes(t.provider_status) ? btn('Editar', () => { close(); edit(t); }, { sm: true }) : null));
        b.append(notice('D-CRM-07: la encuesta posentrega se trata como utilidad; si Meta la reclasifica, se cobra como marketing y se envía solo dentro de la ventana.', 'info'));
      }, { code: 'CRM-09' });
    }
    function edit(t) {
      drawer(t ? 'Editar plantilla' : 'Nueva plantilla', (b, close) => b.append(form({ id: 'crm09', fields: [{ key: 'brand_id', label: 'Marca', type: 'select', required: true, options: G.db.all('brands').map(x => [x.id, G.brandName(x.id)]) }, { key: 'name', label: 'Nombre (minúsculas y _)', required: true }, { key: 'category', label: 'Categoría', type: 'select', required: true, options: [['UTILITY', 'Utilidad'], ['MARKETING', 'Marketing'], ['AUTHENTICATION', 'Autenticación']] }, { key: 'purpose', label: 'Propósito', type: 'select', required: true, options: Object.entries(PURPOSE) }, { key: 'body', label: 'Texto (variables como {{cliente}})', type: 'textarea', required: true }],
        values: t ? Object.assign({}, t) : { brand_id: 'br-DG', category: 'UTILITY', purpose: 'OTHER' }, submitLabel: 'Guardar borrador', onCancel: close,
        onSubmit: v => { if (!/^[a-z0-9_]{1,250}$/.test(v.name)) return { name: 'Solo minúsculas, números y guion bajo.' }; if (G.db.find('message_templates', x => x.brand_id === v.brand_id && x.name === v.name && (!t || x.id !== t.id))) return { name: 'Ya existe una plantilla con ese nombre en la marca.' }; const row = Object.assign({}, v, { variables: [...new Set((v.body.match(/\{\{(\w+)\}\}/g) || []).map(x => x.slice(2, -2)))], provider_status: 'DRAFT', language: 'es' }); if (t) G.db.update('message_templates', t.id, row); else G.db.insert('message_templates', row); close(); toast('Plantilla guardada en borrador', 'ok'); G.refresh(); return true; } })));
    }
  }

  /* ---------- CRM-10 Respuestas rápidas y catálogo ---------- */
  function rQuick(el) {
    const body = pg(el, 'CRM-10', 'Atajos por marca o personales (/delivery, /pago, /peso) y catálogo de WhatsApp sincronizado con CAT: solo productos activos con precio vigente.');
    const myQ = G.db.where('quick_replies', q => q.owner_user_id === me() || (!q.owner_user_id && G.scope.ok(q, { site: '_none' })));
    body.appendChild(tabs([
      { key: 'q', label: 'Respuestas rápidas', count: myQ.length, render: p => {
        p.append(h('div', { class: 'row', style: 'margin-bottom:8px' }, btn('Nueva respuesta', () => editQ(null), { kind: 'primary', sm: true, icon: '+' })));
        p.append(table({ id: 'crm10q', columns: [{ key: 'shortcut', label: 'Atajo', mono: true }, { key: 'brand_id', label: 'Alcance', value: q => q.owner_user_id ? 'Personal · ' + G.userShort(q.owner_user_id) : G.brandName(q.brand_id) }, { key: 'body', label: 'Texto', value: q => q.body.length > 90 ? q.body.slice(0, 90) + '…' : q.body }, { key: 'status', label: 'Estado', render: q => G.ui.status(q.status) }], rows: myQ, onRow: q => editQ(q), filters: [{ key: 'brand_id', label: 'Marca', options: G.scope.brands().map(b => [b.id, G.brandName(b.id)]) }] }));
      } },
      { key: 'c', label: 'Catálogo de WhatsApp', render: p => {
        const vs = G.db.where('product_variants', v => v.sellable && G.scope.ok(v, { site: '_none' }));
        p.append(notice('Se publica en el catálogo de cada número solo lo activo en CAT con precio vigente en la lista de WhatsApp; lo inactivo o sin precio queda fuera.', 'info'));
        p.append(table({ id: 'crm10c', columns: [{ key: 'brand_id', label: 'Marca', value: v => G.brandName(v.brand_id) }, { key: 'sku', label: 'SKU', mono: true }, { key: 'name', label: 'Producto' }, { key: 'p', label: 'Precio WhatsApp', align: 'r', value: v => { const x = G.price.of(v.id, { brand_id: v.brand_id, channel: 'WHATSAPP' }); return x ? x.price : null; }, render: v => { const x = G.price.of(v.id, { brand_id: v.brand_id, channel: 'WHATSAPP' }); return x ? `${G.fmt.money(x.price)} ${x.basis === 'KG' ? '/kg' : 'c/u'}` : '—'; } }, { key: 'in', label: 'En el catálogo', render: v => v.status === 'ACTIVE' && G.price.of(v.id, { brand_id: v.brand_id, channel: 'WHATSAPP' }) ? badge('Publicado', 'ok') : badge('Fuera (inactivo o sin precio)', 'warn') }], rows: vs, filters: [{ key: 'brand_id', label: 'Marca', options: G.scope.brands().map(b => [b.id, G.brandName(b.id)]) }],
          toolbar: [btn('Sincronizar con CAT', () => { for (const ch of G.db.where('messaging_channels', c => c.kind === 'WHATSAPP')) G.db.update('messaging_channels', ch.id, { catalog_synced_at: C.now() }); toast(`Catálogo sincronizado: ${vs.filter(v => v.status === 'ACTIVE').length} productos activos`, 'ok'); }, { sm: true })] }));
      } }]));
    function editQ(q) {
      drawer(q ? 'Respuesta ' + q.shortcut : 'Nueva respuesta rápida', (b, close) => b.append(form({ id: 'crm10', fields: [{ key: 'shortcut', label: 'Atajo (/texto)', required: true }, { key: 'scope', label: 'Alcance', type: 'select', required: true, options: [['ME', 'Personal']].concat(G.can('crm.channel.manage') || G.ctx.role === 'SUPERVISORA_VENTAS' ? G.db.all('brands').map(x => [x.id, 'Marca ' + G.brandName(x.id)]) : []) }, { key: 'body', label: 'Texto', type: 'textarea', required: true }, { key: 'status', label: 'Estado', type: 'select', required: true, options: [['ACTIVE', 'Activa'], ['INACTIVE', 'Inactiva']] }],
        values: q ? Object.assign({ scope: q.owner_user_id ? 'ME' : q.brand_id }, q) : { scope: 'ME', status: 'ACTIVE', shortcut: '/' }, submitLabel: 'Guardar', onCancel: close,
        onSubmit: v => { if (!/^\/[a-z0-9_]{2,30}$/.test(v.shortcut)) return { shortcut: 'Empieza con / y usa minúsculas (2 a 30).' }; const sc = C.scanText(v.body); if (sc.length) return `RN-CRM-16: el texto activaría la alerta «${sc[0].rule.name}»; corrígelo.`; const row = { shortcut: v.shortcut, body: v.body, status: v.status, owner_user_id: v.scope === 'ME' ? me() : null, brand_id: v.scope === 'ME' ? null : v.scope }; if (q) G.db.update('quick_replies', q.id, row); else G.db.insert('quick_replies', row); close(); toast('Respuesta guardada', 'ok'); G.refresh(); return true; } })));
    }
  }

  /* ---------- CRM-11 Costo de WhatsApp ---------- */
  const SC = { month: G.date.month(G.TODAY), sim: { orders: 1000, numbers: 2, replies: 10, utilities: 2, ctwaShare: 0 } };
  function rCost(el) {
    const body = pg(el, 'CRM-11', 'Costo de WhatsApp del mes por número, marca, vendedora y pedido, con la cuota de 1000 respuestas gratis por número, lo ahorrado por ventanas de anuncio y la proyección del mes.');
    if (!G.can('crm.cost.view')) { body.appendChild(notice('Tu rol no ve el costo de WhatsApp (permiso crm.cost.view).', 'warn')); return; }
    const months = ['2026-10-01', '2026-09-01'];
    body.appendChild(h('div', { class: 'row' }, pills(months.map(m => [m, G.date.monthName(m)]), SC.month, v => { SC.month = v; G.refresh(); }), h('span', { class: 'small muted' }, `Tarifas Perú vigentes desde ${G.fmt.date(G.param('crm_wa_rates_valid_from'))}: marketing ${G.fmt.money(G.param('crm_wa_rate_marketing'), 4)} · utilidad ${G.fmt.money(G.param('crm_wa_rate_utility'), 4)} · servicio ${G.fmt.money(G.param('crm_wa_rate_service'), 4)} desde la respuesta 1001 · autenticación ${G.fmt.money(G.param('crm_wa_rate_authentication'), 4)} (D-CRM-02).`)));
    const ch = G.db.where('message_charges', x => x.period === SC.month && G.scope.ok(x, { site: '_none' }));
    const total = U.sum(ch, x => x.amount); const end = G.date.add(G.date.addMonths(SC.month, 1), -1); const elapsed = SC.month === G.date.month(G.TODAY) ? G.date.diff(G.TODAY, SC.month) + 1 : G.date.diff(end, SC.month) + 1; const days = G.date.diff(end, SC.month) + 1;
    const ctwaSaved = U.sum(ch.filter(x => x.reason === 'FREE_CTWA_WINDOW'), x => C.rateFor(x.category, { served: 1e9 }).amount);
    const k8 = G.kpi('KPI-CRM-08', { from: SC.month, to: end }) || {};
    body.appendChild(kpis([{ label: 'Costo del mes', value: G.fmt.money(total, 2), sub: `${ch.filter(x => x.billable).length} mensajes cobrados de ${ch.length}` }, { label: 'Proyección del mes', value: G.fmt.money(elapsed ? total / elapsed * days : 0), sub: `${elapsed} de ${days} días` }, { label: 'Gratis por ventana de anuncio', value: ch.filter(x => x.reason === 'FREE_CTWA_WINDOW').length, sub: 'Ahorro ' + G.fmt.money(ctwaSaved, 2) }, { label: 'Gratis por cuota de 1000', value: ch.filter(x => x.reason === 'FREE_SERVICE_QUOTA').length }, { label: 'Costo por pedido WhatsApp (KPI-CRM-08)', value: G.fmt.money(k8.value, 4), sub: `${k8.denominator || 0} pedidos entregados` }]));
    const agg = (key, label, nameFn) => { const g = U.groupBy(ch, key); return Object.entries(g).map(([k, xs]) => ({ id: k, name: nameFn(k), n: xs.length, svc: xs.filter(x => x.category === 'SERVICE').length, ut: xs.filter(x => x.category === 'UTILITY').length, mk: xs.filter(x => x.category === 'MARKETING').length, ctwa: xs.filter(x => x.reason === 'FREE_CTWA_WINDOW').length, amt: R(U.sum(xs, x => x.amount), 4) })).sort((a, b) => b.amt - a.amt); };
    const cols = (label, extra = []) => [{ key: 'name', label }].concat(extra, [{ key: 'svc', label: 'Servicio', align: 'r' }, { key: 'ut', label: 'Utilidad', align: 'r' }, { key: 'mk', label: 'Marketing', align: 'r' }, { key: 'ctwa', label: 'Gratis anuncio', align: 'r' }, { key: 'amt', label: 'Costo', align: 'r', render: x => G.fmt.money(x.amt, 4) }]);
    body.appendChild(tabs([
      { key: 'n', label: 'Por número', render: p => p.append(table({ id: 'crm11n', search: false, columns: cols('Número', [{ key: 'q', label: 'Cuota gratis usada', value: x => C.serviceCount(x.id, SC.month), render: x => { const c = chan(x.id) || {}; const u = C.serviceCount(x.id, SC.month); return h('div', { style: 'min-width:130px' }, h('span', { class: 'small' }, `${u} de ${c.free_service_quota || 1000}`), G.ui.progress(u / (c.free_service_quota || 1000) * 100, u >= (c.free_service_quota || 1000) ? 'bad' : '')); } }]), rows: agg('channel_id', 'Número', k => C.chLabel(chan(k))) })) },
      { key: 'b', label: 'Por marca', render: p => { const rows = agg('brand_id', 'Marca', G.brandName); p.append(G.ui.chart.hbar({ items: rows.map(x => ({ label: x.name, value: x.amt })), format: v => G.fmt.money(v, 2) }), table({ id: 'crm11b', search: false, columns: cols('Marca'), rows })); } },
      { key: 'v', label: 'Por vendedora', render: p => p.append(table({ id: 'crm11v', search: false, columns: cols('Vendedora'), rows: agg('user_id', 'Vendedora', k => k === 'null' || !k ? 'Sistema (automáticos)' : G.userName(k)) })) },
      { key: 'p', label: 'Por pedido', render: p => p.append(table({ id: 'crm11p', columns: cols('Pedido', [{ key: 'c', label: 'Cliente', value: x => { const o = G.db.get('sales_orders', x.id); return o ? G.custName(o.customer_id) : ''; } }]), rows: agg('order_id', 'Pedido', k => (G.db.get('sales_orders', k) || {}).number || 'Sin pedido') })) },
      { key: 's', label: 'Simulador', render: p => {
        const res = h('div'); const draw = v => { const r1 = C.simulate(v); G.ui.clear(res); res.append(kpis([{ label: 'Servicio', value: G.fmt.money(r1.service) }, { label: 'Utilidad', value: G.fmt.money(r1.utility) }, { label: 'Total del mes', value: G.fmt.money(r1.total), tone: 'info' }])); };
        p.append(notice('Calcula el mes con las mismas tarifas, mensaje a mensaje: cuota de 1000 respuestas gratis por número, utilidad fuera de ventana y ventana gratuita de 72 h por anuncio de clic a WhatsApp (CA-CRM-05).', 'info'),
          form({ id: 'crm11s', fields: [{ key: 'orders', label: 'Pedidos al mes', type: 'number', min: 0 }, { key: 'numbers', label: 'Números', type: 'number', min: 1, max: 6 }, { key: 'replies', label: 'Respuestas por pedido', type: 'number', min: 0 }, { key: 'utilities', label: 'Plantillas de utilidad fuera de ventana por pedido', type: 'number', min: 0, max: 2 }, { key: 'ctwaShare', label: 'Proporción por anuncio de clic (0 a 1)', type: 'number', min: 0, max: 1, step: 0.05 }], values: SC.sim, submitLabel: 'Calcular', onSubmit: v => { SC.sim = v; draw(v); return true; } }), res);
        draw(SC.sim);
      } }]));
  }

  /* ---------- CRM-12 Alertas de control ---------- */
  function rAlerts(el, params) {
    C.sweep();
    const body = pg(el, 'CRM-12', 'Alertas por vendedora, regla y gravedad con el extracto y el enlace al mensaje; se revisan, se descartan o se confirman siempre con nota. Las alertas no se borran.');
    if (!G.can('crm.alert.review')) { body.appendChild(notice('RN-CRM-17: las alertas de control las revisa la supervisora. Una vendedora no ve las alertas sobre ella.', 'info')); return; }
    const rows = G.db.where('control_alerts', a => G.scope.ok(a, { site: '_none' }) && (!params || !params.conv || a.conversation_id === params.conv)).sort((a, b) => b.raised_at.localeCompare(a.raised_at));
    const month = G.date.month(G.TODAY);
    body.appendChild(kpis([{ label: 'Abiertas', value: rows.filter(a => a.status === 'OPEN').length, tone: 'bad' }, { label: 'Gravedad alta abiertas', value: rows.filter(a => a.status === 'OPEN' && a.severity === 'HIGH').length, tone: 'bad' }, { label: 'En revisión', value: rows.filter(a => a.status === 'UNDER_REVIEW').length, tone: 'warn' }, { label: 'Confirmadas del mes (KPI-CRM-10)', value: G.kpi('KPI-CRM-10', { from: month, to: G.TODAY }).value }, { label: 'Descartadas', value: rows.filter(a => a.status === 'DISMISSED').length }]));
    if (params && params.conv) body.appendChild(notice(h('span', null, `Filtrado por la conversación con ${C.contactName(conv(params.conv))}. `, h('a', { href: '#', on: { click: e => { e.preventDefault(); G.go('CRM-12'); } } }, 'Ver todas')), 'info'));
    const byUser = U.groupBy(rows.filter(a => ['OPEN', 'UNDER_REVIEW'].includes(a.status)), 'user_id');
    if (Object.keys(byUser).length) body.appendChild(card('Abiertas por vendedora', G.ui.chart.hbar({ items: Object.entries(byUser).map(([u, xs]) => ({ label: G.userShort(u), value: xs.length, tone: xs.some(x => x.severity === 'HIGH') ? 'bad' : 'warn' })), format: v => G.fmt.num(v) })));
    body.appendChild(table({ id: 'crm12', columns: [{ key: 'raised_at', label: 'Fecha', render: a => G.fmt.datetime(a.raised_at) }, { key: 'user_id', label: 'Vendedora', value: a => G.userShort(a.user_id) }, { key: 'rule', label: 'Regla', value: a => { const r1 = G.db.get('control_alert_rules', a.rule_id) || {}; return `${a.rule_code} · ${r1.name || RTYPE[r1.rule_type]}`; } }, { key: 'severity', label: 'Gravedad', render: a => sevB(a.severity) }, { key: 'matched_text', label: 'Coincidencia' }, { key: 'excerpt', label: 'Extracto', value: a => String(a.excerpt || '').slice(0, 70) }, { key: 'source_type', label: 'Fuente', value: a => ({ MESSAGE: 'Chat', VOICE_NOTE: 'Nota de voz', CALL_TRANSCRIPT: 'Llamada' })[a.source_type] }, { key: 'status', label: 'Estado', render: a => badge(ASTATUS[a.status][0], ASTATUS[a.status][1]) }],
      rows, onRow: a => detail(a), filters: [{ key: 'status', label: 'Estado', options: optsOf(ASTATUS) }, { key: 'severity', label: 'Gravedad', options: optsOf(SEV) }, { key: 'user_id', label: 'Vendedora', options: G.db.where('users', u => u.role === 'VENDEDORA').map(u => [u.id, G.userShort(u.id)]) }, { key: 'rule_code', label: 'Regla', options: G.db.all('control_alert_rules').map(r1 => [r1.code, r1.code + ' ' + r1.name]) }] }));
    function detail(a) {
      drawer('Alerta ' + a.rule_code, (b, close) => {
        const r1 = G.db.get('control_alert_rules', a.rule_id) || {}; const cv = a.conversation_id && conv(a.conversation_id);
        b.append(dl([['Vendedora', G.userName(a.user_id)], ['Regla', `${a.rule_code} · ${r1.name} (${RTYPE[r1.rule_type]})`], ['Gravedad', sevB(a.severity)], ['Coincidencia', a.matched_text], ['Extracto', a.excerpt], ['Conversación', cv ? `${C.contactName(cv)} · ${C.chLabel(chan(cv.channel_id))}` : '—'], ['Estado', ASTATUS[a.status][0]], a.reviewed_by ? ['Revisó', `${G.userName(a.reviewed_by)} · ${G.fmt.datetime(a.reviewed_at)}`] : null, a.resolution_note ? ['Nota', a.resolution_note] : null]));
        if (cv) b.append(h('div', { class: 'row' }, btn('Ir al mensaje', () => { close(); goConv(cv.id); }, { sm: true })));
        if (['OPEN', 'UNDER_REVIEW'].includes(a.status)) {
          if (a.status === 'OPEN') b.append(h('div', { class: 'row' }, btn('Tomar en revisión', () => { if (act(() => C.reviewAlert(a.id, 'UNDER_REVIEW', null), 'Alerta en revisión') !== false) close(); }, { sm: true })));
          b.append(card('Cerrar la revisión (RN-CRM-17)', form({ id: 'crm12r', fields: [{ key: 's', label: 'Resultado', type: 'select', required: true, options: [['CONFIRMED', 'Confirmada (se notifica a gerencia)'], ['DISMISSED', 'Descartada (falso positivo)']] }, { key: 'n', label: 'Nota de la revisión', type: 'textarea', required: true }], values: { s: 'CONFIRMED' }, submitLabel: 'Cerrar alerta', onSubmit: v => { try { C.reviewAlert(a.id, v.s, v.n); close(); toast('Alerta cerrada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })));
        }
        if (cv) b.append(card('Conversación', chatView(cv)));
      }, { wide: true, code: 'CRM-12' });
    }
  }

  /* ---------- CRM-13 Reglas e identificadores oficiales ---------- */
  function rRules(el) {
    const can = G.can('crm.alert_rule.manage');
    const body = pg(el, 'CRM-13', 'Frases de alerta, términos del rubro fuera del catálogo, patrones de celulares y cuentas, y la lista de números, cuentas, Yape y Plin oficiales de la empresa.');
    if (!can && !G.can('crm.alert.review')) { body.appendChild(notice('Tu rol no administra reglas de control.', 'warn')); return; }
    const tester = h('div', { class: 'stack' }); const out = h('div', { class: 'stack' });
    const ta = h('textarea', { class: 'input', placeholder: 'Escribe un texto de prueba, por ejemplo: «Mejor escríbeme a mi número 987 654 321, te lo dejo más barato por fuera»' });
    tester.append(ta, h('div', { class: 'row' }, btn('Probar', () => { G.ui.clear(out); const hits = C.scanText(ta.value); out.append(hits.length ? h('div', { class: 'stack' }, hits.map(x => h('div', { class: 'row' }, sevB(x.rule.severity), h('b', null, x.rule.code), x.rule.name, h('span', { class: 'muted' }, '«' + x.matched + '»')))) : notice('Sin alertas: el texto respeta el canal oficial.', 'ok')); }, { sm: true, kind: 'primary' })), out);
    body.appendChild(tabs([
      { key: 'r', label: 'Reglas', render: p => p.append(table({ id: 'crm13r', columns: [{ key: 'code', label: 'Código', mono: true }, { key: 'rule_type', label: 'Tipo', value: x => RTYPE[x.rule_type] }, { key: 'pattern', label: 'Patrón o término' }, { key: 'severity', label: 'Gravedad', render: x => sevB(x.severity) }, { key: 'active', label: 'Activa', render: x => x.active ? badge('Sí', 'ok') : badge('No', '') }, { key: 'n', label: 'Alertas', align: 'r', value: x => G.db.where('control_alerts', a => a.rule_id === x.id).length }], rows: G.db.all('control_alert_rules'), onRow: x => can && editRule(x), toolbar: can ? [btn('Nueva regla', () => editRule(null), { sm: true, kind: 'primary', icon: '+' })] : null }), notice('Las frases se comparan sin tildes ni mayúsculas. Un término del rubro alerta solo si no hay ningún producto activo del catálogo que lo contenga (RN-CRM-16). Borrado en el celular, chat sin responder y encuesta son señales del sistema.', 'info')) },
      { key: 'i', label: 'Identificadores oficiales', render: p => p.append(table({ id: 'crm13i', columns: [{ key: 'identifier_type', label: 'Tipo' }, { key: 'value', label: 'Valor', mono: true }, { key: 'label', label: 'Descripción' }, { key: 'brand_id', label: 'Marca', value: x => x.brand_id ? G.brandName(x.brand_id) : 'Todas' }, { key: 'status', label: 'Estado', render: x => G.ui.status(x.status) }], rows: G.db.all('official_identifiers'), onRow: x => can && editId(x), toolbar: can ? [btn('Nuevo identificador', () => editId(null), { sm: true, kind: 'primary', icon: '+' })] : null })) },
      { key: 't', label: 'Probar un texto', render: p => p.append(tester) }]));
    function editRule(x) {
      drawer(x ? 'Regla ' + x.code : 'Nueva regla', (b, close) => b.append(form({ id: 'crm13', fields: [{ key: 'code', label: 'Código', required: true }, { key: 'name', label: 'Nombre', required: true }, { key: 'rule_type', label: 'Tipo', type: 'select', required: true, options: Object.entries(RTYPE).slice(0, 4) }, { key: 'pattern', label: 'Frase, término o descripción del patrón', required: true }, { key: 'severity', label: 'Gravedad', type: 'select', required: true, options: optsOf(SEV) }, { key: 'active', label: 'Activa', type: 'checkbox' }], values: x ? Object.assign({}, x) : { rule_type: 'KEYWORD', severity: 'MEDIUM', active: true, code: 'CTL-' + String(G.db.all('control_alert_rules').length + 1).padStart(2, '0') }, submitLabel: 'Guardar', onCancel: close,
        onSubmit: v => { if (G.db.find('control_alert_rules', r1 => r1.code === v.code && (!x || r1.id !== x.id))) return { code: 'Código repetido.' }; if (x) G.db.update('control_alert_rules', x.id, v); else G.db.insert('control_alert_rules', Object.assign({ applies_to: ['CHAT', 'CALL'] }, v)); close(); toast('Regla guardada', 'ok'); G.refresh(); return true; } })));
    }
    function editId(x) {
      drawer(x ? 'Identificador' : 'Nuevo identificador oficial', (b, close) => b.append(form({ id: 'crm13i', fields: [{ key: 'identifier_type', label: 'Tipo', type: 'select', required: true, options: [['PHONE', 'Celular o teléfono'], ['YAPE', 'Yape'], ['PLIN', 'Plin'], ['BANK_ACCOUNT', 'Cuenta bancaria'], ['CCI', 'CCI'], ['EMAIL', 'Correo'], ['URL', 'Web']] }, { key: 'value', label: 'Valor', required: true }, { key: 'label', label: 'Descripción', required: true }, { key: 'brand_id', label: 'Marca', type: 'select', options: G.db.all('brands').map(y => [y.id, G.brandName(y.id)]) }, { key: 'status', label: 'Estado', type: 'select', required: true, options: [['ACTIVE', 'Activo'], ['INACTIVE', 'Inactivo']] }], values: x ? Object.assign({}, x) : { identifier_type: 'YAPE', status: 'ACTIVE' }, submitLabel: 'Guardar', onCancel: close,
        onSubmit: v => { if (x) G.db.update('official_identifiers', x.id, v); else G.db.insert('official_identifiers', v); close(); toast('Identificador guardado', 'ok'); G.refresh(); return true; } })));
    }
  }

  /* ---------- CRM-14 Revisión por muestreo ---------- */
  const SR = { week: null };
  function rReview(el) {
    const body = pg(el, 'CRM-14', `Cada lunes se revisa una muestra del ${G.param('crm_review_sample_pct')} % (mínimo ${G.param('crm_review_sample_min')}) de las conversaciones cerradas sin pedido de cada vendedora en la semana anterior (RN-CRM-18).`);
    if (!G.can('crm.review.perform') && !G.can('crm.alert.review')) { body.appendChild(notice('Tu rol no hace la revisión por muestreo (permiso crm.review.perform).', 'warn')); return; }
    const cur = C.weekStart(G.TODAY); const weeks = [cur, G.date.add(cur, -7), G.date.add(cur, -14)]; SR.week = SR.week || cur;
    body.appendChild(h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Semana de revisión (lunes):'), pills(weeks.map(w => [w, `${G.fmt.date(w)} · revisa del ${G.fmt.date(G.date.add(w, -7)).slice(0, 5)} al ${G.fmt.date(G.date.add(w, -1)).slice(0, 5)}`]), SR.week, v => { SR.week = v; G.refresh(); })));
    const sample = C.reviewSample(SR.week); const done = G.db.where('conversation_reviews', r1 => r1.sample_week === SR.week);
    const doneMap = new Map(done.map(r1 => [r1.conversation_id, r1]));
    body.appendChild(kpis([{ label: 'Vendedoras en la muestra', value: sample.length }, { label: 'Conversaciones a revisar', value: U.sum(sample, s => s.sample.length) }, { label: 'Revisadas', value: done.length, tone: 'ok' }, { label: 'Observadas o incidentes', value: done.filter(r1 => r1.result !== 'OK').length, tone: done.some(r1 => r1.result !== 'OK') ? 'warn' : '' }]));
    if (!sample.length) body.appendChild(G.ui.empty('No hubo conversaciones cerradas sin pedido en esa semana.'));
    for (const s of sample) body.appendChild(card(`${G.userName(s.user_id)} · ${s.sample.length} de ${s.universe} cerradas sin pedido`, table({ id: 'crm14-' + s.user_id, search: false, pageSize: 10, columns: [{ key: 'n', label: 'Contacto', value: c => C.contactName(c) }, { key: 'ch', label: 'Número', value: c => C.chLabel(chan(c.channel_id)) }, { key: 'closed_at', label: 'Cerrada', render: c => G.fmt.datetime(c.closed_at) }, { key: 'r', label: 'Motivo', value: c => lbl(CLOSE, c.close_reason) }, { key: 'res', label: 'Resultado', render: c => { const r1 = doneMap.get(c.id); return r1 ? badge({ OK: 'OK', OBSERVED: 'Observado', INCIDENT: 'Incidente' }[r1.result], r1.result === 'OK' ? 'ok' : r1.result === 'OBSERVED' ? 'warn' : 'bad') : badge('Pendiente', ''); } }], rows: s.sample, onRow: c => review(c) }), { flush: true }));
    function review(c) {
      drawer('Revisión · ' + C.contactName(c), (b, close) => {
        const r1 = doneMap.get(c.id);
        b.append(chatView(c));
        if (r1) b.append(dl([['Resultado', r1.result], ['Revisó', G.userName(r1.reviewer_user_id)], ['Nota', r1.notes]]));
        else b.append(form({ id: 'crm14', fields: [{ key: 'res', label: 'Resultado', type: 'select', required: true, options: [['OK', 'OK'], ['OBSERVED', 'Observado'], ['INCIDENT', 'Incidente']] }, { key: 'n', label: 'Nota (obligatoria si no es OK)', type: 'textarea' }], values: { res: 'OK' }, submitLabel: 'Registrar revisión', onSubmit: v => { try { C.recordReview(c.id, SR.week, v.res, v.n); close(); toast('Revisión registrada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }));
      }, { wide: true, code: 'CRM-14' });
    }
  }

  /* ---------- CRM-15 Recompra ---------- */
  const SB = { st: 'DUE' };
  function rRebuy(el) {
    const body = pg(el, 'CRM-15', `Clientes por avisar, en riesgo y perdidos por marca según su frecuencia (mediana de días entre pedidos, desde ${G.param('crm_rebuy_min_orders')} pedidos entregados). La tarea se crea ${G.param('crm_rebuy_notice_days')} días antes de la fecha esperada.`, [{ label: 'Recalcular', onClick: () => { const n = C.rebuyRecompute(); toast(`${n} perfiles recalculados`, 'ok'); G.refresh(); } }]);
    const rows = G.db.where('customer_rebuy_profiles', p => G.scope.ok(p, { site: '_none' }));
    const cnt = s => rows.filter(p => p.status === s).length;
    body.appendChild(kpis([['DUE', 'Por avisar'], ['AT_RISK', 'En riesgo'], ['LOST', 'Perdidos (KPI-CRM-11)'], ['ACTIVE', 'Al día']].map(([s, l]) => ({ label: l, value: cnt(s), tone: s === 'LOST' ? 'bad' : s === 'AT_RISK' ? 'warn' : s === 'DUE' ? 'info' : '', onClick: () => { SB.st = s; G.refresh(); } })).concat([{ label: 'Frecuencia mediana (KPI-CRM-12)', value: G.fmt.num(G.kpi('KPI-CRM-12').value, 1) + ' días' }])));
    body.appendChild(pills([['DUE', 'Por avisar'], ['AT_RISK', 'En riesgo'], ['LOST', 'Perdidos'], ['ACTIVE', 'Al día'], ['NEW', 'Sin frecuencia aún']], SB.st, v => { SB.st = v; G.refresh(); }));
    const tasks = new Map(G.db.where('crm_tasks', t => t.task_type === 'REBUY' && t.status === 'OPEN').map(t => [t.customer_id + '|' + t.brand_id, t]));
    body.appendChild(table({ id: 'crm15', columns: [{ key: 'c', label: 'Cliente', value: p => G.custName(p.customer_id) }, { key: 'brand_id', label: 'Marca', value: p => G.brandName(p.brand_id) }, { key: 'orders_count', label: 'Pedidos', align: 'r' }, { key: 'median_interval_days', label: 'Frecuencia (días)', align: 'r', render: p => G.fmt.num(p.median_interval_days, 1) }, { key: 'last_order_at', label: 'Último pedido', render: p => G.fmt.date(p.last_order_at) }, { key: 'next_expected_at', label: 'Esperado', render: p => G.fmt.date(p.next_expected_at) }, { key: 'status', label: 'Estado', render: p => badge(REBUY[p.status][0], REBUY[p.status][1]) }, { key: 't', label: 'Tarea', value: p => { const t = tasks.get(p.customer_id + '|' + p.brand_id); return t ? `${G.userShort(t.assigned_user_id)} · vence ${G.fmt.date(t.due_at)}` : ''; } }],
      rows: rows.filter(p => p.status === SB.st), filters: [{ key: 'brand_id', label: 'Marca', options: G.scope.brands().map(b => [b.id, G.brandName(b.id)]) }],
      actions: p => [btn('Plantilla de recompra', () => { try { C.sendTemplate({ customer_id: p.customer_id, brand_id: p.brand_id, purpose: 'REBUY', vars: { cliente: G.custName(p.customer_id).split(' ')[0], marca: G.brandName(p.brand_id) }, user_id: me() }); toast('Plantilla de recompra enviada', 'ok'); G.refresh(); } catch (e) { toast(e.message, 'bad'); } }, { sm: true }), G.can('crm.customer.view_full') ? btn('Ficha', () => G.go('CRM-04', { id: p.customer_id }), { sm: true, kind: 'ghost' }) : null] }));
  }

  /* ---------- CRM-16 Encuesta posentrega ---------- */
  function rSurveys(el) {
    const body = pg(el, 'CRM-16', `Encuesta a las ${G.param('crm_survey_delay_hours')} h de la entrega, dentro de la ventana o como plantilla de utilidad si el pedido no agotó su cupo (RN-CRM-20). Las respuestas «no recibí lo que pedí» y «compré algo que no está en la web» se resaltan.`);
    if (!G.can('crm.survey.view')) { body.appendChild(notice('Tu rol no ve encuestas (permiso crm.survey.view).', 'warn')); return; }
    const rows = G.db.where('delivery_surveys', s => G.scope.ok(s, { site: '_none' })).sort((a, b) => b.sent_at.localeCompare(a.sent_at)); const ans = rows.filter(s => s.answered_at);
    const avg = xs => xs.length ? R(U.sum(xs, s => s.rating_service) / xs.length, 2) : null;
    body.appendChild(kpis([{ label: 'Enviadas', value: rows.length }, { label: 'Respondidas', value: ans.length, sub: rows.length ? G.fmt.pct(ans.length / rows.length * 100) : '' }, { label: 'Atención (KPI-CRM-09)', value: G.fmt.num(avg(ans), 2) + ' / 5', tone: 'ok' }, { label: 'Producto', value: G.fmt.num(ans.length ? U.sum(ans, s => s.rating_product || 0) / ans.length : null, 2) + ' / 5' }, { label: 'No recibió lo pedido', value: ans.filter(s => s.received_as_ordered === false).length, tone: 'warn' }, { label: 'Compró fuera de la web', value: ans.filter(s => s.bought_outside_catalog).length, tone: 'bad' }]));
    const bySeller = U.groupBy(ans.filter(s => s.seller_user_id), 'seller_user_id'); const byBrand = U.groupBy(ans, 'brand_id');
    body.appendChild(h('div', { class: 'grid c2' }, card('Atención por vendedora', G.ui.chart.hbar({ items: Object.entries(bySeller).map(([u, xs]) => ({ label: G.userShort(u), value: avg(xs), tone: avg(xs) < 4 ? 'warn' : 'ok' })), format: v => G.fmt.num(v, 2) })), card('Atención por marca', G.ui.chart.hbar({ items: Object.entries(byBrand).map(([b, xs]) => ({ label: G.brandName(b), value: avg(xs) })), format: v => G.fmt.num(v, 2) }))));
    body.appendChild(table({ id: 'crm16', columns: [{ key: 'o', label: 'Pedido', value: s => (G.db.get('sales_orders', s.order_id) || {}).number, mono: true }, { key: 'c', label: 'Cliente', value: s => G.custName(s.customer_id) }, { key: 'brand_id', label: 'Marca', value: s => G.brandName(s.brand_id) }, { key: 'seller_user_id', label: 'Vendedora', value: s => G.userShort(s.seller_user_id) }, { key: 'send_mode', label: 'Envío', value: s => ({ SESSION: 'En ventana', TEMPLATE: 'Plantilla de utilidad', NOT_SENT: 'No enviada (cupo agotado)' })[s.send_mode] }, { key: 'rating_service', label: 'Atención', align: 'r' }, { key: 'rating_product', label: 'Producto', align: 'r' }, { key: 'f', label: 'Señal', value: s => s.bought_outside_catalog ? 'B' : s.received_as_ordered === false ? 'A' : '', render: s => s.bought_outside_catalog ? badge('Compró algo que no está en la web', 'bad') : s.received_as_ordered === false ? badge('No recibió lo que pidió', 'warn') : s.answered_at ? '' : badge('Sin respuesta', '') }, { key: 'comments', label: 'Comentario' }],
      rows, filters: [{ key: 'f', label: 'Señal', options: [['B', 'Compra fuera de la web'], ['A', 'No recibió lo pedido']], value: s => s.bought_outside_catalog ? 'B' : s.received_as_ordered === false ? 'A' : '' }, { key: 'brand_id', label: 'Marca', options: G.scope.brands().map(b => [b.id, G.brandName(b.id)]) }],
      onRow: s => drawer('Encuesta ' + ((G.db.get('sales_orders', s.order_id) || {}).number || ''), (b, close) => { b.append(dl([['Cliente', G.custName(s.customer_id)], ['Enviada', G.fmt.datetime(s.sent_at)], ['Respondida', G.fmt.datetime(s.answered_at)], ['Atención', s.rating_service], ['Producto', s.rating_product], ['¿Recibió lo pedido?', s.received_as_ordered == null ? '—' : s.received_as_ordered ? 'Sí' : 'No'], ['¿Compró algo fuera de la web?', s.bought_outside_catalog ? 'Sí' : 'No'], ['Comentario', s.comments]])); if (!s.answered_at) b.append(card('Registrar respuesta del cliente', form({ id: 'crm16a', fields: [{ key: 'rating_service', label: 'Atención (1–5)', type: 'number', min: 1, max: 5, required: true }, { key: 'rating_product', label: 'Producto (1–5)', type: 'number', min: 1, max: 5, required: true }, { key: 'received_as_ordered', label: 'Recibió lo que pidió', type: 'checkbox' }, { key: 'bought_outside_catalog', label: 'Compró algo que no está en la web', type: 'checkbox' }, { key: 'comments', label: 'Comentario', type: 'textarea' }], values: { rating_service: 5, rating_product: 5, received_as_ordered: true }, submitLabel: 'Guardar', onSubmit: v => { C.answerSurvey(s.id, v); close(); toast('Respuesta registrada', 'ok'); G.refresh(); return true; } }))); }) }));
  }

  /* ---------- CRM-17 Mis tareas ---------- */
  const STK = { mine: true };
  function rTasks(el) {
    C.sweep(); const now = C.now();
    const body = pg(el, 'CRM-17', 'Tareas de la vendedora: devolver llamada, recompra, seguimiento de encuesta y chats sin responder, con su vencimiento.');
    const all = G.db.where('crm_tasks', t => (!t.brand_id || G.scope.ok(t, { site: '_none' })));
    if (isSup()) body.appendChild(pills([['1', 'Mis tareas'], ['0', 'Todo el equipo']], STK.mine ? '1' : '0', v => { STK.mine = v === '1'; G.refresh(); }));
    const rows = all.filter(t => !(STK.mine || !isSup()) || t.assigned_user_id === me() || (!t.assigned_user_id && isSup())).sort((a, b) => a.due_at.localeCompare(b.due_at));
    const open = rows.filter(t => t.status === 'OPEN');
    body.appendChild(kpis([{ label: 'Abiertas', value: open.length }, { label: 'Vencidas', value: open.filter(t => t.due_at < now).length, tone: 'bad' }, { label: 'Vencen hoy', value: open.filter(t => t.due_at.slice(0, 10) === G.TODAY && t.due_at >= now).length, tone: 'warn' }, { label: 'Hechas', value: rows.filter(t => t.status === 'DONE').length, tone: 'ok' }]));
    body.appendChild(table({ id: 'crm17', columns: [{ key: 'task_type', label: 'Tipo', value: t => TASK[t.task_type] }, { key: 'c', label: 'Cliente o chat', value: t => t.customer_id ? G.custName(t.customer_id) : t.conversation_id ? C.contactName(conv(t.conversation_id)) : '—' }, { key: 'brand_id', label: 'Marca', value: t => G.brandName(t.brand_id) }, { key: 'assigned_user_id', label: 'Responsable', value: t => G.userShort(t.assigned_user_id) }, { key: 'due_at', label: 'Vence', render: t => h('span', { class: t.status === 'OPEN' && t.due_at < now ? 'bad' : '' }, G.fmt.datetime(t.due_at), t.status === 'OPEN' && t.due_at < now ? badge('Vencida', 'bad') : null) }, { key: 'note', label: 'Detalle' }, { key: 'status', label: 'Estado', render: t => G.ui.status(t.status === 'OPEN' ? 'OPEN' : t.status) }],
      rows, filters: [{ key: 'status', label: 'Estado', options: [['OPEN', 'Abierta'], ['DONE', 'Hecha']] }, { key: 'task_type', label: 'Tipo', options: Object.entries(TASK) }],
      actions: t => t.status !== 'OPEN' ? [] : [t.conversation_id ? btn('Abrir chat', () => goConv(t.conversation_id), { sm: true }) : null, t.task_type === 'CALLBACK' ? btn('Llamar', () => { try { G.assertMod('TEL'); toast('Llamada iniciada', 'ok'); } catch (e) { toast(e.message, 'warn'); } }, { sm: true }) : null, btn('Hecha', () => modal('Completar tarea', (b, close) => b.append(form({ id: 'crm17', fields: [{ key: 'r', label: 'Resultado', type: 'textarea', required: true }], submitLabel: 'Completar', onCancel: close, onSubmit: v => { try { C.completeTask(t.id, v.r); close(); toast('Tarea completada', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } }))), { sm: true, kind: 'primary' })] }));
  }

  /* ---------- CRM-18 Consentimientos y avisos ---------- */
  function rConsents(el) {
    const body = pg(el, 'CRM-18', 'Historial por cliente del aviso de registro, tratamiento de datos, marketing y bajas (Ley 29733). Los registros son de solo inserción y siempre llevan evidencia; el consentimiento nunca se presume.');
    const rows = G.db.all('contact_consents').slice().sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
    const PUR = { DATA_PROCESSING: 'Tratamiento de datos', MARKETING: 'Marketing', RECORDING_NOTICE: 'Aviso de registro', SURVEY: 'Encuestas' };
    const who = x => x.customer_id ? G.custName(x.customer_id) : (() => { const ct = G.db.get('channel_contacts', x.contact_id); return ct ? (ct.display_name || ct.external_user_id) : '—'; })();
    body.appendChild(kpis([{ label: 'Avisos de registro', value: rows.filter(x => x.purpose === 'RECORDING_NOTICE').length }, { label: 'Marketing otorgado', value: rows.filter(x => x.purpose === 'MARKETING' && x.granted).length, tone: 'ok' }, { label: 'Bajas de marketing', value: rows.filter(x => x.purpose === 'MARKETING' && !x.granted).length, tone: 'bad' }]));
    body.appendChild(tabs([
      { key: 'h', label: 'Historial', render: p => p.append(table({ id: 'crm18', columns: [{ key: 'recorded_at', label: 'Fecha', render: x => G.fmt.datetime(x.recorded_at) }, { key: 'w', label: 'Cliente o contacto', value: who }, { key: 'purpose', label: 'Propósito', value: x => PUR[x.purpose] }, { key: 'granted', label: 'Estado', value: x => x.granted ? 'Otorgado' : 'Baja', render: x => x.granted ? badge('Otorgado', 'ok') : badge('Baja', 'bad') }, { key: 'channel', label: 'Canal' }, { key: 'brand_id', label: 'Marca', value: x => x.brand_id ? G.brandName(x.brand_id) : 'Todas' }, { key: 'evidence_text', label: 'Evidencia', value: x => x.evidence_text || (x.evidence_message_id ? 'Mensaje del cliente' : '') }],
        rows, filters: [{ key: 'purpose', label: 'Propósito', options: Object.entries(PUR) }, { key: 'g', label: 'Estado', options: [['1', 'Otorgado'], ['0', 'Baja']], value: x => x.granted ? '1' : '0' }] })) },
      { key: 'r', label: 'Registrar', render: p => p.append(G.can('crm.consent.manage') ? card('Registrar consentimiento o baja', form({ id: 'crm18r', fields: [{ key: 'customer_id', label: 'Cliente', type: 'select', required: true, options: G.db.where('customers', c => c.phone && c.status === 'ACTIVE').slice(0, 500).map(c => [c.id, `${c.full_name} · ${c.phone}`]) }, { key: 'purpose', label: 'Propósito', type: 'select', required: true, options: Object.entries(PUR).filter(x => x[0] !== 'RECORDING_NOTICE') }, { key: 'granted', label: 'Otorga (desmarcado = baja)', type: 'checkbox' }, { key: 'channel', label: 'Canal', type: 'select', required: true, options: [['WHATSAPP', 'WhatsApp'], ['PHONE', 'Teléfono'], ['WEB', 'Web'], ['COUNTER', 'Mostrador']] }, { key: 'evidence_text', label: 'Evidencia (texto del cliente o documento)', type: 'textarea', required: true }], values: { purpose: 'MARKETING', granted: true, channel: 'WHATSAPP' }, submitLabel: 'Registrar',
        onSubmit: v => { try { C.recordConsent(v); toast(v.granted ? 'Consentimiento registrado' : 'Baja registrada: se excluye de campañas', 'ok'); G.refresh(); return true; } catch (e) { return e.message; } } })) : notice('Tu rol no registra consentimientos (permiso crm.consent.manage).', 'warn')) },
      { key: 't', label: 'Textos de aviso por número', render: p => { p.append(notice('D-CRM-06: texto provisional de la semilla; validar con el abogado laboral y de datos personales.', 'warn')); for (const ch of G.db.where('messaging_channels', c => c.kind === 'WHATSAPP')) p.append(card(C.chLabel(ch), h('div', { class: 'stack' }, h('p', { class: 'small' }, ch.recording_notice_text), G.can('crm.channel.manage') ? btn('Editar en Números y cuentas', () => G.go('CRM-07'), { sm: true, kind: 'ghost' }) : null))); } }]));
  }

  /* ---------- registro ---------- */
  G.register({ code: 'CRM', name: 'Bandeja omnicanal', phase: 1, group: 'Ventas y canales', screens: [
    { code: 'CRM-01', name: 'Bandeja', render: rInbox }, { code: 'CRM-02', name: 'Conversación', render: rConv }, { code: 'CRM-03', name: 'Crear pedido desde el chat', render: rCreate },
    { code: 'CRM-04', name: 'Ficha 360 del cliente', render: rCustomer }, { code: 'CRM-05', name: 'Leads', render: rLeads }, { code: 'CRM-06', name: 'Supervisión en vivo', render: rSupervision },
    { code: 'CRM-07', name: 'Números y cuentas', render: rChannels }, { code: 'CRM-08', name: 'Equipos y turnos', render: rTeams }, { code: 'CRM-09', name: 'Plantillas', render: rTemplates },
    { code: 'CRM-10', name: 'Respuestas rápidas y catálogo', render: rQuick }, { code: 'CRM-11', name: 'Costo de WhatsApp', render: rCost }, { code: 'CRM-12', name: 'Alertas de control', render: rAlerts },
    { code: 'CRM-13', name: 'Reglas e identificadores oficiales', render: rRules }, { code: 'CRM-14', name: 'Revisión por muestreo', render: rReview }, { code: 'CRM-15', name: 'Recompra', render: rRebuy },
    { code: 'CRM-16', name: 'Encuesta posentrega', render: rSurveys }, { code: 'CRM-17', name: 'Mis tareas', render: rTasks }, { code: 'CRM-18', name: 'Consentimientos y avisos', render: rConsents },
  ] });
})();
